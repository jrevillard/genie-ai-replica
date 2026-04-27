---
stepsCompleted: ['step-01-validate-prerequisites', 'step-02-design-epics', 'step-03-create-stories', 'step-04-final-validation']
status: complete
inputDocuments:
  - '_bmad-output/planning-artifacts/prd.md'
  - '_bmad-output/planning-artifacts/architecture.md'
  - '_bmad-output/planning-artifacts/validation-prd.md'
---

# genie-ai - Epic Breakdown

## Overview

This document provides the complete epic and story breakdown for genie-ai Mobile OIDC Migration, decomposing the requirements from the PRD, UX Design if it exists, and Architecture requirements into implementable stories.

## Requirements Inventory

### Functional Requirements

- FR1: A user can sign in to the app using their institution's Keycloak credentials via the device system browser
- FR2: A user can complete the Authorization Code + PKCE flow without the app handling their credentials directly
- FR3: A user who already has an active Keycloak session in their device browser is automatically authenticated (SSO) without re-entering credentials
- FR4: A user can sign out, which clears local tokens and terminates the Keycloak session via the OIDC logout endpoint
- FR5: The app silently refreshes the access token using the refresh token when the access token expires, without user interaction, and stores the new refresh token returned by Keycloak
- FR6: The app checks token validity when the app returns to foreground (AppLifecycleState.resumed) and transitions to the login screen if the refresh token has expired
- FR7: The app detects when a token refresh fails (expired refresh token or revoked session) and transitions to the login screen with an explanatory message
- FR8: The app detects when an API call returns 401 and attempts a silent token refresh before falling back to the login screen
- FR9: The app stores authentication tokens (access token, refresh token, ID token) in the platform secure storage
- FR10: The app provides an auth state service that exposes the current authentication state (authenticated/unauthenticated), valid access token, and user identity claims to downstream consumers
- FR11: The app automatically includes a valid access token as a Bearer token in the Authorization header of all API requests to the backend
- FR12: The app displays a "No internet connection" message within 500ms of network loss detection during login, token refresh, or API calls
- FR13: The app recovers gracefully from a deep link callback failure (network timeout, lost packet) and allows the user to retry the login flow
- FR14: The app displays a specific error state with a user-facing message and a recovery action within 2 seconds of any authentication operation failure, and never remains in an indefinite loading state for more than 10 seconds without user feedback
- FR15: A user can reset their password by tapping "Forgot password" on the Keycloak login page in the system browser
- FR16: A password reset link received by email opens the Keycloak password reset flow in the system browser (not intercepted by the app)
- FR17: Each institutional deployment has its own dedicated build with a unique app ID, Keycloak client, backend URL, and deep link scheme — all configured at build-time
- FR18: Each deployment has its own Keycloak client configured for secure mobile authentication with no client secret in the app binary
- FR19: A deployment operator can create a new deployment by following the documented guide (copy flavor template, create Keycloak client, build, test, ship)
- FR20: The app registers a custom URL scheme per deployment for the OIDC authorization callback
- FR21: The app handles incoming cryptographic domain-verified deep links for password reset and email verification
- FR22: The app discovers OIDC endpoints (authorization, token, userinfo, end_session) from the identity provider's standard discovery document using the Keycloak URL configured at build-time
- FR23: The app enforces valid TLS certificate validation for all network connections (no certificate bypass)
- FR24: The app removes all legacy authentication code (custom login endpoints, password hashing, plaintext password handling)
- FR25: The app does not store authentication tokens, credentials, or PII in plaintext storage or logs
- FR26: The deployment guide documents the complete process for onboarding a new institutional deployment (deployment configuration, Keycloak client creation, deep link setup, build, test)
- FR27: The deployment guide documents the network prerequisites for air-gapped deployments (device must reach Keycloak on internal network, DNS configuration)
- FR28: The deployment guide documents the OS version policy trade-off (technical minimums vs. institutional security policies)
- FR29: Unit tests cover the core auth logic (token refresh, session validation, error handling) in platform-agnostic code
- FR30: Integration tests cover the login, token refresh, logout, and error scenarios on Android
- FR31: The test suite runs in CI on Android for continuous validation

### NonFunctional Requirements

- NFR1: Silent token refresh completes within 2 seconds for 95th percentile under normal network conditions, measured by automated integration test recording wall-clock time from refresh initiation to completion over 100 runs on a reference network (50ms RTT, 10Mbps)
- NFR2: The login screen is displayed within 1 second of app launch when no valid session exists, measured by platform startup time instrumentation (cold start)
- NFR3: The app processes the OIDC callback and establishes an authenticated session within 1 second of receiving the deep link redirect from the system browser, measured by timestamp delta between deep link intent received and auth state updated
- NFR4: All authentication error states display a user-visible error message and a recovery action (retry button or return to login) within 2 seconds of error detection. The app transitions to one of three defined states after any auth error: login screen, error screen with retry, or authenticated screen. Verified by automated UI tests triggering each error condition and asserting message visibility within 2 seconds
- NFR5: After any authentication error, the app is in one of three defined terminal states (login screen, error screen with recovery action, or authenticated screen). The app never remains in an intermediate loading state for more than 10 seconds without user feedback. Verified by state machine unit tests covering all error transitions
- NFR6: The auth state service recalculates state on every token operation. An expired or invalid token immediately triggers a state transition to unauthenticated. Verified by unit tests asserting no combination of expired token + authenticated state is possible
- NFR7: The app binary size increase from the OIDC migration is less than 8MB per platform (Android APK, iOS IPA) compared to the pre-migration build, measured by comparing release build output sizes before and after migration
- NFR8: 100% of non-authentication user data (conversation history, preferences, cached content) is preserved across the app update, verified by pre/post update data comparison test on a reference device
- NFR9: Authentication failures (login, refresh, logout) are logged at WARN level with the following fields: error_code, keycloak_endpoint, http_status, network_reachable, timestamp. Logs are accessible via device diagnostics (adb logcat / Xcode console) for 30 days. Verified by automated test injecting auth failures and asserting log output contains all required fields
- NFR10: All authentication screens support platform-native accessibility features (VoiceOver on iOS, TalkBack on Android). All interactive elements have accessibility labels. Minimum touch target size is 44x44 points (iOS) / 48x48dp (Android). Authentication state is not indicated by color alone. Verified by platform accessibility inspector tools (Accessibility Inspector on iOS, Accessibility Scanner on Android)

### Additional Requirements

From Architecture document:

- **Token passthrough architecture** — No GENIE.AI JWT issued. Keycloak tokens validated directly at backend via JWKS, JIT provisioning by {iss}#{sub}, downstream headers (X-User-Id, X-User-Roles, X-Issuer). Mobile sends raw Keycloak access token as Bearer token. Zero or minimal backend changes expected.
- **Riverpod as state management** — `flutter_riverpod` ^3.0.0 for reactive state. NotifierProvider for auth and future reactive states. ProviderScope wraps the app in main.dart.
- **TokenStorage injectable abstraction** — Abstract class with SecureTokenStorage (prod, flutter_secure_storage) and InMemoryTokenStorage (test). Constructor injection for testability without platform dependencies. Atomicity via single JSON blob or startup validation.
- **Auth state machine — 3 states** — `AuthStatus { authenticated, unauthenticated, error }` with `AuthState` class containing userId, displayName, errorMessage, retryable flag. No initial state, no retryCount.
- **AuthInterceptor (http.BaseClient override)** — Bearer token injection + 401→refresh→retry with single retry. Completer<String?> mutex for concurrent refresh serialization. Request cloning before first send (BaseRequest single-use).
- **Logout via Future.wait** — Parallel calls to POST /api/auth/logout (backend) and Keycloak end_session_endpoint (direct), each individually wrapped in .catchError. deleteAll() runs regardless. No backend changes required.
- **Flavor config system** — lib/config/ directory with KeycloakConfig data class + getConfig(). Environment configs (dev, staging, e2e) at config/ root. Deployment flavors in config/flavors/ (e.g., itu.dart). Selected via --dart-define=FLAVOR=<name> at build time. No code generation (no flavorizr, no build_runner).
- **AppLifecycle integration** — WidgetsBindingObserver on AuthNotifier. validateTokens() on AppLifecycleState.resumed (non-blocking, silent). addObserver in constructor, removeObserver via ref.onDispose().
- **Deep link dual mechanism** — Custom URL scheme per flavor for OIDC callback (genieai://callback). Universal Links (iOS) / App Links (Android) for password reset — requires server-side files (apple-app-site-association, assetlinks.json) on each deployment's Keycloak domain.
- **flutter_secure_storage replaces shared_preferences entirely** — EncryptedSharedPreferences on Android, Keychain on iOS. Remove shared_preferences dependency.
- **Persistent file-based logging** — NFR9 requires 30-day retention. dart:developer log() does not persist and is stripped in release builds. Use lightweight persistent logging package with FileOutput sink, automatic rotation/retention.
- **Account management migration** — SettingsComponent password change/delete flows replaced by Keycloak account console (same pattern as web frontend). No custom app screens needed for account management post-migration.
- **No starter template** — Brownfield project. Existing codebase at mobile/genie_ai_mobile/ evolves. Legacy auth components deleted, new auth services added.
- **Implementation sequence** — (1) TokenStorage, (2) AuthState, (3) AuthNotifier, (4) Riverpod providers, (5) AuthInterceptor, (6) AppLifecycle + deep link, (7) Flavor config, (8) Legacy removal, (9) badCertificateCallback removal.

### FR Coverage Map

| FR | Epic | Description |
|----|------|-------------|
| FR1 | Epic 1 | Sign in via system browser |
| FR2 | Epic 1 | Authorization Code + PKCE |
| FR3 | Epic 1 | SSO with active Keycloak session |
| FR4 | Epic 2 | Logout (local + Keycloak end_session) |
| FR5 | Epic 2 | Silent token refresh |
| FR6 | Epic 3 | Token check on foreground resume |
| FR7 | Epic 2 | Detect refresh failure → login screen |
| FR8 | Epic 2 | 401 → silent refresh → login fallback |
| FR9 | Epic 1 | Secure token storage (platform keystore) |
| FR10 | Epic 2 | Auth state service for downstream consumers |
| FR11 | Epic 2 | Bearer token auto-injection on API calls |
| FR12 | Epic 3 | Network error message within 500ms |
| FR13 | Epic 3 | Deep link callback failure recovery |
| FR14 | Epic 3 | Error state with recovery action within 2s |
| FR15 | Epic 5 | Password reset via Keycloak browser |
| FR16 | Epic 5 | Deep link routing for password reset |
| FR17 | Epic 4 | Dedicated build per deployment |
| FR18 | Epic 4 | Keycloak client per deployment (public, PKCE) |
| FR19 | Epic 4 | Documented deployment onboarding guide |
| FR20 | Epic 4 | Custom URL scheme per deployment |
| FR21 | Epic 5 | Universal Links / App Links for password reset |
| FR22 | Epic 1 | OIDC discovery from .well-known/openid-configuration |
| FR23 | Epic 6 | TLS certificate enforcement (remove badCertificateCallback) |
| FR24 | Epic 6 | Legacy auth code removal |
| FR25 | Epic 1 | No tokens/PII in plaintext storage or logs |
| FR26 | Epic 4 | Deployment guide (config, Keycloak client, deep links, build, test) |
| FR27 | Epic 4 | Air-gapped deployment network prerequisites |
| FR28 | Epic 4 | OS version policy trade-off documentation |
| FR29 | Epic 6 | Unit tests for auth logic (platform-agnostic Dart) |
| FR30 | Epic 6 | Integration tests on Android |
| FR31 | Epic 6 | CI test suite on Android |

## Epic List

### Epic 1: Secure Keycloak Login
A user can sign in to the app using their institution's Keycloak credentials via the system browser. Tokens are stored securely in the platform keystore.
**FRs covered:** FR1, FR2, FR3, FR9, FR22, FR25
**Depends on:** None (foundation epic)

### Epic 2: Persistent Authenticated Session
A user stays logged in across token expiry (silent refresh), API calls are automatically authenticated (Bearer token), and the user can sign out completely (local + Keycloak session).
**FRs covered:** FR4, FR5, FR7, FR8, FR10, FR11
**Depends on:** Epic 1

### Epic 3: Reliable Auth Experience
A user sees clear error messages when auth fails, the app recovers gracefully from network issues, and background sessions are validated on resume.
**FRs covered:** FR6, FR12, FR13, FR14
**Depends on:** Epic 2

### Epic 4: Institutional Deployment
Each institution gets its own branded build with a dedicated Keycloak client, deep link scheme, and app store presence. Deployment operators can onboard new institutions following a documented guide.
**FRs covered:** FR17, FR18, FR19, FR20, FR26, FR27, FR28
**Depends on:** Epic 1, Epic 2

### Epic 5: Account Recovery & Deep Links
A user can reset their password via the Keycloak browser. Password reset and email verification links open correctly in the system browser (not intercepted by the app).
**FRs covered:** FR15, FR16, FR21
**Depends on:** Epic 1

### Epic 6: Legacy Removal & Security Hardening
The app is cleaned of all legacy authentication code, enforces valid TLS certificates, and has comprehensive auth tests running in CI.
**FRs covered:** FR23, FR24, FR29, FR30, FR31
**Depends on:** Epic 1, Epic 2

<!-- Repeat for each epic in epics_list (N = 1, 2, 3...) -->

## Epic 1: Secure Keycloak Login

A user can sign in to the app using their institution's Keycloak credentials via the system browser. Tokens are stored securely in the platform keystore.

### Story 1.1: Secure Token Storage Foundation

As a mobile app,
I want a secure token storage abstraction backed by the platform keystore,
So that authentication tokens are encrypted at rest and the auth stack is fully testable without platform dependencies.

**Acceptance Criteria:**

**Given** the app dependencies are configured
**When** `flutter_secure_storage`, `flutter_appauth`, `flutter_riverpod`, and `app_links` are added to `pubspec.yaml`
**Then** all packages resolve successfully with `flutter pub get`
**And** `shared_preferences` and `crypto` remain in `pubspec.yaml` (removed later in Epic 6)

**Given** the `TokenStorage` abstract class is implemented
**When** `SecureTokenStorage.saveTokens()` is called with accessToken, idToken, refreshToken, and expiresIn
**Then** all values are stored as a single JSON blob under one key (`auth_tokens`) in the platform keystore
**And** `expiresIn` is stored as the calculated absolute expiration date (`DateTime.now().add(Duration(seconds: expiresIn))`)

**Given** `SecureTokenStorage` has stored tokens
**When** `getAccessToken()`, `getIdToken()`, `getRefreshToken()`, or `getAccessTokenExpiration()` is called
**Then** the corresponding value is returned from the stored JSON blob

**Given** tokens are stored
**When** `deleteAll()` is called
**Then** the `auth_tokens` key is removed from the platform keystore

**Given** `InMemoryTokenStorage` is used in tests
**When** tokens are saved and retrieved
**Then** the behavior is identical to `SecureTokenStorage` but without platform dependencies
**And** all unit tests pass without requiring a device emulator

**Given** `deleteAll()` fails due to keystore unavailability
**When** the error is caught
**Then** it does not propagate — the error is silently handled (per architecture: `deleteAll().catchError`)

### Story 1.2: Auth State Machine & Flavor Configuration

As a mobile app,
I want a reactive auth state machine and build-time flavor configuration,
So that the app can represent authentication status and connect to the correct Keycloak instance per environment.

**Acceptance Criteria:**

**Given** the `AuthStatus` enum is defined
**When** the app checks auth status
**Then** exactly three states exist: `authenticated`, `unauthenticated`, `error`
**And** no `initial` state and no `retryCount` field exist

**Given** the `AuthState` class is defined
**When** an auth state is created
**Then** it contains `status` (AuthStatus), `userId` (String?), `displayName` (String?), `errorMessage` (String?), and `retryable` (bool)

**Given** `getConfig()` is called
**When** `FLAVOR` is `dev` (default)
**Then** the dev config is returned with dev Keycloak URL, dev client ID, dev backend URL, and dev redirect scheme

**Given** `getConfig()` is called
**When** `FLAVOR` is `itu`
**Then** the ITU production flavor config is returned with production values

**Given** `getConfig()` is called
**When** `FLAVOR` is `staging`
**Then** the staging config is returned with staging values

**Given** `getConfig()` is called
**When** `FLAVOR` is `e2e`
**Then** the e2e test config is returned with e2e test values

**Given** `FLAVOR` is set via `--dart-define=FLAVOR=<name>`
**When** the app is built
**Then** `String.fromEnvironment` resolves at compile time and unused flavor configs are tree-shaken

**Given** two `AuthState` instances with identical fields
**When** they are compared
**Then** they are equal (implement `==` and `hashCode`)

**Given** an `AuthState` with `status: AuthStatus.error` and `retryable: true`
**When** the UI reads the state
**Then** it can display a retry button (network error scenario)

**Given** an `AuthState` with `status: AuthStatus.error` and `retryable: false`
**When** the UI reads the state
**Then** it displays a login button (invalid_grant scenario)

### Story 1.3a: Keycloak Login via System Browser

As a user,
I want to sign in to the app using my institution's Keycloak credentials via the system browser,
So that I can authenticate securely without the app handling my password directly.

**Acceptance Criteria:**

**Given** `KeycloakService` is initialized with a `KeycloakConfig`
**When** `discoverEndpoints()` is called
**Then** the OIDC endpoints (authorization, token, userinfo, end_session) are fetched from `{keycloakUrl}/.well-known/openid-configuration`
**And** the discovered endpoints are cached for subsequent calls

**Given** `KeycloakService.discoverEndpoints()` fails (network error, invalid URL)
**When** the error is caught
**Then** an `AuthState(status: AuthStatus.error, retryable: true, errorMessage: 'Network unreachable')` is emitted

**Given** the user taps "Sign in"
**When** `AuthNotifier.authorize()` is called
**Then** `flutter_appauth` opens the system browser (ASWebAuthenticationSession on iOS, Chrome Custom Tabs on Android) to the Keycloak authorization endpoint
**And** the PKCE code_verifier and code_challenge are generated automatically
**And** the redirect URI matches the custom URL scheme from the flavor config

**Given** the user authenticates successfully in the system browser
**When** Keycloak redirects back to the app via the custom URL scheme with an authorization code
**Then** `flutter_appauth` exchanges the code for tokens at the token endpoint
**And** the access token, ID token, and refresh token are saved via `TokenStorage.saveTokens()`
**And** the `expiresIn` from `TokenResponse` is stored as an absolute expiration date
**And** the auth state transitions to `AuthState(status: AuthStatus.authenticated, userId: <sub>, displayName: <name>)`
**And** SSO works automatically — if the user already has an active Keycloak session in the browser, they are authenticated without re-entering credentials (FR3)

**Given** the user cancels the login in the system browser
**When** `flutter_appauth` returns a cancellation error
**Then** the auth state transitions to `AuthState(status: AuthStatus.unauthenticated)` — no error, just back to login

**Given** `Riverpod` providers are configured
**When** `authProvider` is read
**Then** it returns a `NotifierProvider<AuthNotifier, AuthState>(AuthNotifier.new)`
**And** `tokenStorageProvider` injects `SecureTokenStorage`
**And** `keycloakServiceProvider` injects `KeycloakService` with the flavor config

**Given** the app starts
**When** `ProviderScope` wraps the app in `main.dart`
**Then** all providers are available to the widget tree via `ref.watch()` and `ref.read()`

**Given** `AuthNotifier` is initialized
**When** tokens exist in `TokenStorage` from a previous session and the access token has not expired
**Then** the auth state is set to `authenticated` (the user is silently logged in)

**Given** `AuthNotifier` is initialized
**When** tokens exist in `TokenStorage` but the access token is expired
**Then** `validateTokens()` attempts a silent refresh
**And** if refresh succeeds, the state is `authenticated`; if it fails, the state is `unauthenticated`

**Given** `AuthNotifier` is initialized
**When** no tokens exist in `TokenStorage`
**Then** the auth state remains `unauthenticated`

### Story 1.3b: Custom URL Scheme Registration

As a mobile app,
I want the custom URL scheme registered on Android and iOS,
So that `flutter_appauth` can receive the OIDC callback from Keycloak after authentication.

**Note:** `flutter_appauth` v11 handles the OIDC callback entirely internally via native AppAuth SDKs (`RedirectUriReceiverActivity` on Android, auto-registration on iOS). No `app_links` integration or manual deep link handling is needed for OIDC. The `DeepLinkHandler` service (using `app_links`) is deferred to Epic 5 when non-OIDC deep links are needed.

**Acceptance Criteria:**

**Given** the app is built with a specific flavor
**When** `build.gradle` defines `appAuthRedirectScheme` in `manifestPlaceholders`
**Then** `flutter_appauth`'s `RedirectUriReceiverActivity` is configured with the correct custom URL scheme (e.g., `com.itu.genieai.dev`)

**Given** the app is built with a specific flavor
**When** `Info.plist` is configured
**Then** the custom URL scheme (e.g., `com.itu.genieai.dev`) is registered under `CFBundleURLTypes`

**Given** the user completes authentication in the system browser
**When** Keycloak redirects to `{redirectScheme}://callback?code=...`
**Then** `flutter_appauth` intercepts the callback, exchanges the authorization code for tokens, and `AuthNotifier.authorize()` completes successfully
**And** the auth state transitions to `AuthState.authenticated()`

### Story 1.4: Login Screen UI & Accessibility

As a user,
I want a clean login screen with a "Sign in" button that opens Keycloak in the system browser,
So that I can authenticate and see my auth status clearly.

**Acceptance Criteria:**

**Given** the user is not authenticated
**When** the app launches
**Then** the login screen is displayed within 1 second of cold start (NFR2)

**Given** the login screen is displayed
**When** the user sees the screen
**Then** the institution's branding (logo, app title) from `GenieAiConfig` is displayed
**And** a "Sign in" button is visible with a minimum touch target of 48x48dp (NFR10)

**Given** the user taps "Sign in"
**When** the button is pressed
**Then** `ref.read(authProvider.notifier).authorize()` is called
**And** the system browser opens with the Keycloak login page

**Given** the login screen is displayed
**When** an accessibility scanner runs (TalkBack/VoiceOver)
**Then** all interactive elements have semantic labels
**And** the sign-in button is announced correctly
**And** auth status is not indicated by color alone (NFR10)

**Given** authentication fails
**When** `authProvider` emits `AuthState(status: AuthStatus.error)`
**Then** the error message is displayed on the login screen
**And** a recovery action is shown (retry button if retryable, or "Sign in" button if not retryable)

**Given** the user is already authenticated (tokens in storage, not expired)
**When** the app launches
**Then** the login screen is skipped and the user sees the authenticated UI directly

**Given** the login screen is displayed
**When** no tokens, credentials, or PII appear in debug logs
**Then** FR25 is satisfied — no sensitive data in logs (NFR9 partial — full persistent logging deferred to Epic 2)

## Epic 2: Persistent Authenticated Session

A user stays logged in across token expiry (silent refresh), API calls are automatically authenticated (Bearer token), and the user can sign out completely (local + Keycloak session).

### Story 2.0: Persistent Auth Logging Infrastructure

As a mobile app,
I want a persistent file-based logging system for authentication events,
So that auth failures can be diagnosed from device logs for 30 days without requiring a live connection.

**Acceptance Criteria:**

**Given** the logging package is added to dependencies
**When** the app initializes
**Then** a log file is created in the app's documents directory with automatic rotation

**Given** an authentication failure occurs
**When** the failure is logged
**Then** the log entry contains: `error_code`, `keycloak_endpoint`, `http_status`, `network_reachable`, `timestamp`
**And** no tokens, refresh tokens, ID tokens, or PII appear in the log output

**Given** logs have accumulated over time
**When** 30 days have passed since a log entry
**Then** that entry is automatically rotated/deleted (NFR9)

**Given** a developer needs to read auth logs
**When** they run `adb shell run-as` or transfer the log file from the device
**Then** the log file is readable in a structured format

### Story 2.1: Silent Token Refresh & Logout

As a user,
I want my session to persist across token expiry without re-entering my credentials, and to be able to sign out completely from both the app and Keycloak,
So that I stay logged in seamlessly and my session is fully terminated when I choose to sign out.

**Acceptance Criteria:**

**Given** the user is authenticated with a valid access token and refresh token
**When** the access token expires (detected via stored `expiresIn` date comparison)
**Then** `AuthNotifier.refreshToken()` exchanges the refresh token for new tokens at the Keycloak token endpoint
**And** the new tokens and new `expiresIn` are saved via `TokenStorage.saveTokens()`
**And** the auth state remains `authenticated` — no user interruption

**Given** `AuthNotifier.refreshToken()` succeeds
**When** the new token pair is saved
**Then** the old refresh token is replaced (Keycloak refresh token rotation)

**Given** `AuthNotifier.refreshToken()` fails (expired refresh token or revoked session)
**When** the Keycloak token endpoint returns an error
**Then** the auth state transitions to `AuthState(status: AuthStatus.unauthenticated, errorMessage: 'Your session has expired. Please sign in again.')` (FR7)
**And** the failure is logged via the persistent logging infrastructure (NFR9)

**Given** the auth state is recalculated after any token operation
**When** a token becomes expired or invalid
**Then** the state immediately transitions to `unauthenticated` — no stale `authenticated` state possible (NFR6)

**Given** the user taps "Sign out"
**When** `AuthNotifier.logout()` is called
**Then** `POST /api/auth/logout` and `KeycloakService.endSession(idTokenHint: idToken)` fire in parallel via `Future.wait`, each wrapped in `.catchError((_) {})`
**And** `TokenStorage.deleteAll()` runs regardless of upstream failures
**And** the auth state transitions to `unauthenticated` (FR4)
**And** the logout operation is logged via the persistent logging infrastructure (NFR9)

**Given** `KeycloakService.endSession()` fails
**When** the backend logout succeeds but Keycloak logout fails
**Then** tokens are deleted locally, state is `unauthenticated`, failure is logged

**Given** the user taps "Sign in" immediately after logging out
**When** the system browser opens Keycloak
**Then** the login page is displayed — the user is not automatically re-authenticated

### Story 2.2: AuthInterceptor & ApiService Refactor

As a user,
I want all my API calls to the backend to be automatically authenticated with a valid token,
So that I can use all app features without manually managing tokens.

**Acceptance Criteria:**

**Given** the user is authenticated
**When** any API call is made through `ApiService`
**Then** the `AuthInterceptor` injects the access token as a `Bearer` token in the `Authorization` header (FR11)

**Given** an API call returns HTTP 401
**When** the `AuthInterceptor` catches the 401
**Then** it triggers `AuthNotifier.refreshToken()` via the `Completer<String?>` mutex
**And** if refresh succeeds, the original request is retried with the new token — only one retry (FR8)

**Given** concurrent API calls all receive 401 simultaneously
**When** the first 401 triggers a token refresh
**Then** subsequent 401s await the same `Completer<String?>` — no parallel refreshes
**And** a test with a mock slow refresh verifies that all concurrent requests receive the same result

**Given** the retried request also returns 401
**When** the second 401 is detected
**Then** `AuthNotifier.logout()` is triggered and `AuthException('Session expired')` is thrown

**Given** `http.BaseRequest` is sent
**When** a 401 is received
**Then** the request is cloned via `request.cloneStream()` before the first send — the retry uses the clone

**Given** the existing `ApiService` singleton
**When** the refactor is complete
**Then** the singleton pattern is removed
**And** `baseUrl` is configurable via `KeycloakConfig.backendUrl`
**And** `ApiService` accepts `http.Client` as constructor parameter

**Given** `setToken()`, `clearToken()`, and `getHeaders()` exist in `ApiService`
**When** the refactor is complete
**Then** these methods are marked `@Deprecated` with a comment referencing Epic 6 removal
**And** they remain functional to preserve compilation of `user_service.dart`, `auth_proxy.dart`, and `file_proxy.dart`

**Given** `file_proxy.dart` calls `_api.getHeaders()` for multipart uploads
**When** the AuthInterceptor is active
**Then** `file_proxy.dart` continues to work unchanged — migration deferred to Epic 6

**Given** all existing `print()` calls in `ApiService`
**When** the refactor is complete
**Then** they are replaced with the persistent logging infrastructure (NFR9)

**Given** a test needs to bypass the `AuthInterceptor`
**When** `ApiService` is constructed with a mock `http.Client`
**Then** requests are sent without Bearer token injection

**Given** the complete auth flow is in place (login + refresh + interceptor)
**When** the OIDC callback is received and tokens are exchanged
**Then** the authenticated session is established within 1 second of receiving the deep link (NFR3)

## Epic 3: Reliable Auth Experience

A user sees clear error messages when auth fails, the app recovers gracefully from network issues, and background sessions are validated on resume.

### Story 3.1: AppLifecycle Token Validation

As a user,
I want my session to be validated when I return to the app after being in the background,
So that I am not stuck with an expired session and see the login screen promptly if needed.

**Acceptance Criteria:**

**Given** the user has the app in the background for an extended period
**When** the app returns to foreground (`AppLifecycleState.resumed`)
**Then** `AuthNotifier.didChangeAppLifecycleState()` triggers `validateTokens()` silently

**Given** `validateTokens()` runs on resume
**When** the access token is still valid (stored `expiresIn` date is in the future)
**Then** no UI change occurs — the user sees the authenticated interface immediately (NFR4)

**Given** `validateTokens()` runs on resume
**When** the access token has expired (stored `expiresIn` date is in the past) but the refresh token is valid
**Then** a silent refresh is triggered — the user sees no interruption
**And** the auth state remains `authenticated` after refresh (FR6)

**Given** `validateTokens()` runs on resume
**When** the refresh token has also expired
**Then** `TokenStorage.deleteAll()` is called
**And** the auth state transitions to `AuthState(status: AuthStatus.unauthenticated)`
**And** the user sees the login screen with a message: "Your session has expired. Please sign in again." (FR6)

**Given** `AuthNotifier` is disposed
**When** the widget tree is torn down
**Then** `ref.onDispose()` calls `WidgetsBinding.instance.removeObserver(this)` — no memory leak, no stale lifecycle events

**Given** `AuthNotifier` is constructed
**When** initialization completes
**Then** `WidgetsBinding.instance.addObserver(this)` is called — lifecycle events are active

### Story 3.2: Network Error Detection & Recovery

As a user,
I want to see clear error messages when the network is unavailable during authentication,
So that I know what is happening and can take action without being stuck on a blank screen.

**Acceptance Criteria:**

**Given** the device has no network connectivity
**When** the user taps "Sign in"
**Then** the system browser fails to load the Keycloak login page
**And** the app displays a "No internet connection" message within 500ms of network loss detection (FR12)
**And** the error state has `retryable: true` — a retry button is displayed

**Given** the user taps "Retry" on a network error
**When** the network is still unavailable
**Then** the same error message is displayed again
**And** the app does not enter an infinite retry loop — the user must explicitly tap retry

**Given** the device regains network connectivity
**When** the user taps "Retry"
**Then** the sign-in flow resumes — the system browser opens Keycloak

**Given** the device has no network connectivity
**When** a token refresh is attempted
**Then** the refresh fails with a network error
**And** the auth state transitions to `AuthState(status: AuthStatus.error, retryable: true, errorMessage: 'No internet connection')` (FR12)

**Given** the device has no network connectivity
**When** any API call is made
**Then** the HTTP client reports an error
**And** the app shows an appropriate error state

### Story 3.3: Auth Error State Machine

As a user,
I want the app to always show me a clear state after any authentication error,
So that I am never stuck on a spinner or a blank screen.

**Acceptance Criteria:**

**Given** any authentication operation fails (login, refresh, logout, network error)
**When** the error is detected
**Then** a user-visible error message and a recovery action are displayed within 2 seconds (NFR4)

**Given** an authentication error occurs
**When** the app transitions to an error state
**Then** the app is in one of three defined terminal states: login screen, error screen with recovery action, or authenticated screen (NFR4)
**And** the app never remains in an intermediate loading state for more than 10 seconds without user feedback (NFR5)

**Given** an `AuthState(status: AuthStatus.error, retryable: true)`
**When** the error screen is displayed
**Then** a retry button is shown — tapping it re-triggers the failed operation

**Given** an `AuthState(status: AuthStatus.error, retryable: false)`
**When** the error screen is displayed
**Then** a "Sign in" button is shown — the user must start a new authentication flow

**Given** a deep link callback is received but fails mid-way (network timeout, lost packet)
**When** the app never receives the authorization code
**Then** the app remains on the login screen — not stuck on a spinner (FR13)
**And** the user can tap "Sign in" again — Keycloak SSO recognizes the active session and the callback succeeds on retry

**Given** the auth state machine
**When** all error transitions are tested
**Then** every possible error path ends in one of the three defined terminal states — verified by state machine unit tests (NFR5)

**Given** any authentication failure
**When** the failure is logged
**Then** the persistent logging infrastructure records the failure with structured fields (NFR9)

## Epic 4: Institutional Deployment

Each institution gets its own branded build with a dedicated Keycloak client, deep link scheme, and app store presence. Deployment operators can onboard new institutions following a documented guide.

### Story 4.1: Flutter Build Flavor System

As a deployment operator,
I want to create a new institutional deployment with a unique app ID, signing config, and build identity,
So that each institution has its own dedicated build for app store submission.

**Acceptance Criteria:**

**Given** the current app has no flavor system
**When** `build.gradle` is updated
**Then** `flavorDimensions` and `productFlavors` are configured with at least a `dev` and `itu` flavor
**And** each flavor defines a unique `applicationId` (e.g., `com.itu.genieai` for ITU, `com.example.genieai` for dev)

**Given** the iOS project
**When** XCConfig files are created per flavor
**Then** each flavor has a unique `PRODUCT_BUNDLE_IDENTIFIER`
**And** each flavor has its own build scheme in Xcode

**Given** the `itu` flavor is built for Android
**When** `flutter build apk --dart-define=FLAVOR=itu -t lib/config/flavors/itu.dart` runs
**Then** the APK has application ID `com.itu.genieai` and contains only the ITU config

**Given** the `itu` flavor is built for iOS
**When** `flutter build ipa --dart-define=FLAVOR=itu -t lib/config/flavors/itu.dart` runs
**Then** the IPA has bundle identifier `com.itu.genieai`

### Story 4.2: Dart Flavor Config & Keycloak Client Template

As a deployment operator,
I want a Keycloak OIDC client created automatically for each institutional deployment via keycloak-config-cli,
So that I don't have to manually configure clients in the Keycloak admin console.

**Acceptance Criteria:**

**Given** `genie-realm.yaml` is updated
**When** a mobile client section is added
**Then** it defines: `clientId: $(env:KC_MOBILE_CLIENT_ID)`, `publicClient: true`, `pkce.code.challenge.method: S256`, `client.credentials.use.refresh.token: true` (refresh token rotation), `standardFlowEnabled: true`, `directAccessGrantsEnabled: false`

**Given** the mobile client section in `genie-realm.yaml`
**When** `redirectUris` is configured
**Then** it uses `$(env:KC_MOBILE_REDIRECT_SCHEME)://callback` — the custom URL scheme from the environment

**Given** the operator adds `KC_MOBILE_CLIENT_ID` and `KC_MOBILE_REDIRECT_SCHEME` to the deployment `.env`
**When** `keycloak-config-cli` runs at container startup
**Then** the mobile OIDC client is created automatically in Keycloak with the correct configuration (FR18)

**Given** `lib/config/flavors/template.dart` exists
**When** a new institution needs a deployment
**Then** the template contains placeholder fields for: `keycloakUrl`, `clientId`, `redirectScheme`, `backendUrl`
**And** the `redirectScheme` in the Dart config matches `KC_MOBILE_REDIRECT_SCHEME` in the `.env`

**Given** `getConfig()` is called with any registered flavor
**When** the corresponding `KeycloakConfig` is returned
**Then** all fields are populated from the flavor's config file

### Story 4.3: Custom URL Scheme Per Deployment

As a mobile app,
I want to register a unique custom URL scheme per institutional deployment,
So that the OIDC callback is routed to the correct app instance on the device.

**Acceptance Criteria:**

**Given** the app is built with flavor `itu`
**When** the `AndroidManifest.xml` is generated
**Then** an intent filter is registered for the URL scheme matching `KC_MOBILE_REDIRECT_SCHEME` (e.g., `com.itu.genieai://callback`)

**Given** the app is built with flavor `itu`
**When** the `Info.plist` is generated
**Then** the URL scheme is registered under `CFBundleURLTypes` matching `KC_MOBILE_REDIRECT_SCHEME`

**Given** two different flavor builds are installed on the same device
**When** both apps register their respective URL schemes
**Then** the OIDC callback is routed to the correct app based on the scheme (FR20)

### Story 4.4: Deployment Onboarding Guide

As a deployment operator,
I want a comprehensive guide documenting the complete onboarding process,
So that I can create and publish a new deployment in under a day.

**Acceptance Criteria:**

**Given** the deployment guide exists
**When** an operator follows it
**Then** it covers: adding `KC_MOBILE_CLIENT_ID` and `KC_MOBILE_REDIRECT_SCHEME` to `.env`, copying and filling the flavor template, configuring build files (gradle/XCConfig), build commands, and testing steps (FR26)

**Given** the guide covers Keycloak client creation
**When** the operator adds the env vars and restarts keycloak-config-cli
**Then** the mobile client is created automatically with: public client, PKCE mandatory, refresh token rotation enabled, no client secret (FR18, FR19)

**Given** the guide covers the scheme coherence rule
**When** the operator configures a new deployment
**Then** it explicitly documents that `KC_MOBILE_REDIRECT_SCHEME` in `.env` must match `redirectScheme` in the Dart flavor config — mismatch causes callback failure

**Given** the guide covers air-gapped deployments
**When** the operator deploys in a restricted-network environment
**Then** it documents: device must reach Keycloak on internal network, local DNS configuration, no external dependency (FR27)

**Given** the guide covers OS version policy
**When** the operator reads the trade-off section
**Then** it documents: technical minimums (iOS 13+, Android 6.0+) vs institutional security policies, MDM enforcement recommendation (FR28)

**Given** the guide covers app store submission
**When** the operator is ready to publish
**Then** it documents: Google Play / Apple App Store requirements, signing certificate management, provisioning profiles per deployment

## Epic 5: Account Recovery & Deep Links

A user can reset their password via the Keycloak browser. Password reset and email verification links open correctly in the system browser (not intercepted by the app).

**Note:** Story 1.3b originally included a `DeepLinkHandler` service using `app_links` for deep link management. After architectural review (Party Mode), this was deferred to Epic 5 since no non-OIDC deep links exist in Epics 1-4. The `app_links` package (^6.3.3) remains in `pubspec.yaml` but is unused until this epic. The DeepLinkHandler implementation, `app_links` integration (`uriLinkStream`, `getInitialLink`), and `FlutterDeepLinkingEnabled=false` configuration will be added in Story 5.2 alongside Universal Links / App Links setup.

### Story 5.1: Password Reset via Keycloak Browser

As a user,
I want to reset my password by tapping "Forgot password" on the Keycloak login page,
So that I can regain access to my account without contacting an administrator.

**Acceptance Criteria:**

**Given** the user is on the Keycloak login page in the system browser
**When** they tap "Forgot password"
**Then** the Keycloak password reset flow is displayed — email input field, submit button (FR15)

**Given** the user submits their email on the password reset form
**When** Keycloak sends a reset link by email
**Then** the email contains a link to the Keycloak password reset page

**Given** the user taps the password reset link on their phone
**When** the deep link opens
**Then** it opens the Keycloak password reset flow in the **system browser** — not intercepted by the app (FR16)

**Given** the user completes the password reset in the browser
**When** they return to the app and tap "Sign in"
**Then** they can authenticate with their new password

**Given** the Keycloak login page is rendered
**When** "Forgot password" is not available (disabled by admin)
**Then** no "Forgot password" link is displayed — this is a Keycloak realm setting, not app-controlled

### Story 5.2: Universal Links & App Links for Password Reset

As a mobile app,
I want password reset and email verification links to open in the system browser via cryptographic domain verification,
So that these links are not intercepted by the app's custom URL scheme handler.

**Acceptance Criteria:**

**Given** the Keycloak domain hosts the required verification files
**When** `apple-app-site-association` is served at `https://<keycloak-domain>/.well-known/apple-app-site-association`
**Then** iOS recognizes the domain as verified and routes password reset links to the system browser instead of the app (FR21)

**Given** the Keycloak domain hosts the required verification files
**When** `assetlinks.json` is served at `https://<keycloak-domain>/.well-known/assetlinks.json`
**Then** Android recognizes the domain as verified and routes password reset links to the system browser instead of the app (FR21)

**Given** the deployment guide (Story 4.4)
**When** an operator reads the deep link configuration section
**Then** it documents: how to host `apple-app-site-association` and `assetlinks.json` on the Keycloak domain, the JSON structure for each file, and verification testing steps

**Given** a password reset email link is clicked on the device
**When** the link points to the Keycloak domain (e.g., `https://keycloak.itu.int/...`)
**Then** the system browser opens (not the app) — Universal Links / App Links take precedence over custom URL schemes

**Given** the OIDC callback deep link is received
**When** the URL matches the custom URL scheme (e.g., `com.itu.genieai://callback`)
**Then** the app intercepts it — custom URL schemes handle OIDC callbacks, Universal Links handle everything else

## Epic 6: Legacy Removal & Security Hardening

The app is cleaned of all legacy authentication code, enforces valid TLS certificates, and has comprehensive auth tests running in CI.

### Story 6.1: UserService Migration

As a mobile app,
I want the UserService to use the new auth system instead of legacy password hashing,
So that all API calls are authenticated through Keycloak tokens and legacy credential handling is eliminated.

**Acceptance Criteria:**

**Given** `user_service.dart` currently uses `crypto` for password hashing
**When** the migration is complete
**Then** `hashPassword()`, `login()`, `register()`, `updateEmail()`, `deactivateAccount()`, `deleteAccount()` are removed — all legacy auth methods (FR24)

**Given** the non-password methods in `user_service.dart`
**When** the migration is complete
**Then** `getCurrentUser()`, `getCurrentUserInfo()`, `getProfile()`, `refreshUserData()`, `updateAccountSettings()`, `resetUserData()`, `checkUsernameAvailability()`, `checkEmailAvailability()` are preserved and migrated

**Given** the migrated `user_service.dart`
**When** API calls are made
**Then** they rely on `AuthInterceptor` for Bearer token injection — `_api.setToken()` and `_api.clearToken()` calls are removed

**Given** `import 'package:crypto/crypto.dart'` in `user_service.dart`
**When** the migration is complete
**Then** the import is removed
**And** `grep -r "package:crypto" lib/` returns no results — `crypto` can be safely removed from `pubspec.yaml`

**Given** `api_service.dart` has `@Deprecated` methods (`setToken`, `clearToken`, `getHeaders`, `accessToken`) and a legacy `factory ApiService({AuthLogger? logger})` constructor from Story 2.2
**When** the migration is complete
**Then** all `@Deprecated` methods and the legacy factory constructor are removed
**And** `// TODO(epic-6)` grep markers are cleaned up
**And** `grep -r "TODO(epic-6)" lib/` returns no results

**Given** `file_proxy.dart` calls `_api.getHeaders()` for multipart uploads
**When** the migration is complete
**Then** `file_proxy.dart` is migrated to use `apiServiceProvider` (Riverpod) instead of `getHeaders()` for Bearer token injection

### Story 6.2: Legacy Auth Code Removal

As a mobile app,
I want all legacy authentication code to be removed,
So that there is zero legacy auth debt and no security vulnerabilities from the old system.

**Acceptance Criteria:**

**Given** the legacy auth files exist
**When** the removal is complete
**Then** `auth_proxy.dart` and `password_proxy.dart` are deleted (FR24)

**Given** the legacy auth screens exist
**When** the removal is complete
**Then** all files in `components/auth/` are deleted (login_screen.dart, register_screen.dart, password reset screens)

**Given** the legacy routes exist
**When** the removal is complete
**Then** routes `/register` and `/password-reset` (legacy) are removed from the navigation/routing

**Given** no legacy auth code remains
**When** `git grep` is run on legacy endpoints (`auth/login`, `auth/register`, `encPassword`)
**Then** no results are returned — zero legacy auth code (FR24)

### Story 6.3: LoginScreen Replacement & SharedPreferences Cleanup

As a mobile app,
I want the legacy login screen replaced by the OIDC login screen and all plaintext credentials cleared,
So that users authenticate securely and no sensitive data remains in insecure storage.

**Acceptance Criteria:**

**Given** the OIDC login screen was created in Story 1.4
**When** the legacy `login_screen.dart` is deleted
**Then** the OIDC login screen is the only login interface in the app

**Given** the legacy login screen stored passwords in plaintext via `SharedPreferences`
**When** the app launches for the first time after the update
**Then** `SharedPreferences` entries `savedLoginName` and `savedPassword` are cleared if they exist

**Given** `shared_preferences` is no longer used anywhere
**When** `grep -r "shared_preferences" lib/` returns no results
**Then** `shared_preferences` is removed from `pubspec.yaml`

**Given** `settings_service.dart` only references `shared_preferences` in comments
**When** the cleanup is complete
**Then** the comments are removed or updated — no dead references

### Story 6.4: TLS Enforcement

As a mobile app,
I want valid TLS certificate validation enforced on all network connections,
So that the app never connects to servers with invalid or self-signed certificates.

**Acceptance Criteria:**

**Given** `main.dart` currently contains a `badCertificateCallback` override
**When** the removal is complete
**Then** the `badCertificateCallback` is removed from `main.dart` (FR23)

**Given** a debug build needs to work with self-signed certificates
**When** the app runs in debug mode (`kDebugMode`)
**Then** a conditional bypass can be enabled for development — documented in the dev workflow

**Given** the app runs in release mode
**When** any HTTPS connection is made to a server with an invalid certificate
**Then** the connection is rejected — no bypass (FR23)

**Given** `flutter analyze` runs
**When** the codebase is checked
**Then** no TLS bypass code is detected in release paths

### Story 6.5: Auth Test Suite & CI

As a team,
I want comprehensive auth tests running in CI on Android,
So that every PR is validated against the auth flows automatically.

**Acceptance Criteria:**

**Given** the auth service layer
**When** unit tests run
**Then** they cover: TokenStorage (save, get, delete, InMemoryTokenStorage), AuthState (transitions, equality), AuthNotifier (login, refresh, logout, lifecycle, error states), KeycloakService (end_session, discovery), AuthInterceptor (Bearer injection, 401→refresh→retry, Completer mutex) (FR29)

**Given** the unit test suite
**When** `flutter test` runs in CI
**Then** auth service layer achieves minimum 80% line coverage (FR29)

**Given** an Android emulator in CI
**When** integration tests run
**Then** they cover: login happy path, silent token refresh, logout (local + Keycloak session termination), network error during login, deep link callback failure + retry, 401→refresh→login fallback chain (FR30)

**Given** the CI pipeline
**When** a PR is submitted
**Then** `flutter test` runs automatically on Android (FR31)

**Given** the state machine unit tests
**When** all error transitions are tested
**Then** every error path ends in one of three defined terminal states — no stale or intermediate states possible (NFR5, NFR6)

**Given** release builds before and after the migration
**When** binary sizes are compared
**Then** the size increase is less than 8MB per platform (NFR7)

**Given** a reference device with existing user data
**When** the app is updated
**Then** all non-authentication user data (conversation history, preferences, cached content) is preserved (NFR8)
