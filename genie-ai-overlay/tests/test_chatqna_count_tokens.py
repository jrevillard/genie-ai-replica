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
- without a discovered model id no request leaves at all, and a malformed
  count payload raises — a silent 0 would skip the overflow guard;
- a server without the route fails LOUDLY (the budget math runs on these
  counts — an approximation would silently corrupt history truncation).
"""

from unittest.mock import MagicMock, patch

import pytest


def _resp(json_body):
    m = MagicMock()
    m.json.return_value = json_body
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

    @pytest.mark.parametrize("count,expected", [(0, 0), (-1, None)])
    def test_non_positive_count_contract(self, count, expected):
        """0 is an honest count for an empty piece; a negative count from a
        broken proxy is a lie that would silently defeat the overflow guard —
        it must raise, never flow into the budget."""
        import chatqna.genieai_chatqna as m

        post = MagicMock(return_value=_resp({"count": count}))
        with (
            patch.object(m, "_LLM_DISCOVERY_ENDPOINT", "http://vllm:8000"),
            patch.object(m, "_get_llm_model", return_value="m"),
            patch.dict("os.environ", {"VLLM_API_KEY": ""}, clear=False),
            patch.object(m.httpx, "post", post),
        ):
            if expected is None:
                with pytest.raises(ValueError):
                    m._count_tokens("x")
            else:
                assert m._count_tokens("x") == expected

    def test_absurd_count_is_rejected(self):
        """A count above any conceivable window (broken proxy serializing
        1e18) would wipe the history budget — same sanity bound as the
        window value in core/model_cache."""
        import chatqna.genieai_chatqna as m

        post = MagicMock(return_value=_resp({"count": 10**18}))
        with (
            patch.object(m, "_LLM_DISCOVERY_ENDPOINT", "http://vllm:8000"),
            patch.object(m, "_get_llm_model", return_value="m"),
            patch.dict("os.environ", {"VLLM_API_KEY": ""}, clear=False),
            patch.object(m.httpx, "post", post),
            pytest.raises(ValueError),
        ):
            m._count_tokens("x")

    def test_count_tokens_emits_a_span(self, captured_spans):
        """Each count is visible in traces — the eventual offload/batching
        work needs the per-call cost on the waterfall."""
        import chatqna.genieai_chatqna as m

        post = MagicMock(return_value=_resp({"count": 7}))
        with (
            patch.object(m, "_LLM_DISCOVERY_ENDPOINT", "http://vllm:8000"),
            patch.object(m, "_get_llm_model", return_value="m"),
            patch.dict("os.environ", {"VLLM_API_KEY": ""}, clear=False),
            patch.object(m.httpx, "post", post),
        ):
            m._count_tokens("x")

        assert captured_spans("chatqna.count_tokens")

    def test_integral_float_count_is_coerced(self):
        """A proxy serializing the count as JSON float 12.0 must count as 12 —
        the same coercion stance as the window value in core/model_cache."""
        import chatqna.genieai_chatqna as m

        post = MagicMock(return_value=_resp({"count": 12.0}))
        with (
            patch.object(m, "_LLM_DISCOVERY_ENDPOINT", "http://vllm:8000"),
            patch.object(m, "_get_llm_model", return_value="m"),
            patch.dict("os.environ", {"VLLM_API_KEY": ""}, clear=False),
            patch.object(m.httpx, "post", post),
        ):
            assert m._count_tokens("x") == 12

    def test_raises_without_http_when_model_undiscovered(self):
        """No discovered id → no request at all: a payload carrying a guessed
        name would get a 404 from vLLM's model-name validation."""
        import chatqna.genieai_chatqna as m
        from core.model_cache import ModelDiscoveryError

        post = MagicMock()
        with (
            patch.object(m, "_get_llm_model", side_effect=ModelDiscoveryError("no id")),
            patch.object(m.httpx, "post", post),
            pytest.raises(ModelDiscoveryError),
        ):
            m._count_tokens("text")
        post.assert_not_called()

    @pytest.mark.parametrize("payload", [{}, {"count": None, "tokens": None}, "not-a-dict", 42, {"count": "abc"}])
    def test_malformed_payload_fails_loudly(self, payload):
        """A malformed count payload must RAISE — a silent 0 would skip the
        overflow guard and ship an oversized prompt to a confusing 400."""
        import chatqna.genieai_chatqna as m

        post = MagicMock(return_value=_resp(payload))
        with (
            patch.object(m, "_LLM_DISCOVERY_ENDPOINT", "http://vllm:8000"),
            patch.object(m, "_get_llm_model", return_value="m"),
            patch.dict("os.environ", {"VLLM_API_KEY": ""}, clear=False),
            patch.object(m.httpx, "post", post),
            pytest.raises(ValueError),
        ):
            m._count_tokens("text")
