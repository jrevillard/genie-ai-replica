---
title: "Chat UX"
description: "How the chat window streams a response, renders Markdown safely, surfaces confidence and grounding, captures feedback, and saves or exports the conversation."
weight: 5
mode: reference
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

> **For frontend developers.** The behaviour of `ChatBotComponent.vue` and its satellite dialogs: the streaming send, the confidence chip, the grounding warning, the feedback dialog, and save / export flows.

## Prerequisites

- Read [State Management](/docs/frontend/state-management-frontend/) — the auth module owns the access token used in the streaming request.
- Keycloak access token present (the chat window will not render the input until `currentUser` is truthy).
- The backend BFF exposes `POST /api/queries/stream` (SSE) and `POST /api/queries/{queryId}/feedback`. See [Backend API Contracts](/docs/backend/api-contracts-backend/).

## Chat window anatomy

`src/components/ChatBotComponent.vue` is the main chat surface. From top to bottom:

| Region | Element | Notes |
|--------|---------|-------|
| Header | Toolbar — New chat (Plus), Save, Export, Send | Triggers `startNewChat`, `saveChatToHistory`, `openExportDialog`, `sendMessage`. |
| Message list | Per-message bubbles — sender (`user` / `bot`), timestamp, optional confidence/grounding chip + feedback button | Bot bubbles render Markdown via `renderMarkdown()` (see [Markdown rendering](#markdown-rendering-and-sanitisation)). |
| Streaming indicator | Inline `DsSpinner size="sm"` + `chatbot.thinking` text | Shown while `msg.isStreaming && !msg.content`. |
| Status pill | `chatbot.online` / `chatbot.offline` + last response time | Updates after each completed response. |
| Context pills | Selected service-tree items injected as a filter | Emit `treeNodeSelected` from `ServiceTreePanelComponent`. |
| Input area | Multiline text area + send button | Not bound to `isStreaming` for `disabled`. Pressing Enter (with or without Shift) sends the message — `DsInput.vue` `@keyup.enter` fires on any Enter, no `shiftKey` check; Shift+Enter does NOT insert a newline. |
| Quick-help overlay | Shown when `showQuickHelp && selectedContextItems.length === 0` | Cards for common questions; click sends the prompt. |

The message list scrolls automatically: a `messagesEnd` ref is mutated whenever the messages array changes. Manually scrolled-up content stays put until the user scrolls back to the bottom (no auto-jank on long histories).

## Streaming send

The send path is `input → chatbotService.submitQueryStream() → POST /api/queries/stream` (SSE) and back. The service uses `fetch` directly (axios cannot stream), creates an `AbortController`, and dispatches each `data:` SSE frame to a typed callback.

```javascript
// chatbotService.submitQueryStream signature
submitQueryStream(queryData, { onChunk, onMetadata, onTranslation, onDone, onError }) → AbortController

// Caller (ChatBotComponent)
this.streamController = chatbotService.submitQueryStream(
  { message: text, context: this.selectedContextItems, conversationId: this.currentChatId },
  {
    onChunk: (content) => { /* append to last bot message */ },
    onMetadata: (meta) => { /* confidence + is_grounded */ },
    onTranslation: (content) => { /* streaming translation in target locale */ },
    onDone: (data) => { /* finalize + persist */ },
    onError: (err) => { /* show toast, mark message failed */ }
  }
);
```

### Behaviour during the stream

| Event | Frame `type` | UI effect |
|-------|-------------|-----------|
| First token arrives | `chunk` | Spinner → text. Message marked `isStreaming = true`. |
| Intermediate tokens | `chunk` | Append to `messages[i].content`. Re-render Markdown. |
| Streaming translation (if enabled) | `translation` | Updates the translation pane / replaces the displayed locale. |
| Metadata arrives | `metadata` | Sets `confidenceScore` and `isGrounded` on the message. Triggers the confidence chip or grounding flag. |
| Heartbeat / keepalive | `: keepalive` (line starts with `:`) | Ignored by the parser. |
| Stream ends cleanly | `done` | `isStreaming = false`. Saves final content + metadata. |
| Stream errors | `error` | Toast + marks the message as failed. Allows retry. |

### Cancellation: starting a new send

When the user submits a new message while a stream is in flight, `ChatBotComponent` calls `this.streamController.abort()` before opening the new stream. The previous fetch fails with `AbortError`; the service's catch branch suppresses it (`if (error.name === 'AbortError') return;`) — only the new stream's events drive the UI.

### Markdown rendering and sanitisation

Bot messages render Markdown to HTML and pipe through DOMPurify:

```javascript
// ChatBotComponent.vue (~line 696)
renderMarkdown(content) {
  if (!content) return '';
  const html = marked.parse(content);
  return DOMPurify.sanitize(html);
}
```

Two customisations matter:

1. **Tight-list renderer override** — GFM lists are emitted as `<li><p>label</p><ul>...</ul></li>` which produces double-spaced output. `ChatBotComponent` injects a custom `tightListRenderer` (via `marked.use({ renderer })`) so nested bullets render compact.
2. **HTML sanitisation** — `DOMPurify.sanitize` strips `<script>`, inline event handlers, and `javascript:` URLs before the HTML is inserted via `v-html`. User messages are never rendered as Markdown — they are shown as plain text only.

> The combination means: even a prompt-injected response from the LLM cannot reach the page as raw HTML.

## Confidence chip and grounding flag

Backend metadata arrives on the `metadata` SSE frame and is attached to the last bot message. The UI renders **one of three states**:

| Backend `metadata.is_grounded` | Backend `confidence_score` | UI |
|-------------------------------|---------------------------|-----|
| `true` (or omitted) | non-null number | Brain icon + `Confidence: NN%` chip |
| `true` (or omitted) | `null` | No chip |
| `false` | any | Sparkles icon + `chatbot.aiGeneratedNoDocs` ("AI-generated — not based on library documents") |
| Any | Any | Feedback button always visible |

The chip and the grounding flag are mutually exclusive (`v-if / v-else-if`). The Sparkles warning is the visible signal that the answer was synthesised from the LLM's general knowledge rather than retrieved from the knowledge base — important for public-sector deployments where hallucination risk must be flagged.

> The `confidence_score` is the reranker-confidence mean from the RAG pipeline ([Architecture → Confidence](/docs/architecture/architecture/#confidence-score)). It is **not** the LLM's self-reported confidence (the `[[CONF:NN]]` sentinel) — those are different signals; only the reranker score flows to the UI chip.

### How to interpret

- **High confidence (≥ 80 %)** — typically a strong match in the knowledge base.
- **Low confidence (≤ 40 %)** — answer is likely correct in form but weakly grounded. Don't trust without domain expertise.
- **Not grounded** — treat as a general-LLM answer, regardless of how confident it sounds.

The chip is informational, not actionable. The user can always click the feedback button to rate the response and improve future ranking.

## Feedback dialog

`ChatResponseFeedbackDialog.vue` opens per bot message when the user clicks the feedback button. Two columns:

| Left column | Right column |
|-------------|-------------|
| Thumbs up / down (with skin-tone selector) | 1–5 rating scale (i18n labels) |
| Message preview (read-only) | Free-text comment field |

### Behaviour

- The user must select **either** a thumb **or** a rating before submitting — both are optional individually, but at least one is required (the Submit button is disabled otherwise).
- The skin-tone selector (`thumbFeedback === 'up' ? skinToneColor : 'none'`) draws from a small palette stored on the component. Selection is NOT persisted across sessions — it lives on the dialog instance only.
- Comments are sanitised before submission (no HTML, length capped server-side).
- On submit: `chatbotService.submitFeedback(queryId, { thumb, rating, comment })` — `POST /api/queries/{queryId}/feedback`. On success, the dialog closes and a toast appears. On failure, an inline error stays in the dialog.
- Ratings aggregate into the admin analytics satisfaction tiles — see [Dashboards](/docs/observe/dashboards/).

## Save / export / new-chat flows

All three flows live inside `ChatBotComponent.vue` and share the same confirmation primitives.

### Save chat

| Step | Behaviour |
|------|-----------|
| 1. User clicks Save | Opens `saveChatDialog` — title input + folder `<DsCombobox>` (existing folders + new-folder inline). |
| 2. Submit | `chatHistoryService.createConversation(...)` → `chatHistory.ADD_CHAT` mutation → plugin writes `localStorage`. The new chat id is set as `currentChatId`. |
| 3. Already in a chat? | Save updates the existing record (`UPDATE_CHAT`) instead of creating a duplicate. |

The default folder is `default` (`All Chats`); selecting a different folder triggers `addChatToFolder` and updates the sidebar selection.

### Export

| Step | Behaviour |
|------|-----------|
| 1. User clicks Export | Opens `exportDialog` — currently PDF only. |
| 2. Format | `new jsPDF()` with a custom Markdown → PDF parser. The parser walks the `marked` lexer tokens (line ~1604: `const tokens = marked.lexer(markdown)`) and renders paragraphs, headings, lists, and code blocks with manual page-break logic. |
| 3. Filename | `chat-{shortId}-{YYYY-MM-DD}.pdf`. The blob is offered as a download. |

The Markdown → PDF converter handles only the LLM-emitted subset (paragraphs, lists, code, headings). Tables are flattened; embedded images are skipped. This is intentional — the export is meant for archiving a conversation, not a high-fidelity print.

### New chat + load chat confirmations

Switching chats (or starting a new one) when the current chat has unsaved changes triggers `ConfirmDialog`:

| Dialog | Title | Options |
|--------|-------|---------|
| New chat while unsaved | "You have unsaved changes" | **Save & continue** / **Discard** / **Cancel** |
| Load another chat while unsaved | "You have unsaved changes" | **Save & switch** / **Discard & switch** / **Cancel** |
| Quick-help overlay replaces nothing | — | No prompt. |
| Dismissing a chat with feedback pending | "Submit feedback first?" | **Submit** / **Discard** / **Cancel** |

> The unsaved-state heuristic is purely client-side: any text in the input area that hasn't been sent yet, **or** any change to context pills that hasn't been persisted. There is no formal "draft" flag — the heuristic is conservative (false positives are cheap; false negatives lose work).

## Quick-help overlay

The overlay appears on a fresh `currentChatId` (no prior messages) **and** when no context items are selected. The cards come from `config.features.chat.quickHelp.buttons` in the runtime config loaded by `main.js` (`ChatBotComponent.vue:706-744`), not from the backend. Display text and prompt text are resolved per locale via `resolveConfigText(...)`.

A card click has two effects:

1. The card's `title` populates the input area as a "prefilled prompt" (still requires the user to send). Title is resolved per locale.
2. The card's `action.hiddenPrompt` is the actual LLM-facing prompt — `action.visibleText` is the friendly hint shown to the user; `hiddenPrompt` can be richer and is sent in the `queryData` payload.

```
Card config (each entry in config.features.chat.quickHelp.buttons):
{
  "id": "agriculture.subsidies",
  "title": "How do I apply for a farming subsidy?",
  "action": {
    "visibleText": "How do I apply for a farming subsidy?",
    "hiddenPrompt": "Explain the eligibility criteria, required documents, and processing time for the agriculture subsidy programme for smallholder farmers."
  },
  "service": "Agriculture",
  "serviceKey": "agriculture",
  "serviceLabels": ["agriculture", "subsidies", "rural-development"],
  "category": "agriculture",
  "icon": "agriculture.svg"
}
```

`service` is the localized display name; `serviceKey` / `serviceLabels` are the English KB labels used as the retriever filter. Display and filter are decoupled so the button always shows its localized title while the filter always uses English KB labels.

## Accessibility

| Element | Treatment |
|---------|-----------|
| Message list | `aria-live="polite"` — screen readers announce new bot tokens as they stream. |
| Streaming indicator | `aria-busy="true"` while `isStreaming`. Cleared when content arrives. |
| Input area | `aria-label` from `chatbot.inputPlaceholder`. Disabled state announces via `aria-disabled`. |
| Feedback button | `aria-label` from `feedback.button` translation. Selected state via `aria-pressed`. |
| Context pills | Each pill is a `<button>` with `aria-label` describing the category + a remove control. |
| Quick-help cards | `<button>` elements, focusable in tab order, keyboard activation on Enter / Space. |

The skin-tone selector on the feedback dialog is keyboard-operable via click; each swatch has an `aria-label` like "Skin tone 1", "Skin tone 2", etc. (hardcoded in `ChatResponseFeedbackDialog.vue:87`, not i18n).

## Failure modes & troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| Stream starts but no tokens appear | Backend returned 200 with empty body, or the SSE parser skipped all frames. | Check DevTools Network → the `/queries/stream` request. If `text/event-stream` is missing, the backend is misconfigured. |
| Stream cuts off mid-response | Network blip, server restart, or the user's tab went to sleep. | The message stays in `isStreaming=true` state with partial content. The user can click retry (re-sends the prompt). |
| Token expired mid-stream | The `Authorization: Bearer` header was rejected after rotation. | `httpService` 401 interceptor should re-auth; verify the silent-renew callback is registered (`store/modules/auth.js:37-53`). |
| Confidence chip missing | Backend never sent the `metadata` frame, or sent `confidence_score: null`. | Inspect the SSE frames; both are valid (chip is gated on `confidenceScore != null && isGrounded !== false`). |
| Grounding flag stays after a fix | The bot message's `isGrounded` is sticky once metadata arrives. | Re-send the message — each response carries fresh metadata. |
| PDF export is empty | The chat history has no `marked.parse`-able content (e.g. only user messages). | Export requires at least one bot message; user-only chats are skipped with a toast. |
| Feedback submit 400s | Backend `feedback` validator rejected the payload (rating out of range, comment too long). | Server-side validator; trim comment and re-submit. |

## Related

- [State Management](/docs/frontend/state-management-frontend/) — `chatHistory` module that owns conversations and folder CRUD.
- [UI Component Inventory](/docs/frontend/ui-component-inventory-frontend/) — full list of chat-related components.
- [Sidebar & Navigation](/docs/frontend/sidebar-and-navigation/) — left-side conversation list, right-side related documents.
- [Backend API Contracts](/docs/backend/api-contracts-backend/) — `/api/queries/stream` and `/api/queries/{id}/feedback` payloads.
- [RAG Generation](/docs/rag-pipeline/generation.md) — how the backend produces `confidence_score` and `is_grounded`.
