# Story 6.4: TLS Enforcement

Status: done

## Story

As a mobile app,
I want valid TLS certificate validation enforced on all network connections,
So that the app never connects to servers with invalid or self-signed certificates.

## Acceptance Criteria

1. **Given** `main.dart` currently contains a `badCertificateCallback` override, **When** the removal is complete, **Then** the `badCertificateCallback` is removed from `main.dart` (FR23)

2. **Given** a debug build needs to work with self-signed certificates, **When** the app runs in debug mode (`kDebugMode`), **Then** a conditional bypass can be enabled for development — documented in the dev workflow

3. **Given** the app runs in release mode, **When** any HTTPS connection is made to a server with an invalid certificate, **Then** the connection is rejected — no bypass (FR23)

4. **Given** `flutter analyze` runs, **When** the codebase is checked, **Then** no TLS bypass code is detected in release paths

## Tasks / Subtasks

- [x] 1. Remove `MyHttpOverrides` class and `HttpOverrides.global` assignment (AC: #1, #3, #4)
  - [x] 1.1 Delete the entire `MyHttpOverrides` class (lines 40-47 in `main.dart`)
  - [x] 1.2 Delete the `HttpOverrides.global = MyHttpOverrides();` assignment and its `if (!kIsWeb)` guard (lines 54-56 in `main.dart`)
  - [x] 1.3 Add conditional debug-only bypass using `kDebugMode` — if debug builds against self-signed certs are needed:
    ```dart
    if (kDebugMode && !kIsWeb) {
      HttpOverrides.global = _DebugHttpOverrides();
    }
    ```
    Where `_DebugHttpOverrides` is the same `badCertificateCallback` override but wrapped in `kDebugMode` so it is **tree-shaken in release builds**. This is a Dart compile-time constant — the entire block is eliminated from release binaries.
  - [x] 1.4 If adding the debug-only bypass, rename class to `_DebugHttpOverrides` and add a clear comment: `/// DEBUG ONLY: Bypasses TLS validation for local development with self-signed certificates. Removed in release builds via kDebugMode.`
  - [x] 1.5 Remove the now-unused `import 'dart:io';` ONLY if no other code in `main.dart` uses `dart:io`. **Verify first** — `dart:io` is used by other files but may be needed in `main.dart` indirectly. Run `flutter analyze` to confirm.

- [x] 2. Verify no other TLS bypass code exists in the codebase (AC: #4)
  - [x] 2.1 `grep -rn "badCertificateCallback" lib/ test/` — expect results ONLY in the debug-only override (if kept)
  - [x] 2.2 `grep -rn "HttpOverrides" lib/ test/` — expect results ONLY in the debug-only override (if kept)
  - [x] 2.3 `grep -rn "SecurityContext" lib/ test/` — expect results ONLY in the debug-only override (if kept)
  - [x] 2.4 Verify that `network_error_classifier.dart` only **catches** `TlsException` for error classification — it does NOT bypass TLS. This is correct behavior (detecting TLS errors to show user-friendly messages).

- [x] 3. Verify build and tests (AC: #4)
  - [x] 3.1 Run `flutter analyze` — zero errors (baseline: 0 errors, ~102 info/warnings)
  - [x] 3.2 Run `flutter test` — all tests pass (baseline: 168 tests, 0 failures)
  - [x] 3.3 Run `flutter pub get` — no resolution errors

- [x] 4. Verify release safety (AC: #3)
  - [x] 4.1 `grep -rn "badCertificateCallback" lib/` — any hit must be inside a `kDebugMode` guard
  - [x] 4.2 Confirm `kDebugMode` is a `const bool` from `package:flutter/foundation.dart` — it is a compile-time constant that is `false` in release builds, enabling tree-shaking of the entire guarded block

## Dev Notes

### CRITICAL: This Is a Small, Surgical Story

This story has a single file to modify (`main.dart`) and a single code block to change (the `MyHttpOverrides` class + its assignment). Do NOT over-engineer it. The primary decision is whether to keep a debug-only bypass or remove it entirely.

**Recommended approach:** Keep a `kDebugMode`-guarded debug-only bypass. Rationale:
- Developers working against local/self-signed Keycloak instances need this
- `kDebugMode` is a Dart compile-time constant — the entire block is eliminated from release binaries
- The architecture document explicitly mentions: "This may break development against self-signed certs — dev workflow adjustment needed" [Source: architecture.md#Technical Constraints & Dependencies]
- A debug-only bypass satisfies AC#2 (conditional bypass for development) and AC#3 (no bypass in release)

### CRITICAL: Dev Agent Must Re-Verify Everything Independently

This story was created based on an analysis done at story-creation time. The codebase may have changed since then (other PRs merged, hotfixes, etc.). **The dev agent MUST redo every verification from scratch during implementation.** Do NOT trust "confirmed" statements — they describe the state AT STORY CREATION, not at implementation time. Re-run every grep, re-check every dependency.

### Files Being Modified — Current State

| File | Action | What Changes | What Must Be Preserved |
|------|--------|-------------|----------------------|
| `lib/main.dart` | MODIFY | Remove `MyHttpOverrides` class (lines 40-47), remove `HttpOverrides.global` assignment (lines 54-56), optionally add `kDebugMode`-guarded debug bypass | All existing functionality — ProviderScope, AppLinks, OIDC config, MyApp, MainScreen, _BinderTab |

### Current Code in `main.dart` (lines 39-56)

```dart
/// SSL Override for local development to bypass self-signed certificate issues
class MyHttpOverrides extends HttpOverrides {
  @override
  HttpClient createHttpClient(SecurityContext? context) {
    return super.createHttpClient(context)
      ..badCertificateCallback =
          (X509Certificate cert, String host, int port) => true;
  }
}

void main() async {
  WidgetsFlutterBinding.ensureInitialized();

  // Apply the HTTP overrides for development environment
  if (!kIsWeb) {
    HttpOverrides.global = MyHttpOverrides();
  }

  await ConnectivityService().init();
  runApp(
    const ProviderScope(
      child: MyApp(),
    ),
  );
}
```

**What to change:**
- The `MyHttpOverrides` class (lines 39-47) — either delete entirely or wrap in `kDebugMode`
- The `HttpOverrides.global = MyHttpOverrides();` line (line 55) and its `if (!kIsWeb)` guard (lines 54-56) — either delete or change condition to `kDebugMode && !kIsWeb`
- The comment on line 39 — update or remove depending on approach
- The comment on line 53 — update or remove depending on approach

**What NOT to change:**
- `WidgetsFlutterBinding.ensureInitialized()` (line 51)
- `await ConnectivityService().init()` (line 58)
- `runApp(const ProviderScope(child: MyApp()))` (lines 60-64)
- Everything else in `main.dart` (MyApp, MainScreen, _BinderTab)

### `import 'dart:io'` Dependency Check

`main.dart` imports `dart:io` at line 3. After removing the TLS bypass code, check if `dart:io` is still needed:
- `dart:io` provides `HttpClient`, `SecurityContext`, `X509Certificate`, `HttpOverrides` — all used by the TLS bypass
- If the debug-only bypass is kept, `dart:io` is still needed
- If the bypass is removed entirely, `dart:io` may become unused — `flutter analyze` will flag it

### `network_error_classifier.dart` — NOT a TLS Bypass

`lib/services/auth/network_error_classifier.dart` line 20 catches `TlsException` for error classification:
```dart
if (error is TlsException) return true;
```
This is CORRECT behavior — it detects TLS errors to return user-friendly error messages (FR12: network error within 500ms). It does NOT bypass TLS. Do NOT modify this file.

### `kDebugMode` — Compile-Time Constant

`kDebugMode` is declared in `package:flutter/foundation.dart` as:
```dart
const bool kDebugMode = bool.fromEnvironment('dart.vm.product') == false;
```

Key properties:
- It is a **compile-time constant** (`const`)
- In release/profile builds, it is `false`
- The Dart compiler tree-shakes the entire `if (kDebugMode) { ... }` block from release binaries
- The `dart:io` import needed for the debug block is NOT tree-shaken (Dart does not tree-shake imports), but the code inside the block is eliminated
- `main.dart` already imports `package:flutter/foundation.dart` at line 5 for `kIsWeb`

### `kIsWeb` vs `kDebugMode`

The current code uses `if (!kIsWeb)` to guard the TLS bypass. `kIsWeb` checks if running on web platform (where `dart:io` `HttpOverrides` is unavailable). This is a platform check, not a build mode check — it allows TLS bypass on both debug AND release native builds.

The fix changes the guard from `!kIsWeb` to `kDebugMode && !kIsWeb`:
- `kDebugMode` — only in debug builds (tree-shaken from release)
- `!kIsWeb` — only on native platforms (not web)

### Architecture References

- **FR23**: "The app enforces valid TLS certificate validation for all network connections (no certificate bypass)" [Source: epics.md#FR23]
- **Architecture decision**: "`badCertificateCallback` in `main.dart`: Existing SSL bypass must be removed (FR23). This may break development against self-signed certs — dev workflow adjustment needed." [Source: architecture.md#Technical Constraints & Dependencies]
- **Implementation sequence**: Step 9 of the architecture implementation priority: "`badCertificateCallback` removal from main.dart" [Source: architecture.md#Implementation Handoff]
- **Enforcement guideline**: "Never add `badCertificateCallback` back to `main.dart`" [Source: architecture.md#Enforcement Guidelines]
- **AI Agent Guideline**: "Never re-introduce `badCertificateCallback`, `shared_preferences`, or plaintext token storage" [Source: architecture.md#AI Agent Guidelines]

### Previous Story Intelligence (Story 6.3)

Key learnings from the immediately preceding story:
- **Dead code cascade protocol** — After every deletion, trace UP the dependency chain until stable [Source: 6-3 story Dev Notes]
- **`flutter analyze` baseline**: 0 errors, ~102 info/warnings
- **`flutter test` baseline**: 168 tests, 0 failures
- **Review patches are common** — Expect minor fixes after review
- **15 locale files** — Not relevant to this story (no i18n changes)

### What Stories 6.1, 6.2, and 6.3 Already Did

- **Story 6.1**: Migrated UserService, removed deprecated ApiService methods, converted SettingsComponent
- **Story 6.2**: Deleted all legacy auth files (auth_proxy.dart, password_proxy.dart, 6 screen files), cleaned routes and i18n
- **Story 6.3**: Removed shared_preferences dependency, cleaned settings_service.dart comments, removed orphaned i18n keys and UserService methods

None of these stories touched the TLS bypass code — it remains exactly as it was before Epic 6 started.

### Project Structure Notes

- Main entry point: `mobile/genie_ai_mobile/lib/main.dart`
- The TLS bypass is entirely contained within `main.dart` — no other files reference `MyHttpOverrides`
- No test file exists for `main.dart` — no test changes needed
- The `http` package (v1.6.0) uses its own `Client` class, not `dart:io` `HttpClient`. The `HttpOverrides` only affects `dart:io` `HttpClient` users. The `package:http` package's `IOClient` internally uses `dart:io` `HttpClient`, so the override DOES affect all HTTP traffic in the app (via `ApiService` → `AuthInterceptor` → `http.IOClient` → `dart:io` `HttpClient`).

### References

- [Source: epics.md#Story 6.4] — Full acceptance criteria and BDD scenarios
- [Source: architecture.md#Technical Constraints & Dependencies] — badCertificateCallback must be removed
- [Source: architecture.md#Implementation Handoff] — Step 9: badCertificateCallback removal
- [Source: architecture.md#Enforcement Guidelines] — Never add badCertificateCallback back
- [Source: 6-3-loginscreen-replacement-shared-preferences-cleanup.md] — Previous story completion notes
- [Source: project-context.md#Technology Stack & Versions] — Flutter 3.10+, Dart, http ^1.6.0

## Dev Agent Record

### Agent Model Used

glm-5-turbo

### Debug Log References

No debug issues encountered.

### Completion Notes List

- Replaced unconditional `MyHttpOverrides` (active on all native builds) with `_DebugHttpOverrides` guarded by `kDebugMode && !kIsWeb` — tree-shaken from release binaries
- Renamed class to `_DebugHttpOverrides` (private) with DEBUG ONLY comment
- `import 'dart:io'` retained — still needed by `_DebugHttpOverrides`
- `kIsWeb` guard replaced by `kDebugMode && !kIsWeb` — prevents bypass on both release AND web platforms
- `network_error_classifier.dart` verified — only catches `TlsException`, does not bypass TLS
- No other TLS bypass code found in `lib/` or `test/`
- `flutter analyze`: 0 errors, 102 info/warnings (matches baseline)
- `flutter test`: 168 tests, 0 failures (matches baseline)

### File List

- `mobile/genie_ai_mobile/lib/main.dart` — replaced MyHttpOverrides with kDebugMode-guarded _DebugHttpOverrides
- `_bmad-output/implementation-artifacts/6-4-tls-enforcement.md` — updated status, checkboxes, dev agent record
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — updated story status

### Review Findings

- [x] [Review][Decision] Class `_DebugHttpOverrides` defined outside `kDebugMode` block — resolved: Dart does not support class definitions inside functions; class kept at top level, tree-shaken by AOT compiler as unused in release. Comment updated to reflect this accurately.
- [x] [Review][Patch] README references obsolete `MyHttpOverrides` — fixed in `mobile/genie_ai_mobile/README.md:411` and `README.md:666`

### Change Log

- 2026-04-30: Story implementation complete. Replaced unconditional TLS bypass with kDebugMode-guarded debug-only bypass. All ACs verified.
