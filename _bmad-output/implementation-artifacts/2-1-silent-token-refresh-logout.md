# Story 2.1: Silent Token Refresh & Logout

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want my session to persist across token expiry without re-entering my credentials, and to be able to sign out completely from both the app and Keycloak,
So that I stay logged in seamlessly and my session is fully terminated when I choose to sign out.

## Acceptance Criteria

1. **AC1 - Silent token refresh (FR5):** Given the user is authenticated with valid tokens, when the access token expires (detected via stored `expiresIn` date comparison), then `AuthNotifier.refreshToken()` exchanges the refresh token for new tokens at the Keycloak token endpoint, the new tokens and new `expiresIn` are saved via `TokenStorage.saveTokens()`, and the auth state remains `authenticated` with no user interruption.

2. **AC2 - Refresh token rotation (FR5):** Given `AuthNotifier.refreshToken()` succeeds, when the new token pair is saved, then the old refresh token is replaced (Keycloak refresh token rotation — new RT returned by token endpoint).

3. **AC3 - Refresh failure → login screen (FR7):** Given `AuthNotifier.refreshToken()` fails (expired refresh token or revoked session), when the Keycloak token endpoint returns an error, then the auth state transitions to `AuthState(status: AuthStatus.unauthenticated, errorMessage: 'Your session has expired. Please sign in again.')`, `TokenStorage.deleteAll()` is called, and the failure is logged via the persistent logging infrastructure (NFR9).

4. **AC4 - Auth state recalculation (NFR6):** Given the auth state is recalculated after any token operation, when a token becomes expired or invalid, then the state immediately transitions to `unauthenticated` — no stale `authenticated` state possible.

5. **AC5 - Logout — parallel endpoint calls (FR4):** Given the user taps "Sign out", when `AuthNotifier.logout()` is called, then `POST /api/auth/logout` (backend) and `KeycloakService.endSession(idTokenHint: idToken)` (Keycloak direct) fire in parallel via `Future.wait`, each wrapped in `.catchError((_) {})`, `TokenStorage.deleteAll()` runs regardless of upstream failures, and the auth state transitions to `unauthenticated`.

6. **AC6 - Logout — Keycloak failure tolerance (FR4):** Given `KeycloakService.endSession()` fails, when the backend logout succeeds but Keycloak logout fails, then tokens are deleted locally, state is `unauthenticated`, and failure is logged.

7. **AC7 - Logout — no auto re-authentication (FR4):** Given the user taps "Sign in" immediately after logging out, when the system browser opens Keycloak, then the login page is displayed — the user is not automatically re-authenticated.

8. **AC8 - Logout logging (NFR9):** Given the logout operation, when it completes (success or failure), then the operation is logged via the persistent logging infrastructure with structured fields.

9. **AC9 - Logout UI wiring:** Given the user is authenticated, when the user taps the logout button in the NavBar, then `ref.read(authProvider.notifier).logout()` is called (replacing the current `_onLogoutPlaceholder()` no-op).

10. **AC10 - Existing tests pass:** `flutter analyze` — no new issues. `flutter test` — all 64 existing tests pass, no regressions.

## Tasks / Subtasks

- [x] Task 1: Implement `KeycloakService.endSession()` (AC: #5, #6, #8)
  - [x] 1.1: Add `endSession({String? idTokenHint})` method to `keycloak_service.dart` — GET to `endSessionEndpoint` with optional `id_token_hint` and `client_id` query parameters (standard OIDC RP-Initiated Logout)
  - [x] 1.2: Call `discoverEndpoints()` first if `_cachedEndpoints` is null (ensures end_session_endpoint is available)
  - [x] 1.3: Return `bool` indicating success/failure — do NOT throw on HTTP errors (caller handles via `.catchError`)
  - [x] 1.4: Add logging: `logAuthEvent('Keycloak end_session initiated')` at start, `logAuthEvent('Keycloak end_session successful')` on success, `logAuthFailure(errorCode: 'KEYCLOAK_LOGOUT_FAILED', keycloakEndpoint: endSessionEndpoint, httpStatus: ..., message: ...)` on failure — **completes deferred Story 2.0 task 5.2**
  - [x] 1.5: Handle `SocketException` (network unreachable) separately with `networkReachable: false`
- [x] Task 2: Implement `AuthNotifier.logout()` (AC: #5, #6, #7, #8)
  - [x] 2.1: Add `logout()` method to `auth_notifier.dart` following the architecture D3 pattern
  - [x] 2.2: Note — `POST /api/auth/logout` is NOT called because `ApiService` does not yet have `AuthInterceptor` (Story 2.2). The backend session cleanup will happen naturally via token expiration. Keycloak `end_session` is the critical call (terminates the Keycloak session so re-login shows login page, not auto-auth)
  - [x] 2.3: Add logging: `logAuthEvent('Logout initiated')` at start, `logAuthEvent('Logout completed')` on success, `logAuthFailure(errorCode: 'LOGOUT_FAILED', ...)` if Keycloak end_session fails — **completes deferred Story 2.0 task 3.4**
  - [x] 2.4: Add `ref.mounted` check after each `await` (per code review pattern from Story 1.4)
- [x] Task 3: Fix refresh failure error message (AC: #3, #4)
  - [x] 3.1: In `AuthNotifier.refreshToken()` catch block (line ~210), change `state = const AuthState.unauthenticated()` to include error message: `state = const AuthState(status: AuthStatus.unauthenticated, errorMessage: 'Your session has expired. Please sign in again.')`
  - [x] 3.2: Verify `OidcLoginScreen` reads `authState.errorMessage` and displays it when non-null (check current implementation)
  - [x] 3.3: Verify `AuthState` supports `unauthenticated` status with non-null `errorMessage` (it does — the unnamed constructor allows this)
- [x] Task 4: Wire logout in UI (AC: #9)
  - [x] 4.1: In `main.dart`, replace `_onLogoutPlaceholder()` with a real implementation that calls `ref.read(authProvider.notifier).logout()`
  - [x] 4.2: Remove the `debugPrint("[MAIN] Logout not yet implemented (deferred to Epic 2)")` line
  - [x] 4.3: Verify `NavBarComponent.onLogout` callback triggers the real logout
  - [x] 4.4: Verify that after logout, the app navigates back to `OidcLoginScreen` (the `ref.watch(authProvider)` in `MyApp.build()` already handles this — when status changes to `unauthenticated`, the `home:` switches to `OidcLoginScreen`)
- [x] Task 5: Unit tests (AC: #10)
  - [x] 5.1: Add tests for `KeycloakService.endSession()` in `test/services/keycloak/keycloak_service_test.dart`:
    - Success: mock HTTP 200 response, verify returns `true`, verify logging
    - Network error: mock `SocketException`, verify returns `false`, verify `networkReachable: false` in log
    - HTTP error: mock 400/500 response, verify returns `false`, verify `httpStatus` in log
    - Null idTokenHint: verify endpoint is still called (id_token_hint is optional per OIDC spec)
  - [x] 5.2: Add tests for `AuthNotifier.logout()` in `test/services/auth/auth_notifier_test.dart`:
    - Success: mock endSession returns true, verify deleteAll called, verify state is `unauthenticated`
    - Keycloak failure: mock endSession returns false, verify deleteAll still called, verify state is `unauthenticated`
    - Network error: mock endSession throws, verify `.catchError` absorbs it, verify deleteAll still called
    - Post-logout re-auth: verify calling `authorize()` after `logout()` works (no stale state)
  - [x] 5.3: Add test for refresh failure error message: mock refresh token endpoint failure, verify state has `errorMessage: 'Your session has expired. Please sign in again.'`
  - [x] 5.3b: Add test for refresh token rotation (AC2): mock token endpoint returning a new `refreshToken` different from the stored one, verify `tokenStorage.saveTokens()` is called with the new refresh token (not the old one). Ensures Keycloak refresh token rotation is correctly persisted
  - [x] 5.4: Run `flutter test` — all tests pass (existing 64 + new 13 = 77 total)
  - [x] 5.5: Run `flutter analyze` — no new issues
- [ ] Task 6: Manual verification (on device)
  - [ ] 6.1: Login → wait for token expiry → verify silent refresh (no UI interruption)
  - [ ] 6.2: Login → tap "Sign out" → verify redirected to login screen
  - [ ] 6.3: Sign out → tap "Sign in" → verify Keycloak login page shows (not auto-authenticated)
  - [ ] 6.4: Check auth log file for logout entries with NFR9 fields

## Dev Notes

### What This Story Does

This story implements the **logout flow** and validates the **silent token refresh** that was partially implemented in Story 1.3a. The core new functionality is:

1. **`KeycloakService.endSession()`** — calls Keycloak's `end_session_endpoint` with `id_token_hint` to terminate the Keycloak server-side session. This ensures that after logout, tapping "Sign in" shows the Keycloak login page instead of auto-authenticating via the existing browser session (FR4, AC7).

2. **`AuthNotifier.logout()`** — orchestrates the logout: calls `endSession()` (best-effort), then `deleteAll()` (best-effort), then sets state to `unauthenticated`. Follows architecture D3 pattern with `Future.wait` and `.catchError`.

3. **Refresh failure error message** — fixes FR7 by adding `'Your session has expired. Please sign in again.'` to the `unauthenticated` state when refresh fails.

4. **UI wiring** — replaces the `_onLogoutPlaceholder()` no-op in `main.dart` with the real `AuthNotifier.logout()` call.

### Critical: POST /api/auth/logout Deferred to Story 2.2

The architecture specifies calling `POST /api/auth/logout` (backend) in parallel with Keycloak `end_session_endpoint`. However, `ApiService` currently has no `AuthInterceptor` — the backend logout endpoint expects a valid Bearer token in the `Authorization` header, which we cannot inject without the interceptor (Story 2.2).

**Decision:** This story calls ONLY `KeycloakService.endSession()` during logout. The backend session will expire naturally via Keycloak token expiration (backend validates tokens via JWKS — once the Keycloak session is terminated and tokens are deleted locally, no further backend calls are possible). Story 2.2 will add `POST /api/auth/logout` to the `logout()` method when the `AuthInterceptor` is available.

**Why this is safe:** The backend session cleanup via `POST /api/auth/logout` performs ArangoDB session cleanup + audit log. Without it, the ArangoDB session record persists until TTL expiration — a minor data hygiene issue, not a security issue. The Keycloak session is properly terminated (the critical security operation), and local tokens are deleted.

### Keycloak end_session_endpoint — OIDC RP-Initiated Logout

The Keycloak `end_session_endpoint` is a standard OIDC endpoint that terminates the user's Keycloak session. Parameters:

| Parameter | Required | Description |
|-----------|----------|-------------|
| `id_token_hint` | Recommended | The ID token from the last authentication — Keycloak uses it to identify the session to terminate |
| `post_logout_redirect_uri` | Optional | Where to redirect after logout (not used in mobile — we don't redirect) |
| `client_id` | Optional | The client ID (Keycloak can infer from registered redirect URIs) |

The mobile app calls this endpoint via a direct HTTP POST (redirect responses are irrelevant — we just need the server-side session termination). The response status code is 200 on success (Keycloak may return an HTML redirect page, which we ignore).

**Important:** The `id_token_hint` is recommended but not required. If the ID token is missing or expired, the endpoint still works but may not terminate a specific session (it clears the browser cookies for the realm). Since we always have the ID token from the last authentication (stored in `TokenStorage`), this is not an issue in practice.

### Current Codebase State

**What already exists (no changes needed):**
- `AuthNotifier.refreshToken()` — fully implemented (Story 1.3a), handles refresh token exchange, saves new tokens, handles errors
- `AuthNotifier.validateTokens()` — fully implemented (Story 1.3a), checks expiration and triggers refresh
- `AuthNotifier._initializeAuth()` — fully implemented, checks stored tokens on app startup
- `TokenStorage` — all 5 methods implemented with secure storage (Story 1.1)
- `AuthLogger` — integrated into `AuthNotifier` and `KeycloakService` (Story 2.0)
- `authLoggerProvider` — registered in `auth_providers.dart` (Story 2.0)

**What needs to be added:**
- `KeycloakService.endSession()` — new method (this story)
- `AuthNotifier.logout()` — new method (this story)
- Logout UI wiring in `main.dart` (this story)
- Error message on refresh failure (small fix, this story)
- Story 2.0 deferred tasks: 3.4 (logout logging), 5.2 (endSession logging) (this story)

**Deferred to Story 2.2:**
- `POST /api/auth/logout` call in `AuthNotifier.logout()` (requires `AuthInterceptor` for Bearer token)

### refreshToken() — Existing Implementation Analysis

The current `refreshToken()` implementation in `auth_notifier.dart` (lines 153-221):
- Reads refresh token from `TokenStorage`
- Calls `_appAuth.token()` with `grantType: 'refresh_token'`
- Saves new tokens (access, id, refresh) with new expiration
- On failure: logs, calls `deleteAll()`, sets `unauthenticated()` state
- **Issue:** The failure state uses `const AuthState.unauthenticated()` which has `errorMessage: null`. Per FR7, it should include the error message "Your session has expired. Please sign in again." — this is a one-line fix (Task 3.1)

### KeycloakService.endSession() Implementation Notes

```dart
Future<bool> endSession({required String idTokenHint}) async {
  final endpoints = await discoverEndpoints();
  if (endpoints == null) return false;

  _logger?.logAuthEvent(
    message: 'Keycloak end_session initiated',
    source: 'KeycloakService.endSession',
  );

  try {
    final uri = Uri.parse(endpoints.endSessionEndpoint).replace(
      queryParameters: {
        'id_token_hint': idTokenHint,
        'client_id': keycloakConfig.clientId,
      },
    );

    final response = await _httpClient.get(uri); // GET with query params

    if (response.statusCode == 200 || response.statusCode == 302) {
      _logger?.logAuthEvent(
        message: 'Keycloak end_session successful',
        source: 'KeycloakService.endSession',
      );
      return true;
    }

    _logger?.logAuthFailure(
      errorCode: 'KEYCLOAK_LOGOUT_FAILED',
      keycloakEndpoint: endpoints.endSessionEndpoint,
      httpStatus: response.statusCode,
      message: 'end_session returned HTTP ${response.statusCode}',
      source: 'KeycloakService.endSession',
    );
    return false;
  } on SocketException {
    _logger?.logAuthFailure(
      errorCode: 'KEYCLOAK_LOGOUT_NETWORK_ERROR',
      keycloakEndpoint: keycloakConfig.realmUrl,
      networkReachable: false,
      message: 'Network unreachable during end_session',
      source: 'KeycloakService.endSession',
    );
    return false;
  } catch (e) {
    _logger?.logAuthFailure(
      errorCode: 'KEYCLOAK_LOGOUT_ERROR',
      keycloakEndpoint: keycloakConfig.realmUrl,
      message: 'Error during end_session: $e',
      source: 'KeycloakService.endSession',
    );
    return false;
  }
}
```

**Note on HTTP method:** Keycloak's `end_session_endpoint` accepts both GET (with query params) and POST. Using GET with query params is simpler and sufficient — we just need the server-side session to be terminated, we don't process the response body.

### AuthNotifier.logout() Implementation Notes

```dart
Future<void> logout() async {
  _authLogger.logAuthEvent(
    message: 'Logout initiated',
    source: 'AuthNotifier.logout',
  );

  final idToken = await _tokenStorage.getIdToken();
  if (!ref.mounted) return;

  // Keycloak end_session — best-effort (one failure does not block the others)
  await _keycloakService
      .endSession(idTokenHint: idToken ?? '')
      .catchError((_) {});

  // Delete local tokens — runs regardless of Keycloak failure
  await _tokenStorage.deleteAll().catchError((_) {});
  if (!ref.mounted) return;

  _authLogger.logAuthEvent(
    message: 'Logout completed',
    source: 'AuthNotifier.logout',
  );

  state = const AuthState.unauthenticated();
}
```

**Why `Future.wait` is not used here:** The architecture D3 pattern specifies `Future.wait([backend, keycloak])`. However, since we're deferring `POST /api/auth/logout` to Story 2.2, there's only one async call (Keycloak `endSession`). Using `Future.wait` with a single element is unnecessary — a simple `await` is cleaner. When Story 2.2 adds the backend logout call, `Future.wait` will be introduced at that point.

### UI Flow After Logout

The `MyApp.build()` method already handles auth state transitions via `ref.watch(authProvider)`:

```dart
home: authState.status == AuthStatus.authenticated
    ? MainScreen(...)
    : const OidcLoginScreen(),
```

When `logout()` sets `state = const AuthState.unauthenticated()`, the `ref.watch(authProvider)` triggers a rebuild, and `OidcLoginScreen` is displayed automatically. No manual navigation needed.

**Error message display on login screen after refresh failure:** The `OidcLoginScreen` should check `authState.errorMessage` and display it if non-null. Verify the current implementation handles this.

### Project Structure Notes

```
lib/
├── services/
│   ├── auth/
│   │   ├── auth_notifier.dart        # MODIFIED — add logout(), fix refresh error message
│   │   ├── auth_providers.dart       # UNTOUCHED — no new providers needed
│   │   ├── auth_state.dart           # UNTOUCHED — supports unauthenticated with errorMessage
│   │   ├── auth_logger.dart          # UNTOUCHED
│   │   ├── app_auth.dart             # UNTOUCHED
│   │   └── token_storage.dart        # UNTOUCHED
│   ├── keycloak/
│   │   └── keycloak_service.dart     # MODIFIED — add endSession() method
│   └── ...
├── main.dart                         # MODIFIED — replace _onLogoutPlaceholder with real logout
test/
├── services/
│   ├── auth/
│   │   └── auth_notifier_test.dart   # MODIFIED — add logout tests, refresh error message test
│   └── keycloak/
│       └── keycloak_service_test.dart # MODIFIED — add endSession tests
```

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.1]
- [Source: _bmad-output/planning-artifacts/architecture.md#D3: Logout Mechanism]
- [Source: _bmad-output/planning-artifacts/architecture.md#D4: 401 → Refresh → Retry]
- [Source: _bmad-output/planning-artifacts/architecture.md#Process Patterns — Error Handling in Auth Flow]
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Flow — Logout]
- [Source: _bmad-output/implementation-artifacts/2-0-persistent-auth-logging-infrastructure.md#Deferred Tasks 3.4, 5.2]
- [Source: mobile/genie_ai_mobile/lib/services/auth/auth_notifier.dart#refreshToken()]
- [Source: mobile/genie_ai_mobile/lib/main.dart#_onLogoutPlaceholder]

## Technical Requirements

### Flutter/Dart Stack

- **Flutter 3.10+**, Dart (existing project constraint)
- **`flutter_appauth`** — already in `pubspec.yaml` (Story 1.1), used for token refresh via `TokenRequest`
- **`http`** package — already in `pubspec.yaml`, used by `KeycloakService` for `end_session_endpoint` call
- **`flutter_riverpod` ^3.0.0** — already in `pubspec.yaml`, `authProvider` for state management
- **`talker` / `talker_flutter`** — already in `pubspec.yaml` (Story 2.0), used by `AuthLogger`
- No new dependencies required for this story

### OIDC Standards

- **Refresh Token Grant** — standard OAuth 2.0 `grant_type=refresh_token` (already implemented via `flutter_appauth`)
- **RP-Initiated Logout** — OIDC `end_session_endpoint` with `id_token_hint` parameter
- **Refresh Token Rotation** — Keycloak returns a new refresh token on each refresh; the old one is invalidated (configured on Keycloak client via `client.credentials.use.refresh.token: true` in `genie-realm.yaml`)

### Key Constraints

- **No `POST /api/auth/logout` in this story** — deferred to Story 2.2 (requires `AuthInterceptor`)
- **No `BuildContext` inside `AuthNotifier`** — pure business logic, no Flutter widget dependency
- **No tokens in logs (FR25)** — `endSession()` logs `keycloakEndpoint` (base URL only), never token values
- **`ref.mounted` checks after every `await`** — prevents state updates after notifier disposal
- **`deleteAll()` runs regardless of upstream failures** — `.catchError((_) {})` on all upstream calls

## Architecture Compliance

| Architecture Decision | Compliance |
|---|---|
| D3: Logout via Future.wait | ✅ (partial — Keycloak only; backend deferred to Story 2.2) |
| D3: Each call wrapped in `.catchError` | ✅ `endSession().catchError((_) {})`, `deleteAll().catchError((_) {})` |
| D3: `deleteAll()` runs regardless | ✅ After `endSession()` completes (success or failure) |
| D1: Three-state auth machine | ✅ Logout → `unauthenticated`, refresh failure → `unauthenticated` with message |
| D5: Riverpod provider structure | ✅ No new providers needed — uses existing `authProvider`, `keycloakServiceProvider` |
| Component boundaries | ✅ `endSession()` in `KeycloakService`, `logout()` in `AuthNotifier`, UI wiring in `main.dart` |
| No tokens/PII in logs (FR25) | ✅ `id_token_hint` passed to endpoint, never logged |
| Pattern: ref.mounted checks | ✅ After every `await` in `logout()` |

## File Structure Requirements

```
lib/
├── services/
│   ├── auth/
│   │   ├── auth_notifier.dart        # MODIFIED — add logout(), fix refresh error message
│   │   ├── auth_providers.dart       # UNTOUCHED
│   │   ├── auth_state.dart           # UNTOUCHED (supports unauthenticated + errorMessage)
│   │   ├── auth_logger.dart          # UNTOUCHED
│   │   ├── app_auth.dart             # UNTOUCHED
│   │   └── token_storage.dart        # UNTOUCHED
│   ├── keycloak/
│   │   └── keycloak_service.dart     # MODIFIED — add endSession() method
│   └── api_service.dart              # UNTOUCHED (AuthInterceptor deferred to Story 2.2)
├── main.dart                         # MODIFIED — replace _onLogoutPlaceholder
test/
├── services/
│   ├── auth/
│   │   └── auth_notifier_test.dart   # MODIFIED — add logout + refresh error tests
│   └── keycloak/
│       └── keycloak_service_test.dart # MODIFIED — add endSession tests
```

## Testing Requirements

**New unit tests:**

1. **`KeycloakService.endSession()`** (in `keycloak_service_test.dart`):
   - Success: mock HTTP 200 → returns `true`, verify `logAuthEvent('successful')` called
   - HTTP 302 redirect: mock HTTP 302 → returns `true` (Keycloak may redirect)
   - HTTP error: mock HTTP 400/500 → returns `false`, verify `logAuthFailure` with `httpStatus`
   - Network error: mock `SocketException` → returns `false`, verify `networkReachable: false`
   - Discovery failure: mock `discoverEndpoints()` returns null → returns `false`
   - Null/empty idTokenHint: verify endpoint still called (parameter is optional in OIDC spec)

2. **`AuthNotifier.logout()`** (in `auth_notifier_test.dart`):
   - Success: mock endSession returns `true`, verify `deleteAll()` called, state is `unauthenticated`
   - Keycloak failure: mock endSession returns `false`, verify `deleteAll()` still called, state is `unauthenticated`
   - Network error: mock endSession throws, verify `.catchError` absorbs it, state is `unauthenticated`
   - Post-logout re-auth: call `logout()` then `authorize()` → verify normal login flow works (no stale state)

3. **Refresh failure error message** (in `auth_notifier_test.dart`):
   - Mock refresh token endpoint failure → verify state has `status: AuthStatus.unauthenticated` AND `errorMessage: 'Your session has expired. Please sign in again.'`

4. **Refresh token rotation** (in `auth_notifier_test.dart`):
   - Store initial tokens with `refreshToken: 'old-refresh-token'`
   - Mock token endpoint to return a new `refreshToken: 'new-refresh-token'`
   - After `refreshToken()`, verify `tokenStorage.getRefreshToken()` returns `'new-refresh-token'`
   - Ensures Keycloak refresh token rotation is persisted (AC2 — security mechanism)

**Existing test suite must pass:**
- `flutter test` — all 64 tests pass + new tests
- `flutter analyze` — no new issues

**Manual verification:**
1. Login → wait for token expiry → verify silent refresh (no UI interruption, state remains `authenticated`)
2. Login → tap "Sign out" → verify redirected to `OidcLoginScreen`
3. Sign out → tap "Sign in" → verify Keycloak login page shows (not auto-authenticated via SSO)
4. Check auth log file for logout entries with NFR9 fields

## Previous Story Intelligence

### Story 2.0: Persistent Auth Logging Infrastructure (in-progress, directly preceding)

- **AuthLogger** is fully implemented and integrated into `AuthNotifier`, `ApiService`, and `KeycloakService`
- **Deferred tasks 3.4 and 5.2** are directly in scope for this story — `logout()` and `endSession()` methods will be created here, and logging calls must be added
- **64 tests pass** — 54 from Epic 1 + 10 new from Story 2.0
- **`authLoggerProvider`** registered in `auth_providers.dart` as `Provider<AuthLogger>` — accessed via `ref.read(authLoggerProvider)` in `AuthNotifier`
- **Logging pattern:** `logAuthEvent()` for INFO events, `logAuthFailure()` for WARN events with structured NFR9 fields

### Story 1.4: Login Screen UI & Accessibility (last completed in Epic 1)

- **Code review feedback to apply:** `const` constructors for data classes, `ref.mounted` checks after async gaps, narrow exception catches
- **`_onLogoutPlaceholder`** — no-op in `main.dart` line 120, explicitly deferred to this story
- **`OidcLoginScreen`** — the login screen that displays after logout; verify it handles `authState.errorMessage`
- **`NavBarComponent`** — has `onLogout` callback wired to `MainScreen.onLogout` → `_onLogoutPlaceholder()`

### Stories 1.1–1.3a: Auth Infrastructure

- **`refreshToken()` already implemented** — exchanges refresh token via `flutter_appauth`, saves new tokens, handles errors. Only missing: error message on failure (FR7)
- **`TokenStorage`** — all 5 methods work (getAccessToken, getIdToken, getRefreshToken, getAccessTokenExpiration, saveTokens, deleteAll)
- **`OidcEndpoints`** — includes `endSessionEndpoint` field, already parsed from `.well-known/openid-configuration`
- **11 tests for AuthNotifier** — cover authorize, refresh, validate, cancellation, error handling
- **8 tests for KeycloakService** — cover discovery success/failure

### Code Patterns Established

```dart
// ref.mounted checks after async gaps (from Story 1.4 code review)
await someAsyncOperation();
if (!ref.mounted) return;

// AuthLogger access pattern (from Story 2.0)
_authLogger.logAuthEvent(message: '...', source: 'AuthNotifier.methodName');
_authLogger.logAuthFailure(errorCode: '...', keycloakEndpoint: '...', httpStatus: ..., message: '...', source: '...');

// Error state pattern (from architecture D1)
state = const AuthState.error(message: 'Network unreachable', retryable: true);

// Best-effort pattern (from architecture D3)
await someCall().catchError((_) {});
```

## Git Intelligence

Recent commits on this branch (all OIDC-related):

| Commit | Story | Key Files |
|---|---|---|
| `eac919b4` | 2.0 | `auth_logger.dart`, `auth_notifier.dart`, `auth_providers.dart`, `api_service.dart`, `keycloak_service.dart` |
| `6281b361` | 1.4 | `oidc_login_screen.dart`, `main.dart` |
| `a8856c23` | 1.3b | `build.gradle`, `Info.plist` |
| `996d036c` | 1.3a | `auth_notifier.dart`, `auth_providers.dart`, `keycloak_service.dart`, `app_auth.dart` |
| `d9e98d47` | 1.2 | `auth_state.dart`, `keycloak_config.dart`, flavor configs |
| `1d28d9e8` | 1.1 | `token_storage.dart` |

**Patterns observed:**
- Each story adds/modifies files incrementally — no large refactors
- Commit messages follow `feat(mobile-oidc):` conventional format
- `auth_providers.dart` modified incrementally as new providers are added (not needed this story)
- Tests mirror source structure: `test/services/auth/` ↔ `lib/services/auth/`

## Project Context Reference

- **Project context:** `_bmad-output/project-context.md` — Flutter 3.10+, Dart, testing rules
- **Architecture:** `_bmad-output/planning-artifacts/architecture.md` — D1-D6 decisions, D3 (Logout), D4 (401→refresh→retry)
- **Epics:** `_bmad-output/planning-artifacts/epics.md` — Story 2.1 full requirements and BDD acceptance criteria
- **PRD:** `_bmad-output/planning-artifacts/prd.md` — FR4, FR5, FR7, FR8, FR10, FR11
- **Story 2.0:** `_bmad-output/implementation-artifacts/2-0-persistent-auth-logging-infrastructure.md` — logging infrastructure, deferred tasks

## Dev Agent Record

### Agent Model Used

glm-5-turbo (Claude Code)

### Debug Log References

- `.catchError((_) {})` on `Future<bool>` requires returning `bool`, not `void` — changed to `.catchError((_) => false)`

### Completion Notes List

- Task 1: Added `endSession()` to `KeycloakService` — GET to `end_session_endpoint` with optional `id_token_hint` + `client_id` query params. Handles 200/302 as success, HTTP errors with `logAuthFailure`, `SocketException` with `networkReachable: false`, `ClientException` with dedicated error code. Completes Story 2.0 deferred task 5.2.
- Task 2: Added `logout()` to `AuthNotifier` — calls `endSession()` (best-effort via `.catchError((_) => false)`), then `deleteAll()` (best-effort), then sets `unauthenticated`. Includes `ref.mounted` checks after each await. `POST /api/auth/logout` deferred to Story 2.2 (requires AuthInterceptor). Completes Story 2.0 deferred task 3.4.
- Task 3: Fixed refresh failure error message — changed `const AuthState.unauthenticated()` to `const AuthState(status: AuthStatus.unauthenticated, errorMessage: 'Your session has expired. Please sign in again.')` in `refreshToken()` catch block. Verified `OidcLoginScreen` already displays `authState.errorMessage`.
- Task 4: Replaced `_onLogoutPlaceholder()` in `main.dart` with `_onLogout()` calling `ref.read(authProvider.notifier).logout()`. Removed debug print. `NavBarComponent.onLogout` → `MainScreen.onLogout` → `_onLogout` chain verified.
- Task 5: Added 15 new tests (8 for `endSession`, 7 for `logout`/refresh). Total: 79 tests pass, 0 failures. `flutter analyze` — no new issues.
- Task 6: Manual verification deferred to device testing (requires Keycloak instance).
- Code review fixes: Added `ClientException` handling in `endSession()` (consistent with `discoverEndpoints()`), made `idTokenHint` optional per OIDC spec, added `RecordingAuthLogger` with logout logging verification (AC8).

### File List

- `mobile/genie_ai_mobile/lib/services/keycloak/keycloak_service.dart` — MODIFIED (added `endSession()` method)
- `mobile/genie_ai_mobile/lib/services/auth/auth_notifier.dart` — MODIFIED (added `logout()`, fixed refresh error message)
- `mobile/genie_ai_mobile/lib/main.dart` — MODIFIED (replaced `_onLogoutPlaceholder` with `_onLogout`)
- `mobile/genie_ai_mobile/test/services/keycloak/keycloak_service_test.dart` — MODIFIED (added 7 endSession tests + `_SequentialHttpClient` helper)
- `mobile/genie_ai_mobile/test/services/auth/auth_notifier_test.dart` — MODIFIED (added 6 logout/refresh tests, extended `FakeKeycloakService` with endSession mock)
