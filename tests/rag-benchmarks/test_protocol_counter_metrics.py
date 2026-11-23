# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for protocol/counter_metrics.py (+ the counters CLI wiring).

Every counter-metric row of the module's matrix through fixture rows (no live
venue, no deployment case content):

* CM-1 records the PER-REQUEST cost/latency delta against the reference, the
  distribution over those deltas and the agentic cost surface — one average
  never stands in for the delta;
* a reference without a cost surface records the cost side as unavailable WITH
  its reason, and the latency delta is still reported;
* CM-2 is NOT computable without a lineage-verified reference-correctness
  ledger — the rate is never reported as zero — and it is the candidate's
  abstentions over the reference-correct cases when the ledger is there;
* CM-3 records the limit/cancellation rate with the per-case terminal states,
  and a zero rate with the execution count when every execution answered;
* the report digests identically under the same inputs and a pinned
  created_utc.
"""

import argparse
import json
from pathlib import Path

import pytest

from protocol.counter_metrics import (
    CounterMetricsRefusal,
    build_counter_metrics_report,
    counter_metrics_report_digest,
    reference_correctness_file,
)
from protocol.manifest import build_manifest
from protocol.run_protocol import cmd_counters, main

EVALUATOR_INSTRUCTIONS = Path(__file__).resolve().parent / "protocol" / "evaluator-instructions.md"
CORPUS = "c" * 64
SET_SHA = "a" * 64
CREATED = "2026-11-23T00:00:00+00:00"


# ---------------------------------------------------------------------------
# Fixtures — fixture rows, a synthetic reference manifest
# ---------------------------------------------------------------------------


def _usage(*, model_calls=2, prompt_tokens=100, completion_tokens=20, outcome="answered") -> dict:
    """The agentic cost surface of one run (the RunUsageRecord's shape)."""
    return {
        "run_id": "run-1",
        "outcome": outcome,
        "steps": 3,
        "model_calls": model_calls,
        "aux_model_calls": 0,
        "tool_calls": 1,
        "evidence_bytes": 128,
        "prompt_tokens": prompt_tokens,
        "completion_tokens": completion_tokens,
        "wall_clock_seconds": 1.5,
    }


def _reference_row(case_id: str, wall_ms: float, **extra) -> dict:
    return {"case_id": case_id, "status": "ok", "wall_ms": wall_ms, **extra}


def _candidate_row(case_id: str, wall_ms: float, **extra) -> dict:
    return {"case_id": case_id, "outcome": "answered", "wall_ms": wall_ms, **extra}


def _reference_manifest() -> dict:
    return build_manifest(
        kind="reference",
        config="A",
        corpus={"source_collection": "COLL", "arango_graph_name": "G", "fingerprint": CORPUS},
        sets={"assessment": {"path": "sets/assessment.json", "sha256": SET_SHA}},
        configuration={"A": {"resolved_env": {}, "model_ids": {}, "prompt_digests": {}}},
        evaluator_instructions_path=EVALUATOR_INSTRUCTIONS,
        created_utc=CREATED,
    )


def _write_rows(path: Path, rows: dict) -> Path:
    path.write_text(json.dumps({"cases": rows}), encoding="utf-8")
    return path


# ---------------------------------------------------------------------------
# CM-1 — the per-request cost and latency delta
# ---------------------------------------------------------------------------


def test_cm1_records_the_per_request_deltas_and_the_agentic_cost_surface():
    reference = {
        "c1": _reference_row("c1", 100.0, usage_record=_usage(model_calls=1)),
        "c2": _reference_row("c2", 200.0, usage_record=_usage(model_calls=1)),
    }
    candidate = {
        "c1": _candidate_row("c1", 150.0, usage_record=_usage(model_calls=3)),
        "c2": _candidate_row("c2", 260.0, usage_record=_usage(model_calls=4)),
    }
    report = build_counter_metrics_report(
        reference_rows=reference, candidate_rows=candidate, created_utc=CREATED
    )
    cm1 = report["counter_metrics"]["CM-1"]
    assert cm1["available"] is True
    assert cm1["measurement_surface"]
    latency = cm1["values"]["latency_delta"]
    assert latency["available"] is True
    assert [row["delta_ms"] for row in latency["per_request"]] == [50.0, 60.0]
    assert latency["per_request"][0]["reference_wall_ms"] == 100.0
    assert latency["per_request"][0]["candidate_wall_ms"] == 150.0
    assert latency["distribution"]["n"] == 2
    assert latency["distribution"]["min"] == 50.0
    assert latency["distribution"]["max"] == 60.0
    agentic = cm1["values"]["agentic_cost_surface"]
    assert agentic["available"] is True
    assert agentic["totals"]["model_calls"] == {"sum": 7, "n_rows": 2}
    assert agentic["per_request"][0]["case_id"] == "c1"
    assert cm1["values"]["cost_delta"]["available"] is True


def test_cm1_sums_the_counters_the_rows_actually_carry():
    """A row that records no token count contributes nothing to that counter —
    the counter it does not carry is absent from the totals, not zero."""
    candidate = {
        "c1": _candidate_row("c1", 150.0, usage_record={"outcome": "answered", "model_calls": 3}),
        "c2": _candidate_row("c2", 250.0, usage_record=_usage(model_calls=2)),
    }
    report = build_counter_metrics_report(
        reference_rows={"c1": _reference_row("c1", 100.0), "c2": _reference_row("c2", 200.0)},
        candidate_rows=candidate,
        created_utc=CREATED,
    )
    cm1 = report["counter_metrics"]["CM-1"]
    agentic = cm1["values"]["agentic_cost_surface"]
    assert agentic["available"] is True
    assert agentic["totals"]["model_calls"] == {"sum": 5, "n_rows": 2}
    # only the second row carries a token count — the total names how many
    # rows contributed, so it never reads as the whole.
    assert agentic["totals"]["prompt_tokens"] == {"sum": 100, "n_rows": 1}


def test_cm1_records_the_cost_side_as_unavailable_when_the_reference_has_none():
    reference = {"c1": _reference_row("c1", 100.0)}
    candidate = {"c1": _candidate_row("c1", 150.0, usage_record=_usage())}
    report = build_counter_metrics_report(
        reference_rows=reference, candidate_rows=candidate, created_utc=CREATED
    )
    cm1 = report["counter_metrics"]["CM-1"]
    assert cm1["available"] is True
    cost_delta = cm1["values"]["cost_delta"]
    assert cost_delta["available"] is False
    assert cost_delta["not_available_reason"]
    assert "reference rows carry no resource fields" in cost_delta["not_available_reason"]
    # the latency delta is still reported
    assert cm1["values"]["latency_delta"]["available"] is True
    assert cm1["values"]["latency_delta"]["per_request"][0]["delta_ms"] == 50.0


def test_cm1_is_not_computable_without_a_paired_wall_ms():
    report = build_counter_metrics_report(
        reference_rows={"c1": _reference_row("c1", 100.0)},
        candidate_rows={"c2": _candidate_row("c2", 150.0)},
        created_utc=CREATED,
    )
    cm1 = report["counter_metrics"]["CM-1"]
    assert cm1["available"] is False
    assert cm1["not_available_reason"]


def test_cm1_keeps_the_cost_surface_when_the_latency_delta_is_absent():
    """An absent surface is recorded as absent WITH its reason — it never
    drags the surface beside it down with it."""
    # the candidate row carries no wall_ms -> no latency delta
    report = build_counter_metrics_report(
        reference_rows={"c1": _reference_row("c1", 100.0, usage_record=_usage(model_calls=1))},
        candidate_rows={
            "c1": {"case_id": "c1", "outcome": "answered", "usage_record": _usage(model_calls=3)}
        },
        created_utc=CREATED,
    )
    cm1 = report["counter_metrics"]["CM-1"]
    assert cm1["available"] is True
    assert cm1["values"]["latency_delta"]["available"] is False
    assert cm1["values"]["latency_delta"]["not_available_reason"]
    assert cm1["values"]["agentic_cost_surface"]["available"] is True


# ---------------------------------------------------------------------------
# CM-2 — the excessive-abstention rate
# ---------------------------------------------------------------------------


def test_cm2_is_not_computable_without_the_correctness_ledger():
    candidate = {"c1": {"case_id": "c1", "status": "ok", "abstained": True}}
    report = build_counter_metrics_report(
        reference_rows={}, candidate_rows=candidate, created_utc=CREATED
    )
    cm2 = report["counter_metrics"]["CM-2"]
    assert cm2["available"] is False
    assert cm2["not_available_reason"]
    assert "values" not in cm2
    assert cm2["measurement_surface"]


def test_cm2_computes_the_rate_over_the_reference_correct_cases():
    candidate = {
        "c1": {"case_id": "c1", "status": "ok", "abstained": True},
        "c2": {"case_id": "c2", "status": "ok", "abstained": False},
        "c3": {"case_id": "c3", "status": "ok", "abstained": True},
    }
    reference_manifest = _reference_manifest()
    ledger = reference_correctness_file(
        corpus_fingerprint=CORPUS,
        assessment_set_sha256=SET_SHA,
        reference_manifest=reference_manifest,
        correct_case_ids=["c1", "c2", "c3"],
    )
    report = build_counter_metrics_report(
        reference_rows={},
        candidate_rows=candidate,
        reference_manifest=reference_manifest,
        correctness_ledger=ledger,
        created_utc=CREATED,
    )
    cm2 = report["counter_metrics"]["CM-2"]
    assert cm2["available"] is True
    assert cm2["values"]["n_reference_correct_cases"] == 3
    assert cm2["values"]["n_candidate_abstentions"] == 2
    assert cm2["values"]["rate"] == pytest.approx(2 / 3)


def test_cm2_is_not_computable_when_the_candidate_records_no_abstention_fact():
    candidate = {"c1": {"case_id": "c1", "status": "ok"}}
    reference_manifest = _reference_manifest()
    ledger = reference_correctness_file(
        corpus_fingerprint=CORPUS,
        assessment_set_sha256=SET_SHA,
        reference_manifest=reference_manifest,
        correct_case_ids=["c1"],
    )
    report = build_counter_metrics_report(
        reference_rows={},
        candidate_rows=candidate,
        reference_manifest=reference_manifest,
        correctness_ledger=ledger,
        created_utc=CREATED,
    )
    cm2 = report["counter_metrics"]["CM-2"]
    assert cm2["available"] is False
    assert "values" not in cm2
    assert cm2["not_available_reason"]


def test_a_correctness_ledger_for_another_lineage_is_refused():
    reference_manifest = _reference_manifest()
    ledger = reference_correctness_file(
        corpus_fingerprint="9" * 64,
        assessment_set_sha256=SET_SHA,
        reference_manifest=reference_manifest,
        correct_case_ids=["c1"],
    )
    with pytest.raises(CounterMetricsRefusal) as failed:
        build_counter_metrics_report(
            reference_rows={},
            candidate_rows={"c1": {"case_id": "c1", "status": "ok"}},
            reference_manifest=reference_manifest,
            correctness_ledger=ledger,
            created_utc=CREATED,
        )
    assert failed.value.reason == "correctness_lineage_mismatch"


def test_a_correctness_ledger_without_a_reference_manifest_is_refused():
    ledger = reference_correctness_file(
        corpus_fingerprint=CORPUS,
        assessment_set_sha256=SET_SHA,
        reference_manifest=_reference_manifest(),
        correct_case_ids=["c1"],
    )
    with pytest.raises(CounterMetricsRefusal) as failed:
        build_counter_metrics_report(
            reference_rows={},
            candidate_rows={"c1": {"case_id": "c1", "status": "ok"}},
            correctness_ledger=ledger,
            created_utc=CREATED,
        )
    assert failed.value.reason == "missing_reference_manifest"


# ---------------------------------------------------------------------------
# CM-3 — the limit / cancellation rate
# ---------------------------------------------------------------------------


def test_cm3_records_the_rate_and_the_per_case_terminal_states():
    candidate = {
        "c1": _candidate_row("c1", 10.0),
        "c2": _candidate_row("c2", 10.0, usage_record=_usage(outcome="budget_exhausted")),
        "c3": {"case_id": "c3", "outcome": "cancelled", "wall_ms": 10.0},
    }
    report = build_counter_metrics_report(
        reference_rows={}, candidate_rows=candidate, created_utc=CREATED
    )
    cm3 = report["counter_metrics"]["CM-3"]
    assert cm3["available"] is True
    assert cm3["values"]["n_executions"] == 3
    assert cm3["values"]["n_limit_hits"] == 1
    assert cm3["values"]["n_cancellation_hits"] == 1
    assert cm3["values"]["rate"] == pytest.approx(2 / 3)
    states = {row["case_id"]: row for row in cm3["values"]["per_case_terminal_states"]}
    assert states["c1"]["terminal_state"] == "answered"
    assert states["c2"]["terminal_state"] == "budget_exhausted"
    assert states["c3"]["terminal_state"] == "cancelled"
    assert states["c3"]["hit"] is True


def test_cm3_reports_a_zero_rate_with_the_execution_count():
    candidate = {"c1": _candidate_row("c1", 10.0), "c2": _candidate_row("c2", 20.0)}
    report = build_counter_metrics_report(
        reference_rows={}, candidate_rows=candidate, created_utc=CREATED
    )
    cm3 = report["counter_metrics"]["CM-3"]
    assert cm3["available"] is True
    assert cm3["values"]["n_executions"] == 2
    assert cm3["values"]["rate"] == 0


def test_cm3_counts_the_config_b_limit_marker():
    candidate = {
        "c1": {"case_id": "c1", "status": "ok", "abstention_reason": "result_budget_exhausted"},
        "c2": {"case_id": "c2", "status": "ok"},
    }
    report = build_counter_metrics_report(
        reference_rows={}, candidate_rows=candidate, created_utc=CREATED
    )
    cm3 = report["counter_metrics"]["CM-3"]
    assert cm3["values"]["n_limit_hits"] == 1
    assert cm3["values"]["rate"] == pytest.approx(0.5)


def test_cm3_records_a_failure_beside_the_rate():
    candidate = {
        "c1": _candidate_row("c1", 10.0),
        "c2": {"case_id": "c2", "outcome": "error", "wall_ms": 10.0},
    }
    report = build_counter_metrics_report(
        reference_rows={}, candidate_rows=candidate, created_utc=CREATED
    )
    cm3 = report["counter_metrics"]["CM-3"]
    assert cm3["values"]["n_hits"] == 0
    assert cm3["values"]["rate"] == 0
    assert cm3["values"]["n_failure_rows"] == 1
    assert cm3["values"]["failure_rate"] == pytest.approx(0.5)


def test_cm3_keeps_a_failing_row_in_the_failure_family_even_when_it_records_an_abstention():
    """Only an ANSWERED-SHAPED (status ok) row that records an abstention
    becomes the 'abstained' state — a failing row stays a failure, whatever
    abstention fact rides beside it."""
    candidate = {
        "c1": {"case_id": "c1", "status": "error", "abstained": True},
        "c2": {"case_id": "c2", "status": "ok", "abstained": True},
    }
    report = build_counter_metrics_report(
        reference_rows={}, candidate_rows=candidate, created_utc=CREATED
    )
    cm3 = report["counter_metrics"]["CM-3"]
    states = {row["case_id"]: row for row in cm3["values"]["per_case_terminal_states"]}
    assert states["c1"]["terminal_state"] == "failure"
    assert states["c1"]["hit_kind"] == "failure"
    assert states["c2"]["terminal_state"] == "abstained"
    assert cm3["values"]["n_failure_rows"] == 1
    assert cm3["values"]["n_answered"] == 0


def test_cm3_counts_the_governed_refusal_terminals_as_failures():
    """A configuration error and an invalid request are terminal states that
    did not answer — never a zero failure rate."""
    candidate = {
        "c1": {"case_id": "c1", "outcome": "configuration_error", "wall_ms": 10.0},
        "c2": {"case_id": "c2", "outcome": "invalid_request", "wall_ms": 10.0},
    }
    report = build_counter_metrics_report(
        reference_rows={}, candidate_rows=candidate, created_utc=CREATED
    )
    cm3 = report["counter_metrics"]["CM-3"]
    assert cm3["values"]["n_hits"] == 0
    assert cm3["values"]["n_failure_rows"] == 2
    assert cm3["values"]["failure_rate"] == 1.0


def test_cm3_reads_a_recorded_abstention_as_its_own_terminal_state():
    """An ok row that records an abstention is the 'abstained' state — never
    an answered execution, so CM-3 and CM-2 read the same case the same way."""
    candidate = {
        "c1": {"case_id": "c1", "status": "ok", "abstained": True},
        "c2": {"case_id": "c2", "status": "ok"},
    }
    report = build_counter_metrics_report(
        reference_rows={}, candidate_rows=candidate, created_utc=CREATED
    )
    cm3 = report["counter_metrics"]["CM-3"]
    states = {row["case_id"]: row for row in cm3["values"]["per_case_terminal_states"]}
    assert states["c1"]["terminal_state"] == "abstained"
    assert states["c1"]["answered"] is False
    assert cm3["values"]["n_answered"] == 1


def test_a_non_boolean_abstained_value_is_never_coerced():
    """The string "false" is not an abstention: the fact counts as unrecorded,
    so CM-2 is not computable — never computed from a coerced value."""
    candidate = {"c1": {"case_id": "c1", "status": "ok", "abstained": "false"}}
    reference_manifest = _reference_manifest()
    ledger = reference_correctness_file(
        corpus_fingerprint=CORPUS,
        assessment_set_sha256=SET_SHA,
        reference_manifest=reference_manifest,
        correct_case_ids=["c1"],
    )
    report = build_counter_metrics_report(
        reference_rows={},
        candidate_rows=candidate,
        reference_manifest=reference_manifest,
        correctness_ledger=ledger,
        created_utc=CREATED,
    )
    cm2 = report["counter_metrics"]["CM-2"]
    assert cm2["available"] is False
    assert "values" not in cm2


def test_a_correctness_ledger_whose_ids_are_not_a_list_is_refused():
    ledger = reference_correctness_file(
        corpus_fingerprint=CORPUS,
        assessment_set_sha256=SET_SHA,
        reference_manifest=_reference_manifest(),
        correct_case_ids=["c1"],
    )
    ledger["correct_case_ids"] = "c1c2"
    with pytest.raises(CounterMetricsRefusal) as failed:
        build_counter_metrics_report(
            reference_rows={},
            candidate_rows={"c1": {"case_id": "c1", "status": "ok"}},
            reference_manifest=_reference_manifest(),
            correctness_ledger=ledger,
            created_utc=CREATED,
        )
    assert failed.value.reason == "correctness_invalid_ids"


def test_a_correctness_ledger_with_a_non_scalar_id_is_refused():
    ledger = reference_correctness_file(
        corpus_fingerprint=CORPUS,
        assessment_set_sha256=SET_SHA,
        reference_manifest=_reference_manifest(),
        correct_case_ids=["c1"],
    )
    # the assembled record normalizes its ids to strings — the raw shape the
    # verifier must refuse is patched in here
    ledger["correct_case_ids"] = ["c1", {"id": "c2"}]
    with pytest.raises(CounterMetricsRefusal) as failed:
        build_counter_metrics_report(
            reference_rows={},
            candidate_rows={"c1": {"case_id": "c1", "status": "ok"}},
            reference_manifest=_reference_manifest(),
            correctness_ledger=ledger,
            created_utc=CREATED,
        )
    assert failed.value.reason == "correctness_invalid_ids"


def test_cm2_deduplicates_the_ledgers_case_ids():
    """A duplicate entry must not inflate the denominator."""
    candidate = {"c1": {"case_id": "c1", "status": "ok", "abstained": True}}
    reference_manifest = _reference_manifest()
    ledger = reference_correctness_file(
        corpus_fingerprint=CORPUS,
        assessment_set_sha256=SET_SHA,
        reference_manifest=reference_manifest,
        correct_case_ids=["c1", "c1"],
    )
    report = build_counter_metrics_report(
        reference_rows={},
        candidate_rows=candidate,
        reference_manifest=reference_manifest,
        correctness_ledger=ledger,
        created_utc=CREATED,
    )
    cm2 = report["counter_metrics"]["CM-2"]
    assert cm2["values"]["n_reference_correct_cases"] == 1
    assert cm2["values"]["rate"] == 1.0


def test_cm1_reports_disjoint_cost_counters_as_not_computable():
    """Two sides recording disjoint counters is 'not computable', never 'the
    delta is zero' — and the candidate-only counters are named."""
    reference = {"c1": _reference_row("c1", 100.0, usage_record={"outcome": "answered", "prompt_tokens": 80})}
    candidate = {
        "c1": _candidate_row("c1", 150.0, usage_record={"outcome": "answered", "tool_calls": 4})
    }
    report = build_counter_metrics_report(
        reference_rows=reference, candidate_rows=candidate, created_utc=CREATED
    )
    cm1 = report["counter_metrics"]["CM-1"]
    cost_delta = cm1["values"]["cost_delta"]
    assert cost_delta["available"] is False
    assert "no counter is shared" in cost_delta["not_available_reason"]


def test_cm1_names_the_candidate_only_counters_in_each_delta_row():
    reference = {
        "c1": _reference_row("c1", 100.0, usage_record={"outcome": "answered", "model_calls": 1})
    }
    candidate = {
        "c1": _candidate_row(
            "c1", 150.0, usage_record={"outcome": "answered", "model_calls": 3, "tool_calls": 4}
        )
    }
    report = build_counter_metrics_report(
        reference_rows=reference, candidate_rows=candidate, created_utc=CREATED
    )
    row = report["counter_metrics"]["CM-1"]["values"]["cost_delta"]["per_request"][0]
    assert row["delta_model_calls"] == 2
    assert row["candidate_only"] == ["tool_calls"]


def test_cm3_is_not_computable_without_an_execution():
    report = build_counter_metrics_report(
        reference_rows={}, candidate_rows={}, created_utc=CREATED
    )
    cm3 = report["counter_metrics"]["CM-3"]
    assert cm3["available"] is False
    assert "values" not in cm3


# ---------------------------------------------------------------------------
# The report — first-class entries, digested inputs, reproducible digest
# ---------------------------------------------------------------------------


def test_the_three_counter_metrics_are_first_class_top_level_entries():
    report = build_counter_metrics_report(
        reference_rows={}, candidate_rows={"c1": _candidate_row("c1", 10.0)}, created_utc=CREATED
    )
    metrics = report["counter_metrics"]
    assert set(metrics) == {"CM-1", "CM-2", "CM-3"}
    for name, record in metrics.items():
        assert record["metric"] == name
        assert record["measurement_surface"]
        assert "available" in record


def test_every_input_is_digested_into_the_inputs_record():
    reference = {"c1": _reference_row("c1", 100.0)}
    candidate = {"c1": _candidate_row("c1", 150.0)}
    report = build_counter_metrics_report(
        reference_rows=reference, candidate_rows=candidate, created_utc=CREATED
    )
    inputs = report["inputs"]
    assert inputs["reference_rows_sha256"]
    assert inputs["candidate_rows_sha256"]
    assert inputs["n_reference_rows"] == 1
    assert inputs["n_candidate_rows"] == 1
    assert inputs["reference_manifest_sha256"] is None


def test_the_report_digest_is_reproducible_under_a_pinned_created_utc():
    reference = {"c1": _reference_row("c1", 100.0)}
    candidate = {"c1": _candidate_row("c1", 150.0)}
    first = build_counter_metrics_report(
        reference_rows=reference, candidate_rows=candidate, created_utc=CREATED
    )
    second = build_counter_metrics_report(
        reference_rows=reference, candidate_rows=candidate, created_utc=CREATED
    )
    assert first["digest"] == second["digest"]
    assert first["digest"] == counter_metrics_report_digest(first)


# ---------------------------------------------------------------------------
# The CLI
# ---------------------------------------------------------------------------


def _args(reference_rows: Path, candidate_rows: Path, out: Path, **overrides) -> argparse.Namespace:
    args = argparse.Namespace(
        reference_rows=str(reference_rows),
        candidate_rows=str(candidate_rows),
        reference_manifest=None,
        correctness_ledger=None,
        out=str(out),
        created_utc=CREATED,
    )
    for key, value in overrides.items():
        setattr(args, key, value)
    return args


def test_the_counters_cli_writes_the_report(tmp_path, capsys):
    reference_rows = _write_rows(tmp_path / "reference.rows.json", {"c1": _reference_row("c1", 100.0)})
    candidate_rows = _write_rows(tmp_path / "candidate.rows.json", {"c1": _candidate_row("c1", 150.0)})
    out = tmp_path / "counters.json"
    assert cmd_counters(_args(reference_rows, candidate_rows, out)) == 0
    report = json.loads(out.read_text(encoding="utf-8"))
    assert set(report["counter_metrics"]) == {"CM-1", "CM-2", "CM-3"}
    assert report["counter_metrics"]["CM-1"]["available"] is True
    assert report["counter_metrics"]["CM-2"]["available"] is False
    assert report["counter_metrics"]["CM-3"]["available"] is True
    printed = capsys.readouterr()
    assert "CM-1" in printed.out


def test_the_counters_cli_exits_1_on_a_mismatched_ledger(tmp_path, capsys):
    reference_rows = _write_rows(tmp_path / "reference.rows.json", {"c1": _reference_row("c1", 100.0)})
    candidate_rows = _write_rows(tmp_path / "candidate.rows.json", {"c1": _candidate_row("c1", 150.0)})
    reference_manifest = _reference_manifest()
    reference_path = tmp_path / "reference.manifest.json"
    reference_path.write_text(json.dumps(reference_manifest), encoding="utf-8")
    ledger = reference_correctness_file(
        corpus_fingerprint="9" * 64,
        assessment_set_sha256=SET_SHA,
        reference_manifest=reference_manifest,
        correct_case_ids=["c1"],
    )
    ledger_path = tmp_path / "correctness.json"
    ledger_path.write_text(json.dumps(ledger), encoding="utf-8")
    out = tmp_path / "counters.json"
    assert (
        main(
            [
                "counters",
                "--reference-rows",
                str(reference_rows),
                "--candidate-rows",
                str(candidate_rows),
                "--reference-manifest",
                str(reference_path),
                "--correctness-ledger",
                str(ledger_path),
                "--out",
                str(out),
            ]
        )
        == 1
    )
    assert not out.exists()
    assert "REFUSED" in capsys.readouterr().err
