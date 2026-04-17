# GENIE.AI - RAG Framework API Routes

This document provides an overview of the API routes available in the GENIE.AI backend, a Retrieval-Augmented Generation (RAG) framework designed to implement advanced RAG use cases. These RESTful endpoints enable interaction with services that power the application, supporting features such as chat history management, database operations, authentication, analytics, user profile management, and weather data retrieval.

## Table of Contents

- [GENIE.AI - RAG Framework API Routes](#genieai---rag-framework-api-routes)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Architecture Diagram](#architecture-diagram)
  - [Authentication and Security](#authentication-and-security)
  - [Route Groups](#route-groups)
    - [Admin Routes](#admin-routes)
      - [Key Parameters](#key-parameters)
      - [Services Called](#services-called)
      - [Security](#security)
    - [Analytics Routes](#analytics-routes)
      - [Key Parameters](#key-parameters-1)
      - [Services Called](#services-called-1)
      - [Security](#security-1)
    - [Authentication Routes](#authentication-routes)
      - [Key Parameters](#key-parameters-2)
      - [Services Called](#services-called-2)
      - [Security](#security-2)
    - [Chat History Routes](#chat-history-routes)
      - [Key Parameters](#key-parameters-3)
      - [Services Called](#services-called-3)
      - [Security](#security-3)
    - [Database Operations Routes](#database-operations-routes)
      - [Key Parameters](#key-parameters-4)
      - [Services Called](#services-called-4)
      - [Security](#security-4)
    - [Logger Routes](#logger-routes)
      - [Key Parameters](#key-parameters-5)
      - [Services Called](#services-called-5)
      - [Security](#security-5)
    - [Query Routes](#query-routes)
      - [Key Parameters](#key-parameters-6)
      - [Services Called](#services-called-6)
      - [Security](#security-6)
    - [Service Category Routes](#service-category-routes)
      - [Key Parameters](#key-parameters-7)
      - [Services Called](#services-called-7)
      - [Security](#security-7)
    - [Service Routes](#service-routes)
      - [Key Parameters](#key-parameters-8)
      - [Services Called](#services-called-8)
      - [Security](#security-8)
    - [User Routes](#user-routes)
      - [Key Parameters](#key-parameters-10)
      - [Services Called](#services-called-10)
      - [Security](#security-10)
    - [Weather Routes](#weather-routes)
      - [Key Parameters](#key-parameters-11)
      - [Services Called](#services-called-11)
      - [Security](#security-11)
  - [Error Handling](#error-handling)
  - [Testing](#testing)
    - [Using Swagger UI](#using-swagger-ui)
    - [Using the Integration Test](#using-the-integration-test)

## Overview

GENIE.AI is a RAG framework that integrates retrieval and generation capabilities to provide intelligent, context-aware responses for various use cases. The API is organized into logical route groups, each corresponding to specific functionalities:

- **Admin Routes**: Manage system health, logs, security scans, and database operations.
- **Analytics Routes**: Provide insights into user interactions and system performance.
- **Authentication Routes**: Handle user authentication, registration, and password management.
- **Chat History Routes**: Manage user conversations, messages, and folder organization.
- **Database Operations Routes**: Perform database maintenance tasks like reindexing and backups.
- **Logger Routes**: Configure and manage logging settings.
- **Query Routes**: Handle user queries and their integration with conversations.
- **Service Category Routes**: Manage service categories and their hierarchies.
- **Service Routes**: Provide access to service information.
- **User Routes**: Manage user profiles and account settings.
- **Weather Routes**: Retrieve weather data for specified locations.

All routes are documented with Swagger annotations for easy reference and testing via the Swagger UI.

## Architecture Diagram

Below is a high-level architecture diagram illustrating how the API routes interact with services and the database in the GENIE.AI framework:

```mermaid
graph TD
    A[Client] -->|HTTP Requests| B[Express Router]
    B --> C[Authentication Middleware]
    C -->|Authenticated| D[Route Handlers]
    
    D --> E[Admin Routes]
    D --> F[Analytics Routes]
    D --> G[Auth Routes]
    D --> H[Chat History Routes]
    D --> I[Database Ops Routes]
    D --> J[Logger Routes]
    D --> K[Query Routes]
    D --> L[Service Category Routes]
    D --> M[Service Routes]
    D --> N[User Routes]
    D --> O[Weather Routes]

    E -->|Calls| Q[Admin Service]
    E -->|Calls| R[Security Scan Service]
    E -->|Calls| S[Logs Service]
    F -->|Calls| T[Analytics Service]
    G -->|Calls| U[Auth Service]
    H -->|Calls| V[Chat History Service]
    I -->|Calls| W[Database Service]
    J -->|Calls| X[Logger Service]
    K -->|Calls| Y[Query Service]
    L -->|Calls| Z[Service Category Service]
    M -->|Calls| Z[Service Category Service]
    N -->|Calls| AB[User Service]
    O -->|Calls| AD[Weather Service]

    Q -->|Accesses| AE[Database]
    R -->|Accesses| AE
    S -->|Accesses| AE
    T -->|Accesses| AE
    U -->|Accesses| AE
    V -->|Accesses| AE
    W -->|Accesses| AE
    X -->|Accesses| AE
    Y -->|Accesses| AE
    Z -->|Accesses| AE
    AB -->|Accesses| AE
    AD -->|Accesses| AE

    AE -->|Stores| AF[User Data]
    AE -->|Stores| AG[Conversations]
    AE -->|Stores| AH[Queries]
    AE -->|Stores| AI[Analytics]
    AE -->|Stores| AJ[Service Categories]
    AE -->|Stores| AK[Logs]
    AE -->|Stores| AL[Weather Data]
```

This diagram shows the flow from client requests through the Express router, authentication middleware, and route handlers to the respective services, which interact with the database to store and retrieve data.

## Authentication and Security

All routes require Keycloak OIDC authentication via `keycloakAuthMiddleware`, except public routes (`/health`, `/api-docs`, `/api/auth/callback`, `/api/auth/logout/callback`). The OPEA integration endpoint (`/users/:userId/context`) uses OIDC token propagation for service-to-service authentication.

- **JWT Token**: Must be included in the `Authorization` header as `Bearer <token>`.
- **Error Responses**:
  - **401 Unauthorized**: Missing or invalid token.
  - **403 Forbidden**: Insufficient permissions (e.g., non-admin accessing admin routes).
- **Token Management**:
  - Tokens are managed by Keycloak OIDC with automatic silent renew.

## Route Groups

### Admin Routes

**Base Path**: `/api/admin`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/system-health` | Retrieve system health metrics |
| GET | `/database/stats` | Get database statistics |
| GET | `/logs` | Retrieve system logs with filtering |
| POST | `/logs/rollover` | Trigger log rotation |
| GET | `/user-stats` | Get user statistics |
| GET | `/security-metrics` | Retrieve security metrics |
| POST | `/security-scan` | Run a security scan |
| GET | `/security/last-scan` | Get details of the last security scan |
| POST | `/diagnostics` | Run system diagnostics |
| GET | `/logs/summary` | Get logs summary by type and service |
| GET | `/logs/search` | Search logs with filtering |
| GET | `/logs/debug-yesterday` | Retrieve debug logs for yesterday |
| POST | `/database-operations/reindex` | Reindex database |
| POST | `/database-operations/backup` | Backup database |
| POST | `/database-operations/optimize` | Optimize database |
| GET | `/users/search` | Search users with filtering |

#### Key Parameters
- `limit`, `offset`: Pagination for logs and user searches.
- `level`, `service`: Filter logs by level (INFO, WARNING, ERROR) or service name.
- `term`, `field`: Search criteria for logs and users.
- `date`, `dateRange`, `startDate`, `endDate`: Filter logs by date or range.

#### Services Called
- **Admin Service**: Handles system health, database stats, user stats, diagnostics, and database operations.
- **Security Scan Service**: Manages security scans and metrics.
- **Logs Service**: Retrieves log summaries and performs searches.

#### Security
- All routes require JWT authentication (`authMiddleware.authenticate`).
- All routes require admin privileges (`authMiddleware.isAdmin`).
- Security scan endpoints interact with `securityScanService` to monitor failed login attempts and suspicious activities.

### Analytics Routes

**Base Path**: `/api/analytics`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/dashboard` | Get dashboard analytics within a date range |
| GET | `/metric/:metric` | Get specific metric data (e.g., totalQueries, uniqueUsers) |
| GET | `/` | Get general analytics with optional filters |
| GET | `/timeseries/:metricType` | Get time series data for a metric |
| POST | `/events` | Track a user event for analytics |
| GET | `/records` | Get raw analytics records with pagination |
| GET | `/events` | Get raw event records with pagination |
| GET | `/satisfaction/gauge` | Get satisfaction gauge data |
| GET | `/satisfaction/heatmap` | Get satisfaction heatmap data |

#### Key Parameters
- `startDate`, `endDate`: Define the analysis period (ISO format).
- `metricType`: Type of metric (e.g., queries, users).
- `interval`: Time grouping (hourly, daily, weekly, monthly).
- `locale`: Language code for category names (e.g., en, fr, sw).
- `filters`: JSON string for additional filtering criteria.

#### Services Called
- **Analytics Service**: Handles all analytics data retrieval and event tracking, interacting with the database to store and query analytics and event records.

#### Security
- All routes require JWT authentication (`authMiddleware.authenticate`).
- No admin privileges required, allowing authenticated users to access analytics.

### Authentication Routes

**Base Path**: `/api/auth`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/logout` | Invalidate user session |
| GET | `/me` | Get current user information |

#### Services Called
- **Auth Service**: Manages user authentication via Keycloak OIDC.
- **Auth Controller**: Handles business logic for authentication routes.

#### Security
- All routes require JWT authentication via Keycloak OIDC (`keycloakAuthMiddleware`).

### Chat History Routes

**Base Path**: `/api/chat`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/conversations` | Get user conversations with pagination |
| GET | `/conversations/:conversationId` | Get conversation details |
| POST | `/conversations` | Create a new conversation |
| PATCH | `/conversations/:conversationId` | Update conversation properties |
| DELETE | `/conversations/:conversationId` | Delete a conversation |
| GET | `/conversations/:conversationId/messages` | Get conversation messages |
| POST | `/conversations/:conversationId/messages` | Add message to conversation |
| POST | `/conversations/:conversationId/messages/read` | Mark messages as read |
| GET | `/query/:queryId/messages` | Get messages for a query |
| GET | `/messages/:messageId/query` | Get originating query for a message |
| POST | `/query/:queryId/conversation` | Create conversation from query |
| GET | `/search` | Search conversations |
| GET | `/recent` | Get recent conversations |
| GET | `/stats` | Get conversation statistics |
| GET | `/folders` | Get user folders |
| POST | `/folders` | Create a new folder |
| GET | `/folders/:folderId` | Get folder details |
| PATCH | `/folders/:folderId` | Update folder properties |
| DELETE | `/folders/:folderId` | Delete a folder |
| GET | `/folders/shared` | Get shared folders |
| GET | `/folders/search` | Search folders |
| POST | `/folders/reorder` | Reorder folders |
| GET | `/folders/:folderId/path` | Get folder path |
| POST | `/folders/:folderId/conversations/:conversationId` | Add conversation to folder |
| DELETE | `/folders/:folderId/conversations/:conversationId` | Remove conversation from folder |
| GET | `/conversations/:conversationId/folder` | Get conversation's folder |
| POST | `/conversations/:conversationId/move` | Move conversation between folders |
| GET | `/folders/:folderId/users` | Get users with folder access |

#### Key Parameters
- `userId` (`iss_sub`): OIDC composite key (`${iss}#${sub}`) extracted from JWT for identity and logging.
- `userKey` (`_key`): ArangoDB document key extracted from JWT for database operations (document handles, edge `_from`/`_to` references).
- `conversationId`, `folderId`, `queryId`, `messageId`: Identifiers for specific resources.
- `limit`, `offset`: Pagination for conversations, messages, and folders.
- `includeArchived`, `filterStarred`, `searchTerm`: Filtering options for conversations and folders.
- `title`, `tags`, `categoryId`: Metadata for conversations and folders.
- `format`: Export format (pdf, json).

#### Services Called
- **Chat History Service**: Manages conversations, messages, folders, and their relationships, including CRUD operations and linking queries to conversations.

#### Security
- All routes require JWT authentication (`authMiddleware.authenticate`).
- User ID extraction ensures operations are restricted to the authenticated user’s data.
- Conversation and folder operations validate ownership and permissions.

### Database Operations Routes

**Base Path**: `/api/database`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/reindex` | Reindex database |
| POST | `/backup` | Backup database |
| POST | `/optimize` | Optimize database |

#### Key Parameters
- None (operations are system-wide).

#### Services Called
- **Database Service**: Performs database maintenance tasks like reindexing, backups, and optimization.

#### Security
- All routes require JWT authentication (`authMiddleware.authenticate`).
- Typically restricted to admin users (assumed to be enforced in the route or service layer).

### Logger Routes

**Base Path**: `/api/logger`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/configure` | Reconfigure logger settings |
| POST | `/rollover` | Trigger log rotation |

#### Key Parameters
- `level`: Logging level (error, warn, info, debug).
- `errorMaxSize`, `combinedMaxSize`: Maximum log file sizes.
- `errorMaxFiles`, `combinedMaxFiles`: Maximum days to keep log files.
- `zippedArchive`: Whether to compress rotated logs.

#### Services Called
- **Logger Service**: Uses `reconfigureLogger` and `triggerLogRollover` functions to manage logging configuration.

#### Security
- Both routes require JWT authentication (`authMiddleware.authenticate`).
- Both routes require admin privileges (`authMiddleware.isAdmin`).

### Query Routes

**Base Path**: `/api/queries`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/` | Create a new query |
| GET | `/:queryId` | Get query by ID |
| POST | `/:queryId/feedback` | Add feedback to a query |
| PATCH/PUT | `/:queryId/answered` | Mark a query as answered |
| GET | `/` | Search queries with criteria |
| PATCH | `/:queryId/responsetime` | Update query response time |
| GET | `/:queryId/conversations` | Get conversations for a query |
| POST | `/:queryId/conversation` | Create conversation from query |
| POST | `/:queryId/link/:messageId` | Link query to message |

#### Key Parameters
- `userId`, `text`: Required for creating queries.
- `queryId`, `messageId`: Identifiers for specific resources.
- `responseTime`: Time in milliseconds for query response.
- `rating`, `comment`: Feedback details.
- `limit`, `offset`: Pagination for search.
- `categoryId`, `serviceId`, `isAnswered`, `startDate`, `endDate`: Search criteria.

#### Services Called
- **Query Service**: Manages query creation, retrieval, feedback, and linking to conversations and messages.

#### Security
- All routes require JWT authentication (`authMiddleware.authenticate`).
- User-specific operations validate `userId` to ensure data access restrictions.

### Service Category Routes

**Base Path**: `/api/service-categories`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/categories` | Get all categories with services |
| GET | `/categories/:categoryId` | Get a specific category with services |
| GET | `/search` | Search categories and services |
| POST | `/` | Create or update categories |
| DELETE | `/:categoryId` | Delete a category |
| POST | `/init` | Initialize default categories |

#### Key Parameters
- `locale`: Language code (e.g., en, fr, sw) for localized content.
- `categoryId`: Unique identifier for a category.
- `query`: Search string for categories and services.
- `categories`: Array of category data for creation/update.

#### Services Called
- **Service Category Service**: Manages category and service data, including CRUD operations and search.

#### Security
- All routes require JWT authentication (`authMiddleware.authenticate`).

### Service Routes

**Base Path**: `/api/services`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/categories` | Get all categories with services |
| GET | `/categories/:categoryId` | Get a specific category with services |
| GET | `/search` | Search categories and services |

#### Key Parameters
- `locale`: Language code for localized content.
- `categoryId`: Unique identifier for a category.
- `query`: Search string for services.

#### Services Called
- **Service Category Service**: Shared with service category routes for managing category and service data.

#### Security
- All routes require JWT authentication (`authMiddleware.authenticate`).

### User Routes

**Base Path**: `/api/me`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Get current user profile (resolved from JWT) |
| PUT | `/` | Update current user profile |
| GET | `/context` | Get user context for AI enrichment |
| POST | `/reset-data` | Reset user profile data while preserving account |

#### Key Parameters
- `data`, `files`: Profile data and optional file uploads for profile update.
- User is resolved from JWT: `req.user.iss_sub` for identity/logging, `req.user._key` for ArangoDB document operations — no userId path parameter.

#### Services Called
- **User Service**: Manages user profile retrieval and updates.
- **Keycloak Proxy Service**: Forwards JIT fields (email, name) to Keycloak Account API.

#### Security
- All routes require JWT authentication via Keycloak OIDC (`keycloakAuthMiddleware`).
- The `/api/me` singleton is inherently self-scoped — no IDOR check needed.
- File uploads are limited to 10MB and stored in memory using `multer`.

### Weather Routes

**Base Path**: `/api/weather`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/` | Get weather data for a specified location |

#### Key Parameters
- `latitude`, `longitude`: Coordinates for the location (optional, defaults to server location).
- `userId` (`iss_sub`): ID of the user requesting weather data, extracted from JWT.

#### Services Called
- **Weather Service**: Retrieves current weather and forecast data, storing user-specific weather requests in the database.

#### Security
- Requires JWT authentication (`authMiddleware.authenticate`).
- Validates latitude (-90 to 90) and longitude (-180 to 180) to ensure valid coordinates.

## Error Handling

All routes follow a consistent error handling approach:

1. **400 Bad Request**: Missing or invalid fields (e.g., missing `userId`, invalid `latitude`).
2. **401 Unauthorized**: Missing or invalid JWT token.
3. **403 Forbidden**: Insufficient permissions (e.g., non-admin accessing admin routes).
4. **404 Not Found**: Resource not found (e.g., user, conversation).
5. **500 Server Error**: Unexpected errors during processing.

Error responses are formatted consistently:
```json
{
  "message": "Error message details"
}
```

Some routes include additional error details (e.g., `error` field with stack trace in development).

## Testing

Routes can be tested using tools like Postman or the Swagger UI.

### Using Swagger UI

1. Access the Swagger documentation at `/api-docs`.
2. Authenticate using a valid JWT token.
3. Select an endpoint to test.
4. Provide required parameters and execute the request.
5. View the response in the Swagger UI.

### Using the Integration Test

Run the integration test script to verify connections between services:

```bash
node tests/verify-integration.js
```

This script tests the integration between the query service, analytics service, and other components of the GENIE.AI framework, ensuring that queries and feedback are correctly recorded in analytics.

---

This updated `README.md` reflects the current state of the GENIE.AI API routes, including user and weather routes. The architecture diagram has been updated, and the detailed route descriptions ensure clarity for developers implementing RAG use cases.