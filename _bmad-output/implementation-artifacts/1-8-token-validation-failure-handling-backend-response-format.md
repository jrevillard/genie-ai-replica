# Story 1.8: Token Validation Failure Handling (Backend Response Format)

Status: done

## Story

As a backend developer,
I want the auth middleware to return a standardized error response format for token validation failures,
so that the frontend can consistently parse and display authentication errors.

## Acceptance Criteria

1. **Standardized Error Response Format (FR29)**
   - Given a request is made with an invalid, expired, or malformed token
   - When the backend middleware validates the token
   - Then the response follows the standardized format `{ error: "ERROR_CODE", message: "...", details: {} }` (FR29)

2. **Expired Token Returns TOKEN_EXPIRED**
   - Given a request with a validly signed but expired JWT
   - When the backend middleware validates the token
   - Then the response is HTTP 401 with `{ error: "TOKEN_EXPIRED", message: "Token has expired", details: {} }`

3. **Malformed Token Returns TOKEN_INVALID**
   - Given a request with a malformed JWT (not 3 parts, invalid base64, missing claims)
   - When the backend middleware validates the token
   - Then the response is HTTP 401 with `{ error: "TOKEN_INVALID", message: "...", details: {} }`

4. **Revoked Token Returns TOKEN_INVALID**
   - Given a request with a token that was validly signed but whose signature no longer matches JWKS (revoked key rotation scenario)
   - When the backend middleware validates the token
   - Then the response is HTTP 401 with `{ error: "TOKEN_INVALID", message: "...", details: {} }`

5. **No Internal Details Exposed**
   - Given any token validation failure
   - When the backend returns an error response
   - Then the response does not expose internal implementation details — no stack traces, no token payloads, no Keycloak URLs, no client IDs in the message field
   - And only the predefined human-readable message is returned (never `err.message` from internal exceptions)

## Tasks / Subtasks

- [x] Task 1: Sanitize error messages in keycloak-auth-service.js (AC: #2, #3, #4, #5)
  - [x] In `verifyToken()`, replace issuer validation message at line 73 that exposes `payload.iss` with a generic message: "Token issuer validation failed" (note: `expectedOrigin` is not in the message — only `payload.iss` is exposed)
  - [x] In `verifyToken()`, replace audience mismatch message that exposes `KEYCLOAK_CLIENT_ID` and `verifiedPayload.aud` with a generic message: "Token audience validation failed"
  - [x] Ensure all `TokenVerificationError` messages are human-readable and contain no internal details (Keycloak URLs, client IDs, token claims)
  - [x] Verify `TokenVerificationError` class is not modified (already has proper structure with code, message, details)

- [x] Task 2: Sanitize error responses in keycloak-auth-middleware.js (AC: #1, #5)
  - [x] On TOKEN_EXPIRED error (line 111-117): replace `err.message` at line 114 with hardcoded string `'Token has expired'` — do NOT forward the raw error message (current behavior is correct by coincidence — this fix ensures it remains correct regardless of future service changes)
  - [x] On TOKEN_INVALID error (line 119-123): replace `err.message || 'Token verification failed'` at line 121 with hardcoded string `'Token verification failed'` — do NOT forward the raw error message
  - [x] Verify all other error responses already use hardcoded messages (TOKEN_INVALID for missing header, PROVISIONING_FAILED, FORBIDDEN, INTERNAL_ERROR)
  - [x] Ensure `details: {}` remains empty for all responses (per architecture spec)

- [x] Task 3: Update existing middleware tests for sanitized messages (AC: #1, #2, #3, #5)
  - [x] Update test "should return 401 TOKEN_INVALID when token verification fails" (line 157-172) to expect hardcoded message `'Token verification failed'` instead of `err.message`
  - [x] Strengthen existing test "should return 401 TOKEN_EXPIRED when token is expired" (line 140-155): change the mock error message from `'Token has expired'` to `'some-internal-detail-exposed'` to verify the middleware truly replaces `err.message` with the hardcoded string (not just forwarding it by coincidence)
  - [x] Add test: TOKEN_INVALID error with a `TokenVerificationError` that has internal details in its message — verify only generic message is returned
  - [x] Add test: TOKEN_EXPIRED error with a `TokenVerificationError` — verify only `'Token has expired'` message is returned
  - [x] Add test: unknown error type in verification (non-TokenVerificationError) — verify response is TOKEN_INVALID with generic message
  - [x] Verify all existing tests still pass after message sanitization changes

- [x] Task 4: Extend existing keycloak-auth-service.test.js with sanitized message verification (AC: #2, #3, #4, #5)
  - [x] **IMPORTANT**: This file already exists with 237 lines of tests — do NOT remove or duplicate existing tests. Only ADD new message content assertions and UPDATE existing ones where needed.
  - [x] Update existing audience mismatch test to verify the error message does NOT contain `KEYCLOAK_CLIENT_ID` or `aud` values (currently only checks `code`, not message content)
  - [x] Update existing issuer validation test to verify the error message does NOT contain Keycloak URLs
  - [x] Add test: issuer mismatch throws TokenVerificationError with generic message "Token issuer validation failed" (no Keycloak URL)
  - [x] Add test: audience mismatch throws TokenVerificationError with generic message "Token audience validation failed" (no client ID)
  - [x] Add test: jwtVerify signature failure (revoked token scenario, AC #4) returns TOKEN_INVALID with generic message
  - [x] Verify existing tests for malformed JWT, missing claims, expired token, empty/null token still pass with sanitized messages
  - [x] Use shared mock fixture from `__tests__/mocks/mockJwtPayload.js`

- [x] Task 5: Run full test suite and verify (AC: all)
  - [x] Run `cd components/gov-chat-backend && npx jest --verbose`
  - [x] Verify all existing tests still pass (no regressions)
  - [x] Verify all new tests pass
  - [x] Run frontend tests to confirm no cross-component breakage: `cd components/gov-chat-frontend && npx jest`

## Dev Notes

### Architecture Compliance

**Error Response Format (from architecture.md):**
```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description",
  "details": {}
}
```

**Error Codes (from architecture.md):**

| HTTP | Code | Meaning |
|---|---|---|
| 401 | `TOKEN_INVALID` | Malformed or invalid token signature |
| 401 | `TOKEN_EXPIRED` | Token expiration claim exceeded |
| 403 | `INSUFFICIENT_ROLES` | Valid token but missing required role |
| 500 | `PROVISIONING_FAILED` | Valid token but ArangoDB JIT provisioning failed |
| 503 | `AUTH_SERVICE_UNAVAILABLE` | Keycloak unreachable |

**IMPORTANT — `FORBIDDEN` vs `INSUFFICIENT_ROLES`:**
The current code uses `FORBIDDEN` (403) for soft-deleted users. The architecture spec defines `INSUFFICIENT_ROLES` (403) for missing roles. These are **different scenarios**:
- Soft-deleted user → should remain `FORBIDDEN` (account deactivated, not a role issue)
- Missing required role → should use `INSUFFICIENT_ROLES` (deferred to Story 2.x — role-based access control)
- **This story does NOT change the 403 codes** — it only sanitizes the 401 error messages

### Current Code Issues (What This Story Fixes)

**Issue 1: Internal details exposed in middleware error responses**
- `keycloak-auth-middleware.js:114` — `TOKEN_EXPIRED` forwards `err.message` which could contain internal info
- `keycloak-auth-middleware.js:121` — `TOKEN_INVALID` forwards `err.message || 'Token verification failed'` which leaks internal error details
- Fix: Replace with hardcoded human-readable strings

**Issue 2: Internal details exposed in service error messages**
- `keycloak-auth-service.js:73` — issuer validation error exposes `payload.iss` (Keycloak URL)
- `keycloak-auth-service.js:95` — audience mismatch error exposes `KEYCLOAK_CLIENT_ID` and `verifiedPayload.aud`
- Fix: Replace with generic messages like "Token issuer validation failed" and "Token audience validation failed"

**Issue 3: `TokenVerificationError` class is fine as-is**
- The class has proper structure: `code`, `message`, `details`
- The `details` field defaults to `{}` and is never populated with sensitive data
- No changes needed to the class itself

### What This Story Does NOT Change

- **No new error codes** — all error codes already exist in the current code
- **No new middleware** — only sanitization of existing error responses
- **No 403 code changes** — `FORBIDDEN` for soft-deleted users stays as-is; `INSUFFICIENT_ROLES` for role-based access is deferred to Story 2.x
- **No frontend changes** — this story is backend-only
- **No `details: {}` population** — the architecture spec shows `details: {}` as empty; populating it is not required
- **No JWKS caching changes** — deferred to Story 2.2
- **No revoked token detection** — JWKS-based revocation is handled by signature mismatch → `TOKEN_INVALID`, which already works

### Key Technical Details

**Current `keycloak-auth-middleware.js` (141 lines):**
- `authenticate()` method at line 63
- Error handling has 3 nested try/catch blocks:
  1. Outer: catches unexpected errors → 500 `INTERNAL_ERROR`
  2. Middle: token extraction → 401 `TOKEN_INVALID` (missing header)
  3. Inner: `verifyToken()` call → 401 `TOKEN_EXPIRED` or `TOKEN_INVALID`
- Lines 110-124: The inner catch that needs message sanitization

**Current `keycloak-auth-service.js` (139 lines):**
- `verifyToken()` method at line 35
- `TokenVerificationError` class at line 13
- Error messages at lines 37, 43, 51, 55, 59, 65, 73, 95
- Lines 73 and 95 expose internal details that need sanitization

**Current test file `keycloak-auth-service.test.js` (237 lines, ALREADY EXISTS):**
- Existing tests cover: token structure, claims validation, expiration, audience, JWKS verification, TokenVerificationError class
- Tests use `expect.toMatchObject({ code: 'TOKEN_INVALID' })` — check error code but NOT message content
- After sanitization, existing tests should still pass (they don't assert on message text), but need new assertions to verify no sensitive data in messages

**Current test file `keycloak-auth-middleware.test.js` (339 lines):**
- 14 existing tests
- Uses `jest.mock()` for services and shared-lib
- Tests cover: public routes, missing header, empty token, expired token, verification failure, successful auth, soft-deleted user, provisioning failure
- Test on line 157-172 uses `expect.objectContaining` for TOKEN_INVALID — needs update to check exact message

### Files to Modify

| File | Change |
|------|--------|
| `components/gov-chat-backend/services/keycloak-auth-service.js` | Sanitize error messages — remove Keycloak URLs, client IDs, token claims from messages |
| `components/gov-chat-backend/middleware/keycloak-auth-middleware.js` | Replace `err.message` forwarding with hardcoded strings in error responses |
| `components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js` | Update existing tests for sanitized messages, add new tests for message sanitization |
| `components/gov-chat-backend/__tests__/keycloak-auth-service.test.js` | Extend existing test file — add/update message sanitization assertions (do NOT remove existing tests) |

### Files NOT Modified

| File | Reason |
|------|--------|
| `components/gov-chat-backend/__tests__/mocks/mockJwtPayload.js` | Shared fixture — no changes needed |
| `components/gov-chat-backend/services/user-provisioning-service.js` | Not related to token validation error handling |
| `components/gov-chat-frontend/**` | This story is backend-only |
| `components/gov-chat-backend/routes/**` | No route changes — error format change is transparent to routes |
| `components/gov-chat-backend/config.js` | No config changes needed |

### Previous Story Intelligence (Story 1-7)

**Key patterns from Story 1-7:**
- Story 1-7 was frontend-only (transparent re-authentication on session expiry)
- No backend changes in 1-7 — the backend state is exactly as left by Story 1-6
- Story 1-6 was backend-only (JIT provisioning with ArangoDB UPSERT)
- Story 1-3 created the keycloak-auth-middleware.js and keycloak-auth-service.js — these are the files to modify

**Lessons from code reviews (all stories):**
- Backend uses CommonJS — `require()`/`module.exports`
- `jest.mock()` at module level for service dependencies
- Shared mock fixture at `__tests__/mocks/mockJwtPayload.js`
- `TokenVerificationError` is thrown with `.code` property — middleware checks `err.code === 'TOKEN_EXPIRED'`
- Tests use `expect.objectContaining()` for partial JSON match when message may vary — should switch to exact match after sanitization

### Backend Conventions (from project-context.md)

- **CommonJS only**: `const x = require('x')` and `module.exports = { ... }`
- Never use `import`/`export` syntax
- `const` by default, `let` for reassignments, never `var`
- 2-space indentation, single quotes, semicolons
- Error handling: `try/catch` in route handlers
- Logging: `{ logger }` from `../shared-lib`
- Testing: Jest, `__tests__/` directory, `*.test.js`, `describe/it/expect`, `jest.mock()`

### Testing Strategy

**Middleware tests (update existing + add new):**
- Update test line 157-172: change from `expect.objectContaining` to exact match with hardcoded message
- Add test for `TokenVerificationError` with internal details → verify only generic message returned
- Add test for `TOKEN_EXPIRED` → verify exactly `'Token has expired'` message
- Add test for unknown error type → verify TOKEN_INVALID with `'Token verification failed'`

**Service tests (extend existing file):**
- Mock `jose` library (`jwtVerify`, `createRemoteJWKS`)
- Mock `KEYCLOAK_URL` and `KEYCLOAK_CLIENT_ID` env vars
- Test each error path in `verifyToken()` with focus on message content
- Verify no internal details (URLs, IDs, claims) appear in error messages
- Use shared `mockJwtPayload.js` fixture

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Auth Error Response] — Standardized error format definition
- [Source: _bmad-output/planning-artifacts/architecture.md#Error Codes] — Error code table (TOKEN_INVALID, TOKEN_EXPIRED, etc.)
- [Source: _bmad-output/planning-artifacts/architecture.md#Enforcement Guidelines] — "Use the standardized auth error response format with error codes"
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.8] — BDD acceptance criteria
- [Source: _bmad-output/planning-artifacts/prd.md#FR29] — "handles token validation failures gracefully"
- [Source: _bmad-output/project-context.md] — Backend conventions (CommonJS, Jest, naming)
- [Source: components/gov-chat-backend/middleware/keycloak-auth-middleware.js] — Current middleware to sanitize
- [Source: components/gov-chat-backend/services/keycloak-auth-service.js] — Current service to sanitize
- [Source: components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js] — Current tests to update
- [Source: components/gov-chat-backend/__tests__/mocks/mockJwtPayload.js] — Shared test fixture

## Dev Agent Record

### Agent Model Used

GLM-5-Turbo

### Debug Log References

### Completion Notes List

- Sanitized issuer validation error message: replaced `Token issuer not from trusted Keycloak: ${payload.iss}` with generic `Token issuer validation failed` (keycloak-auth-service.js)
- Sanitized audience mismatch error message: replaced `Token audience mismatch: expected ${KEYCLOAK_CLIENT_ID}, got ${JSON.stringify(verifiedPayload.aud)}` with generic `Token audience validation failed` (keycloak-auth-service.js)
- Hardcoded TOKEN_EXPIRED response message to `'Token has expired'` in middleware (was forwarding `err.message`)
- Hardcoded TOKEN_INVALID response message to `'Token verification failed'` in middleware (was forwarding `err.message || 'Token verification failed'`)
- Updated 2 existing middleware tests and added 3 new middleware tests for message sanitization
- Updated 2 existing service tests and added 3 new service tests for message content verification
- All 56 backend tests pass, all 86 frontend tests pass — zero regressions

### File List

- `components/gov-chat-backend/services/keycloak-auth-service.js` (modified)
- `components/gov-chat-backend/middleware/keycloak-auth-middleware.js` (modified)
- `components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js` (modified)
- `components/gov-chat-backend/__tests__/keycloak-auth-service.test.js` (modified)

## Change Log

- 2026-04-01: Implemented token validation failure handling — sanitized all error messages in service and middleware to prevent internal detail exposure. Added 6 new tests, updated 4 existing tests. All 142 tests pass (56 backend + 86 frontend).
