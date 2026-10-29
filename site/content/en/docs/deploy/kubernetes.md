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
last_reviewed: 2026-10-18
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
| CloudNativePG (`cnpg`) | a CRD serving `postgresql.cnpg.io/v1` | The Keycloak Postgres cluster (`keycloak-db`) |
| `keycloak-operator` | 26.8.0 | `Keycloak` CR + realm import infrastructure |
| `cert-manager` | latest | Per-env TLS — required when issuer pinning is enabled |
| `sealed-secrets` (or alternative) | ≥ 0.40 | Encrypts Secrets into the deploy repo |

Later tiers add: GPU device plugin + node feature discovery (when
`opea.gpu.mode=in-cluster`). The Envoy Gateway is NOT a prerequisite — it
ships as a chart dependency (`envoyGateway.enabled`, default on); see
[Exposure topologies](#exposure-topologies).

**Node labels** (when running models in-cluster):

```bash
kubectl label node <gpu-node> gpu=true
```

The chart selects the GPU node with `opea.models.nodeSelector`, which
defaults to `gpu: "true"`. A cluster that labels its GPU nodes
differently (NVIDIA GPU Feature Discovery ships
`nvidia.com/gpu.present=true`) sets the map in its overlay — it replaces
the default outright, so the pods need only the labels you declare.

**Air-gapped clusters.** Set `global.kubeletToolsMirror` to an internal URL;
the chart's pre-upgrade cluster-profile hook and its helm-test Pods
`curl`-download `kubectl` from a default public mirror otherwise.

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

The chart renders NO Namespace object for the release namespace — helm
creates it, so pass `--create-namespace` to have it propagated before the
pre-install hooks run (without it the first hook Job never schedules:
"namespaces \"genieai\" not found"). The chart does render one other
Namespace, `<release-namespace>-obs`: the observability tier's file-log
agent reads the node's `/var/log/pods` through hostPath volumes, which
the release namespace's pod-security baseline forbids. `my-values.yaml` must
carry the values the render requires — the public origin, the operator
contact, a mail server and the client-secret placeholders (see
[Configuration highlights](#configuration-highlights) and the chart
README's Quickstart for a complete working set).

### Path B — Flux deploy-repo overlay

Use for GitOps. Each environment lives under `genie-ai-deploy/overlays/<cluster>/<env>/`:

```
overlays/<cluster>/<env>/
├── kustomization.yaml            # resource list (incl. SealedSecrets)
├── gitrepository-chart.yaml      # Flux GitRepository for genie-ai repo
├── helmrelease.yaml              # HelmRelease → charts/genieai-umbrella
├── helmrelease-kube-arangodb.yaml # per-namespace ArangoDB operator HelmRelease
├── helmrepository-arango.yaml    # chart source for that operator
├── namespace-genieai.yaml        # the genieai Namespace
├── values.yaml                   # ConfigMap values (cluster-shared, public)
├── secrets.template.yaml         # plaintext source for SOPS encryption (committed)
├── secrets.sops.yaml             # encrypted output (committed; decrypts via Flux SOPS integration when configured)
└── secrets/                      # SealedSecret materializations
    ├── arango-root-secret.yaml
    ├── keycloak-admin-credentials.yaml
    └── ...
```

The `HelmRelease` references the operator-owned values through
`valuesFrom`: a `ConfigMap` in the Flux namespace carries them, and an
overlay that also ships SOPS-encrypted values adds a `Secret` entry
beside it. Inline `values:` carries the per-pays overrides. The chart's
placeholder guard (`data.keycloak.failOnPlaceholderSecrets`) stays at
its default — **on**: an overlay that feeds the realm's client secrets
through the convergence Job's `envSecrets` rows declares non-placeholder
values for `data.keycloak.clientSecrets.*`, and the render then fails if
a realm placeholder has no row to resolve it from (kcc would otherwise
fail at import time with an opaque parse error). The Application
Secrets consumed by the chart (the
table above) are materialized in the `genieai` namespace as regular
Secrets by the SealedSecret controller (one `SealedSecret` per Secret,
committed in the overlay's `secrets/` directory) and mounted by the
chart's pods directly — they do not flow through `valuesFrom`.

per-overlay deltas:

```yaml
valuesFrom:
  - name: genieai-public        # ConfigMap, in the Flux namespace
    kind: ConfigMap
  # - name: genieai-secrets     # operator-override Secret (SOPS path;
  #   kind: Secret              # encrypted-only until the Flux SOPS
  #                              # decryption provider is installed)
# Inline `values:` — per-pays overrides only.
```

Set `spec.timeout` (the HelmRelease-wide bound) to **60m**, and
`spec.install.timeout` to **2700s** — the install pulls every image
(~20 GB on a cold cluster) before the pods can start, and the pull alone
outran a 15-minute bound on the laptop cluster; two real installs hit the
helm-controller's 5-minute default with "context deadline exceeded".
`spec.upgrade.timeout` covers the Keycloak convergence hook (kcc) and the
operator CRD reconciliation, and **900s** is enough for it.

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
| `keycloak-convergence-credentials` | `GENIE_ADMIN_PASSWORD`, `EMAIL_PASSWORD` | kcc convergence Job (`$(env:VAR)` placeholders in the realm body) — `EMAIL_PASSWORD` is the realm's SMTP password: the `smtpServer` block always renders, so the Job resolves it on every install |
| `keycloak-proxy-client-secret` | `KEYCLOAK_PROXY_CLIENT_SECRET` | Backend env (`genie-proxy-client` service account) |
| `kc-dataprep-client-secret` | `KC_DATAPREP_CLIENT_SECRET` | Dataprep client-credentials grant |
| `kc-grafana-client-secret` | `KC_GRAFANA_CLIENT_SECRET` | Grafana OIDC client |
| `translation-cache-password` | `password` | Backend translation cache |

Additional Secrets used in the SealedSecret pattern: `keycloak-db-credentials`,
`arango-jwt-secret`. A `kc-grafana-client-secret` is required when Grafana
SSO is enabled (planned Observability tier).

Setting `data.keycloak.convergence.enabled=false` skips the kcc hook and
the realm is never imported — useful for smoke installs.

## Configuration highlights

**`clusterProfile`** — drives replica counts and (where implemented) data-tier
topology. Valid values: `dev`, `staging`, `prod`. `sovereign` is reserved
until that profile lands. Per-service overrides go through
`clusterProfileReplicas` in your overlay; the data tier's instance counts
(Keycloak, Postgres) come from `clusterProfileInstances`. Both tiers
resolve their count the same way: an **explicit** value wins, then the
cluster profile, then 1. `services.<svc>.replicas` and
`data.<tier>.instances` are null by default, and that null is what keeps
"unset" (the profile applies) distinguishable from "the operator pinned a
count" (it wins). Pinning a count of 0 switches a stateless tier off on
every profile: the profile used to win, so an operator on `prod` who
scaled a tier off got the profile's count back — plus a
PodDisruptionBudget for pods they had switched off. A data-tier count of
0 is rejected at render time (a CNPG Cluster or a Keycloak CR cannot
scale to zero).

**`ingress.host` and `ingress.scheme`** — public origin, **required** (no
chart default: the render fails with a supply-it message when unset).
`host` may carry a port (`genieai.local:4443`) — the port is kept for the
OIDC issuer and redirect URLs, and stripped where Kubernetes expects a
bare hostname (HTTPRoute hostnames, TLS `dnsNames`). `scheme` feeds
`KC_PUBLIC_ORIGIN` (realm `redirectUris`/`webOrigins`). See
[Exposure topologies](#exposure-topologies) below for the full matrix.

**`opea.enabled`** and **`opea.gpu.mode`** — enable the six OPEA
orchestrators (chatqna, retriever, dataprep, reranker, embedding,
translation) and pick the model-source world:

| Mode | Models run where | Endpoint layout |
|---|---|---|
| `external` | A standalone GPU node reachable by HTTPS (e.g. `https://10.0.0.110:444`) | `opea.gpu.nodeHost` + `opea.gpu.paths.{llm,embedding,reranker,translation,docling}` — orchestrators point at the URL the operator defines |
| `in-cluster` | Pods on `gpu=true` nodes; weights on a ReadWriteOnce PVC | `models.{llm,reranker}.modelId` + `models.cache` PVC; orchestrators reach models by in-cluster Service name |

Both modes rely on the `vllm-api-key` Secret.

**`data.keycloak.smtp` and the realm's mail flags** — the chart mirrors the
Compose deployment: `verifyEmail` and `resetPasswordAllowed` default to
`true`, and the render **fails** when either is on without a mail server.
A deployment that owns a mailbox names its relay here
(`from`, `host`, `port`, `ssl`, `starttls`, `auth`, and `user` when
`auth` is on) and keeps the defaults. A deployment that genuinely sends
no mail turns the two flags off in its overlay, where the choice is
visible — the chart never infers it from the absence of an `smtp` block,
because the realm's `smtpServer` block always renders.

**`services.backend.translation.streamingEnabled`** — stream the
target-language chat translation during generation (issue #829). Default
`true`. Set `false` only when the target LLM-translation backend cannot
keep up with the chat stream.

**`services.backend.translation.endpoint`** — the GPU-node translation API.
Naming one is a commitment, not a preference: the application treats a
named API as **mandatory**, waits for it at startup and refuses to come up
if it does not answer. Leaving it unset (with the OPEA tier off) means no
GPU API is named, and the answer is translated by the in-process CPU model
(Xenova/nllb-200-distilled-600M — ~6 Gi at ONNX load and a core of steady
inference). A named endpoint that resolves to an in-cluster Service must
publish the port its container listens on (`targetPort` == `port`): a
NetworkPolicy's egress port is matched after DNAT, against the pod's port,
while the chart derives the rule's port from the URL — it cannot read an
operator-named Service's `targetPort`. A destination outside the cluster
(an IP literal, a node reached directly) has no such gap.

**`pluggable.storageClassName`** — overrides the cluster default StorageClass
for chart-managed PVCs. Empty string = use the cluster default.

## Exposure topologies

The chart ships an Envoy Gateway as an optional dependency
(`envoyGateway.enabled`, default `true`) and renders Gateway API
resources (`Gateway`, `GatewayClass`, `HTTPRoute`, optional
cert-manager `Certificate` and CORS `SecurityPolicy`). **There is no nginx
in the Kubernetes data path** — Envoy routes every public path (`/` SPA,
`/api/`, `/api-docs/`, `/auth/` Keycloak, `/api/files/` + `/uploads/`
document repository). Pick one of three scenarios:

### Scenario 1 — Edge deployed, port-forward as the local front (laptop/dev)

The full edge tier is deployed exactly as in Scenario 2 (Gateway API
resources rendered, Envoy routes everything), but there is no LoadBalancer
or DNS — a `kubectl port-forward` fronts the Envoy data-plane Service as
the stand-in. Use a **non-privileged local port** carried in
`ingress.host` (e.g. `genieai.local:4443`) so the browser origin matches
the OIDC issuer without root.

```mermaid
flowchart LR
    dev["Developer browser<br/>https://genieai.local:4443"]
    pf["kubectl port-forward<br/>4443 → envoy svc 443"]
    edge["Envoy data-plane<br/>(Gateway + HTTPRoute active)"]
    subgraph cluster ["namespace: genieai"]
        edge --> spa["frontend (SPA)"]
        edge --> api["backend"]
        edge --> kc["keycloak"]
    end
    dev --> pf --> edge
```

| Knob | Value |
|---|---|
| `ingress.enabled` | `true` |
| `envoyGateway.enabled` | `true` |
| `ingress.host` | `genieai.local:4443` (port-bearing, `https://` scheme) |

> `ingress.enabled: false` renders no Gateway/HTTPRoute at all — Envoy has
> nothing to route and any port-forward to it 404s. With the edge off, the
> NetworkPolicies also become ingress default-deny for the SPA: that mode
> assumes a CNI that does not enforce NetworkPolicy (minikube kubenet).
> Real clusters should run one of the scenarios above.

### Scenario 2 — Envoy Gateway in-chart (default)

`ingress.enabled: true` + `envoyGateway.enabled: true` (default). The chart
installs Envoy Gateway, owns the `GatewayClass`, terminates TLS
(cert-manager `Certificate` from `ingress.tls.issuerName`, or a pre-baked
Secret via `ingress.tls.secretName`), and NetworkPolicies only admit the
Envoy data-plane pods as external peers.

```mermaid
flowchart LR
    user["Users<br/>https://genie.example.org"]
    subgraph chart ["chart-managed edge"]
        gc["GatewayClass: envoy"]
        gw["Gateway genieai<br/>(TLS terminate)"]
        hr["HTTPRoute genieai<br/>/ → frontend · /api/ → backend<br/>/auth/ → keycloak · /api/files/ → doc-repo"]
    end
    eg["Envoy Gateway controller<br/>(chart dependency)"]
    dp["Envoy data-plane pods<br/>(Gateway's namespace)"]
    subgraph app ["namespace: genieai"]
        spa["frontend"]
        api["backend"]
        kc["keycloak"]
        dr["document-repository"]
    end
    eg -- adopts --> gc
    gc --> dp
    user --> dp --> gw
    hr -.routes.- dp
    gw --> hr
    hr --> spa & api & kc & dr
```

| Knob | Value |
|---|---|
| `ingress.enabled` | `true` |
| `envoyGateway.enabled` | `true` (default) |
| `ingress.tls.enabled` / `issuerName` / `secretName` | cert-manager flow (`issuerKind`: `ClusterIssuer` by default, set `Issuer` for a namespace-scoped one) or pre-baked certificate |
| `ingress.cors.allowOrigins` | optional CORS `SecurityPolicy` (empty = same-origin, no policy rendered) |

Two operational notes on this scenario:

- The certificate SAN is always the **port-stripped** hostname; an external
  issuer workflow must align its identifiers with that form.
- `GatewayClass.spec.controllerName` is immutable — upgrading a cluster
  that still carries a GatewayClass created with an older chart's
  controller name requires a one-time `kubectl delete gatewayclass envoy`
  (the chart recreates it).

### Scenario 3 — External controller / off-cluster edge

`ingress.enabled: true` + `envoyGateway.enabled: false`. The chart still
renders the `Gateway`/`HTTPRoute` set; your own controller implements the
`envoy` class (`ingress.className`). Typical sovereign shape: a DMZ edge
outside the cluster fronts Envoy (TLS re-encrypt or SNI passthrough) while
Envoy stays the single in-cluster path router — one routing table, no
second aggregator to keep in sync.

```mermaid
flowchart LR
    user["Users"]
    dmz["DMZ edge<br/>(site-owned: LB / firewall / VIP)"]
    subgraph cluster ["Kubernetes cluster"]
        ctl["your Gateway API controller<br/>(implements class: envoy)"]
        dp["Envoy data-plane"]
        subgraph app ["namespace: genieai"]
            svc["frontend · backend · keycloak · doc-repo"]
        end
    end
    user --> dmz -- "TLS re-encrypt or SNI passthrough" --> dp
    ctl -.adopts.-> dp
    dp --> svc
```

| Knob | Value |
|---|---|
| `ingress.enabled` | `true` |
| `envoyGateway.enabled` | `false` |
| `ingress.className` | your controller's class (default `envoy`) |
| `ingress.dataplaneNamespace` | set when the data-plane runs outside the app namespace (NetworkPolicy peers) |

### In-cluster transport security

The chart deliberately ships **no application-level TLS inside the
cluster**: TLS terminates at the edge, and service-to-service traffic
(frontend → backend, backend → chatqna, JWTs included) rides the pod
network in the clear. Clusters that require wire encryption for that
traffic should enable it at the CNI (WireGuard encryption in Cilium or
Calico) at cluster bootstrap — that covers every pod, including same-node
veth traffic, without per-service certificates or a mesh.

## Access

**Dev port-forward** (Scenario 1 — the validated laptop loop):

```bash
kubectl -n genieai port-forward svc/envoy-genieai-genieai-<hash> 4443:443
# Browse https://genieai.local:4443  (self-signed certificate)
```

The overlay sets `ingress.host: genieai.local:4443` and `scheme: https`;
`/etc/hosts` maps `genieai.local` to `127.0.0.1`. The browser origin must
carry the same port as the OIDC issuer or login redirects mismatch.

**Exposed environments** (Scenarios 2–3): browse the `ingress.host`
origin directly; TLS is the edge's concern.

## Validation

**Helm tests** — two test pods verify namespace + data-tier wiring:

```bash
make -C charts test                        # ct install on a throwaway kind cluster
helm test genieai -n genieai               # the chart's test pods, against a running release
```

`make -C charts test` boots its own kind cluster, installs the chart
with the data tier off (the operators and their CRDs are cluster
prerequisites, absent there) and tears the cluster down — it proves the
render and the install ordering, not a working stack. The helm-test
pods run against a release you already installed, and both need
`kubectl`; the chart's init container downloads it into a shared
`emptyDir`. There is no `make test` at the repository root.

**Service health** — through the edge:

```bash
curl -sk -H "Host: genieai.local" https://localhost:4443/api/health   # backend
```

**Full live set** (per release cycle): themed login page, Register link,
French streamed chat, document upload → scan → ingestion, and a RAG answer
citing the freshly ingested document.

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
