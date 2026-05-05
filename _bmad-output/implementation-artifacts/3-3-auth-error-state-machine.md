# Story 3.3: Auth Error State Machine

Status: done

## Story

As a user,
I want the app to always show me a clear state after any authentication error,
so that I am never stuck on a spinner or a blank screen.

## Acceptance Criteria

### AC1 — All auth errors show user-visible message + recovery action within 2 seconds
**Given** any authentication operation fails (login, refresh, logout, network error)
**When** the error is detected
**Then** a user-visible error message and a recovery action are displayed within 2 seconds (NFR4)

### AC2 — Error states are terminal — no indefinite loading
**Given** an authentication error occurs
**When** the app transitions to an error state
**Then** the app is in one of three defined terminal states: login screen, error screen with recovery action, or authenticated screen (NFR4)
**And** the app never remains in an intermediate loading state for more than 10 seconds without user feedback (NFR5)

### AC3 — Retryable errors show retry button
**Given** an `AuthState(status: AuthStatus.error, retryable: true)`
**When** the error screen is displayed
**Then** a retry button is shown — tapping it re-triggers the failed operation

### AC4 — Non-retryable errors show sign-in button
**Given** an `AuthState(status: AuthStatus.error, retryable: false)`
**When** the error screen is displayed
**Then** a "Sign in" button is shown — the user must start a new authentication flow

### AC5 — Deep link callback failure recovery
**Given** a deep link callback is received but fails mid-way (network timeout, lost packet)
**When** the app never receives the authorization code
**Then** the app remains on the login screen — not stuck on a spinner (FR13)
**And** the user can tap "Sign in" again — Keycloak SSO recognizes the active session and the callback succeeds on retry

### AC6 — State machine covers all error paths
**Given** the auth state machine
**When** all error transitions are tested
**Then** every possible error path ends in one of the three defined terminal states — verified by state machine unit tests (NFR5)

### AC7 — Auto-recovery on network return
**Given** the user is in a retryable error state (no internet)
**When** network connectivity returns
**Then** the app automatically clears the error state and retries the failed operation
**And** if the retry succeeds, the user proceeds to the intended screen

**Given** the app auto-retries after network return
**When** the retry fails again (still offline or different error)
**Then** the error state persists with `retryable: true` and the updated error message
**And** the user can manually tap "Retry" — no automatic retry loop

### AC8 — All auth failures are logged
**Given** any authentication failure
**When** the failure is logged
**Then** the persistent logging infrastructure records the failure with structured fields (NFR9)

## Tasks / Subtasks

- [x] Task 1: Implement auto-recovery on network return (AC: #7)
  - [x] 1.1 Subscribe to `_connectivityChecker.onConnectivityChanged` in `AuthNotifier.build()`
  - [x] 1.2 Add debounce (500ms) to prevent rapid state flapping from transient connectivity changes
  - [x] 1.3 When transition from offline→online while in retryable error state, auto-retry the failed operation
  - [x] 1.4 Track which operation failed (`authorize` vs `refreshToken` vs `validateTokens`) so the retry knows what to do
  - [x] 1.5 Cancel subscription on dispose (`ref.onDispose`)

- [x] Task 2: Track failed operation context for auto-retry (AC: #7)
  - [x] 2.1 Add `_lastFailedOperation` private enum field to `AuthNotifier` (`none`, `authorize`, `refreshToken`, `validateTokens`) — NOT in `AuthState` (internal implementation detail, UI only needs `retryable` flag)
  - [x] 2.2 Set `_lastFailedOperation` before each operation attempt, clear on success
  - [x] 2.3 Auto-retry method switches on `_lastFailedOperation` to call the correct method

- [x] Task 3: Add timeout protection to all auth operations (AC: #2)
  - [x] 3.1 Wrap `authorize()` with `Future.timeout()` (30 seconds)
  - [x] 3.2 Wrap `refreshToken()` with `Future.timeout()` (15 seconds)
  - [x] 3.3 Wrap `KeycloakService.discoverEndpoints()` with `Future.timeout()` (10 seconds)
  - [x] 3.4 On timeout, emit error state with `retryable: true` and user-friendly message
  - [x] 3.5 Log timeout failures with `error_code: 'AUTH_TIMEOUT'` or `'REFRESH_TIMEOUT'`

- [x] Task 4: Error widget component (NEW) (AC: #1, #2, #3, #4)
  - [x] 4.1 Create `lib/components/auth/auth_error_widget.dart` as a `ConsumerWidget` (NOT a full Scaffold — inline widget, not a separate route)
    - Icon representing error type (wifi_off for retryable, error_outline for non-retryable)
    - Error message from `AuthState.errorMessage`
    - Retry button (shown when `retryable: true`)
    - "Sign in" button (shown when `retryable: false`)
  - [x] 4.2 Wire up retry button to call `AuthNotifier.retryAuthorize()`
  - [x] 4.3 Wire up "Sign in" button to call `AuthNotifier.authorize()`
  - [x] 4.4 Add accessibility labels via `Semantics` widget (NFR10)

- [x] Task 5: Update login screen error display (AC: #1, #2, #3, #4)
  - [x] 5.1 Replace existing `_buildErrorState()` in `OidcLoginScreen` with `AuthErrorWidget`
  - [x] 5.2 `AuthErrorWidget` is displayed inline when `status == AuthStatus.error` (no navigation push/pop)
  - [x] 5.3 Existing `_buildSignInButton()` remains for the default unauthenticated state
  - [x] 5.4 When `status == AuthStatus.authenticated`, navigate to authenticated screen (existing behavior)

- [x] Task 6: Ensure all error paths emit valid AuthState (AC: #2, #6)
  - [x] 6.1 Audit ALL catch blocks in `AuthNotifier` — verify every error path emits either:
    - `AuthState.unauthenticated()` (session dead)
    - `AuthState.error(retryable: true, message: ...)` (recoverable)
    - `AuthState.error(retryable: false, message: ...)` (must re-auth)
  - [x] 6.2 Add explicit error handling for `TimeoutException`
  - [x] 6.3 Add explicit error handling for `FormatException` (malformed token response)
  - [x] 6.4 Ensure no catch block silently fails without state transition

- [x] Task 7: Unit tests (AC: all)
  - [x] 7.1 Auto-recovery: offline→online transition triggers retry of last failed operation
  - [x] 7.2 Auto-recovery: debounce prevents multiple rapid retries on flapping network
  - [x] 7.3 Auto-recovery: does NOT auto-retry when error is not retryable
  - [x] 7.4 Auto-recovery: subscription cancelled on dispose
  - [x] 7.5 Timeout: `authorize()` timeout emits error state, doesn't hang forever
  - [x] 7.6 Timeout: `refreshToken()` timeout emits error state, doesn't hang forever
  - [x] 7.7 Timeout: `discoverEndpoints()` timeout emits error state
  - [x] 7.8 State machine: all error transitions end in defined terminal state
  - [x] 7.9 State machine: `_lastFailedOperation` is tracked correctly for each operation
  - [x] 7.10 State machine: error state is cleared on successful retry
  - [x] 7.11 Deep link callback failure: app returns to login screen, not stuck
  - [x] 7.12 Error screen: retry button calls correct retry method
  - [x] 7.13 Error widget: sign-in button calls authorize
  - [x] 7.14 Auto-recovery: failed auto-retry persists error state, does NOT loop
  - [x] 7.15 Auto-recovery: debounce rapid-fire offline→online→offline→online < 500ms → single retry only
  - [x] 7.16 Auto-recovery: race condition — authorize() in progress + network return → no double retry
  - [x] 7.17 Auto-recovery: dispose() during debounce → timer cancelled, no phantom callback
  - [x] 7.18 Widget test: AuthErrorWidget shows retry button when retryable=true
  - [x] 7.19 Widget test: AuthErrorWidget shows sign-in button when retryable=false

- [x] Task 8: Lint and analyze
  - [x] 8.1 Run `flutter analyze` — zero new issues
  - [x] 8.2 Run `flutter test` — all tests pass (existing + new)

## Dev Notes

### What Already Exists — DO NOT Recreate

**From Story 3.2 (Network Error Detection & Recovery):**
- `ConnectivityChecker` interface with `isOnline` and `onConnectivityChanged` stream
- `RealConnectivityChecker` wraps `ConnectivityService` singleton
- `connectivityCheckerProvider` in `auth_providers.dart`
- Pre-flight connectivity checks in `authorize()` and `refreshToken()`
- `_isNetworkError()` helper for classifying platform exceptions
- `retryAuthorize()` method for retrying failed authorization
- Network errors set `retryable: true` and preserve tokens
- `onConnectivityChanged` stream exists but is NOT subscribed to (Story 3.2 deliberately deferred this)

**From Story 3.1 (AppLifecycle Token Validation):**
- `ref.mounted` checks after every `await`
- `WidgetsBindingObserver` mixin on `AuthNotifier`
- `didChangeAppLifecycleState()` calls `validateTokens()` on resume
- `TestWidgetsFlutterBinding.ensureInitialized()` in test file

**From Story 2.2 (AuthInterceptor & ApiService Refactor):**
- Manual fakes pattern (not mockito)
- `ref.read()` for callbacks, `ref.watch()` for rebuild-triggering deps
- `unawaited()` for fire-and-forget logging

**From Story 2.0 (Persistent Auth Logging):**
- `AuthLogger` with `logAuthFailure()` accepting structured fields
- `flush()` method for deterministic tests

### What This Story Changes

| File | Change Type | Description |
|------|------------|-------------|
| `lib/services/auth/auth_notifier.dart` | MODIFIED | Add connectivity stream subscription, timeout wrappers, operation tracking, error state audit |
| `lib/components/auth/auth_error_widget.dart` | NEW | Inline error widget with retry/sign-in buttons (ConsumerWidget, not Scaffold) |
| `lib/components/auth/oidc_login_screen.dart` | MODIFIED | Replace `_buildErrorState()` with `AuthErrorWidget` |
| `test/services/auth/auth_notifier_test.dart` | MODIFIED | Add auto-recovery, timeout, and state machine tests |

Files NOT modified: `auth_state.dart`, `token_storage.dart`, `keycloak_service.dart`, `api_service.dart`, `auth_interceptor.dart`, `auth_logger.dart`, `connectivity_service.dart`, `connectivity_checker.dart`

### Architecture: Auto-Recovery via Connectivity Stream

Story 3.2 created the `ConnectivityChecker.onConnectivityChanged` stream but deliberately did NOT subscribe to it. This story adds the subscription and implements auto-recovery:

```dart
// In AuthNotifier — new fields
StreamSubscription<bool>? _connectivitySubscription;
Timer? _debounceTimer;

@override
AuthState build() {
  // ... existing provider initialization ...

  // NEW: Subscribe to connectivity changes with manual debounce
  _connectivitySubscription = _connectivityChecker.onConnectivityChanged.listen((isOnline) {
    _debounceTimer?.cancel();
    _debounceTimer = Timer(const Duration(milliseconds: 500), () {
      if (isOnline && state.status == AuthStatus.error && state.retryable) {
        _autoRetryLastFailedOperation();
      }
    });
  });

  ref.onDispose(() {
    _connectivitySubscription?.cancel();
    _debounceTimer?.cancel();
  });

  // ... existing observer setup, initialization ...
}
```

**Debounce is critical:** Without it, rapid offline→online→offline transitions (common on mobile) would trigger a retry storm. The 500ms debounce is a conservative threshold — it's long enough to smooth flapping but short enough that the user perceives instant recovery.

**Why NOT use `rxdart`'s `debounceTime`:**
- `rxdart` is NOT in dependencies (avoid adding new dependencies unless necessary)
- Dart's `async` package is NOT in dependencies either
- Implement debounce manually with `Timer` — see the `build()` snippet above

### Architecture: Auto-Recovery Failure Behavior

**Auto-retry fires at most ONCE per offline→online transition.** The debounce timer does NOT re-arm after an auto-retry failure:

1. Network drops → error state (`retryable: true`, `_lastFailedOperation` set)
2. Network returns → debounce 500ms → `_autoRetryLastFailedOperation()` called
3. If auto-retry **succeeds** → state transitions to `authenticated` or `unauthenticated`
4. If auto-retry **fails** → error state is updated with new error message, `retryable: true` preserved
5. **No further automatic retry** — the user must manually tap "Retry"
6. The debounce timer does NOT fire again until a NEW offline→online transition occurs

**Why no auto-retry loop:** A device in a tunnel with intermittent connectivity could auto-retry indefinitely, draining battery and confusing the user. One automatic attempt is a reasonable UX compromise — the user sees the app "trying" and can take manual control if it doesn't work.

### Architecture: Timeout Protection

**Why timeout wrappers are needed:**
- `flutter_appauth` has NO built-in timeout for `authorizeAndExchangeCode()`
- If the system browser hangs or the network enters a black hole state, the app waits forever
- NFR5 requires: "no intermediate loading state for more than 10 seconds"
- 30-second timeout for `authorize()` is conservative (browser auth may take time)
- 15-second timeout for `refreshToken()` matches typical token endpoint SLAs
- 10-second timeout for `discoverEndpoints()` prevents hanging on unreachable URLs

**Implementation pattern:**

```dart
Future<void> authorize() async {
  // ... existing pre-flight connectivity check ...

  try {
    final tokenResponse = await _appAuth.authorizeAndExchangeCode(/* ... */)
        .timeout(
          const Duration(seconds: 30),
          onTimeout: () {
            throw TimeoutException('Authorization timed out', Duration(seconds: 30));
          },
        );
    // ... existing success handling ...
  } on TimeoutException catch (_) {
    _authLogger.logAuthFailure(
      errorCode: 'AUTH_TIMEOUT',
      networkReachable: _connectivityChecker.isOnline,
      message: tr('auth.timeout'),
      source: 'AuthNotifier.authorize',
    );
    state = AuthState.error(
      message: tr('auth.timeout'),
      retryable: true,
    );
    _lastFailedOperation = _FailedOperation.authorize;
  } catch (e) {
    // ... existing error handling ...
  }
}
```

**Note:** `TimeoutException` requires `import 'dart:async';`.

### Architecture: Tracking Failed Operations

For auto-recovery to work, the app must know WHAT operation to retry:

```dart
enum _FailedOperation { none, authorize, refreshToken, validateTokens }

_FailedOperation _lastFailedOperation = _FailedOperation.none;

Future<void> authorize() async {
  _lastFailedOperation = _FailedOperation.authorize;
  try {
    // ... existing auth flow ...
    _lastFailedOperation = _FailedOperation.none; // Clear on success
  } catch (e) {
    // ... existing error handling ...
  }
}

Future<void> _autoRetryLastFailedOperation() async {
  switch (_lastFailedOperation) {
    case _FailedOperation.authorize:
      await retryAuthorize();
      break;
    case _FailedOperation.refreshToken:
    case _FailedOperation.validateTokens:
      await validateTokens();
      break;
    case _FailedOperation.none:
      // Nothing to retry
      break;
  }
}
```

**Why NOT merge `refreshToken` and `validateTokens`:**
- `validateTokens()` is the public API called by lifecycle and UI
- `refreshToken()` is internal implementation
- If `validateTokens()` failed because tokens are expired, retrying it should re-attempt refresh
- If `refreshToken()` failed with network error, retrying it should NOT re-validate (already know tokens are expired)

### Architecture: Three Terminal States

Per NFR4 and NFR5, every auth operation MUST end in one of these states:

| State | Condition | UI Shows | User Action |
|-------|-----------|----------|-------------|
| `authenticated` | Valid tokens, user logged in | Authenticated screen | Continue using app |
| `unauthenticated` | No tokens, session dead | Login screen | Tap "Sign in" |
| `error (retryable: true)` | Network error, timeout | Error screen with "Retry" | Tap "Retry" OR wait for auto-recovery |
| `error (retryable: false)` | Invalid grant, revoked session | Error screen with "Sign in" | Tap "Sign in" |

**Critical:** No intermediate loading state survives beyond 10 seconds. Every `try` block must have:
1. A success path → `authenticated` or `unauthenticated`
2. A timeout wrapper → `error (retryable: true)`
3. A catch block → `error` or `unauthenticated`

### Architecture: Error Widget Component

The error widget is a NEW **inline** `ConsumerWidget` — NOT a separate route or Scaffold. It replaces the existing `_buildErrorState()` in `OidcLoginScreen`:

```dart
// lib/components/auth/auth_error_widget.dart
class AuthErrorWidget extends ConsumerWidget {
  const AuthErrorWidget({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);
    final message = authState.errorMessage ?? tr('auth.unknownError');
    final retryable = authState.retryable;

    return Semantics(
      label: 'Authentication error: $message',
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Icon(
            retryable ? Icons.wifi_off : Icons.error_outline,
            size: 64,
            semanticLabel: retryable
                ? tr('auth.noInternetConnection')
                : tr('auth.error'),
          ),
          const SizedBox(height: 24),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 32),
            child: Text(
              message,
              style: Theme.of(context).textTheme.bodyLarge,
              textAlign: TextAlign.center,
            ),
          ),
          const SizedBox(height: 32),
          Semantics(
            label: retryable ? tr('auth.retry') : tr('auth.signIn'),
            button: true,
            child: ElevatedButton(
              onPressed: () {
                if (retryable) {
                  ref.read(authProvider.notifier).retryAuthorize();
                } else {
                  ref.read(authProvider.notifier).authorize();
                }
              },
              child: Text(retryable ? tr('auth.retry') : tr('auth.signIn')),
            ),
          ),
        ],
      ),
    );
  }
}
```

**Integration in `OidcLoginScreen`:**
```dart
// Replace _buildErrorState() with:
Widget _buildErrorState() {
  return const AuthErrorWidget();
}
```

**Why inline, not a separate route:**
- The login screen is already the "error screen" — no need for navigation push/pop
- Avoids managing navigation state (which screen to pop back to after retry success)
- Consistent with existing pattern: `_buildErrorState()` already renders inline
- Simpler state management: auth state change automatically shows/hides the widget

**Accessibility notes:**
- Icons have `semanticLabel` for TalkBack/VoiceOver
- Touch targets are 48x48dp minimum (button default)
- Error state is NOT indicated by color alone (icon type + text message)
- Outer `Semantics` wraps the entire widget for screen reader context

### Critical: Deep Link Callback Failure (FR13)

The user scenario:
1. User taps "Sign in" → system browser opens Keycloak
2. User authenticates → Keycloak redirects via custom URL scheme
3. Network drops mid-redirect → app never receives the callback
4. App is stuck on "Loading..." spinner forever

**How Story 3.2 partially addressed this:**
- Pre-flight connectivity check catches offline-at-start
- Try-catch safety net catches network drops during discovery
- BUT: if network drops AFTER the browser opens, `flutter_appauth` hangs waiting for callback

**How Story 3.3 completes the fix:**
- Timeout wrapper on `authorize()` (30 seconds)
- On timeout, emit `AuthState.error(retryable: true)`
- User sees error screen with "Retry" button
- On retry, Keycloak SSO recognizes the active session and callback succeeds immediately

**No code change needed for deep link handling** — the timeout on the entire `authorizeAndExchangeCode()` call covers the failure mode.

### Critical: All Catch Blocks Audit

Every `catch` block in `AuthNotifier` MUST emit a valid state. Current audit:

| Location | Error Type | Current Emits | Needs Fix? |
|----------|-----------|---------------|------------|
| `authorize()` — pre-flight check | N/A (check fails) | ✅ `error (retryable: true)` | No |
| `authorize()` — discovery | `SocketException`, `ClientException` | ✅ `error (retryable: true)` | No |
| `authorize()` — AppAuth | `FlutterAppAuthPlatformException` | ⚠️ Mixed | **YES** |
| `authorize()` — timeout | `TimeoutException` | ❌ Missing | **YES** — add |
| `refreshToken()` — pre-flight check | N/A (check fails) | ✅ `error (retryable: true)` | No |
| `refreshToken()` — token call | `SocketException`, `ClientException` | ✅ `error (retryable: true)` | No |
| `refreshToken()` — catch block | `Exception` | ✅ `unauthenticated` | No |
| `refreshToken()` — timeout | `TimeoutException` | ❌ Missing | **YES** — add |
| `discoverEndpoints()` — timeout | `TimeoutException` | ❌ Missing | **YES** — add |

**FlutterAppAuthPlatformException handling needs audit:**
- Some codes indicate user cancellation → `unauthenticated` (correct)
- Some codes indicate network error → `error (retryable: true)` (correct via `_isNetworkError`)
- Some codes indicate auth failure (invalid_grant) → `error (retryable: false)` (needs verification)

### Error Classification: access_denied Scenario

**User cancels consent in system browser:**
- `flutter_appauth` throws `FlutterAppAuthUserCancelledException` → already handled as `AuthState.unauthenticated()` (no change needed)

**Keycloak returns `error=access_denied` in callback:**
- If `flutter_appauth` maps this to a platform exception → check if `_isNetworkError()` returns `false` (correct — it's not a network error), then existing catch block handles it
- If `flutter_appauth` returns it as a token response → add explicit check in success path:
```dart
// After successful token exchange, check for error response
if (tokenResponse?.accessToken == null && tokenResponse?.tokenType == null) {
  // Keycloak returned an error (e.g., access_denied)
  state = AuthState.error(
    message: tr('auth.accessDenied'),
    retryable: false, // User must explicitly re-authorize
  );
  return;
}
```
- This is a defensive check — verify at implementation time whether `flutter_appauth` already throws for error responses

### Files Being Modified — Current State

**`auth_notifier.dart` (~350 lines expected after this story):**
- `build()` (line ~35-48): Add connectivity stream subscription + debounce
- `authorize()` (line ~81-207): Add timeout wrapper + operation tracking
- `refreshToken()` (line ~209-256): Add timeout wrapper + operation tracking
- `didChangeAppLifecycleState()` (line ~310-321): NO CHANGE — already calls `validateTokens()`
- New fields: `_connectivitySubscription`, `_debounceTimer`, `_lastFailedOperation`
- New methods: `_onConnectivityChanged()`, `_autoRetryLastFailedOperation()`

**`auth_error_widget.dart` (NEW, ~60 lines):**
- Inline ConsumerWidget with retry/sign-in buttons
- Semantics wrapper for accessibility

**`oidc_login_screen.dart` (MODIFY):**
- Replace `_buildErrorState()` with `AuthErrorWidget`

**`auth_notifier_test.dart` (~1100 lines expected):**
- Auto-recovery tests (7 tests)
- Timeout tests (3 tests)
- State machine coverage tests (3 tests)
- Race condition tests (2 tests)
- Widget tests (2 tests)
- All existing tests must continue passing

### What Must Be Preserved

1. All existing `authorize()` behavior when online — discovery, browser auth, token exchange, error states
2. All existing `refreshToken()` behavior when online — token exchange, save, expired session handling
3. All existing `didChangeAppLifecycleState()` behavior — lifecycle validation on resume
4. All existing `logout()` behavior — Future.wait, deleteAll, state transition
5. All existing test expectations — no regressions
6. `ConnectivityChecker` interface — NO changes to the interface itself
7. `onConnectivityChanged` stream — NO changes to `RealConnectivityChecker` implementation

### Testing Strategy

**Auto-recovery tests:**
- Mock `ConnectivityChecker` that emits offline→online transitions
- Verify `_lastFailedOperation` is set before failure
- Verify retry is called after online transition (with debounce)
- Verify subscription is cancelled on dispose

**Timeout tests:**
- Mock `AppAuth` with delayed future (> 30 seconds)
- Verify timeout triggers error state
- Verify error has `retryable: true`

**State machine tests:**
- Enumerate ALL error paths (network, timeout, auth failure, cancellation)
- Verify each path ends in defined terminal state
- Verify `_lastFailedOperation` is tracked correctly

**Error widget tests:**
- Widget test for `AuthErrorWidget` with `retryable: true` — verify retry button visible and calls `retryAuthorize()`
- Widget test for `AuthErrorWidget` with `retryable: false` — verify sign-in button visible and calls `authorize()`
- Verify accessibility labels via `Semantics` widget

### Error Code Conventions (New)

- `AUTH_TIMEOUT` — `authorize()` timed out (> 30 seconds)
- `REFRESH_TIMEOUT` — `refreshToken()` timed out (> 15 seconds)
- `DISCOVERY_TIMEOUT` — `discoverEndpoints()` timed out (> 10 seconds)

### Architecture Reference

- **FR13**: "Deep link callback failure recovery — app remains on login screen, not stuck on spinner"
- **FR14**: "Specific error state with user-facing message and recovery action within 2 seconds"
- **NFR4**: "Error message and recovery action within 2 seconds of error detection"
- **NFR5**: "No intermediate loading state for more than 10 seconds without user feedback"
- **NFR9**: "Auth failures logged with structured fields (error_code, keycloak_endpoint, http_status, network_reachable, timestamp)"
- **Error handling pattern**: "Network errors set `retryable: true` — UI shows retry button"
- **State machine**: "Three terminal states — authenticated, unauthenticated, error"

### References

- [Source: _bmad-output/planning-artifacts/epics.md — Epic 3, Story 3.3 BDD scenarios]
- [Source: _bmad-output/planning-artifacts/architecture.md — Error Handling in Auth Flow]
- [Source: _bmad-output/planning-artifacts/architecture.md — D1: Auth State Machine (retryable flag)]
- [Source: _bmad-output/implementation-artifacts/3-2-network-error-detection-recovery.md — Previous story with connectivity infrastructure]
- [Source: _bmad-output/implementation-artifacts/3-1-applifecycle-token-validation.md — Previous story with lifecycle patterns]
- [Source: lib/services/auth/auth_notifier.dart — Current implementation]
- [Source: lib/services/auth/connectivity_checker.dart — Connectivity interface from Story 3.2]

## Dev Agent Record

### Agent Model Used

glm-5-turbo (Claude Code)

### Debug Log References

### Completion Notes List

- Implemented auto-recovery via connectivity stream subscription with 500ms debounce in AuthNotifier.build()
- Added _FailedOperation enum to track which operation failed for auto-retry
- Added timeout protection: 30s authorize, 15s refreshToken, 10s discoverEndpoints — all as static const Duration fields
- Created AuthErrorWidget as inline ConsumerWidget with retry/sign-in buttons and Semantics accessibility
- Replaced OidcLoginScreen._buildErrorState() with AuthErrorWidget
- Audited all catch blocks — non-network platform exceptions now set retryable: false (was incorrectly retryable: true)
- Added explicit TimeoutException handling in authorize(), refreshToken() with structured logging
- Added i18n keys: auth.timeout, auth.retry, auth.signIn, auth.error, auth.accessDenied, auth.unknownError
- 22 new unit tests covering auto-recovery, debounce, timeout, state machine, race conditions, dispose safety
- All 136 auth tests pass, zero new analyzer issues

### Change Log

- 2026-04-28: Implemented Story 3.3 — Auth Error State Machine (all 8 tasks complete)

### File List

- mobile/genie_ai_mobile/lib/services/auth/auth_notifier.dart (MODIFIED)
- mobile/genie_ai_mobile/lib/components/auth/auth_error_widget.dart (NEW)
- mobile/genie_ai_mobile/lib/components/auth/oidc_login_screen.dart (MODIFIED)
- mobile/genie_ai_mobile/lib/i18n/locales/en.dart (MODIFIED)
- mobile/genie_ai_mobile/test/services/auth/auth_notifier_test.dart (MODIFIED)
- _bmad-output/implementation-artifacts/sprint-status.yaml (MODIFIED)
- _bmad-output/implementation-artifacts/3-3-auth-error-state-machine.md (MODIFIED)

### Review Findings

- [x] [Review][Decision] No concurrent-execution guard on refreshToken()/validateTokens() — added `_isRefreshing` guard with `finally` block covering all early returns
- [x] [Review][Patch] Generic catch in authorize() marks non-network errors as retryable — added `_networkErrorClassifier.isNetworkError(e)` check, non-network now `retryable: false`
- [x] [Review][Patch] FormatException not handled despite spec Task 6.3 — added `on FormatException catch` with `retryable: false` and structured logging
- [x] [Review][Patch] No onError callback on connectivity stream subscription — added `onError` callback with `CONNECTIVITY_STREAM_ERROR` log
- [x] [Review][Patch] Hardcoded English Semantics label in AuthErrorWidget — replaced with `tr('auth.error')`
- [x] [Review][Patch] refreshToken() TimeoutException doesn't distinguish discovery vs token timeout — added same discrimination logic as authorize()
- [x] [Review][Patch] Fragile TimeoutException discrimination via string matching — added `e.duration == discoveryTimeout` as fallback discriminant
