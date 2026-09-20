---
title: "Chat Pipeline"
description: "Mobile chat UX: SSE event flow, per-message feedback, Quick Help overlay, PDF export, conversation management."
weight: 5
section: "mobile"
mode: reference
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

## Overview

The chat surface is the GENIE.AI mobile app's main user-facing feature. This document describes what the user sees and how it is wired — from sending a message to receiving a streamed RAG answer, leaving feedback, exporting to PDF, or asking Quick Help to bootstrap a query. It complements [Mobile Architecture](/docs/mobile/mobile-architecture/) (which covers the wiring of `SseParser` and `AuthInterceptor`) and [User Authentication](/docs/mobile/user-authentication/) (which covers the Bearer-token plumbing on every chat call).

## Prerequisites

| Requirement | Why |
|-------------|-----|
| Authenticated session | Every chat call goes through `AuthInterceptor` (Bearer token) |
| Backend reachable at `${backendUrl}` | The `POST /api/queries/stream` endpoint |
| Observability stack (optional) | Trace the chat pipeline via VictoriaTraces — see [Observability — Tracing](/docs/observe/tracing/) |

## 1. Endpoints

The chat uses two endpoints on the backend. Both are mounted in `components/gov-chat-backend/routes/query-routes.js`:

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/queries/stream` | POST | SSE streaming RAG response |
| `/api/queries/` | POST | Non-streaming fallback (single JSON response) |

The mobile app **always tries the streaming endpoint first**. It falls back to `/api/queries/` only when `AuthInterceptor` is not wired (a defensive code path used in tests; production builds always use streaming).

For full request/response shapes and error codes, see [API Contracts (backend)](/docs/backend/api-contracts-backend/).

## 2. SSE event taxonomy

`SseParser` (`lib/services/sse_parser.dart`) chunks the text/event-stream from `/api/queries/stream` into five typed events. Each is a Dart class with the `type` field verified verbatim:

| Event class | `type` JSON field | Payload | When the backend emits it |
|-------------|-------------------|---------|---------------------------|
| `SseChunkEvent` | `chunk` | `content: string` | Incremental LLM token — drives the typewriter animation |
| `SseMetadataEvent` | `metadata` | `sourceDocuments: [...], confidenceScore: number, isGrounded: bool, responseTime?: number` | After retrieval completes — drives the Related Documents sidebar |
| `SseTranslationEvent` | `translation` | `content: string` | Streaming translation replaces the partial stream mid-flow ([issue #829](https://opensource.unicc.org/un/itu/genie-ai/-/issues/829)) |
| `SseDoneEvent` | `done` | `queryId: string` | Stream complete — finalises the message bubble and the related-documents sidebar |
| `SseErrorEvent` | `error` | `message: string` | Backend stream-level error — surfaces a retry banner |

### How the events drive the UI

| Event | UI side-effect |
|-------|----------------|
| `SseChunkEvent` | Append `content` to the in-progress assistant message bubble; auto-scroll to bottom |
| `SseMetadataEvent` | Push source documents into `RightSidebarComponent` as a list of cards |
| `SseTranslationEvent` | Replace the in-progress bubble's content with the translated markdown (preserves formatting via AST-aware `translateMarkdown-per-unit` replacement) |
| `SseDoneEvent` | Finalise the bubble; flip the loading indicator off; enable the **Send** button and the **Feedback** button |
| `SseErrorEvent` | Surface an error banner with **Retry**; preserve the user's input |

### Reconnection

The current build does **not** attempt automatic SSE reconnection on a dropped stream. If the network blip causes the stream to terminate, `SseParser` flushes its buffer and the UI surfaces a "Connection lost — retry?" banner. The retry sends the same query and starts a fresh stream. (Long-term reconnect/backoff is on the roadmap.)

## 3. Markdown rendering and PDF export

In-app markdown rendering uses `flutter_markdown ^0.7.7` to render the assistant's response inline.

For **PDF export**, the app builds a `pw.Document` from the same markdown content via the `pdf` + `printing` packages:

| Component | Purpose |
|-----------|---------|
| `pdf` (`^3.11.1`) | Builds the PDF document |
| `printing` (`^5.13.1`) | Native print/share dialog (iOS share sheet, Android print framework) — `Printing.sharePdf(bytes: await pdf.save(), filename: ...)` (chatbot_component.dart:1171) |

The two rendering paths share a markdown AST; the PDF path walks the AST and emits `pw.Widget` nodes so formatting (lists, headings, code blocks, tables) survives the export. The default filename is `genie_chat_YYYY-MM-DD.pdf` (e.g. `genie_chat_2026-09-18.pdf`).

## 4. Per-message feedback

`ChatResponseFeedbackDialog` (`lib/components/chat/chat_response_feedback_dialog.dart`) opens when the user taps the thumbs-up or thumbs-down button on any assistant message. The dialog collects five fields:

| Field | Type | UI | Default |
|-------|------|----|---------|
| `rating` | 1-5 (int) | Star row below the thumbs | **Auto-set** to `4` if thumbFeedback = up, `2` if thumbFeedback = down |
| `thumbFeedback` | `up` / `down` | Two large buttons at the top | User-tapped |
| `skinTone` | hex string (ARGB32 → hex) | 5-swatch colour picker (bias / fairness signal) | `#FFCBA4` (neutral mid-tone) |
| `text` | string | Free-text box | empty |
| `messageId` | string | (internal) | Derived from the message's `id` / `timestamp`, stripped of any `messages/` prefix |

The dialog body emits `{ rating, thumbFeedback, skinTone, text, messageId }` via `widget.onSubmit({...})`. Of those, only **`rating`** and **`comment`** (mapped from the local `text` field by `chatbot_component.dart`) are POSTed to `/api/queries/{id}/feedback`; `thumbFeedback`, `skinTone`, and `messageId` are collected client-side and discarded before the request. The thumb → rating auto-set is intentional: it gives admins a single 1-5 scale to aggregate, while still letting the user override by tapping a different star.

> **Why the skin-tone selector?** It is a fairness / bias signal for downstream analytics. The user is informed that this field is collected for quality purposes (the UI labels it explicitly). Optional — the user can dismiss the dialog without selecting a tone.

## 5. Quick Help overlay

The Quick Help overlay loads on first launch and after a fresh conversation. It surfaces contextual buttons sourced from `assets/config/quickhelp/` (loaded by `GenieAIConfig` at startup). The JSON shape per button:

```json
{
  "id": "just-chat",
  "title": { "en": "Just Chat", "es": "Solo Chatear" },
  "icon": { "type": "file", "value": "/config/quickhelp/just-chat.svg" },
  "category": null
}
```

A button may also carry an `action` object with `visibleText` and `hiddenPrompt` keys (each a locale-keyed map of strings). When `action` is present, `chatbot_component.dart:739-740` (inside `_quickHelpPressed`, starting at line 737) reads `button['action']['visibleText']` to prefill the chat input and `button['action']['hiddenPrompt']` to seed the LLM's hidden prompt — these fields are optional and only present when the button's prompt needs to differ from its visible label.

User flow:

1. Overlay appears above the chat input.
2. User taps a button → the chat is **prefilled** with `action.visibleText` (or `title` when `action` is absent), and the LLM hidden prompt is set from `action.hiddenPrompt` when present.
3. The overlay auto-hides after first interaction (or via the explicit dismiss control).

### Authoring Quick Help buttons

| File | Purpose |
|------|---------|
| `assets/config/quickhelp/<icon>.svg` | Button icon (SVG) |
| `assets/config/genie-ai-config.json` | List of Quick Help buttons — `id`, `title` (locale-keyed), `icon` (file path), optional `category` and `action` |
| `lib/services/genie_ai_config.dart` | Loads and parses the JSON at startup |

## 6. Conversation management

### New chat

Tapping the **+** button (`add_circle_outline`) opens `ConfirmDialog` with three branches:

| Branch | Behaviour |
|--------|-----------|
| **Save** | Calls `POST /api/queries/{queryId}/conversation` with the current title and message history; opens the new-chat view |
| **Discard** | Wipes the in-memory state without persisting; opens the new-chat view |
| **Cancel** | Dismisses the dialog; the current conversation stays active |

This guard runs only when the current conversation has unsaved changes (e.g. the user has typed but not sent a message, or a feedback dialog is still open).

### Save conversation

Tapping **Save** in the conversation sidebar opens a title dialog (default: first user message, truncated to 50 chars) and then `POST /api/queries/{queryId}/conversation` to persist the title + full message history to the backend. Saved conversations appear in the **All** tab of the sidebar.

### Chat history tabs

The sidebar (`components/sidebar/chat_folders_panel.dart`) has three tabs:

| Tab | Source | Notes |
|-----|--------|-------|
| **All** | All saved conversations | Newest first |
| **Starred** | Conversations marked with a star (per-user) | Star toggle is local; not synced to the backend |
| **Archived** | Conversations the user archived | Hidden from All; restorable |

### Folders

The sidebar supports folders with CRUD operations (create, rename, delete, drag-drop into folder). On first launch, the **Inbox** folder is auto-created. Star/Archive are folder-scoped where applicable.

## 7. Service tree

The service tree (`components/sidebar/service_tree_panel.dart`) renders the institutional service hierarchy from the backend:

```
Service categories (top-level)
├── Health
│   ├── Maternal health
│   ├── Child immunisation
│   └── ...
├── Education
│   ├── Primary enrolment
│   └── ...
└── ...
```

Tapping a leaf service injects its `categoryId` + `serviceLabels` into the chat context. The right sidebar updates to show related documents for that service. Multi-select is supported — tap multiple leaves to filter the retriever to the union of their labels.

A **search box** at the top of the panel does a case-insensitive substring match across the visible tree, and shows a "Match found in <category>" subtitle on each match. Empty search restores the full tree.

## 8. Share chat (WhatsApp)

The **Share** action on any assistant message formats the chat transcript (user + assistant turns, with role prefixes) and tries, in order:

1. **Native WhatsApp app** — opens via deep link: `whatsapp://send?text=<urlencoded transcript>`
2. **WhatsApp Web fallback** — opens `https://wa.me/?text=<transcript>` in the system browser if the native app is not installed

The transcript is plain text (Markdown stripped). Each role is prefixed with `*Role*:` (italic in WhatsApp's lightweight markup). A header line `Conversation with Genie (<title>):` is prepended. Implementation lives at `chatbot_component.dart:_shareToWhatsApp()` (lines 1183-1224).

## 9. Per-message rate-limit and retry (roadmap — not yet implemented)

The backend may enforce rate limits on `/api/queries/stream` per Keycloak consumer. **[Not yet implemented]** in the current mobile client: no `Retry-After` handling, no automatic retry, and no rate-limit toast exist anywhere in `mobile/genie_ai_mobile/lib/`. The following steps describe the **intended behaviour once the feature lands**:

1. Read the `Retry-After` header (seconds).
2. Show a "Rate limited — retrying in Ns" toast.
3. Schedule a single retry after the delay (one-shot, no backoff loop).

The user can cancel the pending retry by tapping **Cancel**.

## 10. FAQ auto-translation

The app ships a static FAQ at `assets/FAQ.md`. On first launch (and on locale change), `right_sidebar_component.dart` POSTs the English markdown to the backend's `/api/translate/markdown` endpoint with `{ markdown, sourceLang: 'en', targetLang: <locale> }` and renders the response's `translated_markdown` field.

> **[future caching]** The current code re-fetches on every locale change and every sidebar open that triggers a refetch — there is **no** `shared_preferences` caching in `right_sidebar_component.dart`. Per-locale caching is planned but not yet implemented.

If translation fails (network error, backend returns 5xx), the FAQ renders in English with a "Translation unavailable" banner.

## 11. User Profile

`UserProfileComponent` (`components/user/user_profile_component.dart`) is a 12-tab government-style identity profile, each tab editing a dedicated section of the `/api/me` JSON document:

| Tab | Fields (per `assets/i18n/.../userProfile.fields`) |
|-----|--------------------------------------------------|
| `personal` | fullName, dob, gender, nationality, maritalStatus |
| `civil` | birthCert, deathCert, marriageDivorce, adoption, citizenship, immigration |
| `address` | currentAddress, previousAddresses, homeOrRental, utilityBills, landRecords |
| `identity` | idCard, passport, driversLicense, voterId, ssn, militaryRecords |
| `health` | medicalHistory, vaccinations, insuranceDetails, disability, bloodType, organDonor, prescriptions, mentalHealth |
| `employment` | eHistory, currentEmployer, workPermits, certifications, unemployment, tin, businessAffiliations |
| `education` | schools, diplomas, performance, scholarships |
| `financial` | incomeTax, bankAccounts, propertyTax, businessTax, pensionContrib, loanAid |
| `social` | pensionStatus, unemployment, disability, childcare, foodAssistance, housingAssistance |
| `criminal` | policeRecords, courtCases, finesPenalties, paroleProbation, citizenshipRevocation |
| `transport` | vehicleReg, trafficViolations, licenseHistory, publicTransportCard |
| `civic` | voterRegistration, electionHistory, partyMembership, militaryStatus, publicServiceRoles |

Each tab also supports `profileIcon` (image picker → `/api/me` PUT) — this lives in `personalIdentification` and is independent of the per-tab field list above. No `biometric` field is wired in the current build. All tabs read/write through `currentUserApiProvider` → `CurrentUserApi.apiMeGetWithHttpInfo()` / `apiMePutWithHttpInfo()` (see `mobile/CLAUDE.md`).

Notifications (UI toasts), Theme (light / dark / system), Language, Reset data, and Delete account are **not** part of `UserProfileComponent` — they live in `components/settings/settings_component.dart`. Star/Archive are managed by `components/sidebar/chat_folders_panel.dart` (also outside `UserProfileComponent`). See the Settings section of the mobile deployment guide.

## 12. Failure modes and debug

| Symptom | Likely cause | First check |
|---------|--------------|-------------|
| Stream never emits a `chunk` event | Backend OPEA pipeline stalled | Trace via VictoriaTraces — see [Observability — Tracing](/docs/observe/tracing/) |
| `translation` event corrupts markdown | Old non-AST translation logic | Confirm the backend has the streaming-translation fix ([issue #829](https://opensource.unicc.org/un/itu/genie-ai/-/issues/829)); check `routes/query-routes.js` for the `STREAMING_TRANSLATION_ENABLED` branch |
| Feedback POST returns 404 | Backend cleared the in-memory query before the user submitted | Increase backend retention or submit feedback sooner after the message lands |
| PDF export fails on web | `web_file_utils.dart` blocked by browser download permissions | Use a non-incognito tab; allow downloads for the app origin |
| Quick Help buttons missing | `assets/config/genie-ai-config.json` failed to load | Check `GenieAIConfig` logs for the parse error |
| Related Documents sidebar is empty after `metadata` | Backend retrieval returned no sources for the query | Verify the user is filtering by a category with knowledge-base entries |
| Save conversation returns 500 | Backend conversation store error | `curl -i` the same PUT to see the error body; report to backend maintainers |

## Related

- [Mobile Architecture](/docs/mobile/mobile-architecture/) — `SseParser`, `AuthInterceptor`, `SseEvent` class hierarchy.
- [User Authentication](/docs/mobile/user-authentication/) — Bearer-token plumbing on every chat call.
- [API Contracts (backend)](/docs/backend/api-contracts-backend/) — full request/response shapes for `/api/queries/stream` and `/api/queries/{id}/feedback`.
- [RAG pipeline](/docs/rag-pipeline/pipeline/) — backend-side retrieval, reranking, and translation.
- [Streaming SSE](/docs/rag-pipeline/streaming-sse/) — backend-side event protocol contract.
- [Observability — Tracing](/docs/observe/tracing/) — how to trace a slow or broken chat request end-to-end.
