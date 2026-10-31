# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""xlsx serialization for OKF benchmark suites and results (Story 8-6).

Emits and consumes the formats of tests/rag-benchmarks VERBATIM:

* SUITE xlsx  — the layout ``xlsx_to_gold.py`` reads (and the source shape
  ``enrich_xlsx_v2.py`` expects): sheet ``Test Dataset``, header row 1,
  POSITIONAL columns id|difficulty|query|answer|passages|source, ids as
  ints 1..N (his ``=ROW()-1`` evaluates to the same ints under
  ``data_only=True``), passages multi-valued on blank lines, an
  N/A-prefixed passages cell marking an out-of-scope entry.
* RESULTS xlsx — his v2 results vocabulary: tabs ``Gold`` + ``Run_<label>``
  (2-row preamble: config block, then the header) + ``Compare`` + an empty
  ``Calibrate``. The 22 ``NEW_COLS`` / 18 ``COMPARE_HEADERS`` / 10
  ``CALIBRATE_HEADERS`` names are copied verbatim from
  ``enrich_xlsx_v2.py``; anchor-derived cells are blank (the Lab has no
  anchor leg); metrics beyond the default four append extra
  ``ragas_<metric>`` columns AFTER his 22 — his tooling maps by name and
  ignores unknown columns. No Charts tab: charts are a mandatory Lab
  capability, not an export artifact (David 2026-10-17).

Only benchmark suites import (David 2026-10-17) — results flow one way.
"""

from __future__ import annotations

import io
import json
import re
from typing import Any

from openpyxl import Workbook, load_workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter

# --- his constants (enrich_xlsx_v2.py / xlsx_to_gold.py), verbatim -------

SUITE_SHEET = "Test Dataset"
SUITE_HEADERS = ["id", "difficulty", "query", "answer", "passages", "source"]

#: his 22 NEW_COLS in order (enrich_xlsx_v2.py:80-103)
NEW_COLS = [
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
]

#: the four default metrics, mapped to his NEW_COLS ragas_* columns
DEFAULT_METRICS = ("faithfulness", "context_precision", "context_recall", "answer_relevancy")

#: his 18 COMPARE_HEADERS in order (enrich_xlsx_v2.py:255-274)
COMPARE_HEADERS = [
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
]

#: his 10 CALIBRATE_HEADERS in order (enrich_xlsx_v2.py:278-289)
CALIBRATE_HEADERS = [
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
]

#: his out-of-scope marker (xlsx_to_gold.py:134) — anchored at cell start,
#: case-insensitive
_OOS_RE = re.compile(r"^(n/?a|out[-_ ]of[-_ ]scope|not\s+applicable)\b", re.IGNORECASE)

#: his passage separator (xlsx_to_gold.py:124-137) — a blank line
_PASSAGE_SEP_RE = re.compile(r"\n\s*\n")

#: a sentinel some of his sheets use instead of blank lines (xlsx_to_gold
#: help text) — accepted on IMPORT alongside the blank-line default
_PASSAGE_SENTINEL = "@@@@@"

_HEADER_FILL = PatternFill(start_color="E7E6E6", end_color="E7E6E6", fill_type="solid")
_HEADER_FONT = Font(bold=True)
_ANSWER_PREVIEW_CHARS = 200  # his answer_first_200 cap


def _cell(v: Any) -> Any:
    """None-safe scalar for openpyxl (it rejects None for value assignment semantics we want blank)."""
    if v is None:
        return ""
    return v


def _passages_text(entry: dict) -> str:
    """Render the passages cell: blank-line-separated previews, or his N/A marker for OOS entries."""
    if entry.get("oos"):
        return "N/A"
    parts = []
    for p in entry.get("reference_passages") or []:
        # Normalize internal blank lines to single newlines so HIS default
        # blank-line separator cannot split a passage he authored as one.
        # His matcher whitespace-collapses on compare, so no content is lost.
        parts.append(re.sub(r"\n\s*\n", "\n", str(p)).strip())
    return "\n\n".join(p for p in parts if p)


def suite_rows(entries: list[dict]) -> list[list[Any]]:
    """The suite body rows (positional layout, ids as ints 1..N)."""
    rows = []
    for i, e in enumerate(entries, start=1):
        rows.append(
            [
                i,  # int id — his =ROW()-1 evaluates to the same under data_only
                _cell(e.get("difficulty") or ""),
                _cell(e.get("query") or ""),
                _cell(e.get("reference_answer") or ""),
                _passages_text(e),
                _cell(e.get("source_doc") or ""),
            ]
        )
    return rows


def _style_header(ws, row: int, ncols: int) -> None:
    for c in range(1, ncols + 1):
        cell = ws.cell(row=row, column=c)
        cell.font = _HEADER_FONT
        cell.fill = _HEADER_FILL
        cell.alignment = Alignment(vertical="top")
    ws.freeze_panes = ws.cell(row=row + 1, column=1)
    ws.auto_filter.ref = f"A{row}:{get_column_letter(ncols)}{max(row + 1, ws.max_row)}"


def _deformula(cell) -> None:
    """Spreadsheet formula-injection guard (!622 round 21): openpyxl types a
    string that starts with '=' as a FORMULA (data_type 'f'), so a
    curator-authored query/reference starting '=' would execute when the
    exported workbook is opened in Excel/LibreOffice. Force the string type —
    the cell CONTENT is preserved byte-for-byte (an apostrophe prefix would
    corrupt his round-trip import)."""
    if cell.data_type == "f" and isinstance(cell.value, str):
        cell.data_type = "s"


def _append_text_safe(ws, row: list) -> None:
    """ws.append + the formula guard on the row just written."""
    ws.append(row)
    for c in range(1, ws.max_column + 1):
        _deformula(ws.cell(row=ws.max_row, column=c))


def write_suite_workbook(name: str, entries: list[dict]) -> bytes:
    """Serialize a benchmark suite to his INPUT xlsx format."""
    wb = Workbook()
    ws = wb.active
    ws.title = SUITE_SHEET
    ws.append(SUITE_HEADERS)
    for row in suite_rows(entries):
        _append_text_safe(ws, row)
    _style_header(ws, 1, len(SUITE_HEADERS))
    if name:
        ws.sheet_properties.tabColor = "1F6FEB"
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def _split_passages(raw: str) -> list[str]:
    """Split a passages cell his two supported ways: blank lines, or the sentinel."""
    if _PASSAGE_SENTINEL in raw:
        parts = raw.split(_PASSAGE_SENTINEL)
    else:
        parts = _PASSAGE_SEP_RE.split(raw)
    return [p.strip() for p in parts if p and p.strip()]


def read_suite_workbook(data: bytes) -> dict:
    """Parse a suite xlsx in his layout. Liberal on read: any sheet named
    ``Test Dataset`` wins, else the active sheet; ids may be ints (-> new-N)
    or arbitrary scalars (pass-through); blank rows and empty-query rows
    are skipped exactly like his Phase 1."""
    wb = load_workbook(io.BytesIO(data), data_only=True)
    ws = wb["Test Dataset"] if "Test Dataset" in wb.sheetnames else wb.active
    rows = list(ws.iter_rows(values_only=True))
    if not rows:
        return {"entries": [], "n_skipped_no_query": 0}
    entries: list[dict] = []
    skipped = 0
    for raw in rows[1:]:  # row 1 is ALWAYS the header in his format
        vals = list(raw) + [None] * 6
        rid, difficulty, query, answer, passages, source = vals[:6]
        if all(v is None or str(v).strip() == "" for v in raw):
            continue  # blank row — skipped silently (his :204-205)
        q = str(query).strip() if query is not None else ""
        if not q:
            skipped += 1
            continue  # no query — skipped and counted (his :207-209)
        ptext = str(passages).strip() if passages is not None else ""
        oos = bool(_OOS_RE.match(ptext))
        passages_list = [] if oos else _split_passages(ptext)
        eid = str(rid).strip() if rid is not None else ""
        if isinstance(rid, int) or (eid and eid.isdigit()):
            eid = f"new-{int(eid)}"  # his _eval_id_from_source_row join spine
        elif not eid:
            eid = f"new-{len(entries) + 1}"
        entries.append(
            {
                "id": eid,
                "query": q,
                "reference_answer": str(answer).strip() if answer is not None else "",
                "reference_passages": passages_list,
                "source_doc": str(source).strip() if source is not None else "",
                "difficulty": str(difficulty).strip() if difficulty is not None else "",
                "oos": oos,
            }
        )
    return {"entries": entries, "n_skipped_no_query": skipped}


# --- results workbook ------------------------------------------------------


def _metric_value(metrics: dict | None, key: str) -> float | str:
    v = (metrics or {}).get(key)
    if v is None:
        return ""
    try:
        f = float(v)
    except (TypeError, ValueError):
        return ""
    if f != f:  # NaN — his convention is the empty cell
        return ""
    return f


def _keys_cell(keys: list[str] | None) -> str:
    """His selected/candidate keys rendering: ';'-joined, 8 then ...(+N)."""
    ks = list(keys or [])
    if not ks:
        return ""
    if len(ks) <= 8:
        return ";".join(str(k) for k in ks)
    return ";".join(str(k) for k in ks[:8]) + f"...(+{len(ks) - 8})"


def _run_row(entry: dict, result: dict | None, extra_metrics: list[str]) -> list[Any]:
    res = result or {}
    metrics = res.get("metrics") or {}
    answer = str(res.get("answer") or "")
    row: list[Any] = [
        "",  # gold_recall      — anchor leg: not computed in the Lab
        "",  # gold_complete_recall
        "",  # gold_precision
        "",  # gold_noise
        "",  # gold_retrieval_recall
        "",  # gold_passage_recall
        _keys_cell(res.get("context_keys")),  # selected_keys
        _keys_cell(res.get("candidate_keys")),  # candidate_keys
        True,  # trace_found — the Lab replays retrieval directly; always traceable
        _metric_value(metrics, "faithfulness"),
        _metric_value(metrics, "context_precision"),
        _metric_value(metrics, "context_recall"),
        _metric_value(metrics, "answer_relevancy"),
        "ALL_NAN" if res.get("ragas_nan") else "",
        answer[:_ANSWER_PREVIEW_CHARS],
        "yes" if res.get("abstained") else "no",
        str(res.get("abstention_reason") or ""),
        str(entry.get("language") or res.get("language") or ""),
        "",  # gold_match_status_per_chunk — Phase-2 matcher is his toolchain's
        len(entry.get("reference_passages") or []),
        bool(entry.get("oos")),  # his is_unresolved covers OOS (zero chunks)
        0 if entry.get("oos") else 1,
    ]
    for m in extra_metrics:
        row.append(_metric_value(metrics, m))
    return row


def _mean(values: list[float]) -> float | str:
    # None- and NaN-skipped — his aggregate_run convention
    vals = [v for v in values if isinstance(v, (int, float)) and v == v]
    if not vals:
        return ""
    return sum(vals) / len(vals)


def _compare_row(label: str, run: dict, base_means: dict | None) -> list[Any]:
    s = run.get("summary") or {}
    row: list[Any] = [
        label,
        "; ".join(f"{k}={v}" for k, v in sorted((run.get("params") or {}).items())),
        s.get("n_evaluable", 0),
        s.get("n_abstained", 0),
        s.get("n_unresolved", 0),
        "",  # recall … avg_selected — anchor-derived
        "",
        "",
        "",
        "",
        "",
        "",
        _mean([r.get("metrics", {}).get("faithfulness") for r in run.get("results", []) if r.get("metrics")]),
        _mean([r.get("metrics", {}).get("context_precision") for r in run.get("results", []) if r.get("metrics")]),
        _mean([r.get("metrics", {}).get("context_recall") for r in run.get("results", []) if r.get("metrics")]),
        _mean([r.get("metrics", {}).get("answer_relevancy") for r in run.get("results", []) if r.get("metrics")]),
    ]
    if base_means is None:
        row += ["", ""]  # the baseline row carries no deltas
    else:
        row += ["", ""]  # recall/f1 deltas are anchor-derived — blank
    return row


def write_results_workbook(suite: dict, runs: list[dict]) -> bytes:
    """Serialize suite + runs to his v2 results vocabulary.

    ``runs``: [{label (<=26 chars, unique), params, note, entries: [{entry, result}], summary}]
    The first run is the baseline (his Compare semantics).
    """
    entries = suite.get("entries") or []
    all_metrics: set[str] = set(DEFAULT_METRICS)
    for run in runs:
        for rr in run.get("results", []) or []:
            all_metrics.update((rr.get("metrics") or {}).keys())
    extra = sorted(all_metrics - set(DEFAULT_METRICS))

    wb = Workbook()

    # Gold tab — the suite, verbatim in his input layout
    ws = wb.active
    ws.title = "Gold"
    ws.append(SUITE_HEADERS)
    for row in suite_rows(entries):
        _append_text_safe(ws, row)
    _style_header(ws, 1, len(SUITE_HEADERS))

    # Run_<label> tabs — 2-row preamble + data from row 3
    for run in runs:
        label = str(run.get("label") or "run")[:26]
        rs = wb.create_sheet(f"Run_{label}")
        rs.cell(row=1, column=1, value="params").font = _HEADER_FONT
        _deformula(rs.cell(row=1, column=2, value=json.dumps(run.get("params") or {}, ensure_ascii=False)))
        rs.cell(row=1, column=4, value="note").font = _HEADER_FONT
        _deformula(rs.cell(row=1, column=5, value=str(run.get("note") or "")))
        header = SUITE_HEADERS + NEW_COLS + [f"ragas_{m}" for m in extra]
        rs.append([])  # row 1 already written via cells; append moves to row 2
        for c, h in enumerate(header, start=1):
            rs.cell(row=2, column=c, value=h)
        _style_header(rs, 2, len(header))
        results_by_id = {r.get("id"): r for r in run.get("results", []) if r.get("id")}
        for i, entry in enumerate(entries):
            res = results_by_id.get(entry.get("id"))
            body = [
                i + 1,
                _cell(entry.get("difficulty") or ""),
                _cell(entry.get("query") or ""),
                _cell(entry.get("reference_answer") or ""),
                _passages_text(entry),
                _cell(entry.get("source_doc") or ""),
            ]
            for c, v in enumerate(body + _run_row(entry, res, extra), start=1):
                _deformula(rs.cell(row=3 + i, column=c, value=v))

    # Compare tab — one row per run, first is baseline
    cs = wb.create_sheet("Compare")
    cs.append(COMPARE_HEADERS)
    for idx, run in enumerate(runs):
        cs.append(_compare_row(str(run.get("label") or f"run{idx + 1}")[:26], run, None if idx == 0 else {}))
    _style_header(cs, 1, len(COMPARE_HEADERS))

    # Calibrate tab — structural parity, empty (no calibration data in the Lab)
    cal = wb.create_sheet("Calibrate")
    cal.append(CALIBRATE_HEADERS)
    _style_header(cal, 1, len(CALIBRATE_HEADERS))

    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()
