---
title: "Mobile Deployment Guide"
weight: 3
section: "deployment"
---

# GENIE.AI Mobile — Deployment Onboarding Guide

## Overview

This guide walks deployment technicians through creating a new institutional deployment of the GENIE.AI mobile app. Each deployment produces a dedicated build with its own app ID, Keycloak client, backend URL, and deep link scheme — all compiled at build-time via Flutter flavors.

**Target audience:** Deployment technicians familiar with Flutter, Gradle, Xcode, and Docker.

**Estimated time:** Under a day for a single deployment.

## Prerequisites

| Requirement | Purpose |
|-------------|---------|
| Flutter SDK 3.10+ | Build the mobile app |
| Android Studio (with SDK) | Android builds, Gradle, emulator |
| Xcode 14+ (macOS only) | iOS builds, signing, IPA creation |
| Docker + Docker Compose | Run Keycloak locally for testing |
| Device or emulator | End-to-end validation |
| Access to deployment `.env` | Configure Keycloak client and redirect scheme |
| Keystore for Android signing | Release builds (see [Step 5: Android Signing](#step-5-android-signing)) |

## Step 1: Environment Variables

Add two required variables to the deployment `.env` file:

```bash
# Mobile OIDC client for institutional deployments (Flutter app)
# Public client with PKCE — no client secret required (RFC 8252).
# REQUIRED — no default. Omitting causes silent keycloak-config-cli failure.
# Used by: keycloak-config-cli (creates the mobile OIDC client in Keycloak at startup)
KC_MOBILE_CLIENT_ID=genie-mobile-<institution>

# Mobile app custom URL scheme for OIDC callback redirect.
# REQUIRED — no default. Omitting causes silent keycloak-config-cli failure.
# See: Scheme Coherence Rule (Step 3) — this value must match 4 other config layers.
KC_MOBILE_REDIRECT_SCHEME=com.<institution>.genieai
```

> **Warning:** Unlike other Keycloak variables (e.g., `KC_CLIENT_ID` which defaults to `genie-app`), `KC_MOBILE_CLIENT_ID` and `KC_MOBILE_REDIRECT_SCHEME` have **no defaults**. Omitting them does not produce an error — keycloak-config-cli silently skips client creation, and the mobile app will fail to authenticate at runtime.

These variables are already passed to the `keycloak-config` service in `docker-compose.yaml` (lines 1202-1203). No manual docker-compose edit is needed — just set them in `.env` and restart the service.

## Step 2: Keycloak Client

keycloak-config-cli creates the mobile client automatically from the environment variables at container startup. The client definition is in `configs/keycloak/genie-realm.yaml` (lines 171-189).

**Client configuration (automatic):**

| Property | Value |
|----------|-------|
| Client ID | `$(env:KC_MOBILE_CLIENT_ID)` |
| Public client | Yes (no client secret — RFC 8252) |
| Standard flow | Enabled (Authorization Code + PKCE) |
| Direct Access Grants | Disabled (no ROPC) |
| PKCE method | S256 |
| Refresh token rotation | Enabled |
| Redirect URI | `$(env:KC_MOBILE_REDIRECT_SCHEME)://callback` |

After setting the environment variables and restarting the `keycloak-config` service, verify client creation:

```bash
# Get master admin token
KC_ADMIN_PWD=$(grep "^KEYCLOAK_ADMIN_PASSWORD=" .env | cut -d= -f2)
ADMIN_TOKEN=$(curl -sk -X POST "<KEYCLOAK_URL>/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=admin" -d "password=${KC_ADMIN_PWD}" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Verify client exists
curl -sk "<KEYCLOAK_URL>/admin/realms/genie/clients?clientId=<KC_MOBILE_CLIENT_ID>" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "import sys,json; c=json.load(sys.stdin); print('OK' if c else 'NOT FOUND')"
# Expected: OK
```

> **Swarm constraint:** In `docker stack deploy` mode, `env_file` does not propagate to `$(env:VAR)` substitution in `genie-realm.yaml`. Each environment variable used by keycloak-config-cli must be explicitly listed in the `keycloak-config` service `environment:` block in `docker-compose.yaml`. The mobile vars are already present (lines 1202-1203) — added in Story 4.2. Future vars will require the same manual addition.

## Step 3: Scheme Coherence Rule

The OIDC redirect scheme must match across **5 layers**. A mismatch between any layer causes **silent callback failure** — the browser redirects to the wrong scheme and the app never receives the authorization code.

| # | Layer | File | Field |
|---|-------|------|-------|
| 1 | Dart flavor config | `lib/config/flavors/<name>.dart` | `redirectScheme` |
| 2 | Android Gradle | `android/app/build.gradle` | `appAuthRedirectScheme` in `manifestPlaceholders` |
| 3 | iOS XCConfig | `ios/Flutter/Debug-<name>.xcconfig` (and `Release-`, `Profile-`) | `APP_AUTH_REDIRECT_SCHEME` |
| 4 | Deployment `.env` | `.env` | `KC_MOBILE_REDIRECT_SCHEME` |
| 5 | Keycloak realm config | `configs/keycloak/genie-realm.yaml` (via keycloak-config-cli) | `redirectUris[0]` |

**Reference example — ITU deployment:**

| Layer | Value |
|-------|-------|
| Dart `itu.dart` | `redirectScheme: 'com.itu.genieai'` |
| Gradle `itu` flavor | `appAuthRedirectScheme: "com.itu.genieai"` |
| iOS XCConfig (all 3) | `APP_AUTH_REDIRECT_SCHEME = com.itu.genieai` |
| `.env` | `KC_MOBILE_REDIRECT_SCHEME=com.itu.genieai` |
| Keycloak client | `redirectUris: ["com.itu.genieai://callback"]` |

**Verification commands:**

```bash
# Android — check registered scheme after install
adb shell dumpsys package <appId> | grep "Scheme:"
# Expected: Scheme: "com.<institution>.genieai"

# iOS — check XCConfig values (from repo root)
grep APP_AUTH_REDIRECT_SCHEME mobile/genie_ai_mobile/ios/Flutter/*-<name>.xcconfig
# Expected: all 3 files show the same scheme
```

## Step 4: Flutter Flavor Configuration

Adding a new deployment requires changes in **4 layers**. Follow the checklist below.

### Layer 1: Dart Flavor Config

Copy the template and fill in the values:

```bash
cp mobile/genie_ai_mobile/lib/config/flavors/template.dart \
   mobile/genie_ai_mobile/lib/config/flavors/<institution>.dart
```

Edit `lib/config/flavors/<institution>.dart`:

```dart
import '../keycloak_config.dart';

const config = KeycloakConfig(
  keycloakUrl: 'https://keycloak.<institution>.int',
  realm: 'genie',
  clientId: 'genie-mobile-<institution>',
  redirectScheme: 'com.<institution>.genieai',
  backendUrl: 'https://api.<institution>.int',
);
```

> **Remember:** `redirectScheme` must match `KC_MOBILE_REDIRECT_SCHEME` in `.env` (see [Step 3](#step-3-scheme-coherence-rule)).

### Layer 2: getConfig() Switch

Add a case in `lib/config/keycloak_config.dart`:

1. Add the import at the top: `import 'flavors/<institution>.dart' as <institution>_flavor;`
2. Add a case in the `getConfig()` switch:

```dart
case '<institution>':
  return <institution>_flavor.config;
```

### Layer 3: Android Gradle Product Flavor

Add a product flavor in `android/app/build.gradle` inside the `productFlavors` block:

```gradle
<institution> {
    dimension "environment"
    manifestPlaceholders = [
        appAuthRedirectScheme: "com.<institution>.genieai"
    ]
}
```

For development flavors, add `applicationIdSuffix ".<name>"` to avoid conflicts on the same device:

```gradle
dev {
    dimension "environment"
    applicationIdSuffix ".dev"
    manifestPlaceholders = [
        appAuthRedirectScheme: "com.itu.genieai.dev"
    ]
}
```

### Layer 4: iOS XCConfig Triplet

Create 3 files under `mobile/genie_ai_mobile/ios/Flutter/`:

**`Debug-<name>.xcconfig`:**
```
#include "Generated.xcconfig"
#include "Debug.xcconfig"

PRODUCT_BUNDLE_IDENTIFIER = com.example.genieAiMobile
APP_AUTH_REDIRECT_SCHEME = com.<institution>.genieai
```

**`Release-<name>.xcconfig`:**
```
#include "Generated.xcconfig"
#include "Release.xcconfig"

PRODUCT_BUNDLE_IDENTIFIER = com.example.genieAiMobile
APP_AUTH_REDIRECT_SCHEME = com.<institution>.genieai
```

**`Profile-<name>.xcconfig`:**
```
#include "Generated.xcconfig"
#include "Release.xcconfig"

PRODUCT_BUNDLE_IDENTIFIER = com.example.genieAiMobile
APP_AUTH_REDIRECT_SCHEME = com.<institution>.genieai
```

> **Note:** Replace `PRODUCT_BUNDLE_IDENTIFIER` with the unique bundle ID for this deployment. Each deployment needs a unique bundle ID for App Store distribution.

## Step 5: Android Signing

Release builds require a `key.properties` file in `mobile/genie_ai_mobile/android/` (gitignored). Copy from the template:

```bash
cp mobile/genie_ai_mobile/android/key.properties.example \
   mobile/genie_ai_mobile/android/key.properties
```

Generate a keystore (if one doesn't exist for this deployment):

```bash
keytool -genkeypair -v \
  -keystore <institution>-release.keystore \
  -alias <institution> \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

Edit `android/key.properties` with the keystore values:

```
storePassword=<your-store-password>
keyPassword=<your-key-password>
keyAlias=<institution>
storeFile=<path-to-<institution>-release.keystore>
```

## Step 6: Build

Build commands always use `--flavor <name>` syntax. Do not use `--dart-define` or `-t` flags.

```bash
cd mobile/genie_ai_mobile

# Android APK (debug)
ANDROID_HOME=${ANDROID_HOME} flutter build apk --flavor <institution> --debug

# Android APK (release)
ANDROID_HOME=${ANDROID_HOME} flutter build apk --flavor <institution> --release

# Android App Bundle (for Google Play)
ANDROID_HOME=${ANDROID_HOME} flutter build appbundle --flavor <institution> --release

# iOS IPA (macOS only)
flutter build ipa --flavor <institution>
```

For detailed build and run instructions, see `mobile/genie_ai_mobile/CLAUDE.md`.

## Step 7: Validate

Run through this checklist after completing the flavor configuration.

### 7.1 Verify Keycloak Client Exists

```bash
curl -sk "<KEYCLOAK_URL>/admin/realms/genie/clients?clientId=<KC_MOBILE_CLIENT_ID>" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# Expected: JSON array with one client matching the clientId
```

### 7.2 Verify Scheme Registered (Android)

```bash
adb install -r build/app/outputs/flutter-apk/app-<institution>-release.apk
# appId = base applicationId from build.gradle defaultConfig
# + applicationIdSuffix from the product flavor (if any)
adb shell dumpsys package <appId> | grep "Scheme:"
# Expected: Scheme: "com.<institution>.genieai"
```

### 7.3 Test Login Flow

Install the app on a device or emulator and complete the OIDC login flow:

1. Launch the app
2. Tap "Sign In"
3. Keycloak login page opens in the system browser
4. Enter credentials and authorize
5. App receives the callback and navigates to the authenticated state

For automated verification, see `mobile/genie_ai_mobile/CLAUDE.md#Verify OIDC Login Flow`.

### 7.4 Verify Token Refresh

1. Log in successfully
2. Background the app and wait for the access token to expire (default: 5 minutes)
3. Resume the app
4. The app should automatically refresh the token without prompting the user

### 7.5 Verify Logout Terminates Keycloak Session

1. Log in
2. Tap "Log Out"
3. Verify in Keycloak Admin Console that the session is terminated (or use the Admin API to check active sessions)

For detailed verification procedures, see `mobile/genie_ai_mobile/CLAUDE.md#Verify Logout`.

### 7.6 Verify Password Reset

**Prerequisite:** SMTP must be configured (`EMAIL_HOST`, `EMAIL_USER` set in `.env`). If SMTP is not set up, Keycloak logs an error but shows no user-facing message — the user submits their email but never receives a reset link.

1. Launch the app and tap "Sign In"
2. On the Keycloak login page in the system browser, verify the "Forgot Password" link is visible
3. Tap "Forgot Password" → Keycloak shows the email input form
4. Enter a test user email and submit → check that the email is sent (verify in SMTP logs or mailbox)
5. Tap the reset link in the email → verify it opens the Keycloak reset page in the **system browser** (not the app). On Android, no disambiguation dialog should appear if App Links are configured correctly.
6. Set a new password and submit
7. Return to the app and tap "Sign In" → authenticate with the new password
8. To verify AC5 (disable): set `KEYCLOAK_RESET_PASSWORD=false` in `.env`, restart the `keycloak-config` service (`docker service update --force genieai_keycloak-config` in Swarm, or `docker compose restart keycloak-config` in Compose), then refresh the Keycloak login page — the "Forgot Password" link must no longer appear

> **Note:** After changing `KEYCLOAK_RESET_PASSWORD`, the `keycloak-config` one-shot service must be restarted to apply the realm setting. Restarting Keycloak alone is not sufficient.

## Password Reset

Password reset is a Keycloak built-in feature. The "Forgot Password" link appears on the Keycloak login page (rendered in the system browser) — the app does not control its visibility.

### Configuration

| Variable | Default | Purpose |
|----------|---------|---------|
| `KEYCLOAK_RESET_PASSWORD` | `true` | Enable/disable "Forgot Password" on Keycloak login page |
| `EMAIL_HOST` | (required) | SMTP server hostname |
| `EMAIL_PORT` | (required) | SMTP server port |
| `EMAIL_SECURE` | `false` | Use SSL/TLS for SMTP |
| `EMAIL_USER` | (required) | SMTP authentication username |
| `EMAIL_PASSWORD` | (required) | SMTP authentication password |
| `EMAIL_FROM` | (required) | Sender email address |

Set `KEYCLOAK_RESET_PASSWORD=false` in `.env` to hide the "Forgot Password" link. This is a Keycloak realm setting — the app has no control over it.

> **Important:** SMTP must be configured (`EMAIL_*` variables) for password reset emails to work. If SMTP is not set up, Keycloak logs an error but shows no user-facing message — the user submits their email but never receives a reset link.

### How It Works

1. User taps "Sign In" in the app → system browser opens the Keycloak login page
2. User taps "Forgot Password" on Keycloak's page → Keycloak shows the reset form (all in browser)
3. User submits their email → Keycloak sends a reset email via SMTP
4. User taps the reset link in the email → system browser opens the Keycloak reset page (HTTPS URL)
5. User sets a new password → returns to the app → taps "Sign In" → authenticates with the new password

> **Note:** Password reset links always open in the system browser because Keycloak uses HTTPS URLs. The app only registers a custom URL scheme (`<redirectScheme>://callback`) for OIDC callbacks — it does not intercept HTTPS links. Universal Links/App Links ensure the system browser opens without disambiguation dialogs on Android.

### Customization (Optional)

For advanced password reset configuration, use the Keycloak Admin Console:

- Custom email templates (realm settings → Email tab)
- Brute force detection thresholds (realm settings → Security Defenses)
- Password policy requirements (realm settings → Password Policy)
- Reset link expiration time

## Universal Links & App Links

Universal Links (iOS) and App Links (Android) use cryptographic domain verification to ensure that password reset and email verification links open in the **system browser** instead of triggering Android's disambiguation dialog.

> **⚠️ CRITICAL: Customize Verification Files Before Deployment**
>
> The verification files in `api-gateway-solution/nginx/conf/` contain **placeholder values** (`<TEAM_ID>`, `<BUNDLE_ID>`, `<APPLICATION_ID>`, `<SHA256_FINGERPRINT>`) that **MUST be replaced** with your deployment-specific values before building the nginx Docker image. If deployed without customization, App Links verification will fail silently.
>
> See `api-gateway-solution/nginx/conf/README.md` for detailed customization instructions.

### How It Works

The app uses a **dual deep link mechanism**:

| Mechanism | Platform | Purpose | Protocol |
|-----------|----------|---------|----------|
| Custom URL scheme | iOS + Android | OIDC callbacks only | `com.<institution>.genieai://callback` |
| Universal Links / App Links | iOS / Android | Password reset, email verification | `https://<domain>/...` |

Custom URL schemes are configured via `RedirectUriReceiverActivity` (Android) and `CFBundleURLSchemes` (iOS). These are **not affected** by this section.

### iOS: apple-app-site-association

Host the verification file at `https://<keycloak-domain>/.well-known/apple-app-site-association` (no `.json` extension in the URL).

```json
{
  "applinks": {
    "details": [
      {
        "appIDs": ["<TEAM_ID>.<BUNDLE_ID>"],
        "components": [
          "/**"
        ]
      }
    ]
  }
}
```

| Placeholder | Value |
|-------------|-------|
| `<TEAM_ID>` | Apple Developer Team ID (from Apple Developer Portal) |
| `<BUNDLE_ID>` | App bundle identifier per flavor (e.g., `com.example.genieAiMobile`) |

The file is served by nginx — no action needed beyond deploying the updated `apple-app-site-association` file.

#### iOS Associated Domains Entitlement

The entitlements file at `mobile/genie_ai_mobile/ios/Runner/Runner.entitlements` uses `$(ASSOCIATED_DOMAINS)` which is set per flavor in the XCConfig files. For a new deployment, add the `ASSOCIATED_DOMAINS` variable to all 3 XCConfig files (`Debug-<name>.xcconfig`, `Release-<name>.xcconfig`, `Profile-<name>.xcconfig`):

```
ASSOCIATED_DOMAINS = applinks:<keycloak-domain>
```

The entitlements file and `.pbxproj` reference are already configured. Only the XCConfig variable needs to be set per deployment.

> **🔔 CRITICAL: Apple CDN Cache Delay**
>
> Apple's CDN caches the AASA file for **up to 24 hours**. After updating `apple-app-site-association`, Universal Links may not work immediately.
>
> **DO NOT waste hours debugging** — Use Apple's [App Search Validation Tool](https://search.developer.apple.com/appsearch-validation-tool/) for **instant verification** instead of waiting for CDN propagation.
>
> **Testing workaround:** During development, add a query parameter to your test URLs (e.g., `?_test=123`) to bypass CDN cache, or temporarily change the `ASSOCIATED_DOMAINS` value to force re-fetch.

### Android: assetlinks.json

Host the verification file at `https://<keycloak-domain>/.well-known/assetlinks.json`.

```json
[
  {
    "relation": ["delegate_permission/common.handle_all_urls"],
    "target": {
      "namespace": "android_app",
      "package_name": "<APPLICATION_ID>",
      "sha256_cert_fingerprints": ["<SHA256_FINGERPRINT>"]
    }
  }
]
```

| Placeholder | Value |
|-------------|-------|
| `<APPLICATION_ID>` | Android application ID per flavor (e.g., `com.example.genie_ai_mobile`) |
| `<SHA256_FINGERPRINT>` | SHA-256 fingerprint of the app signing certificate |

> **⚠️ IMPORTANT: Debug vs Release Fingerprints**
>
> Debug and release certificates have **different SHA256 fingerprints**. If you deploy both debug and release builds to the same device, you **must include both fingerprints** in `assetlinks.json`:
>
> ```json
> "sha256_cert_fingerprints": [
>   "<DEBUG_SHA256>",
>   "<RELEASE_SHA256>"
> ]
> ```
>
> Otherwise, App Links verification will fail for one of the build variants.

To obtain the SHA-256 fingerprint:

```bash
# Debug certificate (local development)
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android | grep SHA256

# Release certificate (production builds)
keytool -list -v -keystore <path-to-keystore> -alias <alias> | grep SHA256
```

The file is served by nginx — no action needed beyond deploying the updated `assetlinks.json` file.

#### Android App Links Intent Filter

The intent filter with `android:autoVerify="true"` is already configured in `AndroidManifest.xml` on `MainActivity`. The `${nginxPublicDomain}` placeholder is set per flavor in `build.gradle`. For a new deployment, add `nginxPublicDomain` to the flavor's `manifestPlaceholders`:

```gradle
<institution> {
    dimension "environment"
    manifestPlaceholders = [
        appAuthRedirectScheme: "com.<institution>.genieai",
        nginxPublicDomain: "<keycloak-domain>"
    ]
}
```

Android verifies App Links at install time — no CDN caching delay.

### Nginx Configuration

Both verification files are served by the nginx reverse gateway. The location blocks are in `api-gateway-solution/nginx/conf/default.conf.template` (placed before the SPA catch-all `location /`):

```nginx
# Android App Links verification
location = /.well-known/assetlinks.json {
    default_type application/json;
    alias /etc/nginx/conf.d/assetlinks.json;
}

# iOS Universal Links verification
location = /.well-known/apple-app-site-association {
    default_type text/plain;
    alias /etc/nginx/conf.d/apple-app-site-association;
}
```

The files are copied into the nginx Docker image via the Dockerfile. After customizing the JSON files for your deployment, rebuild and redeploy the nginx service.

### Verification Testing

**Android:**

```bash
# Force re-verification of App Links
adb shell pm verify-app-links --re-verify <application_id>

# Check verification status
adb shell pm get-app-links <application_id>
# Expected: all domains show "approved"

# Test a password reset URL
adb shell am start -a android.intent.action.VIEW \
  -c android.intent.category.BROWSABLE \
  -d "https://<keycloak-domain>/realms/genie/login-actions/action?code=test"
# Expected: opens in system browser (no disambiguation dialog)
```

**iOS:**

1. Use Apple's [App Search Validation Tool](https://search.developer.apple.com/appsearch-validation-tool/) — submit the AASA URL and verify the domain association
2. On-device test: install the app, tap a Keycloak HTTPS link in the Notes app — should open in Safari (not the app)

**nginx (both platforms):**

```bash
curl -s https://<keycloak-domain>/.well-known/assetlinks.json | python3 -m json.tool
# Expected: valid JSON array with your app's package_name and fingerprint

curl -s https://<keycloak-domain>/.well-known/apple-app-site-association | python3 -m json.tool
# Expected: valid JSON with applinks.details array
```

## Air-Gapped Deployments

GENIE.AI mobile OIDC works identically whether Keycloak is internet-facing or on an internal network. The only requirement is that the **device must be able to reach Keycloak** at runtime.

### Network Prerequisites

- The mobile device must resolve the Keycloak hostname (e.g., `keycloak.<institution>.int`)
- Configure local DNS or `/etc/hosts` on the device if no internal DNS server is available
- The device must be on the same network or VPN as the Keycloak server
- No external internet access is required for OIDC — the entire flow stays within the internal network

### SSL Considerations

- Air-gapped deployments typically use self-signed certificates
- For Android emulator testing, install the certificate on the emulator (see `mobile/genie_ai_mobile/CLAUDE.md#Emulator SSL Certificate Setup`)
- For production devices, install the CA certificate via MDM profile or device policy

## OS Version Policy

| Platform | Technical Minimum | Rationale |
|----------|-------------------|-----------|
| iOS | 13.0+ | `ASWebAuthenticationSession` (system browser SSO) + PKCE support |
| Android | 6.0+ (API 23) | `EncryptedSharedPreferences` for secure token storage |

### Security Patch Considerations

- The technical minimums ensure OIDC functionality
- Institutional security policies may require higher minimums
- Check for known CVEs in the target OS version before deployment
- MDM policies can enforce minimum OS version requirements

### MDM Enforcement Recommendation

For institutional deployments, enforce OS version policies via MDM:

- **iOS:** Configuration Profile → Restrictions → Minimum OS version
- **Android:** EMM policy → Device policy → System update requirements

## App Store Submission

### Google Play

1. Build the Android App Bundle: `flutter build appbundle --flavor <institution> --release`
2. **Signing:** Use the keystore created in [Step 5](#step-5-android-signing)
3. **Content rating:** Complete the Google Play content rating questionnaire
4. **Privacy policy:** Provide a URL to the institution's privacy policy
5. **Target API level:** Ensure `targetSdkVersion` meets Google Play's current requirements

### Apple App Store

1. Build the IPA: `flutter build ipa --flavor <institution>`
2. **Apple Developer account:** Each deployment needs a unique bundle ID registered in App Store Connect
3. **Provisioning profiles:** Create distribution provisioning profiles per deployment bundle ID
4. **App Review:** Prepare screenshots, description, and review notes for the App Store review process

### Signing Certificate Management

- Maintain separate keystores/provisioning profiles per deployment
- Store signing credentials securely (do not commit to version control)
- `key.properties` is gitignored — never commit signing secrets
- Document the keystore location and password in a secure credential store (not in this repo)

## Rollback

### Remove Keycloak Client

```bash
# Find the client UUID
CLIENT_UUID=$(curl -sk "<KEYCLOAK_URL>/admin/realms/genie/clients?clientId=<KC_MOBILE_CLIENT_ID>" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

# Delete the client
curl -sk -X DELETE "<KEYCLOAK_URL>/admin/realms/genie/clients/$CLIENT_UUID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Revert Flavor Configuration

```bash
# Revert all flavor-related changes
git revert <commit-hash> --no-commit
git diff --cached  # Review before committing
git commit -m "revert: remove <institution> deployment flavor"
```

### Unpublish from App Stores

- **Google Play:** Create a new release with 0% rollout and unpublish the app
- **Apple App Store:** Remove from sale in App Store Connect

### End User Communication

- Notify users before rollback (via institution communication channels)
- Provide clear instructions: "Uninstall the app and install the previous version"
- Set a support contact for users who experience issues during transition

## Troubleshooting

### OIDC Callback Not Received

**Symptom:** User authenticates successfully in the browser, but the app stays on the login screen.

**Cause:** Redirect scheme mismatch between layers (see [Step 3](#step-3-scheme-coherence-rule)).

**Fix:** Verify all 5 layers match:
```bash
# Check .env
grep KC_MOBILE_REDIRECT_SCHEME .env

# Check Dart config
grep redirectScheme mobile/genie_ai_mobile/lib/config/flavors/<name>.dart

# Check Gradle
grep appAuthRedirectScheme mobile/genie_ai_mobile/android/app/build.gradle

# Check iOS XCConfig
grep APP_AUTH_REDIRECT_SCHEME mobile/genie_ai_mobile/ios/Flutter/*-<name>.xcconfig

# Check Keycloak client
curl -sk "<KEYCLOAK_URL>/admin/realms/genie/clients?clientId=<KC_MOBILE_CLIENT_ID>" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['redirectUris'])"
```

### Build Failure: Missing key.properties

**Symptom:** Release build fails with `keystoreProperties` is null.

**Cause:** `android/key.properties` not created.

**Fix:** Copy from template:
```bash
cp mobile/genie_ai_mobile/android/key.properties.example \
   mobile/genie_ai_mobile/android/key.properties
# Fill in keystore values
```

### 401 After Login

**Symptom:** User logs in successfully, but API calls return 401 Unauthorized.

**Cause:** Backend cannot validate the token (typically a network issue between backend and Keycloak, not a mobile issue).

**Fix:** Check that the backend service can reach Keycloak:
```bash
docker compose logs backend --since 30s | grep -v health
```

### flutter_appauth Local Fork

The `pubspec.yaml` may point to a local fork of `flutter_appauth` at `flutter_appauth/` that patches the `InsecureConnectionBuilder` bug (upstream issue [#386](https://github.com/MaikuB/flutter_appauth/issues/386)).

**This fork is for development only.** Before merging any changes to `main`, revert:
1. In `pubspec.yaml`: replace the local fork path with `flutter_appauth: ^11.0.0`
2. Remove the `flutter_appauth/` directory

The fork does not affect production builds (production uses CA-signed certs and `allowInsecureConnections=false`).

### keycloak-config-cli Silent Failure

**Symptom:** Keycloak client not created, no error in logs.

**Cause:** `KC_MOBILE_CLIENT_ID` or `KC_MOBILE_REDIRECT_SCHEME` missing from `.env`.

**Fix:** Set both variables in `.env` and restart the `keycloak-config` service. See [Step 1](#step-1-environment-variables).
