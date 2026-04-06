# Story 3.2: Session Invalidation on User Disable/Delete

Status: review

## Story

As a system,
I want to invalidate an active session when the corresponding Keycloak user is deleted or disabled,
so that compromised or terminated accounts cannot continue to access the application.

## Acceptance Criteria

1. **Given** an authenticated user has an active session with a valid access token
   **When** an administrator disables or deletes the user in Keycloak
   **Then** the user's next access token refresh attempt is rejected by Keycloak (refresh token invalidated server-side) — no polling of Keycloak is performed by the backend (FR15)
   **And** the frontend's silent refresh (Story 1.7) fails, triggering a redirect to the Keycloak login page with an appropriate error message
   **And** if the access token is still valid when the user is disabled, the session persists until the access token expires — this is a known OIDC stateless token limitation mitigated by short access token lifetimes (configured in Keycloak realm settings)
   **And** the ArangoDB user record is updated to reflect the disabled/deleted status on the next login attempt

## Tasks / Subtasks

- [ ] **Task 1: Verify silent renew failure handling exists** (AC: #2)
  - [ ] Verify that `keycloakAuthService.addSilentRenewError` event listener triggers login redirect on silent renew failure (from Story 1.7)
  - [ ] Verify that the event listener is registered during `initialize()` and not removed during normal operation
  - [ ] Confirm that Keycloak login page is displayed to user (no custom error message needed — Keycloak provides standard login UI)

- [x] **Task 2: Add Keycloak UserInfo introspection on token validation failure** (AC: #4)
  - [x] Research Keycloak UserInfo endpoint: `GET /protocol/openid-connect/userinfo` with Bearer token (simpler than token introspection — no client secret needed)
  - [x] Add function `checkUserStatusInKeycloak(token)` in `keycloak-auth-service.js` that calls UserInfo endpoint
  - [x] Parse response: if 401/403, user is disabled/deleted in Keycloak; if 200, user is active
  - [x] Call this function when JWT validation fails with TOKEN_EXPIRED (in middleware error handler)
  - [x] If user is disabled in Keycloak, update ArangoDB user's `deleted` flag to `true` via `markUserAsDeleted()`
  - [x] Use `logger.warn()` for introspection failures (non-critical), don't block login
  - [x] Add 3-second timeout for UserInfo calls

- [x] **Task 3: Frontend tests for silent renew failure** (AC: #2)
  - [x] Add test: `addSilentRenewError listener triggers login redirect` (already exists in keycloakAuthService.test.js)
  - [x] Verify existing tests cover the silent renew error flow

- [x] **Task 4: Backend tests for token validation failure handling** (AC: #2, #4)
  - [x] Add test: `deleted user returns 403 FORBIDDEN on token validation` (already exists in keycloak-auth-middleware.test.js)
  - [x] Add test: `ArangoDB user updated when Keycloak introspection returns disabled: true`
  - [x] Add test: `introspection failure is logged but doesn't block login`
  - [x] Add test: `markUserAsDeleted()` method in user-provisioning-service.test.js
  - [x] Add test: `checkUserStatusInKeycloak()` in keycloak-auth-service.test.js

## Dev Notes

### What Already Exists (no changes needed)

- **Silent renew error handling**: From Story 1.7, `keycloakAuthService.initialize()` registers `addSilentRenewError` event listener that calls `login()` when silent renew fails
- **Keycloak token validation**: Backend validates JWT signatures via JWKS and checks `exp` claim — rejected tokens return 401
- **ArangoDB user soft delete**: User records have `deleted` flag (from Epic 1), JIT provisioning checks this on login
- **Error response format**: `{ error: "ERROR_CODE", message: "description", details: {} }` already implemented
- **Audit logging**: `logger.info()` with structured JSON already used in auth endpoints

### What Needs to Change (gaps identified)

#### Gap 1: ArangoDB not updated when Keycloak disables user
**File**: Backend token validation flow

When a Keycloak user is disabled/deleted, their refresh tokens are invalidated server-side. The next time the frontend tries to use a refresh token, Keycloak rejects it (401). However, the ArangoDB user record still shows `deleted: false` until the next login attempt.

**Solution**: When token validation fails with 401, attempt to call Keycloak's token introspection endpoint to determine if the user was disabled/deleted. If so, update the ArangoDB user's `deleted` flag to `true`. This is best-effort — if Keycloak introspection fails, log the error and continue.

#### Gap 2: No user status check on valid JWT (ALREADY IMPLEMENTED)
**File**: `components/gov-chat-backend/middleware/keycloak-auth-middleware.js`, JWT validation section

**Status**: The check `user.deleted === true` already exists (lines 125-131). Disabled/deleted users are correctly rejected with 403 FORBIDDEN. No changes needed for this gap.

### Architecture Constraints

- **NFR3**: Access tokens stored in browser memory only — NEVER in localStorage, sessionStorage, or cookies
- **FR15**: Session invalidation when Keycloak user is disabled/deleted — NO polling of Keycloak by backend
- **Options API only** — never use Composition API or `<script setup>`
- **CommonJS only** in backend — `require()`/`module.exports`, never ES imports
- **ES module imports** in frontend — `import`/`export` with `@/` alias
- **Per-route auth middleware** — never apply auth middleware globally
- **Error format**: `{ error: "ERROR_CODE", message: "description", details: {} }`
- **Audit log format**: `{ event, timestamp, userId: "iss#sub", issuer }`
- **Known limitation**: Stateless JWT tokens remain valid until `exp` claim even after user disable — this is an OIDC limitation, mitigated by short access token lifetime (typically 5-15 minutes)

### Key Files to Modify

| File | Change |
|------|--------|
| `components/gov-chat-backend/services/keycloak-auth-service.js` | Add `checkUserStatusInKeycloak(token)` function with introspection |
| `components/gov-chat-backend/middleware/keycloak-auth-middleware.js` | Call introspection function on 401, update ArangoDB user status |
| `components/gov-chat-frontend/src/__tests__/keycloakAuthService.test.js` | Add tests for silent renew failure handling |
| `components/gov-chat-backend/__tests__/keycloak-auth-service.test.js` | Add tests for introspection function and ArangoDB user update |
| `components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js` | Add test for existing deleted user check (403 FORBIDDEN) |

### Testing Standards

- **Frontend**: Jest with jsdom, mock `oidc-client-ts` UserManager (same pattern as existing tests)
- **Backend**: Jest, CommonJS mode, mock ArangoDB and Keycloak introspection
- **Mock user factory**: Use existing `createMockUser()` pattern from `keycloakAuthService.test.js`
- **Backend auth fixtures**: Use `__tests__/mocks/mockJwtPayload.js` for JWT payload fixtures
- **Test location**: `src/__tests__/` (frontend), `__tests__/` (backend)

### Session Architecture Context

- **No server-side session store** — backend is stateless JWT validation via JWKS
- **Silent renew**: Frontend uses `userManager.signinSilent()` to refresh access tokens before they expire
- **Silent renew failure**: Triggers `addSilentRenewError` event, which calls `login()` to re-authenticate
- **Keycloak introspection**: Optional enhancement using `UserInfo` endpoint or token introspection endpoint to check user status
- **Known OIDC limitation**: Access tokens remain cryptographically valid until `exp` even after user disable — backend cannot invalidate stateless JWTs without a token revocation list (not implemented per FR15)

### Project Structure Notes

- Frontend files under `components/gov-chat-frontend/src/`
- Backend files at `components/gov-chat-backend/` root (no `src/` subdirectory)
- Tests: frontend in `src/__tests__/`, backend in `__tests__/`
- Worktree: `epic3-sessions` (branch `feature/epic3-sessions`)
- This story builds on Story 1.7 (silent renew) and Story 3.1 (logout)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.2] — AC and FR15 references
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.7] — Silent renew error handling
- [Source: _bmad-output/planning-artifacts/prd.md#FR15] — Session invalidation requirement
- [Source: _bmad-output/planning-artifacts/architecture.md#D5] — OIDC service pattern
- [Source: _bmad-output/implementation-artifacts/epic-2-retrospective.md] — Epic 2 learnings (stateless token limitations)
- [Source: components/gov-chat-backend/middleware/keycloak-auth-middleware.js] — Current JWT validation
- [Source: components/gov-chat-frontend/src/services/keycloakAuthService.js] — Silent renew handling
- [Source: _bmad-output/implementation-artifacts/3-1-user-logout-and-session-termination-across-application.md] — Logout implementation (prerequisite)

## Dev Agent Record

### Agent Model Used

glm-5-turbo (Claude Code)

### Debug Log References

### Completion Notes List

- **Task 1**: Verified that `addSilentRenewError` event listener exists in `keycloakAuthService.initialize()` (from Story 1.7). Frontend tests confirmed the listener triggers login redirect on silent renew failure.
- **Task 2**: Implemented `checkUserStatusInKeycloak()` function in `keycloak-auth-service.js` using Keycloak UserInfo endpoint (simpler than token introspection — no client secret required). Added token issuer extraction in middleware before JWT verification. Integrated introspection call in TOKEN_EXPIRED error handler with best-effort ArangoDB update via new `markUserAsDeleted()` method. Fixed axios error handling to properly detect 401/403 responses (which reject, not resolve).
- **Task 3**: Verified existing frontend tests cover silent renew failure handling. No additional tests needed.
- **Task 4**: Added 6 tests for `markUserAsDeleted()` (success, warning, logging, error propagation, field updates). Added 4 tests for `checkUserStatusInKeycloak()` (200 response, timeout, network error, unexpected status, 401/403 handling). Added 4 tests for middleware introspection behavior (disabled user, active user, introspection failure, invalid token). All 144 backend tests pass.

### File List

- `components/gov-chat-backend/services/keycloak-auth-service.js` (modified) — Added `checkUserStatusInKeycloak()` function, added `axios` import
- `components/gov-chat-backend/services/user-provisioning-service.js` (modified) — Added `markUserAsDeleted()` method
- `components/gov-chat-backend/middleware/keycloak-auth-middleware.js` (modified) — Added token issuer extraction, added introspection call in TOKEN_EXPIRED handler
- `components/gov-chat-backend/__tests__/keycloak-auth-service.test.js` (modified) — Added `checkUserStatusInKeycloak()` tests, added axios mock
- `components/gov-chat-backend/__tests__/keycloak-auth-middleware.test.js` (modified) — Added introspection behavior tests, added mocks for new functions
- `components/gov-chat-backend/__tests__/user-provisioning-service.test.js` (modified) — Added `markUserAsDeleted()` tests
