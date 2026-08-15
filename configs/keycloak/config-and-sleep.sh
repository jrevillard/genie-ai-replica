#!/bin/sh
set -e

# Validate required environment variables
for var in KEYCLOAK_PASSWORD KC_PROXY_CLIENT_SECRET KC_DATAPREP_CLIENT_SECRET GENIE_ADMIN_PASSWORD; do
  eval "val=\$var"
  if [ -z "$val" ]; then
    echo "ERROR: Required environment variable $var is not set. Aborting." >&2
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
    # Story 6.1: KC 24+ declarative user profile DROPS undeclared attributes —
    # the okf_scopes user attribute (→ claim via the user-attribute mapper)
    # needs unmanagedAttributePolicy=ENABLED in the USER PROFILE resource
    # (the realm-level attribute is NOT honored by the profile validator in
    # KC 26; keycloak-config-cli cannot express it). Admin-only writes —
    # users cannot self-assign scopes. Best-effort: a failure warns, not aborts.
    KC_BASE="${KEYCLOAK_URL:-http://keycloak:8080}"
    KC_REALM_LC=$(printf '%s' "${KC_REALM:-genie}" | tr '[:upper:]' '[:lower:]')
    if KC_TOKEN=$(curl -s -f -X POST "${KC_BASE}/realms/master/protocol/openid-connect/token" \
      -d "client_id=admin-cli&username=${KEYCLOAK_USER:-admin}&password=${KEYCLOAK_PASSWORD}&grant_type=password" |
      sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p') && [ -n "$KC_TOKEN" ]; then
      KC_PROFILE_URL="${KC_BASE}/admin/realms/${KC_REALM_LC}/users/profile"
      if CURRENT=$(curl -s -f -H "Authorization: Bearer ${KC_TOKEN}" "${KC_PROFILE_URL}"); then
        case "$CURRENT" in
          *unmanagedAttributePolicy*) UPDATED=$(printf '%s' "$CURRENT" | sed 's/"unmanagedAttributePolicy":"[^"]*"/"unmanagedAttributePolicy":"ENABLED"/') ;;
          *) UPDATED=$(printf '%s' "$CURRENT" | sed 's/^{/{"unmanagedAttributePolicy":"ENABLED",/') ;;
        esac
        if curl -s -f -X PUT -H "Authorization: Bearer ${KC_TOKEN}" -H 'Content-Type: application/json' \
          -d "$UPDATED" "$KC_PROFILE_URL" >/dev/null; then
          echo "User profile unmanagedAttributePolicy=ENABLED applied (okf_scopes attributes persist)."
        else
          echo "WARN: failed to PUT user-profile policy (okf_scopes may be dropped)." >&2
        fi
      else
        echo "WARN: failed to read user-profile config." >&2
      fi
    else
      echo "WARN: no master token for user-profile policy step." >&2
    fi
    touch /tmp/config-done
    echo "Keycloak realm configured successfully. Keeping container alive for healthcheck..."
    exec sleep infinity
  fi
  echo "Keycloak realm configuration failed (attempt $attempt/$MAX_RETRIES). Retrying in ${RETRY_DELAY}s..." >&2
  sleep $RETRY_DELAY
done

echo "ERROR: Keycloak realm configuration failed after $MAX_RETRIES attempts." >&2
exit 1
