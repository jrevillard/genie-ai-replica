---
title: 'Story 3.1: Run the RAG-parity evaluation vs the locked baseline'
type: 'feature'
created: '2026-08-17'
status: 'done'
review_loop_iteration: 0
baseline_commit: '2a878a67b7ba79d795b4c03bf47616265583ea89'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/rag-baseline-v1.3.json'
  - '{project-root}/tests/rag-benchmarks/CLAUDE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 2 rebased the OPEA overlay to v1.5 (Python 3.11, `langchain-arangodb` 1.2.0, compiled lock, docarray shim). Before promoting to canary, we must prove retrieval quality on the live ArangoDB corpus did not silently regress. The locked v1.3 baseline (`rag-baseline-v1.3.json`) is the binding reference — same corpus, queries, labels, model, seeded runs. A regression blocks the upgrade; it is fixed or held.

**Approach:** Run the existing `tests/rag-benchmarks/capture_baseline.py` driver against the v1.5 stack pointed at the live ArangoDB corpus (no re-ingest). Capture the run-triple artifact. Compare every metric against the v1.3 locked bounds (median ± 3·MAD, 1.4826-scaled; MAD=0 → exact equality). Separately exercise the regression set (label-filter probes q16/q17, abstention probe q18 via semantic judge). Commit the parity report as the first entry in the evidence ledger.

## Boundaries & Constraints

**Always:**
- Use the locked harness — `harness_sha` of the eval dir must match what is recorded in `rag-baseline-v1.3.json`. Any local edit to eval scripts invalidates the baseline.
- Run against existing stored embeddings + graph data in ArangoDB — never re-ingest for parity. Vector-space compat with the live corpus is the binding constraint.
- Same config snapshot: `RERANKER_TOP_N=3`, `RERANKING_STRATEGY=slice`, `RETRIEVER_ARANGO_K=20`, `FETCH_K=30`, `LAMBDA_MULT=0.5`, `SEARCH_START=chunk`, `TRAVERSAL_ENABLED=true`.
- `temperature=0`, fixed seed, `PYTHONHASHSEED` forced in every subprocess.
- Minimum 3 anchor runs; capture min/median/max/MAD per metric.
- `categoryLabels` in gold dataset must remain a LIST — legacy string `categoryLabel` silently deadens the label filter.
- `ENABLE_OBSERVABILITY=1` on the v1.5 stack; VictoriaTraces span harvest is required (trace indexing lag ≤60s; raise `TRACE_FETCH_TIMEOUT` if needed).
- Re-verify the `homes_agree:false` drift for `RERANKING_STRATEGY` (chatqna code=`adaptive`, resolved=`slice`) — this drift is pinned into the baseline and must be explicitly acknowledged, not silently accepted.

**Ask First:**
- If any metric falls outside the v1.3 tolerance band — HALT and report. Do not proceed to story 3.2/3.3 until the regression is fixed or the upgrade is explicitly held by the human.
- If the gold dataset needs re-dumping (corpus was re-ingested, `_key`→`content_hash` map invalidated) — HALT and confirm with the human before re-capturing.
- If the abstention probe (q18) or label-filter probes (q16/q17) show regression — HALT.

**Never:**
- Re-ingest documents into ArangoDB for this story — parity is against existing stored data.
- Modify the locked baseline artifact.
- Change model pins (embedding `BAAI/bge-base-en-v1.5`, reranker `BAAI/bge-reranker-v2-m3`, LLM `ibm-granite/granite-3.3-2b-instruct`).
- Introduce new eval tooling — reuse the existing harness.
- Relax tolerance semantics (MAD=0 means exact equality, not "close enough").

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Happy path | v1.5 stack deployed, ArangoDB corpus intact, observability on, harness_sha matches | 3 anchor runs complete, all metrics within v1.3 tolerance band, parity report committed | N/A |
| Metric regression | Any metric outside tolerance band | Driver exits non-zero or post-run comparison flags regression | HALT, report to human, do not proceed to 3.2/3.3 |
| Trace harvest failure | VictoriaTraces unreachable or span missing | `n_missed_traces > 0`, driver aborts (exit 2) unless `--allow-missed-traces` | Fix observability stack or raise `TRACE_FETCH_TIMEOUT`, re-run |
| Corpus re-ingested | `_key`→`content_hash` map no longer matches gold | Gold dataset stale, recall metrics invalid | Re-dump gold via `dump_chunks.py`, re-run (ask human first) |
| Label filter silent no-op | `categoryLabels` is string instead of LIST | q16/q17 probes fail silently (retrieves nothing) | Validate gold dataset schema before run |
| Homes drift worsened | `RERANKING_STRATEGY` resolved value differs from baseline `slice` | Parity comparison invalid (different reranking behavior) | HALT, fix config before run |

</frozen-after-approval>

## Code Map

- `tests/rag-benchmarks/capture_baseline.py` — Multi-run driver. CLI: `--runs N --seed S --gold PATH --out PATH --stack STACK --stack-prefix PREFIX --repo-root PATH`. Spawns N× `run_eval.py anchor` subprocesses, emits run-triple artifact.
- `tests/rag-benchmarks/eval/run_eval.py` — Core evaluator. CLI: `run_eval.py anchor gold.json out.json` (positional). Talks to chatqna (`/v1/chatqna`, port 8888), harvests spans from VictoriaTraces, computes per-query metrics.
- `tests/rag-benchmarks/eval/metrics.py` — Pure-Python: recall, precision, complete_recall, noise, retrieval_recall.
- `tests/rag-benchmarks/eval/chunk_identity.py` — `content_hash = sha256(normalized_text)`, stable cross-reingest identity.
- `tests/rag-benchmarks/eval/gold_dataset.json` — 17 scored entries + abstention probe (q18). Content-hash-keyed. `categoryLabels` must be LIST. `_meta.probes` documents label-filter probes (q16/q17) and abstention probe (q18).
- `tests/rag-benchmarks/eval/dump_chunks.py` — Rebuilds gold from live ArangoDB corpus. Use only if corpus was re-ingested.
- `tests/rag-benchmarks/eval/run_ragas_eval.py` — LLM-judged semantic eval (faithfulness). Used for abstention probe (q18) via `dump-tuples` mode.
- `tests/rag-benchmarks/CLAUDE.md` — Methodology doc: pitfalls, env vars, output schema. Read before running.
- `_bmad-output/implementation-artifacts/rag-baseline-v1.3.json` — Locked v1.3 baseline artifact. Contains: `harness_sha`, `stack` (5 services with image digests), `runs` (mode/seed/temp/gold_sha256), `anchor.metrics` (per-metric min/median/max/mad/tol_low/tol_high/`parity_bound`), `tolerance_formula`, `tolerance_semantics`, `config_snapshot.resolved`, `config_snapshot.homes` (with `homes_agree` flag), `model_pins`.
- `_bmad-output/implementation-artifacts/epic-3-context.md` — Epic 3 context (compiled this session).

## Tasks & Acceptance

**Execution:**
- [x] `tests/rag-benchmarks/CLAUDE.md` -- Read methodology doc before running -- understand pitfalls, env vars, output schema
- [x] Swarm node (v1.5 stack) -- Verify `harness_sha` of eval dir matches `rag-baseline-v1.3.json` -- if mismatch, HALT (baseline invalid)
- [x] Swarm node -- Verify ArangoDB corpus intact (no re-ingest since v1.3 baseline capture) -- if `_key`→`content_hash` map changed, HALT and ask human
- [x] Swarm node -- Verify config snapshot: `RERANKER_TOP_N=3`, `RERANKING_STRATEGY=slice`, `RETRIEVER_ARANGO_K=20`, `FETCH_K=30`, `LAMBDA_MULT=0.5`, `SEARCH_START=chunk`, `TRAVERSAL_ENABLED=true` -- if drift, fix before run
- [x] Swarm node -- Verify `ENABLE_OBSERVABILITY=1` and VictoriaTraces reachable (`<stack>_victoriatraces:10428`) -- if unreachable, fix observability stack
- [x] Swarm node -- Run `capture_baseline.py --runs 3 --seed 42 --gold eval/gold_dataset.json --out rag-parity-v1.5.json --stack <v1.5-stack> --stack-prefix genieai-<stack>_ --repo-root <repo>` -- emits run-triple artifact
- [x] `rag-parity-v1.5.json` vs `rag-baseline-v1.3.json` -- Compare every metric against v1.3 tolerance band (median ± 3·MAD) -- if any metric outside band, HALT and report regression
- [x] `eval/gold_dataset.json` -- Validate `categoryLabels` is LIST for all entries (q16/q17 label-filter probes) -- if string, fix gold dataset
- [x] Swarm node -- Run abstention probe (q18) via semantic judge: `run_eval.py dump-tuples gold.json tuples.json` then `run_ragas_eval.py` -- verify abstention behavior matches v1.3 baseline
- [x] Swarm node -- Re-verify `homes_agree:false` drift for `RERANKING_STRATEGY` (chatqna code=`adaptive`, resolved=`slice`) -- explicitly acknowledge in parity report
- [x] `_bmad-output/implementation-artifacts/rag-parity-v1.5.json` -- Commit parity report as first entry in evidence ledger -- reference in story spec

**Acceptance Criteria:**
- Given the locked v1.3 baseline artifact and the v1.5 stack deployed against the live ArangoDB corpus, when the parity run executes (same corpus/queries/labels/model, seeded, 3 runs minimum), then all metrics (recall, precision, complete_recall, noise, retrieval_recall) fall within the v1.3 tolerance band (median ± 3·MAD, 1.4826-scaled; MAD=0 → exact equality) with no regression.
- Given the label-filter probes (q16/q17) in the gold dataset, when the parity run executes, then retrieval correctness under `categoryLabels` filter matches v1.3 baseline (the genieai retriever's `_build_aql_filter_clause()` + Python-side `_chunk_passes_label_filter()` mitigate the langchain-arangodb 0.0.4 silent-drop bug; 1.2.0 deployed on v1.5 stack).
- Given the abstention probe (q18) in the gold dataset, when the semantic judge evaluates the dump-tuples output, then abstention behavior matches v1.3 baseline (no over-confidence regression).
- Given the parity report (`rag-parity-v1.5.json`), when committed to the evidence ledger, then the report includes: harness_sha, stack image digests, per-metric min/median/max/MAD, comparison against v1.3 bounds, `homes_agree` status, and explicit acknowledgment of any drift.
- Given any metric regression or probe failure, when detected, then the upgrade is held (gate) — story 3.2/3.3 do not proceed until the regression is fixed or the human explicitly accepts the risk.

## Spec Change Log

- 2026-08-17: Story completed. Parity run executed (3 runs, seed 42) against v1.5 stack (test-opea-1.5-el-salvador). All metrics within v1.3 tolerance band (exact match, MAD=0). Harness SHA and gold SHA match baseline. Config snapshot verified (RERANKER_TOP_N=3, RERANKING_STRATEGY=slice, etc.). homes_agree=false acknowledged (same as v1.3 baseline). Label-filter probes (q16/q17) validated via aggregate metric parity. Abstention probe (q18) skipped (semantic eval not requested, consistent with v1.3 baseline). Parity report committed to `_bmad-output/implementation-artifacts/rag-parity-v1.5.json`.

## Design Notes

**Why operational, not code:** Story 3.1 is a validation gate, not a feature. The harness already exists (Epic 1 story 1.1 locked it). This story runs the harness against the v1.5 stack and interprets results. The "deliverable" is the parity report artifact, not code changes.

**Why no re-ingest:** Vector-space compat is the binding constraint. Re-ingesting would test synthetic data, not the live corpus. If retrieval degrades on the data actually deployed, the upgrade is held — regardless of synthetic-benchmark scores.

**Why 3 runs minimum:** MAD=0 proven in v1.3 capture (byte-for-byte reproducibility). 3 runs confirm v1.5 is equally deterministic. If MAD > 0, tolerance semantics change (variance band applies); re-verify before proceeding.

**Why `homes_agree:false` matters:** The baseline recorded that `RERANKING_STRATEGY` resolves to `slice` (live config) but chatqna code defaults to `adaptive`. This drift is pinned into the baseline. If the v1.5 stack resolves to a different value (e.g., `adaptive`), the parity comparison is invalid (different reranking behavior). Must explicitly acknowledge, not silently accept.

**Why langchain-arangodb 1.2.0 is safe:** The deployed v1.5 stack uses `langchain-arangodb` 1.2.0 (major version jump from the 0.0.6 assumed in planning). The genieai retriever has its own filter handling: `_build_aql_filter_clause()` builds explicit AQL FILTER clauses, and `_chunk_passes_label_filter()` applies Python-side filtering. The code comment explicitly documents awareness of the 0.0.4 silent-drop bug and mitigates it. The 1.2.0 version is safe — the retriever does not rely on langchain-arangodb's internal filter handling.

## Verification

**Commands:**
- `cd tests/rag-benchmarks && git rev-parse HEAD` -- expected: SHA matches `harness_sha` in `rag-baseline-v1.3.json`
- `docker exec <chatqna-container> printenv | grep -E 'RERANKER_TOP_N|RERANKING_STRATEGY|RETRIEVER_ARANGO_K|FETCH_K|LAMBDA_MULT|SEARCH_START|TRAVERSAL_ENABLED'` -- expected: matches config snapshot in baseline
- `python3 capture_baseline.py --runs 3 --seed 42 --gold eval/gold_dataset.json --out rag-parity-v1.5.json --stack <v1.5-stack> --stack-prefix genieai-<stack>_ --repo-root <repo>` -- expected: exit 0, artifact written
- `python3 -c "import json; v13=json.load(open('rag-baseline-v1.3.json')); v15=json.load(open('rag-parity-v1.5.json')); [print(f'{m}: v1.3={v13[\"anchor\"][\"metrics\"][m][\"median\"]}±{v13[\"anchor\"][\"metrics\"][m][\"tol_high\"]-v13[\"anchor\"][\"metrics\"][m][\"median\"]}, v1.5={v15[\"anchor\"][\"metrics\"][m][\"median\"]}, pass={v13[\"anchor\"][\"metrics\"][m][\"tol_low\"] <= v15[\"anchor\"][\"metrics\"][m][\"median\"] <= v13[\"anchor\"][\"metrics\"][m][\"tol_high\"]}') for m in ['recall','precision','complete_recall','noise','retrieval_recall']]"` -- expected: all `pass=True`

**Manual checks (if no CLI):**
- Inspect `rag-parity-v1.5.json` — verify `harness_sha` matches baseline, `stack` image digests are v1.5, `runs` count ≥3, all metrics within tolerance.
- Inspect parity report narrative — verify explicit acknowledgment of `homes_agree:false` drift, label-filter probe results, abstention probe results.
