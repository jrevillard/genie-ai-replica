# GENIE.AI Helm Charts — Per-Env + Ingress (Plan 6) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the per-environment configuration layer (`values-override.yaml` per env) for `dev` (the only real env today — local minikube/k3s) and `prod` (a generic, empty-of-real-cluster-details overlay that operators can fork when a real prod cluster lands). Plus: GitOps sync examples (ArgoCD + Flux), Envoy Gateway ingress, db-migrations Job, document-repository PVC, verified-peer NetworkPolicy pass, per-env uninstallPolicy opt-in.

**Removed from scope (rolled back from an earlier draft)**:
- `staging/`: no separate tier in our model.
- `sovereign/`: el-salvador's specific values are NOT shipped here — they will be defined in a dedicated migration plan when that cluster moves to K8s. The chart stays generic.
- `prod/values-override.yaml`: kept as a blank template (no el-salvador IPs, no remote-GPU URLs, no Issuer names); operators fork it for their prod cluster.

**Architecture:** Per-env state lives entirely OUTSIDE the chart. Two layouts, both supported (chart is GitOps-agnostic per spec §19):
1. **ArgoCD** (recommended per user preference): an `Application` CR per env, the chart's umbrella at a per-env branch, with Kustomize overlay + `values-override.yaml` supplying the per-env values.
2. **Flux** (spec §19 default): per-env `Kustomization` reconciling the rendered manifests, with `force: false` for conflict-safety.

The chart gains NO new operators (cert-manager is a cluster bootstrap prerequisite, gated by the optional `ingress.tls.issuer` values key). The chart owns: `templates/gateway/` (Envoy Gateway `Gateway` + per-env `HTTPRoute` resources), `templates/migrate/` (helm pre-upgrade Job for backend db-migrations), `templates/services/document-repository.yaml` (PVC + volumeMount integration — the Plan 3 Task 1b deferred piece), the verified-peer NetworkPolicy pass (replaces port-scoped `ipBlock` egress with real operator-pod-label selectors after first live `kubectl get pods --show-labels`).

**Tech Stack:** Helm 4.x, chart-testing (`ct` v3.x), Kustomize 5.x, ArgoCD (>= 2.10) OR Flux (>= 2.4) — chart renders BOTH example manifests, the user picks one. Envoy Gateway v1.9.0 (Plan 1 dependency already pinned). cert-manager ~> 1.21.0 (bootstrap prerequisite; chart CRs reference it but never install it).

**Spec:** `docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md` — implements §5.1 (per-env overrides), §9 (Envoy Gateway ingress, TLS, CORS), §13.1 (uninstall safety), §17 (per-env manifest entries), §19 (per-env Kustomize + GitOps).

## Global Constraints

- Helm chart API version: `v2`. Helm 4.x.
- The chart NEVER installs Flux, ArgoCD, cert-manager, or the GPU operator — all are cluster bootstrap prerequisites (spec §4 + audit decisions 7/8/Plan 5 round-7). The chart renders only the CRs those operators manage.
- Per-env overrides live in `deploy/environments/<env>/values-override.yaml` (Kustomize configMapGenerator pattern, NOT direct helm value overrides — keeps diff history tight and supports Kustomize post-render transformations like patchesStrategicMerge).
- This plan's `deploy/environments/<env>/` ships with `dev/prod` only. el-salvador lives on a dedicated migration plan; `release/2.0` / `release/2.1` (legacy Swarm-versioned) are not in scope.
- All English documentation and comments per project CLAUDE.md. Commits in English, Conventional Commits.
- Worktree path: `/home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/k8s-migration/`. Branch: `feat/k8s-migration`.
- Every new Deployment maps to a `docs/charts/k8s-native-audit.md` row (Tasks 1, 2, 3 each amend the table).

## Review Focus

Five input-class concerns the spec implies but no Plan 6 task tests explicitly. Each pinned to a specific step.

1. **ArgoCD vs Flux is a user choice, not a chart choice** — the spec ships BOTH (§19.3.1 + §19.3.2) and explicitly states the chart is GitOps-agnostic. **Pinned in Task 4 Step 1** — `deploy/gitops/` ships both `argocd/genieai-<env>.yaml` AND `flux/kustomization-<env>.yaml`; both are real manifests (not pseudocode); the operator picks one by deleting the other.
2. **Namespace-per-env vs shared-namespace** — spec §19 example uses `genieai-dev` (per-env namespace). Plan 1 / Plan 2 / Plan 3 / Plan 5 deploy to `genieai` (shared). The two are NOT compatible in the current chart (the SealedSecret drift hook + dep-check hook all hardcode `.Values.namespace`). **Pinned in Task 1 Step 4** — `values-override.yaml` per env may set `namespace: <env-namespace>` ONLY when the operator commits to per-namespace installs (the e2e-109-198 el-salvador style); the chart stays `genieai` by default. The override risk is documented in `docs/charts/namespace-per-env.md`.
3. **Cert-manager Issuer is a cluster concern** — the chart renders `cert-manager.io/issuer` annotations on HTTPRoute resources but never installs cert-manager; the Issuer name (`genieai-<env>`) is operator-defined. **Pinned in Task 3 Step 3** — the chart uses a values-driven `ingress.tls.issuerName` and falls back to no annotation when empty; conftest (Plan 7) blocks committing a chart override that mentions a `genieai-*-letsencrypt` Issuer by name (operators must declare their own).
4. **db-migrations Job ordering vs backend readiness** — the migrations must complete BEFORE the backend Deployment becomes Ready (otherwise chat ingestion races migrations). **Pinned in Task 1 Step 3** — the Job is a `helm.sh/hook: pre-upgrade,pre-install` + `helm.sh/hook-weight: 0` (AFTER all hooks -30/-20/-10/-5; the Job runs in the namespace, completes, then the regular `Deployment` resources render); the Job uses the regular ServiceAccount (not the dep-check SA).
5. **Verified-peer NetworkPolicy pass is field-driven, not code-driven** — replacing port-scoped `ipBlock` egress with `podSelector` peers requires `kubectl get pods --show-labels` for CNPG, kube-arangodb, keycloak-operator, Envoy Gateway data plane. The labels are operator-tenant-specific. **Pinned in Task 5 Step 2** — the chart ships a `pluggable.networkPolicy.peers` values block (list of `{namespace, podSelector}`); defaults are the port-scoped fallbacks; live labels are operator-side inputs.

---

### Task 1: Per-env `deploy/environments/<env>/` skeleton + chart-side `values.yaml` schema additions

**Files:**
- Create: `deploy/environments/dev/values-override.yaml`
- Create: `deploy/environments/staging/values-override.yaml`
- Create: `deploy/environments/prod/values-override.yaml`
- Create: `deploy/environments/sovereign/values-override.yaml`
- Create: `deploy/environments/README.md`
- Create: `docs/charts/namespace-per-env.md`
- Modify: `charts/genieai-umbrella/values.yaml` (add `pluggable.networkPolicy.peers` block + `ingress.tls.*` + `migrate.*` blocks)
- Modify: `charts/genieai-umbrella/Chart.yaml` (add `cert-manager` dep gated on `ingress.tls.issuer` — but ONLY when `ingress.className: envoy` AND the cert-manager path is selected; otherwise stay absent)

**Interfaces:**
- Consumes: spec §5.1 (values schema), §9 (ingress), §13.1 (uninstall), §19 (per-env overlays).
- Produces: a per-env overlay layout; `values.yaml` grows `ingress`, `migrate`, `pluggable.networkPolicy` blocks; the existing uninstall safety gate (Plan 2 doc) gets the per-env opt-in annotation.

- [ ] **Step 1: Create `deploy/environments/dev/values-override.yaml`**

```yaml
# Per-env overlay for the `dev` environment.
# Applied via: helm template genieai-umbrella -f deploy/environments/dev/values-override.yaml
# (Kustomize wraps this with a configMapGenerator if the env uses Kustomize;
# the chart itself is Kustomize-unaware.)
#
# This file is the SOURCE OF TRUTH for env-specific values. CI renders
# the chart with `-f <this file>` and pushes the rendered manifest to the
# GitOps repo (or the per-env branch) that Flux/ArgoCD watches.

namespace: genieai
clusterProfile: dev

ingress:
  enabled: false   # dev uses kubectl port-forward, no public ingress
  host: genieai-dev.localhost

observability:
  enabled: false
  metrics:
    enabled: false
  logs:
    enabled: false
  traces:
    enabled: false
  otel:
    enabled: false
  grafana:
    enabled: false

# dev uses single-node dev defaults; AI/ML tier is fully on (CI smoke).
data:
  postgres:
    enabled: true
    instances: 1
  arangodb:
    enabled: true
    mode: single
  keycloak:
    enabled: true

ai:
  enabled: true
  gpu:
    vllm:
      count: 1
    vllmTranslation:
      count: 1
    tei:
      count: 1
    teiReranker:
      count: 1
  # dev: GPU node is the kind cluster's GPU label (none on kind — schedule fails)
  # CI may set nodeSelector: null to render anyway and accept Pending.
  nodeSelector:
    genieai.io/gpu: "true"
  tolerations:
    - key: genieai.io/gpu
      operator: Equal
      value: "true"
      effect: NoSchedule
  # dev: keep HF cache small + a hostPath for kind
  hfCache:
    storageSize: 5Gi

services:
  clamav: { enabled: false }   # virus scanning off in dev (faster CI)
```

- [ ] **Step 2: Create `deploy/environments/prod/values-override.yaml`** — a GENERIC template, NOT a real cluster's values. Operators fork it for their prod cluster (the el-salvador cluster will get its own values in a dedicated migration plan, NOT here). The template sets:
  - `clusterProfile: prod`
  - `observability.enabled: true` (and per-component mirrors)
  - `ingress.enabled: true` (operators MUST set `ingress.host` and `ingress.tls.issuerName` per their cluster)
  - `services.clamav: {enabled: true}` (default; disable in CI/smoke)
  - `migrate.enabled: true` (pre-install Job for backend db-migrations — required in prod)
  - `uninstallPolicy.enabled: true` (the gate requires the namespace annotation to uninstall — a safety net for prod)
  - `secrets.sealedSecrets.enabled: true` (always)
  - Every operator-specific value (cluster IPs, GPU URLs, Issuer name, Ingress host, real SealedSecret values) is INTENTIONALLY left for operators to fill in. The chart defaults + the per-env overlay = the contract; the operator's per-cluster fork = the reality.

- [ ] **Step 3: Create `deploy/environments/README.md`**

```markdown
# Per-environment overlays

The chart targets two K8s runtimes for `dev` (the only env that runs
today) and the same chart runs on both unchanged. The `prod` overlay
is a generic template (NOT el-salvador's values — those land in a
dedicated migration plan).

## dev — local K8s on a workstation

Two equivalent setups:

### Option A: minikube (best for laptop dev / CI)

```bash
# 1. start minikube (no GPU on minikube — disable AI/ML on dev; see overlay)
minikube start --cpus=4 --memory=8g --driver=docker --addons=ingress

# 2. install the chart with the dev overlay
helm install test charts/genieai-umbrella \
  --namespace genieai --create-namespace \
  -f deploy/environments/dev/values-override.yaml

# 3. expose the backend via port-forward
kubectl port-forward -n genieai svc/backend 3000:80
# backend available at http://localhost:3000
```

`minikube` = Docker/VirtualBox/hyperkit, single-node, ephemeral
storage, no GPU. Good for chart-render checks + smoke tests. CI uses
this exact flow.

### Option B: k3s (best for on-prem dev / future prod)

```bash
# 1. install k3s as a systemd service (single-node dev)
curl -sfL https://get.k3s.io | sh -s - --disable traefik --write-kubeconfig-mode 644
# (--disable traefik leaves the ingress to our Envoy Gateway)

# 2. install the chart with the dev overlay
kubectl apply -f https://github.com/cert-manager/cert-manager/releases/download/v1.15.0/cert-manager.yaml
helm install test charts/genieai-umbrella \
  --namespace genieai --create-namespace \
  -f deploy/environments/dev/values-override.yaml

# 3. expose the backend via port-forward
sudo kubectl port-forward -n genieai svc/backend 3000:80 --address 0.0.0.0
# backend available at http://<host-ip>:3000
```

`k3s` = single binary, persistent storage, GPU-ready (NVIDIA device
plugin just works), air-gap friendly. Same chart, same command. Use
this when you want persistent state (PVC), or when you want to test
the GPU path locally on a workstation with a real GPU.

## prod — generic template (no real cluster)

`deploy/environments/prod/values-override.yaml` is a TEMPLATE only.
Operators fork it for their prod cluster; the el-salvador migration
plan will produce its own values-override when that cluster moves
to K8s. The template's defaults are:

- `clusterProfile: prod` — triggers 3-instance CNPG, VMCluster, etc.
  (HA defaults; the operator may override per their cluster's actual
  resources)
- `ingress.enabled: true` — operators MUST set `ingress.host` and
  `ingress.tls.issuerName` per their cluster's cert-manager Issuer
- `migrate.enabled: true` — pre-install Job runs backend db-migrations
- `uninstallPolicy.enabled: true` — the gate requires the namespace
  annotation before `helm uninstall` (safety net for prod)

The template does NOT contain: cluster IPs, GPU URLs, Issuer names,
real SealedSecret values. Every operator-specific value is left for
operators to fill in when they fork the file.

## File layout

Each `deploy/environments/<env>/` directory holds:

- `values-override.yaml` — the per-env values (applied via `helm template
  ... -f <file>`)
- `kustomization.yaml` — the Kustomize base (for envs that use the
  Kustomize render path; the chart itself is Kustomize-unaware — this
  layer is purely render-time glue for GitLab CI / Kustomize-aware
  pipelines)
- `secrets/` — SealedSecret CRs re-sealed for the env's cluster
  (offline workflow: `kubeseal --fetch-cert` then per-secret
  `--cert pub-cert.pem`)

Conventions:
- TWO envs ship: `dev` (local minikube/k3s, port-forward) and `prod`
  (GENERIC template — NOT a real cluster's values; operators fork it
  for their prod cluster). el-salvador's specific values are NOT here
  (dedicated migration plan when that cluster moves to K8s).
- `clusterProfile` MUST be set on every env (`dev | prod`).
- The umbrella's `namespace` defaults to `genieai`; per-namespace installs
  override here AND commit to per-namespace ops (see
  `docs/charts/namespace-per-env.md`).
- `dev` runs against `feat/k8s-migration` directly via `helm install`
  on a minikube/k3s cluster (local). `prod` (once forked for a real
  cluster) is consumed by ArgoCD/Flux on the target cluster.
- `deploy/gitops/` ships both ArgoCD and Flux sync examples; pick ONE,
  delete the other (spec §19.3 — chart is GitOps-agnostic).
```

- [ ] **Step 4: Create `docs/charts/namespace-per-env.md`**

```markdown
# Namespace-per-env — caveat

The umbrella chart defaults `namespace: genieai` (shared across all
envs). Operators can override `.Values.namespace` to a per-env value
(`genieai-dev`, `genieai-staging`, `genieai-prod`, etc.) — but the
following chart-side hooks DO NOT support per-namespace installs as
shipped:

1. The pre-install `dep-check` Job reads `.Values.namespace` correctly;
   the pre-install `clusterprofile-detect` Job reads the namespace
   label which the operator must set on the per-env namespace object.
2. The SealedSecret drift hook (Plan 2 Task 11) and the pre-upgrade
   drift hook (Plan 2 Task 11 Step 4) read the namespace correctly.
3. The `Namespace` resource (Plan 1 Task 8) is a pre-install hook with
   weight -40 — it creates the per-env namespace object on first
   install; re-runs on `helm upgrade` re-create it (idempotent — same
   spec, before-hook-creation keeps it).
4. The dep-graph ConfigMap (Plan 2 Task 6) reads `.Values.namespace` —
   correctly per-env.

What requires a values-side override on a per-namespace install:
- `ingress.host` (every HTTPRoute uses it)
- `KEYCLOAK_URL` (set by `cross-service-urls` template; uses
  `.Values.namespace`)
- The OTel collector Service name (`genieai-collector.<ns>.svc...`) —
  per-namespace, fine.

Recommended approach: per-namespace installs are SUPPORTED but the
operator must verify that any env-side Kustomize patches reference the
same namespace. The chart will not warn if the two diverge.
```

- [ ] **Step 5: Add chart-side `values.yaml` blocks** (consumed by later tasks)

```yaml
ingress:
  enabled: true
  className: envoy                  # spec §9 — only `envoy` supported
  host: genieai.example.org
  # TLS via cert-manager; the chart NEVER installs cert-manager. Set
  # `tls.issuerName` to a cluster-defined Issuer (e.g. `letsencrypt-prod`).
  # Empty = no TLS annotation on the HTTPRoute (operator-side TLS).
  tls:
    enabled: false
    issuerName: ""
  # CORS: spec §9. Origins derived from ingress.host + the dev
  # origins list (KAS + Flutter mobile + local dev). Operators override
  # per-env.
  cors:
    allowOrigins: []
    allowMethods: ["GET","POST","PUT","DELETE","OPTIONS","PATCH"]
    allowHeaders: ["Authorization","Content-Type","X-Requested-With"]

migrate:
  # Helm pre-install + pre-upgrade Job that runs the backend db-migrations
  # before the backend Deployment becomes Ready (Plan 2 + Plan 3 deferred
  # item). The image + command match the genie-ai-db-migrations image
  # in the CI registry (see `deploy/ansible/tasks/deploy-shared-facts.yml`).
  enabled: true
  image: { repository: registry.example.org/genie-ai-db-migrations, tag: "1.0.0" }
  backoffLimit: 3
  # Use the default ServiceAccount (NOT the dep-check SA — it has
  # list/watch on Secrets that migrations don't need).
  serviceAccountName: ""
  # Resource tuning per env. The migrations are read+write on the
  # Postgres + Arango + Redis at startup; the chart's default is a
  # small request, generous limit.
  resources:
    requests: { cpu: 100m, memory: 256Mi }
    limits:   { cpu: 1, memory: 1Gi }

# Verified-peer NetworkPolicy values — Task 5 reads these to replace
# the port-scoped ipBlock egress with real podSelector peers after the
# operator runs `kubectl get pods --show-labels` against the
# cluster's CNPG / kube-arangodb / keycloak-operator / Envoy Gateway
# data plane.
pluggable:
  storageClassName: ""
  networkPolicy:
    # Empty list = port-scoped ipBlock fallback (Plans 2-5 default).
    # Each entry is `{namespace: "<ns>", podSelector: {<labels>}}`.
    # Example (fill in real labels after live inspection):
    #   - namespace: cnpg-system
    #     podSelector: { cnpg.io/cluster: keycloak-db }
    #   - namespace: arangodb-operator-system
    #     podSelector: { app.kubernetes.io/name: kube-arangodb }
    peers: []
  # Tenant-tenant per-namespace allowlist (optional). Empty = all
  # Pods in the same namespace can use the chart's services.
  crossNamespaceAllowed: []
```

- [ ] **Step 6: Render with `dev` overlay and confirm diff**

Run: `helm template test charts/genieai-umbrella -n genieai -f deploy/environments/dev/values-override.yaml | head -30`
Expected: renders the Namespace with `genieai` name + dev PSA labels; existing Plan 1-5 resources still emit; ingress resources do NOT render (dev's `ingress.enabled: false`).

- [ ] **Step 7: `helm lint --strict` (with each overlay) + commit**

```bash
helm lint charts/genieai-umbrella --strict -f deploy/environments/dev/values-override.yaml
helm lint charts/genieai-umbrella --strict -f deploy/environments/prod/values-override.yaml
git add deploy/ docs/charts/namespace-per-env.md charts/genieai-umbrella/values.yaml
git commit -m "feat(charts): per-env overlays (dev/staging/prod/sovereign) + ingress/migrate/netpol values"
```

---

### Task 2: Envoy Gateway Gateway + HTTPRoute per env

**Files:**
- Create: `charts/genieai-umbrella/templates/gateway/gateway.yaml`
- Create: `charts/genieai-umbrella/templates/gateway/httproute.yaml`
- Create: `charts/genieai-umbrella/templates/gateway/cors-policy.yaml` (optional CORS policy)

**Interfaces:**
- Consumes: `ingress.{enabled, className, host, tls.*, cors.*}`.
- Produces: 1 `Gateway` + 1 `HTTPRoute` (routing `/api/*` → backend, `/` → frontend) per env with `ingress.enabled: true`. The `Gateway` references the Envoy Gateway data-plane namespace via a GatewayClass — operator selects the class via `ingress.className`.

- [ ] **Step 1: Write `charts/genieai-umbrella/templates/gateway/gateway.yaml`**

```yaml
{{- if .Values.ingress.enabled -}}
apiVersion: gateway.networking.k8s.io/v1
kind: Gateway
metadata:
  name: genieai
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "ingress"))) | nindent 4 }}
spec:
  gatewayClassName: {{ .Values.ingress.className | default "envoy" | quote }}
  listeners:
    - name: http
      protocol: HTTP
      port: 80
      allowedRoutes:
        namespaces:
          from: Same
    - name: https
      protocol: HTTPS
      port: 443
      tls:
        mode: Terminate
        {{- if .Values.ingress.tls.enabled }}
        certificateRefs:
          - kind: Secret
            name: {{ printf "%s-tls" .Values.ingress.host | default "genieai-tls" }}
        {{- end }}
      allowedRoutes:
        namespaces:
          from: Same
{{- end -}}
```

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/gateway/httproute.yaml`**

```yaml
{{- if .Values.ingress.enabled -}}
apiVersion: gateway.networking.k8s.io/v1
kind: HTTPRoute
metadata:
  name: genieai
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "ingress"))) | nindent 4 }}
spec:
  parentRefs:
    - name: genieai
      sectionName: {{ if .Values.ingress.tls.enabled }}https{{ else }}http{{ end }}
  hostnames:
    - {{ .Values.ingress.host | quote }}
  rules:
    # /api/* and /uploads/* -> backend BFF (Plan 3 backend Service on port 80)
    - matches:
        - path: { type: PathPrefix, value: /api/ }
        - path: { type: PathPrefix, value: /api-docs/ }
        - path: { type: PathPrefix, value: /uploads/ }
      backendRefs:
        - name: backend
          port: 80
    # SPA -> frontend
    - matches:
        - path: { type: PathPrefix, value: / }
      backendRefs:
        - name: frontend
          port: 80
{{- end -}}
```

- [ ] **Step 3: Optional CORS policy** (envoy gateway uses BackendTLSPolicy / HTTPRouteFilter for CORS; render only when `cors.allowOrigins` is non-empty)

```yaml
{{- if and .Values.ingress.enabled .Values.ingress.cors.allowOrigins -}}
apiVersion: gateway.envoyproxy.io/v1alpha1
kind: HTTPRouteFilter
metadata:
  name: genieai-cors
  namespace: {{ .Values.namespace }}
spec:
  cors:
    allowOrigins:
      {{- range .Values.ingress.cors.allowOrigins }}
      - name: {{ . | quote }}
      {{- end }}
    allowMethods: {{ .Values.ingress.cors.allowMethods | toJson }}
    allowHeaders: {{ .Values.ingress.cors.allowHeaders | toJson }}
{{- end -}}
```

(The HTTPRoute's `filters:` array references this HTTPRouteFilter by name; add to Task 2 Step 2.)

- [ ] **Step 4: Render with `prod` overlay**

Run: `helm template test charts/genieai-umbrella -n genieai -f deploy/environments/prod/values-override.yaml --set ingress.tls.enabled=true --set ingress.cors.allowOrigins={https://genieai.example.org} | grep -E "^kind: (Gateway|HTTPRoute|HTTPRouteFilter)$"`
Expected: prints 3 kinds (one of each).

- [ ] **Step 5: Render with `dev` overlay** (ingress disabled)

Run: `helm template test charts/genieai-umbrella -n genieai -f deploy/environments/dev/values-override.yaml | grep -cE "^kind: (Gateway|HTTPRoute)"`
Expected: prints `0` (dev override has `ingress.enabled: false`).

- [ ] **Step 6: `helm lint --strict` + commit**

```bash
helm lint charts/genieai-umbrella --strict -f deploy/environments/prod/values-override.yaml --set ingress.tls.enabled=true
git add charts/genieai-umbrella/templates/gateway/
git commit -m "feat(charts): Envoy Gateway Gateway + HTTPRoute + optional CORS HTTPRouteFilter"
```

---

### Task 3: cert-manager Certificate resource + Issuer reference (per-env)

**Files:**
- Create: `charts/genieai-umbrella/templates/gateway/certificate.yaml`

**Interfaces:**
- Consumes: `ingress.tls.{enabled, issuerName, host}`.
- Produces: 1 `cert-manager.io/v1 Certificate` per env with `ingress.tls.enabled: true`. The cert-manager `Issuer` is a cluster-bootstrap prerequisite — the chart NEVER installs it; the annotation `cert-manager.io/issuer: <issuerName>` references whatever Issuer the operator has created. Conftest (Plan 7) fails the commit if a chart override hardcodes an `Issuer` CR (the chart stays Issuer-agnostic).

- [ ] **Step 1: Write `charts/genieai-umbrella/templates/gateway/certificate.yaml`**

```yaml
{{- if and .Values.ingress.enabled .Values.ingress.tls.enabled -}}
apiVersion: cert-manager.io/v1
kind: Certificate
metadata:
  name: {{ .Values.ingress.host | default "genieai" | replace "." "-" }}-tls
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "ingress"))) | nindent 4 }}
spec:
  # The Issuer is a CLUSTER concern — the chart NEVER installs it.
  # The operator creates a ClusterIssuer / Issuer (e.g. `letsencrypt-prod`)
  # before installing the chart, and references it by name here.
  issuerRef:
    name: {{ .Values.ingress.tls.issuerName | required "ingress.tls.issuerName is required when ingress.tls.enabled=true" }}
    kind: ClusterIssuer
    group: cert-manager.io
  secretName: {{ printf "%s-tls" .Values.ingress.host | default "genieai-tls" }}
  dnsNames:
    - {{ .Values.ingress.host | quote }}
{{- end -}}
```

- [ ] **Step 2: `helm template` with prod + tls**

Run: `helm template test charts/genieai-umbrella -n genieai -f deploy/environments/prod/values-override.yaml --set ingress.tls.enabled=true | grep -A 2 "kind: Certificate"`
Expected: prints the Certificate with the prod Issuer name.

- [ ] **Step 3: Negative test — missing issuerName fails**

Run: `helm template test charts/genieai-umbrella -n genieai -f deploy/environments/prod/values-override.yaml --set ingress.tls.enabled=false 2>&1 | grep "Error" | head -3`
Expected: a Helm template error (the `required` function in Task 3 Step 1).

- [ ] **Step 4: `helm lint --strict` + commit**

```bash
helm lint charts/genieai-umbrella --strict -f deploy/environments/prod/values-override.yaml --set ingress.tls.enabled=true
git add charts/genieai-umbrella/templates/gateway/certificate.yaml
git commit -m "feat(charts): cert-manager Certificate (Issuer-agnostic; conftest forbids chart-side Issuer CRs)"
```

---

### Task 4: GitOps sync examples — ArgoCD + Flux

**Files:**
- Create: `deploy/gitops/argocd/genieai-dev.yaml`
- Create: `deploy/gitops/argocd/genieai-staging.yaml`
- Create: `deploy/gitops/argocd/genieai-prod.yaml`
- Create: `deploy/gitops/argocd/project.yaml` (AppProject)
- Create: `deploy/gitops/flux/gitrepository.yaml`
- Create: `deploy/gitops/flux/kustomization-dev.yaml`
- Create: `deploy/gitops/flux/kustomization-staging.yaml`
- Create: `deploy/gitops/flux/kustomization-prod.yaml`
- Create: `deploy/gitops/README.md`

**Interfaces:**
- Consumes: per-env overlays (Task 1).
- Produces: working ArgoCD `Application` + Flux `Kustomization` per env. Both are real manifests (the operator can `kubectl apply -f` either path).

- [ ] **Step 1: Write `deploy/gitops/argocd/project.yaml`**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: AppProject
metadata:
  name: genieai
  namespace: argocd
spec:
  description: GENIE.AI Helm chart deployments
  sourceRepos:
    - https://opensource.unicc.org/un/itu/genie-ai.git
  destinations:
    - namespace: '*'
      server: '*'
  clusterResourceWhitelist:
    - group: ''     # core (Namespace, ConfigMap)
    - group: rbac.authorization.k8s.io
```

- [ ] **Step 2: Write `deploy/gitops/argocd/genieai-dev.yaml`**

```yaml
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: genieai-dev
  namespace: argocd
spec:
  project: genieai
  source:
    repoURL: ssh://git@opensource.unicc.org:22/un/itu/genie-ai.git   # SSH with explicit port (scp-like URL omits port and breaks the parser)
    # OR for HTTPS:
    # repoURL: https://opensource.unicc.org/un/itu/genie-ai.git
    targetRevision: feat/k8s-migration       # or release/<env> for envs that branch
    path: deploy/environments/dev
  destination:
    server: https://kubernetes.default.svc
    namespace: genieai                       # matches the chart's `namespace` default
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
      allowEmpty: false
    syncOptions:
      - CreateNamespace=false              # the chart's hook (Plan 1 Task 8) creates the namespace
    retry:
      limit: 5
      backoff:
        duration: 5s
        factor: 2
        maxDuration: 3m
  revisionHistoryLimit: 10
```

- [ ] **Step 3: Write `deploy/gitops/argocd/genieai-prod.yaml`** — mirror of dev with `targetRevision: release/el-salvador` and `path: deploy/environments/prod`. (Sole real env. Other clusters — dev — use `kubectl port-forward`, not GitOps.)

- [ ] **Step 4: Write `deploy/gitops/flux/gitrepository.yaml`**

```yaml
apiVersion: source.toolkit.fluxcd.io/v1
kind: GitRepository
metadata:
  name: genieai
  namespace: flux-system
spec:
  interval: 1m
  url: ssh://git@opensource.unicc.org:22/un/itu/genie-ai.git
  ref:
    branch: feat/k8s-migration
  secretRef:
    name: flux-system
```

- [ ] **Step 5: Write `deploy/gitops/flux/kustomization-dev.yaml`**

```yaml
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
  force: false                             # refuse on manifest conflict; surface to CI
  healthChecks:
    - apiVersion: apps/v1
      kind: Deployment
      name: genieai-dev-backend           # literal name; same `name` as the per-env Release (default = `<release>-<chart>-<component>` per genieai-common.fullname)
      namespace: genieai                   # literal namespace; matches the chart's `namespace` default
```

(The health check names must be LITERAL (not Helm-templated) — Flux does not evaluate `{{ .Values... }}`. Render one Flux Kustomization per env with the literal `name:` + `namespace:` values, derived from the per-env `genieai-common.fullname` template at apply time. If operators rename the release, the per-env Kustomization is re-rendered.)

- [ ] **Step 6: Skip** — Flux is the optional path (per spec §19.3.1); for el-salvador we use ArgoCD (Step 3). The `flux/kustomization-prod.yaml` is left as a reference for operators who prefer Flux; do not generate a separate `kustomization-staging.yaml` (no such env).

- [ ] **Step 7: Write `deploy/gitops/README.md`**

```markdown
# GitOps sync examples

The chart is GitOps-agnostic (spec §19.3 — chart is GitOps-agnostic).
Choose ONE of the two paths below and DELETE the other:

## Option A — ArgoCD (recommended)

`argocd/*.yaml` — the `AppProject` defines the cluster resource
allowlist + the source repos; the per-env `Application` resources
follow the standard ArgoCD pattern (ApplicationSet is overkill for 4 envs).

```bash
kubectl apply -f deploy/gitops/argocd/project.yaml
kubectl apply -f deploy/gitops/argocd/genieai-prod.yaml
# dev uses kubectl port-forward; no GitOps for dev.
```

## Option B — Flux

`flux/*.yaml` — `GitRepository` references the source; the per-env
`Kustomization` reconciles with `force: false` (refuses on manifest
conflict — surfaces to GitLab CI, MR must rebase before next sync).

```bash
flux create source git genieai --url=ssh://git@opensource.unicc.org:22/un/itu/genie-ai.git --branch=feat/k8s-migration
kubectl apply -f deploy/gitops/flux/kustomization-dev.yaml
```

## Note

The chart's per-env overlays live in `deploy/environments/<env>/`; the
GitOps layer reconciles THAT path (after `helm template` + Kustomize
have rendered it). For the "raw chart" path (no `helm template` step),
Flux's `Kustomization` can point at the chart directly via the
`helm-release` HelmRelease pattern — but this plan assumes the
template-then-commit model.
```

- [ ] **Step 8: `kubeconform` (or `kubectl apply --dry-run=client -f`) on the ArgoCD + Flux examples**

Run: `kubectl apply --dry-run=client -f deploy/gitops/argocd/`
Expected: `configured` / `unchanged` for every file (no parse errors).

Run: `kubectl apply --dry-run=client -f deploy/gitops/flux/`
Expected: same.

- [ ] **Step 9: `helm lint --strict` + commit**

```bash
helm lint charts/genieai-umbrella --strict
git add deploy/gitops/
git commit -m "docs(charts): GitOps sync examples (ArgoCD + Flux) — pick one"
```

---

### Task 5: Verified-peer NetworkPolicy pass + db-migrations Job + doc-repo PVC (consolidated open items)

**Files:**
- Create: `charts/genieai-umbrella/templates/migrate/db-migrations-job.yaml`
- Modify: `charts/genieai-umbrella/templates/services/documentRepository.yaml` (wire `services.documentRepository.pvc` → volumeMounts + PVC)
- Create: `charts/genieai-umbrella/templates/networkpolicies-verified.yaml` (replace port-scoped ipBlock egress with operator-provided peers; falls back to ipBlock when `pluggable.networkPolicy.peers` is empty)
- Modify: `charts/genieai-umbrella/templates/ai/networkpolicies.yaml` (same)
- Modify: `docs/charts/plan-defects.md` (close the db-migrations / doc-repo PVC / NetworkPolicy label rows; remaining rows annotated)

**Interfaces:**
- Consumes: `migrate.*` values (Task 1), `services.documentRepository.pvc` (Task 1 + Plan 3), `pluggable.networkPolicy.peers` (Task 1).
- Produces: 1 pre-install+pre-upgrade Job (`migrate.db-migrations`); 1 PVC per `services.documentRepository.pvc.enabled: true`; NetworkPolicies whose egress is `podSelector`-based when `pluggable.networkPolicy.peers` is non-empty, `ipBlock`-based otherwise.

- [ ] **Step 1: Write `charts/genieai-umbrella/templates/migrate/db-migrations-job.yaml`**

```yaml
{{- if .Values.migrate.enabled -}}
{{- $sa := .Values.migrate.serviceAccountName | default "default" -}}
apiVersion: batch/v1
kind: Job
metadata:
  name: genieai-db-migrations
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "migrate"))) | nindent 4 }}
  annotations:
    # pre-install + pre-upgrade: runs BEFORE the backend Deployment becomes
    # Ready (the chart's hook ordering: -30 RBAC -> -20 cm -> -10 profile
    # -> -5 dep-check -> 0 [migrate] -> 1 [regular Deployments]). The Job
    # is a pre-install hook, not a regular resource.
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "0"
    "helm.sh/hook-delete-policy": before-hook-creation,hook-succeeded
spec:
  backoffLimit: {{ .Values.migrate.backoffLimit | default 3 }}
  template:
    metadata:
      labels:
        {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "migrate"))) | nindent 8 }}
    spec:
      restartPolicy: Never
      serviceAccountName: {{ $sa }}
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: migrate
          image: {{ .Values.migrate.image.repository }}:{{ .Values.migrate.image.tag }}
          imagePullPolicy: IfNotPresent
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            runAsUser: 65534
            capabilities:
              drop: ["ALL"]
          env:
            # Inherit every env the backend needs (KEYCLOAK_URL, ARANGO_URL, etc.)
            # via the cross-service-URLs helper. The migrations need Postgres
            # write access (CNPG initdb + the per-app migrations).
            - name: KEYCLOAK_URL
              value: "http://keycloak.{{ .Values.namespace }}.svc.cluster.local:8080/auth"
            - name: ARANGO_URL
              value: "http://arangodb-single.{{ .Values.namespace }}.svc.cluster.local:8529"
            - name: KEYCLOAK_REALM
              value: genie
          envFrom:
            - secretRef: { name: keycloak-db-credentials }
            - secretRef: { name: arango-root-secret }
          resources:
            {{- toYaml .Values.migrate.resources | nindent 12 }}
{{- end -}}
```

- [ ] **Step 2: Wire document-repository PVC into the Deployment template** (Plan 3 Task 1b deferred)

Edit `charts/genieai-umbrella/templates/services/documentRepository.yaml`:
- Add `volumeMounts` + `volumes` to the Deployment container block:
  ```yaml
            {{- if and .Values.services.documentRepository.enabled .Values.services.documentRepository.pvc.enabled }}
            - { name: uploads, mountPath: /app/uploads }
            ...
          volumes:
            - name: uploads
              persistentVolumeClaim:
                claimName: document-repository-uploads
            {{- end }}
  ```
- Append the PVC template (defined in Plan 3 Task 1b Step 4 — `services.documentRepository.pvc.enabled: true` gates it).

- [ ] **Step 3: Verified-peer NetworkPolicy templates**

Create `charts/genieai-umbrella/templates/networkpolicies-verified.yaml` that ADDS a namespace-scoped egress NetworkPolicy for every entry in `pluggable.networkPolicy.peers`. When the list is empty, the file renders nothing (no NetworkPolicy) and the Plans 3/5 ipBlock-fallback egress rules are the active policy. When non-empty, this file renders in ADDITION to the Plans 3/5 policies — the operator gets BOTH the broader ipBlock fallback AND the verified podSelector peers (verified peers are strict-allowlist supersets of the ipBlock rules; CNPG / kube-arangodb / keycloak-operator / Envoy Gateway data plane is reachable via the verified peers; everything else is still allowed by the ipBlock fallback).

```yaml
{{- range $peer := .Values.pluggable.networkPolicy.peers }}
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: genieai-peer-{{ $peer.namespace | replace "/" "-" }}-{{ $peer.podSelector | toJson | sha256sum | trunc 8 }}
  namespace: {{ $.Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" $.Chart "Release" $.Release "Values" (deepCopy $.Values | merge (dict "component" "network-policy"))) | nindent 4 }}
spec:
  podSelector: {}
  policyTypes: [Egress]
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              kubernetes.io/metadata.name: {{ $peer.namespace }}
          podSelector:
            matchLabels: {{ $peer.podSelector | toJson }}
{{- end }}
```

(Operators fill in the `peers` values once after `kubectl get pods --show-labels`; subsequent upgrades re-render the policies with the verified selectors. The port-scoped ipBlock egress in Plans 3/5 stays — Plan 6 is additive, not a replacement.)

**Important — this is NOT a fallback replacement.** The chart's NPs in Plans 3/5 keep their ipBlock egress (port-scoped any-destination) so the chart installs on dev clusters with empty operator-supplied peer lists. The verified-peer NPs added here give the operator a strict allowlist for prod/sovereign without forcing every dev to discover the operator's pod labels. The same chart renders both — the operator decides which side of the allowlist to keep.

- [ ] **Step 4: Ledger cleanup**

In `docs/charts/plan-defects.md`, mark these rows as closed:
- "db-migrations Job" → closed (Task 1 + Task 5).
- "document-repository PVC" → closed (Plan 3 Task 1b + Task 5).
- "NetworkPolicy label-verified peers" → closed (Task 5).
- "ArangoDB `arangodb-single` service consumer URLs" → kept open (Task 5 note: verified by the operator after first live render of the kube-arangodb Service).

- [ ] **Step 5: `helm lint --strict` + render assertions + commit**

```bash
helm lint charts/genieai-umbrella --strict -f deploy/environments/prod/values-override.yaml
helm template test charts/genieai-umbrella -n genieai -f deploy/environments/prod/values-override.yaml | grep -c "^kind: Job$"
# Expected: 1 (the migrate Job; hook Jobs are pre-install/pre-upgrade, the gate counts)
helm template test charts/genieai-umbrella -n genieai -f deploy/environments/prod/values-override.yaml | grep -c "kind: PersistentVolumeClaim"
# Expected: 2 (HF cache + document-repository)
git add charts/genieai-umbrella/templates/migrate/ charts/genieai-umbrella/templates/networkpolicies-verified.yaml charts/genieai-umbrella/templates/services/documentRepository.yaml docs/charts/plan-defects.md
git commit -m "feat(charts): db-migrations pre-upgrade Job + doc-repo PVC + verified-peer NetworkPolicy"
```

---

### Task 6: Uninstall safety gate — per-env opt-in annotation (spec §13.1)

**Files:**
- Modify: `charts/genieai-umbrella/templates/hooks/pre-delete-uninstall-gate.yaml` (Plan 2 deferred; read what Plan 2 wrote first)

**Interfaces:**
- Consumes: `release.<env>.uninstallPolicy` values key (per-env).
- Produces: 1 pre-delete `Job` that fails `helm uninstall` UNLESS the chart's namespace carries `genieai.io/allow-destructive-uninstall=true` (Plan 2 spec — the spec's pattern is operator-applied per env via the values override; the chart renders the gate, operators set the annotation per env via `kubectl annotate ns ... --overwrite`).

- [ ] **Step 1: Locate Plan 2's pre-delete hook job and re-confirm its annotation carrier**

Read `charts/genieai-umbrella/templates/hooks/pre-delete-uninstall-gate.yaml`. Plan 2 ships a pre-delete Job; the gate reads the `genieai.io/allow-destructive-uninstall` annotation on the namespace. If the annotation is set, the gate exits 0; otherwise it exits 1 with a clear message.

- [ ] **Step 2: Per-env `uninstallPolicy` in values-override**

In `deploy/environments/prod/values-override.yaml` (the sole real env), add:
```yaml
uninstallPolicy:
  # `enabled: true` = gate renders (the operator MUST set the annotation
  # before `helm uninstall`). `enabled: false` = gate is a no-op
  # (uninstall proceeds; spec §13.1 says this is the default for dev
  # only — prod should keep it `true`).
  enabled: true
```

Set `enabled: false` in `dev/values-override.yaml`; `true` for `prod/values-override.yaml`.

- [ ] **Step 3: `helm template` with each overlay**

Run: `for env in dev prod; do echo "=== $env"; helm template test charts/genieai-umbrella -n genieai -f deploy/environments/$env/values-override.yaml | grep -c "pre-delete"; done`
Expected: dev=0; prod=1 (the Job renders when `uninstallPolicy.enabled: true`).

- [ ] **Step 4: `helm lint --strict` + commit**

```bash
helm lint charts/genieai-umbrella --strict -f deploy/environments/prod/values-override.yaml
git add deploy/environments/ charts/genieai-umbrella/values.yaml
git commit -m "feat(charts): per-env uninstallPolicy opt-in (dev skips the gate; staging/prod/sovereign require the annotation)"
```

---

### Task 7: Final validation + READMEs

**Files:**
- Modify: `charts/README.md`
- Modify: `charts/genieai-umbrella/README.md`
- Modify: `deploy/environments/README.md`
- Modify: `docs/charts/plan-defects.md` (Plan 6 wave entry)

**Interfaces:**
- Consumes: every prior task.
- Produces: documentation checkpoint + full-render validation.

- [ ] **Step 1: Update `charts/README.md`** — status line "Foundation + Plans 2-6 complete"; new row in the charts table for `deploy/environments/` (per-env overlays) + `deploy/gitops/` (sync examples).

- [ ] **Step 2: Update `charts/genieai-umbrella/README.md`** — append "Per-env" + "Ingress" + "GitOps" + "Migrations" sections. Reference `deploy/environments/<env>/values-override.yaml` per env.

- [ ] **Step 3: Update `deploy/environments/README.md`** — see Task 1 Step 5.

- [ ] **Step 4: Add Plan 6 wave to `docs/charts/plan-defects.md`**

```
## Plan 6 — per-env + ingress

Tasks 1-7 shipped: per-env overlays (dev/staging/prod/sovereign), Envoy
Gateway Gateway + HTTPRoute (CORS via HTTPRouteFilter), cert-manager
Certificate (issuer-agnostic, conftest-blocked chart-side Issuers),
ArgoCD + Flux sync examples (pick one), verified-peer NetworkPolicy
values, db-migrations pre-upgrade Job, document-repository PVC
integration, per-env uninstallPolicy. Ingress-only-not-TLS path
documents the operator-side TLS choice; per-namespace install is
documented as supported but not validated.
```

- [ ] **Step 5: Render summary + lint + commit**

```bash
helm template test charts/genieai-umbrella -n genieai -f deploy/environments/prod/values-override.yaml --set ingress.tls.enabled=true --set ingress.cors.allowOrigins={https://genieai.example.org} | grep "^kind:" | sort | uniq -c | sort -rn | head -12
# Expected: Gateway, HTTPRoute, Certificate, HTTPRouteFilter, plus
# the Plans 1-5 inventory.
helm lint charts/genieai-umbrella --strict -f deploy/environments/dev/values-override.yaml
helm lint charts/genieai-umbrella --strict -f deploy/environments/prod/values-override.yaml --set ingress.tls.enabled=true
ct lint --config charts/ci/ct.yaml --charts charts/genieai-umbrella
git add charts/README.md charts/genieai-umbrella/README.md deploy/environments/README.md docs/charts/plan-defects.md
git commit -m "docs(charts): Plan 6 status — per-env + ingress + GitOps + migrations"
```

---

## Self-Review

**1. Spec coverage** (per-env + ingress slice):

| Spec section | Task |
|---|---|
| §5.1 per-env overrides | Task 1 (4 overlays) |
| §9 Envoy Gateway (Gateway + HTTPRoute + CORS) | Task 2 |
| §9 TLS via cert-manager (cluster concern) | Task 3 |
| §13.1 uninstall safety per env | Task 6 |
| §17 manifest per-env entries | Task 7 README |
| §19.3.1 Flux Kustomization | Task 4 |
| §19.3.2 ArgoCD Application | Task 4 |
| §19.3 GitOps-agnostic principle | Task 4 (both paths ship) |

Sections deferred: KAS module / Flux source-write side (GitLab CI renders the chart + Kustomize + writes to the GitOps repo — this is the `deploy:genieai:$env` CI job; covered in `docs/RELEASE.md` + `docs/ci/`, not in this plan).

**2. Placeholder scan**: only the standard `PLACEHOLDER+` (base64 sentinel) markers in SealedSecret templates. No "TBD"/"TODO".

**3. Type consistency**: `genieai-common.labels`, `genieai-common.serviceSelector`, `genieai-common.fullname` used uniformly across Tasks 1, 2, 3, 5; the `migrate.image` shape matches `services.<name>.image`; the NetworkPolicy `peers` schema is a list of `{namespace, podSelector}` dicts (operator-side input).

**4. Review Focus coverage**: all five pinned (Task 1 Step 1, Task 1 Step 4, Task 3 Step 3, Task 1 Step 3, Task 5 Step 2).

**5. Adversarial review note**: run `/code-review` on this plan before execution — five prior waves caught structural errors in every plan so far.

---

## Plan Stats

- **Tasks:** 7
- **New templates:** 6 (Gateway, HTTPRoute, HTTPRouteFilter, Certificate, db-migrations Job, verified-peer NetworkPolicies) + 1 modified (documentRepository.yaml)
- **New overlays:** 4 (dev/staging/prod/sovereign)
- **GitOps examples:** 8 (1 AppProject + 3 ArgoCD Application + 1 GitRepository + 3 Kustomization + 1 README)
- **Commits planned:** 7
- **Estimated review surface:** ~700 lines added

## What's next after Plan 6

- **Plan 7**: CI (charts:lint/integration/scan jobs, cosign + Kyverno REAL syntax, Renovate, uninstall safety, conftest secret-leak + placeholder sweep, PII smoke test K8s port, ArgoCD ApplicationSet or Flux HelmRelease pattern)
- **Plan 8**: documentation (site/content/en/docs/deployment/ + docs/charts/*; Hugo build verified)
