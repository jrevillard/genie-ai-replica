#!/usr/bin/env bash
# Seed ONE published OKF repo on the venue — the campaign's engagement
# remedy.
#
# WHY: the agentic path's retrieval is gated by the OKF fan-out. The BFF
# builds the run's CallerContext from the shared fan-out posture
# (query-service.js:837 _fanoutGraphSet): the authorized graph set is EMPTY
# unless the posture is engaged, and the agent's capability contract treats
# an empty set as "nothing is reachable" (capabilities/executor.py:111 —
# fail-closed, the search port is never consulted). The okf-server's own
# rule: `engaged = (mode in okf_only|hybrid) && serving_graph_count >= 1`
# (retrieval-config-service.js:215). So the fan-out engages only with
# (a) the mode set to hybrid AND (b) at least ONE SERVING (published) repo.
#
# With neither, every agentic answer is the insufficiency statement — the
# flag alone does not make the agentic path work. This script creates the
# minimum serving state: one repo, one concept, one minted version, and the
# retrieval mode set to hybrid.
#
# The identity is the campaign's OWN probe user with the realm role
# `tools-admin` (the superadmin predicate of the OKF write surface,
# scope-authz-service.js: isSuperadminCaller). The role grant is REMOVED
# by the campaign cleanup.
#
# Usage: seed-okf-serving-repo.sh [output-file]
set -uo pipefail

OUT="${1:-/tmp/seed-okf.log}"
NS="${NS:-genieai}"
VENUE_IP="${VENUE_IP:-10.42.0.240}"
VENUE_PORT="${VENUE_PORT:-4443}"
VENUE="genieai-forge.local"
REALM="genie"
PROBE_USER="e2170-probe"
PROBE_PASSWORD="E2170-Probe-Pw-2026"
REPO_ID="e2170-campaign-repo"

exec > >(tee -a "$OUT") 2>&1
echo "=== #2170 OKF serving-repo seed ==="
echo "date: $(date -u +%FT%TZ)"

c() { curl -sk --resolve "${VENUE}:${VENUE_PORT}:${VENUE_IP}" "$@"; }

echo "--- master token + the tools-admin role id"
KC_ADMIN_PASSWORD="$(kubectl -n "$NS" get secret keycloak-admin-credentials -o go-template='{{ index .data "password" | base64decode }}')"
MASTER="$(c -X POST "https://${VENUE}:${VENUE_PORT}/auth/realms/${REALM%%/*}/protocol/openid-connect/token" --data-urlencode 'grant_type=password' --data-urlencode 'client_id=admin-cli' --data-urlencode 'username=admin' --data-urlencode "password=${KC_ADMIN_PASSWORD}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')"
MASTER="$(c -X POST "https://${VENUE}:${VENUE_PORT}/auth/realms/master/protocol/openid-connect/token" --data-urlencode 'grant_type=password' --data-urlencode 'client_id=admin-cli' --data-urlencode 'username=admin' --data-urlencode "password=${KC_ADMIN_PASSWORD}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')"
[ -z "$MASTER" ] && { echo "FATAL: no master token"; exit 2; }
TOOLS_ADMIN_ID="$(c "https://${VENUE}:${VENUE_PORT}/auth/admin/realms/${REALM}/roles/tools-admin" -H "Authorization: Bearer ${MASTER}" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d.get("id",""))')"
echo "tools-admin role id: ${TOOLS_ADMIN_ID}"

echo "--- grant the role to the campaign's probe user"
USER_ID="$(c "https://${VENUE}:${VENUE_PORT}/auth/admin/realms/${REALM}/users?username=${PROBE_USER}&exact=true" -H "Authorization: Bearer ${MASTER}" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if d else "")')"
[ -z "$USER_ID" ] && { echo "FATAL: probe user ${PROBE_USER} missing"; exit 2; }
c -X POST "https://${VENUE}:${VENUE_PORT}/auth/admin/realms/${REALM}/users/${USER_ID}/role-mappings/realm" \
  -H "Authorization: Bearer ${MASTER}" -H 'Content-Type: application/json' \
  -d "[{\"id\":\"${TOOLS_ADMIN_ID}\",\"name\":\"tools-admin\"}]" -o /dev/null -w "grant http=%{http_code}\n"

echo "--- mint the probe user's realm token (ROPC on -> mint -> off)"
CLIENT_ID_NAME="genie-app"
CLIENT_UUID="$(c "https://${VENUE}:${VENUE_PORT}/auth/admin/realms/${REALM}/clients?clientId=${CLIENT_ID_NAME}" -H "Authorization: Bearer ${MASTER}" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if d else "")')"
set_ropc() {
  c "https://${VENUE}:${VENUE_PORT}/auth/admin/realms/${REALM}/clients/${CLIENT_UUID}" -H "Authorization: Bearer ${MASTER}" \
    | python3 -c "
import json,sys
d=json.load(sys.stdin); d['directAccessGrantsEnabled']=($1); print(json.dumps(d))" > /tmp/seed-client.json
  c -X PUT "https://${VENUE}:${VENUE_PORT}/auth/admin/realms/${REALM}/clients/${CLIENT_UUID}" \
    -H "Authorization: Bearer ${MASTER}" -H 'Content-Type: application/json' \
    --data-binary @/tmp/seed-client.json -o /dev/null -w "ropc=$1 http=%{http_code}\n"
}
trap 'set_ropc False' EXIT
set_ropc True
TOKEN="$(c -X POST "https://${VENUE}:${VENUE_PORT}/auth/realms/${REALM}/protocol/openid-connect/token" --data-urlencode 'grant_type=password' --data-urlencode "client_id=${CLIENT_ID_NAME}" --data-urlencode "username=${PROBE_USER}" --data-urlencode "password=${PROBE_PASSWORD}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')"
[ -z "$TOKEN" ] && { echo "FATAL: no realm token"; exit 2; }
set_ropc False
trap - EXIT
echo "token minted"
echo "$TOKEN" > /tmp/e2170.token

echo "--- okf-server (in-cluster, through a port-forward)"
kubectl -n "$NS" port-forward svc/okf-server 13002:3002 >/tmp/okf-pf.log 2>&1 &
PF=$!
trap 'kill $PF 2>/dev/null' EXIT
for i in $(seq 1 20); do
  if curl -s -o /dev/null http://127.0.0.1:13002/health; then break; fi
  sleep 2
done
OKF="http://127.0.0.1:13002/api/okf"

echo "--- 1. create the repo"
CREATE_OUT="$(c -X POST "${OKF}/repos" -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
  -d '{"name":"#2170 campaign seed","domain":"campaign","acl":{}}')"
echo "create repo: $(echo "$CREATE_OUT" | head -c 400)"
REPO_ID="$(echo "$CREATE_OUT" | python3 -c "
import sys,json
try:
    d=json.load(sys.stdin)
except Exception:
    print(''); raise SystemExit
repo=d.get('repo') if isinstance(d,dict) and isinstance(d.get('repo'),dict) else d
print((repo or {}).get('repo_id') or (repo or {}).get('id') or '')
")"
echo "repo_id: ${REPO_ID}"

echo "--- 2. import one concept"
c -X POST "${OKF}/repos/${REPO_ID}/import" -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
  -d '{"concepts":[{"body":"#2170 campaign seed concept. The GENIE.AI knowledge base is served by the umbrella chart; the campaign repo exists so the OKF fan-out engages and the agentic path can search the legacy corpus."}]}' \
  -w "\nimport http=%{http_code}\n" | head -c 800

echo "--- 3. mint the version (publish)"
for i in 1 2 3 4 5 6; do
  OUT_VERSION="$(c -X POST "${OKF}/repos/${REPO_ID}/versions" -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' -d '{}' -w "\nHTTP:%{http_code}")"
  echo "mint attempt ${i}: $(echo "$OUT_VERSION" | tail -c 300)"
  case "$OUT_VERSION" in *HTTP:2*) break;; esac
  sleep 10
done

echo "--- 4. the retrieval mode -> hybrid"
c -X PUT "${OKF}/retrieval-config" -H "Authorization: Bearer ${TOKEN}" -H 'Content-Type: application/json' \
  -d '{"mode":"hybrid"}' -w "\nset mode http=%{http_code}\n" | head -c 400

echo "--- 5. the retrieval config now"
c "${OKF}/retrieval-config" -H "Authorization: Bearer ${TOKEN}" | python3 -c "
import sys,json
d=json.load(sys.stdin)
print('mode:', (d.get('config') or {}).get('mode'))
print('serving_graph_count:', d.get('serving_graph_count'))
print('serving_repo_ids:', d.get('serving_repo_ids'))
print('engaged:', d.get('engaged'))
"
echo "=== seed done ==="
