#!/bin/sh
set -e

# Validate required variables have safe defaults
API_URL="${VUE_APP_API_URL:-http://localhost:3000/api}"

# Basic validation: allow relative paths (/api) or full URLs (http/https)
case "$API_URL" in
  http://*|https://*|/*)
    ;;
  *)
    echo "Error: VUE_APP_API_URL must start with http://, https://, or /"
    exit 1
    ;;
esac


# Keycloak URL (defaults to current origin + /auth for NGINX proxy setups)
if [ -n "$VUE_APP_KEYCLOAK_URL" ]; then
  KEYCLOAK_URL="${VUE_APP_KEYCLOAK_URL}"
else
  KEYCLOAK_URL=""
fi

# Keycloak client ID (defaults to genie-app)
KEYCLOAK_CLIENT_ID="${VUE_APP_KEYCLOAK_CLIENT_ID:-genie-app}"
cat > /app/dist/config.js << EOF
window.APP_CONFIG = {
  apiUrl: "${API_URL}",
  proxyHost: "${VUE_PROXY_HOST:-localhost}",
  cspConnectSrc: "${VUE_APP_CSP_CONNECT_SRC:-'self' http://localhost:3000 http://localhost:8090 http://127.0.0.1:8090 ws://localhost:3000 ws://localhost:8090}",
  keycloak: {
    url: "${KEYCLOAK_URL}",
    client_id: "${KEYCLOAK_CLIENT_ID}"
  }
};
EOF

# Map user-facing env var to nginx-safe name (avoid collision with nginx built-in vars)
# IMPORTANT: Any new template variable in nginx.conf must:
#   1. Be exported here with NGINX_ prefix (e.g., NGINX_PORT)
#   2. Be added to the envsubst filter list in CMD (Dockerfile)
export NGINX_PORT=${PORT:-8090}

exec "$@"
