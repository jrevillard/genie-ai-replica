# Chat Conversation View — Design Spec V1

**Date**: 2026-10-23 · **Status**: frozen (the UX's full arbitration, applied to the DS)
**Scope**: the conversation view of the web frontend (`ChatBotComponent.vue`'s `v-else` branch)
**Reference**: the dashboard (the Living Intelligence welcome screen, MR !582) is the single
visual authority. The two earlier chat mockups are superseded; where they agreed with this spec,
they are followed, and where they disagreed this spec rules.

## Goal

The conversation reuses the dashboard's components, tokens and visual identity. No new visual
language. The answer becomes **one unified component**: text, collapsible sources, actions,
confidence, warnings. The loading, ungrounded, error and empty states are **first-level states**,
not afterthoughts.

## Non-goals

- **Knowledge Areas** (the left panel's list, search, `+`, per-category icons, the context
  banner): untouched this round.
- No tabs / multi-conversation model.
- No new global components.

## Decisions

### D1 — Confidence stays a percentage
"Confidence: 92 %" with the existing ⓘ-adjacent styling. No dots, no tier badges.

### D2 — Sources per answer, collapsible, inside the answer card
"Related sources (N)", open by default, collapsible. The data is already per message
(`chatqna` emits `metadata.source_documents` per turn; the frontend currently routes it to the
right panel). A card shows its own sources; an ungrounded answer shows **no** sources section.
The right panel keeps its conversation-wide accumulation.

### D3 — Thumbs on answers only
Feedback entry points exist only on assistant messages (`sender === 'bot'` — already gated).
Never on the user's questions (it would hang user-authored text off the analytics stream).
Inline per-message thumbs extend the existing feedback dialog (the dialog keeps the 1–5 scale,
the comment and the skin-tone selector; the inline row carries the thumbs and reflects the
already-rated state — `userFeedback` is already persisted by `query-service.js:772`).

### D4 — The states the mockups dropped stay, restyled to the DS
- **Grounding flag**: an amber warning integrated in the answer card, immediately after the
  content — explicit icon + "AI-generated — not based on library documents". Never a tooltip.
- **Offline**: a visible but compact indicator above the conversation, with an accessible
  explanation.
- **Unsaved changes**: the existing confirmations stay; a discrete header indicator may
  complement them, never replace them.

### D5 — One shared composer
The welcome and chat composers stay one component. One line at rest; the field grows while
typing without moving the functional controls. In the chat it floats over the wave, wider than
the welcome's 81 %.

### D6 — No fictitious controls
The composer's attach and mic buttons are **removed** until those features exist. No disabled
control with a "coming soon" tooltip ships in a public-sector UI.

### D7 — The wave decoration
The dashboard's wave asset, unmodified, limited to the lower part of the centre column, **fixed**
within the conversation container — it does not scroll with the messages. Slightly reduced
intensity to favour reading. Visible behind the composer, rising slightly on the sides.

### D8 — Panels stay flush columns
No floating cards. Full available height, as today.

### D9 — The answer card
Subtle elevation: the DS radius, a fine border, `--shadow-sm` (`--shadow-md` would be excessive
for a list of answers).

### D10 — The user bubble
The deployment's accent colour through the existing tokens; text contrast guaranteed. No fixed
blue.

### D11 — Avatars
- **User**: profile photo when available; otherwise initials in a coloured circle; a silhouette
  only when the name is unavailable too.
- **Assistant**: the official product icon, 36 × 36 px, in a rounded tile. Same image in light
  and dark, no recolouring.

### D12 — Wordmark
Continuous gradient, identical to the dashboard. In dark mode the same hues, lightened per the
existing tokens.

### D13 — The conversation header
A simple informative header, not a tab: the conversation title (or "Just Chat") + an explicit
close button. **× closes the conversation and returns to the welcome screen; it never deletes
saved history.** No extra "New chat" button beside the header — the composer's leading
new-chat control already exists.

### D14 — The streaming lifecycle
The answer card is created immediately with the assistant avatar. Before the first token: a
discrete animated indicator and "Thinking…". During the stream: progressive text with an
activity indicator. After completion: sources and actions appear. **No fake percentage
progress.**

### D15 — The error state
An explicit pictogram and message with a **Retry** action only if the application actually has
a retry mechanism (it does: the query can be re-submitted). The whole card is never coloured
red.

### D16 — The empty documents panel
A neutral pictogram, a short message, an explanation. The FAQs stay accessible. No large
decorative illustration, no useless button.

### D17 — The multiline composer
Auto-grow up to 5 lines, then internal textarea scroll. Anchored at the bottom of the centre
column. Actions stay reachable while typing. The conversation's scroll zone adjusts to the
composer's height. An adaptation of the shared composer, not a second one.

## Technical facts this spec rests on (verified against the code)

| fact | where |
|---|---|
| sources are already per message | `chatqna` `metadata.source_documents` per turn; `ChatBotComponent.vue` `onMetadata` stores the whole metadata on the message |
| `file_size` / `file_type` are absent from the stream; the doc-repository holds both and its detail route is `authenticateToken`-only | `metadataService.js:22`, `fileRoutes.js:9/:325` → fetch per render, no backend model change |
| `size: 0` hardcoded on both metadata paths; `formatFileSize` imported and never called | `ChatBotComponent.vue:1290/:1420`, `RightSideBarComponent.vue:100/:200` |
| the reload path drops the persisted metadata | `ChatBotComponent.vue:1434-1441` vs `chat-history-service.js:189-197/:321` |
| `userFeedback` is already persisted and admin-filterable | `query-service.js:772/:1037-1048` |
| `metadata.isSaved` already exists | `query-service.js:1225` |
| the timestamps bind the browser locale, not the app's | `:794-798` passes `[]` to `toLocaleTimeString` |
| the production labels render "unknown" (singular/plural mismatch) | `RightSideBarComponent.vue:377` |
| the author field is fetched then discarded | chatqna `:2542` |

The defects in that table (reload metadata drop, `size: 0`, the unused import, the label
mismatch, the timestamp locale) are **in scope**: they are the data half of the states this
spec renders.

## Acceptance criteria

1. The rendered conversation matches the designer's V1 sheet (image 24.png) at the visual
   fidelity gate: screenshot-vs-reference loop closes at every width and both themes, with the
   DOM audit (never a bare screenshot claim).
2. Every new e2e assertion is mutation-tested (break the code, watch it go red with the
   measurement, revert).
3. The app lays out and behaves identically with the Living Intelligence layer switched off
   (the layer stays additive).
4. All 14 locales carry every new string; nothing asserts a hardcoded locale.
5. The welcome screen's render does not move: the shared composer's adaptation is
   conversation-scoped (or welcome-neutral by construction).
