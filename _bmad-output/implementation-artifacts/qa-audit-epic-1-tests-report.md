# QA Audit Report: Epic 1 Tests — Pertinence & Complétude

**Date**: 2026-04-03
**Auditor**: QA Agent
**Epic**: Epic 1 — Keycloak Foundation & User Authentication
**Scope**: All authentication and provisioning tests (backend + frontend)

---

## Executive Summary

**Total Test Files**: 9 (3 backend, 6 frontend real Jest tests)
**Total Tests**: 147 (70 backend, 77 frontend)
**Pass Rate**: 100% (all tests currently pass)
**Critical Issues**: 2
**Important Issues**: 2
**Optional Issues**: 2

### Overall Assessment

**CRITICAL FINDING**: The `userService.js` file has **ZERO test coverage**. The file `testUserService.js` appears to be a test but is actually:
- A standalone Node.js script (not a Jest test)
- Tests a completely different implementation (defines UserService inline)
- Tests deleted backend routes from the pre-Keycloak system

**Other Issue**: One test verifies database field (`_key`) instead of JWT authentication field (`iss_sub`).

Tests are well-structured for authentication but have significant gaps in user service coverage.

---

## Critical Issues (Blocks Epic 2)

### Issue #1: userService.js has ZERO test coverage — tests completely different code!

**File**: `components/gov-chat-frontend/src/services/userService.js`
**Severity**: CRITICAL

**Problem**:
The actual `userService.js` file has **ZERO Jest test coverage**. The file `testUserService.js` that appears to be a test file is actually:
1. **NOT a Jest test file** (not in Jest's test suite)
2. **Tests a completely different implementation** (defines its own UserService class inline)
3. **Tests deleted backend routes** (`/auth/login`, `/auth/register`, `/check-email`, `/check-username`)

**Evidence**:

| Aspect | Real userService.js | testUserService.js (fake test) |
|--------|---------------------|-------------------------------|
| File location | `src/services/userService.js` | `src/services/tests/testUserService.js` |
| Has `login()` method | NO | YES (line 247) |
| Has `register()` method | NO | YES (line 267) |
| Has `hashPassword()` method | NO | YES (line 339) |
| Has `checkUsernameAvailability()` method | NO | YES (line 525) |
| Tests with Jest | NO tests exist | Standalone script with console.log |
| Part of Jest suite | Should be | NO (not in `npx jest --listTests`) |

**Real userService.js methods** (completely untested):
- `logout()` - calls `/auth/logout` ✅ route exists
- `fetchCurrentUser()` - calls `/auth/me` ✅ route exists
- `getCurrentUser()` - localStorage read
- `isAuthenticated()` - localStorage check
- `updateAccountSettings()` - calls `users/settings` ✅ route exists
- `verifyEmail()` - calls `users/verify-email` ✅ route exists
- `resendVerificationEmail()` - calls `users/resend-verification` ✅ route exists
- `updateEmail()` - calls `users/email` ✅ route exists
- `getActivityLog()` - calls `users/activity` ✅ route exists
- `getAccountStatus()` - calls `users/status` ✅ route exists
- `deactivateAccount()` - calls `users/deactivate` ✅ route exists
- `reactivateAccount()` - calls `users/reactivate` ✅ route exists
- `uploadAvatar()` - calls `users/avatar` ✅ route exists
- `deleteAvatar()` - calls `users/avatar` ✅ route exists
- `validatePasswordStrength()` - client-side validation
- `doPasswordsMatch()` - client-side validation
- `deleteAccount()` - calls `users/delete` ✅ route exists
- `updateUserRole()` - calls `users/:userId` ✅ route exists
- `getAllUsers()` - calls `admin/users` ✅ route exists
- `getUserProfile()` - calls `users/:userId` ✅ route exists
- `forceUserLogout()` - calls `users/admin/users/:userId/force-logout` ✅ route exists
- `resendVerificationEmailAdmin()` - calls `users/admin/users/:userId/resend-verification` ✅ route exists

**testUserService.js "tests"** (non-existent routes):
- `login()` → `/auth/login` ❌ DOES NOT EXIST (Keycloak handles login)
- `register()` → `/auth/register` ❌ DOES NOT EXIST (Keycloak handles registration)
- `hashPassword()` → ❌ NOT in real code
- `initiatePasswordReset()` → `/auth/reset-password` ❌ DOES NOT EXIST
- `validateResetToken()` → `/auth/validate-token` ❌ DOES NOT EXIST
- `resetPassword()` → `/auth/reset-password/confirm` ❌ DOES NOT EXIST
- `changePassword()` → `/auth/change-password` ❌ DOES NOT EXIST
- `checkUsernameAvailability()` → `/users/check-username` ❌ DOES NOT EXIST
- `checkEmailAvailability()` → `/users/check-email` ❌ DOES NOT EXIST

**Impact**:
- **FALSE sense of coverage** — testUserService.js gives the impression that userService is tested
- **REAL userService.js has ZERO test coverage**
- Methods like `updateUserRole()`, `deleteAccount()`, `forceUserLogout()` are completely untested
- Password validation logic (`validatePasswordStrength`) is untested

**Why this happened**:
testUserService.js is a standalone Node.js script from the pre-Keycloak authentication system. It was:
1. Never converted to a Jest test
2. Never deleted during the Keycloak migration
3. Never updated to test the actual userService.js implementation

**Fix**:
1. **DELETE** `testUserService.js` entirely
2. **CREATE** proper Jest tests for `userService.js` in `src/__tests__/userService.test.js`
3. Test the ACTUAL methods in the REAL userService.js file

### Issue #2: Test verifies `req.user._key` instead of `req.user.iss_sub`

**File**: `components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js`
**Lines**: 209-211
**Severity**: CRITICAL

**Problem**:
```javascript
// Line 209-211 - Current test code
expect(req.user).toEqual(arangoDbUser);
expect(req.user._key).toBe('users/123');
expect(req.user.createdAt).toBe('2026-03-01T00:00:00.000Z');
```

The test asserts `req.user._key` (ArangoDB primary key) instead of `req.user.iss_sub` (JWT authentication field). This test passes because the mock `arangoDbUser` object contains BOTH `_key` and `iss_sub` fields, but it doesn't verify that the middleware is correctly using the JWT authentication field for downstream authorization decisions.

**Why Test Passes**:
The mock `arangoDbUser` object (lines 190-202) includes both the JWT `iss_sub` field and the ArangoDB `_key` field. The test uses `toEqual(arangoDbUser)` which passes as long as all fields match, regardless of which field downstream code actually uses.

**Actual Middleware Behavior**:
The middleware correctly sets `req.user = user` (line 105 of keycloak-auth-middleware.js), where `user` is the ArangoDB document which includes both fields. The middleware is functioning correctly, but the test doesn't verify that authentication decisions are based on the JWT field.

**Impact**:
- Test verifies mock structure, not actual authentication behavior
- If code is refactored to use only JWT fields for auth (as intended), the test would still pass
- False sense of security about what's being tested

**Fix**:
```javascript
// Replace line 209-211 with:
expect(req.user.iss_sub).toBe('http://localhost:8080/realms/genie#12345678');
expect(req.user.sub).toBe('12345678');
expect(req.user.email).toBe('test@example.com');
// Verify JWT auth fields, NOT database internal fields
```

---

## Important Issues (Should Fix)

### Issue #3: Test file location inconsistency

**Locations**:
- Frontend: `components/gov-chat-frontend/src/__tests__/`
- Backend: `components/gov-chat-backend/__tests__/` (no `src/`)

**Severity**: IMPORTANT

**Problem**:
Test files are located in different directories relative to their source code, causing confusion when referencing tests in stories and documentation.

**Impact**:
- Story files reference test paths incorrectly
- Inconsistent project structure
- Harder to find tests when debugging

**Fix**:
Document the convention in `_bmad-output/project-context.md`:
```
Backend tests: components/gov-chat-backend/__tests__/
Frontend tests: components/gov-chat-frontend/src/__tests__/
```

---

## Optional Issues (Nice to Have)

### Issue #4: Mock fixture missing `iss_sub` composite key

**File**: `components/gov-chat-backend/__tests__/mocks/mockJwtPayload.js`
**Lines**: 4-25
**Severity**: OPTIONAL

**Problem**:
The `mockJwtPayload` fixture does not include the `iss_sub` composite key, which is identified in the story as the "PRIMARY AUTH IDENTIFIER". The `iss_sub` is added by `keycloak-auth-service.verifyToken()` (line 168 of keycloak-auth-service.js).

**Impact**:
- Minor — the service correctly adds `iss_sub`, but the fixture is incomplete
- Could confuse developers reading tests to understand JWT structure

**Fix**:
Add `iss_sub` to the base fixture:
```javascript
const mockJwtPayload = {
  // ... existing fields ...
  iss_sub: 'http://localhost:8080/realms/genie#12345678-1234-1234-1234-123456789012' // Add this line
};
```

### Issue #5: No test for `requireAdmin` middleware

**File**: `components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js`
**Severity**: OPTIONAL

**Problem**:
The `requireAdmin` function (line 139 of keycloak-auth-middleware.js) has no test coverage.

**Impact**:
- Missing coverage for admin role verification
- Potential for regressions if `requireAdmin` is modified

**Fix**:
Add test cases:
```javascript
describe('requireAdmin', () => {
  it('should allow access when user has admin role', () => { /* ... */ });
  it('should return 403 when user lacks admin role', () => { /* ... */ });
  it('should return 403 when user.roles is missing', () => { /* ... */ });
});
```

---

## Test Coverage Analysis

### Backend Test Coverage

| File | Tests | Coverage | Notes |
|------|-------|----------|-------|
| `keycloak-auth-service.test.js` | 27 | Good | All error codes tested, OIDC discovery tested |
| `keycloak-auth-middleware.test.js` | 28 | Good | Public/protected routes tested, all error codes tested |
| `user-provisioning-service.test.js` | 15 | Good | JIT provisioning scenarios tested |

### Frontend Test Coverage

| File | Tests | Coverage | Notes |
|------|-------|----------|-------|
| `keycloakAuthService.test.js` | 26 | Good | OIDC flow tested, token refresh tested |
| `store/modules/auth.test.js` | 27 | Good | Vuex state management tested |
| `router.test.js` | 9 | Good | Auth guard logic tested |
| `httpService-401-retry.test.js` | 7 | Good | Retry logic tested |
| `oidcConfig.test.js` | 8 | Good | Configuration fallback tested |
| **`userService.js`** | **0** | **CRITICAL** | **NO TEST COVERAGE — file exists but untested** |
| `testUserService.js` | N/A | **DELETE** | Not a Jest test; tests non-existent implementation |

### Authentication Error Codes Coverage

| Error Code | Tested In | Status |
|------------|-----------|--------|
| `TOKEN_INVALID` | keycloak-auth-service.test.js, keycloak-auth-middleware.test.js | ✅ |
| `TOKEN_EXPIRED` | keycloak-auth-service.test.js, keycloak-auth-middleware.test.js | ✅ |
| `FORBIDDEN` | keycloak-auth-middleware.test.js | ✅ |
| `PROVISIONING_FAILED` | keycloak-auth-middleware.test.js | ✅ |
| `AUTH_SERVICE_UNAVAILABLE` | keycloak-auth-service.test.js | ✅ |

### JIT Provisioning Scenarios Coverage

| Scenario | Tested In | Status |
|----------|-----------|--------|
| New user (UPSERT INSERT) | user-provisioning-service.test.js:48-74 | ✅ |
| Existing user (UPSERT UPDATE) | user-provisioning-service.test.js:76-109 | ✅ |
| Soft-deleted user (blocked) | user-provisioning-service.test.js:141-170 | ✅ |

### Public/Protected Route Scenarios Coverage

| Scenario | Tested In | Status |
|----------|-----------|--------|
| Public route access | keycloak-auth-middleware.test.js:28-79 | ✅ |
| Protected route without token | keycloak-auth-middleware.test.js:100-110 | ✅ |
| Protected route with valid token | keycloak-auth-middleware.test.js:174-213 | ✅ |
| Protected route with expired token | keycloak-auth-middleware.test.js:140-155 | ✅ |

### OIDC Discovery & Retry Cooldown Coverage

| Scenario | Tested In | Status |
|----------|-----------|--------|
| Lazy initialization | keycloak-auth-service.test.js:60-84 | ✅ |
| Discovery failure | keycloak-auth-service.test.js:273-282 | ✅ |
| Retry cooldown | keycloak-auth-service.test.js:284-296 | ✅ |
| Recovery after cooldown | keycloak-auth-service.test.js:298-315 | ✅ |

---

## Test Quality Assessment

### Tests Relying on Overspecified Mocks

1. **keycloak-auth-middleware.test.js:174-213** — `arangoDbUser` mock includes both JWT and database fields; test verifies full object equality rather than specific authentication fields.

### Tests Not Verifying Actual Behavior

1. **keycloak-auth-middleware.test.js:209** — Asserts `req.user._key` instead of `req.user.iss_sub`; verifies database field rather than authentication identifier.

### Tests with Duplicate Coverage

No significant duplicates found. Tests are well-factored with minimal overlap.

---

## Recommendations

### Before Epic 2 (Must Fix)

1. **CREATE proper tests for userService.js** — This file has ZERO test coverage and contains 20+ methods including critical functions like `deleteAccount()`, `updateUserRole()`, `forceUserLogout()`, password validation, etc.
2. **DELETE testUserService.js** — This is not a Jest test file and tests a completely different (non-existent) implementation
3. **Fix Issue #2**: Update `keycloak-auth-middleware.test.js` to verify `req.user.iss_sub` instead of `req.user._key`

### During Epic 2 (Should Fix)

4. **Fix Issue #3**: Document test file location conventions in `project-context.md`
5. **Add Issue #5**: Add tests for `requireAdmin` middleware

### Future Improvements (Nice to Have)

6. **Fix Issue #4**: Add `iss_sub` to `mockJwtPayload` fixture

---

## Appendix: Mock Fixture Review

### `mockJwtPayload.js` Analysis

**Exported Fixtures**:
- `mockJwtPayload` ✅ Used in all auth test files
- `mockExpiredPayload` ✅ Used for TOKEN_EXPIRED tests
- `mockWrongAudPayload` ✅ Used for audience validation tests
- `mockMissingClaimsPayload` ✅ Used for missing claims tests
- `generateMockJwtString()` ✅ Used for creating mock JWT strings

**Usage**: All fixtures are used. No unused exports.

**Missing Field**: `iss_sub` is NOT in the base fixture (see Issue #5).

**Field Accuracy**: All other fields match actual JWT claims from Keycloak.

**ArangoDB Fields**: Fixtures correctly do NOT include ArangoDB-specific fields (`_key`, `createdAt`, etc.).

---

## Test Execution Results

All tests pass as of 2026-04-03:

```
Backend:
✓ keycloak-auth-service.test.js     27 tests passed
✓ keycloak-auth-middleware.test.js  28 tests passed
✓ user-provisioning-service.test.js 15 tests passed

Frontend (Jest):
✓ keycloakAuthService.test.js       26 tests passed
✓ store/modules/auth.test.js        27 tests passed
✓ router.test.js                     9 tests passed
✓ httpService-401-retry.test.js      7 tests passed
✓ oidcConfig.test.js                 8 tests passed

NOT TESTED:
✗ userService.js                     0 tests — NO COVERAGE
```

---

## Conclusion

Epic 1 tests are generally well-written for authentication scenarios, **BUT** the audit revealed a **CRITICAL GAP**:

### Most Critical Finding

**`userService.js` has ZERO test coverage** — a core service file with 20+ methods including:
- Account management (`deleteAccount()`, `deactivateAccount()`, `reactivateAccount()`)
- Admin functions (`updateUserRole()`, `forceUserLogout()`, `getAllUsers()`)
- Password validation (`validatePasswordStrength()`)
- Profile management (`uploadAvatar()`, `updateEmail()`, `verifyEmail()`)

The misleading `testUserService.js` file:
- Is NOT a Jest test (not run by test suite)
- Tests a completely different implementation (inline UserService class)
- Tests deleted backend routes (`/auth/login`, `/auth/register`, etc.)
- Gives FALSE impression that userService is tested

### Other Issues

1. **keycloak-auth-middleware.test.js** — Test verifies `req.user._key` instead of `req.user.iss_sub` (JWT auth field)
2. Test file location inconsistency should be documented

### Impact Assessment

| Component | Coverage | Risk |
|-----------|----------|------|
| JWT Authentication | ✅ Well-tested | Low |
| Middleware | ⚠️ Tests wrong field | Medium |
| JIT Provisioning | ✅ Well-tested | Low |
| OIDC Flow | ✅ Well-tested | Low |
| **User Service** | ❌ **NO TESTS** | **HIGH** |

**Recommendation**: BEFORE starting Epic 2:
1. **CREATE** proper Jest tests for `userService.js` (CRITICAL)
2. **DELETE** the misleading `testUserService.js` file
3. **FIX** the middleware test to verify JWT auth field instead of database field
