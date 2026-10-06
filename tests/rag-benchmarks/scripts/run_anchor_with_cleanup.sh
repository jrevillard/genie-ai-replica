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
# G1 fix: resolve VICTORIATRACES_SVC from `docker service ls` (the real swarm
# service name carries the stack prefix + underscore, e.g.
# `genieai-el-salvador_victoriatraces` — a sed rewrite of CHATQNA_SERVICE_NAME
# silently produced `genieai-victoriatraces` with no prefix, and the in-container
# curl resolved to a non-existent DNS name with RC=6 (no error output under -s),
# so every fetch_selection errored). Prefer the env override (operators can
# pin), then ask docker — fail loud if neither resolves, never guess.
export VICTORIATRACES_SVC="${VICTORIATRACES_SVC:-$(docker service ls --format '{{.Name}}' 2>/dev/null | grep victoriatraces | head -1)}"
: "${VICTORIATRACES_SVC:?could not resolve a victoriatraces service (docker service ls) — set VICTORIATRACES_SVC explicitly}"
export GRAPH_SOURCE="${GRAPH_SOURCE:-GRAPH_TEST_SOURCE}"
export ARANGO_URL="${ARANGO_URL:-http://localhost:8529}"
export ARANGO_USER="${ARANGO_USER:-root}"

# --- curl with secrets on DISK (chmod-600 cfg), never argv ------------------
# printf %s substitutes the value as a literal — vault passwords with `$` or
# backticks do not get re-evaluated by the shell. The cfg file is rm'd before
# the function returns.
# W5: URL-encode each form value so a password like `pa+ss&wo rd` survives
# transport intact (raw `+` decodes to space in x-www-form-urlencoded).
urlencode() { python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1], safe=''))" "$1"; }
kc_post() {  # kc_post <url> <form-data>  (values encoded; keys literal ASCII)
    local cfg; cfg=$(mktemp); chmod 600 "$cfg"
    local encoded
    encoded=$(python3 -c '
import sys, urllib.parse
out = []
for p in sys.argv[1].split("&"):
    if "=" in p:
        k, v = p.split("=", 1)
        out.append(k + "=" + urllib.parse.quote(v, safe=""))
    else:
        out.append(p)
print("&".join(out))
' "$2")
    printf 'request = "POST"\ndata = "%s"\n' "$encoded" > "$cfg"
    curl -sk -m 30 -K "$cfg" "$1"; local rc=$?
    rm -f "$cfg"; return $rc
}
# W1: curl-K double-quoted strings terminate at the first unescaped `"`. A
# JSON body like `{"k":true}` contains two `"`s; naively printf'd into the cfg
# the line becomes `data = "{"k":true}"` — curl parses it as data = `{` and
# silently sends 1 byte. Escape backslashes FIRST (otherwise `\\` would double
# to `\\\\`), then quotes. curl-K then unescapes `\"` → `"` and `\\` → `\`,
# so the wire body matches the original JSON byte-for-byte.
kc_put_json() {  # kc_put_json <url> <json> <bearer> -> http code
    local cfg; cfg=$(mktemp); chmod 600 "$cfg"
    local escaped_body
    escaped_body=$(printf '%s' "$2" | sed 's/\\/\\\\/g; s/"/\\"/g')
    printf 'header = "Authorization: Bearer %s"\nheader = "Content-Type: application/json"\ndata = "%s"\n' "$3" "$escaped_body" > "$cfg"
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
            # W2: under `set -e` a transport error in the trap-prevent the
            # revert ROPC loop. || CODE=000 keeps the trap alive.
            CODE=$(kc_put_json "$EVAL_KC_URL/admin/realms/$EVAL_KC_REALM_S/clients/$CLIENT_UUID" \
                '{"directAccessGrantsEnabled": false}' "$AT") || CODE=000
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
