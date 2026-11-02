#!/usr/bin/env bash
#
# deploy.sh
# Deploys the GenieAI Helm chart to an AKS cluster with lint, dry-run validation,
# and automatic rollback on failure.
#
# Usage:
#   ./scripts/deploy.sh -e <environment> -c <cluster> -g <resource-group> [-n <namespace>]
#
# Parameters:
#   -e, --environment   Environment: dev, staging, or prod (required)
#   -n, --namespace     Kubernetes namespace (default: genieai)
#   -c, --cluster       AKS cluster name (required)
#   -g, --resource-group Azure resource group (required)
#
# Prerequisites:
#   - Azure CLI (az) installed and logged in
#   - Helm 3 installed
#   - kubectl installed
#
# Requirements: 8.4, 8.5, 8.7, 8.8
#
set -euo pipefail

# ============================================================
# DEFAULTS
# ============================================================
ENVIRONMENT=""
NAMESPACE="genieai"
CLUSTER=""
RESOURCE_GROUP=""
RELEASE_NAME="genieai"
CHART_PATH="helm/genieai"
DEPLOY_TIMEOUT="300s"
ROLLBACK_TIMEOUT="120s"

# ============================================================
# HELPER FUNCTIONS
# ============================================================
log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
err() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] [ERROR] $*" >&2; }

usage() {
  cat <<EOF
Usage: $0 -e <environment> -c <cluster> -g <resource-group> [-n <namespace>]

Parameters:
  -e, --environment    Environment: dev, staging, or prod (required)
  -n, --namespace      Kubernetes namespace (default: genieai)
  -c, --cluster        AKS cluster name (required)
  -g, --resource-group Azure resource group (required)
  -h, --help           Show this help message

Examples:
  $0 -e dev -c aks-genieai-dev -g rg-genieai-dev
  $0 --environment prod --cluster aks-genieai-prod --resource-group rg-genieai-prod --namespace genieai
EOF
  exit 1
}

# ============================================================
# PARSE ARGUMENTS
# ============================================================
while [[ $# -gt 0 ]]; do
  case "$1" in
    -e|--environment)   ENVIRONMENT="$2"; shift 2 ;;
    -n|--namespace)     NAMESPACE="$2"; shift 2 ;;
    -c|--cluster)       CLUSTER="$2"; shift 2 ;;
    -g|--resource-group) RESOURCE_GROUP="$2"; shift 2 ;;
    -h|--help)          usage ;;
    *) err "Unknown option: $1"; usage ;;
  esac
done

# ============================================================
# VALIDATE ARGUMENTS
# ============================================================
validate_args() {
  local errors=0

  if [[ -z "$ENVIRONMENT" ]]; then
    err "Environment is required (-e/--environment)"
    errors=$((errors + 1))
  elif [[ "$ENVIRONMENT" != "dev" && "$ENVIRONMENT" != "staging" && "$ENVIRONMENT" != "prod" ]]; then
    err "Environment must be one of: dev, staging, prod (got: $ENVIRONMENT)"
    errors=$((errors + 1))
  fi

  if [[ -z "$CLUSTER" ]]; then
    err "Cluster name is required (-c/--cluster)"
    errors=$((errors + 1))
  fi

  if [[ -z "$RESOURCE_GROUP" ]]; then
    err "Resource group is required (-g/--resource-group)"
    errors=$((errors + 1))
  fi

  if [[ $errors -gt 0 ]]; then
    echo ""
    usage
  fi
}

# ============================================================
# PREREQUISITE CHECKS
# ============================================================
check_prerequisites() {
  log "Checking prerequisites..."

  if ! command -v az &>/dev/null; then
    err "Azure CLI (az) not found. Install from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
  fi

  if ! command -v helm &>/dev/null; then
    err "Helm not found. Install from: https://helm.sh/docs/intro/install/"
    exit 1
  fi

  if ! command -v kubectl &>/dev/null; then
    err "kubectl not found. Install from: https://kubernetes.io/docs/tasks/tools/"
    exit 1
  fi

  if [[ ! -d "$CHART_PATH" ]]; then
    err "Helm chart not found at '$CHART_PATH'. Run this script from the repository root."
    exit 1
  fi

  local values_file="${CHART_PATH}/values-${ENVIRONMENT}.yaml"
  if [[ ! -f "$values_file" ]]; then
    err "Values file not found: $values_file"
    exit 1
  fi
}

# ============================================================
# STEP 1: CONNECT TO AKS CLUSTER
# ============================================================
connect_cluster() {
  log "Connecting to AKS cluster '${CLUSTER}' in resource group '${RESOURCE_GROUP}'..."
  if ! az aks get-credentials --resource-group "$RESOURCE_GROUP" --name "$CLUSTER" --overwrite-existing; then
    err "Failed to connect to AKS cluster '${CLUSTER}'. Verify cluster name and resource group."
    exit 1
  fi
  log "Successfully connected to cluster '${CLUSTER}'."
}

# ============================================================
# STEP 2: HELM LINT
# ============================================================
helm_lint() {
  log "Running helm lint on '${CHART_PATH}'..."
  if ! helm lint "$CHART_PATH"; then
    err "Helm lint failed. Fix chart issues before deploying."
    exit 1
  fi
  log "Helm lint passed."
}

# ============================================================
# STEP 3: DRY-RUN VALIDATION (helm template --validate)
# ============================================================
helm_dry_run() {
  log "Running dry-run validation (helm template --validate)..."
  local values_file="${CHART_PATH}/values-${ENVIRONMENT}.yaml"

  if ! helm template "$RELEASE_NAME" "$CHART_PATH" \
    -f "${CHART_PATH}/values.yaml" \
    -f "$values_file" \
    --namespace "$NAMESPACE" \
    --validate > /dev/null; then
    err "Dry-run validation failed for environment '${ENVIRONMENT}'."
    err "The rendered manifests contain schema violations or reference undefined resources."
    err "Fix the chart templates or values and retry."
    exit 1
  fi
  log "Dry-run validation passed."
}

# ============================================================
# STEP 4: DEPLOY (helm upgrade --install)
# ============================================================
helm_deploy() {
  log "Deploying '${RELEASE_NAME}' to namespace '${NAMESPACE}' (environment: ${ENVIRONMENT})..."
  local values_file="${CHART_PATH}/values-${ENVIRONMENT}.yaml"

  if helm upgrade --install "$RELEASE_NAME" "$CHART_PATH" \
    -f "${CHART_PATH}/values.yaml" \
    -f "$values_file" \
    --namespace "$NAMESPACE" \
    --create-namespace \
    --wait \
    --timeout "$DEPLOY_TIMEOUT"; then
    log "Deployment of '${RELEASE_NAME}' succeeded."
    return 0
  else
    err "Deployment of '${RELEASE_NAME}' failed (did not reach ready state within ${DEPLOY_TIMEOUT})."
    return 1
  fi
}

# ============================================================
# STEP 5: ROLLBACK ON FAILURE
# ============================================================
helm_rollback() {
  log "Initiating rollback of '${RELEASE_NAME}' to previous revision..."

  if helm rollback "$RELEASE_NAME" 0 \
    --namespace "$NAMESPACE" \
    --wait \
    --timeout "$ROLLBACK_TIMEOUT"; then
    log "Rollback of '${RELEASE_NAME}' succeeded. Previous revision restored."
    return 0
  else
    err "Rollback of '${RELEASE_NAME}' failed within ${ROLLBACK_TIMEOUT}."
    err "Cluster state preserved for manual investigation."
    err "Deployment: ${RELEASE_NAME}"
    err "Namespace: ${NAMESPACE}"
    err "Cluster: ${CLUSTER}"
    err "Run 'helm history ${RELEASE_NAME} -n ${NAMESPACE}' to inspect revisions."
    err "Run 'kubectl get pods -n ${NAMESPACE}' to check pod status."
    return 1
  fi
}

# ============================================================
# MAIN
# ============================================================
main() {
  validate_args

  log "=========================================="
  log "GenieAI Helm Deployment"
  log "=========================================="
  log "Environment:    ${ENVIRONMENT}"
  log "Namespace:      ${NAMESPACE}"
  log "Cluster:        ${CLUSTER}"
  log "Resource Group: ${RESOURCE_GROUP}"
  log "Release:        ${RELEASE_NAME}"
  log "Chart:          ${CHART_PATH}"
  log "Timeout:        ${DEPLOY_TIMEOUT}"
  log "=========================================="

  check_prerequisites
  connect_cluster
  helm_lint
  helm_dry_run

  if helm_deploy; then
    log "=========================================="
    log "Deployment complete!"
    log "=========================================="
    log ""
    log "Next steps:"
    log "  - Validate: ./scripts/validate.sh -e ${ENVIRONMENT} -c ${CLUSTER} -g ${RESOURCE_GROUP}"
    log "  - Check pods: kubectl get pods -n ${NAMESPACE}"
    log "  - Check services: kubectl get svc -n ${NAMESPACE}"
    exit 0
  else
    log "Deployment failed. Attempting rollback..."
    if helm_rollback; then
      err "Deployment failed but rollback succeeded. Previous revision is active."
      exit 1
    else
      err "CRITICAL: Both deployment and rollback failed."
      err "Manual intervention required. Cluster state has been preserved."
      exit 1
    fi
  fi
}

main "$@"
