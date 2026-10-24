# The benchmark's judge could not run `context_entities_recall` — and said so itself

**Date:** 2026-10-25 · **Scope:** Story 8-6 (RAGAS benchmarking) · **Run:** `rr1792843333604-268dad` (suite `rs1792645296070-246482`, El Salvador, 100 rows, 10 metrics)

## The question this answers

The failure attribution staged 55 of 86 failing rows as `judge` and told the
operator to "treat as judge noise unless a stronger judge model reproduces
it". That escape clause was never tested. This is the test, and the result.

## How the test was run

Re-scoring, not re-running: the same 100 stored answers, contexts, reference
answers and reference passages, with only the judge changed. Re-answering
would have confounded the comparison — vLLM is only near-greedy, and 100/100
answers change between two runs of the same prompt.

Three judges were compared on the same rows:

| judge | how it was invoked | rows scored (entity recall) |
|---|---|---|
| MiniMax-M3.1-Flash | the run's own judge (`mc1792423414860-1bbfd8`) | 100/100 |
| MiniMax-M3 | same config, different model | **21/100** |
| granite-4.1-8b | the `.env` system default (the sidecar's own default) | **98/100** |

## The verdict

Per metric, on the 51 rows staged `judge`, against the suite's own
thresholds:

| metric | old failures | still failing under granite | now passing | not measured |
|---|---:|---:|---:|---:|
| `context_entities_recall` | 39 | **30** | 9 | 2 |
| `factual_correctness` | 21 | **12** | 9 | 2 |
| `answer_relevancy` | 2 | **1** | 1 | 0 |

**So "judge noise" was wrong for both halves.** Roughly half the cluster is
judge variance and half is real. The old label dismissed the real half and
hid the variance half.

Across the whole run, granite also **fails 9 of the 14 rows that passed
everything** under the flash judge, and the overall entity-recall mean moves
0.4197 → 0.3616. Judge choice moves the baseline in both directions.

## Why the entity metric was unmeasurable

RAGAS's `ContextEntityRecall` extracts entities **twice per row** — once
from the reference answer (GN) and once from the joined retrieved contexts
(CN) — and scores `|CN ∩ GN| / |GN|`. Both extractions are LLM calls that
must return parseable JSON.

The sidecar's own log names the mechanism:

```
ragas.prompt.pydantic_prompt ERROR Prompt extract_entities_prompt failed to parse output:
    The output parser failed to parse the output including retries.
```

58 times during the MiniMax-M3 job. MiniMax-M3 therefore returns **no
value** for 79 of 100 rows — and because the comparison's means are computed
over the rows where both judges produced a number, its "+0.009" read as a
like-for-like delta over the whole run when it covered a fifth of it.

MiniMax-M3.1-Flash does return a number for every row — and the number is
wrong. Two rows make this visible:

| row | expected passage | answer | entity recall (flash) | (M3) | (granite) |
|---|---|---|---|---|---|
| new-8 | present **verbatim** in the contexts | faithful, factual_correctness 0.89 | **0** | ALL_NAN | **0.20** |
| new-11 | present **verbatim** in the contexts | faithful, factual_correctness 1.0 | **0** | ALL_NAN | **0.62** |

The flash judge scored a row whose content was in the context, word for
word, at zero. It was not harsh — it was wrong.

## What the cluster actually is

For the 30 rows that still fail under granite: the ladder proves the
expected passage **was delivered** (in_corpus = in_candidates = in_contexts
= 1), `context_recall` passed (the reference answer's sentences are
attributable to the contexts), and `faithfulness` passed (the answer is
entailed by them). What is missing is the reference answer's exact **entity
strings**.

The metric compares entity strings exactly. The reference answer is
KG-written; the corpus is source text. A reference that phrases a fact
differently ("13% moisture" vs "moisture below 13 percent") yields a
sentence-level match and a string-level miss at once — which is exactly
what these rows show.

**The lever is the benchmark's reference answer, not the RAG.** Regenerate
the reference against the corpus. Tuning the retrieval, the reranker, the
corpus or the prompt for these rows is wasted work.

## The five unfair questions

Five rows (new-17, new-29, new-78, new-95, new-96) have their expected
passage **proven absent from the indexed corpus** (`in_corpus = 0`, probeable
and content-confirmed missing). They were staged `judge`/`llm` and told the
operator to treat them as noise or to tighten the prompt for content the
system was never given. They now stage `corpus`: *regenerate this entry
against the current corpus*.

The reason they were mis-staged is a measurement error of our own making:
the corpus verdict was gated on `context_recall` failing. But
`context_recall` classifies the **reference answer's sentences** against the
retrieved contexts — other documents can cover the answer while the expected
passage was never indexed. The ladder probes the corpus directly and had the
right answer all along.

## Changes made (all measured, all tested)

| change | why |
|---|---|
| The ladder's verdict is stored even when it did not decide the stage | it was computed and then discarded, leaving the `context_recall` proxy standing in for a fact it does not measure |
| The corpus verdict wins over the `context_recall` proxy | 5 rows moved from `judge`/`llm` to `corpus` |
| Every metric records **how many rows the judge scored** | a mean over 21 of 100 rows read as a whole-run delta; the panel now shows the fraction |
| The advisor may not prescribe on a metric the judge did not score | a judge that could not measure the metric must not read as confirming it |
| The recommendations no longer say "judge noise" | a second judge reproduced most of them; the rows are **unproven**, not dismissed |
| The advisor's rule (1) no longer says "say it needs a stronger judge to confirm" | that is how ~30 already-reproduced rows were dismissed |
| The advisor payload no longer caps at 40 attributions | 46 of 86 rows reached it with no evidence — **the advisor said so itself** |
| The re-score's judge scores land on the row that was submitted | the re-score filtered the sample list but index-aligned the scores against the unfiltered one |

## Standing recommendation

**Pin the benchmark's judge, and record which one.** The `.env` system
default (granite-4.1-8b) is the only judge measured here that can run the
entity metric. MiniMax-M3.1-Flash scores it wrongly; MiniMax-M3 cannot
score it at all. A judge that cannot run the metric set is not a judge
choice, it is a broken instrument.

The run names its judge and every metric carries its coverage, so a future
run cannot silently change the baseline.

## Still open

- The 30 rows whose reference wording does not match the corpus need their
  reference answers regenerated — a benchmark-side fix, not a RAG fix.
- The 5 unfair questions need their suite entries regenerated.
- The remaining judge-stage rows (`llm`: new-44, new-46, new-51) are real
  faithfulness failures with delivered context — the only rows that
  currently justify a prompt change.
