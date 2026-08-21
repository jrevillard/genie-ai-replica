---
title: 'Mobile Scheme Coherence Enforcement'
type: 'chore'
created: '2026-08-14'
status: 'done'
baseline_revision: '102c26345ed41463e92db78f80d02c13cf1b9f08'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/mobile/genie_ai_mobile/CLAUDE.md'
warnings:
  - multiple-goals
deferred: []
---

<intent-contract>

## Intent

**Problem:** The 4-layer scheme coherence rule (Dart `redirectScheme` = Gradle `appAuthRedirectScheme` = iOS `APP_AUTH_REDIRECT_SCHEME` = `.env` `KC_MOBILE_REDIRECT_SCHEME`) is documented but has no programmatic enforcement. A mismatch silently breaks OIDC callbacks — the browser redirects to a scheme the app never registered. Additionally, the Keycloak mobile client lacks `webOrigins`, and the non-flavored debug build produces the same `applicationId` as the `itu` flavor.

**Approach:** Resolve 4 deferred-work entries in one coherent pass: (1) add a Dart startup assertion validating the scheme format, (2) add a CI-time cross-layer validation script, (3) add `webOrigins` to the Keycloak mobile client, (4) give the non-flavored debug build a distinct `applicationId`.

## Boundaries & Constraints

**Always:**
- All 4 existing flavor schemes (dev, staging, e2e, itu) MUST remain unchanged — these are deployed values.
- The CI validation script MUST run without Flutter/Dart/Gradle/Xcode toolchains (pure text parsing).
- `webOrigins` on the mobile client MUST use the Keycloak-native `"+"` convention for public/native clients.
- The non-flavored debug `applicationId` MUST NOT collide with any flavor's resolved `applicationId`.

**Block If:**
- Any existing flavor scheme value needs changing (would require coordinated deployment update).

**Never:**
- Introduce new flavors or rename existing ones.
- Replace the custom URL scheme approach with App Links (out of scope).
- Modify the Keycloak realm config for non-mobile clients.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| CI script — all layers match | Consistent schemes across 4 files | Exit 0, prints "scheme coherence OK" | No error |
| CI script — Gradle mismatch | Gradle says `com.itu.genieai.staging`, others say `com.itu.genieai` | Exit 1, prints which layer differs | Clear error naming the file and expected/actual values |
| CI script — missing flavor in Dart | New flavor in Gradle but not in Dart | Exit 1, reports missing flavor | Lists all flavors found per layer |
| Non-flavored debug build | `flutter build apk` without `--flavor` | applicationId = `com.example.genie_ai_mobile.debug` | No collision with `itu` flavor |
| Dart startup — malformed scheme | `redirectScheme` = `""` or invalid pattern | `AssertionError` at app startup | Assert in `KeycloakConfig` constructor |

</intent-contract>

## Code Map

- `mobile/genie_ai_mobile/lib/config/keycloak_config.dart` -- Central `KeycloakConfig` class with `redirectScheme` field and `getConfig()` flavor dispatcher. Add constructor assertion here.
- `mobile/genie_ai_mobile/lib/config/dev_config.dart` -- Dev flavor: `redirectScheme: 'com.itu.genieai.dev'`
- `mobile/genie_ai_mobile/lib/config/staging_config.dart` -- Staging flavor: `redirectScheme: 'com.itu.genieai.staging'`
- `mobile/genie_ai_mobile/lib/config/e2e_config.dart` -- E2E flavor: `redirectScheme: 'com.itu.genieai.e2e'`
- `mobile/genie_ai_mobile/lib/config/flavors/itu.dart` -- ITU flavor: `redirectScheme: 'com.itu.genieai'`
- `mobile/genie_ai_mobile/lib/config/flavors/template.dart` -- Template for new flavors (documentation only)
- `mobile/genie_ai_mobile/android/app/build.gradle` -- Android flavors with `manifestPlaceholders.appAuthRedirectScheme`. `defaultConfig.applicationId = "com.example.genie_ai_mobile"` (DW-44 collision site).
- `mobile/genie_ai_mobile/ios/Flutter/Debug-{dev,staging,e2e,itu}.xcconfig` (+ Profile/Release variants) -- iOS `APP_AUTH_REDIRECT_SCHEME` per flavor × build mode (12 files total).
- `configs/keycloak/genie-realm.yaml:163-176` -- Mobile OIDC client definition. Has `redirectUris` but no `webOrigins` (DW-43).
- `env:~530-548` -- `KC_MOBILE_REDIRECT_SCHEME=com.itu.genieai` (layer 4 of coherence rule).
- `mobile/genie_ai_mobile/test/config/keycloak_config_test.dart` -- Existing flavor tests. Add assertion test.
- `.gitlab-ci.yml` -- CI pipeline. Add scheme coherence validation job or step.

## Tasks & Acceptance

**Execution:**

**DW-40 — Dart runtime validation:**
- `mobile/genie_ai_mobile/lib/config/keycloak_config.dart` -- Add `assert` in `KeycloakConfig` constructor validating `redirectScheme` matches reverse-domain pattern (`^[a-z][a-z0-9]*(\.[a-z][a-z0-9]*)*$`) and is non-empty.
- `mobile/genie_ai_mobile/test/config/keycloak_config_test.dart` -- Add test verifying constructor rejects empty/invalid schemes (use `expect(() => KeycloakConfig(...redirectScheme: ''), throwsA(isA<AssertionError>()))`).

**DW-42 — CI cross-layer validation script:**
- `mobile/genie_ai_mobile/scripts/check_scheme_coherence.sh` -- New bash script. Extracts schemes from: (1) all Dart flavor files via grep `redirectScheme:`, (2) Gradle `build.gradle` via grep `appAuthRedirectScheme`, (3) all 12 iOS XCConfig files via grep `APP_AUTH_REDIRECT_SCHEME`, (4) `env` template via grep `KC_MOBILE_REDIRECT_SCHEME`. Compares per-flavor across layers. Exit 1 with diff on mismatch.
- `.gitlab-ci.yml` -- Add `mobile:scheme-coherence` job in lint/test stage running the script.

**DW-43 — Keycloak webOrigins:**
- `configs/keycloak/genie-realm.yaml` -- Add `webOrigins: ["+"]` to mobile client (lines 163-176). `"+"` is the Keycloak convention for public/native clients allowing all origins.

**DW-44 — Debug build applicationId collision:**
- `mobile/genie_ai_mobile/android/app/build.gradle` -- Change `defaultConfig.applicationId` from `"com.example.genie_ai_mobile"` to `"com.example.genie_ai_mobile.debug"`. The `itu` flavor (no suffix) keeps `com.example.genie_ai_mobile`. Debug without flavor now produces distinct APK. (iOS has no collision — base `Debug.xcconfig` only `#include "Generated.xcconfig"`, flavor-specific configs set bundle ID.)

**Acceptance Criteria:**
- Given a Dart `KeycloakConfig` with `redirectScheme: ''`, when constructed, then an `AssertionError` is thrown.
- Given all 4 layers have matching schemes, when `check_scheme_coherence.sh` runs, then exit code is 0.
- Given Gradle has `com.itu.genieai.staging` but Dart has `com.itu.genieai`, when `check_scheme_coherence.sh` runs, then exit code is 1 and output names the mismatched layer.
- Given the Keycloak mobile client config, when `genie-realm.yaml` is parsed, then `webOrigins: ["+"]` is present.
- Given `flutter build apk` without `--flavor`, when build completes, then `applicationId` is `com.example.genie_ai_mobile.debug` (not `com.example.genie_ai_mobile`).
- Given existing `itu` flavor build, when build completes, then `applicationId` is still `com.example.genie_ai_mobile` (unchanged).

## Spec Change Log

## Review Triage Log

### 2026-08-14 — Review pass
- intent_gap: 0
- bad_spec: 0
- patch: 0
- defer: 0
- reject: 0
- addressed_findings:
  - none

## Auto Run Result

**Summary:** Implemented 4 deferred-work items (DW-40, DW-42, DW-43, DW-44) enforcing mobile scheme coherence across all config layers.

**Files changed:**
- `.gitlab-ci.yml` — New `mobile:scheme-coherence` CI job running cross-layer validation
- `configs/keycloak/genie-realm.yaml` — Added `webOrigins: ["+"]` to mobile OIDC client (DW-43)
- `mobile/genie_ai_mobile/android/app/build.gradle` — Changed `defaultConfig.applicationId` to `.debug`, added explicit `applicationId` to all 4 flavors preserving existing resolved IDs (DW-44)
- `mobile/genie_ai_mobile/lib/config/keycloak_config.dart` — Added assert validating `redirectScheme` reverse-domain pattern; constructor changed from const to non-const (DW-40)
- `mobile/genie_ai_mobile/lib/config/dev_config.dart` — `const` → `final` (DW-40 cascade)
- `mobile/genie_ai_mobile/lib/config/staging_config.dart` — `const` → `final` (DW-40 cascade)
- `mobile/genie_ai_mobile/lib/config/e2e_config.dart` — `const` → `final` (DW-40 cascade)
- `mobile/genie_ai_mobile/lib/config/flavors/itu.dart` — `const` → `final` (DW-40 cascade)
- `mobile/genie_ai_mobile/lib/config/flavors/template.dart` — `const` → `final` (DW-40 cascade)
- `mobile/genie_ai_mobile/test/config/keycloak_config_test.dart` — Removed const constructor test, added 3 assertion tests, all `const` → `final` (DW-40)
- `mobile/genie_ai_mobile/scripts/check_scheme_coherence.sh` — NEW: Cross-layer validation script (DW-42)

**Review findings breakdown:**
- Patches applied: 0
- Items deferred: 0
- Items rejected: 0

**Follow-up review recommendation:** false (patched: 0 high, 0 medium, 0 low; score = 0)

**Verification performed:**
- `bash mobile/genie_ai_mobile/scripts/check_scheme_coherence.sh` → exit 0, "scheme coherence OK"
- `flutter test test/config/keycloak_config_test.dart` → 20/20 tests pass (including 3 new assertion tests)
- `grep webOrigins configs/keycloak/genie-realm.yaml` → `["+"]` present on mobile client
- `grep applicationId mobile/genie_ai_mobile/android/app/build.gradle` → defaultConfig shows `.debug`, all 4 flavors show explicit applicationId preserving existing resolved values

**Residual risks:**
- DW-44 changes `applicationId` mechanism from `applicationIdSuffix` to explicit `applicationId` for dev/staging/e2e flavors. Resolved applicationIds are identical, but the Gradle DSL changed. Any tooling or scripts parsing `applicationIdSuffix` from build.gradle would need updating (none known).
- Dart constructor changed from `const` to non-const. All internal usage updated. External consumers of `KeycloakConfig` would need to remove `const` keyword (unlikely — this is app-internal config).


## Design Notes

**DW-40 vs DW-42 split:** DW-40 (Dart runtime assertion) catches programmer errors at development time (wrong scheme in a new flavor config). DW-42 (CI script) catches cross-layer drift that Dart alone cannot see (Gradle updated but Dart not). Both are needed — Dart can't parse Gradle, CI can't run Dart.

**DW-43 `webOrigins: ["+"]`:** The mobile client uses native AppAuth (not browser CORS), so `webOrigins` is not strictly required for the current custom-scheme flow. However, Keycloak's convention for public/native clients is `"+"` (allow all). This is defensive — prevents issues if the app ever makes direct CORS calls to Keycloak's token endpoint, and aligns with OIDC best practices for native clients (RFC 8252).

**DW-44 approach:** Changing `defaultConfig.applicationId` is safer than adding a new flavor or build-type guard. The non-flavored debug build is a developer convenience (quick `flutter build apk` without specifying flavor). Giving it a distinct ID prevents install conflicts without affecting any production flavor.

## Verification

**Commands:**
- `cd mobile/genie_ai_mobile && flutter test test/config/keycloak_config_test.dart` -- expected: all tests pass including new assertion test
- `bash mobile/genie_ai_mobile/scripts/check_scheme_coherence.sh` -- expected: exit 0, "scheme coherence OK"
- `grep -A5 "clientId.*KC_MOBILE_CLIENT_ID" configs/keycloak/genie-realm.yaml` -- expected: `webOrigins: ["+"]` present
- `grep "applicationId" mobile/genie_ai_mobile/android/app/build.gradle` -- expected: `defaultConfig` shows `.debug` suffix, `itu` flavor shows no suffix
