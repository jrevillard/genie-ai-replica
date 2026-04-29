"""Tests for RepetitionHeuristicQE — the degenerate-output detector.

The canonical failure mode this catches is the low-resource-language
particle loop: "N be ne n be ne bo n be jere n be n be jere ke n be
n be jere..." — which the user reported from a production screenshot.
"""
from __future__ import annotations

import pytest

from translation_v2.qe import RepetitionConfig, RepetitionHeuristicQE


# Exact text from the bug report screenshot
DEGENERATE_OUTPUT = (
    "Admin Patient, n bee n be jere ke n tege ke n be jere. "
    "N be ne n be ne bo n be tege n be n be jere ke n be n be jere n be n be jere "
    "ke n be n be jere n be n be jere ke n be n be jere n be n be jere. "
    "N be ne n be ne bo n be tege n be n be jere ke n be n be jere n be n be "
    "jere ke n be n be jere n be n be jere."
)


class TestDegenerateDetection:
    @pytest.mark.asyncio
    async def test_screenshot_text_fails(self):
        qe = RepetitionHeuristicQE()
        r = await qe.score(source="I have diabetes", target=DEGENERATE_OUTPUT)
        assert r.passed is False
        assert r.score == 0.0
        assert "max_trigram_repeats" in (r.notes or "") or "diversity" in (r.notes or "")

    @pytest.mark.asyncio
    async def test_single_repeated_trigram_fails(self):
        text = "foo bar baz " * 10  # same 3-gram 10x
        r = await RepetitionHeuristicQE().score(source="src", target=text)
        assert r.passed is False

    @pytest.mark.asyncio
    async def test_very_low_diversity_fails(self):
        text = "a " * 100  # one unique token, 100 total — diversity 0.01
        r = await RepetitionHeuristicQE().score(source="src", target=text)
        assert r.passed is False


class TestCleanPasses:
    @pytest.mark.asyncio
    async def test_natural_mandinka_passes(self):
        # Made-up but realistic-shape output — diverse words, no 5x trigram repeats
        text = (
            "Salaam aleikum. Ite la jaatoo kuurango ñininkaaroo fi alla "
            "ka ta nte la karango niŋ karango diyaamula jaatoo. "
            "Saraabuubaa daa la kafu ñiŋ kuuraŋo le. Ite saŋ luuŋo le yiriwa."
        )
        r = await RepetitionHeuristicQE().score(source="q", target=text)
        assert r.passed is True

    @pytest.mark.asyncio
    async def test_natural_english_passes(self):
        text = (
            "You should monitor your blood sugar regularly, eat balanced "
            "meals, take medications as prescribed, and visit the clinic "
            "at EFSTH if you feel unwell or have persistent symptoms."
        )
        r = await RepetitionHeuristicQE().score(source="q", target=text)
        assert r.passed is True


class TestShortCircuit:
    @pytest.mark.asyncio
    async def test_short_text_auto_passes(self):
        # Below min_tokens_for_check, the QE skips the check
        r = await RepetitionHeuristicQE().score(source="q", target="short")
        assert r.passed is True
        assert "below check threshold" in (r.notes or "")

    @pytest.mark.asyncio
    async def test_empty_target_fails(self):
        r = await RepetitionHeuristicQE().score(source="q", target="")
        assert r.passed is False
        assert "empty" in (r.notes or "")


class TestConfigOverrides:
    @pytest.mark.asyncio
    async def test_tighter_diversity_threshold(self):
        # default 0.15; tighter 0.5 should fail mildly-diverse-but-legitimate text
        cfg = RepetitionConfig(min_diversity_ratio=0.5)
        text = "one two three " * 20  # diversity = 3/60 = 0.05
        r = await RepetitionHeuristicQE(cfg).score(source="q", target=text)
        assert r.passed is False

    @pytest.mark.asyncio
    async def test_looser_trigram_threshold_lets_repetition_pass(self):
        cfg = RepetitionConfig(max_trigram_repeats=1000)
        text = "foo bar baz " * 30
        r = await RepetitionHeuristicQE(cfg).score(source="q", target=text)
        # Diversity still fails (3/90 = 0.033)
        assert r.passed is False

    @pytest.mark.asyncio
    async def test_metric_name(self):
        r = await RepetitionHeuristicQE().score(source="q", target="short")
        assert r.metric == "repetition"
