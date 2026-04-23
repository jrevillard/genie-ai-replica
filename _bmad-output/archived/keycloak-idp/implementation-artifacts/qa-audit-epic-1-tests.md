# Story QA-1: Epic 1 Tests — Pertinence & Complétude Audit

Status: completed

## Story

As a QA specialist,
I want to audit all Epic 1 tests for pertinence (relevance) and complétude (completeness),
So that we can ensure test quality before starting Epic 2 and identify any gaps or issues.

## Context

Epic 1 (Keycloak Foundation & User Authentication) is complete with 11 stories implemented. The retrospective identified several potential test quality concerns:

1. **Mock testing vs reality** — Tests may verify mock objects rather than actual behavior
2. **Test file location inconsistency** — `src/__tests__/` (frontend) vs `__tests__/` (backend)
3. **Unused mock fixtures** — `mockJwtPayload.js` exports fixtures that may not be used
4. **req.user shape verification** — Need to ensure tests verify the correct authentication field (`iss_sub` vs `_key`)

## Acceptance Criteria

1. **Backend Tests Audit** (keycloak-auth-service, keycloak-auth-middleware, user-provisioning-service)
   - Verify tests validate actual JWT authentication fields (`iss_sub`, `sub`, `iss`) not ArangoDB internal fields (`_key`)
   - Identify any tests that mock both JWT and ArangoDB fields without distinguishing which is used
   - Verify error response format tests match production code
   - Verify all error codes are tested (TOKEN_INVALID, TOKEN_EXPIRED, FORBIDDEN, PROVISIONING_FAILED)
   - Identify tests that may pass due to mock overspecification rather than correct behavior

2. **Frontend Tests Audit** (keycloakAuthService, store/auth, router, httpService-401-retry, oidcConfig, userService)
   - Identify tests calling deleted backend routes (checkEmailAvailability, checkUsernameAvailability, legacy user management)
   - Verify OIDC flow tests match actual Keycloak redirect behavior
   - Verify auth guard tests cover all public/protected route scenarios
   - Identify any tests mocking HTTP responses that don't match backend actual responses

3. **Test Coverage Analysis**
   - Verify all authentication error codes are tested
   - Verify all public/protected route scenarios are covered
   - Verify JIT provisioning scenarios are tested (new user, existing user, soft-deleted user)
   - Verify OIDC discovery and retry cooldown behavior is tested
   - Identify any critical paths missing tests

4. **Test Quality Assessment**
   - Identify tests relying on overspecified mocks that may pass for wrong reasons
   - Identify tests that don't verify the actual behavior being tested
   - Verify test assertions check the correct fields (JWT auth fields vs database fields)
   - Identify any duplicate or redundant tests

5. **Documentation of Findings**
   - Create detailed report of all issues found
   - Categorize issues: critical (blocks Epic 2), important (should fix), optional (nice to have)
   - Provide line numbers and file paths for each issue
   - Suggest fixes for each issue

## Tasks / Subtasks

- [x] Task 1: Audit backend authentication tests (AC: #1)
  - [x] 1.1 Read keycloak-auth-service.test.js and verify JWKS verification tests validate JWT fields not mock artifacts
  - [x] 1.2 Read keycloak-auth-middleware.test.js and verify req.user.iss_sub is tested (not req.user._key)
  - [x] 1.3 Verify error response format tests match { error, message, details } structure
  - [x] 1.4 Verify all error codes are tested (TOKEN_INVALID, TOKEN_EXPIRED, FORBIDDEN, PROVISIONING_FAILED)
  - [x] 1.5 Identify tests that may pass due to mock overspecification

- [x] Task 2: Audit backend provisioning tests (AC: #1)
  - [x] 2.1 Read user-provisioning-service.test.js
  - [x] 2.2 Verify JIT provisioning scenarios (new user, existing user, soft-deleted user)
  - [x] 2.3 Verify iss_sub composite key handling is tested
  - [x] 2.4 Verify error handling for ArangoDB failures

- [x] Task 3: Audit frontend authentication tests (AC: #2)
  - [x] 3.1 Read keycloakAuthService.test.js and verify OIDC flow tests
  - [x] 3.2 Read store/auth.test.js and verify Vuex auth state management
  - [x] 3.3 Read router.test.js and verify auth guard logic
  - [x] 3.4 Verify tests match actual Keycloak redirect behavior

- [x] Task 4: Audit frontend service tests (AC: #2)
  - [x] 4.1 Read testUserService.js and identify calls to deleted routes
  - [x] 4.2 Read httpService-401-retry.test.js and verify retry logic
  - [x] 4.3 Read oidcConfig.test.js and verify configuration tests
  - [x] 4.4 Verify HTTP response mocks match backend actual responses

- [x] Task 5: Analyze test coverage (AC: #3)
  - [x] 5.1 Verify all authentication error codes are tested
  - [x] 5.2 Verify all public/protected route scenarios are covered
  - [x] 5.3 Verify JIT provisioning scenarios are tested
  - [x] 5.4 Verify OIDC discovery and retry cooldown is tested
  - [x] 5.5 Identify critical paths missing tests

- [x] Task 6: Assess test quality (AC: #4)
  - [x] 6.1 Identify tests relying on overspecified mocks
  - [x] 6.2 Identify tests not verifying actual behavior
  - [x] 6.3 Verify test assertions check correct fields (JWT vs database)
  - [x] 6.4 Identify duplicate or redundant tests

- [x] Task 7: Document findings and recommendations (AC: #5)
  - [x] 7.1 Create QA audit report with all issues categorized
  - [x] 7.2 Provide line numbers and file paths for each issue
  - [x] 7.3 Suggest specific fixes for each issue
  - [x] 7.4 Run tests to verify current state (npx jest in backend and frontend)

## Dev Notes

### Known Issues from Retrospective

**Issue 1: req.user._key vs req.user.iss_sub in tests**
- **Location**: `components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js:210`
- **Problem**: Test expects `req.user._key` (ArangoDB primary key) instead of `req.user.iss_sub` (JWT authentication field)
- **Why test passes**: Mock returns arangoDbUser object with BOTH `_key` and `iss_sub` fields, so `expect(req.user).toEqual(arangoDbUser)` passes regardless
- **Impact**: Test verifies mock object structure, not actual middleware behavior
- **Fix**: Change assertion to verify `req.user.iss_sub` (the authentication field) not `req.user._key` (the database field)

**Issue 2: Deleted backend routes in frontend tests**
- **Location**: `components/gov-chat-frontend/src/services/tests/testUserService.js:525-542`
- **Problem**: Contains `checkEmailAvailability` and `checkUsernameAvailability` methods
- **Impact**: These methods call deleted backend routes (`/check-email`, `/check-username`)
- **Fix**: Remove these test methods or update to reflect Keycloak-managed user uniqueness

**Issue 3: Test file location inconsistency**
- Frontend: `src/__tests__/`
- Backend: `__tests__/` (no `src/`)
- **Impact**: Confusion when creating test references in stories
- **Fix**: Document in `project-context.md`

### Test Files to Audit

**Backend** (components/gov-chat-backend/__tests__/):
- `keycloak-auth-service.test.js` — JWKS token verification
- `keycloak-auth-middleware.test.js` — Express middleware, public/protected routes
- `user-provisioning-service.test.js` — JIT provisioning

**Frontend** (components/gov-chat-frontend/src/):
- `__tests__/keycloakAuthService.test.js` — OIDC service
- `__tests__/store/modules/auth.test.js` — Vuex auth module
- `__tests__/router.test.js` — Vue Router auth guards
- `__tests__/httpService-401-retry.test.js` — HTTP retry logic
- `__tests__/oidcConfig.test.js` — OIDC configuration
- `services/tests/testUserService.js` — User service

### Authentication Fields Reference

**JWT Claims (from Keycloak token)**:
- `iss_sub` — Composite key `{iss}#{sub}` (PRIMARY AUTH IDENTIFIER)
- `sub` — User ID from Keycloak
- `iss` — Keycloak issuer URL
- `email` — User email
- `name` — User display name
- `roles` — Array from realm_access.roles

**ArangoDB User Fields** (internal database):
- `_key` — ArangoDB primary key (INTERNAL, not for authentication logic)
- `iss_sub` — JWT composite key (matches JWT claim)
- `email` — User email
- `name` — User display name
- `roles` — User roles array
- `active` — Account active flag
- `deleted` — Soft-delete flag

**Critical**: Authentication tests MUST verify `req.user.iss_sub` (the JWT field), NOT `req.user._key` (the ArangoDB internal field)

### Error Response Format

All auth errors must follow:
```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description",
  "details": {}
}
```

**Error Codes**:
- `TOKEN_INVALID` — Missing/malformed token, invalid signature, wrong claims
- `TOKEN_EXPIRED` — Token exp claim exceeded
- `FORBIDDEN` — User deactivated or deleted
- `PROVISIONING_FAILED` — ArangoDB failure during JIT provisioning
- `AUTH_SERVICE_UNAVAILABLE` — Keycloak unavailable (forward-looking, may not be implemented)

### Mock Fixture Review

**File**: `components/gov-chat-backend/__tests__/mocks/mockJwtPayload.js`

Verify:
- All exported fixtures are used in tests
- Fixture fields match actual JWT claims from Keycloak
- Fixtures include `iss_sub` composite key
- Fixtures don't include ArangoDB-specific fields (should be added in tests if needed for provisioning)

### Testing Standards

- **Backend**: Jest, CommonJS, `__tests__/` directory, `*.test.js` naming
- **Frontend**: Jest, `src/__tests__/` directory, `*.test.js` naming
- **Shared fixtures**: `__tests__/mocks/mockJwtPayload.js` mandatory for auth tests
- **Mock isolation**: Mock external services (jose, Keycloak, ArangoDB) at module level

### References

- [Source: _bmad-output/implementation-artifacts/epic-1-retrospective.md] — Lessons learned and known issues
- [Source: _bmad-output/implementation-artifacts/1-3-backend-auth-middleware-protected-and-public-routes.md] — Test patterns and standards
- [Source: _bmad-output/implementation-artifacts/1-6-jit-user-provisioning-in-arangodb.md] — Provisioning test scenarios
- [Source: components/gov-chat-backend/__tests__/] — All backend test files
- [Source: components/gov-chat-frontend/src/__tests__/] — All frontend test files

## Dev Agent Record

### Agent Model Used

GLM-4.7 (Claude Code)

### Debug Log References

- All tests executed and passed (94/94 tests passing)
- Test files analyzed: 10 files (4 backend, 6 frontend)
- Production code reviewed: keycloak-auth-service.js, keycloak-auth-middleware.js, user-provisioning-service.js

### Completion Notes List

**Summary**: QA audit completed for Epic 1 tests. **CRITICAL FINDING**: `userService.js` has ZERO test coverage. The file `testUserService.js` is NOT a Jest test and tests a completely different implementation.

**Critical Issues (2) - Must fix before Epic 2:**

1. **userService.js has ZERO test coverage** — Core service file with 20+ methods completely untested:
   - Account management: `deleteAccount()`, `deactivateAccount()`, `reactivateAccount()`
   - Admin functions: `updateUserRole()`, `forceUserLogout()`, `getAllUsers()`
   - Password validation: `validatePasswordStrength()`
   - Profile management: `uploadAvatar()`, `updateEmail()`, `verifyEmail()`

2. **testUserService.js is misleading** — NOT a Jest test file, tests non-existent implementation:
   - Not in Jest test suite (not listed by `npx jest --listTests`)
   - Defines its own UserService class inline (different from real code)
   - Tests deleted backend routes: `/auth/login`, `/auth/register`, `/check-email`, `/check-username`
   - Gives FALSE impression that userService is tested

**Additional Issue:**
3. keycloak-auth-middleware.test.js:209-211 — Test expects `req.user._key` instead of `req.user.iss_sub`. Mock contains both fields so test passes for wrong reason.

**Important Issues (1) - Should fix:**
1. Test file location inconsistency — Frontend: `src/__tests__/`, Backend: `__tests__/`

**Optional Issues (2) - Nice to have:**
1. mockJwtPayload.js missing `iss_sub` composite key
2. No test coverage for `requireAdmin` middleware

**Coverage Analysis:**
- ✅ All authentication error codes tested (TOKEN_INVALID, TOKEN_EXPIRED, FORBIDDEN, PROVISIONING_FAILED)
- ✅ All JIT provisioning scenarios tested (new user, existing user, soft-deleted user)
- ✅ All public/protected route scenarios tested
- ✅ OIDC discovery and retry cooldown tested
- ❌ **userService.js: ZERO test coverage (CRITICAL GAP)**

**Why "tests for deleted routes" pass:**
They don't. `testUserService.js` is NOT a Jest test file — it's a standalone Node.js script that defines its own mock implementation. It's never run by Jest, so it can't fail. This is why it appears to "pass" while actually testing nothing.

**Detailed report**: See `_bmad-output/implementation-artifacts/qa-audit-epic-1-tests-report.md`

### File List

#### Phase 1 — QA Audit (Original)

| File | Action | Description |
|------|--------|-------------|
| `_bmad-output/implementation-artifacts/qa-audit-epic-1-tests-report.md` | CREATE | QA audit findings report |
| `_bmad-output/implementation-artifacts/qa-epic-1-test-correction-plan.md` | CREATE | Detailed correction plan with priorities |
| `_bmad-output/implementation-artifacts/qa-audit-epic-1-tests.md` | CREATE | This story file |
| `components/gov-chat-frontend/src/services/tests/testUserService.js` | **DELETE** | Not a Jest test; tests non-existent implementation |
| `components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js` | MODIFY | Fix req.user._key → req.user.iss_sub |

#### Phase 2 — Corrections (Important)

| File | Action | Description |
|------|--------|-------------|
| `components/gov-chat-frontend/src/__tests__/userService.test.js` | CREATE | 55 tests covering all userService methods (was 0%) |
| `components/gov-chat-frontend/src/__tests__/httpService.test.js` | CREATE | 21 tests for HTTP service (get/post/put/delete/patch, interceptors, URL building) |
| `components/gov-chat-backend/__tests__/mocks/mockJwtPayload.js` | MODIFY | Added iss_sub composite key field |
| `components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js` | MODIFY | Added 6 requireAdmin middleware tests |
| `_bmad-output/implementation-artifacts/qa-epic-1-correction-summary.md` | CREATE | Phase 1+2 correction summary with metrics |
| `_bmad-output/implementation-artifacts/qa-integration-test-approaches.md` | CREATE | Integration test approaches documentation |
| `_bmad-output/implementation-artifacts/qa-integration-tests-future-implementation.md` | CREATE | Guide for future Docker-based integration tests |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | MODIFY | qa-audit-epic-1-tests: done, qa-epic-1-important-corrections: done |

#### Not Done

| File | Action | Description |
|------|--------|-------------|
| `_bmad-output/project-context.md` | MODIFY | Document test file location conventions (not done yet) |
