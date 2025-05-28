#!/bin/bash

# restore-kong-config.sh
# Shell script to restore Kong configuration from kong_backup_20250527_162608.json
# Usage: ./restore-kong-config.sh [-t <jwt_token>] [-h]
# Switches:
#   -t <jwt_token>: Test endpoints with provided JWT token
#   -h: Display help

# Constants
KONG_ADMIN_URL="http://localhost:8001"
KONG_PUBLIC_URL="http://e2e-82-109.ssdcloudindia.net:8000"
BACKUP_FILE="kong_backups/kong_backup_20250527_162608.json"
USER_ID="2133"
LOGIN_NAME="fordendk"
LOGIN_PASSWORD="test" # Replace with actual password
LOG_FILE="kong_restore.log"

# Log function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
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

# Usage function
usage() {
    echo "Usage: $0 [-t <jwt_token>] [-h]"
    echo "  -t <jwt_token>  Test endpoints with provided JWT token"
    echo "  -h              Display this help message"
    exit 1
}

# Restore configuration
restore_config() {
    if [ ! -f "$BACKUP_FILE" ]; then
        log "ERROR: $BACKUP_FILE not found"
        exit 1
    fi

    log "Restoring Kong configuration from $BACKUP_FILE"

    # Read JSON config
    config_json=$(cat "$BACKUP_FILE")

    errors=0

    # Update or create service
    service=$(echo "$config_json" | jq -r '.services[0]')
    service_name=$(echo "$service" | jq -r '.name')
    log "Processing service $service_name"
    response=$(curl -s -w "\n%{http_code}" -X PUT "$KONG_ADMIN_URL/services/$service_name" \
        -H "Content-Type: application/json" \
        -d "$(echo "$service" | jq 'del(.id, .routes, .plugins, .created_at, .updated_at)')")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n -1)
    if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
        log "Service $service_name processed successfully"
        service_id=$(curl -s "$KONG_ADMIN_URL/services/$service_name" | jq -r '.id')
    else
        log "ERROR: Failed to process service $service_name with HTTP status $http_code"
        log "Response: $body"
        errors=$((errors + 1))
        exit 1
    fi

    # Update or create routes
    while IFS= read -r route; do
        route_name=$(echo "$route" | jq -r '.name')
        log "Processing route $route_name"
        route_payload=$(echo "$route" | jq --arg sid "$service_id" 'del(.id, .plugins, .created_at, .updated_at) | .service = {id: $sid}')
        existing_route=$(curl -s "$KONG_ADMIN_URL/routes/$route_name")
        if [ "$(echo "$existing_route" | jq -r '.id // empty')" ]; then
            response=$(curl -s -w "\n%{http_code}" -X PUT "$KONG_ADMIN_URL/routes/$route_name" \
                -H "Content-Type: application/json" \
                -d "$route_payload")
        else
            response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/services/$service_name/routes" \
                -H "Content-Type: application/json" \
                -d "$route_payload")
        fi
        http_code=$(echo "$response" | tail -n1)
        body=$(echo "$response" | head -n -1)
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
            while IFS= read -r plugin; do
                plugin_name=$(echo "$plugin" | jq -r '.name')
                log "Processing plugin $plugin_name for route $route_name"
                existing_plugins=$(curl -s "$KONG_ADMIN_URL/routes/$route_name/plugins")
                plugin_exists=$(echo "$existing_plugins" | jq -r --arg name "$plugin_name" '.data[] | select(.name == $name) | .id')
                if [ -n "$plugin_exists" ]; then
                    log "Plugin $plugin_name already exists for route $route_name, skipping"
                    continue
                fi
                plugin_payload=$(echo "$plugin" | jq 'del(.id, .created_at, .updated_at)')
                response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/routes/$route_name/plugins" \
                    -H "Content-Type: application/json" \
                    -d "$plugin_payload")
                http_code=$(echo "$response" | tail -n1)
                body=$(echo "$response" | head -n -1)
                if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
                    log "Plugin $plugin_name for route $route_name processed successfully"
                else
                    log "ERROR: Failed to process plugin $plugin_name for route $route_name with HTTP status $http_code"
                    log "Response: $body"
                    errors=$((errors + 1))
                fi
            done < <(echo "$route" | jq -c '.plugins[]?')
        fi
    done < <(echo "$config_json" | jq -c '.routes[]')

    # Update or create service plugins
    while IFS= read -r plugin; do
        plugin_name=$(echo "$plugin" | jq -r '.name')
        log "Processing service plugin $plugin_name"
        existing_plugins=$(curl -s "$KONG_ADMIN_URL/services/$service_name/plugins")
        plugin_exists=$(echo "$existing_plugins" | jq -r --arg name "$plugin_name" '.data[] | select(.name == $name) | .id')
        if [ -n "$plugin_exists" ]; then
            log "Service plugin $plugin_name already exists for service $service_name, skipping"
            continue
        fi
        plugin_payload=$(echo "$plugin" | jq --arg sid "$service_id" 'del(.id, .created_at, .updated_at) | .service = {id: $sid}')
        response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/services/$service_name/plugins" \
            -H "Content-Type: application/json" \
            -d "$plugin_payload")
        http_code=$(echo "$response" | tail -n1)
        body=$(echo "$response" | head -n -1)
        if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
            log "Service plugin $plugin_name processed successfully"
        else
            log "ERROR: Failed to process service plugin $plugin_name with HTTP status $http_code"
            log "Response: $body"
            errors=$((errors + 1))
        fi
    done < <(echo "$config_json" | jq -c '.plugins[] | select(.service?)')

    # Update or create global plugins
    while IFS= read -r plugin; do
        plugin_name=$(echo "$plugin" | jq -r '.name')
        log "Processing global plugin $plugin_name"
        existing_plugins=$(curl -s "$KONG_ADMIN_URL/plugins")
        plugin_exists=$(echo "$existing_plugins" | jq -r --arg name "$plugin_name" '.data[] | select(.name == $name and .service == null and .route == null) | .id')
        if [ -n "$plugin_exists" ]; then
            log "Global plugin $plugin_name already exists, skipping"
            continue
        fi
        plugin_payload=$(echo "$plugin" | jq 'del(.id, .created_at, .updated_at)')
        response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/plugins" \
            -H "Content-Type: application/json" \
            -d "$plugin_payload")
        http_code=$(echo "$response" | tail -n1)
        body=$(echo "$response" | head -n -1)
        if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
            log "Global plugin $plugin_name processed successfully"
        else
            log "ERROR: Failed to process global plugin $plugin_name with HTTP status $http_code"
            log "Response: $body"
            errors=$((errors + 1))
        fi
    done < <(echo "$config_json" | jq -c '.plugins[] | select(.service? | not)')

    # Update or create upstreams
    while IFS= read -r upstream; do
        upstream_name=$(echo "$upstream" | jq -r '.name')
        log "Processing upstream $upstream_name"
        upstream_payload=$(echo "$upstream" | jq 'del(.targets, .id, .created_at, .updated_at)')
        response=$(curl -s -w "\n%{http_code}" -X PUT "$KONG_ADMIN_URL/upstreams/$upstream_name" \
            -H "Content-Type: application/json" \
            -d "$upstream_payload")
        http_code=$(echo "$response" | tail -n1)
        body=$(echo "$response" | head -n -1)
        if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
            log "Upstream $upstream_name processed successfully"
        else
            log "ERROR: Failed to process upstream $upstream_name with HTTP status $http_code"
            log "Response: $body"
            errors=$((errors + 1))
            continue
        fi
    done < <(echo "$config_json" | jq -c '.upstreams[]')

    # Add auth-refresh-route and auth-login-route
    log "Adding auth-refresh-route"
    existing_route=$(curl -s "$KONG_ADMIN_URL/routes/auth-refresh-route")
    if [ -z "$(echo "$existing_route" | jq -r '.id // empty')" ]; then
        response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/services/$service_name/routes" \
            -H "Content-Type: application/json" \
            -d '{
                "name": "auth-refresh-route",
                "paths": ["/api/auth/refresh-token"],
                "methods": ["POST"],
                "strip_path": false,
                "preserve_host": true,
                "protocols": ["http", "https"]
            }')
        http_code=$(echo "$response" | tail -n1)
        body=$(echo "$response" | head -n -1)
        if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
            log "Route auth-refresh-route added successfully"
        else
            log "ERROR: Failed to add route auth-refresh-route with HTTP status $http_code"
            log "Response: $body"
            errors=$((errors + 1))
        fi
    else
        log "Route auth-refresh-route already exists, skipping"
    fi

    log "Adding JWT plugin for auth-refresh-route"
    existing_plugins=$(curl -s "$KONG_ADMIN_URL/routes/auth-refresh-route/plugins")
    if [ -z "$(echo "$existing_plugins" | jq -r '.data[] | select(.name == "jwt") | .id')" ]; then
        response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/routes/auth-refresh-route/plugins" \
            -H "Content-Type: application/json" \
            -d '{
                "name": "jwt",
                "config": {
                    "key_claim_name": "iss",
                    "secret_is_base64": false
                }
            }')
        http_code=$(echo "$response" | tail -n1)
        body=$(echo "$response" | head -n -1)
        if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
            log "JWT plugin for auth-refresh-route added successfully"
        else
            log "ERROR: Failed to add JWT plugin for auth-refresh-route with HTTP status $http_code"
            log "Response: $body"
            errors=$((errors + 1))
        fi
    else
        log "JWT plugin for auth-refresh-route already exists, skipping"
    fi

    log "Adding auth-login-route"
    existing_route=$(curl -s "$KONG_ADMIN_URL/routes/auth-login-route")
    if [ -z "$(echo "$existing_route" | jq -r '.id // empty')" ]; then
        response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/services/$service_name/routes" \
            -H "Content-Type: application/json" \
            -d '{
                "name": "auth-login-route",
                "paths": ["/api/auth/login"],
                "methods": ["POST"],
                "strip_path": false,
                "preserve_host": true,
                "protocols": ["http", "https"]
            }')
        http_code=$(echo "$response" | tail -n1)
        body=$(echo "$response" | head -n -1)
        if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
            log "Route auth-login-route added successfully"
        else
            log "ERROR: Failed to add route auth-login-route with HTTP status $http_code"
            log "Response: $body"
            errors=$((errors + 1))
        fi
    else
        log "Route auth-login-route already exists, skipping"
    fi

    log "Adding JWT plugin for auth-login-route"
    existing_plugins=$(curl -s "$KONG_ADMIN_URL/routes/auth-login-route/plugins")
    if [ -z "$(echo "$existing_plugins" | jq -r '.data[] | select(.name == "jwt") | .id')" ]; then
        response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/routes/auth-login-route/plugins" \
            -H "Content-Type: application/json" \
            -d '{
                "name": "jwt",
                "config": {
                    "key_claim_name": "iss",
                    "secret_is_base64": false
                }
            }')
        http_code=$(echo "$response" | tail -n1)
        body=$(echo "$response" | head -n -1)
        if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
            log "JWT plugin for auth-login-route added successfully"
        else
            log "ERROR: Failed to add JWT plugin for auth-login-route with HTTP status $http_code"
            log "Response: $body"
            errors=$((errors + 1))
        fi
    else
        log "JWT plugin for auth-login-route already exists, skipping"
    fi

    # Ensure JWT plugin for auth-route
    log "Ensuring JWT plugin for auth-route"
    existing_plugins=$(curl -s "$KONG_ADMIN_URL/routes/auth-route/plugins")
    if [ -z "$(echo "$existing_plugins" | jq -r '.data[] | select(.name == "jwt") | .id')" ]; then
        response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/routes/auth-route/plugins" \
            -H "Content-Type: application/json" \
            -d '{
                "name": "jwt",
                "config": {
                    "key_claim_name": "iss",
                    "secret_is_base64": false
                }
            }')
        http_code=$(echo "$response" | tail -n1)
        body=$(echo "$response" | head -n -1)
        if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
            log "JWT plugin for auth-route added successfully"
        else
            log "ERROR: Failed to add JWT plugin for auth-route with HTTP status $http_code"
            log "Response: $body"
            errors=$((errors + 1))
        fi
    else
        log "JWT plugin for auth-route already exists, skipping"
    fi

    # Add upstream target
    log "Adding target e2e-109-51:3000 for upstream express-api-servers"
    existing_targets=$(curl -s "$KONG_ADMIN_URL/upstreams/express-api-servers/targets")
    target_exists=$(echo "$existing_targets" | jq -r '.data[] | select(.target == "e2e-109-51:3000" and .weight == 100) | .id')
    if [ -z "$target_exists" ]; then
        response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/upstreams/express-api-servers/targets" \
            -H "Content-Type: application/json" \
            -d '{"target":"e2e-109-51:3000","weight":100}')
        http_code=$(echo "$response" | tail -n1)
        body=$(echo "$response" | head -n -1)
        if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
            log "Target e2e-109-51:3000 added successfully"
        else
            log "ERROR: Failed to add target e2e-109-51:3000 with HTTP status $http_code"
            log "Response: $body"
            errors=$((errors + 1))
        fi
    else
        log "Target e2e-109-51:3000 already exists, skipping"
    fi

    # Patch rate-limiting
    log "Patching global rate-limiting plugin"
    response=$(curl -s -w "\n%{http_code}" -X PATCH "$KONG_ADMIN_URL/plugins/13e146bb-0dff-4bfa-a9ca-95b8189ffb03" \
        -H "Content-Type: application/json" \
        -d '{
            "config": {
                "minute": 1000,
                "hour": 10000
            }
        }')
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n -1)
    if [ "$http_code" -eq 200 ]; then
        log "Global rate-limiting plugin patched successfully"
    else
        log "ERROR: Failed to patch global rate-limiting plugin with HTTP status $http_code"
        log "Response: $body"
        errors=$((errors + 1))
    fi

    if [ "$errors" -eq 0 ]; then
        log "Configuration restored successfully"
    else
        log "Configuration restored with $errors errors"
        exit 1
    fi
}

# Test endpoints
test_endpoints() {
    local jwt_token="$1"
    if [ -z "$jwt_token" ]; then
        log "ERROR: JWT token required for testing. Use -t <jwt_token>"
        exit 1
    fi

    log "Testing endpoints with JWT token (first 10 chars: ${jwt_token:0:10}...)"

    # Test 1: POST /api/auth/refresh-token
    log "Testing POST /api/auth/refresh-token"
    response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_PUBLIC_URL/api/auth/refresh-token" \
        -H "Authorization: Bearer $jwt_token" \
        -H "Content-Type: application/json" \
        -d '{}')
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n -1)
    if [ "$http_code" -eq 200 ]; then
        log "SUCCESS: /api/auth/refresh-token returned 200"
        log "Response: $body"
    else
        log "ERROR: /api/auth/refresh-token failed with status $http_code"
        log "Response: $body"
        exit 1
    fi

    # Test 2: GET /api/chat/folders?userId=2133
    log "Testing GET /api/chat/folders?userId=$USER_ID"
    response=$(curl -s -w "\n%{http_code}" "$KONG_PUBLIC_URL/api/chat/folders?userId=$USER_ID" \
        -H "Authorization: Bearer $jwt_token")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n -1)
    if [ "$http_code" -eq 200 ]; then
        log "SUCCESS: /api/chat/folders returned 200"
        log "Response: $body"
    else
        log "ERROR: /api/chat/folders failed with status $http_code"
        log "Response: $body"
        exit 1
    fi

    # Test 3: GET /api/service-categories
    log "Testing GET /api/service-categories?locale=en"
    response=$(curl -s -w "\n%{http_code}" "$KONG_PUBLIC_URL/api/service-categories?locale=en" \
        -H "Authorization: Bearer $jwt_token")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n -1)
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
TEST_TOKEN=""
while getopts "t:h" opt; do
    case $opt in
        t)
            TEST_TOKEN="$OPTARG"
            ;;
        h)
            usage
            ;;
        \?)
            log "ERROR: Invalid option: -$OPTARG"
            usage
            ;;
    esac
done

# Execute operations
if [ -z "$TEST_TOKEN" ]; then
    restore_config
else
    test_endpoints "$TEST_TOKEN"
fi

log "Operation completed successfully"
exit 0
