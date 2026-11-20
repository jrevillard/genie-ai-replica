---
title: 'Story 1.6 — Implement `search_knowledge` (OPEA-free, behavior frozen)'
type: 'feature'
created: '2026-11-20'
status: 'in-review'
route: 'dispatch'
baseline_commit: '1301b16c72e78aa396c850325dc0f759b2caac94'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/docs/baselines/v02-opea-query-path-contract.md'
  - '{project-root}/docs/baselines/v02-opea-query-path-contract.fixtures.json'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 1's capability layer has a typed contract (`search_knowledge`, story 1.5) but no implementation: retrieval still runs only through the OPEA overlay (retriever microservice + chatqna + reranker microservice). The agent-service must gain the search operation as a clean-slate port of the recorded query path (V02), so retrieval works without OPEA and the V02-recorded behavior is preserved deliberately.

**Approach:** Implement `search_knowledge` inside `components/agent-service` as port + adapters: an ArangoDB retrieval adapter (dense cosine leg, BM25 lexical leg, RRF fusion, label clause + Python post-filter, file_id enrichment, CAP-1 identity join), a TEI embedding adapter honoring the model-specific query-instruction contract, and a TEI reranking + evidence-selection adapter — all reading the SAME env knobs the deployed path reads, with per-behavior equivalence tests asserted against the V02 fixtures.

## Boundaries & Constraints

**Always:**
- **The frozen behavior set is exactly the story AC's enumerated stages** (identical to the epic-context frozen list): dense retrieval, BM25 lexical leg, RRF fusion, label filter clause + defense-in-depth post-filter, file_id enrichment, CAP-1 identity join (tolerated absence), the query-instruction prefix contract, and the TEI reranking + evidence-selection stage including its failure modes. Graph traversal, multi-graph fan-out and the routing gate are recorded in V02 (§4.9–4.11) but are **not** in the frozen enumeration and are **not** implemented here; story 1.9's catalog-wide suite owns the full 14-behavior inventory.
- **Behavior frozen to V02** for the implemented stages: same semantics, same ordering, same env knob names, same failure outcomes (V02 §4.1–4.8, §4.12–4.14).
- **Clean-slate per AD-10**: no `comps` import, no OPEA service call, no shared library with the overlay, no wrapping — the query path is reimplemented inside `components/agent-service`. Structure free: typed port/adapters, DI-friendly constructors.
- **The contract is the seam**: the implementation realizes `DocumentCapabilityPort.search_knowledge(context, request, budget)` from `capabilities/contract.py` — the caller context carries the authorized graph set + requested labels; the input carries only the prepared query; non-prepared input is refused by the contract (validation, not an outcome).
- **The port never calls vLLM** and never prepares a query: preparation is story 1.8's module, loop-side.
- Every new dependency clears the pre-adoption checklist (V07a exact-version licence + NFR-2 defaults audit) and its pins land in `docs/dependencies/agent-service-dependency-evidence.json`.
- All artefacts (code, comments, docs) in English.

**Never:**
- No `read_source`, no authorization executor — story 1.7. (The `search_knowledge` adapter still only ever queries the caller context's authorized graphs — enforcement-by-construction on the search surface is part of this port; the authorization *executor* that re-validates read targets is not.)
- No preparation module, no language detection, no translation — story 1.8.
- No graph traversal, no multi-graph fan-out, no routing gate (V02 §4.9–4.11) — recorded but outside the frozen enumeration; the search runs the legacy single-graph path per leg (one leg per authorized graph, fused unweighted — that second-level fusion is the fan-out stage and is NOT ported; with the deployed single-graph posture the search addresses the graphs the context names, one search per graph, in context order).
- No change to the OPEA overlay, the chart, the BFF, or any other component: this story touches `components/agent-service/**` plus the dependency evidence file only.
- No LLM generation, no prompt construction, no answer path — the result is hits + outcome, nothing else.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| prepared query, authorized graph | `PreparedQuery(TRANSLATED\|PASSTHROUGH_ENGLISH)`, context names ≥1 authorized graph | result `outcome=success`, hits in reranker score-descending order, provenance per chunk (legacy `file_id`, or OKF trio when the CAP-1 join resolved) | N/A |
| non-prepared query | `PreparedQuery(passthrough_unknown_language\|fallback_timeout\|fallback_error)` | contract refuses the input — the operation never runs | pydantic `ValidationError` (contract validator, story 1.5) |
| empty authorized graph set | context with zero authorized graphs | the port has nothing to query | `AuthorizationError` (nothing authorized → nothing searchable) |
| dense empty, BM25 empty | both legs return nothing | `outcome=insufficient_evidence`, hits empty, reason `no_documents_retrieved` (span + log) | answer type, not an error (V02 §4.1/§4.12) |
| dense empty, BM25 non-empty | fusion rescues the query | fused results proceed to reranking (V02 §4.1: fusion runs before the empty check) | N/A |
| reranker selects nothing | TEI returns scores, selection is empty | `outcome=insufficient_evidence`, hits empty, reason `reranker_selected_nothing` (distinct from `no_documents_retrieved`) | answer type (V02 §4.13) |
| TEI rerank HTTP 422 + `error_type=Validation` | input exceeds the reranker token cap | `outcome=insufficient_evidence`, hits empty, reason `reranker_input_too_long` (distinct; V02 §4.14) | answer type |
| TEI unreachable / timeout | transport error or the 300 s total timeout fires | raised `TransientError` — **no** fallback to retrieval order (V02 §4.14) | turn fails |
| TEI other HTTP error / non-list body | 5xx, 429, malformed body | raised `TransientError` (RuntimeError class in the record) | turn fails |
| TEI score count ≠ document count | mismatched response | warning logged, selection proceeds (V02 §4.14) | not fatal |
| TEI index out of range | index beyond the doc list | the document is skipped, selection proceeds (V02 §4.14) | not fatal |
| BM25 view absent / view creation fails | ArangoSearch view missing or creation error | logged, BM25 leg returns `[]`, dense-only path continues (V02 §4.2) | never raised |
| fusion error | unexpected fusion failure | logged (`Hybrid BM25+RRF fusion failed, falling back to dense-only`), dense-only list used (V02 §4.3) | never raised |
| CAP-1 join fails | `okf_concepts_meta` absent / DB error | ERROR logged (`OKF identity enrichment failed (chunk identity left as-is)`), chunks served unattributed → legacy `file_id` provenance (V02 §4.7) | leg never broken |
| CAP-1 identity absent | no meta row for (graph_name, concept_id) | `repo_id`/`bundle_version` unset → legacy `file_id` provenance, no warning (V02 §4.7) | tolerated |
| budget deadline expires | `budget.timeout_ms` elapsed | raised `TransientError`, no partial result (contract limit declaration) | turn fails |
| cancellation | caller cancels | `asyncio.CancelledError` propagates unchanged (contract: never a code) | caller-owned |
| result exceeds `max_results`/`max_result_bytes` | budget binds | hits truncated, `truncated=true` (contract limit declaration) | declared |
| invalid `RETRIEVER_ARANGO_FILTER_STRATEGY` at boot | value outside AND/OR | boot-time `ValueError` — same crash-loop pattern as the deployed retriever config (V02 §4.4) | configuration error, not request-time |
| invalid `RERANKING_STRATEGY` env | unknown strategy name | resolves to `slice` with a warning (V02 §4.13 + `resolve_reranking_strategy`) | degraded to recorded default |
| label override vs env conflict | (not applicable — the narrowing is context-only) | labels come from `CallerContext.requested_labels`; no request-time label override exists | N/A |

</frozen-after-approval>

## Code Map

**The contract (story 1.5 — realizes `DocumentCapabilityPort`):**
- `components/agent-service/capabilities/contract.py` — `CallerContext` (authorized graphs + repos + requested labels), `PreparedQuery` (refuses non-prepared statuses via `QueryPreparationStatus.is_prepared`), `SearchKnowledgeInput/Result`, `SearchHit` (provenance + text + score), `LegacyFileProvenance`/`OkfConceptProvenance`, `OperationBudget` (timeout_ms/max_results/max_result_bytes), `TransientError`/`AuthorizationError`, `OutcomeCode`. Do not modify — it is accepted, closed and versioned.

**The V02 record (the behavior being frozen):**
- `docs/baselines/v02-opea-query-path-contract.md` — §4.1 dense (brute-force cosine, `COSINE_SIMILARITY` AQL, score threshold inside the search, no score post-filter in the retriever), §4.2 BM25 (ArangoSearch view `GRAPH_BM25_VIEW`, `TOKENS(@query, @analyzer)` on the RAW query, `n = max(K, BM25_CANDIDATES)`, failure → `[]`), §4.3 RRF (`weight/(k+rank)` per channel over newly seen ids, `_key` identity, insertion-order ties favoring dense, truncate to `k`, failure → dense-only), §4.4 label clause (OR/ANY, AND/ALL, no labels → no clause), §4.5 Python post-filter (no-label chunk dropped when a filter is active), §4.6 file_id enrichment (ONE batched AQL, `file_ids` list `[fid]`/`[]`), §4.7 CAP-1 (join on `graph_name`+`concept_id=doc.file_id`, tolerated absence, failure-isolated), §4.12 query instruction (overrides first, built-in table second, first match wins, no-prefix models raw), §4.13 reranking (5 strategies, score-descending order, calibration at confidence time only, two distinct abstentions), §4.14 reranker-down (one behavior per failure mode).
- `docs/baselines/v02-opea-query-path-contract.fixtures.json` — `expectations.behaviors` (14 entries; the implemented subset: `dense_retrieval`, `bm25_lexical_leg`, `rrf_fusion`, `label_filter`, `defense_in_depth_post_filter`, `file_id_enrichment`, `cap1_identity_join`, `query_instruction`, `reranking_evidence_selection`, `reranker_down`), `measured.deployed_env`/`absent_knobs` (the knob values + code defaults), `expectations.discrepancies` (deployed vs code defaults).

**The source being ported (read-only reference — never imported):**
- `genie-ai-overlay/core/embedding_query_prefix.py` — `TEI_EMBED_MODEL` default, `_BUILTIN_QUERY_INSTRUCTIONS` table (7 entries, most-specific-first), `_parse_query_instructions` (comma-split `substring=instruction`, trailing spaces preserved), `get_query_instruction` (overrides first, case-insensitive substring, None = no prefix). Port the table and resolution verbatim in behavior; the module is dependency-free.
- `genie-ai-overlay/retriever/genieai_retriever_arangodb.py` — `_chunk_passes_label_filter` (302-315), `_escape_aql_string` (backslash-first, then quote, then \n/\r/\t), `_build_aql_filter_clause` (391-426; invalid strategy at REQUEST time = HTTP 400 in the deployed service — in the port the strategy is boot-validated, so this branch is a defensive raise), `_normalize_chunk_id` (429+; `COLLECTION/_key` → `_key`, None-kept-standalone), `rrf_fuse` (592-632; unkeyed docs get `__unkeyed_N` identities), `_ensure_bm25_view` (840-877; idempotent, cached on success only, never raises), `_bm25_search` (880-936; AQL shape + label post-filter per row + never raises), the dense call (1763-1813; `asimilarity_search_with_relevance_scores` semantics = langchain-arangodb 1.2.0 `_build_vector_search_query` with `use_approx=False`: `FOR doc IN @@collection <filter_clause> LET score = COSINE_SIMILARITY(doc.embedding, @embedding) SORT score DESC LIMIT k`, relevance fn identity, threshold `score >= 0.2` applied by the wrapper; **dense Documents carry NO chunk_labels in metadata** — `_process_search_query` pops `_key`+`text` and `return_fields` is empty — so the dense-leg Python post-filter drops every dense result when a label filter is active: a recorded quirk, reproduced faithfully), dense post-filter (1819-1833), hybrid block (1834-1898; `bm25_n = max(k, 50)`, fusion before empty-check, truncation `[:k]`), file_id enrichment (1912-1939; ONE batched AQL, `metadata["file_ids"] = [fid] if fid else []`), CAP-1 join (1941-1975; `FIRST(... okf_concepts_meta FILTER m.graph_name == @graph_name AND m.concept_id == doc.file_id ...)`, sets `repo_id`/`bundle_version` on metadata only when present).
- `genie-ai-overlay/retriever/config.py` — the knob names + code defaults the port must expose identically (63-123: ARANGO_URL/USERNAME/PASSWORD/DB `_system` deployed, GRAPH_NAME, SEARCH_MODE `vector`, SEARCH_START `chunk`, DISTANCE_STRATEGY `COSINE`, USE_APPROX `false`, K `20` deployed/4 code, FETCH_K inert in vector mode, SCORE_THRESHOLD `0.2` deployed/0.1 code, DISTANCE_THRESHOLD read-by-nobody, NUM_CENTROIDS, FILTER_STRATEGY boot-validated OR, HYBRID_* enabled/60/50/1.0/1.0/`text_en`).
- `genie-ai-overlay/reranker/genieai_tei_reranker.py` — `resolve_reranking_strategy` (92-119: unknown/empty → deployment default, invalid default → `slice` with warning), the TEI call (349-367: `POST {base}/rerank` `{"query", "texts", "truncate": false}`, trace headers, NO Authorization header, 300 s total / 30 s connect (`MODEL_RERANK_TIMEOUT_SECONDS`/`MODEL_CONNECT_TIMEOUT_SECONDS`, defaults 300/30), no retry), 422+`Validation` → typed too-long (376-402), non-200 → RuntimeError (405-417), non-list body → RuntimeError (419-432), count mismatch → warning (434-439), strategy branches (440-616: slice `[:top_n]`, threshold `>=`, knee via KneeLocator curve=convex/decreasing keep knee+1 (or all), slice_threshold `>=` capped at top_n with break-on-first-below, adaptive hard-fails on missing/misaligned embeddings then `adaptive_context_selection` over `CONTEXT_DECAY_FACTOR`/`MIN_VALUE_THRESHOLD`/`NOVELTY_SIGMOID_A/B`), `_safe_get_doc` (out-of-range index → log + skip), `adaptive_context_selection` (151-279: relevance `score + (score - avg*(1+tanh(skew)))`, novelty cosine-based with query-delta, utility `relevance*novelty_weight`, cost `decay*len/4 + confusion`, select `value > MIN_VALUE_THRESHOLD`).
- `genie-ai-overlay/chatqna/genieai_chatqna.py` — the reranker params (4936-4944: strategy/top_n/threshold forwarded from env), `_calibrate_reranker_score` (1742-1760: `none` → raw, `sigmoid` → `1/(1+exp(-s/temperature))` with OverflowError saturation, applied at confidence time only), the abstention mapping (5035-5121: too-long → HTTP 200 + `abstention_reason=reranker_input_too_long` + English abstention text; empty selection → `reranker_selected_nothing`; empty retrieval → `no_documents_retrieved`), the prefix application (2501-2518: `inputs["input"] = prefix + raw`, RAW text to the retriever/BM25 side-channel).
- `genie-ai-overlay/chatqna/genieai_chatqna.py:1031-1033` — chatqna's own `RETRIEVER_ARANGO_K/FETCH_K/SCORE_THRESHOLD` reads (the chatqna-side defaults the fixtures' `chatqna` knob block records).

**The service scaffold (story 1.3) and its lane:**
- `components/agent-service/app.py`, `tracing.py` — FastAPI + OTel; `setup_tracing` gates on `ENABLE_OBSERVABILITY`. The capability mounts nothing on the HTTP surface in this story (internal port only; the serving API is later-epic work) — the adapters are exercised by the tests and by the port interface.
- `components/agent-service/tests/` — pytest, `pythonpath=["."]`, modules import as `capabilities.*`. CI: `test:agent-service` runs `python -m pytest tests/ -q`; `lint:agent-service` runs ruff over `app.py tracing.py capabilities/ tests/`.
- `components/agent-service/requirements.txt` — fully pinned; `requests` present (runtime), `httpx==0.28.1` + `pytest==9.1.1` (test tree, audited in `docs/dependencies/agent-service-dependency-evidence.json`).
- `scripts/dependencies/verify-dependency-licenses.py` + `docs/dependencies/pre-adoption-checklist.md` — the four gates; `--fetch` per tree, evidence JSON regenerated with the new pins.

**Structural shape of the port (new files, all under `components/agent-service/`):**
- `capabilities/adapters/__init__.py`, `capabilities/adapters/env_config.py` (the knob reader: same names, code defaults, boot validation), `capabilities/adapters/query_instruction.py` (the ported instruction contract), `capabilities/adapters/arango_retrieval.py` (dense + BM25 + RRF + label + post-filter + enrichment + CAP-1), `capabilities/adapters/tei_embedding.py` (embed endpoint honoring the instruction contract), `capabilities/adapters/tei_reranking.py` (TEI `/rerank` + 5 strategies + failure modes + calibration), `capabilities/search_knowledge.py` (the port implementation: orchestrates the adapters per graph in the authorized set, maps outcomes onto the contract), and `tests/test_search_knowledge.py` + `tests/test_query_instruction.py` + `tests/test_reranking_strategies.py` + `tests/test_retrieval_semantics.py` (the per-behavior equivalence tests).

## Open Questions

None — the scope questions this story raised are settled by the epic-context frozen list (it enumerates exactly the AC's stages and omits traversal/fan-out/routing), by the accepted contract's result surface (story 1.5's matrix: every empty case is `insufficient_evidence`), and by the record's knob inventory.

## Tasks & Acceptance

**Execution:**
- [x] `capabilities/adapters/env_config.py` — the frozen knob surface: every V02-recorded env name, the recorded code defaults, boot-time validation (`FILTER_STRATEGY` ValueError; unknown `RERANKING_STRATEGY` default+warning is request-time resolution per the record), and the recorded inert knobs read-but-unused where the record says so (`DISTANCE_THRESHOLD`, `FETCH_K`).
- [x] `capabilities/adapters/query_instruction.py` — `get_query_instruction` port: built-in table + deployer overrides, first-match-wins, case-insensitive substring, `None` = no prefix; `TEI_EMBED_MODEL` default `BAAI/bge-large-en-v1.5`.
- [x] `capabilities/adapters/tei_embedding.py` — embeds the PREFIXED query against `TEI_EMBEDDING_ENDPOINT` (TEI `/embed` shape, `{"inputs": [text]}`), raw text stays retriever-side for BM25.
- [x] `capabilities/adapters/arango_retrieval.py` — python-arango adapter: dense brute-force cosine AQL (score `>=` threshold, DESC, LIMIT k, filter clause pre-LIMIT), BM25 view ensure + `_bm25_search` AQL on the raw query, weighted RRF with `_key` identity + insertion-order ties + `[:k]` truncation + dense-only fallback, label clause builder + per-leg Python post-filter, batched file_id enrichment (`[fid]`/`[]`), CAP-1 join with tolerated absence and failure isolation.
- [x] `capabilities/adapters/tei_reranking.py` — TEI `/rerank` call (recorded shape, timeouts, no Authorization), the five selection strategies with the recorded semantics, failure-mode mapping (422/HTTP/non-list/mismatch/out-of-range), score-descending order preserved, calibration function for confidence-time use.
- [x] `capabilities/search_knowledge.py` — the port: validates the caller context (≥1 authorized graph else `AuthorizationError`), embeds via the instruction contract, retrieves per authorized graph in context order, reranks the candidates, maps empty/abstention outcomes onto the contract (`insufficient_evidence` with the recorded reason on the span + log), honors budget timeout / result size / cancellation, and returns `SearchKnowledgeResult`.
- [x] `capabilities/adapters/__init__.py` + package wiring; `Dockerfile` COPY carries `capabilities/` into the image (the first-importer obligation story 1.5 deferred to this story); `pyproject.toml` unchanged unless the lint path list needs it (it already lints `capabilities/` recursively).
- [x] `requirements.txt` — new pins: `python-arango` (ArangoDB driver), `httpx` promoted to runtime (async TEI calls; the already-audited 0.28.1 pin), `kneed` + `numpy` + `scipy` (the knee_threshold strategy is frozen to the SAME pins the deployed reranker serves: kneed 0.9.0 / numpy 1.26.4 / scipy 1.17.1). Evidence regenerated with the licence tool; NFR-2 verdicts per package; all release channels stable.
- [x] `tests/` — the per-behavior equivalence suite: one test block per frozen V02 behavior, fixtures loaded from `docs/baselines/v02-opea-query-path-contract.fixtures.json` (knob values + expected semantics), plus the contract-mapping tests (empty outcomes, budget, cancellation). ArangoDB and TEI are faked at the driver/HTTP boundary; the recorded AQL shapes are asserted verbatim.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` — row `1-6-implement-search_knowledge-opea-free-behavior-frozen` → `review` (in this MR).
- [x] Gate re-run: the OPEA-free gate (story 1.4) green over the new package (config-validator suite 584/584); ruff + `python -m pytest tests/ -q` green (163 passed).

**Acceptance Criteria:**
- Given the V02 record and the contract, when `search_knowledge` executes, then dense retrieval, BM25, RRF fusion, label filtering + post-filtering, file_id enrichment and the CAP-1 identity join behave per the recorded semantics — for fixed candidates the selected evidence and order match the recorded reference, including cutoff (`RERANKER_TOP_N`), empty-result (`no_documents_retrieved` vs `reranker_selected_nothing` distinct) and reranker-down cases (422 → `reranker_input_too_long` abstention; transport/HTTP errors → raised `TransientError`, no retrieval-order fallback), with the same env-exposed knobs (`RETRIEVER_ARANGO_*`, `RETRIEVER_HYBRID_*`, `RERANKING_*`, `RERANKER_*`, `TEI_EMBED_MODEL`, `EMBEDDING_QUERY_INSTRUCTIONS`, `TEI_EMBEDDING_ENDPOINT`, `TEI_RERANKING_ENDPOINT`, `ARANGO_*`).
- Given the embedding request, when it is built, then it honors the model-specific instruction contract (`get_query_instruction`): deployer overrides first, built-in table second, first match wins, the no-prefix models (`BAAI/bge-m3`, `sentence-transformers/*`, …) embed raw, and the prefix applies to the query only (BM25 tokenizes the bare query) — asserted against the model contract, not a universal degradation claim.
- Given the input contract, when a non-prepared query is submitted, then the operation is refused by the contract before execution (validation failure, not an outcome code).
- Given the V02 fixtures, when the per-behavior equivalence tests run, then every frozen behavior in the story's scope asserts green against the fixtures' recorded expectations (AQL shapes, knob defaults, ordering, failure outcomes).
- Given the package, when the OPEA-free gate (story 1.4) runs, then no `comps`/OPEA import or download exists in it, and the structure is the modern port/adapter shape (clean-slate per AD-10).

## Implementation Notes

- **Outcome mapping (contract ↔ V02):** the recorded abstention reasons are finer than the contract's result surface. All three empty cases (`no_documents_retrieved`, `reranker_selected_nothing`, `reranker_input_too_long`) carry `outcome=insufficient_evidence` + empty hits on the contract surface (story 1.5's accepted matrix: "no admissible hit → insufficient_evidence, hits empty"), and each keeps its recorded reason as a span attribute + log line (`abstained.reason`), so the equivalence suite can assert the recorded distinction without widening the accepted contract. `reranker_input_too_long` additionally logs the recorded English abstention text.
- **Score semantics:** `SearchHit.score` carries the reranker's selection score (raw TEI score when calibration is `none` — the deployed value). Calibration (`sigmoid`) is implemented and applied at confidence computation only, never to selection or ordering — the recorded contract.
- **Multi-graph shape:** the port queries each graph the caller context names, in context order, with the recorded single-graph semantics per leg, and merges hit lists (candidates per graph → one reranking stage over the union, fused unweighted by (graph, key) as the recorded fan-out fusion does — the fan-out's per-leg timeouts/caps are NOT ported). The deployed posture names exactly one graph; the recorded behaviors are per-leg and unaffected.
- **Dense metadata quirk is reproduced, not fixed:** langchain-arangodb 1.2.0 returns dense Documents with empty metadata (no `chunk_labels`), so the deployed dense-leg Python post-filter drops every dense result when a label filter is active; the ported adapter reproduces the same behavior (the port never "improves" a recorded behavior — improvements are iteration-2 work per the epic context).
- **ArangoDB driver:** `python-arango` is the minimal new runtime dependency (the clean-slate port queries ArangoDB directly). It is sync — the adapter's calls execute against the driver inside the async pipeline; the recorded stage semantics are unchanged (the deployed path's own async wrappers run the same sync driver under an executor). Dense search is the recorded AQL executed directly (no langchain dependency is introduced); the AQL and score semantics are asserted verbatim in the equivalence tests.
- **knee_threshold pins the deployed reranker's own tree:** the recorded strategy is `kneed.KneeLocator`-defined, so the port adopts the SAME pins the deployed reranker serves (`kneed==0.9.0`, `numpy==1.26.4`, `scipy==1.17.1`) rather than reimplementing kneedle and risking behavior drift. The adaptive selection was ported to `math` + pure Python (its numpy usage is `tanh`/`dot`/`norm` only); numpy rides in as kneed's dependency and is pinned to the deployed reranker's version.
- **Boot-time configuration errors** mirror the deployed retriever's precedent: an invalid `RETRIEVER_ARANGO_FILTER_STRATEGY` raises at config load (the pod crash-loops, the client sees 503 — V02 §4.4); the same pattern applies to `RETRIEVER_ARANGO_SEARCH_MODE`/`SEARCH_START`/`DISTANCE_STRATEGY` values outside the recorded deployment surface (`vector`/`chunk`/`COSINE`), which the record does not define behavior for.
- **The service stays dark:** the story adds no HTTP route; `app.py` is untouched. The capability is exercised through the port interface by the suite. The serving API is a later epic's seam.
- **CI:** no new job. The existing `lint:agent-service` + `test:agent-service` lanes already match `components/agent-service/**/*.py`. The OPEA-free gate (story 1.4) scans the package — the port introduces `python-arango`, which is not an OPEA package; gate stays green.

## Spec Change Log

## Review Triage Log

## Verification

**Commands:**
- `cd components/agent-service && ruff check . && ruff format --check .` — expected: clean
- `cd components/agent-service && python -m pytest tests/ -q` — expected: green (contract + new equivalence suites)
- `python3 scripts/dependencies/verify-dependency-licenses.py --fetch components/agent-service/requirements.txt --fetch components/agent-service/requirements-test.txt --out docs/dependencies/agent-service-dependency-evidence.json` — expected: evidence regenerated with `python-arango` + promoted `httpx`, no NOASSERTION
- OPEA-free gate job (CI, `config:validate` lane) over the branch — expected: green
