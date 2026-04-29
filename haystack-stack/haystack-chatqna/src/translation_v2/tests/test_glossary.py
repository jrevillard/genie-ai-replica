"""Tests for the Glossary service."""
from __future__ import annotations

from pathlib import Path

import pytest

from translation_v2.glossary import Glossary, GlossaryEntry


SEED_CSV = (
    Path(__file__).resolve().parents[1] / "data" / "glossary_seed.csv"
)


class TestLoading:
    def test_seed_csv_loads(self):
        g = Glossary()
        n = g.load(SEED_CSV)
        assert n > 0
        assert len(g) == n

    def test_missing_file_returns_zero(self, tmp_path):
        g = Glossary()
        assert g.load(tmp_path / "does-not-exist.csv") == 0
        assert len(g) == 0

    def test_load_parses_do_not_translate(self):
        g = Glossary()
        g.load(SEED_CSV)
        # metformin is flagged do_not_translate=true in the seed
        dnt = {e.en.lower() for e in g.entries() if e.do_not_translate}
        assert "metformin" in dnt
        assert "amlodipine" in dnt
        assert "banjul" in dnt


class TestApplySubstitutions:
    def test_case_insensitive_replacement(self):
        g = Glossary()
        g.add(GlossaryEntry(en="headache", mnk="kung dimi", domain="clinical", do_not_translate=False))
        assert g.apply_en_to_mnk("I have a Headache") == "I have a kung dimi"

    def test_word_boundary_respected(self):
        g = Glossary()
        g.add(GlossaryEntry(en="pain", mnk="dimi", domain="clinical", do_not_translate=False))
        # "painful" should NOT be rewritten to "dimiful"
        assert g.apply_en_to_mnk("painful") == "painful"
        # Whole-word "pain" should be
        assert g.apply_en_to_mnk("my pain is bad") == "my dimi is bad"

    def test_do_not_translate_is_skipped(self):
        g = Glossary()
        g.add(GlossaryEntry(en="metformin", mnk="", domain="medication", do_not_translate=True))
        g.add(GlossaryEntry(en="headache", mnk="kung dimi", domain="clinical", do_not_translate=False))
        out = g.apply_en_to_mnk("take metformin for your headache")
        assert "metformin" in out
        assert "kung dimi" in out

    def test_empty_mnk_is_skipped(self):
        g = Glossary()
        g.add(GlossaryEntry(en="foo", mnk="", domain="general", do_not_translate=False))
        assert g.apply_en_to_mnk("foo bar") == "foo bar"


class TestPromptSnippet:
    def test_empty_glossary_empty_snippet(self):
        assert Glossary().prompt_snippet() == ""

    def test_snippet_contains_mapping(self):
        g = Glossary()
        g.add(GlossaryEntry(en="headache", mnk="kung dimi", domain="clinical", do_not_translate=False))
        snippet = g.prompt_snippet()
        assert "headache" in snippet
        assert "kung dimi" in snippet

    def test_snippet_marks_do_not_translate(self):
        g = Glossary()
        g.add(GlossaryEntry(en="metformin", mnk="", domain="medication", do_not_translate=True))
        snippet = g.prompt_snippet()
        assert "metformin" in snippet
        assert "keep unchanged" in snippet


class TestTermsToPreserve:
    def test_returns_only_do_not_translate_terms(self):
        g = Glossary()
        g.add(GlossaryEntry(en="foo", mnk="bar", domain="x", do_not_translate=False))
        g.add(GlossaryEntry(en="Banjul", mnk="", domain="place", do_not_translate=True))
        assert g.terms_to_preserve() == ["Banjul"]
