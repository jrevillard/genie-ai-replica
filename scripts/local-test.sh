#!/usr/bin/env bash
# Local end-to-end test for the genie-ai Helm chart on minikube.
# Run from the repo root: ./scripts/local-test.sh
#
# Pre-reqs: minikube running, helm 4.x, kubectl.
# Operator prerequisites (keycloak-operator, cloudnative-pg, kube-arangodb,
# sealed-secrets) are installed cluster-wide by `./scripts/install-prereqs.sh`
# (separate script; this file assumes they are present).
#
# Teardown: `./scripts/local-teardown.sh` removes the chart release and
# `genieai` namespace only; pass `--with-operators` to also uninstall the
# cluster operators installed by install-prereqs.sh (sealed-secrets
# excepted — its key decrypts the committed SealedSecrets).

set -euo pipefail
CHART=charts/genieai-umbrella
RELEASE=test
NS=genieai
MINIKUBE_PROFILE=${MINIKUBE_PROFILE:-minikube}

# Required values — the render fails without them (deployment data, not
# chart defaults): the public hostname (may carry :port) and the realm
# admin email. Override via env for a laptop whose origin differs.
# The client secrets below are real-looking dummies: the chart rejects
# `change-me-*` placeholders.
INGRESS_HOST="${INGRESS_HOST:-local.genieai.test}"
ADMIN_EMAIL="${ADMIN_EMAIL:-admin@local.genieai.test}"

# This script installs a throwaway release on a laptop: it names no mail
# server, and a realm that verifies addresses without one never completes
# a registration. The chart defaults both mail flags to the Compose
# values (true) and refuses to render them without an smtp — so the
# script says it has no mail by turning them off, which is the case the
# chart documents for exactly this. A deployment that owns a mailbox
# names its relay in `data.keycloak.smtp` and keeps the flags on.
MAIL_FLAGS=(--set data.keycloak.verifyEmail=false --set data.keycloak.resetPasswordAllowed=false)

CLIENT_PROXY="dummy-proxy-$(date +%s)"
CLIENT_DATAPREP="dummy-dataprep-$(date +%s)"
CLIENT_GRAFANA="dummy-grafana-$(date +%s)"

echo "=== STEP 0: preflight ==="
kubectl config use-context "$MINIKUBE_PROFILE"
helm version --short

echo
echo "=== STEP 1: helm lint ==="
# charts/.gitignore excludes */charts/, so the vendored dependency
# tarballs are not in the tree after a fresh clone: without this the lint
# fails with "chart directory is missing these dependencies:
# genieai-common, gateway-helm" and then "no template
# 'genieai-common.fullname'", which reads like a chart defect. The
# Makefile's lint-umbrella target does the same via its `deps` prereq.
# NOTE: from charts/ (the chart's parent), NOT from the repo root —
# `helm dependency update genieai-umbrella` resolves the path RELATIVE to
# the working directory.
( cd "$(dirname "$CHART")" && helm dependency update genieai-umbrella >/dev/null )
helm lint "$CHART" --strict

echo
echo "=== STEP 2: helm template (dry-run render) ==="
helm template "$RELEASE" "$CHART" -n "$NS" \
  --set data.keycloak.failOnPlaceholderSecrets=false \
  --set "data.keycloak.clientSecrets.proxyClient=$CLIENT_PROXY" \
  --set "data.keycloak.clientSecrets.dataprep=$CLIENT_DATAPREP" \
  --set "data.keycloak.clientSecrets.grafana=$CLIENT_GRAFANA" \
  --set "ingress.host=$INGRESS_HOST" \
  --set "data.keycloak.adminEmail=$ADMIN_EMAIL" \
  "${MAIL_FLAGS[@]}" \
  > /tmp/genieai-rendered.yaml
echo "  rendered to /tmp/genieai-rendered.yaml ($(wc -l < /tmp/genieai-rendered.yaml) lines)"

echo
echo "=== STEP 3: helm install ==="
helm install "$RELEASE" "$CHART" -n "$NS" --create-namespace \
  --set data.keycloak.failOnPlaceholderSecrets=false \
  --set "data.keycloak.clientSecrets.proxyClient=$CLIENT_PROXY" \
  --set "data.keycloak.clientSecrets.dataprep=$CLIENT_DATAPREP" \
  --set "data.keycloak.clientSecrets.grafana=$CLIENT_GRAFANA" \
  --set "ingress.host=$INGRESS_HOST" \
  --set "data.keycloak.adminEmail=$ADMIN_EMAIL" \
  "${MAIL_FLAGS[@]}" \
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
# Deployments, not pods: Succeeded hook pods never become Ready and would
# time the wait out even on a healthy install.
kubectl wait --for=condition=Available deploy --all -n "$NS" --timeout=10m

echo
echo "=== STEP 5: helm test ==="
helm test "$RELEASE" -n "$NS" --logs

echo
echo "=== STEP 6: smoke URLs (if ingress enabled) ==="
echo "-- Keycloak OIDC discovery (in-cluster — host cannot resolve .svc DNS) --"
kubectl run kc-probe --rm -i --restart=Never --image=curlimages/curl:8.10.1 --command -- \
  curl -s -o /dev/null -w "  HTTP %{http_code}  (expect 200 or 401, NOT 000/503)\n" \
  "http://keycloak-service.${NS}.svc.cluster.local:8080/auth/realms/genie/.well-known/openid-configuration" || true

echo
echo "=== DONE ==="
echo "If anything above failed, the chart is NOT ready to merge."
echo "If everything passed: helm uninstall $RELEASE -n $NS && proceed with merge."
