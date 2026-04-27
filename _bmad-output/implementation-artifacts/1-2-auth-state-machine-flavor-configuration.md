# Story 1.2: Auth State Machine & Flavor Configuration

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a mobile app,
I want a reactive auth state machine and build-time flavor configuration,
So that the app can represent authentication status and connect to the correct Keycloak instance per environment.

## Acceptance Criteria

1. **AC1 - AuthStatus enum with exactly three states:** `AuthStatus` enum is defined with values `authenticated`, `unauthenticated`, and `error`. No `initial` state exists. No `retryCount` field exists.

2. **AC2 - AuthState class with required fields:** `AuthState` class contains `status` (AuthStatus), `userId` (String?), `displayName` (String?), `errorMessage` (String?), and `retryable` (bool).

3. **AC3 - getConfig() returns dev config:** When `FLAVOR` is `dev` (default), `getConfig()` returns the dev config with dev Keycloak URL, dev client ID, dev backend URL, and dev redirect scheme.

4. **AC4 - getConfig() returns ITU config:** When `FLAVOR` is `itu`, `getConfig()` returns the ITU production flavor config with production values.

5. **AC5 - getConfig() returns staging config:** When `FLAVOR` is `staging`, `getConfig()` returns the staging config with staging values.

6. **AC6 - getConfig() returns e2e config:** When `FLAVOR` is `e2e`, `getConfig()` returns the e2e test config with e2e test values.

7. **AC7 - FLAVOR via --dart-define:** `FLAVOR` is set via `--dart-define=FLAVOR=<name>`. `String.fromEnvironment` resolves at compile time and unused flavor configs are tree-shaken.

8. **AC8 - AuthState equality:** Two `AuthState` instances with identical fields are equal (implement `==` and `hashCode`).

9. **AC9 - Error state with retryable: true:** An `AuthState` with `status: AuthStatus.error` and `retryable: true` allows the UI to display a retry button (network error scenario).

10. **AC10 - Error state with retryable: false:** An `AuthState` with `status: AuthStatus.error` and `retryable: false` allows the UI to display a login button (invalid_grant scenario).

## Tasks / Subtasks

- [x] Task 1: Create AuthStatus enum and AuthState class (AC: #1, #2, #8, #9, #10)
  - [x] 1.1: Create `lib/services/auth/auth_state.dart`
  - [x] 1.2: Define `AuthStatus` enum with 3 values: `authenticated`, `unauthenticated`, `error`
  - [x] 1.3: Define `AuthState` class with `status`, `userId`, `displayName`, `errorMessage`, `retryable` (all `final`)
  - [x] 1.4: Add `const` constructor for tree-shaking and immutability
  - [x] 1.5: Implement `==` and `hashCode` on AuthState (value equality)
  - [x] 1.6: Add convenience constructors: `AuthState.authenticated()`, `AuthState.unauthenticated()`, `AuthState.error()`
- [x] Task 2: Create flavor configuration system (AC: #3, #4, #5, #6, #7)
  - [x] 2.1: Create `lib/config/` directory
  - [x] 2.2: Create `lib/config/keycloak_config.dart` with `KeycloakConfig` data class + `getConfig()`
  - [x] 2.3: Create `lib/config/dev_config.dart` with dev `KeycloakConfig` constants
  - [x] 2.4: Create `lib/config/staging_config.dart` with staging `KeycloakConfig` constants
  - [x] 2.5: Create `lib/config/e2e_config.dart` with e2e test `KeycloakConfig` constants
  - [x] 2.6: Create `lib/config/flavors/` directory
  - [x] 2.7: Create `lib/config/flavors/itu.dart` with ITU production `KeycloakConfig` constants
  - [x] 2.8: Implement `getConfig()` using `String.fromEnvironment('FLAVOR', defaultValue: 'dev')` switch
  - [x] 2.9: Ensure all flavor configs use `const` constructors for compile-time tree-shaking
- [x] Task 3: Write unit tests (AC: #1, #2, #8, #9, #10, #3-#7)
  - [x] 3.1: Create `test/services/auth/auth_state_test.dart`
  - [x] 3.2: Test `AuthStatus` has exactly 3 values
  - [x] 3.3: Test `AuthState` equality (identical fields → equal, different fields → not equal)
  - [x] 3.4: Test `AuthState` with error + retryable: true
  - [x] 3.5: Test `AuthState` with error + retryable: false
  - [x] 3.6: Test `AuthState.unauthenticated()` convenience constructor returns correct default state
  - [x] 3.7: Test `AuthState.authenticated()` convenience constructor with userId and displayName
  - [x] 3.8: Create `test/config/` directory
  - [x] 3.9: Create `test/config/keycloak_config_test.dart`
  - [x] 3.10: Test `devConfig` constant has expected field values (getConfig() uses compile-time `String.fromEnvironment`, not unit-testable)
  - [x] 3.11: Test `KeycloakConfig` fields are populated correctly
  - [x] 3.12: Run `flutter test` — all pass

## Dev Notes

### Architecture Context

This story establishes the **auth state model** and **flavor configuration system** — two foundational pillars used by every subsequent story. Story 1.3a (AuthNotifier + Riverpod providers) depends directly on both `AuthState` and `KeycloakConfig`. The flavor system is referenced by `AuthNotifier`, `KeycloakService`, and `ApiService`.

**Auth state machine (D1 from architecture.md):**
- Three-state model: `authenticated`, `unauthenticated`, `error`
- No `initial` state — app starts `unauthenticated`, flips to `authenticated` when tokens are validated
- No `retryCount` — retryable/non-retryable is a property of the error, not a counter
- `AuthState` is immutable — state transitions create new instances via convenience constructors or direct construction (no `copyWith()` — YAGNI, nullable field ambiguity)
- Value equality via `==` / `hashCode` enables Riverpod's built-in optimization (skips rebuilds when state hasn't changed)

**Flavor config (D6 from architecture.md):**
- `String.fromEnvironment` is a **compile-time constant** — unused flavor configs are tree-shaken by the Dart compiler
- Dev/staging/e2e are environment-level configs at `config/` root
- Deployment flavors (e.g., `itu`) live in `config/flavors/`
- All config values are `const` — no runtime cost, no reflection, no code generation
- The `getConfig()` function is the single entry point for all config access

### File Structure

```
lib/
├── config/                          # NEW directory
│   ├── keycloak_config.dart         # NEW — KeycloakConfig data class + getConfig()
│   ├── dev_config.dart              # NEW — dev environment constants
│   ├── staging_config.dart          # NEW — staging environment constants
│   ├── e2e_config.dart              # NEW — e2e test environment constants
│   └── flavors/
│       └── itu.dart                 # NEW — ITU production deployment flavor
├── services/
│   └── auth/
│       ├── token_storage.dart       # EXISTS (Story 1.1)
│       └── auth_state.dart          # NEW — AuthStatus enum + AuthState class

test/
├── config/                          # NEW directory
│   └── keycloak_config_test.dart    # NEW — unit tests for getConfig()
└── services/
    └── auth/
        ├── token_storage_test.dart  # EXISTS (Story 1.1)
        └── auth_state_test.dart     # NEW — unit tests for AuthState
```

### Code Patterns to Follow

**AuthStatus enum** (from architecture.md D1):

```dart
enum AuthStatus { authenticated, unauthenticated, error }
```

**AuthState class** (from architecture.md D1):

```dart
class AuthState {
  final AuthStatus status;
  final String? userId;
  final String? displayName;
  final String? errorMessage;
  final bool retryable;

  const AuthState({
    this.status = AuthStatus.unauthenticated,
    this.userId,
    this.displayName,
    this.errorMessage,
    this.retryable = false,
  });

  // Value equality — enables Riverpod skip optimization
  @override
  bool operator ==(Object other) =>
      identical(this, other) ||
      other is AuthState &&
          runtimeType == other.runtimeType &&
          status == other.status &&
          userId == other.userId &&
          displayName == other.displayName &&
          errorMessage == other.errorMessage &&
          retryable == other.retryable;

  @override
  int get hashCode => Object.hash(status, userId, displayName, errorMessage, retryable);

  // Convenience constructors for common states
  const AuthState.authenticated({String? userId, String? displayName})
      : status = AuthStatus.authenticated,
        userId = userId,
        displayName = displayName,
        errorMessage = null,
        retryable = false;

  const AuthState.unauthenticated()
      : status = AuthStatus.unauthenticated,
        userId = null,
        displayName = null,
        errorMessage = null,
        retryable = false;

  const AuthState.error({required String message, this.retryable = false})
      : status = AuthStatus.error,
        userId = null,
        displayName = null,
        errorMessage = message;
}
```

**KeycloakConfig data class** (from architecture.md D6):

```dart
class KeycloakConfig {
  final String keycloakUrl;
  final String clientId;
  final String redirectScheme;
  final String backendUrl;

  const KeycloakConfig({
    required this.keycloakUrl,
    required this.clientId,
    required this.redirectScheme,
    required this.backendUrl,
  });
}
```

**getConfig() function** (from architecture.md D6):

```dart
// keycloak_config.dart
import 'dev_config.dart';
import 'staging_config.dart';
import 'e2e_config.dart';
import 'flavors/itu.dart' as flavors;

KeycloakConfig getConfig() {
  const flavor = String.fromEnvironment('FLAVOR', defaultValue: 'dev');
  switch (flavor) {
    case 'itu':
      return flavors.config;
    case 'staging':
      return stagingConfig;
    case 'e2e':
      return e2eConfig;
    default:
      return devConfig;
  }
}
```

**Example flavor config** (dev_config.dart):

```dart
const devConfig = KeycloakConfig(
  keycloakUrl: 'http://localhost:8080',
  clientId: 'genie-mobile-dev',
  redirectScheme: 'com.itu.genieai.dev',
  backendUrl: 'http://localhost:3000',
);
```

### Flavor Configuration Values

| Flavor | Keycloak URL | Client ID | Redirect Scheme | Backend URL |
|--------|-------------|-----------|-----------------|-------------|
| dev (default) | `http://localhost:8080` | `genie-mobile-dev` | `com.itu.genieai.dev` | `http://localhost:3000` |
| staging | `https://staging-keycloak.example.com` | `genie-mobile-staging` | `com.itu.genieai.staging` | `https://staging-api.example.com` |
| e2e | `http://localhost:8080` | `genie-mobile-e2e` | `com.itu.genieai.e2e` | `http://localhost:3000` |
| itu (flavor) | Production Keycloak URL | `genie-mobile-itu` | `com.itu.genieai` | Production backend URL |

**Important:** The ITU production flavor should use placeholder URLs (e.g., `https://keycloak.itu.int`) since real production values are deployment-specific. The deployment guide (Story 4.4) documents how operators fill these in.

### Previous Story Intelligence (Story 1.1)

**What was built:**
- `lib/services/auth/token_storage.dart` — abstract `TokenStorage` + `SecureTokenStorage` + `InMemoryTokenStorage`
- `test/services/auth/token_storage_test.dart` — 11 unit tests, all pass
- 4 dependencies added to `pubspec.yaml`: `flutter_secure_storage ^8.1.0`, `flutter_appauth ^11.0.0`, `flutter_riverpod ^3.0.0`, `app_links ^6.3.3`

**Code review feedback from Story 1.1 to apply:**
- Narrow exception catches to specific types (e.g., `FormatException` for JSON parse errors, not broad `Exception`)
- Document the scope of `deleteAll()` clearly — it only removes the `auth_tokens` key
- `const` constructors preferred for data classes — enables tree-shaking and compile-time optimization

**Patterns established by Story 1.1:**
- All tokens stored as single JSON blob under key `auth_tokens`
- `expiresIn` stored as absolute `DateTime` (ISO 8601 string)
- Silent error handling: `.catchError((_) {})` for keystore operations
- One class per file (except abstract class + implementations)
- Test directory mirrors lib structure: `test/services/auth/` mirrors `lib/services/auth/`

### Critical Implementation Rules

- **AuthState must be immutable** — all fields `final`, `const` constructor. State transitions create new instances.
- **No `initial` state** — app starts `unauthenticated` (default constructor value).
- **No `retryCount`** — retryable/non-retryable is a boolean property of the error state.
- **`String.fromEnvironment` is compile-time only** — cannot be tested with runtime values. Tests verify `KeycloakConfig` data class directly; `getConfig()` is only testable per-flavor in integration builds.
- **All flavor configs use `const`** — enables tree-shaking of unused flavors.
- **No code generation** — no `flavorizr`, no `build_runner`, no `json_serializable`.
- **No runtime URL construction from user input** — all config values come from compile-time constants.
- **No `copyWith()` on AuthState** — state transitions use convenience constructors (`AuthState.authenticated()`, `AuthState.unauthenticated()`, `AuthState.error()`) or direct construction. `copyWith()` with nullable fields is ambiguous (`null` = clear vs. keep) and no transition needs it.

### Testing Requirements

**AuthState tests** (`test/services/auth/auth_state_test.dart`):
- `AuthStatus` has exactly 3 values (authenticated, unauthenticated, error)
- Two `AuthState` instances with identical fields are equal
- Two `AuthState` instances with different fields are not equal
- `AuthState.error(message: 'Network unreachable', retryable: true)` has correct fields
- `AuthState.error(message: 'Session expired', retryable: false)` has correct fields
- Default `AuthState()` is `unauthenticated` with no optional fields set
- `AuthState.unauthenticated()` convenience constructor returns correct default state
- `AuthState.authenticated(userId: 'user1', displayName: 'Test User')` sets fields correctly

**KeycloakConfig tests** (`test/config/keycloak_config_test.dart`):
- `KeycloakConfig` holds all 4 fields correctly
- `devConfig` constant is accessible and has expected field structure
- `stagingConfig` constant is accessible and has expected field structure
- `e2eConfig` constant is accessible and has expected field structure
- `flavors.config` constant is accessible and has expected field structure
- Note: `getConfig()` with `String.fromEnvironment` cannot be unit-tested (compile-time constant) — verify via integration or manual build test. Unit tests cover the data classes and constants directly.

### Project Structure Notes

- `lib/config/` is a new top-level directory under `lib/` — follows Flutter convention for build-time configuration
- `lib/config/flavors/` subdirectory separates deployment flavors from environment configs
- `lib/services/auth/` already has `token_storage.dart` from Story 1.1 — `auth_state.dart` is a new addition
- `test/config/` mirrors `lib/config/` — new test directory
- No conflicts with existing code — this is purely additive

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#D1 Auth State Machine]
- [Source: _bmad-output/planning-artifacts/architecture.md#D5 Riverpod Provider Structure]
- [Source: _bmad-output/planning-artifacts/architecture.md#D6 AppLifecycle + Deep Link + Flavor Strategy]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.2: Auth State Machine & Flavor Configuration]
- [Source: _bmad-output/planning-artifacts/prd.md#FR17, FR18]
- [Source: _bmad-output/implementation-artifacts/1-1-secure-token-storage-foundation.md#Completion Notes]
- [Source: _bmad-output/project-context.md#Mobile section]

## Dev Agent Record

### Agent Model Used

glm-5-turbo

### Debug Log References

### Completion Notes List

- Task 1: Created AuthStatus enum (3 values: authenticated, unauthenticated, error) and AuthState immutable class with value equality, const constructors, and convenience constructors. 11 unit tests passing.
- Task 2: Created flavor configuration system with KeycloakConfig data class, getConfig() using String.fromEnvironment, and 4 flavor configs (dev, staging, e2e, itu). All const for tree-shaking. 10 unit tests passing.
- Task 3: All 21 new unit tests passing, 34 total tests passing (0 regressions). Dart analyzer reports no issues.

### File List

- `mobile/genie_ai_mobile/lib/services/auth/auth_state.dart` (new)
- `mobile/genie_ai_mobile/lib/config/keycloak_config.dart` (new, modified by review)
- `mobile/genie_ai_mobile/lib/config/dev_config.dart` (new)
- `mobile/genie_ai_mobile/lib/config/staging_config.dart` (new)
- `mobile/genie_ai_mobile/lib/config/e2e_config.dart` (new)
- `mobile/genie_ai_mobile/lib/config/flavors/itu.dart` (new)
- `mobile/genie_ai_mobile/test/services/auth/auth_state_test.dart` (new)
- `mobile/genie_ai_mobile/test/config/keycloak_config_test.dart` (new, modified by review)

### Senior Developer Review (AI)

**Reviewer:** Jerome (via glm-5.1) on 2026-04-23
**Outcome:** Approved with fixes applied

**Issues Found:** 0 Critical, 0 High, 2 Medium, 3 Low
**Issues Fixed:** 5

| # | Severity | Description | Resolution |
|---|----------|-------------|------------|
| M1 | Medium | Config tests used `contains()` — weak assertions that could pass with incorrect values | Replaced with `equals()` exact value matching |
| M2 | Medium | Task 3.10 description claimed testing `getConfig()` which can't be unit-tested | Updated task description to match reality |
| L1 | Low | `KeycloakConfig` lacked value equality (`==`/`hashCode`) — inconsistent with `AuthState` pattern | Added `==` and `hashCode` to `KeycloakConfig` |
| L2 | Low | No `toString()` on `AuthState` — poor debuggability | Added `toString()` override |
| L3 | Low | Silent dev fallback on unknown `FLAVOR` — could mask config errors in builds | Changed to `ArgumentError` on unknown flavor, explicit `case 'dev'` in switch |

**Post-review verification:** 34/34 tests pass, `dart analyze` reports no issues.
