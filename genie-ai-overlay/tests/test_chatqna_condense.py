# Copyright (c) 2024-2026 International Telecommunication Union (ITU);
#
# This software is part of GENIE.AI, an open-source generative AI framework
# for the public sector, distributed under the GNU Affero General Public
# License v3.0. See the `LICENSE` file for the full text.

"""Condense-question rewrite (issue #1091): prompt assembly, response
parsing, skip conditions, fail-closed semantics, and the raw-query RAG
prompt override."""

import json as json_module
from unittest.mock import MagicMock, patch

import httpx
import pytest
from fastapi import HTTPException

import chatqna.genieai_chatqna as chatqna_module
from chatqna.genieai_chatqna import (
    _CONDENSE_SYSTEM_PROMPT,
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
