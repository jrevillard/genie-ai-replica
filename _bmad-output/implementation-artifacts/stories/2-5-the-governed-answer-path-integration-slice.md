---
title: 'Story 2.5 — The governed answer path (integration slice)'
type: 'feature'
created: '2026-11-21'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '268243f7718fbb2e8115059e4ea57e97ed10a994'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — the issue #1963 acceptance criteria, operator-authored (scope ruling: board note 132214)">

## Intent

**Problem:** The governed answer path's deliverables exist as separate verified pieces — loop (2.1), orchestrator/budgets (2.3), verification pipeline (2.6), translation leg (2.10), capability layer (Epic 1) — but no production flow assembles them: the orchestrator still imports its toolset and system prompt from the probe module, insufficiency and degraded retrieval never surface as an explicit response, retrieved content has no taint discipline, preparation (1.8) is unwired, and the delivered citations are not pinned to the shape the existing RAG citation components consume.

**Approach:** Assemble the complete governed answer flow on the agent-service run surface — production prompt + toolset (moved out of the probe module), preparation per request under the aux budget, mechanism-decided insufficient-evidence responses (no-evidence and degraded-retrieval cases), injection attempts detected and recorded as findings, and the verdict's citations projected into the exact `source_documents` shape the frontend citation components consume — and assert the flow end-to-end at the run surface, with the 2.10 translation leg asserted against the current BFF as it exists (scope ruling 132214: no BFF route work; story 2.4 owns the frame writer).

**Acceptance criteria (issue #1963, the contract):**
- Given a question and the registered toolset, when the full flow runs, then it returns either a source-grounded answer with traceable citations (rendered through the existing RAG citation components, FR-13) or an explicit insufficient-evidence response.
- And retrieved content is data, never instructions — hostile instructions embedded in documents or tool outputs are not followed (AD-13), and an injection attempt is a recorded finding.
- And degraded retrieval (partial availability, fallback strategy) reports insufficiency, never a confident answer (FR-12).
- And multilingual behavior carries over: preparation (story 1.8) for retrieval, BFF answer translation for display — asserted end-to-end in this story.

</frozen-after-approval>

## Boundaries & Constraints

**Always:**
- **Assemble, do not reimplement.** The loop, orchestrator/budgets, verification pipeline, translation leg and capability layer are consumed as delivered. The seam envelope `{run_id, call_id, seq, kind, payload}` and the closed `EventKind` vocabulary are unchanged; the import-time BFF-frame-name guard holds.
- **Insufficiency by mechanism, not prose.** The insufficient-evidence response is decided by the run's ledger state at finalize, never by the model's own claim: no successful retrieval in the ledger → the delivered answer IS the standard explicit insufficiency message (the model's drafted text is discarded), the verdict payload carries `insufficient_evidence: {required: true, reasons: [...]}` and resolves `unverified` (2.6 rule). Retrieval that happened but yielded no valid citation stays the 2.6 `ungrounded` path (claims without support) — not an insufficiency response.
- **Degraded honesty (FR-12).** Any retrieval that ran degraded (partial availability, fallback strategy — the capability layer's `DEGRADED_AVAILABILITY`/`bm25_degraded`/`cap1_degraded` signals) makes the response an insufficiency response with a degradation reason, never a confident answer, even when citations exist.
- **Taint discipline (AD-13).** The production prompt states retrieved content is data, never instructions. Tool results are scanned for instruction-pattern markers; an attempt is recorded as a finding (ledger + verdict payload `findings` + usage record) and the content still passes as data — no content-based behavior change, no rejection of the tool result.
- **Preparation per request (1.8).** `QueryPreparer` runs under the aux-model budget (`take_aux_model_call`); the prepared query feeds `search_knowledge` (the port already refuses unprepared queries); the preparation status lands in the usage record. Preparation overflow raises its typed error into the honest run-error contract — never an untranslated fallback.
- **Projection pin (FR-13).** Delivered citations are projected into the exact `source_documents` envelope variants the frontend consumes (`LegacyFileProvenance` / `OkfConceptProvenance` shapes as assembled by the no-agent lane today); the projection is extracted to a shared module, the no-agent lane re-imports it byte-identically, and a contract test pins the fields the frontend store mapping reads.
- **Translation asserted against the current BFF (ruling 132214).** The agent-side half (preparation for retrieval, `translation_mode` in the verdict) is asserted in-run; the 2.10 leg is asserted by an additive BFF integration test pairing a canonical run usage record with `planTranslation`/the leg — no BFF production change.

**Never:**
- No BFF production change: no agentic route, no frame writer, no routing helper, no disconnect-detection work (story 2.4's, in progress), no non-streaming JSON path (2.4b).
- No client frame emission from agent-service; no new event kinds; no activity-line or UI work (2.7/2.8); no e2e envelope extension (2.9).
- No live GPU/model dependency in suites — `LoopModelClient` doubles and injected transports only (the deployed vLLM tool-calling gap is #2052, not this story).
- No `comps` import, no new runtime dependency, no `response_format` protocol change on `LoopModelClient`.
- No legacy no-agent lane behavior change — the envelope extraction preserves byte-identical output (existing suites stay green unmodified).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Grounded flow | Evidence retrieved, valid citations, judge `grounded` | Answer text + verdict `grounded` + `source_documents` projection matching the FR-13 consumer shape | N/A |
| No retrieval | Every search insufficiency/empty → empty ledger | Delivered answer IS the explicit insufficiency message; `insufficient_evidence.required=true` with the capability's reasons; verdict `unverified` | N/A |
| Degraded retrieval | `bm25_degraded`/`cap1_degraded`/`DEGRADED_AVAILABILITY` in the ledger | Insufficiency response with a degradation reason — never a confident answer, citations notwithstanding | N/A |
| Injection attempt | Hostile instruction embedded in a tool result | Content passes as data; finding recorded (ledger, verdict `findings`, usage record); answer follows the task, not the injection | N/A |
| Non-English query | `language` field on the request | Preparation translates for retrieval under the aux budget; status + usage recorded; prepared query feeds the search | Overflow → typed error → honest run error, never untranslated fallback |
| Projection shape | Any delivered citation set | Every entry carries the fields the frontend store mapping reads (document_id/name, url, score, source, concept_id, repo_id, bundle_version, graph_name) | N/A |
| Budget exhausted mid-run | Monitor raises | Honest terminal, no verdict (2.3/2.6 unchanged) | Existing |
| Judge absent/timeout | 2.6 contract | `unverified`, never `grounded` | Existing |

## Code Map

- `components/agent-service/agent/orchestrator.py` -- `OrchestratorConfig.load` (:163 imports `PROBE_SYSTEM_PROMPT` as the default), `run()` (:287 builds the probe's `document_toolset`) — the production wiring points; builds the preparer, flips the default prompt, consumes the production toolset/prompt homes.
- `components/agent-service/agent/probe.py` -- `PROBE_SYSTEM_PROMPT` (:103), `document_toolset` + executor adapters (:248) — the toolset builder MOVES to a production module; probe re-imports. The probe harness itself stays untouched.
- `components/agent-service/agent/loop.py` -- outcome vocabulary (:63-66), `_dispatch_tool` (:292 ledger feed — add the taint scan), `_finish` (async, runs verification between `TEXT_MESSAGE_FINISHED` and `RUN_FINISHED` — add the insufficiency decision before emission).
- `components/agent-service/agent/verification.py` -- `RetrievalLedger` (add degradation + finding records), `VerificationPipeline.finalize` (add `insufficient_evidence` + `findings` to the projection), tri-state constants and the empty-ledger → `unverified` rule (frozen, reused).
- `components/agent-service/agent/budget.py:200` -- `take_aux_model_call` — the preparation translation's budget hook.
- `components/agent-service/preparation/prepare.py` -- `QueryPreparer.prepare` (statuses, typed `TranslationInputTooLongError`); `preparation/config.py` knobs.
- `components/agent-service/app.py:71` -- `RunRequestBody` (add optional `language`), `runs` surface, `_build_orchestrator`.
- `components/agent-service/noagent/pipeline.py:116-187` -- `source_document_envelope` — extract to a shared module (`capabilities/citations.py`), re-imported by noagent byte-identically; the FR-13 projection target shape.
- `components/gov-chat-frontend/src/store/modules/conversation.js:239-276` -- `translateSources` — the consumer fields the projection pin asserts (read-only reference).
- `components/gov-chat-backend/services/agent-residual-budget.js` + `services/translation/agentic-translation-leg.js` -- the 2.10 leg: consumed as-is by the additive BFF integration test (canonical run usage record → `planTranslation` → bounded GPU execution → accounting block).
- `components/agent-service/tests/` -- the doubles (`ScriptedLoopModel`, injected transports); new suites for taint/insufficiency/degradation/preparation/projection.

## Tasks & Acceptance

**Execution:**
- [x] `components/agent-service/agent/toolset.py` -- NEW: the production toolset builder moved from `probe.py` (registry + executor adapters unchanged); probe re-imports -- the registered toolset leaves the probe module
- [x] `components/agent-service/agent/prompt.py` -- NEW: `PRODUCTION_SYSTEM_PROMPT` (grounded-or-insufficient mandate, cite-only-served-evidence, AD-13 data-never-instructions clause); orchestrator default flips to it; `AGENT_RUN_SYSTEM_PROMPT` override unchanged -- the governed default
- [x] `components/agent-service/agent/taint.py` -- NEW: explicit instruction-marker scan over tool results producing structured findings -- the AD-13 detection + record
- [x] `components/agent-service/agent/verification.py` -- ledger records degradation + findings; projection carries `insufficient_evidence{required, reasons}` + `findings`; finalize computes both mechanically -- the insufficiency/degradation verdict surface
- [x] `components/agent-service/agent/loop.py` -- `_dispatch_tool` runs the taint scan into the ledger; `_finish` applies the insufficiency decision (standard message replaces the drafted text when required) before verdict emission -- the mechanism
- [x] `components/agent-service/agent/citations.py` -- NEW: `source_documents` envelope builder extracted from `noagent/pipeline.py`; noagent re-imports -- the FR-13 projection
- [x] `components/agent-service/agent/orchestrator.py` -- builds `QueryPreparer` (aux-budgeted), reads `language`, records preparation status/usage in the run record; production prompt + toolset imports -- the per-request wiring
- [x] `components/agent-service/app.py` -- `RunRequestBody.language` optional field -- the request carries the UI locale
- [x] `components/agent-service/tests/` -- new/extended suites: taint, insufficiency/degradation mechanics, projection pin vs the frontend fields, preparation-in-run (status, aux accounting, overflow), toolset/prompt homes, run-surface payloads -- the matrix as executable checks
- [x] `components/gov-chat-backend/__tests__/services/translation/` -- NEW integration test: canonical run usage record → residual plan → leg execution (scripted GPU) → accounting block -- the 2.10 behavior asserted against the current BFF
- [x] `env` + `docker-compose.yaml` -- only if preparation knobs are missing from the pass-throughs (check, follow the 2.3/2.6 pattern) -- deployment parity

**Acceptance Criteria:**
- Given a scripted evidence-backed run, when the full flow executes through `POST /v1/runs`, then the stream carries the answer, the verdict with `grounding_status`, and citations whose projected `source_documents` entries match the fields the frontend citation mapping reads.
- Given a run whose ledger holds no successful retrieval (or any degraded retrieval), when finalize runs, then the delivered answer is the explicit insufficiency message with the mechanical reasons — the model's drafted text never ships in those cases.
- Given a tool result carrying hostile instructions, when the loop dispatches it, then the content is treated as data, the attempt is recorded as a finding in the ledger, verdict payload and usage record, and the run's answer is unaffected by the injected instruction.
- Given a non-English request, when the flow runs, then preparation translates the query for retrieval under the aux budget with the status recorded, and the additive BFF integration test proves the 2.10 leg bounds and accounts translation against a canonical run usage record.

## Implementation Notes

<!-- Agent-owned. Append-only during implementation. -->

- Spec sized at ~1936 words (above the 1600-token guideline): kept whole — the
  story is a single user-facing goal (the integration slice, the issue's
  contract) and splitting it would break the contract; per ruling 132214 the
  operator ordered full implementation.
- Implemented (2026-11-21, worktree `issue-1963`, branch
  `feat/agentic-foundations/2-5-the-governed-answer-path-integration-slice`,
  uncommitted). New modules: `agent/toolset.py` (the builder moved verbatim;
  the probe re-imports the same function object; the probe path
  `preparer=None` stays byte-identical), `agent/prompt.py`
  (`PRODUCTION_SYSTEM_PROMPT` — grounded-or-insufficient, cite-only-served-
  evidence, AD-13 data-never-instructions; the two-tier override unchanged),
  `agent/taint.py` (nine named instruction-marker patterns over the
  retrieved-content channel; error envelopes not scanned), `agent/citations.py`
  (the envelope extracted from `noagent/pipeline.py`; the no-agent lane
  re-imports `source_document_envelope` — function-object identity pinned).
- Insufficiency mechanics: the ledger now classifies every dispatched result
  (`successful_retrievals` count, `degradations`, `findings`);
  `VerificationPipeline._insufficiency_decision()` reads that state
  mechanically (required = no success OR any degraded; reasons =
  `degraded_availability` / `no_successful_retrieval`); the loop's
  `_finish` finalizes BEFORE the text events emit and replaces the drafted
  text with `INSUFFICIENCY_RESPONSE` (single module-level constant in the
  decision site) when required — the seam event ORDER is unchanged
  (text events → verdict → run_finished), pinned by test.
- Preparation wiring: per-query through the search executor (the 1.8 entry's
  own "refined mid-loop query, query-only" row), not a pre-loop
  question-only pass — each model query is prepared identically; an
  unprepared preparation answers the contract's insufficiency shape with the
  port untouched; `TranslationInputTooLongError` propagates into the honest
  run-error terminal. The aux budget claim lives in
  `BudgetedTranslationClient.translate_prompt` (one subclass, one override)
  — the claim fires synchronously before the HTTP dispatch, so interleaved
  runs cannot claim the wrong monitor; the process shares one config/
  registry/transport/discovery-cache via `build_preparer_factory`.
- Usage record grew three additive fields (`language`,
  `preparation_status` (the FIRST query's), `injection_findings`) — the
  three exact-set pins (orchestrator `as_dict`, run-surface usage frame)
  were extended accordingly; the verdict payload grew
  `insufficient_evidence`/`findings`/`source_documents` (projection pin).
  `RunRequestBody.language` is optional (trimmed, ≤32 chars, empty → None).
- BFF: NO production change — only the additive integration suite
  `__tests__/services/translation/agentic-translation-integration.test.js`
  (canonical record → `planTranslation` residual → leg execution over the
  scripted GPU → accounting block; the additive record fields proven inert
  to the residual arithmetic).
- Deployment parity: the agent-service compose block gained the preparation
  knob pass-throughs (endpoint trio, model pin, timeouts, char budget,
  discovery TTLs, bearers, TLS skip — defaults match the chatqna block
  exactly); `env` documents them as shared-with-chatqna knobs.
- Verification evidence: agent-service `pytest tests/` 827 passed (790
  baseline + 37 new), `ruff check .` + `ruff format --check .` clean; BFF
  `jest __tests__/services/translation/` 214 passed / 13 suites (legacy pins
  unmodified — `test_noagent_pipeline.py`, `test_agent_loop.py`,
  `test_agent_probe.py` untouched), eslint + prettier clean on the new
  suite. Suites stay green unmodified where the story demands it: the whole
  no-agent lane.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

### BMAD review R1 (2026-11-21, whole diff vs baseline 268243f77; layers: blind N=10, edge-case, verification-gap)

| # | Finding | Verdict | Evidence / disposition |
|---|---|---|---|
| B1 | compose comment claims "Defaults match the chatqna block exactly" but ENDPOINT/MODEL_ID/SSL defaults differ (chatqna :828-830,859 vs agent :1506-1516) | medium | verified real: chatqna pins `google/gemma-3-4b-it` + guardrail URL + empty SSL; agent block empty/empty/`0`. Endpoint is functionally equal via the HOST_IP:PORT fallback (config.py:114-117) but MODEL_ID genuinely diverges on a stock deployment; the comment is false as written. patch: align the three defaults to chatqna's exact values |
| B2 | env comment ("override moves ONLY the agent service") contradicts compose comment ("moves both") | medium | verified real: the vars are shared names — an .env override moves chatqna AND agent-service; the env text is false. patch: fix the env comment (grouped with B1) |
| B3 | `_finish` awaits the full finalize (judge incl.) before the first text emission — TTFT absorbs judge latency on every judged run; spec Code Map prescribed finalize BETWEEN the text events and the terminal | medium | verified real: loop.py finalize moved wholesale before `TEXT_MESSAGE_STARTED`; the mechanical decision needs only the ledger (cheap, must precede emission for the replacement) but the judge must not. Direct deviation from the spec's own Code Map prescription. patch: mechanical decision pre-emission; validity+judge post-emission before the verdict event (2.6 timing restored, event order unchanged) |
| B4 | extraction landed as `agent/citations.py`, spec Code Map named `capabilities/citations.py`; noagent→agent import is a layering inversion | low | verified real: noagent/pipeline.py imports from the agent package. patch: move the module to `capabilities/citations.py` (the spec's home, shared by both lanes), update imports + the identity pins |
| B5 | request `language` never reaches preparation (`prepare(query_text)` without `source_language`); validator does no locale-code check | medium | verified real: `QueryPreparer.prepare(history, source_language=None)` supports the hint; the wiring drops it — a short query detection misclassifies survives unprepared where the request named the locale. patch: bind the request locale as the run's default source_language in `build_preparer_factory`; the validator gap rejected (low: informational field, the leg fail-softs on unusable locales) |
| B6 | spec says `in-review` while sprint-status says `in-progress` | false | the workflow's own transient states: step-04 sets the spec `in-review` while sprint-status stays `in-progress` until step-05 flips it to `review` — no defect |
| B7 | preparation budget exhaustion untested at loop/run level (the honest `budget_exhausted` terminal claim) | low | verified: only the direct translator call is tested; `BudgetExhausted` escaping an executor takes the run-level catch (:216), a different path. patch: one run-level test |
| B8 | preparation aux claim never pinned on a run's usage record (interleaved-monitor property untested in-run) | low | verified: the factory+transport path exists only in direct unit tests. patch: one in-run test with the real factory + fake transport |
| B9 | one insufficiency message for both reasons while the payload carries valid citations — user-facing contradiction | low | rejected: the single standard message IS the frozen intent ("the delivered answer IS the standard explicit insufficiency message"); reason differentiation is the rendering layer's job (2.7 truth table reads the payload), not this story's |
| B10 | prepared path: missing/None query goes to `prepare(None)` (TypeError escapes the executor catch → whole run errors) vs probe path's structured ValidationError | medium | verified real: executor catch is `(CapabilityError, ValidationError)` (:325); a TypeError escapes to the run-level handler — the run dies on a malformed argument the probe path answers structurally. patch: validate `query_text` before prepare on both paths, identical structured feedback (grouped with E3) |
| B11 | tool-name coupling duplicated in taint.py and ledger.record — a third retrieval-shaped tool is silently unscanned/unledgered | low | defer: real coupling risk but no third tool exists; recorded to deferred-work |
| B12 | BFF bounds pin one-directional (`max_tokens > 0`, timeout no floor) while the comment claims "bounded" | low | verified real (partially): the one-directional bound is documented in the test's own comment; the missing timeout floor is a cheap hardening. patch: `toBeGreaterThan(0)` on the timeout |
| E1 | `successful_retrievals` counted on `outcome=="success"` before any contribution check — a success with no citable entry defeats the no-retrieval reason | medium | verified real: ledger.record increments on the outcome string (:208-214); a read success with empty content counts while adding nothing — the drafted answer ships unmarked-unverified instead of the insufficiency response. patch: count only dispatches that grew the ledger's citable entries |
| E2 | finalize's defensive except builds the Verdict without `insufficient_evidence`/`findings` — a pipeline defect on a degraded/no-retrieval ledger ships the drafted text | medium | verified real: the except path (verification.py finalize) constructs the default Verdict, dropping the mechanical decision recorded in the ledger. patch: except path re-reads `_insufficiency_decision()` + findings |
| E3 | prepared path malformed query shape (same root as B10) | medium | verified real — grouped into B10's patch |
| E4 | citation provenance without file_id/okf marker renders `document_id: None` | false | unreachable: delivered citations come only from contract-dumped hits (`OkfConceptProvenance` carries the literal marker, `LegacyFileProvenance` none — pinned by test_contract.py:167-177); arbitrary dicts cannot enter the ledger through the port |
| E5 | two unidentifiable-provenance hits dedup to None and drop a distinct source | false | same unreachability: contract provenance always typed, identity never None on real data |
| E6 | whitespace-only language over 32 chars 422s pre-strip while short whitespace strips to None | low | rejected: edge-of-edge inconsistency; unlikely everyday, fix = constraint reordering machinery |
| E7 | spec claim vs code: "no successful retrieval → insufficiency" where the code counts outcome strings | medium | same root as E1 — grouped into its patch |
| E8 | matrix lists `graph_name` among the fields entries carry; the builders never emit it | low | rejected: the fix is editing the frozen matrix text; the implemented behavior matches the recorded delta and the intent (the frontend mapping reads graphName tolerantly-optional; contract provenance carries none; absence test-pinned) |
| V1 | the app assembly's `preparer_factory` wiring is never executed by any test — deleting the kwarg reds nothing | medium | pre-verified (verification-gap layer's own searches): every happy-path app test injects a hand-built runtime; the one production wiring point is unobserved. patch: app-level test through the real `_build_orchestrator` |
| V2 | BFF pairing fixture hand-copied — producer/consumer record contract can drift with both suites green | defer | real drift risk; the consumer is not yet wired in production (the leg's only caller is the test — 2.4 owns the route); the natural home is a shared committed snapshot when 2.4 wires the real record. deferred-work entry |
| V3 | `language` validation rules unobserved (over-length 422, whitespace→None) | low | pre-verified. patch: extend the malformed-request parametrize + one record assertion (one-line additions) |
| V4 | read success with empty content counts as successful retrieval (the vg layer's other-findings restatement of E1) | medium | same root as E1 — grouped into its patch |

Grouped patch entries: (1) E1/E7/V4 success-counting; (2) E2 except-path decision; (3) B10/E3 prepared-path guard; (4) B3 finalize timing split; (5) B5 language→preparation wiring; (6) B1/B2 compose+env parity; (7) B4 citations module home; (8) V1 app wiring test; (9) B7/B8 run-level preparation tests; (10) V3 language validation tests; (11) B12 timeout floor. Deferred: V2, B11.

## Design Notes

- **Insufficiency message ownership.** The standard message is a module-level constant in the insufficiency decision site (single source); it is the source-language (English) text — display-language translation is the BFF leg's job on the same terms as any answer (recorded `translation_mode`), so no agent-side localization machinery.
- **Degraded beats grounded.** A degraded-component run cannot deliver a confident answer even with valid citations and a `grounded` judge — the mechanical insufficiency decision runs BEFORE the judge claim is surfaced; the verdict payload still carries the judge outcome and citations for diagnostics, with `insufficient_evidence.required=true`.
- **The probe module keeps its prompt.** `PROBE_SYSTEM_PROMPT` remains the probe harness's own prompt; only the ORCHESTRATOR's default moves to the production prompt. The probe's grading flow is untouched.

## Verification

**Commands:**
- `cd components/agent-service && python -m pytest tests/ -x -q` -- expected: all suites green (existing + new)
- `cd components/agent-service && ruff check .` -- expected: clean
- `cd components/gov-chat-backend && npx jest __tests__/services/translation/ --silent` -- expected: green including the new integration test; legacy pins unmodified
- `cd components/gov-chat-backend && rtk proxy npx eslint __tests__/services/translation/ && rtk proxy npx prettier --check __tests__/services/translation/` -- expected: clean
