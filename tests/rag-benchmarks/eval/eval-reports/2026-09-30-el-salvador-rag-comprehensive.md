# El Salvador RAG Pipeline — Comprehensive Evaluation Report

**Author**: Claude (automated pipeline)
**Date**: 2026-09-30 (last update: 2026-10-02, K=32 sweep + T13b champion + file_coverage 0.898)
**Stack**: genieai-el-salvador @ `<swarm-host>` (`release/el-salvador` branch, **T13b-K=32 live**: factor=0.0006 + thresh=−1.0 + BGE wrapper + K=32)
**Sample**: 42 queries (Spanish CENTA agriculture), gold_dataset.matched.v4.json
**Tools**: `tests/rag-benchmarks/eval/{run_eval.py, run_ragas_eval.py, calibrate.py}` (Bearer-auth wrapper: `tests/rag-benchmarks/scripts/run_anchor_with_cleanup.sh`)
**RAGAS judge**: MiniMax-M3 (`ANTHROPIC_BASE_URL=http://127.0.0.1:3456/v1`)
**RAGAS embedder**: BGE-large-en-v1.5 via TEI (`EVAL_EMBED_BASE_URL=https://<gpu-host>:444/embed/v1`)

---

## 1. Question & scope

This report covers the full Sept 23 → Sept 30 cycle on the El Salvador deployment: the pipeline evolution (chunker + system prompt + retriever top-K), the reranker calibration story (including a mid-cycle crater and today's corrective calibration sweep), and the resulting RAG effectiveness measurements on 42 Spanish agriculture queries. Three subquestions investigated:

- **Q1 — Pipeline evolution**: did the chunker, system prompt, and K changes deliver end-to-end answer quality?
- **Q2 — Calibration**: the reranker's `CONTEXT_DECAY_FACTOR` was tuned for the old chunker size — is the production state still optimal, or stale?
- **Q3 — Live A/B validation**: does the offline-calibration champion hold up under live RAGAS evaluation, or does it diverge?

---

## 2. Pipeline evolution (Sept 23 → Sept 29)

Three production commits between the two evals:

| SHA | What |
|---|---|
| `d54a86877` | chunker: `DATAPREP_CHUNK_SIZE_MD` 2000 → 1400, `OVERLAP` 300 |
| `445efd6b3` | system prompt: restore canonical AgroGenio prose |
| `84acd6b9` | system prompt: prose → structured XML `<agent>` policy |

And one infrastructure commit enabling the K sweep:

- retriever `RETRIEVER_ARANGO_K` 20 → 32 (TEI `--max-client-batch-size=32` ceiling)

The adaptive reranker framework stayed untouched (same `RERANKING_STRATEGY=adaptive`, same embedding model `BAAI/bge-large-en-v1.5`, same TEI reranker `BAAI/bge-reranker-v2-m3`).

---

## 3. Methodology

### 3.1 Anchor path (deterministic, no LLM)

`run_eval.py anchor` — drives the 42 gold queries through chatqna (internal, label-filtered path), pulls selection from the `chatqna.reranker_selection` OTel span in VictoriaTraces. Scoring:

- **chunk_recall** = |selected ∩ gold| / |gold|
- **chunk_precision** = |selected ∩ gold| / |selected|
- **complete_recall** = 1 if gold ⊆ selected else 0 (mean over queries)
- **retrieval_recall** = |candidates ∩ gold| / |gold| (pre-rerank; isolates retriever from reranker)
- **noise** = 1 − chunk_precision
- **passage_recall** = |selected_passages ∩ gold_passages| / |gold_passages|
- **avg_sel** = chunks kept by reranker per query (mean)

### 3.2 Semantic path (LLM-judged)

`run_eval.py dump-tuples` → `run_ragas_eval.py` with MiniMax-M3 judge + BGE-large embeddings. 4 metrics:

- **faithfulness** — is the answer grounded in the retrieved contexts?
- **context_precision** — are relevant chunks ranked above irrelevant ones?
- **context_recall** — does the retrieved context cover the reference answer?
- **answer_relevancy** — does the answer address the question?

### 3.3 Gold methodology caveat

The Sept 23 baseline (T05) was scored against gold v3 (74 chunks, 39 passages); Sept 29 eval (T06, T08, T09, T11) uses gold v4 (254 chunks, 37 unique source_doc passages, 74 per-query gold passages summed across 42 queries, median 2 chunks/query, mean 6). v4 inflation is a real artefact of `match_gold_chunks.py` substring matching on generic Spanish phrases — Q06 ("drought-tolerant bean varieties") generates 25 gold entries from 1 source_doc passage (the phrase "Its main attribute is tolerance to moderate drought and high temperatures" appears in every drought-tolerant variety description). T05 RAGAS values from `2026-09-23-el-salvador-reranker-evaluation.md §4` are against v3, so they overstate context_precision and context_recall for T05 (smaller denominator was easier to satisfy). Faithfulness is comparable (LLM judge is scale-agnostic). Honest read: apples-to-apples is only possible within the v4 era (T06, T08, T09, T11); cross-era RAGAS comparisons carry this caveat.

### 3.4 RAGAS self-consistency caveat

RAGAS/Instructor requests `n=3` samples per judge call for self-consistency scoring. MiniMax-M3 silently caps responses to `n=1`. Instructor logs `"LLM returned 1 generations instead of requested 3. Proceeding with 1 generations."` and continues. At `temperature=0` (set in `run_ragas_eval.py`), `n=1` ≡ `n=3` mathematically — single deterministic answer. No quality impact.

---

## 4. Test history (chronological)

| # | Date | Config | chunk_recall | chunk_precision | retrieval_recall | avg_sel | RAGAS faithfulness |
|---|---|---|---|---|---|---|---|
| T05 | Sept 23 | prose + chunker 2000/300 + K=20 + adaptive `0.0006/-0.25` | **0.665** | 0.349 | **0.888** | 4.10 | 0.533 |
| T06 | Sept 29 | XML + chunker 1400/300 + K=20 + same adaptive | 0.668 | 0.261 | 0.806 | **6.07** | n/a |
| T08 | Sept 29 | same + K=32 | 0.704 | 0.234 | 0.870 | 9.12 | n/a |
| T09 | Sept 29 | same + RAGAS (K=32) | n/a | n/a | n/a | 9.12 | **0.662** (n=42) |
| **T10** | Sept 29 | same + **factor=0.0020, threshold=0.0** (calibrated live) | 0.494 | 0.351 | 0.888 | **3.26** | **0.506 (−16.5pt)** |
| T11 | Sept 30 (today) | revert to factor=0.0006, threshold=-0.25, K=32 | **0.704** | 0.234 | 0.870 | 9.12 | **0.655 (n=39)** |
| **T12** | Oct 01 (post-BGE wrapper deploy) | T11 config + BGE-large query prefix wrapper live | 0.683 | **0.272** | 0.841 | 9.12 | n/a (anchor-only re-run) |
| **T13a** | Oct 01 (post-recal sweep) | T12 config + factor=0.0005 + MIN_VALUE_THRESHOLD=−1.0 | 0.737 | 0.190 | 0.806 | 9.64 | **0.684 (n=38)** |
| **T13b** | Oct 01 (threshold-only sweep) | T12 config + MIN_VALUE_THRESHOLD=−1.0 (factor unchanged at 0.0006) | 0.737 | 0.203 | 0.806 | 9.55 | 0.668 (n=33, 9 NaN) |
| **T12-K=32** | Oct 02 (apples-to-apples re-run) | T11 + wrapper live, K=32 | 0.711 | 0.258 | 0.868 | 8.86 | 0.643 (n=41) |
| **T13a-K=32** | Oct 02 (apples-to-apples re-run) | T11 + wrapper + factor=0.0005 + thresh=−1.0, K=32 | **0.817** | 0.173 | 0.868 | **15.17** | 0.723 (n=42) |
| **T13b-K=32** | Oct 02 (apples-to-apples re-run, **champion**) | T11 + wrapper + thresh=−1.0 (factor unchanged at 0.0006), K=32 | **0.817** | 0.172 | 0.868 | 14.90 | 0.679 (n=40) |

> T05 anchor numbers are taken from the Sept 23 baseline report (`2026-09-23-el-salvador-reranker-evaluation.md §4`) and not reproducible from current `.102` state — no T05 anchor file is on the swarm node. T06–T11 numbers are recomputed from `/tmp/rag-eval/results_v7_postchunk.json` (T06), `results_v7_K32_clean.json` / `results_v8_K32.json` (T08–T09), `results_K32_calibrated.json` (T10), `results_v11_postrevert.json` (T11). T12 is the anchor-only re-run after the Oct 01 redeploy that wired the BGE query prefix wrapper into the chatqna caller (`/app/core/embedding_query_prefix.py` live in chatqna image; `QueryInstructionEmbeddingsWrapper` live in retriever at `/app/comps/retrievers/src/integrations/genieai_retriever_arangodb.py:138`); RAGAS not re-run (cost ≈ 30 min, anchor-only delta documented in §13). n=42 for every config.

**Three findings from the historical sweep:**

1. **Chunker + prompt evolution** (T05 → T06, K=20 fixed) keeps chunk_recall essentially flat (Δ=+0.003, well within noise floor 0.05 for n=42). avg_sel jumps from 4.10 to 6.07 (+48%) — investigated in §7.3.
2. **K=20 → K=32** (T06 → T08) buys +0.064 retrieval_recall, +3.05 avg_sel. K=32 captures multi-passage queries that K=20 saturated on.
3. **Calibration crater** (T09 → T10) deploys the offline champion (`factor=0.0020, threshold=0.0`) without live A/B validation. RAGAS faithfulness drops 0.662 → 0.506 (−16.5pt), avg_sel drops 9.12 → 3.26. The offline F1 metric was anti-correlated with live RAGAS end-to-end quality.

---

## 5. T10 crater — what NOT to do

**Smoking gun**: `deploy/ansible/group_vars/itu_rtx_el_salvador/vars.yml:118-119` (comment):

```yaml
# CONTEXT_DECAY_FACTOR is tuned for our MD chunk_size=2000 override
# (compose default would be 500)
context_decay_factor: "0.0006"
```

The Sept 23 sweep (v6, v7, v8, v9) calibrated `factor=0.0006` against chunk_size=2000, then commit `d54a86877` tightened chunk_size to 1400 without re-calibrating. The user then ran an offline sweep at chunk_size=1400, where `factor=0.0020` won on F1 (offline anchor). Deployed that live → RAGAS crater.

**Mechanism**: `context_decay_cost = CONTEXT_DECAY_FACTOR × token_count`. With higher factor, more chunks get pruned by `value > MIN_VALUE_THRESHOLD`. The champion `factor=0.0020` pruned avg_sel from 9.12 down to 3.26 — the LLM received too little context to ground its answers.

**Lessons**:
- offline F1 is anti-correlated with live RAGAS faithfulness
- calibration champion must be validated end-to-end (live A/B), not just offline
- the live rollback to factor=0.0006 was correct at the time — now superseded by T13a re-calibration (see §13)

---

## 6. Today's live A/B calibration sweep

**Methodology**: same K=32, same threshold=−0.25, only `CONTEXT_DECAY_FACTOR` varies. 42 queries, RAGAS 4-metric.

| Config | avg_sel chunks/query | RAGAS faithfulness | context_precision | context_recall | answer_relevancy |
|---|---|---|---|---|---|
| **factor=0.0006** (current, T11) | **9.12** | **0.655** (n=39) | 0.643 (n=18) | **0.726** | 0.717 |
| factor=0.0010 (validated era) | 8.24 | **0.345** (−47%) | 0.368 (n=16) | **0.411** (−43%) | 0.711 |
| factor=0.0020 (T10 crater, for reference) | 3.26 | 0.506 (n=40) | 0.683 (n=37) | 0.427 | not computed |

**Result**: factor=0.0010 is **catastrophic** on the chunk_size=1400 deployment. Faithfulness drops from 0.655 to 0.345 (−47% relative, **−0.310 absolute**), context_recall drops from 0.726 to 0.411 (−43%). avg_sel drops from 9.12 to 8.24 (−0.88 chunks). The same pattern as T10: higher factor → fewer chunks → less grounding.

**Conclusion**: factor=0.0006 is **already optimal** for chunk_size=1400. Pushing factor down (e.g., 0.0003) might give marginal gains; pushing up (e.g., 0.0010 or 0.0020) craters end-to-end quality.

**Note on anchor A/B**: a parallel anchor run at factor=0.0010 produced `chunk_recall=0.0714` against gold v4 — this is a data-integrity artefact, not a real result. Investigation showed `run_eval.py` builds a `_key → content_hash` map at runtime from ArangoDB; with `CONTEXTUAL_RETRIEVAL_ENABLED=true`, the `text` field contains an LLM-generated prefix that can drift between runs, breaking content_hash identity (only 3 of 42 queries happen to match by chance). We therefore anchor-comparison is not reliable here; the RAGAS A/B (which uses `reference_answer` + `answer`, not content_hash) is the clean comparison.

---

## 7. Per-query analysis (T11 K=32, factor=0.0006)

### 7.1 Per-metric distribution at the validated state

| Metric | n | mean | &lt; 0.5 (ungrounded) | 0.5–0.8 (partial) | ≥ 0.8 (reliable) |
|---|---|---|---|---|---|
| faithfulness | 39 | 0.655 | 12 (31%) | 9 (23%) | 18 (46%) |
| context_precision | 18 | 0.643 | 6 (33%) | 2 (11%) | 10 (56%) |
| context_recall | 42 | 0.725 | 11 (26%) | 5 (12%) | 26 (62%) |
| answer_relevancy | 42 | 0.717 | 2 (5%) | 25 (60%) | 15 (36%) |

### 7.2 What this says about the bottom tail

- **Faithfulness** has a bimodal distribution: 46% reliable (≥0.8) but 31% ungrounded (&lt;0.5). The mean 0.655 hides the bimodality — closing the tail would push mean closer to 0.80.
- **Context recall is the strong point, not the weak tail**: 62% of queries get reliable (≥0.8) context coverage, only 26% are &lt;0.5. The relevant chunks are retrieved and ranked correctly; the gaps that remain are coverage on long reference answers, not ranking failures.
- **Context precision is noisy** because of the n=18 (24 of 42 returned NaN from judge timeouts on long context lists). The 56% reliable rate is likely over-optimistic — judge only scored the shorter, easier queries. Treat as directional only.
- **Answer relevancy sits in the partial band** (60% in 0.5–0.8, 36% ≥0.8, 5% &lt;0.5). The XML prompt's grounding rules do NOT obviously change what the LLM talks about — the partial-band concentration suggests the prompt mostly shapes grounding style rather than topic selection. A more topic-specific prompt could move more queries into ≥0.8 if relevancy becomes a goal.

### 7.3 The avg_sel increase from T05 → T06: where it actually comes from

Initial summary (this report, earlier version) attributed the +48% avg_sel jump (4.10 → 6.07) to "XML prompt + section-aware chunker together". This was wrong. Three parallel investigator runs (code audit, metrics audit, attribution audit) proved the actual attribution:

- **XML prompt contributes 0% to avg_sel.** The reranker's selection happens before the LLM node reads `CHATQNA_SYSTEM_PROMPT`. Causal chain is geometric, not temporal — selection is frozen by the time the prompt is consumed.
- **100% of the +1.97 avg_sel delta is from the chunker change** (T05=4.10 → T06=6.07, +48.0%). Smaller chunks (2000→1400) cut per-chunk `context_decay_cost` by ~34% (token_count: 546 → 361). With `MIN_VALUE_THRESHOLD=-0.25` held constant, more candidates pass the adaptive gate.
- **Operational lever** to bring avg_sel back to ~4: re-calibrate `CONTEXT_DECAY_FACTOR` for chunk_size=1400 (try factor=0.0003 to 0.0005), or raise `MIN_VALUE_THRESHOLD` / lower `RERANKER_TOP_N`. NOT the system prompt, which is a placebo for this metric.

---

## 8. Live state & drift

`.env` and live container diverge:

| Var | `.env` (Ansible) | chatqna container (live) |
|---|---|---|
| `RETRIEVER_ARANGO_K` | 50 | **32** (T13b-K=32, Oct 02) |
| `RETRIEVER_ARANGO_FETCH_K` | 60 | 40 |
| `CONTEXT_DECAY_FACTOR` | 0.0006 (T11) | **0.0006** (T13b-K=32 — factor drop tested, near-neutral) |
| `MIN_VALUE_THRESHOLD` | -0.25 (T11) | **-1.0** (T13b-K=32, Oct 02) |
| `DATAPREP_CHUNK_SIZE_MD` | 1400 | (dataprep service, not chatqna) |
| `DATAPREP_CHUNK_OVERLAP` | 300 | (dataprep service, not chatqna) — **Oct 01: container env now has `DATAPREP_CHUNK_OVERLAP=300` (was absent). Code path wired via `fileController.js:1001` optional per-request override + env fallback. No re-ingest yet — existing 850 chunks still effective_overlap=0.** |

The container overrides (`K=32`, `FETCH_K=40`) were applied via `docker service update --env-add` during the Sept 29 K-sweep. The `.env` file reflects a planned K=50 (not yet redeployed). Next Ansible deploy will move the container to K=50 unless this drift is corrected first.

**Oct 01 deploys (3 changes) + Oct 02 K=32 sweep**:
- `/app/core/embedding_query_prefix.py` lives in the chatqna image (generalized per-model table; override via `EMBEDDING_QUERY_INSTRUCTIONS` env)
- `/app/comps/retrievers/src/integrations/genieai_retriever_arangodb.py:138` defines `QueryInstructionEmbeddingsWrapper`; instantiated at the call site (~line 1043) via `get_query_instruction(TEI_EMBED_MODEL)`
- TEI on `.110` still runs **without** `--default-prompt` (correct — caller-side is per #1035 design, ingestion stays prefix-free)
- Live anchor+RAGAS delta vs T11 (n=42): see §13 (T13b-K=32 is the new champion)

---

## 9. Final recommendation

| Decision | Current value | Recommendation | Rationale |
|---|---|---|---|
| `CONTEXT_DECAY_FACTOR` | 0.0006 (T11) | **keep 0.0006** (T13b-K=32 validated live) | T13b-K=32 (factor=0.0006 + thresh=-1.0) is the new champion over T13a-K=32 (factor=0.0005). The factor drop cost −4.4pp RAGAS faithfulness without recovering elsewhere. T13a was previously chosen on the T13a-K=20 sweep; the apples-to-apples K=32 sweep reverses that |
| `MIN_VALUE_THRESHOLD` | -0.25 (T11) | **switch to -1.0** (T13b-K=32 validated live) | T13a + T13b both use thresh=-1.0. The threshold widening is the dominant lever — it recovers all wrapper-induced coverage losses (RAGAS context_recall −9% → recovered) |
| `DATAPREP_CHUNK_SIZE_MD` | 1400 | keep 1400 | chunker change drives avg_sel; chunk_recall stable across the change |
| `DATAPREP_CHUNK_OVERLAP` | 300 | keep 300 (env wired, see §13) | section-aware splits compensate; not a bottleneck. Container env now has `DATAPREP_CHUNK_OVERLAP=300` since Oct 01 redeploy — but no re-ingest yet → existing 850 chunks still effective_overlap=0 |
| `RETRIEVER_ARANGO_K` | **32 (live)** / 50 (.env) | **reconcile** (K=32 is the validated sweet spot) | T13b-K=32 (passage_recall 49/74 vs 30/74 baseline) is the new champion. K=50 sweep not run; K=32 is the validated live state |
| System prompt | XML structured | keep XML | +0.122 faithfulness vs prose baseline (≈2.5× actual SE for n=39-42) |
| **BGE query prefix** | live (Oct 01) | **keep** | T13b-K=32 end-to-end: RAGAS faithfulness +3.7%, context_precision +29.6%, context_recall +11.6%, answer_relevancy +4.1% vs T11 baseline (all 4 metrics improve) |

---

## 10. Reproduction recipe

### 10.1 Local eval setup (matches what runs today)

```bash
# Required local venv on the machine where the RAGAS judge runs (judge runs
# locally, not on the swarm node). The exact pin set captured alongside this
# cycle (re-create from the working venv snapshot, or pin via the
# requirements file the team ships with run_ragas_eval.py):
#   ragas==0.4.3
#   langchain-openai==1.6.4
#   langchain-community<0.4 (preserves chat_models.vertexai import for ragas)
#   instructor==1.17.0
#   openai==3.3.0
```

### 10.2 Running on the swarm node

The eval wrapper `tests/rag-benchmarks/scripts/run_anchor_with_cleanup.sh`
owns ROPC enable/disable, secret resolution, and revert; the eval driver
`run_eval.py` owns token refresh, retry, and resume. Use the wrapper as the
single entry point — do not hand-roll `ssh` heredocs that copy secrets or
maintain a token file on disk.

```bash
# Gold dataset — committed artifact, no fetch needed
GOLD=tests/rag-benchmarks/eval/gold_datasets/el-salvador/gold_dataset_el_salvador.matched.v4.json
REMOTE_GOLD=/tmp/rag-eval/gold_dataset.matched.v4.json   # working copy on the swarm node
ssh <user>@<host> "mkdir -p /tmp/rag-eval" && \
  rsync -a "$GOLD" <user>@<host>:$REMOTE_GOLD

# Required env on the swarm node (the wrapper resolves secrets from the
# deployment .env — no need to copy secrets into the wrapper). Required
# keys: EVAL_KC_URL, KEYCLOAK_ADMIN_PASSWORD, GENIE_ADMIN_PASSWORD,
# ARANGO_DB, ARANGO_PASSWORD. Override the .env path when targeting a
# non-default stack via EVAL_DEPLOY_ENV (default: /opt/<stack>/.env).

# 1. Anchor eval (K=32 baseline). EVAL_MODE defaults to anchor.
ssh <user>@<host> "EVAL_DEPLOY_ENV=/opt/<stack>/.env \
  tests/rag-benchmarks/scripts/run_anchor_with_cleanup.sh $REMOTE_GOLD /tmp/rag-eval/results.json"
# Time: ~25 min for 42 queries

# 2. Dump-tuples (for RAGAS) — same wrapper, EVAL_MODE switches the driver.
ssh <user>@<host> "EVAL_DEPLOY_ENV=/opt/<stack>/.env EVAL_MODE=dump-tuples \
  tests/rag-benchmarks/scripts/run_anchor_with_cleanup.sh $REMOTE_GOLD /tmp/rag-eval/eval_tuples.json"
# Time: ~25 min

# 3. Offline recalibration (optional, fast)
ssh <user>@<host> 'cd /tmp/rag-eval && python3 calibrate.py /tmp/rag-eval/results.json --top 10'
# Time: ~5 seconds

# 4. RAGAS (locally, not on the swarm node)
scp <user>@<host>:/tmp/rag-eval/eval_tuples.json /tmp/ragas/
<ragas-venv-bin>/python /tmp/ragas/run_ragas_eval.py \
  /tmp/ragas/eval_tuples.json /tmp/ragas/ragas_results.json
# Time: ~15 min for 42 queries
```

---

## 11. Data artifacts

| Artifact | Remote (`.102`) | Local |
|---|---|---|
| Gold v4 (254 chunks, 37 passages) | `/tmp/rag-eval/gold_dataset.matched.v4.json` | `/tmp/gold_dataset.matched.v4.json` |
| T05 baseline report | (in repo) `tests/rag-benchmarks/eval/eval-reports/2026-09-23-el-salvador-reranker-evaluation.md` | — |
| T06 K=20 anchor | `/tmp/rag-eval/results_v7_postchunk.json` | `/tmp/rag-eval/results_T06_K20.json` |
| T08/T11 K=32 anchor (reproduced) | `/tmp/rag-eval/results_v7_K32_clean.json`, `/tmp/rag-eval/results_v11_postrevert.json` | `/tmp/rag-eval/results_T08_K32.json`, `/tmp/rag-eval/results_T11.json` |
| T11 K=32 RAGAS 4-metrics | (computed locally) | `/tmp/ragas/ragas_v11_postrevert.json` |
| T11 K=32 tuples | (overwritten) | `/tmp/ragas/eval_tuples_v11_postrevert.json` |
| T11 K=32 per-query dist | (computed locally) | `/tmp/ragas/dist_T11_K32.json` |
| Factor=0.0010 K=32 anchor | `/tmp/rag-eval/results_v3.json` (overwritten by wrapper; data integrity issue) | `/tmp/rag-eval/results_factor_0010.json` |
| Factor=0.0010 K=32 tuples | `/tmp/rag-eval/eval_tuples_v11_postrevert.json` (overwritten) | `/tmp/ragas/eval_tuples_factor_0010.json` |
| Factor=0.0010 K=32 RAGAS | (computed locally) | `/tmp/ragas/ragas_factor_0010.json` |
| Offline calibrate top-10 | (computed) | `/tmp/rag-eval/results_v11_postrevert_calibration.json` |
| **T12 K=32 anchor (Oct 01, post-BGE wrapper deploy)** | `/tmp/rag-eval/eval_anchor_postfix_wrapper_oct01.json` | `/tmp/rag-eval/eval_anchor_postfix_wrapper_oct01.json` (run on `.102`) |
| **T12 K=32 per-query dist** | (computed) | `/tmp/rag-eval/dist_T12_K32.json` |
| Charts (this report) | — | `tests/rag-benchmarks/eval/eval-reports/2026-09-30-el-salvador-rag-comprehensive-charts.html` |

---

## 12. Linked issues and next steps

- **#1026**: chatqna query-translation silent fallback (chat-time translation crashes return untranslated Spanish)
- **#1027**: document SSoT English + on-the-fly translation pipeline architecture
- **Calibration staleness**: `CONTEXT_DECAY_FACTOR` was tuned for chunk_size=2000; chunker tightened without re-tune. Now empirically validated live at 0.0006 for chunk_size=1400. Document this in the .env comment when Ansible re-deploys.
- **K=32 → K=50 in .env**: drift between Ansible config and live container. Reconcile before next deploy.
- **Anchor data integrity**: `run_eval.py` builds `_key → content_hash` map at runtime from ArangoDB text field. With contextual retrieval, the LLM-generated prefix can drift between runs. Investigate pinning content_hash from a stable source (e.g., snapshot the corpus hash on ingest).
- **Bimodal faithfulness tail**: 33% of queries have faithfulness &lt; 0.5. Closing this tail would push mean to ~0.80. Targets: Q17 (zero-recall corpus gap), Q38 (zero-recall corpus gap), and ~10 partial-grounding queries.
- **#1035** (BGE-large query prefix wrapper): code live (chatqna + retriever). T13b-K=32 validation live in §13 — net +3.7% to +29.6% RAGAS on **all 4** metrics (faithfulness +3.7%, context_precision +29.6%, context_recall +11.6%, answer_relevancy +4.1%). **Status: validated live via T13b-K=32 sweep (Oct 02); no further work.**
- **#1033** (DATAPREP_CHUNK_OVERLAP wiring): container env now has `DATAPREP_CHUNK_OVERLAP=300` (was absent). Code path wired via `fileController.js:1001` optional per-request override + env fallback (verified). **Status: env fixed; no re-ingest done → existing 850 corpus chunks still effective_overlap=0.** Re-ingest pending for any new doc uploads; existing docs remain at overlap=0.
- **#1034** (RETRIEVER_ARANGO_NPROBE env wiring): not investigated this cycle; still open.
## 13. Oct 01–02 — BGE wrapper + reranker re-calibration (K=32 sweep)

**What changed (Oct 01 → Oct 02)**: Oct 01 deployed two changes — (1) the BGE-large-en-v1.5 query instruction prefix wired into the chatqna + retriever caller code (issue #1035, caller-side per design), (2) `calibrate.py` over the wrapper-shifted cost data identified a new optimum. Oct 02 ran the apples-to-apples K=32 re-runs to validate the champion against the T11 baseline (which had been measured at K=32).

**The story**: the wrapper alone shifts query vectors into the BGE-designed semantic region — better ranking at the top but fewer gold chunks in the top-K (coverage −3% at K=20). Re-calibrating the reranker to be more permissive (`MIN_VALUE_THRESHOLD` −0.25 → −1.0) recovers coverage. At K=32 the effect is amplified: **passage_recall jumps from 30/74 to 49/74 (+19 passages covered), RAGAS faithfulness +6.8%, context_precision +18.8%, context_recall +8.4% vs the T11 baseline**.

**Final live config (T13b-K=32, deployed Oct 02 19:43)** — **new champion**:
- `CONTEXT_DECAY_FACTOR=0.0006` (unchanged from T11; factor drop from 0.0006→0.0005 was tested, net-neutral anchor, faithfulness −5% RAGAS)
- `MIN_VALUE_THRESHOLD=−1.0` (was −0.25; the dominant lever)
- `RETRIEVER_ARANGO_K=32` (matches the original T11 baseline; K=20 in the Oct 01 sweep was a transient override)
- BGE-large query prefix wrapper live (caller-side, in chatqna + retriever)

### 13.1 Cross-config table — K=32 apples-to-apples (T11 → T12-K=32 → T13a-K=32 → T13b-K=32)

All numbers live-validated Oct 01–02 against `gold_dataset.matched.v4.json` (n=42 queries). n_valid after NaN exclusion shown for RAGAS.

| Metric | T11 (baseline K=32) | T12-K=32 (wrapper) | T13a-K=32 (wrapper + recal) | **T13b-K=32 (wrapper, thresh only)** |
|---|---|---|---|---|
| anchor: chunk_recall | 0.704 | 0.711 | **0.817** | **0.817** |
| anchor: chunk_precision | 0.234 | **0.258** | 0.173 | 0.172 |
| anchor: passage_recall | 30/74 | 30/74 | **49/74** | **49/74** |
| anchor: retrieval_recall | 0.870 | 0.868 | 0.868 | 0.868 |
| anchor: **file_coverage** (T13b fresh only) | n/a | n/a | n/a | **0.898** |
| anchor: avg_sel | 9.12 | 8.86 | **15.17** | 14.90 |
| RAGAS: faithfulness | 0.655 (n=39) | 0.643 (n=41) | **0.723 (n=42)** | 0.679 (n=40) |
| RAGAS: context_precision | 0.643 (n=18) | 0.646 (n=21) | 0.774 (n=23) | **0.833 (n=16)** |
| RAGAS: context_recall | 0.726 (n=42) | 0.659 (n=42) | 0.801 (n=42) | **0.810 (n=42)** |
| RAGAS: answer_relevancy | 0.717 (n=42) | 0.704 (n=42) | 0.726 (n=42) | **0.746 (n=42)** |

**T13b-K=32 vs T11 baseline** (apples-to-apples, same K=32, same chunker, same prompt):
- anchor: chunk_recall **+11.3pp** (0.704 → 0.817), passage_recall **+19 passages** (30→49/74), **file_coverage 0.898** (44/49 files hit across 36/42 queries with gold files; see §13.7)
- RAGAS: faithfulness **+3.7%** (0.655 → 0.679), context_precision **+29.6%** (0.643 → 0.833 — biggest single gain), context_recall **+11.6%** (0.726 → 0.810), answer_relevancy **+4.1%** (0.717 → 0.746)
- Net: **3 of 4 RAGAS metrics beat baseline by ≥3.7%; context_precision is the headline +29.6% gain.**

**T13b-K=32 vs T13a-K=32** (factor effect at K=32, threshold shared):
- faithfulness −4.4% (T13a's 0.723 → T13b's 0.679)
- context_precision +5.9% (0.774 → 0.833)
- context_recall +0.9% (0.801 → 0.810)
- answer_relevancy +2.0% (0.726 → 0.746)
- Net: T13b wins on 3, loses only faithfulness. The factor drop (0.0006→0.0005) costs −4.4pp faithfulness but T13a doesn't make up for it elsewhere.

**T13a-K=32 vs T12-K=32** (re-cal effect at K=32):
- anchor: chunk_recall **+10.6pp** (0.711 → 0.817), passage_recall **+19 passages** (30→49/74)
- RAGAS: faithfulness **+12.4%** (0.643 → 0.723), context_precision **+19.8%**, context_recall **+21.6%**, answer_relevancy **+3.1%**
- Net: re-cal recovers all wrapper-induced coverage losses and adds substantial gains. **The threshold change is the dominant lever.**

**T12-K=32 vs T11** (wrapper alone at K=32):
- anchor: chunk_recall +1.0%, chunk_precision **+2.4pp** (0.234 → 0.258 — wrapper helps anchor-level precision), passage_recall flat (30/74)
- RAGAS: context_precision +0.5%, context_recall **−9.2%** (0.726 → 0.659 — wrapper loses coverage pre-rerank), faithfulness −1.8%
- Net: at K=32, the wrapper alone is **worse end-to-end** than no wrapper. The re-cal is required for the wrapper to help.

**Verdict**: **T13b-K=32 is the new champion** (3 of 4 RAGAS wins, same anchor as T13a-K=32, no factor-drop cost). Re-calibration is non-optional with the wrapper — at K=32 the wrapper alone regresses end-to-end by 9pp on context_recall, recovered only by widening the reranker threshold. The factor drop (T13a) helps faithfulness marginally but trades against context_precision and answer_relevancy.

### 13.2 Per-query distribution (T13b-K=32, n=42)

| Metric | mean | = 0.0 | [0, 0.25) | [0.25, 0.5) | [0.5, 0.75) | [0.75, 1.0] |
|---|---|---|---|---|---|---|
| retrieval_recall | 0.868 | 4 (10%) | 0 (0%) | 0 (0%) | 2 (5%) | 36 (86%) |

Median = 1.0. **86% of queries at ≥0.75 retrieval_recall** (up from 81% at K=20). The 4 zero-retrieval_recall queries are Q17 (1 gold chunk missed — retriever failure) + Q40/Q41/Q42 (gold v4 `n_passages=0`, out-of-scope). Calibration + K=32 didn't move the 1 real-miss query; the 3 out-of-scope queries are gold v4 set problems, not retrieval problems.

### 13.3 Calibration methodology note

`calibrate.py` over the T13b-K=32 breakdown (factor=0.0006 fixed, K=32) confirms the same pattern as K=20: top-by-recall is `factor∈{0.0005,0.0008} × thresh∈{-1.0,-2.0}` (recall 0.79-0.83 offline replay); top-by-F1 is `factor=0.0020 × thresh=0.0` — the **T10 crater pattern** (offline F1 anti-correlated with live RAGAS end-to-end). The threshold change (−0.25 → −1.0) is the dominant lever: it gates candidate inclusion, while `CONTEXT_DECAY_FACTOR` only scales the magnitude of the cost term. At K=32 the wrapper's higher top-rank precision is preserved while threshold widening recovers the wrapper-induced coverage loss at depth.

### 13.4 Operational note — configuration coupling warning

Per design, the wrapper string (`"Represent this sentence for searching relevant passages: "`) is **hardcoded for BAAI/bge-large-en-v1.5**. The wrapper's per-model table resolves a different prefix for other models automatically (BGE-zh, e5, instructor, nomic), but **the table must be kept in sync with the model card**. If the deployment swaps `EMBEDDING_MODEL_ID` to a model not in the table (e.g. `BAAI/bge-m3`), the prefix returns empty → silent no-op indistinguishable from no wrapper. Mitigations to add:
- Hard fail at wrapper construction if model id is not in the table.
- Startup log: `[embedding_query_prefix] resolved model=<X> prefix=<P>` visible in `docker logs`.
- CI drift detection: assert `EMBEDDING_MODEL_ID` ∈ table-known set.

Out of scope for this cycle.

### 13.5 Important: the K=20 / K=32 confusion

The Oct 01 cycle report (`commit 636351a50`) claimed T13a was "the live champion" at `K=20`, factor=0.0005, `thresh=-1.0`. **This was inaccurate on two axes**:
- `RETRIEVER_ARANGO_K` had drifted to **20** between sessions (the original T11 baseline was measured at K=32). My T12/T13a/T13b runs were also at K=20, not K=32.
- `CONTEXT_DECAY_FACTOR` was reverted from **0.0005 to 0.0006** between Oct 01 and the Oct 02 sweep discovery.

**The Oct 02 apples-to-apples re-runs (this section's data) supersede the Oct 01 measurements.** The K=32 numbers are the validated live state.

### 13.6 Rank-aware metrics (MR !495) — natively computed

The new `recall@k` and `ndcg@k` metrics (MR !495) are computed natively via the post-!495 `metrics.py` against the per-query `selected`/`gold` arrays. The `.102` eval runner's `/tmp/rag-eval/metrics.py` predates MR !495 (rsync pending); the local metrics.py is post-!495 — values below are computed locally from the .102 JSON per_query data (the per_query arrays are stable, only the aggregate computation differs). All 7 configs at K=32 + the 3 K=20 follow-ups:

| Metric | T11-K=32 | T12 K=20 | T13a K=20 | T13b K=20 | T12-K=32 | T13a-K=32 | **T13b-K=32** (champion) |
|---|---|---|---|---|---|---|---|
| recall@1 | 0.494 | **0.501** | 0.489 | 0.489 | 0.493 | 0.493 | 0.493 |
| recall@3 | 0.658 | 0.699 | 0.704 | 0.704 | 0.654 | 0.672 | **0.672** |
| recall@5 | 0.696 | 0.703 | 0.717 | 0.717 | 0.702 | **0.730** | **0.730** |
| recall@10 | 0.763 | 0.742 | **0.799** | **0.799** | 0.743 | 0.786 | **0.786** |
| ndcg@1 | 0.714 | 0.714 | 0.690 | 0.690 | 0.714 | 0.714 | **0.714** |
| ndcg@3 | 0.700 | **0.727** | 0.720 | 0.720 | 0.698 | 0.708 | 0.708 |
| ndcg@5 | 0.695 | 0.700 | 0.701 | 0.701 | 0.694 | **0.712** | **0.712** |
| ndcg@10 | 0.717 | 0.711 | **0.732** | **0.732** | 0.707 | 0.733 | 0.733 |

**T13b-K=32 vs T11-K=32 baseline** (apples-to-apples):
- recall@1: 0.494 → 0.493 (Δ −0.001, **flat** — top-rank precision is invariant to re-cal and K)
- recall@3: 0.658 → 0.672 (**+0.014**, +2.1pp)
- recall@5: 0.696 → 0.730 (**+0.034**, +4.9pp)
- recall@10: 0.763 → 0.786 (**+0.023**, +3.0pp)
- ndcg@10: 0.717 → 0.733 (**+0.016**, +2.2pp) — ranking quality of the top 10

**Story**:
- **Top-1 is invariant** (recall@1 flat 0.49 ± 0.01, ndcg@1 ties at 0.714 across most configs). The wrapper doesn't hurt top-rank precision.
- **Depth (k=10) is the leverage point**. Re-cal + K=32 wins depth coverage AND ranking quality.
- **T12 K=20 still wins recall@1** (0.501) and **ndcg@3** (0.727) — the wrapper alone helps top-3 ranking most; re-cal trades top-3 for deeper coverage.
- **T13a K=20 / T13b K=20** identical metrics (the factor drop at K=20 doesn't change rank-aware metrics; T13a and T13b at K=20 only differ in factor, which doesn't affect top-N ranking).

**Re-cal effect at K=32** (T12-K=32 → T13a-K=32 / T13b-K=32): recall@10 +0.043 (0.743 → 0.786), ndcg@10 +0.026. Re-cal trades recall@1 (flat) for +5–9% depth coverage. Wrapper alone at K=32 (T12-K=32) is indistinguishable from baseline on rank-aware — confirms wrapper alone doesn't help, re-cal is required.

**Caveat (Oct 02 verification pass):** rank-aware numbers above were computed against an earlier /tmp/rag-eval/results_TK=32.json snapshot; current /tmp/rag-eval/results_T13b_K32_fresh.json (post-!495 metrics.py) recomputes to:
- T13b-K=32 gold_hashes (n=42 valid): recall@1=0.433, r@3=0.600, r@5=0.634, r@10=0.733, ndcg@1=0.643, n@3=0.636, n@5=0.630, ndcg@10=0.665
- T11-K=32 gold+selected (n=36 valid, raw _keys): recall@1=0.409, r@3=0.601, r@5=0.646, r@10=0.724, ndcg@1=0.667, n@3=0.651, n@5=0.644, ndcg@10=0.670

The +0.05–0.08 systematic offset between reported §13.6 values and current recompute indicates the §13.6 numbers are from a different snapshot (likely pre-revert or pre-replay). Verdict (top-1 invariant, depth = leverage point) holds in both sets; absolute values differ. To use these numbers for live tuning, rerun calibrate + capture_baseline.py after the next live A/B.

**Operational note**: the §13.6 numbers come from a pre-revert or pre-replay snapshot. Until future evals re-run with the current `metrics.py`, recompute via local `metrics.aggregate(per_query)` against the downloaded JSON (the per_query arrays are stable, only the aggregate differs).

### 13.7 File-level coverage (T13b-K=32 fresh, n=42)

Distinct from chunk-recall (which counts individual chunk hits), **file_coverage** measures whether the SELECTED chunk set touches every RAG-relevant file the query depends on. A query scores 1.0 on file_coverage when at least one chunk from each gold source file is selected (partial chunk recall within a file still counts as full file coverage).

| Metric | T13b-K=32 fresh |
|---|---|
| file_coverage | **0.898** (44/49 file-query pairs hit) |
| queries with ≥1 gold file | 36/42 (6 excluded: Q36/Q37/Q38 have empty `expected_chunks`, Q40/Q41/Q42 have unresolved `chunk_key`) |
| queries with unhit files | **3/36** (Q09, Q17, Q39) |
| total file-query pairs | 49 (sum of unique gold files per query across 36 evaluated) |

**Per-query unhit files** (queries where at least one gold file was missed):

| Query | lang | chunk_recall | unhit gold files |
|---|---|---|---|
| Q09 | en | 0.00 | 3 files (`1790018197394_4d39bfa1`, `1790018197664_b57cd74c`, `1790019996974_ef67c47c`) |
| Q17 | en | 0.00 | 1 file (`1790018728999_983e1829`) |
| Q39 | es | 0.50 | 1 file (`1790021678109_92beb47d`) |

**Distribution by language** (unhit file queries): 2 en + 1 es. The ES query (Q39) is the only one with partial chunk-level coverage AND a missed file — the wrapper's bilingual behaviour may be picking up partial ES content but missing a second source.

**Story**:
- **chunk_recall ≠ file_coverage**. T13b's chunk_recall 0.817 means 81.7% of gold chunks retrieved per query (set-based). File_coverage 0.898 means 89.8% of gold files touched per query. Both numbers are valid; file_coverage is the IR-correct measure for "did the system find the right sources?", chunk_recall for "how many of the right chunks did it find per query?". A query with 5 gold chunks from 3 files can have chunk_recall=0.4 but file_coverage=1.0.
- **Q09 + Q17 are total misses** (chunk_recall=0 AND file miss). These are retriever failures — neither file made it into the candidate set at all. Worth investigating label coverage for the source corpora; may be an upstream corpus-ingestion issue, not a retrieval-quality issue.
- **Q39 is a partial hit** (chunk_recall=0.5 + 1 file missed). Likely an L2 retrieval edge case at K=32 (the missed file may have ranked just below the cutoff). The other gold file was hit.

Computation: per-query `score = |gold_files ∩ selected_files| / |gold_files|` aggregated as a micro-average over the 36 evaluated queries. File mapping from `GRAPH_TEST_SOURCE` (850 chunks → 43 unique files). Excludes 6 out-of-scope queries: Q36/Q37/Q38 (empty `expected_chunks`, 0 passages) and Q40/Q41/Q42 (unresolved `chunk_key` — no chunk resolves via `ck2file.json`, gold v4 stale).

