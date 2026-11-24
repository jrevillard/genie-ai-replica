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
leg and the C leg into per-dimension records, the gains per query class, the
costs, the thresholds applied, the uncontrolled differences and an honest
verdict.

The honesty rules are the point of the layer, and they are the reason the
report is allowed to be unsatisfying:

* a surface a leg cannot provide is recorded as NOT AVAILABLE with its reason —
  never invented, never silently dropped;
* a threshold nobody agreed is recorded as ABSENT with its blocking reason —
  never defaulted, never reported as satisfied;
* a bound scoped to another configuration's surface is recorded as NOT
  MEASURABLE here — the signed retrieval bounds are scoped to config A's
  chunk-level anchor metrics, and config B/C measure the doc-level surface, so
  the bounds do not transfer (the thresholds registry says so in its own
  ``surface`` and ``scope`` fields);
* a query class the assessment set does not carry is recorded as NOT COVERED —
  the agentic benefit the PRD §4.1 note describes (multi-hop and ambiguous
  queries) stays a HYPOTHESIS until a set carries those cases;
* a negative result is recorded, not massaged.
"""

from __future__ import annotations

from datetime import UTC, datetime

from . import PROTOCOL_VERSION
from . import pairs as pairs_mod
from .counter_metrics import CounterMetricsRefusal, build_counter_metrics_report
from .evalset import base_case_id
from .manifest import manifest_digest, sha256_json

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
B_M5_SURFACE = "the B row's resource record (the row's metadata.usage)"
C_M5_SURFACE = "the C row's usage_record"

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
THRESHOLD_UNINTERPRETABLE = "uninterpretable"

# The comparison outcomes.
COMPARISON_PASS = "pass"
COMPARISON_FAIL = "fail"
COMPARISON_NOT_MEASURABLE = "not_measurable"

# The E02 verdict states.
VERDICT_SUPPORTED = "supported"
VERDICT_NOT_SUPPORTED = "not_supported"
VERDICT_UNASSESSABLE = "unassessable"


class E02Refusal(RuntimeError):
    """The E02 report is refused; ``reason`` names the offending input."""

    def __init__(self, reason: str, message: str):
        self.reason = reason
        super().__init__(message)


# ---------------------------------------------------------------------------
# The typed refusals — before any report is built
# ---------------------------------------------------------------------------


def _manifest_lineage(manifest: dict) -> tuple[str | None, str | None]:
    """The (corpus fingerprint, assessment-set digest) a manifest records."""
    corpus = (manifest.get("corpus") or {}).get("fingerprint")
    assessment = ((manifest.get("sets") or {}).get("assessment") or {}).get("sha256")
    return corpus, assessment


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
    reference_manifest: dict | None = None,
    thresholds: dict | None = None,
) -> None:
    """The leg-artifact and lineage checks, in refusal order: presence, leg
    identity, lineage.

    The E02 lineage is stricter than E01's in one respect: BOTH legs are gated
    runs, and they must have been gated against the SAME predecessor — two
    legs gated against different references were measured under different
    thresholds, and comparing them would attribute the difference to the
    agent.
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

    b_corpus, b_set = _manifest_lineage(b_manifest)
    c_corpus, c_set = _manifest_lineage(c_manifest)
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

    # Both legs are gated runs: the gate wrote the predecessor it selected into
    # each manifest. They must be the SAME predecessor — a comparison across
    # two predecessors would attribute the thresholds' difference to the agent.
    b_gated_against = (b_manifest.get("lineage") or {}).get("reference_manifest_sha256")
    c_gated_against = (c_manifest.get("lineage") or {}).get("reference_manifest_sha256")
    if not b_gated_against or not c_gated_against:
        raise E02Refusal(
            "lineage_mismatch",
            "a gated leg carries no reference-manifest lineage — the gate records the predecessor"
            " it selected — refusing before the report is built",
        )
    if b_gated_against != c_gated_against:
        raise E02Refusal(
            "lineage_mismatch",
            f"the legs were gated against DIFFERENT predecessors ({b_gated_against!r} vs"
            f" {c_gated_against!r}) — they were measured under different thresholds, so the"
            " comparison would attribute the difference to the agent — refusing before the report is built",
        )
    if reference_manifest is not None:
        reference_digest = manifest_digest(reference_manifest)
        if reference_digest != b_gated_against:
            raise E02Refusal(
                "lineage_mismatch",
                f"the supplied reference manifest ({reference_digest!r}) is not the predecessor the"
                f" legs were gated against ({b_gated_against!r}) — refusing before the report is built",
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
        if thresholds.get("reference_manifest_sha256") != b_gated_against:
            raise E02Refusal(
                "thresholds_lineage_mismatch",
                "the thresholds artifact references another predecessor than the legs were gated"
                " against — refusing before the report is built",
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
    outcome, and the record SAYS so instead of inventing an abstention count.
    """
    answered = _c_answered_rows(c_rows)
    return _surface_record(
        surface=C_M3_SURFACE,
        available=True,
        values={
            "n_answered_rows": len(answered),
            "n_rows_with_abstention_fact": 0,
            "n_cancelled_rows": sum(1 for row in c_rows.values() if isinstance(row, dict) and row.get("outcome") == "cancelled"),
            "n_error_rows": sum(
                1
                for row in c_rows.values()
                if isinstance(row, dict) and row.get("outcome") not in (None, "answered")
            ),
        },
        notes=[
            "config C carries no mechanical abstention flag (the no-agent pipeline owns it): the"
            " abstention correctness of the agentic leg is a JUDGED dimension — the row carries"
            " the answer text and the terminal outcome, and the judge layer decides",
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
    return _surface_record(
        surface=surface,
        available=True,
        values={**_latency_stats(walls), "n_excluded_non_answered_rows": excluded},
    )


def _b_m5(b_rows: dict) -> dict:
    recorded: dict = {}
    for row in _b_ok_rows(b_rows):
        metadata = row.get("metadata")
        if not isinstance(metadata, dict):
            continue
        for key, value in metadata.items():
            if str(key) != "usage":
                continue
            recorded.setdefault(str(key), value)
    if recorded:
        return _surface_record(surface=B_M5_SURFACE, available=True, values=recorded)
    return _surface_record(
        surface=B_M5_SURFACE,
        available=False,
        not_available_reason=(
            "the B rows carry no resource record (metadata.usage) — the recorded absence is not a zero"
        ),
    )


def _c_m5(c_rows: dict) -> dict:
    recorded: dict = {}
    for row in _c_answered_rows(c_rows):
        usage = row.get("usage_record")
        if not isinstance(usage, dict):
            continue
        for key, value in usage.items():
            recorded.setdefault(str(key), value)
    if recorded:
        return _surface_record(surface=C_M5_SURFACE, available=True, values=recorded)
    return _surface_record(
        surface=C_M5_SURFACE,
        available=False,
        not_available_reason=(
            "the C rows carry no usage_record — the recorded absence is not a zero"
        ),
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


def _bound_records(value) -> list[dict]:
    """The signed bounds of one dimension, whatever shape the registry gave
    them: a per-metric mapping (the M-1 shape) or a single bound.

    A bound the shape is not understood for is NOT dropped — it is returned
    with ``operator: None`` so the report records it as uninterpretable
    instead of silently ignoring a signed number.
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
    return [{"metric": None, "operator": operator, "threshold": threshold, "shape": "single"}]


def _compare(operator: str, measured, threshold) -> bool | None:
    """The comparison itself; None when the two sides are not comparable."""
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


def _lookup_metric(values: dict, metric: str | None):
    """The measured value of a metric in a surface's values mapping.

    The lookup is BY NAME and depth-aware (the M-1 shape nests the metrics
    under ``metrics``); a surface that does not carry the metric yields None,
    which the caller records as NOT MEASURABLE.
    """
    if not isinstance(values, dict):
        return None
    if metric is None:
        return None
    if metric in values:
        candidate = values[metric]
        return candidate if isinstance(candidate, (int, float)) and not isinstance(candidate, bool) else None
    nested = values.get("metrics")
    if isinstance(nested, dict) and metric in nested:
        candidate = nested[metric]
        return candidate if isinstance(candidate, (int, float)) and not isinstance(candidate, bool) else None
    return None


def _apply_threshold(thresholds: dict | None, code: str, surface: dict) -> dict:
    """Apply the signed bound of one dimension to one leg's measured surface.

    The outcome vocabulary is explicit: ``applied`` (the bound was compared
    and the result is pass/fail), ``absent`` (nobody agreed a bound — the
    blocking reason is recorded), ``not_measurable`` (the bound is scoped to
    another surface — it does not transfer) and ``uninterpretable`` (the
    signed shape carries no comparable direction).
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
    values = surface.get("values") if surface.get("available") else None
    bounds = []
    for record in _bound_records(value):
        measured = _lookup_metric(values, record["metric"])
        if record["operator"] is None:
            outcome = THRESHOLD_UNINTERPRETABLE
            comparison = None
            reason = (
                "the signed bound carries no comparable direction — it is recorded, never guessed"
            )
        elif measured is None:
            outcome = THRESHOLD_NOT_MEASURABLE
            comparison = None
            reason = (
                f"this leg's measurement surface does not carry {record['metric']!r} — the signed"
                " bound is scoped to another surface and does not transfer"
                + (f" (the signed scope: {scope})" if scope else "")
            )
        else:
            comparison = _compare(record["operator"], measured, record["threshold"])
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
    else:
        status = THRESHOLD_NOT_MEASURABLE
    record = {"status": status, "scope": scope, "bounds": bounds}
    if status == THRESHOLD_NOT_MEASURABLE:
        record["reason"] = (
            "no signed bound is measurable on this leg's surface — the signed bounds apply to"
            " another configuration's measurement surface"
        )
    elif status == THRESHOLD_UNINTERPRETABLE:
        record["reason"] = "a signed bound carries no comparable direction — recorded, never guessed"
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
    """The per-class counts of one leg: answered, abstained, failed, cancelled."""
    stats = {"n_answered": 0, "n_abstained": 0, "n_failed": 0, "n_cancelled": 0, "n_rows": 0}
    for row in rows.values():
        if not isinstance(row, dict):
            continue
        stats["n_rows"] += 1
        if config == "B":
            if row.get("status") == "failure":
                stats["n_failed"] += 1
                continue
            if row.get("abstained") is True:
                stats["n_abstained"] += 1
            if row.get("status") == "ok":
                stats["n_answered"] += 1
        else:
            outcome = row.get("outcome")
            if outcome == "cancelled":
                stats["n_cancelled"] += 1
                continue
            if outcome != "answered":
                stats["n_failed"] += 1
                continue
            stats["n_answered"] += 1
    return stats


def _class_latency(rows: dict, config: str, case_ids: set[str]) -> list[float]:
    walls = []
    for case_id in case_ids:
        row = rows.get(case_id)
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

    The two classes the PRD §4.1 note names (multi-hop, ambiguous) are
    reported even when the set carries no case of them: a class with no case
    is NOT COVERED, and the benefit stays a hypothesis.
    """
    class_of: dict[str, str] = {}
    for entry in entries or []:
        if not isinstance(entry, dict) or not entry.get("id"):
            continue
        class_of[base_case_id(entry["id"])] = _query_class(entry)

    members: dict[str, set[str]] = {}
    for case_id in set(b_rows) | set(c_rows):
        base = base_case_id(case_id)
        members.setdefault(class_of.get(base, "unclassified"), set()).add(case_id)

    per_class = {}
    for name in sorted(members):
        case_ids = members[name]
        b_stats = _leg_class_stats({cid: b_rows[cid] for cid in case_ids if cid in b_rows}, "B")
        c_stats = _leg_class_stats({cid: c_rows[cid] for cid in case_ids if cid in c_rows}, "C")
        b_walls = _class_latency(b_rows, "B", case_ids)
        c_walls = _class_latency(c_rows, "C", case_ids)
        per_class[name] = {
            "n_cases": len(case_ids),
            "B": {**b_stats, "latency": _latency_stats(b_walls) if b_walls else None},
            "C": {**c_stats, "latency": _latency_stats(c_walls) if c_walls else None},
            "delta": {
                "answered": c_stats["n_answered"] - b_stats["n_answered"],
                "abstained": c_stats["n_abstained"] - b_stats["n_abstained"],
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
        if name in per_class:
            continue
        not_covered.append(
            {
                "query_class": name,
                "n_cases": 0,
                "reason": (
                    "the assessment set carries no case of this class — the agentic benefit the"
                    " PRD §4.1 note describes stays a HYPOTHESIS until a set carries the class;"
                    " the set is frozen at the digest the signed thresholds bind to, so it cannot"
                    " be extended without invalidating the signature"
                ),
            }
        )
    return {"per_class": per_class, "not_covered": not_covered}


# ---------------------------------------------------------------------------
# The uncontrolled differences — recorded evidence only
# ---------------------------------------------------------------------------


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
            "model_ids": configuration.get("model_ids") or {},
            "prompt_digests": configuration.get("prompt_digests") or {},
            "resolved_env": configuration.get("resolved_env") or {},
        }

    b_side = _side(b_configuration, "B")
    c_side = _side(c_configuration, "C")
    differing_env = sorted(
        key
        for key in set(b_side["resolved_env"]) | set(c_side["resolved_env"])
        if b_side["resolved_env"].get(key) != c_side["resolved_env"].get(key)
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
        "model_ids": {"B": b_side["model_ids"], "C": c_side["model_ids"]},
        "prompt_digests": {"B": b_side["prompt_digests"], "C": c_side["prompt_digests"]},
        "resolved_env_differences": {
            "differing_keys": differing_env,
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


def _verdict(dimensions: dict, gains: dict) -> dict:
    """The honest verdict over the recorded dimensions.

    The agentic benefit is SUPPORTED only when a measured dimension shows the
    agent ahead of the fixed pipeline AND the dimension carries a bound that
    was actually applied. A dimension with no applicable bound leaves the
    question unassessed — never a pass.
    """
    assessed = []
    unassessed = []
    failed = []
    for code, record in dimensions.items():
        for leg in E02_LEGS:
            threshold = record[leg]["threshold"]
            status = threshold.get("status")
            if status != THRESHOLD_APPLIED:
                unassessed.append(
                    {
                        "dimension": code,
                        "leg": leg,
                        "threshold_status": status,
                        "reason": threshold.get("reason"),
                    }
                )
                continue
            outcomes = {bound["outcome"] for bound in threshold.get("bounds") or []}
            if COMPARISON_FAIL in outcomes:
                failed.append({"dimension": code, "leg": leg})
            else:
                assessed.append({"dimension": code, "leg": leg})
    not_covered = [entry["query_class"] for entry in gains.get("not_covered") or []]
    if failed:
        state = VERDICT_NOT_SUPPORTED
    elif not assessed:
        state = VERDICT_UNASSESSABLE
    else:
        state = VERDICT_SUPPORTED
    return {
        "state": state,
        "assessed_dimensions": assessed,
        "failed_dimensions": failed,
        "unassessed_dimensions": unassessed,
        "not_covered_query_classes": not_covered,
        "note": (
            "the agentic benefit stays a HYPOTHESIS until it is measured on GENIE's own corpora"
            " and query mix (PRD §4.1) — a negative result is recorded, not massaged, and an"
            " unassessed dimension is never read as a pass"
        ),
    }


def build_e02_report(
    *,
    b_manifest: dict,
    c_manifest: dict,
    b_rows: dict,
    c_rows: dict,
    entries: list[dict] | None = None,
    reference_manifest: dict | None = None,
    thresholds: dict | None = None,
    correctness_ledger: dict | None = None,
    created_utc: str | None = None,
    seed: int | None = None,
) -> dict:
    """Build the E02 comparison report — a pure function of its inputs plus
    the pinned ``created_utc``.

    ``entries`` is the assessment set's entries (the query-class source);
    ``reference_manifest`` is the predecessor the legs were gated against (it
    is verified against the legs' own lineage, never assumed);
    ``thresholds`` is the SIGNED thresholds artifact — the report applies the
    agreed bounds and records an explicit absence when there is none;
    ``correctness_ledger`` is CM-2's denominator (the cases the fixed pipeline
    answers correctly), lineage-verified before it is applied.
    """
    _verify_legs(
        b_manifest=b_manifest,
        c_manifest=c_manifest,
        b_rows=b_rows,
        c_rows=c_rows,
        reference_manifest=reference_manifest,
        thresholds=thresholds,
    )
    b_digest = manifest_digest(b_manifest)
    c_digest = manifest_digest(c_manifest)
    corpus_fingerprint, assessment_set_sha256 = _manifest_lineage(b_manifest)

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
            "B": {**b_surface, "threshold": _apply_threshold(thresholds, code, b_surface)},
            "C": {**c_surface, "threshold": _apply_threshold(thresholds, code, c_surface)},
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
            "b": b_row if isinstance(b_row, dict) else None,
            "c": c_row if isinstance(c_row, dict) else None,
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
            "corpus_fingerprint": corpus_fingerprint,
            "reference_manifest_sha256": manifest_digest(reference_manifest) if reference_manifest else None,
            "thresholds_sha256": sha256_json(thresholds) if thresholds is not None else None,
            "correctness_ledger_sha256": sha256_json(correctness_ledger) if correctness_ledger is not None else None,
        },
        "thresholds": {
            "present": thresholds is not None,
            "signed": bool(thresholds.get("signed")) if isinstance(thresholds, dict) else False,
            "scope": (thresholds.get("thresholds") or {}).get("M-1", {}).get("value", {}).get("scope")
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
