# Copyright (c) 2025-2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Tests for the vLLM ``/tokenize`` token counter in chatqna.

The counter replaced a local ``AutoTokenizer.from_pretrained`` that could
only ever fail in a deployed pod (no HF cache, no hub egress). These tests
pin the contract that matters at the deployment boundary:

- the URL derives from ``_LLM_DISCOVERY_ENDPOINT`` — the same base the
  generation call and the model probe use, so external (``VLLM_LLM_ENDPOINT``,
  possibly with a path prefix) and in-cluster resolve identically;
- the request carries the deployed model id and the Bearer key;
- the server's ``count`` scalar wins, the token list is the fallback;
- a server without the route fails LOUDLY (the budget math runs on these
  counts — an approximation would silently corrupt history truncation).
"""

from unittest.mock import MagicMock, patch

import pytest


def _resp(json_body, status=200):
    m = MagicMock()
    m.status_code = status
    m.json.return_value = json_body
    m.raise_for_status.side_effect = None if status < 400 else AssertionError("raise_for_status must raise")
    return m


class TestCountTokens:
    def test_posts_to_discovery_endpoint_with_model_and_key(self):
        """The URL, body and auth derive from the same discovery base the
        generation call uses — external path-prefix included."""
        import chatqna.genieai_chatqna as m

        post = MagicMock(return_value=_resp({"count": 7, "tokens": [0] * 7}))
        with (
            patch.object(m, "_LLM_DISCOVERY_ENDPOINT", "https://gpu-host:9443/llm"),
            patch.object(m, "_get_llm_model", return_value="ibm-granite/granite-4.1-8b"),
            patch.dict("os.environ", {"VLLM_API_KEY": "k-test"}),
            patch.object(m.httpx, "post", post),
        ):
            assert m._count_tokens("hello world") == 7
        args, kwargs = post.call_args
        assert args[0] == "https://gpu-host:9443/llm/tokenize"
        assert kwargs["json"] == {"model": "ibm-granite/granite-4.1-8b", "prompt": "hello world"}
        assert kwargs["headers"]["Authorization"] == "Bearer k-test"

    def test_counts_from_token_list_when_count_absent(self):
        """Servers that omit the precomputed scalar still give a count."""
        import chatqna.genieai_chatqna as m

        post = MagicMock(return_value=_resp({"tokens": [1, 2, 3, 4]}))
        with (
            patch.object(m, "_LLM_DISCOVERY_ENDPOINT", "http://vllm:8000"),
            patch.object(m, "_get_llm_model", return_value="m"),
            patch.dict("os.environ", {"VLLM_API_KEY": ""}, clear=False),
            patch.object(m.httpx, "post", post),
        ):
            assert m._count_tokens("text") == 4
        _, kwargs = post.call_args
        assert "Authorization" not in kwargs["headers"]  # empty key sends no header

    def test_http_error_propagates_loudly(self):
        """A non-2xx (old vLLM without the route) must RAISE — the caller's
        budget math cannot run on a guess, and a swallowed error would
        silently disable history truncation."""
        import chatqna.genieai_chatqna as m

        post = MagicMock()
        post.return_value.raise_for_status.side_effect = m.httpx.HTTPStatusError(
            "404 Not Found", request=MagicMock(), response=MagicMock(status_code=404)
        )
        with (
            patch.object(m, "_LLM_DISCOVERY_ENDPOINT", "http://vllm:8000"),
            patch.object(m, "_get_llm_model", return_value="m"),
            patch.dict("os.environ", {"VLLM_API_KEY": ""}, clear=False),
            patch.object(m.httpx, "post", post),
            pytest.raises(m.httpx.HTTPStatusError),
        ):
            m._count_tokens("text")

    def test_in_cluster_base_without_path_prefix(self):
        """No VLLM_LLM_ENDPOINT → the compose-internal base, no path prefix."""
        import chatqna.genieai_chatqna as m

        post = MagicMock(return_value=_resp({"count": 1}))
        with (
            patch.object(m, "_LLM_DISCOVERY_ENDPOINT", "http://vllm:8000"),
            patch.object(m, "_get_llm_model", return_value="m"),
            patch.dict("os.environ", {"VLLM_API_KEY": ""}, clear=False),
            patch.object(m.httpx, "post", post),
        ):
            m._count_tokens("x")
        assert post.call_args[0][0] == "http://vllm:8000/tokenize"

    def test_string_count_is_coerced(self):
        """A proxy serializing ``count`` as a digit string must not crash the
        budget path (same coercion stance as core/model_cache)."""
        import chatqna.genieai_chatqna as m

        post = MagicMock(return_value=_resp({"count": "12"}))
        with (
            patch.object(m, "_LLM_DISCOVERY_ENDPOINT", "http://vllm:8000"),
            patch.object(m, "_get_llm_model", return_value="m"),
            patch.dict("os.environ", {"VLLM_API_KEY": ""}, clear=False),
            patch.object(m.httpx, "post", post),
        ):
            assert m._count_tokens("x") == 12
