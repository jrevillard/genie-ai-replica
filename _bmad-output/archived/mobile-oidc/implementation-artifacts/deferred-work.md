# Deferred Work

## Deferred from: code review of 3-1-applifecycle-token-validation (2026-04-27)

- **Concurrent `validateTokens()` calls not guarded** — No mutex/re-entrancy guard on `validateTokens()`. Multiple `resumed` events can trigger overlapping async refresh flows. Known limitation documented in spec, deferred to Story 3.2 (Network Error Detection) for holistic error handling review.
- **Observer tests (AC5/AC6) use absence-of-exception** — Tests for `addObserver`/`removeObserver` only verify no crash, not that the methods were called. Spec explicitly says "No WidgetsBinding mock needed." Improving these tests would require mocking `WidgetsBinding`, which adds complexity for minimal gain.
- **Idempotence test relies on synchronous mocks** — Test calls `resumed` twice and asserts `refreshCallCount == 1`, but this works because mocks complete synchronously. With real async, both calls could overlap. Related to the concurrent `validateTokens` limitation above.
- **`validateTokens()` can race with `logout()`** — If user logs out while a lifecycle-triggered refresh is in-flight, the refresh may re-save tokens that logout deleted. Pre-existing issue, made more reachable by the lifecycle trigger. Root cause: no coordination flag between logout and validateTokens.
- **`validateTokens()` can race with `authorize()`** — If app resumes while user is mid-authorization flow, lifecycle validation could trigger a redundant refresh competing with the in-flight authorize. Narrow scenario requiring authenticated state AND active re-authorization AND app resume simultaneously.
- **Logging asymmetry in `validateTokens()`** — Success path has explicit logging after refresh; failure path relies on logging inside `refreshToken()`. Style preference, not a bug.

## Deferred from: code review of 3-2-network-error-detection-recovery (2026-04-28)

- **Lost state on app close after network error** — If app closes while state is `error` due to network error during refreshToken, on restart `_initializeAuth()` will attempt refresh with same stale tokens. Pre-existing (validateTokens() behaviour).
- **Race condition: authorize() vs logout()** — If logout() is called during authorize(), tokens may be saved after logout. Pre-existing (async concurrent methods, out of scope).
- **No timeout on authorizeAndExchangeCode** — flutter_appauth call has no explicit timeout. Out of scope (flutter_appauth concern).
- **Fragile keyword-based classification** — NetworkErrorClassifier uses keywords in error code. Documented as "best-effort heuristic" in spec, accepted as technical limitation.

## Deferred from: code review of 4-2-dart-flavor-config-keycloak-client-template (2026-04-28)

- **No runtime validation of scheme coherence** — The 4-layer scheme coherence rule (Dart config, Android build.gradle, iOS XCConfig, .env) is well-documented but not enforced programmatically. A mismatch causes silent OIDC callback failure. Design limitation documented in the spec.
- **No backchannel logout configuration** — The mobile client lacks `backchannel.logout.session.required` and `backchannel.logout.url`. Not mentioned in spec, out of scope for this story.
- **Missing `revoke.refresh.token.on.use` attribute** — The `CLAUDE.md` manual client creation docs mention this attribute but it is not in the spec. `client.credentials.use.refresh.token: true` covers the spec requirement.

## Deferred from: code review of 4-3-custom-url-scheme-per-deployment (2026-04-28)

- **No automated enforcement for scheme coherence rule** — The coherence rule (Dart = Gradle = XCConfig = env) is documented but no lint/CI check prevents future mismatches. Pre-existing design limitation.
- **Missing `webOrigins` in Keycloak mobile client config** — `genie-realm.yaml` mobile client has no `webOrigins`, potentially needed for Android App Links verification. Pre-existing.
- **Non-flavored debug build collides with `itu` flavor** — `flutter build apk` without `--flavor` uses same `applicationId` as `itu`. Pre-existing.
- **`e2e_config.dart` missing `allowInsecureConnections: true`** for `http://localhost:8080` URL. Would cause OIDC flow failure if appauth enforces HTTPS. Pre-existing.
- **Template flavor config has misleading scheme pattern** — `com.<institution>.genieai` vs actual convention `com.itu.genieai[.<suffix>]`. Pre-existing.
- **`env` template hardcodes `KC_MOBILE_REDIRECT_SCHEME=com.itu.genieai`** — Not generic for new institutional deployments. Pre-existing.

## Deferred from: code review of 4-4-deployment-onboarding-guide (2026-04-28)

- **Air-gapped section lacks concrete DNS configuration example** — Guide mentions local DNS and /etc/hosts but provides no specific commands. Could add a dnsmasq or /etc/hosts example for the device.
- **No Docker service health check before running verification commands** — Operators may run verification before keycloak-config finishes processing. Could add `docker service logs keycloak-config --since 30s` check.
- **Missing key.properties file permissions warning** — Signing credentials file should be chmod 600 but guide doesn't mention permissions.
- **Missing dependency resolution troubleshooting** — `flutter pub get` failure is a common first-build error not covered in troubleshooting section.
- **App Store compliance requirements omitted** — Google Play Data Safety disclosure and Apple privacy manifests are non-optional for store submission but not mentioned.
- **Version code/name management across deployments** — App stores require unique version codes per submission; no guidance for managing these across multiple institutional deployments.

## Deferred from: code review of 6-1-user-service-migration (2026-04-29)

- **RightSidebarComponent fallback accessToken supprimé** — Si `widget.accessToken` est null, l'opération est silencieusement ignorée. Code mort (nettoyage story 6.2/6.3).
- **UserProfileProxy multipart Authorization header supprimé sans remplacement** — `UserProfileProxy` crée `ApiService()` directement, pas dans le scope de cette story.
- **FileProxy token null handling** — Si `TokenStorage.getAccessToken()` retourne null, l'upload procède sans auth. Cas très rare.

## Deferred from: code review of 5-1-password-reset-via-keycloak-browser (2026-04-29)

- **Verification du flow `resetCredentials` dans Keycloak Admin Console non documentee** — Si un deploiement precedent a modifie le flow d'authentification browser, le bouton "Forgot Password" peut ne pas apparaitre meme si `resetPasswordAllowed=true`. Risque operationnel pre-existant.

## Deferred from: code review of 6-5-auth-test-suite-ci (2026-05-04)

- **`InsecureHttpClient` en production `auth_providers.dart`** — Classe `badCertificateCallback = true` dans `lib/services/auth/`. Risque faible car `allowInsecureConnections` défaut `false` pour tous les flavors production, mais devrait être guarded par `kDebugMode` ou déplacé en test-only pour éviter une utilisation accidentelle.
- **`init()` signature change casse backward compatibilité** — `keycloak-auth-service.js`: `init(idpUrl, clientId)` → `init(idpUrl)`. Hors scope de cette story de tests, introduit via le fix infrastructure Keycloak proxy chain.
- **AC#6 Binary size** — Pas de build release comparable (signing config manquante), pas de baseline pré-migration. Vérification documentée comme "vérification seulement" dans les completion notes.
- **AC#7 Data preservation** — Marqué "manual QA" mais aucune procédure documentée dans les completion notes. Vérification manuelle non automatisée.

## Process Notes

- **Dual i18n function pattern (translate vs tr)** — `tr()` is a thin alias for `I18nService().translate()`. Both resolve to the same code path. ~~When auditing orphaned i18n keys, grep for BOTH `translate(` and `tr('` to avoid false negatives.~~ **Resolved**: All `translate()` callers migrated to `tr()` in settings_component.dart, chatbot_component.dart, and chat_response_feedback_dialog.dart. Only `I18nService.translate()` definition remains.

## Addressed by Correct Course (2026-04-29)

The following deferred items were resolved during the correct course pass:

### Resolved (already fixed by later stories)
- ~~**5-1: Legacy routes `/password-reset` navigables**~~ — Fixed by Story 6.2
- ~~**6-2: Orphaned `verification.*` i18n section**~~ — Fixed by Story 6.3
- ~~**6-2: `UserService` methods potentially orphaned**~~ — Fixed by Story 6.3
- ~~**6-2: `flutter_svg` package potentially orphaned**~~ — Verified: used by nav_bar, chatbot, oidc_login_screen
- ~~**6-2: `LanguageSelector` widget potentially orphaned**~~ — Verified: used by settings_component
- ~~**6-1: `auth_proxy.dart` code mort**~~ — Fixed by Story 6.2 (file deleted)
- ~~**6-1: LoginScreen `onLoginSuccess({})` map vide**~~ — Fixed by Story 6.2 (file deleted)

### Fixed in this correct course
- ~~**4-1: architecture.md#D6 references `--dart-define`**~~ — Updated to `--flavor` (3 occurrences)
- ~~**6-3: mnk.dart missing entire `auth` section**~~ — Added 6 missing auth keys to `man.dart` (the actually-registered Mandinka locale); mnk.dart remains orphaned
- ~~**6-1: FileProxy `Content-Type: multipart/form-data` sans boundary**~~ — Removed manual Content-Type; `http.MultipartRequest` auto-generates boundary
- ~~**Dual i18n pattern (translate vs tr)**~~ — Migrated all `translate()` callers to `tr()` in 3 files: settings_component.dart (~40 calls), chat_response_feedback_dialog.dart (9 calls), chatbot_component.dart (4 calls + removed `_t()` bridge method). Fixed 4 missing i18n keys: reused `settings.confirmDeleteAccount` and `accountDeletionFailed`, added `settingsSavedOffline` and `userName` to en.dart
