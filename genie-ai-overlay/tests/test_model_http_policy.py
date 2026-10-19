# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Tests for the shared model-endpoint HTTP budget policy."""

import importlib
import os

import core.model_http_policy as policy

_ENV_KEYS = (
    "MODEL_LLM_TIMEOUT_SECONDS",
    "VLLM_TIMEOUT",
    "MODEL_LLM_MAX_RETRIES",
    "MODEL_TEI_TIMEOUT_SECONDS",
)


def _reload_with(**env):
    """Reload the policy with *env* applied; return a VALUE snapshot.

    importlib.reload mutates the module object in place, so returning the
    module would expose whatever the finally-block restore-reload computes.
    """
    saved = {k: os.environ.pop(k, None) for k in _ENV_KEYS}
    try:
        for k, v in env.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        m = importlib.reload(policy)
        return {
            "llm_timeout": m.LLM_TIMEOUT_SECONDS,
            "llm_retries": m.LLM_MAX_RETRIES,
            "tei_timeout": m.TEI_TIMEOUT_SECONDS,
        }
    finally:
        for k, v in saved.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v
        importlib.reload(policy)


class TestDefaults:
    def test_llm_timeout_default(self):
        assert _reload_with()["llm_timeout"] == 600.0

    def test_llm_max_retries_default(self):
        assert _reload_with()["llm_retries"] == 2

    def test_tei_timeout_default(self):
        assert _reload_with()["tei_timeout"] == 120.0


class TestPrecedence:
    def test_model_llm_timeout_wins_over_legacy(self):
        m = _reload_with(MODEL_LLM_TIMEOUT_SECONDS="120", VLLM_TIMEOUT="999")
        assert m["llm_timeout"] == 120.0

    def test_legacy_vllm_timeout_still_honored(self):
        assert _reload_with(VLLM_TIMEOUT="77")["llm_timeout"] == 77.0


class TestInvalidValues:
    def test_non_numeric_falls_back_to_default(self):
        m = _reload_with(MODEL_LLM_TIMEOUT_SECONDS="not-a-number")
        assert m["llm_timeout"] == 600.0

    def test_zero_rejected(self):
        assert _reload_with(MODEL_TEI_TIMEOUT_SECONDS="0")["tei_timeout"] == 120.0

    def test_negative_rejected(self):
        assert _reload_with(MODEL_LLM_MAX_RETRIES="-3")["llm_retries"] == 2
