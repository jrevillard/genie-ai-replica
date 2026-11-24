# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The counter-metrics report — CM-1, CM-2, CM-3.

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

from datetime import UTC, datetime
from typing import NamedTuple

from . import PROTOCOL_VERSION
from .drivers import (
    OUTCOME_ANSWERED,
    OUTCOME_CANCELLED,
    OUTCOME_CONFIGURATION_ERROR,
    OUTCOME_ERROR,
    OUTCOME_HTTP_ERROR,
    OUTCOME_INVALID_REQUEST,
    OUTCOME_STREAM_ERROR,
)
from .manifest import digest_without_embedded, manifest_digest, manifest_lineage, sha256_json

COUNTER_METRICS_REPORT_VERSION = "1.0.0"
COUNTER_METRICS_REPORT_ARTIFACT = "counter-metrics-report"
REFERENCE_CORRECTNESS_ARTIFACT = "reference-correctness"

# The three counter-metrics — first-class, top-level entries of the report —
# are named by the keys of the report's ``counter_metrics`` mapping.
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

# The resource counters a cost delta compares (both sides must carry them).
COST_COUNTERS = (
    "model_calls",
    "aux_model_calls",
    "tool_calls",
    "prompt_tokens",
    "completion_tokens",
    "wall_clock_seconds",
)

CM1_SURFACE = (
    "the candidate rows' per-request wall_ms and usage_record against the reference rows'"
    " per-request wall_ms and resource record — the agentic cost surface is the run's"
    f" {' / '.join(COST_COUNTERS)}"
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

# The config-C limit marker and the config-B one — the two shapes a limit hit
# takes. They live here so the counter-metric and the report name them from
# one source.
LIMIT_MARKER_C = "budget_exhausted"
LIMIT_MARKER_B = "result_budget_exhausted"


class CounterMetricsRefusal(RuntimeError):
    """The counter-metrics report is refused; ``reason`` names the offense."""

    def __init__(self, reason: str, message: str):
        self.reason = reason
        super().__init__(message)


# ---------------------------------------------------------------------------
# The two record spellings every metric and every absent surface shares
# ---------------------------------------------------------------------------


def _cm_record(metric: str, name: str, surface: str, **fields) -> dict:
    """One counter-metric record: the identity stamped once, the metric's own
    fields beside it (``available``/``values``/``not_available_reason``/...)."""
    return {"metric": metric, "name": name, "measurement_surface": surface, **fields}


def _unavailable(reason: str, **extra) -> dict:
    """The absence envelope: an input is recorded as absent WITH its reason —
    never as a zero, never silently dropped."""
    return {"available": False, "not_available_reason": reason, **extra}


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
    ids = ledger.get("correct_case_ids")
    if not isinstance(ids, list):
        raise CounterMetricsRefusal(
            "correctness_invalid_ids",
            "the reference-correctness ledger's correct_case_ids is a"
            f" {type(ids).__name__}, not a list — refusing before the report is built",
        )
    offenders = [
        value for value in ids if isinstance(value, bool) or not isinstance(value, (str, int))
    ]
    if offenders:
        raise CounterMetricsRefusal(
            "correctness_invalid_ids",
            "the reference-correctness ledger's correct_case_ids carry a"
            f" {type(offenders[0]).__name__} — the ids are case-id scalars (strings or"
            " integers, never booleans or nested values); refusing before the report is built",
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
            # A non-boolean value is never coerced — the string "false" is not
            # an abstention. It falls through to the reason check below and
            # otherwise counts as unrecorded.
        reason = holder.get("abstention_reason")
        if isinstance(reason, str) and reason.strip():
            return True
    return None


# The terminal states that are neither a limit hit nor a cancellation but
# still did not answer — the failure family, named from the drivers' outcome
# vocabulary (the same spelling the config-C rows carry) plus the config-B
# status literal. A governed refusal (the admission lane refusing a request,
# OUTCOME_ADMISSION_REFUSED) is deliberately EXCLUDED: it is neither a failure
# nor a limit hit — it is recorded as its own terminal state.
FAILURE_STATES = frozenset(
    {
        OUTCOME_ERROR,
        OUTCOME_STREAM_ERROR,
        OUTCOME_HTTP_ERROR,
        OUTCOME_CONFIGURATION_ERROR,
        OUTCOME_INVALID_REQUEST,
        "failure",
    }
)


class TerminalState(NamedTuple):
    """One row's terminal state — the recorded facts CM-3 reads.

    ``state``/``marker`` name what the row recorded; ``is_execution`` separates
    a run from a skipped case (a skipped case has no denominator); ``hit_kind``
    is ``limit``/``cancellation``/``failure``/None; ``answered`` says whether
    the execution delivered an answer.
    """

    state: str
    marker: str | None
    is_execution: bool
    hit_kind: str | None
    answered: bool


def _terminal_state(row) -> TerminalState:
    """The row's terminal state.

    The limit markers are the recorded ones — the config-C usage record's
    ``budget_exhausted`` and the config-B ``result_budget_exhausted``
    abstention reason. A generic failure is recorded as a FAILURE, never
    counted as a limit hit; its count travels beside the rate so a zero limit
    rate never hides a failing execution.
    """
    if not isinstance(row, dict):
        return TerminalState("unknown", None, True, None, False)
    record = _resource_record(row)
    usage_outcome = record.get("outcome") if isinstance(record, dict) else None
    if usage_outcome == LIMIT_MARKER_C:
        return TerminalState(LIMIT_MARKER_C, "usage_record.outcome=budget_exhausted", True, "limit", False)
    outcome = row.get("outcome")
    if isinstance(outcome, str):
        if outcome == OUTCOME_CANCELLED or row.get("cancelled") is True:
            return TerminalState(OUTCOME_CANCELLED, "outcome=cancelled", True, "cancellation", False)
        if outcome == OUTCOME_ANSWERED:
            return TerminalState(OUTCOME_ANSWERED, None, True, None, True)
        if outcome == "skipped":
            return TerminalState("skipped", None, False, None, False)
        kind = "failure" if outcome in FAILURE_STATES else None
        return TerminalState(outcome, None, True, kind, False)
    status = row.get("status")
    if isinstance(status, str):
        # The config-B limit marker rides the abstention reason of an
        # otherwise-ok row: the run answered by hitting its result budget.
        if row.get("abstention_reason") == LIMIT_MARKER_B:
            return TerminalState(LIMIT_MARKER_C, f"abstention_reason={LIMIT_MARKER_B}", True, "limit", False)
        if status == "skipped":
            return TerminalState("skipped", None, False, None, False)
        # A recorded abstention on an ANSWERED-SHAPED row is a terminal state
        # of its own — never an answered execution, so CM-3 and CM-2 read the
        # same case the same way. A failing row keeps the failure family: an
        # abstention fact beside an error is not what the run died of.
        if status == "ok" and _abstention_fact(row) is True:
            return TerminalState("abstained", "abstained", True, None, False)
        if status == "ok":
            return TerminalState(OUTCOME_ANSWERED, None, True, None, True)
        return TerminalState("failure", None, True, "failure", False)
    return TerminalState("unknown", None, True, None, False)


# ---------------------------------------------------------------------------
# The three counter-metrics
# ---------------------------------------------------------------------------


def _distribution(values: list[float]) -> dict:
    """min / median / max over the deltas — the distribution sits BESIDE the
    per-request deltas, never instead of them."""
    import capture_baseline  # local import: the capture module's median

    ordered = [float(value) for value in values]
    return {
        "n": len(ordered),
        "min": min(ordered),
        "median": float(capture_baseline.median(ordered)),
        "max": max(ordered),
    }


def _build_cm1(reference_rows: dict, candidate_rows: dict) -> dict:
    """CM-1 — the per-request cost and latency delta against the reference."""
    paired = sorted(set(reference_rows) & set(candidate_rows))
    latency_rows = []
    agentic_rows = []
    cost_deltas = []
    totals: dict = {}
    reference_has_cost = False
    candidate_has_cost = False
    for case_id in paired:
        reference_row = reference_rows.get(case_id)
        candidate_row = candidate_rows.get(case_id)
        # The row readers run ONCE per case: the latency, cost and delta
        # surfaces below all read the same cached counters.
        reference_wall = _wall_ms(reference_row)
        candidate_wall = _wall_ms(candidate_row)
        if reference_wall is not None and candidate_wall is not None:
            latency_rows.append(
                {
                    "case_id": case_id,
                    "reference_wall_ms": reference_wall,
                    "candidate_wall_ms": candidate_wall,
                    "delta_ms": round(candidate_wall - reference_wall, 3),
                }
            )
        reference_counters = _cost_counters(_resource_record(reference_row))
        candidate_counters = _cost_counters(_resource_record(candidate_row))
        if reference_counters:
            reference_has_cost = True
        if candidate_counters:
            candidate_has_cost = True
            # The agentic cost surface — the candidate's own spend, per
            # request. The totals sum the counters the rows actually carry
            # and name how many rows contributed — a bare sum over a subset
            # would read as the whole.
            agentic_rows.append({"case_id": case_id, **candidate_counters})
            for key, value in candidate_counters.items():
                if key in totals:
                    totals[key]["sum"] += value
                    totals[key]["n_rows"] += 1
                else:
                    totals[key] = {"sum": value, "n_rows": 1}
        # The cost DELTA — the counters BOTH sides carry; the candidate-side
        # counters the reference does not carry are named beside the deltas.
        shared = sorted(set(reference_counters) & set(candidate_counters))
        if shared:
            cost_deltas.append(
                {
                    "case_id": case_id,
                    "candidate_only": sorted(set(candidate_counters) - set(reference_counters)),
                    **{
                        f"delta_{key}": candidate_counters[key] - reference_counters[key]
                        for key in shared
                    },
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
        latency_block = _unavailable(
            "no paired case carries a wall_ms on both sides — the latency delta is not"
            " computable from the supplied rows"
        )
    if not reference_has_cost:
        cost_delta = _unavailable(
            "the reference rows carry no resource fields — the reference cost surface is"
            " unavailable, so the cost delta is not computable (the latency delta is"
            " reported beside it)"
        )
    elif not candidate_has_cost:
        cost_delta = _unavailable(
            "the candidate rows carry no resource record — the candidate cost surface is"
            " unavailable, so the cost delta is not computable (the latency delta is"
            " reported beside it)"
        )
    elif not cost_deltas:
        cost_delta = _unavailable(
            "both sides carry resource records but no counter is shared between them —"
            " the cost delta is not computable, and an empty delta is never reported as"
            " a zero delta"
        )
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
        else _unavailable(
            "the candidate rows carry no resource record — this configuration has no cost"
            " surface to report"
        )
    )
    available = latency_block["available"] or cost_delta["available"] or agentic_surface["available"]
    if not available:
        return _cm_record(
            "CM-1",
            CM1_NAME,
            CM1_SURFACE,
            **_unavailable(
                "no paired case carries a wall_ms and no side carries a resource record —"
                " neither the latency delta nor the cost surface is computable from the"
                " supplied rows"
            ),
        )
    return _cm_record(
        "CM-1",
        CM1_NAME,
        CM1_SURFACE,
        available=True,
        values={
            "n_paired_cases": len(paired),
            "latency_delta": latency_block,
            "cost_delta": cost_delta,
            "agentic_cost_surface": agentic_surface,
        },
        notes=[
            "the delta is per request: the distribution describes those deltas, it does not"
            " replace them",
        ],
    )


def _build_cm2(candidate_rows: dict, correctness_ledger: dict | None, ledger_sha256: str | None) -> dict:
    """CM-2 — the excessive-abstention rate on the questions the reference
    answers correctly."""
    if correctness_ledger is None:
        return _cm_record(
            "CM-2",
            CM2_NAME,
            CM2_SURFACE,
            **_unavailable(
                "no reference-correctness ledger was supplied — the denominator (the questions"
                " the reference answers correctly) is a judge-layer fact that no protocol"
                " artifact carries, so the rate is NOT computable and is NOT reported as zero"
            ),
        )
    # The denominator is the ledger's DISTINCT case ids, first occurrence
    # kept — a duplicate entry would inflate the denominator and deflate the
    # rate without anything being measured twice.
    seen: set[str] = set()
    correct_ids = []
    for raw in correctness_ledger.get("correct_case_ids") or []:
        case_id = str(raw)
        if case_id in seen:
            continue
        seen.add(case_id)
        correct_ids.append(case_id)
    if not correct_ids:
        return _cm_record(
            "CM-2",
            CM2_NAME,
            CM2_SURFACE,
            **_unavailable(
                "the reference-correctness ledger names no case id — the denominator is empty,"
                " so the rate is NOT computable and is NOT reported as zero"
            ),
            correctness_ledger_sha256=ledger_sha256,
        )
    abstentions = 0
    unrecorded = []
    for case_id in correct_ids:
        fact = _abstention_fact(candidate_rows.get(case_id))
        if fact is None:
            unrecorded.append(case_id)
        elif fact:
            abstentions += 1
    if unrecorded:
        return _cm_record(
            "CM-2",
            CM2_NAME,
            CM2_SURFACE,
            **_unavailable(
                f"the candidate records no abstention fact for {len(unrecorded)} of the"
                f" reference-correct case(s) ({', '.join(unrecorded[:5])}) — an unrecorded"
                " abstention is absent, not a zero; the rate is NOT computable"
            ),
            correctness_ledger_sha256=ledger_sha256,
        )
    total = len(correct_ids)
    return _cm_record(
        "CM-2",
        CM2_NAME,
        CM2_SURFACE,
        available=True,
        values={
            "n_reference_correct_cases": total,
            "n_candidate_abstentions": abstentions,
            "rate": abstentions / total,
        },
        correctness_ledger_sha256=ledger_sha256,
    )


def _build_cm3(candidate_rows: dict) -> dict:
    """CM-3 — the rate of executions hitting a limit or a cancellation."""
    per_case = []
    n_limit = n_cancel = n_failure = n_answered = 0
    for case_id in sorted(candidate_rows):
        state, marker, is_execution, hit_kind, answered = _terminal_state(candidate_rows.get(case_id))
        if not is_execution:
            continue
        if hit_kind == "limit":
            n_limit += 1
        elif hit_kind == "cancellation":
            n_cancel += 1
        elif hit_kind == "failure":
            n_failure += 1
        if answered:
            n_answered += 1
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
        return _cm_record(
            "CM-3",
            CM3_NAME,
            CM3_SURFACE,
            **_unavailable(
                "the candidate records no execution — the limit/cancellation rate has no"
                " denominator and is NOT reported as zero"
            ),
        )
    n_executions = len(per_case)
    n_hits = n_limit + n_cancel
    return _cm_record(
        "CM-3",
        CM3_NAME,
        CM3_SURFACE,
        available=True,
        values={
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
        notes=[
            "a generic failure is recorded as a failure, never as a limit hit — its count and"
            " rate travel beside the limit/cancellation rate so a zero limit rate never hides a"
            " failing execution",
            "the terminal states are the recorded ones: an ok row that records an abstention is"
            " the 'abstained' state, not an answered execution — CM-3 and CM-2 then read the same"
            " case the same way",
        ],
    )


# ---------------------------------------------------------------------------
# The report
# ---------------------------------------------------------------------------


def counter_metrics_report_digest(report: dict) -> str:
    """The report's digest, recomputed over the body minus the embedded
    ``digest`` key — the verifiable identity a rebuild must reproduce."""
    return digest_without_embedded(report)


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
        corpus_fingerprint, assessment_set_sha256 = manifest_lineage(reference_manifest)
        reference_manifest_sha256 = manifest_digest(reference_manifest)
    # The ledger is hashed ONCE — the digest every CM-2 record carries is the
    # same one the inputs record carries.
    ledger_sha256 = sha256_json(correctness_ledger) if correctness_ledger is not None else None
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
        "CM-2": _build_cm2(candidate_rows, correctness_ledger, ledger_sha256),
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
            "correctness_ledger_sha256": ledger_sha256,
        },
        "counter_metrics": counter_metrics,
    }
    body["digest"] = counter_metrics_report_digest(body)
    return body
