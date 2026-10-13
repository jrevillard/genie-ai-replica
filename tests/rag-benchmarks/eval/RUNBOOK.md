# Eval Runbook

End-to-end recipe for a retrieval + semantic eval against a live GENIE.AI
deployment. Phases run in order; each phase has explicit preconditions and a
verification gate. Sections after the host-artifact inventory use
`<user>@<host>`, `<stack>`, `/opt/<stack>/.env`, `<DB>`, `<REALM>` style
placeholders everywhere — substitute your stack name, hostname, and
database name at copy/paste time.

This runbook describes the FINAL post-MR-B pipeline:

```
Phase 0  pre-flight          (deploy health, env capture, container resolution)
Phase 1  xlsx_to_gold.py     (xlsx → gold_dataset.json skeleton)
Phase 2  match_gold_chunks.py (preview → content_hash via ArangoDB)
Phase 3  wrapper + run_eval.py (live chatqna → anchor OR dump-tuples)
Phase 4  run_ragas_eval.py   (semantic scoring with external LLM judge)
Phase 5  analysis + calibrate.py (offline parameter tuning, optional)
```

The wrapper at `../scripts/run_anchor_with_cleanup.sh` is the **only** entry
point for Phases 3 against a production-deployed chatqna. Calling
`run_eval.py` directly returns 401 on every query (chatqna enforces OIDC).

> `run_eval_chunked.py` was retired in MR-B. The wrapper drives
> `run_eval.py` directly. Do not recreate the chunked runner.

## Host-artifact inventory

The orchestrator lives on the **swarm node** that owns the deployment.
Standard layout (rsynced from the repo before each cycle):

```
/tmp/rag-eval/
├── scripts/
│   └── run_anchor_with_cleanup.sh      # rsynced from tests/rag-benchmarks/scripts/
├── gold/
│   ├── <corpus>.xlsx                   # Phase 0 input
│   ├── <corpus>.gold.json              # Phase 1 output (preview only)
│   └── <corpus>.gold.matched.json      # Phase 2 output (content_hash filled)
├── reports/
│   ├── eval_anchor_<TAG>.json          # Phase 3 anchor output (+ .meta.json for dump-tuples)
│   ├── eval_tuples_<TAG>.json          # Phase 3 dump-tuples output (→ Phase 4 input)
│   ├── eval_tuples_<TAG>.meta.json     # Phase 3 dump-tuples sidecar
│   └── ragas_report_<TAG>.json         # Phase 4 output
├── calibration/
│   └── eval_anchor_<TAG>_calibration.json  # Phase 5 output (offline sweep)
└── .venv/                              # Phase 4 ragas venv (see requirements.txt)
```

The eval source lives in the repo at
`tests/rag-benchmarks/eval/{run_eval.py,xlsx_to_gold.py,match_gold_chunks.py,run_ragas_eval.py,calibrate.py}`
plus the wrapper `tests/rag-benchmarks/scripts/run_anchor_with_cleanup.sh`.
Scripts are rsynced into `/tmp/rag-eval/` on the swarm node before each cycle
to avoid pulling the full repo onto the deployment host.

---

## Phase 0 — Pre-flight

Confirm the deployment is healthy and capture the live reranker parameters
**before** driving any query. The wrapper does not read these — they are
needed only by Phase 5's `calibrate.py --check-baseline`.

```bash
# 0.1 Confirm OIDC, ArangoDB and chatqna are reachable
ssh <user>@<host> '
  curl -sk -o /dev/null -w "%{http_code}\n" "<KEYCLOAK_URL>/realms/<REALM>/.well-known/openid-configuration"
  docker service ls --format "{{.Name}}" | grep -E "chatqna|retriever|victoriatraces|arangodb"
'

# 0.2 Read the live reranker parameters from the deployed service.
#     These are needed by Phase 5 (calibrate.py --baseline-factor/--baseline-threshold/--baseline-confusion).
#     Capture NOW so the offline replay targets the cell that was live when
#     the report was captured, not a stale historical default.
#     Resolve service names on your stack via `docker service ls`. The
#     GENIE.AI product defaults are listed in the "Wrapper / argparse
#     defaults" table in Phase 3 below.
ssh <user>@<host> '
  for svc in <chatqna-service> <retriever-service>; do
    docker service logs --raw $(docker service ls -q -f name=$svc) --since 5m 2>/dev/null \
      | grep -oE "(CONTEXT_DECAY_FACTOR|MIN_VALUE_THRESHOLD|RERANKING_STRATEGY|RERANKER_TOP_N|RETRIEVER_ARANGO_SCORE_THRESHOLD)=[^ ]+" \
      | sort -u
  done
'
# Record: CONTEXT_DECAY_FACTOR, MIN_VALUE_THRESHOLD, confusion_formula (current | simple(1-s) | bounded_rel | rank_i/n).
# Confirm the deployed formula against the reranker code at deploy time.

# 0.3 Confirm chatqna is warm — first query after a redeploy can take 60+ s
#     (vLLM model load). Probe with a throwaway query before the real run.
ssh <user>@<host> '
  CN=$(docker ps --format "{{.Names}}" | grep <chatqna-container> | head -1)
  echo "chatqna container: $CN"
  docker exec "$CN" sh -c "
      t0=\$(date +%s)
      curl -s -m 60 -X POST http://localhost:8888/v1/chatqna \
        -H \"Content-Type: application/json\" \
        -d '{\"messages\":[{\"role\":\"user\",\"content\":\"warm-up\"}],\"stream\":false}' \
        -o /dev/null -w \"HTTP %{http_code} in %{time_total}s\\n\"
      echo elapsed=\$((\$(date +%s)-t0))s
    "
'
# If elapsed > 60 s: wait. First query after `docker service update` may
# miss reranker_selection spans (OTel SDK re-init) — Phase 3's
# n_missed_traces will rise. Re-warm: send 2-3 throwaway queries.

# 0.4 Verify the wrapper + scripts are present
ssh <user>@<host> 'ls -la /tmp/rag-eval/scripts/run_anchor_with_cleanup.sh'
```

**Gate**: chatqna container reachable, live reranker params captured,
warm-up query returned in < 60 s with HTTP 200.

---

## Phase 1 — `xlsx_to_gold.py` (xlsx → gold skeleton)

Convert the benchmark xlsx into a gold dataset skeleton. The skeleton holds
`preview` text only — `content_hash` and `chunk_key` are filled in Phase 2
after the corpus is ingested.

```bash
# 1.1 Generate the gold skeleton. Replace <corpus.xlsx> with your file.
ssh <user>@<host> '
  python3 /tmp/rag-eval/xlsx_to_gold.py \
    --input-xlsx  /tmp/rag-eval/gold/<corpus>.xlsx \
    --output-json /tmp/rag-eval/gold/<corpus>.gold.json \
    --sheet-name "Test Dataset" \
    --id-prefix   "q-"
'

# 1.2 Sanity-check the skeleton
ssh <user>@<host> '
  python3 -c "
    import json
    d = json.load(open(\"/tmp/rag-eval/gold/<corpus>.gold.json\"))
    print(\"n_entries:\", d[\"n_entries\"], \"skipped:\", d[\"n_skipped_no_query\"])
    for e in d[\"entries\"][:3]:
        print(e[\"id\"], e[\"query\"][:60], \"chunks=\", len(e[\"expected_chunks\"]))
  "
'
```

### When the passages cell contains internal blank lines

The default splitter is the regex `\n\s*\n` (raw form `r"\n\s*\n"` in
`xlsx_to_gold.py` — one or more blank lines). If a passages cell contains
`label:\nvalue` style data, the internal newline will falsely split a
single passage. Override with a literal sentinel that the gold author
places BETWEEN passages (blank lines INSIDE a passage are preserved
verbatim):

```bash
ssh <user>@<host> '
  python3 /tmp/rag-eval/xlsx_to_gold.py \
    --input-xlsx  /tmp/rag-eval/gold/<corpus>.xlsx \
    --output-json /tmp/rag-eval/gold/<corpus>.gold.json \
    --passage-separator "@@@@@"
'
# Example cell with sentinel:
#   "Para1 @@@@@ Para2 @@@@@ Para3"
# Blank lines INSIDE a passage (e.g. a multi-line list) survive intact.
```

**Gate**: `n_entries > 0`, every entry has `query` non-empty, every
`expected_chunks[].preview` is the expected preview (spot-check 3 entries).

---

## Phase 2 — `match_gold_chunks.py` (preview → content_hash)

For each `preview`, find the ArangoDB chunk that holds it (substring +
40-char window match). Multi-match = chunker split the verbatim preview
across N chunks — all N become gold and share a `passage_id` so the eval
can enforce passage-level recall.

```bash
# 2.1 Run the match against the live ArangoDB.
#     --arango-password comes from the deployment .env; prefer env var to
#     keep it off the CLI.
ssh <user>@<host> '
  source <(grep -E "^ARANGO_(URL|USER|PASSWORD|DB)=" /opt/<stack>/.env | sed "s/^/export /")
  python3 /tmp/rag-eval/match_gold_chunks.py \
    --gold-dataset /tmp/rag-eval/gold/<corpus>.gold.json \
    --graph-source  <GRAPH_SOURCE_COLLECTION> \
    --arango-db     <DB> \
    --arango-url    "$ARANGO_URL" \
    --arango-user   "$ARANGO_USER" \
    --arango-password "$ARANGO_PASSWORD" \
    --mode          in-place
'

# 2.2 Inspect the match stats
ssh <user>@<host> '
  python3 -c "
    import json
    d = json.load(open(\"/tmp/rag-eval/gold/<corpus>.gold.json\"))
    s = d[\"match_run\"][\"stats\"]
    print(s)
    # Heuristic sanity: unresolved > 30% usually means a corpus/GRAPH_SOURCE mismatch.
  "
'
```

The script writes a one-generation backup `<corpus>.gold.json.bak.json`
before mutating in place (only when `--output` is NOT set). Recover with
`mv <corpus>.gold.json.bak.json <corpus>.gold.json`.

**Possible match_status values** (each expected_chunk carries one):

| value | meaning |
|---|---|
| `resolved` | preview matched exactly one chunk |
| `resolved_split` | preview matched multiple chunks (chunker split it; passage_id shared) |
| `skipped_short` | preview shorter than `--min-preview-len` (default 20 chars) |
| `unresolved` | no chunk held the preview — re-check the corpus or the preview text |

**Gate**: unresolved < ~30% of previews. Higher usually = wrong
`--graph-source` collection or the corpus was re-ingested with different
chunker params.

---

## Phase 3 — Wrapper-driven eval (live chatqna)

The wrapper at `/tmp/rag-eval/scripts/run_anchor_with_cleanup.sh` is the
canonical entry point. It:

1. Resolves secrets from the deployment `.env` (or `EVAL_DEPLOY_ENV`).
2. Enables `directAccessGrantsEnabled=true` on the OIDC client (ROPC).
3. Runs `run_eval.py` (anchor OR dump-tuples mode) via `docker exec`.
4. **Proves** the ROPC revert on exit (signal-safe `trap` on EXIT/INT/TERM,
   re-auth inside the trap, 3 retries, `exit 9` on failure).

### Wrapper / argparse defaults (override via env)

The wrapper and `run_eval.py` resolve a handful of names dynamically; the
table below shows the GENIE.AI product defaults (stable across
deployments of the same product). Operator commands in the surrounding
sections use `<placeholder>` forms — leave them unset to take the
default, or set them explicitly when your stack renames the service.

| Knob | Default | Set via | Source |
|---|---|---|---|
| `CHATQNA_CONTAINER` | `chatqna-xeon-backend-server` (regex match) | `export CHATQNA_CONTAINER=...` | scripts/run_anchor_with_cleanup.sh (CHATQNA_CONTAINER auto-resolve) |
| `VICTORIATRACES_SVC` | `<stack>_victoriatraces` (`docker service ls` grep) | `export VICTORIATRACES_SVC=...` | scripts/run_anchor_with_cleanup.sh (VICTORIATRACES_SVC auto-resolve) |
| `CHATQNA_SERVICE_NAME` | `genieai-chatqna` (OTel span filter) | `export CHATQNA_SERVICE_NAME=...` | run_eval.py module-level constant (CHATQNA_SERVICE_NAME) |
| `GRAPH_SOURCE` | `GRAPH_TEST_SOURCE` | `export GRAPH_SOURCE=...` | run_eval.py module-level constant (GRAPH_SOURCE) |
| `CHATQNA_URL` | `http://localhost:8888/v1/chatqna` | `export CHATQNA_URL=...` | run_eval.py module-level constant (CHATQNA_URL) |
| `EVAL_KC_REALM` | `genie` | `export EVAL_KC_REALM=...` | scripts/run_anchor_with_cleanup.sh |
| `EVAL_KC_CLIENT_ID` | `genie-app` | `export EVAL_KC_CLIENT_ID=...` | scripts/run_anchor_with_cleanup.sh |
| `EVAL_KC_USER` | `genie-admin` | `export EVAL_KC_USER=...` | scripts/run_anchor_with_cleanup.sh |
| `EVAL_DEPLOY_ENV` | _none_ (no default — pass explicitly) | `export EVAL_DEPLOY_ENV=/opt/<stack>/.env` | scripts/run_anchor_with_cleanup.sh (EVAL_DEPLOY_ENV check) |

### Two modes

| Mode | Driver argv | Output | Use |
|---|---|---|---|
| `anchor` (default) | `anchor <gold> <out>` | `eval_report.json` (+ `.done.jsonl`) | Deterministic retrieval quality — no LLM |
| `dump-tuples` | `dump-tuples <gold> <out>` | `eval_tuples.json` (+ `.meta.json`) | Feed to `run_ragas_eval.py` for semantic scoring |

### 3a. Anchor (deterministic retrieval quality)

```bash
ssh <user>@<host> '
  EVAL_DEPLOY_ENV=/opt/<stack>/.env \
    bash /tmp/rag-eval/scripts/run_anchor_with_cleanup.sh \
      /tmp/rag-eval/gold/<corpus>.gold.matched.json \
      /tmp/rag-eval/reports/eval_anchor_<TAG>.json
'
# Wrapper exit codes: 0 clean / 2 usage / 3 degraded / 4 zero scored rows
#                     / 8 ROPC enable failed / 9 ROPC revert failed
```

### 3b. Dump-tuples (semantic eval feed)

```bash
ssh <user>@<host> '
  EVAL_MODE=dump-tuples \
  EVAL_DEPLOY_ENV=/opt/<stack>/.env \
    bash /tmp/rag-eval/scripts/run_anchor_with_cleanup.sh \
      /tmp/rag-eval/gold/<corpus>.gold.matched.json \
      /tmp/rag-eval/reports/eval_tuples_<TAG>.json
'
```

### Post-run assertions (verify gate)

```bash
# 3.1 Exit code is 0 (clean run) OR 3 (degraded) OR 4 (no scored rows).
#     0 is required for a trustworthy A/B; 3 is logged the margin in the report.
echo "wrapper exit: $?"

# 3.2 Anchor: every entry produced exactly one row in per_query (1-row-per-id invariant).
ssh <user>@<host> '
  python3 -c "
    import json
    r = json.load(open(\"/tmp/rag-eval/reports/eval_anchor_<TAG>.json\"))
    n_entries = len({e[\"id\"] for e in json.load(open(\"/tmp/rag-eval/gold/<corpus>.gold.matched.json\"))[\"entries\"]})
    rows       = r[\"per_query\"]
    ids        = [row[\"id\"] for row in rows]
    assert len(rows) == n_entries, f\"len(rows)={len(rows)} != n_entries={n_entries}\"
    assert len(ids) == len(set(ids)), f\"duplicate ids in per_query: {len(ids)-len(set(ids))}\"
    print(\"OK n=\", len(rows), \"missed=\", r[\"n_missed_traces\"], \"skipped=\", r[\"skipped_entries\"])
  "
'

# 3.3 Anchor: sidecar .done.jsonl covers the same id set as per_query
ssh <user>@<host> '
  python3 -c "
    import json
    r = json.load(open(\"/tmp/rag-eval/reports/eval_anchor_<TAG>.json\"))
    sidecar = {l.strip() for l in open(\"/tmp/rag-eval/reports/eval_anchor_<TAG>.json.done.jsonl\") if l.strip()}
    pq      = {t[\"id\"] for t in r[\"per_query\"]}
    assert sidecar == pq, f\"sidecar != per_query: sidecar-only={sidecar-pq} pq-only={pq-sidecar}\"
    print(\"OK sidecar == per_query (resumable)\")
  "
'

# 3.4 Dump-tuples: .meta.json n_http_errors / n_missed_traces / n_skipped clean
ssh <user>@<host> '
  python3 -c "
    import json
    m = json.load(open(\"/tmp/rag-eval/reports/eval_tuples_<TAG>.meta.json\"))
    print(\"n_entries=\", m[\"n_entries\"], \"n_tuples=\", m[\"n_tuples\"],
          \"n_http_errors=\", m[\"n_http_errors\"], \"n_missed_traces=\", m[\"n_missed_traces\"],
          \"skipped=\", len(m[\"skipped\"]))
    assert m[\"n_tuples\"] == m[\"n_entries\"], \"missing tuples — partial run\"
    assert m[\"n_http_errors\"] == 0,         \"chatqna returned non-2xx (auth? rate-limit?)\"
    assert m[\"n_missed_traces\"] <= 2,       \"trace fetch lost spans — check observability\"
  "
'
```

**Gate**: all three assertions pass. If `.done.jsonl` differs from
`per_query`, the run was interrupted mid-write — see "When things go wrong"
below.

### Resume

Rerun the **same** command. The driver reads `<out>.done.jsonl` and the
output file itself, takes the union of done ids, and skips them. Error rows
(`trace_found: false` with an `error` field) are deliberately EXCLUDED from
the skip-set — they retry on resume.

Override cases:

- `EVAL_FRESH=1` — discard the sidecar + output, start from zero. Use after
  a corrupted resume or when re-running a changed gold against an old report.
- `EVAL_MAX_MISSED_TRACES=N` — accept up to N missed traces without rc 3
  (default 2).
- `EVAL_ALLOW_PARTIAL=1` — accept a partial run (skipped entries or unmapped
  chunk keys) without rc 3.
- `EVAL_RETRY_BACKOFF=S` — per-entry retry backoff (default 5s).
- `TRACE_FLUSH_WAIT=S` — wait between VictoriaTraces polls (default 5s).
- `TRACE_FETCH_TIMEOUT=S` — VictoriaTraces poll deadline (default 120s).

### In-run token refresh

The wrapper exports `EVAL_KC_URL` (from `KEYCLOAK_URL`) and
`EVAL_KC_PASSWORD` (from `GENIE_ADMIN_PASSWORD`), and takes realm / client
/ user defaults from the "Wrapper / argparse defaults" table above.
When all are set, `run_eval.py` auto-refreshes the realm bearer every
240 s (60 s margin) and immediately on a 401/403 from chatqna. Operators
can override the defaults:

```bash
ssh <user>@<host> '
  EVAL_KC_REALM=<REALM> \
  EVAL_KC_CLIENT_ID=<CLIENT_ID> \
  EVAL_KC_USER=<ROPC_USER> \
  EVAL_DEPLOY_ENV=/opt/<stack>/.env \
    bash /tmp/rag-eval/scripts/run_anchor_with_cleanup.sh \
      /tmp/rag-eval/gold/<corpus>.gold.matched.json \
      /tmp/rag-eval/reports/eval_anchor_<TAG>.json
'
```

When `EVAL_KC_PASSWORD` is unset (e.g. legacy direct-token flows), the
driver falls back to a static `E2E_BEARER_TOKEN` (one-shot; no refresh).

### Container resolution

The wrapper resolves two service names dynamically (defaults in the
"Wrapper / argparse defaults" table above). Override either via env if
the auto-detect guesses wrong:

```bash
ssh <user>@<host> '
  CHATQNA_CONTAINER=<chatqna-container> \
  VICTORIATRACES_SVC=<victoriatraces-service> \
    bash /tmp/rag-eval/scripts/run_anchor_with_cleanup.sh ...
'
```

`GRAPH_SOURCE` and `CHATQNA_SERVICE_NAME` (both with GENIE.AI defaults —
see the table) can also be overridden via env. See the module-level
constants at the top of `run_eval.py`
(`CHATQNA_CONTAINER`, `VICTORIATRACES_SVC`, `CHATQNA_URL`,
`CHATQNA_SERVICE_NAME`, `GRAPH_SOURCE`, `TEXT_FIELD`) for the full
knob list.

> **Multi-stack nodes:** when two stacks run on the same swarm node
> (e.g. dev + prod, or el-salvador + a parallel eval stack),
> `VICTORIATRACES_SVC` auto-resolution takes the first `docker service ls`
> match and can silently target the wrong stack. Pin both
> `VICTORIATRACES_SVC` and `CHATQNA_CONTAINER` explicitly via env on
> multi-stack hosts.

**Gate**: `n_tuples == n_entries` (dump-tuples) or `len(per_query) ==
n_entries` (anchor). Both `n_missed_traces` and `n_http_errors` are 0 (or
within the documented tolerances).

---

## Phase 4 — `run_ragas_eval.py` (semantic scoring)

Judges each `(question, contexts, answer, reference_answer)` tuple with
Ragas metrics: faithfulness, context_precision, context_recall,
answer_relevancy (only when `EVAL_EMBED_MODEL` is set). The judge is
external and OpenAI-compatible — sovereign; only the tuples reach the judge.

### 4.1 Build the venv (first time per host)

```bash
ssh <user>@<host> '
  uv venv /tmp/rag-eval/.venv
  /tmp/rag-eval/.venv/bin/pip install -r /tmp/rag-eval/requirements.txt
'
# requirements.txt pins (validated 2026-10-06):
#   ragas==0.4.3
#   langchain-openai==1.6.7
#   langchain-community==0.4.2
#   langchain-core==1.6.6
#   openai==3.3.0
#   httpx==0.28.1
```

### 4.2 Run the judge

```bash
ssh <user>@<host> '
  export EVAL_JUDGE_BASE_URL=<JUDGE_OPENAI_BASE>     # e.g. https://<judge-host>/v1
  export EVAL_JUDGE_API_KEY=<JUDGE_API_KEY>          # bearer for the judge
  export EVAL_JUDGE_MODEL=<JUDGE_MODEL_ID>
  export EVAL_JUDGE_TEMPERATURE=0
  # Embeddings are OPTIONAL — answer_relevancy is dropped when EMBED_MODEL is unset.
  export EVAL_EMBED_BASE_URL=<EMBED_OPENAI_BASE>     # defaults to JUDGE_BASE_URL
  export EVAL_EMBED_API_KEY=<EMBED_API_KEY>          # defaults to JUDGE_API_KEY
  export EVAL_EMBED_MODEL=<EMBED_MODEL_ID>
  /tmp/rag-eval/.venv/bin/python /tmp/rag-eval/run_ragas_eval.py \
    /tmp/rag-eval/reports/eval_tuples_<TAG>.json \
    /tmp/rag-eval/reports/ragas_report_<TAG>.json
'
```

Ragas reads the env vars exactly as listed — see
`run_ragas_eval.py:47-57`. SSL verify is disabled on BOTH the sync and
async OpenAI clients (sovereign vLLM fronts nginx with a self-signed cert).

**Verify no response-cache before trusting n>1 fan-out** (the judge wrapper
fans `n>1` into parallel single-n calls to restore Ragas's strictness
signal; if the gateway caches identical prompts the fan-out collapses to
identical samples): fire 3 parallel identical prompts at
`temperature>0` to `<JUDGE_OPENAI_BASE>` and assert the 3 outputs differ
(md5s distinct). Re-run this check whenever the gateway changes.

**Gate**: `ragas_report.json.aggregate` is non-empty, `n` matches
`eval_tuples_<TAG>.json` length, every metric value in `[0, 1]`.

---

## Phase 5 — Analysis + `calibrate.py` (offline sweep, optional)

After Phase 3, `calibrate.py` replays the per-candidate breakdown captured
in `eval_anchor_<TAG>.json` (`adaptive_breakdown` field, present when the
reranker emitted it). Sweeps `CONTEXT_DECAY_FACTOR × confusion_formula ×
MIN_VALUE_THRESHOLD` offline in seconds — no redeploy, no eval rerun.

### 5.1 Read the live baseline (from Phase 0.2)

You must pass `--baseline-factor`, `--baseline-threshold`,
`--baseline-confusion` matching the LIVE reranker config. **Defaults in
`calibrate.py` are historical anchors (0.0025 / -1.0 / current) — using
them on a report captured at a different live config trips
`--check-baseline` (rc 2, replay-vs-live recall delta > 0.05).**

```bash
# Dump the values you captured in Phase 0.2:
ssh <user>@<host> '
  echo "CONTEXT_DECAY_FACTOR=$(... )"
  echo "MIN_VALUE_THRESHOLD=$(... )"
  echo "CONFUSION_FORMULA=current"  # confirm against the reranker code
'
```

### 5.2 Validity check + sweep

```bash
ssh <user>@<host> '
  python3 /tmp/rag-eval/calibrate.py \
    /tmp/rag-eval/reports/eval_anchor_<TAG>.json \
    --baseline-factor   <LIVE_CONTEXT_DECAY_FACTOR> \
    --baseline-threshold <LIVE_MIN_VALUE_THRESHOLD> \
    --baseline-confusion <LIVE_CONFUSION_FORMULA> \
    --check-baseline \
    --top 10
'
# --check-baseline exits 2 if replay-vs-live recall differs by > 0.05.
# That means the breakdown→candidates mapping is broken — DO NOT trust
# the offline sweep.
```

Optional flags:

- `--check-chunk-size N --chars-per-token R` — verify the breakdown's
  implied chunk size matches the deployed one (English ≈ 4.0, denser
  orthography ≈ 3.2-3.5). `--strict-chunk-size` upgrades warn → exit 2.
- `--bootstrap B` — paired bootstrap CI on the top-1 vs top-2 recall delta.
  B ≥ 1000 recommended.
- `--factors a,b,c` / `--thresholds a,b,c` — narrow the sweep.

### 5.3 Validate the winner live

The offline sweep is a guide, not a verdict. Redeploy the winner
(`CONTEXT_DECAY_FACTOR`, `MIN_VALUE_THRESHOLD`, confusion formula) and
re-run Phase 3 to confirm the offline prediction held. A/B requires two
Phase-3 runs with the same gold and a stable corpus.

---

## When things go wrong

### Resume a partial run

The output file and `<out>.done.jsonl` sidecar survive a kill. Rerun the
**same** wrapper command — succeeded rows skip, error rows retry. If
`<out>` was overwritten by a different run or the gold changed mid-run,
the driver aborts with `EXIT 2: N prefilled ids not in current gold
(gold changed mid-run?)` — pass `EVAL_FRESH=1` to discard the resume state
and start clean.

### Salvage partial outputs

Every entry is persisted to the output file atomically (`<out>.tmp` →
`os.replace`) and the `.done.jsonl` sidecar is flushed after each entry.
A mid-run kill loses at most ONE entry. After kill, inspect:

```bash
ssh <user>@<host> '
  ls -la /tmp/rag-eval/reports/eval_anchor_<TAG>.json*
  #   eval_anchor_<TAG>.json             atomic-parseable (complete or last successful entry)
  #   eval_anchor_<TAG>.json.done.jsonl  one id per line for succeeded entries
  #   eval_anchor_<TAG>.json.tmp         partial write (rm; do NOT trust)
'
```

To resume from a partial report without re-driving succeeded entries,
just rerun the same command. To start over, delete the output file and
sidecar (or pass `EVAL_FRESH=1`).

### ROPC-left-enabled verification curl

If the wrapper trap exits 9 (or the host died before the trap could
revert), verify and manually disable:

```bash
# 1. Get a fresh master token
ssh <user>@<host> '
  ADMIN_PWD=$(grep "^KEYCLOAK_ADMIN_PASSWORD=" /opt/<stack>/.env | cut -d= -f2-)
  ADMIN_TOKEN=$(curl -sk -X POST "<KEYCLOAK_URL>/realms/master/protocol/openid-connect/token" \
    -d "client_id=admin-cli" -d "username=admin" -d "password=${ADMIN_PWD}" \
    -d "grant_type=password" | python3 -c "import sys,json; print(json.load(sys.stdin)[\"access_token\"])")

  # 2. Find the OIDC client UUID
  CLIENT_ID=$(grep "^KEYCLOAK_CLIENT_ID=" /opt/<stack>/.env | cut -d= -f2-)
  CLIENT_UUID=$(curl -sk "<KEYCLOAK_URL>/admin/realms/<REALM>/clients?clientId=${CLIENT_ID}" \
    -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0][\"id\"])")

  # 3. Check current state
  curl -sk "<KEYCLOAK_URL>/admin/realms/<REALM>/clients/${CLIENT_UUID}" \
    -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "import sys,json; print(\"directAccessGrantsEnabled:\", json.load(sys.stdin).get(\"directAccessGrantsEnabled\"))"

  # 4. If true: disable
  curl -sk -X PUT "<KEYCLOAK_URL>/admin/realms/<REALM>/clients/${CLIENT_UUID}" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
    -d "{\"directAccessGrantsEnabled\": false}" \
    -o /dev/null -w "HTTP %{http_code}\n"
'
```

Reference: `.claude/rules/SERVER-TESTING.md` "ROPC User Creation
Requirements" + the manual revert curl pattern.

### Chatqna warm-up wait

Right after a `docker service update` (or the first run on a fresh
redeploy), the OTel SDK re-inits and the first 2-3 queries may miss
spans. If `n_missed_traces` is anomalously high on a fresh run:

1. Wait 2 minutes.
3. Send 2-3 throwaway queries to chatqna (Phase 0.3).
4. Rerun Phase 3 — the warm-up misses were the cause, not a regression.

A persistent warm-up window (> 5 spans) usually means the reranker
container restarted mid-run (`docker service logs <chatqna-service>`).

### Secrets-on-argv / `ps` spot-check

`run_eval.py` injects `E2E_BEARER_TOKEN` via `docker exec -e
E2E_BEARER_TOKEN` (container-side env expansion). It is NEVER on argv. Spot-check:

```bash
# 1. While Phase 3 is running, sample chatqna's PID from inside the
#    chatqna container and read /proc/<pid>/environ — token must be absent
#    (it lives in the WRAPPER's env, not the container's).
ssh <user>@<host> '
  CN=$(docker ps --format "{{.Names}}" | grep <chatqna-container> | head -1)
  docker exec "$CN" sh -c "
    for p in \$(pgrep -f run_eval.py); do
      tr '\0' '\n' < /proc/\$p/environ | grep -E "E2E_BEARER_TOKEN|EVAL_KC_PASSWORD" && echo "LEAK in \$p" || true
    done
  "
'

# 2. Sample the wrapper PID from the swarm node's ps — the bearer token
#    IS expected in the WRAPPER's env (it owns the ROPC lifecycle), but
#    never on a CHATLINE argv.
ssh <user>@<host> '
  ps -ef | grep -E "run_anchor_with_cleanup|run_eval.py" | grep -v grep
  echo "--- argv sanity ---"
  ps -ef | grep -E "run_eval.py|run_anchor" | grep -v grep | grep -vE "EVAL_KC_PASSWORD|E2E_BEARER_TOKEN" || echo "OK: no secrets on argv"
'
```

If the wrapper PID has `E2E_BEARER_TOKEN` on its env, that's expected
(the wrapper holds the realm bearer for the run lifetime). If
`run_eval.py` PID has `E2E_BEARER_TOKEN` on argv, that's a leak — file a
bug.

### `n_missed_traces > 0` — what does it mean?

| Symptom | chatqna log | Cause | Fix |
|---|---|---|---|
| `n_missed_traces > 0`, fast (~1 s/query) | `POST /v1/chatqna 401 ~1ms` | auth missing | rerun via wrapper |
| `n_missed_traces > 0`, slow (~120-300 s/query) | `POST /v1/chatqna 200 ~13s`, no reranker_selection span | trace not indexed | bump `TRACE_FETCH_TIMEOUT`, check VictoriaTraces health |
| `n_missed_traces > 0`, slow (~120 s/query) | nothing (chatqna log silent) | OTel SDK not init | redeploy, wait, re-warm |

```bash
ssh <user>@<host> '
  docker service logs <chatqna-service> --since 5m \
    | grep -E "Grounding|POST /v1/chatqna"
'
```

### `n_http_errors > 0` — chatqna returned non-2xx

Each HTTP error row is appended to `per_query` with `error: "HTTP <code>"`
and counted in `n_http_errors`. Common causes:

- `HTTP 401/403` → wrapper trap re-authed inside the loop but the realm
  client lost credentials mid-run. Rerun.
- `HTTP 429` → upstream rate limit. Bump `EVAL_RETRY_BACKOFF`, rerun.
- `HTTP 502/503` → chatqna or vLLM temporarily down. Wait, rerun.

`EVAL_ALLOW_PARTIAL=1` accepts an HTTP-error row without rc 3; useful for
intermittent upstream flakiness. Do NOT use to silence a regression.

### `n_unmapped_chunk_keys > 0` — wrong `GRAPH_SOURCE`

The driver fetched span `_key`s that don't resolve in ArangoDB via
`source_chunks()`. Almost always means `GRAPH_SOURCE` points at the
wrong collection (corpus was re-ingested into a new collection). Find
the right one:

```bash
ssh <user>@<host> '
  ARANGO_PWD=$(grep "^ARANGO_PASSWORD=" /opt/<stack>/.env | cut -d= -f2-)
  curl -sk -u <username:password> "<ARANGO_URL>/_db/<DB>/_api/database" | python3 -m json.tool
  # Then list the candidate collections under <DB> and pick the one
  # containing chunk_text + the corpus docs.
'
```

`EVAL_ALLOW_UNMAPPED=1` skips the rc-3 gate (NOT a fix — investigate).

---

## Quick reference — wrapper exit code map

| Wrapper exit | Meaning | Action |
|---|---|---|
| 0 | clean run | proceed |
| 2 | usage OR gold-mismatch | wrapper usage (bad args / EVAL_MODE): fix CLI. `run_eval.py` gold-mismatch: stderr is `EXIT 2: N prefilled ids not in current gold (gold changed mid-run?)` → either pass `EVAL_FRESH=1` (fresh run) or restore the prior gold file |
| 3 | degraded | anchor: `skipped_entries` non-empty without `EVAL_ALLOW_PARTIAL`, OR `missed > EVAL_MAX_MISSED_TRACES`, OR `unmapped > 0` without `EVAL_ALLOW_UNMAPPED`. dump-tuples: `len(tuples) < len(entries)` without `EVAL_ALLOW_PARTIAL`, OR `missed > EVAL_MAX_MISSED_TRACES`. See "When things go wrong" |
| 4 | zero scored rows | check Phase 0 (auth, warm-up, GRAPH_SOURCE) |
| 8 | ROPC enable failed (HTTP non-204/200) | check Keycloak admin creds |
| 9 | ROPC revert failed after 3 retries | manual revert curl above |

The wrapper adds 8/9 for its own setup/cleanup failures and exits 2 for
usage errors (no gold/out or bad `EVAL_MODE`); `run_eval.py` exits 2 only
on the gold-mismatch prefilled-ids check (stderr above). Codes 0/3/4 pass
through unchanged.

---

## Phase 6 — Multi-run xlsx report (`enrich_xlsx_v2.py`)

After running one or more eval configurations (anchor + dump-tuples +
RAGAS), feed the artifacts into a single operator-facing workbook for
comparison.

### 6.1 What you get

Six tabs, all filterable in Excel (native `auto_filter`):

| Tab | Contents |
|---|---|
| `Gold` | the source xlsx verbatim (8 source cols preserved, untouched) |
| `Run_<label>` | one per run. Row 1 = `params` + `note` config block. Row 2 = the table header (8 source cols + 22 enriched cols; every enriched header has a tooltip with unit + semantics + range — hover in Excel). Rows 3+ = per-query data. The 22 enriched cols: `gold_recall` / `gold_complete_recall` / `gold_precision` / `gold_noise` / `gold_retrieval_recall` / `gold_passage_recall` / `selected_keys` / `candidate_keys` / `trace_found` / `ragas_faithfulness` / `ragas_context_precision` / `ragas_context_recall` / `ragas_answer_relevancy` / `ragas_nan` / `answer_first_200` / `abstained` / `abstention_reason` / `answer_lang` / `gold_match_status_per_chunk` / `gold_chunk_count` / `is_unresolved` / `n_evaluable_helper` |
| `Compare` | one row per run, all aggregate metrics + delta-vs-first-run. Columns: `label`, `params`, `n_evaluable`, `n_abstained`, `n_unresolved`, `recall`, `precision`, `f1`, `complete_recall`, `retrieval_recall`, `passage_recall`, `avg_selected`, the 4 RAGAS means, `delta_recall_vs_base`, `delta_f1_vs_base`. The first run is the baseline. |
| `Calibrate` | top-50 combos from the offline grid (when `--calibrate` is given), sorted by F1 descending |
| `Charts` | 4 embedded matplotlib PNGs: anchor metrics bar/group, RAGAS metrics bar/group, precision/recall scatter, query-status stacked bar (answered / abstained / unresolved-excluded) |

### 6.2 Build a single-run workbook (the common case)

```bash
# After Phase 3 + Phase 4 + Phase 5, you have the artifacts on the swarm
# node. Pull them to your local machine and build the workbook.
scp <user>@<host>:/tmp/rag-eval/{anchor,ragas,tuples}_<TAG>.json /tmp/eval-new/

~/.venv/docx/bin/pip install openpyxl matplotlib
~/.venv/docx/bin/python3 tests/rag-benchmarks/eval/enrich_xlsx_v2.py \
  --xlsx ~/Téléchargements/New_Test_Data_AgroGenio.xlsx \
  --gold /tmp/eval-new/gold_dataset.matched.json \
  --output /tmp/eval-new/report.xlsx \
  --runs-json /tmp/eval-new/runs.json
```

`runs.json` shape (one or more runs):

```json
[
  {
    "label": "G2_K32_FK40_th-1.0",
    "anchor": "/tmp/eval-new/anchor.json",
    "ragas":  "/tmp/eval-new/ragas.json",
    "tuples": "/tmp/eval-new/tuples.json",
    "params": {"K": 32, "FETCH_K": 40, "MIN_VALUE_THRESHOLD": -1.0},
    "note":   "Live T13b-K=32 champion (MR !507)"
  }
]
```

`label` becomes both the `Run_<label>` tab name and the legend on the
charts. `params` + `note` appear in the per-run config block (row 1) so
the workbook is self-describing — no need to keep a separate README.

### 6.3 Build a multi-run comparison

List every run you want to compare in `runs.json`; the order is
significant — the **first run is the baseline** for the `delta_*`
columns in Compare. The two runs in the shipped demo
(`/tmp/eval-new/runs_demo.json`) show a real G2 run plus an illustrative
top-3 capped replay (selected[] truncated, recall forced to 0) — the
delta-vs-base column exposes the regression at a glance.

### 6.4 What it does NOT do (yet)

- Does not run the eval for you — it only aggregates artifacts produced
  by Phases 3/4/5. Run those first.
- Does not enforce any "live vs simulated" labelling — the operator
  should set `note: "ILLUSTRATIVE …"` in the runs spec when seeding
  a what-if row that is NOT a real eval. The Compare tab shows the
  numbers honestly either way; the `note` is the only signal.
- Does not embed the markdown report / per-failure-attribution narrative
  (Phase 5 output) — it embeds the numeric aggregates and the 4
  charts. A future MR may add a Charts-narrative sheet that lifts
  the markdown report into a tab.

### 6.5 Generic (deployment-agnostic) — README claim check

The script takes no deployment-specific inputs (no hostnames, IPs,
stack names, DB names). The `runs.json` is operator-authored. The
`params` dict is a free-form key/value carrier — no schema is enforced.

---

## Reference

- `tests/rag-benchmarks/eval/CLAUDE.md` — operational entry point, score
  threshold gotcha, auth requirement, diagnostic mode.
- `tests/rag-benchmarks/eval/calibrate.py` — `--help` for the full
  sweep grid, `--check-baseline`, `--bootstrap`.
- `tests/rag-benchmarks/eval/enrich_xlsx.py` — single-run generator
  (legacy, kept for back-compat; `enrich_xlsx_v2.py` supersedes it
  for any new run).
- `tests/rag-benchmarks/eval/enrich_xlsx_v2.py` — `--help` for the full
  flag set; module docstring documents the per-tab layout, the join
  semantics (anchor / RAGAS / tuples by id and by question text), and
  the column documentation that powers the in-xlsx tooltips.
- `.claude/rules/SERVER-TESTING.md` — ROPC lifecycle + manual revert curl.