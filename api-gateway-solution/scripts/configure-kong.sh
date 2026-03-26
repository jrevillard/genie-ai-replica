#!/bin/bash
# Configure Kong and Nginx configs with environment variables

set -e

echo "Configuring Kong gateway..."

# Variables with defaults
KONG_BACKEND_HOST=${KONG_BACKEND_HOST:-backend}
KONG_DOC_REPO_HOST=${KONG_DOC_REPO_HOST:-document-repository}
NGINX_FRONTEND_HOST=${NGINX_FRONTEND_HOST:-frontend}
NGINX_FRONTEND_PORT=${NGINX_FRONTEND_PORT:-8090}
NGINX_PUBLIC_DOMAIN=${NGINX_PUBLIC_DOMAIN:-localhost}
KONG_PROXY_HOST=${KONG_PROXY_HOST:-kong}

# Update Kong config JSON
echo "Updating kong_config.json..."
jq --arg backend "$KONG_BACKEND_HOST" \
   --arg docrepo "$KONG_DOC_REPO_HOST" \
   '
   (.services[] | select(.name == "express-api") | .host) = $backend |
   (.services[] | select(.name == "document-repository") | .host) = $docrepo |
   (.targets[0].target) = "\($backend):3000"
   ' \
   api-gateway-solution/new-config/kong_config.json > /tmp/kong_config.json.tmp

mv /tmp/kong_config.json.tmp api-gateway-solution/new-config/kong_config.json

# Update Nginx config
echo "Updating nginx configuration..."
cat > /tmp/nginx_env.subst <<EOF
KONG_PROXY_HOST=$KONG_PROXY_HOST
NGINX_PUBLIC_DOMAIN=$NGINX_PUBLIC_DOMAIN
NGINX_FRONTEND_HOST=$NGINX_FRONTEND_HOST
NGINX_FRONTEND_PORT=$NGINX_FRONTEND_PORT
EOF

# Create nginx config from template
envsubst "\$KONG_PROXY_HOST \$NGINX_PUBLIC_DOMAIN \$NGINX_FRONTEND_HOST \$NGINX_FRONTEND_PORT" \
  < api-gateway-solution/nginx/conf/default.conf.template \
  > api-gateway-solution/nginx/conf/default.conf || echo "No template found, skipping nginx config"

echo "Gateway configuration complete!"
echo "  Kong backend: $KONG_BACKEND_HOST"
echo "  Kong doc-repo: $KONG_DOC_REPO_HOST"
echo "  Nginx frontend: $NGINX_FRONTEND_HOST:$NGINX_FRONTEND_PORT"
echo "  Nginx public domain: $NGINX_PUBLIC_DOMAIN"
