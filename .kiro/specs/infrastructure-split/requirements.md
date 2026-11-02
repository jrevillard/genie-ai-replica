# Requirements Document

## Introduction

This feature deploys the GenieAI MVP application on Azure Kubernetes Service (AKS) with workload separation between GPU-dependent and CPU-only services using dedicated node pools. A single AKS cluster hosts two node pools: a GPU node pool (Azure NC-series VMs with NVIDIA T4 GPUs) running inference services (vLLM, TEI, TEI Reranker, Dataprep), and a CPU node pool (Standard VMs) running all remaining services (frontend, backend, API gateway, databases, authentication, and CPU-bound microservices). The goal is to optimize costs by enabling independent scaling of GPU and CPU workloads — including scaling the GPU node pool to zero when inference is not needed — while leveraging Kubernetes-native networking, scheduling, and lifecycle management.

## Glossary

- **AKS_Cluster**: The Azure Kubernetes Service cluster hosting both node pools and all workloads
- **GPU_Node_Pool**: The AKS node pool composed of Azure NC-series VMs with NVIDIA T4 GPUs, hosting GPU-dependent services via node affinity and tolerations
- **CPU_Node_Pool**: The AKS node pool composed of Standard Azure VMs, hosting all CPU-only services via node affinity and tolerations
- **Deployment_System**: The overall system responsible for provisioning, configuring, and deploying Kubernetes manifests to the AKS_Cluster
- **K8s_Manifest**: A Kubernetes resource definition (Deployment, Service, ConfigMap, Secret, NetworkPolicy, PersistentVolumeClaim) describing desired cluster state
- **Service_Discovery**: Kubernetes internal DNS-based service resolution (service-name.namespace.svc.cluster.local) enabling pod-to-pod communication
- **Network_Policy**: A Kubernetes NetworkPolicy resource controlling pod-to-pod traffic within the AKS_Cluster
- **Health_Probe**: Kubernetes liveness, readiness, and startup probe configurations for pod lifecycle management
- **Persistent_Volume**: Azure Disk or Azure File backed persistent storage provisioned via Kubernetes PersistentVolumeClaims
- **NVIDIA_Device_Plugin**: The NVIDIA Kubernetes device plugin enabling GPU resource scheduling on GPU_Node_Pool nodes
- **Cluster_Autoscaler**: AKS feature that automatically adjusts node pool size based on pending pod resource requests
- **Helm_Chart**: A Helm packaging format used for templating and managing Kubernetes manifests across environments
- **vLLM**: The main LLM inference server running on GPU (port 8000)
- **TEI**: Text Embeddings Inference server for embedding generation (port 80 container, exposed via Kubernetes Service)
- **TEI_Reranker**: Text Embeddings Inference server for reranking (port 80 container, exposed via Kubernetes Service)
- **Dataprep**: The data preparation service using Docling for GPU-accelerated document processing (port 5000 container)
- **Kong**: The API gateway service managing routing and rate limiting
- **ArangoDB**: The vector database storing document embeddings and application data
- **Keycloak**: The identity and access management server for authentication

## Requirements

### Requirement 1: GPU Node Pool Workload Scheduling

**User Story:** As a DevOps engineer, I want GPU-dependent services scheduled exclusively on GPU-equipped nodes, so that GPU resources are reserved for inference workloads and not consumed by CPU-only services.

#### Acceptance Criteria

1. THE Deployment_System SHALL configure the GPU_Node_Pool with Azure NC-series VMs equipped with NVIDIA T4 GPUs and the NVIDIA_Device_Plugin installed for GPU resource advertisement
2. THE K8s_Manifest for vLLM, TEI, TEI_Reranker, and Dataprep SHALL specify a requiredDuringSchedulingIgnoredDuringExecution node affinity rule targeting the node label "gpu-pool=true" and tolerations matching the GPU_Node_Pool taint key, value, and effect
3. THE K8s_Manifest for vLLM, TEI, TEI_Reranker, and Dataprep SHALL specify GPU resource requests and limits using the "nvidia.com/gpu" resource name with a value of 1 per pod
4. THE GPU_Node_Pool SHALL apply a Kubernetes taint with key "nvidia.com/gpu", value "present", and effect "NoSchedule" that prevents pods without a matching toleration from being scheduled on GPU nodes
5. WHEN the GPU_Node_Pool is deployed, THE NVIDIA_Device_Plugin SHALL be running as a DaemonSet on all GPU_Node_Pool nodes and reporting Ready status within 300 seconds, making GPU resources visible to the Kubernetes scheduler
6. IF all GPU nodes in the GPU_Node_Pool have fully allocated GPU resources, THEN THE Kubernetes_Scheduler SHALL leave additional GPU-requesting pods in Pending state until capacity becomes available, without scheduling them on non-GPU nodes

### Requirement 2: CPU Node Pool Workload Scheduling

**User Story:** As a DevOps engineer, I want all CPU-only services scheduled on standard VMs, so that cost-effective compute is used for non-inference workloads and GPU nodes are not wasted on CPU tasks.

#### Acceptance Criteria

1. THE K8s_Manifest for all CPU-only services (Keycloak, keycloak-db, Kong, kong-database, frontend, backend, document-repository, ClamAV, ArangoDB, nginx, redis-cache, http-service, embedding, reranker, chatqna-xeon-backend-server, chatqna-xeon-ui-server, chatqna-xeon-nginx-server, textgen, translation, guardrail, retriever-arango-service) SHALL specify a requiredDuringSchedulingIgnoredDuringExecution node affinity rule targeting the CPU_Node_Pool label, ensuring the Kubernetes scheduler will not place these pods on any other node pool
2. THE K8s_Manifest for CPU-only services SHALL NOT include any "nvidia.com/gpu" resource requests or limits
3. THE K8s_Manifest for CPU-only services SHALL NOT include tolerations for the GPU_Node_Pool taint, ensuring the Kubernetes scheduler cannot place CPU workloads on GPU nodes
4. THE CPU_Node_Pool SHALL use Standard Azure VM SKUs without GPU hardware, with total allocatable CPU and memory across pool nodes meeting or exceeding the sum of all CPU-only service resource requests plus 20% headroom for scheduling overhead
5. IF a CPU-only service pod cannot be scheduled on the CPU_Node_Pool due to insufficient resources within 120 seconds, THEN THE AKS_Cluster SHALL report the pod as Pending with an event indicating insufficient CPU or memory resources on the CPU_Node_Pool

### Requirement 3: Kubernetes Service Discovery and Communication

**User Story:** As a DevOps engineer, I want services to communicate via Kubernetes internal DNS, so that cross-service references are resolved reliably without hardcoded IP addresses or external DNS configuration.

#### Acceptance Criteria

1. THE Deployment_System SHALL create a Kubernetes Service resource (ClusterIP type) for each deployed workload, with the Service name matching the workload's Deployment name, enabling discovery via Kubernetes DNS at the address "<service-name>.<namespace>.svc.cluster.local"
2. WHEN a CPU-only service (embedding, reranker, textgen, translation, guardrail, chatqna-xeon-backend-server, retriever-arango-service) references a GPU service (vLLM, TEI, TEI_Reranker), THE K8s_Manifest SHALL configure the corresponding environment variable to use the Kubernetes Service DNS name with the service port (e.g., "http://vllm.<namespace>.svc.cluster.local:8000" for vLLM, port 80 for TEI and TEI_Reranker)
3. WHEN the Dataprep service on the GPU_Node_Pool references a CPU-only service (ArangoDB on port 8529, embedding on port 6000, guardrail on port 9090, document-repository on port 3001, backend on port 3000, http-service on port 6666), THE K8s_Manifest SHALL configure the corresponding environment variable to use the Kubernetes Service DNS name and port of the target service (e.g., "http://arango-vector-db.<namespace>.svc.cluster.local:8529")
4. THE Deployment_System SHALL deploy all services within a single Kubernetes namespace to simplify service discovery and network policy management
5. THE Deployment_System SHALL configure each Kubernetes Service with a target port matching the container's listening port as defined in the backing Deployment (container port 80 for TEI and TEI_Reranker, 5000 for Dataprep, 8000 for vLLM, and the application-defined port for all other services)
6. IF a pod cannot resolve a Kubernetes Service DNS name within 5 seconds, THEN the calling service SHALL receive a connection error and the pod's logs SHALL contain the unresolved service name and namespace
7. WHEN the GPU_Node_Pool is scaled to 0 nodes and a CPU-only service attempts to connect to a GPU service via its Kubernetes Service DNS name, THE Kubernetes Service SHALL resolve the DNS name successfully but return no available endpoints, causing the connection attempt to fail with a connection-refused or no-endpoints error within 5 seconds

### Requirement 4: Kubernetes NetworkPolicy Security

**User Story:** As a security engineer, I want pod-to-pod traffic restricted by Kubernetes NetworkPolicies, so that only authorized communication paths exist between services and unauthorized lateral movement is blocked.

#### Acceptance Criteria

1. THE Deployment_System SHALL apply a default-deny NetworkPolicy for all ingress and egress traffic within the application namespace, selecting all pods (empty podSelector) and specifying both Ingress and Egress in the policyTypes with no allow rules
2. THE Deployment_System SHALL create NetworkPolicy resources allowing ingress to GPU services (vLLM on port 8000, TEI on port 80, TEI_Reranker on port 80) only from pods with labels matching the CPU-only services that require GPU access (embedding, reranker, textgen, translation, guardrail, chatqna-xeon-backend-server), restricted to the specific container port of each GPU service
3. THE Deployment_System SHALL create a NetworkPolicy allowing ingress to CPU-only services (ArangoDB on port 8529, embedding on port 6000, guardrail on port 9090, document-repository on port 3001, backend on port 3000, http-service on port 6666) only from pods with labels matching the Dataprep service, restricted to the specific container port of each CPU-only service
4. THE Deployment_System SHALL create a NetworkPolicy allowing ingress from external sources (0.0.0.0/0) to only the nginx pod on ports 80 and 443, and to the Kong pod on port 8010
5. WHEN a new service is added to the AKS_Cluster without a corresponding NetworkPolicy allow rule, THE default-deny NetworkPolicy SHALL block all ingress and egress traffic to and from that service's pods
6. THE Deployment_System SHALL create a NetworkPolicy allowing DNS egress (port 53 UDP and port 53 TCP) to pods matching the kube-dns label in the kube-system namespace for all application pods
7. THE Deployment_System SHALL create NetworkPolicy resources allowing egress from CPU-only services (embedding, reranker, textgen, translation, guardrail, chatqna-xeon-backend-server) to GPU service pods on the specific GPU service ports (vLLM on port 8000, TEI on port 80, TEI_Reranker on port 80), and allowing egress from the Dataprep pod to CPU-only service pods on their specific ports (ArangoDB on port 8529, embedding on port 6000, guardrail on port 9090, document-repository on port 3001, backend on port 3000, http-service on port 6666)

### Requirement 5: Persistent Storage with Azure Volumes

**User Story:** As a DevOps engineer, I want stateful services backed by Azure persistent volumes, so that data survives pod restarts, rescheduling, and node failures.

#### Acceptance Criteria

1. THE Deployment_System SHALL create PersistentVolumeClaim resources backed by Azure Disk (managed-premium StorageClass) with ReadWriteOnce access mode for services requiring high-performance block storage: ArangoDB data, Kong database data, and Keycloak database data
2. THE Deployment_System SHALL create PersistentVolumeClaim resources backed by Azure File (azurefile StorageClass) with ReadWriteMany access mode for services requiring shared or multi-access storage: document-repository uploads and redis-cache data
3. THE K8s_Manifest for each stateful service SHALL mount the corresponding PersistentVolumeClaim at the same path used by the original Docker volume mount, preserving application compatibility
4. WHEN a pod is rescheduled to a different node within the same availability zone, THE Persistent_Volume backed by Azure Disk SHALL remain accessible and retain all previously written data
5. IF a PersistentVolumeClaim cannot be bound to a PersistentVolume within 120 seconds, THEN THE Deployment_System SHALL report the unbound claim name and the reason for the binding failure via Kubernetes Events on the PVC resource
6. THE Deployment_System SHALL configure Azure Disk PersistentVolumeClaims with a minimum storage capacity matching the existing Docker volume usage plus 50% headroom, and Azure File PersistentVolumeClaims with a minimum of 10 GiB

### Requirement 6: Kubernetes Health Probes

**User Story:** As a DevOps engineer, I want Kubernetes health probes configured for all services, so that unhealthy pods are automatically restarted and traffic is only routed to ready pods.

#### Acceptance Criteria

1. THE K8s_Manifest for each service SHALL define a readiness probe using HTTP GET for services with health endpoints (vLLM on /health:8000, TEI on /health:80, TEI_Reranker on /health:80, Dataprep on /v1/health:5000, frontend on /:5173), TCP socket for port-only services (ArangoDB:8529, redis-cache:6379, Kong:8010), or exec command for database services (kong-database: pg_isready, keycloak-db: pg_isready), configured with a periodSeconds of 10, timeoutSeconds of 5, and successThreshold of 1
2. THE K8s_Manifest for each service SHALL define a liveness probe using the same check type and endpoint as the readiness probe, configured with a failureThreshold of 3, periodSeconds of 10, and timeoutSeconds of 5
3. THE K8s_Manifest for GPU services (vLLM, TEI, TEI_Reranker, Dataprep) SHALL define a startup probe using the same HTTP GET health endpoint as the readiness probe, configured with an initialDelaySeconds of 60, periodSeconds of 12, and failureThreshold of 30 (allowing up to 420 seconds for model loading) to prevent premature liveness probe failures during initialization
4. WHEN a readiness probe fails, THE Kubernetes Service SHALL remove the pod from the endpoint list, stopping traffic routing to the unhealthy pod
5. WHEN a liveness probe fails for 3 consecutive checks, THE AKS_Cluster SHALL restart the pod automatically
6. THE K8s_Manifest for CPU-only services with slow initialization (ArangoDB, Keycloak, keycloak-db, kong-database) SHALL define a startup probe configured with an initialDelaySeconds of 10, periodSeconds of 5, and failureThreshold of 30 (allowing up to 160 seconds for initialization) to prevent premature liveness probe failures during startup

### Requirement 7: GPU Node Pool Scaling and Cost Optimization

**User Story:** As a DevOps engineer, I want the GPU node pool to scale to zero when inference is not needed, so that expensive GPU VMs are not running during idle periods.

#### Acceptance Criteria

1. THE AKS_Cluster SHALL enable the Cluster_Autoscaler on the GPU_Node_Pool with a minimum node count of 0 and a configurable maximum node count defaulting to 2
2. WHEN no pods with GPU resource requests are pending or running on the GPU_Node_Pool, THE Cluster_Autoscaler SHALL scale the GPU_Node_Pool down to 0 nodes within the configured scale-down delay (default 10 minutes of idle time as defined by the --scale-down-unneeded-time autoscaler profile setting)
3. WHEN a pod with a GPU resource request is created (e.g., by scaling a GPU Deployment from 0 to 1 replica), THE Cluster_Autoscaler SHALL provision a new GPU node and the pod SHALL transition from Pending to Running within 15 minutes; IF the pod remains Pending for more than 15 minutes, THEN THE Deployment_System SHALL report a scaling failure event including the pod name and pending reason
4. THE Deployment_System SHALL configure GPU service Deployments with a replica count that can be set to 0 via kubectl scale or the Kubernetes API, triggering the Cluster_Autoscaler to remove idle GPU nodes after the scale-down delay
5. THE AKS_Cluster SHALL enable the Cluster_Autoscaler on the CPU_Node_Pool with a minimum node count of 1 and a configurable maximum node count to maintain service availability for CPU-only workloads while allowing horizontal scaling under load

### Requirement 8: Deployment Automation and Templating

**User Story:** As a DevOps engineer, I want Kubernetes manifests managed via Helm charts or Kustomize, so that deployments are repeatable, environment-specific values are templated, and configuration drift is prevented.

#### Acceptance Criteria

1. THE Deployment_System SHALL package all Kubernetes manifests (Deployments, Services, ConfigMaps, Secrets, NetworkPolicies, PersistentVolumeClaims) into a Helm chart or Kustomize overlay structure with parameterized values for environment-specific configuration
2. THE Deployment_System SHALL store sensitive configuration (database passwords, API keys, tokens) in Kubernetes Secret resources, with values sourced from Azure Key Vault via the AKS Secrets Store CSI Driver or equivalent mechanism
3. WHEN deploying updates to a Deployment, THE Deployment_System SHALL use a rolling update strategy with maxUnavailable set to 0 and maxSurge set to 1, ensuring zero-downtime deployments for each service
4. THE Deployment_System SHALL provide a single deployment command that applies all manifests to the AKS_Cluster, creating or updating resources to match the desired state idempotently, such that running the command multiple times with unchanged inputs produces no resource modifications
5. IF a Deployment fails to reach the desired number of ready replicas within 300 seconds after applying an update, THEN THE Deployment_System SHALL automatically roll back to the previous revision, report the failing Deployment name and pod error events, and exit with a non-zero status code
6. THE Deployment_System SHALL support separate values files (or Kustomize overlays) for development, staging, and production environments, allowing environment-specific resource limits, replica counts, and endpoint configurations
7. WHEN a deployment command is initiated, THE Deployment_System SHALL perform a dry-run validation (helm template --validate or kubectl apply --dry-run=server) against the target cluster and abort with a descriptive error message if any manifest fails schema validation or references undefined resources
8. IF an automatic rollback triggered by criterion 5 fails to restore the previous revision to a healthy state within 120 seconds, THEN THE Deployment_System SHALL preserve the cluster in its current state, report the rollback failure with the affected Deployment name and error details, and exit with a non-zero status code

### Requirement 9: Cluster Ingress and External Access

**User Story:** As a DevOps engineer, I want external traffic routed through a single ingress point, so that public access is controlled, TLS is terminated centrally, and internal services remain unexposed.

#### Acceptance Criteria

1. THE Deployment_System SHALL configure an Ingress resource (or nginx Ingress Controller) that terminates TLS using a minimum of TLS 1.2 and routes external traffic to the nginx and Kong services within the cluster based on host-based or path-based routing rules defined in the Ingress resource specification
2. THE Ingress resource SHALL expose only HTTPS (port 443) to the public internet, with HTTP (port 80) returning a 301 redirect to the equivalent HTTPS URL
3. THE Deployment_System SHALL configure TLS certificates on the Ingress resource, sourced from a Kubernetes Secret of type "kubernetes.io/tls" containing the certificate and private key
4. THE K8s_Manifest for all services other than the Ingress-exposed services (nginx, Kong) SHALL use ClusterIP service type, making them inaccessible from outside the cluster
5. IF an external request targets a service that is not exposed via the Ingress resource, THEN THE AKS_Cluster SHALL reject the connection by not routing the traffic, resulting in a connection timeout or TCP reset at the network level
6. IF the TLS Secret referenced by the Ingress resource is missing or contains an invalid certificate or key, THEN THE Ingress resource SHALL refuse to serve HTTPS traffic on the affected host and the Deployment_System SHALL report the misconfiguration via a Kubernetes Event on the Ingress resource
7. WHEN an external request arrives at the Ingress resource with a host or path that does not match any configured routing rule, THE Ingress resource SHALL return an HTTP 404 response

### Requirement 10: Observability and Health Monitoring

**User Story:** As a DevOps engineer, I want centralized monitoring of cross-node-pool service dependencies, so that GPU and CPU workload health is visible and degraded states are detected quickly.

#### Acceptance Criteria

1. THE Deployment_System SHALL deploy a health monitoring component (as a Kubernetes Deployment scheduled on the CPU_Node_Pool) that polls GPU service readiness endpoints (vLLM /health, TEI /health, TEI_Reranker /health, Dataprep /v1/health) at 10-second intervals and exposes aggregated health status via an HTTP endpoint
2. WHEN a GPU service readiness endpoint fails to return HTTP 200 for 3 consecutive polling cycles, THE health monitoring component SHALL report degraded status for that service within 30 seconds; IF the endpoint fails to return HTTP 200 for 6 consecutive polling cycles (60 seconds), THEN THE health monitoring component SHALL report "unreachable" status for that service
3. THE Deployment_System SHALL configure Kubernetes Events or a logging system to capture pod scheduling failures due to insufficient GPU resources, taint conflicts, or node pool scaling delays, queryable for at least 24 hours after occurrence
4. WHEN the GPU_Node_Pool is scaled to 0 nodes and a GPU pod is pending, THE health monitoring component SHALL report the GPU services as "scaled-down" (distinct from "unhealthy") until the Cluster_Autoscaler provisions a node
5. THE health monitoring component SHALL expose a /health-status endpoint returning a JSON response containing the status of each GPU service (vLLM, TEI, TEI_Reranker, Dataprep) and each CPU service dependency (ArangoDB, Kong, Keycloak, backend, redis-cache) as "healthy", "degraded", "scaled-down", or "unreachable", with a response time of no more than 5 seconds
6. WHEN a service previously reported as "degraded" or "unreachable" returns HTTP 200 on its readiness endpoint for 2 consecutive polling cycles, THE health monitoring component SHALL restore that service's status to "healthy" within 20 seconds
7. THE health monitoring component SHALL poll CPU service readiness endpoints (ArangoDB, Kong, Keycloak, backend, redis-cache) at 10-second intervals using TCP connection checks or HTTP health endpoints to detect CPU_Node_Pool service failures
