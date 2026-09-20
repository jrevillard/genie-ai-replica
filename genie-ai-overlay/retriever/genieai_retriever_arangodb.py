# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import inspect
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from contextlib import suppress
from typing import Any

import openai
from arango import ArangoClient
from arango.database import StandardDatabase
from comps import CustomLogger, EmbedDoc, OpeaComponent, OpeaComponentRegistry, ServiceType
from comps.cores.proto.genieai_api_protocol import ChatCompletionRequest, RetrievalRequest, RetrievalRequestArangoDB
from fastapi import HTTPException
from langchain_arangodb import ArangoVector
from langchain_community.embeddings import HuggingFaceBgeEmbeddings
from langchain_core.documents import Document
from langchain_huggingface import HuggingFaceEndpointEmbeddings
from langchain_openai import ChatOpenAI, OpenAIEmbeddings

from core.model_cache import get_model_id
from core.span_attrs import ATTRIBUTE_NAMES as A
from core.span_attrs import QUERY_ID_KEY, label_digest, query_id_from_baggage
from tracing import (
    background_span,
    install_uvicorn_access_logging,
    setup_json_logging,
    setup_trace_logging,
)

from .config import (
    ARANGO_DB,
    ARANGO_DISTANCE_STRATEGY,
    ARANGO_FILTER_STRATEGY,
    ARANGO_GRAPH_NAME,
    ARANGO_NUM_CENTROIDS,
    ARANGO_PASSWORD,
    ARANGO_SEARCH_MODE,
    ARANGO_SEARCH_START,
    ARANGO_TRAVERSAL_CONCURRENT_BATCHES,
    ARANGO_TRAVERSAL_ENABLED,
    ARANGO_TRAVERSAL_MAX_DEPTH,
    ARANGO_TRAVERSAL_MAX_RETURNED,
    ARANGO_TRAVERSAL_QUERY,
    ARANGO_TRAVERSAL_SCORE_THRESHOLD,
    ARANGO_URL,
    ARANGO_USE_APPROX_SEARCH,
    ARANGO_USERNAME,
    HF_TOKEN,
    HYBRID_BM25_ANALYZER,
    HYBRID_BM25_CANDIDATES,
    HYBRID_DENSE_WEIGHT,
    HYBRID_LEXICAL_WEIGHT,
    HYBRID_RETRIEVAL_ENABLED,
    HYBRID_RRF_K,
    OPENAI_API_KEY,
    OPENAI_CHAT_ENABLED,
    OPENAI_CHAT_MAX_TOKENS,
    OPENAI_CHAT_MODEL,
    OPENAI_CHAT_TEMPERATURE,
    OPENAI_EMBED_ENABLED,
    OPENAI_EMBED_MODEL,
    SUMMARIZER_ENABLED,
    TEI_EMBED_MODEL,
    TEI_EMBEDDING_ENDPOINT,
    VLLM_API_KEY,
    VLLM_ENDPOINT,
    VLLM_MAX_NEW_TOKENS,
    VLLM_MODEL_ID,
    VLLM_TEMPERATURE,
    VLLM_TIMEOUT,
    VLLM_TOP_P,
    get_query_instruction,
)


# Defining a custom data subclass
class GenieEmbedDoc(EmbedDoc):
    search_start: str | None = None
    enable_traversal: str | None = None
    traversal_max_depth: int | None = None
    traversal_max_returned: int | None = None
    traversal_score_threshold: float | None = None


logger = CustomLogger("genieai_retriever_arangodb")
setup_trace_logging("genieai_retriever_arangodb")
setup_json_logging("genieai_retriever_arangodb")
install_uvicorn_access_logging()
logflag = os.getenv("LOGFLAG", False)

# ARANGO_TEXT_FIELD is the column the retriever reads on every query path
# (BM25 via the ArangoSearch view, dense via the langchain-arangodb vector
# store, and traversal AQL). Deliberately hardcoded (no env override) so
# ingest and read paths cannot drift. It is **NOT** a paraphrase or summary
# of the original chunk. What it contains depends on the
# CONTEXTUAL_RETRIEVAL_ENABLED flag at ingest:
#
#   * `CONTEXTUAL_RETRIEVAL_ENABLED=true` (default since v1.5, MR !199):
#     dataprep populates `text` with `original_chunk + LLM-generated
#     document-context prefix` (Anthropic-style). The verbatim
#     un-contextualized chunk is preserved separately under
#     `metadata.chunk_text` for display/debug and is never read back at
#     query time. Reading the contextualized field is required so dense
#     and lexical channels index against a consistent vector-space.
#
#   * `CONTEXTUAL_RETRIEVAL_ENABLED=false`: `text` is just the verbatim
#     chunk (no prefix); the `metadata.chunk_text` field is **not written**
#     (dataprep only writes it when the flag is on).
#
# In both modes the retriever's read column is `text`. Reranker strategy
# (adaptive, slice, threshold, slice_threshold, knee_threshold) operates
# on the retrieved documents and is independent of which field the
# retriever reads.
ARANGO_TEXT_FIELD = "text"
ARANGO_EMBEDDING_FIELD = "embedding"
ARANGO_FILE_ID_FIELD = "file_id"

# Deployment default for the per-request ``fetch_k``. Mirrors the constant
# chatqna builds from the same environment variable (genieai_chatqna.py:503).
DEFAULT_RETRIEVER_FETCH_K = 20

# Ceiling for the per-candidate score vectors on a span. DERIVED FROM THE
# DEPLOYMENT rather than hard-coded: a deployment configured for more candidates
# must not be silently truncated, and one configured for fewer must not carry a
# handful of huge arrays.
#
# The fused candidate set can hold BOTH legs -- every dense candidate plus every
# BM25 candidate -- so the ceiling sums the two configured widths rather than
# reading ``fetch_k`` alone, which would cap the hybrid path below the number of
# candidates it legitimately produces.
#
# The environment variable is ``RETRIEVER_ARANGO_FETCH_K`` (read by
# retriever/config.py consumers and set in docker-compose.yaml). It is NOT
# ``RETRIEVER_FETCH_K``: that name is the chatqna-side Python CONSTANT, and a
# ceiling reading it would be pinned to its default in every deployment.
SCORE_ARRAY_CEILING = max(
    1,
    int(os.getenv("RETRIEVER_ARANGO_FETCH_K", DEFAULT_RETRIEVER_FETCH_K)) + max(0, HYBRID_BM25_CANDIDATES),
)


class QueryInstructionEmbeddingsWrapper:
    """Prefixes queries with a model-specific instruction; passages untouched.

    Covers any contrastive / instruction-tuned embedding model whose model
    card specifies an asymmetric query/passage instruction (BAAI/bge en+zh,
    intfloat/e5, hkunlp/instructor, nomic-ai/nomic-embed, …). Passages
    (``embed_documents``) pass through verbatim so dataprep ingestion via
    the shared TEI service stays prefix-free.

    Apply at the caller (retriever, chatqna) rather than at the TEI service
    layer, because the same TEI is used for ingest (passages) and retrieval
    (queries) — a service-level prefix would invert the asymmetry.
    """

    __slots__ = ("base", "instruction")

    def __init__(self, base, instruction: str):
        self.base = base
        self.instruction = instruction

    def embed_query(self, text: str):
        return self.base.embed_query(self.instruction + text)

    def embed_documents(self, texts):
        return self.base.embed_documents(texts)

    async def aembed_query(self, text: str):
        # Langchain-arangodb currently uses sync embed_query, but a future
        # upgrade could call async. Apply the prefix unconditionally so the
        # contract holds across sync/async paths.
        a = getattr(self.base, "aembed_query", None)
        if callable(a):
            result = a(self.instruction + text)
            if hasattr(result, "__await__"):
                return await result
            return result
        # Base has no async impl — fall back to sync.
        return self.embed_query(text)

    async def aembed_documents(self, texts):
        a = getattr(self.base, "aembed_documents", None)
        if callable(a):
            result = a(texts)
            if hasattr(result, "__await__"):
                return await result
            return result
        return self.embed_documents(texts)

    def __getattr__(self, name):
        # Delegate attribute access (e.g. .model_name, .dimension) to the
        # underlying embeddings so adapters that introspect still work.
        #
        # Guard against the unset-base recursion footgun: `__slots__` makes
        # `self.base` raise AttributeError when the slot is empty (e.g. a
        # subclass forgot `super().__init__(base, instruction)`). Reading
        # `self.base` here would re-enter `__getattr__("base")` and recurse
        # to `RecursionError`. `object.__getattribute__` bypasses our
        # `__getattr__` and lets us detect the missing slot cleanly.
        try:
            base = object.__getattribute__(self, "base")
        except AttributeError as e:
            raise AttributeError(
                "QueryInstructionEmbeddingsWrapper.base is unset; cannot "
                f"resolve {name!r}. A subclass likely forgot to call "
                "super().__init__(base, instruction)."
            ) from e
        try:
            return getattr(base, name)
        except AttributeError as e:
            raise AttributeError(
                f"QueryInstructionEmbeddingsWrapper has no attribute {name!r} "
                f"(wrapped base type {type(base).__name__} also lacks it)"
            ) from e


def _chunk_passes_label_filter(chunk_labels, labels_to_filter, filter_strategy):
    """Replicate the dense-path AQL label filter in Python (Contextual Retrieval Part B).

    A chunk passes when its ``chunk_labels`` satisfies the requested labels under
    the given strategy: ``AND`` = all required labels present, ``OR`` = any one.
    No requested labels (or empty) means "no filter" → always passes.
    """
    if not labels_to_filter:
        return True
    if not chunk_labels:
        return False
    if str(filter_strategy).upper() == "AND":
        return all(label in chunk_labels for label in labels_to_filter)
    return any(label in chunk_labels for label in labels_to_filter)


def _build_aql_filter_clause(labels_to_filter, filter_strategy):
    """Build the AQL ``FILTER`` clause for the given labels + strategy.

    Extracted from ``invoke`` (the consolidated ``labels_to_filter`` construction
    stays there) so the contract suite can assert the REAL clause-construction
    path — the langchain-arangodb 0.0.4 failure class was a silently-ignored
    ``filter_clause``, and this is the surface that must keep producing a real
    ``FILTER``. Returns ``""`` when no labels are requested.
    """
    if not labels_to_filter:
        return ""
    labels_array = "[" + ", ".join(f'"{label}"' for label in labels_to_filter) + "]"
    if filter_strategy == "AND":
        return f"FILTER (doc.chunk_labels != null) AND ({labels_array} ALL IN doc.chunk_labels)"
    if filter_strategy == "OR":
        return f"FILTER (doc.chunk_labels != null) AND ({labels_array} ANY IN doc.chunk_labels)"
    raise HTTPException(status_code=400, detail=f"Invalid filter_strategy: {filter_strategy}. Expected 'AND' or 'OR'.")


def _normalize_chunk_id(doc) -> str | None:
    """Normalize a chunk's identity to its bare ArangoDB ``_key``.

    Both the dense channel (langchain-arangodb sets ``Document.id = _key``) and
    the BM25 channel (``Document(id=_key)``) use the bare key, but this defends
    against the ``COLLECTION/_key`` form and a missing id so cross-channel fusion
    never mis-merges or silently drops a document.
    """
    cid = getattr(doc, "id", None)
    if cid is None:
        return None
    cid = str(cid)
    return cid.rsplit("/", 1)[-1]  # COLLECTION/_key -> _key


def _overflow_doc_ids_json(doc_ids: list[str]) -> str:
    """JSON-encode overflow doc ids for OTel span-attribute storage.

    OTel attribute values are strings/numbers/booleans/string-arrays-of-uniform-type;
    nested arrays-of-strings are not preserved consistently across exporters.
    Stable JSON-string form works on every exporter VictoriaTraces uses.
    """
    return json.dumps(doc_ids, ensure_ascii=False)


def _result_key(result: dict):
    """Return the chunk identity a retrieval result carries.

    Both legs key on the raw ``doc.id`` so ``_dense_by_id`` and the fused key
    list are built from the SAME function on the SAME Document objects -- which
    is what makes index alignment a property of the code rather than a
    coincidence. ``None`` (an unkeyable document) stays ``None`` rather than
    becoming a shared placeholder that would merge two distinct documents.

    INVARIANT the callers rely on: at most ONE retrieval result per request has
    no id. Both legs key their documents -- the BM25 leg builds
    ``Document(id=row["key"])`` from an AQL ``RETURN doc._key``, and the dense
    leg comes from langchain-arangodb, which sets ``Document.id`` to the chunk
    key -- so an unkeyable document is not a case either leg produces.

    Where it would break: ``_dense_by_id`` is a plain dict comprehension over
    the dense leg, so ``None`` is a single dict key -- two or more unkeyable
    dense documents would collapse onto it, keeping only the last score, and
    ``key in _dense_by_id`` would report ``dense_present`` true for EVERY
    unkeyable slot in the fused list. ``rrf_fuse`` does not have that hole: it
    gives each unkeyable doc a distinct ``__unkeyed_<n>`` identity, so two of
    them stay two entries there and would disagree with the dense map here.
    Recorded rather than restructured: the stated contract excludes the case, and
    adding a synthetic key to ``_result_key`` would change what
    ``rag.candidate_keys`` reports for every span.
    """
    return getattr(result.get("doc"), "id", None)


def _as_int(value, default: int = 0) -> int:
    """Coerce a request field to ``int``, falling back rather than raising.

    ``model_dump`` hands back whatever the caller serialized, so a numeric
    field can arrive as a string or as junk. Tracing must never be the reason a
    retrieval request fails, so an unparseable value degrades to ``default``.
    """
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _as_float(value, default: float = 0.0) -> float:
    """Coerce a request field to ``float``, falling back rather than raising."""
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _retrieval_parameter_attributes(input_dict: dict, base_mode: str, labels: list[str]) -> dict:
    """Retrieval-parameter half of the retriever span attributes.

    ``base_mode`` and ``labels`` are the DECODED values (post
    ``decode_filter_labels``), so the trace shows the effective search rather
    than the encoded wire form.

    Label values become digests: the taxonomy is fetched from the backend at
    runtime, so no static vocabulary exists to validate them against, and real
    labels contain spaces.

    The traversal INJECTED counters are seeded at zero here and overwritten
    after the traversal loop. A traversal that is off and a traversal that ran
    and injected nothing are therefore both recorded, and both read as zero --
    which is correct, because ``traversal_enabled`` distinguishes them. Without
    this seeding, "off" would be an absent attribute and only "on but found
    nothing" would be zero.
    """
    return {
        A["rag_search_start_base"]: base_mode,
        A["rag_search_type"]: input_dict.get("search_type") or "default",
        A["rag_fetch_k"]: _as_int(input_dict.get("fetch_k")),
        A["rag_filter_labels_enabled"]: bool(labels),
        A["rag_filter_label_count"]: len(labels),
        A["rag_filter_label_digests"]: [label_digest(label) for label in labels],
        A["traversal_enabled"]: str(input_dict.get("enable_traversal") or "").lower() == "true",
        A["traversal_max_depth"]: _as_int(input_dict.get("traversal_max_depth")),
        A["traversal_max_returned"]: _as_int(input_dict.get("traversal_max_returned")),
        A["traversal_score_threshold"]: _as_float(input_dict.get("traversal_score_threshold")),
        A["traversal_injected_docs"]: 0,
        A["traversal_injected_neighbor_items"]: 0,
        **_hybrid_configuration_attributes(base_mode),
    }


def _retrieval_score_attributes(
    keys: list[str],
    dense_by_id: dict,
    dense_present: list[bool],
    bm25_by_id: dict | None = None,
    fused: list | None = None,
) -> dict:
    """Per-candidate half of the retriever span attributes.

    EVERY array is index-aligned to ``keys``, which is the ordering the caller
    reports (the fused ordering on the hybrid path). Each leg is keyed by chunk
    id and re-expanded in that order: a chunk a leg never returned gets ``0.0``
    and ``False`` in the presence mask, never another chunk's score.

    The presence mask is what makes the two distinguishable. Without it a
    BM25-only chunk and a dense chunk that genuinely scored zero would emit the
    same value in the same slot, and a reader would have no way to know which.

    ``rag.scores.capped`` is computed from the PRE-truncation length, so it stays
    truthful after ``keys`` has been sliced.
    """
    present = list(dense_present or [])
    truncated_keys = list(keys)[:SCORE_ARRAY_CEILING]
    dense_by_id = dense_by_id or {}
    attrs = {
        A["rag_candidate_keys"]: truncated_keys,
        A["rag_scores_dense"]: [_as_float(dense_by_id.get(k)) for k in truncated_keys],
        A["rag_scores_dense_present"]: [bool(p) for p in present[:SCORE_ARRAY_CEILING]],
        A["rag_scores_capped"]: len(present) > SCORE_ARRAY_CEILING,
    }
    if bm25_by_id is not None:
        attrs[A["rag_scores_bm25"]] = [_as_float(bm25_by_id.get(k)) for k in truncated_keys]
    if fused is not None:
        attrs[A["rag_scores_fused"]] = [_as_float(s) for s in list(fused)[:SCORE_ARRAY_CEILING]]
    return attrs


def rrf_fuse(dense, bm25, k=HYBRID_RRF_K, dense_weight=HYBRID_DENSE_WEIGHT, lexical_weight=HYBRID_LEXICAL_WEIGHT):
    """Fuse dense + BM25 result lists via weighted Reciprocal Rank Fusion.

    Pure function — no I/O, no side effects. Each input element is
    ``{"doc": Document, "score": float}``; the chunk identity is the normalized
    ``doc.id`` (ArangoDB ``_key``). A document present in both channels receives
    both rank contributions; a document in only one receives that single
    contribution. Within a channel, duplicate identities are de-duplicated
    (best rank kept). A document whose id cannot be normalized is kept as a
    standalone entry (never dropped, never mis-merged).

    Args:
        dense: dense retrieval results (best-first).
        bm25: BM25 retrieval results (best-first).
        k: RRF ranking constant (default 60, literature standard).
        dense_weight: weight applied to the dense channel contribution.
        lexical_weight: weight applied to the BM25 channel contribution.

    Returns:
        A NEW list of ``{"doc": Document, "score": float}`` sorted by fused
        score descending.
    """
    scores: dict[str, dict] = {}
    none_counter = 0
    for channel, weight in ((dense, dense_weight), (bm25, lexical_weight)):
        seen: set[str] = set()
        rank = 0
        for item in channel:
            chunk_id = _normalize_chunk_id(item["doc"])
            if chunk_id is None:
                # Unkeyable doc: keep it standalone so it is neither dropped nor
                # mis-merged with other unkeyed docs.
                chunk_id = f"__unkeyed_{none_counter}"
                none_counter += 1
            if chunk_id in seen:
                continue  # de-dup within a channel (keep best rank)
            seen.add(chunk_id)
            rank += 1
            entry = scores.setdefault(chunk_id, {"doc": item["doc"], "score": 0.0})
            entry["score"] += weight / (k + rank)
    return sorted(scores.values(), key=lambda x: x["score"], reverse=True)


def _hybrid_configuration_attributes(search_start: str) -> dict:
    """The RRF configuration in force, read off ``rrf_fuse``'s own signature.

    Read from the function rather than re-referenced from ``config.py``:
    ``rrf_fuse`` is called without keyword arguments, so its defaults ARE the
    configuration in force, and a span that quoted the config module could
    disagree with the fusion that actually ran.

    ``rag.hybrid.enabled`` reports whether the lexical channel was ENGAGED for
    this request -- the deploy flag on AND a chunk search start -- which is the
    same condition the fusion block is guarded by. The deploy flag alone is not
    it: on an ``edge`` or ``node`` search the span would say ``true`` while no
    fusion ran at all, and one attribute is what an operator reads. The search
    start itself is recorded alongside as ``rag.search_start_base``.

    ``true`` means the channel was engaged, not that it returned anything: a
    BM25 search that found nothing, or that failed and degraded to dense-only,
    still reports ``true`` and shows up as the ABSENCE of ``rag.scores.bm25``.
    That is the distinction the flag exists to preserve -- "on, no lexical hit"
    versus "off" -- and both are recorded as an explicit boolean, never omitted.
    """
    parameters = inspect.signature(rrf_fuse).parameters
    return {
        A["rag_hybrid_enabled"]: bool(HYBRID_RETRIEVAL_ENABLED and search_start == "chunk"),
        A["rag_hybrid_dense_weight"]: float(parameters["dense_weight"].default),
        A["rag_hybrid_lexical_weight"]: float(parameters["lexical_weight"].default),
        A["rag_hybrid_rrf_k"]: int(parameters["k"].default),
    }


@OpeaComponentRegistry.register("GENIE_RETRIEVER_ARANGODB")
class GenieaiArangoRetriever(OpeaComponent):
    """A specialized retriever component derived from OpeaComponent for ArangoDB retriever services.

    Attributes:
        client (ArangoDB): An instance of the ArangoDB client for vector database operations.
    """

    def __init__(self, name: str, description: str, config: dict = None):
        super().__init__(name, ServiceType.RETRIEVER.name.lower(), description, config)

        # Cache of graph_names for which the BM25 ArangoSearch view has been
        # ensured (Contextual Retrieval Part B). graph_name is per-request, so
        # view creation is lazy; this set avoids repeated ArangoDB round-trips.
        self._bm25_views_ensured: set[str] = set()

        self._initialize_client()

        if SUMMARIZER_ENABLED:
            self._initialize_llm()

    def _initialize_llm(self):
        """Initialize the language model for summarization if enabled.

        When GPU_NODE_HOST is set, auto-detects the vLLM model (with TTL cache,
        see core/model_cache.py) instead of using the config default VLLM_MODEL_ID.
        Falls back to the config default on any probe failure.
        """
        with background_span("retriever.initialize_llm"):
            if OPENAI_API_KEY and OPENAI_CHAT_ENABLED:
                if logflag:
                    logger.debug("OpenAI API Key is set. Verifying its validity...")

                openai.api_key = OPENAI_API_KEY

                try:
                    openai.models.list()
                    if logflag:
                        logger.debug("OpenAI API Key is valid.")
                    self.llm = ChatOpenAI(
                        temperature=OPENAI_CHAT_TEMPERATURE, model=OPENAI_CHAT_MODEL, max_tokens=OPENAI_CHAT_MAX_TOKENS
                    )
                    self._llm_model_id = OPENAI_CHAT_MODEL
                except openai.error.AuthenticationError:
                    logger.error("OpenAI API Key is invalid.")
                except Exception as e:
                    logger.error(f"An error occurred while verifying the API Key: {e}")

            elif VLLM_ENDPOINT:
                self._llm_model_id = self._resolve_vllm_model_id()
                self.llm = self._create_vllm_client(self._llm_model_id)
            else:
                raise HTTPException(
                    status_code=400, detail="No LLM environment variables are set, cannot generate graphs."
                )

    def _resolve_vllm_model_id(self) -> str:
        """Return the vLLM model ID for summarization.

        Auto-detects (TTL-cached) from the remote vLLM when GPU_NODE_HOST is set;
        otherwise returns the VLLM_MODEL_ID env/config default.

        Logging is deferred to _get_llm() which logs only on model change.
        """
        if os.getenv("GPU_NODE_HOST") and VLLM_ENDPOINT:
            detected = get_model_id(VLLM_ENDPOINT)
            if detected:
                os.environ["VLLM_MODEL_ID"] = detected
                return detected
        return os.getenv("VLLM_MODEL_ID", VLLM_MODEL_ID)

    def _create_vllm_client(self, model_id: str) -> ChatOpenAI:
        """Create a ChatOpenAI client targeting the vLLM endpoint."""
        return ChatOpenAI(
            openai_api_key=VLLM_API_KEY,
            openai_api_base=f"{VLLM_ENDPOINT}/v1",
            model=model_id,
            temperature=VLLM_TEMPERATURE,
            max_tokens=VLLM_MAX_NEW_TOKENS,
            top_p=VLLM_TOP_P,
            timeout=VLLM_TIMEOUT,
        )

    def _get_llm(self) -> ChatOpenAI:
        """Return the summarizer LLM, recreating it if the auto-detected model changed.

        On each call the TTL-cached model ID is re-checked. If it differs from the
        model baked into the current client (e.g. the GPU node changed models), the
        ChatOpenAI client is recreated.
        """
        if VLLM_ENDPOINT and os.getenv("GPU_NODE_HOST"):
            current_id = self._resolve_vllm_model_id()
            if current_id != getattr(self, "_llm_model_id", None):
                logger.info(f"Summarizer model changed: {self._llm_model_id} -> {current_id}, recreating client")
                self._llm_model_id = current_id
                self.llm = self._create_vllm_client(current_id)
        return self.llm

    def _initialize_client(self):
        """Initialize the ArangoDB connection."""
        with background_span("retriever.initialize_client"):
            self.client = ArangoClient(hosts=ARANGO_URL)
            sys_db = self.client.db(name="_system", username=ARANGO_USERNAME, password=ARANGO_PASSWORD, verify=True)

            if not sys_db.has_database(ARANGO_DB):
                sys_db.create_database(ARANGO_DB)

            self.db = self.client.db(name=ARANGO_DB, username=ARANGO_USERNAME, password=ARANGO_PASSWORD, verify=True)
            if logflag:
                logger.debug(f"Connected to ArangoDB {self.db.version()}.")

            # Ensure the BM25 ArangoSearch view for the default graph (Contextual
            # Retrieval Part B). Mirrors the has_database/create_database idiom;
            # other graph_names are ensured lazily in _bm25_search on first use.
            if HYBRID_RETRIEVAL_ENABLED:
                try:
                    self._ensure_bm25_view(ARANGO_GRAPH_NAME)
                except Exception as e:
                    logger.error(f"Could not ensure default BM25 view for graph '{ARANGO_GRAPH_NAME}': {e}")

    def _ensure_bm25_view(self, graph_name: str) -> None:
        """Idempotently create the ArangoSearch BM25 view over <graph_name>_SOURCE.text.

        Best-effort: never raises. Cached in ``self._bm25_views_ensured`` on
        **success only**, so a transient failure (e.g. ArangoDB unreachable,
        view API mismatch) is retried on the next request rather than silently
        disabling the BM25 channel forever. The view indexes the chunk ``text``
        field (the same field Part A populates with contextual prefixes) plus
        ``chunk_labels`` so BM25 candidates can be label-filtered; the file id is
        resolved downstream by the existing per-chunk enrichment AQL.
        """
        if graph_name in self._bm25_views_ensured:
            return

        view_name = f"{graph_name}_BM25_VIEW"
        collection = f"{graph_name}_SOURCE"
        try:
            # python-arango StandardDatabase has no has_view(); use views().
            _existing_views = {v.get("name") for v in (self.db.views() or [])}
            if view_name not in _existing_views:
                properties = {
                    "links": {
                        collection: {
                            "analyzers": [HYBRID_BM25_ANALYZER],
                            "fields": {
                                ARANGO_TEXT_FIELD: {},
                                "chunk_labels": {},
                            },
                            "includeAllFields": False,
                            "storeValues": "none",
                        }
                    }
                }
                self.db.create_arangosearch_view(view_name, properties)
                logger.info(f"Created ArangoSearch BM25 view '{view_name}' on collection '{collection}'.")
            # Cache on success only (exists or created). A failure leaves the
            # graph uncached so the next request retries instead of dying silently.
            self._bm25_views_ensured.add(graph_name)
        except Exception as e:
            logger.error(f"Failed to ensure BM25 view '{view_name}': {e}")

    def _bm25_search(
        self,
        query: str,
        graph_name: str,
        n: int,
        labels_to_filter: list,
        filter_strategy: str,
        aql_filter_clause: str = "",
    ) -> list:
        """Run a BM25 lexical search over the chunk view (Contextual Retrieval Part B).

        Returns the same shape as the dense search: ``[{"doc": Document, "score": float}]``.
        Candidates are filtered by the same ``chunk_labels`` clause as the dense
        path (``aql_filter_clause``, injected pre-``LIMIT`` to preserve in-category
        recall); the Python ``_chunk_passes_label_filter`` is a defense-in-depth
        safety net on the already-filtered rows. ``doc.id`` is the chunk ``_key`` so RRF can
        match identities across channels. Never raises — logs and returns [].
        """
        self._ensure_bm25_view(graph_name)
        view_name = f"{graph_name}_BM25_VIEW"

        aql = f"""
            FOR doc IN {view_name}
                SEARCH ANALYZER(doc.{ARANGO_TEXT_FIELD} IN TOKENS(@query, @analyzer), @analyzer)
                {aql_filter_clause}
                LET _bm25_score = BM25(doc)
                SORT _bm25_score DESC
                LIMIT @n
                RETURN {{
                    "key": doc._key,
                    "text": doc.{ARANGO_TEXT_FIELD},
                    "chunk_labels": doc.chunk_labels,
                    "score": _bm25_score
                }}
        """
        bind_vars = {"query": query, "analyzer": HYBRID_BM25_ANALYZER, "n": n}

        results = []
        try:
            cursor = self.db.aql.execute(aql, bind_vars=bind_vars)
            for row in cursor:
                chunk_labels = row.get("chunk_labels")
                if not _chunk_passes_label_filter(chunk_labels, labels_to_filter, filter_strategy):
                    continue
                doc = Document(
                    id=row.get("key"),
                    page_content=row.get("text") or "",
                    # chunk_key preserved in metadata so it survives the
                    # retriever->chatqna handoff (langchain mangles Document.id
                    # to a UUID). chatqna's reranker_selection span reads it for
                    # retrieval eval. file_ids is resolved uniformly downstream.
                    metadata={"chunk_labels": chunk_labels or [], "chunk_key": row.get("key")},
                )
                results.append({"doc": doc, "score": float(row.get("score") or 0.0)})
        except Exception as e:
            logger.error(f"BM25 search failed on view '{view_name}': {e}")
        return results

    def check_health(self) -> bool:
        """Checks the health of the retriever service."""
        with background_span("retriever.check_health"):
            if logflag:
                logger.debug("[ check health ] start to check health of ArangoDB")
            try:
                version = self.db.version()
                if logflag:
                    logger.debug(f"[ check health ] Successfully connected to ArangoDB {version}!")
                return True
            except Exception as e:
                logger.error(f"[ check health ] Failed to connect to ArangoDB: {e}")
                return False

    def fetch_neighborhoods(
        self,
        db: StandardDatabase,
        keys: list[str],
        graph_name: str,
        search_start: str,
        query_embedding: list[float],
        collection_name: str,
        traversal_max_depth: int,
        traversal_max_returned: int,
        traversal_score_threshold: float,
        traversal_query: str,
        distance_strategy: str,
    ) -> dict[str, Any]:
        """Fetch the neighborhoods of matched documents from an ArangoDB graph.
        This method retrieves neighborhoods of documents based on a specified graph traversal
        strategy, distance scoring, and other parameters. It supports different starting points
        for the traversal, such as "chunk", "edge", or "node".

        If `traversal_query` is provided, it will override the default traversal behavior.

        Args:
            db (StandardDatabase): The ArangoDB database instance.
            keys (list[str]): A list of document keys to search for.
            graph_name (str): The name of the graph to traverse.
            search_start (str): The starting point for the traversal. Options are "chunk", "edge", or "node".
            query_embedding (list[float]): The embedding vector used for similarity scoring.
            collection_name (str): The name of the collection containing the documents.
            traversal_max_depth (int): The maximum depth for the graph traversal.
            traversal_max_returned (int): The maximum number of results to return per traversal.
            traversal_score_threshold (float): The minimum score threshold for including results.
            traversal_query (str): A custom traversal query to override the default behavior.
            distance_strategy (str): The distance scoring strategy. Options are "COSINE" or "EUCLIDEAN_DISTANCE".
        Returns:
            dict[str, Any]: A dictionary where keys are document keys and values are their neighborhoods.
        Raises:
            HTTPException: If an invalid distance strategy is provided.
        Notes:
            - The function dynamically constructs an AQL query based on the input parameters.
            - If `logflag` is enabled, the constructed query and bind variables are logged.
        """

        traversal_start = time.time()

        if traversal_max_depth < 1:
            traversal_max_depth = 1

        if traversal_max_returned < 1:
            traversal_max_returned = 1

        score_func = ""
        sort_order = ""

        if distance_strategy == "COSINE":
            score_func = "COSINE_SIMILARITY"
            sort_order = "DESC"
        elif distance_strategy == "EUCLIDEAN_DISTANCE":
            score_func = "L2_DISTANCE"
            sort_order = "ASC"
        else:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid distance strategy: {distance_strategy}. Expected 'COSINE' or 'EUCLIDEAN_DISTANCE'.",
            )

        # sub_query = ""
        neighborhoods = {}

        # Configure threading #

        max_workers = ARANGO_TRAVERSAL_CONCURRENT_BATCHES

        if max_workers > 4:
            logger.error(
                f"[Arango Traversal] ARANGO_TRAVERSAL_CONCURRENT_BATCHES={max_workers} "
                f"is above the safe cap (4). Capping to 4."
            )
            max_workers = 4

        if max_workers < 1:
            logger.error(
                f"[Arango Traversal] ARANGO_TRAVERSAL_CONCURRENT_BATCHES={max_workers} is invalid. Defaulting to 1."
            )
            max_workers = 1

        if max_workers == 1:
            logger.info("[Arango Traversal] Running in single-query mode (no threading).")

            bind_vars = {
                "@collection": collection_name,
                "keys": keys,
            }

            sub_query = self._build_subquery(
                graph_name=graph_name,
                search_start=search_start,
                query_embedding=query_embedding,
                traversal_max_depth=traversal_max_depth,
                traversal_max_returned=traversal_max_returned,
                traversal_score_threshold=traversal_score_threshold,
                traversal_query=traversal_query,
                distance_strategy=distance_strategy,
                score_func=score_func,
                sort_order=sort_order,
                bind_vars=bind_vars,
                collection_name=collection_name,
            )

            query = f"""
                FOR key IN @keys
                    LET doc = DOCUMENT(@@collection, key)

                    LET neighborhood = (
                        {sub_query}
                    )

                    RETURN {{[doc._key]: neighborhood}}
            """

            cursor = db.aql.execute(query, bind_vars=bind_vars)

            for doc in cursor:
                neighborhoods.update(doc)

            traversal_finish = time.time()

            if logflag:
                logger.info(f"Graph traversal completion time: {traversal_finish - traversal_start:4f} seconds")

            return neighborhoods

        logger.info(f"[Arango Traversal] Running threaded mode with {max_workers} workers for {len(keys)} keys.")

        def run_for_single_key(single_key: str):

            bind_vars = {
                "@collection": collection_name,
                "keys": [single_key],  # ONLY one key
            }

            # Subquery for single key
            sub_query = self._build_subquery(
                graph_name=graph_name,
                search_start=search_start,
                query_embedding=query_embedding,
                traversal_max_depth=traversal_max_depth,
                traversal_max_returned=traversal_max_returned,
                traversal_score_threshold=traversal_score_threshold,
                traversal_query=traversal_query,
                distance_strategy=distance_strategy,
                score_func=score_func,
                sort_order=sort_order,
                bind_vars=bind_vars,
                collection_name=collection_name,
            )

            # Query for 1 key
            query = f"""
                LET key = @keys[0]
                LET doc = DOCUMENT(@@collection, key)

                LET neighborhood = (
                    {sub_query}
                )

                RETURN {{[doc._key]: neighborhood}}
            """

            cursor = db.aql.execute(query, bind_vars=bind_vars)
            return next(cursor)

        with ThreadPoolExecutor(max_workers=max_workers) as executor:
            futures = {executor.submit(run_for_single_key, k): k for k in keys}

            for future in as_completed(futures):
                key = futures[future]
                try:
                    result = future.result()
                    neighborhoods.update(result)
                except Exception as e:
                    logger.error(f"[Threaded Traversal] Error for key {key}: {e}")

        traversal_finish = time.time()

        if logflag:
            logger.info(f"Graph traversal completion time: {traversal_finish - traversal_start:4f} seconds")

        return neighborhoods

    def _build_subquery(
        self,
        graph_name,
        search_start,
        query_embedding,
        traversal_max_depth,
        traversal_max_returned,
        traversal_score_threshold,
        traversal_query,
        distance_strategy,
        score_func,
        sort_order,
        bind_vars,
        collection_name,
    ):
        """
        Builds the AQL sub-query exactly as your original code did.
        Moved into a helper to reuse it for threading.
        """

        if traversal_query:
            sub_query = traversal_query.format(
                graph_name=graph_name,
                traversal_max_depth=traversal_max_depth,
                traversal_max_returned=traversal_max_returned,
                traversal_score_threshold=traversal_score_threshold,
                ARANGO_EMBEDDING_FIELD=ARANGO_EMBEDDING_FIELD,
                ARANGO_TEXT_FIELD=ARANGO_TEXT_FIELD,
            )

            if "@query_embedding" in sub_query:
                bind_vars["query_embedding"] = query_embedding

            return sub_query

        # ----------------------------
        # search_start == "chunk"
        # ----------------------------
        if search_start == "chunk":
            bind_vars["query_embedding"] = query_embedding

            return f"""
                LET raw = (
                    FOR node IN 1..1 INBOUND doc {graph_name}_HAS_SOURCE
                        FOR node2, edge IN 1..{traversal_max_depth} ANY node {graph_name}_LINKS_TO
                            LET score = {score_func}(edge.{ARANGO_EMBEDDING_FIELD}, @query_embedding)
                            FILTER score >= {traversal_score_threshold}

                            RETURN {{
                                score: score,
                                text: edge.{ARANGO_TEXT_FIELD}
                            }}
                )

                FOR item IN raw
                    SORT item.score {sort_order}
                    LIMIT {traversal_max_returned}
                    RETURN item.text
            """

        # ----------------------------
        # search_start == "edge"
        # ----------------------------
        elif search_start == "edge":
            return f"""
                LET chunk = DOCUMENT({graph_name}_SOURCE, doc.source_id)

                RETURN {{
                    "chunk_text": (chunk ? chunk.{ARANGO_TEXT_FIELD} : null),
                    "file_id": (chunk ? chunk.{ARANGO_FILE_ID_FIELD} : null)
                }}
            """

        # ----------------------------
        # search_start == "node"
        # ----------------------------
        elif search_start == "node":
            bind_vars["query_embedding"] = query_embedding

            return f"""
                FOR node, edge IN 1..{traversal_max_depth} ANY doc {graph_name}_LINKS_TO
                    OPTIONS {{ bfs: true, uniqueVertices: "global" }}

                    LET score = {score_func}(edge.{ARANGO_EMBEDDING_FIELD}, @query_embedding)

                    FILTER score >= {traversal_score_threshold}

                    SORT score {sort_order}
                    LIMIT {traversal_max_returned}

                    LET chunk = DOCUMENT({graph_name}_SOURCE, edge.source_id)

                    RETURN MERGE(
                        {{}},
                        {{
                            [ edge.{ARANGO_TEXT_FIELD} ] : {{
                                "chunk_text": (chunk ? chunk.{ARANGO_TEXT_FIELD} : null),
                                "file_id": (chunk ? chunk.{ARANGO_FILE_ID_FIELD} : null)
                            }}
                        }}
                    )
            """

        # Fallback
        return ""

    def generate_summarization_prompt(self, query: str, text: str) -> str:
        """Generate a summarization prompt based on the provided query and text.
        This method creates a structured prompt to summarize a document retrieved
        through vector similarity matching. The summarization is guided by the
        provided query and optionally leverages a 'RELATED INFORMATION' section
        within the document to enhance relevance.

        Args:
            query (str): The query string used as the foundation for the summary.
            text (str): The document text to be summarized.
        Returns:
            str: A formatted prompt string instructing how to summarize the document.
        """

        return f"""
            I've performed vector similarity on the following
            query to retrieve most relevant documents: '{query}'

            Each Document retrieved may have a 'RELATED INFORMATION' section.

            Summarize the Document below using the query as the foundation to your summary.

            Discard any unrelated information that is not relevant to the query.

            If the Document has a 'RELATED INFORMATION' section, use it to help you summarize the Document.

            The document is as follows:

            ------
            {text}
            ------

            Provide a summary to include all content relevant to the query, using the
            RELATED INFORMATION section (if provided) as needed.

            Your summary:
        """

    async def invoke(
        self, input: ChatCompletionRequest | RetrievalRequest | RetrievalRequestArangoDB | GenieEmbedDoc
    ) -> list:
        """Process the retrieval request and return relevant documents."""
        if logflag:
            logger.debug(input)

        start = time.time()

        # OpenTelemetry span for retrieval operation
        from tracing import get_tracer

        tracer = get_tracer("retriever.arangodb")
        span = tracer.start_span("retriever.hybrid_search")
        span.set_attribute("rag.search_mode", ARANGO_SEARCH_MODE)
        span.set_attribute("rag.top_k", input.k if hasattr(input, "k") else 0)
        _query_id = query_id_from_baggage()
        if _query_id:
            span.set_attribute(QUERY_ID_KEY, _query_id)

        try:
            #################
            # Process Input #
            #################

            input_dict = input.model_dump(exclude_none=True)

            # DATA CONTRACT: decode filter labels AND authorized graph set
            # from search_start BEFORE any search_start reads. chatqna encodes
            # both segments in search_start because the OPEA framework drops
            # custom fields between mega-service nodes. Story 1.0b
            # (LG-5 launch gate) proves graph_names survives this boundary.
            # See core/label_contract.py for the format + full documentation.
            from core.label_contract import decode

            _base_mode, _encoded_labels, _encoded_graphs = decode(str(input_dict.get("search_start", "chunk")))
            input_dict["search_start"] = _base_mode  # restore base mode
            if _encoded_labels:
                input_dict["_encoded_filter_labels"] = _encoded_labels
            # graph_names (Story 1.0b/1.1): default [] = single-graph legacy
            # behavior; when chatqna encodes a non-empty set, the fan-out path
            # traverses exactly those graphs. Populated on input_dict so the
            # upstream input-graph-name lookup (line below) and the
            # fan-out orchestration (Story 1.1) both see the authorized set.
            input_dict["_encoded_graph_names"] = _encoded_graphs

            # Emitted UNCONDITIONALLY, above the `if _encoded_labels:` branch
            # below. Putting it inside that branch would set nothing at all on
            # every label-free query -- most production traffic, and precisely
            # the case where "did the filter silently not apply?" is the
            # question being asked of the trace.
            for _key, _value in _retrieval_parameter_attributes(input_dict, _base_mode, _encoded_labels).items():
                span.set_attribute(_key, _value)

            query = input_dict.get("input", input_dict.get("text"))
            if logflag:
                logger.info(f"Retriever Input Dict: {input_dict}")

            if not query:
                logger.error("Query is empty. Please provide a valid query.")
                return []

            embedding = input.embedding if isinstance(input.embedding, list) else None
            graph_name = input_dict.get("graph_name", ARANGO_GRAPH_NAME)
            search_start = input_dict.get("search_start", ARANGO_SEARCH_START)
            search_mode = input_dict.get("search_mode", ARANGO_SEARCH_MODE)
            enable_traversal = input_dict.get("enable_traversal", ARANGO_TRAVERSAL_ENABLED)
            enable_summarizer = input_dict.get("enable_summarizer", SUMMARIZER_ENABLED)
            distance_strategy = input_dict.get("distance_strategy", ARANGO_DISTANCE_STRATEGY)
            use_approx_search = input_dict.get("use_approx_search", ARANGO_USE_APPROX_SEARCH)
            num_centroids = input_dict.get("num_centroids", ARANGO_NUM_CENTROIDS)
            traversal_max_depth = input_dict.get("traversal_max_depth", ARANGO_TRAVERSAL_MAX_DEPTH)
            traversal_max_depth = int(traversal_max_depth)
            traversal_max_returned = input_dict.get("traversal_max_returned", ARANGO_TRAVERSAL_MAX_RETURNED)
            traversal_score_threshold = input_dict.get("traversal_score_threshold", ARANGO_TRAVERSAL_SCORE_THRESHOLD)
            traversal_query = input_dict.get("traversal_query", ARANGO_TRAVERSAL_QUERY)

            filter_data = input_dict.get("context", {})
            filter_strategy = input_dict.get("filter_strategy", ARANGO_FILTER_STRATEGY).upper()

            # Consolidate all labels into a single list
            labels_to_filter = []
            if filter_data.get("categoryLabels"):
                labels_to_filter.extend(filter_data["categoryLabels"])
            if filter_data.get("serviceLabels"):
                labels_to_filter.extend(filter_data["serviceLabels"])

            # Add labels encoded in search_start (parsed at the top of invoke,
            # stored in input_dict["_encoded_filter_labels"]). See the DATA
            # CONTRACT comment near model_dump() above.
            labels_to_filter.extend(input_dict.pop("_encoded_filter_labels", []))

            # CONSTRUCT THE AQL FILTER CLAUSE
            aql_filter_clause = _build_aql_filter_clause(labels_to_filter, filter_strategy)

            if labels_to_filter and logflag:
                logger.debug(f"Applying filter strategy '{filter_strategy}' with labels: {labels_to_filter}")

            if not graph_name:
                raise HTTPException(
                    status_code=400,
                    detail="Graph name is empty. Please provide a valid graph name.",
                )

            if search_start == "node":
                collection_name = f"{graph_name}_ENTITY"
            elif search_start == "edge":
                collection_name = f"{graph_name}_LINKS_TO"
            elif search_start == "chunk":
                collection_name = f"{graph_name}_SOURCE"
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"Invalid search_start value: {search_start}. Expected 'node', 'edge', or 'chunk'.",
                )

            if logflag:
                logger.debug(
                    f"Graph name: {graph_name}, Start Collection name: "
                    f"{collection_name}, label filter clause: {aql_filter_clause}"
                )

            #################
            # Validate Data #
            #################

            if not self.db.has_graph(graph_name):
                graph_names_for_debug = [g["name"] for g in self.db.graphs()]
                logger.error(f"Graph '{graph_name}' does not exist in ArangoDB. Graphs: {graph_names_for_debug}")
                return []

            v_col_exists = self.db.graph(graph_name).has_vertex_collection(collection_name)
            e_col_exists = self.db.graph(graph_name).has_edge_collection(collection_name)

            if not (v_col_exists or e_col_exists):
                collection_names = set()
                for e_d in self.db.graph(graph_name).edge_definitions():
                    collection_names.add(e_d["edge_collection"])
                    collection_names.update(e_d["from_vertex_collections"])  # list of source vertex collections
                    collection_names.update(e_d["to_vertex_collections"])  # list of destination vertex collections

                m = (
                    f"Collection '{collection_name}' does not exist in graph "
                    f"'{graph_name}'. Collections: {collection_names}"
                )
                logger.error(m)
                return []

            collection = self.db.collection(collection_name)
            collection_count = collection.count()

            if collection_count == 0:
                logger.error(f"Collection '{collection_name}' is empty.")
                return []

            if collection_count < num_centroids:
                m = (
                    f"Collection '{collection_name}' has fewer documents "
                    f"({collection_count}) than the number of centroids "
                    f"({num_centroids}). Please adjust the number of centroids."
                )
                logger.error(m)
                return []

            ################################
            # Retrieve Embedding Dimension #
            ################################

            random_doc = collection.random()
            random_doc_id = random_doc["_id"]
            sample_embedding = random_doc.get(ARANGO_EMBEDDING_FIELD)

            if not sample_embedding:
                logger.error(f"Document '{random_doc_id}' is missing field '{ARANGO_EMBEDDING_FIELD}'.")
                return []

            if not isinstance(sample_embedding, list):
                logger.error(f"Document '{random_doc_id}' has a non-list embedding field, found {type(embedding)}.")
                return []

            dimension = len(sample_embedding)

            if dimension == 0:
                logger.error(f"Document '{random_doc_id}' has an empty embedding field.")
                return []

            if OPENAI_API_KEY and OPENAI_EMBED_MODEL and OPENAI_EMBED_ENABLED:
                # OpenAI embeddings are not contrastive / instruction-tuned —
                # get_query_instruction(OPENAI_EMBED_MODEL) returns None for
                # any OpenAI model id, so the wrapper is never installed here.
                embeddings = OpenAIEmbeddings(model=OPENAI_EMBED_MODEL, dimensions=dimension)
            elif TEI_EMBEDDING_ENDPOINT and HF_TOKEN:
                embeddings = HuggingFaceEndpointEmbeddings(
                    model=TEI_EMBEDDING_ENDPOINT,
                    task="feature-extraction",
                    huggingfacehub_api_token=HF_TOKEN,
                )
                # Issue #1035 (generalized): contrastive / instruction-tuned
                # embedding models expect a query-side prefix at inference
                # (per their model card) to preserve the query/passage
                # asymmetry. Apply at the caller (here + chatqna) rather than
                # at the shared TEI service so dataprep ingestion (passages)
                # stays prefix-free.
                _query_instruction = get_query_instruction(TEI_EMBED_MODEL)
                if _query_instruction:
                    embeddings = QueryInstructionEmbeddingsWrapper(embeddings, _query_instruction)
            else:
                embeddings = HuggingFaceBgeEmbeddings(model_name=TEI_EMBED_MODEL)
                # Issue #1035: HuggingFaceBgeEmbeddings already prepends its
                # own query_instruction (default: "Represent this question
                # for searching relevant passages: ") inside embed_query().
                # Clear it so the wrapper's instruction is the sole prefix
                # applied — otherwise the local-fallback path double-prefixes.
                # Duck-type via attribute presence (conftest replaces the
                # langchain class with a MagicMock instance, so isinstance
                # checks are unreliable in tests).
                _query_instruction = get_query_instruction(TEI_EMBED_MODEL)
                if _query_instruction:
                    # Order matters: clear the langchain default BEFORE
                    # wrapping. Reordering these two lines hits the
                    # QueryInstructionEmbeddingsWrapper.__slots__ guard
                    # (wrapper has only `base` and `instruction`; setting
                    # `query_instruction` post-wrap raises AttributeError).
                    if hasattr(embeddings, "query_instruction"):
                        embeddings.query_instruction = ""
                    embeddings = QueryInstructionEmbeddingsWrapper(embeddings, _query_instruction)

            try:
                vector_db = ArangoVector(
                    embedding=embeddings,
                    embedding_dimension=dimension,
                    database=self.db,
                    collection_name=collection_name,
                    embedding_field=ARANGO_EMBEDDING_FIELD,
                    text_field=ARANGO_TEXT_FIELD,
                    distance_strategy=distance_strategy,
                    num_centroids=num_centroids,
                    search_type=search_mode,
                )
            except Exception as e:
                logger.error(f"Error during ArangoVector initialization: {e}")

                return []

            ######################
            # Compute Similarity #
            ######################

            if embedding is None:
                try:
                    embedding = embeddings.embed_query(query)
                except Exception as e:
                    logger.error(f"Failed to embed query text: {e}")
                    return []

            try:
                if input.search_type == "similarity_score_threshold":
                    # Find documents whose vector embeddings are similar to a query
                    # embedding and also return how similar they are.
                    # Returns a list like: [(doc1, 0.92), (doc2, 0.89), ...]
                    docs_and_similarities = await vector_db.asimilarity_search_with_relevance_scores(
                        query=query,
                        embedding=embedding,
                        k=input.k,
                        score_threshold=input.score_threshold,
                        use_approx=use_approx_search,
                        filter_clause=aql_filter_clause if search_start == "chunk" else "",
                    )
                    search_res = [{"doc": doc, "score": score} for doc, score in docs_and_similarities]
                elif input.search_type == "mmr":
                    # Find diverse but still relevant documents — useful when you want
                    # the results to not just be similar, but also not all the same.
                    # Balances similarity to the query and diversity between results.
                    # k: how many results to return
                    # fetch_k: how many top candidates to consider
                    # lambda_mult: the balance between similarity (high relevance) and novelty (diversity)
                    results = await vector_db.amax_marginal_relevance_search(
                        query=query,
                        embedding=embedding,
                        k=input.k,
                        fetch_k=input.fetch_k,
                        lambda_mult=input.lambda_mult,
                        use_approx=use_approx_search,
                        filter_clause=aql_filter_clause if search_start == "chunk" else "",
                    )
                    # MMR doesn't return scores — use relevance scores as fallback
                    docs_and_scores = await vector_db.asimilarity_search_with_relevance_scores(
                        query=query,
                        embedding=embedding,
                        k=input.k,
                        use_approx=use_approx_search,
                        filter_clause=aql_filter_clause if search_start == "chunk" else "",
                    )
                    score_map = {id(doc): score for doc, score in docs_and_scores}
                    search_res = [{"doc": doc, "score": score_map.get(id(doc), 0.0)} for doc in results]

                else:
                    # Default vector search — use relevance scores variant to get scores
                    docs_and_scores = await vector_db.asimilarity_search_with_relevance_scores(
                        query=query,
                        embedding=embedding,
                        k=input.k,
                        use_approx=use_approx_search,
                        filter_clause=aql_filter_clause if search_start == "chunk" else "",
                    )
                    search_res = [{"doc": doc, "score": score} for doc, score in docs_and_scores]

            except Exception as e:
                logger.error(f"Error during similarity search: {e}")
                return []

            # Defense-in-depth label filter on the DENSE results.
            # langchain-arangodb's filter_clause can be silently ignored in some
            # versions, letting wrong-label chunks through the dense path.
            # chunk_labels is stored in langchain Document metadata at ingest,
            # so dense docs carry it — re-apply _chunk_passes_label_filter.
            if labels_to_filter and search_res:
                search_res = [
                    r
                    for r in search_res
                    if _chunk_passes_label_filter(
                        (r["doc"].metadata or {}).get("chunk_labels", []),
                        labels_to_filter,
                        filter_strategy,
                    )
                ]

            # Snapshot the DENSE leg unconditionally, once the dense search and
            # the label filter have both settled. Deliberately ABOVE the hybrid
            # block: when HYBRID_RETRIEVAL_ENABLED is off, a snapshot
            # taken inside it would leave the variable undefined on every
            # non-hybrid request.
            _dense_by_id = {_result_key(r): _as_float(r.get("score")) for r in search_res}
            _scores_emitted = False

            # Hybrid BM25 + RRF fusion (Contextual Retrieval Part B)
            # Opt-in lexical (BM25) channel over <GRAPH>_SOURCE.text fused with
            # the dense results via weighted Reciprocal Rank Fusion. Runs BEFORE
            # the empty-check so a BM25 hit can rescue a dense-empty result (the
            # exact case lexical search excels at). OFF is a true no-op (the
            # whole block is skipped). Only applies to a chunk search start.
            if HYBRID_RETRIEVAL_ENABLED and search_start == "chunk":
                try:
                    bm25_n = max(int(input.k), HYBRID_BM25_CANDIDATES)
                    bm25_res = self._bm25_search(
                        query=query,
                        graph_name=graph_name,
                        n=bm25_n,
                        labels_to_filter=labels_to_filter,
                        filter_strategy=filter_strategy,
                        aql_filter_clause=aql_filter_clause if search_start == "chunk" else "",
                    )
                    if bm25_res:
                        _fused_all = rrf_fuse(search_res, bm25_res)
                        # The fused order drives EVERY array. rrf_fuse returns a
                        # new, de-duplicated, re-sorted list that can contain
                        # BM25-only chunks the dense leg never saw, so emitting
                        # the pre-fusion dense list beside it would make index i
                        # of two attributes describe different chunks.
                        _fused_keys = [_result_key(r) for r in _fused_all]
                        _bm25_by_id = {_result_key(r): _as_float(r.get("score")) for r in bm25_res}
                        for _key, _value in _retrieval_score_attributes(
                            keys=_fused_keys,
                            dense_by_id=_dense_by_id,
                            dense_present=[key in _dense_by_id for key in _fused_keys],
                            bm25_by_id=_bm25_by_id,
                            fused=[_as_float(r.get("score")) for r in _fused_all],
                        ).items():
                            span.set_attribute(_key, _value)
                        _scores_emitted = True
                        search_res = _fused_all[: int(input.k)]
                        logger.info(f"Hybrid RRF fusion: {len(search_res)} documents after fusing dense + BM25.")
                except Exception as e:
                    # Graceful degradation: never let the hybrid channel break the request.
                    logger.error(f"Hybrid BM25+RRF fusion failed, falling back to dense-only: {e}")

            if not search_res:
                logger.info("No documents found.")
                return []

            if not _scores_emitted:
                _dense_keys = [_result_key(r) for r in search_res]
                for _key, _value in _retrieval_score_attributes(
                    keys=_dense_keys,
                    dense_by_id=_dense_by_id,
                    dense_present=[True] * len(_dense_keys),
                ).items():
                    span.set_attribute(_key, _value)

            logger.info(f"Found {len(search_res)} documents.")
            logger.info(f"Search results after similarity search: {search_res}")

            # Retrieve file_id for each chunk using AQL (search_start == 'chunk')
            if search_start == "chunk":
                for r in search_res:
                    chunk_id = r["doc"].id if r["doc"].id else None
                    if chunk_id:
                        aql = f"""
                            FOR doc IN {collection_name}
                                FILTER doc._key == @chunk_id
                                RETURN doc.{ARANGO_FILE_ID_FIELD}
                        """
                        bind_vars = {"chunk_id": chunk_id}
                        cursor = self.db.aql.execute(aql, bind_vars=bind_vars)
                        file_ids = list(doc for doc in cursor)
                        r["doc"].metadata["file_ids"] = file_ids if file_ids else []
                logger.info(f"Adding file id metadata after similarity search: {search_res}")

            #######################################################################
            # Traverse Source Documents (based on ARANGO_TRAVERSAL_ENABLED value) #
            #######################################################################

            if enable_traversal:
                keys = [r["doc"].id for r in search_res]

                neighborhoods = self.fetch_neighborhoods(
                    db=vector_db.db,
                    keys=keys,  # A list of ids
                    graph_name=graph_name,
                    search_start=search_start,
                    query_embedding=embedding,
                    collection_name=collection_name,
                    traversal_max_depth=traversal_max_depth,
                    traversal_max_returned=traversal_max_returned,
                    traversal_score_threshold=traversal_score_threshold,
                    traversal_query=traversal_query,
                    distance_strategy=distance_strategy,
                )

                logger.info(f"Results after fetching neighborhood: {neighborhoods}")
                _injected_docs = 0
                _injected_neighbor_items = 0
                for r in search_res:
                    neighborhood = neighborhoods.get(r["doc"].id)

                    if not neighborhood:
                        continue

                    # Counted AFTER the empty-neighborhood guard, so these are
                    # documents that actually received injected content -- not
                    # documents the traversal was merely asked about.
                    _injected_docs += 1
                    _injected_neighbor_items += len(neighborhood) if isinstance(neighborhood, (list, tuple)) else 1

                    # Common header for added related info
                    r["doc"].page_content += "\n------\nRELATED INFORMATION:\n------\n"

                    if search_start == "chunk":
                        # neighborhood may be a list or other structure
                        r["doc"].page_content += str(neighborhood)

                    elif search_start == "edge":
                        # neighborhood is expected to be a list with one dict: [{ "chunk_text": ..., "file_id": ... }]
                        first = neighborhood[0] if isinstance(neighborhood, list) and neighborhood else None
                        if isinstance(first, dict):
                            # first may contain 'chunk_text' and 'file_id' keys directly
                            chunk_text = first.get("chunk_text")
                            file_id = first.get("file_id")
                        else:
                            # fallback: if it's nested like { edge_text: { "chunk_text": ..., "file_id": ... } }
                            chunk_text = None
                            file_id = None
                            if isinstance(first, dict):
                                inner = next(iter(first.values()), None)
                                if isinstance(inner, dict):
                                    chunk_text = inner.get("chunk_text")
                                    file_id = inner.get("file_id")

                        if chunk_text:
                            r["doc"].page_content += str(chunk_text)
                        if file_id:
                            r["doc"].metadata["file_ids"] = r["doc"].metadata.get("file_ids", []) + [file_id]

                    else:
                        # search_start == 'node'
                        # neighborhood: list of dicts, each with single key mapping to inner dict:
                        # e.g. [{ edge_text: { "chunk_text": ..., "file_id": ... } }, ...]
                        first_item = neighborhood[0] if isinstance(neighborhood, list) and neighborhood else None
                        inner = None

                        if isinstance(first_item, dict):
                            # normally it's a dict mapping edge_text -> {...}
                            inner = next(iter(first_item.values()), None)
                        elif isinstance(first_item, list):
                            # defensive: if it's a nested list (older bug) take first element
                            maybe = first_item[0] if first_item else None
                            if isinstance(maybe, dict):
                                inner = next(iter(maybe.values()), None)

                        if isinstance(inner, dict):
                            chunk_text = inner.get("chunk_text")
                            file_id = inner.get("file_id")
                            if chunk_text:
                                r["doc"].page_content += str(chunk_text)
                            if file_id:
                                r["doc"].metadata["file_ids"] = r["doc"].metadata.get("file_ids", []) + [file_id]

                span.set_attribute(A["traversal_injected_docs"], _injected_docs)
                span.set_attribute(A["traversal_injected_neighbor_items"], _injected_neighbor_items)
                logger.info(f"Added neighborhoods to {len(search_res)} documents.")

            ################################
            # Summarize Results (optional) #
            ################################

            if enable_summarizer:
                # Track overflow attribution across the per-chunk loop so a
                # single ingest with N overflows surfaces N+ids, not a single
                # boolean. Operators triage via VictoriaTraces; count + ids let
                # them pick the right docs to re-ingest with chunk-size overrides.
                overflow_count = 0
                overflow_doc_ids: list[str] = []
                for r in search_res:
                    prompt = self.generate_summarization_prompt(query, r["doc"].page_content)
                    try:
                        res = self._get_llm().invoke(prompt)
                        summarized_text = res.content
                    except Exception as _e_sum:
                        # Fail-loud on vLLM context overflow: skip summarization
                        # rather than bubble a 500 to the chatqna orchestrator.
                        # Shared classifier lives in dataprep (aggregates str(),
                        # openai body dict, httpx response body, aiohttp message).
                        # "string too long" was removed (over-broad — fires on
                        # tool_calls[id] oversize, not just context overflow).
                        from dataprep.genieai_dataprep_arangodb import _is_vllm_input_overflow

                        if _is_vllm_input_overflow(_e_sum):
                            logger.warning(
                                f"Summarizer skipped: vLLM context overflow for {r['doc'].id!r}: "
                                f"{type(_e_sum).__name__}: {str(_e_sum)[:200]}"
                            )
                            overflow_count += 1
                            # The chunk identity contract: prefer `metadata["chunk_key"]`
                            # which the code at L~1387 ensures is populated for EVERY
                            # doc (dense + BM25 channels). Falls back to `doc.id`
                            # (langchain raw id which may be a UUID), then to a
                            # stable "unknown" sentinel — never `str(None)` which
                            # would surface as the literal string "None" in the
                            # OTel attribute and mislead operator triage.
                            _chunk_key = (
                                (r["doc"].metadata.get("chunk_key") if r["doc"].metadata else None)
                                or getattr(r["doc"], "id", None)
                                or "unknown"
                            )
                            overflow_doc_ids.append(str(_chunk_key))
                            continue
                        raise
                    logger.info(f"Summarized {r['doc'].id}")

                    r["doc"].page_content = summarized_text
                # Emit cumulative attribution ONCE per ingest (cheap; one OTel
                # attribute write per ingest instead of N per overflow).
                if overflow_count:
                    with suppress(Exception):
                        span.set_attribute("retriever.summarizer.input_too_long", True)
                        span.set_attribute("retriever.summarizer.overflow_count", overflow_count)
                        span.set_attribute(
                            "retriever.summarizer.overflow_doc_ids",
                            _overflow_doc_ids_json(overflow_doc_ids),
                        )

            ##################################################################
            # Attach Chunk Embeddings (for adaptive reranking)                #
            ##################################################################
            # When adaptive reranking is requested, expose each chunk's stored
            # embedding. langchain already returns the embedding field in the
            # search-result metadata, so read it directly — no extra ArangoDB
            # round-trip and no chunk-key matching. The retriever microservice
            # assembles these into an ordered chunk_embeddings list for the reranker.
            reranking_strategy = input_dict.get("reranking_strategy", os.getenv("RERANKING_STRATEGY", "adaptive"))
            # Preserve chunk_key in metadata for ALL docs (dense + BM25) so it
            # survives the retriever->chatqna handoff (langchain mangles
            # Document.id to a UUID). BM25 sets it at construction; dense
            # (langchain) may expose it via metadata["_key"]; else fallback to
            # the (possibly mangled) .id. chatqna's reranker_selection span reads
            # this for retrieval eval (see _emit_reranker_selection_span).
            if search_res:
                for r in search_res:
                    md = r["doc"].metadata or {}
                    if not md.get("chunk_key"):
                        md["chunk_key"] = md.get("_key") or r["doc"].id
                    r["doc"].metadata = md

            if reranking_strategy == "adaptive" and search_res:
                for r in search_res:
                    metadata = r["doc"].metadata or {}
                    # The chunk embedding is in the search-result metadata (langchain
                    # returns it via embedding_field). Read it directly; fall back to an
                    # AQL lookup by _key if it is absent.
                    emb = metadata.pop(ARANGO_EMBEDDING_FIELD, None)
                    if not (isinstance(emb, list) and emb):
                        chunk_key = r["doc"].id
                        if chunk_key and "/" in str(chunk_key):
                            chunk_key = str(chunk_key).rsplit("/", 1)[-1]
                        if chunk_key:
                            try:
                                aql = (
                                    f"FOR doc IN {collection_name} FILTER doc._key == @k"
                                    f" RETURN doc.{ARANGO_EMBEDDING_FIELD}"
                                )
                                emb = next(iter(self.db.aql.execute(aql, bind_vars={"k": chunk_key})), [])
                            except Exception as e:
                                logger.error(f"[ADAPTIVE] AQL fetch failed for {chunk_key}: {e}")
                                emb = []
                    r["doc"].metadata["chunk_embedding"] = emb if isinstance(emb, list) and emb else []
                    logger.info(
                        f"[ADAPTIVE] doc_id={r['doc'].id!r} meta_keys={list(metadata.keys())} "
                        f"chunk_emb_len={len(r['doc'].metadata['chunk_embedding'])}"
                    )
                logger.info(f"Attached chunk embeddings for {len(search_res)} chunks (adaptive reranking)")

            # Echo the query embedding via metadata so the microservice propagates
            # it to the reranker (adaptive novelty scoring needs the query vector).
            if search_res:
                search_res[0]["doc"].metadata["query_embedding"] = embedding

            if logflag:
                logger.debug(f"Final results of retrievers/src/integrations/arangodb_genieai.py: {search_res}")

            ################################
            #  Returning Powerful Results  #
            ################################

            finish = time.time()
            if logflag:
                logger.info(f"Retreiver logic completion time: {finish - start:.4f} seconds")

            span.set_attribute("rag.chunk_count", len(search_res))
        finally:
            span.end()

        return search_res
