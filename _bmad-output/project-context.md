---
project_name: 'genie-ai'
user_name: 'Jerome'
date: '2026-03-27'
sections_completed:
  ['technology_stack', 'language_rules', 'framework_rules', 'testing_rules', 'quality_rules', 'workflow_rules', 'anti_patterns']
status: 'complete'
rule_count: 47
optimized_for_llm: true
---

# Project Context for AI Agents

_This file contains critical rules and patterns that AI agents must follow when implementing code in this project. Focus on unobvious details that agents might otherwise miss._

---

## Technology Stack & Versions

### Frontend
- Vue 3.2+ with **Options API** (NOT Composition API, NOT `<script setup>`)
- Vuex 4, Vue Router 4, vue-i18n 9
- Vue CLI 5 (build tool)
- Axios **1.10+** (unified with backend)
- ECharts 5, ApexCharts 4, DOMPurify 3, Marked 15
- ES module imports with `@/` alias for `src/`

### Backend
- Node.js 22 (Docker image), Express 4.18
- **CommonJS only** — use `require()`/`module.exports`, NEVER ES imports
- ArangoDB 3.12+ via arangojs 8.8, Redis via ioredis 5.8
- Axios **1.10+** (unified with frontend)
- JWT (jsonwebtoken 9), bcrypt 5
- Winston 3 + daily-rotate-file, `safeStringify` for sensitive data masking
- Swagger docs served at `/api-docs`

### AI/ML Layer (Python — separate ecosystem)
- OPEA microservices in `genie-ai-overlay/`: ChatQnA, Retriever, Dataprep, Reranker
- Python/FastAPI, `CustomLogger` from `comps` library
- Config via `os.getenv()` with defaults
- **Copyright headers required** (ITU, or Intel+ITU for OPEA adaptations)
- LLM prompts use 3-tier priority: ENV VAR > FILE (`configs/prompts/`) > DEFAULT (in code)

### Mobile
- Flutter 3.10+, Dart

### Infrastructure
- Docker single-stage builds (Node 22.14.0 for backend)
- Kong / NGINX API Gateway
- ClamAV for document scanning
- ESLint 10 (flat config) + Prettier 3 in frontend and backend
- Jest test suite in `__tests__/` with 20+ test files (routes, services, middleware, tracing)

---

## Critical Implementation Rules

### Language-Specific Rules

#### JavaScript — Backend (Node.js)
- **CommonJS only**: `const x = require('x')` and `module.exports = { ... }`
- Never use `import`/`export` syntax — will break at runtime
- `const` by default, `let` for reassignments, never `var`
- 2-space indentation, single quotes, mandatory semicolons
- Async handling: `async/await` preferred over raw Promises
- Validation: use `joi` schemas for input validation
- Date handling: use `luxon` (not native Date)
- File uploads: `multipart/form-data` via `multer`, NOT JSON

#### JavaScript — Frontend (Vue)
- ES module `import`/`export` syntax (browser-bundled by Vue CLI)
- Use `@/` path alias for imports from `src/`
- `const`/`let` same rules as backend
- Markdown rendering: use `marked` library, sanitize with `DOMPurify`
- Backend code is NOT in a `src/` subdirectory — files are at service root level

#### Python — OPEA Services
- PEP 8, `ruff` for linting and formatting (configured in `genie-ai-overlay/pyproject.toml`)
- Copyright headers required on all files
- Use `CustomLogger` from `comps`, never `print()` for logging
- Environment: `os.getenv('VAR', 'default_value')`

#### Module Boundary Rules
- `components/shared/lib/` is backend-only shared code (logger). Frontend does NOT import from `shared/`
- Python AI layer (`genie-ai-overlay/`) is a completely separate ecosystem — different language, conventions, and config

### Framework-Specific Rules

#### Vue 3 (Frontend)
- **Options API** — `export default { name, data(), methods, computed, ... }`
- **Props**: Object form with type validation: `props: { name: { type: String, required: true } }`
- **Vuex**: Use `mapGetters`/`mapActions` in computed/methods. `this.$store.dispatch()` also used.
- **i18n**: Use `translate('key.path', 'default')` function — NOT `$t()`. This is a project-specific wrapper.
- **API calls**: Always through `httpService.js` (src/services/), never direct axios in components
- **Component communication**: Event bus (`eventBus.js`) for cross-component events — do not replace with provide/inject
- **Routing**: Vue Router history mode, programmatic navigation + route guards
- **Service layer**: Domain-specific services in `src/services/`

#### Express (Backend)
- **Route structure**: Each domain has its own file in `routes/` exporting `express.Router()`
- **`createApp()` pattern**: `index.js` exports `createApp()` for testability — inject dependencies, create isolated Express app for supertest without starting server
- **Auth middleware**: Applied **per-route** via `authMiddleware.authenticate` — NEVER global
- **Error handling**: `try/catch` in route handlers, global error middleware in `index.js`
- **DB access**: Direct `arangojs` with AQL queries in service files — no ORM, no repository pattern
- **Config**: Minimal `config.js` at service root. Most config via `process.env` with defaults inline.
- **Logging**: Import `{ logger }` from `../shared-lib`
- **Tracing**: OTel SDK initialized in `tracing.js`, span helpers in `tracing-db.js`, PII filtering in `tracing-pii.js`, Prometheus metrics in `metrics.js`

### Testing Rules

#### Backend (Node.js)
- **Framework**: Jest (in devDependencies, CommonJS mode)
- **Module system**: CommonJS — test files use `require()`/`module.exports`
- **File location**: `__tests__/` directory alongside code, or `.test.js` co-located
- **Naming**: `*.test.js` (e.g., `keycloak-auth-middleware.test.js`)
- **Structure**: `describe()` / `it()` / `expect()`
- **Mocks**: Mock external services (ArangoDB, Redis, external APIs) at module level
- **Shared fixtures**: `__tests__/mocks/mockJwtPayload.js` for JWT token fixtures
- **Error format tests**: Verify `{ error, message, details }` structure, not raw errors

#### Frontend (Vue)
- **Framework**: Jest with jsdom environment
- **Module system**: ES modules — test files use `require()`/`module.exports` (Jest CommonJS interop)
- **File location**: `src/__tests__/` directory (mirrors src structure)
- **Naming**: `*.test.js` (e.g., `keycloakAuthService.test.js`)
- **Structure**: `describe()` / `it()` / `expect()`
- **Vue SFC**: `@vue/vue3-jest` transformer, `babel-jest` for JS
- **Mocks**: `jest.mock()` for services and external libraries (`oidc-client-ts`)
- **Config**: `jest.config.js` at service root, `setup.js` for global test setup
- **Path alias**: `moduleNameMapper` maps `@/` to `<rootDir>/src/`

#### Test File Location Convention

| Component | Test Directory | Example |
|-----------|---------------|---------|
| Backend (gov-chat-backend) | `__tests__/` | `__tests__/keycloak-auth-middleware.test.js` |
| Frontend (gov-chat-frontend) | `src/__tests__/` | `src/__tests__/userService.test.js` |
| Backend mock fixtures | `__tests__/mocks/` | `__tests__/mocks/mockJwtPayload.js` |
| OPEA Services (genie-ai-overlay) | `tests/` | `tests/test_retriever.py` |
| OPEA shared fixtures | `tests/conftest.py` | pytest fixtures for all services |
| Document Repository | `__tests__/` | `__tests__/routes/*.test.js` |
| Config Validation | `tests/config-validator/` | `tests/config-validator/*.test.js` |
| E2E | `tests/e2e/` | `tests/e2e/*.spec.js` |

#### Backend Test Patterns

- **`createApp()` pattern**: `index.js` exports `createApp()` — tests create isolated Express instances via `supertest` without starting HTTP server
- **Module-level mocking**: `__tests__/mocks/shared-lib.js` mocks frozen `db-connection-service` singleton via Jest `moduleNameMapper`
- **Test structure**: `__tests__/routes/` (route handlers), `__tests__/controllers/`, `__tests__/services/`, `__tests__/middleware/`
- **Fixtures**: `__tests__/fixtures/` contains reusable test data (users, tokens, requests)

#### OPEA / Python Testing

- **Framework**: pytest (configured in `genie-ai-overlay/pytest.ini`)
- **Module system**: Standard Python imports; tests run from `genie-ai-overlay/` directory
- **File location**: `genie-ai-overlay/tests/` directory
- **Naming**: `test_*.py` (e.g., `test_chatqna.py`, `test_retriever.py`)
- **Shared fixtures**: `tests/conftest.py` — pytest fixtures for all OPEA services (mock comps library, ArangoDB, model endpoints)
- **Mock infrastructure**: Fixtures mock the `comps` library (vendored at build time as `opea_docarray`), ArangoDB, and external model endpoints
- **Tracing tests**: `test_tracing_with_span.py`, `test_*_tracing.py` validate OTel span emission per service
- **JUnit XML**: pytest configured with `--junitxml=reports/pytest-report.xml` for CI reporting
- **Copyright headers**: All Python test files must include ITU copyright header

#### Observability / Tracing Rules

- **OTel SDK**: Backend uses `@opentelemetry/*` packages (initialized in `tracing.js`); OPEA uses `opentelemetry-*` packages (initialized in `genie-ai-overlay/tracing.py`)
- **Span creation**: Use `tracing.withSpan(name, fn)` (backend) or `tracing.trace_span(name)` decorator (Python) — never create spans manually via global tracer
- **PII filtering**: `tracing-pii.js` (backend) filters sensitive attributes from spans — never log raw tokens, passwords, or user PII in span attributes
- **DB instrumentation**: `tracing-db.js` instruments ArangoDB queries — automatic span creation for DB operations
- **Trace propagation**: W3C `traceparent` header propagated across all service boundaries (Kong → Backend → ChatQnA → Retriever → Reranker)
- **Test helpers**: `tracing-with-span.test.js` / `test_tracing_with_span.py` validate span emission without OTel collector running

#### Authentication Test Conventions

- **JWT auth fields**: Always verify `iss_sub`, `sub`, `iss` (JWT claims), NOT `_key` (ArangoDB internal)
- **Error codes**: All auth errors use `{ error, message, details }` format
- **Error codes to test**: TOKEN_INVALID, TOKEN_EXPIRED, FORBIDDEN, PROVISIONING_FAILED, AUTH_SERVICE_UNAVAILABLE

### Code Quality & Style Rules

#### Linting & Formatting
- ESLint 10 (flat config: `eslint.config.js`) + Prettier 3 in both services
- Scripts: `npm run lint`, `npm run lint:fix`, `npm run format`
- Config: 2-space indent, single quotes, semicolons, 120 char width, no trailing commas

#### Naming Conventions
- **Frontend components/views**: PascalCase (`ChatBotComponent.vue`)
- **Backend controllers**: PascalCase with suffix (`authController.js`)
- **Backend routes/services/middleware**: kebab-case (`auth-routes.js`)
- **Vue `name` property**: PascalCase matching filename

#### Code Organization
- **Backend**: flat at service root — controllers/, routes/, services/, middleware/, config.js
- **Frontend**: src/views/, src/components/, src/services/, src/router.js
- **Docker**: Single Dockerfile per service, single-stage builds

### Development Workflow Rules

#### Keycloak Config CLI — Variable Substitution Syntax

- keycloak-config-cli uses `$(env:VARIABLE)` syntax — NOT `${env:VARIABLE}`
- The prefix `$(env:` and suffix `)` are configurable via `IMPORT_VARSUBSTITUTION_PREFIX`/`IMPORT_VARSUBSTITUTION_SUFFIX`
- `IMPORT_VARSUBSTITUTION_ENABLED=true` must be set in the keycloak-config service environment
- Never change `$(env:VAR)` to `${env:VAR}` in `genie-realm.yaml` — this breaks variable substitution at runtime
- When reviewing `genie-realm.yaml`, preserve the `$(env:...)` syntax exactly as-is

#### Environment & Config
- Single `.env` at project root (copy from `env` template). Per-service `env` files are deprecated.
- Secrets in `.env` are gitignored; `env` (no dot) is committed as template
- LLM prompts: 3-tier priority — ENV VAR > FILE (`configs/prompts/`) > DEFAULT (code)

#### Docker
- Deploy: `set -a && source .env && set +a && docker stack deploy -c docker-compose.yaml genieai`
- GPU: `set -a && source .env && source env.t4 && docker stack deploy -c docker-compose.yaml genieai`
- Remove: `docker stack rm genieai`
- Build images: `docker build -t <tag> <context>` (see docs/docker-swarm-setup.md Step 5)
- Validate: `set -a && source .env && set +a && docker compose config > /dev/null`

#### Git
- Main branch: `main` (use for PRs)
- No enforced branch naming or commit message format

### Critical Don't-Miss Rules

#### Anti-Patterns to Avoid
- NEVER use ES imports in backend or shared code — CommonJS only
- NEVER use Composition API (`<script setup>`) — Options API only
- NEVER use `$t()` for i18n — use `translate('key', 'default')`
- NEVER add global auth middleware — per-route only
- NEVER centralize all config in config.js — use `process.env` with defaults inline
- NEVER introduce repository/ORM pattern for ArangoDB — direct AQL
- NEVER replace event bus with provide/inject in existing components

#### Security Rules
- File uploads: `multer` with `multipart/form-data`, never JSON
- Passwords: always hash with `bcrypt`
- JWT: validated via `authMiddleware.authenticate`
- Sensitive logs: auto-masked by Winston `safeStringify` — do not bypass
- CORS and helmet are global — do not disable

#### Edge Cases
- `components/shared/lib/` is backend-only — frontend never imports from it
- Python OPEA services are a separate ecosystem (different language, copyright, config)
- `env` (no dot) = committed template; `.env` (with dot) = local secrets
- Backend has no `src/` subdirectory — files at service root
- Axios unified at 1.10+ — do not downgrade
- Backend: Jest configured; test files now exist in `__tests__/` — follow existing patterns
- Frontend: Jest 29.7 + @vue/test-utils configured; test files exist in `src/__tests__/` (components, stores, services, utils) — see Frontend Testing Architecture section

---

## Frontend Testing Architecture

Investigation date: 2026-05-19. Full details in `_bmad-output/implementation-artifacts/investigations/frontend-test-planning-epic3-investigation.md`.

### Component Landscape (51 .vue files)

| Type | Count | Files | Test Approach |
|------|-------|-------|---------------|
| Pure Options API | 43 | All DS components (11), most feature components (28), views (2), App.vue, SplashScreen | Standard mount/shallowMount |
| Mixed (Options API + setup()) | 7 | `AnalyticsComponent`, `UsageTrendChart`, all `charts/*.vue` | Requires composable/chart mocking — defer |
| `<script setup>` | 0 | — | — |

Single composable: `useChartTheme.js` (theme detection via MutationObserver, consumed by chart components only).

### Vuex Store (2 modules)

- **auth** (not namespaced): state `{isAuthenticated, user, accessToken, error, isInitialized}`, 6 actions (all async, all call `keycloakAuthService`).
- **chatHistory** (namespaced): state `{folders, chats, folderChats}`, 12 mutations, 12 actions (mostly sync, only `moveChat` calls API). localStorage persistence plugin.
- **Cross-module**: chatHistory → auth via `rootGetters['auth/currentUser']` (moveChat only).

Store mock factory pattern: shallow clone auth state or `createStore()` with test modules.

### HTTP Service Layer

Base: `httpService.js` — Axios with request interceptor (Bearer token injection), response error interceptor (401 → silent refresh → retry → redirect). All 12 domain services delegate to httpService.

Mock strategy: mock `httpService` at module level to isolate all API-dependent components.

Key services by endpoint count: chatHistoryService (25), documentFileService (16), serviceTreeService (13), adminDashboardService (11), analyticsService (8).

Non-HTTP: `keycloakAuthService` (oidc-client-ts UserManager), `notificationService` (eventBus-based, trivially mockable).

### Existing Test Infrastructure

Jest 29.7 + jsdom + @vue/test-utils 2.4.6 + @vue/vue3-jest — all installed and configured. `src/__tests__/setup.js` for global setup.

**240 tests across 8 files** — all service/utility/store/router layer. Zero component tests.

Established mock patterns: `jest.mock()` hoisting, manual factories (createMockUser, createState), service mocking, axios interceptor mocking, OIDC UserManager mocking, localStorage/sessionStorage mocking, window.APP_CONFIG mocking.

**No coverage reporting configured** — add `collectCoverageFrom` to jest.config.js when needed.

### Epic 3 Priority Targets

1. **DS components** (Button, Input, Modal, Spinner, StatusTag) — establish patterns, no dependencies
2. **Simple feature components** (ConfirmDialog, ModalDialog, ContextMenu, LanguageSelector) — minimal deps
3. **Connected components** (ChatBotComponent, NavBarComponent, SideBarComponent) — Vuex + service mocking

**Defer**: 7 chart components (composable + chart library mocking), SSE streaming (native Fetch, not axios), file upload components (FormData complexity).

---

## Usage Guidelines

**For AI Agents:**
- Read this file before implementing any code
- Follow ALL rules exactly as documented
- When in doubt, prefer the more restrictive option
- Update this file if new patterns emerge

**For Humans:**
- Keep this file lean and focused on agent needs
- Update when technology stack or conventions change
- Review quarterly for outdated rules
- Remove rules that become obvious over time

Last Updated: 2026-05-19

---

## GitLab Tracking Integration

The project can optionally use GitLab Issues as a tracking system alongside file-based tracking. Configuration is in `_bmad/bmm/config.yaml` under `gitlab_tracking`.

When enabled, BMAD workflows execute `glab` CLI commands directly to create/update GitLab issues — no shell script dependency.

### Label Structure

Labels follow a 3-level hierarchy for multi-PRD support:

```
# Global labels (shared across all PRDs)
status::backlog | ready-for-dev | in-progress | review | done | deferred | closed
type::prd | story | qa | retrospective

# Per-PRD labels (created dynamically)
prd::<prd-key>                    # e.g., prd::keycloak-idp
<prd-key>::epic-1 | epic-2 | ...  # e.g., keycloak-idp::epic-1
```

### How It Works

- When `gitlab_tracking.enabled: true`, workflow steps include `<check if>` blocks that run `glab api` commands directly
- The AI detects the GitLab project from `git remote`, gets the project ID, and executes API calls
- Fallback: if GitLab is unreachable, the workflow continues with file-system tracking only
- Complex operations (label management, bulk sync, reconciliation) are delegated to a shared custom task at `_bmad/_config/custom/sync-gitlab-issues.md`

### Slash Command

- `/sync-sprint-gitlab` — syncs sprint-status.yaml to GitLab Issues

### Key Rules

- GitLab is primary source of truth when available; sprint-status.yaml serves as fallback authority during outages and is auto-synced when connectivity is restored
- When creating Merge Requests, include `Closes #IID` in the MR description to link it to the corresponding GitLab issue (the dev-story workflow provides the IID)
- When creating issues, always include `type::story`, `status::backlog`, `prd::<key>`, and `<key>::epic-N` labels
- Epic labels are scoped per PRD (e.g., `keycloak-idp::epic-1`) to support multiple concurrent PRDs
