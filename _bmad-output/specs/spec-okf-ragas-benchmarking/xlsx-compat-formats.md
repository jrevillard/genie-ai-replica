# xlsx compatibility formats — RAGAS ⇄ Jerome's `tests/rag-benchmarks`

**Terminology (binding, per David 2026-10-17):** the user-facing term is **benchmark suite** (UI, docs, `ragas_suite` storage). **"Gold dataset"** is only Jerome's artifact name inside this compatibility contract — a proper noun for what `xlsx_to_gold.py` produces and the `Gold` tab (not renamable; it is his format). Never a hybrid. "Gold" is not RAGAS vocabulary — RAGAS calls ground truth `reference` / `reference_contexts` at field level.

The compatibility contract, verified against his code (file:line anchors from the 2026-10-17 deep read of `feat/okf-server`'s tree, which matches `origin/main`). Two adopted companions carry the operational side: `../../../tests/rag-benchmarks/eval/CLAUDE.md` and `RUNBOOK.md`.

## 1. Suite xlsx (export target = his INPUT format; import source)

What `xlsx_to_gold.py` reads and what our export must emit:

- Loaded `data_only=True` (`xlsx_to_gold.py:187`) — emit literal values, not formulas.
- Sheet name: `Test Dataset` (his `--sheet-name` default, `:65`).
- Header row: row 1 (v2 hard-requires it at row 1, `enrich_xlsx_v2.py:1017-1031`).
- **Positional** columns — header names are never read by `xlsx_to_gold.py` (write the conventional names anyway for humans):

| Col | Name | Content | Our source |
|---|---|---|---|
| 1 | `id` | int `1..N` (his `=ROW()-1` evaluates to ints; plain ints are equivalent) → joins as `new-<N>` | entry ordinal |
| 2 | `difficulty` | label; optional | suite entry `difficulty` (from synthesizer style) |
| 3 | `query` | required text | entry `query` |
| 4 | `answer` | reference answer | entry `reference_answer` |
| 5 | `passages` | multi-value: blank-line-separated (`\n\s*\n` regex, `:124-137`); each part → one `expected_chunks[].preview` | entry `reference_passages[]` |
| 6 | `source` | doc reference → `expected_chunks[].source_doc` | entry `source_doc` |

- **Out-of-scope entries**: passages cell whose stripped text starts `n/a` / `out-of-scope` / `not applicable` (case-insensitive, `:134`) → `expected_chunks: []`. Emit exactly `N/A`.
- Trailing all-empty columns tolerated (his sheets have 8); blank rows and empty-query rows skipped — emit neither.
- Import direction: read the same layout; ids may be ints (→ `new-N`) or pass-through strings; tolerate `--passage-separator` sentinels other than blank-line by accepting both blank-line and `@@@@@` on read (be liberal).

## 2. Results xlsx (export = his v2 output vocabulary; import = ours or his v2)

Tab order: `Gold`, `Run_<label>`…, `Compare`, `Calibrate`. Charts tab omitted (UI charts are the feature).

- `Gold` tab: the benchmark suite in the §1 layout verbatim (`Gold` is his tab name, kept for compatibility).
- `Run_<label>` tab (`build_run_tab` shape, `enrich_xlsx_v2.py:934-976`):
  - Row 1 config block: A1 `params` (bold), B1 params JSON string; D1 `note`, E1 note text.
  - Row 2 header: suite columns (§1) + the 22 `NEW_COLS` in his exact order (`:80-103`): `gold_recall, gold_complete_recall, gold_precision, gold_noise, gold_retrieval_recall, gold_passage_recall, selected_keys, candidate_keys, trace_found, ragas_faithfulness, ragas_context_precision, ragas_context_recall, ragas_answer_relevancy, ragas_nan, answer_first_200, abstained, abstention_reason, answer_lang, gold_match_status_per_chunk, gold_chunk_count, is_unresolved, n_evaluable_helper`.
  - Rows 3+: one per suite entry. **Anchor columns blank** (no anchor leg); `ragas_*` floats or `""` for NaN; `selected_keys`/`candidate_keys` `;`-joined, truncated to 8 entries then `...(+N)`; `abstained` `"yes"`/`"no"`; `answer_first_200` first 200 chars; `n_evaluable_helper` 0/1.
  - **Extended metrics** (per David 2026-10-17, the full catalog is selectable): metrics enabled beyond the default four append additional `ragas_<metric>` columns **after** his 22, same float-or-blank convention. His tooling reads by name and ignores unknown columns — the extension is backward-compatible. Charts tab omitted (charts are a mandatory Lab capability, not an export artifact).
  - Label ≤26 chars, unique.
- `Compare` tab: his 18 `COMPARE_HEADERS` verbatim (`:255-274`): `label, params, n_evaluable, n_abstained, n_unresolved, recall, precision, f1, complete_recall, retrieval_recall, passage_recall, avg_selected, ragas_faithfulness, ragas_context_precision, ragas_context_recall, ragas_answer_relevancy, delta_recall_vs_base, delta_f1_vs_base` — one row per run, first = baseline, `delta_*` signed `+0.0000` strings; anchor-derived cells blank.
- `Calibrate` tab: created with his 10 headers (`:278-289`), rows empty (no calibration data in v1).
- **No results import** (per David 2026-10-17): results flow one way (export). Only benchmark suites import (§1 rules).

## 3. JSON schemas (internal + sidecar contract)

- **ragas_suite payload.entries[]**: `{id: "new-N", query, reference_answer, reference_passages: [preview…], source_doc, language, difficulty?, persona?, synthesizer?, oos: bool, lastRun?}`.
- **ragas_run payload.results[]**: `{id, query, contexts: [chunk texts], context_keys: [_key…], answer, abstained, error?, metrics: {<metric>: score}}` keyed by enabled metric (default four always present; full single-turn catalog selectable — `metrics_config` on the suite/run records the selection); `payload.summary`: per-metric means (NaN-skipped), `n, n_evaluable, n_abstained, n_errors`; `payload.fidelity`: `{retrieval: {algorithm, top_k, rerank}, prompt: {system_prompt_sha, source}, judge: {model, embed_model}}`.
- **Sidecar /evaluate** request samples: `{user_input, retrieved_contexts, response, reference, reference_contexts?}` — the first four are the exact keys `run_ragas_eval.py:366-374` maps (`reference_contexts` additionally enables the non-LLM context metrics); `metrics: [<selection>]`; response: `{aggregate: {metric: mean}, per_query: [{user_input, …metrics}]}` matching his `ragas_report.json` shape so any consumer of his report reads ours.
- **Sidecar /generate-testset** response samples: `{user_input, reference, reference_contexts, persona_name, query_style, query_length, synthesizer_name}` (ragas `TestsetSample` fields).

## 4. Join semantics (the spine)

- Suite↔run↔results join on entry `id` (`new-N`) — the same join spine his chain runs from gold dataset → anchor report → eval tuples.
- RAGAS per-query joins on **stripped question text** in his chain (`enrich_xlsx_v2.py:499-510`); our run doc keeps both `id` and `query` so both joins work.
- `content_hash` (sha256[:16] of normalized text, `chunk_identity.py:23-38`) is NOT used by the RAGAS path — but export keeps `reference_passages` verbatim so his Phase-2 matcher can hash them on his side.
