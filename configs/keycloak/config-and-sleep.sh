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

# URL-encode a value for application/x-www-form-urlencoded bodies (vault
# secrets routinely contain &, %, +, # — a raw -d would corrupt the POST).
urlencode() {
  printf '%s' "$1" | sed -e 's/%/%25/g' -e 's/&/%26/g' -e 's/+/%2B/g' -e 's/#/%23/g' -e 's/ /%20/g'
}

while [ $attempt -lt $MAX_RETRIES ]; do
  attempt=$((attempt + 1))
  echo "Attempt $attempt/$MAX_RETRIES: Running Keycloak realm configuration..."
  if java -jar /app/keycloak-config-cli.jar; then
    # ─── Story 6.1 post-import steps ─────────────────────────────────────────
    # KC 24+ declarative user profile DROPS undeclared attributes — the
    # okf_scopes user attribute (→ claim via the user-attribute mapper) needs
    # unmanagedAttributePolicy=ADMIN_EDIT (ADMIN-only writes; users CANNOT
    # self-assign scopes via the account API — ENABLED would allow it). The
    # realm-level attribute knob is NOT honored by the profile validator in
    # KC 26 and keycloak-config-cli cannot express the profile resource.
    #
    # Ordering matters: config-cli just created users WITH yaml attributes
    # that KC stripped (policy was off) — so AFTER enabling the policy we
    # RE-APPLY the intended scopes. This is also the UPGRADE MIGRATION: every
    # existing tools-admin holder (the operators who could read/mutate OKF
    # before Story 6.1) is granted the wildcard scope, preserving their
    # access through the default-deny rollout. Non-breaking by construction.
    KC_BASE="${KEYCLOAK_URL:-http://keycloak:8080}"
    KC_REALM_NAME="${KC_REALM:-genie}"
    KC_PW_ENC=$(urlencode "${KEYCLOAK_PASSWORD}")
    KC_TOKEN=$(curl -s -f -X POST "${KC_BASE}/realms/master/protocol/openid-connect/token" \
      -d "client_id=admin-cli&username=${KEYCLOAK_USER:-admin}&password=${KC_PW_ENC}&grant_type=password" |
      sed -n 's/.*"access_token":"\([^"]*\)".*/\1/p')
    if [ -n "$KC_TOKEN" ]; then
      KAH="Authorization: Bearer ${KC_TOKEN}"
      KC_PROFILE_URL="${KC_BASE}/admin/realms/${KC_REALM_NAME}/users/profile"

      # 1. Enable the ADMIN_EDIT policy — robustly: merge via the token JSON,
      #    then READ BACK to verify (a silent no-op here default-denies every
      #    steward with only a WARN as evidence).
      POLICY_OK=0
      if CURRENT=$(curl -s -f -H "$KAH" "$KC_PROFILE_URL"); then
        case "$CURRENT" in
          *'"unmanagedAttributePolicy"'*)
            UPDATED=$(printf '%s' "$CURRENT" | sed 's/"unmanagedAttributePolicy"[[:space:]]*:[[:space:]]*"[^"]*"/"unmanagedAttributePolicy":"ADMIN_EDIT"/')
            ;;
          '{}')
            UPDATED='{"unmanagedAttributePolicy":"ADMIN_EDIT"}'
            ;;
          *)
            UPDATED=$(printf '%s' "$CURRENT" | sed 's/^{/{"unmanagedAttributePolicy":"ADMIN_EDIT",/')
            ;;
        esac
        if curl -s -f -X PUT -H "$KAH" -H 'Content-Type: application/json' -d "$UPDATED" "$KC_PROFILE_URL" >/dev/null; then
          VERIFY=$(curl -s -f -H "$KAH" "$KC_PROFILE_URL" | sed -n 's/.*"unmanagedAttributePolicy"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p')
          if [ "$VERIFY" = "ADMIN_EDIT" ]; then
            POLICY_OK=1
            echo "User profile unmanagedAttributePolicy=ADMIN_EDIT applied + verified (admin-only okf_scopes writes)."
          fi
        fi
      fi
      if [ "$POLICY_OK" -ne 1 ]; then
        echo "WARN: user-profile ADMIN_EDIT policy NOT confirmed — okf_scopes writes may be dropped or user-writable. Scope assignment will not work until fixed." >&2
      fi

      # 2. Scope migration (fresh realms AND upgrades): grant the wildcard
      #    okf scope to genie-admin (the yaml intent, re-applied post-policy)
      #    and to every holder of the tools-admin realm role (upgrade path —
      #    the role meant full OKF access before scopes existed). Idempotent:
      #    only adds the scope when absent.
      if [ "$POLICY_OK" -eq 1 ]; then
        grant_scope() {
          USER_ID="$1"
          [ -z "$USER_ID" ] && return 0
          USER_JSON=$(curl -s -f -H "$KAH" "${KC_BASE}/admin/realms/${KC_REALM_NAME}/users/${USER_ID}")
          case "$USER_JSON" in
            *'"okf_scopes"'*) return 0 ;; # already carries scopes — never overwrite finer grants
          esac
          ATTRS=$(printf '%s' "$USER_JSON" | sed -n 's/.*"attributes"[[:space:]]*:[[:space:]]*\({[^}]*}\).*/\1/p')
          if [ -n "$ATTRS" ] && [ "$ATTRS" != "{}" ] && [ "$ATTRS" != "null" ]; then
            NEW_ATTRS=$(printf '%s' "$ATTRS" | sed 's/}$/,"okf_scopes":["okf:*:*:admin"]}/')
          else
            NEW_ATTRS='{"okf_scopes":["okf:*:*:admin"]}'
          fi
          curl -s -f -X PUT -H "$KAH" -H 'Content-Type: application/json' \
            -d "{\"attributes\":${NEW_ATTRS}}" \
            "${KC_BASE}/admin/realms/${KC_REALM_NAME}/users/${USER_ID}" >/dev/null && \
            echo "Granted okf wildcard scope to user ${USER_ID}."
        }
        ADMIN_ID=$(curl -s -f -H "$KAH" "${KC_BASE}/admin/realms/${KC_REALM_NAME}/users?username=$(urlencode "${GENIE_ADMIN_USERNAME:-genie-admin}")&exact=true" |
          sed -n 's/.*"id":"\([^"]*\)".*/\1/p' | head -n 1)
        grant_scope "$ADMIN_ID"
        for TOOLS_ADMIN_ID in $(curl -s -f -H "$KAH" "${KC_BASE}/admin/realms/${KC_REALM_NAME}/roles/tools-admin/users?max=200" |
          sed -n 's/.*"id":"\([^"]*\)".*/\1/p'); do
          [ "$TOOLS_ADMIN_ID" = "$ADMIN_ID" ] && continue
          grant_scope "$TOOLS_ADMIN_ID"
        done
      fi
    else
      echo "WARN: no master token for user-profile policy + scope migration steps." >&2
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
