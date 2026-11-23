#!/usr/bin/env bash
# The E01 run's restore + cleanup (issue #2118) — the run's own resources only.
#
# ORDER MATTERS:
#   1. the deploy overlay is reverted FIRST and the release is reconciled back to
#      main's render — while the OpenTelemetry operator is still installed, because
#      the chart's collector CR needs the CRD to exist while the release renders;
#   2. THEN the operators are removed (the release no longer renders their CRs);
#   3. the run-scoped workloads and the run's realm changes go;
#   4. the port-forwards go.
#
# Every step prints its own proof. The shared stack and its baseline are never
# touched beyond the values this run changed.
set -u

DEPLOY=/home/jerome/git_projects/ITU/genie-ai-deploy
NS=genieai
say() { printf '\n=== %s\n' "$*"; }

say "1. the deploy overlay returns to the baseline (main @ 57879c0)"
cd "$DEPLOY" || exit 1
git checkout 57879c076102f794ee77e9cc2165b87b57ac09b3 -- overlays/jrevillard-forge/dev/values.yaml overlays/jrevillard-forge/dev/kustomization.yaml
git diff --cached --stat
git commit -q -m "ops(forge): restore the baseline overlay (the E01 run's temporary venue changes)"
git push origin HEAD:main 2>&1 | tail -2

say "2. the release is unsuspended and reconciled back to main's render"
NOW=$(date -Is)
kubectl -n flux-system patch helmrelease genieai --type=merge -p '{"spec":{"suspend":false}}'
kubectl -n flux-system annotate gitrepository genie-ai-deploy reconcile.fluxcd.io/requested-at=$NOW --overwrite >/dev/null
kubectl -n flux-system annotate kustomization overlay-jrevillard-forge-dev reconcile.fluxcd.io/requested-at=$NOW --overwrite >/dev/null
# Wait for the ConfigMap to actually carry the reverted values BEFORE asking
# the HelmRelease to upgrade — a valuesFrom change does not trigger an
# upgrade by itself, and annotating too early upgrades with the OLD values
# (the race the first pass hit: rev 75 landed with the traces tier still on).
echo -n "  waiting for the reverted values to reach the ConfigMap: "
for i in $(seq 1 30); do
  if kubectl -n flux-system get configmap genieai-forge-public -o jsonpath='{.data.values\.yaml}' 2>/dev/null | grep -q "enabled: false" && ! kubectl -n flux-system get configmap genieai-forge-public -o jsonpath='{.data.values\.yaml}' 2>/dev/null | grep -A 2 "^traces:" | grep -q "enabled: true"; then
    echo "reverted"
    break
  fi
  echo -n "."
  sleep 5
done
NOW=$(date -Is)
kubectl -n flux-system annotate helmrelease genieai reconcile.fluxcd.io/requested-at=$NOW --overwrite >/dev/null
for i in $(seq 1 20); do
  st=$(kubectl -n flux-system get helmrelease genieai -o jsonpath='{.status.conditions[?(@.type=="Ready")].status} rev={.status.history[0].version}' 2>/dev/null)
  echo "  [$i] $st"
  case "$st" in True*) break;; esac
  sleep 10
done
kubectl -n flux-system get helmrelease genieai -o jsonpath='{.status.history[0].version} {.status.history[0].chartVersion} ready={.status.conditions[?(@.type=="Ready")].status}{"\n"}'
kubectl -n flux-system get configmap genieai-forge-public -o jsonpath='{.data.values\.yaml}' | grep -A 3 "traces:" | head -4
sleep 15

say "3. the run's observability resources are gone with the release"
kubectl -n $NS get vtsingle,opentelemetrycollector 2>&1 | head -4
# The operators are (or were) the controllers of the DERIVED workloads: once
# the CRs go, the release no longer manages the pods, and with the operators
# uninstalled nothing garbage-collects the leftovers — deleted BY HAND here.
# The vtsingle workload is a DEPLOYMENT (not a StatefulSet — the first pass's
# statefulset delete silently missed it).
kubectl -n $NS delete vtsingle vtraces --ignore-not-found 2>&1 | tail -1
kubectl -n $NS delete deployment genieai-collector-collector vtsingle-vtraces --ignore-not-found 2>&1 | tail -2
kubectl -n $NS delete service genieai-collector-collector vtsingle-vtraces --ignore-not-found 2>&1 | tail -2
sleep 5
kubectl -n $NS get pods 2>&1 | grep -E "vtraces|collector" || echo "  no vtraces/collector pod"

say "4. the OpenTelemetry operator (installed by this run) is removed"
helm uninstall opentelemetry-operator -n $NS 2>&1 | tail -2
kubectl delete crd instrumentations.opentelemetry.io opentelemetrycollectors.opentelemetry.io targetallocators.opentelemetry.io opampbridges.opentelemetry.io 2>&1 | tail -4

say "5. the VictoriaMetrics operator (installed by this run, CRDs untouched) is removed"
kubectl -n vmoperator-system delete -f /tmp/vmop-nocrd.yaml --ignore-not-found 2>&1 | tail -6

say "6. the agentic side (applied by this run) is removed"
# Deployments AND Services, separately — a combined list makes kubectl read
# "service" as a deployment name (the first pass deleted only the
# deployments and left both Services behind).
kubectl -n $NS delete deployment agent-service genieai-genieai-umbrella-okf-server --ignore-not-found 2>&1 | tail -2
kubectl -n $NS delete service agent-service okf-server --ignore-not-found 2>&1 | tail -2

say "6b. the run-scoped NetworkPolicy (chatqna -> VictoriaTraces egress) is removed"
kubectl -n $NS delete networkpolicy e01-chatqna-vt-egress --ignore-not-found 2>&1 | tail -1

say "7. the run's realm changes are reverted"
# The Keycloak endpoint rides an API-server PORT-FORWARD to the pod's plain
# HTTP port: the chart's NetworkPolicies block the laptop's direct pod-IP
# traffic (the first pass's --resolve got connection-refused), TLS lives at
# the edge (whose cert the pod IP does not carry), and a hardcoded edge pod
# IP goes stale on any reschedule.
KC_POD=$(kubectl -n $NS get pod -l app=keycloak --field-selector status.phase=Running -o jsonpath='{.items[*].metadata.name}' | awk '{print $1}')
if [ -z "$KC_POD" ]; then
  echo "REFUSED: no running keycloak pod in $NS — the realm revert (step 7) cannot run; fix the venue before re-running"
  exit 1
fi
kubectl -n $NS port-forward "pod/$KC_POD" 18081:8080 >/dev/null 2>&1 &
KCPF=$!
sleep 4
if ! kill -0 $KCPF 2>/dev/null; then
  # a prior pass's port-forward may still hold the port — kill it and retry once
  pkill -f "port-forward.*18081:8080" 2>/dev/null
  sleep 2
  kubectl -n $NS port-forward "pod/$KC_POD" 18081:8080 >/dev/null 2>&1 &
  KCPF=$!
  sleep 4
fi
if ! kill -0 $KCPF 2>/dev/null; then
  echo "REFUSED: the keycloak port-forward did not come up — the realm revert (step 7) cannot run"
  exit 1
fi
if ! kill -0 $KCPF 2>/dev/null; then
  echo "REFUSED: the keycloak port-forward did not come up — the realm revert (step 7) cannot run"
  exit 1
fi
KC="curl -s"
KCURL="http://127.0.0.1:18081"
echo "  keycloak pod $KC_POD via the port-forward on 18081"
export KC_ADMIN_USER=$(kubectl -n $NS get secret keycloak-admin-credentials -o jsonpath='{.data.username}' | base64 -d)
export KC_ADMIN_PWD=$(kubectl -n $NS get secret keycloak-admin-credentials -o jsonpath='{.data.password}' | base64 -d)
# the dataprep service account (the run granted it the 'admin' realm role)
SAID=${SA_ID:-e33a4dd8-0856-4cce-be37-367267dece44}
AT=$($KC -X POST "$KCURL/auth/realms/master/protocol/openid-connect/token" --data-urlencode "client_id=admin-cli" --data-urlencode "username=$KC_ADMIN_USER" --data-urlencode "password=$KC_ADMIN_PWD" --data-urlencode "grant_type=password" | python3 -c "import sys,json;print(json.load(sys.stdin).get('access_token',''))")
# An empty token means every realm step below would fail-cascade into
# "already absent" claims — refused here, not silently "successful". Note
# the refusal also skips the Keycloak-independent steps 8-10 (secrets,
# port-forwards, proof): run them by hand or fix the credentials first.
if [ -z "$AT" ]; then
  echo "REFUSED: could not mint the master admin token (rotated password? missing secret? special characters?) — the realm revert (step 7) AND steps 8-10 cannot run; fix the credentials before re-running"
  exit 1
fi
# 7a. the 'admin' realm role the run granted to the dataprep service account
# The per-role DELETE (/role-mappings/realm/{rid}) 404s on this Keycloak
# version even with the correct id — the collection DELETE with the role
# representation in the BODY is the supported shape.
ROLE=$($KC -H "Authorization: Bearer $AT" "$KCURL/auth/admin/realms/genie/roles/admin" | python3 -c "import sys,json;d=json.load(sys.stdin);print(d.get('id','')+' '+d.get('name',''))")
if [ -n "$ROLE" ] && [ "$ROLE" != " " ]; then
  RID=${ROLE%% *}; RNAME=${ROLE#* }
  $KC -X DELETE -H "Authorization: Bearer $AT" -H "Content-Type: application/json" \
    -d "[{\"id\":\"$RID\",\"name\":\"$RNAME\"}]" \
    "$KCURL/auth/admin/realms/genie/users/$SAID/role-mappings/realm" -o /dev/null -w "  role removed http=%{http_code}\n"
else
  # Empty role means the lookup failed OR the role is gone — the state is
  # settled authoritatively by the 7c existence gate below, never here.
  echo "  admin role not resolved (gone, or the lookup failed — verified below by the SA-mapping gate)"
fi
$KC -H "Authorization: Bearer $AT" "$KCURL/auth/admin/realms/genie/users/$SAID/role-mappings/realm" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  service account roles now:',[r['name'] for r in d] if isinstance(d,list) else d)"
# 7b. the eval user and the eval client the run created
# (EVAL_USER_ID, never EUID — EUID is a bash readonly builtin; assigning it
# fails silently and the DELETE would target the shell's numeric uid.)
EVAL_USER_ID=$($KC -H "Authorization: Bearer $AT" "$KCURL/auth/admin/realms/genie/users?username=e01-eval&exact=true" | python3 -c "
import sys,json
d=json.load(sys.stdin); print(d[0]['id'] if d else '')")
if [ -n "$EVAL_USER_ID" ]; then
  $KC -X DELETE -H "Authorization: Bearer $AT" "$KCURL/auth/admin/realms/genie/users/$EVAL_USER_ID" -o /dev/null -w "  eval user deleted http=%{http_code}\n"
else
  echo "  eval user already absent"
fi
CID=$($KC -H "Authorization: Bearer $AT" "$KCURL/auth/admin/realms/genie/clients?clientId=e01-eval&exact=true" | python3 -c "
import sys,json
d=json.load(sys.stdin); print(d[0]['id'] if d else '')")
if [ -n "$CID" ]; then
  $KC -X DELETE -H "Authorization: Bearer $AT" "$KCURL/auth/admin/realms/genie/clients/$CID" -o /dev/null -w "  eval client deleted http=%{http_code}\n"
else
  echo "  eval client already absent"
fi
# 7c. the FINAL existence gate: the three realm changes must ALL be gone, or
# the cleanup has failed. This re-query is independent of the delete steps
# above, so a Keycloak death mid-step (an empty lookup read as "already
# absent") cannot pass as success — the entities either still resolve
# (REFUSED) or they do not (verified).
# The probes speak in exit codes (the substitution captures STDOUT, and the
# python probes print nothing on any path — the code, not the output, is the
# verdict): 0 = gone, 1 = still present, 2 = the query itself failed (a dead
# Keycloak must read as UNKNOWN, never as a false "already absent" success).
rc=0
$KC -H "Authorization: Bearer $AT" "$KCURL/auth/admin/realms/genie/users/$SAID/role-mappings/realm" 2>/dev/null | python3 -c "
import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit(2)
sys.exit(2 if not isinstance(d,list) else (1 if any(r.get('name')=='admin' for r in d) else 0))" || rc=$?
case "$rc" in
  0) echo "  dataprep SA: admin role gone (verified)";;
  1) echo "REFUSED: the dataprep SA still holds the admin role — the cleanup failed; investigate before re-running"; exit 1;;
  *) echo "REFUSED: could not re-query the dataprep SA's roles (Keycloak unreachable?) — the cleanup state is UNKNOWN; investigate before re-running"; exit 1;;
esac
check_gone() {
  local what="$1" url="$2"
  local rc=0
  $KC -H "Authorization: Bearer $AT" "$url" 2>/dev/null | python3 -c "
import sys,json
try: d=json.load(sys.stdin)
except Exception: sys.exit(2)
sys.exit(2 if not isinstance(d,list) else (1 if d else 0))" || rc=$?
  case "$rc" in
    0) echo "  eval $what gone (verified)";;
    1) echo "REFUSED: the eval $what still resolve — the cleanup failed; investigate before re-running"; exit 1;;
    *) echo "REFUSED: could not re-query the eval $what (Keycloak unreachable?) — the cleanup state is UNKNOWN; investigate before re-running"; exit 1;;
  esac
}
check_gone users "$KCURL/auth/admin/realms/genie/users?username=e01-eval&exact=true"
check_gone clients "$KCURL/auth/admin/realms/genie/clients?clientId=e01-eval&exact=true"

say "8. the secrets the run restored"
# the keycloak-proxy-client-secret Secret was missing at the baseline (its
# SealedSecret was synced but the Secret had been deleted) — the baseline is
# restored by deleting it again. If the sealed-secrets controller re-syncs it,
# the proof step reports it honestly rather than claiming a clean restore.
kubectl -n $NS delete secret keycloak-proxy-client-secret 2>&1 | tail -1
# the okf-internal-secret SealedSecret the run wired into the overlay's
# kustomization (reverted in step 1) was APPLIED by this run — its absence is
# the baseline, so both the SealedSecret and its materialized Secret go.
kubectl -n $NS delete sealedsecret okf-internal-secret --ignore-not-found 2>&1 | tail -1
kubectl -n $NS delete secret okf-internal-secret --ignore-not-found 2>&1 | tail -1
sleep 5
if kubectl -n $NS get secret keycloak-proxy-client-secret >/dev/null 2>&1; then
  echo "  NOTE: keycloak-proxy-client-secret was RE-SYNCED by the sealed-secrets controller (baseline had it absent — flag in the report)"
else
  echo "  keycloak-proxy-client-secret absent (baseline restored)"
fi
kubectl -n $NS get secret 2>&1 | grep -E "okf|keycloak-proxy" || echo "  no okf/proxy secrets"

say "9. the port-forwards go"
for pf in /tmp/arango-pf.pid /tmp/chatqna-pf.pid /tmp/docrepo-pf.pid /tmp/kc-pf.pid /tmp/vt-pf.pid; do
  [ -f "$pf" ] && kill "$(cat $pf)" 2>/dev/null && echo "  killed $(basename $pf)"
done
# the script's own keycloak port-forward
kill $KCPF 2>/dev/null && echo "  killed the script's keycloak port-forward (18081)"

say "10. the proof"
kubectl -n $NS get pods 2>&1 | grep -E "agent-service|okf-server|vtraces|collector" || echo "  no run workload in the namespace"
kubectl -n $NS get deploy,svc 2>&1 | grep -E "agent-service|okf-server|collector|vtsingle" || echo "  no run deployment/service in the namespace"
kubectl -n $NS get networkpolicy e01-chatqna-vt-egress 2>&1 | tail -1
kubectl -n $NS get sealedsecret okf-internal-secret 2>&1 | tail -1
kubectl get crd 2>&1 | grep -i opentelemetry || echo "  no opentelemetry CRD"
kubectl -n vmoperator-system get deploy,pod 2>&1 | tail -2
kubectl -n $NS get secret 2>&1 | grep -E "okf|keycloak-proxy" || echo "  no okf/proxy secret"
helm list -A 2>&1 | grep -E "opentelemetry|vm-operator" || echo "  no run helm release"
kubectl -n flux-system get helmrelease genieai -o jsonpath='{.status.history[0].version} ready={.status.conditions[?(@.type=="Ready")].status}{"\n"}'
