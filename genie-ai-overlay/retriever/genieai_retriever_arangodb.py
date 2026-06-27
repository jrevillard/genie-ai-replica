# Copyright (C) 2025 Intel Corporation
# SPDX-License-Identifier: Apache-2.0

import os
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
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
from tracing import setup_trace_logging

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
logflag = os.getenv("LOGFLAG", False)

ARANGO_TEXT_FIELD = "text"
ARANGO_EMBEDDING_FIELD = "embedding"
ARANGO_FILE_ID_FIELD = "file_id"


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
            raise HTTPException(status_code=400, detail="No LLM environment variables are set, cannot generate graphs.")

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
            if not self.db.has_view(view_name):
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

    def _bm25_search(self, query: str, graph_name: str, n: int, labels_to_filter: list, filter_strategy: str) -> list:
        """Run a BM25 lexical search over the chunk view (Contextual Retrieval Part B).

        Returns the same shape as the dense search: ``[{"doc": Document, "score": float}]``.
        Candidates are filtered by the same ``chunk_labels`` semantics as the dense
        path (OR/AND) before fusion. ``doc.id`` is the chunk ``_key`` so RRF can
        match identities across channels. Never raises — logs and returns [].
        """
        self._ensure_bm25_view(graph_name)
        view_name = f"{graph_name}_BM25_VIEW"

        aql = f"""
            FOR doc IN {view_name}
                SEARCH ANALYZER(doc.{ARANGO_TEXT_FIELD} IN TOKENS(@query, @analyzer), @analyzer)
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
                    # file_ids is resolved uniformly (dense + BM25) by the
                    # existing per-chunk enrichment AQL downstream; keep only
                    # chunk_labels here so the metadata shape stays consistent.
                    metadata={"chunk_labels": chunk_labels or []},
                )
                results.append({"doc": doc, "score": float(row.get("score") or 0.0)})
        except Exception as e:
            logger.error(f"BM25 search failed on view '{view_name}': {e}")
        return results

    def check_health(self) -> bool:
        """Checks the health of the retriever service."""
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

        try:
            #################
            # Process Input #
            #################

            input_dict = input.model_dump(exclude_none=True)
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

            # Consolidate all labels into a single list (this will need to change later)
            labels_to_filter = []
            if filter_data.get("categoryLabel"):
                labels_to_filter.append(filter_data["categoryLabel"])
            if filter_data.get("serviceLabels"):
                labels_to_filter.extend(filter_data["serviceLabels"])

            # CONSTRUCT THE AQL FILTER CLAUSE
            aql_filter_clause = ""

            if labels_to_filter:
                labels_array = "[" + ", ".join(f'"{label}"' for label in labels_to_filter) + "]"

                if filter_strategy == "AND":
                    # ALL operator: chunk_labels must contain all labels from our list
                    aql_filter_clause = (
                        f"FILTER (doc.chunk_labels != null) AND ({labels_array} ALL IN doc.chunk_labels)"
                    )
                elif filter_strategy == "OR":
                    # ANY operator: chunk_labels must contain at least one label from our list
                    aql_filter_clause = (
                        f"FILTER (doc.chunk_labels != null) AND ({labels_array} ANY IN doc.chunk_labels)"
                    )
                else:
                    raise HTTPException(
                        status_code=400, detail=f"Invalid filter_strategy: {filter_strategy}. Expected 'AND' or 'OR'."
                    )

                if logflag:
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
                embeddings = OpenAIEmbeddings(model=OPENAI_EMBED_MODEL, dimensions=dimension)
            elif TEI_EMBEDDING_ENDPOINT and HF_TOKEN:
                embeddings = HuggingFaceEndpointEmbeddings(
                    model=TEI_EMBEDDING_ENDPOINT,
                    task="feature-extraction",
                    huggingfacehub_api_token=HF_TOKEN,
                )
            else:
                embeddings = HuggingFaceBgeEmbeddings(model_name=TEI_EMBED_MODEL)

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
                    )
                    if bm25_res:
                        search_res = rrf_fuse(search_res, bm25_res)[: int(input.k)]
                        logger.info(f"Hybrid RRF fusion: {len(search_res)} documents after fusing dense + BM25.")
                except Exception as e:
                    # Graceful degradation: never let the hybrid channel break the request.
                    logger.error(f"Hybrid BM25+RRF fusion failed, falling back to dense-only: {e}")

            if not search_res:
                logger.info("No documents found.")
                return []

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
                for r in search_res:
                    neighborhood = neighborhoods.get(r["doc"].id)

                    if not neighborhood:
                        continue

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

                logger.info(f"Added neighborhoods to {len(search_res)} documents.")

            ################################
            # Summarize Results (optional) #
            ################################

            if enable_summarizer:
                for r in search_res:
                    prompt = self.generate_summarization_prompt(query, r["doc"].page_content)
                    res = self._get_llm().invoke(prompt)
                    summarized_text = res.content

                    logger.info(f"Summarized {r['doc'].id}")

                    r["doc"].page_content = summarized_text

            ##################################################################
            # Attach Chunk Embeddings (for adaptive reranking)                #
            ##################################################################
            # When adaptive reranking is requested, expose each chunk's stored
            # embedding. langchain already returns the embedding field in the
            # search-result metadata, so read it directly — no extra ArangoDB
            # round-trip and no chunk-key matching. The retriever microservice
            # assembles these into an ordered chunk_embeddings list for the reranker.
            reranking_strategy = input_dict.get("reranking_strategy", os.getenv("RERANKING_STRATEGY", "slice"))
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
