#!/usr/bin/env bash
# The #2162 FINAL A-reference measurement: validate-set → capture-a →
# reference, all through the protocol's own commands (the !1056/#2148
# method — the harness never hand-builds a row).
#
# Prereqs (kept alive for the whole measurement):
#   kubectl -n genieai port-forward svc/arangodb-single-single 8529:8529
#   kubectl -n genieai port-forward pod/keycloak-0 18082:8080
# Venue state: chatqna ENABLE_OBSERVABILITY=1 (run-scoped patch), the
# collector + VTSingle run-scoped CRs, the run-scoped egress policies.
set -euo pipefail

RUN_DIR=${RUN_DIR:?}
SET_PATH=${SET_PATH:?}
REPO=${REPO:?}
ARANGO_PWD=${ARANGO_PWD:?}

export EVAL_EXEC_BACKEND=kubectl
export EVAL_K8S_NAMESPACE=genieai
export CHATQNA_CONTAINER=chatqna
export CHATQNA_SERVICE_NAME=genieai-chatqna
export VICTORIATRACES_SVC=vtsingle-vtraces
export GRAPH_SOURCE=GRAPH_SOURCE
# The run-defining pin: the eval's default hashes `chunk_text` (the
# display-only verbatim field) while the gold identities and the retrieval
# contract live on the served `text` field — with the default this venue's
# anchor scored recall 0.0 on every gold query (see #2148's
# rejected-chunktext-field-run/ and extracted finding #2153; the default's
# real fix is that issue's scope).
export ARANGO_TEXT_FIELD=text
export ARANGO_URL=http://127.0.0.1:8529
export ARANGO_DB=_system
export ARANGO_USER=root
export ARANGO_PASSWORD="$ARANGO_PWD"
export EVAL_KC_URL=http://127.0.0.1:18082/auth
export EVAL_KC_REALM=genie
export EVAL_KC_CLIENT_ID=e01-sec-eval
export EVAL_KC_USER=e01-sec-eval
export EVAL_KC_PASSWORD=e01-sec-eval-PASS_f3a9c2d1
export TRACE_FETCH_TIMEOUT=180

echo "=== 1. validate the resolved set"
(cd "$REPO/tests/rag-benchmarks/protocol" && python3 run_protocol.py validate-set "$SET_PATH")

echo "=== 2. capture-a (the A leg's judgment inputs)"
(cd "$REPO/tests/rag-benchmarks/protocol" && python3 run_protocol.py capture-a \
  --set "$SET_PATH" --out-dir "$RUN_DIR" \
  --corpus-collection GRAPH_SOURCE --corpus-graph GRAPH --compute-fingerprint)

echo "=== 3. reference (the anchor + the manifest)"
(cd "$REPO/tests/rag-benchmarks/protocol" && python3 run_protocol.py reference \
  --set "$SET_PATH" --out-dir "$RUN_DIR" --seed 42 \
  --corpus-collection GRAPH_SOURCE --corpus-graph GRAPH --compute-fingerprint \
  --resolved-env "$RUN_DIR/resolved-env.json")

echo "=== 4. the manifest chain"
python3 - "$RUN_DIR/reference.manifest.json" <<'PYEOF'
import json, sys
m = json.load(open(sys.argv[1]))
print("manifest digest fields: corpus", m["corpus"], "\nsets:", m["sets"], "\nevaluator-instructions:", m["evaluator_instructions"]["sha256"][:16])
PYEOF
