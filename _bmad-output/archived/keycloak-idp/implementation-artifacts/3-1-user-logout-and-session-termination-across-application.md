# Story 3.1: User Logout & Session Termination Across Application

Status: done

## Story

As an end user,
I want to log out and have my session terminated across the entire application,
so that no residual session data persists after I log out.

## Acceptance Criteria

1. **Given** an authenticated user clicks the logout button
   **When** the logout action is triggered
   **Then** the frontend calls `UserManager.removeUser()` to clear the local session and tokens (FR17)
   **And** the frontend redirects to the Keycloak logout endpoint to terminate the server-side session
   **And** the Vuex auth module resets all auth state (`isAuthenticated`, `user`, `accessToken`)
   **And** the user is redirected to the application home page as an unauthenticated user
   **And** session data does not persist beyond session lifetime (NFR14, FR35)

## Tasks / Subtasks

- [x] **Task 1: Add `removeUser()` call in keycloakAuthService.logout()** (AC: #1)
  - [x] Call `await manager.removeUser()` before `manager.signoutRedirect()` to clear OIDC client internal state and any stored user data
  - [x] Call `manager.clearStaleState()` to remove stale OIDC state entries from sessionStorage
  - [x] Verify `currentUser` is set to `null` in the `finally` block (already exists)
  - [x] Ensure event listeners (`userLoaded`, `silentRenewError`) are unsubscribed before cleanup (already exists)

- [x] **Task 2: Clear legacy localStorage items on OIDC logout** (AC: #1)
  - [x] In the **Vuex `logout` action** (`src/store/modules/auth.js`), NOT in `keycloakAuthService.js` — separation of concerns: the OIDC service should not know about legacy artifacts
  - [x] Clear `localStorage['user']` — set by legacy `userService.js` line 108, not cleaned by OIDC logout flow
  - [x] Clear `localStorage['auth_token']` — referenced by legacy `api.js` line 17, not cleaned by OIDC logout flow
  - [x] Keep preference items intact: `sidebarOpen`, `theme`, `userLocale`, `fontSize`

- [x] **Task 3: Fix router guard `initAuth` bug** (AC: #1)
  - [x] In `src/router/index.js` line ~38, change `store.dispatch('initAuth')` to `store.dispatch('initialize')` — current dispatch is a no-op (Vuex silently ignores unknown actions)
  - [x] **Precaution**: Verify that `App.vue` does NOT already call `dispatch('initialize')` at mount — if both fire, ensure `initialize` is idempotent (should be, since it checks `userManager` singleton)

- [x] **Task 4: Enhance backend logout endpoint** (AC: #1)
  - [x] In `authController.logout()`, end active ArangoDB sessions for the user via `sessionService.endSession()`
  - [x] Add structured audit log entry: `{ event: 'logout', timestamp, userId: iss#sub, issuer }`

- [x] **Task 5: Frontend unit tests for logout** (AC: #1)
  - [x] Add test: `should call removeUser() before signoutRedirect()`
  - [x] Add test: `should call clearStaleState() on logout`
  - [x] Add test: `should clear auth state even if removeUser() fails`
  - [x] Update existing `should call signoutRedirect` test to also verify `removeUser()` call order
  - [x] **Note**: Legacy localStorage cleanup tests belong in Task 6 (authStore tests), NOT here — separation of test responsibilities

- [x] **Task 6: Vuex auth module logout tests** (AC: #1)
  - [x] Add test file: `src/__tests__/authStore.test.js`
  - [x] Test `logout` action dispatches `keycloakAuthService.logout()` and commits `clearAuth`
  - [x] Test `logout` action clears auth state even when service throws
  - [x] Test `logout` action removes silent renew callback in `finally` block
  - [x] Test `logout` action clears legacy `localStorage['user']` and `localStorage['auth_token']`
  - [x] Test `logout` action does NOT clear preference items (`sidebarOpen`, `theme`, etc.)

- [x] **Task 7: Backend tests for enhanced logout** (AC: #1)
  - [x] Add test for `authController.logout()` ending ArangoDB sessions
  - [x] Add test for audit log emission on logout

## Dev Notes

### What Already Exists (no changes needed)

- **OIDC logout redirect**: `keycloakAuthService.logout()` calls `manager.signoutRedirect()` which redirects to Keycloak's `end_session_endpoint` — this terminates the server-side Keycloak session
- **Vuex `clearAuth` mutation**: Already resets `isAuthenticated`, `user`, `accessToken`, `error` to initial values
- **Vuex `logout` action**: Already calls `keycloakAuthService.logout()`, commits `clearAuth`, removes silent renew callback
- **Event listener cleanup**: `keycloakAuthService.logout()` already unsubscribes from `userLoaded` and `silentRenewError`
- **Chat history cleanup**: `App.vue handleLogout()` dispatches `chatHistory/clearFolders` and removes `chatHistory` from localStorage
- **NavBar logout buttons**: Both mobile and desktop logout buttons exist, calling `handleLogout()`
- **`post_logout_redirect_uri`**: Configured in `oidcConfig.js` as `origin` (app root)
- **Backend logout endpoint**: `POST /api/auth/logout` exists at `authController.logout()`, currently a no-op
- **Public path whitelist**: `/api/auth/logout/callback` already whitelisted in middleware `PUBLIC_PATHS`

### What Needs to Change (gaps identified)

#### Gap 1: Missing `UserManager.removeUser()` call (PRIMARY AC GAP)
**File**: `src/services/keycloakAuthService.js`, `logout()` function (~line 86-105)

Current code calls `signoutRedirect()` but NOT `removeUser()`. The AC explicitly requires `removeUser()` to clear local session and tokens. Add `await manager.removeUser()` before `signoutRedirect()`.

#### Gap 2: Missing `clearStaleState()` call
**File**: `src/services/keycloakAuthService.js`, `logout()` function

`oidc-client-ts` may leave stale state entries in sessionStorage. Call `manager.clearStaleState()` during logout.

#### Gap 3: Legacy localStorage not cleared
**Files**: `src/services/userService.js` (line 108 sets `localStorage['user']`), `src/services/api.js` (line 17 reads `localStorage['auth_token']`)

These legacy localStorage items are not cleaned during the OIDC logout flow. Add cleanup in the **Vuex `logout` action** (`src/store/modules/auth.js`), not in the OIDC service — separation of concerns.

#### Gap 4: Router guard bug
**File**: `src/router/index.js`, line ~38

Dispatches `store.dispatch('initAuth')` but the Vuex action is named `initialize`. This is a no-op — auth initialization never fires from the router guard.

#### Gap 5: Backend logout is a no-op
**File**: `components/gov-chat-backend/controllers/authController.js`, `logout()` (lines 30-38)

Currently just logs and returns success. Should end active ArangoDB sessions and emit audit log.

### Architecture Constraints

- **NFR3**: Access tokens stored in browser memory only — NEVER in localStorage, sessionStorage, or cookies
- **NFR14/FR35**: Session data must not persist beyond session lifetime
- **Options API only** — never use Composition API or `<script setup>`
- **CommonJS only** in backend — `require()`/`module.exports`, never ES imports
- **ES module imports** in frontend — `import`/`export` with `@/` alias
- **Per-route auth middleware** — never apply auth middleware globally
- **Error format**: `{ error: "ERROR_CODE", message: "description", details: {} }`
- **Audit log format**: `{ event, timestamp, userId: "iss#sub", issuer }`

### Key Files to Modify

| File | Change |
|------|--------|
| `components/gov-chat-frontend/src/services/keycloakAuthService.js` | Add `removeUser()`, `clearStaleState()` |
| `components/gov-chat-frontend/src/store/modules/auth.js` | Clear legacy localStorage in `logout` action |
| `components/gov-chat-frontend/src/router/index.js` | Fix `initAuth` → `initialize` (verify idempotency with App.vue) |
| `components/gov-chat-frontend/src/__tests__/keycloakAuthService.test.js` | Add/update logout tests |
| `components/gov-chat-frontend/src/__tests__/authStore.test.js` | New test file for Vuex auth module |
| `components/gov-chat-backend/controllers/authController.js` | End ArangoDB sessions, emit audit log on logout |
| `components/gov-chat-backend/__tests__/authController.test.js` | New test file for logout endpoint |

### Testing Standards

- **Frontend**: Jest with jsdom, mock `oidc-client-ts` UserManager (same pattern as existing tests)
- **Backend**: Jest, CommonJS mode, mock ArangoDB and external services
- **Mock user factory**: Use `createMockUser()` pattern from existing `keycloakAuthService.test.js`
- **Backend auth fixtures**: Use `__tests__/mocks/mockJwtPayload.js` for JWT payload fixtures
- **Test location**: `src/__tests__/` (frontend), `__tests__/` (backend)

### Session Architecture Context

- **No server-side session store** — backend is stateless JWT validation via JWKS
- **No Redis session cache** — Redis is only used for translation caching
- **ArangoDB `sessions` collection** — application-level analytics sessions, NOT authentication sessions. Ending these on logout is good hygiene but does not affect JWT validity
- **Known limitation**: After logout, the JWT access token remains cryptographically valid until `exp` claim (typically 5-15 min). This is an OIDC stateless token limitation — Story 3.2 handles immediate invalidation on user disable/delete
- **WebSocket server** (`/ws`) has no authentication — not in scope for this story

### Project Structure Notes

- Frontend files under `components/gov-chat-frontend/src/`
- Backend files at `components/gov-chat-backend/` root (no `src/` subdirectory)
- Tests: frontend in `src/__tests__/`, backend in `__tests__/`
- Config: `src/config/oidcConfig.js` — no changes needed
- Worktree: `epic3-sessions` (branch `feature/epic3-sessions`)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 3.1] — AC and FR references
- [Source: _bmad-output/planning-artifacts/prd.md#FR17, FR35, NFR14] — Requirements
- [Source: _bmad-output/planning-artifacts/architecture.md#D5] — OIDC service pattern
- [Source: _bmad-output/planning-artifacts/architecture.md#Session Management] — Logout flow
- [Source: _bmad-output/implementation-artifacts/epic-2-retrospective.md] — Epic 2 learnings
- [Source: components/gov-chat-frontend/src/services/keycloakAuthService.js] — Current logout implementation
- [Source: components/gov-chat-frontend/src/store/modules/auth.js] — Vuex auth module
- [Source: components/gov-chat-frontend/src/router/index.js] — Router guard (bug)
- [Source: components/gov-chat-backend/controllers/authController.js] — Backend logout endpoint
- [Source: components/gov-chat-backend/middleware/keycloak-auth-middleware.js] — Auth middleware (PUBLIC_PATHS)

## Dev Agent Record

### Agent Model Used

glm-5-turbo (Claude Code)

### Debug Log References

- `src/router/index.js` was dead code — not imported by `main.js` (which imports `./router` → `src/router.js`). The production router already correctly dispatches `initialize`. File deleted.
- `jest.mock` with `__esModule: true` factory pattern required for authStore tests — Babel interop with `import` syntax needed explicit `__esModule` flag.

### Completion Notes List

- Task 1: Added `await manager.removeUser()` and `await manager.clearStaleState()` to `keycloakAuthService.logout()`, each wrapped in its own try/catch so failures don't prevent the subsequent cleanup steps.
- Task 2: Added `localStorage.removeItem('user')` and `localStorage.removeItem('auth_token')` in Vuex `logout` action's `finally` block — ensures cleanup even on error. Preference items (`sidebarOpen`, `theme`, `userLocale`, `fontSize`) are preserved.
- Task 3: `src/router/index.js` was dead code (not imported by `main.js`) — deleted instead of fixing. Production router (`src/router.js`) already correctly dispatches `initialize`. `App.vue` also dispatches `initialize` at mount — idempotent because router guard checks `isAuthInitialized`.
- Task 4: Backend logout now ends active ArangoDB sessions via `sessionService.getUserSessions(userId, true)` + `endSession()` loop. Session cleanup is non-critical (wrapped in try/catch, won't fail logout). Structured audit log emitted: `{ event: 'logout', timestamp, userId: iss#sub, issuer }`.
- Task 5-7: 13 new tests added (5 frontend keycloakAuthService, 8 authStore, 5 backend authController). All tests deterministic — verify call order, error resilience, and localStorage preservation.

### File List

- `components/gov-chat-frontend/src/services/keycloakAuthService.js` (modified)
- `components/gov-chat-frontend/src/store/modules/auth.js` (modified)
- `components/gov-chat-frontend/src/router/index.js` (deleted — dead code)
- `components/gov-chat-frontend/src/__tests__/keycloakAuthService.test.js` (modified)
- `components/gov-chat-frontend/src/__tests__/authStore.test.js` (new)
- `components/gov-chat-backend/controllers/authController.js` (modified)
- `components/gov-chat-backend/__tests__/authController.test.js` (new)
