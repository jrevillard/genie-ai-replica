---
stepsCompleted: [1, 2, 3, 4, 5, 6, 7, 8]
inputDocuments:
  - '_bmad-output/planning-artifacts/prd-mobile-oidc.md'
  - '_bmad-output/planning-artifacts/validation-prd-mobile-oidc.md'
  - '_bmad-output/planning-artifacts/architecture-keycloak-idp.md'
  - '_bmad-output/planning-artifacts/research/technical-identity-provider-integration-research-2026-03-26.md'
  - '_bmad-output/project-context.md'
  - 'site/content/en/docs/architecture/architecture.md'
workflowType: 'architecture'
project_name: 'genie-ai'
user_name: 'Jerome'
date: '2026-04-23'
lastStep: 8
status: 'complete'
completedAt: '2026-04-23'
---

# Architecture Decision Document — Mobile OIDC

_This document builds collaboratively through step-by-step discovery. Sections are appended as we work through each architectural decision together._

## Project Context Analysis

### Requirements Overview

**Functional Requirements:**

31 FRs organized into 11 categories driving the architecture:

1. **Authentication (FR1-FR4):** Authorization Code + PKCE via system browser (`flutter_appauth`). SSO with active Keycloak session. Logout with local token clearing + Keycloak `end_session_endpoint`.
2. **Session Management (FR5-FR8):** Silent token refresh via refresh token. `AppLifecycleState.resumed` triggers proactive token check. 401 → silent refresh → login fallback chain.
3. **Token Storage & Access (FR9-FR11):** Platform keystore/keychain only (`flutter_secure_storage`). Auth state service exposing tokens + identity claims to downstream consumers (e.g., #597 SSE streaming). Automatic Bearer token injection on API requests.
4. **Error Handling (FR12-FR14):** Network error detection with user-visible state within 500ms. Deep link callback failure recovery. Defined terminal states after any auth error — no indefinite loading.
5. **Account Recovery (FR15-FR16):** Password reset via Keycloak browser (not app). Deep link routing for password reset — links open in system browser, not intercepted by app.
6. **Multi-Deployment Support (FR17-FR19):** Dedicated Keycloak client per deployment (public client, PKCE mandatory). All config compiled at build-time via Flutter flavors. Documented onboarding guide.
7. **Deep Link Configuration (FR20-FR21):** Custom URL scheme per flavor for OIDC callback. Cryptographic domain-verified deep links (Universal Links / App Links) for password reset.
8. **OIDC Configuration (FR22):** Runtime OIDC discovery from `.well-known/openid-configuration` using build-time Keycloak URL.
9. **Security (FR23-FR25):** TLS certificate enforcement (`badCertificateCallback` removed). Complete legacy auth code removal. No tokens/PII in plaintext storage or logs.
10. **Deployment Documentation (FR26-FR28):** Deployment guide covering flavor template, Keycloak client creation, deep link setup, air-gapped network prerequisites, OS version policy.
11. **Testing (FR29-FR31):** Unit tests in platform-agnostic Dart. Integration tests on Android. CI execution on Android.

**Non-Functional Requirements:**

10 NFRs organized into 5 categories shaping architectural decisions:

1. **Performance (NFR1-NFR3):** Silent refresh < 2s p95. Login screen < 1s cold start. OIDC callback → authenticated session < 1s.
2. **Reliability (NFR4-NFR6):** Defined terminal states within 2s of error. No intermediate loading state > 10s without feedback. Auth state recalculated on every token operation — no stale state possible.
3. **Compatibility (NFR7-NFR8):** Binary size increase < 8MB per platform. 100% non-auth user data preserved across update.
4. **Observability (NFR9):** Auth failures logged at WARN with error_code, keycloak_endpoint, http_status, network_reachable, timestamp. Accessible via device diagnostics for 30 days.
5. **Accessibility (NFR10):** VoiceOver/TalkBack support. Accessibility labels on interactive elements. Minimum touch targets (44x44pt iOS / 48x48dp Android). State not indicated by color alone.

**Scale & Complexity:**

- Primary domain: Mobile App (Flutter) — brownfield auth migration aligning with existing web Keycloak architecture
- Complexity level: High — brownfield migration, white-label multi-deployment, dual deep link mechanism, iOS constraints, backend alignment, state machine for auth errors
- Estimated architectural components: 5-7 (auth service layer, token storage abstraction, deep link handler, Flutter flavor config system, API interceptor, legacy removal, deployment documentation)

### Technical Constraints & Dependencies

- **Existing web architecture alignment:** Mobile must use the same token passthrough architecture — Keycloak tokens validated at backend via JWKS, JIT provisioning by `{iss}#{sub}`, downstream headers (`X-User-Id`, `X-User-Roles`, `X-Issuer`). No GENIE.AI JWT issued.
- **Backend is already built:** JWKS validation, auth middleware, JIT provisioning, and downstream header injection are all implemented in `gov-chat-backend`. Mobile benefits from this infrastructure — minimal or zero backend changes expected.
- **Flutter flavor build system:** All deployment-specific values (app ID, Keycloak URL, client ID, backend URL, deep link scheme) compiled at build-time. No runtime configuration bootstrap.
- **iOS development constraints:** No dedicated macOS build machine, no Apple Developer account. iOS builds are best-effort (teammate Mac availability). CI and automated testing run on Android only.
- **`badCertificateCallback` in `main.dart`:** Existing SSL bypass must be removed (FR23). This may break development against self-signed certs — dev workflow adjustment needed.
- **Legacy auth code to remove:** `auth_proxy.dart`, `password_proxy.dart`, `register_screen.dart`, SHA-256 login hashing, plaintext password handling. These are Flutter-specific — no backend impact.
- **Auth state service as downstream API (FR10):** The mobile app must expose authentication state and tokens for other features to consume (e.g., Issue #597 SSE streaming). This is a new architectural surface — the web frontend uses Vuex store; Flutter needs an equivalent pattern.
- **Deep link dual mechanism:** Custom URL scheme (simple, per-flavor) for OIDC callback + Universal Links / App Links (server-side config) for password reset. The server-side files (`apple-app-site-association`, `assetlinks.json`) must be hosted on each deployment's Keycloak domain.
- **`flutter_appauth` + `flutter_secure_storage`:** Two new dependencies. Both are mature, actively maintained, and recommended by the research document. No alternatives evaluated in PRD.
- **Air-gapped deployment:** OIDC works identically whether Keycloak is internet-facing or internal. The device must have network access to Keycloak. The deployment guide must document DNS configuration.

### Cross-Cutting Concerns Identified

1. **Security (OWASP Mobile Top 10):** Token storage in platform keystore only, TLS enforcement, no secrets in binary, no PII in logs, threat model documentation for reverse-engineering of build-time values — affects auth service, storage layer, and deployment guide
2. **White-label multi-deployment:** Per-flavor configuration, unique deep link schemes, unique Keycloak clients, app store presence — affects Flutter project structure, build system, and deployment documentation
3. **State machine consistency:** Auth state must be recalculated on every token operation with defined terminal states — affects auth service architecture, error handling, and UI state management
4. **Cross-platform parity:** OIDC flow must work identically on iOS and Android via `flutter_appauth` abstraction — affects auth service design and testing strategy
5. **Backend alignment:** Mobile tokens must be compatible with existing backend JWKS validation, JIT provisioning, and downstream header injection — affects OIDC client configuration and Keycloak client setup
6. **Observability:** Structured auth failure logging accessible via device diagnostics — affects logging infrastructure and error reporting

### Open Architectural Questions (from collaborative review)

1. **Logout mechanism (FR4):** The mobile app must terminate the Keycloak session via `end_session_endpoint`. Should the app call this endpoint directly from Flutter (client-side HTTP call to Keycloak), or route through a backend endpoint? Direct call is simpler but exposes the Keycloak URL in the app's network traffic (already known — compiled at build-time). Backend proxy adds an unnecessary hop.
2. **Refresh token rotation:** FR5 specifies storing the new refresh token returned by Keycloak. Keycloak supports refresh token rotation (each refresh issues a new RT and invalidates the old one), but it must be explicitly enabled on the Keycloak client. The architecture must ensure the mobile Keycloak client has refresh token rotation enabled, and the app correctly replaces the stored RT on each refresh.
3. **Auth state service pattern (NFR6):** NFR6 requires auth state to be recalculated on every token operation with no stale state possible. This implies a centralized `AuthState` service with a reactive stream (`Stream<AuthStatus>`) that the entire UI subscribes to. The web equivalent is the Vuex auth module. Flutter needs a pattern decision: `ChangeNotifier`, `StreamBuilder`, or a lightweight state management solution. This decision affects the entire app architecture.
4. **`flutter_secure_storage` abstraction for CI:** Unit tests in CI (Docker runner) cannot access platform keystore/keychain. The storage layer needs an injectable wrapper with a mock implementation for tests. This is a testability constraint that shapes the auth service constructor design.
5. **White-label delivery pipeline friction:** Each new deployment requires a Keycloak client. The project already uses `keycloak-config-cli` (adorsys/keycloak-config-cli) with `genie-realm.yaml` for automated realm configuration. The mobile client is added as a new section in `genie-realm.yaml` with environment variables (`KC_MOBILE_CLIENT_ID`, `KC_MOBILE_REDIRECT_SCHEME`). This reuses the existing infrastructure — no manual Keycloak console setup required.
6. **Token expiration detection:** The app does not parse JWTs locally. Token expiration is tracked via the `expiresIn` field from `flutter_appauth`'s `TokenResponse`, stored as an absolute `DateTime` in `TokenStorage`. When `validateTokens()` runs on `AppLifecycleState.resumed`, it compares `DateTime.now()` with the stored expiration date — no JWT decoding, no network roundtrip. If expired, a silent refresh is attempted. This is the standard pattern used by `AppAuth-iOS` and `AppAuth-Android`.

7. **401 → refresh → retry race condition (FR8):** The PRD test matrix covers this as unit test only. An API call in flight when the token expires triggers 401 → silent refresh → request retry. This pattern should also be covered by integration tests with a mock backend, not just Dart unit tests.

## Integration Component Evaluation

### Primary Technology Domain

Mobile App (Flutter) — brownfield auth migration. The project exists at `mobile/genie_ai_mobile/` with an established structure, proxy pattern for API calls, and Material Design. No starter template — existing codebase evolves.

### Existing Project Structure

```
mobile/genie_ai_mobile/
├── lib/
│   ├── components/
│   │   ├── auth/           # LEGACY — login, register, password reset screens
│   │   ├── chat/           # Chat UI (keep)
│   │   ├── settings/       # Settings screens (keep)
│   │   ├── shared/         # Shared UI components (keep)
│   │   ├── sidebar/        # Sidebar navigation (keep)
│   │   └── user/           # User profile component (keep)
│   ├── services/
│   │   ├── auth_proxy.dart       # LEGACY — username/password login API
│   │   ├── password_proxy.dart   # LEGACY — password reset API
│   │   ├── api_service.dart      # Base HTTP client (modify — add Bearer interceptor)
│   │   ├── user_service.dart     # User profile (modify)
│   │   ├── genie_ai_config.dart  # Runtime config loader (keep — non-sensitive only)
│   │   └── *_proxy.dart          # Other domain proxies (keep)
│   ├── src/                   # App shell, localization, settings
│   ├── utils/                 # Theme utilities (keep)
│   └── main.dart             # App entry point (modify — remove badCertificateCallback)
├── assets/config/            # Runtime JSON config (non-sensitive only)
├── test/                     # EMPTY — no tests exist yet
└── pubspec.yaml              # Dependencies
```

### Dependencies — Current State vs Required

| Dependency | Current | Required | Action |
|---|---|---|---|
| `flutter_appauth` | Absent | Latest stable | **Add** |
| `flutter_secure_storage` | Absent | Latest stable | **Add** |
| `flutter_riverpod` | Absent | `^3.0.0` | **Add** (state management) |
| `shared_preferences` | `^2.2.2` | Remove | **Remove** — `flutter_secure_storage` replaces it for all storage |
| `crypto` | `^3.0.3` | Remove | **Remove** (SHA-256 login hashing, verify no other usage first) |
| `http` | `^1.6.0` | Keep | Keep — base HTTP client, Bearer interceptor added here |
| `connectivity_plus` | `^7.0.0` | Keep | Keep (network detection, NFR4) |
| `app_links` | `^6.3.3` | **Add** | Deep link handler (OIDC callback + Universal Links routing) |
| `url_launcher` | `^6.3.1` | Keep | Keep (Keycloak `end_session_endpoint` redirect) |
| `flutter_lints` | `^6.0.0` | Keep | Keep |

### New Components Added to Existing Stack

| Component | Version / Source | Purpose | New or Existing |
|---|---|---|---|
| `flutter_appauth` | Latest stable | OIDC Authorization Code + PKCE via system browser | New |
| `flutter_secure_storage` | Latest stable | Platform keystore/keychain for all storage (tokens + prefs) | New |
| `flutter_riverpod` | `^3.0.0` | State management — `NotifierProvider` for auth and future reactive states | New |
| Auth state service | New file | Riverpod `NotifierProvider<AuthNotifier, AuthStatus>` — centralized reactive auth state | New |
| Token storage abstraction | New file | `TokenStorage` abstract class + `SecureTokenStorage` (prod) + `InMemoryTokenStorage` (test) | New |
| Deep link handler | New file | Custom URL scheme routing for OIDC callback via `app_links` | New |
| HTTP Bearer interceptor | Modify `api_service.dart` | `http.BaseClient` override injecting Bearer token + 401 → refresh → retry | Modified |

### ApiService Rewrite Scope

The existing `ApiService` is a singleton with a hardcoded `baseUrl` (`https://genie-ai.itu.int/api`), manual token management (`setToken()`/`clearToken()`), and `print()` logging. Adding the `AuthInterceptor` requires a **significant refactor**, not a minor modification:

- **Remove** singleton pattern (`factory ApiService() => _instance`)
- **Remove** `_accessToken`, `setToken()`, `clearToken()`, `getHeaders()` — token injection moves to `AuthInterceptor`
- **Make** `baseUrl` configurable via `KeycloakConfig.backendUrl` (from flavor system)
- **Accept** `http.Client` as constructor parameter (inner client for `AuthInterceptor` to wrap)
- **Replace** `print()` logging with the persistent logging solution (NFR9)

The `*_proxy.dart` consumers are unaffected — they continue to call `apiService.get()`/`.post()` etc. The `AuthInterceptor` wraps the HTTP client transparently at the `ApiService` level. Legacy `user['accessToken']` pattern in `main.dart` is removed as part of legacy auth code cleanup.
| Flutter flavors | Build system | Per-deployment build via `lib/config/` + `--flavor <name>` | New |
| Legacy auth removal | Multiple files | Delete `auth_proxy.dart`, `password_proxy.dart`, auth screens, SHA-256 hashing | Removed |

### Architecture Pattern: Token Passthrough (Inherited from Web)

The PRD mobile aligns with the existing web architecture decision:
- No GENIE.AI JWT issued — Keycloak tokens validated directly at backend via JWKS
- Mobile sends raw Keycloak access token as Bearer token
- Backend performs JWKS validation, JIT provisioning, downstream header injection
- Mobile benefits from existing backend infrastructure — zero or minimal backend changes expected

### Key Design Decisions from Collaborative Review

**Decision: Riverpod as state management from day one**

- Rationale: Auth is not the only reactive state the app will need (chat messages, loading states, user profile). Starting with a bare `StreamController` and migrating to Riverpod mid-MVP is wasted work. Riverpod's entry cost is minimal (`Provider` + `ref.watch`) and it's the Flutter 2026 standard. Riverpod 3.0 uses `Notifier` / `NotifierProvider` (the `StateNotifier` / `StateNotifierProvider` pattern is deprecated). One migration avoided.

**Decision: `flutter_secure_storage` replaces `shared_preferences` entirely**

- Rationale: On Android, `flutter_secure_storage` uses `EncryptedSharedPreferences` under the hood — it's `shared_preferences` encrypted. On iOS, it uses Keychain. Performance difference is negligible for the few prefs stored. One storage mechanism = one abstraction (`TokenStorage`) = fewer dependencies = simpler architecture.

**Decision: `TokenStorage` injectable abstraction**

- Rationale: Unit tests in CI (Docker runner) cannot access platform keystore/keychain. An abstract `TokenStorage` with `SecureTokenStorage` (prod) and `InMemoryTokenStorage` (test) makes the entire auth stack testable without platform dependencies.

**Decision: HTTP interceptor lives in `api_service.dart`**

- Rationale: The project uses a proxy pattern where `api_service.dart` is the shared HTTP client and each `*_proxy.dart` consumes it. The Bearer token interceptor is added at this level as an `http.BaseClient` override. No separate interceptor file. Constructor accepts a `bool withAuth` flag and optional `http.Client` for test bypass.

**Decision: Flavor config via `lib/config/` + `--flavor`**

- Rationale: No code generation (`flavorizr`), no `build_runner`. A `lib/config/` directory with one Dart file per flavor, selected via `--flavor <name>` at build time (entry point specified with `-t`). Simple, transparent, no tooling dependency.

## Core Architectural Decisions

### Decision Priority Analysis

**Critical Decisions (Block Implementation):**
- D1: Auth state machine design — defines the reactive foundation for the entire app
- D2: TokenStorage interface — shapes auth service constructor design and test strategy
- D3: Logout mechanism — determines mobile ↔ Keycloak ↔ backend interaction
- D4: 401 → refresh → retry pattern — affects HTTP interceptor and concurrency model

**Important Decisions (Shape Architecture):**
- D5: Riverpod provider structure — file organization and dependency graph for auth
- D6: AppLifecycle + Deep Link + Flavor strategy — multi-concern integration layer

**Deferred Decisions (Post-MVP):**
- Push notification integration with auth state — not in scope

### D1: Auth State Machine

**Decision:** Three-state model with no `initial` state and no `retryCount`.

```
enum AuthStatus { authenticated, unauthenticated, error }

class AuthState {
  final AuthStatus status;
  final String? userId;
  final String? displayName;
  final String? errorMessage;
  final bool retryable;
}
```

- Rationale: Three states cover every UI scenario — no need for `initial` (app starts `unauthenticated`, tokens loaded asynchronously, state flips to `authenticated` if valid). No `retryCount` — retryable/non-retryable is a property of the error, not a counter. The `error` state includes `retryable: bool` so the UI can offer a retry button only when it makes sense (network error = retryable, invalid_grant = not retryable). `AuthNotifier` extends Riverpod 3.0 `Notifier<AuthState>` with `ref.watch()` in `build()` for dependency injection.
- Affects: `auth_notifier.dart`, `auth_state.dart`, all UI widgets consuming auth state via `ref.watch(authProvider)`

### D2: TokenStorage Interface

**Decision:** Five-method interface with `id_token` and `expires_in` stored, constructor injection. Token expiration tracked via `expiresIn` from `flutter_appauth` `TokenResponse` — stored as absolute `DateTime`, no JWT parsing needed.

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

- Rationale: Five methods — `saveTokens` writes all three tokens plus the expiration date from `flutter_appauth`'s `TokenResponse.expiresIn`. `deleteAll` clears everything on logout. `id_token` stored because Keycloak `end_session_endpoint` accepts `id_token_hint` for session targeting. `getAccessTokenExpiration()` returns the stored absolute expiration date for token validity checks. Constructor injection allows `SecureTokenStorage` (prod, `flutter_secure_storage`) and `InMemoryTokenStorage` (test) without platform dependency.
- **Atomicity caveat:** `flutter_secure_storage` does not support transactions — each `write()` call is independent. If the app crashes between writing the access token and refresh token, storage is in a partial state. **Mitigation:** on app startup, `AuthNotifier` checks all three tokens are present; if any is missing, treat as `unauthenticated`. Alternatively, `SecureTokenStorage` can serialize all three tokens as a single JSON blob written to one key (`auth_tokens`) to achieve atomicity at the application level.
- Affects: `token_storage.dart`, `auth_notifier.dart` constructor, unit test setup

### D3: Logout Mechanism

**Decision:** Mobile calls both `POST /api/auth/logout` (backend) and Keycloak `end_session_endpoint` (direct) in parallel. Backend API unchanged.

```dart
Future<void> logout() async {
  // Best-effort: each call wrapped individually — one failure does not block the others
  await Future.wait([
    _apiService.post('/api/auth/logout').catchError((_) {}),
    _keycloakService.endSession(idTokenHint: idToken).catchError((_) {}),
  ]);
  // deleteAll runs regardless of upstream failures
  await _tokenStorage.deleteAll().catchError((_) {});
  state = const AuthState(status: AuthStatus.unauthenticated);
}
```

- Rationale: `POST /api/auth/logout` stays as-is (ArangoDB session cleanup + audit log). Mobile calls Keycloak `end_session_endpoint` directly with `id_token_hint` — same pattern as web frontend (`manager.signoutRedirect()`). Both fire in parallel (`Future.wait`), followed by `deleteAll()`. Each call is individually wrapped in `.catchError((_) {})` so that a failure in one does not prevent the others from executing — this is true best-effort behavior. `deleteAll()` also has a `.catchError` guard since the platform keystore may be temporarily unavailable. No backend changes required.
- Affects: `auth_notifier.dart`, new `keycloak_service.dart`, `api_service.dart` (existing logout endpoint)

### D4: 401 → Refresh → Retry

**Decision:** Single retry with `Completer<void>` mutex for concurrent refresh serialization.

```dart
class AuthInterceptor extends http.BaseClient {
  final http.Client _inner;
  final AuthNotifier _authNotifier;

  Completer<String?>? _refreshCompleter;

  @override
  Future<http.StreamedResponse> send(http.BaseRequest request) async {
    final token = await _authNotifier.tokenStorage.getAccessToken();
    request.headers['Authorization'] = 'Bearer $token';

    // Clone the request before sending — BaseRequest is single-use (body stream consumed on send)
    final clonedRequest = await request.cloneStream();

    final response = await _inner.send(request);

    if (response.statusCode == 401) {
      final newToken = await _refreshMutex();
      if (newToken == null) {
        _authNotifier.logout();
        throw AuthException('Session expired');
      }
      clonedRequest.headers['Authorization'] = 'Bearer $newToken';
      final retryResponse = await _inner.send(clonedRequest);

      // If retry also 401, session is dead — trigger logout
      if (retryResponse.statusCode == 401) {
        _authNotifier.logout();
        throw AuthException('Session expired after refresh');
      }
      return retryResponse;
    }
    return response;
  }

  Future<String?> _refreshMutex() async {
    if (_refreshCompleter != null) {
      return _refreshCompleter!.future;
    }
    _refreshCompleter = Completer<String?>();
    try {
      await _authNotifier.refreshToken();
      final newToken = await _authNotifier.tokenStorage.getAccessToken();
      _refreshCompleter!.complete(newToken);
      return newToken;
    } catch (e) {
      _refreshCompleter!.complete(null);
      return null;
    } finally {
      _refreshCompleter = null;
    }
  }
}
```

- Rationale: Single retry — if the refreshed token also gets 401, the session is dead (logout + throw). `Completer<String?>` mutex ensures concurrent 401s don't trigger parallel refreshes — the second request awaits the same `Completer` and receives the refresh result (or `null` on failure). The request is cloned before the first send because `http.BaseRequest` is single-use (body stream consumed after `send()`). This is the standard pattern for OAuth token refresh in mobile apps.
- Affects: `api_service.dart` (modified), `auth_notifier.dart` (`refreshToken` method)

### D5: Riverpod Provider Structure

**Decision:** Four auth files under `services/auth/`, shared `ApiService` via provider.

```
lib/services/auth/
├── auth_notifier.dart      # Notifier<AuthState> — core logic
├── auth_state.dart          # AuthStatus enum + AuthState class
├── auth_providers.dart      # Provider declarations
└── token_storage.dart       # Abstract TokenStorage + implementations
```

```dart
// auth_providers.dart
final tokenStorageProvider = Provider<TokenStorage>((ref) {
  return SecureTokenStorage();
});

final keycloakServiceProvider = Provider<KeycloakService>((ref) {
  final config = getConfig();
  return KeycloakService(keycloakConfig: config);
});

final apiServiceProvider = Provider<ApiService>((ref) {
  return ApiService(keycloakConfig: getConfig());
});

final authProvider = NotifierProvider<AuthNotifier, AuthState>(AuthNotifier.new);
```

```dart
// auth_notifier.dart
class AuthNotifier extends Notifier<AuthState> with WidgetsBindingObserver {
  late final TokenStorage _tokenStorage;
  late final ApiService _apiService;
  late final KeycloakService _keycloakService;

  @override
  AuthState build() {
    _tokenStorage = ref.watch(tokenStorageProvider);
    _apiService = ref.watch(apiServiceProvider);
    _keycloakService = ref.watch(keycloakServiceProvider);
    WidgetsBinding.instance.addObserver(this);
    ref.onDispose(() {
      WidgetsBinding.instance.removeObserver(this);
    });
    return const AuthState(status: AuthStatus.unauthenticated);
  }

  // ... login(), refreshToken(), logout() methods
  // ... didChangeAppLifecycleState() stays the same
}
```

- Rationale: Four files — `auth_state.dart` (pure data, no deps), `token_storage.dart` (storage abstraction), `auth_notifier.dart` (business logic), `auth_providers.dart` (Riverpod wiring). Clean separation of concerns. `apiServiceProvider` and `keycloakServiceProvider` are declared at the same level and shared across the app. Tests override `tokenStorageProvider` with `InMemoryTokenStorage`. In Riverpod 3.0, `NotifierProvider` with `AuthNotifier.new` replaces the deprecated `StateNotifierProvider` pattern. Dependencies are injected via `ref.watch()` in the `build()` method instead of constructor parameters, and cleanup uses `ref.onDispose()` instead of overriding `dispose()`.
- Affects: All files in `services/auth/`, `main.dart` (ProviderScope), test setup

### D6: AppLifecycle + Deep Link + Flavor Strategy

**Decision:** Two-tier flavor config with lifecycle-triggered token validation.

**Flavor Config:**
```
lib/config/
├── keycloak_config.dart          # KeycloakConfig data class
├── dev_config.dart               # Dev environment
├── staging_config.dart           # Staging environment
├── e2e_config.dart               # E2E test environment
└── flavors/
    └── itu.dart                  # Production deployment flavor
```

```dart
// keycloak_config.dart
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

KeycloakConfig getConfig() {
  final flavor = const String.fromEnvironment('FLAVOR', defaultValue: 'dev');
  switch (flavor) {
    case 'itu': return flavors.itu;
    case 'staging': return stagingConfig;
    case 'e2e': return e2eConfig;
    default: return devConfig;
  }
}
```

- Rationale: Dev/staging/e2e are environment-level configs at `config/` root — they share the same client but different Keycloak instances. Deployment flavors (e.g., `itu`) live in `config/flavors/` — each has its own Keycloak client, deep link scheme, and app ID. `String.fromEnvironment` is compile-time constant — no runtime cost, tree-shaken.

**AppLifecycle Integration:**
```dart
class AuthNotifier extends Notifier<AuthState> with WidgetsBindingObserver {
  late final TokenStorage _tokenStorage;
  late final ApiService _apiService;
  late final KeycloakService _keycloakService;

  @override
  AuthState build() {
    _tokenStorage = ref.watch(tokenStorageProvider);
    _apiService = ref.watch(apiServiceProvider);
    _keycloakService = ref.watch(keycloakServiceProvider);
    WidgetsBinding.instance.addObserver(this);
    ref.onDispose(() {
      WidgetsBinding.instance.removeObserver(this);
    });
    return const AuthState(status: AuthStatus.unauthenticated);
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed) {
      validateTokens(); // silent check via stored expiresIn, refresh if expired
    }
  }

  // ... login(), refreshToken(), logout() methods stay the same
}
```

- Rationale: `WidgetsBindingObserver` on `AuthNotifier` — when app resumes, silently validate tokens and refresh if needed. Non-blocking: doesn't show loading UI, just ensures tokens are fresh. **Critical:** `addObserver` in `build()`, `removeObserver` in `ref.onDispose()` — prevents memory leak and ensures lifecycle events stop firing after the notifier is disposed. Riverpod 3.0's `Notifier` base class uses `ref.watch()` in `build()` for dependency injection instead of constructor parameters.

**Deep Link Strategy:**
- Custom URL scheme (`genieai://callback`) for OIDC callback — configured per flavor in `AndroidManifest.xml` / `Info.plist`
- Universal Links (iOS) / App Links (Android) for password reset — domain-verified deep links prevent app interception. Requires server-side files (`apple-app-site-association`, `assetlinks.json`) hosted on each deployment's Keycloak domain
- Deep link handler in `main.dart` via `app_links` (flutter_appauth + app_links are the proven mobile OIDC stack; `app_links` replaces the unmaintained `uni_links`)
- **Implementation note:** `app_links` provides a unified `AppLinks()` singleton with `uriLinkStream` for listening to deep link callbacks. Universal Links / App Links require server-side configuration (hosted JSON files on Keycloak domain) + platform-specific setup in `AndroidManifest.xml` (intent-filter with `autoVerify`) and `Info.plist` (Associated Domains entitlement). The deployment guide must document these server-side files per deployment.

- Affects: `lib/config/` directory, `auth_notifier.dart`, `main.dart`, Android/iOS platform config

### Decision Impact Analysis

**Implementation Sequence:**
1. TokenStorage abstraction + InMemoryTokenStorage (test) + SecureTokenStorage (prod)
2. AuthState + AuthStatus (pure data classes)
3. AuthNotifier (`Notifier<AuthState>`) with login/refresh/logout logic
4. Riverpod providers (`NotifierProvider`) + ProviderScope in main.dart
5. AuthInterceptor on ApiService (401 → refresh → retry)
6. AppLifecycle binding (`WidgetsBindingObserver` + `ref.onDispose()`) + deep link handler (`app_links`)
7. Flavor config system + build commands
8. Legacy auth code removal
9. `badCertificateCallback` removal from main.dart

**Cross-Component Dependencies:**
- `TokenStorage` → `AuthNotifier` → `authProvider` → UI widgets
- `AuthInterceptor` depends on `AuthNotifier` (token access) + `ApiService` (HTTP client)
- Flavor config is read at app startup, feeds `KeycloakConfig` to `AuthNotifier`
- `AppLifecycleObserver` on `AuthNotifier` triggers token validation without UI coupling

## Implementation Patterns & Consistency Rules

### Pattern Categories Defined

**Critical Conflict Points Identified:**
8 areas where AI agents could make different choices in this Flutter brownfield project.

### Naming Patterns

**Dart Code Naming:**
- Files: `snake_case.dart` (Dart convention) — `auth_notifier.dart`, `token_storage.dart`
- Classes: `PascalCase` — `AuthNotifier`, `TokenStorage`, `KeycloakConfig`
- Enums: `PascalCase` with `camelCase` values — `enum AuthStatus { authenticated, unauthenticated, error }`
- Methods: `camelCase` — `saveTokens()`, `deleteAll()`, `validateTokens()`
- Private members: `_camelCase` prefix — `_refreshCompleter`, `_inner`, `_tokenStorage`
- Constants: `lowerCamelCase` for local, `UPPER_SNAKE_CASE` for compile-time — `const String.fromEnvironment`
- Provider references: `camelCaseProvider` suffix — `authProvider`, `tokenStorageProvider`, `apiServiceProvider`

**Riverpod Naming:**
- NotifierProvider: `<name>Provider` — `authProvider`
- Plain Provider (dependency): `<name>Provider` — `tokenStorageProvider`, `apiServiceProvider`
- Notifier class: `<Name>Notifier` — `AuthNotifier`
- State class: `<Name>State` — `AuthState`
- Status enum: `<Name>Status` — `AuthStatus`

**Test Naming:**
- Test files: `<name>_test.dart` co-located in `test/` mirroring `lib/` structure
- Test groups: `group('<ClassName>', () { ... })` — `group('AuthNotifier', () { ... })`
- Test cases: `test('should <expected behavior>', () { ... })` — `test('should emit authenticated state after successful login', () { ... })`
- Test helpers: `mock_<name>.dart` in `test/helpers/` — `mock_token_storage.dart`

### Structure Patterns

**Project Organization (brownfield, `mobile/genie_ai_mobile/`):**
```
lib/
├── config/                    # Build-time configuration (flavor system)
│   ├── keycloak_config.dart
│   ├── dev_config.dart
│   ├── staging_config.dart
│   ├── e2e_config.dart
│   └── flavors/
│       └── itu.dart
├── services/
│   ├── auth/                  # NEW — OIDC auth stack
│   │   ├── auth_notifier.dart
│   │   ├── auth_state.dart
│   │   ├── auth_providers.dart
│   │   └── token_storage.dart
│   ├── keycloak/              # NEW — Keycloak-specific service
│   │   └── keycloak_service.dart
│   ├── api_service.dart       # MODIFIED — add AuthInterceptor
│   ├── user_service.dart      # MODIFIED — consume auth state
│   └── *_proxy.dart           # EXISTING — keep as-is
├── components/
│   ├── auth/                  # DELETE — legacy auth screens
│   ├── chat/                  # EXISTING — keep
│   ├── settings/              # EXISTING — keep
│   ├── shared/                # EXISTING — keep
│   ├── sidebar/               # EXISTING — keep
│   └── user/                  # EXISTING — keep
├── src/                       # EXISTING — app shell, localization
├── utils/                     # EXISTING — theme utilities
└── main.dart                  # MODIFIED — remove badCertificateCallback, add ProviderScope
```

**Test Organization:**
```
test/
├── services/
│   ├── auth/
│   │   ├── auth_notifier_test.dart
│   │   ├── auth_state_test.dart
│   │   └── token_storage_test.dart
│   └── keycloak/
│       └── keycloak_service_test.dart
├── helpers/
│   └── mocks/
│       ├── mock_token_storage.dart
│       └── mock_api_service.dart
└── config/
    └── keycloak_config_test.dart
```

**File Organization Rules:**
- One class per file (except closely related types like `AuthStatus` + `AuthState`)
- `abstract class` and its implementations in the same file (e.g., `TokenStorage` + `SecureTokenStorage` + `InMemoryTokenStorage` all in `token_storage.dart`)
- Provider declarations separate from notifier logic (`auth_providers.dart` vs `auth_notifier.dart`)

### Format Patterns

**API Interaction:**
- HTTP client: `package:http` (already in project)
- JSON serialization: manual `jsonDecode`/`jsonEncode` (no `json_serializable` — few DTOs, no code generation principle)
- API response format: backend returns `{ success, message, data? }` — mobile maps to Dart models
- Error response format: `{ error, message, details? }` — mobile maps to `AuthException`

**Token Format:**
- Tokens stored as plain strings in `flutter_secure_storage` (encryption handled by platform keystore)
- Token keys: `access_token`, `id_token`, `refresh_token` (snake_case, matching OIDC convention)
- No token parsing in storage layer — raw strings in, raw strings out

**Date/Time Format:**
- All timestamps in ISO 8601 strings from backend
- Dart `DateTime.parse()` for deserialization
- `DateTime.toIso8601String()` for serialization

### Communication Patterns

**State Update Pattern:**
- All auth state changes go through `AuthNotifier.state =`
- UI subscribes via `ref.watch(authProvider)` — rebuild on every state change
- No direct state mutation from outside `AuthNotifier`
- No `BuildContext` inside `AuthNotifier` (pure business logic)

**Error Communication:**
- Auth errors set `AuthState(status: AuthStatus.error, errorMessage: '...', retryable: true/false)`
- Network errors set `retryable: true` — UI shows retry button
- Auth errors (invalid_grant, invalid_client) set `retryable: false` — UI shows login button
- No exceptions thrown to UI layer — all errors captured as state

**Event Pattern:**
- `AppLifecycleState` → `AuthNotifier.didChangeAppLifecycleState()` → `validateTokens()`
- Deep link callback → `AuthNotifier.handleCallback()` → extract tokens → update state
- No event bus, no stream-based events — Riverpod state is the single source of truth

### Process Patterns

**Error Handling in Auth Flow:**
- Login failure: catch in `AuthNotifier.authorize()`, emit `AuthState.error(retryable: false)`
- Token refresh failure: catch in `AuthNotifier.refreshToken()`, emit `AuthState.unauthenticated` (triggers login screen)
- Network error during any auth operation: catch, emit `AuthState.error(retryable: true, errorMessage: 'Network unreachable')`
- 401 from API: interceptor catches, triggers refresh, retries once. If refresh fails → logout → login screen

**Loading State Handling:**
- Login: `AuthState(status: AuthStatus.unauthenticated)` until tokens arrive — no explicit loading state. The OIDC browser flow handles its own UI.
- Token refresh: silent, non-blocking. UI does not show refresh loading indicator.
- Logout: immediate `AuthState.unauthenticated` — `Future.wait` runs in background

**Logging Pattern:**
- Auth failures logged at WARN level with structured fields: `error_code`, `keycloak_endpoint`, `http_status`, `network_reachable`, `timestamp`
- No tokens or PII in logs
- NFR9 requires 30-day log retention accessible via device diagnostics — `dart:developer log()` does not persist and is stripped in release builds
- **Implementation note:** Use a lightweight persistent logging package (e.g., `logger` with a `FileOutput` sink, or `talker` with file persistence) that writes to app-local storage with automatic rotation/retention. Logs are written to a file in the app's documents directory, readable via `adb shell run-as` or device file transfer for diagnostics.

### Enforcement Guidelines

**All AI Agents MUST:**
- Follow the three-state auth machine (`authenticated`, `unauthenticated`, `error`) — no additional states
- Use `TokenStorage` abstraction — never access `flutter_secure_storage` directly from business logic
- Use Riverpod providers for dependency injection — `NotifierProvider` with `ref.watch()` in `build()` for notifiers, plain `Provider` for dependencies — no manual service locator or `getIt`
- Store tokens only via `TokenStorage.saveTokens()` — no scattered `SharedPreferences` or file writes
- Use `http.BaseClient` override pattern for the auth interceptor — no middleware pattern
- Follow the flavor config system — no runtime URL construction from user input
- Never add `badCertificateCallback` back to `main.dart`
- Never log tokens, refresh tokens, or id tokens

**Pattern Enforcement:**
- `analysis_options.yaml` enables `lints` and `flutter_lints` packages
- CI runs `flutter analyze` on every PR
- CI runs `flutter test` on every PR (Android emulator)
- Manual review checklist for auth-related PRs (token handling, error states, logout flow)

## Project Structure & Boundaries

### Complete Project Directory Structure

```
mobile/genie_ai_mobile/
├── lib/
│   ├── config/
│   │   ├── keycloak_config.dart          # KeycloakConfig data class + getConfig()
│   │   ├── dev_config.dart               # Dev environment config
│   │   ├── staging_config.dart           # Staging environment config
│   │   ├── e2e_config.dart               # E2E test environment config
│   │   └── flavors/
│   │       └── itu.dart                  # ITU production deployment flavor
│   ├── services/
│   │   ├── auth/
│   │   │   ├── auth_notifier.dart        # Notifier<AuthState> — login, refresh, logout, lifecycle
│   │   │   ├── auth_state.dart           # AuthStatus enum + AuthState class
│   │   │   ├── auth_providers.dart       # authProvider + tokenStorageProvider declarations
│   │   │   └── token_storage.dart        # Abstract TokenStorage + SecureTokenStorage + InMemoryTokenStorage
│   │   ├── keycloak/
│   │   │   └── keycloak_service.dart     # Keycloak end_session_endpoint call + OIDC discovery
│   │   ├── api_service.dart              # MODIFIED — AuthInterceptor (http.BaseClient override)
│   │   ├── user_service.dart             # MODIFIED — consume auth state for user profile
│   │   ├── genie_ai_config.dart          # EXISTING — keep (non-sensitive runtime config)
│   │   └── *_proxy.dart                  # EXISTING — keep (domain proxies)
│   ├── components/
│   │   ├── auth/                         # DELETE — login_screen.dart, register_screen.dart, password_reset_*.dart
│   │   ├── chat/                         # EXISTING — keep
│   │   ├── settings/                     # EXISTING — keep
│   │   ├── shared/                       # EXISTING — keep
│   │   ├── sidebar/                      # EXISTING — keep
│   │   └── user/                         # EXISTING — keep
│   ├── src/                              # EXISTING — app shell, localization, settings
│   ├── utils/                            # EXISTING — theme utilities
│   └── main.dart                         # MODIFIED — remove badCertificateCallback, add ProviderScope, deep link handler
├── test/
│   ├── services/
│   │   ├── auth/
│   │   │   ├── auth_notifier_test.dart   # Unit tests — login, refresh, logout, lifecycle, error states
│   │   │   ├── auth_state_test.dart      # Unit tests — state transitions, equality
│   │   │   └── token_storage_test.dart   # Unit tests — save, get, delete, InMemoryTokenStorage
│   │   └── keycloak/
│   │       └── keycloak_service_test.dart # Unit tests — end_session, discovery
│   ├── helpers/
│   │   └── mocks/
│   │       ├── mock_token_storage.dart   # Mock TokenStorage for all auth tests
│   │       └── mock_api_service.dart     # Mock ApiService for interceptor tests
│   └── config/
│       └── keycloak_config_test.dart     # Unit tests — getConfig() for each flavor
├── assets/config/                        # EXISTING — runtime JSON config (non-sensitive only)
├── android/
│   └── app/src/main/AndroidManifest.xml  # MODIFIED — add deep link intent filter per flavor
├── ios/
│   └── Runner/Info.plist                 # MODIFIED — add URL scheme per flavor
├── pubspec.yaml                          # MODIFIED — add flutter_appauth, flutter_secure_storage, flutter_riverpod, app_links; remove shared_preferences, crypto
└── analysis_options.yaml                 # EXISTING — ensure lint rules cover auth patterns
```

### Architectural Boundaries

**API Boundaries:**
- Mobile → Backend: All API calls go through `ApiService` with `AuthInterceptor`. Bearer token injected automatically. Backend expects Keycloak access token in `Authorization` header.
- Mobile → Keycloak: OIDC flows via `flutter_appauth` (system browser). Logout via direct HTTP to `end_session_endpoint`. No mobile → Keycloak admin API.
- No mobile → ArangoDB, no mobile → Redis — all data access through backend API.

**Component Boundaries:**
- `services/auth/` owns all auth logic — no auth code in UI widgets or other services
- `services/keycloak/` owns Keycloak-specific HTTP calls (end_session, discovery) — separated from generic auth logic for testability
- `config/` owns build-time configuration — no runtime config fetching for sensitive values
- UI components (`components/`) consume auth state via `ref.watch(authProvider)` — never call auth methods directly

**Service Boundaries:**
- `AuthNotifier` is the single entry point for auth operations — UI calls `ref.read(authProvider.notifier).login()`, never touches `TokenStorage` or `ApiService` directly
- `ApiService` is the single HTTP client — all `*_proxy.dart` consume it. `AuthInterceptor` wraps it transparently.
- `TokenStorage` is the single storage abstraction — all token persistence goes through it

### Requirements to Structure Mapping

**FR Category → Implementation Location:**

| FR Category | Files | Notes |
|---|---|---|
| Authentication (FR1-FR4) | `services/auth/auth_notifier.dart`, `services/keycloak/keycloak_service.dart` | OIDC + PKCE via flutter_appauth, logout via Future.wait |
| Session Management (FR5-FR8) | `services/auth/auth_notifier.dart`, `services/api_service.dart` | Refresh in notifier, 401 retry in interceptor |
| Token Storage (FR9-FR11) | `services/auth/token_storage.dart` | Abstract + Secure + InMemory |
| Error Handling (FR12-FR14) | `services/auth/auth_state.dart` | AuthState.error with retryable flag |
| Account Recovery (FR15-FR16) | Deep link handler in `main.dart`, Keycloak browser | URL scheme routing, no app interception |
| Multi-Deployment (FR17-FR19) | `config/` directory, `pubspec.yaml` | Build-time flavors |
| Deep Link Config (FR20-FR21) | `android/.../AndroidManifest.xml`, `ios/.../Info.plist`, `main.dart` | Custom URL scheme per flavor |
| OIDC Config (FR22) | `services/keycloak/keycloak_service.dart` | Runtime discovery from .well-known |
| Security (FR23-FR25) | `main.dart`, `services/auth/token_storage.dart` | Remove badCertificateCallback, secure storage only |
| Deployment Docs (FR26-FR28) | `docs/` (new) | Deployment guide |
| Testing (FR29-FR31) | `test/` directory | Unit tests in Dart, integration on Android |

**Cross-Cutting Concerns:**
- Security: `token_storage.dart` (secure storage), `main.dart` (TLS), logging policy (no tokens/PII)
- State machine consistency: `auth_state.dart` + `auth_notifier.dart` — single source of truth
- Observability (NFR9): structured logging in `auth_notifier.dart`, WARN level for auth failures
- Accessibility (NFR10): UI widgets consuming auth state must follow platform accessibility guidelines

### Integration Points

**Internal Communication:**
- `AuthNotifier` → `TokenStorage`: `ref.watch()` in `build()`
- `AuthNotifier` → `ApiService`: `ref.watch()` in `build()` via `apiServiceProvider`
- `AuthNotifier` → `KeycloakService`: `ref.watch()` in `build()`
- `AuthInterceptor` → `AuthNotifier`: reads tokens, triggers refresh
- UI → `AuthNotifier`: via `ref.watch(authProvider)` and `ref.read(authProvider.notifier)`

**External Integrations:**
- `flutter_appauth` → system browser → Keycloak `/authorize` → callback deep link → `AuthNotifier`
- `flutter_secure_storage` → platform keystore (Android) / Keychain (iOS)
- Backend API → expects Keycloak access token, returns JWKS-validated responses
- Keycloak → token endpoint for refresh, end_session_endpoint for logout

**Data Flow:**
```
Login: flutter_appauth → system browser → Keycloak authorize
       → deep link callback → AuthNotifier.handleCallback()
       → TokenStorage.saveTokens() → validate tokens
       → state = AuthState.authenticated

API Call: *_proxy → ApiService → AuthInterceptor (inject Bearer)
          → Backend (JWKS validation) → Response

401:      AuthInterceptor catches 401 → AuthNotifier.refreshToken()
          → TokenStorage.getRefreshToken() → Keycloak /token
          → TokenStorage.saveTokens() → retry request

Logout:   AuthNotifier.logout()
          → Future.wait([POST /api/auth/logout, Keycloak end_session]) (each with catchError)
          → TokenStorage.deleteAll() (with catchError)
          → state = AuthState.unauthenticated
```

## Architecture Validation Results

### Coherence Validation

**Decision Compatibility:**
- Riverpod + Notifier + TokenStorage abstraction: coherent stack. Notifier holds business logic, TokenStorage provides injectable persistence, Riverpod wires dependencies. No conflicts.
- `flutter_appauth` + system browser + custom URL scheme: standard OIDC mobile pattern. `flutter_appauth` handles PKCE, browser redirect, and callback extraction. Compatible with Android intent filters and iOS URL schemes.
- `flutter_secure_storage` + `shared_preferences` removal: `flutter_secure_storage` uses `EncryptedSharedPreferences` on Android — drop-in replacement. No feature regression.
- AuthInterceptor (http.BaseClient override) + existing proxy pattern: `ApiService` is already the shared HTTP client. Adding `AuthInterceptor` as a wrapping `BaseClient` preserves the existing `*_proxy.dart` consumption pattern without changes to downstream proxies.

**Pattern Consistency:**
- Naming follows Dart conventions (snake_case files, PascalCase classes, camelCase members)
- Provider naming follows Riverpod conventions (`*Provider` suffix for declarations, `*Notifier` for Notifiers)
- State update pattern is consistent: all changes through `AuthNotifier.state =`, all reads through `ref.watch(authProvider)`
- Error handling is consistent: all auth errors become `AuthState.error`, no exceptions leak to UI

**Structure Alignment:**
- `services/auth/` encapsulates all auth logic — matches the existing `services/` pattern
- `config/` is new but follows Flutter convention for build-time configuration
- `test/` mirrors `lib/` structure — standard Dart test organization
- Legacy removal (`components/auth/`, `auth_proxy.dart`, `password_proxy.dart`) doesn't break existing features — these are auth-only files

### Requirements Coverage Validation

**Functional Requirements Coverage:**

| FR | Covered By | Status |
|---|---|---|
| FR1-FR4 (Authentication) | flutter_appauth + AuthNotifier + KeycloakService | Covered |
| FR5-FR8 (Session) | AuthNotifier.refreshToken() + AuthInterceptor | Covered |
| FR9-FR11 (Token Storage) | TokenStorage abstraction + flutter_secure_storage | Covered |
| FR12-FR14 (Error Handling) | AuthState.error + retryable flag | Covered |
| FR15-FR16 (Account Recovery) | Deep link handler + Keycloak browser | Covered |
| FR17-FR19 (Multi-Deployment) | lib/config/ flavor system | Covered |
| FR20-FR21 (Deep Links) | Custom URL scheme per flavor + Universal Links / App Links | Covered |
| FR22 (OIDC Discovery) | KeycloakService runtime discovery | Covered |
| FR23-FR25 (Security) | Secure storage + TLS enforcement + no PII in logs | Covered |
| FR26-FR28 (Deployment Docs) | docs/ deployment guide | Covered (implementation step) |
| FR29-FR31 (Testing) | test/ with InMemoryTokenStorage + mock ApiService | Covered |

**Non-Functional Requirements Coverage:**

| NFR | Covered By | Status |
|---|---|---|
| NFR1-NFR3 (Performance) | Silent refresh, no loading UI for login, < 1s state transition | Addressed (runtime verification needed) |
| NFR4-NFR6 (Reliability) | Error terminal states, no > 10s loading, state recalculation | Covered |
| NFR7-NFR8 (Compatibility) | Binary size increase estimate (3 new deps), data preservation | Addressed (build verification needed) |
| NFR9 (Observability) | Persistent logging with file output, structured auth failure fields, 30-day retention | Addressed (logging package selection needed at implementation) |
| NFR10 (Accessibility) | Platform guidelines in UI widgets | Addressed (implementation guidance) |

### Implementation Readiness Validation

**Decision Completeness:**
- All critical decisions documented with rationale
- Technology versions specified (latest stable for flutter_appauth, flutter_secure_storage, flutter_riverpod 3.0, app_links 6.3.3)
- Implementation patterns comprehensive enough for AI agents
- Concrete code examples provided for all major patterns (state machine, token storage, interceptor, logout, providers, config)

**Structure Completeness:**
- Complete project tree with all new/modified/deleted files
- All integration points specified
- Requirements mapped to specific files
- No ambiguous file locations

**Pattern Completeness:**
- All potential conflict points addressed (naming, structure, format, communication, process)
- Naming conventions cover all Dart/Riverpod patterns used
- Error handling pattern covers all auth error scenarios
- Loading state pattern defined (minimal — OIDC browser handles login UI)

### Gap Analysis Results

**No Critical Gaps Found.**

**Important Gaps (addressed in implementation, not architecture):**
1. Specific `flutter_appauth` configuration for PKCE — standard API, documented in package docs. No architectural decision needed.
2. Keycloak client configuration details (refresh token rotation, client scopes) — deployment guide will specify. Architecture specifies the requirement.
3. E2E test infrastructure — Android CI only, no iOS. Documented constraint from project context.
4. Persistent logging package selection — architecture specifies the requirement (file-based, 30-day retention), package choice is an implementation detail.
5. Account management migration — `SettingsComponent` currently uses `PasswordProxy` and `UserService.hashPassword()` for password change/delete flows. These legacy flows are replaced by Keycloak's account console (same pattern as web frontend). No custom app screens needed for account management post-migration.

**Nice-to-Have Gaps (deferred):**
1. Biometric auth as an additional factor — not in PRD scope
2. Token revocation list checking — not in PRD scope
3. Offline mode with cached auth state — not in PRD scope

### Peer Review Corrections Applied

The following issues were identified through adversarial and edge-case review and corrected in this document:

1. **Logout `Future.wait` bug** — `Future.wait` throws on any future failure, preventing `deleteAll()` from running. Fixed: each call wrapped with `.catchError((_) {})`.
2. **Request body consumption on retry** — `http.BaseRequest` is single-use; retrying the same object fails. Fixed: clone request before first send via `request.cloneStream()`.
3. **Retry 401 not handled** — if the retried request also returns 401, no logout was triggered. Fixed: check retry response status, logout + throw if 401.
4. **`Completer<void>` didn't propagate refresh result** — waiting callers re-read storage after a failed refresh. Fixed: changed to `Completer<String?>` that carries the refresh result or `null`.
5. **Test naming used Jest syntax** — `it()` / `describe()` → `test()` / `group()` for Dart.
6. **`dart:developer log()` doesn't persist** — contradicts NFR9 30-day retention. Fixed: specified persistent file-based logging requirement.
7. **Data flow showed spurious `unauthenticated` state** after `saveTokens()`. Fixed: direct transition to `authenticated`.
8. **`KeycloakService` missing from provider graph** — no `keycloakServiceProvider`. Fixed: added to D5 providers.
9. **`WidgetsBindingObserver` registration/disposal missing** — would leak or never fire. Fixed: added `addObserver` in `build()`, `removeObserver` in `ref.onDispose()`.
10. **`saveTokens()` atomicity claim** — `flutter_secure_storage` has no transactions. Fixed: documented limitation and mitigation (JSON blob or startup validation).
11. **FR21 deferral contradicted PRD MVP** — Universal Links listed as MVP in PRD but were deferred in architecture. Fixed: reverted deferral, FR21 stays in MVP scope with implementation notes for server-side file requirements.
12. **Riverpod 2.x → 3.0 migration** — `StateNotifier` / `StateNotifierProvider` are deprecated in Riverpod 3.0. Fixed: migrated all code examples to `Notifier<AuthState>` / `NotifierProvider<AuthNotifier, AuthState>(AuthNotifier.new)` pattern with `ref.watch()` in `build()` for dependency injection and `ref.onDispose()` for cleanup. Also replaced `uni_links` (unmaintained) with `app_links` (^6.3.3) for deep link handling — `AppLinks()` singleton with `uriLinkStream`.

### Architecture Completeness Checklist

**Requirements Analysis**
- [x] Project context thoroughly analyzed
- [x] Scale and complexity assessed (High — brownfield migration, multi-deployment)
- [x] Technical constraints identified (iOS dev constraints, existing backend, no code generation)
- [x] Cross-cutting concerns mapped (security, white-label, state machine, cross-platform, backend alignment, observability)

**Architectural Decisions**
- [x] Critical decisions documented (D1-D6) with rationale and code examples
- [x] Technology stack fully specified (flutter_appauth, flutter_secure_storage, flutter_riverpod 3.0, app_links)
- [x] Integration patterns defined (token passthrough, OIDC PKCE, interceptor)
- [x] Performance considerations addressed (silent refresh, no loading UI, Completer mutex)

**Implementation Patterns**
- [x] Naming conventions established (Dart + Riverpod + test)
- [x] Structure patterns defined (brownfield layout, test mirroring)
- [x] Communication patterns specified (state updates, error propagation, logging)
- [x] Process patterns documented (error handling, loading states, lifecycle)

**Project Structure**
- [x] Complete directory structure defined (all new/modified/deleted files)
- [x] Component boundaries established (auth/, config/, keycloak/)
- [x] Integration points mapped (dependency injection, data flow)
- [x] Requirements to structure mapping complete (all 31 FRs, all 10 NFRs)

### Architecture Readiness Assessment

**Overall Status:** READY FOR IMPLEMENTATION

**Confidence Level:** High — all critical decisions made with rationale, all FRs/NFRs covered, patterns prevent AI agent conflicts, brownfield constraints respected, backend unchanged.

**Key Strengths:**
- Token passthrough alignment with existing web architecture — zero backend changes
- Injectable TokenStorage makes entire auth stack testable without platform dependencies
- Completer mutex prevents concurrent refresh race conditions
- Three-state machine covers all UI scenarios without over-engineering
- Flavor system supports white-label multi-deployment without code generation tooling

**Areas for Future Enhancement:**
- Biometric authentication as additional factor
- iOS CI pipeline (currently best-effort, Android primary)

### Implementation Handoff

**AI Agent Guidelines:**
- Follow all architectural decisions exactly as documented
- Use implementation patterns consistently across all components
- Respect project structure and boundaries — no auth code outside `services/auth/`
- Refer to this document for all architectural questions
- Never re-introduce `badCertificateCallback`, `shared_preferences`, or plaintext token storage

**First Implementation Priority:**
1. `pubspec.yaml` — add dependencies (flutter_appauth, flutter_secure_storage, flutter_riverpod, app_links), remove (shared_preferences, crypto) in Epic 6
2. `services/auth/token_storage.dart` — abstract class + implementations (5-method interface with `getAccessTokenExpiration()`)
3. `services/auth/auth_state.dart` — enum + class (three-state machine)
4. `services/auth/auth_notifier.dart` — core logic (`Notifier<AuthState>` with `ref.watch()` in `build()`, expiresIn-based expiration, no JWT parsing)
5. `services/auth/auth_providers.dart` — Riverpod wiring (`NotifierProvider<AuthNotifier, AuthState>(AuthNotifier.new)`)
6. `services/api_service.dart` — add AuthInterceptor (`Completer<String?>` mutex, `http.BaseClient` override)
7. `config/` — flavor system (gradle productFlavors + iOS XCConfig + `--flavor`)
8. `main.dart` — ProviderScope, remove badCertificateCallback, deep link handler (`AppLinks()` singleton)
9. `configs/keycloak/genie-realm.yaml` — add mobile client via keycloak-config-cli (env vars: `KC_MOBILE_CLIENT_ID`, `KC_MOBILE_REDIRECT_SCHEME`)
10. Legacy removal — delete auth screens, auth_proxy.dart, password_proxy.dart (Epic 6, after all consumers migrated)
11. Tests — unit tests for all auth components (flutter_appauth + flutter_secure_storage mocked via TokenStorage interface)
