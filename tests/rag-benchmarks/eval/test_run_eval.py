# Copyright (C) 2025 International Telecommunication Union (ITU)
# SPDX-License-Identifier: Apache-2.0
"""Unit tests for run_eval.py's content-hash scoring path.

score_anchor is the crux of the content-based identity change: the span emits
ArangoDB ``_key``s, but the gold matches on ``content_hash``. These tests lock
the ``_key -> content_hash`` projection so a regression there cannot silently
produce a false zero (or mixed-namespace) baseline.
"""

import json
import os
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
    monkeypatch.setattr(run_eval, "_docker_exec", lambda c, cmd, timeout=120, pass_env=(): '{"text":"ok"}\n200')
    start, body, status = run_eval.drive_query({"query": "q"})
    assert status == 200 and body == '{"text":"ok"}'


def test_drive_query_401_detected(monkeypatch):
    monkeypatch.setattr(run_eval, "_docker_exec", lambda c, cmd, timeout=120, pass_env=(): '{"error":"invalid_token"}\n401')
    _, _, status = run_eval.drive_query({"query": "q"})
    assert status == 401


def test_docker_exec_pass_env_forwards_flag(monkeypatch):
    """G1 fix: pass_env inserts `-e VAR` pairs before the container name so the
    token travels via docker exec -e (valueless = inherit from python process
    env) — never on argv. Visible in `ps`/procfs from this test's recorded argv.
    """
    captured = {}
    def fake_run(argv, **kwargs):
        captured["argv"] = argv
        return type("R", (), {"returncode": 0, "stdout": "ok", "stderr": ""})()
    monkeypatch.setattr(run_eval.subprocess, "run", fake_run)
    run_eval._docker_exec("c", "echo hi", pass_env=("FOO",))
    assert captured["argv"] == ["docker", "exec", "-e", "FOO", "c", "sh", "-c", "echo hi"]


def test_drive_query_token_not_in_argv(monkeypatch):
    """G1 fix: bearer token MUST NOT appear on the docker argv or in the sh -c
    payload. The token is forwarded via docker exec -e E2E_BEARER_TOKEN
    (valueless flag = inherit from the python process env), and the curl
    header references it as $E2E_BEARER_TOKEN — expanded container-side only.
    """
    captured = []
    def fake_docker_exec(c, cmd, timeout=120, pass_env=()):
        captured.append({"container": c, "cmd": cmd, "pass_env": tuple(pass_env)})
        return '{"text":"x"}\n200'
    monkeypatch.setattr(run_eval, "_docker_exec", fake_docker_exec)
    monkeypatch.setenv("E2E_BEARER_TOKEN", "SECRETTOKEN")
    start, body, status = run_eval.drive_query({"query": "q"})
    assert status == 200
    assert len(captured) == 1
    rec = captured[0]
    # Token forwarded via docker exec -e, not argv
    assert "E2E_BEARER_TOKEN" in rec["pass_env"]
    # Token value never appears on argv
    argv_str = " ".join([rec["container"], repr(rec["pass_env"])])
    assert "SECRETTOKEN" not in argv_str
    # Token value never appears in the sh -c payload (only the var NAME does)
    assert "SECRETTOKEN" not in rec["cmd"]
    assert "$E2E_BEARER_TOKEN" in rec["cmd"]  # shell-expands container-side


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


# --- MR-B: per-entry containment, retry, atomic incremental writes, resume ---

def _write_gold(tmp_path, entries):
    import json as _json
    p = tmp_path / "g.json"
    p.write_text(_json.dumps({"entries": entries}))
    return p


def test_write_out_atomic_no_tmp_leftover(tmp_path):
    """_write_out must write via tmp+os.replace; on success no .tmp file remains."""
    import json as _json
    out = tmp_path / "out.json"
    run_eval._write_out(str(out), {"per_query": [], "aggregate": {}}, "anchor")
    assert out.exists()
    # No stray .tmp on success
    assert not (tmp_path / "out.json.tmp").exists()
    # File is valid JSON with expected payload
    rep = _json.loads(out.read_text())
    assert rep == {"per_query": [], "aggregate": {}}


def test_entry_error_contained_and_reported(tmp_path, monkeypatch):
    """Entry raising RuntimeError exhausts retries → error row appended, rc==3,
    no id in .done.jsonl for the failed id."""
    import json as _json
    _clear_eval_env(monkeypatch)
    gold = _write_gold(tmp_path, [
        {"id": "q1", "query": "a"},
        {"id": "q2", "query": "b"},
    ])
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", dict)
    monkeypatch.setattr(run_eval, "fetch_selection", lambda s: (["k"], ["k"], []))

    def flaky(entry):
        if entry["id"] == "q2":
            raise RuntimeError("docker exec failed: boom")
        return 0.0, '{"text":"x"}', 200
    monkeypatch.setattr(run_eval, "drive_query", flaky)
    monkeypatch.setattr(run_eval.time, "sleep", lambda s: None)
    rc = run_eval.main("anchor", str(gold), str(tmp_path / "o.json"))
    rep = _json.loads((tmp_path / "o.json").read_text())
    # error row present for q2
    err = [r for r in rep["per_query"] if r["id"] == "q2"]
    assert len(err) == 1
    assert err[0].get("trace_found") is False
    assert "boom" in err[0].get("error", "")
    assert rc == 3  # skipped_entries non-empty → rc 3
    # .done.jsonl must NOT contain the failed id (retry exhausted)
    done_ids = (tmp_path / "o.json.done.jsonl").read_text().splitlines()
    assert "q1" in done_ids
    assert "q2" not in done_ids


def test_resume_skips_already_done_entries(tmp_path, monkeypatch):
    """Pre-written out.json + .done.jsonl with q1 done → only q2 is driven."""
    import json as _json
    _clear_eval_env(monkeypatch)
    gold = _write_gold(tmp_path, [
        {"id": "q1", "query": "a"},
        {"id": "q2", "query": "b"},
    ])
    out = tmp_path / "o.json"
    # Pre-write report: q1 done, q2 not present
    pre_rows = [{
        "id": "q1", "query": "a", "trace_found": True,
        "selected": [], "candidates": [], "gold": [],
        "gold_hashes": [], "selected_hashes": [], "candidate_hashes": [],
        "expected_chunks": [], "adaptive_breakdown": [],
        "recall": 1.0, "precision": 1.0, "complete_recall": 1.0, "noise": 0.0,
        "retrieval_recall": 1.0, "passage_recall": 1.0,
        "n_passages": 1, "passages_retrieved": 1,
    }]
    out.write_text(_json.dumps({
        "per_query": pre_rows, "aggregate": {"n": 1},
        "n_missed_traces": 0, "n_unmapped_chunk_keys": 0,
        "n_http_errors": 0, "skipped_entries": [],
    }))
    (tmp_path / "o.json.done.jsonl").write_text("q1\n")

    drive_calls = []
    def fake_drive(entry):
        drive_calls.append(entry["query"])
        return 0.0, '{"text":"x"}', 200
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", dict)
    monkeypatch.setattr(run_eval, "drive_query", fake_drive)
    monkeypatch.setattr(run_eval, "fetch_selection", lambda s: ([], [], []))
    monkeypatch.setattr(run_eval.time, "sleep", lambda s: None)
    rc = run_eval.main("anchor", str(gold), str(out))
    # Only q2 was driven
    assert drive_calls == ["b"]
    assert rc == 0
    rep = _json.loads(out.read_text())
    ids = [r["id"] for r in rep["per_query"]]
    assert "q1" in ids and "q2" in ids
    # .done.jsonl now has both ids
    done_ids = (tmp_path / "o.json.done.jsonl").read_text().splitlines()
    assert "q1" in done_ids and "q2" in done_ids


# --- MR-B: in-run bearer token refresh via keycloak.fetch_realm_token ---

def _set_kc_env(monkeypatch):
    """Enable the EVAL_KC_* env set so _maybe_refresh_token() refreshes."""
    monkeypatch.setenv("EVAL_KC_URL", "https://kc.test/auth")
    monkeypatch.setenv("EVAL_KC_REALM", "genie")
    monkeypatch.setenv("EVAL_KC_CLIENT_ID", "genie-app")
    monkeypatch.setenv("EVAL_KC_USER", "genie-admin")
    monkeypatch.setenv("EVAL_KC_PASSWORD", "secret")
    # Default static token must start defined so the first refresh call can
    # overwrite it; production callers also set this explicitly.
    monkeypatch.setenv("E2E_BEARER_TOKEN", "stale-static")


def test_maybe_refresh_token_ttl(monkeypatch):
    """TTL boundary: refresh fires only past the 180s mark. Verification
    forces elapsed > 180 via the module-local time.time, ensuring the
    > 180 check (not >=) is the gate."""
    import run_eval as _re
    _set_kc_env(monkeypatch)

    # Module-local time namespace: time.time() is callable but returns a
    # monotonically advancing fake clock; _maybe_refresh_token reads it.
    clock = {"t": 1000.0}
    monkeypatch.setattr(_re, "time", types.SimpleNamespace(
        sleep=lambda s: None,
        time=lambda: clock["t"],
    ))

    calls = []
    def fake_fetch(kc_url, realm, client_id, username, password, timeout=30.0):
        calls.append((kc_url, realm, client_id, username, password, timeout))
        return f"tok{len(calls)}"
    # Monkeypatch fetch_realm_in in run_eval's namespace (NOT keycloak's)
    monkeypatch.setattr(_re, "fetch_realm_token", fake_fetch)

    # Just under the boundary — elapsed = 179s, must NOT refresh
    _re._token_ts = clock["t"] - 179.0
    _re._maybe_refresh_token()
    assert calls == []
    assert os.environ["E2E_BEARER_TOKEN"] == "stale-static"

    # Just over the boundary — elapsed = 181s, must refresh
    clock["t"] += 0  # baseline stays
    _re._token_ts = clock["t"] - 181.0
    _re._maybe_refresh_token()
    assert len(calls) == 1
    assert os.environ["E2E_BEARER_TOKEN"] == "tok1"
    # _token_ts moved to current fake clock
    assert _re._token_ts == clock["t"]

    # Call again immediately — elapsed ~0, must NOT refresh
    _re._maybe_refresh_token()
    assert len(calls) == 1


def test_401_triggers_refresh_and_retry(tmp_path, monkeypatch):
    """First drive_query 401 → refresh → re-drive 200 → entry scored."""
    import json as _json
    _clear_eval_env(monkeypatch)
    _set_kc_env(monkeypatch)
    gold = _write_gold(tmp_path, [
        {"id": "q1", "query": "a", "expected_chunks": [
            {"chunk_key": "k1", "content_hash": "h1"}
        ]},
    ])
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", lambda: {"k1": "h1"})
    monkeypatch.setattr(run_eval, "fetch_selection", lambda s: (["k1"], ["k1"], []))

    fetch_calls = []
    def fake_fetch(kc_url, realm, client_id, username, password, timeout=30.0):
        fetch_calls.append(1)
        return "fresh-tok"
    monkeypatch.setattr(run_eval, "fetch_realm_token", fake_fetch)

    drive_calls = []
    def fake_drive(entry):
        drive_calls.append((entry["id"], os.environ.get("E2E_BEARER_TOKEN")))
        # First call (with stale token) → 401; second call (after refresh) → 200
        if len(drive_calls) == 1:
            return 0.0, '{"error":"invalid_token"}', 401
        return 0.0, '{"text":"ok"}', 200
    monkeypatch.setattr(run_eval, "drive_query", fake_drive)
    monkeypatch.setattr(run_eval.time, "sleep", lambda s: None)

    rc = run_eval.main("anchor", str(gold), str(tmp_path / "o.json"))
    rep = _json.loads((tmp_path / "o.json").read_text())
    rows = [r for r in rep["per_query"] if r["id"] == "q1"]
    assert len(rows) == 1
    assert rows[0]["trace_found"] is True
    assert rows[0].get("error") is None  # NOT an error row
    # Two drive_query calls (initial 401 + refresh retry 200)
    assert len(drive_calls) == 2
    assert drive_calls[0][1] == "stale-static"  # pre-refresh token
    assert drive_calls[1][1] == "fresh-tok"     # post-refresh token
    # fetch_realm_token called exactly once (on the 401 reaction)
    assert len(fetch_calls) == 1
    assert os.environ["E2E_BEARER_TOKEN"] == "fresh-tok"
    assert rc == 0


def test_401_retry_still_fails(tmp_path, monkeypatch):
    """Both drive_query calls 401 → AUTH-FAILURE skip path: anchor error row."""
    import json as _json
    _clear_eval_env(monkeypatch)
    _set_kc_env(monkeypatch)
    gold = _write_gold(tmp_path, [
        {"id": "q1", "query": "a"},
    ])
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", dict)
    fetch_calls = []
    def fake_fetch(kc_url, realm, client_id, username, password, timeout=30.0):
        fetch_calls.append(1)
        return "fresh-tok"
    monkeypatch.setattr(run_eval, "fetch_realm_token", fake_fetch)
    def fake_drive(entry):
        return 0.0, '{"error":"invalid_token"}', 401
    monkeypatch.setattr(run_eval, "drive_query", fake_drive)
    monkeypatch.setattr(run_eval.time, "sleep", lambda s: None)
    out = tmp_path / "o.json"
    rc = run_eval.main("anchor", str(gold), str(out))
    rep = _json.loads(out.read_text())
    err_rows = [r for r in rep["per_query"] if r["id"] == "q1"]
    assert len(err_rows) == 1
    assert err_rows[0]["trace_found"] is False
    assert "401" in err_rows[0]["error"]
    # Refresh fired exactly once (only the FIRST 401 reaction refreshes; the
    # second 401 has nothing left to retry, so it falls through to AUTH-FAILURE)
    assert len(fetch_calls) == 1
    assert rc == 3  # skipped_entries non-empty + EVAL_ALLOW_PARTIAL unset


def test_static_token_path_untouched(tmp_path, monkeypatch):
    """Without EVAL_KC_* env, _maybe_refresh_token() is a no-op and a 401
    follows MR-A's behavior: single drive_query call, AUTH-FAILURE row, rc 3."""
    import json as _json
    _clear_eval_env(monkeypatch)
    # IMPORTANT: no EVAL_KC_* env → refresh path disabled
    monkeypatch.setenv("E2E_BEARER_TOKEN", "static-only")
    gold = _write_gold(tmp_path, [
        {"id": "q1", "query": "a"},
    ])
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", dict)
    fetch_calls = []
    def fake_fetch(*a, **kw):
        fetch_calls.append(1)
        return "should-not-be-called"
    monkeypatch.setattr(run_eval, "fetch_realm_token", fake_fetch)
    drive_calls = []
    def fake_drive(entry):
        drive_calls.append(entry["id"])
        return 0.0, '{"error":"invalid_token"}', 401
    monkeypatch.setattr(run_eval, "drive_query", fake_drive)
    out = tmp_path / "o.json"
    rc = run_eval.main("anchor", str(gold), str(out))
    rep = _json.loads(out.read_text())
    err_rows = [r for r in rep["per_query"] if r["id"] == "q1"]
    assert err_rows[0]["trace_found"] is False
    assert "401" in err_rows[0]["error"]
    # Static path: exactly one drive_query call (NO retry, NO refresh)
    assert drive_calls == ["q1"]
    assert fetch_calls == []
    assert rc == 3


def test_retry_succeeds_on_third_attempt(tmp_path, monkeypatch):
    """Entry fails twice (RuntimeError) then succeeds → completes normally, no
    error row, q1 in .done.jsonl, rc==0."""
    import json as _json
    _clear_eval_env(monkeypatch)
    gold = _write_gold(tmp_path, [
        {"id": "q1", "query": "a", "expected_chunks": [
            {"chunk_key": "k1", "content_hash": "h1"}
        ]},
    ])
    monkeypatch.setattr(run_eval, "build_key_to_content_hash",
                        lambda: {"k1": "h1"})
    monkeypatch.setattr(run_eval, "fetch_selection", lambda s: (["k1"], ["k1"], []))
    attempts = {"n": 0}
    def flaky(entry):
        attempts["n"] += 1
        if attempts["n"] < 3:
            raise RuntimeError(f"transient #{attempts['n']}")
        return 0.0, '{"text":"x"}', 200
    monkeypatch.setattr(run_eval, "drive_query", flaky)
    monkeypatch.setattr(run_eval.time, "sleep", lambda s: None)
    rc = run_eval.main("anchor", str(gold), str(tmp_path / "o.json"))
    rep = _json.loads((tmp_path / "o.json").read_text())
    err = [r for r in rep["per_query"] if r.get("error")]
    assert err == []
    assert attempts["n"] == 3  # 2 failed attempts + 1 success
    assert rc == 0  # successful scoring, no skip
    done_ids = (tmp_path / "o.json.done.jsonl").read_text().splitlines()
    assert "q1" in done_ids


# --- N1 (re-review): derive missed/skipped from rows; dedup invariant ------

def test_resume_retry_success_clears_degradation(tmp_path, monkeypatch):
    """N1: out.json prefilled with an HTTP-error row for q1, no sidecar →
    on resume the loop re-drives q1. Retry succeeds ⇒ ONE row, no error
    field, rc 0 (was: duplicate row + stale skipped_entries forcing rc 3).

    Bug: ``_load_done`` keeps error rows in ``rows`` for seeding, but
    excludes them from ``done``. With an empty sidecar the loop re-drives
    those ids. The retry's success row was APPENDED alongside the existing
    error row (duplicate) and ``skipped_entries`` retained q1 (no decrement
    path) → exit 3 despite a fully-scored report. Fix: dedup before append
    + derive ``skipped_entries`` from rows.
    """
    import json as _json
    _clear_eval_env(monkeypatch)
    gold = _write_gold(tmp_path, [
        {"id": "q1", "query": "Q1?", "expected_chunks": [
            {"chunk_key": "k1", "content_hash": "h1"}
        ]},
    ])
    out = tmp_path / "o.json"
    # Prefilled: q1 with a 500 error row; sidecar empty (the bug condition).
    error_row = {
        "id": "q1", "query": "Q1?", "trace_found": False, "error": "HTTP 500",
        "selected": [], "candidates": [],
        "gold": [], "gold_hashes": [], "selected_hashes": [], "candidate_hashes": [],
        "expected_chunks": [], "adaptive_breakdown": [],
    }
    out.write_text(_json.dumps({
        "per_query": [error_row], "aggregate": {"n": 0},
        "n_missed_traces": 1, "n_unmapped_chunk_keys": 0,
        "n_http_errors": 1, "skipped_entries": ["q1"],
    }))
    # NO sidecar — done doesn't contain q1 → re-drive
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", lambda: {"k1": "h1"})
    monkeypatch.setattr(run_eval, "drive_query", lambda e: (0.0, '{"text":"ok"}', 200))
    monkeypatch.setattr(run_eval, "fetch_selection", lambda s: (["k1"], ["k1"], []))

    rc = run_eval.main("anchor", str(gold), str(out))
    rep = _json.loads(out.read_text())
    # Exactly ONE row for q1 (dedup invariant; no duplicate)
    q1_rows = [r for r in rep["per_query"] if r["id"] == "q1"]
    assert len(q1_rows) == 1, f"expected 1 row for q1, got {len(q1_rows)}"
    # The surviving row is the success row — NOT the prefilled error row
    assert q1_rows[0].get("error") is None
    assert q1_rows[0]["trace_found"] is True
    assert q1_rows[0]["recall"] == 1.0
    # Derived metrics: 0 missed (no trace_found=False rows remain), 1 scored
    assert rep["n_missed_traces"] == 0
    # http_errors stays as an event counter (informational). The 1 seeded
    # from the prefilled row persists; the retry was a 200, not a new HTTP
    # error, so no +1. Reporting the historical event count is intentional.
    assert rep["n_http_errors"] == 1
    assert rep["aggregate"]["n"] == 1
    # No error rows → skipped_entries is empty → rc 0 (the bug was rc 3 here)
    assert rep["skipped_entries"] == []
    assert rc == 0


def test_resume_retry_fails_again_single_row(tmp_path, monkeypatch):
    """N1: out.json prefilled with an HTTP-error row for q1, no sidecar →
    on resume the loop re-drives q1. Retry fails again ⇒ ONE row (replaces
    the old error row via dedup), rc 3."""
    import json as _json
    _clear_eval_env(monkeypatch)
    gold = _write_gold(tmp_path, [
        {"id": "q1", "query": "Q1?"},
    ])
    out = tmp_path / "o.json"
    out.write_text(_json.dumps({
        "per_query": [{
            "id": "q1", "query": "Q1?", "trace_found": False, "error": "HTTP 500",
            "selected": [], "candidates": [],
            "gold": [], "gold_hashes": [], "selected_hashes": [], "candidate_hashes": [],
            "expected_chunks": [], "adaptive_breakdown": [],
        }],
        "aggregate": {"n": 0},
        "n_missed_traces": 1, "n_unmapped_chunk_keys": 0,
        "n_http_errors": 1, "skipped_entries": ["q1"],
    }))
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", dict)
    # Retry fails again with the same status
    monkeypatch.setattr(run_eval, "drive_query", lambda e: (0.0, "", 500))

    rc = run_eval.main("anchor", str(gold), str(out))
    rep = _json.loads(out.read_text())
    # Exactly ONE error row for q1 (the old one is deduped before append)
    err_rows = [r for r in rep["per_query"] if r["id"] == "q1"]
    assert len(err_rows) == 1, f"expected 1 row for q1, got {len(err_rows)}"
    assert err_rows[0]["trace_found"] is False
    assert "500" in err_rows[0]["error"]
    # Derived metrics: 1 missed (one trace_found=False row)
    assert rep["n_missed_traces"] == 1
    # http_errors is an event counter: 1 seeded from the prefilled row + 1
    # new event from this run's retry-failure = 2. (The dedup invariant does
    # NOT change the counter — the new HTTP event genuinely happened.)
    assert rep["n_http_errors"] == 2
    # skipped_entries derived from rows.error → ["q1"]
    assert rep["skipped_entries"] == ["q1"]
    assert rc == 3


# --- !503 review wave (W3 resume accounting) -------------------------------

def test_w3_resume_seeds_missed_and_http_errors(tmp_path, monkeypatch):
    """W3: resume from a prefilled out.json with trace-miss rows (no error) + all
    ids in sidecar → n_missed_traces reflects the prior count (was being reset
    to 0), n_http_errors stays 0 (rows had no `error` key).

    N1 refactor: ``missed`` is DERIVED from ``rows`` (no longer seeded); the
    5 trace-miss rows produce missed=5, which exceeds the default max (2)
    and exits 3 from the missed-skip check. ``skipped_entries`` is now
    derived as sorted({r["id"] for r in rows if r.get("error")}) — trace-miss
    rows have no ``error`` field, so skipped_entries is []. The exit fires
    from the missed check (moved ahead of the agg["n"]==0 check in N1)."""
    import json as _json
    _clear_eval_env(monkeypatch)
    gold = _write_gold(tmp_path, [
        {"id": f"q{i}", "query": f"Q{i}?"} for i in range(5)
    ])
    out = tmp_path / "o.json"
    rows = [{
        "id": f"q{i}", "query": f"Q{i}?", "trace_found": False,
        "selected": [], "candidates": [],
        "gold": [], "gold_hashes": [], "selected_hashes": [], "candidate_hashes": [],
        "expected_chunks": [], "adaptive_breakdown": [],
    } for i in range(5)]
    out.write_text(_json.dumps({
        "per_query": rows, "aggregate": {"n": 0},
        "n_missed_traces": 5, "n_unmapped_chunk_keys": 0,
        "n_http_errors": 0, "skipped_entries": [],
    }))
    (tmp_path / "o.json.done.jsonl").write_text(
        "\n".join(f"q{i}" for i in range(5)) + "\n"
    )
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", dict)

    rc = run_eval.main("anchor", str(gold), str(out))
    rep = _json.loads(out.read_text())
    # W3: n_missed_traces derived from rows (5 trace-miss rows → 5)
    assert rep["n_missed_traces"] == 5
    # No rows have an HTTP error → n_http_errors stays 0
    assert rep["n_http_errors"] == 0
    # N1: trace-miss rows have no `error` → skipped_entries is empty; rc 3
    # fires from the missed-threshold check (5 > EVAL_MAX_MISSED_TRACES=2)
    assert rep["skipped_entries"] == []
    assert rc == 3


def test_w3_resume_seeds_http_errors(tmp_path, monkeypatch):
    """W3: prefilled error rows starting with 'HTTP ' → n_http_errors reflects them."""
    import json as _json
    _clear_eval_env(monkeypatch)
    gold = _write_gold(tmp_path, [
        {"id": "q1", "query": "a"},
        {"id": "q2", "query": "b"},
    ])
    out = tmp_path / "o.json"
    rows = [
        {"id": "q1", "query": "a", "trace_found": False, "error": "HTTP 401"},
        {"id": "q2", "query": "b", "trace_found": False, "error": "HTTP 502"},
    ]
    out.write_text(_json.dumps({
        "per_query": rows, "aggregate": {"n": 0},
        "n_missed_traces": 2, "n_unmapped_chunk_keys": 0,
        "n_http_errors": 2, "skipped_entries": ["q1", "q2"],
    }))
    (tmp_path / "o.json.done.jsonl").write_text("q1\nq2\n")
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", dict)

    rc = run_eval.main("anchor", str(gold), str(out))
    rep = _json.loads(out.read_text())
    assert rep["n_http_errors"] == 2
    # Both prefilled ids already done → no new drives; the loader now keeps
    # error rows in `rows` (for accounting) but excludes them from `done` so
    # they would retry if not for the sidecar union — which DOES list them
    # here. Seeded skipped_entries non-empty → EVAL_ALLOW_PARTIAL unset → rc 3.
    assert rc == 3


# --- !503 review wave (W4 sidecar order) -----------------------------------

def test_w4_out_written_before_sidecar(tmp_path, monkeypatch):
    """W4: on a successful entry, _write_out_post runs BEFORE sidecar_fh.write.
    Regression: sidecar-first left a kill-window where a sidecar flush without
    a matching out row would silently skip the entry on resume."""
    import json as _json
    _clear_eval_env(monkeypatch)
    gold = _write_gold(tmp_path, [{"id": "q1", "query": "a", "expected_chunks": []}])
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", dict)
    monkeypatch.setattr(run_eval, "drive_query", lambda e: (0.0, '{"text":"x"}', 200))
    monkeypatch.setattr(run_eval, "fetch_selection", lambda s: (["k"], ["k"], []))

    events: list[str] = []
    orig_wop = run_eval._write_out_post
    def spy_wop(*a, **kw):
        events.append("out_post")
        return orig_wop(*a, **kw)
    monkeypatch.setattr(run_eval, "_write_out_post", spy_wop)

    # Spy on sidecar writes via built-in.open (the sidecar is opened in main()).
    real_open = open
    def spy_open(path, *a, **kw):
        fh = real_open(path, *a, **kw)
        if isinstance(path, str) and path.endswith(".done.jsonl"):
            orig_write = fh.write
            def sw(s: str):
                events.append("sidecar_write")
                return orig_write(s)
            fh.write = sw
        return fh
    monkeypatch.setattr("builtins.open", spy_open)

    run_eval.main("anchor", str(gold), str(tmp_path / "o.json"))
    assert "out_post" in events
    sidecar_idxs = [i for i, e in enumerate(events) if e == "sidecar_write"]
    out_idx = events.index("out_post")
    # EVERY sidecar write happens after the out_post call (W4 invert)
    assert all(i > out_idx for i in sidecar_idxs), events


# --- !503 review wave (W6 refresh hardening) --------------------------------

def test_w6_json_decode_error_in_refresh_does_not_raise(monkeypatch):
    """W6: a JSONDecodeError from fetch_realm_token must be caught by
    _maybe_refresh_token (was uncaught → process crash). The function returns
    False and the run continues with the existing token."""
    import run_eval as _re
    _set_kc_env(monkeypatch)
    monkeypatch.setattr(_re, "fetch_realm_token",
                        lambda *a, **k: (_ for _ in ()).throw(
                            json.JSONDecodeError("bad", "x", 0)
                        ))
    # Should NOT raise — returns False (no refresh succeeded)
    ok = _re._maybe_refresh_token(force=True)
    assert ok is False


def test_w6_refresh_call_inside_per_entry_try(monkeypatch):
    """W6: the top-of-loop _maybe_refresh_token call must be INSIDE the
    per-entry try block (was outside — a KeycloakError there would crash the
    run before the retry budget could absorb it)."""
    import run_eval as _re
    import inspect
    src = inspect.getsource(_re.main)
    # The per-entry loop begins at 'for entry in entries:'. Inside it, the
    # 'try:' block must contain _maybe_refresh_token(). Look for the
    # substring: 'for entry in entries:' ... 'try:' ... '_maybe_refresh_token()'
    loop_start = src.index("for entry in entries:")
    # next SLOC
    try_start = src.index('try:', loop_start)
    try_end = src.index('except', try_start)
    block = src[try_start:try_end]
    assert "_maybe_refresh_token()" in block, (
        "W6 violated: _maybe_refresh_token must be inside per-entry try block"
    )


# --- !503 review wave (W7 EVAL_FRESH + gold validation) ---------------------

def test_w7_eval_fresh_overwrites_existing(tmp_path, monkeypatch):
    """W7: EVAL_FRESH=1 deletes any pre-existing out + sidecar before resume,
    so a re-run starts from zero even if a prior run left state behind."""
    import json as _json
    _clear_eval_env(monkeypatch)
    monkeypatch.setenv("EVAL_FRESH", "1")
    monkeypatch.setenv("EVAL_ALLOW_UNMAPPED", "1")  # test injects no key_to_hash
    gold = _write_gold(tmp_path, [{"id": "q1", "query": "a", "expected_chunks": []}])
    out = tmp_path / "o.json"
    # Pre-existing report claiming q1 finished
    out.write_text(_json.dumps({
        "per_query": [{"id": "q1", "query": "a", "trace_found": True,
                       "selected": [], "candidates": []}],
        "aggregate": {"n": 1}, "n_missed_traces": 0,
        "n_unmapped_chunk_keys": 0, "n_http_errors": 0,
        "skipped_entries": [],
    }))
    (tmp_path / "o.json.done.jsonl").write_text("q1\n")
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", dict)

    drive_calls = []
    def fake_drive(entry):
        drive_calls.append(entry["id"])
        return 0.0, '{"text":"x"}', 200
    monkeypatch.setattr(run_eval, "drive_query", fake_drive)
    monkeypatch.setattr(run_eval, "fetch_selection", lambda s: (["k"], ["k"], []))
    monkeypatch.setattr(run_eval.time, "sleep", lambda s: None)

    rc = run_eval.main("anchor", str(gold), str(out))
    # q1 was re-driven (fresh wiped the prior done set)
    assert drive_calls == ["q1"]
    assert rc == 0


def test_w7_resume_validates_gold_ids(tmp_path, monkeypatch):
    """W7: if a prefilled id is not in the current gold, exit 2 with the first
    5 mismatches (gold changed mid-run)."""
    import json as _json
    _clear_eval_env(monkeypatch)
    gold = _write_gold(tmp_path, [{"id": "q1", "query": "a", "expected_chunks": []}])
    out = tmp_path / "o.json"
    # Pre-existing report with an id NOT in the current gold (q_legacy)
    out.write_text(_json.dumps({
        "per_query": [{"id": "q_legacy", "query": "old",
                       "trace_found": True, "selected": [], "candidates": []}],
        "aggregate": {"n": 1}, "n_missed_traces": 0,
        "n_unmapped_chunk_keys": 0, "n_http_errors": 0,
        "skipped_entries": [],
    }))
    (tmp_path / "o.json.done.jsonl").write_text("q_legacy\n")
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", dict)

    rc = run_eval.main("anchor", str(gold), str(out))
    assert rc == 2


# --- !503 review wave (W9 pre-loop refresh) --------------------------------

def test_w9_pre_loop_refresh_when_no_static_token(tmp_path, monkeypatch):
    """W9: when refresh is configured AND no static E2E_BEARER_TOKEN is seeded,
    _maybe_refresh_token(force=True) is called ONCE before the loop so the first
    drive carries a fresh token (was: elapsed=0 → skipped → first drive 401)."""
    import json as _json
    import run_eval as _re
    _clear_eval_env(monkeypatch)
    monkeypatch.setenv("EVAL_KC_URL", "https://kc.test/auth")
    monkeypatch.setenv("EVAL_KC_PASSWORD", "secret")
    monkeypatch.delenv("E2E_BEARER_TOKEN", raising=False)
    monkeypatch.setenv("EVAL_ALLOW_UNMAPPED", "1")  # test injects no key_to_hash
    monkeypatch.setattr(_re, "_token_ts", 0.0)

    gold = _write_gold(tmp_path, [{"id": "q1", "query": "a", "expected_chunks": []}])
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", dict)
    monkeypatch.setattr(run_eval, "fetch_selection", lambda s: (["k"], ["k"], []))

    fetch_calls = []
    def fake_fetch(*a, **kw):
        fetch_calls.append(1)
        return "fresh-pre-loop-tok"
    monkeypatch.setattr(run_eval, "fetch_realm_token", fake_fetch)

    drive_tokens = []
    def fake_drive(entry):
        drive_tokens.append(os.environ.get("E2E_BEARER_TOKEN"))
        return 0.0, '{"text":"ok"}', 200
    monkeypatch.setattr(run_eval, "drive_query", fake_drive)

    rc = run_eval.main("anchor", str(gold), str(tmp_path / "o.json"))
    # Pre-loop refresh fired exactly once; first drive carried the fresh token
    assert os.environ["E2E_BEARER_TOKEN"] == "fresh-pre-loop-tok"
    assert drive_tokens[0] == "fresh-pre-loop-tok"
    assert rc == 0


def test_w9_pre_loop_refresh_skipped_when_static_token_present(tmp_path, monkeypatch):
    """W9: when a static E2E_BEARER_TOKEN is already set, no pre-loop refresh
    fires (the operator seeded a valid token — let the TTL/401 logic handle it)."""
    import json as _json
    import run_eval as _re
    _clear_eval_env(monkeypatch)
    monkeypatch.setenv("EVAL_KC_URL", "https://kc.test/auth")
    monkeypatch.setenv("EVAL_KC_PASSWORD", "secret")
    monkeypatch.setenv("E2E_BEARER_TOKEN", "operator-seeded")
    monkeypatch.setattr(_re, "_token_ts", 0.0)

    gold = _write_gold(tmp_path, [{"id": "q1", "query": "a", "expected_chunks": []}])
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", dict)
    monkeypatch.setattr(run_eval, "fetch_selection", lambda s: (["k"], ["k"], []))

    fetch_calls = []
    def fake_fetch(*a, **kw):
        fetch_calls.append(1)
        return "should-not-fire"
    monkeypatch.setattr(run_eval, "fetch_realm_token", fake_fetch)
    monkeypatch.setattr(run_eval, "drive_query",
                        lambda e: (0.0, '{"text":"ok"}', 200))

    run_eval.main("anchor", str(gold), str(tmp_path / "o.json"))
    # No pre-loop refresh — operator-seeded token survives
    assert os.environ["E2E_BEARER_TOKEN"] == "operator-seeded"
    assert fetch_calls == []


# --- !503 review wave (W11 final-block reuses report) -----------------------

def test_w11_final_block_uses_returned_report(tmp_path, monkeypatch):
    """W11: the final anchor block must reuse the dict returned by
    _write_out_post — NOT recompute the aggregate. Verified by patching
    metrics.aggregate: it must be called ONCE per scored row across the WHOLE
    run (final block does not add calls)."""
    import json as _json
    _clear_eval_env(monkeypatch)
    gold = _write_gold(tmp_path, [
        {"id": "q1", "query": "a", "expected_chunks": [
            {"chunk_key": "k1", "content_hash": "h1"}
        ]},
    ])
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", lambda: {"k1": "h1"})
    monkeypatch.setattr(run_eval, "drive_query", lambda e: (0.0, '{"text":"x"}', 200))
    monkeypatch.setattr(run_eval, "fetch_selection", lambda s: (["k1"], ["k1"], []))

    import metrics as _m
    calls = {"n": 0}
    orig_agg = _m.aggregate
    def spy_agg(scored):
        calls["n"] += 1
        return orig_agg(scored)
    monkeypatch.setattr(_m, "aggregate", spy_agg)
    monkeypatch.setattr(run_eval, "metrics", _m)

    rc = run_eval.main("anchor", str(gold), str(tmp_path / "o.json"))
    # 1 scored row → 1 aggregate call per _write_out_post invocation.
    # Iterations: per-entry success (1) + final block (1) = 2 calls.
    # W11 regression test: if final block recomputed, would be 3.
    assert calls["n"] == 2, f"expected 2 calls, got {calls['n']} (final block may have recomputed)"
    assert rc == 0


# --- !503 review wave (W13 map-build guard) ---------------------------------

def test_w13_no_op_resume_skips_map_build(tmp_path, monkeypatch):
    """W13: on a no-op resume (all entries already in sidecar), the ArangoDB
    hash-map build must NOT fire — there's nothing to score. Maintained its
    regression: build_* always ran, wasting seconds on every restart."""
    import json as _json
    _clear_eval_env(monkeypatch)
    gold = _write_gold(tmp_path, [
        {"id": "q1", "query": "a", "expected_chunks": []},
        {"id": "q2", "query": "b", "expected_chunks": []},
    ])
    out = tmp_path / "o.json"
    rows = [{
        "id": f"q{i+1}", "query": f"Q{i+1}?", "trace_found": True,
        "selected": [], "candidates": [],
        "gold": [], "gold_hashes": [], "selected_hashes": [], "candidate_hashes": [],
        "expected_chunks": [], "adaptive_breakdown": [],
        "recall": 1.0, "precision": 1.0, "complete_recall": 1.0, "noise": 0.0,
        "retrieval_recall": 1.0, "passage_recall": 1.0,
        "n_passages": 1, "passages_retrieved": 1,
    } for i in range(2)]
    out.write_text(_json.dumps({
        "per_query": rows, "aggregate": {"n": 2},
        "n_missed_traces": 0, "n_unmapped_chunk_keys": 0,
        "n_http_errors": 0, "skipped_entries": [],
    }))
    (tmp_path / "o.json.done.jsonl").write_text("q1\nq2\n")

    build_calls = {"k": 0, "h": 0}
    def spy_k():
        build_calls["k"] += 1
        return {}
    def spy_h():
        build_calls["h"] += 1
        return {}
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", spy_k)
    monkeypatch.setattr(run_eval, "build_hash_to_text", spy_h)

    rc = run_eval.main("anchor", str(gold), str(out))
    assert rc == 0
    # No work to do → neither build fires
    assert build_calls["k"] == 0
    assert build_calls["h"] == 0

