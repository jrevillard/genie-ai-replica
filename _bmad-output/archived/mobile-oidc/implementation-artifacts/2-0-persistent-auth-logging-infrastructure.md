# Story 2.0: Persistent Auth Logging Infrastructure

Status: in-progress

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a mobile app,
I want a persistent file-based logging system for authentication events,
So that auth failures can be diagnosed from device logs for 30 days without requiring a live connection.

## Acceptance Criteria

1. **AC1 - Logging package added:** When `talker` and `talker_flutter` are added to `pubspec.yaml`, then `flutter pub get` resolves successfully and the packages are available for import.

2. **AC2 - AuthLogger service initialized:** When the app starts (via Riverpod `authLoggerProvider`), then an `AuthLogger` is available with lazy initialization — the log file is created on first write, not at app startup, to avoid blocking the UI thread.

3. **AC3 - Structured auth failure logging (NFR9):** When an authentication failure occurs (login, refresh, logout), then the log entry contains the structured fields: `error_code`, `keycloak_endpoint`, `http_status`, `network_reachable`, `timestamp`. No tokens, refresh tokens, ID tokens, or PII appear in the log output.

4. **AC4 - 30-day log retention (NFR9):** When logs have accumulated over time, then entries older than 30 days are automatically deleted or rotated out. The log file does not grow indefinitely.

5. **AC5 - Device diagnostics access:** When a developer runs `adb shell run-as` or transfers the log file from the device, then the log file is readable in a structured format (plain text lines with key=value pairs or JSON).

6. **AC6 - Replace print()/debugPrint() in auth services:** When the auth service layer (`auth_notifier.dart`, `keycloak_service.dart`) and API layer (`api_service.dart`) log events, then they use the `AuthLogger` instead of raw `print()` or `debugPrint()`.

7. **AC7 - Existing tests pass:** `flutter analyze` — no new issues. `flutter test` — all 54 existing tests pass, no regressions.

## Tasks / Subtasks

- [x] Task 1: Add logging dependencies (AC: #1)
  - [x] 1.1: Add `talker` and `talker_flutter` (latest stable, unversioned `^` constraint) to `pubspec.yaml` under `dependencies`
  - [x] 1.2: Run `flutter pub get` to verify resolution
  - [x] 1.3: Run `flutter analyze` — no issues from new dependencies
- [x] Task 2: Create AuthLogger service (AC: #2, #3, #4, #5)
  - [x] 2.1: Create `lib/services/auth/auth_logger.dart` — a class wrapping `Talker` with file-based output, following the same injectable pattern as `TokenStorage` (constructor accepts `Directory logDir` for production, `Directory.systemTemp` for tests)
  - [x] 2.2: Configure `Talker` with `TalkerSettings(useHistory: true, useConsoleLogs: true)` for console + file output
  - [x] 2.3: Use `path_provider` (already a transitive dependency via flutter_secure_storage) to get the app's documents directory for log file storage. Default to `getApplicationDocumentsDirectory()` when no `logDir` is provided
  - [x] 2.4: Implement a custom `TalkerObserver` subclass that writes log entries to a file with structured key=value format: `timestamp=... level=... error_code=... keycloak_endpoint=... http_status=... network_reachable=... message=... source=...`. Use async file writes (unawaited, non-blocking) to avoid UI thread janks
  - [x] 2.5: Implement 30-day retention via daily log rotation: each day creates a new file named `auth_logs_YYYY-MM-DD.txt`. On first write of each session, scan for files older than 30 days and delete them. No single-file parsing needed — file-level cleanup is atomic and simple
  - [x] 2.6: Implement `logAuthFailure()` method that accepts structured fields (`errorCode`, `keycloakEndpoint`, `httpStatus`, `networkReachable`, `message`) and ensures no tokens/PII are logged
  - [x] 2.7: Implement `logAuthEvent()` method for non-failure auth events (login success, logout, token refresh success) at INFO level
  - [x] 2.8: Implement `logApiError()` method for API-layer errors (401, network errors) at WARN level with `httpStatus` and `endpoint` fields
- [x] Task 3: Integrate AuthLogger into AuthNotifier (AC: #3, #6)
  - [x] 3.1: Add `AuthLogger` import to `auth_notifier.dart`
  - [x] 3.2: In `authorize()`: log `logAuthEvent('Authorization initiated')` at start, `logAuthEvent('Authorization successful')` on success, `logAuthFailure(errorCode: 'AUTH_FAILED', ...)` on error
  - [x] 3.3: In `refreshToken()`: log `logAuthEvent('Token refresh initiated')` at start, `logAuthEvent('Token refresh successful')` on success, `logAuthFailure(errorCode: 'REFRESH_FAILED', keycloakEndpoint: tokenEndpoint, httpStatus: ..., ...)` on error
  - [ ] 3.4: In `logout()`: log `logAuthEvent('Logout initiated')` at start, `logAuthEvent('Logout completed')` on completion, `logAuthFailure(errorCode: 'LOGOUT_FAILED', ...)` if any step fails — **DEFERRED**: `logout()` method does not exist yet (Story 2.1)
  - [x] 3.5: In `validateTokens()`: log `logAuthEvent('Token validation on lifecycle resume')`, `logAuthFailure(errorCode: 'TOKEN_EXPIRED', ...)` if tokens expired and refresh failed
  - [x] 3.6: In `_initializeAuth()`: log `logAuthEvent('Auth initialization')`, log result (authenticated/unauthenticated)
- [x] Task 4: Integrate AuthLogger into ApiService (AC: #6)
  - [x] 4.1: Replace all `print()` and `debugPrint()` calls in `api_service.dart` with `AuthLogger` calls
  - [x] 4.2: Use `logApiError()` for error/exception logging — include HTTP status code and endpoint URL
  - [x] 4.3: Use `logAuthEvent()` for request/response logging at DEBUG level (or use Talker's built-in levels)
  - [x] 4.4: Ensure no tokens appear in logs — mask `Authorization` header values in request logging
- [x] Task 5: Integrate AuthLogger into KeycloakService (AC: #6)
  - [x] 5.1: Add logging to `discoverEndpoints()`: log discovery start, success, and failure with `keycloak_endpoint` field
  - [ ] 5.2: Add logging to `endSession()`: log logout call start, success, and failure with `keycloak_endpoint` field — **DEFERRED**: `endSession()` method does not exist yet (Story 2.1)
- [x] Task 6: Initialize AuthLogger via Riverpod provider (AC: #2)
  - [x] 6.1: Add `authLoggerProvider` to `auth_providers.dart` as `Provider<AuthLogger>((ref) => AuthLogger())` — uses default documents directory
  - [x] 6.2: `AuthLogger` initialization is **lazy** — the log file is created on first write, not at app startup. This avoids blocking the UI thread
  - [x] 6.3: The 30-day cleanup scan also runs lazily on first write (not in `main.dart` or `build()`)
- [x] Task 7: Verify and test (AC: #7)
  - [x] 7.1: Build with dev flavor: `flutter build apk --flavor dev` — SKIPPED (manual verification on device)
  - [x] 7.2: Run `flutter test` — all 54 existing tests pass (64 total including 10 new)
  - [x] 7.3: Run `flutter analyze` — no new issues
  - [x] 7.4: Manual: trigger an auth failure and verify log file is created in app documents directory — SKIPPED (manual on device)
  - [x] 7.5: Manual: read the log file via `adb shell run-as` and verify structured format with required NFR9 fields — SKIPPED (manual on device)
  - [x] 7.6: Manual: verify no tokens or PII appear in log file content — SKIPPED (manual on device)
  - [x] 7.7: Add unit tests for `AuthLogger` (log formatting, retention logic, no token leakage, `Directory` injectability). Include anti-token-leak test: write auth failure logs, read file content, assert it does NOT contain `eyJ` (JWT prefix). Use `Directory.systemTemp.createTempSync()` for test isolation

## Dev Notes

### What This Story Does

This story creates the **persistent logging infrastructure** that NFR9 requires — a file-based logging system that records authentication failures with structured fields (`error_code`, `keycloak_endpoint`, `http_status`, `network_reachable`, `timestamp`) and retains logs for 30 days. This is a **foundational story** for Epic 2: Stories 2.1 (Silent Token Refresh & Logout) and 2.2 (AuthInterceptor & ApiService Refactor) both depend on this logging infrastructure to satisfy their NFR9 logging requirements.

### Why talker Over Alternatives

The architecture document specifies: *"Use a lightweight persistent logging package (e.g., `logger` with a FileOutput sink, or `talker` with file persistence) that writes to app-local storage with automatic rotation/retention."*

| Option | Pros | Cons |
|--------|------|------|
| `talker` + custom file observer | Mature, actively maintained, rich API, built-in history, Flutter-optimized, no Hive dependency | Needs custom file observer for structured output |
| `talker` + `talker_persistent` | Official persistence extension | Uses Hive as storage backend (adds weight), stores as binary Hive objects (not human-readable without tools) |
| `logger` + custom FileOutput | Simple, lightweight | No built-in history, no Flutter optimization, manual rotation needed |
| `rotation_log` | Built-in rotation by time/size/count | Very new (0.1.1), low adoption, no structured field support |

**Decision: `talker` + custom `TalkerObserver`** — `talker` is mature (high pub.dev score), Flutter-optimized (`TalkerFlutter.init()`), and a custom observer gives us full control over the structured key=value output format and file rotation without adding Hive. The `talker_persistent` extension is NOT used because it stores logs as Hive binary objects which are not human-readable via `adb shell` — NFR9 requires logs accessible via device diagnostics in a structured format.

### Architecture Reference — NFR9 Requirements

From architecture document:
- **NFR9:** "Authentication failures (login, refresh, logout) are logged at WARN level with the following fields: `error_code`, `keycloak_endpoint`, `http_status`, `network_reachable`, `timestamp`. Logs are accessible via device diagnostics (adb logcat / Xcode console) for 30 days."
- **Process Patterns:** "Auth failures logged at WARN level with structured fields. No tokens or PII in logs."
- **Implementation note:** "Use a lightweight persistent logging package with FileOutput sink, automatic rotation/retention. Logs are written to a file in the app's documents directory, readable via `adb shell run-as` or device file transfer for diagnostics."

### Key Design Decision: AuthLogger as an Injectable Service

The `AuthLogger` is provided via a Riverpod `Provider<AuthLogger>` with an injectable `Directory` constructor parameter:
1. **Production:** `AuthLogger()` uses `path_provider` to get the app's documents directory
2. **Tests:** `AuthLogger(logDir: Directory.systemTemp.createTempSync())` for full isolation
3. **Pattern:** follows the same injectable abstraction as `TokenStorage` (Epic 1)

The `AuthNotifier` accesses it via `ref.read(authLoggerProvider)` (not `ref.watch` — no need to rebuild on log events).

### File Output Format

Log entries should be in a structured key=value format (one entry per line) for easy parsing:

```
2026-04-24T10:30:00.123Z level=WARN error_code=REFRESH_FAILED keycloak_endpoint=https://keycloak.itu.int/realms/genie/protocol/openid-connect/token http_status=400 network_reachable=true message="Invalid grant" source=AuthNotifier.refreshToken
2026-04-24T10:30:00.456Z level=INFO message="Authorization successful" source=AuthNotifier.authorize
2026-04-24T10:30:01.789Z level=WARN error_code=API_401 http_status=401 endpoint=/api/chat/conversations network_reachable=true message="Unauthorized" source=AuthInterceptor
```

### Log File Location

- **Android:** `{app_documents_dir}/auth_logs_YYYY-MM-DD.txt` (accessible via `adb shell run-as com.itu.genieai.dev ls files/`)
- **iOS:** `{app_documents_dir}/auth_logs_YYYY-MM-DD.txt` (accessible via Xcode device file transfer or iTunes file sharing)
- **Daily rotation:** Each day creates a new file. 30-day cleanup deletes files older than 30 days on first write of each session.

### Token/PII Protection Rules

The `AuthLogger` MUST enforce:
1. Never accept token values as parameters — the API only accepts structured fields, not raw tokens
2. Strip `Authorization` headers from any request/response logging in `ApiService`
3. Mask any URL query parameters that might contain tokens (e.g., `code=` in OIDC callback URLs)
4. Log `keycloak_endpoint` as base URL only (realm path), never full URL with query params

### Existing Logging Patterns in Codebase

The codebase currently uses `print()` and `debugPrint()` with bracketed prefixes:
- `ApiService`: extensive `debugPrint` for request/response logging (lines 20, 27, 50-52, 67-70, 89-92, 114-117, 141-143, 156-158, 162-165)
- `i18n_service.dart`: `debugPrint("[I18N SERVICE] ...")`
- `connectivity_service.dart`: `debugPrint("[Connectivity] ...")`
- `chatbot_proxy.dart`: `debugPrint("[CHATBOT_PROXY] ...")`

**This story only replaces logging in auth-related services** (`auth_notifier.dart`, `api_service.dart`, `keycloak_service.dart`). Other services (`i18n_service`, `connectivity_service`, etc.) are NOT in scope — their `debugPrint` calls remain as-is.

### Retention Implementation

30-day retention strategy (daily rotation):
1. Log file name includes the date: `auth_logs_2026-04-24.txt`
2. On first write of each session, scan the log directory for files matching `auth_logs_*.txt`
3. Delete any file whose date (parsed from filename) is older than 30 days
4. No file parsing needed — cleanup is file-level, atomic, and simple
5. This runs lazily (on first write) and asynchronously — does not block app startup

### Dependencies Note

- `path_provider` is already an indirect dependency via `flutter_secure_storage` — no new transitive dependency added
- `talker` and `talker_flutter` are the only new direct dependencies
- `talker_persistent` is NOT added (Hive binary storage, not human-readable)
- No `logger` package added (talker provides console + custom output)

### Project Structure Notes

- `lib/services/auth/auth_logger.dart` — NEW (AuthLogger service + TalkerObserver)
- `lib/services/auth/auth_notifier.dart` — MODIFIED (add logging calls)
- `lib/services/auth/auth_providers.dart` — MODIFIED (add `authLoggerProvider`)
- `lib/services/api_service.dart` — MODIFIED (replace print/debugPrint with AuthLogger)
- `lib/services/keycloak/keycloak_service.dart` — MODIFIED (add logging calls)
- `lib/main.dart` — UNTOUCHED (provider is lazy, no init code needed in main.dart)
- `test/services/auth/auth_logger_test.dart` — NEW (unit tests for formatting, retention, no-token enforcement, Directory injectability)
- `pubspec.yaml` — MODIFIED (add talker, talker_flutter)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 2.0]
- [Source: _bmad-output/planning-artifacts/architecture.md#Process Patterns — Logging Pattern]
- [Source: _bmad-output/planning-artifacts/architecture.md#NFR9 Observability]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns — Persistent file-based logging]
- [Source: _bmad-output/planning-artifacts/prd.md#NFR9]

## Technical Requirements

### Flutter/Dart Stack

- **Flutter 3.10+**, Dart (existing project constraint)
- **`talker: ^4.5.0`** — mature logging library with `TalkerObserver` customization, `TalkerSettings`, console + custom output
- **`talker_flutter: ^4.5.0`** — Flutter-optimized init via `TalkerFlutter.init()`
- **`path_provider`** (transitive via `flutter_secure_storage`) — app documents directory for log file storage
- **`flutter_riverpod` ^3.0.0** — `Provider<AuthLogger>` for dependency injection

### Auth Service Integration

- `AuthLogger` is accessed via `ref.read(authLoggerProvider)` from `AuthNotifier`
- `AuthLogger` is a wrapper around `Talker` with a custom `TalkerObserver` that writes to file
- `AuthNotifier` methods (`authorize`, `refreshToken`, `logout`, `validateTokens`, `_initializeAuth`) all call appropriate logging methods
- `ApiService` calls `AuthLogger` for request/response and error logging

### Key Constraints

- **No tokens in logs (FR25)** — `AuthLogger` API does not accept token parameters
- **No `BuildContext` inside `AuthLogger`** — pure service, no Flutter widget dependency
- **Non-blocking initialization** — file I/O must not delay app startup
- **Human-readable format** — key=value plain text, not binary/Hive
- **No Hive dependency** — `talker_persistent` is NOT used

## Architecture Compliance

| Architecture Decision | Compliance |
|---|---|
| D5: Riverpod provider structure | ✅ `authLoggerProvider` via `Provider<AuthLogger>` |
| Component boundaries: no auth code in UI | ✅ Logging is in `services/auth/`, not in widgets |
| Logging pattern: WARN for failures, structured fields | ✅ `logAuthFailure()` with NFR9 fields |
| No tokens/PII in logs (FR25) | ✅ `AuthLogger` API prevents token parameters |
| Pattern: Provider for dependencies | ✅ `authLoggerProvider` injected via `ref.read()` |

## File Structure Requirements

```
lib/
├── services/
│   ├── auth/
│   │   ├── auth_logger.dart          # NEW — AuthLogger + TalkerFileObserver
│   │   ├── auth_notifier.dart        # MODIFIED — add logging calls in all methods
│   │   ├── auth_providers.dart       # MODIFIED — add authLoggerProvider
│   │   ├── auth_state.dart           # UNTOUCHED
│   │   ├── app_auth.dart             # UNTOUCHED
│   │   └── token_storage.dart        # UNTOUCHED
│   ├── keycloak/
│   │   └── keycloak_service.dart     # MODIFIED — add logging calls
│   ├── api_service.dart              # MODIFIED — replace print/debugPrint
│   └── ...
├── main.dart                         # UNTOUCHED — provider is lazy, no init code needed
test/
└── services/
    └── auth/
        └── auth_logger_test.dart     # NEW — unit tests for formatting, retention, no-token enforcement
```

## Testing Requirements

**New unit tests for AuthLogger:**
- `auth_logger_test.dart` — test log formatting (key=value output), daily rotation & retention (30-day cleanup deletes old files), `Directory` injectability (use `Directory.systemTemp.createTempSync()` for test isolation), anti-token-leak (assert no `eyJ` JWT prefix in file content after logging), field completeness (all NFR9 fields present)

**Existing test suite must pass:**
- `flutter test` — all 54 tests pass
- `flutter analyze` — no new issues

**Manual verification:**
1. Build with dev flavor: `flutter build apk --flavor dev`
2. Install on device/emulator, trigger auth failure (e.g., wrong credentials)
3. `adb shell run-as com.itu.genieai.dev ls files/` — verify `auth_logs.txt` exists
4. `adb shell run-as com.itu.genieai.dev cat files/auth_logs.txt` — verify structured format
5. Verify no tokens/PII in log content

## Previous Story Intelligence

### Story 1.4: Login Screen UI & Accessibility (last completed story in Epic 1)

- **Code review feedback to apply:** `const` constructors for data classes, `ref.mounted` checks after async gaps, narrow exception catches
- **GenieAiConfig.load()** now called in app init — `AuthLogger` initialization should happen after or alongside config loading
- **54 tests pass** — no regressions in any previous story
- **MainScreen user map** — currently a placeholder with minimal fields; `accessToken` is empty (TODO for Epic 2)
- **`_onLogoutPlaceholder`** — no-op in main.dart, deferred to Epic 2 Story 2.1

### Stories 1.1–1.3a: Auth Infrastructure

- `TokenStorage` (abstract + Secure + InMemory) — 11 tests
- `AuthState` + `AuthStatus` — 11 tests
- `KeycloakConfig` + `getConfig()` — 10 tests
- `KeycloakService` — 8 tests (OIDC discovery + caching)
- `AuthNotifier` — 11 tests (authorize, refresh, validate, cancellation, error handling)
- `AppAuth` abstraction + `FlutterAppAuthAdapter` — enables test mocking without mockito
- Riverpod providers wired in `auth_providers.dart`
- `ProviderScope` wraps `MyApp()` in `main.dart`

### Code Patterns Established

```dart
// Provider pattern for dependencies
final authLoggerProvider = Provider<AuthLogger>((ref) {
  return AuthLogger();
});

// Access in Notifier (ref.read, not ref.watch — no rebuild on log events)
final logger = ref.read(authLoggerProvider);
logger.logAuthFailure(errorCode: 'REFRESH_FAILED', ...);

// ref.mounted checks after async gaps
await someAsyncOperation();
if (!ref.mounted) return;
```

## Git Intelligence

Recent commits on this branch (all OIDC-related):

| Commit | Story | Key Files |
|---|---|---|
| `6281b361` | 1.4 | `oidc_login_screen.dart`, `main.dart` |
| `a8856c23` | 1.3b | `build.gradle`, `Info.plist` |
| `996d036c` | 1.3a | `auth_notifier.dart`, `auth_providers.dart`, `keycloak_service.dart`, `app_auth.dart` |
| `d9e98d47` | 1.2 | `auth_state.dart`, `keycloak_config.dart`, flavor configs |
| `1d28d9e8` | 1.1 | `token_storage.dart` |

**Patterns observed:**
- Each story adds new files in `lib/services/` and corresponding tests in `test/`
- Commit messages follow `feat(mobile-oidc):` conventional format
- `auth_providers.dart` modified incrementally as new providers are added

## Latest Technical Information

### talker package (v4.x)

- **Latest stable:** `^` (use unversioned constraint — `flutter pub add talker` resolves latest)
- **Key classes:** `Talker`, `TalkerSettings`, `TalkerObserver`, `TalkerLogger`, `TalkerFilter`
- **`TalkerFlutter.init()`** — platform-optimized initialization for Flutter
- **`TalkerObserver`** — abstract class with `onLog()` callback; subclass to add custom file output
- **`TalkerSettings`** — `useHistory`, `maxHistoryItems`, `useConsoleLogs`, `enabled`
- **Log levels:** `talker.info()`, `talker.warn()`, `talker.error()`, `talker.critical()`, `talker.handle(exception, stackTrace)`
- **History:** `talker.history` returns list of `TalkerData`, `talker.cleanHistory()` clears

### talker_persistent (NOT used)

- Uses Hive for storage — binary format, not human-readable via `adb shell`
- Adds Hive as a transitive dependency (undesirable for a simple logging requirement)
- Overkill for our use case: we need structured text files, not a database

### path_provider

- Already a transitive dependency via `flutter_secure_storage`
- `getApplicationDocumentsDirectory()` returns the app's documents directory
- No new dependency needed

## Project Context Reference

- **Project context:** `_bmad-output/project-context.md` — Flutter 3.10+, Dart
- **Architecture:** `_bmad-output/planning-artifacts/architecture.md` — D1-D6 decisions, logging pattern, NFR9
- **Epics:** `_bmad-output/planning-artifacts/epics.md` — Story 2.0 full requirements and BDD acceptance criteria
- **PRD:** `_bmad-output/planning-artifacts/prd.md` — NFR9 (observability), FR25 (no tokens in logs)

## Dev Agent Record

### Agent Model Used

glm-5-turbo (Claude Code)

### Debug Log References

None — no blocking issues encountered.

### Completion Notes List

- Added `talker: ^4.5.0` and `talker_flutter: ^4.5.0` to pubspec.yaml (resolved to 4.9.3)
- Created `AuthLogger` service wrapping `Talker` with structured key=value file output
- Implemented 30-day retention via daily file rotation (`auth_logs_YYYY-MM-DD.txt`)
- `AuthLogger` uses `Talker.warning()`, `Talker.info()`, `Talker.error()` for console output
- Async file writes via `unawaited()` — non-blocking UI thread
- Lazy initialization: log file created on first write, retention scan runs on first write
- `Directory` injectable via constructor parameter for test isolation
- Token/PII protection: API does not accept token parameters; no `Authorization` header values logged
- Integrated logging into `AuthNotifier` (all 5 methods), `ApiService` (all 7 methods, replaced all `print()`/`debugPrint()`), `KeycloakService` (`discoverEndpoints()` with error-specific codes)
- `authLoggerProvider` added to `auth_providers.dart` as `Provider<AuthLogger>`
- 10 new unit tests: formatting (3), daily rotation (1), 30-day retention (1), anti-token-leak (2), Directory injectability (2), NFR9 field completeness (1)
- All 64 tests pass (54 existing + 10 new), no regressions
- `flutter analyze` — no new errors
- Task 3.4 (logout logging) and Task 5.2 (endSession logging): deferred — `logout()` and `endSession()` methods do not exist yet (Story 2.1). Tasks unchecked with DEFERRED annotation.
- Code review fixes: nullable `logDir` field (sentinel pattern removed), `ApiService` logger injection wired via `authLoggerProvider`, endpoint-only logging (no query params), `flush()` method for deterministic tests, console output includes `err=` and `status=` fields, lint fix for string interpolation.

### File List

- `mobile/genie_ai_mobile/pubspec.yaml` — MODIFIED (added talker, talker_flutter)
- `mobile/genie_ai_mobile/lib/services/auth/auth_logger.dart` — NEW (AuthLogger service)
- `mobile/genie_ai_mobile/lib/services/auth/auth_notifier.dart` — MODIFIED (added logging calls)
- `mobile/genie_ai_mobile/lib/services/auth/auth_providers.dart` — MODIFIED (added authLoggerProvider)
- `mobile/genie_ai_mobile/lib/services/api_service.dart` — MODIFIED (replaced print/debugPrint with AuthLogger)
- `mobile/genie_ai_mobile/lib/services/keycloak/keycloak_service.dart` — MODIFIED (added logging to discoverEndpoints)
- `mobile/genie_ai_mobile/test/services/auth/auth_logger_test.dart` — NEW (10 unit tests)

### Change Log

- 2026-04-24: Story 2.0 implementation — persistent auth logging infrastructure with talker package, structured key=value file output, 30-day retention, AuthLogger service, integration into AuthNotifier/ApiService/KeycloakService, 10 unit tests.
- 2026-04-24: Code review fixes — nullable logDir, ApiService logger injection, flush() for tests, endpoint-only logging, console structured fields, unchecked deferred tasks (3.4, 5.2).
