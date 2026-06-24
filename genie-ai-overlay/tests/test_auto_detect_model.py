# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
#
# Tests for vLLM model auto-detection (TTL-cached) across OPEA services.
#
# Probe logic lives in core/model_cache.py. Each service (chatqna, retriever,
# dataprep) calls get_model_id() to resolve the model served by a remote vLLM
# node, gated on GPU_NODE_HOST.

import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest

from core import model_cache
from core.model_cache import clear_cache, get_model_id


# ---------------------------------------------------------------------------
# Shared fixture — clear TTL cache before every test
# ---------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def _clean_cache():
    clear_cache()
    yield
    clear_cache()


# ---------------------------------------------------------------------------
# _probe — low-level /v1/models probe
# ---------------------------------------------------------------------------
class TestModelCacheProbe:
    """Tests for core.model_cache._probe function."""

    def test_returns_model_id_on_success(self, monkeypatch):
        monkeypatch.setenv("VLLM_API_KEY", "test-key")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "ibm-granite/granite-3.3-2b-instruct"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            result = model_cache._probe("https://gpu-host/llm")

        assert result == "ibm-granite/granite-3.3-2b-instruct"
        mock_get.assert_called_once()
        call_kwargs = mock_get.call_args
        assert call_kwargs.kwargs["verify"] is False
        assert call_kwargs.kwargs["headers"]["Authorization"] == "Bearer test-key"

    def test_returns_none_when_no_models_in_response(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": []}

        with patch("httpx.get", return_value=mock_resp):
            result = model_cache._probe("https://gpu-host/llm")

        assert result is None

    def test_returns_none_on_http_error(self):
        mock_resp = MagicMock()
        mock_resp.status_code = 503
        mock_resp.raise_for_status.side_effect = httpx.HTTPStatusError("503", request=MagicMock(), response=mock_resp)

        with patch("httpx.get", return_value=mock_resp):
            result = model_cache._probe("https://gpu-host/llm")

        assert result is None

    def test_returns_none_on_connection_error(self):
        with patch("httpx.get", side_effect=httpx.ConnectError("Connection refused")):
            result = model_cache._probe("https://gpu-host/llm")

        assert result is None

    def test_returns_none_on_timeout(self):
        with patch("httpx.get", side_effect=httpx.TimeoutException("Timeout")):
            result = model_cache._probe("https://gpu-host/llm")

        assert result is None

    def test_sends_vllm_api_key_as_bearer(self, monkeypatch):
        monkeypatch.setenv("VLLM_API_KEY", "test-api-key-123")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            model_cache._probe("https://gpu-host/llm")

        headers = mock_get.call_args.kwargs["headers"]
        assert headers["Authorization"] == "Bearer test-api-key-123"

    def test_no_header_when_vllm_api_key_unset(self, monkeypatch):
        monkeypatch.delenv("VLLM_API_KEY", raising=False)

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            model_cache._probe("https://gpu-host/llm")

        headers = mock_get.call_args.kwargs["headers"]
        assert headers == {}

    def test_timeout_is_10_seconds(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            model_cache._probe("https://gpu-host/llm")

        assert mock_get.call_args.kwargs["timeout"] == 10

    def test_returns_first_model_from_list(self):
        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "data": [
                {"id": "model-first"},
                {"id": "model-second"},
            ]
        }

        with patch("httpx.get", return_value=mock_resp):
            result = model_cache._probe("https://gpu-host/llm")

        assert result == "model-first"


# ---------------------------------------------------------------------------
# get_model_id — TTL cache behaviour
# ---------------------------------------------------------------------------
class TestModelCacheTtl:
    """Tests for core.model_cache.get_model_id TTL caching."""

    def test_cache_hit_skips_probe(self):
        """Within TTL, a second call does not re-probe."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            first = get_model_id("https://gpu-host/llm", ttl_seconds=60)
            second = get_model_id("https://gpu-host/llm", ttl_seconds=60)

        assert first == "model-a"
        assert second == "model-a"
        assert mock_get.call_count == 1  # probed once, cached the second time

    def test_cache_expiry_reprobes(self):
        """When TTL is 0, every call re-probes."""
        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            get_model_id("https://gpu-host/llm", ttl_seconds=0)
            get_model_id("https://gpu-host/llm", ttl_seconds=0)

        assert mock_get.call_count == 2

    def test_probe_failure_returns_stale_cached_value(self):
        """After a successful probe, a failed re-probe returns the stale value."""
        ok_resp = MagicMock()
        ok_resp.json.return_value = {"data": [{"id": "stale-model"}]}

        with patch("httpx.get", return_value=ok_resp):
            first = get_model_id("https://gpu-host/llm", ttl_seconds=0)

        with patch("httpx.get", side_effect=httpx.ConnectError("down")):
            second = get_model_id("https://gpu-host/llm", ttl_seconds=0)

        assert first == "stale-model"
        assert second == "stale-model"  # stale served on failure

    def test_first_probe_failure_returns_none(self):
        """With no cache and a failed first probe, returns None."""
        with patch("httpx.get", side_effect=httpx.ConnectError("down")):
            result = get_model_id("https://gpu-host/llm")

        assert result is None

    def test_empty_endpoint_returns_none(self):
        assert get_model_id("") is None

    def test_ttl_env_override(self, monkeypatch):
        """MODEL_DETECT_TTL env var overrides the default TTL."""
        monkeypatch.setenv("MODEL_DETECT_TTL", "120")
        assert model_cache._resolve_ttl(None) == 120

    def test_ttl_env_invalid_falls_back_to_default(self, monkeypatch):
        monkeypatch.setenv("MODEL_DETECT_TTL", "not-a-number")
        assert model_cache._resolve_ttl(None) == model_cache.MODEL_TTL_DEFAULT


# ---------------------------------------------------------------------------
# chatqna getters — _get_llm_model / _get_translation_model_id
# ---------------------------------------------------------------------------
class TestChatqnaGetters:
    """Tests for chatqna model getter functions."""

    def test_get_llm_model_returns_detected_when_gpu_host_set(self, monkeypatch):
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "_GPU_NODE_HOST", "10.0.0.110")
        monkeypatch.setattr(mod, "_VLLM_LLM_ENDPOINT", "https://10.0.0.110/llm")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "detected-llm"}]}

        with patch("httpx.get", return_value=mock_resp):
            assert mod._get_llm_model() == "detected-llm"

    def test_get_llm_model_returns_default_when_no_gpu_host(self, monkeypatch):
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "_GPU_NODE_HOST", "")

        with patch("httpx.get") as mock_get:
            result = mod._get_llm_model()

        mock_get.assert_not_called()
        assert result == mod.LLM_MODEL

    def test_get_translation_model_id_returns_detected(self, monkeypatch):
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "_GPU_NODE_HOST", "10.0.0.110")
        monkeypatch.setattr(mod, "_VLLM_TRANSLATION_ENDPOINT", "https://10.0.0.110/translation")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "google/translategemma-3-7b"}]}

        with patch("httpx.get", return_value=mock_resp):
            assert mod._get_translation_model_id() == "google/translategemma-3-7b"

    def test_is_translategemma_true_for_translategemma(self, monkeypatch):
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "_GPU_NODE_HOST", "10.0.0.110")
        monkeypatch.setattr(mod, "_VLLM_TRANSLATION_ENDPOINT", "https://10.0.0.110/translation")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "google/translategemma-3-7b"}]}

        with patch("httpx.get", return_value=mock_resp):
            assert mod._is_translategemma() is True

    def test_is_translategemma_false_for_generic_model(self, monkeypatch):
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "_GPU_NODE_HOST", "")
        monkeypatch.setattr(mod, "TRANSLATION_MODEL_ID", "gemma-3-4b-it")

        assert mod._is_translategemma() is False


# ---------------------------------------------------------------------------
# Dataprep _label_with_llm — source-level assertions
# ---------------------------------------------------------------------------
class TestDataprepAutoDetect:
    """Tests for dataprep _label_with_llm auto-detect when GPU_NODE_HOST is set.

    Uses source file inspection since the module is mocked in test environment.
    """

    @pytest.fixture()
    def source(self):
        """Read the actual source file for assertions."""
        src = Path(__file__).resolve().parents[1] / "dataprep" / "genieai_dataprep_arangodb.py"
        return src.read_text()

    def test_uses_vllm_api_key_for_auth(self, source):
        idx = source.find("def _label_with_llm")
        chunk = source[idx : idx + 2000]

        assert "VLLM_API_KEY" in chunk
        assert "OPEA_API_KEY" not in chunk

    def test_no_custom_default_headers(self, source):
        idx = source.find("def _label_with_llm")
        chunk = source[idx : idx + 2000]

        assert "default_headers" not in chunk
        assert "X-API-Key" not in chunk

    def test_auto_detect_condition_checks_gpu_node_host(self, source):
        idx = source.find("def _label_with_llm")
        chunk = source[idx : idx + 2000]

        assert 'os.getenv("GPU_NODE_HOST")' in chunk

    def test_auto_detect_uses_shared_cache(self, source):
        """_label_with_llm uses the shared TTL-cached get_model_id()."""
        idx = source.find("def _label_with_llm")
        chunk = source[idx : idx + 2000]

        assert "get_model_id" in chunk


# ---------------------------------------------------------------------------
# Dataprep _initialize_llm — auto-detection of remote vLLM model
# ---------------------------------------------------------------------------
class TestDataprepInitializeLlmAutoDetect:
    """Tests for dataprep._initialize_llm override that auto-detects remote vLLM model.

    When GPU_NODE_HOST is set, the override probes /v1/models (via the shared
    TTL cache) and sets VLLM_MODEL_ID in os.environ before calling the parent.
    """

    @pytest.fixture(autouse=True)
    def _setup(self, monkeypatch):
        monkeypatch.setenv("GPU_NODE_HOST", "10.0.0.110")
        monkeypatch.setenv("VLLM_ENDPOINT", "https://10.0.0.110/vllm")
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_MODEL_ID", "default-model")
        yield
        monkeypatch.delenv("VLLM_MODEL_ID", raising=False)

    def test_remote_model_overrides_config_default(self):
        """When /v1/models returns a model, VLLM_MODEL_ID env var is overridden."""
        from dataprep.genieai_dataprep_arangodb import GenieArangoDataprep

        dp = GenieArangoDataprep.__new__(GenieArangoDataprep)

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "detected-model"}]}
        mock_resp.raise_for_status = MagicMock()

        with patch("httpx.get", return_value=mock_resp):
            dp._initialize_llm(allowed_node_types=[], allowed_edge_types=[])

        assert os.getenv("VLLM_MODEL_ID") == "detected-model"
        import comps.dataprep.src.integrations.arangodb as _parent_mod

        assert _parent_mod.VLLM_MODEL_ID == "detected-model"

    def test_no_gpu_host_skips_detection(self, monkeypatch):
        """When GPU_NODE_HOST is not set, /v1/models is never probed."""
        from dataprep.genieai_dataprep_arangodb import GenieArangoDataprep

        monkeypatch.delenv("GPU_NODE_HOST", raising=False)
        dp = GenieArangoDataprep.__new__(GenieArangoDataprep)

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "detected-model"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            dp._initialize_llm(allowed_node_types=[], allowed_edge_types=[])

        mock_get.assert_not_called()

    def test_failure_preserves_config_default(self):
        """When /v1/models fails, VLLM_MODEL_ID keeps its config default."""
        from dataprep.genieai_dataprep_arangodb import GenieArangoDataprep

        dp = GenieArangoDataprep.__new__(GenieArangoDataprep)

        with patch("httpx.get", side_effect=httpx.ConnectError("Connection refused")):
            dp._initialize_llm(allowed_node_types=[], allowed_edge_types=[])

        assert os.getenv("VLLM_MODEL_ID") == "default-model"


# ---------------------------------------------------------------------------
# Retriever _initialize_llm — auto-detection of remote vLLM model
# ---------------------------------------------------------------------------
class TestRetrieverInitializeLlmAutoDetect:
    """Behavioral tests for retriever._initialize_llm auto-detection.

    Verifies that when GPU_NODE_HOST is set, the auto-detected model ID
    (from /v1/models via the shared TTL cache) is passed to ChatOpenAI
    instead of the config default.
    """

    @pytest.fixture(autouse=True)
    def _setup(self, monkeypatch):
        monkeypatch.setenv("GPU_NODE_HOST", "10.0.0.110")
        monkeypatch.setenv("VLLM_ENDPOINT", "https://10.0.0.110/vllm")
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_MODEL_ID", "default-model")
        # Patch module-level constants (evaluated at import time, before fixtures)
        import retriever.genieai_retriever_arangodb as _mod

        monkeypatch.setattr(_mod, "VLLM_ENDPOINT", "https://10.0.0.110/vllm")
        monkeypatch.setattr(_mod, "VLLM_MODEL_ID", "default-model")
        yield
        monkeypatch.delenv("VLLM_MODEL_ID", raising=False)

    def test_detected_model_used_in_chatopenai(self):
        """Auto-detected model ID is passed to ChatOpenAI, not the config default."""
        from retriever.genieai_retriever_arangodb import ChatOpenAI, GenieaiArangoRetriever

        r = GenieaiArangoRetriever.__new__(GenieaiArangoRetriever)
        ChatOpenAI.reset_mock()

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "detected-llm"}]}
        mock_resp.raise_for_status = MagicMock()

        with patch("httpx.get", return_value=mock_resp):
            r._initialize_llm()

        assert ChatOpenAI.call_args.kwargs["model"] == "detected-llm"

    def test_config_default_when_no_gpu_host(self, monkeypatch):
        """Without GPU_NODE_HOST, config default model is used in ChatOpenAI."""
        from retriever.genieai_retriever_arangodb import ChatOpenAI, GenieaiArangoRetriever

        monkeypatch.delenv("GPU_NODE_HOST", raising=False)
        r = GenieaiArangoRetriever.__new__(GenieaiArangoRetriever)
        ChatOpenAI.reset_mock()

        with patch("httpx.get") as mock_get:
            r._initialize_llm()

        mock_get.assert_not_called()
        assert ChatOpenAI.call_args.kwargs["model"] == "default-model"

    def test_failure_falls_back_to_default(self):
        """When /v1/models fails, config default model is used as fallback."""
        from retriever.genieai_retriever_arangodb import ChatOpenAI, GenieaiArangoRetriever

        r = GenieaiArangoRetriever.__new__(GenieaiArangoRetriever)
        ChatOpenAI.reset_mock()

        with patch("httpx.get", side_effect=httpx.ConnectError("Connection refused")):
            r._initialize_llm()

        assert ChatOpenAI.call_args.kwargs["model"] == "default-model"

    def test_get_llm_recreates_on_model_change(self, monkeypatch):
        """_get_llm recreates the ChatOpenAI client when the detected model changes."""
        from retriever.genieai_retriever_arangodb import GenieaiArangoRetriever

        r = GenieaiArangoRetriever.__new__(GenieaiArangoRetriever)
        r._llm_model_id = "old-model"
        r.llm = MagicMock()

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "new-model"}]}

        with patch("httpx.get", return_value=mock_resp):
            r._get_llm()

        assert r._llm_model_id == "new-model"
        assert r.llm is not mock_resp  # client was recreated

    def test_get_llm_keeps_client_when_unchanged(self, monkeypatch):
        """_get_llm does NOT recreate the client when the model is unchanged."""
        from retriever.genieai_retriever_arangodb import GenieaiArangoRetriever

        r = GenieaiArangoRetriever.__new__(GenieaiArangoRetriever)
        r._llm_model_id = "same-model"
        existing_llm = MagicMock()
        r.llm = existing_llm

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "same-model"}]}

        with patch("httpx.get", return_value=mock_resp):
            result = r._get_llm()

        assert result is existing_llm  # same client object returned
