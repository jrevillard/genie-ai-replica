# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
#
# Tests for lazy (TTL-cached) vLLM model resolution in chatqna.
#
# Previously the module probed /v1/models at import time. Now detection is
# lazy — the getters (_get_llm_model, _get_translation_model_id) probe on
# first call and cache the result. These tests verify that import does NOT
# trigger probes, and that the getters resolve correctly at call time.

import importlib
import sys
from unittest.mock import MagicMock, patch

import httpx
import pytest

from core.model_cache import clear_cache


@pytest.fixture(autouse=True)
def _clean_cache():
    clear_cache()
    yield
    clear_cache()


class TestLazyModelResolution:
    """Module import must not probe; getters resolve lazily."""

    def test_module_import_does_not_probe(self, monkeypatch):
        """Importing the module triggers zero /v1/models probes (lazy detection)."""
        monkeypatch.setenv("GPU_NODE_HOST", "10.0.0.110")
        monkeypatch.setenv("VLLM_LLM_ENDPOINT", "https://10.0.0.110/llm")
        monkeypatch.setenv("VLLM_TRANSLATION_ENDPOINT", "https://10.0.0.110/translation")
        monkeypatch.setenv("LLM_MODEL", "default-llm")

        with patch("httpx.get") as mock_get:
            importlib.reload(sys.modules["chatqna.genieai_chatqna"])

        mock_get.assert_not_called()
        _reload_with_clean_env(monkeypatch)

    def test_getter_returns_detected_model(self, monkeypatch):
        """_get_llm_model probes and returns the detected model."""
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "_GPU_NODE_HOST", "10.0.0.110")
        monkeypatch.setattr(mod, "_VLLM_LLM_ENDPOINT", "https://10.0.0.110/llm")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "detected-llm-model"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            result = mod._get_llm_model()

        assert result == "detected-llm-model"
        mock_get.assert_called_once()

    def test_getter_returns_default_when_no_gpu_host(self, monkeypatch):
        """Without GPU_NODE_HOST, getter returns the config default without probing."""
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "_GPU_NODE_HOST", "")
        monkeypatch.setattr(mod, "LLM_MODEL", "default-llm")

        with patch("httpx.get") as mock_get:
            result = mod._get_llm_model()

        assert result == "default-llm"
        mock_get.assert_not_called()

    def test_both_llm_and_translation_resolve(self, monkeypatch):
        """Both getters probe independently and return different models."""
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "_GPU_NODE_HOST", "10.0.0.110")
        monkeypatch.setattr(mod, "_VLLM_LLM_ENDPOINT", "https://10.0.0.110/llm")
        monkeypatch.setattr(mod, "_VLLM_TRANSLATION_ENDPOINT", "https://10.0.0.110/translation")

        def mock_get_fn(url, **kwargs):
            resp = MagicMock()
            if "/llm/" in url:
                resp.json.return_value = {"data": [{"id": "detected-llm"}]}
            else:
                resp.json.return_value = {"data": [{"id": "detected-trans"}]}
            return resp

        with patch("httpx.get", side_effect=mock_get_fn) as mock_get:
            llm = mod._get_llm_model()
            trans = mod._get_translation_model_id()

        assert llm == "detected-llm"
        assert trans == "detected-trans"
        assert mock_get.call_count == 2

    def test_getter_failure_returns_default(self, monkeypatch):
        """When the probe fails, getter returns the config default."""
        import chatqna.genieai_chatqna as mod

        monkeypatch.setattr(mod, "_GPU_NODE_HOST", "10.0.0.110")
        monkeypatch.setattr(mod, "_VLLM_LLM_ENDPOINT", "https://10.0.0.110/llm")
        monkeypatch.setattr(mod, "LLM_MODEL", "default-llm")

        with patch("httpx.get", side_effect=httpx.ConnectError("fail")):
            result = mod._get_llm_model()

        assert result == "default-llm"

    def test_empty_env_vars_do_not_crash_import(self, monkeypatch):
        """Compose injects the semantic knobs SET TO EMPTY STRING by default —
        import must tolerate that (int('') would crash-loop the container)."""
        monkeypatch.setenv("MAX_MODEL_LEN_TEXTGEN", "")
        monkeypatch.setenv("MAX_TRANSLATION_CHARS", "")

        mod = importlib.reload(sys.modules["chatqna.genieai_chatqna"])
        assert mod.MAX_MODEL_LEN_TEXTGEN == 65536
        assert mod.MAX_TRANSLATION_CHARS == 2000
        _reload_with_clean_env(monkeypatch)

    def test_discovery_endpoint_construction(self, monkeypatch):
        """Window-discovery endpoints: compose defaults build from the service
        host/port config; the remote endpoint vars win verbatim."""
        monkeypatch.setenv("LLM_SERVER_HOST_IP", "vllm")
        monkeypatch.setenv("LLM_SERVER_PORT", "8000")
        monkeypatch.setenv("TRANSLATION_SERVICE_HOST_IP", "vllm-translation-guardrail")
        monkeypatch.setenv("TRANSLATION_SERVICE_PORT", "9031")
        monkeypatch.delenv("VLLM_LLM_ENDPOINT", raising=False)
        monkeypatch.delenv("VLLM_TRANSLATION_ENDPOINT", raising=False)

        mod = importlib.reload(sys.modules["chatqna.genieai_chatqna"])
        assert mod._LLM_DISCOVERY_ENDPOINT == "http://vllm:8000"
        assert mod._TRANSLATION_DISCOVERY_ENDPOINT == "http://vllm-translation-guardrail:9031"

        monkeypatch.setenv("VLLM_LLM_ENDPOINT", "https://gpu-host:444/llm")
        monkeypatch.setenv("VLLM_TRANSLATION_ENDPOINT", "https://gpu-host:444/translation")
        mod = importlib.reload(sys.modules["chatqna.genieai_chatqna"])
        assert mod._LLM_DISCOVERY_ENDPOINT == "https://gpu-host:444/llm"
        assert mod._TRANSLATION_DISCOVERY_ENDPOINT == "https://gpu-host:444/translation"
        _reload_with_clean_env(monkeypatch)


def _reload_with_clean_env(monkeypatch):
    """Reload the module with the discovery-related env cleared so the mutated
    module state never leaks into later-collected test files."""
    for var in (
        "GPU_NODE_HOST",
        "VLLM_LLM_ENDPOINT",
        "VLLM_TRANSLATION_ENDPOINT",
        "LLM_SERVER_HOST_IP",
        "LLM_SERVER_PORT",
        "TRANSLATION_SERVICE_HOST_IP",
        "TRANSLATION_SERVICE_PORT",
        "LLM_MODEL",
    ):
        monkeypatch.delenv(var, raising=False)
    importlib.reload(sys.modules["chatqna.genieai_chatqna"])
