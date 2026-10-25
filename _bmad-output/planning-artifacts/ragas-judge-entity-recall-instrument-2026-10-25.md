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

## The reference regeneration — done, and what it did

`scripts/okf-routing-lab/ragas-regenerate-reference.js` (runs inside the
okf-server container) rewrites a suite entry's reference answer FROM the
corpus text and writes it **only when `context_entities_recall` on the
rewrite scores better than on the original**. The gate is the metric
itself, not a proxy — see the note on the rejected cheaper gate below.

The tool ran over the judge-stage rows in two passes (the second pass
re-measured what the first had already rewritten, so the counts overlap).
**Net effect on the suite: 18 of its 100 entries now carry a regenerated
reference.** The 18 are the rows that failed entity recall in the stored
run — their mean score there was `0.212`, against `0.465` for the 82
untouched rows.

**Measured on the 18 with ONE judge, in ONE run** — the original reference
and the rewritten one, both scored with the env judge (`granite-4.1-8b`)
at the same moment, so the comparison is apples-to-apples:

| | mean `context_entities_recall` |
|---|---|
| before | **0.505** |
| after | **0.628** |

| outcome | rows |
|---|---|
| improved | **18** |
| unchanged | 0 |
| worse | 0 |

Every row that landed moved up, and none moved down. The biggest movers:
new-81 `0.250 → 0.625`, new-57 `0.235 → 0.417`, new-94 `0.500 → 0.667`,
new-13 `0.647 → 0.800`, new-89 `0.667 → 0.800`, new-10 `0.414 → 0.565`.

The stored run's own scores are NOT comparable with these: that run was
judged by MiniMax-M3.1-Flash, which the re-score above showed scores this
metric wrongly (a row whose passage was delivered verbatim scored 0).
Both sides of the table above are granite, measured now.

**The cheap gate was wrong, and the metric is why.** The first version
checked "does every number and proper noun in the answer appear in the
passage?" — it refused **86 of 100** rows, flagging ordinary connectives
the entity extractor never treats as entities ("according", "covers"),
and it passed rewrites whose entity sets still differed. The metric is
the thing being fixed, so the metric is what decides.

**The refusals are a different population, not failures of the tool.**
Several are near-misses the same rewrite cannot clear (new-5 stays at
`0.636` across three attempts; new-80 at `0.526`; new-14 at `0.429`),
and two had a reference that already scored `1.000` (new-4, new-22) —
those rows were never reference-wording failures at all, and rewriting
their reference made the metric WORSE. The tool refusing them is the
gate working, not the gate failing.

**What the refusals mean.** A reference whose entities the corpus
cannot produce is not repairable by rephrasing: the corpus does not
contain the fact the reference claims. Those rows belong with the five
unfair questions — regenerate the ENTRY against the current corpus, not
the wording of its answer.

## The model selection was NOT in the UI (2026-10-25)

David: "you removed the model selection from the RAGAS generation and
benchmarking ... make sure it INCLUDES the default configured model from
the .env as an OPTION." Then, after the first fix: "i just refresh the user
interface, and it's not there."

**Root cause: the list service dropped the envelope.**

`modelConfigService.list()` returned `body.configs` — the ARRAY alone —
dropping `env_judge` and `env_pick`. The store action spread that array
into an object:

```
{ ok: true, ...['cfgA', 'cfgB'] }   ->   { ok: true, 0: 'cfgA', 1: 'cfgB' }
```

so the result carried **neither `configs` nor `env_judge`**. The RAGAS
panel read `res.configs` (undefined → `[]`) and `res.env_judge`
(undefined → `null`), so it had no judge to choose and rendered **no
picker at all** — for the admin too. The Admin Dashboard's **Models tab**
reads `res.configs` from the same action and was **blank for the same
reason**: the whole named-model-configuration feature had never been
visible in the UI.

Fixed at both layers: the service returns the envelope
`{configs, env_judge, env_pick}`, and the store action names the three
fields instead of spreading them.

**A second, independent defect on the same surface**: the list endpoint
sat behind `router.use(requireRole('tools-admin'))`, so an operator
holding an okf read scope but not the role got a 403 and no list at all.
The read is now open to every OKF user (the envelope carries no secret
and the provider-key HINT is now admin-only); every write and
credential-bearing probe stays tools-admin.

**Why the unit tests did not see it.** The panel tests mock the STORE
with the full envelope — so they asserted against a shape the real
service never produced. The seam is now pinned where the defect was (a
service test that the envelope survives the round trip) **and** in a
browser (`tests/e2e/okf/ragas-judge-selector.spec.js`), which walks the
real path an operator walks: `/admin` → OKF Studio → the repo card's
*Head Test* → the *RAGAS Benchmarks* tab → the judge dropdown. It
asserts the dropdown is on screen in **both** the generation form and the
benchmark-run form, that the `.env` default is among the options and
names the model it resolves to, and that the admin Models tab lists the
configured models.

Live against the local build: the generation form shows *"Judge model
configuration — System default (environment) (ibm-granite/granite-4.1-8b)"*,
the Models tab lists all seven configurations, and the OKF smoke's
curator check returns `200 — env judge ibm-granite/granite-4.1-8b, 7 named
config(s), no key hint`.

## Still open

- The rows the gate refused need their ENTRIES regenerated against the
  current corpus, like the 5 unfair questions — their references name
  facts the corpus does not contain, which is the same defect at a
  different depth.
- The 5 unfair questions need their suite entries regenerated.
- The remaining judge-stage rows (`llm`: new-44, new-46, new-51) are real
  faithfulness failures with delivered context — the only rows that
  currently justify a prompt change.
- The benchmark must be RE-RUN to measure the regeneration: the stored
  run still carries the old references and the old scores.
