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

# Start nginx
echo "🚀 Starting nginx..."
exec nginx -g 'daemon off;'
