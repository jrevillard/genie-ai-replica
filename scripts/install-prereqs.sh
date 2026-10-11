#!/usr/bin/env bash
# Idempotent installer for the 4 cluster operators that the genie-ai
# chart requires as cluster-wide bootstrap (NOT chart dependencies).
#
# Usage: KUBECONFIG=/path/to/kubeconfig ./scripts/install-prereqs.sh
#        (no KUBECONFIG = kubectl's current context)
#
# Operators installed:
#   - keycloak-operator 26.0.0   (namespace keycloak-system)
#   - cloudnative-pg 0.22.0      (namespace cnpg-system)
#   - kube-arangodb 1.4.5        (namespace arango-system)
#   - sealed-secrets 0.40.0      (namespace sealed-secrets)
#
# Re-running is safe: each install is gated on a `kubectl get namespace`
# + `helm list -n <ns>` check that short-circuits when the helm release
# is already present.
#
# Requires on PATH: helm, kubectl, curl. The script does NOT install
# the host tools.

set -euo pipefail

KC_OPERATOR_VERSION="${KC_OPERATOR_VERSION:-26.0.0}"
CNPG_VERSION="${CNPG_VERSION:-0.22.0}"
ARANGO_OPERATOR_VERSION="${ARANGO_OPERATOR_VERSION:-1.4.5}"
SEALED_SECRETS_VERSION="${SEALED_SECRETS_VERSION:-0.40.0}"

READY_TIMEOUT="${READY_TIMEOUT:-5m}"

c_green=$'\033[32m'
c_yellow=$'\033[33m'
c_reset=$'\033[0m'

log()  { printf '%s==>%s %s\n' "$c_green" "$c_reset" "$*"; }
warn() { printf '%sWARN%s %s\n' "$c_yellow" "$c_reset" "$*" >&2; }

require_tool() {
  if ! command -v "$1" >/dev/null 2>&1; then
    printf 'missing required tool on PATH: %s\n' "$1" >&2
    exit 1
  fi
}
require_tool helm
require_tool kubectl
require_tool curl

if ! kubectl cluster-info >/dev/null 2>&1; then
  printf 'kubectl cannot reach a cluster (context=%q). Set KUBECONFIG.\n' "${KUBECONFIG:-current}" >&2
  exit 1
fi

wait_deploy_ready() {
  local ns="$1" name="$2"
  log "wait deploy/${name} -n ${ns} Ready (timeout ${READY_TIMEOUT})"
  kubectl wait --for=condition=Available --timeout="${READY_TIMEOUT}" \
    "deploy/${name}" -n "${ns}"
}

ensure_namespace() {
  local ns="$1"
  if kubectl get namespace "${ns}" >/dev/null 2>&1; then
    return 0
  fi
  kubectl create namespace "${ns}" >/dev/null
}

install_keycloak_operator() {
  local ns="keycloak-system"
  if kubectl get namespace "${ns}" >/dev/null 2>&1 && \
     kubectl get deployment keycloak-operator-controller-manager -n "${ns}" >/dev/null 2>&1; then
    log "keycloak-operator ${KC_OPERATOR_VERSION}: already present, skip"
    return 0
  fi
  ensure_namespace "${ns}"
  # keycloak-operator publishes no Helm repo index; consume the upstream
  # operator.yaml manifest directly (versioned by the release branch tag).
  log "keycloak-operator ${KC_OPERATOR_VERSION}: install via raw manifest"
  curl -fsSL -o /tmp/keycloak-operator.yaml \
    "https://raw.githubusercontent.com/keycloak/keycloak-operator/release/${KC_OPERATOR_VERSION}/deploy/operator.yaml"
  kubectl apply -n "${ns}" -f /tmp/keycloak-operator.yaml
  rm -f /tmp/keycloak-operator.yaml
  wait_deploy_ready "${ns}" "keycloak-operator-controller-manager"
}

install_cloudnative_pg() {
  local ns="cnpg-system" release="cnpg"
  ensure_namespace "${ns}"
  if helm list -n "${ns}" -q 2>/dev/null | grep -qx "${release}"; then
    log "cloudnative-pg ${CNPG_VERSION} (release ${release}): already installed, skip"
    return 0
  fi
  log "cloudnative-pg ${CNPG_VERSION}: helm install"
  helm repo add cnpg https://cloudnative-pg.github.io/charts >/dev/null 2>&1 || true
  helm repo update >/dev/null 2>&1
  helm install "${release}" cnpg/cloudnative-pg \
    --version "${CNPG_VERSION}" \
    --namespace "${ns}" --create-namespace=false \
    --wait --timeout "${READY_TIMEOUT}"
  wait_deploy_ready "${ns}" "cnpg-cloudnative-pg"
}

install_kube_arangodb() {
  local ns="arango-system" release="kube-arangodb"
  ensure_namespace "${ns}"
  if helm list -n "${ns}" -q 2>/dev/null | grep -qx "${release}"; then
    log "kube-arangodb ${ARANGO_OPERATOR_VERSION} (release ${release}): already installed, skip"
    return 0
  fi
  log "kube-arangodb ${ARANGO_OPERATOR_VERSION}: helm install"
  helm repo add arango https://arangodb.github.io/kube-arangodb >/dev/null 2>&1 || true
  helm repo update >/dev/null 2>&1
  helm install "${release}" arango/kube-arangodb \
    --version "${ARANGO_OPERATOR_VERSION}" \
    --namespace "${ns}" --create-namespace=false \
    --wait --timeout "${READY_TIMEOUT}"
  wait_deploy_ready "${ns}" "kube-arangodb-operator"
}

install_sealed_secrets() {
  local ns="sealed-secrets"
  ensure_namespace "${ns}"
  # bitnami sealed-secrets Helm chart was archived upstream and the
  # controller image is published as a static release manifest. Install
  # the controller directly from the release tarball so the install is
  # reproducible across Helm-chart-index churn.
  if kubectl get deployment sealed-secrets-controller -n "${ns}" >/dev/null 2>&1; then
    log "sealed-secrets ${SEALED_SECRETS_VERSION}: already present, skip"
    return 0
  fi
  log "sealed-secrets ${SEALED_SECRETS_VERSION}: install via static manifest"
  curl -fsSL -o /tmp/sealed-secrets-controller.yaml \
    "https://github.com/bitnami/sealed-secrets/releases/download/v${SEALED_SECRETS_VERSION}/controller.yaml"
  kubectl apply -n "${ns}" -f /tmp/sealed-secrets-controller.yaml
  rm -f /tmp/sealed-secrets-controller.yaml
  wait_deploy_ready "${ns}" "sealed-secrets-controller"
}

main() {
  log "install 4 cluster operators (keycloak-system/cnpg-system/arango-system/sealed-secrets)"
  install_keycloak_operator
  install_cloudnative_pg
  install_kube_arangodb
  install_sealed_secrets
  log "4 operators installed; keycloak-system/cnpg-system/arango-system/sealed-secrets all Ready"
}

main "$@"
