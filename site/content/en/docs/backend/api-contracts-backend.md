---
title: "Api Contracts Backend"
description: "Backend (BFF) HTTP API contracts: auth, chat, files, analytics, and admin endpoints with request/response schemas."
weight: 1
section: "backend"
---

> **For integrators.** The backend (BFF) HTTP API contracts — request/response shapes for auth, chat, files, analytics, and admin endpoints.

**Component**: `components/gov-chat-backend/` (Node.js/Express)
**Base URL**: `https://<domain>/api` (via Kong Gateway)
**Documentation**: Swagger/OpenAPI available at `/api-docs`

## Authentication

All endpoints (except where noted) require Keycloak JWT authentication via `Authorization: Bearer <token>` header.

**Auth middleware**: `keycloakAuthMiddleware.authenticate` (Keycloak OIDC)
**Admin endpoints**: Additional `keycloakAuthMiddleware.requireAdmin` middleware

---

## Route Domains

### 1. Authentication Routes (`/api/auth`)

**Route File**: `routes/auth-routes.js`
**Auth Required**: None (login/logout endpoints)
**Base Paths**: `/api/auth`

| Method | Path | Auth Required | Description | Notes |
|--------|------|---------------|-------------|-------|
| POST | `/logout` | Yes | Logout user | Invalidates Keycloak session |

---

### 2. User Profile Routes (`/api/me`)

**Route File**: `routes/user-routes.js`
**Auth Required**: **Yes** (all endpoints)
**Base Paths**: `/api/me`

| Method | Path | Auth Required | Description | Notes |
|--------|------|---------------|-------------|-------|
| GET | `/` | Yes | Get user profile | Returns singleton user profile |
| GET | `/context` | Yes | Get user context | User preferences, settings |
| POST | `/reset-data` | Yes | Reset user data | Clears user conversations/data |
| POST | `/delete` | Yes | Delete user account | Soft/hard delete user account |
| PUT | `/` | Yes | Update user profile | Supports file upload (avatar) |

---

### 3. Query Routes (`/api/queries`, `/api/query`)

**Route File**: `routes/query-routes.js`
**Auth Required**: **Yes** (all endpoints)
**Base Paths**: `/api/queries`, `/api/query`
**Special**: SSE support on `/stream` endpoint

| Method | Path | Auth Required | Description | Notes |
|--------|------|---------------|-------------|-------|
| POST | `/stream` | Yes | Stream query response (SSE) | **text/event-stream**, requires SSE enabled (default; `OPEA_STREAMING≠false`) |
| POST | `/` | Yes | Create new query | Standard non-streaming query |
| GET | `/` | Yes | List queries | Paginated query list |
| GET | `/:queryId` | Yes | Get query by ID | Full query details |
| PATCH | `/:queryId/responsetime` | Yes | Update query response time | Internal metrics |
| POST | `/:queryId/feedback` | Yes | Submit feedback | User feedback on query result |
| PATCH | `/:queryId/answered` | Yes | Mark query as answered | Status update |
| GET | `/:queryId/conversations` | Yes | Get conversations for query | Link queries ↔ conversations |
| POST | `/:queryId/conversation` | Yes | Create conversation for query | Auto-link query to conversation |
| POST | `/:queryId/link/:messageId` | Yes | Link query to message | Explicit query-message linkage |

**SSE Event Types** (`/stream` endpoint):
- `chunk` - LLM response content
- `metadata` - Query metadata (queryId, responseTime, etc.)
- `translation` - Translated content (if enabled)
- `error` - Error message with code
- `done` - Stream completion

---

### 4. Chat History Routes (`/api/chat`, `/api/chat-history`)

**Route File**: `routes/chat-history-routes.js`
**Auth Required**: **Yes** (all endpoints)
**Base Paths**: `/api/chat`, `/api/chat-history`

| Method | Path | Auth Required | Description | Notes |
|--------|------|---------------|-------------|-------|
| GET | `/conversations` | Yes | List user conversations | Paginated, filterable |
| GET | `/conversations/:conversationId` | Yes | Get conversation details | Full conversation with messages |
| POST | `/conversations` | Yes | Create new conversation | Initialize conversation |
| PATCH | `/conversations/:conversationId` | Yes | Update conversation | Title, metadata |
| DELETE | `/conversations/:conversationId` | Yes | Delete conversation | Soft delete |
| GET | `/conversations/:conversationId/messages` | Yes | Get conversation messages | Paginated message list |
| POST | `/conversations/:conversationId/messages` | Yes | Add message to conversation | Create message |
| POST | `/conversations/:conversationId/messages/read` | Yes | Mark messages as read | Read receipt |
| GET | `/query/:queryId/messages` | Yes | Get messages for query | Reverse lookup |
| GET | `/messages/:messageId/query` | Yes | Get query for message | Reverse lookup |
| POST | `/query/:queryId/conversation` | Yes | Create conversation from query | Auto-link |
| GET | `/search` | Yes | Search conversations | Full-text search |
| GET | `/recent` | Yes | Get recent conversations | Quick access |
| GET | `/stats` | Yes | Get conversation statistics | User stats |
| GET | `/folders` | Yes | List folders | User folders |
| POST | `/folders` | Yes | Create folder | New folder |
| GET | `/folders/:folderId` | Yes | Get folder details | Folder metadata |
| PATCH | `/folders/:folderId` | Yes | Update folder | Rename, metadata |
| DELETE | `/folders/:folderId` | Yes | Delete folder | Cascade delete contents |
| GET | `/folders/search` | Yes | Search folders | Folder search |
| POST | `/folders/reorder` | Yes | Reorder folders | Custom sort order |
| GET | `/folders/:folderId/path` | Yes | Get folder path | Breadcrumb trail |
| POST | `/folders/:folderId/conversations/:conversationId` | Yes | Add conversation to folder | Folder membership |
| DELETE | `/folders/:folderId/conversations/:conversationId` | Yes | Remove conversation from folder | Folder membership |
| GET | `/conversations/:conversationId/folder` | Yes | Get conversation folder | Folder lookup |
| POST | `/conversations/:conversationId/move` | Yes | Move conversation to folder | Change folder |

---

### 5. Analytics Routes (`/api/analytics`)

**Route File**: `routes/analytics-routes.js`
**Auth Required**: **Yes** (all endpoints)
**Base Paths**: `/api/analytics`

| Method | Path | Auth Required | Description | Notes |
|--------|------|---------------|-------------|-------|
| GET | `/dashboard` | Yes | Get analytics dashboard | Aggregate metrics |
| GET | `/metric/:metric` | Yes | Get specific metric | Generic metric lookup |
| GET | `/` | Yes | Get analytics overview | High-level stats |
| GET | `/timeseries/:metricType` | Yes | Get timeseries data | Time-based metrics |
| POST | `/events` | Yes | Record analytics event | Event tracking |
| GET | `/records` | Yes | Get analytics records | Raw event records |
| GET | `/events` | Yes | Get events | Filtered event list |
| GET | `/satisfaction/gauge` | Yes | Get satisfaction gauge | User satisfaction metric |
| GET | `/satisfaction/heatmap` | Yes | Get satisfaction heatmap | Satisfaction by category |

---

### 6. Admin Routes (`/api/admin`)

**Route File**: `routes/admin-routes.js`
**Auth Required**: **Yes + Admin Role** (all endpoints)
**Base Paths**: `/api/admin`
**Middleware**: `keycloakAuthMiddleware.authenticate` + `keycloakAuthMiddleware.requireAdmin`

| Method | Path | Auth Required | Description | Notes |
|--------|------|---------------|-------------|-------|
| GET | `/system-health` | Admin | Get system health | Service status checks |
| GET | `/database/stats` | Admin | Get database statistics | ArangoDB stats |
| GET | `/logs` | Admin | Get application logs | Log retrieval |
| POST | `/logs/rollover` | Admin | Trigger log rollover | Log rotation |
| GET | `/user-stats` | Admin | Get user statistics | User metrics |
| GET | `/security-metrics` | Admin | Get security metrics | Security events |
| POST | `/security-scan` | Admin | Trigger security scan | Security audit |
| GET | `/security/last-scan` | Admin | Get last security scan | Scan results |
| POST | `/diagnostics` | Admin | Run diagnostics | System diagnostics |
| GET | `/logs/summary` | Admin | Get logs summary | Aggregated log stats |
| GET | `/logs/search` | Admin | Search logs | Log search |
| GET | `/logs/debug-yesterday` | Admin | Get yesterday's debug logs | Debug log retrieval |
| POST | `/database-operations/backup` | Admin | Trigger database backup | Backup operation |
| POST | `/database-operations/optimize` | Admin | Optimize database | DB optimization |
| GET | `/users/search` | Admin | Search users | User lookup |
| GET | `/queries/inspect` | Admin | List queries for inspection | Query Inspector |
| GET | `/queries/inspect/:queryId` | Admin | Inspect a specific query | Query detail |

---

### 7. Service Category Routes (`/api/service-categories`)

**Route File**: `routes/service-category-routes.js`
**Auth Required**: **Yes** (all endpoints)
**Base Paths**: `/api/service-categories`

| Method | Path | Auth Required | Description | Notes |
|--------|------|---------------|-------------|-------|
| GET | `/categories` | Yes | List service categories | Hierarchical categories |
| GET | `/categories/detailed` | Yes | Get detailed categories | With translations, services |
| GET | `/categories/:categoryId` | Yes | Get category by ID | Category details |
| GET | `/:categoryId/translations` | Yes | Get category translations | Multilingual translations |
| GET | `/services/:serviceId/translations` | Yes | Get service translations | Service translations |
| GET | `/search` | Yes | Search categories | Full-text search |
| POST | `/` | Yes | Create category | New category |
| DELETE | `/:categoryId` | Yes | Delete category | Soft delete |
| DELETE | `/services/:serviceId` | Yes | Delete service | Soft delete |
| POST | `/init` | Yes | Initialize categories | Seed categories |
| POST | `/:categoryId/services` | Yes | Add service to category | Link service |
| PUT | `/:categoryId` | Yes | Update category | Category metadata |
| PUT | `/services/:serviceId` | Yes | Update service | Service metadata |

---

### 8. Service Routes (`/api/services`)

**Route File**: `routes/service-routes.js`
**Auth Required**: **Yes** (all endpoints)
**Base Paths**: `/api/services`

| Method | Path | Auth Required | Description | Notes |
|--------|------|---------------|-------------|-------|
| GET | `/categories` | Yes | List all services | Flat service list |
| GET | `/categories/:categoryId` | Yes | Get services by category | Category services |
| GET | `/search` | Yes | Search services | Full-text search |

---

### 9. Translation Routes (`/api/translate`)

**Route File**: `routes/translation-routes.js`
**Auth Required**: **Yes** (all endpoints)
**Base Paths**: `/api/translate`

| Method | Path | Auth Required | Description | Notes |
|--------|------|---------------|-------------|-------|
| POST | `/` | Yes | Translate text | Text translation |
| POST | `/markdown` | Yes | Translate markdown | Markdown-aware translation |

---

### 10. Weather Routes (`/api/weather`)

**Route File**: `routes/weather-routes.js`
**Auth Required**: **Yes** (all endpoints)
**Base Paths**: `/api/weather`

| Method | Path | Auth Required | Description | Notes |
|--------|------|---------------|-------------|-------|
| POST | `/` | Yes | Get weather data | Weather information |

---

### 11. Logger Routes (`/api/logger`)

**Route File**: `routes/logger-routes.js`
**Auth Required**: **Yes + Admin Role** (all endpoints)
**Base Paths**: `/api/logger`
**Middleware**: `keycloakAuthMiddleware.authenticate` + `keycloakAuthMiddleware.requireAdmin`

| Method | Path | Auth Required | Description | Notes |
|--------|------|---------------|-------------|-------|
| POST | `/configure` | Admin | Configure logger | Update log levels |
| POST | `/rollover` | Admin | Trigger log rollover | Log rotation |

---

### 12. Database Operations Routes (`/api/database`)

**Route File**: `routes/database-operations-routes.js`
**Auth Required**: **Yes** (all endpoints, admin-level operations)
**Base Paths**: `/api/database`

| Method | Path | Auth Required | Description | Notes |
|--------|------|---------------|-------------|-------|
| POST | `/backup` | Yes | Trigger database backup | Backup operation |
| POST | `/optimize` | Yes | Optimize database | DB optimization |

---

## Document Repository API

**Component**: `components/document-repository/` (Node.js/Express)
**Base URL**: `https://<domain>/api` (via Kong Gateway)

### File Routes (`/api/files`)

**Route File**: `src/routes/fileRoutes.js`
**Auth Required**: Mixed (Admin role for write operations)
**Base Paths**: `/api/files`

| Method | Path | Auth Required | Description | Notes |
|--------|------|---------------|-------------|-------|
| POST | `/upload` | Admin | Upload single file | `multipart/form-data` |
| POST | `/uploads` | Admin | Upload multiple files | Batch upload |
| POST | `/upload-link` | Admin | Upload file via link | URL-based upload |
| POST | `/crawl/schedule` | Admin | Schedule website crawl | Web crawling |
| GET | `/` | No | List all files | Paginated file list |
| GET | `/search` | No | Search metadata | Metadata search |
| GET | `/search/files` | No | Search files | Full-text search |
| GET | `/:fileId` | No | Get file metadata | File details |
| GET | `/:fileId/crawl-job` | Admin | Get crawl job status | Crawl status |
| GET | `/:fileId/crawl-metrics` | Admin | Get crawl metrics | Crawl analytics |
| GET | `/:fileId/crawl-log` | Admin | Get crawl logs | Crawl logs |
| POST | `/:fileId/kill-crawl` | Admin | Kill crawl task | Stop crawl |
| POST | `/:fileId/kill-ingest` | Admin | Kill ingestion task | Stop ingest |
| GET | `/:fileId/view` | No | View file | File preview |
| GET | `/:fileId/viewbrowser` | No | View file in browser | Browser preview |
| GET | `/:fileId/download` | No | Download file | File download |
| POST | `/downloads` | No | Download multiple files | Batch download |
| DELETE | `/:fileId` | Admin | Delete file | Soft delete |
| DELETE | `/` | Admin | Delete multiple files | Batch delete |
| PATCH | `/:fileId` | Admin | Update file metadata | File metadata |
| POST | `/:fileId/ingest` | Admin | Ingest file to RAG pipeline | Start ingestion |
| POST | `/:fileId/retract` | Admin | Retract file from RAG pipeline | Remove from vector store |
| POST | `/ingest` | Admin | Ingest multiple files | Batch ingestion |
| POST | `/retract` | Admin | Retract multiple files | Batch retraction |
| POST | `/:fileId/ingestion-log` | Admin | Add ingestion log entry | Log ingestion event |
| GET | `/:fileId/ingestion-log` | Admin | Get ingestion logs | Ingestion history |
| PATCH | `/:fileId/status` | Admin, Dataprep Service | Update file status | Status update |

**Auth Middleware**: `authorizeRole(['Admin'])` for write operations

---

### Label Routes (`/api/labels`)

**Route File**: `src/routes/labelRoutes.js`
**Auth Required**: **Admin Role** (all endpoints)
**Base Paths**: `/api/labels`

| Method | Path | Auth Required | Description | Notes |
|--------|------|---------------|-------------|-------|
| GET | `/` | Admin | List all labels | Hierarchical labels |
| GET | `/:labelId` | Admin | Get label by ID | Label details |
| POST | `/` | Admin | Create label | New label |
| PATCH | `/:labelId` | Admin | Update label | Label metadata |
| DELETE | `/:labelId` | Admin | Delete label | Soft delete |
| DELETE | `/:labelId/with-children` | Admin | Delete label tree | Cascade delete |
| GET | `/:labelId/related` | Admin | Get related labels | Label relationships |

**Auth Middleware**: `authorizeRole(['Admin'])` for all endpoints

---

## Middleware Reference

### Authentication Middleware

**Keycloak OIDC Authentication** (`keycloakAuthMiddleware.authenticate`)
- Validates JWT tokens from Keycloak
- Extracts user info from token
- Applied at router level or per-route

**Admin Role Check** (`keycloakAuthMiddleware.requireAdmin`)
- Requires `realm_access.roles` contains `admin`
- Applied after `authenticate` middleware

### Document Repository Auth

**Role Authorization** (`authorizeRole(['Admin', 'dataprep-service'])`)
- Checks Keycloak roles
- Supports multiple roles (OR logic)
- Some endpoints allow `dataprep-service` for internal calls

---

## SSE Streaming Protocol

**Endpoint**: `POST /api/queries/stream`

### Request Headers
```
Content-Type: application/json
Authorization: Bearer <token>
```

### Response Headers
```
Content-Type: text/event-stream
Cache-Control: no-cache
Connection: keep-alive
```

### Event Format
```
data: {"type": "chunk", "content": "response text"}

data: {"type": "metadata", "queryId": "123", "responseTime": 1234}

data: {"type": "translation", "content": "translated text"}

data: {"type": "error", "message": "error message", "code": "ERROR_CODE"}

data: {"type": "done", "queryId": "123"}

: keepalive
```

### Environment Control
- Enabled by default — any value other than the literal string `false` enables it
- Disable explicitly: `OPEA_STREAMING=false` (returns 501 error)

---

## Error Response Format

All endpoints return JSON errors:

```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable error message",
  "details": {}
}
```

### Common Error Codes
- `UNAUTHORIZED` - Missing or invalid token
- `FORBIDDEN` - Insufficient permissions
- `NOT_FOUND` - Resource not found
- `VALIDATION_ERROR` - Request validation failed
- `STREAMING_DISABLED` - SSE streaming disabled (for `/stream` endpoint)
- `CHATQNA_STREAM_ERROR` - Upstream OPEA service error
- `TRANSLATION_FAILED` - Translation service error

---

## Rate Limiting

Applied via Kong Gateway (configured in `api-gateway-solution/`):
- Default: 100 requests per minute per IP
- Authenticated users: Higher limits based on role
- Admin users: No rate limiting

---

## OpenAPI/Swagger Documentation

Interactive API documentation available at:
- **Development**: `http://localhost:3000/api-docs`
- **Production**: `https://<domain>/api-docs`

**Note**: Swagger definitions are inline in route files using JSDoc comments (`@swagger`, `@summary`, etc.)

---

## CORS Configuration

Configured in Kong Gateway (`api-gateway-solution/`):
- Allowed origins: `CORS_ALLOWED_ORIGINS` env var
- Allowed methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
- Allowed headers: Authorization, Content-Type, X-Requested-With

---

## Version History

- **v1.0** - Initial API design (2025)
- **v1.1** - Added folder management (2025)
- **v1.2** - Added SSE streaming (2025)
- **v1.3** - Added label routes (2025)
- **v1.4** - Refactored `/api/me` to singleton pattern (2025)

---

## Related Documentation

- [Architecture Overview](/docs/architecture/architecture/)


 - Project overview and conventions
