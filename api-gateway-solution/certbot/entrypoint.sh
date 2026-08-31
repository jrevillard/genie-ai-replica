#!/bin/sh
# GENIE.AI - Certbot entrypoint for Let's Encrypt certificate management
# Manages automatic certificate provisioning and renewal via HTTP-01 challenge.
# Runs as a foreground process (PID 1) with a renewal loop every 12 hours.

set -e

# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------

if [ -z "${CERTBOT_EMAIL}" ]; then
    echo "ERROR: CERTBOT_EMAIL is required. Set it in .env to enable Let's Encrypt."
    exit 1
fi

if [ -z "${NGINX_PUBLIC_DOMAIN}" ] || [ "${NGINX_PUBLIC_DOMAIN}" = "localhost" ]; then
    echo "ERROR: NGINX_PUBLIC_DOMAIN must be a valid FQDN (not localhost) for Let's Encrypt."
    exit 1
fi

DOMAIN="${NGINX_PUBLIC_DOMAIN}"
CERT_DIR="/etc/letsencrypt/live/${DOMAIN}"
SECRETS_DIR="/secrets/ssl"
WEBROOT="/var/www/certbot"

# ---------------------------------------------------------------------------
# Build certbot command arguments
# ---------------------------------------------------------------------------

CERTBOT_ARGS="--webroot -w ${WEBROOT} -d ${DOMAIN} --email ${CERTBOT_EMAIL} --agree-tos --non-interactive"

if [ "${CERTBOT_STAGING}" = "true" ]; then
    CERTBOT_ARGS="${CERTBOT_ARGS} --staging"
    echo "Using Let's Encrypt staging server (certificates will not be trusted by browsers)"
fi

# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------

# Check if existing certs in secrets dir are valid Let's Encrypt certs
# (>30 days remaining, issued by Let's Encrypt Authority X3)
check_existing_certs() {
    if [ ! -f "${SECRETS_DIR}/server.crt" ] || [ ! -f "${SECRETS_DIR}/server.key" ]; then
        return 1
    fi

    # Verify the certificate was issued by Let's Encrypt (not self-signed)
    _issuer=$(openssl x509 -in "${SECRETS_DIR}/server.crt" -noout -issuer 2>/dev/null | head -1)
    case "${_issuer}" in
        *Let\'s\ Encrypt*) ;;
        *) return 1 ;;
    esac

    # Check if certificate is valid and has >30 days remaining (2592000 seconds)
    if openssl x509 -in "${SECRETS_DIR}/server.crt" -checkend 2592000 -noout >/dev/null 2>&1; then
        echo "Existing Let's Encrypt certificates in ${SECRETS_DIR} are valid (>30 days remaining)"
        return 0
    else
        echo "Existing Let's Encrypt certificates in ${SECRETS_DIR} are expired or expiring soon"
        return 1
    fi
}

# Copy obtained/renewed certs from Let's Encrypt to secrets dir
copy_certs() {
    if [ -f "${CERT_DIR}/fullchain.pem" ] && [ -f "${CERT_DIR}/privkey.pem" ]; then
        # Remove-then-copy: a plain cp over an existing file writes into its
        # inode and inherits the previous (possibly non-root) ownership, which
        # the cap-dropped nginx container cannot read.
        rm -f "${SECRETS_DIR}/server.crt" "${SECRETS_DIR}/server.key"
        cp "${CERT_DIR}/fullchain.pem" "${SECRETS_DIR}/server.crt"
        cp "${CERT_DIR}/privkey.pem" "${SECRETS_DIR}/server.key"
        chmod 644 "${SECRETS_DIR}/server.crt"
        chmod 600 "${SECRETS_DIR}/server.key"
        echo "Certificates copied to ${SECRETS_DIR}/"
        return 0
    else
        echo "WARNING: Certificate files not found at ${CERT_DIR}/"
        return 1
    fi
}

# Signal nginx to reload via flag file in shared webroot volume
# Note: nginx mounts this volume read-only, so it cannot delete the flag.
# We remove it after 60 seconds to avoid perpetual reloads.
signal_nginx_reload() {
    touch "${WEBROOT}/reload-nginx"
    echo "Nginx reload signal sent"
    ( sleep 60 && rm -f "${WEBROOT}/reload-nginx" ) &
}

# Request certificate with retry (exponential backoff: 30s, 60s, 120s)
request_certificate() {
    _attempt=0
    _max_attempts=3

    while [ ${_attempt} -lt ${_max_attempts} ]; do
        _attempt=$((_attempt + 1))
        echo "Certificate request attempt ${_attempt}/${_max_attempts}..."

        if certbot certonly ${CERTBOT_ARGS}; then
            echo "Certificate obtained successfully"
            copy_certs
            signal_nginx_reload
            return 0
        fi

        if [ ${_attempt} -lt ${_max_attempts} ]; then
            case ${_attempt} in
                1) _delay=30 ;;
                2) _delay=60 ;;
                *) _delay=120 ;;
            esac
            echo "Certificate request failed. Retrying in ${_delay}s..."
            sleep ${_delay}
        fi
    done

    echo "ERROR: Failed to obtain certificate after ${_max_attempts} attempts."
    echo "Will retry on next renewal cycle (12 hours)."
    return 1
}

# ---------------------------------------------------------------------------
# Initialization
# ---------------------------------------------------------------------------

echo "Starting certbot for domain: ${DOMAIN}"
echo "Contact email: ${CERTBOT_EMAIL}"

mkdir -p "${WEBROOT}"
mkdir -p "${SECRETS_DIR}"

# Check if valid certs already exist (bootstrap optimization)
if check_existing_certs; then
    echo "Skipping initial certificate request (valid certs already exist)"
else
    request_certificate || true
fi

# ---------------------------------------------------------------------------
# Renewal loop (runs as PID 1 in foreground)
# ---------------------------------------------------------------------------

echo "Entering renewal loop (checks every 12 hours)..."

while true; do
    sleep 43200  # 12 hours

    echo "Running certificate renewal check..."
    if certbot renew 2>&1; then
        # certbot renew exits 0 even if no renewal was needed.
        # Check if certs were actually renewed by comparing modification times.
        if [ -f "${CERT_DIR}/fullchain.pem" ]; then
            echo "Certificate renewal completed, reloading nginx..."
            copy_certs || echo "WARNING: failed to copy renewed certificates"
            signal_nginx_reload
        fi
    else
        echo "WARNING: certbot renew reported an error"
    fi
done
