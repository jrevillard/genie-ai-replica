#!/usr/bin/env bash
#
# validate.sh
# Post-deployment validation for the GenieAI AKS cluster.
# Checks that all Deployments, Pods, GPU taints, NVIDIA Device Plugin,
# Ingress Controller, and TLS termination are working correctly.
#
# Usage:
#   ./scripts/validate.sh [-n NAMESPACE]
#
# Exit codes:
#   0 — All critical checks passed
#   1 — One or more critical checks failed
#
set -euo pipefail

# ============================================================
# CONFIGURATION
# ============================================================
NAMESPACE="${NAMESPACE:-genieai}"

# ============================================================
# PARSE ARGUMENTS
# ============================================================
while [[ $# -gt 0 ]]; do
  case "$1" in
    -n|--namespace) NAMESPACE="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [-n|--namespace NAMESPACE]"
      echo ""
      echo "Options:"
      echo "  -n, --namespace   Kubernetes namespace to validate (default: genieai)"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# ============================================================
# HELPER FUNCTIONS
# ============================================================
PASS_COUNT=0
FAIL_COUNT=0
SKIP_COUNT=0

log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }

pass() {
  echo "  [PASS] $1"
  PASS_COUNT=$((PASS_COUNT + 1))
}

fail() {
  echo "  [FAIL] $1"
  FAIL_COUNT=$((FAIL_COUNT + 1))
}

skip() {
  echo "  [SKIP] $1"
  SKIP_COUNT=$((SKIP_COUNT + 1))
}

# ============================================================
# CHECK 1: All Deployments are Available
# ============================================================
check_deployments() {
  log "Check 1: Verifying all Deployments in namespace '${NAMESPACE}' are Available..."

  local unavailable
  unavailable=$(kubectl get deployments -n "$NAMESPACE" -o json | \
    jq -r '.items[] | select(.status.conditions[]? | select(.type=="Available" and .status!="True")) | .metadata.name')

  if [ -z "$unavailable" ]; then
    pass "All Deployments have Available condition = True"
  else
    fail "The following Deployments are NOT Available: ${unavailable}"
  fi
}

# ============================================================
# CHECK 2: All Pods are Running and Ready
# ============================================================
check_pods() {
  log "Check 2: Verifying all Pods in namespace '${NAMESPACE}' are Running/Ready..."

  local not_running
  not_running=$(kubectl get pods -n "$NAMESPACE" --field-selector=status.phase!=Running,status.phase!=Succeeded -o name 2>/dev/null || echo "")

  if [ -z "$not_running" ]; then
    pass "All Pods are Running or Succeeded"
  else
    fail "The following Pods are NOT Running: ${not_running}"
  fi

  # Check readiness (containers ready)
  local not_ready
  not_ready=$(kubectl get pods -n "$NAMESPACE" -o json | \
    jq -r '.items[] | select(.status.phase=="Running") | select(.status.containerStatuses[]? | select(.ready==false)) | .metadata.name' 2>/dev/null || echo "")

  if [ -z "$not_ready" ]; then
    pass "All Running Pods have Ready containers"
  else
    fail "The following Pods have containers NOT Ready: ${not_ready}"
  fi
}

# ============================================================
# CHECK 3: GPU Node Pool Taint Exists
# ============================================================
check_gpu_taint() {
  log "Check 3: Verifying GPU node pool taint (nvidia.com/gpu=present:NoSchedule)..."

  local gpu_nodes
  gpu_nodes=$(kubectl get nodes -l gpu-pool=true -o name 2>/dev/null || echo "")

  if [ -z "$gpu_nodes" ]; then
    skip "No GPU nodes present (scale-to-zero scenario)"
    return
  fi

  local nodes_without_taint
  nodes_without_taint=$(kubectl get nodes -l gpu-pool=true -o json | \
    jq -r '.items[] | select(.spec.taints == null or ([.spec.taints[] | select(.key=="nvidia.com/gpu" and .value=="present" and .effect=="NoSchedule")] | length == 0)) | .metadata.name')

  if [ -z "$nodes_without_taint" ]; then
    pass "All GPU nodes have taint nvidia.com/gpu=present:NoSchedule"
  else
    fail "GPU nodes missing taint: ${nodes_without_taint}"
  fi
}

# ============================================================
# CHECK 4: NVIDIA Device Plugin DaemonSet is Ready
# ============================================================
check_nvidia_plugin() {
  log "Check 4: Verifying NVIDIA Device Plugin DaemonSet is Ready..."

  local gpu_nodes
  gpu_nodes=$(kubectl get nodes -l gpu-pool=true -o name 2>/dev/null || echo "")

  if [ -z "$gpu_nodes" ]; then
    skip "No GPU nodes present (scale-to-zero scenario) — NVIDIA plugin check not applicable"
    return
  fi

  local ds_json
  ds_json=$(kubectl get daemonset nvidia-device-plugin -n kube-system -o json 2>/dev/null || echo "")

  if [ -z "$ds_json" ]; then
    fail "NVIDIA Device Plugin DaemonSet not found in kube-system namespace"
    return
  fi

  local desired ready
  desired=$(echo "$ds_json" | jq '.status.desiredNumberScheduled // 0')
  ready=$(echo "$ds_json" | jq '.status.numberReady // 0')

  if [ "$desired" -eq 0 ]; then
    skip "NVIDIA Device Plugin DaemonSet has 0 desired replicas"
  elif [ "$ready" -eq "$desired" ]; then
    pass "NVIDIA Device Plugin DaemonSet is Ready (${ready}/${desired} pods)"
  else
    fail "NVIDIA Device Plugin DaemonSet not fully ready (${ready}/${desired} pods)"
  fi
}

# ============================================================
# CHECK 5: Ingress Controller has External IP
# ============================================================
check_ingress_ip() {
  log "Check 5: Verifying Ingress Controller has an external IP..."

  local ingress_ip
  ingress_ip=$(kubectl get svc -n ingress-nginx ingress-nginx-controller \
    -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || echo "")

  # Also check hostname (some cloud providers use hostname instead of IP)
  if [ -z "$ingress_ip" ]; then
    ingress_ip=$(kubectl get svc -n ingress-nginx ingress-nginx-controller \
      -o jsonpath='{.status.loadBalancer.ingress[0].hostname}' 2>/dev/null || echo "")
  fi

  if [ -n "$ingress_ip" ]; then
    pass "Ingress Controller external IP/hostname: ${ingress_ip}"
    # Export for TLS check
    INGRESS_ENDPOINT="$ingress_ip"
  else
    fail "Ingress Controller has no external IP or hostname assigned"
    INGRESS_ENDPOINT=""
  fi
}

# ============================================================
# CHECK 6: TLS Termination Works
# ============================================================
check_tls() {
  log "Check 6: Verifying TLS termination on Ingress..."

  if [ -z "${INGRESS_ENDPOINT:-}" ]; then
    skip "Cannot verify TLS — no Ingress endpoint available (Check 5 failed)"
    return
  fi

  local http_code
  http_code=$(curl -k -s -o /dev/null -w "%{http_code}" --connect-timeout 10 --max-time 15 \
    "https://${INGRESS_ENDPOINT}" 2>/dev/null || echo "000")

  if [ "$http_code" = "000" ]; then
    fail "TLS termination check failed — connection to https://${INGRESS_ENDPOINT} timed out or was refused"
  elif [ "$http_code" -ge 200 ] && [ "$http_code" -lt 500 ]; then
    pass "TLS termination works (HTTP ${http_code} from https://${INGRESS_ENDPOINT})"
  else
    fail "TLS termination returned unexpected HTTP ${http_code} from https://${INGRESS_ENDPOINT}"
  fi
}

# ============================================================
# MAIN
# ============================================================
main() {
  log "=========================================="
  log "GenieAI Post-Deployment Validation"
  log "=========================================="
  log "Namespace: ${NAMESPACE}"
  log "=========================================="
  echo ""

  INGRESS_ENDPOINT=""

  check_deployments
  echo ""
  check_pods
  echo ""
  check_gpu_taint
  echo ""
  check_nvidia_plugin
  echo ""
  check_ingress_ip
  echo ""
  check_tls

  echo ""
  log "=========================================="
  log "Validation Summary"
  log "=========================================="
  echo "  PASS: ${PASS_COUNT}"
  echo "  FAIL: ${FAIL_COUNT}"
  echo "  SKIP: ${SKIP_COUNT}"
  log "=========================================="

  if [ "$FAIL_COUNT" -gt 0 ]; then
    log "RESULT: FAILED — ${FAIL_COUNT} check(s) did not pass."
    exit 1
  else
    log "RESULT: SUCCESS — All critical checks passed."
    exit 0
  fi
}

main "$@"
