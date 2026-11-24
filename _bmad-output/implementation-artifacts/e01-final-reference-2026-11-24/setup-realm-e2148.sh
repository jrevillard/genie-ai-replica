#!/usr/bin/env bash
# The #2148 run's Keycloak entities — user + client `e01-sec-eval`, both
# prefixed per the campaign's dedicated-data rule. Created for the upload
# bearer (the doc-repo upload route needs the realm `admin` role) and the
# anchor's in-run ROPC token refresh (EVAL_KC_* in run_eval).
# Cleanup deletes exactly these two entities (see cleanup script).
set -euo pipefail

KCURL="${KCURL:-http://127.0.0.1:18082}"
REALM=genie
KC_ADMIN_USER=$(kubectl -n genieai get secret keycloak-admin-credentials -o jsonpath='{.data.username}' | base64 -d)
KC_ADMIN_PWD=$(kubectl -n genieai get secret keycloak-admin-credentials -o jsonpath='{.data.password}' | base64 -d)
AT=$(curl -s -X POST "$KCURL/auth/realms/master/protocol/openid-connect/token" \
  --data-urlencode "client_id=admin-cli" --data-urlencode "username=$KC_ADMIN_USER" \
  --data-urlencode "password=$KC_ADMIN_PWD" --data-urlencode "grant_type=password" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))")
[ -n "$AT" ] || { echo "REFUSED: no master admin token"; exit 1; }
echo "master admin token ok (${#AT} chars)"

# --- the eval user (realm role: admin) ---
EXISTING=$(curl -s -H "Authorization: Bearer $AT" "$KCURL/auth/admin/realms/$REALM/users?username=e01-sec-eval&exact=true" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['id'] if d else '')")
if [ -z "$EXISTING" ]; then
  # The user's credential is SYNTHETIC — an eval-only user in the campaign's
  # own throwaway realm, created and deleted by this script; it opens nothing
  # outside the run's lifetime.
  curl -s -X POST -H "Authorization: Bearer $AT" -H "Content-Type: application/json" \
    -d '{"username":"e01-sec-eval","email":"e01-sec-eval@eval.invalid","emailVerified":true,"firstName":"E01Sec","lastName":"Eval","enabled":true,"credentials":[{"type":"password","value":"e01-sec-eval-PASS_f3a9c2d1","temporary":false}]}' \
    "$KCURL/auth/admin/realms/$REALM/users" -o /dev/null -w "user create http=%{http_code}\n"
  EXISTING=$(curl -s -H "Authorization: Bearer $AT" "$KCURL/auth/admin/realms/$REALM/users?username=e01-sec-eval&exact=true" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['id'] if d else '')")
else
  echo "user e01-sec-eval already exists ($EXISTING)"
fi
[ -n "$EXISTING" ] || { echo "REFUSED: user create failed"; exit 1; }
echo "user id: $EXISTING"

# the admin role mapping
ROLE=$(curl -s -H "Authorization: Bearer $AT" "$KCURL/auth/admin/realms/$REALM/roles/admin" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('id','')+' '+d.get('name',''))")
RID=${ROLE%% *}; RNAME=${ROLE#* }
curl -s -X POST -H "Authorization: Bearer $AT" -H "Content-Type: application/json" \
  -d "[{\"id\":\"$RID\",\"name\":\"$RNAME\"}]" \
  "$KCURL/auth/admin/realms/$REALM/users/$EXISTING/role-mappings/realm" -o /dev/null -w "role map http=%{http_code}\n"
curl -s -H "Authorization: Bearer $AT" "$KCURL/auth/admin/realms/$REALM/users/$EXISTING/role-mappings/realm" | python3 -c "import sys,json;print('user roles:',[r['name'] for r in json.load(sys.stdin)])"

# --- the eval client (public, ROPC direct grants) ---
EXISTING_C=$(curl -s -H "Authorization: Bearer $AT" "$KCURL/auth/admin/realms/$REALM/clients?clientId=e01-sec-eval&exact=true" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['id'] if d else '')")
if [ -z "$EXISTING_C" ]; then
  curl -s -X POST -H "Authorization: Bearer $AT" -H "Content-Type: application/json" \
    -d '{"clientId":"e01-sec-eval","enabled":true,"protocol":"openid-connect","publicClient":true,"directAccessGrantsEnabled":true,"standardFlowEnabled":false,"redirectUris":["https://genieai-forge.local:4443/*"],"webOrigins":["+"]}' \
    "$KCURL/auth/admin/realms/$REALM/clients" -o /dev/null -w "client create http=%{http_code}\n"
  EXISTING_C=$(curl -s -H "Authorization: Bearer $AT" "$KCURL/auth/admin/realms/$REALM/clients?clientId=e01-sec-eval&exact=true" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['id'] if d else '')")
else
  echo "client e01-sec-eval already exists ($EXISTING_C)"
fi
[ -n "$EXISTING_C" ] || { echo "REFUSED: client create failed"; exit 1; }
echo "client id: $EXISTING_C"

# --- the verification: a real ROPC mint + its issuer ---
curl -s -X POST "$KCURL/auth/realms/$REALM/protocol/openid-connect/token" \
  -d "client_id=e01-sec-eval" -d "grant_type=password" \
  --data-urlencode "username=e01-sec-eval" --data-urlencode "password=e01-sec-eval-PASS_f3a9c2d1" \
  | python3 -c "
import sys, json, base64
d = json.load(sys.stdin)
tok = d.get('access_token')
if not tok:
    print('REFUSED: mint failed:', d); sys.exit(1)
payload = tok.split('.')[1]; payload += '=' * (-len(payload) % 4)
claims = json.loads(base64.urlsafe_b64decode(payload))
print('mint OK; iss:', claims.get('iss'))
print('roles:', claims.get('realm_access', {}).get('roles'))
"
