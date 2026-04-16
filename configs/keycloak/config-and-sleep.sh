#!/bin/sh
set -e

# Validate required environment variables
for var in KEYCLOAK_ADMIN_PASSWORD KC_PROXY_CLIENT_SECRET KC_DATAPREP_CLIENT_SECRET GENIE_ADMIN_PASSWORD; do
  eval "val=\$var"
  if [ -z "$val" ]; then
    echo "ERROR: Required environment variable $var is not set. Aborting." >&2
    exit 1
  fi
done

# Run Keycloak config and create marker on success
if java -jar /app/keycloak-config-cli.jar; then
  touch /tmp/config-done
  echo "Keycloak realm configured successfully. Keeping container alive for healthcheck..."
else
  echo "ERROR: Keycloak realm configuration failed." >&2
  exit 1
fi

# Keep container alive for healthcheck
exec sleep infinity
