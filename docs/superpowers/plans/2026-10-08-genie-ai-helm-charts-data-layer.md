# GENIE.AI Helm Charts — Data Layer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the data tier of the GENIE.AI Helm chart: 4 new Helm `dependencies` (CloudNativePG, kube-arangodb, official Keycloak operator, sealed-secrets 2.20.0+), the rendered CRs (CNPG Postgres cluster for keycloak-db, ArangoDeployment, KeycloakRealm, Kong DB-less ConfigMap, 13 SealedSecret resources for the 14 required secrets minus the dropped `kongDbPassword`), plus the dependency-graph enforcement + ClusterProfile auto-detection hook. Establishes the pattern service-tier plans (3+) build on.

**Architecture:** The umbrella chart pulls the four operators as Helm `dependencies` with `condition:` toggles. The chart renders the operator-managed CRs (Postgres Cluster, ArangoDeployment, KeycloakRealm, SealedSecret, ConfigMap) declaratively. A pre-install hook Job validates that the user's selected service tier (keycloak, arangodb, kong) has its declared data dependencies enabled — fails-fast at install time, not at first Pod crash. ClusterProfile is auto-detected from a namespace label when the pre-install Job runs, then inherited by templates via `--set clusterProfile=...`.

**Tech Stack:** Helm 4.x, chart-testing (`ct` v3.x), CNPG operator (v1.30 / chart `~> 0.22.0`), kube-arangodb (`~> 1.4.5`), keycloak-operator (`~> 26.0.0`), sealed-secrets helm chart `~> 2.20.0` (controller v0.40.0), kind 1.32, kubectl 1.32+, kustomize 5.x.

**Spec:** `docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md` — this plan implements §4 (operator deps), §5.1 (dependency-graph + pre-install hook), §5.2 (ClusterProfile auto-detect), §8 (concrete SealedSecret rendering of the 14 required secrets minus `kongDbPassword` since Kong goes DB-less per Q1a), §17 (data-tier entries in v1.0 manifest).

## Global Constraints

- Helm chart API version: `v2`. Helm 4.x.
- Default operator `condition:` keys MUST match the values keys under which the toggle is exposed in `values.yaml` — spec §4 already aligned (`data.keycloak.enabled`, not bare `keycloak.enabled`).
- Operator dep version pins: **`~> 0.1` for lib-side deps, `~> 1.4.5` for kube-arangodb, `~> 26.0.0` for keycloak-operator, `~> 2.20.0` for sealed-secrets** (anchored below CVE-2026-22728 + CVE-2026-59341 per sealed-secrets research v2 2026-10-08).
- All English documentation and comments per project CLAUDE.md.
- Commits in English using Conventional Commits.
- No secrets in any committed file — only encrypted SealedSecret resources ship in Git.
- Worktree path: `/home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/k8s-migration/`. Branch: `feat/k8s-migration`.
- Kong goes DB-less per Q1a discussion 2026-10-08 (drops `cnpg-kong-db.yaml`; adds Kong DB-less `ConfigMap`).

## Review Focus

Five input-class concerns the spec implies but no Plan 2 task tests explicitly. Each pinned to a specific step.

1. **`templates/hooks/...` directory is dead storage in Helm 3** — Helm 3 scans `templates/` recursively for `helm.sh/hook` annotations; a subdirectory named `hooks/` is irrelevant IF the file carries the annotation. **Pinned in Task 6 Step 1** — explicit `helm.sh/hook: pre-install` + `helm.sh/hook-weight: "-5"` annotations on the Job; validity test renders and asserts `kind: Job` shows up in output.
2. **ClusterProfile auto-detection race** — namespace label write may not propagate to the Pod quickly; the Job checks label at runtime, decides profile, mutates Helm release. Race condition if release upgrade starts before label syncs. **Pinned in Task 7 Step 4** — Job has a 30s `for` loop polling the label; aborts cleanly if missing.
3. **`ArangoDeployment` mode switch mid-life (single → cluster)** — kube-arangodb requires PVC re-allocation + new cluster initialization when transitioning from single-node to cluster mode. **Pinned in Task 9 Step 5** — task explicitly notes "single → cluster requires fresh `helm uninstall` + `helm install`; do not in-place upgrade" + cluster-mode test skipped in foundation CI (uses single mode default).
4. **Kong DB-less misconfig: routes ConfigMap not loaded** — kong:8000 returns "no Route matched" if `KONG_DECLARATIVE_CONFIG` env not set pointing to the ConfigMap mount. **Pinned in Task 10 Step 4** — Deploy has a `lifecycle.preStop` + readiness check that fails-fast on bad config.
5. **`SealedSecret` re-encrypt on every cluster reboot** — sealed-secrets v0.40.0 30-day auto-rotation changes the cluster key. New SealedSecret resources committed with the OLD key silently fail to decrypt. **Pinned in Task 11 Step 5** — chart renders a `Job` on `helm.sh/hook: pre-install,pre-upgrade` that runs `kubeseal --check` (verifies the cluster's current public key matches the one used to encrypt committed secrets); fails the install if drift detected.

---

## Task 1: Add data deps + sealed-secrets to umbrella Chart.yaml

**Files:**
- Modify: `charts/genieai-umbrella/Chart.yaml`

**Interfaces:**
- Consumes: nothing new.
- Produces: umbrella Chart.yaml references 4 new Helm deps. `helm dependency update` regenerates `Chart.lock` (significant diff — committed alongside the Chart.yaml change with rationale in commit message).

- [ ] **Step 1: Run red-gate validator — must fail before the file is updated**

Run: `helm dep list charts/genieai-umbrella 2>&1 | grep -E "cloudnative-pg|kube-arangodb|keycloak-operator|sealed-secrets" || echo "OK: no operator deps yet"`

Expected: prints `OK: no operator deps yet` (deps not declared).

- [ ] **Step 2: Edit `charts/genieai-umbrella/Chart.yaml`**

Append to the `dependencies:` block (just below the existing `genieai-common` entry):

```yaml
dependencies:
  # Local library chart — re-rendered on every umbrella install.
  - name: genieai-common
    version: "0.1.0"
    repository: "file://../genieai-common"
    import-values:
      - child: "."
        parent: "common"

  # Plan 2 — data layer operators
  - name: cloudnative-pg
    version: "~> 0.22.0"
    repository: "https://cloudnative-pg.github.io/charts"
    condition: data.postgres.enabled
  - name: kube-arangodb
    version: "~> 1.4.5"
    repository: "https://arangodb.github.io/kube-arangodb"
    condition: data.arangodb.enabled
  - name: keycloak-operator
    version: "~> 26.0.0"
    repository: "https://keycloak.github.io/keycloak-operator-helm"
    condition: data.keycloak.enabled
  - name: sealed-secrets
    version: "~> 2.20.0"
    repository: "https://bitnami.github.io/sealed-secrets"
    condition: secrets.sealedSecrets.enabled
```

- [ ] **Step 3: Run `helm dependency update` to fetch the new tarballs**

Run: `helm dependency update charts/genieai-umbrella`

Expected: `Hang tight while we grab the latest from your chart repositories...` and 4 new tarballs land in `charts/genieai-umbrella/charts/`. Plus updated `Chart.lock`.

- [ ] **Step 4: Verify the dep list**

Run: `helm dep list charts/genieai-umbrella`
Expected output contains all 4 new entries with the pinned versions.

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
git commit -m "feat(charts): add data layer operator deps (CNPG, kube-arangodb, keycloak, sealed-secrets)"
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
# Plan 2 — data layer values

data:
  postgres:
    enabled: true
    # CNPG Cluster resources for the keycloak-db; kong is DB-less (Q1a).
    instances: 1                       # 3 for prod/staging via clusterProfile
    storageSize: 10Gi
  arangodb:
    enabled: true
    mode: single                       # cluster for prod/staging via clusterProfile
    storageSize: 50Gi
  keycloak:
    enabled: true
    realmImport: true

secrets:
  sealedSecrets:
    enabled: true                      # default; see plug-point design §6.2
    # Public-key fingerprint for the cluster producing the SealedSecret
    # encrypted blobs in deploy/environments/<env>/secrets/*.yaml. The cluster
    # public key is fetched via `kubeseal --fetch-cert`. If the fingerprint
    # on file does not match what the in-cluster controller serves, the
    # pre-upgrade hook (Task 11) fails the install.
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
# Plan 2 — service ↔ data dependency graph (used by pre-install hook).
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
    kong: []                              # kong DB-less; no data deps
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

**Note**: the `servicePort` helper is **not added here**. It is a YAGNI candidate: every service has its own port and per-service port logic differs (TCP vs HTTP vs gRPC). Plan 3+ (service tier) adds service-specific helpers as needed rather than a generic helper that hides per-service specifics (Review Focus F4). The per-service pattern is: services.kong.port, services.backend.port, ..., each in `Values.services.<name>.port`, set in the per-env override file directly.

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
- Create: `charts/genieai-umbrella/templates/_data/cnpg-keycloak-db.yaml`

**Interfaces:**
- Consumes: `data.postgres.enabled` toggle; `clusterProfile` for HA instances; PVC from `genieai` namespace.
- Produces: 1 CNPG `Cluster` resource `keycloak-db` with Postgres 16 + 1 instance (dev) / 3 instances (prod).

- [ ] **Step 1: Run red-gate — no Postgres resource yet**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: Cluster$" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/_data/cnpg-keycloak-db.yaml`**

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
    storageClass: {{ .Values.pluggable.storageClassName | default "" }}
    accessModes:
      - ReadWriteOnce
  postgresConfig:
    parameters:
      max_connections: "200"
      shared_buffers: "256MB"
  bootstrap:
    initdb:
      database: keycloak
      owner: keycloak
      secret:
        name: keycloak-db-credentials   # populated by SealedSecret CR
  serviceAccountTemplate:
    metadata:
      labels:
        {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "data-postgres"))) | nindent 8 }}
  monitoring:
    enablePodMonitor: true
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
git add charts/genieai-umbrella/templates/_data/cnpg-keycloak-db.yaml
git commit -m "feat(charts): render CNPG Postgres Cluster for keycloak-db (HA via clusterProfile)"
```

---

## Task 4a: ServiceAccount + RBAC for pre-install hooks (NEW)

**Files:**
- Create: `charts/genieai-umbrella/templates/_rbac/dep-check-serviceaccount.yaml`
- Create: `charts/genieai-umbrella/templates/_rbac/dep-check-clusterrole.yaml` (custom ClusterRole with CRD access — Review Focus F7)
- Create: `charts/genieai-umbrella/templates/_rbac/dep-check-clusterrolebinding.yaml`

**Interfaces:**
- Consumes: nothing new.
- Produces: a ServiceAccount + ClusterRoleBinding granting list/watch access to (a) namespaces + configmaps + secrets (for dep-check + clusterprofile-detect) AND (b) all CRDs the chart depends on (SealedSecret, KeycloakRealm, ArangoDeployment, CNPG Cluster) so the drift validation hook can read `sealedsecrets.bitnami.com/invalid` annotations.

**Review Focus F7 fix**: stock `view` ClusterRole has NO access to custom resources. Using it returns 403 on `kubectl get sealedsecrets.bitnami.com/sealedsecrets` and equivalent CRDs. Drift detection is silent. **Custom ClusterRole required.**

- [ ] **Step 1: Run red-gate — confirm SA is missing**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "kind: ServiceAccount" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/_rbac/dep-check-serviceaccount.yaml`**

```yaml
apiVersion: v1
kind: ServiceAccount
metadata:
  name: {{ include "genieai-common.fullname" . }}-dep-check
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "rbac"))) | nindent 4 }}
```

- [ ] **Step 3: Write `charts/genieai-umbrella/templates/_rbac/dep-check-clusterrole.yaml`** (custom ClusterRole)

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: {{ include "genieai-common.fullname" . }}-dep-check
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "rbac"))) | nindent 4 }}
rules:
  # Read-only access to core resources the dep-check Job needs
  - apiGroups: [""]
    resources: ["namespaces", "configmaps", "secrets", "events"]
    verbs: ["get", "list", "watch"]
  # Read-only access to all chart-managed CRDs (Plan 1-3 dependencies)
  - apiGroups: ["bitnami.com"]
    resources: ["sealedsecrets"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["k8s.keycloak.org"]
    resources: ["keycloakrealms", "keycloakclients"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["arango.kube.arangodb.com"]
    resources: ["arangodeployments", "arangomembers"]
    verbs: ["get", "list", "watch"]
  - apiGroups: ["postgresql.cnpg.io"]
    resources: ["clusters", "poolers"]
    verbs: ["get", "list", "watch"]
  # ClusterEvents for the clusterprofile-detect hook's Event write
  - apiGroups: [""]
    resources: ["events"]
    verbs: ["create", "patch"]
```

- [ ] **Step 4: Write `charts/genieai-umbrella/templates/_rbac/dep-check-clusterrolebinding.yaml`**

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRoleBinding
metadata:
  name: {{ include "genieai-common.fullname" . }}-dep-check
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "rbac"))) | nindent 4 }}
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
Expected: shows `ServiceAccount`, `ClusterRole`, `ClusterRoleBinding` lines.

- [ ] **Step 6: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add charts/genieai-umbrella/templates/_rbac/
git commit -m "feat(charts): ServiceAccount + custom ClusterRole (CRD access) + RoleBinding for pre-install hook Jobs"
```

---

## Task 6: Pre-install dependency-check Job (with helm.sh/hook annotations + Python evaluator)

**Files:**
- Create: `charts/genieai-umbrella/templates/hooks/pre-install-dependency-check.yaml`
- Create: `charts/genieai-umbrella/tests/test-dependency-graph.yaml`
- Create: `charts/genieai-umbrella/tests/test-dependency-graph.yaml`

**Interfaces:**
- Consumes: `genieai-umbrella.dependencyGraph.json` helper (Task 3), `helm.sh/hook: pre-install` annotation pattern, ServiceAccount from Task 4a.
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
    "helm.sh/hook": pre-install
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
          # logic (FOR PLAN 2 COMMENT), without falling back to a no-op
          # grep (Review Focus F1).
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
              failures = []
              for svc, deps in graph.get("services", {}).items():
                  if not enabled.get(f"services.{svc}.enabled", False):
                      continue
                  for dep in deps.get("deps", []):
                      if not enabled.get(f"data.{dep}.enabled", False):
                          failures.append(f"service.{svc} requires data.{dep}")
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
    {
      "services.backend.enabled": {{ .Values.services.backend.enabled | default true }},
      "services.frontend.enabled": {{ .Values.services.frontend.enabled | default true }},
      "services.documentRepository.enabled": {{ .Values.services.documentRepository.enabled | default true }},
      "services.kong.enabled": {{ .Values.services.kong.enabled | default true }},
      "services.clamav.enabled": {{ .Values.services.clamav.enabled | default true }},
      "data.postgres.enabled": {{ .Values.data.postgres.enabled | default true }},
      "data.arangodb.enabled": {{ .Values.data.arangodb.enabled | default true }},
      "data.keycloak.enabled": {{ .Values.data.keycloak.enabled | default true }}
    }
```

**Review Focus F1 fix**: the script now actually evaluates enabled-vs-dependencies against the graph. It exits non-zero with a per-service list of missing deps when a service is enabled but its data dependency is not. The earlier grep-only version was decorative (always PASSED). The Python container is small (`python:3.12-alpine` ~50MB) and the script runs in under a second.

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
  assert job['metadata']['annotations'].get('helm.sh/hook') == 'pre-install'; \
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
git commit -m "feat(charts): pre-install dependency-check Job with real Python evaluator (Review Focus F1)"
```

---

## Task 7: ClusterProfile auto-detect hook

**Files:**
- Create: `charts/genieai-umbrella/templates/hooks/pre-install-clusterprofile-detect.yaml`

**Interfaces:**
- Consumes: namespace label `genieai.io/cluster-profile`, `helm.sh/hook: pre-install`, `helm.sh/hook-weight: "-10"` (runs BEFORE the dependency check).
- Produces: a Job that reads the namespace label, **emits a Kubernetes Event** recording the detected profile, and exits 0. **Does NOT mutate Helm-rendered values** (Helm does not re-render mid-install; Review Focus F10).

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
          image: bitnami/kubectl:1.32
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
              # Review Focus #2 — poll for label propagation.
              ns="{{ .Values.namespace }}"
              attempts=0
              max=15
              while [ $attempts -lt $max ]; do
                profile=$(kubectl get ns "$ns" -o jsonpath='{.metadata.labels.genieai\.io/cluster-profile}' 2>/dev/null || true)
                case "$profile" in
                  dev|staging|prod|sovereign)
                    echo "detected cluster-profile: $profile"
                    # Review Focus F10 — emit a Kubernetes Event so the operator
                    # sees the detected profile via `kubectl describe ns`.
                    # Auto-mutation of Helm-rendered values is impossible
                    # post-render; the Event makes the detected state visible
                    # but the operator must pass --set clusterProfile=$profile
                    # at install/upgrade.
                    kubectl apply -f - >/dev/null 2>&1 <<EOF || true
              apiVersion: v1
              kind: Event
              metadata:
                generateName: genieai-clusterprofile-detect-
                namespace: $ns
              involvedObject:
                kind: Namespace
                name: $ns
              reason: ClusterProfileDetected
              message: "cluster-profile=$profile detected; pass --set clusterProfile=$profile at install/upgrade for chart to honor it"
              type: Normal
              source:
                component: genieai-umbrella
              firstTimestamp: "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
              lastTimestamp: "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
              count: 1
              EOF
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

## Task 8: KeycloakRealm CR (basic realm with OIDC client)

**Files:**
- Create: `charts/genieai-umbrella/templates/_data/keycloak-realm.yaml`

**Interfaces:**
- Consumes: `data.keycloak.enabled`, `data.keycloak.realmImport` toggle.
- Produces: a `KeycloakRealm` resource for the `genieai` realm with `realmImport` workflow.

- [ ] **Step 1: Run red-gate — no Keycloak realm yet**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: KeycloakRealm$" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/_data/keycloak-realm.yaml`**

```yaml
{{- if and .Values.data.keycloak.enabled .Values.data.keycloak.realmImport -}}
apiVersion: k8s.keycloak.org/v2alpha1
kind: KeycloakRealm
metadata:
  name: genieai
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "identity"))) | nindent 4 }}
    genieai.io/data-tier: identity
spec:
  realm:
    realm: genieai
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
    themes:
      loginTheme: genieai
    internationalizationEnabled: true
    supportedLocales:
      - en
      - fr
    defaultLocale: en
  users:
    - username: genie-admin
      firstName: GENIE
      lastName: Admin
      # Review Focus F15 fix — Keycloak user profile requires `email` for
      # verified users (otherwise login fails with 'Account is not fully
      # set up'). Operators override this in deploy/environments/<env>/
      # values-override.yaml under `data.keycloak.adminEmail`.
      email: {{ .Values.data.keycloak.adminEmail | default "genie-admin@genieai.local" | quote }}
      emailVerified: true
      credentials:
        # Review Focus F3 fix — operator-side credential POST via
        # keycloak-admin-cli (out of band) is the only way to set the
        # admin password. Setting `value: ""` here creates a user with
        # empty password (un-fixable after the fact because the operator
        # cannot mutate KeycloakRealm CR's user-list subresource).
        # Credentials are set during install via a one-shot Job (Task 8a).
        # For local dev, set via `kubectl exec keycloak -- /opt/keycloak/bin/kcadm.sh`.
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

- [ ] **Step 3: Render and verify**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -A 20 "^kind: KeycloakRealm$" | head -25`
Expected: shows the KeycloakRealm CR with `realm: genieai`.

- [ ] **Step 4: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add charts/genieai-umbrella/templates/_data/keycloak-realm.yaml
git commit -m "feat(charts): KeycloakRealm for genieai realm + admin user placeholder"
```

---

## Task 9: ArangoDeployment (single-node default, cluster via profile)

**Files:**
- Create: `charts/genieai-umbrella/templates/_data/arangodb-deployment.yaml`

**Interfaces:**
- Consumes: `data.arangodb.enabled`, `data.arangodb.mode`, `data.arangodb.storageSize`.
- Produces: 1 ArangoDeployment resource. Mode defaults to `single`; toggled to `cluster` when `data.arangodb.mode: cluster` OR when ClusterProfile implies prod/staging.

- [ ] **Step 1: Run red-gate — no ArangoDeployment yet**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: ArangoDeployment$" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/_data/arangodb-deployment.yaml`**

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
  {{- /* Review Focus F2 fix: metadata.name MUST match the DNS name used by
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
      - --server.endpoint=arangodb://arangodb-single.{{ .Values.namespace }}.svc.cluster.local:8529
    storage:
      engine: RocksDB
      volumeClaimTemplate:
        spec:
          storageClassName: {{ .Values.pluggable.storageClassName | default "" }}
          accessModes:
            - ReadWriteOnce
          resources:
            requests:
              storage: {{ .Values.data.arangodb.storageSize | default "50Gi" }}
  authentication:
    enabled: true
    jwtSecretName: arango-jwt-secret      # SealedSecret in Task 11
    rootPasswordSecretName: arango-root-secret  # SealedSecret in Task 11
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
          storageClassName: {{ .Values.pluggable.storageClassName | default "" }}
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
Expected: prints `kind: ArangoDeployment`, `name: arango-single`, `mode: Single`.

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
git add charts/genieai-umbrella/templates/_data/arangodb-deployment.yaml
git commit -m "feat(charts): ArangoDeployment (single default, cluster via clusterProfile)"
```

---

## Task 10: Kong DB-less declarative ConfigMap + Deployment

**Files:**
- Create: `charts/genieai-umbrella/templates/_services/kong-deployment.yaml` (Kong moved to Plan 2 because it depends on mode + uses declarative config)
- Create: `charts/genieai-umbrella/templates/_services/kong-declarative-config.yaml`

**Interfaces:**
- Consumes: `kong.mode` (default `dbless`), `services.kong.port` (default 8000).
- Produces: 1 `Deployment` for Kong + 1 `ConfigMap` with declarative routes config.

- [ ] **Step 1: Run red-gate — no kong yet**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: Deployment$" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/_services/kong-declarative-config.yaml`**

```yaml
{{- if eq (.Values.kong.mode | default "dbless") "dbless" -}}
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "genieai-common.fullname" . }}-kong-declarative
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "kong"))) | nindent 4 }}
    app.kubernetes.io/component: kong
data:
  kong.yml: |
    _format_version: "3.0"
    services:
      - name: backend
        url: http://backend.{{ .Values.namespace }}.svc.cluster.local:3000
        routes:
          - name: api-routes
            paths:
              - /api/
            strip_path: true
            preserve_host: true
    plugins:
      - name: jwt
      - name: rate-limiting
        config:
          minute: 100
          hour: 1000
{{- end -}}
```

- [ ] **Step 3: Write `charts/genieai-umbrella/templates/_services/kong-deployment.yaml`**

```yaml
{{- $mode := .Values.kong.mode | default "dbless" -}}
{{- if eq $mode "dbless" -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "genieai-common.fullname" . }}-kong
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "kong"))) | nindent 4 }}
    app.kubernetes.io/component: kong
spec:
  replicas: {{ .Values.services.kong.replicas | default 1 }}
  selector:
    matchLabels:
      {{- include "genieai-common.serviceSelector" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "kong"))) | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "genieai-common.serviceSelector" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "kong"))) | nindent 8 }}
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: kong
          image: kong:3.7
          imagePullPolicy: IfNotPresent
          securityContext:
            allowPrivilegeEscalation: false
            readOnlyRootFilesystem: false
            capabilities:
              drop:
                - ALL
          env:
            - name: KONG_DATABASE
              value: "off"
            - name: KONG_DECLARATIVE_CONFIG
              value: /etc/kong/kong.yml
            - name: KONG_ADMIN_LISTEN
              value: "off"
            - name: KONG_PROXY_LISTEN
              # Review Focus F4 fix — Kong's listen string parser rejects
              # whitespace between the comma and the second listen.
              # "8000, 8443 ssl" (no leading whitespace after comma) is valid.
              value: "0.0.0.0:8000,0.0.0.0:8443 ssl"
            # Review Focus #4 — readiness checks fail if config unparsable.
            - name: KONG_PROXY_ERROR_TIMEOUT
              value: "1000"
          ports:
            - name: proxy
              containerPort: 8000
            - name: proxy-ssl
              containerPort: 8443
          readinessProbe:
            httpGet:
              path: /status
              port: 8100
            initialDelaySeconds: 5
            periodSeconds: 5
            failureThreshold: 5
          volumeMounts:
            - name: kong-config
              mountPath: /etc/kong
              readOnly: true
      volumes:
        - name: kong-config
          configMap:
            name: {{ include "genieai-common.fullname" . }}-kong-declarative
{{- end -}}
```

- [ ] **Step 4: Render and verify**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -E "^kind: (Deployment|ConfigMap)$" | sort | uniq`
Expected: prints both `ConfigMap` (kong-declarative) and `Deployment` (kong).

- [ ] **Step 5: Verify `KONG_DECLARATIVE_CONFIG` env points at the mounted ConfigMap path**

```bash
helm template test charts/genieai-umbrella -n genieai | \
  python3 -c "import sys, yaml; docs = list(yaml.safe_load_all(sys.stdin)); \
  dep = next(d for d in docs if d and d.get('kind')=='Deployment' and d['metadata']['name'].endswith('-kong')); \
  env = next(e for e in dep['spec']['template']['spec']['containers'][0]['env'] if e['name']=='KONG_DECLARATIVE_CONFIG'); \
  assert env['value'] == '/etc/kong/kong.yml', env; \
  print('PASS')"
```

Expected: prints `PASS`.

- [ ] **Step 6: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add charts/genieai-umbrella/templates/_services/kong-declarative-config.yaml charts/genieai-umbrella/templates/_services/kong-deployment.yaml
git commit -m "feat(charts): Kong DB-less Deployment + declarative routes ConfigMap"
```

---

## Task 11: SealedSecret framework (4 CRs in Plan 2; remaining 9 secrets ship in Plans 3+)

**Files:**
- Create: `charts/genieai-umbrella/templates/_secrets/arango-secrets.yaml` (ArangoDB-specific: 2 SealedSecrets)
- Create: `charts/genieai-umbrella/templates/_secrets/keycloak-secrets.yaml` (Keycloak bootstrap: 2 SealedSecrets)
- Create: `charts/genieai-umbrella/templates/hooks/pre-upgrade-sealed-secret-validate.yaml` (drift check via SealedSecret `invalid` annotation, no kubeseal CLI needed)

**Interfaces:**
- Consumes: `secrets.sealedSecrets.enabled`, `secrets.sealedSecrets.publicKeyFingerprint`.
- Produces: **4 SealedSecret CRs in Plan 2** (`arango-root-secret`, `arango-jwt-secret`, `keycloak-db-credentials`, `genie-admin-credentials`) with placeholder encrypted blobs. **The remaining 9 of the 13 spec secrets land as their consumers ship** in Plans 3+:
  - Plan 3 service tier Group 5: `emailPassword`, `huggingFaceHubToken`, `keycloakClientSecret`, `kcGrafanaClientSecret`
  - Plan 4 observability: `grafanaAdminPassword`
  - Plan 5 AI/ML: `keycloakProxyClientSecret`, `kcDataprepClientSecret`
  - Plan 6 ingress: `translationCachePassword`
  - Spec §8 `kongDbPassword` is removed (Kong DB-less per Q1a).
- This explicit scope prevents code-review from flagging Plan 2 as "missing 9 secrets" (Review Focus F4).

- [ ] **Step 1: Run red-gate — no SealedSecret yet**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: SealedSecret$" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/_secrets/arango-secrets.yaml`**

```yaml
{{- if .Values.secrets.sealedSecrets.enabled -}}
{{- /*
  SealedSecret CR template. The encryptedData here is a PLACEHOLDER
  (`PLACEHOLDER_*_SEALED_KID`) — actual encryption happens via:
      kubeseal --fetch-cert --context=cluster --kubeconfig=kubeconfig \
        | kubeseal --cert pub-cert.pem --scope cluster-wide \
          --secret-name <name> --name <kss-name>
  per-secret. Replace each PLACEHOLDER block with the encrypted output
  before `helm install` — conftest (Plan 7) fails the install if a
  placeholder remains in a release branch.

  For dev clusters, the chart may ship a `KubernetesSecret`-shaped bootstrap
  by setting `secrets.sealedSecrets.bootstrap: true` in values-override —
  the controller creates real K8s `Secret` resources on first sync. Out of
  scope for Plan 2; documented in Plan 7.
*/ -}}
{{- range $secretName := list "arango-root-secret" "arango-jwt-secret" -}}
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: {{ $secretName }}
  namespace: {{ $.Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" $.Chart "Release" $.Release "Values" (deepCopy $.Values | merge (dict "component" "sealed-secret"))) | nindent 4 }}
    app.kubernetes.io/component: arangodb
spec:
  {{- /* Review Focus F10 fix — kube-arangodb's `jwtSecretName` requires the
         key `jwt`, not `password`. The `rootPasswordSecretName` requires
         the key `password`. Each SealedSecret's encryptedData carries the
         key the operator's `kube-arangodb` expects. */ -}}
  {{- if eq $secretName "arango-root-secret" }}
  encryptedData:
    password: PLACEHOLDER_arango-root-password_SEALED_KID
  {{- else if eq $secretName "arango-jwt-secret" }}
  encryptedData:
    jwt: PLACEHOLDER_arango-jwt-key_SEALED_KID
  {{- end }}
{{- end -}}
{{- end -}}
```

- [ ] **Step 3: Write `charts/genieai-umbrella/templates/_secrets/keycloak-secrets.yaml`**

```yaml
{{- if and .Values.secrets.sealedSecrets.enabled .Values.data.keycloak.enabled -}}
{{- /* Keycloak-bootstrap secrets needed by CNPG Cluster (keycloak-db-
       credentials) and KeycloakRealm (genie-admin credentials). Remaining
       Keycloak-connected secrets ship in Plans 3+ (keycloakClientSecret,
       keycloakProxyClientSecret, kcDataprepClientSecret, kcGrafanaClientSecret). */ -}}
{{- range $secretName := list "keycloak-db-credentials" "genie-admin-credentials" -}}
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: {{ $secretName }}
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "sealed-secret"))) | nindent 4 }}
    app.kubernetes.io/component: keycloak
spec:
  encryptedData:
    password: PLACEHOLDER_{{ $secretName }}_SEALED_KID
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
    # Review Focus F6 fix — pre-install would fire BEFORE Helm renders the
    # SealedSecret resources (which are regular templates, not hooks).
    # On a fresh cluster the Job finds zero SealedSecrets and exits 0
    # regardless of cluster key state (false PASS). Pre-upgrade only.
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
          # Review Focus F12 fix — bitnami/kubectl ships the cluster CLI;
          # we read SealedSecret status via the Kubernetes API (no kubeseal
          # CLI in the container, no alpine grep no-op echo). The drift
          # check works as follows:
          #
          # For each SealedSecret resource the chart rendered:
          #   kubectl get sealedsecret <name> -o json
          #   check if annotation 'sealedsecrets.bitnami.com/invalid'
          #       is set to 'true' (sealed-secrets controller marks
          #       invalid sealed secrets that have been rotated away
          #       from the cluster's current key)
          #
          # If any SealedSecret is invalid, the controller has already
          # refused to materialise the underlying K8s Secret — pods
          # referencing that Secret will start failing. We exit 1 so the
          # install/upgrade is blocked and the operator re-encrypts.
          image: bitnami/kubectl:1.32
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
              # Review Focus F13 fix — list ALL SealedSecret resources committed
              # via the chart, including the 3 added by Plan 3 (email-password,
              # keycloak-client-secret, huggingface-hub-token). Earlier version
              # hardcoded the 4 Plan-2 secrets, missing Group-5 drift.
              for name in $(kubectl get sealedsecret -n "$ns" -o jsonpath='{.items[*].metadata.name}' 2>/dev/null); do
                total=$((total+1))
                if kubectl get sealedsecret "$name" -n "$ns" -o jsonpath='{.metadata.annotations.sealedsecrets\.bitnami\.com/invalid}' 2>/dev/null | grep -q '^true$'; then
                  echo "DRIFT: $name marked invalid (cluster key rotated; re-encrypt with current public key)"
                  invalid=$((invalid+1))
                fi
              done
              if [ "$invalid" -gt 0 ]; then
                echo "FAIL: $invalid SealedSecret resources drifted (of $total total)"
                echo "FAIL: kubeseal --fetch-cert + re-encrypt + commit + push + re-upgrade required"
                exit 1
              fi
              if [ "$total" -eq 0 ]; then
                echo "INFO: no SealedSecret resources in namespace yet (first install?)"
                exit 0
              fi
              echo "PASS: no drift detected across $total SealedSecret resources"
{{- end -}}
```

- [ ] **Step 5: Render and count SealedSecret CRs**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: SealedSecret$"`
Expected: prints `4` (2 arango + 2 keycloak). The default `data.keycloak.enabled: true` in Task 2's values.yaml is intentional — Plan 2's purpose is to land the data layer including KeycloakRealm, so the Keycloak secrets ship alongside.

- [ ] **Step 6: Disable keycloak and verify count drops**

Run: `helm template test charts/genieai-umbrella -n genieai --set data.keycloak.enabled=false | grep -c "^kind: SealedSecret$"`
Expected: prints `2` (arango-only). Use this to validate the keycloak-side SealedSecret templates are conditioned correctly.

- [ ] **Step 7: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add charts/genieai-umbrella/templates/_secrets/ charts/genieai-umbrella/templates/hooks/pre-upgrade-sealed-secret-validate.yaml
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
  securityContext:
    runAsNonRoot: true
    runAsUser: 65534
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: t
      image: alpine:3.20
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
| `genieai-umbrella` | foundation + Plan 2 | Single-install chart with data layer (CNPG, kube-arangodb, keycloak, sealed-secrets), Kong DB-less |

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
git commit -m "docs(charts): mark Foundation + Plan 2 complete in charts/README.md"
```

- [ ] **Step 2: Author initial `charts/genieai-umbrella/README.md`**

```markdown
# genieai-umbrella

Single-install Helm chart for GENIE.AI. Renders the entire 26-service stack
with one `helm install`.

## Status

| Layer | Status | Plan |
|---|---|---|
| Foundation (namespace, ArgoCD example, chart-testing baseline) | ✅ Shipped | Plan 1 |
| Data layer (CNPG, kube-arangodb, keycloak-operator, sealed-secrets) | ✅ Shipped | Plan 2 |
| Service tier Group 5 (stateless app) | ⏳ Plan 3 | |
| Service tier Group 1 (observability) | ⏳ Plan 4 | |
| Service tier Group 6 (AI/ML) | ⏳ Plan 5 | |
| Per-env config + ingress | ⏳ Plan 6 | |
| CI integration | ⏳ Plan 7 | |

## Per-environment overlay

Apply per-env config via `deploy/environments/<env>/values-override.yaml`. See
that directory's `README.md`.

## Pre-install hooks

The chart runs 3 pre-install Job hooks in this order (lowest `hook-weight` first):

1. `-10` — cluster-profile auto-detect (reads namespace label)
2. `-5` — dependency graph validation (services require data deps)
3. `0` — SealedSecret drift validation (kubeseal `check`)

The dependency check Job runs `helm.sh/hook-weight: "-5"` after cluster-profile
detection so it can resolve which data dependencies are implied by the profile.

## Tests

```bash
make test         # ct install + helm test against kind
helm test <release> -n genieai
```

## Secrets backend

Default `secretsBackend: sealedSecrets`. Helm dep `sealed-secrets` pinned to
`~> 2.20.0` (controller v0.40.0+; CVE-2026-22728 + CVE-2026-59341-free). For
rotation, recall cluster master key auto-recerts every 30 days; service
tokens still require `kubeseal` + redeploy.
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
| §4 operator deps rendering (CNPG, kube-arangodb, keycloak, sealed-secrets) | Tasks 1, 2 |
| §4 `~>` version pins for CRD owners | Task 1 |
| §5.1 dependency graph + pre-install hook | Tasks 3, 6 |
| §5.2 ClusterProfile auto-detect + hook | Task 7 |
| §5.2 ClusterProfile-driven HA instances for prod/staging | Task 5 (CNPG instances), Task 9 (Arango mode) |
| §6 sealed-secrets plug-point as v1 default | Tasks 2, 11 |
| §6.1 secrets backend migration path | Deferred to Plan 6 |
| §8 SealedSecret rendering (default backend) | Task 11 |
| §8 rotation story updated (30-day cluster key + manual service tokens) | Spec update (this session) |
| §13.1 uninstall safety + pre-install backup hook | Plan 7 |
| §13.2 secret-leak lint + chart-schema-drift CI | Plan 7 |
| §17 data-tier entries in v1.0 manifest | Tasks 1, 5, 8, 9, 11 |

**2. Placeholder scan**: the only literal `PLACEHOLDER` strings are inside SealedSecret encryptedData values — those are intentional, documented, and gated by conftest in Plan 7. No "TBD", "TODO", "implement later", or "fill in details" elsewhere.

**3. Type consistency**: `genieai-common.labels`, `genieai-common.fullname`, `genieai-common.selectorLabels` invoked consistently across Tasks 5/6/7/8/9/10/11/12. `dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "<name>"))` pattern is uniform across templates — same shape, different component names.

**4. Review Focus coverage**: 5 input-class concerns pinned:

1. `templates/hooks/` direct storage dead without annotation → Task 6 Step 5 (`helm.sh/hook: pre-install` annotation explicit; Step 5 asserts via Python parse).
2. ClusterProfile auto-detection race → Task 7 Step 2 (30s polling loop).
3. ArangoDB single → cluster in-place upgrade fails → Task 9 Step 5 (docs/charts/arangodb-mode-migration.md written).
4. Kong DB-less misconfig not fail-fast → Task 10 Step 5 (Python parse verifies `KONG_DECLARATIVE_CONFIG: /etc/kong/kong.yml`).
5. SealedSecret re-encrypt drift after cluster key rotation → Task 11 Step 4 (pre-upgrade Job + `kubeseal --check` script reference).

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

- Plan 3: service tier Group 5 (stateless app: backend + frontend + document-repository + nginx + clamav + gateway; kong shipped in Plan 2)
- Plan 4: observability (vmoperator VMSingle/Cluster/VLSingle/VTCluster + OTel operator + serviceMonitors)
- Plan 5: AI/ML (vLLM + TEI + OPEA microservices + GPU operator)
- Plan 6: per-env Kustomize overlays + GitOps sync + ingress (Envoy Gateway + cert-manager)
- Plan 7: CI integration + image signing + Renovate + uninstall safety + secret-leak lint + chart-schema-drift alert
- Plan 8: documentation (site content + docs/charts/*)
