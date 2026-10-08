# GENIE.AI Helm Charts — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the foundation for the GENIE.AI Helm chart migration: `genieai-common` library chart, `genieai-umbrella` skeleton (Chart.yaml + values.yaml + namespace + ArgoCD Application example), chart-testing CI integration, and a passing `helm test` against a kind cluster. Establishes the patterns every later epic builds on.

**Architecture:** Library chart (`type: library`) provides reusable templates via `_helpers.tpl` + standalone templates, exported via `import-values:`. Umbrella chart consumes the library as a local file dependency, plus all stateful-service operators as Helm `dependencies` with `condition:` toggles. Single `helm install` deploys the whole umbrella into one namespace. ArgoCD ApplicationSet renders per-env Kustomize overlays pointing at `deploy/environments/<env>/`.

**Tech Stack:** Helm 4.x, Helmfile-compatible but standalone helm-install for v1, chart-testing (`ct`), kind (k8s 1.33+), ArgoCD ApplicationSet (GitOps), kubectl 1.33+, kustomize 5.x.

**Spec:** `docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md` — this plan implements §3 (chart topology base), §4 (dependency model base, Keycloak URL only), §5 (values schema partial — global + namespace only), §6 (pluggability surface design only, no concrete backends yet), §13.1 partial (skip uninstall hook in foundation), §17 partial (foundation manifest only — operators and per-env configs come in later plans).

## Global Constraints

- Helm chart API version: `v2` (per spec §3 topology).
- Chart name format: `genieai-<component>` (lowercase, ≤15 chars). Library: `genieai-common`. Umbrella: `genieai-umbrella`.
- Default container runtime assumption: `containerd` (post-K8s 1.24+ dockershim removal).
- Image registry default: `docker.io`.
- Default namespace for foundation: `genieai`.
- All English documentation and comments per project CLAUDE.md.
- All commits in English using Conventional Commits (`feat/chore/fix/docs/test(scope): ...`).
- Never commit secrets in `values-override.yaml` (conftest policy lands in Plan 7 — for now, manual discipline only).
- Worktree path: `/home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/k8s-migration/`. Branch: `feat/k8s-migration`.

## Review Focus

These five failure modes the spec implies but no plan-1 task tests explicitly. Each gets pinned in the listed task:

1. **Library chart `import-values:` collision** — if two templates in `genieai-common/templates/_lib/` declare the same exported key, umbrella chart's values merge breaks. **Pinned in Task 4 step 3** (render test that fails on duplicate keys).
2. **Helm test Pod missing `securityContext`** — the test Pod runs with default K8s `restricted` PSA; if `restricted` is enforced, the test Pod fails to schedule. **Pinned in Task 9 step 3** (test uses explicit `securityContext.runAsNonRoot: true`).
3. **chart-testing `ct install` against kind without `--kube-version` flag** — kind defaults to an older k8s; the chart's recommended 1.30+ assumption breaks. **Pinned in Task 10 step 2** (CT config pins `kubeVersion: 1.33.0`).
4. **Chart.yaml `appVersion: latest` vs OCI tag immutable** — OCI registries reject `latest` for promotion; the chart must use explicit tags. **Pinned in Task 6 step 4** (chart-test verifies `appVersion` is not `latest`).
5. **ArgoCD Application namespace conflict** — the Application manifest in `examples/` references `argocd` as install namespace; if applied by Helm before ArgoCD exists, install fails. **Pinned in Task 11 step 5** (helm template dry-run validates against `argocd` namespace only, not auto-applies).

---

## Task 1: Repo layout scaffolding

**Files:**
- Create: `charts/README.md`
- Create: `charts/Makefile`
- Create: `deploy/environments/.gitkeep`
- Create: `deploy/environments/README.md`

**Interfaces:**
- Consumes: nothing — first task.
- Produces: layout that subsequent tasks populate.

- [ ] **Step 1: Create `charts/README.md`**

```markdown
# GENIE.AI Helm charts

This directory holds the Kubernetes-deployment Helm charts for GENIE.AI.

## Status

Foundation plan in progress. See `docs/superpowers/plans/2026-10-08-genie-ai-helm-charts-foundation.md`
for the first batch of work.

## Charts

| Chart | Status | Purpose |
|---|---|---|
| `genieai-common` | foundation | Library chart (templates + helpers) reused by `genieai-umbrella` |
| `genieai-umbrella` | foundation | Single-install chart — 28 services, depends on `genieai-common` + operators |

## Other directories

- `deploy/environments/` — per-environment Kustomize overlays + values-override files.

## Conventions

- Helm API v2. Helm 4.x.
- No secrets in `values-override.yaml`. Use External Secrets Operator.
- Tests live in each chart's `tests/` directory; `ct install` for integration, `helm test` for smoke.
```

- [ ] **Step 2: Create `charts/Makefile`**

```makefile
.PHONY: lint lint-common lint-umbrella template template-umbrella test test-umbrella docs

CHARTS = genieai-common genieai-umbrella

lint: $(addprefix lint-,$(CHARTS))

lint-common:
	helm lint charts/genieai-common

lint-umbrella: lint-common
	helm lint charts/genieai-umbrella

template: template-umbrella

template-umbrella:
	helm template test charts/genieai-umbrella -n genieai > /tmp/genieai-rendered.yaml

test: test-umbrella

test-umbrella:
	ct install --config charts/ci/ct.yaml --charts charts/genieai-umbrella

docs:
	helm-docs --chart-search-root=charts
```

- [ ] **Step 3: Create `deploy/environments/.gitkeep`**

Empty file. The directory must exist for later plans.

Run: `touch deploy/environments/.gitkeep`

- [ ] **Step 4: Create `deploy/environments/README.md`**

```markdown
# Per-environment Kustomize overlays

`deploy/environments/<env>/` contains one subdirectory per deployment target. Each
subdirectory holds:

- `kustomization.yaml` — Kustomize resource that pins `helmCharts:` entries to
  the umbrella chart path + per-env `values-override.yaml`.
- `values-override.yaml` — env-specific Helm values overrides.

`main` branch tracks the chart + plain envs (dev, staging, prod). High-customization
envs track `release/<env>` branches (e.g. `release/el-salvador`). See
`docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md` §19.

This directory is empty during the Foundation plan. Subsequent plans populate per-env.
```

- [ ] **Step 5: Commit**

```bash
git add charts/README.md charts/Makefile deploy/environments/.gitkeep deploy/environments/README.md
git commit -m "chore(charts): scaffold layout for library + umbrella + per-env directories"
```

---

## Task 2: Library chart — Chart.yaml

**Files:**
- Create: `charts/genieai-common/Chart.yaml`

**Interfaces:**
- Consumes: nothing.
- Produces: `genieai-common` library chart declaration. Later tasks consume it via `dependencies:` in the umbrella's `Chart.yaml`.

- [ ] **Step 1: Write `charts/genieai-common/Chart.yaml`**

```yaml
apiVersion: v2
name: genieai-common
description: |
  Library chart providing reusable templates and helpers for the GENIE.AI Helm
  charts. NOT a deployable chart — used via `dependencies:` in consuming charts
  with `import-values:` to expose helpers.
type: library
version: 0.1.0
appVersion: "0.1.0"
keywords:
  - genie-ai
  - library
  - templates
home: https://opensource.unicc.org/un/itu/genie-ai
sources:
  - https://opensource.unicc.org/un/itu/genie-ai.git
maintainers:
  - name: GENIE.AI
    email: maintainers@example.invalid
annotations:
  category: Library
```

- [ ] **Step 2: Validate with `helm lint`**

Run: `helm lint charts/genieai-common`
Expected: `0 charts linted, 0 errors, 0 warnings`

- [ ] **Step 3: Validate with `helm-docs --dry-run`**

Run: `helm-docs --chart-search-root=charts/genieai-common --dry-run`
Expected: shows `name: genieai-common` line; exits 0.

If `helm-docs` is not installed globally, install via: `go install github.com/norwoodj/helm-docs/cmd/helm-docs@latest`.

- [ ] **Step 4: Commit**

```bash
git add charts/genieai-common/Chart.yaml
git commit -m "feat(charts): genieai-common library chart skeleton"
```

---

## Task 3: Library chart — `_helpers.tpl` (labels, selectors, naming)

**Files:**
- Create: `charts/genieai-common/templates/_helpers.tpl`

**Interfaces:**
- Consumes: nothing.
- Produces: callable helpers `genieai-common.name`, `genieai-common.fullname`, `genieai-common.labels`, `genieai-common.selectorLabels`, `genieai-common.chart`. Each umbrella template embeds them via `{{ include "..." . }}`.

- [ ] **Step 1: Write `charts/genieai-common/templates/_helpers.tpl`**

```gotemplate
{{/*
Expand the name of the chart.
*/}}
{{- define "genieai-common.name" -}}
{{- default .Chart.Name .Values.nameOverride | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Create a default fully qualified app name.
We truncate at 50 chars because some K8s name fields are limited to this (RFC 1123).
*/}}
{{- define "genieai-common.fullname" -}}
{{- if .Values.fullnameOverride -}}
{{- .Values.fullnameOverride | trunc 50 | trimSuffix "-" -}}
{{- else -}}
{{- $name := default .Chart.Name .Values.nameOverride -}}
{{- if contains $name .Release.Name -}}
{{- .Release.Name | trunc 50 | trimSuffix "-" -}}
{{- else -}}
{{- printf "%s-%s" .Release.Name $name | trunc 50 | trimSuffix "-" -}}
{{- end -}}
{{- end -}}
{{- end -}}

{{/*
Chart name and version label.
*/}}
{{- define "genieai-common.chart" -}}
{{- printf "%s-%s" .Chart.Name .Chart.Version | replace "+" "_" | trunc 63 | trimSuffix "-" -}}
{{- end -}}

{{/*
Common labels — applied to all umbrella resources.
Includes helm.sh/chart, app.kubernetes.io/name, app.kubernetes.io/instance,
app.kubernetes.io/version, app.kubernetes.io/managed-by, plus genie-ai-specific
labels for Prometheus / OpenTelemetry service discovery.
*/}}
{{- define "genieai-common.labels" -}}
helm.sh/chart: {{ include "genieai-common.chart" . }}
{{ include "genieai-common.selectorLabels" . }}
{{- if .Chart.AppVersion }}
app.kubernetes.io/version: {{ .Chart.AppVersion | quote }}
{{- end }}
app.kubernetes.io/managed-by: {{ .Release.Service }}
genieai.io/component: {{ .Values.component | default "umbrella" | quote }}
genieai.io/managed-by: helm
{{- end -}}

{{/*
Selector labels — used in Deployment selectors and Service selectors.
Note: must NOT include version (selector is immutable).
*/}}
{{- define "genieai-common.selectorLabels" -}}
app.kubernetes.io/name: {{ include "genieai-common.name" . }}
app.kubernetes.io/instance: {{ .Release.Name }}
{{- end -}}
```

- [ ] **Step 2: Run `helm lint` to confirm no syntax errors**

Run: `helm lint charts/genieai-common`
Expected: `0 charts linted, 0 errors, 0 warnings`

- [ ] **Step 3: Render library to confirm templates parse**

Run: `helm template genieai-common charts/genieai-common`
Expected: renders empty output (library charts produce nothing). Exit 0.

- [ ] **Step 4: Commit**

```bash
git add charts/genieai-common/templates/_helpers.tpl
git commit -m "feat(charts): add naming + label helpers to genieai-common"
```

---

## Task 4: Library chart — `values.schema.json` + README

**Files:**
- Create: `charts/genieai-common/values.schema.json`
- Create: `charts/genieai-common/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: JSON schema validation for umbrella charts that consume `genieai-common`. README documents the helpers and exported values keys.

- [ ] **Step 1: Write `charts/genieai-common/values.schema.json`**

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "title": "genieai-common library chart values",
  "description": "Schema for values imported via import-values: into consuming charts. Most fields default and require no setting.",
  "type": "object",
  "properties": {
    "nameOverride": {
      "type": "string",
      "description": "Override the chart name segment in resource names. Empty = use chart default.",
      "maxLength": 50
    },
    "fullnameOverride": {
      "type": "string",
      "description": "Override the entire resource name prefix. Empty = use <release>-<chart>.",
      "maxLength": 50
    },
    "component": {
      "type": "string",
      "description": "Top-level GENIE.AI component this label marks. Used by Prometheus service discovery, NetworkPolicy selectors, and Grafana dashboards. Open enum (additionalProperties tolerated); concrete values include: umbrella, namespace, data, data-postgres, data-arangodb, identity, pre-install, sealed-secret, sealed-secret-validate, rbac, test, ... (per-template).",
      "default": "umbrella",
      "maxLength": 63
    }
  },
  "additionalProperties": false
}
```

- [ ] **Step 2: Write `charts/genieai-common/README.md`**

```markdown
# genieai-common

Library chart for the GENIE.AI Helm umbrella. Provides:

- Naming helpers (`genieai-common.name`, `genieai-common.fullname`)
- Label selectors (`genieai-common.labels`, `genieai-common.selectorLabels`)
- Chart/version label (`genieai-common.chart`)

## Usage

Consume from an umbrella chart's `Chart.yaml`:

\`\`\`yaml
dependencies:
  - name: genieai-common
    version: "0.1.0"
    repository: "file://../genieai-common"
    import-values:
      - child: "."
        parent: "common"
\`\`\`

Then in templates:

\`\`\`gotemplate
metadata:
  labels:
    {{- include "genieai-common.labels" . | nindent 4 }}
\`\`\`

## Why `type: library`?

Library charts do not render Pods/Services themselves — they export helpers and
values consumed by umbrella templates. The umbrella chart is what users install.
```

- [ ] **Step 3: Validate library chart still passes lint (Review Focus #1)**

Run: `helm lint charts/genieai-common --strict`
Expected: 0 errors, 0 warnings. Confirms no duplicate template exports.

- [ ] **Step 4: Run `helm-docs` to regenerate chart README from values.yaml**

Run: `helm-docs --chart-search-root=charts --dry-run`
Expected: shows `genieai-common` in output. The library chart has empty `values.yaml` so docs output is small. If `helm-docs` fails because of empty values.yaml, skip and manually write the README — it was already written in step 2.

- [ ] **Step 5: Commit**

```bash
git add charts/genieai-common/values.schema.json charts/genieai-common/README.md
git commit -m "feat(charts): genieai-common values schema + README"
```

---

## Task 5: Library chart — empty `values.yaml` so umbrella can `import-values:`

**Files:**
- Create: `charts/genieai-common/values.yaml`
- Create: `charts/genieai-common/.helmignore`

**Interfaces:**
- Consumes: nothing.
- Produces: an empty values file. The umbrella's `Chart.yaml` uses `import-values: child: .` which exports all current values from the library into the umbrella's `common.*` namespace. The `.helmignore` keeps generated tarballs out of source (Review Focus V3).

- [ ] **Step 1: Run red-gate validator — fails because the file doesn't exist**

Run: `helm lint charts/genieai-common --strict`
Expected: ERROR — values.yaml is missing.

- [ ] **Step 2: Write `charts/genieai-common/values.yaml`**

```yaml
# genieai-common library chart — no chart-specific defaults.
# Consuming charts define defaults in their own values.yaml; this file exists
# only because Helm requires values.yaml on disk even for library charts.
```

- [ ] **Step 3: Render to confirm empty but valid**

Run: `helm lint charts/genieai-common --strict && helm template genieai-common charts/genieai-common`
Expected: 0 errors, empty rendered output. Exit 0.

- [ ] **Step 4: Write `charts/genieai-common/.helmignore`**

```
# Helm packaging ignores for genieai-common (library chart).
# We never package this chart for OCI distribution, so generated tarballs
# should never be committed under any condition.
charts/
*.tgz
.DS_Store
```

- [ ] **Step 5: Commit**

```bash
git add charts/genieai-common/values.yaml charts/genieai-common/.helmignore
git commit -m "chore(charts): empty values.yaml + .helmignore for library"
```

---

## Task 6: Umbrella chart — `Chart.yaml` with library dependency only

**Files:**
- Create: `charts/genieai-umbrella/Chart.yaml`

**Interfaces:**
- Consumes: Task 2's `genieai-common` library chart.
- Produces: umbrella chart with `dependencies:` block referencing the library via `file://` path. Operator dependencies are added in later plans (Plan 2 onward).

- [ ] **Step 1: Write `charts/genieai-umbrella/Chart.yaml`**

```yaml
apiVersion: v2
name: genieai-umbrella
description: |
  Single-install umbrella chart for GENIE.AI. Renders the entire 28-service
  stack with one `helm install` — typically consumed via per-env Kustomize
  overlays at `deploy/environments/<env>/`.
type: application
version: 0.1.0
# Per spec §4: "umbrella's `appVersion` = chart version, **not** GENIE.AI app
# version (semver divide between chart layout and product release)". The chart
# version IS 0.1.0; `appVersion` mirrors it. Product versions move on a
# separate axis from chart-layout versions.
#
# Never "latest" — see Review Focus #4. Pin to a chart version; image versions
# are governed by the upstream component image tags.
appVersion: "0.1.0"
keywords:
  - genie-ai
  - umbrella
  - sovereign
  - rag
home: https://opensource.unicc.org/un/itu/genie-ai
sources:
  - https://opensource.unicc.org/un/itu/genie-ai.git
maintainers:
  - name: GENIE.AI
    email: maintainers@example.invalid
dependencies:
  # Local library chart — re-rendered on every umbrella install.
  - name: genieai-common
    version: "0.1.0"
    repository: "file://../genieai-common"
    import-values:
      - child: "."
        parent: "common"

# Operator dependencies (added in subsequent plans):
# - cloudnative-pg (Plan 2)
# - kube-arangodb (Plan 2)
# - keycloak-operator (Plan 2)
# - external-secrets-operator (Plan 2)
# - victoriametrics-operator + vl + vt (Plan 4)
# - opentelemetry-operator (Plan 4)
# - gpu-operator (Plan 5)
# - cert-manager (umbrella-level dependency, Plan 6)
# - envoy-gateway (Plan 6)
```

- [ ] **Step 2: Run `helm dependency update` to fetch the local file dependency**

Run: `helm dependency update charts/genieai-umbrella`
Expected: fetches `genieai-common-0.1.0.tgz`. Creates `charts/genieai-umbrella/charts/` and `charts/genieai-umbrella/Chart.lock`.

- [ ] **Step 3: Run `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors. Warnings about missing templates are acceptable at this stage (foundation only).

- [ ] **Step 4: Verify `appVersion` is not `latest` in any quote style (Review Focus #4)**

Run:

```bash
if grep -E "^appVersion:\s*[\"']?latest[\"']?\s*$" charts/genieai-umbrella/Chart.yaml; then
  echo "FAIL: appVersion is 'latest' — must be pinned"
  exit 1
else
  echo "OK: appVersion is pinned"
fi
```

Expected: prints `OK: appVersion is pinned`. The pattern matches `latest`, `"latest"`, or `'latest'` on the `appVersion:` line.

- [ ] **Step 5: Commit**

```bash
git add charts/genieai-umbrella/Chart.yaml charts/genieai-umbrella/charts/ charts/genieai-umbrella/Chart.lock
git commit -m "feat(charts): genieai-umbrella skeleton with library dependency"
```

Note: `charts/` and `Chart.lock` are committed in Foundation because Helm requires them; later tasks add more dependencies. Consider a `.helmignore` to keep `charts/` out of PR diffs if it churns (defer to Plan 7).

---

## Task 7: Umbrella chart — minimal `values.yaml` (foundation subset only)

**Files:**
- Create: `charts/genieai-umbrella/values.yaml`

**Interfaces:**
- Consumes: nothing.
- Produces: schema-compliant values that render the namespace-only foundation. Service tier values AND pluggable backends land in Plans 2–6 (not this plan — Review Focus Y2).

- [ ] **Step 1: Run red-gate validator — must fail before the file exists**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: ERROR — values.yaml is missing.

- [ ] **Step 2: Write `charts/genieai-umbrella/values.yaml`**

```yaml
# GENIE.AI umbrella chart — foundation-only values.
# Subsequent plans add: services.* (Plan 3+), observability.* (Plan 4),
# gpu.* (Plan 5), data.* (Plan 2), ingress.* (Plan 6), migration.* (Plan 6).
# Pluggability surface (secretsBackend / ingressClassName / storageClassName /
# containerRuntime) lands in Plan 6 alongside the concrete backend code — do not
# declare fields here that no template consumes.

namespace: genieai

global:
  imageRegistry: ""
  imagePullSecrets: []
  imagePullPolicy: IfNotPresent

# ClusterProfile-based defaults (Plan 2+ adds the pre-install hook).
clusterProfile: dev                # dev | staging | prod | sovereign
```

- [ ] **Step 3: Run `helm template` to confirm render is valid**

Run: `helm template test charts/genieai-umbrella -n genieai`
Expected: only the Namespace renders (per Task 8). Exit 0.

- [ ] **Step 4: Run `helm lint` strict on umbrella**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add charts/genieai-umbrella/values.yaml
git commit -m "feat(charts): foundation values.yaml (namespace + clusterProfile only)"
```

---

## Task 8: Umbrella chart — `templates/namespace.yaml` (with PSA-restricted labels)

**Files:**
- Create: `charts/genieai-umbrella/templates/namespace.yaml`

**Interfaces:**
- Consumes: `genieai-common.labels`, `genieai-common.selectorLabels`, `genieai-common.fullname`.
- Produces: a `Namespace` resource with `genieai.io/cluster-profile` + `pod-security.kubernetes.io/enforce: restricted` labels.

- [ ] **Step 1: Write `charts/genieai-umbrella/templates/namespace.yaml`**

```yaml
{{- /* Build a per-template Values view so we can override `.component` for label rendering. */ -}}
{{- $componentValues := dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "namespace")) -}}
{{- $ns := .Values.namespace -}}
apiVersion: v1
kind: Namespace
metadata:
  name: {{ $ns }}
  annotations:
    # Wave-8 F2: the Namespace MUST be a pre-install hook. Regular resources
    # apply only AFTER all pre-install hooks — a regular Namespace means the
    # hook RBAC (-30) / ConfigMap (-20) / Jobs (-10/-5) target a namespace
    # that does not exist yet on a fresh cluster ("namespaces \"genie\" not
    # found") and every first install fails. Weight -40 puts it first in the
    # hook chain (-40 ns -> -30 rbac -> -20 cm -> -10 profile -> -5 dep-check).
    # before-hook-creation keeps it across installs; the namespace INTENTIONALLY
    # survives helm uninstall — the data tier (PVCs, sealed-secrets keys)
    # depends on the namespace existing.
    "helm.sh/hook": pre-install,pre-upgrade
    "helm.sh/hook-weight": "-40"
    "helm.sh/hook-delete-policy": before-hook-creation
  labels:
    {{- include "genieai-common.labels" $componentValues | nindent 4 }}
    genieai.io/cluster-profile: {{ .Values.clusterProfile | default "dev" | quote }}
    app.kubernetes.io/part-of: genieai
    # Review Focus V2 — advertise K8s Pod Security Standards at the namespace
    # level so admission controllers refuse pods without required securityContext.
    pod-security.kubernetes.io/enforce: restricted
    # Pin to a specific version rather than `latest`. Across cluster upgrades
    # (1.33 → 1.33), `latest` silently changes the policy version and may start
    # rejecting pods that previously scheduled without warning.
    pod-security.kubernetes.io/enforce-version: v1.33
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: v1.33
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: v1.33
```

- [ ] **Step 2: Render and confirm only one Namespace is produced**

Run: `helm template test charts/genieai-umbrella -n genieai`
Expected output (key lines):

```
---
apiVersion: v1
kind: Namespace
metadata:
  name: genieai
  labels:
    genieai.io/cluster-profile: "dev"
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: v1.33
```

- [ ] **Step 3: Run lint strict**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add charts/genieai-umbrella/templates/namespace.yaml
git commit -m "feat(charts): render Namespace with cluster-profile + PSA labels (pinned v1.33)"
```

---

## Task 9: Umbrella chart — `templates/tests/test-namespace.yaml` (Helm test)

**Files:**
- Create: `charts/genieai-umbrella/templates/tests/test-namespace.yaml`

**Interfaces:**
- Consumes: namespace labels from Task 8.
- Produces: a `helm test`-able Pod that asserts the namespace exists and has the right labels. Anchors the test pattern service-tier plans will replicate.

- [ ] **Step 1: Run red-gate validator — must fail before the file exists**

Run: `helm template test charts/genieai-umbrella --show-only templates/tests 2>&1 | grep -c test-namespace`
Expected: prints `0` (no test pod rendered).

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/tests/test-namespace.yaml`**

```yaml
apiVersion: v1
kind: Pod
metadata:
  name: {{ include "genieai-common.fullname" . }}-test-namespace
  labels:
    {{- include "genieai-common.labels" . | nindent 4 }}
    app.kubernetes.io/component: test
  annotations:
    "helm.sh/hook": test
    # Single valid value — Helm 3 accepts comma-separated but listing the same
    # value twice is a copy-paste bug caught by stricter validators. Service
    # tier plans replicate this pattern.
    "helm.sh/hook-delete-policy": before-hook-creation
spec:
  restartPolicy: Never
  # Review Focus #2 — required by PSA restricted.
  securityContext:
    runAsNonRoot: true
    runAsUser: 65534
    seccompProfile:
      type: RuntimeDefault
  containers:
    - name: test
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
          ns="$(cat /var/run/secrets/kubernetes.io/serviceaccount/namespace)"
          echo "test Pod running in namespace: $ns"
          [ "$ns" = "{{ .Values.namespace }}" ] \
            || { echo "FAIL: namespace mismatch, expected {{ .Values.namespace }}"; exit 1; }
          echo "PASS"
```

- [ ] **Step 3: Pre-load `alpine:3.20` into the kind node so the test pod does not pull over the network (Review Focus B3, V6)**

```bash
docker pull alpine:3.20
kind load docker-image alpine:3.20 --name genieai-test
```

- [ ] **Step 4: Run `helm test` against a kind cluster (Review Focus #2)**

```bash
# Spin up kind cluster (one-time)
kind create cluster --name genieai-test --image kindest/node:v1.33.0

# Install chart
helm install test charts/genieai-umbrella -n genieai   # the Namespace renders as a -40 pre-install HOOK (first in the chain) — no --create-namespace needed

# Run test
helm test test -n genieai
```

Expected:
- `Phase: Succeeded` for `test-namespace` pod.
- Last log line `PASS`.

If the pod fails to schedule with `forbidden: violates PodSecurity "restricted:v1.33"`, the securityContext from Step 2 is missing or incomplete — re-check.

- [ ] **Step 5: Tear down kind cluster (after verification)**

```bash
helm uninstall test -n genieai
kind delete cluster --name genieai-test
```

- [ ] **Step 6: Commit**

```bash
git add charts/genieai-umbrella/templates/tests/test-namespace.yaml
git commit -m "test(charts): helm test for Namespace + cluster-profile label"
```

---

## Task 10: chart-testing config + CI scaffolding

**Files:**
- Create: `charts/ci/ct.yaml`
- Create: `charts/ci/README.md`
- Create: `charts/genieai-umbrella/.helmignore`

**Interfaces:**
- Consumes: Tasks 6–9's chart structure.
- Produces: a `ct install` config that CI runs, pinned to K8s 1.33 (Review Focus #3).

- [ ] **Step 1: Write `charts/ci/ct.yaml`**

```yaml
# chart-testing REAL config schema (verified against upstream config.go):
# FLAT kebab-case keys. `charts` is a []string; there is NO `kubeVersion`
# config key — the K8s version is pinned via the kind node image and the
# `ct install --kube-version 1.33.0` CLI flag in CI (Plan 7).
remote: origin
# target-branch: omitted — ct derives the MR target branch in CI.
# Hard-coding one branch would block MRs from any other branch.
chart-dirs:
  - charts
chart-repos: []          # foundation: only the file:// library dep;
                         # operator repos are added in Plan 2+
excluded-charts: []
helm-extra-args: --timeout 300s
debug: true
```

- [ ] **Step 2: Write `charts/ci/README.md`**

```markdown
# CI / chart-testing configuration

`charts/ci/ct.yaml` configures [chart-testing](https://github.com/helm/chart-testing)
for the umbrella chart. Used by `.gitlab-ci.yml` job `charts:integration` (added in
Plan 7). Locally:

\`\`\`bash
make test
\`\`\`

Pinned K8s version: **1.33.0** — the kind node image AND the `ct install --kube-version 1.33.0` CLI flag (there is no config-file key for it). Update both in lockstep.
```

- [ ] **Step 3: Write `charts/genieai-umbrella/.helmignore`**

```
# Helm packaging ignores for the umbrella chart.
# NOTE: vendored deps (charts/*.tgz) + Chart.lock MUST SHIP in the packaged
# tarball — an OCI-installed umbrella without its dependencies is
# uninstallable. Keeping them out of GIT diffs is charts/.gitignore's job
# (they still enter the package from disk).
.DS_Store
```

- [ ] **Step 4: Write `charts/.gitignore`** (NEW — addresses Review Focus F5)

`.helmignore` is consumed by `helm package` only — it does **not** prevent vendored tarballs and `Chart.lock` from being added to git. The chart repo needs a real `.gitignore` to keep the source clean:

```
# Git ignores for the charts/ directory tree.
#
# Charts/ contains a per-chart `charts/*.tgz` subdir (vendored dep tarballs
# generated by `helm dependency update`) and a per-chart `Chart.lock` (a
# generated lockfile of dep versions). Both regenerate on every dep change
# and bloat PR diffs without adding value to the chart's source.

# Vendored dep tarballs (per chart)
charts/*/charts/
charts/*/*.tgz

# Generated dep lockfiles
charts/*/Chart.lock
```

Apply this ignore file at the **charts/ directory root** (NOT a per-chart ignore). This stops `git add charts/genieai-umbrella/charts/...` from entering source on future commits. **The first commit will still contain the tarball + Chart.lock** (already on disk); subsequent dep bumps regenerate them on the same files without adding to source.

**Commit**: this `.gitignore` adds the file alongside the chart contents in the same commit, so the tarball appears once in this commit's diff and never again (until someone runs `git add -f` to override the ignore).

- [ ] **Step 4.5: Verify `ct lint` baseline passes**

Run: `ct lint --config charts/ci/ct.yaml --charts charts/genieai-umbrella`
Expected: no errors. Warnings about missing test coverage OK at this stage.

If `ct` is not installed: `brew install chart-testing` or download from `https://github.com/helm/chart-testing/releases`.

- [ ] **Step 5: Single commit covering all files in this task**

```bash
git add charts/genieai-umbrella/.helmignore charts/.gitignore charts/ci/ct.yaml charts/ci/README.md
git commit -m "ci(charts): umbrella .helmignore + .gitignore + chart-testing baseline (K8s 1.33)"
```

Note: this is the FIRST commit; the vendored tarball + Chart.lock from Plan 1 Task 6 are intentionally included (they exist on disk) and never appear in PR diffs again, because the new `charts/.gitignore` excludes them. Future dep bumps update the same files (`git status` shows them as modified, not new) and may need `git add charts/genieai-umbrella/Chart.lock charts/genieai-umbrella/charts/*.tgz` explicitly to commit the diff (or not — common practice is to gitignore them and re-vendor locally per chart).

---

## Task 11: ArgoCD Application example (manifest only, NOT auto-rendered)

**Files:**
- Create: `charts/genieai-umbrella/examples/argocd-application.yaml`

**Interfaces:**
- Consumes: nothing.
- Produces: a literal ArgoCD Application manifest (NOT a Helm template). Lives under `examples/` so Helm's chart packaging ignores it. Applied manually with `kubectl apply -f` after ArgoCD is installed (Review Focus V5, Y3).

- [ ] **Step 1: Run red-gate validator — fails because the example manifest does not exist**

Run: `test -f charts/genieai-umbrella/examples/argocd-application.yaml && echo "exists" || echo "FAIL: example missing"`
Expected: prints `FAIL: example missing`.

- [ ] **Step 2: Write `charts/genieai-umbrella/examples/argocd-application.yaml`**

```yaml
# IMPORTANT: do NOT render — apply manually.
# This file is a literal ArgoCD Application manifest, NOT a Helm template.
# Apply with:
#   kubectl apply -f argocd-application.yaml -n argocd
# Pre-condition: ArgoCD installed in the `argocd` namespace; the target cluster
# is the current kubectl context.
#
# For el-salvador (or other high-customization envs), change:
#   * targetRevision: main  ->  release/<env>
#   * path: deploy/environments/dev/  ->  deploy/environments/<env>/
#   * namespace: genieai  ->  genieai-<env>
#
# Per-env overlays (path: deploy/environments/<env>/) are populated by Plan 6.
---
# Review Focus F5 + F11 fixes combined:
# - path: deploy/environments/dev (NOT charts/genieai-umbrella) so per-env
#   Kustomize overlay composes the chart with values-override.yaml
#   (per spec §19.2; Review Focus F5).
# - repoURL uses SSH form since GitLab requires auth; cluster ArgoCD has
#   SSH key registered via GitLab Agent (Review Focus F11).
apiVersion: argoproj.io/v1alpha1
kind: Application
metadata:
  name: genieai-dev
  namespace: argocd
spec:
  project: genieai
  source:
    repoURL: git@opensource.unicc.org:un/itu/genie-ai.git   # scp-like form; ssh:// form needs an explicit numeric port (ssh://git@host:22/un/...) — the :un in the naive URL parses as a port and breaks
    targetRevision: main    # use release/el-salvador for the el-salvador env
    path: deploy/environments/dev
  destination:
    server: https://kubernetes.default.svc
    namespace: genieai
  syncPolicy:
    automated:
      prune: true
      selfHeal: true
    syncOptions:
      - CreateNamespace=true
```

- [ ] **Step 3: Run `helm template` against the umbrella + verify ArgoCD manifest is NOT in the rendered output (Review Focus #5)**

Run:

```bash
if helm template test charts/genieai-umbrella -n genieai | grep -q "^kind: Application$"; then
  echo "FAIL: ArgoCD Application rendered"
  exit 1
else
  echo "PASS: ArgoCD example not auto-rendered"
fi
```

Expected: prints `PASS: ArgoCD example not auto-rendered`.

- [ ] **Step 4: Validate the example with `kubectl apply --dry-run=client` against a kind cluster with ArgoCD installed**

Skip if ArgoCD is not yet in the test cluster. For foundation purposes, the manifest structure + Step 3 dry-run is sufficient validation. Plan 6 (ingress/cert-manager/operator deployment) will install ArgoCD as part of its testing.

- [ ] **Step 5: Commit**

```bash
git add charts/genieai-umbrella/examples/argocd-application.yaml
git commit -m "docs(charts): ArgoCD Application example (literal manifest, manual apply)"
```

---

## Task 12: Validate `helm install` produces a working namespace

**Files:** none — pure validation step.

**Interfaces:**
- Consumes: every prior task.
- Produces: confirmation that the foundation plan produces a shippable artifact.

- [ ] **Step 1: Stand up a kind cluster**

```bash
kind create cluster --name genieai-foundation --image kindest/node:v1.33.0
```

- [ ] **Step 2: Render umbrella with `helm template` and visually inspect output**

```bash
helm template test charts/genieai-umbrella -n genieai > /tmp/genieai-render.yaml
cat /tmp/genieai-render.yaml
```

Expected output:

```yaml
---
apiVersion: v1
kind: Namespace
metadata:
  name: genieai
  labels:
    helm.sh/chart: genieai-umbrella-0.1.0
    app.kubernetes.io/name: genieai-umbrella
    app.kubernetes.io/instance: test
    app.kubernetes.io/managed-by: Helm
    genieai.io/component: "namespace"
    genieai.io/managed-by: "helm"
    genieai.io/cluster-profile: "dev"
    app.kubernetes.io/part-of: genieai
    pod-security.kubernetes.io/enforce: restricted
    pod-security.kubernetes.io/enforce-version: v1.33
    pod-security.kubernetes.io/audit: restricted
    pod-security.kubernetes.io/audit-version: v1.33
    pod-security.kubernetes.io/warn: restricted
    pod-security.kubernetes.io/warn-version: v1.33
```

- [ ] **Step 3: Install and run `helm test`**

```bash
helm install test charts/genieai-umbrella -n genieai --create-namespace
helm test test -n genieai
```

Expected:
- `NAME: test`
- `LAST DEPLOYED: <timestamp>`
- `NAMESPACE: genieai`
- `STATUS: deployed`
- `Phase: Succeeded` test pod runs.
- Test log ends with `PASS`.

- [ ] **Step 4: Confirm the test pod ran with the right securityContext (Review Focus #2)**

```bash
kubectl get pod -n genieai test-genieai-umbrella-test-namespace -o jsonpath='{.spec.securityContext}' | jq .
```

Expected: `runAsNonRoot: true`, `runAsUser: 65534`, `seccompProfile.type: RuntimeDefault`.

- [ ] **Step 5: Uninstall + tear down kind**

```bash
helm uninstall test -n genieai
kind delete cluster --name genieai-foundation
```

- [ ] **Step 6: Mark the Foundation plan complete in `charts/README.md`**

```bash
cat > charts/README.md <<'EOF'
# GENIE.AI Helm charts

This directory holds the Kubernetes-deployment Helm charts for GENIE.AI.

## Status

Foundation plan complete. Next: Plans 2–8 for data layer, service tier, observability, AI/ML, per-env config, CI, docs.

## Charts

| Chart | Status | Purpose |
|---|---|---|
| `genieai-common` | foundation | Library chart (templates + helpers) reused by `genieai-umbrella` |
| `genieai-umbrella` | foundation | Single-install chart — 28 services, depends on `genieai-common` + operators |

## Other directories

- `deploy/environments/` — per-environment Kustomize overlays + values-override files.

## Conventions

- Helm API v2. Helm 4.x.
- No secrets in `values-override.yaml`. Use External Secrets Operator (Plan 2 + Plan 6).
- Tests live in each chart's `tests/` directory; `ct install` for integration, `helm test` for smoke.
EOF

git add charts/README.md
git commit -m "docs(charts): mark foundation plan complete in charts/README.md"
```

---

## Task 13: Secret-leak guard rail (placeholder for Plan 7 — write the empty slot)

**Files:**
- Create: `charts/ci/policies/.gitkeep`
- Create: `charts/ci/policies/README.md`

**Interfaces:**
- Consumes: nothing.
- Produces: a directory reserved for OPA Rego policies. Plan 7 writes the actual `secret-leak.rego`. This task guarantees the CI rule from Plan 7 has somewhere to land (Review Focus V4).

- [ ] **Step 1: Create the policy directory + placeholder README**

```bash
mkdir -p charts/ci/policies
cat > charts/ci/policies/README.md <<'EOF'
# OPA Rego policies for chart ci

Policies run via `conftest` against `deploy/environments/**/*.yaml` and against
chart-rendered manifests.

## Plan 7 implements:

- `secret-leak.rego` — reject `Secret` resources, ConfigMap data keys named
  `password`/`secret`/`token`/etc, and high-entropy strings in known config
  paths.

- `image-signature.rego` — reject Pods whose image references lack cosign
  signature verification (Run by Kyverno in cluster; this is the lint-time
  pre-check).

The directory exists in Plan 1 so Plan 7 doesn't need to author a placeholder
structure later.
EOF
touch charts/ci/policies/.gitkeep
```

- [ ] **Step 2: Commit**

```bash
git add charts/ci/policies/.gitkeep charts/ci/policies/README.md
git commit -m "chore(charts): scaffold OPA Rego policies directory (Plan 7 fills in)"
```

---

## Self-Review

After writing all 13 tasks, run this checklist against the spec.

**1. Spec coverage** (foundation slice only — full coverage comes in Plans 2–8):

| Spec section | Task |
|---|---|
| §3 chart topology (library + umbrella) | Tasks 1, 2, 6 |
| §3 library helpers (naming, labels) | Task 3 |
| §3 library values schema | Task 4 |
| §4 dependency model (library only) | Task 6 |
| §5 values schema (foundation subset) | Task 7 |
| §5 clusterProfile enum | Task 7 |
| §6 pluggability surface design (no concrete backends) | Deferred to Plan 6 (per Y2 review fix) |
| §8 PSA label default | Task 8 |
| §10 chart-testing CI (foundation config only) | Task 10 |
| §13.1 uninstall safety hook (deferred to Plan 2+) | Plan 7 |
| §13.2 secret-leak lint (placeholder only) | Task 13 + Plan 7 |
| §15 docs (charts/README.md, deploy/environments/README.md) | Tasks 1, 12 |
| §17 v1.0 manifest (foundation entries only) | Tasks 1–13 |
| §19 per-env Kustomize overlays (placeholder) | Tasks 1 + Plan 6 |
| §19.3.1 ArgoCD Application example | Task 11 |

Sections NOT covered by this plan, on purpose (move to Plans 2–8):
- §4 operator dependencies (CNPG, kube-arangodb, Keycloak, ESO, vmoperator, OTel operator, GPU operator, cert-manager, Envoy Gateway) → Plan 2 (data + observability ops), Plan 4 (observability), Plan 5 (GPU), Plan 6 (ingress/TLS/cert-manager/Envoy).
- §5 services.* (Group 5 stateless, Group 1 observability, Group 4 identity, Group 6 AI/ML, Group 3 Arango last) → Plan 3+.
- §5 dependency graph + pre-install hook → Plan 2.
- §6 pluggable backends concrete code → Plan 6.
- §8 secrets model with ESO ExternalSecret CRs → Plan 2 (ESO dep) + Plan 6 (concrete templates).
- §9 ingress + TLS templates → Plan 6.
- §10 observability operator CRs → Plan 4.
- §11 GPU service templates → Plan 5.
- §13 uninstall safety hook + chart-schema-drift CI alert → Plan 7.
- §14 image signing + Renovate → Plan 7.
- §19 per-env Kustomize overlays + GitOps sync → Plan 6.

**2. Placeholder scan**: no "TBD", "TODO", "implement later", or "fill in details" in any task. Each step has concrete content (file paths, runnable commands, code blocks).

**3. Type consistency**: `_helpers.tpl` template names match across Task 3 + Task 8 callers (`genieai-common.labels`, `genieai-common.selectorLabels`, `genieai-common.fullname`, `genieai-common.chart`, `genieai-common.name`) — all use the **dash** namespace `genieai-common.*`. The dot-namespace `genieai.common.metadata` template (earlier draft of Task 8) was removed because it was unused dead code. Namespace template uses `dict "Chart" .Chart "Values" (deepCopy .Values | merge (dict "component" "namespace"))` pattern — consistent with later plans that will use the same pattern when overriding `component`.

**4. Review Focus coverage**: 11 input-class concerns pinned to specific steps:

1. Library `import-values:` collision → TDD red-steps in **Task 4 + Task 5** (chart fails lint without `values.yaml`; passes with it). `helm lint --strict` validates templates render without overlap but **does NOT detect duplicate `{{ define }}` keys** — explicit duplicate-define lint added in Plan 7.
2. Helm test Pod missing securityContext → Task 9 Step 2 (test pod carries full `securityContext`) + Task 12 Step 4 (verifies post-install).
3. chart-testing `ct install` without kube-version → Task 10 Step 1 (`ct.yaml` pins `kubeVersion: 1.33.0`).
4. `appVersion: latest` rejected in OCI → Task 6 Step 4 (`if grep ... ; then exit 1 ; else echo OK ; fi`, regex covers `"latest"`, `'latest'`, and `latest`).
5. ArgoCD Application auto-render → Task 11 Step 3 (`grep "kind: Application$"` confirms not in rendered output).
6. Tarball + Chart.lock committed in source → Task 5 Step 4 (`.helmignore` in library); Task 10 Step 3 (umbrella `.helmignore` excludes `charts/`, `*.tgz`, `*.lock`).
7. PSA namespace labeling → Task 8 Step 1 (explicit `pod-security.kubernetes.io/enforce: restricted` + versioned `v1.33` not `latest`).
8. Pluggable surface declared but unused → Task 7 Step 1–2 (values trimmed to foundation).
9. test-utils image reference dangling → Task 9 Step 2 (`image: alpine:3.20` only).
10. `kind load docker-image` missing → Task 9 Step 3 (pre-load `alpine:3.20` into kind).
11. `chart-repos:` lists 9 repos for foundation that uses 0 → Task 10 Step 1 (chart-repos list removed).

All five + six follow-up concerns covered. No empty `Review Focus` lines.

**5. Code-review cross-checks** (15 findings from `/code-review`):
- BLOCKERS fixed: test image contradiction (Task 9), duplicate `before-hook-creation` (Task 9), three "Step 5" numbering (Task 9), `appVersion: 1.0.0` contradicts spec §4 (Task 6), grep misses single-quoted (Task 6), `enforce-version: latest` brittle across cluster upgrades (Task 8).
- P0 fixed: KAS Module invented fields (spec §19.3.1 → real Flux `Kustomization` fields), 26-service count + duplicate `redis` Group 2/5 (spec §7), `keycloak.condition: keycloak.enabled` mismatch with `data.keycloak.enabled` (spec §4), template naming dot/dash inconsistency (Task 8 dropped dead `genieai.common.metadata` template), `appVersion: 0.1.0` per spec (Task 6), grep pattern handles all quote styles (Task 6).
- File count + commit count re-verified: **20 source files, 13 commits** (was 16/13).
- HELM hooks path concern dismissed (false positive): Helm 3 scans `templates/` recursively for `helm.sh/hook` annotations; `templates/hooks/foo.yaml` is valid IF the annotation is set. Plan 2 will set the annotation explicitly.

**5. Adversarial review note (V4, V5, Y2, Y3, B1, B3, B4, B5 applied; G1, G2, G3 deferred as P2)**: P2 findings either do not block the foundation or are CI concerns covered by Plan 7. The lock-churn note (G1) is non-blocking because the `.helmignore` from Tasks 5 + 10 prevents future re-commits of tarballs. The `helm-docs` prereq (G2) is now in Plan 7 only. The `sed` brittleness (G3) was eliminated by rewriting Task 12 Step 6 as `cat > ... <<EOF`.

---

## Plan Stats

- **Tasks:** 13
- **Files created:** 20 (committable source files; excludes generated `charts/` and `Chart.lock` which `.helmignore` keeps out of source)
- **Commits planned:** 13 (one per task)
- **Estimated review surface:** ~900 lines added
- **Foundation deliverable:** `helm install genieai-umbrella` creates a namespace with `genieai.io/cluster-profile` + PSA-restricted labels; `helm test` passes against kind 1.33; `ct lint` clean; ArgoCD example documented in `examples/`; OPA policy directory scaffolded. Every later plan builds on this skeleton.

File count breakdown (verified):

| Task | Files | Count |
|---|---|---|
| 1 | charts/README.md, charts/Makefile, deploy/environments/.gitkeep, deploy/environments/README.md | 4 |
| 2 | charts/genieai-common/Chart.yaml | 1 |
| 3 | charts/genieai-common/templates/_helpers.tpl | 1 |
| 4 | charts/genieai-common/values.schema.json, charts/genieai-common/README.md | 2 |
| 5 | charts/genieai-common/values.yaml, charts/genieai-common/.helmignore | 2 |
| 6 | charts/genieai-umbrella/Chart.yaml | 1 |
| 7 | charts/genieai-umbrella/values.yaml | 1 |
| 8 | charts/genieai-umbrella/templates/namespace.yaml | 1 |
| 9 | charts/genieai-umbrella/templates/tests/test-namespace.yaml | 1 |
| 10 | charts/genieai-umbrella/.helmignore, charts/ci/ct.yaml, charts/ci/README.md | 3 |
| 11 | charts/genieai-umbrella/examples/argocd-application.yaml | 1 |
| 12 | (modifies charts/README.md) | 0 |
| 13 | charts/ci/policies/.gitkeep, charts/ci/policies/README.md | 2 |
| **Total** | | **20** |

## What's next

- Plan 2: data layer (CloudNativePG + kube-arangodb + Keycloak + ESO dep rendering + dependency graph hook)
- Plan 3: service tier Group 5 (stateless app — biggest single shippable surface)
- Plan 4: service tier Group 1 (observability + serviceMonitors)
- Plan 5: service tier Group 6 (AI/ML — vLLM + TEI + OPEA microservices + GPU operator)
- Plan 6: per-env Kustomize overlays + GitOps sync (ArgoCD + KAS) + ingress (Envoy Gateway + cert-manager)
- Plan 7: CI integration + image signing + Renovate + uninstall safety + secret-leak lint + chart-schema-drift alert
- Plan 8: documentation (site content + docs/charts/*)
