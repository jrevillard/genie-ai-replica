#!/bin/sh
set -e

# Validate required variables have safe defaults
API_URL="${VUE_APP_API_URL:-http://localhost:3000/api}"

# Basic validation: ensure URL starts with http:// or https://
case "$API_URL" in
  http://*|https://*)
    ;;
  *)
    echo "Error: VUE_APP_API_URL must start with http:// or https://"
    exit 1
    ;;
esac

cat > /app/dist/config.js << EOF
window.APP_CONFIG = {
  apiUrl: "${API_URL}",
  proxyHost: "${VUE_PROXY_HOST:-localhost}",
  cspConnectSrc: "${VUE_APP_CSP_CONNECT_SRC:-'self' http://localhost:3000 http://localhost:8090 http://127.0.0.1:8090 ws://localhost:3000 ws://localhost:8090}"
};
EOF

exec "$@"
