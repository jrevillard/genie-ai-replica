#!/bin/bash
# Wrapper for Patrol that auto-fixes test_bundle.dart generation issues
# Works with ANY worktree path or test names

set -e

export PATH="$PATH:$HOME/.pub-cache/bin"

# Resolve project root (worktree-aware)
PROJECT_ROOT="$(git rev-parse --show-toplevel 2>/dev/null || echo "../..")"
ENV_FILE="$PROJECT_ROOT/.env"

# Resolve script directory and cd into it (all relative paths are from mobile/genie_ai_mobile/)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Launching Patrol with auto-fix for test_bundle.dart..."

# Generate e2e_secrets.dart from .env or environment
if [ -f "$ENV_FILE" ]; then
    KC_PWD=$(grep "^KEYCLOAK_ADMIN_PASSWORD=" "$ENV_FILE" | cut -d= -f2-)
elif [ -n "$KEYCLOAK_ADMIN_PASSWORD" ]; then
    KC_PWD="$KEYCLOAK_ADMIN_PASSWORD"
    cat > patrol_test/e2e_secrets.dart << SECRETS
// E2E test secrets — generated from .env by patrol-wrapper.sh. DO NOT COMMIT.
class E2eSecrets {
  const E2eSecrets({required this.keycloakAdminPassword});
  final String keycloakAdminPassword;
}
const e2eSecrets = E2eSecrets(
  keycloakAdminPassword: r'$KC_PWD',
);
SECRETS
    echo "🔑 Generated e2e_secrets.dart from $ENV_FILE"
else
    echo "⚠️  .env not found at $ENV_FILE — e2e_secrets.dart may be outdated"
fi

# --- Shared helpers ---

# Resolve adb command with optional device serial.
adb_cmd() {
    if [ -n "$ADB_DEVICE" ]; then
        echo "adb -s $ADB_DEVICE"
    else
        echo "adb"
    fi
}

# Resolve Keycloak base URL (CI or local).
keycloak_base() {
    if [ -n "$CI_NGINX_URL" ]; then
        echo "$CI_NGINX_URL"
    else
        local port
        port=$(grep "^NGINX_HTTPS_PORT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
        port="${port:-443}"
        echo "https://localhost:${port}"
    fi
}

# --- Emulator setup functions ---
# These run ONCE per emulator lifecycle, not every test run.

# Extract nginx cert from Docker and install on emulator system CA store.
# Requires: emulator launched with -writable-system + disable-verity.
setup_emulator_ssl() {
    echo "🔐 Setting up SSL certificate on emulator..."

    ADB_CMD=$(adb_cmd)

    # 1. Find nginx container
    NGINX_CONTAINER=$(docker ps --filter "name=nginx" --format "{{.Names}}" | head -1)
    if [ -z "$NGINX_CONTAINER" ]; then
        echo "❌ No nginx container running — cannot extract certificate"
        exit 1
    fi

    # 2. Extract cert
    docker exec "$NGINX_CONTAINER" cat /etc/nginx/certs/server.crt > /tmp/itu-nginx-cert.pem 2>/dev/null
    if [ ! -s /tmp/itu-nginx-cert.pem ]; then
        echo "❌ Failed to extract certificate from nginx container"
        exit 1
    fi

    # 3. Compute hash (old-style for Android system store)
    CERT_HASH=$(openssl x509 -inform PEM -subject_hash_old -in /tmp/itu-nginx-cert.pem | head -1)
    cp /tmp/itu-nginx-cert.pem "/tmp/${CERT_HASH}.0"

    # 4. Check if already installed
    INSTALLED=$($ADB_CMD shell "ls /system/etc/security/cacerts/${CERT_HASH}.0 2>/dev/null" | tr -d '\r')
    if [ -n "$INSTALLED" ]; then
        echo "✅ Certificate already installed (${CERT_HASH}.0)"
        return 0
    fi

    # 5. Install (requires -writable-system + disable-verity)
    $ADB_CMD push "/tmp/${CERT_HASH}.0" /system/etc/security/cacerts/ || {
        echo "❌ Failed to push cert. Ensure emulator was launched with:"
        echo "   emulator -avd <name> -writable-system"
        echo "   adb disable-verity && adb reboot"
        echo "   (then re-run setup after reboot)"
        exit 1
    }
    $ADB_CMD shell chmod 644 "/system/etc/security/cacerts/${CERT_HASH}.0"
    echo "✅ Certificate installed (${CERT_HASH}.0)"
}

# Disable Chrome first-run dialogs and notifications in Chrome Custom Tab.
setup_chrome_flags() {
    echo "🌐 Setting Chrome flags on emulator..."
    ADB_CMD=$(adb_cmd)
    $ADB_CMD shell 'echo "chrome --disable-fre --no-first-run --disable-notifications --ignore-certificate-errors" > /data/local/tmp/chrome-command-line'
    echo "✅ Chrome flags set (--disable-fre --no-first-run --disable-notifications --ignore-certificate-errors)"
}

# Create (if needed) and enable ROPC on the dedicated E2E mobile client.
# This client is independent of KC_MOBILE_CLIENT_ID — it exists only for E2E tests.
E2E_CLIENT_ID="genie-mobile-e2e"
E2E_REDIRECT_SCHEME="com.itu.genieai.e2e"

get_admin_token() {
    if [ -f "$ENV_FILE" ]; then
        KC_PWD=$(grep "^KEYCLOAK_ADMIN_PASSWORD=" "$ENV_FILE" | cut -d= -f2-)
    else
        KC_PWD="$KEYCLOAK_ADMIN_PASSWORD"
    fi
    KEYCLOAK_BASE=$(keycloak_base)

    curl -sk -X POST "${KEYCLOAK_BASE}/auth/realms/master/protocol/openid-connect/token" \
        -d "client_id=admin-cli" -d "username=admin" -d "password=${KC_PWD}" -d "grant_type=password" \
        2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))" 2>/dev/null
}

enable_e2e_client() {
    ADMIN_TOKEN=$(get_admin_token)
    if [ -z "$ADMIN_TOKEN" ]; then
        echo "⚠️  Could not get Keycloak admin token — skipping E2E client setup"
        return 1
    fi

    KEYCLOAK_BASE=$(keycloak_base)

    # Check if client already exists
    CLIENT_UUID=$(curl -sk "${KEYCLOAK_BASE}/auth/admin/realms/genie/clients?clientId=${E2E_CLIENT_ID}" \
        -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null \
        | python3 -c "import sys,json; clients=json.load(sys.stdin); print(clients[0]['id'] if clients else '')" 2>/dev/null)

    if [ -n "$CLIENT_UUID" ]; then
        # Client exists — just enable ROPC
        curl -sk -X PUT "${KEYCLOAK_BASE}/auth/admin/realms/genie/clients/${CLIENT_UUID}" \
            -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
            -d '{"directAccessGrantsEnabled": true}' 2>/dev/null
        echo "🔓 ROPC enabled on existing ${E2E_CLIENT_ID}"
    else
        # Create the E2E client with ROPC enabled
        curl -sk -X POST "${KEYCLOAK_BASE}/auth/admin/realms/genie/clients" \
            -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
            -d "{
                \"clientId\": \"${E2E_CLIENT_ID}\",
                \"enabled\": true,
                \"publicClient\": true,
                \"standardFlowEnabled\": true,
                \"directAccessGrantsEnabled\": true,
                \"implicitFlowEnabled\": false,
                \"serviceAccountsEnabled\": false,
                \"attributes\": {
                    \"pkce.code.challenge.method\": \"S256\",
                    \"client.credentials.use.refresh.token\": \"true\",
                    \"revoke.refresh.token.on.use\": \"true\"
                },
                \"redirectUris\": [\"${E2E_REDIRECT_SCHEME}://callback\"],
                \"webOrigins\": [\"android-app://com.example.genie_ai_mobile.e2e\"]
            }" 2>/dev/null
        echo "🔓 Created ${E2E_CLIENT_ID} with ROPC enabled"
    fi
}

# Disable ROPC on the E2E mobile client (cleanup after tests).
disable_e2e_client() {
    ADMIN_TOKEN=$(get_admin_token)
    if [ -z "$ADMIN_TOKEN" ]; then
        echo "⚠️  Could not get Keycloak admin token — skipping ROPC cleanup"
        return
    fi

    KEYCLOAK_BASE=$(keycloak_base)

    CLIENT_UUID=$(curl -sk "${KEYCLOAK_BASE}/auth/admin/realms/genie/clients?clientId=${E2E_CLIENT_ID}" \
        -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null \
        | python3 -c "import sys,json; clients=json.load(sys.stdin); print(clients[0]['id'] if clients else '')" 2>/dev/null)

    if [ -n "$CLIENT_UUID" ]; then
        curl -sk -X PUT "${KEYCLOAK_BASE}/auth/admin/realms/genie/clients/${CLIENT_UUID}" \
            -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
            -d '{"directAccessGrantsEnabled": false}' 2>/dev/null
        echo "🔒 ROPC disabled on ${E2E_CLIENT_ID}"
    fi
}

# Parse flags — pass everything through to patrol, but extract --flavor for dart-define injection
SETUP_EMULATOR=false
PATROL_FLAGS=()
FLAVOR=""

# First pass: collect all flags and detect wrapper-specific options
for arg in "$@"; do
    case "$arg" in
        --setup-emulator)
            SETUP_EMULATOR=true
            ;;
        *)
            PATROL_FLAGS+=("$arg")
            ;;
    esac
done

# Extract --flavor value from PATROL_FLAGS (supports both --flavor e2e and --flavor=e2e)
for i in "${!PATROL_FLAGS[@]}"; do
    if [[ "${PATROL_FLAGS[$i]}" == --flavor=* ]]; then
        FLAVOR="${PATROL_FLAGS[$i]#--flavor=}"
        break
    elif [ "${PATROL_FLAGS[$i]}" = "--flavor" ] && [ -n "${PATROL_FLAGS[$((i+1))]}" ]; then
        FLAVOR="${PATROL_FLAGS[$((i+1))]}"
        break
    fi
done

if [ "$SETUP_EMULATOR" = true ]; then
    setup_emulator_ssl
    setup_chrome_flags
    echo ""
    echo "✅ Emulator setup complete. You can now run tests without --setup-emulator."
    exit 0
fi

# Setup ADB reverse port forwarding so tests running inside the emulator
# can reach the host's Docker services (Keycloak, nginx) via localhost.
ADB_CMD=$(adb_cmd)
NGINX_PORT=$(grep "^NGINX_HTTPS_PORT=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-)
NGINX_PORT="${NGINX_PORT:-443}"
# In CI, adb reverse may not be needed (emulator reaches compose network directly via dart-define overrides)
if [ -z "$CI_NGINX_URL" ]; then
    if $ADB_CMD reverse "tcp:${NGINX_PORT}" "tcp:${NGINX_PORT}" 2>/dev/null; then
        echo "🔌 ADB reverse: emulator localhost:${NGINX_PORT} → host localhost:${NGINX_PORT}"
    else
        echo "⚠️  adb reverse failed — tests may not reach Keycloak/nginx"
    fi
else
    echo "🔌 CI mode: skipping adb reverse (using direct compose network routing via dart-define)"
fi

# Default device if not specified
DEVICE_SPECIFIED=false
for arg in "${PATROL_FLAGS[@]}"; do
    if [[ "$arg" == "--device"* ]] || [[ "$arg" == "-d"* ]]; then
        DEVICE_SPECIFIED=true
        break
    fi
done

# Build the command with default device if needed
if [ "$DEVICE_SPECIFIED" = false ]; then
    echo "📱 No device specified, using default: emulator-5554"
    PATROL_ARGS=("-d" "emulator-5554" "${PATROL_FLAGS[@]}")
else
    PATROL_ARGS=("${PATROL_FLAGS[@]}")
fi

# Auto-inject --dart-define=FLAVOR=<flavor> so getConfig() picks up the right config.
# Without this, String.fromEnvironment('FLAVOR', defaultValue: 'dev') defaults to 'dev',
# which uses 10.0.2.2 instead of localhost for the e2e flavor.
if [ -n "$FLAVOR" ]; then
    # Check if --dart-define=FLAVOR is already present
    HAS_FLAVOR_DEFINE=false
    for arg in "${PATROL_ARGS[@]}"; do
        if [[ "$arg" == *"--dart-define=FLAVOR="* ]] || [[ "$arg" == *"--dart-define"* && "$arg" == *"FLAVOR="* ]]; then
            HAS_FLAVOR_DEFINE=true
            break
        fi
    done
    if [ "$HAS_FLAVOR_DEFINE" = false ]; then
        PATROL_ARGS+=("--dart-define=FLAVOR=${FLAVOR}")
        echo "🔧 Auto-injected --dart-define=FLAVOR=${FLAVOR}"
    fi
fi

# Inject extra dart-defines from EXTRA_DART_DEFINES (newline-separated, for CI overrides).
if [ -n "$EXTRA_DART_DEFINES" ]; then
    while IFS= read -r define; do
        [ -z "$define" ] && continue
        case "$define" in
            --dart-define=*) PATROL_ARGS+=("$define") ;;
            *) PATROL_ARGS+=("--dart-define=$define") ;;
        esac
        echo "🔧 Injected dart-define: $define"
    done <<< "$EXTRA_DART_DEFINES"
fi

# Function to fix test_bundle.dart
fix_test_bundle() {
    if [ -f "patrol_test/test_bundle.dart" ]; then
        echo "🔧 Detected test_bundle.dart generation, fixing git worktree path issues..."

        python3 << 'PYTHON_EOF'
import re
import os
import fcntl

file_path = "patrol_test/test_bundle.dart"
lock_file = "patrol_test/test_bundle.dart.lock"

try:
    fd = os.open(lock_file, os.O_CREAT | os.O_WRONLY)
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except IOError:
    print("✅ Already fixed or another instance running")
    exit(0)

try:
    with open(file_path, 'r') as f:
        content = f.read()

    # Check if already fixed (no absolute-like paths in imports)
    if not re.search(r"^import '(?:/|[a-z])[^']*integration_test", content, re.MULTILINE):
        print("✅ Already fixed")
        exit(0)

    # Fix import paths: convert absolute paths to relative ../integration_test/...
    def fix_import_line(match):
        import_path = match.group(1)
        old_alias = match.group(2)

        parts = import_path.replace('\\', '/').split('/')
        if 'integration_test' in parts:
            idx = parts.index('integration_test')
            import_path = '../' + '/'.join(parts[idx:])

        filename = import_path.split('/')[-1].replace('.dart', '')

        return "import '%s' as %s;" % (import_path, filename)

    content = re.sub(
        r"^import '((?:/|[a-z])[^']+integration_test/[^']+\.dart)' as ([^;]+);$",
        fix_import_line,
        content,
        flags=re.MULTILINE
    )

    # Fix group() calls: simplify long aliases to filename
    def fix_group_main(match):
        indent = match.group(1) if match.group(1) else ''
        group_name = match.group(2)
        long_alias = match.group(3)
        alias_without_main = long_alias.replace('.main', '')
        parts = re.split(r'__|\.', alias_without_main)
        filename = parts[-1] if parts else alias_without_main
        return "%sgroup('%s', %s.main);" % (indent, group_name, filename)

    content = re.sub(
        r"^(\s*)group\('([^']+)', ([^)]+\.main)\);$",
        fix_group_main,
        content,
        flags=re.MULTILINE
    )

    with open(file_path, 'w') as f:
        f.write(content)

    print("✅ test_bundle.dart fixed")

finally:
    try:
        os.close(fd)
        os.unlink(lock_file)
    except:
        pass
PYTHON_EOF

    else
        echo "⚠️  test_bundle.dart not found yet, will fix when generated..."
        return 1
    fi
}

# Clean up any existing test_bundle.dart
rm -f patrol_test/test_bundle.dart

# Fix test_bundle.dart in a tight loop. Patrol generates the file then
# starts the Flutter build — we must fix it before the build reads it.
fix_loop() {
    for i in $(seq 1 600); do
        if [ -f "patrol_test/test_bundle.dart" ]; then
            sleep 0.1
            fix_test_bundle
            return
        fi
        sleep 0.1
    done
    echo "⚠️  test_bundle.dart never appeared"
}

FIX_LOOP_PID=""
fix_loop &
FIX_LOOP_PID=$!

# Create/enable E2E client with ROPC for token injection.
enable_e2e_client || true

# In CI mode, start a keepalive that keeps the ADB TCP connection alive during
# idle periods (Gradle build, APK installation, orchestrator startup).
#
# KEY INSIGHT: `adb connect` on an already-connected device is a no-op ("already
# connected to X") — it does NOT re-establish a dropped TCP connection. We must
# `adb disconnect` first to force a fresh TCP handshake each cycle.
#
# Phase 1: disconnect+reconnect every 30s until a NEW test APK appears.
# Phase 2: disconnect+reconnect every 5s until `am instrument` is detected.
# Once tests are running, ADB traffic from the orchestrator keeps the connection alive.
KEEPALIVE_PID=""
KEEPALIVE_MARKER=""
KEEPALIVE_LOG=0
if [ -n "$ADB_DEVICE" ] && [ -n "$CI_NGINX_URL" ]; then
    KEEPALIVE_MARKER=$(mktemp)
    (
      # Phase 1: keep alive during Gradle build (no ADB traffic)
      # Each cycle: disconnect → sleep 1 → reconnect → verify device is online.
      # This forces a fresh TCP connection instead of pinging a dead one.
      CYCLE=0
      while ! find build/app/outputs/apk/androidTest -name "*-androidTest.apk" -newer "$KEEPALIVE_MARKER" 2>/dev/null | grep -q .; do
          CYCLE=$((CYCLE + 1))
          adb disconnect "$ADB_DEVICE" 2>/dev/null || true
          sleep 1
          CONNECT_OUTPUT=$(adb connect "$ADB_DEVICE" 2>&1)
          BOOT_CHECK=$(adb -s "$ADB_DEVICE" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
          if [ "$BOOT_CHECK" = "1" ]; then
              echo "🔄 ADB keepalive P1 cycle $CYCLE: OK ($CONNECT_OUTPUT) ($(date +%H:%M:%S))"
          else
              echo "⚠️ ADB keepalive P1 cycle $CYCLE: FAILED — boot='$BOOT_CHECK' connect='$CONNECT_OUTPUT' ($(date +%H:%M:%S))"
          fi
          sleep 30
      done
      echo "🔄 ADB keepalive: APK built after $CYCLE cycles, starting Phase 2..."
      # Phase 2: keep alive during APK install + orchestrator startup (~30s gap)
      # Faster polling since this phase is short but critical.
      for i in $(seq 1 24); do
          adb disconnect "$ADB_DEVICE" 2>/dev/null || true
          sleep 1
          adb connect "$ADB_DEVICE" >/dev/null 2>&1
          if adb -s "$ADB_DEVICE" shell ps 2>/dev/null | grep -q "am instrument"; then
              echo "🔄 ADB keepalive P2 cycle $i: orchestrator running, stopping"
              exit 0
          fi
          echo "🔄 ADB keepalive P2 cycle $i/24: waiting for orchestrator ($(date +%H:%M:%S))"
          sleep 4
      done
      echo "⚠️ ADB keepalive P2: timed out after 24 cycles waiting for orchestrator"
    ) &
    KEEPALIVE_PID=$!
    KEEPALIVE_LOG=1
    echo "🔄 ADB keepalive started (PID $KEEPALIVE_PID) — force-reconnecting to $ADB_DEVICE every 30s"
fi

# Ensure cleanup on exit (even on SIGINT/SIGTERM).
cleanup() {
    # Kill fix_loop background process to prevent blocking exit
    if [ -n "$FIX_LOOP_PID" ]; then
        kill "$FIX_LOOP_PID" 2>/dev/null || true
        wait "$FIX_LOOP_PID" 2>/dev/null || true
    fi
    if [ -n "$KEEPALIVE_PID" ]; then
        kill "$KEEPALIVE_PID" 2>/dev/null || true
    fi
    rm -f "$KEEPALIVE_MARKER" 2>/dev/null || true
    disable_e2e_client
    # Dump Android test report if available (for CI debugging)
    # Use timeout to prevent adb from blocking if device is unreachable
    if [ -n "$ADB_DEVICE" ] && [ -n "$CI_NGINX_URL" ]; then
        echo "--- Android test report (if available) ---"
        timeout 5 adb -s "$ADB_DEVICE" shell "cat /sdcard/android.test/report.xml" 2>/dev/null || true
        echo "--- Logcat (last 50 lines) ---"
        timeout 5 adb -s "$ADB_DEVICE" logcat -d -t 50 2>/dev/null | grep -i "patrol\|test\|orchestrat\|instrument\|error\|failed" || true
    fi
}
trap cleanup EXIT

# Add --verbose in CI for better diagnostics
if [ -n "$CI_NGINX_URL" ]; then
    PATROL_ARGS=("--verbose" "${PATROL_ARGS[@]}")

    # Force a fresh ADB connection before handing off to patrol.
    # The keepalive may have stopped (Phase 2 timeout or orchestrator detected)
    # and the TCP connection can die in the gap between keepalive exit and
    # patrol's first ADB command.
    echo "🔄 Forcing ADB reconnect before patrol test..."
    adb disconnect "$ADB_DEVICE" 2>/dev/null || true
    sleep 2
    RECONNECT_OUTPUT=$(adb connect "$ADB_DEVICE" 2>&1)
    echo "🔄 adb connect: $RECONNECT_OUTPUT"
    BOOT_CHECK=$(adb -s "$ADB_DEVICE" shell getprop sys.boot_completed 2>/dev/null | tr -d '\r')
    if [ "$BOOT_CHECK" = "1" ]; then
        echo "✅ Device $ADB_DEVICE confirmed online before patrol ($(date +%H:%M:%S))"
    else
        echo "❌ Device $ADB_DEVICE OFFLINE after reconnect — boot='$BOOT_CHECK' connect='$RECONNECT_OUTPUT'"
        echo "❌ Cannot proceed with tests"
        exit 1
    fi
fi

patrol test "${PATROL_ARGS[@]}" || exit $?
