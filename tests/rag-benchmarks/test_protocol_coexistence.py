# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for protocol/coexistence.py (+ the coexistence CLI wiring).

Every I/O matrix row through fakes — no live venue, no network: the two
phases' legacy measurements and the agentic load's record are fixtures, the
legacy limits are a synthetic operator artifact. Proven here:

* the controlled comparison runs and its verdict is COMPUTED from the agreed
  legacy limits AND the agreed regression tolerance — never narrated;
* a limit nobody agreed makes the verdict BLOCKED, a limit the measurement
  cannot carry makes it BLOCKED, and a limit whose threshold is not a number
  is UNINTERPRETABLE — never a breach nobody measured;
* a regression nobody agreed a tolerance for is NOT MEASURABLE — the
  controlled comparison's own question cannot be scored, so the verdict
  blocks;
* a legacy path that degraded past the agreed tolerance FAILS the criterion,
  and BOTH phases' numbers are in the report whatever the verdict;
* a request that reached no terminal outcome FAILS the criterion — the
  admission lane refuses a saturated run, it never queues it — and a load
  record with no independent request count makes that check NOT MEASURABLE;
* the two phases must cover the same request mix: a comparison over two
  different populations blocks the verdict;
* a limits artifact that declares a lineage cannot be applied without one;
* the report reproduces byte-identically under a pinned created_utc.
"""

import argparse
import json
from pathlib import Path

import pytest

from protocol.coexistence import (
    CoexistenceRefusal,
    build_coexistence_report,
    coexistence_report_digest,
)
from protocol.run_protocol import cmd_coexistence

CREATED = "2026-11-24T00:00:00+00:00"
CORPUS = "c" * 64
SET_SHA = "a" * 64


# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


def _control():
    """The control phase — the legacy path alone: fast and green."""
    return {
        "q1": {"http_status": 200, "wall_ms": 100.0},
        "q2": {"http_status": 200, "wall_ms": 120.0},
        "q3": {"http_status": 200, "wall_ms": 90.0},
        "q4": {"http_status": 200, "wall_ms": 110.0},
    }


def _loaded():
    """The loaded phase — the same legacy mix under the agentic load: slower,
    and one failure the control did not have."""
    return {
        "q1": {"http_status": 200, "wall_ms": 900.0},
        "q2": {"http_status": 200, "wall_ms": 1200.0},
        "q3": {"http_status": 503, "wall_ms": 5000.0},
        "q4": {"http_status": 200, "wall_ms": 1000.0},
    }


def _agent_load():
    """The concurrent agentic load: three answered, one refused by the
    saturated admission lane (the typed refusal, never a queue)."""
    return {
        "concurrency": 4,
        "requests": 4,
        "outcomes": {"answered": 3, "admission_refused": 1},
        "n_admission_refusals": 1,
        "admission_response": "the seam answered 429 with Retry-After",
        "usage_records": [
            {"model_calls": 3, "prompt_tokens": 100, "completion_tokens": 40, "wall_clock_seconds": 4.0},
            {"model_calls": 2, "prompt_tokens": 80, "completion_tokens": 30, "wall_clock_seconds": 3.0},
            {"model_calls": 4, "prompt_tokens": 120, "completion_tokens": 50, "wall_clock_seconds": 5.0},
        ],
    }


def _limits(*, regression=True, **overrides):
    limits = {
        "latency_median_ms": {"operator": "<=", "threshold": 1500},
        "error_rate": {"operator": "<=", "threshold": 0.0},
        "availability": {"operator": ">=", "threshold": 1.0},
    }
    limits.update(overrides)
    artifact = {
        "artifact": "legacy-non-regression-limits",
        "corpus_fingerprint": CORPUS,
        "assessment_set_sha256": SET_SHA,
        "limits": limits,
    }
    if regression:
        artifact["regression"] = {
            "latency_median_ms": {"max_delta": 200.0},
            "availability": {"max_delta": 0.0},
            "error_rate": {"max_delta": 0.0},
        }
    return artifact


def _report(*, control=None, loaded=None, agent_load=None, limits=_limits(), lineage=True, **kwargs):
    return build_coexistence_report(
        control_measurements=control if control is not None else _control(),
        loaded_measurements=loaded if loaded is not None else _loaded(),
        agent_load=agent_load if agent_load is not None else _agent_load(),
        limits=limits,
        lineage={"corpus_fingerprint": CORPUS, "assessment_set_sha256": SET_SHA} if lineage else None,
        created_utc=CREATED,
        **kwargs,
    )


# ---------------------------------------------------------------------------
# The criterion
# ---------------------------------------------------------------------------


def test_coexistence_reports_both_phases_whatever_the_verdict():
    report = _report()
    control = report["phases"]["control"]
    loaded = report["phases"]["loaded"]
    assert control["n_ok"] == 4 and control["n_failed"] == 0
    assert loaded["n_ok"] == 3 and loaded["n_failed"] == 1
    assert control["availability"] == 1.0
    assert loaded["availability"] == 0.75
    assert loaded["latency_ms"]["median"] == 1100.0
    assert report["legacy_regression"]["latency_median_ms"]["delta"] == 995.0
    assert report["legacy_regression"]["availability"]["delta"] == -0.25


def test_coexistence_fails_when_the_legacy_path_degraded():
    report = _report()
    assert report["verdict"]["verdict"] == "fail"
    assert report["verdict"]["reasons"]
    # The failing legacy numbers are in the report — never smoothed away.
    assert report["phases"]["loaded"]["n_failed"] == 1
    assert report["phases"]["loaded"]["failures"][0]["case_id"] == "q3"


def test_coexistence_fails_when_the_legacy_path_degraded_past_the_agreed_tolerance():
    """The controlled comparison's own question: the legacy path must not
    degrade under the agentic load."""
    limits = _limits(
        latency_median_ms={"operator": "<=", "threshold": 5000},
        error_rate={"operator": "<=", "threshold": 1.0},
        availability={"operator": ">=", "threshold": 0.0},
    )
    report = _report(limits=limits)
    assert report["verdict"]["verdict"] == "fail"
    assert any("degraded" in reason for reason in report["verdict"]["reasons"])
    assert report["regression_verdict"]["verdict"] == "fail"


def test_coexistence_passes_when_the_legacy_path_holds():
    report = _report(control=_control(), loaded=_control())
    assert report["verdict"]["verdict"] == "pass"
    assert report["verdict"]["reasons"] == []
    assert report["regression_verdict"]["verdict"] == "pass"


def test_coexistence_is_blocked_when_no_limits_were_agreed():
    report = _report(limits=None)
    assert report["verdict"]["verdict"] == "blocked"
    assert report["limits"]["present"] is False
    assert report["limits"]["reason"]
    # The legacy numbers are still in the report — a blocked verdict is not a
    # silent pass.
    assert report["phases"]["loaded"]["n_failed"] == 1


def test_coexistence_is_blocked_when_no_regression_tolerance_was_agreed():
    report = _report(control=_control(), loaded=_control(), limits=_limits(regression=False))
    assert report["regression_verdict"]["present"] is False
    assert report["regression_verdict"]["reason"]
    assert report["verdict"]["verdict"] == "blocked"


def test_coexistence_is_blocked_when_a_limit_cannot_be_measured():
    limits = _limits(
        latency_median_ms={"operator": "<=", "threshold": 1500},
        error_rate={"operator": "<=", "threshold": 0.0},
        availability={"operator": ">=", "threshold": 1.0},
        unknown_metric={"operator": "<=", "threshold": 1},
    )
    report = _report(control=_control(), loaded=_control(), limits=limits)
    outcomes = {record["metric"]: record["outcome"] for record in report["limits"]["limits"]}
    assert outcomes["unknown_metric"] == "not_measurable"
    assert report["verdict"]["verdict"] == "blocked"


def test_coexistence_is_blocked_when_a_limit_carries_no_comparable_threshold():
    limits = _limits(latency_median_ms={"operator": "<=", "threshold": "1500"})
    report = _report(control=_control(), loaded=_control(), limits=limits)
    outcomes = {record["metric"]: record["outcome"] for record in report["limits"]["limits"]}
    assert outcomes["latency_median_ms"] == "uninterpretable"
    assert report["verdict"]["verdict"] == "blocked"


def test_coexistence_fails_when_a_request_reached_no_terminal_outcome():
    """The admission lane refuses a saturated run; a request that neither
    answered nor was refused is a silent failure."""
    load = _agent_load()
    load["n_without_terminal_outcome"] = 1
    report = _report(control=_control(), loaded=_control(), agent_load=load)
    assert report["verdict"]["verdict"] == "fail"
    assert report["saturation"]["every_request_reached_a_terminal_outcome"] is False
    assert any("never queues it" in reason for reason in report["verdict"]["reasons"])


def test_coexistence_is_blocked_when_the_load_record_carries_no_request_count():
    """A request count derived from the outcome tally can never reveal a
    vanished request — the saturation check must be marked NOT MEASURED."""
    load = _agent_load()
    load.pop("requests")
    report = _report(control=_control(), loaded=_control(), agent_load=load)
    assert report["agentic_load"]["requests_recorded_independently"] is False
    assert report["agentic_load"]["saturation_check_available"] is False
    assert report["verdict"]["verdict"] == "blocked"


def test_coexistence_blocks_when_the_two_phases_cover_different_request_mixes():
    loaded = {case_id: dict(measurement) for case_id, measurement in _control().items()}
    loaded.pop("q4")
    report = _report(control=_control(), loaded=loaded)
    assert report["phase_coverage"]["same_request_mix"] is False
    assert report["phase_coverage"]["mismatched_case_ids"] == ["q4"]
    assert report["verdict"]["verdict"] == "blocked"
    assert any("same request mix" in reason for reason in report["verdict"]["reasons"])


def test_coexistence_records_the_saturation_response_and_the_load_cost():
    report = _report(control=_control(), loaded=_control())
    load = report["agentic_load"]
    assert load["n_admission_refusals"] == 1
    assert load["admission_refusal_rate"] == 0.25
    assert "429" in load["observed_admission_response"]
    assert "never queues" in load["defined_admission_response"]
    totals = load["resource_consumption_under_load"]["totals"]
    assert totals["model_calls"]["sum"] == 9.0
    assert totals["model_calls"]["n_rows"] == 3


def test_coexistence_reproduces_under_a_pinned_created_utc():
    first = _report()
    second = _report()
    assert first["digest"] == second["digest"]
    assert coexistence_report_digest(first) == first["digest"]


# ---------------------------------------------------------------------------
# The refusals
# ---------------------------------------------------------------------------


def test_coexistence_refuses_a_missing_phase():
    with pytest.raises(CoexistenceRefusal) as failed:
        build_coexistence_report(
            control_measurements={},
            loaded_measurements=_loaded(),
            agent_load=_agent_load(),
            created_utc=CREATED,
        )
    assert failed.value.reason == "missing_artifact"


def test_coexistence_refuses_a_missing_agent_load():
    with pytest.raises(CoexistenceRefusal) as failed:
        build_coexistence_report(
            control_measurements=_control(),
            loaded_measurements=_loaded(),
            agent_load={},
            created_utc=CREATED,
        )
    assert failed.value.reason == "missing_artifact"


def test_coexistence_refuses_limits_of_another_lineage():
    limits = _limits()
    limits["corpus_fingerprint"] = "d" * 64
    with pytest.raises(CoexistenceRefusal) as failed:
        build_coexistence_report(
            control_measurements=_control(),
            loaded_measurements=_loaded(),
            agent_load=_agent_load(),
            limits=limits,
            lineage={"corpus_fingerprint": CORPUS, "assessment_set_sha256": SET_SHA},
            created_utc=CREATED,
        )
    assert failed.value.reason == "limits_lineage_mismatch"


def test_coexistence_refuses_a_limits_artifact_with_a_lineage_and_no_lineage_supplied():
    with pytest.raises(CoexistenceRefusal) as failed:
        build_coexistence_report(
            control_measurements=_control(),
            loaded_measurements=_loaded(),
            agent_load=_agent_load(),
            limits=_limits(),
            lineage=None,
            created_utc=CREATED,
        )
    assert failed.value.reason == "missing_lineage"


def test_coexistence_refuses_a_measurement_with_no_outcome():
    with pytest.raises(CoexistenceRefusal) as failed:
        build_coexistence_report(
            control_measurements={"q1": {"wall_ms": 100.0}},
            loaded_measurements=_loaded(),
            agent_load=_agent_load(),
            created_utc=CREATED,
        )
    assert failed.value.reason == "invalid_measurement"


def test_coexistence_refuses_a_limits_artifact_with_no_limit():
    with pytest.raises(CoexistenceRefusal) as failed:
        build_coexistence_report(
            control_measurements=_control(),
            loaded_measurements=_loaded(),
            agent_load=_agent_load(),
            limits={"artifact": "legacy-non-regression-limits", "limits": {}},
            created_utc=CREATED,
        )
    assert failed.value.reason == "invalid_limits"


# ---------------------------------------------------------------------------
# The CLI
# ---------------------------------------------------------------------------


def _write(tmp_path, name, payload):
    path = tmp_path / name
    path.write_text(json.dumps(payload), encoding="utf-8")
    return str(path)


def test_coexistence_cli_writes_the_report(tmp_path, capsys):
    args = argparse.Namespace(
        control=_write(tmp_path, "control.json", _control()),
        loaded=_write(tmp_path, "loaded.json", _loaded()),
        agent_load=_write(tmp_path, "agent-load.json", _agent_load()),
        limits=_write(tmp_path, "limits.json", _limits()),
        lineage=_write(
            tmp_path,
            "lineage.json",
            {"corpus_fingerprint": CORPUS, "assessment_set_sha256": SET_SHA},
        ),
        out=str(tmp_path / "coexistence.report.json"),
        created_utc=CREATED,
    )
    assert cmd_coexistence(args) == 0
    written = json.loads((tmp_path / "coexistence.report.json").read_text(encoding="utf-8"))
    assert written["artifact"] == "coexistence-criterion-report"
    assert written["verdict"]["verdict"] == "fail"
    assert "coexistence verdict" in capsys.readouterr().out


def test_coexistence_cli_exits_1_on_a_refusal(tmp_path):
    args = argparse.Namespace(
        control=_write(tmp_path, "control.json", _control()),
        loaded=_write(tmp_path, "loaded.json", _loaded()),
        agent_load=_write(tmp_path, "agent-load.json", _agent_load()),
        limits=None,
        lineage=None,
        out=str(tmp_path / "coexistence.report.json"),
        created_utc=CREATED,
    )
    assert cmd_coexistence(args) == 0
    args.control = _write(tmp_path, "broken.json", {})
    assert cmd_coexistence(args) == 1


# ---------------------------------------------------------------------------
# Round 2 — the corrections the FIX-REVIEW validated
# ---------------------------------------------------------------------------


def test_coexistence_derived_vanished_request_overrides_a_stale_zero():
    """A record that claims zero vanished requests while its own tally shows
    requests missing would mask the silent failure: the derived count is the
    floor, a declared value can only raise it."""
    load = _agent_load()
    load["requests"] = 5
    load["n_without_terminal_outcome"] = 0
    report = _report(control=_control(), loaded=_control(), agent_load=load)
    assert report["agentic_load"]["n_without_terminal_outcome"] == 1
    assert report["verdict"]["verdict"] == "fail"
    assert any("never queues it" in reason for reason in report["verdict"]["reasons"])


def test_coexistence_blocks_the_regression_over_a_mismatched_mix_even_when_it_breaches():
    """The regression is the comparison: over two different populations it is
    invalid, so its verdict is BLOCKED — never a FAIL whose evidentiary basis
    the report itself calls invalid."""
    loaded = {case_id: dict(measurement) for case_id, measurement in _control().items()}
    loaded.pop("q4")
    report = _report(control=_control(), loaded=loaded)
    assert report["phase_coverage"]["same_request_mix"] is False
    assert report["regression_verdict"]["verdict"] == "blocked"
    assert report["verdict"]["verdict"] == "blocked"


def test_coexistence_absolute_limit_failure_still_fails_over_a_mismatched_mix():
    """The limits apply to the LOADED phase's own numbers — a measured breach
    there is a fact about that phase whatever the control covered."""
    limits = _limits(error_rate={"operator": "<=", "threshold": 0.0})
    loaded = {case_id: dict(measurement) for case_id, measurement in _control().items()}
    loaded.pop("q4")
    loaded["q1"] = {"http_status": 503}
    report = _report(control=_control(), loaded=loaded, limits=limits)
    assert report["phase_coverage"]["same_request_mix"] is False
    assert report["verdict"]["verdict"] == "fail"
    assert report["regression_verdict"]["verdict"] == "blocked"


def test_coexistence_rejects_boolean_outcome_and_usage_values():
    """A boolean tally entry is not a request and a boolean counter is not a
    cost: the numeric readers reject bool like every other reader in the
    module — pinning the rejection so it cannot regress silently."""
    load = _agent_load()
    load["requests"] = 5
    load["outcomes"] = {"answered": 3, "admission_refused": True}
    load.pop("n_admission_refusals")  # the tally alone must decide
    report = _report(control=_control(), loaded=_control(), agent_load=load)
    load_summary = report["agentic_load"]
    # The bool is not a terminal: 5 requests, 3 terminals, 2 vanished.
    assert load_summary["n_without_terminal_outcome"] == 2
    assert load_summary["outcomes"]["admission_refused"] is True
    # And it is not a refusal either: the tally alone decides.
    assert load_summary["n_admission_refusals"] == 0
    load["usage_records"] = [{"model_calls": True, "prompt_tokens": 10}]
    report = _report(control=_control(), loaded=_control(), agent_load=load)
    totals = report["agentic_load"]["resource_consumption_under_load"]["totals"]
    assert totals["model_calls"]["sum"] == 0.0
    assert totals["model_calls"]["n_rows"] == 0
    assert totals["prompt_tokens"]["sum"] == 10.0


def test_coexistence_refuses_a_mistyped_tally_count():
    """A count that is neither an integer nor a bool is a MIS-TYPED entry:
    dropping it would fabricate vanished requests (a breach nobody measured),
    so the record is refused instead."""
    load = _agent_load()
    load["outcomes"] = {"answered": 3.0, "admission_refused": 1}
    with pytest.raises(CoexistenceRefusal) as failed:
        _report(control=_control(), loaded=_control(), agent_load=load)
    assert failed.value.reason == "invalid_measurement"


def test_coexistence_refuses_a_non_mapping_outcomes_value():
    load = _agent_load()
    load["outcomes"] = []
    with pytest.raises(CoexistenceRefusal) as failed:
        _report(control=_control(), loaded=_control(), agent_load=load)
    assert failed.value.reason == "invalid_measurement"


def test_coexistence_publishes_no_refusal_rate_over_an_unmeasured_denominator():
    """A rate over the terminal tally, presented as a rate over requests the
    record says were never counted, is a fabricated denominator: it stays
    unpublished."""
    load = _agent_load()
    load.pop("requests")
    report = _report(control=_control(), loaded=_control(), agent_load=load)
    load_summary = report["agentic_load"]
    assert load_summary["requests_recorded_independently"] is False
    assert load_summary["admission_refusal_rate"] is None
    assert "never" in (load_summary["admission_refusal_rate_note"] or "")


# ---------------------------------------------------------------------------
# The round-5 corrections — the tally family refuses fabrication in BOTH
# directions; declared values only raise; the harness owns its metric names
# ---------------------------------------------------------------------------


def test_coexistence_refuses_a_non_mapping_limits_artifact():
    """A limits artifact the operator's decision would never take (a list) is
    a typed refusal, not an AttributeError."""
    with pytest.raises(CoexistenceRefusal) as failed:
        build_coexistence_report(
            control_measurements=_control(),
            loaded_measurements=_loaded(),
            agent_load=_agent_load(),
            limits=["latency_median_ms"],
            created_utc=CREATED,
        )
    assert failed.value.reason == "invalid_limits"


def test_coexistence_refuses_an_outcome_tally_exceeding_the_request_count():
    """Six terminal outcomes for four recorded requests is a double-counted
    record — flooring it would let the self-contradictory record through the
    saturation check silently."""
    load = _agent_load()
    load["outcomes"] = {"answered": 3, "error": 3}
    with pytest.raises(CoexistenceRefusal) as failed:
        _report(control=_control(), loaded=_control(), agent_load=load)
    assert failed.value.reason == "invalid_measurement"
    assert "exceeds" in str(failed.value)


def test_coexistence_declared_refusals_can_only_raise_over_the_tally():
    """The admitted-refusals count carries the vanished-request rule's mirror:
    a declaration below the record's own admission_refused tally cannot
    publish fewer refusals than the record itself counted."""
    load = _agent_load()
    load["requests"] = 6
    load["outcomes"] = {"answered": 3, "admission_refused": 3}
    load["n_admission_refusals"] = 1
    report = _report(control=_control(), loaded=_control(), agent_load=load)
    assert report["agentic_load"]["n_admission_refusals"] == 3


def test_coexistence_splits_the_not_measurable_reason_for_an_unknown_metric():
    """A limit naming a metric the harness does not define blames the LIMIT,
    not the measurement — the operator's fix is naming a metric the harness
    defines, not hunting a measurement bug."""
    limits = _limits(unknown_metric={"operator": "<=", "threshold": 1})
    report = _report(control=_control(), loaded=_control(), limits=limits)
    by_metric = {record["metric"]: record for record in report["limits"]["limits"]}
    assert by_metric["unknown_metric"]["outcome"] == "not_measurable"
    assert "no legacy metric named" in by_metric["unknown_metric"]["reason"]


def test_coexistence_regression_splits_the_not_measurable_reason_for_an_unknown_metric():
    """A regression tolerance naming a metric the harness does not define
    blames the ARTIFACT, not the measurement — the same unknown-metric rule
    the absolute limits carry: the entry is never scored against a polarity
    the harness does not define for it, and the verdict stays BLOCKED."""
    limits = _limits()
    limits["regression"]["latency_medain_ms"] = {"max_delta": 200.0}
    report = _report(control=_control(), loaded=_control(), limits=limits)
    by_metric = {record["metric"]: record for record in report["regression_verdict"]["metrics"]}
    assert by_metric["latency_medain_ms"]["outcome"] == "not_measurable"
    assert "no legacy metric named" in by_metric["latency_medain_ms"]["reason"]
    assert report["regression_verdict"]["verdict"] == "blocked"


def test_coexistence_keeps_the_measurement_reason_for_a_known_unmeasured_metric():
    """A harness metric the measurement does not carry keeps the measurement
    reason — the two absences have different fixes."""
    loaded = {case: {"http_status": 200} for case, m in _loaded().items()}
    limits = _limits()
    report = _report(control=_control(), loaded=loaded, limits=limits)
    by_metric = {record["metric"]: record for record in report["limits"]["limits"]}
    assert by_metric["latency_median_ms"]["outcome"] == "not_measurable"
    assert "the measurement carries no" in by_metric["latency_median_ms"]["reason"]


# ---------------------------------------------------------------------------
# The draft legacy-limits artifact (issue #2146) — proposal, never an agreed
# limit
# ---------------------------------------------------------------------------

REPO_ROOT = Path(__file__).resolve().parent.parent.parent
DRAFT_LIMITS_FILE = (
    REPO_ROOT
    / "_bmad-output"
    / "implementation-artifacts"
    / "coexistence-limits-draft-2026-11-25"
    / "legacy-limits.draft.json"
)
FINAL_A_MANIFEST = (
    REPO_ROOT
    / "_bmad-output"
    / "implementation-artifacts"
    / "e01-final-reference-2026-11-24"
    / "reference.manifest.json"
)


def _draft_limits() -> dict:
    return json.loads(DRAFT_LIMITS_FILE.read_text(encoding="utf-8"))


def _held_loaded() -> dict:
    """The loaded phase inside the draft's tolerances — the same mix, a few
    milliseconds slower, no new failures."""
    return {
        case_id: {"http_status": 200, "wall_ms": measurement["wall_ms"] + 10.0}
        for case_id, measurement in _control().items()
    }


def _all_answered_load() -> dict:
    load = _agent_load()
    load["outcomes"] = {"answered": 4}
    load["n_admission_refusals"] = 0
    return load


def test_coexistence_refuses_a_draft_limits_artifact():
    """A draft is the derivation's proposal for the operator's agreement,
    never an agreed limit: passing it as the criterion's --limits is refused
    before the report is built — the harness applies limits, it never lets a
    proposal open a verdict by accident."""
    with pytest.raises(CoexistenceRefusal) as failed:
        build_coexistence_report(
            control_measurements=_control(),
            loaded_measurements=_held_loaded(),
            agent_load=_all_answered_load(),
            limits=_draft_limits(),
            created_utc=CREATED,
        )
    assert failed.value.reason == "unagreed_limits"
    assert "'draft'" in str(failed.value)


def test_coexistence_refuses_any_non_agreed_status_not_just_draft():
    """The whitelist, not a draft blacklist: a typo'd agreement flip
    ('agree'), or any other non-agreed word ('pending', 'final', 'signed')
    is refused too — an un-agreed artifact must never open a verdict,
    whatever its status string claims. Only a case variant of 'agreed'
    itself applies (the flip's intent is unambiguous)."""
    for status in ("agree", "pending", "final", "signed"):
        limits = _draft_limits()
        limits["status"] = status
        with pytest.raises(CoexistenceRefusal) as failed:
            build_coexistence_report(
                control_measurements=_control(),
                loaded_measurements=_held_loaded(),
                agent_load=_all_answered_load(),
                limits=limits,
                created_utc=CREATED,
            )
        assert failed.value.reason == "unagreed_limits", status


def test_coexistence_accepts_the_status_flip_in_any_case():
    """The agreement act is the flip: 'agreed' in any casing applies (the
    operator's intent is unambiguous), and the status-less shapes — the
    pre-existing artifact spelling (no key) and a JSON null — apply
    unchanged: both read as 'no status was recorded', not as an un-agreed
    one."""
    for name, status in (("agreed", "agreed"), ("AGREED", "AGREED"), ("Agreed", "Agreed")):
        limits = _draft_limits()
        limits["status"] = status
        report = build_coexistence_report(
            control_measurements=_control(),
            loaded_measurements=_held_loaded(),
            agent_load=_all_answered_load(),
            limits=limits,
            lineage={
                "corpus_fingerprint": limits["corpus_fingerprint"],
                "assessment_set_sha256": limits["assessment_set_sha256"],
            },
            created_utc=CREATED,
        )
        assert report["verdict"]["verdict"] == "pass", name
    for name, absent in (("no-status-key", "pop"), ("json-null-status", "null")):
        limits = _draft_limits()
        if absent == "pop":
            limits.pop("status")
        else:
            limits["status"] = None
        report = build_coexistence_report(
            control_measurements=_control(),
            loaded_measurements=_held_loaded(),
            agent_load=_all_answered_load(),
            limits=limits,
            lineage={
                "corpus_fingerprint": limits["corpus_fingerprint"],
                "assessment_set_sha256": limits["assessment_set_sha256"],
            },
            created_utc=CREATED,
        )
        assert report["verdict"]["verdict"] == "pass", name


def test_coexistence_applies_the_limits_once_agreed():
    """The agreement act is the status flip: the same artifact with the draft
    status agreed applies cleanly — every limit and every regression tolerance
    interpretable, and a loaded phase inside the derived bounds PASSes (the
    verdict stays open for the operator's decision, nothing defaults)."""
    limits = _draft_limits()
    limits["status"] = "agreed"
    report = build_coexistence_report(
        control_measurements=_control(),
        loaded_measurements=_held_loaded(),
        agent_load=_all_answered_load(),
        limits=limits,
        lineage={
            "corpus_fingerprint": limits["corpus_fingerprint"],
            "assessment_set_sha256": limits["assessment_set_sha256"],
        },
        created_utc=CREATED,
    )
    assert report["limits"]["present"] is True
    assert all(record["outcome"] == "pass" for record in report["limits"]["limits"])
    assert all(metric["outcome"] == "pass" for metric in report["regression_verdict"]["metrics"])
    assert report["verdict"]["verdict"] == "pass"


def test_draft_limits_lineage_matches_the_final_a_reference():
    """The draft binds the lineage it was derived from — the FINAL A
    reference (issue #2162): the corpus fingerprint and the assessment-set
    digest the signed thresholds carry."""
    manifest = json.loads(FINAL_A_MANIFEST.read_text(encoding="utf-8"))
    draft = _draft_limits()
    assert draft["corpus_fingerprint"] == manifest["corpus"]["fingerprint"]
    assert draft["assessment_set_sha256"] == manifest["sets"]["assessment"]["sha256"]
    assert draft["status"] == "draft"
