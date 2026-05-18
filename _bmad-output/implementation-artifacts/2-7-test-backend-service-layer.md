# Story 2.7: Test Backend Service Layer

Status: ready-for-dev

## Story

As a developer,
I want unit tests for backend service business logic,
So that service-layer bugs are caught without network or database dependencies.

## Acceptance Criteria

1. **AC1: Query service tests** — `__tests__/services/query-service.test.js` tests query construction, formatting, CRUD, feedback, categorization, search, and streaming helper logic with mocked ArangoDB
2. **AC2: Chat history service tests** — `__tests__/services/chat-history-service.test.js` tests conversation/message CRUD, folder management, search, stats, and query linking with mocked ArangoDB
3. **AC3: Analytics service tests** — `__tests__/services/analytics-service.test.js` tests query recording, feedback tracking, event tracking, dashboard aggregation, time series, and satisfaction metrics with mocked ArangoDB
4. **AC4: User profile service tests** — `__tests__/services/user-profile-service.test.js` tests profile retrieval, updates, file handling, protected field stripping, and data reset with mocked ArangoDB and filesystem
5. **AC5: Translation service tests** — `__tests__/services/translation-service.test.js` tests backend selection, text/markdown translation, caching, supported languages, and GPU→CPU fallback with mocked Redis and translation backends
6. **AC6: Mock conventions** — ArangoDB and external services mocked via `jest.mock()` at module level; all tests independent of execution order (NFR7); all use factory fixtures from `__tests__/fixtures/`
7. **AC7: Regression safety** — All existing tests (329+) continue to pass; new test files produce zero lint errors

## Tasks / Subtasks

- [ ] Task 1: Create `__tests__/services/` directory (AC: #1-#5)
- [ ] Task 2: Create `__tests__/services/query-service.test.js` (AC: #1)
  - [ ] 2.1: Mock shared-lib (virtual), arangojs (aql), worker_threads
  - [ ] 2.2: Test createQuery — validation, save, error paths
  - [ ] 2.3: Test getQuery, deleteQuery, addFeedback, markAsAnswered
  - [ ] 2.4: Test searchQueries with filters and pagination
  - [ ] 2.5: Test setQueryCategory, updateQueryResponseTime
  - [ ] 2.6: Test parseChatQnASSELine (pure function — no mocks needed)
  - [ ] 2.7: Test getMockOpeaResponse (pure function — no mocks needed)
  - [ ] 2.8: Test dependency injection (setAnalyticsService, setChatHistoryService)
- [ ] Task 3: Create `__tests__/services/chat-history-service.test.js` (AC: #2)
  - [ ] 3.1: Mock shared-lib (virtual), arangojs (aql)
  - [ ] 3.2: Test createConversation, getConversation, getUserConversations (pagination)
  - [ ] 3.3: Test addMessage, getConversationMessages, markMessagesAsRead
  - [ ] 3.4: Test updateConversation, deleteConversation (with permission check)
  - [ ] 3.5: Test folder CRUD — createFolder, getFolder, updateFolder, deleteFolder
  - [ ] 3.6: Test folder-conversation operations — add/remove/move
  - [ ] 3.7: Test searchConversations, searchFolders
  - [ ] 3.8: Test getUserConversationStats, createConversationFromQuery
  - [ ] 3.9: Test query linking — linkQueryToConversation, findMessagesForQuery, findOriginatingQuery
- [ ] Task 4: Create `__tests__/services/analytics-service.test.js` (AC: #3)
  - [ ] 4.1: Mock shared-lib (virtual), arangojs (aql), service-category-service
  - [ ] 4.2: Test recordQuery, recordFeedback, trackEvent
  - [ ] 4.3: Test getUniqueUsersCount with date range
  - [ ] 4.4: Test getDashboardAnalytics with locale handling
  - [ ] 4.5: Test getTimeSeriesData with interval formatting
  - [ ] 4.6: Test getSatisfactionGaugeData, getSatisfactionHeatmapData
  - [ ] 4.7: Test getEmptyDashboardData returns correct empty structure
  - [ ] 4.8: Test graceful degradation on DB errors
- [ ] Task 5: Create `__tests__/services/user-profile-service.test.js` (AC: #4)
  - [ ] 5.1: Mock shared-lib (virtual), arangojs (aql), fs/path modules
  - [ ] 5.2: Test getUserProfile, userExists
  - [ ] 5.3: Test updateUserProfile — field updates, JSON parsing, file handling
  - [ ] 5.4: Test protected field stripping (JIT_PROTECTED_FIELDS)
  - [ ] 5.5: Test storeFile, deleteUserFiles, resetUserData
  - [ ] 5.6: Test path sanitization integration
- [ ] Task 6: Create `__tests__/services/translation-service.test.js` (AC: #5)
  - [ ] 6.1: Mock shared-lib (virtual), ioredis, translation backends (CPU/GPU)
  - [ ] 6.2: Test translate — array of texts, cache hit/miss, error fallback
  - [ ] 6.3: Test translateMarkdown — structure preservation
  - [ ] 6.4: Test selectBackend — auto/CPU/GPU selection
  - [ ] 6.5: Test getSupportedLanguages, getBackendInfo
  - [ ] 6.6: Test GPU→CPU fallback on translation error
  - [ ] 6.7: Test in-flight deduplication
- [ ] Task 7: Run full regression suite and lint (AC: #6, #7)
  - [ ] 7.1: `npm test` — all tests pass (existing 329 + new)
  - [ ] 7.2: `npm run lint` — zero errors

## Dev Notes

### Service Unit Test Pattern (NOT Route Tests)

This story tests **service layer business logic** directly — no `createApp()`, no supertest, no HTTP. The pattern is fundamentally different from stories 2.3-2.6.

Follow the existing `session-service.test.js` pattern exactly. Note: test files live in `__tests__/services/`, so mock paths are `../../` (one level deeper than root-level tests).

```javascript
'use strict';

// 1. Load setup-env OR set env vars BEFORE requiring service
require('../setup-env');
// OR manually: process.env.SESSION_EXPIRATION_TIME = '1800000';

// 2. Mock dotenv — query/chat/analytics services call require('dotenv').config()
jest.mock('dotenv', () => ({ config: jest.fn() }));

// 3. Mock shared-lib with { virtual: true } — path is ../../ from __tests__/services/
jest.mock('../../shared-lib', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  dbService: { getConnection: jest.fn() }
}), { virtual: true });

// 4. Mock arangojs — capture aql for query assertions
jest.mock('arangojs', () => ({
  aql: (strings, ...values) => ({ _aql: true, strings, values })
}));

// 5. Create mock factories for collection and cursor
function createMockCollection() {
  return {
    save: jest.fn().mockResolvedValue({ _key: 'doc-1' }),
    update: jest.fn(),
    document: jest.fn(),
    remove: jest.fn(),
    ensureIndex: jest.fn()
  };
}

function createMockCursor(results) {
  return {
    next: jest.fn().mockResolvedValue(results.length > 0 ? results[0] : null),
    all: jest.fn().mockResolvedValue(results)
  };
}

// 6. Setup mock DB in beforeEach with jest.isolateModules to reset singletons
let service;
let mockDb;

beforeEach(() => {
  jest.clearAllMocks();
  mockDb = {
    collection: jest.fn().mockReturnValue(createMockCollection()),
    query: jest.fn()
  };
  const { dbService } = require('../../shared-lib');
  dbService.getConnection.mockResolvedValue(mockDb);

  // Services are class instances exported as singletons — isolateModules resets module cache
  jest.isolateModules(() => {
    service = require('../../services/target-service');
  });
  service.initialized = false;
});

// 7. Call init() before each test group
describe('TargetService', () => {
  beforeEach(async () => {
    await service.init();
  });

  it('should ...', async () => {
    mockDb.query.mockResolvedValue(createMockCursor([mockData]));
    const result = await service.method('arg');
    expect(result).toBeDefined();
  });
});
```

### CRITICAL: Service Dependencies and What to Mock

Each service has different dependencies. Mock ONLY what the service actually imports:

| Service | Must Mock | Notes |
|---------|-----------|-------|
| query-service | dotenv, shared-lib, arangojs, worker_threads, middleware/errors | `runOPEAWorker` uses Worker threads; inject analyticsService + chatHistoryService |
| chat-history-service | dotenv, shared-lib, arangojs, middleware/errors | Inject analyticsService; transaction-based delete |
| analytics-service | dotenv, shared-lib, arangojs, service-category-service | Category translation lookups; graceful degradation to empty data |
| user-profile-service | shared-lib, arangojs, fs, path, middleware/errors, path-sanitizer, constants/jit-fields | File system ops in constructor — mock fs BEFORE require; JIT_PROTECTED_FIELDS |
| translation-service | shared-lib, ioredis, translation/*-backend | Redis caching; backend fallback; **markdown deps loaded via dynamic `await import()` in `init()`** — cannot jest.mock, must mock on instance after init |

### Pure Functions to Test Without DB Mocks

These methods are pure logic — test them without mocking ArangoDB:

- `query-service.parseChatQnASSELine(line)` — parses SSE stream lines
- `query-service.getMockOpeaResponse(queryData)` — generates mock responses
- `analytics-service.formatDateLabel(timestamp, interval)` — date formatting
- `analytics-service.getEmptyDashboardData()` — returns empty structure
- `translation-service.getSupportedLanguages()` — returns language map

### Service Export Patterns

All services are **class instances exported as singletons** (not plain objects):
```javascript
// services/query-service.js — class with module.exports = instance
class QueryService { ... }
const instance = new QueryService();
module.exports = instance;

// services/chat-history-service.js — singleton pattern via static instance
class ChatHistoryService {
  constructor() {
    if (ChatHistoryService.instance) return ChatHistoryService.instance;
    // ...
    ChatHistoryService.instance = this;
  }
}
const chatHistoryService = new ChatHistoryService();
module.exports = chatHistoryService;
```

Services maintain state (`initialized` flag, collection references). Use `jest.isolateModules()` to reset singletons between tests. Set `service.initialized = false` in `beforeEach` to allow re-initialization.

### Mock Collection Naming Convention

Map collection names to mock variables for clarity:
```javascript
mockDb = {
  collection: jest.fn().mockImplementation((name) => {
    if (name === 'queries') return mockQueriesCollection;
    if (name === 'conversations') return mockConversationsCollection;
    if (name === 'messages') return mockMessagesCollection;
    return createMockCollection(); // default
  }),
  query: jest.fn()
};
```

### Transaction Mocking (chat-history-service)

Chat history service uses ArangoDB transactions for delete operations:
```javascript
mockDb.beginTransaction = jest.fn().mockResolvedValue({
  run: jest.fn(),
  commit: jest.fn().mockResolvedValue(undefined),
  abort: jest.fn().mockResolvedValue(undefined)
});
```

### Worker Thread Mocking (query-service)

Query service uses `worker_threads` for OPEA calls:
```javascript
jest.mock('worker_threads', () => ({
  Worker: jest.fn().mockImplementation(() => ({
    on: jest.fn(),
    postMessage: jest.fn(),
    terminate: jest.fn()
  }))
}));
```

### Redis Mocking (translation-service)

Translation service uses `ioredis` for caching. **Note: Redis client created in constructor** — mock must be in place before requiring:
```javascript
const mockRedis = {
  get: jest.fn().mockResolvedValue(null),
  set: jest.fn().mockResolvedValue('OK'),
  del: jest.fn().mockResolvedValue(1),
  quit: jest.fn().mockResolvedValue('OK')
};
jest.mock('ioredis', () => jest.fn().mockImplementation(() => mockRedis));
```

Also mock the translation backends (CPU/GPU):
```javascript
jest.mock('../../services/translation/cpu-translate-backend', () => ({
  translate: jest.fn().mockResolvedValue(['translated text']),
  getSupportedLanguages: jest.fn().mockReturnValue({ en: 'English', fr: 'French' })
}));
jest.mock('../../services/translation/gpu-translate-backend', () => ({
  translate: jest.fn().mockResolvedValue(['translated text']),
  getSupportedLanguages: jest.fn().mockReturnValue({ en: 'English', fr: 'French' })
}));
```

### File System Mocking (user-profile-service)

User profile service handles file uploads. **CRITICAL: constructor calls `fs.existsSync` and `fs.mkdirSync`** — the fs mock MUST be declared before `jest.isolateModules()` requires the service:
```javascript
// Mock fs BEFORE requiring service — constructor uses it
jest.mock('fs', () => ({
  ...jest.requireActual('fs'),
  mkdirSync: jest.fn(),
  writeFileSync: jest.fn(),
  unlinkSync: jest.fn(),
  existsSync: jest.fn().mockReturnValue(true),
  readdirSync: jest.fn().mockReturnValue([])
}));
```

### Translation Service Markdown (dynamic imports)

Translation service loads `unified`, `remark-parse`, `remark-stringify` via `await import()` in `init()` (lines 148-157). **Cannot use `jest.mock()` for these** — they are ESM dynamic imports. Instead, mock them on the service instance after `init()`:
```javascript
// After service.init(), mock the lazy-loaded markdown processors
service.unified = jest.fn().mockReturnValue({
  use: jest.fn().mockReturnThis(),
  parse: jest.fn().mockReturnValue({ type: 'root', children: [] }),
  stringify: jest.fn().mockReturnValue('translated markdown')
});
service.remarkParse = jest.fn();
service.remarkStringify = jest.fn();
```

Or skip `init()` entirely for markdown tests and set up the mock instance manually.

### Error Handling Patterns

Services use two patterns:
1. **Throw errors**: `throw new NotFoundError('Query not found')` — test with `expect(fn).rejects.toThrow()`
2. **Return error objects**: `return { success: false, error: 'CODE' }` — test with `expect(result.success).toBe(false)`

Analytics service has a third pattern:
3. **Graceful degradation**: catch errors internally and return empty data — test that errors don't propagate

### Services Already Tested (DO NOT recreate)

These service tests already exist at `__tests__/` root level — do NOT create new files for them:
- `keycloak-auth-service.test.js`
- `keycloak-proxy-service.test.js`
- `session-service.test.js`
- `user-provisioning-service.test.js`

### Fixture Reuse

Reuse existing fixtures from `__tests__/fixtures/`:
- `users.js` → `createMockUser()`, `createMockAdmin()`
- `tokens.js` → `createValidToken()`
- `requests.js` → `createMockReq()`, `createMockRes()`, `createMockNext()` (only if testing controller-like patterns)

Add service-specific fixture factories INSIDE each test file (not in shared fixtures) since service data shapes are unique to each service.

### Key Learnings from Stories 2.1-2.6

1. **Mock ALL methods** the service constructor or `init()` validates — missing mocks cause cryptic errors
2. **shared-lib is virtual** — only exists after Docker packaging, must mock with `{ virtual: true }`
3. **Error handler bug** in index.js line 775 has 3 params (not 4), Express treats it as regular middleware — but this doesn't affect service-level tests since we don't use `createApp()`
4. **Two error response patterns** in backend: thrown errors vs returned error objects — check each service's actual pattern before writing assertions
5. **Lint strictly** — all test code must pass ESLint (2-space indent, single quotes, semicolons)
6. **CommonJS only** — never use ES imports in backend tests

### Dependency Injection Pattern

Some services accept injected dependencies via setter methods:
```javascript
queryService.setAnalyticsService(mockAnalyticsService);
queryService.setChatHistoryService(mockChatHistoryService);
chatHistoryService.setAnalyticsService(mockAnalyticsService);
```

Call these setters in `beforeEach` after `init()` when the service under test depends on other services.

### Project Structure Notes

- Test directory: `components/gov-chat-backend/__tests__/services/` (NEW — must create)
- Service sources: `components/gov-chat-backend/services/`
- Shared lib: `components/gov-chat-backend/shared-lib` (virtual module)
- DB service: `components/gov-chat-backend/shared/lib/db-connection-service.js`
- Error classes: `components/gov-chat-backend/middleware/errors.js` (NotFoundError, ForbiddenError)
- Constants: `components/gov-chat-backend/constants/jit-fields.js`
- CommonJS: `require()` / `module.exports` only — NEVER ES imports

### References

- [Source: components/gov-chat-backend/services/query-service.js] — 1577 lines, 20+ methods, Worker threads, OPEA integration
- [Source: components/gov-chat-backend/services/chat-history-service.js] — 2339 lines, 25+ methods, transactions, folder management
- [Source: components/gov-chat-backend/services/analytics-service.js] — 936 lines, 10 methods, graceful degradation
- [Source: components/gov-chat-backend/services/user-profile-service.js] — 443 lines, 8 methods, file system, protected fields
- [Source: components/gov-chat-backend/services/translation-service.js] — 454 lines, 6 methods, Redis cache, backend fallback
- [Source: components/gov-chat-backend/__tests__/session-service.test.js] — reference pattern for service unit tests
- [Source: _bmad-output/implementation-artifacts/2-6-*.md] — previous story learnings
- [Source: _bmad-output/project-context.md] — project conventions and anti-patterns

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
