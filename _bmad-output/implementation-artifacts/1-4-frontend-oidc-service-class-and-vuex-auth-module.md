# Story 1.4: Frontend OIDC Service Class & Vuex Auth Module

Status: done

## Story

As an end user,
I want to authenticate via Keycloak using my institutional or local credentials,
so that I can access GENIE.AI without creating a separate account.

## Acceptance Criteria

1. **OIDC Service Initialization (NFR1, NFR3)**
   - Given the frontend is running and Keycloak is available
   - When the OIDC service `src/services/keycloakAuthService.js` initializes
   - Then it creates a `UserManager` from `oidc-client-ts` with PKCE enabled
   - And access tokens are stored in JavaScript memory only — never in localStorage, sessionStorage, or cookies
   - And the OIDC service communicates with Keycloak over TLS 1.2+

2. **Vuex Auth Module Replacement**
   - Given the new OIDC service is implemented
   - When the Vuex auth module is loaded
   - Then it replaces the existing auth module entirely (no coexistence)
   - And the auth module exposes `isAuthenticated`, `user`, `accessToken` as computed state
   - And both SSO (institutional credentials) and local Keycloak credentials work (FR1, FR2)

3. **Service Contract & Configuration**
   - Given the OIDC configuration is loaded from environment/runtime config
   - When `keycloakAuthService` methods are called
   - Then `initialize()`, `login()`, `logout()`, `handleCallback()`, `getUser()`, `getAccessToken()`, `isAuthenticated()` are all functional
   - And configuration reads from `window.APP_CONFIG` (runtime) with VUE_APP_ env var fallback

4. **State Shape Consistency with Backend**
   - Given a user has authenticated via Keycloak
   - When the Vuex auth module populates user state
   - Then the user object contains `{ iss_sub, sub, iss, email, name, roles }` matching the backend `req.user` shape
   - And `accessToken` is available as a top-level state property

## Tasks / Subtasks

- [x] Task 1: Create OIDC configuration module (AC: #3)
  - [x] Create `src/config/oidcConfig.js` with authority, client_id, redirect_uri, post_logout_redirect_uri, response_type, scope, automaticSilentRenew
  - [x] Read from `window.APP_CONFIG?.keycloak` with `VUE_APP_KEYCLOAK_*` env var fallbacks
  - [x] Ensure PKCE is enabled (default in oidc-client-ts for Authorization Code flow)
- [x] Task 2: Create keycloakAuthService.js (AC: #1, #3)
  - [x] Create `src/services/keycloakAuthService.js` wrapping `oidc-client-ts` UserManager
  - [x] Implement `initialize()` — creates UserManager, calls `getUser()` to check existing session
  - [x] Implement `login()` — calls `signinRedirect()` with optional custom state for return URL
  - [x] Implement `logout()` — calls `signoutRedirect()` with post_logout_redirect_uri
  - [x] Implement `handleCallback()` — calls `signinRedirectCallback()` to process auth code
  - [x] Implement `getUser()` — returns User profile from UserManager
  - [x] Implement `getAccessToken()` — returns access_token string from current User
  - [x] Implement `isAuthenticated()` — returns boolean based on User existence and token validity
  - [x] Ensure tokens are in-memory only (no `storeAuthStateInCookie`, no localStorage/sessionStorage for tokens)
  - [x] Configure `automaticSilentRenew: true` for transparent token refresh
- [x] Task 3: Replace Vuex auth module (AC: #2, #4)
  - [x] Replace `src/store/modules/auth.js` entirely — no coexistence with old auth
  - [x] New state shape: `{ isAuthenticated: false, user: null, accessToken: null, error: null, isInitialized: false }`
  - [x] New getters: `isAuthenticated`, `currentUser`, `accessToken`, `authError`, `isAuthInitialized`
  - [x] New actions: `initialize` (calls keycloakAuthService.initialize), `login` (calls keycloakAuthService.login), `logout` (calls keycloakAuthService.logout), `handleCallback` (calls keycloakAuthService.handleCallback), `clearError`
  - [x] User object shape: `{ iss_sub, sub, iss, email, name, preferred_username, roles }`
  - [x] Derive `iss_sub` from OIDC User profile (`profile.iss + '#' + profile.sub`)
  - [x] Extract `roles` from `profile.realm_access?.roles || []`
- [x] Task 4: Update httpService.js for OIDC token injection (AC: #3)
  - [x] Replace localStorage-based token reading in request interceptor
  - [x] Import and use keycloakAuthService.getAccessToken() for Authorization header
  - [x] Keep existing 401/403 error handling but simplify — redirect to Keycloak login instead of `/login`
- [x] Task 5: Update App.vue initialization (AC: #2)
  - [x] Replace `this.$store.dispatch('initAuth')` with `this.$store.dispatch('initialize')`
  - [x] Handle async initialization (await keycloakAuthService before rendering)
  - [x] Keep existing loading/splash screen logic
- [x] Task 6: Install dependencies (AC: #1)
  - [x] Add `oidc-client-ts` to package.json dependencies
- [x] Task 7: Write unit tests
  - [x] Test keycloakAuthService.js — mock UserManager, verify all public methods
  - [x] Test Vuex auth module — mock keycloakAuthService, verify state transitions
  - [x] Test oidcConfig.js — verify config resolution from env/runtime

## Dev Notes

### Architecture Decisions (from architecture.md)

**D5 — OIDC integration: Standalone service class**
- Pattern: `src/services/keycloakAuthService.js` wrapping `oidc-client-ts` UserManager
- Rationale: Follows existing project convention (services in `src/services/`). Separation of concerns. Testable in isolation. Vuex store consumes the service via actions.
- Token storage: In-memory only (NFR3) — `oidc-client-ts` configured with `storeAuthStateInCookie: false`, no `localStorage`/`sessionStorage`
- Exposed methods: `initialize()`, `login()`, `logout()`, `handleCallback()`, `getUser()`, `getAccessToken()`, `isAuthenticated()`

**Vuex Auth Module State Shape (MANDATORY — from architecture.md):**
```js
// store/modules/auth.js — replaces existing auth module entirely (no coexistence)
state: {
  isAuthenticated: false,
  user: null,           // { iss_sub, sub, iss, email, name, roles }
  accessToken: null,    // string — in-memory only, never persisted
  error: null           // string or null
}
```

### Key Technical Details

**oidc-client-ts Library:**
- Latest stable version: 3.x
- PKCE is enabled by default for Authorization Code flow — no extra configuration needed
- `UserManager` constructor requires: `authority`, `client_id`, `redirect_uri`
- `automaticSilentRenew: true` handles token refresh transparently (satisfies Story 1.7 requirements partially)
- `signinRedirect()` redirects browser to Keycloak login page
- `signinRedirectCallback()` processes the authorization code callback
- `signoutRedirect()` redirects to Keycloak logout
- `getUser()` returns `User | null` from in-memory store
- User profile contains: `sub`, `iss`, `email`, `name`, `preferred_username`, `realm_access`, `exp`, `aud`, `iat`

**Critical: In-memory token storage (NFR3)**
- NEVER store tokens in localStorage, sessionStorage, or cookies
- `oidc-client-ts` stores user state in memory by default
- Set `storeAuthStateInCookie: false` explicitly to be safe
- The existing `authService.js` stores tokens in localStorage — this is the key behavioral change

**Configuration Hierarchy:**
1. `window.APP_CONFIG?.keycloak?.url` (runtime config from `/config/genie-ai-config.json`)
2. `process.env.VUE_APP_KEYCLOAK_URL` (build-time env var fallback)
3. Sensible defaults (`http://localhost:8080`, `genie`, `genie-app`)

**Environment Variables:**
- `VUE_APP_KEYCLOAK_URL` — Keycloak base URL (e.g., `https://keycloak.genie-ai.local`)
- `VUE_APP_KEYCLOAK_REALM` — Realm name (e.g., `genie`)
- `VUE_APP_KEYCLOAK_CLIENT_ID` — OIDC client ID (e.g., `genie-app`)
- Issuer constructed: `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`
- Redirect URI: `window.location.origin + '/callback'`

### What This Story Does NOT Cover (deferred to later stories)

- **Story 1.5:** Login redirect & auth guard (router navigation guard for auto-redirect)
- **Story 1.7:** Transparent re-authentication on session expiry (silent refresh + 401 retry)
- **Story 1.11:** Remove legacy auth components (LoginScreen, RegisterScreen, etc.)
- **Cleanup of authService.js:** Audit before removal — reusable utility functions may exist

### Files to Create

| File | Purpose |
|------|---------|
| `src/services/keycloakAuthService.js` | OIDC service wrapping oidc-client-ts UserManager |
| `src/config/oidcConfig.js` | OIDC configuration from env/runtime config |
| `src/__tests__/keycloakAuthService.test.js` | Unit tests for OIDC service |
| `src/__tests__/oidcConfig.test.js` | Unit tests for OIDC config |
| `src/__tests__/store/modules/auth.test.js` | Unit tests for Vuex auth module |

### Files to Modify

| File | Change |
|------|--------|
| `src/store/modules/auth.js` | **REPLACE entirely** — new Vuex auth module consuming keycloakAuthService |
| `src/services/httpService.js` | Modify request interceptor to use keycloakAuthService.getAccessToken() |
| `src/App.vue` | Update mounted hook: `initAuth` → `initialize` |
| `package.json` | Add `oidc-client-ts` dependency |

### Files NOT Modified (intentionally)

| File | Reason |
|------|--------|
| `src/services/authService.js` | Still used by other parts of app — removed in Story 1.11 |
| `src/services/userService.js` | Admin user management — not affected by OIDC switch |
| `src/router/index.js` | Auth guard update deferred to Story 1.5 |
| `src/components/LoginScreen.vue` | Removed in Story 1.11 |
| `src/main.js` | No changes needed — store is already registered |

### Existing Codebase Analysis

**Current auth flow (to be replaced):**
1. User submits credentials → `AuthService.login()` → POST to `/api/auth/login`
2. Response contains `accessToken` + `refreshToken`
3. Stored in `localStorage` under key `'user'`
4. `httpService.js` reads from `localStorage` for Authorization header
5. Proactive refresh every 15 minutes via `setInterval`

**New auth flow (this story):**
1. `keycloakAuthService.initialize()` → UserManager created → `getUser()` checks existing session
2. If no session → `keycloakAuthService.login()` → browser redirects to Keycloak
3. Keycloak authenticates → redirects back to callback URL
4. `keycloakAuthService.handleCallback()` → processes auth code → tokens in memory
5. Vuex store updated with user profile from OIDC
6. `httpService.js` reads `keycloakAuthService.getAccessToken()` for Authorization header

**Key differences:**
- No credential handling on frontend (Keycloak handles it)
- No localStorage for tokens (in-memory only)
- No proactive refresh interval (oidc-client-ts automaticSilentRenew handles it)
- No client-side password hashing (SHA-256 in authService.js becomes dead code)
- Token format is Keycloak JWT (not custom GENIE.AI JWT)

### Frontend Conventions (from project-context.md)

- **Vue 3 Options API** — NOT Composition API, NOT `<script setup>`
- **ES modules** with `@/` path alias for imports
- **2-space indentation, single quotes, semicolons**
- **i18n**: Use `translate('key.path', 'default text')` for user-facing text
- **No TypeScript** — plain JavaScript

### Testing Strategy

**keycloakAuthService.js tests:**
- Mock `oidc-client-ts` UserManager completely (Jest `jest.mock()`)
- Test each public method: `initialize`, `login`, `logout`, `handleCallback`, `getUser`, `getAccessToken`, `isAuthenticated`
- Verify UserManager is constructed with correct OIDC config
- Verify tokens are never written to localStorage/sessionStorage
- Verify PKCE is used (default in oidc-client-ts, but verify no explicit disabling)

**Vuex auth module tests:**
- Mock keycloakAuthService
- Test state transitions: initial → authenticated → logged out
- Verify user object shape matches architecture spec
- Verify `iss_sub` composite key construction
- Verify error handling (failed init, failed callback)

**oidcConfig.js tests:**
- Test config resolution from `window.APP_CONFIG`
- Test fallback to `process.env.VUE_APP_KEYCLOAK_*`
- Test default values when neither is available

**Test runner:** The frontend uses `@vue/cli-service` which includes Jest support. Tests go in `src/__tests__/` or `__tests__/` directories.

### Previous Story Intelligence (Story 1-3)

**Patterns established:**
- Environment variables: `KEYCLOAK_URL`, `KEYCLOAK_REALM`, `KEYCLOAK_CLIENT_ID`
- JWT claims structure: `{ sub, iss, email, name, preferred_username, realm_access: { roles }, exp, aud, iat }`
- Composite key: `{iss}#{sub}` for unique identification
- Error format: `{ error: "ERROR_CODE", message: "...", details: {} }`
- Error codes: `TOKEN_INVALID`, `TOKEN_EXPIRED`, `TOKEN_MISSING`
- Mock strategy: Mock external libraries completely, use `{ virtual: true }` for missing modules

**Lessons learned:**
- jose v6 is ESM-only — similar issue possible with oidc-client-ts (ESM library). Vue CLI's webpack should handle ESM imports fine at build time, but Jest may need configuration.
- Always set env vars before requiring modules that read them at load time
- Test with realistic token structures (3-part base64url JWT format)

### Git Intelligence

Recent commits show consistent pattern:
```
f7c4c87 feat: Add Keycloak auth middleware with protected/public routes (story 1-3)
f685ff0 docs: Add BMAD planning artifacts and update sprint status
eee73c6 feat: Add Keycloak IdP with pre-configured realm, OIDC client, and multi-user PostgreSQL
```

Commit message convention: `feat:` / `fix:` / `docs:` prefix with concise description.

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#D5] — Frontend OIDC service class decision
- [Source: _bmad-output/planning-artifacts/architecture.md#Vuex Auth Module State Shape] — Mandatory state shape
- [Source: _bmad-output/planning-artifacts/architecture.md#Frontend Architecture] — File structure and integration points
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns] — Naming conventions, error format
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure] — New/modified files list
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4] — BDD acceptance criteria
- [Source: _bmad-output/planning-artifacts/prd.md#NFR3] — Tokens in browser memory only
- [Source: _bmad-output/planning-artifacts/prd.md#NFR1] — OIDC with PKCE mandatory
- [Source: _bmad-output/project-context.md] — Frontend conventions (Options API, ES modules, no TS)
- [Source: components/gov-chat-frontend/src/store/modules/auth.js] — Current auth module to replace
- [Source: components/gov-chat-frontend/src/services/authService.js] — Current auth service (deferred removal)
- [Source: components/gov-chat-frontend/src/services/httpService.js] — HTTP interceptor to update
- [Source: components/gov-chat-frontend/src/App.vue] — App initialization to update
- [Source: oidc-client-ts docs] — UserManager API, PKCE, silent renew

## Dev Agent Record

### Agent Model Used

GLM-5-Turbo

### Debug Log References

- vue-jest v3 incompatible with Vue 3 → switched to @vue/vue3-jest@^29
- jest.mock `__esModule: true` required for ES default imports of keycloakAuthService
- JSDOM default origin `http://localhost` affected oidcConfig redirect_uri expectations
- setup.js console.error mock interfered with error logging tests → silencing only warn/debug

### Completion Notes List

- All 7 tasks completed. 50/50 unit tests passing.
- oidc-client-ts v3.5.0 installed — ESM library, Jest configured with transformIgnorePatterns
- Auth module kept non-namespaced for compatibility with existing App.vue mapGetters
- httpService.js updated to use keycloakAuthService.getAccessToken() instead of localStorage
- Null safety added for mapOidcUserToState return value in initialize and handleCallback actions
- Jest + babel + vue3-jest tooling set up from scratch (no prior test runner)
- Code review fixes applied:
  - httpService.js: removed dead AuthService references, localStorage manipulation, double 401/403 block; simplified retry to single attempt via keycloakAuthService.getUser(); redirect to Keycloak login instead of /login
  - oidcConfig.js: added trailing slash stripping on keycloakUrl
  - keycloakAuthService.js: added try/catch/finally to handleCallback for error cleanup
  - setup.js: removed unused originalConsole variable
  - Tests: added handleCallback error test, getUserManager test, trailing slash test
  - project-context.md: updated frontend testing rules (Jest is now configured)
- Note: epics.md AC says `isLoggedIn` but code uses `isAuthenticated` — code matches architecture.md which is authoritative. Epics.md inconsistency tracked for future correction.

### File List

**Created:**
- `components/gov-chat-frontend/src/config/oidcConfig.js` — OIDC configuration module
- `components/gov-chat-frontend/src/services/keycloakAuthService.js` — OIDC service wrapping oidc-client-ts
- `components/gov-chat-frontend/jest.config.js` — Jest configuration
- `components/gov-chat-frontend/src/__tests__/setup.js` — Test setup (console silencing)
- `components/gov-chat-frontend/src/__tests__/oidcConfig.test.js` — 7 tests
- `components/gov-chat-frontend/src/__tests__/keycloakAuthService.test.js` — 17 tests
- `components/gov-chat-frontend/src/__tests__/store/modules/auth.test.js` — 26 tests

**Modified:**
- `components/gov-chat-frontend/src/store/modules/auth.js` — Replaced entirely with OIDC-based Vuex module
- `components/gov-chat-frontend/src/services/httpService.js` — Token injection via keycloakAuthService, removed dead retry logic
- `components/gov-chat-frontend/src/App.vue` — dispatch('initAuth') → dispatch('initialize')
- `components/gov-chat-frontend/package.json` — Added oidc-client-ts, jest, test dependencies
- `components/gov-chat-frontend/babel.config.js` — Added @vue/cli-plugin-babel preset
- `_bmad-output/project-context.md` — Updated frontend testing rules
