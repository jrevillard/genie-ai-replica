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
git -c user.name="Jerome Revillard" -c user.email="jerome.revillard@wanadoo.fr" commit -q -m "ops(forge): restore the baseline overlay (the E01 run's temporary venue changes)"
git push origin HEAD:main 2>&1 | tail -2

say "2. the release is unsuspended and reconciled back to main's render"
NOW=$(date -Is)
kubectl -n flux-system patch helmrelease genieai --type=merge -p '{"spec":{"suspend":false}}'
kubectl -n flux-system annotate gitrepository genie-ai-deploy reconcile.fluxcd.io/requested-at=$NOW --overwrite >/dev/null
kubectl -n flux-system annotate kustomization overlay-jrevillard-forge-dev reconcile.fluxcd.io/requested-at=$NOW --overwrite >/dev/null
sleep 20
kubectl -n flux-system annotate helmrelease genieai reconcile.fluxcd.io/requested-at=$NOW --overwrite >/dev/null
for i in $(seq 1 20); do
  st=$(kubectl -n flux-system get helmrelease genieai -o jsonpath='{.status.conditions[?(@.type=="Ready")].status} rev={.status.history[0].version}' 2>/dev/null)
  echo "  [$i] $st"
  case "$st" in True*) break;; esac
  sleep 10
done
kubectl -n flux-system get helmrelease genieai -o jsonpath='{.status.history[0].version} {.status.history[0].chartVersion} ready={.status.conditions[?(@.type=="Ready")].status}{"\n"}'
kubectl -n flux-system get configmap genieai-forge-public -o jsonpath='{.data.values\.yaml}' | grep -A 3 "traces:" | head -4

say "3. the run's observability resources are gone with the release"
kubectl -n $NS get vtsingle,opentelemetrycollector 2>&1 | head -4
kubectl -n $NS get pods 2>&1 | grep -E "vtraces|collector" || echo "  no vtraces/collector pod"

say "4. the OpenTelemetry operator (installed by this run) is removed"
helm uninstall opentelemetry-operator -n $NS 2>&1 | tail -2
kubectl delete crd instrumentations.opentelemetry.io opentelemetrycollectors.opentelemetry.io targetallocators.opentelemetry.io opampbridges.opentelemetry.io 2>&1 | tail -4

say "5. the VictoriaMetrics operator (installed by this run, CRDs untouched) is removed"
kubectl -n vmoperator-system delete -f /tmp/vmop-nocrd.yaml --ignore-not-found 2>&1 | tail -6

say "6. the agentic side (applied by this run) is removed"
kubectl -n $NS delete deployment agent-service service agent-service 2>&1 | tail -3
kubectl -n $NS delete deployment genieai-genieai-umbrella-okf-server service okf-server 2>&1 | tail -3

say "6b. the run-scoped NetworkPolicy (chatqna -> VictoriaTraces egress) is removed"
kubectl -n $NS delete networkpolicy e01-chatqna-vt-egress --ignore-not-found 2>&1 | tail -1

say "7. the run's realm changes are reverted"
export KC_ADMIN_USER=$(kubectl -n $NS get secret keycloak-admin-credentials -o jsonpath='{.data.username}' | base64 -d)
export KC_ADMIN_PWD=$(kubectl -n $NS get secret keycloak-admin-credentials -o jsonpath='{.data.password}' | base64 -d)
# the dataprep service account (the run granted it the 'admin' realm role)
SAID=${SA_ID:-e33a4dd8-0856-4cce-be37-367267dece44}
AT=$(curl -sk --resolve genieai-forge.local:4443:10.42.0.240 -X POST "https://genieai-forge.local:4443/auth/realms/master/protocol/openid-connect/token" -d client_id=admin-cli -d "username=$KC_ADMIN_USER" -d "password=$KC_ADMIN_PWD" -d grant_type=password | python3 -c "import sys,json;print(json.load(sys.stdin)['access_token'])")
# 7a. the 'admin' realm role the run granted to the dataprep service account
RID=$(curl -sk --resolve genieai-forge.local:4443:10.42.0.240 -H "Authorization: Bearer $AT" "https://genieai-forge.local:4443/auth/admin/realms/genie/roles/admin" | python3 -c "import sys,json;print(json.load(sys.stdin)['id'])")
curl -sk --resolve genieai-forge.local:4443:10.42.0.240 -X DELETE -H "Authorization: Bearer $AT" "https://genieai-forge.local:4443/auth/admin/realms/genie/users/$SAID/role-mappings/realm/$RID" -o /dev/null -w "  role removed http=%{http_code}\n"
curl -sk --resolve genieai-forge.local:4443:10.42.0.240 -H "Authorization: Bearer $AT" "https://genieai-forge.local:4443/auth/admin/realms/genie/users/$SAID/role-mappings/realm" | python3 -c "import sys,json;d=json.load(sys.stdin);print('  service account roles now:',[r['name'] for r in d] if isinstance(d,list) else d)"
# 7b. the eval user and the eval client the run created
EUID=$(curl -sk --resolve genieai-forge.local:4443:10.42.0.240 -H "Authorization: Bearer $AT" "https://genieai-forge.local:4443/auth/admin/realms/genie/users?username=e01-eval" | python3 -c "
import sys,json
d=json.load(sys.stdin); print(d[0]['id'] if d else '')")
[ -n "$EUID" ] && curl -sk --resolve genieai-forge.local:4443:10.42.0.240 -X DELETE -H "Authorization: Bearer $AT" "https://genieai-forge.local:4443/auth/admin/realms/genie/users/$EUID" -o /dev/null -w "  eval user deleted http=%{http_code}\n"
CID=$(curl -sk --resolve genieai-forge.local:4443:10.42.0.240 -H "Authorization: Bearer $AT" "https://genieai-forge.local:4443/auth/admin/realms/genie/clients?clientId=e01-eval" | python3 -c "
import sys,json
d=json.load(sys.stdin); print(d[0]['id'] if d else '')")
[ -n "$CID" ] && curl -sk --resolve genieai-forge.local:4443:10.42.0.240 -X DELETE -H "Authorization: Bearer $AT" "https://genieai-forge.local:4443/auth/admin/realms/genie/clients/$CID" -o /dev/null -w "  eval client deleted http=%{http_code}\n"

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

say "10. the proof"
kubectl -n $NS get pods 2>&1 | grep -E "agent-service|okf-server|vtraces|collector" || echo "  no run workload in the namespace"
kubectl -n $NS get deploy 2>&1 | grep -E "agent-service|okf-server" || echo "  no run deployment in the namespace"
kubectl -n $NS get networkpolicy e01-chatqna-vt-egress 2>&1 | tail -1
kubectl -n $NS get sealedsecret okf-internal-secret 2>&1 | tail -1
kubectl get crd 2>&1 | grep -i opentelemetry || echo "  no opentelemetry CRD"
kubectl -n vmoperator-system get deploy,pod 2>&1 | tail -2
kubectl -n $NS get secret 2>&1 | grep -E "okf|keycloak-proxy" || echo "  no okf/proxy secret"
helm list -A 2>&1 | grep -E "opentelemetry|vm-operator" || echo "  no run helm release"
kubectl -n flux-system get helmrelease genieai -o jsonpath='{.status.history[0].version} ready={.status.conditions[?(@.type=="Ready")].status}{"\n"}'
