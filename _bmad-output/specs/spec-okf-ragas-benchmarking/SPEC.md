---
id: SPEC-okf-ragas-benchmarking
companions:
  - architecture-diagrams.md
  - xlsx-compat-formats.md
  - stack.md
  - model-requirements.md
  - failure-attribution.md
  - ../../../tests/rag-benchmarks/eval/CLAUDE.md
  - ../../../tests/rag-benchmarks/eval/RUNBOOK.md
sources: []
---

> **Canonical contract.** This SPEC and the files in `companions:` are the complete, preservation-validated contract for what to build, test, and validate. Source documents listed in frontmatter are for traceability — consult them only if you need narrative rationale or prose color this contract intentionally omits.

# RAGAS Benchmarking in the OKF Lab (Story 8-6)

## Why

The OKF Routing Lab can prove *routing* (which repository should answer) but nothing about *answer quality* — whether the generated answer is grounded, relevant, and backed by the retrieved context. Jerome's `tests/rag-benchmarks` harness proves exactly that, but only as an operator-run CLI on the swarm node: invisible to stewards, disjoint from the repositories they curate. This work brings RAGAS evaluation into the Lab as a first-class, in-product capability — mandate from David (2026-10-17), on `feat/okf-ragas` off `feat/okf-server` — so a steward can generate, run, and act on benchmark suites against their own and related repositories without leaving the Studio.

## Capabilities

- **CAP-1 — Generate RAGAS suites**
  - **intent:** Steward selects one or more repositories — the current repository alone, or together with any number of related repositories — and generates a benchmark suite with expected outputs (queries, reference answers, reference passages) synthesized from the selected repos' concepts.
  - **success:** With two or more repositories selected, the suite contains at least one multi-repo query; with a single repository, entries still carry query + reference answer + reference passages; the suite exists as a `ragas_suite` document and generation ran as a 202+poll job with progress phases.

- **CAP-2 — xlsx interchange**
  - **intent:** Steward imports and exports RAGAS benchmark suites AND results as xlsx files compatible with Jerome's `tests/rag-benchmarks` toolchain formats.
  - **success:** An exported benchmark-suite xlsx fed to `xlsx_to_gold.py` (unmodified) yields the harness's `gold_dataset.json` with zero format-driven skips; a suite authored in his format imports and runs; a results xlsx round-trips back into run history.

- **CAP-3 — Execute suites**
  - **intent:** Steward runs a RAGAS suite; each query gets retrieved contexts and a generated answer from the live corpus, scored by the four RAGAS metrics (faithfulness, context_precision, context_recall, answer_relevancy).
  - **success:** A run completes with per-query metric scores and aggregates for all four metrics; jobs obey the Lab's concurrency/lock/orphan semantics; sidecar-absence degrades to a clear 503, never a hang.

- **CAP-4 — Results display**
  - **intent:** Run results render per-query in tabular form with metric scores and in aggregate chart form (per-metric gauges plus run-over-run trend).
  - **success:** A completed run renders a per-query table with the four metric columns and meter bars, aggregate radial gauges, and a trend line across that suite's run history.

- **CAP-5 — Explain and advise**
  - **intent:** Failed rows get failure attribution (which pipeline stage broke) and guarded recommendations, in the same explain/advise pattern as the existing head/query tests.
  - **success:** Explain produces per-failure attribution rows following the matrix in `failure-attribution.md` plus guarded suggestions (screened by `guardSuggestions`), persisted as a `ragas_explain` doc and rendered in the existing chip UI.

- **CAP-6 — Integrated suite list**
  - **intent:** RAGAS suites appear in the existing saved-suites list, visually differentiated as RAGAS benchmark tests, with full Lab job semantics.
  - **success:** The existing Suites table lists both suite kinds with a RAGAS differentiator pill; selecting a RAGAS suite opens the RAGAS pane with it loaded; no existing head-suite behavior changes.

## Constraints

- ragas is Python-only and pinned at **0.4.3** (Jerome's pin): metric-number and report-shape parity with his chain is a hard requirement, so the sidecar dep set is frozen to his `requirements.txt` versions.
- xlsx compatibility is positional and tab-exact: the layouts in `xlsx-compat-formats.md` must be emitted and consumed verbatim (sheet name, header row 1, column order, `new-N` id joins, tab set, `NEW_COLS`/`COMPARE_HEADERS` names).
- 100% additive to the existing Lab: no modification of head-suite behavior, existing suite semantics, or the four Lab entry points; RAGAS rides the same collection, job pattern, routes shape, and store envelope.
- Sovereign stack: judge, generator, and embedder run on deployment-local endpoints **selected by use case and resource availability — no feature is indexed on a specific model**; every LLM-consuming task (suite generation, RAGAS judging, the answer leg, data curation, the existing suite tests) must meet the capability minimums in `model-requirements.md`: strict/guided JSON wherever structured output is parsed, per-task window minimums, no reasoning-token leak into judge completions.
- Project code standards: CommonJS backend, Vue 3 Options API, `translate()` i18n with 14 deep-key-identical locales, `vue3-apexcharts` only, direct AQL, per-route auth middleware.
- Branch discipline: `feat/okf-ragas` merges to `feat/okf-server` only; nothing lands on `main` or `release/el-salvador` from this work.
- New env vars need four-site parity (code default, docker-compose, `env` template, `env.j2`) plus config-validator coverage.
- Suite size is bounded (`OKF_RAGAS_MAX_ENTRIES`): generation and runs cost LLM time on the shared GPU and must not starve chat answering.

## Non-goals

- Not replacing Jerome's CLI harness: offline deep evaluation on the swarm node stays his toolchain's role.
- No multi-turn samples or agent/tool metrics in v1.
- No latency or cost benchmarking (OTel trace waterfall remains that surface).
- No anchor-path chunk-hash metrics in the RAGAS tab: the existing Suites feature owns those; exported results carry his anchor columns blank.
- No chatqna-over-HTTP full-stack drive in v1 (Lab-internal replay only).
- No migration of existing head suites to RAGAS.

## Success signal

A steward generates a suite from one or more repositories, runs it, and sees four metric scores per query with charts and failure explanations; the same suite exported as xlsx runs unmodified through `xlsx_to_gold.py` → `run_eval.py dump-tuples` → `run_ragas_eval.py` on the swarm node.

## Assumptions

- Assumed any model meeting the `model-requirements.md` minimums works for every task; granite-4.1-8b and MiniMax-M3 (+ TEI bge-large) are validated instances, not requirements.
- Assumed default testset size 12 keeps generation tractable on a shared GPU (config knob `OKF_RAGAS_TESTSET_SIZE_DEFAULT`).
- Assumed sheet name `Test Dataset` (his `--sheet-name` default) is acceptable for exports.
- Assumed `okf_head_test_runs` tolerates the new kinds without index changes (`repo_id` and `created_at` indexes already present).

## Open Questions

- Should the results export include his matplotlib Charts tab, or is omitting it (UI charts are the feature) acceptable?
- Extend the metric set beyond the four in v1 (answer_correctness toggle), or strictly Jerome's four until parity is proven?
- Default testset size (proposed 12) — and should generation require an explicit confirm given LLM cost on the shared GPU?
- Should imported RAGAS results appear in the same run-over-run trend chart as native runs (proposed yes, tagged imported)?
