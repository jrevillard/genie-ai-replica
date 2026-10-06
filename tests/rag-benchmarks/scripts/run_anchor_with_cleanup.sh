#!/bin/bash
# Eval entry point: ROPC enable → run_eval.py (direct) → VERIFIED ROPC revert.
#
# The eval driver run_eval.py owns token refresh, retry and resume itself;
# this wrapper only (1) resolves secrets from the deployment .env, (2) flips
# directAccessGrantsEnabled, (3) runs the driver, (4) PROVES the revert.
# run_eval_chunked.py is RETIRED — do not recreate it.
#
# Required env (or present in EVAL_DEPLOY_ENV, default /opt/<stack>/.env):
#   EVAL_KC_URL, KEYCLOAK_ADMIN_PASSWORD, GENIE_ADMIN_PASSWORD,
#   ARANGO_DB, ARANGO_PASSWORD
# Optional: EVAL_KC_REALM (genie), EVAL_KC_CLIENT_ID (genie-app),
#   EVAL_MODE (anchor|dump-tuples), EVAL_CHUNK_* gone — see run_eval.py knobs.
set -euo pipefail

GOLD="$1"; OUT="$2"
EVAL_MODE="${EVAL_MODE:-anchor}"

if [ -z "$GOLD" ] || [ -z "$OUT" ]; then
    echo "Usage: $0 <gold.json> <out.json>  (EVAL_MODE=anchor|dump-tuples)" >&2
    exit 2
fi
[ "$EVAL_MODE" = "anchor" ] || [ "$EVAL_MODE" = "dump-tuples" ] || {
    echo "EVAL_MODE must be anchor|dump-tuples (got: $EVAL_MODE)" >&2
    exit 2
}

ENV_FILE="${EVAL_DEPLOY_ENV:-/opt/genieai-el-salvador/.env}"
env_value() { grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2-; }
: "${EVAL_KC_URL:=$(env_value KEYCLOAK_URL)}"; : "${EVAL_KC_URL:?EVAL_KC_URL required}"
: "${KEYCLOAK_ADMIN_PASSWORD:=$(env_value KEYCLOAK_ADMIN_PASSWORD)}"
: "${KEYCLOAK_ADMIN_PASSWORD:?KEYCLOAK_ADMIN_PASSWORD required}"
: "${GENIE_ADMIN_PASSWORD:=$(env_value GENIE_ADMIN_PASSWORD)}"
: "${GENIE_ADMIN_PASSWORD:?GENIE_ADMIN_PASSWORD required}"
: "${ARANGO_DB:=$(env_value ARANGO_DB)}"; : "${ARANGO_DB:?ARANGO_DB required}"
: "${ARANGO_PASSWORD:=$(env_value ARANGO_PASSWORD)}"
: "${ARANGO_PASSWORD:?ARANGO_PASSWORD required}"
export EVAL_KC_URL KEYCLOAK_ADMIN_PASSWORD GENIE_ADMIN_PASSWORD ARANGO_DB ARANGO_PASSWORD
# run_eval.py refreshes the realm bearer itself when these are set:
export EVAL_KC_PASSWORD="$GENIE_ADMIN_PASSWORD"
export EVAL_KC_REALM="${EVAL_KC_REALM:-genie}"
export EVAL_KC_CLIENT_ID="${EVAL_KC_CLIENT_ID:-genie-app}"
export EVAL_KC_USER="${EVAL_KC_USER:-genie-admin}"
export EVAL_MODE

EVAL_KC_REALM_S="$EVAL_KC_REALM"; EVAL_KC_CLIENT_ID_S="$EVAL_KC_CLIENT_ID"
# --- dynamic resolution (exported: run_eval.py inherits) --------------------
export CHATQNA_CONTAINER="${CHATQNA_CONTAINER:-$(docker ps --format '{{.Names}}' | grep chatqna-xeon-backend-server | head -1)}"
export CHATQNA_SERVICE_NAME="${CHATQNA_SERVICE_NAME:-genieai-chatqna}"
export VICTORIATRACES_SVC="${VICTORIATRACES_SVC:-$(echo "$CHATQNA_SERVICE_NAME" | sed 's/chatqna/victoriatraces/;s/-chatqna$/-victoriatraces/')}"
export GRAPH_SOURCE="${GRAPH_SOURCE:-GRAPH_TEST_SOURCE}"
export ARANGO_URL="${ARANGO_URL:-http://localhost:8529}"
export ARANGO_USER="${ARANGO_USER:-root}"

# --- curl with secrets on DISK (chmod-600 cfg), never argv ------------------
# printf %s substitutes the value as a literal — vault passwords with `$` or
# backticks do not get re-evaluated by the shell. The cfg file is rm'd before
# the function returns. (Curl -K still parses the value: form/JSON bodies
# produced here contain no embedded backslashes or double-quotes in practice.)
kc_post() {  # kc_post <url> <form-data>
    local cfg; cfg=$(mktemp); chmod 600 "$cfg"
    printf 'request = "POST"\ndata = "%s"\n' "$2" > "$cfg"
    curl -sk -m 30 -K "$cfg" "$1"; local rc=$?
    rm -f "$cfg"; return $rc
}
kc_put_json() {  # kc_put_json <url> <json> <bearer> -> http code
    local cfg; cfg=$(mktemp); chmod 600 "$cfg"
    printf 'header = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\ndata = "%s"\n' "$3" "$2" > "$cfg"
    curl -sk -m 30 -o /dev/null -w '%{http_code}' -K "$cfg" -X PUT "$1"; local rc=$?
    rm -f "$cfg"; return $rc
}

master_token() { kc_post "$EVAL_KC_URL/realms/master/protocol/openid-connect/token" \
    "client_id=admin-cli&username=admin&password=$KEYCLOAK_ADMIN_PASSWORD&grant_type=password" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)["access_token"])'; }

ADMIN_TOKEN=$(master_token)
# Bootstrap trap: covers the window between ADMIN_TOKEN resolution and the
# full cleanup trap below. HDR may not exist yet — `${HDR:-/nonexistent}`
# keeps `set -u` happy and the rm is a no-op in that case.
trap 'rm -f "${HDR:-/nonexistent}" 2>/dev/null || true' EXIT INT TERM
HDR=$(mktemp); chmod 600 "$HDR"; echo "Authorization: Bearer $ADMIN_TOKEN" > "$HDR"
cleanup() {
    # HDR tempfile reclaim MUST be the first action — survives CLIENT_UUID
    # being unset, and runs even if the auth-revert curl below fails hard.
    rm -f "$HDR"
    # Trap may fire before CLIENT_UUID was resolved (early exit between trap
    # setup and the curl below). ROPC was never enabled in that case — safe no-op.
    [ -n "${CLIENT_UUID:-}" ] || return 0
    # Re-auth inside the trap: the run may have outlived the token.
    AT=$(master_token || true)
    if [ -n "$AT" ]; then
        for i in 1 2 3; do
            CODE=$(kc_put_json "$EVAL_KC_URL/admin/realms/$EVAL_KC_REALM_S/clients/$CLIENT_UUID" \
                '{"directAccessGrantsEnabled": false}' "$AT")
            if [ "$CODE" = "204" ] || [ "$CODE" = "200" ]; then
                echo "[cleanup] ROPC disabled (HTTP $CODE)"; return 0
            fi
            sleep 2
        done
    fi
    echo "FAILED to disable ROPC — DISABLE MANUALLY: $EVAL_KC_URL/admin/realms/$EVAL_KC_REALM_S/clients/$CLIENT_UUID" >&2
    exit 9
}
trap cleanup EXIT INT TERM

CLIENT_UUID=$(curl -sk -m 30 -H @"$HDR" \
    "$EVAL_KC_URL/admin/realms/$EVAL_KC_REALM_S/clients?clientId=$EVAL_KC_CLIENT_ID_S" \
    | python3 -c 'import sys,json; print(json.load(sys.stdin)[0]["id"])')
CODE=$(kc_put_json "$EVAL_KC_URL/admin/realms/$EVAL_KC_REALM_S/clients/$CLIENT_UUID" \
    '{"directAccessGrantsEnabled": true}' "$ADMIN_TOKEN")
if [ "$CODE" != "204" ] && [ "$CODE" != "200" ]; then
    echo "[setup] ROPC enable FAILED (HTTP $CODE) — aborting before a doomed run" >&2; exit 8
fi
echo "[setup] ROPC enabled on $EVAL_KC_CLIENT_ID_S (uuid=$CLIENT_UUID, HTTP $CODE)"

echo "[run] container=$CHATQNA_CONTAINER mode=$EVAL_MODE"
date
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# NOTE: run_eval.py dispatches on argv[1] — EVAL_MODE must be forwarded
# positionally by any future refactor.
python3 "$SCRIPT_DIR/../eval/run_eval.py" "$EVAL_MODE" "$GOLD" "$OUT"
RC=$?
date
echo "[run] run_eval exit=$RC (0 clean / 3 degraded / 4 empty)"
exit $RC
