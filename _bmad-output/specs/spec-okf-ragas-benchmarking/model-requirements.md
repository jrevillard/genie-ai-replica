# Model requirements — curation, benchmarking, and suite tests

**Principle (binding, per David 2026-10-17): no feature is indexed on a specific model.** Deployments select models by use case and resource availability; every LLM-consuming task states capability minimums here, and the user-facing docs (site) repeat this matrix at implementation time. Inherited defaults are defaults, not couplings.

**Validated instances (evidence, not requirements):** granite-4.1-8b via vLLM (guided JSON — dataprep labeling, contextual retrieval, Lab teach/explain) and MiniMax-M3 via LiteLLM as RAGAS judge + TEI bge-large embedder (Jerome's live validation, 2026-10-06).

## Task matrix

| Task | Config surface | Minimums |
|---|---|---|
| Benchmark-suite generation (testset synthesis) | `RAGAS_JUDGE_*` (or per-deployment override) | OpenAI-compatible chat endpoint; **strict/guided JSON output** (ragas prompts are structured-output); window ≥ 8k tokens recommended (4k workable with smaller document batches); multilingual when the repos are; grounded synthesis (non-zero temperature acceptable) |
| RAGAS judge (faithfulness, context_precision, context_recall, answer_relevancy) | `RAGAS_JUDGE_*` | Same as generation at temperature 0; **must not leak reasoning tokens into the completion** (or the endpoint must separate the reasoning budget) — the documented failure mode is completion budget burned on internal reasoning → empty answers → every metric flatlines 0/NaN; window must fit question + answer + retrieved contexts + prompt; validate with one query before a full run |
| answer_relevancy embedder | `RAGAS_EMBED_*` | OpenAI-compatible `/embed`; **consistent within a run** (every embed same model); matching the corpus embedder is recommended (reuse the TEI default) but not mathematically required — the metric compares its own embeds only |
| Answer leg of benchmark runs (Lab-internal generation) | deployment LLM (inherited `VLLM_LLM_MODEL_ID`, overridable) | Guided JSON not required; must follow the `CHATQNA_SYSTEM_PROMPT` grounding/abstention contract; window fits the selected contexts (top-N) |
| Data curation — labeling + contextual retrieval (dataprep) | `VLLM_LLM_MODEL_ID` | Existing contract: OpenAI-compatible `response_format={"type":"json_object"}` (vLLM guided JSON); window drives the `DATAPREP_CONTEXTUAL_DOC_BUDGET` derivation (see the env-variable docs) |
| Data curation — concept drafting (producer) | `VLLM_LLM_MODEL_ID` | Same JSON contract; creative-grounded mix for drafting |
| Existing suite tests — head explain/teach loop, advisor, tag advice | `VLLM_LLM_MODEL_ID` via `vllmChatCompletions` | Guided JSON; small prompts; any model meeting the JSON minimum qualifies |

## Selection notes

- Compose defaults inherit the deployment's LLM configuration (`RAGAS_JUDGE_MODEL` ← `VLLM_LLM_MODEL_ID`); override per endpoint freely — the feature never assumes the inherited value beyond these minimums.
- Resource-constrained nodes may run a *smaller* judge than the serving LLM if it still meets minimums, or point `RAGAS_JUDGE_BASE_URL` at a different endpoint entirely.
- Known failure modes to document for operators (from the harness's recorded experience): reasoning-token budget burn (all-NaN); non-JSON judge (silent 0s per metric); missing embed model (answer_relevancy silently dropped); window pressure truncating contexts before the judge sees them.
- **Rate limiting reads as a corpus weakness, not as a model failure.** A judge that is reachable but answers 429 contributes no scores; the run still completes and the coverage collapses (live: the same 100 answers covered 21/100 on `context_entities_recall` under a MiniMax judge and 98/100 under granite — the low coverage was the judge). Capability minimums are not availability: a deployment must also ensure the endpoint is reachable AND has rate-limit headroom for the workload, and every reported aggregate must carry the rows-scored count beside it so the difference is visible.
- **The generation model and the judge are separate picks.** A model can synthesize a suite and be a poor judge (or the reverse); the Lab resolves them independently (explicit pick → active configuration → env default), and each control names the model it resolves to.
