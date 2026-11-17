---
name: GENIE.AI Agent Activity Line
status: final
created: '2026-11-17'
updated: '2026-11-17'
topic: genie-ai agent activity line
sources:
  - '{planning_artifacts}/prds/prd-genie-ai-2026-11-16/prd.md'
  - '{planning_artifacts}/architecture/architecture-genie-ai-2026-11-16/ARCHITECTURE-SPINE.md'
---

# GENIE.AI Agent Activity Line — Experience Spine

> Iteration 1 of the agentic-foundations initiative: **one transient line** in the existing chat surfaces (web + mobile) that shows the agent's current operation while it works. Scope is deliberately light — PRD FR-30 requires a *status line*, no expandable tool detail, no raw reasoning. Paired with `DESIGN.md` (visual identity). Spines win on conflict with any mock or wireframe.

## Foundation

**Form factor.** Two surfaces, one behaviour: the **web chat** (Vue 3 SPA) and the **mobile chat** (Flutter). Both carry the same line, the same states, the same words. Mobile is not a port — it is the same contract rendered by the second client.

**UI system.** Both spines inherit the shipped GENIE.AI design system; iteration 1 adds no new system.

| | Web | Mobile |
|---|---|---|
| Tokens | `components/gov-chat-frontend/public/config/theme-variables.css` (runtime-served; `:root` :14, dark override :149) | `mobile/genie_ai_mobile/lib/design_system/tokens/app_tokens.dart` (`ThemeManager().tokens`, `isDark`) |
| Components | `src/components/ds/Spinner.vue`, `src/components/ds/StatusTag.vue` | `lib/design_system/components/ds_spinner.dart`, `DsSpacing`, `DsRadii` |
| Text | `var(--text-sm)` (12px, scales with `--font-scale`) | `tokens.textSm` (12 × `fontScale`) |
| i18n | `translate(key, fallback, named)` — `src/mixins/translateMixin.js:42` | `tr(key, args:)` — `lib/services/i18n_service.dart:253` |

`DESIGN.md` is the visual identity reference; this spine is the experience.

**Audience.** Public-sector end users, on the web and on a phone. The accessibility floor below is load-bearing, not decorative.

**Scope.** Iteration 1 only. The rich Telegram/OpenClaw-style display is iteration 2 — see *Forward compatibility*.

## Information Architecture

The line is bound to **one turn**, not to a surface. It appears above the answer, inside the answer's own container, and it disappears when the answer takes over.

| Slot | Web | Mobile | Content |
|---|---|---|---|
| Activity line | new row inside `.answer-card` (`ChatBotComponent.vue:148`), first child, sibling of `.message-bubble` (`:157`; convert the `v-else` to explicit `v-if`) | the in-flight row slot (`chatbot_component.dart:2468-2492`), the trailing ListView item after the streaming assistant message | operation label + state marker |
| Answer | `.message-bubble` (`:157`) | assistant message bubble | streamed answer text |
| Answer warning | `.answer-warning` (`:263` ungrounded, `:271` translation failed) | answer-level warning | the `agent_verdict` outcome |
| Answer error | `.answer-error` (`:149-156`) with Retry | error row | stream failure / interruption |

Two rules own the placement:

1. **The line never coexists with answer text.** It collapses on the first `chunk` and stays collapsed for the rest of the turn. The collapse is a **client-side state change** — nothing is deleted server-side, and no message is removed from the transcript.
2. **The legacy typing indicator is untouched on the legacy path.** A turn that never receives an `agent_activity` frame behaves exactly as today: web shows "Thinking…" while `msg.isStreaming && !msg.content` (`ChatBotComponent.vue:159-165`), mobile shows its "Thinking…"/"Generating…" row. On the agentic path the line takes over from the first `agent_activity` frame onward.

**Known gap this supersedes.** On the legacy path, mobile's indicator persists for the whole stream while web's disappears at the first chunk — the platforms differ today. The agentic path is identical on both (rule 1 above). The legacy difference is out of iteration 1's scope and is left as-is.

## Voice and Tone

Microcopy. Brand voice lives in `DESIGN.md.Brand & Style`; the chat's own posture is factual and personality-free.

| Do | Don't |
|---|---|
| "Searching knowledge…" | "Let me look that up for you! 🤖" |
| "Searched the knowledge base." | "Great news, I found 3 permits 🎉" |
| "Reading the source failed." | "Oops, something went wrong 😢" |
| "Working…" | "Thinking hard…" |
| Verb first, present progressive while running; past tense once completed; the failure names the step that failed. | First person, excuses, apologies, encouragement, emoji, exclamation marks, blame ("the database failed"), raw operation ids (`search_knowledge`), raw reasoning, server prose. |

Three rules:

- **Factual, no personality injection.** The line reports work in progress; it does not converse.
- **The state is a word, not a colour.** "failed" is in the sentence in every locale — the amber fill is reinforcement, never the message.
- **The words are identical on web and mobile.** Same key, same value, both platforms.

## Component Patterns

Behavioral. Visual specs live in `DESIGN.md.Components`.

| Component | Use | Behavioral rules |
|---|---|---|
| Agent activity line | chat turn | Bound to one turn. Visible while the turn is in the **agent phase** (an `agent_activity` frame has arrived and no answer text has). Collapses on the first `chunk` and never returns in that turn. Non-interactive: not focusable, no pointer target, no expanded state. |
| Operation row | inside the line | One row per operation the server reports, keyed by the operation name. Iteration 1 renders the **current** operation only: a `started` row replaces the previous one; a `completed`/`failed` row stays visible until the next `agent_activity` frame replaces it, or the turn ends. No timed auto-dismissal — a timer would be a second state machine and a11y noise. |
| Typing indicator (legacy) | chat turn | Unchanged on the legacy path. On the agentic path it is superseded by the line from the first `agent_activity` frame. |
| Answer warning | answer level | Carries the `agent_verdict` outcome. **The line never renders the verdict** — a verdict is a statement about the answer, not about a step. |
| Answer error | answer level | Carries a stream failure or an interruption, with the existing Retry action. The line collapses before it appears. |

### The event contract

From the architecture spine **AD-8** — the BFF owns the SSE contract; extensions are additive and versioned. The five existing event types (`chunk`, `metadata`, `translation`, `done`, `error`) are preserved verbatim; iteration 1 adds exactly two.

| Event | Payload | Meaning |
|---|---|---|
| `agent_activity` | operation name + lifecycle state (`started` \| `completed` \| `failed`) | One tool call's lifecycle. Frames **interleave with `chunk`s**. Carries the operation name from the registered toolset — **never raw model reasoning**. Iteration-1 invariant (spine AD-6): document-tool calls dispatch **serially** — no overlapping same-name calls, so the current-operation row is never ambiguous. |
| `agent_verdict` | grounding verdict (`grounded` \| `ungrounded` \| `unverified`, + a correction on failure) | Emitted **after the last `chunk`, before `metadata`**. Not rendered by the line. Projection truth table: `grounded` → no warning, `is_grounded:true`; `ungrounded` → the existing ungrounded-answer warning (`.answer-warning`), `is_grounded:false`; `unverified` (judge unavailable/timeout) → a **distinct neutral note** (new copy key `chatbot.agentActivity.verificationUnavailable`), `is_grounded:false` — **never** the ungrounded warning, which would falsely claim "not based on library documents". The verdict certifies the source-language text; a translated answer does not inherit it as a claim about the translation (spine AD-7). |

Unknown event types are ignored gracefully by both clients today: the web's switch has no default (`src/services/chatbotService.js:194-222`), and the mobile parser returns `null` for an unknown type (`lib/services/sse_parser.dart`, `_parseEvent`). A client that knows nothing about the agent path behaves exactly as it does today.

### Event → line state

| Frame | Line state | Rendered |
|---|---|---|
| `agent_activity` `started` (`search_knowledge`) | `running` | spinner + "Searching knowledge…" |
| `agent_activity` `completed` (`search_knowledge`) | `completed` | static dot + "Searched the knowledge base." |
| `agent_activity` `failed` (`read_source`) | `failed` | warning chip + "Reading the source failed." — the agent may keep working; the line continues |
| `agent_activity` `started` for an operation with no catalogue entry | `running` | spinner + the generic "Working…" |
| `chunk` | `collapsed` | line removed; the answer renders |
| `metadata` | `collapsed` | unchanged behaviour |
| `agent_verdict` | *not rendered* | drives the existing ungrounded warning (`.answer-warning`, `ChatBotComponent.vue:263`) |
| `done` | `collapsed` | line gone; the turn is closed |
| `error` | `collapsed` | the existing `.answer-error` + Retry (`:149-156`) |
| unknown type | *ignored* | no change |

### i18n

Namespace: **`chatbot.agentActivity.*`**, in the `chatbot` tree the chat surface already owns.

| Key | en value | Used for |
|---|---|---|
| `chatbot.agentActivity.working` | "Working…" | generic running state (operation with no catalogue entry) |
| `chatbot.agentActivity.stepCompleted` | "Step completed." | generic completed state |
| `chatbot.agentActivity.stepFailed` | "A step failed." | generic failed state |
| `chatbot.agentActivity.verificationUnavailable` | "Response verification could not be completed." | `unverified` verdict note (truth table above) — distinct from the ungrounded warning, which claims a different fact |
| `chatbot.agentActivity.operations.search_knowledge.running` | "Searching knowledge…" | per-operation running label |
| `chatbot.agentActivity.operations.search_knowledge.completed` | "Searched the knowledge base." | per-operation completed label |
| `chatbot.agentActivity.operations.search_knowledge.failed` | "Searching the knowledge base failed." | per-operation failed label |
| `chatbot.agentActivity.operations.read_source.running` | "Reading source…" | per-operation running label |
| `chatbot.agentActivity.operations.read_source.completed` | "Read the source." | per-operation completed label |
| `chatbot.agentActivity.operations.read_source.failed` | "Reading the source failed." | per-operation failed label |

The **operation name comes from the server** (the registered toolset) and selects the **template**; the template is localized client-side. The raw operation id is never shown to the user, and the server never sends a localized string.

**Delivery — web (hard gate).** Every key ships in all **14** locale files under `components/gov-chat-frontend/src/i18n/locales/` (`ar`, `bn`, `de`, `en`, `es`, `fr`, `id`, `man`, `pt`, `ru`, `st`, `sw`, `th`, `zh`). The gate is `src/__tests__/localeConsistency.test.js` — *"all locale files share the identical deep key set"* (:73-92): a leaf present in `en.js` and missing from any other locale fails the suite. Lookup is `translate('chatbot.agentActivity.operations.search_knowledge.running', 'Searching knowledge…')`; the mixin resolves the active locale, falls back to `en`, then to the supplied default — a missing key degrades to English, never to a blank. The catalogue's placeholder-parity check (:257) cannot bite: these templates carry **no** `{placeholder}`.

**Delivery — mobile (no gate).** The same keys ship in all **14** dart locale files under `mobile/genie_ai_mobile/lib/i18n/locales/`. Lookup is `tr('chatbot.agentActivity.operations.search_knowledge.running')`. Parity here is **by delivery and review, not by CI**: `I18nService.translate` falls back to the `en` tree when a key is missing (`lib/services/i18n_service.dart:212-218`) and returns the dotted key if nothing matches — so a missing mobile key shows English (or the key) in that locale without failing anything.

Active locales are a deployment choice on both platforms (web `VUE_APP_AVAILABLE_LOCALES`, mobile `KeycloakConfig.supportedLocaleCodes`), so the keys ship in **all** locale files regardless of the active subset. The Manx (`man`) locale needs a native reviewer for the new strings — an existing gap in the frontend's own notes.

## State Patterns

| State | Surface | Treatment |
|---|---|---|
| Request sent, no activity yet | chat turn | The legacy typing indicator, unchanged: web "Thinking…" (`ChatBotComponent.vue:159-165`), mobile "Thinking…"/"Generating…" (`chatbot_component.dart:2468-2492`). |
| First `agent_activity` arrives | chat turn | The line takes over from the legacy indicator for the rest of the turn. |
| Agent phase, operation running | chat turn | The line, `running` state. |
| Agent phase, operation completed | chat turn | The line, `completed` state, held until the next activity frame or the turn's end. |
| Agent phase, operation failed | chat turn | The line, `failed` state (warning family). The failure is **visible**, and the agent may continue — the next `started` frame replaces the row. |
| First answer chunk | chat turn | The line collapses (client-side). The answer renders. |
| Answer streaming | chat turn | No line. |
| `metadata` + `agent_verdict` | chat turn | No line. A non-grounded verdict renders the existing ungrounded warning (`.answer-warning`, `:263`) — an answer-level statement, never a line state. |
| `done` | chat turn | No line; the turn is closed. |
| `error` frame | chat turn | The line collapses; the existing `.answer-error` + Retry (`:149-156`). |
| Turn cancelled | chat turn | The line collapses immediately; the interrupted turn shows the error surface with Retry (the store's `markInterrupted` sets `isError`, `store/modules/conversation.js:34-42`). |
| Degraded / insufficient answer | chat turn | The line has collapsed; the outcome is carried by the answer-level warning. The line never says the answer is insufficient — it reports steps, not verdicts. |
| Unknown event type | chat turn | Ignored — no state change, no error, no log noise in the UI. |

**Interaction between the line and the answer.** The line is a *step* reporter. The verdict is an *answer* statement. They never appear in the same slot: the line is gone before the verdict arrives (AD-8 pins `agent_verdict` after the last `chunk`).

## Interaction Primitives

**None.** Iteration 1's line is not a control.

- Not focusable, not in the tab order, takes no pointer events.
- No expand, no collapse-by-click, no hover affordance, no menu, no retry.
- The only interaction in the turn remains the chat's own: send, and (web) stop. A failed *tool call* is not retried from the line — the answer is, through the existing Retry action on the error surface.

## Accessibility Floor

Behavioral. Visual contrast lives in `DESIGN.md.Colors`.

- **Live region.** The line container is `role="status"` + `aria-live="polite"` on web — the pattern the nav-status pill already uses (`NavBarComponent.vue:178-191`). Mobile wraps the line in `Semantics(liveRegion: true)`.
- **The marker is decorative.** `aria-hidden="true"` on the web marker (the nav dot is, `:190`); `ExcludeSemantics` on the mobile spinner. The text carries the state.
- **Never colour-only.** "failed" is a word in the label in every locale. The amber fill reinforces it; it never replaces it.
- **Polite, never assertive.** A state change announces through the polite region. Nothing interrupts a screen reader mid-answer, and nothing is announced twice for the same state (the region's text changes only when the state changes).
- **Reduced motion.** `prefers-reduced-motion: reduce` → the spinner stops rotating (`animation: none`, the `ds/Progress.vue:128-133` idiom) and keeps its static ring; mobile renders the static marker instead of the `DsSpinner` when `MediaQuery.disableAnimationsOf(context)` is true. The state stays legible with no motion at all.
- **Scale.** The label is `var(--text-sm)` / `tokens.textSm`, both of which scale with the user's font scale. The line does not fix a height.
- **Contrast.** Inherited — the running state is `--muted` on the card surface, the failed state is the `--warning-ink` / `--warning-bg` pair already in production use on `.answer-warning`. No new colour combination is introduced.
- **Focus and pointer.** The line never takes focus and never intercepts a click on the answer beneath it.

## Inspiration & Anti-patterns

- **Lifted from Telegram / OpenClaw** (operator's reference, 2026-11-17): the progressive activity display — the agent's work is visible while it happens, and the final message replaces it. Iteration 1 is the minimal subset of that pattern, on the same event stream.
- **Lifted from the existing chat surface:** the amber "a state, not an accusation" rule (`.answer-error` and `.answer-warning` are both amber, `ChatBotComponent.vue:3886-3918`); the `role="status"` live region of the nav-status pill; the saving indicator's structure — spinner + muted label (`ChatBotComponent.vue:526-529`, `:4660-4671`).
- **Rejected — the raw reasoning stream.** No thoughts, no chain-of-thought, no rationale (PRD FR-30: the operation name, not raw model reasoning).
- **Rejected — expandable tool detail.** Telegram's collapsible tool calls are iteration 2. Iteration 1 is a status line.
- **Rejected — persisting activity as messages.** The line is transient UI, not conversation content: nothing about it belongs in the saved transcript, and it must not be replayed when a conversation is restored.
- **Rejected — colour-coding the operations** (blue for search, green for read). In this product colour is reserved (amber = a state that needs attention); the operation is named by its words.

## Key Flows

### Flow 1 — The permit question (Marta Okafor, permit officer, a municipal administration office, Tuesday 10:12)

1. Marta asks a question that needs more than one step: *"Which of our 2025 building permits are still missing a fire inspection, and what does that hold up?"*
2. The turn opens. The legacy typing indicator shows until the first activity frame arrives; the line takes over from there.
3. `agent_activity` — `started`, `search_knowledge` → the line reads **"Searching knowledge…"**, spinner turning.
4. `agent_activity` — `completed`, `search_knowledge` → the line reads **"Searched the knowledge base."**, the spinner replaced by the static dot.
5. `agent_activity` — `started`, `read_source` → the line reads **"Reading source…"**.
6. `agent_activity` — `failed`, `read_source` → the line switches to the warning chip: **"Reading the source failed."** The failed step is visible; the agent is not stopped.
7. `agent_activity` — `started`, `read_source` (the next document) → the line reads **"Reading source…"** again. The failure was shown, and the work continued.
8. The first `chunk` arrives → the line collapses (client-side) and the answer text renders in the bubble.
9. `metadata` and `agent_verdict` land. The answer is grounded → no ungrounded warning.
10. **Climax:** Marta reads a grounded answer naming the permits and the consequence — and she knows what happened before it, because she watched the failed read while it happened. Her trust in the answer is calibrated by what she saw, not by a sentence in the answer claiming completeness.

Failure path: had the failed read left the answer unsupported, `agent_verdict` would carry the correction and the existing ungrounded warning would render (`.answer-warning`, `:263`). The line had already collapsed: the verdict is an answer-level statement, never a line state.

### Flow 2 — The cancelled request (Marta, same turn, 20 seconds later)

1. While the line reads "Reading source…", Marta stops the generation (web: `conversation/abortStream`; the store marks the turn interrupted → `isError`, `store/modules/conversation.js:409-419`).
2. The line collapses immediately. The aborted fetch rejects with an `AbortError` the service swallows (`chatbotService.js:233-237`).
3. The turn shows the existing error surface — "Unable to complete the response." with a **Retry** action (`.answer-error`, `ChatBotComponent.vue:149-156`).
4. **Climax:** the wait ends with an offer to try again — not with a spinner that never stops, and not with a line frozen on "Reading source…".

Mobile parity: mobile ships no stop affordance; the equivalent trigger is a new message superseding the in-flight stream (`chatbot_component.dart:1160`). The state outcome is identical — the line collapses, the answer surface carries the interruption.

## Forward compatibility (iteration 2)

The Telegram/OpenClaw pattern is the target. **Iteration 1 does not design it**; it only keeps the door open.

- **The contract does not move.** Same SSE dialect (AD-8): `agent_activity` keeps its payload (operation name + `started|completed|failed`), `agent_verdict` keeps its position (after the last `chunk`, before `metadata`), the five existing event types are untouched. Iteration 2 adds **rendering, not events**.
- **What grows.** The single row becomes a live-updating list of tool-call rows above the answer, each expandable with its arguments and result. The per-operation handle (`agent-activity-op-<operation>`) and the per-operation key path (`chatbot.agentActivity.operations.<operation>.*`) are already the shape iteration 2 needs — no renumbering, no new namespace.
- **What stays fixed.** No websocket (the traffic is one-way, server → client; SSE carries it). No raw reasoning. No server-side localized strings. The same operation vocabulary — the registered toolset (`search_knowledge`, `read_source`; the spine's Consistency Conventions record these as working names, versioned at contract acceptance).
- **The one rule iteration 2 may reverse.** If the activity list becomes persistent above the answer (Telegram edits the intermediate message in place), the "collapse at the first `chunk`" rule becomes "collapse at `done`". That is a rendering change on the same events — which is why iteration 1 must not persist anything.
- **What iteration 1 must not pre-empt.** No expandable affordance, no per-tool detail panel, no persisted activity messages, no second live region.

## Open questions

1. **Mid-answer activity — DECIDED (operator, 2026-11-17).** AD-8 lets `agent_activity` frames interleave with `chunk`s, and the transport stays that way. Iteration 1 clients render the line **before the first `chunk` only**; post-chunk activity frames (including failures) are accepted-but-unrendered — the graceful-ignore both parsers already perform. The agent loop is not constrained by this rendering rule. Iteration 2 renders post-chunk activity as the compact re-opened line. This is a documented iteration-1 limitation, not an open item.
2. **Handover timing — RECOMMENDATION logged (2026-11-17).** The legacy "Thinking…" indicator shows until the first `agent_activity` frame. Recommendation for the S4 agent service: emit an `agent_activity` frame immediately at run start, so the handover is seamless. Server-side change, recorded in BOTH memlogs (UX + architecture); not a UX blocker.
3. **Mobile locale parity has no gate.** Web parity is enforced by `localeConsistency.test.js`; mobile falls back to English silently (`i18n_service.dart:212-218`), so a missing mobile key ships unnoticed. Iteration 1 requires all 14 mobile locale files to carry the new keys, enforced by review only. Decide whether a mobile parity check is added (pre-existing gap, predates this spec; a widget-test gate is cheap and has precedent — `test/config/flutter_appauth_insecure_gate_test.dart`).
4. **Operation vocabulary.** The i18n catalogue keys are the server's operation names. The spine records `search_knowledge` and `read_source` as *working* names, versioned at contract acceptance — if the accepted contract renames them, the catalogue paths change with them.
