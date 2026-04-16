# Story 1.5: Frontend Login Redirect & Auth Guard

Status: done

## Story

As an end user,
I want to be automatically redirected to the Keycloak login page when I'm not authenticated,
so that I don't need to navigate to a GENIE.AI-specific login page.

## Acceptance Criteria

1. **Automatic Redirect to Keycloak (FR26)**
   - Given an unauthenticated user visits any protected frontend route
   - When the Vue router navigation guard triggers
   - Then the user is redirected to the Keycloak login page (not `/login`)
   - And after successful authentication, the user is redirected back to the originally requested route

2. **OIDC Callback Handling**
   - Given the user has authenticated via Keycloak
   - When Keycloak redirects back to the callback URL (`/callback`)
   - Then the Vuex auth module processes the callback and sets authenticated state
   - And the user is redirected to their originally requested route (or `/dashboard` as default)

3. **No GENIE.AI Login Page (FR26)**
   - Given the Keycloak auth flow is active
   - When an unauthenticated user visits any route
   - Then no GENIE.AI-specific login page is shown
   - And legacy login routes (`/login`, `/register`, `/forgot-password`, `/reset-password/:token`) are removed or redirect to Keycloak

4. **Auth Guard Waits for Initialization**
   - Given the app is initializing (OIDC service checking for existing session)
   - When a user visits any route before initialization completes
   - Then the navigation guard waits for `isAuthInitialized` before making routing decisions
   - And the user is not incorrectly redirected to login while initialization is in progress

5. **Performance (NFR20)**
   - Given normal network conditions
   - When the full OIDC flow executes (browser → Keycloak → callback → authenticated state)
   - Then it completes within 3 seconds

6. **Browser Compatibility (NFR24)**
   - Given the login redirect and OIDC flow
   - When tested on the latest 2 versions of Chrome, Firefox, Safari, and Edge
   - Then the flow works correctly on all supported browsers

## Tasks / Subtasks

- [x] Task 1: Create OIDC callback route and handler (AC: #2)
  - [x]Add `/callback` route to `src/router.js` with a lightweight CallbackView component
  - [x]CallbackView calls `store.dispatch('handleCallback')` on mount
  - [x]On success, redirect to `router.currentRoute.value.query.returnUrl || '/dashboard'`
  - [x]On error, redirect to `/` (root) which triggers auth guard → Keycloak login
  - [x]Mark callback route with `meta: { requiresAuth: false }` (public route)

- [x] Task 2: Replace router navigation guard with Keycloak-based guard (AC: #1, #4)
  - [x]Replace the existing `beforeEach` guard in `src/router.js`
  - [x]New guard logic:
    1. Wait for `store.getters.isAuthInitialized` before making routing decisions
    2. If route requires auth and user is NOT authenticated → `keycloakAuthService.login({ returnUrl: to.fullPath })`
    3. If route does NOT require auth → `next()`
    4. Remove legacy login/register/forgot-password route guards (redirect authenticated users away from login)
  - [x]Remove `userService.isAuthenticated()` references from router
  - [x]Remove `store.dispatch('initAuth')` call from router (initialization is in App.vue mounted hook)

- [x] Task 3: Remove legacy auth routes and components from router (AC: #3)
  - [x]Remove routes: `/login`, `/register`, `/forgot-password`, `/reset-password/:token`, `/registration-success`, `/verify-email-success`, `/verify-email/:token`
  - [x]Remove imports of: LoginScreen, RegisterScreen, PasswordResetInitiateScreen, PasswordResetConfirmScreen, RegistrationSuccessScreen, EmailVerificationScreen
  - [x]Remove import of `userService` from router.js
  - [x]Update root `/` redirect to `/dashboard` (no auth check — auth guard handles it)
  - [x]Update catch-all `/:pathMatch(.*)*` to redirect to `/dashboard` (auth guard handles unauthenticated redirect)

- [x] Task 4: Update App.vue to remove LoginScreen usage (AC: #3)
  - [x]Remove LoginScreen import and component registration
  - [x]Remove the `<login-screen>` block from template (the `v-else-if="!isLoading && !isAuthenticated"` branch)
  - [x]The auth guard now handles unauthenticated users via Keycloak redirect — no fallback login screen needed
  - [x]Keep the loading screen (`v-if="isLoading"`) and authenticated content (`v-else-if="isAuthenticated && currentUser`)

- [x] Task 5: Update NavBarComponent.vue logout handler (AC: #3)
  - [x]Replace `userService.logout()` + `localStorage.removeItem('user')` + `window.location.href = '/login'` with `store.dispatch('logout')`
  - [x]The Vuex logout action already calls `keycloakAuthService.logout()` which redirects to Keycloak logout endpoint
  - [x]Remove direct `localStorage.removeItem` calls (tokens are in-memory only — NFR3)

- [x] Task 6: Write unit tests
  - [x]Test router navigation guard: unauthenticated → login redirect (mock keycloakAuthService)
  - [x]Test router navigation guard: authenticated → allows protected route
  - [x]Test router navigation guard: waits for initialization before deciding
  - [x]Test callback route: dispatches handleCallback and redirects on success
  - [x]Test callback route: redirects to root on error

## Dev Notes

### Architecture Decisions (from architecture.md)

**D5 — OIDC integration: Standalone service class**
- `keycloakAuthService.login()` handles the redirect to Keycloak
- `keycloakAuthService.handleCallback()` processes the authorization code
- The router guard calls `login({ returnUrl })` which passes the return URL as custom state to Keycloak

**Router Guard Flow (this story):**
```
User visits protected route
  → beforeEach guard triggers
  → Wait for isAuthInitialized
  → If not authenticated → keycloakAuthService.login({ returnUrl: to.fullPath })
  → Browser redirects to Keycloak login page
  → User authenticates (SSO or local credentials)
  → Keycloak redirects back to /callback?code=...&state=...
  → CallbackView mounts → store.dispatch('handleCallback')
  → handleCallback processes code → sets isAuthenticated = true
  → Redirect to returnUrl from state (or /dashboard default)
  → beforeEach guard allows navigation (user is now authenticated)
```

### Key Technical Details

**Current router.js state (to be replaced):**
- Has `beforeEach` guard that checks `store.getters.isAuthenticated || userService.isAuthenticated()`
- Calls `store.dispatch('initAuth')` inside the guard (this is wrong — initialization is in App.vue)
- Redirects to `/login?redirect=...&error=...` for unauthenticated users
- Has many legacy routes: `/login`, `/register`, `/forgot-password`, `/reset-password/:token`, etc.

**What changes:**
- `beforeEach` guard: wait for `isAuthInitialized`, then check `isAuthenticated`, then redirect to Keycloak (not `/login`)
- Remove ALL legacy auth routes (login, register, password reset, email verification)
- Add `/callback` route for OIDC authorization code processing
- Root `/` always redirects to `/dashboard` (auth guard handles the Keycloak redirect)
- No more `userService` references in router

**CallbackView component:**
- Minimal component — no UI, just logic in `mounted()` hook
- Calls `store.dispatch('handleCallback')`
- On success: reads return URL from Keycloak state and redirects via `router.replace()`
- On error: redirects to `/` which triggers the auth guard → Keycloak login

**State preservation during callback:**
- `oidc-client-ts` `signinRedirect({ state: { returnUrl } })` encodes the return URL in the OAuth `state` parameter
- `signinRedirectCallback()` returns the user AND the state
- The Vuex `handleCallback` action should return the state so CallbackView can extract `returnUrl`
- **IMPORTANT**: The current `handleCallback` action in `src/store/modules/auth.js` does NOT return the state — it only returns the user. The `signinRedirectCallback()` from oidc-client-ts returns `{ user, state }`. The action needs to be updated to extract and return the state.

**Performance consideration (NFR20):**
- The 3-second target is for the full OIDC flow — this is primarily a Keycloak + network constraint
- The router guard itself adds negligible overhead (simple state check)
- No performance optimization needed in frontend code — Keycloak must be responsive

### Critical: handleCallback must return state

The current `handleCallback` action in `src/store/modules/auth.js`:
```javascript
async handleCallback({ commit }) {
  const user = await keycloakAuthService.handleCallback();
  // ... commits auth state
  return user;  // ← does NOT return state
}
```

The `signinRedirectCallback()` from oidc-client-ts returns `{ user, state }`. The action MUST be updated to return the state so CallbackView can redirect to the original URL. Modify `keycloakAuthService.handleCallback()` to return the full result including state, and pass it through the Vuex action.

### What This Story Does NOT Cover (deferred to later stories)

- **Story 1.7:** Transparent re-authentication on session expiry (silent refresh + 401 retry)
- **Story 1.11:** Remove legacy auth components (LoginScreen.vue, RegisterScreen.vue files themselves — this story only removes them from the router)
- **Story 2.6:** Auth & authorization error display (frontend error messages for failed auth)

### Files to Create

| File | Purpose |
|------|---------|
| `src/views/CallbackView.vue` | Minimal OIDC callback handler component |
| `src/__tests__/router.test.js` | Unit tests for router navigation guard |

### Files to Modify

| File | Change |
|------|--------|
| `src/router.js` | Replace navigation guard, remove legacy routes, add /callback route |
| `src/store/modules/auth.js` | Update handleCallback to return state from signinRedirectCallback |
| `src/services/keycloakAuthService.js` | Update handleCallback to return full result including state |
| `src/App.vue` | Remove LoginScreen import and template usage |
| `src/components/NavBarComponent.vue` | Update logout handler to use store.dispatch('logout') |

### Files NOT Modified (intentionally)

| File | Reason |
|------|--------|
| `src/components/LoginScreen.vue` | Still exists on disk — removed in Story 1.11 |
| `src/components/RegisterScreen.vue` | Still exists on disk — removed in Story 1.11 |
| `src/services/authService.js` | Still used by other parts — removed in Story 1.11 |
| `src/services/userService.js` | Used by NavBarComponent and other components — only remove router reference |
| `src/config/oidcConfig.js` | No changes needed — callback URL already configured |

### Previous Story Intelligence (Story 1-4)

**Key patterns established:**
- `keycloakAuthService.login({ returnUrl })` → passes returnUrl as `{ state: { returnUrl } }` to signinRedirect
- `keycloakAuthService.handleCallback()` → calls `signinRedirectCallback()` which returns `{ user, state }`
- Vuex auth module is non-namespaced (App.vue uses `mapGetters(['isAuthenticated', 'currentUser'])`)
- `isAuthInitialized` getter available for checking initialization state
- Token storage is in-memory only (NFR3) — no localStorage for tokens
- Jest configured with babel-jest, @vue/vue3-jest, moduleNameMapper for `@/`

**Lessons learned from code review:**
- httpService.js retry logic was simplified — redirect to `keycloakAuthService.login()` on 401/403
- Trailing slash handling added to oidcConfig.js keycloakUrl
- `handleCallback` in keycloakAuthService now has try/catch for error cleanup
- `__esModule: true` required in jest.mock for ES default imports
- epics.md has inconsistency: says `isLoggedIn` but code uses `isAuthenticated` — code is authoritative (matches architecture.md)

**Current NavBarComponent.vue logout handler:**
- Calls `userService.logout()` (old auth system)
- Manually clears `localStorage.removeItem('user')` and `localStorage.removeItem('token')`
- Redirects to `/login` via `window.location.href`
- All of this needs to be replaced with `store.dispatch('logout')`

### Frontend Conventions (from project-context.md)

- **Vue 3 Options API** — NOT Composition API, NOT `<script setup>`
- **ES modules** with `@/` path alias for imports
- **2-space indentation, single quotes, semicolons**
- **i18n**: Use `translate('key.path', 'default text')` for user-facing text
- **No TypeScript** — plain JavaScript
- **Jest**: `src/__tests__/`, `*.test.js`, `describe/it/expect`, `jest.mock()` for services

### Testing Strategy

**Router guard tests:**
- Uses real `createRouter` + `createStore` with the actual `beforeEach` guard logic
- Mock `keycloakAuthService` (login) and Vuex auth actions (initialize)
- `navigateTo()` helper handles Vue Router 4's NavigationFailure resolution behavior
- Test navigation to protected route when unauthenticated → verify login called with returnUrl
- Test navigation to protected route when authenticated → verify navigation succeeds
- Test navigation when not yet initialized → verify initialize dispatched and awaited
- Test navigation to public route → verify no auth check

**CallbackView tests:**
- Deliberate simulation (not SFC mount) — CallbackView is a 5-line component with no UI to assert
- Tests verify the dispatch/redirect logic pattern that CallbackView implements
- Mock store dispatch ('handleCallback')
- Test successful callback → verify redirect to returnUrl
- Test callback error → verify redirect to root
- Test callback with no returnUrl in state → verify redirect to /dashboard

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#D5] — Frontend OIDC service class decision
- [Source: _bmad-output/planning-artifacts/architecture.md#Vuex Auth Module State Shape] — isAuthInitialized getter
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture] — File structure
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.5] — BDD acceptance criteria
- [Source: _bmad-output/planning-artifacts/prd.md#FR26] — No GENIE.AI-specific login page
- [Source: _bmad-output/planning-artifacts/prd.md#NFR20] — 3 second OIDC flow target
- [Source: _bmad-output/planning-artifacts/prd.md#NFR24] — Browser compatibility
- [Source: _bmad-output/project-context.md] — Frontend conventions (Options API, ES modules)
- [Source: components/gov-chat-frontend/src/router.js] — Current router to replace
- [Source: components/gov-chat-frontend/src/services/keycloakAuthService.js] — OIDC service (login, handleCallback)
- [Source: components/gov-chat-frontend/src/store/modules/auth.js] — Vuex auth module (handleCallback action)
- [Source: components/gov-chat-frontend/src/App.vue] — Current LoginScreen usage
- [Source: components/gov-chat-frontend/src/components/NavBarComponent.vue] — Current logout handler

## Dev Agent Record

### Agent Model Used

GLM-5-Turbo

### Debug Log References

### Completion Notes List

- All 6 tasks completed. 59/59 unit tests passing (50 from story 1-4 + 9 new).
- Router guard rewritten: waits for `isAuthInitialized`, redirects to `keycloakAuthService.login({ returnUrl })` for unauthenticated users
- CallbackView created as minimal component — dispatches `handleCallback`, redirects to `user.state.returnUrl || '/dashboard'`
- oidc-client-ts `signinRedirectCallback()` returns a `User` object with `user.state` containing custom state — no service changes needed
- All legacy auth routes removed from router (`/login`, `/register`, `/forgot-password`, `/reset-password/:token`, email verification, registration success)
- LoginScreen import and template block removed from App.vue
- NavBarComponent logout handler simplified to `store.dispatch('logout')` + emit
- Root and catch-all redirects now point to `/dashboard` (auth guard handles unauthenticated redirect)
- NavBarComponent had orphaned catch block after old handleLogout removal — cleaned up
- Code review fixes (round 1): removed dead `userService` import and `handleLoginSuccess()` from App.vue; rewrote router tests to use real Vue Router + Vuex store instead of simulateGuard pattern; removed keycloakAuthService.js from modified files list (JSDoc-only change)
- Code review fixes (round 2): fixed stale task checkboxes (Tasks 2-6 parent `[ ]` → `[x]`); reverted keycloakAuthService.js JSDoc change (invalid `User` type, no functional value, eliminated git diff noise); documented CallbackView test simulation as deliberate design choice

### File List

**Created:**
- `components/gov-chat-frontend/src/views/CallbackView.vue` — Minimal OIDC callback handler
- `components/gov-chat-frontend/src/__tests__/router.test.js` — 9 tests for router guard and callback

**Modified:**
- `components/gov-chat-frontend/src/router.js` — Replaced entirely: new guard, removed legacy routes, added /callback
- `components/gov-chat-frontend/src/App.vue` — Removed LoginScreen import/template, removed dead `userService` import and `handleLoginSuccess` method
- `components/gov-chat-frontend/src/components/NavBarComponent.vue` — Simplified logout handler
