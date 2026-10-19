# Copyright (C) 2025 International Telecommunication Union (ITU)
# Copyright (C) 2024 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import asyncio
import fcntl  # Added for file locking
import json
import os
import re
import time
from contextlib import suppress
from typing import Any

import aiohttp
from opentelemetry import propagate

from core.model_cache import get_model_id
from core.model_http_policy import (
    CONTROL_PLANE_TIMEOUT_SECONDS,
    LLM_MAX_RETRIES,
    LLM_TIMEOUT_SECONDS,
    http_timeout,
    positive_float_env,
)
from core.span_attrs import ATTRIBUTE_NAMES
from tracing import (
    background_span,
    get_meter,
    get_tracer,
    install_uvicorn_access_logging,
    setup_json_logging,
    setup_trace_logging,
    with_span,
)

tracer = get_tracer(__name__)


# --- vLLM context-overflow fail-loud contract ---
# Mirrors the reranker fix (RerankerInputTooLongError, genieai_tei_reranker.py:39): when
# vLLM rejects a request because the prompt exceeds the model's max_model_len, the call site
# must raise a typed exception instead of silently swallowing the error and falling back
# to the raw chunk. Counter + OTel span attribute surface this to operators.
class DataprepInputTooLongError(RuntimeError):
    """Raised when a vLLM labeling or context-generation call exceeds the model's context window.

    vLLM returns BadRequestError("This model's maximum context length is N tokens...
    Please reduce the length...") when the prompt + reserved output exceeds the
    configured max_model_len. This typed exception lets the async-fire-and-forget
    ingest task record the failure through `_write_ingestion_log` (admin UI surface
    per .claude/rules/DEBUGGING-TRACING.md §6.1) rather than silently ingesting a
    degraded chunk.
    """


# Markers in vLLM/OpenAI error messages that indicate context-overflow. Classified by
# string-substring rather than SDK exception type to avoid lock-in on a specific
# `openai` SDK version (test envs + minimal docker images may not ship the SDK).
#
# "string too long" was REMOVED (reviewer note): it also fires for non-overflow
# errors like `messages[2].tool_calls[0].id: string too long` and oversized
# `tools[0].function.description` (>1 MB). The remaining 5 markers cover the
# canonical vLLM granite-4.1-8b context-overflow message body.
_VLLM_CONTEXT_OVERFLOW_MARKERS = (
    "context length",
    "context_length_exceeded",
    "maximum context length",
    "reduce the length",
    "context window",
)


def _overflow_message_from_exc(exc: BaseException) -> str:
    """Aggregate every string-shaped field of an exception into one lowercased haystack.

    Production SDKs put the vLLM error body in different places depending on the
    transport:
      - openai.BadRequestError (>=3.x): body is on `exc.body['error']['message']`
        (dict) or on `exc.response.text` (string); `str(exc)` is ONLY the status
        code phrase (`"Error code: 400"`) — body NOT included.
      - httpx.HTTPStatusError: body is on `exc.response.text`; `str(exc)` is
        `'Client error '400 Bad Request' for url '...'` — no body.
      - aiohttp.ClientResponseError: body is on `exc.message`.
      - bare Exception/ValueError (test mocks + legacy code): the marker phrase
        lives in `str(exc)`.

    Union ALL of these so the classifier matches the LIVE shape, not just the
    shape that happens to be used in unit tests.
    """
    parts: list[str] = []
    with suppress(Exception):
        parts.append(str(exc) or "")
    try:
        body = getattr(exc, "body", None)
        if isinstance(body, dict):
            err = body.get("error") if isinstance(body, dict) else None
            if isinstance(err, dict):
                msg = err.get("message") or err.get("detail") or ""
                if msg:
                    parts.append(str(msg))
        elif isinstance(body, str):
            parts.append(body)
    except Exception:
        pass
    try:
        resp = getattr(exc, "response", None)
        if resp is not None:
            text = getattr(resp, "text", None)
            if text:
                parts.append(str(text))
    except Exception:
        pass
    try:
        msg = getattr(exc, "message", None)
        if msg and isinstance(msg, str):
            parts.append(msg)
    except Exception:
        pass
    return " ".join(parts).lower()


# Class-name fragments of the timeout exceptions the model-endpoint clients
# raise: openai's APITimeoutError (its own class plus the httpx one it wraps),
# httpx's TimeoutException, and aiohttp's ServerTimeoutError / asyncio's
# TimeoutError. Matched on the class name rather than by importing the
# libraries, so the classifier keeps working when one of them is absent — the
# same reason _is_vllm_input_overflow inspects the message instead.
_TIMEOUT_CLASS_MARKERS = ("Timeout",)


def _is_timeout(exc: BaseException) -> bool:
    """True if `exc` is a request timeout rather than any other failure.

    Worth separating from the generic handler because it is the failure the
    HTTP budget produces on purpose: a timeout means the model endpoint did not
    answer within its allowance, which points at GPU contention and at a budget
    that may need raising. A 500 or a JSON parse failure means something else
    entirely, and conflating the two makes a saturated GPU look like a broken
    prompt.

    Walks the ``__cause__`` chain so a timeout wrapped by a client-specific
    wrapper is still recognised.
    """
    seen = 0
    cur: BaseException | None = exc
    while cur is not None and seen < 10:
        name = type(cur).__name__
        if any(marker in name for marker in _TIMEOUT_CLASS_MARKERS):
            return True
        cur = cur.__cause__ or cur.__context__
        seen += 1
    return False


def _is_vllm_input_overflow(exc: BaseException) -> bool:
    """True if `exc` represents a vLLM context-length rejection; False otherwise.

    Generous matcher: any text-shaped surface of the exception (str(), openai
    body dict, httpx response body, aiohttp message) containing one of the
    well-known vLLM/OpenAI context-overflow markers classifies as overflow.
    Generic `Exception` injections in tests still work because the test
    message contains the marker verbatim.
    """
    haystack = _overflow_message_from_exc(exc)
    if not haystack:
        return False
    return any(marker in haystack for marker in _VLLM_CONTEXT_OVERFLOW_MARKERS)


_dataprep_input_too_long_total = get_meter().create_counter(
    "rag.dataprep.input_too_long",
    description=(
        "Dataprep vLLM calls rejected because the prompt exceeded the model's "
        "max_model_len. Incremented instead of the generic error counter; surfaces "
        "silent-truncation regressions before they cascade into user-visible failure."
    ),
)

# Degradation counters. Every LLM phase here has a fallback that produces a
# usable document without the model, which is a feature for availability and a
# trap for observability: a document can end up labeled entirely from file
# labels while every log line looks like a success. These counters are the only
# way to see the degradation happen, since the fallback is a normal return path.
_meter = get_meter()

_dataprep_phase_budget_exhausted_total = _meter.create_counter(
    "rag.dataprep.phase_budget_exhausted",
    description=(
        "LLM phases abandoned because they exceeded DATAPREP_LLM_PHASE_TIMEOUT_SECONDS. "
        "The ingest continued on the phase's fallback, so this counts degraded "
        "documents, not failed ones. A non-zero rate on a healthy GPU means the "
        "per-request budget is too tight for the phase, not that the GPU is busy."
    ),
)

_llm_fallback_total = _meter.create_counter(
    "rag.dataprep.llm_fallback",
    description=(
        "LLM labeling/context batches that fell back to a cheaper path (per-chunk "
        "call, file labels, or raw chunk). Counts degradation events across both "
        "the per-batch and whole-phase paths, which the ingestion log alone cannot "
        "distinguish from ordinary progress. Correlates with phase_budget_exhausted "
        "via the same 'phase' label — both use PHASE_LABEL_*."
    ),
)

# Metric label vocabulary. Both counters stamp these slugs, so a query joining
# "how often did a phase blow its budget" to "how many batches fell back"
# correlates on one value set. The human-readable stage name that goes into the
# ingestion log is a separate argument — an operator-facing string has no
# business being a metrics dimension, and a display name reused as a label
# splits the join the moment one of them is reworded.
PHASE_LABEL_LABELING = "labeling"
PHASE_LABEL_CONTEXTUAL = "contextual"

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
from fastapi import HTTPException
from langchain_arangodb import ArangoGraph
from langchain_core.documents import Document
from langchain_text_splitters import (
    HTMLHeaderTextSplitter,
    MarkdownHeaderTextSplitter,
    RecursiveCharacterTextSplitter,
)
from numpy import dot
from numpy.linalg import norm
from openai import AsyncOpenAI
from pydantic import ValidationError  # Import Pydantic validation error
from rank_bm25 import BM25Okapi

logger = CustomLogger("GENIE_DATAPREP_ARANGODB")
setup_trace_logging("GENIE_DATAPREP_ARANGODB")
setup_json_logging("GENIE_DATAPREP_ARANGODB")
install_uvicorn_access_logging()
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

# --- Phase budgets -------------------------------------------------------
#
# The per-request budget (core/model_http_policy.py) bounds one HTTP call. This
# bounds the *phase* — every batch of that phase together. Both are needed:
# a phase with no bound is what turns a slow GPU into an unbounded stall, since
# a batch that fails only frees its slot after its own retry ladder finishes.
#
# A phase that exhausts its budget does not fail the ingest. Labeling degrades
# to file labels and Contextual Retrieval degrades to the raw chunk, which is
# exactly what a single batch failure already does — the phase bound only
# decides how long the document waits before taking the same path.
#
# Sized against what one *batch task* can occupy, because the unit the phase
# cancels is `_llm_suggest_labels` / the contextual equivalent, not an HTTP call.
# That task holds its semaphore slot across the batched call AND the per-chunk
# fallback it performs itself, so the ladder composes rather than picking one:
#
#   one batched HTTP call  (1 + LLM_MAX_RETRIES) x 180 =  540 s   no overlay loop
#   one per-chunk call      3 x (1 + LLM_MAX_RETRIES) x 180 = 1620 s  3 attempts
#   one batch task          540 + LABEL_LLM_BATCH_SIZE x 1620 = 7020 s at defaults
#
# 600 s therefore sits above a single batched call — a merely slow batch still
# gets to finish instead of being cut mid-call — and roughly a twelfth of one
# batch task. No per-request budget can stop a runaway batch task, which is why
# the phase bound exists at all: it fires while a straggler is still inside its
# own ladder, so the document degrades at 600 s instead of at an unbounded time.
#
# It is also a whole-phase ceiling, not a per-wave allowance: a 260-chunk
# document runs 65 batches in 4 waves of MAX_CONCURRENT_BATCHES, and all of them
# plus the queueing share the 600 s. A document large enough that its labelling
# would legitimately take longer than that is degraded to file labels — the
# phase does not scale its budget with the batch count. That is a deliberate
# ceiling, not an oversight: an unbounded budget is what produced the stall this
# replaces, and the degradation is visible (a WARN naming the phase, a
# phase_budget_exhausted counter) rather than silent. Raise the budget for
# deployments with large documents or slower models.
DATAPREP_LLM_PHASE_TIMEOUT_SECONDS = positive_float_env("DATAPREP_LLM_PHASE_TIMEOUT_SECONDS", default=600.0)
# How often a still-running phase reports progress to the ingestion log. The log
# is the only channel an operator watches during an ingest (the admin UI reads
# it), so a phase that is alive but slow has to say so — silence is what made
# the original stall undiagnosable.
DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS = positive_float_env("DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS", default=60.0)
# How long a cancelled batch is given to unwind before the phase gives up on it.
# Long enough for a cooperative cancellation to close its HTTP connection and
# free its semaphore slot; short enough that the phase bound stays the outer
# limit. A task that has not finished by then is abandoned, which is what the
# caller's fallback is for.
_PHASE_CANCEL_GRACE_SECONDS = 5.0

# Contextual Retrieval (Anthropic-style): per-chunk LLM-generated document
# context prepended to each chunk before embedding + labeling, so chunks carry
# document-level subject (fixes label/embedding context loss; see
# spec-contextual-retrieval.md). Default ON; set false to disable (no-op beyond
# skipping context gen). Adds one LLM call per chunk (concurrency-bounded) when
# enabled. Part B (retriever BM25 hybrid) is a separate spec.
# BREAKING CHANGE (v1.3 → v1.5): default changed from "false" to "true".
# Enables Contextual Retrieval (Anthropic-style) by default — adds one vLLM call
# per chunk at ingest (~20% slower, higher quality embeddings). Set to "false" to
# restore v1.3 behavior.
CONTEXTUAL_RETRIEVAL_ENABLED = os.getenv("CONTEXTUAL_RETRIEVAL_ENABLED", "true").lower() == "true"
# Model used for context generation. Empty → reuse VLLM_MODEL_ID (auto-detected
# on remote GPU nodes). Set to a smaller/cheaper model to cut context-gen cost.
DATAPREP_CONTEXTUAL_MODEL = os.getenv("DATAPREP_CONTEXTUAL_MODEL", "")
# Max chars of the joined document chunks fed to the context-generation LLM
# (bounds the prompt; ~1500 tokens). Filename + file_labels are always included.
DATAPREP_CONTEXTUAL_DOC_BUDGET = int(os.getenv("DATAPREP_CONTEXTUAL_DOC_BUDGET", "100000"))
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
CONTEXTUAL_STRATEGY = os.getenv("CONTEXTUAL_STRATEGY", "per_chunk").strip().lower() or "per_chunk"
# Decoupled mode: when true (default), label the RAW chunk and use the generated
# context ONLY for the embedding. Recommended — keeps label precision (the
# labeler sees the raw chunk) while propagating the document subject via the
# vector. When false, the context is fed to both embedding and labeling.
CONTEXTUAL_LABEL_RAW = os.getenv("CONTEXTUAL_LABEL_RAW", "true").lower() == "true"
# Max output tokens for the context-generation LLM calls (doc-level + per-chunk).
# The model writes a 50-100 word context (~196 tokens observed on large docs); the
# legacy hard cap of 200 left no headroom, so under concurrent vLLM load the JSON
# `{"context":"..."}` was truncated mid-string -> JSONDecodeError -> raw-chunk
# fallback. 512 gives comfortable margin at no extra cost (the model stops early).
CONTEXTUAL_MAX_TOKENS = int(os.getenv("DATAPREP_CONTEXTUAL_MAX_TOKENS", "512"))

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
    # Shared request budget (core/model_http_policy.py): the openai-python
    # defaults (600 s, 2 retries) let a heavily contended shared GPU stall
    # labeling/context batches for 10+ minutes with no feedback
    # (live-observed). Env-tunable deck-wide; the fallback chain (batch ->
    # per-chunk -> file labels) keeps ingestion alive either way.
    client = AsyncOpenAI(
        api_key=_api_key,
        base_url=f"{_vllm_endpoint}/v1",
        timeout=http_timeout(LLM_TIMEOUT_SECONDS),
        max_retries=LLM_MAX_RETRIES,
    )
    model = os.getenv("VLLM_MODEL_ID")
    if os.getenv("GPU_NODE_HOST"):
        detected = get_model_id(_vllm_endpoint)
        if detected:
            model = detected
            logger.info(f"Auto-detected remote vLLM model: {model}")
    if not model:
        raise RuntimeError("VLLM_MODEL_ID not set and auto-detection failed")
    return client, model


async def ensure_vector_index(
    collection,
    *,
    metric: str = "cosine",
    n_lists: int = 1,
    field: str = "embedding",
    graph_name: str | None = None,
    file_id: str | None = None,
    write_ingestion_log=None,
) -> str | None:
    """Idempotent, dim/metric/nLists-aware vector-index creation. Never raises.

    Closes the gap where langchain-arangodb would lazy-create an index with
    nLists=1 (defeats ANN) and silently skip dim-staleness when the embedder
    dimension changes (bge-base 768 -> bge-large 1024). See issue #1002.

    Decision matrix:
      - no vector index on `field`                     -> create at current dim
      - index exists, dim differs                      -> delete + recreate
      - index exists, dim matches, metric/nLists drift -> delete + recreate
      - index exists, dim + metric + nLists match      -> no-op (idempotent)
      - collection is empty                            -> INFO log, return None
      - sample document lacks valid embedding          -> ERROR log, return None
      - any add_index / delete_index exception         -> ERROR log, return None

    Note: `metric` is normalized to lowercase here (langchain-arangodb stores
    it lowercase). Pass either case; the helper reconciles.

    Note: this helper manages the index under the canonical langchain-arangodb
    name `vector_index` (its default `ArangoVector.vector_index_name`), so the
    retriever queries the SAME index the dataprep maintains. Older deployments
    that shipped the previous fix's `idx_embedding_<dim>` name are pruned as
    orphans so only `vector_index` remains.

    Known limitation: on heterogeneous-dim collections (partial bge-base→bge-large
    migration in progress), `collection.random()` may sample an outlier dim and
    flap the index across consecutive ingests. Workaround: complete the partial
    migration (re-ingest all old docs) before relying on auto-recreation. The
    common case — homogeneous-dim collections — is unaffected.
    """
    # Normalize metric at the helper boundary — matches langchain-arangodb's
    # internal DISTANCE_MAPPING (lowercase). Accepts both casings from callers.
    metric = metric.lower() if isinstance(metric, str) else metric

    with with_span(
        "dataprep.ensure_vector_index",
        attributes={"dataprep.graph_name": graph_name or ""},
    ) as span:
        try:
            if collection.count() == 0:
                if write_ingestion_log and file_id:
                    await _safe_log(
                        write_ingestion_log,
                        file_id,
                        "INFO",
                        "VectorIndex",
                        "Empty collection; skipping index ensure.",
                    )
                return None
            sample = collection.random()
            emb = sample.get(field)
            if not isinstance(emb, list) or len(emb) == 0:
                if write_ingestion_log and file_id:
                    await _safe_log(
                        write_ingestion_log,
                        file_id,
                        "ERROR",
                        "VectorIndex",
                        f"Sampled document lacks a valid `{field}` list; skipping.",
                    )
                return None
            dim = len(emb)
            desired_name = "vector_index"
            span.set_attribute("dataprep.index_dim", dim)
            span.set_attribute("dataprep.index_action", "skip")

            existing = collection.indexes()
            # The canonical `vector_index` is the langchain-arangodb default
            # (`ArangoVector.vector_index_name`) and the only index the
            # retriever queries.
            vec_idx = next(
                (
                    i
                    for i in existing
                    if i.get("name") == desired_name and i.get("type") == "vector" and field in i.get("fields", [])
                ),
                None,
            )

            def _build_index():
                return {
                    "name": desired_name,
                    "type": "vector",
                    "fields": [field],
                    "params": {"dimension": dim, "metric": metric, "nLists": n_lists},
                }

            if vec_idx is None:
                collection.add_index(_build_index())
                span.set_attribute("dataprep.index_action", "create")
                if write_ingestion_log and file_id:
                    await _safe_log(
                        write_ingestion_log,
                        file_id,
                        "INFO",
                        "VectorIndex",
                        f"Created {desired_name} (dim={dim}, metric={metric}, nLists={n_lists}).",
                    )
                return desired_name

            existing_dim = vec_idx.get("params", {}).get("dimension")
            if existing_dim != dim:
                collection.delete_index(vec_idx["name"])
                collection.add_index(_build_index())
                span.set_attribute("dataprep.index_action", "recreate")
                if write_ingestion_log and file_id:
                    await _safe_log(
                        write_ingestion_log,
                        file_id,
                        "INFO",
                        "VectorIndex",
                        f"Recreated index for dim {existing_dim} -> {dim} (name={desired_name}).",
                    )
                return desired_name

            params = vec_idx.get("params", {})
            existing_metric = (
                (params.get("metric") or "").lower() if isinstance(params.get("metric"), str) else params.get("metric")
            )
            if existing_metric != metric or params.get("nLists") != n_lists:
                # Metric/nLists are structural — ArangoDB cannot patch them in
                # place on an existing vector index; drop + recreate.
                collection.delete_index(vec_idx["name"])
                collection.add_index(_build_index())
                span.set_attribute("dataprep.index_action", "recreate")
                if write_ingestion_log and file_id:
                    await _safe_log(
                        write_ingestion_log,
                        file_id,
                        "INFO",
                        "VectorIndex",
                        f"Recreated index '{vec_idx['name']}' -> '{desired_name}' "
                        f"(metric/nLists drift: have={existing_metric}/{params.get('nLists')} "
                        f"want={metric}/{n_lists}).",
                    )
                return desired_name
            # Idempotent no-op.
            return vec_idx["name"]
        except Exception as e:
            if write_ingestion_log and file_id:
                await _safe_log(
                    write_ingestion_log,
                    file_id,
                    "ERROR",
                    "VectorIndex",
                    f"ensure_vector_index failed: {type(e).__name__}: {str(e)[:200]}",
                )
            return None


def _read_index_params():
    """Read RETRIEVER_ARANGO_{DISTANCE_STRATEGY,NUM_CENTROIDS} defensively.

    Returns (metric, n_lists). On invalid NUM_CENTROIDS, logs a WARNING and
    falls back to 1 (the legacy default). Never raises — a malformed env var
    must not crash ingest.
    """
    metric = os.getenv("RETRIEVER_ARANGO_DISTANCE_STRATEGY", "COSINE").lower()
    raw = os.getenv("RETRIEVER_ARANGO_NUM_CENTROIDS", "1")
    try:
        n_lists = int(raw)
    except ValueError:
        logger.warning(f"Invalid RETRIEVER_ARANGO_NUM_CENTROIDS={raw!r}; falling back to 1.")
        n_lists = 1
    return metric, n_lists


async def _safe_log(write_ingestion_log, file_id, level, component, message):
    """Write one ingestion-log row, swallowing any exception it raises.

    Critical: the helper must never let a logging failure escape. Every caller
    is inside the ingest path — `ensure_vector_index`, and the phase heartbeat
    and budget-exhaustion reports of both LLM phases — where a propagated
    backend HTTP timeout would be caught by the outer except in
    `ingest_file_with_guardrail`, triggering `retract_file()` and DELETING
    already-committed chunks. Visibility loss on logs is acceptable; data
    loss is not.
    """
    if not write_ingestion_log or not file_id:
        return
    try:
        await write_ingestion_log(file_id, level, component, message)
    except Exception as e:
        logger.error(
            f"_write_ingestion_log failed while reporting {component!r}: "
            f"{type(e).__name__}: {str(e)[:200]} (message was: {message[:100]})"
        )


async def _gather_with_phase_budget(
    tasks: list, *, phase: str, phase_label: str, total: int, file_id: str, write_ingestion_log
) -> tuple[list, bool]:
    """Run *tasks* concurrently under a wall-clock bound, reporting progress.

    Returns ``(results, timed_out)``. On timeout the batches that already
    finished are returned, the rest are cancelled, and the caller maps
    ``timed_out`` onto whatever its phase falls back to.

    ``asyncio.gather`` cannot do this job. It carries no wall-clock bound of its
    own — each task is bounded only by its own client timeout and retry ladder,
    so on a contended endpoint the phase waits for its slowest task however long
    that task has been running. It also yields nothing until every task is done,
    which is what made a live ingest indistinguishable from a hung one: the
    progress log that would have shown movement sat *after* the gather and was
    never reached.

    Progress is reported on a timer rather than per completion. A completion
    counter floods the ingestion log on a fast phase (one line per batch, 65 for
    a 260-chunk document) while a slow phase still needs a heartbeat; a timer
    costs one line per interval whatever the throughput.
    """
    if not tasks:
        return [], False

    started = time.monotonic()
    # Wrapped in submission order so a failed batch can be picked
    # deterministically: asyncio.wait hands back a set, and iterating one would
    # make "which exception aborts the ingest" depend on set ordering.
    ordered = [asyncio.ensure_future(t) for t in tasks]
    order = {id(task): n for n, task in enumerate(ordered)}
    pending = set(ordered)
    results: list = []
    interval = DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS
    next_report = started + interval
    # A task that raised, held until the in-flight set is settled. Re-raising it
    # has to happen AFTER the cancel-and-settle below, not at the point it was
    # noticed: raising first would leave every sibling task running, holding its
    # semaphore slot and its open HTTP connection until its own retry ladder
    # finished — so one bad batch would stall the fallback that was about to
    # run for it.
    failure: BaseException | None = None
    abandoned = 0

    try:
        while pending:
            # Wait on whichever deadline comes first, so a progress tick is
            # never held behind the phase deadline. When the remaining budget is
            # the shorter of the two, this single wait IS the phase deadline —
            # which is why the reporting below forces a tick whenever
            # remaining_phase <= 0 rather than relying on the interval alone.
            remaining_phase = DATAPREP_LLM_PHASE_TIMEOUT_SECONDS - (time.monotonic() - started)

            settled = {t for t in pending if t.done()}
            pending -= settled
            if settled:
                done = settled
            else:
                # FIRST_COMPLETED is stated explicitly: on this interpreter the
                # implicit default over a task set does NOT return as soon as
                # one task finishes, it waits out the whole timeout. That would
                # make a phase whose first batch fails early sit idle until its
                # budget elapsed before surfacing the error — the exact stall
                # the bound exists to prevent, one error path later.
                done, pending = await asyncio.wait(
                    pending,
                    timeout=max(min(interval, remaining_phase), 0.01),
                    return_when=asyncio.FIRST_COMPLETED,
                )
                # Recomputed, not carried over: the wait, and the heartbeat
                # write inside the branch below it, both consume wall clock, so
                # the value from before the wait understates how much of the
                # budget is gone. Using it to decide whether to report and
                # whether to break lets the phase overshoot its own deadline by
                # up to one tick, which is the difference between a bound and
                # an approximation of one.
                remaining_phase = DATAPREP_LLM_PHASE_TIMEOUT_SECONDS - (time.monotonic() - started)

            for task in sorted(done, key=lambda t: order[id(t)]):
                # Propagate a raised task exactly as gather would — but record it
                # and keep draining the loop first, so the settle-and-cancel in
                # the finally block runs before it escapes. Iterating the set
                # asyncio.wait returns would pick an arbitrary member, so which
                # of two differently-failing batches decides whether the ingest
                # aborts or degrades would change run to run.
                exc = task.exception()
                if exc is not None:
                    if failure is None:
                        failure = exc
                    continue
                results.append(task.result())

            # Stop collecting once a batch has failed, the way gather would:
            # the phase is going to raise, so the remaining batches' results
            # would be discarded anyway and waiting for them only delays the
            # error by up to the whole budget. The finally block cancels them.
            if failure is not None:
                break

            # Report BEFORE the budget check. The wait ran for
            # min(interval, remaining_phase), so if the operator set an interval
            # at or above the budget the phase ends on this tick — and a check
            # placed after the break would leave the final tick unreported,
            # i.e. an operator who raised the interval to quiet a busy log
            # would get silence for the whole phase instead.
            now = time.monotonic()
            # Report when the reporting interval has elapsed OR the phase is
            # about to give up — the second clause is what keeps an interval
            # set above the budget from silencing the phase, since in that case
            # the single wait consumed the whole budget and the interval never
            # elapsed on its own.
            out_of_time = now >= next_report or remaining_phase <= 0
            if pending and out_of_time:
                next_report = now + interval
                message = (
                    f"{phase} in progress: {len(results)}/{total} batches completed, "
                    f"{len(pending)} in flight, {now - started:.0f}s elapsed "
                    f"(budget {DATAPREP_LLM_PHASE_TIMEOUT_SECONDS:g}s)"
                )
                logger.info(message)
                await _safe_log(write_ingestion_log, file_id, "INFO", phase, message)
                # Same reason as after the wait above: the write is a full
                # ingestion-log round trip, and on a slow backend it can be the
                # longest thing in the tick. Testing the deadline against the
                # value from before it lets the phase run another whole tick
                # past its budget.
                remaining_phase = DATAPREP_LLM_PHASE_TIMEOUT_SECONDS - (time.monotonic() - started)

                # The log write yields the event loop for a full ingestion-log
                # round trip. A batch that answers during it holds a complete
                # result, and discarding it would report the phase as having
                # lost work the LLM actually did — pointing the operator at GPU
                # contention instead of at the budget. Drain what settled.
                late = {t for t in pending if t.done()}
                pending -= late
                for task in sorted(late, key=lambda t: order[id(t)]):
                    exc = task.exception()
                    if exc is not None:
                        if failure is None:
                            failure = exc
                        continue
                    results.append(task.result())

                if failure is not None:
                    # A failure seen here must end the loop exactly as one seen
                    # in the main drain does. Falling through would park the
                    # remaining batches in asyncio.wait for a whole progress
                    # interval before the finally cancels them — holding their
                    # semaphore slots and connections while the fallback that
                    # was about to run for the failed batch waits behind them.
                    break

            if not pending or remaining_phase <= 0:
                break

        # Tasks still in flight at the deadline — not a raised batch, the phase
        # simply outran its budget.
        abandoned = len(pending)
    finally:
        # Cancel whatever is still running — on the timeout path AND on the
        # error path — so no task outlives this call holding a semaphore slot.
        if pending:
            for task in pending:
                task.cancel()
            # Bounded settle. An unbounded gather here would make the phase
            # bound advisory: a task sitting in a non-cancellable await (a
            # thread offload, a client swallowing CancelledError) never
            # completes, so the gather never returns and the caller waits past
            # its budget anyway — the exact unbounded stall this helper exists
            # to end. Waiting briefly lets well-behaved tasks release their slot
            # and their connection; anything still stuck is abandoned, and the
            # caller gets its fallback.
            await asyncio.wait(pending, timeout=_PHASE_CANCEL_GRACE_SECONDS)
            # Retrieve whatever finished during the settle. A task that turned
            # its cancellation into a real exception — a client catching
            # CancelledError, or a typed failure raised between the last drain
            # and the cancel — would otherwise surface as "Task exception was
            # never retrieved" with a full traceback, noise landing in the
            # dataprep log during exactly the contended-GPU incidents this work
            # exists to make diagnosable. gather retrieved every child; this
            # restores that without giving up the bounded settle.
            for task in pending:
                if task.done() and not task.cancelled():
                    with suppress(Exception):
                        task.exception()

    if failure is not None:
        # A batch that raised is an error the phase's caller already knows how
        # to fall back from; swallowing it here would turn a visible failure
        # into a silently degraded document.
        raise failure

    if abandoned:
        _dataprep_phase_budget_exhausted_total.add(1, {"phase": phase_label})
        # Seconds render with one decimal: an integer format renders a
        # sub-second budget as "0s", which reads as a misconfiguration rather
        # than the fast test deadline it is.
        message = (
            f"{phase} exceeded its {DATAPREP_LLM_PHASE_TIMEOUT_SECONDS:g}s budget after "
            f"{time.monotonic() - started:.1f}s: {len(results)}/{total} batches completed, "
            f"{abandoned} abandoned. Falling back for the remaining batches."
        )
        logger.warning(message)
        await _safe_log(write_ingestion_log, file_id, "WARN", phase, message)
        return results, True

    return results, False


async def _await_with_heartbeat(tasks: list, *, phase: str, total: int, file_id: str, write_ingestion_log) -> None:
    """Wait for every task, reporting progress as they settle.

    The counterpart to ``_gather_with_phase_budget`` for a phase that has no
    fallback: it has the same reporting but no deadline, because the only way to
    bound a phase is to give up on part of it and this phase cannot lose work
    without losing documents. Errors propagate as ``asyncio.gather`` raises them
    (first failure wins), so the caller's existing error handling still applies.

    Every exit other than the success path takes the still-pending batches with
    it, by cancelling them and giving ``_PHASE_CANCEL_GRACE_SECONDS`` to settle.
    That matters because the caller retracts the document on every one of those
    exits: a batch still running writes into ArangoDB after ``retract_file`` has
    deleted it, resurrecting chunks for a document the admin UI shows as failed.

    Cancelling does not stop a batch already inside ``asyncio.to_thread`` — the
    thread runs to completion either way, and that race is pre-existing and
    documented at the call site. What it does stop is every batch still queued
    on ``MAX_CONCURRENT_BATCHES``, which for a large document is most of them:
    they have not reached the thread and would otherwise write the whole
    document after the retraction. So the grace window is a courtesy for batches
    that unwind promptly, not a licence to abandon the rest.
    """
    if not tasks:
        return

    started = time.monotonic()
    interval = DATAPREP_LLM_PROGRESS_INTERVAL_SECONDS
    next_report = started + interval
    pending = set(tasks)
    # Submission order, for the same reason as the budgeted variant: the set
    # asyncio.wait returns has no order, and which failing batch decides the
    # ingest's outcome must not depend on it.
    order = {id(task): n for n, task in enumerate(tasks)}
    completed = 0
    failure: BaseException | None = None

    try:
        while pending:
            settled = {t for t in pending if t.done()}
            pending -= settled
            if not settled:
                done, pending = await asyncio.wait(pending, timeout=interval, return_when=asyncio.FIRST_COMPLETED)
                settled = done
            for task in sorted(settled, key=lambda t: order[id(t)]):
                # Re-raise the first failure, as gather would. Done before any
                # further reporting so the phase fails on the real error rather than
                # on the heartbeat's log write.
                exc = task.exception()
                completed += 1
                if exc is not None and failure is None:
                    failure = exc

            if failure is not None:
                # Give the in-flight batches a bounded window to unwind rather than
                # dropping them on the floor. asyncio.gather keeps every child alive
                # and retrieves their outcomes; returning here would leave the rest
                # running with no owner — each one that later raises logs an
                # unretrieved-exception error, and they are still writing to ArangoDB
                # while the caller's handler retracts the document. The wait is
                # capped at _PHASE_CANCEL_GRACE_SECONDS: past that, the caller is
                # already failing and a longer wait only delays the retract.
                #
                # Cancelled, not just waited on. The caller retracts the document
                # the moment this raises, so a sibling left running writes into
                # ArangoDB after the retraction and resurrects its chunks — the
                # same outcome the cancellation path guards against, one branch
                # over. Batches already inside asyncio.to_thread are unaffected
                # either way; the ones this stops are those still queued on the
                # semaphore, which for a large document is most of them.
                #
                # Guarded because pending is empty whenever the failing task was the
                # last one in flight, and asyncio.wait() on an empty set raises
                # ValueError rather than returning. That is the single-batch case —
                # a document with fewer chunks than BATCH_SIZE produces exactly one
                # graph-insertion task — and unguarded it replaced the real
                # "ArangoDB insert failed" with "Set of Tasks/Futures is empty" in
                # the ingestion log and the document status, which is the last
                # diagnostic channel the operator has.
                for task in pending:
                    task.cancel()
                if pending:
                    await asyncio.wait(pending, timeout=_PHASE_CANCEL_GRACE_SECONDS)
                # Same retrieval as the budgeted variant's settle: a sibling that
                # failed while we were waiting would otherwise log an unretrieved
                # exception, during an incident whose diagnosis depends on these
                # logs.
                for task in pending:
                    if task.done() and not task.cancelled():
                        with suppress(Exception):
                            task.exception()
                raise failure

            now = time.monotonic()
            if pending and now >= next_report:
                next_report = now + interval
                message = (
                    f"{phase} in progress: {completed}/{total} batches completed, "
                    f"{len(pending)} in flight, {now - started:.0f}s elapsed"
                )
                logger.info(message)
                await _safe_log(write_ingestion_log, file_id, "INFO", phase, message)

    except asyncio.CancelledError:
        # Every exit other than the success path has to take the still-pending
        # batches with it, because the caller is retracted either way.
        # asyncio.gather, which this helper replaced, did that implicitly by
        # cancelling its children; a bare `while pending` loop does not, so an
        # external cancellation — ingest_file_with_guardrail's kill switch, or
        # a service shutdown — propagated straight out and left every queued
        # graph batch running. They were parked on the semaphore at that point,
        # so they would acquire it and write the whole document to ArangoDB
        # AFTER retract_file() had already deleted it: chunks resurrected for a
        # document the admin UI shows as Killed, and served to the retriever.
        for task in pending:
            task.cancel()
        if pending:
            await asyncio.wait(pending, timeout=_PHASE_CANCEL_GRACE_SECONDS)
            for task in pending:
                if task.done() and not task.cancelled():
                    with suppress(Exception):
                        task.exception()
        raise


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

    def _initialize_client(self):
        """Override the OPEA parent's DB selection with the GENIE convention.

        The parent reads the module-level ``ARANGO_DB_NAME`` (default ``_system``);
        GENIE uses ``ARANGO_DB`` (default ``genie-ai``) so dataprep and retriever
        target the SAME database for RAG retrieval. This replaces the former
        import-time ``_parent_mod.ARANGO_DB_NAME = ...`` monkeypatch (Story 1.4
        pre-rebase cleanup) with a subclass override — no module mutation.

        The parent's own defaults are preserved for the connection params it
        reads: ``ARANGO_URL`` (``http://localhost:8529``), ``ARANGO_USERNAME``
        (``root``), ``ARANGO_PASSWORD`` (``test``). Only the DB name follows the
        GENIE convention (``ARANGO_DB`` → ``ARANGO_DB_NAME`` → ``genie-ai``),
        matching the retriever's default so both target the same database.
        """
        with background_span("dataprep.initialize_client"):
            # GENIE convention: ARANGO_DB wins, falls back to ARANGO_DB_NAME,
            # then genie-ai (same default as the retriever).
            db_name = os.getenv("ARANGO_DB", os.getenv("ARANGO_DB_NAME", "genie-ai"))

            import arango

            self.client = arango.ArangoClient(hosts=os.getenv("ARANGO_URL", "http://localhost:8529"))
            sys_db = self.client.db(
                name="_system",
                username=os.getenv("ARANGO_USERNAME", os.getenv("ARANGO_USER", "root")),
                password=os.getenv("ARANGO_PASSWORD", "test"),
                verify=True,
            )

            if not sys_db.has_database(db_name):
                sys_db.create_database(db_name)

            self.db = self.client.db(
                name=db_name,
                username=os.getenv("ARANGO_USERNAME", os.getenv("ARANGO_USER", "root")),
                password=os.getenv("ARANGO_PASSWORD", "test"),
                verify=True,
            )

    def _log_environment_variables(self):
        """Debug: Print all critical environment variables at startup."""
        with background_span("dataprep.log_environment_variables"):
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
                # Patch the parent module constant (captured at parent import
                # time — os.environ alone does not update it). The parent reads
                # VLLM_MODEL_ID as a module constant, so this reassignment is
                # the runtime mechanism for remote-model auto-detection.
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
                aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=CONTROL_PLANE_TIMEOUT_SECONDS)) as session,
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
                aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=CONTROL_PLANE_TIMEOUT_SECONDS)) as session,
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
                aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=CONTROL_PLANE_TIMEOUT_SECONDS)) as session,
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
        elif path.endswith(".md"):
            # Section-aware markdown chunking: split on H1-H4 headers, then cap
            # each section at chunk_size with intra-section overlap. The
            # section path is prepended to each chunk so the LLM labeler (and
            # any downstream retrieval) sees the heading context.
            md_splitter = MarkdownHeaderTextSplitter(
                headers_to_split_on=[
                    ("#", "Header 1"),
                    ("##", "Header 2"),
                    ("###", "Header 3"),
                    ("####", "Header 4"),
                ],
                strip_headers=True,
            )
            char_splitter = RecursiveCharacterTextSplitter(
                chunk_size=doc_path.chunk_size,
                chunk_overlap=doc_path.chunk_overlap,
                add_start_index=True,
                separators=get_separators(),
            )

            def _split_md(text: str) -> list[str]:
                if not text:
                    return []
                md_docs = md_splitter.split_text(text)
                docs = char_splitter.split_documents(md_docs)
                out = []
                for d in docs:
                    # Filter to str values: add_start_index on the char splitter
                    # injects an int offset into Document.metadata, which would
                    # crash a naive " > ".join(...) prefix.
                    header_parts = [v for v in d.metadata.values() if isinstance(v, str)]
                    path_label = " > ".join(header_parts) if header_parts else ""
                    if path_label:
                        out.append(f"## {path_label}\n\n{d.page_content}")
                    else:
                        out.append(d.page_content)
                return out

            with tracer.start_as_current_span("dataprep.chunking") as span:
                if isinstance(content, list):
                    plain_chunks = []
                    for item in content:
                        plain_chunks.extend(_split_md(str(item)))
                else:
                    plain_chunks = _split_md(content)
                valid_chunks = [c for c in plain_chunks if is_valid_content(c)]
                span.set_attribute("dataprep.chunk_count", len(valid_chunks))
            return valid_chunks
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

        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=CONTROL_PLANE_TIMEOUT_SECONDS)) as session:
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

        partial_maps, timed_out = await _gather_with_phase_budget(
            [_process_batch(b) for b in batches],
            phase="LLM labeling",
            phase_label=PHASE_LABEL_LABELING,
            total=len(batches),
            file_id=file_id,
            write_ingestion_log=self._write_ingestion_log,
        )

        # Every batch that finished under the budget returns a complete map for
        # all of its chunks, so those suggestions are kept — an abandoned batch
        # contributes nothing, and its chunks fall through to the file-label
        # fallback in _finalize_chunk_labels exactly as they would if that one
        # batch had failed on its own. Counted here so a budget-driven
        # degradation shows up in metrics the same way a per-batch one does.
        if timed_out:
            _llm_fallback_total.add(
                len(batches) - len(partial_maps), {"phase": PHASE_LABEL_LABELING, "reason": "phase_budget"}
            )

        suggested_map: dict[int, list[str]] = {}
        for partial in partial_maps:
            suggested_map.update(partial)

        # Resolve suggestions against the taxonomy (exact + synonym match) and
        # emit a single consolidated ingestion-log entry per chunk.
        results = []
        total = len(indexed)
        for n, (i, text) in enumerate(indexed, 1):
            labels = await self._finalize_chunk_labels(i, suggested_map.get(i, []), all_labels, file_id, file_labels)
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

        partial_contexts, timed_out = await _gather_with_phase_budget(
            [_process_batch(b) for b in batches],
            phase="Contextual Retrieval",
            phase_label=PHASE_LABEL_CONTEXTUAL,
            total=len(batches),
            file_id=file_id,
            write_ingestion_log=self._write_ingestion_log,
        )
        if timed_out:
            _llm_fallback_total.add(
                len(batches) - len(partial_contexts), {"phase": PHASE_LABEL_CONTEXTUAL, "reason": "phase_budget"}
            )

        contexts: dict[int, str] = {}
        for partial in partial_contexts:
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
            raw_count = total - with_context
            # Final post-recovery count: with_context chunks have a non-empty context
            # (batched or recovered via per-chunk calls). The remaining raw_count
            # chunks fell back to raw text because BOTH the batch parse AND the
            # per-chunk recovery returned empty (after 3 retries each). This is NOT
            # the per-batch "missing" count — partials are already recovered here.
            logger.info(
                f"Contextual Retrieval: {with_context}/{total} chunks contextualized "
                f"({raw_count} using raw text after batch + per-chunk recovery failed)."
            )
        return result

    async def _context_batch_call(self, client, model, system_prompt, batch, file_id) -> dict[int, str]:
        """One LLM call generating contexts for a batch of chunks.

        Returns ``{chunk_index: context}``. On a parse failure the whole batch
        falls back to per-chunk ``_context_single_call``. On a PARTIAL response
        (the LLM returned some but not all chunk contexts — common with
        temperature-sampled models that skip entries nondeterministically),
        the missing chunk indices are recovered via per-chunk calls so no chunk
        silently degrades to raw text. Emits a ``dataprep.llm.context_batch``
        span (per-chunk spans on fallback).
        """
        valid_ids = {i for i, _ in batch}
        if len(batch) > 1:
            with background_span(
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
                        max_tokens=CONTEXTUAL_MAX_TOKENS * len(batch),
                        response_format={"type": "json_object"},
                    )
                    parsed = json.loads(response.choices[0].message.content)
                    raw = parsed.get("contexts", parsed) if isinstance(parsed, dict) else {}
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
                        # Recover any chunks the LLM omitted (partial response).
                        # Without this, missing indices silently degrade to raw
                        # text — the batch "succeeded" so no fallback fired, but
                        # some chunks lost their context. Recover them explicitly.
                        missing = [i for i in valid_ids if i not in out]
                        if missing:
                            span.set_attribute("dataprep.partial_recovery_count", len(missing))
                            await self._write_ingestion_log(
                                file_id,
                                "INFO",
                                "Contextualization",
                                f"Batch returned {len(out)}/{len(batch)} contexts; "
                                f"recovering missing chunks {sorted(missing)} via per-chunk calls.",
                            )
                            for i in missing:
                                text = next(t for idx, t in batch if idx == i)
                                out[i] = await self._context_single_call(client, model, system_prompt, i, text, file_id)
                        return out
                    await self._write_ingestion_log(
                        file_id,
                        "WARN",
                        "Contextualization",
                        f"Batch context parse failure for chunks {[i for i, _ in batch]}; falling back to per-chunk.",
                    )
                    _llm_fallback_total.add(1, {"phase": PHASE_LABEL_CONTEXTUAL, "reason": "batch_parse"})
                except Exception as e:
                    err = f"{type(e).__name__}: {str(e)[:200]}"
                    if _is_vllm_input_overflow(e):
                        _dataprep_input_too_long_total.add(1, {"dataprep.call_site": "context_batch"})
                        with suppress(Exception):
                            span.set_attribute("dataprep.input_too_long", True)
                        await self._write_ingestion_log(
                            file_id,
                            "ERROR",
                            "Contextualization",
                            f"Batch context vLLM context overflow ({err}). Aborting.",
                        )
                        raise DataprepInputTooLongError(f"vLLM context overflow at context_batch: {err}") from e
                    logger.warning(f"Batch context failed {[i for i, _ in batch]}: {err}; falling back to per-chunk.")
                    if _is_timeout(e):
                        with suppress(Exception):
                            span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timed_out"], True)
                            span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timeout_seconds"], LLM_TIMEOUT_SECONDS)
                    _llm_fallback_total.add(1, {"phase": PHASE_LABEL_CONTEXTUAL, "reason": "batch_error"})
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
            with background_span(
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
                        max_tokens=CONTEXTUAL_MAX_TOKENS,
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
                    if _is_vllm_input_overflow(e):
                        _dataprep_input_too_long_total.add(1, {"dataprep.call_site": "context_doc"})
                        with suppress(Exception):
                            span.set_attribute("dataprep.input_too_long", True)
                        await self._write_ingestion_log(
                            file_id,
                            "ERROR",
                            "Contextualization",
                            f"Doc-level context vLLM context overflow ({err}). Aborting.",
                        )
                        raise DataprepInputTooLongError(f"vLLM context overflow at context_doc: {err}") from e
                    logger.warning(f"Doc-level context attempt {attempt}/3 failed: {err}")
                    if _is_timeout(e):
                        with suppress(Exception):
                            span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timed_out"], True)
                            span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timeout_seconds"], LLM_TIMEOUT_SECONDS)
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
        _llm_fallback_total.add(1, {"phase": PHASE_LABEL_CONTEXTUAL, "reason": "doc_level_raw"})
        return ""

    async def _context_single_call(self, client, model, system_prompt, index: int, text: str, file_id: str) -> str:
        """One LLM call generating the context for a single chunk (3 retries).

        Returns the context string, or "" if all attempts fail (caller falls
        back to the raw chunk). Emits a ``dataprep.llm.context_chunk`` span.
        """
        for attempt in range(1, 4):
            with background_span(
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
                        max_tokens=CONTEXTUAL_MAX_TOKENS,
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
                    if _is_vllm_input_overflow(e):
                        _dataprep_input_too_long_total.add(1, {"dataprep.call_site": "context_single"})
                        with suppress(Exception):
                            span.set_attribute("dataprep.input_too_long", True)
                        await self._write_ingestion_log(
                            file_id,
                            "ERROR",
                            "Contextualization",
                            f"Chunk {index}: context vLLM context overflow ({err}). Aborting.",
                        )
                        raise DataprepInputTooLongError(f"vLLM context overflow at context_single: {err}") from e
                    logger.warning(f"Chunk {index}: context attempt {attempt}/3 failed: {err}")
                    if _is_timeout(e):
                        with suppress(Exception):
                            span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timed_out"], True)
                            span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timeout_seconds"], LLM_TIMEOUT_SECONDS)
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
        _llm_fallback_total.add(1, {"phase": PHASE_LABEL_CONTEXTUAL, "reason": "raw_chunk"})
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
                # _llm_call_batch already counted the failure (parse or call) —
                # it swallows both and returns None, so nothing reaches the
                # handlers below for a failed call.
                # Wording is a published contract: this substring is listed in
                # site/content/en/docs/operate/ingestion-log.md as one of the
                # "canonical messages you will grep for", with the guided-JSON
                # remedy attached. Renaming it here silently breaks the
                # runbook, so the doc moves with the string, not the reverse.
                await self._write_ingestion_log(
                    file_id,
                    "WARN",
                    "Labeling",
                    f"Batch labeling parse failure for chunks {[i for i, _ in batch]}; falling back to per-chunk.",
                )
            except DataprepInputTooLongError:
                # Fail-loud: batch prompt is structurally too long; retrying with
                # the same oversized prompt in the per-chunk fallback would either
                # (a) succeed only if the per-chunk prompt is small enough (rare)
                # or (b) call vLLM with the same identical oversized text and fail
                # again — wasting a batch call + 0..N per-chunk calls. Skip the
                # batch-level retry path entirely; the per-chunk call sites will
                # raise the same typed exception cleanly when they hit the cap.
                raise
            except Exception as e:
                # Reached only for a failure _llm_call_batch did not handle —
                # it is the last resort before per-chunk, not the common path.
                # No counter here on purpose: _llm_call_batch swallows every
                # failure it sees and returns None, so this handler only runs
                # for an exception raised outside its own try, and a counter
                # there would report a permanently-zero label that reads as
                # "no batch errors ever happen".
                err = f"{type(e).__name__}: {str(e)[:200]}"
                batch_indices = [i for i, _ in batch]
                await self._write_ingestion_log(
                    file_id,
                    "WARN",
                    "Labeling",
                    f"Batch labeling call failed for chunks {batch_indices} ({err}); falling back to per-chunk.",
                )
        # Per-chunk path (default, and batch fallback for transient/non-overflow errors).
        out: dict[int, list[str]] = {}
        for i, text in batch:
            out[i] = await self._llm_call_single(client, model, system_prompt, i, text, file_id, file_labels)
        return out

    async def _llm_call_single(self, client, model, system_prompt, index, text, file_id, file_labels) -> list[str]:
        """One LLM call for a single chunk with up to 3 retries. Emits an OTel span."""
        for attempt in range(1, 4):
            with background_span(
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
                    # Fail-loud on vLLM context overflow: the prompt is structurally too
                    # long; retrying with the identical oversized prompt would yield the
                    # same 400. Raise the typed exception so the ingest task records the
                    # failure via _write_ingestion_log (admin /api/admin/ingestion-log
                    # channel) instead of silently ingesting a degraded chunk.
                    if _is_vllm_input_overflow(e):
                        _dataprep_input_too_long_total.add(1, {"dataprep.call_site": "llm_call_single"})
                        with suppress(Exception):
                            span.set_attribute("dataprep.input_too_long", True)
                        await self._write_ingestion_log(
                            file_id,
                            "ERROR",
                            "Labeling",
                            f"Chunk {index}: vLLM context overflow ({err}). "
                            f"Prompt exceeds model max_model_len; aborting this chunk.",
                        )
                        raise DataprepInputTooLongError(f"vLLM context overflow on chunk {index}: {err}") from e
                    logger.warning(f"Chunk {index}: LLM label attempt {attempt}/3 failed: {err}")
                    # A timeout is the failure this deck is budgeted against, and
                    # the one that says nothing useful unless it is labelled:
                    # the span otherwise closes with no tokens, no duration
                    # reason and no status, which is indistinguishable from a
                    # call that is still in flight.
                    if _is_timeout(e):
                        with suppress(Exception):
                            span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timed_out"], True)
                            span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timeout_seconds"], LLM_TIMEOUT_SECONDS)
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
        _llm_fallback_total.add(1, {"phase": PHASE_LABEL_LABELING, "reason": "file_labels"})
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
        with background_span(
            "dataprep.llm.label_batch",
            attributes={
                "dataprep.llm_batched": True,
                "dataprep.llm_batch_size": len(batch),
                "dataprep.llm_model": model or "",
                # A native OTel array, not str(indices): the vocabulary requires
                # flat scalar sequences to be emitted as arrays, and the string
                # form ("[0, 3, 7]") carries separators that read as prose to the
                # span privacy sweep.
                "dataprep.chunk_indices": indices,
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
                    _llm_fallback_total.add(1, {"phase": PHASE_LABEL_LABELING, "reason": "batch_parse"})
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
                if _is_vllm_input_overflow(e):
                    _dataprep_input_too_long_total.add(1, {"dataprep.call_site": "llm_call_batch"})
                    with suppress(Exception):
                        span.set_attribute("dataprep.input_too_long", True)
                    await self._write_ingestion_log(
                        file_id,
                        "ERROR",
                        "Labeling",
                        f"Batch labeling vLLM context overflow ({err}). Aborting.",
                    )
                    raise DataprepInputTooLongError(f"vLLM context overflow at llm_call_batch: {err}") from e
                # The batched call IS the path that stalls in practice (a
                # 260-chunk document issues 65 of them), so the timeout marker
                # belongs here as much as on the per-chunk call. Without it this
                # span closes with no tokens and no status — indistinguishable
                # from one still in flight.
                if _is_timeout(e):
                    with suppress(Exception):
                        span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timed_out"], True)
                        span.set_attribute(ATTRIBUTE_NAMES["dataprep_llm_timeout_seconds"], LLM_TIMEOUT_SECONDS)
                await self._write_ingestion_log(
                    file_id,
                    "WARN",
                    "Labeling",
                    f"Batch labeling call failed for chunks {indices} ({err}); returning None for per-chunk fallback.",
                )
                # Counted here, not in the caller: this function swallows every
                # failure and returns None, so the caller's own error handler
                # never runs for a call that failed — only for one whose parse
                # failed. Counting there would leave batch_error permanently
                # zero and file every timeout under batch_parse, which is the
                # opposite of what an operator querying a contended GPU needs to
                # see.
                _llm_fallback_total.add(1, {"phase": PHASE_LABEL_LABELING, "reason": "batch_error"})
                return None

    async def _finalize_chunk_labels(self, index, suggested, all_labels, file_id, file_labels=None) -> list[str]:
        """Resolve raw LLM suggestions against the taxonomy, then scope to the document.

        Suggestions are first canonicalised against the full taxonomy (exact +
        synonym match). The LLM is prompted with the full taxonomy, so it may
        suggest labels that are valid taxonomy entries but outside the document's
        scope (e.g. a sibling crop on a single-crop guide). ``file_labels`` defines
        the eligible scope: any resolved label not in ``file_labels`` is dropped
        before storage. When ``file_labels`` is empty, no scoping is applied
        (preserves the legacy taxonomy-validated behaviour and avoids dropping
        every label on documents without a scope).

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
        # Scope to the document's file_labels: drop taxonomy-valid labels that
        # fall outside the document's scope (e.g. sibling crops on a single-crop
        # guide). Skipped when file_labels is empty so documents without a scope
        # keep all taxonomy-validated labels.
        dropped = []
        if file_labels:
            scope = set(file_labels)
            dropped = [l for l in labels_list if l not in scope]
            labels_list = [l for l in labels_list if l in scope]

        level = "INFO"
        msg = f"Chunk {index}: Final labels ({len(labels_list)}): {labels_list}."
        if dropped:
            msg += f" Dropped (out of document scope): {dropped}."
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
            with background_span("dataprep.ingest.background"):
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

                    await self._write_ingestion_log(
                        input.file_id, "INFO", "Chunking", f"Generated {len(chunks)} chunks."
                    )

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
                    # Decoupled mode (CONTEXTUAL_LABEL_RAW, default true): label the
                    # RAW chunk (the context prefix distorts labeling — over/under-
                    # label) and use the contextualized text ONLY for the embedding.
                    # When false, the context is fed to both (label contextualized).
                    label_input = original_chunks if CONTEXTUAL_LABEL_RAW else contextualized
                    labelled_docs = await self._apply_labels(label_input, all_labels, file_labels, input.file_id)

                    # 5. Graph Insertion (BATCHED & CONCURRENT)
                    # BREAKING CHANGE (v1.3 → v1.5): default changed from "genie_graph" to "GRAPH".
                    # Existing deployments with graph name "genie_graph" must set ARANGO_GRAPH_NAME=genie_graph
                    # in .env to restore v1.3 behavior, otherwise retract_file() will fail.
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
                            self._process_batch(
                                batch_docs, current_batch_num, total_batches, input, graph_name, semaphore
                            )
                        )
                        tasks.append(task)

                    # Wait for all batches to complete
                    #
                    # Not run through _gather_with_phase_budget, unlike the two
                    # LLM phases above. That helper cancels stragglers on its
                    # deadline, which is only safe because the labeling and
                    # context phases have a fallback that turns an abandoned
                    # batch into a degraded-but-present result. This phase has
                    # none: a cancelled batch loses its chunks outright and the
                    # ingest still ends "Ingested" — silently dropping documents
                    # from the knowledge graph is strictly worse than a slow one.
                    # So this phase is unbounded, but it still HEARTBEATS, because a
                    # wedged graph phase is just as silent as the LLM phases
                    # were and the whole point is that it is visible.
                    #
                    # Its clients are not ours to bound: the embedding half runs
                    # inside the vendored comps dataprep (bounded only through
                    # VLLM_TIMEOUT, which reaches the LLM client but not the TEI
                    # one — see OVERRIDES.yaml), and the ArangoDB writes go
                    # through langchain-arangodb / py-arango, which carry their
                    # own socket timeouts and take no HTTP budget.
                    if tasks:
                        await _await_with_heartbeat(
                            tasks,
                            phase="Graph insertion",
                            total=len(tasks),
                            file_id=input.file_id,
                            write_ingestion_log=self._write_ingestion_log,
                        )

                    # Ensure the vector index matches the embedder dim
                    # (recreate if dim drift). Failures are swallowed — see
                    # ensure_vector_index() docstring. Runs once every graph
                    # task has settled so all chunks are visible for index
                    # creation, and
                    # BEFORE Ingested status flip so the retriever never
                    # queries a missing/stale index.
                    _metric, _n_lists = _read_index_params()
                    await ensure_vector_index(
                        self.db.collection(f"{graph_name}_SOURCE"),
                        metric=_metric,
                        n_lists=_n_lists,
                        field="embedding",
                        graph_name=graph_name,
                        file_id=input.file_id,
                        write_ingestion_log=self._write_ingestion_log,
                    )

                    # 6. Final Status Update
                    await self._update_doc_status(input.file_id, "Ingested", chunk_count=len(chunks))
                    await self._write_ingestion_log(
                        input.file_id, "INFO", "System", "Ingestion completed successfully."
                    )

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
