# Copyright (c) 2024-2026 International Telecommunication Union (ITU)

"""Self-tests verifying that every conftest.py fixture produces mock objects
with the expected shape and methods."""

import os

# ---------------------------------------------------------------------------
# mock_arangodb
# ---------------------------------------------------------------------------


class TestMockArangoDB:
    def test_has_client_and_db(self, mock_arangodb):
        arango = mock_arangodb()
        assert "client" in arango
        assert "db" in arango

    def test_client_db_returns_db(self, mock_arangodb):
        arango = mock_arangodb()
        result = arango["client"].db.return_value
        assert result is arango["db"]

    def test_collection_returns_mock(self, mock_arangodb):
        arango = mock_arangodb()
        col = arango["db"].collection("test_col")
        assert col is arango["collection"]

    def test_query_returns_cursor(self, mock_arangodb):
        arango = mock_arangodb()
        cursor = arango["db"].query("FOR d IN c RETURN d")
        assert cursor is arango["cursor"]

    def test_cursor_all_returns_list(self, mock_arangodb):
        arango = mock_arangodb()
        result = arango["cursor"].all()
        assert result == []

    def test_cursor_next_returns_none(self, mock_arangodb):
        arango = mock_arangodb()
        result = arango["cursor"].next()
        assert result is None

    def test_aql_execute_returns_cursor(self, mock_arangodb):
        arango = mock_arangodb()
        cursor = arango["db"].aql.execute("RETURN 1")
        assert cursor is arango["cursor"]

    def test_cursor_results_override(self, mock_arangodb):
        docs = [{"_key": "doc1"}, {"_key": "doc2"}]
        arango = mock_arangodb(cursor_results=docs)
        assert arango["cursor"].all.return_value == docs

    def test_collection_data_override(self, mock_arangodb):
        arango = mock_arangodb(collection_data=[{"name": "chunks"}])
        assert arango["collection"].all.return_value == [{"name": "chunks"}]


# ---------------------------------------------------------------------------
# mock_redis
# ---------------------------------------------------------------------------


class TestMockRedis:
    def test_get_returns_none(self, mock_redis):
        redis = mock_redis()
        assert redis.get("key") is None

    def test_set_returns_true(self, mock_redis):
        redis = mock_redis()
        assert redis.set("key", "value") is True

    def test_delete_returns_one(self, mock_redis):
        redis = mock_redis()
        assert redis.delete("key") == 1

    def test_exists_returns_zero(self, mock_redis):
        redis = mock_redis()
        assert redis.exists("key") == 0

    def test_expire_returns_true(self, mock_redis):
        redis = mock_redis()
        assert redis.expire("key", 60) is True

    def test_get_override(self, mock_redis):
        redis = mock_redis(get_value=b"cached", exists_value=1)
        assert redis.get("key") == b"cached"
        assert redis.exists("key") == 1


# ---------------------------------------------------------------------------
# mock_vllm
# ---------------------------------------------------------------------------


class TestMockVLLM:
    def test_has_client(self, mock_vllm):
        vllm = mock_vllm()
        assert "client" in vllm

    def test_non_streaming_response_shape(self, mock_vllm):
        vllm = mock_vllm()
        resp = vllm["non_streaming_response"]("test output")
        assert len(resp.choices) == 1
        assert resp.choices[0].text == "test output"
        assert resp.choices[0].message.content == "test output"

    def test_streaming_response_shape(self, mock_vllm):
        vllm = mock_vllm()
        chunks = vllm["streaming_response"](["Hello", " world"])
        assert len(chunks) == 2
        assert chunks[0].choices[0].delta.content == "Hello"
        assert chunks[1].choices[0].delta.content == " world"

    def test_client_generate_returns_response(self, mock_vllm):
        vllm = mock_vllm()
        resp = vllm["client"].generate.return_value
        assert len(resp.choices) == 1
        assert resp.choices[0].text == "Generated text"

    def test_default_text_override(self, mock_vllm):
        vllm = mock_vllm(default_text="Custom response")
        resp = vllm["client"].generate.return_value
        assert resp.choices[0].text == "Custom response"


# ---------------------------------------------------------------------------
# mock_tei
# ---------------------------------------------------------------------------


class TestMockTEI:
    def test_has_client(self, mock_tei):
        tei = mock_tei()
        assert "client" in tei

    def test_embedding_response_shape(self, mock_tei):
        tei = mock_tei()
        embeddings = tei["embedding_response"](dimensions=4)
        assert len(embeddings) == 1
        assert len(embeddings[0]) == 4
        assert all(isinstance(v, float) for v in embeddings[0])

    def test_reranking_response_shape(self, mock_tei):
        tei = mock_tei()
        results = tei["reranking_response"](scores=[0.9, 0.7])
        assert len(results) == 2
        assert results[0].score == 0.9
        assert results[1].score == 0.7
        assert results[0].index == 0

    def test_reranking_default_scores(self, mock_tei):
        tei = mock_tei()
        results = tei["reranking_response"]()
        assert len(results) == 3


# ---------------------------------------------------------------------------
# mock_comps
# ---------------------------------------------------------------------------


class TestMockComps:
    def test_custom_logger_methods(self, mock_comps):
        comps = mock_comps()
        logger = comps["custom_logger"]
        logger.info("msg")
        logger.error("msg")
        logger.warning("msg")
        logger.debug("msg")
        logger.info.assert_called_once_with("msg")
        logger.error.assert_called_once_with("msg")

    def test_comps_attributes_exist(self, mock_comps):
        comps = mock_comps()
        comps_mod = comps["comps"]
        for attr in (
            "OpeaComponent",
            "OpeaComponentRegistry",
            "ServiceOrchestrator",
            "MicroService",
            "MegaServiceEndpoint",
            "ServiceType",
            "ServiceRoleType",
            "EmbedDoc",
            "SearchedDoc",
            "LLMParamsDoc",
            "DocPath",
        ):
            assert hasattr(comps_mod, attr), f"comps missing attribute: {attr}"

    def test_isolation_between_calls(self, mock_comps):
        comps_a = mock_comps(logger_name="logger-a")
        comps_b = mock_comps(logger_name="logger-b")
        assert comps_a["custom_logger"] is not comps_b["custom_logger"]
        assert comps_a["comps"] is not comps_b["comps"]


# ---------------------------------------------------------------------------
# autouse env vars
# ---------------------------------------------------------------------------


class TestAutouseEnvVars:
    def test_env_vars_set(self):
        assert os.getenv("ARANGO_URL") == "http://localhost:8529"
        assert os.getenv("ARANGO_DB") == "genie"
        assert os.getenv("ARANGO_USER") == "root"
        assert os.getenv("ARANGO_PASSWORD") == "testpass"
        assert os.getenv("TEI_EMBEDDING_ENDPOINT") == "http://localhost:80"
        assert os.getenv("TEI_RERANKING_ENDPOINT") == "http://localhost:80"
        assert os.getenv("VLLM_ENDPOINT") == "http://localhost:8000"
        assert os.getenv("LOCAL_EMBEDDING_MODEL") == "BAAI/bge-base-en-v1.5"
        assert os.getenv("RETRIEVER_MODEL_ID") == "BAAI/bge-base-en-v1.5"
