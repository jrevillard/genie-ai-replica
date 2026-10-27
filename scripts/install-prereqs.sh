#!/usr/bin/env bash
# Idempotent installer for the 7 cluster operators that the genie-ai
# chart requires as cluster-wide bootstrap (NOT chart dependencies),
# plus the Gateway API CRDs the chart's edge tier renders.
#
# Usage: KUBECONFIG=/path/to/kubeconfig ./scripts/install-prereqs.sh [--with-grafana]
#        (no KUBECONFIG = kubectl's current context)
#        --with-grafana additionally installs grafana-operator, the
#        prerequisite for observability.grafana.enabled=true
#
# Operators installed:
#   - keycloak-operator 26.8.0   (namespace keycloak-system; Kustomize install of the official modern Quarkus-based operator; 4 CRDs in k8s.keycloak.org group)
#   - cloudnative-pg 0.22.0      (namespace cnpg-system)
#   - kube-arangodb 1.4.5        (namespace arango-system)
#   - sealed-secrets 0.40.0      (namespace sealed-secrets)
#   - cert-manager v1.18.2       (namespace cert-manager; required by the otel-operator webhooks)
#   - victoria-metrics-operator 0.68.1 (namespace vmoperator-system; reconciles the
#     chart's VLSingle/VMSingle/VTSingle/VMServiceScrape CRs — the log tier is on by default)
#   - opentelemetry-operator 0.126.0  (namespace opentelemetry-operator-system; reconciles the
#     chart's OpenTelemetryCollector CRs — collector gateway + filelog agent)
#
# CRDs installed (no operator, no namespace):
#   - the Gateway API + Envoy Gateway bundle the vendored gateway-helm
#     dependency ships — see install_gateway_api_crds below
#
# Re-running is safe: each install is gated on a `kubectl get namespace`
# + `helm list -n <ns>` check that short-circuits when the helm release
# is already present.
#
# Requires on PATH: helm, kubectl, curl. The script does NOT install
# the host tools.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

KC_OPERATOR_VERSION="${KC_OPERATOR_VERSION:-26.8.0}"
# CHART version, not the operator version: cloudnative-pg chart 0.22.0
# ships operator 1.24.0 (the two numberings diverged at 1.0). The chart
# only needs a CRD that serves `postgresql.cnpg.io/v1`, which 1.24.0 does
# — it is the combination the laptop cluster runs.
CNPG_VERSION="${CNPG_VERSION:-0.22.0}"
ARANGO_OPERATOR_VERSION="${ARANGO_OPERATOR_VERSION:-1.4.5}"
SEALED_SECRETS_VERSION="${SEALED_SECRETS_VERSION:-0.40.0}"
CERT_MANAGER_VERSION="${CERT_MANAGER_VERSION:-v1.18.2}"
# Helm CHART version of vm/victoria-metrics-operator (this chart ships
# app v0.75.0 — the version that serves VLSingle/VTSingle under
# operator.victoriametrics.com/v1, which this chart's CRs require).
VM_OPERATOR_VERSION="${VM_OPERATOR_VERSION:-0.68.1}"
OTEL_OPERATOR_VERSION="${OTEL_OPERATOR_VERSION:-0.126.0}"
# grafana-operator is a CONDITIONAL prerequisite: the chart's Grafana
# CRs are opt-in (observability.grafana.enabled, default false). Opt in
# with --with-grafana, which CI's CRD gate uses — see that job.
GRAFANA_OPERATOR_VERSION="${GRAFANA_OPERATOR_VERSION:-5.25.0}"

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
  # Pre-flight: an operator left in the upstream kustomize default
  # namespace (`keycloak`, from the pre-overlay install command) would
  # fight this one over the same CRs once both watch all namespaces.
  # Refuse rather than silently install a second one.
  if kubectl get deployment keycloak-operator -n keycloak >/dev/null 2>&1; then
    printf 'ERROR: keycloak-operator found in namespace "keycloak" (upstream default). Remove it before installing into "%s" — two watch-all operators reconcile the same CRs.\n' "${ns}" >&2
    exit 1
  fi
  if kubectl get namespace "${ns}" >/dev/null 2>&1 && \
     kubectl get deployment keycloak-operator -n "${ns}" >/dev/null 2>&1; then
    log "keycloak-operator ${KC_OPERATOR_VERSION}: already present"
  else
    ensure_namespace "${ns}"
    # Official modern Keycloak 26+ operator (Quarkus-based, v2beta1 CRDs).
    # Installed via Kustomize from keycloak/k8s-resources — NOT the archived
    # keycloak/keycloak-operator (which is WildFly-era, v1alpha1, archived
    # 2022-11-16). kustomize injects the namespace and rewires RoleBindings
    # (apply -f per-file breaks RBAC + misses 2 of the 4 CRDs).
    #
    # The upstream kustomization pins namespace `keycloak`; a local overlay
    # with a `namespace:` field overrides it (top-level wins) so every
    # namespaced object — Deployment, ServiceAccount, RoleBindings, subjects
    # included — lands in keycloak-system. One leak: the upstream
    # ClusterRoleBinding is cluster-scoped and the namespace transformer
    # does not touch its subject, so its subject is patched below — on
    # every run, not only at install.
    log "keycloak-operator ${KC_OPERATOR_VERSION}: install via Kustomize overlay (ref=${KC_OPERATOR_VERSION} of keycloak-k8s-resources, ns=${ns})"
    local overlay
    overlay=$(mktemp -d)
    cat > "${overlay}/kustomization.yaml" <<EOF
namespace: ${ns}
resources:
  - github.com/keycloak/keycloak-k8s-resources/kubernetes?ref=${KC_OPERATOR_VERSION}
EOF
    if ! kubectl apply -k "${overlay}"; then
      rm -rf "${overlay}"
      return 1
    fi
    rm -rf "${overlay}"
    wait_deploy_ready "${ns}" "keycloak-operator"
  fi
  # Everything below is idempotent and runs on EVERY invocation so
  # out-of-band drift (e.g. someone re-applies the upstream kustomization
  # bare, or a subject namespace drifts) is repaired on the next run.
  # `add`, not `replace`: on a JSON patch, `replace` fails when the
  # member is missing, while `add` on an existing object member sets it
  # and only fails when the PARENT (subjects) is absent. The operator
  # then reconciles Keycloak CRs only in its own namespace and the
  # chart's Keycloak CR in the application namespace sits unreconciled
  # — a symptom (a Keycloak pod that never becomes Ready) that points
  # nowhere near this patch.
  kubectl patch clusterrolebinding keycloak-operator-clusterrole-binding \
    --type json \
    -p "[{\"op\":\"add\",\"path\":\"/subjects/0/namespace\",\"value\":\"${ns}\"}]" \
    || warn "could not patch keycloak-operator-clusterrole-binding (absent or renamed upstream) — the operator will reconcile Keycloak CRs only in its own namespace, and the release's Keycloak CR will never become Ready"
  # The upstream kustomization ships namespaced RoleBindings only, so the
  # operator reconciles Keycloak CRs in its own namespace and ignores
  # every application namespace. GENIE.AI renders Keycloak CRs next to
  # the app (e.g. ns genieai), so promote the four per-controller
  # ClusterRoles to ClusterRoleBindings and blank the per-controller
  # namespace envs. Empty string is the JOSDK "watch all namespaces"
  # value — the literal "JOSDK_WATCH_ALL" is NOT (the operator treats
  # it as a namespace name and reconciles nothing, silently).
  for role in keycloakcontroller keycloakrealmimportcontroller \
              keycloakoidcclientcontroller keycloaksamlclientcontroller; do
    kubectl apply -f - <<EOF
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: ${role}-clusterrole-binding
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: ${role}-cluster-role
subjects:
  - kind: ServiceAccount
    name: keycloak-operator
    namespace: ${ns}
EOF
  done
  kubectl -n "${ns}" set env deploy/keycloak-operator \
    QUARKUS_OPERATOR_SDK_CONTROLLERS_KEYCLOAKCONTROLLER_NAMESPACES= \
    QUARKUS_OPERATOR_SDK_CONTROLLERS_KEYCLOAKREALMIMPORTCONTROLLER_NAMESPACES= \
    QUARKUS_OPERATOR_SDK_CONTROLLERS_KEYCLOAKSAMLCLIENTCONTROLLER_NAMESPACES= \
    QUARKUS_OPERATOR_SDK_CONTROLLERS_KEYCLOAKOIDCCLIENTCONTROLLER_NAMESPACES=
  wait_deploy_ready "${ns}" "keycloak-operator"
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
  # The chart's fullname helper mangles the release name: release
  # "kube-arangodb" renders the operator Deployment as
  # "arango-kube-arangodb-operator" (verified live on the laptop cluster).
  wait_deploy_ready "${ns}" "arango-kube-arangodb-operator"
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
  # The release manifest pins its namespaced objects to kube-system; this
  # script's convention is the sealed-secrets namespace. Rewrite before
  # applying — kubectl refuses an apply whose -n contradicts the objects
  # ("namespace from the provided object does not match").
  sed -i "s/namespace: kube-system/namespace: ${ns}/g" /tmp/sealed-secrets-controller.yaml
  kubectl apply -n "${ns}" -f /tmp/sealed-secrets-controller.yaml
  rm -f /tmp/sealed-secrets-controller.yaml
  wait_deploy_ready "${ns}" "sealed-secrets-controller"
}

install_cert_manager() {
  # Prerequisite for the otel-operator admission webhooks (the operator
  # chart issues cert-manager.io/v1 Certificates for its serving certs;
  # without cert-manager the webhook pod never becomes Ready and every
  # OpenTelemetryCollector CR write is rejected).
  local ns="cert-manager" release="cert-manager"
  ensure_namespace "${ns}"
  if helm list -n "${ns}" -q 2>/dev/null | grep -qx "${release}"; then
    log "cert-manager ${CERT_MANAGER_VERSION} (release ${release}): already installed, skip"
    return 0
  fi
  log "cert-manager ${CERT_MANAGER_VERSION}: helm install"
  helm repo add jetstack https://charts.jetstack.io >/dev/null 2>&1 || true
  helm repo update >/dev/null 2>&1
  helm install "${release}" jetstack/cert-manager \
    --version "${CERT_MANAGER_VERSION}" \
    --namespace "${ns}" --create-namespace=false \
    --set crds.enabled=true \
    --wait --timeout "${READY_TIMEOUT}"
  wait_deploy_ready "${ns}" "cert-manager"
}

install_vmoperator() {
  # Reconciles the chart's VLSingle/VMSingle/VTSingle/VMServiceScrape
  # CRs (operator.victoriametrics.com group). Required by the default
  # install: the log tier (VictoriaLogs baseline) is on by default.
  local ns="vmoperator-system" release="victoria-metrics-operator"
  ensure_namespace "${ns}"
  if helm list -n "${ns}" -q 2>/dev/null | grep -qx "${release}"; then
    log "victoria-metrics-operator ${VM_OPERATOR_VERSION} (release ${release}): already installed, skip"
    return 0
  fi
  log "victoria-metrics-operator ${VM_OPERATOR_VERSION}: helm install"
  helm repo add vm https://victoriametrics.github.io/helm-charts >/dev/null 2>&1 || true
  helm repo update >/dev/null 2>&1
  helm install "${release}" vm/victoria-metrics-operator \
    --version "${VM_OPERATOR_VERSION}" \
    --namespace "${ns}" --create-namespace=false \
    --wait --timeout "${READY_TIMEOUT}"
  wait_deploy_ready "${ns}" "victoria-metrics-operator"
}

install_otel_operator() {
  # Reconciles the chart's OpenTelemetryCollector CRs (gateway + filelog
  # agent). Depends on cert-manager (install_cert_manager runs first).
  local ns="opentelemetry-operator-system" release="opentelemetry-operator"
  ensure_namespace "${ns}"
  if helm list -n "${ns}" -q 2>/dev/null | grep -qx "${release}"; then
    log "opentelemetry-operator ${OTEL_OPERATOR_VERSION} (release ${release}): already installed, skip"
    return 0
  fi
  log "opentelemetry-operator ${OTEL_OPERATOR_VERSION}: helm install"
  helm repo add open-telemetry https://open-telemetry.github.io/opentelemetry-helm-charts >/dev/null 2>&1 || true
  helm repo update >/dev/null 2>&1
  helm install "${release}" open-telemetry/opentelemetry-operator \
    --version "${OTEL_OPERATOR_VERSION}" \
    --namespace "${ns}" --create-namespace=false \
    --wait --timeout "${READY_TIMEOUT}"
  # Chart renders the manager Deployment as plain "opentelemetry-operator"
  # (no -controller-manager suffix; verified live on the laptop cluster).
  wait_deploy_ready "${ns}" "opentelemetry-operator"
}

install_gateway_api_crds() {
  # The edge tier renders GatewayClass / Gateway / HTTPRoute
  # (gateway.networking.k8s.io). The EnvoyGateway config is a string
  # inside a ConfigMap, not a Custom Resource — no gateway.envoyproxy.io
  # CRD is needed. A `helm install` of the chart applies these CRDs
  # itself — gateway-helm ships them as a NESTED subchart
  # (`charts/crds`), which is why `helm template` does not render them
  # and why nothing else in this script (or in the cluster bootstrap of
  # a fresh install) provides them: chart:crd-validate's server-side dry
  # run failed on exactly that hole with `no matches for kind
  # "GatewayClass"`. The versioned source is the vendored dependency tgz
  # itself, so the CRDs installed here are BY CONSTRUCTION the bundle
  # the real release installs — no second version pin to drift.
  local tgz work crd missing=""
  # A glob that matches nothing is passed through literally by the
  # shell, so the `-f` test is what decides "no tarball" — `ls` on a
  # non-matching glob exits 2, and under `set -euo pipefail` that
  # aborted the whole bootstrap (exit 2, no message) before the
  # "run helm dependency update" fallback could say anything.
  tgz=""
  for candidate in "${REPO_ROOT}/charts/genieai-umbrella/charts/"gateway-helm-*.tgz; do
    if [ -f "${candidate}" ]; then
      tgz="${candidate}"
      break
    fi
  done
  if [ -z "${tgz}" ]; then
    log "gateway-helm tgz missing: helm dependency update"
    helm dependency update "${REPO_ROOT}/charts/genieai-umbrella" >/dev/null
    tgz=""
    for candidate in "${REPO_ROOT}/charts/genieai-umbrella/charts/"gateway-helm-*.tgz; do
      if [ -f "${candidate}" ]; then
        tgz="${candidate}"
        break
      fi
    done
    if [ -z "${tgz}" ]; then
      log "gateway-helm tgz still missing after 'helm dependency update' — the OCI pull to docker.io/envoyproxy failed; check network/proxy and retry"
      return 1
    fi
  fi
  # Skip only when ALL THREE kinds the chart renders are present — the
  # first CRD of the bundle alone proves nothing (a failed apply
  # mid-bundle leaves exactly that partial state behind, and the skip
  # would turn it permanent).
  for crd in \
    gatewayclasses.gateway.networking.k8s.io \
    gateways.gateway.networking.k8s.io \
    httproutes.gateway.networking.k8s.io; do
    kubectl get crd "${crd}" >/dev/null 2>&1 || missing="${missing} ${crd}"
  done
  if [ -z "${missing}" ]; then
    log "gateway-api CRDs: already installed, skip"
    return 0
  fi
  log "gateway-api CRDs: installing (missing:${missing})"
  work="$(mktemp -d)"
  tar -xzf "${tgz}" -C "${work}" gateway-helm/charts/crds/crds/gatewayapi-crds.yaml
  # Server-side apply, not plain apply: client-side apply stores the
  # whole previous object in the last-applied-configuration annotation,
  # and the Gateway API CRDs blow past its 256 KiB cap ("metadata.annotations:
  # Too long") — the documented install path for this bundle is SSA.
  kubectl apply --server-side --force-conflicts \
    -f "${work}/gateway-helm/charts/crds/crds/gatewayapi-crds.yaml" >/dev/null
  kubectl wait --for=condition=Established \
    crd/gatewayclasses.gateway.networking.k8s.io \
    crd/gateways.gateway.networking.k8s.io \
    crd/httproutes.gateway.networking.k8s.io \
    --timeout=120s >/dev/null
  rm -rf "${work}"
  log "gateway-api CRDs applied (from the vendored gateway-helm bundle)"
}

install_grafana_operator() {
  # Reconciles the chart's Grafana / GrafanaDataSource / GrafanaDashboard /
  # GrafanaAlertRuleGroup CRs (grafana.integreatly.org group). Only
  # required when observability.grafana.enabled is true.
  local ns="grafana-operator-system" release="grafana-operator"
  ensure_namespace "${ns}"
  if helm list -n "${ns}" -q 2>/dev/null | grep -qx "${release}"; then
    log "grafana-operator ${GRAFANA_OPERATOR_VERSION} (release ${release}): already installed, skip"
    return 0
  fi
  log "grafana-operator ${GRAFANA_OPERATOR_VERSION}: helm install"
  helm repo add grafana https://grafana.github.io/helm-charts >/dev/null 2>&1 || true
  helm repo update >/dev/null 2>&1
  helm install "${release}" grafana/grafana-operator \
    --version "${GRAFANA_OPERATOR_VERSION}" \
    --namespace "${ns}" --create-namespace=false \
    --wait --timeout "${READY_TIMEOUT}"
  wait_deploy_ready "${ns}" "grafana-operator"
}

main() {
  log "install 7 cluster operators (keycloak/cnpg/arango/sealed-secrets/cert-manager/vmoperator/otel-operator)"
  install_keycloak_operator
  install_cloudnative_pg
  install_kube_arangodb
  install_sealed_secrets
  install_cert_manager
  install_vmoperator
  install_otel_operator
  install_gateway_api_crds
  # grafana-operator is NOT installed by default: the chart's Grafana
  # CRs are opt-in (observability.grafana.enabled, default false). A
  # cluster enabling them opts in with --with-grafana.
  local installed="7 operators installed"
  if [[ "${1:-}" == "--with-grafana" ]]; then
    install_grafana_operator
    installed="${installed} + grafana-operator"
  else
    log "skipping grafana-operator (opt-in: --with-grafana); the chart's Grafana CRs render only when observability.grafana.enabled=true"
  fi
  log "${installed}; all namespaces Ready"
}

main "$@"
