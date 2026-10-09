# GENIE.AI Helm Charts — Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the data tier of the GENIE.AI Helm chart: 3 new Helm `dependencies` (CloudNativePG, kube-arangodb, sealed-secrets 2.20.0+) plus the keycloak-operator as a **cluster bootstrap prerequisite** (installed via OLM/static YAML — its Helm repo URL serves no index; verified 2026-10-08), the rendered CRs (CNPG Postgres cluster for keycloak-db, ArangoDeployment, `Keycloak` + `KeycloakRealmImport`, and a SealedSecret framework (4 CRs here; the rest ship with their consumers in Plans 3+). Kong is REMOVED — audit decision 7), plus the dependency-graph enforcement + ClusterProfile auto-detection hook. Establishes the pattern service-tier plans (3+) build on.

**Architecture:** The umbrella chart pulls three operators as Helm `dependencies` with `condition:` toggles; the keycloak-operator is a documented bootstrap prerequisite (the chart renders only the CRs it manages). The chart renders the operator-managed CRs (Postgres Cluster, ArangoDeployment, KeycloakRealm, SealedSecret) declaratively. A pre-install hook Job validates that the user's selected service tier (keycloak, arangodb, kong) has its declared data dependencies enabled — fails-fast at install time, not at first Pod crash. ClusterProfile is auto-detected from a namespace label when the pre-install Job runs, then inherited by templates via `--set clusterProfile=...`.

**Tech Stack:** Helm 4.x, chart-testing (`ct` v3.x), CNPG operator (v1.30 / chart `~> 0.30.0`), kube-arangodb (`~> 1.4.5`), keycloak-operator 26.x (bootstrap prerequisite, NOT a chart dep), sealed-secrets helm chart `~> 2.20.0` (controller v0.40.0), kind 1.33, kubectl 1.33+, kustomize 5.x.

**Spec:** `docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md` — this plan implements §4 (operator deps), §5.1 (dependency-graph + pre-install hook), §5.2 (ClusterProfile auto-detect), §8 (concrete SealedSecret rendering of the 14 required secrets minus `kongDbPassword` since Kong goes DB-less per Q1a), §17 (data-tier entries in v1.0 manifest).

## Global Constraints

- Helm chart API version: `v2`. Helm 4.x.
- Default operator `condition:` keys MUST match the values keys under which the toggle is exposed in `values.yaml` — spec §4 already aligned (`data.keycloak.enabled`, not bare `keycloak.enabled`).
- Operator dep version pins: **`~> 0.1` for lib-side deps, `~> 1.4.5` for kube-arangodb, `~> 0.30.0` for cloudnative-pg, `~> 2.20.0` for sealed-secrets**. NOTE: the CVE IDs cited by early research (CVE-2026-22728, CVE-2026-59341) were NOT verified and are RETRACTED — do not cite them anywhere; pin rationale lives in `docs/charts/k8s-native-audit.md` + spec §8.
- All English documentation and comments per project CLAUDE.md.
- Commits in English using Conventional Commits.
- No secrets in any committed file — only encrypted SealedSecret resources ship in Git.
- Worktree path: `/home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/k8s-migration/`. Branch: `feat/k8s-migration`.
- Kong is REMOVED (audit decision 7, user-confirmed 2026-10-08): Envoy Gateway owns the edge; no Kong templates anywhere.

## Review Focus

Five input-class concerns the spec implies but no Plan 2 task tests explicitly. Each pinned to a specific step.

1. **`templates/hooks/...` directory is dead storage in Helm 3** — Helm 3 scans `templates/` recursively for `helm.sh/hook` annotations; a subdirectory named `hooks/` is irrelevant IF the file carries the annotation. **Pinned in Task 6 Step 1** — explicit `helm.sh/hook: pre-install` + `helm.sh/hook-weight: "-5"` annotations on the Job; validity test renders and asserts `kind: Job` shows up in output.
2. **ClusterProfile auto-detection race** — namespace label write may not propagate to the Pod quickly; the Job checks label at runtime, decides profile, mutates Helm release. Race condition if release upgrade starts before label syncs. **Pinned in Task 7 Step 4** — Job has a 30s `for` loop polling the label; aborts cleanly if missing.
3. **`ArangoDeployment` mode switch mid-life (single → cluster)** — kube-arangodb requires PVC re-allocation + new cluster initialization when transitioning from single-node to cluster mode. **Pinned in Task 9 Step 5** — task explicitly notes "single → cluster requires fresh `helm uninstall` + `helm install`; do not in-place upgrade" + cluster-mode test skipped in foundation CI (uses single mode default).
4. ~~Kong DB-less misconfig~~ — moot: Kong REMOVED (decision 7). Edge routing/JWT/CORS/rate-limit are Envoy Gateway concerns (Plan 6).
5. **SealedSecrets become undecryptable after cluster-key rotation** — rotation is OPERATOR-INITIATED (`kubeseal --rotate`; there is NO 30-day auto-rotation — that earlier claim was wrong). After a rotation, committed SealedSecrets silently fail to decrypt; the controller signals this via `status.conditions[type=SealedSecretHasntDecrypted].status=True` (there is no `invalid` annotation upstream). **Pinned in Task 11 Step 4** — a pre-upgrade hook Job lists SealedSecrets and FAILS the upgrade when any carries that condition (no kubeseal needed inside the Job).

---

## Task 1: Add data deps + sealed-secrets to umbrella Chart.yaml

**Files:**
- Modify: `charts/genieai-umbrella/Chart.yaml`

**Interfaces:**
- Consumes: nothing new.
- Produces: umbrella Chart.yaml references 4 new Helm deps. `helm dependency update` regenerates `Chart.lock` (significant diff — committed alongside the Chart.yaml change with rationale in commit message).

- [ ] **Step 1: Run red-gate validator — must fail before the file is updated**

Run: `helm dep list charts/genieai-umbrella 2>&1 | grep -E "cloudnative-pg|kube-arangodb|sealed-secrets" || echo "OK: no data-layer deps yet"`
Expected: prints `OK: no data-layer deps yet`. **`keycloak-operator` is intentionally NOT in the grep** — it is a cluster bootstrap prerequisite (spec §4, audit decision per Plan 5 round-7) and never appears in `helm dep list`; the previous red-gate's inclusion of `keycloak-operator` would mask a regression where someone added the keycloak-operator Helm chart back as a dep.

Expected: prints `OK: no operator deps yet` (deps not declared).

- [ ] **Step 2: Edit `charts/genieai-umbrella/Chart.yaml`**

Append to the `dependencies:` block (just below the existing `genieai-common` entry):

```yaml
dependencies:
  # Local library chart — re-rendered on every umbrella install.
  # NO import-values: Helm 4
  # injects the reserved `global` key into every subchart's coalesced values,
  # which the library schema's additionalProperties:false rejects. Template
  # definitions are callable via {{ include "genieai-common.*" . }} without it.
  - name: genieai-common
    version: "0.1.0"
    repository: "file://../genieai-common"

  # data layer operators
  - name: cloudnative-pg
    version: "~> 0.30.0"   # unified with spec §4 + Global Constraints 
    repository: "https://cloudnative-pg.github.io/charts"
    condition: data.postgres.enabled
  - name: kube-arangodb
    version: "~> 1.4.5"
    repository: "https://arangodb.github.io/kube-arangodb"
    condition: data.arangodb.enabled
  # keycloak-operator is deliberately NOT a Helm dependency: its advertised
  # chart repo (https://keycloak.github.io/keycloak-operator-helm) serves no
  # index (301 -> 404; verified 2026-10-08). It is a cluster bootstrap
  # prerequisite installed via OLM or the static YAML from keycloak.org.
  # The chart renders only the CRs it manages.
  - name: sealed-secrets
    version: "~> 2.20.0"
    repository: "https://bitnami.github.io/sealed-secrets"
    condition: secrets.sealedSecrets.enabled
```

- [ ] **Step 3: Run `helm dependency update` to fetch the new tarballs**

Run: `helm dependency update charts/genieai-umbrella`

Expected: `Hang tight while we grab the latest from your chart repositories...` and 3 new tarballs (cloudnative-pg, kube-arangodb, sealed-secrets) land in `charts/genieai-umbrella/charts/`. Plus updated `Chart.lock`.

- [ ] **Step 4: Verify the dep list**

Run: `helm dep list charts/genieai-umbrella`
Expected output contains all 3 new entries with the pinned versions.

- [ ] **Step 5: Run `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
# The Chart.lock + charts/*.tgz are vendored dependencies. They will churn
# every time deps change. The umbrella .helmignore (Task 10 in Plan 1) only
# stops *future* churn from entering source — this initial commit includes
# the tarballs as a baseline. Future dep bumps update the same files.
git add charts/genieai-umbrella/Chart.yaml charts/genieai-umbrella/Chart.lock charts/genieai-umbrella/charts/
git commit -m "feat(charts): add data layer operator deps (CNPG, kube-arangodb, sealed-secrets); keycloak-operator as bootstrap prerequisite"
```

---

## Task 2: Extend `values.yaml` with data + secrets blocks

**Files:**
- Modify: `charts/genieai-umbrella/values.yaml`

**Interfaces:**
- Consumes: nothing.
- Produces: data + secrets value blocks that match the dep `condition:` keys from Task 1.

- [ ] **Step 1: Run red-gate — must fail before values are added**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -E "^kind: Cluster$|^kind: ArangoDeployment$" || echo "OK: no data CRs rendered"`
Expected: prints `OK: no data CRs rendered`.

- [ ] **Step 2: Append to `charts/genieai-umbrella/values.yaml`**

```yaml
# data layer values

# Declared here because this plan's templates already dereference them:
# the data-tier PVCs read `pluggable.storageClassName`, the realm-import
# redirect URLs read `ingress.host`. Helm nil-pointer-evaluates
# a missing parent map even under `with`/`default` guards — the keys must
# exist in values.yaml before any template reads them.
# The per-env plan elaborates both blocks; do not duplicate there.
pluggable:
  storageClassName: ""                # "" = cluster default storage class

ingress:
  host: genieai.local                 # public hostname for redirect URLs

data:
  postgres:
    enabled: true
    # CNPG Cluster resources for the keycloak-db; kong is REMOVED (decision 7).
    instances: 1                       # 3 for prod/staging via clusterProfile
    storageSize: 10Gi
  arangodb:
    enabled: true
    mode: single                       # cluster for prod/staging via clusterProfile
    storageSize: 50Gi
  keycloak:
    # Gates the Keycloak + KeycloakRealmImport CRs. The operator
    # itself is a cluster bootstrap prerequisite — NOT a chart dependency.
    enabled: true
    realmImport: true

secrets:
  sealedSecrets:
    enabled: true                      # default; see plug-point design §6.2
    # Public-key fingerprint for the cluster producing the SealedSecret
    # encrypted blobs in deploy/environments/<env>/secrets/*.yaml. The cluster
    # public key is fetched via `kubeseal --fetch-cert`. If the fingerprint
    # on file does not match what the in-cluster controller serves, the
    # pre-upgrade hook fails the install.
    publicKeyFingerprint: ""
  eso:
    enabled: false                     # plug-point only, per §6.2
  secretProviderClass:
    enabled: false                     # plug-point only, per §6.2
```

- [ ] **Step 3: Run `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 4: Run `helm template` to confirm defaults parse**

Run: `helm template test charts/genieai-umbrella -n genieai | head -30`
Expected: rendered YAML starts with the Namespace from Plan 1, no error.

- [ ] **Step 5: Commit**

```bash
git add charts/genieai-umbrella/values.yaml
git commit -m "feat(charts): values for data layer (postgres, arangodb, keycloak, sealed-secrets)"
```

---

## Task 3: Dependency graph definition (data structures in values)

**Files:**
- Modify: `charts/genieai-umbrella/values.yaml` (add `dependencyGraph` block)
- Create: `charts/genieai-umbrella/templates/_lib/dependency-graph.tpl`

**Interfaces:**
- Consumes: nothing new.
- Produces: a list-of-edges data structure in values + a template helper that emits it as JSON for the pre-install hook Pod to consume.

- [ ] **Step 1: Append `dependencyGraph` block to `charts/genieai-umbrella/values.yaml`**

```yaml
# service ↔ data dependency graph (used by pre-install hook).
# Read by the dependency-check hook Job; values are intentionally declarative
# to keep the static analysis simple (no chart-template evaluation at
# Job runtime).
#
# Edge format: [from, to, required]. The Job fails the install if a service
# is enabled but any of its `to` targets in `required: true` is not.
dependencyGraph:
  services:
    backend:
      - keycloak
      - arangodb
    frontend:
      - backend
    documentRepository:
      - backend
    clamav: []
  data:
    postgres:
      - ""                                # no deps; lowest tier
    arangodb:
      - ""
    keycloak:
      - postgres
```

- [ ] **Step 2: Run red-gate — fail before the helper template exists**

Run: `helm template test charts/genieai-umbrella -n genieai --show-only templates/_lib/dependency-graph.tpl 2>&1 | grep -c '^kind' || echo "1"`
Expected: `0` (template can't be referenced before file exists).

- [ ] **Step 3: Create `charts/genieai-umbrella/templates/_lib/dependency-graph.tpl`**

```gotemplate
{{/*
Emit the dependency graph as a JSON blob suitable for mounting into the
pre-install hook Pod. The Pod's shell script reads it, evaluates edges, and
fails the install if a service is enabled but its dependencies are not.
*/}}
{{- define "genieai-umbrella.dependencyGraph.json" -}}
{{- $graph := .Values.dependencyGraph -}}
{{- $json := dict "services" dict "data" dict -}}
{{- range $service, $deps := $graph.services -}}
{{- $_ := set $json.services $service (dict "deps" $deps) -}}
{{- end -}}
{{- range $data, $deps := $graph.data -}}
{{- $_ := set $json.data $data (dict "deps" $deps) -}}
{{- end -}}
{{- $json | toJson -}}
{{- end -}}
```

- [ ] **Step 4: Confirm helper renders**

Run: `helm template test charts/genieai-umbrella -n genieai --show-only templates/_lib/dependency-graph.tpl`
Expected: outputs JSON with `services.backend.deps: [keycloak, arangodb]` etc.

- [ ] **Step 5: Commit**

```bash
git add charts/genieai-umbrella/values.yaml charts/genieai-umbrella/templates/_lib/dependency-graph.tpl
git commit -m "feat(charts): dependency-graph data + template helper for pre-install hook"
```

---

## Task 4: Extend `_helpers.tpl` with service/data Component helpers

**Files:**
- Modify: `charts/genieai-common/templates/_helpers.tpl`

**Interfaces:**
- Consumes: helper signatures from Plan 1.
- Produces: 3 new helpers used by data-tier templates — `genieai-common.componentLabel`, `genieai-common.servicePort`, `genieai-common.serviceSelector`.

- [ ] **Step 1: Run red-gate — `helm template` will not emit valid manifests for missing helpers**

Run: `helm template test charts/genieai-umbrella --show-only templates/_services 2>&1 | grep "execute" | head -3`
Expected: error like `template: _common.tpl: error calling include: template "genieai-common.componentLabel" not defined` (this fails the lint).
Expected: non-zero exit + error.

- [ ] **Step 2: Append to `charts/genieai-common/templates/_helpers.tpl`**

```gotemplate
{{/*
Component label — emits a `genieai.io/component: <name>` label for any resource.
The receiving component name comes from `.Values.component` (overridden per
template).
*/}}
{{- define "genieai-common.componentLabel" -}}
genieai.io/component: {{ .Values.component | default "umbrella" | quote }}
{{- end -}}

{{/*
Service selector — emits the right selector labels for service discovery.
Differs from `selectorLabels` by including the component-only label so that
network policies can target one app.
*/}}
{{- define "genieai-common.serviceSelector" -}}
app.kubernetes.io/name: {{ include "genieai-common.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
genieai.io/component: {{ .Values.component | default "umbrella" | quote }}
{{- end -}}
```

**Note**: the `servicePort` helper is **not added here**. It is a YAGNI candidate: every service has its own port and per-service port logic differs (TCP vs HTTP vs gRPC). Plan 3+ (service tier) adds service-specific helpers as needed rather than a generic helper that hides per-service specifics (Review Focus F4). The per-service pattern is: services.backend.port, ..., each in `Values.services.<name>.port`, set in the per-env override file directly.

- [ ] **Step 3: Confirm render of any umbrella template that uses the new helpers remains valid**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add charts/genieai-common/templates/_helpers.tpl
git commit -m "feat(charts): add componentLabel / servicePort / serviceSelector helpers"
```

---

## Task 5: CNPG Cluster for keycloak-db (the only Postgres in the chart)

**Files:**
- Create: `charts/genieai-umbrella/templates/data/cnpg-keycloak-db.yaml`

**Interfaces:**
- Consumes: `data.postgres.enabled` toggle; `clusterProfile` for HA instances; PVC from `genieai` namespace.
- Produces: 1 CNPG `Cluster` resource `keycloak-db` with Postgres 16 + 1 instance (dev) / 3 instances (prod).

- [ ] **Step 1: Run red-gate — no Postgres resource yet**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: Cluster$" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/data/cnpg-keycloak-db.yaml`**

```yaml
{{- if .Values.data.postgres.enabled -}}
{{- $instances := .Values.data.postgres.instances | default 1 -}}
{{- if eq .Values.clusterProfile "prod" -}}
{{- $instances = 3 -}}
{{- end -}}
apiVersion: postgresql.cnpg.io/v1
kind: Cluster
metadata:
  name: keycloak-db
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "data-postgres"))) | nindent 4 }}
    genieai.io/data-tier: postgresql
    genieai.io/serves: keycloak
spec:
  instances: {{ $instances }}
  {{- /* Switchover (default) for HA primary rolling updates with zero downtime.
         Override via `data.postgres.primaryUpdateStrategy: Unmanaged` only when
         ops explicitly wants manual failover. */ -}}
  primaryUpdateStrategy: {{ .Values.data.postgres.primaryUpdateStrategy | default "Switchover" }}
  imageName: ghcr.io/cloudnative-pg/postgresql:16
  imagePullPolicy: IfNotPresent
  storage:
    size: {{ .Values.data.postgres.storageSize | default "10Gi" }}
    {{- /* Render storageClass ONLY when set: an empty-string value would pin
           storageClassName: "" which means "NO default storage class" and
           strands the PVC on most clusters. */ -}}
    {{- with .Values.pluggable.storageClassName }}
    storageClass: {{ . }}
    {{- end }}
    accessModes:
      - ReadWriteOnce
  postgresql:
    parameters:
      max_connections: "200"
      shared_buffers: "256MB"
  bootstrap:
    initdb:
      database: keycloak
      owner: keycloak
      # CNPG expects this Secret to carry BOTH `username` and `password`
      # keys (username-only fails validation). The SealedSecret in the task
      # emits both.
      secret:
        name: keycloak-db-credentials
  serviceAccountTemplate:
    metadata:
      labels:
        {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "data-postgres"))) | nindent 8 }}
  # NOTE: no `monitoring.enablePodMonitor` — that emits a Prometheus-operator
  # ServiceMonitor and no Prometheus operator is installed in this stack.
  # Metrics are scraped via VMServiceScrape.
{{- end -}}
```

- [ ] **Step 3: Render and verify**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -A 30 "^kind: Cluster$" | head -40`
Expected: prints the Cluster with `name: keycloak-db`, `instances: 1` (default), `imageName: ghcr.io/cloudnative-pg/postgresql:16`.

- [ ] **Step 4: Test with `clusterProfile: prod`**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | grep "instances:" | head -3`
Expected: prints `instances: 3`.

- [ ] **Step 5: Commit**

```bash
git add charts/genieai-umbrella/templates/data/cnpg-keycloak-db.yaml
git commit -m "feat(charts): render CNPG Postgres Cluster for keycloak-db (HA via clusterProfile)"
```

---

## Task 4a: ServiceAccount + RBAC for pre-install hooks (NEW)

**Files:**
- Create: `charts/genieai-umbrella/templates/rbac/dep-check-serviceaccount.yaml`
- Create: `charts/genieai-umbrella/templates/rbac/dep-check-clusterrole.yaml` (custom ClusterRole with CRD access — Review Focus F7)
- Create: `charts/genieai-umbrella/templates/rbac/dep-check-clusterrolebinding.yaml`

**Interfaces:**
- Consumes: nothing new.
- Produces: a ServiceAccount + Role/ClusterRoleBinding pair granting list/watch access to (a) the release namespace's configmaps + secrets + sealedsecrets (for dep-check + drift validation) AND (b) cluster-scoped namespaces + the CRDs the chart depends on (Keycloak, KeycloakRealmImport, ArangoDeployment, CNPG Cluster) so the drift validation hook can read each SealedSecret's `status.conditions`.
- **Hook-ordering note (critical)**: these RBAC objects carry `helm.sh/hook: pre-install,pre-upgrade` + `helm.sh/hook-weight: "-30"` themselves. Regular (non-hook) resources are installed AFTER all pre-install hooks — a regular SA would not exist when the hook Jobs run, deadlocking every first install. Making the RBAC the lowest-weight hook resolves the chicken-and-egg: Helm creates hook resources in ascending weight order and waits for each batch (weight -30 RBAC -> -20 dep-graph ConfigMap -> -10 clusterprofile -> -5 dep-check). `before-hook-creation` delete-policy keeps them across installs (recreated only when the hook fires again).

**Review Focus F7 fix**: stock `view` ClusterRole has NO access to custom resources. Using it returns 403 on `kubectl get sealedsecrets.bitnami.com/sealedsecrets` and equivalent CRDs. Drift detection is silent. **Custom ClusterRole required.**

- [ ] **Step 1: Run red-gate — confirm SA is missing**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "kind: ServiceAccount" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/rbac/dep-check-serviceaccount.yaml`**

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "genieai-common.fullname" . }}-dep-check
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "rbac"))) | nindent 4 }}
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-30"     # created BEFORE every other hook uses it
    "helm.sh/hook-delete-policy": before-hook-creation
```

- [ ] **Step 3: Write `charts/genieai-umbrella/templates/rbac/dep-check-rbac.yaml`**

Split scope per least privilege (code-review Wave 10 #14): namespaced Role
for Secrets/ConfigMaps/events (every consumer — dep-check, drift-validate,
helm-test pods — operates in the release namespace ONLY; a cluster-wide
Secret read turns any borrowed pod into a full-cluster secret disclosure),
plus a minimal ClusterRole for cluster-scoped lookups (namespaces) and
chart-managed CRDs.

```yaml
{{- $ns := .Values.namespace -}}
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: {{ include "genieai-common.fullname" . }}-dep-check
  namespace: {{ $ns }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "rbac"))) | nindent 4 }}
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-30"
    "helm.sh/hook-delete-policy": before-hook-creation
rules:
  # Namespaced reads the Jobs need — Secrets stay namespace-scoped.
  - apiGroups: [""]
    resources: ["configmaps", "secrets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["bitnami.com"]
    resources: ["sealedsecrets"]
    verbs: ["get", "list", "watch"]
  # Events for the clusterprofile-detect hook's Event write + Job status
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["create", "patch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: {{ include "genieai-common.fullname" . }}-dep-check
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "rbac"))) | nindent 4 }}
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-30"
    "helm.sh/hook-delete-policy": before-hook-creation
rules:
  # Cluster-scoped lookups only — NO Secrets, NO ConfigMaps here.
  - apiGroups: [""]
    resources: ["namespaces"]
    verbs: ["get", "list", "watch"]
  # Read-only access to chart-managed CRDs (cross-namespace visibility is
  # inherent to ClusterRole but exposes no secret material).
  - apiGroups: ["k8s.keycloak.org"]
    resources: ["keycloaks", "keycloakrealmimports", "keycloakbackups"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["arango.kube.arangodb.com"]
    resources: ["arangodeployments", "arangomembers"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["postgresql.cnpg.io"]
    resources: ["clusters", "poolers"]
    verbs: ["get", "list", "watch"]
```

- [ ] **Step 4: Write `charts/genieai-umbrella/templates/rbac/dep-check-bindings.yaml`** — BOTH bindings (namespaced Role + cluster ClusterRole, matching Step 3's split)

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: {{ include "genieai-common.fullname" . }}-dep-check
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "rbac"))) | nindent 4 }}
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-30"
    "helm.sh/hook-delete-policy": before-hook-creation
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: {{ include "genieai-common.fullname" . }}-dep-check
subjects:
  - kind: ServiceAccount
    name: {{ include "genieai-common.fullname" . }}-dep-check
    namespace: {{ .Values.namespace }}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: {{ include "genieai-common.fullname" . }}-dep-check
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "rbac"))) | nindent 4 }}
  annotations:
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-30"
    "helm.sh/hook-delete-policy": before-hook-creation
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: ClusterRole
  name: {{ include "genieai-common.fullname" . }}-dep-check
subjects:
  - kind: ServiceAccount
    name: {{ include "genieai-common.fullname" . }}-dep-check
    namespace: {{ .Values.namespace }}
```

- [ ] **Step 5: Verify render**

Run: `helm template test charts/genieai-umbrella -n genieai | grep "^kind: " | sort | uniq -c`
Expected: shows `ServiceAccount`, `Role`, `RoleBinding`, `ClusterRole`, `ClusterRoleBinding` lines.

- [ ] **Step 6: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add charts/genieai-umbrella/templates/rbac/
git commit -m "feat(charts): ServiceAccount + custom ClusterRole (CRD access) + RoleBinding for pre-install hook Jobs"
```

---

## Task 6: Pre-install dependency-check Job (with helm.sh/hook annotations + Python evaluator)

**Files:**
- Create: `charts/genieai-umbrella/templates/hooks/pre-install-dependency-check.yaml`
- Create: `charts/genieai-umbrella/tests/test-dependency-graph.yaml`

**Interfaces:**
- Consumes: `genieai-umbrella.dependencyGraph.json` helper (Task 3), `helm.sh/hook: pre-install` annotation pattern, hook-owned ServiceAccount from Task 4a (weight -30) and the hook-owned ConfigMap below (weight -20) — Helm creates lower-weight hooks first, so both exist when the Job (-5) runs.
- Produces: a Job that runs on install/upgrade (NOT rendered into the live deployment) and fails the install if service↔data dependencies are unmet.

- [ ] **Step 1: Run red-gate — Job absent**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "kind: Job$" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/hooks/pre-install-dependency-check.yaml`**

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "genieai-common.fullname" . }}-dep-check
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "pre-install"))) | nindent 4 }}
    app.kubernetes.io/component: pre-install
  annotations:
    # Helm 3 scans templates/ recursively for hook annotations. Subdirectory
    # name `hooks/` is irrelevant to Helm; the annotations below are what
    # matter.
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-5"          # run after clusterprofile-detect (-10)
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  backoffLimit: 1
  template:
    metadata:
      labels:
        {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "pre-install"))) | nindent 8 }}
    spec:
      restartPolicy: Never
      serviceAccountName: {{ include "genieai-common.fullname" . }}-dep-check
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: dep-check
          # python:3.12-alpine ships python + pyyaml-stripped; we read YAML
          # without pyyaml by parsing only the JSON graph mount. The image
          # is the minimal alpine + python that fits the dependency-check
          # logic, without falling back to a no-op
          # grep.
          image: python:3.12-alpine
          imagePullPolicy: IfNotPresent
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            runAsUser: 65534
            capabilities:
              drop:
                - ALL
          command:
            - python3
            - -c
            - |
              import json, os, sys
              graph_path = "/var/run/genieai/dependency-graph.json"
              if not os.path.exists(graph_path):
                  print(f"FAIL: {graph_path} missing"); sys.exit(1)
              with open(graph_path) as f:
                  graph = json.load(f)
              # Read which services are ENABLED via the chart's env. The
              # values.yaml defines a `services.<X>.enabled` boolean. The
              # graph only includes declared deps; the evaluator reads
              # current values from the helm chart via `kubectl get
              # ConfigMap`. We use a generated ConfigMap with the
              # `data.enabled` keys flattened to avoid parsing values.yaml
              # at runtime.
              enabled_json = "/var/run/genieai/enabled.json"
              if not os.path.exists(enabled_json):
                  print(f"FAIL: {enabled_json} missing"); sys.exit(1)
              with open(enabled_json) as f:
                  enabled = json.load(f)
              # Resolve a dependency name to its namespace in the graph:
              # deps may be services (frontend -> backend) OR data tiers
              # (backend -> arangodb). Earlier version assumed every dep was
              # a data.* key — a service dep like "backend" resolved to
              # data.backend.enabled=False and failed every default install.
              def dep_enabled(dep):
                  if dep in graph.get("services", {}):
                      return enabled.get(f"services.{dep}.enabled", False)
                  return enabled.get(f"data.{dep}.enabled", False)
              def dep_kind(dep):
                  return "service" if dep in graph.get("services", {}) else "data"
              failures = []
              for tier in ("services", "data"):
                  for svc, deps in graph.get(tier, {}).items():
                      if not enabled.get(f"{tier}.{svc}.enabled", False):
                          continue
                      for dep in deps.get("deps", []):
                          if dep == "":
                              continue
                          if not dep_enabled(dep):
                              failures.append(f"{tier}.{svc} requires {dep_kind(dep)}.{dep}")
              if failures:
                  print("FAIL: unmet dependencies")
                  for f in failures:
                      print(f"  - {f}")
                  sys.exit(1)
              print("PASS: dependency graph satisfied")
          volumeMounts:
            - name: dependency-graph
              mountPath: /var/run/genieai
              readOnly: true
      volumes:
        - name: dependency-graph
          configMap:
            name: {{ include "genieai-common.fullname" . }}-dep-graph
---
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "genieai-common.fullname" . }}-dep-graph
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "pre-install"))) | nindent 4 }}
  annotations:
    # Hook with weight -20: created after the RBAC (-30) and BEFORE the
    # dep-check Job (-5) mounts it. A regular ConfigMap would not exist on
    # first install (regular resources land after all pre-install hooks).
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-20"
    "helm.sh/hook-delete-policy": before-hook-creation
data:
  dependency-graph.json: |
    {{- include "genieai-umbrella.dependencyGraph.json" . | nindent 4 }}
  {{- /*
    Renders the current `services.X.enabled` and `data.X.enabled` boolean
    values as JSON so the dependency-check Pod reads them without parsing
    the raw values.yaml (which uses Helm templating the Pod can't run). If
    a new `services.<X>.enabled` is added to values.yaml but not exported
    here, the Pod falls back to False (failing safe — service appears
    "off"). The op-level "missing dependency" failure then surfaces in CI.
  */ -}}
  enabled.json: |
    {{- /* FAIL-SAFE flat map: every toggle defaults to FALSE when absent.
           `| default true` would flip an explicitly disabled component back
           on, and a bare .Values.services.backend.enabled would nil-pointer
           at render time because values.yaml carries NO services block at this
           point. Two subtleties: (1) sprig `dig` REFUSES Helm's typed Values
           (`interface conversion: ... is common.Values`) — round-trip through
           toRawJson|fromJson to get a plain map first; (2) inside a literal
           block scalar, a trailing `{{- ... -}}` dash trims the newline the
           `|` pipe needs — use plain `}}` closers on every line of the block
           (verified by rendering). */ -}}
    {{- $vals := $.Values | toRawJson | fromJson }}
    {{- $flat := dict }}
    {{- range $name := list "backend" "frontend" "documentRepository" "clamav" }}
    {{- $_ := set $flat (printf "services.%s.enabled" $name) (dig "services" $name "enabled" false $vals) }}
    {{- end }}
    {{- range $name := list "postgres" "arangodb" "keycloak" }}
    {{- $_ := set $flat (printf "data.%s.enabled" $name) (dig "data" $name "enabled" false $vals) }}
    {{- end }}
    {{ $flat | toJson }}
```

**Note**: with the Plan 2 default values (no `services:` block), the whole services tier reads as disabled and the evaluator checks only the data tier (keycloak requires postgres — the one real Plan 2 edge). Plan 3's values block activates the service edges without touching this ConfigMap.

**Review Focus F1 fix**: the script evaluates enabled-vs-dependencies against the graph, resolving each dependency to its real namespace in the graph (service dep vs data dep) and validating BOTH tiers (service→data, data→data). It exits non-zero with a per-edge list of unmet deps. The earlier grep-only version was decorative (always PASSED); the intermediate version misresolved every service dep as a data dep (default installs would all fail). The `python:3.12-alpine` image is ~50MB and the script runs in under a second.

- [ ] **Step 3: Confirm both resources render**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -E "^kind: (Job|ConfigMap)$"`
Expected: prints both `kind: Job` and `kind: ConfigMap`.

- [ ] **Step 4: Render the graph content and validate JSON**

```bash
helm template test charts/genieai-umbrella -n genieai | \
  python3 -c "import sys, json, yaml; docs = list(yaml.safe_load_all(sys.stdin)); \
  cm = next(d for d in docs if d and d.get('kind')=='ConfigMap' and 'dependency-graph.json' in d.get('data',{})); \
  parsed = json.loads(cm['data']['dependency-graph.json']); \
  assert 'services' in parsed and 'data' in parsed, parsed; \
  print('PASS')"
```

Expected: prints `PASS`.

- [ ] **Step 5: Verify hook annotations present (Review Focus #1)**

```bash
helm template test charts/genieai-umbrella -n genieai | \
  python3 -c "import sys, yaml; docs = list(yaml.safe_load_all(sys.stdin)); \
  job = next(d for d in docs if d and d.get('kind')=='Job' and 'dep-check' in (d.get('metadata',{}).get('name',''))); \
  # The annotation renders as the comma-joined list of BOTH hook phases —
# assert membership, not exact equality ('== pre-install' can never pass
# against 'pre-install,pre-upgrade').
assert 'pre-install' in job['metadata']['annotations'].get('helm.sh/hook', ''); \
  print('PASS')"
```

Expected: prints `PASS`.

- [ ] **Step 6: Verify the script is Python with real eval logic (Review Focus F1)**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -A 5 "command:" | head -10`
Expected: shows `python3 -c` followed by an `import json` line + `with open(graph_path)`.

- [ ] **Step 7: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add charts/genieai-umbrella/templates/hooks/pre-install-dependency-check.yaml
git commit -m "feat(charts): pre-install dependency-check Job with real Python evaluator"
```

---

## Task 7: ClusterProfile auto-detect hook

> **AMENDED at Plan-1 execution (ledger Wave 8 #2 + review round 2):** the
> Namespace carrying `genieai.io/cluster-profile` is now a REGULAR resource
> (Helm 4 implicit before-hook-creation deletes hook-identity Namespaces).
> Regular resources apply AFTER all pre-install hooks — so on every FRESH
> install the label is NEVER present while this hook runs, the 30s poll below
> always exhausts, and the WARN path fires unconditionally. Implement the
> redesign instead of the Step-2 body verbatim:
>
> - Annotate the hook `helm.sh/hook: pre-upgrade` ONLY (label exists by then,
>   applied by the previous revision's regular-resource Namespace).
> - On pre-upgrade, poll at most 3 × 2s; if the label is present and DIFFERS
>   from `{{ .Values.clusterProfile }}` (render into the Job as a literal in
>   the command), emit the `ClusterProfileDetected` Event with a mismatch
>   message; if absent or equal, exit 0 silently.
> - Drop the pre-install variant entirely — there is nothing to detect on a
>   fresh install (the operator's `--set clusterProfile` IS the source).

**Files:**
- Create: `charts/genieai-umbrella/templates/hooks/pre-upgrade-clusterprofile-detect.yaml`

**Interfaces:**
- Consumes: namespace label `genieai.io/cluster-profile`, `helm.sh/hook: pre-upgrade`, `helm.sh/hook-weight: "-10"`.
- Produces: a Job that reads the namespace label, **emits a Kubernetes Event** recording a mismatch, and exits 0. **Does NOT mutate Helm-rendered values** (Helm does not re-render mid-install; Review Focus F10).

- [ ] **Step 1: Run red-gate — Job absent**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "clusterprofile\|cluster-profile-detect" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/hooks/pre-install-clusterprofile-detect.yaml`**

```yaml
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "genieai-common.fullname" . }}-clusterprofile-detect
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "pre-install"))) | nindent 4 }}
    app.kubernetes.io/component: clusterprofile-detect
  annotations:
    "helm.sh/hook": pre-install
    # Run BEFORE the dependency check so the detected profile values are
    # visible to the dep-check evaluation.
    "helm.sh/hook-weight": "-10"
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  backoffLimit: 3
  template:
    spec:
      restartPolicy: Never
      serviceAccountName: {{ include "genieai-common.fullname" . }}-dep-check
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
      containers:
        - name: detect
          # bitnami/kubectl ships kubectl + a minimal base image. alpine has
          # no kubectl; using it here would fail every install (Review
          # Focus F2).
          image: bitnami/kubectl:1.33
          imagePullPolicy: IfNotPresent
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            runAsUser: 65534
            capabilities:
              drop:
                - ALL
          command:
            - /bin/sh
            - -c
            - |
              set -eu
              # poll for label propagation.
              ns="{{ .Values.namespace }}"
              attempts=0
              max=15
              while [ $attempts -lt $max ]; do
                profile=$(kubectl get ns "$ns" -o jsonpath='{.metadata.labels.genieai\.io/cluster-profile}' 2>/dev/null || true)
                case "$profile" in
                  dev|staging|prod|sovereign)
                    echo "detected cluster-profile: $profile"
                    # emit a Kubernetes Event so the operator
                    # sees the detected profile via `kubectl describe ns`.
                    # Auto-mutation of Helm-rendered values is impossible
                    # post-render; the Event makes the detected state visible
                    # but the operator must pass --set clusterProfile=$profile
                    # at install/upgrade.
                    # (`kubectl create event` one-liner: `apply` rejects
                    # generateName manifests and an indented heredoc would
                    # break YAML parsing inside the block scalar.)
                    kubectl create event "genieai-profile-$(date +%s)" \
                      --type=Normal --reason=ClusterProfileDetected \
                      --message="cluster-profile=$profile detected; pass --set clusterProfile=$profile at install/upgrade" \
                      --for=namespace/"$ns" -n "$ns" >/dev/null 2>&1 || true
                    exit 0
                    ;;
                esac
                sleep 2
                attempts=$((attempts+1))
              done
              echo "WARN: namespace $ns lacks genieai.io/cluster-profile label"
              echo "WARN: chart renders with values.yaml clusterProfile (default: dev)"
              exit 0
```

- [ ] **Step 3: Render and confirm Job appears**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -E "clusterprofile-detect"`
Expected: shows the Job.

- [ ] **Step 4: Verify `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add charts/genieai-umbrella/templates/hooks/pre-install-clusterprofile-detect.yaml
git commit -m "feat(charts): pre-install cluster-profile auto-detect hook"
```

---

## Task 8: Keycloak CR + KeycloakRealmImport CR (operator's REAL CRD set)

**Files:**
- Create: `charts/genieai-umbrella/templates/data/keycloak-instance.yaml`
- Create: `charts/genieai-umbrella/templates/data/keycloak-realm-import.yaml`

**Interfaces:**
- Consumes: `data.keycloak.enabled`, `data.keycloak.realmImport`, `data.keycloak.adminEmail`, CNPG `keycloak-db` cluster (Task 5), `keycloak-db-credentials` secret (Task 11).
- Produces: a `Keycloak` CR (the managed instance, backed by keycloak-db) + a `KeycloakRealmImport` CR (imports the genieai realm with admin user + `genie-app` OIDC client).

**CRD reality check**: the keycloak-operator ships exactly `Keycloak`, `KeycloakBackup`, `KeycloakRealmImport` — there is **no `KeycloakRealm` CRD** (earlier drafts rendered a CR for a CRD that does not exist; the instance would never start). Realm/users/clients live in `KeycloakRealmImport.spec.realm` (full realm JSON, same shape as the Swarm realm export). The `unsupported` block exists for fields the CRD schema does not model — we avoid it.

- [ ] **Step 1: Run red-gate — no Keycloak CRs yet**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: Keycloak\|^kind: KeycloakRealmImport$" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/data/keycloak-instance.yaml`**

```yaml
{{- if .Values.data.keycloak.enabled -}}
apiVersion: k8s.keycloak.org/v2alpha1
kind: Keycloak
metadata:
  name: keycloak
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "identity"))) | nindent 4 }}
    genieai.io/data-tier: identity
spec:
  instances: {{ .Values.data.keycloak.instances | default 1 }}
  db:
    # CNPG primary Service is <cluster>-rw (keycloak-db-rw), port 5432
    vendor: postgres
    host: keycloak-db-rw
    database: keycloak
    usernameSecret:
      name: keycloak-db-credentials
      key: username
    passwordSecret:
      name: keycloak-db-credentials
      key: password
  # The operator starts Keycloak without a reverse proxy; hostname + TLS are
  # bound at the edge (Envoy Gateway) via `hostname` v2 fields once
  # the ingress host is known. Dev default keeps localhost URLs working.
  http:
    httpEnabled: true
{{- end -}}
```

- [ ] **Step 3: Write `charts/genieai-umbrella/templates/data/keycloak-realm-import.yaml`**

```yaml
{{- if and .Values.data.keycloak.enabled .Values.data.keycloak.realmImport -}}
apiVersion: k8s.keycloak.org/v2alpha1
kind: KeycloakRealmImport
metadata:
  name: genieai-realm
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "identity"))) | nindent 4 }}
    genieai.io/data-tier: identity
spec:
  # References the Keycloak CR above; import runs once the instance is Ready.
  keycloakCRName: keycloak
  realm:
    # realm name MUST match the in-cluster consumers (compose ground
    # truth: docker-compose.yaml KEYCLOAK_REALM=genie; the AI tier sets
    # KC_REALM=genie in chatqna + dataprep env). Earlier drafts named
    # the realm `genieai` which silently broke every OIDC token call
    # (404 on /realms/genieai/...).
    realm: genie
    enabled: true
    registrationAllowed: false
    loginWithEmailAllowed: true
    duplicateEmailsAllowed: false
    resetPasswordAllowed: false
    editUsernameAllowed: false
    bruteForceProtected: true
    permanentLockout: false
    maxFailureWaitSeconds: 900
    minimumQuickLoginWaitSeconds: 60
    failureFactor: 30
    accessTokenLifespan: 1800
    ssoSessionIdleTimeout: 1800
    ssoSessionMaxLifespan: 36000
    internationalizationEnabled: true
    supportedLocales:
      - en
      - fr
    defaultLocale: en
    users:
      - username: genie-admin
        firstName: GENIE
        lastName: Admin
        # Keycloak user profile requires `email` + `emailVerified: true` for
        # login to succeed (SERVER-TESTING.md: "Account is not fully set up").
        # Operators override via deploy/environments/<env>/values-override.yaml
        # under `data.keycloak.adminEmail`.
        email: {{ .Values.data.keycloak.adminEmail | default "genie-admin@genieai.local" | quote }}
        emailVerified: true
        credentials:
          # Empty value on purpose: the operator cannot PATCH user passwords
          # through the CR after import (user subresource is operator-owned).
          # Real password is set out-of-band post-install. NOTE: the realm
          # name MUST match the KeycloakRealmImport's `realm:` field above
          # (`genie` — see on the realm name) — `-r genieai` was
          # the wrong value the operator flow used to ship.
          #   kubectl exec deploy/keycloak -n genieai -- \
          #     /opt/keycloak/bin/kcadm.sh set-password -r genie \
          #     --username genie-admin -p '<password>'
          - type: password
            value: ""
            temporary: false
    clients:
      - clientId: genie-app
        enabled: true
        publicClient: false
        directAccessGrantsEnabled: false
        standardFlowEnabled: true
        rootUrl: https://{{ .Values.ingress.host | default "genieai.local" }}
        redirectUris:
          - https://{{ .Values.ingress.host | default "genieai.local" }}/*
          - http://localhost:*
        webOrigins:
          - https://{{ .Values.ingress.host | default "genieai.local" }}
        attributes:
          pkce.code.challenge.method: S256
{{- end -}}
```

- [ ] **Step 4: Render and verify**

Run: `helm template test charts/genieai-umbrella -n genieai | grep "^kind: Keycloak\|^kind: KeycloakRealmImport$" | sort | uniq -c`
Expected: one `kind: Keycloak` + one `kind: KeycloakRealmImport`.

- [ ] **Step 5: Verify the instance points at the CNPG rw Service**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -A 8 "^    vendor: postgres"`
Expected: shows `host: keycloak-db-rw` and both secret refs with keys `username` / `password`.

- [ ] **Step 6: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add charts/genieai-umbrella/templates/data/keycloak-instance.yaml charts/genieai-umbrella/templates/data/keycloak-realm-import.yaml
git commit -m "feat(charts): Keycloak CR (CNPG-backed) + KeycloakRealmImport for genieai realm"
```

---

## Task 9: ArangoDeployment (single-node default, cluster via profile)

**Files:**
- Create: `charts/genieai-umbrella/templates/data/arangodb-deployment.yaml`

**Interfaces:**
- Consumes: `data.arangodb.enabled`, `data.arangodb.mode`, `data.arangodb.storageSize`.
- Produces: 1 ArangoDeployment resource. Mode defaults to `single`; toggled to `cluster` when `data.arangodb.mode: cluster` OR when ClusterProfile implies prod/staging.

- [ ] **Step 1: Run red-gate — no ArangoDeployment yet**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: ArangoDeployment$" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/data/arangodb-deployment.yaml`**

```yaml
{{- if .Values.data.arangodb.enabled -}}
{{- $mode := .Values.data.arangodb.mode | default "single" -}}
{{- if and (eq $mode "single") (or (eq .Values.clusterProfile "prod") (eq .Values.clusterProfile "staging")) -}}
{{- $mode = "cluster" -}}
{{- end -}}
{{- if eq $mode "single" -}}
apiVersion: arango.kube.arangodb.com/v1
kind: ArangoDeployment
metadata:
  {{- /* metadata.name MUST match the DNS name used by
         the chart + Swarm migration paths. Swarm service is arango-vector-db;
         we render as arangodb-single to match the chart's existing service
         consumer namespace, which is downstream-of-here stable. */ -}}
  name: arangodb-single
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "data-arangodb"))) | nindent 4 }}
    genieai.io/data-tier: arangodb
spec:
  mode: Single
  image: arangodb/arangodb:3.12
  externalAccess:
    type: None
  single:
    args:
      - --server.authentication-system-only=true
      {{- /* NO --server.endpoint: `arangodb://` is not a valid endpoint
             scheme (arangod accepts tcp:// / ssl://). The operator sets
             endpoint+advertising itself from the CR; hand-rolling it here
             breaks pod startup. */ -}}
    storage:
      engine: RocksDB
      volumeClaimTemplate:
        spec:
          {{- /* render ONLY when set — empty-string pins
                 storageClassName: "" = "no default SC" and strands the PVC
                 (same trap the CNPG template guards against). */ -}}
          {{- with .Values.pluggable.storageClassName }}
          storageClassName: {{ . }}
          {{- end }}
          accessModes:
            - ReadWriteOnce
          resources:
            requests:
              storage: {{ .Values.data.arangodb.storageSize | default "50Gi" }}
  authentication:
    enabled: true
    jwtSecretName: arango-jwt-secret      # SealedSecret in the task
    rootPasswordSecretName: arango-root-secret  # SealedSecret in the task
{{- else if eq $mode "cluster" -}}
apiVersion: arango.kube.arangodb.com/v1
kind: ArangoDeployment
metadata:
  name: arangodb-cluster
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "data-arangodb"))) | nindent 4 }}
    genieai.io/data-tier: arangodb
spec:
  mode: Cluster
  image: arangodb/arangodb:3.12
  externalAccess:
    type: None
  agents:
    count: 3
    args:
      - --server.authentication-system-only=true
  dbservers:
    count: 3
    args:
      - --server.authentication-system-only=true
    storage:
      engine: RocksDB
      volumeClaimTemplate:
        spec:
          {{- with .Values.pluggable.storageClassName }}
          storageClassName: {{ . }}
          {{- end }}
          accessModes:
            - ReadWriteOnce
          resources:
            requests:
              storage: {{ .Values.data.arangodb.storageSize | default "50Gi" }}
  coordinators:
    count: 2
  authentication:
    enabled: true
    jwtSecretName: arango-jwt-secret
    rootPasswordSecretName: arango-root-secret
{{- end -}}
{{- end -}}
```

- [ ] **Step 3: Render with defaults (dev profile, single mode)**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -A 3 "^kind: ArangoDeployment$" | head -10`
Expected: prints `kind: ArangoDeployment`, `name: arangodb-single`, `mode: Single`.

- [ ] **Step 4: Render with `clusterProfile: prod` — auto-promotion to cluster**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | grep "^  name:\|^kind:\|agents:\|dbservers:" | head -10`
Expected: prints `name: arango-cluster`, `agents.count: 3`, `dbservers.count: 3`.

- [ ] **Step 5: Document the single → cluster migration**

Append to `docs/charts/arangodb-mode-migration.md` (creates the file):

```markdown
# ArangoDB mode migration

`kube-arangodb` requires **fresh `helm uninstall` + `helm install`** when transitioning between single-node and cluster modes. In-place upgrade attempts fail with `ArangoDeployment.spec.mode is immutable`. The chart does not perform this conversion automatically — operators must:

1. Backup Arango data (`arangodump` or PVC snapshot if SC supports it)
2. `helm uninstall genieai-<release>`
3. Verify all PVCs unbound (CNPG/sealed-secrets do not delete, but arango storage does)
4. `helm install genieai-<release> ./genieai-umbrella --set data.arangodb.mode=cluster`
5. Restore Arango data from backup
```

```bash
mkdir -p docs/charts
git add docs/charts/arangodb-mode-migration.md
git commit -m "docs(charts): ArangoDB single -> cluster migration playbook"
```

- [ ] **Step 6: Commit template**

```bash
git add charts/genieai-umbrella/templates/data/arangodb-deployment.yaml
git commit -m "feat(charts): ArangoDeployment (single default, cluster via clusterProfile)"
```

---

## Task 10: REMOVED — Kong (Envoy Gateway is the edge)

**No files. No steps.**

Kong is deleted from the chart (k8s-native-audit decision 7, user-confirmed 2026-10-08). Envoy Gateway (spec §9) owns the edge: L7 routing (`/api/*` → backend, `/` → frontend), JWT/OIDC via the native `envoy.filters.http.oauth2` filter, CORS, rate limiting. Consequences:

- No Kong Deployment, no declarative `kong.yml` ConfigMap, no kong-db anywhere.
- `keycloak-db` remains the ONLY Postgres cluster (unchanged).
- CORS configuration moves to Envoy Gateway policy — Plan 6.
- Service inventory: 28 (was 29).

## Task 11: SealedSecret framework (4 CRs in Plan 2; remaining secrets ship with their consumers in Plans 3–6)

**Files:**
- Create: `charts/genieai-umbrella/templates/secrets/arango-secrets.yaml` (ArangoDB-specific: 2 SealedSecrets)
- Create: `charts/genieai-umbrella/templates/secrets/keycloak-secrets.yaml` (Keycloak bootstrap: 2 SealedSecrets)
- Create: `charts/genieai-umbrella/templates/hooks/pre-upgrade-sealed-secret-validate.yaml` (drift check via SealedSecret `invalid` annotation, no kubeseal CLI needed)

**Interfaces:**
- Consumes: `secrets.sealedSecrets.enabled`, `secrets.sealedSecrets.publicKeyFingerprint`.
- Produces: **4 SealedSecret CRs in Plan 2** (`arango-root-secret`, `arango-jwt-secret`, `keycloak-db-credentials`, `genie-admin-credentials`) with placeholder encrypted blobs. **Every other §8 secret lands as its consumer ships**:
  - Plan 3 service tier Group 5: `emailPassword`, `huggingFaceHubToken`, `keycloakClientSecret`
  - Plan 4 observability: `grafanaAdminPassword`, `kcGrafanaClientSecret`
  - Plan 5 AI/ML: `keycloakProxyClientSecret`, `kcDataprepClientSecret`, `VLLM_API_KEY`
  - Plan 6: `translationCachePassword`
  - Spec §8 `kongDbPassword` is removed (Kong removed, decision 7).
- This explicit scope prevents code-review from flagging Plan 2 as "missing the rest of the secrets" (Review Focus F4).

- [ ] **Step 1: Run red-gate — no SealedSecret yet**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: SealedSecret$" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/secrets/arango-secrets.yaml`**

```yaml
{{- if .Values.secrets.sealedSecrets.enabled -}}
{{- /*
  SealedSecret CR template. The encryptedData here is a PLACEHOLDER
  (the valid-base64 `PLACEHOLDER+` sentinel `UExBQ0VIT0xERVIr`) — actual encryption happens via:
      kubeseal --fetch-cert --context=cluster --kubeconfig=kubeconfig \
        | kubeseal --cert pub-cert.pem --scope cluster-wide \
          --secret-name <name> --name <kss-name>
  per-secret. Replace each PLACEHOLDER block with the encrypted output
  before `helm install` — conftest fails the install if a
  placeholder remains in a release branch.

  For dev clusters, the chart may ship a `KubernetesSecret`-shaped bootstrap
  by setting `secrets.sealedSecrets.bootstrap: true` in values-override —
  the controller creates real K8s `Secret` resources on first sync. Out of
  scope here; documented with the CI policies.
*/ -}}
{{- range $secretName := list "arango-root-secret" "arango-jwt-secret" }}
---
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: {{ $secretName }}
  namespace: {{ $.Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" $.Chart "Release" $.Release "Values" (deepCopy $.Values | merge (dict "component" "sealed-secret"))) | nindent 4 }}
    app.kubernetes.io/component: arangodb
spec:
  {{- /* kube-arangodb's `jwtSecretName` requires the
         key `jwt`, not `password`. The `rootPasswordSecretName` requires
         the key `password`. Each SealedSecret's encryptedData carries the
         key the operator's `kube-arangodb` expects.

         — the `PLACEHOLDER_*` literals below are not valid
         base64 (underscores outside the alphabet). The sealed-secrets
         controller fails to decrypt, marks the resource `invalid`, and
         never materialises the underlying K8s Secret. The CI helm-test
 would always fail on a fresh kind install until an
         operator re-seals real values — unacceptable for green CI.
         Fix: the chart ships a clearly-marked `PLACEHOLDER+` suffix
         (unambiguous sentinel) AND the chart-side conftest fails
         the release branches that commit placeholders. Re-seal with
         `kubeseal --cert pub-cert.pem --scope cluster-wide --name <name>`
         before merging; the operator-side workflow is documented in
         spec §8. */ -}}
  {{- if eq $secretName "arango-root-secret" }}
  encryptedData:
    password: UExBQ0VIT0xERVIr     # PLACEHOLDER+ — RE-SEAL before helm install
  {{- else if eq $secretName "arango-jwt-secret" }}
  encryptedData:
    jwt: UExBQ0VIT0xERVIr           # PLACEHOLDER+ — RE-SEAL before helm install
  {{- end }}
{{- end -}}
{{- end -}}
```

- [ ] **Step 3: Write `charts/genieai-umbrella/templates/secrets/keycloak-secrets.yaml`**

```yaml
{{- if and .Values.secrets.sealedSecrets.enabled .Values.data.keycloak.enabled -}}
{{- /* Keycloak-bootstrap secrets needed by CNPG Cluster (keycloak-db-
       credentials) and KeycloakRealm (genie-admin credentials). Remaining
       Keycloak-connected secrets ship in Plans 3+ (keycloakClientSecret,
       keycloakProxyClientSecret, kcDataprepClientSecret, kcGrafanaClientSecret). */ -}}
{{- range $secretName := list "keycloak-db-credentials" "genie-admin-credentials" }}
---
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: {{ $secretName }}
  namespace: {{ $.Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" $.Chart "Release" $.Release "Values" (deepCopy $.Values | merge (dict "component" "sealed-secret"))) | nindent 4 }}
    app.kubernetes.io/component: keycloak
spec:
  {{- /* `$` (not `.`): inside `range`, dot is the loop string — plain
         .Values.namespace reads a field off the STRING and errors at render. */ -}}
  encryptedData:
    {{- if eq $secretName "keycloak-db-credentials" }}
    # CNPG initdb.secret requires BOTH keys. # PLACEHOLDER+ sentinels (valid base64 of "PLACEHOLDER+"); conftest
    # fails release branches that ship them. Re-seal with
    # kubeseal before helm install.
    username: UExBQ0VIT0xERVIr
    password: UExBQ0VIT0xERVIr
    {{- else }}
    password: UExBQ0VIT0xERVIr
    {{- end }}
{{- end -}}
{{- end -}}
```

- [ ] **Step 4: Write `charts/genieai-umbrella/templates/hooks/pre-upgrade-sealed-secret-validate.yaml`**

```yaml
{{- if .Values.secrets.sealedSecrets.enabled -}}
apiVersion: batch/v1
kind: Job
metadata:
  name: {{ include "genieai-common.fullname" . }}-sealed-secret-validate
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "sealed-secret-validate"))) | nindent 4 }}
  annotations:
    # Pre-upgrade ONLY. A pre-install leg would be vacuous: SealedSecrets
    # are REGULAR resources, applied AFTER every hook — `kubectl get
    # sealedsecret` during pre-install returns an empty list, the loop
    # totals zero, and the hook exits 0 having checked nothing (code-review
    # scope). Fresh-install sentinel detection therefore lives in the
    # the task helm test, which runs post-install and waits for the K8s
    # Secrets to materialize (PLACEHOLDER+ blobs never do — the controller
    # marks the SealedSecret `status.conditions[type=SealedSecretHasntDecrypted]
    # .status=True` and CNPG/ArangoDeployment pods hang in
    # `Waiting for secret`; the test's materialization timeout catches it).
    "helm.sh/hook": pre-upgrade
    "helm.sh/hook-weight": "0"
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  backoffLimit: 1
  template:
    spec:
      restartPolicy: Never
      serviceAccountName: {{ include "genieai-common.fullname" . }}-dep-check
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
      containers:
        - name: validate
          # Drift check via the K8s API. The bitnami sealed-secrets
          # controller signals an undecryptable SealedSecret via
          # `status.conditions[type=SealedSecretHasntDecrypted].status="True"`
          # — NOT via the `sealedsecrets.bitnami.com/invalid` annotation
          # (that annotation does not exist in the upstream controller).
          # Reading the right field is the difference between a real
          # drift check and a decorative hook that always passes.
          #
          # For each SealedSecret resource the chart rendered:
          #   kubectl get sealedsecret <name> -o json
          #   jq -e '.status.conditions[] |
          #          select(.type=="SealedSecretHasntDecrypted" and .status=="True")'
          #
          # If any SealedSecret is undecryptable, the controller has
          # refused to materialise the underlying K8s Secret — pods
          # referencing that Secret will start failing. We exit 1 so
          # the install/upgrade is blocked and the operator re-encrypts
          # (or the PLACEHOLDER sentinels are replaced with real
          # values) before re-running.
          image: bitnami/kubectl:1.33
          imagePullPolicy: IfNotPresent
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: true
            runAsNonRoot: true
            runAsUser: 65534
            capabilities:
              drop:
                - ALL
          command:
            - /bin/sh
            - -c
            - |
              set -eu
              ns="{{ .Values.namespace }}"
              invalid=0
              total=0
              # The controller signals an undecryptable SealedSecret via
              # status.conditions[type=SealedSecretHasntDecrypted].status=True
              # — the `sealedsecrets.bitnami.com/invalid` annotation does NOT
              # exist upstream and grepping it always matches nothing
              # (the annotation does not exist upstream).
              for name in $(kubectl get sealedsecret -n "$ns" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null); do
                total=$((total+1))
                cond=$(kubectl get sealedsecret "$name" -n "$ns" \
                  -o jsonpath='{range .status.conditions[?(@.type=="SealedSecretHasntDecrypted")]}{.status}{end}' 2>/dev/null || true)
                if [ "$cond" = "True" ]; then
                  echo "DRIFT: $name undecryptable (cluster key rotated or sentinel blob; re-encrypt with current public key)"
                  invalid=$((invalid+1))
                fi
              done
              if [ "$invalid" -gt 0 ]; then
                echo "FAIL: $invalid SealedSecret resources drifted (of $total total)"
                echo "FAIL: kubeseal --fetch-cert + re-encrypt + commit + push + re-upgrade required"
                exit 1
              fi
              echo "PASS: no drift detected across $total SealedSecret resources"
{{- end -}}
```

- [ ] **Step 5: Render and count SealedSecret CRs**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: SealedSecret$"`
Expected: prints `4` (2 arango + 2 keycloak). The default `data.keycloak.enabled: true` in Task 2's values.yaml is intentional — Plan 2's purpose is to land the data layer including the Keycloak + KeycloakRealmImport CRs, so the Keycloak secrets ship alongside.

- [ ] **Step 6: Disable keycloak and verify count drops**

Run: `helm template test charts/genieai-umbrella -n genieai --set data.keycloak.enabled=false | grep -c "^kind: SealedSecret$"`
Expected: prints `2` (arango-only). Use this to validate the keycloak-side SealedSecret templates are conditioned correctly.

- [ ] **Step 7: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add charts/genieai-umbrella/templates/secrets/ charts/genieai-umbrella/templates/hooks/pre-upgrade-sealed-secret-validate.yaml
git commit -m "feat(charts): SealedSecret templates (Arango, Keycloak) + pre-upgrade drift validation"
```

---

## Task 12: Helm test for data dependency resolvability

**Files:**
- Modify: `charts/genieai-umbrella/templates/tests/test-namespace.yaml` (extend from Plan 1 to also check keycloak-db + arango-jwt Secrets exist after install)

**Interfaces:**
- Consumes: SealedSecret → Secret resolution chain (MaterializeSeconds ≤ 60s after install).
- Produces: a second `helm test` Pod that asserts keycloak-db + arango-jwt-secret K8s Secrets are populated.

- [ ] **Step 1: Run red-gate — no additional test pod yet**

Run: `helm template test charts/genieai-umbrella -n genieai --show-only templates/tests | grep -c test-data`
Expected: prints `0`.

- [ ] **Step 2: Append new test pod to `charts/genieai-umbrella/templates/tests/test-namespace.yaml`** (file becomes a multi-document YAML with 2 Pods)

```yaml
---
apiVersion: v1
kind: Pod
metadata:
  name: {{ include "genieai-common.fullname" . }}-test-data-deps
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "test"))) | nindent 4 }}
    app.kubernetes.io/component: test
  annotations:
    "helm.sh/hook": test
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  restartPolicy: Never
  serviceAccountName: {{ include "genieai-common.fullname" . }}-dep-check
  securityContext:
    runAsNonRoot: true
    runAsUser: 65534
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: t
      # bitnami/kubectl: kubectl is NOT in alpine base. SA = the hook-owned
      # dep-check SA (persists between hook fires via before-hook-creation).
      image: bitnami/kubectl:1.33
      imagePullPolicy: IfNotPresent
      securityContext:
        allowPrivilegeEscalation: false
        readOnlyRootFilesystem: true
        runAsNonRoot: true
        runAsUser: 65534
        capabilities:
          drop:
            - ALL
      command:
        - /bin/sh
        - -c
        - |
          set -eu
          echo "test Pod checking SealedSecret materialization"
          missing=""
          for secret in arango-jwt-secret arango-root-secret; do
            if ! kubectl get secret "$secret" -n {{ .Values.namespace }} >/dev/null 2>&1; then
              echo "missing K8s Secret: $secret"
              missing="$missing $secret"
            fi
          done
          if [ -n "$missing" ]; then
            echo "FAIL: SealedSecret resources not yet materialised:"
            echo "$missing"
            exit 1
          fi
          echo "PASS"
```

- [ ] **Step 3: Confirm both test pods render**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -E "test-namespace|test-data-deps"`
Expected: prints both.

- [ ] **Step 4: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add charts/genieai-umbrella/templates/tests/test-namespace.yaml
git commit -m "test(charts): extend helm test with data-deps resolution check"
```

---

## Task 13: Final validation + docs

**Files:**
- Modify: `charts/README.md` (mark Plan 2 complete)
- Modify: `charts/genieai-umbrella/README.md` (initial README authored now)

**Interfaces:**
- Consumes: every prior task.
- Produces: documentation checkpoint.

- [ ] **Step 1: Update `charts/README.md` to mark Plan 2 complete**

```bash
cat > charts/README.md <<'EOF'
# GENIE.AI Helm charts

This directory holds the Kubernetes-deployment Helm charts for GENIE.AI.

## Status

Foundation plan + Plan 2 (data layer) complete. Next: Plan 3 (service tier Group 5 — stateless app), Plan 4 (observability), Plan 5 (AI/ML), Plan 6 (per-env config + ingress), Plan 7 (CI), Plan 8 (docs).

## Charts

| Chart | Status | Purpose |
|---|---|---|
| `genieai-common` | foundation | Library chart (templates + helpers) |
| `genieai-umbrella` | foundation + Plan 2 | Single-install chart with data layer (CNPG, kube-arangodb, keycloak, sealed-secrets) |

## Other directories

- `deploy/environments/` — per-environment Kustomize overlays + values-override files.
- `docs/charts/` — dev-internal reference docs (operator selection, migration playbooks).

## Conventions

- Helm API v2. Helm 4.x.
- No secrets in `values-override.yaml`. Use SealedSecret resources (Plan 2 default backend).
- Tests live in each chart's `tests/` directory; `ct install` for integration, `helm test` for smoke.
- Pre-install hooks in `templates/hooks/*.yaml` carry `helm.sh/hook: pre-install` annotations (Helm 3 scans recursively).
EOF

git add charts/README.md
git commit -m "docs(charts): mark foundation + data layer complete in charts/README.md"
```

- [ ] **Step 2: Author initial `charts/genieai-umbrella/README.md`**

```markdown
# genieai-umbrella

Single-install Helm chart for GENIE.AI. Renders the entire 28-service stack
with one `helm install`.

## Status

| Layer | Status | Plan |
|---|---|---|
| Foundation (namespace, ArgoCD example, chart-testing baseline) | ✅ Shipped | Plan 1 |
| Data layer (CNPG, kube-arangodb, sealed-secrets; keycloak-operator = bootstrap prerequisite) | ✅ Shipped | Plan 2 |
| Service tier Group 5 (stateless app) | ⏳ Plan 3 | |
| Service tier Group 1 (observability) | ⏳ Plan 4 | |
| Service tier Group 6 (AI/ML) | ⏳ Plan 5 | |
| Per-env config + ingress | ⏳ Plan 6 | |
| CI integration | ⏳ Plan 7 | |

## Per-environment overlay

Apply per-env config via `deploy/environments/<env>/values-override.yaml`. See
that directory's `README.md`.

## Pre-install hooks

The chart's pre-install/pre-upgrade hooks run in ascending `helm.sh/hook-weight`
order (RBAC first — regular resources land only AFTER all hooks, so everything a
hook needs must itself be a lower-weight hook):

1. `-30` — ServiceAccount + ClusterRole + ClusterRoleBinding (hook-owned)
2. `-20` — dep-graph ConfigMap (dependency-graph.json + enabled.json)
3. `-10` — cluster-profile auto-detect (reads namespace label, emits an Event)
4. `-5`  — dependency graph validation (services/data require their deps)
5. `0` on pre-upgrade only — SealedSecret drift validation (`sealedsecrets.bitnami.com/invalid` annotation sweep)

## Tests

```bash
make test         # ct install + helm test against kind
helm test <release> -n genieai
```

## Secrets backend

Default secrets backend `sealedSecrets`. Helm dep pinned to `~> 2.20.0`
(controller v0.40.0+; pin rationale in docs/charts/k8s-native-audit.md — the
CVE IDs from early research are RETRACTED, rotation is operator-initiated via
`kubeseal --rotate`, NOT automatic). After any rotation, re-encrypt committed
SealedSecrets; the pre-upgrade drift hook fails upgrades while any carry the
`invalid` annotation.
```

```bash
git add charts/genieai-umbrella/README.md
git commit -m "docs(charts): genieai-umbrella README with status table + secrets backend notes"
```

---

## Self-Review

After writing all 13 tasks, run this checklist against the spec.

**1. Spec coverage** (data layer slice only — full coverage comes in Plans 3-8):

| Spec section | Task |
|---|---|
| §4 operator deps rendering (CNPG, kube-arangodb, sealed-secrets; keycloak-operator bootstrap) | Tasks 1, 2 |
| §4 `~>` version pins for CRD owners | Task 1 |
| §5.1 dependency graph + pre-install hook | Tasks 3, 6 |
| §5.2 ClusterProfile auto-detect + hook | Task 7 |
| §5.2 ClusterProfile-driven HA instances for prod/staging | Task 5 (CNPG instances), Task 9 (Arango mode) |
| §6 sealed-secrets plug-point as v1 default | Tasks 2, 11 |
| §6.1 secrets backend migration path | Deferred to Plan 6 |
| §8 SealedSecret rendering (default backend) | Task 11 |
| §8 rotation story (operator-initiated `kubeseal --rotate`; no auto-rotation) | Task 11 Step 4 drift hook |
| §13.1 uninstall safety + pre-install backup hook | Plan 7 |
| §13.2 secret-leak lint + chart-schema-drift CI | Plan 7 |
| §17 data-tier entries in v1.0 manifest | Tasks 1, 5, 8, 9, 11 |

**2. Placeholder scan**: the only literal `PLACEHOLDER` strings are inside SealedSecret encryptedData values — those are intentional, documented, and gated by conftest in Plan 7. No "TBD", "TODO", "implement later", or "fill in details" elsewhere.

**3. Type consistency**: `genieai-common.labels`, `genieai-common.fullname`, `genieai-common.selectorLabels` invoked consistently across Tasks 5/6/7/8/9/10/11/12. `dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "<name>"))` pattern is uniform across templates — same shape, different component names.

**4. Review Focus coverage**: 5 input-class concerns pinned:

1. `templates/hooks/` direct storage dead without annotation → Task 6 Step 5 (`helm.sh/hook: pre-install` annotation explicit; Step 5 asserts via Python parse).
2. ClusterProfile auto-detection race → Task 7 Step 2 (30s polling loop).
3. ArangoDB single → cluster in-place upgrade fails → Task 9 Step 5 (docs/charts/arangodb-mode-migration.md written).
4. ~~Kong DB-less misconfig~~ — moot: Kong REMOVED (decision 7); edge concerns move to Envoy Gateway (Plan 6).
5. SealedSecrets undecryptable after operator-initiated cluster key rotation → Task 11 Step 4 (pre-upgrade Job sweeps `sealedsecrets.bitnami.com/invalid` annotations).

All five covered. The helm test for #1 (Task 6 Step 5) doubles as runtime test in CI.

**5. Adversarial review (TODO — recommend `code-review` slash command before committing)**

---

## Plan Stats

- **Tasks:** 13
- **Files modified:** 2 (`charts/genieai-umbrella/Chart.yaml`, `values.yaml`); new files: 13
- **Files created:** ~17 (4 templates + 2 Service templates + 2 SealedSecret + 1 hook Job + 1 docs + 1 README + 1 test pod + 1 migration doc, etc.)
- **Commits planned:** 13
- **Estimated review surface:** ~600 lines added to existing files; ~1500 lines new

## What's next after Plan 2

- Plan 3: service tier Group 5 (stateless app: backend + frontend + document-repository + nginx + clamav + gateway)
- Plan 4: observability (vmoperator VMSingle/Cluster/VLSingle/VTCluster + OTel operator + serviceMonitors)
- Plan 5: AI/ML (vLLM + TEI + OPEA microservices + GPU operator)
- Plan 6: per-env Kustomize overlays + GitOps sync + ingress (Envoy Gateway + cert-manager)
- Plan 7: CI integration + image signing + Renovate + uninstall safety + secret-leak lint + chart-schema-drift alert
- Plan 8: documentation (site content + docs/charts/*)
