# API Contracts - gov-chat-backend

## Overview
The gov-chat-backend provides RESTful APIs with Keycloak OIDC authentication. All routes require authentication unless explicitly marked as public.

## Base URL
```
/api
```

## Authentication
All endpoints use Keycloak OAuth2 authentication with JWT Bearer tokens:
- Middleware: `keycloakAuthMiddleware.authenticate`
- Headers: `Authorization: Bearer <token>`
- User resolved from JWT claims: `req.user.iss_sub` (unique user identifier)

---

## API Routes by Category

### 1. Authentication Routes (`/auth`)

#### POST `/auth/logout`
- **Description**: User logout endpoint (Keycloak handles session invalidation server-side)
- **Authentication**: Required
- **Request Body**: None
- **Response**:
  - `200`: Logout successful
  - `401`: Unauthorized

---

### 2. Current User Routes (`/api/me`)

#### GET `/api/me`
- **Description**: Get current user profile (singleton, user resolved from JWT)
- **Authentication**: Required
- **Response**:
  ```json
  {
    "email": "user@example.com",
    "createdAt": "2024-01-01T00:00:00Z",
    "updatedAt": "2024-01-01T00:00:00Z",
    "displayName": "John Doe",
    "country": "US",
    "preferredLanguage": "en"
  }
  ```
- **Status Codes**:
  - `200`: Success
  - `401`: Authentication required
  - `404`: User not found
  - `500`: Server error

#### GET `/api/me/context`
- **Description**: Get sanitized user context for AI enrichment
- **Authentication**: Required
- **Response**: Sanitized user subset for OPEA AI
- **Status Codes**:
  - `200`: Success
  - `401`: Missing or invalid token
  - `404`: User not found

#### PUT `/api/me`
- **Description**: Update current user profile
- **Authentication**: Required
- **Request Body**:
  ```json
  {
    "displayName": "Updated Name",
    "country": "FR",
    "preferredLanguage": "fr"
  }
  ```

#### POST `/api/me/reset-data`
- **Description**: Reset user data (GDPR right to be forgotten)
- **Authentication**: Required

#### POST `/api/me/delete`
- **Description**: Delete user account (GDPR right to erasure)
- **Authentication**: Required

---

### 3. Query Routes (`/api/queries`)

#### POST `/api/queries`
- **Description**: Create a new query (single-message or full conversation mode)
- **Authentication**: Required
- **Request Body**:
  ```json
  {
    "sessionId": "string",
    "query": "string",
    "categoryId": "string",
    "labels": ["string"],
    "language": "en",
    "conversationHistory": []
  }
  ```
- **Response**: Created query object with ID

#### PATCH `/api/queries/:queryId/responsetime`
- **Description**: Update query response time for analytics
- **Authentication**: Required
- **Request Body**:
  ```json
  {
    "responseTime": 250
  }
  ```
- **Response**: Updated query object
- **Status Codes**:
  - `200`: Success
  - `400`: Response time required
  - `401`: Unauthorized
  - `404`: Query not found

#### POST `/api/queries/:queryId/feedback`
- **Description**: Submit feedback on a query response
- **Authentication**: Required
- **Request Body**:
  ```json
  {
    "rating": 1,
    "categories": ["irrelevant", "inaccurate"],
    "comment": "Optional comment"
  }
  ```

---

### 4. Chat History Routes (`/api/chat-history`)

#### GET `/api/chat-history`
- **Description**: Get user's chat history
- **Authentication**: Required
- **Query Params**: `limit`, `offset`
- **Response**: Array of chat conversations

#### POST `/api/chat-history`
- **Description**: Create new chat conversation
- **Authentication**: Required
- **Request Body**:
  ```json
  {
    "title": "Chat Title",
    "serviceCategoryId": "string"
  }
  ```

#### DELETE `/api/chat-history/:chatId`
- **Description**: Delete a chat conversation
- **Authentication**: Required

---

### 5. Service Category Routes (`/api/service-categories`)

#### GET `/api/service-categories`
- **Description**: Get all service categories (with translation support)
- **Authentication**: Not required (public endpoint)
- **Response**: Array of service categories with hierarchy

#### GET `/api/service-categories/:categoryId`
- **Description**: Get specific service category
- **Authentication**: Not required

---

### 6. Service Routes (`/api/services`)

#### GET `/api/services`
- **Description**: Get all services (filtered by category optionally)
- **Authentication**: Not required
- **Query Params**: `categoryId`

---

### 7. Analytics Routes (`/api/analytics`)

#### GET `/api/analytics/usage`
- **Description**: Get usage analytics data
- **Authentication**: Required
- **Query Params**: `period`, `startDate`, `endDate`

#### GET `/api/analytics/satisfaction`
- **Description**: Get user satisfaction metrics
- **Authentication**: Required

#### GET `/api/analytics/queries`
- **Description**: Get top queries statistics
- **Authentication**: Required

---

### 8. Admin Routes (`/api/admin`)

#### GET `/api/admin/logs`
- **Description**: Get application logs
- **Authentication**: Required (Admin role)

#### POST `/api/admin/database/operations`
- **Description**: Execute database operations
- **Authentication**: Required (Admin role)

#### GET `/api/admin/analytics`
- **Description**: Get admin analytics dashboard data
- **Authentication**: Required (Admin role)

---

### 9. Translation Routes (`/api/translation`)

#### POST `/api/translation/translate`
- **Description**: Translate text using configured translation backend
- **Authentication**: Required
- **Request Body**:
  ```json
  {
    "text": "Hello world",
    "targetLanguage": "fr"
  }
  ```

---

### 10. Weather Routes (`/api/weather`)

#### GET `/api/weather`
- **Description**: Get weather information for user's location
- **Authentication**: Required
- **Query Params**: `location`, `units`

---

### 11. Database Operations Routes (`/api/database-operations`)

#### POST `/api/database-operations/export`
- **Description**: Export database data
- **Authentication**: Required (Admin role)

#### POST `/api/database-operations/import`
- **Description**: Import database data
- **Authentication**: Required (Admin role)

---

### 12. Logger Routes (`/api/logger`)

#### GET `/api/logger/search`
- **Description**: Search application logs
- **Authentication**: Required (Admin role)
- **Query Params**: `level`, `startDate`, `endDate`, `query`

---

## Route Files Summary

| Route File | Endpoints | Auth Required |
|------------|-----------|---------------|
| `auth-routes.js` | POST `/logout` | Yes |
| `user-routes.js` | CRUD `/api/me` | Yes |
| `query-routes.js` | CRUD `/queries` | Yes |
| `chat-history-routes.js` | CRUD `/chat-history` | Yes |
| `service-category-routes.js` | GET `/service-categories` | No |
| `service-routes.js` | GET `/services` | No |
| `analytics-routes.js` | GET `/analytics/*` | Yes |
| `admin-routes.js` | Admin endpoints | Yes (Admin) |
| `translation-routes.js` | POST `/translation/translate` | Yes |
| `weather-routes.js` | GET `/weather` | Yes |
| `database-operations-routes.js` | DB operations | Yes (Admin) |
| `logger-routes.js` | GET `/logger/search` | Yes (Admin) |

## Error Response Format

All endpoints return errors in the following format:
```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable error message",
  "details": {}
}
```

Common error codes:
- `TOKEN_INVALID`: Invalid or expired JWT
- `TOKEN_EXPIRED`: JWT token has expired
- `FORBIDDEN`: Insufficient permissions
- `PROVISIONING_FAILED`: User provisioning failed
- `AUTH_SERVICE_UNAVAILABLE`: Keycloak service unavailable

## Rate Limiting

All authenticated endpoints are rate-limited using `express-rate-limit`.
- Default limit configurable via environment variables
- Rate limit headers included in responses

## CORS

CORS is configured for allowed origins via `CORS_ALLOWED_ORIGINS` environment variable.
