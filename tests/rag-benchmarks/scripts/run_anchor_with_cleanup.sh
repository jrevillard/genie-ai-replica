#!/bin/bash
# Eval entry point: resolve deployment context → run_eval.py (direct).
#
# PORT DEVIATION vs upstream/main (sprint/plan_10_17.md §N.1 map #5): the ROPC
# block is DROPPED. Upstream's version flips Keycloak directAccessGrantsEnabled
# before the run and reverts after (exit codes 8/9) — needed only because
# upstream chatqna (Aug 2026+) enforces OIDC. OUR chatqna is v2.0.1-base:
# optional-Bearer, anonymous-in-network accepted — mutating the realm buys
# nothing. run_eval.py agrees: with EVAL_KC_URL/EVAL_KC_PASSWORD unset it sends
# no Authorization header. Upstream's script remains the reference for stacks
# with an OIDC-enforcing chatqna.
# Two smaller port fixes beyond upstream (review 10-19): (a) run_eval's exit
# code is captured via `&& RC=0 || RC=$?` so the exit-summary line actually
# prints for the documented nonzero codes 3/4 (set -e killed the script there
# before); (b) env_value strips CR and one pair of surrounding double quotes
# from .env values (Windows-edited env files carry CRLF; quoted values would
# otherwise auth-fail with the quote characters inside the password).
#
# The eval driver run_eval.py owns token refresh, retry and resume itself;
# this wrapper only (1) resolves context/secrets from the deployment .env,
# (2) runs the driver. run_eval_chunked.py is RETIRED — do not recreate it.
#
# Required env (or present in EVAL_DEPLOY_ENV, e.g. /opt/<stack>/.env):
#   ARANGO_DB, ARANGO_PASSWORD
# Optional: EVAL_MODE (anchor|dump-tuples); EVAL_KC_* only if chatqna ever
#   enforces OIDC (then use upstream's wrapper verbatim); EVAL_CHUNK_* gone —
#   see run_eval.py knobs.
# Note: EVAL_DEPLOY_ENV has NO default — pass it explicitly or export the
#   required vars above. See the EVAL_DEPLOY_ENV row in eval/RUNBOOK.md.
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

ENV_FILE="${EVAL_DEPLOY_ENV:-}"
env_value() {
    [ -n "$ENV_FILE" ] || return 1
    grep -m1 "^$1=" "$ENV_FILE" 2>/dev/null | cut -d= -f2- | tr -d '\r' | sed 's/^"\(.*\)"$/\1/'
}
: "${ARANGO_DB:=$(env_value ARANGO_DB)}"; : "${ARANGO_DB:?ARANGO_DB required}"
: "${ARANGO_PASSWORD:=$(env_value ARANGO_PASSWORD)}"
: "${ARANGO_PASSWORD:?ARANGO_PASSWORD required}"
export ARANGO_DB ARANGO_PASSWORD
export EVAL_MODE

# --- dynamic resolution (exported: run_eval.py inherits) --------------------
export CHATQNA_CONTAINER="${CHATQNA_CONTAINER:-$(docker ps --format '{{.Names}}' | grep chatqna-xeon-backend-server | head -1)}"
export CHATQNA_SERVICE_NAME="${CHATQNA_SERVICE_NAME:-genieai-chatqna}"
# G1 fix: resolve VICTORIATRACES_SVC from `docker service ls` (the real swarm
# service name carries the stack prefix + underscore, e.g.
# `<stack-prefix>_victoriatraces` — a sed rewrite of CHATQNA_SERVICE_NAME
# silently produced a no-prefix name, and the in-container curl resolved to
# a non-existent DNS name with RC=6 (no error output under -s), so every
# fetch_selection errored). Prefer the env override (operators can pin),
# then ask docker — fail loud if neither resolves, never guess.
export VICTORIATRACES_SVC="${VICTORIATRACES_SVC:-$(docker service ls --format '{{.Name}}' 2>/dev/null | grep victoriatraces | head -1)}"
: "${VICTORIATRACES_SVC:?could not resolve a victoriatraces service (docker service ls) — set VICTORIATRACES_SVC explicitly}"
export GRAPH_SOURCE="${GRAPH_SOURCE:-GRAPH_TEST_SOURCE}"
export ARANGO_URL="${ARANGO_URL:-http://localhost:8529}"
export ARANGO_USER="${ARANGO_USER:-root}"

echo "[run] container=$CHATQNA_CONTAINER mode=$EVAL_MODE"
date
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
# NOTE: run_eval.py dispatches on argv[1] — EVAL_MODE must be forwarded
# positionally by any future refactor.
python3 "$SCRIPT_DIR/../eval/run_eval.py" "$EVAL_MODE" "$GOLD" "$OUT" && RC=0 || RC=$?
date
echo "[run] run_eval exit=$RC (0 clean / 3 degraded / 4 empty)"
exit $RC
