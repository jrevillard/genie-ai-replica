# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for protocol/e02.py (+ the e02 CLI wiring).

Every I/O matrix row through fakes — no live venue, no network: the manifests
are synthetic, the rows are fixture rows (no deployment case content), the
thresholds artifact is a synthetic SIGNED one. Proven here:

* the E02 report reports M-1..M-5 for BOTH legs with the surface named, the
  gains per query class and the costs (CM-1..CM-3) as first-class records;
* a query class the set does not carry is recorded as NOT COVERED — the
  agentic gain stays a hypothesis;
* an absent threshold is recorded as absent with its blocking reason, and a
  bound scoped to another configuration's surface is recorded as NOT
  MEASURABLE — never applied across surfaces, never a pass;
* the report refuses — before building — on a lineage mismatch, a wrong-leg
  manifest, legs gated against different predecessors, and a mismatched
  thresholds artifact;
* the report reproduces byte-identically under a pinned created_utc.
"""

import argparse
import json
from pathlib import Path

import pytest

from protocol.e02 import (
    E02Refusal,
    build_e02_report,
    e02_report_digest,
)
from protocol.manifest import build_manifest, manifest_digest, sha256_json
from protocol.run_protocol import cmd_e02

CORPUS = "c" * 64
SET_SHA = "a" * 64
EVALUATOR_INSTRUCTIONS = str(Path(__file__).resolve().parent / "protocol" / "evaluator-instructions.md")
CREATED = "2026-11-24T00:00:00+00:00"


# ---------------------------------------------------------------------------
# Fixtures — synthetic manifests, fixture rows, a synthetic signed artifact
# ---------------------------------------------------------------------------


def _reference_manifest():
    return build_manifest(
        kind="reference",
        config="A",
        corpus={"source_collection": "GRAPH_SOURCE", "arango_graph_name": "", "fingerprint": CORPUS},
        sets={"assessment": {"path": "assessment-set.json", "sha256": SET_SHA}},
        configuration={"A": {"resolved_env": {"LLM_MODEL": "granite"}, "model_ids": {}, "prompt_digests": {}}},
        evaluator_instructions_path=EVALUATOR_INSTRUCTIONS,
        created_utc=CREATED,
    )


def _gated_manifest(config, *, corpus=CORPUS, set_sha=SET_SHA, reference_digest=None, pair=None):
    reference_digest = reference_digest or manifest_digest(_reference_manifest())
    return build_manifest(
        kind="gated",
        config=config,
        corpus={"source_collection": "GRAPH_SOURCE", "arango_graph_name": "", "fingerprint": corpus},
        sets={"assessment": {"path": "assessment-set.json", "sha256": set_sha}},
        configuration={
            config: {
                "resolved_env": {"LLM_MODEL": "granite", "AGENT_LANE_SLOTS": "2"},
                "model_ids": {"llm": "granite"},
                "prompt_digests": {},
            }
        },
        evaluator_instructions_path=EVALUATOR_INSTRUCTIONS,
        lineage={"reference_manifest_sha256": reference_digest, "thresholds_sha256": "t" * 64},
        pair=pair or ("E01" if config == "B" else "E02"),
        created_utc=CREATED,
    )


def _b_rows():
    return {
        "c1": {
            "case_id": "c1",
            "status": "ok",
            "answer": "the fixed pipeline answered",
            "abstained": False,
            "source_documents": ["doc-1"],
            "metadata": {"usage": {"model_calls": 1, "prompt_tokens": 10}},
            "wall_ms": 100.0,
        },
        "c2": {
            "case_id": "c2",
            "status": "ok",
            "answer": "",
            "abstained": True,
            "abstention_reason": "no_documents_retrieved",
            "source_documents": [],
            "wall_ms": 200.0,
        },
        "c3": {"case_id": "c3", "status": "failure", "error_type": "RuntimeError", "wall_ms": 50.0},
    }


def _c_rows():
    return {
        "c1": {
            "case_id": "c1",
            "outcome": "answered",
            "answer": "the agent answered",
            "source_documents": ["doc-1"],
            "usage_record": {"model_calls": 3, "prompt_tokens": 40, "outcome": "completed"},
            "wall_ms": 400.0,
        },
        "c2": {
            "case_id": "c2",
            "outcome": "answered",
            "answer": "the agent answered with a caveat",
            "source_documents": [],
            "usage_record": {"model_calls": 2, "prompt_tokens": 30},
            "wall_ms": 800.0,
        },
        "c3": {"case_id": "c3", "outcome": "error", "error_text": "run_error", "wall_ms": 60.0},
    }


def _entries():
    """The set's entries — the query-class source."""
    return [
        {"id": "c1", "case_class": "answerable", "expectations": {"query_class": "multi_hop"}},
        {"id": "c2", "case_class": "unanswerable"},
        {"id": "c3", "case_class": "failure"},
    ]


def _signed_thresholds(*, scope="config A — the chunk/passage-level anchor metrics"):
    """A signed thresholds artifact in the registry's derived shape."""
    return {
        "artifact": "evaluation-thresholds",
        "signed": True,
        "corpus_fingerprint": CORPUS,
        "assessment_set_sha256": SET_SHA,
        "reference_manifest_sha256": manifest_digest(_reference_manifest()),
        "thresholds": {
            "M-1": {
                "value": {
                    "scope": scope,
                    "metrics": {
                        "retrieval_recall": {"operator": ">=", "threshold": 0.95},
                        "noise": {"operator": "<=", "threshold": 0.8},
                    },
                },
                "dimension": "retrieval_quality",
                "surface": scope,
                "rationale": "signed against the measured reference",
                "agreement_date": "2026-11-23",
            }
        },
    }


# ---------------------------------------------------------------------------
# The report
# ---------------------------------------------------------------------------


def test_e02_report_reports_m1_to_m5_for_both_legs():
    report = build_e02_report(
        b_manifest=_gated_manifest("B"),
        c_manifest=_gated_manifest("C"),
        b_rows=_b_rows(),
        c_rows=_c_rows(),
        entries=_entries(),
        created_utc=CREATED,
    )
    assert set(report["dimensions"]) == {"M-1", "M-2", "M-3", "M-4", "M-5"}
    for record in report["dimensions"].values():
        assert set(record) == {"dimension", "B", "C"}
        for leg in ("B", "C"):
            assert record[leg]["measurement_surface"]
            assert "available" in record[leg]
    assert report["dimensions"]["M-1"]["B"]["measurement_surface"].startswith("doc-level")
    assert report["dimensions"]["M-1"]["C"]["measurement_surface"].startswith("doc-level")
    # M-3's config-C surface says out loud that the mechanical flag is absent.
    assert "no mechanical abstention flag" in " ".join(report["dimensions"]["M-3"]["C"]["notes"])


def test_e02_report_carries_the_costs_as_first_class_records():
    report = build_e02_report(
        b_manifest=_gated_manifest("B"),
        c_manifest=_gated_manifest("C"),
        b_rows=_b_rows(),
        c_rows=_c_rows(),
        entries=_entries(),
        created_utc=CREATED,
    )
    metrics = report["costs"]["counter_metrics"]
    assert set(metrics) == {"CM-1", "CM-2", "CM-3"}
    # CM-1's per-request delta is visible, not averaged away.
    assert metrics["CM-1"]["values"]["latency_delta"]["per_request"]
    # CM-2's denominator is a judge-layer fact — absent is recorded, never zero.
    assert metrics["CM-2"].get("available") is False
    assert metrics["CM-2"].get("not_available_reason")


def test_e02_report_records_the_gains_per_query_class():
    report = build_e02_report(
        b_manifest=_gated_manifest("B"),
        c_manifest=_gated_manifest("C"),
        b_rows=_b_rows(),
        c_rows=_c_rows(),
        entries=_entries(),
        created_utc=CREATED,
    )
    per_class = report["gains"]["per_class"]
    assert "multi_hop" in per_class
    assert per_class["multi_hop"]["n_cases"] == 1
    assert per_class["multi_hop"]["delta"]["answered"] == 0
    assert per_class["multi_hop"]["B"]["latency"]["median"] == 100.0
    assert per_class["multi_hop"]["C"]["latency"]["median"] == 400.0
    assert per_class["multi_hop"]["delta"]["median_latency_ms"] == 300.0


def test_e02_report_records_the_classes_the_set_does_not_carry_as_not_covered():
    report = build_e02_report(
        b_manifest=_gated_manifest("B"),
        c_manifest=_gated_manifest("C"),
        b_rows=_b_rows(),
        c_rows=_c_rows(),
        entries=_entries(),
        created_utc=CREATED,
    )
    not_covered = {entry["query_class"] for entry in report["gains"]["not_covered"]}
    assert not_covered == {"ambiguous"}
    assert "HYPOTHESIS" in report["gains"]["not_covered"][0]["reason"]


def test_e02_report_records_an_absent_threshold_with_its_blocking_reason():
    report = build_e02_report(
        b_manifest=_gated_manifest("B"),
        c_manifest=_gated_manifest("C"),
        b_rows=_b_rows(),
        c_rows=_c_rows(),
        entries=_entries(),
        created_utc=CREATED,
    )
    for record in report["dimensions"].values():
        for leg in ("B", "C"):
            threshold = record[leg]["threshold"]
            assert threshold["status"] == "absent"
            assert threshold["reason"]
            assert threshold["bounds"] == []
    assert report["verdict"]["state"] == "unassessable"


def test_e02_report_does_not_apply_a_bound_scoped_to_another_surface():
    report = build_e02_report(
        b_manifest=_gated_manifest("B"),
        c_manifest=_gated_manifest("C"),
        b_rows=_b_rows(),
        c_rows=_c_rows(),
        entries=_entries(),
        thresholds=_signed_thresholds(),
        created_utc=CREATED,
    )
    threshold = report["dimensions"]["M-1"]["B"]["threshold"]
    assert threshold["status"] == "not_measurable"
    assert threshold["scope"].startswith("config A")
    assert {bound["outcome"] for bound in threshold["bounds"]} == {"not_measurable"}
    assert all(bound["measured"] is None for bound in threshold["bounds"])


def test_e02_report_applies_a_bound_the_surface_carries():
    thresholds = _signed_thresholds(scope="the E02 doc-level surface")
    thresholds["thresholds"]["M-1"]["value"]["metrics"] = {
        "n_rows_with_source_documents": {"operator": ">=", "threshold": 1}
    }
    report = build_e02_report(
        b_manifest=_gated_manifest("B"),
        c_manifest=_gated_manifest("C"),
        b_rows=_b_rows(),
        c_rows=_c_rows(),
        entries=_entries(),
        thresholds=thresholds,
        created_utc=CREATED,
    )
    threshold = report["dimensions"]["M-1"]["B"]["threshold"]
    assert threshold["status"] == "applied"
    assert threshold["bounds"][0]["outcome"] == "pass"
    assert threshold["bounds"][0]["measured"] == 1


def test_e02_verdict_is_not_supported_when_a_bound_fails():
    thresholds = _signed_thresholds(scope="the E02 doc-level surface")
    thresholds["thresholds"]["M-1"]["value"]["metrics"] = {
        "n_rows_with_source_documents": {"operator": ">=", "threshold": 9}
    }
    report = build_e02_report(
        b_manifest=_gated_manifest("B"),
        c_manifest=_gated_manifest("C"),
        b_rows=_b_rows(),
        c_rows=_c_rows(),
        entries=_entries(),
        thresholds=thresholds,
        created_utc=CREATED,
    )
    assert report["verdict"]["state"] == "not_supported"
    assert report["verdict"]["failed_dimensions"]


def test_e02_report_reproduces_under_a_pinned_created_utc():
    kwargs = dict(
        b_manifest=_gated_manifest("B"),
        c_manifest=_gated_manifest("C"),
        b_rows=_b_rows(),
        c_rows=_c_rows(),
        entries=_entries(),
        created_utc=CREATED,
    )
    first = build_e02_report(**kwargs)
    second = build_e02_report(**kwargs)
    assert first["digest"] == second["digest"]
    assert e02_report_digest(first) == first["digest"]


def test_e02_report_digests_every_input():
    b_manifest = _gated_manifest("B")
    c_manifest = _gated_manifest("C")
    report = build_e02_report(
        b_manifest=b_manifest,
        c_manifest=c_manifest,
        b_rows=_b_rows(),
        c_rows=_c_rows(),
        entries=_entries(),
        created_utc=CREATED,
    )
    inputs = report["inputs"]
    assert inputs["b_manifest_sha256"] == manifest_digest(b_manifest)
    assert inputs["c_manifest_sha256"] == manifest_digest(c_manifest)
    assert inputs["b_rows_sha256"] == sha256_json(_b_rows())
    assert inputs["corpus_fingerprint"] == CORPUS
    assert inputs["assessment_set_sha256"] == SET_SHA


# ---------------------------------------------------------------------------
# The refusals
# ---------------------------------------------------------------------------


def test_e02_refuses_a_corpus_mismatch_between_the_legs():
    with pytest.raises(E02Refusal) as failed:
        build_e02_report(
            b_manifest=_gated_manifest("B"),
            c_manifest=_gated_manifest("C", corpus="d" * 64),
            b_rows=_b_rows(),
            c_rows=_c_rows(),
            entries=_entries(),
            created_utc=CREATED,
        )
    assert failed.value.reason == "lineage_mismatch"


def test_e02_refuses_a_wrong_leg_manifest():
    with pytest.raises(E02Refusal) as failed:
        build_e02_report(
            b_manifest=_gated_manifest("B"),
            c_manifest=_gated_manifest("B"),
            b_rows=_b_rows(),
            c_rows=_c_rows(),
            entries=_entries(),
            created_utc=CREATED,
        )
    assert failed.value.reason == "wrong_leg"


def test_e02_refuses_legs_gated_against_different_predecessors():
    with pytest.raises(E02Refusal) as failed:
        build_e02_report(
            b_manifest=_gated_manifest("B", reference_digest="1" * 64),
            c_manifest=_gated_manifest("C", reference_digest="2" * 64),
            b_rows=_b_rows(),
            c_rows=_c_rows(),
            entries=_entries(),
            created_utc=CREATED,
        )
    assert failed.value.reason == "lineage_mismatch"


def test_e02_refuses_rows_of_another_leg():
    with pytest.raises(E02Refusal) as failed:
        build_e02_report(
            b_manifest=_gated_manifest("B"),
            c_manifest=_gated_manifest("C"),
            b_rows=_c_rows(),
            c_rows=_c_rows(),
            entries=_entries(),
            created_utc=CREATED,
        )
    assert failed.value.reason == "wrong_leg"


def test_e02_refuses_a_thresholds_artifact_of_another_lineage():
    thresholds = _signed_thresholds()
    thresholds["reference_manifest_sha256"] = "9" * 64
    with pytest.raises(E02Refusal) as failed:
        build_e02_report(
            b_manifest=_gated_manifest("B"),
            c_manifest=_gated_manifest("C"),
            b_rows=_b_rows(),
            c_rows=_c_rows(),
            entries=_entries(),
            thresholds=thresholds,
            created_utc=CREATED,
        )
    assert failed.value.reason == "thresholds_lineage_mismatch"


def test_e02_refuses_an_unsigned_thresholds_artifact():
    thresholds = _signed_thresholds()
    thresholds["signed"] = False
    with pytest.raises(E02Refusal) as failed:
        build_e02_report(
            b_manifest=_gated_manifest("B"),
            c_manifest=_gated_manifest("C"),
            b_rows=_b_rows(),
            c_rows=_c_rows(),
            entries=_entries(),
            thresholds=thresholds,
            created_utc=CREATED,
        )
    assert failed.value.reason == "thresholds_not_signed"


def test_e02_refuses_a_missing_leg_artifact():
    with pytest.raises(E02Refusal) as failed:
        build_e02_report(
            b_manifest=_gated_manifest("B"),
            c_manifest=_gated_manifest("C"),
            b_rows={},
            c_rows=_c_rows(),
            entries=_entries(),
            created_utc=CREATED,
        )
    assert failed.value.reason == "missing_artifact"


# ---------------------------------------------------------------------------
# The CLI
# ---------------------------------------------------------------------------


def _write(tmp_path, name, payload):
    path = tmp_path / name
    path.write_text(json.dumps(payload), encoding="utf-8")
    return str(path)


def test_e02_cli_writes_the_report(tmp_path, capsys):
    args = argparse.Namespace(
        b_manifest=_write(tmp_path, "config-b.manifest.json", _gated_manifest("B")),
        c_manifest=_write(tmp_path, "config-c.manifest.json", _gated_manifest("C")),
        b_rows=_write(tmp_path, "config-b.rows.json", {"cases": _b_rows()}),
        c_rows=_write(tmp_path, "config-c.rows.json", {"cases": _c_rows()}),
        set_path=None,
        reference_manifest=None,
        thresholds=None,
        correctness_ledger=None,
        out=str(tmp_path / "e02.report.json"),
        created_utc=CREATED,
        seed=42,
    )
    assert cmd_e02(args) == 0
    written = json.loads((tmp_path / "e02.report.json").read_text(encoding="utf-8"))
    assert written["artifact"] == "e02-report"
    assert written["digest"]
    assert "e02 verdict" in capsys.readouterr().out


def test_e02_cli_exits_1_on_a_refusal(tmp_path, capsys):
    args = argparse.Namespace(
        b_manifest=_write(tmp_path, "config-b.manifest.json", _gated_manifest("B")),
        c_manifest=_write(tmp_path, "config-c.manifest.json", _gated_manifest("C", corpus="d" * 64)),
        b_rows=_write(tmp_path, "config-b.rows.json", {"cases": _b_rows()}),
        c_rows=_write(tmp_path, "config-c.rows.json", {"cases": _c_rows()}),
        set_path=None,
        reference_manifest=None,
        thresholds=None,
        correctness_ledger=None,
        out=str(tmp_path / "e02.report.json"),
        created_utc=CREATED,
        seed=None,
    )
    assert cmd_e02(args) == 1
