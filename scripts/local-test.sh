#!/usr/bin/env bash
# Local end-to-end test for the genie-ai Helm chart on minikube.
# Run from the repo root: ./scripts/local-test.sh
#
# Pre-reqs: minikube running, helm 4.x, kubectl.
# Operator prerequisites (keycloak-operator, cloudnative-pg, kube-arangodb,
# sealed-secrets) are installed cluster-wide by `./scripts/install-prereqs.sh`
# (separate script; this file assumes they are present).
# The operator-provided Secrets the release mounts are created by this
# script (STEP 2b) when they are ABSENT — the chart renders none, and a
# missing one keeps the hook Jobs from starting.
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
# The whole script targets the minikube context, but switching the
# kubeconfig's current-context is a MACHINE-WIDE side effect: without
# the restore below, every other kubectl session on the laptop silently
# targets minikube afterwards — the same clobber class that made the
# Makefile run `ct install` against a throwaway KUBECONFIG.
PREV_CONTEXT="$(kubectl config current-context 2>/dev/null || true)"
restore_context() {
  if [ -n "$PREV_CONTEXT" ] && [ "$PREV_CONTEXT" != "$MINIKUBE_PROFILE" ]; then
    kubectl config use-context "$PREV_CONTEXT" >/dev/null 2>&1 || true
    echo "  kubeconfig current-context restored to '$PREV_CONTEXT'"
  fi
}
trap restore_context EXIT
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
echo "=== STEP 2b: operator-provided Secrets ==="
# The chart renders no Secret: every one below is mounted through a
# non-optional secretKeyRef, so a missing one leaves the pod in
# CreateContainerConfigError — the db-migrations and realm-convergence
# hook Jobs never start and `helm install --wait` fails on the hooks
# with a message that names a pod, not a missing Secret.
#
# Only ABSENT Secrets are created: on the laptop the SealedSecrets of
# genie-ai-deploy have already materialized the real ones, and a test
# script that overwrote them would break the running deployment.
ensure_secret() {
  local name="$1"; shift
  if kubectl get secret "$name" -n "$NS" >/dev/null 2>&1; then
    echo "  present: $name"
    return 0
  fi
  kubectl create secret generic "$name" -n "$NS" "$@" >/dev/null
  echo "  created: $name"
}

kubectl get namespace "$NS" >/dev/null 2>&1 || kubectl create namespace "$NS" >/dev/null
ensure_secret arango-root-secret \
  --from-literal=username=root --from-literal=password="local-test-password"
ensure_secret arango-jwt-secret \
  --from-literal=token="local-test-jwt-token"
ensure_secret keycloak-db-credentials \
  --from-literal=username=keycloak --from-literal=password="local-test-password"
ensure_secret keycloak-admin-credentials \
  --from-literal=username=admin --from-literal=password="local-test-admin-password"
ensure_secret translation-cache-password \
  --from-literal=password="local-test-cache-password" \
  --from-literal=TRANSLATION_CACHE_PASSWORD="local-test-cache-password"
# The convergence Job exports the realm's $(env:VAR) placeholders from
# these Secrets through the envSecrets rows STEP 3 passes — without the
# rows AND the Secrets they name, kcc's substitution fails on the import
# and the post-install hook dies, aborting `helm install --wait` at
# STEP 3 (the exact failure class the chart's render guards and the
# EMAIL_* sentinels document).
ensure_secret keycloak-proxy-client-secret \
  --from-literal=KEYCLOAK_PROXY_CLIENT_SECRET="local-test-proxy-secret"
ensure_secret kc-dataprep-client-secret \
  --from-literal=KC_DATAPREP_CLIENT_SECRET="local-test-dataprep-secret"
ensure_secret kc-grafana-client-secret \
  --from-literal=KEYCLOAK_GRAFANA_CLIENT_SECRET="local-test-grafana-secret"
ensure_secret keycloak-convergence-credentials \
  --from-literal=GENIE_ADMIN_PASSWORD="local-test-admin-password-Aa1!" \
  --from-literal=EMAIL_PASSWORD="local-test-email-password"

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
  --set data.keycloak.convergence.envSecrets[0].envVar=KC_PROXY_CLIENT_SECRET \
  --set data.keycloak.convergence.envSecrets[0].secretName=keycloak-proxy-client-secret \
  --set data.keycloak.convergence.envSecrets[0].secretKey=KEYCLOAK_PROXY_CLIENT_SECRET \
  --set data.keycloak.convergence.envSecrets[1].envVar=KC_DATAPREP_CLIENT_SECRET \
  --set data.keycloak.convergence.envSecrets[1].secretName=kc-dataprep-client-secret \
  --set data.keycloak.convergence.envSecrets[1].secretKey=KC_DATAPREP_CLIENT_SECRET \
  --set data.keycloak.convergence.envSecrets[2].envVar=KC_GRAFANA_CLIENT_SECRET \
  --set data.keycloak.convergence.envSecrets[2].secretName=kc-grafana-client-secret \
  --set data.keycloak.convergence.envSecrets[2].secretKey=KEYCLOAK_GRAFANA_CLIENT_SECRET \
  --set data.keycloak.convergence.envSecrets[3].envVar=GENIE_ADMIN_PASSWORD \
  --set data.keycloak.convergence.envSecrets[3].secretName=keycloak-convergence-credentials \
  --set data.keycloak.convergence.envSecrets[3].secretKey=GENIE_ADMIN_PASSWORD \
  --set data.keycloak.convergence.envSecrets[4].envVar=EMAIL_PASSWORD \
  --set data.keycloak.convergence.envSecrets[4].secretName=keycloak-convergence-credentials \
  --set data.keycloak.convergence.envSecrets[4].secretKey=EMAIL_PASSWORD \
  --wait --timeout 10m

echo
echo "=== STEP 4: verify resources ==="
echo "-- Deployments --"
kubectl get deploy -n "$NS"
echo "-- CRs (Keycloak, ArangoDB, CNPG) --"
kubectl get keycloak,arangodb,cluster -n "$NS"
echo "-- SealedSecrets (only when the CRD exists: this chart ships none —
-- secrets are operator-provided — and a fresh kind cluster has no
-- sealed-secrets controller installed) --"
if kubectl get crd sealedsecrets.bitnami.com >/dev/null 2>&1; then
  kubectl get sealedsecret -n "$NS" || true
else
  echo "  (sealedsecrets.bitnami.com CRD absent — nothing to list)"
fi
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
# In the chart's namespace and carrying the test component label: the
# keycloak NetworkPolicy admits only named same-namespace peers, so a
# probe run in the caller's current namespace (kubectl's default) or with
# no label times out on an enforcing CNI — HTTP 000 — and the smoke below
# would assert nothing. The failure is fatal on purpose.
kubectl run kc-probe --rm -i --restart=Never -n "$NS" \
  --labels="genieai.io/component=test" --image=curlimages/curl:8.10.1 --command -- \
  curl -sS -o /dev/null -w "  HTTP %{http_code}  (expect 200 or 401, NOT 000/503)\n" \
  "http://keycloak-service.${NS}.svc.cluster.local:8080/auth/realms/genie/.well-known/openid-configuration"

echo
echo "=== DONE ==="
echo "If anything above failed, the chart is NOT ready to merge."
echo "If everything passed: helm uninstall $RELEASE -n $NS && proceed with merge."
