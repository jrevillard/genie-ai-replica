#!/usr/bin/env bash
# Tear down the genie-ai chart from the current cluster context.
#
# Defaults: uninstall the chart release only (leaves the 7 cluster
# operators intact so the next install-prereqs.sh run is a no-op).
#
# Flags:
#   --with-operators   Also uninstall the 7 operators installed by
#                      scripts/install-prereqs.sh and delete their
#                      namespaces (keycloak-system, cnpg-system,
#                      arango-system, sealed-secrets, cert-manager,
#                      vmoperator-system,
#                      opentelemetry-operator-system).
#
# Does NOT delete the cluster itself (minikube/kind lifetime is the
# operator's decision — use `minikube delete` / `kind delete cluster`
# separately).
#
# Usage: KUBECONFIG=/path/to/kubeconfig ./scripts/local-teardown.sh [--with-operators]

set -euo pipefail

RELEASE="${RELEASE:-test}"
NS="${NS:-genieai}"
WITH_OPERATORS="false"

while [ $# -gt 0 ]; do
  case "$1" in
    --with-operators) WITH_OPERATORS="true" ;;
    -h|--help)
      grep '^#' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    *)
      printf 'unknown arg: %s\n' "$1" >&2
      exit 2
      ;;
  esac
  shift
done

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

if ! kubectl cluster-info >/dev/null 2>&1; then
  printf 'kubectl cannot reach a cluster (context=%q). Set KUBECONFIG.\n' "${KUBECONFIG:-current}" >&2
  exit 1
fi

uninstall_chart() {
  if helm list -n "${NS}" -q 2>/dev/null | grep -qx "${RELEASE}"; then
    log "helm uninstall ${RELEASE} -n ${NS}"
    helm uninstall "${RELEASE}" -n "${NS}" --wait
  else
    warn "no helm release ${RELEASE} in namespace ${NS}; skip"
  fi
  if kubectl get namespace "${NS}" >/dev/null 2>&1; then
    log "kubectl delete namespace ${NS} (waits up to 2m)"
    kubectl delete namespace "${NS}" --wait=true --timeout=2m >/dev/null 2>&1 || true
  fi
}

uninstall_operators() {
  local ns release
  # helm-managed (release names as pinned in scripts/install-prereqs.sh)
  for ns in cnpg-system arango-system cert-manager vmoperator-system opentelemetry-operator-system; do
    case "$ns" in
      cnpg-system)             release="cnpg" ;;
      arango-system)           release="kube-arangodb" ;;
      cert-manager)            release="cert-manager" ;;
      vmoperator-system)       release="victoria-metrics-operator" ;;
      opentelemetry-operator-system) release="opentelemetry-operator" ;;
    esac
    if helm list -n "${ns}" -q 2>/dev/null | grep -qx "${release}"; then
      log "helm uninstall ${release} -n ${ns}"
      helm uninstall "${release}" -n "${ns}" --wait || true
    else
      warn "no helm release ${release} in ${ns}; skip"
    fi
  done

  # static-manifest operators: delete namespace only (manifests are owned
  # by their respective projects; the simplest teardown is namespace-delete
  # which cascades to every resource inside).
  for ns in keycloak-system sealed-secrets; do
    if kubectl get namespace "${ns}" >/dev/null 2>&1; then
      log "kubectl delete namespace ${ns} (waits up to 2m)"
      kubectl delete namespace "${ns}" --wait=true --timeout=2m >/dev/null 2>&1 || true
    else
      warn "namespace ${ns} not present; skip"
    fi
  done
}

main() {
  log "teardown (release=${RELEASE}, namespace=${NS}, with-operators=${WITH_OPERATORS})"
  uninstall_chart
  if [ "${WITH_OPERATORS}" = "true" ]; then
    uninstall_operators
  fi
  log "teardown complete"
}

main "$@"
