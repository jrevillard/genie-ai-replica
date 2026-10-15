---
title: "Kubernetes Deployment"
description: "Helm chart deployment of GENIE.AI on Kubernetes: cluster prerequisites, install paths, required Secrets, GPU modes, and validation."
weight: 7
section: "deploy"
aliases:
  - /docs/deployment/kubernetes/
mode: how-to
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-10-15
---

This guide covers GENIE.AI on Kubernetes via the `genieai-umbrella` Helm chart.
For single-host container deployments, see
[Docker Compose Setup](/docs/deploy/docker-compose-setup/); for multi-node
container orchestration, see [Docker Swarm Setup](/docs/deploy/docker-swarm-setup/).

## Overview

One chart, one release: `charts/genieai-umbrella` renders the full stack
(namespace, data tier, application tier, edge) from a single values file.
Environments diverge through overlays — a small per-env values file that
overrides `clusterProfile`, `ingress`, image tags, and Secret references.

GitOps is the supported distribution model. A companion `genie-ai-deploy`
repo holds the Flux `Kustomization` + `HelmRelease` for each environment.
Flux reconciles from the deploy repo at a fixed interval; the chart itself
lives under `charts/` in the application repo and is referenced by path.

## Prerequisites

**Cluster.**

- Kubernetes **1.33+**
- A default StorageClass that supports dynamic provisioning (used by the
  Arango, document-repository, Redis, and (in-cluster mode) model-cache PVCs)
- `kubectl` access to the target cluster from the operator workstation

**Cluster-scoped operators.** The chart renders custom resources, but it
does **not** install the operators that reconcile them. Each is a one-time
cluster bootstrap — installing them per-release causes competing
reconcilers and failed releases.

| Operator | Min version | Purpose |
|---|---|---|
| `kube-arangodb` | 1.4.x | ArangoDB `ArangoDeployment` / `ArangoMember` |
| CloudNativePG (`cnpg`) | ≥ 1.30 | The Keycloak Postgres cluster (`keycloak-db`) |
| `keycloak-operator` | 26.8.0 | `Keycloak` CR + realm import infrastructure |
| `cert-manager` | latest | Per-env TLS — required when issuer pinning is enabled |
| `sealed-secrets` (or alternative) | ≥ 0.40 | Encrypts Secrets into the deploy repo |

Later tiers add: GPU device plugin + node feature discovery (when
`opea.gpu.mode=in-cluster`), Envoy Gateway (Phase 2 ingress — see
[Access](#access)).

**Node labels** (when running models in-cluster):

```bash
kubectl label node <gpu-node> gpu=true
```

**Air-gapped clusters.** Set `global.kubeletToolsMirror` to an internal URL;
the chart's pre-install and helm-test Pods `curl`-download `kubectl` and
`jq` from a default public mirror otherwise.

## Install paths

Two paths exist; both end at the same release. Pick by how secrets are
managed cluster-wide.

### Path A — plain `helm install`

Use when Secrets are managed out-of-band (manual `kubectl apply`, External
Secrets Operator, HashiCorp Vault Agent). Render and apply:

```bash
helm install genieai charts/genieai-umbrella/ \
  --create-namespace --namespace genieai \
  -f my-values.yaml
```

The chart creates the `genieai` namespace; pass `--create-namespace` so
helm propagates it before the pre-install hooks run.

### Path B — Flux deploy-repo overlay

Use for GitOps. Each environment lives under `genie-ai-deploy/overlays/<cluster>/<env>/`:

```
overlays/<cluster>/<env>/
├── kustomization.yaml            # resource list (incl. SealedSecrets)
├── gitrepository-chart.yaml      # Flux GitRepository for genie-ai repo
├── helmrelease.yaml              # HelmRelease → charts/genieai-umbrella
├── values.yaml                   # ConfigMap values (cluster-shared, public)
├── secrets.template.yaml         # plaintext source (NOT committed)
└── secrets/                      # SealedSecret materializations
    ├── arango-root-secret.yaml
    ├── keycloak-admin-credentials.yaml
    └── ...
```

The `HelmRelease` references two values sources — a `ConfigMap` of
operator-owned values, and a `Secret` of SOPS-decrypted values — and
materializes them via `valuesFrom`. Inline `values:` carries only the
per-overlay deltas:

```yaml
valuesFrom:
  - name: genieai-public        # ConfigMap
    kind: ConfigMap
  - name: genieai-secrets       # SOPS-decrypted Secret
    kind: Secret
values:
  data:
    keycloak:
      failOnPlaceholderSecrets: false
```

Set `spec.install.timeout` and `spec.upgrade.timeout` to **900s** — the
Keycloak convergence hook (kcc) and operator CRD reconciliation can each
exceed the helm-controller 5-minute default on cold clusters.

## Required Secrets

The chart references these Secrets by name; it never materializes them.
Bring them into the `genieai` namespace with your secret backend before
the release completes.

| Secret | Keys | Consumed by |
|---|---|---|
| `arango-root-secret` | `password` | `ARANGO_PASSWORD` (wired via `secretKeyRef`); root user setup |
| `vllm-api-key` | `VLLM_API_KEY`, `HF_TOKEN` | Backend translation endpoint; OPEA tier (HF_TOKEN gates `google/gemma-3-4b-it` and other gated models) |
| `keycloak-admin-credentials` | `username`, `password` | `Keycloak` CR `bootstrapAdmin.userSecret`; master realm convergence |
| `keycloak-db-credentials` | `username`, `password` | CNPG cluster; Keycloak `spec.db` |
| `keycloak-convergence-credentials` | `GENIE_ADMIN_PASSWORD`, `EMAIL_PASSWORD` | kcc convergence Job (`$(env:VAR)` placeholders in the realm body) |
| `keycloak-proxy-client-secret` | `KEYCLOAK_PROXY_CLIENT_SECRET` | Backend env (`genie-proxy-client` service account) |
| `kc-dataprep-client-secret` | `KC_DATAPREP_CLIENT_SECRET` | Dataprep client-credentials grant |
| `kc-grafana-client-secret` | `KC_GRAFANA_CLIENT_SECRET` | Grafana OIDC client |
| `email-password` | `password` | SMTP — required only when `data.keycloak.verifyEmail=true` |
| `translation-cache-password` | `password` | Backend translation cache |
| `huggingface-hub-token` | `HF_TOKEN` | Hugging Face model pulls |

Additional Secrets used in the SealedSecret pattern: `keycloak-db-credentials`,
`arango-jwt-secret`. A `kc-grafana-client-secret` is required when Grafana
SSO is enabled (planned Observability tier).

Setting `data.keycloak.convergence.enabled=false` skips the kcc hook and
the realm is never imported — useful for smoke installs.

## Configuration highlights

**`clusterProfile`** — drives replica counts and (where implemented) data-tier
topology. Valid values: `dev`, `staging`, `prod`. `sovereign` is reserved
until that profile lands. Per-service overrides go through
`clusterProfileReplicas` in your overlay.

**`ingress.host` and `ingress.scheme`** — public origin. `scheme` feeds
`KC_PUBLIC_ORIGIN` (realm `redirectUris`/`webOrigins`): a port-forward
demo requires `http://` or every login redirect mismatches the issuer.
TLS terminate at Envoy Gateway (Phase 2); issuer pinning lands in the same
phase.

**`opea.enabled`** and **`opea.gpu.mode`** — enable the six OPEA
orchestrators (chatqna, retriever, dataprep, reranker, embedding,
translation) and pick the model-source world:

| Mode | Models run where | Endpoint layout |
|---|---|---|
| `external` | A standalone GPU node reachable by HTTPS (e.g. `https://10.0.0.110:444`) | `opea.gpu.nodeHost` + `opea.gpu.paths.{llm,embedding,reranker,translation,docling}` — orchestrators point at the URL the operator defines |
| `in-cluster` | Pods on `gpu=true` nodes; weights on a ReadWriteOnce PVC | `models.{llm,reranker}.modelId` + `models.cache` PVC; orchestrators reach models by in-cluster Service name |

Both modes rely on the `vllm-api-key` Secret.

**`services.backend.translation.streamingEnabled`** — stream the
target-language chat translation during generation (issue #829). Default
`true`. Set `false` only when the target LLM-translation backend cannot
keep up with the chat stream.

**`services.backend.translation.endpoint`** — set to the GPU-node
translation API to skip the in-process CPU model (which burns a CPU core
per dashboard render).

**`pluggable.storageClassName`** — overrides the cluster default StorageClass
for chart-managed PVCs. Empty string = use the cluster default.

## Access

**Dev port-forward.** The validated dev loop on a laptop minikube:

```bash
kubectl -n genieai port-forward svc/nginx 8080:80
# Browse http://localhost:8080
```

The overlay sets `ingress.scheme: http` and `ingress.host: localhost:8080`
in this mode so Keycloak's issuer match and the SPA's secure-context
require a `localhost` browser origin.

**Phase 2 ingress** (Gateway API + Envoy Gateway + cert-manager) is on the
remaining phases list; once shipped the `kubectl port-forward` step above
will move to the Gateway's external hostname.

## Validation

**Helm tests** — two test pods verify namespace + data-tier wiring:

```bash
make test                                  # ct install + helm test against kind
helm test genieai -n genieai
```

Both test Pods need `kubectl`; the chart's init container downloads it
into a shared `emptyDir`.

**Service health** — once nginx is reachable:

```bash
curl -sk http://localhost:8080/healthz                    # nginx
curl -sk http://localhost:8080/api/health                 # backend (per-values wiring)
```

**Flux reconciliation:**

```bash
flux get hr genieai -n flux-system
flux reconcile hr genieai -n flux-system
```

**Pre-install hook failures** — the chart runs a dependency-graph Job
before any regular resource lands. If a `services.*` entry references a
disabled data tier, the Job fails the install with a clear
`dependency not satisfied` message naming the missing component.

## Reference

- Chart source: `charts/genieai-umbrella/` (`values.yaml`, `README.md`)
- Chart shipped versions: `charts/genieai-umbrella/Chart.yaml`
- Migration status, plan map, and remaining phases:
  `docs/charts/migration-status.md`
- Deploy repo: `genie-ai-deploy/overlays/<cluster>/<env>/`
