---
title: "Integration Architecture"
description: "How the GENIE.AI components integrate: service boundaries, dependencies, and the inter-service contract surface."
weight: 3
section: "core"
audience: "integrator, developer"
mode: explanation
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

This document describes how the GENIE.AI components fit together — service
boundaries, dependencies, and the inter-service contract surface.

> **For integrators and developers.** Operators can skip this page; deployers
> should focus on [Service Discovery & Routing](#service-discovery--routing)
> and [Security Considerations](#security-considerations).

For the high-level orientation, see [Project Overview](/docs/core/project-overview/).
For per-directory code layout, see [Source Tree Analysis](/docs/core/source-tree-analysis/).

## Table of Contents

- [System Overview](#system-overview)
- [Integration Points](#integration-points)
- [Communication Protocols](#communication-protocols)
- [Data Flow Diagrams](#data-flow-diagrams)
- [Authentication & Authorization](#authentication--authorization)
- [Service Discovery & Routing](#service-discovery--routing)
- [Error Handling & Resilience](#error-handling--resilience)
- [Security Considerations](#security-considerations)
- [Where to Go Next](#where-to-go-next)

---

## System Overview

GENIE.AI is a monorepo consisting of 7 main parts that communicate through
REST APIs, SSE ([Server-Sent Events](https://developer.mozilla.org/en-US/docs/Web/API/Server-sent_events)),
and direct database connections:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           GENIE.AI Platform                                 │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                             │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────────────────┐  │
│  │   Vue 3      │    │   Flutter    │    │      API Gateway Layer       │  │
│  │  Frontend    │    │    Mobile    │    │  ┌─────────┐    ┌─────────┐  │  │
│  │              │    │              │    │  │  Kong   │ -> │  NGINX  │  │  │
│  └──────┬───────┘    └──────┬───────┘    │  └─────────┘    └─────────┘  │  │
│         │                   │             └──────────────┬────────────────┘  │
│         └───────────────────┼────────────────────────────┘                   │
│                             │                                        │      │
│                             v                                        v      │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │                     Application Layer                              │   │
│  │  ┌────────────────┐    ┌──────────────────┐    ┌────────────────┐  │   │
│  │  │   Express.js   │    │   Document       │    │   Keycloak     │  │   │
│  │  │    Backend     │    │   Repository     │    │  (OIDC Provider│  │   │
│  │  │  (BFF:3000)    │    │   (:3001)        │    │   :8080)       │  │   │
│  │  └────────┬───────┘    └──────────────────┘    └────────┬───────┘  │   │
│  └───────────┼──────────────────────────────────────────────┼──────────┘   │
│              │                                              │              │
│              v                                              v              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                        Data Layer                                    │  │
│  │  ┌────────────┐    ┌────────────┐    ┌──────────────┐    ┌─────────┐ │  │
│  │  │  ArangoDB  │    │   Redis    │    │  PostgreSQL  │    │ File    │ │  │
│  │  │ (Vector+   │    │  (Cache)   │    │ (Kong + KC)  │    │ Storage │ │  │
│  │  │   Graph)   │    │            │    │              │    │         │ │  │
│  │  └────────────┘    └────────────┘    └──────────────┘    └─────────┘ │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│              │                                                              │
│              v                                                              │
│  ┌──────────────────────────────────────────────────────────────────────┐  │
│  │                       AI/ML Layer (OPEA)                              │  │
│  │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌────────┐ │  │
│  │  │ ChatQnA  │  │Retriever │  │ Reranker │  │   TEI    │  │ vLLM   │ │  │
│  │  │  :8888   │  │  :7000   │  │  :8000   │  │  :80     │  │ :8000  │ │  │
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └────────┘ │  │
│  │  ┌──────────┐                                                         │  │
│  │  │ Dataprep │                                                         │  │
│  │  │  :5000   │                                                         │  │
│  │  └──────────┘                                                         │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Integration Points

### 1. Frontend ↔ Backend

**Protocol:** HTTP/HTTPS (REST API + SSE).

**Authentication:** [OIDC](https://openid.net/connect/) Authorization Code
flow with [PKCE](https://oauth.net/2/pkce/) against Keycloak, handled
client-side by `oidc-client-ts`.

**Transport layer:** Axios HTTP client (`src/services/httpService.js`).

**Key integration details**

- **Base URL:** `window.APP_CONFIG?.apiUrl` (runtime config from
  `/config/genie-ai-config.json`) or `VUE_APP_API_URL` (build-time env var).
- **Token management:** Keycloak JWT is stored **in JavaScript memory only**
  (never in `localStorage`, `sessionStorage`, or cookies) via
  `oidc-client-ts UserManager`. The source file
  `src/services/keycloakAuthService.js` states explicitly:
  *"Tokens are stored in JavaScript memory only — never in localStorage,
  sessionStorage, or cookies."* It is injected as
  `Authorization: Bearer <token>` on every request.
- **CORS:** all requests go through Kong; CORS is configured at the gateway
  (`CORS_ALLOWED_ORIGINS`).

#### Primary endpoints (Backend mounts — `ROUTE_CONFIGS` in `index.js`)

| Endpoint | Method | Purpose | Response type |
|----------|--------|---------|---------------|
| `/api/auth/logout` | POST | Logout (Keycloak invalidates the session server-side) | JSON |
| `/api/queries` | POST | Submit a non-streaming query | JSON |
| `/api/queries/stream` | POST | Submit a streaming query (SSE) | Server-Sent Events |
| `/api/queries/:queryId/responsetime` | PATCH | Update query metrics | JSON |
| `/api/chat` / `/api/chat-history` | GET/POST | Conversation CRUD | JSON |
| `/api/chat/conversations/:conversationId/messages` | GET | Fetch conversation messages | JSON |
| `/api/chat/folders/*` | GET/POST/PATCH/DELETE | Folder CRUD + reorder | JSON |
| `/api/me` | GET / PUT | Get / update user profile | JSON |
| `/api/me/context` | GET | Get user context / preferences | JSON |
| `/api/analytics/*` | GET | Analytics dashboards | JSON |
| `/api/service-categories` | GET | Knowledge-base category tree | JSON |
| `/api/services` | GET | Service catalog | JSON |
| `/api/database/*` | GET/POST | Database operations | JSON |
| `/api/admin/*` | GET/POST | Admin operations | JSON |
| `/api/logger/*` | POST | Log ingestion | JSON |
| `/api/weather` | GET | Weather widget data | JSON |
| `/api/translate` | POST | Translate text or markdown | JSON |
| `/api/files` | POST | Upload a document (multipart) — proxied by Kong directly to `document-repository` | JSON |
| `/api/labels` | GET/POST/PATCH/DELETE | Label CRUD — proxied by Kong directly to `document-repository` | JSON |

> **Note on `/api/auth/*`:** the only handler the backend implements is
> `POST /api/auth/logout`. Login (`/api/auth/login`), callback
> (`/api/auth/callback`), and refresh (`/api/auth/refresh-token`) are
> **not** implemented server-side — the OIDC redirect and token refresh are
> handled client-side by `oidc-client-ts` against Keycloak directly. Kong
> routes `/api/auth/login` and `/api/auth/refresh-token` are placeholders
> (in case a legacy client hits them); the backend returns 404.

**Service code**

- Frontend: `src/services/chatbotService.js`, `src/services/httpService.js`,
  `src/services/keycloakAuthService.js`, `src/services/chatHistoryService.js`.
- Backend: `routes/query-routes.js` (`/api/queries/*`),
  `routes/chat-history-routes.js` (`/api/chat/*` and `/api/chat-history/*`),
  `routes/auth-routes.js` (`/api/auth/logout`).

---

### 2. Mobile ↔ Backend

**Protocol:** HTTP/HTTPS (REST API + SSE streaming).

**Authentication:** OIDC PKCE flow with Keycloak via the local
`flutter_appauth` fork (`mobile/genie_ai_mobile/flutter_appauth/`). The fork
allows `allowInsecureConnections` for dev / self-signed-cert setups (used by
the El-Salvador deployment).

**Transport layer**

- REST: OpenAPI-generated client (`openapi_client/lib/api/`) using Dart
  `http` package.
- Streaming: custom `http.Client` with `AuthInterceptor` wrapper for SSE
  parsing (`lib/services/auth/auth_interceptor.dart` + `lib/services/sse_parser.dart`).

**Key integration details**

- **OpenAPI client:** auto-generated from backend JSDoc annotations via
  `scripts/generate-api-client.sh`.
- **Flavour configuration:** `lib/config/{dev,e2e,staging}_config.dart`
  defines `dev` (localhost), `e2e`, `staging`; `lib/config/flavors/itu.dart`
  defines `itu` (prod). Each sets its URL scheme and bundle ID.
- **Token injection:** `AuthInterceptor` wraps `http.Client` to inject the
  Bearer token.
- **SSL pinning bypass:** local `flutter_appauth` fork allows
  `allowInsecureConnections` for dev self-signed certs.

**Primary endpoints:** same as the web frontend.

**Service code**

- Mobile: `lib/providers/api_providers.dart`, `lib/services/auth/auth_interceptor.dart`,
  `lib/services/keycloak/`.
- SSE parser: `lib/services/sse_parser.dart` (parses `chunk` / `metadata` /
  `translation` / `done` / `error` events).

---

### 3. Backend ↔ ArangoDB

**Protocol:** HTTP (ArangoDB HTTP API).

**Driver:** `arangojs` v8.8.1, wrapped by the shared library
`components/shared/lib/` (frozen singleton exported as `dbService`).

**Connection details**

The actual entry point used by the backend is the shared-library singleton,
not a raw `arangojs` client:

```javascript
const { logger, dbService } = require('./shared-lib');
// dbService.query(aql`FOR u IN users RETURN u`)
// dbService.collection('users').document(userId)
```

Raw `arangojs` is reserved for migrations (`scripts/migrations/*.js`).

**Collections used**

| Collection | Type | Purpose | Notes |
|---|---|---|---|
| `users` | Document | User profiles, preferences | `iss_sub` (unique), `email` |
| `conversations` | Document | Chat conversation threads | `userId` (persistent), `updatedAt` (TTL) |
| `messages` | Document | Individual chat messages | `conversationId` (persistent), `timestamp` |
| `queries` | Document | Query logs and analytics | `userId`, `timestamp`, `categoryId` |
| `serviceCategories` | Document | Knowledge-base categories | `nameEN` (unique) |
| `services` | Document | Service catalog items | `nameEN` (unique) |
| `serviceCategoryTranslations` | Document | Category translations | `sourceKey`, `languageCode` |
| `sessions` | Document | Active user sessions (server-side session) | `userId`, `expiresAt` (TTL) |
| `analytics` | Document | Pre-computed analytics | `type`, `period` |
| `<GRAPH>_SOURCE` (default `GRAPH_SOURCE`) | Document | Chunked documents + vector embeddings | ArangoDB 3.12+ vector indexes on `embedding` |
| `<GRAPH>_LINKS_TO` (default `GRAPH_LINKS_TO`) | Edge | Knowledge-graph links between chunks | Hybrid retrieval graph |
| `<GRAPH>_HAS_SOURCE` (default `GRAPH_HAS_SOURCE`) | Edge | Links source documents to chunks | Ingestion-time metadata |
| `files` | Document | File metadata (managed by document-repository) | `dataprep.status`, `storage_path` |
| `ingestion_log` | Document | Per-chunk dataprep progress (visible in UI) | `file_id`, `message` |

**Edge collections (graph)**

- `serviceCategoryTranslationsEdge` — links translations to source categories.
- `<GRAPH>_LINKS_TO`, `<GRAPH>_HAS_SOURCE` — knowledge-graph relationships
  (`GRAPH` is `ARANGO_GRAPH_NAME`, default `GRAPH`).

**Vector search:** enabled on `<GRAPH>_SOURCE.embedding` (ArangoDB 3.12+ vector index).

**Service code**

- DB singleton: `components/shared/lib/db-connection-service.js`
  (loaded via `require('./shared-lib')`).
- Migrations: `scripts/migrations/*.js`.

---

### 4. Backend ↔ Redis

**Protocol:** TCP (Redis protocol).

**Driver:** `ioredis` v5 (used only by the translation service for caching).

**Connection details**

```javascript
// services/translation-service.js
const Redis = require('ioredis');
const redis = new Redis({
  host: process.env.TRANSLATION_CACHE_HOST || 'localhost',
  port: parseInt(process.env.TRANSLATION_CACHE_PORT, 10) || 6379,
  password: process.env.TRANSLATION_CACHE_PASSWORD || null
});
```

**Use cases**

| Purpose | Configured by |
|---|---|
| Translation cache (Google Cloud / vLLM translations) | `TRANSLATION_CACHE=on`, `TRANSLATION_CACHE_HOST`, `TRANSLATION_CACHE_PORT`, `TRANSLATION_CACHE_PASSWORD` |

> **Sessions are NOT in Redis.** `services/session-service.js` stores user
> sessions in ArangoDB (`sessions` collection). The Redis cache exists only
> for translation, keyed on `translation:<lang>:<hash>` with a TTL.

---

### 5. Backend ↔ ChatQnA (AI/ML Layer)

**Protocol:** HTTP (REST API + SSE streaming).

**Backend implementation:** Worker threads via `services/opea-worker.js`
(avoids blocking the Node.js event loop during LLM inference).

**ChatQnA service:** Python FastAPI (`genie-ai-overlay/chatqna/genieai_chatqna.py`),
port `8888` (`MEGA_SERVICE_PORT`).

**Request flow**

```
Backend QueryService
  ↓
POST http://chatqna:8888/v1/chatqna
  ↓ (worker thread for non-blocking)
ChatQnA Service
  ↓
OPEA Microservice Orchestration:
  1. Embedding Service (TEI + BAAI/bge-base-en-v1.5)
  2. Retriever Service (ArangoDB vector + graph traversal)
  3. Reranker Service (Cross-encoder model)
  4. LLM Service (vLLM + meta-llama/Meta-Llama-3.1-8B-Instruct;
                  recommended ibm-granite/granite-4.1-8b for guided JSON labelling)
  ↓
Response → Backend → Client (SSE chunks or JSON)
```

**Request payload (sent to ChatQnA)**

```json
{
  "query": "User question text",
  "user_id": "keycloak-sub-uuid",
  "conversation_id": "optional-conv-id",
  "category_id": "optional-category-filter",
  "language": "en",
  "chat_history": [
    { "role": "user", "content": "previous question" },
    { "role": "assistant", "content": "previous answer" }
  ]
}
```

**Response (SSE events — `routes/query-routes.js`)**

```javascript
// Incremental LLM token
data: {"type":"chunk","content":"word"}

// Source documents + confidence
data: {"type":"metadata","source_documents":[...],"confidence_score":0.85}

// Final translated response (replaces streamed content)
data: {"type":"translation","content":"translated text"}

// Stream complete
data: {"type":"done","queryId":"abc123"}

// Error
data: {"type":"error","message":"Error description"}
```

**Environment variables**

| Variable | Purpose | Default |
|---|---|---|
| `OPEA_HOST` | ChatQnA host (backend side) | `chatqna-xeon-backend-server` (compose) |
| `OPEA_PORT` | ChatQnA port (backend side) | `8888` |
| `MEGA_SERVICE_PORT` | ChatQnA port (server-side, ChatQnA bind) | `8888` |
| `LLM_SERVER_HOST_IP` | vLLM host | `vllm` *(compose override; code default `0.0.0.0`)* |
| `LLM_SERVER_PORT` | vLLM port | `8000` *(compose override; code default `80`)* |
| `EMBEDDING_SERVER_HOST_IP` | Embedding host | `embedding` *(compose override; code default `0.0.0.0`)* |
| `EMBEDDING_SERVER_PORT` | Embedding port | `6000` *(compose override; code default `80`)* |
| `EMBEDDING_SERVER_ENDPOINT` | Embedding API path | `/v1/embeddings` |
| `RETRIEVER_SERVICE_HOST_IP` | Retriever host | `retriever-arango-service` *(compose override; code default `0.0.0.0`)* |
| `RETRIEVER_SERVICE_PORT` | Retriever port | `7000` *(compose override; code default `7025`)* |
| `RERANK_SERVER_HOST_IP` | Reranker host | `reranker` *(compose override; code default `0.0.0.0`)* |
| `RERANK_SERVER_PORT` | Reranker port | `8000` *(compose override; code default `80`)* |
| `RERANKING_STRATEGY` | Slice / threshold / knee_threshold / adaptive | `slice` (compose default; ChatQnA code default `adaptive`) |
| `RERANKER_TOP_N` | Chunks kept for slice strategy | `3` |
| `RERANKING_THRESHOLD` | Min reranker score for threshold strategy | `0.9` (ChatQnA default) |
| `CONFIDENCE_RANK_DECAY` | Exponential weight decay per rank | `0.5` |
| `MULTI_TURN_BLEND_ENABLED` | Vector-space blending of multi-turn history | `false` |
| `MULTI_TURN_BLEND_ALPHA` | Query weight α (1.0 = query-only) | `0.7` |

**Service code**

- Backend: `services/opea-worker.js`, `routes/query-routes.js`,
  `services/query-service.js`.
- ChatQnA: `genie-ai-overlay/chatqna/genieai_chatqna.py`.

---

### 6. Document Repository

**Protocol:** HTTP (REST API, internal Docker network).

**Purpose:** File upload, virus scanning (ClamAV), document metadata, label
CRUD.

**Mounted routes** (in `src/app.js`):

- `/api/files` → `routes/fileRoutes.js`
- `/api/labels` → `routes/labelRoutes.js`

Kong routes `/api/files/*` and `/api/labels/*` directly to
`document-repository:3001` — the backend is **not** in the path for these.

#### Document processing pipeline

```
Frontend (POST /api/files, multipart)
  ↓ Kong → document-repository
  1. ClamAV scan (clamdscan via clamav-node.sh)
  2. Text extraction (Docling / pdfminer / python-docx)
  3. Dataprep trigger — chunk, embed, label
  4. ArangoDB writes (chunks + vectors + knowledge graph edges)
  ↓
Frontend polls /api/admin or ingestion_log for progress
```

> **ClamAV operational note:** `clamav-node.sh` shells out to `clamdscan`,
> which depends on `clamav-daemon` (a `Recommends:` of `clamav`,
> dropped by `--no-install-recommends`). Production images must keep
> `clamav-daemon` installed — verify with
> `docker exec <doc-repo> clamdscan --version` after every image rebuild
> (Q3-2026 hardening, MR !324).

**Label flow clarification**

- `POST /api/labels` (and the rest of `/api/labels/*`) is **label CRUD**
  (define what labels exist).
- **Assigning labels to uploaded files happens downstream** — dataprep reads
  the label list from the backend at `/api/service-categories`, decides per
  chunk (LLM, embedding, or BM25 strategy), and writes the assignment
  directly to ArangoDB.

---

### 7. Backend ↔ Keycloak

**Protocol:** HTTPS ([OIDC](https://openid.net/connect/) + Keycloak Admin
REST API).

**Keycloak URLs**

- Well-known config: `<KEYCLOAK_URL>/realms/<KEYCLOAK_REALM>/.well-known/openid-configuration`
- Token endpoint: `<KEYCLOAK_URL>/realms/<KEYCLOAK_REALM>/protocol/openid-connect/token`
- UserInfo: `<KEYCLOAK_URL>/realms/<KEYCLOAK_REALM>/protocol/openid-connect/userinfo`
- Admin API: `<KEYCLOAK_URL>/admin/realms/<KEYCLOAK_REALM>/`

#### JWT validation flow

```javascript
// middleware/keycloak-auth-middleware.js
async function authenticate(req, res, next) {
  const token = extractBearerToken(req);
  const decoded = await keycloakAuthService.verifyToken(token);
  // Token contains: sub, email, name, preferred_username, realm_access.roles
  req.user = decoded;
  req.userId = decoded.sub; // Keycloak subject
  // Auto-provision user in ArangoDB (provisionUser)
  await userProvisioningService.provisionUser(decoded);
  next();
}
```

The backend validates the JWT signature against Keycloak's [JWKS](https://oauth.net/2/jwk/)
endpoint (`services/keycloak-auth-service.js`) and checks signature, expiry,
issuer, and audience.

#### Token refresh

**Handled client-side**, not via a backend route. The OIDC client
(`oidc-client-ts` on the web, `flutter_appauth` on mobile) calls Keycloak
directly:

```
Client (oidc-client-ts) → Keycloak /token (grant_type=refresh_token)
Keycloak → Client: new access_token (used silently for the next call)
```

The `POST /api/auth/refresh-token` endpoint does **not** exist in the
backend. Kong has a placeholder route for it (legacy clients), but the
backend returns 404 — refresh is always client-side.

#### Admin API operations

| Operation | Endpoint | Purpose |
|---|---|---|
| Get user | `GET /admin/realms/<realm>/users/{id}` | Fetch user profile |
| Create user | `POST /admin/realms/<realm>/users` | Provision new user |
| Update user | `PUT /admin/realms/<realm>/users/{id}` | Sync profile changes |
| Delete user | `DELETE /admin/realms/<realm>/users/{id}` | Deactivate account |

**Service code**

- Backend: `services/keycloak-auth-service.js`,
  `services/keycloak-proxy-service.js`,
  `middleware/keycloak-auth-middleware.js`,
  `services/user-provisioning-service.js`.
- Frontend: `src/services/keycloakAuthService.js`.
- Mobile: `lib/services/keycloak/keycloak_service.dart`.

---

### 8. Client → Kong → Backend (API Gateway)

**Protocol:** HTTPS (TLS termination at NGINX).

**Kong configuration:** `api-gateway-solution/new-config/kong_config.json`
(DB-less declarative; reloaded via `restore-kong-config.sh`).

#### Live routes (from `kong_config.json`)

| Route | Service | Upstream | `strip_path` |
|---|---|---|---|
| `/api` (fallback) | express-api | backend:3000 | false |
| `/api/auth` | express-api | backend:3000 | false |
| `/api/auth/login` | express-api | backend:3000 | false (legacy placeholder, returns 404) |
| `/api/auth/refresh-token` | express-api | backend:3000 | false (legacy placeholder, returns 404) |
| `/api/me` | express-api | backend:3000 | false |
| `/api/queries` | express-api | backend:3000 | false |
| `/api/queries/stream` | express-api | backend:3000 | false |
| `/api/services` | express-api | backend:3000 | false |
| `/api/service-categories` | express-api | backend:3000 | false |
| `/api/database` | express-api | backend:3000 | false |
| `/api/analytics` | express-api | backend:3000 | false |
| `/api/logger` | express-api | backend:3000 | false |
| `/api/security` | express-api | backend:3000 | false |
| `/api/admin` | express-api | backend:3000 | false |
| `/api/chat`, `/api/chat/folders/*`, `/api/chat/conversations/*` | express-api | backend:3000 | false |
| `/api/files`, `/api/files/` | document-repository | document-repository:3001 | false |
| `/api/labels`, `/api/labels/` | document-repository | document-repository:3001 | false |
| `/auth` | keycloak | keycloak:8080 | **true** (Kong strips `/auth` before forwarding) |
| `/grafana` | grafana | grafana:3000 | false |

#### SSE streaming configuration (critical)

For `/api/queries/stream` Kong must not buffer the response — chat answers
would otherwise "hang" until the upstream closes, then dump in one block.
The current Kong route relies on the **global** plugin defaults; verify the
`response_buffering` setting on the `queries-stream-route` is `false` and
`read_timeout` is at least `3600000` (1 hour) before going live.

> **Failure mode if `response_buffering` is left at the default `true`:**
> the SSE stream is buffered until the upstream closes — the chat UI appears
> frozen, then the entire answer dumps at once. Always set `false` for
> `/api/queries/stream`.

#### Kong plugins applied

| Plugin | Purpose | Notes |
|---|---|---|
| Rate Limiting | Prevent abuse | `kong-rate-limit.sh` helper |
| CORS | Cross-origin headers | `CORS_ALLOWED_ORIGINS` |
| Prometheus | Metrics export | `/metrics` |
| Request Transformer | Header rewrite | `X-Forwarded-For`, etc. |

JWT validation is performed at the backend, not at the gateway (the gateway
would need Keycloak's JWKS).

#### Health checks

```bash
# From inside the Docker network
curl -s http://kong:8001/health

# List live routes from anywhere with admin port exposed (internal only)
curl -s http://kong:8001/routes | jq '.data[].paths'
```

#### NGINX configuration (`api-gateway-solution/nginx/`)

- TLS termination (SSL certificates from `secrets/ssl/`, gitignored).
- Reverse proxy to Kong on port 8000.
- ModSecurity WAF (CRS rules under `modsec-rules/`).
- WebSocket / SSE passthrough (`proxy_buffering off`).
- Static SPA file serving (built Vue assets).

**Service code**

- Kong: `api-gateway-solution/new-config/manage-kong-config.sh`,
  `api-gateway-solution/new-config/restore-kong-config.sh`.
- NGINX: `api-gateway-solution/nginx/conf/default.conf`,
  `api-gateway-solution/nginx/entrypoint.sh`.

---

### 9. Translation Services

**Protocol:** HTTPS (REST API).

#### Two backends, one service

The `services/translation-service.js` module exposes a single API and
dispatches to a pluggable backend chosen by `TRANSLATION_BACKEND`:

| Backend | Use case | Source |
|---|---|---|
| `cpu` | Offline, sovereign — NLLB-200 via Marian | `services/translation/cpu-translate-backend.js` |
| `gpu` | vLLM with translateGemma (`google/translategemma-4b-it`) | `services/translation/gpu-translate-backend.js` |
| `auto` (default) | Try GPU, fall back to CPU on error | dispatcher |

The actual translation model is `VLLM_TRANSLATION_MODEL_ID` (e.g.
`google/gemma-3-4b-it`, `google/translategemma-4b-it`, or
`google/translategemma-12b-it`). See `env` lines 129-148 for the
recommended options.

> **Earlier docs described Google Cloud Translation API as "primary".**
> That was the case in v1.x; the current production path is vLLM
> (`TRANSLATION_BACKEND=gpu|auto`) for sovereignty. Google Cloud is not
> part of the current code path; if you need it, run your own
> `cpu-translate-backend` that calls the Google API.

#### Backend endpoints

| Endpoint | Purpose | Method |
|---|---|---|
| `/api/translate` | Translate plain text | POST |
| `/api/translate/markdown` | Translate Markdown (preserves formatting) | POST |
| `/api/queries/stream` | Auto-translate response (SSE event `translation`) | POST |

#### Translation flow in SSE

```
ChatQnA returns English response
  ↓
Backend streams chunks (type: "chunk")
  ↓
After "done" event, Backend calls translationService
  ↓
Backend sends translation event (type: "translation")
  ↓
Frontend/Mobile replaces content with translated text
```

When `STREAMING_TRANSLATION_ENABLED=1`, the translation is streamed
*during* generation (issue #829) instead of an English-then-flip pattern.

#### Environment variables

| Variable | Purpose | Default |
|---|---|---|
| `TRANSLATION_BACKEND` | `auto` / `gpu` / `cpu` | `auto` |
| `VLLM_TRANSLATION_ENDPOINT` | vLLM translation URL (ChatQnA path) | `http://vllm-translation-guardrail:9031` |
| `VLLM_TRANSLATION_MODEL_ID` | Translation model | `google/gemma-3-4b-it` |
| `TRANSLATION_CACHE` | `on` enables Redis cache | (unset / off) |
| `TRANSLATION_CACHE_HOST` | Redis host for cache | `localhost` |
| `TRANSLATION_CACHE_PORT` | Redis port | `6379` |
| `TRANSLATION_CACHE_PASSWORD` | Redis password | (none) |
| `STREAMING_TRANSLATION_ENABLED` | Stream translation during generation | `0` |
| `TRANSLATION_THREADS` | CPU thread pool size | `4` |
| `TRANSLATION_BATCHES` | Parallel batches | `5` |

**Service code:** `services/translation-service.js`,
`services/translation/cpu-translate-backend.js`,
`services/translation/gpu-translate-backend.js`.

---

### 10. Dataprep ↔ ArangoDB (Document Ingestion)

**Protocol:** HTTP (`arangojs` driver) + internal OPEA orchestration.

**Purpose:** chunk, embed, and label documents from the document-repository.

#### Dataprep pipeline

```
Document Repository (triggers ingestion)
  ↓
Dataprep Service (dataprep-arango-service:5000)
  ↓
Content Extraction (Docling, pdfminer, etc.)
  ↓
Text Splitting (RecursiveCharacterTextSplitter)
  ↓
Label Assignment (LLM-based / embedding-based / BM25)
  ↓
Embedding Generation (TEI service)
  ↓
ArangoDB Storage:
  - `<GRAPH>_SOURCE` collection (document + vector)
  - `<GRAPH>_LINKS_TO` edges (knowledge-graph links)
  - `<GRAPH>_HAS_SOURCE` edges (links source docs to chunks)
  - ingestion_log (per-chunk progress)
```

#### Labelling strategies (illustrative — actual code in `genieai_dataprep_arangodb.py`)

1. **LLM-based** (default for `LABELING_STRATEGY=llm`): the LLM is asked
   to assign 1–4 relevant labels per chunk. The system prompt is
   `LABEL_SELECTOR_SYSTEM_PROMPT` (ENV-tunable).
2. **Embedding-based** (`LABELING_STRATEGY=embedding`): cosine similarity
   between the chunk embedding and label embeddings; threshold
   `EMBEDDING_LABEL_THRESHOLD`.
3. **BM25-based** (`LABELING_STRATEGY=bm25`): keyword scoring against the
   label text.

The actual code lives in
`genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py`; the snippets in
earlier docs were abridged. Read the source for the live defaults.

#### Contextual retrieval (optional)

`CONTEXTUAL_RETRIEVAL_ENABLED=true` (default) prepends an LLM-generated
context prefix to each chunk before embedding and labelling. Two modes:
`per_chunk` (default; one call per chunk) or `doc_level` (one call per doc).
See `DATAPREP_CONTEXTUAL_MAX_TOKENS` (default `512`) — earlier docs
hardcoded `200`, which truncated JSON under vLLM load and caused
`JSONDecodeError` → raw-chunk fallback.

#### Authentication

Dataprep uses a **service account** (`client_credentials` grant) to call
the backend. It obtains labels from `/api/service-categories`. The service
account is provisioned in Keycloak via `keycloak-config-cli`:

```python
# genie-ai-overlay/dataprep/keycloak_service_account.py
async def get_service_account_token():
    async with aiohttp.ClientSession() as session:
        async with session.post(
            f"{KEYCLOAK_URL}/realms/{REALM}/protocol/openid-connect/token",
            data={
                "grant_type": "client_credentials",
                "client_id": KC_DATAPREP_CLIENT_ID,
                "client_secret": KC_DATAPREP_CLIENT_SECRET,
            }
        ) as response:
            return await response.json()
```

**Service code**

- Dataprep: `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py`,
  `genieai_dataprep_microservice.py`.
- Keycloak SA: `genie-ai-overlay/dataprep/keycloak_service_account.py`.

---

## Communication Protocols

### HTTP / REST

All synchronous request-response communication uses REST APIs over
HTTP/HTTPS:

- Frontend/Mobile → Backend: Axios (JS), `http` package (Dart).
- Backend → ChatQnA: Axios (Node.js).
- Backend → Document Repository: Axios (Node.js).
- Backend → Keycloak: Axios (Node.js).
- Backend → Translation: Axios (Node.js).

**Standard response format**

```json
{
  "data": { ... },
  "error": null,
  "meta": {
    "timestamp": "2025-01-12T10:00:00Z",
    "requestId": "uuid"
  }
}
```

**Error response format**

```json
{
  "error": {
    "code": "QUERY_VALIDATION_ERROR",
    "message": "Invalid query parameters",
    "details": { ... }
  }
}
```

### Server-Sent Events (SSE)

**Use case:** Real-time streaming of LLM responses from ChatQnA.

**Endpoint:** `POST /api/queries/stream`

**Event types**

| Type | Payload | Purpose |
|---|---|---|
| `chunk` | `{ content: "text" }` | Incremental LLM token |
| `metadata` | `{ source_documents: [...], confidence_score: 0.85 }` | Citation + confidence |
| `translation` | `{ content: "translated text" }` | Final translation (replaces chunks) |
| `done` | `{ queryId: "abc123" }` | Stream complete |
| `error` | `{ message: "Error description" }` | Stream-level error |

**SSE format**

```
data: {"type":"chunk","content":"Hello"}

data: {"type":"metadata","source_documents":[...],"confidence_score":0.9}

data: {"type":"done","queryId":"abc123"}
```

**Keepalive:** SSE comments (`: ping`) sent every 15s to prevent connection
timeout.

**Frontend implementation (Fetch API)**

```javascript
const response = await fetch('/api/queries/stream', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
  body: JSON.stringify(queryData)
});

const reader = response.body.getReader();
const decoder = new TextDecoder();

while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value);
  const lines = chunk.split('\n');

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue;
    const data = JSON.parse(line.slice(6));
    // Handle event by type
  }
}
```

**Mobile implementation (`http.Client.send` + `SseParser`)**

```dart
final request = http.Request('POST', Uri.parse('$baseUrl/api/queries/stream'))
  ..headers['Authorization'] = 'Bearer $token'
  ..headers['Content-Type'] = 'application/json'
  ..body = jsonEncode(queryData);

final streamedResponse = await httpClient.send(request);

await for (final chunk in streamedResponse.stream.transform(utf8.decoder)) {
  for (final event in SseParser.parseChunk(chunk)) {
    switch (event) {
      case SseChunkEvent():        appendContent(event.content);
      case SseMetadataEvent():     updateSources(event.sourceDocuments);
      case SseTranslationEvent():  replaceContent(event.content);
      case SseDoneEvent():         saveQuery(event.queryId);
      case SseErrorEvent():        showError(event.message);
    }
  }
}
```

### Direct Database Connections

- Backend → ArangoDB: `arangojs` driver (HTTP-based).
- Backend → Redis: `ioredis` driver (TCP-based) — translation cache only.
- Document-repository → ArangoDB: `arangojs` (file metadata, ingestion_log).

**No other service** connects directly to databases — all access goes
through either the backend or document-repository.

---

## Data Flow Diagrams

### RAG pipeline flow

```
┌─────────┐       ┌─────────┐       ┌─────────┐       ┌────────────┐
│ Client  │       │ Kong    │       │ Backend │       │ ChatQnA    │
│ (Web/Mobile) │   │ Gateway │   │ (QuerySvc)│   │ (OPEA)     │
└────┬────┘       └────┬────┘       └────┬────┘       └─────┬──────┘
     │                 │                 │                   │
     │ POST /api/queries/stream        │                   │
     │─────────────────────────────────>│                   │
     │                 │                 │                   │
     │                 │                 │ POST /v1/chat/completions
     │                 │                 │───────────────────>│
     │                 │                 │                   │
     │                 │                 │    Orchestration: │
     │                 │                 │    1. Embedding   │
     │                 │                 │    2. Retrieval (ArangoDB)
     │                 │                 │    3. Reranking   │
     │                 │                 │    4. LLM Inference
     │                 │                 │                   │
     │ SSE: chunk      │                 │<──────────────────│
     │<─────────────────────────────────│                   │
     │ SSE: chunk      │                 │<──────────────────│
     │<─────────────────────────────────│                   │
     │ SSE: metadata   │                 │<──────────────────│
     │<─────────────────────────────────│                   │
     │ SSE: done       │                 │<──────────────────│
     │<─────────────────────────────────│                   │
     │ Backend translates (if needed)    │                   │
     │ SSE: translation                 │                   │
     │<─────────────────────────────────│                   │
```

### Authentication flow

```
┌─────────┐       ┌─────────┐       ┌─────────┐       ┌──────────┐
│ Client  │       │ Keycloak│       │ Backend │       │ArangoDB  │
│ (Web/Mobile) │   │ (OIDC)  │   │ (API)   │       │          │
└────┬────┘       └────┬────┘       └────┬────┘       └────┬─────┘
     │                 │                 │                 │
     │ 1. OIDC Authorize (Keycloak /auth)               │
     │────────────────>│                                 │
     │                 │                                 │
     │ 2. User logs in                                  │
     │                 │                                 │
     │ 3. Redirect + auth code                          │
     │<────────────────│                                 │
     │                 │                                 │
     │ 4. Token exchange (oidc-client-ts → Keycloak)    │
     │                 │   (NOT a backend callback —     │
     │                 │    the OIDC client handles it)  │
     │ 5. JWT (access + refresh)                         │
     │<────────────────│                                 │
     │                 │                                 │
     │ 6. Store token in JS memory (NEVER localStorage)  │
     │                 │                                 │
     │ 7. API request with Authorization: Bearer <jwt>  │
     │─────────────────────────────────>                │
     │                 │                                 │
     │                 │ 8. Validate JWT against JWKS    │
     │                 │────────────────────────────────>│
     │                 │                                 │
     │                 │ 9. Provision user (provisionUser)│
     │                 │────────────────────────────────>│
     │                 │                                 │
     │ 10. Response    │                                 │
     │<─────────────────────────────────                 │
```

**Token refresh** is automatic before expiry and handled entirely
client-side by `oidc-client-ts` / `flutter_appauth`:

```
Client (oidc-client-ts) → Keycloak /token (grant_type=refresh_token)
Keycloak → Client: new access_token (used silently for the next call)
```

### SSE streaming flow

```
┌────────┐       ┌────────┐       ┌────────┐       ┌──────────┐
│ Client │       │ Kong   │       │ Backend │       │ ChatQnA  │
│ (SSE)  │       │ Gateway │   │ (Proxy) │       │ (OPEA)   │
└───┬────┘       └───┬────┘       └───┬────┘       └────┬─────┘
    │                │                │                 │
    │ POST /api/queries/stream       │                 │
    │────────────────────────────────>│                 │
    │                │                │ POST /v1/chat/completions
    │                │                │─────────────────>│
    │                │                │                 │
    │                │                │<─ SSE: chunk ───│
    │ SSE: chunk     │                │                 │
    │<───────────────│                │                 │
    │                │                │<─ SSE: chunk ───│
    │ SSE: chunk     │                │                 │
    │<───────────────│                │                 │
    │                │                │<─ SSE: metadata │
    │ SSE: metadata  │                │                 │
    │<───────────────│                │                 │
    │                │                │<─ SSE: done ────│
    │ SSE: done      │                │                 │
    │<───────────────│                │                 │
    │                │                │ Backend: translationService.translate()
    │                │                │                 │
    │ SSE: translation                │                 │
    │<───────────────│                │                 │
```

### Document ingestion flow

```
┌──────────────┐       ┌──────────────────┐       ┌──────────┐
│ Admin User   │       │ Document Repo    │       │ Dataprep │
│ (Browser)    │       │   :3001          │       │ :5000    │
└──────┬───────┘       └────┬─────────────┘       └────┬─────┘
       │                     │                         │
       │ POST /api/files     │                         │
       │ (multipart)         │                         │
       │────────────────────>│                         │
       │                     │                         │
       │                     │ 1. ClamAV scan          │
       │                     │    (clamdscan)          │
       │                     │                         │
       │                     │ 2. Extract text         │
       │                     │    (Docling, etc.)      │
       │                     │                         │
       │ { fileId, metadata } │                         │
       │<────────────────────│                         │
       │                     │                         │
       │                     │ 3. Trigger ingestion    │
       │                     │────────────────────────>│
       │                     │                         │
       │                     │ 4. Fetch labels         │
       │                     │    GET /api/service-categories
       │                     │    (Keycloak SA token)  │
       │                     │                         │
       │                     │ 5. Chunk content        │
       │                     │ 6. Assign labels        │
       │                     │ 7. Generate embeddings  │
       │                     │    (TEI)                │
       │                     │                         │
       │                     │ 8. Store in ArangoDB    │
       │                     │                         │
       │ { ingestionStatus } │                         │
       │<────────────────────│                         │
```

---

## Authentication & Authorization

### Transport security

| Layer | Protocol | Termination |
|---|---|---|
| External → NGINX | HTTPS (TLS 1.3) | NGINX |
| NGINX → Kong | HTTP (internal) | — |
| Kong → Services | HTTP (internal) | — |
| Services → Databases | HTTP/HTTPS (internal) | — |

**Internal network:** Docker bridge network (`genieai_network`) — all
inter-service traffic is unencrypted within the cluster.

**SSL certificates:** stored in `secrets/ssl/` (gitignored).

### Authentication

| Service | Method | Token source |
|---|---|---|
| Frontend/Mobile → Backend | Bearer JWT | Keycloak OIDC |
| Backend → Keycloak (Admin API) | Bearer JWT | Service account |
| Dataprep → Backend | Bearer JWT | Service account (`client_credentials`) |
| Backend → ArangoDB | Basic auth | `ARANGO_USER` / `ARANGO_PASSWORD` |
| Backend → Redis | Optional password | `TRANSLATION_CACHE_PASSWORD` |

**JWT validation:** backend validates the JWT signature against the Keycloak
JWKS endpoint (`services/keycloak-auth-service.js`); checks signature,
expiry, issuer, audience.

### Authorization

**Role-Based Access Control (RBAC):** Keycloak realm roles.

| Role | Permissions |
|---|---|
| `user` (default) | Chat, profile management, own analytics |
| `admin` | Document upload, label management, all analytics |
| `service-account` | Dataprep (label fetch only) |

### CORS configuration

**Kong Gateway:** applied at the gateway level (`CORS_ALLOWED_ORIGINS`).

**Backend dev mode:** `cors()` middleware (effectively bypassed in
production because Kong is in front).

---

## Service Discovery & Routing

### Docker Compose (single-node)

**Service naming:** Docker internal DNS (service names as hostnames).

```yaml
services:
  backend:
    # Accessible as "http://backend:3000" from other containers
  chatqna:
    # Accessible as "http://chatqna-xeon-backend-server:8888"
```

**Environment variables:** each service reads its dependencies from the
`env` file (Docker Compose passes them via `env_file` or `environment:`).

### Docker Swarm (multi-node)

**Service placement:** node labels control where services run.

```bash
docker node update --label-add gpu=true <gpu-node>
docker node update --label-add gateway=true <gateway-node>
docker node update --label-add genieai=true <genieai-node>
```

**Placement constraints** (`docker-compose.yaml`):

```yaml
deploy:
  placement:
    constraints:
      - node.labels.gateway == true  # Kong, NGINX
      - node.labels.genieai == true  # Backend, Frontend
      - node.labels.gpu == true      # vLLM, TEI, ChatQnA, dataprep-arango, retriever-arango
```

**Service discovery:** Swarm internal DNS + overlay network (`genieai_network`).

### Kong gateway routing

**Static configuration:** `api-gateway-solution/new-config/kong_config.json`.

**Verify the live Kong routes match the file** (useful after a deploy):

```bash
# From a container with access to the kong network:
docker exec <kong-container> curl -s http://localhost:8001/routes | jq '.data[].paths[]'
# or, from the host:
docker exec <kong-container> curl -s http://localhost:8001/routes | jq '.data[].paths[]'
```

Compare against `jq '.routes[].paths' api-gateway-solution/new-config/kong_config.json`.

**Service definitions:** Kong has 4 services (`express-api`,
`document-repository`, `keycloak`, `grafana`) — see the [live routes
table](#live-routes-from-kong_configjson) above.

**Health checks:** Kong passive health checking (429, 500, 503 → mark
unhealthy); active checks are configured but disabled by default.

**Load balancing:** round-robin (default).

---

## Error Handling & Resilience

### Backend error handling

**Global error handler** (inline in `index.js`):

```javascript
app.use((err, req, res, _next) => {
  logger.error('Unhandled error', { error: err.message, stack: err.stack });
  res.status(err.status || 500).json({
    error: {
      code: err.code || 'INTERNAL_SERVER_ERROR',
      message: err.message || 'An unexpected error occurred',
      details: process.env.NODE_ENV === 'development' ? err.stack : undefined
    }
  });
});
```

**OPEA worker error handling** (`services/opea-worker.js`):

```javascript
try {
  const response = await axios.post(chatqnaUrl, payload, { timeout: 120000 });
  return response.data;
} catch (error) {
  if (error.code === 'ECONNABORTED') {
    throw new Error('AI service timeout');
  }
  throw new Error(`AI service error: ${error.message}`);
}
```

### Timeout configurations

| Service | Timeout | Reason |
|---|---|---|
| Kong → Backend | 60s (read) | Standard API calls |
| Kong → Backend (stream) | 3600s (1h) | SSE long-running queries |
| Backend → ChatQnA | 120s | LLM inference time |
| Backend → Translation | 3600s (1h) | Long documents (translation-service.js: hardcoded 3600000ms) |
| Backend → ArangoDB | 30s | Database queries |

### Retry logic

**Backend → OPEA services:** no retry logic is implemented today. The
OPEA worker (`components/gov-chat-backend/services/opea-worker.js`) uses a
hard 120s axios timeout (`timeout: 120000`). Add retries only when there
is a real outage to mitigate.

**Kong → Backend:** passive retry (mark unhealthy, retry after health check
passes).

### Circuit breakers

**Kong:** passive health checking (no active circuit-breaker plugin
configured).

**Backend:** **no circuit breaker is wired today.** Earlier docs showed a
proposed snippet using `opossum` or `circuit-breaker`; that is not yet in
production. Add one only when there is a real outage to mitigate.

---

## Security Considerations

### Secrets management

**Environment variables** (`.env` file, gitignored):

```bash
# Database passwords
ARANGO_PASSWORD=...
POSTGRES_PASSWORD=...
TRANSLATION_CACHE_PASSWORD=...   # only used when TRANSLATION_CACHE=on

# Keycloak secrets
KEYCLOAK_ADMIN_PASSWORD=...
KEYCLOAK_CLIENT_SECRET=...
KC_DATAPREP_CLIENT_SECRET=...
KEYCLOAK_PROXY_CLIENT_SECRET=...

# API keys
HUGGING_FACE_HUB_TOKEN=...
```

**Docker secrets** (Swarm mode):

```bash
echo "secret_value" | docker secret create arango_password -
# Reference in docker-compose.yaml:
secrets:
  arango_password:
    external: true
```

### Rate limiting

**Kong plugin:** applied globally (`kong-rate-limit.sh`).

```json
{
  "rate_limiting": {
    "minute": 1000,
    "hour": 10000,
    "policy": "local",
    "limit_by": "consumer"
  }
}
```

**Backend rate limiting:** `express-rate-limit` is available as a
fallback, but is not active in production (Kong handles it).

### Monitoring & Observability

**Logging**

- Backend: Winston with daily rotation (`components/shared/lib/logger.js`).
- Frontend: console (dev only).
- Mobile: `talker` logger (local file + stderr).
- OPEA services: Python `logging` module.

**Centralised log storage:** VictoriaLogs via the OTel Collector
(`fluentd` driver → OTel Collector fluent_forward receiver on port 24224,
localhost only). All services use the `fluentd` logging driver; Docker dual
logging keeps `docker logs` working too.

**Metrics**

- Kong: Prometheus metrics at `kong:8001/metrics` (internal only).
- Backend: OTel SDK (`tracing.js`, `tracing-db.js`, `tracing-pii.js`) +
  Prometheus metrics (`metrics.js`).
- OPEA services: OTel SDK (`genie-ai-overlay/tracing.py`) emitting per-RAG
  stage spans.

### Health checks

| Service | Endpoint | Purpose |
|---|---|---|
| Backend | `/api/health` | Basic liveness (status, serverTime, uptime) |
| Document Repository | `/health` | Basic liveness (status, timestamp, uptime, env, version) |
| ChatQnA | `/health` | OPEA microservice health |
| Kong | `/health` | Gateway status |
| Keycloak | `/health/ready` | Realm ready |

---

## Related

| You want to… | Read |
|---|---|
| Deploy the stack (Compose / Swarm / Ansible) | [Deployment](/docs/deploy/) |
| Trace a request through the RAG pipeline | [Observability](/docs/observe/) |
| Look up an environment variable | [Configuration](/docs/configure/) |
| Find where a route or service lives in code | [Source Tree Analysis](/docs/core/source-tree-analysis/) |
| Set up a local dev environment | [Development Guide](/docs/core/development-guide/) |
| Understand the high-level system diagram | [Architecture](/docs/architecture/) |
