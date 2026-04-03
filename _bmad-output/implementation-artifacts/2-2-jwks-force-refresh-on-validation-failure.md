# Story 2.2: JWKS Force-Refresh on Validation Failure

Status: done

## Story

As a backend system,
I want to force-refresh the JWKS cache when token validation fails with a valid expiration,
So that token validation is resilient to Keycloak key rotation without user disruption.

## Acceptance Criteria

1. **Given** the backend is validating tokens from one or more Keycloak issuers
   **When** a token is validated
   **Then** the JWKS public keys for the token's `iss` are cached in a Map keyed by `{iss}` with a 5-minute TTL (NFR10)

2. **Given** the JWKS cache for an issuer is populated
   **When** a subsequent token from the same issuer is validated before TTL expires
   **Then** cached keys are reused — no HTTP request to the JWKS endpoint

3. **Given** a token validation fails (signature mismatch / unknown `kid`)
   **When** the token's `exp` claim is still valid (not expired)
   **Then** the JWKS cache for that issuer is force-refreshed and validation is retried once (two-attempt pattern)

4. **Given** the JWKS cache was force-refreshed
   **When** the retry validation also fails
   **Then** the request is rejected with 401 `TOKEN_INVALID`

5. **Given** a token validation fails
   **When** the token's `exp` claim is expired
   **Then** the request is rejected with 401 `TOKEN_EXPIRED` immediately — no JWKS refresh is attempted

6. **Given** multiple Keycloak issuers are configured
   **When** tokens from different issuers are validated
   **Then** each issuer maintains its own JWKS cache independently (FR5)

## Tasks / Subtasks

- [x] Task 1: Implement explicit JWKS TTL wrapper (AC: #1, #2, #6)
  - [x] 1.1 Create a `createJwksCache()` factory function that wraps jose's `createRemoteJWKSet()` with an explicit 5-minute TTL
    - CRITICAL: jose's `jwtVerify(token, jwks, options)` calls `jwks` as a function with signature `(protectedHeader, token)` — NOT `jwks.verify(token, options)`. The wrapper MUST be a callable function, not a class with a `verify` method. Use a **closure-based factory** that returns a function with attached methods.
    - The wrapper MUST store both the `createRemoteJWKSet()` result AND the JWKS URI (from `doc.jwks_uri` in OIDC discovery) so that `forceRefresh()` can re-call `createRemoteJWKSet()` with the correct URI
    - Factory: `createJwksCache(jwksUri, ttlMs = 300000)` returns a callable `jwksFn` with attached `.forceRefresh()` and `._isExpired()` methods
    - Internal state: `_inner` (the jose JWKS function), `_jwksUri` (for re-fetch), `_createdAt` (for TTL check)
    - On each call, check TTL: if expired, re-call `createRemoteJWKSet()` before delegating
    - Example skeleton:
      ```js
      function createJwksCache(jwksUri, ttlMs = 300000) {
        let inner = createRemoteJWKSet(new URL(jwksUri));
        let createdAt = Date.now();

        async function jwksFn(protectedHeader, token) {
          if (Date.now() - createdAt > ttlMs) {
            inner = createRemoteJWKSet(new URL(jwksUri));
            createdAt = Date.now();
          }
          return inner(protectedHeader, token);
        }

        jwksFn.forceRefresh = function () {
          createdAt = 0; // triggers re-fetch on next call
        };

        jwksFn._isExpired = function () {
          return Date.now() - createdAt > ttlMs;
        };

        return jwksFn;
      }
      ```
  - [x] 1.2 Replace direct `createRemoteJWKSet()` usage in `init()` with the TTL wrapper
    - Current code (line 63): `const jwks = createRemoteJWKSet(new URL(doc.jwks_uri));`
    - New code: `const jwks = createJwksCache(doc.jwks_uri); issuerMap.set(doc.issuer, jwks);`
  - [x] 1.3 The `forceRefresh()` method is attached to the returned `jwksFn` — call it via `issuerMap.get(iss).forceRefresh()` in `verifyToken` when a retry is needed
  - [x] 1.4 Ensure TTL is tracked per-issuer in the existing `issuerMap` (value changes from raw JWKS function to `createJwksCache` result — a callable with attached methods)
  - [x] 1.5 Update `_resetForTesting()` — no change needed. Existing code already calls `issuerMap.clear()` which is sufficient since the cache functions will be garbage collected

- [x] Task 2: Implement two-attempt force-refresh in `verifyToken` (AC: #3, #4, #5)
  - [x] 2.1 In `verifyToken`, catch `jwtVerify` failures and distinguish between signature errors (force-refresh candidate) and expiration errors (no refresh)
    - jose v6 error types: `JWTExpired` → immediate `TOKEN_EXPIRED`; generic `Error` (signature mismatch) → force-refresh candidate; `JWTClaimValidationFailed` → `TOKEN_INVALID` (claim issues like `iss`/`aud` mismatch are NOT key rotation problems)
    - NOTE: jose v6 throws `JWTExpired` specifically for `exp` claims. `JWTClaimValidationFailed` for `exp` is NOT expected — jose uses the dedicated `JWTExpired` class
    - CRITICAL: jose checks signature BEFORE claims. When a signature error occurs, `exp` was never checked by jose. To decide whether to force-refresh, the developer must manually check `exp` from the unverified JWT payload (already decoded at lines 141-147 for `iss` lookup). If `payload.exp < Date.now() / 1000`, skip refresh and reject with `TOKEN_EXPIRED`. The unverified payload extraction already exists in the code — just add an `exp` check alongside the `iss` extraction
  - [x] 2.2 On signature failure with valid `exp`: call `jwks.forceRefresh()` (where `jwks = issuerMap.get(iss)`) then retry `jwtVerify` once
  - [x] 2.3 On retry failure: reject with 401 `TOKEN_INVALID`
  - [x] 2.4 On expired token (`JWTExpired`): reject immediately with 401 `TOKEN_EXPIRED` — no refresh attempt
  - [x] 2.5 Ensure the retry does not create infinite loops (max 2 attempts total)
  - [x] 2.6 If `forceRefresh` itself fails (network error, DNS), also reject with 401 `TOKEN_INVALID` — any error during refresh is treated as a failed retry

- [x] Task 3: Add unit tests (AC: all)
  - [x] 3.1 Test: cached JWKS is reused within TTL (no re-fetch)
  - [x] 3.2 Test: cached JWKS expires after 5 minutes and re-fetches
  - [x] 3.3 Test: signature failure with valid `exp` triggers force-refresh and retry
  - [x] 3.4 Test: signature failure retry also fails → `TOKEN_INVALID`
  - [x] 3.5 Test: signature failure retry succeeds → token accepted
  - [x] 3.6 Test: expired token → `TOKEN_EXPIRED` (no refresh attempt)
  - [x] 3.7 Test: multi-issuer cache isolation (each issuer cached independently)
  - [x] 3.8 Test: `forceRefresh` only clears cache for the target issuer, not others

## Dev Notes

### Architecture Context (Decision D3)

This story implements the two-attempt force-refresh pattern from Decision D3 in the architecture document. The existing `keycloak-auth-service.js` already has:
- **Lazy singleton** OIDC discovery with 30s retry cooldown (`ensureInitialized()`)
- **Issuer whitelist** via `issuerMap` (Map keyed by `{iss}`)
- **jose `createRemoteJWKSet()`** for JWKS resolution
- **Multi-issuer support** via `init(url)` callable multiple times

**What this story adds:** The force-refresh logic when `jwtVerify` fails. Currently, a signature failure immediately returns `TOKEN_INVALID` — there is no retry mechanism.

### Critical Implementation Detail: jose `createRemoteJWKSet()` Caching

jose's `createRemoteJWKSet()` has **built-in HTTP caching** based on `Cache-Control` / `JWKS-TTL` headers from the JWKS response. However, **Keycloak 26.x may not always return explicit cache headers**. In that case, jose may refetch JWKS on every verification call.

**Solution (from architecture D3 caching note):** Implement an explicit TTL wrapper around `createRemoteJWKSet()` with a 5-minute TTL. This ensures consistent caching behavior regardless of Keycloak's cache headers. The wrapper should:
1. Store the `createRemoteJWKSet()` result alongside a `createdAt` timestamp
2. On JWKS function call, check if `Date.now() - createdAt > TTL`
3. If expired, re-call `createRemoteJWKSet()` with the stored JWKS URI
4. The `forceRefresh` method resets `createdAt` to 0, triggering immediate re-fetch on next use

### Exact Force-Refresh Flow (from Architecture — MUST follow)

```
1. Verify token with cached JWKS → fail
2. Check if token `exp` is still valid (not expired)
3. If yes → force-refresh JWKS for this issuer → re-verify → if fail again, 401 TOKEN_INVALID
4. If no (token expired) → 401 TOKEN_EXPIRED immediately (no refresh)
```

### jose v6.2.2 API Reference

- `const { jwtVerify, createRemoteJWKSet } = require('jose')` — CommonJS import (already in codebase)
- `createRemoteJWKSet(new URL(jwksUri))` — returns a JWKS verification function
- `jwtVerify(token, jwksFunction, options)` — verifies JWT; throws `JWTExpired`, `JWTClaimValidationFailed`, or generic `Error` for signature failures
- Error `name` field: `JWTExpired` for expiration, `JWTClaimValidationFailed` for claim issues, generic `Error` for signature mismatch
- jose v6.x uses Node.js native `crypto` module — no additional dependencies needed

### Existing Code Analysis

**File:** `components/gov-chat-backend/services/keycloak-auth-service.js`

The current `verifyToken` method (lines 120-199) has this flow:
1. Token format validation (lines 121-127)
2. `ensureInitialized()` call (lines 129-137)
3. Unverified `iss` extraction for whitelist lookup (lines 140-147)
4. `issuerMap.get(unverifiedIss)` lookup (lines 149-152)
5. `jwtVerify(token, jwks, options)` call (lines 154-159)
6. `azp` validation (lines 161-166)
7. Error handling: `JWTExpired` → `TOKEN_EXPIRED`, `JWTClaimValidationFailed` → various `TOKEN_INVALID`, generic → `TOKEN_INVALID` (lines 177-198)

**Key change point:** Step 5-7 needs the two-attempt logic. The `jwks` variable (line 155) is currently the raw `createRemoteJWKSet()` result. After this story, it will be a `createJwksCache()` result (a callable function with attached `.forceRefresh()` method).

### Testing Patterns

**Existing mock setup (from `keycloak-auth-service.test.js`):**
- `jest.mock('jose')` — full mock of jose module
- `mockJwtVerify` — controls `jwtVerify` return value
- `mockCreateRemoteJWKSet` — controls `createRemoteJWKSet` return value (returns a jest.fn())
- `mockFetch` — controls global `fetch` for OIDC discovery
- Shared fixtures from `__tests__/mocks/mockJwtPayload.js`:
  - `mockJwtPayload` — valid payload with `exp` in the future
  - `mockExpiredPayload` — payload with `exp` in the past
  - `generateMockJwtString(payload)` — creates a 3-part mock JWT string
- `_resetForTesting()` called in `beforeEach`

**For this story's tests:**
- Simulate signature failure: `mockJwtVerify.mockRejectedValue(new Error('...'))` on first call, then `mockResolvedValue(...)` on second call
- Simulate TTL expiry: mock `Date.now()` with `jest.spyOn(Date, 'now')`
- The `forceRefresh` method will need the JWKS URI — stored in the `createJwksCache` closure alongside the JWKS function
- **CRITICAL (Story 1-9 lesson):** When declaring mock variable references for jest.mock, you MUST use `var` NOT `let` — this is due to jest.mock hoisting and TDZ (Temporal Dead Zone). Using `let` will cause `ReferenceError: Cannot access 'X' before initialization` errors. This exact issue caused test failures in Story 1-9

### Project Structure Notes

- Backend uses **CommonJS only** (`require`/`module.exports`) — no ES imports
- 2-space indentation, single quotes, mandatory semicolons
- Test files in `__tests__/` directory at service root
- Mock fixtures in `__tests__/mocks/`
- Logger imported from `../shared-lib` (already mocked in tests)
- `TokenVerificationError` class already defined in the service — reuse for all error types

### Worktree Assignment

This story will be implemented in the `epic2-backend` worktree.

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Decision D3 — JWKS resolution and caching strategy]
- [Source: _bmad-output/planning-artifacts/architecture.md#Process Patterns — JWKS Force-Refresh]
- [Source: _bmad-output/planning-artifacts/architecture.md#Auth Middleware Flow (step 5)]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation status (as of Story 1.9)]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.2]
- [Source: _bmad-output/project-context.md#Backend (Node.js) — Testing Rules]
- [Source: components/gov-chat-backend/services/keycloak-auth-service.js — existing implementation]
- [Source: components/gov-chat-backend/__tests__/keycloak-auth-service.test.js — existing test patterns]
- [Source: components/gov-chat-backend/__tests__/mocks/mockJwtPayload.js — shared mock fixture]

## Dev Agent Record

### Agent Model Used
- claude-opus-4-6 (Claude 4.6 Opus)

### Debug Log References
- No debug logs required for this story

### Completion Notes List

#### Implementation Summary
1. **createJwksCache() factory function** implemented with:
   - Closure-based pattern storing `_inner`, `_jwksUri`, `_createdAt`
   - TTL check on each call (5 minutes default)
   - `.forceRefresh()` method for immediate re-fetch
   - `._isExpired()` method for testing
   - Compatible with jose's `jwtVerify(token, jwksFunction, options)` signature

2. **Two-attempt force-refresh pattern** in `verifyToken()`:
   - Extracts `exp` from unverified payload for expiration check
   - Signature failure with valid `exp` → force-refresh + retry
   - Expired token → immediate `TOKEN_EXPIRED` (no refresh)
   - Claim validation errors → `TOKEN_INVALID` (no refresh)
   - Max 2 attempts total (prevents infinite loops)

3. **Unit tests** added for:
   - Cache reuse within TTL (via verifyToken integration)
   - Cache expiry after 5 minutes (via createJwksCache direct test)
   - Force-refresh on signature failure with valid exp
   - Retry failure → `TOKEN_INVALID`
   - Retry success → token accepted
   - Expired token → `TOKEN_EXPIRED` (no refresh)
   - Multi-issuer cache isolation
   - Claim validation errors don't trigger refresh
   - Force-refresh method triggers re-fetch on next call

**Test Results:** 81/81 tests passing

#### Technical Decisions
- Used `const JWKS_CACHE_TTL = 300000` (5 minutes) as per NFR10
- Manual `exp` check from unverified payload (jose checks signature before claims)
- Helper function `verifyWithJwt()` to avoid code duplication in retry logic
- Added `_getJwksCache(issuer)` testing helper method
- Exported `createJwksCache()` for direct unit testing of TTL behavior
- Mock strategy: Since `jwtVerify` is mocked (ESM compatibility), TTL tests use `createJwksCache()` directly to verify re-fetch behavior

#### Files Modified

### File List
- components/gov-chat-backend/services/keycloak-auth-service.js (modified)
- components/gov-chat-backend/__tests__/keycloak-auth-service.test.js (modified)
