# genieai-umbrella

Single-install Helm chart for GENIE.AI. Renders the entire 28-service stack
with one `helm install`.

## Quickstart

The chart defaults to the GENIE.AI GitLab Container Registry image layout,
so a baseline install pulls the right service images without extra flags.
Operator overrides only what's different on the target cluster.

```bash
# 1. Verify the 4 cluster operators are installed (one-time per cluster).
#    See "Cluster prerequisites" below for the install commands.
kubectl get crd | grep -E 'keycloak|sealedsecret|cluster\.arangodb|cnpg'

# 2. Render + install the chart. The chart creates the `genieai`
#    namespace; pass --create-namespace so helm propagates it before
#    any pre-install hooks (which create ServiceAccounts inside the
#    namespace) run.
helm install genieai charts/genieai-umbrella/ \
  --create-namespace --namespace genieai
```

To override the image registry (e.g. mirror in air-gapped setup), or the
per-service image tag/policy (e.g. laptop-build workflow with local
minikube images):

```bash
helm install genieai charts/genieai-umbrella/ \
  --create-namespace --namespace genieai \
  --set global.imageRegistry=my-registry.example.com/myproject \
  --set services.backend.image.repository=genie-ai-backend \
  --set services.backend.image.tag=dev \
  --set services.backend.image.pullPolicy=Never
```

Override paths (in order of precedence):
- Per-service: `services.<svc>.image.{repository,tag,pullPolicy}`
- Global default: `global.imageRegistry` (default `registry.opensource.unicc.org/un/itu/genie-ai`)
- Chart defaults: hardcoded `genie-ai-<svc>:main` per service

Secret backend: the chart does not materialize the underlying Secret for
any of the data-tier or stateless-tier credentials it references. Each
service deployment declares the Secret names it consumes via `envFrom`
(plain `secrets: [{name: <secret-name>}]` lists in `services.<svc>.secrets`
and `data.<tier>.secrets`); operators bring the Secret into the target
namespace by whatever mechanism they use cluster-wide (SealedSecret, SOPS,
External Secrets Operator, kubeval, manual `kubectl apply`, HashiCorp
Vault Agent, etc.). The chart does not endorse or require any particular
mechanism.

## Status

| Layer | Status |
|---|---|
| Foundation (namespace, ArgoCD example, chart-testing baseline) | ✅ Shipped |
| Data layer (CNPG, kube-arangodb, keycloak; operators = bootstrap prerequisites) | ✅ Shipped |
| Service tier (stateless app: backend + frontend + document-repository + nginx + clamav) | ✅ Shipped |
| Observability (vmoperator VMSingle/Cluster + OTel operator + serviceMonitors) | ⏳ Planned |
| AI/ML (vLLM + TEI + OPEA microservices + GPU operator) | ⏳ Planned |
| Per-env config + ingress (Envoy Gateway + cert-manager) | ⏳ Planned |
| CI integration + image signing + Renovate | ⏳ Planned |

## Cluster prerequisites

The operator controllers the chart's custom resources depend on are **cluster
bootstrap prerequisites** — installed once per cluster, before any GENIE.AI
release. Per-release operator installs would create competing cluster-scoped
controllers (sealed-secrets keypair fights, duplicate CNPG/kube-arangodb
reconcilers). The chart renders only the custom resources they manage.

| Operator | Version | Install (generic) |
|---|---|---|
| CloudNativePG | ≥1.30 | `helm install cnpg cloudnative-pg --repo https://cloudnative-pg.github.io/charts` |
| kube-arangodb | 1.4.x | `helm install arango kube-arangodb --repo https://arangodb.github.io/kube-arangodb` |
| sealed-secrets | ≥0.40 | `helm install sealed-secrets sealed-secrets --repo https://bitnami.github.io/sealed-secrets` |
| keycloak-operator | 26.8.0 | `kubectl apply -k 'github.com/keycloak/keycloak-k8s-resources/kubernetes?ref=26.8.0'` (the official Kustomize install of the Quarkus-based modern operator; 4 CRDs in `k8s.keycloak.org`). Alternatives: [OLM](https://www.keycloak.org/operator/installation#_installing_by_using_the_operator_lifecycle_manager) with `installPlanApproval: Manual` (recommended per official docs — auto-upgrade causes unintended Keycloak version bumps), or [Helm](https://www.keycloak.org/operator/installation#_installing_by_using_helm) `oci://quay.io/keycloak/keycloak-operator-helm` (experimental, cluster-wide). |

Later tiers add: GPU operator, cert-manager, envoy-gateway — same model.

## Per-environment overlay

Apply per-env config via `deploy/environments/<env>/values-override.yaml`. See
that directory's `README.md`.

## Values

The umbrella's own `values.schema.json` is what validates operator overrides;
the `genieai-common` library's `values.schema.json` is **NOT** applied here
because the umbrella deliberately avoids `import-values` — Helm 4 injects
the `global` subtree into every dependency, which would otherwise pull the
library's schema down the same path and double-validate keys that the
umbrella schema already accepts (top-level `component:`, `nameOverride:`,
`fullnameOverride:`). The umbrella's own schema is the source of truth;
top-level keys from the library schema description that the umbrella's
schema does not explicitly declare (top-level `component:`, `nameOverride:`,
`fullnameOverride:`) pass unchallenged. Per-call `component` (the dict key
passed to `genieai-common.labels` from each template) is the only enforced
component path.

## Pre-install hooks

The chart's pre-install/pre-upgrade hooks run in ascending `helm.sh/hook-weight`
order (RBAC first — regular resources land only AFTER all hooks, so everything a
hook needs must itself be a lower-weight hook):

1. `-30` — ServiceAccount (hook-owned, before-hook-creation,hook-succeeded)
2. `-30` — Role + RoleBinding (namespaced, hook-owned, before-hook-creation,hook-succeeded)
3. REGULAR (after all hooks) — ClusterRole + ClusterRoleBinding (cluster-scoped, regular resource; the helm-test pod's `kubectl get ns` call relies on these — they must exist AFTER install/upgrade; the dep-check Job runs BEFORE they appear but the Job only needs the namespaced Role)
4. `-20` — dep-graph ConfigMap (dependency-graph.json + enabled.json)
5. `-10` — cluster-profile drift detection (pre-upgrade only; emits a Warning Event on namespace-label/render mismatch)
6. `-5`  — dependency graph validation (services/data require their deps)

## Tests

```bash
make test         # ct install + helm test against kind
helm test <release> -n genieai
```

The two helm-test pods (`<release>-genieai-umbrella-test-namespace`,
`<release>-genieai-umbrella-test-data-deps`) and the clusterprofile-detect
hook Job all need `kubectl`. The chart no longer pins an image that ships
those binaries preinstalled (the `registry.k8s.io/kubectl` image is
distroless and the `bitnami/kubectl` version tags were purged); instead
each Pod runs an init container that downloads the static binaries into a
shared `tools` emptyDir and the main container (alpine) picks them up via
the PATH env.

### Air-gapped deployments

The init containers download `kubectl` and `jq` from public release URLs by
default. For air-gapped / sovereign clusters, set
`global.kubeletToolsMirror` to an internal mirror URL (no scheme required);
the init containers then prepend that mirror URL to the well-known release
paths (`/release/v1.33.0/...` and `/jq/releases/download/jq-1.7.1/...`).
The mirror must serve both paths from its base URL — the chart does not
fall back to upstream when the mirror is unreachable.

## Secrets backend

The chart is **agnostic to the secret mechanism**. Service deployments
declare the Secret names they consume via `envFrom`
(`secrets: [{name: <secret-name>}]` lists under each `services.<svc>.secrets`
and `data.<tier>.secrets` block); operators materialize the Secret in
the target namespace by whatever mechanism they use cluster-wide
(SealedSecret, SOPS-decrypted Secret, External Secrets Operator,
HashiCorp Vault Agent, kubeval, manual `kubectl apply`, etc.). The
chart does not endorse, require, or assume any particular mechanism.

## Stateless service tier

Renders the five application-tier services (Deployments + Services + default-deny
NetworkPolicies). Each service reads its config from the `services.<name>` key in
`values.yaml`; prod / staging overrides go through `clusterProfileReplicas`.

| Service | Component label | Container port | Service port | Replicas (default → prod) |
|---|---|---|---|---|
| `backend` | `backend` | 3000 | 80 | 1 → 3 |
| `frontend` | `frontend` | 8090 | 80 | 1 → 2 |
| `documentRepository` | `documentRepository` | 3001 | 80 | 1 → 2 |
| `nginx` | `nginx` | 8080 | 80 | 1 |
| `clamav` | `clamav` | 3310 | 3310 | 1 |

Each rendered service ships a Deployment, a Service, a default-deny NetworkPolicy,
and (where applicable) envFrom secret references + a PDB.

### PodDisruptionBudget

A PDB is rendered **only when `replicas >= 2`** for that service. With baseline
`replicas: 1` for every entry, no PDB lands until `clusterProfileReplicas.prod`
activates (backend, frontend, documentRepository qualify; nginx and clamav stay
singletons). This avoids voluntary-disruption blocks on services that cannot
survive a drain.

### CORS

Handled at the edge tier (Envoy Gateway policy); origins derive from
`ingress.host`. No per-service CORS plumbing here.