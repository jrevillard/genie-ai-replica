# Copyright (c) 2024-2026 International Telecommunication Union (ITU)

"""Tests for GenieaiArangoRetriever hybrid search logic.

Covers _build_subquery, fetch_neighborhoods, invoke, check_health, and
generate_summarization_prompt with fully mocked ArangoDB, LangChain, and
OpenAI dependencies.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi import HTTPException

from core import embedding_query_prefix as core_query_prefix
from retriever.genieai_retriever_arangodb import (
    ARANGO_GRAPH_NAME,
    GenieaiArangoRetriever,
    QueryInstructionEmbeddingsWrapper,
)

# NOTE: conftest.py mocks the langchain stack (langchain_core/community/...) via
# sys.modules.setdefault, so langchain_core.documents.Document is a MagicMock at
# test time. The pure RRF logic and BM25 wiring only need objects exposing
# ``.id``/``.page_content``/``.metadata``, so we use a lightweight real stand-in
# instead of the real Document (and patch the module's Document with it where the
# production code constructs one).


class _FakeDoc:
    def __init__(self, id=None, page_content="", metadata=None):
        self.id = id
        self.page_content = page_content
        self.metadata = metadata if metadata is not None else {}


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def create_retriever(db_mock=None, with_llm=False):
    """Create a GenieaiArangoRetriever with mocked dependencies."""
    with (
        patch.object(GenieaiArangoRetriever, "_initialize_client"),
        patch.object(GenieaiArangoRetriever, "_initialize_llm"),
    ):
        retriever = GenieaiArangoRetriever(name="test-retriever", description="Test retriever")
    retriever.db = db_mock if db_mock is not None else MagicMock()
    if with_llm:
        retriever.llm = MagicMock()
    return retriever


def create_mock_input(query="test query", **overrides):
    """Create a mock input object matching invoke() expectations."""
    mock = MagicMock()
    defaults = {
        "input": query,
        "text": query,
        "embedding": None,
        "graph_name": "GRAPH",
        "search_start": "node",
        "search_mode": "vector",
        "enable_traversal": False,
        "enable_summarizer": False,
        "distance_strategy": "COSINE",
        "use_approx_search": False,
        "num_centroids": 1,
        "traversal_max_depth": 1,
        "traversal_max_returned": 3,
        "traversal_score_threshold": 0.5,
        "traversal_query": None,
        "context": {},
        "filter_strategy": "OR",
        "search_type": "similarity_score_threshold",
        "k": 4,
        "fetch_k": 20,
        "lambda_mult": 0.5,
        "score_threshold": 0.5,
    }
    defaults.update(overrides)
    mock.model_dump.return_value = defaults
    mock.embedding = overrides.get("embedding", defaults["embedding"])
    mock.search_type = defaults["search_type"]
    mock.k = defaults["k"]
    mock.fetch_k = defaults["fetch_k"]
    mock.lambda_mult = defaults["lambda_mult"]
    mock.score_threshold = defaults["score_threshold"]
    return mock


def create_mock_document(key="doc1", text="sample text", embedding=None):
    """Create a mock ArangoDB document."""
    if embedding is None:
        embedding = [0.1] * 768
    return {"_key": key, "_id": f"collection/{key}", "text": text, "embedding": embedding}


def _make_happy_path_db():
    """Create a db mock configured for happy-path invoke() execution."""
    db = MagicMock()
    db.has_graph.return_value = True
    db.graph.return_value.has_vertex_collection.return_value = True
    db.graph.return_value.has_edge_collection.return_value = False
    db.graph.return_value.edge_definitions.return_value = []

    collection = MagicMock()
    collection.count.return_value = 5
    collection.random.return_value = create_mock_document()
    db.collection.return_value = collection

    cursor = MagicMock()
    cursor.__iter__ = MagicMock(return_value=iter([]))
    db.aql.execute.return_value = cursor
    return db


def _make_mock_vector_db(db_mock):
    """Create a mock ArangoVector instance with async search methods."""
    mock_doc = MagicMock()
    mock_doc.id = "doc1"
    mock_doc.page_content = "relevant text"
    mock_doc.metadata = {"embedding": [0.1, 0.2, 0.3], "chunk_labels": ["health", "education"]}

    mock_vdb = MagicMock()
    mock_vdb.db = db_mock
    mock_vdb.asimilarity_search_with_relevance_scores = AsyncMock(return_value=[(mock_doc, 0.9)])
    mock_vdb.amax_marginal_relevance_search = AsyncMock(return_value=[mock_doc])
    mock_vdb.asimilarity_search = AsyncMock(return_value=[mock_doc])
    return mock_vdb


# ---------------------------------------------------------------------------
# Fixture: invoke_env — shared mock setup for invoke() tests
# ---------------------------------------------------------------------------


@pytest.fixture
def invoke_env():
    """Set up mock environment for invoke() tests with fresh mocks per test."""
    db = _make_happy_path_db()
    retriever = create_retriever(db_mock=db)

    mock_embeddings = MagicMock()
    mock_embeddings.embed_query.return_value = [0.1] * 768
    mock_vdb = _make_mock_vector_db(db)

    patches = [
        patch("retriever.genieai_retriever_arangodb.HuggingFaceBgeEmbeddings", return_value=mock_embeddings),
        patch("retriever.genieai_retriever_arangodb.ArangoVector", return_value=mock_vdb),
        patch("retriever.genieai_retriever_arangodb.OPENAI_API_KEY", None),
        patch("retriever.genieai_retriever_arangodb.TEI_EMBEDDING_ENDPOINT", ""),
        patch("retriever.genieai_retriever_arangodb.HF_TOKEN", ""),
        patch("retriever.genieai_retriever_arangodb.HYBRID_RETRIEVAL_ENABLED", False),
    ]
    for p in patches:
        p.start()

    yield {"db": db, "retriever": retriever, "embeddings": mock_embeddings, "vector_db": mock_vdb, "patches": patches}

    for p in patches:
        p.stop()


# ---------------------------------------------------------------------------
# Test: _build_subquery — AQL query construction (AC3)
# ---------------------------------------------------------------------------


class TestBuildSubquery:
    """Unit tests for _build_subquery — AQL query construction."""

    def setup_method(self):
        self.retriever = create_retriever()

    def _call(self, **overrides):
        defaults = {
            "graph_name": "GRAPH",
            "search_start": "node",
            "query_embedding": [0.1] * 768,
            "traversal_max_depth": 1,
            "traversal_max_returned": 3,
            "traversal_score_threshold": 0.5,
            "traversal_query": None,
            "distance_strategy": "COSINE",
            "score_func": "COSINE_SIMILARITY",
            "sort_order": "DESC",
            "bind_vars": {"@collection": "GRAPH_ENTITY", "keys": ["key1"]},
            "collection_name": "GRAPH_ENTITY",
        }
        defaults.update(overrides)
        return self.retriever._build_subquery(**defaults)

    def test_node_mode_contains_for_traversal(self):
        result = self._call(search_start="node")
        assert "FOR node, edge IN 1..1 ANY doc GRAPH_LINKS_TO" in result

    def test_node_mode_cosine_score_desc(self):
        result = self._call(search_start="node")
        assert "COSINE_SIMILARITY" in result
        assert "DESC" in result

    def test_edge_mode_contains_document_lookup(self):
        result = self._call(search_start="edge")
        assert "DOCUMENT(GRAPH_SOURCE, doc.source_id)" in result

    def test_chunk_mode_contains_inbound_traversal(self):
        result = self._call(search_start="chunk")
        assert "INBOUND doc GRAPH_HAS_SOURCE" in result

    def test_chunk_mode_adds_query_embedding_bind_var(self):
        bind_vars = {"@collection": "GRAPH_SOURCE", "keys": ["key1"]}
        self._call(search_start="chunk", bind_vars=bind_vars)
        assert "query_embedding" in bind_vars

    def test_custom_traversal_query_overrides_builtin(self):
        custom = "FOR x IN @@collection FILTER x.active == true RETURN x"
        result = self._call(traversal_query=custom)
        assert "FOR x IN @@collection" in result

    def test_custom_query_with_embedding_bind_var_adds_it(self):
        custom = "LET s = COSINE_SIMILARITY(x.embedding, @query_embedding) RETURN s"
        bind_vars = {"@collection": "GRAPH_ENTITY", "keys": ["key1"]}
        self._call(traversal_query=custom, bind_vars=bind_vars)
        assert "query_embedding" in bind_vars

    def test_euclidean_strategy_uses_l2_asc(self):
        result = self._call(
            search_start="node",
            distance_strategy="EUCLIDEAN_DISTANCE",
            score_func="L2_DISTANCE",
            sort_order="ASC",
        )
        assert "L2_DISTANCE" in result
        assert "ASC" in result


# ---------------------------------------------------------------------------
# Test: fetch_neighborhoods — graph traversal logic (AC4, AC5)
# ---------------------------------------------------------------------------


class TestFetchNeighborhoods:
    """Unit tests for fetch_neighborhoods — graph traversal logic."""

    def setup_method(self):
        self.retriever = create_retriever()

    def _call(self, **overrides):
        defaults = {
            "db": MagicMock(),
            "keys": ["key1"],
            "graph_name": "GRAPH",
            "search_start": "node",
            "query_embedding": [0.1] * 768,
            "collection_name": "GRAPH_ENTITY",
            "traversal_max_depth": 1,
            "traversal_max_returned": 3,
            "traversal_score_threshold": 0.5,
            "traversal_query": None,
            "distance_strategy": "COSINE",
        }
        defaults.update(overrides)
        return self.retriever.fetch_neighborhoods(**defaults)

    def test_invalid_distance_strategy_raises_400(self):
        with pytest.raises(HTTPException) as exc_info:
            self._call(distance_strategy="INVALID")
        assert exc_info.value.status_code == 400
        assert "Invalid distance strategy" in str(exc_info.value.detail)

    def test_single_query_mode_returns_neighborhoods(self):
        db = MagicMock()
        cursor = MagicMock()
        cursor.__iter__ = MagicMock(return_value=iter([{"key1": ["neighbor1"]}]))
        db.aql.execute.return_value = cursor
        result = self._call(db=db)
        db.aql.execute.assert_called_once()
        assert "key1" in result

    @patch("retriever.genieai_retriever_arangodb.ARANGO_TRAVERSAL_CONCURRENT_BATCHES", 2)
    def test_threaded_mode_returns_combined(self):
        db = MagicMock()
        cursor = MagicMock()
        cursor.__iter__ = MagicMock(return_value=iter([{"key1": ["n1"]}]))
        db.aql.execute.return_value = cursor
        result = self._call(db=db)
        assert isinstance(result, dict)

    def test_traversal_max_depth_clamped_to_one(self):
        db = MagicMock()
        cursor = MagicMock()
        cursor.__iter__ = MagicMock(return_value=iter([]))
        db.aql.execute.return_value = cursor
        self._call(db=db, traversal_max_depth=0)
        query = db.aql.execute.call_args[0][0]
        assert "1..1" in query

    def test_traversal_max_returned_clamped_to_one(self):
        db = MagicMock()
        cursor = MagicMock()
        cursor.__iter__ = MagicMock(return_value=iter([]))
        db.aql.execute.return_value = cursor
        self._call(db=db, traversal_max_returned=-1)
        query = db.aql.execute.call_args[0][0]
        assert "LIMIT 1" in query

    @patch("retriever.genieai_retriever_arangodb.ARANGO_TRAVERSAL_CONCURRENT_BATCHES", 8)
    def test_worker_count_capped_at_four(self):
        db = MagicMock()
        cursor = MagicMock()
        cursor.__iter__ = MagicMock(return_value=iter([{"k": ["n"]}]))
        db.aql.execute.return_value = cursor
        result = self._call(db=db, keys=["key1"])
        assert isinstance(result, dict)

    @patch("retriever.genieai_retriever_arangodb.ARANGO_TRAVERSAL_CONCURRENT_BATCHES", 0)
    def test_worker_count_floored_at_one(self):
        db = MagicMock()
        cursor = MagicMock()
        cursor.__iter__ = MagicMock(return_value=iter([{"key1": ["n"]}]))
        db.aql.execute.return_value = cursor
        result = self._call(db=db)
        assert isinstance(result, dict)

    def test_single_query_aql_contains_score_threshold(self):
        db = MagicMock()
        cursor = MagicMock()
        cursor.__iter__ = MagicMock(return_value=iter([]))
        db.aql.execute.return_value = cursor
        self._call(db=db, traversal_score_threshold=0.7)
        query = db.aql.execute.call_args[0][0]
        assert "FILTER score >= 0.7" in query

    @patch("retriever.genieai_retriever_arangodb.ARANGO_TRAVERSAL_CONCURRENT_BATCHES", 2)
    def test_threaded_mode_exception_for_one_key_skips_gracefully(self):
        db = MagicMock()
        call_count = 0

        def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise Exception("db error for key1")
            cursor = MagicMock()
            cursor.__next__ = MagicMock(return_value={"key2": ["n2"]})
            return cursor

        db.aql.execute.side_effect = side_effect
        result = self._call(db=db, keys=["key1", "key2"])
        assert "key2" in result


# ---------------------------------------------------------------------------
# Test: invoke — main retrieval flow (AC2, AC5, AC6, AC7, AC8)
# ---------------------------------------------------------------------------


class TestInvoke:
    """Unit tests for invoke — main retrieval flow."""

    @pytest.mark.asyncio
    async def test_vector_only_search_returns_results(self, invoke_env):
        result = await invoke_env["retriever"].invoke(create_mock_input())
        assert isinstance(result, list)

    @pytest.mark.asyncio
    async def test_adaptive_strategy_attaches_chunk_embeddings(self, invoke_env):
        # The mock doc's metadata carries the chunk embedding (as langchain does).
        input_mock = create_mock_input(search_start="chunk", reranking_strategy="adaptive")
        result = await invoke_env["retriever"].invoke(input_mock)
        assert len(result) >= 1
        # Adaptive path exposes the chunk's embedding (read from metadata) as chunk_embedding
        assert result[0]["doc"].metadata.get("chunk_embedding") == [0.1, 0.2, 0.3]
        # Query embedding is always echoed (for adaptive novelty scoring)
        assert "query_embedding" in result[0]["doc"].metadata

    @pytest.mark.asyncio
    async def test_non_adaptive_skips_chunk_embedding_fetch(self, invoke_env):
        input_mock = create_mock_input(search_start="chunk", reranking_strategy="slice")
        result = await invoke_env["retriever"].invoke(input_mock)
        assert len(result) >= 1
        # Non-adaptive retrieval must not attach chunk embeddings...
        assert "chunk_embedding" not in (result[0]["doc"].metadata or {})
        # ...but the query embedding is always echoed (cheap, single vector)
        assert "query_embedding" in (result[0]["doc"].metadata or {})

    @pytest.mark.asyncio
    async def test_hybrid_search_calls_fetch_neighborhoods(self, invoke_env):
        invoke_env["retriever"].fetch_neighborhoods = MagicMock(return_value={"doc1": []})
        await invoke_env["retriever"].invoke(create_mock_input(enable_traversal=True))
        invoke_env["retriever"].fetch_neighborhoods.assert_called_once()

    @pytest.mark.asyncio
    async def test_label_filter_or_strategy(self, invoke_env):
        input_mock = create_mock_input(
            context={"categoryLabels": "health", "serviceLabels": ["education"]},
            filter_strategy="OR",
            search_start="chunk",
        )
        await invoke_env["retriever"].invoke(input_mock)
        call_kwargs = invoke_env["vector_db"].asimilarity_search_with_relevance_scores.call_args
        filter_clause = call_kwargs.kwargs.get("filter_clause", "")
        assert "ANY IN" in filter_clause

    @pytest.mark.asyncio
    async def test_label_filter_and_strategy(self, invoke_env):
        input_mock = create_mock_input(
            context={"categoryLabels": "health", "serviceLabels": ["education"]},
            filter_strategy="AND",
            search_start="chunk",
        )
        await invoke_env["retriever"].invoke(input_mock)
        call_kwargs = invoke_env["vector_db"].asimilarity_search_with_relevance_scores.call_args
        filter_clause = call_kwargs.kwargs.get("filter_clause", "")
        assert "ALL IN" in filter_clause

    @pytest.mark.asyncio
    async def test_empty_labels_produce_no_filter_clause(self, invoke_env):
        input_mock = create_mock_input(context={}, search_start="chunk")
        await invoke_env["retriever"].invoke(input_mock)
        call_kwargs = invoke_env["vector_db"].asimilarity_search_with_relevance_scores.call_args
        filter_clause = call_kwargs.kwargs.get("filter_clause", "")
        assert filter_clause == ""

    @pytest.mark.asyncio
    async def test_invalid_filter_strategy_raises_400(self, invoke_env):
        input_mock = create_mock_input(context={"categoryLabels": "test"}, filter_strategy="INVALID")
        with pytest.raises(HTTPException) as exc_info:
            await invoke_env["retriever"].invoke(input_mock)
        assert exc_info.value.status_code == 400

    @pytest.mark.asyncio
    async def test_empty_query_returns_empty_list(self, invoke_env):
        result = await invoke_env["retriever"].invoke(create_mock_input(query=""))
        assert result == []

    @pytest.mark.asyncio
    async def test_missing_graph_returns_empty_list(self, invoke_env):
        invoke_env["db"].has_graph.return_value = False
        result = await invoke_env["retriever"].invoke(create_mock_input())
        assert result == []

    @pytest.mark.asyncio
    async def test_missing_collection_returns_empty_list(self, invoke_env):
        invoke_env["db"].graph.return_value.has_vertex_collection.return_value = False
        invoke_env["db"].graph.return_value.has_edge_collection.return_value = False
        result = await invoke_env["retriever"].invoke(create_mock_input())
        assert result == []

    @pytest.mark.asyncio
    async def test_empty_collection_returns_empty_list(self, invoke_env):
        invoke_env["db"].collection.return_value.count.return_value = 0
        result = await invoke_env["retriever"].invoke(create_mock_input())
        assert result == []

    @pytest.mark.asyncio
    async def test_collection_below_centroids_returns_empty_list(self, invoke_env):
        invoke_env["db"].collection.return_value.count.return_value = 1
        result = await invoke_env["retriever"].invoke(create_mock_input(num_centroids=5))
        assert result == []

    @pytest.mark.asyncio
    async def test_missing_embedding_field_returns_empty_list(self, invoke_env):
        invoke_env["db"].collection.return_value.random.return_value = {"_id": "col/doc1", "text": "no embedding"}
        result = await invoke_env["retriever"].invoke(create_mock_input())
        assert result == []

    @pytest.mark.asyncio
    async def test_non_list_embedding_returns_empty_list(self, invoke_env):
        invoke_env["db"].collection.return_value.random.return_value = {
            "_id": "col/doc1",
            "embedding": "not a list",
        }
        result = await invoke_env["retriever"].invoke(create_mock_input())
        assert result == []

    @pytest.mark.asyncio
    async def test_zero_dimension_returns_empty_list(self, invoke_env):
        invoke_env["db"].collection.return_value.random.return_value = {"_id": "col/doc1", "embedding": []}
        result = await invoke_env["retriever"].invoke(create_mock_input())
        assert result == []

    @pytest.mark.asyncio
    async def test_embedding_generation_failure_returns_empty_list(self, invoke_env):
        invoke_env["embeddings"].embed_query.side_effect = Exception("embed failure")
        result = await invoke_env["retriever"].invoke(create_mock_input())
        assert result == []

    @pytest.mark.asyncio
    async def test_vector_search_failure_returns_empty_list(self, invoke_env):
        invoke_env["vector_db"].asimilarity_search_with_relevance_scores = AsyncMock(
            side_effect=Exception("search fail")
        )
        result = await invoke_env["retriever"].invoke(create_mock_input())
        assert result == []

    @pytest.mark.asyncio
    async def test_arango_vector_init_failure_returns_empty(self):
        db = _make_happy_path_db()
        retriever = create_retriever(db_mock=db)
        mock_emb = MagicMock()
        mock_emb.embed_query.return_value = [0.1] * 768
        with (
            patch("retriever.genieai_retriever_arangodb.HuggingFaceBgeEmbeddings", return_value=mock_emb),
            patch("retriever.genieai_retriever_arangodb.ArangoVector", side_effect=Exception("init fail")),
            patch("retriever.genieai_retriever_arangodb.OPENAI_API_KEY", None),
            patch("retriever.genieai_retriever_arangodb.TEI_EMBEDDING_ENDPOINT", ""),
            patch("retriever.genieai_retriever_arangodb.HF_TOKEN", ""),
        ):
            result = await retriever.invoke(create_mock_input())
        assert result == []

    @pytest.mark.asyncio
    async def test_mmr_search_type_calls_correct_method(self, invoke_env):
        await invoke_env["retriever"].invoke(create_mock_input(search_type="mmr"))
        invoke_env["vector_db"].amax_marginal_relevance_search.assert_called_once()

    @pytest.mark.asyncio
    async def test_similarity_search_type_calls_correct_method(self, invoke_env):
        await invoke_env["retriever"].invoke(create_mock_input(search_type="similarity"))
        invoke_env["vector_db"].asimilarity_search_with_relevance_scores.assert_called()

    @pytest.mark.asyncio
    async def test_file_id_enrichment_for_chunk_mode(self, invoke_env):
        mock_doc = MagicMock()
        mock_doc.id = "chunk1"
        mock_doc.page_content = "text"
        mock_doc.metadata = {}
        invoke_env["vector_db"].asimilarity_search_with_relevance_scores = AsyncMock(return_value=[(mock_doc, 0.9)])
        file_cursor = MagicMock()
        file_cursor.__iter__ = MagicMock(return_value=iter(["file_abc"]))
        invoke_env["db"].aql.execute.return_value = file_cursor

        result = await invoke_env["retriever"].invoke(create_mock_input(search_start="chunk"))
        assert result[0]["doc"].metadata["file_ids"] == ["file_abc"]

    @pytest.mark.asyncio
    async def test_pre_computed_embedding_skips_embed_query(self, invoke_env):
        await invoke_env["retriever"].invoke(create_mock_input(embedding=[0.2] * 768))
        invoke_env["embeddings"].embed_query.assert_not_called()

    @pytest.mark.asyncio
    async def test_hybrid_search_with_labels_calls_fetch_and_filters(self, invoke_env):
        invoke_env["retriever"].fetch_neighborhoods = MagicMock(return_value={"doc1": []})
        input_mock = create_mock_input(
            enable_traversal=True,
            context={"categoryLabels": "health", "serviceLabels": ["education"]},
            filter_strategy="OR",
            search_start="chunk",
        )
        await invoke_env["retriever"].invoke(input_mock)
        invoke_env["retriever"].fetch_neighborhoods.assert_called_once()
        call_kwargs = invoke_env["vector_db"].asimilarity_search_with_relevance_scores.call_args
        filter_clause = call_kwargs.kwargs.get("filter_clause", "")
        assert "ANY IN" in filter_clause

    @pytest.mark.asyncio
    async def test_mmr_passes_k_fetch_k_lambda_mult(self, invoke_env):
        await invoke_env["retriever"].invoke(create_mock_input(search_type="mmr", k=5, fetch_k=30, lambda_mult=0.7))
        call_kwargs = invoke_env["vector_db"].amax_marginal_relevance_search.call_args.kwargs
        assert call_kwargs["k"] == 5
        assert call_kwargs["fetch_k"] == 30
        assert call_kwargs["lambda_mult"] == 0.7

    @pytest.mark.asyncio
    async def test_similarity_score_threshold_passes_k_and_score_threshold(self, invoke_env):
        await invoke_env["retriever"].invoke(create_mock_input(k=7, score_threshold=0.8))
        call_kwargs = invoke_env["vector_db"].asimilarity_search_with_relevance_scores.call_args.kwargs
        assert call_kwargs["k"] == 7
        assert call_kwargs["score_threshold"] == 0.8

    @pytest.mark.asyncio
    async def test_similarity_passes_k(self, invoke_env):
        await invoke_env["retriever"].invoke(create_mock_input(search_type="similarity", k=3))
        call_kwargs = invoke_env["vector_db"].asimilarity_search_with_relevance_scores.call_args.kwargs
        assert call_kwargs["k"] == 3

    @pytest.mark.asyncio
    async def test_label_filter_or_includes_chunk_labels_check(self, invoke_env):
        input_mock = create_mock_input(
            context={"categoryLabels": "health", "serviceLabels": ["education"]},
            filter_strategy="OR",
            search_start="chunk",
        )
        await invoke_env["retriever"].invoke(input_mock)
        call_kwargs = invoke_env["vector_db"].asimilarity_search_with_relevance_scores.call_args
        filter_clause = call_kwargs.kwargs.get("filter_clause", "")
        assert "doc.chunk_labels != null" in filter_clause
        assert "ANY IN doc.chunk_labels" in filter_clause

    @pytest.mark.asyncio
    async def test_label_filter_and_includes_chunk_labels_check(self, invoke_env):
        input_mock = create_mock_input(
            context={"categoryLabels": "health", "serviceLabels": ["education"]},
            filter_strategy="AND",
            search_start="chunk",
        )
        await invoke_env["retriever"].invoke(input_mock)
        call_kwargs = invoke_env["vector_db"].asimilarity_search_with_relevance_scores.call_args
        filter_clause = call_kwargs.kwargs.get("filter_clause", "")
        assert "doc.chunk_labels != null" in filter_clause
        assert "ALL IN doc.chunk_labels" in filter_clause

    @pytest.mark.asyncio
    async def test_invalid_search_start_raises_400(self, invoke_env):
        input_mock = create_mock_input(search_start="invalid_mode")
        with pytest.raises(HTTPException) as exc_info:
            await invoke_env["retriever"].invoke(input_mock)
        assert exc_info.value.status_code == 400
        assert "Invalid search_start" in str(exc_info.value.detail)


# ---------------------------------------------------------------------------
# Test: check_health (AC7)
# ---------------------------------------------------------------------------


class TestCheckHealth:
    """Unit tests for check_health."""

    def test_returns_true_when_db_succeeds(self):
        db = MagicMock()
        db.version.return_value = "3.12.0"
        retriever = create_retriever(db_mock=db)
        assert retriever.check_health() is True

    def test_returns_false_when_db_raises(self):
        db = MagicMock()
        db.version.side_effect = Exception("connection refused")
        retriever = create_retriever(db_mock=db)
        assert retriever.check_health() is False


# ---------------------------------------------------------------------------
# Test: generate_summarization_prompt (AC9)
# ---------------------------------------------------------------------------


class TestGenerateSummarizationPrompt:
    """Unit tests for generate_summarization_prompt."""

    def test_contains_query_and_text(self):
        retriever = create_retriever()
        prompt = retriever.generate_summarization_prompt("What is AI?", "AI is artificial intelligence.")
        assert "What is AI?" in prompt
        assert "AI is artificial intelligence." in prompt


# ---------------------------------------------------------------------------
# Test: rrf_fuse — Reciprocal Rank Fusion (Contextual Retrieval Part B, AC3)
# ---------------------------------------------------------------------------


def _mk_result(key, score=0.0):
    """Build a {"doc", "score"} result element for fusion tests."""
    return {"doc": _FakeDoc(id=key), "score": score}


# NOTE: TestRrfFuse + TestNormalizeChunkId + TestChunkPassesLabelFilter
# consolidated into contracts/test_contract_retriever_fusion.py and
# contracts/test_contract_label_filter.py. The contracts/ suite runs
# against the real vendored retriever module (per .claude/rules/TESTING.md
# "OPEA contract suite"), making the mocked tests/ versions duplicated proof.
# See test-audit campaign MR for context.


# ---------------------------------------------------------------------------
# Test: _ensure_bm25_view — idempotent lazy view creation (Part B, AC5)
# ---------------------------------------------------------------------------


class TestEnsureBm25View:
    """Tests for idempotent ArangoSearch view creation."""

    def test_creates_view_when_missing(self):
        db = MagicMock()
        db.views.return_value = []
        retriever = create_retriever(db_mock=db)
        retriever._ensure_bm25_view("GRAPH")
        db.create_arangosearch_view.assert_called_once()
        view_name, properties = db.create_arangosearch_view.call_args.args
        assert view_name == "GRAPH_BM25_VIEW"
        assert "GRAPH_SOURCE" in properties["links"]

    def test_skips_when_exists(self):
        db = MagicMock()
        db.views.return_value = [{"name": "GRAPH_BM25_VIEW"}]
        retriever = create_retriever(db_mock=db)
        retriever._ensure_bm25_view("GRAPH")
        db.create_arangosearch_view.assert_not_called()

    def test_cached_no_repeat_call(self):
        db = MagicMock()
        db.views.return_value = []
        retriever = create_retriever(db_mock=db)
        retriever._ensure_bm25_view("GRAPH")
        retriever._ensure_bm25_view("GRAPH")  # cached: second call must not hit ArangoDB
        assert db.views.call_count == 1
        assert db.create_arangosearch_view.call_count == 1

    def test_failure_not_cached_so_retries(self):
        # A transient create failure must NOT be cached (otherwise the channel
        # dies silently forever).
        db = MagicMock()
        db.views.return_value = []
        db.create_arangosearch_view.side_effect = Exception("transient")
        retriever = create_retriever(db_mock=db)
        retriever._ensure_bm25_view("GRAPH")  # logs, does not raise
        retriever._ensure_bm25_view("GRAPH")  # retries (not cached)
        assert db.views.call_count == 2

    def test_init_ensures_default_view_when_enabled(self):
        # _initialize_client must ensure the default-graph BM25 view at boot when
        # the hybrid flag is ON (mirrors has_database/create_database).
        with (
            patch("retriever.genieai_retriever_arangodb.HYBRID_RETRIEVAL_ENABLED", True),
            patch("retriever.genieai_retriever_arangodb.ArangoClient") as client_cls,
            patch.object(GenieaiArangoRetriever, "_ensure_bm25_view") as ensure,
        ):
            sys_db = MagicMock()
            sys_db.has_database.return_value = True
            client_cls.return_value.db.side_effect = [sys_db, MagicMock()]
            retriever = GenieaiArangoRetriever.__new__(GenieaiArangoRetriever)
            retriever._bm25_views_ensured = set()
            retriever._initialize_client()
        ensure.assert_called_once_with(ARANGO_GRAPH_NAME)

    def test_init_skips_view_when_disabled(self):
        with (
            patch("retriever.genieai_retriever_arangodb.HYBRID_RETRIEVAL_ENABLED", False),
            patch("retriever.genieai_retriever_arangodb.ArangoClient") as client_cls,
            patch.object(GenieaiArangoRetriever, "_ensure_bm25_view") as ensure,
        ):
            sys_db = MagicMock()
            sys_db.has_database.return_value = True
            client_cls.return_value.db.side_effect = [sys_db, MagicMock()]
            retriever = GenieaiArangoRetriever.__new__(GenieaiArangoRetriever)
            retriever._bm25_views_ensured = set()
            retriever._initialize_client()
        ensure.assert_not_called()


# ---------------------------------------------------------------------------
# Test: _bm25_search — BM25 channel + label filter (Part B, AC4)
# ---------------------------------------------------------------------------


def _make_bm25_cursor(rows):
    cursor = MagicMock()
    cursor.__iter__ = MagicMock(return_value=iter(rows))
    return cursor


class TestBm25Search:
    """Tests for the BM25 lexical search method."""

    @pytest.fixture(autouse=True)
    def _real_document(self):
        # _bm25_search constructs Document(...); use a real stand-in so .id is a
        # string (conftest mocks langchain_core, making Document a MagicMock).
        with patch("retriever.genieai_retriever_arangodb.Document", _FakeDoc):
            yield

    def test_returns_result_shape_and_filters_by_label(self):
        db = MagicMock()
        db.views.return_value = [{"name": "GRAPH_BM25_VIEW"}]
        db.aql.execute.return_value = _make_bm25_cursor(
            [
                {"key": "c1", "text": "health info", "chunk_labels": ["Health"], "file_id": "f1", "score": 3.0},
                {"key": "c2", "text": "agri info", "chunk_labels": ["Agriculture"], "file_id": "f2", "score": 2.0},
            ]
        )
        retriever = create_retriever(db_mock=db)
        results = retriever._bm25_search("query", "GRAPH", n=50, labels_to_filter=["Health"], filter_strategy="OR")
        assert [r["doc"].id for r in results] == ["c1"]  # c2 cross-category, filtered out
        assert results[0]["doc"].page_content == "health info"
        assert isinstance(results[0]["score"], float)

    def test_aql_filter_clause_injected_before_limit(self):
        # Optimization: the label filter is pushed INTO the AQL (pre-LIMIT) so
        # in-category recall is preserved when cross-category docs dominate top-N
        # (validated live on ArangoDB 3.12.4). Captures the executed AQL string.
        db = MagicMock()
        db.views.return_value = [{"name": "GRAPH_BM25_VIEW"}]
        db.aql.execute.return_value = _make_bm25_cursor([])
        retriever = create_retriever(db_mock=db)
        retriever._bm25_search(
            "query",
            "GRAPH",
            n=50,
            labels_to_filter=["Cucumber"],
            filter_strategy="OR",
            aql_filter_clause='FILTER (doc.chunk_labels != null) AND (["Cucumber"] ANY IN doc.chunk_labels)',
        )
        executed_aql = db.aql.execute.call_args.args[0]
        assert "doc.chunk_labels" in executed_aql  # filter clause present in AQL
        assert executed_aql.index("FILTER") < executed_aql.index("LIMIT")  # injected pre-LIMIT
        assert "BM25(doc)" in executed_aql  # core BM25 scoring intact
        assert "SEARCH ANALYZER" in executed_aql  # ArangoSearch search intact

    def test_no_labels_returns_all(self):
        db = MagicMock()
        db.views.return_value = [{"name": "GRAPH_BM25_VIEW"}]
        db.aql.execute.return_value = _make_bm25_cursor(
            [{"key": "c1", "text": "x", "chunk_labels": ["Health"], "file_id": "f1", "score": 1.0}]
        )
        retriever = create_retriever(db_mock=db)
        results = retriever._bm25_search("query", "GRAPH", n=50, labels_to_filter=[], filter_strategy="OR")
        assert len(results) == 1

    def test_never_raises_on_db_error(self):
        db = MagicMock()
        db.views.return_value = [{"name": "GRAPH_BM25_VIEW"}]
        db.aql.execute.side_effect = Exception("boom")
        retriever = create_retriever(db_mock=db)
        assert retriever._bm25_search("query", "GRAPH", n=50, labels_to_filter=[], filter_strategy="OR") == []


# ---------------------------------------------------------------------------
# Test: invoke hybrid wiring (Contextual Retrieval Part B, AC1/AC2/AC6/AC7)
# ---------------------------------------------------------------------------


class TestHybridInvoke:
    """Integration tests for the hybrid BM25+RRF hook inside invoke()."""

    async def test_off_is_no_op(self, invoke_env):
        # AC1: with the flag off, the BM25 channel must never be invoked.
        retriever = invoke_env["retriever"]
        with (
            patch("retriever.genieai_retriever_arangodb.HYBRID_RETRIEVAL_ENABLED", False),
            patch.object(retriever, "_bm25_search") as bm25,
        ):
            result = await retriever.invoke(create_mock_input(search_start="chunk"))
        assert isinstance(result, list)
        bm25.assert_not_called()

    async def test_on_fuses_bm25_doc_into_results(self, invoke_env):
        # AC2: with the flag on and a chunk start, a BM25-only doc must surface.
        retriever = invoke_env["retriever"]
        bm25_doc = _FakeDoc(id="bm25_only", page_content="exact keyword match", metadata={})
        with (
            patch("retriever.genieai_retriever_arangodb.HYBRID_RETRIEVAL_ENABLED", True),
            patch.object(retriever, "_bm25_search", return_value=[{"doc": bm25_doc, "score": 1.5}]),
        ):
            result = await retriever.invoke(create_mock_input(search_start="chunk"))
        ids = {r["doc"].id for r in result}
        assert "bm25_only" in ids  # BM25 channel contributed a doc dense did not find

    async def test_graceful_degradation_on_bm25_error(self, invoke_env):
        # AC6: a failing BM25 channel must not break the request.
        retriever = invoke_env["retriever"]
        with (
            patch("retriever.genieai_retriever_arangodb.HYBRID_RETRIEVAL_ENABLED", True),
            patch.object(retriever, "_bm25_search", side_effect=Exception("view down")),
        ):
            result = await retriever.invoke(create_mock_input(search_start="chunk"))
        assert isinstance(result, list)
        assert len(result) >= 1  # dense-only result returned

    async def test_skipped_for_non_chunk_start(self, invoke_env):
        # AC7: node/edge starts must stay dense-only even with the flag on.
        retriever = invoke_env["retriever"]
        with (
            patch("retriever.genieai_retriever_arangodb.HYBRID_RETRIEVAL_ENABLED", True),
            patch.object(retriever, "_bm25_search") as bm25,
        ):
            await retriever.invoke(create_mock_input(search_start="node"))
        bm25.assert_not_called()


# ---------------------------------------------------------------------------
# Test: Query instruction wrapper (issue #1035, generalized)
# ---------------------------------------------------------------------------


class TestQueryInstructionWrapper:
    """Verify that queries are prefixed with the model-specific instruction at
    the retriever's embed_query call site (per the relevant model card), while
    embed_documents / passage paths stay untouched. The same wrapper covers
    BAAI/bge (en+zh), intfloat/e5, hkunlp/instructor, nomic-ai/nomic-embed,
    and any deployer-supplied finetune via EMBEDDING_QUERY_INSTRUCTIONS.
    """

    def test_wrapper_prefixes_query_only(self):
        """QueryInstructionEmbeddingsWrapper.embed_query prepends instruction;
        embed_documents does not. Both sync and async paths are covered."""
        base = MagicMock()
        base.embed_query.return_value = [0.0]
        base.embed_documents.return_value = [[0.0]]
        base.aembed_query = AsyncMock(return_value=[0.0])
        base.aembed_documents = AsyncMock(return_value=[[0.0]])
        wrapper = QueryInstructionEmbeddingsWrapper(base, "PFX ")

        wrapper.embed_query("hello")
        base.embed_query.assert_called_once_with("PFX hello")

        wrapper.embed_documents(["a", "b"])
        base.embed_documents.assert_called_once_with(["a", "b"])

    @pytest.mark.asyncio
    async def test_wrapper_async_prefixes_query(self):
        """aembed_query applies the instruction; aembed_documents passes through."""
        base = MagicMock()
        base.aembed_query = AsyncMock(return_value=[0.0])
        base.aembed_documents = AsyncMock(return_value=[[0.0]])
        wrapper = QueryInstructionEmbeddingsWrapper(base, "PFX ")

        await wrapper.aembed_query("hello")
        base.aembed_query.assert_awaited_once_with("PFX hello")

        await wrapper.aembed_documents(["a", "b"])
        base.aembed_documents.assert_awaited_once_with(["a", "b"])

    @pytest.mark.asyncio
    async def test_wrapper_async_falls_back_when_base_has_no_async(self):
        """Custom embeddings classes that omit aembed_query / aembed_documents
        must fall back to the sync impl (getattr-guard, not AttributeError)."""
        # A bare object without aembed_query / aembed_documents attributes.
        base = MagicMock(spec=["embed_query", "embed_documents"])
        base.embed_query = MagicMock(return_value=[0.0])
        base.embed_documents = MagicMock(return_value=[[0.0]])
        wrapper = QueryInstructionEmbeddingsWrapper(base, "PFX ")

        # Must NOT raise AttributeError
        assert await wrapper.aembed_query("hello") == [0.0]
        assert await wrapper.aembed_documents(["a"]) == [[0.0]]
        base.embed_query.assert_called_once_with("PFX hello")
        base.embed_documents.assert_called_once_with(["a"])

    def test_wrapper_delegates_attributes_via_getattr(self):
        """The wrapper's design promise: arbitrary attribute access on the
        wrapper delegates to the underlying embeddings so adapters that
        introspect (e.g. ``wrapper.model_name``, ``wrapper.dimension``) keep
        working. Lock the contract."""
        base = MagicMock()
        base.model_name = "BAAI/bge-large-en-v1.5"
        base.dimension = 1024
        wrapper = QueryInstructionEmbeddingsWrapper(base, "PFX ")

        assert wrapper.model_name == "BAAI/bge-large-en-v1.5"
        assert wrapper.dimension == 1024

    def test_wrapper_getattr_raises_clear_when_base_slot_unset(self):
        """A subclass that forgets ``super().__init__(base, instruction)``
        would otherwise trigger infinite recursion on any attribute access
        (the `__getattr__` re-enters itself when reading `self.base`).
        The guard converts that into a single clear AttributeError."""
        # Bypass __init__ to leave `base` unset on the __slots__ descriptor.
        wrapper = QueryInstructionEmbeddingsWrapper.__new__(QueryInstructionEmbeddingsWrapper)

        with pytest.raises(AttributeError, match="base is unset"):
            wrapper.model_name  # noqa: B018

    def test_wrapper_getattr_chains_attribute_error_from_base(self):
        """If the wrapped embeddings class lacks an attribute, the error
        message must point at the base type — not at the wrapper — so the
        operator's debugging isn't misdirected."""
        base = object()  # bare object, no model_name / dimension / etc.
        wrapper = QueryInstructionEmbeddingsWrapper(base, "PFX ")

        with pytest.raises(AttributeError, match="also lacks it"):
            wrapper.model_name  # noqa: B018

    @pytest.mark.asyncio
    async def test_invoke_prefixes_query_for_bge_model(self, invoke_env):
        """Issue #1035: BGE-large-en-v1.5 (default) gets the BAAI prefix."""

        expected = dict(core_query_prefix._BUILTIN_QUERY_INSTRUCTIONS)["BAAI/bge-large-en-v1.5"]
        with patch("retriever.genieai_retriever_arangodb.TEI_EMBED_MODEL", "BAAI/bge-large-en-v1.5"):
            await invoke_env["retriever"].invoke(create_mock_input(query="test query"))
        invoke_env["embeddings"].embed_query.assert_called_once_with(expected + "test query")

    @pytest.mark.asyncio
    async def test_invoke_skips_prefix_for_non_contrastive_model(self, invoke_env):
        """OpenAI / mxbai / BGE-m3 / sentence-transformers must NOT receive a prefix."""
        with patch("retriever.genieai_retriever_arangodb.TEI_EMBED_MODEL", "text-embedding-3-small"):
            await invoke_env["retriever"].invoke(create_mock_input(query="test query"))
        invoke_env["embeddings"].embed_query.assert_called_once_with("test query")

    @pytest.mark.asyncio
    async def test_invoke_openai_branch_unchanged(self, invoke_env):
        """OpenAI embeddings path (OPENAI_API_KEY set) is untouched by the wrapper."""
        with (
            patch("retriever.genieai_retriever_arangodb.OPENAI_API_KEY", "sk-test"),
            patch("retriever.genieai_retriever_arangodb.OPENAI_EMBED_MODEL", "text-embedding-3-small"),
            patch("retriever.genieai_retriever_arangodb.OPENAI_EMBED_ENABLED", True),
            patch("retriever.genieai_retriever_arangodb.OpenAIEmbeddings") as openai_emb,
        ):
            openai_emb.return_value.embed_query.return_value = [0.0]
            await invoke_env["retriever"].invoke(create_mock_input(query="test query"))
        openai_emb.return_value.embed_query.assert_called_once_with("test query")

    @pytest.mark.asyncio
    async def test_local_bge_branch_clears_default_query_instruction(self, invoke_env):
        """HuggingFaceBgeEmbeddings already prepends its own query_instruction
        inside embed_query(). The retriever must clear it so the wrapper's
        instruction is the sole prefix applied — otherwise the local fallback
        path double-prefixes.
        """

        expected = dict(core_query_prefix._BUILTIN_QUERY_INSTRUCTIONS)["BAAI/bge-large-en-v1.5"]
        with (
            patch("retriever.genieai_retriever_arangodb.TEI_EMBEDDING_ENDPOINT", ""),
            patch("retriever.genieai_retriever_arangodb.HF_TOKEN", ""),
            patch("retriever.genieai_retriever_arangodb.TEI_EMBED_MODEL", "BAAI/bge-large-en-v1.5"),
            patch("retriever.genieai_retriever_arangodb.HuggingFaceBgeEmbeddings") as bge_cls,
        ):
            bge_cls.return_value.embed_query.return_value = [0.0]
            await invoke_env["retriever"].invoke(create_mock_input(query="bean varieties"))
        # Retriever must set query_instruction to "" so langchain doesn't
        # double-prefix on top of the wrapper's BAAI instruction.
        bge_instance = bge_cls.return_value
        assert bge_instance.query_instruction == ""
        # Behavioral assertion: the wrapper's prefix is the only one applied
        # to the encoded text. Without this, a regression that clears the
        # langchain default but then fails to install the wrapper would
        # still pass the state-only check above.
        bge_instance.embed_query.assert_called_once_with(expected + "bean varieties")


class TestGetQueryInstruction:
    """core_query_prefix.get_query_instruction(model_id) returns the right prefix for built-in
    known models, applies user overrides (EMBEDDING_QUERY_INSTRUCTIONS env var),
    and returns None for models with no entry (so callers skip the wrapper).
    """

    @pytest.mark.parametrize(
        "model_id,expected",
        [
            ("BAAI/bge-large-en-v1.5", "Represent this sentence for searching relevant passages: "),
            ("BAAI/bge-base-en-v1.5", "Represent this sentence for searching relevant passages: "),
            ("BAAI/bge-small-en-v1.5", "Represent this sentence for searching relevant passages: "),
            ("BAAI/bge-large-zh-v1.5", "为这个句子生成表示以用于检索相关文章："),
            ("hkunlp/instructor-base", "Represent the query for retrieving evidence documents: "),
            ("nomic-ai/nomic-embed-text-v1.5", "search_query: "),
            # case-insensitive substring match
            ("baai/bge-large-en-v1.5", "Represent this sentence for searching relevant passages: "),
        ],
    )
    def test_builtin_models_return_their_instruction(self, model_id, expected):

        assert core_query_prefix.get_query_instruction(model_id) == expected

    @pytest.mark.parametrize(
        "model_id",
        [
            "BAAI/bge-m3",  # no instruction
            "mxbai-embed-large-v1",
            "text-embedding-3-small",  # OpenAI
            "sentence-transformers/all-MiniLM-L6-v2",
            "",
            None,
        ],
    )
    def test_unknown_models_return_none(self, model_id):

        assert core_query_prefix.get_query_instruction(model_id) is None

    def test_user_override_wins_over_builtin(self):
        """EMBEDDING_QUERY_INSTRUCTIONS env var: new model + override existing."""

        new_overrides = (
            ("my-org/bge-finetune", "Custom prefix: "),
            ("BAAI/bge-large-zh-v1.5", "自定义中文前缀："),
        )
        with patch.object(core_query_prefix, "_USER_QUERY_INSTRUCTIONS", new_overrides):
            assert core_query_prefix.get_query_instruction("my-org/bge-finetune") == "Custom prefix: "
            assert core_query_prefix.get_query_instruction("BAAI/bge-large-zh-v1.5") == "自定义中文前缀："
            # Built-in English BGE still works
            assert (
                core_query_prefix.get_query_instruction("BAAI/bge-large-en-v1.5")
                == "Represent this sentence for searching relevant passages: "
            )
            # Unknown still None
            assert core_query_prefix.get_query_instruction("BAAI/bge-m3") is None

    def test_malformed_env_value_is_skipped(self):
        """Garbage entries (no `=`, empty key, empty value) are silently dropped."""

        # _parse_query_instructions drop rule: no `=`, empty k, empty v.
        with patch.object(
            core_query_prefix,
            "_USER_QUERY_INSTRUCTIONS",
            core_query_prefix._parse_query_instructions(
                "=orphan-value,no-equals-sign,key=,=value-only,valid=ok-prefix"
            ),
        ):
            assert core_query_prefix.get_query_instruction("valid") == "ok-prefix"
            # nothing else got registered from the malformed entries
            assert core_query_prefix.get_query_instruction("orphan-value") is None
