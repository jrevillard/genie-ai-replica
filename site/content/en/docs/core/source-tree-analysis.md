---
title: "Source Tree Analysis"
description: "A walk-through of the GENIE.AI repository structure: every component, its purpose, and its dependencies."
weight: 2
section: "core"
---

**Generated:** 2026-05-13  
**Repository:** `/home/jerome/git_projects/ITU/genie-ai`

## Table of Contents

1. [Overview](#overview)
2. [Top-Level Directory Structure](#top-level-directory-structure)
3. [Part 1: Frontend (Vue 3 Web App)](#part-1-frontend-vue-3-web-app)
4. [Part 2: Backend (Node.js/Express API)](#part-2-backend-nodejsexpress-api)
5. [Part 3: Document Repository](#part-3-document-repository)
6. [Part 4: Mobile (Flutter App)](#part-4-mobile-flutter-app)
7. [Part 5: AI/ML (OPEA Microservices)](#part-5-aiml-opea-microservices)
8. [Part 6: API Gateway (Kong/Nginx)](#part-6-api-gateway-kongnginx)
9. [Integration Points](#integration-points)
10. [Configuration & Deployment](#configuration--deployment)
11. [Testing Structure](#testing-structure)

---

## Overview

GENIE.AI is a sovereign, DPG-compliant RAG (Retrieval-Augmented Generation) system with multilingual support. The monorepo is organized into 6 main parts:

```
genie-ai/
├── components/gov-chat-frontend/     # Part 1: Vue 3 web UI
├── components/gov-chat-backend/      # Part 2: Node.js/Express API
├── components/document-repository/   # Part 3: File upload/processing
├── mobile/genie_ai_mobile/           # Part 4: Flutter mobile app
├── genie-ai-overlay/                 # Part 5: Python/FastAPI OPEA services
├── api-gateway-solution/             # Part 6: Kong/Nginx gateway
├── deploy/                           # Ansible playbooks
├── configs/                          # Service configurations
├── docs/                             # Documentation
├── tests/                            # Integration tests
└── docker-compose.yaml               # Single-file orchestration
```

---

## Top-Level Directory Structure

```
genie-ai/
├── .claude/                    # Claude Code configuration and rules
├── .serena/                    # Serena MCP cache and memories
├── _bmad/                      # BMAD framework scripts and configs
├── _bmad-output/               # BMAD planning artifacts
├── api-gateway-solution/       # Part 6: API Gateway
├── components/                 # Parts 1-3: Frontend, Backend, Doc Repo
├── configs/                    # Service configurations (prompts, Keycloak, PostgreSQL)
├── data/                       # Country-specific data and backups
├── deploy/                     # Ansible deployment playbooks
├── docs/                       # Project documentation
├── document-translation/       # Translation service examples
├── genie-ai-overlay/           # Part 5: AI/ML OPEA microservices
├── mobile/                     # Part 4: Flutter mobile app
├── scripts/                    # Utility scripts
├── secrets/                    # SSL certificates (gitignored)
├── tests/                      # Integration and E2E tests
├── docker-compose.yaml         # Single-file orchestration (all parts)
├── env                         # Environment variables template
└── CLAUDE.md                   # AI agent instructions
```

---

## Part 1: Frontend (Vue 3 Web App)

**Location:** `components/gov-chat-frontend/`  
**Purpose:** Single-page application for chat interface, analytics dashboard, and admin console  
**Tech Stack:** Vue 3 (Options API), Vuex, vue-i18n, ApexCharts, Axios, Vue CLI

### Directory Structure

```
components/gov-chat-frontend/
├── public/                     # Static assets served directly
│   ├── config/                 # Quick help configuration
│   └── icons/                  # SVG icons (downloads, etc.)
├── scripts/                    # Build and utility scripts
├── src/                        # Main application source
│   ├── __tests__/              # Unit tests
│   │   └── store/              # Store module tests
│   ├── assets/                 # Images, fonts, static resources
│   ├── components/             # Reusable Vue components
│   │   ├── ds/                 # Design System components
│   │   │   ├── Button.vue      # DS button component
│   │   │   ├── Card.vue        # DS card component
│   │   │   ├── Input.vue       # DS input component
│   │   │   ├── Modal.vue       # DS modal component
│   │   │   ├── Select.vue      # DS select component
│   │   │   ├── Spinner.vue     # DS loading spinner
│   │   │   ├── StateDisplay.vue # DS state display (empty/error/loading)
│   │   │   ├── Tabs.vue        # DS tab component
│   │   │   ├── Pill.vue        # DS pill/tag component
│   │   │   ├── Combobox.vue    # DS combobox component
│   │   │   ├── FormGroup.vue   # DS form group wrapper
│   │   │   └── StatusTag.vue   # DS status tag component
│   │   ├── AnalyticsComponent.vue         # Analytics page
│   │   ├── AnalyticsDashboard.vue         # Unified analytics dashboard
│   │   ├── ChatHistoryComponent.vue       # Chat history sidebar
│   │   ├── NavBarComponent.vue            # Top navigation bar
│   │   ├── SideBarComponent.vue           # Main sidebar
│   │   ├── RightSideBarComponent.vue      # Right sidebar (file details)
│   │   ├── ServiceTreePanelComponent.vue  # Service category tree
│   │   ├── ServiceCategoryPanelComponent.vue # Service category panel
│   │   ├── UploadFilesDialog.vue          # File upload dialog
│   │   ├── FileUploadComponent.vue        # File upload widget
│   │   ├── FileDetailsDialog.vue          # File details modal
│   │   ├── AddFromLinkDialog.vue          # Add document from URL
│   │   ├── ConfirmDialog.vue              # Generic confirmation dialog
│   │   ├── ModalDialog.vue                # Generic modal wrapper
│   │   ├── OperationResultsModal.vue      # Operation results display
│   │   ├── LogSearchDialog.vue            # Log search dialog
│   │   ├── SplashScreen.vue               # Splash/loading screen
│   │   ├── LanguageSelector.vue           # Language switcher
│   │   └── SearchableCountryDropdown.vue  # Country selector
│   ├── composables/               # Vue 3 composition API functions
│   ├── config/                    # Application configuration
│   ├── i18n/                      # Internationalization
│   │   └── locales/               # Translation files
│   │       ├── en.js              # English (source of truth)
│   │       ├── fr.js              # French
│   │       ├── es.js              # Spanish
│   │       ├── sw.js              # Swahili
│   │       ├── ar.js              # Arabic
│   │       ├── pt.js              # Portuguese
│   │       ├── ru.js              # Russian
│   │       ├── de.js              # German
│   │       ├── zh.js              # Chinese
│   │       ├── th.js              # Thai
│   │       ├── bn.js              # Bengali
│   │       ├── id.js              # Indonesian
│   │       ├── st.js              # Sesotho
│   │       └── man.js             # Manipuri
│   ├── services/                  # API service layer
│   │   ├── httpService.js         # Axios instance with interceptors
│   │   ├── keycloakAuthService.js # Keycloak OIDC integration
│   │   ├── chatbotService.js      # Chat API client
│   │   ├── fileService.js         # File upload/download
│   │   ├── documentFileService.js # Document management
│   │   ├── analyticsService.js    # Analytics API client
│   │   ├── adminDashboardService.js # Admin API client
│   │   ├── userService.js         # User profile API
│   │   ├── userProfileService.js  # User profile (singleton)
│   │   ├── serviceTreeService.js  # Service category tree
│   │   ├── labelService.js        # Document labels
│   │   ├── notificationService.js # Toast notifications
│   │   ├── weatherService.js      # Weather widget
│   │   ├── databaseOperationsService.js # DB operations
│   │   └── index.js               # Service exports
│   ├── store/                     # Vuex state management
│   │   └── modules/               # Vuex modules
│   │       └── auth.js            # Authentication state
│   ├── utils/                     # Utility functions
│   ├── views/                     # Page-level components
│   │   ├── DashboardView.vue      # Main dashboard page
│   │   └── CallbackView.vue       # OIDC callback handler
│   ├── App.vue                    # Root component
│   ├── main.js                    # Application entry point
│   ├── router.js                  # Vue Router configuration
│   ├── eventBus.js                # Event bus for component communication
│   ├── fileDialogSafe.js          # File dialog utilities
│   ├── theme-variables.css        # CSS custom properties (colors, spacing)
│   ├── theme-components.css       # Component-specific theme styles
│   └── charts-apex-overrides.css  # ApexCharts customization
├── .eslintrc.json                 # ESLint configuration
├── package.json                   # Dependencies and scripts
├── vite.config.js                 # Vite build configuration
├── Dockerfile                     # Container image
└── README.md                      # Component documentation
```

### Entry Points

- **`src/main.js`**: Application bootstrap, Vue app initialization, plugin registration
- **`src/App.vue`**: Root component with router-view
- **`src/router.js`**: Route definitions (DashboardView, CallbackView)

### Key Integration Points

- **Backend API:** Via `/api/*` routes through Kong gateway (configured in `src/services/httpService.js`)
- **Keycloak:** OIDC authentication flow (`src/services/keycloakAuthService.js`)
- **i18n:** Translations synced with backend ArangoDB collections
- **ArangoDB:** Direct vector search for service categories (via backend proxy)

---

## Part 2: Backend (Node.js/Express API)

**Location:** `components/gov-chat-backend/`  
**Purpose:** BFF (Backend for Frontend) API, authentication proxy, business logic  
**Tech Stack:** Node.js 22, Express, JWT, Winston, ArangoDB driver, Redis client

### Directory Structure

```
components/gov-chat-backend/
├── __tests__/                    # Unit tests (Jest)
│   ├── authController.test.js
│   ├── keycloak-auth-middleware.test.js
│   ├── keycloak-auth-service.test.js
│   ├── keycloak-proxy-service.test.js
│   ├── opea-continuity.test.js
│   ├── session-service.test.js
│   ├── user-provisioning-service.test.js
│   └── swagger-config.test.js
├── config/                       # Configuration modules
│   └── appConfig.js              # Centralized app configuration
├── constants/                    # Application constants
├── controllers/                  # HTTP request handlers
│   ├── adminController.js        # Admin dashboard endpoints
│   ├── analyticsController.js    # Analytics aggregations
│   └── authController.js         # Authentication helpers
├── middleware/                   # Express middleware
│   └── keycloak-auth.middleware.js # Keycloak token validation
├── routes/                       # API route definitions
│   ├── auth-routes.js            # /api/auth/* (login, logout, refresh)
│   ├── admin-routes.js           # /api/admin/* (admin operations)
│   ├── analytics-routes.js       # /api/analytics/* (usage stats)
│   ├── chat-history-routes.js    # /api/chat/* (conversations, messages)
│   ├── query-routes.js           # /api/query/* (chat queries to OPEA)
│   ├── user-routes.js            # /api/users/* (user management)
│   ├── service-routes.js         # /api/services/* (service catalog)
│   ├── service-category-routes.js # /api/categories/* (category hierarchy)
│   ├── translation-routes.js     # /api/translation/* (translation proxy)
│   ├── database-operations-routes.js # /api/database-operations/* (DB ops)
│   ├── weather-routes.js         # /api/weather/* (weather widget)
│   └── logger-routes.js          # /api/logger/* (log aggregation)
├── services/                     # Business logic layer
│   ├── keycloak-auth-service.js  # Keycloak token validation
│   ├── keycloak-proxy-service.js # Keycloak Admin API proxy
│   ├── session-service.js        # Session management (Redis)
│   ├── user-profile-service.js   # User profile (singleton)
│   ├── user-provisioning-service.js # User provisioning
│   ├── query-service.js          # Chat query orchestration (OPEA ChatQnA)
│   ├── chat-history-service.js   # Conversation CRUD
│   ├── analytics-service.js      # Usage analytics aggregation
│   ├── admin-dashboard-service.js # Admin dashboard data
│   ├── service-category-service.js # Service category hierarchy
│   ├── translation-service.js    # Translation proxy (CPU/GPU backends)
│   ├── translation/
│   │   ├── cpu-translate-backend.js  # CPU translation (Google/Marian)
│   │   └── gpu-translate-backend.js  # GPU translation (vLLM)
│   ├── weather-service.js        # Weather data proxy
│   ├── logs-service.js           # Log aggregation
│   ├── database-operations-service.js # DB operations
│   ├── security-scan-service.js  # ClamAV integration
│   ├── path-sanitizer.js         # File path sanitization
│   ├── key-handler.js            # Encryption key management
│   └── opea-worker.js            # OPEA service orchestration
├── utils/                        # Utility functions
├── workers/                      # Background workers
├── scripts/                      # Utility scripts
├── tests/                        # Integration test fixtures
├── test-fixtures/                # Test data
├── design/                       # Design documentation
├── index.js                      # Application entry point
├── server.js                     # Express server setup
├── app.js                        # Express app configuration
├── config.js                     # Environment configuration
├── docker-entrypoint.sh          # Container startup script
├── Dockerfile                    # Container image
├── Dockerfile.migrations         # Database migrations image
├── package.json                  # Dependencies and scripts
└── README.md                     # Component documentation
```

### Entry Points

- **`index.js`**: Application bootstrap, initializes all services and middleware
- **`server.js`**: HTTP server setup (Express app)
- **`app.js`**: Express app configuration, middleware registration

### Key Integration Points

- **Keycloak:** OIDC authentication, admin API proxy (`services/keycloak-auth-service.js`, `services/keycloak-proxy-service.js`)
- **ArangoDB:** Direct connection for all data operations (users, conversations, messages, service categories)
- **Redis:** Session store, caching
- **OPEA ChatQnA:** Chat query orchestration (`services/query-service.js` → `genie-ai-overlay/chatqna/`)
- **Document Repository:** File upload proxy (`services/security-scan-service.js` → `components/document-repository/`)
- **Translation Service:** Translation backend proxy (`services/translation-service.js` → GPU/CPU backends)

---

## Part 3: Document Repository

**Location:** `components/document-repository/`  
**Purpose:** File upload, virus scanning, and document processing pipeline  
**Tech Stack:** Node.js/Express, Multer, ClamAV, ArangoDB

### Directory Structure

```
components/document-repository/
├── __tests__/                    # Unit tests
├── constants/                    # Application constants
├── controllers/                  # HTTP request handlers
├── design/                       # Design documentation
├── middleware/                   # Express middleware
├── routes/                       # API route definitions
├── services/                     # Business logic layer
│   └── translation/              # Translation configuration
│       └── language-maps/        # Language mapping files
├── scripts/                      # Utility scripts
│   ├── migrations/               # Database migrations
│   └── new-schema-scripts/       # Schema update scripts
├── test-fixtures/                # Test data
├── tests/                        # Integration tests
├── uploads/                      # Temporary upload directory (gitignored)
├── config.js                     # Environment configuration
├── docker-entrypoint.sh          # Container startup script
├── Dockerfile                    # Container image
├── Dockerfile.migrations         # Database migrations image
├── package.json                  # Dependencies and scripts
├── README.md                     # Component documentation
├── README_ingest&retract.md      # Document ingestion/retraction guide
├── README_labels.md              # Document labeling guide
├── README_labels_unused.md       # Unused label documentation
├── README_metadata.md            # Metadata documentation
└── DocumentTranslationServiceConfigurationGuide.md # Translation service config
```

### Entry Points

- **`index.js`**: Application entry point (if follows Express pattern)
- **`config.js`**: Environment configuration

### Key Integration Points

- **Backend Gov-Chat:** Receives upload requests via `/api/files/*` routes
- **ClamAV:** Virus scanning on uploaded files
- **ArangoDB:** Stores document metadata
- **OPEA Dataprep:** Triggers document ingestion pipeline

---

## Part 4: Mobile (Flutter App)

**Location:** `mobile/genie_ai_mobile/`  
**Purpose:** Mobile client for Android/iOS with offline-first architecture  
**Tech Stack:** Flutter 3.10+, Dart, flutter_appauth, flutter_secure_storage

### Directory Structure

```
mobile/genie_ai_mobile/
├── android/                      # Android native code
│   ├── app/                      # Android app configuration
│   └── gradle/                   # Gradle wrapper
├── ios/                          # iOS native code
│   ├── Runner/                   # iOS app configuration
│   └── Runner.xcodeproj/         # Xcode project
├── lib/                          # Dart application source
│   ├── components/               # Flutter widgets
│   │   ├── auth/                 # Authentication screens
│   │   │   └── oidc_login_screen.dart   # OIDC login screen
│   │   ├── chat/                 # Chat interface
│   │   │   ├── chatbot_component.dart   # Chat UI
│   │   │   ├── right_sidebar_component.dart # File details sidebar
│   │   │   ├── chat_response_feedback_dialog.dart # Feedback dialog
│   │   │   ├── right_sidebar_stub.dart   # Stub for web-only features
│   │   │   ├── web_file_utils.dart       # Web file utilities
│   │   │   └── stub_file_utils.dart      # Stub file utilities
│   │   ├── settings/             # Settings screens
│   │   │   ├── settings_component.dart  # Settings page
│   │   │   └── about_screen.dart        # About screen
│   │   ├── sidebar/              # Sidebar components
│   │   │   ├── sidebar_component.dart   # Main sidebar
│   │   │   ├── service_tree_panel.dart  # Service category tree
│   │   │   └── chat_folders_panel.dart  # Chat folders
│   │   ├── user/                 # User profile
│   │   │   └── user_profile_component.dart # User profile page
│   │   └── shared/               # Shared widgets
│   │       ├── nav_bar_component.dart    # Navigation bar
│   │       ├── language_selector.dart    # Language switcher
│   │       └── confirm_dialog.dart       # Confirmation dialog
│   ├── config/                   # Configuration
│   │   └── flavors/              # Flavor-specific configs
│   ├── design_system/            # Design System
│   │   ├── components/           # DS widgets
│   │   │   ├── ds_button.dart    # DS button
│   │   │   ├── ds_input.dart     # DS input field
│   │   │   ├── ds_card.dart      # DS card
│   │   │   ├── ds_modal.dart     # DS modal
│   │   │   ├── ds_spinner.dart   # DS spinner
│   │   │   └── ds_state_display.dart # DS state display (empty/error/loading)
│   │   ├── theme/                # Theme configuration
│   │   │   └── app_theme.dart    # App theme (light/dark)
│   │   └── tokens/               # Design tokens
│   │       ├── app_tokens.dart   # Global tokens
│   │       ├── color_utils.dart  # Color utilities
│   │       ├── spacing.dart      # Spacing tokens
│   │       └── radii.dart        # Border radius tokens
│   ├── i18n/                     # Internationalization
│   │   └── locales/              # Translation files
│   │       ├── en.dart           # English (source of truth)
│   │       ├── fr.dart           # French
│   │       ├── es.dart           # Spanish
│   │       ├── sw.dart           # Swahili
│   │       ├── ar.dart           # Arabic
│   │       ├── pt.dart           # Portuguese
│   │       ├── ru.dart           # Russian
│   │       ├── de.dart           # German
│   │       ├── zh.dart           # Chinese
│   │       ├── th.dart           # Thai
│   │       ├── bn.dart           # Bengali
│   │       ├── id.dart           # Indonesian
│   │       ├── st.dart           # Sesotho
│   │       └── man.dart          # Manipuri
│   ├── providers/                # State management (Provider pattern)
│   ├── services/                 # Business logic layer
│   │   ├── auth/                 # Authentication services
│   │   │   ├── auth_notifier.dart        # Auth state notifier
│   │   │   ├── auth_state.dart           # Auth state model
│   │   │   ├── auth_providers.dart       # Auth providers
│   │   │   ├── app_auth.dart             # flutter_appauth wrapper
│   │   │   ├── token_storage.dart        # Secure token storage
│   │   │   ├── auth_logger.dart          # Auth logging
│   │   │   ├── auth_interceptor.dart     # HTTP interceptor
│   │   │   ├── connectivity_checker.dart  # Network connectivity
│   │   │   ├── network_error_classifier.dart # Error classification
│   │   │   └── insecure_http_client.dart  # HTTP client (dev mode)
│   │   ├── keycloak/             # Keycloak integration
│   │   │   └── keycloak_service.dart      # Keycloak OIDC client
│   │   ├── genie_ai_config.dart   # GENIE.AI configuration
│   │   ├── user_service.dart      # User profile service
│   │   ├── notification_service.dart # Push notifications
│   │   ├── connectivity_service.dart  # Connectivity monitoring
│   │   ├── i18n_service.dart      # i18n service
│   │   ├── fallback_localizations.dart # Fallback localizations
│   │   └── sse_parser.dart        # Server-Sent Events parser
│   ├── src/                      # Generated/sample code
│   │   ├── localization/         # Localization delegates
│   │   ├── settings/             # Settings models
│   │   └── sample_feature/       # Sample feature
│   ├── utils/                    # Utility functions
│   ├── main.dart                 # Application entry point
│   └── app.dart                  # Root app widget
├── test/                         # Unit tests
│   ├── config/                   # Config tests
│   │   └── keycloak_config_test.dart
│   ├── services/                 # Service tests
│   │   ├── auth/                 # Auth service tests
│   │   ├── keycloak/             # Keycloak service tests
│   │   ├── api_service_test.dart
│   │   └── sse_parser_test.dart
│   └── ...
├── patrol_test/                  # Patrol E2E tests
│   └── helpers/                  # Test helpers
├── assets/                       # Static assets
│   ├── config/                   # Configuration files
│   │   └── quickhelp/            # Quick help content
│   ├── fonts/                    # Custom fonts
│   ├── icons/                    # App icons
│   └── images/                   # Images (2.0x for high DPI)
├── flutter_appauth/              # flutter_appauth fork (local copy)
├── analysis_options.yaml         # Dart linting configuration
├── pubspec.yaml                  # Dependencies and configuration
└── README.md                     # Component documentation
```

### Entry Points

- **`lib/main.dart`**: Application bootstrap, initializes services and providers
- **`lib/app.dart`**: Root app widget with Material/Themed widget tree

### Key Integration Points

- **Backend API:** Via `/api/*` routes through Kong gateway (configured in `lib/services/genie_ai_config.dart`)
- **Keycloak:** OIDC authentication flow using `flutter_appauth` (`lib/services/keycloak/keycloak_service.dart`)
- **i18n:** Translations synced with backend ArangoDB collections
- **Design System:** Custom DS components in `lib/design_system/` (mirrors frontend DS)

---

## Part 5: AI/ML (OPEA Microservices)

**Location:** `genie-ai-overlay/`  
**Purpose:** OPEA (Open Platform for Enterprise AI) microservices for RAG pipeline  
**Tech Stack:** Python 3.10+, FastAPI, vLLM, TEI (Text Embeddings), ArangoDB driver

### Directory Structure

```
genie-ai-overlay/
├── .ruff_cache/                  # Ruff linting cache
├── build-patches/                # Docker build patches
├── core/                         # Shared OPEA modules
│   ├── constants.py              # Global constants
│   ├── genieai_api_protocol.py   # API protocol definitions
│   └── README.md                 # Core documentation
├── chatqna/                      # Main chat microservice
│   ├── genieai_chatqna.py        # ChatQnA FastAPI app (main)
│   ├── keycloak_token_validator.py # Keycloak token validation
│   ├── language_codes.json       # Language code mappings
│   ├── Dockerfile-chatqna_genie-ai # Container image
│   ├── entrypoint.sh             # Container startup script
│   └── README.md                 # ChatQnA documentation
├── dataprep/                     # Document ingestion microservice
│   ├── genieai_dataprep_arangodb.py # Dataprep ArangoDB backend
│   ├── genieai_dataprep_loader.py   # Document loader
│   ├── genieai_dataprep_microservice.py # Dataprep FastAPI app
│   ├── genieai_dataprep_utils.py    # Dataprep utilities
│   ├── keycloak_service_account.py   # Keycloak service account
│   ├── LABEL_SELECTOR_SYSTEM_PROMPT-EXAMPLES.txt # Label selector prompt examples
│   ├── Dockerfile-dataprep_genie-ai  # Container image
│   └── README.md                 # Dataprep documentation
├── retriever/                    # Hybrid vector-graph retriever
│   ├── genieai_retriever_arangodb.py # Retriever ArangoDB backend
│   ├── genieai_retriever_microservice.py # Retriever FastAPI app
│   ├── config.py                 # Retriever configuration
│   ├── Dockerfile-retriever_genie-ai # Container image
│   ├── PROPOSED_TEST_STRATEGY.md # Testing strategy
│   └── README.md                 # Retriever documentation
├── reranker/                     # Result reranking service
│   ├── genieai_reranking_microservice.py # Reranker FastAPI app
│   ├── genieai_tei_reranker.py   # TEI reranker backend
│   ├── Dockerfile-reranker_genie-ai # Container image
│   └── README.md                 # Reranker documentation
├── pyproject.toml                # Ruff configuration
└── README.md                     # OPEA overlay documentation
```

### Entry Points

- **`chatqna/genieai_chatqna.py`**: Main chat microservice (FastAPI app)
- **`dataprep/genieai_dataprep_microservice.py`**: Document ingestion microservice
- **`retriever/genieai_retriever_microservice.py`**: Retrieval microservice
- **`reranker/genieai_reranking_microservice.py`**: Reranking microservice

### Key Integration Points

- **Backend Gov-Chat:** ChatQnA called via `/api/query/*` routes (`services/query-service.js`)
- **ArangoDB:** Direct connection for vector search (Retriever), document storage (Dataprep)
- **vLLM:** LLM inference (configured in `docker-compose.yaml`)
- **TEI:** Embeddings and reranking models (configured in `docker-compose.yaml`)
- **Document Repository:** Dataprep ingests uploaded documents

### RAG Pipeline Flow

```
User Query → Backend (query-service.js) → ChatQnA Service → Embedding → Retriever (ArangoDB) → Reranker → LLM → Response
```

---

## Part 6: API Gateway (Kong/Nginx)

**Location:** `api-gateway-solution/`  
**Purpose:** API gateway, reverse proxy, SSL termination, security  
**Tech Stack:** Kong Gateway, NGINX, ModSecurity

### Directory Structure

```
api-gateway-solution/
├── nginx/                        # NGINX reverse proxy
│   ├── conf/                     # NGINX configuration
│   │   └── default.conf          # Main NGINX config
│   ├── modsec/                   # ModSecurity configuration
│   ├── modsec-rules/             # ModSecurity rule sets
│   ├── Dockerfile                # Container image
│   └── entrypoint.sh             # Container startup script
├── new-config/                   # Kong configuration (deprecated/new)
│   ├── kong_config.json          # Kong service/route configuration
│   ├── manage-kong-config.sh     # Kong config management script
│   ├── restore-kong-config.sh    # Kong config restoration script
│   ├── kong-rate-limit.sh        # Rate limiting configuration
│   ├── kong_restore.log          # Kong config restoration log
│   ├── Dockerfile                # Kong config container image
│   └── .gitignore
├── certbot/                      # Certbot for Let's Encrypt (SSL)
└── README.md                     # API gateway documentation
```

### Entry Points

- **`nginx/conf/default.conf`**: NGINX reverse proxy configuration
- **`new-config/kong_config.json`**: Kong gateway configuration

### Key Integration Points

- **Frontend:** Serves static files (Vue SPA)
- **Backend:** Proxies `/api/*` routes to backend services
- **Mobile:** Proxies `/api/*` routes to backend services
- **OPEA:** Proxies `/v1/*` routes to OPEA microservices (internal)
- **Keycloak:** Proxies `/auth/*` routes to Keycloak
- **SSL:** Terminates SSL at NGINX, forwards HTTP internally

---

## Integration Points

### Cross-Part Communication Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        NGINX (api-gateway-solution/)            │
│  SSL termination, static files, reverse proxy, ModSecurity      │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Frontend (Vue)  │  │  Backend API    │  │   Mobile App    │
│ gov-chat-.../   │  │ gov-chat-.../   │  │ genie_ai_.../   │
│ Port: 5173      │  │ Port: 3000      │  │ (native app)    │
└─────────────────┘  └─────────────────┘  └─────────────────┘
         │                    │                    │
         │                    ▼                    │
         │         ┌───────────────────────────┐   │
         │         │  Keycloak (OIDC)          │   │
         │         │  /auth/* routes           │   │
         │         └───────────────────────────┘   │
         │                    │                    │
         │                    ▼                    │
         │         ┌───────────────────────────┐   │
         │         │  ArangoDB (Data Layer)    │   │
         │         │  - users                  │   │
         │         │  - conversations          │   │
         │         │  - messages               │   │
         │         │  - serviceCategories      │   │
         │         │  - vector search          │   │
         │         └───────────────────────────┘   │
         │                    │                    │
         │                    ▼                    │
         │         ┌───────────────────────────┐   │
         │         │  Document Repository      │   │
         │         │  Port: 3001              │   │
         │         │  /api/files/*            │   │
         │         └───────────────────────────┘   │
         │                    │                    │
         │                    ▼                    │
         │         ┌───────────────────────────┐   │
         │         │  OPEA Microservices       │   │
         │         │  - ChatQnA (Port 8888)    │   │
         │         │  - Retriever (Port 7000)  │   │
         │         │  - Reranker (Port 8000)   │   │
         │         │  - Dataprep (Port 5000)   │   │
         │         └───────────────────────────┘   │
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────────────────────────────────────────────────────┐
│                      External Services                           │
│  - vLLM (LLM inference)                                          │
│  - TEI (embeddings/reranking)                                   │
│  - ClamAV (virus scanning)                                      │
│  - Redis (cache/sessions)                                       │
└─────────────────────────────────────────────────────────────────┘
```

### Authentication Flow

1. **Frontend/Mobile:** Redirects to Keycloak (`/auth/*` via NGINX)
2. **Keycloak:** OIDC authentication, issues JWT token
3. **Frontend/Mobile:** Stores token, sends via `Authorization: Bearer` header
4. **Backend:** Validates token via `keycloak-auth-service.js` (Keycloak introspection endpoint)
5. **OPEA ChatQnA:** Validates token via `keycloak_token_validator.py`
6. **Session Management:** Backend stores session data in Redis

### Data Flow

1. **User Query:** Frontend → Backend (`/api/query/*`) → ChatQnA
2. **Document Upload:** Frontend → Backend (`/api/files/*`) → Document Repository → ClamAV → Dataprep
3. **Chat History:** Frontend → Backend (`/api/chat/*`) → ArangoDB
4. **Analytics:** Frontend → Backend (`/api/analytics/*`) → ArangoDB aggregation
5. **User Profile:** Frontend → Backend (`/api/me/*`) → ArangoDB (singleton)
6. **Service Categories:** Frontend → Backend (`/api/categories/*`) → ArangoDB vector search

---

## Configuration & Deployment

### Docker Compose Structure

**Location:** `/docker-compose.yaml` (root)  
**Purpose:** Single-file orchestration for all 6 parts (dual-mode: `docker compose up` and `docker stack deploy`)

#### Service Groups

1. **Layer 1: OPEA AI/ML Infrastructure** (`profile: [opea]`)
   - `vllm` - LLM inference service
   - `tei-embedding` - Text embeddings (TEI)
   - `embedding` - Embedding microservice
   - `tei-reranker` - Reranking (TEI)
   - `retriever` - Hybrid vector-graph retriever
   - `reranker` - Reranking microservice
   - `chatqna` - Main chat microservice
   - `dataprep` - Document ingestion
   - `translation` - Translation service (GPU)

2. **Layer 2: GENIE.AI Services**
   - `frontend` - Vue 3 web app (`components/gov-chat-frontend/`)
   - `backend` - Node.js/Express API (`components/gov-chat-backend/`)
   - `doc-repo` - Document repository (`components/document-repository/`)
   - `arangodb` - ArangoDB database
   - `redis` - Cache/session store

3. **Layer 3: API Gateway**
   - `kong` - Kong API Gateway
   - `nginx` - NGINX reverse proxy
   - `postgres` - PostgreSQL (Kong/Keycloak)
   - `keycloak` - Keycloak OIDC provider
   - `kong-config` - One-shot Kong configuration service

#### GPU Configuration

- **`env.t4`**: NVIDIA T4 (16GB VRAM) configuration
- **`env.rtx6000`**: RTX 6000 ADA (24GB VRAM) configuration

Usage:
```bash
docker compose --env-file .env --env-file env.t4 --profile opea up -d
```

### Ansible Deployment

**Location:** `deploy/ansible/`  
**Purpose:** Automated Docker Swarm deployment with per-environment secrets

#### Structure

```
deploy/ansible/
├── files/                        # Static files (SSL certificates, configs)
├── group_vars/                   # Variables per group (environment)
│   ├── test.vault.example        # Encrypted vault template
│   └── test.vault                # Encrypted secrets (gitignored)
├── inventory/                    # Inventory files
│   └── test.ini.example          # Test environment inventory
├── templates/                    # Jinja2 templates
├── deploy.yml                    # Main deployment playbook
└── teardown.yml                  # Teardown playbook
```

#### Key Features

- **Node labels:** `gateway=true`, `gpu=true`, `genieai=true`
- **Secrets management:** Ansible Vault for sensitive data
- **SSL certificates:** Placed in `files/certificates/<env>/`
- **Tagged re-runs:** `--tags build,deploy`, `--tags deploy`

### Configuration Files

#### Environment Variables

- **`env`** (root, committed): Template with all variables
- **`.env`** (root, gitignored): Local overrides (passwords, API keys)

#### Service Configurations

- **`configs/keycloak/`**: Keycloak realm configurations, clients
- **`configs/postgres/`**: PostgreSQL initialization scripts
- **`configs/opea-config/`**: OPEA service configurations (prompts, model IDs)

#### LLM Prompts

Two-tier priority system:
1. **ENV VAR** (highest): Override in `.env`
2. **DEFAULT** (lowest): Built-in in Python code

Prompt Variables:
- `CHATQNA_SYSTEM_PROMPT` - LLM system prompt
- `CHATQNA_ABSTENTION_INSTRUCTIONS` - Abstention behavior
- `CHATQNA_ENFORCE_ABSTENTION` - Enable/disable abstention
- `LABEL_SELECTOR_SYSTEM_PROMPT` - Document labeling

---

## Testing Structure

### Integration Tests

**Location:** `tests/`  
**Purpose:** End-to-end testing of RAG pipeline

#### Structure

```
tests/
├── rag-benchmarks/               # RAG benchmarking tests
│   ├── benchmark_config.py       # Benchmark configuration
│   ├── benchmark_ingestion.py    # Document ingestion benchmark
│   ├── benchmark_rag_accuracy.py # RAG accuracy benchmark
│   ├── benchmark_rag_performance.py # RAG performance benchmark
│   └── benchmark_query.py        # Query performance benchmark
├── testing_genieai_api_protocol.py     # API protocol tests
├── testing_genieai_chatqna.py          # ChatQnA service tests
├── testing_genieai_retriever_arangodb.py # Retriever tests
├── testing_genieai_tei_reranker.py     # Reranker tests
├── rag_configs_test.py                 # RAG configuration tests
└── run_rag_config_test_async.py        # Async RAG tests
```

### E2E Tests

**Location:** `docs/e2e-tests/`  
**Purpose:** Multi-phase E2E testing with Playwright

#### Structure

```
docs/e2e-tests/
├── README.md                     # E2E test execution guide
├── 00-clean-start.md             # Phase 0: Manual setup
├── 01-keycloak-idp.md            # Phase 1: Keycloak IDP
├── 02-user-creation.md           # Phase 2: User creation
├── 03-frontend-login.md          # Phase 3: Frontend login
├── ...                           # Phases 4-L
└── README.md                     # Execution order and prerequisites
```

### Unit Tests

#### Backend Tests

**Location:** `components/gov-chat-backend/__tests__/`

- `authController.test.js` - Authentication controller tests
- `keycloak-auth-middleware.test.js` - Keycloak middleware tests
- `keycloak-auth-service.test.js` - Keycloak service tests
- `keycloak-proxy-service.test.js` - Keycloak proxy tests
- `opea-continuity.test.js` - OPEA service continuity tests
- `session-service.test.js` - Session management tests
- `user-provisioning-service.test.js` - User provisioning tests

#### Mobile Tests

**Location:** `mobile/genie_ai_mobile/test/`

- `config/keycloak_config_test.dart` - Keycloak config tests
- `services/api_service_test.dart` - API service tests
- `services/sse_parser_test.dart` - SSE parser tests
- `services/keycloak/keycloak_service_test.dart` - Keycloak service tests
- `services/auth/*_test.dart` - Auth service tests (token storage, auth notifier, etc.)

#### Frontend Tests

**Location:** `components/gov-chat-frontend/src/__tests__/`

- `store/auth.test.js` - Vuex auth module tests

---

## Appendix: File Naming Conventions

### JavaScript/Vue 3

- **Components:** PascalCase (`NavBarComponent.vue`, `AnalyticsComponent.vue`)
- **Services:** camelCase (`keycloakAuthService.js`, `chatbotService.js`)
- **Routes:** kebab-case with `-routes.js` suffix (`auth-routes.js`, `query-routes.js`)
- **Controllers:** camelCase with `Controller.js` suffix (`adminController.js`)

### Python (OPEA)

- **Modules:** snake_case (`genieai_chatqna.py`, `keycloak_token_validator.py`)
- **Classes:** PascalCase (`CustomLogger`, `ChatQnAService`)
- **Functions:** snake_case (`get_retriever`, `validate_token`)

### Flutter/Dart

- **Files:** snake_case (`oidc_login_screen.dart`, `user_profile_component.dart`)
- **Classes:** PascalCase (`OidcLoginScreen`, `UserProfileComponent`)
- **Functions/Variables:** camelCase (`fetchUserData`, `isLoggedIn`)

---

## Appendix: Port Mapping

### Exposed Ports (host-accessible)

| Service | Port | Variable |
|---------|------|----------|
| Nginx (HTTP) | 80 | `NGINX_HTTP_PORT` |
| Nginx (HTTPS) | 443 | `NGINX_HTTPS_PORT` |
| ArangoDB | 8529 | `ARANGO_PORT` |

### Internal Ports (container-only)

| Service | Port |
|---------|------|
| Frontend | 5173 |
| Backend | 3000 |
| Document Repository | 3001 |
| Dataprep | 5000 |
| Redis | 6379 |
| ClamAV | 3310 |
| Keycloak | 8080 |
| Kong | 8000 |
| PostgreSQL | 5432 |
| vLLM | 8000 |
| TEI Embedding | 80 |
| Embedding | 6000 |
| TEI Reranker | 80 |
| Retriever | 7000 |
| Reranker | 8000 |
| ChatQnA | 8888 |
| Translation | 9031 |

---

**End of Source Tree Analysis**
