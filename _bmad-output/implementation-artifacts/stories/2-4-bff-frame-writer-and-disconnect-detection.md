---
title: 'Story 2.4 — BFF frame writer and disconnect detection'
type: 'feature'
created: '2026-11-21'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '0a0d2a9b96487afec6874011033327bd57f69d71'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/docs/agent-budget-deadline-pairs.md'
---

<frozen-after-approval reason="human-owned intent — the issue #1961 acceptance criteria, operator-authored">

## Intent

**Problem:** The BFF does not proxy the agent's seam stream: no component parses the envelope (`{run_id, call_id, seq, kind, payload}`) into the client SSE dialect, no client-disconnect detection actually works on the streaming path (the `req.on('close')` listener is dead), and no routing helper gates the agentic endpoints — so cancellation cannot propagate and the client contract would have a second owner.

**Approach:** The BFF parses the agent-service seam stream (`POST /v1/runs`) and writes every client frame itself; disconnect is detected on the stream and aborts the upstream agent leg; one shared routing helper is the only way the agentic branch is exposed; the `queries` doc is minted per turn exactly as the legacy path does.

**Acceptance criteria (issue #1961, the contract):**
- Given the agent-service seam stream, when the BFF proxies an agentic request, then it writes every client frame itself — chunk relay, `agent_activity`, `agent_verdict`, metadata (+ version-record persistence), translation injection, `done`/`error` — with the five existing types and terminal order preserved verbatim.
- And client disconnect is detected on the stream (replacing the dead `req.on('close')` path), aborting the upstream call and cancelling in-flight work.
- And the shared routing helper (guarded in E3's 3.1) is the only way either agentic endpoint is exposed — the BFF integration and the guarded seam land together.
- And the `queries` doc is minted per turn with the same shape as the legacy path (queryId continuity for persistence, analytics, saved conversations).

</frozen-after-approval>

## Boundaries & Constraints

**Always:**
- Frames are anonymous `data:` lines whose JSON carries the `type` discriminator; `agent_activity`/`agent_verdict` are additive and carry `version: 1`. Pinned positions: `agent_activity` interleaves with chunks; `agent_verdict` after the last chunk, before `metadata`; `done` always last; on a genuine failure the existing error-frame contract applies (error frame then end, no `done`).
- The metadata frame keeps its existing shape: `source_documents` entries follow the deployed envelope variants (legacy `document_id` rows, OKF rows with `source: 'okf-concept'` + the `concept_id`/`repo_id`/`bundle_version` trio), `grounding_status` (tri-state) + derived `is_grounded` ride additive, and an `agent_run` block (`run_id`, `usage_record`) rides additively on the wire and into the persisted queries-doc metadata — the version-record persistence of this story.
- Disconnect detection is `res.on('close')`; the abort reaches the agent leg (`AbortController`) and the agent-service cancels its in-flight work (its contract); a partial answer already streamed is partial-saved like the legacy close path does.
- Translation behaves as today: the existing unit-relay machinery (streaming units or post-stream whole-answer, `translationFailed` on `done`) is shared by both paths — one home, not a copy.
- The upstream timeout knob is `AGENT_UPSTREAM_TIMEOUT_MS` (the name reserved in `docs/agent-budget-deadline-pairs.md`); `deadline_ms` derives from it minus named translation/finalization reserves, so the pair rule holds by construction.

**Never:**
- No residual-budget wiring, no translation-backend selection keyed on routing, no per-agent translation allowances (story 2.10); translation uses the request-resolved translator exactly as legacy does.
- No run-start version-record persistence for a payload the agent-service does not yet emit (story 2.11 owns attribution content; the run-start payload carries no version record today).
- No change to the legacy chatqna relay beyond the dead-listener replacement; the V05 contract stays frozen.
- No non-streaming (`POST /api/queries`) wiring (story 2.4b) — the helper is built for both entries, one is wired here.
- No new runtime dependency; no `comps` import.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Agentic happy path | AGENT_ENABLED=1, run admitted, verdict grounded | chunks (+ agent_activity interleaved), agent_verdict, metadata (+grounding + source_documents + agent_run), done | N/A |
| Lane saturated | upstream answers 429 | 429 JSON to the client before any SSE byte, `Retry-After` passed through; doc left unanswered | N/A |
| Knobs unconfigured | upstream answers 503 | 503 JSON (`budget_configuration_missing`/`run_surface_unconfigured`) before any SSE byte | N/A |
| Run fails mid-stream | `run_error` seam event | `{type:'error', message, code:'AGENT_RUN_ERROR'}` then end — no metadata, no done (legacy error contract) | honest terminal, no fabricated answer |
| Client disconnect mid-run | `res` emits `close` | upstream aborted, agent-service cancels in-flight; partial answer partial-saved; no further frames | slot releases agent-side |
| Disconnect on legacy path | `res.on('close')` fires (dead listener replaced) | keepalive cleanup + upstream abort + partial save (the dead code's documented intent, now live) | N/A |
| Ungrounded verdict | `marking.required` true | agent_verdict carries the marking; metadata `grounding_status='ungrounded'`, `is_grounded=false` | N/A |
| Translation unit fails | translator error mid-relay | English remainder + `translationFailed: true` on done (shared machinery) | N/A |
| Verifier absent / no verdict event | answered run without verdict | metadata `grounding_status='unverified'`, `is_grounded=false` — never a confident default | N/A |

## Code Map

- `components/gov-chat-backend/routes/query-routes.js:313-699` -- the streaming handler: SSE headers (:351), abort controller (:359), chatqna relay (:565-628), dead `req.on('close')` (:649-671), keepalive (:673-679), error paths (:680-697). The branch point and the dead-listener replacement site.
- `components/gov-chat-backend/routes/query-routes.js:701-776` -- `handleStreamDone`: metadata frame → optional translation → `finalizeStreamQuery` → `done` + end. REUSED verbatim by the agentic terminal (order preserved by construction).
- `components/gov-chat-backend/routes/query-routes.js:162-173` -- `emptyStreamMetadata()` (abstained `null`, filter_labels `null`); the agentic metadata base.
- `components/gov-chat-backend/routes/query-routes.js:426-515` -- the inline streaming-translation machinery (`scheduleUnitTranslation`, pendingEn, translationChain): extract to a shared module both paths use; the legacy SSE translation suite (`__tests__/routes/query-routes.test.js:1675+`) pins equivalence.
- `components/gov-chat-backend/services/query-service.js:559-647` -- `initStreamQuery`: validation → scope resolution → `queries.save` (doc shape :599-611) → queryId. The agentic branch reuses it whole (queryId continuity AC).
- `components/gov-chat-backend/services/query-service.js:675-826` -- `_attachFanoutCarrier`: posture + authz resolution (mode/engaged/legacy-first hybrid/okf_only). Extract the resolution so the agent `CallerContext` assembly shares one home (no double upstream calls, no drift); the carrier's payload output is unchanged.
- `components/gov-chat-backend/services/retrieval-config-client.js:570-600` -- `getAuthorizedGraphs` → `{graph_names[], repos[], ...}` (repos entries carry repo/graph identity — verify exact field names at implementation); the `CallerContext`'s `authorized_graph_names`/`authorized_repos` source (OKF_ENABLED parked at :113).
- `components/gov-chat-backend/services/query-service.js:453-550` -- `parseChatQnASSELine`: the parser discipline (discriminator, defaults, `__proto__` exclusion) the seam parser mirrors.
- `components/gov-chat-backend/services/agent-residual-budget.js` -- the pure residual contract (SKIP_STATUSES, planTranslation); NOT wired here (2.10); the usage_record the frame writer parses is its future input.
- `components/agent-service/app.py:172-287` -- the run surface: seam frames `data: {envelope}\n\n`, terminal `data: {"usage_record":{...}}\n\n`; 429 (`admission_refused`, `Retry-After: 1`) / 503 (`budget_configuration_missing` | `run_surface_unconfigured`) / 422; body `{question, deadline_ms, context: CallerContext, bearer}`.
- `components/agent-service/agent/events.py:41-67` -- `EventKind` vocabulary; `VERDICT` emits after text, before terminal; import-time guard keeps BFF frame names out of the seam.
- `components/agent-service/agent/loop.py:232-246` -- text lifecycle (`{text}` on `text_message_content`), verdict payload order, `run_finished {outcome}`.
- `components/agent-service/agent/verification.py:323-334` -- the verdict projection payload (`grounding_status`, `is_grounded`, `translation_mode`, `policy`, `judge`, `citations`, `invalid_citations`, `marking`); citations are `{provenance, text, score}`.
- `components/agent-service/noagent/pipeline.py:114-190` -- `source_document_envelope`: the deployed source_documents row shapes (id-derived names, empty url/labels, okf trio + marker) — the mapping the BFF applies to verdict citations.
- `components/agent-service/agent/orchestrator.py:202-226` -- `RunUsageRecord.as_dict()` — the usage-record fields.
- `docs/agent-budget-deadline-pairs.md:67-97` -- the reserved `AGENT_UPSTREAM_TIMEOUT_MS` name + pair rule this story lands; the doc gains the landed-knob note.
- `components/gov-chat-backend/__tests__/routes/query-routes.test.js` -- module mocks + `createApp` + `setupSSEStream`/`parseSSEEvents` helpers (:1305-1431); the pattern the new suites follow.
- `docker-compose.yaml:1434-1520` -- the agent-service block (AGENT_ENABLED gate, port 8010); the backend env list gains the two new pass-throughs.
- `env` -- the committed template; the new knobs documented near the AGENT_* block (line ~1416).

## Tasks & Acceptance

**Execution:**
- [x] `components/gov-chat-backend/services/agent-routing.js` -- NEW: `isAgentPathEnabled()` (single `AGENT_ENABLED` read, OKF_ENABLED pattern) + `agentServiceUrl()` (`AGENT_SERVICE_URL`, default `http://agent-service:8010`) -- the AD-9 shared routing helper; the only AGENT_ENABLED read in the BFF
- [x] `components/gov-chat-backend/services/agent-seam-parser.js` -- NEW: one seam SSE data line → `{type:'event', event}` | `{type:'usage_record', record}` | `{type:'error', raw}`, envelope validated (`run_id`/`seq`/`kind` required) -- the seam dialect's one parser
- [x] `components/gov-chat-backend/services/agent-frame-writer.js` -- NEW: `proxyAgentRun(...)` — builds the run body (`deadline_ms` from `AGENT_UPSTREAM_TIMEOUT_MS` minus named reserves; `CallerContext` from the shared posture resolution: hybrid legacy-first / okf_only authz-only / labels from the request narrowing; bearer forwarded), POSTs `/v1/runs` (axios stream, `AbortController`, keep-alive agents), projects the seam stream onto client frames (chunk relay via the shared unit relay, `agent_activity` v1 started/completed with operation name, `agent_verdict` v1, metadata assembly + `agent_run` persistence via `handleStreamDone`, error contract), registers `res.on('close')` abort + partial save, maps upstream 429/503 to client JSON before any SSE byte -- the frame writer + disconnect detection
- [x] `components/gov-chat-backend/services/query-service.js` -- extract the fan-out posture resolution from `_attachFanoutCarrier` into a function both the carrier and the agent `CallerContext` assembly call (payload output byte-identical; carrier suite pins) -- one home, no double calls
- [x] `components/gov-chat-backend/routes/query-routes.js` -- branch through `isAgentPathEnabled()` after `initStreamQuery`: agentic → `proxyAgentRun`; replace the dead `req.on('close')` with `res.on('close')` (same cleanup body); move the inline unit-translation machinery to the shared relay module -- the guarded seam landing + the disconnect fix
- [x] `components/gov-chat-backend/services/translation/stream-unit-relay.js` -- NEW: the extracted streaming-translation unit relay (`onChunk`/`flush`, failure latch) consumed by both paths -- one home, translation behaves as today
- [x] `docker-compose.yaml` + `env` -- `AGENT_UPSTREAM_TIMEOUT_MS` (default 3600000) + `AGENT_SERVICE_URL` pass-throughs and template docs -- operator-visible knobs
- [x] `docs/agent-budget-deadline-pairs.md` -- the landed-knob note (default, derivation, reserves) -- the V08 doc stays true
- [x] `components/gov-chat-backend/__tests__/services/agent-seam-parser.test.js` + `agent-routing.test.js` + `__tests__/routes/agent-frame-writer.test.js` (+ route wiring assertions) -- the I/O matrix as executable checks, following the query-routes mocking pattern

**Acceptance Criteria:**
- Given an agentic request with AGENT_ENABLED=1, when the run streams, then every client frame is BFF-written in the pinned order (chunk/agent_activity interleaved, agent_verdict after the last chunk, metadata, done last) and the five existing types are byte-compatible with the legacy dialect.
- Given a client disconnect mid-stream, when `res` closes, then the upstream agent call is aborted, the agent-service cancels the in-flight run, and the partial answer is partial-saved.
- Given AGENT_ENABLED off, when either query entry is hit, then the legacy path serves byte-identically (the helper is the only branch).
- Given an agentic request, when the turn starts, then the `queries` doc exists from `initStreamQuery` with the legacy shape and the same queryId completes it at finalize.

## Implementation Notes

<!-- Agent-owned. Append-only during implementation. -->

### 2026-11-21 — implementation (baseline 0a0d2a9b9)

**Files.** NEW: `services/agent-routing.js`, `services/agent-seam-parser.js`, `services/agent-frame-writer.js`,
`services/translation/stream-unit-relay.js`, plus the three suites. EDITED: `routes/query-routes.js`,
`services/query-service.js`, `docker-compose.yaml`, `env`, `docs/agent-budget-deadline-pairs.md`,
`__tests__/routes/query-routes.test.js` (wiring assertions).

**Frame shapes (2.9 will pin the envelope; defined here).**
- `agent_activity`: `{type:'agent_activity', version:1, status:'started'|'completed', operation:<tool name|null>, callId:<call_id|null>}` — one frame per seam tool-call lifecycle event; the finished event carries no name, so the writer maps call_id → name from the started event. Auxiliary model calls emit nothing (only tool calls do).
- `agent_verdict`: `{type:'agent_verdict', version:1, ...verdictPayload}` — the verification pipeline's projection payload verbatim (`grounding_status`, `is_grounded`, `translation_mode`, `policy`, `judge`, `citations`, `invalid_citations`, `marking`).
- `metadata` keeps the legacy shape; `grounding_status` (tri-state) + derived `is_grounded` + `agent_run {run_id, usage_record?}` ride additive. Verdict absence on an answered run = `grounding_status:'unverified'`, `is_grounded:false`.
- `source_documents` rows are the verdict citations mapped to the deployed envelope variants (`noagent/pipeline.py source_document_envelope` shapes: legacy `document_id`-derived rows; OKF trio + `source:'okf-concept'`).

**Ordering decision — the verdict frame writes at the terminal, not on receipt.** With streaming
translation active, the last chunk's translated unit may still be in the relay chain when the seam
verdict arrives; writing the verdict on receipt could land it BEFORE the last chunk. The writer
therefore captures the verdict and writes it in `doAgentTerminal` after `relay.flush()` and before
`handleStreamDone` — the pinned position (after last chunk, before metadata) holds on the wire by
construction.

**Dead-listener replacement — one necessary amendment to "same cleanup body".** `res.on('close')`
fires on EVERY response end (including the normal one), unlike the dead `req` listener that never
fired. The body therefore gained a `doneState.handled` guard (a completed stream is not
re-finalized as a partial save) and the legacy `stream.on('error')` branch now marks
`doneState.handled` — otherwise the now-live close listener would have turned an already-errored
stream into a partial save, breaking the error-frame contract (error frame then end — no
metadata, no done). Without these guards the "same body" would have shipped a double-finalize
defect the dead code could never exhibit.

**Disconnect on the agent path.** The writer registers `res.on('close')` BEFORE the upstream POST
(a client leaving during the posture resolution or the agent-leg wait aborts the call too), aborts
the `AbortController`, and partial-saves with the assembled metadata (verdict captured so far
rides in; `agent_run` carries the run_id and the usage record only when one arrived — a cancelled
run emits none). `streamFinished` guards the close listener against the normal terminal.

**429/503 passthrough.** With `responseType: 'stream'` the non-2xx body is ALSO a stream; the
writer uses `validateStatus: () => true`, consumes the error body (64 KiB cap) and passes the
parsed JSON through verbatim (`Retry-After` header re-emitted on the 429). A body that does not
parse falls back to the documented error names (`admission_refused` / `budget_configuration_missing`).
Any other upstream status answers `502 AGENT_SERVICE_UNAVAILABLE` before any SSE byte. SSE headers
are written only after the upstream answered 200 — the pre-stream refusals are plain JSON.

**Transport errors mid-stream** use the same error-frame contract with code `AGENT_STREAM_ERROR`
(the matrix pins only the `run_error` → `AGENT_RUN_ERROR` case; the transport case mirrors the
legacy `CHATQNA_STREAM_ERROR` shape).

**Posture extraction (`query-service`).** `resolveFanoutPosture(authHeaders, {queryId, sessionId})`
is the one home (config read, engaged gate, `fanout_config_resolved` + `posture_unknown` emissions,
authz + sticky loads with the parallel sticky-promise preserved); `_attachFanoutCarrier` keeps its
own payload-branch application and consumes the posture. The graph-set rule (hybrid legacy-first /
okf_only authz-only / engaged-gate) is itself extracted (`_fanoutGraphSet`) and shared by the
carrier and `buildAgentCallerContext(queryData, posture)` — the two views cannot drift. The authz
response's `repos: [{repo_id, graph_name}]` rows (verified against the okf-server
`/api/okf/authz/graphs` contract) are kept only when the row's graph is inside the authorized set
and each repo id appears once — the CallerContext contract's own invariant. A 401 propagates (the
route answers 401 before any SSE byte); any other resolver failure degrades to an empty authorized
set, the same direction the carrier degrades.

**Translation.** The relay is a verbatim extraction (comments carried; log names unchanged — the
legacy suite pins equivalence through the route). `flush()` returns the failure latch AFTER the
flush, which is the `alreadyFailedTranslation` value on `done`. The agent path uses the same
request-resolved translator; no routing-keyed backend selection (2.10).

**Deadline derivation.** `deadline_ms = max(1000, AGENT_UPSTREAM_TIMEOUT_MS − 30000 − 5000)` with
the reserves as named module constants (`TRANSLATION_RESERVE_MS`, `FINALIZATION_MARGIN_MS`) beside
the derivation; the timeout knob itself is the axios `timeout` on the agent leg. The judge-overrun
ceiling is not part of the derivation (documented in the pairs doc).

**Compose/env.** Backend env block gains the two pass-throughs (`AGENT_UPSTREAM_TIMEOUT_MS`
default 3600000, `AGENT_SERVICE_URL` default `http://agent-service:8010`); the `env` template
documents them right after the AGENT block. Ansible `env.j2`/group_vars intentionally untouched
(the operator set for agent knobs lands with the deployment story that flips the flag).

**Test-side discovery worth keeping.** supertest requests start lazily (on `.then`) — a test that
drives the upstream stream mid-flight must kick the request off explicitly and wait for the frame
writer's stream-listener attach before emitting 'error' (a no-listener `error` event crashes the
worker instead of failing the assertion). The disconnect cases are tested through direct
`proxyAgentRun` calls with a fake `res` (an EventEmitter with the write contract), which gives
exact control over the close timing.

**Verification (all green).**
- `npx jest __tests__/routes/agent-frame-writer.test.js __tests__/services/agent-seam-parser.test.js __tests__/services/agent-routing.test.js` → 49 passed.
- `npx jest __tests__/routes/query-routes.test.js` (+ `query-service-fanout.test.js`) → 105 passed.
- `npx jest __tests__/services/query-service.test.js` → 167 passed.
- Full backend `npx jest` → 2499 passed, 8 skipped, 0 failed.
- `npx eslint` + `npx prettier --check` over all touched files → clean.
- `cd tests/config-validator && npm test` → 667 passed (after `cd tests/e2e && npm ci` — the #1716 behavioral gate needs the e2e deps on a dev checkout; unrelated to this story).

### 2026-11-21 — review round 1 fixes (coordinator findings)

- **`AGENT_ENABLED` reaches the backend** (compose): the backend env block gains the explicit
  `AGENT_ENABLED=${AGENT_ENABLED:-0}` entry (the OKF_ENABLED no-passthrough precedent) — flipping
  the flag otherwise started the service while the BFF branch stayed parked. Noted in compose: the
  helper reads the flag once at backend start, so a flip needs a backend recreate.
- **One posture resolution per request**: `initStreamQuery` takes `{ skipFanoutCarrier }` (default
  false); the agentic branch passes it so the frame writer's `resolveFanoutPosture` is the only
  read. Legacy entry unchanged (no third arg).
- **Too-small timeout absorbed, not floored**: `deriveDeadlineMs` warns (naming
  `AGENT_UPSTREAM_TIMEOUT_MS`, logging configured vs applied) and falls back to the default when
  `timeout ≤ reserves + floor` (≤ 36000 shipped) — the 1000 ms floor alone would have broken the
  documented pair rule for small timeouts.
- **422 mapped**: a malformed run request now answers `422` (upstream body passed through when it
  is a JSON object, else `{error:'invalid_run_request'}`) — was falling into the 502 outage branch.
- **429/503 passthrough guarded**: only a real JSON object is forwarded; arrays/strings/garbage
  fall back to the documented error names.
- **504/502 error codes unified** on `AGENT_SERVICE_UNAVAILABLE` (the 504 message keeps the
  timeout wording).
- **`wantsTranslation` one home**: moved to `services/translation/language-request.js` (beside
  `normalizeRequestedLanguage`, same one-decision doctrine); route and frame writer import it,
  both inline copies deleted.
- **Verdict frame spread hardened**: payload `type`/`version` keys are stripped before the spread —
  a payload carrying them can no longer override the frame discriminator/version.
- **Write-after-end guard**: `onSeamEvent` returns when `streamFinished` (the usage_record capture
  outside it still runs).
- **Carrier catch logs a real correlationId again**: `_attachFanoutCarrier` generates the UUID
  before the try and passes it into `resolveFanoutPosture` (new `opts.correlationId`; the posture
  function uses the passed value, generating only when absent).
- **UTF-8 chunk boundaries**: the agent stream uses `stream.setEncoding('utf8')`; the per-chunk
  `toString()` is gone.
- **Trailing data line flushed**: the stream `end` handler runs the buffered remainder through the
  seam parser (shared `handleSeamDataLine` helper) before the terminal.
- **Dead API removed**: the relay's never-consumed `isFailed()` is gone (JSDoc updated).
- **Docs/env numbers corrected**: the "same order as CHATQNA_STREAM_TIMEOUT" claim replaced with
  the real numbers (timeout default 3600000 = 1 h; CHATQNA_STREAM_TIMEOUT templates at 300000 =
  5 min; independent knobs), plus the absorption rule.
- **Tests**: default-deadline assertion now states the explicit arithmetic (3600000 − 30000 − 5000)
  instead of calling the derivation on itself; new tests for the 422 mapping (parsed + fallback
  body), the non-401 posture failure (run proceeds, `buildAgentCallerContext` called with null),
  the legacy mid-stream error contract (error frame last, NO partial save — the close-guard), and
  six `buildAgentCallerContext` unit tests executing the real method (null posture, hybrid/okf_only
  sets, out-of-set repo dropped, duplicate repo_id deduped, unengaged → empty).

**Verification (review round)**: `agent-frame-writer` 26 passed; `query-routes` +
`query-service` + `query-service-fanout` 281 passed (only the suites covering the edited files —
full verification runs on the coordinator side); eslint + prettier clean; `tests/config-validator`
667 passed (covers the compose/env edits).

### 2026-11-21 — review round 2 fixes (global review findings)

- **Effective timeout, resolved once** (`agent-frame-writer.js`): new
  `resolveUpstreamTimeoutMs()` performs the absorption (warn + default) and
  `proxyAgentRun` reads ONE `effectiveTimeoutMs` for ALL consumers — the deadline derivation, the
  axios `timeout` option, and the stream wall-clock bound. Previously a too-small configuration
  paced the run against a 1 h deadline while the leg still aborted at the small value — the exact
  BFF-attributed abort the pair rule forbids, with a warn `applied` field that lied. `deriveDeadlineMs`
  is pure again; the pairs-doc wording updated (every consumer of the pair reads the same resolved
  value).
- **Legacy disconnect listener hoisted** (`query-routes.js`): `res.on('close')` now registers right
  after `initStreamQuery` returns (queryId exists) and BEFORE `writeHead`/the chatqna POST —
  disconnects during the connect / time-to-first-byte window are caught. The listener body is
  identical; `doneState`, `fullResponseText`, `capturedMetadata` and the controller assignment were
  hoisted above the registration so no binding sits in the temporal dead zone when close fires
  early. Two companion necessities: the route catch now returns instead of answering when
  `res.writableEnded || res.destroyed` (an answer to a client that is gone is an error nobody
  reads — without it the connect-window path wrote a 504 into a destroyed socket), and the
  span-stamping test's fake `res` grew the `on: jest.fn()` seam the hoisted registration needs.
- **`finishWithErrorFrame` aborts the upstream leg** (guard: only when not already aborted) — the
  agent leg must not keep making model calls (and holding its admission slot) behind a response the
  client was told failed.
- **Stream wall-clock bound**: once the upstream headers arrive the axios timeout degenerates to an
  inactivity bound; the writer now arms `setTimeout(effectiveTimeoutMs)` when the stream starts —
  on fire it warns (`AgentFrameWriter.stream_deadline_exceeded`) and aborts the controller (the
  stream's 'error' path ends with the error contract). Cleared on every terminal path: the agent
  terminal, `finishWithErrorFrame`, the close listener.
- **Truncated upstream body is visible**: `readUpstreamBody(data, status)` stops buffering past the
  64 KiB cap and warns `AgentFrameWriter.upstream_body_truncated` (status + bytes) once, instead of
  silently JSON-parsing a cut prefix into the generic fallback.
- **Tests** (same suites): the under-sized configuration pins BOTH wire consumers (deadline AND
  axios timeout) reading the absorbed default, plus the warn payload; the wall-clock test uses fake
  timers (effective 40000 ms, stream trickles, bound fires → signal aborted → error contract, no
  finalize); the transport-error test asserts the controller signal is aborted; the legacy suite
  gains a connect-window disconnect test (raw `http` server we own — an aborted supertest request
  leaks its ephemeral listening server — client socket destroyed while the handler is parked inside
  the POST await → signal aborted, silent no-save).

**Verification (review round 2)**: `agent-frame-writer` 28 passed; `query-routes` 85 passed
(113 total across the two covering suites, clean jest exit — the earlier rounds' "did not exit"
open handle came from the aborted-supertest-request shape and is gone with the owned-server test);
eslint + prettier clean on the four touched files.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

| Round | Finding | Verdict | Evidence / disposition |
|---|---|---|---|
| G1 | compose backend env block carries no `AGENT_ENABLED` passthrough (only the agent-service block has it) — flipping the flag starts the service but the BFF branch stays parked silently; OKF_ENABLED documents exactly this trap at compose:872 | high | verified real: grep shows AGENT_ENABLED only at :1460/:1519 (agent-service); backend block (:878+) gained only the two new knobs. Half-activated deployment = the AD-9 defect. patch: add the env line |
| G1 | agentic path resolves the fan-out posture TWICE (initStreamQuery's carrier runs before the branch, then proxyAgentRun resolves again) — duplicate upstream calls + duplicate log emissions; contradicts the story's "no double upstream calls" | medium | verified real: query-service.js:644 attaches the carrier unconditionally; the branch is after initStreamQuery per the spec wiring. patch: the agentic branch skips the carrier (option on initStreamQuery); the frame writer's resolution is the one |
| G1 | deadline floor breaks the documented pair rule for AGENT_UPSTREAM_TIMEOUT_MS < 36000 (deadline+reserves > timeout; docs+env claim "holds by construction") | medium | verified real: deriveDeadlineMs clamps at 1000; docs/env wording overclaims. patch: absorb a too-small timeout (warn + default) and qualify the docs claim |
| G1 | upstream 422 (e.g. empty question after no extractable text) answers 502 AGENT_SERVICE_UNAVAILABLE — a request problem surfacing as an outage | medium | verified real: only 429/503 are mapped; 422 falls into the generic branch; initStreamQuery logs no_extractable_text and continues, so the path is reachable. patch: 422 passthrough |
| G1 | legacy mid-stream error branch: the new doneState.handled guard has no test (the error contract — error frame then end, no partial save — can silently regress) | medium | verification-gap, pre-verified (grep: no legacy mid-stream error test; delete-the-line demonstration). patch: mirror agent-frame-writer.test.js:620-641 |
| G1 | buildAgentCallerContext never executes under test — the authz-repo narrowing invariant (the mapping may not widen the scope) is unpinned; route tests mock the function | medium | verification-gap, pre-verified. patch: unit tests in query-service.test.js (out-of-set repo dropped, duplicate repo_id dropped, null posture → empty) |
| G1 | non-401 posture failure fail-closed degradation untested (only 401 branches are pinned) | medium | verification-gap, pre-verified. patch: one test — resolver rejects non-401, run still serves with empty authorization |
| G1 | wantsTranslation rule duplicated inline in the frame writer (query-routes.js:48's own comment demands one home "so the three cannot disagree") | medium | verified real: exact duplicate at agent-frame-writer.js:262. patch: move the rule to a shared translation module, both paths import |
| G1 | verdict frame spread lets payload keys override type/version | low | verified real spread order, but the producer's payload keys are pinned (Verdict.payload() has no type/version) — defense-in-depth only. patch: destructure before spread |
| G1 | writeClientFrame has no post-terminal guard (late seam events after run_error would write after end) | low | verified real gap, but the pinned producer emits nothing after the terminal; usage_record (the only post-error frame) writes nothing. patch: skip onSeamEvent writes when streamFinished |
| G1 | _attachFanoutCarrier catch logs correlationId:null (was a real UUID before the extraction) on the most common failure | low | verified real: correlationId now generated inside resolveFanoutPosture, assigned only after it returns. patch: generate in the carrier, pass into resolveFanoutPosture |
| G1 | chunk.toString() can split a multi-byte UTF-8 char (corrupt line → seam_parse_error, text lost) | low | verified real pattern; same idiom as the deployed legacy relay (pre-existing exposure). patch: stream.setEncoding('utf8') on the new path |
| G1 | a trailing data line without \n at stream end is dropped silently (the last seam frame lost) | low | verified real: buffer remainder never parsed at 'end'. patch: flush the remainder through the parser at 'end' |
| G1 | 429/503 passthrough forwards any truthy parsed body (array/scalar possible) | low | verified real; producer is our own service. patch: forward only non-null plain objects |
| G1 | relay isFailed() has no consumer (dead API) | low | verified real (grep). patch: delete the method |
| G1 | docs/env claim the 3600000 default is "the same order as CHATQNA_STREAM_TIMEOUT" — its template value is 300000 (12× smaller) | low | verified real (env:1342 vs env:1488). patch: fix the wording, state the real numbers |
| G1 | tautological deadline assertion (body.deadline_ms compared against deriveDeadlineMs itself) | low | verified real; the 60000 test pins the real arithmetic, this one pins only consistency. patch: assert the explicit arithmetic for the default constant |
| G1 | 504 answers AGENT_UNAVAILABLE vs 502's AGENT_SERVICE_UNAVAILABLE; the 504 branch untested | low | verified real; disconnect case already guarded (res.destroyed check), so only naming + test. patch: unify the name, one test |
| G1 | seq gaps/duplicates never enforced (claim: dropped TCP chunk truncates silently) | false | TCP streams are ordered and reliable — loss manifests as a connection 'error', which the error contract ends the stream on; the envelope's seq is a reconstructability contract, not a loss detector |
| G1 | httpAgent/httpsAgent created per request, never destroyed | low | real but the deployed legacy idiom (query-routes.js:387-388) — the change mirrors it. Not this story's problem: the shared-agent refactor spans both paths. defer |
| G1 | readUpstreamBody unbounded in time (a stalled error body hangs the client) | low | real but: own trusted upstream, documented JSON errors, rare; fix is a race+destroy (not a direct correction). rejected per the low-findings rule |
| G1 | seam events after run_finished (duplicate verdict overwrite, late chunks) | low | producer emits nothing after the terminal (loop.py pins run_finished as last envelope event); defensive state not demonstrated. rejected |
| G1 | untrimmed serviceLabels forwarded as requested_labels | low | fail-safe direction (an untrimmed label narrows the search, never widens); the legacy chatqna context carries the same values untrimmed. rejected |
| G1 | spec "Never: no change to the legacy relay beyond the dead-listener" contradicted by the relay extraction + error-branch guard | low | the frozen intent (V05 frame contract) is honored — the extraction is the spec's own task 6 and the guard is documented in Implementation Notes; the fix would edit the spec text only. rejected, recorded here |
| G1 | sprint-status row 'in-progress' vs story 'in-review' | false | the row flips to 'review' at MR readiness per the dispatch — a pending planned transition, not drift |


## Design Notes

- **The deadline derivation.** `deadline_ms = AGENT_UPSTREAM_TIMEOUT_MS − TRANSLATION_RESERVE_MS − FINALIZATION_MARGIN_MS` (floor 1000), with `TRANSLATION_RESERVE_MS = 30000` (the GPU translator's own hard timeout in `gpu-translate-backend.js`) and `FINALIZATION_MARGIN_MS = 5000` (metadata persistence + frame write + SSE teardown) as named module constants beside the derivation. The pair rule (`timeout >= deadline + reserves`) then holds by construction — no second knob, no silent arithmetic; 2.10 revisits the reserves when translation allowances land.
- **The routing helper is one boolean read** — AD-9's "one shared routing helper both entries call". The cross-entry disagreement guard is E3 3.1's; 2.4 pins the single-read invariant (no other AGENT_ENABLED read in the component) by test.
- **`agent_run` on the wire and in the doc** is one additive metadata field (versioned philosophy: clients ignore unknown metadata keys; the QueryInspector gains diagnostic value). One object — `handleStreamDone` writes and persists the same metadata it is handed.
- **Verdict-absence = `unverified`.** The governed run surface always builds a verifier, but a stream without a verdict event must never read as confident: the metadata assembly defaults `grounding_status` to `unverified` when no verdict arrived on an answered run.

## Verification

**Commands:**
- `cd components/gov-chat-backend && npx jest __tests__/routes/agent-frame-writer.test.js __tests__/services/agent-seam-parser.test.js __tests__/services/agent-routing.test.js` -- expected: green
- `cd components/gov-chat-backend && npx jest __tests__/routes/query-routes.test.js` -- expected: green (legacy dialect unchanged; dead-listener replacement covered)
- `cd components/gov-chat-backend && npx eslint services/agent-routing.js services/agent-seam-parser.js services/agent-frame-writer.js services/translation/stream-unit-relay.js routes/query-routes.js && npx prettier --check <same files>` -- expected: clean
- `cd tests/config-validator && npm test` -- expected: green (compose/env coverage over the new pass-throughs)

### 2026-11-21 — coordinator verification + matrix audit

- The implementation agent's report named a `query-service-fanout.test.js` suite; no such file exists — the fanout coverage lives in `query-service.test.js` (167 passed). Report inaccuracy only, coverage intact.
- Matrix audit found ONE uncovered row — the legacy-path disconnect (the now-live `res.on('close')`). Added two tests to `__tests__/routes/query-routes.test.js`: a REAL client abort (supertest `req.abort()` → socket close → server-side `close` fires → partial save with the empty-stream metadata) and the doneState guard (a normal completion is finalized exactly once). Both green.
- Independent re-verification (2026-11-21, worktree): full backend `npx jest` → 2501 passed, 0 failed (2499 + the two new); targeted new-suite run 227 passed; `rtk proxy npx eslint` exit 0 + `npx prettier --check` clean over all touched files; `tests/config-validator` 667 passed.

### 2026-11-21 — orchestrator review sequence (global + FIX + quality)

- **Global review 1** (fresh context, /code-review high): 2 important + 1 pre_existing + 4 nits. The judge-usage-gap finding targets story 2.6's shipped `agent/verification.py` (outside this diff) — filed as issue #2067 (`status::backlog`). The rest fixed in the correction commit `15bd1eedd`: the absorbed timeout now feeds BOTH pair consumers via one `resolveUpstreamTimeoutMs`; the legacy disconnect listener registers before the upstream connect (the connect window is covered); `finishWithErrorFrame` aborts the upstream; the seam stream carries a total-duration bound; truncated upstream error bodies warn instead of parsing a cut prefix.
- **FIX review** (fresh context, correction diff only): 5/5 CONFIRMED-RESOLVED, no blocking findings; its one test gap (the truncation warn) closed with two tests + a logger assertion (mutation-gate: the warn assertion reddens on removal, the fallback test reddens on cap removal).
- **Quality round** (/simplify, 4 angles): applied — `parsePositiveInt` backs the timeout read; the streaming-translation flag parse moved beside `wantsTranslation`; `writeSSEFrame` (services/sse-frame.js) is the one client-frame encoding home; `citationToSourceDocument` builds the shared row once; `resolveFanoutPosture` owns the legacy-graph default; `agent-routing` shed its tautological `_internals`; the frame writer dropped the dead `doneState` flag and the unpinned `_internals` exports; one `afterEach` owns the timeout-knob cleanup. Skipped with notes (architectural, recorded for follow-up work): posture-as-parameter (replacing the `skipFanoutCarrier` flag), an SSE session helper owning headers/keepalive/close for both paths, a shared frame encoder for ALL legacy writes (the new-path writes share one home already), the cross-language source_documents envelope mapping (seam-contract level, story 2.9 owns the envelope pin), per-request http agents (deferred in deferred-work.md), readUpstreamBody destroy-on-cap, 429/503/422 branch map, test helper hoisting. Committed `6262ce772` (net −20 LOC).
- **Test audit** (focused, all five suites): no deletions — the junk patterns were caught at authoring/review time (two tautologies + one dead API already removed); the source-scan pin survives the retention bar (cheapest independent guard for the AD-9 single-read invariant); direct-call disconnect tests and route-level tests own distinct lifecycle windows; the CallerContext units own the authz-narrowing invariant; no test-only production seams remain.
- **Final verification (2026-11-21, worktree, HEAD 6262ce772):** full backend `npx jest` → 2518 passed, 0 failed; `tests/config-validator` → 667 passed; `rtk proxy npx eslint` exit 0 + Prettier clean on every touched file.
