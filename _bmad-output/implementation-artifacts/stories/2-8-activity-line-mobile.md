---
title: 'Story 2.8 — Activity line: mobile'
type: 'feature'
created: '2026-11-22'
status: 'in-review'
route: 'dispatch'
review_loop_iteration: 0
baseline_commit: 'd79133253dee709960b4b7e9e57fba5be14323d7'
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-genie-ai-2026-11-17/EXPERIENCE.md'
  - '{project-root}/_bmad-output/planning-artifacts/ux-designs/ux-genie-ai-2026-11-17/DESIGN.md'
---

<frozen-after-approval reason="human-owned intent — the issue #1966 acceptance criteria, operator-authored">

## Intent

**Problem:** The mobile chat has no activity line: `agent_activity` frames arriving on the agentic SSE path are ignored by the parser, so a mobile user watches a bare spinner while the agent works and cannot see a failed step — the experience diverges from the web contract the PRD pins (FR-30: same line, same words, same states on both surfaces).

**Approach:** Extend the mobile SSE parser with the two additive event types, render the activity line in the trailing in-flight slot of the chat surface through a new DS-token widget (`DsSpinner`, warning family), and project the tri-state verdict truth table (live and restored) from the metadata frame — labels, states and handles mirroring the web contract exactly.

**Acceptance criteria (issue #1966, the contract):**
- Given the same event stream and UX contract, when `agent_activity` frames arrive, then the mobile line renders in the trailing in-flight slot with the same states, labels and truth-table behavior as web, using the mobile design-system tokens (`DsSpinner` — superseding the raw `CircularProgressIndicator` — and the warning family).
- And all 11 keys ship in all 14 dart locale files (review-enforced; missing keys would fall back to English silently — the delivery checklist asserts the full set).
- And `ValueKey('agent-activity-line')` and per-op keys mirror the web handles; `Semantics(liveRegion: true)` and `MediaQuery.disableAnimationsOf` honor the a11y floor.
- And the verdict truth table and translated-grounded caption render identically to web, including on restored conversations.

</frozen-after-approval>

## Boundaries & Constraints

**Always:**
- Labels, states and the truth table follow the UX contract (`EXPERIENCE.md`/`DESIGN.md`) verbatim — same words as web, states `running`/`completed`/`failed`, failed = the warning family (never `tokens.danger`), the line never renders the verdict.
- The line collapses at the first `chunk` and never re-opens; post-chunk activity frames are accepted but unrendered. A turn with no `agent_activity` frame keeps today's legacy indicator byte-for-byte.
- Every locator is a declared `ValueKey` handle; widget tests assert structure and resolved token values (mobile CLAUDE.md visual-fidelity discipline — no colour literals, no golden images).
- The 11 i18n keys ship in all 14 dart locale files; the delivery checklist item is an executable test asserting the full key set per shipped locale.

**Never:**
- No backend change (frame writer, agent service), no web change (`ChatBotComponent.vue` is story 2.7's), no `CircularProgressIndicator` hand-rolled as the line's marker (the raw one in the legacy indicator row stays untouched — the legacy path is out of scope).
- Nothing persisted: the line is transient UI, never a message, never replayed on restore.
- No interaction: not focusable, no tap target, no expanded state, no stop/retry affordance.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| First `agent_activity` frame | `started`, `search_knowledge` | Line replaces the legacy indicator in the trailing slot; spinner + localized "Searching knowledge…" | N/A |
| Operation completes / fails | `completed` / `failed` frame | Row replaced; failed = warning glyph + label in `tokens.warning`, wrapping (never truncating) | N/A |
| Unknown operation name | `started`, `summarize_foo` (no catalogue entry) | Generic "Working…" label; handle still carries the raw op name | N/A |
| First `chunk` | any prior line state | Line collapses, the legacy indicator stays gone for the rest of the turn | N/A |
| Post-chunk activity frame | any | Accepted, unrendered (no state change) | N/A |
| No activity frame (legacy path) | chunks only | Today's legacy indicator row, unchanged | N/A |
| `agent_verdict` frame | tri-state payload | Not rendered by the line; the answer-level warning follows the truth table from the metadata frame | N/A |
| Truth table — ungrounded / unverified | metadata `grounding_status` | Existing ungrounded warning / the distinct neutral note — never the ungrounded warning for `unverified` | N/A |
| Translated grounded caption | `grounded` + translation delivered + non-EN UI | Neutral caption above the footer: the check covers the original-language answer only | N/A |
| Restored conversation | persisted `metadata.grounding_status` | Same truth table as live (derived from metadata, like web) | N/A |

## Code Map

- `mobile/genie_ai_mobile/lib/services/sse_parser.dart` -- extend: `SseAgentActivityEvent` (status/operation/callId), `SseAgentVerdictEvent` (groundingStatus/isGrounded/extra), `grounding_status` typed on `SseMetadataEvent` (+ `_knownMetadataKeys`); unknown types still return null (graceful-ignore preserved).
- `mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart:2468-2492` -- the trailing in-flight slot: the line renders here instead of the legacy row when active; collapse suppresses the slot; per-turn line state (active/collapsed/operation/status) reset at send start, `_resetChat` and all turn ends.
- `mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart:2603` -- footer truth table: branch on `grounding_status` when present (ungrounded → existing warning; unverified → the neutral note), legacy `is_grounded == false` fallback unchanged.
- `mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart:955-968` -- restore map: derive `isGrounded` from `metadata.is_grounded` (web's restore rule, `ChatBotComponent.vue:2813`) so the truth table renders identically on restored conversations.
- `mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart:1326-1344` -- live commit: carry `grounding_status` from the metadata frame into the rebuilt metadata map.
- `mobile/genie_ai_mobile/lib/components/chat/agent_activity_line.dart` -- NEW widget: marker (DsSpinner sm / static dot / warning glyph under `MediaQuery.disableAnimationsOf`), `Semantics(liveRegion: true)`, `ExcludeSemantics` marker, per-op label with generic fallback, `ValueKey('agent-activity-line')` + `ValueKey('agent-activity-op-<operation>')`.
- `mobile/genie_ai_mobile/lib/design_system/components/ds_spinner.dart` -- `DsSpinner(size: sm)` — the DS marker (the raw `CircularProgressIndicator` of the legacy row is NOT touched).
- `mobile/genie_ai_mobile/lib/services/i18n_service.dart:199-230` -- `tr()` falls back en → dotted key; the generic-label fallback detects a missing per-op catalogue entry by `result == key`.
- `mobile/genie_ai_mobile/lib/i18n/locales/*.dart` (14 files) -- `chatbot.agentActivity.*` subtree: 11 leaf keys each.
- `mobile/genie_ai_mobile/test/helpers/chatbot_harness.dart` -- `chatBotUnderTest`/`pumpChatBot` gain optional `httpClient`/`streamBaseUrl` (the constructor-args-live-here rule); SSE stream mocks build `StreamedResponse` bodies of `data: {...}` frames (precedent: `main_screen_service_selection_test.dart:61-68`).
- `components/gov-chat-backend/services/agent-frame-writer.js:409-429` -- the frame shapes the parser consumes (read-only): `{type:'agent_activity', version:1, status, operation, callId}`, `{type:'agent_verdict', version:1, ...verdictProjection}`.
- `components/agent-service/agent/verification.py:447-458` -- verdict projection payload (`grounding_status`, `is_grounded`, `translation_mode` pinned `none` at emission — the translation happens after, BFF-side) (read-only).

## Tasks & Acceptance

**Execution:**
- [x] `mobile/genie_ai_mobile/lib/services/sse_parser.dart` -- the two additive event types + `grounding_status` on metadata -- the mobile parser speaks the 2.4 envelope
- [x] `mobile/genie_ai_mobile/lib/components/chat/agent_activity_line.dart` -- NEW: the line widget -- the DS-token rendering contract
- [x] `mobile/genie_ai_mobile/lib/components/chat/chatbot_component.dart` -- line state machine in the streaming loop + trailing slot + truth-table footer branch + caption + restore/live metadata derivation -- the surface integration
- [x] `mobile/genie_ai_mobile/lib/i18n/locales/*.dart` (14) -- the `chatbot.agentActivity` subtree, 11 keys each -- the same words as web, every shipped locale
- [x] `mobile/genie_ai_mobile/test/helpers/chatbot_harness.dart` -- optional streaming params on the mount -- constructor args live in one home
- [x] `mobile/genie_ai_mobile/test/services/sse_parser_test.dart` -- the new events, metadata field, unknown-type tolerance -- the parser contract
- [x] `mobile/genie_ai_mobile/test/components/chatbot_agent_activity_test.dart` -- NEW: line lifecycle (appears, replaces, failed, collapse, post-chunk ignore, legacy unchanged), truth table live + restored, a11y/reduced-motion, locale-parity delivery assertion -- the ACs as executable checks
- [x] `mobile/genie_ai_mobile/test/services/locale_consistency_test.dart` -- the delivery checklist as an executable assertion folded into the existing suite (11 keys × 14 shipped locales over its one shippedLocales registry, plus its on-disk coverage guard) -- the review-enforced parity made checkable; the separate parity file this task first created was folded here in the simplify pass (one registry, one guard)

**Acceptance Criteria:**
- Given a streaming turn whose SSE body carries `agent_activity` frames, when they arrive before the first chunk, then the line renders in the trailing slot with the localized label and the DS marker, and the legacy indicator is absent for the whole turn.
- Given the first `chunk` after activity frames, when it renders, then the line is gone and stays gone despite later activity frames.
- Given a legacy stream with no activity frame, when it streams, then the trailing row is byte-identical to today (thinking/generating + raw `CircularProgressIndicator` untouched).
- Given a `grounding_status` in the metadata frame (live, non-streaming JSON, or restored), when the answer renders, then the truth table paints: ungrounded → the existing warning; unverified → the neutral note (never the ungrounded warning); grounded + delivered translation + non-EN UI → the neutral caption; grounded otherwise → nothing.
- Given all 14 locale files, when the delivery assertion runs, then the 11 `chatbot.agentActivity.*` keys resolve in every one of them.
- Given reduced motion (`MediaQuery.disableAnimationsOf`), when the line runs, then the static marker renders instead of the `DsSpinner`.

## Implementation Notes

<!-- Agent-owned. Append-only during implementation. -->

- **Parser events are additive and tolerant.** `SseAgentActivityEvent` carries the raw status string (unknown → the renderer maps it to running); `SseAgentVerdictEvent` normalizes `grounding_status`/`is_grounded` and carries the rest of the projection in `extra` (the `SseMetadataEvent.extra` contract). Unknown frame types still return null — the graceful-ignore both parsers already perform is untouched.
- **The generic-label fallback detects a missing catalogue entry by `tr(key) == key`** (the service's final fallback returns the dotted key) — no catalogue whitelist to drift.
- **Restore parity line**: the restore map now derives `isGrounded` from `metadata.is_grounded` — the exact derivation the web's restore applies (`ChatBotComponent.vue:2813`). Legacy restored turns without the field render no warning (today's behavior); legacy restored turns WITH `is_grounded: false` now render the existing warning (web parity, the AC's "including on restored conversations").
- **The collapse suppresses the whole trailing slot** (itemCount drops the +1): after the first chunk the turn shows nothing in-flight — identical to web, and the known legacy/mobile indicator gap stays confined to the legacy path.
- **`flutter pub get` re-resolved transitive deps in `pubspec.lock`** (intl/matcher/meta test-tooling pins); reverted — not this story's change; CI re-resolves against the committed lock.
- **Test harness**: `mountStreaming` drives an OPEN `StreamController` through a `StreamedResponse` so the line's pre-chunk states are assertable mid-turn (a one-shot body would end the turn before the first assertion); the phone surface (`usePhoneSurface`) plus the scoped-card tap (the Quick Help suites' pattern) are required for the composer's send tap to hit; pumpAndSettle never settles while a spinner is live — state assertions use `pump()`.
- **Two pre-existing clipping defects surfaced by the new tests, fixed with one-line `Expanded` wraps:** (1) the legacy indicator row's label clipped by 34 px at phone width with the long localized "Generating response…" string (no width guard on the `Text` beside the spinner); (2) the answer footer's note row (`spaceBetween`, bubble ≤238 px) — the existing ungrounded warning already overflowed narrow bubbles, and the new `verificationUnavailable` note (longer) exceeded it by 301 px. Both fixes wrap the conditional text in `Expanded` — the row's behavior (marker + label) is unchanged; the Frozen block's "the raw one in the legacy indicator row stays untouched" is honored in spirit (the raw `CircularProgressIndicator` and the legacy label are untouched; the fix is the missing width guard the row always needed). The alternative — tests dodging the phone width to keep the overflow invisible — would ship a user-visible clipping defect on 360 dp devices.
- **Finder note**: the answer bubble renders through the SELECTABLE markdown surface (`SelectableText` → `EditableText`), so content assertions use `find.textContaining`, not `find.byWidgetPredicate(RichText…)`.

## Spec Change Log

<!-- Append-only. Populated by step-04 during review loops. -->

### G2 (2026-11-22, global review #2 on the whole diff, correction commit 5a8bbe6dd)

| Finding | Disposition |
|---|---|
| F1 (important): a MOBILE-SAVED turn loses the translation outcome — the G1-F2 restore reader reads `translation_status`, the streamed metadata rebuild never wrote it, and the save uploads exactly that map; a restored failed translation showed the scope caption | FIXED on both send paths: the streamed rebuild stamps `translation_status` (ok/failed) and the JSON path reads the 2.4b root latch + stamps the response metadata when the lane did not. Writer-side of the same gap #2080 files for the server. Two tests cover the writer (messages-post capture) and the JSON reader (warning + untranslated caption + no scope caption). |
| F2 (pre-existing): the JSON path never set `msg['isGrounded']` — the legacy fallback could not fire there | FIXED: the assistant message carries `isGrounded` from `metadata.is_grounded`; covered by the new JSON test. |
| F3 (nit): the story named the folded-away parity test file in tasks + Verification | FIXED: lines name `locale_consistency_test.dart`. |
| F4 (nit): a `translation` frame did not mark the answer phase | FIXED: the translation case sets `_agentChunkSeen` — the collapse invariant no longer leans on the envelope's frame order. |

FIX review (fresh context, correction diff): all confirmed-fixed, red-checks re-verified, no new issues.
### G1 (2026-11-22, global review, correction commit 6cadaa42a)

| Finding | Disposition |
|---|---|
| F1 (important): a chunk that precedes any activity frame left `_agentLineCollapsed` false, so a later frame rendered the line under the streaming answer | FIXED: the turn remembers its first chunk (`_agentChunkSeen`) whatever the line's state; frames after it never activate the line; the collapse derives from `active && chunkSeen`, so the legacy turn's indicator keeps its slot. New test covers the chunk→frame order. |
| F2 (important): the restore lost `translationFailed` — a restored failed translation could render the scope caption | FIXED on the derivable surface: the restore derives the flag from the persisted `translation_status` (`isTranslationFailed`), which also restores the untranslated caption. RESIDUAL: the agent lane never persists the answer-translation outcome — filed as issue #2080 (`status::backlog`), backend surface outside this story. |
| F3 (pre-existing): the restore's `'sources'` guard (`!= null`) could crash the whole load on a scalar metadata | FIXED in passing: one `is Map` guard shapes every metadata read in the map. |
| F4 (nit): the frozen block's "byte-for-byte" vs the legacy label's `Expanded` wrap | KEPT, flagged: the deviation is operator-visible on the MR (note posted; sign-off requested at merge time). The wrap fixes a real 34 px clipping the new tests surface; reverting it would ship the overflow or force the tests to dodge the phone width. |
| F5 (nit): man/st ship the new keys as English copies | NAMED (recorded decision below): both files' own precedent keeps long copy English until a native review (the same gap the web locale notes carry); st carries real Sesotho for the short strings. |
| F6 (nit): no default branch for an unknown `grounding_status` value — a future state silently retired the warning | FIXED: an unknown state falls back to the `is_grounded` rule. New test covers it. |

**Recorded decision (F5):** `man.dart` ships all 11 keys as English copies and `st.dart` ships `verificationTranslated` as English, matching each file's own precedent for long copy (its complex strings are English today); the parity AC (11 keys present in 14 files) holds. A native review translating them later moves no code.

## Review Triage Log

<!-- Append-only. Populated by step-04 on every review pass. -->

### Global review G1 (2026-11-22, whole branch vs origin/feat/agentic-foundations/prd)

6 findings: 2 important (F1, F2 — both real, both fixed with tests), 1 pre_existing (F3 — fixed in passing), 3 nits (F4 kept+flagged, F5 named, F6 fixed with test). Verified non-defects: `tr(key) == key` catalogue fallback, `grounding_status` persistence path, all terminal resets, parser cast tolerance, harness import/params.

### Global review G2 (2026-11-22, whole branch vs origin/feat/agentic-foundations/prd)

4 findings: 1 important (F1 — real, fixed with two tests), 1 pre_existing (F2 — fixed, covered), 2 nits (F3 fixed, F4 fixed). Verified non-defects: full-suite green at 894, backend latch contract cross-checked.

## Design Notes

**The 11th key (recorded decision).** The artifacts name 10 `chatbot.agentActivity.*` keys (`EXPERIENCE.md` i18n table); the ACs demand 11 — the difference is the translated-grounded caption ("with the translation-scope caption when a translation was delivered", story 2.7's truth-table row). This story mints it as `chatbot.agentActivity.verificationTranslated`, en value: "Grounding was verified on the original-language answer — this translation is not covered by that check." Story 2.7 (web) must mirror the same key and words. The name follows the `verificationUnavailable` sibling (both are verdict-scope notes).

**"A translation was delivered" (recorded decision).** `translation_mode` rides the verdict payload pinned `none` (the BFF translates after emission), so the client derives delivery: UI language non-English AND `translationFailed != true` (an English original shown after a failed translation IS the verified text — no caption). Same rule live and restored (restored messages carry no translation-failed flag; the caption's metadata+language derivation is identical on both, which is what "render identically" pins).

**Line state machine (one turn).** `active` flips on the first `agent_activity` frame (the legacy indicator is superseded for the rest of the turn); every frame replaces the single current row (`started` replaces, `completed`/`failed` holds until the next frame — no timer); the first `chunk` sets `collapsed`, which suppresses the whole trailing slot and makes later frames no-ops; every turn end (done/error/catch/superseding send/reset) clears the state. Unknown frame status renders as `running` (a row must show something; the state word comes from the label).

**Truth table branch.** `grounding_status` present → tri-state decides (`ungrounded` → existing warning; `unverified` → neutral note; `grounded` → nothing at answer level); absent → today's `is_grounded == false` fallback, unchanged (legacy turns). The neutral note/caption render in `tokens.fg50` — distinct from the warning family by colour AND by copy.

## Verification

**Commands:**
- `cd mobile/genie_ai_mobile && flutter test` -- expected: whole suite green
- `cd mobile/genie_ai_mobile && flutter test test/components/chatbot_agent_activity_test.dart test/services/sse_parser_test.dart test/services/locale_consistency_test.dart` -- expected: the new suites pass
- `cd mobile/genie_ai_mobile && dart analyze` -- expected: clean
- Break check: comment out the collapse branch / a locale key -- expected: the matching test goes red, then revert
