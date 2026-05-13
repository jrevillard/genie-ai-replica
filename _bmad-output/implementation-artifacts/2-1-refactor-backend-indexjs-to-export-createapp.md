# Story 2.1: Refactor Backend index.js to Export createApp()

Status: ready-for-dev

## Story

As a developer,
I want `index.js` to export a `createApp()` factory function,
so that I can test route handlers via Supertest without starting the server.

## Acceptance Criteria

1. **AC1: createApp() factory function** — `components/gov-chat-backend/index.js` exports `createApp({ services } = {})` that creates and returns a configured Express app without calling `app.listen()`. All middleware registration (helmet, cors, body-parser, rate limiting, security, error handling) and all static endpoints (health, robots, sitemap) are inside `createApp()`. Route registration is inside `createApp()` when `services` object is provided.

2. **AC2: Production startup preserved** — `index.js` calls `createApp()` internally and starts the server when run directly (`require.main === module` guard). Production behavior is unchanged: `docker-compose` CMD `node index.js` still starts the full application with DB connection and route mounting.

3. **AC3: No module-level side effects on import** — Importing `index.js` via `require('./index')` does NOT start the server, does NOT call `app.listen()`, and does NOT attempt database connections. The auto-start only fires when `require.main === module`.

4. **AC4: CommonJS export** — `module.exports = { createApp }` uses CommonJS `require()`/`module.exports` syntax exclusively (NFR21). No ES import/export syntax.

5. **AC5: Self-tests** — A new test file `__tests__/createApp.test.js` verifies: (a) `createApp()` returns an Express app instance, (b) all middleware is applied (security headers, CORS, body parsing), (c) static endpoints work (GET `/api/health` returns 200), (d) `createApp({ services: mockServices })` registers all routes, (e) multiple calls produce independent app instances.

6. **AC6: Existing tests pass** — All 8 existing test files in `__tests__/` continue to pass unchanged. These tests import individual modules (authController, middleware, services) — they do NOT import `index.js`, so the refactor must not break their module resolution.

## Tasks / Subtasks

- [ ] Task 1: Refactor index.js to extract createApp() (AC: #1, #2, #3, #4)
  - [ ] 1.1 Move Express app creation (`const app = express()`) inside `createApp()`
  - [ ] 1.2 Move all middleware registration (lines 44–630) inside `createApp()`
  - [ ] 1.3 Move static endpoints (health, robots, sitemap, lines 916–968) inside `createApp()`
  - [ ] 1.4 Move error handler and 404 handler (lines 1174–1202) inside `createApp()`
  - [ ] 1.5 Extract `registerRoutes(app, services, routeConfigs)` helper from `startApp()` route mounting logic (lines 1036–1151)
  - [ ] 1.6 Call `registerRoutes()` inside `createApp()` when `services` parameter is provided
  - [ ] 1.7 Refactor `startApp()` to: initialize services → call `createApp({ services })` → call `app.listen()`
  - [ ] 1.8 Add `require.main === module` guard around auto-start block (replace lines 1238–1249)
  - [ ] 1.9 Change `module.exports = app` to `module.exports = { createApp }`
  - [ ] 1.10 Keep `dotenv.config()` and `UV_THREADPOOL_SIZE` at module level (process-level config)
  - [ ] 1.11 Move `routeConfigs` array definition inside `createApp()` or as a module-level constant (not inside `startApp`)

- [ ] Task 2: Create createApp test file (AC: #5)
  - [ ] 2.1 Create `__tests__/createApp.test.js` with shared-lib mock at module level
  - [ ] 2.2 Test: `createApp()` returns an object with `listen` function (Express app)
  - [ ] 2.3 Test: GET `/api/health` returns 200 without any services (static endpoint)
  - [ ] 2.4 Test: security headers are present (helmet, x-powered-by removed)
  - [ ] 2.5 Test: CORS headers are set on responses
  - [ ] 2.6 Test: body parsing works (POST with JSON body)
  - [ ] 2.7 Test: `createApp({ services: mockServices })` registers all 12 route modules and returns 200/401 on protected endpoints
  - [ ] 2.8 Test: two `createApp()` calls produce independent app instances (no shared state)
  - [ ] 2.9 Test: importing index.js does NOT start the server (no `app.listen()` side effect)

- [ ] Task 3: Verify existing tests pass (AC: #6)
  - [ ] 3.1 Run `cd components/gov-chat-backend && npm test` — all 8 existing tests pass
  - [ ] 3.2 Run `cd components/gov-chat-backend && npm run lint` — no lint errors

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

const ROUTE_CONFIGS = [
  { file: 'user-routes', paths: ['/api/me'], serviceName: 'userProfileService', keycloakAuth: true },
  { file: 'auth-routes', paths: ['/api/auth'], serviceName: null },
  // ... all 12 route configs ...
];

function createApp({ services = {} } = {}) {
  const app = express();
  const PORT = process.env.PORT || 3000;

  // App config
  app.disable('etag');
  app.disable('x-powered-by');

  // ALL middleware (security, swagger, helmet, cors, body parser, static files)
  // ... move lines 44-630 here ...

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

3. **`shared-lib` import triggers side effects** — `require('./shared-lib')` auto-creates DB connection. Tests MUST mock this at module level via `jest.mock('./shared-lib', ...)` BEFORE requiring index.js. The existing test pattern already does this.

4. **Swagger config (lines 121-426) is 300+ lines of inline schema definitions** — Move into `createApp()` as-is. No need to refactor swagger schemas in this story.

5. **`initializeServices()` requires DB connection** — This function stays outside `createApp()`. Production calls it before `createApp({ services })`. Tests provide mock services directly.

6. **Route instantiation patterns differ per route file:**
   - 10 routes: factory function `routeModule(service)`
   - `analytics-routes`: factory with controller `routeModule(service, controller)` (requires `new AnalyticsController(service)`)
   - `admin-routes`: dual services `routeModule(service, extraService)`
   - `auth-routes`: plain router (no factory)
   These patterns MUST be preserved exactly in `registerRoutes()`.

7. **`keycloakAuthMiddleware.authenticate` is applied per-route** — Only routes with `keycloakAuth: true` get the auth middleware. This logic is in the route mounting loop and must be preserved.

8. **Static file serving paths** — `/Uploads` and `/dist` use `path.join(__dirname, ...)` which works regardless of where `createApp()` is called from since `__dirname` is module-level.

9. **Process event handlers** (`unhandledRejection`, etc.) should stay at module level — they're process-level concerns, not app-level.

### Existing Test Patterns (MUST follow)

From `__tests__/authController.test.js` and `__tests__/keycloak-auth-middleware.test.js`:

```javascript
// 1. Mock shared-lib FIRST with { virtual: true }
jest.mock('../shared-lib', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
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

### Supertest Usage Pattern (for createApp tests)

```javascript
const request = require('supertest');
const { createApp } = require('../index');

// Mock shared-lib before requiring index
jest.mock('../shared-lib', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}), { virtual: true });

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

Note: Route factory functions like `user-routes(service)` receive the service object. They don't call methods on it during route registration — only during request handling. So an empty object `{}` is sufficient for testing that routes are registered (mount without errors).

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
- Do NOT remove the `shared-lib` validation logging — it helps debug production issues
- Do NOT change the swagger configuration block — it's large but functional
- Do NOT make `createApp()` async — the app creation is synchronous; async is only for service initialization
- Do NOT register process event handlers inside `createApp()` — those are process-level concerns
- Do NOT add `jest-junit` configuration in this story — that's Story 1.1
- Do NOT modify any existing test files — they must pass unchanged

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

### Debug Log References

### Completion Notes List

### File List
