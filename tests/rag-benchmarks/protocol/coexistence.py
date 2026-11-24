# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The coexistence criterion — the legacy path under concurrent agentic load.

NFR-3: the legacy OPEA RAG path serves existing traffic UNCHANGED while the
agentic path is additive. A per-run bound does not by itself prevent many
bounded runs from saturating the shared model services, so the criterion is a
CONTROLLED COMPARISON, not a sentence in a report:

* the CONTROL phase — the legacy path alone;
* the LOADED phase — the same legacy path while the agentic path runs
  concurrently;
* the verdict — computed from the AGREED legacy latency / error / availability
  limits, with the observed legacy numbers of BOTH phases in the report
  whatever the verdict.

The honesty rules are the point:

* a limit nobody agreed makes the verdict BLOCKED — never a pass, never a
  default limit;
* a limit whose metric the measurement does not carry is NOT MEASURABLE — it
  blocks the verdict, it never passes it;
* the legacy numbers are always in the report: a report that omitted or
  smoothed a slowed or failing legacy response is a defect, and the criterion
  FAILS when the legacy path degraded under the agentic load;
* the saturation/admission response is a measured observation — the admission
  lane REFUSES a saturated run (the seam answers 429 with ``Retry-After``);
  it never queues. A run that neither answered nor was refused is a silent
  failure and fails the criterion.
"""

from __future__ import annotations

from datetime import UTC, datetime

from . import PROTOCOL_VERSION
from .counter_metrics import COST_COUNTERS
from .manifest import sha256_json

COEXISTENCE_REPORT_VERSION = "1.0.0"
COEXISTENCE_REPORT_ARTIFACT = "coexistence-criterion-report"

# The verdicts.
VERDICT_PASS = "pass"
VERDICT_FAIL = "fail"
VERDICT_BLOCKED = "blocked"

# The limit outcomes.
LIMIT_PASS = "pass"
LIMIT_FAIL = "fail"
LIMIT_NOT_MEASURABLE = "not_measurable"
LIMIT_UNINTERPRETABLE = "uninterpretable"

# The comparison operators a limit may carry.
OPERATORS = (">=", "<=", ">", "<", "==")

# The legacy metrics a limit may bound.
LEGACY_METRICS = (
    "latency_median_ms",
    "latency_max_ms",
    "latency_p95_ms",
    "error_rate",
    "availability",
)

DEFINED_ADMISSION_RESPONSE = (
    "a saturated admission lane REFUSES the run before any stage starts — the seam answers 429"
    " with Retry-After; the lane never queues the request"
)

HONEST_EVIDENCE_STATEMENT = (
    "Coexistence honest evidence: this report joins two recorded phases of the SAME legacy"
    " request mix — one alone, one under concurrent agentic load — and computes the criterion"
    " from the operator's agreed legacy limits. It proves nothing beyond the conditions it ran"
    " under, and it NEVER hides a slowed or failing legacy response: both phases' latency,"
    " error and availability numbers are in the report whatever the verdict. A limit nobody"
    " agreed blocks the verdict — it is never a pass."
)


class CoexistenceRefusal(RuntimeError):
    """The coexistence criterion is refused; ``reason`` names the offending input."""

    def __init__(self, reason: str, message: str):
        self.reason = reason
        super().__init__(message)


# ---------------------------------------------------------------------------
# The measurements
# ---------------------------------------------------------------------------


def _measurement_ok(measurement: dict, case_id: str) -> bool:
    """Whether one legacy measurement succeeded."""
    if "ok" in measurement:
        return bool(measurement.get("ok"))
    status = measurement.get("http_status")
    if isinstance(status, int) and not isinstance(status, bool):
        return 200 <= status < 400
    raise CoexistenceRefusal(
        "invalid_measurement",
        f"the legacy measurement for {case_id!r} carries neither an ok flag nor an http_status —"
        " a measurement with no outcome cannot be counted as a success",
    )


def _phase_stats(measurements: dict, phase: str) -> dict:
    """One phase's legacy numbers: the count, the failures, the availability,
    the error rate and the latency distribution.

    The numbers are reported whatever the verdict — a phase whose latency
    degraded is visible here, not smoothed away.
    """
    walls: list[float] = []
    n_ok = 0
    n_failed = 0
    for case_id, measurement in sorted(measurements.items()):
        if not isinstance(measurement, dict):
            raise CoexistenceRefusal(
                "invalid_measurement",
                f"the legacy measurement for {case_id!r} in the {phase} phase is not a mapping",
            )
        if _measurement_ok(measurement, case_id):
            n_ok += 1
        else:
            n_failed += 1
        wall = measurement.get("wall_ms")
        if isinstance(wall, (int, float)) and not isinstance(wall, bool):
            walls.append(float(wall))
    total = n_ok + n_failed
    ordered = sorted(walls)
    return {
        "phase": phase,
        "n_requests": total,
        "n_ok": n_ok,
        "n_failed": n_failed,
        "availability": (n_ok / total) if total else None,
        "error_rate": (n_failed / total) if total else None,
        "latency_ms": {
            "n": len(ordered),
            "min": ordered[0] if ordered else None,
            "median": _median(ordered),
            "max": ordered[-1] if ordered else None,
            "p95": _percentile(ordered, 95),
        },
        "failures": [
            {"case_id": case_id, "http_status": measurements[case_id].get("http_status")}
            for case_id, measurement in sorted(measurements.items())
            if isinstance(measurement, dict) and not _measurement_ok(measurement, case_id)
        ],
    }


def _median(ordered: list[float]) -> float | None:
    if not ordered:
        return None
    middle = len(ordered) // 2
    if len(ordered) % 2:
        return ordered[middle]
    return (ordered[middle - 1] + ordered[middle]) / 2


def _percentile(ordered: list[float], percentile: float) -> float | None:
    """The nearest-rank percentile — no interpolation, so a reported p95 is a
    measured value."""
    if not ordered:
        return None
    rank = max(1, min(len(ordered), int(-(-percentile * len(ordered) // 100))))
    return ordered[rank - 1]


def _legacy_metrics(stats: dict) -> dict:
    """The metrics a limit may bound, read off one phase's numbers."""
    latency = stats.get("latency_ms") or {}
    return {
        "latency_median_ms": latency.get("median"),
        "latency_max_ms": latency.get("max"),
        "latency_p95_ms": latency.get("p95"),
        "error_rate": stats.get("error_rate"),
        "availability": stats.get("availability"),
    }


# ---------------------------------------------------------------------------
# The limits — applied, never authored
# ---------------------------------------------------------------------------


def _normalize_operator(value) -> str | None:
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    return candidate if candidate in OPERATORS else None


def _compare(operator: str, measured, threshold) -> bool | None:
    if not isinstance(measured, (int, float)) or isinstance(measured, bool):
        return None
    if not isinstance(threshold, (int, float)) or isinstance(threshold, bool):
        return None
    if operator == ">=":
        return measured >= threshold
    if operator == "<=":
        return measured <= threshold
    if operator == ">":
        return measured > threshold
    if operator == "<":
        return measured < threshold
    if operator == "==":
        return measured == threshold
    return None


def _apply_limits(limits: dict | None, loaded_metrics: dict) -> dict:
    """Apply the agreed legacy limits to the LOADED phase.

    A limit whose metric is unknown to the harness, whose direction is
    unstated or whose metric the measurement does not carry is recorded as
    NOT MEASURABLE / UNINTERPRETABLE — and both BLOCK the verdict. A limit
    that fails is a FAIL. Nothing here ever defaults a limit.
    """
    if limits is None:
        return {
            "present": False,
            "verdict": VERDICT_BLOCKED,
            "reason": (
                "no agreed legacy latency/error/availability limits were supplied — the criterion"
                " is BLOCKED, never a pass (the operator's decision, the harness's to apply)"
            ),
            "limits": [],
        }
    entries = limits.get("limits") if isinstance(limits, dict) else None
    if not isinstance(entries, dict) or not entries:
        raise CoexistenceRefusal(
            "invalid_limits",
            "the legacy limits artifact carries no limits — a limits file with no limit is not a"
            " criterion",
        )
    records = []
    for name in sorted(entries):
        bound = entries[name]
        if not isinstance(bound, dict):
            records.append(
                {
                    "metric": name,
                    "operator": None,
                    "threshold": bound,
                    "measured": None,
                    "outcome": LIMIT_UNINTERPRETABLE,
                    "reason": "the limit carries no comparable direction — recorded, never guessed",
                }
            )
            continue
        operator = _normalize_operator(bound.get("operator") or bound.get("op") or bound.get("comparison"))
        threshold = bound.get("threshold")
        if threshold is None:
            threshold = bound.get("value")
        if operator is None:
            if isinstance(bound.get("min"), (int, float)):
                operator, threshold = ">=", bound.get("min")
            elif isinstance(bound.get("max"), (int, float)):
                operator, threshold = "<=", bound.get("max")
        measured = loaded_metrics.get(name)
        if operator is None:
            outcome, reason = LIMIT_UNINTERPRETABLE, (
                "the limit carries no comparable direction — recorded, never guessed"
            )
            comparison = None
        elif name not in LEGACY_METRICS or measured is None:
            outcome = LIMIT_NOT_MEASURABLE
            reason = (
                f"the measurement carries no {name!r} — the limit is not measurable here and"
                " never passes unmeasured"
            )
            comparison = None
        else:
            comparison = _compare(operator, measured, threshold)
            outcome = LIMIT_PASS if comparison else LIMIT_FAIL
            reason = None
        records.append(
            {
                "metric": name,
                "operator": operator,
                "threshold": threshold,
                "measured": measured,
                "outcome": outcome,
                "comparison": comparison,
                "reason": reason,
            }
        )
    outcomes = {record["outcome"] for record in records}
    if LIMIT_FAIL in outcomes:
        verdict = VERDICT_FAIL
    elif LIMIT_NOT_MEASURABLE in outcomes or LIMIT_UNINTERPRETABLE in outcomes:
        verdict = VERDICT_BLOCKED
    else:
        verdict = VERDICT_PASS
    return {
        "present": True,
        "verdict": verdict,
        "limits": records,
        "reason": None,
    }


# ---------------------------------------------------------------------------
# The agentic load — the measured saturation / admission response
# ---------------------------------------------------------------------------


def _agent_load_summary(agent_load: dict) -> dict:
    """The load's own record: the concurrency, the terminal outcomes, the
    admission refusals and the resource consumption under load.

    A request that neither answered nor was refused is a SILENT failure — the
    lane queued it or the run died — and the criterion fails on it.
    """
    outcomes = agent_load.get("outcomes") or {}
    if not isinstance(outcomes, dict):
        raise CoexistenceRefusal("invalid_measurement", "the agentic load's outcomes are not a mapping")
    n_requests = agent_load.get("requests")
    if not isinstance(n_requests, int) or isinstance(n_requests, bool):
        n_requests = sum(int(count) for count in outcomes.values() if isinstance(count, int))
    n_terminal = sum(int(count) for count in outcomes.values() if isinstance(count, int))
    n_without_terminal = agent_load.get("n_without_terminal_outcome")
    if not isinstance(n_without_terminal, int) or isinstance(n_without_terminal, bool):
        n_without_terminal = max(0, n_requests - n_terminal)
    n_refusals = agent_load.get("n_admission_refusals")
    if not isinstance(n_refusals, int) or isinstance(n_refusals, bool):
        n_refusals = int(outcomes.get("admission_refused") or 0)
    usage_records = agent_load.get("usage_records") or []
    if not isinstance(usage_records, list):
        raise CoexistenceRefusal("invalid_measurement", "the agentic load's usage_records are not a list")
    totals = {
        counter: {
            "sum": sum(
                float(record[counter])
                for record in usage_records
                if isinstance(record, dict)
                and isinstance(record.get(counter), (int, float))
                and not isinstance(record.get(counter), bool)
            ),
            "n_rows": sum(
                1
                for record in usage_records
                if isinstance(record, dict) and isinstance(record.get(counter), (int, float))
            ),
        }
        for counter in COST_COUNTERS
    }
    return {
        "concurrency": agent_load.get("concurrency"),
        "requests": n_requests,
        "outcomes": outcomes,
        "n_admission_refusals": n_refusals,
        "admission_refusal_rate": (n_refusals / n_requests) if n_requests else None,
        "n_without_terminal_outcome": n_without_terminal,
        "every_request_reached_a_terminal_outcome": n_without_terminal == 0,
        "defined_admission_response": DEFINED_ADMISSION_RESPONSE,
        "observed_admission_response": agent_load.get("admission_response"),
        "resource_consumption_under_load": {
            "surface": "the agentic load's usage records (the run's own cost surface)",
            "totals": totals,
            "n_usage_records": len(usage_records),
            "note": (
                "the resource consumption under concurrent load is a measured surface (M-5); an"
                " absent surface is recorded as absent, never as a zero"
            ),
        },
    }


# ---------------------------------------------------------------------------
# The report
# ---------------------------------------------------------------------------


def coexistence_report_digest(report: dict) -> str:
    """The report's digest, recomputed over the body minus the embedded
    ``digest`` key — the verifiable identity a rebuild must reproduce."""
    body = {key: value for key, value in report.items() if key != "digest"}
    return sha256_json(body)


def build_coexistence_report(
    *,
    control_measurements: dict,
    loaded_measurements: dict,
    agent_load: dict,
    limits: dict | None = None,
    lineage: dict | None = None,
    created_utc: str | None = None,
) -> dict:
    """Build the coexistence criterion report — a pure function of its inputs
    plus the pinned ``created_utc``.

    ``control_measurements`` and ``loaded_measurements`` are the two phases'
    legacy measurements, keyed by case id; each measurement carries an
    ``http_status`` or an ``ok`` flag (and optionally a ``wall_ms``).
    ``agent_load`` is the concurrent agentic load's own record.
    ``limits`` is the OPERATOR's agreed legacy limits — the artifact the
    criterion applies; without it the verdict is BLOCKED.
    ``lineage`` is the measurement conditions the limits bind to (the corpus
    fingerprint and the assessment-set digest); a limits artifact recorded
    against another lineage is refused.
    """
    if not isinstance(control_measurements, dict) or not control_measurements:
        raise CoexistenceRefusal(
            "missing_artifact",
            "the control phase's legacy measurements are missing — a comparison needs both phases",
        )
    if not isinstance(loaded_measurements, dict) or not loaded_measurements:
        raise CoexistenceRefusal(
            "missing_artifact",
            "the loaded phase's legacy measurements are missing — a comparison needs both phases",
        )
    if not isinstance(agent_load, dict) or not agent_load:
        raise CoexistenceRefusal(
            "missing_artifact",
            "the agentic load's record is missing — the coexistence criterion compares the legacy"
            " path UNDER a load, not alone",
        )

    if limits is not None and lineage:
        for key in ("corpus_fingerprint", "assessment_set_sha256"):
            declared = limits.get(key)
            if declared is not None and declared != lineage.get(key):
                raise CoexistenceRefusal(
                    "limits_lineage_mismatch",
                    f"the legacy limits artifact was recorded against another {key} — the criterion"
                    " applies one measurement's limits to another measurement — refusing before the"
                    " report is built",
                )

    control = _phase_stats(control_measurements, "control")
    loaded = _phase_stats(loaded_measurements, "loaded")
    load_summary = _agent_load_summary(agent_load)
    applied = _apply_limits(limits, _legacy_metrics(loaded))

    # The legacy regression itself — the control against the loaded phase. It
    # is reported ALWAYS: the criterion's verdict comes from the agreed
    # limits, but the reader must see the delta whatever it is.
    control_metrics = _legacy_metrics(control)
    loaded_metrics = _legacy_metrics(loaded)
    regression = {}
    for name in LEGACY_METRICS:
        before = control_metrics.get(name)
        after = loaded_metrics.get(name)
        regression[name] = {
            "control": before,
            "loaded": after,
            "delta": (after - before) if isinstance(before, (int, float)) and isinstance(after, (int, float)) else None,
        }

    # The saturation criterion: the lane refuses a saturated run, it never
    # queues it. A request that reached no terminal outcome is a silent
    # failure and fails the criterion on its own.
    saturation_ok = bool(load_summary["every_request_reached_a_terminal_outcome"])
    verdict = applied["verdict"]
    if not saturation_ok and verdict != VERDICT_FAIL:
        verdict = VERDICT_FAIL
    reasons = []
    if applied.get("reason"):
        reasons.append(applied["reason"])
    if not saturation_ok:
        reasons.append(
            "the agentic load left "
            f"{load_summary['n_without_terminal_outcome']} request(s) without a terminal outcome —"
            " the admission lane refuses a saturated run, it never queues it: the defined response"
            " was not observed"
        )
    for record in applied["limits"]:
        if record["outcome"] == LIMIT_FAIL:
            reasons.append(
                f"the legacy {record['metric']} under load was {record['measured']} against the"
                f" agreed limit {record['operator']} {record['threshold']}"
            )
        elif record["outcome"] in (LIMIT_NOT_MEASURABLE, LIMIT_UNINTERPRETABLE):
            reasons.append(record["reason"])

    body = {
        "artifact": COEXISTENCE_REPORT_ARTIFACT,
        "version": COEXISTENCE_REPORT_VERSION,
        "protocol_version": PROTOCOL_VERSION,
        "criterion": "legacy non-regression under concurrent agentic load (NFR-3)",
        "created_utc": created_utc or datetime.now(UTC).isoformat(timespec="seconds"),
        "honest_evidence": HONEST_EVIDENCE_STATEMENT,
        "inputs": {
            "control_measurements_sha256": sha256_json(control_measurements),
            "loaded_measurements_sha256": sha256_json(loaded_measurements),
            "agent_load_sha256": sha256_json(agent_load),
            "limits_sha256": sha256_json(limits) if limits is not None else None,
            "corpus_fingerprint": (lineage or {}).get("corpus_fingerprint"),
            "assessment_set_sha256": (lineage or {}).get("assessment_set_sha256"),
        },
        "phases": {"control": control, "loaded": loaded},
        "legacy_regression": regression,
        "agentic_load": load_summary,
        "limits": applied,
        "saturation": {
            "defined_response": DEFINED_ADMISSION_RESPONSE,
            "observed_response": load_summary["observed_admission_response"],
            "every_request_reached_a_terminal_outcome": saturation_ok,
            "n_without_terminal_outcome": load_summary["n_without_terminal_outcome"],
        },
        "verdict": {
            "verdict": verdict,
            "reasons": reasons,
            "note": (
                "the legacy numbers of BOTH phases are in this report whatever the verdict — a"
                " report that omitted or smoothed a slowed or failing legacy response is a defect,"
                " not a pass"
            ),
        },
    }
    body["digest"] = coexistence_report_digest(body)
    return body
