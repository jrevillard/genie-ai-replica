---
title: "Backend HTTP API"
weight: 2
description: "Every public endpoint with request/response shape, auth requirement, and error semantics."
mode: reference
persona: developer
owner: docs-stewards
last_reviewed: 2026-09-19
aliases:
  - /docs/backend/api-contracts-backend/
---

## Purpose

This page is the **canonical HTTP API reference** for the GENIE.AI backend
(`gov-chat-backend`). For each endpoint: the path, the HTTP method, the
required auth, the request shape, the response shape, and the error
semantics.

For the narrative version with worked examples, see the now-stub
[Backend → API contracts](/docs/backend/api-contracts-backend/) (content
has been merged here; this page is the single source of truth).

## Component

`components/gov-chat-backend/` (Node.js 22, Express, JWT, winston).
**Base URL**: `https://<domain>/api` (via Kong Gateway).
**Internal port**: 3000 (not exposed in Swarm).
**OpenAPI**: `/api-docs` (Swagger UI served from the BFF itself).

> **Sibling services are documented separately.** The `/api/files` and
> `/api/labels` endpoints are served by `document-repository` — a different
> Node.js process with its own auth middleware
> (`authorizeRole(['Admin', 'dataprep-service'])`) and its own deployment
> boundary. The schemas here cover the BFF only.

## Before you start

Before integrating against this API, confirm the following prerequisites
are in place. An integrator who skips this section typically hits a
`UNAUTHENTICATED` (401) or `FORBIDDEN` (403) on the first call and wastes
time guessing what is wrong.

**Required**

- A reachable deployment. The public URL is `https://<domain>/api` where
  `<domain>` is set by `NGINX_PUBLIC_DOMAIN` (defined in the root `env`
  template). For local development the BFF listens on `http://localhost:3000`
  and Swagger is reachable at `http://localhost:3000/api-docs`.
- A Keycloak realm and client. The BFF validates tokens issued by
  `KEYCLOAK_URL/realms/<KEYCLOAK_REALM>` against the OIDC issuer configured
  by `KEYCLOAK_URL` and `KEYCLOAK_REALM`. The realm, client ID, and admin
  credentials live in `.env`; see
  [Keycloak Admin Guide](/docs/configure/keycloak-admin-guide/) for how to
  obtain them.
- An OIDC flow that produces a Bearer access token. The BFF accepts tokens
  from any standard OIDC flow:
  - **Authorization Code + PKCE** for end-user apps (web, mobile) — recommended.
  - **Client Credentials** for service-to-service calls (dataprep,
    document-repository, cron jobs).
  - **Resource Owner Password Credentials (ROPC)** is supported but disabled
    in production realms for security reasons; enable it only temporarily
    for tests, then revert. The agent playbook for this lives in
    `.claude/rules/SERVER-TESTING.md` (developer-internal, not published).
- Kong is routing `/api/*` to the backend. The express-api service in
  `api-gateway-solution/new-config/kong_config.json` (`/api` catch-all plus
  named routes for `/api/auth`, `/api/me`, `/api/queries`, etc.) must be
  applied.

**For admin endpoints (`/api/admin/*`, `/api/logger/*`)**

- A user with the realm role `admin` assigned (lowercase — verified in
  `keycloak-auth-middleware.js:183`).

**Recommended**

- The OpenAPI JSON (`GET /api-docs.json`) — a programmatic copy of all the
  schemas below, refreshed on every BFF restart. Useful for client code
  generation and contract tests.

## Verify your setup

Two smoke tests prove the wiring is correct end-to-end. The first must
succeed without a token (public); the second must fail with the documented
error code.

```bash
# 1. Public probe — GET /api/health is on the public-path allowlist
curl -sk -w "\nHTTP %{http_code}\n" \
  "https://<domain>/api/health"
# Expected:
# {"status":"ok","serverTime":"2026-09-18 12:34:56","uptime":42 seconds}
# HTTP 200

# 2. Auth probe — without a token, /api/me returns UNAUTHENTICATED (not UNAUTHORIZED)
curl -sk -w "\nHTTP %{http_code}\n" \
  "https://<domain>/api/me"
# Expected:
# {"error":"TOKEN_INVALID","message":"Missing or malformed Authorization header","details":{}}
# HTTP 401
```

If the second call returns `UNAUTHORIZED` instead of `TOKEN_INVALID`, you
are on an old release — the error code was renamed to align with the
middleware contract; see [Error response format](#error-response-format).

## How to call these endpoints

Every authenticated endpoint expects a Keycloak-issued Bearer token in the
`Authorization` header. Attach it on every request:

```bash
TOKEN="$(curl -sk -X POST \
  "$KEYCLOAK_URL/realms/$KEYCLOAK_REALM/protocol/openid-connect/token" \
  --data-urlencode "grant_type=password" \
  --data-urlencode "client_id=$KEYCLOAK_CLIENT_ID" \
  --data-urlencode "username=$USERNAME" \
  --data-urlencode "password=$PASSWORD" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin)["access_token"])")"

curl -sk -H "Authorization: Bearer $TOKEN" \
  "https://<domain>/api/me" | jq .
```

Refresh on `401` (any error code in the `TOKEN_*` family). The BFF rejects
`UNAUTHENTICATED` (missing/invalid token) and `TOKEN_EXPIRED` (valid but
past expiry) as 401; clients should not retry with the same token — request
a new one from Keycloak instead.

## Conventions

| Element | Convention |
|---|---|
| Base URL | `${VUE_APP_API_URL}` = `/api` (proxied by Kong / Nginx) |
| Auth | Keycloak JWT in `Authorization: Bearer <token>` unless `Allow public` |
| Content-Type | `application/json` for request and response bodies |
| Errors | `{ "message": "<msg>" }` for typed errors; `{ "error": "<CODE>", "message": "<msg>" }` for explicit route-level errors (no `details` field today) |
| ID format | UUID v4 for new entities, MongoDB ObjectId-compatible string otherwise |
| Timestamps | ISO-8601 in UTC |

## Allowlist — public paths (no auth required)

| Path | Purpose |
|---|---|
| `GET /api/health` | Liveness probe |
| `GET /robots.txt` | Web crawler policy |
| `GET /` | Service banner (lists available endpoints) |
| `GET /sitemap.xml` | Empty sitemap (SPA renders client-side) |
| `GET /api-docs` | Swagger UI |
| `GET /api-docs.json` | OpenAPI JSON |
| `GET /api-docs/` | Swagger UI (trailing-slash form) |
| `GET /api/auth/callback` | OIDC Authorization-Code callback target |
| `GET /api/auth/logout/callback` | OIDC post-logout redirect target |
| `GET /Uploads/*` | Legacy static serving (Kong-enforced auth) |

The Keycloak auth middleware explicitly bypasses JWT verification for these
paths (`keycloak-auth-middleware.js:10-18`). Probes, documentation, and the
OIDC redirect flow work without an access token.

> **Do not assume these paths exist on the BFF.** `/api/auth/callback` and
> `/api/auth/logout/callback` are allowlisted for the auth middleware only.
> The actual handler is normally served by Keycloak itself via Kong's
> `keycloak-route`; the BFF exists as a passthrough so the middleware does
> not 401 the redirect.

Everything else requires a valid Keycloak JWT.

> **Note:** the runtime frontend configuration (locale whitelist, default
> locale, etc.) is **not** served by a backend endpoint. It is injected at
> container startup into `window.APP_CONFIG` and read by the SPA bundle —
> see [Restrict active locales](/docs/configure/locale-whitelist/).

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
| `TOKEN_INVALID` | 401 | `keycloak-auth-middleware.js:79,157` |
| `TOKEN_EXPIRED` | 401 | `keycloak-auth-middleware.js:150` |
| `PROVISIONING_FAILED` | 500 | `keycloak-auth-middleware.js:106` |
| `INTERNAL_ERROR` | 500 | `keycloak-auth-middleware.js:165` |
| `STREAMING_DISABLED` | 501 | `query-routes.js:146` |
| `STREAM_ERROR` | varies | `query-routes.js:389` (generic upstream stream failure) |
| `TRANSLATION_FAILED` | varies | `query-routes.js:427` (translation upstream failure) |
| `CITY_NOT_FOUND` | 503 | `services/weather-service.js:199` (no city within lookup radius) |
| `CHATQNA_UNAVAILABLE` | 504 | `query-routes.js:384` (ChatQnA timeout / aborted) |
| `INVALID_FILTERS_JSON` | 400 | `analytics-routes.js:289` (malformed `filters` query param) |
| `Not Found` | 404 | Sensitive-path blocker (`index.js:566`), 404 fallback (`index.js:822`) |

> **Note:** the legacy `UNAUTHORIZED` code is **not** emitted. Clients
> matching on it will silently break — match `UNAUTHENTICATED`.

## Defense in depth

| Layer | What it blocks |
|---|---|
| **Nginx** | Dotfiles (`.X` except `.well-known`) and VCS dirs (`.git`, `.svn`, `.hg`, `CVS`, `BitKeeper`) |
| **Kong** | Adds headers (`X-Forwarded-For`, etc.); rate limit on express-api service |
| **Helmet (backend)** | CSP, HSTS, frame-options, X-Content-Type-Options |
| **CORS** | Allowlist via `CORS_ALLOWED_ORIGINS` |
| **Rate limit** | Kong rate-limit 1000 / minute per consumer on the express-api service |

### Defense in depth (sensitive-path blocker)

The BFF returns 404 for any path matching `/.<segment>` (e.g. `/.env`,
`/.git`), `/.git`, `/.env`, or `/BitKeeper` (`index.js:553-578`). The
matcher logs a `SECURITY: Blocked access to sensitive path` warning with the
caller IP, method, and User-Agent, then returns:

```json
{ "message": "Not Found" }
```

This is defense-in-depth — Kong should already be blocking these paths,
but the BFF rejects them as well so a misconfigured Kong cannot leak
secrets.

## Route domains

### 1. Authentication routes (`/api/auth`)

**Route file**: `routes/auth-routes.js` **Mount**: `/api/auth` (Kong named
route, `auth-route`) **Auth required**: **Yes** — every endpoint under
`/api/auth` requires a valid Keycloak JWT. The `/api/auth/callback` paths
bypass this check.

**Login is not proxied by the BFF.** Kong routes the actual `/auth/*`
flow directly to Keycloak (`keycloak-route` in `kong_config.json`). The BFF
only exposes the application-level logout.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/logout` | Yes | Logout — invalidate ArangoDB session, emit audit log, leave OIDC revocation to Keycloak |

**Logout behaviour** (verified in `auth-routes.js` +
`authController.logout`):

- The endpoint requires the Bearer token to identify the session to
  invalidate. A missing/invalid token returns `TOKEN_INVALID` (401) before
  any logout work runs.
- On success, the backend tears down any active ArangoDB session for the
  user and emits a structured audit log entry.
- Keycloak-side OIDC revocation is handled by Keycloak itself; the BFF
  does not call Keycloak's `/logout` endpoint. Clients that want to also
  clear the IdP session should additionally redirect through Keycloak's
  end-session endpoint.

### 2. User profile routes (`/api/me`)

**Route file**: `routes/user-routes.js` **Mount**: `/api/me` (Kong
`user-route`) **Auth required**: **Yes** on every endpoint.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/` | Yes | Get current user profile (singleton) |
| GET | `/context` | Yes | Get sanitized AI-enrichment context |
| POST | `/reset-data` | Yes | Reset profile data (clears profile fields, keeps credentials) |
| POST | `/delete` | Yes | GDPR right-to-erasure (soft-delete with PII nullification) |
| PUT | `/` | Yes | Update profile + optional avatar upload |

**`GET /api/me`** — returns the full user document from ArangoDB,
populated from the JWT on first hit (JIT provisioning). Subsequent reads
come from ArangoDB. Confirmed fields: `email`, `firstName`, `lastName`,
`createdAt`, `updatedAt`, `iss_sub`, `roles`. Other fields (`avatarUrl`,
`theme`, `locale`, and custom settings merged back from `customSettings` at
`user-profile-service.js:148-162`) may be present depending on profile
state — request `/api-docs.json` for the canonical schema.

**`GET /api/me/context`** — returns a sanitized subset of the profile for
OPEA AI enrichment. Use this endpoint to pass user data to the AI layer:
it strips internal IDs and only ships the fields that OPEA is allowed to
consume (role claims come fresh from the JWT, never from the cached
ArangoDB document).

**`POST /api/me/reset-data`** — clears profile fields but **preserves**
`email`, `createdAt`, and Keycloak credentials so JIT provisioning can
re-bootstrap the user on the next login. This is the right endpoint for a
"reset my chat history but keep my account" UX; for full erasure, use
`/delete`.

**`POST /api/me/delete`** — **irreversible**. Deletes the user from
Keycloak and nullifies PII in ArangoDB (`deleted=true`, all PII fields
overwritten with `null`). The user cannot log in again; any cached JWTs
will hit the `FORBIDDEN` path on subsequent requests (`req.user.deleted`
check in `keycloak-auth-middleware.js:113`).

**`PUT /api/me`** — multipart update. The route uses `upload.any()`
(`user-routes.js:241`) which means it accepts arbitrary multipart fields;
in practice the frontend sends:

- `firstName`, `lastName`, `email`, `username` → forwarded to Keycloak
  Account API (JIT fields; see `JIT_FORWARD_FIELDS` in
  `constants/jit-fields.js`)
- `locale`, `theme`, `avatarUrl`, and any custom fields → written to
  ArangoDB
- `avatar` (image file, recommended) → max **10 MB** (multer limit at
  `user-routes.js:38`)

The cap is set in code, not by an env var; raising it requires a backend
code change.

### 3. Query routes (`/api/queries`, `/api/query`)

**Route file**: `routes/query-routes.js` **Mount**: `/api/queries` (Kong
`query-route`), `/api/queries/stream` (Kong `query-stream-route`).
**`/api/query` is a legacy alias** — both mount points load the same
router; clients should use `/api/queries`. **Auth required**: **Yes** on
every endpoint.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/stream` | Yes | Stream RAG response over SSE — see [SSE Streaming Protocol](#sse-streaming-protocol) |
| POST | `/` | Yes | Create new query (single-message mode) |
| GET | `/` | Yes | List queries (paginated, current user only) |
| GET | `/:queryId` | Yes | Get a single query (current user or admin) |
| PATCH | `/:queryId/responsetime` | Yes | Update response-time metric — called by SSE consumer |
| POST | `/:queryId/feedback` | Yes | Submit user feedback (1–5 rating, optional comment) |
| PATCH | `/:queryId/answered` | Yes | Mark query as seen by user (stamps `responseTime`) |
| GET | `/:queryId/conversations` | Yes | List conversations linked to this query |
| POST | `/:queryId/conversation` | Yes | Promote a query to a new conversation |
| POST | `/:queryId/link/:messageId` | Yes | Re-link a query to a chat message (after a failed link) |

**`POST /api/queries`** has two semantic modes selected by request body
shape:

- **Single-message** (`{ question, context }`) — one user turn, no
  conversation linkage, no link to a chat message.
- **Conversation-with-context-labels** (`{ question, conversationId,
  messageId, context }`) — appends to an existing conversation, records
  context labels for retrieval blending (issue #833 multi-turn
  vector-space blending).

The analytics emission is identical in both modes; the `conversationId`
controls whether the query shows up under "today's chats" or as an orphan
turn.

**`GET /api/queries`** is paginated, scoped to the JWT user. Query params:

| Param | Type | Default | Notes |
|-------|------|---------|-------|
| `sessionId` | string | — | Filter by chat session |
| `text` | string | — | Full-text search across `question`/`response` |
| `categoryId` | string | — | Filter by category |
| `serviceId` | string | — | Filter by service |
| `isAnswered` | boolean | — | `true`/`false` |
| `startDate` / `endDate` | ISO date | — | Date range on `createdAt` |
| `limit` | int | 20 | Max 100, min 1 |
| `offset` | int | 0 | Min 0 |

**`POST /api/queries/:queryId/feedback`** body:

```json
{
  "rating": 4,
  "comment": "Helpful"
}
```

Contributes to `/api/analytics/satisfaction/*` aggregates.

**`PATCH /api/queries/:queryId/responsetime`** body:
`{ "responseTime": 1234 }` (milliseconds). Called by the SSE consumer on
stream completion to backfill the timing metric — the `metadata` SSE event
already carries it in-band, so this endpoint is the fallback when the
metadata event was missed.

**`PATCH /api/queries/:queryId/answered`** is idempotent: each call stamps
`responseTime` to "now" if the query was not already answered. Multiple
calls do not double-stamp.

**`GET /api/queries/:queryId/conversations`** — a query can be promoted to
multiple conversations (e.g. user forks the same answer into two threads).
Returns an array (possibly empty); never returns `404` for an existing
query with zero linked conversations.

**`POST /api/queries/:queryId/conversation`** — promotes a query into a
new conversation (the query becomes the first message). Body:

```json
{
  "title": "Optional conversation title",
  "responseText": "Optional override of the cached response",
  "tags": ["optional", "tags"]
}
```

**`POST /api/queries/:queryId/link/:messageId`** — re-attaches a query to
an existing chat message after the auto-link step at SSE completion failed.
The optional body may carry `responseType` and `confidenceScore` overrides.

### 4. Chat history routes (`/api/chat`)

**Route file**: `routes/chat-history-routes.js` **Mount**: `/api/chat`
(Kong `chat-history-route`) — note that the router is also mounted at
`/api/chat-history` in `index.js:476` but **Kong only exposes `/api/chat`**
(`kong_config.json:376`). `/api/chat-history` is reachable only via the
catch-all `/api` route. **Auth required**: **Yes** on every endpoint.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/conversations` | Yes | List user conversations (paginated) |
| GET | `/conversations/:conversationId` | Yes | Conversation + messages |
| POST | `/conversations` | Yes | Create conversation |
| PATCH | `/conversations/:conversationId` | Yes | Update title/metadata |
| DELETE | `/conversations/:conversationId` | Yes | Soft-delete conversation |
| GET | `/conversations/:conversationId/messages` | Yes | Messages, paginated |
| POST | `/conversations/:conversationId/messages` | Yes | Append message |
| POST | `/conversations/:conversationId/messages/read` | Yes | Mark messages as read |
| GET | `/query/:queryId/messages` | Yes | Reverse lookup — messages for a query |
| GET | `/messages/:messageId/query` | Yes | Reverse lookup — query for a message |
| POST | `/query/:queryId/conversation` | Yes | Promote query to conversation (alias of `/api/queries/:queryId/conversation`) |
| GET | `/search` | Yes | Full-text search across conversations |
| GET | `/recent` | Yes | Last-N conversations (sidebar) |
| GET | `/stats` | Yes | Per-user conversation statistics |
| GET | `/folders` | Yes | List folders |
| POST | `/folders` | Yes | Create folder |
| GET | `/folders/:folderId` | Yes | Folder details |
| PATCH | `/folders/:folderId` | Yes | Rename / update folder |
| DELETE | `/folders/:folderId` | Yes | Soft-delete folder, cascade conversations |
| GET | `/folders/search` | Yes | Search folders |
| POST | `/folders/reorder` | Yes | Custom sort order |
| GET | `/folders/:folderId/path` | Yes | Breadcrumb path |
| POST | `/folders/:folderId/conversations/:conversationId` | Yes | Add conversation to folder |
| DELETE | `/folders/:folderId/conversations/:conversationId` | Yes | Remove conversation from folder |
| GET | `/conversations/:conversationId/folder` | Yes | Get folder for conversation |
| POST | `/conversations/:conversationId/move` | Yes | Move conversation to another folder |

**`POST /folders/reorder`** body:

```json
{
  "orderedFolderIds": ["folder_3", "folder_1", "folder_2"]
}
```

**`POST /conversations`** body:

```json
{
  "title": "My conversation",
  "messages": [{ "role": "user", "content": "Hello" }],
  "folderId": "optional-folder-id",
  "tags": ["optional"]
}
```

**`DELETE /folders/:folderId`** performs a **cascade soft-delete** on
every conversation in it (the conversations are not hard-deleted — they
survive a folder-recreate). See [Deletion semantics](#deletion-semantics).

**`POST /conversations/:conversationId/messages`** body:

```json
{
  "role": "user",
  "content": "Message text",
  "queryId": "optional",
  "metadata": { "optional": true }
}
```

### 5. Analytics routes (`/api/analytics`)

**Route file**: `routes/analytics-routes.js` **Mount**: `/api/analytics`
(Kong `analytics-route`) **Auth required**: **Yes** on every endpoint.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/dashboard` | Yes | Aggregate dashboard metrics |
| GET | `/metric/:metric` | Yes | Single metric (generic) |
| GET | `/` | Yes | High-level overview |
| GET | `/timeseries/:metricType` | Yes | Time-bucketed series |
| POST | `/events` | Yes | Record a custom analytics event |
| GET | `/records` | Yes | Raw event records |
| GET | `/events` | Yes | Filtered event list |
| GET | `/satisfaction/gauge` | Yes | Satisfaction gauge (1–5) |
| GET | `/satisfaction/heatmap` | Yes | Satisfaction by category |

**`GET /events`** supports the same `startDate`/`endDate`/`limit`/`offset`
pagination as `/api/queries` (default `limit=20`, max 100).

**`POST /events`** body:

```json
{
  "eventType": "pageView",
  "eventData": { "path": "/chat", "durationMs": 1234 }
}
```

### 6. Admin routes (`/api/admin`)

**Route file**: `routes/admin-routes.js` **Mount**: `/api/admin` (Kong
`admin-route`) **Auth required**: **Yes + realm role `admin`**
(lowercase). The router-level `requireAdmin` is applied at
`admin-routes.js:44-45`.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/system-health` | Admin | Deep system health probe (DB, OPEA, Redis, etc.) |
| GET | `/database/stats` | Admin | ArangoDB collection statistics |
| GET | `/logs` | Admin | Application log retrieval |
| POST | `/logs/rollover` | Admin | Trigger log rollover (legacy — see note below) |
| GET | `/user-stats` | Admin | User statistics |
| GET | `/security-metrics` | Admin | Security event metrics |
| POST | `/security-scan` | Admin | Trigger security scan |
| GET | `/security/last-scan` | Admin | Last scan result |
| POST | `/diagnostics` | Admin | Run a diagnostics bundle |
| GET | `/logs/summary` | Admin | Aggregated log stats |
| GET | `/logs/search` | Admin | Log search |
| GET | `/logs/debug-yesterday` | Admin | Yesterday's debug logs |
| POST | `/database-operations/backup` | Admin | Trigger backup — also reachable at `/api/database/backup` |
| POST | `/database-operations/optimize` | Admin | Optimize DB — also reachable at `/api/database/optimize` |
| GET | `/users/search` | Admin | Search users |
| GET | `/queries/inspect` | Admin | List all queries (admin view, cross-user) |
| GET | `/queries/inspect/:queryId` | Admin | Inspect a query |

**Two separate implementations** share these names — they are NOT
aliases. `/api/admin/database-operations/backup` and
`/api/admin/database-operations/optimize` are handled by
`adminService.backupDatabase()` / `adminService.optimizeDatabase()`
(`services/admin-dashboard-service.js:601,656`), which export every
collection as a single JSON file. The `/api/database/backup` and
`/api/database/optimize` routes are handled by
`databaseService.backupDatabase()` / `databaseService.optimizeDatabase()`
(`services/database-operations-service.js:59,239`), which stream
JSON/JSONL to `BACKUP_DIR` with metadata. Use the admin-prefixed paths in
client code (they require an admin role; `/api/database/*` is
authenticated-only).

**Log rollover note:** `POST /api/logger/rollover` always returns `200`;
`POST /api/admin/logs/rollover` returns `200` for browser callers and
`410 Gone` for cron UAs (`cron`, `curl`, `wget`, `httpie`,
`python-requests`, `python-urllib`, `go-http-client` — see
`admin-routes.js:200-217`). Both endpoints are no-ops: logs are written
directly to VictoriaLogs and there is nothing to rotate
(`logger-routes.js:82-90`). They remain for backward-compat with older
scripts.

### 7. Service category routes (`/api/service-categories`)

**Route file**: `routes/service-category-routes.js` **Mount**:
`/api/service-categories` (Kong `service-category-route`) **Auth
required**: **Yes** on every endpoint.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/categories` | Yes | List service categories (hierarchical) |
| GET | `/categories/detailed` | Yes | Categories with translations + services |
| GET | `/categories/:categoryId` | Yes | Single category |
| GET | `/:categoryId/translations` | Yes | Translations for one category |
| GET | `/services/:serviceId/translations` | Yes | Translations for one service |
| GET | `/search` | Yes | Full-text search |
| POST | `/` | Yes | Create category |
| DELETE | `/:categoryId` | Yes | Soft-delete category |
| DELETE | `/services/:serviceId` | Yes | Soft-delete service |
| POST | `/init` | Yes | Initialize default categories (idempotent) |
| POST | `/:categoryId/services` | Yes | Add service to category |
| PUT | `/:categoryId` | Yes | Update category metadata |
| PUT | `/services/:serviceId` | Yes | Update service metadata |

**Translation routes** (`GET /:categoryId/translations`,
`GET /services/:serviceId/translations`) return translation records
keyed `${sourceKey}_${languageCode}` (e.g. `name_en`, `name_fr`). The
translation schema is documented in the i18n section of `CHANGELOG.md`
and on the frontend inventory page (see
[UI Component Inventory](/docs/frontend/ui-component-inventory-frontend/)).

### 8. Service routes (`/api/services`)

**Route file**: `routes/service-routes.js` **Mount**: `/api/services`
(Kong `service-route`) **Auth required**: **Yes**.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/categories` | Yes | Flat list of all services |
| GET | `/categories/:categoryId` | Yes | Services under one category |
| GET | `/search` | Yes | Full-text search across services |

### 9. Translation routes (`/api/translate`)

**Route file**: `routes/translation-routes.js` **Mount**: `/api/translate`
(catch-all `/api` route only — no dedicated Kong route). **Auth
required**: **Yes**.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | Yes | Translate an array of text strings |
| POST | `/markdown` | Yes | Translate markdown, preserve structure |

**`POST /api/translate`** body:

```json
{
  "texts": ["Hello world", "Good morning"],
  "source_lang": "en",
  "target_lang": "fr"
}
```

**Response**:

```json
{ "translated_texts": ["Bonjour le monde", "Bonjour"] }
```

**`POST /api/translate/markdown`** body:

```json
{
  "markdown": "# Title\n\nHello **world**.",
  "source_lang": "en",
  "target_lang": "fr"
}
```

Uses AST-based translation: only text leaf nodes are sent to the
translator; markdown structure (headings, lists, links) is preserved by
the skeleton.

**Streaming translation** is a separate, optional path: set
`STREAMING_TRANSLATION_ENABLED=1` to translate chat-stream units as they
arrive (issue #829). See [SSE Streaming Protocol](#sse-streaming-protocol).

### 10. Weather routes (`/api/weather`)

**Route file**: `routes/weather-routes.js` **Mount**: `/api/weather`
(catch-all `/api` route). **Auth required**: **Yes**.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/` | Yes | Fetch weather data |

Body: `{ "latitude": <number>, "longitude": <number> }`
Response: `{"location": "<City, Country>", "current": {"temperature": ...,
"condition": "...", "humidity": ..., "windSpeed": ...}, "forecast":
[{"date": "...", "condition": "...", "highTemp": ..., "lowTemp": ...},
...]}`.
Errors with `CITY_NOT_FOUND` (HTTP 503) when reverse-geocoding finds no
city within the lookup radius.

> **Note** — The weather route is a legacy/integration endpoint; the chat
> pipeline does not call it. Keep it in the public surface only if an
> upstream client still depends on it.

### 11. Logger routes (`/api/logger`)

**Route file**: `routes/logger-routes.js` **Mount**: `/api/logger`
(Kong `logger-route`) **Auth required**: **Yes + realm role `admin`**.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/configure` | Admin | Configure logger — **deprecated, no-op** |
| POST | `/rollover` | Admin | Roll over logs — **deprecated, no-op** |

> Both endpoints are deprecated. The backend writes logs directly to
> VictoriaLogs; there is nothing to configure or rotate from the BFF. They
> remain on the public surface for backward compatibility with older
> admin scripts.

### 12. Database operations routes (`/api/database`)

**Route file**: `routes/database-operations-routes.js` **Mount**:
`/api/database` (Kong `database-operations-route`) **Auth required**:
**Yes — authenticated users only, not admin-restricted** (verified at
`database-operations-routes.js:8`: only `authenticate`, no
`requireAdmin`). In practice these endpoints are still mostly invoked by
admins, but a non-admin caller with a valid token will reach the handler.

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/backup` | Yes (any user) | Trigger database backup |
| POST | `/optimize` | Yes (any user) | Optimize database |

These are **not aliases** of the `/api/admin/database-operations/*` paths
— they call a different service implementation. See Section 6 for the
full breakdown: `/api/database/*` uses `databaseService` (streamed
JSON/JSONL to `BACKUP_DIR`), while `/api/admin/database-operations/*`
uses `adminService` (single in-memory JSON file per collection). Use the
admin-prefixed variants in client code (they require an admin role;
`/api/database/*` is authenticated-only).

### 13. Document repository API (`/api/files`, `/api/labels`)

The document-repository is a **sibling service**, not part of the BFF. It
runs in `components/document-repository/`, exposes its own routes, and
authenticates with its own middleware (`authorizeRole` rather than
`keycloakAuthMiddleware`).

Quick reference:

| Path | Mount | Roles | Notes |
|------|-------|-------|-------|
| `POST /api/files/upload` | Admin | Admin | Single file |
| `POST /api/files/uploads` | Admin | Admin | Multiple files |
| `POST /api/files/upload-link` | Admin | Admin | URL-based upload |
| `POST /api/files/crawl/schedule` | Admin | Admin | Web crawl |
| `GET /api/files`, `/search`, `/search/files`, `/:fileId` | Any user | — | List/search |
| `GET /api/files/:fileId/crawl-*`, `POST .../kill-crawl`, `POST .../kill-ingest` | Admin | Admin | Crawl ops |
| `GET /api/files/:fileId/view`, `/viewbrowser`, `/download`, `POST /api/files/downloads` | Any user | — | Read |
| `DELETE /api/files/:fileId`, `DELETE /api/files/` | Admin | Admin | Delete |
| `PATCH /api/files/:fileId` | Admin | Admin | Update metadata |
| `POST /api/files/:fileId/ingest`, `/retract`, `POST /api/files/ingest`, `/retract` | Admin | Admin | RAG ingest/retract |
| `POST /api/files/:fileId/ingestion-log` | Admin, dataprep-service | Admin | Log ingestion event |
| `GET /api/files/:fileId/ingestion-log` | Admin, dataprep-service | Admin | Get logs |
| `PATCH /api/files/:fileId/status` | Admin, dataprep-service | Admin | Update status |
| `/api/labels/*` | Admin | Admin | Label CRUD |

**File upload limits** (set in
`components/document-repository/src/config/appConfig.js`):

| Env var | Default | Notes |
|---------|---------|-------|
| `MAX_FILE_SIZE` | `52428800` (50 MB) | Per-file cap |
| `MAX_FILES_UPLOAD` | `10` | Per-request cap |
| `UPLOAD_DIR` | `./uploads` | Storage dir |

**Allowed types**: `application/pdf`, `application/msword`,
`application/vnd.openxmlformats-officedocument.wordprocessingml.document`,
`application/vnd.ms-excel`,
`application/vnd.openxmlformats-officedocument.spreadsheetml.sheet`,
`text/markdown`, `text/plain`, `text/html`, `application/zip`,
`application/x-zip-compressed`. Extensions: `.pdf`, `.docx`, `.xlsx`,
`.md`, `.html`, `.txt`. ClamAV scans all uploads when
`VIRUS_SCANNING=true`; failed scans return 400 with the rejection
reason.

> **Authorization model for write ops:** all write paths require
> `authorizeRole(['Admin'])`. The three ingestion-log/status endpoints
> additionally accept the `dataprep-service` role — that role exists for
> the dataprep service-account to call back without needing an Admin JWT.

## SSE streaming protocol

**Endpoint**: `POST /api/queries/stream` (also aliased as
`/api/queries/stream` via Kong `query-stream-route`).

### Request headers

```
Content-Type: application/json
Authorization: Bearer <token>
```

### Request body

```json
{
  "question": "What does the policy say about X?",
  "context": {
    "language": "en",
    "conversationId": "optional-existing-conversation",
    "messageId": "optional-message-to-link",
    "labels": ["optional", "labels"]
  }
}
```

### Response headers

```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
X-Accel-Buffering: no
```

### Event types

The stream emits one or more of the following event types. Field types are
stable; renaming a field is a breaking change.

| Type | Fields | Notes |
|------|--------|-------|
| `chunk` | `content: string` | One streaming chunk (an English text unit by default) |
| `metadata` | `queryId: string`, `responseTime: number`, `source_documents?: array`, `confidence_score?: number`, `is_grounded?: boolean` | Captured from chatqna's in-stream metadata, forwarded to client (no separate backend retrieval) |
| `translation` | `content: string` | Emitted by `/api/translate/*` only when `STREAMING_TRANSLATION_ENABLED=0` (the English-then-flip path) |
| `chunk` | `content: string` (translated) | Emitted by streaming-translation path — see below |
| `error` | `message: string`, `code: string` | Closes the stream after emission |
| `done` | `queryId: string` | Always last; closes the stream |

Example stream (English-then-flip path):

```
data: {"type":"metadata","queryId":"abc123","responseTime":0,"source_documents":[...],"confidence_score":0.87,"is_grounded":true}

data: {"type":"chunk","content":"The policy states that "}

data: {"type":"chunk","content":"applicants must..."}

data: {"type":"translation","content":"La politique indique que les candidats doivent..."}

data: {"type":"done","queryId":"abc123"}
```

Keepalive comment lines (`: keepalive`) are emitted on a fixed interval so
intermediate proxies do not time out the connection.

### Streaming translation (issue #829)

Set `STREAMING_TRANSLATION_ENABLED=1` to translate chat-stream units as
they arrive instead of buffering the full English response and flipping at
the end. When enabled:

- The backend buffers English chunks unit-by-unit (sentence / paragraph
  boundaries — see `services/translation/stream-boundary.js`).
- Each complete unit is translated via
  `translationService.translateMarkdown` (AST-preserving: only text leaf
  nodes reach the model).
- Translated chunks are emitted as
  `data: {"type":"chunk","content":"..."}` events. The `translation`
  event type is NOT emitted on this path.
- If translation fails for a unit, the unit is sent in English (degraded
  path) and a warning is logged. The stream continues.
- Default `STREAMING_TRANSLATION_ENABLED=0` (English-then-flip) for
  back-compat.

The flag is checked in `routes/query-routes.js:208-213` and is a **string
comparison** — only `'1'` or `'true'` enable it.

### Environment control

SSE is enabled by default — any value of `OPEA_STREAMING` other than the
literal string `'false'` enables it. Disable explicitly:

```bash
OPEA_STREAMING=false   # POST /api/queries/stream returns 501 STREAMING_DISABLED
```

The 501 response body:

```json
{
  "error": "STREAMING_DISABLED",
  "message": "SSE streaming is disabled. Set OPEA_STREAMING=true to enable."
}
```

### Failure modes (SSE)

| Symptom | Likely cause |
|---------|--------------|
| HTTP 501 `STREAMING_DISABLED` | `OPEA_STREAMING=false` |
| HTTP 401 `UNAUTHENTICATED` | Bearer token missing or invalid |
| Stream starts then stops with `CHATQNA_STREAM_ERROR` | Upstream OPEA ChatQnA failure (timeouts, refused) |
| Stream starts then stops with `STREAM_ERROR` | Generic upstream stream error |
| Stream starts then stops with `TRANSLATION_FAILED` | Translation service failure on the English-then-flip path |
| Stream silently hangs and times out | Upstream ChatQnA unresponsive; check `CHATQNA_STREAM_TIMEOUT` (default 3600000 ms = 60 min) |

## Static & operational endpoints

These endpoints live in `components/gov-chat-backend/index.js`. They are
public (on the auth allowlist) and have no business logic.

### `GET /api/health`

```json
{ "status": "ok", "serverTime": "2026-09-18 12:34:56", "uptime": "42 seconds" }
```

Always returns 200 unless the process itself is broken. Use this for Docker
Swarm/Kubernetes/Ansible liveness probes; it is a constant-time handler
(no DB calls). See [Operate → Health checks](/docs/operate/health-checks/)
for the runtime contract.

### `GET /`

```json
{
  "message": "Welcome to the Government Services API",
  "apiDocumentation": "/api-docs",
  "availableEndpoints": [
    "/api/me", "/api/queries", "/api/services",
    "/api/service-categories", "/api/chat-history", "/api/chat",
    "/api/analytics", "/api/auth", "/api/logger",
    "/api/database", "/api/admin", "/api/weather", "/api/translate"
  ]
}
```

Useful as a one-line smoke test after a deploy.

### `GET /robots.txt`

```
User-agent: *
Disallow: /api/
Disallow: /Uploads/
```

Blocks crawlers from `/api/` (no public content) and `/Uploads/` (private
files).

### `GET /sitemap.xml`

Empty `<urlset/>` placeholder. The frontend is a single-page app;
populating this requires server-side rendering that the project does not
currently do.

### `GET /Uploads/*`

Serves files from `UPLOAD_DIR` (default `./Uploads`). The BFF does
**not** enforce auth here — Kong is expected to block this path for
unauthenticated callers (`UPLOAD_DIR` is auth-gated at the gateway).
Most files now live in document-repository; `/Uploads` is a legacy path.

## Middleware reference

### `keycloakAuthMiddleware.authenticate`

**Location**: `components/gov-chat-backend/middleware/keycloak-auth-middleware.js`
**Use**: validates the Bearer token, JIT-provisions (or refreshes) the
ArangoDB user record, blocks soft-deleted users, attaches `req.user` and
`req.claims` for downstream handlers.

**Applied**: at router level (`router.use(authenticate)`) for the
analytics, chat-history, database-operations, query, service,
service-category, translation, and weather routes; per-route for the
`/api/me/*` and `/api/auth/logout` routes.

**Public allowlist**: see
[Allowlist — public paths](#allowlist--public-paths-no-auth-required).

**Failure modes**:

| Status | Code | Cause |
|--------|------|-------|
| 401 | `TOKEN_INVALID` | Header missing or malformed |
| 401 | `TOKEN_EXPIRED` | Token past expiry (also marks user deleted in ArangoDB if Keycloak reports disabled) |
| 500 | `PROVISIONING_FAILED` | JIT provisioning failed |
| 500 | `INTERNAL_ERROR` | Unexpected middleware error |
| 403 | `FORBIDDEN` | Soft-deleted user (`req.user.deleted === true`) |

### `keycloakAuthMiddleware.requireAdmin`

**Location**: same file, lines 178-194.
**Use**: rejects callers whose JWT `realm_access.roles` does not include
the literal string `admin` (lowercase). Roles are read fresh from
`req.claims.realm_access.roles` (set on every request from the verified
JWT), never from the cached ArangoDB user document.

**Failure mode**: 403 `FORBIDDEN` with `message: 'Admin access required'`.

### `authorizeRole(['Admin'])` (document-repository only)

**Location**: `components/document-repository/src/middlewares/keycloak-auth-middleware.js:168`
**Use**: equivalent gate on the document-repository side. The middleware
reads `req.user.role` (singular, normalized to `Admin` at lines 57-60)
and compares case-insensitively against the allowed-roles list at line
179, so functionally it accepts the same `admin` role as the BFF — only
the spelling in route definitions differs. No runtime mismatch.

### Request body limits

The BFF body parser (`index.js:640-641`) accepts up to **50 MB** JSON /
urlencoded bodies. Multipart on `/api/me` is capped at **10 MB**
(`user-routes.js:38`). Multipart on `/api/files/*` is capped at **50 MB**
per file by default (`MAX_FILE_SIZE`).

## Pagination & filters

List endpoints (`/api/queries`, `/api/chat/conversations`,
`/api/chat/messages`, `/api/analytics/events`,
`/api/admin/users/search`) share a common pagination contract:

| Query param | Type | Default | Notes |
|-------------|------|---------|-------|
| `limit` | int | `20` | Page size, min 1, max 100 |
| `offset` | int | `0` | Min 0 |
| `startDate` / `endDate` | ISO date | — | Inclusive range on `createdAt` |
| `sort` | string | `createdAt DESC` | Field + space + direction |
| Free filter fields | per endpoint | — | See endpoint table |

There is **no `cursor` parameter** — pagination is offset-based. For very
large result sets, narrow the `startDate`/`endDate` window rather than
paging deep.

## Deletion semantics

The BFF uses soft-delete throughout. There are three flavours; check the
table when in doubt.

| Endpoint | Behavior |
|----------|-----------|
| `POST /api/me/delete` | **Soft-delete with PII nullification** — Keycloak user is deleted, ArangoDB user is marked `deleted=true` and every PII field is overwritten with `null`. Irreversible. Subsequent requests with cached tokens return `FORBIDDEN`. |
| `POST /api/me/reset-data` | **Reset profile data** — clears custom profile fields but preserves `email`, `createdAt`, and Keycloak credentials so JIT re-bootstraps on next login. Reversible (re-login recreates). |
| `DELETE /api/chat/conversations/:id` | **Soft-delete conversation** — sets `deleted=true` on the conversation; messages remain in ArangoDB but are filtered out by reads. |
| `DELETE /api/chat/folders/:folderId` | **Cascade soft-delete** — sets `deleted=true` on the folder AND every conversation in it. Conversations are not hard-deleted; restoring the folder restores membership. |
| `DELETE /api/files/:fileId` | **Soft-delete file** — sets `deleted=true` on the file document; the underlying upload stays on disk until the periodic GC sweep. |
| `DELETE /api/service-categories/:categoryId` and `/services/:serviceId` | **Soft-delete** — service-category tree keeps the node but reads filter it out. |
| `DELETE /api/labels/:labelId` | **Soft-delete** — the label and any descendants are marked deleted; `/api/labels/:labelId/with-children` cascades the soft-delete explicitly. |

There is **no hard-delete endpoint** on the BFF or document-repository.
GDPR right-to-erasure is satisfied by `POST /api/me/delete`.

## Error response format

### JSON errors (most endpoints)

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable error message",
  "details": { "field": "context" }
}
```

### Some legacy endpoints return `{ message }` only

A few older handlers return `{ "message": "..." }` without an `error`
code (e.g. `user-routes.js:76`, `chat-history-routes.js` fall-throughs,
the sensitive-path blocker, the 404 fallback at `index.js:822`). Clients
should treat HTTP status as the primary signal and parse either field.

The full error-code table is in [Error codes](#error-codes) above.

## Rate limiting

Rate limiting is enforced by Kong's `rate-limiting` plugin
(`api-gateway-solution/new-config/kong_config.json:427-446` is the
chat-history-route plugin on the `/api/chat` route; `:757-777` is the
service-level plugin on `express-api`). The admin-route (`/api/admin`)
has no route-level plugin — only the express-api service-level
rate-limiting applies to it.

**Default policy** (identical on both plugins):

| Window | Limit | Policy | Scope |
|--------|-------|--------|-------|
| per minute | 1000 | `local` | per Kong **consumer** (not per IP) |
| per hour | 10000 | `local` | per Kong **consumer** |

**Scope is per-consumer, not per-user, per-role, or per-IP.** There is
no tiered "admin bypass" — every Kong-authenticated consumer hits the
same limit. If you need a higher quota, create a dedicated Kong consumer
with overrides.

**429 response**:

```json
{ "message": "API rate limit exceeded" }
```

HTTP status: 429. Kong does not emit a `Retry-After` header by default
(`hide_client_headers: false`); clients should back off with exponential
delay and jitter, starting at 1 s.

**Per-route overrides**: the document-repository has its own rate-limit
settings — check the Kong config for the `document-repository` service
block before assuming the global limits apply.

## OpenAPI / Swagger documentation

Interactive API documentation is served by the BFF itself (not by Kong):

| URL | Purpose |
|-----|---------|
| `http://localhost:3000/api-docs` | Local dev Swagger UI |
| `https://<domain>/api-docs` | Production Swagger UI (Keycloak OAuth2 + PKCE baked in via `swagger-ui` config) |
| `http://localhost:3000/api-docs.json` | Local OpenAPI 3.0 JSON |
| `https://<domain>/api-docs.json` | Production OpenAPI JSON |

Swagger definitions are inline in route files using JSDoc comments
(`@swagger`, `@summary`, `@tags`, etc.) — `swagger-jsdoc` reads
`./routes/*.js` at module-load time and assembles the spec. To add a new
endpoint to the spec, write the `@swagger` block above the route
definition; no separate spec file to edit.

## CORS configuration

CORS is configured in the **backend**
(`components/gov-chat-backend/index.js:444-446`), not Kong — the Kong
`cors` plugin entries (`kong_config.json:394, 779`) are both
`enabled: false`.

| Setting | Value |
|---------|-------|
| Allowed origins | `CORS_ALLOWED_ORIGINS` (comma-separated; each entry is matched exactly, or as a `/pattern/` regex if wrapped in slashes) |
| Allowed methods | `GET, POST, PUT, PATCH, DELETE, OPTIONS` |
| Allowed headers | `Content-Type, Authorization, X-Requested-With` |
| Credentials | `true` |
| `OPTIONS` success status | `204` |

> **Missing origin** is allowed (e.g. server-to-server calls with no
> `Origin` header). Set `CORS_ALLOWED_ORIGINS` to the production frontend
> origin (and any staging origins) before going live; an empty allowlist
> silently accepts no browser callers.

## Observability overhead gates

The BFF applies a per-request metrics middleware that records HTTP
counters and a duration histogram. It can be turned off for benchmarking
or ultra-lean stacks:

| Env var | Default | Effect |
|---------|---------|--------|
| `ENABLE_METRICS` | `true` | When `false`, the metrics middleware is a no-op (`metrics-middleware.js:26`) |
| `ENABLE_OBSERVABILITY` | `false` (compose default) | Enables the broader OTel Collector / Victoria* stack |

`ENABLE_METRICS=false` is the right knob for a load test where every µs
counts; the broader stack still works through
`OTEL_EXPORTER_OTLP_ENDPOINT`.

## Health check

`GET /api/health` returns
`{ "status": "ok", "serverTime": "<iso>", "uptime": "<n> seconds" }` when
the process is alive and dependencies are reachable. See
[Operate → Health checks](/docs/operate/health-checks/) for the runtime
contract.

## Related

- [Backend → API contracts](/docs/backend/api-contracts-backend/) — now
  a stub pointing back here.
- [Reference → OPEA protocol](/docs/reference/opea-protocol/) — backend
  ↔ ChatQnA
- [Operate → Health checks](/docs/operate/health-checks/)
- [Operate → Security hardening](/docs/operate/security-hardening/)
- [Architecture Overview](/docs/architecture/architecture/) — service
  topology and the BFF's role in the request path.
- [Observability Configuration](/docs/observe/configuration/) —
  `OTEL_EXPORTER_OTLP_ENDPOINT`, VictoriaLogs routing, Grafana
  dashboards.
- [Keycloak Admin Guide](/docs/configure/keycloak-admin-guide/) —
  realm setup, client credentials, admin user creation, ROPC
  enable/revert.
- [Troubleshooting](/docs/operate/troubleshooting/) — `docker service
  logs`, debug-yesterday, security-blocker diagnostics.