# Story 1.7: Transparent Re-authentication on Session Expiry

Status: done

## Story

As an end user,
I want my session to be silently refreshed when my Keycloak token expires,
so that I don't need to manually re-authenticate during active use.

## Acceptance Criteria

1. **Silent Access Token Refresh (FR6)**
   - Given an authenticated user has an active session with a valid refresh token
   - When the access token expires
   - Then the `oidc-client-ts` UserManager silently refreshes the access token using the refresh token (FR6)
   - And the `keycloakAuthService` module-level `currentUser` is updated with the new token
   - And the Vuex auth module updates `accessToken` in state without user interaction

2. **Refresh Token Expiry Fallback**
   - Given the refresh token has also expired
   - When `automaticSilentRenew` attempts to refresh the access token
   - Then the `addSilentRenewError` event fires
   - And the user is redirected to the Keycloak login page

3. **Vuex State Synchronization**
   - Given a silent token refresh succeeds
   - When the UserManager fires `addUserLoaded` event
   - Then the Vuex auth module's `accessToken` state is updated to the new token value
   - And `isAuthenticated` remains `true`
   - And the user object (profile fields) is updated if changed

4. **In-Flight 401 Retry**
   - Given an API request fails with HTTP 401 due to an expired access token
   - When the response interceptor catches the 401
   - Then `keycloakAuthService.signinSilent()` is called to force a token refresh
   - And if successful, the original request is retried once with the new access token
   - And if `signinSilent()` fails (refresh token expired), the user is redirected to Keycloak login

## Tasks / Subtasks

- [x] Task 1: Add silent renew event listeners and signinSilent to keycloakAuthService.js (AC: #1, #2)
  - [x] In `initialize()`, after creating UserManager, register `addUserLoaded` callback that updates module-level `currentUser`
  - [x] In `initialize()`, register `addSilentRenewError` callback that calls `login()` to redirect to Keycloak login page
  - [x] Add `onAccessTokenUpdated(callback)` method — stores callback in a Set, invokes all registered callbacks when `addUserLoaded` fires (with updated User object as argument)
  - [x] Add `removeAccessTokenUpdatedCallback(callback)` method for cleanup
  - [x] Add `signinSilent()` method — calls `UserManager.signinSilent()`, updates `currentUser`, returns the refreshed User
  - [x] Store unsubscribe functions from `addUserLoaded` and `addSilentRenewError` for cleanup
  - [x] In `logout()`, call stored unsubscribe functions to remove event listeners before clearing user
  - [x] Ensure no localStorage/sessionStorage usage for tokens (NFR3)

- [x] Task 2: Update Vuex auth module to subscribe to silent renew events (AC: #1, #3)
  - [x] Add `updateAccessToken` mutation that updates `state.accessToken` with a new token value
  - [x] In `initialize` action (after successful user retrieval), register callback via `keycloakAuthService.onAccessTokenUpdated()`
  - [x] Callback should commit `updateAccessToken` with `user.access_token` and update `state.user` via `mapOidcUserToState`
  - [x] In `logout` action, call `keycloakAuthService.removeAccessTokenUpdatedCallback()` to clean up subscription
  - [x] Ensure `isAuthenticated` remains `true` after silent renew (don't call `clearAuth` or `setAuth`)

- [x] Task 3: Update httpService.js 401 retry with signinSilent (AC: #4)
  - [x] On 401 response (not 403), call `await keycloakAuthService.signinSilent()` to force a background token refresh
  - [x] If `signinSilent()` returns a user with a new access token, update `originalRequest.headers.Authorization` and retry the request once
  - [x] If `signinSilent()` returns null or throws (refresh token expired), redirect to Keycloak login via `keycloakAuthService.login()`
  - [x] Remove 403 from the retry logic — 403 is an authorization error, not a token expiry issue
  - [x] Keep existing `_retryCount` guard to prevent infinite retry loops
  - [x] Ensure only one retry attempt per request

- [x] Task 4: Write unit tests for keycloakAuthService silent renew (AC: #1, #2)
  - [x] Test: `initialize()` registers `addUserLoaded` event listener on UserManager
  - [x] Test: `addUserLoaded` callback updates module-level `currentUser` with new user data
  - [x] Test: `initialize()` registers `addSilentRenewError` event listener on UserManager
  - [x] Test: `addSilentRenewError` callback calls `login()` to redirect to Keycloak
  - [x] Test: `onAccessTokenUpdated(callback)` registers callback that is invoked on `addUserLoaded`
  - [x] Test: `removeAccessTokenUpdatedCallback(callback)` removes previously registered callback
  - [x] Test: `signinSilent()` calls `UserManager.signinSilent()` and returns refreshed user
  - [x] Test: `signinSilent()` updates `currentUser` with refreshed user
  - [x] Test: `logout()` removes event listeners (unsubscribe functions called)
  - [x] Mock UserManager events: add mock methods `events.addUserLoaded`, `events.addSilentRenewError`, `signinSilent`

- [x] Task 5: Write unit tests for Vuex auth module silent renew (AC: #3)
  - [x] Test: `initialize` action registers callback via `onAccessTokenUpdated` when user exists
  - [x] Test: registered callback commits `updateAccessToken` mutation with new token
  - [x] Test: registered callback updates user state via `mapOidcUserToState`
  - [x] Test: `initialize` action does NOT register callback when no user
  - [x] Test: `logout` action calls `removeAccessTokenUpdatedCallback` for cleanup
  - [x] Test: `updateAccessToken` mutation updates `state.accessToken` without affecting other state

- [x] Task 6: Write unit tests for httpService.js 401 retry (AC: #4)
  - [x] Test: 401 response triggers `signinSilent()` call
  - [x] Test: successful `signinSilent()` retries request with new token
  - [x] Test: failed `signinSilent()` (returns null) redirects to Keycloak login
  - [x] Test: failed `signinSilent()` (throws) redirects to Keycloak login
  - [x] Test: 403 response does NOT trigger `signinSilent()` (authorization error, not token issue)
  - [x] Test: request is not retried more than once (`_retryCount` guard)
  - [x] Test: non-401 errors are not affected by retry logic

- [x] Task 7: Run full test suite and verify
  - [x] Run `cd components/gov-chat-frontend && npx jest --verbose`
  - [x] Verify all existing tests still pass (no regressions from changes)
  - [x] Verify all new tests pass
  - [x] Run backend tests to confirm no cross-component breakage: `cd components/gov-chat-backend && npx jest`

## Dev Notes

### Architecture Decisions (from architecture.md)

**D5 — OIDC integration: Standalone service class**
- `keycloakAuthService.js` wraps `oidc-client-ts` UserManager
- Vuex auth module consumes the service via actions
- Token storage: in-memory only (NFR3)

**Key oidc-client-ts API for this story:**

| API | Purpose |
|-----|---------|
| `automaticSilentRenew: true` | Already configured in oidcConfig.js — enables automatic background token refresh |
| `UserManager.events.addUserLoaded(cb)` | Fires when a new user is loaded (including after silent renew) — callback receives `User` object |
| `UserManager.events.addSilentRenewError(cb)` | Fires when silent renew fails (refresh token expired) — callback receives `Error` object |
| `UserManager.signinSilent()` | Manually trigger a silent token refresh via iframe — returns `Promise<User \| null>` |
| `accessTokenExpiringNotificationTimeInSeconds` | Default 60 seconds — triggers silent renew before token expires |

**Silent renew mechanism:**
- When `automaticSilentRenew: true` is set, oidc-client-ts creates a `SilentRenewService` internally
- Before the access token expires (default: 60 seconds before), it opens a hidden iframe to Keycloak's authorization endpoint with `prompt=none`
- Keycloak responds with a new token if the refresh token is valid
- The `addUserLoaded` event fires with the refreshed `User` object
- No page reload, no user interaction — completely transparent

**401 retry mechanism:**
- When an API request fails with 401 (token expired before silent renew kicked in, or silent renew was too slow)
- `signinSilent()` forces an immediate background token refresh
- If successful, the original request is retried with the new token
- If the refresh token is also expired, `signinSilent()` returns null — redirect to Keycloak login

### Key Technical Details

**Current `keycloakAuthService.js` state (to be modified):**
- Module-level `currentUser` variable stores the OIDC user
- `getAccessToken()` reads from `currentUser?.access_token`
- `initialize()` creates UserManager and calls `getUser()` — but does NOT register event listeners
- No `signinSilent()` method exists
- No callback mechanism for external subscribers (Vuex store)

**Current `httpService.js` 401 handling (to be fixed):**
- Lines 99-126: On 401/403, calls `keycloakAuthService.getUser()` then reads `user?.access_token`
- This does NOT trigger a token refresh — it just reads the current (expired) user
- Both 401 AND 403 trigger the same logic — 403 should NOT trigger token refresh
- The fix: replace `getUser()` with `signinSilent()`, remove 403 from retry logic

**Current `oidcConfig.js`:**
- `automaticSilentRenew: true` — already configured (Story 1-4)
- No `silent_redirect_uri` — oidc-client-ts uses iframe-based approach by default (sufficient for Keycloak)
- No `accessTokenExpiringNotificationTimeInSeconds` — uses default 60 seconds

**Current Vuex auth module (`store/modules/auth.js`):**
- `initialize` action calls `keycloakAuthService.initialize()` and sets auth state
- No subscription to silent renew events — `accessToken` is only set during `initialize()` and `handleCallback()`
- No `updateAccessToken` mutation exists

**Event flow for silent renew:**
```
Access token approaching expiry (60s before)
  → SilentRenewService triggers signinSilent via iframe
  → Keycloak validates refresh token
  → New access token returned
  → UserManager stores new User internally
  → addUserLoaded event fires with new User
  → keycloakAuthService updates currentUser
  → keycloakAuthService invokes registered callbacks
  → Vuex store commits updateAccessToken
  → Components reading accessToken getter get new value
```

**Event flow for silent renew failure:**
```
Access token approaching expiry (60s before)
  → SilentRenewService triggers signinSilent via iframe
  → Keycloak rejects (refresh token expired)
  → addSilentRenewError event fires with Error
  → keycloakAuthService calls login()
  → User redirected to Keycloak login page
```

**Event flow for 401 retry:**
```
API request with expired access token
  → Backend returns 401
  → httpService interceptor catches 401
  → Calls keycloakAuthService.signinSilent()
  → If successful: updates currentUser, retries request with new token
  → If failed: calls keycloakAuthService.login() → redirect to Keycloak
```

### What This Story Does NOT Cover (deferred to later stories)

- **Story 1.8:** Standardized error response format (backend error codes — this story only handles frontend)
- **Story 2.6:** Auth & authorization error display (user-facing error messages for auth failures)
- **Story 2.7:** Keycloak unavailable detection (health check — unrelated to token refresh)
- **Story 3.2:** Session invalidation on user disable/delete (Keycloak revokes refresh token — this story's `addSilentRenewError` naturally handles the redirect)
- **Story 3.1:** User logout (explicit logout — separate from silent renew failure)

### Files to Create

| File | Purpose |
|------|---------|
| `components/gov-chat-frontend/src/__tests__/httpService-401-retry.test.js` | Unit tests for httpService 401 retry with signinSilent |

### Files to Modify

| File | Change |
|------|--------|
| `components/gov-chat-frontend/src/services/keycloakAuthService.js` | Add event listeners (addUserLoaded, addSilentRenewError), onAccessTokenUpdated, removeAccessTokenUpdatedCallback, signinSilent, cleanup in logout |
| `components/gov-chat-frontend/src/store/modules/auth.js` | Add updateAccessToken mutation, subscribe to silent renew in initialize and handleCallback, extract registerSilentRenewCallback helper, cleanup in logout |
| `components/gov-chat-frontend/src/services/httpService.js` | Replace getUser() with signinSilent() on 401, remove 403 from retry logic, await login() call |
| `components/gov-chat-frontend/src/__tests__/keycloakAuthService.test.js` | Extend with tests for event listeners, signinSilent, onAccessTokenUpdated |
| `components/gov-chat-frontend/src/__tests__/store/modules/auth.test.js` | Extend with tests for silent renew subscription, handleCallback callback registration, re-initialize cleanup, updateAccessToken mutation |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | Update story status from in-progress to review |

### Files NOT Modified (intentionally)

| File | Reason |
|------|--------|
| `components/gov-chat-frontend/src/config/oidcConfig.js` | `automaticSilentRenew: true` already configured in Story 1-4 — no changes needed |
| `components/gov-chat-frontend/src/views/CallbackView.vue` | Silent renew uses iframe internally — callback page not involved |
| `components/gov-chat-frontend/src/router.js` | No routing changes — silent renew is transparent |
| `components/gov-chat-frontend/src/App.vue` | No changes — initialization already handled |
| `components/gov-chat-backend/**` | No backend changes — this story is frontend-only |

### Previous Story Intelligence (Story 1-6)

**Key patterns established:**
- Story 1-6 was backend-only (JIT provisioning, ArangoDB UPSERT)
- No frontend changes in 1-6 — the frontend state is exactly as left by Story 1-5
- Story 1-4 created `keycloakAuthService.js` and `oidcConfig.js` — both are stable
- Story 1-5 created `CallbackView.vue` and updated router guard — stable

**From Story 1-4 (frontend OIDC service):**
- `oidc-client-ts` v3.5.0 installed — ESM library
- `automaticSilentRenew: true` set in oidcConfig.js
- UserManager created in `initialize()` — stored in module-level `userManager` variable
- `currentUser` module-level variable tracks the OIDC user
- `getAccessToken()` reads from `currentUser?.access_token`
- Token storage is in-memory only (NFR3)
- Jest configured with babel-jest, @vue/vue3-jest, moduleNameMapper for `@/`

**From Story 1-5 (frontend login redirect):**
- Router guard waits for `isAuthInitialized` before making routing decisions
- `CallbackView.vue` dispatches `handleCallback` on mount
- NavBarComponent logout calls `store.dispatch('logout')`

**Lessons from code reviews (all stories):**
- `__esModule: true` required in jest.mock for ES default imports (frontend only)
- `jest.mock()` for oidc-client-ts uses `MockUserManager` constructor pattern
- `createMockUser()` helper creates realistic OIDC user objects for tests
- Vue 3 Options API only — NOT Composition API
- ES modules with `@/` path alias for imports

**Current httpService.js 401 handling issue:**
- Lines 104-110: On 401, calls `getUser()` then reads `user?.access_token`
- This is BROKEN for expired tokens — `getUser()` returns the expired user, `access_token` is still the old (expired) token
- The retry with the old token will also fail with 401
- The fix in this story: replace with `signinSilent()` which actually refreshes the token

### Frontend Conventions (from project-context.md)

- **Vue 3 Options API** — NOT Composition API, NOT `<script setup>`
- **ES modules** with `@/` path alias for imports
- **2-space indentation, single quotes, semicolons**
- **i18n**: Use `translate('key.path', 'default text')` for user-facing text
- **No TypeScript** — plain JavaScript
- **Jest**: `src/__tests__/`, `*.test.js`, `describe/it/expect`, `jest.mock()` for services
- **Vuex**: Non-namespaced module — `mapGetters`, `mapActions` in components

### Testing Strategy

**keycloakAuthService silent renew tests:**
- Extend existing `keycloakAuthService.test.js` mock pattern
- Add mock methods to MockUserManager: `events: { addUserLoaded, addSilentRenewError }`, `signinSilent`
- `addUserLoaded` and `addSilentRenewError` must return unsubscribe functions (matching oidc-client-ts API)
- Test that `initialize()` calls `events.addUserLoaded()` and `events.addSilentRenewError()`
- Simulate silent renew: call the stored `addUserLoaded` callback with a new user, verify `currentUser` is updated
- Test `onAccessTokenUpdated`: register callback, trigger `addUserLoaded`, verify callback invoked with new user
- Test `signinSilent()`: mock UserManager method, verify it's called and result returned
- Test `logout()`: verify unsubscribe functions are called

**Mock pattern for UserManager events (required for Task 4):**
```javascript
const mockSigninSilent = jest.fn();
const mockAddUserLoaded = jest.fn(() => jest.fn()); // returns unsubscribe fn
const mockAddSilentRenewError = jest.fn(() => jest.fn()); // returns unsubscribe fn
const MockUserManager = jest.fn().mockImplementation(() => ({
  getUser: mockGetUser,
  signinRedirect: mockSigninRedirect,
  signinRedirectCallback: mockSigninRedirectCallback,
  signoutRedirect: mockSignoutRedirect,
  signinSilent: mockSigninSilent,
  events: {
    addUserLoaded: mockAddUserLoaded,
    addSilentRenewError: mockAddSilentRenewError
  }
}));
```
Note: `addUserLoaded` and `addSilentRenewError` return unsubscribe functions because oidc-client-ts follows the subscribe/unsubscribe pattern.

**Vuex auth module silent renew tests:**
- Extend existing `auth.test.js` mock pattern
- Add `onAccessTokenUpdated` and `removeAccessTokenUpdatedCallback` to mock
- Test `initialize` registers callback when user exists
- Simulate callback invocation, verify `updateAccessToken` mutation committed
- Test `logout` calls `removeAccessTokenUpdatedCallback`

**httpService.js 401 retry tests:**
- New test file `src/__tests__/httpService-401-retry.test.js`
- Mock axios and keycloakAuthService
- Create httpService instance (or import singleton)
- Test 401 triggers `signinSilent()` and retries on success
- Test 401 redirects to login on `signinSilent()` failure
- Test 403 does NOT trigger `signinSilent()`
- Test request not retried more than once

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#D5] — Frontend OIDC service class decision
- [Source: _bmad-output/planning-artifacts/architecture.md#Vuex Auth Module State Shape] — Mandatory state shape
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.7] — BDD acceptance criteria
- [Source: _bmad-output/planning-artifacts/prd.md#FR6] — Transparent re-authentication requirement
- [Source: _bmad-output/planning-artifacts/prd.md#NFR3] — Tokens in browser memory only
- [Source: _bmad-output/project-context.md] — Frontend conventions (Options API, ES modules, no TS)
- [Source: components/gov-chat-frontend/src/services/keycloakAuthService.js] — Current OIDC service to extend
- [Source: components/gov-chat-frontend/src/store/modules/auth.js] — Current Vuex auth module to update
- [Source: components/gov-chat-frontend/src/services/httpService.js] — Current HTTP service to fix
- [Source: components/gov-chat-frontend/src/config/oidcConfig.js] — OIDC config (automaticSilentRenew already set)
- [Source: oidc-client-ts docs] — UserManager events API (addUserLoaded, addSilentRenewError, signinSilent)
- [Source: _bmad-output/implementation-artifacts/1-4-frontend-oidc-service-class-and-vuex-auth-module.md] — Story 1-4 implementation notes
- [Source: _bmad-output/implementation-artifacts/1-5-frontend-login-redirect-and-auth-guard.md] — Story 1-5 implementation notes

## Dev Agent Record

### Agent Model Used

GLM-5-Turbo (implementation + code review)

### Debug Log References

### Completion Notes List

- Task 1-2: Implemented in previous context window. keycloakAuthService got silent renew event listeners, signinSilent(), callback mechanism. Vuex auth module got updateAccessToken mutation and silent renew subscription in initialize.
- Task 3: httpService 401 retry test mock required 3 iterations — singleton interceptor chain cannot be tested through axios mock. Solution: test handleResponseError directly, mock axios as callable jest.fn().
- Code review found H1 (handleCallback missing silent renew callback registration) — fixed by extracting registerSilentRenewCallback helper used by both initialize and handleCallback.
- Code review found H2 (login() not awaited in httpService) — fixed with await.
- Code review found M1 (silentRenewCallback leaks between tests) — fixed by having registerSilentRenewCallback clean up existing callback before registering new one.
- M2 (accessTokenCallbacks not cleared on logout) evaluated and dismissed — consumer (Vuex) properly cleans up via removeAccessTokenUpdatedCallback.
- M3 (tests bypass interceptor chain) evaluated and dismissed — direct method testing is valid unit test strategy.

### Change Log

- 2026-04-01: Code review fixes applied (H1, H2, M1, L1, L2). 4 new regression tests added.

### File List

| File | Action | Lines Changed |
|------|--------|---------------|
| `components/gov-chat-frontend/src/services/keycloakAuthService.js` | Modified | +50 (event listeners, signinSilent, callbacks, cleanup) |
| `components/gov-chat-frontend/src/store/modules/auth.js` | Modified | +35 (updateAccessToken, registerSilentRenewCallback, handleCallback registration) |
| `components/gov-chat-frontend/src/services/httpService.js` | Modified | ~10 (signinSilent retry, remove 403, await login) |
| `components/gov-chat-frontend/src/__tests__/keycloakAuthService.test.js` | Modified | +90 (11 new tests for silent renew) |
| `components/gov-chat-frontend/src/__tests__/store/modules/auth.test.js` | Modified | +70 (9 new tests for silent renew + handleCallback + re-init cleanup) |
| `components/gov-chat-frontend/src/__tests__/httpService-401-retry.test.js` | Created | 160 (7 tests for 401 retry behavior) |
| `_bmad-output/implementation-artifacts/sprint-status.yaml` | Modified | 1 (status update) |
