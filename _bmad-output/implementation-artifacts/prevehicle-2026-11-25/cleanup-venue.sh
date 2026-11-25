#!/usr/bin/env bash
# The #2170 campaign cleanup — the venue goes back to the baseline it had
# before the run, and the receipt PROVES it.
#
# What the campaign changed on the shared venue:
#   - the backend and frontend deployments (tip images + AGENT_* env);
#   - the HelmRelease (suspended, so the reconcile could not revert them);
#   - run-scoped objects (the agent-service, the observability tier, the OKF
#     tier) carrying the label e2170.genieai.io/run: "2170";
#   - the two storage PVCs the observability tier created;
#   - a dedicated Keycloak user (e2170-probe) with the realm role
#     tools-admin;
#   - the ROPC posture on the genie-app client (enabled for the mint,
#     reverted immediately — verified here again).
#
# The restore order matters: the run-scoped objects go FIRST (the release
# must not adopt them and must not fight them), then the HelmRelease is
# unsuspended and reconciled — the reconcile re-applies the chart's own
# Deployment specs, which is what puts the baseline images and the baseline
# env rows back.
#
# Usage: cleanup-venue.sh [output-file]
set -uo pipefail

OUT="${1:-/tmp/cleanup-venue.log}"
NS="${NS:-genieai}"
RUN_LABEL="e2170.genieai.io/run=2170"

exec > >(tee -a "$OUT") 2>&1
echo "=== #2170 venue cleanup ==="
date: $(date -u +%FT%TZ)

echo "--- 1. the run-scoped objects (by label)"
kubectl -n "$NS" delete deployment,service,networkpolicy,configmap,secret \
  -l "$RUN_LABEL" --ignore-not-found 2>&1 | sed 's/^/  /'
# The operator-managed CRs carry the label too, but kubectl cannot delete a
# CR by label alone across API groups — each kind is named explicitly.
for kind in opentelemetrycollectors.opentelemetry.io; do
  kubectl -n "$NS" delete "$kind" -l "$RUN_LABEL" --ignore-not-found 2>&1 | sed 's/^/  /'
done
for kind in vtsingles.operator.victoriametrics.com vmsingles.operator.victoriametrics.com vlsingles.operator.victoriametrics.com; do
  kubectl -n "$NS" delete "$kind" -l "$RUN_LABEL" --ignore-not-found 2>&1 | sed 's/^/  /'
done
for kind in grafanas.grafana.integreatly.org grafanadashboards.grafana.integreatly.org grafanadatasources.grafana.integreatly.org grafanafolders.grafana.integreatly.org grafanaalertrulegroups.grafana.integreatly.org; do
  kubectl -n "$NS" delete "$kind" -l "$RUN_LABEL" --ignore-not-found 2>&1 | sed 's/^/  /'
done

echo "--- 2. the storage PVCs this run created (the vtsingle PVC pre-existed the run — see the report)"
for pvc in vlsingle-victorialogs vmsingle-vmetrics; do
  kubectl -n "$NS" delete pvc "$pvc" --ignore-not-found 2>&1 | sed 's/^/  /'
done

echo "--- 3. the HelmRelease: unsuspend and reconcile (the chart re-applies the baseline)"
kubectl -n flux-system patch helmrelease genieai --type=merge -p '{"spec":{"suspend":false}}'
for i in $(seq 1 30); do
  ready=$(kubectl -n flux-system get helmrelease genieai -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)
  echo "  helmrelease ready=${ready}"
  [ "$ready" = "True" ] && break
  sleep 20
done
kubectl -n flux-system annotate gitrepository genieai --all --overwrite reconcile="$(date +%s)" >/dev/null 2>&1
kubectl -n flux-system annotate kustomization genieai --all --overwrite reconcile="$(date +%s)" >/dev/null 2>&1
kubectl -n flux-system annotate helmrelease genieai --overwrite reconcile="$(date +%s)" >/dev/null 2>&1
for i in $(seq 1 30); do
  ready=$(kubectl -n flux-system get helmrelease genieai -o jsonpath='{.status.conditions[?(@.type=="Ready")].status}' 2>/dev/null)
  echo "  helmrelease ready=${ready}"
  [ "$ready" = "True" ] && break
  sleep 20
done

echo "--- 4. the Keycloak probe user (and its realm role)"
VENUE_IP="${VENUE_IP:-10.42.0.240}"
VENUE_PORT="${VENUE_PORT:-4443}"
VENUE="genieai-forge.local"
kc() { curl -sk --resolve "${VENUE}:${VENUE_PORT}:${VENUE_IP}" "$@"; }
KC_ADMIN_PASSWORD="$(kubectl -n "$NS" get secret keycloak-admin-credentials -o go-template='{{ index .data "password" | base64decode }}')"
MASTER="$(kc -X POST "https://${VENUE}:${VENUE_PORT}/auth/realms/master/protocol/openid-connect/token" --data-urlencode 'grant_type=password' --data-urlencode 'client_id=admin-cli' --data-urlencode 'username=admin' --data-urlencode "password=${KC_ADMIN_PASSWORD}" | python3 -c 'import sys,json;print(json.load(sys.stdin).get("access_token",""))')"
if [ -n "$MASTER" ]; then
  USER_ID="$(kc "https://${VENUE}:${VENUE_PORT}/auth/admin/realms/genie/users?username=e2170-probe&exact=true" -H "Authorization: Bearer ${MASTER}" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if d else "")')"
  if [ -n "$USER_ID" ]; then
    kc -X DELETE "https://${VENUE}:${VENUE_PORT}/auth/admin/realms/genie/users/${USER_ID}" -H "Authorization: Bearer ${MASTER}" -o /dev/null -w "  delete user http=%{http_code}\n"
  else
    echo "  the probe user is already gone"
  fi
else
  echo "  WARN: no master token — the probe user could not be deleted"
fi

echo "--- 5. the ROPC posture (the genie-app client must refuse password grants)"
CLIENT_UUID="$(kc "https://${VENUE}:${VENUE_PORT}/auth/admin/realms/genie/clients?clientId=genie-app" -H "Authorization: Bearer ${MASTER}" | python3 -c 'import sys,json;d=json.load(sys.stdin);print(d[0]["id"] if d else "")')"
if [ -n "$CLIENT_UUID" ]; then
  kc "https://${VENUE}:${VENUE_PORT}/auth/admin/realms/genie/clients/${CLIENT_UUID}" -H "Authorization: Bearer ${MASTER}" \
    | python3 -c "import sys,json;d=json.load(sys.stdin);print('  directAccessGrantsEnabled =', d.get('directAccessGrantsEnabled'))"
fi

echo "--- 6. the receipt: what is left"
echo "  run-scoped objects (any kind, any namespace):"
kubectl get pods,deployments,services,networkpolicies,configmaps,secrets,pvc -A -l "$RUN_LABEL" 2>/dev/null | sed 's/^/    /'
kubectl get opentelemetrycollectors,vtsingles,vmsingles,vlsingles,grafanas,grafanadashboards,grafanadatasources,grafanafolders,grafanaalertrulegroups -A -l "$RUN_LABEL" 2>/dev/null | sed 's/^/    /'
echo "  the deployed images (the baseline is :main):"
kubectl -n "$NS" get deploy genieai-genieai-umbrella-backend genieai-genieai-umbrella-frontend \
  -o jsonpath='{range .items[*]}{.metadata.name}{" -> "}{.spec.template.spec.containers[0].image}{"\n"}{end}' | sed 's/^/    /'
echo "  the agent env rows (the baseline carries none):"
kubectl -n "$NS" get deploy genieai-genieai-umbrella-backend \
  -o jsonpath='{range .spec.template.spec.containers[0].env[*]}{.name}={.value}{"\n"}{end}' | grep -Ei "^AGENT_|^ENABLE_OBSERVABILITY|^OKF_ENABLED" | sed 's/^/    /'
echo "  the helmrelease:"
kubectl -n flux-system get helmrelease genieai -o jsonpath='  suspend={.spec.suspend} ready={.status.conditions[?(@.type=="Ready")].status} chart={.status.history[0].chartVersion} rev={.status.history[0].version}{"\n"}'
echo "  the port-forwards (the campaign's own):"
pgrep -af "port-forward" | sed 's/^/    /' || echo "    none"
echo "=== cleanup done ==="
