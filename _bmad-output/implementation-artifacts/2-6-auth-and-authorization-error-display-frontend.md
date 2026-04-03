# Story 2.6: Auth & Authorization Error Display (Frontend)

Status: ready-for-dev

## Story

As an end user,
I want to see clear, actionable error messages when authentication or authorization fails,
so that I understand whether my credentials are wrong, my session expired, or I lack permissions.

## Acceptance Criteria

1. **Standardized Error Response Parsing (FR27, FR28)**
   - Given a user interacts with the system and the backend returns a standardized error response (format defined in Story 1.8)
   - When the frontend receives an error response with the format `{ error: "ERROR_CODE", message: "...", details: {} }`
   - Then the frontend parses the `error` code to determine the error category
   - And the frontend displays the `message` field from the backend response (never raw error objects)

2. **Authentication Failure — Clear Error Message (FR27)**
   - Given an unauthenticated or improperly authenticated request is made
   - When the backend returns a 401 error with `TOKEN_INVALID` or `TOKEN_EXPIRED`
   - Then the frontend displays a clear, user-facing error notification identifying the failure type
   - And for `TOKEN_EXPIRED`, the frontend attempts silent token refresh before displaying the error (already implemented in httpService.js — this story ensures the user sees a message if refresh also fails)
   - IMPORTANT: The existing flow on refresh failure is: `signinSilent()` fails → `login()` redirect to Keycloak. Since `window.location.href` assignment is synchronous, no DOM notification can render before the browser navigates. The redirect to Keycloak login IS the user feedback for expired sessions. No notification is needed for the 401 TOKEN_EXPIRED case — the redirect is sufficient.

3. **Authorization Failure — Distinct Error Message (FR28)**
   - Given an authenticated user has no GENIE.AI role assigned
   - When the backend returns a 403 error with `FORBIDDEN` (current backend code) or `INSUFFICIENT_ROLES` (future — see Forward-Looking section)
   - Then the frontend displays a distinct authorization error message (different from authentication errors)
   - And the message informs the user they lack required permissions and should contact their administrator

4. **Service Unavailable — Graceful Degradation (FR30)**
   - Given Keycloak is unreachable
   - When the backend returns a 503 error or when the auth middleware catches an initialization failure
   - Then the frontend displays an error message indicating the authentication service is temporarily unavailable
   - NOTE: `AUTH_SERVICE_UNAVAILABLE` error code is **forward-looking** — the backend currently does NOT return this specific code. The auth middleware handles Keycloak unavailability via the lazy OIDC discovery singleton (30s retry cooldown) and returns a generic error. This story should handle ANY 503/initialization error as a service unavailable indication.
   - Story 2-7 (health check) will add proactive `/health` endpoint detection. Until then, handle 503 generically.

5. **No Internal Details Exposed (FR27, FR28)**
   - Given any authentication or authorization error response
   - When the frontend displays the error to the user
   - Then only the `message` field from the backend response is shown — no token payloads, stack traces, or internal error details
   - And the raw error object is never rendered in the UI or logged to the console at `info` level

6. **PROVISIONING_FAILED Handling**
   - Given a valid token but ArangoDB JIT provisioning fails
   - When the backend returns a 500 error with `PROVISIONING_FAILED`
   - Then the frontend displays a user-facing error message indicating a system error occurred
   - And the message does not expose ArangoDB or provisioning details

## Tasks / Subtasks

- [ ] Task 1: Enhance httpService.js response error interceptor with error code parsing (AC: #1, #2, #3, #4, #5, #6)
  - [ ] Add a helper function `parseAuthError(errorResponse)` that extracts `error` code and `message` from the standardized backend response format `{ error, message, details }`
  - [ ] In `handleResponseError()`, call `parseAuthError()` for error responses that contain a structured body with an `error` field
  - [ ] For 401 responses with `TOKEN_EXPIRED`: after the existing silent refresh attempt fails, do NOT emit a notification — the redirect to Keycloak login IS the user feedback (no DOM notification can render before synchronous navigation)
  - [ ] For 401 responses with `TOKEN_INVALID`: after the existing silent refresh attempt fails, do NOT emit a notification for the same reason — redirect to Keycloak login handles this
  - [ ] For 403 responses: emit a distinct authorization error notification (do NOT attempt token refresh — this is an authorization issue, not authentication)
  - [ ] For 503 responses or initialization failures: emit a service unavailable notification
  - [ ] For 500 responses with `PROVISIONING_FAILED`: emit a system error notification
  - [ ] For unrecognized error codes: emit a generic error notification with a fallback message
  - [ ] Ensure all error notifications use `notificationService` (via eventBus) — consistent with existing app-wide notification pattern
  - [ ] Do NOT modify the existing 401 silent refresh + retry logic — only add user-facing error notification after refresh failure

- [ ] Task 2: Add error code to i18n translation keys (AC: #1, #2, #3, #4, #6)
  - [ ] Add auth error translation keys to `src/i18n/locales/en.js` under a new `auth.errors` section (insert after the `login` section to keep auth-related keys grouped):
    - `auth.errors.tokenExpired`: Default message for expired tokens
    - `auth.errors.tokenInvalid`: Default message for invalid tokens
    - `auth.errors.insufficientRoles`: Default message for missing permissions
    - `auth.errors.serviceUnavailable`: Default message for Keycloak unavailable
    - `auth.errors.provisioningFailed`: Default message for provisioning failure
    - `auth.errors.default`: Fallback message for unrecognized error codes
  - [ ] Add corresponding keys to `src/i18n/locales/fr.js` (French translations)
  - [ ] Do NOT add keys to all locale files in this story — only `en.js` and `fr.js`; other locales fall back to English

- [ ] Task 3: Enhance Vuex auth module error state handling (AC: #1, #2, #3, #4)
  - [ ] Add a new action `handleApiError({ commit }, errorResponse)` in `store/modules/auth.js` that:
    - Parses the standardized error response format
    - Commits `setError` with a user-friendly message
    - Returns the parsed error code for caller decision-making
  - [ ] Update existing `setError` mutation to store structured error info: `{ code, message }` instead of just a string (while maintaining backward compatibility for existing `authError` getter — if the getter is used in templates expecting a string, it should return `state.error?.message || state.error || null`)
  - [ ] Update the 3 existing `commit('setError', stringMessage)` calls to pass `{ code, message }` objects:
    - `initialize` action (line 92): `commit('setError', { code: 'INIT_ERROR', message: 'Authentication initialization failed' })`
    - `login` action (line 109): `commit('setError', { code: 'LOGIN_ERROR', message: 'Login redirect failed' })`
    - `handleCallback` action (line 138): `commit('setError', { code: 'CALLBACK_ERROR', message: 'Authentication callback failed' })`
  - [ ] Update existing test assertions in `auth.test.js` that check `state.error` as a string to expect `{ code, message }` format
  - [ ] Add a new getter `lastAuthErrorCode` that returns the error code from the last error

- [ ] Task 4: Ensure error messages are not logged with internal details (AC: #5)
  - [ ] Audit `handleResponseError()` in httpService.js — ensure `console.error` calls do not log the full error response body (which may contain sensitive details from the `details` field in the future)
  - [ ] Specifically: the existing `console.error('API response error:', errorData)` at line 135 logs the full `error.response.data` object. Change it to log only `status`, `statusText`, and `message` (from the parsed error response), NOT the raw `data` object or `details` field
  - [ ] Ensure the notification displayed to the user contains only the `message` string — never the full error object or `details` field

- [ ] Task 5: Write unit tests (AC: all)
  - [ ] Test `parseAuthError()` helper: verify correct parsing of all error codes (TOKEN_INVALID, TOKEN_EXPIRED, FORBIDDEN, AUTH_SERVICE_UNAVAILABLE, PROVISIONING_FAILED)
  - [ ] Test `parseAuthError()` with malformed response body: verify graceful fallback to default error
  - [ ] Test `handleResponseError()` for 401 TOKEN_EXPIRED: verify NO notification is emitted (redirect to Keycloak login is the feedback)
  - [ ] Test `handleResponseError()` for 401 TOKEN_INVALID: verify NO notification is emitted (same — redirect handles this)
  - [ ] Test `handleResponseError()` for 403 FORBIDDEN: verify distinct authorization notification (no refresh attempt)
  - [ ] Test `handleResponseError()` for 503 AUTH_SERVICE_UNAVAILABLE: verify service unavailable notification
  - [ ] Test `handleResponseError()` for 500 PROVISIONING_FAILED: verify system error notification
  - [ ] Test Vuex `handleApiError` action: verify error code and message are stored correctly
  - [ ] Test that `details` field is never passed to notification messages
  - [ ] Use `jest.mock()` for notificationService — verify `notificationService.error()` is called with correct message

## Dev Notes

### Architecture Compliance

**Error Response Format (established in Story 1.8, from architecture.md):**
```json
{
  "error": "ERROR_CODE",
  "message": "Human-readable description",
  "details": {}
}
```

**Error Codes (from architecture.md):**

| HTTP | Code | Meaning | Frontend Action |
|---|---|---|---|
| 401 | `TOKEN_INVALID` | Malformed or invalid token signature | Attempt refresh, then show auth error |
| 401 | `TOKEN_EXPIRED` | Token expiration claim exceeded | Attempt refresh, then show auth error |
| 403 | `FORBIDDEN` | Valid token but missing required role or deactivated user | Show authorization error (no refresh) |
| 500 | `PROVISIONING_FAILED` | Valid token but ArangoDB JIT provisioning failed | Show system error |
| 503 | `AUTH_SERVICE_UNAVAILABLE` | Keycloak unreachable | Show service unavailable message |

**Existing Notification System:**
The frontend already has a complete notification system:
- `src/services/notificationService.js` — facade with `.error()`, `.success()`, `.info()`, `.warning()` methods
- `src/eventBus.js` — event bus for cross-component communication
- `App.vue` — listens to `notification:show` events and renders a global notification bar
- Notification types: `success`, `error`, `info`, `warning`
- This story MUST use this existing system — do NOT create a new notification component

**Existing httpService.js Error Handling (current state):**
The `handleResponseError()` method already handles 401 with silent token refresh + retry. This story ADDS user-facing error notifications on top of the existing flow, it does NOT replace it:
1. 401 → attempt `signinSilent()` → if success, retry request → if failure, redirect to Keycloak login
2. **NEW**: Before redirecting to login on refresh failure, emit an error notification so the user sees what happened
3. **NEW**: For 403/500/503, emit appropriate error notifications

### Current Code State

**httpService.js (259 lines):**
- `handleResponseError()` at line 94 — current error handling logic
- Already imports `keycloakAuthService` for token refresh
- Already handles 401 with silent refresh + retry (lines 100-125)
- Already handles network errors (lines 137-142) and request setup errors (lines 144-148)
- **Gap**: No user-facing error notifications for 403/500/503 — errors are only logged to console and rejected as promises (401 errors redirect to Keycloak login, which is the correct UX)
- **Gap**: 403 responses are not handled with specific error messages
- **Gap**: 503 responses fall through to generic error handling

**Vuex auth module (store/modules/auth.js, 213 lines):**
- State has `error: null` field (line 52)
- `setError` mutation stores a string message (line 187-189)
- `clearError` mutation resets error to null (line 191-193)
- `authError` getter returns `state.error` (line 60)
- **Gap**: Error is a plain string — no structured error code information
- **Gap**: No action for handling API errors from backend responses

**keycloakAuthService.js (187 lines):**
- Already handles callback errors (line 77-80) and logout errors (line 99-101)
- Silent renew failure triggers `login()` redirect (line 33) — this is the existing fallback
- **No changes needed** in this service for this story

### What This Story Does NOT Change

- **httpService.js 401 silent refresh + retry logic** — the existing refresh-and-retry mechanism remains untouched; this story does NOT add notifications for 401 errors since the redirect to Keycloak login is the user feedback
- **keycloakAuthService.js** — no changes needed
- **Router navigation guard** — the existing guard in `router.js` that redirects unauthenticated users to Keycloak login remains unchanged
- **Notification component in App.vue** — the existing global notification bar is reused as-is
- **Backend error response format** — already standardized in Story 1.8, no backend changes in this story
- **`$t()` vs `translate()`** — the existing notification system in `App.vue` uses raw message strings (not i18n), and `notificationService.show()` takes a message string directly. This story follows the same pattern: backend `message` field is displayed directly, with i18n defaults only when the backend message is missing

### i18n Strategy

The backend already returns human-readable `message` strings in the standardized error response. The frontend should:
1. **Prefer the backend `message`** — it's already human-readable (per Story 1.8 sanitization)
2. **Fall back to hardcoded default strings** — if the backend response is missing or malformed, use plain string constants defined in `httpService.js` (e.g., `const DEFAULT_MESSAGES = { tokenExpired: 'Your session has expired. Please log in again.', ... }`)
3. **Do NOT wrap or modify the backend message** — display it as-is in the notification

**IMPORTANT:** `httpService.js` is a plain ES module (not a Vue component). It does NOT have access to `this.$t()` or any standalone `translate()` function. i18n translation keys (Task 2) are provided for potential future use in Vue-based error pages, but `httpService.js` MUST use hardcoded string constants for fallback messages.

i18n keys serve as **documentation of the fallback message semantics only** — they are NOT called from httpService.js.

### Security Considerations

- **Never display `details` field** — the backend may populate this in future stories with internal debugging info
- **Never display raw error objects** — only the `message` string from the parsed response
- **Never log full error responses at info/debug level** — existing `console.error` calls are acceptable for developer debugging but must not include sensitive fields

### Project Structure Notes

- Frontend uses ES module `import`/`export` syntax (bundled by Vue CLI)
- `@/` path alias maps to `src/`
- All new code follows Options API conventions
- API calls go through `httpService.js` — never direct axios in components
- Notifications use `notificationService` → `eventBus` → `App.vue` global notification bar

### Worktree Assignment

This story will be implemented in the `epic2-frontend` worktree.

### Previous Story Intelligence

**Story 1-8 (Token Validation Failure Handling — Backend):**
- Established the standardized error response format `{ error, message, details }`
- Sanitized all backend error messages to never expose internal details
- Backend error codes are: `TOKEN_INVALID`, `TOKEN_EXPIRED`, `INSUFFICIENT_ROLES`, `PROVISIONING_FAILED`, `AUTH_SERVICE_UNAVAILABLE`, `FORBIDDEN`, `INTERNAL_ERROR`
- Middleware returns hardcoded human-readable messages — never `err.message`
- The `details` field is always `{}` (empty) — but the frontend should not rely on this

**Story 1-7 (Transparent Re-authentication):**
- Implemented silent token refresh via `oidc-client-ts` in httpService.js
- httpService already handles 401 with `signinSilent()` + retry
- On refresh failure, redirects to Keycloak login
- Vuex auth module updates `accessToken` on silent renew via callback

**Story 1-4 (Frontend OIDC Service & Vuex Auth Module):**
- Created `keycloakAuthService.js` and Vuex auth module
- Established `notificationService.js` + `eventBus` pattern for notifications
- App.vue global notification bar already exists and works

### Frontend Conventions (from project-context.md)

- **Options API** — `export default { name, data(), methods, computed, ... }`
- **Props**: Object form with type validation
- **Vuex**: Use `mapGetters`/`mapActions` in computed/methods
- **i18n**: `this.$t('key.path')` in Vue templates; `translate()` function available in JS
- **API calls**: Always through `httpService.js`, never direct axios
- **Component communication**: Event bus (`eventBus.js`) for cross-component events
- **Service layer**: Domain-specific services in `src/services/`
- **Naming**: PascalCase components, kebab-case services

### Testing Strategy

**Unit tests for httpService error handling:**
- Mock `keycloakAuthService.signinSilent()` and `keycloakAuthService.login()`
- Mock `notificationService` to verify error notifications are emitted
- Test each error code path independently
- Verify that `details` field is never passed to notifications

**Unit tests for Vuex auth module:**
- Test `handleApiError` action with each error code
- Verify error state structure after action dispatch
- Verify `clearError` resets state correctly

**Test file locations:**
- `src/__tests__/httpService-401-retry.test.js` (existing — extend with error notification tests)
- `src/__tests__/store/modules/auth.test.js` (existing — extend with handleApiError tests)

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Auth Error Response] — Standardized error format definition
- [Source: _bmad-output/planning-artifacts/architecture.md#Error Codes] — Error code table (TOKEN_INVALID, TOKEN_EXPIRED, etc.)
- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.6] — BDD acceptance criteria
- [Source: _bmad-output/planning-artifacts/prd.md#FR27] — Clear error messages for auth failures
- [Source: _bmad-output/planning-artifacts/prd.md#FR28] — Clear authorization error messages
- [Source: _bmad-output/planning-artifacts/prd.md#FR29] — Graceful token validation failure handling
- [Source: _bmad-output/planning-artifacts/prd.md#FR30] — Keycloak unavailable detection
- [Source: _bmad-output/implementation-artifacts/1-8-token-validation-failure-handling-backend-response-format.md] — Story 1-8 completion notes and error format details
- [Source: components/gov-chat-frontend/src/services/httpService.js] — Current HTTP service with error handling
- [Source: components/gov-chat-frontend/src/services/notificationService.js] — Existing notification facade
- [Source: components/gov-chat-frontend/src/eventBus.js] — Event bus for notifications
- [Source: components/gov-chat-frontend/src/store/modules/auth.js] — Current Vuex auth module
- [Source: components/gov-chat-frontend/src/App.vue] — Global notification bar rendering
- [Source: components/gov-chat-frontend/src/i18n/locales/en.js] — English translation file
- [Source: components/gov-chat-frontend/src/i18n/locales/fr.js] — French translation file
- [Source: _bmad-output/project-context.md] — Frontend conventions (Options API, i18n, services)

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
