"""Tests for the PII detector.

Detection-only — no redaction. These tests lock in what *counts* as PII
today; tightening the regex (e.g. to reduce false positives) must be a
deliberate decision, not a silent drift.
"""
from __future__ import annotations

from translation_v2.pii import PIIDetector


class TestEmpty:
    def test_empty_string_no_pii(self):
        r = PIIDetector().scan("")
        assert r.has_pii is False
        assert r.summary() == {"phones": 0, "emails": 0, "national_ids": 0}

    def test_pure_text_no_pii(self):
        r = PIIDetector().scan("patient has a headache")
        assert r.has_pii is False


class TestPhone:
    def test_gambian_international_with_plus(self):
        r = PIIDetector().scan("call me at +220 777 1234 please")
        assert len(r.phones) == 1
        assert r.has_pii

    def test_gambian_without_plus(self):
        r = PIIDetector().scan("my number is 220-777-1234")
        assert len(r.phones) == 1

    def test_local_seven_digit(self):
        r = PIIDetector().scan("call 777 1234")
        assert len(r.phones) == 1


class TestEmail:
    def test_standard_email(self):
        r = PIIDetector().scan("write to patient.fatou@example.gm about results")
        assert r.emails == ["patient.fatou@example.gm"]
        assert r.has_pii

    def test_case_insensitive(self):
        r = PIIDetector().scan("Mail: Fatou@Example.GM")
        assert len(r.emails) == 1


class TestNationalID:
    def test_uppercase_prefix_plus_digits(self):
        r = PIIDetector().scan("ID KMC12345 on record")
        assert r.national_ids == ["KMC12345"]
        assert r.has_pii

    def test_short_prefix_valid(self):
        r = PIIDetector().scan("ref GM98765")
        assert r.national_ids == ["GM98765"]

    def test_lowercase_not_a_match(self):
        r = PIIDetector().scan("kmc12345 is not an ID")
        assert r.national_ids == []


class TestSummary:
    def test_summary_contains_counts_only(self):
        r = PIIDetector().scan(
            "call +220 777 1234 or email fatou@example.gm — ID KMC12345"
        )
        s = r.summary()
        assert s == {"phones": 1, "emails": 1, "national_ids": 1}
        # Values themselves are never in the summary (safe to log)
        assert "fatou@example.gm" not in str(s)
