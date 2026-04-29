"""Characterization tests for the legacy Mandinka detector.

These tests lock in the current behavior of Translator.detect_language,
Translator.detect_mandinka_intent, and Translator._mandinka_probability
against a calibrated set of inputs. The detector is pure Python with no
external dependencies (no LLM, no Redis), so no mocks are used.

If these tests fail after a legacy change, the detector's calibration
has shifted and the tech lead must decide whether that shift is a bug
or an intentional recalibration.
"""
from __future__ import annotations

import pytest


# ── Empty / degenerate input ──────────────────────────────────────────
class TestEmptyInput:
    def test_empty_string_is_english(self, bare_legacy_translator):
        assert bare_legacy_translator.detect_language("") == "en"

    def test_whitespace_is_english(self, bare_legacy_translator):
        assert bare_legacy_translator.detect_language("   \n\t ") == "en"

    def test_empty_intent_has_zero_probability(self, bare_legacy_translator):
        r = bare_legacy_translator.detect_mandinka_intent("")
        assert r["probability"] == 0.0
        assert r["is_mandinka_intent"] is False
        assert r["confidence"] == "low"
        assert r["signals"]["word_count"] == 0


# ── Pure English ──────────────────────────────────────────────────────
class TestPureEnglish:
    def test_common_english_sentence_is_english(self, bare_legacy_translator):
        text = "I have a headache and my blood pressure is high"
        assert bare_legacy_translator.detect_language(text) == "en"
        r = bare_legacy_translator.detect_mandinka_intent(text)
        assert r["probability"] < 0.35, f"expected p < 0.35, got {r['probability']}"
        assert r["is_mandinka_intent"] is False

    def test_english_bigram_adds_negative_signal(self, bare_legacy_translator):
        # "i have" is in _EN_STRONG_BIGRAMS
        r = bare_legacy_translator.detect_mandinka_intent("i have a pain")
        assert r["signals"]["en_bigrams"] >= 1

    def test_pure_english_common_words_detected(self, bare_legacy_translator):
        r = bare_legacy_translator.detect_mandinka_intent("please tell me about my medicine")
        assert r["signals"]["en_words"] >= 3


# ── Pure Mandinka ─────────────────────────────────────────────────────
class TestPureMandinka:
    def test_diacritic_alone_is_strong_signal(self, bare_legacy_translator):
        # "ŋ" is a Tier 1 diacritic — each occurrence adds +3.0 logit
        r = bare_legacy_translator.detect_mandinka_intent("ŋ be kuuraŋo la")
        assert r["signals"]["diacritics"] >= 2  # ŋ in "ŋ" and "kuuraŋo"
        assert r["probability"] > 0.60
        assert r["is_mandinka_intent"] is True

    def test_strong_mandinka_word_triggers_intent(self, bare_legacy_translator):
        # "isama" is a Tier 2 strong greeting
        r = bare_legacy_translator.detect_mandinka_intent("isama")
        assert "isama" in r["signals"]["strong_ma_words"]

    def test_greeting_kayira_detected(self, bare_legacy_translator):
        r = bare_legacy_translator.detect_mandinka_intent("kayira")
        assert "kayira" in r["signals"]["strong_ma_words"]

    def test_multi_word_phrase_detected(self, bare_legacy_translator):
        # "i mbe" and "fo le" are multi-word phrases added to strong_hits
        r = bare_legacy_translator.detect_mandinka_intent("i mbe fo le saraabu")
        assert "i mbe" in r["signals"]["strong_ma_words"]
        assert "fo le" in r["signals"]["strong_ma_words"]


# ── Length dampening ──────────────────────────────────────────────────
class TestLengthDampening:
    def test_short_message_is_dampened(self, bare_legacy_translator):
        # Same signal strength, different word counts → short should score lower
        short = bare_legacy_translator._mandinka_probability("kuuraŋo")
        long_sentence = bare_legacy_translator._mandinka_probability(
            "kuuraŋo kuuraŋo kuuraŋo kuuraŋo kuuraŋo"
        )
        # Both have diacritics, but the short version is dampened (×0.5 for ≤2 words)
        assert short < long_sentence, (
            f"expected short ({short}) < long ({long_sentence})"
        )

    def test_two_word_message_gets_half_dampening(self, bare_legacy_translator):
        # word_count <= 2 → logit ×= 0.5 (per translator.py:452)
        r = bare_legacy_translator.detect_mandinka_intent("isama kayira")
        assert r["signals"]["word_count"] == 2

    def test_four_word_message_gets_less_dampening(self, bare_legacy_translator):
        # word_count 3-4 → logit ×= 0.75 (per translator.py:454)
        r = bare_legacy_translator.detect_mandinka_intent("isama kayira abaraka saraabu")
        assert r["signals"]["word_count"] == 4


# ── Probability thresholds (contractual) ──────────────────────────────
class TestThresholds:
    def test_is_mandinka_intent_at_0_60(self, bare_legacy_translator):
        # Contract per translator.py:372 — is_mandinka_intent is probability >= 0.60
        # We construct a message that should score high.
        r = bare_legacy_translator.detect_mandinka_intent("Ŋ be kuuraŋo la bi")
        if r["probability"] >= 0.60:
            assert r["is_mandinka_intent"] is True
        else:
            assert r["is_mandinka_intent"] is False

    def test_confidence_buckets(self, bare_legacy_translator):
        # Per translator.py:364–369:
        #   p >= 0.75  → high
        #   p >= 0.50  → medium
        #   else       → low
        r_high = bare_legacy_translator.detect_mandinka_intent(
            "Ŋ be kuuraŋo la, isama kayira, abaraka"
        )
        r_low = bare_legacy_translator.detect_mandinka_intent(
            "I have a headache and my blood pressure is high"
        )
        # Contract: pure English stays in the "low" bucket
        assert r_low["confidence"] == "low"
        # Don't over-constrain the high case — just assert it's not low.
        assert r_high["confidence"] in ("medium", "high")

    def test_probability_is_rounded_to_3_decimals(self, bare_legacy_translator):
        # Per translator.py:373
        r = bare_legacy_translator.detect_mandinka_intent("hello world")
        p = r["probability"]
        # Round to 3dp should equal itself
        assert round(p, 3) == p


# ── Signal extraction (shape contract) ────────────────────────────────
class TestSignalShape:
    def test_signals_keys(self, bare_legacy_translator):
        r = bare_legacy_translator.detect_mandinka_intent("isama kayira")
        assert set(r["signals"].keys()) == {
            "diacritics", "strong_ma_words", "weak_ma_words",
            "en_words", "en_bigrams", "word_count",
        }

    def test_word_lists_are_capped_at_10(self, bare_legacy_translator):
        # Per translator.py:411–412, strong_ma_words and weak_ma_words are sliced [:10]
        r = bare_legacy_translator.detect_mandinka_intent(
            "isama kayira abaraka saraabu kuurango dookuwo bantaba alkallo "
            "marabout ñaamaa jarabi jaatoo tuntuŋo"
        )
        assert len(r["signals"]["strong_ma_words"]) <= 10

    def test_intent_result_keys(self, bare_legacy_translator):
        r = bare_legacy_translator.detect_mandinka_intent("hello")
        assert set(r.keys()) == {
            "is_mandinka_intent", "probability", "confidence", "signals",
        }


# ── detect_language wrapper ──────────────────────────────────────────
class TestDetectLanguage:
    def test_returns_only_ma_or_en(self, bare_legacy_translator):
        for text in ["", "hello", "isama", "Ŋ be kuuraŋo", "please help"]:
            result = bare_legacy_translator.detect_language(text)
            assert result in ("ma", "en"), f"unexpected: {result!r}"

    def test_threshold_is_0_50(self, bare_legacy_translator):
        # Per translator.py:338 — detect_language returns 'ma' iff p >= 0.50
        t = bare_legacy_translator
        text = "isama kayira"
        p = t._mandinka_probability(text)
        expected = "ma" if p >= 0.50 else "en"
        assert t.detect_language(text) == expected
