# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
#
# Tests for vLLM model auto-detection in chatqna and dataprep.

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

        monkeypatch.setenv("OPEA_API_KEY", "test-key")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "ibm-granite/granite-3.3-2b-instruct"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            result = _auto_detect_model("https://gpu-host/llm", "LLM_MODEL")

        assert result == "ibm-granite/granite-3.3-2b-instruct"
        mock_get.assert_called_once()
        call_kwargs = mock_get.call_args
        assert call_kwargs.kwargs["verify"] is False
        assert call_kwargs.kwargs["headers"]["X-API-Key"] == "test-key"

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

    def test_sends_opea_api_key_header(self, monkeypatch):
        from chatqna.genieai_chatqna import _auto_detect_model

        monkeypatch.setenv("OPEA_API_KEY", "test-api-key-123")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "model-a"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            _auto_detect_model("https://gpu-host/llm", "LLM_MODEL")

        headers = mock_get.call_args.kwargs["headers"]
        assert headers["X-API-Key"] == "test-api-key-123"

    def test_no_header_when_opea_api_key_unset(self, monkeypatch):
        from chatqna.genieai_chatqna import _auto_detect_model

        monkeypatch.delenv("OPEA_API_KEY", raising=False)

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
class TestModuleLevelAutoDetect:
    """Tests that module-level auto-detect runs when GPU_NODE_HOST is set.

    These tests clear the module cache and re-import with specific env vars.
    httpx.get is mocked to avoid real network calls.
    """

    @pytest.fixture(autouse=True)
    def _clear_module_cache(self):
        """Remove cached module so next import triggers module-level code."""
        import sys

        mod_name = "chatqna.genieai_chatqna"
        if mod_name in sys.modules:
            del sys.modules[mod_name]
        yield
        # Clean up after test
        if mod_name in sys.modules:
            del sys.modules[mod_name]

    def test_auto_detect_fires_when_gpu_node_host_set(self, monkeypatch):
        monkeypatch.setenv("GPU_NODE_HOST", "10.0.0.110")
        monkeypatch.setenv("VLLM_LLM_ENDPOINT", "https://10.0.0.110/llm")
        monkeypatch.setenv("VLLM_TRANSLATION_ENDPOINT", "https://10.0.0.110/translation")
        monkeypatch.setenv("OPEA_API_KEY", "test-key")
        monkeypatch.setenv("LLM_MODEL", "default-llm")
        monkeypatch.setenv("VLLM_TRANSLATION_MODEL_ID", "default-trans")
        monkeypatch.setenv("LLM_TRANS_MODEL", "default-trans")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "detected-llm-model"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            import importlib

            mod = importlib.import_module("chatqna.genieai_chatqna")

        assert mod.LLM_MODEL == "detected-llm-model"
        mock_get.assert_called()

    def test_auto_detect_skipped_when_no_gpu_node_host(self, monkeypatch):
        monkeypatch.delenv("GPU_NODE_HOST", raising=False)
        monkeypatch.setenv("LLM_MODEL", "default-llm")

        with patch("httpx.get") as mock_get:
            import importlib

            mod = importlib.import_module("chatqna.genieai_chatqna")

        assert mod.LLM_MODEL == "default-llm"
        mock_get.assert_not_called()

    def test_auto_detect_both_llm_and_translation(self, monkeypatch):
        monkeypatch.setenv("GPU_NODE_HOST", "10.0.0.110")
        monkeypatch.setenv("VLLM_LLM_ENDPOINT", "https://10.0.0.110/llm")
        monkeypatch.setenv("VLLM_TRANSLATION_ENDPOINT", "https://10.0.0.110/translation")
        monkeypatch.setenv("OPEA_API_KEY", "test-key")
        monkeypatch.setenv("LLM_MODEL", "default-llm")
        monkeypatch.setenv("VLLM_TRANSLATION_MODEL_ID", "default-trans")
        monkeypatch.setenv("LLM_TRANS_MODEL", "default-trans")

        call_count = 0

        def mock_get_fn(url, **kwargs):
            nonlocal call_count
            call_count += 1
            resp = MagicMock()
            if "/llm/" in url:
                resp.json.return_value = {"data": [{"id": "detected-llm"}]}
            else:
                resp.json.return_value = {"data": [{"id": "detected-trans"}]}
            return resp

        with patch("httpx.get", side_effect=mock_get_fn):
            import importlib

            mod = importlib.import_module("chatqna.genieai_chatqna")

        assert mod.LLM_MODEL == "detected-llm"
        assert mod.TRANSLATION_MODEL_ID == "detected-trans"
        assert mod.LLM_TRANS_MODEL == "detected-trans"
        assert call_count == 2

    def test_auto_detect_failure_keeps_default_model(self, monkeypatch):
        monkeypatch.setenv("GPU_NODE_HOST", "10.0.0.110")
        monkeypatch.setenv("VLLM_LLM_ENDPOINT", "https://10.0.0.110/llm")
        monkeypatch.setenv("VLLM_TRANSLATION_ENDPOINT", "")
        monkeypatch.setenv("LLM_MODEL", "default-llm")

        with patch("httpx.get", side_effect=httpx.ConnectError("fail")):
            import importlib

            mod = importlib.import_module("chatqna.genieai_chatqna")

        assert mod.LLM_MODEL == "default-llm"


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

    def test_uses_opea_api_key_not_vllm_api_key(self, source):
        idx = source.find("def _label_with_llm")
        chunk = source[idx : idx + 2000]  # look within method body

        assert "OPEA_API_KEY" in chunk
        assert "VLLM_API_KEY" not in chunk

    def test_passes_x_api_key_as_default_header(self, source):
        idx = source.find("def _label_with_llm")
        chunk = source[idx : idx + 2000]

        assert "default_headers" in chunk
        assert "X-API-Key" in chunk

    def test_auto_detect_condition_checks_gpu_node_host(self, source):
        idx = source.find("def _label_with_llm")
        chunk = source[idx : idx + 2000]

        assert 'os.getenv("GPU_NODE_HOST")' in chunk

    def test_auto_detect_uses_client_models_list(self, source):
        idx = source.find("def _label_with_llm")
        chunk = source[idx : idx + 2000]

        assert "models.list" in chunk or "await client.models.list()" in chunk
