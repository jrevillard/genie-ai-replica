# Story 3.5: Test HTTP Services

Status: ready-for-dev

## Story

As a developer,
I want tests for frontend HTTP service interactions,
so that API communication is validated with mocked responses.

## Acceptance Criteria

1. **AC1 — chatbotService tests verify query submission**: `src/__tests__/services/chatbotService.test.js` tests `submitQuery()` posts to `/queries` with correct payload and returns response. Tests `updateQueryResponseTime()`, `markQueryAsAnswered()`, and `submitFeedback()` call correct endpoints. Error handling covers API failures.

2. **AC2 — chatHistoryService tests verify conversation management**: `src/__tests__/services/chatHistoryService.test.js` tests `getUserConversations()` fetches and returns conversation list. Tests `createConversation()`, `getConversationMessages()`, `addMessage()`, `deleteConversation()`, folder CRUD, and move operations call correct endpoints with correct payloads. Error handling covers 401/500 responses.

3. **AC3 — analyticsService tests verify data fetching and formatting**: `src/__tests__/services/analyticsService.test.js` tests `getDashboardAnalytics()`, `getTimeSeriesData()`, `getUniqueUsersCount()`, `getSatisfactionHeatmap()`, and `getSatisfactionGauge()` call correct endpoints. Tests helper functions `transformDashboardData()`, `formatDateLabel()`, `calculatePercentChange()`. Error handling returns fallback values (0, empty array, null objects).

4. **AC4 — Additional service tests cover remaining HTTP services**: `src/__tests__/services/userProfileService.test.js` tests profile CRUD. `src/__tests__/services/serviceTreeService.test.js` tests category/service tree operations. `src/__tests__/services/documentFileService.test.js` tests file upload/download/search/ingest operations.

5. **AC5 — All services use centralized axios mock**: Every test file mocks httpService (axios) via the centralized `src/__tests__/mocks/axios.js` pattern — no inline axios mocks. Mock is reset in `beforeEach()`.

6. **AC6 — Error handling coverage**: Tests verify services handle: successful responses (200), error responses (500), not found (404), and network failures. Services that return fallback values (analyticsService, serviceTreeService) are tested for their fallback behavior.

## Tasks / Subtasks

- [ ] Task 1: Create chatbotService tests (AC: #1)
  - [ ] 1.1 Create `src/__tests__/services/chatbotService.test.js`
  - [ ] 1.2 Test `submitQuery(data)` → POST `/queries` with payload
  - [ ] 1.3 Test `updateQueryResponseTime(queryId, time)` → PATCH `/queries/{id}/responsetime`
  - [ ] 1.4 Test `markQueryAsAnswered(queryId, time)` → PATCH `/queries/{id}/answered`
  - [ ] 1.5 Test `submitFeedback(queryId, feedback)` → POST `/queries/{id}/feedback`
  - [ ] 1.6 Test error handling on API failure (rejects with error)
  - [ ] 1.7 Test `submitQuery` rejects when response starts with 'Error:'

- [ ] Task 2: Create chatHistoryService tests (AC: #2)
  - [ ] 2.1 Create `src/__tests__/services/chatHistoryService.test.js`
  - [ ] 2.2 Test `getUserConversations(options)` → GET `/chat/conversations`
  - [ ] 2.3 Test `createConversation(data)` → POST `/chat/conversations`
  - [ ] 2.4 Test `getConversationMessages(id, options)` → GET `/chat/conversations/{id}/messages`
  - [ ] 2.5 Test `addMessage(data)` → POST `/chat/conversations/{id}/messages`
  - [ ] 2.6 Test `deleteConversation(id)` → DELETE `/chat/conversations/{id}`
  - [ ] 2.7 Test folder operations: `getUserFolders`, `createFolder`, `updateFolder`, `deleteFolder`
  - [ ] 2.8 Test `moveConversation(id, from, to)` → POST `/chat/conversations/{id}/move`
  - [ ] 2.9 Test `searchConversations(term, options)` → GET `/chat/search`
  - [ ] 2.10 Test `getConversationFolder(id)` returns `{ inFolder: false }` on 404

- [ ] Task 3: Create analyticsService tests (AC: #3)
  - [ ] 3.1 Create `src/__tests__/services/analyticsService.test.js`
  - [ ] 3.2 Test `getDashboardAnalytics(period, date, locale)` → GET `/analytics/dashboard`
  - [ ] 3.3 Test `getTimeSeriesData(metric, interval, start, end, locale)` → GET `/analytics/timeseries/{metric}`
  - [ ] 3.4 Test `getUniqueUsersCount(start, end, locale)` → GET `/analytics/metric/uniqueUsers`
  - [ ] 3.5 Test `getSatisfactionHeatmap(period, date, locale)` → GET `/analytics/satisfaction/heatmap`
  - [ ] 3.6 Test `getSatisfactionGauge(period, date, locale)` → GET `/analytics/satisfaction/gauge`
  - [ ] 3.7 Test helper: `transformDashboardData(data)` transforms raw API response
  - [ ] 3.8 Test helper: `formatDateLabel(timestamp, interval)` formats correctly per interval
  - [ ] 3.9 Test helper: `calculatePercentChange(current, previous)` returns correct percentage
  - [ ] 3.10 Test error fallbacks: getUniqueUsersCount → 0, getTimeSeriesData → [], getComparisonData → `{current: null, previous: null}`
  - [ ] 3.11 Test `recordQuery(doc)` → POST `/analytics/query`
  - [ ] 3.12 Test `recordFeedback(queryId, feedback)` → POST `/analytics/feedback`

- [ ] Task 4: Create additional service tests (AC: #4)
  - [ ] 4.1 Create `src/__tests__/services/userProfileService.test.js` — test `getProfile()` → GET `/me`, `updateProfile(data)` → PUT `/me`
  - [ ] 4.2 Create `src/__tests__/services/serviceTreeService.test.js` — test `getAllCategories()`, `getAdminCategories()`, `searchServices()`, CRUD operations, error fallbacks (empty arrays)
  - [ ] 4.3 Create `src/__tests__/services/documentFileService.test.js` — test `getFiles()`, `uploadFile()`, `deleteFile()`, `ingestFile()`, crawl operations

- [ ] Task 5: Verify and lint (AC: #5, #6)
  - [ ] 5.0 Run `npm test` before changes to confirm baseline
  - [ ] 5.1 All tests pass with `npm test` in `components/gov-chat-frontend/`
  - [ ] 5.2 All test files pass ESLint (`npm run lint`)
  - [ ] 5.3 Existing tests (240) pass unchanged

## Dev Notes

### Epic AC Naming vs Real Code

The epic references "chatService" and "sendMessage" — the real files are `chatbotService.js` (with `submitQuery()`) and `chatHistoryService.js` (with `getUserConversations()`). The ACs above are mapped to actual code.

### Service Landscape — What Has Tests, What Doesn't

**Already tested (do NOT create new test files):**
- `httpService.js` → `src/__tests__/httpService.test.js` + `httpService-401-retry.test.js` (comprehensive)
- `keycloakAuthService.js` → `src/__tests__/keycloakAuthService.test.js` (comprehensive)

**No HTTP calls (skip):**
- `notificationService.js` — event bus wrapper, no API calls. Trivially mockable. Skip unless time permits.
- `index.js` — barrel exports, no logic. Skip.

**Scope for this story (test files to create):**

| Service | Lines | Functions | Endpoints | Priority |
|---------|-------|-----------|-----------|----------|
| chatbotService.js | 187 | 5 | 5 | AC1 — must |
| chatHistoryService.js | 540 | 27 | 27 | AC2 — must |
| analyticsService.js | 553 | 17 | 8 | AC3 — must |
| userProfileService.js | 120 | 4 | 2 | AC4 — should |
| serviceTreeService.js | 227 | 13 | 13 | AC4 — should |
| documentFileService.js | 267 | 16 | 16 | AC4 — should |
| adminDashboardService.js | 269 | 12 | 11 | AC4 — nice |
| databaseOperationsService.js | 51 | 3 | 3 | AC4 — nice |
| fileService.js | 143 | 7 | 5 | AC4 — nice |
| labelService.js | 74 | 4 | 4 | AC4 — nice |
| userService.js | 43 | 2 | 2 | AC4 — nice |
| weatherService.js | 22 | 1 | 1 | AC4 — nice |

### Mock Strategy — httpService Mocking

All services delegate HTTP calls to `httpService.js`. Mock `httpService` at the module level — NOT axios directly (that's already tested in httpService.test.js).

**Pattern:**
```javascript
const mockGet = jest.fn();
const mockPost = jest.fn();
const mockPut = jest.fn();
const mockDelete = jest.fn();
const mockPatch = jest.fn();

jest.mock('@/services/httpService', () => ({
  get: (...args) => mockGet(...args),
  post: (...args) => mockPost(...args),
  put: (...args) => mockPut(...args),
  delete: (...args) => mockDelete(...args),
  patch: (...args) => mockPatch(...args)
}));
```

**Why mock httpService, not axios:**
- Services call `httpService.get('/endpoint', params)` — they don't use axios directly
- httpService already has comprehensive tests covering interceptors, 401 retry, token injection
- Service tests should validate that the correct httpService method is called with correct args
- Services receive `response.data` from httpService (not raw axios response)

**Reset in beforeEach:**
```javascript
beforeEach(() => {
  jest.clearAllMocks();
});
```

### chatbotService — Streaming Is Out of Scope

`submitQueryStream()` uses the native Fetch API (not axios/httpService) for SSE streaming. This is complex to mock (ReadableStream, event parsing, callbacks). **Defer streaming tests** — only test `submitQuery()`, `updateQueryResponseTime()`, `markQueryAsAnswered()`, and `submitFeedback()`.

### chatHistoryService — Largest Service (540 lines, 27 functions)

This is the biggest service. Group tests logically:
- **Conversations**: getUserConversations, getConversation, createConversation, updateConversation, deleteConversation
- **Messages**: getConversationMessages, addMessage, markMessagesAsRead, findMessagesForQuery, findOriginatingQuery
- **Search**: searchConversations, getRecentConversations, getUserConversationStats
- **Folders**: getUserFolders, getFolder, createFolder, updateFolder, deleteFolder, getFolderPath, searchFolders, reorderFolders
- **Folder-Conversation**: addConversationToFolder, getConversationFolder, moveConversation, removeConversationFromFolder

**Key edge case:** `getConversationFolder(id)` returns `{ inFolder: false, folder: null }` on 404 (catches error and returns fallback). Test this explicitly.

### analyticsService — Mixed HTTP + Pure Logic

analyticsService has both HTTP functions (8 endpoints) and pure helper functions. Test both:

**HTTP functions** (mock httpService):
- `getDashboardAnalytics`, `getTimeSeriesData`, `getUniqueUsersCount`, `getSatisfactionHeatmap`, `getSatisfactionGauge`, `recordQuery`, `recordFeedback`, `getComparisonData`

**Pure functions** (no mocking needed):
- `transformDashboardData(data)` — transforms raw API response
- `formatDateLabel(timestamp, interval)` — formats dates per interval type
- `calculatePercentChange(current, previous)` — percentage calculation
- `getWeekNumber(date)` — ISO week number
- `calculateDateRange(period, date)` — returns {start, end}
- `formatValue(value, format, locale)` — formats numbers/percentages
- `getTrendColor(change, isInverse)` — returns CSS class string

**Error fallbacks to test:**
- `getUniqueUsersCount()` → returns `0` on error
- `getComparisonData()` → returns `{ current: null, previous: null }` on error
- `getTimeSeriesData()` → returns `[]` on error
- `getSatisfactionHeatmap()` → returns `[]` on error
- `getSatisfactionGauge()` → **throws** on error (no fallback)

**i18n dependency:** `setI18n(i18n)` and `getCurrentLocale(override)` — mock i18n object with `global.locale = 'en'`.

### serviceTreeService — Error Fallbacks

Several functions return fallback values on error:
- `searchServices()` → `{ categories: [], services: [] }`
- `getCategoryTranslations()` → `[]`
- `getServiceTranslations()` → `[]`

Test these fallback paths explicitly.

### Existing Test Infrastructure to Reuse

**Fixtures (import from `src/__tests__/fixtures/`):**
- `api-responses.js` — has `conversationsListResponse`, `singleConversationResponse`, `messagesListResponse`, `analyticsDashboardResponse`, `analyticsTimeseriesResponse`, `fileListResponse`, `fileUploadResponse`, `userProfileResponse`, `categoriesListResponse`, etc.

**Mocks (import from `src/__tests__/mocks/`):**
- `axios.js` — has `setSuccessResponse(method, data)`, `setErrorResponse(method, status, data)`, `resetAxiosMock()`

**However:** The existing tests for httpService itself mock axios directly. For service tests, mock `httpService` (the module the services import), not axios. The shared `axios.js` mock utilities may be useful for constructing mock response shapes but the primary mock target is the httpService module.

### Dependencies That Must Be Mocked

```
Per test file:
- @/services/httpService — mock get, post, put, delete, patch (ALL services depend on this)
- keycloakAuthService — only needed if service accesses tokens directly (chatbotService streaming, which is deferred)
```

### Files to Create

| File | Purpose |
|------|---------|
| `src/__tests__/services/chatbotService.test.js` | Chatbot query submission tests (AC1) |
| `src/__tests__/services/chatHistoryService.test.js` | Chat history CRUD tests (AC2) |
| `src/__tests__/services/analyticsService.test.js` | Analytics + helper function tests (AC3) |
| `src/__tests__/services/userProfileService.test.js` | Profile CRUD tests (AC4) |
| `src/__tests__/services/serviceTreeService.test.js` | Category/service tree tests (AC4) |
| `src/__tests__/services/documentFileService.test.js` | File management tests (AC4) |

### Files to Read (reference only, do NOT modify)

- `src/services/chatbotService.js` — primary under test (AC1)
- `src/services/chatHistoryService.js` — primary under test (AC2)
- `src/services/analyticsService.js` — primary under test (AC3)
- `src/services/userProfileService.js` — reference (AC4)
- `src/services/serviceTreeService.js` — reference (AC4)
- `src/services/documentFileService.js` — reference (AC4)
- `src/services/httpService.js` — understand how services call HTTP (do NOT retest)
- `src/__tests__/httpService.test.js` — existing test patterns to follow
- `src/__tests__/httpService-401-retry.test.js` — existing error handling patterns
- `src/__tests__/fixtures/api-responses.js` — reuse response fixtures
- `src/__tests__/mocks/axios.js` — available mock utilities

### What NOT to Test (Out of Scope)

- **httpService internals** — interceptors, token injection, 401 retry (already tested in httpService.test.js)
- **keycloakAuthService** — OIDC flows (already tested)
- **Streaming (SSE)** — chatbotService.submitQueryStream() uses native Fetch, not httpService. Complex to mock, defer.
- **notificationService** — event bus wrapper, no HTTP calls
- **Vue component integration** — how components consume services (covered by stories 3.2, 3.3)
- **Vuex store** — how stores use services (covered by story 3.4)

### Technical Constraints

- **NFR22**: Options API only — though these are pure JS service tests, no Vue involved
- **NFR11**: All test code passes ESLint and Prettier
- **NFR7**: Tests must be order-independent (no test depends on side effects from another)
- **NFR6**: No flaky tests — all mocks are deterministic
- **CommonJS**: Test files use `require()`/`module.exports` (Jest CommonJS mode per jest.config.js)
- **NFR13**: Mock definitions centralized in `src/__tests__/mocks/` — but service-level mocks (httpService) can be co-located per test file since they mock different modules
- **NFR15**: Adding a test for an existing service should only require changes in the test file

### Project Structure Notes

- New test files go in `src/__tests__/services/` (new directory)
- This directory doesn't exist yet — create it
- All existing test files must continue to pass — do NOT modify existing test logic
- Import fixtures from `src/__tests__/fixtures/` and reuse mock utilities from `src/__tests__/mocks/`
- The `@/` path alias maps to `src/` via jest.config.js moduleNameMapper

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story-3.5] — Story definition and ACs
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend-Testing] — Test infrastructure
- [Source: _bmad-output/project-context.md#Frontend-Testing-Architecture] — Frontend test landscape
- [Source: _bmad-output/project-context.md#HTTP-Service-Layer] — Service layer architecture
- [Source: _bmad-output/implementation-artifacts/3-1-create-frontend-test-fixtures-and-shared-mocks.md] — Story 3.1 fixtures
- [Source: _bmad-output/implementation-artifacts/3-4-test-vuex-store-modules.md] — Story 3.4 patterns

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
