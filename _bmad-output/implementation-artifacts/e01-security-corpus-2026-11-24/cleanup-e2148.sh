#!/usr/bin/env bash
# The #2148 run's restore + cleanup — the run's own resources only, with the
# proof printed after each step. ORDER MATTERS: the measurements stop before
# anything is torn down; the realm entities and the run-scoped observability
# objects go last (nothing depends on them once the captures are on disk).
set -uo pipefail

EDGE_IP=${EDGE_IP:-10.42.0.240}
STATE=${STATE:?set STATE to the run dir}
LEDGER="$STATE/ingestion-ledger.json"

say() { printf '\n=== %s\n' "$*"; }

KCURL="${KCURL:-http://127.0.0.1:18082}"
BEARER=$(curl -s -X POST "$KCURL/auth/realms/genie/protocol/openid-connect/token" \
  -d "client_id=e01-sec-eval" -d "grant_type=password" \
  --data-urlencode "username=e01-sec-eval" --data-urlencode "password=e01-sec-eval-PASS_f3a9c2d1" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))")
[ -n "$BEARER" ] || { echo "REFUSED: no bearer — the doc-repo deletes cannot run"; exit 1; }

say "1. retract + delete the 7 ingested files (retract MUST hit the graph the file was ingested into; the doc-repo DELETE refuses an ingested file, so every file retracts first)"
for key in doc-restricted-e01 doc-shared-e01 doc-wide-e01 doc-revoked-e01 doc-forestry-e01 doc-catalogue-e01 doc-servicerequest-e01; do
  FID=$(python3 -c "import json;print(json.load(open('$LEDGER'))['uploads']['$key'])")
  GRAPH="GRAPH_RESTRICTED_E01"
  case "$key" in *catalogue*|*servicerequest*) GRAPH="";; esac
  # retract via dataprep — WITH the graph name for the restricted five
  # (G5: wrong-graph retract), WITHOUT one for the legacy two (the payload's
  # None falls back to the env default graph). The doc-repo DELETE below
  # 409s on an ingested file, so this retract is load-bearing for BOTH groups.
  PAYLOAD=$(python3 -c "import json;print(json.dumps({'fileId': '$FID', 'graphName': '$GRAPH' or None}))")
  B64=$(printf %s "$PAYLOAD" | base64 -w0)
  RC=$(kubectl -n genieai exec -i deploy/genieai-genieai-umbrella-dataprep -- \
    sh -c "printf %s '$B64' | base64 -d > /tmp/e2148-retract.json && curl -s -o /tmp/e2148-retract-resp.json -w '%{http_code}' -X POST http://127.0.0.1:5000/v1/dataprep/retract_file -H 'Content-Type: application/json' -d @/tmp/e2148-retract.json")
  RESP=$(kubectl -n genieai exec deploy/genieai-genieai-umbrella-dataprep -- \
    sh -c "head -c 150 /tmp/e2148-retract-resp.json 2>/dev/null; echo" | tr -d '\n')
  echo "  $key ($FID): dataprep retract (graph ${GRAPH:-default}) http=$RC -> $RESP"
  case "$RC" in
    200|404) ;;  # 404 = nothing to retract (already gone) — fine
    *) echo "REFUSED: retract of $key answered http=$RC — the DELETE would 409 and leak the chunks"; exit 1;;
  esac
  # the doc-repo DELETE removes the files doc + bytes
  CODE=$(curl -sk --resolve genieai-forge.local:4443:$EDGE_IP -X DELETE \
    "https://genieai-forge.local:4443/api/files/$FID" -H "Authorization: Bearer $BEARER" -o /tmp/e2148-del-$key.json -w "%{http_code}")
  echo "  $key ($FID): doc-repo delete http=$CODE"
done

say "2. the restricted graph's leftover state (dataprep retract removes its chunks; verify)"
ARANGO_PWD=$(kubectl -n genieai get secret arango-root-secret -o jsonpath='{.data.password}' | base64 -d)
AQL_COUNT=$(curl -s -u "root:$ARANGO_PWD" -X POST "http://127.0.0.1:8529/_db/_system/_api/cursor" \
  -H "Content-Type: application/json" \
  -d '{"query": "RETURN LENGTH(FOR c IN GRAPH_RESTRICTED_E01_SOURCE COLLECT WITH COUNT INTO n RETURN n)"}' \
  | python3 -c "import sys,json
try: print(json.load(sys.stdin)['result'][0])
except Exception: print('COLLECTION_GONE')")
echo "  GRAPH_RESTRICTED_E01_SOURCE chunks after retract: $AQL_COUNT (expect 0 or COLLECTION_GONE)"

say "3. chatqna env restored to the baseline (ENABLE_OBSERVABILITY=0)"
kubectl -n genieai set env deploy/genieai-genieai-umbrella-chatqna ENABLE_OBSERVABILITY=0 >/dev/null
kubectl -n genieai rollout status deploy/genieai-genieai-umbrella-chatqna --timeout=180s
kubectl -n genieai exec deploy/genieai-genieai-umbrella-chatqna -- env | grep ENABLE_OBSERVABILITY

say "4. the run-scoped observability objects go (ONLY after the ownership guard: these names are the chart's own observability names — deleting them on a venue whose baseline has the tier ON would destroy Helm-owned objects)"
TIER_STATE=$(kubectl -n flux-system get configmap genieai-forge-public -o jsonpath='{.data.values\.yaml}' | python3 -c "
import sys, yaml
v = yaml.safe_load(sys.stdin)
obs = v.get('observability', {})
flags = [obs.get(k, {}).get('enabled', False) if isinstance(obs.get(k), dict) else False for k in ('traces', 'metrics', 'logs', 'grafana')]
print('baseline-off' if not any(flags) else 'SOMETHING-ON:' + repr(flags))
")
echo "  overlay tier state: $TIER_STATE"
case "$TIER_STATE" in
  baseline-off) echo "  guard ok: the baseline renders no observability objects — the same-named CRs are this run's";;
  *) echo "REFUSED: the overlay's observability is not all-off — the same-named collector/VT objects may be Helm-owned baseline; investigate before deleting"; exit 1;;
esac
kubectl -n genieai delete networkpolicy e2148-chatqna-vt-egress --ignore-not-found
kubectl -n genieai delete opentelemetrycollector genieai-collector --ignore-not-found
kubectl -n genieai delete networkpolicy collector-gateway --ignore-not-found
# the collector workload is operator-derived: the CR deletion cascades the
# Deployment; the VT workload (vm-operator-derived) goes with its CR.
kubectl -n genieai delete vtsingle vtraces --ignore-not-found
command sleep 8
kubectl -n genieai delete deployment genieai-collector-collector vtsingle-vtraces --ignore-not-found 2>&1 | tail -2
kubectl -n genieai delete service genieai-collector-collector genieai-collector-collector-extension genieai-collector-collector-headless genieai-collector-collector-monitoring vtsingle-vtraces --ignore-not-found 2>&1 | tail -2
command sleep 5
kubectl -n genieai get pods 2>&1 | grep -E "collector|vtraces" || echo "  no collector/vtraces pod"

say "5. the wheel side-install disappears with any dataprep pod restart — force the honest state"
kubectl -n genieai delete pod -l genieai.io/component=dataprep --wait=false 2>&1 | tail -1
kubectl -n genieai rollout status deploy/genieai-genieai-umbrella-dataprep --timeout=240s

say "6. the realm entities go"
KC_ADMIN_USER=$(kubectl -n genieai get secret keycloak-admin-credentials -o jsonpath='{.data.username}' | base64 -d)
KC_ADMIN_PWD=$(kubectl -n genieai get secret keycloak-admin-credentials -o jsonpath='{.data.password}' | base64 -d)
AT=$(curl -s -X POST "$KCURL/auth/realms/master/protocol/openid-connect/token" \
  --data-urlencode "client_id=admin-cli" --data-urlencode "username=$KC_ADMIN_USER" \
  --data-urlencode "password=$KC_ADMIN_PWD" --data-urlencode "grant_type=password" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))")
[ -n "$AT" ] || { echo "REFUSED: no master admin token — realm revert cannot run"; exit 1; }
for what in users clients; do
  case $what in users) URL="users?username=e01-sec-eval&exact=true";; clients) URL="clients?clientId=e01-sec-eval&exact=true";; esac
  ID=$(curl -s -H "Authorization: Bearer $AT" "$KCURL/auth/admin/realms/genie/$URL" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d[0]['id'] if d else '')")
  if [ -n "$ID" ]; then
    curl -s -X DELETE -H "Authorization: Bearer $AT" "$KCURL/auth/admin/realms/genie/$what/$ID" -o /dev/null -w "  e01-sec-eval $what deleted http=%{http_code}\n"
  else
    echo "  e01-sec-eval $what already absent"
  fi
done
# the 7c-style existence gate
for what in users clients; do
  case $what in users) URL="users?username=e01-sec-eval&exact=true";; clients) URL="clients?clientId=e01-sec-eval&exact=true";; esac
  N=$(curl -s -H "Authorization: Bearer $AT" "$KCURL/auth/admin/realms/genie/$URL" | python3 -c "import sys,json
try: d=json.load(sys.stdin); print(len(d) if isinstance(d, list) else -1)
except Exception: print(-2)")
  case "$N" in
    0) echo "  e01-sec-eval $what gone (verified)";;
    *) echo "REFUSED: e01-sec-eval $what still resolves (n=$N) — investigate"; exit 1;;
  esac
done

say "7. the port-forwards go"
for pf in /tmp/e2148-pf-*.pid; do
  [ -f "$pf" ] && kill "$(cat $pf)" 2>/dev/null && echo "  killed $(basename $pf)"
done
pkill -f "port-forward.*pod/keycloak-0 18082:8080" 2>/dev/null && echo "  killed the run's keycloak port-forward (18082)" || echo "  no 18082 listener"

say "8. the proof"
echo "--- GRAPH_SOURCE back to the 3-chunk baseline:"
curl -s -u "root:$ARANGO_PWD" -X POST "http://127.0.0.1:8529/_db/_system/_api/cursor" \
  -H "Content-Type: application/json" \
  -d '{"query": "FOR c IN GRAPH_SOURCE COLLECT file_id = c.file_id INTO g RETURN {file_id: file_id, chunks: LENGTH(g)}"}'
echo
echo "--- graphs:"
curl -s -u "root:$ARANGO_PWD" -X POST "http://127.0.0.1:8529/_db/_system/_api/gharial" | python3 -c "import sys,json;print([g['_key'] for g in json.load(sys.stdin).get('graphs', [])])"
echo "--- no run workload:"
kubectl -n genieai get deploy,svc,networkpolicy,opentelemetrycollector,vtsingle 2>&1 | grep -E "collector|vtraces|e2148" || echo "  clean"
echo "--- HelmRelease still at the baseline render:"
kubectl -n flux-system get helmrelease genieai -o jsonpath='{.status.history[0].version} ready={.status.conditions[?(@.type=="Ready")].status}{"\n"}'
kubectl -n flux-system get configmap genieai-forge-public -o jsonpath='{.data.values\.yaml}' | grep -A1 "^  traces:"
echo "--- realm clean: (the two gates above printed gone/verified)"
