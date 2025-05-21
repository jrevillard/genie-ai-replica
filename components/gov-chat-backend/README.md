# Chatbot Analytics Backend

This repository contains the backend services for a chatbot analytics system built with Node.js and ArangoDB.

## Prerequisites

- Node.js (v14 or higher)
- ArangoDB (v3.7 or higher)
- npm or yarn

## Setup

1. Clone this repository:
   ```
   git clone <repository-url>
   cd chatbot-analytics-backend
   ```

2. Install dependencies:
   ```
   npm install
   ```

3. Create environment variables:
   ```
   cp .env.template .env
   ```
   
4. Edit the `.env` file and update the ArangoDB connection details and other settings.

5. Make sure ArangoDB is running:
   - If you're using the local ArangoDB server, make sure it's running
   - If you're using ArangoDB in Docker, you can start it with:
     ```
     docker run -p 8529:8529 -e ARANGO_ROOT_PASSWORD=your_password_here arangodb/arangodb:latest
     ```

## Database Setup

### Option 1: Complete Setup (Recommended)

Run the complete setup script that will create the database, collections, and initialize default service categories:

```
npm run setup-all
```

### Option 2: Step-by-Step Setup

1. Create the database and collections:
   ```
   npm run setup-db
   ```

2. Initialize default service categories:
   ```
   npm run init-categories
   ```

## Running the Application

### Development mode:

```
npm run dev
```

### Production mode:

```
npm start
```

## Database Structure

The application uses the following collections in ArangoDB:

1. **Document Collections:**
   - `users` - User profiles
   - `sessions` - User sessions
   - `serviceCategories` - Service categories (top-level nodes)
   - `services` - Individual services (child nodes)
   - `queries` - Chatbot queries
   - `analytics` - Pre-aggregated analytics data

2. **Edge Collections:**
   - `userSessions` - Connects users to their sessions
   - `sessionQueries` - Connects sessions to queries
   - `categoryServices` - Connects categories to services
   - `queryCategories` - Connects queries to categories

## API Documentation

The backend exposes RESTful APIs for the frontend to interact with. See the API documentation for details on available endpoints.

## Folder Structure

```
.
├── arango-schema.js        # ArangoDB schema definitions
├── schemas.js              # Schema index file
├── setup-db.js             # Database setup script
├── init-service-categories.js # Service categories initialization script
├── setup-all.js            # Complete setup script
├── services/               # Backend services
│   ├── analytics-service.js
│   ├── query-service.js
│   ├── service-category-service.js
│   ├── session-service.js
│   └── user-profile-service.js
├── routes/                 # API routes
├── controllers/            # API controllers
├── middleware/             # Express middleware
├── utils/                  # Utility functions
├── uploads/                # File uploads directory
└── index.js                # Application entry point
```

## License

[MIT](LICENSE)
