# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for protocol/gate.py — the A-only-first partial-order gate.

The gate refuses a gated B/C run naming the missing predecessor: no reference
for the corpus+set, no signed thresholds, unsigned thresholds, or thresholds
whose lineage points elsewhere. A complete lineage passes and yields the
digests the gated manifest chains.
"""

import json
from pathlib import Path

import pytest

from protocol import gate
from protocol.manifest import build_manifest, manifest_digest

CORPUS = "c" * 64
SET_SHA = "a" * 64


def _reference(run_dir: Path, name: str, *, corpus=CORPUS, set_sha=SET_SHA, created="2026-01-01T00:00:00+00:00"):
    manifest = build_manifest(
        kind="reference",
        config="A",
        corpus={"source_collection": "COLL", "arango_graph_name": "G", "fingerprint": corpus},
        sets={"assessment": {"path": "sets/assessment.json", "sha256": set_sha}},
        configuration={"A": {"resolved_env": {}, "model_ids": {}, "prompt_digests": {}}},
        evaluator_instructions_path=Path(__file__).resolve().parent / "protocol" / "evaluator-instructions.md",
        created_utc=created,
    )
    (run_dir / name).write_text(json.dumps(manifest), encoding="utf-8")
    return manifest


def _thresholds(run_dir: Path, name: str, reference: dict, *, signed=True, corpus=CORPUS, set_sha=SET_SHA):
    record = gate.thresholds_file(
        corpus_fingerprint=corpus,
        assessment_set_sha256=set_sha,
        reference_manifest=reference,
        thresholds={"recall_min": 0.4},
        signed=signed,
    )
    (run_dir / name).write_text(json.dumps(record), encoding="utf-8")
    return record


def _check(run_dir, **kw):
    args = dict(
        run_dir=run_dir,
        corpus_fingerprint=CORPUS,
        assessment_set_sha256=SET_SHA,
        config="B",
    )
    args.update(kw)
    return gate.check_gated_run(**args)


def test_no_reference_refuses_naming_the_missing_reference(tmp_path):
    with pytest.raises(gate.GateRefusal) as failed:
        _check(tmp_path)
    assert failed.value.reason == "missing_reference"
    assert "reference" in str(failed.value)
    assert "run_protocol.py reference" in str(failed.value)


def test_reference_for_a_different_corpus_does_not_count(tmp_path):
    _reference(tmp_path, "reference.manifest.json", corpus="9" * 64)
    with pytest.raises(gate.GateRefusal) as failed:
        _check(tmp_path)
    assert failed.value.reason == "missing_reference"


def test_reference_without_thresholds_refuses_naming_the_thresholds(tmp_path):
    _reference(tmp_path, "reference.manifest.json")
    with pytest.raises(gate.GateRefusal) as failed:
        _check(tmp_path)
    assert failed.value.reason == "missing_thresholds"
    assert "thresholds" in str(failed.value)


def test_unsigned_thresholds_refused(tmp_path):
    reference = _reference(tmp_path, "reference.manifest.json")
    _thresholds(tmp_path, "thresholds.json", reference, signed=False)
    with pytest.raises(gate.GateRefusal) as failed:
        _check(tmp_path)
    assert failed.value.reason == "thresholds_not_signed"


def test_thresholds_for_another_lineage_refused(tmp_path):
    # Two matching references: the gate selects the NEWEST (a re-measured
    # reference supersedes the earlier one); thresholds referencing the OLDER
    # one do not verify.
    _reference(tmp_path, "reference.manifest.json", created="2026-01-01T00:00:00+00:00")
    newer = _reference(tmp_path, "reference2.manifest.json", created="2026-02-01T00:00:00+00:00")
    older = json.loads((tmp_path / "reference.manifest.json").read_text(encoding="utf-8"))
    _thresholds(tmp_path, "thresholds.json", older)
    assert manifest_digest(older) != manifest_digest(newer)
    with pytest.raises(gate.GateRefusal) as failed:
        _check(tmp_path)
    assert failed.value.reason == "thresholds_lineage_mismatch"


def test_thresholds_with_mismatched_corpus_refused(tmp_path):
    reference = _reference(tmp_path, "reference.manifest.json")
    _thresholds(tmp_path, "thresholds.json", reference, corpus="8" * 64)
    with pytest.raises(gate.GateRefusal) as failed:
        _check(tmp_path)
    assert failed.value.reason == "thresholds_lineage_mismatch"


def test_complete_lineage_passes_and_names_the_chain(tmp_path):
    reference = _reference(tmp_path, "reference.manifest.json")
    thresholds = _thresholds(tmp_path, "thresholds.json", reference)
    lineage = _check(tmp_path)
    assert lineage["reference_manifest_sha256"] == manifest_digest(reference)
    assert lineage["thresholds_sha256"] == manifest_digest(thresholds)


def test_non_manifest_json_files_are_ignored(tmp_path):
    (tmp_path / "config-a.report.json").write_text(json.dumps({"aggregate": {"recall": 0.5}}), encoding="utf-8")
    (tmp_path / "junk.json").write_text("not json at all", encoding="utf-8")
    reference = _reference(tmp_path, "reference.manifest.json")
    _thresholds(tmp_path, "thresholds.json", reference)
    assert _check(tmp_path)["reference_manifest_sha256"] == manifest_digest(reference)


def test_unreadable_threshold_file_counts_as_missing(tmp_path):
    _reference(tmp_path, "reference.manifest.json")
    (tmp_path / "thresholds.json").write_text("{broken", encoding="utf-8")
    with pytest.raises(gate.GateRefusal) as failed:
        _check(tmp_path)
    assert failed.value.reason == "missing_thresholds"


def test_thresholds_file_shape_carries_lineage_fields():
    reference = {"artifact": "run-manifest", "kind": "reference", "x": 1}
    record = gate.thresholds_file(
        corpus_fingerprint=CORPUS,
        assessment_set_sha256=SET_SHA,
        reference_manifest=reference,
        thresholds={"recall_min": 0.4},
    )
    assert record["artifact"] == gate.THRESHOLDS_ARTIFACT
    assert record["signed"] is True
    assert record["reference_manifest_sha256"] == manifest_digest(reference)
    assert record["corpus_fingerprint"] == CORPUS
    assert record["assessment_set_sha256"] == SET_SHA
    assert record["thresholds"] == {"recall_min": 0.4}
