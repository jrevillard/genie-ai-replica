# Incident — the benchmark's false abstentions (2026-10-24)

**Impact:** the OKF benchmark reported 10 "abstentions" (and 4 in the baseline)
that the chat UI answered in full, with a confidence badge and the related
documents. Those rows were displayed as refusals, had their answer metrics
treated as failed, were attributed to the wrong stage, and made the advisor
prescribe "tighten CHATQNA_SYSTEM_PROMPT grounding" on ~30 rows whose answers
were verbatim-correct. Two benchmark runs were misread as a result, and a
3-hour A/B was spent interpreting a signal that never existed.

**Trigger:** David compared the panel's abstention list against the chat UI
(screenshots: CENTA-CS/CENTA-ASG → "Confidence: 99%", Planta Baja → 99%,
watermelon/biochar → 54%, Black Ear Rot → 95%) and found the same questions
answered in full.

## Root cause

`matchAbstention()` in `components/okf-server/services/ragas-suite-service.js`
matched a list of phrases **anywhere in the answer**:

```
'cannot find', "can't find", 'does not contain', 'not contain',
'no information', 'not provide', "doesn't provide", 'do not have',
"don't have", 'unable to find', 'no relevant information', 'not available in'
```

A complete answer that says one part of the question is not covered — *"The
knowledge base does not provide additional specific characteristics beyond its
short stature…"* — matched `'not provide'`. The chat path never had this
problem: it shows the answer, the confidence badge and the related documents;
only the benchmark invented a refusal.

The flag then propagated: `abstained: true` → the row showed as a refusal →
the attribution took the "abstention" branch → the advisor was told the model
declined on answerable questions. The new grounding prompt made it worse
(4 → 10) because it *encourages* honest "this part is not in the knowledge
base" statements.

**The paths were never different.** Same chatqna, same fan-out carrier, same
system prompt, same retrieval — the UI answered those questions in full. The
benchmark was misreporting our own system.

## The fix

Abstention is now decided by **chatqna's own metadata** — the same signals the
citizen path uses:

| Signal | Meaning |
|---|---|
| `abstained: true` | chatqna declined (the reranker-overflow branch) |
| `is_grounded: false` + no source documents | nothing was retrieved |
| empty answer | nothing was said |
| `[No Relevant Documents Found]` prefix | chatqna's own KB-empty refusal |

A sentence about missing information inside an otherwise complete answer is a
**partial answer**, not an abstention.

The row now also records the grounding evidence the citizen saw —
`self_confidence`, `retrieval_confidence`, `is_grounded`, `related_documents` —
so the panel, the attribution and the advisor reason about the same signals
the UI renders instead of guessing from prose.

## Two further defects found in the same pass

1. **Attribution conflated "ungrounded" with "judge-scored harshly".** A row
   whose faithfulness PASSED but whose `factual_correctness` failed was
   staged "llm" with "tighten grounding". Proof row: **new-26** — the answer
   ("about 23 mg of vitamin C per 100 g") is verbatim-identical to the
   reference, and still scored 0.20. Such rows are now staged **judge**
   ("the answer IS grounded … do NOT tighten the prompt for this row").
2. **The advisor's own LLM call was dead.** It resolved the *active* model
   config (GLM on api.z.ai, rate-limited): three 429s → "advice failed —
   mechanical attribution stands". It now rides the **run's judge** (the model
   that produced the scores) with an **env-judge fallback**, so a throttled
   provider can never blank the advice again.

## Data repair

`scripts/okf-testing-lab/ragas-abstention-backfill.js` recomputed every
stored run's `abstained` flag and summary with the authoritative rule:

| Run | Before | After |
|---|---:|---:|
| `rr1792843333604-268dad` (candidate, new prompt) | 10 | **0** |
| `rr1792807688575-1e1b0c` (baseline, old prompt) | 4 | **0** |
| `rr1792774608075-8d3d95` (the misrouted run) | 96 | **0** |
| `rr1792742789648-86637b` (older) | 14 | **6** (genuine: empty answer, zero contexts) |

The judge's own scores were never touched. The repaired attribution for the
candidate run: **judge 55 · llm 10 · reranker 8 · vector-recall 7 · retrieved 6**
— against the broken picture of "~38 llm / tighten grounding".

## What this cost, and the rules that come with it

- **Never infer a system behaviour from a text heuristic when the system
  reports that behaviour itself.** The benchmark had chatqna's metadata in
  hand and chose prose-matching instead.
- **A metric that fails on 100% of rows is a bug, not a finding.** The
  candidate run's `answer_relevancy` sat at exactly 0.00 on the flagged rows —
  the tell that the flag, not the answer, was wrong.
- **Cross-check the benchmark against the UI.** The screenshots that exposed
  this were worth more than any metric: the same question, the same system,
  two different answers.
