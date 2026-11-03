# El Salvador 10-metric benchmark — score-improvement analysis

**Run:** `rr1792807688575-1e1b0c` (done 2026-10-24, 100 rows, 0 errors, 4 abstained,
served mode, judge MiniMax-M3.1-Flash explicit pick, suite `rs1792645296070-246482`,
graph `OKF_el-salvador_v3`).
**Advisor:** explain doc `rx1792829129101-e19e33` (81 attributions).
**Question (David):** where do we win points back — is the chatqna system prompt
the lever?

## 1. Executive summary

The 10-metric losses split into **four buckets of very different nature**. The
prompt is a real lever but only one of them, and not the biggest:

| Bucket | Share of the 81 attributed failures | Lever | Expected recovery (est.) |
|---|---:|---|---|
| **LLM answer behavior** (chatqna prompt) | 38 (47%) | `CHATQNA_SYSTEM_PROMPT` (env config, no code) | faithfulness +0.03–0.06, answer_correctness +0.02–0.04, fewer wrong-value answers |
| **Judge under-scoring** | 26 (32%) | stronger judge for the claim-decomposition metrics | factual_correctness +0.05–0.10, entities-recall +0.15+ |
| **Retrieval** (vector-recall 7 + retrieved 6 + reranker 4) | 17 (21%) | candidate pool ↑ + reranker weights (whatif sizing first) | context_recall/precision on ~7 hard rows |
| **Suite defects** (references not in corpus) | 2 flagged + fragile refs | regenerate rows, keep passages whole | removes unfair zeros |

Proven with row-level evidence in §3 — including one row where the answer is
**verbatim identical to the reference and still scored 0.20**: that is judge
noise, and no prompt change can fix it.

## 2. The numbers

| Metric | Mean | | Metric | Mean |
|---|---:|---|---|---:|
| context_utilization | 0.940 | | answer_correctness | 0.712 |
| context_precision | 0.919 | | faithfulness | 0.815 |
| answer_similarity | 0.903 | | factual_correctness | 0.600 |
| answer_relevancy | 0.857 | | **context_entities_recall** | **0.421** |
| context_recall | 0.828 | | noise_sensitivity ↓ | 0.243 |

51/100 rows fail <0.6 on ≥1 answer-side metric — but the failure *signature*
matters more than the count: **high faithfulness + low factual_correctness**
(new-3: 1.00/0.15; new-26: 1.00/0.20; new-22: 1.00/0.24; new-29: 1.00/0.36) means
answers ARE grounded in what retrieval delivered — the mismatch is against the
*reference*, i.e. judge claim-matching and answer completeness, not hallucination.

## 3. Signature rows — the proof set

| Row | Metrics | What the evidence shows | Bucket |
|---|---|---|---|
| **new-26** (vitamin C) | fait 1.00, fact **0.20** | Answer "about 23 milligrams per 100 g raw" — context contains "vitamin C (23 mg per 100 g)", reference says "about 23 mg". **Identical content, scored 0.20.** | judge |
| **new-98** (CENTA-CS/ASG yields) | abstained | **4 contexts delivered, rich hits on CENTA-CS/CENTA-ASG/Chalatenango** — the model abstained with the evidence in hand. Compound numeric question → all-or-nothing refusal. | **prompt** |
| **new-9** (June 15 planting) | fait **0.44**, fact 0.71 | Contexts contained the May-15–June-15 window (all 3 chunks hit); the answer wrapped the facts in "agricultural research and field experiences have shown…" generalization the judge counted as unsupported. | **prompt** |
| **new-3** (Agrotis ípsilon) | fait 1.00, fact 0.15 | Answer copied the context's naming faithfully; reference additionally carries the deep-tillage control claims — completeness gap + judge strictness on differently-phrased claims. | mixed |
| **new-38** (tomato maturity) | fact **0.00** | Advisor: the carrier chunk ranks **#68 of 1000** in the candidate index — never reached the model. Answer built from wrong chunks. | retrieval |
| **new-17, new-29** | — | References **not in the corpus** (in_corpus=0) — unfair rows, should be regenerated. | suite |

The 4 abstentions: all four had 2–6 contexts delivered. At least new-98 is
**over-abstention** (evidence present). 4% abstention is healthy in total, but
the *reason* for these is wrong and prompt-fixable.

## 4. The chatqna system prompt — proposed text

**Deployment is configuration, not code**: `CHATQNA_SYSTEM_PROMPT` env var
overrides the built-in default (two-tier priority, CLAUDE.md). Change `.env` /
compose, recreate chatqna, benchmark the same suite — serve mode re-answers, so
the A/B is the same 100 questions.

Current default is generic ("friendly and polite… do not invent… inform
unavailable") with **no verbatim-numbers rule, no figure/table clause, no
multi-part-question rule** — the three gaps the failures point at.

Proposed:

```text
You are a friendly and polite information assistant.

Answer the user's latest question using only the content provided from the
knowledge base.

**Grounding rules:**
- Copy numbers, dates, quantities, rates, dosages, variety names and other
  named entities VERBATIM from the provided content. Never round, convert or
  substitute a value from your own knowledge.
- If the asked value or fact is not in the provided content, say plainly that
  the information is not available in the knowledge base. Do not estimate.
- Answer EVERY part of the question the content supports. For a multi-part
  question, answer the parts you can and state which parts the content does
  not cover — do not refuse the whole question because one part is missing.
- When the question refers to a figure or table, report only what the content
  text explicitly says about it. Never describe or infer visual details that
  are not written.
- Use the documents' own terminology (including non-English terms — e.g.
  Spanish pest, disease and variety names, or foreign agency and program
  names) as written; when answering in another language, keep the original
  term in parentheses.
- Start with the answer itself. Do not add general framing, background
  knowledge or caveats beyond the provided content.

Use the user's name, gender, age, preferences, and chat history to tailor and
personalise your responses. Keep answers informative but concise.
```

Maps to evidence: verbatim rule → new-26/22/9 class; multi-part rule → new-98
class (the single clearest prompt win); figure clause → advisor's new-4/new-83;
terminology rule → new-3 class; anti-framing → new-9 faithfulness.

**Risk to watch:** stricter grounding can *raise* abstention on marginal rows
(the abstention gate is separate: `CHATQNA_ENFORCE_ABSTENTION` +
`CHATQNA_ABSTENTION_INSTRUCTIONS`). The multi-part rule pushes the other way.
Accept the trade only if the re-run shows net gain — that is what the benchmark
is for. Recommendation: change the system prompt ONLY on the first A/B, keep
abstention settings untouched, one variable at a time.

## 5. Judge-side (the 26-attribution bucket — do this before touching retrieval)

- **Re-score `context_entities_recall` with a stronger judge before any knob
  change** (advisor's explicit instruction): 14 rows fail ONLY entity recall
  while context recall passes — MiniMax-Flash's entity extraction is the
  suspect, not the corpus.
- `factual_correctness` 0.600 mean with faithfulness 0.815 and new-26's proof
  row says part of that gap is judge claim-matching strictness. Re-scoring the
  10-metric set with a stronger judge quantifies it.
- **Judge pick (2026-10-24, from the shelf of model configs): `Deepseek V4 Pro
  David - OpenAI` (`mc1792482278295-e02f3b`)** — the only non-flash model
  available, already tagged `ragas_judge`, OpenAI protocol (no adapter risk),
  pay-per-token without GLM-ITU's daytime throttling. GLM-5.3-flash is NOT
  recommended as judge (same flash class + the strict-JSON gap).
- **Cost correction (superseding the first draft of this section): the judge
  re-score is a FULL run (~5 h), not cache-warm.** The disk cache keys on
  `model|prompt|…`, so a different judge model misses every entry — all
  judge calls re-fire. The "cache-warm" claim applied only to same-model
  re-runs.

## 6. Retrieval-side (17 attributions — size in whatif mode first)

- **Candidate pool**: new-38's carrier chunk at rank #68/1000 and new-52's
  zero-candidate row say the pre-rerank cut is dropping signal. The local
  build already ran the comparison pair at `OKF_RAGAS_CANDIDATE_K=192` /
  `OKF_RAGAS_TOP_N=16` (whatif): recall +0.113 / precision −0.045 vs the older
  pool. Port the winning values to the chatqna deployment after the judge
  re-score separates real retrieval loss from judge noise.
- **Reranker**: new-6/8/28/43 — noise chunks outrank the signal passage in the
  final context. Threshold/weight tuning, second priority after the pool.

## 7. Total ingestion context (what we have, what the suite covers)

Nine OKF repos ingested; the suite exercised **one**: `OKF_el-salvador_v3`
(586 concepts, Spanish-primary agricultural corpus).

| Graph | Concepts | | Graph | Concepts |
|---|---:|---|---|---:|
| OKF_bali_v1 | 1112 | | OKF_slaugherhouse-heuristics_v7 | 58 |
| OKF_www-gov-uk-full-crawl_v3 | 997 | | OKF_ncd-information_v1 | 47 |
| OKF_el-salvador_v3 | **586** | | OKF_alphabet-company-information_v1 | 18 |
| OKF_solar-system_v1 | 144 | | OKF_resilient-ai-hub_v1 | 11 / kenya 5 |

Two consequences:
1. **The scores describe one repo**, not the deployment. Cross-repo suites
   (hybrid mode fan-out) are a separate benchmark — do not tune the prompt on
   el-salvador alone and assume transfer.
2. **Cross-language**: English (typo'd) questions against Spanish-primary
   chunks. The retrieval handles it (context_precision 0.919), but entity
   recall is judged on Spanish entity names extracted by an English-tuned
   judge — compounds §5.

## 8. Recommended order

1. **Judge re-score** (same suite, stronger judge) — establishes the honest
   baseline; zero pipeline risk. Full run, ~5 h. **Done first because the
   prompt A/B below is already deployed — the next run measures BOTH; run a
   Pro-judged baseline with the new prompt live, and compare against
   `rr1792807688575-1e1b0c` keeping in mind two variables moved.**
2. **Prompt A/B** — deployed 2026-10-24 via `CHATQNA_SYSTEM_PROMPT` on the
   local build (chatqna recreated, verified in-container). Reversible in one
   env flip. *(folds into run 1; if the combined result is ambiguous, flip
   the prompt off and re-run to isolate)*
3. **Whatif sizing → port candidate pool/rerank values** to the served
   deployment. *(analysis exists; deploy after 1–2)*
4. **Suite hygiene** — regenerate new-17/new-29 (unfair), keep reference
   passages whole (160-char truncated passage summaries in the suite make
   judge comparisons noisier than they need to be).
5. Only then consider code-level changes (reranker strategy knobs are already
   env-exposed: `RERANKING_STRATEGY`, `RERANKER_TOP_N`).
