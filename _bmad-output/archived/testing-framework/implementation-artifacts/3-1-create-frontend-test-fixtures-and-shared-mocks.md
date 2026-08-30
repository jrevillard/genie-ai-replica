# Story 3.1: Create Frontend Test Fixtures and Shared Mocks

Status: done

## Story

As a developer,
I want centralized test fixtures and mock factories for the frontend,
so that all frontend tests use consistent, maintainable test data.

## Acceptance Criteria

1. **AC1: Centralized axios mock** — `src/__tests__/mocks/axios.js` exports a centralized axios mock with request/response interception that can be reused across all service and component tests
2. **AC2: Centralized Keycloak auth mock** — `src/__tests__/mocks/keycloakAuthService.js` exports a centralized Keycloak auth mock with configurable token, user, and authentication state
3. **AC3: Vuex store state factories** — `src/__tests__/fixtures/store-state.js` exports `createAuthenticatedState(overrides)` and `createUnauthenticatedState()` factories for setting up Vuex test stores
4. **AC4: API response fixtures** — `src/__tests__/fixtures/api-responses.js` exports mocked API response data for chat, categories, user profile, and other key domains
5. **AC5: Mock conventions** — All mocks follow the closure-based reference pattern to avoid hoisting issues; factories use the overrides pattern (spread with defaults)
6. **AC6: Regression safety** — All existing 240 tests continue to pass; new fixture files produce zero lint errors; no existing test files are modified

## Tasks / Subtasks

- [ ] Task 1: Create `src/__tests__/mocks/` directory (AC: #1, #2)
  - [ ] 1.1: Create directory structure
- [ ] Task 2: Create `src/__tests__/mocks/axios.js` (AC: #1)
  - [ ] 2.1: Export centralized mock axios instance with configurable response methods
  - [ ] 2.2: Support request interception capture for asserting call args
  - [ ] 2.3: Support configurable error responses (401, 404, 500)
  - [ ] 2.4: Reset utility for test isolation
- [ ] Task 3: Create `src/__tests__/mocks/keycloakAuthService.js` (AC: #2)
  - [ ] 3.1: Export mock auth service with signinSilent, login, logout, getAccessToken, getUser
  - [ ] 3.2: Export `createMockKeycloakUser(overrides)` factory
  - [ ] 3.3: Export `createMockToken(claims)` helper
  - [ ] 3.4: Reset utility for test isolation
- [ ] Task 4: Create `src/__tests__/fixtures/` directory (AC: #3, #4)
  - [ ] 4.1: Create directory structure
- [ ] Task 5: Create `src/__tests__/fixtures/store-state.js` (AC: #3)
  - [ ] 5.1: Export `createAuthenticatedState(overrides)` — full auth + chatHistory state
  - [ ] 5.2: Export `createUnauthenticatedState()` — cleared auth state
  - [ ] 5.3: State shapes match real Vuex store initial state exactly (auth + chatHistory modules)
- [ ] Task 6: Create `src/__tests__/fixtures/api-responses.js` (AC: #4)
  - [ ] 6.1: Export chat responses (conversations list, messages list, single conversation)
  - [ ] 6.2: Export category/service tree responses (tree structure, translations)
  - [ ] 6.3: Export user profile responses (profile data, update response)
  - [ ] 6.4: Export analytics responses (dashboard data, time series)
  - [ ] 6.5: Export document file responses (file list, upload response)
  - [ ] 6.6: Response shapes match actual backend API responses (source of truth)
- [ ] Task 7: Run full regression suite and lint (AC: #5, #6)
  - [ ] 7.1: `npm test` — all 240 existing tests pass
  - [ ] 7.2: `npm run lint` — zero errors across new and existing files

### Review Findings

- [x] [Review][Patch] `resetAxiosMock()` doesn't reset `mockRequestUse`/`mockResponseUse` jest mocks [`src/__tests__/mocks/axios.js:90-103`] — The reset function clears `capturedRequestHandlers`/`capturedResponseHandlers` arrays but does not call `mockRequestUse.mockReset()` or `mockResponseUse.mockReset()`. Tests asserting interceptor registration count (`expect(mockRequestUse).toHaveBeenCalledTimes(N)`) will fail on second+ test because call counts accumulate across `beforeEach` resets.
- [x] [Review][Patch] `setErrorResponse` produces a plain object, not an Error-like shape [`src/__tests__/mocks/axios.js:72-78`] — Real axios rejects with `AxiosError` (extends `Error`, has `isAxiosError: true`). The mock creates a bare `{ response, message }` object. Tests doing `error instanceof Error` or checking `error.isAxiosError` will fail. Wrap in `new Error()` or add `isAxiosError: true` property.

## Dev Notes

### What This Story Does NOT Do

This story creates **fixture infrastructure only** — no test files are written here. Stories 3.2–3.5 will consume these fixtures. The existing 240 tests are NOT refactored to use the new fixtures (that would be scope creep and risks breaking working tests).

### Existing Mock Patterns to Consolidate

The 8 existing test files use inline mocks. This story extracts the **reusable patterns** into shared files without modifying existing tests. Key patterns already established:

**Auth mock pattern** (used in 5+ files):
```javascript
jest.mock('@/services/keycloakAuthService', () => ({
  __esModule: true,
  default: {
    signinSilent: jest.fn(),
    login: jest.fn(),
    getAccessToken: jest.fn(),
    getUser: jest.fn(),
    logout: jest.fn()
  }
}));
```

**Axios mock pattern** (used in 3+ files):
```javascript
jest.mock('axios', () => ({
  __esModule: true,
  default: {
    get: jest.fn(),
    post: jest.fn(),
    put: jest.fn(),
    delete: jest.fn(),
    create: jest.fn(),
    interceptors: { request: { use: jest.fn() }, response: { use: jest.fn() } }
  }
}));
```

**createMockUser factory** (used in auth tests):
```javascript
function createMockUser(overrides = {}) {
  return {
    sub: 'test-user-id',
    email: 'test@example.com',
    name: 'Test User',
    ...overrides
  };
}
```

### Vuex Store Structure (state shapes MUST match exactly)

**auth module** (NOT namespaced — accessed via `state.isAuthenticated`, `getters['auth/currentUser']`):
```javascript
// Initial state
{
  isAuthenticated: false,
  user: null,
  accessToken: null,
  error: null,
  isInitialized: false
}

// Getters: currentUser, isAuthenticated, isInitialized, hasRole, isAdmin, userRoles
// Mutations: SET_AUTHENTICATED, SET_USER, SET_TOKEN, SET_ERROR, CLEAR_AUTH, SET_INITIALIZED
// Actions: init, login, handleCallback, logout, refreshToken, clearError
```

**chatHistory module** (NAMESPACED — accessed via `state.folders`, `getters['chatHistory/chats']`):
```javascript
// Initial state
{
  folders: [],
  chats: [],
  folderChats: {}
}

// Getters: folders, chats, folderChats, chatById, chatsByFolder
// Mutations: SET_FOLDERS, SET_CHATS, SET_FOLDER_CHATS, ADD_CONVERSATION, UPDATE_CONVERSATION, DELETE_CONVERSATION, ADD_MESSAGE, SET_CURRENT_CONVERSATION, etc.
// Actions: fetchFolders, fetchChats, fetchFolderChats, createConversation, etc.
// Cross-module: moveChat action uses rootGetters['auth/currentUser']
```

### HTTP Service Layer Architecture

**httpService.js** is the base layer — ALL domain services delegate to it. Mocking httpService at the module level is sufficient to isolate any API-dependent test.

```javascript
// httpService.js exports:
export default {
  get(url, config), post(url, data, config), put(url, data, config),
  delete(url, config), patch(url, data, config), putNoCache(url, data, config),
  getBaseUrl()  // reads from window.APP_CONFIG.apiUrl || process.env.VUE_APP_API_URL
}
```

**Request interceptor**: Injects `Authorization: Bearer <token>` via `keycloakAuthService.getAccessToken()`.
**Response interceptor**: On 401 → `signinSilent()` → single retry → redirect to Keycloak on failure.

**13 domain services** that consume httpService (for api-responses.js fixture coverage):
- `serviceTreeService` — 13 endpoints (GET service tree, categories, translations)
- `chatHistoryService` — 25 endpoints (conversations, messages, folders)
- `adminDashboardService` — 11 endpoints (users, analytics, settings)
- `analyticsService` — 8 endpoints (dashboard, time series, satisfaction)
- `documentFileService` — 16 endpoints (files, documents, search)
- `chatbotService` — 5 endpoints (query, SSE streaming via Fetch API, NOT axios)
- `fileService` — 7 endpoints (upload, download, delete)
- `labelService` — 4 endpoints (labels, translations)
- `userProfileService` — 4 endpoints (profile CRUD, file upload)
- `userService` — 2 endpoints (user info)
- `databaseOperationsService` — 3 endpoints
- `weatherService` — 1 endpoint
- `notificationService` — eventBus-based (no HTTP), trivially mockable

### Response Shape Source of Truth

Backend API response shapes are the authoritative source. Key shapes needed in api-responses.js:

**User profile** (from `GET /api/me/profile`):
```javascript
{ _key: 'users/12345', sub: 'user-id', email: 'user@example.com', firstName: 'John', lastName: 'Doe', organization: 'ITU', preferredLanguage: 'en', ... }
```

**Conversations** (from `GET /api/chat/conversations`):
```javascript
[{ _key: 'conversations/abc', title: 'Chat Title', createdAt: '2026-01-01T00:00:00Z', updatedAt: '...', lastMessage: '...', ... }]
```

**Messages** (from `GET /api/chat/conversations/:id/messages`):
```javascript
[{ _key: 'messages/xyz', conversationId: 'conversations/abc', role: 'user', content: 'Hello', timestamp: '...', ... }]
```

**Service tree** (from `GET /api/categories/tree`):
```javascript
[{ id: 'cat-1', nameEN: 'Category', nameLocal: '...', children: [...], services: [...] }]
```

**Analytics dashboard** (from `GET /api/analytics/dashboard`):
```javascript
{ totalQueries: 100, uniqueUsers: 50, avgResponseTime: 1.5, satisfactionScore: 4.2, ... }
```

### Cross-Component Fixture Consistency (FR36)

Per architecture: "Backend (Story 2.2), frontend (Story 3.1), and OPEA (Story 4.1) fixture stories MUST use consistent response shapes for shared entities (user, conversation, file metadata). When in doubt, the backend API response shape is the source of truth."

The backend `__tests__/fixtures/users.js` already defines `createMockUser()` with fields: `_key`, `sub`, `iss`, `email`, `name`, `firstName`, `lastName`, `roles`. Frontend fixtures MUST include these same fields in the same format.

### Mock Architecture: Closure-Based References

Use the closure-based pattern to avoid `jest.mock` hoisting issues. This is the **only** pattern to use:

```javascript
// src/__tests__/mocks/keycloakAuthService.js
const mockGetAccessToken = jest.fn();
const mockLogin = jest.fn();
const mockLogout = jest.fn();
const mockGetUser = jest.fn();
const mockSigninSilent = jest.fn();

function createDefaultMock() {
  return {
    getAccessToken: mockGetAccessToken,
    login: mockLogin,
    logout: mockLogout,
    getUser: mockGetUser,
    signinSilent: mockSigninSilent,
    isAuthenticated: jest.fn().mockReturnValue(false),
    clearStaleState: jest.fn()
  };
}

module.exports = {
  mockGetAccessToken,
  mockLogin,
  mockLogout,
  mockGetUser,
  mockSigninSilent,
  createDefaultMock,
  createMockKeycloakUser,
  createMockToken
};
```

### Frontend Module System: ES Modules (NOT CommonJS)

CRITICAL: Unlike the backend (CommonJS only), the frontend uses **ES module imports** (`import`/`export`). The test files also use ES modules — Jest handles the interop via babel-jest. However, the **fixture/mock files** should use `module.exports` / `require()` to stay consistent with existing test file conventions (Jest CommonJS interop). Check the existing test files — they use `require()` for test code even though the source uses `import`.

**Actually**: Checking the existing test files, they use a mix — `jest.mock('@/services/...', () => ({ ... }))` with `require()` for module-level setup. The fixture files should follow the same pattern. Use `module.exports` for exports since that's what the existing tests expect when importing fixtures.

### File Upload Pattern

Several services use `multipart/form-data` via FormData:
- `fileService`, `documentFileService`, `userProfileService`

The axios mock should support FormData payloads. In Jest/jsdom, `FormData` is available as a global.

### SSE Streaming (Bypasses Axios)

`chatbotService.submitQueryStream` uses native `Fetch API` with `AbortController`, NOT axios. This story's axios mock does NOT need to handle streaming — component tests for streaming will need separate Fetch API mocking (handled in story 3.2+).

### i18n: translate() function

Components use `translate('key.path', 'default text')` not `$t()`. The translate function is imported from `@/i18n/`. For component tests, this can be mocked globally or via `global.mocks` in mount options. This story should NOT create a translate mock — that's component test scope.

### Window APP_CONFIG

Tests run in jsdom. `window.APP_CONFIG` is set up in `setup.js` as an empty object. The httpService reads `window.APP_CONFIG.apiUrl`. Component tests that depend on API URL should set this in their local setup.

### Project Structure Notes

- Test root: `components/gov-chat-frontend/src/__tests__/`
- Source services: `components/gov-chat-frontend/src/services/`
- Source store: `components/gov-chat-frontend/src/store/`
- Source components: `components/gov-chat-frontend/src/components/`, `src/views/`
- jest.config.js: `components/gov-chat-frontend/jest.config.js`
- Setup: `components/gov-chat-frontend/src/__tests__/setup.js`
- Path alias: `@/` → `<rootDir>/src/`
- Module system: ES modules in source, CommonJS interop in tests
- Framework: Vue 3.2+, Options API only (NFR22), @vue/test-utils 2.4.6

### Existing Test Infrastructure (DO NOT MODIFY)

8 test files with 240 tests — all must continue to pass unchanged:
- `store/modules/auth.test.js` — 120 tests (Vuex auth module)
- `keycloakAuthService.test.js` — 32 tests (OIDC lifecycle)
- `httpService-401-retry.test.js` — 30 tests (HTTP retry logic)
- `httpService.test.js` — 21 tests (Axios interceptors)
- `router.test.js` — 13 tests (Navigation guards)
- `userUtils.test.js` — 8 tests (User ID extraction)
- `oidcConfig.test.js` — 8 tests (Config loading)
- `authStore.test.js` — 8 tests (Vuex auth module logout)

### Previous Story Intelligence (Epic 2 Backend Patterns)

From Story 2.7 (last backend story):
1. **Mock ALL methods** the service constructor or `init()` validates — missing mocks cause cryptic errors
2. **Two error response patterns** in backend: thrown errors vs returned error objects
3. **Lint strictly** — all test code must pass ESLint (2-space indent, single quotes, semicolons)
4. **CommonJS in backend, ES modules in frontend** — do not mix

From Story 2.2 (backend fixtures — analogous story):
- Used `overrides` pattern consistently: `createMockUser(overrides = {}) { return { _key: '...', ...overrides }; }`
- Fixture response shapes documented as source of truth for cross-component consistency
- `__tests__/fixtures/` directory for data factories, `__tests__/mocks/` for module mocks

### References

- [Source: components/gov-chat-frontend/src/services/httpService.js] — Axios wrapper with interceptors, 11KB
- [Source: components/gov-chat-frontend/src/services/keycloakAuthService.js] — OIDC auth, 5.6KB
- [Source: components/gov-chat-frontend/src/store/index.js] — Vuex store with 2 modules + localStorage plugin
- [Source: components/gov-chat-frontend/src/store/modules/auth.js] — Auth module: 9.2KB, not namespaced
- [Source: components/gov-chat-frontend/src/store/chatHistoryStore.js] — Chat history module: 7.4KB, namespaced
- [Source: components/gov-chat-frontend/jest.config.js] — Jest config: jsdom, vue3-jest, @/ alias
- [Source: components/gov-chat-frontend/src/__tests__/setup.js] — Global setup: console mock, window.APP_CONFIG
- [Source: _bmad-output/implementation-artifacts/investigations/frontend-test-planning-epic3-investigation.md] — Full frontend investigation
- [Source: _bmad-output/planning-artifacts/architecture.md#Mock & Fixture Architecture] — Mock architecture decisions
- [Source: _bmad-output/project-context.md#Frontend Testing Architecture] — Component landscape and test approach

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
