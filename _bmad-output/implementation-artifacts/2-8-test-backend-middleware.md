# Story 2.8: Test Backend Middleware

Status: ready-for-dev

## Story

As a developer,
I want tests for middleware behavior,
So that authentication, authorization, rate limiting, and error handling work correctly.

## Acceptance Criteria

1. **AC1: Error classes tests** — `__tests__/middleware/errors.test.js` tests all custom error classes (`AppError`, `NotFoundError`, `ForbiddenError`, `ValidationError`) with correct status codes, default messages, custom messages, `instanceof` chains, and `name` property
2. **AC2: Security middleware tests** — `__tests__/middleware/security-middleware.test.js` tests sensitive path blocking (`.git`, `.env`, dotfiles, `BitKeeper`), timestamp formatting (recursive, 10-digit Unix timestamps, arrays, nested objects), CORS origin validation (allowlist, regex patterns, no-origin), and debug/IP logging middleware
3. **AC3: Error handler tests** — `__tests__/middleware/error-handler.test.js` tests global error handler (`AppError` subclasses with `statusCode`, generic errors as 500, development vs production error exposure), and 404 handler for unmatched routes
4. **AC4: Isolation** — middleware is tested in isolation with mock `req`/`res`/`next` objects (for inline middleware) or via `createApp()` + supertest (for registered middleware); all tests follow closure-based mock reference pattern
5. **AC5: Regression safety** — All existing tests (472+) continue to pass; new test files produce zero lint errors

## Tasks / Subtasks

- [ ] Task 1: Create `__tests__/middleware/` directory (AC: #1-#3)
- [ ] Task 2: Create `__tests__/middleware/errors.test.js` (AC: #1)
  - [ ] 2.1: Test AppError — sets message, statusCode, name
  - [ ] 2.2: Test NotFoundError — default message, custom message, statusCode 404
  - [ ] 2.3: Test ForbiddenError — default message, custom message, statusCode 403
  - [ ] 2.4: Test ValidationError — default message, custom message, statusCode 400
  - [ ] 2.5: Test instanceof chain — all errors are `instanceof Error` and `instanceof AppError`
- [ ] Task 3: Create `__tests__/middleware/security-middleware.test.js` (AC: #2)
  - [ ] 3.1: Test sensitive path blocking — `/.git`, `/.env`, `/BitKeeper`, `/.anything`, returns 404
  - [ ] 3.2: Test sensitive path passthrough — normal paths call `next()`
  - [ ] 3.3: Test sensitive path error handling — middleware error returns 500
  - [ ] 3.4: Test formatTimestamps — 10-digit Unix timestamps → ISO strings
  - [ ] 3.5: Test formatTimestamps with arrays — recursive array handling
  - [ ] 3.6: Test formatTimestamps with nested objects — deep recursive formatting
  - [ ] 3.7: Test formatTimestamps edge cases — non-timestamp numbers, null, primitives
  - [ ] 3.8: Test CORS origin validation — allowed origin, denied origin, no origin, regex patterns
  - [ ] 3.9: Test debug middleware — logs IP, headers, path, method
- [ ] Task 4: Create `__tests__/middleware/error-handler.test.js` (AC: #3)
  - [ ] 4.1: Test global error handler with AppError (statusCode) — returns correct status and message
  - [ ] 4.2: Test global error handler with generic Error — returns 500
  - [ ] 4.3: Test global error handler in development — exposes error message
  - [ ] 4.4: Test global error handler in production — hides error message
  - [ ] 4.5: Test 404 handler — returns 404 for unmatched routes
  - [ ] 4.6: Test error logging — verifies logger.error called with correct fields
- [ ] Task 5: Run full regression suite and lint (AC: #4, #5)
  - [ ] 5.1: `npm test` — all tests pass (existing 472+ new)
  - [ ] 5.2: `npm run lint` — zero errors

## Dev Notes

### What This Story Tests (and What It Doesn't)

**IN SCOPE — middleware defined in `index.js` `createApp()` (lines 505-805):**
- Sensitive path blocker (lines 542-567) — blocks `/.git`, `/.env`, dotfiles, `/BitKeeper`
- Timestamp formatter (lines 630-649) — `formatTimestamps()` recursively converts 10-digit Unix timestamps
- Global error handler (lines 775-794) — typed errors use `statusCode`, generic errors → 500
- 404 handler (lines 797-803) — catches unmatched routes
- CORS origin validation (lines 405-436) — allowlist + regex support
- Debug/IP logging middleware (lines 517-528)

**ALREADY TESTED — do NOT recreate:**
- `keycloak-auth-middleware.js` — comprehensive 720-line test file at `__tests__/keycloak-auth-middleware.test.js` (50+ tests)
- `keycloak-auth-service.test.js` — service-level tests
- `user-provisioning-service.test.js` — provisioning tests

**NOT IN SCOPE — third-party middleware (helmet, morgan, bodyParser, express.static):**
- These are well-tested libraries; testing them would be testing third-party code
- Only test OUR custom behavior that wraps or configures them (CORS options, CSP options)

**NOT IMPLEMENTED — rate limiting:**
- `express-rate-limit` v7.5.0 is in `package.json` but **never used** in the codebase
- The epics AC mentions "rate limiting" but there is nothing to test
- Document this as a finding; do NOT create tests for non-existent code

### Testing Strategy: Two Patterns

#### Pattern A: Isolated middleware with mock req/res/next

For inline middleware functions (sensitive path blocker, debug middleware, timestamp formatter):

```javascript
'use strict';

// 1. Mock shared-lib
jest.mock('../shared-lib', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  dbService: { getConnection: jest.fn() }
}), { virtual: true });

// 2. Import createApp to get the configured app
const { createApp } = require('../index');

// 3. Use supertest to test middleware behavior via HTTP requests
const request = require('supertest');

describe('sensitive path blocker', () => {
  let app;

  beforeEach(() => {
    app = createApp({ services: {} });
  });

  it('should return 404 for /.git/HEAD', async () => {
    const res = await request(app).get('/.git/HEAD');
    expect(res.status).toBe(404);
  });
});
```

**CRITICAL:** `createApp()` is exported from `index.js`. It creates a full Express app WITHOUT calling `app.listen()`. Use supertest `request(app)` for HTTP-level middleware testing. This is the same pattern used in stories 2.3-2.6.

#### Pattern B: Unit test with mock req/res/next

For the `formatTimestamps` pure function, you can import it directly if exported, or test it indirectly via supertest. Since `formatTimestamps` is NOT exported (it's a module-scoped function in `index.js`), test it via supertest by sending responses with timestamp fields.

For the error classes (`errors.js`), import directly:

```javascript
'use strict';

const { AppError, NotFoundError, ForbiddenError, ValidationError } = require('../middleware/errors');

describe('AppError', () => {
  it('should set message and statusCode', () => {
    const err = new AppError('test', 418);
    expect(err.message).toBe('test');
    expect(err.statusCode).toBe(418);
    expect(err.name).toBe('AppError');
    expect(err).toBeInstanceOf(Error);
  });
});
```

### `formatTimestamps` — The Hidden Pure Function

This function at `index.js:439-456` is NOT exported but is critical middleware logic. Test it via supertest by making requests that return JSON with 10-digit number fields:

```javascript
// The function converts 10-digit Unix timestamps to ISO strings
// Only matches EXACTLY 10 digits: /^\d{10}$/
// 13-digit millisecond timestamps are NOT converted (they're already > 10 digits)
// 9-digit timestamps are NOT converted (too short)
```

**Test approach:** Create a test endpoint via `createApp({ services: {} })` that returns JSON with known timestamp values, then verify the response has ISO-formatted dates. The simplest way: test against existing endpoints (e.g., `/api/health` returns `serverTime` but it's already a string). Better: test via the timestamp middleware directly by mocking `res.json`.

**Alternative approach** — Extract and test the function logic directly by creating a test helper:

```javascript
// Since formatTimestamps is not exported, test its behavior via a route handler
// that returns raw timestamp data through the middleware pipeline
function formatTimestamps(obj) {
  if (Array.isArray(obj)) return obj.map((item) => formatTimestamps(item));
  if (obj === null || typeof obj !== 'object') return obj;
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (typeof obj[key] === 'number' && /^\d{10}$/.test(obj[key].toString())) {
        obj[key] = new Date(obj[key] * 1000).toISOString();
      } else if (typeof obj[key] === 'object') {
        obj[key] = formatTimestamps(obj[key]);
      }
    }
  }
  return obj;
}
```

Copy the function into the test file to test its logic directly. This is acceptable since the function is not exported and testing via HTTP is indirect.

### Error Handler — Known Bug

The global error handler at `index.js:775` has only 3 parameters `(err, req, res)` instead of 4 `(err, req, res, next)`. Express treats 3-param functions as regular middleware, NOT error-handling middleware. **However**, Express still catches errors in routes and passes them to this handler because it's registered after all routes.

**For testing:** Test the actual behavior (3-param), not the Express specification (4-param). The handler works correctly despite the signature mismatch. Note this as a finding but do NOT fix it in this story (it's a potential separate bug fix).

### CORS Configuration Details

The CORS middleware at `index.js:405-436` uses a custom `origin` function:
- `CORS_ALLOWED_ORIGINS` env var → comma-separated allowlist
- No origin (Postman, server-to-server) → allowed
- Exact match against allowlist entries
- Regex support: entries wrapped in `/.../` are treated as regex patterns
- Credentials: always true
- Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS

**Testing CORS:**
```javascript
process.env.CORS_ALLOWED_ORIGINS = 'http://localhost:5173,http://example.com';

// Test allowed origin
const res = await request(app)
  .options('/api/health')
  .set('Origin', 'http://localhost:5173');
expect(res.status).toBe(204);
expect(res.headers['access-control-allow-origin']).toBe('http://localhost:5173');

// Test denied origin
const res2 = await request(app)
  .get('/api/health')
  .set('Origin', 'http://evil.com');
expect(res2.headers['access-control-allow-origin']).toBeUndefined();
```

### Mock Requirements

| Middleware | Mock shared-lib? | Mock other? | Test method |
|-----------|----------------|-------------|-------------|
| errors.js | No | None | Direct import, unit test |
| Sensitive path blocker | Yes (virtual) | None | supertest via createApp |
| Timestamp formatter | Yes (virtual) | None | supertest or copied function |
| CORS | Yes (virtual) | None | supertest via createApp |
| Debug middleware | Yes (virtual) | None | supertest via createApp |
| Error handler | Yes (virtual) | None | supertest via createApp |
| 404 handler | Yes (virtual) | None | supertest via createApp |

**IMPORTANT:** `createApp()` already requires shared-lib. When using `createApp()` for supertest tests, shared-lib must be mocked BEFORE requiring `index.js`. The `__tests__/mocks/shared-lib.js` setup file handles this for root-level tests. For `__tests__/middleware/` tests (one level deeper), mock path is `../../shared-lib`:

```javascript
jest.mock('../../shared-lib', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  dbService: { getConnection: jest.fn() },
  securityHeaders: (req, res, next) => next(),
  SecurityMiddleware: { applySecurityMiddleware: jest.fn() }
}), { virtual: true });
```

Note: `securityHeaders` and `SecurityMiddleware` must also be mocked since `createApp()` calls them at module level.

### createApp() Mock Requirements

`createApp()` at module level (lines 11-42) validates that `securityHeaders` and `SecurityMiddleware` exist from shared-lib. When mocking shared-lib, include these:

```javascript
jest.mock('../../shared-lib', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() },
  dbService: { getConnection: jest.fn() },
  securityHeaders: (req, res, next) => next(),  // middleware function
  SecurityMiddleware: { applySecurityMiddleware: jest.fn() }
}), { virtual: true });
```

Also mock `swagger-jsdoc` and `swagger-ui-express` since they execute at module level:

```javascript
jest.mock('swagger-jsdoc', () => jest.fn().mockReturnValue({}));
jest.mock('swagger-ui-express', () => ({
  serve: jest.fn((req, res, next) => next()),
  setup: jest.fn().mockReturnValue((req, res, next) => next())
}));
```

### Existing Fixtures to Reuse

- `__tests__/fixtures/tokens.js` → `createValidToken()` for authenticated requests
- `__tests__/fixtures/requests.js` → `createMockReq()`, `createMockRes()`, `createMockNext()` (for unit-level middleware tests)

### Key Learnings from Stories 2.1-2.7

1. **shared-lib is virtual** — must mock with `{ virtual: true }`, path relative from test file
2. **`createApp()` accepts `{ services: {} }`** — pass empty object when no services needed
3. **Error handler bug** in index.js line 775 has 3 params (not 4) — test actual behavior, not Express spec
4. **CommonJS only** — never use ES imports in backend tests
5. **Lint strictly** — all test code must pass ESLint (2-space indent, single quotes, semicolons)
6. **Two error response patterns** in backend: thrown errors vs returned error objects
7. **Services are class instances exported as singletons** — use `jest.isolateModules()` to reset between tests
8. **dotenv must be mocked** if any code path calls `require('dotenv').config()`

### Project Structure Notes

- Test directory: `components/gov-chat-backend/__tests__/middleware/` (NEW — must create)
- Middleware sources: `components/gov-chat-backend/middleware/` (errors.js, keycloak-auth-middleware.js)
- Inline middleware: `components/gov-chat-backend/index.js` (lines 505-805)
- Shared lib: `components/gov-chat-backend/shared-lib` (virtual module)
- CommonJS: `require()` / `module.exports` only — NEVER ES imports

### References

- [Source: components/gov-chat-backend/middleware/errors.js] — 33 lines, 4 error classes
- [Source: components/gov-chat-backend/middleware/keycloak-auth-middleware.js] — already tested, 720-line test file
- [Source: components/gov-chat-backend/index.js:439-456] — `formatTimestamps()` pure function
- [Source: components/gov-chat-backend/index.js:505-805] — `createApp()` with all middleware registration
- [Source: components/gov-chat-backend/index.js:542-567] — sensitive path blocker
- [Source: components/gov-chat-backend/index.js:575-598] — helmet middleware configuration
- [Source: components/gov-chat-backend/index.js:601-610] — CORS middleware configuration
- [Source: components/gov-chat-backend/index.js:775-794] — global error handler (3-param bug)
- [Source: components/gov-chat-backend/index.js:797-803] — 404 handler
- [Source: components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js] — reference pattern for middleware tests
- [Source: _bmad-output/implementation-artifacts/2-7-test-backend-service-layer.md] — previous story learnings
- [Source: _bmad-output/project-context.md] — project conventions and anti-patterns

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
