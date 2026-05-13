# GENIE.AI Project Overview

## Executive Summary

GENIE.AI is an open-source generative AI framework designed specifically for the public sector. It provides a **sovereign, DPG-compliant RAG (Retrieval-Augmented Generation) system** with multilingual support, enabling government organizations to deploy secure, privacy-preserving AI chatbots over their own document repositories.

The platform integrates with [OPEA (Open Platform for Enterprise AI)](https://opea.dev) for AI/ML services and supports multiple deployment models from local development to production-scale Docker Swarm clusters.

### Key Capabilities

- **Sovereign AI**: Full data sovereignty with on-premises deployment (no external API dependencies)
- **Multilingual**: 11+ languages with automatic translation and English as source of truth
- **Multi-Platform**: Web (Vue 3), Mobile (Flutter - Android/iOS/Web/Desktop), and API-first architecture
- **RAG Pipeline**: Hybrid vector-graph retrieval for context-aware responses
- **Enterprise Security**: Keycloak OIDC, JWT authentication, ClamAV scanning, SSL/TLS
- **Scalable**: Docker Compose (local) to Docker Swarm (production) with Ansible automation
- **Analytics**: Comprehensive usage analytics, satisfaction metrics, and performance monitoring
- **Design System**: Shared design system across web (Vue DS primitives) and mobile (Flutter DS components)

---

## Technology Stack

| Component | Technology | Version | Purpose |
|-----------|-----------|---------|---------|
| **Frontend** | Vue 3 | 3.2+ | Web UI with Options API, Vuex state management |
| **Frontend** | Vue CLI | ^5.0.0 | Build tool and dev server |
| **Frontend** | ApexCharts | ^5.10.0 | Data visualization for analytics |
| **Frontend** | vue-i18n | ^9.14.2 | Internationalization (11+ languages) |
| **Backend** | Node.js | 22 LTS | Server-side JavaScript runtime |
| **Backend** | Express | 4.18.2 | Web framework and API routing |
| **Backend** | JWT | jsonwebtoken | Token-based authentication |
| **Backend** | Swagger/OpenAPI | 3.0 | API documentation at `/api-docs` |
| **Document Repo** | Multer | Latest | Multipart form data handling |
| **Document Repo** | ClamAV | Latest | Anti-virus scanning |
| **Document Repo** | pdf-parse | Latest | PDF text extraction |
| **Mobile** | Flutter | 3.10.8+ | Cross-platform mobile framework |
| **Mobile** | Dart | 3.0+ | Programming language |
| **Mobile** | Riverpod | 3.0+ | State management (reactive) |
| **Mobile** | flutter_appauth | 12.0+ | OIDC authentication with PKCE |
| **Mobile** | SSE | Server-Sent Events | Real-time streaming responses |
| **AI/ML** | Python | 3.10+ | AI/ML services runtime |
| **AI/ML** | FastAPI | Latest | High-performance async API |
| **AI/ML** | vLLM | Latest | LLM inference engine |
| **AI/ML** | TEI | Latest | Text Embeddings & Reranking |
| **AI/ML** | OPEA | Latest | Open Platform for Enterprise AI |
| **Database** | ArangoDB | 3.12+ | Multi-model: document + graph + vector |
| **Cache** | Redis | 5.8+ | In-memory data store |
| **Identity** | Keycloak | 26 | Identity and access management |
| **Identity** | PostgreSQL | 15+ | Keycloak and Kong data store |
| **API Gateway** | Kong | Latest | Reverse proxy, CORS, rate limiting |
| **API Gateway** | NGINX | Latest | SSL/TLS termination, static serving |
| **Container** | Docker | Latest | Container runtime |
| **Container** | Docker Swarm | Latest | Orchestration (production) |
| **Automation** | Ansible | Latest | Infrastructure as code |
| **Logging** | Winston | Latest | Structured logging (Node.js) |
| **Testing** | Playwright | Latest | E2E testing |

---

## Architecture Classification

GENIE.AI is a **hybrid microservices architecture** with the following patterns:

### Architectural Patterns

1. **API Gateway Pattern**: Kong + NGINX as single entry point for all services
2. **Backend for Frontend (BFF)**: Node.js backend aggregates multiple services
3. **Service-Oriented Architecture (SOA)**: Distinct services with clear boundaries
4. **Event-Driven Processing**: OPEA services communicate via REST/gRPC
5. **Multi-Model Database**: ArangoDB for document, graph, and vector data
6. **Federated Identity**: Keycloak with external IdP brokering (Google, Microsoft, SAML)

### Layer Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     CLIENT LAYER                             │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Vue 3 Web  │  │ Flutter Mob. │  │   External   │      │
│  │   (Browser)  │  │  (Multi-OS)  │  │     IdPs     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                  API GATEWAY LAYER                           │
│  ┌──────────────┐  ┌──────────────┐                        │
│  │  NGINX (TLS) │  │  Kong (Proxy)│                        │
│  └──────────────┘  └──────────────┘                        │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                  APPLICATION LAYER                           │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Backend    │  │   Document   │  │   Keycloak   │      │
│  │  (Node.js)   │  │  Repository  │  │     OIDC     │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                     AI/ML LAYER                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   ChatQnA    │  │  Retriever   │  │   Reranker   │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   Dataprep   │  │    vLLM      │  │     TEI      │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
                             │
                             ▼
┌─────────────────────────────────────────────────────────────┐
│                      DATA LAYER                              │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐      │
│  │   ArangoDB   │  │    Redis     │  │  PostgreSQL  │      │
│  │ (Doc+Graph+  │  │    (Cache)   │  │  (Kong+KC)   │      │
│  │   Vector)    │  │              │  │              │      │
│  └──────────────┘  └──────────────┘  └──────────────┘      │
└─────────────────────────────────────────────────────────────┘
```

---

## Repository Structure

GENIE.AI is a **monorepo** with 6 distinct parts:

### 1. Frontend (`components/gov-chat-frontend/`)
- **Technology**: Vue 3 (Options API), Vue CLI, ApexCharts, OKLch design tokens
- **Purpose**: Web-based chat interface for querying documents
- **Key Features**:
  - Vuex state management
  - vue-i18n for multilingual support (11+ languages)
  - Real-time chat with streaming responses
  - Analytics dashboard with charts
  - Responsive design with mobile support
- **Port**: 5173 (internal)

### 2. Backend (`components/gov-chat-backend/`)
- **Technology**: Node.js 22, Express 4.18.2, JWT, Swagger
- **Purpose**: REST API for chat, users, analytics, admin functions
- **Key Features**:
  - JWT authentication with Keycloak integration
  - Swagger/OpenAPI documentation at `/api-docs`
  - ArangoDB integration for data persistence
  - Redis caching for performance
  - Winston logging with daily rotation
  - Controller → Service pattern for business logic
- **Port**: 3000 (internal)
- **API Routes**:
  - `/api/auth/*` - Authentication endpoints
  - `/api/me/*` - User profile (singleton)
  - `/api/chat/*` - Chat and conversations
  - `/api/analytics/*` - Usage analytics
  - `/api/admin/*` - Admin dashboard
  - `/api/files/*` - Document management
  - `/api/categories/*` - Service categories

### 3. Document Repository (`components/document-repository/`)
- **Technology**: Express.js, Multer, ClamAV, pdf-parse
- **Purpose**: Secure file upload, processing, and knowledge base integration
- **Key Features**:
  - Multipart file upload with progress tracking
  - ClamAV anti-virus scanning
  - PDF text extraction and parsing
  - Integration with ArangoDB knowledge graph
- **Port**: 3001 (internal)

### 4. Mobile (`mobile/genie_ai_mobile/`)
- **Technology**: Flutter 3.10+, Dart 3.0+, Riverpod, flutter_appauth
- **Purpose**: Cross-platform mobile app (Android, iOS, Web, Desktop)
- **Key Features**:
  - Riverpod state management
  - OIDC authentication with PKCE flow
  - Server-Sent Events (SSE) for streaming responses
  - Offline capabilities
  - Shared design system with web (Flutter DS components)
  - OpenAPI-generated client from backend Swagger spec
- **Platforms**: Android, iOS, Web, Desktop (Windows/macOS/Linux)

### 5. AI/ML Layer (`genie-ai-overlay/`)
- **Technology**: Python 3.10+, FastAPI, OPEA, vLLM, TEI
- **Purpose**: Microservices for RAG pipeline and AI inference
- **Components**:
  - **ChatQnA**: Main chat orchestration service (port 8888)
  - **Retriever**: Hybrid vector-graph retrieval (port 7000)
  - **Reranker**: Result reranking for relevance (port 8000)
  - **Dataprep**: Document ingestion and chunking (port 5000)
  - **vLLM**: LLM inference engine (port 8000)
  - **TEI**: Text embeddings and reranking (port 80)
  - **Translation**: Multilingual translation service (port 9031)
- **Integration**: OPEA (Open Platform for Enterprise AI)

### 6. API Gateway (`api-gateway-solution/`)
- **Technology**: Kong, NGINX, Let's Encrypt (SSL/TLS)
- **Purpose**: Single entry point, SSL termination, routing, security
- **Key Features**:
  - SSL/TLS termination (HTTPS only)
  - Reverse proxy to all services
  - CORS configuration
  - Rate limiting
  - JWT validation
  - Static file serving for frontend
- **Exposed Ports**: 80 (HTTP), 443 (HTTPS)

### 7. Deployment Automation (`deploy/`)
- **Technology**: Ansible, Docker Compose, Docker Swarm
- **Purpose**: Infrastructure as code for production deployments
- **Key Features**:
  - Ansible playbooks for automated provisioning
  - Per-environment secrets management with Ansible Vault
  - Multi-node Docker Swarm deployment
  - SSL certificate management
  - Service placement constraints via node labels

### Directory Structure

```
genie-ai/
├── components/
│   ├── gov-chat-frontend/       # Vue 3 web app
│   ├── gov-chat-backend/        # Node.js API
│   └── document-repository/     # File upload service
├── mobile/
│   └── genie_ai_mobile/         # Flutter app
├── genie-ai-overlay/            # OPEA AI services
│   ├── chatqna/                 # Chat orchestration
│   ├── retriever/               # Hybrid retrieval
│   ├── reranker/                # Result reranking
│   ├── dataprep/                # Document ingestion
│   ├── core/                    # Shared types, protocols
│   └── macro/                   # OPEA shared utilities
├── api-gateway-solution/        # Kong + NGINX config
├── configs/                     # Keycloak, OPEA prompts
├── secrets/                     # SSL certificates (gitignored)
├── deploy/
│   └── ansible/                 # Infrastructure automation
├── tests/                       # Integration tests, benchmarks
├── docs/                        # Documentation
├── docker-compose.yaml          # Main orchestration (dual-mode)
├── env                          # Configuration template
└── .env                         # Local environment (gitignored)
```

---

## RAG Pipeline Flow

The core Retrieval-Augmented Generation pipeline follows this flow:

```
1. User Query (Web/Mobile)
   │
   ▼
2. Backend API (Node.js/Express)
   │ - Validates JWT token
   │ - Logs query to analytics
   │ - Checks cache (Redis)
   │
   ▼
3. ChatQnA Service (Python/FastAPI)
   │ - Orchestrates RAG pipeline
   │
   ▼
4. Embedding Service (TEI)
   │ - Converts query to vector embedding
   │
   ▼
5. Retriever Service (Hybrid)
   │ - Vector search in ArangoDB
   │ - Graph traversal for context
   │ - Returns ranked document chunks
   │
   ▼
6. Reranker Service (TEI)
   │ - Re-scores results for relevance
   │ - Filters low-quality matches
   │
   ▼
7. LLM Inference (vLLM)
   │ - Generates response with context
   │ - Enforces abstention if needed
   │
   ▼
8. Response Streaming (SSE)
   │ - Real-time streaming to client
   │ - Saves to conversation history
   │
   ▼
9. User sees response
```

### Key RAG Features

- **Hybrid Retrieval**: Combines vector similarity with graph relationships
- **Abstention**: LLM refuses to answer if context is insufficient
- **Translation**: Automatic translation for multilingual support
- **Streaming**: Real-time response generation via Server-Sent Events
- **Caching**: Redis caches frequent queries for performance

---

## Authentication & Authorization

### Architecture

GENIE.AI uses **Keycloak** as the central identity provider with **OIDC (OpenID Connect)**:

1. **Web**: Authorization Code flow with PKCE
2. **Mobile**: Authorization Code flow with PKCE (flutter_appauth)
3. **External IdPs**: Keycloak brokers to Google, Microsoft, SAML

### Token Lifecycle

```
1. User authenticates via Keycloak
   │
   ▼
2. Keycloak issues JWT (Access Token + ID Token)
   │
   ▼
3. Client includes JWT in API requests
   │
   ▼
4. Kong Gateway validates JWT (JWKS endpoint)
   │
   ▼
5. Backend validates token signature + claims
   │
   ▼
6. Request processed with user context
```

### Keycloak Realms

- **Master**: Administration only
- **Genie**: Main application realm for end users

### User Roles

- **End User**: Query documents, manage conversations
- **IT Admin**: Manage Keycloak realms, clients, IdP connections
- **Functional Admin**: Manage documents, categories, service data

---

## Database Schema

### ArangoDB Collections

**Documents:**
- `users` - User profiles and preferences
- `conversations` - Chat sessions
- `messages` - Chat messages with metadata
- `serviceCategories` - Service category hierarchy
- `services` - Service descriptions
- `serviceCategoryTranslations` - Multilingual translations

**Edges:**
- `serviceCategoryTranslationsEdge` - Graph relationships
- Knowledge graph edges for document relationships

**Vector Search:**
- Enabled on chunk embeddings for semantic search

### PostgreSQL (Keycloak + Kong)

- Keycloak user, client, session data
- Kong services, routes, plugins, certificates

### Redis Cache

- Session data
- Query result caching
- Rate limiting counters

---

## Deployment Models

### 1. Local Development (Docker Compose)

```bash
# Core services only (no OPEA)
docker compose up -d

# Full stack with OPEA/AI services
docker compose --profile opea up -d

# With GPU-specific configuration
docker compose --env-file .env --env-file env.t4 --profile opea up -d
```

**Services**: Frontend, Backend, Document Repository, ArangoDB, Redis, Keycloak, Kong, NGINX

### 2. Production (Docker Swarm + Ansible)

```bash
cd deploy/ansible
ansible-galaxy collection install -r requirements.yml
cp inventory.example inventory/test.ini
ansible-playbook -i inventory/test.ini deploy.yml --vault-id test@prompt
```

**Features**:
- Multi-node cluster with service placement constraints
- Automated SSL certificate management
- Ansible Vault for secrets encryption
- Health checks and auto-restart policies
- Rolling updates and rollback support

### 3. GPU Configuration

GPU-specific environment files for different hardware:

- **env.t4**: NVIDIA T4 (16GB VRAM)
- **env.rtx6000**: RTX 6000 ADA (24GB VRAM)

Contains only GPU-related variables (memory limits, batch sizes, TEI versions).

---

## Internationalization (i18n)

### Languages Supported

English (source of truth), French, Spanish, German, Italian, Portuguese, Dutch, Polish, Romanian, Bulgarian, Croatian

### Architecture

- **Source of Truth**: English (nameEN fields) for RAG compatibility
- **Translations**: Stored in dedicated ArangoDB collections
- **Key Pattern**: `${sourceKey}_${languageCode}` (e.g., `category_name_fr`)
- **Backend**: Manages translation collections and APIs
- **Frontend**: vue-i18n with lazy-loaded locale files
- **Mobile**: Flutter intl with ARB files

### Translation Collections

- `serviceCategoryTranslations` - Category translations
- `serviceTranslations` - Service translations
- Additional domain-specific translation collections

---

## Design System

### Web (Vue 3)

- **Primitives**: Vue Design System components
- **Styling**: OKLch design tokens with CSS custom properties
- **Theming**: Configurable color schemes via CSS variables
- **Responsive**: Mobile-first responsive design

### Mobile (Flutter)

- **Components**: Flutter Design System components
- **Theming**: Material Design 3 with custom color schemes
- **Consistency**: Shared design tokens with web (colors, spacing, typography)
- **Platform**: Native look-and-feel on each platform

### Theme Files

- `docs/theme-system.md` - Comprehensive theming guide
- `components/gov-chat-frontend/src/theme/` - Web theme configuration
- `mobile/genie_ai_mobile/lib/theme/` - Mobile theme configuration

---

## Environment Configuration

### File Structure

- **`env`** (no extension): Configuration template, committed to git
- **`.env`** (with dot): Local environment variables, **never committed** (gitignored)

### Initialization

```bash
cp env .env
# Edit .env with your secrets (passwords, API keys, etc.)
```

### Variable Categories

**Secrets (required, no defaults in code):**
- `ARANGO_PASSWORD` - ArangoDB root password
- `POSTGRES_PASSWORD` - PostgreSQL superuser password
- `KONG_DB_PASSWORD` - Kong database password
- `KEYCLOAK_DB_PASSWORD` - Keycloak database password
- `KEYCLOAK_ADMIN_PASSWORD` - Keycloak admin console password
- `KEYCLOAK_CLIENT_SECRET` - OIDC client secret
- `EMAIL_*` - SMTP configuration

**Deployment-Specific:**
- `VLLM_TRANSLATION_MODEL_ID` - GPU translation model
- `EMBEDDING_MODEL_ID` / `RERANKER_MODEL_ID` - AI model IDs
- `CORS_ALLOWED_ORIGINS` - CORS configuration
- `NGINX_PUBLIC_DOMAIN` - Public domain
- `VUE_APP_API_URL` - Frontend API URL

**API Keys:**
- `HUGGING_FACE_HUB_TOKEN` - Required for pulling models
- `VLLM_API_KEY` - Optional, if required by vLLM deployment

**Prompts (Two-tier priority):**
1. **ENV VAR** (highest): Override in `.env` for deployment-specific customization
2. **DEFAULT** (lowest): Built-in prompts in Python code (works out-of-the-box)

Prompt variables:
- `CHATQNA_SYSTEM_PROMPT` - LLM system prompt
- `CHATQNA_ABSTENTION_INSTRUCTIONS` - Abstention behavior
- `CHATQNA_ENFORCE_ABSTENTION` - Whether to enforce abstention (default: "true")
- `LABEL_SELECTOR_SYSTEM_PROMPT` - Document labeling

**Variables with defaults (NOT in env):**
- All ports: `FRONTEND_PORT`, `BACKEND_PORT`, etc. (defaults in docker-compose.yaml)
- Database URLs: `ARANGO_URL`, `VLLM_ENDPOINT`, etc. (defaults in docker-compose.yaml)
- Service configurations: `LOG_LEVEL`, `NODE_ENV`, `TRANSLATION_BACKEND`, etc. (defaults in code)

---

## API Documentation

### Swagger/OpenAPI

Backend API documentation is available at:
- **Local**: `http://localhost:3000/api-docs`
- **Production**: `https://<your-domain>/api/api-docs`

### Generated Documentation

- [API Contracts - Backend](./api-contracts-gov-chat-backend.md) - Complete API specification
- [Mobile Architecture](./mobile-architecture-genie-ai-mobile.md) - Mobile app architecture
- [Integration Architecture](./integration-architecture.md) - Service integration patterns

### Key API Endpoints

**Authentication:**
- `POST /api/auth/login` - Initiate OIDC login
- `POST /api/auth/callback` - OIDC callback handler
- `POST /api/auth/refresh` - Refresh access token
- `POST /api/auth/logout` - Logout and invalidate tokens

**Chat:**
- `GET /api/chat/conversations` - List user conversations
- `POST /api/chat/conversations` - Create new conversation
- `POST /api/chat/conversations/:id/messages` - Send message
- `GET /api/chat/conversations/:id/messages` - List messages

**Analytics:**
- `GET /api/analytics/dashboard` - Dashboard metrics
- `GET /api/analytics/timeseries` - Time series data
- `GET /api/analytics/satisfaction/gauge` - Satisfaction metrics
- `GET /api/analytics/satisfaction/heatmap` - Satisfaction heatmap

**Files:**
- `POST /api/files/upload` - Upload document
- `GET /api/files/:id` - Get file metadata
- `DELETE /api/files/:id` - Delete file

---

## Development Workflow

### Prerequisites

- Docker & Docker Compose (local)
- Node.js 22 LTS (for backend/frontend development)
- Flutter 3.10+ SDK (for mobile development)
- Python 3.10+ (for AI/ML development)
- ArangoDB 3.12+ (if running locally)

### Local Development Setup

**Backend:**
```bash
cd components/gov-chat-backend
npm install
npm run dev          # Start with hot reload
npm run test         # Run tests
npm run lint         # Lint code
```

**Frontend:**
```bash
cd components/gov-chat-frontend
npm install
npm run serve        # Start dev server (Vue CLI)
npm run build        # Production build
npm run lint         # Lint code
```

**Mobile:**
```bash
cd mobile/genie_ai_mobile
flutter pub get
flutter run          # Run on connected device/emulator
flutter test         # Run tests
flutter analyze      # Analyze code
```

### Linting and Formatting

**JavaScript/Vue:**
```bash
npm run lint         # Check all JS components
npm run format:check # Verify formatting
npm run lint:fix     # Auto-fix lint issues
npm run format       # Auto-format all files
```

**Python (OPEA services):**
```bash
npm run lint:py      # Check Python code (Ruff)
npm run format:py:check # Check formatting
npm run lint:py:fix  # Auto-fix lint issues
npm run format:py    # Auto-format Python files
```

**Dart (Flutter):**
```bash
npm run lint:dart    # Analyze Flutter/Dart code
npm run format:dart:check # Check formatting
npm run format:dart  # Auto-format Dart files
```

---

## Testing

### E2E Testing

Multi-phase E2E test suite in `docs/e2e-tests/`:

1. **Phase 0**: Clean start (manual setup)
2. **Phases A-J**: Automated tests via Playwright
3. **Phase K**: Realm settings mutation (manual cleanup required)
4. **Phase L+**: Additional test scenarios

**Execution:**
```bash
# Follow docs/e2e-tests/README.md for detailed instructions
# Each phase has prerequisites and cleanup steps
```

### Integration Tests

Located in `tests/` directory:
- RAG pipeline benchmarks
- API endpoint tests
- Performance tests

---

## Logging

### Backend Logging

- **Framework**: Winston with daily rotation
- **Levels**: error, warn, info, debug
- **Outputs**: Console (JSON format), files (logs/)
- **Context**: Request ID, user ID, timestamp

### AI/ML Logging

- **Framework**: CustomLogger (OPEA comps library)
- **Format**: Structured JSON logs
- **Integration**: Centralized log aggregation via Docker

### Mobile Logging

- **Framework**: Flutter logger package
- **Levels**: fatal, error, warning, info, debug, trace
- **Output**: Console, file logging for diagnostics

---

## Security

### Authentication

- **Protocol**: OIDC (OpenID Connect)
- **Flows**: Authorization Code with PKCE
- **Token**: JWT (JSON Web Tokens)
- **Validation**: JWKS endpoint verification
- **Provider**: Keycloak

### Authorization

- **Model**: Role-Based Access Control (RBAC)
- **Roles**: End User, IT Admin, Functional Admin
- **Scopes**: Read, Write, Admin
- **Enforcement**: Backend middleware

### Data Security

- **Encryption**: TLS 1.3 for all network traffic
- **Scanning**: ClamAV anti-virus for file uploads
- **Validation**: Input validation and sanitization
- **Secrets**: Ansible Vault for secrets encryption

### Network Security

- **Gateway**: Kong API Gateway with rate limiting
- **CORS**: Configurable allowed origins
- **CSP**: Content Security Policy headers
- **Firewall**: Docker Swarm overlay networks

---

## Performance Optimization

### Caching

- **Redis**: Query result caching, session data
- **Browser**: Static asset caching via NGINX
- **CDN**: Ready for CDN integration (production)

### Database

- **Vector Index**: ArangoDB vector search indexes
- **Graph Queries**: Optimized graph traversals
- **Connection Pooling**: Managed connection pools

### API

- **Streaming**: Server-Sent Events for real-time responses
- **Pagination**: List endpoints support pagination
- **Compression**: Gzip compression via Kong

---

## Monitoring and Analytics

### Usage Analytics

- **Metrics**: Query counts, user activity, session duration
- **Dashboards**: ApexCharts visualizations
- **Endpoints**: `/api/analytics/*`

### Satisfaction Metrics

- **Feedback**: User satisfaction ratings (thumbs up/down)
- **Gauge**: Overall satisfaction score
- **Heatmap**: Satisfaction by query category
- **Trends**: Historical satisfaction data

### Performance Monitoring

- **Response Times**: API response time tracking
- **Error Rates**: Error logging and alerting
- **Resource Usage**: Docker stats for container resources

---

## Documentation

### Core Documentation

- [Architecture Overview](./architecture.md) - Complete system architecture with C4 diagrams
- [Development Guide](./development-guide.md) - Developer setup and workflows
- [Docker Compose Setup](./docker-compose-setup.md) - Local deployment guide
- [Docker Swarm Setup](./docker-swarm-setup.md) - Production deployment guide
- [Mobile Deployment Guide](./mobile-deployment-guide.md) - Mobile app deployment
- [Keycloak Admin Guide](./keycloak-admin-guide.md) - Keycloak configuration
- [External IdP Integration](./external-idp-integration-guide.md) - Google, Microsoft, SAML setup

### Generated Documentation

- [API Contracts](./api-contracts-gov-chat-backend.md) - Backend API specification
- [State Management](./state-management-gov-chat-frontend.md) - Frontend state management
- [UI Component Inventory](./ui-component-inventory-gov-chat-frontend.md) - Frontend components
- [Mobile Architecture](./mobile-architecture-genie-ai-mobile.md) - Mobile app architecture
- [Integration Architecture](./integration-architecture.md) - Service integration
- [Theme System](./theme-system.md) - Design system theming

### Project Documentation

- [README.md](../README.md) - Main project README
- [CONTRIBUTING.md](../CONTRIBUTING.md) - Contribution guidelines
- [CLAUDE.md](../CLAUDE.md) - AI agent development guidelines
- [Database Migrations](./database-migrations.md) - ArangoDB schema changes

---

## Community and Contributing

### Open Source

GENIE.AI is open-source and welcomes contributions. See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.

### License

[Specify license - e.g., MIT, Apache 2.0, etc.]

### Support

- **Issues**: GitHub Issues
- **Discussions**: GitHub Discussions
- **Documentation**: `/docs` directory
- **Code Review**: Pull requests with peer review

---

## Roadmap

### Current Focus (Sprint 20-25)

See [Roadmap Sprint 20-25](./roadmap-sprint-20-to-25.md) for detailed sprint planning.

### Upcoming Features

- Enhanced analytics with custom dashboards
- Advanced RAG techniques (hybrid search improvements)
- Additional language support
- Mobile app enhancements (offline mode improvements)
- Performance optimizations (caching, indexing)

---

## Quick Reference

### Essential Commands

```bash
# Start all services (core only)
docker compose up -d

# Start full stack with OPEA
docker compose --profile opea up -d

# View logs
docker service logs genieai_<service> -f

# Rebuild service
docker compose build <service>

# Run backend tests
cd components/gov-chat-backend && npm test

# Run frontend tests
cd components/gov-chat-frontend && npm test

# Run mobile tests
cd mobile/genie_ai_mobile && flutter test
```

### Important Ports

| Service | Internal Port | Exposed | Description |
|---------|--------------|---------|-------------|
| Frontend | 5173 | No (via nginx) | Vue 3 web app |
| Backend | 3000 | No (via Kong) | Node.js API |
| Document Repo | 3001 | No (via Kong) | File upload service |
| ArangoDB | 8529 | Yes (via .env) | Multi-model database |
| Keycloak | 8080 | No (via Kong) | Identity provider |
| Kong | 8000 | No | API gateway |
| NGINX | 80/443 | Yes | Reverse proxy |
| ChatQnA | 8888 | No | AI chat service |
| Retriever | 7000 | No | Vector retrieval |
| Reranker | 8000 | No | Result reranking |
| vLLM | 8000 | No | LLM inference |

---

## Appendix: Design Principles

### Sovereignty

- Full control over data and AI models
- No external API dependencies for core functionality
- On-premises deployment capability

### Privacy by Design

- Data minimization
- User consent management
- GDPR compliance features
- Secure authentication and authorization

### Interoperability

- Standards-based (OIDC, OAuth2, SAML)
- API-first architecture
- Multi-platform support
- Design system consistency

### Extensibility

- Plugin architecture for AI services
- Configurable RAG pipeline
- Theme system customization
- Multilingual framework

### Performance

- Hybrid vector-graph retrieval
- Redis caching layer
- Streaming responses
- Optimized database queries

---

**Last Updated**: 2026-05-13

**Project**: GENIE.AI - Open-Source Generative AI Framework for the Public Sector

**Version**: [Specify current version]
