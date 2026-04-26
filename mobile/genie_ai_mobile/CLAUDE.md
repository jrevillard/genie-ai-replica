# Mobile — CLAUDE.md

## Prerequisites

### Keycloak Mobile Client (until Epic 4 Story 4.2)

The mobile OIDC client must exist in Keycloak. After a fresh `docker compose down -v`, it must be recreated manually:

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
ANDROID_HOME=/opt/android-sdk flutter build apk --flavor dev --debug
adb install -r build/app/outputs/flutter-apk/app-dev-debug.apk
```

**Flavors:** `dev` (local Docker, `10.0.2.2`), `e2e`, `staging`, `itu` (production URL).

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

## Key Pitfalls

- **flutter_appauth `InsecureConnectionBuilder` bug:** Upstream `InsecureConnectionBuilder` is a no-op — it doesn't disable SSL verification. On iOS, `allowInsecureConnections` is completely ignored. Open upstream issue: [MaikuB/flutter_appauth#386](https://github.com/MaikuB/flutter_appauth/issues/386). **Fix:** local fork at `flutter_appauth/` patches both platforms — Android uses a real `TrustManager` + `HostnameVerifier`, iOS uses `NSURLProtocol` to intercept and trust all certs. Only active when `allowInsecureConnections=true`. Does NOT affect production (production uses CA-signed certs and `allowInsecureConnections=false`). **Revert `pubspec.yaml` before merge.**
- **`taskAffinity=""` on MainActivity:** Flutter 3.x adds this by default. It prevents `AuthorizationManagementActivity` from receiving the OIDC callback on Android 12+ because `RedirectUriReceiverActivity` launches in a different task. The fix in `AndroidManifest.xml` removes `taskAffinity=""` from `MainActivity` and adds `taskAffinity="${applicationId}"` on `RedirectUriReceiverActivity` with `tools:replace`.
- **`network_security_config.xml`:** Allows cleartext to `10.0.2.2`/`localhost` and trusts user certs in debug builds. Dev-only — harmless in production but only needed for local self-signed cert development.
- **ChatbotProxy bypasses AuthInterceptor:** `ChatbotProxy` creates `ApiService()` directly instead of using `apiServiceProvider`. API calls from the chatbot will return 401 until consumer migration (future epic).
