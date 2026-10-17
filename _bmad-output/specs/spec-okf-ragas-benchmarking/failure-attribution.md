# Failure attribution — RAGAS explain/advise (Story 8-6)

The mechanical matrix behind CAP-5, adapted from Jerome's Phase-5 table (`tests/rag-benchmarks/eval/CLAUDE.md` "Semantic path") with routing-aware additions the Lab is uniquely positioned to make. Applied per failing row (any metric below its threshold); every match emits an attribution row `{query, pattern, stage, evidence, fix_surface, recommendation}`.

## Thresholds (config-overridable via suite/run settings; applied to every enabled metric)

Default four (always present):

| Metric | Fail below |
|---|---|
| `faithfulness` | 0.6 |
| `context_precision` | 0.5 |
| `context_recall` | 0.5 |
| `answer_relevancy` | 0.6 |

Extended catalog (per David 2026-10-17 the full single-turn set is selectable; thresholds apply when enabled):

| Metric | Fail outside |
|---|---|
| `answer_correctness` / `factual_correctness` | < 0.6 |
| `answer_similarity` (semantic similarity) | < 0.7 |
| `context_entities_recall` | < 0.5 |
| `context_utilization` (precision w/o reference) | < 0.5 |
| `noise_sensitivity` | > 0.4 (lower is better) |

## Attribution matrix

| Pattern (metric signature + run evidence) | Stage | Fix surface | Recommendation text (i18n key basis) |
|---|---|---|---|
| `context_recall` low + reference passage absent from contexts (per-repo probe found it in another repo) | Routing | repo frontmatter tags / head | Suggest tag additions via the existing teaching-loop seam (`guardSuggestions`); name the repo that held the passage |
| `context_recall` low + passage absent everywhere (not in any selected repo's `_SOURCE`) | Corpus | concept content / chunking | The expected output is not retrievable — re-curate the concept or regenerate the suite entry |
| `context_recall` low + passage in candidates but not in top-N | Reranker | `RERANKER_TOP_N`, reranking strategy | Raise top-N or consult the calibrator; link the existing Suites anchor path for deterministic verification |
| `context_precision` low + recall ok | Reranker (ranking) | rerank weights / strategy | Noise ranked above signal — same reranker surfaces as above |
| `faithfulness` low + contexts scored good | LLM | `CHATQNA_SYSTEM_PROMPT`, temperature, model | Answer drifts from context — tighten prompt grounding; note judge verdict quotes |
| `answer_relevancy` low + contexts good | LLM / language | prompt or language mismatch | Check answer language vs suite entry language; prompt specificity |
| `answer_correctness` / `factual_correctness` low + faithfulness ok | LLM (answer quality) | prompt, model | Answer is grounded but wrong vs the reference — tighten accuracy prompting or assess model minimums |
| `answer_similarity` low + correctness ok | LLM (wording) | prompt / language | Right facts, wrong shape — phrasing, completeness, or language mismatch vs the reference |
| `noise_sensitivity` high | Reranker (noise) | rerank knobs | Noisy selection flips answers between runs — same surfaces as precision losses |
| `context_entities_recall` low | Corpus (entities) | concept content | Key entities of the reference are unretrievable — re-curate the concept or enrich entity mentions |
| `answer_relevancy` low + `abstained` = yes | Abstention | abstention instructions | Model abstained on an answerable query — abstention threshold too strict for this entry |
| All four ≈ 0/NaN + judge errors in run log | Judge | judge model / endpoint | Judge failure, not pipeline failure — verify `RAGAS_JUDGE_*` (his known failure modes: reasoning-token budget, non-JSON judge, missing embed model) |

## Advice generation (guarded, existing pattern)

1. Collect attribution rows + failing queries.
2. One `vllmChatCompletions` guided-JSON call (temperature 0.2, the `explainSuiteFailures` precedent) proposing actions in three classes:
   - **Knob changes** — reranker/prompt surfaces named, operator-applied;
   - **Repository changes** (per David 2026-10-17) — frontmatter tag additions/removals routed through `guardSuggestions` with the suite's passing queries as positives (the existing advisor machinery), plus concept-content curation suggestions that name the concept and the gap (text chips, steward-applied);
   - **Prompt tweaks** — text only, human-applied.
3. Everything not auto-applicable renders as a chip with reason — identical UI contract to the head Lab's teach/explain loop (`okf-headtest__suggestion` + add/reject chips).
4. Mechanical rows are always shown even when the LLM adds nothing (`source: 'mechanical'` fallback; never fabricate advice).
