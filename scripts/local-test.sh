#!/usr/bin/env bash
# Local end-to-end test for the genie-ai Helm chart on minikube.
# Run from the repo root: ./scripts/local-test.sh
#
# Pre-reqs: minikube running, helm 4.x, kubectl.
# Operator prerequisites (keycloak-operator, cloudnative-pg, kube-arangodb,
# sealed-secrets) are installed cluster-wide by `./scripts/install-prereqs.sh`
# (separate script; this file assumes they are present).

set -euo pipefail
CHART=charts/genieai-umbrella
RELEASE=test
NS=genieai
MINIKUBE_PROFILE=${MINIKUBE_PROFILE:-minikube}

# Real-looking dummy secrets (chart fails on placeholders since wave 15).
CLIENT_PROXY="dummy-proxy-$(date +%s)"
CLIENT_DATAPREP="dummy-dataprep-$(date +%s)"
CLIENT_GRAFANA="dummy-grafana-$(date +%s)"

echo "=== STEP 0: preflight ==="
kubectl config use-context "$MINIKUBE_PROFILE"
helm version --short

echo
echo "=== STEP 1: helm lint ==="
helm lint "$CHART" --strict

echo
echo "=== STEP 2: helm template (dry-run render) ==="
helm template "$RELEASE" "$CHART" -n "$NS" \
  --set data.keycloak.failOnPlaceholderSecrets=false \
  --set "data.keycloak.clientSecrets.proxyClient=$CLIENT_PROXY" \
  --set "data.keycloak.clientSecrets.dataprep=$CLIENT_DATAPREP" \
  --set "data.keycloak.clientSecrets.grafana=$CLIENT_GRAFANA" \
  > /tmp/genieai-rendered.yaml
echo "  rendered to /tmp/genieai-rendered.yaml ($(wc -l < /tmp/genieai-rendered.yaml) lines)"

echo
echo "=== STEP 3: helm install ==="
helm install "$RELEASE" "$CHART" -n "$NS" --create-namespace \
  --set data.keycloak.failOnPlaceholderSecrets=false \
  --set "data.keycloak.clientSecrets.proxyClient=$CLIENT_PROXY" \
  --set "data.keycloak.clientSecrets.dataprep=$CLIENT_DATAPREP" \
  --set "data.keycloak.clientSecrets.grafana=$CLIENT_GRAFANA" \
  --wait --timeout 10m

echo
echo "=== STEP 4: verify resources ==="
echo "-- Deployments --"
kubectl get deploy -n "$NS"
echo "-- CRs (Keycloak, ArangoDB, CNPG) --"
kubectl get keycloak,arangodb,cluster -n "$NS"
echo "-- SealedSecrets --"
kubectl get sealedsecret -n "$NS"
echo "-- Pods Ready? --"
kubectl get pods -n "$NS" -o wide
kubectl wait --for=condition=Ready pods --all -n "$NS" --timeout=10m

echo
echo "=== STEP 5: helm test ==="
helm test "$RELEASE" -n "$NS" --logs

echo
echo "=== STEP 6: smoke URLs (if ingress enabled) ==="
echo "-- Keycloak OIDC discovery --"
KC_URL="http://keycloak-service.${NS}.svc.cluster.local:8080"
curl -sk -o /dev/null -w "  HTTP %{http_code}  (expect 200 or 401, NOT 000/503)\n" \
  "${KC_URL}/auth/realms/genie/.well-known/openid-configuration" || true

echo
echo "=== DONE ==="
echo "If anything above failed, the chart is NOT ready to merge."
echo "If everything passed: helm uninstall $RELEASE -n $NS && proceed with merge."
