#!/bin/sh
set -e

# Runtime configuration entrypoint — ported from upstream GenieAI v2.0.1
# (components/gov-chat-frontend/docker-entrypoint.sh). Writes /app/dist/config.js
# (window.APP_CONFIG) at container start so auth endpoints never bake into the
# bundle. (A7: registration/password-reset URL entries removed — DEC-3 keeps
# those flows on Keycloak's own pages, so nothing consumed them.)

# Validate required variables have safe defaults
API_URL="${VUE_APP_API_URL:-http://localhost:3000/api}"

# Basic validation: allow relative paths (/api) or full URLs (http/https);
# reject protocol-relative URLs (//host/api) — browsers would turn them into
# https://host/api, silently bypassing the intended origin
case "$API_URL" in
  //*)
    echo "Error: VUE_APP_API_URL must not be protocol-relative (//...) - use http://, https://, or a /-relative path"
    exit 1
    ;;
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

# Keycloak client ID (defaults to genie-app upstream; compose feeds our realm's SPA client)
KEYCLOAK_CLIENT_ID="${VUE_APP_KEYCLOAK_CLIENT_ID:-genie-app}"

# Keycloak realm (upstream is always 'genie'; OUR product realm is 'agrivisory' —
# oidcConfig.js falls back to 'genie', so the realm MUST be fed at runtime here)
KEYCLOAK_REALM="${VUE_APP_KEYCLOAK_REALM:-agrivisory}"

# Values are interpolated into double-quoted JS strings below — a quote or
# backslash would break out of the string (config injection), so reject them.
reject_unsafe() { # reject_unsafe <name> <value>
  case "$2" in
    *[\"\\]*)
      echo "Error: $1 must not contain double quotes or backslashes"
      exit 1
      ;;
  esac
}
reject_unsafe VUE_APP_API_URL "$API_URL"
reject_unsafe VUE_APP_KEYCLOAK_URL "$KEYCLOAK_URL"
reject_unsafe VUE_APP_KEYCLOAK_REALM "$KEYCLOAK_REALM"
reject_unsafe VUE_APP_KEYCLOAK_CLIENT_ID "$KEYCLOAK_CLIENT_ID"

# Config target dir (/app/dist in the image; overridable so the contract test
# can execute this script directly without a container)
CONFIG_DIST_DIR="${CONFIG_DIST_DIR:-/app/dist}"

cat > "${CONFIG_DIST_DIR}/config.js" << EOF
window.APP_CONFIG = {
  apiUrl: "${API_URL}",
  proxyHost: "${VUE_PROXY_HOST:-localhost}",
  cspConnectSrc: "${VUE_APP_CSP_CONNECT_SRC:-'self' http://localhost:3000 http://localhost:8090 http://127.0.0.1:8090 ws://localhost:3000 ws://localhost:8090}",
  availableLocales: "${VUE_APP_AVAILABLE_LOCALES:-}",
  keycloak: {
    url: "${KEYCLOAK_URL}",
    realm: "${KEYCLOAK_REALM}",
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
