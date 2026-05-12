# Story 4.3: Custom URL Scheme Per Deployment

Status: done

## Story

As a mobile app,
I want to register a unique custom URL scheme per institutional deployment,
So that the OIDC callback is routed to the correct app instance on the device.

## Context: Existing Implementation (Stories 1.3b, 4.1, 4.2)

**CRITICAL:** Stories 1.3b, 4.1, and 4.2 have already created the per-flavor URL scheme infrastructure. This story is primarily a **verification story** that confirms the scheme registration works correctly end-to-end and documents the deployment operator verification steps.

### What Already Exists

**Android — Build-time scheme configuration** (Story 4.1):
- `android/app/build.gradle` — 4 product flavors, each with `manifestPlaceholders = [appAuthRedirectScheme: "<scheme>"]`:
  - `dev`: `com.itu.genieai.dev`
  - `staging`: `com.itu.genieai.staging`
  - `e2e`: `com.itu.genieai.e2e`
  - `itu`: `com.itu.genieai`
- `android/app/src/main/AndroidManifest.xml` — `RedirectUriReceiverActivity` declared with `taskAffinity="${applicationId}"` (Android 12+ fix)
- AppAuth Android SDK library manifest provides the `<intent-filter>` with `<data android:scheme="${appAuthRedirectScheme}"/>` automatically via manifest merger

**iOS — Build-time scheme configuration** (Story 4.1):
- `ios/Runner/Info.plist` — `CFBundleURLTypes` > `CFBundleURLSchemes` array with `$(APP_AUTH_REDIRECT_SCHEME)`
- 12 XCConfig files (4 flavors × 3 build modes), each setting `APP_AUTH_REDIRECT_SCHEME`:
  - `Debug-dev.xcconfig`: `com.itu.genieai.dev`
  - `Debug-staging.xcconfig`: `com.itu.genieai.staging`
  - `Debug-e2e.xcconfig`: `com.itu.genieai.e2e`
  - `Debug-itu.xcconfig` / `Release-itu.xcconfig`: `com.itu.genieai`

**Dart flavor config** (Story 4.1):
- `lib/config/dev_config.dart`: `redirectScheme: 'com.itu.genieai.dev'`
- `lib/config/staging_config.dart`: `redirectScheme: 'com.itu.genieai.staging'`
- `lib/config/e2e_config.dart`: `redirectScheme: 'com.itu.genieai.e2e'`
- `lib/config/flavors/itu.dart`: `redirectScheme: 'com.itu.genieai'`

**Keycloak server config** (Story 4.2):
- `configs/keycloak/genie-realm.yaml` — mobile client with `redirectUris: ["$(env:KC_MOBILE_REDIRECT_SCHEME)://callback"]`
- `env` template — `KC_MOBILE_REDIRECT_SCHEME=com.itu.genieai`

### What This Story Must Deliver

1. **Verify** the Android manifest merger produces the correct `<intent-filter>` per flavor in the final merged manifest
2. **Verify** the iOS `Info.plist` resolves `$(APP_AUTH_REDIRECT_SCHEME)` to the correct per-flavor value at build time
3. **Document** a verification procedure that deployment operators can follow to confirm scheme registration
4. **Verify** that two different flavor builds installed on the same device route OIDC callbacks to the correct app (AC3 / FR20)

## Acceptance Criteria

1. **AC1:** Given the app is built with flavor `itu`, when the `AndroidManifest.xml` is generated (merged), then an intent filter is registered for the URL scheme matching `KC_MOBILE_REDIRECT_SCHEME` (e.g., `com.itu.genieai://callback`)
2. **AC2:** Given the app is built with flavor `itu`, when the `Info.plist` is generated, then the URL scheme is registered under `CFBundleURLTypes` matching `KC_MOBILE_REDIRECT_SCHEME`
3. **AC3:** Given two different flavor builds are installed on the same device, when both apps register their respective URL schemes, then the OIDC callback is routed to the correct app based on the scheme (FR20)

## Tasks / Subtasks

- [x] 1. Verify Android manifest merger output — static analysis (AC: 1)
  - [x] 1.1 Build the `itu` flavor APK: `flutter build apk --flavor itu --dart-define=FLAVOR=itu -t lib/config/flavors/itu.dart`
  - [x] 1.2 Inspect the merged manifest: `cat build/app/intermediates/merged_manifests/ituRelease/AndroidManifest.xml | grep -A8 "RedirectUriReceiverActivity"` — confirm `<intent-filter>` with `<data android:scheme="com.itu.genieai"/>` exists
  - [x] 1.3 Repeat for `dev` flavor — verify scheme resolves to `com.itu.genieai.dev`
- [x] 2. Runtime verification on emulator — scheme registration (AC: 1, 3)
  - [x] 2.1 Install the `itu` APK on emulator: `flutter install --flavor itu --dart-define=FLAVOR=itu -t lib/config/flavors/itu.dart`
  - [x] 2.2 Verify scheme registered: `adb shell dumpsys package com.example.genie_ai_mobile | grep -A3 "android.intent.action.VIEW"` — confirm `com.itu.genieai` appears
  - [x] 2.3 Test intent routing: `adb shell am start -a android.intent.action.VIEW -d "com.itu.genieai://callback"` — confirm app receives the intent (may show error screen since no auth code, but app opens = scheme works)
  - [x] 2.4 Install the `dev` APK alongside: `flutter install --flavor dev --dart-define=FLAVOR=dev -t lib/config/dev_config.dart`
  - [x] 2.5 Verify distinct schemes: `adb shell dumpsys package com.example.genie_ai_mobile.dev | grep -A3 "android.intent.action.VIEW"` — confirm `com.itu.genieai.dev` appears
  - [x] 2.6 Test cross-flavor routing: `adb shell am start -a android.intent.action.VIEW -d "com.itu.genieai://callback"` opens `itu` app, `adb shell am start -a android.intent.action.VIEW -d "com.itu.genieai.dev://callback"` opens `dev` app
- [x] 3. Verify iOS Info.plist resolution (AC: 2)
  - [x] 3.1 If macOS available: build `itu` IPA, inspect compiled `Info.plist` for `CFBundleURLSchemes` containing `com.itu.genieai`
  - [x] 3.2 If macOS not available: verify XCConfig files contain correct values (`grep APP_AUTH_REDIRECT_SCHEME ios/Flutter/*.xcconfig`) and document as verified-by-inspection
- [x] 4. Document deployment verification steps (AC: 1, 2, 3)
  - [x] 4.1 Add a "Verifying Custom URL Scheme Registration" section to `mobile/genie_ai_mobile/CLAUDE.md` (or update existing section)
  - [x] 4.2 Document the `adb shell dumpsys` and `adb shell am start` verification commands
  - [x] 4.3 Document the manifest merger inspection path for Android
  - [x] 4.4 Document the Info.plist / XCConfig verification for iOS

## Dev Notes

### Architecture Compliance

- **ADR3: Build-Time Configuration via Flutter Flavors** — all deployment-specific values compiled at build-time via `--flavor` flag. No runtime scheme discovery.
- **Scheme coherence rule** — `redirectScheme` in Dart config MUST match `appAuthRedirectScheme` in `build.gradle` MUST match `APP_AUTH_REDIRECT_SCHEME` in iOS XCConfig MUST match `KC_MOBILE_REDIRECT_SCHEME` in `.env`. A mismatch causes silent OIDC callback failure.

### How Android Manifest Merger Works for URL Schemes

The AppAuth Android SDK (`net.openid.appauth`) includes this in its library `AndroidManifest.xml`:

```xml
<activity android:name="RedirectUriReceiverActivity" android:exported="true">
    <intent-filter>
        <action android:name="android.intent.action.VIEW"/>
        <category android:name="android.intent.category.DEFAULT"/>
        <category android:name="android.intent.category.BROWSABLE"/>
        <data android:scheme="${appAuthRedirectScheme}"/>
    </intent-filter>
</activity>
```

Our app's `AndroidManifest.xml` redeclares this activity with `tools:replace="android:taskAffinity"` to set `taskAffinity="${applicationId}"` (fixes "No stored state" error on Android 12+). The manifest merger:
1. Keeps the intent filter from the library manifest (intent filters are additive)
2. Applies our `taskAffinity` override (specific attribute replacement via `tools:replace`)
3. Resolves `${appAuthRedirectScheme}` from our `manifestPlaceholders` in `build.gradle`

The final merged manifest has both the correct intent filter AND the taskAffinity fix.

**Verification:** After building, inspect `build/app/intermediates/merged_manifests/<flavor>Release/AndroidManifest.xml` to confirm the intent filter exists with the correct scheme value.

### iOS URL Scheme Resolution

The `Info.plist` uses `$(APP_AUTH_REDIRECT_SCHEME)` which is a build-setting variable. Xcode resolves this from the active XCConfig file at build time:
- When building flavor `itu`, Xcode uses `Release-itu.xcconfig` → `APP_AUTH_REDIRECT_SCHEME = com.itu.genieai`
- The variable is substituted in the compiled `Info.plist` inside the IPA

**Verification:** After building, inspect the compiled `Info.plist` in the IPA bundle.

### Cross-Flavor Routing (AC3)

Each flavor has:
- Unique `applicationId` (Android) / `PRODUCT_BUNDLE_IDENTIFIER` (iOS)
- Unique `appAuthRedirectScheme` / `APP_AUTH_REDIRECT_SCHEME`

When two builds are installed on the same device (e.g., `com.itu.genieai` and `com.itu.genieai.dev`), the OS routes URL schemes based on the scheme string match. Since each flavor registers a different scheme, there is no collision.

Keycloak sends the callback to `{redirectScheme}://callback` where `redirectScheme` matches the flavor's client configuration. The OS routes this to the correct app.

### Files to Verify (DO NOT MODIFY unless a bug is found)

- `mobile/genie_ai_mobile/android/app/build.gradle` — product flavors with manifestPlaceholders (Story 4.1)
- `mobile/genie_ai_mobile/android/app/src/main/AndroidManifest.xml` — RedirectUriReceiverActivity (Story 1.3b)
- `mobile/genie_ai_mobile/ios/Runner/Info.plist` — CFBundleURLTypes (Story 1.3b)
- `mobile/genie_ai_mobile/ios/Flutter/*.xcconfig` — per-flavor APP_AUTH_REDIRECT_SCHEME (Story 4.1)
- `mobile/genie_ai_mobile/lib/config/dev_config.dart` — redirectScheme (Story 4.1)
- `mobile/genie_ai_mobile/lib/config/staging_config.dart` — redirectScheme (Story 4.1)
- `mobile/genie_ai_mobile/lib/config/e2e_config.dart` — redirectScheme (Story 4.1)
- `mobile/genie_ai_mobile/lib/config/flavors/itu.dart` — redirectScheme (Story 4.1)
- `mobile/genie_ai_mobile/lib/config/keycloak_config.dart` — KeycloakConfig data class (Story 4.1)

### Files to Modify

- `mobile/genie_ai_mobile/CLAUDE.md` — add "Verifying Custom URL Scheme Registration" section (documentation only)

### Testing Notes

- This is a **verification story** — no new production code is expected
- Two-phase verification:
  1. **Static analysis** (no emulator needed): build APK, inspect merged manifest XML
  2. **Runtime verification** (emulator needed): install APK, `adb shell dumpsys` to confirm scheme registration, `adb shell am start` to test intent routing
- The runtime verification does NOT require Keycloak running — we only test that the OS routes the custom URL scheme to the correct app
- Run `flutter analyze` after any changes to confirm no regressions
- iOS verification: build IPA (if macOS available), inspect compiled Info.plist; otherwise verify-by-inspection of XCConfig values
- Cross-flavor test: install two APKs (itu + dev) on same emulator, verify `adb shell am start` routes each scheme to the correct app

### Scheme Values Per Flavor

| Flavor | Android appAuthRedirectScheme | iOS APP_AUTH_REDIRECT_SCHEME | Dart redirectScheme | Application ID |
|--------|------------------------------|------------------------------|---------------------|----------------|
| dev | `com.itu.genieai.dev` | `com.itu.genieai.dev` | `com.itu.genieai.dev` | `com.example.genie_ai_mobile.dev` |
| staging | `com.itu.genieai.staging` | `com.itu.genieai.staging` | `com.itu.genieai.staging` | `com.example.genie_ai_mobile.staging` |
| e2e | `com.itu.genieai.e2e` | `com.itu.genieai.e2e` | `com.itu.genieai.e2e` | `com.example.genie_ai_mobile.e2e` |
| itu | `com.itu.genieai` | `com.itu.genieai` | `com.itu.genieai` | `com.example.genie_ai_mobile` |

### References

- [Source: mobile/genie_ai_mobile/android/app/build.gradle] Product flavors and manifestPlaceholders (lines 39-65)
- [Source: mobile/genie_ai_mobile/android/app/src/main/AndroidManifest.xml] RedirectUriReceiverActivity with taskAffinity fix
- [Source: mobile/genie_ai_mobile/ios/Runner/Info.plist] CFBundleURLTypes with $(APP_AUTH_REDIRECT_SCHEME) (line 48-58)
- [Source: mobile/genie_ai_mobile/ios/Flutter/Debug-itu.xcconfig] APP_AUTH_REDIRECT_SCHEME = com.itu.genieai
- [Source: mobile/genie_ai_mobile/ios/Flutter/Debug-dev.xcconfig] APP_AUTH_REDIRECT_SCHEME = com.itu.genieai.dev
- [Source: mobile/genie_ai_mobile/lib/config/flavors/itu.dart] ITU production redirectScheme
- [Source: mobile/genie_ai_mobile/lib/config/dev_config.dart] Dev redirectScheme
- [Source: _bmad-output/implementation-artifacts/4-1-flutter-build-flavor-system.md] Story 4.1 build system implementation
- [Source: _bmad-output/implementation-artifacts/4-2-dart-flavor-config-keycloak-client-template.md] Story 4.2 Keycloak client + env vars
- [Source: _bmad-output/planning-artifacts/architecture.md#D6] Deep link strategy — custom URL scheme per flavor
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.3] Story AC definition
- [Source: _bmad-output/project-context.md#Keycloak Config CLI] Variable substitution syntax rules
- [Source: PRD#FR20] Custom URL scheme per deployment for OIDC callback

## Dev Agent Record

### Agent Model Used

Claude Sonnet 4.6 (claude-sonnet-4-6)

### Debug Log References

- Android emulator: pixel_8 AVD, Android API 35
- `itu` build: `app-itu-debug.apk` — manifest merger confirmed at `build/app/intermediates/merged_manifests/ituDebug/processItuDebugManifest/AndroidManifest.xml`
- `dev` build: `app-dev-debug.apk` — manifest merger confirmed at `build/app/intermediates/merged_manifests/devDebug/processDevDebugManifest/AndroidManifest.xml`
- Runtime verification: `adb shell dumpsys` and `adb shell am start` on pixel_8 emulator
- `flutter analyze`: 133 pre-existing info/warnings, 0 errors, 0 new issues

### Completion Notes List

- AC1 verified: `itu` merged manifest contains `<data android:scheme="com.itu.genieai"/>` in the `RedirectUriReceiverActivity` intent-filter. `dev` merged manifest contains `<data android:scheme="com.itu.genieai.dev"/>`. Both have correct `taskAffinity` values.
- AC2 verified-by-inspection: iOS XCConfig files all contain correct `APP_AUTH_REDIRECT_SCHEME` values matching their flavor (12 files across 4 flavors × 3 build modes). macOS not available for IPA build verification.
- AC3 verified at runtime: Two APKs (`itu` + `dev`) installed on same emulator. `com.itu.genieai://callback` routes to `com.example.genie_ai_mobile`, `com.itu.genieai.dev://callback` routes to `com.example.genie_ai_mobile.dev`. Logcat confirms correct component resolution for both.
- Scheme coherence verified across all layers: Android `build.gradle`, iOS XCConfig, Dart config, and `env` template all contain matching scheme values per flavor.
- Documentation added to `mobile/genie_ai_mobile/CLAUDE.md` with verification procedures for Android (static + runtime + cross-flavor) and iOS (XCConfig inspection).
- No production code changes — this was a verification-only story. The only file modified is the documentation.

### File List

- `mobile/genie_ai_mobile/CLAUDE.md` — Added "Verifying Custom URL Scheme Registration" section with Android manifest inspection, runtime verification, cross-flavor routing, and iOS XCConfig verification procedures
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Updated 4-3 status from ready-for-dev to in-progress to review

### Review Findings

- [x] [Review][Decision] AC2 iOS non fully verified — verification done on source XCConfig files only, not on compiled Info.plist. AC2 states "when the Info.plist is generated" but no IPA build was performed (macOS not available). XCConfig values being correct does not guarantee Xcode resolves `$(APP_AUTH_REDIRECT_SCHEME)` at build time (e.g., build settings inclusion order issue). CLAUDE.md iOS section also lacks the actual `plutil`/`unzip` command to inspect the compiled Info.plist. — accepted: limitation documented, mechanism is reliable, story is verification-only.
- [x] [Review][Patch] Build commands in CLAUDE.md missing `-t` and `--dart-define` flags — `flutter build apk --flavor itu --debug` omits `-t lib/config/flavors/itu.dart` and `--dart-define=FLAVOR=itu` that story task 1.1 includes. Same for iOS `flutter build ipa --flavor itu`. [`mobile/genie_ai_mobile/CLAUDE.md`]
- [x] [Review][Patch] iOS IPA inspection command missing from CLAUDE.md — Section says "inspect the compiled Info.plist" but provides no `plutil`/`unzip`/`codesign` command. Operator cannot complete the verification. [`mobile/genie_ai_mobile/CLAUDE.md`]
- [x] [Review][Patch] Hardcoded ANDROID_HOME in CLAUDE.md build command — `ANDROID_HOME=/opt/android-sdk` assumes a specific path. Should use `${ANDROID_HOME}` or document as placeholder. [`mobile/genie_ai_mobile/CLAUDE.md`]
- [x] [Review][Patch] iOS `grep` command matches base XCConfig files — `grep APP_AUTH_REDIRECT_SCHEME ios/Flutter/*.xcconfig` also matches `Debug.xcconfig`, `Release.xcconfig`, `Profile.xcconfig` which don't define this variable. Use `ios/Flutter/*-*.xcconfig` instead. [`mobile/genie_ai_mobile/CLAUDE.md`]
- [x] [Review][Patch] Cross-flavor section missing expected output annotations — Unlike the Runtime Verification section which has `# Expected:` comments, the cross-flavor routing section lacks them for `dumpsys` and `am start` commands. [`mobile/genie_ai_mobile/CLAUDE.md`]
- [x] [Review][Defer] No automated enforcement for scheme coherence rule — The coherence rule (Dart = Gradle = XCConfig = env) is documented but no lint/CI check prevents future mismatches. [`mobile/genie_ai_mobile/CLAUDE.md`] — deferred, pre-existing
- [x] [Review][Defer] Missing `webOrigins` in Keycloak mobile client config — `genie-realm.yaml` mobile client has no `webOrigins`, potentially needed for Android App Links verification. [`configs/keycloak/genie-realm.yaml`] — deferred, pre-existing
- [x] [Review][Defer] Non-flavored debug build collides with `itu` flavor — `flutter build apk` without `--flavor` uses same `applicationId` as `itu`. [`mobile/genie_ai_mobile/android/app/build.gradle`] — deferred, pre-existing
- [x] [Review][Defer] `e2e_config.dart` missing `allowInsecureConnections: true` for `http://localhost:8080` — Would cause OIDC flow failure if appauth enforces HTTPS. [`mobile/genie_ai_mobile/lib/config/e2e_config.dart`] — deferred, pre-existing
- [x] [Review][Defer] Template flavor config has misleading scheme pattern — `com.<institution>.genieai` vs actual convention `com.itu.genieai[.<suffix>]`. [`mobile/genie_ai_mobile/lib/config/flavors/template.dart`] — deferred, pre-existing
- [x] [Review][Defer] `env` template hardcodes `KC_MOBILE_REDIRECT_SCHEME=com.itu.genieai` — Not generic for new institutional deployments. [`env`] — deferred, pre-existing
