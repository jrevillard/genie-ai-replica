"""Tests for v2 post-processing helpers."""
from __future__ import annotations

from translation_v2.post_process import (
    clean_answer,
    normalize_mandinka,
    strip_model_artifacts,
)


class TestNormalizeMandinka:
    def test_collapses_spaces(self):
        assert normalize_mandinka("hello   world") == "hello world"

    def test_preserves_newlines(self):
        assert "\n" in normalize_mandinka("line one\nline two")

    def test_normalizes_curly_quotes(self):
        assert normalize_mandinka("\u201chello\u201d") == '"hello"'

    def test_preserves_diacritics(self):
        out = normalize_mandinka("Ŋ be kuuraŋo la")
        assert "ŋ" in out.lower()
        assert "Ŋ" in out or "ŋ" in out

    def test_empty_passthrough(self):
        assert normalize_mandinka("") == ""
        assert normalize_mandinka("   ") == ""


class TestStripModelArtifacts:
    def test_strips_leading_translation_label(self):
        assert strip_model_artifacts("Translation: Ŋ be fo") == "Ŋ be fo"

    def test_strips_leading_answer_label(self):
        assert strip_model_artifacts("Answer: Ŋ be fo") == "Ŋ be fo"

    def test_strips_leading_label_case_insensitive(self):
        assert strip_model_artifacts("OUTPUT: Ŋ be fo") == "Ŋ be fo"

    def test_strips_markdown_fences(self):
        assert strip_model_artifacts("```\nŊ be fo\n```") == "Ŋ be fo"

    def test_strips_language_fences(self):
        assert strip_model_artifacts("```mnk\nŊ be fo\n```") == "Ŋ be fo"

    def test_strips_wrapping_quotes(self):
        assert strip_model_artifacts('"Ŋ be fo"') == "Ŋ be fo"

    def test_strips_single_quotes(self):
        assert strip_model_artifacts("'Ŋ be fo'") == "Ŋ be fo"

    def test_does_not_strip_inner_quotes(self):
        assert strip_model_artifacts('He said "hi" today') == 'He said "hi" today'

    def test_empty_passthrough(self):
        assert strip_model_artifacts("") == ""


class TestCleanAnswer:
    def test_chains_both(self):
        raw = 'Translation:   "Ŋ be kuuraŋo   la"  '
        assert clean_answer(raw) == "Ŋ be kuuraŋo la"

    def test_markdown_then_normalize(self):
        raw = "```\nTranslation: Ŋ  be  fo\n```"
        assert clean_answer(raw) == "Ŋ be fo"
