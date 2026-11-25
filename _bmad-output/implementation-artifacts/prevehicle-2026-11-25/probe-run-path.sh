#!/usr/bin/env bash
# The #2170 pre-vehicle probe — the run path, BEFORE any test.
#
# It proves, in order:
#   1. the venue edge answers and serves the umbrella tip's build marker;
#   2. a DEDICATED realm token can be minted (ROPC enabled for the mint,
#      reverted immediately after, then verified off — the V08 story 3-3
#      posture pattern);
#   3. the BFF's NON-streaming JSON entry (POST /api/queries) takes the
#      AGENTIC branch and answers with metadata.agent_run;
#   4. the BFF's STREAMING entry (POST /api/queries/stream) emits the
#      agentic frame vocabulary (agent_activity / agent_verdict / metadata /
#      done);
#   5. the agent-service itself answers a direct POST /v1/runs (the e02
#      campaign's leg), through a port-forward;
#   6. the queries doc carries metadata.agent_run back through the
#      read-back route.
#
# Usage: probe-run-path.sh [output-file]
set -uo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../.." && pwd)"
OUT="${1:-/tmp/probe-run-path.log}"
NS="${NS:-genieai}"
VENUE_IP="${VENUE_IP:-10.42.0.240}"
VENUE_PORT="${VENUE_PORT:-4443}"
VENUE="genieai-forge.local"
REALM="genie"
CLIENT_ID_NAME="genie-app"
PROBE_USER="${PROBE_USER:-e2170-probe}"
PROBE_EMAIL="${PROBE_EMAIL:-e2170-probe@ci.invalid}"
PROBE_PASSWORD="${PROBE_PASSWORD:-E2170-Probe-Pw-2026}"
BASE="https://${VENUE}:${VENUE_PORT}"

exec > >(tee -a "$OUT") 2>&1
echo "=== #2170 run-path probe ==="
echo "date: $(date -u +%FT%TZ)"
echo "venue: ${BASE}"

# curl with an explicit resolution: the venue NAME is not in this host's DNS.
c() { curl -sk --resolve "${VENUE}:${VENUE_PORT}:${VENUE_IP}" "$@"; }

echo "--- 1. edge + build marker"
c -o /tmp/probe-build-info.json -w "build-info http=%{http_code}\n" "${BASE}/build-info.json" || true
cat /tmp/probe-build-info.json 2>/dev/null | head -c 400; echo
c -o /dev/null -w "health http=%{http_code}\n" "${BASE}/api/health" || true

echo "--- 2. master admin token"
KC_ADMIN_PASSWORD="$(kubectl -n "$NS" get secret keycloak-admin-credentials -o go-template='{{ index .data "password" | base64decode }}')"
MASTER_TOKEN="$(c -X POST "${BASE}/auth/realms/master/protocol/openid-connect/token" \
  --data-urlencode 'grant_type=password' --data-urlencode 'client_id=admin-cli' \
  --data-urlencode 'username=admin' --data-urlencode "password=${KC_ADMIN_PASSWORD}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')"
if [ -z "$MASTER_TOKEN" ]; then echo "FATAL: no master admin token"; exit 2; fi
echo "master token: minted"

CLIENT_UUID="$(c "${BASE}/auth/admin/realms/${REALM}/clients?clientId=${CLIENT_ID_NAME}" \
  -H "Authorization: Bearer ${MASTER_TOKEN}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if d else "")')"
echo "client ${CLIENT_ID_NAME}: ${CLIENT_UUID}"

echo "--- 3. dedicated user"
# Create (idempotent): a user that already exists is left alone.
USER_ID="$(c "${BASE}/auth/admin/realms/${REALM}/users?username=${PROBE_USER}&exact=true" \
  -H "Authorization: Bearer ${MASTER_TOKEN}" \
  | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if d else "")')"
if [ -z "$USER_ID" ]; then
  c -X POST "${BASE}/auth/admin/realms/${REALM}/users" -H "Authorization: Bearer ${MASTER_TOKEN}" \
    -H 'Content-Type: application/json' -d "$(python3 - "$PROBE_USER" "$PROBE_EMAIL" "$PROBE_PASSWORD" <<'PY'
import json,sys
print(json.dumps({
  "username": sys.argv[1], "email": sys.argv[2], "emailVerified": True,
  "firstName": "E2170", "lastName": "Probe", "enabled": True,
  "credentials": [{"type": "password", "value": sys.argv[3], "temporary": False}],
}))
PY
)" -o /dev/null -w "create user http=%{http_code}\n"
  echo "user created: ${PROBE_USER}"
else
  echo "user exists: ${PROBE_USER} (${USER_ID})"
fi

echo "--- 4. ROPC posture: enable -> mint -> revert -> verify"
# The client is fetched, the ONE field is changed, and the whole
# representation is written back (a bare PUT drops the client's other
# fields).
fetch_client() {
  c "${BASE}/auth/admin/realms/${REALM}/clients/${CLIENT_UUID}" -H "Authorization: Bearer ${MASTER_TOKEN}"
}
set_ropc() {
  fetch_client | python3 -c "
import json,sys
d=json.load(sys.stdin)
d['directAccessGrantsEnabled'] = ($1)
print(json.dumps(d))
" > /tmp/probe-client.json
  c -X PUT "${BASE}/auth/admin/realms/${REALM}/clients/${CLIENT_UUID}" \
    -H "Authorization: Bearer ${MASTER_TOKEN}" -H 'Content-Type: application/json' \
    --data-binary @/tmp/probe-client.json -o /dev/null -w "ropc=$1 http=%{http_code}\n"
}
revert_ropc() {
  set_ropc False
  fetch_client | python3 -c "
import json,sys
print('directAccessGrantsEnabled =', json.load(sys.stdin).get('directAccessGrantsEnabled'))
"
}
trap 'echo "trap: reverting ROPC"; revert_ropc' EXIT

set_ropc True
REALM_TOKEN="$(c -X POST "${BASE}/auth/realms/${REALM}/protocol/openid-connect/token" \
  --data-urlencode 'grant_type=password' --data-urlencode "client_id=${CLIENT_ID_NAME}" \
  --data-urlencode "username=${PROBE_USER}" --data-urlencode "password=${PROBE_PASSWORD}" \
  | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')"
if [ -z "$REALM_TOKEN" ]; then echo "FATAL: no realm token for ${PROBE_USER}"; exit 2; fi
echo "realm token: minted"
revert_ropc
trap - EXIT

echo "--- 5. BFF non-streaming JSON entry (POST /api/queries)"
SESSION_ID="e2170-probe-$(date +%s)"
JSON_BODY="$(python3 - "$SESSION_ID" <<'PY'
import json,sys
print(json.dumps({
  "sessionId": sys.argv[1],
  "messages": [{"role": "user", "content": "What is the capital of France?"}],
  "context": {"categoryLabel": "General", "language": "en"},
  "timestamp": "2026-11-25T00:00:00.000Z",
}))
PY
)"
c -X POST "${BASE}/api/queries" -H "Authorization: Bearer ${REALM_TOKEN}" \
  -H 'Content-Type: application/json' -d "$JSON_BODY" \
  -w "\nhttp=%{http_code}\n" -o /tmp/probe-json-response.json --max-time 600
echo "--- response body"
python3 -m json.tool /tmp/probe-json-response.json 2>/dev/null | head -60 || cat /tmp/probe-json-response.json
QUERY_ID="$(python3 -c "
import json
try:
    print(json.load(open('/tmp/probe-json-response.json')).get('queryId',''))
except Exception:
    print('')
")"
echo "queryId: ${QUERY_ID}"

echo "--- 6. BFF streaming entry (POST /api/queries/stream)"
STREAM_BODY="$(python3 - "$SESSION_ID" <<'PY'
import json,sys
print(json.dumps({
  "sessionId": sys.argv[1],
  "messages": [{"role": "user", "content": "Name one GENIE.AI service."}],
  "context": {"categoryLabel": "General", "language": "en"},
}))
PY
)"
c -N -X POST "${BASE}/api/queries/stream" -H "Authorization: Bearer ${REALM_TOKEN}" \
  -H 'Content-Type: application/json' -d "$STREAM_BODY" --max-time 600 > /tmp/probe-stream.txt 2>&1
echo "stream frames (kind / first 120 chars):"
python3 - <<'PY'
import json
for line in open('/tmp/probe-stream.txt', errors='replace'):
    line=line.strip()
    if not line.startswith('data:'):
        continue
    try:
        d=json.loads(line[5:].strip())
    except Exception:
        print('  raw:', line[:120]); continue
    kind = d.get('type') or ('usage_record' if 'usage_record' in d else '?')
    extra = ''
    if kind=='chunk': extra = str(d.get('content',''))[:80]
    elif kind=='agent_activity': extra = f"{d.get('operation')} {d.get('status')}"
    elif kind=='agent_verdict': extra = f"grounding={d.get('grounding_status')} grounded={d.get('is_grounded')}"
    elif kind=='metadata': extra = f"agent_run={json.dumps(d.get('agent_run',{}))[:160]}"
    elif kind=='done': extra = f"queryId={d.get('queryId')}"
    elif kind=='error': extra = f"{d.get('code')} {d.get('message')}"
    print(f'  {kind}: {extra}')
PY

echo "--- 7. agent-service direct POST /v1/runs (port-forward)"
kubectl -n "$NS" port-forward svc/e2170-agent-hl 18010:8080 >/tmp/probe-pf.log 2>&1 &
PF_PID=$!
sleep 6
RUN_BODY="$(python3 <<'PY'
import json
print(json.dumps({
  "question": "What is the capital of France?",
  "deadline_ms": 300000,
  "context": {"user_id": "e2170-probe", "authorized_graph_names": ["GRAPH"], "authorized_repos": [], "requested_labels": []},
  "language": None,
}))
PY
)"
curl -sN -X POST "http://127.0.0.1:18010/v1/runs" -H 'Content-Type: application/json' \
  -d "$RUN_BODY" --max-time 300 > /tmp/probe-agent-run.txt 2>&1
echo "agent run envelope kinds:"
python3 - <<'PY'
import json
for line in open('/tmp/probe-agent-run.txt', errors='replace'):
    line=line.strip()
    if not line.startswith('data:'):
        continue
    try:
        d=json.loads(line[5:].strip())
    except Exception:
        continue
    if 'usage_record' in d:
        print('  usage_record:', json.dumps(d['usage_record'])[:200]); continue
    print(f"  {d.get('kind')}: {json.dumps(d.get('payload',{}))[:140]}")
PY
kill "$PF_PID" 2>/dev/null || true

echo "--- 8. queries doc read-back (metadata.agent_run)"
if [ -n "$QUERY_ID" ]; then
  c "${BASE}/api/queries/${QUERY_ID}" -H "Authorization: Bearer ${REALM_TOKEN}" -o /tmp/probe-query-doc.json -w "read-back http=%{http_code}\n"
  python3 - <<'PY'
import json
try:
    d=json.load(open('/tmp/probe-query-doc.json'))
except Exception as e:
    print('read-back parse failed:', e); raise SystemExit
ar = (d.get('metadata') or {}).get('agent_run')
print('metadata.agent_run =', json.dumps(ar, indent=2)[:1200] if ar else 'ABSENT')
PY
fi

echo "=== probe done ==="
