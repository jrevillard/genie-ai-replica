# genieai-umbrella

Single-install Helm chart for GENIE.AI. Renders the full GENIE.AI service
topology — stateless tier (backend, frontend, document-repository, nginx,
clamav, redis-cache), data layer (CNPG, kube-arangodb, Keycloak CR), OPEA
AI/ML tier (six orchestrators + four in-cluster model Deployments + shared
model-weights PVC), and the Keycloak realm-convergence + ArangoDB
migrations hook Jobs — with one `helm install`.

Chart version: **0.1.69**. `appVersion` mirrors `version` deliberately
(chart layout, not product release; deployed image tags are governed by
`values.yaml`, never `latest`).

Local library dep: `genieai-common` (`charts/genieai-common/`). The
umbrella intentionally avoids `import-values` because Helm 4 injects the
`global` subtree into every dependency — importing the library's values
tree would carry the library's schema down the same path and
double-validate keys the umbrella schema already accepts. The umbrella's
own `values.schema.json` is the source of truth.

## Quickstart

The chart defaults to the GENIE.AI GitLab Container Registry image layout,
so a baseline install pulls the right service images without extra flags.
Operator overrides only what differs on the target cluster.

```bash
# 1. Verify the cluster operators are installed (one-time per cluster).
#    See "Cluster prerequisites" below.
kubectl get crd | grep -E 'keycloak|sealedsecret|cluster\.arangodb|cnpg'

# 2. Render + install. The chart creates the `genieai` namespace;
#    pass --create-namespace so helm propagates it before any pre-install
#    hooks (which create ServiceAccounts inside the namespace) run.
helm install genieai charts/genieai-umbrella/ \
  --create-namespace --namespace genieai

# 3. Smoke-test the release.
helm test genieai -n genieai
```

Override the image registry (air-gapped mirror) or the per-service image
tag/policy (laptop-build workflow with local minikube images):

```bash
helm install genieai charts/genieai-umbrella/ \
  --create-namespace --namespace genieai \
  --set global.imageRegistry=my-registry.example.com/myproject \
  --set services.backend.image.repository=genie-ai-backend \
  --set services.backend.image.tag=dev \
  --set services.backend.image.pullPolicy=Never
```

Image precedence (highest wins):

1. `services.<svc>.image.{repository,tag,pullPolicy}` — per-service.
2. `global.imageRegistry` — prefixes every `image.repository` (default
   `registry.opensource.unicc.org/un/itu/genie-ai`).
3. Chart default — `genie-ai-<svc>:main` per service.

`imagePullSecrets` is taken from `global.imagePullSecrets` (list).

## Cluster prerequisites

Operator controllers are **cluster bootstrap prerequisites** — installed
once per cluster, before any GENIE.AI release. Per-release installs would
create competing cluster-scoped controllers (sealed-secrets keypair
fights, duplicate CNPG / kube-arangodb reconcilers). The chart renders
only the custom resources they manage.

| Operator | Version | Install (generic) |
|---|---|---|
| CloudNativePG | ≥1.30 | `helm install cnpg cloudnative-pg --repo https://cloudnative-pg.github.io/charts` |
| kube-arangodb | 1.4.x | `helm install arango kube-arangodb --repo https://arangodb.github.io/kube-arangodb` |
| sealed-secrets | ≥0.40 | `helm install sealed-secrets sealed-secrets --repo https://bitnami.github.io/sealed-secrets` |
| keycloak-operator | 26.8.0 | `./scripts/install-prereqs.sh` (Kustomize overlay that overrides the upstream `keycloak` namespace to `keycloak-system`; Quarkus-based modern operator, 4 CRDs in `k8s.keycloak.org`). Alternatives: OLM (`installPlanApproval: Manual` recommended — auto-upgrade causes unintended Keycloak version bumps), or `oci://quay.io/keycloak/keycloak-operator-helm` (experimental, cluster-wide). |
| OpenTelemetry Operator | latest | (required by `observability.*`; the collector Service it creates is what `otlpEndpoint` points at) |
| GPU operator (NVIDIA) | latest | (required by `opea.gpu.mode=in-cluster`; the in-cluster model Deployments target `gpu=true` nodes) |
| cert-manager + Envoy Gateway | latest | (required by the per-environment ingress tier — Phase 2) |

## Status

| Layer | Status |
|---|---|
| Foundation (namespace, ArgoCD example, chart-testing baseline) | ✅ Shipped |
| Data layer (CNPG, kube-arangodb, Keycloak CR + convergence Job) | ✅ Shipped |
| Service tier (backend + frontend + document-repository + nginx + clamav + redis-cache) | ✅ Shipped |
| OPEA AI/ML (six orchestrators + four in-cluster models + NetworkPolicies + endpoint helpers) | ✅ Shipped |
| Observability (vmoperator + collector + Grafana + serviceMonitors) | ⏳ In progress |
| Per-env config + ingress (Envoy Gateway + cert-manager) | ⏳ In progress |
| CI completion (`chart:contract` render-gate, ct full suite on kind) | ⏳ In progress |

## Required Secrets

The chart references the Secrets below by name; it never reads their
values. Operators materialize them by whatever secret backend they use
cluster-wide (SealedSecret, SOPS, External Secrets Operator, HashiCorp
Vault Agent, manual `kubectl apply`, etc.). A missing Secret produces
`CreateContainerConfigError` at pod start.

| Secret | Keys consumed | Used by |
|---|---|---|
| `keycloak-admin-credentials` | `username`, `password` | `Keycloak` CR `bootstrapAdmin.user.secret`; convergence Job `KEYCLOAK_USER` / `KEYCLOAK_PASSWORD` |
| `keycloak-db-credentials` | `username`, `password` | CNPG `Cluster` + `Keycloak` CR `spec.db` |
| `keycloak-proxy-client-secret` | `proxyClient` | convergence Job `KC_PROXY_CLIENT_SECRET` |
| `huggingface-hub-token` | (single key, the HF token) | backend image pulls |
| `email-password` | `password` | convergence Job `EMAIL_PASSWORD` |
| `translation-cache-password` | (the cache password) | backend `TRANSLATION_CACHE_PASSWORD` |
| `arango-root-secret` | `password` | backend `ARANGO_PASSWORD` (wired via explicit `secretKeyRef`, not `envFrom`) |
| `vllm-api-key` | `VLLM_API_KEY`; `HF_TOKEN` | every GPU consumer (backend translation, OPEA orchestrators, in-cluster vLLM/TEI). Two-key contract: the Secret carries BOTH keys — `VLLM_API_KEY` (GPU-node bearer) and `HF_TOKEN` (Hugging Face pulls; gemma is gated). The `HUGGINGFACEHUB_API_TOKEN` env row is an alias that reads the `VLLM_API_KEY` key. |

The convergence Job additionally needs one `data.keycloak.convergence.envSecrets`
row per secret-backed `$(env:VAR)` in `files/genie-realm.yaml` —
five rows, no more: `KC_PROXY_CLIENT_SECRET`, `KC_DATAPREP_CLIENT_SECRET`,
`KC_GRAFANA_CLIENT_SECRET`, `GENIE_ADMIN_PASSWORD`, `EMAIL_PASSWORD`.

## Keycloak configuration

The realm has exactly one owner: `keycloak-config-cli`, run as a Helm
`post-install,post-upgrade,post-rollback` hook Job. The operator's
`KeycloakRealmImport` CR is create-only — a changed `spec.realm` is
ignored while the CR still reports `Done=True`, which leaves a GitOps
pipeline green against a realm that has drifted.

The realm body is `files/genie-realm.yaml`, parameterised by `$(env:VAR)`
placeholders. The chart does not re-render it; it wires the environment
those placeholders resolve from:

| Parameter class | Wiring |
|---|---|
| Deployment values (realm name, `ingress.host`, locale, password policy, mobile client id) | plain `env` on the Job, from chart values |
| Secrets (client secrets, admin password, SMTP password) | `valueFrom.secretKeyRef`, declared in `data.keycloak.convergence.envSecrets` |

A render-time guard (`data.keycloak.failOnPlaceholderSecrets`, default
`true`) fails `helm install` when `data.keycloak.clientSecrets.*` still
holds a `change-me-*` placeholder, so a default install never silently
produces an OIDC client whose secret no consumer in the cluster holds.
CI's `chart:lint` job (which supplies no `envSecrets` rows) and dev / kind
overrides set it to `false`. kcc itself is guarded a second time at
runtime: a `$(env:VAR)` in the realm that the Job does not export fails
the Job pod with an opaque parse error.

Setting `data.keycloak.convergence.enabled: false` (default in the
dev-repo overlays) renders neither the Job nor the realm Secret. The
`Keycloak` CR still renders, so the chart installs an identity tier with
**no realm**: `genie-admin` cannot log in and no client exists. Treat it
as a smoke path, not a working install.

The hook fires on every release. Because every realm parameter reaches
the import through a values-derived `env` or an `envSecrets` row, a
parameter change moves the values digest and triggers the release.
`HelmRelease.spec.upgrade.timeout` bounds the Job — set it to at least
`900s`.

## Migrations

`templates/migrate/db-migrations-job.yaml` is a `post-install,post-upgrade`
hook Job that runs the ArangoDB collection / index migrations using the
`genie-ai-db-migrations` image (same registry / tag conventions as the
service images, configurable via `services.backend.migrationsImage`).

## Pre-install hooks

The chart's pre-install / pre-upgrade hooks run in ascending
`helm.sh/hook-weight` order. Regular resources land only AFTER all hooks,
so anything a hook needs must itself be a lower-weight hook:

1. `-30` — ServiceAccount (hook-owned, `before-hook-creation,hook-succeeded`).
2. `-30` — Role + RoleBinding (namespaced, hook-owned, `before-hook-creation,hook-succeeded`).
3. **REGULAR** — ClusterRole + ClusterRoleBinding (cluster-scoped; the helm-test pod's `kubectl get ns` call relies on these — they must exist AFTER install/upgrade. The dep-check Job runs before they appear, but the Job only needs the namespaced Role).
4. `-20` — dep-graph ConfigMap (`dependency-graph.json` + `enabled.json`).
5. `-10` — cluster-profile drift detection (pre-upgrade only; emits a Warning Event on namespace-label / render mismatch).
6. `-5`  — dependency-graph validation (services / data require their deps; iterates the `dependencyGraph` map).

## Values surface

The umbrella's `values.yaml` groups values by tier. Every entry below is
the current source of truth.

| Tier | Top-level key | Purpose |
|---|---|---|
| Global | `global.imageRegistry`, `global.imagePullSecrets`, `global.toolingArch`, `global.toolingImageRegistry`, `global.kubeletToolsMirror` | Image + tooling registry knobs |
| Profile | `clusterProfile`, `clusterProfileReplicas` | `dev` \| `staging` \| `prod`; `sovereign` reserved |
| Pluggable | `pluggable.storageClassName` | PVC storage class; `""` = cluster default |
| Ingress | `ingress.host`, `ingress.scheme` | Public origin; feeds `KC_PUBLIC_ORIGIN` (issuer pin) |
| Observability | `observability.collectorCRName`, `observability.collectorPort` | OTLP exporter endpoint overrides |
| Data | `data.postgres`, `data.arangodb`, `data.keycloak` | Data-layer CRs + Keycloak convergence |
| Services | `services.<backend\|frontend\|documentRepository\|nginx\|clamav\|redisCache>` | Stateless-tier per-service config |
| OPEA | `opea.enabled`, `opea.gpu`, `opea.<orchestrator>`, `opea.models.<llm\|reranker>.modelId`, `opea.models.cache` | AI/ML tier |
| Dependency graph | `dependencyGraph.services`, `dependencyGraph.data` | Read by the dep-check hook |

Top-level `namespace` must equal the release namespace (`-n`) — the chart
fails the render otherwise.

## GPU modes

The OPEA tier's GPU backend is a binary choice.

### `opea.gpu.mode=external`

Model endpoints live on a remote GPU node. Set:

```yaml
opea:
  enabled: true
  gpu:
    mode: external
    nodeHost: "https://gpu-node.lan:444"   # required
    paths:
      llm: /llm
      embedding: /embed
      reranker: /rerank
      translation: /translation
      docling: /docling
```

`opeaGpuEndpoint` returns `https://gpu-node.lan:444/llm` (etc.) for each
path. An empty `nodeHost` fails the render — empty strings would reach
the pods as a literal empty-string endpoint and only fail at runtime.

`opeaGpuHostname` strips scheme + port + path and feeds `GPU_NODE_HOST`
to the model-id auto-detection gates. `opeaSslSkipVerify` returns `"1"`
when `nodeHost` starts with `https://` (the GPU node's certificate is
signed by an internal CA).

### `opea.gpu.mode=in-cluster`

vLLM / TEI Deployments are rendered by the chart and the endpoint URLs
point at in-cluster Service names. `opeaGpuEndpoint` returns:

| Path key | Service URL |
|---|---|
| `llm` | `http://vllm.<ns>.svc.cluster.local:8000` |
| `embedding` | `http://tei.<ns>.svc.cluster.local:80` |
| `reranker` | `http://tei-reranker.<ns>.svc.cluster.local:80` |
| `translation` | `http://vllm-translation.<ns>.svc.cluster.local:9031` |
| `docling` | (empty — no in-cluster docling Deployment; dataprep falls back to its in-process docling converter) |

The four model Deployments share a `_model-deployment.tpl` skeleton; they
differ in image, args, port, model-cache mount path, probe thresholds, and
the occasional initContainer or extra env row. All four read from the
shared `opea.models.cache` PVC (ReadWriteOnce — assumes single `gpu=true`
node; multi-GPU clusters need RWX or per-model claims).

## Backend OPEA wiring

The backend's chat and translation endpoints derive from values + OPEA tier state:

- `services.backend.translation.endpoint` empty + `opea.enabled` + `opea.gpu.mode=in-cluster` → defaults to `http://vllm-translation.<ns>.svc.cluster.local:9031`. Otherwise the explicit value wins (point at a remote GPU's translation API). Fully empty → backend's auto mode (compose-era default probe, in-process CPU fallback).
- `services.backend.opeaHost` empty + `opea.enabled` → defaults to `chatqna.<ns>.svc.cluster.local`. Empty without `opea.enabled` → no `OPEA_HOST` env row (the BFF's chat route expects a value when the OPEA tier is enabled).
- `services.backend.translation.streamingEnabled` must be a YAML boolean — non-bool values fail the render (`0`, `"0"`, `"false"` are not coerced).

## Stateless service tier

Renders each enabled entry as a Deployment + Service + default-deny
NetworkPolicy. Probes, resources, security contexts, volumes, and PVCs
all live on `values.yaml`.

| Service | `services.<name>` key | Container port | Service port | Default → prod replicas |
|---|---|---|---|---|
| Backend | `backend` | 3000 | 80 | 1 → 3 |
| Frontend | `frontend` | 8090 | 80 | 1 → 2 |
| Document repository | `documentRepository` | 3001 | 80 | 1 → 2 |
| Nginx | `nginx` | 8080 | 80 | 1 |
| ClamAV | `clamav` | 3310 | 3310 | 1 |
| Redis cache | `redisCache` | 6379 | 6379 | 1 |

Per-service `secrets:` lists mount the named Secret via `envFrom` with
`optional: true` — the chart references Secrets it does NOT create, and
without `optional`, a missing Secret produces `CreateContainerConfigError`
at pod start and the operator can only fix it by hand-creating it,
defeating the chart-driven install path. The backend's `ARANGO_PASSWORD`
is the one exception — wired via explicit `secretKeyRef`, not `envFrom`,
to avoid duplicating the var.

### PodDisruptionBudget

A PDB is rendered **only when `replicas >= 2`** for that service. With
baseline `replicas: 1`, no PDB lands until `clusterProfileReplicas.prod`
activates (backend, frontend, document-repository qualify; nginx,
clamav, redis-cache stay singletons). Avoids voluntary-disruption blocks
on services that cannot survive a drain.

### CORS

Handled at the edge tier (Envoy Gateway policy); origins derive from
`ingress.host`. No per-service CORS plumbing.

## NetworkPolicy posture

Every rendered service gets a default-deny NetworkPolicy with explicit
allowlists. Two patterns:

**Stateless tier** (`templates/services/*.yaml`): per-service
`podSelector: { genieai.io/component: <svc> }`. Egress uses
port-scoped `ipBlock 0.0.0.0/0` rules for data-tier peers because the
operator-managed peers (kube-arangodb, CloudNative-PG, Keycloak
operator) expose their real pod labels only at runtime; guessed labels
silently block traffic. Backend's egress adds explicit
`podSelector`-scoped rules for document-repository (TCP/3001) and
chatqna (TCP/8888) when the OPEA tier is enabled.

**OPEA orchestrators** (`templates/opea/networkpolicies.yaml`): per-
orchestrator default-deny with ingress allowlists mirroring the real
call graph and egress scoped to the in-cluster peers each orchestrator's
env actually dials. Egress to other orchestrators uses `podSelector`;
egress to the model Deployments uses the `app: <model>` label the
model skeleton writes.

**OPEA model Deployments** (vllm, tei, tei-reranker, vllm-translation;
in-cluster mode only): ingress-only policies. Inference endpoints accept
traffic solely from the orchestrators that call them. Egress stays open
(weights pull, DNS).

**External GPU mode** (`opea.gpu.mode=external` AND `nodeHost` set):
backend + orchestrator egress widens to `0.0.0.0/0` on TCP 443 + 444 for
the GPU node's TLS ports. Port family is intentionally broad — the chart
does not parse the host's URL.

## Observability

The OpenTelemetry Operator collects the `OpenTelemetryCollector` CR and
exposes a Service named `<cr-name>-collector` (default `genieai-collector`,
override via `observability.collectorCRName`). Every service that emits
OTLP gets `OTEL_EXPORTER_OTLP_ENDPOINT` derived from
`templates/_lib/_observability.tpl`:

```
http://<observability.collectorCRName>-collector.<namespace>.svc.cluster.local:<observability.collectorPort>
```

Default port `4318` matches the OpenTelemetry Operator's default
`spec.ports[0].port`. Override `observability.collectorPort` for clusters
that change the operator's listener port (e.g. port collisions on a
shared node).

## Data layer

| Tier | Operator CR | Default mode |
|---|---|---|
| Postgres | CNPG `Cluster` (`keycloak-db`) | `instances: 1` (prod → 3) |
| ArangoDB | kube-arangodb `ArangoDeployment` (`arangodb-single` / `arangodb-cluster`) | `mode: single`; cluster on staging + prod |
| Keycloak | `Keycloak` v2beta1 (`keycloak`) | single replica by default; `RecreateOnImageChange` strategy |

The chart's ArangoDeployment template honors `data.arangodb.mode` ONLY
and does NOT auto-promote on `clusterProfile` changes — kube-arangodb
requires a fresh uninstall + install for mode switches. Operators switch
by editing `data.arangodb.mode`, then running `helm uninstall` +
`helm install`.

The Arango `Service` hostname derives from the mode via
`templates/_lib/_arango-host.tpl`:
- `single` → `arangodb-single.<ns>.svc.cluster.local`
- `cluster` → `arangodb-cluster.<ns>.svc.cluster.local`

`arangoURL` (`templates/_lib/_urls.tpl`) prepends the scheme + port and
feeds backend `ARANGO_URL`.

## Template helpers (`templates/_lib/`)

| Helper | Signature | Purpose |
|---|---|---|
| `genieai-umbrella.keycloakInternalURL` | `include "..." .` | `http://keycloak-service.<ns>.svc.cluster.local:8080/auth` (backchannel base — token endpoints, JWKS) |
| `genieai-umbrella.keycloakPublicIssuer` | `include "..." .` | `<scheme>://<ingress.host>/auth` (pinned `iss` claim; must match token `iss`) |
| `genieai-umbrella.arangoURL` | `include "..." .` | `http://<arango-host>.<ns>.svc.cluster.local:8529` |
| `genieai-umbrella.arangoHost` | `include "..." .` | Mode-aware Arango Service name |
| `genieai-umbrella.serviceURL` | `include "..." (dict "root" . "name" "X" "port" "N")` | `http://<name>.<ns>.svc.cluster.local:<port>` |
| `genieai-umbrella.otlpEndpoint` | `include "..." .` | `http://<cr>-collector.<ns>.svc.cluster.local:4318` |
| `genieai-umbrella.opeaGpuEndpoint` | `include "..." (dict "root" . "path" "<key>")` | Mode-aware GPU endpoint (`external` joins `nodeHost` + `paths.<key>`; `in-cluster` returns a fixed `service:port` map) |
| `genieai-umbrella.opeaGpuHostname` | `include "..." .` | Bare host of `opea.gpu.nodeHost` (scheme + port + path stripped; feeds `GPU_NODE_HOST` to model-id auto-detection) |
| `genieai-umbrella.opeaSslSkipVerify` | `include "..." .` | `"1"` when `nodeHost` starts with `https://`, else `"0"` (Node `NODE_TLS_REJECT_UNAUTHORIZED=0` analogue) |
| `genieai-umbrella.secretKeyRefEnv` | `include "..." (dict "var" "X" "secret" "Y" "key" "Z" "optional" true)` | One env row as JSON object |
| `genieai-umbrella.gpuApiKeyEnv` | `include "..." (dict "keys" (list "HF_TOKEN" "VLLM_API_KEY"))` | Array of `vllm-api-key` Secret env rows (`HUGGINGFACEHUB_API_TOKEN` alias reads the same `VLLM_API_KEY` key) |
| `genieai-umbrella.serviceDeployment` | `include "..." (dict "name" "X" "component" "X" "Values" .Values ...)` | Standard Deployment body. Per-service call passes `component` at the TOP of the dict (not merged into `.Values`) so `genieai-common.labels` reads it directly |

## Render gates

```bash
# Schema + conventions + cross-references — both must pass.
helm lint charts/genieai-umbrella --strict
make -C charts lint

# Byte-diff operator-facing surface against the previous release.
make -C charts template                       # writes /tmp/genieai-rendered.yaml
diff -u <previous-render> /tmp/genieai-rendered.yaml
```

`values.schema.json` validates operator overrides. `genieai-common`'s
schema is NOT applied here (no `import-values`); keys the umbrella
schema does not declare at the top level (`component`, `nameOverride`,
`fullnameOverride`) pass unchallenged.

## Tests

```bash
make -C charts test          # ct install + helm test against kind
helm test genieai -n genieai
```

The two helm-test pods (`<release>-genieai-umbrella-test-namespace`,
`<release>-genieai-umbrella-test-data-deps`) and the cluster-profile
detection hook Job all need `kubectl`. The chart no longer pins an image
that ships those binaries preinstalled (`registry.k8s.io/kubectl` is
distroless, the `bitnami/kubectl` version tags were purged); each Pod
runs an init container that downloads the static binaries into a shared
`tools` emptyDir and the main container (alpine) picks them up via the
PATH env.

### Air-gapped deployments

The init containers download `kubectl` and `jq` from public release URLs
by default. For air-gapped / sovereign clusters, set
`global.kubeletToolsMirror` to an internal mirror URL (no scheme); the
init containers prepend that mirror URL to the well-known release paths
(`/release/v1.33.0/...`, `/jq/releases/download/jq-1.7.1/...`). The mirror
must serve both paths from its base URL — the chart does not fall back to
upstream when the mirror is unreachable.

## Secrets backend

The chart is **agnostic to the secret mechanism**. Service deployments
declare the Secret names they consume via `envFrom` (`secrets: [{name: <secret-name>}]`
lists under each `services.<svc>.secrets` and `data.<tier>.secrets`
block); operators materialize the Secret in the target namespace by
whatever mechanism they use cluster-wide (SealedSecret, SOPS-decrypted
Secret, External Secrets Operator, HashiCorp Vault Agent, manual
`kubectl apply`, etc.). The chart does not endorse, require, or assume
any particular mechanism.

## Per-environment overlay

Apply per-env config via `genie-ai-deploy/overlays/<cluster>/<env>/values.yaml`.
See that directory's `README.md`.