# Story 2.11: Test Backend Chat History Completion and Database Operations

Status: ready-for-dev

## Story

As a developer,
I want to complete test coverage for chat history services and add tests for database operations, service categories, weather, and key handler utilities,
So that backend coverage reaches the professional 70%+ target.

## Acceptance Criteria

1. **AC1**: Chat history service coverage extends from 65% to 85% by completing remaining folder operations, search, move, and batch operations tests
2. **AC2**: Chat history routes coverage extends from 42% to 70% by testing the remaining untested endpoints (folders CRUD, conversation-folder operations, search, stats, move)
3. **AC3**: Database operations service has complete test coverage for backup, restore, and optimize with mocked ArangoDB
4. **AC4**: Service category service has complete test coverage for category CRUD, translations, and initialization with mocked ArangoDB
5. **AC5**: Weather service has complete test coverage for weather data fetching with mocked HTTP client
6. **AC6**: Key handler has complete test coverage for ArangoDB key sanitization (mock `uuid` for deterministic generateKey tests)
7. **AC7**: All existing tests pass, zero lint errors
8. **AC8**: Backend coverage reaches ~72% (statements), exceeding 70% professional target

## Tasks / Subtasks

- [ ] Task 1: Extend chat-history-service.test.js (AC: #1)
  - [ ] 1.1 Add edge case tests for folder operations (reorderFolders, getFolderPath, findConversationFolder)
  - [ ] 1.2 Add error scenario tests for transaction rollback in moveConversation
  - [ ] 1.3 Add tests for background fire-and-forget operations (updateConversation timestamps after move/read)
  - [ ] 1.4 Add tests for permission-denied scenarios (getConversationOwnerId, deleteFolder with wrong user)
  - [ ] 1.5 Add tests for empty/null result handling across search and stats methods

- [ ] Task 2: Create chat-history-routes test file (AC: #2)
  - [ ] 2.1 Create `__tests__/routes/chat-history-routes.test.js` with standard route test boilerplate
  - [ ] 2.2 Test folder CRUD: GET/POST/PATCH/DELETE `/api/chat/folders`, GET `/api/chat/folders/:folderId`
  - [ ] 2.3 Test folder-conversation: POST/DELETE `/api/chat/folders/:folderId/conversations/:conversationId`
  - [ ] 2.4 Test conversation management: PATCH/DELETE `/api/chat/conversations/:conversationId`, POST messages/read
  - [ ] 2.5 Test move: POST `/api/chat/conversations/:conversationId/move`
  - [ ] 2.6 Test folder utilities: GET folders/search, POST folders/reorder, GET folders/:folderId/path, GET conversations/:conversationId/folder

- [ ] Task 3: Create database-operations-service.test.js (AC: #3)
  - [ ] 3.1 Create `__tests__/services/database-operations-service.test.js`
  - [ ] 3.2 Test backupDatabase: collection iteration, gzip option, backup cleanup
  - [ ] 3.3 Test optimizeDatabase: compact and index analysis
  - [ ] 3.4 Test getDatabaseStats: collection figures aggregation
  - [ ] 3.5 Test error paths (returns `{ success: false }`, does NOT throw)

- [ ] Task 4: Create service-category-service.test.js (AC: #4)
  - [ ] 4.1 Create `__tests__/services/service-category-service.test.js`
  - [ ] 4.2 Test CRUD: createCategory, createServiceWithTranslations, upsertCategories, upsertServices, deleteCategory, deleteService
  - [ ] 4.3 Test translations: getCategoryTranslations, getServiceTranslations, updateCategoryWithTranslations, updateServiceWithTranslations
  - [ ] 4.4 Test queries: getAllCategoriesWithServices, getAdminAllCategoriesWithServices, getCategoryWithServices, searchCategoriesAndServices
  - [ ] 4.5 Test helpers: categoryExists

- [ ] Task 5: Create weather-service.test.js (AC: #5)
  - [ ] 5.1 Create `__tests__/services/weather-service.test.js`
  - [ ] 5.2 Test getCityName: reverse geocoding success and fallback to 'Unknown'
  - [ ] 5.3 Test getWeather: weather data fetching, coordinate validation, weather code mapping
  - [ ] 5.4 Mock external APIs: axios for Open-Meteo, OpenStreetMap, ipapi.co

- [ ] Task 6: Create key-handler.test.js (AC: #6)
  - [ ] 6.1 Create `__tests__/services/key-handler.test.js`
  - [ ] 6.2 Mock `uuid` module for deterministic generateKey tests
  - [ ] 6.3 Test sanitizeKey: special chars, leading numbers, length limits, prefix handling
  - [ ] 6.4 Test generateKey: format, uniqueness, prefix
  - [ ] 6.5 Test processDocument: _key sanitization, system field removal (_id, _rev)

- [ ] Task 7: Verify all tests pass and coverage target (AC: #7, #8)
  - [ ] 7.1 Run full test suite from `components/gov-chat-backend/` — all existing + new tests pass
  - [ ] 7.2 Run `npm run lint` — zero errors
  - [ ] 7.3 Verify backend statement coverage reaches ~72%

## Dev Notes

### Critical Architecture Constraints

- **CommonJS ONLY**: `const x = require('x')` / `module.exports = {}` — NEVER ES imports
- **Direct AQL**: no ORM, no repository pattern — mock `db.query()` and collection methods directly
- **Auth middleware**: per-route via `keycloakAuthMiddleware.authenticate` — NEVER global
- **shared-lib is virtual**: must mock with `{ virtual: true }`, path relative from test file
- **process.exit override**: `beforeAll(() => { process.exit = jest.fn(); })` in every route test file
- **Error format**: `{ error, message, details }` (RFC 9457) for route error responses
- **Controller -> Service pattern**: Controllers handle HTTP, Services contain business logic
- **Singleton service reset**: All service singletons (chat-history, database-operations, service-category, weather) need `jest.isolateModules()` + `delete Service.instance` in `beforeEach` to prevent state pollution. Key-handler is the exception (pure functions, no singleton).

### Mock Complexity by Service

| Service | Mock Level | Key Mocks Needed |
|---------|-----------|-----------------|
| key-handler | Simple | `uuid` only |
| weather-service | Medium | `axios` (3 endpoints), `dbService`, optional `analyticsService` |
| service-category-service | Medium | `dbService` with 6 collection mocks, `jest.isolateModules()` |
| database-operations-service | Complex | `dbService`, `fs.promises` (mkdir/stat/unlink), `fs.createWriteStream`, `zlib`, `stream` |
| chat-history-service | Complex | `dbService` with 9 collection mocks, `analyticsService`, `jest.isolateModules()` |

### Files to Extend (DO NOT recreate)

| File | Action | Current Coverage |
|------|--------|-----------------|
| `__tests__/services/chat-history-service.test.js` | EXTEND — add edge cases, error scenarios, missing method tests | ~65% |

### Files to Create (NEW)

| Test File | Source Under Test | Source Lines | Pattern to Follow |
|-----------|-------------------|-------------|-------------------|
| `__tests__/routes/chat-history-routes.test.js` | `routes/chat-history-routes.js` | 1697 | query-routes.test.js (supertest + createApp) |
| `__tests__/services/database-operations-service.test.js` | `services/database-operations-service.js` | 362 | Service test from story 2-7 |
| `__tests__/services/service-category-service.test.js` | `services/service-category-service.js` | 931 | Service test from story 2-7 |
| `__tests__/services/weather-service.test.js` | `services/weather-service.js` | 233 | Service test + axios mock |
| `__tests__/services/key-handler.test.js` | `services/key-handler.js` | 81 | Mock uuid for generateKey, test edge cases directly |

**Why a separate chat-history-routes test file?** The existing `routes/chat.test.js` covers basic conversation/message routes (story 2-4). The `chat-history-routes.js` is a separate 1697-line route module with 35 route handlers. It deserves its own test file following the same pattern as other route test files (query-routes, user-routes, etc.).

### Route Test Boilerplate (copy from story 2-10)

```javascript
'use strict';

require('../setup-env');

jest.mock('../../shared-lib', () => require('../mocks/shared-lib'), { virtual: true });

jest.mock('../../services/keycloak-auth-service', () => ({
  verifyToken: jest.fn(),
  checkUserStatusInKeycloak: jest.fn()
}));

jest.mock('../../services/user-provisioning-service', () => ({
  provisionUser: jest.fn().mockResolvedValue({ _key: 'user-1', iss_sub: 'user-1' }),
  initialize: jest.fn(),
  markUserAsDeleted: jest.fn()
}));

// Mock ALL other services loaded by index.js (even unused ones)
jest.mock('../../services/admin-dashboard-service', () => ({}));
jest.mock('../../services/analytics-service', () => ({}));
jest.mock('../../services/query-service', () => ({}));
jest.mock('../../services/translation-service', () => ({}));
jest.mock('../../services/user-profile-service', () => ({}));
jest.mock('../../services/logs-service', () => ({}));
jest.mock('../../services/security-scan-service', () => ({}));
jest.mock('../../services/session-service', () => ({}));
jest.mock('../../services/database-operations-service', () => ({}));
jest.mock('../../services/service-category-service', () => ({}));
jest.mock('../../services/weather-service', () => ({}));
jest.mock('../../services/opea-worker', () => ({}));
jest.mock('../../services/path-sanitizer', () => ({}));

jest.mock('swagger-jsdoc', () => () => ({
  openapi: '3.0.0', info: {}, components: {}, security: []
}), { virtual: true });

jest.mock('swagger-ui-express', () => ({
  serve: [], setup: () => (req, res, next) => next()
}), { virtual: true });

jest.mock('../../middleware/keycloak-auth-middleware', () => ({
  keycloakAuthMiddleware: {
    authenticate: jest.fn((req, res, next) => next()),
    requireAdmin: jest.fn((req, res, next) => next())
  }
}));

const originalExit = process.exit;
beforeAll(() => { process.exit = jest.fn(); });
afterAll(() => { process.exit = originalExit; });

const { createApp } = require('../../index');
const request = require('supertest');
const { createValidToken } = require('../fixtures/tokens');
const chatHistoryService = require('../../services/chat-history-service');
const { keycloakAuthMiddleware } = require('../../middleware/keycloak-auth-middleware');

const validToken = createValidToken();
let app;

beforeAll(() => { app = createApp(); });

beforeEach(() => {
  jest.clearAllMocks();
  keycloakAuthMiddleware.authenticate.mockImplementation((req, res, next) => {
    req.user = { iss_sub: 'user-1', _key: 'user-1' };
    next();
  });
});

function authGet(path) {
  return request(app).get(path).set('Authorization', `Bearer ${validToken}`);
}
function authPost(path, body) {
  return request(app).post(path).set('Authorization', `Bearer ${validToken}`).send(body);
}
function authPatch(path, body) {
  return request(app).patch(path).set('Authorization', `Bearer ${validToken}`).send(body);
}
function authDelete(path) {
  return request(app).delete(path).set('Authorization', `Bearer ${validToken}`);
}
```

### Key Error Handling Patterns by Service

| Service | Error Pattern | Test Approach |
|---------|--------------|---------------|
| chat-history-service | Throws `NotFoundError` / `ForbiddenError` | `expect(fn).rejects.toThrow()` |
| database-operations-service | Returns `{ success: false, error: 'message' }` | `expect(result.success).toBe(false)` |
| service-category-service | Throws `ValidationError` / `NotFoundError`, returns `[]` on search fail | Both throw and return patterns |
| weather-service | Throws all errors, returns 'Unknown' for city lookup fail | `expect(fn).rejects.toThrow()` + fallback |
| key-handler | Throws on invalid input | `expect(fn).toThrow()` |

### chat-history-routes.js — Complete Route Map (35 endpoints)

Route module uses factory pattern: `module.exports = (chatHistoryService) => router`. All routes require auth via `router.use(keycloakAuthMiddleware.authenticate)`. `extractUserId(req)` reads `req.user.iss_sub`. Routes also access `req.user._key`.

**Route Error Patterns** — two distinct patterns (test both):
- **Direct responses**: `res.status(400/403/404).json({ message })` for validation/auth errors
- **next(error)**: for service layer errors caught in try-catch, handled by global error middleware

**Route Validation Gotchas:**
- **Folder circular reference prevention**: folder PATCH checks `parentFolderId !== folderId`
- **Parent ownership validation**: folder creation validates `owners.some((owner) => owner.iss_sub === userId)`
- **Order calculation**: new folders get `order = existingFolders.length` automatically
- **Query linking silent failure**: when adding assistant messages with `queryId`, linking silently catches errors if query doesn't exist

**Conversation Management (11 endpoints):**
- `GET /conversations` — list conversations (paginated: limit, offset, includeArchived, filterStarred)
- `POST /conversations` — create conversation (body: title, category)
- `GET /conversations/:conversationId` — get single conversation
- `PATCH /conversations/:conversationId` — update conversation (body: title, isStarred, isArchived, category, tags)
- `DELETE /conversations/:conversationId` — delete conversation
- `GET /conversations/:conversationId/messages` — get messages (paginated)
- `POST /conversations/:conversationId/messages` — add message (body: content, sender, files)
- `POST /conversations/:conversationId/messages/read` — mark messages read (body: messageIds)
- `GET /conversations/:conversationId/folder` — find conversation's parent folder
- `POST /conversations/:conversationId/move` — move conversation (body: sourceFolderId, targetFolderId)
- `POST /query/:queryId/conversation` — create conversation from query

**Query/Message Linking (2 endpoints):**
- `GET /query/:queryId/messages` — find messages for query
- `GET /messages/:messageId/query` — find originating query

**Utility (3 endpoints):**
- `GET /search` — search conversations (query param: q)
- `GET /recent` — recent conversations (query param: limit)
- `GET /stats` — user conversation statistics

**Folder CRUD (6 endpoints):**
- `GET /folders` — list user folders
- `POST /folders` — create folder (body: name, parentId)
- `GET /folders/:folderId` — get folder details
- `PATCH /folders/:folderId` — update folder (body: name, parentFolderId)
- `DELETE /folders/:folderId` — delete folder (query param: deleteContents)
- `GET /folders/search` — search folders (query param: q)

**Folder Organization (2 endpoints):**
- `POST /folders/reorder` — reorder folders (body: folderOrders, parentFolderId)
- `GET /folders/:folderId/path` — get folder breadcrumb path

**Folder-Conversation (2 endpoints):**
- `POST /folders/:folderId/conversations/:conversationId` — add conversation to folder
- `DELETE /folders/:folderId/conversations/:conversationId` — remove conversation from folder

### database-operations-service.js (362 lines)

**Singleton** with 4 methods. Returns error objects `{ success: false }`, does NOT throw.

- `backupDatabase()` — iterates non-system collections (skips `isSystem: true`), exports JSON/NDJSON, optional gzip via `zlib.createGzip()`, cleanup old backups by mtime
- `optimizeDatabase()` — iterates collections, calls compact, analyzes indexes; individual collection failures captured in results array, does NOT abort
- `getDatabaseStats()` — aggregates collection figures (document count, size); uses `db.route('/_api/statistics').get()` for server stats
- `_formatSize(bytes)` — private helper, test via getDatabaseStats

**Env vars**: `BACKUP_DIR` (default: './backups'), `MAX_BACKUPS` (default: 5), `BACKUP_FORMAT` (default: 'json'), `COMPRESS_BACKUPS`, `APP_NAME`

**Mock strategy**:
- `dbService.getConnection('default')` returning mock db with `collection()`, `listCollections()`, `query()`
- Mock collections with `all()`, `export()`, `figures()`, `compact()`
- `fs.promises` for `mkdir`, `stat`, `unlink` (directory operations)
- `fs.createWriteStream` for backup file writes
- `zlib.createGzip()` for compression testing (mock `stream.pipeline` or use `Readable.from()`)
- **Singleton reset**: use `jest.isolateModules()` + delete `instance` to prevent state pollution between tests

### service-category-service.js (931 lines)

**Singleton** with 6 collections: `serviceCategories`, `services`, `categoryServices`, `serviceCategoryTranslations`, `serviceTranslations`, and edge collection `serviceCategoryTranslationsEdge`.

18 public methods:
- Bulk upsert: `upsertCategories`, `upsertServices`
- CRUD: `createCategory`, `createServiceWithTranslations`, `updateCategoryWithTranslations`, `updateServiceWithTranslations`, `deleteCategory`, `deleteService`
- Queries: `getAllCategoriesWithServices`, `getAdminAllCategoriesWithServices`, `getCategoryWithServices`, `searchCategoriesAndServices`
- Translations: `getCategoryTranslations`, `getServiceTranslations`
- Helpers: `categoryExists`, `init`

Edge cases to test:
- `createCategory` auto-calculates `order = max(existing) + 1`
- `upsertServices` continues on individual service failures (doesn't abort)
- Non-EN translation cleanup: deletes all non-EN translations before re-adding
- Locale conversion: all locales converted to uppercase
- `categoryExists` returns `false` (not throws) when category not found
- `searchCategoriesAndServices` returns `[]` when no query provided (no error thrown)

**Singleton reset**: use `jest.isolateModules()` + delete `instance` to prevent state pollution between tests.

### weather-service.js (233 lines)

**Singleton** with 3 methods + `setAnalyticsService` injection.

- `init()` — fetches server location from `https://ipapi.co/json/` (5s timeout); falls back to `(0, 0)` on rate limit/failure
- `getCityName(lat, lon)` — reverse geocoding via `https://nominatim.openstreetmap.org/reverse` (5s timeout), returns 'Unknown' on failure
- `getWeather(locationData)` — fetches from `https://api.open-meteo.com/v1/forecast` (5s timeout); validates coordinates (falls back to server location on invalid); rounds to 4 decimal places; saves to `weatherRequests` collection

**External APIs** — mock `axios` at module level (`jest.mock('axios')`) for all three endpoints:
- `ipapi.co/json/` — server geolocation (called in `init()`)
- `nominatim.openstreetmap.org/reverse` — reverse geocoding (called in `getCityName()`)
- `api.open-meteo.com/v1/forecast` — weather data (called in `getWeather()`)

**WMO weather code mapping** (test with these values):
- 0-3: Clear/Clouds
- 45, 48: Fog
- 51-57: Drizzle
- 61-65, 66-67: Rain
- 71-77: Snow
- 80-82: Rain showers
- 85-86: Snow showers
- 95-99: Thunderstorm

**Analytics**: optional — `setAnalyticsService` injects analytics; failures logged but swallowed (non-blocking). Also needs `dbService.getConnection()` mock for `weatherRequests` collection.

**Singleton reset**: use `jest.isolateModules()` + delete `instance` to prevent state pollution between tests.

### key-handler.js (81 lines)

**Pure utility** — no class, no DB, no singletons. 3 exported functions:

- `sanitizeKey(key, prefix)` — strips invalid chars, valid ArangoDB key (no leading digit, alphanumeric + `-` + `_`, max 254 chars). Leading underscores stripped. Special chars become underscores.
- `generateKey(prefix)` — creates `{prefix}-{timestamp}-{uuid}` format using `require('uuid').v4`
- `processDocument(doc, prefix)` — ensures valid _key, removes _id/_rev; throws on null/undefined input; empty string keys trigger generation

**Mock `uuid`** for deterministic `generateKey` tests: `jest.mock('uuid', () => ({ v4: jest.fn() }))`. `sanitizeKey` and `processDocument` edge cases can be tested without mocking.

### Previous Story Learnings (Story 2-10)

- **All services loaded by index.js must be mocked** — even unused ones
- **Swagger tests require CWD=components/gov-chat-backend** — 11 tests fail from repo root
- **Two route error patterns**: `next(error)` (global handler) vs direct `res.status().json()` — test both
- **req.user must be set in beforeEach mock** — routes access `req.user.iss_sub` and `req.user._key` directly
- **~823 tests currently pass** from repo root (11 Swagger tests need CWD fix)
- **Coverage: ~59.82% statements** after story 2-10
- **Route coverage varies**: simple routes at 100%, complex routes (query) at 74.2%
- **shared-lib mock exports** `reconfigureLogger` and `triggerLogRollover` for logger-routes tests

### Testing Standards

- **Framework**: Jest, CommonJS mode
- **Naming**: `*.test.js` in `__tests__/` directories
- **Structure**: `describe()` / `it()` / `expect()`
- **Mock strategy**: Mock external services at module level
- **Coverage target**: ~72% statements (professional 70%+)
- **Deterministic**: Zero flaky tests, order-independent
- **Lint**: 2-space indent, single quotes, semicolons, 120 char width

### Project Structure Notes

- Backend tests: `components/gov-chat-backend/__tests__/`
- Run tests: `cd components/gov-chat-backend && npm test`
- Run lint: `cd components/gov-chat-backend && npm run lint`
- Service tests: `__tests__/services/`, route tests: `__tests__/routes/`
- Shared mocks: `__tests__/mocks/shared-lib.js`
- Token fixtures: `__tests__/fixtures/tokens.js`, user fixtures: `__tests__/fixtures/users.js`

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic-2]
- [Source: _bmad-output/implementation-artifacts/2-10-test-backend-query-user-and-service-routes.md]
- [Source: _bmad-output/project-context.md#Testing-Rules]
- [Source: components/gov-chat-backend/routes/chat-history-routes.js]
- [Source: components/gov-chat-backend/services/chat-history-service.js]
- [Source: components/gov-chat-backend/services/database-operations-service.js]
- [Source: components/gov-chat-backend/services/service-category-service.js]
- [Source: components/gov-chat-backend/services/weather-service.js]
- [Source: components/gov-chat-backend/services/key-handler.js]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
