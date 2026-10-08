# GENIE.AI Helm Charts — Design Spec

**Author:** Superpower brainstorming + bmad-party-mode panel
**Date:** 2026-10-08
**Status:** Draft v1 — awaiting user review

---

## 1. Goals

Ship a Helm-based deployment of GENIE.AI on any CNCF-conformant Kubernetes cluster (1.30+), with:

1. **One-command install** — `helm install genieai-genie charts/genieai-umbrella` brings up the entire GENIE.AI stack in a single transaction.
2. **Pluggable infrastructure choices** — secrets delivery, ingress controller, storage class, container runtime are all values-driven; no chart-level rebuild required.
3. **Operators-first for stateful services** — PostgreSQL via CloudNativePG, ArangoDB via kube-arangodb, Keycloak via the official operator, observability stack via vmoperator. The chart consumes these as Helm `dependencies` with `condition:` toggles.
4. **Phased migration compatibility** — the chart can be installed partial-by-partial (per group) so a phased group-by-group cutover from Docker Swarm is supportable.
5. **Multi-environment values layering** — `values.yaml` (default), `values-<env>.yaml` (dev/staging/prod/sovereign) for env-specific overrides; no chart forks per env.
6. **Tested in CI** — `helm lint`, `helm template`, `helm-docs`, `chart-testing` (`ct lint`/`ct install`) on every MR. Production-readiness signalled by status badges on `charts/README.md`.

## 2. Non-Goals

- **GitOps choice** (ArgoCD vs Flux) — chart must satisfy any GitOps engine that consumes Helm. We do not pick. Pilot target: `ArgoCD` per user habit; written so Flux also works.
- **K8s distribution choice** (AKS/EKS/GKE/on-prem/k3s/RKE2) — chart assumes CNCF-conformant cluster. Distribution-specific work is **out of scope**; documented, not authored.
- **Continuous secret rotation** beyond TLS certs — secrets delivery is pluggable; auto-rotation across all backends is not a v1 problem.
- **Disk image authoring** (`genie-ai-overlay/` Dockerfile maintenance) — out of scope. Chart consumes pre-built images referenced by tag.
- **Mobile Flutter build pipeline**, **frontend Vue build pipeline**, **backend Node build pipeline** — unchanged. Chart deploys pre-built artefacts.
- **Multi-cluster** (federated, replicated, hub-spoke) — single-cluster per `helm install` only. Multi-cluster is a future epic.
- **Auto-scaling based on AI/ML workload characteristics** — manual replica sizing for v1. KEDA/HPA is a v2+ concern.

## 3. Chart topology

```
genie-ai/
├── charts/
│   ├── genieai-common/                # Library chart (reusable templates + helpers)
│   │   ├── Chart.yaml
│   │   ├── templates/
│   │   │   ├── _deployment.tpl       # standard 3-replica-style Deployment
│   │   │   ├── _service.tpl          # standard Service + serviceMonitor toggle
│   │   │   ├── _configmap.tpl        # env-on-ConfigMap pattern
│   │   │   ├── _pvc.tpl              # PVC + storageClassName + accessModes
│   │   │   ├── _networkpolicy.tpl    # default-deny + per-tier allowlist
│   │   │   ├── _serviceaccount.tpl   # dedicated SA + RoleBinding
│   │   │   └── _helpers.tpl          # name/fullname/labels/selectors/annotations
│   │   ├── values.schema.json        # JSON schema for values validation
│   │   └── README.md
│   └── genieai-umbrella/             # Umbrella chart (single install, 26 services)
│       ├── Chart.yaml                # depends on genieai-common + operators-as-deps
│       ├── values.yaml               # DEFAULTS only (chart is generic + org-shareable)
│       ├── templates/
│       │   ├── _data-deps/           # CloudNativePG Cluster, kube-arangodb, etc.
│       │   ├── _services/            # 26 app-tier Deployments+Services+NetworkPolicies
│       │   ├── _ingress.yaml         # Gateway resource (Envoy Gateway by default)
│       │   ├── _secrets.yaml         # external secrets wrapper
│       │   └── _namespace.yaml
│       ├── tests/
│       ├── ci/
│       └── README.md
├── deploy/
│   ├── ansible/                      # existing Swarm Ansible (unchanged)
│   └── environments/                 # K8s per-env config (NEW in this epic)
│       ├── base/                     # Kustomize base (mirrors Helm defaults)
│       ├── dev/                      # k3s single-node dev
│       │   ├── kustomization.yaml    # patches over base + values files ref
│       │   └── values-override.yaml  # env-specific Helm values
│       ├── staging/
│       ├── prod/
│       └── el-salvador/              # high-customization env (uses release/el-salvador branch)
│           ├── kustomization.yaml
│           ├── values-override.yaml
│           └── sovereign-patches.yaml  # air-gap, FIPS, sovereign DNS, etc.
├── _bmad-output/                     # existing BMAD artefacts (unchanged)
├── site/                             # docs site (unchanged)
└── (rest of the repo unchanged)
```

`genieai-common` is a library chart (`type: library` in Chart.yaml). It provides templating primitives consumed by `genieai-umbrella` via `dependencies:` with `import-values:`. Subordinate umbrellas (e.g. `genieai-edge` for sovereign deployments) can also consume `genieai-common` later without duplicating template files.

**Per-env config lives OUTSIDE the chart** in `deploy/environments/<env>/`. Rationale: the chart stays generic + org-shareable; env config is project-specific and has its own evolution cadence (el-salvador gets 10× more changes than `prod`). Mirrors the Ansible convention of `group_vars/<env>/` for env config sitting beside deployment code.

## 4. Dependency model

`genieai-umbrella/Chart.yaml` declares dependencies. Every operator/subchart has a `condition:` toggle in values so installing-without-data is supportable (bootstrapping pattern).

| Helm dep | Repo | Version constraint | Default `condition:` | Pulled iff |
|---|---|---|---|---|
| `genieai-common` | local file:// | `~> 0.1.0` | unconditional | always |
| `postgresql` (CloudNativePG) | `https://cloudnative-pg.github.io/charts` | `~> 0.22.0` (mirrors CNPG 1.30) | `data.postgres.enabled` | Kong + Keycloak DBs |
| `kube-arangodb` | `https://arangodb.github.io/kube-arangodb` | `~> 1.4.5` | `data.arangodb.enabled` | always |
| `keycloak-operator` | `https://keycloak.github.io/keycloak-operator-helm` (official) | `~> 26.0.0` | `data.keycloak.enabled` | always |
| `external-secrets-operator` (ESO) | `https://charts.external-secrets.io` | `~> 0.10.0` | `secrets.eso.enabled` | when `pluggable.secretsBackend: externalSecrets` |
| `sealed-secrets` | `https://bitnami.github.io/sealed-secrets` (NOT the deprecated `charts.bitnami.com/bitnami/sealed-secrets`) | `~> 2.20.0` (corresponds to controller v0.40.0+) | `secrets.sealedSecrets.enabled` | always (default backend) |
| `victoria-metrics-operator` | `https://victoriametrics.github.io/helm-charts` | `~> 0.45.0` | `observability.enabled` | profile-gated |
| `victoria-logs-operator` | same chart family | `~> 0.10.0` | `observability.logs.enabled` | profile-gated |
| `victoria-traces-operator` | same chart family | `~> 0.5.0` | `observability.traces.enabled` | profile-gated |
| `opentelemetry-operator` | `https://open-telemetry.github.io/opentelemetry-helm-charts` | `~> 0.50.0` | `observability.otel.enabled` | profile-gated |
| `gpu-operator` | `https://nvidia.github.io/gpu-operator` | `~> v25.x` | `gpu.enabled` | GPU clusters only |
| `cert-manager` | `https://charts.jetstack.io` | `~> 1.21.0` | `certManager.enabled` | if `ingress.tls.issuer: cert-manager` |
| `envoy-gateway` | `https://gateway.envoyproxy.io/charts` (or local OCI) | `~> 1.0.0` | `ingress.className: envoy` | if Envoy Gateway chosen |

**Version-pin discipline (`~>` for CRD owners)**: CRD schemas change between minor releases for `cloudnative-pg`, `kube-arangodb`, `keycloak-operator`, `external-secrets-operator`, and `vmoperator`. `>= X.Y.Z` allows silent breaking changes in CRD shape between patch bumps; `~> X.Y.Z` constrains to the same minor. `~>` is mandatory for these. **Off-CRD deps** (GPU operator, cert-manager, gateway) tolerate `~>` less strictly but use it for reproducibility.

**ESO controller `~> 0.10.0`** (separate from keycloak-operator pin) — the ExternalSecret CRD shape changed in 0.9→0.10. Pin strictly.

**No `appVersion:` chaos** — each dep's `appVersion` propagates via its own chart; umbrella's `appVersion` = chart version, **not** GENIE.AI app version (semver divide between chart layout and product release).

## 5. Values schema (umbrella)

Top-level keys in `values.yaml`. JSON schema in `genieai-common/values.schema.json`.

```yaml
# genieai-umbrella values schema — v1
namespace: genieai
releaseName: ""           # let helm set this

global:
  imageRegistry: ""       # default "" = docker.io; plugable for sovereign/airgap
  imagePullSecrets: []
  imagePullPolicy: IfNotPresent

pluggable:
  secretsBackend: sealedSecrets     # sealedSecrets (default) | externalSecrets | secretProviderClass
  ingressClassName: envoy           # envoy | nginx-fabric | traefik
  storageClassName: ""              # default = cluster default
  containerRuntime: containerd      # containerd (K8s 1.24+ standard)

data:
  postgres:
    enabled: true
    storageSize: 10Gi
    instances: 3                    # HA
  arangodb:
    enabled: true
    storageSize: 50Gi
    mode: cluster                   # single | cluster
  keycloak:
    enabled: true
    realmImport: true               # apply KeycloakRealm CRs

observability:
  enabled: false                    # profile-gated default off
  metrics: { enabled: false, retention: 30d }
  logs:    { enabled: false, retention: 30d }
  traces:  { enabled: false, retention: 30d }
  otel:    { enabled: false }

ingress:
  enabled: true
  className: envoy
  host: genieai.local
  tls:
    enabled: true
    issuer: cert-manager            # cert-manager | external | none
    secretName: ""                  # use cert-manager annotation if empty

services:
  backend:           { enabled: true, replicas: 1, resources: {...} }
  frontend:          { enabled: true, replicas: 1, resources: {...} }
  documentRepository: { enabled: true, replicas: 1 }
  nginx:             { enabled: true, replicas: 1 }
  kong:              { enabled: true, replicas: 1, dbMode: postgres }
  # ... 21 more service entries, each `{enabled, replicas, resources, ...}`

gpu:
  enabled: false                    # require `services.*` group 6 to be flagged
  nodeSelector:
    nvidia.com/gpu: present

migration:
  swarmFallback: false              # dual-stack bridge to legacy Docker Swarm
  swarmEndpoint: ""                 # if true, app tier routes partly to Swarm
```

**Per-service entry shape**:

```yaml
services:
  backend:
    enabled: true
    replicas: 2
    image:
      repository: genieai-backend
      tag: latest
    resources:
      requests: { cpu: 100m, memory: 256Mi }
      limits:   { cpu: 1,    memory: 1Gi }
    env: []                         # raw list; `_env-from-secret` helper resolves
    secrets: []                     # names in `secretsVault.genieai`
    pvc: null                       # optional PVC mount spec
    probes: { readiness: httpGet, liveness: httpGet, startup: null }
    podDisruptionBudget: { minAvailable: 1 }
    serviceMonitor: false           # if observability enabled, attach Prometheus scrape
```

### 5.1 Dependency graph + pre-install validation

Services and data layers have **declared dependencies** that must be satisfied before install. The chart ships `genieai-umbrella/templates/_lib/dependency-graph.yaml`:

```yaml
# Each entry: <service> requires <other-services-and-data-enabled>
dependencies:
  services:
    backend:           [data.arangodb, keycloak]
    frontend:          [services.backend]            # SPA calls BFF
    kong:              [services.backend, data.postgres]  # DB mode
    documentRepository:[services.backend]            # shared auth chain
    clamav:            []                            # standalone
    redis:             []
    vllm:              []
    tei:               []
  data:
    postgres:          []
    arangodb:          []
    keycloak:          [data.postgres]
  observability:
    otel:              [observability.metrics|observability.logs]  # otel only useful if data sink exists
```

Pre-install validation is a **chart hook** (a Job in `templates/hooks/pre-install-dependency-check.yaml`) that runs `helm template` against the merged values, parses the rendered manifests, and verifies:

1. Every `services.<X>.enabled: true` has its declared dependencies `enabled: true`.
2. If a user disables a dependency (e.g., `data.arangodb.enabled: false` with `services.backend.enabled: true`), the Job **fails** with a clear error listing the missing deps.
3. ClusterProfile is **auto-detected** when the Job runs (looks for `genieai.io/cluster-profile` label on the namespace); if profile=`prod` and `observability.enabled: false`, Job warns (but does not fail) — operators can override via annotation `genieai.io/skip-observability-warning: "true"`.

CI runs the same Job in dry-run mode on every MR that touches `charts/` or `deploy/environments/`. Fail-fast at PR review.

### 5.2 ClusterProfile-based defaults

**Mechanism**: `clusterProfile` is a value that drives chart-derived defaults (CNPG instances, arangodb mode, replicas, observability default). Two ways to set:

1. **`values.yaml` (default `dev`)**: operator passes `--set clusterProfile=prod` at install.
2. **Pre-install hook (`templates/hooks/pre-install-clusterprofile-detect.yaml`)**: reads namespace label `genieai.io/cluster-profile=dev|staging|prod|sovereign`, emits a Kubernetes `Event` recording the detected profile, and writes the detected profile to the release annotation `genieai.io/detected-cluster-profile=...`. **The hook does NOT mutate Helm-rendered values**: Helm does not re-render mid-install.

**Practical consequence**: auto-detection is **decorative** — the namespace label feeds observability/logs/metrics, but the chart's CNPG instances / Arango mode are determined by what the operator passed to `helm install`. Labeling the namespace after install changes the next **upgrade** (if `--set clusterProfile=...` is also passed), not the current install.

For an operator to make auto-detection authoritative, the operator must ALSO pass `--set clusterProfile=$(kubectl get ns $NS -o jsonpath='{.metadata.labels.genieai\.io/cluster-profile}')` at install time. The hook's job is to make that workflow more discoverable (via the Event), not to bypass Helm's rendering model.

```yaml
# ClusterProfile from label on namespace
# genieai.io/cluster-profile=dev|staging|prod|sovereign
# Mutually exclusive with values.yaml bootstrapping until first install.
# Without `--set`, the chart renders with `clusterProfile: dev` defaults
# regardless of the namespace label.

clusterProfile: dev  # set by helm install --set, not auto-detected at runtime
```

When `clusterProfile: prod`:
- `observability.enabled: true` (overrides default)
- `data.postgres.instances: 3`
- `data.arangodb.mode: cluster`
- `keycloak.replicas: 2`
- `replicas.*: 2` minimum for stateless services

When `clusterProfile: dev`:
- `observability.enabled: false` (default)
- `data.postgres.instances: 1`
- `data.arangodb.mode: single`
- `replicas.*: 1`

When `clusterProfile: sovereign`:
- `pluggable.secretsBackend: sealedSecrets` (matches v1 ship; future `externalSecrets` toggles this)
- `pluggable.ingressClassName: envoy`
- `pluggable.storageClassName: ""` (operator-determined)
- `ingress.tls.issuer: cert-manager` with DNS-01 to sovereign DNS

## 6. Pluggability surface

Each pluggable point has a values key, a `_lib` template that branches on it, and a documented backend. Implementing a backend means writing one or two template files; no chart-level rewrite.

| Plug point | Values key | Default backend | Backends supported (v1) |
|---|---|---|---|
| Secrets delivery | `pluggable.secretsBackend` | `sealedSecrets` | `sealedSecrets` (default; chart ships Bitnami-published sealed-secrets helm chart), `externalSecrets` (ESO with Vault), `secretProviderClass` (Azure CSI). Single-backend ship per YAGNI, plug-point design documented for future backends. |
| Ingress | `pluggable.ingressClassName` | `envoy` | `envoy` (Envoy Gateway), `nginx-fabric` (NGINX Gateway Fabric), `traefik` |
| TLS issuer | `ingress.tls.issuer` | `cert-manager` | `cert-manager`, `external` (cert volume), `none` |
| Storage class | `pluggable.storageClassName` | cluster default | cluster-default, SC name, empty = dynamic provisioning |
| Image registry | `global.imageRegistry` | `docker.io` | any OCI-compliant registry |
| Container runtime | `pluggable.containerRuntime` | `containerd` | `containerd` (1.24+ standard), `cri-o` |

For each plug point, the chart ships a **default backend's templates**, with the plug-point design (template directory per backend + a `when:` clause in `_helpers.tpl`) ready for new backends without chart-level rewrite. **New backends** are added to template directories under `_lib/<plugpoint>-<backend>/` and registered in `when:` clauses.

### 6.1 Migration path between secrets backends

Switching `pluggable.secretsBackend` between installs (`externalSecrets` → `sealedSecrets`, etc.) leaves the prior backend's CRs (`ExternalSecret`, `SealedSecret`, `SecretProviderClass`) in the cluster. The chart does not delete them on uninstall or swap. Manual reconciliation needed.

**Shipped migration playbook** (`docs/charts/secrets-migration.md`) covers:

- `externalSecrets → sealedSecrets`: Vault paths stay the same; on next deploy, ESO controllers offline the synced K8s Secrets, then `kubeseal`-encrypted files rotate in. Rollback within 24h if Vault path reconciliation fails.
- `externalSecrets → secretProviderClass`: AKV targets must already exist; chart's `templates/_lib/secrets-aks-spn/` references the AKV URI; manual `kubectl delete externalsecret,secretstore` first.
- `secretProviderClass → externalSecrets`: AKV vault setup required; chart does not auto-create Vault roles.

**Upgrade-time hook** (`pre-upgrade-secrets-reconcile` Job) reads `pluggable.secretsBackend` (new) vs the label `genieai.io/secrets-backend` (last deployed) on the release, and **fails** the upgrade if they differ without an annotation `genieai.io/acknowledge-secrets-migration: "<from>→<to>"`.

### 6.2 Single-backend ships; document others as plug-points

Per YAGNI discipline (Code Review pass, Y2): the chart ships only `externalSecrets` rendered. Templates for `sealedSecrets` and `secretProviderClass` are **not yet authored**; the plug-point design is documented in `docs/charts/pluggable-backends.md` so a later MR can add them. This avoids premature template triplication while preserving the pluggability surface area.

## 7. Component surface (app tier, 26 services)

Service inventory from the existing Swarm `docker-compose.yaml` (surveyed 2026-10-08). Each service in the chart gets:
- a `services.<name>` toggle block in values
- a `<name>-deployment.yaml` template under `templates/_services/`
- a `<name>-service.yaml` template
- a `<name>-networkpolicy.yaml` (default-deny + explicit allowlist)
- an entry in `tests/connectivity_test.yaml` if `enabled: true`

**Group 5 (stateless app, move first)**: backend, frontend, document-repository, nginx, kong, clamav.

**Group 2 (cache, ephemeral state)**: redis.

**Group 1 (observability)**: victoria-{metrics,logs,traces}, opentelemetry-collector, grafana (optional).

**Group 4 (identity)**: keycloak, postgres cluster (CloudNativePG) — **mirror before cutover**.

**Group 6 (AI/ML)**: vllm, vllm-translation-guardrail, tei, **tei-reranker dropped — no equivalent in `docker-compose.yaml`**, chatqna-xeon-{backend,ui,nginx}, embedding, reranker, textgen, translation, guardrail, dataprep-arango-service, retriever-arango-service.

**Group 3 (vector DB, last)**: arangodb.

**Count**: 28 services total (Group 5=6 + Group 2=1 + Group 1=5 + Group 4=2 + Group 6=13 + Group 3=1). `redis` lives in Group 2 (cache role); it is **not** duplicated into Group 5. `tei-reranker` was originally listed in earlier drafts but does not appear in the current Swarm `docker-compose.yaml` (which has separate `tei` and `reranker` services); the third-party mention had no live counterpart. Services like `translation-cache` and `httpService` do not appear in current Swarm and are scoped to a later epic if reintroduced.

Each group's chart enabling is independent. Day 0 install: `data.postgres.enabled=false data.arangodb.enabled=false services.*.enabled=true` for a partial install pattern during phased migration.

## 8. Secrets model

**Sole pattern**: chart does NOT bake secrets into templates. Every secret reference resolves at runtime via a pluggable backend.

**Default (`pluggable.secretsBackend: sealedSecrets`)** — **v1 ships sealedSecrets templates only** (YAGNI per §6.2 single-backend principle):

`SealedSecret` CRs (per required secret) reference the in-cluster controller. Encrypted blobs ship in Git; controller decrypts on the cluster using its in-memory private key.

- Helm dep: `sealed-secrets/sealed-secrets` chart at `https://bitnami.github.io/sealed-secrets`, version `~> 2.20.0` (controller v0.40.0+, covers CVE-2026-22728 + CVE-2026-59341).
- `SealedSecret` resources per service / data dependency. Each resource references the controller's public key during `kubeseal` encryption (offline workflow).
- Service envFrom:
  ```yaml
  envFrom:
    - secretRef:
        name: {{ include "genieai-common.fullname" . }}-{{ .service.name }}
  ```

**Rotation story (as of sealed-secrets v0.40.0)**:
- **Cluster master key**: now **auto-rotates every 30 days by default** (v0.40.0 release note).
- **Service-token secrets** (the actual K8s `Secret` resources): still manual. To rotate, re-encrypt with `kubeseal` against the current cluster public key and push the new `SealedSecret`.
- **Audit**: Git history records who/what/when for each `SealedSecret` change. Sufficient for sovereignty P0; not equivalent to Vault's audit device for compliance attestations.

**Operational workflow** (sovereign / air-gap):
1. CI/dev holds the cluster public key (fetched via `kubeseal --fetch-cert` against the cluster or downloaded from controller Service).
2. Engineer runs `kubeseal --cert pub-cert.pem --context=kubeseal-staging --scope namespace --name secret-name` locally to produce an encrypted blob.
3. Encrypted blob committed in Git under `deploy/environments/<env>/secrets/<name>.yaml`.
4. `helm install` re-renders the chart; controller decrypts on next sync, K8s Secret materialises.
5. Rotation: pull latest cert, re-encrypt, commit, deploy.

**Single-backend ship (per §6.2)**:
- **v1**: ONLY `sealedSecrets` rendered as actual templates. Spec sections + plug-point design are documented for the others.
- **Why this matters**: §4 dep table lists sealed-secrets, §6 pluggability surface mentions both `externalSecrets` and `sealedSecrets` as plug-points. **§6.2 explicitly limits v1 templates to sealedSecrets**. Reviewing code that adds `ExternalSecret` resources is off-spec until §6.2 changes.

**Fallbacks (documented, NOT shipped in v1 — plug-point design per §6.2)**:
- `secretsBackend: externalSecrets` — chart would ship `ExternalSecret` CRs; requires HashiCorp Vault + auditor + rotation policy. Deferred to whoever needs it.
- `secretsBackend: secretProviderClass` — chart would ship Azure CSI `SecretProviderClass`; requires AKS + AKV. Deferred.

**Migration input**: 14 secrets required by current `.env`, names in `secrets.genieai: { arangoPassword, translationCachePassword, postgresPassword, kongDbPassword, keycloakDbPassword, keycloakAdminPassword, keycloakClientSecret, keycloakProxyClientSecret, kcDataprepClientSecret, genieAdminPassword, emailPassword, grafanaAdminPassword, kcGrafanaClientSecret, huggingFaceHubToken }`. (Note: with kong in DB-less mode per Plan 2, `kongDbPassword` becomes unused.)

## 9. Ingress + TLS

**Default**: Envoy Gateway (`Gateway` + `HTTPRoute` resources).

- `Gateway` listens on 80/443 with TLS termination.
- `HTTPRoute` for `/api/*` → kong:8000 service.
- `HTTPRoute` for `/*` → nginx:80 service (frontend SPA).
- TLS via `cert-manager` ClusterIssuer (default) for internet-reachable CAs. Sealed Secrets does not directly cover TLS certs; for offline sovereign deploys, certificates are pre-baked into a `Secret` and the chart's `values-override.yaml` references them via `secretName` (no `cert-manager` resource emits).

**Fallback**: `nginx-fabric` for teams that need NGINX semantics; `traefik` if user fancies it.

**Underlying relay**: Gateway API resources are the public abstraction; concrete Gateway impl is a `parametersRef` on the Gateway spec.

## 10. Observability stack

Profile-gated. **Default depends on clusterProfile** (§5.2): dev=off, staging=on, prod=on, sovereign=on. Operators can override per env by setting `observability.enabled` directly in `values-override.yaml`.

When on:
- `vmoperator` deploys `VMSingle`/`VMCluster`, `VLSingle`, `VTSingle` (all single-node for dev; cluster for staging+).
- `opentelemetry-operator` deploys `OpenTelemetryCollector` per node + central gateway.
- All services get `serviceMonitor` annotations conditionally.
- `grafana` subchart (lightweight, no operator) for dashboarding.

PII redaction, currently in the Swarm `fluentd` driver config, becomes an OpenTelemetry Collector `transform` processor (same regex rules, ported once).

## 11. GPU / AI workloads

`gpu.enabled: true` triggers `nvidia/gpu-operator` install. Per-service toggles for vllm, tei, tei-reranker, etc. hold `nodeSelector: { nvidia.com/gpu: present }` and `tolerations: [{ key: nvidia.com/gpu, operator: Exists }]`.

vLLM/TEI resources remain governed by `services.*.resources`; `gpu.limitsPerService` is a v2+ knob (24GB cards + MIG vs time-slicing).

## 12. Migration tie-in

The chart supports three install patterns:

```bash
# Pattern A — full install on a greenfield cluster
helm install genieai-prd ./genieai-umbrella -n genieai \
  -f ./charts/genieai-umbrella/values.yaml \
  -f ./deploy/environments/prod/values-override.yaml

# Pattern B — partial install during phased migration
helm install genieai-prd ./genieai-umbrella -n genieai \
  -f ./charts/genieai-umbrella/values.yaml \
  -f ./deploy/environments/migration-step1.yaml \
  --set data.postgres.enabled=true \
  --set data.arangodb.enabled=false \
  --set services.frontend.enabled=true \
  --set services.backend.enabled=true

# Pattern C — Swarm bridge (legacy coexistence)
helm install genieai-edge ./genieai-umbrella -n genieai-edge \
  -f ./charts/genieai-umbrella/values.yaml \
  -f ./deploy/environments/sovereign/values-override.yaml \
  --set migration.swarmFallback=true \
  --set migration.swarmEndpoint=http://10.0.0.102:443
```

Each pattern produces a working install. Pattern A is the v1 target. B and C exist to keep options open during phased migration.

Per-env install in practice:
- **Plain envs** (dev, staging, prod): `values-override.yaml` lives in `deploy/environments/<env>/`. ArgoCD ApplicationSet pulls from `main` branch + renders the override file at the same ref.
- **High-customization envs** (el-salvador): same path, on `release/el-salvador` branch. Production reference is whichever ArgoCD Application is configured for the .102 cluster.

`release/<env>` branches modify ONLY `deploy/environments/<env>/` and any overlay content. The chart source under `charts/` is untouched — same source across all envs, differing only in overlay values. This is the K8s-idiomatic equivalent of today's "branch carries env customizations, deploy.yml reads them."

## 13. Test strategy

Three layers:

1. **Template/structure** — `helm lint`, `helm template --strict`, `chart-testing ct lint`, `helm-docs --check`.
2. **Cluster** — `ct install` (kind cluster), `helm test` (Pods with `assert` images).
3. **Functional** — smoke tests in `tests/connectivity_test.yaml` that hit the deployed umbrella with `curl` against the gateway and verify `/api/health`, `/api/auth/...`, `/` (frontend SPA).

**Pre-merge** (CI `lint` stage): template-only tests + `--dry-run --debug`.
**Pre-merge** (CI `integration` stage): `ct install` against kind + `helm test` + smoke against forwarded gateway port.
**Pre-release** (`scan` stage): Trivy on the umbrella plus a `trivy` config scan.

CI integration: `.gitlab-ci.yml` adds three new jobs (`charts:lint`, `charts:integration`, `charts:scan`). Every MR touching `charts/**` triggers them. Status badges in `charts/README.md`.

### 13.1 Uninstall safety + pre-install backup hook

Stateful chart uninstalls are a **P0 day-1 risk**. `helm uninstall` on a successful install removes all rendered manifests including the StatefulSet's PVCs (CloudNativePG, kube-arangodb, keycloak-db Postgres, victoria-* stores, document-uploads). Data destroyed.

Two protections:

**(a) Pre-install backup hook** — a `Job` chart-hook on `pre-install` and `pre-upgrade` runs `velero backup create` (or `pg_basebackup` + `arangodump` for databases if Velero unavailable). The hook is configurable to skip on dev clusters (`clusterProfile: dev`) but **mandatory for staging/prod**.

**(b) Confirmation gate** — a `pre-delete` chart-hook **blocks** `helm uninstall` unless the operator confirms via release annotation `genieai.io/allow-destructive-uninstall: "true"`. The two gating mechanisms are **mutually exclusive**:

```bash
# Refused by hook (default state):
kubectl label hr/genieai-prd genieai.io/allow-destructive-uninstall=false
helm uninstall genieai-prd
# helm exits with: Error: pre-delete hook failed: ...

# Acceptable paths:
# (1) Label the release, then uninstall — gate validates label:
kubectl annotate hr/genieai-prd genieai.io/allow-destructive-uninstall=true --overwrite
helm uninstall genieai-prd               # (gate accepts because annotation is set)

# (2) Skip the hook entirely — destruction is the operator's call:
helm uninstall genieai-prd --no-hooks    # (gate never fires)
```

**Important**: `--no-hooks` is the **break-glass path** that bypasses the gate. Standard policy is path (1) — annotate-and-uninstall — to keep an auditable trail. `--no-hooks` is reserved for emergency operations where the gate itself is corrupted. **Both paths are supported; neither requires the other.**

For non-stateful-only installs (e.g., dev cluster with all PVCs ephemeral), the hook shortcuts to "just uninstall" by checking `secrets.pvc.transient: true` annotation on the release; if set, gate immediately approves.

### 13.2 Secret-leak lint rule

CI runs `conftest` (OPA Rego) on `deploy/environments/**/*.yaml` and rejects:

```rego
# policies/secret-leak.rego
deny[msg] {
  input.kind == "ConfigMap"
  some k, v
  input.data[k]
  regex.match(`(?i)(password|secret|token|apikey)`, k)
  v != ""
  msg := sprintf("configmap has secret-shaped key %q — use ESO instead", [k])
}

deny[msg] {
  input.kind == "Secret"
  not input.metadata.annotations["genieai.io/managed-by"]
  msg := "raw Secret resource; secrets must go through ESO / Sealed / SecretProviderClass"
}

# Block high-entropy strings in known value paths
deny[msg] {
  input.kind == "ConfigMap"
  val := input.data["value"]
  is_high_entropy(val)  # Shannon entropy threshold 4.5 over 20+ chars
  msg := "configmap value has high-entropy string — likely a leaked secret"
}
```

A leaked secret triggers **CI fail** with file:line + suggested fix (`run ESO external-secret with vault path: secret/data/genieai/<name>`).

### 13.3 Chart-schema-drift vs env-override CI alert

CI rule on every MR touching `charts/genieai-umbrella/values.yaml`:

```python
# scripts/check-env-overrides.py
# Compares keys present in charts/.../values.yaml (the chart's defaults) vs
# keys present in deploy/environments/*/values-override.yaml on release branches.
# Alert (PR comment) if a release-branch env override is missing the new key —
# it'll silently fall through to the new default at the next deploy.

for branch in ['release/el-salvador']:  # configurable per epic
    env_overrides = yaml.safe_load_all_from(branch, 'deploy/environments/*/values-override.yaml')
    for env, override in env_overrides.items():
        missing_keys = chart_defaults.keys() - override.keys()
        if missing_keys:
            warning(f"{env} is missing key(s) {missing_keys} — these will use new defaults at next deploy")
```

**P1, not blocker** — drift is silent at deploy, loud at next incident.

## 14. CI integration

Existing `.gitlab-ci.yml` has stages `lint → test → config → build → scan → e2e → promote`. Insert:

- `lint` stage: `charts:lint` (helm lint + helm-docs check + ct lint).
- `scan` stage: `charts:scan` (Trivy, configuration scan only).
- A new stage `charts:integration` between `build` and `scan` (cluster install + helm test on kind).

OCI registry promotion: `publish:charts` job uploads the umbrella to the existing GitLab Container Registry (`<registry>/genieai/umbrella:<version>`). Tag-on-main. Track via Renovate for dep version bumps.

### 14.1 Image signing + verification

Every chart published to the registry is **cosign-signed** in CI:

```yaml
# .gitlab-ci.yml (chart publish job)
publish:charts:
  stage: charts:publish
  script:
    - helm package charts/genieai-umbrella -d .publish/
    # cosign uses URI schemes — `env://` is the env-var resolver.
    # Bare `env:COSIGN_KEY` is NOT a recognized scheme; cosign errors out.
    - cosign sign --key env://COSIGN_KEY ${CI_REGISTRY_IMAGE}/genieai/umbrella:${CI_COMMIT_TAG}
    - cosign attest --predicate release-audit.json --type slsaprovenance ${CI_REGISTRY_IMAGE}/genieai/umbrella:${CI_COMMIT_TAG}
    - helm push .publish/genieai-umbrella-${CI_COMMIT_TAG}.tgz oci://${CI_REGISTRY_IMAGE}/genieai
```

Cluster-side enforcement via **Kyverno** policy (chart installs as part of bootstrap). Kyverno's `verifyImages.attestors.entries.keys` does NOT accept cosign-style URIs — the public key must live in a Kubernetes `Secret`. The chart renders a `Secret` containing the cosign public key, and Kyverno's policy references it:

```yaml
# Secret holding the cosign public key (rendered by the chart or pre-installed by CI):
apiVersion: v1
kind: Secret
metadata:
  name: cosign-pubkey
  namespace: kyverno
type: Opaque
data:
  key: <base64-encoded-PEM>
---
# Kyverno ClusterPolicy — references the Secret, NOT a cosign URI
apiVersion: kyverno.io/v1
kind: ClusterPolicy
metadata:
  name: verify-chart-image-signatures
spec:
  validationFailureAction: Enforce
  rules:
    - name: verify-signature
      match:
        any:
          - resources:
              kinds: ["Pod"]
      verifyImages:
        - imageReferences:
            - "registry.gitlab.com/un/itu/genie-ai/*"
          attestors:
            - entries:
                - keys:
                    publicKeys: "secret:cosign-pubkey#key"
```

Without cosign signing + Kyverno enforcement, a registry compromise yields full cluster take (research flagged CVE-2025-1974's "default-Secrets-read" as the same attack shape — chart's installer must not lower the bar).

### 14.2 Renovate for dep version bumps

Renovate bot tracked in `renovate.json` updates `charts/genieai-umbrella/Chart.yaml` `dependencies:` blocks weekly. Locked-via-`~>` versions update within minor, never silently break CRD shapes. PR auto-opens with the pre-install-dependency-check job running against the new chart artifact.

## 15. Documentation

Spec'd under `site/content/en/docs/deployment/kubernetes-helm.md` (new page, public docs site). Pull-down of:
- installation matrix (env → values file → expected install time)
- values.yaml field reference
- pluggable backends table
- phased migration playbook

Internal ops docs under `docs/charts/` (K8s-only, dev-internal, not published):
- `docs/charts/operator-selection.md` — why these deps
- `docs/charts/migration-playbook.md` — group-by-group cutover
- `docs/charts/secrets-backend-matrix.md` — ESO/Vault/AKV/Sealed
- `docs/charts/ci-cd.md` — gitlab-ci integration notes

## 16. Open questions

These are deliberate unknowns NOT blocking v1, but documented for follow-up:

1. **Pluggable secrets delivery default**: `sealedSecrets` is current default (per research v2 sealed-secrets run, 2026-10-08). Helm dep pinned to `~> 2.20.0` (controller `>= v0.40.0`, CVE-free). Chart ships ONLY this backend in v1 (template code, no plug-point duplication). Adding `externalSecrets` (ESO + Vault) and `secretProviderClass` (Azure CSI) later is documented in `docs/charts/pluggable-backends.md`. Self-rationale (2026-10-08): sovereign public-sector posture + no Vault available + sealed-secrets v0.40.0 brings 30-day auto-rotation for cluster keys.
2. **Multi-cluster topology**: not v1. Documented in roadmap.
3. **GPU sharing (MIG/MPS/time-slicing)**: per-service fine-grained control on 24GB cards is a v2 epic; v1 keeps simple `nodeSelector` and `replicas`. **GPU nodePool validation** (G2) — `gpu.enabled: true` should require `gpu.nodePoolRef` to be set against a labelled node pool; without GPU nodes, the NVIDIA operator DaemonSet crashloops. P2 to add in v1.1.
4. **Connection pooling (PgBouncer)**: CloudNativePG has native support; whether `services.backend` connects via pooler or direct is a v1.1 decision.
5. **Sticky dev workflow**: out-of-tree dev loop (helm-up + exec into container) is not specified. Solve during Day-1 onboarding.
6. **Vault audit logging** (V4 from review): if externalSecrets is the default backend, Vault's audit device must be enabled for compliance; cross-reference in `docs/charts/secrets-audit-compliance.md`. P2.
7. **Library-chart vs `_helpers.tpl` naming** (Y1 from review): `genieai-common` IS conceptually the umbrella's `_helpers.tpl` plus standalone templates. Clarify in chart README: "library chart contains templates and exports them via `import-values:`, helpers.tpl contains labels/selectors/name conventions." P2 doc clarification.
8. **Service template generator** (Y3 from review): 26 services × 4 templates = ~100 files. v1 ships them hand-authored for transparency; **v1.1 introduces `make render-services` from a single service-list YAML**. P2 deferred.

## 17. What lands in v1.0 (this epic)

- `charts/genieai-common/` (library, full)
- `charts/genieai-umbrella/` (full)
- `charts/README.md`
- `charts/Makefile`
- `deploy/environments/base/kustomization.yaml` (Kustomize base for Helm)
- `deploy/environments/dev/` (k3s single-node dev)
- `deploy/environments/staging/` (shared test env)
- `deploy/environments/prod/` (HA production)
- `deploy/environments/el-salvador/` (customization template — populated by future work on that env)
- `deploy/environments/README.md`
- `site/content/en/docs/deployment/kubernetes-helm.md`
- `site/content/en/docs/deployment/per-env-branches.md`
- `.gitlab-ci.yml` integration (`charts:lint`, `charts:integration`, `charts:scan`)
- `docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md` (this doc)
- `docs/charts/operator-selection.md`
- `docs/charts/migration-playbook.md`
- `docs/charts/per-env-config.md`
- One Phased-migration example values file per documented group (5, 2, 1, 4, 6, 3)

## 18. What lands later

- `genieai-edge` (sovereign-only sub-umbrella) — v1.1
- `genieai-cloud-eks` and `genieai-cloud-gke` per-distro overlays — v1.2
- HPA/KEDA integration for AI/ML autoscale — v2
- Multi-cluster federation — v2.x
- Operator lifecycle hooks (OLM-bundled chart) — v3

## 19. Per-environment configuration model

GENIE.AI today uses Ansible for deployment, with `release/<env>` branches carrying per-env customisations (most active: `release/el-salvador` per CLAUDE.md history). The K8s port preserves this discipline 1:1.

### 19.1 Branching model

| Branch | Modifies | ArgoCD target |
|---|---|---|
| `main` | Chart source under `charts/`; `deploy/environments/{base,dev,staging,prod}/` | dev, staging, prod clusters |
| `release/el-salvador` | Chart source under `charts/` (rarely); `deploy/environments/el-salvador/` (frequently) | el-salvador cluster (`.102`) |

`release/<env>` branches are the K8s equivalent of today's Ansible workflow: long-lived, hosting env-specific patches (custom UI keys, mobile app topology, RAG tuning constants, sovereign DNS), with cherry-picking from `main` for upstream chart fixes.

`main` carries the chart + plain envs. Branches diverge only on `deploy/environments/<env>/`. This makes merge-of-env-changes into main clean: only the env-specific overlay changes, never the chart core.

### 19.2 Kustomize overlay pattern

`deploy/environments/<env>/kustomization.yaml` references the umbrella chart via `helmCharts:` (ArgoCD) or as a Flux `HelmRelease` source. Patches overlay on top:

```yaml
# deploy/environments/dev/kustomization.yaml
apiVersion: kustomize.config.k8s.io/v1beta1
kind: Kustomization

helmCharts:
  - name: genieai
    releaseName: genieai-dev
    chart: ../../charts/genieai-umbrella
    version: 0.1.0
    includeCRDs: false
    valuesFile: values-override.yaml

namespace: genieai-dev
```

```yaml
# deploy/environments/dev/values-override.yaml
# Overrides only — inherits all defaults from charts/genieai-umbrella/values.yaml
replicas:
  backend: 1
ingress:
  host: dev.genieai.local
  tls:
    enabled: false
observability:
  enabled: false
```

### 19.3 GitOps Application

GitOps sync layer is **pluggable**, mirroring the per-env config model itself. Three valid options, ordered by **GENIE.AI-recommended**:

#### 19.3.1 GitLab Agent for Kubernetes (KAS) + Flux — recommended when GitLab Ultimate is available

GENIE.AI's instance runs on `opensource.unicc.org` with **GitLab Ultimate**, which gives us the GitLab Agent for Kubernetes (KAS). The architecture has **two distinct layers** with separate roles — conflating them is a common mistake:

**Layer 1 — KAS (outbound, GitLab-side trigger)**:
The KAS agent runs in-cluster, registers with GitLab over an outbound connection (no inbound K8s API exposure, no webhook tokens). Its role is **connection + CI/CD authentication bridge**:
- Authenticated, scoped K8s API access from GitLab CI jobs (no `.kubeconfig` shared)
- Environment-scoped CI/CD variables + secrets at the agent level
- Protected environments (manual deploy approval gates by group/role)
- Direct link from MR → environment → live state ("deployment view")

KAS does **NOT** reconcile state on its own. It does not watch Git and apply diffs. It exposes an authenticated API that GitLab CI jobs call to push manifests.

**Layer 2 — Flux (in-cluster, continuous reconciliation)**:
After GitLab CI renders manifests via `helm template` + Kustomize, **Flux** (installed separately in the cluster by the bootstrap script) watches the Git repo and reconciles manifest state to cluster state. Flux's `Kustomization` CRDs provide the reconciliation policy knobs the chart needs:

- `interval` / `retryInterval` — polling cadence
- `retries` — transient failure tolerance
- `force: false` — refuse on manifest conflict (no silent overwrite)
- `prune: true` — remove stale resources on env overlays dropping services
- `healthChecks` — block sync until key Deployments report Ready

```yaml
# Per-env Flux Kustomization (lives inside the cluster, not in this chart)
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: genieai-dev
  namespace: flux-system
spec:
  interval: 5m
  retryInterval: 1m
  retries: 5
  sourceRef:
    kind: GitRepository
    name: genieai
  path: ./deploy/environments/dev
  prune: true
  wait: true
  timeout: 5m
  force: false                       # refuse on manifest conflict; do not overwrite
  healthChecks:
    - apiVersion: apps/v1
      kind: Deployment
      name: genieai-dev-backend
      namespace: genieai-dev
```

**The chart does NOT install Flux** (sovereign deploys that cannot tolerate an additional in-cluster controller can use KAS alone with GitLab CI pushes). Flux is a cluster-bootstrap concern; the chart ships the `Kustomization` CR manifests as **documentation only**. Operators install Flux once per cluster, separately.

**GitLab CI does the heavy lifting**:
- `deploy:genieai:$env` job runs `helm template charts/genieai-umbrella -f deploy/environments/$env/values-override.yaml` and renders manifest
- Renders through Kustomize base + env overlay
- Pushes rendered manifest to a `gitops` repo (or branches in main + env) that Flux watches
- KAS authenticates the push-side; Flux watches the read-side

**ReconciliationPolicy** (idempotency):
- `flux force: false` refuses to overwrite cluster state on manifest conflict; surfaces a reconciler error to GitLab CI
- `retries: 5` handles transient API errors
- `prune: true` removes stale resources when an env overlay drops a service
- `healthChecks` block sync until critical Deployments report Ready
- **KAS does not have a ReconciliationPolicy** (it's a thin transport); reconciliation knobs live on Flux

`force: false` is the structural answer to "MR-rebase-during-deploy": on conflict, Flux refuses, surfaces to GitLab CI, MR must rebase before the next sync.

#### 19.3.2 ArgoCD — alternative for non-GitLab-Ultimate users

For teams without GitLab Ultimate, and as a fallback option:

```yaml
# argocd/apps/genieai-dev.yaml (lives in this repo)
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: genieai-dev
  namespace: argocd
spec:
  project: genieai
  source:
    repoURL: https://opensource.unicc.org/un/itu/genie-ai.git
    targetRevision: main  # or release/<env>
    path: deploy/environments/dev
  destination:
    server: https://kubernetes.default.svc
    namespace: genieai-dev
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

For envs that need `release/<env>` branches, change `targetRevision`. The mechanism is identical — only the Git ref differs.

#### 19.3.3 Flux — alternative for teams committed to GitOps Toolkit

Same idea via `HelmRelease` + `Kustomization`. Documented in `docs/charts/per-env-config.md` as option C.

#### 19.3.4 Why this is three options, not one

The chart itself is **GitOps-agnostic** — the artifact rendered by `helm template` is just YAML. Any tool that consumes manifest changes will do. Picking GitLab Agent for Kubernetes here reflects our specific deployment (Ultimate + ultra-private K8s over outbound), but the chart must NOT depend on any one of these — a contributor forking this repo to deploy elsewhere must be able to swap ArgoCD or Flux in without chart changes.

### 19.4 What stays in Ansible

`deploy/ansible/` is **not migrated** in v1. Continuing responsibilities:
- VM provisioning (`govstack@10.0.0.100/110/102`) before cluster exists
- Docker Swarm deploy (`release/el-salvador` Swarm target)
- CI runners + on-prem registry mirrors
- Cross-cutting ops (SSL cert renewal, offsite backups) — until K8s-native equivalents exist

`deploy/environments/` **augments**, doesn't replace. Ansible handles bootstrap; Helm/Kustomize/ArgoCD handles ongoing releases.

---

**Approval gate:** user review of this spec before any implementation plan. Per Superpower brainstorming skill path.
