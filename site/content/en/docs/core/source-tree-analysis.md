---
title: "Source Tree Analysis"
description: "A walk-through of the GENIE.AI repository structure: every component, its purpose, and its dependencies."
weight: 2
section: "core"
audience: "developer"
mode: reference
persona: contributor
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

This page maps every directory and entry point to its actual code. Use it to
locate a component, trace a request, or find where a feature lives before you
edit it. Operators and content managers can skip this page.

For the orientation overview, see [Project Overview](/docs/core/project-overview/).
For a deep-dive on how the parts talk to each other, see
[Integration Architecture](/docs/core/integration-architecture/).

## Table of Contents

- [Top-Level Directory Structure](#top-level-directory-structure)
- [Part 1: Frontend (Vue 3 Web App)](#part-1-frontend-vue-3-web-app)
- [Part 2: Backend (Node.js/Express API)](#part-2-backend-nodejsexpress-api)
- [Part 3: Document Repository](#part-3-document-repository)
- [Part 4: Mobile (Flutter App)](#part-4-mobile-flutter-app)
- [Part 5: AI/ML (OPEA Microservices)](#part-5-aiml-opea-microservices)
- [Part 6: API Gateway (Kong/Nginx)](#part-6-api-gateway-kongnginx)
- [Integration Points](#integration-points)
- [Configuration & Deployment](#configuration--deployment)
- [Testing Structure](#testing-structure)
- [Appendix: File Naming Conventions](#appendix-file-naming-conventions)
- [Appendix: Port Mapping](#appendix-port-mapping)

---

## Top-Level Directory Structure

```
genie-ai/
├── .claude/                    # Claude Code configuration and rules
├── api-gateway-solution/       # Part 6: API Gateway (Kong, Nginx, ModSecurity)
├── components/                 # Parts 1-3: Frontend, Backend, Doc Repo
│   ├── gov-chat-frontend/      #   Vue 3 web UI (Vue CLI)
│   ├── gov-chat-backend/       #   Node.js/Express BFF (single entry point: index.js)
│   ├── document-repository/    #   File upload/processing (src/server.js + src/app.js)
│   └── shared/lib/             #   Frozen backend shared library (logger, db-connection-service, security-middleware, validation-utils, melt)
├── configs/                    # Service configurations (otel/, grafana/, keycloak/, postgres/)
├── data/                       # Country-specific data and runtime artefacts
├── deploy/                     # Ansible deployment playbooks + per-env vault files
├── docs/                       # Developer-internal documentation (NOT the published site)
├── document-translation/       # Translation service examples
├── genie-ai-overlay/           # Part 5: AI/ML OPEA microservices
├── mobile/                     # Part 4: Flutter mobile app (includes a local flutter_appauth fork)
├── scripts/                    # Utility scripts
├── secrets/                    # SSL certificates (gitignored — never commit)
├── tests/                      # E2E + config-validator + RAG benchmarks
├── docker-compose.yaml         # Single-file orchestration for both Compose and Swarm
├── env                         # Environment variables template (committed)
└── CLAUDE.md                   # AI agent instructions
```

The published user-facing docs site is `site/` (Hugo + Docsy); this page lives
under `site/content/en/docs/core/`.

---

## Part 1: Frontend (Vue 3 Web App)

**Purpose:** Single-page application for chat, analytics, and admin console.
**Tech Stack:** Vue 3 (Options API), Vuex, vue-i18n, ApexCharts, Axios, Vue CLI.

### Entry points

- `src/main.js` — application bootstrap (registers VueApexCharts, theme CSS,
  fetches `/config/genie-ai-config.json` for runtime overrides).
- `src/App.vue` — root component with `<router-view>`.
- `src/router.js` — defines routes `/callback`, `/dashboard`, `/analytics`,
  `/profile`, `/settings`, `/admin` (all `requiresAuth: true` except
  `/callback`); the `/` path redirects to `/dashboard`.

### Components

```
components/gov-chat-frontend/src/
├── components/
│   ├── ds/                                  # Design System primitives (always use these)
│   │   ├── Button.vue                       # DS button (variant: primary|secondary|ghost|danger)
│   │   ├── Card.vue                         # DS card (variant: default|flat|elevated|outline)
│   │   ├── Combobox.vue                     # DS searchable dropdown
│   │   ├── FormGroup.vue                    # Label + input wrapper
│   │   ├── Input.vue                        # DS input + textarea (size: sm|md|lg)
│   │   ├── Modal.vue                        # DS dialog (size: sm|md|lg|xl)
│   │   ├── Pill.vue                         # DS tag (variant: accent|success|warning|danger|info)
│   │   ├── Select.vue                       # DS select (size: sm|md|lg)
│   │   ├── Spinner.vue                      # DS loading spinner (size + overlay mode)
│   │   ├── StateDisplay.vue                 # Empty/error/loading wrapper
│   │   ├── StatusTag.vue                    # Document/crawl status
│   │   └── Tabs.vue                         # Tab navigation (fill mode)
│   ├── admin/                               # AdminDashboard sub-views
│   ├── charts/                              # Apex chart wrappers (overrides applied via charts-apex-overrides.css)
│   ├── AdminDashboard.vue                   # Admin console (largest component, ~152 KB)
│   ├── AnalyticsComponent.vue               # Legacy analytics view
│   ├── AnalyticsDashboard.vue               # Legacy analytics dashboard
│   ├── ChatBotComponent.vue                 # Main chat UI
│   ├── ChatFolders.vue                      # Folder sidebar
│   ├── ChatHistoryComponent.vue             # Chat history sidebar
│   ├── ChatResponseFeedbackDialog.vue       # Feedback modal
│   ├── ConfirmDialog.vue                    # Generic confirmation
│   ├── ContextMenu.vue                      # Right-click menu
│   ├── FileDetailsDialog.vue                # File details modal
│   ├── FileUploadComponent.vue              # Inline upload widget
│   ├── LanguageSelector.vue                 # Language switcher
│   ├── LogSearchDialog.vue                  # Log search UI (admin)
│   ├── ModalDialog.vue                      # Generic modal wrapper
│   ├── NavBarComponent.vue                  # Top nav
│   ├── OperationResultsModal.vue            # Operation results
│   ├── RightSideBarComponent.vue            # File details sidebar
│   ├── SearchableCountryDropdown.vue        # Country picker
│   ├── ServiceCategoryPanelComponent.vue    # Category panel
│   ├── ServiceTreePanelComponent.vue        # Service category tree
│   ├── SettingsComponent.vue                # Settings page
│   ├── SideBarComponent.vue                 # Main sidebar
│   ├── SplashScreen.vue                     # Loading splash
│   ├── UnifiedAnalytics.vue                 # Unified analytics dashboard
│   └── UploadFilesDialog.vue                # Bulk upload modal
├── composables/                             # Vue 3 Composition API helpers
├── config/
│   └── oidcConfig.js                        # OIDC client config (window.APP_CONFIG → env → defaults)
├── i18n/                                    # vue-i18n setup
│   └── locales/                             # Translation files — 14 locales:
│       ├── en.js  fr.js  es.js  sw.js  ar.js  pt.js  ru.js  de.js
│       ├── zh.js  th.js  bn.js  id.js  st.js  man.js
│       # Active locale list is config-driven (VUE_APP_AVAILABLE_LOCALES);
│       # all 14 files stay in source — a deployment whitelists which render.
├── router.js                                # Vue Router (auth guard via store + keycloakAuthService)
├── services/                                # API client layer
│   ├── adminDashboardService.js
│   ├── analyticsService.js
│   ├── chatHistoryService.js                 # Conversation/folder/message CRUD
│   ├── chatbotService.js                     # Calls /api/queries/stream (SSE) and /api/queries
│   ├── databaseOperationsService.js
│   ├── documentFileService.js                # Document management
│   ├── fileService.js                        # File upload/download
│   ├── httpService.js                       # Axios instance + interceptors
│   ├── index.js                             # Service exports
│   ├── keycloakAuthService.js                # Wraps oidc-client-ts UserManager (in-memory tokens)
│   ├── labelService.js
│   ├── notificationService.js
│   ├── serviceTreeService.js                 # Service category tree
│   ├── userProfileService.js
│   ├── userService.js
│   └── weatherService.js
├── store/                                   # Vuex
│   ├── chatHistoryStore.js
│   ├── index.js
│   └── modules/                             # Vuex sub-modules (auth, categories, etc.)
├── utils/
├── views/
│   ├── CallbackView.vue                     # OIDC callback handler (/callback)
│   └── DashboardView.vue                    # Main dashboard (/dashboard)
├── __tests__/                               # Jest (components + stores + services)
├── App.vue                                  # Root component
├── charts-apex-overrides.css                # ApexCharts dark-mode tooltip overrides
├── eventBus.js
├── fileDialogSafe.js
├── main.js                                  # Application entry point
├── theme-components.css                     # Global token-based component styles
└── theme-variables.css                      # OKLch CSS custom properties (DS tokens)
```

### Build / configuration

- **Build tool:** Vue CLI (NOT Vite) — `vue.config.js` defines `devServer`
  with `port: 8090`, `host: '0.0.0.0'`, and an `/api` proxy to
  `VUE_PROXY_HOST` (default `localhost:3000`).
- **Dev server:** `npm run serve` (alias `npm run dev`) → `http://localhost:8090`
  (NOT 5173 — that is the Vite default; this project uses Vue CLI).
- **Charts:** only **ApexCharts** is used (`apexcharts` + `vue3-apexcharts`
  dependencies). There is **no ECharts** dependency or import.
- **OIDC:** `src/config/oidcConfig.js` reads OIDC config in this order:
  1. `window.APP_CONFIG?.keycloak` (runtime config from `/config/genie-ai-config.json`)
  2. `process.env.VUE_APP_KEYCLOAK_*` (build-time env fallback for `url`/`clientId` only)
  3. Sensible defaults (`origin + /auth`, `realm=genie`, `clientId=genie-app`).

### Key integration points

- **Backend API:** all `/api/*` calls go through Kong. From the dev server,
  `vue.config.js` proxies `/api` to `localhost:3000` (the backend in dev),
  but the production path is `https://<gateway>/api`.
- **Keycloak:** `src/services/keycloakAuthService.js` — wraps
  `oidc-client-ts UserManager`. **Tokens are stored in JavaScript memory only**
  (never in `localStorage`, `sessionStorage`, or cookies — explicit comment in
  the source file). The file's JSDoc states: *"Tokens are stored in
  JavaScript memory only — never in localStorage, sessionStorage, or cookies."*
- **i18n:** translations live in `src/i18n/locales/*.js`; the active set is
  config-driven via `VUE_APP_AVAILABLE_LOCALES` (set at deploy time).
- **ArangoDB:** never accessed directly from the frontend; all vector / graph
  reads are proxied through backend endpoints (`/api/service-categories`,
  `/api/queries`).

### Mapping a Vue service to a Kong route — example

`src/services/chatbotService.js` calls `/api/queries/stream` (POST, SSE). Kong
routes `/api/queries` to `express-api` (backend:3000) with `strip_path: false`,
and Express mounts the handler in `routes/query-routes.js` (see backend below).

---

## Part 2: Backend (Node.js/Express API)

**Purpose:** BFF (Backend for Frontend), authentication proxy, business logic.
**Tech Stack:** Node.js 22, Express, `shared-lib` (frozen singleton: `logger`,
`dbService`, `securityHeaders`, `SecurityMiddleware`), JWT validation
(Keycloak JWKS), Winston logging.

### Entry point

**Only `index.js` exists** — there is no `server.js` and no `app.js` in this
component. The whole component uses a `createApp()` pattern:

```javascript
// components/gov-chat-backend/index.js
const { logger, dbService, securityHeaders, SecurityMiddleware } = require('./shared-lib');
const { keycloakAuthMiddleware } = require('./middleware/keycloak-auth-middleware');
function createApp({ services = {} } = {}) {
  const app = express();
  // … middleware, route mount …
  return app;
}
module.exports = { createApp };
```

This pattern lets tests use `supertest` against an isolated Express app
without starting an HTTP server.

### Directory structure

```
components/gov-chat-backend/
├── __tests__/                                # Jest unit tests (flat at the root of __tests__)
│   ├── routes/                               # Contract tests (`npm run test:contract`)
│   ├── controllers/  middleware/  services/  fixtures/  mocks/
│   ├── authController.test.js  createApp.test.js  keycloak-auth-middleware.test.js
│   ├── keycloak-auth-service.test.js  keycloak-proxy-service.test.js
│   ├── session-service.test.js  user-provisioning-service.test.js  swagger-config.test.js
│   └── logger-* / tracing-* / metrics-* / victorialogs-* tests (~14 files)
├── config/
├── constants/
├── controllers/                              # HTTP request handlers
│   ├── adminController.js
│   ├── analyticsController.js
│   └── authController.js
├── middleware/
│   ├── keycloak-auth-middleware.js           # Exports `keycloakAuthMiddleware.authenticate`
│   ├── metrics-middleware.js
│   └── (error-handler inline in index.js)
├── routes/                                   # Mounted via ROUTE_CONFIGS in index.js
│   ├── admin-routes.js                       # /api/admin/*
│   ├── analytics-routes.js                   # /api/analytics/*
│   ├── auth-routes.js                        # /api/auth/* — POST /logout ONLY
│   ├── chat-history-routes.js                # /api/chat-history/* + /api/chat/* (conversations, folders, messages)
│   ├── database-operations-routes.js         # /api/database/*
│   ├── logger-routes.js                      # /api/logger/*
│   ├── query-routes.js                       # /api/queries/* + /api/query/* (chat → OPEA)
│   ├── service-category-routes.js            # /api/service-categories/*
│   ├── service-routes.js                     # /api/services/*
│   ├── translation-routes.js                 # /api/translate/*
│   ├── user-routes.js                        # /api/me/* (singleton user profile)
│   └── weather-routes.js                     # /api/weather/*
├── services/                                 # Business logic
│   ├── admin-dashboard-service.js
│   ├── analytics-service.js
│   ├── chat-history-service.js               # Conversation/folder/message CRUD
│   ├── database-operations-service.js
│   ├── key-handler.js                        # Encryption key management
│   ├── keycloak-auth-service.js              # JWKS-based JWT validation
│   ├── keycloak-proxy-service.js             # Keycloak Admin API proxy
│   ├── logs-service.js                       # Application log aggregation
│   ├── opea-worker.js                        # OPEA ChatQnA worker threads
│   ├── path-sanitizer.js
│   ├── query-service.js                      # Chat query orchestration → ChatQnA
│   ├── security-scan-service.js              # ClamAV integration
│   ├── service-category-service.js           # Category hierarchy + translations
│   ├── session-service.js                    # ArangoDB-backed sessions (NOT Redis — see note)
│   ├── translation-service.js                # Translation (TRANSLATION_BACKEND = auto|gpu|cpu)
│   ├── translation/                          # CPU + GPU translation backends
│   │   ├── cpu-translate-backend.js
│   │   ├── gpu-translate-backend.js
│   │   ├── markdown-normalize.js
│   │   ├── text-edges.js
│   │   └── translation-cache-key.js
│   ├── user-profile-service.js
│   ├── user-provisioning-service.js
│   └── weather-service.js
├── utils/  workers/  scripts/
├── test-fixtures/
├── design/
├── index.js                                  # ONLY entry point — exports createApp()
├── docker-entrypoint.sh
├── Dockerfile  Dockerfile.migrations
└── package.json
```

**There is NO `server.js` and NO `app.js`** — the only entry is `index.js`.
Earlier versions had separate files; the project consolidated onto
`createApp()` for testability (per `components/gov-chat-backend/CLAUDE.md`
and project `CLAUDE.md`).

### Route mount table

This is the **only** place where route mount paths are defined
(`ROUTE_CONFIGS` in `index.js`):

| Mount path | Route file | Service injected | Keycloak |
|---|---|---|---|
| `/api/me` | `user-routes.js` | `userProfileService` | yes |
| `/api/queries`, `/api/query` | `query-routes.js` | `queryService` | yes |
| `/api/services` | `service-routes.js` | `serviceCategoryService` | yes |
| `/api/chat-history`, `/api/chat` | `chat-history-routes.js` | `chatHistoryService` | yes |
| `/api/analytics` | `analytics-routes.js` | `analyticsService` | yes |
| `/api/service-categories` | `service-category-routes.js` | `serviceCategoryService` | yes |
| `/api/auth` | `auth-routes.js` | — | **no** (mounted without `keycloakAuthMiddleware`) |
| `/api/logger` | `logger-routes.js` | — | yes |
| `/api/database` | `database-operations-routes.js` | `databaseOperationsService` | yes |
| `/api/admin` | `admin-routes.js` | `adminDashboardService`, `logsService` | yes |
| `/api/weather` | `weather-routes.js` | `weatherService` | yes |
| `/api/translate` | `translation-routes.js` | `translationService` | yes |

### Key integration points

- **Keycloak:** JWKS validation in `services/keycloak-auth-service.js`;
  Express middleware in `middleware/keycloak-auth-middleware.js`
  (export `keycloakAuthMiddleware.authenticate`).
- **ArangoDB:** all reads/writes go through `dbService` from `shared-lib`
  (the shared library at `components/shared/lib/` is a frozen singleton,
  consumed via `require('./shared-lib')` — `index.js` line 14). Direct
  `arangojs` use is reserved for migrations.
- **Redis:** used by `services/translation-service.js` only (ioredis), for
  translation caching. Sessions are **not** in Redis — `session-service.js`
  stores sessions in ArangoDB.
- **OPEA ChatQnA:** `services/query-service.js` orchestrates the call to
  `OPEA_HOST:OPEA_PORT` (default `e2e-109-198:8888`; compose override sets
  `OPEA_HOST=chatqna-xeon-backend-server`) via `services/opea-worker.js`
  (worker threads to avoid blocking the event loop).
- **Document Repository:** NOT proxied through the backend. The frontend
  uploads go **directly** to the document-repository service via Kong on
  `/api/files/*` (Kong routes `/api/files` and `/api/labels` straight to
  `document-repository:3001`).
- **Translation:** `services/translation-service.js` dispatches to a CPU or
  GPU backend (`TRANSLATION_BACKEND=auto|gpu|cpu`); `STREAMING_TRANSLATION_ENABLED=1`
  streams translations during generation.

---

## Part 3: Document Repository

**Purpose:** File upload, virus scanning (ClamAV), document processing.
**Tech Stack:** Node.js/Express, Multer, ClamAV (`clamav-daemon` + `clamdscan`),
ArangoDB.

### Entry points

- `src/server.js` — HTTP server setup, boots `src/app.js`.
- `src/app.js` — Express app configuration + middleware registration.
- `package.json` scripts: `npm start` → `node src/server.js`,
  `npm run dev` → `nodemon src/server.js`.

### Directory structure

```
components/document-repository/
├── src/
│   ├── __tests__/                            # Jest (flat under src/__tests__/, mirrors src/)
│   ├── config/  controllers/  middlewares/  routes/  services/  utils/  workers/
│   ├── routes/
│   │   ├── fileRoutes.js                     # /api/files/* (upload, list, fetch, delete)
│   │   └── labelRoutes.js                    # /api/labels/* (label CRUD only — see note)
│   ├── services/                             # ClamAV integration, file processing, etc.
│   ├── app.js                                # Express app (mounted in src/server.js)
│   ├── server.js                             # HTTP server entry point
│   ├── tracing.js                            # OTel SDK initialisation
│   ├── tracing-pii.js                        # PII filter for span attributes
│   └── tracing-pii-logs.js                   # PII filter for log attributes
├── uploads/                                  # Temp upload directory (gitignored)
├── scripts/  scripts/migrations/  scripts/new-schema-scripts/
├── constants/  test-fixtures/  tests/
├── design/
├── config.js
├── docker-entrypoint.sh
├── Dockerfile  Dockerfile.migrations
├── package.json
├── README.md  README_ingest&retract.md  README_labels.md  README_labels_unused.md
├── README_metadata.md  DocumentTranslationServiceConfigurationGuide.md
```

### Integration points

- **Kong:** `/api/files/*` and `/api/labels/*` route to
  `document-repository:3001` directly — **not** through the backend.
- **ClamAV:** `services/security-scan-service.js` (or equivalent under
  `src/services/`) shells out to `clamdscan` via `clamav-node.sh`. **The
  container must keep `clamav-daemon` installed at runtime** — `clamdscan`
  is a `Recommends:` of `clamav-daemon`, dropped by `--no-install-recommends`
  unless explicitly pinned. The Q3-2026 hardening (MR !324) fixed four
  regressions where `clamd` was silently missing in production images. After
  any image slimming, smoke-test with
  `docker exec <doc-repo> clamdscan --version`.
- **ArangoDB:** stores file metadata (`files` collection, `dataprep.status`).
- **Dataprep:** after upload, the document-repository triggers dataprep
  ingestion (calls into `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py`).

### Label flow (clarification)

`/api/labels` is for **label CRUD** (define what labels exist). Assigning
labels to uploaded files happens downstream — dataprep reads the label list
from the backend at `/api/service-categories` and decides per chunk; the
assignment is written via dataprep's own ArangoDB writes.

---

## Part 4: Mobile (Flutter App)

**Purpose:** Mobile client (Android + iOS) with offline-first architecture.
**Tech Stack:** Flutter 3.10+, Dart 3, Riverpod (`flutter_riverpod ^3.0.0`),
flutter_appauth (locally forked), flutter_secure_storage.

### Entry points

- `lib/main.dart` — application bootstrap, initialises Riverpod providers
  and routes.
- `lib/src/app.dart` — root `MaterialApp` widget (themed via DS).

### Directory structure

```
mobile/genie_ai_mobile/
├── lib/
│   ├── components/
│   │   ├── auth/        chat/        settings/        sidebar/        user/        shared/
│   ├── config/         # dev_config.dart, e2e_config.dart, staging_config.dart, keycloak_config.dart
│   │   └── flavors/    # itu.dart (prod), template.dart
│   ├── design_system/
│   │   ├── components/  # ds_button, ds_input, ds_card, ds_modal, ds_spinner, ds_state_display, …
│   │   ├── theme/       # app_theme.dart (light/dark)
│   │   └── tokens/      # app_tokens, color_utils, spacing, radii
│   ├── i18n/locales/    # 14 Dart locale files matching the web frontend
│   ├── providers/
│   │   └── api_providers.dart  # Riverpod provider tree (NOT the Provider package)
│   ├── services/
│   │   ├── auth/        # auth_notifier, auth_state, auth_providers, app_auth (flutter_appauth),
│   │   │                # token_storage, auth_logger, auth_interceptor, connectivity_checker,
│   │   │                # network_error_classifier, insecure_http_client
│   │   ├── keycloak/    # Keycloak OIDC client
│   │   ├── genie_ai_config.dart   # Lives at lib/services/ (NOT lib/config/) — see note below
│   │   ├── user_service.dart  notification_service.dart  connectivity_service.dart
│   │   ├── i18n_service.dart  fallback_localizations.dart  sse_parser.dart
│   ├── src/             # Generated/sample code (app.dart + localization delegates, settings models, sample_feature)
│   ├── utils/           # chart_theme_utils.dart, config_resolver.dart, dialog_theme_utils.dart, theme_manager.dart
│   └── main.dart        # Entry point
├── test/                # flutter_test (config/, services/api_service_test.dart, services/sse_parser_test.dart, …)
├── patrol_test/         # Patrol E2E (helpers/)
├── assets/              # config/quickhelp, fonts, icons, images
├── flutter_appauth/     # LOCAL fork of flutter_appauth (local copy — see mobile/genie_ai_mobile/flutter_appauth/README.md for patch history)
├── android/  ios/  macos/  linux/  windows/  web/
└── pubspec.yaml
```

### Notes

- **State management is Riverpod**, NOT the Provider package. The directory is
  named `providers/` but each file uses `flutter_riverpod` (`^3.0.0` per
  `pubspec.yaml`).
- **`genie_ai_config.dart` lives at `lib/services/`**, not `lib/config/`
  (the `config/` directory exists for flavour files only).
- The **flutter_appauth fork** lives under `flutter_appauth/` at the mobile
  root; it allows `allowInsecureConnections` for dev self-signed certs
  (El-Salvador deployment uses a self-signed cert).

### Integration points

- **Backend API:** all `/api/*` calls go through Kong. The base URL is read
  from `lib/services/genie_ai_config.dart` (per flavour). Dev defaults point
  at the localhost gateway (often via a WireGuard tunnel to the deployed
  stack — see the mobile deployment guide).
- **Keycloak:** `lib/services/keycloak/keycloak_service.dart` + the local
  `flutter_appauth` fork.
- **SSE:** `lib/services/sse_parser.dart` parses `chunk` / `metadata` /
  `translation` / `done` / `error` events from `/api/queries/stream`.

---

## Part 5: AI/ML (OPEA Microservices)

**Purpose:** OPEA (Open Platform for Enterprise AI) microservices for the
RAG pipeline.
**Tech Stack:** Python 3.11 (venv), FastAPI, vLLM, TEI (text-embeddings-inference),
ArangoDB, Docling.

### Directory structure

```
genie-ai-overlay/
├── core/                         # Shared OPEA modules
│   ├── constants.py
│   ├── genieai_api_protocol.py
│   └── README.md
├── contracts/                    # Contract tests vs REAL vendored comps (run inside built images)
│   ├── _harness.py               # Comps guard, fake HTTP, telemetry extraction
│   ├── conftest.py               # Real-comps fixture (mirror of tests/ mocking)
│   └── test_contract_*.py        # Wire, ingest, label-filter, telemetry, e2e, NFR-P budgets
├── chatqna/                      # Main chat orchestrator (port 8888)
│   ├── genieai_chatqna.py        # FastAPI app (main) — MEGA_SERVICE_PORT=8888
│   ├── keycloak_token_validator.py
│   ├── language_codes.json
│   ├── Dockerfile-chatqna_genie-ai
│   ├── entrypoint.sh
│   └── README.md
├── dataprep/                     # Document ingestion (port 5000)
│   ├── genieai_dataprep_arangodb.py  # Main ArangoDB-backed dataprep
│   ├── genieai_dataprep_microservice.py
│   ├── genieai_dataprep_loader.py
│   ├── genieai_dataprep_utils.py
│   ├── keycloak_service_account.py
│   ├── LABEL_SELECTOR_SYSTEM_PROMPT-EXAMPLES.txt
│   ├── Dockerfile-dataprep_genie-ai
│   └── README.md
├── retriever/                    # Hybrid vector-graph retriever (port 7000)
│   ├── genieai_retriever_arangodb.py
│   ├── genieai_retriever_microservice.py   # ← run with `python genieai_retriever_microservice.py`
│   ├── config.py
│   ├── Dockerfile-retriever_genie-ai
│   └── README.md
├── reranker/                     # Reranker (port 8000)
│   ├── genieai_reranking_microservice.py
│   ├── genieai_tei_reranker.py
│   ├── Dockerfile-reranker_genie-ai
│   └── README.md
├── embedding/                    # Dockerfile-embedding_genie-ai (no Python entry — built into chatqna image)
├── textgen/                      # textgen variant
├── build-patches/                # Site-startup hooks, override audit
│   ├── install_site_startup.sh
│   ├── lint_overrides.py         # Enforces OVERRIDES.yaml ↔ source markers sync
│   └── docarray_alias_shim.py    # Docarray import-name shim
├── tests/                        # Unit tests (comps MOCKED via conftest.py)
├── tracing.py                    # OTel SDK initialisation
├── OVERRIDES.yaml                # Audit of every OPEA vendored-code deviation
├── pyproject.toml                # Ruff config
├── pytest.ini                    # pytest config (testpaths = tests)
├── CLAUDE.md  AGENTS.md          # Component-level AI agent instructions
└── README.md
```

### Service entry points

| Service | Entry point (Python module) | Container name | Port |
|---|---|---|---|
| ChatQnA | `chatqna/genieai_chatqna.py` | `chatqna-xeon-backend-server` | 8888 |
| Dataprep | `dataprep/genieai_dataprep_microservice.py` | `dataprep-arango-service` | 5000 |
| Retriever | `retriever/genieai_retriever_microservice.py` | `retriever-arango-service` | 7000 |
| Reranker | `reranker/genieai_reranking_microservice.py` | `reranker` | 8000 |
| Translation (OPEA) | upstream `opea/translation:1.5` | `translation` | 8888 |

To run a service locally:

```bash
cd genie-ai-overlay/retriever
python -m venv .venv && source .venv/bin/activate
pip install -r requirements-cpu.txt   # or -gpu.txt depending on host
python genieai_retriever_microservice.py
```

### RAG pipeline flow

```
User Query → Backend (query-service.js) → ChatQnA Service
  → Embedding (TEI) → Retriever (ArangoDB) → Reranker (TEI) → LLM (vLLM)
  → Response (SSE chunks back to backend, then to frontend)
```

### Override audit (must-read before editing OPEA files)

Every deviation from upstream OPEA vendored code is recorded in
`OVERRIDES.yaml` **AND** mirrored as a
`# OVERRIDE <module>.<name> | disposition: <still-needed|re-graft-to-new-API|obsolete-remove> | reason: … | test: …`
marker in the corresponding source file. `build-patches/lint_overrides.py`
enforces the sync — run it after touching any override:

```bash
python build-patches/lint_overrides.py   # must exit 0
```

---

## Part 6: API Gateway (Kong/Nginx)

**Purpose:** API gateway, reverse proxy, TLS termination, ModSecurity WAF.
**Tech Stack:** Kong Gateway (DB-less mode), NGINX, ModSecurity, Certbot.

### Directory structure

```
api-gateway-solution/
├── nginx/
│   ├── conf/                        # NGINX site config (default.conf)
│   ├── modsec/                      # ModSecurity main config
│   ├── modsec-rules/                # ModSecurity rule sets (CRS, custom)
│   ├── Dockerfile
│   └── entrypoint.sh
├── new-config/                      # ACTIVE Kong configuration (the "new" in "new-config" means it replaced the legacy root kong.yml)
│   ├── kong_config.json             # Services + routes (DB-less declarative)
│   ├── manage-kong-config.sh        # Programmatic reload helper
│   ├── restore-kong-config.sh       # Restore kong_config.json into Kong via Admin API
│   ├── kong-rate-limit.sh           # Rate-limit policy helper
│   ├── kong_restore.log             # Operational log (rotated)
│   ├── Dockerfile
│   ├── package.json  package-lock.json
│   ├── __tests__/                   # jest tests against kong_config.json
│   └── .gitignore
├── certbot/                         # Certbot for Let's Encrypt (replicas: 0 by default — one-shot)
└── README.md
```

### Entry points

- **`nginx/conf/default.conf`** — NGINX reverse-proxy configuration
  (TLS termination, ModSecurity, static file serving, WebSocket/SSE passthrough
  via `proxy_buffering off`).
- **`new-config/kong_config.json`** — Kong gateway configuration
  (services + routes, DB-less declarative).

### Verify which Kong config is live

After a deploy, check the loaded config matches the file on disk:

```bash
# Get the live route table
docker exec <kong-container> curl -s http://localhost:8001/routes | jq '.data[].paths'

# Compare against the file
jq '.routes[].paths' api-gateway-solution/new-config/kong_config.json
```

### Integration points

- **Frontend:** NGINX serves the Vue SPA (static files) and proxies
  `/api/*` to Kong.
- **Backend:** Kong routes `/api/*` (except `/api/files`, `/api/labels`) to
  `express-api` (backend:3000).
- **Document Repository:** `/api/files/*` and `/api/labels/*` route
  directly to `document-repository:3001` (NOT through the backend).
- **OPEA:** internal-only — accessed by `services/query-service.js` from
  the backend, not via Kong.
- **Keycloak:** `/auth/*` routes to `keycloak:8080` with `strip_path: true`
  (Kong rewrites the path before forwarding).

---

## Integration Points

### Cross-part communication flow

```
┌─────────────────────────────────────────────────────────────────┐
│                        NGINX (api-gateway-solution/)            │
│  SSL termination, static SPA, reverse proxy, ModSecurity        │
└─────────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│ Frontend (Vue)  │  │  Kong Gateway   │  │   Mobile App    │
│ Port: 8090      │  │  Port: 8000     │  │ (native app)    │
└─────────────────┘  │  Admin: 8001    │  └─────────────────┘
                     └────────┬────────┘           │
                              │                    │
                              ▼                    │
              ┌──────────────────────────────┐    │
              │  express-api (backend:3000)  │    │
              │  /api/* except /files        │    │
              └──────────┬───────────────────┘    │
                         │                        │
              ┌──────────┼───────────────────┐    │
              │          │                   │    │
              ▼          ▼                   ▼    ▼
      ┌──────────┐  ┌──────────────┐  ┌──────────────────┐
      │ Keycloak │  │ ArangoDB     │  │ Document Repo    │
      │ :8080    │  │ (data)       │  │ :3001            │
      │ /auth/*  │  │ - users      │  │ /api/files/*     │
      │          │  │ - chunks     │  │ /api/labels/*    │
      └──────────┘  │ - vectors    │  └──────────────────┘
                    └──────────────┘
                         │
                         ▼
              ┌──────────────────────────┐
              │  OPEA microservices      │
              │  chatqna:8888            │
              │  dataprep:5000           │
              │  retriever-arango:7000   │
              │  reranker:8000           │
              │  vllm:8000               │
              │  tei-embedding:80        │
              └──────────────────────────┘
```

### Authentication flow

1. Frontend/Mobile → Keycloak (`/auth/*` via NGINX) for OIDC login.
2. Keycloak returns a JWT (access + refresh) via OIDC Authorization Code flow.
3. Frontend stores the JWT in JavaScript memory (`oidc-client-ts UserManager`
   in-memory store) and injects it as `Authorization: Bearer <token>`.
4. Backend validates the token via `keycloak-auth-service.js` (JWKS check).
5. OPEA ChatQnA validates the token via `keycloak_token_validator.py`.
6. Sessions are stored in **ArangoDB** (`session-service.js`), NOT Redis.

### Data flows (one line per request type)

- **User query:** frontend → `/api/queries/stream` → backend (`query-service`)
  → ChatQnA → SSE chunks back.
- **Document upload:** frontend → `/api/files` (multipart) → document-repository
  → ClamAV scan → dataprep triggers ingestion.
- **Chat history:** frontend → `/api/chat-history/*` or `/api/chat/*` → ArangoDB.
- **Analytics:** frontend → `/api/analytics/*` → ArangoDB aggregation.
- **User profile:** frontend → `/api/me` → ArangoDB (singleton service).
- **Service categories:** frontend → `/api/service-categories` → ArangoDB
  (vector search used here for category-tree assembly).

---

## Configuration & Deployment

### Docker Compose structure

The single `docker-compose.yaml` covers both `docker compose up` and
`docker stack deploy` via profiles:

#### Service groups (selected — 16 deployable services)

1. **OPEA AI/ML** (`profiles: [opea]`, `[gpu-models]`)
   - `tei` (embeddings, port 80), `embedding` (port 6000),
     `tei_reranker` (port 80), `reranker` (port 8000),
     `dataprep-arango-service` (port 5000),
     `retriever-arango-service` (port 7000),
     `chatqna-xeon-backend-server` (port 8888),
     `vllm` (port 8000), `vllm-translation-guardrail` (port 9031),
     `translation` (port 8888), `textgen`,
     `chatqna-xeon-ui-server` (`profiles: [opea]`, dev-only), `guardrail` (disabled).

2. **GENIE.AI core services** (always active)
   - `frontend` (port 8090), `backend` (port 3000),
     `document-repository` (port 3001),
     `arango-vector-db` (port 8529, host-exposed),
     `redis-cache` (port 6379), `clamav` (port 3310).

3. **API gateway + identity** (always active)
   - `nginx` (80/443, host-exposed), `kong` (8000/8001),
     `kong-migrations`, `kong-config`, `postgres` (5432), `postgres-init`,
     `keycloak` (8080), `keycloak-config`, `certbot` (`replicas: 0`).

4. **Observability** (`profile: [observability]`)
   - `otel-collector`, `otel-collector-init`, `victoriametrics`, `victorialogs`,
     `victoriatraces`, `tempo-proxy`, `grafana` (all internal — Grafana reachable
     via Kong `/grafana/`).

#### GPU configuration

- **`env.t4`** — NVIDIA T4 (16 GB VRAM)
- **`env.rtx6000`** — RTX 6000 ADA (24 GB VRAM)

Usage:

```bash
docker compose --env-file .env --env-file env.t4 --profile opea up -d
```

### Ansible deployment

See [Deployment](/docs/deploy/) for the full flow. Layout:

```
deploy/ansible/
├── files/                         # SSL certificates, configs (per env)
├── group_vars/                    # Per-env variables (test, prod, …)
│   ├── test.vault.example
│   └── test.vault                 # Encrypted secrets (gitignored)
├── inventory/                     # Inventory files (test.ini.example)
├── templates/                     # Jinja2 templates
├── deploy.yml                     # Main deployment playbook
└── teardown.yml
```

Key features: node labels (`gateway=true`, `gpu=true`, `genieai=true`), Ansible
Vault for secrets, tagged re-runs (`--tags build,deploy`, `--tags deploy`).

### Environment files

- **`env`** (root, committed) — template with every variable and inline comments.
- **`.env`** (root, gitignored) — local overrides (passwords, API keys).

> Never commit `.env` — it contains secrets and is in `.gitignore`.

### Service configurations

- **`configs/otel/`** — OTel Collector config (`otel-collector-config.yaml`).
- **`configs/grafana/provisioning/`** — Grafana datasources, dashboards, alerting.
- **`configs/keycloak/`** — Keycloak realm configurations and clients.
- **`configs/postgres/`** — PostgreSQL initialisation scripts.

### LLM prompts — pointer

Two-tier priority (ENV VAR → DEFAULT in Python code). The full list lives at
[Configuration → Prompts](/docs/configure/#prompts); the variables are
`CHATQNA_SYSTEM_PROMPT`, `CHATQNA_ABSTENTION_INSTRUCTIONS`,
`CHATQNA_ENFORCE_ABSTENTION`, `LABEL_SELECTOR_SYSTEM_PROMPT`,
`CONTEXTUAL_RETRIEVAL_PROMPT`. Do not duplicate them here.

---

## Testing Structure

### Integration tests

RAG benchmarks under `tests/rag-benchmarks/` (ingestion, RAG accuracy,
RAG performance, query performance, config).

### E2E tests

Multi-phase procedure in `docs/e2e-tests/` — start at
`docs/e2e-tests/00-clean-start.md` and follow phases in order. Each phase
has prerequisites + cleanup steps.

### Unit tests (flat layout)

#### Backend (`components/gov-chat-backend/__tests__/`)

The Jest tests live **flat** at the root of `__tests__/`. `__tests__/routes/`
holds contract tests (route-handler tests run via `npm run test:contract`,
which filters to `--testPathPattern='__tests__/routes/'`). Other subdirs
(`controllers/`, `middleware/`, `services/`, `fixtures/`, `mocks/`) hold
support code and per-component tests.

Tests include: `authController.test.js`, `createApp.test.js`,
`keycloak-auth-middleware.test.js`, `keycloak-auth-service.test.js`,
`keycloak-proxy-service.test.js`, `session-service.test.js`,
`user-provisioning-service.test.js`, `swagger-config.test.js`,
`metrics*.test.js`, `tracing*.test.js`, `logger-*.test.js`,
`victorialogs-transport*.test.js`, `pii-body-scrubbing.test.js`,
`trace-propagation.test.js`, `validation-utils.test.js`,
`opea-continuity.test.js`.

Run:

```bash
cd components/gov-chat-backend
npm test                  # All Jest tests
npm run test:contract     # Only __tests__/routes/ (route-handler contract tests)
npm run test:coverage     # With coverage report
```

#### Document-repository (`components/document-repository/src/__tests__/`)

Tests mirror `src/` structure; `npm run test:contract` filters
`src/__tests__/unit/(controllers|middlewares)/`.

#### Mobile (`mobile/genie_ai_mobile/test/`)

`config/`, `services/`, and per-feature folders. Run with `flutter test`.

#### Frontend (`components/gov-chat-frontend/src/__tests__/`)

Jest + `@vue/test-utils`. Tests mirror `src/` structure
(`components/`, `services/`, `store/`, `utils/`). The frontend **does not**
have a `test:contract` script — use `npm test` for everything.

#### OPEA (`genie-ai-overlay/tests/`)

`comps` library is **mocked** via `tests/conftest.py`. A separate `contracts/`
suite runs against the **real** vendored comps inside the built image (no
parent conftest contamination — see `contracts/README.md`).

```bash
cd genie-ai-overlay
source .venv/bin/activate
pytest                                 # All mocked tests
pytest tests/test_chatqna.py           # Specific service
pytest contracts/                      # Contract tests vs real comps (in-image)
```

---

## Appendix: File Naming Conventions

### JavaScript / Vue 3

- Components: PascalCase (`NavBarComponent.vue`, `AnalyticsComponent.vue`).
- Services: camelCase (`keycloakAuthService.js`, `chatbotService.js`).
- Routes: kebab-case with `-routes.js` suffix (`auth-routes.js`,
  `query-routes.js`).
- Controllers: camelCase with `Controller.js` suffix (`adminController.js`).

### Python (OPEA)

- Modules: snake_case (`genieai_chatqna.py`, `keycloak_token_validator.py`).
- Classes: PascalCase (`CustomLogger`, `ChatQnAService`).
- Functions: snake_case (`get_retriever`, `validate_token`).

### Flutter / Dart

- Files: snake_case (`oidc_login_screen.dart`, `user_profile_component.dart`).
- Classes: PascalCase (`OidcLoginScreen`, `UserProfileComponent`).
- Functions / variables: camelCase (`fetchUserData`, `isLoggedIn`).

---

## Appendix: Port Mapping

### Host-exposed (Swarm)

| Service | Port | Variable |
|---|---|---|
| Nginx (HTTP) | 80 | `NGINX_HTTP_PORT` |
| Nginx (HTTPS) | 443 | `NGINX_HTTPS_PORT` |
| ArangoDB | 8529 | `ARANGO_PORT` |

### Internal (container-only)

| Service | Port |
|---|---|
| Frontend | 8090 |
| Backend | 3000 |
| Document Repository | 3001 |
| Dataprep | 5000 |
| Redis | 6379 |
| ClamAV | 3310 |
| Keycloak | 8080 |
| Kong (proxy) | 8000 |
| Kong (admin) | 8001 |
| PostgreSQL | 5432 |
| vLLM | 8000 |
| TEI Embedding | 80 |
| Embedding | 6000 |
| TEI Reranker | 80 |
| Retriever | 7000 |
| Reranker | 8000 |
| ChatQnA | 8888 |
| Translation (OPEA) | 8888 |
| vLLM translation guardrail | 9031 |
| OTel Collector (OTLP HTTP) | 4318 |
| OTel Collector (fluent_forward) | 24224 |
| VictoriaMetrics | 8428 |
| VictoriaLogs | 9428 |
| VictoriaTraces | 10428 |
| Grafana (container) | 3000 |
