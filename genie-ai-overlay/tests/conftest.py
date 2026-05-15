# Copyright (c) 2024-2026 International Telecommunication Union (ITU)

import sys
from unittest.mock import AsyncMock, MagicMock

import pytest

# ---------------------------------------------------------------------------
# Pre-populate the vendored ``comps`` module tree so that imports in OPEA
# service modules do not fail at collection time.  The ``comps`` library is
# only available inside the Docker build (vendored + patched) and cannot be
# pip-installed locally.
# ---------------------------------------------------------------------------
_comps_mock = MagicMock()
sys.modules.setdefault("comps", _comps_mock)
sys.modules.setdefault("comps.cores", MagicMock())
sys.modules.setdefault("comps.cores.proto", MagicMock())
sys.modules.setdefault("comps.cores.proto.api_protocol", MagicMock())
sys.modules.setdefault("comps.cores.proto.genieai_api_protocol", MagicMock())
sys.modules.setdefault("comps.cores.proto.docarray", MagicMock())
sys.modules.setdefault("comps.dataprep", MagicMock())
sys.modules.setdefault("comps.dataprep.src", MagicMock())
sys.modules.setdefault("comps.dataprep.src.genieai_dataprep_utils", MagicMock())
sys.modules.setdefault("comps.dataprep.src.integrations", MagicMock())
sys.modules.setdefault("comps.dataprep.src.integrations.arangodb", MagicMock())
sys.modules.setdefault("comps.dataprep.src.utils", MagicMock())


# ---------------------------------------------------------------------------
# Autouse fixture — required env vars for every OPEA service
# ---------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def set_env_vars(monkeypatch):
    monkeypatch.setenv("ARANGO_URL", "http://localhost:8529")
    monkeypatch.setenv("ARANGO_DB", "genie")
    monkeypatch.setenv("ARANGO_USER", "root")
    monkeypatch.setenv("ARANGO_PASSWORD", "testpass")
    monkeypatch.setenv("TEI_EMBEDDING_ENDPOINT", "http://localhost:80")
    monkeypatch.setenv("TEI_RERANKING_ENDPOINT", "http://localhost:80")
    monkeypatch.setenv("VLLM_ENDPOINT", "http://localhost:8000")
    monkeypatch.setenv("LOCAL_EMBEDDING_MODEL", "BAAI/bge-base-en-v1.5")
    monkeypatch.setenv("RETRIEVER_MODEL_ID", "BAAI/bge-base-en-v1.5")


# ---------------------------------------------------------------------------
# mock_arangodb — factory fixture with overrides
# ---------------------------------------------------------------------------
@pytest.fixture
def mock_arangodb():
    """Factory fixture returning a mock ArangoDB client and database.

    Call with keyword overrides to customize defaults::

        arango = mock_arangodb(cursor_results=[{"_key": "doc1"}])
    """

    def _factory(
        *,
        cursor_results=None,
        cursor_next=None,
        collection_data=None,
    ):
        client = MagicMock()
        db = MagicMock()
        client.db.return_value = db

        mock_cursor = MagicMock()
        mock_cursor.all.return_value = cursor_results if cursor_results is not None else []
        mock_cursor.next.return_value = cursor_next if cursor_next is not None else None
        db.query.return_value = mock_cursor
        db.aql.execute.return_value = mock_cursor

        mock_collection = MagicMock()
        if collection_data is not None:
            mock_collection.all.return_value = collection_data
        db.collection.return_value = mock_collection

        return {
            "client": client,
            "db": db,
            "cursor": mock_cursor,
            "collection": mock_collection,
        }

    return _factory


# ---------------------------------------------------------------------------
# mock_redis — factory fixture with overrides
# ---------------------------------------------------------------------------
@pytest.fixture
def mock_redis():
    """Factory fixture returning a mock Redis client.

    Call with keyword overrides to customize defaults::

        redis = mock_redis(get_value=b"cached", exists_value=1)
    """

    def _factory(
        *,
        get_value=None,
        set_value=True,
        delete_value=1,
        exists_value=0,
        expire_value=True,
    ):
        redis = MagicMock()
        redis.get.return_value = get_value
        redis.set.return_value = set_value
        redis.delete.return_value = delete_value
        redis.exists.return_value = exists_value
        redis.expire.return_value = expire_value
        return redis

    return _factory


# ---------------------------------------------------------------------------
# mock_comps — factory fixture with per-test isolation
# ---------------------------------------------------------------------------
@pytest.fixture
def mock_comps():
    """Factory fixture returning mock instances for the vendored comps library.

    Creates a fresh mock each call — no shared state between tests.
    Call with keyword overrides to customize component mocks::

        comps = mock_comps()
        comps = mock_comps(logger_name="test-logger")
    """

    def _factory(*, logger_name="test-logger"):
        comps = MagicMock()

        custom_logger = MagicMock()
        custom_logger.info = MagicMock()
        custom_logger.error = MagicMock()
        custom_logger.warning = MagicMock()
        custom_logger.debug = MagicMock()
        custom_logger.name = logger_name

        comps.CustomLogger.return_value = custom_logger
        comps.OpeaComponent = MagicMock()
        comps.OpeaComponentRegistry = MagicMock()
        comps.ServiceOrchestrator = MagicMock()
        comps.MicroService = MagicMock()
        comps.MegaServiceEndpoint = MagicMock()
        comps.ServiceType = MagicMock()
        comps.ServiceRoleType = MagicMock()
        comps.EmbedDoc = MagicMock()
        comps.SearchedDoc = MagicMock()
        comps.LLMParamsDoc = MagicMock()
        comps.DocPath = MagicMock()

        return {
            "comps": comps,
            "custom_logger": custom_logger,
        }

    return _factory


# ---------------------------------------------------------------------------
# mock_vllm — factory fixture with overrides
# ---------------------------------------------------------------------------
@pytest.fixture
def mock_vllm():
    """Factory fixture returning mock vLLM inference responses.

    Call to create a configured client::

        vllm = mock_vllm(default_text="Hello world")
    """

    def _non_streaming_response(text="Generated text"):
        choice = MagicMock()
        choice.text = text
        choice.message.content = text
        response = MagicMock()
        response.choices = [choice]
        return response

    def _streaming_response(chunks=None):
        if chunks is None:
            chunks = ["Hello", " world"]
        stream_chunks = []
        for chunk_text in chunks:
            choice = MagicMock()
            choice.delta.content = chunk_text
            chunk = MagicMock()
            chunk.choices = [choice]
            stream_chunks.append(chunk)
        return stream_chunks

    def _factory(*, default_text="Generated text"):
        client = AsyncMock()
        client.generate.return_value = _non_streaming_response(default_text)
        return {
            "client": client,
            "non_streaming_response": _non_streaming_response,
            "streaming_response": _streaming_response,
        }

    return _factory


# ---------------------------------------------------------------------------
# mock_tei — factory fixture with overrides
# ---------------------------------------------------------------------------
@pytest.fixture
def mock_tei():
    """Factory fixture returning mock TEI responses for embedding and reranking.

    Call to create a configured client::

        tei = mock_tei(default_dimensions=384)
    """

    def _embedding_response(dimensions=768):
        return [[float(i) / dimensions for i in range(dimensions)]]

    def _reranking_response(scores=None):
        if scores is None:
            scores = [0.95, 0.82, 0.61]
        results = []
        for idx, score in enumerate(scores):
            doc = MagicMock()
            doc.score = score
            doc.index = idx
            results.append(doc)
        return results

    def _factory(*, default_dimensions=768):
        client = AsyncMock()
        client.post.return_value = MagicMock()
        return {
            "client": client,
            "embedding_response": _embedding_response,
            "reranking_response": _reranking_response,
            "default_dimensions": default_dimensions,
        }

    return _factory
