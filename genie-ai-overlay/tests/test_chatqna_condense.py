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


class TestCondenseQueryCall:
    """_condense_query: endpoint/model resolution, payload shape, span attrs."""

    @pytest.mark.asyncio
    async def test_ok_returns_query_and_sends_frozen_payload(self):
        from tests.test_chatqna import create_chatqna_service

        svc = create_chatqna_service()
        captured = {}

        class _FakeClient:
            def __init__(self, *a, **kw):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, json=None, headers=None):
                captured.update(url=url, json=json, headers=headers)
                return _make_httpx_response(json_data=_condense_response_payload())

        with (
            patch.object(chatqna_module, "_get_llm_model", return_value="granite-4.1-8b"),
            patch.object(chatqna_module, "OPENAI_API_KEY", "test-key"),
            patch.object(chatqna_module.httpx, "AsyncClient", _FakeClient),
        ):
            query = await svc._condense_query("USER: bean?\nASSISTANT: EAC ...", "maize instead")

        assert query == "maize planting density CENTA"
        assert captured["url"].endswith("/v1/chat/completions")
        assert captured["json"]["model"] == "granite-4.1-8b"
        assert captured["json"]["temperature"] == 0.0
        assert captured["json"]["max_tokens"] == 48
        assert captured["json"]["response_format"] == {"type": "json_object"}
        assert captured["json"]["stream"] is False
        assert captured["json"]["messages"][0]["role"] == "system"
        assert captured["json"]["messages"][0]["content"] == _CONDENSE_SYSTEM_PROMPT
        assert captured["json"]["messages"][1]["content"].endswith("Standalone query:")
        assert captured["headers"]["Authorization"] == "Bearer test-key"

    @pytest.mark.asyncio
    @pytest.mark.parametrize(
        "exc,reason",
        [
            (httpx.ReadTimeout("t"), "timeout"),
            (httpx.ConnectError("c"), "http_error"),
        ],
    )
    async def test_transport_failures_map_to_503(self, exc, reason):
        from tests.test_chatqna import create_chatqna_service

        svc = create_chatqna_service()

        class _FakeClient:
            def __init__(self, *a, **kw):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, json=None, headers=None):
                raise exc

        with patch.object(chatqna_module.httpx, "AsyncClient", _FakeClient), pytest.raises(HTTPException) as ei:
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
        from tests.test_chatqna import create_chatqna_service

        svc = create_chatqna_service()
        resp = _make_httpx_response(
            text="not json" if json_data is None else None,
            json_data=None if json_data is None else json_data,
        )
        if json_data is None:
            resp.json.side_effect = json_module.JSONDecodeError("x", "d", 0)

        class _FakeClient:
            def __init__(self, *a, **kw):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, json=None, headers=None):
                return resp

        with patch.object(chatqna_module.httpx, "AsyncClient", _FakeClient), pytest.raises(HTTPException) as ei:
            await svc._condense_query("h", "m")
        assert ei.value.status_code == 503
        assert ei.value.detail["reason"] == reason

    @pytest.mark.asyncio
    async def test_http_5xx_maps_to_503(self):
        from tests.test_chatqna import create_chatqna_service

        svc = create_chatqna_service()
        resp = _make_httpx_response(status_code=500, json_data={"error": "internal"})

        class _FakeClient:
            def __init__(self, *a, **kw):
                pass

            async def __aenter__(self):
                return self

            async def __aexit__(self, *a):
                return False

            async def post(self, url, json=None, headers=None):
                return resp

        with patch.object(chatqna_module.httpx, "AsyncClient", _FakeClient), pytest.raises(HTTPException) as ei:
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
        from tests.test_chatqna import create_chatqna_service

        svc = create_chatqna_service()
        svc.megaservice.schedule = AsyncMock(return_value=({"llm": {"text": "ok"}}, {}))
        svc._get_translated_history_string = AsyncMock(return_value=history_blob)
        svc._finalize_llm_response = AsyncMock(return_value=("ok", None))
        svc._assemble_source_documents = AsyncMock(return_value=([], 0.5, True))
        return svc

    @staticmethod
    def _req():
        from tests.test_chatqna import create_mock_request

        return create_mock_request(
            data={"messages": [{"role": "user", "content": "x"}], "model": "m"},
            headers={"Authorization": "Bearer tok"},
        )

    @staticmethod
    def _patches():
        from contextlib import ExitStack

        from tests.test_chatqna import _fake_parms

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
