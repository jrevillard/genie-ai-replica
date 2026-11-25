# Copyright (C) 2026 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""The eval text-field default (#2153).

The retrieval contract reads the ``text`` column (hardcoded in the retriever
so ingest and read paths cannot drift); ``metadata.chunk_text`` keeps the
verbatim chunk for display only. The gold identities are content hashes of
the SERVED field — hashing the display-only default produced a silent
all-zero anchor on a contextualized corpus (recall 0.0 / noise 1.0 with
n_missed_traces=0), so the default must name the served column and the
fallback probe must point the other way.
"""

import importlib
import sys
from pathlib import Path

import pytest

# The modules under test live in eval/ (the same insert drivers.py carries).
sys.path.insert(0, str(Path(__file__).resolve().parent / "eval"))


@pytest.fixture
def no_text_field_env(monkeypatch):
    monkeypatch.delenv("ARANGO_TEXT_FIELD", raising=False)


def test_run_eval_default_text_field_is_the_served_column(no_text_field_env):
    import run_eval

    module = importlib.reload(run_eval)
    assert module.TEXT_FIELD == "text"


def test_dump_chunks_default_text_field_is_the_served_column(no_text_field_env):
    import dump_chunks

    module = importlib.reload(dump_chunks)
    assert module.TEXT_FIELD == "text"


def test_dump_chunks_fallback_retries_the_other_field(no_text_field_env, monkeypatch, capsys, tmp_path):
    """All-null rows under the served-column projection fall back to the
    display column (a corpus that predates the contextualized-write
    contract), with the warning naming the override."""
    import dump_chunks

    module = importlib.reload(dump_chunks)
    calls = []

    def fake_cursor(aql, bind_vars=None, **_):
        calls.append(aql)
        if "doc.chunk_text" in aql:
            return [{"key": "k1", "text": "raw chunk", "labels": []}]
        return [{"key": "k1", "text": None, "labels": []}]

    monkeypatch.setattr(module, "cursor", fake_cursor)
    rows_by_call = []
    original = module._query_rows

    def spy(text_field):
        rows = original(text_field)
        rows_by_call.append(rows)
        return rows

    monkeypatch.setattr(module, "_query_rows", spy)
    module.main(out_path=str(tmp_path / "dump-probe.json"))
    assert len(calls) == 2
    assert "doc.text" in calls[0] and "doc.chunk_text" in calls[1]
    assert rows_by_call[1][0]["text"] == "raw chunk"
    assert "ARANGO_TEXT_FIELD" in capsys.readouterr().err
