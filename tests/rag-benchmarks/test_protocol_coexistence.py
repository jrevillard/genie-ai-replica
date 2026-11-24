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
