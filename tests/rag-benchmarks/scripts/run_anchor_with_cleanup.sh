#!/bin/bash
# Eval runner with mandatory ROPC cleanup (trap ensures revert even on crash).
#
# chatqna's auth gate (post-MR-!445) rejects requests without a valid Bearer.
# The eval pipeline drives queries headlessly via ROPC — but ROPC must be
# REVERTED after the run (it's disabled in production by default for
# security). This wrapper:
#
#   1. Gets a master admin token from KEYCLOAK_ADMIN_PASSWORD
#   2. Resolves the client UUID for the OIDC client (default: genie-app)
#   3. Temporarily enables directAccessGrantsEnabled
#   4. Runs `python run_eval.py <mode> <gold> <out>` with eval env vars
#      (mode = "anchor" for recall/precision, "dump-tuples" for RAGAS input)
#   5. ALWAYS disables ROPC again (trap on EXIT/INT/TERM)
#
# Required env vars (all have defaults; override as needed):
#   EVAL_KC_URL          Keycloak base URL (no default — REQUIRED)
#   EVAL_KC_REALM        Realm (default: genie)
#   EVAL_KC_CLIENT_ID    OIDC client ID (default: genie-app)
#   KEYCLOAK_ADMIN_PASSWORD   master admin password (no default — REQUIRED)
#   GENIE_ADMIN_PASSWORD  user-realm admin password (no default — REQUIRED
#                              for chunked token-refresh orchestrator)
#   EVAL_DEPLOY_ENV      Path to the deployment's .env (default: /opt/<stack>/.env)
#                              Used to extract GENIE_ADMIN_PASSWORD if not exported.
#   EVAL_MODE            Eval mode: "anchor" (default) or "dump-tuples"
#   EVAL_CHUNK_SIZE      Qs per chunk (default 8; orchestrator refreshes bearer per chunk)
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
#   EVAL_MODE=anchor    ./run_anchor_with_cleanup.sh <gold.json> <out.json>
#   EVAL_MODE=dump-tuples ./run_anchor_with_cleanup.sh <gold.json> <tuples.json>
#
# See tests/rag-benchmarks/eval/CLAUDE.md for the full eval run recipe.

set -e

GOLD="$1"
OUT="$2"
EVAL_MODE="${EVAL_MODE:-anchor}"

if [ -z "$GOLD" ] || [ -z "$OUT" ]; then
    echo "Usage: EVAL_MODE={anchor|dump-tuples} $0 <gold.json> <out.json>" >&2
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

# Fetch a realm-level bearer token for the test user (post-MR-!445 chatqna auth gate).
# We need a token from the USER realm (not master), valid for chatqna. Two options:
#   - GENIE_ADMIN_PASSWORD (if exported)  → ROPC for genie-admin on the user realm
#   - master admin token (fallback)         → works only if chatqna accepts master-realm tokens
# Always try the user-realm ROPC first (chatqna's typical deployment expects the user-realm token).
E2E_BEARER_TOKEN=""
if [ -n "${GENIE_ADMIN_PASSWORD:-}" ]; then
    E2E_BEARER_TOKEN=$(curl -sk -X POST "$EVAL_KC_URL/realms/$EVAL_KC_REALM/protocol/openid-connect/token" \
        --data-urlencode "grant_type=password" \
        --data-urlencode "client_id=$EVAL_KC_CLIENT_ID" \
        --data-urlencode "username=genie-admin" \
        --data-urlencode "password=$GENIE_ADMIN_PASSWORD" \
        | python3 -c "import sys,json; print(json.load(sys.stdin).get('access_token',''))")
fi
if [ -z "$E2E_BEARER_TOKEN" ]; then
    # Fallback: master admin token. chatqna may or may not — try, and run_eval.py will surface the 401.
    E2E_BEARER_TOKEN="$ADMIN_TOKEN"
    echo "[setup] using master admin token (no GENIE_ADMIN_PASSWORD / user-realm ROPC failed)"
fi
export E2E_BEARER_TOKEN
echo "[setup] E2E_BEARER_TOKEN: ${E2E_BEARER_TOKEN:0:20}..."
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

# Run the anchor eval (chunked with token refresh — bearer lifespan=300s,
# 42-query run takes 25-40 min, so re-fetch between chunks of <=8 queries).
echo "[run] ChatQNA container: $CHATQNA_CONTAINER"
echo "[run] gold: $GOLD"
echo "[run] out:  $OUT"
date

export GENIE_ADMIN_PASSWORD
# Resolve GENIE_ADMIN_PASSWORD from the deployment's .env (path overridable
# via EVAL_DEPLOY_ENV; default matches the on-host /opt/<stack>/.env layout
# produced by deploy/ansible/templates/env.j2).
EVAL_DEPLOY_ENV="${EVAL_DEPLOY_ENV:-/opt/genieai-el-salvador/.env}"
GENIE_ADMIN_PASSWORD="${GENIE_ADMIN_PASSWORD:-$(grep ^GENIE_ADMIN_PASSWORD= "$EVAL_DEPLOY_ENV" 2>/dev/null | cut -d= -f2-)}"
export EVAL_CHUNK_SIZE="${EVAL_CHUNK_SIZE:-8}"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
python3 "$SCRIPT_DIR/run_eval_chunked.py" "$GOLD" "$OUT"

date
echo "[done] trap will revert ROPC"
