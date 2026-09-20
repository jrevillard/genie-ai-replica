---
title: "Backend HTTP API"
weight: 2
description: "Every public endpoint with request/response shape, auth requirement, and error semantics."
mode: reference
persona: developer
owner: docs-stewards
last_reviewed: 2026-09-18
---

## Purpose

This page is the **canonical HTTP API reference** for the GENIE.AI backend
(`gov-chat-backend`). For each endpoint: the path, the HTTP method, the
required auth, the request shape, the response shape, and the error
semantics.

For the narrative version with worked examples, see
[Backend → API contracts](/docs/backend/api-contracts-backend/).

## Conventions

| Element | Convention |
|---|---|
| Base URL | `${VUE_APP_API_URL}` = `/api` (proxied by Kong / Nginx) |
| Auth | Keycloak JWT in `Authorization: Bearer <token>` unless `Allow public` |
| Content-Type | `application/json` for request and response bodies |
| Errors | `{ "message": "<msg>" }` for typed errors; `{ "error": "<CODE>", "message": "<msg>" }` for explicit route-level errors (no `details` field today) |
| ID format | UUID v4 for new entities, MongoDB ObjectId-compatible string otherwise |
| Timestamps | ISO-8601 in UTC |

## Error codes

| Code | HTTP | Meaning |
|---|---|---|
| `UNAUTHENTICATED` | 401 | Missing or invalid token |
| `FORBIDDEN` | 403 | Authenticated but missing required realm role |
| `NOT_FOUND` | 404 | Resource does not exist |
| `VALIDATION_FAILED` | 422 | **Not emitted.** Backend uses `ValidationError` (HTTP 400) — no dedicated envelope code is sent; either implement 422 or drop the row |
| `RATE_LIMITED` | 429 | Emitted by Kong, **not** the backend (Kong enforces 1000/min per consumer on express-api and returns plain text `API rate limit exceeded`, not the standard JSON envelope) |
| `CHATQNA_STREAM_ERROR` | 502 | Upstream ChatQnA streaming error (ArangoDB / ChatQnA / Keycloak upstream errors propagate through this code) |
| `INTERNAL` | 500 | Unhandled exception |

> **Note:** the legacy `UNAUTHORIZED` code is **not** emitted. Clients
> matching on it will silently break — match `UNAUTHENTICATED`.

## Allowlist — public paths (no auth required)

| Path | Purpose |
|---|---|
| `GET /api/health` | Liveness probe |
| `GET /robots.txt` | Web crawler policy |

Everything else requires a valid Keycloak JWT.

> **Note:** the runtime frontend configuration (locale whitelist, default
> locale, etc.) is **not** served by a backend endpoint. It is injected at
> container startup into `window.APP_CONFIG` and read by the SPA bundle —
> see the frontend runtime-config docs.

## Auth

### `POST /api/auth/refresh-token` *(Kong-only stub — not implemented in the backend)*

- **Auth:** none (uses refresh-token cookie).
- **Status:** **Not implemented in the backend.** Kong has a route
  (`auth-refresh-route` in `kong_config.json`) that forwards
  `/api/auth/refresh-token` to `express-api`, but `express-api` returns 404
  because no such endpoint exists in `auth-routes.js`. Token refresh is
  handled by the **Keycloak OIDC refresh grant** invoked from the frontend
  Keycloak JS adapter, not by a backend endpoint.
- **Action:** rely on the Keycloak JS adapter's standard refresh flow;
  do not call this path from a backend client.

### `POST /api/auth/logout`

- **Auth:** required.
- **Side effects:** ends the active ArangoDB session; emits a structured
  audit-log entry. **OIDC revocation is delegated to the IdP** — calling
  `/logout` clears the local session but the IdP session remains valid
  until its own idle timeout.
- **Response:** `200 OK` with `{ "success": true, "message": "Logged out successfully" }`.

### `GET /api/me`

- **Auth:** required.
- **Response:** profile object (the raw ArangoDB `users` document, with any
  `customSettings` merged back to the top level for backward compatibility) —
  `_key`, `iss_sub`, `iss`, `sub`, `email`, `name` (Keycloak `name`, with
  `preferred_username` as fallback), `emailVerified`, `roles`, `active`,
  `deleted`, `createdAt`, `updatedAt`.

### `PUT /api/me`

- **Auth:** required.
- **Body:** partial profile.
- **Response:** updated profile.

### `POST /api/me/delete` *(GDPR)*

- **Auth:** required.
- **Side effects:** anonymizes profile, deletes conversations and messages,
  retains an audit-log row.
- **Response:** `200 OK` with `{ "success": true, "message": "Account deleted" }`.

## Chat history

### `POST /api/chat/conversations`

- **Auth:** required.
- **Body:** `{ "title": "<string>" }`.
- **Response:** `Conversation` object.

### `GET /api/chat/conversations`

- **Auth:** required.
- **Query:** `?limit=<n>&offset=<n>&search=<q>`.
- **Response:** `{ "items": [...], "total": <n> }`.

### `GET /api/chat/conversations/:id`

- **Auth:** required.
- **Response:** `Conversation` with `messages[]`.

### `DELETE /api/chat/conversations/:id`

- **Auth:** required.
- **Response:** `200 OK` with `{ "conversationId": "<id>", "messagesDeleted": <n>, "success": true }`.

### `POST /api/chat/conversations/:id/messages`

- **Auth:** required.
- **Body:** `{ "sender": "user|assistant", "content": "<string>" }` (the field
  is `sender`, not `role`; optional `queryId` for assistant messages and free-form
  `metadata` object).
- **Response:** `201 Created` with the created `Message`.

### `GET /api/chat/recent`

- **Auth:** required.
- **Query:** `?limit=<n>` (default 10).
- **Response:** most recent N conversations (no messages).

## Query routes (RAG)

### `POST /api/queries`

- **Auth:** required.
- **Body:**
  ```json
  {
    "userId": "<string>",
    "sessionId": "<string>",
    "messages": [
      { "role": "user", "content": "<string>" }
    ],
    "context": {
      "categoryLabel": "<string>",
      "serviceLabels": ["<string>"]
    },
    "conversationId": "<uuid>"
  }
  ```
  Required fields validated server-side: `userId`, `sessionId`, `messages[]`
  (or legacy `text`). `context` is optional and defaults to
  `{ categoryLabel: "General", serviceLabels: [] }`.
- **Response:** SSE stream. See [RAG pipeline → Streaming & metadata events](/docs/rag-pipeline/streaming-sse/).
- **Confidence metadata:** emitted on the terminal SSE event as
  `data: {"retrieval_confidence_score": <float>, "confidence_score": <float>, "is_grounded": <bool>, "self_confidence": <float>}`.

> **Note:** `retriever_parameters` / `reranker_parameters` (with `ARANGO_*`
> / `RERANKER_*` keys) are **OPEA-internal** fields. They are not part of
> the `/api/queries` request body — the backend constructs them from
> `CONTEXT_OPTION` defaults and the per-realm runtime configuration.

### `POST /api/queries/:id/feedback`

- **Auth:** required.
- **Body:** `{ "rating": <number>, "comment": "<string>" }` (`rating` is required; `comment` optional).
- **Response:** `200 OK` with the updated query document.

### `GET /api/queries`

- **Auth:** required.
- **Query:** `?startDate=<iso>&endDate=<iso>&limit=<n>&offset=<n>` (additional criteria fields: `sessionId`, `text`, `categoryId`, `serviceId`, `isAnswered`, `hasFeedback`).
- **Response:** user's queries, newest first.

## Admin routes *(realm role: `admin`)*

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/system-health` | Aggregate service health (ArangoDB, Keycloak, ChatQnA, vLLM) |
| `GET` | `/api/admin/security/last-scan` | Latest container / dep scan summary |
| `POST` | `/api/admin/security-scan` | Trigger a fresh scan |
| `GET` | `/api/admin/logs/search` | Logs search (VictoriaLogs-backed) |
| `GET` | `/api/admin/logs/summary` | Logs summary cards (errors, warnings per service) |
| `POST` | `/api/admin/database-operations/backup` | Trigger an `arangodump` to the configured target |
| `GET` | `/api/admin/queries/inspect` | List queries with metadata |
| `GET` | `/api/admin/queries/inspect/:id` | Detail for one query |

All admin routes require `realm_access.roles` to contain `admin`. A 403 is
returned otherwise.

## Analytics

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/analytics/dashboard` | Aggregated dashboard (queries / day, satisfaction, top categories) |
| `POST` | `/api/analytics/events` | Track a frontend event (`page_view`, `chat_started`, `feedback`) |
| `GET` | `/api/analytics/satisfaction/gauge` | Satisfaction gauge (positive feedback rate over a window) |
| `GET` | `/api/analytics/satisfaction/heatmap` | Satisfaction heatmap (time × day-of-week) |

## Translation

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/translate` | Translate a plain string to the target locale |
| `POST` | `/api/translate/markdown` | Translate markdown AST (preserves structure) |

Both honor `STREAMING_TRANSLATION_ENABLED` for streaming translation.

## Service categories

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/service-categories/categories` | List categories with translations |
| `GET` | `/api/service-categories/categories/detailed` | List categories with full detail (children + service counts) |
| `POST` | `/api/service-categories` | Create |
| `PUT` | `/api/service-categories/:id` | Update |
| `DELETE` | `/api/service-categories/:id` | Delete |
| `POST` | `/api/service-categories/:id/services` | Assign services to category |

Similar shape for `/api/services/*` and `/api/chat/folders/*`.

## Defense in depth

| Layer | What it blocks |
|---|---|
| **Nginx** | Dotfiles (`.X` except `.well-known`) and VCS dirs (`.git`, `.svn`, `.hg`, `CVS`, `BitKeeper`) |
| **Kong** | Adds headers (`X-Forwarded-For`, etc.); rate limit on express-api service |
| **Helmet (backend)** | CSP, HSTS, frame-options, X-Content-Type-Options |
| **CORS** | Allowlist via `CORS_ALLOWED_ORIGINS` |
| **Rate limit** | Kong rate-limit 1000 / minute per consumer on the express-api service |

## Health check

`GET /api/health` returns `{ "status": "ok", "serverTime": "<iso>", "uptime": "<n> seconds" }`
when the process is alive and dependencies are reachable. See
[Operate → Health checks](/docs/operate/health-checks/) for the runtime
contract.

## Related

- [Backend → API contracts](/docs/backend/api-contracts-backend/) — narrative version
- [Reference → OPEA protocol](/docs/reference/opea-protocol/) — backend ↔ ChatQnA
- [Operate → Health checks](/docs/operate/health-checks/)
- [Operate → Security hardening](/docs/operate/security-hardening/)