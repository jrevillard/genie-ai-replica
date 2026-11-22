---
title: 'Story 3.2 — Rollback continuity'
type: 'feature'
created: '2026-11-22'
status: 'in-progress'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: '96cea8779d0aae71e1d6a34166fb827878c3a9f3'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
---

<frozen-after-approval reason="human-owned intent — the issue #1973 acceptance criteria, operator-authored">

## Intent

**Problem:** The agentic path already persists same-shaped docs (AD-9/AD-12: `queries` per turn via the BFF, save path untouched), and the legacy read path serves agentic history verbatim — but the rollback contract (issue #1973) is neither proven nor fully honest. Three gaps: (1) an interrupted stream partial-saves as `isAnswered:true` with plain partial text — a truncated answer persists indistinguishable from a complete one (AD-11's "honest interrupted state" is unimplemented); (2) saved-conversation snapshot rows (`conversationFiles`) drop the okf-concept stable-id identity (`fileId = files/<concept_id>`, no `source` field), so a restored conversation's sidebar builds dead `/api/files/<concept_id>/download` URLs for concept citations — citation re-resolution (the AC's stable-id conventions incl. the `okf-concept` variant) silently breaks on the persisted surface; (3) agentic metadata carries `abstained:null` where legacy normalizes `false` — abstention analytics read agentic turns as "never answered". The in-flight treatment at flag-switch time is documented nowhere and tested nowhere.

**Approach:** Define the in-flight policy and make it true in code + tests: the routing flag is read once at module load (a rollback is a restart), the route is resolved once per request at entry, an in-flight stream completes on its resolved path across a rolling restart or dies into the existing disconnect treatment (abort upstream + partial-save) on a hard stop — and every partial save carries an explicit `answer_interrupted` metadata marker, on both paths (agent and legacy share the finalize). Runs that streamed nothing leave the at-start `isAnswered:false` doc untouched (honest "never answered"). Carry the okf-concept stable ids (`source:'okf-concept'`, `concept_id`, `repo_id`, `bundle_version` — the exact snake_case names `translateSources` reads) onto the `conversationFiles` snapshot rows so the restored sidebar resolves concepts through the existing conventions; normalize `abstained:false` on the agentic metadata base. Pin the whole scenario with tests: an agentic-created conversation (queries doc with agent metadata + okf citations, saved messages) renders via the legacy read path, re-resolves citations, and continues on the legacy pipeline; the legacy path requires no agent-specific state (AD-12). Document the policy in an ADR.

**Acceptance criteria (issue #1973, the contract):**
- Given an agentic conversation (queries docs, saved messages, citations) created while the flag was on, when the flag is turned off and the conversation continues on the legacy path, then history renders, citations re-resolve (stable-id conventions incl. the `okf-concept` variant), and new turns answer via the legacy pipeline without data loss or corruption.
- And in-flight treatment is defined and tested: requests mid-stream at switch time complete or interrupt per the documented policy; partial responses already streamed are handled honestly.
- And no agent-specific state is required by the legacy path (session state was in-request, AD-12).

## Boundaries & Constraints

**Always:**
- The flag stays module-load-frozen (`agent-routing.js` single-read invariant) — the policy documents that a rollback is a process restart, and the tests keep pinning the single-read invariant.
- Route resolved once per request at entry: rolling restart → in-flight completes on its resolved path; hard stop → connection close → the existing disconnect treatment (upstream abort + partial-save), now with the interrupted marker.
- `answer_interrupted: true` is an additive metadata field written only on partial saves (both the agentic disconnect path and the legacy relay's partial-save path — same finalize, same honesty); normal completions never carry it; no SSE event, no client-frame change.
- okf snapshot rows carry the stable ids under the exact names the frontend reads (`source`, `concept_id`, `repo_id`, `bundle_version`); re-resolution goes through the existing `translateSources`/okf-server conventions — no new endpoint, no new fetch.
- `abstained: false` on the agentic metadata base (an agentic insufficiency answer is an answer, not a legacy abstention).
- Write-time fixes only: existing persisted docs stay as they are; no migration, no backfill.
- The policy lands as `docs/adr/agentic-003-*.md`: flag semantics, route-at-entry, completion-vs-interruption, partial honesty (marker), no-output honesty (unanswered doc), AD-12 statement, and the known limitation that an agentic finalize persists `okfRoutedGraphs: []` (self-heals on the next legacy turn).

**Never:**
- No agent-service (Python) changes; no new SSE event types; no frontend rendering of the interrupted marker (the legacy restore ignores unknown metadata keys — rendering stays with the backlog stories that own those surfaces).
- No version-record/execution-attribution persistence for timed-out or crashed runs (story 2.11's surface, still backlog); this story only guarantees the states that already exist are honest.
- No per-conversation routing marker and no conversation-level flag: rollback continuity is a data-shape property, never a conversation attribute.
- No change to the legacy path's answering behavior when the flag is off (beyond the shared partial-save marker); the D02 regression pin holds — existing suites stay green unmodified.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Agentic history on legacy read | queries doc + messages created under flag on; flag off (restart); GET `/api/conversations/:id` | history renders; `grounding_status`/`agent_run` ride metadata verbatim, unread; no agent frames replayed | N/A |
| okf citation re-resolves after rollback | saved message whose `metadata.source_documents` row is okf-concept; sidebar + per-message sources | sidebar row resolves as okf-concept (type MD, empty url, okf open/download flows); no dead `/api/files/<concept_id>` URL | N/A |
| Stream interrupted with partial text | client disconnect or process stop mid-stream, `fullResponseText` non-empty | partial-save carries `answer_interrupted: true` + partial response + metadata so far; both paths | doc answered honestly, marker set |
| Interrupted with nothing streamed | disconnect before any text chunk | no partial save; at-start doc stays `isAnswered:false` (never answered) | nothing fabricated |
| New turn after rollback | flag off; legacy turn in an agentic-era conversation | legacy pipeline answers; queries doc same shape; `queryMessages` edge links on save | N/A |
| Abstention analytics consistency | any agentic turn finalize | metadata `abstained: false` (legacy-normalized vocabulary) | N/A |
| Legacy restore tolerance | restore maps a message with agentic metadata keys | render reads only the legacy fields (confidence_score, is_grounded, source_documents); extras ignored | N/A |

## Code Map

- `components/gov-chat-backend/services/agent-frame-writer.js` -- disconnect partial-save (:340-357) — add the marker to the metadata it passes `finalizeStreamQuery`; `assembleAgentMetadata` (:154-176) — set `abstained: false` on the base; `citationToSourceDocument` (:106-134) — reference for the okf row shape the save path already persists.
- `components/gov-chat-backend/routes/query-routes.js` -- legacy relay's close/disconnect partial-save (:388-392 area, the `res.on('close')` path) — same marker on its partial save.
- `components/gov-chat-backend/services/query-service.js` -- `finalizeStreamQuery` (:1095-1106, shared terminal — do NOT change its `isAnswered:true`; honesty rides the metadata), at-start persist (:648-668, `isAnswered:false`), `emptyStreamMetadata` base via `routes/query-routes.js:151-162`.
- `components/gov-chat-backend/services/chat-history-service.js` -- `addMessage` snapshot rows (:195-234, camelCase row shape) — carry `source`/`concept_id`/`repo_id`/`bundle_version` for okf rows; `getConversation` (:275-398) — read path, expect no change.
- `components/gov-chat-frontend/src/store/modules/conversation.js` -- `translateSources` (:239-276, reads `doc.source === 'okf-concept'`, `concept_id`, `repo_id`, `bundle_version` — snake_case only) — expect NO change once backend rows carry the names; `graftOkfIdentity*` (:286-316) stay for pre-existing docs.
- `components/gov-chat-frontend/src/components/ChatBotComponent.vue` -- restore path (:2749-2836, sidebar `translateSources(conversation.files)` :2791) — read-only reference.
- Tests: `__tests__/routes/agent-frame-writer.test.js` (disconnect suite :1023-1146), `__tests__/routes/query-routes.test.js` (disconnect :2234-2270; legacy partial-save), `__tests__/services/query-service.test.js` (3.1 routing suite :1975-2075), `__tests__/routes/chat-history-routes.test.js`, `__tests__/services/chat-history-service.test.js`, frontend `src/__tests__/components/ChatBotComponent.test.js` (#1817 describe :746-887), `src/__tests__/store/conversation.test.js`.
- `docs/adr/agentic-003-in-flight-treatment-and-rollback-continuity.md` -- NEW: the policy (format per `docs/adr/agentic-001-*`).

## Tasks & Acceptance

**Execution:**
- [x] `components/gov-chat-backend/services/agent-frame-writer.js` -- interrupted marker on the disconnect partial-save (metadata `answer_interrupted: true`); `abstained: false` on the assembled metadata base -- honest interrupted state + analytics vocabulary parity
- [x] `components/gov-chat-backend/routes/query-routes.js` -- the same marker on the legacy relay's partial-save branch -- the policy covers both paths, one finalize
- [x] `components/gov-chat-backend/services/chat-history-service.js` -- snapshot rows carry the okf stable ids (`source`, `concept_id`, `repo_id`, `bundle_version`) when the source_document row is okf-concept -- the persisted surface re-resolves after rollback
- [x] Backend tests -- interrupted marker (partial-text save carries it; no-text leaves the doc unanswered), legacy partial-save marker, okf snapshot-row identity (save with okf source_documents → rows carry the ids), agentic-history-on-legacy read (GET returns agentic metadata verbatim, render fields intact), new-legacy-turn-continues (flag-off routing suite extension), `abstained:false` pin, marker absent on normal completion -- every matrix row executable
- [x] Frontend tests -- restore of an agentic-shaped message (grounding_status/agent_run/okf rows) builds sources via the existing paths, sidebar resolves okf rows without dead URLs, extras ignored -- the AC's render + re-resolution half
- [x] `docs/adr/agentic-003-in-flight-treatment-and-rollback-continuity.md` -- the documented policy (status Proposed, binds FR-16/AD-9/AD-11/AD-12, story #1973)
- [x] `CHANGELOG.md` -- `[Unreleased]` / Fixed: interrupted partial-saves carry an honest marker; okf-concept citations resolve in restored conversations; agentic turns record legacy abstention vocabulary
- [ ] `_bmad-output/implementation-artifacts/stories/3-2-rollback-continuity.md` + `sprint-status.yaml` -- story to `in-review`, row `3-2-rollback-continuity` per the sync rule -- BMAD bookkeeping

**Acceptance Criteria:**
- Given an agentic conversation created under the flag (queries doc with agent metadata, saved message with okf-concept citations), when the flag is off and the conversation is loaded and continued, then the legacy GET serves the history (extras verbatim, render intact), the citations re-resolve through the stable-id conventions (sidebar included), and the new turn answers via the legacy pipeline with the same-shaped queries doc.
- Given the documented in-flight policy, when a switch interrupts a mid-stream request, then the behavior matches the policy — complete on the resolved path or die into the disconnect treatment — and every partial save is honest (`answer_interrupted: true` on partial text; nothing streamed leaves the unanswered doc).
- Given the legacy path after rollback, then no agent-specific state is required: restore and continuation read only legacy fields and collections, pinned by tests that strip/ignore the agent extras.

## Implementation Notes

<!-- Agent-owned. Append-only during implementation. -->

- 2026-11-22 (implementation): the Code Map predicted `getConversation` needs no change, but its AQL `RETURN` projects explicit fields — ids written by `addMessage` would never reach the sidebar without also being projected on the read path. The files query now projects `source`/`concept_id`/`repo_id`/`bundle_version` (null on legacy rows). Pinned by a new test that reads the projected AQL (mutation-checked red).
- 2026-11-22 (implementation): the happy-path pin in `agent-frame-writer.test.js` asserted `abstained` `null` — the agentic base change is the story's own behavior (analytics vocabulary parity), so that assertion now pins `false`; the legacy-path pins (`query-routes.test.js`) still pin `null` unmodified (the D02 regression pin holds: legacy partial-save metadata keeps `abstained: null`, gains only `answer_interrupted: true`).
- 2026-11-22 (verification): five mutations each turned the new assertions red (abstained base, agentic marker, legacy marker, snapshot identity spread, AQL projection); frontend translateSources okf-branch mutation turned the new store tests red. All mutations reverted (working-tree diff re-verified).
- 2026-11-22 (review round 1 — global: five findings, none important; all verified real and remedied):
  1. *Legacy end-without-completion-frame finalize was unmarked* — a chatqna stream ending cleanly after chunks but before the `done` frame finalized a truncated answer as complete, contradicting the CHANGELOG's unconditional claim. Fixed: that branch now marks `answer_interrupted` only when the done frame was never handled (race-safe against the async finalize reusing the metadata object), with a new covering test.
  2. *Mobile twin lacks the okf-concept citation branch* — pre-existing; filed as #2069 (`status::backlog`) per the frontend-fix→mobile-twin rule; no mobile code in this story.
  3. *Read-path AQL falsy-coerced `bundle_version` 0 to null* while the write side stores 0 verbatim. Fixed: null-safe conditional mirroring the write semantics; projection test pins the expression (mutation-checked red).
  4. *CHANGELOG/ADR overstated the hard-stop case* (no SIGTERM handler exists — a killed process runs no partial save at all). Fixed: both reworded — partial saves happen on a live process (client disconnect, upstream end-without-completion-frame); a hard stop leaves the unanswered document, which is §3's honest state.
  5. *Garbled test comment* (a sed replacement left an unterminated quote). Fixed.
- 2026-11-22 (review round 1 — FIX review on the correction diff, fresh context): corrections 1–4 and 7 verified clean (the end-without-done marker interleavings traced; the AQL null-safe read mirrors the write side; both new tests mutation-verified load-bearing). Four follow-up findings, all remedied:
  1. *The ADR's FR-29 traceability block still carried the hard-stop claim §1 had dropped* — reworded to the shutdown-window reality (internal contradiction removed).
  2. *The rolling-restart claim overcompleted* — the process's only shutdown handling is the observability flush (bounded window); an in-flight stream completes only inside it, otherwise ends unanswered like a hard stop. CHANGELOG + ADR §1 + the acceptance table reworded.
  3. *The end-branch `doneState.handled` guard was unpinned* — it only bites in relay mode (streaming translation on: `end` fires during the flush await after a done frame set `handled`; without the guard the marker leaks into that normal completion). New relay-mode test pins it; mutation-verified red without the guard, green with it.
  4. *"No client change" was one notch too strong* — on the end-without-completion-frame path the additive key rides the existing `metadata` frame to the connected client. CHANGELOG + ADR §2 reworded.
- 2026-11-22 (known pre-existing limitation, noted by the FIX review, out of this story's scope): on the truncation path, a client disconnect landing between the `end` event and the finalize (the translation-flush window) is dropped twice — close is disarmed by `handled`, and the terminal's `res.destroyed` guard skips the finalize — so that truncated answer persists nowhere (the doc stays honestly unanswered). Same shape before this change; the marker work did not touch it.
- 2026-11-22 (fix chain exhausted at F=3): the third FIX review verified both corrections accurate and found ONE remaining residual of the same doc-wording class — the Consequences "byte-identical" bullet lacked the anomaly-path carve-out. The reviewer's prescribed remedy was applied verbatim AFTER the cap, unreviewed (the no-further-review rule); the review_policy gate returned `park` (`fix_cap_without_clean`). Story parked with `status::awaiting-operator`; all suites green at park (backend 370+59, frontend 309, lint, prettier).

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

- R1-1 (query-routes.js end-without-done finalize unmarked) — verified real (read the `stream.on('end')` branch: `doHandleStreamDone` finalizes with plain `capturedMetadata`; the CHANGELOG claim made the inconsistency this story's problem) — patch (marker on the branch, done-guard race-safe) + covering test.
- R1-2 (mobile sidebar builds doc-repo URLs for okf rows) — verified real, pre-existing mobile gap (mobile builds `/api/files/<id>/view` with no okf awareness) — defer to filed issue #2069 `status::backlog` (frontend-fix→mobile-twin rule; mobile code out of this story's AC).
- R1-3 (AQL `bundle_version || null` coerces a pinned 0) — verified real (write side stores 0, read side nulled it) — patch (null-safe conditional) + projection-test pin.
- R1-4 (CHANGELOG/ADR claim a hard stop partial-saves; no shutdown handler exists) — verified real (only `unhandledRejection` is installed) — patch (docs reworded: hard stop leaves the unanswered doc).
- R1-5 (garbled comment from a sed replacement) — verified real — patch (quote closed).
- F1 (FIX review: ADR traceability block contradicts §1 on the hard stop) — verified real — patch (reworded).
- F2 (FIX review: rolling-restart claim overcompletes; only shutdown handling is the observability flush window) — verified real (tracing.js flush-then-exit) — patch (CHANGELOG + ADR §1 + acceptance table reworded).
- F3 (FIX review: the end-branch guard unpinned — relay-mode marker leak) — verified real (mutation: guard removal leaves non-relay suite green) — patch (relay-mode test, mutation-verified).
- F4 (FIX review: "no client change" too strong — additive key rides the metadata frame on one path) — verified real — patch (wording).
- F5 (FIX review: pre-existing truncation-window disconnect drops the truncated answer; doc stays honestly unanswered) — verified real, pre-existing, not introduced — noted in Implementation Notes (out of AC scope; cost/risk×frequency does not justify a fix here).
- F3b (FIX review 3: Consequences "byte-identical" bullet lacked the anomaly-path carve-out) — verified real, doc-only — remedy applied verbatim post-cap (unreviewed; fix chain exhausted at F) — parked, awaiting-operator.

## Verification

**Commands:**
- `cd components/gov-chat-backend && npx jest __tests__/routes/agent-frame-writer.test.js __tests__/routes/query-routes.test.js __tests__/services/query-service.test.js __tests__/services/chat-history-service.test.js __tests__/routes/chat-history-routes.test.js` -- expected: all green, including the new rollback-continuity tests
- `cd components/gov-chat-backend && npm test` -- expected: full backend suite green unmodified (the D02 regression pin)
- `cd components/gov-chat-frontend && npx jest src/__tests__/components/ChatBotComponent.test.js src/__tests__/store/conversation.test.js` -- expected: all green including the restore/okf-resolve tests
- `cd components/gov-chat-backend && rtk proxy npx eslint services/agent-frame-writer.js routes/query-routes.js services/chat-history-service.js __tests__/` -- expected: clean (frontend lint likewise for touched files)
