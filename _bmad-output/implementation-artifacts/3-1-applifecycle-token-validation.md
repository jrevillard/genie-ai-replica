# Story 3.1: AppLifecycle Token Validation

Status: ready-for-dev

## Story

As a user,
I want my session to be validated when I return to the app after being in the background,
so that I am not stuck with an expired session and see the login screen promptly if needed.

## Acceptance Criteria

### AC1 — Resume triggers silent validation
**Given** the user has the app in the background for an extended period
**When** the app returns to foreground (`AppLifecycleState.resumed`)
**Then** `AuthNotifier.didChangeAppLifecycleState()` triggers `validateTokens()` silently

### AC2 — Valid token: no UI change
**Given** `validateTokens()` runs on resume
**When** the access token is still valid (stored `expiresIn` date is in the future)
**Then** no UI change occurs — the user sees the authenticated interface immediately (NFR4)

### AC3 — Expired access token, valid refresh token: silent refresh
**Given** `validateTokens()` runs on resume
**When** the access token has expired (stored `expiresIn` date is in the past) but the refresh token is valid
**Then** a silent refresh is triggered — the user sees no interruption
**And** the auth state remains `authenticated` after refresh (FR6)

### AC4 — Both tokens expired: session expired message
**Given** `validateTokens()` runs on resume
**When** the refresh token has also expired
**Then** `TokenStorage.deleteAll()` is called
**And** the auth state transitions to `AuthState(status: AuthStatus.unauthenticated, errorMessage: 'Your session has expired. Please sign in again.')`
**And** the user sees the login screen with a message: "Your session has expired. Please sign in again." (FR6)

### AC5 — Disposal removes observer
**Given** `AuthNotifier` is disposed
**When** the widget tree is torn down
**Then** `ref.onDispose()` calls `WidgetsBinding.instance.removeObserver(this)` — no memory leak, no stale lifecycle events

### AC6 — Construction adds observer
**Given** `AuthNotifier` is constructed
**When** initialization completes
**Then** `WidgetsBinding.instance.addObserver(this)` is called — lifecycle events are active

### AC7 — Non-authenticated state: no-op on resume
**Given** the user is on the login screen (unauthenticated)
**When** the app returns to foreground
**Then** `didChangeAppLifecycleState()` is a no-op — no token validation attempted

## Tasks / Subtasks

- [ ] Task 1: Add `WidgetsBindingObserver` mixin to `AuthNotifier` (AC: #5, #6)
  - [ ] 1.1 Add `with WidgetsBindingObserver` to `AuthNotifier` class declaration
  - [ ] 1.2 Add `WidgetsBinding.instance.addObserver(this)` in `build()` before `Future.microtask(() => _initializeAuth())`
  - [ ] 1.3 Add `WidgetsBinding.instance.removeObserver(this)` inside existing `ref.onDispose()` callback (create if not present)
  - [ ] 1.4 Verify `build()` returns `const AuthState.unauthenticated()` after observer registration
- [ ] Task 2: Implement `didChangeAppLifecycleState()` (AC: #1, #2, #3, #4, #7)
  - [ ] 2.1 Override `didChangeAppLifecycleState(AppLifecycleState state)` method
  - [ ] 2.2 Guard: only call `validateTokens()` when `state == AppLifecycleState.resumed`
  - [ ] 2.3 Guard: only call `validateTokens()` when `state.status == AuthStatus.authenticated` (skip if already unauthenticated or in error state)
  - [ ] 2.4 Add AuthLogger event for lifecycle resume with validation trigger
- [ ] Task 3: Verify `validateTokens()` handles all AC scenarios (AC: #2, #3, #4)
  - [ ] 3.1 Confirm existing `validateTokens()` checks `getAccessTokenExpiration()` — no JWT parsing needed
  - [ ] 3.2 Confirm valid token path: expiration in future → no state change (AC2 satisfied)
  - [ ] 3.3 Confirm expired token path: calls `refreshToken()` → silent refresh (AC3 satisfied)
  - [ ] 3.4 Confirm both-expired path: `refreshToken()` catch block already sets `errorMessage: 'Your session has expired. Please sign in again.'` (AC4 satisfied)
  - [ ] 3.5 Add AuthLogger failure logging in `validateTokens()` for the expired-but-refresh-succeeds case (currently only logs failure)
- [ ] Task 4: Unit tests (AC: all)
  - [ ] 4.1 `didChangeAppLifecycleState(resumed)` calls `validateTokens()` when authenticated
  - [ ] 4.2 `didChangeAppLifecycleState(paused/inactive)` does NOT call `validateTokens()`
  - [ ] 4.3 `didChangeAppLifecycleState(resumed)` does NOT call `validateTokens()` when unauthenticated
  - [ ] 4.4 `didChangeAppLifecycleState(resumed)` does NOT call `validateTokens()` when in error state
  - [ ] 4.5 Valid token on resume: no state change
  - [ ] 4.6 Expired access token on resume: `refreshToken()` called, state stays authenticated
  - [ ] 4.7 Both tokens expired on resume: state transitions to unauthenticated with error message
  - [ ] 4.8 Observer added in `build()` — verify `addObserver` called
  - [ ] 4.9 Observer removed on dispose — verify `removeObserver` called in `ref.onDispose()`
  - [ ] 4.10 Idempotence — calling `resumed` twice in a row does not trigger double refresh
- [ ] Task 5: Lint and analyze
  - [ ] 5.1 Run `flutter analyze` — zero new issues
  - [ ] 5.2 Run `flutter test` — all tests pass (existing + new)

## Dev Notes

### What Already Exists — DO NOT Recreate

The following are already implemented and working. Story 3.1 only adds the **lifecycle binding** (WidgetsBindingObserver) on top of this foundation:

| Component | File | Status |
|-----------|------|--------|
| `validateTokens()` | `lib/services/auth/auth_notifier.dart:279` | Fully implemented — checks expiration, calls `refreshToken()` if expired |
| `refreshToken()` | `lib/services/auth/auth_notifier.dart:165` | Fully implemented — refresh exchange, saves new tokens, handles failure with error message |
| `TokenStorage.getAccessTokenExpiration()` | `lib/services/auth/token_storage.dart:44` | Returns stored `DateTime` from JSON blob |
| `AuthState.unauthenticated(errorMessage)` | `lib/services/auth/auth_state.dart:43` | Default constructor supports `errorMessage` field |
| `AuthLogger` | `lib/services/auth/auth_logger.dart` | Integrated into AuthNotifier, all methods log events/failures |
| `_initializeAuth()` | `lib/services/auth/auth_notifier.dart:37` | Checks stored tokens on startup, refreshes if expired |

### What This Story Adds

The **only** new code is:
1. `with WidgetsBindingObserver` mixin on `AuthNotifier`
2. `addObserver(this)` in `build()`
3. `removeObserver(this)` in `ref.onDispose()`
4. `didChangeAppLifecycleState()` override with guards

The `validateTokens()` method is already correct and handles all token-expired scenarios. No changes to `refreshToken()`, `TokenStorage`, or `AuthState` are needed.

### Critical: `ref.onDispose()` Does NOT Currently Exist

The current `build()` method (line 27-35) does NOT have a `ref.onDispose()` callback. This story must add one:

```dart
@override
AuthState build() {
  _tokenStorage = ref.watch(tokenStorageProvider);
  _keycloakService = ref.watch(keycloakServiceProvider);
  _appAuth = ref.watch(appAuthProvider);
  _authLogger = ref.read(authLoggerProvider);
  _apiService = ref.watch(apiServiceProvider);

  // NEW: Register lifecycle observer
  WidgetsBinding.instance.addObserver(this);

  // NEW: Cleanup on dispose
  ref.onDispose(() {
    WidgetsBinding.instance.removeObserver(this);
  });

  Future.microtask(() => _initializeAuth());
  return const AuthState.unauthenticated();
}
```

### Critical: Guard Against Non-Authenticated Resume

`didChangeAppLifecycleState()` MUST check `state.status == AuthStatus.authenticated` before calling `validateTokens()`. If the user is on the login screen and the app resumes, `validateTokens()` would call `refreshToken()` which would fail (no refresh token stored), emitting a spurious error state and logging noise.

```dart
@override
void didChangeAppLifecycleState(AppLifecycleState state) {
  if (state == AppLifecycleState.resumed &&
      this.state.status == AuthStatus.authenticated) {
    validateTokens();
  }
}
```

### Architecture Decision D6 Reference

From architecture document, Decision D6 (AppLifecycle + Deep Link + Flavor Strategy):

> **AppLifecycle Integration:** `WidgetsBindingObserver` on `AuthNotifier` — when app resumes, silently validate tokens and refresh if needed. Non-blocking: doesn't show loading UI, just ensures tokens are fresh. **Critical:** `addObserver` in `build()`, `removeObserver` in `ref.onDispose()` — prevents memory leak and ensures lifecycle events stop firing after the notifier is disposed.

### Token Expiration Strategy (No JWT Parsing)

The app does NOT parse JWTs locally. Token expiration is tracked via the `expiresIn` field from `flutter_appauth`'s `TokenResponse`, stored as an absolute `DateTime` in `TokenStorage` (see `token_storage.dart:63`). When `validateTokens()` runs, it compares `DateTime.now()` with the stored expiration — no JWT decoding, no network roundtrip for validation.

### Error Message for Expired Session

The `refreshToken()` catch block (line 246-249) already sets:
```dart
state = const AuthState(
  status: AuthStatus.unauthenticated,
  errorMessage: 'Your session has expired. Please sign in again.',
);
```
This satisfies AC4 — no changes needed to `refreshToken()`.

### Flutter Imports Needed

```dart
import 'package:flutter/widgets.dart'; // for WidgetsBindingObserver, AppLifecycleState
```

Check if this import already exists or if it comes transitively via `flutter_riverpod`.

### Testing Approach — No WidgetsBinding Mock Needed

`didChangeAppLifecycleState()` is a public instance method — call it directly on the `AuthNotifier` in tests. No need to mock `WidgetsBinding.instance`:

```dart
// Direct call — no WidgetsBinding mock needed
notifier.didChangeAppLifecycleState(AppLifecycleState.resumed);
```

The test setup already uses `ProviderContainer` which triggers `build()` and registers the observer. The existing `TestWidgetsFlutterBinding` (from Flutter test framework) handles `addObserver`/`removeObserver` without additional setup.

Reuse `_RecordingAuthLogger` from Story 2.0 for verifying lifecycle log events — no new mock needed.

### Known Limitation: No Mutex in `refreshToken()`

`AuthInterceptor` (Story 2.2) has a `Completer<String?>` mutex to serialize concurrent 401 refreshes. `refreshToken()` itself has NO mutex. If an `AuthInterceptor`-triggered refresh and a lifecycle-triggered refresh run simultaneously, two refresh calls could execute in parallel.

**Risk assessment:** Low. The second refresh would overwrite the first's tokens — both valid. Worst case: one extra refresh call to Keycloak. Not a correctness issue, just a minor inefficiency.

**Decision:** Document here, do NOT fix in this story. The mutex concern is cross-cutting and better addressed holistically in Story 3.2 (Network Error Detection) where error handling patterns are reviewed end-to-end.

### Project Structure Notes

- `lib/services/auth/auth_notifier.dart` — MODIFIED (add mixin, observer registration, didChangeAppLifecycleState)
- No new files created
- No changes to `auth_state.dart`, `token_storage.dart`, `auth_providers.dart`, `auth_logger.dart`

### References

- [Source: _bmad-output/planning-artifacts/architecture.md — D6: AppLifecycle + Deep Link + Flavor Strategy]
- [Source: _bmad-output/planning-artifacts/architecture.md — D1: Auth State Machine]
- [Source: _bmad-output/planning-artifacts/architecture.md — D2: TokenStorage Interface]
- [Source: _bmad-output/planning-artifacts/epics.md — Epic 3, Story 3.1 BDD scenarios]
- [Source: _bmad-output/implementation-artifacts/2-1-silent-token-refresh-logout.md — refreshToken() implementation]
- [Source: _bmad-output/implementation-artifacts/2-2-auth-interceptor-api-service-refactor.md — ApiService refactor patterns]

## Previous Story Intelligence

### From Story 2.2 (AuthInterceptor & ApiService Refactor)

- **`ref.read()` vs `ref.watch()`**: Use `ref.read()` for callbacks/closures that don't need rebuild (avoids circular dependencies). `ref.watch()` for dependencies that should trigger rebuild.
- **`ref.mounted` checks**: EVERY `await` must be followed by `if (!ref.mounted) return;` — prevents state updates on disposed providers.
- **Test pattern**: Manual fakes (no mockito). `FakeTokenStorage`, `_RecordingAuthLogger`, `http.MockClient`.
- **Body-preserving retry**: `http.BaseRequest` is single-use — `request.cloneStream()` or `bodyBytes` capture needed before retry.
- **Epic 6 cleanup items**: 7 `// TODO(epic-6):` markers in codebase. Do NOT touch these.

### From Story 2.1 (Silent Token Refresh & Logout)

- **`.catchError((_) => false)` on `Future<bool>`**: Required to satisfy return type.
- **`ClientException` handling**: Consistent error handling pattern in `KeycloakService` — catch both `SocketException` and `ClientException`.
- **`endSession()` uses GET with query params**: Not POST. Keycloak accepts both.
- **Deferred `POST /api/auth/logout`**: Now implemented in Story 2.2 via `Future.wait`.

### From Story 2.0 (Persistent Auth Logging)

- **`ref.read(authLoggerProvider)`**: Not `ref.watch` — no rebuild on log events.
- **`unawaited()` for fire-and-forget logging**: Never block UI thread with file writes.
- **`flush()` method**: Available on `AuthLogger` for deterministic tests.
- **Structured fields**: `errorCode`, `keycloakEndpoint`, `httpStatus`, `networkReachable`, `message`, `source`.

### Established Code Patterns

```dart
// ref.mounted checks after async gaps
await someAsyncOperation();
if (!ref.mounted) return;

// AuthLogger access
_authLogger.logAuthEvent(message: '...', source: 'AuthNotifier.methodName');
_authLogger.logAuthFailure(errorCode: '...', httpStatus: ..., message: '...', source: '...');

// Best-effort pattern
await someCall().catchError((_) {});
await someBoolFuture().catchError((_) => false);

// State transitions
state = const AuthState.authenticated();
state = const AuthState.unauthenticated();
state = const AuthState(status: AuthStatus.unauthenticated, errorMessage: '...');
state = const AuthState.error(message: '...', retryable: true);
```

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
