# Copyright (c) 2024-2026 International Telecommunication Union (ITU);
#
# This software is part of GENIE.AI, an open-source generative AI framework
# for the public sector, distributed under the GNU Affero General Public
# License v3.0. See the `LICENSE` file for the full text.

"""Condense-question rewrite (issue #1091): prompt assembly, response
parsing, skip conditions, fail-closed semantics, the raw-query RAG
prompt override, and the handle_request dispatch."""

import json as json_module
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from fastapi import HTTPException

import chatqna.genieai_chatqna as chatqna_module
from chatqna.genieai_chatqna import (
    _CONDENSE_SYSTEM_PROMPT,
    ChatQnAService,
    CondenseError,
    _build_condense_user_content,
    _parse_condense_response,
)

# Hoisted from the per-test lazy imports that pre-dated this file's
# refactor: the comps mocks are pre-populated by tests/conftest.py before
# collection, so the import order is safe at module top.
from tests.test_chatqna import (
    _fake_parms,
    create_chatqna_service,
    create_mock_request,
)


class TestCondensePromptAssembly:
    def test_user_content_places_history_then_latest_message(self):
        content = _build_condense_user_content("USER: bean?\nASSISTANT: EAC ...", "maize instead")
        assert content.startswith("CHAT HISTORY:\nUSER: bean?\nASSISTANT: EAC ...")
        assert "\n\nLATEST MESSAGE:\nmaize instead\n\nStandalone query:" in content
        assert content.endswith("Standalone query:")

    def test_system_prompt_is_pinned(self):
        # The exact validated prompt (deterministic 3/3 on granite-4.1-8b live
        # harness, issue #1091). Changing it is a deliberate act, not a drive-by.
        assert _CONDENSE_SYSTEM_PROMPT == (
            "You rewrite a user's follow-up message into a standalone information-retrieval "
            "query. Resolve pronouns and implicit references using the chat history. "
            "EXCLUDE anything the user rejects. Output JSON only: "
            '{"standalone_query": "..."}'
        )


class TestParseCondenseResponse:
    def test_ok(self):
        assert _parse_condense_response('{"standalone_query": "maize planting density CENTA"}') == (
            "maize planting density CENTA"
        )

    def test_strips_whitespace(self):
        assert _parse_condense_response('{"standalone_query": "  maize planting  "}') == "maize planting"

    def test_fenced_json_is_tolerated(self):
        fenced = '```json\n{"standalone_query": "maize"}\n```'
        assert _parse_condense_response(fenced) == "maize"

    def test_invalid_json_raises_bad_body(self):
        with pytest.raises(CondenseError) as ei:
            _parse_condense_response("maize planting density")
        assert ei.value.reason == "bad_body"

    def test_missing_key_raises_empty_query(self):
        with pytest.raises(CondenseError) as ei:
            _parse_condense_response('{"answer": "maize"}')
        assert ei.value.reason == "empty_query"

    def test_whitespace_only_query_raises_empty_query(self):
        with pytest.raises(CondenseError) as ei:
            _parse_condense_response('{"standalone_query": "   \\n  "}')
        assert ei.value.reason == "empty_query"

    def test_non_dict_json_raises_empty_query(self):
        with pytest.raises(CondenseError) as ei:
            _parse_condense_response('["maize"]')
        assert ei.value.reason == "empty_query"

    def test_non_string_content_raises_missing_field(self):
        with pytest.raises(CondenseError) as ei:
            _parse_condense_response(None)
        assert ei.value.reason == "missing_field"

    def test_single_line_fenced_json_is_tolerated(self):
        """Single-line `` ```json{...}``` `` reply (no inner newline) — the
        previous ``split('\\n', 1)`` branch did not fire and the leading fence
        leaked into ``json.loads`` → JSONDecodeError → 503. Findings #5."""
        assert _parse_condense_response('```json{"standalone_query": "maize"}```') == "maize"

    def test_multiline_fenced_json_is_tolerated(self):
        """Multi-line `` ```json\\n{...}\\n``` `` — pinned by the existing
        ``test_fenced_json_is_tolerated``; re-asserted under the new fence
        handling."""
        fenced = '```json\n{"standalone_query": "maize"}\n```'
        assert _parse_condense_response(fenced) == "maize"

    def test_fenced_json_without_language_tag_is_tolerated(self):
        """`` ```\\n{...}\\n``` `` — no ``json`` language tag."""
        assert _parse_condense_response('```\n{"standalone_query": "maize"}\n```') == "maize"

    def test_tolerant_env_int_helper_falls_back_on_empty(self):
        """Finding #3: the bare ``int(os.getenv(...))`` form crashed the
        service at import when the condense knob was set to empty.
        ``_env_int`` (now defined above the MULTI_TURN_* constants) must
        return the default for empty / unset / non-numeric values."""
        from chatqna.genieai_chatqna import _env_int

        # Default path (unset).
        assert _env_int("UNSET_VAR_THAT_DOES_NOT_EXIST_XYZ", 4) == 4
        # Empty string (compose's default injection for semantic knobs).
        with patch.dict("os.environ", {"MULTI_TURN_CONDENSE_HISTORY_TURNS": ""}, clear=False):
            assert _env_int("MULTI_TURN_CONDENSE_HISTORY_TURNS", 8) == 8
        # Non-numeric value — must not raise, must fall back to default.
        with patch.dict("os.environ", {"MULTI_TURN_CONDENSE_HISTORY_TURNS": "abc"}, clear=False):
            assert _env_int("MULTI_TURN_CONDENSE_HISTORY_TURNS", 8) == 8
        # Valid value — passes through unchanged.
        with patch.dict("os.environ", {"MULTI_TURN_CONDENSE_HISTORY_TURNS": "7"}, clear=False):
            assert _env_int("MULTI_TURN_CONDENSE_HISTORY_TURNS", 8) == 7

    def test_tolerant_env_float_helper_falls_back_on_empty(self):
        """``_env_float`` mirrors ``_env_int``'s tolerant contract for the
        condense timeout knob (MULTI_TURN_CONDENSE_TIMEOUT_SECONDS)."""
        from chatqna.genieai_chatqna import _env_float

        # Default path (unset).
        assert _env_float("UNSET_VAR_THAT_DOES_NOT_EXIST_XYZ", 5.0) == 5.0
        # Empty string.
        with patch.dict("os.environ", {"MULTI_TURN_CONDENSE_TIMEOUT_SECONDS": ""}, clear=False):
            assert _env_float("MULTI_TURN_CONDENSE_TIMEOUT_SECONDS", 5.0) == 5.0
        # Non-numeric value — must not raise, must fall back to default.
        with patch.dict("os.environ", {"MULTI_TURN_CONDENSE_TIMEOUT_SECONDS": "abc"}, clear=False):
            assert _env_float("MULTI_TURN_CONDENSE_TIMEOUT_SECONDS", 5.0) == 5.0
        # Valid value — passes through unchanged.
        with patch.dict("os.environ", {"MULTI_TURN_CONDENSE_TIMEOUT_SECONDS": "8.5"}, clear=False):
            assert _env_float("MULTI_TURN_CONDENSE_TIMEOUT_SECONDS", 5.0) == 8.5


def _condense_response_payload(content='{"standalone_query": "maize planting density CENTA"}'):
    return {
        "choices": [{"message": {"content": content}}],
        "usage": {"prompt_tokens": 183, "completion_tokens": 16},
    }


def _make_httpx_response(status_code=200, json_data=None, text=None):
    resp = MagicMock()
    resp.status_code = status_code
    if json_data is not None:
        resp.json.return_value = json_data
    if text is not None:
        resp.text = text
    resp.raise_for_status.side_effect = (
        httpx.HTTPStatusError("500", request=MagicMock(), response=resp) if status_code >= 400 else None
    )
    return resp


def _make_fake_client(post):
    """Return a class whose ``AsyncClient.post`` delegates to ``post``.

    Five pre-refactor ``_FakeClient`` classes inlined an identical
    ``__init__`` / ``__aenter__`` / ``__aexit__`` skeleton — only ``post``
    varied. The factory collapses them into one; each test defines a small
    ``_post(url, json=..., headers=...)`` and patches the AsyncClient symbol
    with ``_make_fake_client(_post)``. ``post`` may be a regular function
    (sync body is fine — ``__init__`` and ``__aenter__`` stay async).
    """

    class _FakeClient:
        def __init__(self, *a, **kw):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, json=None, headers=None):
            return post(url, json=json, headers=headers)

    return _FakeClient


class TestCondenseQueryCall:
    """_condense_query: endpoint/model resolution, payload shape, span attrs."""

    @pytest.mark.asyncio
    async def test_ok_returns_query_and_sends_frozen_payload(self):
        svc = create_chatqna_service()
        captured = {}

        def _post(url, json=None, headers=None):
            captured.update(url=url, json=json, headers=headers)
            return _make_httpx_response(json_data=_condense_response_payload())

        with (
            patch.object(chatqna_module, "_get_llm_model", return_value="granite-4.1-8b"),
            patch.object(chatqna_module, "OPENAI_API_KEY", "test-key"),
            patch.object(chatqna_module.httpx, "AsyncClient", _make_fake_client(_post)),
        ):
            query = await svc._condense_query("USER: bean?\nASSISTANT: EAC ...", "maize instead")

        assert query == "maize planting density CENTA"
        assert captured["url"].endswith("/v1/chat/completions")
        assert captured["json"]["model"] == "granite-4.1-8b"
        assert captured["json"]["temperature"] == 0.0
        assert captured["json"]["max_tokens"] == 256
        assert captured["json"]["response_format"] == {"type": "json_object"}
        assert captured["json"]["stream"] is False
        assert captured["json"]["messages"][0]["role"] == "system"
        assert captured["json"]["messages"][0]["content"] == _CONDENSE_SYSTEM_PROMPT
        assert captured["json"]["messages"][1]["content"].endswith("Standalone query:")
        assert captured["headers"]["Authorization"] == "Bearer test-key"

    @pytest.mark.asyncio
    async def test_model_discovery_failure_is_classified_503(self):
        """No discovered model id → the SAME fail-closed 503 envelope as any
        other condense failure (the payload build lives inside the classified
        try; a raw ModelDiscoveryError must not escape as an unclassified
        500 that bypasses the caller's metrics)."""
        from core.model_cache import ModelDiscoveryError

        svc = create_chatqna_service()

        with (
            patch.object(chatqna_module, "_get_llm_model", side_effect=ModelDiscoveryError("no id")),
            pytest.raises(HTTPException) as exc_info,
        ):
            await svc._condense_query("USER: bean?", "maize instead")

        assert exc_info.value.status_code == 503

    @pytest.mark.asyncio
    async def test_system_prompt_env_override_reaches_payload(self):
        """MULTI_TURN_CONDENSE_SYSTEM_PROMPT (two-tier priority, same contract
        as CHATQNA_SYSTEM_PROMPT): a set value drives the rewrite call's
        system message; empty/whitespace falls back to the built-in default."""
        svc = create_chatqna_service()
        captured = {}

        def _post(url, json=None, headers=None):
            captured.update(json=json)
            return _make_httpx_response(json_data=_condense_response_payload())

        override = "CUSTOM rewrite prompt. Output JSON only."
        with (
            patch.dict("os.environ", {"MULTI_TURN_CONDENSE_SYSTEM_PROMPT": override}, clear=False),
            patch.object(chatqna_module, "_get_llm_model", return_value="granite-4.1-8b"),
            patch.object(chatqna_module, "OPENAI_API_KEY", "test-key"),
            patch.object(chatqna_module.httpx, "AsyncClient", _make_fake_client(_post)),
        ):
            await svc._condense_query("USER: bean?\nASSISTANT: EAC ...", "maize instead")
        assert captured["json"]["messages"][0]["content"] == override

        with (
            patch.dict("os.environ", {"MULTI_TURN_CONDENSE_SYSTEM_PROMPT": "   "}, clear=False),
            patch.object(chatqna_module, "_get_llm_model", return_value="granite-4.1-8b"),
            patch.object(chatqna_module, "OPENAI_API_KEY", "test-key"),
            patch.object(chatqna_module.httpx, "AsyncClient", _make_fake_client(_post)),
        ):
            await svc._condense_query("USER: bean?\nASSISTANT: EAC ...", "maize instead")
        assert captured["json"]["messages"][0]["content"] == _CONDENSE_SYSTEM_PROMPT

    @pytest.mark.asyncio
    async def test_token_attrs_emitted_via_raw_set_attribute_bypass_pii_filter(self):
        """Finding #1: ``sanitize_attributes`` drops any key whose name matches
        the ``token`` PII regex — the condense span's ``prompt_tokens`` /
        ``completion_tokens`` ints would be silently dropped. The fix routes
        ONLY the two token counters through raw ``span.set_attribute``; the
        other attrs (``mode`` / ``status`` / ``latency_ms``) still go through
        ``sanitize_attributes``. This test pins that the raw path is taken
        for the counters and that they reach the span verbatim."""
        svc = create_chatqna_service()
        tracer = MagicMock()
        span = MagicMock()
        span.__enter__ = MagicMock(return_value=span)
        span.__exit__ = MagicMock(return_value=False)
        tracer.start_as_current_span.return_value = span

        def _post(url, json=None, headers=None):
            # usage carries the two counter values that must surface on the span.
            return _make_httpx_response(json_data=_condense_response_payload())

        with (
            patch.object(chatqna_module, "_get_llm_model", return_value="granite-4.1-8b"),
            patch.object(chatqna_module, "OPENAI_API_KEY", "test-key"),
            patch.object(chatqna_module.httpx, "AsyncClient", _make_fake_client(_post)),
            patch.object(chatqna_module, "get_tracer", return_value=tracer),
            # chatqna imports sanitize_attributes from `metrics` (a MagicMock
            # in conftest). Restore the real one so the sanitized dict is
            # actually a dict we can inspect.
            patch.object(chatqna_module, "sanitize_attributes", side_effect=lambda d: dict(d)),
        ):
            await svc._condense_query("h", "m")

        # The two token counters MUST be set on the span directly (raw path)
        # so the PII regex cannot drop them.
        span.set_attribute.assert_any_call("genie.condense.prompt_tokens", 183)
        span.set_attribute.assert_any_call("genie.condense.completion_tokens", 16)

        # The other attrs (mode / status / latency_ms) flow through
        # set_attributes(...) with the sanitized dict — pin that the dict
        # does NOT carry the token counters (they would be filtered out).
        set_attributes_calls = span.set_attributes.call_args_list
        assert set_attributes_calls, "expected set_attributes(...) call(s) for ok path"
        merged: dict = {}
        for call in set_attributes_calls:
            merged.update(call.args[0])
        # Sanity: non-token attrs land; token attrs are NOT in the sanitized dict.
        assert merged.get("genie.condense.status") == "ok"
        assert "genie.condense.prompt_tokens" not in merged
        assert "genie.condense.completion_tokens" not in merged

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "exc,reason",
        [
            (httpx.ReadTimeout("t"), "timeout"),
            (httpx.ConnectError("c"), "http_error"),
        ],
    )
    async def test_transport_failures_map_to_503(self, exc, reason):
        svc = create_chatqna_service()

        def _post(url, json=None, headers=None):
            raise exc

        with (
            patch.object(chatqna_module.httpx, "AsyncClient", _make_fake_client(_post)),
            pytest.raises(HTTPException) as ei,
        ):
            await svc._condense_query("h", "m")
        assert ei.value.status_code == 503
        assert ei.value.detail["error"] == "condense_failed"
        assert ei.value.detail["reason"] == reason

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "json_data,reason",
        [
            (None, "bad_body"),  # 200 non-JSON body
            (_condense_response_payload("not json"), "bad_body"),  # non-JSON content
            ({"error": "boom", "error_type": "e"}, "missing_field"),  # vLLM error envelope
            (_condense_response_payload('{"standalone_query": ""}'), "empty_query"),
        ],
    )
    async def test_decode_failures_map_to_503(self, json_data, reason):
        svc = create_chatqna_service()
        resp = _make_httpx_response(
            text="not json" if json_data is None else None,
            json_data=None if json_data is None else json_data,
        )
        if json_data is None:
            resp.json.side_effect = json_module.JSONDecodeError("x", "d", 0)

        def _post(url, json=None, headers=None):
            return resp

        with (
            patch.object(chatqna_module.httpx, "AsyncClient", _make_fake_client(_post)),
            pytest.raises(HTTPException) as ei,
        ):
            await svc._condense_query("h", "m")
        assert ei.value.status_code == 503
        assert ei.value.detail["reason"] == reason

    @pytest.mark.asyncio
    async def test_http_5xx_maps_to_503(self):
        svc = create_chatqna_service()
        resp = _make_httpx_response(status_code=500, json_data={"error": "internal"})

        def _post(url, json=None, headers=None):
            return resp

        with (
            patch.object(chatqna_module.httpx, "AsyncClient", _make_fake_client(_post)),
            pytest.raises(HTTPException) as ei,
        ):
            await svc._condense_query("h", "m")
        assert ei.value.status_code == 503
        assert ei.value.detail["reason"] == "http_error"


# ---------------------------------------------------------------------------
# Task 3: handle_request dispatch (issue #1091)
# ---------------------------------------------------------------------------
_DEFAULT_HISTORY_BLOB = "USER: bean question |<-MSG->| ASSISTANT: EAC answer |<-MSG->| USER: maize instead"


class TestHandleRequestCondenseWiring:
    """handle_request dispatch: condense vs blend vs single-turn skip."""

    @staticmethod
    def _svc_with_schedule(
        history_blob: str = _DEFAULT_HISTORY_BLOB,
    ):
        svc = create_chatqna_service()
        svc.megaservice.schedule = AsyncMock(return_value=({"llm": {"text": "ok"}}, {}))
        # (text, status): the status reports what the embedder was fed.
        svc._get_translated_history_string = AsyncMock(return_value=(history_blob, "translated"))
        svc._finalize_llm_response = AsyncMock(return_value=("ok", None, None))
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.5, True))
        return svc

    @staticmethod
    def _req():
        return create_mock_request(
            data={"messages": [{"role": "user", "content": "x"}], "model": "m"},
            headers={"Authorization": "Bearer tok"},
        )

    @staticmethod
    def _patches():
        from contextlib import ExitStack

        # Bundle the fixtures into a single context manager so callers can
        # write ``with self._patches():`` instead of unpacking five patches.
        # Entering patches eagerly (rather than returning the bare tuple)
        # also guarantees StopIteration-free cleanup under the comps MagicMock
        # — see _fake_parms docstring at test_chatqna.py:3726.
        stack = ExitStack()
        stack.enter_context(patch("chatqna.genieai_chatqna.validate_token", new=AsyncMock(return_value={"sub": "u"})))
        stack.enter_context(patch("chatqna.genieai_chatqna.detect", return_value="en"))
        stack.enter_context(
            patch.object(
                chatqna_module.ChatQnAService,
                "fetch_file_metadata",
                new=AsyncMock(return_value={}),
            )
        )
        # Genieai*Parms subclass the comps MagicMock — a second
        # instantiation raises StopIteration (see _fake_parms docstring,
        # test_chatqna.py:3726). Mandatory for >1 wiring test.
        stack.enter_context(patch.object(chatqna_module, "GenieaiRetrieverParms", _fake_parms))
        stack.enter_context(patch.object(chatqna_module, "GenieaiRerankerParms", _fake_parms))
        # Under the comps mock the request model is a MagicMock, so its
        # ``language`` attribute would be a MagicMock too — not a language
        # code, so the language boundary refuses it. Pin a real code so the
        # request takes the same path as a real client.
        chat_request = MagicMock()
        chat_request.context.language = "ES"
        chat_request.language = "ES"
        stack.enter_context(
            patch.object(
                chatqna_module.ChatCompletionRequest,
                "model_validate",
                return_value=chat_request,
            )
        )
        return stack

    @pytest.mark.asyncio
    async def test_condense_multi_turn_rewrites_text_and_passes_raw(self):
        svc = self._svc_with_schedule()
        with (
            self._patches(),
            patch.object(chatqna_module, "MULTI_TURN_MODE", "condense"),
            patch.object(chatqna_module, "MULTI_TURN_BLEND_ENABLED", False),
            patch.object(
                ChatQnAService,
                "_condense_query",
                new=AsyncMock(return_value="maize planting density CENTA"),
            ),
        ):
            await svc.handle_request(self._req())
        call = svc.megaservice.schedule.await_args
        assert call.kwargs["initial_inputs"]["text"] == "maize planting density CENTA"
        assert call.kwargs["initial_inputs"]["_blend_history_text"] == ""
        assert call.kwargs["genie_params"]["condense_raw_query"] == "maize instead"

    @pytest.mark.asyncio
    async def test_condense_single_turn_skips_llm_call(self):
        svc = self._svc_with_schedule(history_blob="USER: first question")
        condense = AsyncMock(return_value="should not be called")
        with (
            self._patches(),
            patch.object(chatqna_module, "MULTI_TURN_MODE", "condense"),
            patch.object(ChatQnAService, "_condense_query", new=condense),
        ):
            await svc.handle_request(self._req())
        condense.assert_not_awaited()
        call = svc.megaservice.schedule.await_args
        assert call.kwargs["initial_inputs"]["text"] == "first question"
        assert "condense_raw_query" not in call.kwargs["genie_params"]

    @pytest.mark.asyncio
    async def test_condense_failure_fails_turn_503_no_retrieval(self):
        svc = self._svc_with_schedule()
        with (
            self._patches(),
            patch.object(chatqna_module, "MULTI_TURN_MODE", "condense"),
            patch.object(
                ChatQnAService,
                "_condense_query",
                new=AsyncMock(side_effect=HTTPException(status_code=503, detail={"error": "condense_failed"})),
            ),
            pytest.raises(HTTPException) as ei,
        ):
            await svc.handle_request(self._req())
        assert ei.value.status_code == 503
        svc.megaservice.schedule.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_blend_mode_unchanged_bit_for_bit(self):
        svc = self._svc_with_schedule()
        with (
            self._patches(),
            patch.object(chatqna_module, "MULTI_TURN_MODE", "blend"),
            patch.object(chatqna_module, "MULTI_TURN_BLEND_ENABLED", True),
            patch.object(chatqna_module, "MULTI_TURN_HISTORY_TURNS", 2),
            patch.object(ChatQnAService, "_condense_query", new=AsyncMock()) as condense,
        ):
            await svc.handle_request(self._req())
        condense.assert_not_awaited()
        call = svc.megaservice.schedule.await_args
        assert call.kwargs["initial_inputs"]["text"] == "maize instead"
        assert "condense_raw_query" not in call.kwargs["genie_params"]
        # blend staging intact: history text extracted with MULTI_TURN_HISTORY_TURNS
        assert call.kwargs["initial_inputs"]["_blend_history_text"] != ""

    @pytest.mark.asyncio
    async def test_condense_overrides_blend_flag_with_warning(self):
        svc = self._svc_with_schedule()
        with (
            self._patches(),
            patch.object(chatqna_module, "MULTI_TURN_MODE", "condense"),
            patch.object(chatqna_module, "MULTI_TURN_BLEND_ENABLED", True),
            # logger is a comps CustomLogger (MagicMock under conftest) —
            # no real records reach caplog; assert on the call instead.
            patch.object(chatqna_module, "logger") as mock_logger,
            patch.object(ChatQnAService, "_condense_query", new=AsyncMock(return_value="q")),
        ):
            await svc.handle_request(self._req())
        call = svc.megaservice.schedule.await_args
        assert call.kwargs["initial_inputs"]["_blend_history_text"] == ""
        mock_logger.warning.assert_called_once()
        assert "MULTI_TURN_MODE=condense overrides" in mock_logger.warning.call_args.args[0]

    @pytest.mark.asyncio
    async def test_condense_skip_emits_skipped_span(self):
        svc = self._svc_with_schedule(history_blob="USER: first question")
        mock_tracer = MagicMock()
        with (
            self._patches(),
            patch.object(chatqna_module, "MULTI_TURN_MODE", "condense"),
            patch.object(chatqna_module, "get_tracer", return_value=mock_tracer),
        ):
            await svc.handle_request(self._req())
        # assert_any_call (not assert_called_with) because the condense tracer
        # mock also receives the later "chatqna.orchestrate" span once the
        # RAG block opens — the brief's ``assert_called_with`` would miss the
        # condense span emission behind the orchestrate one.
        mock_tracer.start_as_current_span.assert_any_call("chatqna.query_condense")

    @pytest.mark.asyncio
    async def test_condense_history_turns_zero_skips_rewrite(self):
        """MULTI_TURN_CONDENSE_HISTORY_TURNS=0 disables the rewrite path,
        mirroring the documented blend-path behavior of MULTI_TURN_HISTORY_TURNS=0
        (the blend ``elif`` branch in handle_request, ``MULTI_TURN_BLEND_ENABLED
        and MULTI_TURN_HISTORY_TURNS > 0``). ``_extract_history_text`` returns
        "" for n<=0, so the condense branch takes its no-history skip:
        ``_condense_query`` is NOT awaited, the raw last message becomes the
        retrieval query, and no ``condense_raw_query`` key is forwarded to
        the megaservice. Pins the "0 disables" behavior."""
        svc = self._svc_with_schedule()  # multi-segment history blob
        condense = AsyncMock(return_value="should not be called")
        with (
            self._patches(),
            patch.object(chatqna_module, "MULTI_TURN_MODE", "condense"),
            patch.object(chatqna_module, "MULTI_TURN_CONDENSE_HISTORY_TURNS", 0),
            patch.object(ChatQnAService, "_condense_query", new=condense),
        ):
            await svc.handle_request(self._req())
        condense.assert_not_awaited()
        call = svc.megaservice.schedule.await_args
        assert call.kwargs["initial_inputs"]["text"] == "maize instead"
        assert "condense_raw_query" not in call.kwargs["genie_params"]


# ---------------------------------------------------------------------------
# Task 4: RAG-prompt raw-query override at both align_outputs sites (issue #1091)
# ---------------------------------------------------------------------------
class TestRagPromptRawQueryOverride:
    """align_outputs must use the RAW last message as the RAG prompt question
    when ``condense_raw_query`` is present in ``genie_params`` — the condense
    output (LLM-generated text) is retrieval + rerank input only and must
    never enter the answer-LLM prompt. Absent key ⇒ today's ``initial_query``
    behavior at both sites (I5b guard).

    Harness style copied verbatim from ``tests/test_chatqna.py`` ``TestAlignOutputs``
    (rerank ~1388-1401, retriever ~1153-1248) — only the asserted prompt source
    differs across the two sites.
    """

    @staticmethod
    def _genie_params_kwargs(with_raw):
        # No GenieaiRerankerParms instantiation — under the comps mock a
        # second instantiation raises StopIteration, and the dict-path
        # ({reranked_docs: [...]}) these tests drive never reads it.
        gp = {"full_chat_history_string": ""}
        if with_raw is not None:
            gp["condense_raw_query"] = with_raw
        return {"genie_params": gp}

    @staticmethod
    def _build_rerank_fake():
        """Reuse the exact fake construction from test_chatqna.py:1388-1401."""
        from tests.test_chatqna import FakeServiceType, create_mock_service_node

        self_mock = MagicMock()
        self_mock.services = {"rerank_node": create_mock_service_node(FakeServiceType.RERANK)}
        data = {
            "reranked_docs": [
                {"text": "doc1", "score": 0.95},
                {"text": "doc2", "score": 0.80},
            ]
        }
        # In condense mode, inputs["initial_query"] carries the REWRITTEN
        # query (retriever's echo); the RAW last message lives in
        # genie_params["condense_raw_query"] (Task 3). The override must
        # prefer the raw string so the answer-LLM prompt is grounded.
        inputs = {
            "initial_query": "rewritten query",
            "retrieved_docs": [
                {"id": "d1", "text": "doc1"},
                {"id": "d2", "text": "doc2"},
            ],
        }
        return self_mock, data, inputs

    def test_rerank_prompt_uses_raw_when_key_present(self):
        from tests.test_chatqna import FakeServiceType, align_outputs

        self_mock, data, inputs = self._build_rerank_fake()
        with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
            result = align_outputs(
                self_mock,
                data,
                "rerank_node",
                inputs,
                MagicMock(),
                {},
                **self._genie_params_kwargs("RAW MESSAGE"),
            )
        assert "inputs" in result
        # RAW message must be the prompt prefix; the rewritten query must NOT
        # leak into the answer-LLM prompt.
        assert result["inputs"].startswith("RAW MESSAGE"), (
            f"expected prompt to start with condense_raw_query, got: {result['inputs'][:80]!r}"
        )
        assert "rewritten query" not in result["inputs"]

    def test_rerank_prompt_unchanged_when_key_absent(self):
        from tests.test_chatqna import FakeServiceType, align_outputs

        self_mock, data, inputs = self._build_rerank_fake()
        with patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType):
            result = align_outputs(
                self_mock,
                data,
                "rerank_node",
                inputs,
                MagicMock(),
                {},
                **self._genie_params_kwargs(None),
            )
        assert "inputs" in result
        # I5b guard: absent key ⇒ bit-for-bit current behavior
        # (prompt starts with inputs["initial_query"]).
        assert result["inputs"].startswith("rewritten query"), (
            f"expected prompt to start with initial_query, got: {result['inputs'][:80]!r}"
        )

    @staticmethod
    def _build_no_rerank_retriever_fake():
        """Reuse the exact fake construction from test_chatqna.py:1153-1176."""
        from tests.test_chatqna import (
            FakeServiceType,
            create_mock_runtime_graph,
            create_mock_service_node,
        )

        self_mock = MagicMock()
        self_mock.services = {"retriever_node": create_mock_service_node(FakeServiceType.RETRIEVER)}
        # downstream returns a node NOT starting with "rerank" → with_rerank=False
        # → the no-rerank prompt-build branch (received_prompt path, line ~1548).
        graph = create_mock_runtime_graph(downstream_nodes=["llm_node"])
        data = {
            "initial_query": "rewritten query",
            "retrieved_docs": [{"id": "d1", "text": "doc1"}],
            "metadata": [{"file_ids": ["f1"]}],
        }
        inputs = {"text": "rewritten query"}
        return self_mock, data, inputs, graph

    def test_no_rerank_prompt_uses_raw_when_key_present(self):
        from tests.test_chatqna import FakeServiceType, align_outputs

        self_mock, data, inputs, graph = self._build_no_rerank_retriever_fake()
        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch("chatqna.genieai_chatqna.RETRIEVER_SEARCH_START", "chunk"),
        ):
            result = align_outputs(
                self_mock,
                data,
                "retriever_node",
                inputs,
                graph,
                {},
                **self._genie_params_kwargs("RAW MESSAGE"),
            )
        assert "inputs" in result
        assert result["inputs"].startswith("RAW MESSAGE"), (
            f"expected prompt to start with condense_raw_query, got: {result['inputs'][:80]!r}"
        )
        assert "rewritten query" not in result["inputs"]

    def test_no_rerank_prompt_unchanged_when_key_absent(self):
        from tests.test_chatqna import FakeServiceType, align_outputs

        self_mock, data, inputs, graph = self._build_no_rerank_retriever_fake()
        with (
            patch("chatqna.genieai_chatqna.ServiceType", FakeServiceType),
            patch("chatqna.genieai_chatqna.RETRIEVER_SEARCH_START", "chunk"),
        ):
            result = align_outputs(
                self_mock,
                data,
                "retriever_node",
                inputs,
                graph,
                {},
                **self._genie_params_kwargs(None),
            )
        assert "inputs" in result
        # I5b guard: absent key ⇒ bit-for-bit current behavior
        # (received_prompt = data["initial_query"] in the no-rerank branch).
        assert result["inputs"].startswith("rewritten query"), (
            f"expected prompt to start with initial_query, got: {result['inputs'][:80]!r}"
        )
