# Story 3-6: Test Frontend Services and Utils

Status: backlog

## Story

As a developer,
I want unit tests for all untested frontend services and utilities,
So that HTTP interactions and utility logic are verified without API dependencies.

## Acceptance Criteria

1. **AC1: adminDashboardService** — test system health, user stats, security metrics, diagnostics, user search with mocked axios
2. **AC2: fileService** — test file operations with mocked API responses
3. **AC3: labelService** — test label CRUD with mocked API
4. **AC4: userService** — test user operations including deleteAccount (GDPR-critical path)
5. **AC5: databaseOperationsService** — test backup/restore/optimize HTTP calls
6. **AC6: ThemeManager** — test theme switching, system preference detection, localStorage persistence
7. **AC7: fileUtils** — test file size formatting, MIME type checking utilities
8. **AC8: store/index.js** — test Vuex store initialization and module registration
9. **AC9: Regression safety** — all existing tests pass, zero lint errors

## Tasks / Subtasks

- [ ] Task 1: Create `src/__tests__/services/adminDashboardService.test.js` (82 lines target)
- [ ] Task 2: Create `src/__tests__/services/fileService.test.js` (45 lines target)
- [ ] Task 3: Create `src/__tests__/services/labelService.test.js` (21 lines target)
- [ ] Task 4: Create `src/__tests__/services/userService.test.js` (11 lines target — GDPR critical)
- [ ] Task 5: Create `src/__tests__/services/databaseOperationsService.test.js` (12 lines target)
- [ ] Task 6: Create `src/__tests__/utils/ThemeManager.test.js` (74 lines target)
- [ ] Task 7: Create `src/__tests__/utils/fileUtils.test.js` (11 lines target)
- [ ] Task 8: Create `src/__tests__/store/index.test.js` (14 lines target)
- [ ] Task 9: Run full regression suite and lint

## Dev Notes

### Service Test Pattern

Follow existing service tests (analyticsService.test.js, chatbotService.test.js):
- Mock axios at module level: `jest.mock('axios')`
- Test both pure functions and HTTP call methods
- Verify URL construction, query params, response parsing
- Test error handling (network errors, 4xx, 5xx responses)

```javascript
jest.mock('axios');
const axios = require('axios');

beforeEach(() => {
  jest.clearAllMocks();
  axios.create.mockReturnValue({
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } }
  });
});
```

### userService — GDPR Critical

`deleteAccount()` must be tested thoroughly:
- Success path: verify DELETE /api/me/delete is called
- Error path: verify user-facing error message
- Confirm that the function handles 401 (expired token) correctly

### ThemeManager

Test without DOM dependencies:
- Mock `window.matchMedia` for system preference detection
- Mock `localStorage` for persistence
- Test light/dark/system switching logic

### Coverage Impact

Current: branches 33.6%, functions 34.6%
After: estimated branches ~40%, functions ~42%

## Change Log
