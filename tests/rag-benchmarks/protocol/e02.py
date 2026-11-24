# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The E02 comparison report (B vs C) — the agent's case.

E01 compares the legacy fixed RAG (A) with the fixed non-agentic pipeline (B):
the retrieval backend is the variable under test. **E02 compares B with C** —
the fixed pipeline (B) and the agent (C) over the SAME capabilities. B and C
share the retrieval backend, the query preparation and the admission policy;
orchestration is the recorded intentional difference, so the E02 delta
attributes to the agent and to nothing else (PRD §8, pair E02).

This module is the E02 comparison layer: a pure, digest-pinned join of the B
leg and the C leg into per-dimension records, the B-vs-C comparison, the gains
per query class, the costs, the thresholds applied, the uncontrolled
differences and an honest verdict.

The honesty rules are the point of the layer, and they are the reason the
report is allowed to be unsatisfying:

* a surface a leg cannot provide is recorded as NOT AVAILABLE with its reason —
  never invented, never silently dropped (a count nobody measured is never
  published as a zero);
* a threshold nobody agreed is recorded as ABSENT with its blocking reason —
  never defaulted, never reported as satisfied;
* a bound scoped to another configuration is NOT APPLICABLE here, and a bound
  whose surface does not carry the metric is NOT MEASURABLE — the scope is
  ACTED ON, not quoted;
* a signed bound whose direction or threshold is not comparable is
  UNINTERPRETABLE — it blocks, it never passes and never fails;
* a query class the assessment set does not carry is recorded as NOT COVERED —
  the agentic benefit the PRD §4.1 note describes (multi-hop and ambiguous
  queries) stays a HYPOTHESIS;
* the verdict is a B-vs-C comparison — a bound the FIXED pipeline breaks is its
  own state, never the agent's verdict, and a negative result is recorded, not
  massaged;
* every row the report writes is redacted at every depth (the shared
  ``redaction`` rule) — a credential-named key never reaches a committed
  artifact.
"""

from __future__ import annotations

import re
from datetime import UTC, datetime

from . import PROTOCOL_VERSION
from . import pairs as pairs_mod
from .counter_metrics import (
    COST_COUNTERS,
    FAILURE_STATES,
    LIMIT_MARKER_B,
    LIMIT_MARKER_C,
    CounterMetricsRefusal,
    build_counter_metrics_report,
)
from .evalset import base_case_id
from .manifest import manifest_digest, manifest_lineage, sha256_json
from .redaction import redact_deep

E02_REPORT_VERSION = "1.0.0"
E02_REPORT_ARTIFACT = "e02-report"
E02_PAIR = "E02"

# The configuration letters of the pair, in report order.
E02_LEGS = ("B", "C")

# The measurement surfaces of the E02 pair. B and C share them BY CONSTRUCTION
# (the pair holds the retrieval backend, the preparation and the admission
# policy fixed) — the E01 asymmetry (A chunk-level vs B doc-level) does not
# recur here, and the report says so.
B_M1_SURFACE = "doc-level (the B row's source_documents)"
C_M1_SURFACE = "doc-level (the C row's source_documents, carried by the run's verdict event)"
B_M2_SURFACE = "the B row's answer text and source_documents"
C_M2_SURFACE = "the C row's answer text and source_documents"
B_M3_SURFACE = "the B row's mechanical abstention facts (abstained / abstention_reason)"
C_M3_SURFACE = "the C row's answer text (config C carries no mechanical abstention flag)"
B_M4_SURFACE = "the protocol layer's per-case wall_ms (the B rows)"
C_M4_SURFACE = "the protocol layer's per-case wall_ms (the C rows)"
B_M5_SURFACE = "the run's aggregated cost counters (the B rows' metadata.usage)"
C_M5_SURFACE = "the run's aggregated cost counters (the C rows' usage_record)"

# The query classes the PRD §4.1 note names as the agentic-gain classes. A set
# that carries no case of a class is reported as NOT COVERED — the benefit
# stays a hypothesis.
AGENTIC_GAIN_CLASSES = ("multi_hop", "ambiguous")

# The per-leg row vocabularies: config B's rows carry ``status``, config C's
# rows carry ``outcome``. A rows file of another leg is refused, never
# silently filtered down to an empty comparison leg.
B_ROW_STATUS_VOCABULARY = ("ok", "failure")
C_ROW_OUTCOME_VOCABULARY = (
    "answered",
    "error",
    "admission_refused",
    "configuration_error",
    "invalid_request",
    "http_error",
    "cancelled",
    "stream_error",
)

HONEST_EVIDENCE_STATEMENT = (
    "E02 honest evidence: this report joins two recorded runs — it computes no verdict and"
    " proves nothing beyond the conditions its two legs ran under. The pair E02 conditions are"
    " held fixed (retrieval backend, preparation, admission policy) with ORCHESTRATION as the"
    " recorded intentional difference, so the delta attributes to the agent and to nothing else."
    " The agentic benefits stay hypotheses until they are measured on GENIE's own corpora and"
    " query mix (PRD §4.1) — a negative result is recorded, not massaged."
)

# The threshold outcomes a bound can carry.
THRESHOLD_APPLIED = "applied"
THRESHOLD_ABSENT = "absent"
THRESHOLD_NOT_MEASURABLE = "not_measurable"
THRESHOLD_NOT_APPLICABLE = "not_applicable"
THRESHOLD_UNINTERPRETABLE = "uninterpretable"

# The comparison outcomes.
COMPARISON_PASS = "pass"
COMPARISON_FAIL = "fail"
COMPARISON_NOT_MEASURABLE = "not_measurable"

# The E02 verdict states.
VERDICT_SUPPORTED = "supported"
VERDICT_NOT_SUPPORTED = "not_supported"
VERDICT_UNASSESSABLE = "unassessable"

# The scope rule: a signed scope that names a configuration applies to THAT
# configuration only. The signed M-1 bounds are scoped to "config A — the
# chunk/passage-level anchor metrics"; the E02 legs measure the doc-level
# surface, so those bounds are NOT APPLICABLE here — whatever metric names
# they happen to carry. The rule FAILS CLOSED: a scope that mentions a
# configuration in a spelling the harness cannot parse names NO leg, so the
# bound is not applied to any leg (an unapplied bound blocks; a wrongly
# applied one would compare two different surfaces and call it a breach).
_SCOPE_CONFIG = re.compile(r"config(?:uration)?[\s._-]*([abc])\b", re.IGNORECASE)
_SCOPE_CONFIG_WORD = re.compile(r"config", re.IGNORECASE)
_SCOPE_AMBIGUOUS = "ambiguous"


class E02Refusal(RuntimeError):
    """The E02 report is refused; ``reason`` names the offending input."""

    def __init__(self, reason: str, message: str):
        self.reason = reason
        super().__init__(message)


# ---------------------------------------------------------------------------
# The typed refusals — before any report is built
# ---------------------------------------------------------------------------


def _verify_row_vocabulary(rows: dict, config: str) -> None:
    """Refuse a rows file that does not speak the leg's vocabulary — a leg that
    never ran must never be presented as a leg that scored zero."""
    for case_id, row in rows.items():
        if not isinstance(row, dict):
            raise E02Refusal(
                "missing_artifact",
                f"the {config}-leg row for {case_id!r} is not a mapping — refusing before the report is built",
            )
        if config == "B":
            if "status" not in row:
                raise E02Refusal(
                    "wrong_leg",
                    f"the B-leg row for {case_id!r} carries no status field — these rows are"
                    " another leg's (config C rows carry outcome) — refusing before the report is built",
                )
            if row.get("status") not in B_ROW_STATUS_VOCABULARY:
                raise E02Refusal(
                    "wrong_leg",
                    f"the B-leg row for {case_id!r} carries status {row.get('status')!r}, outside the"
                    f" B-leg vocabulary {B_ROW_STATUS_VOCABULARY} — refusing before the report is built",
                )
        else:
            if "outcome" not in row:
                raise E02Refusal(
                    "wrong_leg",
                    f"the C-leg row for {case_id!r} carries no outcome field — these rows are"
                    " another leg's (config B rows carry status) — refusing before the report is built",
                )
            if row.get("outcome") not in C_ROW_OUTCOME_VOCABULARY:
                raise E02Refusal(
                    "wrong_leg",
                    f"the C-leg row for {case_id!r} carries outcome {row.get('outcome')!r}, outside"
                    f" the C-leg vocabulary {C_ROW_OUTCOME_VOCABULARY} — refusing before the report is built",
                )


def _verify_legs(
    *,
    b_manifest: dict,
    c_manifest: dict,
    b_rows: dict,
    c_rows: dict,
    set_sha256: str | None = None,
    reference_manifest: dict | None = None,
    thresholds: dict | None = None,
) -> None:
    """The leg-artifact and lineage checks, in refusal order: presence, leg
    identity, lineage.

    The E02 lineage is stricter than E01's in one respect: BOTH legs are gated
    runs, and they must have been gated against the SAME predecessor AND the
    SAME signed thresholds — two legs gated against different thresholds were
    measured under different bounds, and comparing them would attribute the
    difference to the agent.
    """
    for name, value in (("the B-leg gated manifest", b_manifest), ("the C-leg gated manifest", c_manifest)):
        if not isinstance(value, dict) or not value:
            raise E02Refusal("missing_artifact", f"{name} is missing")
    if not isinstance(b_rows, dict) or not b_rows:
        raise E02Refusal(
            "missing_artifact",
            "the B rows are missing or carry no case rows (the gated run's config-b.rows.json)",
        )
    if not isinstance(c_rows, dict) or not c_rows:
        raise E02Refusal(
            "missing_artifact",
            "the C rows are missing or carry no case rows (the gated run's config-c.rows.json)",
        )
    for manifest, config in ((b_manifest, "B"), (c_manifest, "C")):
        kind = manifest.get("kind")
        stamped = manifest.get("config")
        if kind != "gated" or stamped != config:
            raise E02Refusal(
                "wrong_leg",
                f"the {config} leg requires a gated config-{config} manifest (got kind {kind!r},"
                f" config {stamped!r}) — refusing before the report is built",
            )
    _verify_row_vocabulary(b_rows, "B")
    _verify_row_vocabulary(c_rows, "C")

    b_corpus, b_set = manifest_lineage(b_manifest)
    c_corpus, c_set = manifest_lineage(c_manifest)
    absent = []
    if not b_corpus:
        absent.append("the B leg's corpus fingerprint")
    if not c_corpus:
        absent.append("the C leg's corpus fingerprint")
    if not b_set:
        absent.append("the B leg's assessment set digest")
    if not c_set:
        absent.append("the C leg's assessment set digest")
    if absent:
        raise E02Refusal(
            "lineage_mismatch",
            f"the legs carry no lineage — {' and '.join(absent)} missing — refusing before the report is built",
        )
    mismatched = []
    if b_corpus != c_corpus:
        mismatched.append(f"the corpus fingerprint (B {b_corpus!r} vs C {c_corpus!r})")
    if b_set != c_set:
        mismatched.append(f"the assessment set digest (B {b_set!r} vs C {c_set!r})")
    if mismatched:
        raise E02Refusal(
            "lineage_mismatch",
            "the legs do not share a lineage — " + " and ".join(mismatched) + " — refusing before the report is built",
        )
    # The assessment set the report reads its query classes from must be the
    # set the legs ran against: the class census is a claim about the set, and
    # a claim about another set is not a claim at all.
    if set_sha256 is not None and set_sha256 != b_set:
        raise E02Refusal(
            "lineage_mismatch",
            f"the assessment set supplied to the report ({set_sha256!r}) is not the set the legs ran"
            f" against ({b_set!r}) — refusing before the report is built",
        )

    # Both legs are gated runs: the gate wrote the predecessor and the signed
    # thresholds it selected into each manifest. They must be the SAME — a
    # comparison across two predecessors or two thresholds artifacts would
    # attribute their difference to the agent.
    b_lineage = b_manifest.get("lineage") or {}
    c_lineage = c_manifest.get("lineage") or {}
    for leg, lineage in (("B", b_lineage), ("C", c_lineage)):
        if not lineage.get("reference_manifest_sha256") or not lineage.get("thresholds_sha256"):
            raise E02Refusal(
                "lineage_mismatch",
                f"the {leg} leg carries no gate lineage (the predecessor and the signed thresholds"
                " the gate selected) — refusing before the report is built",
            )
    if b_lineage["reference_manifest_sha256"] != c_lineage["reference_manifest_sha256"]:
        raise E02Refusal(
            "lineage_mismatch",
            f"the legs were gated against DIFFERENT predecessors ({b_lineage['reference_manifest_sha256']!r}"
            f" vs {c_lineage['reference_manifest_sha256']!r}) — they were measured under different"
            " thresholds, so the comparison would attribute the difference to the agent — refusing"
            " before the report is built",
        )
    if b_lineage["thresholds_sha256"] != c_lineage["thresholds_sha256"]:
        raise E02Refusal(
            "lineage_mismatch",
            f"the legs were gated against DIFFERENT signed thresholds"
            f" ({b_lineage['thresholds_sha256']!r} vs {c_lineage['thresholds_sha256']!r}) — refusing"
            " before the report is built",
        )
    if reference_manifest is not None:
        reference_digest = manifest_digest(reference_manifest)
        if reference_digest != b_lineage["reference_manifest_sha256"]:
            raise E02Refusal(
                "lineage_mismatch",
                f"the supplied reference manifest ({reference_digest!r}) is not the predecessor the"
                f" legs were gated against ({b_lineage['reference_manifest_sha256']!r}) — refusing"
                " before the report is built",
            )
    if thresholds is not None:
        if not thresholds.get("signed"):
            raise E02Refusal(
                "thresholds_not_signed",
                "the thresholds artifact is unsigned — an unsigned sign-off is never applied —"
                " refusing before the report is built",
            )
        if thresholds.get("corpus_fingerprint") != b_corpus or thresholds.get("assessment_set_sha256") != b_set:
            raise E02Refusal(
                "thresholds_lineage_mismatch",
                "the thresholds artifact binds another corpus or assessment set — refusing before the"
                " report is built",
            )
        if thresholds.get("reference_manifest_sha256") != b_lineage["reference_manifest_sha256"]:
            raise E02Refusal(
                "thresholds_lineage_mismatch",
                "the thresholds artifact references another predecessor than the legs were gated"
                " against — refusing before the report is built",
            )
        # The legs carry the digest of the thresholds artifact the gate
        # selected; the artifact the report would apply must BE it.
        applied_digest = sha256_json(thresholds)
        if applied_digest != b_lineage["thresholds_sha256"]:
            raise E02Refusal(
                "thresholds_lineage_mismatch",
                f"the thresholds artifact supplied to the report ({applied_digest[:12]}) is not the"
                f" one the legs were gated under ({b_lineage['thresholds_sha256'][:12]}) — the report"
                " would apply bounds the legs were not measured under — refusing before the report"
                " is built",
            )


# ---------------------------------------------------------------------------
# The per-leg dimension surfaces
# ---------------------------------------------------------------------------


def _surface_record(*, surface: str, available: bool, values=None, not_available_reason=None, notes=None) -> dict:
    """One measurement surface's record — the E01 shape, reused verbatim."""
    record: dict = {"measurement_surface": surface, "available": available}
    if values is not None:
        record["values"] = values
    if not_available_reason is not None:
        record["not_available_reason"] = not_available_reason
    if notes:
        record["notes"] = notes
    return record


def _b_ok_rows(rows: dict) -> list[dict]:
    return [row for row in rows.values() if isinstance(row, dict) and row.get("status") == "ok"]


def _c_answered_rows(rows: dict) -> list[dict]:
    """The C rows that reached an ANSWERED terminal — a cancelled or a dead
    stream carries no answer and is not an answer with an empty body."""
    return [row for row in rows.values() if isinstance(row, dict) and row.get("outcome") == "answered"]


def _b_m1(b_rows: dict) -> dict:
    ok = _b_ok_rows(b_rows)
    with_sources = sum(1 for row in ok if row.get("source_documents"))
    return _surface_record(
        surface=B_M1_SURFACE,
        available=True,
        values={
            "n_rows": len(ok),
            "n_rows_with_source_documents": with_sources,
            "n_rows_with_empty_source_documents": len(ok) - with_sources,
        },
        notes=[
            "the E02 pair measures the doc-level surface on both legs (the retrieval backend is"
            " held fixed) — the chunk-level anchor metrics of the E01 reference are NOT"
            " re-measured here",
        ],
    )


def _c_m1(c_rows: dict) -> dict:
    ok = _c_answered_rows(c_rows)
    with_sources = sum(1 for row in ok if row.get("source_documents"))
    return _surface_record(
        surface=C_M1_SURFACE,
        available=True,
        values={
            "n_rows": len(ok),
            "n_rows_with_source_documents": with_sources,
            "n_rows_with_empty_source_documents": len(ok) - with_sources,
        },
        notes=[
            "the E02 pair measures the doc-level surface on both legs (the retrieval backend is"
            " held fixed) — the chunk-level anchor metrics of the E01 reference are NOT"
            " re-measured here",
        ],
    )


def _b_m2(b_rows: dict) -> dict:
    ok = _b_ok_rows(b_rows)
    return _surface_record(
        surface=B_M2_SURFACE,
        available=True,
        values={
            "n_ok_rows": len(ok),
            "n_empty_answers": sum(1 for row in ok if not str(row.get("answer") or "").strip()),
            "n_rows_with_source_documents": sum(1 for row in ok if row.get("source_documents")),
        },
    )


def _c_m2(c_rows: dict) -> dict:
    ok = _c_answered_rows(c_rows)
    return _surface_record(
        surface=C_M2_SURFACE,
        available=True,
        values={
            "n_answered_rows": len(ok),
            "n_empty_answers": sum(1 for row in ok if not str(row.get("answer") or "").strip()),
            "n_rows_with_source_documents": sum(1 for row in ok if row.get("source_documents")),
        },
    )


def _b_m3(b_rows: dict) -> dict:
    ok = _b_ok_rows(b_rows)
    return _surface_record(
        surface=B_M3_SURFACE,
        available=True,
        values={
            "n_ok_rows": len(ok),
            "n_abstained": sum(1 for row in ok if row.get("abstained") is True),
            "n_with_abstention_reason": sum(1 for row in ok if row.get("abstention_reason")),
            "n_not_abstained": sum(1 for row in ok if row.get("abstained") is False),
            "n_failure_rows": sum(1 for row in b_rows.values() if isinstance(row, dict) and row.get("status") == "failure"),
        },
    )


def _c_m3(c_rows: dict) -> dict:
    """Config C carries NO mechanical abstention flag — the no-agent pipeline
    owns that flag — so the C surface is the answer text and the terminal
    outcomes, and the record SAYS so instead of inventing an abstention count.

    The absence is carried by the MISSING key: a count nobody measured is
    never published as a zero (a zero would compare against a signed bound
    and deny the agent on a fact that was never recorded).
    """
    answered = _c_answered_rows(c_rows)
    return _surface_record(
        surface=C_M3_SURFACE,
        available=True,
        values={
            "n_answered_rows": len(answered),
            "n_cancelled_rows": sum(
                1 for row in c_rows.values() if isinstance(row, dict) and row.get("outcome") == "cancelled"
            ),
            "n_admission_refused_rows": sum(
                1 for row in c_rows.values() if isinstance(row, dict) and row.get("outcome") == "admission_refused"
            ),
            "n_error_rows": sum(
                1
                for row in c_rows.values()
                if isinstance(row, dict)
                and row.get("outcome") in FAILURE_STATES
            ),
        },
        notes=[
            "config C carries no mechanical abstention flag (the no-agent pipeline owns it): the"
            " abstention correctness of the agentic leg is a JUDGED dimension — the row carries"
            " the answer text and the terminal outcome, and the judge layer decides. NO"
            " abstention count is published for this leg: the fact was never recorded, and a"
            " zero would be a fabricated measurement",
        ],
    )


def _latency_values(rows: dict, config: str) -> tuple[list[float], int]:
    """The leg's wall_ms values + the count of the non-answered rows excluded
    from them (a failed case's latency is not the answer latency)."""
    if config == "B":
        answered = _b_ok_rows(rows)
        excluded = sum(
            1 for row in rows.values() if isinstance(row, dict) and row.get("status") != "ok"
        )
    else:
        answered = _c_answered_rows(rows)
        excluded = sum(
            1
            for row in rows.values()
            if isinstance(row, dict) and row.get("outcome") not in (None, "answered")
        )
    walls = [
        float(row["wall_ms"])
        for row in answered
        if isinstance(row.get("wall_ms"), (int, float)) and not isinstance(row.get("wall_ms"), bool)
    ]
    return walls, excluded


def _latency_stats(values: list[float]) -> dict:
    """min / median / max / MAD in the metric's OWN unit (milliseconds)."""
    import capture_baseline  # local import: the capture module's median/MAD

    ordered = sorted(float(value) for value in values)
    return {
        "n": len(ordered),
        "min": ordered[0],
        "median": capture_baseline.median(ordered),
        "max": ordered[-1],
        "mad": capture_baseline.mad(ordered),
        "unit": "ms",
    }


def _latency_surface(rows: dict, config: str, surface: str) -> dict:
    walls, excluded = _latency_values(rows, config)
    if not walls:
        return _surface_record(
            surface=surface,
            available=False,
            not_available_reason="no answered row carries wall_ms",
        )
    n_answered = len(_b_ok_rows(rows)) if config == "B" else len(_c_answered_rows(rows))
    return _surface_record(
        surface=surface,
        available=True,
        values={
            **_latency_stats(walls),
            "n_excluded_non_answered_rows": excluded,
            # The counts must reconcile: an answered row whose wall_ms is
            # missing or not a number appears in neither count above, and a
            # reader comparing n + excluded against the leg's row count would
            # conclude rows vanished.
            "n_answered_rows_missing_wall_ms": n_answered - len(walls),
        },
    )


def _aggregate_cost(usage_records: list[dict]) -> dict:
    """The run's cost surface: the counters of the cost vocabulary, summed
    over the leg's rows, with the number of contributing rows named.

    The shape is the SAME on both legs (the same counter names, the same
    aggregation) so a signed bound compares like with like — and it is the
    RUN's cost, not one arbitrary case's spend.
    """
    totals: dict = {}
    n_contributing = 0
    for record in usage_records:
        if not isinstance(record, dict):
            continue
        contributed = False
        for counter in COST_COUNTERS:
            value = record.get(counter)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                totals[counter] = totals.get(counter, 0.0) + float(value)
                contributed = True
        if contributed:
            n_contributing += 1
    if not totals:
        return {}
    return {**{counter: value for counter, value in sorted(totals.items())}, "n_rows_contributing": n_contributing}


def _aggregate_cost(usage_records: list[dict]) -> dict:
    """The run's cost surface: the counters of the cost vocabulary, summed
    over EVERY row that carries a usage record, with the number of
    contributing rows named.

    The shape is the SAME on both legs (the same counter names, the same
    aggregation) so a signed bound compares like with like — and it is the
    RUN's cost: a cancelled or failed run's tokens are the run's spend, and
    leaving them out would read a cheaper run than the one that happened.
    """
    totals: dict = {}
    n_contributing = 0
    for record in usage_records:
        if not isinstance(record, dict):
            continue
        contributed = False
        for counter in COST_COUNTERS:
            value = record.get(counter)
            if isinstance(value, (int, float)) and not isinstance(value, bool):
                totals[counter] = totals.get(counter, 0.0) + float(value)
                contributed = True
        if contributed:
            n_contributing += 1
    if not totals:
        return {}
    return {**{counter: value for counter, value in sorted(totals.items())}, "n_rows_contributing": n_contributing}


def _cost_surface(records: list[dict], n_rows: int, surface: str, absence_reason: str) -> dict:
    aggregated = _aggregate_cost(records)
    if aggregated:
        return _surface_record(
            surface=surface,
            available=True,
            values={
                **aggregated,
                "n_rows_with_usage_record": len(records),
                "n_rows_without_usage_record": n_rows - len(records),
            },
        )
    return _surface_record(surface=surface, available=False, not_available_reason=absence_reason)


def _b_m5(b_rows: dict) -> dict:
    """The B cost surface reads EVERY row that carries a usage record — not
    only the ok rows: a failed row's spend is the run's spend."""
    records = []
    for row in b_rows.values():
        metadata = row.get("metadata") if isinstance(row, dict) else None
        if isinstance(metadata, dict) and isinstance(metadata.get("usage"), dict):
            records.append(metadata["usage"])
    return _cost_surface(
        records,
        sum(1 for row in b_rows.values() if isinstance(row, dict)),
        B_M5_SURFACE,
        "the B rows carry no resource record (metadata.usage) — the recorded absence is not a zero",
    )


def _c_m5(c_rows: dict) -> dict:
    """The C cost surface reads EVERY row that carries a usage record — not
    only the answered rows: a cancelled run's tokens are the run's spend."""
    records = []
    for row in c_rows.values():
        usage = row.get("usage_record") if isinstance(row, dict) else None
        if isinstance(usage, dict):
            records.append(usage)
    return _cost_surface(
        records,
        sum(1 for row in c_rows.values() if isinstance(row, dict)),
        C_M5_SURFACE,
        "the C rows carry no usage_record — the recorded absence is not a zero",
    )


# ---------------------------------------------------------------------------
# The thresholds — applied, never authored
# ---------------------------------------------------------------------------

# The comparison operators a signed bound may carry.
OPERATORS = (">=", "<=", ">", "<", "==")


def _normalize_operator(value) -> str | None:
    if not isinstance(value, str):
        return None
    candidate = value.strip()
    return candidate if candidate in OPERATORS else None


def _numeric(value):
    """The numeric value of a bound's threshold — None when it is not one."""
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return float(value)
    return None


def _bound_records(value) -> list[dict]:
    """The signed bounds of one dimension, whatever shape the registry gave
    them: a per-metric mapping (the M-1 shape) or a single bound.

    A bound the shape is not understood for is NOT dropped — it is returned
    with ``operator: None`` (or a missing metric) so the report records it as
    uninterpretable instead of silently ignoring a signed number.
    """
    if not isinstance(value, dict):
        return [{"metric": None, "operator": None, "threshold": value, "shape": "scalar"}]
    metrics = value.get("metrics")
    if isinstance(metrics, dict):
        records = []
        for name, bound in sorted(metrics.items()):
            if isinstance(bound, dict):
                operator = _normalize_operator(bound.get("operator") or bound.get("op") or bound.get("comparison"))
                threshold = bound.get("threshold")
                if threshold is None:
                    threshold = bound.get("value")
                if operator is None:
                    if isinstance(bound.get("min"), (int, float)):
                        operator, threshold = ">=", bound.get("min")
                    elif isinstance(bound.get("max"), (int, float)):
                        operator, threshold = "<=", bound.get("max")
                records.append(
                    {"metric": str(name), "operator": operator, "threshold": threshold, "shape": "metric"}
                )
            else:
                records.append(
                    {"metric": str(name), "operator": None, "threshold": bound, "shape": "metric"}
                )
        return records
    operator = _normalize_operator(value.get("operator") or value.get("op") or value.get("comparison"))
    threshold = value.get("threshold")
    if threshold is None:
        threshold = value.get("value")
    if operator is None:
        if isinstance(value.get("min"), (int, float)):
            operator, threshold = ">=", value.get("min")
        elif isinstance(value.get("max"), (int, float)):
            operator, threshold = "<=", value.get("max")
    # A single bound names the metric it bounds — without the name it cannot
    # be looked up on any surface, and reporting it as "scoped elsewhere"
    # would blame the surface for a bound that names nothing.
    metric = value.get("metric") or value.get("name")
    return [
        {
            "metric": str(metric) if isinstance(metric, str) and metric.strip() else None,
            "operator": operator,
            "threshold": threshold,
            "shape": "single",
        }
    ]


def _compare(operator: str, measured, threshold) -> bool | None:
    """The comparison itself.

    ``None`` means NOT COMPARABLE (a missing measurement, a non-numeric
    threshold) — it is distinct from ``False`` (the bound was breached) and
    the caller records it as uninterpretable, never as a failure.
    """
    if not isinstance(measured, (int, float)) or isinstance(measured, bool):
        return None
    bound = _numeric(threshold)
    if bound is None:
        return None
    value = float(measured)
    if operator == ">=":
        return value >= bound
    if operator == "<=":
        return value <= bound
    if operator == ">":
        return value > bound
    if operator == "<":
        return value < bound
    if operator == "==":
        return value == bound
    return None


def _lookup_metric(values: dict, metric: str | None):
    """The measured value of a metric in a surface's values mapping.

    The lookup is BY NAME and depth-aware (the M-1 shape nests the metrics
    under ``metrics``); a surface that does not carry the metric yields None,
    which the caller records as NOT MEASURABLE.
    """
    if not isinstance(values, dict) or not metric:
        return None
    if metric in values:
        candidate = values[metric]
        return candidate if isinstance(candidate, (int, float)) and not isinstance(candidate, bool) else None
    nested = values.get("metrics")
    if isinstance(nested, dict) and metric in nested:
        candidate = nested[metric]
        return candidate if isinstance(candidate, (int, float)) and not isinstance(candidate, bool) else None
    return None


def _scope_configuration(scope):
    """The configurations a signed scope names — None when it names none.

    A scope that names a set of configurations applies to those legs (a bound
    scoped to "config B and config C" is scoped to THIS pair's two legs — the
    E02 comparison IS the B-vs-C pair). ``_SCOPE_AMBIGUOUS`` means the scope
    mentions a configuration in a spelling this harness cannot parse, or
    names a configuration outside the harness's vocabulary: the bound names
    NO leg, and no leg may apply it (an unapplied bound blocks; a wrongly
    applied one would compare two different surfaces)."""
    if not isinstance(scope, str):
        return None
    named = {match.group(1).upper() for match in _SCOPE_CONFIG.finditer(scope)}
    if named:
        return named
    if _SCOPE_CONFIG_WORD.search(scope):
        return _SCOPE_AMBIGUOUS
    return None


def _apply_threshold(thresholds: dict | None, code: str, surface: dict, config: str) -> dict:
    """Apply the signed bound of one dimension to one leg's measured surface.

    The outcome vocabulary is explicit: ``applied`` (the bound was compared
    and the result is pass/fail), ``absent`` (nobody agreed a bound — the
    blocking reason is recorded), ``not_applicable`` (the bound is scoped to
    another configuration), ``not_measurable`` (the surface does not carry the
    metric) and ``uninterpretable`` (the signed bound carries no comparable
    direction or threshold — it blocks, it never passes and never fails).
    """
    if thresholds is None:
        return {
            "status": THRESHOLD_ABSENT,
            "reason": (
                "no signed thresholds artifact was supplied — the operator has agreed no bound for"
                " this dimension and an absent threshold blocks the affected conclusion"
            ),
            "bounds": [],
        }
    entry = (thresholds.get("thresholds") or {}).get(code)
    if not isinstance(entry, dict) or entry.get("value") is None:
        return {
            "status": THRESHOLD_ABSENT,
            "reason": (
                f"the signed thresholds artifact carries no agreed value for {code} — an absent"
                " dimension blocks the affected conclusion and is never defaulted"
            ),
            "bounds": [],
        }
    value = entry.get("value")
    scope = value.get("scope") if isinstance(value, dict) else None
    records = _bound_records(value)
    if not records:
        return {
            "status": THRESHOLD_ABSENT,
            "reason": (
                f"the signed value for {code} carries no bound — an empty bound set is an absence,"
                " never a satisfied dimension"
            ),
            "bounds": [],
        }
    values = surface.get("values") if surface.get("available") else None
    bounds = []
    for record in records:
        measured = _lookup_metric(values, record["metric"])
        named_configurations = _scope_configuration(scope)
        if record["metric"] is None:
            outcome = THRESHOLD_UNINTERPRETABLE
            comparison = None
            reason = "the signed bound names no metric — it cannot be looked up on any surface"
        elif named_configurations == _SCOPE_AMBIGUOUS:
            outcome = THRESHOLD_UNINTERPRETABLE
            comparison = None
            reason = (
                f"the signed scope ({scope}) mentions a configuration in a spelling this harness"
                " cannot parse — the bound names no leg and is not applied (an unapplied bound"
                " blocks; a wrongly applied one would compare two different surfaces)"
            )
        elif named_configurations is not None and config not in named_configurations:
            outcome = THRESHOLD_NOT_APPLICABLE
            comparison = None
            reason = (
                f"the signed scope ({scope}) names configuration"
                f" {', '.join(sorted(named_configurations))}, not this leg's configuration"
                f" ({config}) — the bound is scoped elsewhere and does not transfer"
            )
        elif record["operator"] is None:
            outcome = THRESHOLD_UNINTERPRETABLE
            comparison = None
            reason = (
                "the signed bound carries no comparable direction — it is recorded, never guessed"
            )
        elif measured is None:
            outcome = THRESHOLD_NOT_MEASURABLE
            comparison = None
            reason = (
                f"this leg's measurement surface does not carry {record['metric']!r} — the bound"
                " is not measurable here"
            )
        else:
            comparison = _compare(record["operator"], measured, record["threshold"])
            if comparison is None:
                outcome = THRESHOLD_UNINTERPRETABLE
                reason = (
                    "the signed bound's threshold is not a comparable number — the bound is"
                    " recorded, never read as a breach"
                )
            else:
                outcome = COMPARISON_PASS if comparison else COMPARISON_FAIL
                reason = None
        bounds.append(
            {
                "metric": record["metric"],
                "operator": record["operator"],
                "threshold": record["threshold"],
                "measured": measured,
                "outcome": outcome,
                "comparison": comparison,
                "reason": reason,
            }
        )
    statuses = {bound["outcome"] for bound in bounds}
    if statuses <= {COMPARISON_PASS, COMPARISON_FAIL}:
        status = THRESHOLD_APPLIED
    elif THRESHOLD_UNINTERPRETABLE in statuses:
        status = THRESHOLD_UNINTERPRETABLE
    elif THRESHOLD_NOT_APPLICABLE in statuses:
        status = THRESHOLD_NOT_APPLICABLE
    else:
        status = THRESHOLD_NOT_MEASURABLE
    record = {"status": status, "scope": scope, "bounds": bounds}
    if status == THRESHOLD_NOT_MEASURABLE:
        record["reason"] = (
            "no signed bound is measurable on this leg's surface — the signed bounds apply to"
            " another measurement surface"
        )
    elif status == THRESHOLD_NOT_APPLICABLE:
        record["reason"] = (
            "the signed bounds are scoped to another configuration — they do not transfer to this leg"
        )
    elif status == THRESHOLD_UNINTERPRETABLE:
        record["reason"] = (
            "a signed bound carries no comparable direction or threshold — recorded, never guessed"
        )
    return record


# ---------------------------------------------------------------------------
# The gains — per query class
# ---------------------------------------------------------------------------


def _query_class(entry: dict) -> str:
    """The query class of a case.

    The class is read from the case's ``expectations.query_class`` when it
    carries one (the ``expectations`` dict is the protocol's own free-form
    per-case space — no schema change, no new field) and falls back to the
    composition class. The names are normalized (``multi-hop`` and
    ``multi_hop`` are the same class).
    """
    expectations = entry.get("expectations")
    tagged = expectations.get("query_class") if isinstance(expectations, dict) else None
    raw = tagged if isinstance(tagged, str) and tagged.strip() else entry.get("case_class")
    if not isinstance(raw, str):
        return "unclassified"
    return raw.strip().lower().replace("-", "_").replace(" ", "_")


def _leg_class_stats(rows: dict, config: str) -> dict:
    """The per-class counts of one leg.

    The vocabulary is the counter-metrics layer's terminal-state vocabulary:
    an ADMISSION REFUSAL is neither a failure nor a limit hit (the lane
    refused the run on purpose — CM-3 counts it apart), and the report must
    not contradict its own CM-3 record.
    """
    stats = {
        "n_answered": 0,
        "n_abstained": 0,
        "n_admission_refused": 0,
        "n_limit_hit": 0,
        "n_failed": 0,
        "n_cancelled": 0,
        "n_rows": 0,
    }
    for row in rows.values():
        if not isinstance(row, dict):
            continue
        stats["n_rows"] += 1
        if config == "B":
            # The terminal states are read in the counter-metrics vocabulary's
            # order — the limit marker first, then the failure — so the report
            # never calls the same row two different things. And an abstention
            # is NOT an answer: the fixed pipeline refused to answer, and
            # counting it as one inflates its coverage and can deny the agent
            # a measured gain.
            if row.get("abstention_reason") == LIMIT_MARKER_B:
                stats["n_limit_hit"] += 1
                continue
            if row.get("status") == "failure":
                stats["n_failed"] += 1
                continue
            if row.get("abstained") is True or row.get("abstention_reason"):
                stats["n_abstained"] += 1
                continue
            if row.get("status") == "ok":
                stats["n_answered"] += 1
            continue
        outcome = row.get("outcome")
        usage = row.get("usage_record") if isinstance(row.get("usage_record"), dict) else {}
        if outcome == "cancelled":
            stats["n_cancelled"] += 1
            continue
        if outcome == "admission_refused":
            stats["n_admission_refused"] += 1
            continue
        if usage.get("outcome") == LIMIT_MARKER_C:
            stats["n_limit_hit"] += 1
            continue
        if outcome != "answered":
            stats["n_failed"] += 1
            continue
        stats["n_answered"] += 1
    return stats


def _class_latency(rows: dict, config: str) -> list[float]:
    walls = []
    for row in rows.values():
        if not isinstance(row, dict):
            continue
        if config == "B" and row.get("status") != "ok":
            continue
        if config == "C" and row.get("outcome") != "answered":
            continue
        wall = row.get("wall_ms")
        if isinstance(wall, (int, float)) and not isinstance(wall, bool):
            walls.append(float(wall))
    return walls


def _build_gains(entries: list[dict], b_rows: dict, c_rows: dict) -> dict:
    """The gains per query class — the B-vs-C delta, class by class.

    The class census comes from the ASSESSMENT SET (the cases the legs were
    measured on), not from the rows: a class the set carries but the legs
    produced no row for is still a class the set carries, and a class the set
    does not carry is NOT COVERED — the benefit the PRD §4.1 note describes
    stays a hypothesis.
    """
    class_of: dict[str, str] = {}
    for entry in entries or []:
        if not isinstance(entry, dict) or not entry.get("id"):
            continue
        class_of[base_case_id(entry["id"])] = _query_class(entry)

    set_classes: dict[str, set[str]] = {}
    for case_id, name in class_of.items():
        set_classes.setdefault(name, set()).add(case_id)

    # The rows the census EXCLUDES — a row whose base case id is in no
    # assessment-set entry is nobody's class. The exclusion is symmetric
    # across the legs, and it is named: a comparison that silently shrank is
    # a comparison a reader cannot weigh.
    excluded_rows = {
        "B": sorted(cid for cid in b_rows if base_case_id(cid) not in class_of),
        "C": sorted(cid for cid in c_rows if base_case_id(cid) not in class_of),
    }

    per_class = {}
    for name in sorted(set_classes):
        case_ids = set_classes[name]
        # The rows of the class are matched BY BASE ID: a multi-turn case's
        # rows are keyed <case_id>#t<n>, and dropping the turn suffix is the
        # only way a turn row lands in its case's class. Matching the raw row
        # ids would silently drop every turn row from the census and from the
        # coverage comparison.
        b_class = {cid: row for cid, row in b_rows.items() if base_case_id(cid) in case_ids}
        c_class = {cid: row for cid, row in c_rows.items() if base_case_id(cid) in case_ids}
        b_stats = _leg_class_stats(b_class, "B")
        c_stats = _leg_class_stats(c_class, "C")
        b_walls = _class_latency(b_class, "B")
        c_walls = _class_latency(c_class, "C")
        per_class[name] = {
            "n_cases_in_set": len(case_ids),
            "n_rows_recorded": {
                "B": b_stats["n_rows"],
                "C": c_stats["n_rows"],
            },
            "B": {**b_stats, "latency": _latency_stats(b_walls) if b_walls else None},
            "C": {**c_stats, "latency": _latency_stats(c_walls) if c_walls else None},
            "delta": {
                "answered": c_stats["n_answered"] - b_stats["n_answered"],
                "abstained": c_stats["n_abstained"] - b_stats["n_abstained"],
                "admission_refused": c_stats["n_admission_refused"] - b_stats["n_admission_refused"],
                "limit_hit": c_stats["n_limit_hit"] - b_stats["n_limit_hit"],
                "failed": c_stats["n_failed"] - b_stats["n_failed"],
                "cancelled": c_stats["n_cancelled"] - b_stats["n_cancelled"],
                "median_latency_ms": (
                    _latency_stats(c_walls)["median"] - _latency_stats(b_walls)["median"]
                    if b_walls and c_walls
                    else None
                ),
            },
            "note": (
                "the delta is C minus B on this class: a positive answered delta is the agent"
                " answering more, a positive abstained delta is the agent abstaining more, a"
                " positive latency delta is the agent slower"
            ),
        }

    not_covered = []
    for name in AGENTIC_GAIN_CLASSES:
        if name in set_classes:
            continue
        not_covered.append(
            {
                "query_class": name,
                "n_cases_in_set": 0,
                "reason": (
                    "the assessment set carries no case of this class — the agentic benefit the"
                    " PRD §4.1 note describes stays a HYPOTHESIS until a set carries the class;"
                    " the set is frozen at the digest the signed thresholds bind to, so it cannot"
                    " be extended without invalidating the signature"
                ),
            }
        )
    return {
        "per_class": per_class,
        "not_covered": not_covered,
        "census_source": "the assessment set's entries (the cases the legs ran against)",
        "excluded_rows": excluded_rows,
        "excluded_rows_note": (
            "these rows' base case id is in no assessment-set entry — they are recorded verbatim"
            " in per_case but belong to no query class, so they are in no per-class census"
        ),
    }


# ---------------------------------------------------------------------------
# The uncontrolled differences — recorded evidence only
# ---------------------------------------------------------------------------


def _recorded_comparison(b_value, c_value, note: str) -> dict:
    """A per-leg comparison that never claims equality from ABSENCE: an
    unrecorded side is 'not recorded', never 'identical' (the harness records
    what it measured and says what it did not)."""
    if b_value is None or c_value is None:
        state = "not_recorded"
    elif b_value == c_value:
        state = "identical"
    else:
        state = "different"
    return {"B": b_value, "C": c_value, "state": state, "note": note}


def _uncontrolled_differences(b_manifest: dict, c_manifest: dict, seed: int | None) -> dict:
    """The differences between the legs that the harness did NOT hold fixed.

    Recorded from the manifests' own evidence (the model ids, the prompt
    digests, the resolved env) and from the execution conditions the caller
    declared. An unrecorded side is "not recorded", never "identical".
    """
    b_configuration = (b_manifest.get("configuration") or {}).get("B") or {}
    c_configuration = (c_manifest.get("configuration") or {}).get("C") or {}

    def _side(configuration: dict, config: str) -> dict:
        return {
            "config": config,
            "model_ids": redact_deep(configuration.get("model_ids") or {}),
            "prompt_digests": redact_deep(configuration.get("prompt_digests") or {}),
            # The env as the manifest COMMITTED it (the manifest redacts its
            # own snapshot at build time) — the comparison runs on THIS map,
            # never on the display view below: comparing lossy redacted views
            # would claim an equality the redaction manufactured.
            "resolved_env_committed": configuration.get("resolved_env") or {},
            "resolved_env": redact_deep(configuration.get("resolved_env") or {}),
        }

    b_side = _side(b_configuration, "B")
    c_side = _side(c_configuration, "C")
    differing_env = sorted(
        key
        for key in set(b_side["resolved_env_committed"]) | set(c_side["resolved_env_committed"])
        if b_side["resolved_env_committed"].get(key) != c_side["resolved_env_committed"].get(key)
    )
    return {
        "intentional_difference": pairs_mod.PAIR_CONDITIONS[E02_PAIR]["intentional_difference"],
        "orchestration": {
            "B": "the fixed non-agentic pipeline (a single pass over the same capabilities)",
            "C": "the agent loop (the governed seam's orchestration)",
            "note": (
                "the pair E02 conditions hold the retrieval backend, the preparation and the"
                " admission policy fixed — orchestration is the recorded intentional difference, so"
                " the delta attributes to the agent"
            ),
        },
        "model_ids": _recorded_comparison(
            b_side["model_ids"] or None,
            c_side["model_ids"] or None,
            "the model ids the two legs ran against — a difference here is an UNCONTROLLED difference"
            " (the delta would then attribute a model change to the agent)",
        ),
        "prompt_digests": _recorded_comparison(
            b_side["prompt_digests"] or None,
            c_side["prompt_digests"] or None,
            "the prompt digests the two legs ran against — a difference here is an UNCONTROLLED"
            " difference",
        ),
        "resolved_env": {
            "B": b_side["resolved_env"],
            "C": c_side["resolved_env"],
            "differing_keys": differing_env,
            "state": "identical" if not differing_env else "different",
            "note": (
                "the resolved env is recorded from the two runs' own snapshots; a key that differs"
                " is an uncontrolled difference the reader must weigh"
            ),
        },
        "execution_conditions": {
            "seed": seed,
            "note": (
                "the seed is the operator-declared execution-condition value (--seed); it is"
                " recorded, not verified"
            ),
        },
        "cache_state": {
            "status": "not_recorded",
            "note": "the harness records no cache state — the two legs' cache conditions are uncontrolled",
        },
    }


# ---------------------------------------------------------------------------
# The report
# ---------------------------------------------------------------------------


def e02_report_digest(report: dict) -> str:
    """The report's digest, recomputed over the body minus the embedded
    ``digest`` key — the verifiable identity a rebuild must reproduce."""
    body = {key: value for key, value in report.items() if key != "digest"}
    return sha256_json(body)


def _shared_metrics(b_surface: dict, c_surface: dict) -> dict:
    """The B-vs-C comparison of one dimension: the metrics BOTH legs measured,
    with the delta (C minus B).

    A metric only one leg measured is not in the comparison — there is nothing
    to compare it with, and the report never manufactures the other side.
    """
    b_values = b_surface.get("values") if b_surface.get("available") else None
    c_values = c_surface.get("values") if c_surface.get("available") else None
    if not isinstance(b_values, dict) or not isinstance(c_values, dict):
        return {"available": False, "metrics": {}, "note": "one leg does not carry this dimension's surface"}
    metrics = {}
    for name in sorted(set(b_values) & set(c_values)):
        b_value = b_values[name]
        c_value = c_values[name]
        if isinstance(b_value, (int, float)) and isinstance(c_value, (int, float)):
            metrics[name] = {
                "B": b_value,
                "C": c_value,
                "delta": c_value - b_value,
            }
    return {
        "available": True,
        "metrics": metrics,
        "note": "the delta is C minus B on the metrics both legs measured",
    }


def _verdict(dimensions: dict, gains: dict) -> dict:
    """The honest verdict over the recorded comparison.

    The verdict is a B-vs-C statement:

    * a bound the AGENT's leg breaks is a measured regression — the agent is
      NOT SUPPORTED;
    * a bound the FIXED pipeline's leg breaks is the fixed pipeline's own
      state — it is recorded, never the agent's verdict;
    * the agent answered fewer cases than the fixed pipeline — a measured
      regression;
    * otherwise, when a bound could be applied to the agent's leg and the
      agent gained a class, the gain is SUPPORTED;
    * when nothing could be measured, the verdict is UNASSESSABLE — never a
      pass.
    """
    per_dimension = {}
    agent_failures = []
    fixed_failures = []
    agent_bounds_applied = []
    unassessed = []
    for code, record in dimensions.items():
        b_threshold = record["B"]["threshold"]
        c_threshold = record["C"]["threshold"]
        per_dimension[code] = {
            "dimension": record["dimension"],
            "B": {
                "threshold_status": b_threshold["status"],
                "reason": b_threshold.get("reason"),
                "bounds": b_threshold.get("bounds") or [],
            },
            "C": {
                "threshold_status": c_threshold["status"],
                "reason": c_threshold.get("reason"),
                "bounds": c_threshold.get("bounds") or [],
            },
            "comparison": _shared_metrics(record["B"], record["C"]),
        }
        for leg, threshold in (("C", c_threshold), ("B", b_threshold)):
            bounds = threshold.get("bounds") or []
            # The failure is read off the BOUNDS, not off the dimension's
            # status: a dimension whose sibling bound is not measurable
            # collapses to not_measurable, and gating on the status would
            # mask a measured breach behind it.
            if any(bound["outcome"] == COMPARISON_FAIL for bound in bounds):
                (agent_failures if leg == "C" else fixed_failures).append(
                    {"dimension": code, "leg": leg}
                )
            elif leg == "C" and threshold["status"] == THRESHOLD_APPLIED:
                agent_bounds_applied.append(code)
            if threshold["status"] != THRESHOLD_APPLIED:
                unassessed.append(
                    {
                        "dimension": code,
                        "leg": leg,
                        "threshold_status": threshold["status"],
                        "reason": threshold.get("reason"),
                    }
                )
    classes_with_gain = [
        name
        for name, record in (gains.get("per_class") or {}).items()
        if (record.get("delta") or {}).get("answered", 0) > 0
    ]
    coverage = {
        "B_answered": sum(
            record.get("B", {}).get("n_answered", 0) for record in (gains.get("per_class") or {}).values()
        ),
        "C_answered": sum(
            record.get("C", {}).get("n_answered", 0) for record in (gains.get("per_class") or {}).values()
        ),
    }
    coverage["delta"] = coverage["C_answered"] - coverage["B_answered"]
    if agent_failures or coverage["delta"] < 0:
        state = VERDICT_NOT_SUPPORTED
    elif not agent_bounds_applied:
        state = VERDICT_UNASSESSABLE
    elif classes_with_gain:
        state = VERDICT_SUPPORTED
    else:
        state = VERDICT_UNASSESSABLE
    return {
        "state": state,
        "per_dimension": per_dimension,
        "coverage": coverage,
        "classes_with_a_gain": classes_with_gain,
        "agent_bound_failures": agent_failures,
        "fixed_pipeline_bound_failures": fixed_failures,
        "agent_bounds_applied": agent_bounds_applied,
        "unassessed_dimensions": unassessed,
        "note": (
            "the verdict is a B-vs-C comparison: a bound the AGENT's leg breaks, or a coverage"
            " below the fixed pipeline's, is a measured regression; a bound the FIXED pipeline's"
            " leg breaks is its own state and never the agent's verdict. The agentic benefit stays"
            " a HYPOTHESIS until it is measured on GENIE's own corpora and query mix (PRD §4.1) — a"
            " negative result is recorded, not massaged, and an unmeasured dimension is never read"
            " as a pass"
        ),
    }


def build_e02_report(
    *,
    b_manifest: dict,
    c_manifest: dict,
    b_rows: dict,
    c_rows: dict,
    entries: list[dict],
    set_sha256: str,
    reference_manifest: dict | None = None,
    thresholds: dict | None = None,
    correctness_ledger: dict | None = None,
    created_utc: str | None = None,
    seed: int | None = None,
) -> dict:
    """Build the E02 comparison report — a pure function of its inputs plus
    the pinned ``created_utc``.

    ``entries`` is the assessment set's entries and ``set_sha256`` that set
    file's digest — the query-class source and the proof that the census is
    a claim about the set the legs ran against; ``reference_manifest`` is the
    predecessor the legs were gated against (verified against the legs' own
    lineage, never assumed); ``thresholds`` is the SIGNED thresholds artifact
    — the report applies the agreed bounds and records an explicit absence
    when there is none; ``correctness_ledger`` is CM-2's denominator (the
    cases the fixed pipeline answers correctly), lineage-verified before it is
    applied.
    """
    _verify_legs(
        b_manifest=b_manifest,
        c_manifest=c_manifest,
        b_rows=b_rows,
        c_rows=c_rows,
        set_sha256=set_sha256,
        reference_manifest=reference_manifest,
        thresholds=thresholds,
    )
    b_digest = manifest_digest(b_manifest)
    c_digest = manifest_digest(c_manifest)
    corpus_fingerprint, assessment_set_sha256 = manifest_lineage(b_manifest)

    surfaces = {
        "M-1": (_b_m1(b_rows), _c_m1(c_rows)),
        "M-2": (_b_m2(b_rows), _c_m2(c_rows)),
        "M-3": (_b_m3(b_rows), _c_m3(c_rows)),
        "M-4": (_latency_surface(b_rows, "B", B_M4_SURFACE), _latency_surface(c_rows, "C", C_M4_SURFACE)),
        "M-5": (_b_m5(b_rows), _c_m5(c_rows)),
    }
    from .e01 import M_DIMENSIONS  # the canonical dimension enumeration — one home

    dimensions = {}
    for code, dimension in M_DIMENSIONS.items():
        b_surface, c_surface = surfaces[code]
        dimensions[code] = {
            "dimension": dimension,
            "B": {**b_surface, "threshold": _apply_threshold(thresholds, code, b_surface, "B")},
            "C": {**c_surface, "threshold": _apply_threshold(thresholds, code, c_surface, "C")},
        }

    gains = _build_gains(entries or [], b_rows, c_rows)

    # The costs — CM-1..CM-3, reused from story 4.4, never recomputed here.
    try:
        counter_report = build_counter_metrics_report(
            reference_rows=b_rows,
            candidate_rows=c_rows,
            reference_manifest=b_manifest,
            correctness_ledger=correctness_ledger,
            created_utc=created_utc,
        )
    except CounterMetricsRefusal as refused:
        raise E02Refusal(refused.reason, str(refused)) from refused

    per_case = {}
    for case_id in sorted(set(b_rows) | set(c_rows)):
        b_row = b_rows.get(case_id)
        c_row = c_rows.get(case_id)
        per_case[case_id] = {
            "b": redact_deep(b_row) if isinstance(b_row, dict) else None,
            "c": redact_deep(c_row) if isinstance(c_row, dict) else None,
        }

    body = {
        "artifact": E02_REPORT_ARTIFACT,
        "version": E02_REPORT_VERSION,
        "protocol_version": PROTOCOL_VERSION,
        "pair": E02_PAIR,
        "created_utc": created_utc or datetime.now(UTC).isoformat(timespec="seconds"),
        "honest_evidence": HONEST_EVIDENCE_STATEMENT,
        "inputs": {
            "b_manifest_sha256": b_digest,
            "c_manifest_sha256": c_digest,
            "b_rows_sha256": sha256_json(b_rows),
            "c_rows_sha256": sha256_json(c_rows),
            "assessment_set_sha256": assessment_set_sha256,
            "assessment_set_digest_supplied": set_sha256,
            "corpus_fingerprint": corpus_fingerprint,
            "reference_manifest_sha256": manifest_digest(reference_manifest) if reference_manifest else None,
            "thresholds_sha256": sha256_json(thresholds) if thresholds is not None else None,
            "correctness_ledger_sha256": sha256_json(correctness_ledger) if correctness_ledger is not None else None,
        },
        "thresholds": {
            "present": thresholds is not None,
            "signed": bool(thresholds.get("signed")) if isinstance(thresholds, dict) else False,
            "scope": ((thresholds.get("thresholds") or {}).get("M-1", {}).get("value") or {}).get("scope")
            if isinstance(thresholds, dict)
            else None,
            "note": (
                "the thresholds are the operator's decision (story 4.4's registry), consumed as-is:"
                " the report applies the agreed bounds and records an explicit absence where none"
                " was agreed"
            ),
        },
        "dimensions": dimensions,
        "gains": gains,
        "costs": counter_report,
        "uncontrolled_differences": _uncontrolled_differences(b_manifest, c_manifest, seed),
        "per_case": per_case,
        "counts": {
            "n_cases": len(per_case),
            "b_recorded": sum(1 for record in per_case.values() if record["b"] is not None),
            "c_recorded": sum(1 for record in per_case.values() if record["c"] is not None),
            "b_missing": sum(1 for record in per_case.values() if record["b"] is None),
            "c_missing": sum(1 for record in per_case.values() if record["c"] is None),
            "n_query_classes": len(gains.get("per_class") or {}),
            "n_query_classes_not_covered": len(gains.get("not_covered") or []),
        },
    }
    body["verdict"] = _verdict(dimensions, gains)
    body["digest"] = e02_report_digest(body)
    return body
