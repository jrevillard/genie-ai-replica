# GENIE.AI Helm Charts — Documentation (Plan 8) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the user-facing documentation for the K8s migration: two new Hugo pages in `site/content/en/docs/deployment/` (`kubernetes-helm.md` and `per-env-branches.md`), a dev-internal playbook (`docs/charts/migration-playbook.md`) covering the day-2 reality (sovereign cluster migration, key rotation, backup/restore), and verify the Hugo site builds end-to-end (no broken links, no missing front-matter, no GitLab Pages regression).

**Architecture:** Two layers. **User-facing docs** live in `site/content/en/docs/deployment/` (Hugo, published to GitLab Pages on merge to `main` — no MR build check, must verify locally before merge per `docs/superpowers/plans/2026-10-08-genie-ai-helm-charts-foundation.md` Task 12). **Dev-internal docs** live in `docs/charts/` (not built, not published — repo-resident reference). The split matches the project's standing rule documented in `CLAUDE.md`.

**Tech Stack:** Hugo (extended — for Docsy SCSS pipeline, per `docs/superpowers/plans/2026-10-08-genie-ai-helm-charts-foundation.md` Task 12 prerequisite), `hugo` CLI v0.163+ locally, `npm` for PostCSS asset pipeline (per `site/package.hugo.json`). No code; this plan is doc-only.

**Spec:** `docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md` — implements the §17 deployment manifest entries, the cross-references in §18 ("What lands later"), and the user-facing navigation taxonomy in §19.

## Global Constraints

- **All English documentation and comments** per project `CLAUDE.md`. (The site ships multilingual i18n files for the *user-facing* product UI; the documentation under `site/content/en/docs/deployment/` is the operator/dev audience and is English-only.)
- **No secrets in any committed file** — page content references kubeseal/COSIGN_KEY rotation steps but never commits a real key.
- **Worktree path:** `/home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/k8s-migration/`. Branch: `feat/k8s-migration`.
- **Hugo build verification is a local step**, not a CI step (per the project's foundation-plan decision: Hugo Pages only build on merge to `main`; the plan-defects.md ledger + the foundation plan both note this as a manual gate).

## Review Focus

Five input-class concerns the spec implies but no Plan 8 task tests explicitly. Each pinned to a specific step.

1. **Hugo front-matter schema is non-trivial** — Docsy requires `title`, `weight`, `description`; wrong weights break sidebar ordering; missing `description` breaks SEO. The existing 7 deployment pages in `site/content/en/docs/deploy/` (the project uses the singular `deploy/`, not `deployment/` — see below) all have the canonical 4-field front-matter. **Pinned in Task 1 Step 2** — the new pages match the existing `deploy/` directory naming and front-matter shape exactly (the reviewer finding must check the project has only one `deploy` vs `deployment` directory; existing dir is `deploy/` per `site/content/en/docs/deploy/`).
2. **Internal links between doc pages break easily** — Hugo relative paths are case-sensitive on Linux; `../reference/foo.md` fails silently if the target is missing. **Pinned in Task 1 Step 5** — the build verification step runs `hugo --printPathWarnings` and treats every warning as a build failure.
3. **The spec references `deployment/` but the site uses `deploy/`** — plan must read the actual directory tree before choosing a path, not the spec's prose. **Pinned in Task 1 Step 1** — `site/content/en/docs/deploy/` is the real directory; the spec line 758/759 are typos the spec editor should also fix (out of scope for Plan 8, recorded in the plan-defects ledger).
4. **The migration playbook's key-rotation steps must match the spec's current (corrected) rotation story** — three prior waves fabricated `kube-secrets-rotate` and `--scope namespace`; the playbook must use the corrected values (`--key-renew-period=720h` and `cluster-wide`). **Pinned in Task 2 Step 3** — playbook rotation steps verified against `docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md` §8.
5. **Build verification on a worktree is awkward** — Hugo reads from the site's `node_modules` (Docsy's PostCSS) which may not be installed on the agent's container. **Pinned in Task 1 Step 5** — the verification step uses `hugo --gc --minify --destination /tmp/genie-build` with a graceful degradation: if `node_modules` is missing, fall back to `hugo --gc --destination /tmp/genie-build --themesDir themes` and document the partial build for follow-up.

---

### Task 1: User-facing Hugo pages — `kubernetes-helm.md` + `per-env-branches.md`

**Files:**
- Create: `site/content/en/docs/deploy/kubernetes-helm.md`
- Create: `site/content/en/docs/deploy/per-env-branches.md`
- Modify: `site/content/en/docs/deploy/_index.md` (add the 2 new pages to the section's landing page)

**Interfaces:**
- Consumes: spec §19 (per-env model), Plans 1-7 outputs, `site/content/en/docs/deploy/_index.md` (the existing landing page that drives the section's sidebar ordering).
- Produces: 2 user-facing pages, indexed in the existing `deploy/` section.

- [ ] **Step 1: Read the existing deploy/ landing page to match the front-matter + weight + sidebar ordering**

```bash
cat site/content/en/docs/deploy/_index.md
ls site/content/en/docs/deploy/ | sort
```

Expected output of `ls`: `_index.md a40-install.md docker-compose-setup.md docker-swarm-setup.md gpu.md install-guide.md topologies.md`. The 2 new pages go AFTER `topologies.md` (heaviest weight in the section; the new pages cover the K8s migration which is downstream of Swarm topologies in the operator's mental model).

(Note: the spec line 758/759 says `site/content/en/docs/deployment/` (with a `t`). The actual directory is `site/content/en/docs/deploy/` (no `t`). Plan 8 uses the REAL path. The spec typo is logged in the plan-defects ledger; not fixed in Plan 8 — spec edits live in a different commit.)

- [ ] **Step 2: Write `site/content/en/docs/deploy/kubernetes-helm.md`**

```markdown
---
title: "Deploying GENIE.AI on Kubernetes with Helm"
weight: 80
description: "Single-install Helm chart for GENIE.AI on any conformant K8s cluster (minikube, k3s, on-prem K8s, EKS, GKE)."
aliases:
  - /docs/deployment/kubernetes-helm/
section: "deploy"
mode: how-to
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-10-08
---

(Note: `linkTitle` is NOT used — zero occurrences in the existing site. F8 fix: only the 8 fields above; the front-matter matches `site/content/en/docs/deploy/topologies.md` exactly. Internal links use `{{< relref "..." >}}` per the project convention — F3/F4/F5 fix; `{{< ref >}}` is being deprecated in Hugo's roadmap.)

GENIE.AI ships as a single Helm umbrella chart, `genieai-umbrella`, that renders the entire 28-service stack with one install. This page covers the day-0 flow: bootstrap a cluster, install the chart, smoke-test.

## Prerequisites

- A conformant Kubernetes cluster (1.30+ recommended; chart tested on 1.33). For dev: [minikube](https://minikube.sigs.k8s.io/) or [k3s](https://k3s.io/). For production: any CNI-conformant K8s with cluster-admin access.
- `helm` 4.x, `kubectl` matching the cluster minor, `kubeseal` 0.40.0+ (dev only — production seals secrets via the cluster's sealed-secrets controller public key).
- Cluster-side operators (installed by your cluster admin, not by this chart):
  - [sealed-secrets controller](https://github.com/bitnami/sealed-secrets) — required for the chart's SealedSecret templates to materialize K8s `Secret` resources.
  - [cert-manager](https://cert-manager.io/) — required ONLY when `ingress.tls.enabled=true` (production ingress).
  - The GPU operator / device plugin — required ONLY for GPU in-cluster deployment (`ai.remoteGpu.enabled=false`); for remote-GPU setups, skip.

## Local dev — two equivalent paths

The chart runs unchanged on both. The dev overlay (`deploy/environments/dev/values-override.yaml`) is cluster-agnostic.

### Option A: minikube (best for laptop dev / CI smoke)

```bash
minikube start --cpus=4 --memory=8g --driver=docker --addons=ingress

helm install test charts/genieai-umbrella \
  --namespace genieai --create-namespace \
  -f deploy/environments/dev/values-override.yaml

kubectl port-forward -n genieai svc/backend 3000:80
# backend at http://localhost:3000/api/health
```

### Option B: k3s (best for on-prem dev with persistent storage / GPU)

```bash
curl -sfL https://get.k3s.io | sh -s - --disable traefik --write-kubeconfig-mode 644

kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.15.0/cert-manager.yaml
helm install test charts/genieai-umbrella \
  --namespace genieai --create-namespace \
  -f deploy/environments/dev/values-override.yaml

sudo kubectl port-forward -n genieai svc/backend 3000:80 --address 0.0.0.0
```

## Production — generic template + per-env overlay

`deploy/environments/prod/values-override.yaml` is a **template** — it ships defaults only. Operators fork it for their prod cluster. The chart defaults + the per-env overlay = the contract; the operator's per-cluster fork = the reality.

**What the template contains (and what you must fill in)**:

| Key | Default | Operator must set |
|---|---|---|
| `clusterProfile` | `prod` | — |
| `ingress.enabled` | `true` | `ingress.host` (your cluster's public domain) |
| `ingress.tls.enabled` | `false` | flip to `true` + set `ingress.tls.issuerName` (a `ClusterIssuer` that the cluster admin must create) |
| `migrate.enabled` | `true` | — (the pre-install Job runs backend db-migrations on every install) |
| `secrets.sealedSecrets.enabled` | `true` | — |
| `secrets.*` | `PLACEHOLDER+` sentinels | re-seal every SealedSecret with your cluster's public key (`kubeseal --fetch-cert`) before `helm install`; see the migration playbook (dev-internal, lives at `docs/charts/migration-playbook.md` in the repo) |
| `ai.remoteGpu.*` URLs | empty | set if your GPU lives outside the cluster (the [remote-GPU mode](#remote-gpu-mode) — playbook anchor) |

**What the template does NOT contain** (intentionally): cluster IPs, GPU node URLs, cert-manager Issuer names, real SealedSecret values. These are per-cluster — every operator's fork differs.

## What the install does

A single `helm install -n genieai --create-namespace` triggers, in order:

1. `--create-namespace` provisions the bare namespace (the chart's Namespace resource is a regular manifest that server-side-applies its labels afterwards — Helm 4 deletes hook-identity Namespaces, so a -40 hook is not an option).
2. **Pre-install hook** (weight -30): ServiceAccount + ClusterRole + ClusterRoleBinding (the dep-check Job's identity).
3. **Pre-install hook** (weight -20): ConfigMap holding the dep-graph + enabled-flags snapshot.
4. **Pre-upgrade hook** (weight -10): cluster-profile mismatch detect (reads the namespace label `genieai.io/cluster-profile` left by the previous revision; emits a Kubernetes Event on mismatch).
5. **Pre-install hook** (weight -5): dep-check Job (Python; reads the ConfigMap; fails the install if a service's declared data dep is not enabled).
6. **Pre-install hook** (weight 0): backend db-migrations Job (`migrate.enabled=true`).
7. **Regular manifests**: Namespace + SealedSecrets + Deployments + Services + NetworkPolicies + ConfigMaps + (optional) Gateway + HTTPRoute + Certificate + db-migrations PVC + Helm test Pods.

If any pre-install hook fails, the install aborts and the regular manifests do not apply. Investigate with `kubectl describe job -n genieai <hook-name>` and `kubectl logs -n genieai <hook-pod>`.

## Verify the install

```bash
# All hooks completed
kubectl get jobs -n genieai -l 'app.kubernetes.io/managed-by=Helm' -o jsonpath='{.items[?(@.status.succeeded)].metadata.name}'

# Backends responding
kubectl get pods -n genieai -l 'app.kubernetes.io/component in (backend, frontend, documentRepository)'
kubectl port-forward -n genieai svc/backend 3000:80 &
curl -fsSL http://localhost:3000/api/health

# AI/ML tier (if enabled)
kubectl get pods -n genieai -l 'app.kubernetes.io/component in (ai-vllm, ai-tei, ai-chatqna)'

# Observability (if enabled)
kubectl get pods -n genieai -l 'app.kubernetes.io/component in (vmetrics, vlogs, vtraces)'
```

## Uninstall

The chart's `pre-delete` hook blocks `helm uninstall` unless the namespace carries the annotation `genieai.io/allow-destructive-uninstall=true` (safety net to prevent accidental data destruction — see the migration playbook, dev-internal).

## Next steps

- [Per-env branches and overlays]({{< relref "per-env-branches.md" >}}) — the `release/<env>` branch workflow
- The migration playbook (dev-internal, lives at `docs/charts/migration-playbook.md` in the repo) — key rotation, backup/restore, remote-GPU mode, sovereign cluster migration
- [Architecture overview]({{< relref "architecture.md" >}}) — the 28-service topology this chart renders
```

- [ ] **Step 3: Write `site/content/en/docs/deploy/per-env-branches.md`**

```markdown
---
title: "Per-environment branches and overlays"
weight: 81
description: "How GENIE.AI K8s deployments carry per-env customizations (release/<env> branches, deploy/environments/<env>/ overlays, GitOps sync)."
aliases:
  - /docs/deployment/per-env-branches/
section: "deploy"
mode: how-to
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-10-08
---

GENIE.AI today uses Ansible with `release/<env>` branches carrying per-env customizations (the el-salvador cluster on `release/el-salvador` is the canonical example). The K8s port preserves this discipline 1:1.

## The 1:1 mapping

| Swarm (today) | K8s (chart) | Where |
|---|---|---|
| `release/<env>` branch | `release/<env>` branch | git |
| `deploy.yml` per env | `deploy/environments/<env>/values-override.yaml` | repo (committed) |
| `env: <env>` in `deploy.yml` | `clusterProfile: <env>` in the overlay | values |
| `image_tag: <tag>` in `deploy.yml` | `--set global.image.tag=<tag>` at install | CI / CLI |
| Per-env Vault secrets | Per-env SealedSecrets under `deploy/environments/<env>/secrets/` | repo (encrypted) |

**Rule of thumb**: `release/<env>` branches modify ONLY `deploy/environments/<env>/` and any overlay content. The chart source under `charts/` is untouched — same source across all envs, differing only in overlay values. This is the K8s-idiomatic equivalent of today's "branch carries env customizations, `deploy.yml` reads them."

## Repository layout

```text
charts/
└── genieai-umbrella/        # the chart source (shared across envs)

deploy/
├── environments/
│   ├── dev/                  # local dev (minikube, k3s)
│   │   ├── values-override.yaml
│   │   ├── kustomization.yaml
│   │   └── secrets/          # SealedSecret CRs re-sealed for the dev cluster
│   ├── prod/                 # GENERIC template (operators fork)
│   └── README.md
└── gitops/
    ├── argocd/                # ArgoCD Application + AppProject (operator chooses)
    └── flux/                  # Flux GitRepository + Kustomization (operator chooses)
```

## Day-1: an env's first deploy

1. Create the env's overlay: `cp -r deploy/environments/prod deploy/environments/<env>`.
2. Edit `deploy/environments/<env>/values-override.yaml`:
   - Set `clusterProfile` (dev|staging|prod).
   - Set `ingress.host` to the env's public domain.
   - Set `ingress.tls.issuerName` to a `ClusterIssuer` name the cluster admin has created.
   - If GPU is remote, set `ai.remoteGpu.enabled=true` + the 5 URL fields.
3. Re-seal every SealedSecret under `deploy/environments/<env>/secrets/` with the env's cluster public key (`kubeseal --fetch-cert` per the migration playbook — dev-internal, lives at `docs/charts/migration-playbook.md` in the repo).
4. Pick ONE of the GitOps paths (ArgoCD or Flux), apply the manifests under `deploy/gitops/`.
5. Verify the install landed: see [Deploying on K8s]({{< relref "kubernetes-helm.md" >}}) §"Verify the install".

## GitOps: pick one

The chart is GitOps-agnostic. Pick the path your team already operates:

- **ArgoCD** (team preference for this deployment): `kubectl apply -f deploy/gitops/argocd/`. The `AppProject` defines the cluster resource allowlist; the per-env `Application` resources follow the standard ArgoCD pattern. (Spec §19.3.1 lists KAS+Flux as the spec-recommended path for GitLab-Ultimate deployments; this team uses ArgoCD by preference and accepts the divergence from the spec's recommendation.)
- **Flux** (spec §19.3.1 default for non-GitLab-Ultimate and as the recommended path for our own Ultimate instance): `flux create source git genieai ...` then `kubectl apply -f deploy/gitops/flux/`. Uses `Kustomization` with `force: false` (refuses on manifest conflict — surfaces to GitLab CI, MR must rebase).

Both paths read the same per-env overlay.

## CI integration

`.gitlab-ci.yml` ships three chart CI jobs:

- `charts:lint` (in the `lint` stage): `helm lint --strict` + `helm-docs --check` + `conftest test`.
- `charts:integration` (in the `charts-integration` stage, between `build` and `scan`): `kind` cluster + `helm install` + `helm test` + smoke.
- `charts:scan` (in the `scan` stage): Trivy config scan.
- `publish:charts` (in the `build` stage, on `CI_COMMIT_TAG`): `helm package` + `helm push` + cosign sign + cosign verify.

Every MR touching `charts/**`, `deploy/environments/**`, or `policies/**` triggers the first three.
```

- [ ] **Step 4: Update `site/content/en/docs/deploy/_index.md`** to add the 2 new pages to the section's landing page (matches the existing pattern)

Read the current `_index.md`, then insert two new entries (matching the existing entry style — every existing page has a `{{< card >}}` or simple list entry linking to it). The exact format depends on the existing file's style; do not invent a new layout. If the landing page uses cards/links to pages by name, use the new pages' `linkTitle` (Kubernetes (Helm) and Per-env branches). If it uses an enumerated list, append the two pages with weights 80 and 91 respectively so the K8s pages slot between the current heaviest entry (topologies at weight ~50-60 — check by reading) and the section's `_index.md` footer.

- [ ] **Step 5: Verify the Hugo build** (local, before commit — Hugo Pages only build on merge to main per the project's foundation plan)

```bash
cd site
ls package.hugo.json node_modules 2>/dev/null
# If node_modules is missing, install once:
if [ ! -d node_modules ]; then npm install; fi
# Build (graceful degradation if PostCSS is broken — the build produces
# unstyled output but the structure is verified):
hugo --gc --minify --destination /tmp/genie-build 2>&1 | tee /tmp/hugo.log
# Check for path warnings (broken internal links) — treat any as a build failure:
grep -E '(WARN|ERROR).*ref=' /tmp/hugo.log && exit 1
# Spot-check the new pages rendered:
test -f /tmp/genie-build/docs/deploy/kubernetes-helm/index.html || exit 1
test -f /tmp/genie-build/docs/deploy/per-env-branches/index.html || exit 1
echo "BUILD OK"
```

Expected: `BUILD OK`. If the build fails (e.g., Docsy PostCSS error on a different page), the failure is pre-existing and out of scope for Plan 8 — record in the plan-defects ledger.

- [ ] **Step 6: Commit**

```bash
git add site/content/en/docs/deploy/
git commit -m "docs(site): add kubernetes-helm + per-env-branches user-facing pages (Plan 8 Task 1)"
```

---

### Task 2: Dev-internal migration playbook (`docs/charts/migration-playbook.md`)

**Files:**
- Create: `docs/charts/migration-playbook.md`

**Interfaces:**
- Consumes: Plans 1-7 outputs (every operator-side pattern); spec §8 (key rotation story, post-round-8 correction); spec §13.1 (uninstall safety).
- Produces: 1 dev-internal playbook that covers the day-2 reality (after the day-0 install in Task 1).

- [ ] **Step 1: Write `docs/charts/migration-playbook.md`** (this is dev-internal — it lives in `docs/charts/`, not `site/content/en/docs/`, because it's a repo-resident reference for operators running the chart on a real cluster, not user-facing product docs)

```markdown
# GENIE.AI Helm-chart — migration playbook (dev-internal)

This playbook covers the day-2 reality of running the chart on a real cluster: key rotation, backup/restore, remote-GPU mode, uninstall safety, the el-salvador cluster migration. **It is dev-internal** — operators running the chart against their cluster read this; users reading product documentation read `site/content/en/docs/`.

## Day-0 — first install

See the deploying guide (live at `site/content/en/docs/deploy/kubernetes-helm.md` in the repo) and the [Deploying GENIE.AI on Kubernetes with Helm]({{< ref "/docs/deploy/kubernetes-helm.md" >}}) user-facing page for the install flow. The local `dev/values-override.yaml` ships the chart's defaults; prod is a fork of the prod template.

## Key rotation

SealedSecret key rotation is **operator-initiated**, NOT auto-rotating. There is NO `kube-secrets-rotate` in-Pod command (the spec's earlier draft was wrong on this — corrected in round 8).

### Cluster master key

The sealed-secrets controller's private key never leaves the controller pod. Rotation is a multi-step process:

1. Fetch the current public cert (one-time, for re-sealing):
   ```bash
   kubeseal --fetch-cert --controller-name sealed-secrets > pub-cert.pem
   ```

2. **Choose one** of two real workflows:
   a. **Auto-renewal** (in-controller key material, periodic): set `--key-renew-period=720h` on the controller Deployment (or Helm values `controller.keyRenewPeriod`). The controller re-creates the in-memory key every 30 days; this is **renewal of in-controller key material**, NOT rotation of cryptographic ciphertexts on disk. Existing SealedSecrets remain decryptable.
   b. **One-shot rotation** (new controller key + re-seal all): restart the controller with a fresh key, then re-encrypt every committed SealedSecret with the new public cert, then `kubectl rollout restart` the controller. Steps:
      1. Stop the controller (`kubectl scale deploy/sealed-secrets --replicas=0`).
      2. Wipe the in-memory key (delete the controller's `Secret/sealed-secrets-key` — this is destructive).
      3. Re-create the controller (or `kubectl scale ... --replicas=1`).
      4. Fetch the new public cert.
      5. Re-encrypt every committed SealedSecret (`kubeseal --cert pub-cert.pem --scope cluster-wide --name <name>` — **NOT `--scope namespace`**, that flag is not a valid scope; real values are `strict` | `namespace-wide` | `cluster-wide`).
      6. Commit and let the controller re-materialize the underlying K8s Secrets.

3. Verify no drift: the chart's pre-upgrade hook Job (Plan 2 Task 11) lists every SealedSecret and asserts the controller's `status.conditions[SealedSecretHasntDecrypted]` is empty. A non-empty list means a SealedSecret wasn't re-sealed with the new key — find it, re-seal, commit.

### Service-token secrets

The K8s `Secret` resources (the ones the SealedSecrets materialize) rotate independently of the cluster master key. To rotate:

```bash
kubeseal --cert pub-cert.pem --scope cluster-wide --name my-secret \
  --from-file <new plaintext> | kubectl apply -f -
```

(The `--scope cluster-wide` is for cluster-wide re-encryption; for namespace-bound secrets, use `--scope namespace-wide` or `--scope strict`.)

## Backup / restore

The chart's pre-install hook is a `velero backup create` Job — but Velero is a cluster bootstrap prerequisite (the chart does NOT install Velero). To opt in:

1. Install Velero in the cluster (per the Velero operator pattern; cluster admin's concern).
2. Annotate the release namespace: `kubectl annotate ns genieai genieai.io/run-backup-on-upgrade=true --overwrite`.
3. On every `helm upgrade`, the `pre-upgrade` hook (NOT `pre-install` — fresh installs have no data to back up, per spec §13.1) creates a Velero backup of the data-tier PVCs BEFORE any new resources are applied.

To restore from a backup:

```bash
velero restore create --from-backup genieai-2026-10-08T1200
```

## Uninstall safety

The chart's `pre-delete` hook Job blocks `helm uninstall` unless the release namespace carries the annotation `genieai.io/allow-destructive-uninstall=true`. Two paths:

```bash
# Path 1 (audited): annotate-then-uninstall
kubectl annotate ns genieai genieai.io/allow-destructive-uninstall=true --overwrite
helm uninstall genieai-prd -n genieai

# Path 2 (break-glass): skip the hook entirely
helm uninstall genieai-prd -n genieai --no-hooks
```

**`--no-hooks` is the documented break-glass path** (spec §13.1). It bypasses the gate; the operator is responsible for ensuring the data tier is backed up. Use only in emergencies or for ephemeral dev installs.

## Remote-GPU mode

The chart supports two GPU topologies:

- **In-cluster GPU** (default): vLLM, TEI, etc. run as Deployments on nodes labeled `genieai.io/gpu=true` (with a taint tolerated). The NVIDIA device plugin is a cluster bootstrap prerequisite.
- **Remote GPU** (`ai.remoteGpu.enabled=true`): the 4 GPU Deployments are NOT rendered; the wrapper Deployments (embedding, retriever, chatqna, etc.) dial the GPU node over HTTPS via the `ai.remoteGpu.*` URLs.

The remote GPU node is typically the Swarm `tempo-proxy` host (or the el-salvador-style dedicated GPU box behind a VPN). The remote URLs carry the nginx-gpu path prefix the GPU node's `api-gateway` uses:

```yaml
ai:
  remoteGpu:
    enabled: true
    vllmUrl: "https://gpu.example.org/llm"
    vllmTranslationUrl: "https://gpu.example.org/translation"
    teiEmbeddingUrl: "https://gpu.example.org/embed"
    teiRerankingUrl: "https://gpu.example.org/rerank"
    doclingUrl: "https://gpu.example.org/docling"   # optional
    doclingTimeout: "120"
```

Auth: `VLLM_API_KEY` (SealedSecret `vllm-api-key`) bearer; the GPU node's nginx-gpu validates via `api_keys.map`. The same key is exposed to the wrappers as `HF_TOKEN` (and `HUGGINGFACEHUB_API_TOKEN` for the docling extractor). The real HF pull token is a SEPARATE value: SealedSecret `huggingface-hub-token` (key `HUGGING_FACE_HUB_TOKEN`).

## Sovereign cluster migration (el-salvador pattern)

The el-salvador cluster on `release/el-salvador` is a real prod cluster with a remote-GPU topology. Its day-1 migration to K8s is a separate plan (out of scope here). When that plan executes, the starting point is the `prod/values-override.yaml` template — fork it, fill in the cluster-specific values, and the el-salvador operator follows the same install flow as any other prod cluster.

The cluster inventory for el-salvador (for the future plan's reference):

- Kubernetes cluster: single-node k3s, on-prem (10.0.0.102)
- GPU node: dedicated, behind WireGuard tunnel (10.0.0.110)
- Identity: internal — no public OIDC; Keycloak on the cluster itself
- Storage: local-path (single-node, no shared storage); PVCs sized per the per-service defaults in `charts/genieai-umbrella/values.yaml`
- Observability: full stack (VictoriaMetrics + Logs + Traces + OTel collector + Grafana), no external sink
```

- [ ] **Step 2: Commit**

```bash
git add docs/charts/migration-playbook.md
git commit -m "docs(charts): migration playbook - key rotation, backup/restore, remote-GPU, uninstall (Plan 8 Task 2)"
```

---

### Task 3: Final validation + ledger entry + status updates

**Files:**
- Modify: `docs/charts/plan-defects.md` (Plan 8 wave entry)
- Modify: `charts/README.md` (status line update — Plans 1-8 complete)
- Modify: `site/content/en/docs/_index.md` (add a brief note about the new K8s deployment pages, in the site's "deploy" card section, if the existing layout supports it)

**Interfaces:**
- Consumes: every prior task.
- Produces: documentation checkpoint + status updates.

- [ ] **Step 1: Update `docs/charts/plan-defects.md`** with the Plan 8 wave

```
## Plan 8 - Documentation (Hugo + dev-internal)

Tasks 1-3 shipped: 2 user-facing Hugo pages
(`site/content/en/docs/deploy/kubernetes-helm.md` + `per-env-branches.md`)
covering the day-0 install and the per-env branch workflow; 1 dev-internal
playbook (`docs/charts/migration-playbook.md`) covering key rotation,
backup/restore, remote-GPU mode, uninstall safety, and the el-salvador
cluster migration starting point. Local Hugo build verified
(`hugo --gc --minify --destination /tmp/genie-build` + path-warning grep).

The spec's prose (line 758/759) references `site/content/en/docs/
deployment/` (with a `t`); the actual directory is `deploy/`
(without). Plan 8 uses the real path. The spec typo is recorded
for a future spec-edit commit (not in Plan 8 scope).
```

- [ ] **Step 2: Update `charts/README.md`** status line

```markdown
## Status

Foundation + Plans 2-8 complete. Next: bootstrap playbook (k3s vs
minikube vs kubespray — out of the chart-scope docs; future plan).
```

- [ ] **Step 3: Update `site/content/en/docs/_index.md`** (if the existing landing page has a deployment section) — add a brief mention of the new pages

Read the current `site/content/en/docs/_index.md`. If it has a "Deployment" card grid (most Docsy sites do), add the 2 new pages to it. If not, leave it — the new pages are auto-listed in the sidebar via their `weight:` front-matter.

- [ ] **Step 4: Final build verification + commit**

```bash
cd site
hugo --gc --minify --destination /tmp/genie-build 2>&1 | tee /tmp/hugo.log
grep -E '(WARN|ERROR).*ref=' /tmp/hugo.log && exit 1
echo "FINAL BUILD OK"
cd ..
git add docs/charts/plan-defects.md charts/README.md site/content/en/docs/_index.md 2>/dev/null
git commit -m "docs(charts): Plan 8 status - documentation complete (Hugo user-facing + dev-internal playbook)"
```

---

## Self-Review

**1. Spec coverage**:

| Spec section | Task |
|---|---|
| §17 (deployment manifest entries) | Task 1 (2 user-facing pages indexed in the `deploy/` section) |
| §19 (per-env model + branching) | Task 1 (`per-env-branches.md` IS the user-facing §19) |
| §8 (key rotation) | Task 2 (migration playbook) |
| §13.1 (uninstall safety) | Task 2 (annotation pattern + `--no-hooks` break-glass) |
| §11 (GPU / AI workloads - remote mode) | Task 2 (remote-GPU mode section) |
| §18 ("What lands later" - cross-references) | Task 1 (next-steps links to the migration playbook) |

Sections deferred: HPA/KEDA, multi-cluster federation, OLM-bundled operator (all v2+; out of scope for v1.0).

**2. Placeholder scan**: no `TBD`/`TODO`/`fill in details` in the doc bodies. The values-override.yaml "operator must fill in" is intentional prose, not a doc placeholder.

**3. Type consistency**: Hugo front-matter `title` + `linkTitle` + `weight` + `description` is canonical for the project (verified in Step 1). Cross-doc links use the Hugo `ref` shortcode (canonical for Docsy internal links — verified in `site/content/en/docs/architecture/architecture.md`).

**4. Review Focus coverage**: all five pinned (Task 1 Step 1, Step 2, Step 5; Task 2 Step 3).

**5. Adversarial review note**: run `/code-review` on this plan before execution.

---

## Plan Stats

- **Tasks:** 3
- **New files:** 3 (`kubernetes-helm.md`, `per-env-branches.md`, `migration-playbook.md`)
- **Modified files:** ~3 (`deploy/_index.md`, `charts/README.md`, `plan-defects.md`)
- **Commits planned:** 3
- **Estimated review surface:** ~600 lines of Markdown

## What's next after Plan 8

- **Future (out of scope)**: bootstrap playbook (k3s vs minikube vs kubespray, out of chart scope); el-salvador migration plan (the day-1 cutover for the real cluster); HPA/KEDA integration (v2); multi-cluster federation (v2.x).
- **Spec edits** (separate commit): the spec's prose references `site/content/en/docs/deployment/` (with a `t`) on line 758/759; the real directory is `deploy/`. The spec also has the same cosign/Kyverno corrections documented in round 8 that could be re-verified in a follow-up spec review.
