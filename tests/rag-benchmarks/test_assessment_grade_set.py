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
from protocol.manifest import sha256_file

BENCH_DIR = Path(__file__).resolve().parent
REPO_ROOT = BENCH_DIR.parent.parent
ARTIFACT_DIR = (
    REPO_ROOT
    / "_bmad-output"
    / "implementation-artifacts"
    / "e01-assessment-grade-2026-11-24"
)
GRADED_SET = ARTIFACT_DIR / "assessment-set.json"
INHERITED_SOURCE = (
    REPO_ROOT
    / "_bmad-output"
    / "implementation-artifacts"
    / "e01-security-corpus-2026-11-24"
    / "assessment-set.json"
)
SECURITY_CORPUS_DIR = (
    REPO_ROOT / "tests" / "rag-benchmarks" / "fixtures" / "security-corpus"
)

# Every fixture the graded set may name as a gold source, and the path whose
# text makes the preview verifiable. Explicit for the E2E fixture (it lives
# outside this benchmark tree); the security corpus contributes the rest.
GOLD_SOURCE_FIXTURES = {
    "test-document.md": REPO_ROOT / "tests" / "e2e" / "fixtures" / "test-document.md",
    # The fixtures' README is admin prose, not corpus content — a preview
    # copied from it would pass a verbatim check and never match a chunk.
    **{
        path.name: path for path in sorted(SECURITY_CORPUS_DIR.glob("e01-sec-doc-*.md"))
    },
}

# The security-corpus fixture each inherited security scenario exercises
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


def graded_cases() -> list[dict]:
    """The graded (``e01g-``-prefixed) cases — one partition, shared by the
    verbatim, identity and single-turn gates."""
    return [
        case
        for case in graded_data()["entries"]
        if str(case.get("id", "")).startswith("e01g-")
    ]


def test_graded_set_exists_and_validates():
    """The graded set is a valid assessment set — every composition class,
    access scenario and security scenario present and countable (the census
    test pins the case totals)."""
    data, _entries = es.load_set(GRADED_SET, "assessment")
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


def source_entries() -> dict:
    """The committed #2148 campaign set's cases, keyed by id — the byte
    the signed M-1 binds."""
    return {
        case["id"]: case
        for case in json.loads(INHERITED_SOURCE.read_text(encoding="utf-8"))["entries"]
    }


def test_inherited_measurement_instrument_is_unchanged():
    """Every #2148 source case survives into the graded set with identical
    entries — the measurement instrument the signed M-1 binds, compared
    entry-by-entry against the committed source, so no rewrite (query, gold,
    expectations) can drift it while keeping its id, and no source case can
    be silently omitted from the check."""
    source = source_entries()
    entries = {case["id"]: case for case in graded_data()["entries"]}
    for inherited_id, source_entry in source.items():
        assert entries.get(inherited_id) == source_entry, (
            f"inherited case {inherited_id} dropped or drifted from the #2148 set"
        )


def test_every_non_inherited_case_is_graded_namespaced():
    """The complement of the byte-identity gate: a case that is not one of
    the #2148 source cases must carry the graded e01g- prefix — an
    inherited-looking id cannot smuggle an un-gated case (its gold would
    escape the verbatim, identity and single-turn gates) past the
    graded-case partition."""
    source = source_entries()
    for case in graded_data()["entries"]:
        if case.get("id") in source and case == source[case["id"]]:
            continue
        assert str(case.get("id", "")).startswith("e01g-"), (
            f"case {case.get('id')!r} is neither an inherited #2148 case nor graded-namespaced"
        )


def test_every_graded_gold_preview_is_verbatim_in_its_fixture():
    """The #2145 rule, mechanically: every graded case's gold preview appears
    verbatim (normalized) inside the committed fixture its source_doc names."""
    graded = graded_cases()
    assert graded, "the graded set declares no graded cases"
    offenders = []
    for case in graded:
        for index, chunk in enumerate(case.get("expected_chunks") or []):
            source_doc = chunk.get("source_doc")
            preview = chunk.get("preview")
            fixture = GOLD_SOURCE_FIXTURES.get(source_doc)
            if fixture is None:
                offenders.append(
                    f"{case['id']}#gold{index}: unknown source_doc {source_doc!r}"
                )
                continue
            if (
                not preview
                or not normalize(preview)
                or normalize(preview)
                not in normalize(fixture.read_text(encoding="utf-8"))
            ):
                offenders.append(
                    f"{case['id']}#gold{index}: preview not verbatim in {source_doc}"
                )
    assert offenders == []


def test_graded_public_gold_defers_identity_to_the_venue():
    """Graded gold carries the Phase-1 shape (preview + source_doc) and NO
    identity: the content hashes are venue-resolved products (the served
    chunk text carries the LLM doc-context prefix), so an offline hash would
    be invented gold by construction."""
    for case in graded_cases():
        for index, chunk in enumerate(case.get("expected_chunks") or []):
            assert not chunk.get("content_hash"), (
                f"{case['id']}#gold{index} carries an offline content_hash — invented gold"
            )
            assert not chunk.get("chunk_key"), (
                f"{case['id']}#gold{index} carries an offline chunk_key"
            )
            assert chunk.get("preview") and chunk.get("source_doc")


def test_graded_retrieval_cases_are_single_turn():
    """The anchor refuses a multi-turn retrieval case — every graded case on
    the chunk-level surface is driven as ONE query."""
    for case in graded_cases():
        if es.evaluation_surface(case) == "retrieval":
            assert not case.get("turns"), f"{case['id']} is a multi-turn retrieval case"


def test_every_security_fixture_is_exercised():
    """Each #2148 fixture keeps at least one consuming case — the security
    scenarios never pass vacuously on a fixture the set stopped naming, and
    the graded restricted/public cases deepen the same corpus. The fixture
    list comes from the corpus directory itself, so a renamed or added
    fixture is coverage-checked under its real name."""
    entries = graded_data()["entries"]
    ids = {case["id"] for case in entries}
    for fixture_path in sorted(SECURITY_CORPUS_DIR.glob("e01-sec-doc-*.md")):
        fixture = fixture_path.name
        consumers = set(SECURITY_FIXTURE_CASES.get(fixture, ()))
        for case in entries:
            for chunk in case.get("expected_chunks") or []:
                if chunk.get("source_doc") == fixture:
                    consumers.add(case["id"])
        assert consumers, f"{fixture}: no case consumes it"
        assert consumers <= ids, (
            f"{fixture}: consumers not in the set: {consumers - ids}"
        )


def test_the_ci_job_watches_every_gate_input():
    """The commit-level claim 'an edit to a gate input runs the job' is
    itself enforced: the test:rag-benchmarks merge-request changes filter
    must watch every file this gate reads (the suite's parity-pin
    precedent, test_protocol_e01.py)."""
    import yaml

    ci_path = REPO_ROOT / ".gitlab-ci.yml"
    job = yaml.safe_load(ci_path.read_text(encoding="utf-8"))["test:rag-benchmarks"]
    # The merge-request rule specifically — unioning every source-guarded
    # rule would let a future push rule's list mask a missing input here.
    changes = next(
        rule.get("changes", [])
        for rule in job["rules"]
        if rule.get("if", "") == '$CI_PIPELINE_SOURCE == "merge_request_event"'
    )

    def watched(path: Path) -> bool:
        rel = path.relative_to(REPO_ROOT).as_posix()
        return any(
            (entry.endswith("/**/*") and rel.startswith(entry[: -len("/**/*")]))
            or rel == entry
            for entry in changes
        )

    # The graded gate's inputs, plus the protocol suite's other artifact
    # gates that share this job (the #2146 candidate gate, the coexistence
    # draft tests and the extended-vocabulary guards): every file the suite
    # reads from the artifact trees must be watched.
    CANDIDATE_DIR = ARTIFACT_DIR.parent / "assessment-set-candidate-2026-11-25"
    DRAFT_DIR = ARTIFACT_DIR.parent / "coexistence-limits-draft-2026-11-25"
    FINAL_A_DIR = ARTIFACT_DIR.parent / "e01-final-reference-2026-11-24"
    gate_inputs = [
        GRADED_SET,
        INHERITED_SOURCE,
        *GOLD_SOURCE_FIXTURES.values(),
        CANDIDATE_DIR / "assessment-set.json",
        CANDIDATE_DIR / "build-candidate-2146.py",
        DRAFT_DIR / "legacy-limits.draft.json",
        FINAL_A_DIR / "assessment-set.json",
        FINAL_A_DIR / "reference.manifest.json",
    ]
    unwatched = [
        p.relative_to(REPO_ROOT).as_posix() for p in gate_inputs if not watched(p)
    ]
    assert unwatched == [], (
        f"the changes filter does not watch gate inputs: {unwatched}"
    )


def test_the_readme_states_the_set_digest():
    """The artifact README's digest is pinned to the files: the current
    set's digest must be stated, and every digest-shaped token the README
    carries must be this set's or the inherited source's (computed, never
    hardcoded) — a stale digest line fails here, keeping the campaign's
    identity trail honest."""
    import re

    digest = sha256_file(GRADED_SET)[:12]
    inherited = sha256_file(INHERITED_SOURCE)[:12]
    readme = (ARTIFACT_DIR / "README.md").read_text(encoding="utf-8")
    tokens = set(re.findall(r"\b[0-9a-f]{12}\b", readme))
    assert digest in tokens, (
        f"the artifact README does not state the set's file digest {digest}"
    )
    assert tokens <= {digest, inherited}, (
        f"the artifact README states unknown digest token(s): {tokens - {digest, inherited}}"
    )
