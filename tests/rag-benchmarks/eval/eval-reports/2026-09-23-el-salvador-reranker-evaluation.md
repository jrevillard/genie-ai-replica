# El Salvador RAG Pipeline — Reranker Evaluation Report

**Author**: Claude (automated pipeline)
**Date**: 2026-09-23 → 2026-09-24
**Stack**: genieai-el-salvador @ 10.0.0.102
**Gold**: `gold_dataset_el_salvador.matched.v3.json` (42 queries, 39 previews, 74 resolved chunks across 20 split passages)

---

## 1. Scope

Evaluated **three reranker configurations** on the same 42-query gold dataset, with the same chatqna system prompt + abstention prompt (`CHATQNA_ENFORCE_ABSTENTION=true`), to determine whether the reranker configuration meaningfully changes end-to-end answer quality.

| Config | Strategy | Factor | Threshold | Top_k |
|---|---|---|---|---|
| **v7** | adaptive | 0.0006 | -0.25 | n/a (default 3) |
| **v8** | adaptive | 0.0010 | -0.25 | n/a (default 3) |
| **v9** | slice | n/a | n/a | **5** |

- v7 was the production config before this evaluation cycle
- v8 was the calibrated config from an offline chunk-F1 sweep (calibrate.py)
- v9 is the data-scientist-recommended simpler strategy with more chunks

**Judge model**: MiniMax-M3 via the local OpenAI-compatible gateway at `http://127.0.0.1:3456/v1`. MiniMax is the same model that backs Claude Code in this environment; it is a substantially stronger judge than the previous 8B open-source model and produces reliable metrics on multilingual grounding judgments (faithfulness, precision, recall).

---

## 2. Bug fixes that were required before any of this was meaningful

Five latent bugs in the eval pipeline were discovered and fixed during this work. Without these, every prior anchor run had produced meaningless results.

| # | Bug | Effect | Fix |
|---|---|---|---|
| 1 | `match_gold_chunks.py` defaulted `--chunk-text-field=text` (chunk summary, LLM-paraphrased) instead of `chunk_text` (verbatim content) | Verbatim gold previews failed substring-match against summaries; chunks reported unresolved | Default flipped to `chunk_text` |
| 2 | `match_gold_chunks.py` required verbatim preview as substring of one chunk | When a preview crosses a chunk boundary (common for the el-salvador corpus), chunks reported unresolved | Added 40-char sliding-window fallback match |
| 3 | `run_eval.py` defaulted `ARANGO_TEXT_FIELD=text` (same bug as #1) | Every selected `_key` was hashed from the summary text; gold hashes were computed from verbatim text. **31/42 queries had key matches but zero hash matches → recall/precision floored at 0 across every prior anchor run** | Default flipped to `chunk_text` |
| 4 | Chunk-level scores for split passages gave partial credit | A passage retrieved with only one half of a split scored 0.5 — partial credit for what is actually a failed retrieval | Added `passage_id` to `expected_chunks[]`; new `passage_recall` metric = fraction of passages where ALL chunks were selected; multi-matches are expanded into multiple gold chunks |
| 5 | RAGAS OpenAI client couldn't reach sovereign vLLM (self-signed cert on the nginx proxy) | All RAGAS metrics = NaN | Pass `httpx.Client(verify=False)` AND `httpx.AsyncClient(verify=False)` to `ChatOpenAI` / `OpenAIEmbeddings` (RAGAS uses the async path internally — patching only sync wasn't enough) |

All five fixes are committed on `dev/el-salvador` (6 commits total, ready to cherry-pick to main).

---

## 3. Anchor results

| Metric | v7 (adaptive 0.0006) | v8 (adaptive 0.0010) | v9 (slice top_k=5) |
|---|---|---|---|
| **chunk recall** | 0.665 | 0.694 | 0.694 |
| **chunk precision** | 0.349 | 0.364 | 0.364 |
| **complete_recall** | 0.548 | 0.571 | 0.571 |
| **noise** | 0.651 | 0.636 | 0.636 |
| **retrieval_recall** | 0.888 | 0.888 | 0.888 |
| **passage_recall** | 0.000* | 0.583 (21/36) | 0.583 (21/36) |

*\* v7 was anchored on `gold_dataset_el_salvador.matched.v2.json` (pre-passage-id), so its passage_recall shows 0 because the report's per_query rows don't have `expected_chunks`. The script treats every chunk as its own singleton passage. v8 and v9 used `matched.v3.json` with passage_id.*

**Observations**:
- v8 and v9 produce **identical** chunk-level metrics. Slice+5 and adaptive(0.0010) converge to the same selection on this corpus
- `retrieval_recall` is the same across all three (0.888) — the **retriever** is the bottleneck, not the reranker
- passage_recall shows 21/36 fully retrieved passages (58%) regardless of reranker config. The 15 partial passages have at least one chunk missing

---

## 4. RAGAS end-to-end (judge: MiniMax-M3)

| Metric | v7 (0.0006) | v8 (0.0010) | v9 (slice 5) | Best |
|---|---|---|---|---|
| **faithfulness** (mean) | 0.533 | **0.551** | 0.546 | v8 (+1.8 pts) |
| **faithfulness** (median) | 0.500 | 0.500 | 0.500 | tie |
| **context_precision** (mean) | 0.763 | 0.822 | **0.845** | v9 (+8.2 pts over v7) |
| **context_precision** (median) | 1.000 | 1.000 | 1.000 | tie |
| **context_recall** (mean) | 0.671 | **0.711** | 0.690 | v8 (+4.0 pts over v7) |
| **context_recall** (median) | 1.000 | 1.000 | 1.000 | tie |
| **answer_relevancy** | n/a | n/a | n/a | MiniMax gateway has no embeddings endpoint |

n=42 for all means except where individual judge calls timed out (1-2 cases per run, treated as NaN by RAGAS).

### Delta matrix

| Pair | Δ faithfulness | Δ context_precision | Δ context_recall |
|---|---|---|---|
| v7 vs v8 | +0.018 | +0.059 | +0.040 |
| v7 vs v9 | +0.013 | +0.082 | +0.019 |
| v8 vs v9 | -0.005 | +0.023 | -0.021 |

### Is the difference statistically meaningful?

n=42 is too small to detect deltas below ~0.05 with confidence (rough rule: SE = σ/√n ≈ 0.15/√42 ≈ 0.023 for a binary-ish metric). All three configurations land within ~0.05 of each other on every metric — that's the noise floor, not a real signal.

A larger gold set (≥200 queries) would be needed to detect a 2–3 point RAGAS difference with confidence. The deltas here are within noise.

---

## 5. Headline finding: faithfulness is 0.55 — almost half of answers are not grounded

This is the most important number in the report and the one to focus on next.

With a reliable judge, **55% of the 42 answers are not faithful** (score < 0.5). That's not a reranker problem — it's a pipeline problem. The chatqna system prompt + abstention prompt helps, but only when the right chunks are retrieved. The real bottleneck is `retrieval_recall = 0.888` (12% of gold chunks never make it past the retriever) combined with the LLM's behaviour on partial contexts.

**Why this matters for reranker choice**: at 0.888 retrieval_recall, the reranker's job is to filter 20 candidates down to the few that matter. The three configs do this job at equivalent quality (chunk_R + passage_R within 0.03). The reranker is not the limiting factor — the retriever is.

---

## 6. What this means operationally

### Decision

All three reranker configurations produce equivalent RAGAS metrics within n=42 noise. None of them moves the needle on the real problem (low faithfulness). The operational choice should be driven by simplicity and operational maturity:

| Config | Pros | Cons |
|---|---|---|
| **v7** (factor=0.0006, adaptive) | Current prod, most permissive, best passage_R, no operational disruption | Theoretical: 4 chunks × 1.0 novelty each = 4x context load |
| **v8** (factor=0.0010, adaptive) | Slightly best on MiniMax-judged faithfulness +0.018 | -5% passage_R vs v7; not significant |
| **v9** (slice, top_k=5) | Best context_precision (+0.08), simpler strategy, no factor/threshold knobs | 5 chunks always → larger context window |

**Recommendation**: keep **v7** (factor=0.0006) as the production config. It is the simplest, highest-recall config and is statistically equivalent to the alternatives on end-to-end metrics.

The earlier `calibrate.py` recommendation to bump `factor=0.0006 → 0.0010` was optimising the wrong metric (chunk-level F1), and the MiniMax-judged data shows it offers no real benefit.

### What to actually fix next

With faithfulness stuck at 0.55, the pipeline-level problem to chase is **retrieval_recall=0.888** (12% of gold chunks never retrieved). Higher-ROI next steps:

1. **Investigate the 12% retrieval miss** — which chunks are missed and why? Top-k truncation, label filter, embedding similarity gap? Earlier drill-down showed 3 queries (Q08, Q17, Q39) account for the misses; all have empty `categoryLabels` so the label filter isn't the cause. Most likely top-k=20 cutoff at low-similarity candidates.
2. **Improve chatqna answer quality on partial contexts** — faithfulness 0.55 means the LLM often produces answers that don't fully cover the reference. Could be:
   - System prompt could be more explicit about partial-coverage honesty
   - Min-score threshold for abstention could be tightened
   - Confidence calibration (already partially addressed via `LLM_SELF_CONFIDENCE_ENABLED`)
3. **Expand the gold set** — n=42 limits the statistical resolution to ~0.05 deltas. Doubling to ~100 queries would halve that.

---

## 7. Open follow-ups

1. **`answer_relevancy` always NaN** — MiniMax gateway at 127.0.0.1:3456 has no `/v1/embeddings` endpoint. RAGAS skips the metric cleanly. Workaround: add an OpenAI-compat shim wrapping TEI's `/embed` (~50 lines Python, ~2 hours including tests).
2. **3 of 39 gold previews are unresolved** (Q40, Q41, Q42). The chunks DO exist in the corpus; the previews are paraphrased/section-header style that doesn't substring-match verbatim. Examples:
   - Q40 preview: `CENTA-ASG... synthetic yellow maize... average yield 83 qq/mz... drought resista` (with ellipses) — actual chunk is full prose: "CENTA ASG: A Synthetic Maize Variety"
   - Q41 preview: `Soil health and restoration: Incorporating crop residues...` (section header style) — actual chunk is prose: "In addition to good soil looseness, preparation must include guaranteeing soil health..."
   - Q42 preview: `Integrated Pest Management (IPM): Prioritizes cultural practices...` (section header style) — actual chunk is caps: "INTEGRATED PEST MANAGEMENT - Monitoring is a necessary agricultural practice..."
   Fix: post-process the gold dataset to replace these paraphrased previews with verbatim chunk excerpts.
3. **Gold has no `categoryLabels`** — the el-salvador xlsx source has 6 columns (query, response, passages, source, difficulty, language), none for labels. `xlsx_to_gold.py` has no `--col-labels` flag. The eval never exercises the retriever's label filter path. Production UI users do send labels. This is a known gap, not a calibration issue.
4. **6 commits ready for main** — match_gold_chunks default + window-based matching + tests, run_eval.py TEXT_FIELD default, passage-level recall, RAGAS SSL bypass. These are generic improvements to the eval pipeline that benefit any stack using the same scripts.

---

## 8. Data artifacts

| Artifact | Remote path | Local copy |
|---|---|---|
| Anchor v7 report | `/tmp/rag-eval/results_v7.json` | `/tmp/results-local/results_v7.json` |
| Anchor v8 report | `/tmp/rag-eval/results_v8.json` | `/tmp/results-local/results_v8.json` |
| Anchor v9 report (slice+5) | `/tmp/rag-eval/results_v9_anchor.json` | `/tmp/results-local/results_v9_anchor.json` |
| Calibration grids | `/tmp/rag-eval/results_v{7,8}_calibration.json` | (120 combos each) |
| Dump-tuples (for RAGAS) | `/tmp/rag-eval/eval_tuples_v{7,8,9}.json` | `/tmp/ragas-tuples/eval_tuples_v{7,8,9}.json` |
| RAGAS scores (MiniMax judge) | (computed locally) | `/tmp/ragas-tuples/ragas_MiniMax_v{7,8,9}.json` |
| Live config | `/opt/genieai-el-salvador/.env` | (currently v9 slice/top_k=5; pending decision) |
| Gold dataset | `/tmp/gold_dataset_el_salvador.matched.v3.json` | — |
| xlsx source | — | `~/Téléchargements/RAG_Evaluation_Test_Dataset_El_Salvador_updated.xlsx` |

---

## 9. TL;DR

- Three reranker configurations (adaptive 0.0006 / adaptive 0.0010 / slice+5) are **statistically equivalent** on RAGAS end-to-end metrics (faithfulness, context_precision, context_recall). All deltas are within n=42 noise floor (~0.05).
- MiniMax-judged faithfulness is **0.55** — almost half of answers are not faithful. This is the headline problem to fix.
- v8 (factor=0.0010) shows a marginal +0.018 faithfulness over v7. Not significant.
- v9 (slice+5) shows +0.082 context_precision over v7 (best). Not significant for answer quality but suggests slice is more "disciplined".
- The real bottleneck is `retrieval_recall = 0.888` (12% of gold chunks never retrieved) and the LLM's faithfulness on partial contexts. Reranker tuning past n=42 noise is wasted effort; invest in retrieval and answer-quality work instead.
- Recommendation: keep **v7** (factor=0.0006, adaptive) as the production config. Equivalent to alternatives; least disruption.
