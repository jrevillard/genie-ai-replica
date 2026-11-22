---
title: 'Story 2.4b — Non-streaming integration (JSON path)'
type: 'feature'
created: '2026-11-22'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '46763133ee55e94d02b4401bc654f3eea96b4ea4'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/docs/baselines/v05-client-contract-inventory.md'
  - '{project-root}/docs/agent-budget-deadline-pairs.md'
---

<frozen-after-approval reason="human-owned intent — the issue #1962 acceptance criteria, operator-authored">

## Intent

**Problem:** The agentic branch exists only on `POST /api/queries/stream`; a non-streaming `POST /api/queries` request routed to the agent still has no wiring — the helper is built for both entries (story 2.4) but only one is wired.

**Approach:** The BFF consumes the agent-service seam stream on the non-streaming entry, aggregates the answer, and returns the versioned-compatible JSON result; the guarded routing helper becomes the only way BOTH agentic entries are exposed.

**Acceptance criteria (issue #1962, the contract):**
- Given an agentic-routed non-streaming request, when the BFF consumes the agent's result, then the JSON response carries the existing field shapes: response text, metadata (`source_documents` incl. the `okf-concept` variant, `grounding_status` + legacy `is_grounded`), queryId — with citations, translation (per mode) and persistence behaving as the streaming path.
- And insufficient-evidence cases return the **success contract with an insufficiency outcome** (never an HTTP error — insufficiency is a successful answer type; V05-derived shape), while genuine failures (upstream errors, authorization failures, timeouts) return the existing JSON error contract — the two are separate acceptance cases, never merged.
- And end-to-end tests cover success, insufficiency and error cases through the real endpoint.

</frozen-after-approval>

## Boundaries & Constraints

**Always:**
- The response keeps the legacy JSON top-level shape `{queryId, response, metadata, responseTime}` (201); additive fields only (`translationFailed: true` rides additively when whole-answer translation failed, absent otherwise — the JSON sibling of the `done.translationFailed` flag).
- The upstream contract is the streaming one in JSON dialect: posture 401 → 401 `{error:'UNAUTHENTICATED'}`; upstream 429/503/422 passthrough before anything else; connect/timeout/wall-clock abort → 504 `{error:'AGENT_SERVICE_UNAVAILABLE'}`; other upstream errors → 502 same code; mid-run `run_error` → 502 `{error:'AGENT_RUN_ERROR', message}` — and a failed run never finalizes the doc (mirrors the streaming error contract: no metadata, no done).
- Insufficiency is the V05 metadata vocabulary: HTTP 201, the INSUFFICIENCY text as `response`, and `abstained: true` + `abstention_reason` (the mechanical `insufficient_evidence.reasons`) derived from the verdict; a verdict-bearing answered run sets `abstained` from `insufficient_evidence.required` (false = answered, chose not to abstain — V05 §3 semantics); no verdict → `abstained` stays `null` ("decision never reported").
- Persistence = the streaming behavior: doc minted at start (same legacy shape + queryId), completed with the assembled metadata (`agent_run` block rides into the doc), analytics recorded; the legacy persist/analytics tail of `createQuery` is the one tail for both branches.
- Translation (per mode): whole-answer, post-run, request-resolved translator — the `handleStreamDone` non-relay branch's semantics; the agent always answers English (the run body carries no language, as on the streaming path).

**Never:**
- No wiring of the story 2.10 translation leg (still unwired on streaming; both modes move together later).
- No disconnect detection on the JSON path (legacy JSON has none; the upstream timeout bounds the leg; streaming's `res.on('close')` stays streaming-only).
- No run-start version-record persistence (story 2.11), no agent-service changes, no legacy JSON/chatqna behavior change when AGENT_ENABLED is off.
- No new env knobs, no compose/env changes (AGENT_ENABLED / AGENT_SERVICE_URL / AGENT_UPSTREAM_TIMEOUT_MS already exist).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Agentic success | flag on, run answered, verdict grounded | 201 `{queryId, response, metadata(source_documents+okf rows, grounding_status, is_grounded, agent_run), responseTime}`; doc completed; analytics | N/A |
| Insufficient evidence | verdict `insufficient_evidence.required=true` | 201 success contract, response = INSUFFICIENCY text, `abstained: true` + `abstention_reason`, grounding `unverified`/false | never an HTTP error |
| Run fails mid-run | `run_error` seam event | 502 `{error:'AGENT_RUN_ERROR', message}`; doc stays unanswered; usage record ignored | honest terminal |
| Lane saturated | upstream 429 | 429 passthrough + `Retry-After`; doc unanswered | before any work |
| Unconfigured surface | upstream 503 | 503 passthrough (`budget_configuration_missing`/`run_surface_unconfigured`) | before any work |
| Malformed run request | upstream 422 | 422 passthrough | before any work |
| Connect failure / timeout | ECONNABORTED, ERR_CANCELED, wall-clock abort | 504 `{error:'AGENT_SERVICE_UNAVAILABLE'}` | doc unanswered |
| Authorization failure | posture resolver 401 | 401 `{error:'UNAUTHENTICATED'}` propagates | non-401 resolver failure → fail-closed empty authorization, run still serves |
| Whole-answer translation fails | translator error post-run | English `response` stands + additive `translationFailed: true` | fail-soft, never drops the answer |
| Flag off | AGENT_ENABLED≠1 | legacy chatqna path byte-identically (test-mode branch included) | N/A |

## Code Map

- `components/gov-chat-backend/routes/query-routes.js:802-832` -- POST `/` handler: 401 guard, language refusal, `createQuery`, 201/401/500 mapping. The wiring site: agentic branch resolves the translator (`resolveRequestLanguage`, :60-90) instead of `refuseUnsupportedLanguage` (:118-131), passes `{targetLanguage, translator}` into `createQuery`.
- `components/gov-chat-backend/services/query-service.js:1075-1292` -- `createQuery`: validation → mint (:1146-1163) → [NEW agentic branch here] → legacy tail (:1253-1282: update + `_persistRoutedGraphs` + analytics + return). The fan-out carrier (:1232) sits inside the legacy OPEA branch — the agentic branch skips it naturally, and the agent leg resolves the posture once.
- `components/gov-chat-backend/services/agent-frame-writer.js` -- the reuse surface: deadline pair (:42-81), `citationToSourceDocument` (:106-134), `assembleAgentMetadata` (:154-176), `readUpstreamBody`/`passthroughBody` (:185-231), upstream call + status mapping idiom (:386-446), seam consumption idiom (:604-651), posture resolution + CallerContext (:360-377).
- `components/gov-chat-backend/services/agent-routing.js` -- `isAgentPathEnabled()`/`agentServiceUrl()`; header comment already names this story as the second entry.
- `components/gov-chat-backend/services/agent-seam-parser.js` -- `parseAgentSeamLine` (one seam data line → event/usage_record/error).
- `components/agent-service/app.py:247-305` -- POST `/v1/runs`: always SSE; body `{question, deadline_ms, context, bearer}`; 429/503/422 JSON errors; terminal usage record.
- `components/agent-service/agent/verification.py:120,430-461,526-545` -- `INSUFFICIENCY_RESPONSE` text; `insufficient_evidence {required, reasons}`; the mechanical reasons vocabulary (`degraded_retrieval`, `no_successful_retrieval`).
- `docs/baselines/v05-client-contract-inventory.md:55-69` -- the V05 metadata vocabulary this story derives the insufficiency shape from (`abstained` true/false/null semantics, `abstention_reason`).
- `components/gov-chat-backend/__tests__/routes/agent-frame-writer.test.js` -- the test pattern to mirror: real `createApp`, `AGENT_ENABLED=1` before load, mocked query-service module, scripted axios seam streams.
- `components/gov-chat-backend/__tests__/routes/query-routes.test.js:1241-1276` -- the legacy JSON pins that must stay green unchanged.

## Tasks & Acceptance

**Execution:**
- [x] `components/gov-chat-backend/services/agent-run-contract.js` -- NEW: the shared agent-run vocabulary moved from the frame writer (deadline constants + `resolveUpstreamTimeoutMs`/`deriveDeadlineMs`, `citationToSourceDocument`, `assembleAgentMetadata`, `readUpstreamBody`, `passthroughBody`) -- one home each; the frame writer imports from it and keeps its `_internals` re-export surface (test pins stay green).
- [x] `components/gov-chat-backend/services/agent-frame-writer.js` -- import the moved helpers; no behavior change -- the streaming consumer of the shared contract.
- [x] `components/gov-chat-backend/services/agent-json-result.js` -- NEW: `runAgentJsonTurn({queryService, queryData, queryId, headers, targetLanguage, translator, startTime})` → `{response, metadata, responseTime, translationFailed?}`: posture resolution (401 propagates, non-401 fail-closed) → CallerContext → POST `/v1/runs` (axios stream, `AbortController`, effective timeout + wall-clock bound) → seam aggregation (text/verdict/usage_record; `run_error` throws the typed 502) → whole-answer translation (fail-soft latch) → `assembleAgentMetadata` + the `abstained`/`abstention_reason` verdict overlay -- the JSON consumer of the seam.
- [x] `components/gov-chat-backend/services/query-service.js` -- `createQuery` gains the options param (`targetLanguage`, `translator`) and the agentic branch after the doc mint: `runAgentJsonTurn` result flows into the shared persist/analytics/return tail -- queryId continuity, one tail.
- [x] `components/gov-chat-backend/routes/query-routes.js` -- POST `/`: `isAgentPathEnabled()` decides the language resolution (`resolveRequestLanguage` with refusal check when agentic; `refuseUnsupportedLanguage` otherwise, unchanged), passes the options into `createQuery` -- the helper is the only way the second entry is exposed.
- [x] `components/gov-chat-backend/services/agent-routing.js` -- header comment: both entries now wired -- the AD-9 note stays true.
- [x] `docs/agent-budget-deadline-pairs.md` -- one line: the JSON path consumes the same derivation -- the pair doc stays true.
- [x] `components/gov-chat-backend/__tests__/routes/agent-json-result.test.js` -- NEW: the I/O matrix through the real app (success shapes + persistence calls, insufficiency 201 + abstained mapping, run_error 502 + unanswered doc, 429/503/422/502/504 mapping, posture 401 + fail-closed, translation fail-soft latch, flag-off parity) -- the three acceptance cases are separate executable checks.
- [x] `components/gov-chat-backend/__tests__/routes/query-routes.test.js` -- wiring assertions: flag on → agent leg serves POST `/`; flag off → legacy byte-parity pins unchanged -- the branch is the only diff.

**Acceptance Criteria:**
- Given AGENT_ENABLED=1 and a non-streaming request, when the run answers, then the 201 JSON carries the streaming path's field shapes (response text, metadata with source_documents incl. okf-concept rows, grounding_status, is_grounded, agent_run) and the same queryId completes the doc.
- Given an insufficient-evidence run, when the BFF consumes the result, then the answer is 201 with the insufficiency outcome (V05 vocabulary) — status, body and doc state never resemble an error.
- Given a genuine failure (upstream error, authorization failure, timeout), when it surfaces, then the existing JSON error contract answers and the doc stays unanswered — never merged with the insufficiency outcome.
- Given AGENT_ENABLED off, when POST `/` is hit, then the legacy path serves byte-identically.

## Implementation Notes

<!-- Agent-owned. Append-only during implementation: decisions made, files touched, surprises
     encountered. Leave empty at planning time; never delete this section. -->

- **`emptyStreamMetadata` moved into the contract module** (decision). `assembleAgentMetadata`
  takes the factory as a parameter and the pinned `runAgentJsonTurn` signature carries no
  factory argument, so the JSON consumer needed the base shape from somewhere that is not the
  route file. The route's own factory comment warns a second copy would drift; the one home is
  now `services/agent-run-contract.js` (comments moved verbatim) and `routes/query-routes.js`
  imports it. `proxyAgentRun`'s signature is unchanged — the route still passes the factory in.
- **Two pinned log-event names keep the `AgentFrameWriter` prefix** in the contract module
  (`upstream_timeout_below_reserves`, `upstream_body_truncated`): the frame-writer suite pins
  them and the spec says those pins stay green unchanged. The move did not rename the events.
- **The `translationFailed` latch rides ONLY the 201 body** (additive), never the doc: the
  one persist/analytics tail persists `{response, responseTime, isAnswered, metadata,
  okfRoutedGraphs}` — the same field set every branch persisted before this story.
- **`response` is the DELIVERED text, and the doc stores it.** The pinned
  `runAgentJsonTurn` return carries one `response` value, and the one-tail constraint means
  the tail persists what it returns — so the delivered (translated) answer is the stored
  answer, which is also what the legacy JSON path already does (chatqna returns its
  translated answer and that is what persists). The streaming path's EN-source persistence is
  a different delivery mode (the translation rides as a separate frame there).
- **`createQuery` refactor for the one tail**: the persist (`_persistRoutedGraphs` + update)
  moved OUT of the test-mode and OPEA branches into the shared tail — behavior identical
  (same objects, same order), pinned by the unchanged legacy suites.
- **Agentic branch ordering**: `isAgentPathEnabled()` is checked FIRST, before the
  test-mode branch — the routing helper is the exposure mechanism (AD-9); a test-mode
  deployment with the flag on gets the agent.
- **Route catch gained one additive branch**: typed errors with `statusCode` + `body`
  (+ optional `headers`, for the 429 `Retry-After`) are answered verbatim. Legacy errors
  carry no `body`, so the flag-off 500 contract is untouched (the fan-out 401 branch
  predates this story and stays first).
- **Stream settle discipline in the JSON consumer**: nothing throws INSIDE a stream handler —
  a handler throw is an uncaught exception, not a rejection. A single `failure` slot collects
  the typed terminal (`run_error` → 502, stream error → 504) and the await settles on
  `end`/`error`/`close`, then throws once. A failed run ignores the trailing usage record
  (the `failure` guard short-circuits the data handler).
- **Surprise**: the first success-shape assertion expected `abstained: null` on a grounded
  run — wrong per spec: the real `Verdict.payload()` ALWAYS carries `insufficient_evidence`,
  so a verdict-bearing answered run maps to `abstained: false`; `null` is exclusively the
  no-verdict meaning. Fixed in the fixture (the fixture now carries the real payload's
  `insufficient_evidence: {required: false, reasons: []}`), not in the implementation.
- **Test-infrastructure notes**: `agent-json-result.test.js` runs the REAL query-service
  singleton through the REAL endpoint — only the DB collections/analytics are injected mocks
  and `resolveFanoutPosture` is spied; `buildAgentCallerContext` stays real so the
  CallerContext assertion exercises the production code. The flag-on wiring test in
  `query-routes.test.js` uses `jest.isolateModules` (the routing helper reads the flag once
  at module load; the file's own app must stay flag-off for its legacy pins). One shared
  `beforeEach` gotcha: `jest.clearAllMocks` keeps implementations, so the flag-off test
  re-arms `translationService.init` after an earlier suite leaves it rejecting.

- **Review round (coordinator, 2026-11-22) — fixes applied**: the remainder
  flush strips the `data: ` prefix before the parser (the frame writer's own
  flush passed the raw buffer — same latent bug there, fixed too, with a new
  pin in its suite; this is the only streaming behavior change the story
  makes); a close-only termination after a wall-clock abort throws the typed
  504 (never a truncated 201); a verdict whose `insufficient_evidence` is
  missing or not an object maps to NO decision (the base nulls stay), not
  `abstained: false`; `assembleAgentMetadata` defaults the base factory to
  the module's own (callers cannot inject a divergent shape); the upstream
  body reader settles on 'close' too (a destroyed body reporting 'close'
  alone no longer hangs the read). New tests: remainder flush (JSON +
  streaming), close-only abort 504, absent-field overlay, unsupported-
  language refusal on the agentic entry, 429/503/422 unparsable-body
  fallbacks, zero-text answered run, test-mode + fanout persist-tail
  assertions.

- **Review round 2 (coordinator, 2026-11-22) — fixes applied**: both runBody
  objects now carry `language` (`wantsTranslation(targetLanguage) ? targetLanguage
  : null`) — the preparation module's named-locale hint that beats detection;
  without it a detection failure with NO locale would refuse the query as
  insufficiency (pinned in both suites). Sticky-reset root cause: the agent
  citation envelope is deliberately MINUS `graph_name` — a recorded contract
  delta in agent-service capabilities/citations.py — so `_deriveRoutedGraphs`
  on an agentic answer always returns [] and every agentic finalize would
  have falsely RESET the session's sticky set (story 1.3's empty-set
  semantics) on BOTH entries. The consumer-side skip in `_persistRoutedGraphs`
  (`metadata?.agent_run` present → leave `okfRoutedGraphs` unset) is the
  honest fix: an answer that cannot name routed graphs must not touch the
  stickiness; carrying `graph_name` through the envelope is an iteration-2
  decision owned agent-side. Also: the agentic branch now yields to test-mode
  (`backendMode !== 'test-mode'` gate) so a test-mode deployment stays
  deterministic whatever the flag says — pinned by a flag-on + test-mode
  test. Note: the streaming-agent sticky pin lives in query-service.test.js,
  not the frame-writer suite — the frame-writer suite mocks the whole
  query-service module, so the real `_persistRoutedGraphs` behavior is only
  observable through the real service.

- **Quality round (/simplify, coordinator 2026-11-22) — applied**: one
  createQuery call with an options ternary (flag-off pin green unchanged);
  settle promise registers resolve directly; bare idempotent `abort()` calls;
  the 429/503/422 branches collapsed onto a status→{fallback, log-event} map
  (Retry-After lines kept); `emptyStreamMetadata` no longer threaded through
  `proxyAgentRun`/`runAgentJsonTurn` (the contract module's default IS that
  function — the route keeps its import for the legacy error paths); the
  upstream-body reader parses once (settled flag — resolve is idempotent, the
  concat+parse before it was not); the two wall-clock tests share one driver
  helper; the whole-answer translate→empty→catch core extracted ONCE into
  `services/translation/whole-answer.js`, consumed by `handleStreamDone`'s
  non-relay branch AND the JSON consumer (frame writes, latching and logging
  stay at the call sites — the shared core was identical, the delivery
  handling was not). Fixtures: the identical seam primitives (USAGE_RECORD,
  envelope, seamStream, dataStream, legacyPosture, INSUFFICIENCY_VERDICT/
  RESPONSE) moved to `__tests__/fixtures/agent-seam.js`; GROUNDED_VERDICT
  unified on the faithful payload() shape (with `insufficient_evidence`);
  `answeredRunStream` NOT unified — the two run scripts differ materially
  (tool-call interleaving vs plain aggregation), each suite keeps its own.
  No translation-output logic change → no TRANSLATION_LOGIC_VERSION bump.

- **Global review 2 (coordinator, 2026-11-22) — fixes applied**: ONE shared
  keepAlive agent pair in the contract module (`agentHttpAgent`/
  `agentHttpsAgent`), used by both run-body call sites — per-request
  `new Agent({keepAlive:true})` leaked sockets into dead agents' pools
  (identity-pinned across two calls in the JSON suite); the wall-clock
  deadline now arms BEFORE the status ladder in BOTH consumers and clears
  after each refusal body read (a trickling non-2xx body was unbounded —
  pinned: 429 never-ending body, deadline fire, 'close' → 429 fallback);
  `applyAbstentionOverlay` gates on `typeof required === 'boolean'` (`{}`
  maps to no-decision, not abstained:false — table extended); the contract
  module's warning events renamed to the `AgentRunContract.` prefix (the
  frame-writer suite's two pins followed); the route's verbatim-error branch
  keys on `error instanceof AgentJsonTurnError` (a future legacy
  statusCode+body error cannot be answered verbatim by accident); the JSON
  turn's responseTime anchors at `opeaStartTime` (post-mint — same meaning
  as the legacy worker-leg time, param renamed `turnStartTime`); the
  remainder flush applies the chunk handler's guard in BOTH consumers (only
  a `data: ` line reaches the parser — a trailing SSE comment is dropped;
  pinned with the bare-comment-line test).

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. Do not modify or delete existing entries. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass: one row per reviewer finding —
     verdict (high/medium/low/false/maybe-false) with its evidence. Empty until the first review pass. -->

| Round | Finding | Verdict | Evidence / disposition |
|---|---|---|---|
| G1 | JSON consumer never flushes the trailing unterminated seam line (the frame writer flushes at `end`; the JSON settle does not) — a terminal verdict/usage_record delivered without the final newline is silently lost (BH+EC, same root) | medium | verified real: `runAgentJsonTurn`'s settle promise has no remainder flush; the sibling consumer's contract (frame writer `:642-649`) treats the remainder as a frame. Producer always writes `\n\n` today, but the silent drop diverges from the shared parser discipline. patch: flush the remainder at settle |
| G1 | Wall-clock abort can answer 201 with truncated text when the aborted stream terminates via `close` only (no `error`): `failure` stays null and the partial text returns as a complete answer (BH+EC, same root) | high | verified real: the settle covers `end`/`error`/`close` but nothing checks `controller.signal.aborted` after settle — the bound's whole purpose (abort → typed 504) is defeated in that termination shape, and an honest bounded run would surface as a fabricated-complete answer. patch: post-settle guard throwing the typed 504 + a close-only-termination test |
| G1 | `applyAbstentionOverlay` maps a verdict payload lacking `insufficient_evidence` to `abstained: false` ("answered, chose not to abstain") although no decision was ever reported (VG+BH+EC, same root) | medium | verified real direction: the real `Verdict.payload()` always carries the field (verification.py:457), but the overlay's own V05 convention says null = never reported; absent/non-object must keep null. patch: treat a missing/non-object field as no-decision |
| G1 | `assembleAgentMetadata` still takes the `emptyStreamMetadata` factory as a parameter although the contract module owns it — the drift door the move closed is reopenable | low | verified real: parameter survives the move; every current caller passes the same module factory. Harm: a caller could inject a divergent base shape. patch: default the parameter to the module's own factory |
| G1 | Unsupported-language refusal unobserved on the agentic JSON entry (no flag-on test drives POST `/` into the 400; the I/O matrix has no row) (VG pre-verified + BH) | medium | pre-verified by the verification-gap layer's repo-wide symbol search: every `UNSUPPORTED_LANGUAGE` pin runs flag-off or streaming; the second entry's refusal boundary is unpinned. patch: one flag-on test (400 + `axios.post` never called) |
| G1 | The hoisted ONE persist/analytics tail is unobserved on the legacy branches — no legacy `createQuery` test asserts `queries.update`/analytics; the refactor invites a silent unanswered-doc regression (VG pre-verified) | medium | pre-verified by the verification-gap layer: every `update` assertion in the legacy suites belongs to `finalizeStreamQuery`/`markQueryAsAnswered`/`addFeedback`; the suites run the tail but assert nothing it does. patch: extend the test-mode pin + one non-stream fanout update assertion |
| G1 | Unparsable-body fallbacks for 429/503/422 never tested (only parsed passthroughs) — the branch that names the documented error when the upstream body does not parse | medium | verified real: `agent-json-result.test.js` scripts parseable bodies only; the streaming suite pinned its fallback in 2.4's FIX round, the JSON one does not. patch: three fallback tests |
| G1 | A run finishing with zero `text_message_content` events answers 201 with `response: ''`, untested and unflagged (BH+EC, same root) | low | verified real but it mirrors the deployed streaming behavior (empty text → metadata + done; the usage record's `outcome` carries the honesty), and the producer cannot reach it today (insufficiency always delivers text). patch: one test pinning the mirror behavior |
| G1 | `readUpstreamBody` settles on `end`/`error` only — a destroyed non-2xx body stream (close-only) leaves the promise pending forever (BH) | low | verified real; the content is pre-existing (2-4) but the module home is new in this story — a known hang must not ship in a new module. patch: settle-on-close (resolve is idempotent) |
| G1 | Per-request `http.Agent`/`https.Agent` never destroyed + the upstream-call idiom copy-pasted instead of moving into one home (BH) | low | real, but the per-request agents are the deployed legacy idiom (query-routes.js:387-388) whose shared-agent refactor 2.4's quality round explicitly deferred to deferred-work.md; extracting a shared run client is not a direct correction. defer |
| G1 | The typed-error branch duck-types on `statusCode`+`body` instead of `instanceof AgentJsonTurnError` — a legacy error growing an object `body` would bypass the 500 mapping (BH); a non-integer `statusCode` would RangeError in `res.status` (EC) | false | refuted twice: verbatim `statusCode`+`body` rendering IS the app-wide error contract (the global middleware in index.js renders typed errors exactly so — the duck-type is that convention, not a divergence), and every constructor site passes literal integer statuses / the route's earlier 401 branch handles the only foreign statusCode — no reachable caller produces the claimed inputs |
| G1 | `translationFailed` rides only the 201 body, never the doc — a doc-only audit cannot tell the stored text was a fallback (BH) | low | real observation, deliberate and symmetric: streaming carries the latch on the `done` frame, never in metadata; adding a doc marker is contract surface the streaming path does not carry either. rejected per the low rule (unlikely met, not a direct correction) |
| G1 | The pairs doc still describes `FINALIZATION_MARGIN_MS` as "metadata persistence, frame write, SSE teardown" while claiming the JSON consumer reads the same derivation (BH) | low | verified real — the doc now names a consumer its reserve description does not cover. patch: one clause |
| G1 | Two pin surfaces (top-level exports vs the `_internals` subset omitting `DEADLINE_FLOOR_MS`) can silently diverge (BH) | low | speculative future drift: `_internals` exists solely as the frame-writer suite's pin surface and no test reads the missing name; no defect today. rejected per the low rule |
| G1 | Spec task line attributes flag-off parity to `agent-json-result.test.js`; the pins live in `query-routes.test.js` (EC claim) | low | coverage EXISTS (the two wiring tests) — the spec's file attribution is off; the fix would edit the spec text only. rejected per the spec-edit rule, attribution recorded here |
| G1 | Claim: JSON persists the delivered translated text while streaming persists the EN source — read as tension with "persistence behaving as the streaming path" (EC claim) | false | refuted: the persisted-text semantics are mode-appropriate by construction — the legacy JSON path already persists chatqna's translated answer (chatqna translates upstream), so the agentic JSON path persisting the delivered text is the in-mode continuation, documented in Implementation Notes; the AC clause governs the persistence MECHANISM (mint → queryId → metadata), which is identical |

## Design Notes

- **The `abstained` overlay lives in the JSON consumer, not in `assembleAgentMetadata`.** The streaming metadata contract does not carry it today (the verdict frame carries `insufficient_evidence` verbatim to SSE clients); the V05-derived JSON vocabulary is this story's own derivation — a small pure function over the verdict, pinned by tests, so a later story that surfaces abstention on streaming can reuse it instead of inventing a second mapping.
- **`run_error` is a thrown typed error (statusCode 502, `error: 'AGENT_RUN_ERROR'`)** so `createQuery`'s existing catch surfaces it through the route's existing JSON error mapping — the branch adds no error plumbing of its own.

## Verification

**Commands:**
- `cd components/gov-chat-backend && npx jest __tests__/routes/agent-json-result.test.js __tests__/routes/agent-frame-writer.test.js` -- expected: green
- `cd components/gov-chat-backend && npx jest __tests__/routes/query-routes.test.js __tests__/services/query-service.test.js __tests__/query-service-fanout.test.js` -- expected: green (legacy JSON pins unchanged)
- `cd components/gov-chat-backend && npx jest` -- expected: full suite green
- `rtk proxy npx eslint services/agent-run-contract.js services/agent-json-result.js services/agent-frame-writer.js services/query-service.js routes/query-routes.js && npx prettier --check <same files>` -- expected: clean
- **Merge with story 3.1 (!1015, landed while this story was in review) — resolution decision.** 3.1 landed the guarded one-flag adapter (`resolveQueryRoute`) plus a TRANSIENT refusal: `createQuery` threw `503 AGENTIC_PATH_NOT_SERVED` on flag-on JSON requests because "the non-streaming entry has no agentic serving path yet". This story IS that serving path, so the refusal's premise is gone: the refusal machinery (`resolveLegacyQueryUrl`, `agenticRefusalError`, the constants, the export) is removed and the routing decision now feeds only the LEGACY leg's URL (`resolveQueryRoute().url`) — the flag-on request takes the agentic branch before it and is SERVED, never refused. 3.1's two refusal pins were repurposed to the merged reality (flag-on serves the agentic branch through the run leg; test-mode serves the mock — this story's gate outranks the flag, superseding 3.1's mode-independent refusal deliberately: with the path serving, a mocked answer under the flag is the mock branch, not a false agentic answer). 3.1's general typed-error passthrough (`statusCode`+`code`) stays in the route catch, SECOND after this story's `AgentJsonTurnError` class gate (disjoint captures); its streaming-route twin is untouched. Sprint-status rows keep both sides (landed rows + `2-12: review`).
