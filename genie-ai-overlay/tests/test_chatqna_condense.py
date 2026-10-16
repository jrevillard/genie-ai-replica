# Copyright (c) 2024-2026 International Telecommunication Union (ITU);
#
# This software is part of GENIE.AI, an open-source generative AI framework
# for the public sector, distributed under the GNU Affero General Public
# License v3.0. See the `LICENSE` file for the full text.

"""Condense-question rewrite (issue #1091): prompt assembly, response
parsing, skip conditions, fail-closed semantics, and the raw-query RAG
prompt override."""

import pytest

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
