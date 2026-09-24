#!/bin/bash
# Anchor runner with mandatory ROPC cleanup (trap ensures revert even on crash).
#
# chatqna's auth gate (post-MR-!445) rejects requests without a valid Bearer.
# The eval pipeline drives queries headlessly via ROPC — but ROPC must be
# REVERTED after the run (it's disabled in production by default for
# security). This wrapper:
#
#   1. Gets a master admin token from KEYCLOAK_ADMIN_PASSWORD
#   2. Resolves the client UUID for the OIDC client (default: genie-app)
#   3. Temporarily enables directAccessGrantsEnabled
#   4. Runs `python run_eval.py anchor <gold> <out>` with eval env vars
#   5. ALWAYS disables ROPC again (trap on EXIT/INT/TERM)
#
# Required env vars (all have defaults; override as needed):
#   EVAL_KC_URL          Keycloak base URL (no default — REQUIRED)
#   EVAL_KC_REALM        Realm (default: genie)
#   EVAL_KC_CLIENT_ID    OIDC client ID (default: genie-app)
#   KEYCLOAK_ADMIN_PASSWORD   master admin password (no default — REQUIRED
#                              unless the host already exports it)
#   CHATQNA_CONTAINER    chatqna container name (resolved live if unset)
#   CHATQNA_SERVICE_NAME OTel service name for trace fetches (default: genieai-chatqna)
#   VICTORIATRACES_SVC   VT service DNS name (default: <stack>_victoriatraces)
#   GRAPH_SOURCE        SOURCE collection name (default: GRAPH_TEST_SOURCE)
#   ARANGO_URL          ArangoDB base URL (default: http://localhost:8529)
#   ARANGO_DB           ArangoDB database name (no default — REQUIRED)
#   ARANGO_USER         Arango user (default: root)
#   ARANGO_PASSWORD     Arango password (no default — REQUIRED)
#   TRACE_FETCH_TIMEOUT Trace fetch timeout in seconds (default: 120)
#
# Usage:
#   ./run_anchor_with_cleanup.sh <gold.json> <out.json>
#
# See tests/rag-benchmarks/CLAUDE.md for the full eval run recipe.

set -e

GOLD="$1"
OUT="$2"

if [ -z "$GOLD" ] || [ -z "$OUT" ]; then
    echo "Usage: $0 <gold.json> <out.json>" >&2
    exit 2
fi

# Required env validation
: "${EVAL_KC_URL:?EVAL_KC_URL must be set (Keycloak base URL, e.g. https://kc.example.com/auth)}"
: "${ARANGO_DB:?ARANGO_DB must be set (ArangoDB database name)}"
: "${ARANGO_PASSWORD:?ARANGO_PASSWORD must be set (ArangoDB password)}"
: "${KEYCLOAK_ADMIN_PASSWORD:?KEYCLOAK_ADMIN_PASSWORD must be set (master admin password)}"

# Resolve dynamic defaults
EVAL_KC_REALM="${EVAL_KC_REALM:-genie}"
EVAL_KC_CLIENT_ID="${EVAL_KC_CLIENT_ID:-genie-app}"
CHATQNA_SERVICE_NAME="${CHATQNA_SERVICE_NAME:-genieai-chatqna}"
RERANKER_SERVICE_NAME="${RERANKER_SERVICE_NAME:-genieai-reranker}"
GRAPH_SOURCE="${GRAPH_SOURCE:-GRAPH_TEST_SOURCE}"
TEXT_FIELD="${TEXT_FIELD:-chunk_text}"
ARANGO_URL="${ARANGO_URL:-http://localhost:8529}"
ARANGO_USER="${ARANGO_USER:-root}"
TRACE_FLUSH_WAIT="${TRACE_FLUSH_WAIT:-5}"
TRACE_FETCH_TIMEOUT="${TRACE_FETCH_TIMEOUT:-120}"
CHATQNA_URL="${CHATQNA_URL:-http://localhost:8888/v1/chatqna}"

# Resolve chatqna container live if not pinned (Swarm replica suffix is dynamic)
if [ -z "${CHATQNA_CONTAINER:-}" ]; then
    CHATQNA_CONTAINER=$(docker ps --format '{{.Names}}' | grep chatqna-xeon-backend-server | head -1)
fi

# Resolve VT service name from the chatqna stack if not pinned
if [ -z "${VICTORIATRACES_SVC:-}" ]; then
    VICTORIATRACES_SVC=$(echo "${CHATQNA_SERVICE_NAME}" | sed 's/chatqna/victoriatraces/' | sed 's/-chatqna$/-victoriatraces/')
fi

ADMIN_TOKEN=$(curl -sk -X POST "$EVAL_KC_URL/realms/master/protocol/openid-connect/token" \
    -d "client_id=admin-cli" -d "username=admin" -d "password=$KEYCLOAK_ADMIN_PASSWORD" -d "grant_type=password" \
    | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")
CLIENT_UUID=$(curl -sk "$EVAL_KC_URL/admin/realms/$EVAL_KC_REALM/clients?clientId=$EVAL_KC_CLIENT_ID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])")

echo "[setup] client uuid: $CLIENT_UUID"
echo "[setup] enabling ROPC on $EVAL_KC_CLIENT_ID..."
curl -sk -X PUT "$EVAL_KC_URL/admin/realms/$EVAL_KC_REALM/clients/$CLIENT_UUID" \
    -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
    -d '{"directAccessGrantsEnabled": true}' >/dev/null
echo "[setup] ROPC enabled"

disable_ropc() {
    echo "[cleanup] disabling ROPC on $EVAL_KC_CLIENT_ID (uuid=$CLIENT_UUID)..."
    curl -sk -X PUT "$EVAL_KC_URL/admin/realms/$EVAL_KC_REALM/clients/$CLIENT_UUID" \
        -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
        -d '{"directAccessGrantsEnabled": false}' >/dev/null
    echo "[cleanup] ROPC disabled"
}

# Always revert ROPC on exit (success OR failure OR signal).
# CRITICAL: leaving ROPC enabled in prod is a security vulnerability.
trap disable_ropc EXIT INT TERM

# Run the anchor eval
echo "[run] ChatQNA container: $CHATQNA_CONTAINER"
echo "[run] gold: $GOLD"
echo "[run] out:  $OUT"
date

python3 "$(dirname "$0")/../eval/run_eval.py" anchor "$GOLD" "$OUT"

date
echo "[done] trap will revert ROPC"
