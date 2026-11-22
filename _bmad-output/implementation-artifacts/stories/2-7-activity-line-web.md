---
title: 'Story 2.7 — Activity line (web)'
type: 'feature'
created: '2026-11-22'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '016041d7467fc84d48bac2621e7f7db7b791ca72'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — the issue #1965 acceptance criteria, operator-authored">

## Intent

**Problem:** On the agentic answer path the web chat gives the user no sign of what the agent is doing between sending a question and the first answer chunk, and no surfacing of the tri-state verification verdict the BFF already streams.

**Approach:** Render the new `agent_activity` SSE frames as one transient status line — the first child of `.answer-card`, replacing the typing indicator — with states running/completed/failed, collapsing at the first `chunk`; render the `agent_verdict` truth table at answer level (`grounded` → nothing but a translation-scope caption when a translation was delivered; `ungrounded` → the existing warning; `unverified` → a distinct neutral note). Ship all 11 `chatbot.agentActivity.*` keys in all 14 web locales behind the `localeConsistency` gate.

## Boundaries & Constraints

**Always:**
- The line renders ONLY before the first `chunk` of a turn; the collapse is a client latch — post-chunk `agent_activity` frames are accepted (parsed, no error) but never rendered, and the line never re-opens in that turn.
- Failed state uses the warning family (`--warning-bg`/`--warning-ink`) — never `--danger` — and the failed label wraps instead of truncating; running/completed stay quiet (`--muted`).
- Accessibility: container `role="status"` + `aria-live="polite"`; marker decorative (`aria-hidden`); state carried by the word in every locale; reduced-motion stops the spinner animation, scoped to the line's own styles (DsSpinner untouched globally).
- Handles: `data-testid="agent-activity-line"` on the container, `data-testid="agent-activity-op-<operation>"` on the operation row (this component's existing single-dash spelling). The line is non-interactive: no tabindex, no handlers, nothing persisted (transcript and sessionStorage carry no activity state).
- Legacy path unchanged: a turn with no `agent_activity` frame behaves exactly as today (typing indicator, warnings).

**Never:**
- No change to the five existing SSE event semantics, the BFF frame writer, or the agent-service — the web consumes the frames as pinned by story 2.9's envelope.
- No expandable tool detail, no per-op history list (iteration 1 renders the current operation only), no persisted activity messages, no second live region.
- No rendering of the verdict BY the line — verdict surfacing is answer-level.
- No mobile work (story 2.8), no new npm dependency.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First activity frame | `agent_activity {status:'started', operation:'search_knowledge'}` before any chunk | Line visible, spinner + localized running label, legacy typing indicator hidden | N/A |
| Completed frame | `{status:'completed', operation:'search_knowledge'}` | Static dot + completed label, still pre-chunk | N/A |
| Failed frame | `{status:'failed', operation:'read_source'}` | Warning chip (warning family), failed label (wraps); next `started` replaces it | N/A |
| Unknown operation | `{status:'started', operation:'other_tool'}` or `operation:null` | Generic `working` label; per-op handle omitted when operation null | N/A |
| Collapse | first `chunk` after the line is visible | Line removed for the rest of the turn; later activity frames parsed but unrendered | N/A |
| No activity frames | legacy/quiet turn | Typing indicator unchanged; line never appears | N/A |
| Verdict grounded, no translation | `agent_verdict {grounding_status:'grounded', translation_mode:'none'}` | No warning, no note | N/A |
| Verdict grounded + translated | `translation_mode` other than `none` | Translation-scope caption under the answer | N/A |
| Verdict unverified | metadata `grounding_status:'unverified'` | Distinct neutral note; the ungrounded warning must NOT render | N/A |
| Verdict ungrounded | metadata `is_grounded:false`, status `ungrounded` | Existing `.answer-warning` unchanged | N/A |
| Abort / error / done | `error` frame, stop button, `done` | Line collapsed (immediately on abort); existing terminal surfaces unchanged | N/A |

</frozen-after-approval>

## Code Map

- `components/gov-chat-frontend/src/components/ChatBotComponent.vue` — `.answer-card` :148; `.answer-error` :149-156; `.message-bubble` :157-169 (v-if chain `msg.isError` → error, `v-else` bubble; typing indicator inside bubble :158-165, `v-if="msg.isStreaming && !msg.content"`); ungrounded warning :263-268 (`msg.isGrounded === false`); translation-failed :271-279; saving-indicator idiom :526-529 + styles :4660-4675; amber styles :3886-3926; `.animate-spin` :3647-3653; msg creation :2592-2601; history rehydrate reads `msg.metadata?.is_grounded` :2813. `data-testid` spelling throughout.
- `components/gov-chat-frontend/src/services/chatbotService.js` — `processChunk` switch :194-222 (five cases; unknown types fall through silently — additive cases are safe); AbortError swallowed :235.
- `components/gov-chat-frontend/src/store/modules/conversation.js` — `setLastBotMetadata` :100-109 (copies whole metadata object → replaces msg.metadata; runs AFTER the verdict frame); `setLastBotProperty` generic mutation; `setTranslation` :110; `markInterrupted` :140-142; `sendStream` callbacks :323-372; `abortStream` :409-419; `persistConversation` :587-595 serializes the WHOLE module state — a new root key must be excluded; rehydrate only reads `openId`/`conversations`.
- `components/gov-chat-backend/services/agent-frame-writer.js` — READ-ONLY reference: `agent_activity` frames :414-432 `{type,version:1,status:'started'|'completed',operation:<name|null>,callId}` (no `failed` producer exists today — the web state machine still implements it per spec); `agent_verdict` :344-358 (after last chunk flush, before metadata), verdict payload relayed verbatim (includes `translation_mode`, always `'none'` from the BFF today — the live-delivery annotation is story 2.10's contract).
- `components/gov-chat-backend/services/agent-run-contract.js` — `assembleAgentMetadata` :196-230: agent-path metadata frame carries `grounding_status` (verdict value, or `'unverified'` when no verdict) — the client's unverified signal; legacy metadata has no `grounding_status`.
- `components/gov-chat-frontend/src/i18n/locales/*.js` — 14 files (ar,bn,de,en,es,fr,id,man,pt,ru,st,sw,th,zh); `chatbot` namespace en.js :1306; gate `src/__tests__/localeConsistency.test.js` :73-90.
- `tests/e2e/chatbot/sse-contract.spec.js` + `tests/e2e/helpers/chatbot.js` (`mockChatStream` :502) — story 2.9's envelope: frame shapes + `NO_ACTIVITY_LINE` assertions (:35,:78,:105) to flip/extend.
- `src/__tests__/components/ChatBotComponent.test.js`, `src/__tests__/services/chatbotService.test.js`, `src/__tests__/store/` — test homes.
- `src/components/ds/Spinner.vue` — `size="sm"`; reuse as-is.

## Tasks & Acceptance

**Execution:**
- [x] `components/gov-chat-frontend/src/services/chatbotService.js` -- add `agent_activity`/`agent_verdict` cases to the parser switch, forwarding to optional `onAgentActivity`/`onAgentVerdict` callbacks -- the frames reach the app without touching the five legacy cases
- [x] `components/gov-chat-frontend/src/store/modules/conversation.js` -- turn-scoped `agentActivity` root state (`visible/operation/status/collapsed`), mutations (frame / collapse-at-first-chunk latch / reset on new send + done + fail + abort), `sendStream` wiring (new callbacks; `translationMode` stored on the bot msg from the verdict payload), exclusion of the new root key from `persistConversation` -- state machine + nothing-persisted guarantee
- [x] `components/gov-chat-frontend/src/components/ChatBotComponent.vue` -- the line as first child of `.answer-card` (bubble's `v-else` → explicit `v-if="!msg.isError"`); typing indicator hidden once the line is visible; label resolution (per-op template, generic fallback); failed chip (warning family, wrapping label); `role="status"`+`aria-live="polite"`+decorative marker; reduced-motion scoped CSS; unverified neutral note + translation-scope caption at answer level; ungrounded warning now excludes the unverified case -- the rendered contract
- [x] `components/gov-chat-frontend/src/i18n/locales/*.js` (all 14) -- the 11 `chatbot.agentActivity.*` keys (working, stepCompleted, stepFailed, verificationUnavailable, verificationTranslationScope, operations.search_knowledge.{running,completed,failed}, operations.read_source.{running,completed,failed}) -- the hard delivery gate
- [x] `components/gov-chat-frontend/src/__tests__/` -- component tests (states, collapse latch, verdict truth table, a11y attrs, handles, legacy-path invariance), service parser tests (new cases + unknown-type fallthrough), store tests (latch, reset paths, persistence exclusion) -- the matrix as executable checks
- [x] `tests/e2e/chatbot/sse-contract.spec.js` (+ helpers if needed) -- flip the `NO_ACTIVITY_LINE` degradation assertions where the mock carries activity frames into render/collapse assertions through the declared handles; add pre-chunk activity + post-chunk acceptance cases -- story 2.9's envelope pins the rendered behavior

**Acceptance Criteria:**
- Given `agent_activity` frames arrive before the first chunk, when the turn renders, then the line is the first child of `.answer-card` with the typing indicator replaced, states running/completed/failed per the spec (failed = warning family, wrapping label, never `--danger`), `role="status"` + `aria-live="polite"`, decorative marker, reduced-motion honored, handles `agent-activity-line` / `agent-activity-op-<operation>`.
- Given the first `chunk`, when any further `agent_activity` frame arrives, then the line stays collapsed and the frame is accepted but unrendered.
- Given `agent_verdict`, when the answer renders, then grounded → no warning (translation-scope caption only when `translation_mode` ≠ `none`), ungrounded → the existing ungrounded warning, unverified → the distinct neutral note `chatbot.agentActivity.verificationUnavailable` and never the ungrounded warning.
- Given the 14 locale files, when `localeConsistency.test.js` runs, then all 11 keys ship in every file and the suite passes.
- Given a legacy turn (no `agent_activity` frame), when the answer streams, then behavior is byte-for-byte today's (typing indicator, warnings, transcript).

## Implementation Notes

<!-- Agent-owned. Append-only during implementation. -->

- **The line is gated on `msg.isStreaming` in addition to `agentActivity.visible`.** The activity state is module-level (turn-scoped), so without the gate every historical answer card in the transcript would repeat the live region while a turn streamed — a second (and third…) live region, which the Never-list forbids. The store's terminal resets (done/fail/abort) already bound the state to the turn; the component gate is the render-side twin. Proven by the "exactly ONE live region" component assertion.
- **The latch fires in the `sendStream` `onChunk` wiring, not inside `appendChunk`.** `appendChunk` is the legacy chunk mutation and stays byte-identical in behavior; the collapse is the agent turn's addition and lives beside it (`appendChunk` + `collapseAgentActivity`, the mutation idempotent from the second chunk on). Legacy invariance is then structural, and the wiring is proven by a store test driven through the real action's captured callbacks.
- **The staged-stream e2e needed an interception outside `page.route`** — a single-body mock processes activity+chunk inside one read, so the pre-chunk render never paints. `mockStagedChatStream` (helpers/chatbot.js) wraps `window.fetch` in an init script and hands the body over a `ReadableStream` the spec drives stage by stage (`stagedSend`); the app's own fetch + SSE parsing path runs, each stage's rendered assertion gates the next send, and no fixed waits exist. The endpoint literal travels as the init script's argument — the e2e-stream-route gate forbids the string outside stream-route.js (the first validator run caught it).
- **The e2e collapse-side flips are honest about what a one-body mock can see:** the two story-2.9 degradation tests now pin the collapse contract's END state (latch closed at the first chunk, nothing re-opened, no handle after done); the RENDER side lives in the staged spec.
- **Mutation proofs run:** dropping the unverified guard turned the truth-table suite red (1 failed; restored: 13 passed); removing `visible=false` from the latch turned 3 specs red (restored: 31 passed); deleting one locale key turned the deep-key-set gate red (restored: 10 passed).
- **Verification:** frontend `npm test` 157 suites / 4608 tests green (localeConsistency's 11×14 gate included); `eslint src/` clean (one pre-existing `vue/no-v-html` warning, untouched file); frontend + e2e Prettier clean; e2e tree ESLint clean; config-validator 674 passed / 0 failed; offline e2e specs (stream-route 11, chatbot helpers 25) green. `npx playwright test tests/e2e/chatbot/sse-contract.spec.js` NOT run — no stack is available in this environment; per the spec's own verification note, the unit suites carry the contract here, and the staged spec's determinism rests on the helper unit specs plus the venue run being required before merge.
- **Incident, self-inflicted and repaired:** a mutation-proof revert used `git checkout --` on ChatBotComponent.vue and wiped the story's component edits; they were re-applied in full from the working notes and re-verified (full suite + lint + prettier green). A locale repair in the same session briefly deleted two pre-existing `okf.*.working` keys in zh.js (a `str.replace` matching three occurrences); both restored, `git diff` re-read story-only, locale gate green.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

## Design Notes

**State machine (turn-scoped, store root — not under `conversations`, stripped from persistence).** `{visible, operation, status, collapsed}`: `agent_activity` frame → if `collapsed`, ignore; else `visible=true` + set op/status (`started`→running, `completed`→completed, `failed`→failed, anything else → running). First `chunk` → `collapsed=true, visible=false`. Reset on new send, `finishStream`, `failStream`, `markInterrupted`. The msg object never carries activity state (nothing persisted, nothing replayed).

**Label resolution.** `operation` present and status mapped → `chatbot.agentActivity.operations.<operation>.<running|completed|failed>`; otherwise state-generic `working`/`stepCompleted`/`stepFailed`. `translate()` falls back to en then the supplied default — a missing catalogue entry degrades, never blanks.

**Verdict projection (client side).** The verdict frame arrives before `metadata`; `setLastBotMetadata` later replaces `msg.metadata`, so the caption signal cannot live in metadata from the verdict frame: store `translation_mode` as `msg.translationMode` from the verdict frame (SSE), and read `msg.metadata.grounding_status` (set by `assembleAgentMetadata` on the metadata frame) for the tri-state. Ungrounded warning condition gains one guard: `msg.metadata?.grounding_status !== 'unverified'` — legacy metadata carries no `grounding_status`, so the legacy warning is untouched. Caption condition: `msg.metadata?.grounding_status === 'grounded'` AND `(msg.translationMode ?? msg.metadata?.translation_mode ?? 'none') !== 'none'` — with the BFF relaying `'none'` today, the caption is contract-ready and lights up when the live-delivery annotation lands (2.10). Non-streaming JSON path: the note renders from metadata the same way; the caption reads `metadata.translation_mode` when present.

**Failed chip = the `.answer-warning` recipe** (`padding: var(--space-xs) var(--space-sm)`, `var(--radius-sm)`, `--warning-bg`/`--warning-ink`); running/completed = the saving-indicator recipe (`--muted` label). Marker: `DsSpinner size="sm"` while running, static dot (nav-status pill idiom) when completed, `AlertTriangle` glyph (aria-hidden) when failed. Reduced motion: `@media (prefers-reduced-motion: reduce)` → `:deep` spinner animation `none`, inside the line's own scoped style.

## Verification

**Commands:**
- `cd components/gov-chat-frontend && npm test` -- expected: all suites green, including `localeConsistency.test.js` (11 keys × 14 locales) and the new component/service/store tests
- `cd components/gov-chat-frontend && npx eslint src/` -- expected: clean (use `rtk proxy` for the real result)
- `npx playwright test tests/e2e/chatbot/sse-contract.spec.js` -- expected: green against a local stack per `tests/e2e/run/run-local-e2e.sh`; when no stack is available, state so and rely on the unit suites
