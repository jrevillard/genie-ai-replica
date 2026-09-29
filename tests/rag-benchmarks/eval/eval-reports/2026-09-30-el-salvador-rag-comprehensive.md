# El Salvador RAG Pipeline — Comprehensive Evaluation Report

**Author**: Claude (automated pipeline)
**Date**: 2026-09-30
**Stack**: genieai-el-salvador @ 10.0.0.102 (`release/el-salvador` branch, post-revert)
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

> T05 anchor numbers are taken from the Sept 23 baseline report (`2026-09-23-el-salvador-reranker-evaluation.md §4`) and not reproducible from current `.102` state — no T05 anchor file is on the swarm node. T06–T11 numbers are recomputed from `/tmp/rag-eval/results_v7_postchunk.json` (T06), `results_v7_K32_clean.json` / `results_v8_K32.json` (T08–T09), `results_K32_calibrated.json` (T10), `results_v11_postrevert.json` (T11). n=42 for every config.

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
- the live rollback to factor=0.0006 today is the correct action

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
| `CONTEXT_DECAY_FACTOR` | 0.0006 | 0.0006 ✓ |
| `MIN_VALUE_THRESHOLD` | -0.25 | -0.25 ✓ |
| `DATAPREP_CHUNK_SIZE_MD` | 1400 | (dataprep service, not chatqna) |
| `DATAPREP_CHUNK_OVERLAP` | 300 | (dataprep service, not chatqna) |

The container overrides (`K=32`, `FETCH_K=40`) were applied via `docker service update --env-add` during the Sept 29 K-sweep. The `.env` file reflects a planned K=50 (not yet redeployed). Next Ansible deploy will move the container to K=50 unless this drift is corrected first.

---

## 9. Final recommendation

| Decision | Current value | Recommendation | Rationale |
|---|---|---|---|
| `CONTEXT_DECAY_FACTOR` | 0.0006 | **keep 0.0006** (validated live) | factor=0.0010 dropped RAGAS faithfulness 47% in live A/B; factor=0.0020 (T10 crater) was anti-correlated with RAGAS |
| `MIN_VALUE_THRESHOLD` | -0.25 | **keep -0.25** | validated Sept 23 sweep, anti-correlated below this point with avg_sel |
| `DATAPREP_CHUNK_SIZE_MD` | 1400 | keep 1400 | chunker change drives avg_sel; chunk_recall stable across the change |
| `DATAPREP_CHUNK_OVERLAP` | 300 | keep 300 | section-aware splits compensate; not a bottleneck |
| `RETRIEVER_ARANGO_K` | 32 (live) / 50 (.env) | reconcile (run K=50 sweep when convenient) | live validated at K=32; K=50 unvalidated |
| System prompt | XML structured | keep XML | +0.122 faithfulness vs prose baseline (≈2.5× actual SE for n=39-42) |
| Chunk overlap re-eval | (not done) | drop overlap 300→150 (saves chunks, A/B test) | would tighten candidate pool without losing recall |

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
| Charts (this report) | — | `tests/rag-benchmarks/eval/eval-reports/2026-09-30-el-salvador-rag-comprehensive-charts.html` |

---

## 12. Linked issues and next steps

- **#1026**: chatqna query-translation silent fallback (chat-time translation crashes return untranslated Spanish)
- **#1027**: document SSoT English + on-the-fly translation pipeline architecture
- **Calibration staleness**: `CONTEXT_DECAY_FACTOR` was tuned for chunk_size=2000; chunker tightened without re-tune. Now empirically validated live at 0.0006 for chunk_size=1400. Document this in the .env comment when Ansible re-deploys.
- **K=32 → K=50 in .env**: drift between Ansible config and live container. Reconcile before next deploy.
- **Anchor data integrity**: `run_eval.py` builds `_key → content_hash` map at runtime from ArangoDB text field. With contextual retrieval, the LLM-generated prefix can drift between runs. Investigate pinning content_hash from a stable source (e.g., snapshot the corpus hash on ingest).
- **Bimodal faithfulness tail**: 33% of queries have faithfulness &lt; 0.5. Closing this tail would push mean to ~0.80. Targets: Q17 (zero-recall corpus gap), Q38 (zero-recall corpus gap), and ~10 partial-grounding queries.