# Eval Pipeline — Entry Point

This directory is the **single source of truth** for the GENIE.AI retrieval/semantic eval pipeline. If you are about to run any eval against a deployed stack, READ THIS FIRST.

## TL;DR — Always use the wrapper script

```bash
# ONE-SHOT version: ENABLE ROPC → get token → run → ALWAYS disable ROPC
# Never call run_eval.py directly against a production-deployed chatqna:
# it will 401 (see "Auth requirement" below).
#
# Recommended: let the wrapper resolve non-secret vars from the deployment
# .env via EVAL_DEPLOY_ENV. Pass only the URL + admin password explicitly.

EVAL_DEPLOY_ENV=/opt/<stack>/.env \
EVAL_KC_URL=https://kc.example.com/auth \
KEYCLOAK_ADMIN_PASSWORD=... \
  bash /tmp/rag-eval/scripts/run_anchor_with_cleanup.sh \
    /tmp/rag-eval/gold_dataset.matched.v4.json \
    /tmp/rag-eval/eval_anchor_<TAG>.json
```

The wrapper script lives at `tests/rag-benchmarks/scripts/run_anchor_with_cleanup.sh` in the repo and is rsynced to `/tmp/rag-eval/scripts/` on the swarm node before each run.

## Auth requirement

chatqna enforces OIDC. Requests without a valid Bearer token are
rejected — even from in-network containers. The auth gate landed Aug 2026;
eval pipelines written before then called `run_eval.py` directly via
`docker exec curl` from the chatqna container to localhost:8888 with no
auth header. That path now returns 401 in ~1 ms.

**Symptom of the auth-regression** (vs the older trace-miss path):

| Cause | chatqna log line | Eval log line | Time per query |
|---|---|---|---|
| Auth missing | `POST /v1/chatqna 401 ~1ms` | no "trace missed" yet | ~1 s |
| Trace miss (real) | `POST /v1/chatqna 200 ~13s` | "no reranker_selection span" | ~120-300 s |
| OTel SDK not init | nothing | "no reranker_selection span" | ~120 s |

The wrapper script enables `directAccessGrantsEnabled=true` on the OIDC
client, fetches a realm token via ROPC (Resource Owner Password Credentials),
and disables ROPC again on exit (signal-safe `trap` on EXIT/INT/TERM).
**Forgetting to revert it is a security vulnerability** — ROPC must NEVER
stay enabled in production.

**Exit codes** (full map in `eval/RUNBOOK.md`):
- `run_eval.py` — `0` clean, `2` usage/gold-mismatch, `3` degraded, `4` zero
  scored rows.
- wrapper adds `8` (ROPC enable failed — check Keycloak admin creds) and `9`
  (ROPC revert failed after 3 retries — manual revert curl above is
  mandatory; production is left exposed).

For zero-touch auth (when ROPC is not desired), use a dedicated service
account via `client_credentials` grant and inject it into `run_eval.py` via
the `E2E_BEARER_TOKEN` env var. Not implemented in the wrapper yet.

## Score threshold — silent retrieval drop

The retriever service drops candidates with cosine similarity below
`RETRIEVER_ARANGO_SCORE_THRESHOLD` (default `0.2`, see
`docker-compose.yaml:1321`). Realistic per-corpus ranges depend on the
embedding model and corpus — calibrate expectations against the live
deployment, then tune. The 0.2 default rarely filters gold chunks for
typical BGE-large embeddings but is a common silent-drop trap for lower-
dimensional or out-of-distribution corpora.

**Symptom of an over-aggressive threshold**:

```
retriever log: "No relevant docs were retrieved using the relevance score threshold 0.2"
chatqna log:    "Grounding decision: is_grounded=False (reranker_present=False, rerank_verdict=0, retriever_docs=0)"
```

Fix: `docker service update --env-add RETRIEVER_ARANGO_SCORE_THRESHOLD=0.0
<stack>_retriever-arango-service` for the duration of the eval,
then revert. The wrapper does NOT manage this env var — do it manually and
remember to revert (the `TEI docker service deploy` etc. use the same
service, so removing the override restores default 0.2).

If you forget to revert: gold chunks get through with non-gold chunks (lower
precision), not catastrophic but visible in the recall/precision split.

## Diagnostic mode

```
"n_missed_traces > 0" in the aggregate dict can mean:
1. AUTH-FAILURE     (POST 401 in chatqna log) → run via wrapper
2. TRACE-NOT-INDEXED  (POST 200 in chatqna log, no reranker_selection span in VT) → wait, or bump TRACE_FETCH_TIMEOUT
3. RETRIEVER-EMPTY   (retriever_docs=0 in chatqna grounding decision) → check score threshold
```

Distinguish by inspecting chatqna logs first:

```bash
ssh <user>@<host> 'docker service logs <stack>_chatqna-xeon-backend-server --since 5m' \
  | grep -E 'Grounding|POST /v1/chatqna'
```

## Scripts in this directory

| File | Role |
|---|---|
| `run_eval.py` | Eval driver. OIDC handled by the wrapper (ROPC enable/revert) or by `E2E_BEARER_TOKEN`/`EVAL_KC_*` env vars; this script refreshes its own realm bearer in-run. |
| `calibrate.py` | Offline adaptive-reranker parameter sweep. Pure replay, no chatqna calls. |
| `run_ragas_eval.py` | LLM-judged semantic scoring. Reads `eval_tuples.json` (Phase 3 output). |
| `metrics.py` | `aggregate()` (per-row → mean) + `recall_at_k` / `ndcg_at_k` (rank-aware). |
| `chunk_identity.py` | `content_hash` (sha256[:16] of normalized text). Identity is content-based, survives re-ingest. |
| `arango.py` | ArangoDB cursor helper. |
| `keycloak.py` | Keycloak admin + realm token helpers (used by run_eval.py and tests). |
| `harness.py` | `docker exec` + `curl` helpers used by run_eval.py to drive chatqna in-container. |
| `dump_chunks.py` | Dump chunk keys + labels for gold annotation. |
| `xlsx_to_gold.py` | Phase 1: xlsx → gold_dataset.json skeleton. |
| `match_gold_chunks.py` | Phase 2: preview → content_hash via ArangoDB substring. |
| `gold_dataset.example.json` | Example gold schema. |

**Wrapper script lives at `tests/rag-benchmarks/scripts/run_anchor_with_cleanup.sh`**
(not in this directory by historical accident — kept at the bench dir root
so it can be rsynced to `/tmp/rag-eval/scripts/` independently of the eval
scripts dir).

## Live vs offline — when to deploy which

| You need to... | Use | Why |
|---|---|---|
| Compare two live deploy configs | `run_anchor_with_cleanup.sh` + `run_eval.py::anchor` | Hits live chatqna → spans from real reranker. |
| Sweep adaptive-reranker params offline (factor × confusion × threshold) | `calibrate.py` | Pure replay of logged per-candidate breakdown. No chatqna calls. Validates with `--check-baseline` (replay-vs-live recall) and warns on chunk-size drift via `--check-chunk-size`. |
| Sweep reranker threshold (`MIN_VALUE_THRESHOLD`) | `calibrate.py --thresholds ...` | Threshold is in the breakdown (logged `value` > threshold per candidate) — same offline sweep as factor/conf. For live A/B on threshold, also use `run_anchor_with_cleanup.sh` below. |
| Live A/B on a single config | `run_anchor_with_cleanup.sh` + `run_eval.py::anchor` | Hits live chatqna → spans from real reranker. |
| Score RAGAS end-to-end | `run_ragas_eval.py` | Reads `eval_tuples.json` (chatqna `dump-tuples` output), no chatqna calls. |

`calibrate.py` is FAST (seconds), `run_eval.py` is SLOW (~28 min for 42
queries at 40 s/query trace-fetch). Always run `calibrate.py` first to
narrow the grid, then validate top-1-2 cells live via the wrapper script.

`calibrate.py` corpus configuration flags (override defaults per corpus):
- `--baseline-factor`, `--baseline-threshold`, `--baseline-confusion`: replay the
  LIVE cell for `--check-baseline` (defaults = historical anchor; override to
  match your deployment's live reranker params).
- `--chars-per-token`: REQUIRED with `--check-chunk-size` (English ≈ 4.0;
  denser-orthography languages ≈ 3.2-3.5).
- `--bootstrap B`: paired bootstrap CI on top-1 vs top-2 cells, Sidak-corrected
  over the full grid.

## Common pitfall — chatqna is restarting

The eval pipeline assumes chatqna has been warm for at least a few
minutes. Right after a `docker service update`, the OTel SDK re-inits and
the first 2-3 queries may miss spans. If you start the eval immediately
after a deploy and see `n_missed_traces=5`, wait 2 min and retry — those
were warm-up misses, not a regression.