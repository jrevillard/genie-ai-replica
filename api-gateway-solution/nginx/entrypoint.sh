#!/bin/bash
# Cloud-native nginx entrypoint
# Manages SSL certificates from Docker secrets or generates self-signed certs for development

set -e

CERT_PATH="/etc/nginx/certs"
SECRET_CERT_PATH="/run/secrets/server_cert"
SECRET_KEY_PATH="/run/secrets/server_key"

# Function to generate self-signed certificate for development
generate_self_signed_cert() {
    echo "🔐 No SSL secrets found - generating self-signed certificate for development..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "${CERT_PATH}/server.key" \
        -out "${CERT_PATH}/server.crt" \
        -subj "/C=CH/ST=Geneva/L=Geneva/O=ITU/CN=localhost"
    echo "✅ Self-signed certificate generated"
}

# Function to use secrets from Docker
use_docker_secrets() {
    echo "🔑 Using SSL certificates from Docker secrets..."

    # Validate certificate format
    if ! openssl x509 -in "${SECRET_CERT_PATH}" -noout -text >/dev/null 2>&1; then
        echo "❌ ERROR: Invalid certificate format in Docker secret"
        exit 1
    fi

    # Validate key format
    if ! openssl rsa -in "${SECRET_KEY_PATH}" -check -noout >/dev/null 2>&1; then
        echo "❌ ERROR: Invalid private key format in Docker secret"
        exit 1
    fi

    cp "${SECRET_CERT_PATH}" "${CERT_PATH}/server.crt"
    cp "${SECRET_KEY_PATH}" "${CERT_PATH}/server.key"
    chmod 644 "${CERT_PATH}/server.crt"
    chmod 600 "${CERT_PATH}/server.key"
    echo "✅ SSL certificates loaded from secrets"
}

# Main logic
mkdir -p "${CERT_PATH}"

# Ensure certificate directory is writable
if ! touch "${CERT_PATH}/.test" 2>/dev/null; then
    echo "❌ ERROR: Cannot write to ${CERT_PATH}"
    exit 1
fi
rm -f "${CERT_PATH}/.test"

if [ -f "${SECRET_CERT_PATH}" ] && [ -f "${SECRET_KEY_PATH}" ]; then
    # Production: Use Docker secrets
    use_docker_secrets
else
    # Development: Generate self-signed certificate
    generate_self_signed_cert
fi

# Pre-flight check: envsubst must be available
command -v envsubst >/dev/null 2>&1 || { echo "ERROR: envsubst is required but not installed"; exit 1; }

# Set defaults for template variables if not provided
# NOTE: 'self' below is the CSP keyword (literal), not shell quoting.
# It must appear as literal 'self' in the rendered nginx config for CSP to work.
export NGINX_PUBLIC_DOMAIN="${NGINX_PUBLIC_DOMAIN:-localhost}"
# CSP_CONNECT_SRC format: "'self' https://api.example.com wss://api.example.com"
export CSP_CONNECT_SRC="${CSP_CONNECT_SRC:-'self' http://localhost:3000 http://localhost:8090 http://127.0.0.1:8090 ws://localhost:3000 ws://localhost:8090}"
export KONG_PROXY_HOST="${KONG_PROXY_HOST:-kong}"
export NGINX_FRONTEND_HOST="${NGINX_FRONTEND_HOST:-frontend}"
export NGINX_FRONTEND_PORT="${NGINX_FRONTEND_PORT:-8090}"
export NGINX_PERMISSIONS_POLICY="${NGINX_PERMISSIONS_POLICY:-camera=(), microphone=(), geolocation=()}"

# Render nginx config from template
echo "Rendering nginx config from template..."
envsubst '${NGINX_PUBLIC_DOMAIN} ${CSP_CONNECT_SRC} ${KONG_PROXY_HOST} ${NGINX_FRONTEND_HOST} ${NGINX_FRONTEND_PORT} ${NGINX_PERMISSIONS_POLICY}' \
    < /etc/nginx/conf.d/default.conf.template \
    > /etc/nginx/conf.d/default.conf

# Validate rendered config
echo "Validating nginx configuration..."
nginx -t

# Start nginx
echo "Starting nginx..."
exec nginx -g 'daemon off;'
