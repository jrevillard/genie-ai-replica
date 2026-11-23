# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The counter-metrics report (story 4.4) — CM-1, CM-2, CM-3.

Counter-metrics are FIRST-CLASS results, not a side note inside another
dimension's record. The proof that the agent earned its cost includes showing
that it did not game the comparison:

* **CM-1** — the cost and latency per agentic request against the reference.
  The delta stays VISIBLE: every paired request's delta is recorded with the
  distribution over them. One averaged number never stands in for the delta.
* **CM-2** — the excessive-abstention rate on the questions the reference
  answers correctly. The denominator is a judged fact about the reference run,
  so it arrives as a LINEAGE-VERIFIED campaign artifact (the judge layer's
  output, the reference-defects-ledger pattern) — never from a heuristic
  invented here.
* **CM-3** — the rate of executions hitting a limit or a cancellation, with the
  per-case terminal states beside the rate.

Every absent input is recorded AS ABSENT WITH ITS REASON — a missing
reference-correctness ledger, a configuration with no cost surface — never as a
zero and never silently dropped. The report is a pure function of its inputs
plus a pinned ``created_utc``: the same inputs and the same pin digest
identically.

The refusals are typed (:class:`CounterMetricsRefusal`) and carry a
machine-readable ``reason``.
"""

from __future__ import annotations

import statistics
from datetime import UTC, datetime

from . import PROTOCOL_VERSION
from .manifest import manifest_digest, sha256_json

COUNTER_METRICS_REPORT_VERSION = "1.0.0"
COUNTER_METRICS_REPORT_ARTIFACT = "counter-metrics-report"
REFERENCE_CORRECTNESS_ARTIFACT = "reference-correctness"

# The three counter-metrics — first-class, top-level entries of the report.
CM_METRICS = ("CM-1", "CM-2", "CM-3")

CM1_NAME = "cost_and_latency_per_agentic_request"
CM2_NAME = "excessive_abstention_rate"
CM3_NAME = "limit_and_cancellation_rate"

HONEST_EVIDENCE_STATEMENT = (
    "Counter-metrics honest evidence: this report records what the runs spent and where the"
    " candidate fell back. The CM-1 delta is per request — the distribution sits beside the"
    " per-request deltas, and one average never stands in for them. An absent input is"
    " recorded as absent with its reason, never as a zero. A counter-metric is evidence for"
    " the conditions these runs exercised, never a proof that the agent cannot game the"
    " comparison."
)

CM1_SURFACE = (
    "the candidate rows' per-request wall_ms and usage_record against the reference rows'"
    " per-request wall_ms and resource record — the agentic cost surface is the run's"
    " model_calls / aux_model_calls / tool_calls / prompt_tokens / completion_tokens /"
    " wall_clock_seconds"
)
CM2_SURFACE = (
    "the candidate rows' mechanical abstention facts (abstained / abstention_reason) over the"
    " cases the lineage-verified reference-correctness ledger names"
)
CM3_SURFACE = (
    "the candidate rows' terminal states — config C: usage_record.outcome =="
    " budget_exhausted and outcome == cancelled; config B: abstention_reason =="
    " result_budget_exhausted"
)

# The resource counters a cost delta compares (both sides must carry them).
COST_COUNTERS = (
    "model_calls",
    "aux_model_calls",
    "tool_calls",
    "prompt_tokens",
    "completion_tokens",
    "wall_clock_seconds",
)

# The config-C limit marker and the config-B one — the two shapes a limit hit
# takes. They live here so the counter-metric and the report name them from
# one source.
LIMIT_MARKER_C = "budget_exhausted"
LIMIT_MARKER_B = "result_budget_exhausted"

CANCELLED_STATE = "cancelled"
ANSWERED_STATE = "answered"


class CounterMetricsRefusal(RuntimeError):
    """The counter-metrics report is refused; ``reason`` names the offense."""

    def __init__(self, reason: str, message: str):
        self.reason = reason
        super().__init__(message)


# ---------------------------------------------------------------------------
# The reference-correctness ledger (CM-2's denominator) — the campaign artifact
# ---------------------------------------------------------------------------


def reference_correctness_file(
    *,
    corpus_fingerprint: str,
    assessment_set_sha256: str,
    reference_manifest: dict,
    correct_case_ids: list,
) -> dict:
    """Assemble one reference-correctness ledger record (campaign-authored —
    the harness never authors judge output; ``correct_case_ids`` is passed in
    verbatim).

    The shape mirrors the reference-defects ledger: the artifact kind, the
    corpus fingerprint, the assessment-set digest and the reference-manifest
    digest the correctness was recorded against.
    """
    return {
        "artifact": REFERENCE_CORRECTNESS_ARTIFACT,
        "corpus_fingerprint": corpus_fingerprint,
        "assessment_set_sha256": assessment_set_sha256,
        "reference_manifest_sha256": manifest_digest(reference_manifest),
        "correct_case_ids": [str(case_id) for case_id in correct_case_ids],
    }


def verify_correctness_lineage(
    ledger: dict,
    *,
    corpus_fingerprint: str,
    assessment_set_sha256: str,
    reference_manifest_sha256: str,
) -> None:
    """Lineage-verify one ledger against THIS comparison's lineage; raise
    :class:`CounterMetricsRefusal` naming the mismatch — before any report is
    built."""
    if not isinstance(ledger, dict):
        raise CounterMetricsRefusal(
            "correctness_not_a_ledger",
            f"the supplied correctness file is a {type(ledger).__name__}, not a"
            f" {REFERENCE_CORRECTNESS_ARTIFACT!r} artifact — refusing before the report is built",
        )
    if ledger.get("artifact") != REFERENCE_CORRECTNESS_ARTIFACT:
        raise CounterMetricsRefusal(
            "correctness_not_a_ledger",
            f"the supplied correctness file is {ledger.get('artifact')!r}, not a"
            f" {REFERENCE_CORRECTNESS_ARTIFACT!r} artifact — refusing before the report is built",
        )
    mismatched = []
    if ledger.get("corpus_fingerprint") != corpus_fingerprint:
        mismatched.append("the corpus fingerprint")
    if ledger.get("assessment_set_sha256") != assessment_set_sha256:
        mismatched.append("the assessment set digest")
    if ledger.get("reference_manifest_sha256") != reference_manifest_sha256:
        mismatched.append("the reference manifest digest")
    if mismatched:
        raise CounterMetricsRefusal(
            "correctness_lineage_mismatch",
            "the reference-correctness ledger does not cover this comparison:"
            f" {' and '.join(mismatched)} differ — refusing before the report is built",
        )


# ---------------------------------------------------------------------------
# The row readers — the recorded facts, never an invented one
# ---------------------------------------------------------------------------


def _wall_ms(row) -> float | None:
    """The row's wall-clock measurement, None when it carries none."""
    if not isinstance(row, dict):
        return None
    value = row.get("wall_ms")
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return None
    return float(value)


def _resource_record(row) -> dict | None:
    """The row's resource record — the config-C ``usage_record`` or the
    metadata-scoped one. None when the row carries none (a configuration with
    no cost surface)."""
    if not isinstance(row, dict):
        return None
    record = row.get("usage_record")
    if isinstance(record, dict) and record:
        return record
    metadata = row.get("metadata")
    if isinstance(metadata, dict):
        usage = metadata.get("usage")
        if isinstance(usage, dict) and usage:
            return usage
    return None


def _cost_counters(record: dict | None) -> dict:
    """The numeric cost counters of one resource record."""
    if not isinstance(record, dict):
        return {}
    counters = {}
    for key in COST_COUNTERS:
        value = record.get(key)
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            continue
        counters[key] = value
    return counters


def _abstention_fact(row) -> bool | None:
    """Whether the row records an abstention: True (it abstained), False (it
    did not) or None (the row records no abstention fact at all).

    The fact is read from the row's own mechanical fields — never inferred
    from the answer text: an abstention the run did not record is absent, not
    guessed.
    """
    if not isinstance(row, dict):
        return None
    metadata = row.get("metadata")
    holders = [row]
    if isinstance(metadata, dict):
        holders.append(metadata)
    for holder in holders:
        if "abstained" in holder:
            value = holder.get("abstained")
            if isinstance(value, bool):
                return value
            if value is not None:
                return bool(value)
        reason = holder.get("abstention_reason")
        if isinstance(reason, str) and reason.strip():
            return True
    return None


# The terminal states that are neither a limit hit nor a cancellation but
# still did not answer — the failure family. A governed refusal (the
# admission lane refusing a request) is neither: it is recorded as its own
# terminal state, never as a failure.
FAILURE_STATES = frozenset({"error", "stream_error", "http_error", "failure"})


def _terminal_state(row) -> tuple[str, str | None, bool, str | None, bool]:
    """The row's terminal state: ``(state, marker, is_execution, hit_kind,
    answered)``.

    The limit markers are the recorded ones — the config-C usage record's
    ``budget_exhausted`` and the config-B ``result_budget_exhausted``
    abstention reason. A generic failure is recorded as a FAILURE, never
    counted as a limit hit; its count travels beside the rate so a zero limit
    rate never hides a failing execution.
    """
    if not isinstance(row, dict):
        return ("unknown", None, True, None, False)
    record = _resource_record(row)
    usage_outcome = record.get("outcome") if isinstance(record, dict) else None
    if usage_outcome == LIMIT_MARKER_C:
        return (LIMIT_MARKER_C, "usage_record.outcome=budget_exhausted", True, "limit", False)
    outcome = row.get("outcome")
    if isinstance(outcome, str):
        if outcome == CANCELLED_STATE or row.get("cancelled") is True:
            return (CANCELLED_STATE, "outcome=cancelled", True, "cancellation", False)
        if outcome == ANSWERED_STATE:
            return (ANSWERED_STATE, None, True, None, True)
        if outcome == "skipped":
            return ("skipped", None, False, None, False)
        kind = "failure" if outcome in FAILURE_STATES else None
        return (outcome, None, True, kind, False)
    status = row.get("status")
    if isinstance(status, str):
        # The config-B limit marker rides the abstention reason of an
        # otherwise-ok row: the run answered by hitting its result budget.
        if row.get("abstention_reason") == LIMIT_MARKER_B:
            return (LIMIT_MARKER_C, f"abstention_reason={LIMIT_MARKER_B}", True, "limit", False)
        if status == "skipped":
            return ("skipped", None, False, None, False)
        if status == "ok":
            return (ANSWERED_STATE, None, True, None, True)
        return ("failure", None, True, "failure", False)
    return ("unknown", None, True, None, False)


# ---------------------------------------------------------------------------
# The three counter-metrics
# ---------------------------------------------------------------------------


def _distribution(values: list[float]) -> dict:
    """min / median / max over the deltas — the distribution sits BESIDE the
    per-request deltas, never instead of them."""
    ordered = sorted(float(value) for value in values)
    return {
        "n": len(ordered),
        "min": ordered[0],
        "median": float(statistics.median(ordered)),
        "max": ordered[-1],
    }


def _build_cm1(reference_rows: dict, candidate_rows: dict) -> dict:
    """CM-1 — the per-request cost and latency delta against the reference."""
    paired = sorted(set(reference_rows) & set(candidate_rows))
    latency_rows = []
    for case_id in paired:
        reference_wall = _wall_ms(reference_rows.get(case_id))
        candidate_wall = _wall_ms(candidate_rows.get(case_id))
        if reference_wall is None or candidate_wall is None:
            continue
        latency_rows.append(
            {
                "case_id": case_id,
                "reference_wall_ms": reference_wall,
                "candidate_wall_ms": candidate_wall,
                "delta_ms": round(candidate_wall - reference_wall, 3),
            }
        )
    # The agentic cost surface — the candidate's own spend, per request.
    agentic_rows = []
    for case_id in paired:
        record = _resource_record(candidate_rows.get(case_id))
        counters = _cost_counters(record)
        if not counters:
            continue
        agentic_rows.append({"case_id": case_id, **counters})
    # The totals sum the counters the rows actually carry and name how many
    # rows contributed — a bare sum over a subset would read as the whole.
    totals: dict = {}
    for key in COST_COUNTERS:
        values = [row[key] for row in agentic_rows if key in row]
        if values:
            totals[key] = {"sum": sum(values), "n_rows": len(values)}
    # The cost DELTA — available only when BOTH sides carry a cost surface.
    cost_deltas = []
    for case_id in paired:
        reference_counters = _cost_counters(_resource_record(reference_rows.get(case_id)))
        candidate_counters = _cost_counters(_resource_record(candidate_rows.get(case_id)))
        shared = sorted(set(reference_counters) & set(candidate_counters))
        if not shared:
            continue
        cost_deltas.append(
            {
                "case_id": case_id,
                **{f"delta_{key}": candidate_counters[key] - reference_counters[key] for key in shared},
            }
        )
    if latency_rows:
        latency_block = {
            "available": True,
            "unit": "ms",
            "per_request": latency_rows,
            "distribution": _distribution([row["delta_ms"] for row in latency_rows]),
        }
    else:
        latency_block = {
            "available": False,
            "not_available_reason": (
                "no paired case carries a wall_ms on both sides — the latency delta is not"
                " computable from the supplied rows"
            ),
        }
    reference_has_cost = any(
        _cost_counters(_resource_record(reference_rows.get(case_id))) for case_id in paired
    )
    candidate_has_cost = bool(agentic_rows)
    if not reference_has_cost:
        cost_delta = {
            "available": False,
            "not_available_reason": (
                "the reference rows carry no resource fields — the reference cost surface is"
                " unavailable, so the cost delta is not computable (the latency delta is"
                " reported beside it)"
            ),
        }
    elif not candidate_has_cost:
        cost_delta = {
            "available": False,
            "not_available_reason": (
                "the candidate rows carry no resource record — the candidate cost surface is"
                " unavailable, so the cost delta is not computable (the latency delta is"
                " reported beside it)"
            ),
        }
    else:
        cost_delta = {
            "available": True,
            "per_request": cost_deltas,
            "n_paired": len(cost_deltas),
        }
    agentic_surface = (
        {
            "available": True,
            "per_request": agentic_rows,
            "totals": totals,
            "unit": "the run's own counters (calls, tokens, seconds)",
        }
        if agentic_rows
        else {
            "available": False,
            "not_available_reason": (
                "the candidate rows carry no resource record — this configuration has no cost"
                " surface to report"
            ),
        }
    )
    available = latency_block["available"] or cost_delta["available"] or agentic_surface["available"]
    if not available:
        return {
            "metric": "CM-1",
            "name": CM1_NAME,
            "measurement_surface": CM1_SURFACE,
            "available": False,
            "not_available_reason": (
                "no paired case carries a wall_ms and no side carries a resource record —"
                " neither the latency delta nor the cost surface is computable from the"
                " supplied rows"
            ),
        }
    return {
        "metric": "CM-1",
        "name": CM1_NAME,
        "measurement_surface": CM1_SURFACE,
        "available": True,
        "values": {
            "n_paired_cases": len(paired),
            "latency_delta": latency_block,
            "cost_delta": cost_delta,
            "agentic_cost_surface": agentic_surface,
        },
        "notes": [
            "the delta is per request: the distribution describes those deltas, it does not"
            " replace them",
        ],
    }


def _build_cm2(candidate_rows: dict, correctness_ledger: dict | None) -> dict:
    """CM-2 — the excessive-abstention rate on the questions the reference
    answers correctly."""
    if correctness_ledger is None:
        return {
            "metric": "CM-2",
            "name": CM2_NAME,
            "measurement_surface": CM2_SURFACE,
            "available": False,
            "not_available_reason": (
                "no reference-correctness ledger was supplied — the denominator (the questions"
                " the reference answers correctly) is a judge-layer fact that no protocol"
                " artifact carries, so the rate is NOT computable and is NOT reported as zero"
            ),
        }
    correct_ids = [str(case_id) for case_id in (correctness_ledger.get("correct_case_ids") or [])]
    if not correct_ids:
        return {
            "metric": "CM-2",
            "name": CM2_NAME,
            "measurement_surface": CM2_SURFACE,
            "available": False,
            "not_available_reason": (
                "the reference-correctness ledger names no case id — the denominator is empty,"
                " so the rate is NOT computable and is NOT reported as zero"
            ),
            "correctness_ledger_sha256": sha256_json(correctness_ledger),
        }
    abstentions = 0
    unrecorded = []
    for case_id in correct_ids:
        fact = _abstention_fact(candidate_rows.get(case_id))
        if fact is None:
            unrecorded.append(case_id)
        elif fact:
            abstentions += 1
    if unrecorded:
        return {
            "metric": "CM-2",
            "name": CM2_NAME,
            "measurement_surface": CM2_SURFACE,
            "available": False,
            "not_available_reason": (
                f"the candidate records no abstention fact for {len(unrecorded)} of the"
                f" reference-correct case(s) ({', '.join(unrecorded[:5])}) — an unrecorded"
                " abstention is absent, not a zero; the rate is NOT computable"
            ),
            "correctness_ledger_sha256": sha256_json(correctness_ledger),
        }
    total = len(correct_ids)
    return {
        "metric": "CM-2",
        "name": CM2_NAME,
        "measurement_surface": CM2_SURFACE,
        "available": True,
        "values": {
            "n_reference_correct_cases": total,
            "n_candidate_abstentions": abstentions,
            "rate": abstentions / total,
        },
        "correctness_ledger_sha256": sha256_json(correctness_ledger),
    }


def _build_cm3(candidate_rows: dict) -> dict:
    """CM-3 — the rate of executions hitting a limit or a cancellation."""
    per_case = []
    for case_id in sorted(candidate_rows):
        state, marker, is_execution, hit_kind, answered = _terminal_state(candidate_rows.get(case_id))
        if not is_execution:
            continue
        per_case.append(
            {
                "case_id": case_id,
                "terminal_state": state,
                "marker": marker,
                "hit": hit_kind in ("limit", "cancellation"),
                "hit_kind": hit_kind,
                "answered": answered,
            }
        )
    if not per_case:
        return {
            "metric": "CM-3",
            "name": CM3_NAME,
            "measurement_surface": CM3_SURFACE,
            "available": False,
            "not_available_reason": (
                "the candidate records no execution — the limit/cancellation rate has no"
                " denominator and is NOT reported as zero"
            ),
        }
    n_executions = len(per_case)
    n_limit = sum(1 for row in per_case if row["hit_kind"] == "limit")
    n_cancel = sum(1 for row in per_case if row["hit_kind"] == "cancellation")
    n_failure = sum(1 for row in per_case if row["hit_kind"] == "failure")
    n_answered = sum(1 for row in per_case if row["answered"])
    n_hits = n_limit + n_cancel
    return {
        "metric": "CM-3",
        "name": CM3_NAME,
        "measurement_surface": CM3_SURFACE,
        "available": True,
        "values": {
            "n_executions": n_executions,
            "n_answered": n_answered,
            "n_limit_hits": n_limit,
            "n_cancellation_hits": n_cancel,
            "n_hits": n_hits,
            "n_failure_rows": n_failure,
            "rate": n_hits / n_executions,
            "failure_rate": n_failure / n_executions,
            "per_case_terminal_states": per_case,
        },
        "notes": [
            "a generic failure is recorded as a failure, never as a limit hit — its count and"
            " rate travel beside the limit/cancellation rate so a zero limit rate never hides a"
            " failing execution",
        ],
    }


# ---------------------------------------------------------------------------
# The report
# ---------------------------------------------------------------------------


def counter_metrics_report_digest(report: dict) -> str:
    """The report's digest, recomputed over the body minus the embedded
    ``digest`` key — the verifiable identity a rebuild must reproduce."""
    body = {key: value for key, value in report.items() if key != "digest"}
    return sha256_json(body)


def build_counter_metrics_report(
    *,
    reference_rows: dict,
    candidate_rows: dict,
    reference_manifest: dict | None = None,
    correctness_ledger: dict | None = None,
    created_utc: str | None = None,
) -> dict:
    """Build the counter-metrics report — a pure function of its inputs plus
    the pinned ``created_utc``.

    Raises :class:`CounterMetricsRefusal` before any building when a supplied
    correctness ledger cannot be lineage-verified (no reference manifest, or a
    ledger recorded against another corpus / set / reference).
    """
    corpus_fingerprint = None
    assessment_set_sha256 = None
    reference_manifest_sha256 = None
    if isinstance(reference_manifest, dict) and reference_manifest:
        corpus_fingerprint = (reference_manifest.get("corpus") or {}).get("fingerprint")
        assessment_set_sha256 = ((reference_manifest.get("sets") or {}).get("assessment") or {}).get(
            "sha256"
        )
        reference_manifest_sha256 = manifest_digest(reference_manifest)
    if correctness_ledger is not None:
        if not reference_manifest_sha256:
            raise CounterMetricsRefusal(
                "missing_reference_manifest",
                "a reference-correctness ledger was supplied without a reference manifest — the"
                " ledger's lineage cannot be verified, so no rate is reported",
            )
        verify_correctness_lineage(
            correctness_ledger,
            corpus_fingerprint=corpus_fingerprint,
            assessment_set_sha256=assessment_set_sha256,
            reference_manifest_sha256=reference_manifest_sha256,
        )
    counter_metrics = {
        "CM-1": _build_cm1(reference_rows, candidate_rows),
        "CM-2": _build_cm2(candidate_rows, correctness_ledger),
        "CM-3": _build_cm3(candidate_rows),
    }
    body = {
        "artifact": COUNTER_METRICS_REPORT_ARTIFACT,
        "version": COUNTER_METRICS_REPORT_VERSION,
        "protocol_version": PROTOCOL_VERSION,
        "created_utc": created_utc or datetime.now(UTC).isoformat(timespec="seconds"),
        "honest_evidence": HONEST_EVIDENCE_STATEMENT,
        "inputs": {
            "reference_rows_sha256": sha256_json(reference_rows),
            "candidate_rows_sha256": sha256_json(candidate_rows),
            "n_reference_rows": len(reference_rows),
            "n_candidate_rows": len(candidate_rows),
            "reference_manifest_sha256": reference_manifest_sha256,
            "corpus_fingerprint": corpus_fingerprint,
            "assessment_set_sha256": assessment_set_sha256,
            "correctness_ledger_sha256": (
                sha256_json(correctness_ledger) if correctness_ledger is not None else None
            ),
        },
        "counter_metrics": counter_metrics,
    }
    body["digest"] = counter_metrics_report_digest(body)
    return body
