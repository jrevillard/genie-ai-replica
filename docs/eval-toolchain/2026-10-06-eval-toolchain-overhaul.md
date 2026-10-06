# RAG Eval Toolchain Overhaul — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `tests/rag-benchmarks/` a fully in-repo, silent-failure-proof, single-implementation eval toolchain — retiring the host-only `run_eval_chunked.py`, closing every verified P0 finding from the 2026-10-06 adversarial audit.

**Architecture:** Fold orchestration INTO `run_eval.py` (per-entry containment, incremental atomic writes, resume, in-run token refresh via new `eval/keycloak.py`). The bash wrapper becomes thin: secrets from the deployment `.env`, verified ROPC enable/revert, direct `run_eval.py` call. One Arango client (paginated), one docker-exec/JSON harness. RAGAS runner gets pinned requirements + in-repo compat stub + input guards.

**Tech Stack:** Python 3.10+ (stdlib only at runtime for eval scripts; `ragas` venv for Phase 4), bash, pytest, GitLab CI.

**Spec:** `/tmp/eval-new/TOOLCHAIN-IMPROVEMENT-PLAN.md` (audited improvement plan, 45 verified findings) + `/tmp/eval-new/audit-findings-flat.md`. This plan argues from the spec; executors read both. **Both files must be copied into the integration worktree root as `docs/eval-toolchain/` on MR-A commit 1** so the spec travels with the branch.

## Global Constraints

- Runtime = Python **stdlib only** for everything under `tests/rag-benchmarks/eval/` except `run_ragas_eval.py` (ragas venv, pinned via `eval/requirements.txt`). No `pip install` needed to run anchor/dump-tuples.
- Code must run on **Python 3.10** (swarm host) and 3.13 (local venv) — no 3.11+ syntax.
- All docs/comments in **English**.
- Unit tests run **offline** (no docker, no ssh, no network) — mock at module boundaries (`_docker_exec`, `urlopen`).
- **Branch topology:** integration branch `feat/eval-toolchain` (one dedicated worktree at `.claude/worktrees/eval-toolchain`). Child branches `feat/eval-a`, `feat/eval-b`, `feat/eval-c`, `feat/eval-d` → MRs target `feat/eval-toolchain` (NOT main). One final MR `feat/eval-toolchain` → `main` after the live gate. Then rebase `release/el-salvador` onto main (user lifts/restores branch protection).
- **Merge rule (2026-09-23):** each child MR merges only with green CI (pytest). The final MR to main additionally requires the full live gate (Task G2). MR-B additionally requires the smoke gate (Task G1) before MR-C starts.
- **No secrets in process argv** in any committed code (finding P0-8).
- **Exit-code contract** (all scripts): `0` clean · `2` usage/input error · `3` degraded (missed traces / unmapped keys / skipped entries above threshold) · `4` zero scored rows.
- `git grep run_eval_chunked` must return **0 hits** in the repo when MR-B is done.
- Tests: `cd tests/rag-benchmarks/eval && python3 -m pytest test_*.py -q` (MR-A adds the CI job running the same).

---

## File Structure (target state)

```
tests/rag-benchmarks/
├── eval/
│   ├── keycloak.py        # NEW (MR-B): the ONLY token fetcher (urllib, unverified-SSL ctx)
│   ├── harness.py         # NEW (MR-D): docker_exec + read_json/write_json atomic
│   ├── arango.py          # MOD (MR-A): paginated cursor + timeout + count assert
│   │                      # MOD (MR-D): + source_chunks() helper
│   ├── run_eval.py        # MOD (MR-A): HTTP status + exit contract + poll backoff
│   │                      # MOD (MR-B): containment/retry/resume + token refresh hook
│   ├── run_ragas_eval.py  # MOD (MR-C): compat stub + guards + max_tokens knob
│   ├── requirements.txt   # NEW (MR-C)
│   ├── match_gold_chunks.py # MOD (MR-C): atomic write + backup + dead code
│   ├── dump_chunks.py     # MOD (MR-C): aligned defaults + fallback warning
│   ├── RUNBOOK.md         # NEW (MR-D)
│   ├── test_keycloak.py   # NEW · test_arango.py NEW · test_harness.py NEW
│   ├── test_run_eval.py   # MOD (grows with each MR)
│   └── .gitignore         # MOD (MR-C): run-output patterns (never gold patterns)
├── scripts/
│   └── run_anchor_with_cleanup.sh  # REWRITE (MR-B)
├── capture_baseline.py    # MOD (MR-D): uses harness/keycloak
└── [benchmark_*.py ×5 + run_benchmarks.sh]  # DELETED (MR-D)
```

---

# MR-A — Safety & Failure Visibility

Branch `feat/eval-a` off `feat/eval-toolchain`.

### Task A1: CI pytest job

**Files:**
- Modify: `.gitlab-ci.yml` (insert after `test:sitecustomize` job, ~line 2460)
- Create: `docs/eval-toolchain/` (copy of the two spec files from `/tmp/eval-new/`)

**Interfaces:**
- Produces: CI job `test:rag-benchmarks` running `python3 -m pytest tests/rag-benchmarks/eval/test_*.py tests/rag-benchmarks/test_capture_baseline.py -q` — every later task relies on this gate.

- [ ] **Step 1: Copy the spec docs onto the branch**

```bash
mkdir -p docs/eval-toolchain
cp /tmp/eval-new/TOOLCHAIN-IMPROVEMENT-PLAN.md docs/eval-toolchain/
cp /tmp/eval-new/audit-findings-flat.md docs/eval-toolchain/
cp /tmp/eval-new/PLANS/2026-10-06-eval-toolchain-overhaul.md docs/eval-toolchain/
```

- [ ] **Step 2: Add the CI job**

```yaml
# RAG eval harness unit tests — offline, stdlib+pytest only.
test:rag-benchmarks:
  image: python:3.11-slim
  stage: test
  interruptible: true
  before_script:
    - pip install --cache-dir .cache/pip pytest
  cache:
    - key: test-rag-benchmarks
      paths:
        - .cache/pip
  script:
    - cd tests/rag-benchmarks/eval
    - pytest test_chunk_identity.py test_metrics.py test_match_gold_chunks.py test_run_eval.py -q --junitxml=../../../reports/rag-benchmarks-report.xml
    - cd ..
    - pytest test_capture_baseline.py -q --junitxml=../reports/rag-benchmarks-capture-report.xml
  artifacts:
    when: always
    expire_in: 7 days
    reports:
      junit:
        - reports/rag-benchmarks-report.xml
        - reports/rag-benchmarks-capture-report.xml
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
      when: on_success
    - if: '$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH || $CI_COMMIT_BRANCH =~ /^release\/*/'
      when: on_success
    - if: '$CI_COMMIT_BRANCH =~ /^feat\/eval-toolchain$/'
      when: on_success
```

- [ ] **Step 3: Verify locally the exact CI command passes**

Run: `cd tests/rag-benchmarks/eval && python3 -m pytest test_chunk_identity.py test_metrics.py test_match_gold_chunks.py test_run_eval.py -q`
Expected: all pass (~82 tests).

- [ ] **Step 4: Commit + MR**

```bash
git add .gitlab-ci.yml docs/eval-toolchain/
git commit -m "ci(rag-benchmarks): run eval harness pytest suite on every MR"
# push feat/eval-a, MR target=feat/eval-toolchain
```

### Task A2: HTTP status detection in `drive_query` (401 absorbed as answer)

**Files:**
- Modify: `tests/rag-benchmarks/eval/run_eval.py:98-122` (drive_query), `:351-463` (main)
- Test: `tests/rag-benchmarks/eval/test_run_eval.py`

**Interfaces:**
- Produces: `drive_query(entry) -> tuple[float, str, int]` — `(start, body, http_status)`. Status `0` = unknown (curl without code). Callers in MR-B extend this to trigger re-auth.

- [ ] **Step 1: Write failing tests**

```python
# append to test_run_eval.py
def test_drive_query_returns_http_status(monkeypatch):
    monkeypatch.setattr(run_eval, "_docker_exec", lambda c, cmd, timeout=120: '{"text":"ok"}\n200')
    start, body, status = run_eval.drive_query({"query": "q"})
    assert status == 200 and body == '{"text":"ok"}'

def test_drive_query_401_detected(monkeypatch):
    monkeypatch.setattr(run_eval, "_docker_exec", lambda c, cmd, timeout=120: '{"error":"invalid_token"}\n401')
    _, _, status = run_eval.drive_query({"query": "q"})
    assert status == 401
```

- [ ] **Step 2: Run → FAIL** (`ValueError: too many values to unpack`)

Run: `python3 -m pytest test_run_eval.py -q`

- [ ] **Step 3: Implement**

```python
def drive_query(entry: dict) -> tuple[float, str, int]:
    """POST the gold query to chatqna. Returns (start_time, body, http_status)."""
    payload = {
        "messages": [{"role": "user", "content": entry["query"]}],
        "context": {
            "categoryLabels": entry.get("categoryLabels", []),
            "serviceLabels": entry.get("serviceLabels", []),
            "language": entry.get("language", "en"),
        },
        "stream": False,
    }
    payload_json = json.dumps(payload).replace("'", "'\\''")
    start = time.time()
    auth_header = ""
    _token = os.getenv("E2E_BEARER_TOKEN")
    if _token:
        auth_header = f" -H 'Authorization: Bearer {_token}'"
    cmd = (
        f"curl -s -m 120 -X POST {CHATQNA_URL} -H 'Content-Type: application/json'"
        f"{auth_header} -d '{payload_json}' -w '\\n%{{http_code}}'"
    )
    raw = _docker_exec(CHATQNA_CONTAINER, cmd, timeout=150)
    body, _, code = raw.rpartition("\n")
    status = int(code) if code.strip().isdigit() else 0
    return start, body, status
```

- [ ] **Step 4: In `main()` loop, handle HTTP errors** — replace `start, body = drive_query(entry)` with:

```python
        start, body, status = drive_query(entry)
        if status in (401, 403):
            http_errors += 1
            print(
                f"[{entry['id']}] AUTH-FAILURE (HTTP {status}) — bearer expired or "
                "invalid. Use the wrapper (token lifecycle) or refresh E2E_BEARER_TOKEN.",
                file=sys.stderr,
            )
            if mode == "dump-tuples":
                skipped_entries.append(entry["id"])
                continue
            rows.append({"id": entry["id"], "query": entry["query"],
                         "trace_found": False, "error": f"HTTP {status}"})
            missed += 1
            continue
        if status >= 500:
            http_errors += 1
            print(f"[{entry['id']}] HTTP {status} from chatqna — skipped", file=sys.stderr)
            skipped_entries.append(entry["id"])
            continue
```

Initialize `http_errors = 0` and `skipped_entries: list[str] = []` next to `missed, unmapped = 0, 0` (run_eval.py:358).

- [ ] **Step 5: Run tests → PASS. Commit**

```bash
git commit -am "fix(eval): detect chatqna HTTP status — 401/5xx no longer absorbed as answers"
```

### Task A3: Exit-code contract

**Files:**
- Modify: `tests/rag-benchmarks/eval/run_eval.py` (end of `main`, `__main__` block)
- Test: `test_run_eval.py`

**Interfaces:**
- Produces: `main(mode, gold_path, out_path) -> int` returning the contract code; `__main__` does `sys.exit(main(...))`. `capture_baseline` (MR-D) consumes the return value. Env knobs: `EVAL_MAX_MISSED_TRACES` (default `"2"`), `EVAL_ALLOW_UNMAPPED` (default unset), `EVAL_ALLOW_PARTIAL` (default unset).

- [ ] **Step 1: Failing test**

```python
def test_exit_contract_zero_rows(tmp_path, monkeypatch):
    import json as _json
    gold = tmp_path / "g.json"; gold.write_text(_json.dumps({"entries": []}))
    # empty key maps, no queries: anchor mode with zero scored rows
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", lambda: {})
    rc = run_eval.main("anchor", str(gold), str(tmp_path / "out.json"))
    assert rc == 4  # zero scored rows
```

- [ ] **Step 2: Run → FAIL** (main returns None)

- [ ] **Step 3: Implement** — make `main` return int; at the end of the anchor branch:

```python
    scored = [r for r in rows if r.get("trace_found")]
    # ... existing aggregate + write ...
    max_missed = int(os.getenv("EVAL_MAX_MISSED_TRACES", "2"))
    if not scored and rows:
        return 4
    if not rows:
        return 4
    if missed > max_missed:
        print(f"EXIT 3: {missed} missed traces > EVAL_MAX_MISSED_TRACES={max_missed}", file=sys.stderr)
        return 3
    if unmapped and not os.getenv("EVAL_ALLOW_UNMAPPED"):
        print(f"EXIT 3: {unmapped} unmapped chunk keys (wrong GRAPH_SOURCE?)", file=sys.stderr)
        return 3
    return 0
```

Dump-tuples branch: write tuples + a `<out>.meta.json` sidecar `{"n_entries": len(entries), "n_tuples": len(tuples), "n_http_errors": http_errors, "n_missed_traces": missed, "skipped": skipped_entries}`; then:

```python
    if not tuples:
        return 4
    if (len(tuples) < len(entries)) and not os.getenv("EVAL_ALLOW_PARTIAL"):
        print(f"EXIT 3: {len(entries) - len(tuples)} entries skipped (see {out_path}.meta.json)", file=sys.stderr)
        return 3
    return 0
```

`__main__` block: `sys.exit(main(mode, gold, out))`.

- [ ] **Step 4: Tests pass (update any test that asserted `main` returns None). Commit**

```bash
git commit -am "fix(eval): failure exit contract — 0 clean / 3 degraded / 4 empty"
```

### Task A4: Arango cursor pagination + timeout (deadline: before overlap=300 re-ingest)

**Files:**
- Modify: `tests/rag-benchmarks/eval/arango.py` (full rewrite of `cursor`)
- Test: `tests/rag-benchmarks/eval/test_arango.py` (new)

**Interfaces:**
- Produces: `cursor(aql, bind_vars=None, *, url=None, db=None, user=None, password=None, batch_size=1000, timeout=30) -> list` — module env vars remain the defaults; overrides are keyword-only (MR-D Task D3 passes overrides; `match_gold_chunks` migrates then).

- [ ] **Step 1: Failing tests** (`test_arango.py`)

```python
import json
import arango

class _FakeResp:
    def __init__(self, payload): self._p = payload
    def read(self): return json.dumps(self._p).encode()
    def __enter__(self): return self
    def __exit__(self, *a): return False

def test_cursor_follows_pagination(monkeypatch):
    pages = [
        {"result": [{"key": f"k{i}"} for i in range(1000)], "hasMore": True, "id": "c1", "count": 1002},
        {"result": [{"key": "k1000"}, {"key": "k1001"}], "hasMore": False, "count": 1002},
    ]
    calls = []
    def fake_urlopen(req, timeout=None):
        calls.append(req.full_url)
        return _FakeResp(pages.pop(0))
    monkeypatch.setattr(arango.urllib.request, "urlopen", fake_urlopen)
    rows = arango.cursor("FOR x IN c RETURN x")
    assert len(rows) == 1002
    assert calls[1].endswith("/_api/cursor/c1")  # PUT continuation

def test_cursor_count_mismatch_raises(monkeypatch):
    p = {"result": [{"key": "k"}], "hasMore": False, "count": 5}
    monkeypatch.setattr(arango.urllib.request, "urlopen",
                        lambda req, timeout=None: _FakeResp(p))
    try:
        arango.cursor("FOR x IN c RETURN x"); assert False
    except RuntimeError as e:
        assert "mismatch" in str(e)
```

- [ ] **Step 2: Run → FAIL** (no continuation, no raise)

- [ ] **Step 3: Implement**

```python
def cursor(
    aql: str,
    bind_vars: dict | None = None,
    *,
    url: str | None = None,
    db: str | None = None,
    user: str | None = None,
    password: str | None = None,
    batch_size: int = 1000,
    timeout: float = 30,
) -> list:
    """Run an AQL query; return ALL rows (follows cursor pagination).

    Raises RuntimeError when the accumulated row count diverges from the
    server-reported `count` — a truncated read must never pass silently
    (the corpus crosses one batch at ~1080 chunks under overlap=300).
    """
    base = (url or ARANGO_URL).rstrip("/")
    database = db or ARANGO_DB
    auth = base64.b64encode(
        f"{user or ARANGO_USER}:{password or ARANGO_PASSWORD}".encode()
    ).decode()
    cursor_url = f"{base}/_db/{urllib.parse.quote(database)}/_api/cursor"
    body: dict | str = {
        "query": aql,
        "bindVars": bind_vars or {},
        "batchSize": batch_size,
        "count": True,
    }
    rows: list = []
    expected: int | None = None
    while True:
        req = urllib.request.Request(
            cursor_url,
            data=json.dumps(body).encode(),
            headers={"Authorization": f"Basic {auth}", "Content-Type": "application/json"},
            method="POST" if expected is None else "PUT",
        )
        with urllib.request.urlopen(req, timeout=timeout) as resp:
            payload = json.load(resp)
        if expected is None:
            expected = payload.get("count")
        rows.extend(payload.get("result", []))
        cid = payload.get("id")
        if not payload.get("hasMore") or not cid:
            break
        cursor_url = f"{base}/_db/{urllib.parse.quote(database)}/_api/cursor/{cid}"
        body = {}  # PUT continuation takes an empty body
    if expected is not None and len(rows) != expected:
        raise RuntimeError(
            f"Arango cursor count mismatch: got {len(rows)} rows, server count {expected}"
        )
    return rows
```

- [ ] **Step 4: Full suite pass. Commit**

```bash
git commit -am "fix(eval): paginate Arango cursor + count assert + timeout (pre-re-ingest deadline)"
```

### Task A5: VT poll — immediate first check + backoff

**Files:**
- Modify: `tests/rag-benchmarks/eval/run_eval.py:192-216` (`fetch_selection`)

**Interfaces:** unchanged signature.

- [ ] **Step 1: Failing test** — monkeypatch `time.sleep` to record delays and `_docker_exec` to return a span on 2nd call; assert first sleep is NOT `TRACE_FLUSH_WAIT` (old code slept first).

```python
def test_fetch_selection_immediate_first_poll(monkeypatch):
    sleeps = []
    monkeypatch.setattr(run_eval.time, "sleep", lambda s: sleeps.append(s))
    responses = ['{"data":[]}', '{"data":[{"spans":[{"operationName":"x.reranker_selection","startTime":1,"tags":[{"key":"rag.candidate_chunk_keys","value":"[\"a\"]"},{"key":"rag.selected_chunk_keys","value":"[\"a\"]"}]}]}]}']
    monkeypatch.setattr(run_eval, "_docker_exec", lambda *a, **k: responses.pop(0))
    monkeypatch.setattr(run_eval, "TRACE_FETCH_TIMEOUT", 30)
    cands, sels, _ = run_eval.fetch_selection(time.time())
    assert cands == ["a"]
    assert sleeps == [] or sleeps[0] <= 2.0  # no 5s dead sleep before first check
```

- [ ] **Step 2: FAIL → Step 3: implement** — replace `time.sleep(TRACE_FLUSH_WAIT)` with:

```python
    deadline = time.time() + TRACE_FETCH_TIMEOUT
    delay = 0.0  # check immediately — spans are often indexed by the time curl returns
    while True:
        if delay:
            time.sleep(delay)
        delay = 1.0 if delay < 1.0 else (2.0 if delay < 2.0 else TRACE_FLUSH_WAIT)
```

- [ ] **Step 4: Pass. Commit** `fix(eval): VT poll backoff 0→1→2→flush_wait`

### Task A6: MR-A close-out

- [ ] Full local suite green; push `feat/eval-a`; MR → `feat/eval-toolchain`; CI green; merge (squash).

---

# MR-B — Orchestrator Fold (retires `run_eval_chunked.py`)

Branch `feat/eval-b` off updated `feat/eval-toolchain`.

### Task B1: `eval/keycloak.py` — the only token fetcher

**Files:**
- Create: `tests/rag-benchmarks/eval/keycloak.py`
- Test: `tests/rag-benchmarks/eval/test_keycloak.py`

**Interfaces:**
- Produces:
  - `fetch_realm_token(kc_url: str, realm: str, client_id: str, username: str, password: str, timeout: float = 30) -> str` (the access_token; raises `KeycloakError` on non-2xx/missing token)
  - `fetch_master_token(kc_url: str, admin_password: str, timeout: float = 30) -> str`
  - `class KeycloakError(RuntimeError)`
  - Both POST via `urllib.request` with `ssl._create_unverified_context()` (self-signed deployments — replicates `curl -sk`, keeps secrets out of argv). **Form-encoded body** (`application/x-www-form-urlencoded`), never a query string.

- [ ] **Step 1: Failing tests** — fake `urlopen` capturing the request; assert method POST, content-type form, no password in `req.full_url`, token extracted; non-200 raises `KeycloakError`.

```python
import urllib.request, keycloak

class _Resp:
    def __init__(self, code=200, token="tok"): self.code, self._b = code, ('{"access_token":"%s"}' % token).encode()
    def __enter__(self): return self
    def __exit__(self, *a): return False
    def read(self): return self._b
    def getcode(self): return self.code

def test_fetch_realm_token_posts_form_and_hides_secret(monkeypatch):
    seen = {}
    def fake(req, timeout=None, context=None):
        seen["url"] = req.full_url; seen["data"] = req.data.decode(); seen["method"] = req.get_method()
        return _Resp()
    monkeypatch.setattr(urllib.request, "urlopen", fake)
    tok = keycloak.fetch_realm_token("https://kc/auth", "genie", "genie-app", "u", "S3CR3T")
    assert tok == "tok"
    assert seen["method"] == "POST"
    assert "S3CR3T" not in seen["url"] and "S3CR3T" in seen["data"]

def test_fetch_realm_token_non200_raises(monkeypatch):
    monkeypatch.setattr(urllib.request, "urlopen", lambda *a, **k: _Resp(code=401, token=""))
    try: keycloak.fetch_realm_token("https://kc/auth", "r", "c", "u", "p"); assert False
    except keycloak.KeycloakError: pass
```

- [ ] **Step 2: FAIL → Step 3: implement**

```python
# Copyright (C) 2025 ITU
# SPDX-License-Identifier: Apache-2.0
"""The ONLY Keycloak token fetcher for the eval toolchain.

Secrets stay in the POST body (never argv / URL). SSL verification is
disabled to match `curl -sk` against self-signed Keycloak deployments.
"""
from __future__ import annotations

import json
import ssl
import urllib.parse
import urllib.request


class KeycloakError(RuntimeError):
    pass


_SSL_CTX = ssl._create_unverified_context()


def _post_token(url: str, form: dict[str, str], timeout: float) -> str:
    data = urllib.parse.urlencode(form).encode()
    req = urllib.request.Request(
        url, data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_SSL_CTX) as resp:
            payload = json.load(resp)
    except urllib.error.HTTPError as e:
        raise KeycloakError(f"token endpoint HTTP {e.code}: {e.read()[:200]!r}") from e
    token = payload.get("access_token")
    if not token:
        raise KeycloakError(f"no access_token in response: {list(payload)[:5]}")
    return token


def fetch_realm_token(kc_url, realm, client_id, username, password, timeout=30.0):
    return _post_token(
        f"{kc_url.rstrip('/')}/realms/{urllib.parse.quote(realm)}/protocol/openid-connect/token",
        {"grant_type": "password", "client_id": client_id,
         "username": username, "password": password},
        timeout,
    )


def fetch_master_token(kc_url, admin_password, timeout=30.0):
    return _post_token(
        f"{kc_url.rstrip('/')}/realms/master/protocol/openid-connect/token",
        {"grant_type": "password", "client_id": "admin-cli",
         "username": "admin", "password": admin_password},
        timeout,
    )
```

- [ ] **Step 4: Pass. Commit** `feat(eval): keycloak.py — single token fetcher, secrets off argv`

### Task B2: Per-entry containment, retry, incremental atomic writes, resume

**Files:**
- Modify: `tests/rag-benchmarks/eval/run_eval.py` (main loop; add helpers)
- Test: `test_run_eval.py`

**Interfaces:**
- Produces:
  - `_write_out(out_path, payload, mode)` — atomic (tmp + `os.replace`); tuples mode writes the list, anchor mode the report dict.
  - Resume: on start, if `out_path` exists and parses, prefill `rows`/`tuples` and a `done: set[str]` of ids from it; `<out_path>.done.jsonl` (one id per line) is the authoritative skip-set, appended after each entry.
  - Loop wraps one entry in `try/except (subprocess.TimeoutExpired, RuntimeError, json.JSONDecodeError, OSError)`; retry ×2 with 5 s backoff; after final failure append `{"id", "query", "trace_found": False, "error": str(e)[:200]}` (anchor) / skip id (tuples), count in `skipped_entries`, continue.

- [ ] **Step 1: Failing tests** (three): (1) second entry raising `RuntimeError` twice → run completes, error row present, rc==3; (2) kill-resume: write an output with entry q1 done + `.done.jsonl`, re-run → only q2 driven; (3) `_write_out` leaves no `.tmp` on success. Mock `drive_query`/`fetch_selection`/`build_*` at module level; `tmp_path` gold of 2 entries.

```python
def test_entry_error_contained_and_reported(tmp_path, monkeypatch):
    import json as _json
    gold = {"entries": [{"id": "q1", "query": "a"}, {"id": "q2", "query": "b"}]}
    (tmp_path / "g.json").write_text(_json.dumps(gold))
    monkeypatch.setattr(run_eval, "build_key_to_content_hash", lambda: {})
    monkeypatch.setattr(run_eval, "fetch_selection", lambda s: (["k"], ["k"], []))
    calls = {"n": 0}
    def flaky(entry):
        calls["n"] += 1
        if entry["id"] == "q2":
            raise RuntimeError("docker exec failed: boom")
        return 0.0, '{"text":"x"}', 200
    monkeypatch.setattr(run_eval, "drive_query", flaky)
    monkeypatch.setattr(run_eval.time, "sleep", lambda s: None)
    rc = run_eval.main("anchor", str(tmp_path / "g.json"), str(tmp_path / "o.json"))
    rep = _json.loads((tmp_path / "o.json").read_text())
    assert any(r["id"] == "q2" and r.get("error") for r in rep["per_query"])
    assert rc == 3 and calls["n"] >= 3  # retried
```

- [ ] **Step 2: FAIL → Step 3: implement** the helpers + rewritten loop (full code in the executor's task brief: `_load_done()`, `_write_out()`, per-entry `for attempt in range(3)` guard, `.done.jsonl` append). Key rule: **atomic rewrite after every entry** (build the full payload from accumulated state, `os.replace`).

- [ ] **Step 4: Pass + full suite. Commit** `feat(eval): per-entry containment + resume + atomic incremental output`

### Task B3: In-run token refresh

**Files:**
- Modify: `run_eval.py` (top-of-loop hook + 401 reaction from Task A2)
- Test: `test_run_eval.py`

**Interfaces:**
- Consumes: `keycloak.fetch_realm_token`.
- Produces: env `EVAL_KC_URL`, `EVAL_KC_REALM` (default `genie`), `EVAL_KC_CLIENT_ID` (default `genie-app`), `EVAL_KC_USER` (default `genie-admin`), `EVAL_KC_PASSWORD` (or reuse `GENIE_ADMIN_PASSWORD`). When set, `_maybe_refresh_token()` runs before each entry (TTL 240 s − 60 s margin) and immediately on a 401 (one retry), updating `os.environ["E2E_BEARER_TOKEN"]`. Static-token path (none of the vars set) unchanged — `capture_baseline` relies on it.

- [ ] **Step 1: Failing test** — set the 5 env vars, monkeypatch `keycloak.fetch_realm_token` to return "fresh" and count calls; first `drive_query` returns 401; assert a retry happened with the new token and the tuple/row was scored. **Step 2: FAIL → Step 3: implement → Step 4: pass. Commit** `feat(eval): in-run bearer refresh via keycloak.py`

### Task B4: Wrapper rewrite — direct call, verified ROPC, secrets off argv

**Files:**
- Rewrite: `tests/rag-benchmarks/scripts/run_anchor_with_cleanup.sh` (full new content below)
- Modify: `tests/rag-benchmarks/eval/run_eval.py` docstring lines 6-15 (point at new wrapper behavior)

- [ ] **Step 1: Write the new wrapper** (complete file — replace existing):

```bash
#!/bin/bash
# Eval entry point: ROPC enable → run_eval.py (direct) → VERIFIED ROPC revert.
#
# The eval driver run_eval.py owns token refresh, retry and resume itself;
# this wrapper only (1) resolves secrets from the deployment .env, (2) flips
# directAccessGrantsEnabled, (3) runs the driver, (4) PROVES the revert.
# run_eval_chunked.py is RETIRED — do not recreate it.
#
# Required env (or present in EVAL_DEPLOY_ENV, default /opt/<stack>/.env):
#   EVAL_KC_URL, KEYCLOAK_ADMIN_PASSWORD, GENIE_ADMIN_PASSWORD,
#   ARANGO_DB, ARANGO_PASSWORD
# Optional: EVAL_KC_REALM (genie), EVAL_KC_CLIENT_ID (genie-app),
#   EVAL_MODE (anchor|dump-tuples), EVAL_CHUNK_* gone — see run_eval.py knobs.
set -euo pipefail

GOLD="$1"; OUT="$2"
EVAL_MODE="${EVAL_MODE:-anchor}"

ENV_FILE="${EVAL_DEPLOY_ENV:-/opt/genieai-el-salvador/.env}"
env_value() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-; }
: "${EVAL_KC_URL:=$(env_value KEYCLOAK_URL)}"; : "${EVAL_KC_URL:?EVAL_KC_URL required}"
: "${KEYCLOAK_ADMIN_PASSWORD:=$(env_value KEYCLOAK_ADMIN_PASSWORD)}"
: "${KEYCLOAK_ADMIN_PASSWORD:?KEYCLOAK_ADMIN_PASSWORD required}"
: "${GENIE_ADMIN_PASSWORD:=$(env_value GENIE_ADMIN_PASSWORD)}"
: "${GENIE_ADMIN_PASSWORD:?GENIE_ADMIN_PASSWORD required}"
: "${ARANGO_DB:=$(env_value ARANGO_DB)}"; : "${ARANGO_DB:?ARANGO_DB required}"
: "${ARANGO_PASSWORD:=$(env_value ARANGO_PASSWORD)}"
: "${ARANGO_PASSWORD:?ARANGO_PASSWORD required}"
export EVAL_KC_URL KEYCLOAK_ADMIN_PASSWORD GENIE_ADMIN_PASSWORD ARANGO_DB ARANGO_PASSWORD
# run_eval.py refreshes the realm bearer itself when these are set:
export EVAL_KC_PASSWORD="$GENIE_ADMIN_PASSWORD"
export EVAL_KC_REALM="${EVAL_KC_REALM:-genie}"
export EVAL_KC_CLIENT_ID="${EVAL_KC_CLIENT_ID:-genie-app}"
export EVAL_KC_USER="${EVAL_KC_USER:-genie-admin}"
export EVAL_MODE

EVAL_KC_REALM_S="$EVAL_KC_REALM"; EVAL_KC_CLIENT_ID_S="$EVAL_KC_CLIENT_ID"
# --- dynamic resolution (exported: run_eval.py inherits) --------------------
export CHATQNA_CONTAINER="${CHATQNA_CONTAINER:-$(docker ps --format '{{.Names}}' | grep chatqna-xeon-backend-server | head -1)}"
export CHATQNA_SERVICE_NAME="${CHATQNA_SERVICE_NAME:-genieai-chatqna}"
export VICTORIATRACES_SVC="${VICTORIATRACES_SVC:-$(echo "$CHATQNA_SERVICE_NAME" | sed 's/chatqna/victoriatraces/;s/-chatqna$/-victoriatraces/')}"
export GRAPH_SOURCE="${GRAPH_SOURCE:-GRAPH_TEST_SOURCE}"
export ARANGO_URL="${ARANGO_URL:-http://localhost:8529}"
export ARANGO_USER="${ARANGO_USER:-root}"

# --- curl with secrets on STDIN (config syntax), never argv -----------------
kc_post() {  # kc_post <url> <form-data>
    curl -sk -m 30 -K - "$1" <<CURLCFG
request = "POST"
data = "$2"
CURLCFG
}
kc_put_json() {  # kc_put_json <url> <json> <bearer> -> http code
    curl -sk -m 30 -o /dev/null -w '%{http_code}' -K - -X PUT "$1" <<CURLCFG
header = "Authorization: Bearer $3"
header = "Content-Type: application/json"
data = "$2"
CURLCFG
}

master_token() { kc_post "$EVAL_KC_URL/realms/master/protocol/openid-connect/token" \
    "client_id=admin-cli&username=admin&password=$KEYCLOAK_ADMIN_PASSWORD&grant_type=password" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])'; }

ADMIN_TOKEN=$(master_token)
HDR=$(mktemp); chmod 600 "$HDR"; echo "Authorization: Bearer $ADMIN_TOKEN" > "$HDR"
cleanup() {
    rm -f "$HDR"
    # Re-auth inside the trap: the run may have outlived the token.
    AT=$(master_token || true)
    if [ -n "$AT" ]; then
        for i in 1 2 3; do
            CODE=$(kc_put_json "$EVAL_KC_URL/admin/realms/$EVAL_KC_REALM_S/clients/$CLIENT_UUID" \
                '{"directAccessGrantsEnabled": false}' "$AT")
            [ "$CODE" = "204" ] || [ "$CODE" = "200" ] && { echo "[cleanup] ROPC disabled (HTTP $CODE)"; return 0; }
            sleep 2
        done
    fi
    echo "FAILED to disable ROPC — DISABLE MANUALLY: $EVAL_KC_URL/admin/realms/$EVAL_KC_REALM_S/clients/$CLIENT_UUID" >&2
    exit 9
}
trap cleanup EXIT INT TERM

CLIENT_UUID=$(curl -sk -m 30 -H @"$HDR" \
    "$EVAL_KC_URL/admin/realms/$EVAL_KC_REALM_S/clients?clientId=$EVAL_KC_CLIENT_ID_S" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["id"])')
CODE=$(kc_put_json "$EVAL_KC_URL/admin/realms/$EVAL_KC_REALM_S/clients/$CLIENT_UUID" \
    '{"directAccessGrantsEnabled": true}' "$ADMIN_TOKEN")
if [ "$CODE" != "204" ] && [ "$CODE" != "200" ]; then
    echo "[setup] ROPC enable FAILED (HTTP $CODE) — aborting before a doomed run" >&2; exit 8
fi
echo "[setup] ROPC enabled on $EVAL_KC_CLIENT_ID_S (uuid=$CLIENT_UUID, HTTP $CODE)"

echo "[run] container=$CHATQNA_CONTAINER mode=$EVAL_MODE"
date
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
python3 "$SCRIPT_DIR/../eval/run_eval.py" "$EVAL_MODE" "$GOLD" "$OUT"
RC=$?
date
echo "[run] run_eval exit=$RC (0 clean / 3 degraded / 4 empty)"
exit $RC
```

- [ ] **Step 2: `bash -n` syntax check** — Run: `bash -n scripts/run_anchor_with_cleanup.sh`. Expected: no output.
- [ ] **Step 3: shellcheck if available** (`shellcheck -S warning`), fix findings.
- [ ] **Step 4: Commit** `refactor(eval): wrapper = thin verified-ROPC entry; driver owns orchestration`

### Task B5: Retirement proof

- [ ] `git grep -rn run_eval_chunked` → **0 hits** in repo (docs still mentioning it updated in MR-D; any hit blocks this MR).
- [ ] Full pytest suite green. Push `feat/eval-b`, MR → `feat/eval-toolchain`, CI green, merge.

### Task G1: LIVE SMOKE GATE (blocks MR-C)

On the swarm node, from the integration worktree (rsync the branch):

```bash
rsync -az tests/rag-benchmarks/eval/ <host>:/tmp/rag-eval/eval/
rsync -az tests/rag-benchmarks/scripts/ <host>:/tmp/rag-eval/scripts/
# 10-query smoke gold:
python3 - <<'PY'
import json
g = json.load(open('/tmp/rag-eval/gold_dataset_new.json'))
g['entries'] = g['entries'][:10]
json.dump(g, open('/tmp/rag-eval/gold_smoke.json','w'))
PY
ssh <host> 'EVAL_MODE=dump-tuples bash /tmp/rag-eval/scripts/run_anchor_with_cleanup.sh /tmp/rag-eval/gold_smoke.json /tmp/rag-eval/tuples_smoke.json'
```

**Pass criteria:** exit 0; `tuples_smoke.json` has 10 tuples; `.meta.json` shows `n_http_errors=0`; `ps -ef | grep -E "password|Bearer"` during the run shows **no secret** (spot-check documented in the MR). **A repeat of the 2026-10-06 incident (n=0, exit 0) must be impossible.** Record output in the MR description.

---

# MR-C — RAGAS Pins + Artifacts

Branch `feat/eval-c`. **Prerequisite: Task G1 passed.**

### Task C1: `eval/requirements.txt`

**Files:** Create `tests/rag-benchmarks/eval/requirements.txt`

- [ ] **Step 1: Derive pins from the live-validated venv** (the host copy is the source of truth — fetch before writing):

```bash
ssh <host> '~/.venv/ragas/bin/python -c "import ragas,langchain_openai,langchain_community,openai,httpx; print(ragas.__version__, langchain_openai.__version__, langchain_community.__version__, openai.__version__, httpx.__version__)"' || true
# local venv as fallback:
~/.venv/ragas/bin/python -c "import ragas,langchain_openai,langchain_community,openai,httpx,langchain_core; print(...)"
```

- [ ] **Step 2: Write the file** with the fetched versions in this shape (fill EXACT printed versions; do not guess):

```
# Phase 4 (run_ragas_eval.py) judge-stack pins — validated 2026-10-06 on el-salvador.
# Install: python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
ragas==<X>
langchain-openai==<X>
langchain-community==<X>
langchain-core==<X>
openai==<X>
httpx==<X>
```

- [ ] **Step 3: Fresh-venv smoke** — `python3 -m venv /tmp/rv && /tmp/rv/bin/pip install -r requirements.txt && /tmp/rv/bin/python -c "import run_ragas_eval"` (run from `eval/`; import must succeed WITHOUT the host patch).
- [ ] **Step 4: Commit** `chore(eval): pin Phase-4 judge stack`

### Task C2: `run_ragas_eval.py` — in-repo compat stub + guards

**Files:** Modify `tests/rag-benchmarks/eval/run_ragas_eval.py`

- [ ] **Step 1: Add the compat stub** directly after the stdlib imports (before ANY ragas import — including function-level ones):

```python
# ragas (<0.5) eagerly imports langchain_community.chat_models.vertexai, removed
# in langchain-community 0.4.x. Stub it when absent so the import chain survives.
try:  # pragma: no cover - depends on installed versions
    from langchain_community.chat_models import vertexai  # noqa: F401
except ImportError:
    import sys as _sys
    import types as _types

    _vertexai = _types.ModuleType("langchain_community.chat_models.vertexai")

    class _ChatVertexAI:  # noqa: D401 - stub for ragas.llms.base
        pass

    _vertexai.ChatVertexAI = _ChatVertexAI
    _sys.modules["langchain_community.chat.models.vertexai"] = _vertexai
```

- [ ] **Step 2: Guards** — in `main()`, first lines:

```python
    tuples = json.load(open(sys.argv[1]))
    if not tuples:
        sys.exit("EXIT 2: empty eval_tuples.json — refusing to judge (Phase 3 produced nothing)")
```

In `_build_embeddings()`, when returning `None`: `print("WARNING: EVAL_EMBED_MODEL unset — answer_relevancy will be dropped", file=sys.stderr)`. Add `JUDGE_MAX_TOKENS = int(os.getenv("EVAL_JUDGE_MAX_TOKENS", "0"))` and pass `**({"max_tokens": JUDGE_MAX_TOKENS} if JUDGE_MAX_TOKENS else {})` into both `ChatOpenAI(...)` constructions.

- [ ] **Step 3: Smoke** — `python3 -c "import run_ragas_eval"` in the C1 fresh venv + existing venv. **Step 4: Commit** `fix(eval): ragas compat stub in-repo + input guards + max_tokens knob`

### Task C3: Gold v4 + report recipe + .gitignore

**Files:**
- Create: `tests/rag-benchmarks/eval/gold_datasets/el-salvador/gold_dataset_el_salvador.matched.v4.json` (fetch from `<host>:/tmp/rag-eval/gold_dataset.matched.v4.json`)
- Modify: `tests/rag-benchmarks/eval/eval-reports/2026-09-30-el-salvador-rag-comprehensive.md` §10
- Modify: `tests/rag-benchmarks/eval/.gitignore`

- [ ] **Step 1:** `scp <host>:/tmp/rag-eval/gold_dataset.matched.v4.json tests/rag-benchmarks/eval/gold_datasets/el-salvador/gold_dataset_el_salvador.matched.v4.json`
- [ ] **Step 2:** Rewrite report §10 to reference ONLY committed artifacts + the wrapper flow; replace `user@ip` with `<user>@<host>`; delete the literal password and the `/tmp/bearer_token.txt` refresher mention; delete "modified locally on .102" note.
- [ ] **Step 3:** Append to `eval/.gitignore` (run outputs ONLY — never gold):

```
results*.json
anchor_*.json
eval_anchor_*.json
*_calibration.json
ragas_results.json
report_[AB].json
*.bak.json
*.json.tmp
*.done.jsonl
*.meta.json
```

- [ ] **Step 4:** `git status` clean after a simulated local run pattern. **Commit** `chore(eval): commit gold v4; report recipe uses committed artifacts`

### Task C4: `dump_chunks.py` defaults + wrapper dead var

**Files:** Modify `eval/dump_chunks.py` (defaults), `scripts/run_anchor_with_cleanup.sh` (already clean in B4 rewrite — verify no `TEXT_FIELD` remains anywhere: `git grep TEXT_FIELD tests/rag-benchmarks/scripts/` → 0).

- [ ] Default `ARANGO_TEXT_FIELD` → `chunk_text`, `GRAPH_SOURCE` → `GRAPH_TEST_SOURCE`; after loading, if no rows: re-query with `text` and `print("WARNING: empty on chunk_text — set ARANGO_TEXT_FIELD=text for CONTEXTUAL_RETRIEVAL_ENABLED=false deployments", file=sys.stderr)`. Commit: `fix(eval): dump_chunks defaults aligned with eval-time identity`.

### Task C5: `match_gold_chunks.py` hardening

- [ ] Atomic write (tmp + `os.replace`) for ALL modes; in-place modes write a one-generation `<name>.bak.json` first. Delete the dead `_WHITESPACE` regex constant and the now-unused `import re` (verify with grep). Tests stay green. Commit: `fix(eval): atomic + backed-up gold writes; drop dead code`.

- [ ] **MR-C close-out:** suite green, push, MR → `feat/eval-toolchain`, CI green, merge.

---

# MR-D — Cleanup + Docs

Branch `feat/eval-d`.

### Task D1: Delete the legacy benchmark suite

**Files:** Delete `benchmark_config.py`, `benchmark_ingestion.py`, `benchmark_query.py`, `benchmark_rag_accuracy.py`, `benchmark_rag_performance.py`, `run_benchmarks.sh` (all under `tests/rag-benchmarks/`). Modify `site/content/en/docs/reference/source-tree-analysis.md` (~lines 768-772 — locate the benchmark block with `grep -n "benchmark_" site/content/en/docs/reference/source-tree-analysis.md`).

- [ ] `git rm` the six files; update the site doc (remove/mark superseded); MR description states: latency/load testing venue = OTel trace waterfall; offer `archive/` alternative if the team objects. `git grep -n "benchmark_" | grep -v site/` → 0. Commit: `chore(eval): remove dead legacy benchmark suite (2543 lines, cannot run)`.

### Task D2: `eval/harness.py` + adoption

**Files:** Create `eval/harness.py`; modify `run_eval.py`, `capture_baseline.py`.

**Interfaces:**
- `docker_exec(container: str, cmd: str, timeout: float = 120) -> str` (raises `HarnessError` with stderr prefix — same contract as `_docker_exec`)
- `read_json(path) -> Any` / `write_json(path, obj, *, indent=2, ensure_ascii=False) -> None` (utf-8, atomic)

- [ ] TDD: `test_harness.py` — write_json atomicity (no `.tmp` left, content correct, tmp_path), read_json utf-8 round-trip with accents, docker_exec error path (mock `subprocess.run` rc=1 → HarnessError). Then: `run_eval.py` imports both (keep `_docker_exec = harness.docker_exec` alias so existing tests pass); `capture_baseline.py` `_docker_exec` replaced. **Mandatory:** add `harness.py` and `keycloak.py` to `EVAL_IDENTITY_FILES` in `capture_baseline.py` and to the rsync recipe in `eval/CLAUDE.md`. Commit: `refactor(eval): shared harness module (docker_exec + atomic JSON IO)`.

### Task D3: Single Arango client

- [ ] Add to `arango.py`: `def source_chunks(graph_source: str, text_field: str, conn: dict | None = None) -> list[dict]` returning `[{"key","text"}]` (uses `cursor` with `conn` overrides). `run_eval.py`: `build_hash_to_text` + `build_key_to_content_hash` collapse to one `_fetch_source()` call per run (the AQL pair was byte-identical). `match_gold_chunks.py`: delete its private `arango_query`, import `cursor`, pass its CLI `--arango-*` values as overrides; keep flags. Tests green. Commit: `refactor(eval): one Arango client — arango.source_chunks()`.

### Task D4: calibrate replay dedup (test first)

- [ ] **Step 1:** `eval/test_calibrate.py` — build a synthetic 2-query report dict with hand-computed `adaptive_breakdown` (3 candidates, known utilities/token_counts); hand-verify ONE (factor, threshold) cell's replay recall in a comment; assert `replay_query` and `score_combo` agree on it. **Step 2:** run → FAIL (they disagree on unmappable rows today). **Step 3:** extract the shared kernel `_selected_hashes(breakdown, factor, threshold, confusion)` used by both, preserving each path's unmappable semantics (skip vs 0.0); delete the dead `tolerance` param; fix the "20%" prose → 30%; replace hand-rolled `_median` with `statistics.median`. **Step 4:** green + `--check-baseline` replay on the committed T13b artifact unchanged. Commit: `refactor(eval): single adaptive-replay kernel, test-pinned`.

### Task D5: `eval/RUNBOOK.md`

- [ ] Write the runbook with these sections (real commands, referencing the FINAL post-MR-B shapes): Phase 0 pre-flight (CI job, observability check, container resolution) · Phase 1 xlsx_to_gold (incl. `--passage-separator '@@@@@'` sentinel, internal blank-lines preserved) · Phase 2 match_gold_chunks · Phase 3 wrapper-driven dump-tuples + post-run assertions (`len(tuples) == n_entries`, exit codes, `.meta.json`) · Phase 4 run_ragas_eval (venv from requirements.txt, judge/embed env) · Phase 5 analysis pointers · **When things go wrong:** resume from `.done.jsonl`, salvage partial outputs, ROPC-left-enabled verification curl, chatqna warm-up wait, `ps` secrets spot-check · Host-artifact inventory (`/tmp/rag-eval` layout, ragas venv) + explicit "run_eval_chunked.py is retired". Commit: `docs(eval): RUNBOOK — end-to-end phases + failure recovery`.

### Task D6: Docs truth pass

- [ ] `eval/README.md` → 20-line pointer to `eval/CLAUDE.md` + the two-path table. `grep -nE "\-\-mode|NO OIDC|BEARER_TOKEN|ambiguous|min_rank" tests/rag-benchmarks/ -r --include="*.md"` → fix every hit (README `--mode` syntax, CLAUDE.md `BEARER_TOKEN`→`E2E_BEARER_TOKEN`, `match_status: ambiguous`→actual set incl. `skipped_short`, drop `min_rank`, delete NO-OIDC claims + manual slicing heredocs in root CLAUDE.md, `TRACE_FLUSH_WAIT` default 5). Fix `run_eval.py` docstring lines 17-18 ("NO OIDC" → "OIDC via wrapper/refresh"). Scripts tables gain `keycloak.py` + `harness.py`. Commit: `docs(eval): truth pass — one operational source, stale claims removed`.

### Task G2: LIVE FULL GATE (blocks the final MR)

- [ ] From the integration worktree on `.102`: full 90-query wrapper-driven dump-tuples (exit 0, 90 tuples, `.meta.json` clean) → Phase 2 match on the new gold → RAGAS full run (judge + embed endpoints) → anchor run green. Record aggregate numbers in the final MR. **Then:** MR `feat/eval-toolchain` → `main` (CI + gate evidence in description) → merge → rebase `release/el-salvador` onto main (user lifts/restores protection) → cleanup worktrees + child branches.

---

## Self-Review (done)

- **Spec coverage:** P0-1→A2, P0-2→A3, P0-3→B2, P0-4→A4, P0-5/7/8/9→B4, P0-6→B1+B3, P0-10→C1+C2, P0-11→C3, P0-12→B3+capture_baseline static-path preserved (refresh hook used when env set; documented in D5), P0-13→C4, P1-1→D1, P1-2/3→D2/D3, P1-4→D4, P1-5→C5, P1-6 (ragas cache) **deferred post-overhaul** (tail, optional), P1-7→A5, P1-8 (pipelining) **deferred** (perf tail), P2-1→D5, P2-2→D6, P2-3→A1. Deferred items noted as such — not silently dropped.
- **Placeholders:** C1 requirements versions are fetched-not-guessed by explicit step (the only intentional "fill from live source" — the fetch command is the content). No TBDs elsewhere.
- **Type consistency:** `drive_query -> (float, str, int)` used by A2/B2/B3; `cursor(..., *, url, db, user, password, batch_size, timeout)` matches D3's `conn` overrides; `keycloak.fetch_realm_token(kc_url, realm, client_id, username, password)` matches B3 call sites.
