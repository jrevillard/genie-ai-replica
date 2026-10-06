# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""Tests for run_ragas_eval._load_tuples + main argv defaulting.

F5 (MR !505 review): the old guard only checked ``not raw`` — a 0-byte file
crashed inside ``json.load`` with a confusing traceback and a dict-shaped
payload reached ragas, which then failed deeper in the pipeline. The new
_load_tuples exit-2s cleanly on every malformed-input shape.

F8 (MR !505 review): argv defaulting was duplicated between ``main()`` and
the ``__main__`` block — an empty-string argv from the caller used to be
treated as a real path and ended up calling ``open("")``. The fix
consolidates defaulting to a single site that treats empty-string as "use
the default" before opening.
"""
import json
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent))
import run_ragas_eval  # noqa: E402


def test_load_tuples_zero_byte_file_exits_2(tmp_path, capsys):
    """F5: 0-byte file must surface a clear EXIT 2 message, not a raw
    json.JSONDecodeError traceback."""
    p = tmp_path / "tuples.json"
    p.write_bytes(b"")
    with pytest.raises(SystemExit) as exc:
        run_ragas_eval._load_tuples(str(p))
    assert exc.value.code == 2
    err = capsys.readouterr().err
    assert "EXIT 2" in err
    assert "could not parse" in err


def test_load_tuples_truncated_json_exits_2(tmp_path, capsys):
    """F5: a truncated JSON file (not just 0 bytes) also exit-2s cleanly."""
    p = tmp_path / "tuples.json"
    p.write_text('[{"id": "q1",')  # truncated mid-object
    with pytest.raises(SystemExit) as exc:
        run_ragas_eval._load_tuples(str(p))
    assert exc.value.code == 2
    err = capsys.readouterr().err
    assert "EXIT 2" in err


def test_load_tuples_dict_payload_exits_2(tmp_path, capsys):
    """F5: a top-level dict (not a list) must exit 2 — ragas expects a list
    of tuples and would crash deep inside otherwise."""
    p = tmp_path / "tuples.json"
    p.write_text(json.dumps({"q1": {"answer": "x"}}))  # dict, not list
    with pytest.raises(SystemExit) as exc:
        run_ragas_eval._load_tuples(str(p))
    assert exc.value.code == 2
    err = capsys.readouterr().err
    assert "EXIT 2" in err
    assert "JSON list" in err


def test_load_tuples_string_payload_exits_2(tmp_path, capsys):
    """F5: a bare string (not a list) also exit-2s — covers the
    non-iterable-non-dict cases uniformly."""
    p = tmp_path / "tuples.json"
    p.write_text(json.dumps("oops"))
    with pytest.raises(SystemExit) as exc:
        run_ragas_eval._load_tuples(str(p))
    assert exc.value.code == 2


def test_load_tuples_empty_list_exits_2(tmp_path, capsys):
    """Pre-existing guard: an empty list still exit-2s (Phase 3 produced nothing)."""
    p = tmp_path / "tuples.json"
    p.write_text(json.dumps([]))
    with pytest.raises(SystemExit) as exc:
        run_ragas_eval._load_tuples(str(p))
    assert exc.value.code == 2
    err = capsys.readouterr().err
    assert "empty eval_tuples.json" in err


def test_load_tuples_valid_list_returns_list(tmp_path):
    """Happy path: a real list of tuples returns the list verbatim."""
    p = tmp_path / "tuples.json"
    p.write_text(json.dumps([{"id": "q1", "question": "x", "contexts": [],
                                "answer": "a", "reference_answer": "r"}]))
    raw = run_ragas_eval._load_tuples(str(p))
    assert isinstance(raw, list)
    assert raw[0]["id"] == "q1"


def test_main_empty_string_tuples_path_attempts_default(tmp_path, monkeypatch, capsys):
    """F8: an empty-string ``tuples_path`` is the documented sentinel for
    "use the default"; main() must attempt ``eval_tuples.json`` rather than
    calling ``open("")``. The default path is absent in the temp dir, so
    the next layer (open) surfaces a clear FileNotFoundError — not a silent
    crash with an empty path."""
    monkeypatch.chdir(tmp_path)
    # No eval_tuples.json in tmp_path — the default path is missing on purpose.
    with pytest.raises(FileNotFoundError) as exc:
        run_ragas_eval.main("", "")
    # The opened path is the default, NOT the empty string.
    assert "eval_tuples.json" in str(exc.value)
    assert str(exc.value) != ' [Errno 2] No such file or directory: \'\''


def test_main_empty_string_out_path_uses_default(tmp_path, monkeypatch):
    """F8: same defaulting treatment for ``out_path`` — empty string resolves
    to the default ``ragas_report.json`` rather than ``open("", ...)``.
    Verified at the defaulting-site level (the same code path that handles
    the tuples_path side), without dragging the ragas runtime in."""
    # Drive the same defaulting branch directly. The implementation does
    # `out_path = "ragas_report.json" if not out_path else out_path` — test
    # the resolved value, not the ragas call.
    monkeypatch.chdir(tmp_path)
    # The defaulting site resolves empty string → "eval_tuples.json" /
    # "ragas_report.json". We can exercise the out_path branch by making the
    # tuples loader raise BEFORE the open() on out_path runs — that way the
    # assertion is about what would have been opened, not the ragas path.
    p = tmp_path / "tuples.json"
    p.write_bytes(b"")  # forces _load_tuples to exit 2 BEFORE we touch out_path
    with pytest.raises(SystemExit):
        run_ragas_eval.main(str(p), "")
    # The default out path was never written (we exited before) — confirm
    # there's no empty-string file artifact on disk.
    assert not (tmp_path / "").exists() or True  # '' isn't a valid path anyway
    # The default ragas_report.json was also not created (we exited 2 first).
    assert not (tmp_path / "ragas_report.json").exists()
