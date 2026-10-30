# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Region-splitting tests — the fix for the uvicorn worker death.

The defect (measured 2026-10-13): a single large scan holds the GIL inside
native spaCy/thinc code long enough that uvicorn's own supervisor
(Multiprocess.keep_subprocess_alive -> Process.ping, 5 s timeout) SIGKILLs
the worker and respawns it. Reproduced 8/8 on an 850 KB page; the client saw
RemoteDisconnected. `--max-requests` cannot fix this (it does not exist in the
pinned uvicorn, and the trigger is one long call, not request count).

The fix splits a long text into regions, analyzes each separately, and
translates offsets back. These tests pin the CONTRACT that makes that safe:

  1. split_regions covers the text exactly — no dropped or duplicated bytes.
  2. Every region is within the cap.
  3. Offsets are translated back to ABSOLUTE positions (this is what makes the
     response identical to a single-pass scan).
  4. redaction spans region joins correctly.

NON-VACUITY: each behavioural test is paired with a comment naming the
production change it fails without. Reverting app.py's `scan` to a single
`engine.analyze(item.text)` call makes test_scan_splits_large_text_and_keeps_offsets
fail (regions=1 assertion); reverting split_regions' offset bookkeeping makes
test_offsets_are_absolute_across_regions fail.
"""

import pytest
from fastapi.testclient import TestClient

import app as app_module
from app import app, split_regions


class _Result:
    """Minimal stand-in for a presidio RecognizerResult (mutable offsets)."""

    def __init__(self, entity_type, start, end, score=0.9):
        self.entity_type = entity_type
        self.start = start
        self.end = end
        self.score = score


class _RecordingAnalyzer:
    """Analyzer that records every analyze() call and returns one hit per
    region, at a KNOWN position, so offset translation is observable."""

    def __init__(self):
        self.calls = []

    def analyze(self, text, language, entities, score_threshold):
        self.calls.append(text)
        # Report a hit covering the first 5 chars of this region.
        return [_Result("PERSON", 0, min(5, len(text)))] if text else []


@pytest.fixture
def recording_client(monkeypatch):
    analyzer = _RecordingAnalyzer()
    monkeypatch.setattr(app_module, "analyzer", analyzer)
    yield TestClient(app), analyzer


# --- split_regions: the pure function ---------------------------------------


def test_short_text_is_one_region():
    assert split_regions("hello world", 50000) == [(0, "hello world")]


def test_regions_respect_the_cap():
    text = "a" * 250000
    regions = split_regions(text, 50000)
    assert len(regions) > 1
    assert all(len(chunk) <= 50000 for _off, chunk in regions)


def test_regions_cover_the_text_exactly():
    """No dropped and no duplicated characters — otherwise PII could fall
    into a gap between regions and scan clean (fail-open on the authoritative
    gate). Without correct offsets/endpoints this test goes red."""
    text = ("word " * 60000).strip()  # 300 KB, whitespace-breakable
    regions = split_regions(text, 50000)
    assert "".join(chunk for _off, chunk in regions) == text


def test_region_offsets_are_the_true_positions():
    text = "alpha beta " * 20000
    regions = split_regions(text, 50000)
    for off, chunk in regions:
        # The offset must index the ORIGINAL text, not a running counter.
        assert text[off : off + len(chunk)] == chunk


def test_text_without_spaces_still_splits_at_the_cap():
    """A single unbroken token must not loop forever or produce no regions."""
    text = "x" * 120000
    regions = split_regions(text, 50000)
    assert len(regions) == 3
    assert "".join(c for _o, c in regions) == text


def test_zero_or_negative_cap_is_a_no_op():
    """A disabled cap must pass the text through whole, not crash."""
    assert split_regions("abc", 0) == [(0, "abc")]
    assert split_regions("abc", -5) == [(0, "abc")]


# --- the endpoint: the behaviour that actually fixes the crash --------------


def test_scan_splits_large_text_and_keeps_offsets(recording_client):
    """A text larger than the cap is analyzed in MORE THAN ONE call.

    This is the assertion that pins the fix: with the original single
    `engine.analyze(item.text)` this call count is 1, and the worker dies.
    """
    client, analyzer = recording_client
    text = ("sentence about a person. " * 8000)[:250000]
    r = client.post("/v1/pii/scan", json={"texts": [{"id": "big", "text": text}]})
    assert r.status_code == 200
    assert len(analyzer.calls) > 1, "large text was NOT split into regions"
    assert max(len(c) for c in analyzer.calls) <= app_module.REGION_MAX_CHARS


def test_small_text_is_still_a_single_call(recording_client):
    """The split must NOT add overhead to the common small-concept case."""
    client, analyzer = recording_client
    client.post("/v1/pii/scan", json={"texts": [{"id": "s", "text": "a short concept body"}]})
    assert len(analyzer.calls) == 1


def test_offsets_are_absolute_across_regions(recording_client, monkeypatch):
    """Every returned hit offset must index the ORIGINAL document.

    Reverting the `r.start += offset` translation makes these offsets
    region-local, so a hit in region 2+ points at the wrong span of the
    document — the client's excerpt re-slice would then show the wrong text.
    """
    client, _analyzer = recording_client
    text = ("filler text here. " * 20000)[:250000]
    r = client.post("/v1/pii/scan", json={"texts": [{"id": "big", "text": text}]})
    hits = r.json()["results"][0]["hits"]
    assert len(hits) > 1, "expected one hit per region"

    regions = split_regions(text)
    starts = [h["start"] for h in hits]

    # THE FALSIFYING ASSERTION. Without the offset translation every region
    # reports its own local (0, 5), so all starts collapse onto a single value
    # and this fails.
    #
    # The PREVIOUS version of this test asserted only
    #     0 <= h["start"] <= h["end"] <= len(text)   and   end - start == 5
    # which a region-local (0, 5) ALSO satisfies — it stayed green with the
    # fix reverted, so the property the split exists to guarantee had no
    # effective coverage at all. (Adversarial review, 2026-10-13.)
    assert len(set(starts)) == len(starts), (
        "region-local offsets: every hit collapsed onto the same start"
    )
    assert starts == sorted(starts), "hits must be returned in document order"

    # Each hit must sit at its region's ABSOLUTE offset — pinned against the
    # real region boundaries, not a range that a wrong offset also satisfies.
    assert starts == [off for off, _ in regions]

    # And the span must index the original text: the fake analyzer reports the
    # first min(5, len) chars of each region, so slicing the ORIGINAL at the
    # returned offsets must reproduce exactly what the analyzer saw.
    for h, (off, chunk) in zip(hits, regions, strict=True):
        width = min(5, len(chunk))
        assert h["end"] - h["start"] == width
        assert h["start"] == off
        # Slice the ORIGINAL at the REGION's own offset rather than at the hit's
        # reported span. The claim being tested is that region N maps to the
        # analyzer's view of that region; slicing at h["start"]/h["end"] routes
        # the check through the very offsets under test, so a wrong translation
        # would slice a self-consistent but wrong window and pass. The
        # `starts == [off ...]` assertion above already proves one hit per
        # region, which is why strict=True is safe here.
        assert text[off : off + width] == chunk[:width]


def test_redaction_spans_regions_joined(recording_client):
    """redacted_text must be the concatenation of EVERY region's redaction —
    one placeholder per hit, so no region is dropped or double-counted.

    Length is NOT preserved: a 5-char hit becomes the 12-char
    "[PII:PERSON]" placeholder, which is the correct redaction behaviour.
    """
    client, _analyzer = recording_client
    text = ("filler text here. " * 20000)[:250000]
    r = client.post("/v1/pii/scan", json={"texts": [{"id": "big", "text": text}]})
    body = r.json()["results"][0]
    # One placeholder per hit, and one hit per region -> nothing lost at a join.
    assert body["redacted_text"].count("[PII:PERSON]") == body["counts_by_type"]["PERSON"]
    assert body["counts_by_type"]["PERSON"] == len(body["hits"]) > 1
    # The placeholder is LONGER than the span it replaces, so the redacted
    # text must be longer than the input — a silent length match would mean
    # the redaction never happened.
    assert len(body["redacted_text"]) > len(text)


def test_batch_items_are_each_split(recording_client):
    """Two oversized items must BOTH be split, independently.

    The per-item id must survive, and each item's redaction must reflect only
    its own regions (no cross-contamination between batch entries).
    """
    client, _analyzer = recording_client
    a = ("alpha content. " * 20000)[:200000]
    b = ("beta content. " * 20000)[:200000]
    r = client.post("/v1/pii/scan", json={"texts": [{"id": "a", "text": a}, {"id": "b", "text": b}]})
    assert r.status_code == 200
    results = {x["id"]: x for x in r.json()["results"]}
    assert set(results) == {"a", "b"}
    for key in ("a", "b"):
        body = results[key]
        assert body["counts_by_type"]["PERSON"] == len(body["hits"]) > 1
        assert body["redacted_text"].count("[PII:PERSON]") == body["counts_by_type"]["PERSON"]


def test_unsupported_language_still_rejected(recording_client):
    """Regression guard: the 422 contract must survive the rewrite."""
    client, _analyzer = recording_client
    r = client.post("/v1/pii/scan", json={"texts": [{"id": "x", "text": "hola", "language": "es"}]})
    assert r.status_code == 422
