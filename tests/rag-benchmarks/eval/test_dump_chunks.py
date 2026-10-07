# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for dump_chunks row-level fallback + null-row warning.

F1 (MR !505 review): the old `if not rows` guard never fired because the AQL
always returns one row per document. A missing field surfaced as ``text: null``
in every row, collapsing every content_hash to the empty-string fingerprint
and silently zeroing the gold set. The fix detects the symptom per-row.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import dump_chunks  # noqa: E402


class _FakeCursor:
    def __init__(self, payloads):
        # Dump_chunks calls cursor() at most twice (primary + optional retry).
        self._payloads = list(payloads)
        self.calls = 0

    def __call__(self, aql: str) -> list[dict]:
        self.calls += 1
        return self._payloads.pop(0)


def test_row_level_fallback_fires_when_all_texts_null(capsys, tmp_path, monkeypatch):
    """F1: when the primary field returns rows with all-null text, dump_chunks
    MUST retry with the legacy field, emit the WARNING, and produce non-empty
    content_hashes. The old collection-level guard never fired because the
    AQL always returns one row per document."""
    primary_rows = [
        {"key": "k1", "text": None, "labels": []},
        {"key": "k2", "text": None, "labels": []},
    ]
    fallback_rows = [
        {"key": "k1", "text": "alpha", "labels": []},
        {"key": "k2", "text": "beta", "labels": []},
    ]
    fake = _FakeCursor([primary_rows, fallback_rows])
    monkeypatch.setattr(dump_chunks, "cursor", fake)
    # Pin the primary field to something other than the legacy one so the
    # fallback path is eligible to run.
    monkeypatch.setattr(dump_chunks, "TEXT_FIELD", "chunk_text")
    out = tmp_path / "reg.json"
    rc = dump_chunks.main(str(out))
    assert rc is None  # main() returns None on success
    assert fake.calls == 2, "fallback should have fired exactly once"
    err = capsys.readouterr().err
    assert "WARNING" in err
    assert "chunk_text" in err
    # The registry now carries real hashes from the legacy field
    reg = json.loads(out.read_text())
    assert len(reg) == 2
    hashes = {r["content_hash"] for r in reg}
    assert len(hashes) == 2  # two distinct texts → two distinct hashes
    assert "" not in hashes


def test_no_fallback_when_texts_are_present(capsys, tmp_path, monkeypatch):
    """When the primary field already returns non-null text, no fallback."""
    primary_rows = [
        {"key": "k1", "text": "real text one", "labels": []},
        {"key": "k2", "text": "real text two", "labels": []},
    ]
    fake = _FakeCursor([primary_rows])
    monkeypatch.setattr(dump_chunks, "cursor", fake)
    monkeypatch.setattr(dump_chunks, "TEXT_FIELD", "chunk_text")
    out = tmp_path / "reg.json"
    dump_chunks.main(str(out))
    assert fake.calls == 1, "fallback must NOT fire when text is present"
    err = capsys.readouterr().err
    # The retry-warning is absent
    assert "retrying with legacy field" not in err


def test_partial_null_text_warns_with_count(capsys, tmp_path, monkeypatch):
    """When SOME rows have null text (and others do not), emit the partial-null
    warning so the operator knows the registry has empty-string hashes in it."""
    rows = [
        {"key": "k1", "text": "real", "labels": []},
        {"key": "k2", "text": None, "labels": []},
        {"key": "k3", "text": "", "labels": []},
    ]
    fake = _FakeCursor([rows])
    monkeypatch.setattr(dump_chunks, "cursor", fake)
    monkeypatch.setattr(dump_chunks, "TEXT_FIELD", "chunk_text")
    out = tmp_path / "reg.json"
    dump_chunks.main(str(out))
    assert fake.calls == 1  # no fallback — some rows have text
    err = capsys.readouterr().err
    assert "2/3 rows have null/empty text" in err
    reg = json.loads(out.read_text())
    # k2 and k3 share the empty-string fingerprint
    assert reg[0]["content_hash"] != reg[1]["content_hash"]  # k1 vs k2
    assert reg[1]["content_hash"] == reg[2]["content_hash"]  # k2 == k3
