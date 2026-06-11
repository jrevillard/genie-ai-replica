# Copyright (c) 2024-2026 International Telecommunication Union (ITU)
#
# Tests for module-level vLLM auto-detection in chatqna.
# These tests must run AFTER test_chatqna.py (alphabetically)
# because they use importlib.reload() which replaces module objects.

import importlib
import sys
from unittest.mock import MagicMock, patch

import httpx


class TestModuleLevelAutoDetect:
    """Tests that module-level auto-detect runs when GPU_NODE_HOST is set.

    These tests reload the module with specific env vars.
    httpx.get is mocked to avoid real network calls.
    IMPORTANT: importlib.reload() replaces function/class objects,
    so this test class must run AFTER test_chatqna.py (which imports
    specific references at collection time).
    """

    def test_auto_detect_fires_when_gpu_node_host_set(self, monkeypatch):
        monkeypatch.setenv("GPU_NODE_HOST", "10.0.0.110")
        monkeypatch.setenv("VLLM_LLM_ENDPOINT", "https://10.0.0.110/llm")
        monkeypatch.setenv("VLLM_TRANSLATION_ENDPOINT", "https://10.0.0.110/translation")
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
        monkeypatch.setenv("LLM_MODEL", "default-llm")
        monkeypatch.setenv("VLLM_TRANSLATION_MODEL_ID", "default-trans")
        monkeypatch.setenv("LLM_TRANS_MODEL", "default-trans")

        mock_resp = MagicMock()
        mock_resp.json.return_value = {"data": [{"id": "detected-llm-model"}]}

        with patch("httpx.get", return_value=mock_resp) as mock_get:
            mod = importlib.reload(sys.modules["chatqna.genieai_chatqna"])

        assert mod.LLM_MODEL == "detected-llm-model"
        mock_get.assert_called()

    def test_auto_detect_skipped_when_no_gpu_node_host(self, monkeypatch):
        monkeypatch.delenv("GPU_NODE_HOST", raising=False)
        monkeypatch.setenv("LLM_MODEL", "default-llm")

        with patch("httpx.get") as mock_get:
            mod = importlib.reload(sys.modules["chatqna.genieai_chatqna"])

        assert mod.LLM_MODEL == "default-llm"
        mock_get.assert_not_called()

    def test_auto_detect_both_llm_and_translation(self, monkeypatch):
        monkeypatch.setenv("GPU_NODE_HOST", "10.0.0.110")
        monkeypatch.setenv("VLLM_LLM_ENDPOINT", "https://10.0.0.110/llm")
        monkeypatch.setenv("VLLM_TRANSLATION_ENDPOINT", "https://10.0.0.110/translation")
        monkeypatch.setenv("VLLM_API_KEY", "test-key")
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
            mod = importlib.reload(sys.modules["chatqna.genieai_chatqna"])

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
            mod = importlib.reload(sys.modules["chatqna.genieai_chatqna"])

        assert mod.LLM_MODEL == "default-llm"
