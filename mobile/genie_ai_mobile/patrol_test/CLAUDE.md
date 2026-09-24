# Mobile E2E Tests (Patrol)

## Prerequisites

1. Android emulator running (`adb devices` shows `emulator-5554`)
2. Docker stack up with Keycloak, backend, nginx healthy
3. `.env` configured with E2E mobile client variables
4. `flutter pub get` resolved

## Keycloak E2E Client

The mobile OIDC client is created automatically by `keycloak-config-cli` from `genie-realm.yaml` using env vars:

```yaml
# In .env (NOT committed):
KC_MOBILE_CLIENT_ID=genie-mobile-e2e
KC_MOBILE_REDIRECT_SCHEME=com.itu.genieai.e2e
```

The template in `configs/keycloak/genie-realm.yaml` reads these vars:
```yaml
- clientId: $(env:KC_MOBILE_CLIENT_ID)
  redirectUris:
    - $(env:KC_MOBILE_REDIRECT_SCHEME)://callback
```

To verify the client exists:
```bash
KC_ADMIN_PWD=$(grep "^KEYCLOAK_ADMIN_PASSWORD=" .env | cut -d= -f2)
ADMIN_TOKEN=$(curl -sk -X POST "https://localhost:8443/auth/realms/master/protocol/openid-connect/token" \
  -d "client_id=admin-cli" -d "username=admin" -d "password=${KC_ADMIN_PWD}" -d "grant_type=password" \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
curl -sk "https://localhost:8443/auth/admin/realms/genie/clients?clientId=genie-mobile-e2e" \
  -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "import sys,json; c=json.load(sys.stdin); print('OK' if c else 'NOT FOUND')"
```

## URLs

All traffic goes through nginx (self-signed cert on `localhost`). The emulator reaches the host via `adb reverse` — the wrapper sets this up automatically using `NGINX_HTTPS_PORT` from `.env` (default: `443`).

| Context | Keycloak | Backend |
|---------|----------|---------|
| Flutter app on emulator | `https://localhost:<port>/auth` | `https://localhost:<port>/api` |
| Host-side test helpers | `https://localhost:<port>/auth` | (via AuthHelper) |

## Running Tests

Patrol CLI has a bug with worktree paths containing dots — the generated `test_bundle.dart` has broken imports. The `patrol-wrapper.sh` script fixes this automatically and adds `~/.pub-cache/bin` to PATH.

Use the wrapper if `patrol` is not available directly:

```bash
cd mobile/genie_ai_mobile
./patrol-wrapper.sh --flavor e2e
```

For a single test file (passed as positional argument):
```bash
./patrol-wrapper.sh --flavor e2e integration_test/login_happy_path_test.dart
```

Key `patrol test` options:
- `-d, --device` — target device (default: `emulator-5554`)
- `-t, --target` — bundled entrypoint (auto-generated, use wrapper instead)
- `--flavor` — Flutter build flavor
- `--no-uninstall` — keep app installed between runs

## Test Structure

All tests use `group()` wrapper with `patrolTest()` inside (required by Patrol bundler):
```dart
void main() {
  group('Test Group Name', () {
    patrolTest('test description', ($) async {
      // ...
    );
  });
}
```

## Test Files

| File | Purpose |
|------|---------|
| `login_happy_path_test.dart` | Full OIDC login flow via system browser |
| `logout_test.dart` | Logout clears tokens, returns to login |
| `session_persistence_test.dart` | Tokens survive app force-stop |
| `token_refresh_test.dart` | Silent refresh on app resume after expiry |
| `network_error_test.dart` | Error state with retry, recovery |
| `auth_fallback_chain_test.dart` | 401 -> refresh fails -> login screen |

## Helpers

| File | Purpose |
|------|---------|
| `helpers/auth_helper.dart` | Keycloak Admin API token + JWT parsing |
| `helpers/keycloak_admin_helper.dart` | User CRUD, realm settings, key rotation |
| `helpers/native_commands.dart` | `adb` force-stop, secure storage clear |
| `helpers/test_app.dart` | `ProviderScope` wrapper for Patrol |

## Emulator Setup (one-time)

Chrome Custom Tab (used for OIDC login) uses the Android system trust store, not the app's SSL bypass. The self-signed nginx cert must be installed on the emulator. Run once per emulator lifecycle:

```bash
# 1. Launch emulator with writable system (if not already running)
emulator -avd <name> -writable-system

# 2. Disable verified boot (one-time per emulator image)
adb disable-verity
adb reboot
# Wait for reboot, then re-run adb commands below

# 3. Setup SSL cert + Chrome flags via wrapper
./patrol-wrapper.sh --setup-emulator
```

This installs the nginx cert in the system CA store and sets Chrome flags (`--disable-fre --no-first-run --disable-notifications --ignore-certificate-errors`) to prevent first-run dialogs and bypass SSL cert validation (needed because the self-signed cert has `CN=localhost` but Chrome connects to `localhost`). The cert and flags persist until the emulator is wiped or a new AVD is created.

## Stack Lifecycle for E2E

```bash
# From repo root — clean start
docker compose down -v
docker compose build
docker compose up -d

# Verify
docker ps --filter "name=keycloak" --format "{{.Status}}"
curl -sk -o /dev/null -w "%{http_code}" https://localhost:8443/auth/realms/genie
```

## Patrol Worktree Bug

`patrol_cli` (all versions up to 4.5.0) generates `test_bundle.dart` with absolute paths as Dart imports. When the project path contains dots (e.g., `.claude/worktrees/feat-mobile-oidc-6-5-auth-test-suite-ci`), Dart's URI resolver misinterprets the path segments.

`patrol-wrapper.sh` (adapted from EduLift) runs `patrol test` in the background, detects `test_bundle.dart` generation, and fixes the broken imports before the build proceeds.
