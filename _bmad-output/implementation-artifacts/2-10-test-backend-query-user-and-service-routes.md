# Story 2.10: Test Backend Routes for Query, User, and Services

Status: ready-for-dev

## Story

As a developer,
I want comprehensive test coverage for query, user, service, translation, logger, and admin controller routes,
So that all API endpoints are reliable and backend coverage reaches professional standards.

## Acceptance Criteria

1. **AC1**: Query routes — all 11 endpoints tested via supertest against `createApp()`: PATCH `/:queryId/responsetime`, POST `/stream` (SSE with OPEA streaming toggle), POST `/`, GET `/:queryId`, POST `/:queryId/feedback`, PATCH `/:queryId/answered`, GET `/` (with query params), GET `/:queryId/conversations`, POST `/:queryId/conversation`, POST `/:queryId/link/:messageId`
2. **AC2**: User routes — all 5 endpoints + catch-all 404 tested: GET `/api/me`, GET `/api/me/context`, POST `/api/me/reset-data`, POST `/api/me/delete` (GDPR-critical), PUT `/api/me` (multipart + JSON body), catch-all 404 handler
3. **AC3**: Service routes — all 3 endpoints tested: GET `/api/services/categories`, GET `/api/services/categories/:categoryId`, GET `/api/services/search`
4. **AC4**: Translation routes — both endpoints tested: POST `/api/translate`, POST `/api/translate/markdown` with full validation
5. **AC5**: Logger routes — both admin-only endpoints tested: POST `/api/logger/configure` (with validation), POST `/api/logger/rollover`
6. **AC6**: Admin controller coverage already verified — existing `admin.test.js` (story 2-6) tests all admin routes via createApp/supertest. `adminController.js` is unused by `admin-routes.js` (routes call services directly) — no additional test file needed.
7. **AC7**: All existing tests pass (734 pre-existing), zero lint errors
8. **AC8**: Backend coverage increases from ~62% to ~65% (statements)

## Tasks / Subtasks

- [ ] Task 1: Create `components/gov-chat-backend/__tests__/routes/query-routes.test.js` (AC1)
  - [ ] 1.1 Mock setup: shared-lib (virtual), keycloak-auth-service, user-provisioning-service, query-service, all services loaded by index.js, swagger-jsdoc, swagger-ui-express, keycloak-auth-middleware
  - [ ] 1.2 Auth guard tests: 401 on all endpoints without token
  - [ ] 1.3 PATCH `/:queryId/responsetime` — success 200, 400 missing responseTime, 500 error
  - [ ] 1.4 POST `/stream` — 501 when OPEA_STREAMING='false', SSE event sequence test (mock stream), 502 ChatQnA error, 504 timeout
  - [ ] 1.5 POST `/` — 201 success, body validation, 500 error
  - [ ] 1.6 GET `/:queryId` — 200 success, 500 error
  - [ ] 1.7 POST `/:queryId/feedback` — 200 success, error via next()
  - [ ] 1.8 PATCH `/:queryId/answered` — 200 success, 400 missing responseTime
  - [ ] 1.9 GET `/` — 200 with pagination, query params (limit, offset, sessionId, text, etc.), 500 error
  - [ ] 1.10 GET `/:queryId/conversations` — 200 success, error via next()
  - [ ] 1.11 POST `/:queryId/conversation` — 201 success, error via next()
  - [ ] 1.12 POST `/:queryId/link/:messageId` — 200 success, error via next()
- [ ] Task 2: Create `components/gov-chat-backend/__tests__/routes/user-routes.test.js` (AC2)
  - [ ] 2.1 Mock setup: shared-lib (virtual), keycloak-auth-service, user-provisioning-service, user-profile-service, keycloak-proxy-service, multer, all services loaded by index.js, swagger, keycloak-auth-middleware
  - [ ] 2.2 Auth guard tests: 401 on all endpoints without token
  - [ ] 2.3 GET `/api/me` — 200 success, 500 error
  - [ ] 2.4 GET `/api/me/context` — 200 success (sanitized response), 404 user not found, 500 error
  - [ ] 2.5 POST `/api/me/reset-data` — 200 success, 500 error
  - [ ] 2.6 POST `/api/me/delete` — 200 GDPR success, 404 user not found, 500 error; verify `keycloakProxyService.deleteUser` called
  - [ ] 2.7 PUT `/api/me` — 200 success with JSON body, 200 success with multipart/form-data, 400 invalid JSON, 401/403/404 error, 500 error; verify JIT field splitting (Keycloak fields vs ArangoDB fields)
  - [ ] 2.8 Catch-all 404 test
- [ ] Task 3: Create `components/gov-chat-backend/__tests__/routes/service-routes.test.js` (AC3)
  - [ ] 3.1 Mock setup: shared-lib (virtual), keycloak-auth-service, user-provisioning-service, service-category-service, all services, swagger, keycloak-auth-middleware
  - [ ] 3.2 Auth guard tests: 401 on all endpoints
  - [ ] 3.3 GET `/api/services/categories` — 200 success with locale param (default 'en'), 500 error
  - [ ] 3.4 GET `/api/services/categories/:categoryId` — 200 success, 404 not found, error via next()
  - [ ] 3.5 GET `/api/services/search` — 200 success, 400 missing query param, 500 error
- [ ] Task 4: Create `components/gov-chat-backend/__tests__/routes/translation-routes.test.js` (AC4)
  - [ ] 4.1 Mock setup: shared-lib (virtual), keycloak-auth-service, user-provisioning-service, translation-service, all services, swagger, keycloak-auth-middleware
  - [ ] 4.2 Auth guard tests: 401 on both endpoints
  - [ ] 4.3 POST `/api/translate` — 200 success, 400 missing texts/source_lang/target_lang, 400 texts not array, 500 error
  - [ ] 4.4 POST `/api/translate/markdown` — 200 success, 400 missing markdown/source_lang/target_lang, 500 error
- [ ] Task 5: Create `components/gov-chat-backend/__tests__/routes/logger-routes.test.js` (AC5)
  - [ ] 5.1 Mock setup: shared-lib (virtual with `reconfigureLogger` + `triggerLogRollover`), keycloak-auth-service, user-provisioning-service, all services, swagger, keycloak-auth-middleware
  - [ ] 5.2 Auth guard tests: 401 without token, 403 non-admin (requireAdmin)
  - [ ] 5.3 POST `/api/logger/configure` — 200 success, 400 no params, 400 invalid level, 400 invalid size format, 400 invalid files format, 500 error
  - [ ] 5.4 POST `/api/logger/rollover` — 200 success, 500 error
- [ ] Task 6: Verify admin controller coverage (AC6) — existing `admin.test.js` already covers all admin routes via createApp/supertest. No new file needed.
- [ ] Task 7: Run coverage report to verify ~65% backend coverage target (AC8)
- [ ] Task 8: Run full test suite to ensure no regressions (AC7)
- [ ] Task 9: Run lint and fix any errors (AC7)

## Dev Notes

### Previous Story Learnings (2-9, 2-8, 2-7)

- **shared-lib is virtual** — must mock with `{ virtual: true }`, path relative from test file
- **createApp() pattern** — route tests use `const { createApp } = require('../../index')` + supertest
- **All services loaded by index.js** must be mocked, even if the test doesn't use them — index.js imports everything
- **CommonJS only** — `require()`/`module.exports`, NEVER ES imports
- **Lint strictly** — 2-space indent, single quotes, semicolons
- **swagger-jsdoc and swagger-ui-express** must be mocked (virtual) — they break in test env
- **process.exit** must be overridden: `beforeAll(() => { process.exit = jest.fn(); })`
- **Two error handling patterns in routes**: `next(error)` (caught by global error handler) and direct `res.status().json()` — test both
- **734 pre-existing tests must stay green** — run full suite after each file
- **Keycloak auth middleware** — mock as pass-through by default, override for 401/403 tests
- **Multer** in user routes handles multipart — test both `application/json` and `multipart/form-data` content types

### Critical Architecture Constraints

[Source: _bmad-output/project-context.md]

- **CommonJS only**: `const x = require('x')` / `module.exports = {}` — NEVER ES imports
- **Direct AQL**: no ORM, no repository pattern for ArangoDB — mock `db.query()` with cursor results
- **Logger**: import `{ logger }` from `../shared-lib` — always mock
- **Auth middleware**: per-route via `keycloakAuthMiddleware.authenticate` — NEVER global
- **Error format**: `{ error, message, details }` (RFC 9457) for structured errors
- **Controller → Service pattern**: Controllers handle HTTP, Services contain business logic

### Route Test Boilerplate (from admin.test.js pattern)

Every route test file follows this exact structure:

```javascript
'use strict';

require('../setup-env');

// Mock shared-lib — virtual because it only exists after Docker packaging
jest.mock('../../shared-lib', () => require('../mocks/shared-lib'), { virtual: true });

// Mock keycloak-auth-service (used by middleware)
jest.mock('../../services/keycloak-auth-service', () => ({
  verifyToken: jest.fn(),
  checkUserStatusInKeycloak: jest.fn()
}));

// Mock user-provisioning-service (used by middleware)
jest.mock('../../services/user-provisioning-service', () => ({
  provisionUser: jest.fn(),
  initialize: jest.fn(),
  markUserAsDeleted: jest.fn()
}));

// Mock the TARGET service with all methods used by route
jest.mock('../../services/query-service', () => ({
  method1: jest.fn(),
  method2: jest.fn()
}));

// Mock ALL other services loaded by index.js (even unused ones)
jest.mock('../../services/admin-dashboard-service', () => ({}));
jest.mock('../../services/user-profile-service', () => ({}));
jest.mock('../../services/analytics-service', () => ({}));
jest.mock('../../services/chat-history-service', () => ({}));
jest.mock('../../services/service-category-service', () => ({}));
jest.mock('../../services/database-operations-service', () => ({}));
jest.mock('../../services/weather-service', () => ({}));
jest.mock('../../services/translation-service', () => ({}));
jest.mock('../../services/session-service', () => ({}));
jest.mock('../../services/logs-service', () => ({}));
jest.mock('../../services/security-scan-service', () => ({}));

// Mock swagger dependencies
jest.mock('swagger-jsdoc', () => () => ({
  openapi: '3.0.0', info: {}, components: {}, security: []
}), { virtual: true });
jest.mock('swagger-ui-express', () => ({
  serve: [], setup: () => (req, res, next) => next()
}), { virtual: true });

// Mock keycloak-auth-middleware — allow pass-through, override for 401/403 tests
jest.mock('../../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: {
    authenticate: jest.fn((req, res, next) => next()),
    requireAdmin: jest.fn((req, res, next) => next())
  }
}));

// Prevent process.exit during tests
const originalExit = process.exit;
beforeAll(() => { process.exit = jest.fn(); });
afterAll(() => { process.exit = originalExit; });

const { createApp } = require('../../index');
const request = require('supertest');
const { createValidToken } = require('../fixtures/tokens');
const { createMockUser } = require('../fixtures/users');

const targetService = require('../../services/query-service');
const { keycloakAuthMiddleware } = require('../../middleware/keycloak-auth-middleware');

const validToken = createValidToken();

let app;
beforeAll(() => {
  app = createApp({ services: { queryService: targetService } });
});

beforeEach(() => {
  jest.clearAllMocks();
  keycloakAuthMiddleware.authenticate.mockImplementation((req, res, next) => next());
});

function authGet(path) {
  return request(app).get(path).set('Authorization', `Bearer ${validToken}`);
}
function authPost(path, body) {
  return request(app).post(path).set('Authorization', `Bearer ${validToken}`).send(body);
}
function authPut(path, body) {
  return request(app).put(path).set('Authorization', `Bearer ${validToken}`).send(body);
}
function authPatch(path, body) {
  return request(app).patch(path).set('Authorization', `Bearer ${validToken}`).send(body);
}
function authDelete(path) {
  return request(app).delete(path).set('Authorization', `Bearer ${validToken}`);
}
```

### Route-Specific Implementation Details

#### Query Routes (`routes/query-routes.js`)

Factory function: `module.exports = (queryService) => { ... }` — service injected via `createApp({ services })`.

**SSE streaming endpoint** (`POST /stream`):
- Checks `process.env.OPEA_STREAMING !== 'false'` — returns 501 if disabled
- Sets SSE headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
- Emits events: `chunk`, `metadata`, `translation`, `done`, `error`
- External calls to `retriever-arango-service:7000` and `document-repository:3001` — mock HTTP
- Timeout: `process.env.CHATQNA_STREAM_TIMEOUT` (default 3600000ms)
- Test approach: mock the stream pipeline, verify SSE event format, test error states

**All query routes use `keycloakAuthMiddleware.authenticate`** — user ID from `req.user.iss_sub`.

**GET `/`** auto-filters by `req.user.iss_sub` — test that unauthorized users don't see other users' queries.

#### User Routes (`routes/user-routes.js`)

Factory function: `module.exports = (userService) => { ... }`.

**GDPR delete** (`POST /api/me/delete`):
- Calls `keycloakProxyService.deleteUser(userKey)` — verify this is called
- Returns `{ success: true, message: 'Account deleted' }`
- Test 404 when user not found

**Profile update** (`PUT /api/me`):
- Supports both `multipart/form-data` (with multer) and `application/json`
- JIT field splitting: `['email', 'firstName', 'lastName', 'username']` → Keycloak; rest → ArangoDB
- For multipart: `data` field contains JSON string — test 400 for invalid JSON
- For JSON: direct body parsing

**User context** (`GET /api/me/context`):
- Returns sanitized: `{ name, role, emailVerified }` — verify no sensitive fields leak

**Catch-all**: `router.all('*', ...)` returns 404 with `{ success: false, message: 'Route not found: ...' }`

#### Service Routes (`routes/service-routes.js`)

Factory function: `module.exports = (serviceCategoryService) => { ... }`.

Simple CRUD-like routes. **GET `/api/services/search`** validates `query` param — 400 if missing.

#### Translation Routes (`routes/translation-routes.js`)

Factory function: `module.exports = (translationService) => { ... }`.

Validates service exists at startup — throws if missing. Both endpoints validate required params.

#### Logger Routes (`routes/logger-routes.js`)

Factory function: `module.exports = () => { ... }` — NO service dependency.

Uses `shared-lib` functions directly: `reconfigureLogger(config)` and `triggerLogRollover()`.

**IMPORTANT**: The existing `__tests__/mocks/shared-lib.js` does NOT export `reconfigureLogger` or `triggerLogRollover`. For logger route tests, you must either:
1. Add these exports to `__tests__/mocks/shared-lib.js` (preferred — other tests don't use them), OR
2. Override the shared-lib mock in the logger test file with the additional exports

**Both endpoints require admin** — double middleware: `authenticate` + `requireAdmin`.

**POST `/api/logger/configure`** validation:
- 400 if no params provided
- 400 if `level` not in `['error', 'warn', 'info', 'debug']`
- 400 if size formats don't match `/^\d+(k|m|g)$/`
- 400 if files formats don't match `/^\d+d$/`

#### Admin Controller (`controllers/adminController.js`) — NOT TESTED IN THIS STORY

**NOTE**: `adminController.js` is unused by `admin-routes.js`. Routes call services directly. Existing `admin.test.js` (story 2-6) already provides comprehensive coverage of all admin endpoints via createApp/supertest. No additional test file needed for this controller.

### Mock Architecture — Service Dependencies

| Route File | Service Injected | Service Name in createApp |
|------------|-----------------|---------------------------|
| `query-routes` | `queryService` | `queryService` |
| `user-routes` | `userProfileService` | `userProfileService` |
| `service-routes` | `serviceCategoryService` | `serviceCategoryService` |
| `translation-routes` | `translationService` | `translationService` |
| `logger-routes` | none | — |

Additional service mocks needed for user-routes:
- `keycloak-proxy-service` — `updateOwnProfile()`, `deleteUser()`
- `multer` — handles file uploads internally (no explicit mock needed)

### Environment Variables to Mock

```javascript
// In setup-env.js or beforeEach:
process.env.OPEA_STREAMING = 'true';  // for stream tests
process.env.CHATQNA_STREAM_TIMEOUT = '3600000';
```

### Coverage Impact

Current: ~62% statements (after story 2-9).
Target: ~65% statements.
5 route test files covering ~1200 lines of untested route code. Admin controller already covered by existing `admin.test.js`.

### Test Execution Order

Create files in this order (simpler routes first, complex last):
1. `translation-routes.test.js` (smallest, 2 endpoints)
2. `logger-routes.test.js` (2 endpoints, admin-only; also update shared-lib mock)
3. `service-routes.test.js` (3 endpoints)
4. `user-routes.test.js` (5 endpoints + catch-all, multipart)
5. `query-routes.test.js` (11 endpoints, SSE streaming)

### File Paths

| Source | Test |
|--------|------|
| `routes/query-routes.js` | `__tests__/routes/query-routes.test.js` |
| `routes/user-routes.js` | `__tests__/routes/user-routes.test.js` |
| `routes/service-routes.js` | `__tests__/routes/service-routes.test.js` |
| `routes/translation-routes.js` | `__tests__/routes/translation-routes.test.js` |
| `routes/logger-routes.js` | `__tests__/routes/logger-routes.test.js` |
| `__tests__/setup-env.js` | (existing — read for env vars needed) |
| `__tests__/mocks/shared-lib.js` | (existing — MUST add `reconfigureLogger` + `triggerLogRollover` exports for logger routes) |
| `__tests__/fixtures/tokens.js` | (existing — createValidToken, createExpiredToken) |
| `__tests__/fixtures/users.js` | (existing — createMockUser, createMockAdmin) |
| `__tests__/fixtures/requests.js` | (existing — createMockReq, createMockRes, createMockNext) |
| `__tests__/mocks/shared-lib.js` | (existing — shared mock) |

### References

- [Source: _bmad-output/implementation-artifacts/2-9-test-backend-admin-and-security-services.md] — previous story learnings, service test patterns
- [Source: _bmad-output/implementation-artifacts/2-6-test-backend-admin-and-files-route-handlers.md] — route test pattern origin (admin + files)
- [Source: _bmad-output/implementation-artifacts/2-3-test-backend-auth-route-handlers.md] — route test pattern origin (auth)
- [Source: _bmad-output/project-context.md] — CommonJS only, direct AQL, no ORM, per-route auth
- [Source: _bmad-output/planning-artifacts/architecture.md] — backend testing architecture, mock patterns, fixture conventions
- [Source: components/gov-chat-backend/__tests__/routes/admin.test.js] — canonical route test boilerplate

## Change Log

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
