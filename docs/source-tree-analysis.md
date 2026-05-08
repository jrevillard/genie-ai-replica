# GENIE.AI - Complete Source Tree Analysis

## Annotated Directory Tree

```
/home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/feat-mobile-oidc-prd/
├── components/                    # Core Application Components (Microservices Architecture)
│   ├── gov-chat-frontend/         # Vue.js 3 Web Application (Entry Point: src/main.js)
│   │   ├── src/
│   │   │   ├── components/       # Reusable UI components (ChatHistory, Analytics, etc.)
│   │   │   ├── views/           # Route-based pages (Chat, Admin, Services, Settings)
│   │   │   ├── services/        # API client layer → Calls backend (/api endpoints)
│   │   │   ├── store/           # Vuex state management
│   │   │   └── i18n/           # Internationalization (11+ languages)
│   │   ├── public/              # Static assets (config, FAQ, icons)
│   │   └── package.json        # Vue 3, Vite, Tailwind CSS, OIDC-Client-TS
│   ├── gov-chat-backend/         # Node.js/Express API Backend (Entry Point: index.js)
│   │   ├── controllers/         # Business logic (Auth, Chat, Admin, Analytics)
│   │   ├── services/           # Core services (Auth, Query, Translation, User Mgmt)
│   │   ├── middleware/          # Security (Keycloak auth, error handling)
│   │   ├── routes/             # API endpoints (RESTful + WebSocket for real-time)
│   │   └── tests/              # Unit tests (Jest)
│   ├── document-repository/     # File Management Service (ClamAV + Metadata)
│   │   ├── src/
│   │   │   ├── controllers/     # File upload, processing, retrieval
│   │   │   └── services/       # Document ingestion, virus scanning
│   │   └── uploads/            # Secure file storage
│   ├── arangodb/                # ArangoDB Configuration & Scripts
│   │   ├── compose.yaml        # Database container setup
│   │   └── dump/restore.sh     # Backup/restore utilities
│   ├── google-translate-example/ # Translation Service Integration
│   └── shared/                  # Shared Libraries (Cross-component utilities)
│       ├── lib/db-connection-service.js  # Database abstraction
│       └── lib/security-*       # Security middleware, headers
├── mobile/                      # Mobile Applications (Flutter Cross-Platform)
│   └── genie_ai_mobile/        # Flutter App (Entry Point: lib/main.dart)
│       ├── lib/
│       │   ├── main.dart       # App entry point (OIDC login, routing)
│       │   ├── components/     # UI components (Chat, Sidebar, Settings)
│       │   ├── services/       # Auth, API, Storage services
│       │   ├── config/         # Flavor configurations (dev/staging/itu)
│       │   └── utils/          # Theme, localization, connectivity
│       ├── android/            # Android-specific (build.gradle, Manifest)
│       ├── ios/               # iOS-specific (Info.plist, Xcode configs)
│       ├── patrol_test/       # E2E Tests (Patrol framework)
│       └── pubspec.yaml      # Dependencies: flutter_appauth, Riverpod, http
├── genie-ai-overlay/           # OPEA Integration Layer (AI/ML Services)
│   ├── chatqna/                # Chat Microservice (RAG + LLM)
│   ├── core/                   # Core Libraries & Protocol
│   ├── dataprep/               # Data Preparation Pipeline
│   ├── retriever/              # Hybrid Vector-Graph Retriever
│   └── reranker/               # Reranking Service (Result Quality)
├── api-gateway-solution/       # API Gateway Stack (Reverse Proxy + Security)
│   ├── nginx/                  # TLS Termination + Security Headers
│   ├── certbot/                # Let's Encrypt SSL Certificates
│   └── new-config/            # Kong Configuration Manager
├── configs/                    # Configuration Management
│   ├── keycloak/              # Identity Provider Configuration
│   ├── opea-config/           # OPEA Infrastructure Configuration
│   └── postgres/              # PostgreSQL Initialization
├── data/                       # Country-Specific Data & Knowledge Bases
├── tests/                      # Testing Infrastructure
│   ├── e2e/                   # End-to-End Tests (Playwright)
│   └── rag-benchmarks/       # RAG Performance & Accuracy Tests
├── deploy/                     # Deployment Infrastructure (Ansible)
│   └── ansible/               # Infrastructure as Code
├── docker-compose.yaml        # Main Orchestration File (Dual-Mode: Compose + Swarm)
├── env                        # Environment Configuration Template
├── package.json               # Root Package Scripts (linting, testing)
└── docs/                      # Additional Documentation
```

## Integration Points Summary

### Authentication Flow
```
Mobile/Web App → Keycloak (OIDC) → Backend API → Services
    ↓                              ↓            ↓
flutter_appauth ←→ JWKS Validation ←→ Auth Middleware
```

### API Gateway Architecture
```
External Traffic → NGINX (TLS/SSL) → Kong (Routing/Rate Limiting) → Backend Services
                                  ↓
                            OPEA AI Services (GPU nodes)
```

### Client-Server Communication
```
Frontend (Vue.js) → /api (Kong proxy) → Backend Services
Mobile (Flutter) → /api (Kong proxy) → Backend Services
→ OPEA Services (ChatQnA, Retriever)
→ ArangoDB (Vector + Graph Search)
```

## Critical Directories by Function

| Function | Directories |
|----------|-------------|
| **Frontend** | `components/gov-chat-frontend/src/` |
| **Backend APIs** | `components/gov-chat-backend/routes/`, `controllers/` |
| **Mobile App** | `mobile/genie_ai_mobile/lib/` |
| **AI/ML Services** | `genie-ai-overlay/*/` |
| **Infrastructure** | `api-gateway-solution/`, `deploy/ansible/` |
| **Testing** | `tests/e2e/`, `mobile/genie_ai_mobile/patrol_test/` |
| **Configuration** | `configs/`, `env*` files |
| **Documentation** | `docs/`, component README files |
