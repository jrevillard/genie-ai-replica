# Story 2.2: Create Backend Test Fixtures and Shared Mocks

Status: ready-for-dev

## Story

As a developer,
I want centralized test fixtures and mock factories for the backend,
so that all backend tests use consistent, maintainable test data.

## Acceptance Criteria

1. **AC1: User fixture factory** — `__tests__/fixtures/users.js` exports `createMockUser(overrides)` that returns a user object with sensible defaults matching the Keycloak JWT claims shape (`_key`, `sub`, `iss_sub`, `iss`, `name`, `email`, `realm_roles`, `resource_access`). The overrides pattern (`{ ...defaults, ...overrides }`) allows any field to be overridden.

2. **AC2: Token fixture helpers** — `__tests__/fixtures/tokens.js` exports `createValidToken(claims)` and `createExpiredToken(claims)` that create signed JWT strings using the `jsonwebtoken` library. Tokens contain the same claim shape as real Keycloak tokens (`iss`, `sub`, `iss_sub`, `exp`, `iat`, `realm_access`, `resource_access`). `createValidToken()` sets `exp` 1 hour in the future; `createExpiredToken()` sets `exp` 1 hour in the past.

3. **AC3: HTTP request helpers** — `__tests__/fixtures/requests.js` exports `createMockReq(overrides)` and `createMockRes()`. `createMockReq` returns a mock Express `req` with `user` (from `createMockUser`), `params`, `query`, `body`, `headers`, `method`, `path`. `createMockRes` returns `{ json: jest.fn(), status: jest.fn().mockReturnThis(), send: jest.fn(), set: jest.fn().mockReturnThis() }`. Both use the overrides pattern.

4. **AC4: Centralized shared-lib mock** — `__tests__/mocks/shared-lib.js` exports a complete mock object with ALL 4 exports used by `index.js`: `logger` (info/error/warn/debug jest fns), `dbService` (`{ getConnection: jest.fn() }`), `securityHeaders` (pass-through middleware `(req, res, next) => next()`), `SecurityMiddleware` (`{ applySecurityMiddleware: jest.fn() }`). This file is importable via `jest.mock('../shared-lib', () => require('./__tests__/mocks/shared-lib'))` or as a `__mocks__` auto-mock.

5. **AC5: Module-level db-connection-service mock** — A Jest setup file (or the centralized shared-lib mock) ensures `db-connection-service.js` singleton is mocked at module level, preventing real ArangoDB connections during any test run.

6. **AC6: CommonJS only** — All fixture and mock files use `require()`/`module.exports` syntax exclusively (NFR21). No ES import/export.

7. **AC7: Existing tests pass** — All 173 existing tests (165 pre-existing + 8 from Story 2.1) continue to pass. No existing test file is modified. The new files are additive only.

8. **AC8: Cross-component fixture consistency** — Fixture response shapes (user, conversation, file metadata) documented in this story are the source of truth. Frontend (Story 3.1) and OPEA (Story 4.1) fixtures MUST match these shapes.

9. **AC9: Self-tests** — Each fixture module includes a co-located test file verifying:
   - `createMockUser()` returns expected default shape
   - `createMockUser({ name: 'Custom' })` overrides work
   - `createValidToken()` returns a decodable JWT string
   - `createExpiredToken()` returns an expired JWT
   - `createMockReq()` returns expected default shape with user
   - `createMockRes()` returns mock with jest functions
   - Centralized shared-lib mock has all 4 exports

## Tasks / Subtasks

- [ ] Task 1: Create centralized shared-lib mock (AC: #4, #5, #6)
  - [ ] 1.1 Create `__tests__/mocks/shared-lib.js` with all 4 exports (logger, dbService, securityHeaders, SecurityMiddleware)
  - [ ] 1.2 Ensure `dbService` mock prevents ArangoDB auto-connection
  - [ ] 1.3 Use CommonJS `module.exports`

- [ ] Task 2: Create user fixture factory (AC: #1, #6)
  - [ ] 2.1 Create `__tests__/fixtures/users.js` with `createMockUser(overrides)`
  - [ ] 2.2 Define default user matching Keycloak JWT claims shape
  - [ ] 2.3 Add `createMockAdmin(overrides)` convenience factory (user with `realm_roles: ['admin']`)

- [ ] Task 3: Create token fixture helpers (AC: #2, #6)
  - [ ] 3.1 Create `__tests__/fixtures/tokens.js` with `createValidToken(claims)` and `createExpiredToken(claims)`
  - [ ] 3.2 Use `jsonwebtoken` (existing dependency) with a test secret
  - [ ] 3.3 Set appropriate `exp`, `iat`, `iss`, `sub`, `iss_sub` claims
  - [ ] 3.4 Export `TEST_JWT_SECRET` constant for verification in tests

- [ ] Task 4: Create HTTP request helpers (AC: #3, #6)
  - [ ] 4.1 Create `__tests__/fixtures/requests.js` with `createMockReq(overrides)` and `createMockRes()`
  - [ ] 4.2 `createMockReq` includes `user` from `createMockUser()`, plus `params`, `query`, `body`, `headers`, `method`, `path`
  - [ ] 4.3 `createMockRes` returns `{ json, status, send, set }` all as jest fns with `status` chained via `mockReturnThis()`
  - [ ] 4.4 Add `createMockNext()` helper returning `jest.fn()`

- [ ] Task 5: Create fixture self-tests (AC: #9)
  - [ ] 5.1 Create `__tests__/fixtures/fixtures.test.js` testing all factories
  - [ ] 5.2 Test default shapes, override patterns, token encoding/decoding

- [ ] Task 6: Verify existing tests pass (AC: #7)
  - [ ] 6.1 Run `cd components/gov-chat-backend && npm test` — all 173 tests pass
  - [ ] 6.2 Run `cd components/gov-chat-backend && npm run lint` — no lint errors

## Dev Notes

### Existing Test Patterns (MUST follow)

The backend has 9 existing test files. Two patterns coexist:

**Pattern A — Inline mocks (7 tests)**: `authController.test.js`, `keycloak-auth-middleware.test.js`, etc. define `jest.mock('../shared-lib', ...)` and `createMockReq`/`createMockRes` inline. These tests are NOT modified.

**Pattern B — Supertest + createApp (1 test)**: `createApp.test.js` uses `request(app)` with comprehensive service mocks. This pattern is the future for Stories 2.3–2.8.

The new fixture files serve Pattern B (and future tests). They do NOT replace existing inline mocks — existing tests keep working as-is.

### shared-lib Mock Requirements

`index.js` line 12 destructures: `const { logger, dbService, securityHeaders, SecurityMiddleware } = require('./shared-lib');`

ALL 4 exports must be present in the mock. Missing any causes `Cannot destructure property 'X' of undefined` crash.

```javascript
// __tests__/mocks/shared-lib.js
'use strict';
module.exports = {
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  },
  dbService: { getConnection: jest.fn() },
  securityHeaders: (req, res, next) => next(),
  SecurityMiddleware: { applySecurityMiddleware: jest.fn() }
};
```

**Usage in future tests:**
```javascript
jest.mock('../shared-lib', () => require('./__tests__/mocks/shared-lib'));
```

### User Object Shape (Source of Truth for Cross-Component Consistency)

The user shape comes from Keycloak JWT token claims as parsed by `keycloak-auth-middleware.js`. Verified from existing tests (`authController.test.js` lines 29-40, `keycloak-auth-middleware.test.js`):

```javascript
// Default user — matches Keycloak JWT claims after middleware parsing
{
  _key: 'user-123',                    // ArangoDB document key (derived from sub)
  sub: 'user-123',                     // Keycloak subject ID
  iss_sub: 'http://localhost:8080/realms/genie#user-123',  // Combined issuer#subject
  iss: 'http://localhost:8080/realms/genie',               // Keycloak realm URL
  name: 'Test User',
  email: 'test@example.com',
  email_verified: true,
  realm_roles: ['user'],               // Keycloak realm roles
  resource_access: { 'genie-app': { roles: ['user'] } },  // Keycloak client roles
  preferred_username: 'testuser'
}
```

**Cross-component contract:** Frontend (Story 3.1) and OPEA (Story 4.1) MUST use this same shape for user-related test data. The `sub` and `iss_sub` fields are the primary identifiers.

### Token Fixture Design

The backend uses `jsonwebtoken` (^9.0.0) — already in dependencies. Token fixtures must produce JWTs that pass the middleware's verification:

```javascript
// __tests__/fixtures/tokens.js
const jwt = require('jsonwebtoken');
const TEST_JWT_SECRET = 'test-secret-key-for-fixtures';

function createValidToken(claims = {}) {
  const defaultClaims = {
    sub: 'user-123',
    iss: 'http://localhost:8080/realms/genie',
    iss_sub: 'http://localhost:8080/realms/genie#user-123',
    name: 'Test User',
    email: 'test@example.com',
    realm_access: { roles: ['user'] },
    resource_access: { 'genie-app': { roles: ['user'] } },
    // exp = 1 hour from now
    exp: Math.floor(Date.now() / 1000) + 3600,
    iat: Math.floor(Date.now() / 1000)
  };
  return jwt.sign({ ...defaultClaims, ...claims }, TEST_JWT_SECRET);
}

function createExpiredToken(claims = {}) {
  const defaultClaims = {
    sub: 'user-123',
    iss: 'http://localhost:8080/realms/genie',
    // exp = 1 hour ago
    exp: Math.floor(Date.now() / 1000) - 3600,
    iat: Math.floor(Date.now() / 1000) - 7200
  };
  return jwt.sign({ ...defaultClaims, ...claims }, TEST_JWT_SECRET);
}
```

**Important:** The `TEST_JWT_SECRET` is only for fixture tokens. Real Keycloak tokens use RSA, not HMAC. Route handler tests using Supertest (Stories 2.3-2.6) will bypass real Keycloak verification via `keycloakAuthMiddleware.authenticate` mock.

### HTTP Request/Response Helpers

Existing patterns from `authController.test.js`:

```javascript
function createMockReq(overrides = {}) {
  return {
    user: {
      _key: 'user-123',
      iss_sub: 'http://localhost:8080/realms/genie#user-123',
      iss: 'http://localhost:8080/realms/genie',
      name: 'Test User',
      email: 'test@example.com',
      ...overrides
    },
    ...overrides
  };
}

function createMockRes() {
  const res = {
    json: jest.fn(),
    status: jest.fn().mockReturnThis()
  };
  return res;
}
```

**New helpers improve on this pattern:**
- `createMockReq` uses `createMockUser()` for the `user` field (single source of truth)
- `createMockRes` adds `send` and `set` methods for broader handler coverage
- New `createMockNext()` returns `jest.fn()` (used in middleware tests)

### Conversation Shape (for future Stories 2.4, 2.7)

Document the conversation/message shapes now for reference (consumed by Stories 2.4 and 2.7):

```javascript
// Conversation shape — matches ArangoDB 'conversations' collection
{
  _key: 'conv-123',
  _id: 'conversations/conv-123',
  userId: 'user-123',           // References user._key
  title: 'Test Conversation',
  createdAt: '2026-05-13T10:00:00.000Z',
  updatedAt: '2026-05-13T10:00:00.000Z',
  messageCount: 2
}

// Message shape — matches ArangoDB 'messages' collection
{
  _key: 'msg-456',
  _id: 'messages/msg-456',
  conversationId: 'conv-123',   // References conversation._key
  role: 'user',                 // 'user' | 'assistant' | 'system'
  content: 'Hello, how are you?',
  createdAt: '2026-05-13T10:00:00.000Z'
}
```

### File Metadata Shape (for future Story 2.6)

```javascript
// File metadata — matches ArangoDB file collection
{
  _key: 'file-789',
  _id: 'files/file-789',
  filename: 'test-document.pdf',
  originalName: 'test-document.pdf',
  mimeType: 'application/pdf',
  size: 1024,
  uploadedBy: 'user-123',
  uploadedAt: '2026-05-13T10:00:00.000Z',
  status: 'ready',              // 'pending' | 'scanning' | 'ready' | 'infected'
  labels: []
}
```

### Files to Create

| File | Action | Description |
|------|--------|-------------|
| `__tests__/mocks/shared-lib.js` | NEW | Centralized shared-lib mock with all 4 exports |
| `__tests__/fixtures/users.js` | NEW | `createMockUser()`, `createMockAdmin()` factories |
| `__tests__/fixtures/tokens.js` | NEW | `createValidToken()`, `createExpiredToken()` JWT helpers |
| `__tests__/fixtures/requests.js` | NEW | `createMockReq()`, `createMockRes()`, `createMockNext()` helpers |
| `__tests__/fixtures/fixtures.test.js` | NEW | Self-tests for all fixture modules (AC9) |

### Files NOT Modified

All 9 existing test files remain unchanged. The new fixture files are purely additive.

### Anti-Patterns to Avoid

- Do NOT use ES `import`/`export` — CommonJS only (`require`/`module.exports`)
- Do NOT modify any existing test file — all tests pass unchanged
- Do NOT create `__mocks__/shared-lib.js` (Jest auto-mock directory) — use `__tests__/mocks/shared-lib.js` instead, imported explicitly via `jest.mock('../shared-lib', () => require('./__tests__/mocks/shared-lib'))`. Reason: Jest auto-mocks are global and would affect existing tests that define their own inline mocks.
- Do NOT add `jest-junit` configuration — that's Story 1.1
- Do NOT add conversation/file factories to this story — those belong in Stories 2.4 and 2.6 respectively. Only the SHAPE is documented here as the source of truth.
- Do NOT use `ioredis-mock` or `fakeredis` in this story — those are for Stories 2.7/2.8 service tests
- Do NOT put `process.env` overrides in fixture files — each test file controls its own env

### Project Structure Notes

- Backend files live at `components/gov-chat-backend/` root — no `src/` subdirectory
- Test files go in `__tests__/` at component root
- Mock fixtures go in `__tests__/mocks/` (new directory — `createApp.test.js` uses inline mocks)
- Data fixtures go in `__tests__/fixtures/` (new directory)
- CommonJS (`require`/`module.exports`) everywhere in backend
- Jest config is in `package.json` (not a separate file): `testMatch: ["**/__tests__/**/*.test.js"]`

### Downstream Impact

This story **unblocks** Stories 2.3–2.8 (all backend route/service/middleware tests). Those stories will:
- Import `createValidToken` for Supertest auth headers
- Import `createMockReq`/`createMockRes` for unit-level handler tests
- Import `createMockUser` for constructing request user objects
- Import centralized shared-lib mock instead of defining inline

Story 2.3 (auth route handlers) will be the first consumer of these fixtures via Supertest.

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.2] — Story definition and acceptance criteria
- [Source: _bmad-output/planning-artifacts/architecture.md#Mock & Fixture Architecture] — Mock patterns, factory pattern, centralized locations
- [Source: _bmad-output/planning-artifacts/architecture.md#Test Data Management] — Fixture locations and formats
- [Source: _bmad-output/planning-artifacts/architecture.md#Test Structure Patterns] — AAA structure, mock factory pattern
- [Source: _bmad-output/implementation-artifacts/2-1-refactor-backend-indexjs-to-export-createapp.md] — Previous story: shared-lib mock pattern (all 4 exports), createMockServices pattern, service mocking conventions
- [Source: _bmad-output/project-context.md#Testing Rules] — Jest conventions, CommonJS, mock patterns, fixture locations
- [Source: components/gov-chat-backend/__tests__/authController.test.js] — Existing createMockReq/createMockRes patterns
- [Source: components/gov-chat-backend/__tests__/createApp.test.js] — Comprehensive shared-lib mock (4 exports), service mocking patterns
- [Source: components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js] — Keycloak service mock patterns, token verification

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

### Change Log

### Review Findings
