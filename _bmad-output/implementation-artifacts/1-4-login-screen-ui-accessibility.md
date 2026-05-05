# Story 1.4: Login Screen UI & Accessibility

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a user,
I want a clean login screen with a "Sign in" button that opens Keycloak in the system browser,
So that I can authenticate and see my auth status clearly.

## Acceptance Criteria

1. **AC1 - Login screen on launch (NFR2):** When the user is not authenticated and the app launches, the login screen is displayed within 1 second of cold start. The screen shows the institution's branding (logo, app title) from `GenieAiConfig` and a "Sign in" button with a minimum touch target of 48x48dp (NFR10).

2. **AC2 - Sign in triggers OIDC flow:** When the user taps "Sign in", `ref.read(authProvider.notifier).authorize()` is called and the system browser opens with the Keycloak login page.

3. **AC3 - Accessibility (NFR10):** When the login screen is displayed, all interactive elements have semantic labels. The sign-in button is announced correctly by TalkBack (Android) / VoiceOver (iOS). Auth status is not indicated by color alone — use icons, text labels, or shape to distinguish states.

4. **AC4 - Error state display:** When `authProvider` emits `AuthState(status: AuthStatus.error)`, the error message is displayed on the login screen. A recovery action is shown: retry button if `retryable: true`, or "Sign in" button if `retryable: false`.

5. **AC5 - Auto-skip when authenticated:** When the user is already authenticated (tokens in storage, not expired), the app launches and skips the login screen, showing the authenticated UI (MainScreen) directly.

6. **AC6 - No sensitive data in logs (FR25):** When the login screen is displayed and the auth flow runs, no tokens, credentials, or PII appear in debug logs.

7. **AC7 - Existing tests pass:** `flutter analyze` — no new issues. `flutter test` — all 54 existing tests pass, no regressions.

## Tasks / Subtasks

- [x] Task 1: Create OidcLoginScreen widget (AC: #1, #2, #3)
  - [x] 1.1: Create `lib/components/auth/oidc_login_screen.dart` — `ConsumerWidget` (not ConsumerStatefulWidget, no mutable state needed)
  - [x] 1.2: Display branding: logo via `ThemeManager`/config path (not hardcoded — Epic 4 will swap per flavor) + app title
  - [x] 1.3: Add "Sign in" `ElevatedButton` with 48x48dp minimum touch target (Material default), calling `ref.read(authProvider.notifier).authorize()`
  - [x] 1.4: Add `Semantics` widget wrapping the button with label "Sign in with your institution account"
  - [x] 1.5: Handle `AuthStatus.unauthenticated` — show default login UI
  - [x] 1.6: Handle `AuthStatus.authenticated` — navigate to MainScreen or show placeholder
  - [x] 1.7: Handle `AuthStatus.error` — show `errorMessage` text + conditional retry button (AC: #4)
  - [x] 1.8: Any retry button must also respect 48x48dp minimum touch target (use Material button defaults)
- [x] Task 2: Integrate OidcLoginScreen into main.dart routing (AC: #1, #5)
  - [x] 2.1: Replace `_user == null` conditional in `MyApp.build()` with `ref.watch(authProvider)` status check
  - [x] 2.2: When `AuthStatus.authenticated` → show `MainScreen`
  - [x] 2.3: When `AuthStatus.unauthenticated` or `AuthStatus.error` → show `OidcLoginScreen`
  - [x] 2.4: Convert `MyApp` from `StatefulWidget` to `ConsumerStatefulWidget` for Riverpod access (keeps `_isConfigLoaded` state, replaces `_user` with `ref.watch`)
  - [x] 2.5: Remove legacy `_user` state and `_handleLogin`/`_handleLogout` callbacks from MyApp
  - [x] 2.6: Keep legacy named routes (`/register`, `/password-reset`, etc.) for backward compatibility — do NOT delete them yet (Epic 6)
  - [x] 2.7: Update `/login` named route to point to `OidcLoginScreen` instead of legacy `LoginScreen`
  - [x] 2.8: `MainScreen` currently requires `Map<String, dynamic> user` — pass a minimal map with the fields that downstream components expect (at minimum `id`/`_id` for ChatBotComponent, `accessToken`/`token` for RightSidebarComponent). Full Riverpod refactor of MainScreen deferred to Epic 2
  - [x] 2.9: `MainScreen.onLogout` callback — leave as placeholder/no-op for now. Full logout via `AuthNotifier` implemented in Epic 2 (Story 2.1)
- [x] Task 3: Accessibility compliance (AC: #3)
  - [x] 3.1: Add `Semantics` wrapper on login screen root with label "Login screen"
  - [x] 3.2: Ensure error message has `Semantics` label (e.g., "Authentication error: Network unreachable")
  - [x] 3.3: Ensure retry button has `Semantics` label "Retry sign in"
  - [x] 3.4: Verify auth state is not indicated by color alone — use text labels and icons alongside any color coding
  - [x] 3.5: Run `flutter analyze` — no new issues
- [x] Task 4: Error state UI (AC: #4)
  - [x] 4.1: When `AuthState.error` with `retryable: true` — show error message text + "Retry" button that calls `ref.read(authProvider.notifier).authorize()`
  - [x] 4.2: When `AuthState.error` with `retryable: false` — show error message text + "Sign in" button (new flow)
  - [x] 4.3: Error text should use `ThemeManager` colors, not raw color literals
- [x] Task 5: Verify and test (AC: #5, #6, #7)
  - [x] 5.1: Build with dev flavor: `flutter build apk --flavor dev`
  - [x] 5.2: Launch app with no tokens → login screen displayed
  - [x] 5.3: Launch app with valid tokens → MainScreen displayed (skip login)
  - [x] 5.4: Run `flutter test` — all 54 existing tests pass
  - [x] 5.5: Run `flutter analyze` — no new issues
  - [x] 5.6: Verify no tokens or credentials in `debugPrint` output

## Dev Notes

### What This Story Does

This story creates the **user-facing login screen** for the new OIDC auth system and wires it into the app's routing. It is the first UI story in the OIDC migration — Stories 1.1–1.3b built the invisible auth infrastructure (token storage, state machine, OIDC flow, URL scheme registration). This story makes that infrastructure visible to the user.

The new `OidcLoginScreen` is a **parallel** screen to the existing legacy `LoginScreen` — both exist during the migration. The legacy screen is deleted in Epic 6 (Story 6.3). Do NOT modify or delete the legacy `LoginScreen` in this story.

### Existing Login Screen — Reuse the Logo

The existing `LoginScreen` (`lib/components/auth/login_screen.dart`) already displays the GENIE.AI logo. **Reuse the same logo asset and display pattern** for the new `OidcLoginScreen`:

- Logo asset: check `assets/config/` for SVG/PNG logo files (e.g., `genie-ai-icon-light.svg`)
- Display pattern: the existing login screen uses `Image.asset()` with `ThemeManager` colors — follow the same pattern
- App title: "Genie AI" from `ThemeManager` or `genie-ai-config.json`
- **Important:** Do not hardcode the logo asset path in the widget — use `ThemeManager` or config path so Epic 4 can swap per deployment flavor

### Current main.dart Routing — What Changes

The current `MyApp` (in `main.dart`) uses a `_user` map to decide routing:

```dart
home: _user == null
    ? LoginScreen(onLoginSuccess: _handleLogin)
    : MainScreen(user: _user!, ...)
```

This story replaces the `_user` state-driven routing with **Riverpod auth state-driven routing**:

```dart
home: authState.status == AuthStatus.authenticated
    ? MainScreen(...)
    : OidcLoginScreen()
```

**Critical migration notes:**
- `MyApp` must become a `ConsumerStatefulWidget` to call `ref.watch(authProvider)` — it keeps `_isConfigLoaded` state (needed for config loading spinner) while replacing `_user` with Riverpod
- The `_user` map, `_handleLogin`, and `_handleLogout` callbacks are **removed** from `MyApp`
- `MainScreen` currently requires a `Map<String, dynamic> user` with fields like `id`/`_id`, `accessToken`/`token`. Pass a minimal placeholder map for now. The full `MainScreen` refactor to consume auth state via Riverpod is deferred (it needs `AuthInterceptor` from Epic 2). Downstream components that access `widget.user['id']` or `widget.user['accessToken']` must not crash on null — use `??` defaults or make the fields nullable.
- `MainScreen.onLogout` — leave as a no-op placeholder. Full logout via `AuthNotifier.logout()` is implemented in Epic 2 (Story 2.1). Do NOT leave a silent `() {}` without a comment explaining the deferral.
- Legacy named routes (`/register`, `/password-reset`, etc.) must remain for backward compatibility — do NOT delete them (Epic 6 removes them)
- The `/login` named route should be updated to point to `OidcLoginScreen` instead of legacy `LoginScreen`

### Auth State → UI Mapping

| AuthState | UI Behavior |
|-----------|-------------|
| `AuthState.unauthenticated()` | Show default login UI with "Sign in" button |
| `AuthState.authenticated()` | Navigate to MainScreen (auto-skip login) |
| `AuthState.error(retryable: true)` | Show error message + "Retry" button (calls `authorize()`) |
| `AuthState.error(retryable: false)` | Show error message + "Sign in" button (new flow) |

### Auto-Login on App Launch

`AuthNotifier.build()` already handles this — it calls `_initializeAuth()` which checks stored tokens. If valid tokens exist, the state transitions to `authenticated` before the first frame renders. The UI simply reacts to this state via `ref.watch(authProvider)`. No additional logic needed in the login screen.

**No loading spinner needed during init:** The existing `MyApp` already shows a `CircularProgressIndicator` while `_isConfigLoaded` is false (during config loading). The auth init happens after config loads and is a single-frame transition — no visible flash. No additional loading state needed (validated by Party Mode review).

### Accessibility Requirements (NFR10)

- **Minimum touch target:** 48x48dp on Android, 44x44pt on iOS. Use `SizedBox` constraints or `Material` button defaults (which are already 48dp).
- **Semantic labels:** All interactive elements need `Semantics` wrappers. The login screen root should have `Semantics(label: 'Login screen')`.
- **No color-only indication:** Auth state must be communicated via text + icons, not color alone. Error states must have text descriptions alongside any red/warning color.
- **TalkBack/VoiceOver:** Standard Material widgets (ElevatedButton, Text) have built-in accessibility. Custom widgets need explicit `Semantics`.

### Project Structure Notes

- `lib/components/auth/oidc_login_screen.dart` — NEW file (the new OIDC login screen)
- `lib/main.dart` — MODIFIED (routing logic: `_user` → `ref.watch(authProvider)`)
- Legacy `lib/components/auth/login_screen.dart` — UNTOUCHED (deleted in Epic 6)
- No changes to `lib/services/auth/` — the auth service layer is complete
- No new tests required for this story (UI testing is deferred to Epic 6, Story 6.5)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.4]
- [Source: _bmad-output/planning-artifacts/architecture.md#D1 Auth State Machine]
- [Source: _bmad-output/planning-artifacts/architecture.md#D5 Riverpod Provider Structure]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: _bmad-output/implementation-artifacts/1-3a-keycloak-login-via-system-browser.md#Story Dependencies]

### Party Mode Review (Story Creation)

Reviewed by Winston (Architect), Sally (UX Designer), Amelia (Dev). Consensus on all points:

| Contribution | Agent | Decision |
|---|---|---|
| MainScreen user map — pass minimal placeholder, document downstream null safety | Winston | ✅ Integrated into Task 2.8 |
| Consumer widget placement — ConsumerStatefulWidget for MyApp (keeps _isConfigLoaded) | Winston | ✅ Integrated into Task 2.4 |
| /login named route → OidcLoginScreen | Winston | ✅ Integrated into Task 2.7 |
| Loading state during init — NOT needed (single-frame transition) | Sally | ✅ Integrated into Auto-Login section |
| Logo path via ThemeManager (not hardcoded) | Sally | ✅ Integrated into Task 1.2 |
| Retry button 48x48dp touch target | Sally | ✅ Integrated into Task 1.8 |
| ConsumerWidget (not ConsumerStatefulWidget) for OidcLoginScreen | Amelia | ✅ Integrated into Task 1.1 |
| onLogout placeholder with deferral comment | Amelia | ✅ Integrated into Task 2.9 |

## Technical Requirements

### Flutter/Dart Stack

- **Flutter 3.10+**, Dart (existing project constraint)
- **flutter_riverpod ^3.0.0** — `ConsumerWidget`, `ref.watch()`, `ref.read()` for auth state consumption
- **Material Design 3** — use `ThemeManager` for all colors, never hardcode color values
- **ThemeManager** — existing theme system at `lib/utils/theme_manager.dart`, provides `lightTheme`, `darkTheme`, `getColors()`

### Auth Service Integration

- `authProvider` — `NotifierProvider<AuthNotifier, AuthState>` from `lib/services/auth/auth_providers.dart`
- `AuthState` — three states: `authenticated`, `unauthenticated`, `error` with `retryable` flag
- `AuthNotifier.authorize()` — triggers OIDC flow via system browser (flutter_appauth)
- No new auth service code needed — this story is purely UI + routing integration

### Key Constraints

- **No `BuildContext` inside `AuthNotifier`** — all auth logic is in the service layer, UI only consumes state
- **No tokens in `debugPrint`** — FR25/NFR9. If logging auth events, use error codes only, never token values
- **No legacy LoginScreen modification** — create a parallel OidcLoginScreen
- **`_isConfigLoaded` pattern must be preserved** — the config loading spinner in MyApp is the app's initial loading indicator

## Architecture Compliance

| Architecture Decision | Compliance |
|---|---|
| D1: Three-state auth machine | ✅ UI maps all 3 states to distinct UI behaviors |
| D5: Riverpod provider structure | ✅ Consumes `authProvider` via `ref.watch()`, no direct service access from UI |
| Component boundaries: no auth code in UI | ✅ UI calls `ref.read(authProvider.notifier).authorize()`, no TokenStorage/KeycloakService access |
| Pattern: `ConsumerWidget` for stateless auth consumers | ✅ OidcLoginScreen is a ConsumerWidget |
| Naming: `snake_case.dart` files | ✅ `oidc_login_screen.dart` |
| Naming: `PascalCase` classes | ✅ `OidcLoginScreen` |
| Error handling: all errors as state | ✅ Error UI reads `AuthState.error`, no try/catch in widgets |

## File Structure Requirements

```
lib/
├── components/
│   └── auth/
│       ├── oidc_login_screen.dart     # NEW — ConsumerWidget, ref.watch(authProvider)
│       ├── login_screen.dart          # UNTOUCHED — legacy, deleted in Epic 6
│       ├── register_screen.dart       # UNTOUCHED
│       └── ...
├── main.dart                          # MODIFIED — ConsumerStatefulWidget, ref.watch routing
└── services/auth/                     # UNTOUCHED — complete from Stories 1.1–1.3a
```

## Testing Requirements

**No new unit tests required** — this story is purely UI + routing. Widget tests are deferred to Epic 6 (Story 6.5).

**Existing test suite must pass:**
- `flutter test` — all 54 tests pass
- `flutter analyze` — no new issues

**Manual verification (AC5, AC7):**
1. Build with dev flavor: `flutter build apk --flavor dev`
2. Cold launch with no tokens → login screen appears
3. Cold launch with valid tokens → MainScreen appears (auto-skip)
4. Tap "Sign in" → system browser opens Keycloak login
5. No tokens or credentials in logcat output

## Previous Story Intelligence

### Story 1.3b: Deep Link Handler (last completed story)

- **Platform config done:** Android `build.gradle` has product flavors with `appAuthRedirectScheme`, iOS `Info.plist` has `CFBundleURLTypes`
- **OIDC callback works end-to-end:** `flutter_appauth` intercepts the callback via native AppAuth SDKs — no manual deep link handling needed
- **Build command:** `flutter build apk --flavor dev` produces `app-dev-debug.apk`
- **Code review feedback to apply:** `const` constructors for data classes, `ref.mounted` checks after async gaps, narrow exception catches
- **54 tests pass** — no regressions in any previous story

### Stories 1.1–1.3a: Auth Infrastructure

- `TokenStorage` (abstract + Secure + InMemory) — 11 tests
- `AuthState` + `AuthStatus` — 11 tests
- `KeycloakConfig` + `getConfig()` — 10 tests (updated in 1.3a with `realm` field)
- `KeycloakService` — 8 tests (OIDC discovery + caching)
- `AuthNotifier` — 11 tests (authorize, refresh, validate, cancellation, error handling)
- `AppAuth` abstraction + `FlutterAppAuthAdapter` — enables test mocking without mockito
- Riverpod providers wired in `auth_providers.dart`
- `ProviderScope` wraps `MyApp()` in `main.dart`

### Code Patterns Established

```dart
// ConsumerWidget pattern for UI consuming auth state
class OidcLoginScreen extends ConsumerWidget {
  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final authState = ref.watch(authProvider);
    // switch on authState.status ...
  }
}

// Triggering auth actions
ref.read(authProvider.notifier).authorize();

// ref.mounted checks after async gaps
await someAsyncOperation();
if (!ref.mounted) return;
```

## Git Intelligence

Recent commits on this branch (all OIDC-related):

| Commit | Story | Key Files |
|---|---|---|
| `996d036c` | 1.3a | `auth_notifier.dart`, `auth_providers.dart`, `keycloak_service.dart`, `app_auth.dart` |
| `d9e98d47` | 1.2 | `auth_state.dart`, `keycloak_config.dart`, flavor configs |
| `1d28d9e8` | 1.1 | `token_storage.dart` |

**Patterns observed:**
- Each story adds new files in `lib/services/` and corresponding tests in `test/`
- `main.dart` modified incrementally (ProviderScope in 1.3a, routing in 1.4)
- Commit messages follow `feat(mobile-oidc):` conventional format
- No files deleted in previous stories (deletions deferred to Epic 6)

## Project Context Reference

- **Project context:** `_bmad-output/project-context.md` — Flutter 3.10+, Dart, no Composition API (web only)
- **Architecture:** `_bmad-output/planning-artifacts/architecture.md` — D1–D6 decisions, implementation patterns
- **Epics:** `_bmad-output/planning-artifacts/epics.md` — Story 1.4 full requirements and BDD acceptance criteria
- **PRD:** `_bmad-output/planning-artifacts/prd.md` — FR1-FR31, NFR1-NFR10

## Dev Agent Record

### Agent Model Used

glm-5-turbo

### Debug Log References

### Completion Notes List

- Created `OidcLoginScreen` as a `ConsumerWidget` that watches `authProvider` and renders branding (logo via `GenieAiConfig`, app title) + Sign in button
- Converted `MyApp` from `StatefulWidget` to `ConsumerStatefulWidget`, replaced `_user` state with `ref.watch(authProvider)` routing
- Removed legacy `_user`, `_handleLogin`, `_handleLogout` from MyApp; added `_onLogoutPlaceholder` with deferral comment for Epic 2
- All three auth states handled: `unauthenticated` → Sign in button, `authenticated` → checkmark placeholder (main.dart routes to MainScreen), `error` → error message + Retry/Sign in button
- Accessibility: `Semantics` wrappers on root ("Login screen"), Sign in button ("Sign in with your institution account"), error message ("Authentication error: ..."), Retry button ("Retry sign in")
- Error colors use `Theme.of(context).colorScheme.error` (Material 3), not raw color literals
- Fixed pre-existing `withOpacity` deprecations in `_BinderTab` widget
- All 54 existing tests pass, no new analyze issues in modified files

### File List

- `mobile/genie_ai_mobile/lib/components/auth/oidc_login_screen.dart` — NEW
- `mobile/genie_ai_mobile/lib/main.dart` — MODIFIED

### Change Log

- 2026-04-24: Implemented Story 1.4 — OidcLoginScreen widget, main.dart routing migration to Riverpod auth state
- 2026-04-24: Code review (AI) — 3 fixes applied: GenieAiConfig.load() now called in app init (H1), dead authenticated branch removed (M2), UserProfileScreen receives auth data (M4). 2 known limitations documented as TODO for Epic 2: empty accessToken, no loading state. flutter analyze clean, 54/54 tests pass. Status: done.
