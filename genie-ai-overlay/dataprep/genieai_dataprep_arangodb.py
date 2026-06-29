# Copyright (C) 2025 International Telecommunication Union (ITU)
# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import asyncio
import fcntl  # Added for file locking
import json
import os
import re
from typing import Any

import aiohttp
from opentelemetry import propagate

from core.model_cache import get_model_id
from tracing import get_tracer, setup_trace_logging, with_span

tracer = get_tracer(__name__)

# Import exceptions for robust error handling
# Import Parent Class
import comps.dataprep.src.integrations.arangodb as _parent_mod
from arango.exceptions import AQLQueryExecuteError

# Import OPEA Core
from comps import CustomLogger, DocPath, OpeaComponentRegistry

# Import Custom GENIE Protocols
from comps.cores.proto.genieai_api_protocol import ArangoDBDataprepRequestFromDocRepo

# Import Custom Utils
from comps.dataprep.src.genieai_dataprep_utils import docling_document_loader, document_loader, is_valid_content
from comps.dataprep.src.integrations.arangodb import OpeaArangoDataprep
from comps.dataprep.src.utils import get_separators

# Align OPEA parent with GENIE convention: use ARANGO_DB (default: genie-ai)
# instead of ARANGO_DB_NAME (default: _system). Both retriever and dataprep
# must target the same database for RAG retrieval to find graph data.
_parent_mod.ARANGO_DB_NAME = os.getenv("ARANGO_DB", os.getenv("ARANGO_DB_NAME", "_system"))

from fastapi import HTTPException
from langchain_arangodb import ArangoGraph
from langchain_core.documents import Document
from langchain_text_splitters import HTMLHeaderTextSplitter, RecursiveCharacterTextSplitter
from numpy import dot
from numpy.linalg import norm
from openai import AsyncOpenAI
from pydantic import ValidationError  # Import Pydantic validation error
from rank_bm25 import BM25Okapi

logger = CustomLogger("GENIE_DATAPREP_ARANGODB")
setup_trace_logging("GENIE_DATAPREP_ARANGODB")
logflag = os.getenv("LOGFLAG", "false").lower() == "true"

# --- GENIE-Specific Configuration ---
# 1. Document Repository: Handles Logs and Status Updates
DOCUMENT_REPOSITORY_URL = os.getenv("DOCUMENT_REPOSITORY_URL", "http://document-repository:3001")
# 2. Backend Service: Source of Truth for Label Hierarchy
BACKEND_SERVICE_URL = os.getenv("BACKEND_SERVICE_URL", "http://backend:3000")

# 3. Keycloak Service Account for OIDC authentication
from keycloak_service_account import get_service_account_token

GUARDRAIL_URL = os.getenv("GUARDRAIL_URL", "http://guardrail:9090/v1/guardrails")
GUARDRAIL_ENABLED = os.getenv("GUARDRAIL_ENABLED", "false").lower() == "true"

# Spec 8.0: New Env Vars
LABELING_STRATEGY = os.getenv("LABELING_STRATEGY", "llm")
EMBEDDING_LABEL_THRESHOLD = float(os.getenv("EMBEDDING_LABEL_THRESHOLD", "0.75"))
BM25_LABEL_THRESHOLD = float(os.getenv("BM25_LABEL_THRESHOLD", "2.00"))
CONTENT_EXTRACTION_METHOD = os.getenv("CONTENT_EXTRACTION_METHOD", "opea")
LOCK_FILE_PATH = "/tmp/genie_dataprep.lock"
# Concurrency control for LLM labeling. Default raised 5 → 20 so vLLM's
# continuous batching is utilized — LLM labeling was the #1 ingestion
# bottleneck (~70% of wall time; see perf analysis on release/el-salvador).
# Tunable via env.
MAX_CONCURRENT_BATCHES = int(os.getenv("DATAPREP_MAX_CONCURRENT_BATCHES", "20"))
# Number of chunks sent per LLM labeling call. >1 batches chunks into a single
# call to cut network round-trips to a (often remote) vLLM. Default 4 balances
# throughput (4x fewer calls) with compatibility across models; raise to 8 on
# capable models validated for batched JSON (e.g. granite-4.1-8b). Batches that
# fail to parse fall back to per-chunk labeling, so output is always correct.
LABEL_LLM_BATCH_SIZE = max(1, int(os.getenv("DATAPREP_LLM_LABEL_BATCH_SIZE", "4")))
# Sampling temperature for LLM labeling. 0.0 = greedy → deterministic, maximal
# format adherence (clean JSON) for a classification task; correct default for
# every instruction model. Tunable per model if ever needed.
LLM_LABEL_TEMPERATURE = float(os.getenv("DATAPREP_LLM_TEMPERATURE", "0.0"))

# Contextual Retrieval (Anthropic-style): per-chunk LLM-generated document
# context prepended to each chunk before embedding + labeling, so chunks carry
# document-level subject (fixes label/embedding context loss; see
# spec-contextual-retrieval.md). Default OFF — opt-in. Adds one LLM call per
# chunk (concurrency-bounded) when enabled. Part B (retriever BM25 hybrid) is a
# separate spec.
CONTEXTUAL_RETRIEVAL_ENABLED = os.getenv("CONTEXTUAL_RETRIEVAL_ENABLED", "true").lower() == "true"
# Model used for context generation. Empty → reuse VLLM_MODEL_ID (auto-detected
# on remote GPU nodes). Set to a smaller/cheaper model to cut context-gen cost.
DATAPREP_CONTEXTUAL_MODEL = os.getenv("DATAPREP_CONTEXTUAL_MODEL", "")
# Max chars of the joined document chunks fed to the context-generation LLM
# (bounds the prompt; ~1500 tokens). Filename + file_labels are always included.
DATAPREP_CONTEXTUAL_DOC_BUDGET = int(os.getenv("DATAPREP_CONTEXTUAL_DOC_BUDGET", "6000"))
# Doc-context budget for the doc_level strategy (ONE call, so it can afford a
# much larger window than per_chunk). ~4 chars/token; keep below the model's
# VLLM_MAX_MODEL_LEN minus prompt/output overhead. Docs larger than this (or the
# model window) are truncated — Map-Reduce hierarchical summarization is the
# future fix for that case.
DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL = int(os.getenv("DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL", "100000"))
# Strategy when CONTEXTUAL_RETRIEVAL_ENABLED=true:
#   "per_chunk" (default) — one LLM call per chunk; each chunk gets a context
#      tailored to its section (Anthropic recipe; highest quality, N calls/doc).
#   "doc_level"           — ONE LLM call for the whole document; the same
#      document-level context is prepended to every chunk (N× cheaper; still
#      propagates the document subject — enough to fix label/embedding loss).
CONTEXTUAL_STRATEGY = os.getenv("CONTEXTUAL_STRATEGY", "doc_level").strip().lower() or "doc_level"
# Decoupled mode: when true, label the RAW chunk and use the generated context
# ONLY for the embedding. Recommended — keeps label precision (the labeler sees
# the raw chunk) while propagating the document subject via the vector. Default
# false (context fed to both embedding and labeling).
CONTEXTUAL_LABEL_RAW = os.getenv("CONTEXTUAL_LABEL_RAW", "true").lower() == "true"

# Spec 5.3: Externalized Prompt - Two-tier priority
# Level 1: ENV VAR (highest priority) - override via .env
# Level 2: Hardcoded default (fallback) - works out-of-the-box
_LABEL_SELECTOR_DEFAULT = """
<SYSTEM INSTRUCTIONS>
You are a precise semantic labeler for a RAG knowledge graph.
Goal: Assign 1–4 MOST RELEVANT labels from the list below that best match the chunk content.
Rules:
- Return ONLY labels that are strongly relevant.
- Most chunks get 1–3 labels. Never exceed 5.
- Do NOT "maximize" coverage.
- Do NOT suggest new labels.
- Use ONLY exact strings from the list.

Labels:
{labels_list}

Output format (STRICT):
- Return ONLY a JSON object — no prose, no markdown, no code fences.
- The value is ALWAYS an array of strings.
- For a chunk with no matching label, use an empty array [] (never null).
Example:
{"labels": ["Label1", "Label2"]}
</SYSTEM INSTRUCTIONS>
""".strip()
_env_value = os.getenv("LABEL_SELECTOR_SYSTEM_PROMPT", "")
LABEL_SELECTOR_SYSTEM_PROMPT = _env_value.strip() or _LABEL_SELECTOR_DEFAULT

# Contextual Retrieval prompt (two-tier: env override, else built-in default).
# {document_context} is replaced per ingestion with filename + labels + doc text.
_CONTEXTUAL_RETRIEVAL_PROMPT_DEFAULT = """
<SYSTEM INSTRUCTIONS>
You place a text chunk inside its parent document so the chunk can be
retrieved even when it does not name the document's subject.

Given the DOCUMENT CONTEXT (the document's subject and scope) and one CHUNK
from that document, write a 50-100 word context that states what the document
is and what this specific chunk is about, so the chunk can be found by searches
about the document's subject. Use only facts from the document context and the
chunk — do not invent details.

DOCUMENT CONTEXT:
{document_context}

Output format (STRICT): return ONLY a JSON object — no prose, no markdown, no
code fences.
- Single chunk input → {"context": "<50-100 word context>"}.
- Multiple chunks input (a JSON list of {"index": i, "text": ...}) →
  {"contexts": {"<index>": "<50-100 word context>", ...}} with one entry per
  input chunk.
Example (single): {"context": "This chunk is from the CENTA cucumber cultivation
guide. It covers irrigation scheduling for cucumber crops."}
</SYSTEM INSTRUCTIONS>
""".strip()
_ctx_env = os.getenv("CONTEXTUAL_RETRIEVAL_PROMPT", "")
CONTEXTUAL_RETRIEVAL_PROMPT = _ctx_env.strip() or _CONTEXTUAL_RETRIEVAL_PROMPT_DEFAULT

# Document-level context prompt (used by the CONTEXTUAL_STRATEGY=doc_level path;
# built-in default, not env-overridable — customize CONTEXTUAL_RETRIEVAL_PROMPT
# for the per_chunk path if needed).
_CONTEXTUAL_DOC_PROMPT_DEFAULT = """
<SYSTEM INSTRUCTIONS>
You write a short context that describes what a document IS, so any chunk from
it can be retrieved by searches about the document's subject.

Given the DOCUMENT CONTEXT (subject + scope), write a 50-100 word description of
the document: what it is, its subject, and its scope. Use only facts from the
document context — do not invent details.

DOCUMENT CONTEXT:
{document_context}

Output format (STRICT): return ONLY a JSON object — no prose, no markdown, no
code fences.
Example: {"context": "A CENTA cucumber cultivation guide covering planning
through post-harvest for cucumber crops in tropical climates."}
</SYSTEM INSTRUCTIONS>
""".strip()


def _build_vllm_client() -> tuple[AsyncOpenAI, str]:
    """Construct the AsyncOpenAI client for the self-hosted vLLM and resolve the model.

    Auto-detects the loaded model on a remote GPU node (TTL-cached, see
    core/model_cache.py) so VLLM_MODEL_ID need not match the GPU deployment.
    Shared by labeling and Contextual-Retrieval context generation.
    """
    _api_key = os.getenv("VLLM_API_KEY", "EMPTY")
    _vllm_endpoint = os.getenv("VLLM_ENDPOINT")
    client = AsyncOpenAI(api_key=_api_key, base_url=f"{_vllm_endpoint}/v1")
    model = os.getenv("VLLM_MODEL_ID")
    if os.getenv("GPU_NODE_HOST"):
        detected = get_model_id(_vllm_endpoint)
        if detected:
            model = detected
            logger.info(f"Auto-detected remote vLLM model: {model}")
    if not model:
        raise RuntimeError("VLLM_MODEL_ID not set and auto-detection failed")
    return client, model


@OpeaComponentRegistry.register("GENIE_DATAPREP_ARANGODB")
class GenieArangoDataprep(OpeaArangoDataprep):
    """
    GENIE.AI Extension of OpeaArangoDataprep.
    Adds: Docling, Multi-Strategy Labeling, Guardrails, Batched Ingestion, and Repo Callbacks.
    """

    def __init__(self, name: str, description: str, config: dict = None):
        super().__init__(name, description, config)
        # FIX: Increased Semaphore from 5 to 100 to restore ingestion speed.
        # The backend rate limit is now disabled, so we can send logs much faster.
        self._log_semaphore = asyncio.Semaphore(100)

        # Debug Requirement 2: Print environment at startup
        self._log_environment_variables()

    def _log_environment_variables(self):
        """Debug: Print all critical environment variables at startup."""
        logger.debug(
            f"GENIE-AI DATAPREP CONFIGURATION: "
            f"DOC_REPO={DOCUMENT_REPOSITORY_URL}, "
            f"BACKEND={BACKEND_SERVICE_URL}, "
            f"GUARDRAIL={GUARDRAIL_ENABLED} ({GUARDRAIL_URL}), "
            f"LABELING={LABELING_STRATEGY}, "
            f"EMBED_THRESHOLD={EMBEDDING_LABEL_THRESHOLD}, "
            f"BM25_THRESHOLD={BM25_LABEL_THRESHOLD}, "
            f"EXTRACTION={CONTENT_EXTRACTION_METHOD}, "
            f"LLM={os.getenv('VLLM_ENDPOINT')}, "
            f"ARANGO_DB={os.getenv('ARANGO_DB')}, "
            f"PROMPT_LEN={len(LABEL_SELECTOR_SYSTEM_PROMPT)}, "
            f"BATCHES={MAX_CONCURRENT_BATCHES}, "
            f"CONTEXTUAL_RETRIEVAL={CONTEXTUAL_RETRIEVAL_ENABLED}"
        )

    def _initialize_llm(self, *args, **kwargs):
        """Override parent to auto-detect model on remote GPU node.

        The parent reads VLLM_MODEL_ID from env var, which may not match
        the model actually loaded on the remote GPU node. When GPU_NODE_HOST
        is set, probe the vLLM /v1/models API (TTL-cached, see core/model_cache.py)
        and override the env var before calling the parent method.
        """
        _vllm_endpoint = os.getenv("VLLM_ENDPOINT", "")

        if os.getenv("GPU_NODE_HOST") and _vllm_endpoint:
            detected = get_model_id(_vllm_endpoint)
            if detected:
                os.environ["VLLM_MODEL_ID"] = detected
                # Also patch the parent module constant (evaluated at import time)
                import comps.dataprep.src.integrations.arangodb as _parent_mod

                _parent_mod.VLLM_MODEL_ID = detected
                logger.info(f"Auto-detected remote vLLM model for graph extraction: {detected}")

        super()._initialize_llm(*args, **kwargs)

    # --- Utilities (Spec 4.1, 5.2, 6.1) ---

    async def _service_headers(self):
        """Return auth headers using Keycloak service account Bearer token."""
        try:
            token = await get_service_account_token()
            return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
        except Exception as e:
            logger.error(f"Failed to obtain service account token: {e}")
            return None

    async def _update_doc_status(self, file_id: str, status: str, chunk_count: int = None):
        """Updates file status in Document Repository (Spec 4.1/6.1)."""
        headers = await self._service_headers()
        if not headers:
            if logflag:
                logger.warning(f"Skipping status update for {file_id} due to missing auth token.")
            return

        url = f"{DOCUMENT_REPOSITORY_URL}/api/files/{file_id}/status"

        # FIX: chunk_count must be at the ROOT level, not inside dataprep object
        payload = {"dataprep": {"status": status}}
        if chunk_count is not None:
            payload["chunk_count"] = chunk_count

        try:
            propagate.inject(headers)
            # Also apply semaphore here to be safe
            async with (
                self._log_semaphore,
                aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session,
                session.patch(url, json=payload, headers=headers) as response,
            ):
                if response.status != 200:
                    logger.error(f"Failed to update status {status} for {file_id}: {await response.text()}")
        except Exception as e:
            logger.error(f"Error calling Doc Repo Status API: {e}")

    async def _write_ingestion_log(self, file_id: str, level: str, stage: str, message: str):
        """Writes human-readable logs to Document Repository (Spec 5.2/6.2)."""
        headers = await self._service_headers()
        if not headers:
            if logflag:
                logger.warning(f"Skipping log write for {file_id} due to missing auth token.")
            return

        url = f"{DOCUMENT_REPOSITORY_URL}/api/files/{file_id}/ingestion-log"
        payload = {
            "level": level,  # Sent exactly as passed (INFO, WARN, ERROR)
            "stage": stage,
            "message": message,
        }
        try:
            propagate.inject(headers)
            # FIX: Limit concurrency of log writes to prevent 429 flooding
            async with (
                self._log_semaphore,
                aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session,
                session.post(url, json=payload, headers=headers) as response,
            ):
                # Ignore 429s in logs specifically to prevent recursion or spam
                if response.status == 429:
                    if logflag:
                        logger.warning("Log write rate-limited (429). Dropping log message.")
                    return
                if response.status != 201:
                    logger.error(f"Failed to write log for {file_id}: {await response.text()}")
        except Exception as e:
            logger.error(f"Error calling Doc Repo Log API: {e}")

    async def _fetch_all_labels(self):
        """Fetch full taxonomy from the Backend Service to guide the LLM."""
        headers = await self._service_headers()
        if not headers:
            logger.warning("Skipping label fetch due to missing service account token.")
            return []

        # FIX: Target the Backend Service for the hierarchy
        url = f"{BACKEND_SERVICE_URL}/api/service-categories/categories"

        try:
            propagate.inject(headers)
            async with (
                self._log_semaphore,
                aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session,
                session.get(url, headers=headers) as response,
            ):
                if response.status == 200:
                    data = await response.json()
                    labels = []
                    # Backend returns a tree structure (Category -> Children)
                    if isinstance(data, list):
                        for category in data:
                            # Add the Category Name
                            if isinstance(category, dict) and "name" in category:
                                labels.append(category["name"])
                                # Add all Children (Services)
                                if "children" in category and isinstance(category["children"], list):
                                    for child in category["children"]:
                                        # Children might be strings or objects depending on query
                                        if isinstance(child, dict) and "name" in child:
                                            labels.append(child["name"])
                                        elif isinstance(child, str):
                                            labels.append(child)

                    logger.info(f"Fetched {len(labels)} labels from Backend taxonomy.")
                    return list(set(labels))

                logger.error(f"Label fetch failed. Status: {response.status}, Body: {await response.text()}")
        except Exception as e:
            logger.error(f"Error fetching labels from Backend: {e}")
        return []

    # --- Core Pipeline Steps ---

    async def _load_and_chunk(self, doc_path: DocPath) -> list[str]:
        path = doc_path.path

        # --- FIX: Expanded Docling Support ---
        # Added .docx, .pptx, .xlsx, .md, .txt, .html support
        docling_extensions = (".pdf", ".docx", ".pptx", ".xlsx", ".html", ".txt", ".md", ".asciidoc")

        if path.endswith(docling_extensions) and CONTENT_EXTRACTION_METHOD == "docling":
            logger.info(f"Using Docling for file: {path}")
            content = await docling_document_loader(path)
        else:
            logger.info(f"Using Standard Loader for file: {path}")
            content = await document_loader(path)

        if not content:
            return []

        if path.endswith(".html"):
            text_splitter = HTMLHeaderTextSplitter(headers_to_split_on=[("h1", "H1"), ("h2", "H2")])
        else:
            text_splitter = RecursiveCharacterTextSplitter(
                chunk_size=doc_path.chunk_size,
                chunk_overlap=doc_path.chunk_overlap,
                add_start_index=True,
                separators=get_separators(),
            )

        with tracer.start_as_current_span("dataprep.chunking") as span:
            if isinstance(content, list):
                raw_chunks = []
                for item in content:
                    item_str = str(item)
                    if len(item_str) > doc_path.chunk_size:
                        raw_chunks.extend(text_splitter.split_text(item_str))
                    else:
                        raw_chunks.append(item_str)
                plain_chunks = raw_chunks
            else:
                docs = text_splitter.create_documents([content])
                plain_chunks = [d.page_content for d in docs]

            valid_chunks = [c for c in plain_chunks if is_valid_content(c)]
            span.set_attribute("dataprep.chunk_count", len(valid_chunks))

        return valid_chunks

    async def _run_guardrail(self, plain_chunks: list[str]) -> dict[str, Any]:
        if not GUARDRAIL_ENABLED:
            return {"success": True}

        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=30)) as session:
            for i, text in enumerate(plain_chunks):
                try:
                    async with session.post(GUARDRAIL_URL, json={"text": text}) as resp:
                        if resp.status != 200:
                            return {"success": False, "message": f"Guardrail error chunk {i}"}

                        result = await resp.json()
                        if result.get("text") != text:
                            return {"success": False, "message": f"Chunk {i}: Blocked by guardrail.", "chunk_index": i}
                except Exception as e:
                    return {"success": False, "message": f"Guardrail connection failed: {e}"}

        return {"success": True}

    # --- Labeling Strategies (Spec 5.3, 5.4) ---

    async def _label_with_llm(self, chunks: list[str], all_labels: list[str], file_labels: list[str], file_id: str):
        """Labels chunks using VLLM with Retry Logic and Advisory Warnings (Spec 5.3)."""
        client, model = _build_vllm_client()

        # Precompute the system prompt once (the taxonomy is identical for every chunk).
        system_prompt = LABEL_SELECTOR_SYSTEM_PROMPT.replace("{labels_list}", str(all_labels))
        logger.debug(
            f"LLM LABELING INPUTS: taxonomy ({len(all_labels)} labels), "
            f"file_labels: {file_labels}, system_prompt ({len(system_prompt)} chars), "
            f"chunks: {len(chunks)}, batch_size: {LABEL_LLM_BATCH_SIZE}, "
            f"concurrency: {MAX_CONCURRENT_BATCHES}"
        )

        semaphore = asyncio.Semaphore(MAX_CONCURRENT_BATCHES)
        logger.info(
            f"LLM labeling: {len(chunks)} chunks "
            f"(concurrency={MAX_CONCURRENT_BATCHES}, batch_size={LABEL_LLM_BATCH_SIZE}, "
            f"model={model}, temperature={LLM_LABEL_TEMPERATURE})"
        )

        # Group indexed chunks into batches; each batch yields one LLM call (or,
        # on parse failure, per-chunk calls). All gated by the semaphore.
        indexed = list(enumerate(chunks))
        batches = [indexed[i : i + LABEL_LLM_BATCH_SIZE] for i in range(0, len(indexed), LABEL_LLM_BATCH_SIZE)]

        async def _process_batch(batch):
            async with semaphore:
                return await self._llm_suggest_labels(client, model, system_prompt, batch, file_id, file_labels)

        batch_results = await asyncio.gather(*[_process_batch(b) for b in batches])
        suggested_map: dict[int, list[str]] = {}
        for partial in batch_results:
            suggested_map.update(partial)

        # Resolve suggestions against the taxonomy (exact + synonym match) and
        # emit a single consolidated ingestion-log entry per chunk.
        results = []
        total = len(indexed)
        for n, (i, text) in enumerate(indexed, 1):
            labels = await self._finalize_chunk_labels(i, suggested_map.get(i, []), all_labels, file_id)
            results.append({"text": text, "labels": labels})
            if n % 200 == 0 or n == total:
                logger.info(f"Labeling progress: {n}/{total} chunks finalized")
        return results

    def _build_doc_context(self, chunks: list[str], input, budget: int = DATAPREP_CONTEXTUAL_DOC_BUDGET) -> str:
        """Build the document-context string fed to the context-generation LLM.

        Combines filename, file labels, and a budgeted join of the document's
        chunks. ``budget`` lets the doc_level path pass a larger window (it is a
        single call); per_chunk uses the smaller default (it is repeated per
        batch). Logs a WARN when the content is truncated so operators notice.
        """
        filename = os.path.basename(getattr(input, "storage_path", "") or getattr(input, "file_path", "") or "")
        file_labels = list(getattr(input, "file_labels", []) or [])
        joined = "\n".join(chunks)
        truncated = False
        if budget > 0 and len(joined) > budget:
            joined = joined[:budget] + "...[truncated]"
            truncated = True
        parts = []
        if filename:
            parts.append(f"Filename: {filename}")
        if file_labels:
            parts.append(f"Document labels: {', '.join(file_labels)}")
        parts.append(f"Document content (may be truncated):\n{joined}")
        if truncated:
            logger.warning(
                f"Contextual Retrieval: document context truncated to {budget} chars "
                f"(full doc {len(chunks)} chunks). Deep chunks may get weaker context; "
                f"raise the budget (or use Map-Reduce for very large docs)."
            )
        return "\n".join(parts)

    async def _apply_contextualization(self, chunks: list[str], input, file_id: str) -> list[str]:
        """Prepend an LLM-generated document context to each chunk.

        No-op when CONTEXTUAL_RETRIEVAL_ENABLED is false (returns chunks
        unchanged). When enabled, returns contextualized texts (same order and
        length) of the form ``<context>\\n\\n<chunk>``. Chunks whose context
        generation fails fall back to the raw chunk so ingestion never blocks.
        """
        if not CONTEXTUAL_RETRIEVAL_ENABLED or not chunks:
            return list(chunks)

        # Build the client outside the per-chunk retry loop. If construction fails
        # (e.g. model auto-detection failure on the GPU node), skip contextualization
        # entirely and ingest raw chunks — never block ingestion (spec boundary).
        try:
            client, default_model = _build_vllm_client()
        except Exception as e:
            err = f"{type(e).__name__}: {str(e)[:200]}"
            logger.error(
                f"Contextual Retrieval disabled for {file_id}: vLLM client init failed ({err}); using raw chunks."
            )
            await self._write_ingestion_log(
                file_id,
                "ERROR",
                "Contextualization",
                f"vLLM client init failed ({err}); using raw chunks.",
            )
            return list(chunks)

        model = DATAPREP_CONTEXTUAL_MODEL.strip() or default_model
        total = len(chunks)

        # doc_level: one LLM call for the whole document → same context on every
        # chunk (uses a larger doc budget — it is a single call; N× cheaper).
        if CONTEXTUAL_STRATEGY == "doc_level":
            doc_context = self._build_doc_context(chunks, input, DATAPREP_CONTEXTUAL_DOC_BUDGET_DOC_LEVEL)
            return await self._contextualize_doc_level(client, model, doc_context, chunks, file_id, total)

        # per_chunk (default): batched calls so the document context lives once
        # per batch (system prompt), not per chunk; per-chunk fallback on any
        # batch parse failure (Anthropic recipe).
        doc_context = self._build_doc_context(chunks, input, DATAPREP_CONTEXTUAL_DOC_BUDGET)
        system_prompt = CONTEXTUAL_RETRIEVAL_PROMPT.replace("{document_context}", doc_context)
        return await self._contextualize_per_chunk(client, model, system_prompt, chunks, file_id, total)

    async def _contextualize_per_chunk(self, client, model, system_prompt, chunks, file_id, total) -> list[str]:
        """per_chunk strategy: batched LLM calls → one section-tailored context per chunk.

        Chunks are batched (``LABEL_LLM_BATCH_SIZE``) so the document context is
        sent once per batch (system prompt), not per chunk; concurrency is
        bounded by ``MAX_CONCURRENT_BATCHES``. Any batch parse failure falls back
        to per-chunk calls; chunks whose context fails fall back to raw text.
        """
        logger.info(
            f"Contextual Retrieval (per_chunk): {total} chunks "
            f"(batch_size={LABEL_LLM_BATCH_SIZE}, concurrency={MAX_CONCURRENT_BATCHES}, model={model})"
        )
        indexed = list(enumerate(chunks))
        batches = [indexed[i : i + LABEL_LLM_BATCH_SIZE] for i in range(0, len(indexed), LABEL_LLM_BATCH_SIZE)]
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_BATCHES)

        async def _process_batch(batch):
            async with semaphore:
                return await self._context_batch_call(client, model, system_prompt, batch, file_id)

        batch_results = await asyncio.gather(*[_process_batch(b) for b in batches])
        contexts: dict[int, str] = {}
        for partial in batch_results:
            contexts.update(partial)

        result = []
        with_context = 0
        for i, chunk in indexed:
            ctx = (contexts.get(i, "") or "").strip()
            if ctx:
                with_context += 1
                result.append(f"{ctx}\n\n{chunk}")
            else:
                result.append(chunk)

        if with_context == 0:
            # Silent-degradation guard: a misconfigured DATAPREP_CONTEXTUAL_MODEL
            # (e.g. one that rejects response_format=json_object) makes every chunk
            # fall back with no error — surface one loud signal so operators notice.
            logger.error(
                f"Contextual Retrieval produced 0/{total} contexts for {file_id} — "
                f"likely {model} does not support guided JSON or is unreachable. "
                f"Check DATAPREP_CONTEXTUAL_MODEL / VLLM_ENDPOINT."
            )
            await self._write_ingestion_log(
                file_id,
                "ERROR",
                "Contextualization",
                f"0/{total} contexts generated — verify the model supports guided JSON and is reachable.",
            )
        else:
            logger.info(f"Contextual Retrieval: {with_context}/{total} chunks contextualized.")
        return result

    async def _context_batch_call(self, client, model, system_prompt, batch, file_id) -> dict[int, str]:
        """One LLM call generating contexts for a batch of chunks.

        Returns ``{chunk_index: context}``. On parse failure (or a single-chunk
        batch), falls back to per-chunk ``_context_single_call`` so context
        generation always completes. Emits a ``dataprep.llm.context_batch`` span
        (per-chunk spans on fallback).
        """
        if len(batch) > 1:
            with with_span(
                "dataprep.llm.context_batch",
                attributes={
                    "dataprep.llm_batched": True,
                    "dataprep.llm_batch_size": len(batch),
                    "dataprep.llm_model": model or "",
                    "dataprep.contextual_retrieval": True,
                    "dataprep.contextual_strategy": "per_chunk",
                },
            ) as span:
                try:
                    response = await client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": system_prompt},
                            {
                                "role": "user",
                                "content": json.dumps([{"index": i, "text": t} for i, t in batch]),
                            },
                        ],
                        temperature=LLM_LABEL_TEMPERATURE,
                        max_tokens=200 * len(batch),
                        response_format={"type": "json_object"},
                    )
                    parsed = json.loads(response.choices[0].message.content)
                    raw = parsed.get("contexts", parsed) if isinstance(parsed, dict) else {}
                    valid_ids = {i for i, _ in batch}
                    out: dict[int, str] = {}
                    for k, v in raw.items():
                        try:
                            idx = int(k)
                        except (TypeError, ValueError):
                            continue
                        if idx in valid_ids and isinstance(v, str) and v.strip():
                            out[idx] = v.strip()
                    if out:
                        _usage = getattr(response, "usage", None)
                        if getattr(_usage, "completion_tokens", None) is not None:
                            span.set_attribute("dataprep.llm.completion_tokens", _usage.completion_tokens)
                        if getattr(_usage, "prompt_tokens", None) is not None:
                            span.set_attribute("dataprep.llm.prompt_tokens", _usage.prompt_tokens)
                        span.set_attribute("dataprep.contexts_generated", len(out))
                        return out
                    await self._write_ingestion_log(
                        file_id,
                        "WARN",
                        "Contextualization",
                        f"Batch context parse failure for chunks {[i for i, _ in batch]}; falling back to per-chunk.",
                    )
                except Exception as e:
                    err = f"{type(e).__name__}: {str(e)[:200]}"
                    logger.warning(f"Batch context failed {[i for i, _ in batch]}: {err}; falling back to per-chunk.")
                    await self._write_ingestion_log(
                        file_id,
                        "WARN",
                        "Contextualization",
                        f"Batch context failed ({err}); falling back to per-chunk.",
                    )
        # per-chunk fallback (single-chunk batch, parse failure, or call error)
        fallback: dict[int, str] = {}
        for i, text in batch:
            fallback[i] = await self._context_single_call(client, model, system_prompt, i, text, file_id)
        return fallback

    async def _contextualize_doc_level(self, client, model, doc_context, chunks, file_id, total) -> list[str]:
        """doc_level strategy: one LLM call → one document context prepended to every chunk."""
        system_prompt = _CONTEXTUAL_DOC_PROMPT_DEFAULT.replace("{document_context}", doc_context)
        logger.info(f"Contextual Retrieval (doc_level): 1 call for {total} chunks (model={model}).")
        summary = (await self._context_doc_call(client, model, system_prompt, file_id) or "").strip()
        if not summary:
            logger.error(
                f"Contextual Retrieval (doc_level) produced no context for {file_id} — "
                f"check DATAPREP_CONTEXTUAL_MODEL / VLLM_ENDPOINT."
            )
            await self._write_ingestion_log(
                file_id,
                "ERROR",
                "Contextualization",
                "0 doc-level contexts generated — verify the model supports guided JSON and is reachable.",
            )
            return list(chunks)
        logger.info(f"Contextual Retrieval (doc_level): context generated, prepending to {total} chunks.")
        return [f"{summary}\n\n{chunk}" for chunk in chunks]

    async def _context_doc_call(self, client, model, system_prompt, file_id: str) -> str:
        """One LLM call generating a single document-level context (3 retries).

        Returns the context string, or "" if all attempts fail (caller falls
        back to raw chunks). Emits a ``dataprep.llm.context_doc`` span.
        """
        for attempt in range(1, 4):
            with with_span(
                "dataprep.llm.context_doc",
                attributes={
                    "dataprep.llm_attempt": attempt,
                    "dataprep.llm_batched": False,
                    "dataprep.llm_model": model or "",
                    "dataprep.contextual_retrieval": True,
                    "dataprep.contextual_strategy": "doc_level",
                },
            ) as span:
                try:
                    response = await client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": "Write the document-level context."},
                        ],
                        temperature=LLM_LABEL_TEMPERATURE,
                        max_tokens=200,
                        response_format={"type": "json_object"},
                    )
                    parsed = json.loads(response.choices[0].message.content)
                    ctx = parsed.get("context", "")
                    if isinstance(ctx, str) and ctx.strip():
                        _usage = getattr(response, "usage", None)
                        if getattr(_usage, "completion_tokens", None) is not None:
                            span.set_attribute("dataprep.llm.completion_tokens", _usage.completion_tokens)
                        if getattr(_usage, "prompt_tokens", None) is not None:
                            span.set_attribute("dataprep.llm.prompt_tokens", _usage.prompt_tokens)
                        span.set_attribute("dataprep.context_chars", len(ctx))
                        return ctx.strip()
                    await self._write_ingestion_log(
                        file_id,
                        "WARN",
                        "Contextualization",
                        f"Doc-level context empty (attempt {attempt}/3).",
                    )
                except Exception as e:
                    err = f"{type(e).__name__}: {str(e)[:200]}"
                    logger.warning(f"Doc-level context attempt {attempt}/3 failed: {err}")
                    await self._write_ingestion_log(
                        file_id,
                        "WARN",
                        "Contextualization",
                        f"Doc-level context attempt {attempt}/3 failed: {err}",
                    )
        await self._write_ingestion_log(
            file_id,
            "WARN",
            "Contextualization",
            "Doc-level context generation failed after 3 attempts — using raw chunks.",
        )
        return ""

    async def _context_single_call(self, client, model, system_prompt, index: int, text: str, file_id: str) -> str:
        """One LLM call generating the context for a single chunk (3 retries).

        Returns the context string, or "" if all attempts fail (caller falls
        back to the raw chunk). Emits a ``dataprep.llm.context_chunk`` span.
        """
        for attempt in range(1, 4):
            with with_span(
                "dataprep.llm.context_chunk",
                attributes={
                    "dataprep.chunk_index": index,
                    "dataprep.llm_attempt": attempt,
                    "dataprep.llm_batched": False,
                    "dataprep.llm_model": model or "",
                    "dataprep.contextual_retrieval": True,
                },
            ) as span:
                try:
                    response = await client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": f"CHUNK:\n{text}"},
                        ],
                        temperature=LLM_LABEL_TEMPERATURE,
                        max_tokens=200,
                        response_format={"type": "json_object"},
                    )
                    parsed = json.loads(response.choices[0].message.content)
                    ctx = parsed.get("context", "")
                    if isinstance(ctx, str) and ctx.strip():
                        _usage = getattr(response, "usage", None)
                        if getattr(_usage, "completion_tokens", None) is not None:
                            span.set_attribute("dataprep.llm.completion_tokens", _usage.completion_tokens)
                        if getattr(_usage, "prompt_tokens", None) is not None:
                            span.set_attribute("dataprep.llm.prompt_tokens", _usage.prompt_tokens)
                        span.set_attribute("dataprep.context_chars", len(ctx))
                        return ctx.strip()
                    await self._write_ingestion_log(
                        file_id,
                        "WARN",
                        "Contextualization",
                        f"Chunk {index}: empty context (attempt {attempt}/3).",
                    )
                except Exception as e:
                    err = f"{type(e).__name__}: {str(e)[:200]}"
                    logger.warning(f"Chunk {index}: context attempt {attempt}/3 failed: {err}")
                    await self._write_ingestion_log(
                        file_id,
                        "WARN",
                        "Contextualization",
                        f"Chunk {index}: context attempt {attempt}/3 failed: {err}",
                    )
        await self._write_ingestion_log(
            file_id,
            "WARN",
            "Contextualization",
            f"Chunk {index}: context generation failed after 3 attempts — using raw chunk.",
        )
        return ""

    async def _llm_suggest_labels(
        self, client, model, system_prompt, batch, file_id, file_labels
    ) -> dict[int, list[str]]:
        """Return raw suggested labels per chunk index for one batch.

        Uses a single batched LLM call when ``len(batch) > 1``; any parse failure
        falls back to one call per chunk so labeling always completes.
        """
        if len(batch) > 1:
            try:
                suggestions = await self._llm_call_batch(client, model, system_prompt, batch, file_id)
                if suggestions is not None:
                    return suggestions
                await self._write_ingestion_log(
                    file_id,
                    "WARN",
                    "Labeling",
                    f"Batch labeling parse failure for chunks {[i for i, _ in batch]}; falling back to per-chunk.",
                )
            except Exception as e:
                err = f"{type(e).__name__}: {str(e)[:200]}"
                batch_indices = [i for i, _ in batch]
                await self._write_ingestion_log(
                    file_id,
                    "WARN",
                    "Labeling",
                    f"Batch labeling call failed for chunks {batch_indices} ({err}); falling back to per-chunk.",
                )
        # Per-chunk path (default, and batch fallback).
        out: dict[int, list[str]] = {}
        for i, text in batch:
            out[i] = await self._llm_call_single(client, model, system_prompt, i, text, file_id, file_labels)
        return out

    async def _llm_call_single(self, client, model, system_prompt, index, text, file_id, file_labels) -> list[str]:
        """One LLM call for a single chunk with up to 3 retries. Emits an OTel span."""
        for attempt in range(1, 4):
            with with_span(
                "dataprep.llm.label_chunk",
                attributes={
                    "dataprep.chunk_index": index,
                    "dataprep.llm_attempt": attempt,
                    "dataprep.llm_batched": False,
                    "dataprep.llm_model": model or "",
                },
            ) as span:
                try:
                    response = await client.chat.completions.create(
                        model=model,
                        messages=[
                            {"role": "system", "content": system_prompt},
                            {"role": "user", "content": f"Input: {text}"},
                        ],
                        temperature=LLM_LABEL_TEMPERATURE,
                        max_tokens=160,
                        response_format={"type": "json_object"},
                    )
                    parsed = json.loads(response.choices[0].message.content)
                    suggested = parsed.get("labels", [])
                    # Lenient: null -> []; a bare string -> [string]; drop non-strings.
                    if suggested is None:
                        suggested = []
                    elif isinstance(suggested, str):
                        suggested = [suggested]
                    if isinstance(suggested, list):
                        suggested = [x for x in suggested if isinstance(x, str)]
                        span.set_attribute("dataprep.labels_suggested", len(suggested))
                        _usage = getattr(response, "usage", None)
                        if getattr(_usage, "completion_tokens", None) is not None:
                            span.set_attribute("dataprep.llm.completion_tokens", _usage.completion_tokens)
                        return suggested
                    await self._write_ingestion_log(
                        file_id,
                        "WARN",
                        "Labeling",
                        f"Chunk {index}: LLM returned non-string labels {suggested}. Retrying ({attempt}/3)...",
                    )
                except Exception as e:
                    err = f"{type(e).__name__}: {str(e)[:200]}"
                    logger.warning(f"Chunk {index}: LLM label attempt {attempt}/3 failed: {err}")
                    await self._write_ingestion_log(
                        file_id,
                        "WARN",
                        "Labeling",
                        f"Chunk {index}: LLM call attempt {attempt}/3 failed: {err}",
                    )
        await self._write_ingestion_log(
            file_id,
            "WARN",
            "Labeling",
            f"Chunk {index}: LLM failed to return valid labels after 3 attempts. Falling back to file labels.",
        )
        return list(file_labels) if file_labels else []

    async def _llm_call_batch(self, client, model, system_prompt, batch, file_id) -> dict[int, list[str]] | None:
        """One LLM call labeling a whole batch of chunks. Returns None on parse failure."""
        indices = [i for i, _ in batch]
        user_content = (
            "For each numbered chunk below, assign labels. Respond with ONLY a JSON object "
            "mapping EVERY chunk index (string key) to an ARRAY of label strings, e.g. "
            '{"0": ["Healthcare"], "1": ["Education"]}. Every index MUST be present; values '
            "are ALWAYS arrays (never null, never a bare string); use [] for chunks with no "
            "matching label. No prose, no markdown.\n"
        )
        for i, text in batch:
            user_content += f"\n[{i}] {text}"
        with with_span(
            "dataprep.llm.label_batch",
            attributes={
                "dataprep.llm_batched": True,
                "dataprep.llm_batch_size": len(batch),
                "dataprep.llm_model": model or "",
                "dataprep.chunk_indices": str(indices),
            },
        ) as span:
            try:
                response = await client.chat.completions.create(
                    model=model,
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": user_content},
                    ],
                    temperature=LLM_LABEL_TEMPERATURE,
                    max_tokens=len(batch) * 256 + 512,
                    response_format={"type": "json_object"},
                )
                parsed = json.loads(response.choices[0].message.content)
                if not isinstance(parsed, dict):
                    return None
                index_set = set(indices)
                suggestions: dict[int, list[str]] = {}
                for key, labels in parsed.items():
                    try:
                        idx = int(key)
                    except (TypeError, ValueError):
                        continue
                    if idx not in index_set:
                        continue
                    # Lenient: accept the model's varied shapes (null / string / list);
                    # an unusable value skips the chunk (-> empty) instead of failing the batch.
                    if labels is None:
                        labels = []
                    elif isinstance(labels, str):
                        labels = [labels]
                    elif not isinstance(labels, list):
                        continue
                    labels = [x for x in labels if isinstance(x, str)]
                    suggestions[idx] = labels
                # Missing indices = the model chose not to label them (valid → empty).
                for i in indices:
                    suggestions.setdefault(i, [])
                span.set_attribute("dataprep.labels_suggested", sum(len(v) for v in suggestions.values()))
                _usage = getattr(response, "usage", None)
                if getattr(_usage, "completion_tokens", None) is not None:
                    span.set_attribute("dataprep.llm.completion_tokens", _usage.completion_tokens)
                    span.set_attribute("dataprep.llm.prompt_tokens", getattr(_usage, "prompt_tokens", 0))
                return suggestions
            except Exception as e:
                err = f"{type(e).__name__}: {str(e)[:200]}"
                await self._write_ingestion_log(
                    file_id,
                    "WARN",
                    "Labeling",
                    f"Batch labeling call failed for chunks {indices} ({err}); returning None for per-chunk fallback.",
                )
                return None

    async def _finalize_chunk_labels(self, index, suggested, all_labels, file_id) -> list[str]:
        """Resolve raw LLM suggestions against the taxonomy (exact + synonym match).

        Consolidates per-label progress logs into a single summary entry per chunk
        (previously ~3.7 logs/chunk flooded the backend ingestion-log endpoint).
        """
        final_labels: set[str] = set()
        new_labels: list[str] = []
        for label in suggested:
            if label in final_labels:
                continue
            if label in all_labels:
                final_labels.add(label)
                continue
            # Fuzzy/synonym match (plural, case-insensitive).
            match = next((x for x in all_labels if x.lower() == label.lower()), None)
            if not match and label.endswith("s"):
                match = next((x for x in all_labels if x.lower() == label[:-1].lower()), None)
            if not match:
                match = next((x for x in all_labels if x.lower() == label.lower() + "s"), None)
            if match:
                final_labels.add(match)
            else:
                new_labels.append(label)

        labels_list = list(final_labels)
        level = "INFO"
        msg = f"Chunk {index}: Final labels ({len(labels_list)}): {labels_list}."
        if new_labels:
            level = "WARN"
            msg += f" New (non-taxonomy) labels suggested: {new_labels} — consider adding to the Knowledge Hierarchy."
        await self._write_ingestion_log(file_id, level, "Labeling", msg)
        return labels_list

    def _label_with_embedding(self, chunks: list[str], all_labels: list[str]):
        """Spec 5.4: Cosine Similarity Labeling."""
        if not self.embeddings:
            self._initialize_embeddings()

        label_vecs = self.embeddings.embed_documents(all_labels)
        results = []
        for text in chunks:
            chunk_vec = self.embeddings.embed_query(text)
            selected = []
            for i, l_vec in enumerate(label_vecs):
                sim = dot(l_vec, chunk_vec) / (norm(l_vec) * norm(chunk_vec))
                if sim >= EMBEDDING_LABEL_THRESHOLD:
                    selected.append(all_labels[i])
            results.append({"text": text, "labels": selected})
        return results

    def _label_with_bm25(self, chunks: list[str], all_labels: list[str]):
        """Spec 5.4: BM25 Labeling."""
        tokenized_labels = [re.findall(r"\b\w+\b", l.lower()) for l in all_labels]
        bm25 = BM25Okapi(tokenized_labels)
        results = []
        for text in chunks:
            tokens = re.findall(r"\b\w+\b", text.lower())
            scores = bm25.get_scores(tokens)
            selected = [all_labels[i] for i, s in enumerate(scores) if s >= BM25_LABEL_THRESHOLD]
            results.append({"text": text, "labels": selected})
        return results

    async def _apply_labels(self, plain_chunks: list[str], all_labels: list[str], file_labels: list[str], file_id: str):
        if not all_labels:
            await self._write_ingestion_log(
                file_id, "WARN", "Labeling", "No labels found in Taxonomy. Using only file labels."
            )
            return [{"text": c, "labels": file_labels if file_labels else []} for c in plain_chunks]

        logger.info(f"Labeling using strategy: {LABELING_STRATEGY}")

        if LABELING_STRATEGY == "embedding":
            # Offload CPU-bound embedding calculations to a thread
            return await asyncio.to_thread(self._label_with_embedding, plain_chunks, all_labels)
        elif LABELING_STRATEGY == "bm25":
            # Offload CPU-bound BM25 calculations to a thread
            return await asyncio.to_thread(self._label_with_bm25, plain_chunks, all_labels)
        else:
            # Default to LLM (with retry fix and advisory logic)
            return await self._label_with_llm(plain_chunks, all_labels, file_labels, file_id)

    # --- Main Ingestion Logic (Async + Batched) ---

    async def _process_batch(self, batch_docs, current_batch_num, total_batches, input, graph_name, semaphore):
        """Helper to process a single batch with concurrency control."""
        async with semaphore:
            try:
                await self._write_ingestion_log(
                    input.file_id, "INFO", "Graph", f"Processing Batch {current_batch_num}/{total_batches}..."
                )

                # We need to wrap the synchronous graph transformer calls in asyncio.to_thread
                # to avoid blocking the event loop if they are heavy CPU tasks.
                try:
                    graph_docs = await asyncio.to_thread(self.llm_transformer.convert_to_graph_documents, batch_docs)
                except Exception as ge:
                    logger.error(f"Batch {current_batch_num} graph conversion failed: {type(ge).__name__}: {ge}")
                    raise

                if graph_docs:
                    logger.info(f"Batch {current_batch_num}: {len(graph_docs)} graph_docs extracted")
                    # Run graph insertion in a thread as well if it's blocking
                    try:
                        await asyncio.to_thread(
                            self.graph.add_graph_documents,
                            graph_documents=graph_docs,
                            include_source=getattr(input, "include_chunks", True),
                            graph_name=graph_name,
                            use_one_entity_collection=True,
                            embeddings=self.embeddings,
                            embedding_field="embedding",
                            embed_source=getattr(input, "embed_chunks", True),
                            embed_nodes=getattr(input, "embed_nodes", True),
                            embed_relationships=getattr(input, "embed_edges", True),
                            capitalization_strategy=getattr(input, "text_capitalization_strategy", "upper"),
                        )
                    except Exception as embed_err:
                        logger.error(
                            f"Batch {current_batch_num} graph insertion failed: {type(embed_err).__name__}: {embed_err}"
                        )
                        raise
            except (ValidationError, Exception) as ve:
                logger.warning(f"Batch {current_batch_num} failed graph extraction: {ve}")
                await self._write_ingestion_log(
                    input.file_id,
                    "WARN",
                    "Graph",
                    f"Batch {current_batch_num} skipped due to extraction error: {str(ve)}",
                )

                # Retry logic for individual docs in case of failure
                for retry_doc in batch_docs:
                    try:
                        retry_graph_docs = await asyncio.to_thread(
                            self.llm_transformer.convert_to_graph_documents, [retry_doc]
                        )
                        if retry_graph_docs:
                            await asyncio.to_thread(
                                self.graph.add_graph_documents,
                                graph_documents=retry_graph_docs,
                                include_source=getattr(input, "include_chunks", True),
                                graph_name=graph_name,
                                use_one_entity_collection=True,
                                embeddings=self.embeddings,
                                embedding_field="embedding",
                                embed_source=getattr(input, "embed_chunks", True),
                                embed_nodes=getattr(input, "embed_nodes", True),
                                embed_relationships=getattr(input, "embed_edges", True),
                                capitalization_strategy=getattr(input, "text_capitalization_strategy", "upper"),
                            )
                    except Exception as inner_e:
                        logger.error(f"Skipping individual bad document: {inner_e}")

    async def ingest_file_with_guardrail(self, input: ArangoDBDataprepRequestFromDocRepo, lock_file=None):
        """
        Asynchronous ingestion task with support for graceful 'Killed' status transitions.
        Ensures auto-retraction occurs if the task is cancelled or fails.
        """
        # NOTE: lock_file is passed from the microservice and is already LOCKED.
        # We are responsible for releasing and closing it in the finally block.

        try:
            # --- START PROTECTED EXECUTION (Spec 5.1) ---
            await self._update_doc_status(input.file_id, "Ingesting")
            await self._write_ingestion_log(input.file_id, "INFO", "System", "Ingestion task started.")

            try:
                # 1. Fetch Taxonomy (FROM BACKEND)
                all_labels = await self._fetch_all_labels()

                self._initialize_llm(
                    allowed_node_types=getattr(input, "allowed_node_types", []),
                    allowed_edge_types=getattr(input, "allowed_edge_types", []),
                    node_properties=getattr(input, "node_properties", ["description"]),
                    edge_properties=getattr(input, "edge_properties", ["description"]),
                )

                doc_path = DocPath(
                    path=input.file_path,
                    chunk_size=input.chunk_size,
                    chunk_overlap=input.chunk_overlap,
                    process_table=input.process_table,
                    table_strategy=input.table_strategy,
                )

                # 2. Extract and Chunk Content
                chunks = await self._load_and_chunk(doc_path)
                if not chunks:
                    raise Exception("No valid content extracted from file.")

                await self._write_ingestion_log(input.file_id, "INFO", "Chunking", f"Generated {len(chunks)} chunks.")

                # 3. Guardrail Check
                gr_result = await self._run_guardrail(chunks)
                if not gr_result["success"]:
                    await self._write_ingestion_log(input.file_id, "ERROR", "Guardrail", gr_result["message"])
                    raise Exception("Guardrail Violation")

                # 4. Contextual Retrieval (optional) + Labeling (Spec 5.3, 5.4)
                file_labels = getattr(input, "file_labels", [])
                original_chunks = list(chunks)
                # When enabled, prepend an LLM-generated document context to each
                # chunk so the embedding carries the document's subject (see
                # spec-contextual-retrieval.md). No-op (returns chunks unchanged)
                # when CONTEXTUAL_RETRIEVAL_ENABLED=false.
                contextualized = await self._apply_contextualization(original_chunks, input, input.file_id)
                # Decoupled mode (CONTEXTUAL_LABEL_RAW): label the RAW chunk (the
                # context prefix distorts labeling — over/under-label) and use the
                # contextualized text ONLY for the embedding. Default: label the
                # contextualized text (context fed to both).
                label_input = original_chunks if CONTEXTUAL_LABEL_RAW else contextualized
                labelled_docs = await self._apply_labels(label_input, all_labels, file_labels, input.file_id)

                # 5. Graph Insertion (BATCHED & CONCURRENT)
                graph_name = getattr(input, "graph_name", os.getenv("ARANGO_GRAPH_NAME", "GRAPH"))

                documents_to_process = []
                for i, doc in enumerate(labelled_docs):
                    # metadata.chunk_text preserves the original (un-contextualized)
                    # chunk for display/debug. Only written when contextualization is
                    # enabled (flag off → true no-op, page_content already == original).
                    # Guard i so a future _apply_labels change that altered chunk
                    # count/order can never raise here (never block ingestion).
                    metadata = {
                        "file_id": input.file_id,
                        "file_path": input.storage_path,
                        "chunk_index": i,
                        "chunk_labels": doc["labels"],
                    }
                    if CONTEXTUAL_RETRIEVAL_ENABLED and i < len(original_chunks):
                        metadata["chunk_text"] = original_chunks[i]
                    # Embed the contextualized text (subject propagation); falls back
                    # to the labelled text when indexing is somehow misaligned.
                    embed_text = contextualized[i] if i < len(contextualized) else doc["text"]
                    documents_to_process.append(Document(page_content=embed_text, metadata=metadata))

                BATCH_SIZE = 10
                total_batches = (len(documents_to_process) + BATCH_SIZE - 1) // BATCH_SIZE

                self.graph = ArangoGraph(db=self.db, generate_schema_on_init=False)
                semaphore = asyncio.Semaphore(MAX_CONCURRENT_BATCHES)
                tasks = []

                for i in range(0, len(documents_to_process), BATCH_SIZE):
                    batch_docs = documents_to_process[i : i + BATCH_SIZE]
                    current_batch_num = (i // BATCH_SIZE) + 1

                    # Schedule batch processing with concurrency control
                    task = asyncio.create_task(
                        self._process_batch(batch_docs, current_batch_num, total_batches, input, graph_name, semaphore)
                    )
                    tasks.append(task)

                # Wait for all batches to complete
                if tasks:
                    await asyncio.gather(*tasks)

                # 6. Final Status Update
                await self._update_doc_status(input.file_id, "Ingested", chunk_count=len(chunks))
                await self._write_ingestion_log(input.file_id, "INFO", "System", "Ingestion completed successfully.")

                return {
                    "status": 200,
                    "message": f"Successfully ingested {len(chunks)} chunks.",
                    "graph_name": graph_name,
                }

            except asyncio.CancelledError:
                # --- KILL SWITCH HANDLING (Spec 3.1 & 4.2) ---
                # Triggered when task.cancel() is called from the microservice
                kill_msg = f"Ingestion for {input.file_id} was KILLED by an administrator. Rolling back..."
                logger.warning(kill_msg)

                # Log the termination event
                await self._write_ingestion_log(
                    input.file_id, "WARN", "System", "Ingestion process killed. Starting cleanup..."
                )

                # Perform graceful rollback (retraction)
                await self.retract_file(file_id=input.file_id, graph_name=getattr(input, "graph_name", "GRAPH"))

                # Set final status to "Killed" as per state machine specification
                await self._update_doc_status(input.file_id, "Killed")

                await self._write_ingestion_log(
                    input.file_id, "INFO", "System", "Cleanup complete. Document state set to Killed."
                )
                raise  # Re-raise to ensure the task terminates properly

            except Exception as e:
                # --- ERROR HANDLING & AUTO-RETRACTION (Spec 5.5) ---
                error_msg = f"Ingestion failed: {str(e)}"
                logger.error(error_msg)

                await self._write_ingestion_log(input.file_id, "ERROR", "System", f"{error_msg}. Rolling back.")
                await self._update_doc_status(input.file_id, "Ingestion Error")

                # Auto-retract created data
                await self.retract_file(file_id=input.file_id, graph_name=getattr(input, "graph_name", "GRAPH"))
                await self._write_ingestion_log(
                    input.file_id, "INFO", "System", "Rollback complete. Document retracted."
                )

                raise HTTPException(status_code=500, detail=error_msg) from e

        finally:
            # --- LOCK MANAGEMENT ---
            # Release the file lock so the next document can be processed
            if lock_file:
                fcntl.flock(lock_file, fcntl.LOCK_UN)
                lock_file.close()

    async def retract_file(self, file_id: str, graph_name: str):
        """
        Retracts a file and performs a clean graph cascade deletion in explicit steps.
        Order: Identify -> Delete Chunks -> Delete Edges -> Delete Orphans
        """
        logger.info(f"Retracting file {file_id} from {graph_name} with cascading graph cleanup.")
        await self._write_ingestion_log(file_id, "INFO", "Retract", "Starting retraction analysis...")

        col_source = f"{graph_name}_SOURCE"
        col_entity = f"{graph_name}_ENTITY"
        col_has_source = f"{graph_name}_HAS_SOURCE"
        col_links_to = f"{graph_name}_LINKS_TO"

        try:
            # ----------------------------------------------------------
            # STEP 1: Identify CHUNKS (Sources)
            # ----------------------------------------------------------
            # Fetch both the KEY and ID. Using _key allows safe deletion by key.
            aql_find_chunks = """
                FOR doc IN @@col_source
                FILTER doc.file_id == @file_id OR doc.metadata.file_id == @file_id
                RETURN { key: doc._key, id: doc._id }
            """
            cursor_chunks = self.db.aql.execute(
                aql_find_chunks, bind_vars={"@col_source": col_source, "file_id": file_id}
            )

            # These are dicts: {'key': '...', 'id': '...'}
            chunk_objects = [doc for doc in cursor_chunks]
            chunk_ids_list = [c["id"] for c in chunk_objects]
            chunk_keys_list = [c["key"] for c in chunk_objects]

            log_msg = f"Analysis: Found {len(chunk_objects)} chunks in {col_source} matching file_id {file_id}."
            logger.info(log_msg)
            await self._write_ingestion_log(file_id, "INFO", "Retract", log_msg)

            if not chunk_objects:
                logger.warning(f"No chunks found for {file_id}. Aborting graph retraction.")
                await self._update_doc_status(file_id, "Retracted")
                return {"status": 200, "message": "No chunks found.", "details": {"deleted_chunks": 0}}

            # ----------------------------------------------------------
            # STEP 2: Identify Edges & Orphans (Before Deleting Chunks)
            # ----------------------------------------------------------
            # Find edges connected to these chunks to identify potentially orphaned entities
            aql_find_edges = """
                FOR edge IN @@col_has_source
                FILTER edge._to IN @chunk_ids_list
                RETURN { key: edge._key, id: edge._id, from: edge._from }
            """
            cursor_edges = self.db.aql.execute(
                aql_find_edges, bind_vars={"@col_has_source": col_has_source, "chunk_ids_list": chunk_ids_list}
            )
            edge_objects = [e for e in cursor_edges]

            edge_keys_list = [e["key"] for e in edge_objects]
            candidate_entity_ids = list(set([e["from"] for e in edge_objects]))

            log_msg = f"Analysis: Found {len(edge_keys_list)} HAS_SOURCE edges linking to these chunks."
            logger.info(log_msg)
            await self._write_ingestion_log(file_id, "INFO", "Retract", log_msg)

            # ----------------------------------------------------------
            # STEP 3: DELETE CHUNKS (Priority 1)
            # ----------------------------------------------------------
            # We use the KEYs for safe deletion
            aql_delete_chunks = """
                FOR key IN @chunk_keys
                REMOVE key IN @@col_source OPTIONS { ignoreErrors: true }
                RETURN OLD._id
            """
            cursor_del_chunks = self.db.aql.execute(
                aql_delete_chunks, bind_vars={"@col_source": col_source, "chunk_keys": chunk_keys_list}
            )
            deleted_chunks = [doc for doc in cursor_del_chunks]

            await self._write_ingestion_log(file_id, "INFO", "Retract", f"Deleted {len(deleted_chunks)} chunks.")

            # ----------------------------------------------------------
            # STEP 4: DELETE EDGES (Priority 2)
            # ----------------------------------------------------------
            if edge_keys_list:
                aql_delete_edges = """
                    FOR key IN @edge_keys
                    REMOVE key IN @@col_has_source OPTIONS { ignoreErrors: true }
                    RETURN OLD._id
                """
                cursor_del_edges = self.db.aql.execute(
                    aql_delete_edges, bind_vars={"@col_has_source": col_has_source, "edge_keys": edge_keys_list}
                )
                deleted_edges = [doc for doc in cursor_del_edges]
                await self._write_ingestion_log(file_id, "INFO", "Retract", f"Deleted {len(deleted_edges)} edges.")

            # STEP 4.5: DELETE LINKS_TO edges associated with the file's content
            # This targets edges that were specifically formed between entities within this file
            log_msg = "Cleaning up LINKS_TO edges associated with file chunks..."
            logger.info(log_msg)

            aql_del_file_links = """
                FOR edge IN @@col_links_to
                FILTER edge.file_id == @file_id OR edge.metadata.file_id == @file_id
                REMOVE edge IN @@col_links_to OPTIONS { ignoreErrors: true }
                RETURN OLD._id
            """
            cursor_del_file_links = self.db.aql.execute(
                aql_del_file_links, bind_vars={"@col_links_to": col_links_to, "file_id": file_id}
            )
            deleted_file_links = [l for l in cursor_del_file_links]
            await self._write_ingestion_log(
                file_id, "INFO", "Retract", f"Deleted {len(deleted_file_links)} file-specific LINKS_TO edges."
            )

            # ----------------------------------------------------------
            # STEP 5: DETECT & DELETE ORPHANS (Priority 3)
            # ----------------------------------------------------------
            deleted_entities_count = 0
            if candidate_entity_ids:
                # Check if entities have ANY remaining incoming edges
                aql_find_orphans = """
                    FOR entity_id IN @candidate_ids
                        LET incoming_count = LENGTH(
                            FOR edge IN @@col_has_source
                            FILTER edge._from == entity_id
                            LIMIT 1
                            RETURN 1
                        )
                        FILTER incoming_count == 0
                        RETURN entity_id
                """
                cursor_orphans = self.db.aql.execute(
                    aql_find_orphans,
                    bind_vars={"@col_has_source": col_has_source, "candidate_ids": candidate_entity_ids},
                )
                orphan_ids = [doc for doc in cursor_orphans]  # Full IDs (Collection/Key)

                if orphan_ids:
                    await self._write_ingestion_log(
                        file_id, "INFO", "Retract", f"Identified {len(orphan_ids)} orphans. Deleting..."
                    )

                    # 5a. Delete LINKS_TO edges connected to orphans (Source OR Target)
                    # Optimization: Batch delete edges connected to these orphans
                    try:
                        aql_del_links = """
                            FOR edge IN @@col_links_to
                                FILTER edge._from IN @orphan_ids OR edge._to IN @orphan_ids
                                REMOVE edge IN @@col_links_to OPTIONS { ignoreErrors: true }
                        """
                        self.db.aql.execute(
                            aql_del_links, bind_vars={"@col_links_to": col_links_to, "orphan_ids": orphan_ids}
                        )
                    except Exception as e:
                        logger.warning(f"Error deleting links: {e}")

                    # 5b. Delete Entities
                    # Extract keys in Python to avoid AQL parsing issues inside REMOVE loop
                    orphan_keys = [oid.split("/")[-1] for oid in orphan_ids]

                    try:
                        aql_del_entities = """
                            FOR key IN @keys
                                REMOVE key IN @@col_entity OPTIONS { ignoreErrors: true }
                        """
                        self.db.aql.execute(
                            aql_del_entities, bind_vars={"@col_entity": col_entity, "keys": orphan_keys}
                        )
                        deleted_entities_count = len(orphan_keys)
                    except Exception as e:
                        logger.warning(f"Error deleting entities: {e}")
                        deleted_entities_count = 0

                    await self._write_ingestion_log(
                        file_id, "INFO", "Retract", f"Deleted {deleted_entities_count} orphan entities."
                    )

            # ----------------------------------------------------------
            # FINAL REPORT
            # ----------------------------------------------------------
            await self._update_doc_status(file_id, "Retracted")

            final_msg = (
                f"Retraction Complete. Deleted: {len(chunk_keys_list)} Chunks, "
                f"{len(edge_keys_list)} Edges, {deleted_entities_count} Entities."
            )
            logger.info(final_msg)
            await self._write_ingestion_log(file_id, "INFO", "Retract", final_msg)

            return {
                "status": 200,
                "message": final_msg,
                "details": {
                    "deleted_chunks": len(chunk_keys_list),
                    "deleted_edges": len(edge_keys_list),
                    "deleted_entities": deleted_entities_count,
                },
            }

        except AQLQueryExecuteError as e:
            if e.error_code == 1203:
                logger.warning(f"Graph Collection {graph_name} not found. Nothing to retract.")
                return {"status": 200, "message": "Graph not found, nothing to retract."}

            err_msg = f"AQL Error during retraction: {str(e)}"
            logger.error(err_msg)
            await self._write_ingestion_log(file_id, "ERROR", "Retract", err_msg)
            raise e
