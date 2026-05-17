# Story 2.5: Test Backend Analytics and Categories Route Handlers

Status: done

## Story

As a developer,
I want tests for analytics and service-categories route groups,
So that these backend API contracts are fully validated.

## Acceptance Criteria

1. **AC1: Analytics route test file created** — `__tests__/routes/analytics.test.js` exists and covers all analytics endpoints via Supertest against `createApp()`.

2. **AC2: Analytics GET /api/analytics/dashboard** — Test returns 200 with dashboard data when valid token provided. Params `startDate`, `endDate`, `locale` are all optional (route provides defaults: today/now/en). Returns 401 when no token.

3. **AC3: Analytics GET /api/analytics/metric/:metric** — Test returns 200 with `{ metric, value }` for each valid metric (totalQueries, uniqueUsers, averageResponseTime, satisfactionRate). Returns 400 for unsupported metric name. Returns 400 when `startDate`/`endDate` missing.

4. **AC4: Analytics GET /api/analytics** — Test returns 200 with general analytics data (queryCount, feedbackCount, avgRating, timeDistribution, categoryDistribution). Supports optional `filters` query param as JSON string.

5. **AC5: Analytics GET /api/analytics/timeseries/:metricType** — Test returns 200 with time series array for valid metricType (queries, users) and valid interval (hourly, daily, weekly, monthly). Returns 400 for invalid metricType or interval.

6. **AC6: Analytics POST /api/analytics/events** — Test returns 201 with created event when valid `eventType` provided. Returns 400 when `eventType` missing. Returns 401 when no token.

7. **AC7: Analytics GET /api/analytics/records** and **GET /api/analytics/events** — Test returns 200 with paginated results. Supports `limit` (default 20) and `offset` (default 0) query params. **Note:** These endpoints bypass service methods and query the DB directly via `analyticsService.db.query(AQL)`. Mock must provide `db: { query: jest.fn() }`.

8. **AC8: Analytics satisfaction endpoints** — Test `GET /api/analytics/satisfaction/gauge` returns 200 with gauge data (currentValue, previousValue, changePercentage, target, historicalData). Test `GET /api/analytics/satisfaction/heatmap` returns 200 with heatmap array. Both return 400 when `startDate`/`endDate` missing.

9. **AC9: Categories route test file created** — `__tests__/routes/categories.test.js` exists and covers service-categories endpoints via Supertest against `createApp()`.

10. **AC10: Categories GET /api/service-categories/categories** — Test returns 200 with category list. Supports `locale` query param (default 'en').

11. **AC11: Categories GET /api/service-categories/categories/detailed** — Test returns 200 with detailed category data (admin panel variant).

12. **AC12: Categories GET /api/service-categories/categories/:categoryId** — Test returns 200 with single category when valid ID. Returns 404 when category not found.

13. **AC13: Categories translation endpoints** — Test `GET /api/service-categories/:categoryId/translations` returns 200 with translation list. Test `GET /api/service-categories/services/:serviceId/translations` returns 200 with service translations.

14. **AC14: Categories GET /api/service-categories/search** — Test returns 200 with search results containing `categories` and `services` arrays. Returns 400 when `query` param missing.

15. **AC15: Categories POST /api/service-categories** — Test returns 201 with created category when valid `nameEN` provided. Returns 400 when `nameEN` missing.

16. **AC16: Categories DELETE endpoints** — Test `DELETE /api/service-categories/:categoryId` returns 200 when category exists, 404 when not. Test `DELETE /api/service-categories/services/:serviceId` returns 200 when service exists, 404 when not.

17. **AC17: Categories PUT endpoints** — Test `PUT /api/service-categories/:categoryId` returns 200 with updated category. Test `PUT /api/service-categories/services/:serviceId` returns 200 with updated service.

18. **AC18: Service mocks** — `analytics-service` is mocked via `jest.mock()` with all required methods. `service-category-service` is mocked via `jest.mock()` with all required methods.

19. **AC19: Error format** — Error responses are split: controller-validated params use `{ error: '...' }` (e.g., metric/timeseries/satisfaction 400s), route catch blocks use `{ message: error.message }` (500s). POST /events 401 uses `{ error: 'UNAUTHENTICATED', message: '...' }`.

20. **AC20: Existing tests pass** — All existing tests (200+) continue to pass unchanged.

21. **AC21: Categories POST /:categoryId/services** — Test returns 201 with created service when valid payload provided to `POST /api/service-categories/:categoryId/services`.

22. **AC22: Categories POST /init** — Test returns 200 with initialization result from `POST /api/service-categories/init`.

## Tasks / Subtasks

- [x] Task 1: Set up analytics test file with mocks (AC: #1, #18)
  - [x] 1.1 Create `__tests__/routes/analytics.test.js` with `describe('Analytics Routes')`
  - [x] 1.2 Import `createApp` from `../../index`, `request` from `supertest`, fixtures from `../fixtures/`
  - [x] 1.3 Mock `shared-lib` using centralized mock: `jest.mock('../../shared-lib', () => require('../mocks/shared-lib'), { virtual: true })`
  - [x] 1.4 Mock `swagger-jsdoc` and `swagger-ui-express` with `{ virtual: true }`
  - [x] 1.5 Mock auth services: `keycloak-auth-service`, `user-provisioning-service`
  - [x] 1.6 Mock `analytics-service` with all required methods (see Dev Notes for full list)
  - [x] 1.7 Mock all other services loaded by index.js (see Dev Notes for complete list)
  - [x] 1.8 Do NOT mock `AnalyticsController` — the route file instantiates it internally with the mocked service
  - [x] 1.9 Require `../setup-env` at top, `createApp` in `beforeAll`

- [x] Task 2: Write analytics dashboard tests (AC: #2)
  - [x] 2.1 Test: valid token + startDate/endDate → 200 with dashboard data
  - [x] 2.2 Test: valid token without startDate/endDate → 200 (defaults applied)
  - [x] 2.3 Test: no token → 401

- [x] Task 3: Write analytics metric tests (AC: #3)
  - [x] 3.1 Test: each valid metric (totalQueries, uniqueUsers, averageResponseTime, satisfactionRate) → 200
  - [x] 3.2 Test: unsupported metric → 400
  - [x] 3.3 Test: missing date params → 400

- [x] Task 4: Write analytics general, timeseries, events tests (AC: #4, #5, #6, #7)
  - [x] 4.1 Test: GET /api/analytics → 200 with general data
  - [x] 4.2 Test: GET /api/analytics/timeseries/queries → 200 with time series
  - [x] 4.3 Test: invalid metricType/interval → 400
  - [x] 4.4 Test: POST /api/analytics/events with eventType → 201
  - [x] 4.5 Test: POST /api/analytics/events without eventType → 400
  - [x] 4.6 Test: GET /api/analytics/records → 200 with pagination
  - [x] 4.7 Test: GET /api/analytics/events → 200 with pagination

- [x] Task 5: Write analytics satisfaction tests (AC: #8)
  - [x] 5.1 Test: GET satisfaction/gauge → 200 with gauge data
  - [x] 5.2 Test: GET satisfaction/heatmap → 200 with heatmap data
  - [x] 5.3 Test: missing date params → 400

- [x] Task 6: Set up categories test file with mocks (AC: #9, #18)
  - [x] 6.1 Create `__tests__/routes/categories.test.js` with `describe('Service Categories Routes')`
  - [x] 6.2 Same virtual mock pattern as analytics (shared-lib, swagger)
  - [x] 6.3 Mock `service-category-service` with all required methods (see Dev Notes)
  - [x] 6.4 Mock all other services loaded by index.js

- [x] Task 7: Write categories GET tests (AC: #10, #11, #12, #13, #14)
  - [x] 7.1 Test: GET /categories → 200 with category list
  - [x] 7.2 Test: GET /categories/detailed → 200 with detailed data
  - [x] 7.3 Test: GET /categories/:categoryId → 200 with single category
  - [x] 7.4 Test: GET /categories/:categoryId → 404 when not found
  - [x] 7.5 Test: GET /:categoryId/translations → 200 with translations
  - [x] 7.6 Test: GET /services/:serviceId/translations → 200 with translations
  - [x] 7.7 Test: GET /search with query → 200 with results
  - [x] 7.8 Test: GET /search without query → 400

- [x] Task 8: Write categories POST/PUT/DELETE tests (AC: #15, #16, #17)
  - [x] 8.1 Test: POST / with nameEN → 201 with created category
  - [x] 8.2 Test: POST / without nameEN → 400
  - [x] 8.3 Test: DELETE /:categoryId → 200 when exists
  - [x] 8.4 Test: DELETE /:categoryId → 404 when not found
  - [x] 8.5 Test: DELETE /services/:serviceId → 200 when exists
  - [x] 8.6 Test: DELETE /services/:serviceId → 404 when not found
  - [x] 8.7 Test: PUT /:categoryId → 200 with updated category
  - [x] 8.8 Test: PUT /services/:serviceId → 200 with updated service
  - [x] 8.9 Test: POST /:categoryId/services → 201 with created service (AC: #21)
  - [x] 8.10 Test: POST /init → 200 with initialization result (AC: #22)

- [x] Task 9: Verify existing tests pass (AC: #20)
  - [x] 9.1 Run `cd components/gov-chat-backend && npm test` — all tests pass
  - [x] 9.2 Run `cd components/gov-chat-backend && npm run lint` — no lint errors

## Dev Notes

### Critical Discovery: Route Path Mismatch

The epics file says `GET /api/categories/*` but the **actual route path is `/api/service-categories`**. Route registration in `index.js` line 472:
```javascript
{ file: 'service-category-routes', paths: ['/api/service-categories'], serviceName: 'serviceCategoryService', keycloakAuth: true }
```
All category endpoints are under `/api/service-categories`, NOT `/api/categories`.

### Analytics Routes Architecture

**Source:** `routes/analytics-routes.js` (660 lines)

Factory signature: `module.exports = (analyticsService) => { ... }`

The route file **internally instantiates** `AnalyticsController`:
```javascript
const AnalyticsController = require('../controllers/analyticsController');
const analyticsController = new AnalyticsController(analyticsService);
```

Route registration in `index.js` line 469:
```javascript
{ file: 'analytics-routes', paths: ['/api/analytics'], serviceName: 'analyticsService', keycloakAuth: true }
```

Special initialization in `index.js` (lines ~880-883):
```javascript
if (config.file === 'analytics-routes') {
  const AnalyticsController = require('./controllers/analyticsController');
  const analyticsController = new AnalyticsController(service);
  routeInstance = routeModule(service, analyticsController);
}
```
Note: index.js passes 2 args but analytics-routes.js only accepts 1. The route file ignores the second arg and creates its own controller.

**Authentication:** `keycloakAuth: true` — middleware applied globally via `router.use(keycloakAuthMiddleware.authenticate)` (line 19). No admin-only checks.

### Analytics Controller

**Source:** `controllers/analyticsController.js` (253 lines)

Constructor validates analyticsService has `getDashboardAnalytics` method:
```javascript
if (!analyticsService || typeof analyticsService.getDashboardAnalytics !== 'function') {
  throw new Error('Invalid analyticsService provided to AnalyticsController');
}
```

5 methods: `getDashboardAnalytics`, `getMetric`, `getTimeSeriesData`, `getSatisfactionGauge`, `getSatisfactionHeatmap`.

### Analytics Endpoints (9 total)

| Method | Path | Handler | Params |
|--------|------|---------|--------|
| GET | /api/analytics/dashboard | analyticsController.getDashboardAnalytics | startDate (opt), endDate (opt), locale (opt) |
| GET | /api/analytics/metric/:metric | analyticsController.getMetric | metric enum, startDate*, endDate* |
| GET | /api/analytics | route handler (direct service) | startDate, endDate, filters (JSON), locale |
| GET | /api/analytics/timeseries/:metricType | analyticsController.getTimeSeriesData | metricType enum, interval*, startDate*, endDate* |
| POST | /api/analytics/events | route handler (direct service) | body: eventType*, eventData |
| GET | /api/analytics/records | route handler (analyticsService.db.query AQL) | limit, offset |
| GET | /api/analytics/events | route handler (analyticsService.db.query AQL) | limit, offset |
| GET | /api/analytics/satisfaction/gauge | analyticsController.getSatisfactionGauge | startDate*, endDate*, locale |
| GET | /api/analytics/satisfaction/heatmap | analyticsController.getSatisfactionHeatmap | startDate*, endDate*, locale |

* = required

### Analytics Service Mock

**Source:** `services/analytics-service.js` (935 lines) — singleton

The mock MUST include these methods (controller constructor validates `getDashboardAnalytics`):
```javascript
jest.mock('../../services/analytics-service', () => ({
  getDashboardAnalytics: jest.fn(),
  getAnalytics: jest.fn(),         // Used by GET / handler (direct service call)
  getUniqueUsersCount: jest.fn(),
  getTimeSeriesData: jest.fn(),
  formatDateLabel: jest.fn((t) => t),  // Used by timeseries controller to format labels
  getSatisfactionGaugeData: jest.fn(),
  getSatisfactionHeatmapData: jest.fn(),
  recordQuery: jest.fn(),
  recordFeedback: jest.fn(),
  trackEvent: jest.fn(),
  db: {
    query: jest.fn().mockResolvedValue({
      all: jest.fn().mockResolvedValue([])
    })
  },                                // Used by GET /records and GET /events (raw AQL)
  init: jest.fn()
}));
```

**Metric-specific mock return values** — The controller's `getMetric` calls different service methods per metric:
- `totalQueries` → calls `getDashboardAnalytics()` → reads `.queries.total`
- `uniqueUsers` → calls `getUniqueUsersCount()`
- `averageResponseTime` → calls `getDashboardAnalytics()` → reads `.queries.avgResponseTime`
- `satisfactionRate` → calls `getSatisfactionGaugeData()` → reads `.currentValue`

Set up mock accordingly:
```javascript
analyticsService.getDashboardAnalytics.mockResolvedValue({
  queries: { total: 1000, avgResponseTime: 2.8 }
});
analyticsService.getUniqueUsersCount.mockResolvedValue(120);
analyticsService.getSatisfactionGaugeData.mockResolvedValue({ currentValue: 85.0 });
```

### Service Category Routes Architecture

**Source:** `routes/service-category-routes.js` (676 lines)

Factory signature: `module.exports = (serviceCategoryService) => { ... }`

Constructor validates: `typeof serviceCategoryService.getAllCategoriesWithServices !== 'function'`

Route registration in `index.js` line 472:
```javascript
{ file: 'service-category-routes', paths: ['/api/service-categories'], serviceName: 'serviceCategoryService', keycloakAuth: true }
```

**Authentication:** `keycloakAuth: true` — global on router. No admin-only checks on any endpoint.

### Service Category Endpoints (13 total)

| Method | Path | Service Method |
|--------|------|----------------|
| GET | /categories | getAllCategoriesWithServices(locale) |
| GET | /categories/detailed | getAdminAllCategoriesWithServices(locale) |
| GET | /categories/:categoryId | getCategoryWithServices(categoryId, locale) |
| GET | /:categoryId/translations | getCategoryTranslations(categoryId) |
| GET | /services/:serviceId/translations | getServiceTranslations(serviceId) |
| GET | /search | searchCategoriesAndServices(query, locale) |
| POST | / | createCategory(payload) |
| POST | /:categoryId/services | createServiceWithTranslations(categoryId, payload) |
| POST | /init | initializeDefaultCategoriesAndServices() |
| PUT | /:categoryId | updateCategoryWithTranslations(categoryId, payload) |
| PUT | /services/:serviceId | updateServiceWithTranslations(serviceId, payload) |
| DELETE | /:categoryId | categoryExists(categoryId) then deleteCategory(categoryId) |
| DELETE | /services/:serviceId | deleteService(serviceId) |

### Service Category Service Mock

**Source:** `services/service-category-service.js` (930 lines) — singleton

```javascript
jest.mock('../../services/service-category-service', () => ({
  getAllCategoriesWithServices: jest.fn(),
  getAdminAllCategoriesWithServices: jest.fn(),
  getCategoryWithServices: jest.fn(),
  getCategoryTranslations: jest.fn(),
  getServiceTranslations: jest.fn(),
  searchCategoriesAndServices: jest.fn(),
  createCategory: jest.fn(),
  createServiceWithTranslations: jest.fn(),
  updateCategoryWithTranslations: jest.fn(),
  updateServiceWithTranslations: jest.fn(),
  deleteCategory: jest.fn(),
  deleteService: jest.fn(),
  categoryExists: jest.fn(),
  initializeDefaultCategoriesAndServices: jest.fn(),
  upsertCategories: jest.fn(),
  upsertServices: jest.fn(),
  init: jest.fn()
}));
```

### Mock Strategy: Do NOT Mock AnalyticsController in analytics.test.js

In `auth.test.js`, the controller is mocked to prevent initialization:
```javascript
jest.mock('../../controllers/analyticsController', () => {
  return function () { return {}; };
});
```

**In `analytics.test.js`, do NOT use this mock.** The route file imports and instantiates the real controller with the mocked service. The controller constructor validates `getDashboardAnalytics` exists on the mock — your service mock MUST include it.

In `categories.test.js`, you still need the analyticsController mock (to prevent errors when index.js loads analytics-routes):
```javascript
jest.mock('../../controllers/analyticsController', () => {
  return function () { return {}; };
});
```

### Complete Service Mock List (Required by index.js)

Every service imported by `index.js` must be mocked to prevent "module not found" or initialization errors:

```javascript
// Auth services (always required)
jest.mock('../../services/keycloak-auth-service', () => ({
  verifyToken: jest.fn(),
  checkUserStatusInKeycloak: jest.fn()
}));
jest.mock('../../services/user-provisioning-service', () => ({
  provisionUser: jest.fn(),
  initialize: jest.fn(),
  markUserAsDeleted: jest.fn()
}));
jest.mock('../../services/session-service', () => ({
  getUserSessions: jest.fn(),
  endSession: jest.fn(),
  createSession: jest.fn()
}));

// Mock all other services (prevent index.js from loading them)
jest.mock('../../services/user-profile-service', () => ({}));
jest.mock('../../services/admin-dashboard-service', () => ({}));
jest.mock('../../services/query-service', () => ({}));
jest.mock('../../services/chat-history-service', () => ({}));
jest.mock('../../services/logs-service', () => ({}));
jest.mock('../../services/database-operations-service', () => ({}));
jest.mock('../../services/weather-service', () => ({}));
jest.mock('../../services/security-scan-service', () => ({}));
jest.mock('../../services/translation-service', () => ({}));
```

For `analytics.test.js`, mock analytics-service with full method list (see above). For `categories.test.js`, mock service-category-service with full method list (see above).

### Error Response Formats

**Analytics error formats are split by handler type:**

Controller-validated errors (metric, timeseries, satisfaction):
- 400: `{ error: 'Missing required parameters: startDate and endDate are required' }`
- 400: `{ error: 'Unsupported metric: <name>' }`
- 400: `{ error: 'Invalid interval: <val>. Must be one of: hourly, daily, weekly, monthly' }`
- 500: `{ error: 'Failed to retrieve ...' }`

Route handler errors (dashboard, general, events, records):
- 400: `{ message: 'eventType is required' }` (POST /events)
- 401: `{ error: 'UNAUTHENTICATED', message: 'User not authenticated' }` (POST /events — extra auth check)
- 500: `{ message: error.message }` (catch blocks)

**Categories errors:**
- 400: `{ message: 'Search query is required' }`
- 400: `{ message: 'Payload with nameEN is required' }` (not "Category nameEN is required")
- 404: `{ message: 'Category <id> not found' }` (DELETE category — direct response, not next(error))
- 404: `{ message: error.message }` (DELETE service — via error.code === 404 check)
- 500: `{ message: error.message }`

### POST /events Extra Auth Check

POST /events (line 404-406) extracts `req.user?.iss_sub` and returns 401 if missing:
```javascript
const userId = req.user?.iss_sub;
if (!userId) {
  return res.status(401).json({ error: 'UNAUTHENTICATED', message: 'User not authenticated' });
}
```
Ensure test tokens include `iss_sub` claim (the standard token fixture uses `sub` — you need both). Without `iss_sub`, the endpoint returns 401 even with a valid token.

### Timeseries Response Mapping

The controller maps raw time series data to `{ timestamp, dateLabel, value, userCount }`. The `formatDateLabel` mock defaults to returning the timestamp as-is. Test assertions should check this mapped shape, not the raw service response.

**Categories errors:**
- 400: `{ message: 'Search query is required' }`
- 400: `{ message: 'Category nameEN is required' }`
- 404: (via `next(error)` with NotFoundError)
- 500: `{ message: error.message }`

### Token Validation Tests (Shared Pattern)

All endpoints require authentication. Reuse the token test pattern from auth.test.js:
```javascript
describe('token validation', () => {
  it('should return 401 when no Authorization header', async () => {
    const response = await request(app).get('/api/analytics/dashboard');
    expect(response.status).toBe(401);
  });

  it('should return 401 when expired token', async () => {
    const token = createExpiredToken();
    const response = await request(app)
      .get('/api/analytics/dashboard')
      .set('Authorization', `Bearer ${token}`);
    expect(response.status).toBe(401);
  });

  it('should return 401 when malformed token', async () => {
    const response = await request(app)
      .get('/api/analytics/dashboard')
      .set('Authorization', 'Bearer invalid-token');
    expect(response.status).toBe(401);
  });
});
```

Write token validation tests once per describe block (not per endpoint) if the middleware is applied globally on the router.

### Categories DELETE Behavior

`DELETE /api/service-categories/:categoryId` calls TWO service methods:
1. `categoryExists(categoryId)` — returns boolean
2. `deleteCategory(categoryId)` — performs deletion

Returns 404 if category doesn't exist. The route does NOT use `next(error)` for 404s — it returns `res.status(404).json(...)` directly.

`DELETE /api/service-categories/services/:serviceId` catches errors and checks `error.code === 404` for specific 404 handling.

### Files to Create

| File | Action |
|------|--------|
| `__tests__/routes/analytics.test.js` | NEW |
| `__tests__/routes/categories.test.js` | NEW |

### Files NOT Modified

All existing test files remain unchanged. New test files are purely additive.

### Anti-Patterns to Avoid

- Do NOT test `/api/categories/*` — the real path is `/api/service-categories/*`
- Do NOT expect 400 for missing dashboard params — they are all optional with defaults
- Do NOT mock `getRecords`/`getEvents` on analytics service — those methods are never called; the route queries `analyticsService.db.query()` directly
- Do NOT forget to include `iss_sub` in token claims for POST /events tests
- Do NOT call `app.listen()` — `createApp()` returns the app without listening
- Do NOT modify existing test files
- Do NOT use ES `import`/`export` — CommonJS only (`require`/`module.exports`)
- Do NOT create real ArangoDB connections — all DB access must be mocked
- Do NOT use `ioredis-mock` — not needed for route handler tests
- Do NOT duplicate `process.env` overrides in test files — use centralized `__tests__/setup-env.js` via `require('../setup-env')`
- Do NOT mock `AnalyticsController` in `analytics.test.js` — the route creates it from the mocked service
- Do NOT test service layer logic — this story tests route handlers only (service tests are Story 2.7)
- Do NOT test middleware itself — that's Story 2.8
- Do NOT mock `service-category-service` with only partial methods — the route constructor validates `getAllCategoriesWithServices` exists

### Project Structure Notes

- Backend files live at `components/gov-chat-backend/` root — no `src/` subdirectory
- Route tests go in `__tests__/routes/` (established by Story 2.3)
- CommonJS (`require`/`module.exports`) everywhere in backend
- Jest config in `package.json`: `testMatch: ["**/__tests__/**/*.test.js"]`

### Downstream Impact

This story covers two route groups (analytics + categories). Stories 2.6 (admin/files), 2.7 (service layer), and 2.8 (middleware) follow the same pattern.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.5] — Original story definition
- [Source: _bmad-output/planning-artifacts/architecture.md#Backend Testing] — Jest + Supertest pattern, `__tests__/routes/` location
- [Source: _bmad-output/implementation-artifacts/2-2-create-backend-test-fixtures-and-shared-mocks.md] — Fixtures from Story 2.2
- [Source: _bmad-output/implementation-artifacts/2-3-test-backend-auth-route-handlers.md] — Established route test pattern
- [Source: components/gov-chat-backend/routes/analytics-routes.js] — Analytics route definitions (660 lines)
- [Source: components/gov-chat-backend/routes/service-category-routes.js] — Categories route definitions (676 lines)
- [Source: components/gov-chat-backend/controllers/analyticsController.js] — Controller with constructor validation (253 lines)
- [Source: components/gov-chat-backend/services/analytics-service.js] — Analytics service singleton (935 lines)
- [Source: components/gov-chat-backend/services/service-category-service.js] — Categories service singleton (930 lines)
- [Source: components/gov-chat-backend/index.js#L469] — Analytics route registration
- [Source: components/gov-chat-backend/index.js#L472] — Service-category route registration
- [Source: components/gov-chat-backend/index.js#L880-883] — Analytics special initialization

## Dev Agent Record

### Agent Model Used

Claude (GLM-5-turbo)

### Debug Log References

- Categories GET /:categoryId 404 test: global error handler uses `err.statusCode` (not `err.code`) to determine status. Fixed test to use `statusCode = 404` on the mock error.

### Completion Notes List

- Created analytics.test.js with 28 tests covering all 9 analytics endpoints (dashboard, metric, general, timeseries, POST events, GET records, GET events, satisfaction gauge, satisfaction heatmap)
- Created categories.test.js with 21 tests covering all 13 service-category endpoints (GET categories, GET detailed, GET by ID, translations, search, POST category, DELETE category/service, PUT category/service, POST service, POST init)
- AnalyticsController is NOT mocked in analytics.test.js — the route creates it from the mocked service, validating the real controller constructor logic
- Error format distinction verified: controller-validated errors use `{ error: '...' }`, route catch blocks use `{ message: error.message }`, POST /events 401 uses `{ error: 'UNAUTHENTICATED', message: '...' }`
- All 283 tests pass (49 new + 234 existing), zero lint errors

### File List

- `components/gov-chat-backend/__tests__/routes/analytics.test.js` — NEW (28 tests for analytics route handlers)
- `components/gov-chat-backend/__tests__/routes/categories.test.js` — NEW (21 tests for service-category route handlers)

### Review Findings

- [x] [Review][Patch] Tautological assertion — default limit/offset non vérifiés [analytics.test.js:429-436]
- [x] [Review][Patch] Pas de test pour le chemin 500 (route catch block `{message: error.message}`) — AC19 exige la validation du split error format
- [x] [Review][Patch] DELETE /:categoryId ordre d'appel non vérifié (categoryExists doit précéder deleteCategory) [categories.test.js:317-318]
- [x] [Review][Defer] getMetric fallback quand service retourne null/undefined — deferred, scope controller (story 2.7)
- [x] [Review][Defer] Locale non testé sur satisfaction endpoints — deferred, nice-to-have hors AC
- [x] [Review][Defer] Malformed JSON dans filters param — deferred, edge case
- [x] [Review][Defer] Pagination avec limit/offset non-numériques — deferred, edge case
- [x] [Review][Defer] Recherche avec query string vide — deferred, AC14 couvre le cas sans query
- [x] [Review][Defer] categoryExists lance une erreur (DB failure) — deferred, edge case d'infrastructure
- [x] [Review][Defer] DELETE service avec error code non-404 — deferred, edge case
