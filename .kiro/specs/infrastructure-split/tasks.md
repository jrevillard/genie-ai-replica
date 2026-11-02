# Implementation Plan: Infrastructure Split (AKS)

## Overview

This plan implements the GenieAI AKS infrastructure using a Helm chart (`helm/genieai/`) with GPU and CPU node pool separation, NetworkPolicies, persistent storage, health monitoring, and deployment automation. All Kubernetes resources are Helm templates; shell scripts handle deployment orchestration only. Property-based tests use Python (Hypothesis), integration tests use pytest + kubectl, and Helm chart tests use the helm-unittest plugin.

## Tasks

- [x] 1. Set up Helm chart skeleton and shared templates
  - [x] 1.1 Create Helm chart structure with Chart.yaml, values.yaml, and _helpers.tpl
    - Create `helm/genieai/Chart.yaml` with chart metadata (name: genieai, version: 0.1.0, appVersion: 1.0.0)
    - Create `helm/genieai/values.yaml` with default values for all configurable parameters (namespace, node pool labels, image tags, resource limits, replica counts, storage sizes, probe settings)
    - Create `helm/genieai/values-dev.yaml`, `helm/genieai/values-staging.yaml`, `helm/genieai/values-prod.yaml` with environment overrides
    - Create `helm/genieai/templates/_helpers.tpl` with shared template helpers (labels, selectors, GPU affinity/tolerations, CPU affinity, probe generators)
    - Create `helm/genieai/templates/namespace.yaml` for the genieai namespace
    - Create `helm/genieai/templates/NOTES.txt` with post-install instructions
    - _Requirements: 8.1, 8.6_

  - [x] 1.2 Create ConfigMap and Secret templates
    - Create `helm/genieai/templates/config/configmap-gpu-services.yaml` with all GPU service environment variables using Kubernetes DNS addresses
    - Create `helm/genieai/templates/config/configmap-cpu-services.yaml` with all CPU service environment variables using Kubernetes DNS addresses
    - Create `helm/genieai/templates/config/secrets.yaml` referencing Azure Key Vault via Secrets Store CSI Driver (no literal secret values in templates)
    - _Requirements: 8.1, 8.2, 3.2, 3.3_

- [x] 2. Implement GPU node pool workload templates
  - [x] 2.1 Create NVIDIA Device Plugin DaemonSet template
    - Create `helm/genieai/templates/gpu/nvidia-device-plugin-daemonset.yaml`
    - Configure nodeSelector for gpu-pool=true, toleration for nvidia.com/gpu taint
    - Use image nvcr.io/nvidia/k8s-device-plugin:v0.14.5 with privileged securityContext
    - _Requirements: 1.1, 1.4, 1.5_

  - [x] 2.2 Create vLLM Deployment and Service templates
    - Create `helm/genieai/templates/gpu/vllm-deployment.yaml` with requiredDuringSchedulingIgnoredDuringExecution node affinity (gpu-pool=true), GPU toleration, nvidia.com/gpu resource request/limit of 1, startup probe (initialDelaySeconds=60, periodSeconds=12, failureThreshold=30), readiness/liveness probes on /health:8000, RollingUpdate strategy (maxUnavailable=0, maxSurge=1)
    - Create `helm/genieai/templates/gpu/vllm-service.yaml` as ClusterIP on port 8000
    - _Requirements: 1.2, 1.3, 6.1, 6.2, 6.3, 8.3, 3.1_

  - [x] 2.3 Create TEI, TEI Reranker, and Dataprep Deployment and Service templates
    - Create `helm/genieai/templates/gpu/tei-deployment.yaml` and `tei-service.yaml` (port 80, same GPU scheduling as vLLM)
    - Create `helm/genieai/templates/gpu/tei-reranker-deployment.yaml` and `tei-reranker-service.yaml` (port 80)
    - Create `helm/genieai/templates/gpu/dataprep-deployment.yaml` and `dataprep-service.yaml` (port 5000)
    - All with startup probe (initialDelaySeconds=60, periodSeconds=12, failureThreshold=30), readiness/liveness probes, GPU affinity/tolerations, nvidia.com/gpu: 1
    - _Requirements: 1.2, 1.3, 6.1, 6.2, 6.3, 8.3, 3.1, 3.3_

  - [x] 2.4 Write Helm unit tests for GPU templates
    - Create `helm/genieai/tests/gpu_scheduling_test.yaml` using helm-unittest
    - Assert all GPU deployments have nvidia.com/gpu resources, correct affinity, correct tolerations
    - Assert all GPU services are ClusterIP type with correct ports
    - _Requirements: 1.2, 1.3_

  - [x] 2.5 Write property test: GPU Manifest Scheduling Correctness
    - **Property 1: GPU Manifest Scheduling Correctness**
    - **Validates: Requirements 1.2, 1.3**
    - Create `tests/properties/test_gpu_scheduling.py` using Hypothesis
    - Generate random GPU service configs (image, ports, env vars) and validate rendered manifests contain correct affinity, tolerations, and GPU resources

- [x] 3. Implement CPU node pool workload templates
  - [x] 3.1 Create CPU service Deployment and Service templates (application tier)
    - Create `helm/genieai/templates/cpu/backend-deployment.yaml` and `backend-service.yaml` (port 3000)
    - Create `helm/genieai/templates/cpu/frontend-deployment.yaml` and `frontend-service.yaml` (port 5173)
    - Create `helm/genieai/templates/cpu/document-repository-deployment.yaml` and `document-repository-service.yaml` (port 3001)
    - Create `helm/genieai/templates/cpu/nginx-deployment.yaml` and `nginx-service.yaml` (port 80)
    - Create `helm/genieai/templates/cpu/kong-deployment.yaml` and `kong-service.yaml` (port 8010)
    - All with CPU node affinity (cpu-pool=true), NO GPU resources, NO GPU tolerations, readiness/liveness probes, RollingUpdate strategy
    - _Requirements: 2.1, 2.2, 2.3, 6.1, 6.2, 8.3, 3.1_

  - [x] 3.2 Create CPU service Deployment and Service templates (data tier)
    - Create `helm/genieai/templates/cpu/arango-deployment.yaml` and `arango-service.yaml` (port 8529, TCP probe, startup probe with initialDelaySeconds=10, periodSeconds=5, failureThreshold=30)
    - Create `helm/genieai/templates/cpu/redis-deployment.yaml` and `redis-service.yaml` (port 6379, TCP probe)
    - Create `helm/genieai/templates/cpu/kong-database-deployment.yaml` and `kong-database-service.yaml` (port 5432, exec pg_isready, startup probe)
    - Create `helm/genieai/templates/cpu/keycloak-db-deployment.yaml` and `keycloak-db-service.yaml` (port 5432, exec pg_isready, startup probe)
    - All with CPU node affinity, PVC volume mounts at original Docker paths
    - _Requirements: 2.1, 2.2, 2.3, 5.3, 6.1, 6.2, 6.6, 3.1_

  - [x] 3.3 Create CPU service Deployment and Service templates (microservices tier)
    - Create templates for: embedding (6000), reranker (6100), textgen (9000), translation (9030), guardrail (9090), retriever-arango-service (7025), http-service (6666), chatqna-xeon-backend-server (8888), chatqna-xeon-ui-server (5173), chatqna-xeon-nginx-server (80)
    - All with CPU node affinity, NO GPU resources, readiness/liveness probes, RollingUpdate strategy
    - _Requirements: 2.1, 2.2, 2.3, 6.1, 6.2, 8.3, 3.1_

  - [x] 3.4 Create CPU service Deployment and Service templates (auth and utility)
    - Create `helm/genieai/templates/cpu/keycloak-deployment.yaml` and `keycloak-service.yaml` (port 8080, startup probe with initialDelaySeconds=10, periodSeconds=5, failureThreshold=30)
    - Create `helm/genieai/templates/cpu/clamav-deployment.yaml` and `clamav-service.yaml` (port 3310)
    - All with CPU node affinity
    - _Requirements: 2.1, 2.2, 2.3, 6.1, 6.2, 6.6, 3.1_

  - [x] 3.5 Write Helm unit tests for CPU templates
    - Create `helm/genieai/tests/cpu_scheduling_test.yaml` using helm-unittest
    - Assert CPU deployments have correct affinity, NO GPU resources, NO GPU tolerations
    - Assert all CPU services are ClusterIP type with correct target ports
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.6 Write property test: CPU Manifest Scheduling Correctness
    - **Property 2: CPU Manifest Scheduling Correctness**
    - **Validates: Requirements 2.1, 2.2, 2.3**
    - Create `tests/properties/test_cpu_scheduling.py` using Hypothesis
    - Generate random CPU service configs and validate rendered manifests have correct affinity, no GPU resources, no GPU tolerations

- [x] 4. Checkpoint - Validate GPU and CPU templates render correctly
  - Ensure all tests pass, ask the user if questions arise.

- [x] 5. Implement networking templates
  - [x] 5.1 Create NetworkPolicy templates
    - Create `helm/genieai/templates/networking/networkpolicy-default-deny.yaml` (empty podSelector, both Ingress and Egress policyTypes, no allow rules)
    - Create `helm/genieai/templates/networking/networkpolicy-dns.yaml` (allow all pods egress to kube-dns port 53 UDP/TCP in kube-system)
    - Create `helm/genieai/templates/networking/networkpolicy-external.yaml` (allow ingress from 0.0.0.0/0 to nginx on 80,443 and Kong on 8010)
    - Create `helm/genieai/templates/networking/networkpolicy-cpu-to-gpu.yaml` (allow egress from CPU services to GPU services on specific ports, and ingress to GPU pods from those CPU pods)
    - Create `helm/genieai/templates/networking/networkpolicy-gpu-to-cpu.yaml` (allow egress from Dataprep to CPU services on specific ports, and ingress to CPU pods from Dataprep)
    - Create `helm/genieai/templates/networking/networkpolicy-internal-cpu.yaml` (allow internal CPU-to-CPU communication for Kong→backend, Kong→document-repository, etc.)
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7_

  - [x] 5.2 Create Ingress template
    - Create `helm/genieai/templates/networking/ingress.yaml` with nginx Ingress Controller annotations
    - Configure TLS termination referencing tls-secret, TLS 1.2 minimum
    - Configure HTTP→HTTPS redirect (301)
    - Configure host/path-based routing to nginx and Kong services
    - Configure default backend returning 404
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.7_

  - [x] 5.3 Write Helm unit tests for NetworkPolicy templates
    - Create `helm/genieai/tests/networkpolicy_test.yaml` using helm-unittest
    - Assert default-deny policy always rendered with correct structure
    - Assert DNS egress policy allows port 53 UDP/TCP
    - Assert external ingress only to nginx and Kong
    - _Requirements: 4.1, 4.4, 4.6_

  - [x] 5.4 Write property test: NetworkPolicy Baseline Generation
    - **Property 5: NetworkPolicy Baseline Generation**
    - **Validates: Requirements 4.1, 4.6**
    - Create `tests/properties/test_networkpolicy_baseline.py` using Hypothesis
    - Generate random namespace configurations and validate default-deny and DNS egress policies are always present with correct structure

  - [x] 5.5 Write property test: NetworkPolicy Allow Rules Match Dependency Graph
    - **Property 6: NetworkPolicy Allow Rules Match Dependency Graph**
    - **Validates: Requirements 4.2, 4.3, 4.4, 4.7**
    - Create `tests/properties/test_networkpolicy_rules.py` using Hypothesis
    - Generate random service dependency graphs and validate that only authorized communication paths have allow rules

- [x] 6. Implement storage templates
  - [x] 6.1 Create PersistentVolumeClaim templates
    - Create `helm/genieai/templates/storage/arango-pvc.yaml` (managed-premium, ReadWriteOnce, 50Gi)
    - Create `helm/genieai/templates/storage/kong-db-pvc.yaml` (managed-premium, ReadWriteOnce, 10Gi)
    - Create `helm/genieai/templates/storage/keycloak-db-pvc.yaml` (managed-premium, ReadWriteOnce, 10Gi)
    - Create `helm/genieai/templates/storage/document-uploads-pvc.yaml` (azurefile, ReadWriteMany, 50Gi)
    - Create `helm/genieai/templates/storage/redis-data-pvc.yaml` (azurefile, ReadWriteMany, 10Gi)
    - All capacities parameterized in values.yaml
    - _Requirements: 5.1, 5.2, 5.6_

  - [x] 6.2 Write Helm unit tests for PVC templates
    - Create `helm/genieai/tests/storage_test.yaml` using helm-unittest
    - Assert Azure Disk PVCs use managed-premium + ReadWriteOnce
    - Assert Azure File PVCs use azurefile + ReadWriteMany
    - Assert capacities match values.yaml
    - _Requirements: 5.1, 5.2, 5.6_

  - [x] 6.3 Write property test: PVC Configuration Correctness
    - **Property 7: PVC Configuration Correctness**
    - **Validates: Requirements 5.1, 5.2, 5.6**
    - Create `tests/properties/test_pvc_config.py` using Hypothesis
    - Generate random stateful service definitions (block vs shared, varying capacities) and validate generated PVCs have correct StorageClass, access mode, and minimum capacity

- [x] 7. Checkpoint - Validate networking and storage templates
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement health monitor
  - [x] 8.1 Create health monitor Deployment and Service templates
    - Create `helm/genieai/templates/cpu/health-monitor-deployment.yaml` using alpine + curl + jq image
    - Mount a ConfigMap containing the health check script as a volume
    - Configure CPU node affinity, readiness probe on /health-status:8080
    - Create `helm/genieai/templates/cpu/health-monitor-service.yaml` (ClusterIP, port 8080)
    - _Requirements: 10.1, 10.5, 10.7_

  - [x] 8.2 Create health monitor bash script
    - Create `helm/genieai/templates/config/configmap-health-monitor.yaml` containing the health check script
    - Implement polling loop: every 10 seconds, curl each GPU and CPU service health endpoint
    - Implement state machine: healthy → degraded (3 failures) → unreachable (6 failures), recovery on 2 successes
    - Implement scaled-down detection: check Kubernetes Endpoints API (curl to kube-apiserver or kubectl) — if no endpoints AND GPU node count = 0, report "scaled-down"
    - Expose /health-status JSON endpoint via a simple HTTP server (bash + socat or a lightweight approach)
    - JSON response includes: timestamp, clusterStatus, gpuNodePoolActive, services array with all required fields
    - _Requirements: 10.1, 10.2, 10.4, 10.5, 10.6, 10.7_

  - [x] 8.3 Write property test: Health Monitor State Machine
    - **Property 14: Health Monitor State Machine**
    - **Validates: Requirements 10.2, 10.4, 10.6**
    - Create `tests/properties/test_health_monitor_state.py` using Hypothesis
    - Generate random sequences of pass/fail health checks and validate state transitions follow the specified rules (3 failures → degraded, 6 → unreachable, 2 successes → healthy, scaled-down logic)

  - [x] 8.4 Write property test: Health Status JSON Completeness
    - **Property 15: Health Status JSON Completeness**
    - **Validates: Requirements 10.5**
    - Create `tests/properties/test_health_status_json.py` using Hypothesis
    - Generate random internal health states and validate the JSON response contains all required fields with correct types

- [x] 9. Implement deployment orchestration scripts
  - [x] 9.1 Create deploy.sh deployment script
    - Create `scripts/deploy.sh` (bash)
    - Accept parameters: environment (dev/staging/prod), namespace, cluster name, resource group
    - Run `helm lint helm/genieai/` before deploying
    - Run `helm template --validate` for dry-run validation (abort on failure with descriptive error)
    - Run `helm upgrade --install --wait --timeout 300s` with the appropriate values file
    - Implement rollback logic: if deployment fails (non-zero exit from helm), run `helm rollback`; if rollback fails within 120s, preserve state, report failure, exit non-zero
    - _Requirements: 8.4, 8.5, 8.7, 8.8_

  - [x] 9.2 Create validate.sh validation script
    - Create `scripts/validate.sh` (bash)
    - Post-deployment validation: check all Deployments are Available, all pods Running/Ready
    - Verify GPU node pool taint exists (kubectl get nodes with label gpu-pool=true)
    - Verify NVIDIA Device Plugin DaemonSet is Ready
    - Verify Ingress Controller has external IP
    - Verify TLS termination works (curl -k https://<ingress-ip>)
    - _Requirements: 1.4, 1.5, 9.1_

  - [x] 9.3 Write property test: Deployment Rollback State Machine
    - **Property 13: Deployment Rollback State Machine**
    - **Validates: Requirements 8.5, 8.8**
    - Create `tests/properties/test_deployment_rollback.py` using Hypothesis
    - Generate random deployment timelines (ready/unready states at various times) and validate rollback is triggered at 300s, success/failure reported correctly

- [x] 10. Implement remaining property tests and service generation tests
  - [x] 10.1 Write property test: Service Resource Generation
    - **Property 3: Service Resource Generation**
    - **Validates: Requirements 3.1, 3.4, 3.5, 9.4**
    - Create `tests/properties/test_service_generation.py` using Hypothesis
    - Generate random workload sets and validate one ClusterIP Service per Deployment, targetPort matches containerPort

  - [x] 10.2 Write property test: Endpoint DNS Format
    - **Property 4: Endpoint DNS Format**
    - **Validates: Requirements 3.2, 3.3**
    - Create `tests/properties/test_dns_format.py` using Hypothesis
    - Generate random service dependency graphs and validate environment variable values match the Kubernetes DNS URL format

  - [x] 10.3 Write property test: Volume Mount Path Preservation
    - **Property 8: Volume Mount Path Preservation**
    - **Validates: Requirements 5.3**
    - Create `tests/properties/test_volume_mounts.py` using Hypothesis
    - Generate random mount path definitions and validate PVC is mounted at the exact same path

  - [x] 10.4 Write property test: Health Probe Generation
    - **Property 9: Health Probe Generation**
    - **Validates: Requirements 6.1, 6.2, 6.3, 6.6**
    - Create `tests/properties/test_health_probes.py` using Hypothesis
    - Generate random service definitions (HTTP/TCP/exec, GPU/CPU, slow/fast start) and validate correct probe configuration

  - [x] 10.5 Write property test: Rolling Update Strategy
    - **Property 10: Rolling Update Strategy**
    - **Validates: Requirements 8.3**
    - Create `tests/properties/test_rolling_update.py` using Hypothesis
    - Generate random Deployment specs and validate strategy is RollingUpdate with maxUnavailable=0, maxSurge=1

  - [x] 10.6 Write property test: Helm Template Parameterization and Secrets Separation
    - **Property 11: Helm Template Parameterization and Secrets Separation**
    - **Validates: Requirements 8.1, 8.2**
    - Create `tests/properties/test_helm_parameterization.py` using Hypothesis
    - Generate random values files and validate different values produce different output; sensitive values only in Secrets

  - [x] 10.7 Write property test: Dry-Run Validation Detects Invalid Manifests
    - **Property 12: Dry-Run Validation Detects Invalid Manifests**
    - **Validates: Requirements 8.7**
    - Create `tests/properties/test_dryrun_validation.py` using Hypothesis
    - Generate random valid/invalid manifests and validate the dry-run function accepts/rejects correctly

- [x] 11. Implement integration test suite
  - [x] 11.1 Create integration test infrastructure
    - Create `tests/integration/conftest.py` with pytest fixtures for kubectl commands, namespace setup/teardown, cluster connection
    - Create `tests/integration/requirements.txt` with pytest, hypothesis, pyyaml, kubernetes (client library)
    - _Requirements: 1.2, 2.1, 3.1, 4.1_

  - [x] 11.2 Write integration tests for workload scheduling
    - Create `tests/integration/test_scheduling.py`
    - Test GPU pods are on GPU nodes (verify node labels via kubectl)
    - Test CPU pods are on CPU nodes (verify node labels via kubectl)
    - Test GPU pod stays Pending when no GPU capacity available
    - _Requirements: 1.2, 1.6, 2.1_

  - [x] 11.3 Write integration tests for networking
    - Create `tests/integration/test_networking.py`
    - Test cross-pool DNS resolution (CPU pod resolves GPU service)
    - Test NetworkPolicy blocks unauthorized traffic (exec into pod, attempt curl to unauthorized service)
    - Test NetworkPolicy allows authorized traffic (exec into authorized pod, curl succeeds)
    - Test Ingress TLS termination and HTTP→HTTPS redirect
    - _Requirements: 3.2, 4.2, 4.5, 9.1, 9.2_

  - [x] 11.4 Write integration tests for storage and scaling
    - Create `tests/integration/test_storage_scaling.py`
    - Test PVC data persists across pod restart
    - Test GPU scale-to-zero and scale-up behavior
    - _Requirements: 5.4, 7.1, 7.2, 7.3_

- [x] 12. Implement Cluster Autoscaler configuration template
  - [x] 12.1 Create Cluster Autoscaler configuration template
    - Create `helm/genieai/templates/cluster-autoscaler-config.yaml`
    - Configure GPU node pool: min=0, max=2 (parameterized), scale-down-unneeded-time=10m
    - Configure CPU node pool: min=1, max parameterized
    - _Requirements: 7.1, 7.2, 7.4, 7.5_

- [x] 13. Final checkpoint - Full validation
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document using Python (Hypothesis)
- Helm unit tests use the helm-unittest plugin for template validation
- Integration tests run against a real AKS cluster using pytest + kubectl
- No TypeScript, Node.js, or package.json — all tooling is bash, Python, Helm, kubectl, az CLI, curl, jq, yq
- The health monitor is a simple bash/curl container (alpine + curl + jq) — no application framework

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "12.1"] },
    { "id": 2, "tasks": ["2.1", "3.1", "3.2", "3.3", "3.4", "6.1"] },
    { "id": 3, "tasks": ["2.2", "2.3", "5.1", "5.2"] },
    { "id": 4, "tasks": ["2.4", "2.5", "3.5", "3.6", "5.3", "5.4", "5.5", "6.2", "6.3"] },
    { "id": 5, "tasks": ["8.1", "8.2"] },
    { "id": 6, "tasks": ["8.3", "8.4", "9.1", "9.2"] },
    { "id": 7, "tasks": ["9.3", "10.1", "10.2", "10.3", "10.4", "10.5", "10.6", "10.7"] },
    { "id": 8, "tasks": ["11.1"] },
    { "id": 9, "tasks": ["11.2", "11.3", "11.4"] }
  ]
}
```
