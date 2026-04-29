"""Tests for v2 Quality Estimation."""
from __future__ import annotations

import pytest

from translation_v2.qe import (
    ChrFPlusPlusQE,
    CompositeQE,
    HeuristicConfig,
    HeuristicQE,
)


class TestChrFPlusPlus:
    @pytest.mark.asyncio
    async def test_identical_strings_score_one(self):
        qe = ChrFPlusPlusQE()
        r = await qe.score("hello world", "hello world")
        assert r.score == pytest.approx(1.0, abs=1e-6)
        assert r.passed is True
        assert r.metric == "chrf++"

    @pytest.mark.asyncio
    async def test_completely_different_scores_zero(self):
        qe = ChrFPlusPlusQE()
        r = await qe.score("hello world", "xyzzy qrs")
        assert r.score < 0.2
        assert r.passed is False

    @pytest.mark.asyncio
    async def test_partial_overlap_intermediate_score(self):
        qe = ChrFPlusPlusQE(threshold=0.1)
        r = await qe.score("the quick brown fox", "the slow brown dog")
        assert 0.2 < r.score < 0.9
        assert r.passed is True  # beats 0.1 threshold

    @pytest.mark.asyncio
    async def test_empty_input_fails(self):
        qe = ChrFPlusPlusQE()
        r = await qe.score("", "hi")
        assert r.passed is False
        r = await qe.score("hi", "")
        assert r.passed is False

    @pytest.mark.asyncio
    async def test_threshold_respected(self):
        qe = ChrFPlusPlusQE(threshold=0.95)
        r = await qe.score("hello world", "hello there")
        # Below threshold 0.95 → passed=False even if score is decent
        assert r.threshold == 0.95
        assert r.passed == (r.score >= 0.95)


class TestHeuristicQE:
    @pytest.mark.asyncio
    async def test_empty_source_fails(self):
        r = await HeuristicQE().score("", "translation")
        assert r.passed is False
        assert "empty source" in (r.notes or "")

    @pytest.mark.asyncio
    async def test_empty_target_fails(self):
        r = await HeuristicQE().score("source", "")
        assert r.passed is False

    @pytest.mark.asyncio
    async def test_target_equals_source_fails(self):
        text = "The quick brown fox jumps over the lazy dog today"
        r = await HeuristicQE().score(text, text)
        assert r.passed is False
        assert "equals source" in (r.notes or "")

    @pytest.mark.asyncio
    async def test_length_ratio_within_bounds_ok(self):
        # Mandinka vs English ratio ~1.1 — solidly within bounds
        r = await HeuristicQE().score(
            "How are you feeling today",
            "Ŋ be nyaading la bi fang bi?",
        )
        assert r.score > 0.5

    @pytest.mark.asyncio
    async def test_hallucination_penalized(self):
        # 10x longer target → outside max_length_ratio
        r = await HeuristicQE(HeuristicConfig(threshold=0.7)).score(
            "hello",
            "a " * 200,
        )
        assert r.passed is False

    @pytest.mark.asyncio
    async def test_preserved_terms_missing_lowers_score(self):
        cfg = HeuristicConfig(preserved_terms=["metformin"], threshold=0.7)
        r_good = await HeuristicQE(cfg).score(
            "take metformin daily", "domaa metformin luŋ-o-luŋ"
        )
        r_bad = await HeuristicQE(cfg).score(
            "take metformin daily", "domaa a luŋ-o-luŋ"  # dropped "metformin"
        )
        assert r_good.score > r_bad.score
        assert r_good.passed and not r_bad.passed

    @pytest.mark.asyncio
    async def test_numbers_preserved(self):
        cfg = HeuristicConfig(threshold=0.6, check_numbers=True)
        r_good = await HeuristicQE(cfg).score("take 2 pills", "domaa 2 saraabu")
        r_bad = await HeuristicQE(cfg).score("take 2 pills", "domaa saraabu")
        assert r_good.score > r_bad.score


class TestCompositeQE:
    @pytest.mark.asyncio
    async def test_empty_estimators_raises(self):
        with pytest.raises(ValueError):
            CompositeQE([])

    @pytest.mark.asyncio
    async def test_averages_subscorers(self):
        class FixedQE:
            name = "fixed"

            def __init__(self, score):
                self._s = score

            async def score(self, src, tgt, lang_pair=""):
                from translation_v2.interfaces import QEResult
                return QEResult(score=self._s, metric=self.name, passed=True, threshold=0.0)

        c = CompositeQE([FixedQE(0.4), FixedQE(0.8)], threshold=0.5)
        r = await c.score("s", "t")
        assert r.score == pytest.approx(0.6)
        assert r.passed is True  # 0.6 >= 0.5

    @pytest.mark.asyncio
    async def test_one_sub_failure_doesnt_break_composite(self):
        class BadQE:
            name = "bad"

            async def score(self, src, tgt, lang_pair=""):
                raise RuntimeError("boom")

        class OKQE:
            name = "ok"

            async def score(self, src, tgt, lang_pair=""):
                from translation_v2.interfaces import QEResult
                return QEResult(score=0.9, metric=self.name, passed=True, threshold=0.0)

        c = CompositeQE([BadQE(), OKQE()], threshold=0.3)
        r = await c.score("a", "b")
        # bad=0.0, ok=0.9 → avg 0.45, > threshold 0.3
        assert r.passed is True
        assert "bad" in (r.notes or "") and "ok" in (r.notes or "")

    @pytest.mark.asyncio
    async def test_below_threshold_fails(self):
        class FixedQE:
            name = "fixed"

            def __init__(self, s):
                self._s = s

            async def score(self, src, tgt, lang_pair=""):
                from translation_v2.interfaces import QEResult
                return QEResult(score=self._s, metric="fixed", passed=True, threshold=0.0)

        c = CompositeQE([FixedQE(0.1), FixedQE(0.2)], threshold=0.5)
        r = await c.score("a", "b")
        assert r.passed is False
