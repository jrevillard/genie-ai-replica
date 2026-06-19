---
title: 'Mobile Auth Infrastructure + OpenAPI Client Migration'
type: 'feature'
created: '2026-05-11'
status: 'done'
baseline_commit: '59656d8c'
---

## Intent

**Problem:** All API calls in the mobile app run without authentication. Every proxy creates a bare `ApiService()` — no Bearer token, no 401 retry. The backend migrated to `/api/me` (singleton, JWT-authenticated) but mobile still calls the old endpoints. 16 out of 19 files with API calls are broken.

**Approach:** The existing `AuthInterceptor` (http.BaseClient subclass) already implements Bearer injection + 401→refresh→retry with mutex. Reuse it as the HTTP client for the generated OpenAPI `ApiClient`. Create Riverpod providers that wire the generated API classes with this authenticated client. Migrate all API consumers (components + remaining services) to use the generated client classes via providers. Delete all proxies and `api_service.dart`.

## Boundaries & Constraints

**Always:**
- Use `package:http` (not dio) — `BaseClient` subclass is compatible with any future OpenAPI generator
- Never edit files under `lib/api/` — they are auto-generated and excluded from lint
- `AuthNotifier` owns token lifecycle (authorize/refresh/logout) — do not duplicate that logic elsewhere
- `TokenStorage` interface unchanged — the auth client reads tokens from it
- Components receive their API client via constructor injection (Riverpod providers), never instantiate API clients directly
- Reuse existing `AuthInterceptor` — it already has mutex, retry, body capture, and logging

**Ask First:**
- Whether endpoints missing from the OpenAPI spec (`/files/*`, `/labels/*`) should use raw `AuthInterceptor` directly or wait for backend spec update

**Never:**
- Add dio as a dependency
- Duplicate token refresh logic outside `AuthNotifier`
- Create custom HTTP methods in the generated client
- Create a second `AuthenticatedApiClient` — reuse `AuthInterceptor`

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Authenticated request | Valid token, not expired | Request sent with Bearer header, response returned | N/A |
| Token expired mid-session | Access token expired, refresh token valid | 401 caught → silent refresh → retry with new token → response returned | If refresh fails → `AuthException` thrown, AuthNotifier already transitions to unauthenticated (clears tokens) |
| Multiple concurrent 401s | 3 requests get 401 simultaneously | Only ONE refresh call made (mutex via `_refreshCompleter`), all 3 requests retry with the new token | Refresh failure → all 3 requests get `AuthException` |
| No stored tokens | User never logged in | No Bearer header sent | 401 propagated (no refresh attempted — `token == null` guard) |
| Network offline | No connectivity | Request fails with network error | Error surfaced to UI, connectivity service handles retry |
| Logout during refresh | User logs out while 401 refresh in progress | Refresh completes or fails, but AuthNotifier state is already `unauthenticated` | Token cleared by AuthNotifier.logout(), subsequent requests get no Bearer header |
| Retry also 401 | New token also rejected by server | `AuthException('Session expired after refresh')` thrown | AuthInterceptor does NOT retry again — single retry max (lines 60-68) |

## Code Map

### Existing code (reuse, do NOT modify)
- `lib/services/auth/auth_interceptor.dart` — http.BaseClient with Bearer injection, 401→refresh→retry, mutex (`_refreshCompleter`), body capture for retries, single-retry-max guard, `AuthException` on failure. **Already complete.**
- `lib/services/auth/auth_notifier.dart` — `refreshToken()` is already public. Already clears tokens on refresh failure, transitions to `unauthenticated`. Already logs out via Keycloak `end_session`. **Already complete.**
- `lib/services/auth/auth_providers.dart` — `apiServiceProvider` already creates `AuthInterceptor`-wrapped `ApiService`. **Keep for transition**, will be removed when all consumers migrate.
- `lib/services/auth/token_storage.dart` — token persistence. **Unchanged.**
- `lib/services/auth/auth_state.dart` — auth state model. **Unchanged.**
- `lib/services/auth/auth_logger.dart` — auth logging. **Unchanged.**

### New files
- `lib/providers/api_providers.dart` — Riverpod providers wiring generated OpenAPI API classes with `AuthInterceptor`

### Modified files (component migrations)
- `lib/components/user/user_profile_component.dart` — use `CurrentUserApi` instead of `UserProfileProxy`
- `lib/components/chat/chatbot_component.dart` — use `QueriesApi` + `ChatHistoryApi` via providers
- `lib/components/chat/right_sidebar_component.dart` — use `TranslationApi` via provider for translation; construct file view URLs with Bearer token from `TokenStorage` for `/files/{id}/view`
- `lib/components/sidebar/chat_folders_panel.dart` — use `ChatHistoryApi` via provider (replaces direct `ChatHistoryProxy()` instantiation)
- `lib/components/sidebar/service_tree_panel.dart` — use `ServiceCategoriesApi` + `ServicesApi` via providers (replaces direct `ServiceTreeProxy()` instantiation)
- `lib/services/user_service.dart` — migrate from `ApiService` to `CurrentUserApi` via provider (already uses `apiServiceProvider`, just swap to generated client)
- `lib/components/settings/settings_component.dart` — update `UserService` injection if constructor signature changes

### Deleted files
- `lib/services/user_profile_proxy.dart` — replaced by `CurrentUserApi`
- `lib/services/chatbot_proxy.dart` — replaced by `QueriesApi`
- `lib/services/chat_history_proxy.dart` — replaced by `ChatHistoryApi`
- `lib/services/analytics_proxy.dart` — replaced by `AnalyticsApi`
- `lib/services/service_tree_proxy.dart` — replaced by `ServiceCategoriesApi` + `ServicesApi`
- `lib/services/weather_proxy.dart` — replaced by `WeatherApi`
- `lib/services/admin_dashboard_proxy.dart` — replaced by `AdminApi`
- `lib/services/file_proxy.dart` — endpoints NOT in OpenAPI spec; file upload (MultipartRequest) and file URL construction will use `AuthInterceptor` + `TokenStorage` directly in calling components
- `lib/services/label_proxy.dart` — endpoints NOT in OpenAPI spec; will use `AuthInterceptor` directly if needed
- `lib/services/document_file_proxy.dart` — endpoints NOT in OpenAPI spec; will use `AuthInterceptor` directly if needed
- `lib/services/api_service.dart` — replaced by generated `ApiClient`

### Unchanged files (no API calls or already working)
- `lib/services/auth/token_storage.dart`
- `lib/services/auth/auth_state.dart`
- `lib/services/auth/auth_logger.dart`
- `lib/services/keycloak/keycloak_service.dart` — direct HTTP to Keycloak (not backend API)

## Complete File Inventory (23 files with API calls)

| # | File | Current Usage | Status | Action |
|---|------|--------------|--------|--------|
| 1 | `lib/services/api_service.dart` | Core HTTP layer | **Delete** | Replaced by generated `ApiClient` |
| 2 | `lib/services/admin_dashboard_proxy.dart` | Admin endpoints | **Delete** | → `AdminApi` |
| 3 | `lib/services/analytics_proxy.dart` | Analytics endpoints | **Delete** | → `AnalyticsApi` |
| 4 | `lib/services/chat_history_proxy.dart` | Chat/folders endpoints | **Delete** | → `ChatHistoryApi` |
| 5 | `lib/services/chatbot_proxy.dart` | Query endpoints | **Delete** | → `QueriesApi` |
| 6 | `lib/services/document_file_proxy.dart` | File ingest/crawl | **Delete** | Not in spec — defer or raw client |
| 7 | `lib/services/file_proxy.dart` | File upload/metadata | **Delete** | Not in spec — defer or raw client |
| 8 | `lib/services/label_proxy.dart` | Label CRUD | **Delete** | Not in spec — defer or raw client |
| 9 | `lib/services/service_tree_proxy.dart` | Service tree | **Delete** | → `ServiceCategoriesApi` + `ServicesApi` |
| 10 | `lib/services/user_profile_proxy.dart` | Profile endpoints | **Delete** | → `CurrentUserApi` |
| 11 | `lib/services/user_service.dart` | Profile/reset/delete | **Modify** | → `CurrentUserApi` via provider |
| 12 | `lib/services/weather_proxy.dart` | Weather endpoint | **Delete** | → `WeatherApi` |
| 13 | `lib/components/chat/chatbot_component.dart` | Chat + queries | **Modify** | → `QueriesApi` + `ChatHistoryApi` |
| 14 | `lib/components/chat/right_sidebar_component.dart` | Translation + file view | **Modify** | → `TranslationApi` + raw file URL |
| 15 | `lib/components/chat/web_file_utils.dart` | File view (dart:html) | **Modify** | Token from `TokenStorage` for Bearer |
| 16 | `lib/components/sidebar/chat_folders_panel.dart` | Chat folders | **Modify** | → `ChatHistoryApi` (was missing!) |
| 17 | `lib/components/sidebar/service_tree_panel.dart` | Service tree | **Modify** | → `ServiceCategoriesApi` + `ServicesApi` (was missing!) |
| 18 | `lib/components/user/user_profile_component.dart` | Profile display | **Modify** | → `CurrentUserApi` |
| 19 | `lib/components/settings/settings_component.dart` | Settings/reset | **Modify** | Update `UserService` injection |
| 20 | `lib/services/auth/auth_notifier.dart` | Auth (logout API) | **Keep** | Already uses `apiServiceProvider` |
| 21 | `lib/services/auth/auth_providers.dart` | Provider setup | **Keep** | Already wires `AuthInterceptor` |
| 22 | `lib/services/auth/auth_interceptor.dart` | HTTP interceptor | **Reuse** | Shared auth client for generated APIs |
| 23 | `lib/services/keycloak/keycloak_service.dart` | Keycloak OIDC | **Keep** | Direct HTTP to Keycloak (not backend) |

## Tasks & Acceptance Criteria

**Execution:**
- [ ] `lib/providers/api_providers.dart` — Create `authenticatedApiProvider` (exposes `AuthInterceptor`-wrapped `ApiClient`) and API-specific providers: `currentUserApiProvider`, `chatHistoryApiProvider`, `queriesApiProvider`, `serviceCategoriesApiProvider`, `servicesApiProvider`, `analyticsApiProvider`, `adminApiProvider`, `weatherApiProvider`, `translationApiProvider`. Reuse existing `AuthInterceptor` from `auth_providers.dart`.
- [ ] `lib/components/user/user_profile_component.dart` — Replace `UserProfileProxy` with `CurrentUserApi` via provider. Use `apiMeGetWithHttpInfo()` / `apiMePut()`. Remove `userId` parameter dependency.
- [ ] `lib/components/chat/chatbot_component.dart` — Replace `ChatbotProxy` + `ChatHistoryProxy` with provider-injected `QueriesApi` + `ChatHistoryApi`. Remove direct `ApiService()` for conversation fetch.
- [ ] `lib/components/chat/right_sidebar_component.dart` — Replace direct `ApiService` with `TranslationApi` via provider. For file view URL (`/files/{id}/view`), get token from `TokenStorage` and append as query param or header.
- [ ] `lib/components/sidebar/chat_folders_panel.dart` — Replace `ChatHistoryProxy()` with `ChatHistoryApi` via provider injection.
- [ ] `lib/components/sidebar/service_tree_panel.dart` — Replace `ServiceTreeProxy()` with `ServiceCategoriesApi` + `ServicesApi` via provider injection.
- [ ] `lib/services/user_service.dart` — Migrate from `ApiService` to `CurrentUserApi` via provider.
- [ ] `lib/components/settings/settings_component.dart` — Update `UserService` constructor call if signature changes.
- [ ] `lib/components/chat/web_file_utils.dart` — Pass `accessToken` from `TokenStorage` (already does this via parameter). Verify caller chain passes token correctly.
- [ ] Delete all 10 proxy files in `lib/services/*_proxy.dart`
- [ ] Delete `lib/services/api_service.dart` — after all consumers migrated
- [ ] Clean up `lib/services/auth/auth_providers.dart` — remove `apiServiceProvider` (no longer needed after migration)

**Acceptance Criteria:**
- Given a valid access token, when any API call is made, then the request includes `Authorization: Bearer <token>` header
- Given an expired access token and valid refresh token, when a 401 is received, then a single token refresh occurs and the original request is retried (single retry max — no infinite loop)
- Given multiple concurrent 401 responses, when they arrive simultaneously, then only one refresh is executed (mutex)
- Given a refresh failure, when retry is attempted, then `AuthException` is thrown and `AuthNotifier` transitions to unauthenticated (tokens cleared)
- Given `CurrentUserApi.apiMeGetWithHttpInfo()`, when called, then the response contains the user profile
- Given the profile page opens, when `/api/me` is called, then the profile data is displayed (no "UserID not found" error)
- Given chat folders panel opens, when folder list is loaded, then conversations display correctly (via `ChatHistoryApi`)
- Given service tree panel opens, when categories are loaded, then service tree displays correctly (via `ServiceCategoriesApi`)
- Given `flutter analyze lib/` (excluding `lib/api/`), then zero errors related to auth or API migration
- Given `flutter build apk --flavor dev --debug --dart-define=DEV_SERVER=192.168.78.153`, then build succeeds

## Design Notes

### Reuse existing AuthInterceptor

The existing `AuthInterceptor` (`lib/services/auth/auth_interceptor.dart`) already implements everything the original spec proposed to build from scratch:

- Bearer token injection from `TokenStorage` (line 26-29)
- 401 detection → refresh → retry (lines 40-71)
- Mutex via `_refreshCompleter` — concurrent 401s share one refresh (lines 99-119)
- Body capture for POST/PUT retry (lines 33-36, 78-97)
- Single-retry-max guard — second 401 throws `AuthException` (lines 60-68)
- Token clearing on refresh failure delegated to `AuthNotifier` (which already calls `_tokenStorage.deleteAll()`)

**No new `AuthenticatedApiClient` needed.** Just expose the `AuthInterceptor` as a provider and plug it into the generated `ApiClient`.

### Provider wiring

```dart
// lib/providers/api_providers.dart
final authenticatedApiProvider = Provider<ApiClient>((ref) {
  final config = getConfig();
  final tokenStorage = ref.watch(tokenStorageProvider);
  final logger = ref.read(authLoggerProvider);
  final client = config.allowInsecureConnections
      ? InsecureHttpClient()
      : http.Client();

  final interceptor = AuthInterceptor(
    inner: client,
    tokenStorage: tokenStorage,
    onRefreshToken: () => ref.read(authProvider.notifier).refreshToken(),
    logger: logger,
  );
  ref.onDispose(() { interceptor.close(); client.close(); });

  return ApiClient(basePath: config.backendUrl)..client = interceptor;
});

final currentUserApiProvider = Provider<CurrentUserApi>((ref) {
  return CurrentUserApi(ref.watch(authenticatedApiProvider));
});
```

### Endpoints NOT in OpenAPI spec

`/files/*`, `/labels/*`, `/files/crawl/*` are not in the generated client. These are used by:
- `file_proxy.dart` (upload via MultipartRequest, file metadata, file URLs)
- `document_file_proxy.dart` (ingest, crawl schedule/kill)
- `label_proxy.dart` (CRUD)
- `right_sidebar_component.dart` (file view URL construction)
- `web_file_utils.dart` (file view via dart:html)

**Strategy:** Delete the proxies. For file view URLs in components, construct the URL with the backend base URL and pass the Bearer token from `TokenStorage` directly (as `web_file_utils.dart` already does). File upload, ingest, and label CRUD are admin-only features — defer their migration until these endpoints are added to the OpenAPI spec.

### Logout during refresh

If the user logs out while a 401 refresh is in flight, `AuthNotifier.logout()` clears tokens and transitions to `unauthenticated`. The in-flight refresh will complete (or fail), but subsequent requests will see no stored tokens and send no Bearer header. The mutex `Completer` prevents stale state — it resolves with `null` on failure, which causes `AuthException`. No additional guards needed.

## Verification

**Commands:**
- `ANDROID_HOME=/opt/android-sdk flutter analyze lib/` — expected: 0 errors (warnings from generated code excluded)
- `ANDROID_HOME=/opt/android-sdk flutter build apk --flavor dev --debug --dart-define=DEV_SERVER=192.168.78.153` — expected: build succeeds

**Manual checks:**
- Open profile page → profile data loads without "UserID not found" error
- Open chat → conversations list loads (sidebar + main), messages send successfully
- Open chat folders panel → folders load, conversations display
- Open service tree panel → categories load, search works
- Dark mode → all pages still work (no regression from migration)
- Settings → theme/fontSize persistence still works, reset data works
- File view → file opens with authenticated URL in web
