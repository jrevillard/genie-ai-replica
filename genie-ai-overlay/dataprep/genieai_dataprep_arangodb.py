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

from tracing import get_tracer, setup_trace_logging

tracer = get_tracer(__name__)

# Import exceptions for robust error handling
from arango.exceptions import AQLQueryExecuteError

# Import OPEA Core
from comps import CustomLogger, DocPath, OpeaComponentRegistry

# Import Custom GENIE Protocols
from comps.cores.proto.genieai_api_protocol import ArangoDBDataprepRequestFromDocRepo

# Import Custom Utils
from comps.dataprep.src.genieai_dataprep_utils import docling_document_loader, document_loader, is_valid_content

# Import Parent Class
from comps.dataprep.src.integrations.arangodb import OpeaArangoDataprep
from comps.dataprep.src.utils import get_separators
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
# New: Concurrency Control for Batches
MAX_CONCURRENT_BATCHES = int(os.getenv("DATAPREP_MAX_CONCURRENT_BATCHES", "5"))

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
- If nothing fits well → return empty list.
- Use ONLY exact strings from the list.

Labels:
{labels_list}

Output strict JSON only:
{"labels": ["Label1", "Label2"]}
</SYSTEM INSTRUCTIONS>
""".strip()
_env_value = os.getenv("LABEL_SELECTOR_SYSTEM_PROMPT", "")
LABEL_SELECTOR_SYSTEM_PROMPT = _env_value.strip() or _LABEL_SELECTOR_DEFAULT


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
            f"BATCHES={MAX_CONCURRENT_BATCHES}"
        )

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
        _api_key = os.getenv("VLLM_API_KEY", "EMPTY")
        _vllm_endpoint = os.getenv("VLLM_ENDPOINT")
        client = AsyncOpenAI(
            api_key=_api_key,
            base_url=f"{_vllm_endpoint}/v1",
            default_headers={"X-API-Key": _api_key},
        )
        model = os.getenv("VLLM_MODEL_ID")
        # When using remote GPU node, auto-detect model to avoid
        # config mismatch with GPU node deployment
        if os.getenv("GPU_NODE_HOST"):
            try:
                models = await client.models.list()
                model = models.data[0].id if models.data else model
                logger.info(f"Auto-detected remote vLLM model: {model}")
            except Exception as e:
                logger.warning(f"Failed to auto-detect model from vLLM API: {e}")
        if not model:
            raise RuntimeError("VLLM_MODEL_ID not set and auto-detection failed")

        # Debug: Log what is sent to LLM
        logger.debug(
            f"LLM LABELING INPUTS: "
            f"taxonomy ({len(all_labels)} labels): {all_labels}, "
            f"file_labels: {file_labels}, "
            f"system_prompt ({len(LABEL_SELECTOR_SYSTEM_PROMPT)} chars)"
        )

        # Parallel Processing with Semaphore
        semaphore = asyncio.Semaphore(MAX_CONCURRENT_BATCHES)  # Reuse same concurrency limit or define a new one

        async def _label_single_chunk(i, text):
            async with semaphore:
                retries = 0
                suggested_labels = []

                # Validate that all labels are plain strings (not dicts/objects)
                def _validate_labels(labels):
                    non_string = [l for l in labels if not isinstance(l, str)]
                    if non_string:
                        return False, non_string
                    return True, []

                while retries < 3:
                    try:
                        # Replace {labels_list} placeholder with actual labels
                        system_prompt = LABEL_SELECTOR_SYSTEM_PROMPT.replace("{labels_list}", str(all_labels))
                        response = await client.chat.completions.create(
                            model=model,
                            messages=[
                                {"role": "system", "content": system_prompt},
                                {"role": "user", "content": f"Input: {text}"},
                            ],
                        )
                        parsed = json.loads(response.choices[0].message.content)
                        suggested_labels = parsed.get("labels", [])

                        # Validate label format — retry if LLM returned objects instead of strings
                        valid, bad_items = _validate_labels(suggested_labels)
                        if not valid:
                            retries += 1
                            await self._write_ingestion_log(
                                file_id,
                                "WARN",
                                "Labeling",
                                f"Chunk {i}: LLM returned non-string labels: {bad_items}. Retrying ({retries}/3)...",
                            )
                            continue

                        break
                    except Exception:
                        retries += 1

                if retries == 3:
                    await self._write_ingestion_log(
                        file_id,
                        "WARN",
                        "Labeling",
                        f"Chunk {i}: LLM failed to return valid labels after 3 "
                        f"attempts. Falling back to file metadata labels: {file_labels}",
                    )
                    suggested_labels = list(file_labels) if file_labels else []

                final_labels = set()

                # --- Analyze Suggestions with Synonym Matching (unchanged logic) ---
                for label in suggested_labels:
                    # Skip duplicates
                    if label in final_labels:
                        continue

                    # Exact Match
                    if label in all_labels:
                        final_labels.add(label)
                        await self._write_ingestion_log(
                            file_id, "INFO", "Labeling", f"Chunk {i}: LLM selected label '{label}'."
                        )
                        continue

                    # Fuzzy/Synonym Match Check (plural, case-insensitive)
                    match = next((x for x in all_labels if x.lower() == label.lower()), None)
                    if not match and label.endswith("s"):
                        match = next((x for x in all_labels if x.lower() == label[:-1].lower()), None)
                    if not match:
                        match = next((x for x in all_labels if x.lower() == label.lower() + "s"), None)

                    if match:
                        final_labels.add(match)
                        await self._write_ingestion_log(
                            file_id,
                            "INFO",
                            "Labeling",
                            f"Chunk {i}: LLM suggested '{label}' → Mapped to existing '{match}'.",
                        )
                    else:
                        # LLM suggested a label that does NOT exist in taxonomy
                        await self._write_ingestion_log(
                            file_id,
                            "WARN",
                            "Labeling",
                            f"Chunk {i}: LLM suggested NEW label '{label}'. "
                            "Consider adding it to the Knowledge Hierarchy.",
                        )

                labels_list = list(final_labels)
                if labels_list:
                    await self._write_ingestion_log(
                        file_id, "INFO", "Labeling", f"Chunk {i}: Final Labels: {labels_list}"
                    )

                return {"text": text, "labels": labels_list}

        # Create tasks for all chunks
        tasks = [_label_single_chunk(i, text) for i, text in enumerate(chunks)]

        # Run all tasks concurrently (limited by semaphore)
        results = await asyncio.gather(*tasks)

        # Ensure results are sorted by chunk index if order matters (gather preserves order)
        return results

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
                graph_docs = await asyncio.to_thread(self.llm_transformer.convert_to_graph_documents, batch_docs)

                if graph_docs:
                    # Run graph insertion in a thread as well if it's blocking
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

                # 4. Labeling (Spec 5.3, 5.4)
                file_labels = getattr(input, "file_labels", [])
                labelled_docs = await self._apply_labels(chunks, all_labels, file_labels, input.file_id)

                # 5. Graph Insertion (BATCHED & CONCURRENT)
                graph_name = getattr(input, "graph_name", os.getenv("ARANGO_GRAPH_NAME", "GRAPH"))

                documents_to_process = []
                for i, doc in enumerate(labelled_docs):
                    documents_to_process.append(
                        Document(
                            page_content=doc["text"],
                            metadata={
                                "file_id": input.file_id,
                                "file_path": input.storage_path,
                                "chunk_index": i,
                                "chunk_labels": doc["labels"],
                            },
                        )
                    )

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
