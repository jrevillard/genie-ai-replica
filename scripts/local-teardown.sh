#!/usr/bin/env bash
# Tear down the genie-ai chart from the current cluster context.
#
# Defaults: uninstall the chart release only (leaves the 7 cluster
# operators intact so the next install-prereqs.sh run is a no-op).
#
# Flags:
#   --with-operators   Also uninstall the operators installed by
#                      scripts/install-prereqs.sh and delete their
#                      namespaces (keycloak-system, cnpg-system,
#                      arango-system, cert-manager, vmoperator-system,
#                      opentelemetry-operator-system, plus
#                      grafana-operator-system when that script ran with
#                      --with-grafana).
#
#                      The sealed-secrets namespace is NOT in that list
#                      and never will be: the controller key it holds is
#                      the state every committed SealedSecret in
#                      genie-ai-deploy is encrypted against, and
#                      deleting it invalidates all of them. Pass
#                      --purge-sealed-secrets to remove it anyway (the
#                      key cannot be recovered; you will have to
#                      re-seal and re-commit every SealedSecret).
#
# Does NOT delete the cluster itself (minikube/kind lifetime is the
# operator's decision — use `minikube delete` / `kind delete cluster`
# separately).
#
# Usage: KUBECONFIG=/path/to/kubeconfig ./scripts/local-teardown.sh [--with-operators]

set -euo pipefail

RELEASE="${RELEASE:-}"
NS="${NS:-genieai}"
# No RELEASE given: use the single release in the namespace when there is
# exactly one. The two names this repo installs are `test` (local-test.sh)
# and `genieai` (the Flux HelmRelease) — defaulting to one of them made
# the other silently skip the uninstall and take the release record with
# the namespace.
if [ -z "${RELEASE}" ]; then
  releases="$(helm list -n "${NS}" -q 2>/dev/null || true)"
  count="$(echo "${releases}" | grep -c . || true)"
  if [ "${count}" = "1" ]; then
    RELEASE="$(echo "${releases}" | head -1)"
  elif [ "${count}" -gt 1 ]; then
    echo "ERROR: ${count} releases in namespace ${NS}: $(echo "${releases}" | tr '\n' ' ')" >&2
    echo "       pass RELEASE=<name> to pick the one to remove. Guessing was the" >&2
    echo "       bug this script already had: the other release's cluster-scoped" >&2
    echo "       objects (the Envoy Gateway mutating webhook among them) survive a" >&2
    echo "       deleted namespace, and every pod CREATE on the cluster then fails." >&2
    exit 1
  else
    RELEASE="test"
  fi
fi
WITH_OPERATORS="false"
PURGE_SEALED_SECRETS="false"

while [ $# -gt 0 ]; do
  case "$1" in
    --with-operators) WITH_OPERATORS="true" ;;
    --purge-sealed-secrets) PURGE_SEALED_SECRETS="true" ;;
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
    # KEEP_RESOURCES=true is the only way to keep the PVs: it maps to
    # helm's own --keep-resources. kubectl has no equivalent, and
    # deleting the namespace afterwards discards them either way.
    local keep=""
    if [ "${KEEP_RESOURCES:-false}" = "true" ]; then
      keep="--keep-resources"
      log "helm uninstall ${RELEASE} -n ${NS} (KEEP_RESOURCES=true: PVs are kept)"
    else
      log "helm uninstall ${RELEASE} -n ${NS}"
    fi
    helm uninstall "${RELEASE}" -n "${NS}" --wait ${keep}
  else
    warn "no helm release ${RELEASE} in namespace ${NS}; skip"
  fi
  # Namespace deletion cascades to EVERYTHING inside it: the PVCs
  # (clamav signature cache, document-repository uploads) and the
  # SealedSecret-materialized Secrets.
  #
  # `--keep-resources` is a `helm uninstall` flag, NOT a kubectl one.
  # Passing it to `kubectl delete namespace` fails with
  # `error: unknown flag: --keep-resources`, and with the error
  # swallowed by `|| true` the teardown reported success while leaving
  # the whole namespaced graph behind — so the next local-test.sh
  # install collided with the resources that were supposedly gone.
  # Keeping the PVs is `helm uninstall --keep-resources`, i.e. a flag on
  # the uninstall above, not on the namespace delete.
  if kubectl get namespace "${NS}" >/dev/null 2>&1; then
    log "kubectl delete namespace ${NS} (cascades to its PVs and Secrets)"
    if ! kubectl delete namespace "${NS}" --wait=true --timeout=2m; then
      warn "namespace ${NS} did not delete within 2m — inspect with: kubectl get ns ${NS}"
    fi
  fi
}

# Helm never garbage-collects cluster-scoped resources on uninstall: a
# hook resource is created and then forgotten, and a subchart's
# cluster-scoped object belongs to the parent release. Both survive every
# teardown, and the Envoy Gateway webhook is the expensive one:
# MutatingWebhookConfiguration/envoy-gateway-topology-injector.<release>
# is cluster-scoped admission wired to a Service INSIDE the namespace
# being torn down, so once it is left behind every pod CREATE on the
# whole cluster fails with "no endpoints available for service".
#
# Selected by Helm's own ownership labels rather than a hardcoded list,
# so it covers the dep-check ClusterRole/Binding, the gateway subchart's
# certgen ClusterRole/Binding, the topology-injector webhook, and
# whatever a future subchart adds. All of them carry
# `app.kubernetes.io/instance: <release>` + `managed-by: Helm` — the
# `meta.helm.sh/release-name` ANNOTATION is not usable here, label
# selectors cannot read annotations.
#
# NOT swept, deliberately: the GatewayClass and the two safe-upgrades
# admission policies the gateway-helm subchart installs under a FIXED,
# release-less name carry no labels at all, so no label selector can
# reach them — and deleting them would strip the shared Envoy Gateway
# installation of its class definition and upgrade protection for every
# other consumer on the cluster. They are per-cluster singletons, not
# per-release resources (the cluster-scope gate treats them the same
# way).
delete_leaked_hook_rbac() {
  local sel="app.kubernetes.io/managed-by=Helm,app.kubernetes.io/instance=${RELEASE}"
  log "removing cluster-scoped resources owned by release ${RELEASE}"
  for kind in clusterrole clusterrolebinding mutatingwebhookconfiguration validatingwebhookconfiguration; do
    local names
    names="$(kubectl get "${kind}" -l "${sel}" -o name 2>/dev/null || true)"
    if [ -n "${names}" ]; then
      # shellcheck disable=SC2086
      kubectl delete ${names} --ignore-not-found >/dev/null 2>&1 || true
      printf '    %s: %s\n' "${kind}" "$(printf '%s' "${names}" | tr '\n' ' ')"
    fi
  done
}

uninstall_operators() {
  local ns release
  # helm-managed (release names as pinned in scripts/install-prereqs.sh).
  # grafana-operator included: install-prereqs.sh --with-grafana installs
  # it, so an operator who opted in gets it torn down with the rest. The
  # release-existence check below skips it when it was never installed —
  # or when flux owns it (laptop topology: the HelmRelease recreates any
  # helm uninstall anyway, so the correct teardown there is in the deploy
  # repo).
  for ns in cnpg-system arango-system cert-manager vmoperator-system opentelemetry-operator-system grafana-operator-system; do
    case "$ns" in
      cnpg-system)             release="cnpg" ;;
      arango-system)           release="kube-arangodb" ;;
      cert-manager)            release="cert-manager" ;;
      vmoperator-system)       release="victoria-metrics-operator" ;;
      opentelemetry-operator-system) release="opentelemetry-operator" ;;
      grafana-operator-system) release="grafana-operator" ;;
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
  for ns in keycloak-system; do
    if kubectl get namespace "${ns}" >/dev/null 2>&1; then
      log "kubectl delete namespace ${ns} (waits up to 2m)"
      kubectl delete namespace "${ns}" --wait=true --timeout=2m >/dev/null 2>&1 || true
    else
      warn "namespace ${ns} not present; skip"
    fi
  done

  # sealed-secrets is NOT part of the default teardown. Its controller
  # key is the state every committed SealedSecret in genie-ai-deploy is
  # encrypted against: deleting the namespace destroys it irrecoverably
  # and every one of those manifests then fails with "no key could
  # decrypt secret", which means re-sealing and re-committing all of
  # them. An operator asking for a full teardown does not mean that.
  if [ "${PURGE_SEALED_SECRETS}" = "true" ]; then
    warn "--purge-sealed-secrets: destroying the controller key. Every committed SealedSecret in genie-ai-deploy becomes undecryptable and must be re-sealed and re-committed."
    if kubectl get namespace sealed-secrets >/dev/null 2>&1; then
      log "kubectl delete namespace sealed-secrets (waits up to 2m)"
      kubectl delete namespace sealed-secrets --wait=true --timeout=2m >/dev/null 2>&1 || true
    else
      warn "namespace sealed-secrets not present; skip"
    fi
  else
    log "keeping the sealed-secrets namespace (its key decrypts the committed SealedSecrets; --purge-sealed-secrets to remove it anyway)"
  fi
}

main() {
  log "teardown (release=${RELEASE}, namespace=${NS}, with-operators=${WITH_OPERATORS})"
  uninstall_chart
  delete_leaked_hook_rbac
  if [ "${WITH_OPERATORS}" = "true" ]; then
    uninstall_operators
  fi
  log "teardown complete"
}

main "$@"
