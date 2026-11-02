#!/usr/bin/env bash
#
# provision-aks-cluster.sh
# Provisions an AKS cluster with GPU and CPU node pools for the GenieAI MVP.
#
# Usage:
#   ./provision-aks-cluster.sh [--env dev|staging|prod] [--dry-run]
#
# Prerequisites:
#   - Azure CLI (az) installed and logged in
#   - Sufficient quota for NC-series VMs in the target region
#   - Contributor role on the target resource group
#
set -euo pipefail

# ============================================================
# CONFIGURATION — override via environment variables or flags
# ============================================================

# General
ENVIRONMENT="${ENVIRONMENT:-dev}"
RESOURCE_GROUP="${RESOURCE_GROUP:-}"
LOCATION="${LOCATION:-eastus}"
CLUSTER_NAME="${CLUSTER_NAME:-}"
K8S_VERSION="${K8S_VERSION:-1.29}"
NAMESPACE="${NAMESPACE:-genieai}"

# Networking
VNET_NAME="${VNET_NAME:-vnet-genieai-${ENVIRONMENT}}"
VNET_CIDR="${VNET_CIDR:-10.0.0.0/16}"
SUBNET_NAME="${SUBNET_NAME:-snet-aks-${ENVIRONMENT}}"
SUBNET_CIDR="${SUBNET_CIDR:-10.0.0.0/20}"
NETWORK_PLUGIN="${NETWORK_PLUGIN:-azure}"
NETWORK_POLICY="${NETWORK_POLICY:-azure}"

# CPU Node Pool (system + workload)
CPU_POOL_NAME="${CPU_POOL_NAME:-cpupool}"
CPU_POOL_VM_SIZE="${CPU_POOL_VM_SIZE:-Standard_D8s_v5}"
CPU_POOL_MIN_COUNT="${CPU_POOL_MIN_COUNT:-2}"
CPU_POOL_MAX_COUNT="${CPU_POOL_MAX_COUNT:-5}"
CPU_POOL_NODE_COUNT="${CPU_POOL_NODE_COUNT:-2}"
CPU_POOL_OS_DISK_SIZE="${CPU_POOL_OS_DISK_SIZE:-128}"

# GPU Node Pool
GPU_POOL_NAME="${GPU_POOL_NAME:-gpupool}"
GPU_POOL_VM_SIZE="${GPU_POOL_VM_SIZE:-Standard_NC4as_T4_v3}"
GPU_POOL_MIN_COUNT="${GPU_POOL_MIN_COUNT:-0}"
GPU_POOL_MAX_COUNT="${GPU_POOL_MAX_COUNT:-2}"
GPU_POOL_NODE_COUNT="${GPU_POOL_NODE_COUNT:-0}"
GPU_POOL_OS_DISK_SIZE="${GPU_POOL_OS_DISK_SIZE:-128}"
GPU_TAINT="${GPU_TAINT:-nvidia.com/gpu=present:NoSchedule}"

# Identity & Security
IDENTITY_TYPE="${IDENTITY_TYPE:-SystemAssigned}"
KEY_VAULT_NAME="${KEY_VAULT_NAME:-kv-genieai-${ENVIRONMENT}}"

# Flags
DRY_RUN=false

# ============================================================
# PARSE ARGUMENTS
# ============================================================
while [[ $# -gt 0 ]]; do
  case "$1" in
    --env)       ENVIRONMENT="$2"; shift 2 ;;
    --dry-run)   DRY_RUN=true; shift ;;
    --location)  LOCATION="$2"; shift 2 ;;
    --rg)        RESOURCE_GROUP="$2"; shift 2 ;;
    --cluster)   CLUSTER_NAME="$2"; shift 2 ;;
    --help|-h)
      echo "Usage: $0 [--env dev|staging|prod] [--dry-run] [--location REGION] [--rg RESOURCE_GROUP] [--cluster NAME]"
      exit 0
      ;;
    *) echo "Unknown option: $1"; exit 1 ;;
  esac
done

# Recompute derived names after argument parsing
RESOURCE_GROUP="${RESOURCE_GROUP:-rg-genieai-${ENVIRONMENT}}"
CLUSTER_NAME="${CLUSTER_NAME:-aks-genieai-${ENVIRONMENT}}"
VNET_NAME="${VNET_NAME:-vnet-genieai-${ENVIRONMENT}}"
SUBNET_NAME="${SUBNET_NAME:-snet-aks-${ENVIRONMENT}}"
KEY_VAULT_NAME="${KEY_VAULT_NAME:-kv-genieai-${ENVIRONMENT}}"

# ============================================================
# HELPER FUNCTIONS
# ============================================================
log() { echo "[$(date -u '+%Y-%m-%dT%H:%M:%SZ')] $*"; }
err() { echo "[ERROR] $*" >&2; }

run_cmd() {
  if [ "$DRY_RUN" = true ]; then
    log "[DRY-RUN] $*"
  else
    log "Running: $*"
    eval "$@"
  fi
}

check_prerequisites() {
  log "Checking prerequisites..."
  
  if ! command -v az &>/dev/null; then
    err "Azure CLI (az) not found. Install from: https://docs.microsoft.com/en-us/cli/azure/install-azure-cli"
    exit 1
  fi

  if ! az account show &>/dev/null; then
    err "Not logged in to Azure. Run: az login"
    exit 1
  fi

  # Check GPU VM quota
  log "Checking GPU VM quota for ${GPU_POOL_VM_SIZE} in ${LOCATION}..."
  local quota_info
  quota_info=$(az vm list-usage --location "$LOCATION" --query "[?name.value=='standardNCASv3Family'].{current:currentValue, limit:limit}" -o tsv 2>/dev/null || echo "")
  if [ -n "$quota_info" ]; then
    log "NC-series quota: ${quota_info}"
  else
    log "Warning: Could not verify GPU quota. Ensure you have quota for ${GPU_POOL_VM_SIZE} in ${LOCATION}."
  fi
}

# ============================================================
# STEP 1: RESOURCE GROUP
# ============================================================
create_resource_group() {
  log "Step 1: Creating resource group '${RESOURCE_GROUP}' in '${LOCATION}'..."
  run_cmd az group create \
    --name "$RESOURCE_GROUP" \
    --location "$LOCATION" \
    --tags environment="$ENVIRONMENT" project=genieai managed-by=script
}

# ============================================================
# STEP 2: VIRTUAL NETWORK & SUBNET
# ============================================================
create_network() {
  log "Step 2: Creating VNet '${VNET_NAME}' and subnet '${SUBNET_NAME}'..."
  
  run_cmd az network vnet create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$VNET_NAME" \
    --address-prefix "$VNET_CIDR" \
    --subnet-name "$SUBNET_NAME" \
    --subnet-prefix "$SUBNET_CIDR" \
    --tags environment="$ENVIRONMENT" project=genieai
}

# ============================================================
# STEP 3: AKS CLUSTER WITH CPU NODE POOL (system pool)
# ============================================================
create_aks_cluster() {
  log "Step 3: Creating AKS cluster '${CLUSTER_NAME}'..."
  
  # Get subnet ID for Azure CNI
  local subnet_id
  if [ "$DRY_RUN" = false ]; then
    subnet_id=$(az network vnet subnet show \
      --resource-group "$RESOURCE_GROUP" \
      --vnet-name "$VNET_NAME" \
      --name "$SUBNET_NAME" \
      --query id -o tsv)
  else
    subnet_id="/subscriptions/xxx/resourceGroups/${RESOURCE_GROUP}/providers/Microsoft.Network/virtualNetworks/${VNET_NAME}/subnets/${SUBNET_NAME}"
  fi

  run_cmd az aks create \
    --resource-group "$RESOURCE_GROUP" \
    --name "$CLUSTER_NAME" \
    --kubernetes-version "$K8S_VERSION" \
    --location "$LOCATION" \
    --node-count "$CPU_POOL_NODE_COUNT" \
    --nodepool-name "$CPU_POOL_NAME" \
    --node-vm-size "$CPU_POOL_VM_SIZE" \
    --os-disk-size-gb "$CPU_POOL_OS_DISK_SIZE" \
    --enable-cluster-autoscaler \
    --min-count "$CPU_POOL_MIN_COUNT" \
    --max-count "$CPU_POOL_MAX_COUNT" \
    --node-labels "cpu-pool=true" \
    --network-plugin "$NETWORK_PLUGIN" \
    --network-policy "$NETWORK_POLICY" \
    --vnet-subnet-id "$subnet_id" \
    --enable-managed-identity \
    --enable-addons monitoring \
    --enable-secret-store-csi-driver \
    --generate-ssh-keys \
    --tags environment="$ENVIRONMENT" project=genieai \
    --yes
}

# ============================================================
# STEP 4: GPU NODE POOL
# ============================================================
create_gpu_node_pool() {
  log "Step 4: Creating GPU node pool '${GPU_POOL_NAME}'..."
  
  run_cmd az aks nodepool add \
    --resource-group "$RESOURCE_GROUP" \
    --cluster-name "$CLUSTER_NAME" \
    --name "$GPU_POOL_NAME" \
    --node-vm-size "$GPU_POOL_VM_SIZE" \
    --node-count "$GPU_POOL_NODE_COUNT" \
    --enable-cluster-autoscaler \
    --min-count "$GPU_POOL_MIN_COUNT" \
    --max-count "$GPU_POOL_MAX_COUNT" \
    --os-disk-size-gb "$GPU_POOL_OS_DISK_SIZE" \
    --node-labels "gpu-pool=true" \
    --node-taints "$GPU_TAINT" \
    --aks-custom-headers "UseGPUDedicatedVHD=true" \
    --tags environment="$ENVIRONMENT" project=genieai
}

# ============================================================
# STEP 5: CONFIGURE KUBECTL & NAMESPACE
# ============================================================
configure_kubectl() {
  log "Step 5: Configuring kubectl credentials..."
  
  run_cmd az aks get-credentials \
    --resource-group "$RESOURCE_GROUP" \
    --name "$CLUSTER_NAME" \
    --overwrite-existing

  log "Creating namespace '${NAMESPACE}'..."
  if [ "$DRY_RUN" = false ]; then
    kubectl create namespace "$NAMESPACE" --dry-run=client -o yaml | kubectl apply -f -
  else
    log "[DRY-RUN] kubectl create namespace $NAMESPACE"
  fi
}

# ============================================================
# STEP 6: INSTALL NVIDIA DEVICE PLUGIN
# ============================================================
install_nvidia_plugin() {
  log "Step 6: Installing NVIDIA Device Plugin DaemonSet..."
  
  if [ "$DRY_RUN" = false ]; then
    kubectl apply -f https://raw.githubusercontent.com/NVIDIA/k8s-device-plugin/v0.14.5/nvidia-device-plugin.yml
  else
    log "[DRY-RUN] kubectl apply -f nvidia-device-plugin.yml"
  fi
}

# ============================================================
# STEP 7: INSTALL NGINX INGRESS CONTROLLER
# ============================================================
install_ingress_controller() {
  log "Step 7: Installing nginx Ingress Controller via Helm..."
  
  run_cmd helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx 2>/dev/null || true
  run_cmd helm repo update
  
  run_cmd helm upgrade --install ingress-nginx ingress-nginx/ingress-nginx \
    --namespace ingress-nginx \
    --create-namespace \
    --set controller.replicaCount=2 \
    --set controller.nodeSelector.cpu-pool=true \
    --set controller.service.annotations."service\\.beta\\.kubernetes\\.io/azure-load-balancer-health-probe-request-path"=/healthz \
    --set controller.config.ssl-protocols="TLSv1.2 TLSv1.3" \
    --wait --timeout 300s
}

# ============================================================
# STEP 8: AZURE KEY VAULT INTEGRATION
# ============================================================
setup_key_vault() {
  log "Step 8: Setting up Azure Key Vault integration..."
  
  # Create Key Vault if it doesn't exist
  local kv_exists
  kv_exists=$(az keyvault show --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" --query name -o tsv 2>/dev/null || echo "")
  
  if [ -z "$kv_exists" ]; then
    run_cmd az keyvault create \
      --resource-group "$RESOURCE_GROUP" \
      --name "$KEY_VAULT_NAME" \
      --location "$LOCATION" \
      --enable-rbac-authorization \
      --tags environment="$ENVIRONMENT" project=genieai
  else
    log "Key Vault '${KEY_VAULT_NAME}' already exists, skipping creation."
  fi

  # Grant AKS managed identity access to Key Vault
  if [ "$DRY_RUN" = false ]; then
    local identity_client_id
    identity_client_id=$(az aks show \
      --resource-group "$RESOURCE_GROUP" \
      --name "$CLUSTER_NAME" \
      --query "addonProfiles.azureKeyvaultSecretsProvider.identity.clientId" -o tsv 2>/dev/null || echo "")
    
    if [ -n "$identity_client_id" ] && [ "$identity_client_id" != "null" ]; then
      local kv_id
      kv_id=$(az keyvault show --name "$KEY_VAULT_NAME" --resource-group "$RESOURCE_GROUP" --query id -o tsv)
      
      az role assignment create \
        --role "Key Vault Secrets User" \
        --assignee "$identity_client_id" \
        --scope "$kv_id" 2>/dev/null || log "Role assignment may already exist."
    else
      log "Warning: Could not retrieve Secrets Store CSI identity. Configure Key Vault access manually."
    fi
  fi
}

# ============================================================
# STEP 9: VERIFY CLUSTER
# ============================================================
verify_cluster() {
  log "Step 9: Verifying cluster state..."
  
  if [ "$DRY_RUN" = true ]; then
    log "[DRY-RUN] Skipping verification."
    return
  fi

  log "Cluster info:"
  kubectl cluster-info

  log "Node pools:"
  kubectl get nodes -o wide --show-labels | head -20

  log "GPU node pool taint verification:"
  kubectl get nodes -l gpu-pool=true -o jsonpath='{range .items[*]}{.metadata.name}{"\t"}{.spec.taints}{"\n"}{end}' 2>/dev/null || log "No GPU nodes currently provisioned (scale-to-zero is active)."

  log "NVIDIA Device Plugin status:"
  kubectl get daemonset -n kube-system -l app=nvidia-device-plugin 2>/dev/null || log "NVIDIA plugin may not have pods yet (no GPU nodes)."

  log "Ingress Controller status:"
  kubectl get pods -n ingress-nginx
  kubectl get svc -n ingress-nginx ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null && echo "" || log "Ingress external IP pending..."

  log "Namespaces:"
  kubectl get namespaces | grep -E "genieai|ingress-nginx"
}

# ============================================================
# MAIN
# ============================================================
main() {
  log "=========================================="
  log "GenieAI AKS Cluster Provisioning"
  log "=========================================="
  log "Environment:   ${ENVIRONMENT}"
  log "Resource Group: ${RESOURCE_GROUP}"
  log "Cluster Name:  ${CLUSTER_NAME}"
  log "Location:      ${LOCATION}"
  log "K8s Version:   ${K8S_VERSION}"
  log "CPU Pool:      ${CPU_POOL_VM_SIZE} (min=${CPU_POOL_MIN_COUNT}, max=${CPU_POOL_MAX_COUNT})"
  log "GPU Pool:      ${GPU_POOL_VM_SIZE} (min=${GPU_POOL_MIN_COUNT}, max=${GPU_POOL_MAX_COUNT})"
  log "Dry Run:       ${DRY_RUN}"
  log "=========================================="
  
  check_prerequisites
  create_resource_group
  create_network
  create_aks_cluster
  create_gpu_node_pool
  configure_kubectl
  install_nvidia_plugin
  install_ingress_controller
  setup_key_vault
  verify_cluster

  log "=========================================="
  log "AKS cluster provisioning complete!"
  log "=========================================="
  log ""
  log "Next steps:"
  log "  1. Add secrets to Key Vault:  az keyvault secret set --vault-name ${KEY_VAULT_NAME} --name <secret-name> --value <value>"
  log "  2. Deploy GenieAI:            ./scripts/deploy.sh --env ${ENVIRONMENT}"
  log "  3. Validate deployment:       ./scripts/validate.sh --env ${ENVIRONMENT}"
  log ""
  log "To scale GPU pool up:   az aks nodepool scale --resource-group ${RESOURCE_GROUP} --cluster-name ${CLUSTER_NAME} --name ${GPU_POOL_NAME} --node-count 1"
  log "To scale GPU pool down: kubectl scale deployment/vllm deployment/tei deployment/tei-reranker deployment/dataprep --replicas=0 -n ${NAMESPACE}"
  log "  (Cluster Autoscaler will remove idle GPU nodes after 10 minutes)"
}

main "$@"
