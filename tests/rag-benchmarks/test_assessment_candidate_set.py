# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The CANDIDATE assessment set for the multi-hop/ambiguous classes (#2146).

Blocker 3 of issue #2146: the PRD §4.1 note positions the agentic benefit on
multi-hop and ambiguous queries, and the protocol's composition vocabulary
carries neither class. The candidate set is the PROPOSAL artifact: the signed
FINAL A reference set (67 cases, digest ``cb371f1a…``) extended with the two
new classes REQUIRED through ``_meta.minimums`` — clearly marked candidate,
never signed. The signed set file is untouched; the candidate's digest moves
by addition only (the expected, documented outcome), and the re-signature on
this set's own digest is the operator's later step.

The gate encodes the #2145 rule mechanically for the additions: every
new-class case's gold preview must appear VERBATIM (under the toolchain's own
normalizer) inside the committed fixture its ``source_doc`` names — no
invented gold can enter the set without this test failing. The new-class gold
carries the Phase-1 shape (``preview`` + ``source_doc``, no identity): the
content hashes are venue-resolved by the Phase-2 pass during the ingestion
campaign, exactly like the graded ``e01g-`` cases.
"""

import json
from pathlib import Path

from eval.chunk_identity import normalize
from protocol import evalset as es

# ONE home for the fixture map the #2145 verbatim rule reads (the graded
# set's gate owns it): a fixture rename or addition lands once, both gates
# see it.
from test_assessment_grade_set import GOLD_SOURCE_FIXTURES

BENCH_DIR = Path(__file__).resolve().parent
REPO_ROOT = BENCH_DIR.parent.parent
CANDIDATE_DIR = (
    REPO_ROOT
    / "_bmad-output"
    / "implementation-artifacts"
    / "assessment-set-candidate-2026-11-25"
)
CANDIDATE_SET = CANDIDATE_DIR / "assessment-set.json"
SIGNED_SET = (
    REPO_ROOT
    / "_bmad-output"
    / "implementation-artifacts"
    / "e01-final-reference-2026-11-24"
    / "assessment-set.json"
)

NEW_CLASSES = ("multi_hop", "ambiguous")


def candidate_data() -> dict:
    return json.loads(CANDIDATE_SET.read_text(encoding="utf-8"))


def new_class_cases() -> list[dict]:
    """The candidate's additions — the cases carrying the post-signature
    classes (one partition, shared by the verbatim and multi-document
    gates)."""
    return [
        case
        for case in candidate_data()["entries"]
        if case.get("case_class") in NEW_CLASSES
    ]


def test_candidate_set_exists_and_validates():
    """The candidate set is a valid ASSESSMENT set under the extended
    vocabulary, marked candidate, and it declares the new classes REQUIRED
    through ``_meta.minimums`` (the candidate's own floor, above the default
    0 the post-signature classes carry)."""
    data, entries = es.load_set(CANDIDATE_SET, "assessment")
    assert data["_meta"]["provenance"] == "assessment"
    assert data["_meta"]["status"] == "candidate"
    minimums = data["_meta"]["minimums"]
    for case_class in NEW_CLASSES:
        assert minimums.get(case_class, 0) >= 2
        present = sum(1 for case in entries if case.get("case_class") == case_class)
        assert present >= minimums[case_class]


def test_candidate_set_extends_the_signed_reference_by_addition_only():
    """Every signed case survives byte-identical — the candidate EXTENDS the
    measurement instrument, it never rewrites a case the signed thresholds'
    digest pins — and the only additions are the new-class cases."""
    signed = {
        case["id"]: case
        for case in json.loads(SIGNED_SET.read_text(encoding="utf-8"))["entries"]
    }
    entries = {case["id"]: case for case in candidate_data()["entries"]}
    for inherited_id, source_entry in signed.items():
        assert entries.get(inherited_id) == source_entry, (
            f"inherited case {inherited_id} dropped or drifted from the signed set"
        )
    added_ids = set(entries) - set(signed)
    assert added_ids == {case["id"] for case in new_class_cases()}


def test_candidate_set_new_class_gold_is_verbatim_fixture_text():
    """The #2145 rule, applied to the additions: no invented gold — every
    new-class preview is verbatim committed-fixture text under the
    toolchain's normalizer, named by its source_doc, and every new-class case
    is a public retrieval-class case (the chunk-level surface scores it)."""
    for case in new_class_cases():
        assert case.get("access_scenario") == "public", case["id"]
        assert case.get("expected_chunks"), case["id"]
        for chunk in case["expected_chunks"]:
            preview, source_doc = chunk.get("preview"), chunk.get("source_doc")
            assert preview and source_doc, case["id"]
            fixture = GOLD_SOURCE_FIXTURES.get(source_doc)
            assert fixture is not None, f"{case['id']}: unknown source_doc {source_doc!r}"
            assert fixture.exists(), fixture
            assert normalize(preview) in normalize(fixture.read_text(encoding="utf-8")), case["id"]


def test_multi_hop_cases_join_at_least_two_documents():
    """The join is the multi_hop class's point: a multi_hop case's gold names
    at least TWO distinct source documents, and an ambiguous case's gold
    spans more than one interpretation's passage. An unnamed class falls
    through LOUDLY, never into a neighbour's rule."""
    for case in new_class_cases():
        sources = {chunk.get("source_doc") for chunk in case["expected_chunks"]}
        if case["case_class"] == "multi_hop":
            assert len(sources) >= 2, case["id"]
        elif case["case_class"] == "ambiguous":
            assert len(case["expected_chunks"]) >= 2, case["id"]
        else:
            raise AssertionError(f"{case['id']}: class outside the candidate's declared additions")


def test_the_readme_states_the_set_digest():
    """The artifact README's digest line is pinned to the files: the current
    set's digest must be stated, and every digest-shaped token the README
    carries must be this set's or the signed source's (computed, never
    hardcoded) — a stale digest line fails here. The digest line is exactly
    what the operator reads at re-sign time."""
    import re

    from protocol.manifest import sha256_file

    digest = sha256_file(CANDIDATE_SET)
    signed = sha256_file(SIGNED_SET)
    readme = (CANDIDATE_DIR / "README.md").read_text(encoding="utf-8")
    tokens = set(re.findall(r"\b[0-9a-f]{64}\b", readme))
    assert digest in tokens, (
        f"the artifact README does not state the set's file digest {digest}"
    )
    assert tokens <= {digest, signed}, (
        f"the artifact README states unknown digest token(s): {tokens - {digest, signed}}"
    )


def test_the_committed_set_is_the_build_script_s_output():
    """The build script is the artifact's only writer, checked: running it
    against a temp path reproduces the committed bytes exactly — a hand edit
    to the committed JSON drifts from the declared derivation and fails
    here. The rebuild lands in a temp dir, never the repo tree."""
    import subprocess
    import sys
    import tempfile

    with tempfile.TemporaryDirectory() as tmp:
        rebuilt = Path(tmp) / CANDIDATE_SET.name
        result = subprocess.run(
            [sys.executable, str(CANDIDATE_DIR / "build-candidate-2146.py"), str(rebuilt)],
            capture_output=True,
            text=True,
            timeout=60,
            check=False,  # the return code IS the assertion, stderr its message
        )
        assert result.returncode == 0, (
            f"the build script failed against the temp path:\n{result.stderr}"
        )
        assert rebuilt.read_bytes() == CANDIDATE_SET.read_bytes(), (
            "the committed assessment-set.json is not the build script's output —"
            " the artifact and its declared derivation have drifted"
        )
