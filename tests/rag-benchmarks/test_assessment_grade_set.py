# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The acceptance-grade assessment set (issue #2151) — the artifact's own gate.

The graded set extends the #2148 campaign set (digest ``8016d4a26a45…``, 16
cases) to acceptance-grade size: 40 anchor-scored retrieval cases, permission
variety through restricted retrieval-class cases, a wider outcome set, and
the seven security scenarios exercising every #2148 fixture.

The gate encodes the #2145 rule mechanically: every graded case's gold
preview must appear VERBATIM (under the toolchain's own normalizer) inside
the committed fixture its ``source_doc`` names — no invented gold can enter
the set without this test failing. The graded gold carries the Phase-1
shape (``preview`` + ``source_doc``, no identity): the content hashes and
the restricted source ids are venue-resolved products (the served chunk text
carries the LLM-generated doc-context prefix, so no offline computation can
produce them honestly) — the ingestion campaign resolves them by the
documented Phase-2 protocol, exactly as #2148 regenerated its set.
"""

import json
from pathlib import Path

from eval.chunk_identity import normalize
from protocol import evalset as es

BENCH_DIR = Path(__file__).resolve().parent
REPO_ROOT = BENCH_DIR.parent.parent
GRADED_SET = (
    REPO_ROOT
    / "_bmad-output"
    / "implementation-artifacts"
    / "e01-assessment-grade-2026-11-24"
    / "assessment-set.json"
)
SECURITY_CORPUS_DIR = REPO_ROOT / "tests" / "rag-benchmarks" / "fixtures" / "security-corpus"

# Every fixture the graded set may name as a gold source, and the path whose
# text makes the preview verifiable. Explicit for the E2E fixture (it lives
# outside this benchmark tree); the security corpus contributes the rest.
GOLD_SOURCE_FIXTURES = {
    "test-document.md": REPO_ROOT / "tests" / "e2e" / "fixtures" / "test-document.md",
    # The fixtures' README is admin prose, not corpus content — a preview
    # copied from it would pass a verbatim check and never match a chunk.
    **{path.name: path for path in sorted(SECURITY_CORPUS_DIR.glob("e01-sec-doc-*.md"))},
}

# The 16 cases the graded set inherits from the #2148 campaign set (digest
# 8016d4a26a45…) — the measurement instrument already signed against. The
# graded set extends it; the inherited-instrument test compares each entry
# against the committed source set, so none can silently drift or drop.
INHERITED_CASE_IDS = (
    "e01-ans-purpose",
    "e01-ans-items",
    "e01-ans-formatting",
    "e01-unans-upload-count",
    "e01-cite-items",
    "e01-lang-es",
    "e01-lang-zh",
    "e01-fail-saturation",
    "e01-cancel-checklist",
    "e01-sec-restricted",
    "e01-sec-xuser-a",
    "e01-sec-xuser-b",
    "e01-sec-narrowed",
    "e01-sec-permission",
    "e01-sec-injection-document",
    "e01-sec-injection-tool",
)

# The security corpus fixture each inherited security scenario exercises
# (the fixtures README's table, restated so the coverage check is mechanical).
SECURITY_FIXTURE_CASES = {
    "e01-sec-doc-restricted-e01.md": ["e01-sec-restricted"],
    "e01-sec-doc-shared-e01.md": ["e01-sec-xuser-a", "e01-sec-xuser-b"],
    "e01-sec-doc-wide-e01.md": ["e01-sec-permission"],
    "e01-sec-doc-revoked-e01.md": ["e01-sec-permission"],
    "e01-sec-doc-forestry-e01.md": ["e01-sec-narrowed"],
    "e01-sec-doc-catalogue-e01.md": ["e01-sec-injection-document"],
    "e01-sec-doc-servicerequest-e01.md": ["e01-sec-injection-tool"],
}


def graded_data() -> dict:
    return json.loads(GRADED_SET.read_text(encoding="utf-8"))


def test_graded_set_exists_and_validates():
    """The graded set is a valid assessment set — every composition class,
    access scenario and security scenario present and countable."""
    data, entries = es.load_set(GRADED_SET, "assessment")
    assert len(entries) == 67
    assert data["_meta"]["provenance"] == "assessment"


def test_graded_set_census_is_acceptance_grade():
    """The census states the acceptance-grade coverage: 40 anchor-scored
    retrieval cases (the #2151 floor), the permission variety on the
    restricted_access surface, a wider outcome set, and the seven security
    scenarios — and every case has a resolved surface."""
    entries = graded_data()["entries"]
    census = es.coverage_census(entries)
    assert census["by_surface"]["retrieval"] == 40
    assert census["by_surface"]["restricted_access"] == 14
    assert census["by_surface"]["outcome"] == 6
    assert census["by_surface"]["security"] == 7
    assert census["n_set_cases"] == 67
    assert census["n_cases_with_a_resolved_surface"] == census["n_set_cases"]
    assert census["retrieval_cases_without_gold"] == []


def test_inherited_measurement_instrument_is_unchanged():
    """The 16 inherited cases have identical entries to the #2148 campaign
    set — the measurement instrument the signed M-1 binds, compared
    entry-by-entry against the committed source, so no rewrite (query, gold,
    expectations) can drift it while keeping its id."""
    inherited_source = (
        REPO_ROOT
        / "_bmad-output"
        / "implementation-artifacts"
        / "e01-security-corpus-2026-11-24"
        / "assessment-set.json"
    )
    source_entries = {
        case["id"]: case for case in json.loads(inherited_source.read_text(encoding="utf-8"))["entries"]
    }
    entries = {case["id"]: case for case in graded_data()["entries"]}
    for inherited_id in INHERITED_CASE_IDS:
        assert inherited_id in entries, f"inherited case {inherited_id} dropped"
        assert entries[inherited_id] == source_entries[inherited_id], (
            f"inherited case {inherited_id} drifted from the #2148 set"
        )


def test_every_graded_gold_preview_is_verbatim_in_its_fixture():
    """The #2145 rule, mechanically: every graded case's gold preview appears
    verbatim (normalized) inside the committed fixture its source_doc names."""
    graded = [
        case for case in graded_data()["entries"] if str(case.get("id", "")).startswith("e01g-")
    ]
    assert graded, "the graded set declares no graded cases"
    offenders = []
    for case in graded:
        for index, chunk in enumerate(case.get("expected_chunks") or []):
            source_doc = chunk.get("source_doc")
            preview = chunk.get("preview")
            fixture = GOLD_SOURCE_FIXTURES.get(source_doc)
            if fixture is None:
                offenders.append(f"{case['id']}#gold{index}: unknown source_doc {source_doc!r}")
                continue
            if not preview or normalize(preview) not in normalize(fixture.read_text(encoding="utf-8")):
                offenders.append(f"{case['id']}#gold{index}: preview not verbatim in {source_doc}")
    assert offenders == []


def test_graded_public_gold_defers_identity_to_the_venue():
    """Graded gold carries the Phase-1 shape (preview + source_doc) and NO
    identity: the content hashes are venue-resolved products (the served
    chunk text carries the LLM doc-context prefix), so an offline hash would
    be invented gold by construction."""
    graded = [
        case for case in graded_data()["entries"] if str(case.get("id", "")).startswith("e01g-")
    ]
    for case in graded:
        for index, chunk in enumerate(case.get("expected_chunks") or []):
            assert not chunk.get("content_hash"), (
                f"{case['id']}#gold{index} carries an offline content_hash — invented gold"
            )
            assert not chunk.get("chunk_key"), f"{case['id']}#gold{index} carries an offline chunk_key"
            assert chunk.get("preview") and chunk.get("source_doc")


def test_graded_retrieval_cases_are_single_turn():
    """The anchor refuses a multi-turn retrieval case — every graded case on
    the chunk-level surface is driven as ONE query."""
    for case in graded_data()["entries"]:
        if not str(case.get("id", "")).startswith("e01g-"):
            continue
        if es.evaluation_surface(case) == "retrieval":
            assert not case.get("turns"), f"{case['id']} is a multi-turn retrieval case"


def test_every_security_fixture_is_exercised():
    """Each #2148 fixture keeps at least one consuming case — the security
    scenarios never pass vacuously on a fixture the set stopped naming, and
    the graded restricted/public cases deepen the same corpus."""
    entries = graded_data()["entries"]
    ids = {case["id"] for case in entries}
    for fixture, security_cases in SECURITY_FIXTURE_CASES.items():
        consumers = set(security_cases)
        for case in entries:
            for chunk in case.get("expected_chunks") or []:
                if chunk.get("source_doc") == fixture:
                    consumers.add(case["id"])
        assert consumers <= ids, f"{fixture}: consumers not in the set: {consumers - ids}"
        assert consumers, f"{fixture}: no case consumes it"
