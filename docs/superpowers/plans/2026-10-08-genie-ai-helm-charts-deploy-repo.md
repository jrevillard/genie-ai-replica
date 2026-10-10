# GENIE.AI Helm Charts — Deploy Repo (Plan 9) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a dedicated `genie-ai-deploy` GitLab repository (sibling of `genie-ai`) that contains pure deployment configuration for the GENIE.AI Helm chart — no application code. Drives per-pays / per-env reconciliation via **Flux** running inside each target cluster, bootstrapped and approved through **GitLab Ultimate** (Protected Environments + Deployment Approvals). Validation target for this plan: a local **minikube** cluster on the developer's laptop.

**Why a separate repo:**
- The chart source belongs with the application code (versioned, tested, released as one unit). The deploy config belongs in its own repo (per-cluster values, per-pays overrides, secrets, CI pipelines, audit trail of who-promoted-what-where). Mixing them couples developer commits to operator changes and breaks the audit log separation that GitLab's protected environments + deployment approvals depend on.
- ArgoCD official best-practices doc recommends a separate Git repository for Kubernetes manifests, citing clean separation, cleaner audit logs, and separated access controls (developers vs. operators).
- The current Plan 6 (`per-env-ingress.md`) only covers the chart-side: it renders `HTTPRoute` / `Gateway` / cert-manager-issuer references / db-migrations Job / verified-peer `NetworkPolicy` pass inside `charts/genieai-umbrella/`. The OUT-of-chart deploy config (which values, which env, which cluster) is what this plan adds — in a new sibling repo.

**Architecture:** `genie-ai-deploy` is a self-contained GitLab project with:
- `.gitlab/agents/<cluster>/config.yaml` — GitLab Agent for Kubernetes config; module `gitops` enabled so Flux reconciles paths from the repo into the target cluster
- `clusters/<cluster>/` — Flux `Kustomization` per cluster (one per registered cluster: `minikube`, `el-salvador`, future sovereign countries)
- `overlays/<pays>/<env>/` — per-pays / per-env `HelmRelease` + values (`values.yaml` public, `secrets.sops.yaml` SOPS-encrypted)
- `sops/` — per-cluster age keypairs (NEVER committed; only the public half lives in repo for re-encryption by CI)
- `.gitlab-ci.yml` — pipeline: validate → dry-run → Protected Environment gate → tag
- `scripts/` — bootstrap helpers: `flux-bootstrap.sh`, `sops-genkey.sh`, `agent-register.sh`

**Tech Stack:** Helm 4.x, Flux 2.4+ (via GitLab Agent for Kubernetes 1:1+), SOPS with age encryption, kubeconform, conftest, GitLab Ultimate (Protected Environments + Deployment Approvals), minikube for local validation.

**Spec:** `docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md` — implements §19 (per-env Kustomize + GitOps) + §19.3.2 (Flux layout example) + §6.2 (SealedSecret backend) + §18 (audit + signed manifests). Plan 6 covers the chart-side ingress; this plan covers the deploy-repo side.

## Global Constraints

- Two repos, no cross-pollution. `genie-ai` is app + chart; `genie-ai-deploy` is deploy config only. No file in `genie-ai-deploy/` references application source code paths; no file in `genie-ai/` references deploy values, cluster config, or secrets.
- Everything lives on `opensource.unicc.org` (GitLab self-hosted). GitLab Agent for Kubernetes reaches the deploy repo over the GitLab API (HTTPS, project token, not SSH).
- Protected Environments are GitLab Premium/Ultimate-only; the user has Ultimate. The plan assumes Ultimate — if the license changes, every `environment:` job loses its gate (documented in Task 6).
- Multi-cluster: one GitLab Agent per cluster. Each Agent's `config.yaml` scopes the reconciled paths to that cluster's subtree only (`overlays/<pays>/`).
- Multi-env per cluster: dev + staging + prod. The user has already dropped `staging` for the chart (per `Wave 10 #12` amendment), but for the deploy repo we keep all three envs available because the chart supports `clusterProfile: dev|staging|prod`. The dev subtree is the only one bootstrapped on the minikube validation target.
- All English documentation and comments per project CLAUDE.md. Conventional Commits.
- No secrets in any committed file — every secret goes through SOPS age encryption. The public half of each cluster's age key lives in the repo for re-encryption; the private half is generated per-cluster by the bootstrap script and only lives on the cluster (in a `sops-age` K8s `Secret` consumed by the Flux `kustomize-controller`).
- The `genie-ai` chart in the deploy repo is referenced as a **GitRepository** (path `charts/genieai-umbrella/`, ref pinned per env) — not OCI, not vendored. Pinned SHA is updated by CI when a new chart version is published.
- Worktree: this plan is implemented in a NEW worktree next to `k8s-migration`: `.claude/worktrees/deploy-repo/` on a fresh branch `feat/deploy-repo` against the new GitLab project `un/itu/genie-ai-deploy`.

## Review Focus

Five input-class concerns the spec implies but no Plan 9 task tests explicitly. Each pinned to a specific step.

1. **Per-pays / per-env matrix must handle missing envs without creating empty directories** — the user explicitly rejected `overlays/<env>/<pays>/` because not every country has every env. **Pinned in Task 5 Step 2** — the layout is `overlays/<pays>/<env>/` and the `HelmRelease` list per cluster only references the envs that exist; `flux build` on a subtree with missing dirs is a no-op (no error).
2. **GitLab Agent `config.yaml` path scoping is the only cluster-isolation boundary** — if a path glob slips, one cluster's Agent reconciles another cluster's overlays. **Pinned in Task 3 Step 2** — every Agent's `paths:` field MUST be scoped to its own `overlays/<pays>/**` subtree; no wildcards above `<pays>/`. CI step in Task 6 Step 1 cross-validates the glob against the Agent name.
3. **SOPS age private key MUST NOT appear in the repo** — only the public half. The private half lives in a K8s `Secret` in the `flux-system` namespace of the target cluster, mounted by the `kustomize-controller`. **Pinned in Task 2 Step 3** — `sops-genkey.sh` outputs the public half to `sops/<cluster>.age.pub` (committed) and the private half to stdout (operator must `kubectl create secret` it manually); the script fails if it detects a private-key file in the repo via `git check-ignore` + `ls sops/*.age` (no extension = private).
4. **Protected Environment gate applies to the CI `environment:` keyword only, NOT to the Flux sync** — Flux is pull-based and reconciles asynchronously after the merge. The gate therefore protects the commit that updates values/tags Helm; it does NOT pause the cluster. **Pinned in Task 6 Step 3** — every `deploy:<env>` job MUST have `environment: <pays>/<env>`; the deployment job is `when: manual` so an approval is required even if the env-protection rule is misconfigured.
5. **Chart reference (GitRepository) must pin a SHA, not a branch** — a branch pin allows a force-push to silently change the deployed chart. **Pinned in Task 5 Step 4** — `spec.ref.reference` is the 40-char commit SHA of the `genie-ai` repo at the chart version being deployed. CI updates the SHA on a new chart release (separate plan/Plan 7 CI for chart publishing).

---

## Task 1: Create `genie-ai-deploy` GitLab project + bootstrap

**Files:**
- All on the GitLab side (project create, protected branches, default branch protection)
- Local: `.claude/worktrees/deploy-repo/` worktree
- Repo `README.md` (operator-facing; explains the deploy repo, the per-pays layout, the bootstrap procedure, the SOPS workflow)

**Interfaces:**
- Consumes: the URL of the existing `un/itu/genie-ai` repo (read-only for the chart GitRepository)
- Produces: a new GitLab project `un/itu/genie-ai-deploy` with default branch `main`, branch protection on `main` (no force-push), the developer's account as Maintainer

- [ ] **Step 1: Create the GitLab project (UI or API)**

Use `glab api projects` with `visibility=internal`, `namespace_id` for `un`, `name=genie-ai-deploy`, `default_branch=main`. Skip the optional `description` (the README will carry the operator doc).

- [ ] **Step 2: Enable the GitLab Agent for Kubernetes server-side**

Project Settings → Kubernetes Cluster → connect `minikube` Agent. Note the Agent's `kas_address` URL. Save to local file (NOT committed) `.local/agent-kas.txt` for later tasks.

- [ ] **Step 3: Create the local worktree**

```bash
cd ~/git_projects/ITU
git clone ssh://git@opensource.unicc.org:2222/un/itu/genie-ai-deploy.git .claude/worktrees/deploy-repo
cd .claude/worktrees/deploy-repo
git checkout -b feat/deploy-repo
```

(Use the same `k8s-migration` parent — worktrees are siblings under `.claude/worktrees/`.)

- [ ] **Step 4: Author the operator README**

`README.md`:
- One-paragraph summary: what this repo is, who owns it (DevOps), why it is separate from `genie-ai`
- Layout tree (the final shape from Task 5)
- Bootstrap procedure (Task 2 + Task 3 + Task 4)
- Per-pays / per-env promotion procedure
- SOPS workflow (how to encrypt + commit a new secret)
- Link to `docs/charts/plan-defects.md` (operator-side runbook)

- [ ] **Step 5: Commit + push + open MR**

```bash
git add README.md
git commit -m "feat(deploy-repo): bootstrap operator-facing README"
git push -u origin feat/deploy-repo
glab mr create --source-branch feat/deploy-repo --target-branch main --title "feat(deploy-repo): bootstrap genie-ai-deploy repo" --description "First commit: README explaining layout, bootstrap, and SOPS workflow."
```

- [ ] **Step 6: Verify**

The project exists on `opensource.unicc.org/un/itu/genie-ai-deploy`; the MR is open; the README renders.

---

## Task 2: SOPS age setup (per-cluster keypair + `.sops.yaml`)

**Files:**
- `sops/.gitignore` — ignore `*.age` (private half), commit `*.age.pub` (public half)
- `sops/minikube.age.pub` (committed) + operator-side `minikube.age` (NOT committed)
- `sops/el-salvador.age.pub` (committed when El Salvador is added) + operator-side `el-salvador.age` (NOT committed)
- `.sops.yaml` — per-cluster public-key list and per-path creation rules
- `scripts/sops-genkey.sh` — generates a per-cluster age keypair; prints the private key to stdout (operator must capture it for the `kubectl create secret` step)
- `scripts/sops-install-cluster-secret.sh` — operator runs this with the private key on stdin; creates the `sops-age` Secret in the `flux-system` namespace of the target cluster

**Interfaces:**
- Consumes: a fresh age keypair for each cluster
- Produces: SOPS config that encrypts files under `overlays/<pays>/<env>/secrets.sops.yaml` using the `<pays>` cluster's public key; private key on the cluster

- [ ] **Step 1: Install SOPS locally**

```bash
brew install sops   # or apt install sops
# age: https://github.com/FilOzone/homebrew-age / apt install age
age --version
sops --version
```

- [ ] **Step 2: Write the gitignore + the key-generation script**

`sops/.gitignore`:
```
*.age
!*.age.pub
```

`scripts/sops-genkey.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cluster="${1:?usage: sops-genkey.sh <cluster-name>}"
mkdir -p sops
if [ -f "sops/${cluster}.age" ] || [ -f "sops/${cluster}.age.pub" ]; then
  echo "key already exists for ${cluster}; refusing to overwrite" >&2
  exit 1
fi
age-keygen -o "sops/${cluster}.age" 2>/dev/null
# move the .pub sibling that age-keygen produces
mv "sops/${cluster}.age.pub" "_tmp.pub" 2>/dev/null || true
# age-keygen writes both halves to the same file; split with `age-keygen -y` (prints pub)
# Actually: `age-keygen -o key.age` writes ONLY the private key; pub is printed to stderr.
# So we capture stderr.
age-keygen -o "sops/${cluster}.age" 2> "sops/${cluster}.age.pub"
# Verify
grep -q "public key:" "sops/${cluster}.age.pub" || { echo "keygen failed"; exit 1; }
echo "Wrote sops/${cluster}.age (PRIVATE — do not commit) and sops/${cluster}.age.pub (commit this)."
echo "Operator must:"
echo "  1. Capture the private key from sops/${cluster}.age"
echo "  2. Create the K8s Secret: kubectl -n flux-system create secret generic sops-age --from-file=age.age=<(cat sops/${cluster}.age)"
```

(The actual mechanism: `age-keygen -o file.age` writes only the private key to the file and prints the public key to stderr. Capture stderr to the .pub file. Adjust per platform.)

- [ ] **Step 3: Write the install-cluster-secret script**

`scripts/sops-install-cluster-secret.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cluster="${1:?usage: sops-install-cluster-secret.sh <cluster-name>}"
# Reads the private key from stdin (operator pastes it, or pipes from a password manager).
# Creates the K8s Secret that the Flux kustomize-controller will mount.
kubectl -n flux-system create secret generic sops-age \
  --from-file=age.age=/dev/stdin \
  --dry-run=client -o yaml | kubectl apply -f -
```

- [ ] **Step 4: Author `.sops.yaml`**

```yaml
# Encrypts files under overlays/<pays>/<env>/secrets.sops.yaml with the
# <pays> cluster's age public key. Operators add new clusters here as
# they're onboarded.
creation_rules:
  - path_regex: overlays/el-salvador/.*/secrets\.sops\.yaml$
    age: >-
      age1ql3z9hj0u7qf8ag3qy2vz9k4x4c5t8s5k5j8w6z9f9g3h8e2v3k1l2m4n5p6q7
  - path_regex: overlays/sovereign/.*/secrets\.sops\.yaml$
    age: >-
      age1ql3z9hj0u7qf8ag3qy2vz9k4x4c5t8s5k5j8w6z9f9g3h8e2v3k1l2m4n5p6q7r8s9
  # Add more rules as new countries come online
```

(The actual `age1...` strings will be generated by `age-keygen` and pasted from the stderr output; the values above are placeholders. Operator replaces them after running `sops-genkey.sh el-salvador` + `sops-genkey.sh sovereign`.)

- [ ] **Step 5: Generate keys for `minikube` and `el-salvador`**

```bash
./scripts/sops-genkey.sh minikube
./scripts/sops-genkey.sh el-salvador
# Capture private keys to a password manager; never commit them.
ls sops/  # should show: minikube.age  minikube.age.pub  el-salvador.age  el-salvador.age.pub
```

- [ ] **Step 6: Sanity check**

```bash
# Private key should be ignored
git check-ignore -v sops/minikube.age sops/el-salvador.age
# Public key should NOT be ignored
git check-ignore -v sops/minikube.age.pub sops/el-salvador.age.pub
git status -s sops/  # only *.age.pub files should appear
```

- [ ] **Step 7: Commit + MR**

```bash
git add scripts/sops-genkey.sh scripts/sops-install-cluster-secret.sh sops/.gitignore sops/*.age.pub .sops.yaml
git commit -m "feat(deploy-repo): SOPS age keypair per cluster + .sops.yaml rules"
```

- [ ] **Step 8: Verify**

- `git ls-files sops/` shows only the `.age.pub` files (NOT the `.age` private keys)
- `sops --decrypt --age $(cat sops/minikube.age.pub)` on a test file produces the plaintext (round-trip works)

---

## Task 3: GitLab Agent for Kubernetes config

**Files:**
- `.gitlab/agents/minikube/config.yaml` — Agent config for the minikube validation cluster
- `scripts/agent-register.sh` — register the Agent on a new cluster (for future clusters)

**Interfaces:**
- Consumes: the cluster's `kas_address` URL (from Task 1 Step 2) and a project-bound Agent token (the user creates the token in GitLab UI; the script captures it from stdin)
- Produces: Agent running in the cluster with `gitops` module enabled and `paths` scoped to `overlays/minikube/**`

- [ ] **Step 1: Author the Agent config**

`.gitlab/agents/minikube/config.yaml`:
```yaml
# GitLab Agent for Kubernetes — installed in the `minikube` cluster.
# Reconciles `overlays/minikube/**` into the cluster via the bundled Flux engine.
gitops:
  manifest_projects:
    - id: "un/itu/genie-ai-deploy"
      default_namespace: "flux-system"
      paths:
        - glob: "overlays/minikube/**/*.{yaml,yml}"
      reconcile_timeout: 360s
      prune: true
      retry_interval: 2m
```

Notes:
- `prune: true` — Flux deletes cluster resources that no longer have a manifest in Git (the recommended default for a deploy repo). Operators must be aware that a `git rm` on an overlay deletes the corresponding K8s resources.
- The `paths.glob` MUST be scoped to a single `<pays>/` subtree. Cross-pays paths are a hard misconfiguration (a single Agent must NEVER see overlays of another country).
- `default_namespace: flux-system` — the GitLab Agent installs Flux in the `flux-system` namespace by convention.

- [ ] **Step 2: Author the agent-register script**

`scripts/agent-register.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cluster="${1:?usage: agent-register.sh <cluster-name>}"
# Reads a project-bound Agent token from stdin (operator pastes it).
# Creates the k8s manifest, applies it to the target cluster, and verifies
# the Agent connected to GitLab.
token=""
while [ -z "$token" ]; do
  echo -n "Agent token (glagent-...): "
  read -rs token
  echo
done
kubectl apply -f - <<EOF
apiVersion: apps/v1
kind: Deployment
metadata:
  name: gitlab-agent
  namespace: gitlab-agent
  labels: { app: gitlab-agent }
spec: { replicas: 1, selector: { matchLabels: { app: gitlab-agent } },
  template: { metadata: { labels: { app: gitlab-agent } },
  spec: { serviceAccountName: gitlab-agent,
    containers: [{ name: agent, image: "registry.gitlab.com/gitlab-org/cluster-integration/gitlab-agent/agentk:v17.5.0-rc1",
      args: ["--token-file=/config/token"],
      volumeMounts: [{ name: token, mountPath: /config, readOnly: true }],
      volumes: [{ name: token, secret: { secretName: gitlab-agent-token } }] }] } } }
---
apiVersion: v1
kind: Secret
metadata: { name: gitlab-agent-token, namespace: gitlab-agent }
type: Opaque
stringData: { token: "${token}" }
---
apiVersion: v1
kind: ServiceAccount
metadata: { name: gitlab-agent, namespace: gitlab-agent }
EOF
echo "Agent installed. Verifying connection to GitLab..."
kubectl -n gitlab-agent wait --for=condition=available deploy/gitlab-agent --timeout=60s
```

- [ ] **Step 3: Create the namespace in minikube + install the Agent**

```bash
# Pre-req: minikube running with ingress + metrics-server (per Plan 1)
minikube status
# Create the namespace; install Flux + the Agent
kubectl create namespace gitlab-agent
# Generate the per-cluster SOPS key (Task 2) and install the Secret in flux-system
./scripts/sops-genkey.sh minikube  # already done in Task 2 Step 5
./scripts/sops-install-cluster-secret.sh minikube  # operator runs with private key
# Register the Agent
./scripts/agent-register.sh minikube  # operator pastes the token
```

- [ ] **Step 4: Commit + push**

```bash
git add .gitlab/agents/minikube/config.yaml scripts/agent-register.sh
git commit -m "feat(deploy-repo): GitLab Agent config for minikube + register script"
git push
```

- [ ] **Step 5: Verify**

- `kubectl -n gitlab-agent get deploy` shows the Agent pod `Ready`
- In GitLab Project → Infrastructure → Kubernetes clusters, the `minikube` agent shows `Connected`
- The Agent's `config` log shows it has read `.gitlab/agents/minikube/config.yaml` and registered the `gitops` module

---

## Task 4: Flux bootstrap manifests (Kustomization + GitRepository per cluster)

**Files:**
- `clusters/minikube/flux-system/gitrepository.yaml` — `GitRepository` resource pointing at this repo (chicken-and-egg with Flux itself, but the GitLab Agent installs Flux first)
- `clusters/minikube/flux-system/kustomization.yaml` — Flux `Kustomization` reconciling `clusters/minikube/`
- `scripts/flux-bootstrap.sh` — operator-side script to bootstrap a new cluster

**Interfaces:**
- Consumes: the deploy repo URL, the per-cluster SOPS Secret (in `flux-system`)
- Produces: Flux running in the cluster, watching the `clusters/<pays>/` subtree

- [ ] **Step 1: Author the `GitRepository` manifest**

`clusters/minikube/flux-system/gitrepository.yaml`:
```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: genie-ai-deploy
  namespace: flux-system
spec:
  interval: 1m0s
  url: https://opensource.unicc.org/un/itu/genie-ai-deploy.git
  ref:
    branch: main
  # For PRIVATE repos, the agent uses its own token; for INTERNAL repos, the URL alone works.
  secretRef:
    name: flux-system  # auto-created by the GitLab Agent with read access to the project
```

- [ ] **Step 2: Author the root `Kustomization`**

`clusters/minikube/flux-system/kustomization.yaml`:
```yaml
apiVersion: kustomize.toolkit.fluxcd.io/v1
kind: Kustomization
metadata:
  name: clusters-minikube
  namespace: flux-system
spec:
  interval: 10m0s
  sourceRef:
    kind: GitRepository
    name: genie-ai-deploy
  path: ./clusters/minikube
  prune: true
  wait: true
  timeout: 5m0s
  # The kustomize-controller decrypts SOPS files at apply time using
  # the per-cluster age key in the sops-age Secret in flux-system.
  decryption:
    provider: sops
    secretRef:
      name: sops-age
  # Reconcile ONLY the cluster subtree — never other clusters.
```

- [ ] **Step 3: Author the bootstrap script**

`scripts/flux-bootstrap.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
cluster="${1:?usage: flux-bootstrap.sh <cluster-name>}"
# This script is run by the GitLab Agent on first connect; for local
# minikube validation, the operator triggers it manually via:
#   kubectl -n flux-system apply -f clusters/${cluster}/flux-system/
# All it does is verify the manifests exist + dry-run them.
test -d "clusters/${cluster}/flux-system" || { echo "missing clusters/${cluster}/flux-system"; exit 1; }
kubectl --context "${cluster}" apply --dry-run=server -f "clusters/${cluster}/flux-system/" -o yaml | head -20
```

- [ ] **Step 4: Apply the manifests in the cluster**

The GitLab Agent's `gitops` module is supposed to install Flux + apply these manifests automatically once the config is committed. For the local minikube validation target, the operator triggers it manually:

```bash
kubectl config use-context minikube
kubectl -n flux-system apply -f clusters/minikube/flux-system/
flux get kustomizations -A
flux get sources git -A
```

- [ ] **Step 5: Verify**

- `flux get kustomizations -A` shows `clusters-minikube` `Ready=True`
- `flux get sources git -A` shows `genie-ai-deploy` `Ready=True`
- No errors in `flux logs --tail=20`

- [ ] **Step 6: Commit**

```bash
git add clusters/ scripts/flux-bootstrap.sh
git commit -m "feat(deploy-repo): Flux GitRepository + root Kustomization for minikube"
```

---

## Task 5: HelmRelease per overlay (chart from `genie-ai` repo + per-pays values)

**Files:**
- `overlays/minikube/dev/namespace.yaml` — `Namespace` per env (matches `Release.Namespace` in the chart)
- `overlays/minikube/dev/gitrepository-chart.yaml` — `GitRepository` for the `genie-ai` chart, pinned to a SHA
- `overlays/minikube/dev/helmrelease.yaml` — `HelmRelease` reconciling the chart with values
- `overlays/minikube/dev/values.yaml` — public values (clusterProfile=dev, ingress hostnames, etc.)
- `overlays/minikube/dev/secrets.sops.yaml` — private values (encrypted; e.g., `data.keycloak.clientSecrets.proxyClient`)

(The `staging` and `prod` overlays for `minikube` follow the same structure; they're created when needed. `el-salvador/...` overlays are created when the cluster is added in a later task.)

**Interfaces:**
- Consumes: the chart `GitRepository` (from a chart-publishing CI in Plan 7 — for the bootstrap, pin the SHA manually), the per-pays SOPS-encrypted Secret (from Task 2)
- Produces: a Flux `HelmRelease` that applies the chart with the per-env values

- [ ] **Step 1: Create the namespace manifest**

`overlays/minikube/dev/namespace.yaml`:
```yaml
apiVersion: v1
kind: Namespace
metadata:
  name: genieai
  labels:
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: v1.33
```

- [ ] **Step 2: Create the chart `GitRepository`**

`overlays/minikube/dev/gitrepository-chart.yaml`:
```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: genie-ai
  namespace: flux-system
spec:
  interval: 1m0s
  url: https://opensource.unicc.org/un/itu/genie-ai.git
  ref:
    # Pinned to the chart's current commit SHA. CI updates this on
    # each chart release (Plan 7). Manual update for the bootstrap.
    # Run: git ls-remote https://opensource.unicc.org/un/itu/genie-ai.git refs/heads/feat/k8s-migration
    commit: "81821ea1193aded5a55b2576cb20085c9d2f720b"
  secretRef:
    name: flux-system
```

- [ ] **Step 3: Create the `HelmRelease`**

`overlays/minikube/dev/helmrelease.yaml`:
```yaml
apiVersion: helm.toolkit.fluxcd.io/v2
kind: HelmRelease
metadata:
  name: genieai
  namespace: flux-system
spec:
  interval: 10m0s
  chart:
    spec:
      chart: genieai-umbrella
      version: "0.1.0"          # matches Chart.yaml in the chart repo
      sourceRef:
        kind: GitRepository
        name: genie-ai
        namespace: flux-system
  releaseName: genieai
  targetNamespace: genieai
  install:
    remediation:
      retries: 3
  upgrade:
    cleanupOnFail: true
    remediation:
      retries: 3
  valuesFrom:
    - name: genieai-dev-public
      kind: ConfigMap    # OR Secret for SOPS-encrypted values
  values:
    # Inline overrides that don't contain secrets
    clusterProfile: dev
    namespace: genieai
```

- [ ] **Step 4: Create the public values ConfigMap**

`overlays/minikube/dev/values.yaml`:
```yaml
apiVersion: v1
kind: ConfigMap
metadata:
  name: genieai-dev-public
  namespace: flux-system
data:
  values.yaml: |
    clusterProfile: dev
    namespace: genieai
    # ... other public values (no secrets) ...
```

- [ ] **Step 5: Create the SOPS-encrypted secrets**

```bash
# Operator creates a file with the private values, then encrypts it.
cat > /tmp/secrets.yaml <<EOF
data:
  keycloak:
    clientSecrets:
      proxyClient: "real-value-from-password-manager"
      dataprep:   "real-value-from-password-manager"
      grafana:    "real-value-from-password-manager"
      smtp:
        host: smtp.example.com
        port: 587
        user: genie-admin@example.com
EOF
sops --encrypt --age "$(cat sops/minikube.age.pub)" --in-place /tmp/secrets.yaml
# Move the encrypted file into the repo
mv /tmp/secrets.yaml overlays/minikube/dev/secrets.sops.yaml
```

- [ ] **Step 6: Author the Secret manifest**

`overlays/minikube/dev/secrets-secret.yaml`:
```yaml
apiVersion: v1
kind: Secret
metadata:
  name: genieai-dev-secrets
  namespace: flux-system
  # The encrypted data is inline; the kustomize-controller decrypts it
  # at apply time using the sops-age Secret in the same namespace.
  # NOTE: this file IS the SOPS-encrypted payload — the YAML structure
  # is the SOPS envelope. Edit via: sops overlays/minikube/dev/secrets.sops.yaml
  annotations:
    fluxcd.io/sops: "true"  # marker so the controller decrypts this Secret
stringData:
  # SOPS envelope — the values.yaml inside is the decrypted content
  sops: |
    <SOPS-encrypted YAML, generated by sops --encrypt>
```

(Concretely, the operator runs `sops --encrypt --in-place overlays/minikube/dev/secrets.sops.yaml`; the resulting file IS the SOPS-encrypted YAML, and the HelmRelease references it as a value source via `valuesFrom:` pointing at the decrypted Secret.)

- [ ] **Step 7: Verify reconciliation**

```bash
flux get kustomizations -A
flux get helmreleases -A
kubectl -n flux-system get gitrepository,kustomization,helmrelease
# The dev HelmRelease should be Ready=True within a few minutes
flux get helmreleases -A --watch
```

- [ ] **Step 8: Commit + MR**

```bash
git add overlays/minikube/dev/
git commit -m "feat(deploy-repo): minikube/dev overlay (namespace + chart repo + HelmRelease + public values + SOPS-encrypted secrets)"
```

- [ ] **Step 9: Verify**

- `helm list -n genieai` shows the chart installed with the dev values
- `kubectl -n genieai get pods` shows the expected Deployments (per Plan 3 service tier)
- No secrets in plain text in the repo (`grep -r "real-value-from" overlays/` returns nothing)

---

## Task 6: CI pipeline + Protected Environment approval gate

**Files:**
- `.gitlab-ci.yml` — pipeline definition with `validate` → `dry-run` → `deploy:<env>` (manual approve) stages
- `docs/deploy/CONTRIBUTING.md` — operator workflow: how to add a new env, how to update a chart SHA, how to onboard a new pays

**Interfaces:**
- Consumes: a Protected Environment named per `<pays>/<env>` (e.g., `minikube/dev`)
- Produces: a CI pipeline that runs validate + dry-run on every MR, and gates the merge to a protected branch with a manual `deploy:<env>` job

- [ ] **Step 1: Author the CI pipeline**

`.gitlab-ci.yml`:
```yaml
stages:
  - validate
  - dry-run
  - deploy

variables:
  KUBECTL_VERSION: "1.33.0"
  SOPS_VERSION: "3.10.2"
  FLUX_VERSION: "2.4.0"

# Path-scoped validation: only run when overlays/, clusters/, or scripts/ change.
.validate-base:
  rules:
    - changes:
        - overlays/**/*
        - clusters/**/*
        - scripts/**/*
        - .gitlab-ci.yml
        - .sops.yaml
        - sops/**/*

validate:lint:
  extends: .validate-base
  stage: validate
  image: alpine:3.20
  before_script:
    - apk add --no-cache bash git
  script:
    - echo "Lint all Kustomizations, HelmReleases, and SOPS files"
    - ./scripts/ci-lint.sh
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_PIPELINE_SOURCE == "push"

validate:secrets:
  extends: .validate-base
  stage: validate
  image: getsops/sops:v${SOPS_VERSION}
  script:
    - echo "Verify every secrets.sops.yaml file decrypts (CI has the public key only; this is a sanity check that the file isn't corrupted)"
    - find overlays/ -name 'secrets.sops.yaml' -exec sops --decrypt --age "$(cat sops/minikube.age.pub)" {} \; > /dev/null

dry-run:minikube/dev:
  extends: .validate-base
  stage: dry-run
  image: ghcr.io/fluxcd/flux-cli:v${FLUX_VERSION}
  script:
    - flux build kustomization clusters/minikube | kubeconform -strict -summary -kubernetes-version 1.33.0
    - echo "Diff vs the cluster:"
    - flux diff kustomization clusters-minikube --path clusters/minikube
  rules:
    - changes:
        - clusters/minikube/**
        - overlays/minikube/dev/**

# Template-style job: one per (<pays>, <env>) pair, all manual.
.deploy-base:
  extends: .validate-base
  stage: deploy
  image: bitnami/kubectl:${KUBECTL_VERSION}
  script:
    - echo "Production gate: this job is a no-op — the Flux GitOps engine reconciles asynchronously after the merge."
    - echo "The job exists ONLY to trigger the Protected Environment approval workflow."
  rules:
    - if: $CI_PIPELINE_SOURCE == "merge_request_event"
    - if: $CI_PIPELINE_SOURCE == "push"
  when: manual

deploy:minikube-dev:
  extends: .deploy-base
  environment:
    name: minikube/dev
    on_stop: teardown:minikube-dev

teardown:minikube-dev:
  extends: .deploy-base
  environment:
    name: minikube/dev
    action: stop
  when: manual
  allow_failure: true
```

- [ ] **Step 2: Author the CI lint script**

`scripts/ci-lint.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
# 1. Every overlay/<pays>/<env>/ contains a helmrelease.yaml
find overlays -mindepth 2 -maxdepth 2 -type d | while read -r envdir; do
  test -f "${envdir}/helmrelease.yaml" || { echo "missing: ${envdir}/helmrelease.yaml"; exit 1; }
done
# 2. Every GitRepository points to opensource.unicc.org (no external URLs)
find overlays clusters -name 'gitrepository*.yaml' -exec grep -l 'url:' {} \; | while read -r f; do
  url=$(grep 'url:' "$f" | head -1 | awk '{print $2}')
  case "$url" in
    https://opensource.unicc.org/*) ;;
    *) echo "forbidden external URL in $f: $url"; exit 1 ;;
  esac
done
# 3. Every .gitlab/agents/<cluster>/config.yaml has gitops.manifest_projects with paths scoped to overlays/<cluster>/**
for cfg in .gitlab/agents/*/config.yaml; do
  cluster=$(basename "$(dirname "$cfg")")
  grep -A 5 "manifest_projects:" "$cfg" | grep -q "overlays/${cluster}/" || {
    echo "Agent ${cluster} does not scope paths to overlays/${cluster}/**"
    exit 1
  }
done
echo "lint OK"
```

- [ ] **Step 3: Author the operator CONTRIBUTING doc**

`docs/deploy/CONTRIBUTING.md` (operator workflow):
- Adding a new env to an existing pays: `cp -r overlays/el-salvador/dev overlays/el-salvador/staging`, edit the new overlay, MR, protected-environment approval
- Updating a chart SHA: edit the `commit:` field in `overlays/<pays>/<env>/gitrepository-chart.yaml`, MR, approve
- Onboarding a new pays: add a `.gitlab/agents/<pays>/config.yaml`, generate a SOPS keypair, add the rule to `.sops.yaml`, create the overlays
- Rotating a SOPS key: `sops-genkey.sh <pays>`, re-encrypt every file under `overlays/<pays>/**/secrets.sops.yaml` with the new public key, update the rule in `.sops.yaml`, MR
- Rolling back a HelmRelease: `flux suspend helmrelease genieai -n flux-system`, investigate, `flux resume helmrelease genieai -n flux-system`

- [ ] **Step 4: Create the Protected Environments**

Per the user, GitLab Ultimate is licensed. The pipeline above declares `environment: minikube/dev`; in GitLab UI:
- Project Settings → CI/CD → Protected Environments → `minikube/dev`
- Allowed to deploy: `Maintainer` + a custom `deployers` group (operator-only)
- Required approval count: 1
- Applies to: `deployment` jobs (NOT `merge_request` events)

Repeat for each `<pays>/<env>` pair added over time.

- [ ] **Step 5: Commit + MR**

```bash
git add .gitlab-ci.yml scripts/ci-lint.sh docs/deploy/CONTRIBUTING.md
git commit -m "feat(deploy-repo): CI pipeline + Protected Environment gate + operator runbook"
```

- [ ] **Step 6: Verify on a real MR**

Open a no-op MR (e.g., add a comment to `overlays/minikube/dev/values.yaml`). The `validate:lint` + `validate:secrets` + `dry-run:minikube/dev` jobs run automatically. The `deploy:minikube-dev` job appears as a `play` button — clicking it requires the Protected Environment approval.

---

## Task 7: End-to-end validation on minikube

**Goal:** confirm the full pipeline works: dev MR → approve → merge → minikube reconciles → chart installs → pods Ready.

- [ ] **Step 1: Bootstrap minikube**

```bash
minikube start --driver=docker --cpus=4 --memory=8g
minikube addons enable ingress
minikube addons enable metrics-server
# Install the operator prerequisites (Plan 4 + Plan 5 would do this via the
# deploy repo, but for the local validation we install them once)
# (skip for this plan — Plan 4 ships the operators)
```

- [ ] **Step 2: Run the operator install steps in order**

```bash
./scripts/sops-genkey.sh minikube
./scripts/sops-install-cluster-secret.sh minikube
./scripts/agent-register.sh minikube
# Apply the Flux manifests (the GitLab Agent would do this automatically
# once the config is committed; we do it manually for the local test)
kubectl config use-context minikube
kubectl -n flux-system apply -f clusters/minikube/flux-system/
```

- [ ] **Step 3: Open a no-op MR to trigger the CI pipeline**

```bash
echo "# dev overlay — first deploy" >> overlays/minikube/dev/README.md
git checkout -b chore/minikube-dev-first-deploy
git add overlays/minikube/dev/README.md
git commit -m "chore(deploy-repo): trigger first MR for minikube/dev pipeline"
git push -u origin chore/minikube-dev-first-deploy
glab mr create --source-branch chore/minikube-dev-first-deploy --target-branch main --title "chore: first deploy of minikube/dev overlay" --description "Trigger the CI pipeline for the first time."
```

- [ ] **Step 4: Watch the pipeline + approve**

- The `validate:lint` + `validate:secrets` + `dry-run:minikube/dev` jobs run automatically
- The `deploy:minikube-dev` job appears as `manual`; click `play` → Protected Environment approval is required
- The approval flow: a Maintainer in the `deployers` group reviews the MR + the dry-run output, then approves
- After approval, the deploy job is triggered; it doesn't apply anything (Flux does the apply), it just provides the audit trail

- [ ] **Step 5: Merge the MR**

```bash
glab mr merge --squash
```

- [ ] **Step 6: Watch Flux reconcile**

```bash
flux get kustomizations -A --watch
flux get helmreleases -A --watch
kubectl -n flux-system get pods  # the kustomize-controller + helm-controller pods
```

- [ ] **Step 7: Confirm the chart installed**

```bash
helm list -n genieai
kubectl -n genieai get pods
kubectl -n genieai get svc
# Run the chart's own test pods
helm test genieai -n genieai
```

- [ ] **Step 8: Document the result**

`docs/deploy/RUNBOOK.md` (operator log): timestamp, what was deployed, what version, what worked, what broke, what to do next time.

- [ ] **Step 9: Final commit**

```bash
git add docs/deploy/RUNBOOK.md overlays/minikube/dev/README.md
git commit -m "docs(deploy): end-to-end validation log — minikube/dev first deploy"
```

---

## Self-Review

After writing all 7 tasks, run this checklist against the spec.

**1. Spec coverage (Plan 9 slice):**

| Spec section | Task |
|---|---|
| §19 per-env Kustomize + GitOps | Tasks 3, 4, 5 |
| §19.3.2 Flux layout example | Tasks 4, 5 |
| §6.2 SealedSecret backend (still rendered by the chart; the deploy repo consumes the chart as a single unit) | n/a (covered in Plan 2) |
| §18 audit + signed manifests | Task 6 (audit via `environment:` job + `when: manual`) |

Sections NOT covered by this plan (deferred):
- §9 ingress + cert-manager + Envoy Gateway (Plan 6 — chart-side)
- §4 operator controllers (Plan 4/5)
- §13 uninstall safety (Plan 6)

**2. Placeholder scan:** the SOPS-encrypted secret values are explicit `real-value-from-password-manager` placeholders; operators replace them before merging.

**3. Type consistency:** all Kustomizations, HelmReleases, and GitRepositories use the same `flux-system` namespace and the same `1m0s`/`10m0s` intervals. The `sops-age` Secret is the single decryption source.

**4. Review Focus coverage:** all 5 review-focus items have a pinned verification step (Task 2 Step 6 for SOPS private-key check, Task 3 Step 2 for path scoping, Task 5 Step 4 for chart SHA pin, Task 6 Step 1 + Step 4 for the Protected Environment gate, Task 5 Step 2 for the per-pays directory layout).

**5. Adversarial review note:** recommend running `/code-review` on the `feat/deploy-repo` branch (against `main`) before onboarding `el-salvador` (Task 5's other overlays).

---

## Plan Stats

- **Tasks:** 7
- **Files created:** ~20 (operator scripts, Agent config, Flux manifests, HelmReleases, values, SOPS keys, CI, docs)
- **Files modified:** 0
- **Commits planned:** ~7
- **Estimated review surface:** ~500 lines added

## What's next after Plan 9

- **Plan 6b (real Plan 6 completion)**: the chart-side per-env ingress templates (Gateway, HTTPRoute, cert-manager references) — already in `docs/superpowers/plans/2026-10-08-genie-ai-helm-charts-per-env-ingress.md`, this plan complements it by providing the OUT-of-chart values that the chart's templating expects.
- **Plan 7**: CI for the chart publishing (chart-releaser + OCI registry or GitLab Package Registry for the chart `.tgz`); the deploy repo's `gitrepository-chart.yaml` updates the pinned SHA from this CI's output.
- **Plan 4/5/8**: as planned.
- **Onboarding `el-salvador` + sovereign countries**: copy `overlays/minikube/` → `overlays/<pays>/`, generate a SOPS key, add a `.gitlab/agents/<pays>/config.yaml`, install the GitLab Agent on the new cluster.
