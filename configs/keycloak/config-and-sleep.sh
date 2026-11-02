#!/bin/sh
# Ported from upstream GenieAI v2.0.1 configs/keycloak/config-and-sleep.sh.
# Local deltas: assert also rejects CHANGE_ME placeholders (no placeholder realm ever
# lands), asserts KC_GRAFANA_CLIENT_SECRET (confidential client must never get an
# empty secret), and eval uses \$$var — upstream's \$var resolves to the variable
# NAME, so their assert never fired (verified live: empty env passed straight to
# the retry loop).
set -e

# Validate required environment variables
for var in KEYCLOAK_PASSWORD KC_PROXY_CLIENT_SECRET KC_DATAPREP_CLIENT_SECRET KC_GRAFANA_CLIENT_SECRET GENIE_ADMIN_PASSWORD; do
  eval "val=\$$var"
  if [ -z "$val" ] || [ "$val" = "CHANGE_ME" ]; then
    echo "ERROR: Required environment variable $var is not set (or is CHANGE_ME). Aborting." >&2
    exit 1
  fi
done

MAX_RETRIES=10
RETRY_DELAY=10
attempt=0

while [ $attempt -lt $MAX_RETRIES ]; do
  attempt=$((attempt + 1))
  echo "Attempt $attempt/$MAX_RETRIES: Running Keycloak realm configuration..."
  if java -jar /app/keycloak-config-cli.jar; then
    touch /tmp/config-done
    echo "Keycloak realm configured successfully. Keeping container alive for healthcheck..."
    exec sleep infinity
  fi
  echo "Keycloak realm configuration failed (attempt $attempt/$MAX_RETRIES). Retrying in ${RETRY_DELAY}s..." >&2
  sleep $RETRY_DELAY
done

echo "ERROR: Keycloak realm configuration failed after $MAX_RETRIES attempts." >&2
exit 1
