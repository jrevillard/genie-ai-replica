# Story 4.4: Deployment Onboarding Guide

Status: done

## Story

As a deployment technician (familiar with Flutter and mobile build systems),
I want a technical guide documenting the complete onboarding process for creating a new institutional deployment,
So that I can create and publish a new deployment in under a day by following a documented, repeatable process.

## Acceptance Criteria

1. **Given** the deployment guide exists at `site/content/en/docs/deployment/mobile-deployment-guide.md`
   **When** an operator follows it end-to-end
   **Then** it covers: adding `KC_MOBILE_CLIENT_ID` and `KC_MOBILE_REDIRECT_SCHEME` to `.env`, copying and filling the flavor template, configuring build files (gradle product flavor + iOS XCConfig triplet), build commands, and testing steps (FR26)

2. **Given** the guide covers Keycloak client creation
   **When** the operator adds the env vars and restarts keycloak-config-cli
   **Then** the mobile client is created automatically with: public client, PKCE mandatory, refresh token rotation enabled, no client secret (FR18, FR19)
   **And** the guide explicitly marks `KC_MOBILE_CLIENT_ID` and `KC_MOBILE_REDIRECT_SCHEME` as **required** (no default — unlike other Keycloak vars like `KC_CLIENT_ID` which defaults to `genie-app`), with a warning that omitting them causes silent keycloak-config-cli failure

3. **Given** the guide covers the scheme coherence rule
   **When** the operator configures a new deployment
   **Then** it explicitly documents that `KC_MOBILE_REDIRECT_SCHEME` in `.env` must match `redirectScheme` in the Dart flavor config, `appAuthRedirectScheme` in `build.gradle`, `APP_AUTH_REDIRECT_SCHEME` in iOS XCConfig, and `redirectUris` in Keycloak client — mismatch causes callback failure
   **And** it includes a visual comparison table with the ITU flavor as reference example
   **And** it notes that `KC_MOBILE_CLIENT_ID` and `KC_MOBILE_REDIRECT_SCHEME` are already passed to the `keycloak-config` service in `docker-compose.yaml` (lines 1202-1203) — the operator only needs to set them in `.env`

4. **Given** the guide covers air-gapped deployments
   **When** the operator deploys in a restricted-network environment
   **Then** it documents: device must reach Keycloak on internal network, local DNS configuration, no external dependency (FR27)

5. **Given** the guide covers OS version policy
   **When** the operator reads the trade-off section
   **Then** it documents: technical minimums (iOS 13+, Android 6.0+) vs institutional security policies, MDM enforcement recommendation (FR28)

6. **Given** the guide covers app store submission
   **When** the operator is ready to publish
   **Then** it documents: Google Play / Apple App Store requirements, signing certificate management, provisioning profiles per deployment

7. **Given** the guide covers the complete flavor addition checklist
   **When** a new deployment is needed
   **Then** it lists all 4 layers that must be configured: Dart config, `getConfig()` switch, Android `build.gradle` product flavor, iOS XCConfig triplet (Debug/Profile/Release)

8. **Given** the guide covers deployment validation
   **When** the technician completes the onboarding
   **Then** it includes an OIDC end-to-end validation checklist: Keycloak client created (curl Admin API), scheme registered (adb dumpsys), login flow works (device/emulator), token refresh succeeds, logout terminates Keycloak session

9. **Given** the guide covers rollback procedures
   **When** a deployment fails or needs to be reverted
   **Then** it documents: how to remove a Keycloak client, how to revert flavor configuration, how to unpublish from app stores, and how to communicate rollback to end users

## Tasks / Subtasks

- [x] Task 1: Create `site/content/en/docs/deployment/mobile-deployment-guide.md` with complete deployment onboarding content (AC: #1, #2, #3, #4, #5, #6, #7, #8, #9)
  - [x] 1.1 Write "Overview" section: purpose, target audience (deployment technicians familiar with Flutter), estimated time (under a day), link to prerequisites
  - [x] 1.2 Write "Prerequisites" section: Flutter SDK, Android Studio, Xcode (macOS only), Docker (for Keycloak), device/emulator for testing, access to deployment `.env`
  - [x] 1.3 Write "Step 1: Environment Variables" section: document `KC_MOBILE_CLIENT_ID` and `KC_MOBILE_REDIRECT_SCHEME` in `.env`, explicitly mark them as **required** with no default (unlike `KC_CLIENT_ID` which defaults to `genie-app`), warn that omitting them causes silent keycloak-config-cli failure, reference existing comments in `env` template (lines 390-405), note that these vars are already passed to the `keycloak-config` service in `docker-compose.yaml` (lines 1202-1203) — no manual docker-compose edit needed
  - [x] 1.4 Write "Step 2: Keycloak Client" section: document that keycloak-config-cli creates the client automatically from env vars at container startup, reference `configs/keycloak/genie-realm.yaml` mobile client section, list the client configuration (public, PKCE S256, refresh token rotation, no ROPC), include curl command to verify client creation via Keycloak Admin API
  - [x] 1.5 Write "Step 3: Scheme Coherence Rule" section (moved before flavor config — it's a prerequisite): explain the 5-layer coherence requirement with a visual comparison table using the ITU flavor as example, warn that mismatch causes silent OIDC callback failure, include verification commands
  - [x] 1.6 Write "Step 4: Flutter Flavor Configuration" section with the 4-layer checklist:
    - Layer 1: Copy `lib/config/flavors/template.dart` to `lib/config/flavors/<institution>.dart`, fill values
    - Layer 2: Add case in `getConfig()` switch in `lib/config/keycloak_config.dart`
    - Layer 3: Add product flavor in `android/app/build.gradle` with `applicationIdSuffix` and `manifestPlaceholders`
    - Layer 4: Create iOS XCConfig triplet (`Debug-<name>.xcconfig`, `Release-<name>.xcconfig`, `Profile-<name>.xcconfig`) under `ios/Flutter/`
  - [x] 1.7 Write "Step 5: Android Signing" section: reference `android/key.properties.example`, document keystore creation with `keytool` command, signing config in `build.gradle`
  - [x] 1.8 Write "Step 6: Build" section: document `flutter build apk --flavor <name> --release`, `flutter build appbundle --flavor <name> --release`, `flutter build ipa --flavor <name>` (macOS), reference build commands from `mobile/genie_ai_mobile/CLAUDE.md`
  - [x] 1.9 Write "Step 7: Validate" section with OIDC end-to-end validation checklist (AC: #8):
    - Verify Keycloak client exists: `curl -sk <KEYCLOAK_URL>/admin/realms/genie/clients?clientId=<CLIENT_ID>`
    - Verify scheme registered: `adb shell dumpsys package <appId> | grep "Scheme:"`
    - Test login flow on device/emulator (reference `mobile/genie_ai_mobile/CLAUDE.md#Verify OIDC Login Flow`)
    - Verify token refresh works (background app, wait for expiry, resume)
    - Verify logout terminates Keycloak session (reference `mobile/genie_ai_mobile/CLAUDE.md#Verify Logout`)
    - Reference verification procedures from `mobile/genie_ai_mobile/CLAUDE.md#Verifying Custom URL Scheme Registration`
  - [x] 1.10 Write "Air-Gapped Deployments" section (AC: #4): document network prerequisites (device must reach Keycloak), local DNS configuration, OIDC works identically whether Keycloak is internet-facing or internal, reference Journey 8 from PRD
  - [x] 1.11 Write "OS Version Policy" section (AC: #5): technical minimums (iOS 13+ for ASWebAuthenticationSession + PKCE, Android 6.0+ for EncryptedSharedPreferences), security patch considerations, MDM enforcement recommendation, reference PRD Platform Requirements table
  - [x] 1.12 Write "App Store Submission" section (AC: #6): Google Play requirements (signed AAB, content rating, privacy policy), Apple App Store requirements (Apple Developer account, provisioning profiles, bundle ID uniqueness per deployment), signing certificate management per deployment
  - [x] 1.13 Write "Rollback" section (AC: #9): how to remove a Keycloak client (Admin API), how to revert flavor configuration (git revert), how to unpublish from app stores, communication guidance for end users
  - [x] 1.14 Write "Troubleshooting" section structured as decision tree (Problem → Symptom → Solution): scheme mismatch diagnosis, build failures without key.properties, flutter_appauth local fork (must revert before merge to main), OIDC callback not received, 401 after login
- [x] Task 2: Cross-reference the guide from existing documentation (AC: #1)
  - [x] 2.1 Update reference in `mobile/genie_ai_mobile/CLAUDE.md` "Prerequisites" section: replace "until Epic 4 Story 4.2" note with link to deployment guide
  - [x] 2.2 Verify that `env` template comments (lines 394) reference the deployment guide instead of `mobile/genie_ai_mobile/CLAUDE.md`

## Dev Notes

### Nature of This Story

This is a **documentation-only story**. No production code changes. The deliverable is a single markdown file at `site/content/en/docs/deployment/mobile-deployment-guide.md` plus minor reference updates in `mobile/genie_ai_mobile/CLAUDE.md`.

### Target Audience

Deployment technicians who are familiar with Flutter build systems and mobile development. The guide can assume knowledge of Flutter, Gradle, Xcode concepts, and Docker. No need to explain what a "product flavor" or "XCConfig" is — focus on the GENIE.AI-specific configuration and the 5-layer coherence rule.

### Critical: Scheme Coherence Rule (5 layers)

The most important thing the guide must communicate clearly. A mismatch between any layer causes **silent OIDC callback failure** — the browser redirects to the wrong scheme and the app never receives the authorization code.

The 5 layers that must match:
1. `redirectScheme` in `lib/config/flavors/<name>.dart`
2. `appAuthRedirectScheme` in `android/app/build.gradle` `manifestPlaceholders`
3. `APP_AUTH_REDIRECT_SCHEME` in `ios/Flutter/*-<name>.xcconfig`
4. `KC_MOBILE_REDIRECT_SCHEME` in deployment `.env`
5. `redirectUris[0]` in `configs/keycloak/genie-realm.yaml` (via `$(env:KC_MOBILE_REDIRECT_SCHEME)://callback`)

**Swarm constraint (documented, not a pitfall):** Env vars used in `genie-realm.yaml` via `$(env:VAR)` must be listed in the `keycloak-config` service `environment:` block in `docker-compose.yaml`. `env_file` does not work with `docker stack deploy`. The mobile vars (`KC_MOBILE_CLIENT_ID`, `KC_MOBILE_REDIRECT_SCHEME`) are already present at lines 1202-1203 — added in Story 4.2. Future vars will need the same manual addition.

### Key Files to Reference in the Guide

| File | What to Extract |
|------|----------------|
| `mobile/genie_ai_mobile/lib/config/flavors/template.dart` | Template structure for new deployments |
| `mobile/genie_ai_mobile/lib/config/flavors/itu.dart` | Reference implementation of a deployment flavor |
| `mobile/genie_ai_mobile/lib/config/keycloak_config.dart` | `getConfig()` switch — where to add new flavor case |
| `mobile/genie_ai_mobile/android/app/build.gradle` | `productFlavors` section — where to add new flavor |
| `mobile/genie_ai_mobile/ios/Flutter/Release-itu.xcconfig` | XCConfig pattern — 3 files per flavor (Debug/Profile/Release) |
| `configs/keycloak/genie-realm.yaml` | Mobile client section — auto-created by keycloak-config-cli |
| `env` (lines 390-405) | `KC_MOBILE_CLIENT_ID` and `KC_MOBILE_REDIRECT_SCHEME` with documentation |
| `docker-compose.yaml` (keycloak-config service) | Where env vars must be passed through |
| `mobile/genie_ai_mobile/android/key.properties.example` | Signing config template |
| `mobile/genie_ai_mobile/CLAUDE.md` | Build commands, verification procedures, SSL cert setup |

### Existing Documentation to Reuse (Not Reinvent)

The guide should **reference** (not duplicate) existing verification procedures from `mobile/genie_ai_mobile/CLAUDE.md`:
- Build commands (lines 60-78)
- Android signing setup (lines 83-89)
- SSL certificate setup for emulator (lines 95-112)
- Custom URL scheme verification (lines 158-246)
- OIDC login flow verification (lines 114-127)

### Architecture Requirements

From `_bmad-output/planning-artifacts/architecture.md`:
- **FR17**: Each deployment has its own dedicated build with unique app ID, Keycloak client, backend URL, deep link scheme — all compiled at build-time
- **FR18**: Each deployment has its own Keycloak client configured as public client with PKCE mandatory, no client secret
- **FR19**: Operator can create a new deployment by following the documented guide
- **FR26**: Guide covers deployment configuration, Keycloak client creation, deep link setup, build, test
- **FR27**: Guide covers network prerequisites for air-gapped deployments
- **FR28**: Guide covers OS version policy trade-off
- **ADR3**: All deployment-specific configuration compiled at build-time via Flutter flavors (no runtime configuration)
- **D6**: Flavor config via `lib/config/` + `--dart-define`, no code generation

### Key Design Decisions to Communicate in the Guide

1. **No code generation** — manual XCConfig + Gradle product flavors + Dart switch. No flavorizr, no build_runner.
2. **keycloak-config-cli automation** — operators add env vars, Keycloak client is created automatically. No manual Keycloak admin console setup.
3. **keycloak-config-cli variable substitution syntax** — `$(env:VARIABLE)` (NOT `${env:VARIABLE}`). [Source: project-context.md#Keycloak Config CLI]
4. **Build command convention** — always `flutter build apk --flavor <name>` (no `--dart-define`, no `-t` flag). [Source: Story 4.1 review correction]
5. **flutter_appauth local fork** — a local fork at `flutter_appauth/` patches the `InsecureConnectionBuilder` bug (upstream issue #386). Before merging any story to `main`, `pubspec.yaml` must be reverted to `flutter_appauth: ^11.0.0` and the `flutter_appauth/` directory must be removed. The deployment guide should note this in the troubleshooting section. [Source: mobile/genie_ai_mobile/CLAUDE.md#Local flutter_appauth Fork]

### Previous Story Intelligence

**Story 4.1** established:
- iOS is the primary build system work (Android flavors already existed)
- Each new flavor requires changes in 4 layers (Dart, getConfig(), Gradle, XCConfig triplet)
- Build commands always use `--flavor <name>` syntax
- `key.properties.example` template exists for signing config

**Story 4.2** established:
- Mobile client in `genie-realm.yaml` uses `$(env:VARIABLE)` substitution syntax
- Mobile env vars are already passed to the `keycloak-config` service in `docker-compose.yaml` (lines 1202-1203)
- **Swarm constraint**: `env_file` does not work with `docker stack deploy`. Each new env var in `genie-realm.yaml` must be explicitly added to the `keycloak-config` service `environment:` block. The deployment guide documents this pattern — not a pitfall, just a known Swarm limitation.

**Story 4.3** established:
- Verification procedures for custom URL scheme registration (static manifest inspection + runtime verification)
- Cross-flavor routing test (two APKs on same device)
- Build commands in documentation should use `${ANDROID_HOME}` not hardcoded paths
- Glob patterns should be precise (e.g., `*-*.xcconfig` instead of `*.xcconfig`)

### Documentation Style

- Write in English (per CLAUDE.md language policy)
- Use imperative mood for instructions ("Copy the template file", not "You should copy the template file")
- Include concrete examples (show the `itu` flavor as reference)
- Use tables for structured information (flavor values, checklist items)
- Include exact file paths for all referenced files
- Reference existing docs rather than duplicating content
- Include "Expected" output annotations for verification commands

### Project Structure Notes

- New file: `site/content/en/docs/deployment/mobile-deployment-guide.md` — follows existing docs/ convention (`site/content/en/docs/architecture/architecture.md`, `site/content/en/docs/configuration/keycloak-admin-guide.md`, `site/content/en/docs/configuration/external-idp-integration-guide.md`)
- Modified file: `mobile/genie_ai_mobile/CLAUDE.md` — update prerequisite note to reference new guide
- No other files modified

### References

- [Source: _bmad-output/planning-artifacts/prd.md#Platform Requirements] — OS minimums, platform constraints
- [Source: _bmad-output/planning-artifacts/prd.md#Journey 7] — Amadou onboarding journey (under a day target)
- [Source: _bmad-output/planning-artifacts/prd.md#Journey 8] — Air-gapped deployment scenario
- [Source: _bmad-output/planning-artifacts/architecture.md#D6] — Flavor config system design
- [Source: _bmad-output/planning-artifacts/architecture.md#Open Architectural Questions #5] — keycloak-config-cli integration
- [Source: _bmad-output/planning-artifacts/epics.md#Story 4.4] — Acceptance criteria
- [Source: mobile/genie_ai_mobile/CLAUDE.md] — Build commands, verification procedures
- [Source: env#lines 390-405] — Mobile env var documentation
- [Source: configs/keycloak/genie-realm.yaml] — Mobile client section
- [Source: project-context.md#Keycloak Config CLI] — Variable substitution syntax rules
- [Source: Story 4.2 review] — docker-compose env var passthrough requirement
- [Source: Story 4.1 review] — Build command convention (`--flavor <name>` only)
- [Source: Story 4.3 review] — Documentation precision (exact paths, expected output, no hardcoded values)

## Dev Agent Record

### Agent Model Used

glm-5-turbo

### Debug Log References

None — documentation-only story, no code debugging required.

### Completion Notes List

- Created `site/content/en/docs/deployment/mobile-deployment-guide.md` with 11 sections covering the complete deployment onboarding flow
- Step 1 (Environment Variables): Documents KC_MOBILE_CLIENT_ID and KC_MOBILE_REDIRECT_SCHEME as required, no default, with silent failure warning
- Step 2 (Keycloak Client): Documents keycloak-config-cli automation with verification curl command
- Step 3 (Scheme Coherence Rule): 5-layer coherence table with ITU reference example and verification commands
- Step 4 (Flutter Flavor Configuration): 4-layer checklist (Dart, getConfig(), Gradle, XCConfig triplet) with code snippets
- Step 5 (Android Signing): Keystore creation and key.properties setup
- Step 6 (Build): Build commands for APK, AAB, and IPA using --flavor syntax
- Step 7 (Validate): OIDC end-to-end validation checklist (client verification, scheme registration, login, token refresh, logout)
- Air-Gapped Deployments: Network prerequisites, local DNS, SSL considerations
- OS Version Policy: Technical minimums table (iOS 13+, Android 6.0+) with MDM enforcement guidance
- App Store Submission: Google Play and Apple App Store requirements
- Rollback: Keycloak client removal, flavor revert, app store unpublish, end user communication
- Troubleshooting: 5 common issues with diagnosis and fix (scheme mismatch, missing key.properties, 401 after login, flutter_appauth fork, silent keycloak-config-cli failure)
- Updated `mobile/genie_ai_mobile/CLAUDE.md`: Replaced "until Epic 4 Story 4.2" prerequisite note with link to deployment guide
- Updated `env` template: Changed reference from CLAUDE.md to site/content/en/docs/deployment/mobile-deployment-guide.md

### File List

- `site/content/en/docs/deployment/mobile-deployment-guide.md` (new)
- `mobile/genie_ai_mobile/CLAUDE.md` (modified)
- `env` (modified)

### Change Log

- 2026-04-28: Created deployment onboarding guide with all sections per ACs #1-#9; updated cross-references in CLAUDE.md and env template

### Review Findings

#### Patch

- [x] [Review][Patch] XCConfig template structure doesn't match actual files [`site/content/en/docs/deployment/mobile-deployment-guide.md:181-206`] — Guide shows `#include? "Pods/Target Support Files/Pods-Runner/Pods-Runner.debug.xcconfig"` + `#include "Generated.xcconfig"` but actual XCConfig files use `#include "Generated.xcconfig"` + `#include "Debug.xcconfig"` (or `Release.xcconfig`/`Profile.xcconfig`). Copying the template literally will cause iOS build failures. (AC #7)
- [x] [Review][Patch] Undefined `<appId>` placeholder in Step 7.2 verification command [`site/content/en/docs/deployment/mobile-deployment-guide.md:276-278`] — `adb shell dumpsys package <appId>` references a placeholder never defined in the guide. Operators won't know to substitute the base `applicationId` from `build.gradle` (with optional `applicationIdSuffix`).

#### Deferred

- [x] [Review][Defer] Air-gapped section lacks concrete DNS configuration example [`site/content/en/docs/deployment/mobile-deployment-guide.md:310-317`] — deferred, could add /etc/hosts or dnsmasq example
- [x] [Review][Defer] No Docker service health check before running verification commands [`site/content/en/docs/deployment/mobile-deployment-guide.md:269-270`] — deferred, keycloak-config may not have finished client creation
- [x] [Review][Defer] Missing key.properties file permissions warning [`site/content/en/docs/deployment/mobile-deployment-guide.md:212-217`] — deferred, should recommend chmod 600 for signing credentials
- [x] [Review][Defer] Missing dependency resolution troubleshooting [`site/content/en/docs/deployment/mobile-deployment-guide.md`] — deferred, `flutter pub get` failure is a common first-build error not covered
- [x] [Review][Defer] App Store compliance requirements omitted [`site/content/en/docs/deployment/mobile-deployment-guide.md:346-368`] — deferred, Google Play Data Safety and Apple privacy manifests are non-optional
- [x] [Review][Defer] Version code/name management across deployments [`site/content/en/docs/deployment/mobile-deployment-guide.md`] — deferred, app stores require unique version codes per submission
