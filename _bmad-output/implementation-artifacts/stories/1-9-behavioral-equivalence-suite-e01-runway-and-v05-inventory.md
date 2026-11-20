---
title: 'Story 1.9 — Behavioral equivalence suite (E01 runway) and V05 inventory'
type: 'feature'
created: '2026-11-20'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '8e26b87236a7b45c4a9059a380166ed6027fe556'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-1-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 1 closes with story 1.9, and three things are missing. (1) Nothing proves continuously that the implemented port (stories 1.6–1.8) matches the V02 behavioral record — the fixtures file's expectation blocks are referenced by exactly two leaf assertions today. (2) Config B — E01's fixed no-agent answer pipeline — does not exist: the port and preparation are components, and component fixtures alone produce no complete answer. (3) V05 (the actual API/SSE/error contract inventory with regression coverage) and the S3 exit checklist are not written, so the stage-exit evidence (V02/V04/V05 recorded) is incomplete.

**Approach:** Four deliverables in `components/agent-service` and `docs/baselines`. (1) A data-driven equivalence suite in the agent-service pytest tree that reads `docs/baselines/v02-opea-query-path-contract.fixtures.json` and asserts every catalog behavior against the implementation — including the four behaviors the port deliberately does not implement, pinned as recorded deviations. (2) A `noagent/` package implementing config B as one single-pass call — preparation → retrieval/reranking/selection (the existing capability) → context/prompt construction → one fixed generation stage → checking/verdict/result assembly, with controlled answer translation behind an off-by-default gate — every run admitted through a flock slot-pool lane (the AD-6 dataprep idiom; story 2.3 hardens it with agent budgets). (3) `docs/baselines/v05-client-contract-inventory.md` — the actual BFF chat-path surface with its current regression coverage and its gaps as pre-S3-exit work items. (4) `docs/baselines/s3-exit-checklist.md` — the S3 exit checklist referencing this epic's evidence artifacts.

## Boundaries & Constraints

**Always:**
- The equivalence suite treats the fixtures file as the source of expectations: all 14 `expectations.behaviors` blocks plus the `expectations.preparation` block asserted; a missing, renamed or emptied block fails loudly. The suite is CI-runnable: no live venue, no network — implementation-side assertions through the established fake seams.
- The four behaviors story 1.6's port deliberately does not implement (`graph_traversal`, `fanout`, `routing`, and the retriever-envelope layer of `provenance_attach`) are pinned as recorded deviations — absence assertions plus a deviation table in the suite — never silently skipped.
- Config B is a single pass through the recorded stage list; no agent loop, no tool calls, no multi-step reasoning. The deployed prompt surface is ported verbatim: the `CHATQNA_SYSTEM_PROMPT` default, the abstention instructions, the EN hard-prefix, the three-section user template, docs rendered as `\n[Retrieved Document]: {text}` blocks; generation params `temperature=0.01`, `top_p=0.95`, `frequency_penalty=0.0`, `stream=false`, `max_tokens` omitted unless configured; the model id discovered from `{endpoint}/v1/models` with the `VLLM_LLM_MODEL_ID` override.
- Abstention stays structural, decided from pipeline-visible facts, with the recorded reasons kept distinct (`no_documents_retrieved`, `reranker_selected_nothing`, `reranker_input_too_long`) via a non-contract abstention sink on the capability; `CHATQNA_ENFORCE_ABSTENTION` (default `true`) gates both the instruction injection and the abstained flag. The `reranker_input_too_long` case answers the fixed English abstention text without a generation call, as deployed.
- An unprepared preparation result answers a degradation: no retrieval runs, the abstention instructions drive a generation without documents, `abstained=true` with the pipeline's own honest reason (`preparation_degraded`), and the exact `query_translation_status` rides the metadata — never a prepared label on source text.
- Every pipeline run passes through the admission lane: flock slot pool (O_NOFOLLOW, 0600, non-blocking exclusive locks, N slot files, busy only when all are held); when all slots are busy the run refuses with a typed busy error before any stage runs. `asyncio.CancelledError` propagates untouched everywhere.
- Env knobs keep deployed names where deployed (`VLLM_ENDPOINT`, `VLLM_LLM_MODEL_ID`, `CHATQNA_SYSTEM_PROMPT`, `CHATQNA_ABSTENTION_INSTRUCTIONS`, `CHATQNA_ENFORCE_ABSTENTION`, `VLLM_TRANSLATION_ENDPOINT`, `TRANSLATION_SERVICE_TIMEOUT`); new knobs follow the component's conventions (`MODEL_LLM_TIMEOUT_SECONDS`, `AGENT_LANE_*`, `AGENT_ANSWER_TRANSLATION_ENABLED` default off).
- V05 documents the ACTUAL surface read from code (routes, SSE frame types, error shapes, status codes) with file:line references, maps the current regression coverage per surface, and lists every uncovered surface as a numbered pre-S3-exit work item. No BFF, frontend or overlay code changes.
- The S3 exit checklist names, per check (contract, authorization, compatibility), the artifact that evidences it (V02/V03/V04/V05 records, the component suites, the CI gates) — completable without leaving the epic's artifacts.
- No new runtime dependency (httpx is pinned; `fcntl` is stdlib). Dockerfile `COPY noagent/ ./noagent/` (first-importer precedent); the CI ruff lane covers the new package.
- All artefacts in English; ruff + pytest green on the component; the story 1.4 OPEA-free gate stays green.

**Never:**
- No contract change: `capabilities/contract.py` untouched, `CONTRACT_VERSION` stays `1.0`; the abstention sink is a capability-level optional kwarg, not a contract field.
- No executor change: config B calls the capability directly (recorded decision — E01 compares against config A, which has no executor; the capability's own authorized-set check still guards the call).
- No traversal/fan-out/routing implementation in the port — story 1.6's recorded scope line stands; the suite pins the deviation instead.
- No agent loop, runtime seam, tool registry or internal envelope (story 2.1); no orchestrator budget hardening (story 2.3) — the lane is the primitive, not the hardened orchestrator.
- No HTTP surface on agent-service, no compose env wiring, no chart change — nothing reachable calls the pipeline yet.
- No BFF behavior change, no frontend change, no test weakening, no live-venue dependency in any new test.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| prepared English, hits | EN history, port returns hits | answer built from documents, `abstained=false`, metadata `query_translation_status=passthrough_english` | N/A |
| prepared translated | fr history translated | identical flow, status `translated` | N/A |
| empty retrieval | retriever returns nothing | `abstained=true`, reason `no_documents_retrieved`, abstention instructions injected, generation called without documents | N/A |
| reranker selected nothing | rerank empties the candidate set | `abstained=true`, reason `reranker_selected_nothing`, same injection | N/A |
| reranker input too long | TEI 422 Validation | `abstained=true`, reason `reranker_input_too_long`, the fixed English abstention text IS the answer, NO generation call | N/A |
| unprepared preparation | `fallback_timeout`/`fallback_error`/`passthrough_unknown_language` | degraded answer: no retrieval, no port call, abstention-instruction generation without documents, `abstained=true`, reason `preparation_degraded`, exact status in metadata | degradation, never confident data |
| abstention not enforced | `CHATQNA_ENFORCE_ABSTENTION=false` | no instruction injection, no abstained flag | N/A |
| lane saturated | all slots held | typed busy error before any stage runs | refusal, not queueing |
| caller cancels mid-generation | task cancelled during the LLM call | `CancelledError` propagates untouched; slot released | never mapped to a status |
| answer translation gated on | gate enabled, target `fr`, EN answer | answer translated through the translation endpoint, `translation_status=ok`; refused/failed keep the English answer with their status | controlled: budgeted cap + timeout |
| history over the window | prompt + answer reserve exceeds window | oldest history segments dropped; retrieved documents never truncated | N/A |
| generation endpoint down | transport failure / 5xx | the turn fails with a typed transient error | no fabricated answer |

</frozen-after-approval>

## Code Map

**Implementation surface (reuse, do not reinvent):**
- `components/agent-service/capabilities/search_knowledge.py` — the capability to call for retrieval→rerank→selection; `_insufficient()` logs the recorded reasons at 4 call sites (`no_documents_retrieved`, `reranker_input_too_long`, `reranker_selected_nothing`, `result_budget_exhausted`); add ONE optional `abstention_sink` kwarg here (per-call, default None — executor and tests untouched).
- `components/agent-service/preparation/` — `QueryPreparer.prepare()` (story 1.8) is config B's preparation stage; `PreparationResult` carries status/`PreparedQuery`/history text/language; `translation.py` holds the endpoint discovery + prompt patterns the answer-translation stage reuses; `config.py` the knob pattern.
- `components/agent-service/capabilities/adapters/env_config.py` — the frozen-dataclass `load(env=None)` knob pattern for the noagent config.
- `components/agent-service/tests/conftest.py` — `PreparationFakeTransport`, `preparation_model_entry`, samples, `seeded_langdetect`; the established per-module fake seams (`httpx.MockTransport` for TEI, nested FakeDb for Arango).
- `components/agent-service/tests/test_retrieval_semantics.py` / `test_reranking_strategies.py` / `test_query_instruction.py` / `test_search_knowledge.py` / `test_preparation_*.py` — the behaviors already asserted inline; the suite complements, never duplicates.
- `components/agent-service/Dockerfile:33-36` — the COPY block; add `noagent/`.
- `.gitlab-ci.yml:3857+` (`lint:agent-service`) — the ruff path list; add `noagent/` (story 1.8 correction-1 precedent).
- `genie-ai-overlay/dataprep/genieai_dataprep_microservice.py:118-147` — the flock slot-pool idiom to port (O_NOFOLLOW, 0600, non-blocking).

**Deployed behavior to port (read before writing):**
- `genie-ai-overlay/chatqna/genieai_chatqna.py:1922-1965` — the system prompt default, `CHATQNA_ABSTENTION_INSTRUCTIONS` default, the enforce flag predicate.
- `genie-ai-overlay/chatqna/genieai_chatqna.py:2643-2649` — the EN hard-prefix; `:587-595` the user-content template; `:3121-3123` the document rendering; `:2992-2998` + `:3113-3119` the abstention injection into the USER turn; `:2689-2749` the history truncation (oldest dropped, `DEFAULT_MAX_ANSWER_TOKENS=3896`, window − 200 buffer, documents never truncated).
- `genie-ai-overlay/chatqna/genieai_chatqna.py:2756-2772` + `:4890-4906` — the generation payload and request-level defaults; `:543-557` the model-id discovery; `:5343-5346` + `:5293-5325` the response/metadata assembly (`source_documents`, `filter_labels`, `retrieval_confidence_score`, `confidence_score`, `is_grounded`, `query_translation_status`, conditional `abstained`/`abstention_reason`); `:1833-1866` the structural abstention outcome; `:3645-3686` the source-document envelope (legacy `document_id` without marker; okf trio + `source: 'okf-concept'`).
- `components/gov-chat-backend/services/translation/gpu-translate-backend.js` — the answer-translation reference (prompt shape, output budget `min(room, 4*input+256)`, `finish_reason=length` rejection).

**V05/S3 raw material:**
- `components/gov-chat-backend/routes/query-routes.js` — the 10 chat-path routes, the SSE frame types (`chunk`/`metadata`/`translation`/`done`/`error`), the error shapes; `services/query-service.js`, `services/opea-worker.js`, `index.js` global handlers.
- Coverage map: `components/gov-chat-backend/__tests__/routes/query-routes.test.js`, `services/query-service.test.js`, `query-service-fanout.test.js`, frontend `chatbotService.test.js`, `tests/e2e/chatbot/*.spec.js`.
- `docs/baselines/v02-opea-query-path-contract.md`, `v04-authorization-provenance-ownership-map.md`, `v03-deployed-baseline-2026-11-19.md` — the recorded evidence the S3 checklist references; `stories/1-*.md` — the per-story verification evidence.

## Tasks & Acceptance

**Execution:**
- [x] `components/agent-service/noagent/config.py` — the frozen env-knob surface (`load(env=None)` pattern): generation endpoint + model id + timeouts, prompt overrides, enforce flag, answer-translation gate + knobs, lane size + lock path. Deployed names keep deployed defaults.
- [x] `components/agent-service/noagent/lane.py` — `AdmissionLane`: the flock slot-pool port (N slot files, non-blocking, O_NOFOLLOW + 0600, busy when all held), async acquisition, typed busy error, slot release on every exit path.
- [x] `components/agent-service/noagent/generation.py` — the fixed generation client: endpoint resolution, window/model discovery (`/v1/models`, TTL, negative cache), the recorded payload, transport seam for tests, typed transient failures, cancellation untouched.
- [x] `components/agent-service/noagent/prompt.py` — the ported prompt surface: system default + EN hard-prefix, user template, document rendering, abstention injection, history truncation under the discovered window (documents never truncated).
- [x] `components/agent-service/noagent/pipeline.py` — the single-pass entry `run()` under the lane: prepare → port call (with per-run abstention sink) → prompt → generate → verdict → assemble (+ gated answer translation); the result type carries answer/abstained/reason/source documents/metadata.
- [x] `components/agent-service/capabilities/search_knowledge.py` — the optional `abstention_sink` kwarg on `search_knowledge()` (default None; the executor's protocol call unchanged); a test pins the sink receives the exact reason at each of the four insufficient sites.
- [x] `components/agent-service/tests/test_noagent_config.py`, `test_noagent_lane.py`, `test_noagent_generation.py`, `test_noagent_prompt.py`, `test_noagent_pipeline.py` — the acceptance evidence: every matrix row covered; the three recorded reasons distinct; mutation-sensitive pins for the lane, the payload params and the verdict mapping; cancellation tests.
- [x] `components/agent-service/tests/test_equivalence_v02.py` — the data-driven suite: fixtures structure integrity, per-behavior assertions over all 14 blocks + the preparation block (knobs via recorded env into the config loads, expected_output statements via the established seams), the deviation table for the four non-ported behaviors with absence assertions.
- [x] `components/agent-service/Dockerfile` — `COPY noagent/ ./noagent/`.
- [x] `.gitlab-ci.yml` — the `lint:agent-service` ruff paths cover `noagent/`.
- [x] `docs/baselines/v05-client-contract-inventory.md` — the actual surface inventory + regression coverage map + the numbered pre-S3-exit work items.
- [x] `docs/baselines/s3-exit-checklist.md` — the S3 exit checklist referencing this epic's artifacts.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` — the story entry to `review`.

**Acceptance Criteria:**
- Given the V02 fixtures and the implemented port, when the equivalence suite runs, then every catalog behavior is asserted against the recorded expectations — the 14 behavior blocks and the preparation block each have at least one assertion tying the recorded expectation to the implementation, the fixture structure itself is integrity-checked, and the four non-ported behaviors fail loudly if they silently appear or the deviation changes.
- Given the no-agent mode, when a complete request runs, then it is ONE single-pass call through preparation → retrieval → reranking → selection → context/prompt construction → one fixed generation stage → checking/verdict/result assembly, admitted through the shared admission lane; the abstention cases answer with the recorded distinct reasons and the degraded preparation case answers a degradation, never confident data.
- Given the V05 inventory, when the S3 compatibility evidence is assembled, then the actual API/SSE/error contract surface is documented from code with its current regression coverage per surface, and every gap is a numbered pre-S3-exit work item.
- Given this epic's artifacts, when the S3 exit checklist is walked, then every check (contract, authorization, compatibility) names the artifact that evidences it — V02/V03/V04/V05 recorded, the component suites and CI gates green.
- Given the component tree, when `ruff check`, `ruff format --check` and `pytest` run, then all are green, and the story 1.4 OPEA-free gate stays green.

## Implementation Notes

## Spec Change Log

## Review Triage Log

## Design Notes

**Why the pipeline calls the capability, not the executor.** E01 compares config B against config A (the deployed path, which has no executor); the capability's own authorized-set check already refuses an empty set and validates graph names, so the evaluation call stays guarded without the executor's per-request identity machinery, and the executor's result reconstruction would drop the abstention sink. The executor remains the serving path's enforcement point (stories 2.x wire it).

**Why the abstention sink is a kwarg, not a contract field.** The contract is epic-accepted at `1.0` and its compatibility rules make any field addition a major change; the reason is pipeline-orchestration knowledge (the capability owns the rerank stage, exactly as deployed chatqna owns it), so a per-call, default-None kwarg carries it across without touching `capabilities/contract.py`. Concurrent runs are safe: the sink travels with the call, never on shared state.

**Why the degraded preparation case generates instead of failing.** The deployed degraded turn still answers; the contract forbids the mechanism it used (source text in the English space). The honest shape that keeps the turn answering is the abstention instruction set with no documents — the deployed instructions' own semantics ("You may still generate a response, but begin by clearly stating…") — flagged `abstained=true` with the pipeline's own `preparation_degraded` reason and the exact preparation status in the metadata.

**Why noagent reuses preparation's translation patterns instead of its client.** `preparation/translation.py` hardcodes the English target (deployed parity — the embedding space); answer translation targets the caller's language, so it gets its own small client over the same endpoint/prompt/budget patterns, gated off by default.

## Verification

**Commands (executed 2026-11-20, component venv `.venv` from `requirements.txt` + `requirements-test.txt`):**
- `cd components/agent-service && ruff check .` — clean ("All checks passed!", ruff 0.16.3, the CI pin)
- `cd components/agent-service && ruff format --check .` — clean ("56 files already formatted")
- `cd components/agent-service && python -m pytest tests/ -q` — **511 passed** (104 new: 21 config+lane, 16 generation, 11 prompt, 23 pipeline, 29 equivalence, 4 capability-sink pins)
- `cd tests/config-validator && npm test` — **584 passed, 15/15 suites** (the story-1.4 OPEA-free gate stays green; required the per TESTING.md install order: `components/shared/lib`, `tests/config-validator`, `tests/e2e`)
- Prompt byte-identity re-derived from the deployed source after formatting: `DEFAULT_SYSTEM_PROMPT`, `DEFAULT_ABSTENTION_INSTRUCTIONS` and the EN hard-prefix in `noagent/prompt.py` match `genieai_chatqna.py` byte for byte (asserted in-session against the deployed module text; the assembly is pinned by `tests/test_noagent_prompt.py`)
- Diff scope: `git status` — only `components/agent-service/**` (the `noagent/` package, the capability sink kwarg + its tests, the new test suites, Dockerfile COPY), `.gitlab-ci.yml` (the two `lint:agent-service` ruff lines), `docs/baselines/v05-client-contract-inventory.md`, `docs/baselines/s3-exit-checklist.md`, the story file, and the sprint-status entry. No BFF, frontend, overlay or chart change.

**Left for review / known risks:**
- The lane is intra-container (flock), matching AD-6's iteration-1 single-replica deployment contract; multi-replica scaling needs the shared coordination mechanism (deferred per AD-6) — never wired here.
- The history-truncation token counter hits the generation endpoint's `/tokenize` and fails the turn loud on an unusable count (deployed stance); a proxy without `/tokenize` makes config B refuse turns the deployed path answers — deployment must serve it, as chatqna requires today.
- V05 §9 records five pre-S3-exit work items (disconnect unwired, GET-by-id 404 semantics, upstream-error disposition, PATCH overlap, non-stream metadata passthrough) — they are gaps in the EXISTING BFF surface, dispositioned at the S3 exit, not fixed in this story (no-BFF-change constraint).
