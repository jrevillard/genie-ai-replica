#!/usr/bin/env python3
# Copyright (C) 2026 ITU
# SPDX-License-Identifier: Apache-2.0
"""Multi-config per-tab xlsx generator for the RAG eval toolchain.

Builds a single operator-facing workbook from N eval runs. Each run becomes
its own tab; the source xlsx is preserved as the ``Gold`` tab. A
``Compare`` tab aggregates per-run metrics with delta-vs-first-run; an
optional ``Calibrate`` tab embeds the offline-sweep grid; a ``Charts``
tab embeds four matplotlib PNGs (anchor metrics, RAGAS metrics, precision/
recall scatter, query-status stacked bar).

Read this script top-to-bottom — it is organised as:

  1. Constants (paths, enums, column schema, column documentation)
  2. Data types (frozen dataclasses for RunSpec and Aggregate)
  3. Pure helpers (no I/O — JSON envelope unwrap, abstention detection,
     n_evaluable accounting, key list formatting, ratio guard)
  4. Loaders (typed readers for the source JSON artifacts)
  5. Per-row enrichment (``build_run_row``)
  6. Per-run aggregate (``aggregate_run`` + ``run_ragas_rows``)
  7. Compare tab (``build_compare_rows`` + delta helpers)
  8. Calibrate tab (``build_calibrate_rows``)
  9. Charts (``build_charts`` + four private ``_chart_*``)
  10. Workbook builders (one per tab type)
  11. Source xlsx loading (``_load_source_workbook`` + ``_find_id_col``)
  12. Orchestrator (``build_workbook`` + ``main``)
  13. CLI (``__main__`` guard)

The script is generic across deployments: no hostnames, IPs, stack
names, or DB names are hardcoded. The ``--charts-assets-dir`` defaults
to a per-invocation tempdir so the script does not leave orphan files
in any operator-specific path. Each tool-chain integration (eval run
on a deployment) is described by a ``runs.json`` file the operator
authors; the script never reaches out to remote systems.
"""
from __future__ import annotations

import argparse
import json
import logging
import math
import statistics
import sys
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import openpyxl
from openpyxl.comments import Comment
from openpyxl.styles import Font, PatternFill
from openpyxl.utils import get_column_letter
from openpyxl.workbook import Workbook
from openpyxl.worksheet.worksheet import Worksheet

LOG = logging.getLogger("enrich_xlsx_v2")

# Default Excel cell width heuristic (characters).
_DEFAULT_COL_WIDTH = 14
_MAX_COL_WIDTH = 60

# Header-row fill (light grey) — makes the auto_filter row pop.
_HEADER_FILL_COLOR = "E7E6E6"

# Source xlsx has trailing None columns we preserve. The source id
# column is keyed by the formula ``=ROW()-1`` evaluating to 1..N; we
# translate that to the eval key ``new-<N>`` which the per-row JSON
# artifacts use.
_ID_FORMULA_EVALUATED = lambda raw: f"new-{int(raw)}"  # noqa: E731


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------


#: Per-row enriched columns. Order is preserved in the output xlsx.
NEW_COLS: tuple[str, ...] = (
    "gold_recall",
    "gold_complete_recall",
    "gold_precision",
    "gold_noise",
    "gold_retrieval_recall",
    "gold_passage_recall",
    "selected_keys",
    "candidate_keys",
    "trace_found",
    "ragas_faithfulness",
    "ragas_context_precision",
    "ragas_context_recall",
    "ragas_answer_relevancy",
    "ragas_nan",
    "answer_first_200",
    "abstained",
    "abstention_reason",
    "answer_lang",
    "gold_match_status_per_chunk",
    "gold_chunk_count",
    "is_unresolved",
    "n_evaluable_helper",
)


#: Default location for the embedded chart PNGs. Operators who prefer
#: a different cache dir can pass ``--charts-assets-dir``. Defaults to
#: ``None`` (resolved at runtime to a temp-dir-per-invocation) so the
#: script stays deployment-agnostic and never leaves orphan files in
#: a hardcoded path. See ``main()`` for the resolution.
DEFAULT_CHARTS_ASSETS_DIR: Path | None = None


#: Per-column tooltip (Excel cell comment) on the header row of every
#: ``Run_<label>`` tab. Unit + semantics + range spelled out.
COLUMN_DOCS: dict[str, str] = {
    "gold_recall": (
        "Fraction of gold chunks that survived reranking (in selected). "
        "Range [0, 1]. Set-based, ignores order. Headline number for the anchor path."
    ),
    "gold_complete_recall": (
        "Fraction of queries where ALL gold chunks were selected. Penalises "
        "partial hits harshly. Range [0, 1]."
    ),
    "gold_precision": (
        "Fraction of selected chunks that are gold. signal vs noise. Range [0, 1]."
    ),
    "gold_noise": (
        "1 − gold_precision. Fraction of selected chunks that are NOT gold. "
        "Higher = noisier. Range [0, 1]."
    ),
    "gold_retrieval_recall": (
        "Fraction of gold chunks in the CANDIDATE set (pre-rerank). "
        "Diagnoses retriever vs reranker. Range [0, 1]."
    ),
    "gold_passage_recall": (
        "Passage-level recall (weighted by passage, not chunk). Aggregated "
        "across all queries. Range [0, 1]."
    ),
    "selected_keys": (
        "Comma-joined ArangoDB _keys of chunks that survived reranking. "
        "Truncated to 8 entries with '(+N)' marker. Debug column."
    ),
    "candidate_keys": (
        "Comma-joined ArangoDB _keys of candidates returned by the retriever "
        "(pre-rerank). Truncated to 8 entries. Debug column."
    ),
    "trace_found": (
        "Boolean: did the eval find a chatqna.reranker_selection OTel span "
        "for this query? False → row counted as missed-trace."
    ),
    "ragas_faithfulness": (
        "RAGAS faithfulness: is the answer grounded in the retrieved contexts "
        "(LLM-judged, hallucination detector). Range [0, 1]."
    ),
    "ragas_context_precision": (
        "RAGAS context_precision: are relevant chunks ranked above "
        "irrelevant ones (LLM-judged ranking quality). Range [0, 1]."
    ),
    "ragas_context_recall": (
        "RAGAS context_recall: do the retrieved contexts cover the reference "
        "answer (LLM-judged, needs reference_answer). Range [0, 1]."
    ),
    "ragas_answer_relevancy": (
        "RAGAS answer_relevancy: does the answer address the question "
        "(embedding-based). Range [0, 1]."
    ),
    "ragas_nan": (
        "Sentinel: 'ALL_NAN' if every RAGAS metric is NaN for this row; "
        "empty otherwise. Spots rows that bypassed the LLM judge entirely."
    ),
    "answer_first_200": (
        "First 200 chars of the chatqna response (envelope unwrapped: "
        'parses the {"response": "..."} JSON and decodes literal \\uXXXX escapes).'
    ),
    "abstained": (
        "yes / no — yes if the response matches an abstention pattern "
        "(the project knowledge base does not contain / I do not have "
        "sufficient information / no dispongo de información suficiente). "
        "Patterns are defined in ABSTENT_PATTERNS at the top of the script "
        "and can be extended by the operator."
    ),
    "abstention_reason": (
        "Which abstention pattern matched. Empty when abstained=no. "
        "For taxonomy extension, add patterns in ABSTENT_PATTERNS."
    ),
    "answer_lang": (
        "Per-query language. Reads from gold (gold.language) first, falls "
        "back to tuples.lang if present."
    ),
    "gold_match_status_per_chunk": (
        "Per-chunk match status from the matched gold: ';' joined, values "
        "are resolved / resolved_split / unresolved / skipped_short / '?'. "
        "OOS queries show all-unresolved."
    ),
    "gold_chunk_count": (
        "Number of expected_chunks for this query in the gold. 0 for OOS, "
        "1+ otherwise."
    ),
    "is_unresolved": (
        "Boolean: True iff every expected chunk is unresolved. These rows "
        "are EXCLUDED from n_evaluable (mirrors the live gate's n_evaluable "
        "semantics)."
    ),
    "n_evaluable_helper": (
        "0/1 — 1 if this row counts toward the anchor aggregate "
        "(eval-eligible), 0 if excluded (unresolved gold). Sum down the "
        "column to recover n_evaluable; re-divide for apples-to-apples mean "
        "vs the gate's n=87 of 90."
    ),
}


#: Abstention patterns. Lowercased substring match against the unwrapped
#: + unicode-decoded answer. Order is meaningful for the ``abstention_reason``
#: column (first match wins). The list is generic across deployments — the
#: "knowledge base does not contain" pattern is the universal "I don't
#: know" shape used by the GENIE.AI chatqna's default abstention prompt;
#: the Spanish variant is included because chatqna is multilingual.
ABSTENT_PATTERNS: tuple[str, ...] = (
    "does not contain specific information",
    "do not have sufficient information",
    "no dispongo de información suficiente",
    "knowledge base does not contain",
)


#: RAGAS metric keys, in display order. Used to fetch + check NaN uniformly.
RAGAS_KEYS: tuple[str, ...] = (
    "faithfulness",
    "context_precision",
    "context_recall",
    "answer_relevancy",
)


#: Top-N for the selected_keys / candidate_keys preview columns.
_KEYS_PREVIEW_LIMIT = 8


#: Excel sheet-title cap is 31 chars. The per-run tab name is
#: ``Run_<label>`` (5 chars prefix), so labels must be <= 26 chars.
_MAX_LABEL_LEN = 26


#: Map a run's internal key to the corresponding NEW_COLS entry for the
#: per-row RAGAS values (the column name is "ragas_<key>").
RAGAS_KEY_TO_COL: dict[str, str] = {k: f"ragas_{k}" for k in RAGAS_KEYS}


#: Compare tab column schema. ``delta_*`` is computed vs the first run.
COMPARE_HEADERS: tuple[str, ...] = (
    "label",
    "params",
    "n_evaluable",
    "n_abstained",
    "n_unresolved",
    "recall",
    "precision",
    "f1",
    "complete_recall",
    "retrieval_recall",
    "passage_recall",
    "avg_selected",
    "ragas_faithfulness",
    "ragas_context_precision",
    "ragas_context_recall",
    "ragas_answer_relevancy",
    "delta_recall_vs_base",
    "delta_f1_vs_base",
)


#: Calibrate tab column schema (when --calibrate is given).
CALIBRATE_HEADERS: tuple[str, ...] = (
    "rank",
    "recall",
    "precision",
    "f1",
    "avg_selected",
    "empty",
    "factor",
    "confusion",
    "threshold",
    "passage_recall",
)


# ---------------------------------------------------------------------------
# Data types
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class RunSpec:
    """One run to materialise as a tab in the output workbook."""

    label: str
    anchor: Path | None
    ragas: Path | None
    tuples: Path | None
    params: dict[str, Any] = field(default_factory=dict)
    note: str = ""

    @classmethod
    def from_dict(cls, raw: dict[str, Any]) -> RunSpec:
        return cls(
            label=str(raw.get("label", "run")),
            anchor=Path(raw["anchor"]) if raw.get("anchor") else None,
            ragas=Path(raw["ragas"]) if raw.get("ragas") else None,
            tuples=Path(raw["tuples"]) if raw.get("tuples") else None,
            params=dict(raw.get("params", {})),
            note=str(raw.get("note", "")),
        )


@dataclass(frozen=True)
class Aggregate:
    """Per-run aggregate mirrors the live gate's ``aggregate`` field."""

    n_evaluable: int
    n_abstained: int
    n_unresolved: int
    recall: float
    precision: float
    f1: float
    complete_recall: float
    retrieval_recall: float
    passage_recall: float
    avg_selected: float
    ragas: dict[str, float]  # key -> mean over non-NaN rows (or 0.0 if empty)

    def to_compare_row(self) -> list[Any]:
        return [
            self.n_evaluable,
            self.n_abstained,
            self.n_unresolved,
            self.recall,
            self.precision,
            self.f1,
            self.complete_recall,
            self.retrieval_recall,
            self.passage_recall,
            self.avg_selected,
            *self.ragas.values(),
        ]


# ---------------------------------------------------------------------------
# Pure helpers (no I/O)
# ---------------------------------------------------------------------------


def _is_nan(v: Any) -> bool:
    """Return True for ``None``, ``NaN`` floats, and missing keys.

    Used by the RAGAS helper (``ragas_nan`` sentinel column) and the
    aggregate builder (mean over non-NaN values).
    """
    if v is None:
        return True
    if isinstance(v, float) and math.isnan(v):
        return True
    return False


def _is_unresolved(g_row: dict[str, Any]) -> bool:
    """True iff every expected chunk is unresolved. OOS rows have no
    expected_chunks and are also treated as unresolved (excluded from
    n_evaluable). Mirrors the live gate's semantics.
    """
    chunks = g_row.get("expected_chunks") or []
    if not chunks:
        return True
    return all((c.get("match_status") or "unresolved") == "unresolved" for c in chunks)


def _extract_response(answer: Any) -> str:
    """Unwrap the chatqna JSON envelope ``{"response": "..."}`` and decode
    literal ``\\uXXXX`` escapes the v5 G2 run exposed on the Spanish
    abstention path. Non-string or non-JSON inputs pass through verbatim.
    """
    if not answer or not isinstance(answer, str):
        return answer or ""
    try:
        env = json.loads(answer)
    except (TypeError, ValueError):
        return answer
    inner = env.get("response", env.get("answer", "")) if isinstance(env, dict) else str(env)
    if isinstance(inner, str) and "\\u" in inner:
        try:
            inner = inner.encode("utf-8").decode("unicode_escape")
        except (UnicodeDecodeError, UnicodeEncodeError):
            pass
    return inner or ""


def is_abstention(answer: str) -> tuple[bool, str]:
    """Tuple of (matched?, pattern). First match wins; matched patterns
    are returned in their source order.
    """
    if not answer:
        return False, ""
    lo = answer.lower()
    for pattern in ABSTENT_PATTERNS:
        if pattern in lo:
            return True, pattern
    return False, ""


def _fmt_keys(arr: Sequence[str] | None, limit: int = _KEYS_PREVIEW_LIMIT) -> str:
    """Semicolon-join a key list for the preview column. Append ``(+N)``
    when truncated. Empty input → empty string.
    """
    if not arr:
        return ""
    head = list(arr[:limit])
    if len(arr) > limit:
        head.append(f"...(+{len(arr) - limit})")
    return ";".join(head)


def _eval_id_from_source_row(source_row: Sequence[Any], id_col: int) -> str:
    """Translate a source xlsx row into the eval-side id (``new-N``).

    The source xlsx stores ``id`` as the formula ``=ROW()-1`` (openpyxl
    evaluates it to an int 1..N). We coerce to ``new-<N>``. Non-int values
    pass through (with a string cast) so source xlsx layouts that don't
    use the auto-increment pattern are handled best-effort.
    """
    raw = source_row[id_col] if id_col < len(source_row) else None
    try:
        return _ID_FORMULA_EVALUATED(raw)
    except (TypeError, ValueError):
        # Source layouts that don't use the =ROW()-1 pattern (manual id
        # cells, custom id columns) pass through with a string cast.
        return str(raw) if raw is not None else ""


def _safe_ratio(num: int, den: int) -> float:
    """Return num/den, or 0.0 when den is 0. Used by per-row recall and
    precision to avoid ZeroDivisionError on empty gold / empty selection.
    """
    return (num / den) if den else 0.0


# ---------------------------------------------------------------------------
# Loaders (typed readers for the source JSON artifacts)
# ---------------------------------------------------------------------------


def load_gold(path: Path) -> dict[str, dict[str, Any]]:
    """Return a ``{id: entry}`` map from a matched-gold JSON file."""
    data = json.loads(path.read_text(encoding="utf-8"))
    return {str(e["id"]): e for e in data.get("entries", [])}


def load_anchor(path: Path) -> dict[str, dict[str, Any]]:
    """Return a ``{id: per_query_row}`` map from an anchor report."""
    data = json.loads(path.read_text(encoding="utf-8"))
    return {r["id"]: r for r in data.get("per_query", []) if r.get("id")}


def load_ragas(path: Path) -> dict[str, dict[str, Any]]:
    """Return a ``{question_text: per_query_row}`` map from a RAGAS report.

    RAGAS reports are keyed by ``user_input`` (= the question text). The
    Run_ tab joins rows back to RAGAS via the gold query text.
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    return {
        r.get("user_input", "").strip(): r
        for r in data.get("per_query", [])
        if r.get("user_input")
    }


def load_tuples(path: Path) -> tuple[dict[str, dict[str, Any]], dict[str, dict[str, Any]]]:
    """Return ``({id: row}, {question: row})`` from a dump-tuples report.

    The two-map return lets the per-row builder match either by id (faster,
    exact) or by question text (fallback if id is missing or misaligned).
    """
    data = json.loads(path.read_text(encoding="utf-8"))
    rows = data if isinstance(data, list) else data.get("tuples", data.get("per_query", []))
    by_id = {r.get("id"): r for r in rows if r.get("id")}
    by_q = {r.get("question", "").strip(): r for r in rows if r.get("question")}
    return by_id, by_q


# ---------------------------------------------------------------------------
# Per-row enrichment
# ---------------------------------------------------------------------------


def build_run_row(
    eval_id: str,
    gold_by_id: dict[str, dict[str, Any]],
    a_by_id: dict[str, dict[str, Any]],
    ragas_by_q: dict[str, dict[str, Any]],
    tuples_by_id: dict[str, dict[str, Any]],
    tuples_by_q: dict[str, dict[str, Any]],
) -> list[Any]:
    """Build the 22 enriched cells for one Run_ tab row.

    Joins per-query anchor + RAGAS + tuples onto the gold entry by
    ``eval_id`` (anchor, tuples) or by question text (RAGAS). Per-cell
    values are typed (``str`` / ``float`` / ``bool`` / ``int``) so openpyxl
    can render them without coercion.
    """
    g_row = gold_by_id.get(eval_id, {})
    a_row = a_by_id.get(eval_id, {})
    q_text = (g_row.get("query") or "").strip()
    r_row = ragas_by_q.get(q_text, {})
    t_row = tuples_by_id.get(eval_id) or tuples_by_q.get(q_text, {})

    sel = a_row.get("selected") or []
    cand = a_row.get("candidates") or []
    raw_answer = t_row.get("answer") or r_row.get("response", "") or ""
    answer = _extract_response(raw_answer)
    abstained, abst_reason = is_abstention(answer)

    unresolved = _is_unresolved(g_row)

    # ragas_nan: ALL_NAN if every metric is NaN (or missing), else empty.
    # Empty means "at least one metric is present (possibly NaN)".
    ragas_nan = (
        "ALL_NAN"
        if all(_is_nan(r_row.get(k)) for k in RAGAS_KEYS)
        else ""
    )

    return [
        a_row.get("recall", ""),
        a_row.get("complete_recall", ""),
        a_row.get("precision", ""),
        a_row.get("noise", ""),
        a_row.get("retrieval_recall", ""),
        a_row.get("passage_recall", ""),
        _fmt_keys(sel),
        _fmt_keys(cand),
        a_row.get("trace_found", ""),
        *[
            ("" if _is_nan(r_row.get(k)) else r_row.get(k))
            for k in RAGAS_KEYS
        ],
        ragas_nan,
        (answer or "")[:200],
        "yes" if abstained else "no",
        abst_reason,
        (g_row.get("language") or t_row.get("lang") or ""),
        ";".join(
            (c.get("match_status") or "?")
            for c in (g_row.get("expected_chunks") or [])
        ),
        len(g_row.get("expected_chunks") or []),
        unresolved,
        0 if unresolved else 1,
    ]


# ---------------------------------------------------------------------------
# Per-run aggregate (recomputed to honour n_evaluable exclusion)
# ---------------------------------------------------------------------------


def aggregate_run(run: RunSpec, gold_by_id: dict[str, dict[str, Any]]) -> Aggregate | None:
    """Recompute per-run aggregate from the anchor ``per_query`` block.

    The file's stored ``aggregate`` may be stale (e.g. a downstream script
    truncated ``selected[]`` for a what-if replay — the stored aggregate
    then no longer matches per_query). We always recompute so the
    operator's view is internally consistent.
    """
    if not run.anchor or not run.anchor.exists():
        return None
    a = json.loads(run.anchor.read_text(encoding="utf-8"))
    per_query = a.get("per_query", [])

    # Per-row n_evaluable filter (mirrors the live gate).
    evaluated: list[dict[str, Any]] = []
    for row in per_query:
        g_row = gold_by_id.get(row.get("id", ""), {})
        if _is_unresolved(g_row):
            continue
        evaluated.append(row)

    # n_abstained: count rows whose response matches an abstention pattern.
    n_abstained = 0
    if run.tuples and run.tuples.exists():
        t_by_id, _ = load_tuples(run.tuples)
        for row in per_query:
            tuple_row = t_by_id.get(row.get("id", ""), {})
            answer = _extract_response(tuple_row.get("answer", ""))
            if is_abstention(answer)[0]:
                n_abstained += 1

    n_unresolved = sum(
        1 for row in per_query if _is_unresolved(gold_by_id.get(row.get("id", ""), {}))
    )

    def _mean(field_name: str) -> float:
        vals = [r.get(field_name, 0) or 0 for r in evaluated]
        return statistics.fmean(vals) if vals else 0.0

    recall = _mean("recall")
    precision = _mean("precision")
    f1 = (
        statistics.fmean(
            [
                _safe_ratio(2 * (r.get("recall") or 0) * (r.get("precision") or 0),
                            (r.get("recall") or 0) + (r.get("precision") or 0))
                for r in evaluated
            ]
        )
        if evaluated
        else 0.0
    )

    # Per-metric RAGAS mean (skip NaN / missing).
    ragas_means: dict[str, float] = {}
    for k in RAGAS_KEYS:
        vals = [r[k] for r in run_ragas_rows(run) or [] if not _is_nan(r.get(k))]
        ragas_means[k] = statistics.fmean(vals) if vals else 0.0

    return Aggregate(
        n_evaluable=len(evaluated),
        n_abstained=n_abstained,
        n_unresolved=n_unresolved,
        recall=recall,
        precision=precision,
        f1=f1,
        complete_recall=_mean("complete_recall"),
        retrieval_recall=_mean("retrieval_recall"),
        passage_recall=_mean("passage_recall"),
        avg_selected=statistics.fmean([len(r.get("selected") or []) for r in evaluated])
        if evaluated
        else 0.0,
        ragas=ragas_means,
    )


def run_ragas_rows(run: RunSpec) -> list[dict[str, Any]] | None:
    """Return the RAGAS ``per_query`` rows for a run, or ``None`` if the
    file is missing. Used by ``aggregate_run`` to compute per-metric means
    while excluding NaN entries.
    """
    if not run.ragas or not run.ragas.exists():
        return None
    data = json.loads(run.ragas.read_text(encoding="utf-8"))
    return data.get("per_query", [])


# ---------------------------------------------------------------------------
# Compare tab
# ---------------------------------------------------------------------------


def build_compare_rows(runs: Sequence[RunSpec],
                       gold_by_id: dict[str, dict[str, Any]]) -> list[list[Any]]:
    """Build the rows of the Compare tab (header excluded). The first run
    is the baseline; ``delta_*`` columns report the signed difference vs
    baseline.
    """
    if not runs:
        return []
    aggregates = [aggregate_run(r, gold_by_id) for r in runs]
    base = aggregates[0]
    rows: list[list[Any]] = []
    for run, agg in zip(runs, aggregates):
        params_str = "; ".join(f"{k}={v}" for k, v in run.params.items()) if run.params else ""
        row: list[Any] = [run.label, params_str]
        if agg is None:
            row.extend([""] * (len(COMPARE_HEADERS) - 2))
        else:
            row.extend(agg.to_compare_row())
            # Deltas vs the first run (skip when either is None or 0).
            row.append(_delta(agg.recall, base.recall) if agg and base else "")
            row.append(_delta(agg.f1, base.f1) if agg and base else "")
        rows.append(row)
    return rows


def _delta(value: float, base: float) -> str:
    """Signed difference ``value - base`` formatted with 4 decimals and
    a leading sign. Empty string if either side is None (not a float).
    """
    if value is None or base is None:
        return ""
    return f"{value - base:+.4f}"


# ---------------------------------------------------------------------------
# Calibrate tab
# ---------------------------------------------------------------------------


def build_calibrate_rows(calibrate_path: Path | None,
                         limit: int = 50) -> list[list[Any]]:
    """Build the rows of the Calibrate tab (header excluded). Sorted by
    F1 descending. Tolerates both ``list`` and ``{all_combos: [...]}``
    shapes for the calibrate file (calibrate.py writes the latter).
    """
    if not calibrate_path or not calibrate_path.exists():
        return []
    data = json.loads(calibrate_path.read_text(encoding="utf-8"))
    if isinstance(data, list):
        rows = data
    else:
        rows = data.get("all_combos", [])
    rows_sorted = sorted(rows, key=lambda r: r.get("f1") or 0, reverse=True)
    out: list[list[Any]] = []
    for i, row in enumerate(rows_sorted[:limit], start=1):
        out.append([
            i,
            row.get("recall", ""),
            row.get("precision", ""),
            row.get("f1", ""),
            row.get("avg_selected", ""),
            row.get("empty_queries", ""),
            row.get("factor", ""),
            row.get("confusion", ""),
            row.get("threshold", ""),
            row.get("passage_recall", ""),
        ])
    return out


# ---------------------------------------------------------------------------
# Charts
# ---------------------------------------------------------------------------


def build_charts(worksheet: Worksheet,
                 runs: Sequence[RunSpec],
                 gold_by_id: dict[str, dict[str, Any]],
                 assets_dir: Path) -> None:
    """Render 4 matplotlib PNGs and embed them in the Charts tab.

    The PNGs are written to ``assets_dir`` (which the caller cleans up if
    desired) and embedded as ``openpyxl.drawing.image.Image`` objects,
    each anchored one section apart so they stack vertically in Excel.
    """
    import matplotlib
    matplotlib.use("Agg")  # noqa: E402
    import matplotlib.pyplot as plt

    assets_dir.mkdir(parents=True, exist_ok=True)
    labels = [r.label for r in runs]
    aggregates = [aggregate_run(r, gold_by_id) for r in runs]

    # 1) Anchor metrics bar/group.
    _chart_anchor_metrics(plt, labels, aggregates, assets_dir / "anchor_metrics.png")
    # 2) RAGAS metrics bar/group.
    _chart_ragas_metrics(plt, labels, aggregates, assets_dir / "ragas_metrics.png")
    # 3) Precision/recall scatter.
    _chart_precision_recall(plt, labels, aggregates, assets_dir / "precision_recall.png")
    # 4) Query status stacked bar.
    _chart_query_status(plt, labels, aggregates, assets_dir / "query_status.png")

    for offset, png in enumerate([
        "anchor_metrics.png",
        "ragas_metrics.png",
        "precision_recall.png",
        "query_status.png",
    ]):
        img = openpyxl.drawing.image.Image(str(assets_dir / png))
        img.width, img.height = 640, 360
        worksheet.add_image(img, f"A{1 + offset * 22}")


def _chart_anchor_metrics(plt, labels: list[str],
                          aggregates: list[Aggregate | None],
                          png_path: Path) -> None:
    metrics = ("recall", "precision", "f1", "complete_recall", "retrieval_recall")
    fig, ax = plt.subplots(figsize=(10, 5))
    width = 0.16
    for i, m in enumerate(metrics):
        vals = [getattr(agg, m, 0.0) if agg else 0.0 for agg in aggregates]
        ax.bar([j + i * width for j in range(len(labels))], vals, width, label=m)
    ax.set_xticks([i + width * 2 for i in range(len(labels))])
    ax.set_xticklabels(labels, rotation=20, ha="right")
    ax.set_title("Anchor metrics by run")
    ax.legend(loc="upper right", fontsize=8)
    fig.tight_layout()
    fig.savefig(png_path, dpi=120)
    plt.close(fig)


def _chart_ragas_metrics(plt, labels: list[str],
                         aggregates: list[Aggregate | None],
                         png_path: Path) -> None:
    nice = {
        "faithfulness": "ragas_f",
        "context_precision": "ragas_cp",
        "context_recall": "ragas_cr",
        "answer_relevancy": "ragas_ar",
    }
    fig, ax = plt.subplots(figsize=(10, 5))
    width = 0.18
    for i, (display, attr) in enumerate(nice.items()):
        vals = [agg.ragas.get(attr, 0.0) if agg else 0.0 for agg in aggregates]
        ax.bar([j + i * width for j in range(len(labels))], vals, width, label=display)
    ax.set_xticks([i + width * 1.5 for i in range(len(labels))])
    ax.set_xticklabels(labels, rotation=20, ha="right")
    ax.set_title("RAGAS metrics by run")
    ax.legend(loc="upper right", fontsize=8)
    fig.tight_layout()
    fig.savefig(png_path, dpi=120)
    plt.close(fig)


def _chart_precision_recall(plt, labels: list[str],
                            aggregates: list[Aggregate | None],
                            png_path: Path) -> None:
    fig, ax = plt.subplots(figsize=(7, 7))
    for label, agg in zip(labels, aggregates):
        if agg is None:
            continue
        ax.scatter(agg.recall, agg.precision, s=80, label=label)
    ax.set_xlabel("recall")
    ax.set_ylabel("precision")
    ax.set_title("Precision / Recall")
    ax.grid(True, alpha=0.3)
    ax.legend(loc="lower right", fontsize=8)
    fig.tight_layout()
    fig.savefig(png_path, dpi=120)
    plt.close(fig)


def _chart_query_status(plt, labels: list[str],
                        aggregates: list[Aggregate | None],
                        png_path: Path) -> None:
    fig, ax = plt.subplots(figsize=(10, 4))
    n_eval = [agg.n_evaluable if agg else 0 for agg in aggregates]
    n_abst = [agg.n_abstained if agg else 0 for agg in aggregates]
    n_unres = [agg.n_unresolved if agg else 0 for agg in aggregates]
    n_answered = [e - a for e, a in zip(n_eval, n_abst)]
    x = list(range(len(labels)))
    ax.bar(x, n_answered, label="answered")
    ax.bar(x, n_abst, bottom=n_answered, label="abstained")
    ax.bar(x, n_unres, bottom=n_eval, label="unresolved (excluded)", color="grey", alpha=0.5)
    ax.set_xticks(x)
    ax.set_xticklabels(labels, rotation=20, ha="right")
    ax.set_title("Queries per run by status")
    ax.legend(fontsize=8)
    fig.tight_layout()
    fig.savefig(png_path, dpi=120)
    plt.close(fig)


# ---------------------------------------------------------------------------
# Workbook builders
# ---------------------------------------------------------------------------


def _set_header(cell, doc: str | None) -> None:
    """Apply bold + grey fill to a header cell, and attach the column
    tooltip (Excel cell comment) if a doc string is provided.
    """
    cell.font = Font(bold=True)
    cell.fill = PatternFill("solid", fgColor=_HEADER_FILL_COLOR)
    if doc and cell.value in COLUMN_DOCS:
        cell.comment = Comment(COLUMN_DOCS[cell.value], "enrich_xlsx_v2")


def _set_widths(worksheet: Worksheet, header: Sequence[str], max_width: int = _MAX_COL_WIDTH) -> None:
    """Apply a reasonable column width based on header length."""
    for i, h in enumerate(header, start=1):
        col = get_column_letter(i)
        worksheet.column_dimensions[col].width = max(_DEFAULT_COL_WIDTH, min(max_width, len(str(h)) + 4))


def _set_data_autofilter(worksheet: Worksheet, first_row: int, last_row: int,
                         last_col: int) -> None:
    """Set native xlsx auto_filter on a rectangular data range.

    ``first_row`` is the first row of the filter rectangle (typically the
    header row); ``last_row`` is the last data row; ``last_col`` is the
    rightmost data column (1-based).
    """
    if last_row < first_row:
        return
    last_col_letter = get_column_letter(last_col)
    worksheet.auto_filter.ref = f"A{first_row}:{last_col_letter}{last_row}"


def build_gold_tab(worksheet: Worksheet, source_header: Sequence[Any],
                   source_body: Sequence[Sequence[Any]]) -> None:
    """Populate the Gold tab with the source xlsx contents untouched
    (8 columns, all rows including the 3 trailing None columns).
    """
    for row in (source_header, *source_body):
        worksheet.append(list(row))
    _set_widths(worksheet, source_header)
    worksheet.freeze_panes = "A2"


def build_run_tab(worksheet: Worksheet, run: RunSpec,
                  full_header: Sequence[Any],
                  src_body: Sequence[Sequence[Any]],
                  src_id_col: int,
                  gold_by_id: dict[str, dict[str, Any]],
                  a_by_id: dict[str, dict[str, Any]],
                  ragas_by_q: dict[str, dict[str, Any]],
                  tuples_by_id: dict[str, dict[str, Any]],
                  tuples_by_q: dict[str, dict[str, Any]]) -> None:
    """Populate a single ``Run_<label>`` tab.

    Layout:
      - Row 1: params (col A) + note (col D) — a single visible config block.
      - Row 2: table header (8 source cols + 22 enriched cols).
      - Rows 3..N: per-row data.
    """
    # Row 1: config block.
    params_str = json.dumps(run.params) if run.params else ""
    worksheet.cell(1, 1, "params").font = Font(bold=True)
    worksheet.cell(1, 2, params_str)
    worksheet.cell(1, 4, "note").font = Font(bold=True)
    worksheet.cell(1, 5, run.note)

    # Row 2: header.
    for ci, h in enumerate(full_header, start=1):
        cell = worksheet.cell(2, ci, h)
        _set_header(cell, COLUMN_DOCS.get(h) if h in NEW_COLS else None)

    # Rows 3+: data.
    row_idx = 3
    for src_row in src_body:
        eval_id = _eval_id_from_source_row(src_row, src_id_col)
        if not eval_id:
            continue
        enriched = build_run_row(eval_id, gold_by_id, a_by_id, ragas_by_q,
                                  tuples_by_id, tuples_by_q)
        for ci, val in enumerate(list(src_row) + enriched, start=1):
            worksheet.cell(row_idx, ci, val)
        row_idx += 1

    _set_widths(worksheet, full_header)
    worksheet.freeze_panes = "A3"
    _set_data_autofilter(worksheet, first_row=2, last_row=worksheet.max_row, last_col=len(full_header))


def build_compare_tab(worksheet: Worksheet, runs: Sequence[RunSpec],
                       gold_by_id: dict[str, dict[str, Any]]) -> None:
    """Populate the Compare tab (header + per-run rows)."""
    for ci, h in enumerate(COMPARE_HEADERS, start=1):
        cell = worksheet.cell(1, ci, h)
        _set_header(cell, None)
    for row in build_compare_rows(runs, gold_by_id):
        worksheet.append(row)
    _set_widths(worksheet, COMPARE_HEADERS, max_width=40)
    worksheet.freeze_panes = "A2"
    _set_data_autofilter(worksheet, first_row=1, last_row=worksheet.max_row, last_col=len(COMPARE_HEADERS))


def build_calibrate_tab(worksheet: Worksheet, calibrate_path: Path | None) -> None:
    """Populate the Calibrate tab (header + top-50 combos by F1)."""
    for ci, h in enumerate(CALIBRATE_HEADERS, start=1):
        cell = worksheet.cell(1, ci, h)
        _set_header(cell, None)
    for row in build_calibrate_rows(calibrate_path):
        worksheet.append(row)
    _set_widths(worksheet, CALIBRATE_HEADERS, max_width=20)
    worksheet.freeze_panes = "A2"
    _set_data_autofilter(worksheet, first_row=1, last_row=worksheet.max_row,
                         last_col=len(CALIBRATE_HEADERS))


def build_charts_tab(worksheet: Worksheet, runs: Sequence[RunSpec],
                     gold_by_id: dict[str, dict[str, Any]],
                     assets_dir: Path) -> None:
    """Populate the Charts tab (4 embedded matplotlib PNGs)."""
    build_charts(worksheet, runs, gold_by_id, assets_dir)


# ---------------------------------------------------------------------------
# Source xlsx loading
# ---------------------------------------------------------------------------


def _load_source_workbook(path: Path) -> tuple[list[Any], list[list[Any]]]:
    """Read the source xlsx (with ``data_only=True`` so ``=ROW()-1``
    formulas evaluate to their integer values). Return ``(header, body)``
    preserving trailing None columns (``iter_rows(values_only=True)``
    silently drops them, hence the explicit cell access).
    """
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb.active
    n_cols = ws.max_column
    header = [ws.cell(1, c).value for c in range(1, n_cols + 1)]
    body = [
        [ws.cell(r, c).value for c in range(1, n_cols + 1)]
        for r in range(2, ws.max_row + 1)
    ]
    return header, body


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------


def build_workbook(runs: Sequence[RunSpec],
                   source_xlsx: Path,
                   gold_path: Path,
                   calibrate_path: Path | None,
                   charts_assets_dir: Path) -> Workbook:
    """Build the output workbook in memory. Pure (no I/O except the file
    reads inside ``load_*``); useful for tests.
    """
    src_header, src_body = _load_source_workbook(source_xlsx)
    id_col = _find_id_col(src_header)
    full_header = list(src_header) + list(NEW_COLS)
    gold_by_id = load_gold(gold_path)

    wb = Workbook()
    wb.remove(wb.active)  # drop the default empty sheet

    # Gold tab — source untouched.
    wb.create_sheet("Gold")
    build_gold_tab(wb["Gold"], src_header, src_body)

    # One Run_ tab per run.
    for run in runs:
        ws = wb.create_sheet(f"Run_{run.label}")
        a_by_id = load_anchor(run.anchor) if run.anchor and run.anchor.exists() else {}
        ragas_by_q = load_ragas(run.ragas) if run.ragas and run.ragas.exists() else {}
        t_by_id, t_by_q = load_tuples(run.tuples) if run.tuples and run.tuples.exists() else ({}, {})
        build_run_tab(ws, run, full_header, src_body, id_col,
                      gold_by_id, a_by_id, ragas_by_q, t_by_id, t_by_q)

    # Compare tab.
    cmp_ws = wb.create_sheet("Compare")
    build_compare_tab(cmp_ws, runs, gold_by_id)

    # Calibrate tab (optional).
    cal_ws = wb.create_sheet("Calibrate")
    build_calibrate_tab(cal_ws, calibrate_path)

    # Charts tab (always present, 4 embedded PNGs).
    charts_ws = wb.create_sheet("Charts")
    build_charts_tab(charts_ws, runs, gold_by_id, charts_assets_dir)

    return wb


def _find_id_col(header: Sequence[Any]) -> int:
    """Return the index of the column whose header (case-insensitive,
    stripped) is ``"id"``. Defaults to 0 if not found.
    """
    for i, h in enumerate(header):
        if h and str(h).strip().lower() == "id":
            return i
    return 0


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------


def _parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """Parse CLI args. All paths must exist (validated after parsing)."""
    p = argparse.ArgumentParser(
        prog="enrich_xlsx_v2",
        description=(
            "Build a multi-config per-tab xlsx from N eval runs. See the "
            "module docstring for the per-tab layout and join semantics."
        ),
    )
    p.add_argument("--xlsx", type=Path, required=True, help="Source xlsx (gold rows 1..N with id=ROW()-1)")
    p.add_argument("--gold", type=Path, required=True, help="Matched gold JSON (entries keyed by 'new-N')")
    p.add_argument("--output", type=Path, required=True, help="Output xlsx path")
    p.add_argument("--runs-json", type=Path, required=True,
                   help="JSON list of run specs (label, anchor, ragas, tuples, params, note)")
    p.add_argument("--calibrate", type=Path, default=None,
                   help="Optional calibrate grid JSON (top-50 rows by F1)")
    p.add_argument("--charts-assets-dir", type=Path, default=None,
                   help="Where to write the matplotlib PNGs. Defaults to a "
                        "per-invocation tempdir (operator-cleaned). Pass an "
                        "explicit path to retain the assets across runs.")
    p.add_argument("--log-level", default="INFO",
                   choices=("DEBUG", "INFO", "WARNING", "ERROR"),
                   help="Python logging level (default: INFO)")
    return p.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """CLI entry point.

    Returns the process exit code:

    - 0 — workbook written successfully
    - 2 — usage error (missing input, malformed runs-json, duplicate
      run labels, run path that fails preflight)
    - 3 — unrecoverable build error (malformed JSON inside a run's
      anchor/ragas/tuples file, openpyxl structural error)

    The script wraps its body in a broad ``try/except Exception`` that
    maps any uncaught error to exit 3 with a logged traceback. argparse
    failures are NOT caught here — argparse itself exits 2 on bad
    flags, which matches the usage-error semantics, so a wrapper catch
    would only add complexity (it would have to differentiate
    ``SystemExit(2)`` from other SystemExits).
    """
    args = _parse_args(argv)
    logging.basicConfig(
        level=getattr(logging, args.log_level),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    # If the operator did not pin --charts-assets-dir, resolve to a
    # per-invocation tempdir. The script stays deployment-agnostic
    # (no hardcoded /tmp paths baked in) and never leaves orphans
    # across runs.
    if args.charts_assets_dir is None:
        import tempfile
        charts_dir = Path(tempfile.mkdtemp(prefix="enrich_xlsx_v2_charts_"))
    else:
        charts_dir = args.charts_assets_dir

    try:
        # ---------- 1. Required inputs exist ----------
        missing = [p for p in (args.xlsx, args.gold, args.runs_json) if not p.exists()]
        if missing:
            LOG.error("missing input(s): %s", ", ".join(str(p) for p in missing))
            return 2

        # ---------- 2. required inputs are non-empty + parseable ----------
        for p in (args.xlsx, args.gold, args.runs_json):
            if p.stat().st_size == 0:
                LOG.error("input file is empty: %s", p)
                return 2
        try:
            json.loads(args.runs_json.read_text(encoding="utf-8"))
        except (json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:
            LOG.error("runs-json is not valid JSON: %s", exc)
            return 2

        # ---------- 3. runs-json shape + dedup labels + sheet-name length ----------
        raw_runs = json.loads(args.runs_json.read_text(encoding="utf-8"))
        if not isinstance(raw_runs, list) or not raw_runs:
            LOG.error("--runs-json must be a non-empty list of run specs")
            return 2
        try:
            runs = [RunSpec.from_dict(r) for r in raw_runs]
        except (KeyError, TypeError) as exc:
            LOG.error("invalid run spec in --runs-json: %s", exc)
            return 2
        seen_labels: set[str] = set()
        for run in runs:
            if run.label in seen_labels:
                LOG.error("duplicate run label %r (each run produces one Run_<label> tab; labels must be unique)", run.label)
                return 2
            seen_labels.add(run.label)
            # openpyxl limit on sheet-title length is 31 chars; the tab name
            # is "Run_<label>" so the label itself must be <= 26 chars.
            if len(run.label) > _MAX_LABEL_LEN:
                LOG.error(
                    "run label %r is %d chars; Excel sheet titles are capped at 31 chars "
                    "and the prefix is 'Run_' (5 chars), so labels must be <= %d chars",
                    run.label, len(run.label), _MAX_LABEL_LEN,
                )
                return 2

        # ---------- 4. per-run path preflight (existence + non-empty) ----------
        for run in runs:
            for kind, path in (("anchor", run.anchor), ("ragas", run.ragas), ("tuples", run.tuples)):
                if path is None:
                    continue
                if not path.exists():
                    LOG.error("run %s: %s path does not exist: %s", run.label, kind, path)
                    return 2
                if path.stat().st_size == 0:
                    LOG.error("run %s: %s file is empty: %s", run.label, kind, path)
                    return 2

        # ---------- 5. optional calibrate ----------
        if args.calibrate is not None and not args.calibrate.exists():
            LOG.warning("calibrate file not found, Calibrate tab will be empty: %s", args.calibrate)

        # ---------- 6. build + write ----------
        wb = build_workbook(runs, args.xlsx, args.gold, args.calibrate, charts_dir)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        wb.save(args.output)
    except (KeyError, ValueError, json.JSONDecodeError) as exc:
        LOG.exception("build_workbook failed: %s", exc)
        return 3
    except FileNotFoundError as exc:
        LOG.error("a file disappeared between preflight and build: %s", exc)
        return 2
    except OSError as exc:
        LOG.error("I/O error during build: %s", exc)
        return 3
    except Exception as exc:  # last-resort — never let a stray exception crash as exit 1
        LOG.exception("unhandled exception: %s", exc)
        return 3

    LOG.info("wrote %s (tabs: %s)", args.output, wb.sheetnames)
    return 0


if __name__ == "__main__":
    sys.exit(main())
