---
title: "Integration Architecture"
description: "How the GENIE.AI components integrate: service boundaries, dependencies, and the inter-service contract surface."
weight: 3
section: "core"
---

> **For integrators and developers.** How the components fit together: service boundaries, dependencies, and the inter-service contract surface.

This document describes the integration points, communication patterns, and data flows between all components of the GENIE.AI platform.

## Table of Contents

- [System Overview](#system-overview)
- [Integration Points](#integration-points)
- [Communication Protocols](#communication-protocols)
- [Data Flow Diagrams](#data-flow-diagrams)
- [Authentication & Authorization](#authentication--authorization)
- [Service Discovery & Routing](#service-discovery--routing)
- [Error Handling & Resilience](#error-handling--resilience)
- [Security Considerations](#security-considerations)

---

## System Overview

GENIE.AI is a monorepo consisting of 6 main parts that communicate through REST APIs, SSE (Server-Sent Events), and direct database connections:

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
│         │                   │                            │                   │
│         └───────────────────┼────────────────────────────┘                   │
│                             │                                        │      │
│                             v                                        v      │
│  ┌────────────────────────────────────────────────────────────────────┐   │
│  │                     Application Layer                              │   │
│  │  ┌────────────────┐    ┌──────────────────┐    ┌────────────────┐  │   │
│  │  │   Express.js   │    │   Document       │    │   Keycloak     │  │   │
│  │  │    Backend     │<-->|   Repository     │    │  (OIDC Provider)│  │   │
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
│  │  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └────────┘ │  │
│  │  ┌──────────┐                                                         │  │
│  │  │ Dataprep │                                                         │  │
│  │  └──────────┘                                                         │  │
│  └──────────────────────────────────────────────────────────────────────┘  │
│                                                                             │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Integration Points

### 1. Frontend ↔ Backend

**Protocol**: HTTP/HTTPS (REST API)

**Authentication**: OIDC Authorization Code Flow with Keycloak

**Transport Layer**: Axios HTTP client

**Key Integration Details**:

- **Base URL Configuration**: Frontend reads API URL from `window.APP_CONFIG?.apiUrl` or `VUE_APP_API_URL` env variable
- **Token Management**: Frontend stores Keycloak JWT in localStorage and injects via `Authorization: Bearer <token>` header
- **CORS Handling**: All requests proxied through Kong gateway (no direct backend access)

**Primary Endpoints**:

| Endpoint | Method | Purpose | Response Type |
|----------|--------|---------|---------------|
| `/api/auth/login` | POST | Initiate OIDC login | Redirect to Keycloak |
| `/api/auth/callback` | POST | OIDC callback handler | JWT token |
| `/api/auth/refresh-token` | POST | Refresh access token | New JWT |
| `/api/queries` | POST | Submit non-streaming query | JSON response |
| `/api/queries/stream` | POST | Submit streaming query (SSE) | Server-Sent Events |
| `/api/queries/:queryId/responsetime` | PATCH | Update query metrics | JSON |
| `/api/chat/conversations` | GET/POST | Conversation CRUD | JSON array/object |
| `/api/chat/messages` | GET | Fetch conversation messages | JSON array |
| `/api/me` | GET | Get user profile | JSON |
| `/api/me` | PUT | Update user profile | JSON |
| `/api/me/context` | GET | Get user context/preferences | JSON |
| `/api/analytics/*` | GET | Analytics dashboards | JSON |
| `/api/service-categories` | GET | Knowledge base categories | JSON |
| `/api/files` | POST | Upload documents (admin only) | JSON |

**Service Code**:
- Frontend: `src/services/chatbotService.js`, `src/services/httpService.js`, `src/services/keycloakAuthService.js`
- Backend: `routes/query-routes.js`, `routes/chat-routes.js`, `routes/auth-routes.js`

---

### 2. Mobile ↔ Backend

**Protocol**: HTTP/HTTPS (REST API + SSE streaming)

**Authentication**: OIDC PKCE Flow with Keycloak via `flutter_appauth` (forked)

**Transport Layer**:
- REST: OpenAPI-generated client (`openapi/`) using `http` package
- Streaming: Custom `http.Client` with `AuthInterceptor` wrapper for SSE

**Key Integration Details**:

- **OpenAPI Client**: Auto-generated from backend JSDoc annotations via `scripts/generate-api-client.sh`
- **Flavor Configuration**: dev (localhost), e2e, staging, itu (prod) — each with distinct URL schemes and bundle IDs
- **Token Injection**: `AuthInterceptor` wraps `http.Client` to automatically inject Bearer tokens
- **SSL Pinning Bypass**: Local `flutter_appauth` fork allows `allowInsecureConnections` for dev self-signed certs

**Primary Endpoints**: Same as Frontend → Backend

**Service Code**:
- Mobile: `lib/providers/api_providers.dart`, `lib/services/auth/auth_interceptor.dart`, `lib/services/keycloak/`
- Generated Client: `openapi_client/lib/api/`
- SSE Parser: `lib/services/sse_parser.dart` (parses chunk/metadata/translation/done/error events)

---

### 3. Backend ↔ ArangoDB

**Protocol**: HTTP/HTTPS (arangojs driver)

**Driver**: `arangojs` v8.8.1

**Connection Details**:

```javascript
const db = new Database({
  url: process.env.ARANGO_URL || 'http://arango:8529',
  databaseName: process.env.ARANGO_DB || 'genieai',
  auth: { username: 'root', password: process.env.ARANGO_PASSWORD }
});
```

**Collections Used**:

| Collection | Type | Purpose | Indexes |
|------------|------|---------|---------|
| `users` | Document | User profiles, preferences | `user_id` (unique), `email` (unique) |
| `conversations` | Document | Chat conversation threads | `userId` (persistent), `updatedAt` (TTL) |
| `messages` | Document | Individual chat messages | `conversationId` (persistent), `timestamp` |
| `queries` | Document | Query logs and analytics | `userId`, `timestamp`, `categoryId` |
| `serviceCategories` | Document | Knowledge base categories | `nameEN` (unique) |
| `services` | Document | Service catalog items | `nameEN` (unique) |
| `serviceCategoryTranslations` | Document | Category translations | `sourceKey`, `languageCode` |
| `sessions` | Document | Active user sessions | `userId`, `expiresAt` (TTL) |
| `analytics` | Document | Pre-computed analytics | `type`, `period` |

**Edge Collections (Graph)**:
- `serviceCategoryTranslationsEdge` — Links translations to source categories

**Vector Search**:
- ArangoDB v3.12+ supports vector similarity search on embedded chunks
- Collections: `chunks` (document embeddings), `chunk_edges` (knowledge graph links)

**Service Code**:
- Database: `shared-lib/database/db.js`, `shared-lib/database/arango-client.js`
- Migrations: `scripts/migrations/*.js`

---

### 4. Backend ↔ Redis

**Protocol**: TCP (Redis protocol)

**Driver**: `ioredis` v5.8.2

**Connection Details**:

```javascript
const Redis = require('ioredis');
const redis = new Redis({
  host: process.env.REDIS_HOST || 'redis',
  port: process.env.REDIS_PORT || 6379,
  password: process.env.REDIS_PASSWORD
});
```

**Use Cases**:

| Purpose | Key Pattern | TTL | Example |
|---------|-------------|-----|---------|
| Translation Cache | `translation:${lang}:${hash}` | 24h | Cached Google Cloud translations |
| Session Cache | `session:${userId}` | 7d | User session data |
| Rate Limiting | `ratelimit:${userId}:${endpoint}` | 1h | Request counters |
| Analytics Cache | `analytics:${type}:${period}` | 1h | Pre-aggregated metrics |
| Category Tree | `categories:tree` | 1h | Hierarchical category structure |

**Service Code**:
- Cache: `services/cache-service.js`
- Translation: `services/translation-service.js`

---

### 5. Backend ↔ ChatQnA (AI/ML Layer)

**Protocol**: HTTP (REST API + SSE streaming)

**Backend Implementation**: Worker threads via `services/opea-worker.js`

**ChatQnA Service**: Python FastAPI (port 8888)

**Request Flow**:

```
Backend QueryService
  ↓
POST http://chatqna:8888/v1/chat/completions
  ↓ (worker thread for non-blocking)
ChatQnA Service
  ↓
OPEA Microservice Orchestration:
  1. Embedding Service (TEI + BAAI/bge-base-en-v1.5)
  2. Retriever Service (ArangoDB vector + graph traversal)
  3. Reranker Service (Cross-encoder model)
  4. LLM Service (vLLM + meta-llama/Meta-Llama-3.1-8B-Instruct; recommended ibm-granite/granite-4.1-8b)
  ↓
Response → Backend → Client (SSE or JSON)
```

**Request Payload**:

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

**Response (SSE Events)**:

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

**Environment Variables**:

| Variable | Purpose | Default |
|----------|---------|---------|
| `CHATQNA_SERVICE_HOST_IP` | ChatQnA host | `chatqna` |
| `CHATQNA_SERVICE_PORT` | ChatQnA port | `8888` |
| `LLM_SERVER_HOST_IP` | vLLM host | `vllm` |
| `LLM_SERVER_PORT` | vLLM port | `80` |
| `EMBEDDING_SERVER_HOST_IP` | TEI embedding host | `tei-embedding` |
| `EMBEDDING_SERVER_PORT` | TEI embedding port | `80` |
| `RETRIEVER_SERVICE_HOST_IP` | Retriever host | `retriever` |
| `RETRIEVER_SERVICE_PORT` | Retriever port | `7000` |
| `RERANK_SERVER_HOST_IP` | Reranker host | `tei-reranking` |
| `RERANK_SERVER_PORT` | Reranker port | `80` |

**Service Code**:
- Backend: `services/opea-worker.js`, `routes/query-routes.js`
- ChatQnA: `genie-ai-overlay/chatqna/genieai_chatqna.py`

---

### 6. Backend ↔ Document Repository

**Protocol**: HTTP (REST API, internal Docker network)

**Purpose**: File upload, virus scanning, document metadata, labeling

**Integration Points**:

| Backend Endpoint | Doc Repo Endpoint | Purpose |
|------------------|-------------------|---------|
| `/api/files` (proxy) | `POST /api/files` | Upload file (multipart/form-data) |
| Query source documents | `GET /api/files/:id` | Fetch file metadata for citations |
| Category-driven labeling | `POST /api/labels` | Assign labels to uploaded files |

**Document Processing Pipeline**:

```
Backend (POST /api/files)
  ↓
Document Repository (upload endpoint)
  ↓
ClamAV (virus scanning)
  ↓
Text Extraction (pdfminer, python-docx, etc.)
  ↓
Dataprep Service (chunking, embedding)
  ↓
ArangoDB (vectors + metadata)
```

**ClamAV Integration**:

```javascript
// Document repository calls ClamAV before storage
const clamav = require('clamav.js');
await clamav.scanFile(filePath);
```

**Service Code**:
- Backend: `routes/file-routes.js`
- Doc Repo: `components/document-repository/`

---

### 7. Backend ↔ Keycloak

**Protocol**: HTTPS (OIDC protocol + Admin API)

**Keycloak URLs**:
- Well-known config: `https://<domain>/auth/realms/<realm>/.well-known/openid-configuration`
- Token endpoint: `/auth/realms/<realm>/protocol/openid-connect/token`
- UserInfo: `/auth/realms/<realm>/protocol/openid-connect/userinfo`
- Admin API: `/auth/admin/realms/<realm>/`

**JWT Validation Flow**:

```javascript
// middleware/keycloak-auth-middleware.js
async function authenticate(req, res, next) {
  const token = extractBearerToken(req);
  const decoded = await keycloakAuthService.verifyToken(token);

  // Token contains: sub, email, name, preferred_username, etc.
  req.user = decoded;
  req.userId = decoded.sub; // Keycloak subject

  // Auto-provision user in ArangoDB
  await userProvisioningService.findOrCreate(decoded);

  next();
}
```

**Token Refresh Flow**:

```javascript
// Client-side (Frontend/Mobile)
POST /api/auth/refresh-token
{
  "refresh_token": "<refresh-token>"
}

// Backend → Keycloak
POST https://<keycloak>/auth/realms/<realm>/protocol/openid-connect/token
grant_type=refresh_token&refresh_token=<token>&client_id=<client_id>
```

**Admin API Operations**:

| Operation | Endpoint | Purpose |
|-----------|----------|---------|
| Get user | `GET /admin/realms/<realm>/users/{id}` | Fetch user profile |
| Create user | `POST /admin/realms/<realm>/users` | Provision new user |
| Update user | `PUT /admin/realms/<realm>/users/{id}` | Sync profile changes |
| Delete user | `DELETE /admin/realms/<realm>/users/{id}` | Deactivate account |

**Service Code**:
- Backend: `services/keycloak-auth-service.js`, `middleware/keycloak-auth-middleware.js`
- Frontend: `src/services/keycloakAuthService.js`
- Mobile: `lib/services/keycloak/keycloak_service.dart`

---

### 8. Client → Kong → Backend (API Gateway)

**Protocol**: HTTPS (TLS termination at NGINX)

**Kong Configuration**: `api-gateway-solution/new-config/kong_config.json`

**Routing Rules**:

| Route | Service | Backend | Path Handling |
|-------|---------|---------|---------------|
| `/api` | express-api | backend:3000 | `strip_path: false` |
| `/api/auth` | express-api | backend:3000 | `strip_path: false` |
| `/api/files` | document-repository | document-repository:3001 | `strip_path: false` |
| `/api/labels` | document-repository | document-repository:3001 | `strip_path: false` |
| `/auth` | keycloak | keycloak:8080 | `strip_path: true` (rewrites to `/realms/<realm>/...`) |

**SSE Streaming Configuration**:

Critical for `/api/queries/stream` — Kong must not buffer the response:

```json
{
  "name": "queries-stream-route",
  "paths": ["/api/queries/stream"],
  "response_buffering": false,  // ← REQUIRED for SSE
  "read_timeout": 3600000       // 1 hour for long-running queries
}
```

**Kong Plugins Applied**:

| Plugin | Purpose | Configuration |
|--------|---------|---------------|
| Rate Limiting | Prevent abuse | 1000 req/min, 10000 req/hour |
| CORS | Cross-origin headers | Allowed origins from env |
| JWT (future) | Token validation at gateway | Not currently used (validation at backend) |
| Prometheus | Metrics export | `/metrics` endpoint |
| Request Transformer | Headers rewrite | Add `X-Forwarded-For`, etc. |

**Health Checks**:

```bash
# Kong active health checks (passive)
curl http://kong:8001/health/enabled
# Kong checks: 429, 500, 503 → mark target unhealthy
```

**NGINX Configuration** (`api-gateway-solution/nginx/`):

- TLS termination (SSL certificates)
- Reverse proxy to Kong (port 8000)
- Static file serving (if needed)
- WebSocket/SSE passthrough (proxy_buffering off)

**Service Code**:
- Kong: `api-gateway-solution/new-config/manage-kong-config.sh`
- NGINX: `api-gateway-solution/nginx/nginx.conf`

---

### 9. Backend ↔ Translation Services

**Protocol**: HTTPS (REST API)

**Two Translation Backends**:

1. **Google Cloud Translation API** (primary, production):

```javascript
// services/translation-service.js
const { TranslationServiceClient } = require('@google-cloud/translate');
const client = new TranslationServiceClient();

async translate(text, from, to) {
  const [response] = await client.translateText({
    parent: `projects/${projectId}/locations/global`,
    contents: [text],
    mimeType: 'text/plain',
    sourceLanguageCode: from,
    targetLanguageCode: to
  });
  return response.translations[0].translatedText;
}
```

2. **vLLM Translation** (offline, sovereign):

```javascript
// Calls vLLM service directly (bypasses OPEA translation proxy)
const VLLM_TRANSLATION_ENDPOINT = process.env.VLLM_TRANSLATION_ENDPOINT;
// Model: google/gemma-3-1b-it or similar

async translate(text, from, to) {
  const response = await axios.post(`${VLLM_TRANSLATION_ENDPOINT}/v1/chat/completions`, {
    model: process.env.VLLM_TRANSLATION_MODEL_ID,
    messages: [{ role: 'user', content: `Translate to ${to}: ${text}` }]
  });
  return response.choices[0].message.content;
}
```

**Backend Endpoints**:

| Endpoint | Purpose | Method |
|----------|---------|--------|
| `/api/translate` | Translate plain text | POST |
| `/api/translate/markdown` | Translate Markdown (preserves formatting) | POST |
| `/api/queries/stream` | Auto-translate response (SSE event: `translation`) | POST |

**Translation Flow in SSE**:

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

**Environment Variables**:

| Variable | Purpose | Default |
|----------|---------|---------|
| `GOOGLE_CLOUD_PROJECT` | GCP project ID | - |
| `GOOGLE_CLOUD_CREDENTIALS` | GCP service account key | - |
| `VLLM_TRANSLATION_ENDPOINT` | vLLM translation URL | - |
| `VLLM_TRANSLATION_MODEL_ID` | Translation model | `google/gemma-3-1b-it` |
| `TRANSLATION_BACKEND` | `google` or `vllm` | `google` |

**Service Code**:
- Backend: `services/translation-service.js`

---

### 10. Dataprep ↔ ArangoDB (Document Ingestion)

**Protocol**: HTTP (arangojs driver) + internal OPEA orchestration

**Purpose**: Chunk, embed, and store documents from Document Repository

**Dataprep Pipeline**:

```
Document Repository (triggers ingestion)
  ↓
Dataprep Service receives document URL
  ↓
Content Extraction (Docling, pdfminer, etc.)
  ↓
Text Splitting (RecursiveCharacterTextSplitter)
  ↓
Label Assignment (LLM-based or embedding-based)
  ↓
Embedding Generation (TEI service)
  ↓
ArangoDB Storage:
  - chunks collection (document + vector)
  - chunk_edges (knowledge graph links)
```

**Labeling Strategies**:

1. **LLM-based** (default, requires `VLLM_TRANSLATION_ENDPOINT`):

```python
# Uses LLM to assign 1-4 relevant labels per chunk
LABEL_SELECTOR_SYSTEM_PROMPT = """
You are a precise semantic labeler for a RAG knowledge graph.
Assign 1-4 MOST RELEVANT labels from: {labels_list}
...
"""
```

2. **Embedding-based** (fallback, cosine similarity):

```python
# Compares chunk embedding to label embeddings
if similarity > EMBEDDING_LABEL_THRESHOLD:
    assign_label()
```

3. **BM25-based** (keyword matching):

```python
# Uses BM25Okapi for keyword-based labeling
if score > BM25_LABEL_THRESHOLD:
    assign_label()
```

**Authentication**:

- Dataprep uses **service account** (client_credentials grant) to call backend
- Obtains labels from `/api/service-categories` endpoint

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

**Service Code**:
- Dataprep: `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py`
- Keycloak SA: `genie-ai-overlay/dataprep/keycloak_service_account.py`

---

## Communication Protocols

### HTTP/REST

All synchronous request-response communication uses REST APIs over HTTP/HTTPS:

- **Frontend/Mobile → Backend**: Axios (JS), http package (Dart)
- **Backend → ChatQnA**: Axios (Node.js)
- **Backend → Document Repository**: Axios (Node.js)
- **Backend → Keycloak**: Axios (Node.js)
- **Backend → Translation**: Google Cloud SDK or Axios (vLLM)

**Standard Response Format**:

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

**Error Response Format**:

```json
{
  "error": {
    "code": "QUERY_VALIDATION_ERROR",
    "message": "Invalid query parameters",
    "details": { ... }
  }
}
```

---

### Server-Sent Events (SSE)

**Use Case**: Real-time streaming of LLM responses from ChatQnA

**Endpoint**: `POST /api/queries/stream`

**Event Types**:

| Type | Payload | Purpose |
|------|---------|---------|
| `chunk` | `{ content: "text" }` | Incremental LLM token |
| `metadata` | `{ source_documents: [...], confidence_score: 0.85 }` | Citation + confidence |
| `translation` | `{ content: "translated text" }` | Final translation (replaces chunks) |
| `done` | `{ queryId: "abc123" }` | Stream complete |
| `error` | `{ message: "Error description" }` | Stream-level error |

**SSE Format**:

```
data: {"type":"chunk","content":"Hello"}

data: {"type":"metadata","source_documents":[...],"confidence_score":0.9}

data: {"type":"done","queryId":"abc123"}
```

**Keepalive**: SSE comments (`: ping`) sent every 15s to prevent connection timeout.

**Frontend Implementation** (Fetch API):

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

**Mobile Implementation** (http.Client):

```dart
final request = http.Request('POST', Uri.parse('$baseUrl/api/queries/stream'))
  ..headers['Authorization'] = 'Bearer $token'
  ..headers['Content-Type'] = 'application/json'
  ..body = jsonEncode(queryData);

final streamedResponse = await httpClient.send(request);

await for (final chunk in streamedResponse.stream.transform(utf8.decoder)) {
  for (final event in SseParser.parseChunk(chunk)) {
    switch (event) {
      case SseChunkEvent():
        appendContent(event.content);
      case SseMetadataEvent():
        updateSources(event.sourceDocuments);
      case SseTranslationEvent():
        replaceContent(event.content);
      case SseDoneEvent():
        saveQuery(event.queryId);
      case SseErrorEvent():
        showError(event.message);
    }
  }
}
```

**Kong Configuration** (CRITICAL):

```json
{
  "name": "queries-stream-route",
  "response_buffering": false,  // ← Must be false for SSE
  "read_timeout": 3600000       // 1 hour
}
```

---

### Direct Database Connections

**Backend → ArangoDB**: arangojs driver (HTTP-based)

**Backend → Redis**: ioredis driver (TCP-based)

**No other services** connect directly to databases — all access goes through the Backend API.

---

## Data Flow Diagrams

### RAG Pipeline Flow

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
     │                 │                 │    Orchestration:
     │                 │                 │                   │
     │                 │                 │    1. Embedding
     │                 │                 │       <───────┐
     │                 │                 │                   │
     │                 │                 │    2. Retrieval (ArangoDB)
     │                 │                 │                   │
     │                 │                 │    3. Reranking
     │                 │                 │                   │
     │                 │                 │    4. LLM Inference
     │                 │                 │                   │
     │ SSE: chunk      │                 │<──────────────────│
     │<─────────────────────────────────│                   │
     │                 │                 │                   │
     │ SSE: chunk      │                 │<──────────────────│
     │<─────────────────────────────────│                   │
     │                 │                 │                   │
     │ SSE: metadata   │                 │<──────────────────│
     │<─────────────────────────────────│                   │
     │                 │                 │                   │
     │ SSE: done       │                 │<──────────────────│
     │<─────────────────────────────────│                   │
     │                 │                 │                   │
     │ Backend translates (if needed)    │                   │
     │                 │                 │                   │
     │ SSE: translation│                 │                   │
     │<─────────────────────────────────│                   │
     │                 │                 │                   │
```

---

### Authentication Flow

```
┌─────────┐       ┌─────────┐       ┌─────────┐       ┌──────────┐
│ Client  │       │ Keycloak│       │ Backend │       │ArangoDB  │
│ (Web/Mobile) │   │ (OIDC)  │   │ (API)   │       │          │
└────┬────┘       └────┬────┘       └────┬────┘       └────┬─────┘
     │                 │                 │                 │
     │ 1. OIDC Authorize                │                 │
     │────────────────>│                 │                 │
     │                 │                 │                 │
     │ 2. User logs in                  │                 │
     │                 │                 │                 │
     │ 3. Redirect + code               │                 │
     │<────────────────│                 │                 │
     │                 │                 │                 │
     │ 4. POST /api/auth/callback       │                 │
     │    { code }                      │                 │
     │─────────────────────────────────>│                 │
     │                 │                 │                 │
     │                 │ 5. Token exchange│                 │
     │                 │────────────────>│                 │
     │                 │                 │                 │
     │                 │ 6. JWT (access + refresh)
     │                 │<────────────────│                 │
     │                 │                 │                 │
     │ 7. Return JWT   │                 │                 │
     │<─────────────────────────────────│                 │
     │                 │                 │                 │
     │ 8. Store token  │                 │                 │
     │    (localStorage/secure storage)  │                 │
     │                 │                 │                 │
     │ 9. API request with Bearer token  │                 │
     │─────────────────────────────────>│                 │
     │                 │                 │                 │
     │                 │                 │ 10. Validate JWT
     │                 │                 │────────────────>│
     │                 │                 │                 │
     │                 │                 │ 11. Provision user
     │                 │                 │<────────────────│
     │                 │                 │                 │
     │ 12. Response    │                 │                 │
     │<─────────────────────────────────│                 │
     │                 │                 │                 │
```

**Token Refresh** (automatic before expiry):

```
Client → Backend: POST /api/auth/refresh-token { refresh_token }
Backend → Keycloak: POST /token (grant_type=refresh_token)
Keycloak → Backend: New access_token
Backend → Client: New JWT
```

---

### SSE Streaming Flow

```
┌────────┐       ┌────────┐       ┌────────┐       ┌──────────┐
│ Client │       │ Kong   │       │ Backend │       │ ChatQnA  │
│ (SSE) │       │ Gateway │   │ (Proxy) │   │ (OPEA)   │
└───┬────┘       └───┬────┘       └───┬────┘       └────┬─────┘
    │                │                │                 │
    │ POST /api/queries/stream       │                 │
    │────────────────────────────────>│                 │
    │                │                │                 │
    │                │                │ POST /v1/chat/completions
    │                │                │─────────────────>│
    │                │                │                 │
    │                │                │<─ SSE: chunk ───│
    │ SSE: chunk     │                │                 │
    │<───────────────│                │                 │
    │                │                │                 │
    │                │                │<─ SSE: chunk ───│
    │ SSE: chunk     │                │                 │
    │<───────────────│                │                 │
    │                │                │                 │
    │                │                │<─ SSE: metadata │
    │ SSE: metadata  │                │                 │
    │<───────────────│                │                 │
    │                │                │                 │
    │                │                │<─ SSE: done ────│
    │ SSE: done      │                │                 │
    │<───────────────│                │                 │
    │                │                │                 │
    │                │                │ Backend: translationService.translate()
    │                │                │                 │
    │ SSE: translation                │                 │
    │<───────────────│                │                 │
    │                │                │                 │
```

**Client Handling**:

- **Web (Vue)**: Fetch API + `ReadableStream` reader
- **Mobile (Flutter)**: `http.Client.send()` + `SseParser`

---

### Document Ingestion Flow

```
┌──────────────┐       ┌──────────────────┐       ┌──────────┐
│ Admin User   │       │ Document Repo    │       │ Dataprep │
│ (Backend API)│   │   │              │   │          │
└──────┬───────┘       └────┬─────────────┘       └────┬─────┘
       │                     │                         │
       │ POST /api/files     │                         │
       │────────────────────>│                         │
       │                     │                         │
       │                     │ 1. ClamAV scan          │
       │                     │    ┌─────┐             │
       │                     │    │ClamAV│             │
       │                     │    └─────┘             │
       │                     │                         │
       │                     │ 2. Extract text        │
       │                     │    (Docling, etc.)      │
       │                     │                         │
       │ { fileId, metadata }│                         │
       │<────────────────────│                         │
       │                     │                         │
       │                     │ 3. Trigger ingestion    │
       │                     │────────────────────────>│
       │                     │                         │
       │                     │ 4. Fetch labels (Backend)
       │                     │    ┌─────────┐          │
       │                     │    │ Backend │          │
       │                     │    └─────────┘          │
       │                     │                         │
       │                     │ 5. Chunk content        │
       │                     │ 6. Assign labels        │
       │                     │ 7. Generate embeddings   │
       │                     │    ┌──────┐             │
       │                     │    │  TEI │             │
       │                     │    └──────┘             │
       │                     │                         │
       │                     │ 8. Store in ArangoDB    │
       │                     │    ┌──────────┐         │
       │                     │    │ ArangoDB │         │
       │                     │    └──────────┘         │
       │                     │                         │
       │ { ingestionStatus } │                         │
       │<────────────────────│                         │
```

---

## Service Discovery & Routing

### Docker Compose (Single-Node)

**Service Naming**: Docker internal DNS (service names as hostnames)

```yaml
services:
  backend:
    # Accessible as "http://backend:3000" from other containers

  chatqna:
    # Accessible as "http://chatqna:8888"
```

**Environment Variables**: Each service reads its dependencies from `env` file:

```bash
BACKEND_SERVICE_URL=http://backend:3000
CHATQNA_SERVICE_HOST_IP=chatqna
CHATQNA_SERVICE_PORT=8888
ARANGO_URL=http://arango:8529
REDIS_HOST=redis
```

---

### Docker Swarm (Multi-Node)

**Service Placement**: Node labels control where services run:

```bash
docker node update --label-add gpu=true <gpu-node>
docker node update --label-add gateway=true <gateway-node>
docker node update --label-add genieai=true <genieai-node>
```

**Placement Constraints** (docker-compose.yaml):

```yaml
deploy:
  placement:
    constraints:
      - node.labels.gateway == true  # Kong, NGINX
      - node.labels.genieai == true  # Backend, Frontend
      - node.labels.gpu == true      # vLLM, TEI
```

**Service Discovery**: Swarm internal DNS + overlay network (`genieai_network`)

---

### Kong Gateway Routing

**Static Configuration**: `api-gateway-solution/new-config/kong_config.json`

**Service Definitions**:

```json
{
  "services": [
    { "name": "express-api", "host": "backend", "port": 3000 },
    { "name": "document-repository", "host": "document-repository", "port": 3001 },
    { "name": "keycloak", "host": "keycloak", "port": 8080 }
  ]
}
```

**Route Definitions**: Prefix-based routing (all routes have `strip_path: false`)

**Health Checks**: Kong passive health checking (429, 500, 503 → mark unhealthy)

**Load Balancing**: Round-robin algorithm (default)

---

## Error Handling & Resilience

### Backend Error Handling

**Global Error Handler** (`middleware/error-handler.js`):

```javascript
app.use((err, req, res, next) => {
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

**OPEA Worker Error Handling** (`services/opea-worker.js`):

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

---

### Timeout Configurations

| Service | Timeout | Reason |
|---------|---------|--------|
| Kong → Backend | 60s (read) | Standard API calls |
| Kong → Backend (stream) | 3600s (1h) | SSE long-running queries |
| Backend → ChatQnA | 120s | LLM inference time |
| Backend → Translation | 180s | Google Cloud API |
| Backend → ArangoDB | 30s | Database queries |
| Backend → Redis | 5s | Cache operations |

---

### Retry Logic

**Backend → OPEA Services**: Exponential backoff with max 3 retries

```javascript
const retry = require('async-retry');

await retry(
  async (bail) => {
    try {
      return await axios.post(url, payload);
    } catch (err) {
      if (err.response?.status === 400) bail(err); // Don't retry client errors
      throw err;
    }
  },
  { retries: 3, minTimeout: 1000, maxTimeout: 5000 }
);
```

**Kong → Backend**: Passive retry (mark unhealthy, retry after health check passes)

---

### Circuit Breakers

**Kong**: Passive health checking (no active circuit breaker plugin configured)

**Backend**: Manual circuit breaking for OPEA services (planned)

```javascript
// Future: Use opossum or circuit-breaker package
const breaker = new CircuitBreaker(opeaWorkerCall, {
  timeout: 120000,
  errorThresholdPercentage: 50,
  resetTimeout: 30000
});
```

---

## Security Considerations

### Transport Security

| Layer | Protocol | Termination |
|-------|----------|-------------|
| External → NGINX | HTTPS (TLS 1.3) | NGINX |
| NGINX → Kong | HTTP (internal) | - |
| Kong → Services | HTTP (internal) | - |
| Services → Databases | HTTP/HTTPS (internal) | - |

**Internal Network**: Docker bridge network (`genieai_network`) — all inter-service traffic is unencrypted within the cluster.

**SSL Certificates**: Stored in `secrets/ssl/` (gitignored)

---

### Authentication

| Service | Method | Token Source |
|---------|--------|--------------|
| Frontend/Mobile → Backend | Bearer JWT | Keycloak OIDC |
| Backend → Keycloak (Admin API) | Bearer JWT | Service account |
| Dataprep → Backend | Bearer JWT | Service account (client_credentials) |
| Backend → ArangoDB | Basic auth | `ARANGO_USER` / `ARANGO_PASSWORD` |
| Backend → Redis | (optional) | `REDIS_PASSWORD` |

**JWT Validation**: Backend validates JWT signature against Keycloak JWKS endpoint

```javascript
const decoded = await keycloakAuthService.verifyToken(token);
// Checks: signature, expiry, issuer, audience
```

---

### Authorization

**Role-Based Access Control (RBAC)**: Keycloak realm roles

| Role | Permissions |
|------|-------------|
| `user` (default) | Chat, profile management, analytics (own data) |
| `admin` | Document upload, label management, all analytics |
| `service-account` | Dataprep (label fetch only) |

**Endpoint Protection**:

```javascript
// Example: Admin-only endpoint
router.post('/files', upload.single('file'), async (req, res, next) => {
  if (!req.user.realm_access.roles.includes('admin')) {
    return res.status(403).json({ error: 'FORBIDDEN' });
  }
  // ...
});
```

---

### CORS Configuration

**Kong Gateway**: Applied at gateway level

```json
{
  "cors": {
    "origins": ["https://example.com"], // From env
    "methods": ["GET", "POST", "PATCH", "DELETE"],
    "headers": ["Authorization", "Content-Type"],
    "credentials": true
  }
}
```

**Backend Development Mode**: `cors()` middleware (disabled in production via Kong)

---

### Secrets Management

**Environment Variables** (`.env` file, gitignored):

```bash
# Database passwords
ARANGO_PASSWORD=...
POSTGRES_PASSWORD=...
REDIS_PASSWORD=...

# Keycloak secrets
KEYCLOAK_ADMIN_PASSWORD=...
KEYCLOAK_CLIENT_SECRET=...
KC_DATAPREP_CLIENT_SECRET=...

# API keys
HUGGING_FACE_HUB_TOKEN=...
GOOGLE_CLOUD_CREDENTIALS=...
```

**Docker Secrets** (Swarm mode):

```bash
echo "secret_value" | docker secret create arango_password -
# Reference in docker-compose.yaml:
secrets:
  arango_password:
    external: true
```

---

### Rate Limiting

**Kong Plugin**: Applied globally

```json
{
  "rate_limiting": {
    "minute": 1000,   // 1000 requests/min
    "hour": 10000,    // 10000 requests/hour
    "policy": "redis",
    "redis_host": "redis",
    "redis_port": 6379
  }
}
```

**Backend Rate Limiting**: `express-rate-limit` (fallback, not used in production)

```javascript
const rateLimit = require('express-rate-limit');

const limiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100 // 100 requests per minute
});

app.use('/api/', limiter);
```

---

## Monitoring & Observability

### Logging

**Backend**: Winston + daily rotation (`shared-lib/logger.js`)

**Frontend**: Console (dev) + Sentry (planned)

**Mobile**: `talker` logger (local file + stderr)

**OPEA Services**: Python `logging` module

**Centralized Logging**: VictoriaLogs via the OTel Collector (fluentd receiver) — see the Observability section

---

### Metrics

**Kong**: Prometheus metrics at `http://kong:8001/metrics`

**Backend**: OTel SDK (tracing.js, tracing-db.js, tracing-pii.js) + Prometheus metrics (metrics.js)

**OPEA Services**: OTel SDK (tracing.py) emitting per-RAG-stage spans

---

### Health Checks

| Service | Endpoint | Purpose |
|---------|----------|---------|
| Backend | `/health` | ArangoDB + Redis connectivity |
| Document Repository | `/health` | ClamAV + ArangoDB |
| ChatQnA | `/health` | OPEA microservice health |
| Kong | `/health` | Gateway status |
| Keycloak | `/health/ready` | Realm ready |

**Kong Active Health Checks** (configured but disabled by default):

```json
{
  "healthcheck": {
    "active": {
      "http_path": "/health",
      "healthy": { "interval": 10, "successes": 2 },
      "unhealthy": { "interval": 5, "http_failures": 3 }
    }
  }
}
```

---

## Appendix: Environment Variables

### Backend (`components/gov-chat-backend/`)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `NODE_ENV` | No | `production` | Environment mode |
| `PORT` | No | `3000` | Backend port |
| `ARANGO_URL` | No | `http://arango:8529` | ArangoDB connection |
| `ARANGO_DB` | No | `genieai` | Database name |
| `ARANGO_USER` | No | `root` | Database user |
| `ARANGO_PASSWORD` | **Yes** | - | Database password |
| `REDIS_HOST` | No | `redis` | Redis host |
| `REDIS_PORT` | No | `6379` | Redis port |
| `REDIS_PASSWORD` | No | - | Redis password |
| `KEYCLOAK_URL` | **Yes** | - | Keycloak URL |
| `KEYCLOAK_REALM` | No | `genie` | Realm name |
| `BACKEND_SERVICE_URL` | No | `http://backend:3000` | Service URL for internal calls |
| `CHATQNA_SERVICE_HOST_IP` | No | `chatqna` | ChatQnA host |
| `CHATQNA_SERVICE_PORT` | No | `8888` | ChatQnA port |
| `VLLM_TRANSLATION_ENDPOINT` | No | - | vLLM translation URL |
| `GOOGLE_CLOUD_PROJECT` | No | - | GCP project ID |
| `GOOGLE_CLOUD_CREDENTIALS` | No | - | GCP service account key |
| `TRANSLATION_BACKEND` | No | `google` | Translation backend |

### OPEA Services (`genie-ai-overlay/`)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `MEGA_SERVICE_PORT` | No | `8888` | ChatQnA port |
| `LLM_SERVER_HOST_IP` | No | `vllm` | vLLM host |
| `LLM_SERVER_PORT` | No | `80` | vLLM port |
| `EMBEDDING_SERVER_HOST_IP` | No | `tei-embedding` | TEI host |
| `EMBEDDING_SERVER_PORT` | No | `80` | TEI port |
| `RETRIEVER_SERVICE_HOST_IP` | No | `retriever` | Retriever host |
| `RETRIEVER_SERVICE_PORT` | No | `7000` | Retriever port |
| `RERANK_SERVER_HOST_IP` | No | `tei-reranking` | Reranker host |
| `RERANK_SERVER_PORT` | No | `80` | Reranker port |
| `BACKEND_SERVICE_URL` | No | `http://backend:3000` | Backend URL |
| `DOCUMENT_REPOSITORY_URL` | No | `http://document-repository:3001` | Doc repo URL |
| `KC_DATAPREP_CLIENT_ID` | **Yes** | - | Dataprep service account |
| `KC_DATAPREP_CLIENT_SECRET` | **Yes** | - | Dataprep client secret |

### Frontend (`components/gov-chat-frontend/`)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `VUE_APP_API_URL` | **Yes** | - | Backend API URL |
| `VUE_APP_KEYCLOAK_URL` | **Yes** | - | Keycloak URL |
| `VUE_APP_KEYCLOAK_REALM` | No | `genie` | Realm name |
| `VUE_APP_KEYCLOAK_CLIENT_ID` | **Yes** | - | OIDC client ID |

### Mobile (`mobile/genie_ai_mobile/`)

| Variable | Required | Default | Purpose |
|----------|----------|---------|---------|
| `DEV_SERVER` | No | `localhost` | Custom server host |
| `DEV_PORT` | No | `443` | Custom server port |
| `KEYCLOAK_URL` | **Yes** | - | Keycloak URL |
| `KEYCLOAK_REALM` | No | `genie` | Realm name |
| `KC_MOBILE_CLIENT_ID` | **Yes** | - | Mobile OIDC client ID |

---

## Document History

| Date | Version | Changes |
|------|---------|---------|
| 2025-01-12 | 1.0 | Initial integration architecture document |
