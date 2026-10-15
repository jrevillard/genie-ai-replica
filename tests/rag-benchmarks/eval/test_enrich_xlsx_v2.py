# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for enrich_xlsx_v2's answer normalisation.

`_extract_response` and `is_abstention` decide how an eval answer is rendered in
the operator workbook and whether the row counts as answered or abstained. They
are pure functions with no dependencies beyond `json`, so they are pinned here
rather than left to be re-derived from a spreadsheet.

`enrich_xlsx_v2` imports openpyxl at module level (it writes workbooks), which
is an operator-time dependency, not a test-time one — skip when absent.
"""

import json

import pytest

pytest.importorskip("openpyxl", reason="enrich_xlsx_v2 imports openpyxl at module level")

from enrich_xlsx_v2 import _extract_response, is_abstention  # noqa: E402


# ---------------------------------------------------------------------------
# _extract_response
# ---------------------------------------------------------------------------


def test_unwraps_a_legacy_envelope():
    """Reports written before the harness learned the `response` key store the
    whole envelope in the answer field."""
    assert _extract_response(json.dumps({"response": "real answer"})) == "real answer"
    assert _extract_response(json.dumps({"answer": "legacy key"})) == "legacy key"


def test_plain_prose_passes_through():
    assert _extract_response("Plain prose answer.") == "Plain prose answer."


def test_a_json_object_that_is_not_an_envelope_is_an_answer():
    """The regression that motivated the presence check.

    Unwrapping ran `.get("response", .get("answer", ""))` on anything that
    parsed as JSON. Now that the harness writes plain answer text, a real
    answer that happens to be valid JSON has neither key and unwrapped to "" —
    a blank cell, and a row that then counted as answered, not abstained.
    """
    body = json.dumps({"resultado": 42})
    assert _extract_response(body) == body


def test_json_scalars_are_coerced_not_passed_through_verbatim():
    """A JSON scalar is an answer, not an envelope. Coercing keeps `"hola"`
    reading as hola and `""` reading as empty; passing the raw JSON through
    would hand is_abstention a two-character string as a real answer."""
    assert _extract_response('"hola"') == "hola"
    assert _extract_response('""') == ""
    assert _extract_response("42") == "42"


def test_unicode_escapes_are_decoded():
    assert _extract_response(json.dumps({"response": "caf\\u00e9"})) == "café"


def test_existing_non_ascii_is_not_mangled_by_the_escape_decoder():
    """`unicode_escape` reinterprets bytes as latin-1, so running it on text
    that already carries real non-ASCII turns every character into mojibake.
    A genuinely double-encoded string is pure ASCII, which is the guard."""
    body = json.dumps({"response": "café con información ñ"}, ensure_ascii=False)
    assert _extract_response(body) == "café con información ñ"


def test_non_string_input_is_coerced_to_text():
    """The annotation is `-> str` and the callers assume it.

    Stored tuples rows are not validated, so a row whose `answer` is a number
    reaches here directly; returning the int would raise AttributeError inside
    is_abstention and abort the whole workbook build.
    """
    assert _extract_response(None) == ""
    assert _extract_response(42) == "42"
    assert _extract_response({"a": 1}) == "{'a': 1}"
    assert is_abstention(_extract_response(42)) == (False, "")


def test_a_null_body_is_not_rendered_as_the_word_none():
    """`str(None)` would turn a null response into a substantive-looking
    two-word answer in the operator workbook."""
    assert _extract_response("null") == "null"
    assert _extract_response("true") == "true"


def test_partially_double_encoded_text_is_still_decoded():
    """Legacy reports carry literal escapes sitting next to real mojibake.

    Gating the decoder on a whole-string ASCII check skips exactly this case, so
    the answer keeps a literal `\\u00f3` and abstention detection stops matching
    — the row then counts as answered instead of abstained.
    """
    body = json.dumps(
        {"response": "Lo siento, no dispongo de informaci\\u00f3n suficiente (caf\\u00c3\\u00a9)."}
    )
    extracted = _extract_response(body)
    assert "\\u00f3" not in extracted
    assert "información" in extracted
    assert is_abstention(extracted)[0] is True


# ---------------------------------------------------------------------------
# is_abstention — the classification the blank answer used to defeat
# ---------------------------------------------------------------------------


def test_a_blanked_json_answer_does_not_count_as_answered():
    """Guards the coupling: an answer that unwraps to "" must not be rendered
    as a normal answered row."""
    unwrapped = _extract_response('""')
    matched, _ = is_abstention(unwrapped)
    assert matched is False
    # The point of the fix: the answer survives, so the row still carries text.
    assert _extract_response('{"resultado": 42}') != ""