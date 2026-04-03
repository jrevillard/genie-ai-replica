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
- Jest configured in backend but **no test files exist yet**

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
- PEP 8, `black` formatter, `flake8` linter
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
- **Auth middleware**: Applied **per-route** via `authMiddleware.authenticate` — NEVER global
- **Error handling**: `try/catch` in route handlers, global error middleware in `index.js`
- **DB access**: Direct `arangojs` with AQL queries in service files — no ORM, no repository pattern
- **Config**: Minimal `config.js` at service root. Most config via `process.env` with defaults inline.
- **Logging**: Import `{ logger }` from `../shared-lib`

### Testing Rules

#### Backend (Node.js)
- **Framework**: Jest (in devDependencies, CommonJS mode)
- **Module system**: CommonJS — test files use `require()`/`module.exports`
- **File location**: `__tests__/` directory alongside code, or `.test.js` co-located
- **Naming**: `*.test.js` (e.g., `authController.test.js`)
- **Structure**: `describe()` / `it()` / `expect()`
- **Mocks**: Mock external services (ArangoDB, Redis, external APIs) at module level
- **No existing tests** — follow the conventions above when writing new ones

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
- Jest configured but no test files exist — follow project-context conventions

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

Last Updated: 2026-03-27
