---
title: 'Story 2.9 — SSE contract regression coverage'
type: 'feature'
created: '2026-11-22'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '8fa525b4e751199f49b445478bc22b7ffca5c1c4'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
---

<frozen-after-approval reason="human-owned intent — the issue #1967 acceptance criteria, operator-authored">

## Intent

**Problem:** The extended SSE envelope (five legacy event types + the two additive `agent_activity`/`agent_verdict` types, story 2.4's frame contract) has no local-e2e regression coverage: the single-sourced mock envelope cannot express the new frames, so nothing pins their wire shape or proves the current client ignores them gracefully.

**Approach:** Extend the single-sourced e2e envelope (`tests/e2e/helpers/stream-route.js`) with the two new event types in their pinned wire positions, pin the extended wire shape with a helper unit spec, add chatbot specs that assert the rendered degradation behavior through declared handles, and pin the new spec files into the executed local-run set.

**Acceptance criteria (issue #1967, the contract):**
- Given the single-sourced envelope (`tests/e2e/helpers/stream-route.js`), when the new event types are added, then `agent_activity` and `agent_verdict` extend the envelope; specs assert rendered behavior (line appears/disappears, warning paths) through declared handles only.
- And the specs are pinned into the local run set (execution-set pin), and the legacy five-type behavior stays green.
- And clients ignoring the new types behave exactly as today (graceful-degradation spec).

</frozen-after-approval>

## Boundaries & Constraints

**Always:**
- The envelope stays single-sourced: the new frames are expressible only through `stream-route.js`, never hand-rolled in a spec (module header contract; the quick-help spec imports this module credential-free — keep it so).
- Wire shapes mirror the BFF frame contract exactly (story 2.4): `agent_activity` = `{type, version: 1, status, operation, callId}`, interleaved with chunks; `agent_verdict` = `{type, version: 1, ...projection}`, after the last chunk, before `metadata`; `done` always last.
- Every locator is a declared `data-testid` handle (chat surfaces spell it `data-testid`); determinism rules per `tests/e2e/CLAUDE.md` (no sleeps, no fallbacks, exact assertions).
- Scope reading (recorded decision): the rendered activity-line assertions (line appears/disappears, verdict truth table) belong to stories 2.7/2.8, whose UI does not exist yet — the epic context assigns them there ("2.9 pins the envelope for 2.7/2.8; the web/mobile activity lines assert rendered behavior"). This story's rendered assertions are the degradation side: with the new frames riding, the existing render is unchanged and no activity-line handle appears.

**Never:**
- No production code changes (backend frame writer, frontend chat service, agent-service) — this is a coverage story.
- No activity-line UI component, no `agent-activity-line` handle added to the frontend (story 2.7's deliverable).
- No new retry, sleep, or fallback pattern; no locator by class/text/index.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Extended stream, current client | `sseBody` with activity frames interleaved + grounded verdict + grounded metadata | Answer text, sources, done render exactly as a legacy stream; no `[data-testid="agent-activity-line"]` anywhere | N/A |
| Warning path with new frames riding | activity frames + `agent_verdict` ungrounded + metadata `is_grounded: false` | Amber warning paints through its handle exactly as the legacy spec asserts | N/A |
| Legacy five-type stream | `sseBody(chunks, metadata)` with no options | Bytes identical to the pre-change envelope; existing chatbot specs stay green | N/A |

## Code Map

- `tests/e2e/helpers/stream-route.js` -- the envelope; extend `sseBody(chunks, metadata, options)` additively (`options.activity` = per-chunk activity entries or null, `options.verdict` = projection object); default call keeps byte-identical output.
- `tests/e2e/helpers/chatbot.js:466` -- `mockChatStream(page, chunks, metadata)` -- add an options passthrough; it is the route wrapper specs use.
- `tests/e2e/chatbot/chat-conversation.spec.js` -- pattern donor: `withWelcomeSession`, `mockChatStream` usage, the warning assertions (`:305-336`), the sources assertions (`:210`).
- `tests/e2e/helpers/route.spec.js` -- pattern donor for a helper unit spec (Playwright-driven pure-node assertions, no venue needed).
- `components/gov-chat-backend/__tests__/fixtures/agent-seam.js:29-46` -- `GROUNDED_VERDICT` -- the verdict projection shape the e2e mock frames must mirror.
- `components/gov-chat-backend/services/agent-frame-writer.js:26-42` -- the pinned frame contract (read-only reference).
- `components/gov-chat-frontend/src/services/chatbotService.js:195-215` -- the frontend type switch: unknown types fall through silently (the degradation mechanism under test).
- `tests/config-validator/__tests__/config-validation.test.js:2905-2935` -- the executed-set exact pin; new spec files add one line each.
- `docs/e2e-tests/suite-map.md`, `docs/e2e-tests/locator-map.md` -- the suite/locator rows a new spec carries.

## Tasks & Acceptance

**Execution:**
- [x] `tests/e2e/helpers/stream-route.js` -- extend `sseBody` with the additive options (activity interleaved per chunk, verdict before metadata, done last) -- the envelope grows without breaking a caller.
- [x] `tests/e2e/helpers/stream-route.spec.js` -- NEW: unit spec pinning the extended wire shape (exact frame sequence and payloads) and the legacy byte-identity default -- the mutation gate for the single-sourced envelope.
- [x] `tests/e2e/helpers/chatbot.js` -- `mockChatStream` options passthrough -- the wrapper carries the extension.
- [x] `tests/e2e/chatbot/sse-contract.spec.js` -- NEW: graceful-degradation spec (extended stream renders exactly as legacy; no activity-line handle), warning-path spec (ungrounded warning unchanged with the new frames riding) -- the rendered ACs through declared handles.
- [x] `tests/config-validator/__tests__/config-validation.test.js` -- add the two new spec files to the executed-set pin -- the execution-set pin.
- [x] `docs/e2e-tests/suite-map.md` + `docs/e2e-tests/locator-map.md` -- rows for the new spec(s) -- the suite/locator maps stay authoritative.

**Acceptance Criteria:**
- Given a mocked extended stream, when the current app renders a turn, then the answer, sources and warning render exactly as for a five-type stream and no `[data-testid="agent-activity-line"]` handle appears.
- Given the envelope helper called with no new-frame options, when the body is built, then its bytes are exactly the legacy shape.
- Given the local run set derivation, when the config-validator suite runs, then it covers both new spec files and passes.

## Design Notes

Frame order on the wire (mirrors `agent-frame-writer.test.js`):

```
activity(started) chunk activity(completed) chunk agent_verdict metadata done
```

`sseBody(chunks, metadata, { activity, verdict })`: `activity[i]` (object or null) emits `{type:'agent_activity', version:1, status, operation, callId}` immediately before chunk[i]; `verdict` emits `{type:'agent_verdict', version:1, ...verdict}` after the last chunk, before the metadata frame. Existing two-arg callers are untouched.

## Implementation Notes

<!-- Agent-owned. Append-only during implementation. -->

- **The rendered-behavior fragment of AC-1 was resolved from the planning artifacts, not narrowed.** The activity line's UI is story 2.7's deliverable (backlog at dispatch time; the frontend carries no `agent-activity-line` handle — verified by grep). The epic context's cross-story dependency assigns the rendered line assertions to 2.7/2.8 ("2.9 pins the envelope for 2.7/2.8; the web/mobile activity lines assert rendered behavior through declared handles only"), so this story's rendered assertions are the degradation side: with the new frames riding, the legacy render is exactly unchanged (answer text, sources, warning token) and the `agent-activity-line` handle is pinned absent — which is also the handle 2.7's specs will pin present.
- **The endpoint gate constrains the unit spec.** `tests/config-validator/__tests__/e2e-stream-route.test.js` forbids the endpoint string in any spelling outside the defining module, so the route-pattern spec pins the DERIVATION (`STREAM_ROUTE` = `**${STREAM_PATH}**`), never the literal — the first validator run caught the literal, the fix is the relational assertion.
- **Mutation proofs run** (stream-route.spec.js): dropping the verdict frame turned 2 specs red (restored: 7 green); the degradation spec's coverage of the new frames rides on the helper unit spec — same `sseBody` bytes, one module, no runtime drift possible.
- **Venue evidence**: shared k3s stack (forge), edge `https://genieai-forge.local:4443` through `scripts/laptop-edge-relay.py 10.42.0.240 4443`, fixtures provisioned from the cluster secret. `chat-conversation.spec.js` (16) + `sse-contract.spec.js` (2): 18 passed; helper unit spec 7 passed; config-validator 674 passed, 0 failed. ESLint + Prettier clean on every changed file.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

## Verification

**Commands:**
- `cd tests/config-validator && npm test` -- expected: green (executed-set pin covers the new files).
- `npx playwright test tests/e2e/helpers/stream-route.spec.js --project=chromium` -- expected: green, no venue needed.
- `BASE_URL=<venue> npx playwright test tests/e2e/chatbot/sse-contract.spec.js tests/e2e/chatbot/chat-conversation.spec.js --project=chromium` -- expected: green (new specs + legacy five-type behavior).
