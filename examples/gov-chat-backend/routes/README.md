# Government Services Portal API Routes

This document provides an overview of all API routes available in the Government Services Portal backend. These RESTful endpoints allow the frontend to interact with the various services that power the application.

## Table of Contents

- [Government Services Portal API Routes](#government-services-portal-api-routes)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [Authentication](#authentication)
  - [Analytics Routes](#analytics-routes)
    - [Key Parameters](#key-parameters)
  - [Query Routes](#query-routes)
    - [Key Parameters](#key-parameters-1)
  - [Service Category Routes](#service-category-routes)
    - [Key Parameters](#key-parameters-2)
  - [Service Routes](#service-routes)
    - [Key Parameters](#key-parameters-3)
  - [Session Routes](#session-routes)
    - [Key Parameters](#key-parameters-4)
  - [User Routes](#user-routes)
    - [Key Parameters](#key-parameters-5)
  - [Error Handling](#error-handling)
  - [Testing](#testing)
    - [Using Swagger UI](#using-swagger-ui)
    - [Using the Integration Test](#using-the-integration-test)

## Overview

The API is organized into logical route groups that correspond to the different services:

- **Analytics Routes**: Endpoints for retrieving analytics data and tracking events
- **Query Routes**: Endpoints for creating and managing user queries
- **Service Category Routes**: Endpoints for managing service categories and hierarchies
- **Service Routes**: Endpoints for accessing service information
- **Session Routes**: Endpoints for managing user sessions
- **User Routes**: Endpoints for managing user profiles

All routes are properly documented with Swagger annotations for easy reference and testing.

## Authentication

Most routes require authentication. The API uses JWT tokens for authentication:

1. The token should be included in the `Authorization` header using the Bearer scheme:
   ```
   Authorization: Bearer <token>
   ```

2. If the token is missing or invalid, a 401 Unauthorized response will be returned.

3. If the token is expired, a 401 response will be returned, and the client should redirect to the login page.

## Analytics Routes

**Base Path**: `/api/analytics`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/dashboard` | Get dashboard analytics within a date range |
| GET | `/metric/:metric` | Get specific metric data (totalQueries, uniqueUsers, etc.) |
| GET | `/` | Get general analytics with optional filters |
| GET | `/timeseries/:metricType` | Get time series data for a specific metric |
| POST | `/events` | Track a user event for analytics |
| GET | `/records` | Get raw analytics records with pagination |
| GET | `/events` | Get raw event records with pagination |

### Key Parameters

- `startDate` and `endDate`: ISO format date strings to define the analysis period
- `metricType`: Type of metric (queries, users)
- `interval`: Time grouping (hourly, daily, weekly, monthly)

## Query Routes

**Base Path**: `/api/queries`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/` | Create a new query |
| GET | `/:queryId` | Get a query by ID |
| POST | `/:queryId/feedback` | Add feedback to a query |
| PATCH/PUT | `/:queryId/answered` | Mark a query as answered |
| GET | `/` | Search queries with various criteria |

### Key Parameters

- `userId`: ID of the user making the query
- `sessionId`: Current session ID
- `text`: The query text
- `categoryId` and `serviceId`: Categorization information
- Search criteria: userId, text, categoryId, isAnswered, startDate, endDate, etc.

## Service Category Routes

**Base Path**: `/api/service-categories`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Get all categories with their services |
| GET | `/:categoryKey` | Get a specific category with its services |
| GET | `/search` | Search categories and services |
| POST | `/` | Create or update categories |
| DELETE | `/:categoryKey` | Delete a category |
| POST | `/init` | Initialize default categories |

### Key Parameters

- `locale`: Language code (en, fr, sw) for localized content
- `categoryKey`: Unique identifier for a category
- `q`: Search query for finding categories and services

## Service Routes

**Base Path**: `/api/services`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/categories` | Get all categories with services |
| GET | `/categories/:categoryId` | Get a specific category with services |
| GET | `/search` | Search categories and services |

### Key Parameters

- `locale`: Language code (en, fr, sw) for localized content
- `categoryId`: Unique identifier for a category
- `query`: Search query for finding services

## Session Routes

**Base Path**: `/api/sessions`

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/` | Create a new session |
| GET | `/:sessionId` | Get a session by ID |
| PATCH | `/:sessionId/end` | End a session |
| PATCH | `/:sessionId/keepalive` | Keep a session alive |
| GET | `/user/:userId` | Get all sessions for a specific user |

### Key Parameters

- `userId`: ID of the user
- `deviceInfo`: Information about the user's device
- `activeOnly`: Whether to return only active sessions

## User Routes

**Base Path**: `/api/users`

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/:userId` | Get a user profile |
| POST | `/` | Create a user profile |
| PUT | `/:userId` | Update a user profile |
| DELETE | `/:userId` | Delete a user profile |
| GET | `/` | Search for users based on criteria |

### Key Parameters

- `userId`: User ID
- File uploads: Profile photo, documents, etc.
- Search criteria: fullName, nationality, address, email, etc.

## Error Handling

All routes follow a consistent error handling approach:

1. **400 Bad Request**: When required fields are missing or invalid
2. **401 Unauthorized**: When authentication is required
3. **404 Not Found**: When requested resource doesn't exist
4. **500 Server Error**: When an unexpected error occurs

Error responses are formatted consistently:
```json
{
  "message": "Error message details"
}
```

## Testing

Routes can be tested using tools like Postman or the Swagger UI.

### Using Swagger UI

1. Access the Swagger documentation at `/api-docs`
2. Authenticate if required
3. Select an endpoint to test
4. Fill in the required parameters
5. Execute the request and view the response

### Using the Integration Test

You can also run the integration test script to verify the connections between services:

```bash
node verify-integration.js
```

This script tests the integration between the query service and analytics service.