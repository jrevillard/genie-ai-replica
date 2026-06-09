# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
#
# Tests for vLLM model auto-detection in chatqna and dataprep.

import os
from pathlib import Path
from unittest.mock import MagicMock, patch

import httpx
import pytest


# ---------------------------------------------------------------------------
# _auto_detect_model — chatqna unit tests
# ---------------------------------------------------------------------------
class TestAutoDetectModel:
    """Tests for chatqna._auto_detect_model function."""

    def test_returns_model_id_on_success(self, monkeypatch):
        from chatqna.genieai_chatqna import _auto_detect_model

        monkeypatch.setenv("VLLM_API_KEY", "test-key")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "ibm-granite/granite-3.3-2b-instruct"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            result = _auto_detect_model("https://gpu-host/llm", "LLM_MODEL")

        assert result == "ibm-granite/granite-3.3-2b-instruct"
        mock_get.assert_called_once()
        call_kwargs = mock_get.call_args
        assert call_kwargs.kwargs["verify"] is False
        assert call_kwargs.kwargs["headers"]["Authorization"] == "Bearer test-key"

    def test_returns_none_when_no_models_in_response(self):
        from chatqna.genieai_chatqna import _auto_detect_model

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": []}

        with patch("httpx.get", return_value=mock_resp):
            result = _auto_detect_model("https://gpu-host/llm", "LLM_MODEL")

        assert result is None

    def test_returns_none_on_http_error(self):
        from chatqna.genieai_chatqna import _auto_detect_model

        mock_resp = MagicMock()
        mock_resp.status_code = 503
        mock_resp.raise_for_status.side_effect = httpx.HTTPStatusError("503", request=MagicMock(), response=mock_resp)

        with patch("httpx.get", return_value=mock_resp):
            result = _auto_detect_model("https://gpu-host/llm", "LLM_MODEL")

        assert result is None

    def test_returns_none_on_connection_error(self):
        from chatqna.genieai_chatqna import _auto_detect_model

        with patch("httpx.get", side_effect=httpx.ConnectError("Connection refused")):
            result = _auto_detect_model("https://gpu-host/llm", "LLM_MODEL")

        assert result is None

    def test_returns_none_on_timeout(self):
        from chatqna.genieai_chatqna import _auto_detect_model

        with patch("httpx.get", side_effect=httpx.TimeoutException("Timeout")):
            result = _auto_detect_model("https://gpu-host/llm", "LLM_MODEL")

        assert result is None

    def test_sends_vllm_api_key_as_bearer(self, monkeypatch):
        from chatqna.genieai_chatqna import _auto_detect_model

        monkeypatch.setenv("VLLM_API_KEY", "test-api-key-123")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            _auto_detect_model("https://gpu-host/llm", "LLM_MODEL")

        headers = mock_get.call_args.kwargs["headers"]
        assert headers["Authorization"] == "Bearer test-api-key-123"

    def test_no_header_when_vllm_api_key_unset(self, monkeypatch):
        from chatqna.genieai_chatqna import _auto_detect_model

        monkeypatch.delenv("VLLM_API_KEY", raising=False)

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            _auto_detect_model("https://gpu-host/llm", "LLM_MODEL")

        headers = mock_get.call_args.kwargs["headers"]
        assert headers == {}

    def test_timeout_is_10_seconds(self):
        from chatqna.genieai_chatqna import _auto_detect_model

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            _auto_detect_model("https://gpu-host/llm", "LLM_MODEL")

        assert mock_get.call_args.kwargs["timeout"] == 10

    def test_returns_first_model_from_list(self):
        from chatqna.genieai_chatqna import _auto_detect_model

        mock_resp = MagicMock()
        mock_resp.json.return_value = {
            "data": [
                {"id": "model-first"},
                {"id": "model-second"},
            ]
        }

        with patch("httpx.get", return_value=mock_resp):
            result = _auto_detect_model("https://gpu-host/llm", "LLM_MODEL")

        assert result == "model-first"


# ---------------------------------------------------------------------------
# Module-level auto-detect — integration test
# ---------------------------------------------------------------------------
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
        chunk = source[idx : idx + 2000]  # look within method body

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

    def test_auto_detect_uses_client_models_list(self, source):
        idx = source.find("def _label_with_llm")
        chunk = source[idx : idx + 2000]

        assert "models.list" in chunk or "await client.models.list()" in chunk


# ---------------------------------------------------------------------------
# Dataprep _initialize_llm — auto-detection of remote vLLM model
# ---------------------------------------------------------------------------
class TestDataprepInitializeLlmAutoDetect:
    """Tests for dataprep._initialize_llm override that auto-detects remote vLLM model.

    When GPU_NODE_HOST is set, the override probes /v1/models and sets
    VLLM_MODEL_ID in os.environ before calling the parent method.
    """

    @pytest.fixture(autouse=True)
    def _setup(self, monkeypatch):
        monkeypatch.setenv("GPU_NODE_HOST", "10.0.0.110")
        monkeypatch.setenv("VLLM_ENDPOINT", "https://10.0.0.110/vllm")
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("VLLM_MODEL_ID", "default-model")
        yield
        # Clean up env var that the override may have overridden
        monkeypatch.delenv("VLLM_MODEL_ID", raising=False)

    def test_remote_model_overrides_config_default(self):
        """When /v1/models returns a model, VLLM_MODEL_ID env var is overridden."""
        from dataprep.genieai_dataprep_arangodb import GenieArangoDataprep

        dp = GenieArangoDataprep.__new__(GenieArangoDataprep)

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "detected-model"}]}
        mock_resp.raise_for_status = MagicMock()

        with patch("requests.get", return_value=mock_resp):
            dp._initialize_llm(allowed_node_types=[], allowed_edge_types=[])

        # Verify both the env var AND the parent module constant are patched
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

        with patch("requests.get", return_value=mock_resp) as mock_get:
            dp._initialize_llm(allowed_node_types=[], allowed_edge_types=[])

        mock_get.assert_not_called()

    def test_failure_preserves_config_default(self):
        """When /v1/models fails, VLLM_MODEL_ID keeps its config default."""
        from dataprep.genieai_dataprep_arangodb import GenieArangoDataprep

        dp = GenieArangoDataprep.__new__(GenieArangoDataprep)

        with patch("requests.get", side_effect=Exception("Connection refused")):
            dp._initialize_llm(allowed_node_types=[], allowed_edge_types=[])

        assert os.getenv("VLLM_MODEL_ID") == "default-model"


# ---------------------------------------------------------------------------
# Retriever _initialize_llm — auto-detection of remote vLLM model
# ---------------------------------------------------------------------------
class TestRetrieverInitializeLlmAutoDetect:
    """Behavioral tests for retriever._initialize_llm auto-detection.

    Verifies that when GPU_NODE_HOST is set, the auto-detected model ID
    (from /v1/models) is passed to ChatOpenAI instead of the config default.
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

        with patch("requests.get", return_value=mock_resp):
            r._initialize_llm()

        assert ChatOpenAI.call_args.kwargs["model"] == "detected-llm"

    def test_config_default_when_no_gpu_host(self, monkeypatch):
        """Without GPU_NODE_HOST, config default model is used in ChatOpenAI."""
        from retriever.genieai_retriever_arangodb import ChatOpenAI, GenieaiArangoRetriever

        monkeypatch.delenv("GPU_NODE_HOST", raising=False)
        r = GenieaiArangoRetriever.__new__(GenieaiArangoRetriever)
        ChatOpenAI.reset_mock()

        with patch("requests.get") as mock_get:
            r._initialize_llm()

        mock_get.assert_not_called()
        assert ChatOpenAI.call_args.kwargs["model"] == "default-model"

    def test_failure_falls_back_to_default(self):
        """When /v1/models fails, config default model is used as fallback."""
        from retriever.genieai_retriever_arangodb import ChatOpenAI, GenieaiArangoRetriever

        r = GenieaiArangoRetriever.__new__(GenieaiArangoRetriever)
        ChatOpenAI.reset_mock()

        with patch("requests.get", side_effect=Exception("Connection refused")):
            r._initialize_llm()

        assert ChatOpenAI.call_args.kwargs["model"] == "default-model"
