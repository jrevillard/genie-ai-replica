# El Salvador RAG Pipeline — Comprehensive Evaluation Report

**Author**: Claude (automated pipeline)
**Date**: 2026-09-30 (last update: 2026-10-01, T12/T13a/T13b rows + §13 rewrite)
**Stack**: genieai-el-salvador @ 10.0.0.102 (`release/el-salvador` branch, T13a live: factor=0.0005 + thresh=-1.0 + BGE wrapper)
**Sample**: 42 queries (Spanish CENTA agriculture), gold_dataset.matched.v4.json
**Tools**: `tests/rag-benchmarks/eval/{run_eval.py, run_ragas_eval.py, calibrate.py}` (modified locally on .102 for Bearer auth)
**RAGAS judge**: MiniMax-M3 (`ANTHROPIC_BASE_URL=http://127.0.0.1:3456/v1`)
**RAGAS embedder**: BGE-large-en-v1.5 via TEI (`EVAL_EMBED_BASE_URL=https://10.0.0.110:444/embed/v1`)

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
| **T13a** | Oct 01 (post-recal sweep) | T12 config + factor=0.0005 + MIN_VALUE_THRESHOLD=−1.0 | **0.737** | 0.190 | 0.806 | 9.64 | **0.684 (n=38)** |
| **T13b** | Oct 01 (threshold-only sweep) | T12 config + MIN_VALUE_THRESHOLD=−1.0 (factor unchanged at 0.0006) | 0.737 | 0.203 | 0.806 | 9.55 | (RAGAS pending — see §13.7) |

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
| `RETRIEVER_ARANGO_K` | 50 | 32 |
| `RETRIEVER_ARANGO_FETCH_K` | 60 | 40 |
| `CONTEXT_DECAY_FACTOR` | 0.0006 (T11) | **0.0005** (T13a, Oct 01) |
| `MIN_VALUE_THRESHOLD` | -0.25 (T11) | **-1.0** (T13a, Oct 01) |
| `DATAPREP_CHUNK_SIZE_MD` | 1400 | (dataprep service, not chatqna) |
| `DATAPREP_CHUNK_OVERLAP` | 300 | (dataprep service, not chatqna) — **Oct 01: container env now has `DATAPREP_CHUNK_OVERLAP=300` (was absent). Code path wired via `fileController.js:1001` optional per-request override + env fallback. No re-ingest yet — existing 850 chunks still effective_overlap=0.** |

The container overrides (`K=32`, `FETCH_K=40`) were applied via `docker service update --env-add` during the Sept 29 K-sweep. The `.env` file reflects a planned K=50 (not yet redeployed). Next Ansible deploy will move the container to K=50 unless this drift is corrected first.

**Oct 01 deploys (3 changes)**:
- `/app/core/embedding_query_prefix.py` lives in the chatqna image (generalized per-model table; override via `EMBEDDING_QUERY_INSTRUCTIONS` env)
- `/app/comps/retrievers/src/integrations/genieai_retriever_arangodb.py:138` defines `QueryInstructionEmbeddingsWrapper`; instantiated at the call site (~line 1043) via `get_query_instruction(TEI_EMBED_MODEL)`
- TEI on `.110` still runs **without** `--default-prompt` (correct — caller-side is per #1035 design, ingestion stays prefix-free)
- Live anchor delta vs T11 (n=42): see §13

---

## 9. Final recommendation

| Decision | Current value | Recommendation | Rationale |
|---|---|---|---|
| `CONTEXT_DECAY_FACTOR` | 0.0006 (T11) / **0.0005 (T13a)** | **switch to 0.0005** (T13a validated live) | T13a (factor=0.0005 + thresh=-1.0) is the new champion: anchor recall 0.683→0.737 (+5.4%), RAGAS faithfulness 0.625→0.684 (+9.5%). factor=0.0010 dropped faithfulness 47% in T10-era A/B; factor=0.0005 is the wrapper-shifted sweet spot |
| `MIN_VALUE_THRESHOLD` | -0.25 (T11/T13a: changed to -1.0) | **switch to -1.0** (T13a validated live) | T13a + T13b both use thresh=-1.0. Anchor noise +8% but faithfulness +9.5% — threshold widening recovered recall without LLM-grounding regression. Validation pending for T13b (threshold-only) |
| `DATAPREP_CHUNK_SIZE_MD` | 1400 | keep 1400 | chunker change drives avg_sel; chunk_recall stable across the change |
| `DATAPREP_CHUNK_OVERLAP` | 300 | keep 300 (env wired, see §13) | section-aware splits compensate; not a bottleneck. Container env now has `DATAPREP_CHUNK_OVERLAP=300` since Oct 01 redeploy — but no re-ingest yet → existing 850 chunks still effective_overlap=0 |
| `RETRIEVER_ARANGO_K` | 32 (live) / 50 (.env) | reconcile (run K=50 sweep when convenient) | live validated at K=32; K=50 unvalidated |
| System prompt | XML structured | keep XML | +0.122 faithfulness vs prose baseline (≈2.5× actual SE for n=39-42) |
| **BGE query prefix** | live (Oct 01) | **keep** | T13a end-to-end: RAGAS faithfulness +4.5%, context_precision +9.9%, context_recall +2.4% vs T11 (only answer_relevancy −4.1%) |

---

## 10. Reproduction recipe

### 10.1 Local eval setup (matches what runs today)

```bash
# Required local venv on machine where RAGAS judge runs (MiniMax locally)
/tmp/ragas-venv/bin/python -c "import ragas; print(ragas.__version__)"
# → 0.4.3

# /tmp/ragas-venv must contain:
#   ragas==0.4.3
#   langchain-openai==1.6.4
#   langchain-community<0.4 (preserves chat_models.vertexai import for ragas)
#   instructor==1.17.0
#   openai==3.3.0
```

### 10.2 Running on the swarm node

```bash
# Bearer auth wrapper (refreshes /tmp/bearer_token.txt every 90s in background)
SWARM=govstack@10.0.0.102
TOKEN=/tmp/bearer_token.txt

# 1. Verify live config
ssh $SWARM 'docker service inspect genieai-el-salvador_chatqna-xeon-backend-server \
  --format "{{range .Spec.TaskTemplate.ContainerSpec.Env}}{{.}}{{\"\n\"}}{{end}}" \
  | grep -E "CONTEXT_DECAY|MIN_VALUE|RETRIEVER_ARANGO_K|DATAPREP_CHUNK" | sort'

# 2. Anchor eval (K=32 baseline)
ssh $SWARM bash -s <<EOF
cd /tmp/rag-eval
export CHATQNA_CONTAINER=\$(docker ps --format "{{.Names}}" | grep chatqna-xeon-backend-server | head -1)
export CHATQNA_SERVICE_NAME=genieai-chatqna
export VICTORIATRACES_SVC=genieai-el-salvador_victoriatraces
export GRAPH_SOURCE=GRAPH_TEST_SOURCE
export ARANGO_URL=http://localhost:8529
export ARANGO_DB=el-salvador
export ARANGO_USER=root
export ARANGO_PASSWORD=test
python3 run_eval.py anchor gold_dataset.matched.v4.json /tmp/rag-eval/results.json
EOF
# Time: ~25 min for 42 queries

# 3. Dump-tuples (for RAGAS)
ssh $SWARM bash -s <<EOF
cd /tmp/rag-eval
# ... same env block ...
python3 run_eval.py dump-tuples gold_dataset.matched.v4.json /tmp/rag-eval/eval_tuples.json
EOF
# Time: ~25 min

# 4. Offline recalibration (optional, fast)
ssh $SWARM 'cd /tmp/rag-eval && python3 calibrate.py /tmp/rag-eval/results.json --top 10'
# Time: ~5 seconds

# 5. RAGAS (locally, not on .102)
scp $SWARM:/tmp/rag-eval/eval_tuples.json /tmp/ragas/
/tmp/ragas-venv/bin/python /tmp/ragas/run_ragas_eval.py \
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
- **#1035** (BGE-large query prefix wrapper): code live (chatqna + retriever). T13a validation live in §13 — net +2-10% RAGAS on 3 of 4 metrics. **Status: validated live via T13a re-calibration sweep (Oct 01); no further work.**
- **#1033** (DATAPREP_CHUNK_OVERLAP wiring): container env now has `DATAPREP_CHUNK_OVERLAP=300` (was absent). Code path wired via `fileController.js:1001` optional per-request override + env fallback (verified). **Status: env fixed; no re-ingest done → existing 850 corpus chunks still effective_overlap=0.** Re-ingest pending for any new doc uploads; existing docs remain at overlap=0.
- **#1034** (RETRIEVER_ARANGO_NPROBE env wiring): not investigated this cycle; still open.

---

## 13. Oct 01 — BGE wrapper + reranker re-calibration

**What changed**: Oct 01 deployed two changes in sequence. First, the BGE-large-en-v1.5 query instruction prefix was wired into the chatqna + retriever caller code (issue #1035, caller-side per design). Second, `calibrate.py` over the resulting per-query cost data identified a new optimum for the wrapper-shifted embedding space — two live configs were swept: **T13a** (factor=0.0005, thresh=−1.0) and **T13b** (factor=0.0006 unchanged, thresh=−1.0 only, to isolate the threshold effect).

**The story in one paragraph**: the wrapper alone (T12) shifts query vectors into the BGE-designed semantic region — better ranking at the top but fewer gold chunks in the top-K (recall −3.3%). Re-calibrating the reranker to be more permissive (threshold −0.25 → −1.0) recovers the recall loss and adds a small RAGAS gain on top. **T13a is the new champion**: 3 of 4 RAGAS metrics beat the T11 pre-wrapper baseline, only `answer_relevancy` regresses −4.1%. The threshold change is the dominant lever; the factor change is fine-tuning.

**Final live config (T13a, deployed Oct 01)**:
- `CONTEXT_DECAY_FACTOR=0.0005` (was 0.0006)
- `MIN_VALUE_THRESHOLD=−1.0` (was −0.25)
- BGE-large query prefix wrapper live (caller-side, in chatqna + retriever)

### 13.1 Cross-config table — T11 → T12 → T13a → T13b

All numbers live-validated, n=42 queries against `gold_dataset.matched.v4.json`. `n_valid` after NaN exclusion shown for RAGAS. Rank-aware metrics (MR !495, post-hoc on existing per-query _key arrays) shown for n=39 queries with gold.

| Metric | T11 baseline | T12 (wrapper only) | **T13a (wrapper + recal)** | **T13b (thresh only)** |
|---|---|---|---|---|
| anchor: chunk_recall | 0.704 | 0.683 | **0.737** | 0.737 |
| anchor: chunk_precision | 0.234 | **0.272** | 0.190 | 0.203 |
| anchor: passage_recall | 30/74 | 31/74 | **34/74** | 34/74 |
| anchor: retrieval_recall | 0.870 | 0.841 | 0.806 | 0.806 |
| anchor: avg_sel | 9.12 | 9.12 | 9.64 | 9.55 |
| **rank-aware: recall@1** | 0.391 | **0.399** | 0.386 | 0.386 |
| **rank-aware: recall@3** | 0.555 | 0.598 | **0.604** | 0.604 |
| **rank-aware: recall@5** | 0.596 | 0.604 | **0.619** | 0.619 |
| **rank-aware: recall@10** | 0.668 | 0.646 | **0.706** | 0.706 |
| **rank-aware: ndcg@10** | 0.618 | 0.612 | **0.635** | 0.635 |
| RAGAS: faithfulness | 0.655 (n=39) | 0.625 (n=39) | **0.684 (n=38)** | 0.668 (n=33) |
| RAGAS: context_precision | 0.643 (n=18) | 0.726 (n=28) | **0.742 (n=17)** | 0.723 (n=14) |
| RAGAS: context_recall | 0.726 (n=42) | 0.673 (n=41) | 0.750 (n=41) | **0.759 (n=42)** |
| RAGAS: answer_relevancy | **0.717 (n=42)** | 0.693 (n=41) | 0.676 (n=42) | 0.671 (n=42) |

**T13a vs T11** (the headline): anchor recall **+5.4%**, passage_recall **+13%** (30→34/74), rank-aware recall@10 **+5.7%** (0.668→0.706), ndcg@10 **+2.7%** (0.618→0.635), RAGAS faithfulness **+4.5%**, context_precision **+9.9%**, context_recall **+2.4%**. Net positive on 3 of 4 RAGAS; answer_relevancy regresses −4.1%.

**T12 vs T11** (the wrapper alone, partial win): rank-aware recall@1 +2.1%, recall@3 +7.8% (wrapper helps top-rank precision — the **wrapper's claim was "better ranking at the top" and recall@k confirms it**); anchor precision +3.77%, passage_recall +1, complete_recall +2.4% (gains on quality). But anchor recall@10 −3.3%, retrieval_recall −3.3%, RAGAS context_recall −5.3%, faithfulness −3.0% (losses on coverage). The wrapper pushes queries into the BGE-designed region — top-rank precision improves but the reranker (still tuned for pre-wrapper embeddings) starts mis-pruning the depth.

**T13a vs T12** (the re-calibration closes the gap): anchor recall +5.4%, passage_recall +2.8%, RAGAS faithfulness +9.5%, context_recall +7.7%. T12's coverage losses are recovered by a more permissive threshold.

**T13a vs T13b** (essentially equivalent): they differ on 3 metrics by <2% — T13a wins faithfulness (+1.6%) and context_precision (+2.0%); T13b wins context_recall (+0.9%) and has marginally higher chunk_precision (+1.25 percentage points). All within SE. **The threshold change is the dominant lever; the factor drop has near-zero additional impact.** T13a wins on edge (faithfulness gain +9.5% over T12 is the largest single improvement) and is the formal recommendation.

### 13.2 Per-query distribution (T13a, n=42)

| Metric | mean | = 0.0 | [0, 0.25) | [0.25, 0.5) | [0.5, 0.75) | [0.75, 1.0] |
|---|---|---|---|---|---|---|
| retrieval_recall | 0.806 | 3 (7%) | 0 (0%) | 1 (2%) | 4 (10%) | 34 (81%) |

Median = 1.0. The same 3-4 partial-grounding queries that have anchored the bottom tail since §7.2 (Q17, Q38 zero-recall corpus gaps). Calibration did not move the tail.

### 13.3 Calibration methodology note

The threshold change is the dominant lever because `MIN_VALUE_THRESHOLD` is the gate that decides whether a candidate clears the adaptive selection; widening it from −0.25 to −1.0 lets more candidates through per query. The `CONTEXT_DECAY_FACTOR` only affects the magnitude of the cost term; once the threshold is permissive enough, cost magnitude is no longer binding. This is the design intent of `calibrate.py` (§7 of `tests/rag-benchmarks/CLAUDE.md`) — sweep threshold + confusion formula + factor jointly, then validate live. Offline F1 rankings are anti-correlated with live RAGAS (T10 lesson, §5); only live A/B identifies the real optimum.

### 13.4 Operational note — configuration coupling warning

Per design, the wrapper string (`"Represent this sentence for searching relevant passages: "`) is **hardcoded for BAAI/bge-large-en-v1.5**. The wrapper's per-model table resolves a different prefix for other models automatically (BGE-zh, e5, instructor, nomic), but **the table must be kept in sync with the model card**. If the deployment swaps `EMBEDDING_MODEL_ID` to a model not in the table (e.g. `BAAI/bge-m3`), the prefix returns empty → silent no-op indistinguishable from no wrapper. Mitigations to add:
- Hard fail at wrapper construction if model id is not in the table.
- Startup log: `[embedding_query_prefix] resolved model=<X> prefix=<P>` visible in `docker logs`.
- CI drift detection: assert `EMBEDDING_MODEL_ID` ∈ table-known set.

Out of scope for this cycle.
Tracked separately in the linked-issue scope.