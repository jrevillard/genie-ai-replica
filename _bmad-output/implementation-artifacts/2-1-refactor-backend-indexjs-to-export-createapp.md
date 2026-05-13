# Story 2.1: Refactor Backend index.js to Export createApp()

Status: review

## Story

As a developer,
I want `index.js` to export a `createApp()` factory function,
so that I can test route handlers via Supertest without starting the server.

## Acceptance Criteria

1. **AC1: createApp() factory function** — `components/gov-chat-backend/index.js` exports `createApp({ services } = {})` that creates and returns a configured Express app without calling `app.listen()`. All middleware registration (helmet, cors, body-parser, rate limiting, security, error handling) and all static endpoints (health, robots, sitemap) are inside `createApp()`. Route registration is inside `createApp()` when `services` object is provided. **Exception:** the `swaggerJsdoc(options)` call (spec generation, lines 121–403) stays at module level — only the `app.use('/api-docs', ...)` middleware moves inside `createApp()`. This preserves compatibility with `swagger-config.test.js` which captures the spec via `require('../index')`.

2. **AC2: Production startup preserved** — `index.js` calls `createApp()` internally and starts the server when run directly (`require.main === module` guard). Production behavior is unchanged: `docker-compose` CMD `node index.js` still starts the full application with DB connection and route mounting.

3. **AC3: No module-level side effects on import** — Importing `index.js` via `require('./index')` does NOT start the server, does NOT call `app.listen()`, and does NOT attempt database connections. The auto-start only fires when `require.main === module`. Known acceptable module-level behavior: env vars are read (PORT, UPLOAD_DIR, CORS_ALLOWED_ORIGINS, CSP_CONNECT_SRC with safe defaults), `swaggerJsdoc()` generates the OpenAPI spec, and the uploads directory is created if missing (lines 50-65). None of these are test-breaking side effects.

4. **AC4: CommonJS export** — `module.exports = { createApp }` uses CommonJS `require()`/`module.exports` syntax exclusively (NFR21). No ES import/export syntax.

5. **AC5: Self-tests** — A new test file `__tests__/createApp.test.js` verifies:
   - (a) `createApp()` returns an Express app instance (has `.listen` and `.use` methods)
   - (b) middleware is applied: `x-powered-by` header absent, CORS headers present, body parsing works (POST JSON)
   - (c) static endpoints work: GET `/api/health` returns 200 without services
   - (d) `createApp({ services: mockServices })` registers routes: verify at least 3 distinct endpoints respond (e.g. GET `/api/health` → 200, GET `/api/me` → 401 or 403, POST `/api/auth/login` without body → 400 or 405)
   - (e) two `createApp()` calls produce independent instances: `app1 !== app2` and adding middleware to `app1` does not affect `app2`
   - (f) `require('../index')` does NOT call `app.listen()` (server not started)

6. **AC6: Existing tests pass** — All 8 existing test files in `__tests__/` continue to pass. Seven tests import individual modules (authController, middleware, services) and are unaffected by the refactor. One test (`swagger-config.test.js`) imports `require('../index')` to trigger swagger spec generation via a mocked `swagger-jsdoc` — this must still work because the `swaggerJsdoc(options)` call stays at module level (see AC1 exception).

## Tasks / Subtasks

- [x] Task 1: Refactor index.js to extract createApp() (AC: #1, #2, #3, #4)
  - [x] 1.1 Move Express app creation (`const app = express()`) inside `createApp()`
  - [x] 1.2 Move all middleware registration (lines 44–630) inside `createApp()`. **Exception:** keep `swaggerJsdoc(options)` call (spec generation) at module level; only move `app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs))` inside `createApp()`. This preserves `swagger-config.test.js` compatibility.
  - [x] 1.3 Move static endpoints (health, robots, sitemap, lines 916–968) inside `createApp()`
  - [x] 1.4 Move error handler and 404 handler (lines 1174–1202) inside `createApp()`
  - [x] 1.5 Extract `registerRoutes(app, services, routeConfigs)` helper from `startApp()` route mounting logic (lines 1036–1151)
  - [x] 1.6 Call `registerRoutes()` inside `createApp()` when `services` parameter is provided
  - [x] 1.7 Refactor `startApp()` to: initialize services → call `createApp({ services })` → call `app.listen()`
  - [x] 1.8 Add `require.main === module` guard around auto-start block (replace lines 1238–1249)
  - [x] 1.9 Change `module.exports = app` to `module.exports = { createApp }`
  - [x] 1.10 Keep `dotenv.config()` and `UV_THREADPOOL_SIZE` at module level (process-level config)
  - [x] 1.11 Move `routeConfigs` array definition inside `createApp()` or as a module-level constant (not inside `startApp`)

- [x] Task 2: Create createApp test file (AC: #5)
  - [x] 2.1 Create `__tests__/createApp.test.js` with **complete** shared-lib mock (all 4 exports: `logger`, `dbService`, `securityHeaders`, `SecurityMiddleware`) — see Mock Requirements section below
  - [x] 2.2 Test (AC5a): `createApp()` returns an object with `listen` and `use` functions (Express app)
  - [x] 2.3 Test (AC5c): GET `/api/health` returns 200 without any services (static endpoint)
  - [x] 2.4 Test (AC5b): `x-powered-by` header is absent (helmet applied), body parsing works (POST JSON)
  - [x] 2.5 Test (AC5d): `createApp({ services: mockServices })` mounts routes — verify at least 3 endpoints: GET `/api/health` → 200, GET `/api/me` → 401 (auth required), POST `/api/auth/login` without body → 400
  - [x] 2.6 Test (AC5e): two `createApp()` calls produce independent instances — `app1 !== app2`, adding middleware to `app1` does not affect `app2`
  - [x] 2.7 Test (AC5f): importing index.js does NOT call `app.listen()` (verify no server socket opened)

- [x] Task 3: Verify existing tests pass (AC: #6)
  - [x] 3.1 Run `cd components/gov-chat-backend && npm test` — all 8 existing tests pass
  - [x] 3.2 Run `cd components/gov-chat-backend && npm run lint` — no lint errors

## Dev Notes

### Current index.js Structure (1,251 lines)

```
Lines 1-2:    dotenv.config(), UV_THREADPOOL_SIZE (process-level, keep at module level)
Lines 3-13:   Imports (express, cors, bodyParser, morgan, helmet, path, fs, swagger, shared-lib, keycloak middleware)
Lines 16:     const app = express()  ← SIDE EFFECT: app created at import time
Lines 17-23:  App config (disable etag, x-powered-by)
Lines 26-30:  shared-lib validation logging (side effect on import)
Lines 44-47:  Security headers, trust proxy
Lines 68-118: Debug IP logging, Morgan HTTP logger, sensitive path blocking
Lines 121-426: Swagger/OpenAPI configuration (huge block)
Lines 459-539: Helmet, CORS, SecurityMiddleware.applySecurityMiddleware()
Lines 542-543: Body parser (50MB limit)
Lines 546-622: Timestamp formatting middleware, static file serving (/Uploads, /dist)
Lines 633-913: async initializeServices() — DB connection, service instantiation
Lines 916-968: Static endpoints (/api/health, /robots.txt, /sitemap.xml)
Lines 971-1224: async startApp() — calls initializeServices(), defines routeConfigs, mounts routes, starts server
Lines 1174-1202: Error handler middleware, 404 handler
Lines 1226-1249: Process event handlers + auto-start (startApp() called at module level!)
Line 1251:     module.exports = app
```

### Refactoring Strategy

The core challenge: middleware is registered at module level (synchronous), routes are mounted inside async `startApp()` which needs DB-connected services.

**Recommended approach:**

```javascript
// index.js (refactored)

require('dotenv').config();
process.env.UV_THREADPOOL_SIZE = process.env.UV_THREADPOOL_SIZE || 128;

const express = require('express');
// ... all imports ...

// Swagger spec generation — stays at module level for swagger-config.test.js compatibility
const swaggerSpec = swaggerJsdoc({ /* ... options from lines 121-403 ... */ });

const ROUTE_CONFIGS = [
  { file: 'user-routes', paths: ['/api/me'], serviceName: 'userProfileService', keycloakAuth: true },
  { file: 'auth-routes', paths: ['/api/auth'], serviceName: null },
  // ... all 12 route configs ...
];

/**
 * Creates a configured Express application.
 * @param {Object} [options]
 * @param {Object} [options.services] - Service instances for route injection.
 *   When provided, routes are mounted with these services. Keys must match
 *   ROUTE_CONFIGS serviceName values: userProfileService, queryService,
 *   serviceCategoryService, chatHistoryService, analyticsService, logsService,
 *   databaseOperationsService, adminDashboardService, weatherService, translationService
 * @returns {import('express').Express} Configured Express app (not listening).
 */
function createApp({ services = {} } = {}) {
  const app = express();

  // App config
  app.disable('etag');
  app.disable('x-powered-by');

  // ALL middleware (security, helmet, cors, body parser, static files)
  // ... move lines 44-630 here (EXCEPT swaggerJsdoc call — already at module level) ...

  // Swagger UI middleware (uses spec generated at module level)
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, { /* oauth config */ }));

  // Static endpoints (health, robots, sitemap)
  // ... move lines 916-968 here ...

  // Route registration (only when services provided)
  if (Object.keys(services).length > 0) {
    registerRoutes(app, services);
  }

  // Root endpoint
  app.get('/', (req, res) => { ... });

  // Error handler + 404 handler
  // ... move lines 1174-1202 here ...

  return app;
}

function registerRoutes(app, services) {
  for (const config of ROUTE_CONFIGS) {
    // ... route loading logic from current startApp() lines 1036-1151 ...
  }
}

async function startApp() {
  const services = await initializeServices();
  const app = createApp({ services });
  const PORT = process.env.PORT || 3000;
  const server = app.listen(PORT, () => {
    logger.info(`Server is running on port ${PORT}`);
  });
  server.setTimeout(3600000);
  return { app, server };
}

// Auto-start only when run directly
if (require.main === module) {
  startApp().catch((error) => {
    logger.error('Application startup failed:', { error: error.message });
    process.exit(1);
  });
}

module.exports = { createApp };
```

### Key Refactoring Pitfalls

1. **Module-level `const app = express()` creates a singleton.** Every `require('./index')` in tests would share the same app instance. The refactor MUST create a new app inside `createApp()` each call.

2. **Lines 26-30 log on import** — `logger.info('Validating shared-lib imports:')` fires when the module loads. In tests with mocked logger, this is harmless. Consider moving inside `createApp()` or removing.

3. **`shared-lib` import does NOT auto-connect to DB.** Verified: `require('./shared-lib')` creates the `dbService` singleton but the actual ArangoDB connection only happens when `dbService.getConnection()` is explicitly called (line 677, inside `initializeServices()`). However, tests MUST still mock all 4 exports of shared-lib at module level because `index.js` uses them at module level for middleware setup (securityHeaders at line 44, SecurityMiddleware.applySecurityMiddleware at line 529).

5. **`initializeServices()` requires DB connection** — This function stays outside `createApp()`. Production calls it before `createApp({ services })`. Tests provide mock services directly.

6. **Route instantiation patterns differ per route file (verified):**
   - 9 routes: factory function `routeModule(service)` — user, query, service, chat-history, service-category, database-operations, weather, translation
   - `logger-routes`: factory function `routeModule()` with no parameters (service is null in config) — verified: `module.exports = () => { ... return router; }`
   - `analytics-routes`: factory with controller `routeModule(service, controller)` (requires `new AnalyticsController(service)`)
   - `admin-routes`: dual services `routeModule(service, extraService)`
   - `auth-routes`: plain router `module.exports = router` (no factory) — verified: exports Express router directly
   These patterns MUST be preserved exactly in `registerRoutes()`.

7. **`keycloakAuthMiddleware.authenticate` is applied per-route** — Only routes with `keycloakAuth: true` get the auth middleware. This logic is in the route mounting loop and must be preserved.

8. **Static file serving paths** — `/Uploads` and `/dist` use `path.join(__dirname, ...)` which works regardless of where `createApp()` is called from since `__dirname` is module-level.

9. **Process event handlers** (`unhandledRejection`, etc.) should stay at module level — they're process-level concerns, not app-level.

### Existing Test Patterns (MUST follow)

From `__tests__/authController.test.js` and `__tests__/keycloak-auth-middleware.test.js`:

```javascript
// 1. Mock shared-lib FIRST — must include ALL 4 exports used by index.js
jest.mock('../shared-lib', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  dbService: { getConnection: jest.fn() },
  securityHeaders: (req, res, next) => next(),
  SecurityMiddleware: { applySecurityMiddleware: jest.fn() }
}), { virtual: true });

// 2. Use closure-based mock references
const mockSomeFunction = jest.fn();
jest.mock('../services/some-service', () => ({
  someFunction: (...args) => mockSomeFunction(...args)
}));

// 3. Use createMockReq/createMockRes helpers
function createMockReq(overrides = {}) { return { user: { ... }, ...overrides }; }
function createMockRes() { return { json: jest.fn(), status: jest.fn().mockReturnThis() }; }
```

**Why all 4 exports:** `index.js` destructures `{ logger, dbService, securityHeaders, SecurityMiddleware }` from shared-lib at line 12. If any export is missing from the mock, the require will fail with `Cannot destructure property 'X' of undefined`.

### Supertest Usage Pattern (for createApp tests)

```javascript
const request = require('supertest');

// Mock shared-lib before requiring index — ALL 4 exports required
jest.mock('../shared-lib', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  dbService: { getConnection: jest.fn() },
  securityHeaders: (req, res, next) => next(),
  SecurityMiddleware: { applySecurityMiddleware: jest.fn() }
}), { virtual: true });

// Mock keycloak middleware (imported by index.js at line 13)
jest.mock('../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: { authenticate: (req, res, next) => next() }
}));

// Mock swagger dependencies (index.js imports swagger-jsdoc and swagger-ui-express)
jest.mock('swagger-jsdoc', () => () => ({ openapi: '3.0.0', info: {}, components: {}, security: [] }));
jest.mock('swagger-ui-express', () => ({ serve: [], setup: () => (req, res, next) => next() }));

const { createApp } = require('../index');

describe('createApp', () => {
  it('should return Express app with health endpoint', async () => {
    const app = createApp();
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
  });
});
```

**Supertest version**: `^6.3.3` (already in `devDependencies`). With Supertest 6.x, you pass the Express app directly to `request(app)` — no need to start the server. Supertest handles ephemeral ports automatically.

### Mock Services for Route Registration Tests

To test route registration via `createApp({ services: mockServices })`, create lightweight mock services matching the service constructor pattern:

```javascript
function createMockServices() {
  const makeService = () => ({});
  return {
    userProfileService: makeService(),
    queryService: makeService(),
    serviceCategoryService: makeService(),
    chatHistoryService: makeService(),
    analyticsService: makeService(),
    logsService: makeService(),
    databaseOperationsService: makeService(),
    adminDashboardService: makeService(),
    weatherService: makeService(),
    translationService: makeService()
  };
}
```

Note: Route factory functions like `user-routes(service)` receive the service object. They don't call methods on it during route registration — only during request handling. So an empty object `{}` is sufficient for testing that routes are registered (mount without errors). **Important:** 11 of 12 routes import `shared-lib` directly for `logger` — since shared-lib is already mocked at module level, routes will load without errors. Only `query-routes.js` does not import shared-lib.

### Route Config Reference (12 modules)

| File | Paths | Service | Pattern | Keycloak Auth |
|------|-------|---------|---------|---------------|
| `user-routes` | `/api/me` | `userProfileService` | Factory | Yes |
| `query-routes` | `/api/queries`, `/api/query` | `queryService` | Factory | Yes |
| `service-routes` | `/api/services` | `serviceCategoryService` | Factory | Yes |
| `chat-history-routes` | `/api/chat-history`, `/api/chat` | `chatHistoryService` | Factory | Yes |
| `analytics-routes` | `/api/analytics` | `analyticsService` | Factory + Controller | Yes |
| `service-category-routes` | `/api/service-categories` | `serviceCategoryService` | Factory | Yes |
| `auth-routes` | `/api/auth` | None | Plain router | No |
| `logger-routes` | `/api/logger` | None | Factory | Yes |
| `database-operations-routes` | `/api/database` | `databaseOperationsService` | Factory | Yes |
| `admin-routes` | `/api/admin` | `adminDashboardService` + `logsService` | Dual service factory | Yes |
| `weather-routes` | `/api/weather` | `weatherService` | Factory | Yes |
| `translation-routes` | `/api/translate` | `translationService` | Factory | Yes |

### Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `components/gov-chat-backend/index.js` | MODIFY | Extract createApp(), add require.main guard, change export |
| `components/gov-chat-backend/__tests__/createApp.test.js` | NEW | Tests for createApp() factory function |

### Downstream Impact

This refactor **unblocks** Stories 2.2–2.8 (all backend route/service/middleware tests). Those stories will import `{ createApp }` from `index.js` and call `createApp({ services: mockServices })` to get a testable Express app with Supertest.

### Anti-Patterns to Avoid

- Do NOT use ES `import`/`export` syntax — backend is CommonJS only
- Do NOT introduce a separate `app.js` file — keep createApp() in `index.js` per the AC ("index.js calls createApp()")
- Do NOT move `swaggerJsdoc(options)` inside `createApp()` — it must stay at module level for `swagger-config.test.js` compatibility. Only `app.use('/api-docs', ...)` moves inside.
- Do NOT make `createApp()` async — the app creation is synchronous; async is only for service initialization
- Do NOT register process event handlers inside `createApp()` — those are process-level concerns
- Do NOT add `jest-junit` configuration in this story — that's Story 1.1
- Do NOT modify any existing test files — they must pass unchanged (verified: `swagger-config.test.js` will work because `swaggerJsdoc()` stays at module level)

### Project Structure Notes

- Backend files live at `components/gov-chat-backend/` root — no `src/` subdirectory
- Test files go in `__tests__/` at component root
- Mock fixtures go in `__tests__/mocks/` (currently only `shared-lib.js` mock exists)
- CommonJS (`require`/`module.exports`) everywhere in backend

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.1] — Story definition and acceptance criteria
- [Source: _bmad-output/planning-artifacts/architecture.md#Testing Approach] — Supertest + createApp pattern
- [Source: _bmad-output/planning-artifacts/prd.md#Additional Requirements] — "Backend index.js must export createApp()"
- [Source: _bmad-output/project-context.md#Testing Rules] — Jest conventions, CommonJS, mock patterns
- [Source: components/gov-chat-backend/index.js] — 1,251 lines, current implementation
- [Source: components/gov-chat-backend/__tests__/authController.test.js] — Existing test pattern reference
- [Source: components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js] — Mock pattern reference

## Dev Agent Record

### Agent Model Used

Claude (glm-5.1)

### Debug Log References

No debug issues encountered.

### Completion Notes List

- Refactored `index.js` (1,251→1,092 lines) to export `createApp({ services })` factory function
- Key structural changes: `createApp()` wraps all middleware, static endpoints, route registration, error handlers
- `swaggerJsdoc(swaggerOptions)` and `swaggerUi.setup()` remain at module level for `swagger-config.test.js` compatibility
- `ROUTE_CONFIGS` extracted as module-level constant with `serviceName` keys instead of direct service references
- `registerRoutes(app, services)` helper handles all 12 route instantiation patterns (factory, plain router, dual-service, etc.)
- `startApp()` now calls `createApp({ services })` then `app.listen()`
- `require.main === module` guard prevents auto-start on import — eliminates post-test crash
- `module.exports = { createApp }` (was `module.exports = app`)
- Created `__tests__/createApp.test.js` with 8 tests covering AC5a–AC5f using Supertest
- All 173 tests pass (165 existing + 8 new), linting clean

### File List

- `components/gov-chat-backend/index.js` — MODIFIED: extracted createApp(), registerRoutes(), added require.main guard, changed export
- `components/gov-chat-backend/__tests__/createApp.test.js` — NEW: 8 tests for createApp() factory function (AC5)

### Change Log

- 2026-05-13: Refactored index.js to export createApp() factory function. Created createApp.test.js with 8 tests. All 173 tests pass, linting clean.
