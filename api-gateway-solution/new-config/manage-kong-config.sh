#!/bin/bash

# manage-kong-config.sh
# Shell script to manage Kong configuration via Admin API on localhost:8001
# Usage: ./manage-kong-config.sh [-b] [-a] [-f] [-h]
# Switches:
#   -b: Backup current Kong configuration to JSON
#   -a: Apply kong_config.json
#   -f: Fix auth routes to bypass JWT and proxy to backend
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
    echo "Usage: $0 [-b] [-a] [-f] [-h]"
    echo "  -b              Backup current Kong configuration to JSON"
    echo "  -a              Apply $CONFIG_FILE"
    echo "  -f              Fix auth routes to bypass JWT and proxy to backend"
    echo "  -h              Display this help message"
    exit 1
}

# Backup current Kong configuration
backup_config() {
    log "Backing up current Kong configuration to $BACKUP_FILE"

    backup_json="{}"

    # Fetch services
    services=$(curl -s -w "\n%{http_code}" "$KONG_ADMIN_URL/services")
    services_status=$(echo "$services" | tail -n1)
    services_body=$(echo "$services" | head -n -1)

    # Fetch routes
    routes=$(curl -s -w "\n%{http_code}" "$KONG_ADMIN_URL/routes")
    routes_status=$(echo "$routes" | tail -n1)
    routes_body=$(echo "$routes" | head -n -1)

    # Fetch plugins
    plugins=$(curl -s -w "\n%{http_code}" "$KONG_ADMIN_URL/plugins")
    plugins_status=$(echo "$plugins" | tail -n1)
    plugins_body=$(echo "$plugins" | head -n -1)

    # Fetch upstreams
    upstreams=$(curl -s -w "\n%{http_code}" "$KONG_ADMIN_URL/upstreams")
    upstreams_status=$(echo "$upstreams" | tail -n1)
    upstreams_body=$(echo "$upstreams" | head -n -1)

    # Fetch targets for each upstream
    upstream_names=$(echo "$upstreams_body" | jq -r '.data[].name')
    targets_json="[]"
    for upstream_name in $upstream_names; do
        targets=$(curl -s "$KONG_ADMIN_URL/upstreams/$upstream_name/targets")
        targets_json=$(echo "$targets_json" | jq --argjson targets "$targets" '. += $targets.data')
    done

    if [ "$services_status" -eq 200 ] && [ "$routes_status" -eq 200 ] && [ "$plugins_status" -eq 200 ] && [ "$upstreams_status" -eq 200 ]; then
        backup_json=$(echo "$backup_json" | jq --argjson services "$services_body" '.services = $services.data')
        backup_json=$(echo "$backup_json" | jq --argjson routes "$routes_body" '.routes = $routes.data')
        backup_json=$(echo "$backup_json" | jq --argjson plugins "$plugins_body" '.plugins = $plugins.data')
        backup_json=$(echo "$backup_json" | jq --argjson upstreams "$upstreams_body" '.upstreams = $upstreams.data')
        backup_json=$(echo "$backup_json" | jq --argjson targets "$targets_json" '.targets = $targets')

        echo "$backup_json" | jq . > "$BACKUP_FILE"
        log "Backup successful: $BACKUP_FILE"
    else
        log "ERROR: Backend failed. Services: $services_status, Routes: $routes_status, Plugins: $plugins_status, Upstreams: $upstreams_status"
        exit 1
    fi
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
        log "Processing service plugin $plugin_name"
        existing_plugins=$(curl -s "$KONG_ADMIN_URL/services/$service_name/plugins")
        plugin_exists=$(echo "$existing_plugins" | jq -r --arg name "$plugin_name" '.data[] | select(.name == $name) | .id')
        plugin_payload=$(echo "$plugin" | jq --arg sid "$service_id" 'del(.id, .created_at, .updated_at) | .service = {id: $sid}')
        if [ -n "$plugin_exists" ]; then
            response=$(curl -s -w "\n%{http_code}" -X PATCH "$KONG_ADMIN_URL/plugins/$plugin_exists" \
                -H "Content-Type: application/json" \
                -d "$plugin_payload")
        else
            response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/services/$service_name/plugins" \
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
            existing_targets=$(curl -s "$KONG_ADMIN_URL/upstreams/$upstream_name/targets")
            target_exists=$(echo "$existing_targets" | jq -r '.data[] | select(.target == "e2e-109-51:3000" and .weight == 100) | .id')
            if [ -z "$target_exists" ]; then
                response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_ADMIN_URL/upstreams/$upstream_name/targets" \
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
while getopts "bafh" opt; do
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

log "Operation completed successfully"
exit 0
