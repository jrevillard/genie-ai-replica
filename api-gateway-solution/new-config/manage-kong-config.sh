#!/bin/bash

# manage-kong-config.sh
# Shell script to manage Kong configuration via Admin API on localhost:8001
# Usage: ./manage-kong-config.sh [-b] [-a] [-f] [-d] [-h]
# Switches:
#   -b: Backup current Kong configuration to JSON
#   -a: Apply kong_config.json
#   -f: Fix auth routes to bypass JWT and proxy to backend
#   -d: Enable debug mode (verbose output)
#   -h: Display help

# Constants
KONG_ADMIN_URL="http://localhost:8001"
KONG_PUBLIC_URL="http://e2e-82-109.ssdcloudindia.net:8000"
CONFIG_FILE="kong_config.json"
BACKUP_DIR="kong_backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/kong_backup_${TIMESTAMP}.json"
LOG_FILE="kong_config.log"

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

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Usage function
usage() {
    echo "Usage: $0 [-b] [-a] [-f] [-d] [-h]"
    echo "  -b              Backup current Kong configuration to JSON"
    echo "  -a              Apply $CONFIG_FILE"
    echo "  -f              Fix auth routes to bypass JWT and proxy to backend"
    echo "  -d              Enable debug mode (verbose output)"
    echo "  -h              Display this help message"
    exit 1
}

# Backup current Kong configuration
backup_config() {
    log "Backing up current Kong configuration to $BACKUP_FILE"

    # First, check if Kong Admin API is reachable
    if ! curl -s -o /dev/null "$KONG_ADMIN_URL"; then
        log "ERROR: Cannot connect to Kong Admin API at $KONG_ADMIN_URL. Please ensure Kong is running and accessible."
        exit 1
    fi

    backup_json="{}"

    # Helper function to fetch data and handle errors
    fetch_endpoint_data() {
        local endpoint_name="$1"
        local url="$2"
        local response
        local http_code
        local body

        log "Fetching $endpoint_name..." >&2
        response=$(curl -s -w "\n%{http_code}" "$url")
        http_code=$(echo "$response" | tail -n1)
        body=$(echo "$response" | head -n -1)

        if [ "$http_code" -ne 200 ]; then
            log "ERROR: Failed to fetch $endpoint_name. Kong API returned HTTP status $http_code."
            return 1
        fi

        if ! echo "$body" | jq -e . > /dev/null 2>&1; then
            log "ERROR: Response for $endpoint_name is not valid JSON. Body: $body"
            return 1
        fi

        echo "$body" | jq '.data'
    }

    services_data=$(fetch_endpoint_data "services" "$KONG_ADMIN_URL/services")
    if [ $? -ne 0 ]; then exit 1; fi

    routes_data=$(fetch_endpoint_data "routes" "$KONG_ADMIN_URL/routes")
    if [ $? -ne 0 ]; then exit 1; fi

    plugins_data=$(fetch_endpoint_data "plugins" "$KONG_ADMIN_URL/plugins")
    if [ $? -ne 0 ]; then exit 1; fi

    upstreams_data=$(fetch_endpoint_data "upstreams" "$KONG_ADMIN_URL/upstreams")
    if [ $? -ne 0 ]; then exit 1; fi

    # Fetch targets for each upstream
    targets_data="[]"
    upstream_names=$(echo "$upstreams_data" | jq -r '.[].name // empty')
    for upstream_name in $upstream_names; do
        # === FIX START: Skip upstreams with empty names to prevent malformed URLs ===
        if [ -z "$upstream_name" ]; then
            continue
        fi
        # === FIX END ===
        log "Fetching targets for upstream: $upstream_name"
        targets_for_upstream=$(fetch_endpoint_data "targets for $upstream_name" "$KONG_ADMIN_URL/upstreams/$upstream_name/targets")
        if [ $? -eq 0 ]; then
            targets_data=$(echo "$targets_data" | jq --argjson new_targets "$targets_for_upstream" '. += $new_targets')
        else
            log "WARNING: Could not fetch targets for upstream '$upstream_name'. It may not have any."
        fi
    done

    # Assemble the final JSON
    backup_json=$(jq -n \
        --argjson services "$services_data" \
        --argjson routes "$routes_data" \
        --argjson plugins "$plugins_data" \
        --argjson upstreams "$upstreams_data" \
        --argjson targets "$targets_data" \
        '{services: $services, routes: $routes, plugins: $plugins, upstreams: $upstreams, targets: $targets}')

    if [ -z "$backup_json" ] || [ "$backup_json" = "{}" ]; then
         log "ERROR: Failed to assemble backup JSON. The resulting data is empty."
         exit 1
    fi

    echo "$backup_json" | jq . > "$BACKUP_FILE"
    log "Backup successful: $BACKUP_FILE"
}

# Apply configuration
apply_config() {
    local config_file="$1"
    if [ ! -f "$config_file" ]; then
        log "ERROR: $config_file not found"
        exit 1
    fi

    log "Applying configuration from $config_file"

    config_json=$(cat "$config_file")

    errors=0

    # Update or create services
    while IFS= read -r service; do
        service_name=$(echo "$service" | jq -r '.name')
        log "Processing service $service_name"
        response=$(curl -s -w "\n%{http_code}" -X PUT "$KONG_ADMIN_URL/services/$service_name" \
            -H "Content-Type: application/json" \
            -d "$(echo "$service" | jq 'del(.id, .routes, .plugins, .created_at, .updated_at)')")
        http_code=$(echo "$response" | tail -n1)
        body=$(echo "$response" | head -n -1)
        if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
            log "Service $service_name processed successfully"
        else
            log "ERROR: Failed to process service $service_name with HTTP status $http_code"
            log "Response: $body"
            errors=$((errors + 1))
        fi
    done < <(echo "$config_json" | jq -c '.services[]')

    if [ "$errors" -gt 0 ]; then
        log "Errors occurred during service processing. Aborting."
        exit 1
    fi

    # Update or create routes
    while IFS= read -r route; do
        route_name=$(echo "$route" | jq -r '.name')
        log "Processing route $route_name"
        route_payload=$(echo "$route" | jq 'del(.id, .plugins, .created_at, .updated_at)')
        existing_route=$(curl -s "$KONG_ADMIN_URL/routes/$route_name")
        if [ "$(echo "$existing_route" | jq -r '.id // empty')" ]; then
            response=$(curl -s -w "\n%{http_code}" -X PUT "$KONG_ADMIN_URL/routes/$route_name" \
                -H "Content-Type: application/json" \
                -d "$route_payload")
        else
            response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/routes" \
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
            log "No plugins found for $route_name"
        else
            while IFS= read -r plugin; do
                plugin_name=$(echo "$plugin" | jq -r '.name')
                log "Processing plugin $plugin_name for $route_name"
                existing_plugins=$(curl -s "$KONG_ADMIN_URL/routes/$route_name/plugins")
                plugin_exists=$(echo "$existing_plugins" | jq -r --arg name "$plugin_name" '.data[] | select(.name == $name) | .id')
                plugin_payload=$(echo "$plugin" | jq 'del(.id, .created_at, .updated_at)')
                if [ -n "$plugin_exists" ]; then
                    response=$(curl -s -w "\n%{http_code}" -X PATCH "$KONG_ADMIN_URL/plugins/$plugin_exists" \
                        -H "Content-Type: application/json" \
                        -d "$plugin_payload")
                else
                    response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/routes/$route_name/plugins" \
                        -H "Content-Type: application/json" \
                        -d "$plugin_payload")
                fi
                http_code=$(echo "$response" | tail -n1)
                body=$(echo "$response" | head -n -1)
                if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
                    log "Plugin $plugin_name for $route_name completed successfully"
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
        service_name_from_plugin=$(echo "$plugin" | jq -r '.service.name')
        log "Processing service plugin $plugin_name for service $service_name_from_plugin"
        existing_plugins=$(curl -s "$KONG_ADMIN_URL/services/$service_name_from_plugin/plugins")
        plugin_exists=$(echo "$existing_plugins" | jq -r --arg name "$plugin_name" '.data[] | select(.name == $name) | .id')
        plugin_payload=$(echo "$plugin" | jq 'del(.id, .created_at, .updated_at)')
        if [ -n "$plugin_exists" ]; then
            response=$(curl -s -w "\n%{http_code}" -X PATCH "$KONG_ADMIN_URL/plugins/$plugin_exists" \
                -H "Content-Type: application/json" \
                -d "$plugin_payload")
        else
            response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/services/$service_name_from_plugin/plugins" \
                -H "Content-Type: application/json" \
                -d "$plugin_payload")
        fi
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
        plugin_payload=$(echo "$plugin" | jq 'del(.id, .created_at, .updated_at)')
        if [ -n "$plugin_exists" ]; then
            response=$(curl -s -w "\n%{http_code}" -X PATCH "$KONG_ADMIN_URL/plugins/$plugin_exists" \
                -H "Content-Type: application/json" \
                -d "$plugin_payload")
        else
            response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/plugins" \
                -H "Content-Type: application/json" \
                -d "$plugin_payload")
        fi
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

        # Update or create targets
        targets_count=$(echo "$upstream" | jq '.targets | length')
        if [ "$targets_count" -eq 0 ]; then
            log "No targets found for upstream $upstream_name"
        else
            existing_targets=$(curl -s "$KONG_ADMIN_URL/upstreams/$upstream_name/targets")
            while IFS= read -r target; do
                target_name=$(echo "$target" | jq -r '.target')
                target_weight=$(echo "$target" | jq -r '.weight')
                log "Processing target $target_name for upstream $upstream_name"
                target_exists=$(echo "$existing_targets" | jq -r --arg t "$target_name" --argjson w "$target_weight" '.data[] | select(.target == $t and .weight == $w) | .id')
                if [ -n "$target_exists" ]; then
                    log "Target $target_name with weight $target_weight already exists, skipping"
                    continue
                fi
                response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/upstreams/$upstream_name/targets" \
                    -H "Content-Type: application/json" \
                    -d "{\"target\":\"$target_name\",\"weight\":$target_weight}")
                http_code=$(echo "$response" | tail -n1)
                body=$(echo "$response" | head -n -1)
                if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
                    log "Target $target_name for upstream $upstream_name processed successfully"
                else
                    log "ERROR: Failed to process target $target_name with HTTP status $http_code"
                    log "Response: $body"
                    errors=$((errors + 1))
                fi
            done < <(echo "$upstream" | jq -c '.targets[]')
        fi
    done < <(echo "$config_json" | jq -c '.upstreams[]')

    if [ "$errors" -eq 0 ]; then
        log "Configuration applied successfully"
    else
        log "Configuration applied with $errors errors"
        exit 1
    fi
}

# Fix auth routes to bypass JWT
fix_auth() {
    log "Fixing auth routes to bypass JWT and proxy to backend"

    errors=0

    # Remove JWT plugin from auth-login-route
    log "Removing JWT plugin from auth-login-route"
    existing_plugins=$(curl -s "$KONG_ADMIN_URL/routes/auth-login-route/plugins")
    jwt_plugin_id=$(echo "$existing_plugins" | jq -r '.data[] | select(.name == "jwt") | .id')
    if [ -n "$jwt_plugin_id" ]; then
        response=$(curl -s -w "\n%{http_code}" -X DELETE "$KONG_ADMIN_URL/plugins/$jwt_plugin_id")
        http_code=$(echo "$response" | tail -n1)
        if [ "$http_code" -eq 204 ]; then
            log "JWT plugin removed from auth-login-route successfully"
        else
            log "ERROR: Failed to remove JWT plugin from auth-login-route with HTTP status $http_code"
            errors=$((errors + 1))
        fi
    else
        log "No JWT plugin found for auth-login-route, skipping"
    fi

    # Remove JWT plugin from auth-refresh-route
    log "Removing JWT plugin from auth-refresh-route"
    existing_plugins=$(curl -s "$KONG_ADMIN_URL/routes/auth-refresh-route/plugins")
    jwt_plugin_id=$(echo "$existing_plugins" | jq -r '.data[] | select(.name == "jwt") | .id')
    if [ -n "$jwt_plugin_id" ]; then
        response=$(curl -s -w "\n%{http_code}" -X DELETE "$KONG_ADMIN_URL/plugins/$jwt_plugin_id")
        http_code=$(echo "$response" | tail -n1)
        if [ "$http_code" -eq 204 ]; then
            log "JWT plugin removed from auth-refresh-route successfully"
        else
            log "ERROR: Failed to remove JWT plugin from auth-refresh-route with HTTP status $http_code"
            errors=$((errors + 1))
        fi
    else
        log "No JWT plugin found for auth-refresh-route, skipping"
    fi

    # Remove JWT plugin from auth-route
    log "Removing JWT plugin from auth-route"
    existing_plugins=$(curl -s "$KONG_ADMIN_URL/routes/auth-route/plugins")
    jwt_plugin_id=$(echo "$existing_plugins" | jq -r '.data[] | select(.name == "jwt") | .id')
    if [ -n "$jwt_plugin_id" ]; then
        response=$(curl -s -w "\n%{http_code}" -X DELETE "$KONG_ADMIN_URL/plugins/$jwt_plugin_id")
        http_code=$(echo "$response" | tail -n1)
        if [ "$http_code" -eq 204 ]; then
            log "JWT plugin removed from auth-route successfully"
        else
            log "ERROR: Failed to remove JWT plugin from auth-route with HTTP status $http_code"
            errors=$((errors + 1))
        fi
    else
        log "No JWT plugin found for auth-route, skipping"
    fi

    # Ensure auth routes exist
    log "Ensuring auth-login-route exists"
    response=$(curl -s -w "\n%{http_code}" -X PUT "$KONG_ADMIN_URL/routes/auth-login-route" \
        -H "Content-Type: application/json" \
        -d '{
            "name": "auth-login-route",
            "paths": ["/api/auth/login"],
            "methods": ["POST"],
            "strip_path": false,
            "preserve_host": true,
            "protocols": ["http", "https"],
            "service": {"name": "express-api"}
        }')
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n -1)
    if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
        log "Route auth-login-route ensured successfully"
    else
        log "ERROR: Failed to ensure route auth-login-route with HTTP status $http_code"
        log "Response: $body"
        errors=$((errors + 1))
    fi

    log "Ensuring auth-refresh-route exists"
    response=$(curl -s -w "\n%{http_code}" -X PUT "$KONG_ADMIN_URL/routes/auth-refresh-route" \
        -H "Content-Type: application/json" \
        -d '{
            "name": "auth-refresh-route",
            "paths": ["/api/auth/refresh-token"],
            "methods": ["POST"],
            "strip_path": false,
            "preserve_host": true,
            "protocols": ["http", "https"],
            "service": {"name": "express-api"}
        }')
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n -1)
    if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
        log "Route auth-refresh-route ensured successfully"
    else
        log "ERROR: Failed to ensure route auth-refresh-route with HTTP status $http_code"
        log "Response: $body"
        errors=$((errors + 1))
    fi

    log "Ensuring auth-route exists"
    response=$(curl -s -w "\n%{http_code}" -X PUT "$KONG_ADMIN_URL/routes/auth-route" \
        -H "Content-Type: application/json" \
        -d '{
            "name": "auth-route",
            "paths": ["/api/auth"],
            "strip_path": false,
            "preserve_host": true,
            "protocols": ["http", "https"],
            "service": {"name": "express-api"}
        }')
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | head -n -1)
    if [ "$http_code" -eq 200 ] || [ "$http_code" -eq 201 ]; then
        log "Route auth-route ensured successfully"
    else
        log "ERROR: Failed to ensure route auth-route with HTTP status $http_code"
        log "Response: $body"
        errors=$((errors + 1))
    fi

    if [ "$errors" -eq 0 ]; then
        log "Auth routes fixed successfully"
    else
        log "Auth routes fixed with $errors errors"
        exit 1
    fi
}

# Parse command-line options
BACKUP=false
APPLY=false
FIX_AUTH=false
DEBUG=false
while getopts "bafdh" opt; do
    case $opt in
        b)
            BACKUP=true
            ;;
        a)
            APPLY=true
            ;;
        f)
            FIX_AUTH=true
            ;;
        d)
            DEBUG=true
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

# === FIX START: Enable debug mode if -d is specified ===
if [ "$DEBUG" = true ]; then
    log "Debug mode enabled. Verbose output will be printed."
    set -x
fi
# === FIX END ===

# Execute operations
if [ "$BACKUP" = false ] && [ "$APPLY" = false ] && [ "$FIX_AUTH" = false ]; then
    log "ERROR: No operation specified. Use -b, -a, or -f"
    usage
fi

if [ "$BACKUP" = true ]; then
    backup_config
fi

if [ "$APPLY" = true ]; then
    apply_config "$CONFIG_FILE"
fi

if [ "$FIX_AUTH" = true ]; then
    fix_auth
fi

# Deactivate debug mode at the end
if [ "$DEBUG" = true ]; then
    set +x
fi

log "Operation completed successfully"
exit 0
