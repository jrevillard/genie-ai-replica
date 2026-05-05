# Story 4.1: Flutter Build Flavor System

Status: done

## Story

As a deployment operator,
I want to create a new institutional deployment with a unique app ID, signing config, and build identity on both Android and iOS,
So that each institution has its own dedicated build for app store submission.

## Context: Existing Implementation (Epic 1 Story 1.2)

**CRITICAL:** The Android flavor system is **already implemented** from Story 1.2. The iOS side is **incomplete** — bundle identifiers are not per-flavor, and the URL scheme in `Info.plist` is hardcoded to dev.

### What Already Exists

**Android** (`android/app/build.gradle`):
- `flavorDimensions "environment"` with 4 product flavors: `dev`, `staging`, `e2e`, `itu`
- Each flavor has `applicationIdSuffix` and `manifestPlaceholders = [appAuthRedirectScheme: ...]`
- `itu` flavor has no suffix (production ID = `com.example.genie_ai_mobile`)
- All flavors use `signingConfigs.debug` (no release signing per flavor yet)

**Dart config** (`lib/config/`):
- `keycloak_config.dart` — `KeycloakConfig` data class + `getConfig()` using `String.fromEnvironment('FLAVOR')`
- `dev_config.dart`, `staging_config.dart`, `e2e_config.dart` — environment configs
- `flavors/itu.dart` — ITU production deployment config
- All configs define: `keycloakUrl`, `realm`, `clientId`, `redirectScheme`, `backendUrl`

**iOS** (`ios/Runner/Info.plist`):
- `CFBundleURLTypes` exists but URL scheme is **hardcoded to `com.itu.genieai.dev`** with a WARNING comment
- No per-flavor `PRODUCT_BUNDLE_IDENTIFIER` — all flavors share the same bundle ID
- No per-flavor Xcode build configurations or schemes
- No per-flavor XCConfig files

### What This Story Must Deliver

The primary work is **iOS per-flavor build configuration**. Android needs only minor hardening (signing config structure, no functional changes).

## Acceptance Criteria

1. **AC1:** Given the iOS project, when XCConfig files are created per flavor, then each flavor has a unique `PRODUCT_BUNDLE_IDENTIFIER` (e.g., `com.example.genieAiMobile.dev` for dev, `com.example.genieAiMobile` for itu)
2. **AC2:** Given the iOS project, when Xcode build configurations are created per flavor per build mode, then each flavor has its own Debug/Profile/Release build configuration (e.g., `Debug-dev`, `Release-dev`, `Debug-itu`, `Release-itu`)
3. **AC3:** Given the iOS project, when Xcode schemes are created per flavor, then each flavor has a scheme that selects the correct build configuration
4. **AC4:** Given the `itu` flavor is built for Android (`flutter build apk --flavor itu`), then the APK has application ID `com.example.genie_ai_mobile` (no suffix) — **already working, verify no regression**
5. **AC5:** Given the `itu` flavor is built for iOS (`flutter build ipa --flavor itu`), then the IPA has bundle identifier matching the itu XCConfig
6. **AC6:** Given the iOS `Info.plist`, when the URL scheme is made flavor-aware, then `CFBundleURLTypes` uses `$(APP_AUTH_REDIRECT_SCHEME)` from XCConfig instead of a hardcoded value
7. **AC7:** Given the `ios/Podfile`, when custom build configurations are added, then each flavor configuration maps to the correct Flutter build mode (:debug or :release)
8. **AC8:** Given the Android `build.gradle`, when signing config structure is added, then a `key.properties` file pattern is documented and `release` build type references it (keystore not committed)
9. **AC9:** Given the CLAUDE.md in `mobile/genie_ai_mobile/`, when the build commands section is updated, then it uses `--flavor <name>` syntax (not `--dart-define=FLAVOR=<name> -t lib/config/flavors/<name>.dart`)
10. **AC10:** Given a new deployment operator, when they read the Dart flavor template, then `lib/config/flavors/template.dart` exists with placeholder fields for: `keycloakUrl`, `realm`, `clientId`, `redirectScheme`, `backendUrl`

## Tasks / Subtasks

- [x] 1. iOS: Create XCConfig files per flavor per build mode (AC: 1)
  - [x] 1.1 Create `ios/Flutter/Debug-dev.xcconfig`, `Release-dev.xcconfig`, `Profile-dev.xcconfig`
  - [x] 1.2 Create `ios/Flutter/Debug-staging.xcconfig`, `Release-staging.xcconfig`, `Profile-staging.xcconfig`
  - [x] 1.3 Create `ios/Flutter/Debug-e2e.xcconfig`, `Release-e2e.xcconfig`, `Profile-e2e.xcconfig`
  - [x] 1.4 Create `ios/Flutter/Debug-itu.xcconfig`, `Release-itu.xcconfig`, `Profile-itu.xcconfig`
  - [x] 1.5 Each XCConfig includes the base `Generated.xcconfig` and sets `PRODUCT_BUNDLE_IDENTIFIER`
  - [x] 1.6 Each XCConfig sets `APP_AUTH_REDIRECT_SCHEME` matching the flavor's redirectScheme
- [x] 2. iOS: Update Xcode project with build configurations (AC: 2)
  - [x] 2.1 Add build configurations for each flavor: Debug-dev, Release-dev, Profile-dev, Debug-staging, Release-staging, Profile-staging, Debug-e2e, Release-e2e, Profile-e2e, Debug-itu, Release-itu, Profile-itu
  - [x] 2.2 Each configuration references the corresponding XCConfig file
- [x] 3. iOS: Create Xcode schemes per flavor (AC: 3)
  - [x] 3.1 Create scheme files under `ios/Runner.xcodeproj/xcshareddata/xcschemes/` for each flavor
  - [x] 3.2 Each scheme maps Debug→Debug-<flavor>, Profile→Profile-<flavor>, Release→Release-<flavor>
- [x] 4. iOS: Make Info.plist URL scheme flavor-aware (AC: 6)
  - [x] 4.1 Replace hardcoded `com.itu.genieai.dev` in `CFBundleURLTypes` with `$(APP_AUTH_REDIRECT_SCHEME)`
  - [x] 4.2 Remove the WARNING comment block
- [x] 5. iOS: Update Podfile for custom build configurations (AC: 7)
  - [x] 5.1 Add all 12 custom build configurations to the Podfile's project mapping
- [x] 6. Android: Add signing config structure (AC: 8)
  - [x] 6.1 Add `signingConfigs` block reading from `android/key.properties`
  - [x] 6.2 Set `release` build type to use `signingConfigs.release`
  - [x] 6.3 Create `android/key.properties.example` with placeholder values
  - [x] 6.4 Ensure `android/key.properties` is gitignored
- [x] 7. Create flavor template file (AC: 10)
  - [x] 7.1 Create `lib/config/flavors/template.dart` with placeholder fields and documentation comments
- [x] 8. Update documentation (AC: 9)
  - [x] 8.1 Update `mobile/genie_ai_mobile/CLAUDE.md` build commands to use `--flavor <name>`
  - [x] 8.2 Add iOS build instructions section to CLAUDE.md
  - [x] 8.3 Add note about `key.properties` for Android release builds
- [x] 9. Verify no regressions (AC: 4)
  - [x] 9.1 Run `flutter build apk --flavor dev --debug` and verify APK builds
  - [x] 9.2 Run `flutter build apk --flavor itu --debug` and verify APK builds
  - [x] 9.3 Verify `flutter analyze` passes

## Dev Notes

### Architecture Compliance

- **ADR3: Build-Time Configuration via Flutter Flavors** — all deployment-specific values compiled at build-time via `--flavor` flag
- **No code generation** — no flavorizr, no build_runner. Manual XCConfig + Gradle product flavors + Dart switch
- **Config directory structure** from architecture D6:
  ```
  lib/config/
  ├── keycloak_config.dart    # EXISTS — KeycloakConfig + getConfig()
  ├── dev_config.dart         # EXISTS
  ├── staging_config.dart     # EXISTS
  ├── e2e_config.dart         # EXISTS
  └── flavors/
      ├── itu.dart            # EXISTS
      └── template.dart       # NEW — deployment operator copy target
  ```

### Build Commands — Correct Syntax

```bash
# Android
flutter build apk --flavor dev --debug
flutter build apk --flavor itu --release
flutter build appbundle --flavor itu --release

# iOS (when Mac available)
flutter build ipa --flavor dev
flutter build ipa --flavor itu

# Run
flutter run --flavor dev
flutter run --flavor itu
```

**DO NOT use** `--dart-define=FLAVOR=itu -t lib/config/flavors/itu.dart` — this bypasses platform-native flavor infrastructure (Gradle product flavors, Xcode schemes, per-flavor signing, per-flavor bundle IDs). The `--flavor` flag is the official Flutter mechanism.

### iOS XCConfig Pattern

Each flavor needs 3 XCConfig files (Debug, Profile, Release) under `ios/Flutter/`:

```
ios/Flutter/
├── Debug.xcconfig           # EXISTS (base)
├── Release.xcconfig         # EXISTS (base)
├── Generated.xcconfig       # EXISTS (auto-generated)
├── Debug-dev.xcconfig       # NEW
├── Release-dev.xcconfig     # NEW
├── Profile-dev.xcconfig     # NEW
├── Debug-staging.xcconfig   # NEW
├── Release-staging.xcconfig # NEW
├── Profile-staging.xcconfig # NEW
├── Debug-e2e.xcconfig       # NEW
├── Release-e2e.xcconfig     # NEW
├── Profile-e2e.xcconfig     # NEW
├── Debug-itu.xcconfig       # NEW
├── Release-itu.xcconfig     # NEW
└── Profile-itu.xcconfig     # NEW
```

Each XCConfig includes the base Generated.xcconfig and overrides flavor-specific values:

```xcconfig
#include "Generated.xcconfig"
PRODUCT_BUNDLE_IDENTIFIER = com.example.genieAiMobile.dev
APP_AUTH_REDIRECT_SCHEME = com.itu.genieai.dev
```

**Bundle ID convention:**
- `dev`: `com.example.genieAiMobile.dev`
- `staging`: `com.example.genieAiMobile.staging`
- `e2e`: `com.example.genieAiMobile.e2e`
- `itu`: `com.example.genieAiMobile` (production, no suffix)

### iOS Podfile Update

The Podfile must map every custom build configuration to a Flutter build mode:

```ruby
project 'Runner', {
  'Debug' => :debug,
  'Debug-dev' => :debug,
  'Debug-staging' => :debug,
  'Debug-e2e' => :debug,
  'Debug-itu' => :debug,
  'Profile' => :release,
  'Profile-dev' => :release,
  'Profile-staging' => :release,
  'Profile-e2e' => :release,
  'Profile-itu' => :release,
  'Release' => :release,
  'Release-dev' => :release,
  'Release-staging' => :release,
  'Release-e2e' => :release,
  'Release-itu' => :release,
}
```

### iOS Xcode Build Configurations

The Xcode project (`project.pbxproj`) needs 12 new build configurations (3 modes x 4 flavors). Each must:
1. Reference the corresponding XCConfig file via `baseConfigurationReference`
2. Inherit from the base Debug/Profile/Release configuration

### iOS Xcode Schemes

Create scheme files under `ios/Runner.xcodeproj/xcshareddata/xcschemes/`:
- `Runner-dev.xcscheme`
- `Runner-staging.xcscheme`
- `Runner-e2e.xcscheme`
- `Runner-itu.xcscheme`

Each scheme maps:
- `BuildConfiguration` Debug → `Debug-<flavor>`
- `BuildConfiguration` Profile → `Profile-<flavor>`
- `BuildConfiguration` Release → `Release-<flavor>`

### Android Signing Config Structure

Add to `android/app/build.gradle`:

```groovy
// Load keystore properties (gitignored)
def keystorePropertiesFile = rootProject.file("key.properties")
def keystoreProperties = new Properties()
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}

android {
    signingConfigs {
        release {
            keyAlias keystoreProperties['keyAlias']
            keyPassword keystoreProperties['keyPassword']
            storeFile keystoreProperties['storeFile'] ? file(keystoreProperties['storeFile']) : null
            storePassword keystoreProperties['storePassword']
        }
    }
    buildTypes {
        release {
            signingConfig signingConfigs.release
        }
    }
}
```

Create `android/key.properties.example`:
```properties
storePassword=<your-store-password>
keyPassword=<your-key-password>
keyAlias=<your-key-alias>
storeFile=<path-to-your-keystore.jks>
```

### Flavor Template File

`lib/config/flavors/template.dart` — deployment operators copy this to create new flavors:

```dart
import '../keycloak_config.dart';

// Template for new deployment flavors.
// Copy this file to flavors/<institution>.dart and fill in the values below.
// The redirectScheme MUST match KC_MOBILE_REDIRECT_SCHEME in the deployment .env.

const config = KeycloakConfig(
  keycloakUrl: 'https://keycloak.<institution>.int',
  realm: 'genie',
  clientId: 'genie-mobile-<institution>',
  redirectScheme: 'com.<institution>.genieai',
  backendUrl: 'https://api.<institution>.int',
);
```

### Project Structure Notes

- **No changes to existing Dart config files** — `keycloak_config.dart`, `dev_config.dart`, `staging_config.dart`, `e2e_config.dart`, `flavors/itu.dart` remain as-is
- **No changes to Android product flavors** — the `build.gradle` flavors are already correct from Story 1.2
- **iOS is the primary work area** — 12 XCConfig files, build configurations, schemes, Podfile update, Info.plist fix
- **Android signing** is a structural addition — the `key.properties` pattern enables release signing without committing secrets

### Scheme Coherence Rule

The `redirectScheme` in the Dart flavor config MUST match:
1. `appAuthRedirectScheme` in `android/app/build.gradle` `manifestPlaceholders`
2. `APP_AUTH_REDIRECT_SCHEME` in the iOS XCConfig
3. `KC_MOBILE_REDIRECT_SCHEME` in the deployment `.env` (used by Story 4.2 for Keycloak client creation)

A mismatch causes silent OIDC callback failure — the browser redirects to the wrong scheme and the app never receives the authorization code.

### References

- [Source: architecture.md#D6] Flavor config via `lib/config/` + `--dart-define`
- [Source: architecture.md#Project Structure] Complete directory structure with `config/` layout
- [Source: mobile/genie_ai_mobile/android/app/build.gradle] Existing product flavors
- [Source: mobile/genie_ai_mobile/ios/Runner/Info.plist] Hardcoded URL scheme (lines 48-64)
- [Source: mobile/genie_ai_mobile/lib/config/keycloak_config.dart] getConfig() implementation
- [Source: PRD#ADR3] Build-Time Configuration via Flutter Flavors
- [Source: PRD#Platform Requirements] Flutter 3.10+, iOS 13+, Android 6.0+

### Testing Notes

- `flutter analyze` must pass after all changes
- `flutter build apk --flavor dev --debug` must succeed (Android regression check)
- `flutter build apk --flavor itu --debug` must succeed (Android regression check)
- iOS build verification requires a Mac (best-effort per project constraints)
- No unit tests needed — this is build infrastructure, not business logic

## Dev Agent Record

### Agent Model Used

glm-5-turbo

### Debug Log References

None.

### Completion Notes List

- Created 12 XCConfig files (4 flavors × 3 modes) under `ios/Flutter/` with per-flavor PRODUCT_BUNDLE_IDENTIFIER and APP_AUTH_REDIRECT_SCHEME
- Modified `project.pbxproj` to add 12 project-level + 12 target-level + 12 test-level build configurations, 12 PBXFileReference entries, and updated 3 XCConfigurationList entries
- Created 4 Xcode schemes (Runner-dev, Runner-staging, Runner-e2e, Runner-itu) mapping Debug/Profile/Release to flavor-specific build configs
- Replaced hardcoded URL scheme in Info.plist with `$(APP_AUTH_REDIRECT_SCHEME)` XCConfig variable
- Created Podfile with all 15 build configuration mappings (3 base + 12 flavor)
- Added Android release signing config structure with `key.properties` pattern (already gitignored)
- Created `key.properties.example` template and `flavors/template.dart` deployment operator template
- Updated CLAUDE.md with comprehensive build commands for Android/iOS and signing documentation
- Verified: `flutter analyze` passes (no new issues), `flutter build apk --flavor dev --debug` succeeds, `flutter build apk --flavor itu --debug` succeeds with correct application ID `com.example.genie_ai_mobile` (no suffix)

### Change Log

- 2026-04-28: Implemented iOS per-flavor build system (XCConfig, build configs, schemes, Podfile, Info.plist) and Android signing config structure

### File List

- mobile/genie_ai_mobile/ios/Flutter/Debug-dev.xcconfig (new)
- mobile/genie_ai_mobile/ios/Flutter/Release-dev.xcconfig (new)
- mobile/genie_ai_mobile/ios/Flutter/Profile-dev.xcconfig (new)
- mobile/genie_ai_mobile/ios/Flutter/Debug-staging.xcconfig (new)
- mobile/genie_ai_mobile/ios/Flutter/Release-staging.xcconfig (new)
- mobile/genie_ai_mobile/ios/Flutter/Profile-staging.xcconfig (new)
- mobile/genie_ai_mobile/ios/Flutter/Debug-e2e.xcconfig (new)
- mobile/genie_ai_mobile/ios/Flutter/Release-e2e.xcconfig (new)
- mobile/genie_ai_mobile/ios/Flutter/Profile-e2e.xcconfig (new)
- mobile/genie_ai_mobile/ios/Flutter/Debug-itu.xcconfig (new)
- mobile/genie_ai_mobile/ios/Flutter/Release-itu.xcconfig (new)
- mobile/genie_ai_mobile/ios/Flutter/Profile-itu.xcconfig (new)
- mobile/genie_ai_mobile/ios/Runner.xcodeproj/project.pbxproj (modified)
- mobile/genie_ai_mobile/ios/Runner.xcodeproj/xcshareddata/xcschemes/Runner-dev.xcscheme (new)
- mobile/genie_ai_mobile/ios/Runner.xcodeproj/xcshareddata/xcschemes/Runner-staging.xcscheme (new)
- mobile/genie_ai_mobile/ios/Runner.xcodeproj/xcshareddata/xcschemes/Runner-e2e.xcscheme (new)
- mobile/genie_ai_mobile/ios/Runner.xcodeproj/xcshareddata/xcschemes/Runner-itu.xcscheme (new)
- mobile/genie_ai_mobile/ios/Runner/Info.plist (modified)
- mobile/genie_ai_mobile/ios/Podfile (new)
- mobile/genie_ai_mobile/android/app/build.gradle (modified)
- mobile/genie_ai_mobile/android/key.properties.example (new)
- mobile/genie_ai_mobile/lib/config/flavors/template.dart (new)
- mobile/genie_ai_mobile/CLAUDE.md (modified)
- _bmad-output/implementation-artifacts/sprint-status.yaml (modified)
- _bmad-output/implementation-artifacts/4-1-flutter-build-flavor-system.md (modified)

### Review Findings

#### Patch

- [x] [Review][Patch] Release build fails without key.properties — `android/app/build.gradle:69-76`: signingConfigs.release reads from empty Properties when key.properties is absent; keyAlias/keyPassword/storePassword are null causing Gradle failure. Fix: fall back to signingConfigs.debug when key.properties does not exist.
- [x] [Review][Patch] ASSETCATALOG_COMPILER_GENERATE_SWIFT_ASSET_SYMBOL_EXTENSIONS inconsistent in new flavor build configs — `ios/Runner.xcodeproj/project.pbxproj`: New project-level Release-* and Profile-* configs have `= YES` but base Release/Profile configs have `= AppIcon`. Fix: set to `AppIcon` in all new Release/Profile project-level configs.
- [x] [Review][Patch] template.dart does not warn about getConfig() update — `lib/config/flavors/template.dart`: Missing comment that deployment operators must also add a case in getConfig() in keycloak_config.dart for new flavors.
- [x] [Review][Patch] getConfig() lacks guidance for adding new flavors — `lib/config/keycloak_config.dart:42-57`: No inline comment explaining the switch must be updated when adding new deployment flavors.

#### Deferred

- [x] [Review][Defer] architecture.md#D6 references --dart-define — deferred, pre-existing: architecture doc still mentions `--dart-define` which contradicts story guidance to use `--flavor`. Not introduced by this change.
