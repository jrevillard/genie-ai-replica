# Mobile — CLAUDE.md

## Prerequisites

### Keycloak Mobile Client

For creating a new institutional deployment, follow the [Mobile Deployment Onboarding Guide](../../../docs/mobile-deployment-guide.md). The guide covers environment variables, Keycloak client creation, flavor configuration, build commands, and validation.

The mobile OIDC client is created automatically by keycloak-config-cli from environment variables. For the legacy manual creation process (kept for reference):

```bash
# Get master admin token
KC_ADMIN_PWD=$(grep "^KEYCLOAK_ADMIN_PASSWORD=" <path-to-env> | cut -d= -f2)
ADMIN_TOKEN=$(curl -sk -X POST "https://localhost:8443/auth/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=admin" -d "password=${KC_ADMIN_PWD}" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# Create mobile client (public, PKCE, refresh token rotation)
curl -sk -X POST "https://localhost:8443/auth/admin/realms/genie/clients" \
  -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{
    "clientId": "genie-mobile-dev",
    "publicClient": true,
    "standardFlowEnabled": true,
    "directAccessGrantsEnabled": false,
    "attributes": {
      "pkce.code.challenge.method": "S256",
      "oauth2.device.authorization.grant.enabled": "false",
      "client.credentials.use.refresh.token": "true",
      "revoke.refresh.token.on.use": "true",
      "backchannel.logout.session.required": "true",
      "backchannel.logout.url": ""
    },
    "redirectUris": ["com.itu.genieai.dev://callback"],
    "webOrigins": ["android-app://com.example.genie_ai_mobile.dev"]
  }'

# Verify
curl -sk "https://localhost:8443/auth/admin/realms/genie/clients?clientId=genie-mobile-dev" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "import sys,json; c=json.load(sys.stdin); print('OK' if c else 'NOT FOUND')"
# Expected: OK
```

**NOTE:** This is a temporary workaround. Epic 4 Story 4.2 will automate this by adding the client to `configs/keycloak/genie-realm.yaml`.

### Local flutter_appauth Fork

The upstream `flutter_appauth` has an `InsecureConnectionBuilder` bug ([#386](https://github.com/MaikuB/flutter_appauth/issues/386)) — on Android it's a no-op, on iOS `allowInsecureConnections` is completely ignored. A local fork at `flutter_appauth/` patches both platforms.

**pubspec.yaml** points to the local fork via `path: flutter_appauth/flutter_appauth`.

**Before merging to main**, revert `pubspec.yaml` back to `flutter_appauth: ^11.0.0` and remove the `flutter_appauth/` directory.

To update the fork from upstream:
```bash
cd flutter_appauth
git fetch upstream
git rebase upstream/main
```

## Build & Run

```bash
cd mobile/genie_ai_mobile
ANDROID_HOME=/opt/android-sdk flutter pub get

# Android
ANDROID_HOME=/opt/android-sdk flutter build apk --flavor dev --debug
ANDROID_HOME=/opt/android-sdk flutter build apk --flavor itu --release
ANDROID_HOME=/opt/android-sdk flutter build appbundle --flavor itu --release
adb install -r build/app/outputs/flutter-apk/app-dev-debug.apk

# iOS (requires Mac with Xcode)
flutter build ipa --flavor dev
flutter build ipa --flavor itu

# Run on device/emulator
flutter run --flavor dev
flutter run --flavor itu
```

### Android Emulator Setup

**Recommended AVD:** `pixel_6` (Google APIs, x86_64). Pixel 8 is unstable with Patrol's orchestrator.

#### KVM Acceleration

KVM is required — software emulation (TCG) causes extreme disk I/O (~1 GB/s) and unusable performance.

`hw.cpu.accel=kvm` in `config.ini` is **not sufficient**. The `-accel auto` flag must be passed on the CLI:

```bash
# Verify KVM is available
ls /dev/kvm

# Launch emulator with KVM enabled
/opt/android-sdk/emulator/emulator -avd pixel_6 -accel auto -no-snapshot
```

Verify KVM is active by checking for `-enable-kvm` in the QEMU process:
```bash
tr '\0' '\n' < /proc/$(pgrep -f qemu-system-x86_64 | head -1)/cmdline | grep enable-kvm
```

#### RAM (4 GB minimum)

E2E tests with the Android Test Orchestrator require at least 4 GB RAM. The default (2 GB) causes the orchestrator to be OOM-killed (StatusCode 137, 0 tests reported).

**Critical:** The emulator reads `hw.ramSize` from `config.ini` but regenerates `hardware-qemu.ini` at each boot. Use the numeric format `4096` (not `4G`) — the suffix format is silently ignored and defaults to 2048.

```bash
# Set in config.ini (use numeric MB value, NOT "4G")
# File: ~/.android/avd/pixel_6.avd/config.ini
hw.ramSize=4096

# Verify after boot (hardware-qemu.ini is auto-generated)
grep hw.ramSize ~/.android/avd/pixel_6.avd/hardware-qemu.ini
# Expected: hw.ramSize = 4096
```

#### Snapshot I/O

The emulator saves the full RAM contents to disk as a snapshot by default, causing massive I/O. Use `-no-snapshot` to prevent this during E2E test sessions. After wiping snapshots, the first boot creates fresh images.

```bash
# Wipe stale snapshots and qcow2 overlays (one-time cleanup)
rm -rf ~/.android/avd/pixel_6.avd/snapshots/
rm -f ~/.android/avd/pixel_6.avd/*.qcow2
```

**Flavors:** `dev` (local Docker, `10.0.2.2`), `e2e`, `staging`, `itu` (production URL).

### Android Release Signing

Release builds require a `key.properties` file in `android/` (gitignored). Copy from the template:

```bash
cp android/key.properties.example android/key.properties
# Edit with your keystore values
```

### iOS Build Configuration

Each flavor has dedicated Xcode build configurations, schemes, and XCConfig files under `ios/Flutter/`. The URL scheme in `Info.plist` is flavor-aware via `$(APP_AUTH_REDIRECT_SCHEME)`. Use the Xcode scheme `Runner-<flavor>` or the `flutter build ipa --flavor <name>` command.

## Emulator SSL Certificate Setup

The emulator must trust the self-signed nginx certificate for HTTPS. This must be redone after any emulator recreation.

```bash
# 1. Extract cert from running nginx container
docker exec <nginx-container> cat /etc/nginx/certs/server.crt > /tmp/itu-nginx-cert.pem

# 2. Compute hash and push (requires -writable-system emulator)
CERT_HASH=$(openssl x509 -inform PEM -subject_hash_old -in /tmp/itu-nginx-cert.pem | head -1)
cp /tmp/itu-nginx-cert.pem /tmp/${CERT_HASH}.0
adb push /tmp/${CERT_HASH}.0 /system/etc/security/cacerts/
adb shell chmod 644 /system/etc/security/cacerts/${CERT_HASH}.0

# 3. Verify
adb shell cat /system/etc/security/cacerts/${CERT_HASH}.0 | openssl x509 -noout -subject
# Expected: subject=C = CH, ST = Geneva, L = Geneva, O = ITU, CN = localhost
```

## Verify OIDC Login Flow

```bash
adb logcat -c
adb shell am force-stop com.example.genie_ai_mobile.dev
adb shell am start -n com.example.genie_ai_mobile.dev/com.example.genie_ai_mobile.MainActivity
sleep 3
adb shell input tap 540 1415  # Sign In button
sleep 10
adb logcat -d | grep "flutter :" | grep -i "auth\|authorize"
# Expected: "[AuthNotifier.authorize] Authorization successful"
```

**Manual step:** Keycloak login page opens in Chrome Custom Tab — enter credentials manually or use CDP automation.

## Verify Logout

```bash
adb logcat -c
adb shell input tap 849 211  # Log Out button (adjust via uiautomator dump)
sleep 5
adb logcat -d | grep "flutter :" | grep -i "logout\|end_session"
# Expected: POST auth/logout + Keycloak end_session initiated/successful + Logout completed
```

## Verify Bearer Token Injection

After login, trigger any API call from the app, then check:

```bash
docker compose logs backend --since 30s | grep -v health
# Backend receives the request if AuthInterceptor injected the Bearer token.
# A 401 here means token validation failed (e.g. backend can't reach Keycloak),
# NOT that the token was missing.
```

## Finding UI Element Coordinates

```bash
adb shell uiautomator dump /sdcard/ui.xml
adb pull /sdcard/ui.xml /tmp/ui.xml
grep -o 'bounds="[^"]*"\|content-desc="[^"]*"' /tmp/ui.xml | grep "Log Out\|Sign In"
```

## Verifying Custom URL Scheme Registration

Each flavor registers a unique URL scheme for OIDC callback routing. Verify after deployment.

### Scheme Values Per Flavor

| Flavor | URL Scheme | Application ID |
|--------|-----------|----------------|
| dev | `com.itu.genieai.dev` | `com.example.genie_ai_mobile.dev` |
| staging | `com.itu.genieai.staging` | `com.example.genie_ai_mobile.staging` |
| e2e | `com.itu.genieai.e2e` | `com.example.genie_ai_mobile.e2e` |
| itu | `com.itu.genieai` | `com.example.genie_ai_mobile` |

### Android — Manifest Merger Inspection (Static)

Build the APK, then inspect the merged manifest to confirm the intent filter has the correct scheme:

```bash
# Build a flavor (e.g., itu)
${ANDROID_HOME:+ANDROID_HOME=$ANDROID_HOME }flutter build apk --flavor itu --debug \
  -t lib/config/flavors/itu.dart --dart-define=FLAVOR=itu

# Inspect merged manifest
find build/app/intermediates/merged_manifests/ -path "*ituDebug*" -name "AndroidManifest.xml" | \
  head -1 | xargs grep -A10 "RedirectUriReceiverActivity"
# Expected: <data android:scheme="com.itu.genieai" /> inside the intent-filter
```

### Android — Runtime Scheme Verification

```bash
# Install the APK
adb install -r build/app/outputs/flutter-apk/app-itu-debug.apk

# Verify scheme registered
adb shell dumpsys package com.example.genie_ai_mobile | grep -A3 "android.intent.action.VIEW"
# Expected: Scheme: "com.itu.genieai"

# Test intent routing (app opens = scheme works)
adb shell am start -a android.intent.action.VIEW -d "com.itu.genieai://callback"
# Expected: app receives the intent (RedirectUriReceiverActivity launched)

# Verify in logcat
adb logcat -d | grep "ActivityTaskManager.*START" | grep "com.itu.genieai"
# Expected: cmp=com.example.genie_ai_mobile/net.openid.appauth.RedirectUriReceiverActivity
```

### Android — Cross-Flavor Routing (Two Apps on Same Device)

```bash
# Install both itu and dev flavors
adb install -r build/app/outputs/flutter-apk/app-itu-debug.apk
adb install -r build/app/outputs/flutter-apk/app-dev-debug.apk

# Verify distinct schemes
adb shell dumpsys package com.example.genie_ai_mobile | grep "Scheme:"
# Expected: Scheme: "com.itu.genieai"
adb shell dumpsys package com.example.genie_ai_mobile.dev | grep "Scheme:"
# Expected: Scheme: "com.itu.genieai.dev"

# Test routing: each scheme must open the correct app
adb shell am start -a android.intent.action.VIEW -d "com.itu.genieai://callback"    # → itu app
# Expected: cmp=com.example.genie_ai_mobile/net.openid.appauth.RedirectUriReceiverActivity
adb shell am start -a android.intent.action.VIEW -d "com.itu.genieai.dev://callback" # → dev app
# Expected: cmp=com.example.genie_ai_mobile.dev/net.openid.appauth.RedirectUriReceiverActivity
```

### iOS — XCConfig Verification

If macOS is not available, verify by inspecting XCConfig values:

```bash
grep APP_AUTH_REDIRECT_SCHEME ios/Flutter/*-*.xcconfig
# Each flavor-specific file should match its expected scheme (12 files across 4 flavors x 3 build modes)
```

If macOS is available, build the IPA and inspect the compiled `Info.plist`:

```bash
flutter build ipa --flavor itu -t lib/config/flavors/itu.dart --dart-define=FLAVOR=itu

# Inspect the compiled Info.plist in the IPA bundle
unzip -p build/ios/ipa/*.ipa Payload/Runner.app/Info.plist | plutil -p -
# Expected: CFBundleURLSchemes contains "com.itu.genieai"
```

### Scheme Coherence Rule

`redirectScheme` in Dart config **MUST** match `appAuthRedirectScheme` in `build.gradle` **MUST** match `APP_AUTH_REDIRECT_SCHEME` in iOS XCConfig **MUST** match `KC_MOBILE_REDIRECT_SCHEME` in the deployment `.env`. A mismatch causes silent OIDC callback failure.

## Key Pitfalls

- **flutter_appauth `InsecureConnectionBuilder` bug:** Upstream `InsecureConnectionBuilder` is a no-op — it doesn't disable SSL verification. On iOS, `allowInsecureConnections` is completely ignored. Open upstream issue: [MaikuB/flutter_appauth#386](https://github.com/MaikuB/flutter_appauth/issues/386). **Fix:** local fork at `flutter_appauth/` patches both platforms — Android uses a real `TrustManager` + `HostnameVerifier`, iOS uses `NSURLProtocol` to intercept and trust all certs. Only active when `allowInsecureConnections=true`. Does NOT affect production (production uses CA-signed certs and `allowInsecureConnections=false`). **Revert `pubspec.yaml` before merge.**
- **`taskAffinity=""` on MainActivity:** Flutter 3.x adds this by default. It prevents `AuthorizationManagementActivity` from receiving the OIDC callback on Android 12+ because `RedirectUriReceiverActivity` launches in a different task. The fix in `AndroidManifest.xml` removes `taskAffinity=""` from `MainActivity` and adds `taskAffinity="${applicationId}"` on `RedirectUriReceiverActivity` with `tools:replace`.
- **`network_security_config.xml`:** Allows cleartext to `10.0.2.2`/`localhost` and trusts user certs in debug builds. Dev-only — harmless in production but only needed for local self-signed cert development.
- **ChatbotProxy bypasses AuthInterceptor:** `ChatbotProxy` creates `ApiService()` directly instead of using `apiServiceProvider`. API calls from the chatbot will return 401 until consumer migration (future epic).

## E2E Test Rules

- **Never pipe or filter test output on a live run.** Tests are long (minutes). Always save the full output to a file (`2>&1 | tee /tmp/test-output.log`), then read and analyze the file after the run completes. Piping through `grep`/`tail` discards context needed for debugging.
- **Use `-t` to run a single test file:** `./patrol-wrapper.sh --flavor e2e -t patrol_test/login_happy_path_test.dart`

### E2E Auth Injection — ROPC + Provider Override

Chrome Custom Tab (CCT) web content is **not accessible** via UiAutomator selectors — neither `android.widget.EditText` class selectors nor `textContains` text selectors work. This is a fundamental Android limitation. CDP (Chrome DevTools Protocol) is not reliable for CCT.

**Solution:** Tests inject tokens directly into `TokenStorage` via Riverpod provider overrides in `TestApp`, bypassing the CCT entirely.

**Flow:**
1. `patrol-wrapper.sh` creates `genie-mobile-e2e` client (if missing) and enables ROPC automatically before tests
2. Tests create test user via Keycloak Admin API (must include `firstName`, `lastName`, `emailVerified: true` — see `.claude/rules/SERVER-TESTING.md`)
3. Obtain tokens via ROPC (`grant_type=password`) using `AuthHelper.getRopcToken()`
4. Launch app with `TestApp` pre-configured with `InMemoryTokenStorage` containing the tokens
5. Verify authenticated state via Flutter widget selectors
6. `patrol-wrapper.sh` disables ROPC automatically after tests (cleanup)

**No app code modifications required** — the injection uses existing `InMemoryTokenStorage` and `ProviderScope.overrides` in `TestApp`.
