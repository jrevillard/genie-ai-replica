# GENIE.AI Integration Architecture

## Architecture Overview

### Core Components
1. **Frontend**: Vue.js web application (`components/gov-chat-frontend/`)
2. **Mobile**: Flutter mobile app (`mobile/genie_ai_mobile/`)
3. **Backend**: Express.js API (`components/gov-chat-backend/`)
4. **API Gateway**: Kong Gateway (`api-gateway-solution/`)
5. **Document Repository**: Separate service (`components/document-repository/`)
6. **AI/ML Layer**: OPEA (Open Platform for Enterprise AI) stack
7. **Databases**: ArangoDB (primary), PostgreSQL (Kong), Redis (caching)
8. **Authentication**: Keycloak OIDC

## Integration Points

### 1. Frontend → Backend

**From**: Vue.js Frontend  
**To**: Express.js Backend  
**Type**: REST API calls via Axios  
**Authentication**: OIDC Bearer tokens  

**Key Endpoints**:
- `/api/auth/*` - Authentication, login, logout, token refresh
- `/api/queries` - Query creation, search, management
- `/api/chat/*` - Conversation and chat history
- `/api/analytics` - Analytics and metrics
- `/api/me` - User profile management
- `/api/admin/*` - Administrative functions
- `/api/service-categories` - Knowledge base categories
- `/api/services` - Service catalog

### 2. Mobile → Backend

**From**: Flutter Mobile App  
**To**: Express.js Backend  
**Type**: REST API calls via `http` package  
**Authentication**: OIDC Bearer tokens via `flutter_appauth` (forked version)

**Key Endpoints**: Same as Frontend → Backend

**Details**:
- Custom `flutter_appauth` fork for SSL bypass in development
- URL scheme-based OIDC callback routing
- Flavor-specific configurations (dev, staging, e2e, itu)
- Secure storage for tokens using `flutter_secure_storage`

### 3. Backend → ArangoDB

**From**: Express.js Backend  
**To**: ArangoDB Vector Database  
**Type**: Database queries (AQL)  
**Protocol**: HTTP/HTTPS  

**Collections Used**:
- `queries` - User queries and responses
- `conversations` - Conversation threads
- `messages` - Individual messages
- `serviceCategories` - Knowledge categories
- `services` - Service items
- `users` - User profiles
- `sessions` - Active sessions
- `analytics` - Query analytics

### 4. Backend → Redis

**From**: Express.js Backend  
**To**: Redis Cache  
**Type**: Cache operations  
**Protocol**: TCP  

**Purpose**:
- Translation caching
- Session management
- Rate limiting
- Analytics caching

### 5. All → Keycloak

**From**: Frontend, Mobile, Backend, Document Repository  
**To**: Keycloak Identity Provider  
**Type**: OIDC Authentication Flow  
**Protocol**: HTTPS  

**Authentication Flow**:
- **Authorization Code Flow**: Web frontend
- **PKCE Flow**: Mobile apps (public client)
- **Bearer Token Validation**: Backend services
- **Client Credentials Flow**: Service-to-service

### 6. API Gateway → Services

**From**: Kong API Gateway  
**To**: Backend Services  
**Type**: Reverse Proxy + Routing  
**Protocol**: HTTP/HTTPS  

**Service Routes**:
- `express-api` (backend:3000) → `/api/*` paths
- `document-repository` (document-repository:3001) → `/api/files`, `/api/labels`
- `keycloak` (keycloak:8080) → `/auth` (with path stripping)

**Gateway Features**:
- Rate limiting (1000/min, 10000/hour)
- CORS configuration
- Request/response transformation
- Prometheus metrics
- Load balancing (round-robin)

### 7. Backend → OPEA AI Layer

**From**: Express.js Backend  
**To**: ChatQnA Service  
**Type**: REST API calls  
**Protocol**: HTTP  

**OPEA Integration Flow**:
1. Query Service calls OPEA via worker threads
2. OPEA orchestrates multiple AI services:
   - Embedding service (TEI + BGE model)
   - Retriever service (ArangoDB vector search)
   - Reranking service (Cross-encoder model)
   - LLM service (VLLM + Granite model)

## Data Flow Architecture

### 1. Query Processing Flow
```
User Query → Frontend/Mobile → Kong Gateway → Backend → Query Service
                                                    ↓
                                            OPEA Worker Thread → ChatQnA Service
                                                    ↓
                                            Embedding → Retriever → Reranker → LLM
                                                    ↓
                                            Response → Analytics → ArangoDB
```

### 2. Authentication Flow
```
User Login → Keycloak → Bearer Token → Client Application
                                      ↓
                                API Requests with JWT
                                      ↓
                            Service Validation → Keycloak JWKS
```

### 3. Document Processing Flow
```
Document Upload → Document Repository → Text Processing → ArangoDB
                                                    ↓
                                            Vector Embedding → TEI Service
```

## Service Discovery & Communication Patterns

### Service Discovery
- **Docker Compose**: Internal service naming (backend, document-repository, keycloak)
- **Kong Gateway**: Static service configuration with target hosts
- **Health Checks**: Periodic HTTP health checks for service availability

### Load Balancing
- **Kong Gateway**: Round-robin algorithm for backend services
- **Docker Swarm**: Service replicas with placement constraints

### Circuit Breakers
- **Kong Gateway**: Passive health checking (429, 500, 503 status codes)
- **Retry Logic**: Configurable retries with exponential backoff

## Security Considerations

### Transport Security
- **HTTPS**: All external communication
- **TLS Termination**: Nginx proxy
- **Internal Communication**: Docker network (HTTP only)

### Authentication
- **OIDC**: Keycloak for user authentication
- **JWT**: Bearer token for API access
- **Service Auth**: Mutual TLS potential (not implemented)

### Authorization
- **Role-based**: Keycloak realm configuration
- **API Scopes**: Endpoint-specific permissions
- **File Access**: Admin-only document uploads
