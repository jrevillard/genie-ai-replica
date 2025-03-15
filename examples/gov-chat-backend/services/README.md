# Government Services Portal - Backend Services

This repository contains the backend services that power the Government Services Portal application. These services handle user sessions, analytics, service categorization, user profiles, and query processing.

## Table of Contents

- [Government Services Portal - Backend Services](#government-services-portal---backend-services)
  - [Table of Contents](#table-of-contents)
  - [Overview](#overview)
  - [System Architecture](#system-architecture)
  - [Services](#services)
    - [Analytics Service](#analytics-service)
    - [Query Service](#query-service)
    - [Session Service](#session-service)
    - [Service Category Service](#service-category-service)
    - [User Profile Service](#user-profile-service)
  - [Database](#database)
  - [API](#api)
  - [Setup and Configuration](#setup-and-configuration)
    - [Prerequisites](#prerequisites)
    - [Environment Variables](#environment-variables)
    - [Installation](#installation)
  - [Development](#development)
    - [Key Utilities](#key-utilities)
    - [Adding a New Service](#adding-a-new-service)
    - [Testing](#testing)
  - [Deployment](#deployment)
    - [Docker](#docker)
    - [Production Deployment](#production-deployment)
  - [Security Considerations](#security-considerations)

## Overview

The backend services are designed to support a chatbot-based government service portal. They provide critical functionality for managing user interactions, storing analytics data, organizing government services into categories, and handling user profiles.

## System Architecture

The system uses a microservices architecture with the following components:

- **ArangoDB database**: Document-oriented NoSQL database for storing data
- **Node.js services**: Individual services for different aspects of the system
- **API layer**: RESTful API endpoints for front-end communication

The services are designed to work together while maintaining separation of concerns:

```
┌─────────────────┐     ┌───────────────┐     ┌───────────────────┐
│ Vue.js Frontend │────▶│ API Endpoints │────▶│ Backend Services  │
└─────────────────┘     └───────────────┘     └───────────────────┘
                                                        │
                                                        ▼
                                               ┌───────────────────┐
                                               │    ArangoDB       │
                                               └───────────────────┘
```

## Services

### Analytics Service

**File**: `analytics-service.js`

The Analytics Service tracks and processes user interactions with the system. It provides:

- Collection of query analytics data
- Feedback recording and analysis
- Time series data for usage trends
- Dashboard analytics with key metrics
- Basic event tracking

Key functions:
- `recordQuery`: Records a user query for analytics
- `recordFeedback`: Records user feedback on responses
- `getDashboardAnalytics`: Gets analytics for the dashboard
- `getTimeSeriesData`: Gets time series data for charts
- `getUniqueUsersCount`: Gets the count of unique users

### Query Service

**File**: `query-service.js`

The Query Service handles user questions and interactions with the system. Features include:

- Creating and storing user queries
- Adding feedback to queries
- Categorizing queries by service area
- Searching for queries based on criteria
- Handling similar query detection

Key functions:
- `createQuery`: Creates a new query from user input
- `addFeedback`: Adds user feedback to a query
- `setQueryCategory`: Sets the category for a query
- `searchQueries`: Searches for queries based on criteria
- `getSimilarQueries`: Finds similar questions to a given query

### Session Service

**File**: `session-service.js`

The Session Service manages user sessions and authentication. It provides:

- Session creation and management
- Session expiration and cleanup
- Activity tracking
- Multi-device support

Key functions:
- `createSession`: Creates a new session for a user
- `getActiveSession`: Gets a user's active session
- `endSession`: Ends a session
- `keepSessionAlive`: Updates session to prevent expiration
- `cleanupExpiredSessions`: Removes expired sessions

### Service Category Service

**File**: `service-category-service.js`

The Service Category Service organizes government services into categories and subcategories. Features include:

- Category and service management
- Hierarchical service structure
- Multi-language support
- Search functionality

Key functions:
- `upsertCategories`: Creates or updates service categories
- `upsertServices`: Creates or updates services in categories
- `getAllCategoriesWithServices`: Gets all categories with their services
- `searchCategoriesAndServices`: Searches for categories and services
- `initializeDefaultCategoriesAndServices`: Sets up initial category structure

### User Profile Service

**File**: `user-profile-service.js`

The User Profile Service manages citizen profiles and documents. It provides:

- Profile creation and management
- Document uploads and storage
- Identity management
- Search functionality

Key functions:
- `createUserProfile`: Creates a new user profile
- `updateUserProfile`: Updates an existing profile
- `getUserProfile`: Gets a user's profile by ID
- `deleteUserProfile`: Deletes a user profile
- `searchUsers`: Searches for users based on criteria
- `processProfileData`: Processes profile data and file uploads

## Database

The system uses ArangoDB, a multi-model database that supports documents, graphs, and key-value storage. Key collections include:

- `users`: User profiles and data
- `sessions`: User session information
- `queries`: User questions and interactions
- `analytics`: Analytics data
- `events`: System events
- `serviceCategories`: Government service categories
- `services`: Individual government services

Graph relationships between these collections provide powerful querying capabilities.

## API

The system provides a RESTful API with the following configuration:

- Base URL: `/api` (configurable via environment variables)
- Authentication: JWT token-based authentication
- Error handling: Consistent error responses
- Session handling: Automatic token refresh and expiration

The API configuration (`api.js`) includes:
- Axios configuration for API calls
- Request interceptors for authentication
- Response interceptors for error handling
- Session expiration handling

## Setup and Configuration

### Prerequisites

- Node.js 14+ 
- ArangoDB 3.7+
- npm or yarn

### Environment Variables

Configure the following environment variables:

```
# ArangoDB Configuration
ARANGO_URL=http://localhost:8529
ARANGO_DB=node-services
ARANGO_USERNAME=root
ARANGO_PASSWORD=test

# API Configuration
VUE_APP_API_URL=/api

# Session Configuration 
SESSION_EXPIRATION_TIME=1800000

# File Upload Configuration
UPLOAD_DIR=/path/to/uploads
```

### Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/your-repo/government-services-backend.git
   cd government-services-backend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Initialize the database:
   ```bash
   npm run init-db
   ```

4. Start the services:
   ```bash
   npm start
   ```

## Development

### Key Utilities

The backend includes shared utilities:

- `key-handler.js`: Manages document keys for ArangoDB

### Adding a New Service

1. Create a new service file (e.g., `new-service.js`)
2. Initialize the ArangoDB connection
3. Create a class with methods for the service
4. Export the class

### Testing

Run tests with:

```bash
npm test
```

## Deployment

### Docker

A Dockerfile is provided for containerization:

```bash
docker build -t govt-service-backend .
docker run -p 3000:3000 -d --name govt-service-backend govt-service-backend
```

### Production Deployment

For production deployment:

1. Set environment variables for production
2. Build the application:
   ```bash
   npm run build
   ```
3. Start the production server:
   ```bash
   npm run start:prod
   ```

## Security Considerations

- All database credentials should be stored in environment variables
- APIs should be protected with proper authentication
- Sensitive user data is handled according to data protection regulations
- File uploads are validated and stored securely