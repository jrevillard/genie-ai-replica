# Story 1.3a: Keycloak Login via System Browser

Status: done

## Story

As a user,
I want to sign in to the app using my institution's Keycloak credentials via the system browser,
So that I can authenticate securely without the app handling my password directly.

## Acceptance Criteria

1. **AC1 - OIDC endpoint discovery:** `KeycloakService.discoverEndpoints()` fetches OIDC endpoints (authorization, token, userinfo, end_session) from `{keycloakUrl}/.well-known/openid-configuration`. Discovered endpoints are cached for subsequent calls.

2. **AC2 - Discovery failure handling:** When `discoverEndpoints()` fails (network error, invalid URL), an `AuthState(status: AuthStatus.error, retryable: true, errorMessage: 'Network unreachable')` is emitted.

3. **AC3 - System browser login:** When the user taps "Sign in", `AuthNotifier.authorize()` opens the system browser (ASWebAuthenticationSession on iOS, Chrome Custom Tabs on Android) to the Keycloak authorization endpoint via `flutter_appauth`. PKCE code_verifier and code_challenge are generated automatically. The redirect URI matches the custom URL scheme from the flavor config.

4. **AC4 - Successful token exchange:** After the user authenticates in the system browser, `flutter_appauth` exchanges the authorization code for tokens at the token endpoint. The access token, ID token, and refresh token are saved via `TokenStorage.saveTokens()`. The `accessTokenExpirationDateTime` from `TokenResponse` is stored as the absolute expiration date. The auth state transitions to `AuthState(status: AuthStatus.authenticated)`. **Note:** `userId` and `displayName` population is deferred — no JWT parsing per architecture rules. The userinfo endpoint call will populate these in a future story.

5. **AC5 - SSO with active Keycloak session:** If the user already has an active Keycloak session in the browser, they are authenticated without re-entering credentials (FR3). This is handled automatically by the system browser — no app code needed.

6. **AC6 - User cancels login:** When `flutter_appauth` throws `FlutterAppAuthUserCancelledException` (v11 non-nullable API), the auth state transitions to `AuthState(status: AuthStatus.unauthenticated)` — no error, just back to login.

7. **AC7 - Riverpod providers:** `authProvider` returns `NotifierProvider<AuthNotifier, AuthState>(AuthNotifier.new)`. `tokenStorageProvider` injects `SecureTokenStorage`. `keycloakServiceProvider` injects `KeycloakService` with the flavor config.

8. **AC8 - ProviderScope in main.dart:** `ProviderScope` wraps the app in `main.dart`. All providers are available to the widget tree via `ref.watch()` and `ref.read()`.

9. **AC9 - Silent login on startup with valid tokens:** When `AuthNotifier` initializes and tokens exist in `TokenStorage` with a non-expired access token, the auth state is set to `authenticated` (user silently logged in).

10. **AC10 - Startup with expired tokens triggers refresh:** When `AuthNotifier` initializes and tokens exist but the access token is expired, `validateTokens()` attempts a silent refresh. If refresh succeeds, state is `authenticated`; if it fails, state is `unauthenticated`.

11. **AC11 - Startup with no tokens:** When `AuthNotifier` initializes and no tokens exist in `TokenStorage`, the auth state remains `unauthenticated`.

## Tasks / Subtasks

- [x] Task 0: Fix flavor config URLs to include realm path (prerequisite)
  - [x] 0.1: Update `dev_config.dart` — `keycloakUrl` must include realm path (e.g., `http://localhost:8080/realms/genie`)
  - [x] 0.2: Update `staging_config.dart` — verify `keycloakUrl` includes realm path
  - [x] 0.3: Update `e2e_config.dart` — verify `keycloakUrl` includes realm path
  - [x] 0.4: Update `flavors/itu.dart` — verify `keycloakUrl` includes realm path (e.g., `https://keycloak.itu.int/realms/genie`)
  - [x] 0.5: Run `flutter test test/config/keycloak_config_test.dart` — verify no regressions
- [x] Task 1: Create KeycloakService with OIDC discovery (AC: #1, #2)
  - [x] 1.1: Create `lib/services/keycloak/` directory
  - [x] 1.2: Create `lib/services/keycloak/keycloak_service.dart`
  - [x] 1.3: Define `OidcEndpoints` data class with fields: `authorizationEndpoint`, `tokenEndpoint`, `userinfoEndpoint`, `endSessionEndpoint`
  - [x] 1.4: Define `KeycloakService` class with `KeycloakConfig keycloakConfig` constructor parameter
  - [x] 1.5: Implement `discoverEndpoints()` — fetch `{keycloakUrl}/.well-known/openid-configuration`, parse JSON, return `OidcEndpoints`
  - [x] 1.6: Cache discovered endpoints in a nullable field — skip HTTP call on subsequent invocations
  - [x] 1.7: Handle discovery failures: `SocketException` / `ClientException` → return null (caller emits error state)
- [x] Task 2: Create AuthNotifier with login flow (AC: #3, #4, #5, #6, #9, #10, #11)
  - [x] 2.1: Create `lib/services/auth/auth_notifier.dart`
  - [x] 2.2: `class AuthNotifier extends Notifier<AuthState>` — implement `build()` method
  - [x] 2.3: In `build()`: inject dependencies via `ref.watch(tokenStorageProvider)`, `ref.watch(keycloakServiceProvider)`
  - [x] 2.4: In `build()`: call `_initializeAuth()` to check existing tokens (AC #9, #10, #11)
  - [x] 2.5: Implement `_initializeAuth()` — check tokens in storage, validate expiration, refresh if expired, emit appropriate state
  - [x] 2.6: Implement `authorize()` — call `discoverEndpoints()`, build `AuthorizationTokenRequest` with PKCE, call `_appAuth.authorizeAndExchangeCode()`, save tokens, emit `AuthState.authenticated()`
  - [x] 2.7: Handle `authorize()` cancellation (`FlutterAppAuthUserCancelledException`) — emit `AuthState.unauthenticated()`
  - [x] 2.8: Handle `authorize()` network errors — emit `AuthState.error(retryable: true)`
  - [x] 2.9: Implement `validateTokens()` — compare stored expiration with `DateTime.now()`, attempt refresh if expired
  - [x] 2.10: Implement `refreshToken()` — exchange refresh token at token endpoint via `flutter_appauth`, save new tokens
  - [x] 2.11: Handle `refreshToken()` failure — emit `AuthState.unauthenticated()` (triggers login screen)
- [x] Task 3: Create Riverpod providers (AC: #7)
  - [x] 3.1: Create `lib/services/auth/auth_providers.dart`
  - [x] 3.2: Define `tokenStorageProvider = Provider<TokenStorage>((ref) => SecureTokenStorage())`
  - [x] 3.3: Define `keycloakServiceProvider = Provider<KeycloakService>((ref) => KeycloakService(keycloakConfig: getConfig()))`
  - [x] 3.4: Define `authProvider = NotifierProvider<AuthNotifier, AuthState>(AuthNotifier.new)`
- [x] Task 4: Add ProviderScope to main.dart (AC: #8)
  - [x] 4.1: Import `package:flutter_riverpod/flutter_riverpod.dart` and `auth_providers.dart`
  - [x] 4.2: Wrap `runApp()` with `ProviderScope(child: MyApp())`
  - [x] 4.3: Verify existing app structure is preserved — no functional changes beyond ProviderScope wrapping
- [x] Task 5: Write unit tests (AC: #1-#11)
  - [x] 5.1: Create `test/services/keycloak/` directory
  - [x] 5.2: Create `test/services/keycloak/keycloak_service_test.dart` — test discovery, caching, error handling
  - [x] 5.3: Create `test/services/auth/auth_notifier_test.dart` — test authorize, initialization, refresh, cancellation, error states
  - [x] 5.4: Test AC #9: initialize with valid tokens → state is authenticated
  - [x] 5.5: Test AC #10: initialize with expired tokens → refresh attempted
  - [x] 5.6: Test AC #11: initialize with no tokens → state is unauthenticated
  - [x] 5.7: Test AC #6: user cancels → state is unauthenticated
  - [x] 5.8: Run `flutter test` — all pass, no regressions

## Dev Notes

### Architecture Context

This story implements the **core OIDC login flow** — the heart of the mobile auth system. It creates `KeycloakService` (OIDC discovery), `AuthNotifier` (business logic), and `auth_providers.dart` (Riverpod wiring). Story 1.3b adds the deep link handler, Story 1.4 adds the login screen UI.

**Key architectural decisions (from architecture.md):**

- **D5: Riverpod Provider Structure** — Four auth files under `services/auth/`. `AuthNotifier` extends `Notifier<AuthState>` (Riverpod 3.0 pattern). Dependencies injected via `ref.watch()` in `build()`, cleanup via `ref.onDispose()`.
- **D2: TokenStorage Interface** — `AuthNotifier` uses `TokenStorage` abstraction, never `flutter_secure_storage` directly.
- **D6: Flavor Config** — `KeycloakService` receives `KeycloakConfig` from `getConfig()`. The redirect URI is built from `config.redirectScheme://callback`.
- **OIDC Discovery (FR22):** Endpoints fetched from `.well-known/openid-configuration` at runtime using build-time Keycloak URL. Discovered endpoints are cached in memory.

**Implementation sequence context:**
- Story 1.1 ✅: `TokenStorage` (abstract + Secure + InMemory) — DONE
- Story 1.2 ✅: `AuthState` + `AuthStatus` + flavor config (`KeycloakConfig`, `getConfig()`) — DONE
- **Story 1.3a (this):** `KeycloakService` + `AuthNotifier` + `auth_providers.dart` + `ProviderScope`
- Story 1.3b: Deep link handler + custom URL scheme registration
- Story 1.4: Login screen UI + accessibility

### File Structure

```
lib/
├── config/
│   ├── keycloak_config.dart         # EXISTS (Story 1.2) — KeycloakConfig + getConfig()
│   ├── dev_config.dart              # EXISTS (Story 1.2)
│   ├── staging_config.dart          # EXISTS (Story 1.2)
│   ├── e2e_config.dart              # EXISTS (Story 1.2)
│   └── flavors/
│       └── itu.dart                 # EXISTS (Story 1.2)
├── services/
│   ├── auth/
│   │   ├── token_storage.dart       # EXISTS (Story 1.1) — TokenStorage abstract + Secure + InMemory
│   │   ├── auth_state.dart          # EXISTS (Story 1.2) — AuthStatus enum + AuthState class
│   │   ├── auth_notifier.dart       # NEW — Notifier<AuthState> core logic
│   │   └── auth_providers.dart      # NEW — Riverpod provider declarations
│   ├── keycloak/
│   │   └── keycloak_service.dart    # NEW — OIDC discovery + token exchange
│   └── ...
└── main.dart                        # MODIFIED — add ProviderScope wrapper

test/
├── services/
│   ├── auth/
│   │   ├── token_storage_test.dart  # EXISTS (Story 1.1)
│   │   ├── auth_state_test.dart     # EXISTS (Story 1.2)
│   │   └── auth_notifier_test.dart  # NEW
│   └── keycloak/
│       └── keycloak_service_test.dart # NEW
└── config/
    └── keycloak_config_test.dart    # EXISTS (Story 1.2)
```

### Code Patterns to Follow

**KeycloakService** (from architecture.md D2, D5):

```dart
import 'package:http/http.dart' as http;
import 'dart:convert';

class OidcEndpoints {
  final String authorizationEndpoint;
  final String tokenEndpoint;
  final String userinfoEndpoint;
  final String endSessionEndpoint;

  const OidcEndpoints({
    required this.authorizationEndpoint,
    required this.tokenEndpoint,
    required this.userinfoEndpoint,
    required this.endSessionEndpoint,
  });
}

class KeycloakService {
  final KeycloakConfig keycloakConfig;
  final http.Client _httpClient;
  OidcEndpoints? _cachedEndpoints;

  KeycloakService({required this.keycloakConfig, http.Client? httpClient})
      : _httpClient = httpClient ?? http.Client();

  Future<OidcEndpoints?> discoverEndpoints() async {
    if (_cachedEndpoints != null) return _cachedEndpoints;
    try {
      // keycloakUrl must be the realm URL, e.g. http://localhost:8080/realms/genie
      final uri = Uri.parse(
        '${keycloakConfig.keycloakUrl}/.well-known/openid-configuration',
      );
      final response = await _httpClient.get(uri);
      if (response.statusCode != 200) return null;
      final json = jsonDecode(response.body) as Map<String, dynamic>;
      _cachedEndpoints = OidcEndpoints(
        authorizationEndpoint: json['authorization_endpoint'],
        tokenEndpoint: json['token_endpoint'],
        userinfoEndpoint: json['userinfo_endpoint'],
        endSessionEndpoint: json['end_session_endpoint'],
      );
      return _cachedEndpoints;
    } catch (_) {
      return null; // Network error, invalid URL, etc.
    }
  }
}
```

**AuthNotifier** (from architecture.md D5):

```dart
import 'package:flutter_appauth/flutter_appauth.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'auth_state.dart';
import 'token_storage.dart';

class AuthNotifier extends Notifier<AuthState> {
  late final TokenStorage _tokenStorage;
  late final KeycloakService _keycloakService;
  static const _flutterAppAuth = FlutterAppAuth();

  @override
  AuthState build() {
    _tokenStorage = ref.watch(tokenStorageProvider);
    _keycloakService = ref.watch(keycloakServiceProvider);
    // Kick off async initialization without blocking
    Future.microtask(() => _initializeAuth());
    return const AuthState.unauthenticated();
  }

  Future<void> _initializeAuth() async {
    final expiration = await _tokenStorage.getAccessTokenExpiration();
    final hasTokens = await _tokenStorage.getAccessToken() != null;

    if (!hasTokens) {
      // No tokens — stay unauthenticated (AC #11)
      return;
    }

    if (expiration != null && expiration.isAfter(DateTime.now())) {
      // Valid tokens — silently log in (AC #9)
      // userId/displayName deferred to future story (no JWT parsing per architecture)
      state = const AuthState.authenticated();
      return;
    }

    // Expired tokens — attempt silent refresh (AC #10)
    await refreshToken();
  }

  Future<void> authorize() async {
    final endpoints = await _keycloakService.discoverEndpoints();
    if (endpoints == null) {
      state = const AuthState.error(
        message: 'Network unreachable',
        retryable: true,
      );
      return;
    }

    try {
      final tokenResponse = await _flutterAppAuth.authorizeAndExchangeCode(
        AuthorizationTokenRequest(
          _keycloakService.keycloakConfig.clientId,
          '${_keycloakService.keycloakConfig.redirectScheme}://callback',
          discoveryUrl: _keycloakService.keycloakConfig.keycloakUrl,
          scopes: ['openid', 'profile', 'email', 'offline_access'],
        ),
      );

      // v11: response is non-nullable, cancellation throws specific exception
      final expiration = tokenResponse.accessTokenExpirationDateTime ??
          DateTime.now().add(const Duration(seconds: 3600));

      await _tokenStorage.saveTokens(
        accessToken: tokenResponse.accessToken,
        idToken: tokenResponse.idToken ?? '',
        refreshToken: tokenResponse.refreshToken ?? '',
        accessTokenExpiration: expiration,
      );

      state = const AuthState.authenticated();
    } on FlutterAppAuthUserCancelledException {
      // User cancelled — no error, just back to login (AC #6)
      state = const AuthState.unauthenticated();
    } on FlutterAppAuthPlatformException catch (e) {
      state = AuthState.error(
        message: e.message ?? 'Authentication failed',
        retryable: true,
      );
    } catch (e) {
      state = const AuthState.error(
        message: 'Authentication failed',
        retryable: true,
      );
    }
  }

  Future<void> refreshToken() async {
    final currentRefreshToken = await _tokenStorage.getRefreshToken();
    if (currentRefreshToken == null) {
      state = const AuthState.unauthenticated();
      return;
    }

    try {
      // v11: token() returns non-nullable TokenResponse, throws on failure
      final tokenResponse = await _flutterAppAuth.token(
        TokenRequest(
          _keycloakService.keycloakConfig.clientId,
          '${_keycloakService.keycloakConfig.redirectScheme}://callback',
          discoveryUrl: _keycloakService.keycloakConfig.keycloakUrl,
          grantType: 'refresh_token',
          refreshToken: currentRefreshToken,
          scopes: ['openid', 'profile', 'email', 'offline_access'],
        ),
      );

      final expiration = tokenResponse.accessTokenExpirationDateTime ??
          DateTime.now().add(const Duration(seconds: 3600));

      await _tokenStorage.saveTokens(
        accessToken: tokenResponse.accessToken,
        idToken: tokenResponse.idToken ?? '',
        refreshToken: tokenResponse.refreshToken ?? '',
        accessTokenExpiration: expiration,
      );

      state = const AuthState.authenticated();
    } catch (_) {
      // Refresh failed — session expired
      await _tokenStorage.deleteAll();
      state = const AuthState.unauthenticated();
    }
  }

  Future<void> validateTokens() async {
    final expiration = await _tokenStorage.getAccessTokenExpiration();
    if (expiration == null || expiration.isBefore(DateTime.now())) {
      await refreshToken();
    }
  }
}
```

**auth_providers.dart** (from architecture.md D5):

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import '../../config/keycloak_config.dart';
import '../keycloak/keycloak_service.dart';
import 'auth_notifier.dart';
import 'token_storage.dart';

final tokenStorageProvider = Provider<TokenStorage>((ref) {
  return SecureTokenStorage();
});

final keycloakServiceProvider = Provider<KeycloakService>((ref) {
  return KeycloakService(keycloakConfig: getConfig(), httpClient: http.Client());
});

final authProvider = NotifierProvider<AuthNotifier, AuthState>(
  AuthNotifier.new,
);
```

**main.dart ProviderScope addition:**

```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

void main() {
  // ... existing HttpOverrides setup ...
  runApp(
    const ProviderScope(  // NEW — wrap existing app
      child: MyApp(),
    ),
  );
}
```

### flutter_appauth v11 API Reference

**Authorization Code + PKCE flow:**
- `FlutterAppAuth().authorizeAndExchangeCode(AuthorizationTokenRequest)` — opens system browser, handles PKCE automatically, exchanges code for tokens
- `AuthorizationTokenRequest(clientId, redirectUrl, discoveryUrl: ..., scopes: [...])` — PKCE is fully automatic (code_verifier/code_challenge generated by native SDK, never exposed to Dart code)
- **v11 non-nullable return:** `authorizeAndExchangeCode()` returns `AuthorizationTokenResponse` (non-nullable). Cancellation throws `FlutterAppAuthUserCancelledException` (since v7.0.0). Other errors throw `FlutterAppAuthPlatformException`.
- `AuthorizationTokenResponse` fields: `accessToken`, `idToken`, `refreshToken`, `accessTokenExpirationDateTime` (DateTime?, already parsed), `tokenType`, `scopes`
- `accessTokenExpirationDateTime` is a ready-to-use `DateTime?` — **no need to compute from `expiresIn` manually**. Use it directly: `tokenResponse.accessTokenExpirationDateTime ?? DateTime.now().add(Duration(seconds: tokenResponse.expiresIn ?? 3600))`

**Token refresh:**
- `FlutterAppAuth().token(TokenRequest)` with `grantType: 'refresh_token'` and `refreshToken` parameter
- Returns `TokenResponse` or throws `FlutterAppAuthPlatformException` on failure

**Key v11 platform notes:**
- Android: throws `PlatformException` with `no_browser_available` code if no suitable browser
- iOS: requires minimum iOS 11.0; uses ASWebAuthenticationSession by default
- `offline_access` scope recommended for refresh token support

**Corrected error handling pattern (v11):**

```dart
import 'package:flutter_appauth/flutter_appauth.dart';

try {
  final response = await _appAuth.authorizeAndExchangeCode(
    AuthorizationTokenRequest(
      clientId,
      redirectUrl,
      discoveryUrl: discoveryUrl,
      scopes: ['openid', 'profile', 'email', 'offline_access'],
    ),
  );
  // response is non-nullable AuthorizationTokenResponse
} on FlutterAppAuthUserCancelledException {
  // User cancelled — emit unauthenticated state
} on FlutterAppAuthPlatformException catch (e) {
  // Network error, no browser, etc. — emit error state
  // e.code: 'no_browser_available', 'null_activity', etc.
  // e.details: platform-specific error details
}
```

### Previous Story Intelligence (Stories 1.1 + 1.2)

**What was built:**
- `lib/services/auth/token_storage.dart` — abstract `TokenStorage` + `SecureTokenStorage` + `InMemoryTokenStorage` (11 tests)
- `lib/services/auth/auth_state.dart` — `AuthStatus` enum (3 values) + `AuthState` immutable class with value equality + `toString()` (11 tests)
- `lib/config/` — `KeycloakConfig` data class + `getConfig()` with 4 flavors + `ArgumentError` on unknown flavor (10 tests)
- 4 dependencies in pubspec.yaml: `flutter_secure_storage ^8.1.0`, `flutter_appauth ^11.0.0`, `flutter_riverpod ^3.0.0`, `app_links ^6.3.3`

**Code review feedback from Stories 1.1 & 1.2 to apply:**
- Narrow exception catches to specific types (`FormatException` for JSON, not broad `Exception`)
- `const` constructors for data classes — enables tree-shaking
- `equals()` exact matching in tests, not `contains()` weak assertions
- `toString()` on state classes for debuggability
- Silent error handling on `deleteAll()` — `.catchError((_) {})` pattern
- `ArgumentError` on unknown flavor instead of silent fallback

**Patterns established:**
- All tokens stored as single JSON blob under key `auth_tokens`
- `expiresIn` stored as absolute `DateTime` (ISO 8601 string via `.toUtc().toIso8601String()`)
- One class per file (except abstract class + implementations)
- Test directory mirrors lib structure
- `_camelCase` prefix for private members
- `const` constructors on immutable data classes

### Critical Implementation Rules

- **`AuthNotifier` extends `Notifier<AuthState>`** (Riverpod 3.0) — NOT `StateNotifier` (deprecated). Dependencies via `ref.watch()` in `build()`.
- **PKCE is automatic** in `flutter_appauth` — no manual code_verifier/code_challenge generation needed.
- **OIDC discovery is runtime** — fetch `.well-known/openid-configuration` using build-time `keycloakUrl`. Cache results in memory.
- **`keycloakUrl` must be the Keycloak realm URL** (e.g., `http://localhost:8080/realms/genie`), NOT the server root URL. The discovery document lives at `{realmUrl}/.well-known/openid-configuration`. **IMPORTANT:** The current dev config has `keycloakUrl: 'http://localhost:8080'` (server root) — this will fail discovery. The dev config must be updated to include the realm path (e.g., `http://localhost:8080/realms/genie`). Verify and fix ALL flavor configs before implementation.
- **Redirect URI format** — `{redirectScheme}://callback` (e.g., `com.itu.genieai.dev://callback`). Must match Keycloak client's registered redirect URI.
- **`authorizeAndExchangeCode()` throws `FlutterAppAuthUserCancelledException` on cancellation** — catch this specific exception, emit `AuthState.unauthenticated()`. Response is non-nullable (v11).
- **Network errors throw `FlutterAppAuthPlatformException`** — catch and emit `AuthState.error(retryable: true)`. Check `e.code` for `no_browser_available`, `null_activity`, etc.
- **Token expiration tracked via stored `DateTime`** — no JWT parsing. Compare `DateTime.now()` with stored expiration.
- **`_initializeAuth()` runs async from `build()`** — use `Future.microtask(() => _initializeAuth())` to avoid blocking the build method. `build()` must return synchronously — it cannot be `async`.
- **No `BuildContext` inside `AuthNotifier`** — pure business logic, no UI dependency.
- **No tokens in logs** — FR25/NFR9.
- **`http` package for discovery** — use `package:http` (already in project) for OIDC discovery HTTP call, NOT `dio` or other HTTP clients.
- **`offline_access` scope required** — include `offline_access` in scopes to ensure Keycloak issues a refresh token. Without it, refresh token may not be returned.
- **`accessTokenExpirationDateTime`** — v11 provides this as a ready-to-use `DateTime?`. Prefer it over computing from `expiresIn` manually.

### Testing Requirements

**KeycloakService tests** (`test/services/keycloak/keycloak_service_test.dart`):
- `discoverEndpoints()` parses `.well-known/openid-configuration` response correctly
- Discovered endpoints are cached — second call does not make HTTP request
- `discoverEndpoints()` returns null on HTTP error (non-200 status)
- `discoverEndpoints()` returns null on network error
- Inject `MockHttpClient` (implementing `http.Client`) via `KeycloakService` constructor for all HTTP mocking

**AuthNotifier tests** (`test/services/auth/auth_notifier_test.dart`):
- `authorize()` succeeds → state is `authenticated`
- `authorize()` cancelled (`FlutterAppAuthUserCancelledException`) → state is `unauthenticated`
- `authorize()` network error (`FlutterAppAuthPlatformException`) → state is `error(retryable: true)`
- `_initializeAuth()` with valid tokens → state is `authenticated` (AC #9)
- `_initializeAuth()` with expired tokens → refresh attempted (AC #10)
- `_initializeAuth()` with no tokens → state stays `unauthenticated` (AC #11)
- `refreshToken()` succeeds → state is `authenticated`, new tokens saved
- `refreshToken()` fails → tokens deleted, state is `unauthenticated`

**Riverpod 3.0 test setup pattern:**
```dart
import 'package:flutter_riverpod/flutter_riverpod.dart';

late ProviderContainer container;

setUp(() {
  container = ProviderContainer(
    overrides: [
      tokenStorageProvider.overrideWithValue(InMemoryTokenStorage()),
      keycloakServiceProvider.overrideWithValue(mockKeycloakService),
    ],
  );
});

tearDown(() => container.dispose);

// Read notifier: container.read(authProvider.notifier)
// Read state: container.read(authProvider)
```

**Riverpod 3.0 `overrideWithBuild`** — mock `build()` while keeping real methods:
```dart
container = ProviderContainer.test(
  overrides: [
    authProvider.overrideWithBuild((ref) {
      // Mock build to start authenticated — real methods still work
      return const AuthState.authenticated(userId: 'test');
    }),
  ],
);
```

### Implementation Gotchas

- **`_initializeAuth()` via `Future.microtask()`** — `build()` must return synchronously (Riverpod requirement). The async token check runs on the next microtask. This means `authProvider` state is briefly `unauthenticated` even when valid tokens exist. **This is correct behavior.** Do NOT attempt to make `build()` async — it will crash Riverpod. Widgets reading `ref.watch(authProvider)` will automatically rebuild when the state changes from the microtask.

- **`keycloakUrl` = realm URL, not server root.** The OIDC discovery document lives at `{realmUrl}/.well-known/openid-configuration`. Current dev config has `http://localhost:8080` (server root) — this must be updated to `http://localhost:8080/realms/genie` (or whatever the local Keycloak realm is named). **Task 0 (prerequisite):** Fix all flavor configs to include the realm path before implementing.

- **`userId` and `displayName` are NOT populated in this story.** `AuthState.authenticated()` is called without these fields. No JWT parsing — per architecture rule. The userinfo endpoint call or ID token claim extraction will be added in a future story. The login screen UI (Story 1.4) should handle the case where `userId`/`displayName` are null.

- **Story 1.3b dependency:** This story implements the login code, but the OIDC callback won't work end-to-end until Story 1.3b registers the custom URL scheme in AndroidManifest.xml and Info.plist. The `authorizeAndExchangeCode()` call will hang or timeout without the URL scheme. **Test login flow only after 1.3b is complete.** Unit tests can mock `FlutterAppAuth` to bypass this.

### Story Dependencies

- **Requires:** Story 1.1 (TokenStorage) ✅, Story 1.2 (AuthState + KeycloakConfig) ✅
- **Blocks:** Story 1.3b (deep link handler depends on `KeycloakService` and `AuthNotifier`)
- **Prerequisite for end-to-end testing:** Story 1.3b (URL scheme registration)

### Definition of Done

- [x] All tasks and subtasks completed
- [x] `flutter analyze` — no issues in new/modified files
- [x] `flutter test` — all tests pass, no regressions (54 total tests)
- [x] Flavor configs updated with correct realm URLs (via `realm` field)
- [x] No tokens, credentials, or PII in any log output or code comments

### Project Structure Notes

- `lib/services/keycloak/` is a new directory — separates Keycloak-specific HTTP calls from generic auth logic (per architecture.md D5)
- `lib/services/auth/auth_notifier.dart` and `auth_providers.dart` are new additions to the existing auth directory
- `main.dart` is modified minimally — only `ProviderScope` wrapper added
- No conflicts with existing code — purely additive except the main.dart ProviderScope wrapper
- The `WidgetsBindingObserver` mixin on `AuthNotifier` is NOT added in this story — it's deferred to Story 3.1 (AppLifecycle Token Validation) per the implementation sequence

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#D2 TokenStorage Interface]
- [Source: _bmad-output/planning-artifacts/architecture.md#D5 Riverpod Provider Structure]
- [Source: _bmad-output/planning-artifacts/architecture.md#D6 AppLifecycle + Deep Link + Flavor Strategy]
- [Source: _bmad-output/planning-artifacts/architecture.md#Implementation Patterns & Consistency Rules]
- [Source: _bmad-output/planning-artifacts/architecture.md#Project Structure & Boundaries]
- [Source: _bmad-output/planning-artifacts/architecture.md#Data Flow]
- [Source: _bmad-output/planning-artifacts/epics.md#Story 1.3a: Keycloak Login via System Browser]
- [Source: _bmad-output/planning-artifacts/prd.md#FR1, FR2, FR3, FR22, FR25]
- [Source: _bmad-output/planning-artifacts/prd.md#NFR3, NFR6]
- [Source: _bmad-output/implementation-artifacts/1-1-secure-token-storage-foundation.md#Completion Notes]
- [Source: _bmad-output/implementation-artifacts/1-2-auth-state-machine-flavor-configuration.md#Completion Notes]

## Dev Agent Record

### Agent Model Used

glm-5-turbo

### Debug Log References

- flutter_appauth v11 `accessToken` is `String?` (not non-nullable as story Dev Notes claimed) — added null check before saving tokens
- flutter_appauth v11 exception constructors require named params (`code:`, `message:`, `platformErrorDetails:`) — not positional strings
- `Future.microtask(() => _initializeAuth())` in `build()` cannot be reliably awaited in unit tests — tested `_initializeAuth` logic via `validateTokens()` instead
- `ref.mounted` checks required after all async gaps in `AuthNotifier` to prevent "Ref used after dispose" errors

### Completion Notes List

- Task 0: Added `realm` field to `KeycloakConfig` (user feedback: embedding realm path in `keycloakUrl` was not intuitive and misaligned with Docker Compose config). Added `realmUrl` computed getter. All 4 flavor configs updated with `realm: 'genie'`.
- Task 1: Created `KeycloakService` with `discoverEndpoints()` using `keycloakConfig.realmUrl`. Caches endpoints in memory. Handles `SocketException`, `ClientException`, `FormatException`.
- Task 2: Created `AuthNotifier` extending `Notifier<AuthState>` (Riverpod 3.0). Implements `authorize()`, `refreshToken()`, `validateTokens()`, `_initializeAuth()`. Uses `ref.mounted` checks after all async gaps.
- Task 2 bonus: Created `AppAuth` abstraction (`app_auth.dart`) to enable test mocking of `flutter_appauth` without `mockito`/`mocktail`. `FlutterAppAuthAdapter` wraps the real plugin.
- Task 3: Created `auth_providers.dart` with `tokenStorageProvider`, `keycloakServiceProvider`, `appAuthProvider`, `authProvider`.
- Task 4: Wrapped `runApp()` with `ProviderScope` in `main.dart`.
- Task 5: 19 new tests (8 KeycloakService + 11 AuthNotifier). 54 total tests pass, 0 regressions.

### File List

- `mobile/genie_ai_mobile/lib/config/keycloak_config.dart` (modified — added `realm` field and `realmUrl` getter)
- `mobile/genie_ai_mobile/lib/config/dev_config.dart` (modified — added `realm: 'genie'`)
- `mobile/genie_ai_mobile/lib/config/staging_config.dart` (modified — added `realm: 'genie'`)
- `mobile/genie_ai_mobile/lib/config/e2e_config.dart` (modified — added `realm: 'genie'`)
- `mobile/genie_ai_mobile/lib/config/flavors/itu.dart` (modified — added `realm: 'genie'`)
- `mobile/genie_ai_mobile/lib/services/keycloak/keycloak_service.dart` (new — `OidcEndpoints` + `KeycloakService`)
- `mobile/genie_ai_mobile/lib/services/auth/app_auth.dart` (new — `AppAuth` abstraction + `FlutterAppAuthAdapter`)
- `mobile/genie_ai_mobile/lib/services/auth/auth_notifier.dart` (new — `AuthNotifier` with OIDC login flow)
- `mobile/genie_ai_mobile/lib/services/auth/auth_providers.dart` (new — Riverpod providers)
- `mobile/genie_ai_mobile/lib/main.dart` (modified — added `ProviderScope` wrapper)
- `mobile/genie_ai_mobile/pubspec.yaml` (modified — added `flutter_appauth_platform_interface` dev dep)
- `mobile/genie_ai_mobile/test/config/keycloak_config_test.dart` (modified — updated for `realm` field + `realmUrl`)
- `mobile/genie_ai_mobile/test/services/keycloak/keycloak_service_test.dart` (new — 8 tests)
- `mobile/genie_ai_mobile/test/services/auth/auth_notifier_test.dart` (new — 11 tests)

### Change Log

- 2026-04-24: Story 1.3a implemented — KeycloakService OIDC discovery, AuthNotifier login flow, Riverpod providers, ProviderScope, 19 new tests (54 total pass)
- 2026-04-24: Code review (Jerome) — 4 issues fixed: (1) `discoverEndpoints()` now catches `TypeError` on malformed OIDC responses, (2) `refreshToken()` preserves original refresh token when Keycloak doesn't rotate, (3) `keycloakServiceProvider` now disposes `http.Client` via `ref.onDispose()`, (4) AC #9/#10 tests rewritten to exercise actual `_initializeAuth()` microtask flow. 54/54 tests pass.
