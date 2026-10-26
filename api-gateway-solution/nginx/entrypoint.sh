#!/bin/sh
# Cloud-native nginx entrypoint
# Manages SSL certificates from volume mounts or generates self-signed certs for development

set -e

CERT_PATH="/etc/nginx/certs"
VOLUME_CERT_PATH="/etc/nginx/ssl"

# Function to use volume-mounted certificates
use_volume_certs() {
    echo "Using SSL certificates from volume mount..."

    # Validate certificate format
    if ! openssl x509 -in "${VOLUME_CERT_PATH}/server.crt" -noout -text >/dev/null 2>&1; then
        echo "ERROR: Invalid certificate format in ${VOLUME_CERT_PATH}/server.crt"
        exit 1
    fi

    # Validate key format (supports RSA, ECDSA, and Ed25519 via pkey)
    if ! openssl pkey -in "${VOLUME_CERT_PATH}/server.key" -check -noout >/dev/null 2>&1; then
        echo "ERROR: Invalid private key format in ${VOLUME_CERT_PATH}/server.key"
        exit 1
    fi

    cp "${VOLUME_CERT_PATH}/server.crt" "${CERT_PATH}/server.crt"
    cp "${VOLUME_CERT_PATH}/server.key" "${CERT_PATH}/server.key"
    chmod 644 "${CERT_PATH}/server.crt"
    chmod 600 "${CERT_PATH}/server.key"
    echo "SSL certificates loaded from volume mount"
}

# Function to generate self-signed certificate for development
generate_self_signed_cert() {
    echo "No SSL certificates found - generating self-signed certificate for development..."
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout "${CERT_PATH}/server.key" \
        -out "${CERT_PATH}/server.crt" \
        -subj "/C=CH/ST=Geneva/L=Geneva/O=ITU/CN=localhost"
    echo "Self-signed certificate generated"
}

# Main logic
mkdir -p "${CERT_PATH}"

# Ensure certificate directory is writable
if ! touch "${CERT_PATH}/.test" 2>/dev/null; then
    echo "ERROR: Cannot write to ${CERT_PATH}"
    exit 1
fi
rm -f "${CERT_PATH}/.test"

if [ -f "${VOLUME_CERT_PATH}/server.crt" ] && [ -f "${VOLUME_CERT_PATH}/server.key" ]; then
    # Production: Use volume-mounted certificates
    use_volume_certs
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
export NGINX_HTTPS_PORT="${NGINX_HTTPS_PORT:-443}"

# Render nginx config from template
echo "Rendering nginx config from template..."
envsubst '${NGINX_PUBLIC_DOMAIN} ${CSP_CONNECT_SRC} ${KONG_PROXY_HOST} ${NGINX_FRONTEND_HOST} ${NGINX_FRONTEND_PORT} ${NGINX_PERMISSIONS_POLICY} ${NGINX_HTTPS_PORT}' \
    < /etc/nginx/conf.d/default.conf.template \
    > /etc/nginx/conf.d/default.conf

# Validate rendered config
echo "Validating nginx configuration..."
nginx -t

# Start nginx
echo "Starting nginx..."
nginx -g 'daemon off;' &
NGINX_PID=$!

# Forward signals to nginx for graceful shutdown
trap 'echo "Received shutdown signal, stopping nginx..."; kill $NGINX_PID; wait $NGINX_PID; exit 0' TERM INT QUIT

# Flag-check loop in foreground (PID 1)
# Checks every 60s for a reload signal from certbot
while true; do
    sleep 60

    # If nginx died, exit so Docker can restart the container
    if ! kill -0 $NGINX_PID 2>/dev/null; then
        echo "nginx process died, exiting"
        exit 1
    fi

    # Check for reload flag from certbot (shared webroot volume)
    # Note: cannot rm the flag file because the volume is mounted read-only.
    # Flag is consumed by writing an empty file (certbot clears it after a delay).
    if [ -f /var/www/certbot/reload-nginx ]; then
        echo "Reload signal received from certbot, updating certificates..."
        # Re-copy certificates from volume mount (nginx does not reload cert files on HUP)
        if [ -f "${VOLUME_CERT_PATH}/server.crt" ] && [ -f "${VOLUME_CERT_PATH}/server.key" ]; then
            cp "${VOLUME_CERT_PATH}/server.crt" "${CERT_PATH}/server.crt"
            cp "${VOLUME_CERT_PATH}/server.key" "${CERT_PATH}/server.key"
            chmod 644 "${CERT_PATH}/server.crt"
            chmod 600 "${CERT_PATH}/server.key"
            echo "Certificates updated from volume mount"
        fi
        nginx -s reload || echo "WARNING: nginx reload failed"
    fi
done
