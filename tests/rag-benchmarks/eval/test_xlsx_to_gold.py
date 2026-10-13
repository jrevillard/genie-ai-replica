# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for xlsx_to_gold.py.

F4 (MR !505 review): ``source_xlsx`` MUST be the basename, not the absolute
path — committed artifacts leak the operator's local directory layout. The
test stubs openpyxl so it runs in CI environments where openpyxl is not
installed (the on-disk dependency is only required for the real xlsx flow).
"""
import json
import sys
import types
from pathlib import Path

import pytest

# Stub openpyxl in sys.modules BEFORE importing xlsx_to_gold so the module-
# level `import openpyxl` succeeds in environments where the real openpyxl
# is not installed (CI tests do not require the xlsx dependency).
class _FakeCell:
    def __init__(self, value):
        self.value = value


class _FakeWorksheet:
    def __init__(self, rows):
        self._rows = rows

    def iter_rows(self, min_row=None, values_only=False):
        for r in self._rows[1:]:
            yield tuple(_FakeCell(c) for c in r)


class _FakeWorkbook:
    def __init__(self, rows):
        self._rows = rows

    def __getitem__(self, name):
        return _FakeWorksheet(self._rows)

    @property
    def sheetnames(self):
        return ["Sheet1"]


_fake_openpyxl = types.ModuleType("openpyxl")
_fake_openpyxl.load_workbook = lambda *a, **kw: None
sys.modules.setdefault("openpyxl", _fake_openpyxl)

sys.path.insert(0, str(Path(__file__).resolve().parent))
import xlsx_to_gold  # noqa: E402


def test_source_xlsx_is_basename_not_absolute_path(tmp_path, monkeypatch):
    """F4: the emitted gold dataset's ``source_xlsx`` field must be the file
    basename — committing the absolute path leaks the operator's local
    directory layout (e.g. ``/home/jerome/Téléchargements/...``)."""
    rows = [
        ("id", "diff", "query", "answer", "passages", "source"),
        ("q1", "easy", "What is foo?", "Foo is bar.", "First passage text.", "doc.pdf"),
    ]
    fake_wb = _FakeWorkbook(rows)
    # Patch the load_workbook used by xlsx_to_gold at the module's binding.
    monkeypatch.setattr(xlsx_to_gold.openpyxl, "load_workbook", lambda *a, **kw: fake_wb)

    # Place the xlsx in a nested directory so the basename differs from the
    # resolved path (the regression the F4 ruling caught).
    nested = tmp_path / "Téléchargements" / "private" / "input.xlsx"
    nested.parent.mkdir(parents=True)
    nested.write_bytes(b"")  # contents ignored — openpyxl is stubbed

    out = tmp_path / "out.json"
    monkeypatch.setattr(
        sys, "argv",
        [
            "xlsx_to_gold.py",
            "--input-xlsx", str(nested),
            "--sheet-name", "Sheet1",
            "--output-json", str(out),
        ],
    )
    rc = xlsx_to_gold.main()
    assert rc == 0
    payload = json.loads(out.read_text())
    assert payload["source_xlsx"] == "input.xlsx"
    # Defensive: no path separator, no leading slash — must be a pure basename
    assert "/" not in payload["source_xlsx"]
    assert "\\" not in payload["source_xlsx"]
