---
title: "Mobile Deployment Guide"
description: "Building and deploying the GENIE.AI mobile app (Android/iOS): flavor onboarding, signing, and release."
weight: 3
section: "mobile"
mode: how-to
persona: developer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

## Overview

This guide walks deployment technicians through shipping a new institutional build of the GENIE.AI mobile app. Each deployment produces a dedicated build with its own app ID, Keycloak client, backend URL, deep-link scheme, and asset-link fingerprints — all wired at build time via Flutter flavors.

**Audience:** Deployment technicians familiar with Flutter, Gradle, Xcode, and Docker.

**Estimated time:** Under a day for a single deployment.

## Placeholders used in this guide

Every `<PLACEHOLDER>` in the code blocks below must be substituted before running. Export them into the shell once, then copy-paste from there:

```bash
# Substitute before running any command in this guide.
export KEYCLOAK_URL="https://keycloak.<your-domain>"
export KC_MOBILE_CLIENT_ID="genie-mobile-<institution>"
export KC_MOBILE_REDIRECT_SCHEME="com.<institution>.genieai"
export APPLICATION_ID="com.example.genie_ai_mobile"
export BUNDLE_ID="com.example.genieAiMobile"
export TEAM_ID="<Apple Developer Team ID>"
export SHA256_FINGERPRINT="<release-key SHA-256>"
```

| Placeholder | Where to find it |
|-------------|-----------------|
| `<KEYCLOAK_URL>` | The public URL of your Keycloak instance |
| `<institution>` | Your institution short name (lowercase, no spaces) |
| `<KC_MOBILE_CLIENT_ID>` | The mobile OIDC client ID (defaults to `genie-mobile-<institution>`) |
| `<KC_MOBILE_REDIRECT_SCHEME>` | Reverse-DNS scheme, e.g. `com.<institution>.genieai` |
| `<APPLICATION_ID>` | Android `applicationId` from `build.gradle` (e.g. `com.example.genie_ai_mobile`) |
| `<BUNDLE_ID>` | iOS `PRODUCT_BUNDLE_IDENTIFIER` from the XCConfig triplet |
| `<TEAM_ID>` | Apple Developer Team ID (from [Apple Developer Portal](https://developer.apple.com/account)) |
| `<SHA256_FINGERPRINT>` | Output of `keytool -list -v -keystore <keystore>` for the release key |

## Prerequisites

| Requirement | Purpose |
|-------------|---------|
| Flutter SDK 3.38+ (Dart SDK 3.10.8+, per pubspec.yaml and pubspec.lock) | Build the mobile app |
| Android Studio (with SDK) | Android builds, Gradle, emulator |
| Xcode 14+ (macOS only) | iOS builds, signing, IPA creation |
| Access to the running stack | The `keycloak-config` service must be reachable to import the realm |
| Device or emulator | End-to-end validation |
| Access to deployment `.env` | Configure Keycloak client and redirect scheme |
| Keystore for Android signing | Release builds (see [Step 5](#step-5-android-signing)) |

## Step 1: Environment variables

Add two required variables to the deployment `.env` file:

```bash
# Mobile OIDC client for institutional deployments (Flutter app)
# Public client with PKCE — no client secret required (RFC 8252).
# REQUIRED — no default. Omitting causes silent keycloak-config-cli failure.
KC_MOBILE_CLIENT_ID=genie-mobile-<institution>

# Mobile app custom URL scheme for OIDC callback redirect.
# REQUIRED — no default. Omitting causes silent keycloak-config-cli failure.
KC_MOBILE_REDIRECT_SCHEME=com.<institution>.genieai
```

> **Warning:** `KC_MOBILE_CLIENT_ID` and `KC_MOBILE_REDIRECT_SCHEME` have **no defaults** (unlike `KC_CLIENT_ID` which defaults to `genie-app`). Omitting them does not produce an error — `keycloak-config-cli` silently skips client creation and the app fails to authenticate at runtime.

**Preflight check before editing:**

```bash
# Confirm the variables are not already set on this deployment
grep -E "^KC_MOBILE" .env || echo "not set — add them"
```

These variables are already wired into the `keycloak-config` service in `docker-compose.yaml` (lines 1591-1592). No `docker-compose.yaml` edit is needed — just set them in `.env` and restart the service.

```bash
# Docker Swarm
docker service update --force genieai_keycloak-config
# Docker Compose
docker compose restart keycloak-config
```

## Step 2: Keycloak client

`keycloak-config-cli` creates the mobile client automatically from the environment variables at container startup. The client definition is in `configs/keycloak/genie-realm.yaml` (lines 158-178).

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
ADMIN_TOKEN=$(curl -sk -X POST "$KEYCLOAK_URL/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=admin" -d "password=${KC_ADMIN_PWD}" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Verify client exists
curl -sk "$KEYCLOAK_URL/admin/realms/genie/clients?clientId=$KC_MOBILE_CLIENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "import sys,json; c=json.load(sys.stdin); print('OK' if c else 'NOT FOUND')"
# Expected: OK
```

> **Swarm constraint:** In `docker stack deploy` mode, `env_file` does not propagate to `$(env:VAR)` substitution in `genie-realm.yaml`. Each environment variable used by `keycloak-config-cli` must be explicitly listed in the `keycloak-config` service `environment:` block in `docker-compose.yaml`. The mobile vars are already present (lines 1591-1592). Future vars will require the same manual addition.

## Step 3: Scheme coherence rule

The OIDC redirect scheme must match across **5 layers**. A mismatch between any layer causes **silent callback failure** — the browser redirects to the wrong scheme and the app never receives the authorization code.

| # | Layer | File | Field |
|---|-------|------|-------|
| 1 | Dart flavor config | `lib/config/flavors/<name>.dart` | `redirectScheme` |
| 2 | Android Gradle | `android/app/build.gradle` | `appAuthRedirectScheme` in `manifestPlaceholders` |
| 3 | iOS XCConfig | `ios/Flutter/Debug-<name>.xcconfig` (and `Release-`, `Profile-`) | `APP_AUTH_REDIRECT_SCHEME` |
| 4 | Deployment `.env` | `.env` | `KC_MOBILE_REDIRECT_SCHEME` |
| 5 | Keycloak realm config | `configs/keycloak/genie-realm.yaml` (via keycloak-config-cli) | `redirectUris[0]` |

**Reference — ITU deployment:**

| Layer | Value |
|-------|-------|
| Dart `itu.dart` | `redirectScheme: 'com.itu.genieai'` |
| Gradle `itu` flavor | `appAuthRedirectScheme: "com.itu.genieai"` |
| iOS XCConfig (all 3) | `APP_AUTH_REDIRECT_SCHEME = com.itu.genieai` |
| `.env` | `KC_MOBILE_REDIRECT_SCHEME=com.itu.genieai` |
| Keycloak client | `redirectUris: ["com.itu.genieai://callback"]` |

**Verification:**

```bash
# Android — check the registered scheme after install
adb shell dumpsys package <applicationId> | grep "Scheme:"
# Expected: Scheme: "com.<institution>.genieai"
# If empty: the app is not installed as a release build, or the manifestPlaceholders
# weren't applied — re-run Step 4 Layer 3 and rebuild.

# iOS — confirm all 3 XCConfig files use the same scheme
grep APP_AUTH_REDIRECT_SCHEME mobile/genie_ai_mobile/ios/Flutter/*-<name>.xcconfig
# Expected: all 3 files show the same scheme
# If they diverge: edit the file that drifted and rebuild.
```

## Step 4: Flutter flavor configuration

Adding a new deployment requires changes in **4 layers**.

### Layer 1 — Dart flavor config

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

> `redirectScheme` must match `KC_MOBILE_REDIRECT_SCHEME` in `.env` (see [Step 3](#step-3-scheme-coherence-rule)).

### Layer 2 — `getConfig()` switch

Edit `lib/config/keycloak_config.dart`:

1. Add the import: `import 'flavors/<institution>.dart' as <institution>_flavor;`
2. Add a case in the `getConfig()` switch:

```dart
case '<institution>':
  return <institution>_flavor.config;
```

### Layer 3 — Android Gradle product flavor

Add a product flavor in `android/app/build.gradle` inside the `productFlavors` block:

```gradle
<institution> {
    dimension "environment"
    manifestPlaceholders = [
        appAuthRedirectScheme: "com.<institution>.genieai"
    ]
}
```

For development flavors, add `applicationIdSuffix ".<name>"` to allow side-by-side install on the same device:

```gradle
dev {
    dimension "environment"
    applicationIdSuffix ".dev"
    manifestPlaceholders = [
        appAuthRedirectScheme: "com.itu.genieai.dev"
    ]
}
```

> **Note:** Only `appAuthRedirectScheme` is wired into `manifestPlaceholders`. The `nginxPublicDomain` placeholder shown in earlier revisions of this guide is **not** present in the current `build.gradle` and is not required for App Links — see [Step 9](#step-9-universal-links--app-links) for the actual App Links wiring.

### Layer 4 — iOS XCConfig triplet

Create three files under `mobile/genie_ai_mobile/ios/Flutter/`:

**`Debug-<name>.xcconfig`:**

```
#include "Generated.xcconfig"
#include "Debug.xcconfig"

PRODUCT_BUNDLE_IDENTIFIER = <bundle-id>
APP_AUTH_REDIRECT_SCHEME = com.<institution>.genieai
ASSOCIATED_DOMAINS = applinks:<keycloak-domain>
```

**`Release-<name>.xcconfig`:**

```
#include "Generated.xcconfig"
#include "Release.xcconfig"

PRODUCT_BUNDLE_IDENTIFIER = <bundle-id>
APP_AUTH_REDIRECT_SCHEME = com.<institution>.genieai
ASSOCIATED_DOMAINS = applinks:<keycloak-domain>
```

**`Profile-<name>.xcconfig`:**

```
#include "Generated.xcconfig"
#include "Release.xcconfig"

PRODUCT_BUNDLE_IDENTIFIER = <bundle-id>
APP_AUTH_REDIRECT_SCHEME = com.<institution>.genieai
ASSOCIATED_DOMAINS = applinks:<keycloak-domain>
```

Replace `PRODUCT_BUNDLE_IDENTIFIER` with the unique bundle ID for this deployment. Each deployment needs a unique bundle ID for App Store distribution.

## Step 5: Android signing

Release builds require a `key.properties` file in `mobile/genie_ai_mobile/android/` (gitignored). The template lives at `mobile/genie_ai_mobile/android/key.properties.example`.

**Verify the template exists:**

```bash
ls mobile/genie_ai_mobile/android/key.properties.example
# If missing, the file content is reproduced below — save it manually.
```

**Expected `key.properties` format:**

```
storePassword=<your-store-password>
keyPassword=<your-key-password>
keyAlias=<your-key-alias>
storeFile=<path-to-your-keystore.jks>
```

> Placeholder names: `<your-key-alias>` and `<path-to-your-keystore.jks>` (not `<institution>` — those are placeholder names from the upstream Android signing-config example).

**Copy and fill:**

```bash
cp mobile/genie_ai_mobile/android/key.properties.example \
   mobile/genie_ai_mobile/android/key.properties
# Edit key.properties with your keystore values
```

Generate a keystore if one doesn't exist:

```bash
keytool -genkeypair -v \
  -keystore <institution>-release.keystore \
  -alias <institution> \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000
```

> **Security:** Restrict permissions on the file immediately after editing — `key.properties` contains plaintext passwords for the signing keystore:
>
> ```bash
> chmod 600 mobile/genie_ai_mobile/android/key.properties
> ```
>
> The file is gitignored, but restrictive permissions prevent other local users or processes from reading the credentials.

## Step 6: Build

Build commands use `--flavor <name>` to select the Flutter flavor. `--dart-define` is reserved for `DEV_SERVER`/`DEV_PORT` overrides on the dev flavor only (see `mobile/genie_ai_mobile/CLAUDE.md`); do **not** use it for general flavor builds.

```bash
cd mobile/genie_ai_mobile

# Android APK (debug)
flutter build apk --flavor <institution> --debug

# Android APK (release)
flutter build apk --flavor <institution> --release

# Android App Bundle (for Google Play)
flutter build appbundle --flavor <institution> --release

# iOS IPA (macOS only)
flutter build ipa --flavor <institution>
```

For detailed build and run instructions, see `mobile/genie_ai_mobile/CLAUDE.md`.

## Step 7: Validate

Run through this checklist after completing the flavor configuration.

### 7.0 Verify service health (prerequisite)

Before running verification commands, confirm that the `keycloak-config` service has finished importing the realm configuration. Running verification too early produces misleading "NOT FOUND" results.

```bash
# Docker Swarm
docker service logs genieai_keycloak-config --since 5m 2>&1 | grep -i "import\|success\|completed"
# Docker Compose
docker compose logs keycloak-config --since 5m 2>&1 | grep -i "import\|success\|completed"
```

If no success message appears within 2-3 minutes, check service status and restart if needed:

```bash
# Swarm
docker service ps genieai_keycloak-config
# Compose
docker compose ps keycloak-config
```

Also confirm Keycloak is responding:

```bash
curl -sk -o /dev/null -w "%{http_code}" "$KEYCLOAK_URL/realms/master"
# Expected: 200
```

### 7.1 Verify Keycloak client exists

```bash
curl -sk "$KEYCLOAK_URL/admin/realms/genie/clients?clientId=$KC_MOBILE_CLIENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
# Expected: JSON array with one client matching the clientId
# Empty array: client was not imported — check Step 1 env vars and keycloak-config logs
```

### 7.2 Verify scheme registered (Android)

```bash
adb install -r build/app/outputs/flutter-apk/app-<institution>-release.apk
# applicationId = base applicationId + flavor applicationIdSuffix (if any)
adb shell dumpsys package <applicationId> | grep "Scheme:"
# Expected: Scheme: "com.<institution>.genieai"
# Empty: scheme not registered — re-run Step 4 Layer 3, rebuild, reinstall
```

### 7.3 Test login flow

Install the app on a device or emulator and complete the OIDC login flow:

1. Launch the app → the OIDC login screen appears.
2. Tap **Sign In**.
3. The system browser (Chrome Custom Tabs on Android, Safari/ASWebAuthenticationSession on iOS) opens the Keycloak login page at `$KEYCLOAK_URL/realms/genie`.
4. Enter credentials and tap **Authorize** (or **Submit**).
5. The browser redirects to `<redirectScheme>://callback?...` and the app receives the authorization code.
6. The app exchanges the code for tokens, persists them, and navigates to the authenticated state (chat view).

For automated verification, see `mobile/genie_ai_mobile/CLAUDE.md#Verify OIDC Login Flow`. For the underlying protocol, see [User Authentication](/docs/mobile/user-authentication/).

> **Reference screenshots** — capture the canonical login screen, system-browser handover, and authenticated home screens per deployment and store them alongside the deployment runbook (no canonical `mobile/genie_ai_mobile/screenshots/` directory is shipped in the repo).

### 7.4 Verify token refresh

1. Log in successfully.
2. Background the app and wait for the access token to expire (default: 5 minutes).
3. Resume the app.
4. The app refreshes the token transparently — no user prompt, no re-login.

If the user is bounced back to the login screen, the refresh token has been revoked (e.g. by an `/api/auth/logout` from another device). See [User Authentication](/docs/mobile/user-authentication/) §"Refresh" for the failure boundary.

### 7.5 Verify logout terminates Keycloak session

1. Log in.
2. Tap **Log Out**.
3. Verify in Keycloak Admin Console that the session is terminated — or check the active sessions count via the Admin API:

```bash
curl -sk "$KEYCLOAK_URL/admin/realms/genie/sessions?first=0&max=10" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))"
# Expected: 0 (or fewer than before logout)
```

For the full logout sequence (backend + Keycloak `end_session` + storage wipe), see [User Authentication](/docs/mobile/user-authentication/) §"Logout".

### 7.6 Verify password reset

**Prerequisite:** SMTP must be configured (`EMAIL_HOST`, `EMAIL_USER`, etc. set in `.env`). If SMTP is not set up, Keycloak logs an error but shows no user-facing message — the user submits their email but never receives a reset link.

1. Launch the app and tap **Sign In**.
2. On the Keycloak login page in the system browser, verify the **Forgot Password** link is visible.
3. Tap **Forgot Password** → Keycloak shows the email input form.
4. Enter a test user email and submit → check that the email is sent (verify in SMTP logs or mailbox).
5. Tap the reset link in the email → it opens the Keycloak reset page in the **system browser** (not the app). On Android, if you see the system app-picker disambiguation dialog, App Links verification failed — run `adb shell pm verify-app-links --re-verify <application_id>` and re-test.
6. Set a new password and submit.
7. Return to the app and tap **Sign In** → authenticate with the new password.
8. **AC5 disable verification:** set `KEYCLOAK_RESET_PASSWORD=false` in `.env`, restart `keycloak-config` (`docker service update --force genieai_keycloak-config` or `docker compose restart keycloak-config`), refresh the Keycloak login page — the **Forgot Password** link must no longer appear.

> After changing `KEYCLOAK_RESET_PASSWORD`, the `keycloak-config` one-shot service must be restarted to apply the realm setting. Restarting Keycloak alone is not sufficient.

## Step 8: Password reset

Password reset is a Keycloak built-in feature. The **Forgot Password** link appears on the Keycloak login page (rendered in the system browser) — the app does not control its visibility.

### Configuration

| Variable | Default | Required | Purpose |
|----------|---------|----------|---------|
| `KEYCLOAK_RESET_PASSWORD` | `true` | no | Enable/disable "Forgot Password" on Keycloak login page |
| `EMAIL_HOST` | (empty) | yes (for SMTP) | SMTP server hostname |
| `EMAIL_PORT` | `587` | no | SMTP server port |
| `EMAIL_SECURE` | `false` | no | Implicit SSL/TLS for SMTP |
| `EMAIL_USER` | (empty) | yes (for SMTP) | SMTP authentication username |
| `EMAIL_PASSWORD` | (empty) | yes (for SMTP) | SMTP authentication password |
| `EMAIL_FROM` | (empty) | yes (for SMTP) | Sender email address |

> **Defaults verified at `docker-compose.yaml:1597` (`KEYCLOAK_RESET_PASSWORD=${KEYCLOAK_RESET_PASSWORD:-true}`) and `docker-compose.yaml:1535` (`KC_SMTP_PORT=${EMAIL_PORT:-587}`).**
>
> **SMTP must be configured** (`EMAIL_*` variables) for password reset emails to work. If SMTP is not set up, Keycloak logs an error but shows no user-facing message — the user submits their email but never receives a reset link.

### How it works

1. User taps **Sign In** in the app → system browser opens the Keycloak login page.
2. User taps **Forgot Password** on Keycloak's page → Keycloak shows the reset form (all in browser).
3. User submits email → Keycloak sends a reset email via SMTP.
4. User taps the reset link in the email → system browser opens the Keycloak reset page (HTTPS URL).
5. User sets a new password → returns to the app → taps **Sign In** → authenticates with the new password.

> Password reset links always open in the system browser because Keycloak uses HTTPS URLs. The app only registers a custom URL scheme (`<redirectScheme>://callback`) for OIDC callbacks — it does not intercept HTTPS links. Universal Links / App Links (Step 9) ensure the system browser opens without disambiguation dialogs.

### Customization

For advanced password reset configuration, use the Keycloak Admin Console:

- Custom email templates (Realm settings → Email tab)
- Brute-force detection thresholds (Realm settings → Security Defenses)
- Password policy requirements (Realm settings → Password Policy)
- Reset link expiration time

## Step 9: Universal Links & App Links

Universal Links (iOS) and App Links (Android) use cryptographic domain verification so that password reset and email verification links open in the **system browser** instead of triggering Android's disambiguation dialog.

> **CRITICAL: Customize verification files before deployment**
>
> The verification files in `api-gateway-solution/nginx/conf/` contain **placeholder values** (`<TEAM_ID>`, `<BUNDLE_ID>`, `<APPLICATION_ID>`, `<SHA256_FINGERPRINT>`) that **MUST be replaced** with deployment-specific values before building the nginx Docker image. If deployed without customization, App Links verification fails silently. See `api-gateway-solution/nginx/conf/README.md` for details.

### How it works — dual deep-link mechanism

| Mechanism | Platform | Purpose | Protocol |
|-----------|----------|---------|----------|
| Custom URL scheme | iOS + Android | OIDC callbacks only | `com.<institution>.genieai://callback` |
| Universal Links / App Links | iOS / Android | Password reset, email verification | `https://<domain>/...` |

Custom URL schemes are wired through `RedirectUriReceiverActivity` (Android) and `CFBundleURLSchemes` (iOS) and are **not affected** by this section.

### iOS — `apple-app-site-association`

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
| `<BUNDLE_ID>` | App bundle identifier per flavor (e.g. `com.example.genieAiMobile`) |

#### iOS Associated Domains entitlement

The entitlements file at `mobile/genie_ai_mobile/ios/Runner/Runner.entitlements` uses `$(ASSOCIATED_DOMAINS)`, set per flavor in the XCConfig files. For a new deployment, add `ASSOCIATED_DOMAINS` to all 3 XCConfig files (already shown in [Step 4 Layer 4](#layer-4--ios-xcconfig-triplet)):

```
ASSOCIATED_DOMAINS = applinks:<keycloak-domain>
```

> **CRITICAL: Apple CDN cache delay**
>
> Apple's CDN caches the AASA file for **up to 24 hours**. After updating `apple-app-site-association`, Universal Links may not work immediately.
>
> Do **not** spend hours debugging — use Apple's [App Search Validation Tool](https://search.developer.apple.com/appsearch-validation-tool/) for instant verification instead of waiting for CDN propagation.
>
> **Testing workaround:** During development, add a query parameter to test URLs (e.g. `?_test=123`) to bypass CDN cache, or temporarily change `ASSOCIATED_DOMAINS` to force a re-fetch.

### Android — `assetlinks.json`

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
| `<APPLICATION_ID>` | Android `applicationId` per flavor (e.g. `com.example.genie_ai_mobile`) |
| `<SHA256_FINGERPRINT>` | SHA-256 fingerprint of the app signing certificate |

> **IMPORTANT: Debug vs release fingerprints**
>
> Debug and release certificates have **different SHA256 fingerprints**. If you deploy both debug and release builds to the same device, include **both fingerprints** in `assetlinks.json`:
>
> ```json
> "sha256_cert_fingerprints": [
>   "<DEBUG_SHA256>",
>   "<RELEASE_SHA256>"
> ]
> ```
>
> Otherwise, App Links verification fails for one of the build variants.

To obtain the SHA-256 fingerprint:

```bash
# Debug certificate (local development)
keytool -list -v -keystore ~/.android/debug.keystore -alias androiddebugkey -storepass android -keypass android | grep SHA256

# Release certificate (production builds)
keytool -list -v -keystore <path-to-keystore> -alias <alias> | grep SHA256
```

#### Android App Links wiring

The `${appAuthRedirectScheme}` placeholder is set per flavor in `build.gradle` (see [Step 4 Layer 3](#layer-3--android-gradle-product-flavor)) — this is what `flutter_appauth` uses to register `RedirectUriReceiverActivity` for the OIDC callback.

> **HTTPS auto-verify intent filter** — the deployment guide previously documented an `android:autoVerify="true"` intent filter for the Keycloak HTTPS host. That filter is **not** present in `mobile/genie_ai_mobile/android/app/src/main/AndroidManifest.xml` today (only the MAIN/LAUNCHER and the `genie-e2e-test` deep link are wired). App Links verification currently relies on the user tapping the link and confirming the disambiguation dialog. To eliminate the dialog, add an HTTPS intent-filter with `android:autoVerify="true"` on `MainActivity` and reference a `nginxPublicDomain` placeholder from `build.gradle`. Until then, treat "no disambiguation dialog" as an enhancement, not a baseline.

### Nginx configuration

Both verification files are served by the nginx reverse gateway. The location blocks are in `api-gateway-solution/nginx/conf/default.conf.template` (placed before the SPA catch-all `location /`):

```nginx
# Android App Links verification
location = /.well-known/assetlinks.json {
    default_type application/json;
    alias /etc/nginx/conf.d/assetlinks.json;
    add_header Cache-Control "public, max-age=3600" always;
}

# iOS Universal Links verification
location = /.well-known/apple-app-site-association {
    default_type text/plain;
    alias /etc/nginx/conf.d/apple-app-site-association;
    add_header Cache-Control "public, max-age=3600" always;
}
```

The `Cache-Control` header caps client caching at one hour — long enough to avoid hammering the verification endpoints, short enough that post-deployment updates take effect quickly. The files are copied into the nginx Docker image via the Dockerfile. After customising the JSON files for your deployment, rebuild and redeploy the nginx service.

### Verification testing

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

1. Use Apple's [App Search Validation Tool](https://search.developer.apple.com/appsearch-validation-tool/) — submit the AASA URL and verify the domain association.
2. **On-device test:** install the app, then in the Notes app paste a Keycloak HTTPS link (e.g. `https://<keycloak-domain>/realms/genie/account`), long-press, and tap **Open in Safari** — the link must open in Safari, not the app.

**Nginx (both platforms):**

```bash
curl -s https://<keycloak-domain>/.well-known/assetlinks.json | python3 -m json.tool
# Expected: valid JSON array with your app's package_name and fingerprint

curl -s https://<keycloak-domain>/.well-known/apple-app-site-association | python3 -m json.tool
# Expected: valid JSON with applinks.details array
```

## Step 10: Air-gapped deployments

GENIE.AI mobile OIDC works identically whether Keycloak is internet-facing or on an internal network. The only requirement is that the **device must reach Keycloak** at runtime.

### Network prerequisites

- The mobile device must resolve the Keycloak hostname (e.g. `keycloak.<institution>.int`).
- Configure local DNS or `/etc/hosts` on the device if no internal DNS server is available.

**Option A — `/etc/hosts` (Android emulator via `adb`, or Linux host):**

```
# /etc/hosts — one line per hostname the app must reach
10.0.0.100    keycloak.<institution>.int api.<institution>.int
```

For an Android emulator, push the entry into the emulator's `/etc/hosts`. Requires a `userdebug` or `eng` Android build — production/user builds have a locked `/system` partition.

```bash
adb root
adb remount
adb shell "echo '10.0.0.100 keycloak.<institution>.int api.<institution>.int' >> /etc/hosts"
```

> `/etc/hosts` modifications do not survive emulator restart. Re-apply after each cold boot, or use the emulator `-dns-server` launch flag to point at a DNS server that resolves the hostnames.

**Option B — `resolvectl` / `systemd-resolve` (Linux host):**

```bash
# Modern systemd (v237+)
sudo resolvectl dns <iface> 10.0.0.100
sudo resolvectl domain <iface> ~<institution>.int

# Legacy systemd
sudo systemd-resolve --interface=<iface> --set-dns=10.0.0.100
sudo systemd-resolve --interface=<iface> --set-domain=~<institution>.int
```

Verify with `resolvectl status <iface>` or `systemd-resolve --status <iface>`.

**Option C — `nmcli` (NetworkManager-based Linux host):**

```bash
nmcli connection modify "<connection-name>" ipv4.dns "10.0.0.100" ipv4.ignore-auto-dns yes
nmcli connection up "<connection-name>"
```

The `ipv4.ignore-auto-dns yes` flag prevents DHCP from re-adding the ISP DNS on reconnect.

**Verify resolution before testing:**

```bash
ping -c 2 keycloak.<institution>.int
nslookup keycloak.<institution>.int
# Both should return 10.0.0.100 (or your configured IP)
```

- The device must be on the same network or VPN as the Keycloak server.
- No external internet access is required for OIDC — the entire flow stays within the internal network.

### SSL considerations

- Air-gapped deployments typically use self-signed certificates.
- For Android emulator testing, install the certificate on the emulator (see `mobile/genie_ai_mobile/CLAUDE.md#Emulator SSL Certificate Setup`).
- For production devices, install the CA certificate via MDM profile or device policy.

## Step 11: OS version policy

| Platform | Technical minimum | Rationale |
|----------|-------------------|-----------|
| iOS | **12.0+** | `IPHONEOS_DEPLOYMENT_TARGET = 12.0` (verified at `ios/Runner.xcodeproj/project.pbxproj` lines 363/490/541/647/699). `ASWebAuthenticationSession` and PKCE are available since iOS 12.0. |
| Android | **API 21+** | `minSdk = flutter.minSdkVersion` (`build.gradle:31`). Flutter 3.10+ defaults `minSdk` to 21. The deployment guide's previous "Android 6.0+ (API 23)" minimum overstated the actual floor; API 21 (Android 5.0) is sufficient. `flutter_launcher_icons` enforces `min_sdk_android: 21` (`pubspec.yaml`). |

### Security patch considerations

- The technical minimums ensure OIDC functionality.
- Institutional security policies may require higher minimums.
- Check for known CVEs in the target OS version before deployment.
- MDM policies can enforce minimum OS version requirements.

### MDM enforcement recommendation

For institutional deployments, enforce OS version policies via MDM:

- **iOS:** Configuration Profile → Restrictions → Minimum OS version.
- **Android:** EMM policy → Device policy → System update requirements.

## Step 12: App store submission

### Google Play

1. Build the Android App Bundle: `flutter build appbundle --flavor <institution> --release`.
2. **Signing:** Use the keystore created in [Step 5](#step-5-android-signing).
3. **Content rating:** Complete the Google Play content rating questionnaire.
4. **Privacy policy:** Provide a URL to the institution's privacy policy.
5. **Target API level:** Ensure `targetSdkVersion` meets Google Play's current requirements.

### Apple App Store

1. Build the IPA: `flutter build ipa --flavor <institution>`.
2. **Apple Developer account:** Each deployment needs a unique bundle ID registered in App Store Connect.
3. **Provisioning profiles:** Create distribution provisioning profiles per deployment bundle ID.
4. **App Review:** Prepare screenshots, description, and review notes.

### Signing certificate management

- Maintain separate keystores / provisioning profiles per deployment.
- Store signing credentials securely — do not commit to version control.
- `key.properties` is gitignored — never commit signing secrets.
- Document the keystore location and password in a secure credential store.

### Compliance requirements

App stores require explicit privacy disclosures. Prepare these before submitting.

**Google Play — Data Safety section:**

| Data type | Collected? | Purpose |
|-----------|-----------|---------|
| OIDC tokens (access, refresh, ID) | Yes | Authentication with the institutional backend |
| Chat messages and conversation history | Yes | Core RAG chat functionality (stored on the institutional backend) |
| Device identifier (Android ID) | Yes (Android) | Push notification routing, crash reporting |
| Device identifier (IDFV) | Yes (iOS) | Push notification routing, crash reporting |
| Name, email | Yes | User profile (sourced from Keycloak / institutional directory) |
| Location, contacts, photos, microphone | No | Not accessed by the app |

Declare data handling practices accurately — misrepresentation is a policy violation. See [Google Play Data Safety documentation](https://support.google.com/googleplay/android-developer/answer/10787469).

**Apple App Store — Privacy Manifests (required from Spring 2024):**

Apple requires a `PrivacyInfo.xcprivacy` manifest declaring:

1. **Required Reason APIs** — which protected API categories the app uses (e.g. `UserDefaults` for token storage, `File Timestamp APIs` for caching). List each API and the approved reason code.
2. **Tracking domains** — any domains used for tracking users. The GENIE.AI app does not track users, so this is typically empty.
3. **Data collected** — declare what user data is collected and the purpose.

Flutter 3.16+ generates a baseline `PrivacyInfo.xcprivacy` during build. Most deployments must extend it manually for biometric authentication, push notifications via APNs, or other native APIs. See [Apple Privacy Manifests documentation](https://developer.apple.com/documentation/bundleresources/privacy_manifest_files).

## Step 13: Version code & name management

App stores require each uploaded build to carry a **unique version code** strictly greater than the previously published build. When multiple institutions deploy from the same codebase, version code collisions must be avoided.

### `pubspec.yaml` format

Flutter versions follow the pattern `X.Y.Z+N`:

- `X.Y.Z` — **version name** (user-facing). Maps to Android `versionName` and iOS `CFBundleShortVersionString`.
- `+N` — **version code** (integer, build-only). Maps to Android `versionCode`. iOS uses `CFBundleVersion` which Flutter derives from `N`.

```yaml
# mobile/genie_ai_mobile/pubspec.yaml
version: 1.0.0+1    # versionName = "1.0.0", versionCode = 1
```

In `android/app/build.gradle`, the values flow automatically:

```gradle
versionCode = flutter.versionCode   # reads the +N part
versionName = flutter.versionName   # reads the X.Y.Z part
```

You only edit `pubspec.yaml` — Gradle and Xcode pick up the values.

### Multi-deployment strategy

Each institutional deployment publishes to its own app store listing (distinct `applicationId` / bundle ID), so **version codes do not collide across deployments** — they only need to be monotonically increasing *within the same store listing*.

1. **Bump `+N` on every build** submitted to a store — even for re-signed or metadata-only re-uploads. Google Play and App Store Connect reject builds whose version code is ≤ the current published version.
2. **Use a per-deployment changelog or build log** to track the last submitted `+N`, so the next operator knows where to resume.
3. **Do not reuse version codes** — once submitted, a code is consumed. If a build is retracted, the next build must still use a higher code.
4. **For CI/CD**, automate the bump — derive `+N` from the CI build number or a counter stored outside the repo, then inject at build time via `--build-name` and `--build-number`:
   ```bash
   flutter build appbundle --flavor <institution> --release \
     --build-name 1.0.0 --build-number 42
   ```
   This overrides `pubspec.yaml` for that single build without modifying the file.

### iOS note

iOS uses `CFBundleVersion` (a monotonically increasing string) for App Store build identification, separate from `CFBundleShortVersionString` (the user-facing version). Flutter maps `+N` to `CFBundleVersion`. Apple rejects builds with a duplicate or lower `CFBundleVersion`. Apple requires `CFBundleVersion` uniqueness across all uploads for a given bundle ID — two builds with the same `CFBundleShortVersionString` must have different `CFBundleVersion` values.

## Step 14: Rollback

### Remove Keycloak client

```bash
CLIENT_UUID=$(curl -sk "$KEYCLOAK_URL/admin/realms/genie/clients?clientId=$KC_MOBILE_CLIENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

curl -sk -X DELETE "$KEYCLOAK_URL/admin/realms/genie/clients/$CLIENT_UUID" \
  -H "Authorization: Bearer $ADMIN_TOKEN"
```

### Revert flavor configuration

```bash
git revert <commit-hash> --no-commit
git diff --cached  # Review before committing
git commit -m "revert: remove <institution> deployment flavor"
```

### Unpublish from app stores

- **Google Play:** Create a new release with 0% rollout and unpublish the app.
- **Apple App Store:** Remove from sale in App Store Connect.

### End-user communication

- Notify users before rollback (via institution communication channels).
- Provide clear instructions: "Uninstall the app and install the previous version."
- Set a support contact for users who experience transition issues.

## Troubleshooting

### OIDC callback not received

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
curl -sk "$KEYCLOAK_URL/admin/realms/genie/clients?clientId=$KC_MOBILE_CLIENT_ID" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['redirectUris'])"
```

### Build failure — missing `key.properties`

**Symptom:** Release build fails with `keystoreProperties` is null.

**Cause:** `android/key.properties` not created.

**Fix:** Copy from the template:

```bash
cp mobile/genie_ai_mobile/android/key.properties.example \
   mobile/genie_ai_mobile/android/key.properties
# Edit key.properties with your keystore values
```

If the template is missing, see [Step 5](#step-5-android-signing) for the expected format.

### 401 after login

**Symptom:** User logs in successfully, but API calls return 401 Unauthorized.

**Cause:** Backend cannot validate the token (typically a network issue between backend and Keycloak, not a mobile issue).

**Fix:** Check that the backend service can reach Keycloak:

```bash
docker compose logs backend --since 30s | grep -v health
```

### `keycloak-config-cli` silent failure

**Symptom:** Keycloak client not created, no error in logs.

**Cause:** `KC_MOBILE_CLIENT_ID` or `KC_MOBILE_REDIRECT_SCHEME` missing from `.env`.

**Fix:** Set both variables in `.env` and restart the `keycloak-config` service. See [Step 1](#step-1-environment-variables).

### App Links verification fails

**Symptom:** Android shows the system app-picker dialog when tapping a Keycloak HTTPS link; iOS Universal Links do not open the app.

**Causes and fixes:**

1. **`assetlinks.json` / `apple-app-site-association` not customized** — verify both files in `api-gateway-solution/nginx/conf/` have deployment-specific values (no `<TEAM_ID>`, `<BUNDLE_ID>`, `<APPLICATION_ID>`, `<SHA256_FINGERPRINT>` placeholders).
2. **Wrong SHA-256 fingerprint** — regenerate `assetlinks.json` from the release keystore (or include both debug and release fingerprints if you ship both).
3. **iOS AASA CDN cache** — Apple's CDN caches AASA for up to 24 hours. Use the [App Search Validation Tool](https://search.developer.apple.com/appsearch-validation-tool/) for instant feedback.
4. **HTTPS auto-verify intent filter missing on Android** — `AndroidManifest.xml` does not have `android:autoVerify="true"`. Add the filter to eliminate the disambiguation dialog (see [Step 9](#step-9-universal-links--app-links)).

### Contributor concerns (dev-only)

> **Note for deployers:** the next two items are contributor concerns and not part of a deployment runbook. They live here for reference only — contributors handle them as part of pre-merge hygiene.

#### Local `flutter_appauth` fork

The `pubspec.yaml` may reference a local fork of `flutter_appauth` at `flutter_appauth/` that patches the `InsecureConnectionBuilder` bug (upstream issue [#386](https://github.com/MaikuB/flutter_appauth/issues/386)). **The fork is for development only.** Before merging any changes to `main`, revert:

1. In `pubspec.yaml`: replace the local fork path with `flutter_appauth: ^11.0.0`.
2. Remove the `flutter_appauth/` directory.

The fork does not affect production builds (production uses CA-signed certs and `allowInsecureConnections=false`).

#### Build failure — `flutter pub get`

**Symptom:** First build (or fresh checkout) fails during `flutter pub get` with dependency resolution errors, checksum mismatches, or "version solving failed."

**Common causes and fixes:**

1. **Stale pub cache** — clean and retry:
   ```bash
   flutter pub cache clean
   flutter pub get
   ```
2. **Network / proxy issues** — corporate proxy or firewall blocks pub.dev or GitHub:
   ```bash
   export https_proxy=http://proxy.<institution>.int:8080
   export http_proxy=http://proxy.<institution>.int:8080
   flutter pub get
   ```
   For Git-hosted dependencies (e.g. `flutter_appauth` local fork referenced via `path:`), ensure Git can reach its remotes.
3. **Lock file conflicts** — `pubspec.lock` or `.flutter-plugins` is out of sync with `pubspec.yaml`:
   ```bash
   cd mobile/genie_ai_mobile
   rm -f pubspec.lock .flutter-plugins .flutter-plugins-dependencies
   flutter pub get
   ```
4. **Local fork path conflicts** — `pubspec.yaml` references a local path dependency but the directory is missing or on a different branch. Ensure the referenced path exists and contains a valid `pubspec.yaml`.

**Recovery order:** (1) cache clean → (2) network issues → (3) lock file reset → (4) local fork paths.

## You're done when…

- The app installs on a real Android device or emulator with the deployment's `applicationId`.
- The app installs on a real iOS device or simulator with the deployment's bundle ID.
- Steps 7.3, 7.4, and 7.5 all pass: login + token refresh + logout terminate the Keycloak session.
- Password reset (Step 7.6) opens the Keycloak reset page in the system browser.
- Asset-link verification (`assetlinks.json` / `apple-app-site-association`) is reachable and valid at `https://<keycloak-domain>/.well-known/`.

**Next:** wire the mobile app's traces and logs into your observability stack — see [Observability](/docs/observe/) for Grafana dashboards and VictoriaLogs queries.

For per-flavor locale restriction (active set, dart-define wiring, CI rebuild pass), see [Restrict active locales](/docs/configure/locale-whitelist/).
