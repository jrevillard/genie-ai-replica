# GenieAI Mobile API Specification

> Extracted from the backend at `components/gov-chat-backend/` — Swagger spec + route files.
> This document covers **mobile-relevant endpoints only**. Admin-only endpoints are omitted.

**Base URL:** `https://app.youngailinz.org/api`
**Auth:** Bearer JWT token in `Authorization` header (except registration, login, password reset, availability checks)

---

## Field Naming Conventions

| Convention | Details |
|---|---|
| **Case** | All fields use `camelCase` |
| **ArangoDB IDs** | Backend returns `_key` (short ID) and `_id` (collection-prefixed, e.g. `conversations/123`). Always prefer `_key`; strip collection prefix from `_id` as fallback. |
| **Passwords** | SHA-256 hashed on client before transmission. Field name: `encPassword` (login/register), `newPassword` (reset), `currentPassword`/`newPassword` (change) |
| **Timestamps** | Conversations/folders: `created`/`updated`. Users: `createdAt`/`updatedAt`. Messages: `timestamp`. All ISO 8601. |
| **Message sender** | Backend uses `sender` ("user" \| "assistant"). Mobile UI may use `role` internally — map at repository layer. |
| **Category names** | Backend returns `nameEN` from service-categories endpoint, `name` from services endpoint. Also check `label` as fallback. |
| **Category IDs** | `catKey` (from `/service-categories/categories`), `_key` (from `/services/categories`), `key`, `id` — check all with fallbacks. |

---

## 1. Authentication

### POST `/auth/login`
Authenticate user and return JWT.

**Request:**
```json
{
  "loginName": "string (required — username or email)",
  "encPassword": "string (required — SHA-256 hash)"
}
```

**Response (200):**
```json
{
  "success": true,
  "accessToken": "string",
  "refreshToken": "string",
  "user": {
    "_key": "string",
    "loginName": "string",
    "email": "string",
    "role": "User|Admin|Manager"
  }
}
```

---

### POST `/auth/register`
Create new user account.

**Request:**
```json
{
  "loginName": "string (required)",
  "email": "string (required)",
  "encPassword": "string (required — SHA-256 hash)",
  "fullName": "string (optional)"
}
```

**Response (201):** Registration successful
**Response (409):** Username or email already exists

---

### POST `/auth/logout`
**Auth required.** Invalidate token.

**Response (200):** Logout successful

---

### GET `/auth/me`
**Auth required.** Get current user info.

**Response (200):**
```json
{
  "user": {
    "_key": "string",
    "loginName": "string",
    "email": "string",
    "emailVerified": true,
    "role": "User|Admin|Manager",
    "createdAt": "ISO 8601",
    "updatedAt": "ISO 8601"
  }
}
```
> **Note:** User fields are nested under a `"user"` key (same pattern as the login response).

---

### POST `/auth/password-reset`
Request password reset email.

**Request:**
```json
{
  "email": "string (required)"
}
```

**Response (200):** Reset email sent (always 200, even if email not found — security)

---

### POST `/auth/validate-token`
Check if a password reset token is still valid.

**Request:**
```json
{
  "token": "string (required)"
}
```

**Response (200):** Token valid
**Response (409):** Token already used
**Response (410):** Token expired

---

### POST `/auth/reset-password/confirm`
Reset password using token.

**Request:**
```json
{
  "token": "string (required)",
  "newPassword": "string (required — SHA-256 hash)"
}
```

**Response (200):** Password reset successful

---

### POST `/auth/change-password`
**Auth required.** Change password for authenticated user.

**Request:**
```json
{
  "currentPassword": "string (required — SHA-256 hash)",
  "newPassword": "string (required — SHA-256 hash)"
}
```

**Response (200):** Password changed

---

### POST `/auth/refresh-token`
Refresh JWT access token.

**Request:**
```json
{
  "refreshToken": "string (required)"
}
```

**Response (200):**
```json
{
  "success": true,
  "accessToken": "string",
  "refreshToken": "string"
}
```

---

### POST `/auth/resend-verification`
Resend email verification.

**Request:**
```json
{
  "email": "string (required)"
}
```

**Response (200):** Verification email sent

---

### GET `/auth/verify-email/:token`
Verify email via link. Returns redirect.

---

## 2. Users

### GET `/users/:userId`
**Auth required.** Get user profile.

**Response (200):**
```json
{
  "_key": "string",
  "email": "string",
  "emailVerified": true,
  "role": "string",
  "loginName": "string",
  "personalIdentification": {
    "fullName": "string",
    "dob": "string",
    "gender": "string",
    "nationality": "string"
  },
  "addressResidency": { "currentAddress": "string" },
  "createdAt": "ISO 8601",
  "updatedAt": "ISO 8601"
}
```

> **Note:** Profile data is nested under section objects (`personalIdentification`, `addressResidency`, etc.), not flat fields.

---

### PUT `/users/:userId`
**Auth required.** Update user profile or account settings.

**Request (JSON):**
```json
{
  "personalIdentification": { "fullName": "..." },
  "addressResidency": { "currentAddress": "..." }
}
```

Also supports `multipart/form-data` with `data` field containing JSON string + file attachments.

**Response (200):** Updated user object

---

### PUT `/users/email`
**Auth required.** Update email with password verification.

**Request:**
```json
{
  "email": "string (required)",
  "password": "string (required — SHA-256 hash)",
  "userId": "string (required)"
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "A verification email has been sent...",
  "shouldLogout": true
}
```

---

### GET `/users/check-username`
Check username availability.

**Query:** `?username=<value>`

**Response (200):**
```json
{ "available": true }
```

---

### GET `/users/check-email`
Check email availability.

**Query:** `?email=<value>`

**Response (200):**
```json
{ "available": true }
```

---

### POST `/users/reset-data`
**Auth required.** Reset profile data while preserving account.

**Response (200):** Data reset

---

### POST `/users/delete`
**Auth required.** Permanently delete account.

**Request:**
```json
{
  "password": "string (required — SHA-256 hash)",
  "reason": "string (optional)"
}
```

**Response (200):** Account deleted

---

### POST `/users/deactivate`
**Auth required.** Deactivate account (reversible).

**Request:**
```json
{
  "password": "string (required — SHA-256 hash)",
  "reason": "string (optional)"
}
```

**Response (200):** Account deactivated

---

## 3. Queries (Chat AI)

### POST `/queries`
**Auth required.** Submit a chat query to the AI.

**Request:**
```json
{
  "userId": "string (required)",
  "sessionId": "string (required)",
  "messages": [
    { "role": "user", "content": "string" },
    { "role": "assistant", "content": "string" }
  ],
  "context": {
    "categoryLabel": "string (optional)",
    "serviceLabels": ["string"] (optional),
    "language": "string (default: EN)"
  },
  "categoryId": "string (optional — also at top level)",
  "timestamp": "ISO 8601 (optional, defaults to now)"
}
```

> **Note:** `messages` array uses `role` (not `sender`). The `context` object and top-level `categoryId` are both accepted.

**Response (201):**
```json
{
  "_key": "string (queryId)",
  "answer": "string (or 'response')",
  "relatedDocuments": [
    {
      "id": "string (or _id, fileId)",
      "name": "string (or document_name, title)",
      "fileName": "string (or file_name)",
      "confidence": 0.95,
      "labels": ["string"]
    }
  ],
  "responseTime": 1234
}
```

> **Note:** Response field names vary — check `answer` then `response`. Document fields have multiple fallback names. Labels may be under `labels`, `tags`, or `keywords`.

---

### POST `/queries/:queryId/feedback`
**Auth required.** Submit feedback on a query response.

**Request:**
```json
{
  "rating": 4,
  "comment": "string (optional)"
}
```

> **Note:** `userId` is extracted from the JWT token on the backend; some implementations also send it in the body for compatibility.

**Response (200):** Feedback recorded

---

## 4. Chat History — Conversations

### GET `/chat/conversations`
**Auth required.** Get user conversations.

**Query Parameters:**
- `limit` (default: 20)
- `offset` (default: 0)
- `includeArchived` (default: false)
- `filterStarred` (default: false)
- `searchTerm` (optional)

**Response (200):**
```json
{
  "conversations": [
    {
      "_key": "string",
      "title": "string",
      "userId": "string",
      "folderId": "string|null",
      "categoryId": "string|null",
      "isStarred": false,
      "isArchived": false,
      "messageCount": 5,
      "lastMessagePreview": "string|null",
      "created": "ISO 8601",
      "updated": "ISO 8601",
      "tags": ["string"]
    }
  ],
  "pagination": { "total": 42, "limit": 20, "offset": 0 }
}
```

> **Timestamps:** `created`/`updated` — NOT `createdAt`/`updatedAt`

---

### GET `/chat/conversations/:conversationId`
**Auth required.** Get conversation with messages.

**Response (200):** Conversation object + `messages` array

---

### POST `/chat/conversations`
**Auth required.** Create conversation.

**Request:**
```json
{
  "title": "string (required)",
  "categoryId": "string (optional)",
  "initialMessage": "string (optional)",
  "tags": ["string"] (optional)
}
```

**Response (201):** Conversation object with `_key`

---

### PATCH `/chat/conversations/:conversationId`
**Auth required.** Update conversation.

**Request:** Any subset of:
```json
{
  "title": "string",
  "isStarred": true,
  "isArchived": false,
  "tags": ["string"],
  "categoryId": "string"
}
```

---

### DELETE `/chat/conversations/:conversationId`
**Auth required.** Delete conversation and all messages.

---

### GET `/chat/conversations/:conversationId/messages`
**Auth required.** Get messages.

**Query:** `limit` (default: 50), `offset` (default: 0), `newestFirst` (default: false)

**Response (200):**
```json
{
  "messages": [
    {
      "_key": "string",
      "content": "string",
      "sender": "user|assistant",
      "timestamp": "ISO 8601",
      "queryId": "string|null",
      "metadata": {}
    }
  ]
}
```

> **Critical:** Messages use `sender` field — NOT `role`.

---

### POST `/chat/conversations/:conversationId/messages`
**Auth required.** Add message.

**Request:**
```json
{
  "content": "string (required)",
  "sender": "user|assistant (required)",
  "queryId": "string (optional)",
  "metadata": {} (optional)
}
```

> **Critical:** Must use `sender`, not `role`.

---

## 5. Chat History — Folders

### GET `/chat/folders`
**Auth required.** Get user folders.

**Query:** `includeArchived` (default: false), `parentFolderId` (optional)

**Response (200):** Array of folder objects with `_key`, `name`, `created`, `updated`, `conversationCount`

---

### POST `/chat/folders`
**Auth required.** Create folder.

**Request:**
```json
{
  "name": "string (required)",
  "description": "string (optional)",
  "parentFolderId": "string (optional)",
  "color": "string (optional)",
  "icon": "string (optional)"
}
```

---

### PATCH `/chat/folders/:folderId`
**Auth required.** Update folder.

---

### DELETE `/chat/folders/:folderId`
**Auth required.** Delete folder.

**Query:** `deleteContents` (default: false)

---

### POST `/chat/folders/:folderId/conversations/:conversationId`
**Auth required.** Add conversation to folder.

> **Note:** Both IDs in URL path. `userId` from JWT.

---

### DELETE `/chat/folders/:folderId/conversations/:conversationId`
**Auth required.** Remove conversation from folder.

---

### POST `/chat/conversations/:conversationId/move`
**Auth required.** Move conversation between folders.

**Request:**
```json
{
  "sourceFolderId": "string|null",
  "targetFolderId": "string|null"
}
```

---

## 6. Service Categories

### GET `/services/categories`
**Auth required.** Get all categories with their services.

**Query:** `locale` (default: en)

**Response (200):**
```json
[
  {
    "_key": "string",
    "nameEN": "string",
    "descriptionEN": "string",
    "icon": "string",
    "services": [
      {
        "_key": "string",
        "nameEN": "string",
        "descriptionEN": "string"
      }
    ]
  }
]
```

> **Note:** Field names use `nameEN`/`descriptionEN` suffix. Parse with fallbacks: `nameEN` → `name` → `label`. IDs: `_key` → `catKey` → `key` → `id`.

---

### GET `/services/categories/:categoryId`
**Auth required.** Get single category with services.

**Query:** `locale` (default: en)

---

### GET `/services/search`
**Auth required.** Search across categories and services.

**Query:** `query` (required), `locale` (default: en)

**Response (200):**
```json
{
  "categories": [{ "_key": "...", "nameEN": "...", "relevance": 0.9 }],
  "services": [{ "_key": "...", "nameEN": "...", "categoryId": "...", "relevance": 0.8 }]
}
```

---

### GET `/service-categories/categories`
Alternative endpoint — simplified category tree.

**Query:** `locale` (default: en)

**Response (200):**
```json
[
  {
    "catKey": "string",
    "name": "string",
    "children": ["serviceKey1", "serviceKey2"]
  }
]
```

> **Note:** `children` can be an array of **strings** (just keys) or **objects** (full service data). Must handle both.

---

## Cross-Platform Implementation Notes

### ID Handling
All ArangoDB entities may return IDs in multiple forms:
1. `_key` — short key (preferred)
2. `_id` — prefixed with collection name (e.g., `conversations/abc123`) — strip prefix
3. `id` — sometimes present as alias

**Always implement fallback chain:** `_key` → `_id` (strip prefix) → `id`

### Timestamp Handling
| Entity | Created field | Updated field |
|---|---|---|
| Conversations | `created` | `updated` |
| Folders | `created` | `updated` |
| Messages | `timestamp` | — |
| Users | `createdAt` | `updatedAt` |

### Message role vs sender
- **Query API** (`POST /queries`): messages array uses `role` ("user" \| "assistant")
- **Chat History API** (`POST /chat/.../messages`): uses `sender` ("user" \| "assistant")
- Mobile apps should use `role` internally and map to `sender` when saving to chat history

### Password Hashing
Client must SHA-256 hash passwords before sending. Field names:
- Login: `encPassword`
- Register: `encPassword`
- Reset confirm: `newPassword`
- Change password: `currentPassword` + `newPassword`
- Delete/deactivate account: `password`
- Update email: `password`
