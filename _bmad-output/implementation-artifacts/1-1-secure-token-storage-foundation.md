# Story 1.1: Secure Token Storage Foundation

Status: done

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a mobile app,
I want a secure token storage abstraction backed by the platform keystore,
so that authentication tokens are encrypted at rest and the auth stack is fully testable without platform dependencies.

## Acceptance Criteria

1. **AC1 - Dependencies added:** `flutter_secure_storage`, `flutter_appauth`, `flutter_riverpod`, and `app_links` are added to `pubspec.yaml` and all packages resolve successfully with `flutter pub get`. `shared_preferences` and `crypto` remain in `pubspec.yaml` (removed later in Epic 6).

2. **AC2 - SecureTokenStorage saves tokens as JSON blob:** `SecureTokenStorage.saveTokens()` called with accessToken, idToken, refreshToken, and expiresIn stores all values as a single JSON blob under one key (`auth_tokens`) in the platform keystore. `expiresIn` is stored as the calculated absolute expiration date (`DateTime.now().add(Duration(seconds: expiresIn))`).

3. **AC3 - SecureTokenStorage reads individual tokens:** `getAccessToken()`, `getIdToken()`, `getRefreshToken()`, and `getAccessTokenExpiration()` each return the corresponding value from the stored JSON blob.

4. **AC4 - deleteAll removes stored tokens:** `deleteAll()` removes the `auth_tokens` key from the platform keystore.

5. **AC5 - InMemoryTokenStorage mirrors SecureTokenStorage:** `InMemoryTokenStorage` provides identical behavior to `SecureTokenStorage` but without platform dependencies. All unit tests pass without requiring a device emulator.

6. **AC6 - deleteAll silently handles keystore failure:** If `deleteAll()` fails due to keystore unavailability, the error is caught and does not propagate.

## Tasks / Subtasks

- [x] Task 1: Add new dependencies to pubspec.yaml (AC: #1)
  - [x] 1.1: Add `flutter_secure_storage: ^8.1.0` to dependencies
  - [x] 1.2: Add `flutter_appauth: ^11.0.0` to dependencies
  - [x] 1.3: Add `flutter_riverpod: ^3.0.0` to dependencies
  - [x] 1.4: Add `app_links: ^6.3.3` to dependencies (replaces unmaintained `uni_links`)
  - [x] 1.5: Run `flutter pub get` and verify all packages resolve
  - [x] 1.6: Verify `shared_preferences` and `crypto` remain in pubspec.yaml (Epic 6 removal)
- [x] Task 2: Create `lib/services/auth/token_storage.dart` (AC: #2, #3, #4, #5, #6)
  - [x] 2.1: Create `lib/services/auth/` directory
  - [x] 2.2: Define abstract `TokenStorage` class with 5 methods: `getAccessToken()`, `getIdToken()`, `getRefreshToken()`, `getAccessTokenExpiration()`, `saveTokens(...)`, `deleteAll()`
  - [x] 2.3: Implement `SecureTokenStorage` using `flutter_secure_storage` — stores/reads all tokens as single JSON blob under key `auth_tokens`
  - [x] 2.4: Handle `expiresIn` conversion: store as absolute `DateTime` (ISO 8601 string), read back as `DateTime`
  - [x] 2.5: Implement `InMemoryTokenStorage` using a `Map<String, String>` — identical API, no platform deps
  - [x] 2.6: Wrap `deleteAll()` in try-catch in `SecureTokenStorage` — silently handle keystore unavailability
  - [x] 2.7: Handle JSON parse errors gracefully (corrupt storage → return null)
- [x] Task 3: Write unit tests for `TokenStorage` (AC: #5)
  - [x] 3.1: Create `test/services/auth/` directory
  - [x] 3.2: Create `test/services/auth/token_storage_test.dart`
  - [x] 3.3: Test `InMemoryTokenStorage`: save tokens, read each individually, verify values match
  - [x] 3.4: Test `InMemoryTokenStorage`: `getAccessTokenExpiration()` returns correct DateTime
  - [x] 3.5: Test `InMemoryTokenStorage`: `deleteAll()` clears all tokens, subsequent reads return null
  - [x] 3.6: Test `InMemoryTokenStorage`: save with expiresIn=3600, verify expiration is ~1 hour from now
  - [x] 3.7: Test `InMemoryTokenStorage`: calling getters before save returns null
  - [x] 3.8: Run `flutter test test/services/auth/token_storage_test.dart` — all pass

## Dev Notes

### Architecture Context

This story is the **foundation** for the entire mobile OIDC migration. Every subsequent auth component depends on `TokenStorage`. The abstract class pattern enables full testability — the entire auth stack can be unit-tested in CI without platform keystore access.

**Token passthrough architecture** — No GENIE.AI JWT issued. Mobile sends raw Keycloak access token as Bearer token. Backend validates via JWKS. Zero backend changes expected.

**Key architectural decisions from architecture.md:**

- **D2: TokenStorage Interface** — Five-method interface with `id_token` and `expires_in` stored. Constructor injection allows `SecureTokenStorage` (prod) and `InMemoryTokenStorage` (test).
- **Atomicity caveat:** `flutter_secure_storage` has no transactions. Mitigation: store all tokens as a single JSON blob under one key (`auth_tokens`) to achieve application-level atomicity.
- **No JWT parsing:** Token expiration tracked via `expiresIn` from `flutter_appauth` `TokenResponse`, stored as absolute `DateTime`. No JWT decoding needed.

### File Structure

```
lib/services/auth/
└── token_storage.dart        # NEW — abstract TokenStorage + SecureTokenStorage + InMemoryTokenStorage

test/services/auth/
└── token_storage_test.dart   # NEW — unit tests using InMemoryTokenStorage
```

### Code Patterns to Follow

**TokenStorage abstract class** (from architecture.md D2):

```dart
abstract class TokenStorage {
  Future<String?> getAccessToken();
  Future<String?> getIdToken();
  Future<String?> getRefreshToken();
  Future<DateTime?> getAccessTokenExpiration();
  Future<void> saveTokens({
    required String accessToken,
    required String idToken,
    required String refreshToken,
    required DateTime accessTokenExpiration,
  });
  Future<void> deleteAll();
}
```

**JSON blob storage format** (single key `auth_tokens`):

```json
{
  "access_token": "...",
  "id_token": "...",
  "refresh_token": "...",
  "access_token_expiration": "2026-04-23T15:30:00.000Z"
}
```

**Naming conventions** (from architecture.md):
- Files: `snake_case.dart`
- Classes: `PascalCase`
- Methods: `camelCase`
- Private members: `_camelCase` prefix
- Storage keys: `snake_case` matching OIDC convention

### Package Version Decisions

| Package | Version | Notes |
|---------|---------|-------|
| `flutter_secure_storage` | `^8.1.0` | Latest stable. v10.0.0 is beta — avoid for production. Uses EncryptedSharedPreferences on Android, Keychain on iOS. |
| `flutter_appauth` | `^11.0.0` | Latest stable. Built-in PKCE support. Requires Flutter 3.29+, Dart 3.7+. |
| `flutter_riverpod` | `^3.0.0` | Architecture uses `NotifierProvider` pattern (migrated from deprecated `StateNotifierProvider`). `Notifier.build()` replaces constructor injection with `ref.watch()`. `ref.onDispose()` replaces `dispose()` override. |
| `app_links` | `^6.3.3` | **Replaces `uni_links`** (unmaintained). `app_links` is the actively maintained successor with unified `uriLinkStream` API for cold start + incoming links. Architecture and epics already updated. |

### Critical Implementation Rules

- **One class per file** (except closely related types — abstract class + implementations stay in same file per architecture pattern)
- **No direct `flutter_secure_storage` access from business logic** — all token operations through `TokenStorage` abstraction
- **No JWT parsing** — expiration tracked via stored `DateTime`, not decoded JWT
- **No tokens in logs** — FR25/NFR9
- **JSON blob atomicity** — store all tokens under single key `auth_tokens` to avoid partial state
- **Silent error handling on `deleteAll()`** — per architecture: `.catchError((_) {})` pattern
- **Graceful JSON parse errors** — if stored JSON is corrupt, return null (treat as unauthenticated)

### Current Codebase State

- `lib/services/` exists with 18 proxy files following `*_proxy.dart` pattern
- `lib/services/auth/` does NOT exist — must be created
- `test/` directory exists but contains only example tests (`widget_test.dart`, `unit_test.dart`)
- `test/services/auth/` does NOT exist — must be created
- `pubspec.yaml` has: `http: ^1.6.0`, `shared_preferences: ^2.2.2`, `crypto: ^3.0.3`, `connectivity_plus: ^7.0.0`
- `api_service.dart` is a singleton with `setToken()`/`clearToken()` methods — will be refactored in Story 2.2
- `analysis_options.yaml` uses default Flutter linting

### Project Structure Notes

- The `lib/services/auth/` directory is a new addition to the existing service layer
- Follows the existing pattern of domain-organized services under `lib/services/`
- Test directory mirrors lib structure: `test/services/auth/` mirrors `lib/services/auth/`
- No conflicts with existing code — this is purely additive

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#D2 TokenStorage Interface]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.1: Secure Token Storage Foundation]
- [Source: _bmad-output/planning-artifacts/prd.md#FR9, FR25]
- [Source: _bmad-output/planning-artifacts/prd.md#NFR9]
- [Source: _bmad-output/project-context.md#Mobile section]

## Dev Agent Record

### Agent Model Used

glm-5-turbo

### Debug Log References

(none)

### Completion Notes List

- Added 4 new dependencies to pubspec.yaml: flutter_secure_storage ^8.1.0, flutter_appauth ^11.0.0, flutter_riverpod ^3.0.0, app_links ^6.3.3
- Created abstract TokenStorage class with 5 methods + saveTokens with DateTime parameter
- Implemented SecureTokenStorage using flutter_secure_storage with JSON blob under single key auth_tokens
- Implemented InMemoryTokenStorage using Map<String, String> for testability without platform deps
- deleteAll() in SecureTokenStorage silently catches keystore errors
- JSON parse errors return null (corrupt storage treated as unauthenticated)
- 11 unit tests covering all InMemoryTokenStorage behaviors — all pass
- Full test suite passes (13/13), no regressions

### File List

- mobile/genie_ai_mobile/pubspec.yaml (modified)
- mobile/genie_ai_mobile/lib/services/auth/token_storage.dart (new)
- mobile/genie_ai_mobile/test/services/auth/token_storage_test.dart (new)

## Change Log

- 2026-04-23: Story implemented — TokenStorage abstraction, SecureTokenStorage, InMemoryTokenStorage, 11 unit tests
- 2026-04-23: Code review — 2 fixes applied (M4: narrow _readBlob catch to FormatException; M3: clarify deleteAll scope), 3 pushbacks (M1: YAGNI multi-read; M2/M5: SecureTokenStorage tests deferred to Epic 6 integration per AC5), 2 invalid (L1: const impossible with mutable map; L2: Dart single-threaded)
