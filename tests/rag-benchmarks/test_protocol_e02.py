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
* an absent threshold is recorded as absent with its blocking reason, a bound
  scoped to another configuration is NOT APPLICABLE, a bound the surface does
  not carry is NOT MEASURABLE, and a bound with no comparable direction or
  threshold is UNINTERPRETABLE — never applied across surfaces, never a pass,
  never a breach nobody measured;
* the verdict is a B-vs-C comparison: a bound the FIXED pipeline breaks is its
  own state, a bound the AGENT breaks (or a coverage below the fixed
  pipeline's) is a regression;
* the report refuses — before building — on a lineage mismatch, a wrong-leg
  manifest, legs gated against different predecessors or thresholds, a
  thresholds artifact that is not the one the legs were gated under, and an
  assessment set that is not the one the legs ran against;
* every row the report writes is redacted at every depth;
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


def _thresholds(
    *,
    scope="config A — the chunk/passage-level anchor metrics",
    metrics=None,
    corpus=CORPUS,
    set_sha=SET_SHA,
    reference=None,
    value="default",
):
    """A signed thresholds artifact in the registry's derived shape."""
    reference = reference or _reference_manifest()
    if value == "default":
        value = {
            "scope": scope,
            "metrics": metrics
            if metrics is not None
            else {
                "retrieval_recall": {"operator": ">=", "threshold": 0.95},
                "noise": {"operator": "<=", "threshold": 0.8},
            },
        }
    return {
        "artifact": "evaluation-thresholds",
        "signed": True,
        "corpus_fingerprint": corpus,
        "assessment_set_sha256": set_sha,
        "reference_manifest_sha256": manifest_digest(reference),
        "thresholds": {
            "M-1": {
                "value": value,
                "dimension": "retrieval_quality",
                "surface": scope,
                "rationale": "signed against the measured reference",
                "agreement_date": "2026-11-23",
            }
        },
    }


def _legs(*, thresholds=None, corpus=CORPUS, set_sha=SET_SHA, reference=None):
    """The two gated legs, sharing the predecessor AND the signed thresholds
    the gate selected (the lineage the report verifies)."""
    reference = reference or _reference_manifest()
    lineage = {
        "reference_manifest_sha256": manifest_digest(reference),
        "thresholds_sha256": sha256_json(thresholds) if thresholds is not None else "t" * 64,
    }

    def _leg(config, pair):
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
            lineage=lineage,
            pair=pair,
            created_utc=CREATED,
        )

    return _leg("B", "E01"), _leg("C", "E02")


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


def _report(*, thresholds=None, b_rows=None, c_rows=None, entries=None, **kwargs):
    legs = _legs(thresholds=thresholds)
    return build_e02_report(
        b_manifest=legs[0],
        c_manifest=legs[1],
        b_rows=b_rows if b_rows is not None else _b_rows(),
        c_rows=c_rows if c_rows is not None else _c_rows(),
        entries=entries if entries is not None else _entries(),
        set_sha256=SET_SHA,
        thresholds=thresholds,
        created_utc=CREATED,
        **kwargs,
    )


# ---------------------------------------------------------------------------
# The report
# ---------------------------------------------------------------------------


def test_e02_report_reports_m1_to_m5_for_both_legs():
    report = _report()
    assert set(report["dimensions"]) == {"M-1", "M-2", "M-3", "M-4", "M-5"}
    for record in report["dimensions"].values():
        assert set(record) == {"dimension", "B", "C"}
        for leg in ("B", "C"):
            assert record[leg]["measurement_surface"]
            assert "available" in record[leg]
    assert report["dimensions"]["M-1"]["B"]["measurement_surface"].startswith("doc-level")
    assert report["dimensions"]["M-1"]["C"]["measurement_surface"].startswith("doc-level")


def test_e02_report_publishes_no_abstention_count_for_a_leg_that_carries_none():
    """Config C carries no mechanical abstention flag: publishing a zero would
    be a fabricated measurement, and a signed bound would compare against it."""
    report = _report()
    c_values = report["dimensions"]["M-3"]["C"]["values"]
    assert "n_rows_with_abstention_fact" not in c_values
    assert any("no mechanical abstention flag" in note for note in report["dimensions"]["M-3"]["C"]["notes"])


def test_e02_report_carries_the_costs_as_first_class_records():
    report = _report()
    metrics = report["costs"]["counter_metrics"]
    assert set(metrics) == {"CM-1", "CM-2", "CM-3"}
    # CM-1's per-request delta is visible, not averaged away.
    assert metrics["CM-1"]["values"]["latency_delta"]["per_request"]
    # CM-2's denominator is a judge-layer fact — absent is recorded, never zero.
    assert metrics["CM-2"].get("available") is False
    assert metrics["CM-2"].get("not_available_reason")


def test_e02_report_records_the_gains_per_query_class():
    report = _report()
    per_class = report["gains"]["per_class"]
    assert "multi_hop" in per_class
    assert per_class["multi_hop"]["n_cases_in_set"] == 1
    assert per_class["multi_hop"]["delta"]["answered"] == 0
    assert per_class["multi_hop"]["B"]["latency"]["median"] == 100.0
    assert per_class["multi_hop"]["C"]["latency"]["median"] == 400.0
    assert per_class["multi_hop"]["delta"]["median_latency_ms"] == 300.0


def test_e02_report_records_the_classes_the_set_does_not_carry_as_not_covered():
    report = _report()
    not_covered = {entry["query_class"] for entry in report["gains"]["not_covered"]}
    assert not_covered == {"ambiguous"}
    assert "HYPOTHESIS" in report["gains"]["not_covered"][0]["reason"]


def test_e02_report_counts_an_admission_refusal_apart_from_a_failure():
    """The counter-metrics vocabulary counts an admission refusal as neither a
    failure nor a limit hit — the report must not contradict its own CM-3."""
    c_rows = _c_rows()
    c_rows["c2"] = dict(c_rows["c2"], outcome="admission_refused")
    report = _report(c_rows=c_rows)
    multi_hop = report["gains"]["per_class"]["multi_hop"]
    assert multi_hop["C"]["n_admission_refused"] == 0  # c2 is the unanswerable class
    assert report["gains"]["per_class"]["unanswerable"]["C"]["n_admission_refused"] == 1
    assert report["gains"]["per_class"]["unanswerable"]["C"]["n_failed"] == 0


def test_e02_report_records_an_absent_threshold_with_its_blocking_reason():
    report = _report()
    for record in report["dimensions"].values():
        for leg in ("B", "C"):
            threshold = record[leg]["threshold"]
            assert threshold["status"] == "absent"
            assert threshold["reason"]
            assert threshold["bounds"] == []
    assert report["verdict"]["state"] == "unassessable"


def test_e02_report_does_not_apply_a_bound_scoped_to_another_configuration():
    thresholds = _thresholds()
    report = _report(thresholds=thresholds)
    threshold = report["dimensions"]["M-1"]["B"]["threshold"]
    assert threshold["status"] == "not_applicable"
    assert threshold["scope"].startswith("config A")
    assert {bound["outcome"] for bound in threshold["bounds"]} == {"not_applicable"}
    assert all(bound["measured"] is None for bound in threshold["bounds"])


def test_e02_report_applies_a_bound_the_surface_carries():
    thresholds = _thresholds(
        scope="the E02 doc-level surface",
        metrics={"n_rows_with_source_documents": {"operator": ">=", "threshold": 1}},
    )
    report = _report(thresholds=thresholds)
    threshold = report["dimensions"]["M-1"]["B"]["threshold"]
    assert threshold["status"] == "applied"
    assert threshold["bounds"][0]["outcome"] == "pass"
    assert threshold["bounds"][0]["measured"] == 1


def test_e02_report_applies_a_single_bound_that_names_its_metric():
    thresholds = _thresholds(
        scope="the E02 doc-level surface",
        value={"metric": "n_rows_with_source_documents", "operator": ">=", "threshold": 1},
    )
    report = _report(thresholds=thresholds)
    threshold = report["dimensions"]["M-1"]["B"]["threshold"]
    assert threshold["status"] == "applied"
    assert threshold["bounds"][0]["metric"] == "n_rows_with_source_documents"
    assert threshold["bounds"][0]["outcome"] == "pass"


def test_e02_report_records_a_bound_with_no_comparable_threshold_as_uninterpretable():
    thresholds = _thresholds(
        scope="the E02 doc-level surface",
        metrics={"n_rows_with_source_documents": {"operator": ">=", "threshold": "one"}},
    )
    report = _report(thresholds=thresholds)
    threshold = report["dimensions"]["M-1"]["B"]["threshold"]
    assert threshold["status"] == "uninterpretable"
    assert threshold["bounds"][0]["outcome"] == "uninterpretable"
    # An uninterpretable bound is never a breach: it blocks.
    assert report["verdict"]["state"] == "unassessable"


def test_e02_report_records_an_empty_bound_set_as_absent():
    thresholds = _thresholds(scope="the E02 doc-level surface", value={"scope": "x", "metrics": {}})
    report = _report(thresholds=thresholds)
    threshold = report["dimensions"]["M-1"]["B"]["threshold"]
    assert threshold["status"] == "absent"
    assert threshold["bounds"] == []


def test_e02_report_records_a_null_signed_value_as_absent():
    thresholds = _thresholds(scope="the E02 doc-level surface", value=None)
    report = _report(thresholds=thresholds)
    threshold = report["dimensions"]["M-1"]["B"]["threshold"]
    assert threshold["status"] == "absent"
    assert report["thresholds"]["scope"] is None


def test_e02_report_publishes_the_same_cost_shape_on_both_legs():
    report = _report()
    b_values = report["dimensions"]["M-5"]["B"]["values"]
    c_values = report["dimensions"]["M-5"]["C"]["values"]
    assert set(b_values) == set(c_values) == {"model_calls", "prompt_tokens", "n_rows_contributing"}
    # The RUN's cost, not one case's spend.
    assert b_values["model_calls"] == 1
    assert c_values["model_calls"] == 5
    assert b_values["n_rows_contributing"] == 1
    assert c_values["n_rows_contributing"] == 2


def test_e02_report_compares_the_two_legs_on_the_shared_metrics():
    report = _report()
    comparison = report["verdict"]["per_dimension"]["M-1"]["comparison"]
    assert comparison["available"] is True
    assert comparison["metrics"]["n_rows"]["B"] == 2
    assert comparison["metrics"]["n_rows"]["C"] == 2
    assert comparison["metrics"]["n_rows_with_source_documents"]["delta"] == 0


def test_e02_verdict_never_reads_the_fixed_pipelines_bound_failure_as_the_agents():
    """A bound the FIXED pipeline breaks is its own state — the agent's verdict
    must not be flipped by it."""
    thresholds = _thresholds(
        scope="the E02 doc-level surface",
        metrics={"n_rows_with_source_documents": {"operator": ">=", "threshold": 1}},
    )
    b_rows = _b_rows()
    b_rows["c1"] = dict(b_rows["c1"], source_documents=[])
    report = _report(thresholds=thresholds, b_rows=b_rows)
    assert report["verdict"]["fixed_pipeline_bound_failures"]
    assert not report["verdict"]["agent_bound_failures"]
    assert report["verdict"]["state"] != "not_supported"


def test_e02_verdict_is_not_supported_when_the_agent_breaks_a_bound():
    thresholds = _thresholds(
        scope="the E02 doc-level surface",
        metrics={"n_rows_with_source_documents": {"operator": ">=", "threshold": 2}},
    )
    report = _report(thresholds=thresholds)
    assert report["verdict"]["agent_bound_failures"]
    assert report["verdict"]["state"] == "not_supported"


def test_e02_verdict_is_not_supported_when_the_agent_covers_less():
    c_rows = _c_rows()
    c_rows["c2"] = dict(c_rows["c2"], outcome="admission_refused")
    report = _report(c_rows=c_rows)
    assert report["verdict"]["coverage"]["delta"] == -1
    assert report["verdict"]["state"] == "not_supported"


def test_e02_verdict_is_supported_when_the_agent_gains_a_class_and_breaks_no_bound():
    thresholds = _thresholds(
        scope="the E02 doc-level surface",
        metrics={"n_rows_with_source_documents": {"operator": ">=", "threshold": 1}},
    )
    c_rows = _c_rows()
    c_rows["c3"] = dict(
        c_rows["c3"],
        outcome="answered",
        answer="the agent recovered the failing case",
        source_documents=["doc-1"],
        usage_record={"model_calls": 1, "prompt_tokens": 5},
    )
    report = _report(thresholds=thresholds, c_rows=c_rows)
    assert report["verdict"]["classes_with_a_gain"]
    assert report["verdict"]["state"] == "supported"


def test_e02_report_redacts_the_rows_it_writes():
    b_rows = _b_rows()
    b_rows["c1"] = dict(b_rows["c1"], metadata={"api_key": "sk-SECRET", "usage": {"model_calls": 1}})
    report = _report(b_rows=b_rows)
    written = report["per_case"]["c1"]["b"]
    assert "api_key" not in written["metadata"]
    assert "api_key" not in json.dumps(report)


def test_e02_report_compares_the_model_ids_and_the_prompt_digests():
    report = _report()
    uncontrolled = report["uncontrolled_differences"]
    assert uncontrolled["model_ids"]["state"] == "identical"
    assert uncontrolled["prompt_digests"]["state"] == "not_recorded"
    assert uncontrolled["resolved_env"]["state"] == "identical"


def test_e02_report_reproduces_under_a_pinned_created_utc():
    first = _report()
    second = _report()
    assert first["digest"] == second["digest"]
    assert e02_report_digest(first) == first["digest"]


def test_e02_report_digests_every_input():
    b_manifest, c_manifest = _legs()
    report = build_e02_report(
        b_manifest=b_manifest,
        c_manifest=c_manifest,
        b_rows=_b_rows(),
        c_rows=_c_rows(),
        entries=_entries(),
        set_sha256=SET_SHA,
        created_utc=CREATED,
    )
    inputs = report["inputs"]
    assert inputs["b_manifest_sha256"] == manifest_digest(b_manifest)
    assert inputs["c_manifest_sha256"] == manifest_digest(c_manifest)
    assert inputs["b_rows_sha256"] == sha256_json(_b_rows())
    assert inputs["corpus_fingerprint"] == CORPUS
    assert inputs["assessment_set_sha256"] == SET_SHA
    assert inputs["assessment_set_digest_supplied"] == SET_SHA


# ---------------------------------------------------------------------------
# The refusals
# ---------------------------------------------------------------------------


def test_e02_refuses_a_corpus_mismatch_between_the_legs():
    b_manifest, _ = _legs()
    _, c_manifest = _legs(corpus="d" * 64)
    with pytest.raises(E02Refusal) as failed:
        build_e02_report(
            b_manifest=b_manifest,
            c_manifest=c_manifest,
            b_rows=_b_rows(),
            c_rows=_c_rows(),
            entries=_entries(),
            set_sha256=SET_SHA,
            created_utc=CREATED,
        )
    assert failed.value.reason == "lineage_mismatch"


def test_e02_refuses_a_wrong_leg_manifest():
    b_manifest, _ = _legs()
    with pytest.raises(E02Refusal) as failed:
        build_e02_report(
            b_manifest=b_manifest,
            c_manifest=b_manifest,
            b_rows=_b_rows(),
            c_rows=_c_rows(),
            entries=_entries(),
            set_sha256=SET_SHA,
            created_utc=CREATED,
        )
    assert failed.value.reason == "wrong_leg"


def test_e02_refuses_legs_gated_against_different_predecessors():
    b_manifest, _ = _legs()
    _, c_manifest = _legs(reference=_reference_manifest())
    c_manifest["lineage"]["reference_manifest_sha256"] = "9" * 64
    with pytest.raises(E02Refusal) as failed:
        build_e02_report(
            b_manifest=b_manifest,
            c_manifest=c_manifest,
            b_rows=_b_rows(),
            c_rows=_c_rows(),
            entries=_entries(),
            set_sha256=SET_SHA,
            created_utc=CREATED,
        )
    assert failed.value.reason == "lineage_mismatch"


def test_e02_refuses_rows_of_another_leg():
    b_manifest, c_manifest = _legs()
    with pytest.raises(E02Refusal) as failed:
        build_e02_report(
            b_manifest=b_manifest,
            c_manifest=c_manifest,
            b_rows=_c_rows(),
            c_rows=_c_rows(),
            entries=_entries(),
            set_sha256=SET_SHA,
            created_utc=CREATED,
        )
    assert failed.value.reason == "wrong_leg"


def test_e02_refuses_a_thresholds_artifact_that_is_not_the_one_the_legs_were_gated_under():
    thresholds = _thresholds()
    b_manifest, c_manifest = _legs(thresholds=thresholds)
    re_signed = dict(thresholds)
    re_signed["thresholds"] = dict(thresholds["thresholds"])
    re_signed["thresholds"]["M-1"] = dict(thresholds["thresholds"]["M-1"])
    re_signed["thresholds"]["M-1"]["value"] = {"scope": "x", "metrics": {}}
    with pytest.raises(E02Refusal) as failed:
        build_e02_report(
            b_manifest=b_manifest,
            c_manifest=c_manifest,
            b_rows=_b_rows(),
            c_rows=_c_rows(),
            entries=_entries(),
            set_sha256=SET_SHA,
            thresholds=re_signed,
            created_utc=CREATED,
        )
    assert failed.value.reason == "thresholds_lineage_mismatch"


def test_e02_refuses_an_unsigned_thresholds_artifact():
    thresholds = _thresholds()
    thresholds["signed"] = False
    b_manifest, c_manifest = _legs(thresholds=thresholds)
    with pytest.raises(E02Refusal) as failed:
        build_e02_report(
            b_manifest=b_manifest,
            c_manifest=c_manifest,
            b_rows=_b_rows(),
            c_rows=_c_rows(),
            entries=_entries(),
            set_sha256=SET_SHA,
            thresholds=thresholds,
            created_utc=CREATED,
        )
    assert failed.value.reason == "thresholds_not_signed"


def test_e02_refuses_an_assessment_set_the_legs_did_not_run_against():
    b_manifest, c_manifest = _legs()
    with pytest.raises(E02Refusal) as failed:
        build_e02_report(
            b_manifest=b_manifest,
            c_manifest=c_manifest,
            b_rows=_b_rows(),
            c_rows=_c_rows(),
            entries=_entries(),
            set_sha256="e" * 64,
            created_utc=CREATED,
        )
    assert failed.value.reason == "lineage_mismatch"


def test_e02_refuses_a_missing_leg_artifact():
    b_manifest, c_manifest = _legs()
    with pytest.raises(E02Refusal) as failed:
        build_e02_report(
            b_manifest=b_manifest,
            c_manifest=c_manifest,
            b_rows={},
            c_rows=_c_rows(),
            entries=_entries(),
            set_sha256=SET_SHA,
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


def _assessment_case(id_, query, case_class, access="public", **extra):
    return {
        "id": id_,
        "query": query,
        "categoryLabels": [],
        "serviceLabels": [],
        "language": "en",
        "reference_answer": "",
        "expected_chunks": [],
        "case_class": case_class,
        "access_scenario": access,
        "provenance": "assessment",
        **extra,
    }


def _assessment_set(tmp_path):
    """A composition-VALID assessment set file (the CLI validates it before the
    report is built — the composition floor rides the data path)."""
    entries = [
        _assessment_case("c1", "q1", "answerable"),
        _assessment_case("c2", "q2", "unanswerable"),
        _assessment_case("c3", "q3", "failure"),
        _assessment_case("c4", "q4", "citation_check"),
        _assessment_case("c5", "q5", "answerable", access="restricted"),
        _assessment_case("c6", "q6", "representative_language"),
        _assessment_case(
            "c7", "q7", "representative_language", script="non-latin", language="ru"
        ),
        _assessment_case("c8", "q8", "cancellation"),
        _assessment_case(
            "c9", "q9", "answerable", access="restricted", security_scenario="restricted_repo"
        ),
        _assessment_case(
            "c10", "q10", "answerable", security_scenario="cross_user_id"
        ),
        _assessment_case(
            "c11", "q11", "answerable", security_scenario="cross_user_id"
        ),
        _assessment_case(
            "c12", "q12", "answerable", security_scenario="narrowed_scope"
        ),
        _assessment_case(
            "c13",
            "q13",
            "answerable",
            access="restricted",
            security_scenario="permission_change",
            turns=[{"query": "turn one"}, {"query": "turn two"}],
        ),
        _assessment_case(
            "c14", "q14", "answerable", security_scenario="injection_document"
        ),
        _assessment_case(
            "c15", "q15", "answerable", security_scenario="injection_tool_output"
        ),
    ]
    return _write(
        tmp_path,
        "assessment-set.json",
        {"_doc": "fixture", "_meta": {"provenance": "assessment"}, "entries": entries},
    )


def test_e02_cli_writes_the_report(tmp_path, capsys):
    set_path = _assessment_set(tmp_path)
    b_manifest, c_manifest = _legs(set_sha=_file_sha(set_path))
    args = argparse.Namespace(
        b_manifest=_write(tmp_path, "config-b.manifest.json", b_manifest),
        c_manifest=_write(tmp_path, "config-c.manifest.json", c_manifest),
        b_rows=_write(tmp_path, "config-b.rows.json", {"cases": _b_rows()}),
        c_rows=_write(tmp_path, "config-c.rows.json", {"cases": _c_rows()}),
        set_path=set_path,
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


def _file_sha(path):
    import hashlib

    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def test_e02_cli_exits_1_on_a_refusal(tmp_path):
    b_manifest, _ = _legs()
    _, c_manifest = _legs(corpus="d" * 64)
    args = argparse.Namespace(
        b_manifest=_write(tmp_path, "config-b.manifest.json", b_manifest),
        c_manifest=_write(tmp_path, "config-c.manifest.json", c_manifest),
        b_rows=_write(tmp_path, "config-b.rows.json", {"cases": _b_rows()}),
        c_rows=_write(tmp_path, "config-c.rows.json", {"cases": _c_rows()}),
        set_path=_assessment_set(tmp_path),
        reference_manifest=None,
        thresholds=None,
        correctness_ledger=None,
        out=str(tmp_path / "e02.report.json"),
        created_utc=CREATED,
        seed=None,
    )
    assert cmd_e02(args) == 1


# ---------------------------------------------------------------------------
# Round 2 — the corrections the FIX-REVIEW validated
# ---------------------------------------------------------------------------


def test_e02_counts_multi_turn_rows_in_their_case_class():
    """A multi-turn case's rows are keyed <case_id>#t<n>: dropping the turn
    suffix is the only way a turn row lands in its case's class — dropping the
    rows would silently shrink the census and the coverage comparison."""
    entries = _entries() + [
        {"id": "m1", "case_class": "answerable", "expectations": {"query_class": "multi_hop"}, "turns": [{"query": "t1"}, {"query": "t2"}]}
    ]
    c_rows = _c_rows()
    c_rows["m1#t1"] = {"case_id": "m1#t1", "outcome": "answered", "answer": "a", "wall_ms": 10.0}
    c_rows["m1#t2"] = {"case_id": "m1#t2", "outcome": "answered", "answer": "a", "wall_ms": 10.0}
    report = _report(entries=entries, c_rows=c_rows)
    multi_hop = report["gains"]["per_class"]["multi_hop"]
    assert multi_hop["n_cases_in_set"] == 2
    assert multi_hop["n_rows_recorded"]["C"] == 3  # c1 + the two turn rows
    assert multi_hop["delta"]["answered"] == 2


def test_e02_does_not_count_a_budget_exhausted_row_as_answered():
    """A row whose terminal state is a limit hit is not an answer — counting
    it as one inflates the fixed pipeline's coverage and can deny the agent a
    measured regression it did not earn."""
    b_rows = _b_rows()
    b_rows["c1"] = dict(b_rows["c1"], abstention_reason="result_budget_exhausted")
    report = _report(b_rows=b_rows)
    # c1 is the multi_hop class in the fixture; the fixed pipeline's answer
    # there is now a limit hit.
    multi_hop = report["gains"]["per_class"]["multi_hop"]
    assert multi_hop["B"]["n_limit_hit"] == 1
    assert multi_hop["B"]["n_answered"] == 0
    assert multi_hop["delta"]["answered"] == 1


def test_e02_fails_closed_on_a_scope_spelling_it_cannot_parse():
    """A scope that mentions a configuration in a spelling the harness cannot
    parse names NO leg: the bound is not applied to any leg — an unapplied
    bound blocks, a wrongly applied one would compare two surfaces."""
    for scope in ("configuration: A — chunk metrics", "config (A) — chunk metrics"):
        thresholds = _thresholds(scope=scope)
        report = _report(thresholds=thresholds)
        for leg in ("B", "C"):
            threshold = report["dimensions"]["M-1"][leg]["threshold"]
            assert threshold["status"] == "uninterpretable", scope
            assert threshold["bounds"][0]["outcome"] == "uninterpretable"


def test_e02_records_a_bound_failure_masked_by_a_sibling_bound():
    """A measured breach must not be masked by a sibling bound the surface
    cannot measure: the failure is read off the bounds, not the status."""
    thresholds = _thresholds(
        scope="the E02 doc-level surface",
        metrics={
            "n_rows_with_source_documents": {"operator": ">=", "threshold": 9},
            "retrieval_recall": {"operator": ">=", "threshold": 0.95},
        },
    )
    report = _report(thresholds=thresholds)
    threshold = report["dimensions"]["M-1"]["C"]["threshold"]
    assert threshold["status"] == "not_measurable"
    assert report["verdict"]["agent_bound_failures"] == [{"dimension": "M-1", "leg": "C"}]
    assert report["verdict"]["state"] == "not_supported"


def test_e02_recognizes_the_canonical_scope_spelling():
    """The recognized spellings (config A / config-A / configuration A /
    Config. A) all name the configuration and transfer to NO other leg."""
    for scope in (
        "config A — the chunk/passage-level anchor metrics",
        "config-A — the chunk/passage-level anchor metrics",
        "configuration A — the chunk/passage-level anchor metrics",
        "Config. A — the chunk/passage-level anchor metrics",
    ):
        thresholds = _thresholds(scope=scope)
        report = _report(thresholds=thresholds)
        for leg in ("B", "C"):
            assert report["dimensions"]["M-1"][leg]["threshold"]["status"] == "not_applicable", scope
