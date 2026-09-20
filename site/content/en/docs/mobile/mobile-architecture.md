---
title: "Mobile Architecture"
description: "Architecture of the GENIE.AI Flutter mobile app: layers, state, security, and platform integration."
weight: 2
section: "mobile"
mode: explanation
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

## Overview

The GENIE.AI mobile app (`mobile/genie_ai_mobile/`) is a Flutter client that wraps the public-sector RAG stack behind OIDC-authenticated chat. It targets Android and iOS phones, builds in release mode through Flutter flavors (dev / staging / e2e / itu), and exchanges every backend call through an `AuthInterceptor` that injects a Keycloak-issued Bearer token.

This document is the developer entry point. It covers how the app is layered, how state is managed, how authentication works at the wire level, and where to look in the source tree. Operational deployment is in [Mobile Deployment Guide](/docs/mobile/mobile-deployment-guide/); the user-facing UI surface is in [UI Component Inventory](/docs/mobile/ui-component-inventory-mobile/); end-user authentication behaviour is in [User Authentication](/docs/mobile/user-authentication/); chat streaming and feedback are in [Chat Pipeline](/docs/mobile/chat-pipeline/).

## 1. Tech stack

| Category | Library | Version | Where used |
|----------|---------|---------|------------|
| Language / framework | Dart / Flutter | SDK `^3.10.8` (`pubspec.yaml:10`) | All app code |
| State management | `flutter_riverpod` | `^3.0.0` | `lib/services/auth/auth_providers.dart`, all screens |
| HTTP | `http` | `^1.6.0` | `ApiClient` base, OpenAPI generated client |
| Secure storage | `flutter_secure_storage` | `^8.1.0` | `TokenStorage` (Keychain on iOS, EncryptedSharedPreferences on Android) |
| OIDC | `flutter_appauth` | local fork (`pubspec.yaml:28-29`) | `KeycloakService` |
| Markdown rendering | `flutter_markdown` | `^0.7.7` | Chat message bubbles |
| PDF export | `pdf` / `printing` | `^3.11.1` / `^5.13.1` | "Export PDF" action in chat |
| Connectivity | `connectivity_plus` | `^7.0.0` | `ConnectivityService`, offline banner |
| Deep links | `app_links` | `^6.3.3` | Universal/App Links handlers |
| Logging | `talker`, `talker_flutter` | `^4.5.0` | Structured `auth_logger.dart` events |
| OpenAPI client | generated Dart | `path: openapi_client` | `lib/api/` — regenerated from backend JSDoc |

The OpenAPI client (`openapi_client/`) is **auto-generated** from the backend JSDoc annotations and is checked in. Regenerate with `./scripts/generate-api-client.sh` (see `mobile/genie_ai_mobile/CLAUDE.md`).

> **Local flutter_appauth fork** — `pubspec.yaml:28-29` references a vendored fork at `flutter_appauth/flutter_appauth/`. The fork exists to work around an upstream `InsecureConnectionBuilder` issue (tracked as `flutter_appauth` upstream issue #386). The fork is **development-only**: revert the `path:` override and drop the `flutter_appauth/` directory before any merge to `main` — production uses CA-signed certs and `allowInsecureConnections=false`.

## 2. Application layers

The app follows a five-layer split that maps to directories under `mobile/genie_ai_mobile/lib/`:

| Layer | Directory | Responsibility | Public surface (example) |
|-------|-----------|----------------|--------------------------|
| Configuration | `lib/config/` | Flavor switching, Keycloak / backend URLs | `KeycloakConfig`, `getConfig()` |
| Services | `lib/services/` | Domain logic, secure storage, HTTP, OIDC | `AuthNotifier`, `KeycloakService`, `ConnectivityService` |
| Providers | `lib/providers/` | Riverpod wiring of services and API clients | `authenticatedApiProvider`, `authProvider` |
| Components | `lib/components/` | Self-contained UI widgets | `ChatBotComponent`, `SidebarComponent`, `OidcLoginScreen` |
| Design system | `lib/design_system/` | Tokens, primitives, theme | `DsButton`, `appTheme.dart` |

Composition root lives in `lib/main.dart` (root widget `MyApp`, multi-provider scope). The `lib/src/app.dart` file is a Flutter project-template leftover (uses `SettingsController`, hardcodes a 3-locale list `[en, de, ar]`, references `sample_feature/` and `settings/` views) and is **not** wired into the running app — see [UI Component Inventory](/docs/mobile/ui-component-inventory-mobile/) for the same "unused at runtime" note.

> The codebase does **not** use a Proxy/Service-Provider pattern at the service layer. Domain classes (`UserService`, `ConnectivityService`, `KeycloakService`) are plain Dart classes; cross-cutting concerns (auth headers, logging, error classification) are wired by Riverpod providers and the `AuthInterceptor`, not by service proxies.

## 3. API layer

### Provider wiring (`lib/providers/api_providers.dart`)

Riverpod exposes one provider per backend API domain. Each provider constructs a generated API client that shares the same authenticated `http.Client` injected by `AuthInterceptor`. Example shape (paraphrased from `api_providers.dart`):

```dart
final authenticatedApiProvider = Provider<ApiClient>((ref) {
  final config = getConfig();
  final tokenStorage = ref.watch(tokenStorageProvider);
  final client = config.allowInsecureConnections
      ? InsecureHttpClient()
      : http.Client();
  final interceptor = AuthInterceptor(
    inner: client,
    tokenStorage: tokenStorage,
    onRefreshToken: () => ref.read(authProvider.notifier).refreshToken(),
    logger: ref.read(authLoggerProvider),
  );
  return ApiClient(basePath: config.backendUrl)..client = interceptor;
});
```

This keeps the surface small and lets tests override a single provider.

### Backend routes the app calls

Verified against `components/gov-chat-backend/routes/`:

| Route | Method | Auth | Used for |
|-------|--------|------|----------|
| `/api/queries/stream` | POST | yes | SSE chat streaming (see [Chat Pipeline](/docs/mobile/chat-pipeline/)) |
| `/api/queries/` | POST | yes | Non-streaming chat fallback |
| `/api/queries/:id/feedback` | POST | yes | Per-message feedback submission |
| `/api/queries/:id/conversation` | POST | yes | Save conversation (title + messages) |
| `/api/me` | GET / PUT | yes | Profile read / update |
| `/api/me/reset-data` | POST | yes | Wipe per-user state (pre-delete) |
| `/api/me/delete` | POST | yes | Self-service account deletion |
| `/api/auth/logout` | POST | yes | Backend-side session invalidation |

For full request/response shapes, error codes, and pagination, see [API Contracts (backend)](/docs/backend/api-contracts-backend/) — that document is the source of truth.

## 4. State management (Riverpod)

### Provider layout (`lib/services/auth/auth_providers.dart`)

| Provider | Type | Owns |
|----------|------|------|
| `tokenStorageProvider` | `Provider<TokenStorage>` | `flutter_secure_storage`-backed token persistence |
| `authLoggerProvider` | `Provider<AuthLogger>` | Structured auth event logging |
| `keycloakServiceProvider` | `Provider<KeycloakService>` | OIDC discovery + token endpoints |
| `appAuthProvider` | `Provider<AppAuth>` | flutter_appauth wrapper |
| `authenticatedApiProvider` | `Provider<ApiClient>` | Authenticated HTTP client with `AuthInterceptor` (in `lib/providers/api_providers.dart`) |
| `authProvider` | `NotifierProvider<AuthNotifier, AuthState>` | Top-level auth state machine |
| `connectivityCheckerProvider` | `Provider<ConnectivityChecker>` | Network state |

### `AuthNotifier` lifecycle (`lib/services/auth/auth_notifier.dart`)

`AuthNotifier` is the single authority for the auth state machine. The lifecycle has five entry points:

1. **`init()`** — runs at app startup. Reads `flutter_secure_storage`, validates stored tokens, sets `AuthState` to `authenticated` if still valid, `unauthenticated` otherwise.
2. **`authorize()`** — kicked off by the OIDC login screen. Discovers Keycloak via OIDC metadata, opens the system browser via `flutter_appauth`, exchanges the PKCE-verified authorization code for tokens, and persists them.
3. **`refreshTokens()`** — called transparently when a backend call returns 401 (see [User Authentication](/docs/mobile/user-authentication/) for the single-flight mutex).
4. **`didChangeAppLifecycleState(state)`** — wired to Flutter's `WidgetsBindingObserver`. When `state == AppLifecycleState.resumed` and the user is authenticated, runs `validateTokens()` (proactive expiry check on resume).
5. **`logout()`** — fires the parallel logout sequence (see [User Authentication](/docs/mobile/user-authentication/)).

`_FailedOperation` enum (`auth_notifier.dart:41`) tracks which operation last failed, so the UI can resume after a retry instead of asking the user to re-authorize.

### AuthState (`lib/services/auth/auth_state.dart`)

```dart
enum AuthStatus { authenticated, unauthenticated, error }

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

  const AuthState.authenticated({this.userId, this.displayName})
    : status = AuthStatus.authenticated,
      errorMessage = null,
      retryable = false;

  const AuthState.unauthenticated()
    : status = AuthStatus.unauthenticated,
      userId = null,
      displayName = null,
      errorMessage = null,
      retryable = false;

  AuthState.error({required String message, this.retryable = false})
    : status = AuthStatus.error,
      userId = null,
      displayName = null,
      errorMessage = message;
}
```

Widgets read `authProvider` and switch on `state.status`; the `retryable` flag controls whether a "Retry" button is shown.

## 5. Networking and SSE

### `AuthInterceptor` (`lib/services/auth/auth_interceptor.dart`)

A `BaseClient` wrapper that:

- **On `onRequest`**: reads the access token from `TokenStorage` and adds `Authorization: Bearer <token>`.
- **On `onResponse`**: if the backend returns 401, attempts one transparent refresh, then retries the original request once. If the retry still fails with 401, throws `AuthException` so the UI can surface "Session expired".

The refresh step is **single-flight**: while one refresh is in flight, parallel 401s wait on the same `Completer<TokenSet?>` rather than each issuing their own refresh call. This prevents Keycloak's refresh-token rotation from invalidating a just-rotated token.

### SSE parsing (`lib/services/sse_parser.dart`)

For the `/api/queries/stream` endpoint, the response is a text/event-stream. `SseParser` chunks the byte stream and emits five typed events (verbatim from `sse_parser.dart:6-11`):

| Event class | JSON `type` field | Payload | Triggered by |
|-------------|-------------------|---------|--------------|
| `SseChunkEvent` | `chunk` | `content: string` | Each incremental LLM token |
| `SseMetadataEvent` | `metadata` | source docs, confidence score | Backend finalises retrieval |
| `SseTranslationEvent` | `translation` | `content: string` | Streaming translation swap ([issue #829](https://opensource.unicc.org/un/itu/genie-ai/-/issues/829)) |
| `SseDoneEvent` | `done` | `queryId: string` | Stream complete |
| `SseErrorEvent` | `error` | `message: string` | Backend stream-level error |

The full taxonomy and downstream propagation are documented in [Chat Pipeline](/docs/mobile/chat-pipeline/).

## 6. Security features

| Feature | Implementation | Reference |
|---------|----------------|-----------|
| **OIDC PKCE (S256)** | `flutter_appauth` with `codeVerifier` + `codeChallenge`; no client secret (public client, RFC 8252) | `KeycloakService.authorize()` |
| **Secure token storage** | `flutter_secure_storage` — iOS Keychain / Android `EncryptedSharedPreferences` | `TokenStorage` (`services/auth/token_storage.dart`) |
| **Transparent refresh** | `AuthInterceptor` single-flight refresh on 401 | `services/auth/auth_interceptor.dart` |
| **RP-initiated logout** | `end_session_endpoint` call with `id_token_hint` + backend `/api/auth/logout` + `flutter_secure_storage.deleteAll()` | `auth_notifier.dart#logout()` |
| **Lifecycle-aware validation** | `WidgetsBindingObserver.didChangeAppLifecycleState` → `validateTokens()` on resume | `auth_notifier.dart:564` |
| **Custom URL scheme gating** | OIDC callback uses `<redirectScheme>://callback` registered through `RedirectUriReceiverActivity` (Android) / `CFBundleURLSchemes` (iOS); isolated from HTTPS traffic | AndroidManifest.xml, `Info.plist` |
| **Dev-only insecure HTTP client** | `insecure_http_client.dart` is **never used in production**; gated by `allowInsecureConnections` flag in flavor config | `lib/services/auth/insecure_http_client.dart` |

> **SSL pinning** is not implemented in production builds. The custom HTTP client (`insecure_http_client.dart`) is a development convenience for self-signed certificates on local Keycloak. Production relies on the system trust store (CA-signed certs).

For the user-visible flow of these features — login screen tap, browser handover, refresh on 401, logout sequence, error classes — see [User Authentication](/docs/mobile/user-authentication/).

## 7. i18n

| Item | Value |
|------|-------|
| Shipped locales | 14 — `ar, bn, zh, en, fr, de, id, man, pt, ru, st, es, sw, th` |
| Source of truth | `lib/i18n/locales/<code>.dart` (one file per locale) |
| Active set per flavor | `KeycloakConfig.supportedLocaleCodes` (defaults to `allSupportedLocaleCodes`; e.g. `el-salvador` restricts to `['en','es']`) |
| Selection at runtime | `LanguageSelector` (`components/shared/language_selector.dart`) → `i18n_service.dart` |
| Fallback | `fallback_localizations.dart` resolves missing keys to English |

> Deployment-level locale whitelist is **config-driven**, not file-presence-driven — all 14 locale files stay in the source. A flavor restricts the active set via `KeycloakConfig.supportedLocaleCodes`.

## 8. Cross-cutting services

| Service | Purpose | When it fires |
|---------|---------|--------------|
| `ConnectivityService` | Reactive online/offline state | Drives the offline banner and gates retry logic |
| `ConnectivityChecker` | Thin wrapper around `connectivity_plus` for HTTP error classification | Used inside `NetworkErrorClassifier` |
| `NetworkErrorClassifier` | Distinguishes retryable (timeout, DNS) from terminal (TLS, 4xx) errors | `AuthInterceptor` error path |
| `NotificationService` | In-app toast/event bus driven by a broadcast StreamController. Push notifications are not currently wired. | Drives in-app success/error/info/warning toasts |
| `GenieAIConfig` | Reads `assets/config/genie-ai-config.json` (institution-specific service list, taxonomy) | Loaded at startup; drives Quick Help buttons |
| `FallbackLocalizations` | Resolves missing translation keys to English | `i18n_service.dart` lookups |

## 9. Project layout

For the complete annotated directory tree — including the design system, providers, utils, and locale files — see [UI Component Inventory](/docs/mobile/ui-component-inventory-mobile/). The single most important contract for contributors: **never edit `openapi_client/` by hand** — regenerate it with `./scripts/generate-api-client.sh` from the backend JSDoc.

## 10. Next steps

- **Shipping a build**: see [Mobile Deployment Guide](/docs/mobile/mobile-deployment-guide/) — covers flavor creation, Android signing, iOS provisioning, App Links, and store submission.
- **End-user auth behaviour**: see [User Authentication](/docs/mobile/user-authentication/) — covers the PKCE flow, refresh-on-401, error classes, and logout sequence.
- **Chat UX**: see [Chat Pipeline](/docs/mobile/chat-pipeline/) — covers SSE event flow, feedback dialog, Quick Help overlay, PDF export.
- **Per-widget API**: see [UI Component Inventory](/docs/mobile/ui-component-inventory-mobile/).
- **Contributor workflows**: see `mobile/genie_ai_mobile/CLAUDE.md` — OpenAPI regeneration, emulator SSL setup, E2E tests.
