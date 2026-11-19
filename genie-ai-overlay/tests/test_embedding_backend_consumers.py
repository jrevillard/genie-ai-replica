# Copyright (C) 2026 ITU
# SPDX-License-Identifier: Apache-2.0
"""Consumer wiring for the config-gated embedding backend (Task-14 mirror).

Two consumers must honor the gate, and only when it is active:

* retriever — the embedding ladder (genieai_retriever_arangodb) puts the
  vLLM branch FIRST; the tei default must never reach it.
* dataprep — GenieArangoDataprep.__init__ swaps the comps-built TEI client
  post-construction when active.

The inactive cases are the load-bearing ones: an NVIDIA deployment (env
unset) must exercise exactly the branches it exercised before.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

import dataprep.genieai_dataprep_arangodb as dataprep_module
import retriever.genieai_retriever_arangodb as retriever_module
from dataprep.genieai_dataprep_arangodb import GenieArangoDataprep
from retriever.genieai_retriever_arangodb import GenieaiArangoRetriever

_BGE = "BAAI/bge-large-en-v1.5"


# ---------------------------------------------------------------------------
# Retriever consumer — mirror of test_retriever.py's invoke() fixture
# ---------------------------------------------------------------------------


def _create_mock_input(query="test query", **overrides):
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


def _make_happy_path_db():
    db = MagicMock()
    db.has_graph.return_value = True
    db.graph.return_value.has_vertex_collection.return_value = True
    db.graph.return_value.has_edge_collection.return_value = False
    db.graph.return_value.edge_definitions.return_value = []

    collection = MagicMock()
    collection.count.return_value = 5
    collection.random.return_value = {
        "_key": "doc1",
        "_id": "collection/doc1",
        "text": "sample text",
        "embedding": [0.1] * 768,
    }
    db.collection.return_value = collection

    cursor = MagicMock()
    cursor.__iter__ = MagicMock(return_value=iter([]))
    db.aql.execute.return_value = cursor
    return db


def _make_mock_vector_db(db_mock):
    mock_doc = MagicMock()
    mock_doc.id = "doc1"
    mock_doc.page_content = "relevant text"
    mock_doc.metadata = {"embedding": [0.1, 0.2, 0.3], "chunk_labels": []}

    mock_vdb = MagicMock()
    mock_vdb.db = db_mock
    mock_vdb.asimilarity_search_with_relevance_scores = AsyncMock(return_value=[(mock_doc, 0.9)])
    mock_vdb.amax_marginal_relevance_search = AsyncMock(return_value=[mock_doc])
    mock_vdb.asimilarity_search = AsyncMock(return_value=[mock_doc])
    return mock_vdb


def _create_retriever(db_mock=None):
    retriever = GenieaiArangoRetriever(name="test-retriever", description="Test retriever")
    retriever.db = db_mock if db_mock is not None else MagicMock()
    retriever.llm = MagicMock()
    return retriever


class TestRetrieverLadder:
    """The vLLM branch sits FIRST in the embedding ladder — active gate only."""

    @pytest.mark.asyncio
    async def test_active_gate_selects_vllm_branch(self, monkeypatch):
        db = _make_happy_path_db()
        retriever = _create_retriever(db_mock=db)
        mock_vllm_embeddings = MagicMock()
        mock_vdb = _make_mock_vector_db(db)

        with (
            patch(
                "retriever.genieai_retriever_arangodb.embeddings_backend_active",
                return_value=True,
            ),
            patch(
                "retriever.genieai_retriever_arangodb.build_vllm_embeddings",
                return_value=mock_vllm_embeddings,
            ) as mock_build,
            patch("retriever.genieai_retriever_arangodb.ArangoVector", return_value=mock_vdb) as mock_vector,
            patch("retriever.genieai_retriever_arangodb.OPENAI_API_KEY", None),
            patch("retriever.genieai_retriever_arangodb.TEI_EMBEDDING_ENDPOINT", ""),
            patch("retriever.genieai_retriever_arangodb.HF_TOKEN", ""),
            patch("retriever.genieai_retriever_arangodb.HYBRID_RETRIEVAL_ENABLED", False),
        ):
            await retriever.invoke(_create_mock_input(search_start="chunk"))

        # The ladder built the vLLM client with the bge default and handed
        # it to the vector store — WRAPPED, so the query side carries the
        # contrastive instruction (MR !968 review: the vLLM branch encoded
        # the query raw, the TEI branch prefixed it).
        mock_build.assert_called_once_with(_BGE)
        embedding = mock_vector.call_args.kwargs["embedding"]
        assert isinstance(embedding, retriever_module.QueryInstructionEmbeddingsWrapper)
        assert embedding.base is mock_vllm_embeddings

    @pytest.mark.asyncio
    async def test_vllm_branch_installs_the_query_instruction(self, monkeypatch):
        """Regression (MR !968 review): bge is CONTRASTIVE — the query side
        must carry the instruction, the passage side must not.

        The built-in table in core/embedding_query_prefix.py ships a prefix
        for "BAAI/bge-large-en-v1.5" ("Represent this sentence for searching
        relevant passages: "), so the vLLM branch must apply it exactly as
        the TEI branch does. The previous comment there claimed the opposite
        ("returns None for bge") and the query was encoded raw — the wrong
        half of the embedding space, silently, on the ROCm venue.
        """
        db = _make_happy_path_db()
        retriever = _create_retriever(db_mock=db)
        mock_vllm_embeddings = MagicMock()
        mock_vdb = _make_mock_vector_db(db)

        with (
            patch(
                "retriever.genieai_retriever_arangodb.embeddings_backend_active",
                return_value=True,
            ),
            patch(
                "retriever.genieai_retriever_arangodb.build_vllm_embeddings",
                return_value=mock_vllm_embeddings,
            ),
            patch("retriever.genieai_retriever_arangodb.ArangoVector", return_value=mock_vdb) as mock_vector,
            patch("retriever.genieai_retriever_arangodb.OPENAI_API_KEY", None),
            patch("retriever.genieai_retriever_arangodb.TEI_EMBEDDING_ENDPOINT", ""),
            patch("retriever.genieai_retriever_arangodb.HF_TOKEN", ""),
            patch("retriever.genieai_retriever_arangodb.HYBRID_RETRIEVAL_ENABLED", False),
        ):
            await retriever.invoke(_create_mock_input(search_start="chunk"))

        embedding = mock_vector.call_args.kwargs["embedding"]
        assert embedding.instruction == "Represent this sentence for searching relevant passages: "

        # The wrapper prefixes the QUERY and passes the PASSAGES through
        # verbatim — dataprep embeds the passages, and they must stay raw.
        # Every query this client encodes carries the instruction: the
        # ladder's own path (the `embedding is None` fallback → embed_query)
        # AND an explicit call through the wrapper.
        embedding.embed_query("what is x?")
        queries = [c.args[0] for c in mock_vllm_embeddings.embed_query.call_args_list]
        assert queries, "the ladder must encode the query through the client"
        assert all(q.startswith("Represent this sentence for searching relevant passages: ") for q in queries), queries
        assert "Represent this sentence for searching relevant passages: what is x?" in queries
        embedding.embed_documents(["a passage"])
        mock_vllm_embeddings.embed_documents.assert_called_once_with(["a passage"])

    @pytest.mark.asyncio
    async def test_tei_default_never_reaches_the_vllm_branch(self, monkeypatch):
        """Negative case — the load-bearing one: with the gate inactive the
        vLLM builder is never called and the ladder answers exactly as it
        did before this change (local/TEI branch)."""
        db = _make_happy_path_db()
        retriever = _create_retriever(db_mock=db)
        mock_embeddings = MagicMock()
        mock_embeddings.embed_query.return_value = [0.1] * 768
        mock_vdb = _make_mock_vector_db(db)

        with (
            patch(
                "retriever.genieai_retriever_arangodb.embeddings_backend_active",
                return_value=False,
            ),
            patch(
                "retriever.genieai_retriever_arangodb.build_vllm_embeddings",
            ) as mock_build,
            patch("retriever.genieai_retriever_arangodb.ArangoVector", return_value=mock_vdb),
            patch(
                "retriever.genieai_retriever_arangodb.HuggingFaceBgeEmbeddings",
                return_value=mock_embeddings,
            ) as mock_bge,
            patch("retriever.genieai_retriever_arangodb.OPENAI_API_KEY", None),
            patch("retriever.genieai_retriever_arangodb.TEI_EMBEDDING_ENDPOINT", ""),
            patch("retriever.genieai_retriever_arangodb.HF_TOKEN", ""),
            patch("retriever.genieai_retriever_arangodb.HYBRID_RETRIEVAL_ENABLED", False),
        ):
            await retriever.invoke(_create_mock_input(search_start="chunk"))

        mock_build.assert_not_called()
        mock_bge.assert_called_once()

    @pytest.mark.asyncio
    async def test_real_default_env_is_inactive(self, monkeypatch):
        """Against the REAL selector (no patch): the shipped env — no
        EMBEDDING_BACKEND, no endpoint — must resolve inactive. This is the
        byte-identical guarantee for the NVIDIA path."""
        monkeypatch.delenv("EMBEDDING_BACKEND", raising=False)
        monkeypatch.delenv("EMBEDDING_VLLM_ENDPOINT", raising=False)
        assert retriever_module.embeddings_backend_active() is False


class TestDataprepSwap:
    """GenieArangoDataprep.__init__ swaps self.embeddings when active.

    The conftest stubs the parent OpeaArangoDataprep.__init__ to set
    self.embeddings = None (mirroring the real parent's contract), so a
    direct construction exercises the subclass __init__ without the real
    comps graph."""

    def test_active_gate_swaps_embeddings(self, monkeypatch):
        sentinel = MagicMock(name="vllm-embeddings")
        with (
            patch(
                "dataprep.genieai_dataprep_arangodb.embeddings_backend_active",
                return_value=True,
            ),
            patch(
                "dataprep.genieai_dataprep_arangodb.build_vllm_embeddings",
                return_value=sentinel,
            ) as mock_build,
        ):
            dp = GenieArangoDataprep(name="test-dp", description="Test dataprep")

        mock_build.assert_called_once_with(_BGE)
        assert dp.embeddings is sentinel

    def test_active_gate_does_not_install_the_query_instruction(self, monkeypatch):
        """The mirror of the retriever's rule (MR !968 review): dataprep
        embeds the PASSAGES, and a contrastive model wants the passage side
        RAW. The retriever prefixes the query; dataprep must not — so the
        dataprep client stays the raw builder output, unwrapped."""
        sentinel = MagicMock(name="vllm-embeddings")
        with (
            patch(
                "dataprep.genieai_dataprep_arangodb.embeddings_backend_active",
                return_value=True,
            ),
            patch(
                "dataprep.genieai_dataprep_arangodb.build_vllm_embeddings",
                return_value=sentinel,
            ),
        ):
            dp = GenieArangoDataprep(name="test-dp", description="Test dataprep")

        assert dp.embeddings is sentinel
        assert not isinstance(dp.embeddings, retriever_module.QueryInstructionEmbeddingsWrapper)

    def test_tei_default_keeps_comps_client(self, monkeypatch):
        """Negative case — no gate, no swap: self.embeddings stays whatever
        the parent constructor built (None under the conftest stub), and the
        builder is never imported into the path."""
        monkeypatch.delenv("EMBEDDING_BACKEND", raising=False)
        monkeypatch.delenv("EMBEDDING_VLLM_ENDPOINT", raising=False)
        dp = GenieArangoDataprep(name="test-dp", description="Test dataprep")
        assert dp.embeddings is None

    def test_real_selector_gates_the_swap(self, monkeypatch):
        """Against the REAL selector: shipped env stays inactive, so the
        dataprep swap cannot fire on an NVIDIA deployment even with an
        endpoint accidentally present."""
        monkeypatch.setenv("EMBEDDING_BACKEND", "tei")
        monkeypatch.setenv("EMBEDDING_VLLM_ENDPOINT", "http://vllm-embedding:8000")
        assert dataprep_module.embeddings_backend_active() is False
