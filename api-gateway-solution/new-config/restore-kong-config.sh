#!/bin/sh

# restore-kong-config.sh
# Shell script to restore Kong configuration from a specified backup file
# Usage: ./restore-kong-config.sh [-b <backup_file>] [-t [jwt_token]] [-h]
# Switches:
#   -b <backup_file>  Path to Kong configuration backup file (optional, default: /opt/kong-config/kong_config.json)
#   -t [jwt_token]    Test endpoints with provided JWT token or prompt for credentials if no token
#   -h                Display help message
# Environment Variables:
#   LOGIN_PASSWORD    Password for testing (optional, used if not prompted)
#   KONG_ADMIN_URL    Kong Admin API URL (default: http://localhost:8001)

# Constants
KONG_ADMIN_URL="${KONG_ADMIN_URL:-http://localhost:8001}"
KONG_PUBLIC_URL="${KONG_PUBLIC_URL:-http://localhost:8000}"
USER_ID="${USER_ID:-1}"
TARGET_HOST="${TARGET_HOST:-backend}"
TARGET_PORT="${TARGET_PORT:-3000}"

# Temp files (PID-based to avoid race conditions)
_TMP_PREFIX="/tmp/_kong_$$"

# Log function - output to stdout for Docker capture
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"
}

# Check dependencies
if ! command -v curl >/dev/null 2>&1; then
    log "ERROR: curl is required but not installed. Please install curl."
    exit 1
fi
if ! command -v jq >/dev/null 2>&1; then
    log "ERROR: jq is required but not installed. Please install jq."
    exit 1
fi

# Cleanup temp files on exit
cleanup() {
    rm -f "${_TMP_PREFIX}_routes.tmp" "${_TMP_PREFIX}_route_plugins.tmp" \
          "${_TMP_PREFIX}_svc_plugins.tmp" "${_TMP_PREFIX}_global_plugins.tmp" \
          "${_TMP_PREFIX}_upstreams.tmp"
}
trap cleanup EXIT

# Wait for Kong Admin API to be ready (for init service use)
wait_for_kong() {
    log "Waiting for Kong Admin API at $KONG_ADMIN_URL..."
    max_retries=30
    retry=0
    while [ "$retry" -lt "$max_retries" ]; do
        http_code=$(curl -s -o /dev/null -w '%{http_code}' "$KONG_ADMIN_URL" 2>/dev/null)
        if [ "$http_code" = "200" ]; then
            log "Kong Admin API is ready"
            return 0
        fi
        retry=$((retry + 1))
        log "Kong Admin API not ready (attempt $retry/$max_retries), retrying in 2s..."
        sleep 2
    done
    log "ERROR: Kong Admin API not available after $((max_retries * 2)) seconds"
    return 1
}

# Usage function
usage() {
    echo "Usage: $0 [-b <backup_file>] [-t [jwt_token]] [-h]"
    echo "  -b <backup_file>  Path to Kong configuration backup file (default: /opt/kong-config/kong_config.json)"
    echo "  -t [jwt_token]    Test endpoints with provided JWT token or prompt for credentials if no token"
    echo "  -h                Display this help message"
    echo "Environment Variables:"
    echo "  KONG_ADMIN_URL    Kong Admin API URL (default: http://localhost:8001)"
    echo "  KONG_PUBLIC_URL   Kong proxy URL (default: http://localhost:8000)"
    echo "  USER_ID           User ID for force-logout test (default: 1)"
    echo "  TARGET_HOST       Backend target host (default: backend)"
    echo "  TARGET_PORT       Backend target port (default: 3000)"
    echo "  LOGIN_PASSWORD    Password for testing (optional, used if not prompted)"
    exit 1
}

# Clean up existing JWT plugins and credentials
cleanup_jwt() {
    log "Cleaning up existing JWT plugins and credentials"

    # List all routes
    routes=$(curl -s "$KONG_ADMIN_URL/routes" | jq -r '.data[].id')
    for route_id in $routes; do
        plugins=$(curl -s "$KONG_ADMIN_URL/routes/$route_id/plugins" | jq -r '.data[] | select(.name == "jwt") | .id')
        for plugin_id in $plugins; do
            log "Deleting JWT plugin $plugin_id from route $route_id"
            response=$(curl -s -w "\n%{http_code}" -X DELETE "$KONG_ADMIN_URL/routes/$route_id/plugins/$plugin_id")
            http_code=$(echo "$response" | sed -n '$p')
            if [ "$http_code" -eq 204 ]; then
                log "JWT plugin $plugin_id deleted successfully"
            else
                log "ERROR: Failed to delete JWT plugin $plugin_id with HTTP status $http_code"
            fi
        done
    done

    # List all consumers
    consumers=$(curl -s "$KONG_ADMIN_URL/consumers" | jq -r '.data[].id')
    for consumer_id in $consumers; do
        jwts=$(curl -s "$KONG_ADMIN_URL/consumers/$consumer_id/jwt" | jq -r '.data[].id')
        for jwt_id in $jwts; do
            log "Deleting JWT credential $jwt_id for consumer $consumer_id"
            response=$(curl -s -w "\n%{http_code}" -X DELETE "$KONG_ADMIN_URL/consumers/$consumer_id/jwt/$jwt_id")
            http_code=$(echo "$response" | sed -n '$p')
            if [ "$http_code" -eq 204 ]; then
                log "JWT credential $jwt_id deleted successfully"
            else
                log "ERROR: Failed to delete JWT credential $jwt_id with HTTP status $http_code"
            fi
        done
    done
}

# Restore configuration
restore_config() {
    local backup_file="$1"
    if [ ! -f "$backup_file" ]; then
        log "ERROR: Config file not found: $backup_file"
        return 1
    fi

    log "Restoring Kong configuration from $backup_file"

    # Wait for Kong Admin API to be ready
    wait_for_kong || return 1

    # Clean up existing JWT plugins and credentials
    cleanup_jwt

    # Read JSON config
    config_json=$(cat "$backup_file")

    errors=0

    # Update or create ALL services and build name->ID mapping
    service_count=$(echo "$config_json" | jq '.services | length')
    log "Processing $service_count service(s)"
    i=0
    while [ "$i" -lt "$service_count" ]; do
        service=$(echo "$config_json" | jq -r ".services[$i]")
        service_name=$(echo "$service" | jq -r '.name')
        log "Processing service $service_name"
        response=$(curl -s -w "\n%{http_code}" -X PUT "$KONG_ADMIN_URL/services/$service_name" \
            -H "Content-Type: application/json" \
            -d "$(echo "$service" | jq 'del(.id, .routes, .plugins, .created_at, .updated_at, ._comment)')" < /dev/null)
        http_code=$(echo "$response" | sed -n '$p')
        body=$(echo "$response" | sed '$d')
        if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
            log "Service $service_name processed successfully"
        else
            log "ERROR: Failed to process service $service_name with HTTP status $http_code"
            log "Response: $body"
            errors=$((errors + 1))
        fi
        i=$((i + 1))
    done

    # Update or create routes — resolve each route's service by name
    echo "$config_json" | jq -c '.routes[]' > ${_TMP_PREFIX}_routes.tmp
    while IFS= read -r route; do
        route_name=$(echo "$route" | jq -r '.name')
        route_service_name=$(echo "$route" | jq -r '.service.name')
        log "Processing route $route_name (service: $route_service_name)"
        # Resolve service ID from Kong
        route_service_id=$(curl -s "$KONG_ADMIN_URL/services/$route_service_name" < /dev/null | jq -r '.id // empty')
        if [ -z "$route_service_id" ]; then
            log "ERROR: Service '$route_service_name' not found for route $route_name, skipping"
            errors=$((errors + 1))
            continue
        fi
        route_payload=$(echo "$route" | jq --arg sid "$route_service_id" 'del(.id, .plugins, .created_at, .updated_at, ._comment) | .service = {id: $sid}')
        existing_route=$(curl -s "$KONG_ADMIN_URL/routes/$route_name" < /dev/null)
        if [ "$(echo "$existing_route" | jq -r '.id // empty')" ]; then
            response=$(curl -s -w "\n%{http_code}" -X PUT "$KONG_ADMIN_URL/routes/$route_name" \
                -H "Content-Type: application/json" \
                -d "$route_payload" < /dev/null)
        else
            response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/services/$route_service_name/routes" \
                -H "Content-Type: application/json" \
                -d "$route_payload" < /dev/null)
        fi
        http_code=$(echo "$response" | sed -n '$p')
        body=$(echo "$response" | sed '$d')
        if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
            log "Route $route_name processed successfully"
        else
            log "ERROR: Failed to process route $route_name with HTTP status $http_code"
            log "Response: $body"
            errors=$((errors + 1))
            continue
        fi

        # Update or create route-specific plugins
        plugins_count=$(echo "$route" | jq '.plugins | length')
        if [ "$plugins_count" -eq 0 ]; then
            log "No plugins found for route $route_name"
        else
            echo "$route" | jq -c '.plugins[]?' > ${_TMP_PREFIX}_route_plugins.tmp
            while IFS= read -r plugin; do
                plugin_name=$(echo "$plugin" | jq -r '.name')
                log "Processing plugin $plugin_name for route $route_name"
                existing_plugins=$(curl -s "$KONG_ADMIN_URL/routes/$route_name/plugins" < /dev/null)
                plugin_exists=$(echo "$existing_plugins" | jq -r --arg name "$plugin_name" '.data[] | select(.name == $name) | .id')
                if [ -n "$plugin_exists" ]; then
                    log "Plugin $plugin_name already exists for route $route_name, skipping"
                    continue
                fi
                plugin_payload=$(echo "$plugin" | jq 'del(.id, .created_at, .updated_at, ._comment)')
                response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/routes/$route_name/plugins" \
                    -H "Content-Type: application/json" \
                    -d "$plugin_payload" < /dev/null)
                http_code=$(echo "$response" | sed -n '$p')
                body=$(echo "$response" | sed '$d')
                if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
                    log "Plugin $plugin_name for route $route_name processed successfully"
                else
                    log "WARNING: Failed to process plugin $plugin_name for route $route_name with HTTP status $http_code"
                    log "Response: $body"
                    errors=$((errors + 1))
                    continue
                fi
            done < ${_TMP_PREFIX}_route_plugins.tmp
            rm -f ${_TMP_PREFIX}_route_plugins.tmp
        fi
    done < ${_TMP_PREFIX}_routes.tmp
    rm -f ${_TMP_PREFIX}_routes.tmp

    # Add user-admin-route (belongs to express-api service)
    log "Adding user-admin-route"
    existing_route=$(curl -s "$KONG_ADMIN_URL/routes/user-admin-route")
    if [ -z "$(echo "$existing_route" | jq -r '.id // empty')" ]; then
        response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/services/express-api/routes" \
            -H "Content-Type: application/json" \
            -d '{
                "name": "user-admin-route",
                "paths": ["/api/users/admin/users"],
                "strip_path": false,
                "preserve_host": true,
                "protocols": ["http", "https"]
            }')
        http_code=$(echo "$response" | sed -n '$p')
        body=$(echo "$response" | sed '$d')
        if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
            log "Route user-admin-route added successfully"
        else
            log "ERROR: Failed to add route user-admin-route with HTTP status $http_code"
            log "Response: $body"
            errors=$((errors + 1))
        fi
    else
        log "Route user-admin-route already exists, skipping"
    fi

    # Update or create service plugins
    echo "$config_json" | jq -c '.plugins[] | select(.service?)' > ${_TMP_PREFIX}_svc_plugins.tmp
    while IFS= read -r plugin; do
        plugin_name=$(echo "$plugin" | jq -r '.name')
        plugin_service_name=$(echo "$plugin" | jq -r '.service.name // .service')
        log "Processing service plugin $plugin_name (service: $plugin_service_name)"
        existing_plugins=$(curl -s "$KONG_ADMIN_URL/services/$plugin_service_name/plugins" < /dev/null)
        plugin_exists=$(echo "$existing_plugins" | jq -r --arg name "$plugin_name" '.data[] | select(.name == $name) | .id')
        if [ -n "$plugin_exists" ]; then
            log "Service plugin $plugin_name already exists for service $plugin_service_name, skipping"
            continue
        fi
        plugin_svc_id=$(curl -s "$KONG_ADMIN_URL/services/$plugin_service_name" < /dev/null | jq -r '.id // empty')
        if [ -z "$plugin_svc_id" ]; then
            log "ERROR: Service '$plugin_service_name' not found for plugin $plugin_name, skipping"
            errors=$((errors + 1))
            continue
        fi
        plugin_payload=$(echo "$plugin" | jq --arg sid "$plugin_svc_id" 'del(.id, .created_at, .updated_at, ._comment) | .service = {id: $sid}')
        response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/services/$plugin_service_name/plugins" \
            -H "Content-Type: application/json" \
            -d "$plugin_payload" < /dev/null)
        http_code=$(echo "$response" | sed -n '$p')
        body=$(echo "$response" | sed '$d')
        if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
            log "Service plugin $plugin_name processed successfully"
        else
            log "WARNING: Failed to process service plugin $plugin_name with HTTP status $http_code"
            log "Response: $body"
            errors=$((errors + 1))
            continue
        fi
    done < ${_TMP_PREFIX}_svc_plugins.tmp
    rm -f ${_TMP_PREFIX}_svc_plugins.tmp

    # Update or create global plugins
    echo "$config_json" | jq -c '.plugins[] | select(.service? | not)' > ${_TMP_PREFIX}_global_plugins.tmp
    while IFS= read -r plugin; do
        plugin_name=$(echo "$plugin" | jq -r '.name')
        log "Processing global plugin $plugin_name"
        existing_plugins=$(curl -s "$KONG_ADMIN_URL/plugins" < /dev/null)
        plugin_route_id=$(echo "$plugin" | jq -r '.route.id // empty')
        plugin_exists=$(echo "$existing_plugins" | jq -r --arg name "$plugin_name" --arg rid "$plugin_route_id" '.data[] | select(.name == $name and .service == null and ((.route == null and ($rid == "")) or (.route != null and .route.id == $rid))) | .id')
        if [ -n "$plugin_exists" ]; then
            log "Global plugin $plugin_name already exists, skipping"
            continue
        fi
        plugin_payload=$(echo "$plugin" | jq 'del(.id, .created_at, .updated_at, ._comment)')
        response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/plugins" \
            -H "Content-Type: application/json" \
            -d "$plugin_payload" < /dev/null)
        http_code=$(echo "$response" | sed -n '$p')
        body=$(echo "$response" | sed '$d')
        if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
            log "Global plugin $plugin_name processed successfully"
        else
            log "WARNING: Failed to process global plugin $plugin_name with HTTP status $http_code"
            log "Response: $body"
            errors=$((errors + 1))
            continue
        fi
    done < ${_TMP_PREFIX}_global_plugins.tmp
    rm -f ${_TMP_PREFIX}_global_plugins.tmp

    # Update or create upstreams
    echo "$config_json" | jq -c '.upstreams[]' > ${_TMP_PREFIX}_upstreams.tmp
    while IFS= read -r upstream; do
        upstream_name=$(echo "$upstream" | jq -r '.name')
        log "Processing upstream $upstream_name"
        upstream_payload=$(echo "$upstream" | jq 'del(.targets, .id, .created_at, .updated_at, ._comment)')
        response=$(curl -s -w "\n%{http_code}" -X PUT "$KONG_ADMIN_URL/upstreams/$upstream_name" \
            -H "Content-Type: application/json" \
            -d "$upstream_payload" < /dev/null)
        http_code=$(echo "$response" | sed -n '$p')
        body=$(echo "$response" | sed '$d')
        if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
            log "Upstream $upstream_name processed successfully"
        else
            log "ERROR: Failed to process upstream $upstream_name with HTTP status $http_code"
            log "Response: $body"
            errors=$((errors + 1))
            continue
        fi
    done < ${_TMP_PREFIX}_upstreams.tmp
    rm -f ${_TMP_PREFIX}_upstreams.tmp

    # Add upstream target
    log "Adding target ${TARGET_HOST}:${TARGET_PORT} for upstream express-api-servers"
    existing_targets=$(curl -s "$KONG_ADMIN_URL/upstreams/express-api-servers/targets")
    target_exists=$(echo "$existing_targets" | jq -r --arg target "${TARGET_HOST}:${TARGET_PORT}" '.data[] | select(.target == $target and .weight == 100) | .id')
    if [ -z "$target_exists" ]; then
        response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/upstreams/express-api-servers/targets" \
            -H "Content-Type: application/json" \
            -d "{\"target\":\"${TARGET_HOST}:${TARGET_PORT}\",\"weight\":100}")
        http_code=$(echo "$response" | sed -n '$p')
        body=$(echo "$response" | sed '$d')
        if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
            log "Target ${TARGET_HOST}:${TARGET_PORT} added successfully"
        else
            log "ERROR: Failed to add target ${TARGET_HOST}:${TARGET_PORT} with HTTP status $http_code"
            log "Response: $body"
            errors=$((errors + 1))
        fi
    else
        log "Target ${TARGET_HOST}:${TARGET_PORT} already exists, skipping"
    fi

    # Patch rate-limiting
    log "Patching global rate-limiting plugin"
    RATE_LIMIT_PLUGIN_ID=$(curl -s "$KONG_ADMIN_URL/plugins" | jq -r '.data[] | select(.name == "rate-limiting") | .id' | sed -n '1p')
    if [ -z "$RATE_LIMIT_PLUGIN_ID" ]; then
        log "WARNING: No rate-limiting plugin found, skipping patch"
    else
        plugin_count=$(curl -s "$KONG_ADMIN_URL/plugins" | jq '[.data[] | select(.name == "rate-limiting")] | length')
        if [ "$plugin_count" -gt 1 ]; then
            log "WARNING: Multiple rate-limiting plugins found ($plugin_count), using first one: $RATE_LIMIT_PLUGIN_ID"
        fi
        response=$(curl -s -w "\n%{http_code}" -X PATCH "$KONG_ADMIN_URL/plugins/$RATE_LIMIT_PLUGIN_ID" \
        -H "Content-Type: application/json" \
        -d '{
            "config": {
                "minute": 1000,
                "hour": 10000
            }
        }')
        http_code=$(echo "$response" | sed -n '$p')
        body=$(echo "$response" | sed '$d')
        if [ "$http_code" -eq 200 ]; then
            log "Global rate-limiting plugin patched successfully"
        else
            log "ERROR: Failed to patch global rate-limiting plugin with HTTP status $http_code"
            log "Response: $body"
            errors=$((errors + 1))
        fi
    fi

    if [ "$errors" -eq 0 ]; then
        log "Configuration restored successfully"
        return 0
    else
        log "Configuration restored with $errors warnings/errors, but continuing"
        return 1
    fi
}

# Test endpoints
test_endpoints() {
    local jwt_token="$1"
    if [ -z "$jwt_token" ]; then
        log "No JWT token provided, prompting for username and password"
        printf "Enter username (email): "
        read -r username
        if [ -z "$username" ]; then
            log "ERROR: Username is required"
            exit 1
        fi
        if [ -t 0 ]; then
            printf "Enter password: " && stty -echo && read -r password && stty echo && printf '\n'
        else
            printf "Enter password: " && read -r password && printf '\n'
        fi
        if [ -z "$password" ]; then
            if [ -n "$LOGIN_PASSWORD" ]; then
                log "Using LOGIN_PASSWORD from environment variable"
                password="$LOGIN_PASSWORD"
            else
                log "ERROR: Password is required"
                exit 1
            fi
        fi

        log "Obtaining new JWT token via login for $username"
        response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_PUBLIC_URL/api/auth/login" \
            -H "Content-Type: application/json" \
            -d "{\"email\": \"$username\", \"password\": \"$password\"}")
        http_code=$(echo "$response" | sed -n '$p')
        body=$(echo "$response" | sed '$d')
        if [ "$http_code" -eq 200 ]; then
            jwt_token=$(echo "$body" | jq -r '.accessToken')
            log "SUCCESS: Obtained JWT token (first 10 chars: $(printf '%.10s' "$jwt_token")...)"
        else
            log "ERROR: Failed to obtain JWT token with HTTP status $http_code"
            log "Response: $body"
            exit 1
        fi
    else
        log "Using provided JWT token (first 10 chars: $(printf '%.10s' "$jwt_token")...)"
    fi

    # Test 1: POST /api/auth/logout
    log "Testing POST /api/auth/logout"
    response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_PUBLIC_URL/api/auth/logout" \
        -H "Authorization: Bearer $jwt_token" \
        -H "Content-Type: application/json" \
        -d '{}')
    http_code=$(echo "$response" | sed -n '$p')
    body=$(echo "$response" | sed '$d')
    if [ "$http_code" -eq 200 ]; then
        log "SUCCESS: /api/auth/logout returned 200"
        log "Response: $body"
    else
        log "ERROR: /api/auth/logout failed with status $http_code"
        log "Response: $body"
        exit 1
    fi

    # Test 2: POST /api/users/admin/users/{USER_ID}/force-logout
    log "Testing POST /api/users/admin/users/$USER_ID/force-logout"
    response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_PUBLIC_URL/api/users/admin/users/$USER_ID/force-logout" \
        -H "Authorization: Bearer $jwt_token" \
        -H "Content-Type: application/json" \
        -d '{}')
    http_code=$(echo "$response" | sed -n '$p')
    body=$(echo "$response" | sed '$d')
    if [ "$http_code" -eq 200 ]; then
        log "SUCCESS: /api/users/admin/users/$USER_ID/force-logout returned 200"
        log "Response: $body"
    else
        log "ERROR: /api/users/admin/users/$USER_ID/force-logout failed with status $http_code"
        log "Response: $body"
        exit 1
    fi

    # Test 3: GET /api/service-categories
    log "Testing GET /api/service-categories?locale=en"
    response=$(curl -s -w "\n%{http_code}" "$KONG_PUBLIC_URL/api/service-categories?locale=en" \
        -H "Authorization: Bearer $jwt_token")
    http_code=$(echo "$response" | sed -n '$p')
    body=$(echo "$response" | sed '$d')
    if [ "$http_code" -eq 200 ]; then
        log "SUCCESS: /api/service-categories returned 200"
        log "Response: $body"
    else
        log "ERROR: /api/service-categories failed with status $http_code"
        log "Response: $body"
        exit 1
    fi
}

# Parse command-line options
BACKUP_FILE="${BACKUP_FILE:-/opt/kong-config/kong_config.json}"
TEST_TOKEN=""
TEST_MODE=false
while getopts "b:t::h" opt; do
    case $opt in
        b)
            BACKUP_FILE="$OPTARG"
            ;;
        t)
            TEST_TOKEN="${OPTARG:-}"
            TEST_MODE=true
            ;;
        h)
            usage
            ;;
        \?)
            log "ERROR: Invalid option: -$OPTARG"
            usage
            ;;
        :)
            if [ "$OPTARG" = "t" ]; then
                TEST_TOKEN=""
                TEST_MODE=true
            else
                log "ERROR: Option -$OPTARG requires an argument"
                usage
            fi
            ;;
    esac
done

# Execute operations
if [ "$TEST_MODE" = true ]; then
    test_endpoints "$TEST_TOKEN"
elif [ -n "$BACKUP_FILE" ]; then
    restore_config "$BACKUP_FILE"
    _restore_rc=$?
else
    log "ERROR: No action specified. Use -b <backup_file> or -t [jwt_token]"
    usage
fi

if [ "$_restore_rc" -eq 0 ] 2>/dev/null; then
    log "Operation completed successfully"
fi
exit ${_restore_rc:-0}
