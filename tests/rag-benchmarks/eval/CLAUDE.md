# Eval Pipeline — Entry Point

This directory is the **single source of truth** for the GENIE.AI retrieval/semantic eval pipeline. If you are about to run any eval against a deployed stack, READ THIS FIRST.

## TL;DR — Always use the wrapper script

```bash
# ONE-SHOT version: ENABLE ROPC → get token → run → ALWAYS disable ROPC
# Never call run_eval.py directly against a production-deployed chatqna:
# it will 401 (see "Auth requirement" below).

EVAL_KC_URL=https://kc.example.com/auth \
KEYCLOAK_ADMIN_PASSWORD=... \
ARANGO_DB=el-salvador \
ARANGO_PASSWORD=... \
  bash /tmp/rag-eval/scripts/run_anchor_with_cleanup.sh \
    /tmp/rag-eval/gold_dataset.matched.v4.json \
    /tmp/rag-eval/eval_anchor_<TAG>.json
```

The wrapper script lives at `tests/rag-benchmarks/scripts/run_anchor_with_cleanup.sh` in the repo and is rsynced to `/tmp/rag-eval/scripts/` on the swarm node before each run.

## Auth requirement (post-MR-!445)

Since the chatqna auth gate landed (post-MR-!445, Aug 2026), chatqna rejects
requests without a valid Bearer token — even from in-network containers.
Earlier eval pipelines (Oct 2025 – Aug 2026) called `run_eval.py` directly
via `docker exec curl` from the chatqna container to localhost:8888 with
no auth header. That path now returns 401 in ~1 ms.

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

For zero-touch auth (when ROPC is not desired), use a dedicated service
account via `client_credentials` grant and inject it into `run_eval.py` via
the `BEARER_TOKEN` env var. Not implemented in the wrapper yet.

## Score threshold — silent retrieval drop

The retriever service drops candidates with cosine similarity below
`RETRIEVER_ARANGO_SCORE_THRESHOLD` (default `0.2`, see
`docker-compose.yaml:1321`). With BGE-large queries against the CENTA corpus,
realistic values are 0.4–0.7, so the default rarely filters gold chunks.

**Symptom of an over-aggressive threshold**:

```
retriever log: "No relevant docs were retrieved using the relevance score threshold 0.2"
chatqna log:    "Grounding decision: is_grounded=False (reranker_present=False, rerank_verdict=0, retriever_docs=0)"
```

Fix: `docker service update --env-add RETRIEVER_ARANGO_SCORE_THRESHOLD=0.0
genieai-el-salvador_retriever-arango-service` for the duration of the eval,
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
ssh govstack@<ip> 'docker service logs genieai-el-salvador_chatqna-xeon-backend-server --since 5m' \
  | grep -E 'Grounding|POST /v1/chatqna'
```

## Scripts in this directory

| File | Role |
|---|---|
| `run_eval.py` | Eval driver. NO auth handling — always invoke via the wrapper script in prod. |
| `calibrate.py` | Offline adaptive-reranker parameter sweep. Pure replay, no chatqna calls. |
| `run_ragas_eval.py` | LLM-judged semantic scoring. Reads `eval_tuples.json` (Phase 3 output). |
| `metrics.py` | `aggregate()` (per-row → mean) + `recall_at_k` / `ndcg_at_k` (rank-aware). |
| `chunk_identity.py` | `content_hash` (sha256[:16] of normalized text). Identity is content-based, survives re-ingest. |
| `arango.py` | ArangoDB cursor helper. |
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
| Sweep adaptive-reranker params offline (factor × confusion × threshold) | `calibrate.py` | Pure replay of logged per-candidate breakdown. No chatqna calls. |
| Sweep reranker threshold (`MIN_VALUE_THRESHOLD`) | `run_anchor_with_cleanup.sh` (the threshold is a live gate, not in the breakdown) | `calibrate.py` does NOT sweep threshold — only factor × confusion. |
| Score RAGAS end-to-end | `run_ragas_eval.py` | Reads `eval_tuples.json` (chatqna `dump-tuples` output), no chatqna calls. |

`calibrate.py` is FAST (seconds), `run_eval.py` is SLOW (28 min for 42
queries at 40 s/query trace-fetch). Always run `calibrate.py` first to
narrow the grid, then validate top-1-2 cells live via the wrapper script.

## Common pitfall — chatqna is restarting

The eval pipeline assumes chatqna has been warm for at least a few
minutes. Right after a `docker service update`, the OTel SDK re-inits and
the first 2-3 queries may miss spans. If you start the eval immediately
after a deploy and see `n_missed_traces=5`, wait 2 min and retry — those
were warm-up misses, not a regression.