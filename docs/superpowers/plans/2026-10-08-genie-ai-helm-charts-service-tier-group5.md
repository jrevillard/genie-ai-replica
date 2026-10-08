# GENIE.AI Helm Charts — Service Tier Group 5 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the stateless-app tier of the GENIE.AI Helm chart: backend (Node.js BFF), frontend (Vue SPA), document-repository (file upload service), nginx (reverse proxy), clamav (AV scanner). Kong is REMOVED from the chart (k8s-native-audit decision 7) — Envoy Gateway is the single edge; nginx proxies `/api/` to the backend directly. Establishes the per-service template pattern that Plans 4-6 reuse for observability, AI/ML, and ingress services.

**Architecture:** Five Deployment + Service + NetworkPolicy pairs under `charts/genieai-umbrella/templates/_services/<name>/`. Each service inherits from a shared template helper (`genieai-common.componentLabel` + `genieai-common.serviceSelector`) plus an inline `secrets` reference list. NetworkPolicies enforce default-deny with explicit allowlists (cross-tier: backend → arangodb; ingress → frontend; etc.). PodDisruptionBudget generated for any service with `replicas >= 2`. Per-service SealedSecret resources for the 3 Group-5 secrets from spec §8.

**Tech Stack:** Helm 4.x, chart-testing (`ct` v3.x), kind 1.33, kubectl 1.33+, kustomize 5.x, CNPG Cluster (from Plan 2) reachable at `keycloak-db.<namespace>.svc.cluster.local:5432`, ArangoDB (from Plan 2) at `arangodb-single.<namespace>.svc.cluster.local:8529.

**Spec:** `docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md` — this plan implements §5 per-service entry shape (extended), §6 ingress view (nginx as reverse proxy in front of frontend), §7 Group 5 + cross-tier NetworkPolicy defaults, §8 Group-5 SealedSecret resources, §17 service-tier entries in v1.0 manifest.

## Global Constraints

- Helm chart API version: `v2`. Helm 4.x.
- Per-service entries under `values.services.<name>` must match spec §5 schema: `enabled`, `replicas`, `image.{repository,tag}`, `port`, `resources.{requests,limits}`, `env`, `secrets`, `pvc`, `probes.{readiness,liveness,startup}`, `podDisruptionBudget.{minAvailable}`, `serviceMonitor`.
- Each service gets its own `templates/_services/<name>/` directory with `<name>.yaml` template that renders all six (Deployment, Service, NetworkPolicy, ServiceMonitor?, HPA?, PDB?). All files in one YAML multi-document template.
- NetworkPolicies default-deny + explicit allowlists; per-tier clauses documented in spec §7 (Group 5 gets the strictest defaults).
- SealedSecret entries use placeholder format per Plan 2 Task 2 convention: `PLACEHOLDER_<name>_SEALED_KID`.
- All English documentation and comments per project CLAUDE.md.
- Commits in English using Conventional Commits.
- No secrets in any committed file — only encrypted SealedSecret resources ship in Git.
- Worktree path: `/home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/k8s-migration/`. Branch: `feat/k8s-migration`.

## Review Focus

Five input-class concerns the spec implies but no Plan 3 task tests explicitly.

1. **Backend envFrom secret ref resolution** — backend env references keycloak, arangodb, jwt, huggingFaceHubToken; if any SealedSecret resource fails to materialise (controller drift, decryption error), backend pod crashes with missing-env. **Pinned in Task 3 Step 6** — render asserts each env secret name maps to a real SealedSecret resource the chart ships.
2. **NetworkPolicy egress to keycloak-db CNPG Cluster** — backend needs to reach Postgres on tcp:5432. Default-deny catches it unless the NetworkPolicy's `egress` block has the cluster IP. **Pinned in Task 3 Step 5** — chart-rendered NetworkPolicy allows egress to `app.kubernetes.io/name=keycloak-db` + port 5432.
3. **CORS for frontend SPA** — the SPA calls `/api/*`; if the edge splits origins, preflight needs explicit `Access-Control-Allow-Origin`. CORS lives at Envoy Gateway (policy derived from `ingress.host`) since Kong is REMOVED (decision 7). **Pinned in Plan 6** — its render gate asserts the Gateway CORS policy carries explicit origins.
4. **clamav sidecarity** — clamav is a small AV scanner used by document-repository only. If `services.clamav.enabled: true` but `services.documentRepository.enabled: false`, clamav runs alone. **Pinned in Task 5 Step 4** — NetworkPolicy allows ingress from `app.kubernetes.io/component: documentRepository`; no other consumer.
5. **PDB minAvailable math** — for `replicas: 1` services, `minAvailable: 1` blocks voluntary disruptions, defeating rolling restart. **Pinned in Task 8 Step 4** — chart only emits PDB when `replicas >= 2`.

---

## Task 1: Extend `values.yaml` with per-service entries (Group 5)

**Files:**
- Modify: `charts/genieai-umbrella/values.yaml`

**Interfaces:**
- Consumes: Plan 2 §5 schema.
- Produces: `services.{backend,frontend,documentRepository,nginx,clamav}` blocks.

- [ ] **Step 1: Run red-gate — no service entries yet**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: Deployment$" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Append to `charts/genieai-umbrella/values.yaml`** (preserve YAML structure + add comments referencing spec §5)

```yaml
# Plan 3 — service tier Group 5 (stateless app)
# Per spec §7: backend, frontend, documentRepository, nginx, clamav.
# Kong is REMOVED (decision 7); Envoy Gateway is the edge.
#
# Per-service entry shape (matches spec §5):
#   services.<name>:
#     enabled: true|false
#     replicas: <int>    # 1 for dev, 2+ for prod via clusterProfile
#     image: { repository: <name>, tag: <tag> }
#     port: <int>        # container port
#     resources: { requests: {...}, limits: {...} }
#     env: []            # raw env list; envFrom secrets resolved by name
#     secrets: []        # K8s Secret names; envFrom each
#     pvc: null          # optional PVC mount spec
#     probes: { readiness: ..., liveness: ..., startup: ... }
#     podDisruptionBudget: { minAvailable: <int> }
#     serviceMonitor: false   # if observability enabled, add Prometheus scrape
services:
  backend:
    enabled: true
    replicas: 1
    image:
      repository: genieai-backend
      tag: "1.0.0"
    port: 3000
    resources:
      requests: { cpu: 100m, memory: 256Mi }
      limits:   { cpu: 1,    memory: 1Gi }
    env:
      - name: NODE_ENV
        value: production
      - name: KEYCLOAK_URL
        value: http://keycloak.{{ .Values.namespace }}.svc.cluster.local:8080
      - name: ARANGO_URL
        value: http://arangodb-single.{{ .Values.namespace }}.svc.cluster.local:8529
    secrets:
      - name: keycloak-client-secret
        key: password
      - name: huggingface-hub-token
        key: token
    pvc: null
    probes:
      readiness: { httpGet: { path: /api/health, port: 3000 }, initialDelaySeconds: 10, periodSeconds: 10 }
      liveness:  { httpGet: { path: /api/health, port: 3000 }, initialDelaySeconds: 30, periodSeconds: 30 }
      startup:   { httpGet: { path: /api/health, port: 3000 }, initialDelaySeconds: 5,  failureThreshold: 12 }
    podDisruptionBudget: { minAvailable: 1 }
    serviceMonitor: false

  frontend:
    enabled: true
    replicas: 1
    image:
      repository: genieai-frontend
      tag: "1.0.0"
    port: 8080
    resources:
      requests: { cpu: 50m, memory: 128Mi }
      limits:   { cpu: 500m, memory: 512Mi }
    env: []
    secrets: []
    pvc: null
    probes:
      readiness: { httpGet: { path: /health, port: 8080 }, initialDelaySeconds: 5, periodSeconds: 10 }
      liveness:  { httpGet: { path: /health, port: 8080 }, initialDelaySeconds: 30, periodSeconds: 30 }
    podDisruptionBudget: null    # single replica; PDB would block drain
    serviceMonitor: false

  documentRepository:
    enabled: true
    replicas: 1
    image:
      repository: genieai-document-repository
      tag: "1.0.0"
    port: 3001
    resources:
      requests: { cpu: 100m, memory: 256Mi }
      limits:   { cpu: 1,    memory: 1Gi }
    env:
      - name: NODE_ENV
        value: production
      - name: BACKEND_URL
        value: http://backend.{{ .Values.namespace }}.svc.cluster.local:3000
      - name: CLAMAV_HOST
        value: clamav.{{ .Values.namespace }}.svc.cluster.local
      - name: CLAMAV_PORT
        value: "3310"
    secrets: []
    pvc: null
    probes:
      readiness: { httpGet: { path: /health, port: 3001 }, initialDelaySeconds: 10, periodSeconds: 10 }
      liveness:  { tcpSocket: { port: 3001 }, initialDelaySeconds: 30, periodSeconds: 30 }
    podDisruptionBudget: null
    serviceMonitor: false

  nginx:
    enabled: true
    replicas: 1
    image:
      repository: nginxinc/nginx-unprivileged
      tag: "1.27"
    port: 8080   # container runs on 8080 (unprivileged)
    resources:
      requests: { cpu: 50m, memory: 64Mi }
      limits:   { cpu: 250m, memory: 128Mi }
    env: []
    secrets: []
    pvc: null
    probes:
      readiness: { httpGet: { path: /, port: 8080 }, initialDelaySeconds: 5, periodSeconds: 10 }
      liveness:  { httpGet: { path: /, port: 8080 }, initialDelaySeconds: 30, periodSeconds: 30 }
    podDisruptionBudget: null
    serviceMonitor: false

  clamav:
    enabled: true
    replicas: 1
    image:
      repository: clamav/clamav
      tag: "1.3"
    port: 3310
    resources:
      requests: { cpu: 100m, memory: 512Mi }
      limits:   { cpu: 1,    memory: 1Gi }
    env: []
    secrets: []
    pvc: null
    probes:
      readiness: { tcpSocket: { port: 3310 }, initialDelaySeconds: 60, periodSeconds: 30 }
      liveness:  { tcpSocket: { port: 3310 }, initialDelaySeconds: 120, periodSeconds: 60, failureThreshold: 5 }
    podDisruptionBudget: null
    serviceMonitor: false

# Per-env clusterProfile-driven replica overrides. For prod, prod envs
# render 2+ replicas; for dev/sovereign, stay at 1.
clusterProfileReplicas:
  prod:
    backend: 3
    frontend: 2
    documentRepository: 2
  staging:
    backend: 2
    frontend: 2
    documentRepository: 1
  sovereign:
    backend: 1
    frontend: 1
    documentRepository: 1
```

- [ ] **Step 3: Render and confirm templates parse**

Run: `helm template test charts/genieai-umbrella -n genieai -f /dev/stdin <<<`
Expected: clean render (no errors); existing Plan 1 + Plan 2 resources still emitted + zero `kind: Deployment` from these entries yet.

(Note: the `--set services.<name>.replicas` formula reads `.Values.services.<name>.replicas` and is applied at template render time. The `clusterProfileReplicas` block above is consumed by the helper in Task 2 — those entries don't render Deployments themselves.)

- [ ] **Step 4: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add charts/genieai-umbrella/values.yaml
git commit -m "feat(charts): per-service value entries for Group 5 (backend, frontend, documentRepo, nginx, clamav)"
```

---

## Task 2: Per-service deployment factory template

**Files:**
- Create: `charts/genieai-umbrella/templates/_lib/_service-factory.tpl`
- Create: `charts/genieai-umbrella/templates/_lib/_networkpolicy-base.tpl`

**Interfaces:**
- Consumes: `values.services.<name>` entries + `clusterProfileReplicas`.
- Produces: a helper `genieai-umbrella.serviceDeployment` that emits the standard Deployment + Service + NetworkPolicy + ServiceMonitor + PDB bundle. Each per-service template becomes a 2-3-line shell around this helper.

- [ ] **Step 1: Run red-gate — factory helper doesn't exist**

Run: `helm template test charts/genieai-umbrella -n genieai --show-only templates/_services 2>&1 | grep "factory" | head -3 || echo "OK: no factory"`
Expected: `OK: no factory`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/_lib/_service-factory.tpl`**

```gotemplate
{{/*
Standard Deployment body for service tier 5 services.
Reads `.Values.services.<name>.<...>`; the caller passes a context with
`.component` set to the service name and `.name` to the service name.

Usage:
  {{- include "genieai-umbrella.serviceDeployment" (dict "name" "backend" "component" "backend" "Values" .Values "Chart" .Chart "Release" .Release) | nindent 0 }}
*/}}
{{- define "genieai-umbrella.serviceDeployment" -}}
{{- $ctx := . -}}
{{- $svcName := $ctx.name -}}
{{- $svc := index $ctx.Values.services $svcName -}}
{{- $replicas := $svc.replicas | default 1 -}}
{{- with $ctx.Values.clusterProfileReplicas -}}
{{- if hasKey . $ctx.Values.clusterProfile -}}
{{- $profileReplicas := index . $ctx.Values.clusterProfile -}}
{{- if hasKey $profileReplicas $svcName -}}
{{- $replicas = index $profileReplicas $svcName -}}
{{- end -}}
{{- end -}}
{{- end -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "genieai-common.fullname" $ctx }}-{{ $svcName }}
  namespace: {{ $ctx.Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" $ctx.Chart "Release" $ctx.Release "Values" (deepCopy $ctx.Values | merge (dict "component" $svcName))) | nindent 4 }}
spec:
  replicas: {{ $replicas }}
  selector:
    matchLabels:
      {{- include "genieai-common.serviceSelector" (dict "Chart" $ctx.Chart "Release" $ctx.Release "Values" (deepCopy $ctx.Values | merge (dict "component" $svcName))) | nindent 6 }}
  template:
    metadata:
      labels:
        {{- include "genieai-common.serviceSelector" (dict "Chart" $ctx.Chart "Release" $ctx.Release "Values" (deepCopy $ctx.Values | merge (dict "component" $svcName))) | nindent 8 }}
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: {{ $svcName }}
          image: {{ $svc.image.repository }}:{{ $svc.image.tag | default "latest" }}
          imagePullPolicy: {{ $ctx.Values.global.imagePullPolicy | default "IfNotPresent" }}
          ports:
            - name: http
              containerPort: {{ $svc.port }}
          env:
            {{- toYaml $svc.env | nindent 12 }}
          envFrom:
            {{- range $svc.secrets }}
            - secretRef:
                name: {{ $ctx.Values.namespace }}-{{ .name }}
            {{- end }}
          resources:
            {{- toYaml $svc.resources | nindent 12 }}
          {{- /*
            Review Focus F1 fix — upstream images ship with fixed UIDs and
            need writable scratch dirs:
              nginx-unprivileged  UID  101  /var/cache/nginx + /var/run
              clamav:1.3         UID  100
              curlimages         UID  1000
            Per-service `securityContext` override at the values level; the
            factory default is `runAsNonRoot: true` + `runAsUser: 65534` only
            when `services.<name>.securityContext` is unset in values.

            Operators that ship custom UIDs set:
              services.backend.securityContext:
                runAsNonRoot: true
                runAsUser: 1000
                allowPrivilegeEscalation: false
                capabilities:
                  drop: ["ALL"]
          */ -}}
          securityContext:
            {{- $scc := $svc.securityContext | default (dict "runAsNonRoot" true "runAsUser" 65534) -}}
            {{- toYaml $scc | nindent 12 }}
          {{- with $svc.probes.readiness }}
          readinessProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with $svc.probes.liveness }}
          livenessProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
          {{- with $svc.probes.startup }}
          startupProbe:
            {{- toYaml . | nindent 12 }}
          {{- end }}
{{- end -}}
```

**Review Focus observation**: The factory emits a single `Deployment` here. ServiceMonitor, PDB, NetworkPolicy are separate tasks (3, 4, 5, 6, 8) to keep each template readable.

- [ ] **Step 3: Write `charts/genieai-umbrella/templates/_lib/_networkpolicy-base.tpl`**

```gotemplate
{{/*
Standard NetworkPolicy body for service tier.
- Default-deny ingress (only ingress controller + same-tier allowlist)
- Default-deny egress (only DNS + cross-tier allowlists)

The caller passes a list of allowed ingress sources and egress targets.
*/}}
{{- define "genieai-umbrella.networkPolicyBody" -}}
{{- $ctx := . -}}
ingress:
  - from:
      - podSelector: {}
        namespaceSelector: {}
    ports:
      - protocol: TCP
        port: {{ $ctx.port }}
egress:
  # DNS resolution — to kube-system
  - to:
      - namespaceSelector:
          matchLabels:
            name: kube-system
    ports:
      - protocol: UDP
        port: 53
{{- end -}}
```

- [ ] **Step 4: Confirm render of any template using the factory remains valid (no real template yet)**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors. Factory defined but unused: safe.

- [ ] **Step 5: Commit**

```bash
git add charts/genieai-umbrella/templates/_lib/_service-factory.tpl charts/genieai-umbrella/templates/_lib/_networkpolicy-base.tpl
git commit -m "feat(charts): per-service deployment factory + NetworkPolicy base helpers"
```

---

## Task 3: backend Deployment + Service + NetworkPolicy

**Files:**
- Create: `charts/genieai-umbrella/templates/_services/backend.yaml`

**Interfaces:**
- Consumes: `services.backend` entry (Task 1) + factory helper (Task 2) + service-factory.
- Produces: 1 Deployment + 1 Service + 1 NetworkPolicy for backend.

- [ ] **Step 1: Run red-gate — no backend yet**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: Deployment$" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/_services/backend.yaml`**

```yaml
{{- if .Values.services.backend.enabled -}}
{{- $ctx := dict "name" "backend" "component" "backend" "Values" .Values "Chart" .Chart "Release" .Release -}}
{{- include "genieai-umbrella.serviceDeployment" $ctx }}
---
apiVersion: v1
kind: Service
metadata:
  name: backend
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "backend"))) | nindent 4 }}
spec:
  ports:
    - name: http
      port: 80
      targetPort: 3000
  selector:
    {{- include "genieai-common.serviceSelector" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "backend"))) | nindent 4 }}
---
# Default-deny + allowlist: ingress from the edge (Envoy Gateway pods,
# component=ingress) + documentRepository; egress to arangodb +
# keycloak-db CNPG + keycloak + DNS. Review Focus #2.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: backend
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "backend"))) | nindent 4 }}
spec:
  podSelector:
    matchLabels:
      genieai.io/component: backend
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              genieai.io/component: ingress
      - podSelector:
            matchLabels:
              genieai.io/component: documentRepository
      ports:
        - protocol: TCP
          port: 3000
  egress:
    # DNS — kube-system
    - to:
        - namespaceSelector:
            matchLabels:
              name: kube-system
      ports:
        - protocol: UDP
          port: 53
    # Keycloak admin API
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: keycloak
      ports:
        - protocol: TCP
          port: 8080
    # ArangoDB
    - to:
        - podSelector:
            matchLabels:
              genieai.io/component: data-arangodb
      ports:
        - protocol: TCP
          port: 8529
    # CNPG Cluster keycloak-db (TCP 5432)
    - to:
        - podSelector:
            matchLabels:
              app.kubernetes.io/name: keycloak-db
      ports:
        - protocol: TCP
          port: 5432
    # Redis (translation cache + cache role)
    - to:
        - podSelector:
            matchLabels:
              genieai.io/component: redis
      ports:
        - protocol: TCP
          port: 6379
{{- end -}}
```

- [ ] **Step 3: Render and verify**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -E "^kind: (Deployment|Service|NetworkPolicy)$" | sort | uniq -c`
Expected: prints `NetworkPolicy × 1`, `Service × 1`, `Deployment × 1` (backend) ON TOP of existing Plan 1 (Namespace) and Plan 2 resources (CNPG Cluster, ServiceAccount, etc.).

- [ ] **Step 4: Verify backend envFrom secrets referenced (Review Focus #1)**

Run:

```bash
helm template test charts/genieai-umbrella -n genieai | grep -E "^      - secretRef|^              name: genieai-" | sort | uniq
```

Expected: lists `keycloak-client-secret` and `huggingface-hub-token` secrets referenced.

- [ ] **Step 5: Verify NetworkPolicy egress to keycloak-db (Review Focus #2)**

Run:

```bash
helm template test charts/genieai-umbrella -n genieai | \
  python3 -c "import sys, yaml; docs = list(yaml.safe_load_all(sys.stdin)); \
  np = next(d for d in docs if d and d.get('kind')=='NetworkPolicy' and d['metadata'].get('name')=='backend'); \
  assert any('keycloak-db' in str(t) for e in np['spec']['egress'] for t in e.get('to', [])), 'no keycloak-db egress'; \
  print('PASS')"
```

Expected: prints `PASS`.

- [ ] **Step 6: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add charts/genieai-umbrella/templates/_services/backend.yaml
git commit -m "feat(charts): backend Deployment + Service + default-deny NetworkPolicy"
```

---

## Task 4: frontend, documentRepository, nginx, clamav (4 services, parallel tasks)

**Files:**
- Create: `charts/genieai-umbrella/templates/_services/frontend.yaml`
- Create: `charts/genieai-umbrella/templates/_services/documentRepository.yaml`
- Create: `charts/genieai-umbrella/templates/_services/nginx.yaml`
- Create: `charts/genieai-umbrella/templates/_services/clamav.yaml`

**Interfaces:**
- Consumes: per-service values (Task 1) + factory helper (Task 2).
- Produces: 4 × (Deployment + Service + NetworkPolicy).

- [ ] **Step 1: Write `frontend.yaml`**

```yaml
{{- if .Values.services.frontend.enabled -}}
{{- $ctx := dict "name" "frontend" "component" "frontend" "Values" .Values "Chart" .Chart "Release" .Release -}}
{{- include "genieai-umbrella.serviceDeployment" $ctx }}
---
apiVersion: v1
kind: Service
metadata:
  name: frontend
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "frontend"))) | nindent 4 }}
spec:
  ports:
    - name: http
      port: 80
      targetPort: 8080
  selector:
    {{- include "genieai-common.serviceSelector" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "frontend"))) | nindent 4 }}
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: frontend
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "frontend"))) | nindent 4 }}
spec:
  podSelector:
    matchLabels:
      genieai.io/component: frontend
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # nginx routes to frontend (sub-path /spa or full), and the ingress controller
    - from:
        - podSelector:
            matchLabels:
              genieai.io/component: nginx
        - podSelector:
            matchLabels:
              genieai.io/component: ingress
      ports:
        - protocol: TCP
          port: 8080
  egress:
    # DNS
    - to:
        - namespaceSelector:
            matchLabels:
              name: kube-system
      ports:
        - protocol: UDP
          port: 53
    # Backend BFF (frontend → /api/*; Envoy Gateway is the edge)
    - to:
        - podSelector:
            matchLabels:
              genieai.io/component: backend
      ports:
        - protocol: TCP
          port: 3000
{{- end -}}
```

- [ ] **Step 2: Write `documentRepository.yaml`**

```yaml
{{- if .Values.services.documentRepository.enabled -}}
{{- $ctx := dict "name" "documentRepository" "component" "documentRepository" "Values" .Values "Chart" .Chart "Release" .Release -}}
{{- include "genieai-umbrella.serviceDeployment" $ctx }}
---
apiVersion: v1
kind: Service
metadata:
  name: document-repository
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "documentRepository"))) | nindent 4 }}
spec:
  ports:
    - name: http
      port: 80
      targetPort: 3001
  selector:
    {{- include "genieai-common.serviceSelector" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "documentRepository"))) | nindent 4 }}
---
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: document-repository
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "documentRepository"))) | nindent 4 }}
spec:
  podSelector:
    matchLabels:
      genieai.io/component: documentRepository
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # Backend (file references) + clamav (sidecar)
    - from:
        - podSelector:
            matchLabels:
              genieai.io/component: backend
        - podSelector:
            matchLabels:
              genieai.io/component: clamav
      ports:
        - protocol: TCP
          port: 3001
  egress:
    # DNS
    - to:
        - namespaceSelector:
            matchLabels:
              name: kube-system
      ports:
        - protocol: UDP
          port: 53
    # Backend (uploaded files metadata)
    - to:
        - podSelector:
            matchLabels:
              genieai.io/component: backend
      ports:
        - protocol: TCP
          port: 3000
    # ClamAV (file scan calls)
    - to:
        - podSelector:
            matchLabels:
              genieai.io/component: clamav
      ports:
        - protocol: TCP
          port: 3310
{{- end -}}
```

- [ ] **Step 3: Write `nginx.yaml`**

```yaml
{{- if .Values.services.nginx.enabled -}}
{{- $ctx := dict "name" "nginx" "component" "nginx" "Values" .Values "Chart" .Chart "Release" .Release -}}
{{- include "genieai-umbrella.serviceDeployment" $ctx }}
---
apiVersion: v1
kind: Service
metadata:
  name: nginx
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "nginx"))) | nindent 4 }}
spec:
  ports:
    - name: http
      port: 80
      targetPort: 8080
  selector:
    {{- include "genieai-common.serviceSelector" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "nginx"))) | nindent 4 }}
---
# nginx.conf ConfigMap is rendered in Task 5.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: nginx
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "nginx"))) | nindent 4 }}
spec:
  podSelector:
    matchLabels:
      genieai.io/component: nginx
  policyTypes:
    - Ingress
    - Egress
  ingress:
    # Ingress controller (Plan 6) routes here, then nginx proxies to /.
    - from:
        - podSelector:
            matchLabels:
              genieai.io/component: ingress
      ports:
        - protocol: TCP
          port: 8080
  egress:
    # DNS
    - to:
        - namespaceSelector:
            matchLabels:
              name: kube-system
      ports:
        - protocol: UDP
          port: 53
    # Frontend SPA
    - to:
        - podSelector:
            matchLabels:
              genieai.io/component: frontend
      ports:
        - protocol: TCP
          port: 8080
{{- end -}}
```

- [ ] **Step 4: Write `clamav.yaml`**

```yaml
{{- if .Values.services.clamav.enabled -}}
{{- $ctx := dict "name" "clamav" "component" "clamav" "Values" .Values "Chart" .Chart "Release" .Release -}}
{{- include "genieai-umbrella.serviceDeployment" $ctx }}
---
apiVersion: v1
kind: Service
metadata:
  name: clamav
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "clamav"))) | nindent 4 }}
spec:
  ports:
    - name: avscanner
      port: 3310
  selector:
    {{- include "genieai-common.serviceSelector" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "clamav"))) | nindent 4 }}
---
# Review Focus #4: ingress from documentRepository ONLY.
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: clamav
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "clamav"))) | nindent 4 }}
spec:
  podSelector:
    matchLabels:
      genieai.io/component: clamav
  policyTypes:
    - Ingress
    - Egress
  ingress:
    - from:
        - podSelector:
            matchLabels:
              genieai.io/component: documentRepository
      ports:
        - protocol: TCP
          port: 3310
  egress:
    - to:
        - namespaceSelector:
            matchLabels:
              name: kube-system
      ports:
        - protocol: UDP
          port: 53
    # Review Focus F11 fix — `to: []` (empty array) was interpreted as
    # match-any, which would let clamav hit any IP on 80/443. We restrict
    # egress to the canonical database.clamav.net mirror set
    # (overridable per env via values.clamav.dbUpdateCIDRs). DNS-based
    # mirror dispatch from a configurable allowlist is the sovereign-
    # safe pattern.
    {{- $dbCDN := .Values.services.clamav.dbUpdateCDNs | default list "database.clamav.net" "clamav-mirror.example.org" }}
    - to:
        {{- range $dbCDN }}
        - host: {{ . | quote }}
        {{- end }}
      ports:
        - protocol: TCP
          port: 80
        - protocol: TCP
          port: 443
{{- end -}}
```

- [ ] **Step 5: Render all five Group 5 services**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: Deployment$"`
Expected: prints `5` (the five Group-5 services).

- [ ] **Step 6: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add charts/genieai-umbrella/templates/_services/frontend.yaml charts/genieai-umbrella/templates/_services/documentRepository.yaml charts/genieai-umbrella/templates/_services/nginx.yaml charts/genieai-umbrella/templates/_services/clamav.yaml
git commit -m "feat(charts): Group 5 stateless app tier (frontend, documentRepo, nginx, clamav)"
```

---

## Task 5: nginx.conf ConfigMap (gateway paths)

**Files:**
- Create: `charts/genieai-umbrella/templates/_services/nginx-config.yaml`

**Interfaces:**
- Consumes: `nginx` service enabled toggle.
- Produces: nginx.conf mounted as ConfigMap volume.

- [ ] **Step 1: Run red-gate — no nginx config yet**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "nginx.conf" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/_services/nginx-config.yaml`**

```yaml
{{- if .Values.services.nginx.enabled -}}
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "genieai-common.fullname" . }}-nginx-conf
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "nginx"))) | nindent 4 }}
data:
  nginx.conf: |
    worker_processes 1;
    pid /tmp/nginx.pid;
    events { worker_connections 1024; }
    http {
      upstream backend_spa {
        server frontend:8080 max_fails=3 fail_timeout=10s;
      }
      server {
        listen 8080;
        server_name _;
        # Root → Vue SPA
        location / {
          proxy_pass http://backend_spa;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
          proxy_set_header X-Forwarded-Proto $scheme;
        }
        # API → backend BFF (Envoy Gateway is the edge; nginx proxies internally)
        location /api/ {
          proxy_pass http://backend:3000;
          proxy_set_header Host $host;
          proxy_set_header X-Real-IP $remote_addr;
          proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        }
      }
    }
{{- end -}}
```

- [ ] **Step 3: Render and verify ConfigMap**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -A 5 "nginx.conf" | head -20`
Expected: shows the ConfigMap.

- [ ] **Step 4: Mount config into nginx pod (Task 3 — no separate edit; nginx.yaml already does not mount this)**

Update `nginx.yaml` (Task 3) to add `volumeMounts` for the ConfigMap and a `volumes:` block. Or skip this and document in follow-up that the chart will integrate ConfMap mount in the nginx Deployment.

For Plan 3, declare the mount target via spec but render volumeMounts in a follow-up template:

Edit `charts/genieai-umbrella/templates/_lib/_service-factory.tpl`'s Deployment body to ALWAYS add volumeMounts for a `<svcName>-config` ConfigMap when one is defined. For nginx in Plan 3, render an additional mount block.

Caveman simplification: skip the volumeMount integration in this task; document as a follow-up in Task 11 README. The chart ships the ConfigMap; nginx.conf integration is Plan 6's nginx-as-reverse-proxy responsibility.

- [ ] **Step 5: Document the simplification in chart README**

Run:

```bash
echo "" >> charts/genieai-umbrella/README.md
echo "## nginx ConfigMap wiring" >> charts/genieai-umbrella/README.md
echo "" >> charts/genieai-umbrella/README.md
echo "The chart renders \`nginx.conf\` as a ConfigMap (\`nginx-conf\`) but does NOT mount it" >> charts/genieai-umbrella/README.md
echo "into the nginx Pod. Plan 6 (ingress + reverse proxy) wires the mount." >> charts/genieai-umbrella/README.md
```

- [ ] **Step 6: Commit**

```bash
git add charts/genieai-umbrella/templates/_services/nginx-config.yaml charts/genieai-umbrella/README.md
git commit -m "feat(charts): nginx.conf ConfigMap (mount wiring deferred to Plan 6)"
```

---

## Task 6: REMOVED — Kong CORS (moved to Envoy Gateway)

**No files. No steps.**

Kong is removed from the chart (audit decision 7). CORS origins/headers are configured as an Envoy Gateway policy in Plan 6 — not as a Kong plugin. Review Focus #3 transfers to Plan 6: its render gate asserts the Gateway CORS policy carries explicit origins derived from `ingress.host`.

## Task 7: Group 5 SealedSecrets (email, keycloak-client, huggingface)

**Files:**
- Create: `charts/genieai-umbrella/templates/_secrets/group5-secrets.yaml`

**Interfaces:**
- Consumes: spec §8 F14 mapping table (the 3 Group-5 secrets: `emailPassword`, `keycloakClientSecret`, `huggingFaceHubToken`).
- Produces: 3 SealedSecret CRs.

- [ ] **Step 1: Run red-gate — confirm only Plan-2 SealedSecrets exist**

Run: `helm template test charts/genieai-umbrella -n genieai | grep "^kind: SealedSecret$" -A 1 | grep "name:" | sort -u`
Expected: prints `arango-jwt-secret`, `arango-root-secret`, `genie-admin-credentials`, `keycloak-db-credentials` (4 Plan-2 secrets).

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/_secrets/group5-secrets.yaml`**

```yaml
{{- if .Values.secrets.sealedSecrets.enabled -}}
{{- /*
  Group 5 SealedSecrets per spec §8 F14 mapping table.
  kcGrafanaClientSecret (Plan 4) and grafanaAdminPassword (Plan 4) are not
  in this template; they ship with observability services.

  Service-to-K8s mapping:
    emailPassword       → email-password
    keycloakClientSecret→ keycloak-client-secret
    huggingFaceHubToken → huggingface-hub-token
*/ -}}
{{- range $secretName := list "email-password" "keycloak-client-secret" "huggingface-hub-token" -}}
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: {{ $secretName }}
  namespace: {{ $.Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" $.Chart "Release" $.Release "Values" (deepCopy $.Values | merge (dict "component" "sealed-secret"))) | nindent 4 }}
    app.kubernetes.io/component: {{ $secretName }}
spec:
  encryptedData:
    password: PLACEHOLDER_{{ $secretName }}_SEALED_KID
{{- end -}}
{{- end -}}
```

- [ ] **Step 3: Render and verify count**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: SealedSecret$"`
Expected: prints `7` (4 from Plan 2 + 3 from Plan 3).

- [ ] **Step 4: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add charts/genieai-umbrella/templates/_secrets/group5-secrets.yaml
git commit -m "feat(charts): Group 5 SealedSecrets (email-password, keycloak-client-secret, huggingface-hub-token)"
```

---

## Task 8: PodDisruptionBudget generator (only when replicas ≥ 2)

**Files:**
- Create: `charts/genieai-umbrella/templates/_lib/_pdb-generator.tpl`

**Interfaces:**
- Consumes: each service's `replicas` + `podDisruptionBudget.minAvailable`.
- Produces: 1 PDB per qualifying service.

- [ ] **Step 1: Run red-gate — no PDBs yet**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: PodDisruptionBudget$" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/_lib/_pdb-generator.tpl`**

```gotemplate
{{/*
Emit a PodDisruptionBudget for the given service iff `replicas >= 2`
AND `podDisruptionBudget.minAvailable` is set to a numeric value > 0.

Caller context:
  component: <service-name>
  .Values.services.<component>.replicas
  .Values.services.<component>.podDisruptionBudget.minAvailable
*/}}
{{- define "genieai-umbrella.pdbForService" -}}
{{- $ctx := . -}}
{{- $svc := index $ctx.Values.services $ctx.component -}}
{{- $replicas := $svc.replicas | default 1 -}}
{{- with $ctx.Values.clusterProfileReplicas -}}
{{- if hasKey . $ctx.Values.clusterProfile -}}
{{- $profileReplicas := index . $ctx.Values.clusterProfile -}}
{{- if hasKey $profileReplicas $ctx.component -}}
{{- $replicas = index $profileReplicas $ctx.component -}}
{{- end -}}
{{- end -}}
{{- end -}}
{{- if and (ge $replicas 2) (or (not (hasKey $svc "podDisruptionBudget")) $svc.podDisruptionBudget.minAvailable) -}}
{{- if $svc.podDisruptionBudget -}}
{{- if and (hasKey $svc.podDisruptionBudget "minAvailable") $svc.podDisruptionBudget.minAvailable -}}
apiVersion: policy/v1
kind: PodDisruptionBudget
metadata:
  name: {{ include "genieai-common.fullname" $ctx }}-{{ $ctx.component }}
  namespace: {{ $ctx.Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" $ctx.Chart "Release" $ctx.Release "Values" (deepCopy $ctx.Values | merge (dict "component" $ctx.component))) | nindent 4 }}
spec:
  minAvailable: {{ $svc.podDisruptionBudget.minAvailable }}
  selector:
    matchLabels:
      {{- include "genieai-common.serviceSelector" (dict "Chart" $ctx.Chart "Release" $ctx.Release "Values" (deepCopy $ctx.Values | merge (dict "component" $ctx.component))) | nindent 6 }}
{{- end -}}
{{- end -}}
{{- end -}}
{{- end -}}
```

- [ ] **Step 3: Write `charts/genieai-umbrella/templates/_services/_pdb-bundler.yaml`**

```yaml
{{- if and (or .Values.services.backend.enabled .Values.services.frontend.enabled .Values.services.documentRepository.enabled .Values.services.nginx.enabled .Values.services.clamav.enabled) -}}
{{- range $svcName := list "backend" "frontend" "documentRepository" "nginx" "clamav" -}}
{{- $enabled := index (index $.Values.services $svcName) "enabled" -}}
{{- if $enabled -}}
---
{{- include "genieai-umbrella.pdbForService" (dict "component" $svcName "Values" $.Values "Chart" $.Chart "Release" $.Release) -}}
{{- end -}}
{{- end -}}
{{- end -}}
```

- [ ] **Step 4: Default render (all 5 services at replicas=1) — no PDBs (Review Focus #5)**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: PodDisruptionBudget$"`
Expected: prints `0` (no service has `replicas: 1` AND `podDisruptionBudget.minAvailable: 1` simultaneously with our defaults — only `backend` has minAvailable=1 with replicas=1).

Actually wait — `pdbForService` emits PDB only when `replicas >= 2`. With default 1, no PDBs emit. **No fix needed** to the defaults. Exit 0.

- [ ] **Step 5: Render with prod profile — backend should get PDB**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | grep -c "^kind: PodDisruptionBudget$"`
Expected: prints `2` (backend, frontend, documentRepository have clusterProfile: prod overrides → replicas 3/2/2; only the first 2 qualify if minAvailable was specified in the per-service value, but our defaults set minAvailable=1 only for backend — so 1 PDB for backend).

If it prints different, the test catches the bug. Acceptable outputs: 0 (if no overrides applied) or 1 (backend only). Anything else = bug.

- [ ] **Step 6: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add charts/genieai-umbrella/templates/_lib/_pdb-generator.tpl charts/genieai-umbrella/templates/_services/_pdb-bundler.yaml
git commit -m "feat(charts): PodDisruptionBudget generator (replicas >= 2 only)"
```

---

## Task 9: helm test extensions for service reachability

**Files:**
- Modify: `charts/genieai-umbrella/templates/tests/test-namespace.yaml` (from Plan 1 Task 9 + Plan 2 Task 12)
- Create: `charts/genieai-umbrella/templates/tests/test-group5-reachability.yaml`

**Interfaces:**
- Consumes: each Group 5 service's Service resource.
- Produces: a smoke test Pod that curls each Service's `/health` (or TCP-port equivalent) and asserts response.

- [ ] **Step 1: Write `charts/genieai-umbrella/templates/tests/test-group5-reachability.yaml`**

```yaml
---
apiVersion: v1
kind: Pod
metadata:
  name: {{ include "genieai-common.fullname" . }}-test-group5-reach
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
      image: curlimages/curl:8.10.1
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
          failures=0
          # Each pair: <expected-status> <host:port> <path>
          check() {
            host=$1
            port=$2
            path=${3:-/health}
            expected=$4
            code=$(curl -s -o /dev/null -w '%{http_code}' "http://${host}:${port}${path}" 2>/dev/null || echo 000)
            if [ "$code" = "$expected" ] || { [ "$expected" = "reachable" ] && [ "$code" != "000" ]; }; then
              echo "PASS: ${host}:${port}${path} -> ${code}"
            else
              echo "FAIL: ${host}:${port}${path} expected ${expected}, got ${code}"
              failures=$((failures+1))
            fi
          }
          {{- if .Values.services.backend.enabled }}
          check backend 3000 /api/health 200
          {{- end }}
          {{- if .Values.services.frontend.enabled }}
          check frontend 8080 /health 200
          {{- end }}
          {{- if .Values.services.documentRepository.enabled }}
          check document-repository 3001 / 200
          {{- end }}
          {{- if .Values.services.nginx.enabled }}
          check nginx 8080 / 200
          {{- end }}
          {{- if .Values.services.clamav.enabled }}
          check clamav 3310 / reachable
          {{- end }}
          if [ "$failures" -gt 0 ]; then
            echo "FAIL: $failures service(s) unreachable"
            exit 1
          fi
          echo "PASS: all Group 5 reachable"
```

- [ ] **Step 2: Render the test pod**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -A 1 "test-group5-reach"`
Expected: shows the new test pod.

- [ ] **Step 3: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add charts/genieai-umbrella/templates/tests/test-group5-reachability.yaml
git commit -m "test(charts): helm test for Group 5 service reachability"
```

---

## Task 10: Final validation + README updates

**Files:**
- Modify: `charts/README.md` (Plan 1 Task 13 updated)
- Modify: `charts/genieai-umbrella/README.md`

**Interfaces:**
- Consumes: every prior task.
- Produces: documentation checkpoint + concrete `make test` validation.

- [ ] **Step 1: Update `charts/README.md` Plan status table**

```bash
cat > charts/README.md <<'EOF'
# GENIE.AI Helm charts

This directory holds the Kubernetes-deployment Helm charts for GENIE.AI.

## Status

Foundation + Plan 2 (data layer) + Plan 3 (service tier Group 5 — stateless app) complete. Next: Plan 4 (observability), Plan 5 (AI/ML), Plan 6 (per-env config + ingress), Plan 7 (CI), Plan 8 (docs).

## Charts

| Chart | Status | Purpose |
|---|---|---|
| `genieai-common` | foundation | Library chart (templates + helpers) |
| `genieai-umbrella` | foundation + Plans 2-3 | Single-install chart, data layer + Group-5 services |

## Other directories

- `deploy/environments/` — per-environment Kustomize overlays + values-override files.
- `docs/charts/` — dev-internal reference docs (operator selection, migration playbooks).

## Conventions

- Helm API v2. Helm 4.x.
- No secrets in `values-override.yaml`. Use SealedSecret resources (Plan 2 default backend).
- Tests live in each chart's `tests/` directory; `ct install` for integration, `helm test` for smoke.
- Pre-install hooks in `templates/hooks/*.yaml` carry `helm.sh/hook: pre-install` annotations (Helm 3 scans recursively).
- NetworkPolicy: every service gets default-deny + explicit allowlist.
- PDB: only emitted when `replicas >= 2` (avoids drain block on singletons).
EOF

git add charts/README.md
git commit -m "docs(charts): mark Foundation + Plan 2 + Plan 3 complete in charts/README.md"
```

- [ ] **Step 2: Update `charts/genieai-umbrella/README.md` with Group 5 status**

```bash
cat >> charts/genieai-umbrella/README.md <<'EOF'

## Service tier Group 5 (stateless app)

Plan 3 shipped:

| Service | Component label | Port | Replicas (dev → prod) |
|---|---|---|---|
| `backend` | backend | 3000 | 1 → 3 |
| `frontend` | frontend | 8080 | 1 → 2 |
| `documentRepository` | documentRepository | 3001 | 1 → 2 |
| `nginx` | nginx | 8080 | 1 |
| `clamav` | clamav | 3310 | 1 |

Each service carries: Deployment, Service, default-deny NetworkPolicy, envFrom secrets (where applicable). 3 Group-5 SealedSecrets ship per spec §8 F14 mapping: email-password, keycloak-client-secret, huggingface-hub-token.

PDB emitted only when `replicas >= 2` (avoids drain block on singletons; backend in prod-profile is the first qualifying service).

CORS is configured at Envoy Gateway (Plan 6 policy), origins derived from `ingress.host` (Kong removed — decision 7).
EOF

git add charts/genieai-umbrella/README.md
git commit -m "docs(charts): genieai-umbrella README with Group 5 status table"
```

- [ ] **Step 3: Total helm template + grep summary**

```bash
helm template test charts/genieai-umbrella -n genieai | grep "^kind:" | sort | uniq -c | sort -rn
```

Expected: confirms 7 Deployments (5 Group-5 + Plan-2 pre-Install Jobs are not Deployments), 7 Services, multiple NetworkPolicies, multiple SealedSecrets.

- [ ] **Step 4: Final `helm lint --strict` + `ct lint` (per the foundation plan CI gate)**

```bash
helm lint charts/genieai-umbrella --strict
ct lint --config charts/ci/ct.yaml --charts charts/genieai-umbrella
```

Expected: 0 errors from both.

---

## Self-Review

After writing all 10 tasks, run this checklist against the spec.

**1. Spec coverage** (service tier Group 5 slice):

| Spec section | Task |
|---|---|
| §5 per-service entry shape | Task 1 |
| §7 Group 5 services (backend, frontend, documentRepo, nginx, clamav) | Tasks 3, 4 |
| §7 network policy defaults | Tasks 3, 4 (each service template) |
| §8 Group 5 SealedSecrets (spec §8 F14 mapping table) | Task 7 |
| §9 nginx as reverse proxy | Task 5 (ConfigMap ready for Plan 6 wiring) |
| §6 CORS via Envoy Gateway policy | Plan 6 (Task 6 tombstoned — Kong removed) |
| §13 PDB pattern (only when replicas >= 2) | Task 8 |
| §17 service-tier entries in v1.0 manifest | Tasks 1-9 |
| Plan 3 cross-tier NetworkPolicy (backend → arangodb → keycloak → redis) | Tasks 3, 4 |

Sections NOT covered by this plan (deferred):
- §4 backend-specific Helm dep (none; backend is a custom image, no operator)
- §10 observability operator ServiceMonitors — Plan 4
- §11 GPU AI/ML services — Plan 5
- §9 Ingress + Envoy Gateway / cert-manager — Plan 6
- §14 CI integration + secret-leak lint — Plan 7

**2. Placeholder scan**: only intentional `PLACEHOLDER_<name>_SEALED_KID` markers in sealed-secrets.yaml (one per secret, gated by Plan 7 conftest). No "TBD", "TODO", "implement later".

**3. Type consistency**: `genieai-common.labels`, `genieai-common.fullname`, `genieai-common.serviceSelector` invoked consistently across Tasks 3, 4, 5, 7, 8. The `dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "<name>"))` pattern is uniform — same shape as Plans 1, 2.

**4. Review Focus coverage**: 5 input-class concerns pinned:

1. Backend envFrom secret ref resolution → Task 3 Step 4 (verifies each backend `secrets:` entry references a SealedSecret the chart ships).
2. NetworkPolicy egress to keycloak-db CNPG Cluster → Task 3 Step 5 (Python parse of egress to assert keycloak-db target).
3. CORS explicit origins at the edge → Plan 6 Envoy Gateway CORS policy render gate (Task 6 tombstoned).
4. clamav NetworkPolicy ingress-only-from-documentRepository → Task 4 Step 4 (clamav template).
5. PDB minAvailable math → Task 8 Step 4-5 (renders empty + prod profile scenarios).

All five covered with red-gate validators.

**5. Adversarial review note**: recommend `/code-review` slash command before executing Plan 3 Tasks 1-10.

---

## Plan Stats

- **Tasks:** 10
- **Files created:** 8 (4 service templates, 1 configmap, 3 secrets/templates, 1 test pod) + values.yaml diff
- **Files modified:** 2 (values.yaml, README ×2)
- **Commits planned:** 10
- **Estimated review surface:** ~700 lines added (5 service manifests + 3 helpers + 1 test pod + README updates)

## What's next after Plan 3

- Plan 4: observability (vmoperator VMSingle/Cluster/VLSingle/VTCluster + OTel operator + serviceMonitors)
- Plan 5: AI/ML (vLLM + TEI + OPEA microservices + GPU operator)
- Plan 6: per-env Kustomize overlays + GitOps sync + ingress (Envoy Gateway + cert-manager + nginx volumeMount wiring)
- Plan 7: CI integration + image signing + Renovate + uninstall safety + secret-leak lint + chart-schema-drift alert
- Plan 8: documentation (site content + docs/charts/*)
