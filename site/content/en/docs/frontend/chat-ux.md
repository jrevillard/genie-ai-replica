---
title: "Chat UX"
description: "How the chat window streams a response, renders Markdown safely, surfaces confidence and grounding, captures feedback, and saves or exports the conversation."
weight: 5
mode: reference
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-10-26
---

> **For frontend developers.** The behaviour of `ChatBotComponent.vue` and its satellite dialogs: the streaming send, the confidence chip, the grounding warning, the feedback dialog, and save / export flows.

## Prerequisites

- Read [State Management](/docs/frontend/state-management-frontend/) — the auth module owns the access token used in the streaming request.
- Keycloak access token present (the chat window will not render the input until `currentUser` is truthy).
- The backend BFF exposes `POST /api/queries/stream` (SSE) and `POST /api/queries/{queryId}/feedback`. See [Backend API Contracts](/docs/reference/api-contracts/).

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

> The `confidence_score` is the reranker-confidence mean from the RAG pipeline ([Architecture → Confidence Scoring](/docs/architecture/architecture/#94-confidence-scoring)). It is **not** the LLM's self-reported confidence (the `[[CONF:NN]]` sentinel) — those are different signals; only the reranker score flows to the UI chip.

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
- Ratings aggregate into the admin analytics satisfaction tiles — see
  [API Contracts → Analytics routes](/docs/reference/api-contracts/#5-analytics-routes-apianalytics).

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
  "serviceLabels": ["Farming subsidies"],
  "category": "Utilities & Environment",
  "icon": "agriculture.svg"
}
```

`service` is the localized display name. `serviceLabels` are the **English
names the knowledge tree carries** (`nameEN`, as `GET
/api/service-categories/categories` publishes it) — the same spelling the
retriever filters on, so a slug like `agriculture` or `rural-development`
names nothing and breaks the card. `category` is the category's **English
name** (`nameEN`, from the same endpoint — the shipped configs use `Taxes &
Revenue`, `Identity & Civil Registration`, …): the spelling a deployment can
write down without reading the database, and the one a re-created hierarchy
keeps working with as long as it re-creates the categories under the same
English names. After a re-seed whose labels drifted, re-verify the cards'
health — a renamed category shows as an error card, never a silently
unscoped query. The hierarchy's own `catKey` is still accepted, for
configurations written before that spelling was adopted. A card
in the grid whose declared labels or category are not in the live hierarchy
renders with a danger icon and a caption naming the problem, and the click
sends nothing: the drift is visible, never a silently reduced scope. (The
composer entry is a send surface, not a grid tile: it refuses at send time,
with the same message the grid's caption carries.) The `serviceKey` of a card is its **`id`** when it declares one, its title otherwise — never one of its labels. That value is the identity of the card: a saved conversation carries it as the conversation tag. The restore resolves buttons **by id** on both platforms, so a card without an `id` does not have its scope reinstated on restore: the title tag is refused (a visible refusal, never a silently widened query) unless the title happens to be a live English label, in which case it replays as that label — give every scoped card an `id`. The labels a card declares are hierarchy data — they change when the hierarchy is reconfigured — and must not be part of an identity. Display, identity and filter are therefore three separate things: the card always shows its localized title, a saved conversation always carries the card's identity (`id`, or the title when no `id` is declared), and the filter always uses the English KB labels.

### Label drift: English on the wire, visible failure on drift

A card declares its filter in `serviceLabels` (English KB labels). The wire
speaks ENGLISH — the SSOT the corpus filters on:

- `context.serviceLabels` — the ENGLISH labels the selected items contribute.
  A Quick Help card contributes only the labels it declares. Its `id` is a
  configuration key, not a knowledge label; sending it as a filter narrowed
  the corpus to zero documents, and the LLM then answered with no context at
  all. A sidebar item contributes the **`nameEN`** the knowledge tree carries
  for it — the localized name is display-only and never filters.
- `context.categoryLabel` — the **`nameEN`** of the selected category. It is
  sent whenever the selection names a category that carries an EN
  translation, so a card that declares no label is still scoped by its
  category. It is `null` when the selection names no category (the "Just
  Chat" card) or when the entity carries no EN translation — a request with
  no category and no service label is legitimately unfiltered.
- A card that declares **no** label is allowed. Its `action.hiddenPrompt`
  already scopes the answer, so the client does not block it with "No context
  filter active" — blocking it would make the button do nothing.

**A broken card is a visible failure.** The client validates every declared
label and the card's category against the live tree. A label the hierarchy no
longer carries — or a category that is gone — renders the card with a danger
icon and a caption naming the problem, in the user's language, and the click
sends nothing. The card never sends a silently reduced scope, and the query
is never answered outside the scope the card promised.

**The cards need the hierarchy to be checked.** They are rendered once the
hierarchy load has settled: a card carries a scope, and the hierarchy is what
names it, so a card rendered before the hierarchy is known cannot say whether
its scope is valid. A hierarchy that **failed** to load breaks every card that
**declares a scope**, with a caption of its own — no scope can be verified, so
no such card can be used. A card that declares **no** scope (the "just chat"
entry) promises nothing the hierarchy could deny, and stays usable. A category
the hierarchy carries **without an EN translation** is a broken scope too: the
wire speaks ENGLISH, and a category with no English name has no filterable
label at all.

When the scope is intact but matches no document anyway (chunks ingested
before a rename), the query abstains: chatqna's abstention instructions state
that no documented information was found. The remedy is operational — update
the configuration, re-ingest the corpus.

## Deployment order: the backend speaks first

The web client reads the hierarchy's ENGLISH spelling (`nameEN`) and has no
fallback to the localized `name`: the fallback would put a localized label on
the wire, which matches no chunk. Deploy the **backend first**, then the
clients.

A client released against a backend that does not yet publish `nameEN` sees
every scoped card as broken (a visible caption, no query) — a loud, honest
failure, not a silent mis-scope. The mobile app goes further: it fetches the
hierarchy with `locale: 'en'`, where the response's `name` IS the English
translation, so it tolerates a pre-`nameEN` backend (the fallback applies
only when the `nameEN` key is ABSENT — an entity that carries an empty
`nameEN` is a real missing translation and stays unnameable).

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
- [Backend API Contracts](/docs/reference/api-contracts/) — `/api/queries/stream` and `/api/queries/{id}/feedback` payloads.
- [RAG Generation](/docs/rag-pipeline/generation/) — how the backend produces `confidence_score` and `is_grounded`.
