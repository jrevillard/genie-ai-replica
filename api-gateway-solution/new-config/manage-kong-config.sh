#!/bin/bash

# manage_kong_config.sh
# Shell script to manage Kong configuration via Admin API on localhost:8001
# Usage: ./manage_kong_config.sh [-b] [-a] [-t <jwt_token>] [-h]
# Switches:
#   -b: Backup current Kong configuration to JSON
#   -a: Apply new JSON configuration
#   -t <jwt_token>: Test endpoints with provided JWT token
#   -h: Display help

# Constants
KONG_ADMIN_URL="http://localhost:8001"
KONG_PUBLIC_URL="http://e2e-82-109.ssdcloudindia.net:8000"
CONFIG_FILE="kong_config.json"
BACKUP_DIR="kong_backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="${BACKUP_DIR}/kong_backup_${TIMESTAMP}.json"
USER_ID="2133"
LOGIN_NAME="fordendk"
LOGIN_PASSWORD="test" # Replace with actual password
LOG_FILE="kong_config.log"

# Log function
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Check dependencies
if ! command -v curl &> /dev/null; then
    log "ERROR: curl is required but not installed. Please install curl."
    exit 1
fi
if ! command -v jq &> /dev/null; then
    log "ERROR: jq is required but not installed. Please install jq."
    exit 1
fi

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Usage function
usage() {
    echo "Usage: $0 [-b] [-a] [-t <jwt_token>] [-h]"
    echo "  -b              Backup current Kong configuration to JSON"
    echo "  -a              Apply new JSON configuration"
    echo "  -t <jwt_token>  Test endpoints with provided JWT token"
    echo "  -h              Display this help message"
    exit 1
}

# Backup current Kong configuration
backup_config() {
    log "Backing up current Kong configuration to $BACKUP_FILE"

    # Initialize JSON object
    backup_json="{}"

    # Fetch services
    services=$(curl -s -w "\n%{http_code}" "$KONG_ADMIN_URL/services")
    services_status=$(echo "$services" | tail -n1)
    services_body=$(echo "$services" | sed '$d')

    # Fetch routes
    routes=$(curl -s -w "\n%{http_code}" "$KONG_ADMIN_URL/routes")
    routes_status=$(echo "$routes" | tail -n1)
    routes_body=$(echo "$routes" | sed '$d')

    # Fetch plugins
    plugins=$(curl -s -w "\n%{http_code}" "$KONG_ADMIN_URL/plugins")
    plugins_status=$(echo "$plugins" | tail -n1)
    plugins_body=$(echo "$plugins" | sed '$d')

    if [ "$services_status" -eq 200 ] && [ "$routes_status" -eq 200 ] && [ "$plugins_status" -eq 200 ]; then
        # Combine into JSON
        backup_json=$(echo "$backup_json" | jq --argjson services "$services_body" '.services = $services.data')
        backup_json=$(echo "$backup_json" | jq --argjson routes "$routes_body" '.routes = $routes.data')
        backup_json=$(echo "$backup_json" | jq --argjson plugins "$plugins_body" '.plugins = $plugins.data')

        # Save to file
        echo "$backup_json" | jq . > "$BACKUP_FILE"
        log "Backup successful: $BACKUP_FILE"
    else
        log "ERROR: Backup failed. Services status: $services_status, Routes status: $routes_status, Plugins status: $plugins_status"
        log "Services response: $services_body"
        log "Routes response: $routes_body"
        log "Plugins response: $plugins_body"
        exit 1
    fi
}

# Apply new Kong configuration
apply_config() {
    if [ ! -f "$CONFIG_FILE" ]; then
        log "ERROR: $CONFIG_FILE not found in current directory"
        exit 1
    fi

    log "Applying new Kong configuration from $CONFIG_FILE"
    response=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$KONG_ADMIN_URL/config" \
        -H "Content-Type: application/json" \
        -d @"$CONFIG_FILE")
    if [ "$response" -eq 201 ] || [ "$response" -eq 200 ]; then
        log "Configuration applied successfully"
    else
        log "ERROR: Failed to apply configuration with HTTP status $response"
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
    body=$(echo "$response" | sed '$d')
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
    body=$(echo "$response" | sed '$d')
    if [ "$http_code" -eq 200 ]; then
        log "SUCCESS: /api/chat/folders returned 200"
        log "Response: $body"
    else
        log "ERROR: /api/chat/folders failed with status $http_code"
        log "Response: $body"
        exit 1
    fi

    # Test 3: GET /api/chat/conversations
    log "Testing GET /api/chat/conversations?limit=100&offset=0&includeArchived=false&filterStarred=false&searchTerm=&userId=$USER_ID"
    response=$(curl -s -w "\n%{http_code}" "$KONG_PUBLIC_URL/api/chat/conversations?limit=100&offset=0&includeArchived=false&filterStarred=false&searchTerm=&userId=$USER_ID" \
        -H "Authorization: Bearer $jwt_token")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    if [ "$http_code" -eq 200 ]; then
        log "SUCCESS: /api/chat/conversations returned 200"
        log "Response: $body"
    else
        log "ERROR: /api/chat/conversations failed with status $http_code"
        log "Response: $body"
        exit 1
    fi

    # Test 4: POST /api/auth/login
    log "Testing POST /api/auth/login for user $LOGIN_NAME"
    response=$(curl -s -w "\n%{http_code}" -X POST "$KONG_PUBLIC_URL/api/auth/login" \
        -H "Content-Type: application/json" \
        -d "{\"loginName\":\"$LOGIN_NAME\",\"encPassword\":\"$LOGIN_PASSWORD\"}")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    if [ "$http_code" -eq 200 ]; then
        log "SUCCESS: /api/auth/login returned 200"
        log "Response: $body"
    else
        log "ERROR: /api/auth/login failed with status $http_code"
        log "Response: $body"
        exit 1
    fi

    # Test 5: GET /api/services/categories
    log "Testing GET /api/services/categories?locale=en"
    response=$(curl -s -w "\n%{http_code}" "$KONG_PUBLIC_URL/api/services/categories?locale=en" \
        -H "Authorization: Bearer $jwt_token")
    http_code=$(echo "$response" | tail -n1)
    body=$(echo "$response" | sed '$d')
    if [ "$http_code" -eq 200 ]; then
        log "SUCCESS: /api/services/categories returned 200"
        log "Response: $body"
    else
        log "ERROR: /api/services/categories failed with status $http_code"
        log "Response: $body"
        exit 1
    fi
}

# Parse command-line options
BACKUP=false
APPLY=false
TEST_TOKEN=""
while getopts "bat:h" opt; do
    case $opt in
        b)
            BACKUP=true
            ;;
        a)
            APPLY=true
            ;;
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

# Execute requested operations
if [ "$BACKUP" = false ] && [ "$APPLY" = false ] && [ -z "$TEST_TOKEN" ]; then
    log "ERROR: No operation specified. Use -b, -a, or -t <jwt_token>"
    usage
fi

if [ "$BACKUP" = true ]; then
    backup_config
fi

if [ "$APPLY" = true ]; then
    apply_config
fi

if [ -n "$TEST_TOKEN" ]; then
    test_endpoints "$TEST_TOKEN"
fi

log "Operation completed successfully"
exit 0
