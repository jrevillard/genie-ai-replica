#!/usr/bin/env python3
"""Prepare Adem's benchmark xlsx for xlsx_to_gold.py (N.4 Phase 1, DEC-36a).

Deterministic transform — the ORIGINAL file is never modified; this writes
maize_test_dataset.prepared.xlsx next to itself. Fixes (see spec-n4):
  1. inserts an ID column (q-001…) — the source has none, and the converter's
     --col-id would otherwise use the question text as the entry id;
  2. splits passage cells on ANY newline run (blank-line AND single — the
     source quotes each passage individually, e.g. `"p1"\n"p2"`, and jams
     passages together with single newlines) and strips wrapping quote
     chars from each part's ends independently — balanced or not, straight
     or smart (xlsx_to_gold does not strip, and a leading quote in a preview
     would fail Phase 2 content-hash matching). Internal quotes and
     trailing `[source]` annotations are left for the matcher's 40-char
     window fallback by design;
  3. renames sheet Лист1 → "Test Dataset" and drops blank padding rows.

Layout out: ID | Test question | Benchmark response | Passages | Document.
Run xlsx_to_gold.py with --col-id 1 --col-query 2 --col-answer 3
--col-passages 4 --col-source 5 --col-difficulty 6 (out of range → None).
"""
import re
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
SOURCE = HERE / "maize_test_dataset.xlsx"
OUT = HERE / "maize_test_dataset.prepared.xlsx"
WRAPPERS = '"“”‘’'


def clean_passages_cell(cell: str) -> str:
    parts = []
    for part in re.split(r"\n+", cell.strip()):
        p = part.strip()
        while p and p[0] in WRAPPERS:
            p = p[1:].strip()
        while p and p[-1] in WRAPPERS:
            p = p[:-1].strip()
        if p:
            parts.append(p)
    return "\n\n".join(parts)


def main() -> int:
    if not SOURCE.is_file():
        raise SystemExit(f"ERROR: source xlsx not found: {SOURCE}")
    src = openpyxl.load_workbook(SOURCE, data_only=True)["Лист1"]
    out = openpyxl.Workbook()
    ws = out.active
    ws.title = "Test Dataset"
    ws.append(["ID", "Test question", "Benchmark response",
               "Relevant Text Passage(s) (Verbatim)", "Document (Exact title) & Page Number(s)"])
    n = 0
    for row in src.iter_rows(min_row=2, values_only=True):
        if not row or all(c is None or str(c).strip() == "" for c in row):
            continue
        question, answer, passages, doc = (row + (None, None, None, None))[:4]
        n += 1
        ws.append([f"q-{n:03d}", question, answer, clean_passages_cell(str(passages or "")), doc])
    out.save(OUT)
    print(f"Wrote {n} rows to {OUT.name} (sheet 'Test Dataset')")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
