"""Tests for the v2 prompt builder."""
from __future__ import annotations

from translation_v2.prompts import (
    LANG_NAMES,
    build_batch_user_prompt,
    build_system_prompt,
)


class TestSystemPrompt:
    def test_en_to_mnk_names_substituted(self):
        p = build_system_prompt("en", "ma")
        assert "English" in p
        assert "Mandinka" in p

    def test_unknown_code_echoed_verbatim(self):
        p = build_system_prompt("zz", "yy")
        assert "zz" in p
        assert "yy" in p

    def test_empty_glossary_no_glossary_block(self):
        p = build_system_prompt("en", "ma", "")
        assert "Glossary" not in p or p.count("Glossary") == 0

    def test_whitespace_only_glossary_snippet_ignored(self):
        p = build_system_prompt("en", "ma", "   \n  ")
        assert "Glossary" not in p

    def test_glossary_snippet_included(self):
        snippet = "- headache -> kung dimi"
        p = build_system_prompt("en", "ma", snippet)
        assert "headache -> kung dimi" in p

    def test_preserves_do_not_translate_instruction(self):
        p = build_system_prompt("en", "ma")
        # These are load-bearing instructions — lock them in
        assert "metformin" in p
        assert "Banjul" in p
        assert "benachin" in p

    def test_mnk_and_ma_map_to_same_name(self):
        assert LANG_NAMES["ma"] == LANG_NAMES["mnk"] == "Mandinka"


class TestBatchUserPrompt:
    def test_numbers_each_input(self):
        p = build_batch_user_prompt(["a", "b", "c"])
        assert "[1] a" in p
        assert "[2] b" in p
        assert "[3] c" in p

    def test_instructs_to_return_numbered(self):
        p = build_batch_user_prompt(["x"])
        assert "numbered" in p.lower()

    def test_single_input_still_numbered(self):
        p = build_batch_user_prompt(["only"])
        assert "[1] only" in p
