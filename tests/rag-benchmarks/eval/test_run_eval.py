# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for run_eval.py's content-hash scoring path.

score_anchor is the crux of the content-based identity change: the span emits
ArangoDB ``_key``s, but the gold matches on ``content_hash``. These tests lock
the ``_key -> content_hash`` projection so a regression there cannot silently
produce a false zero (or mixed-namespace) baseline.
"""

import json
import time
import types

import run_eval


def _entry(content_hash="abc123", chunk_key="key1"):
    return {
        "id": "q1",
        "query": "What is the question?",
        "expected_chunks": [{"chunk_key": chunk_key, "content_hash": content_hash}],
    }


def test_score_anchor_projects_keys_to_content_hashes():
    entry = _entry("abc123")
    key_to_hash = {"key1": "abc123", "key2": "def456", "key3": "ghi789"}
    row = run_eval.score_anchor(
        entry,
        cand_keys=["key1", "key2"],
        sel_keys=["key1", "key3"],
        trace_found=True,
        key_to_hash=key_to_hash,
    )
    # raw _keys stay in the report (calibrator + CLAUDE.md schema read these)
    assert row["gold"] == ["key1"]
    assert row["selected"] == ["key1", "key3"]
    assert row["candidates"] == ["key1", "key2"]
    # scoring uses the content-hash projections — never a mixed namespace
    assert row["gold_hashes"] == ["abc123"]
    assert row["selected_hashes"] == ["abc123", "ghi789"]
    assert row["candidate_hashes"] == ["abc123", "def456"]
    assert row["recall"] == 1.0
    assert row["precision"] == 0.5  # 1 of 2 selected is gold
    assert row["retrieval_recall"] == 1.0


def test_score_anchor_drops_unmapped_keys():
    entry = _entry("abc123")
    key_to_hash = {"key1": "abc123"}
    row = run_eval.score_anchor(
        entry,
        cand_keys=["key1", "unmapped1"],
        sel_keys=["unmapped1"],
        trace_found=True,
        key_to_hash=key_to_hash,
    )
    # unmapped span keys are dropped from the hash projection (never scored)
    assert row["selected"] == ["unmapped1"]  # raw key preserved for the report
    assert row["selected_hashes"] == []
    assert row["recall"] == 0.0
    assert row["precision"] == 0.0
    # key1 still maps to a gold candidate → retrieval_recall is computable
    assert row["retrieval_recall"] == 1.0


def test_score_anchor_empty_map_produces_no_scoring_signal():
    entry = _entry("abc123")
    row = run_eval.score_anchor(
        entry,
        cand_keys=["key1"],
        sel_keys=["key1"],
        trace_found=True,
        key_to_hash={},  # empty map = wrong GRAPH_SOURCE → every key unmapped
    )
    assert row["selected_hashes"] == []
    assert row["candidate_hashes"] == []
    assert row["recall"] == 0.0
    assert "retrieval_recall" not in row  # no hash-projected candidates at all


def test_drive_query_returns_http_status(monkeypatch):
    monkeypatch.setattr(run_eval, "_docker_exec", lambda c, cmd, timeout=120: '{"text":"ok"}\n200')
    start, body, status = run_eval.drive_query({"query": "q"})
    assert status == 200 and body == '{"text":"ok"}'


def test_drive_query_401_detected(monkeypatch):
    monkeypatch.setattr(run_eval, "_docker_exec", lambda c, cmd, timeout=120: '{"error":"invalid_token"}\n401')
    _, _, status = run_eval.drive_query({"query": "q"})
    assert status == 401


def _clear_eval_env(monkeypatch):
    """Stabilize exit-contract tests by removing env knobs they exercise."""
    monkeypatch.delenv("EVAL_ALLOW_PARTIAL", raising=False)
    monkeypatch.delenv("EVAL_ALLOW_UNMAPPED", raising=False)
    monkeypatch.delenv("EVAL_MAX_MISSED_TRACES", raising=False)


def test_exit_contract_zero_rows(tmp_path, monkeypatch):
    import json as _json
    _clear_eval_env(monkeypatch)
    gold = tmp_path / "g.json"; gold.write_text(_json.dumps({"entries": []}))
    # empty key maps, no queries: anchor mode with zero scored rows
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", dict)
    rc = run_eval.main("anchor", str(gold), str(tmp_path / "out.json"))
    assert rc == 4  # zero scored rows


def test_exit_contract_dump_tuples_partial_skipped(tmp_path, monkeypatch):
    import json as _json
    _clear_eval_env(monkeypatch)
    gold = tmp_path / "g.json"
    gold.write_text(_json.dumps({"entries": [
        {"id": "q1", "query": "Q1?", "expected_chunks": []},
        {"id": "q2", "query": "Q2?", "expected_chunks": []},
    ]}))
    monkeypatch.setattr(run_eval, "build_hash_to_text", dict)
    monkeypatch.setattr(run_eval, "fetch_selection", lambda _s: ([], [], []))
    # q1: 200 OK; q2: 401 (A2 shape: skipped in dump-tuples, not counted as miss)
    def _fake_drive(entry):
        if entry["id"] == "q1":
            return 0.0, '{"text":"ok"}', 200
        return 0.0, '{"error":"invalid_token"}', 401
    monkeypatch.setattr(run_eval, "drive_query", _fake_drive)
    out = tmp_path / "out.json"
    rc = run_eval.main("dump-tuples", str(gold), str(out))
    assert rc == 3  # partial — 1 of 2 entries skipped, EVAL_ALLOW_PARTIAL unset
    meta = _json.loads((tmp_path / "out.json.meta.json").read_text())
    assert meta["n_entries"] == 2
    assert meta["n_tuples"] == 1
    assert meta["n_http_errors"] == 1
    assert meta["skipped"] == ["q2"]


def test_exit_contract_anchor_5xx_appends_error_row_and_returns_3(tmp_path, monkeypatch):
    """Finding 1: anchor-mode 5xx must append an error row, increment http_errors,
    add to skipped_entries, and the report must reflect them so a partial run
    exits 3 (not 0 with silent gap)."""
    import json as _json
    _clear_eval_env(monkeypatch)
    gold = tmp_path / "g.json"
    gold.write_text(_json.dumps({"entries": [
        {"id": "q1", "query": "Q1?", "expected_chunks": []},
        {"id": "q2", "query": "Q2?", "expected_chunks": []},
        {"id": "q3", "query": "Q3?", "expected_chunks": []},
    ]}))
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", dict)
    # q2 returns 502; q1 and q3 return 200 but no trace found → 2 misses
    def _fake_drive(entry):
        if entry["id"] == "q2":
            return 0.0, "", 502
        return 0.0, '{"text":"ok"}', 200
    monkeypatch.setattr(run_eval, "drive_query", _fake_drive)
    monkeypatch.setattr(run_eval, "fetch_selection", lambda _s: ([], [], []))
    out = tmp_path / "out.json"
    rc = run_eval.main("anchor", str(gold), str(out))
    assert rc == 3  # skipped_entries non-empty + EVAL_ALLOW_PARTIAL unset
    report = _json.loads(out.read_text())
    assert report["n_http_errors"] == 1
    assert "skipped_entries" in report
    assert "q2" in report["skipped_entries"]
    error_rows = [r for r in report["per_query"] if r.get("id") == "q2"]
    assert len(error_rows) == 1
    assert error_rows[0]["trace_found"] is False
    assert "502" in error_rows[0]["error"]


def test_exit_contract_dump_tuples_all_missed_traces_returns_3(tmp_path, monkeypatch):
    """Finding 2: dump-tuples branch must return 3 when missed > max_missed
    (same threshold knob as anchor). All-empty fetch_selection across 2 entries
    with EVAL_MAX_MISSED_TRACES=1 → missed=2 > 1 → rc 3, meta carries it."""
    import json as _json
    _clear_eval_env(monkeypatch)
    monkeypatch.setenv("EVAL_MAX_MISSED_TRACES", "1")
    gold = tmp_path / "g.json"
    gold.write_text(_json.dumps({"entries": [
        {"id": "q1", "query": "Q1?", "expected_chunks": []},
        {"id": "q2", "query": "Q2?", "expected_chunks": []},
    ]}))
    monkeypatch.setattr(run_eval, "build_hash_to_text", dict)
    monkeypatch.setattr(run_eval, "drive_query", lambda e: (0.0, '{"text":"ok"}', 200))
    monkeypatch.setattr(run_eval, "fetch_selection", lambda _s: ([], [], []))
    out = tmp_path / "out.json"
    rc = run_eval.main("dump-tuples", str(gold), str(out))
    assert rc == 3
    meta = _json.loads((tmp_path / "out.json.meta.json").read_text())
    assert meta["n_missed_traces"] == 2


def test_exit_contract_4xx_skipped_fetch_not_called(tmp_path, monkeypatch):
    """Finding 5: any non-2xx status must skip the entry and skip the expensive
    VT poll. 400 → skipped_entries grows, fetch_selection NOT called for it."""
    import json as _json
    _clear_eval_env(monkeypatch)
    gold = tmp_path / "g.json"
    gold.write_text(_json.dumps({"entries": [
        {"id": "q1", "query": "Q1?", "expected_chunks": []},
        {"id": "q2", "query": "Q2?", "expected_chunks": []},
    ]}))
    monkeypatch.setattr(run_eval, "build_hash_to_text", dict)
    fetch_calls = []
    def _fake_drive(entry):
        if entry["id"] == "q1":
            return 0.0, "", 400
        return 0.0, '{"text":"ok"}', 200
    monkeypatch.setattr(run_eval, "drive_query", _fake_drive)
    def _fetch(start):
        fetch_calls.append(start)
        return ([], [], [])
    monkeypatch.setattr(run_eval, "fetch_selection", _fetch)
    out = tmp_path / "out.json"
    rc = run_eval.main("dump-tuples", str(gold), str(out))
    assert len(fetch_calls) == 1  # only q2 reached fetch
    meta = _json.loads((tmp_path / "out.json.meta.json").read_text())
    assert "q1" in meta["skipped"]
    assert meta["n_http_errors"] == 1


def test_fetch_selection_respects_deadline_overshoot(monkeypatch):
    """Finding 11: time.sleep must be clamped to remaining budget; once deadline
    passes, return immediately without further VT calls."""
    import run_eval as _re
    sleeps = []
    # Tiny budget so the second iteration crosses the deadline
    monkeypatch.setattr(_re, "TRACE_FETCH_TIMEOUT", 0.05)
    monkeypatch.setattr(_re, "TRACE_FLUSH_WAIT", 999.0)
    monkeypatch.setattr(_re, "_docker_exec",
                        lambda c, cmd, timeout=60: json.dumps({"data": []}))
    # Module-local time namespace so both sleep() and time() are patchable
    t0 = [1000.0]
    def fake_now():
        t0[0] += 0.04  # advance ~80ms across 2 iterations
        return t0[0]
    monkeypatch.setattr(_re, "time", types.SimpleNamespace(
        sleep=lambda s: sleeps.append(s),
        time=fake_now,
    ))
    cands, sels, _ = _re.fetch_selection(0.0)
    assert cands == [] and sels == []
    # No sleep may exceed the budget; we never sleep past remaining.
    for s in sleeps:
        assert s <= 0.05 + 1e-9
def test_fetch_selection_immediate_first_poll(monkeypatch):
    sleeps = []
    # _as_list expects JSON ARRAY strings (VictoriaTraces format)
    # json.dumps("key_a") = "key_a" (valid JSON string) NOT an array
    # json.dumps(["key_a"]) = "["key_a"]" (JSON array string) — CORRECT
    ts = int(time.time() * 1e6) + 100_000_000
    r2_data = {
        "data": [{
            "spans": [{
                "operationName": "x.reranker_selection",
                "startTime": ts,
                "tags": [
                    {"key": "rag.candidate_chunk_keys",
                     "value": json.dumps(["key_a"])},
                    {"key": "rag.selected_chunk_keys",
                     "value": json.dumps(["key_a"])},
                ]
            }]
        }]
    }
    responses = [
        json.dumps({"data": []}),
        json.dumps(r2_data),
    ]
    def my_docker(c, cmd, timeout=60):
        return responses.pop(0)
    # Patch via module-local namespace so run_eval.time.time() still works
    # (finding 10) — only sleep is recorded, time keeps advancing normally.
    monkeypatch.setattr(run_eval, "time", types.SimpleNamespace(
        sleep=lambda s: sleeps.append(s),
        time=time.time,
    ))
    monkeypatch.setattr(run_eval, "_docker_exec", my_docker)
    monkeypatch.setattr(run_eval, "TRACE_FETCH_TIMEOUT", 30)
    cands, sels, _ = run_eval.fetch_selection(time.time())
    assert cands == ["key_a"]
    assert sleeps == [1.0]  # immediate check, then 1s backoff before 2nd check

