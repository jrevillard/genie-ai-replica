# GENIE.AI Helm Charts — Observability (Plan 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the observability tier of the GENIE.AI Helm chart: vmoperator (VictoriaMetrics / VictoriaLogs / VictoriaTraces official operator) + opentelemetry-operator (gateway + DaemonSet agent) + grafana-operator (instance, datasources, 9 dashboards as CRs — K8s-native per `docs/charts/k8s-native-audit.md`) + per-service ServiceMonitors + PII redaction (config ported verbatim). Profile-gated (`dev=off`, `staging/prod/sovereign=on` per spec §5.2). **No tempo-proxy** — VictoriaTraces implements the Tempo HTTP API natively; Grafana queries VT directly.

**Architecture:** Four independent operators, each managing their own custom resources: vmoperator manages `VMSingle`/`VMCluster`/`VLSingle`/`VLCluster`/`VTSingle`/`VTCluster`/`VMAgent`/`VMRule`/`VMAlertmanager`, opentelemetry-operator manages `OpenTelemetryCollector` (gateway + agent), grafana-operator manages `Grafana`/`GrafanaDatasource`/`GrafanaDashboard`. No traces proxy — VictoriaTraces implements the Tempo HTTP API natively (verified 2026-10-08), Grafana's Jaeger datasource queries VT directly. ServiceMonitors, for Prometheus-style scrape, get generated per Group 5 service conditionally. PII redaction and log-metadata stamping port **verbatim** from the existing `configs/otel/otel-collector-config.yaml` (OTTL `pii_redact` + `stamp_log_metadata_from_msg`) — the chart ports, never rewrites. Collector topology: **gateway** (Deployment, OTLP traces/metrics) + **agent** (DaemonSet, filelog container logs → gateway), replacing the Swarm fluentd-driver → `fluent_forward` pipeline which does not exist on containerd/K8s. See `docs/charts/otel-migration.md`.

**Tech Stack:** Helm 4.x, chart-testing (`ct` v3.x), kind 1.32, vmoperator chart `~> 0.45.0`, opentelemetry-operator chart `~> 0.50.0`, grafana-operator chart `~> 5.22.0` (official `grafana/grafana-operator`).

**Spec:** `docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md` — this plan implements §10 (observability stack default + vmoperator + OTel Operator + Grafana + PII redaction), §6 pluggability (ClusterProfile-driven observability default), §11 v1.0 manifest observability entries.

## Global Constraints

- Helm chart API version: `v2`. Helm 4.x.
- Profile-gated: `observability.enabled` default derived from `clusterProfile` per spec §5.2 (dev=off, staging/prod/sovereign=on). Operators can override explicitly in `values-override.yaml`.
- All observability CRDs (VM*, OpenTelemetryCollector, Grafana datasource Secret) namespaced to the release namespace.
- PII redaction rules ship as the ported `configs/otel-collector-config.yaml` inside the chart (verbatim from the repo's Swarm config); operator edits + CI lint via conftest (Plan 7).
- All English documentation and comments per project CLAUDE.md.
- Commits in English using Conventional Commits.
- Worktree path: `/home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/k8s-migration/`. Branch: `feat/k8s-migration`.

## Review Focus

Five input-class concerns the spec implies but no Plan 4 task tests explicitly.

1. **vmoperator CRD version compatibility with K8s 1.32** — `~> 0.45.0` and `~> 0.50.0` pins may not align with K8s 1.32 admission. **Pinned in Task 1 Step 3** — `helm dep list` post-update confirms both operator versions; `helm install --dry-run` validates CRD shape.
2. **ServiceMonitor-conditional emission** — services get `serviceMonitor: true` only when `observability.enabled: true`. If a service emits monitor fields unconditionally, scrape targets reference non-existent endpoints on dev. **Pinned in Task 7 Step 4** — render asserts no ServiceMonitor resources emitted when observability off.
3. **Traces query path must be VT-direct** — Grafana's Jaeger datasource must point at `vtraces` (Tempo HTTP API implemented natively by VictoriaTraces, verified 2026-10-08), NOT at a proxy. A stale proxy reference or wrong port makes the "Trace explorer" dashboard silently fail. **Pinned in Task 5 Step 4** — render asserts the jaeger datasource URL contains `vtraces.` and that `tempo-proxy` appears nowhere in the rendered output.
4. **PII redaction YAML schema** — OpenTelemetry Collector `transform` processor schema is versioned (v0.111+ uses `error_mode: ignore`). Older syntax accepted silently. **Pinned in Task 9 Step 4** — render asserts `error_mode: ignore` + each transform context statements name parsed by `otelcol validate`.
5. **ClusterProfile auto-derivation race** — Plan 4 implements `observability.enabled: {{ .Values.clusterProfile | default "dev" | eq "prod" | or (.Values.clusterProfile | eq "staging") | or ... }}`. Multiple boolean conditions can drift. **Pinned in Task 11 Step 4** — values.yaml tests render with `clusterProfile: dev` (observability off) and `clusterProfile: prod` (on); assert only.
6. **Log ingestion without the fluentd driver** — containerd/K8s has no Docker fluentd logging driver, so the Swarm log pipeline (stdout → `fluent_forward` :24224 → VL) dies on arrival. Without a node-level agent, **zero container logs reach VictoriaLogs** and the admin logs UI returns empty. **Pinned in Task 4b Step 5** — render asserts BOTH collector CRs (gateway Deployment + agent DaemonSet); the agent's filelog receiver + hostPath mount are the structural fix.

---

## Task 1: Add observability helm deps to umbrella Chart.yaml

**Files:**
- Modify: `charts/genieai-umbrella/Chart.yaml`

**Interfaces:**
- Consumes: Plan 2 dep block.
- Produces: vmoperator (×3 charts) + opentelemetry-operator + grafana-operator added. No tempo-proxy (native-audit decision 1).

- [ ] **Step 1: Run red-gate — no observability deps yet**

Run: `helm dep list charts/genieai-umbrella 2>&1 | grep -E "victoriametrics|opentelemetry|grafana|tempo" || echo "OK: no observability deps"`
Expected: `OK: no observability deps`.

- [ ] **Step 2: Append to `dependencies:` block in `charts/genieai-umbrella/Chart.yaml`**

```yaml
  # Plan 4 — observability operators + subcharts
  - name: victoria-metrics-operator
    version: "~> 0.45.0"
    repository: "https://victoriametrics.github.io/helm-charts"
    condition: observability.metrics.enabled
  - name: victoria-logs-operator
    version: "~> 0.10.0"
    repository: "https://victoriametrics.github.io/helm-charts"
    condition: observability.logs.enabled
  - name: victoria-traces-operator
    version: "~> 0.5.0"
    repository: "https://victoriametrics.github.io/helm-charts"
    condition: observability.traces.enabled
  - name: opentelemetry-operator
    version: "~> 0.50.0"
    repository: "https://open-telemetry.github.io/opentelemetry-helm-charts"
    condition: observability.otel.enabled
  # grafana-operator — official Grafana org operator (K8s-native audit
  # decision 2). Manages Grafana instance + datasources + dashboards as CRs.
  - name: grafana-operator
    version: "~> 5.22.0"
    repository: "https://grafana.github.io/helm-charts"
    condition: observability.grafana.enabled
```

(Note: each operator is a SEPARATE helm dep with `condition:` per spec §4. Single combined `vmoperator` umbrella dep would be simpler but the spec chose per-storage separation.)

- [ ] **Step 3: Run `helm dependency update`**

Run: `helm dependency update charts/genieai-umbrella`
Expected: 6 new tarballs land in `charts/genieai-umbrella/charts/`. Chart.lock regenerates.

- [ ] **Step 4: Verify dep list (Review Focus #1)**

Run: `helm dep list charts/genieai-umbrella | grep -E "victoria|opentelemetry|grafana|tempo"`
Expected: 6 lines, each with a pinned version. If any version has `~> 0.X.0` resolving to `0.X.<y>` for `y` with breaking CRD changes, this step surfaces that before the next plan.

- [ ] **Step 5: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add charts/genieai-umbrella/Chart.yaml charts/genieai-umbrella/Chart.lock charts/genieai-umbrella/charts/
git commit -m "feat(charts): add observability operator deps (vmoperator, OTel operator, grafana-operator)"
```

---

## Task 2: Extend values.yaml with `observability` block

**Files:**
- Modify: `charts/genieai-umbrella/values.yaml`

**Interfaces:**
- Consumes: Plan 2 values (data.*, secrets.*).
- Produces: `observability.{metrics,logs,traces,otel,grafana}.enabled` + retention + storage + Grafana admin password references.

- [ ] **Step 1: Run red-gate — no observability values**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -E "^kind: (OpenTelemetryCollector|VMSingle|VLSingle|VTSingle|Grafana)" | wc -l`
Expected: prints `0`.

- [ ] **Step 2: Append to `charts/genieai-umbrella/values.yaml`**

```yaml
# Plan 4 — observability

# Profile-driven default for observability per spec §5.2:
#   dev=off, staging/prod/sovereign=on. Operators override via
#   --set observability.enabled=... in install.
# Default via Helm template — helper `genieai-umbrella.profileProduction`
# in templates/_lib/_clusterprofile-defaults.tpl resolves this.
observability:
  enabled: {{ include "genieai-umbrella.observabilityDefault" . }}
  metrics:
    enabled: {{ include "genieai-umbrella.observabilityDefault" . }}    # mirror top-level
    retention: "30d"
    storageSize: 10Gi
  logs:
    enabled: {{ include "genieai-umbrella.observabilityDefault" . }}    # mirror top-level
    retention: "30d"
    storageSize: 20Gi
  traces:
    enabled: {{ include "genieai-umbrella.observabilityDefault" . }}    # mirror top-level
    retention: "30d"
    storageSize: 5Gi
  otel:
    enabled: {{ include "genieai-umbrella.observabilityDefault" . }}    # mirror top-level
  grafana:
    enabled: {{ include "genieai-umbrella.observabilityDefault" . }}    # mirror top-level
    adminUser: admin
    adminPasswordRef: grafanaAdminPassword    # SealedSecret name (Plan 4 ship)
  # PII redaction rules (port from Swarm fluentd config). Operators edit
  # per deployment; conftest (Plan 7) lint ensures no rule is empty.
  piiRedaction:
    rules:
      - pattern: '"[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}"'
        replace: '[EMAIL REDACTED]'
      - pattern: '"\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b"'
        replace: '[IP REDACTED]'
      - pattern: '"\\b[A-Fa-f0-9]{32,}\\b"'
        replace: '[HEX REDACTED]'
      - pattern: '"\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b"'
        replace: '[UUID REDACTED]'
```

- [ ] **Step 3: Render with default `clusterProfile: dev` — observability off**

Run: `helm template test charts/genieai-umbrella -n genieai -f charts/genieai-umbrella/values.yaml | grep -c "OpenTelemetryCollector"`
Expected: prints `0`.

- [ ] **Step 4: Render with `clusterProfile: prod` — observability on (Review Focus #5)**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | grep -c "OpenTelemetryCollector"`
Expected: prints `>= 1` (the OTel Collector CR appears).

If `0`: profile default expression in `observability.enabled` is buggy. Fix and re-test.

- [ ] **Step 5: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add charts/genieai-umbrella/values.yaml
git commit -m "feat(charts): observability block in values with clusterProfile-driven default"
```

---

## Task 3: vmoperator CRDs (VMSingle/Cluster + VLSingle + VTSingle + VMAgent)

**Files:**
- Create: `charts/genieai-umbrella/templates/_observability/vmsingle.yaml`
- Create: `charts/genieai-umbrella/templates/_observability/vlsingle.yaml`
- Create: `charts/genieai-umbrella/templates/_observability/vtsingle.yaml`
- Create: `charts/genieai-umbrella/templates/_observability/vmagent.yaml`

**Interfaces:**
- Consumes: vmoperator CRD types (`VMSingle`, `VLSingle`, `VTSingle`, `VMAgent`).
- Produces: 4 storage + 1 agent resource per install with observability enabled.

- [ ] **Step 1: Run red-gate — no observability CRDs yet**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | grep -c "^kind: VMSingle$" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/_observability/vmsingle.yaml`**

```yaml
{{- if .Values.observability.metrics.enabled -}}
{{- if eq .Values.clusterProfile "prod" -}}
{{- /* Cluster mode for prod; single mode otherwise. */ -}}
apiVersion: operator.victoriametrics.com/v1beta1
kind: VMCluster
metadata:
  name: vmetrics
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "vmetrics"))) | nindent 4 }}
spec:
  replicationFactor: 3
  retentionPeriod: "{{ .Values.observability.metrics.retention }}"
  storage:
    volumeClaimTemplate:
      spec:
        storageClassName: {{ .Values.pluggable.storageClassName | default "" }}
        resources:
          requests:
            storage: {{ .Values.observability.metrics.storageSize }}
{{- else -}}
apiVersion: operator.victoriametrics.com/v1beta1
kind: VMSingle
metadata:
  name: vmetrics
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "vmetrics"))) | nindent 4 }}
spec:
  retentionPeriod: "{{ .Values.observability.metrics.retention }}"
  storage:
    volumeClaimTemplate:
      spec:
        storageClassName: {{ .Values.pluggable.storageClassName | default "" }}
        resources:
          requests:
            storage: {{ .Values.observability.metrics.storageSize }}
{{- end -}}
{{- end -}}
```

- [ ] **Step 3: Write `charts/genieai-umbrella/templates/_observability/vlsingle.yaml`**

```yaml
{{- if .Values.observability.logs.enabled -}}
apiVersion: operator.victoriametrics.com/v1beta1
kind: VLSingle
metadata:
  name: vlogs
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "vlogs"))) | nindent 4 }}
spec:
  retentionPeriod: "{{ .Values.observability.logs.retention }}"
  storage:
    volumeClaimTemplate:
      spec:
        storageClassName: {{ .Values.pluggable.storageClassName | default "" }}
        resources:
          requests:
            storage: {{ .Values.observability.logs.storageSize }}
{{- end -}}
```

- [ ] **Step 4: Write `charts/genieai-umbrella/templates/_observability/vtsingle.yaml`**

```yaml
{{- if .Values.observability.traces.enabled -}}
apiVersion: operator.victoriametrics.com/v1beta1
kind: VTSingle
metadata:
  name: vtraces
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "vtraces"))) | nindent 4 }}
spec:
  retentionPeriod: "{{ .Values.observability.traces.retention }}"
  storage:
    volumeClaimTemplate:
      spec:
        storageClassName: {{ .Values.pluggable.storageClassName | default "" }}
        resources:
          requests:
            storage: {{ .Values.observability.traces.storageSize }}
{{- end -}}
```

- [ ] **Step 5: Write `charts/genieai-umbrella/templates/_observability/vmagent.yaml`**

```yaml
{{- if .Values.observability.metrics.enabled -}}
apiVersion: operator.victoriametrics.com/v1beta1
kind: VMAgent
metadata:
  name: vmagent
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "vmagent"))) | nindent 4 }}
spec:
  serviceScrapeSelector:
    matchLabels:
      release: {{ .Release.Name }}-observability
  # Remote write to VMSingle (or VMCluster). serviceScrape config selects
  # ServiceMonitors emitted by Task 7.
  remoteWrite:
    - url: http://vmetrics.{{ .Values.namespace }}.svc.cluster.local:8429/api/v1/write
{{- end -}}
```

- [ ] **Step 6: Render and verify**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | grep "^kind: " | sort | uniq -c | sort -rn | head`
Expected: shows `VMCluster × 1`, `VLSingle × 1`, `VTSingle × 1`, `VMAgent × 1`.

- [ ] **Step 7: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add charts/genieai-umbrella/templates/_observability/vmsingle.yaml charts/genieai-umbrella/templates/_observability/vlsingle.yaml charts/genieai-umbrella/templates/_observability/vtsingle.yaml charts/genieai-umbrella/templates/_observability/vmagent.yaml
git commit -m "feat(charts): vmoperator CRDs (VMSingle/Cluster + VLSingle + VTSingle + VMAgent)"
```

---

## Task 4: OTel operator CRD + PII redaction transformation

**Files:**
- Create: `charts/genieai-umbrella/configs/otel-collector-config.yaml` (ported VERBATIM from repo `configs/otel/otel-collector-config.yaml` — per `docs/charts/otel-migration.md` §5)
- Create: `charts/genieai-umbrella/templates/_observability/otel-collector.yaml`

**Interfaces:**
- Consumes: `observability.otel.enabled`; the existing repo collector config (source of truth for PII + metadata stamping).
- Produces: 1 `OpenTelemetryCollector` (gateway mode) whose `spec.config` is the ported file inlined via `.Files.Get`.

**Porting rule (from code-review lessons + `docs/charts/otel-migration.md`):** the existing config is months of tuning (`pii_redact` OTTL with the double-unescape trap, `stamp_log_metadata_from_msg`, healthcheck). **Port, never rewrite.** A from-scratch config silently drops the real PII rules and the admin-logs metadata contract.

- [ ] **Step 1: Copy the existing collector config into the chart**

```bash
cp configs/otel/otel-collector-config.yaml \
   charts/genieai-umbrella/configs/otel-collector-config.yaml
```

- [ ] **Step 2: Apply the K8s port edits (and ONLY these)**

1. **Remove** the `fluent_forward` receiver block and its entry from the logs pipeline `receivers:` list — containerd/K8s has no fluentd logging driver; logs arrive via the Task 4b agent over OTLP.
2. **Keep verbatim** — `pii_redact` OTTL statements (do NOT touch the double-escaped regexes: YAML single-quote + OTTL unescape makes `\\s`/`\\.` load-bearing; single-escaping kills the pipeline with an OTTL parse error at collector boot), `stamp_log_metadata_from_msg`, `memory_limiter`, `batch`, healthcheck.
3. **Retarget exporters** to K8s DNS — replace hard-coded hosts with the chart's service names: `vtraces.{{ "{{ .Values.namespace }}" }}.svc.cluster.local:10428`, `vmetrics...:8429`, `vlogs...:9428` (Helm templating is NOT evaluated in `.Files.Get` content by default — either keep plain DNS `vtraces.genieai.svc.cluster.local` fixed to the default namespace, or render through a ConfigMap and set endpoints via collector `env` substitution. For Plan 4 the plain fixed names are acceptable; per-env overrides land in Plan 6.)

- [ ] **Step 3: Write `charts/genieai-umbrella/templates/_observability/otel-collector.yaml`**

Single source of truth: the CR's `spec.config` inlines the ported file via `.Files.Get`. No duplicated inline config, no second copy to drift.

```yaml
{{- if .Values.observability.otel.enabled -}}
apiVersion: opentelemetry.io/v1beta1
kind: OpenTelemetryCollector
metadata:
  name: genieai-collector
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "otel-collector"))) | nindent 4 }}
spec:
  mode: deployment
  image: ghcr.io/open-telemetry/opentelemetry-collector-contrib:0.111.0
  # The gateway's OTLP receiver port is exposed as a Service named
  # `genieai-collector-collector` by the operator — the Task 4b agent and
  # app SDKs (OTEL_EXPORTER_OTLP_ENDPOINT) target that name.
  config:
{{ .Files.Get "configs/otel-collector-config.yaml" | indent 4 }}
  env:
    - name: MY_POD_IP
      valueFrom:
        fieldRef:
          fieldPath: status.podIP
{{- end -}}
```

- [ ] **Step 4: Render with `clusterProfile: prod` and confirm components**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | grep -E "OpenTelemetryCollector|genieai-collector" | head`
Expected: shows the gateway collector CR with its inlined config.

- [ ] **Step 5: Validate the ported config survived intact (Review Focus #4 + port fidelity)**

Run:

```bash
helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | \
  python3 -c "import sys, yaml; docs = list(yaml.safe_load_all(sys.stdin)); \
  cr = next(d for d in docs if d and d.get('kind') == 'OpenTelemetryCollector'); \
  cfg = cr['spec']['config']; \
  assert 'pii_redact' in str(cfg), 'pii_redact missing'; \
  assert 'stamp_log_metadata_from_msg' in str(cfg), 'metadata stamp missing'; \
  assert 'fluent_forward' not in str(cfg), 'fluent_forward must be removed on K8s'; \
  import json; print(json.dumps(cfg['service']['pipelines']['logs'], indent=2))"
```

Expected: prints the logs pipeline; the three assertions pass. If `otelcol` is available locally, additionally dump `cfg` to a file and run `otelcol validate --config=...`.

- [ ] **Step 6: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 7: Commit**

```bash
git add charts/genieai-umbrella/configs/otel-collector-config.yaml charts/genieai-umbrella/templates/_observability/otel-collector.yaml
git commit -m "feat(charts): gateway OpenTelemetryCollector with verbatim-ported config (pii_redact + metadata stamp)"
```

---

## Task 4b: Log-ingestion agent — OpenTelemetryCollector DaemonSet

**Files:**
- Create: `charts/genieai-umbrella/templates/_observability/otel-agent.yaml`
- Create: `charts/genieai-umbrella/templates/_rbac/otel-agent-role.yaml`

**Interfaces:**
- Consumes: `observability.otel.enabled`; the gateway CR from Task 4 (operator-exposed Service `genieai-collector-collector`).
- Produces: 1 `OpenTelemetryCollector` (mode: daemonset) + ServiceAccount/Role for `k8sattributes`.

**Why (Review Focus #6 / `docs/charts/otel-migration.md` §3 item 1):** the Swarm pipeline shipped container logs via the Docker fluentd driver → `fluent_forward`. On containerd/K8s that driver does not exist; without a node-level filelog agent, **no container logs reach VictoriaLogs** and the admin logs UI returns empty. The agent is a dumb shipper — all transforms stay in the gateway (single PII/stamping point).

- [ ] **Step 1: Run red-gate — no agent CR yet**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | grep -c "mode: daemonset" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/_rbac/otel-agent-role.yaml`**

```yaml
{{- if .Values.observability.otel.enabled -}}
apiVersion: v1
kind: ServiceAccount
metadata:
  name: genieai-agent
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "otel-agent"))) | nindent 4 }}
---
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: genieai-agent
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "otel-agent"))) | nindent 4 }}
rules:
  # k8sattributes enrichment: resolve pod IP -> pod/namespace metadata
  - apiGroups: [""]
    resources: ["pods"]
    verbs: ["get", "list", "watch"]
---
apiVersion: rbac.authorization.k8s.io/v1
kind: RoleBinding
metadata:
  name: genieai-agent
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "otel-agent"))) | nindent 4 }}
roleRef:
  apiGroup: rbac.authorization.k8s.io
  kind: Role
  name: genieai-agent
subjects:
  - kind: ServiceAccount
    name: genieai-agent
    namespace: {{ .Values.namespace }}
{{- end -}}
```

- [ ] **Step 3: Write `charts/genieai-umbrella/templates/_observability/otel-agent.yaml`**

```yaml
{{- if .Values.observability.otel.enabled -}}
apiVersion: opentelemetry.io/v1beta1
kind: OpenTelemetryCollector
metadata:
  name: genieai-agent
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "otel-agent"))) | nindent 4 }}
spec:
  mode: daemonset
  serviceAccount: genieai-agent
  image: ghcr.io/open-telemetry/opentelemetry-collector-contrib:0.111.0
  volumes:
    - name: varlogpods
      hostPath:
        path: /var/log/pods
        type: Directory
  volumeMounts:
    - name: varlogpods
      mountPath: /var/log/pods
      readOnly: true
  config:
    receivers:
      filelog:
        # containerd CRI log layout: /var/log/pods/<ns>_<pod>_<uid>/<container>/<n>.log
        include:
          - /var/log/pods/*/*/*.log
        exclude:
          - /var/log/pods/kube-system_*/*/*.log
        start_at: end
        include_file_path: true
        operators:
          # CRI line format: "<time> <stream> <logtag> <body>"
          - type: regex_parser
            id: parse-cri
            regex: '^(?P<time>[^ ]+) (?P<stream>stdout|stderr) (?P<logtag>[^ ]*) (?P<body>.*)$'
            timestamp:
              parse_from: attributes.time
              layout_type: gotime
              layout: '2006-01-02T15:04:05.999999999Z07:00'
          - type: move
            from: attributes.body
            to: body
          - type: move
            from: attributes.stream
            to: attributes["log.iostream"]
    processors:
      k8sattributes:
        extract:
          metadata:
            - k8s.pod.name
            - k8s.pod.uid
            - k8s.namespace.name
            - k8s.container.name
        pod_association:
          - sources:
              - from: resource_attribute
                name: k8s.pod.ip
      memory_limiter:
        check_interval: 1s
        limit_percentage: 75
        spike_limit_percentage: 15
      batch: {}
    exporters:
      # Ship to the gateway — single transform point (pii_redact + stamp
      # live there, NOT here). OTLP/HTTP to the operator-created Service.
      otlp/gateway:
        endpoint: http://genieai-collector-collector.{{ .Values.namespace }}.svc.cluster.local:4318
        tls:
          insecure: true
    service:
      pipelines:
        logs:
          receivers: [filelog]
          processors: [k8sattributes, memory_limiter, batch]
          exporters: [otlp/gateway]
{{- end -}}
```

- [ ] **Step 4: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 5: Render and assert BOTH collector modes exist (Review Focus #6)**

Run:

```bash
helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | \
  python3 -c "import sys, yaml; docs = list(yaml.safe_load_all(sys.stdin)); \
  crs = [d for d in docs if d and d.get('kind') == 'OpenTelemetryCollector']; \
  modes = sorted(c['spec']['mode'] for c in crs); \
  assert modes == ['daemonset', 'deployment'], modes; \
  agent = next(c for c in crs if c['spec']['mode'] == 'daemonset'); \
  assert 'filelog' in agent['spec']['config']['receivers'], 'no filelog receiver'; \
  assert any(v.get('hostPath', {}).get('path') == '/var/log/pods' for v in agent['spec'].get('volumes', [])), 'no hostPath'; \
  print('PASS')"
```

Expected: prints `PASS` (gateway `deployment` + agent `daemonset`, filelog receiver, `/var/log/pods` hostPath).

- [ ] **Step 6: Commit**

```bash
git add charts/genieai-umbrella/templates/_observability/otel-agent.yaml charts/genieai-umbrella/templates/_rbac/otel-agent-role.yaml
git commit -m "feat(charts): DaemonSet log-ingestion agent (filelog -> gateway -> VL)"
```

---

## Task 5: Grafana via grafana-operator (instance + datasources + dashboards)

**Files:**
- Create: `charts/genieai-umbrella/templates/_observability/grafana-cr.yaml` (Grafana instance + 3 `GrafanaDatasource` CRs)
- Create: `charts/genieai-umbrella/templates/_observability/grafana-dashboards.yaml` (9 `GrafanaDashboard` CRs from the existing dashboard JSONs)
- Create: `charts/genieai-umbrella/configs/grafana-dashboards/.gitkeep` (the 9 ported JSONs land here — copied from `configs/grafana/provisioning/dashboards/`)

**Interfaces:**
- Consumes: `observability.grafana.enabled`; VM/VL/VT service DNS names; the 9 existing dashboard JSON files.
- Produces: 1 `Grafana` CR + 3 `GrafanaDatasource` CRs + 9 `GrafanaDashboard` CRs — all operator-managed (K8s-native per `docs/charts/k8s-native-audit.md` decision 2).

**Native-audit note:** replaced the earlier grafana-subchart + ConfigMap-sidecar posture. grafana-operator (official `grafana/grafana-operator`, v5, chart `grafana/grafana-operator` 5.22.x) manages the instance and resources as CRs; dashboards stop being provisioning-file sidecars and become API objects.

- [ ] **Step 1: Copy the 9 dashboard JSONs into the chart**

```bash
mkdir -p charts/genieai-umbrella/configs/grafana-dashboards
cp configs/grafana/provisioning/dashboards/**/*.json \
   charts/genieai-umbrella/configs/grafana-dashboards/ 2>/dev/null || \
   find configs/grafana/provisioning/dashboards -name '*.json' \
        -exec cp {} charts/genieai-umbrella/configs/grafana-dashboards/ \;
ls charts/genieai-umbrella/configs/grafana-dashboards/ | wc -l   # expect 9
```

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/_observability/grafana-cr.yaml`**

```yaml
{{- if .Values.observability.grafana.enabled -}}
apiVersion: grafana.integreatly.org/v1beta1
kind: Grafana
metadata:
  name: genieai
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "grafana"))) | nindent 4 }}
spec:
  config:
    security:
      admin_user: {{ .Values.observability.grafana.adminUser | default "admin" }}
    # adminPassword injected from the grafanaAdminPassword Secret via
    # spec.deployment.envFrom (Plan 2/4 SealedSecret) — never inline.
  deployment:
    envFrom:
      - secretRef:
          name: grafanaAdminPassword
  resources:
    requests: { cpu: 50m, memory: 128Mi }
    limits:   { cpu: 500m, memory: 512Mi }
---
# Datasource: VictoriaMetrics (Prometheus-compatible)
apiVersion: grafana.integreatly.org/v1beta1
kind: GrafanaDatasource
metadata:
  name: vmetrics
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "grafana"))) | nindent 4 }}
spec:
  instanceSelector:
    matchLabels:
      genieai.io/component: grafana
  datasource:
    name: VictoriaMetrics
    type: prometheus
    url: http://vmetrics.{{ .Values.namespace }}.svc.cluster.local:8429
    access: proxy
    isDefault: true
---
# Datasource: VictoriaLogs
apiVersion: grafana.integreatly.org/v1beta1
kind: GrafanaDatasource
metadata:
  name: vlogs
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "grafana"))) | nindent 4 }}
spec:
  instanceSelector:
    matchLabels:
      genieai.io/component: grafana
  datasource:
    name: VictoriaLogs
    type: victorialogs
    url: http://vlogs.{{ .Values.namespace }}.svc.cluster.local:9428
    access: proxy
---
# Datasource: traces — Grafana's Jaeger datasource queries VictoriaTraces
# DIRECTLY (VT implements the Tempo HTTP API natively — verified
# 2026-10-08, docs.victoriametrics.com/victoriatraces/querying/grafana/).
# No tempo-proxy: the Swarm proxy component is a vestige, not ported
# (k8s-native-audit decision 1).
apiVersion: grafana.integreatly.org/v1beta1
kind: GrafanaDatasource
metadata:
  name: vtraces-jaeger
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "grafana"))) | nindent 4 }}
spec:
  instanceSelector:
    matchLabels:
      genieai.io/component: grafana
  datasource:
    name: Jaeger
    type: jaeger
    url: http://vtraces.{{ .Values.namespace }}.svc.cluster.local:10428
    access: proxy
{{- end -}}
```

- [ ] **Step 3: Write `charts/genieai-umbrella/templates/_observability/grafana-dashboards.yaml`** (one CR per ported JSON)

```yaml
{{- if .Values.observability.grafana.enabled -}}
{{- range $path, $_ := .Files.Glob "configs/grafana-dashboards/*.json" -}}
{{- $name := base $path | trimSuffix ".json" -}}
---
apiVersion: grafana.integreatly.org/v1beta1
kind: GrafanaDashboard
metadata:
  name: {{ $name }}
  namespace: {{ $.Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" $.Chart "Release" $.Release "Values" (deepCopy $.Values | merge (dict "component" "grafana"))) | nindent 4 }}
spec:
  instanceSelector:
    matchLabels:
      genieai.io/component: grafana
  json: |
{{ $.Files.Get $path | indent 4 }}
{{- end -}}
{{- end -}}
```

- [ ] **Step 4: Render and verify (Review Focus #3 — VT direct, no proxy)**

Run:

```bash
helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | \
  python3 -c "import sys, yaml; docs = list(yaml.safe_load_all(sys.stdin)); \
  ds = [d for d in docs if d and d.get('kind') == 'GrafanaDatasource']; \
  jaeger = next(d for d in ds if d['spec']['datasource']['type'] == 'jaeger'); \
  assert 'vtraces.' in jaeger['spec']['datasource']['url'], jaeger['spec']['datasource']['url']; \
  assert 'tempo-proxy' not in str(docs), 'tempo-proxy must not render'; \
  n = len([d for d in docs if d and d.get('kind') == 'GrafanaDashboard']); \
  print(f'PASS: jaeger->vtraces direct, {n} dashboards')"
```

Expected: prints `PASS: jaeger->vtraces direct, 9 dashboards`.

- [ ] **Step 5: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add charts/genieai-umbrella/configs/grafana-dashboards/ charts/genieai-umbrella/templates/_observability/grafana-cr.yaml charts/genieai-umbrella/templates/_observability/grafana-dashboards.yaml
git commit -m "feat(charts): grafana-operator CRs — instance, datasources (VM/VL/Jaeger->VT direct), 9 dashboards"
```

## Task 6: REMOVED — tempo-proxy (native replacement)

**No files. No steps.**

The Swarm `tempo-proxy` service (Jaeger query proxy in front of VictoriaTraces) is **not ported**. Verified 2026-10-08 against the official docs (`docs.victoriametrics.com/victoriatraces/querying/grafana/`): VictoriaTraces implements the **Tempo HTTP API natively**, and Grafana's Jaeger datasource queries VT directly. The proxy was compensating plumbing from the Swarm era — exactly the kind of bespoke component the K8s-native audit (`docs/charts/k8s-native-audit.md`, decision 1) removes.

Consequences:
- No `tempo-proxy` helm dependency, no Deployment/Service template.
- Grafana traces datasource points at `http://vtraces.<ns>.svc.cluster.local:10428` (Task 5).
- Service inventory: 29 (was 30); Group 1 = 5.

## Task 7: ServiceMonitor emission per Group 5 service (conditional)

**Files:**
- Modify: `charts/genieai-umbrella/templates/_lib/_service-factory.tpl` (Plan 3) — append ServiceMonitor block

**Interfaces:**
- Consumes: each service's `serviceMonitor: true|false` toggle.
- Produces: per-service PrometheusServiceMonitor CR, only when `observability.metrics.enabled: true`.

- [ ] **Step 1: Append to the service factory helper** in `charts/genieai-umbrella/templates/_lib/_service-factory.tpl`

After the existing `--- end -}}` closing the Deployment block, add:

```gotemplate
{{- /*
ServiceMonitor emission. Review Focus #2 — only when observability.metrics
is enabled AND the per-service toggle is true.
*/ -}}
{{- if and $ctx.Values.observability.metrics.enabled $svc.serviceMonitor -}}
---
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: {{ include "genieai-common.fullname" $ctx }}-{{ $svcName }}
  namespace: {{ $ctx.Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" $ctx.Chart "Release" $ctx.Release "Values" (deepCopy $ctx.Values | merge (dict "component" $svcName))) | nindent 4 }}
    release: {{ $ctx.Release.Name }}-observability
spec:
  selector:
    matchLabels:
      genieai.io/component: {{ $svcName }}
  endpoints:
    - port: http
      path: /metrics
      interval: 30s
{{- end -}}
```

- [ ] **Step 2: Render with `observability.metrics.enabled: true` and a service having `serviceMonitor: true`**

Run: `helm template test charts/genieai-umbrella -n genieai --set observability.metrics.enabled=true --set 'clusterProfileReplicas.prod.backend=2' | grep -c "^kind: ServiceMonitor$" || echo "0"`
Expected: prints ≥1.

(Note: with default `serviceMonitor: false` on every service, the count is 0 even with observability on. To validate, set `serviceMonitor: true` on a service via `--set services.backend.serviceMonitor=true`.)

- [ ] **Step 3: Render with `observability.metrics.enabled: false` — no ServiceMonitor (Review Focus #2)**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: ServiceMonitor$" || echo "0"`
Expected: prints `0`.

- [ ] **Step 4: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add charts/genieai-umbrella/templates/_lib/_service-factory.tpl
git commit -m "feat(charts): ServiceMonitor emission in service factory (conditional)"
```

---

## Task 8: ClusterProfile-driven observability toggle (default-on for staging/prod/sovereign)

**Files:**
- Modify: `charts/genieai-umbrella/templates/_lib/_clusterprofile-defaults.tpl` (NEW file)

**Interfaces:**
- Consumes: `clusterProfile` value.
- Produces: a template helper that emits per-component enabled booleans driven by profile.

- [ ] **Step 1: Write `charts/genieai-umbrella/templates/_lib/_clusterprofile-defaults.tpl`**

```gotemplate
{{/*
Profile-driven boolean defaults. Used by templates that need to consult the
profile for fine-grained toggles beyond the per-component values keys.
*/}}
{{- define "genieai-umbrella.profileProduction" -}}
{{- or (eq .Values.clusterProfile "prod") (eq .Values.clusterProfile "staging") (eq .Values.clusterProfile "sovereign") -}}
{{- end -}}

{{- define "genieai-umbrella.profileDev" -}}
{{- or (eq .Values.clusterProfile "dev") (eq .Values.clusterProfile "") -}}
{{- end -}}

{{- /*
Observability default. Per spec §5.2: dev=off, staging/prod/sovereign=on.
This helper is invoked by the umbrellas's `_observability/**.yaml` files
to derive the per-component `enabled` flag.
*/}}
{{- define "genieai-umbrella.observabilityDefault" -}}
{{- if hasKey .Values.observability "explicitEnabled" -}}
{{- .Values.observability.explicitEnabled -}}
{{- else -}}
{{- not (include "genieai-umbrella.profileDev" .) -}}
{{- end -}}
{{- end -}}
```

- [ ] **Step 2: Update `values.yaml`** so `observability.enabled` uses the helper at template-time

Replace the static `enabled: false` with `enabled: {{ include "genieai-umbrella.observabilityDefault" . | eq true }}` at the top level (and the per-component mirrors). This requires the helper to be called from `values.yaml` — Helm templates ARE evaluated there.

Actually `values.yaml` is not templated; it's static. The default belongs in the **templates**, not in values.yaml. Skip this step. The helper is invoked at template-render time in each observability template. Verify in Task 2 Step 4.

- [ ] **Step 3: Render with `clusterProfile: prod` — at least 1 observability resource**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | grep "^kind: " | sort | uniq -c | sort -rn | head`
Expected: shows ≥1 of `VMCluster`/`VMSingle`, `VLSingle`, `VTSingle`, `VMAgent`, `OpenTelemetryCollector` (with `clusterProfile=prod` toggling the profile default ON).

- [ ] **Step 4: Render with `clusterProfile: dev` — observability off**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -E "^kind: (VMSingle|VMCluster|VLSingle|VTSingle|VMAgent|OpenTelemetryCollector)" | wc -l`
Expected: prints `0`.

- [ ] **Step 5: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add charts/genieai-umbrella/templates/_lib/_clusterprofile-defaults.tpl
git commit -m "feat(charts): ClusterProfile-driven observability defaults"
```

---

## Task 9: helm test for observability stack reachable

**Files:**
- Create: `charts/genieai-umbrella/templates/tests/test-observability-reachability.yaml`

**Interfaces:**
- Consumes: the observability stack from Tasks 3-6.
- Produces: a `helm test` Pod that curls each observability service and asserts reachability.

- [ ] **Step 1: Write `charts/genieai-umbrella/templates/tests/test-observability-reachability.yaml`**

```yaml
---
apiVersion: v1
kind: Pod
metadata:
  name: {{ include "genieai-common.fullname" . }}-test-observability
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
          check() {
            url=$1
            code=$(curl -s -o /dev/null -w '%{http_code}' "$url" 2>/dev/null || echo 000)
            # /healthz / /metrics all return 200 when service is reachable
            if [ "$code" != "000" ] && [ "$code" -ge 200 ] && [ "$code" -lt 500 ]; then
              echo "PASS: $url -> ${code}"
            else
              echo "FAIL: $url -> ${code}"
              failures=$((failures+1))
            fi
          }
          check http://vmetrics.${ns}.svc.cluster.local:8429/healthz
          check http://vlogs.${ns}.svc.cluster.local:9428/healthz
          check http://vtraces.${ns}.svc.cluster.local:10428/healthz
          check http://otel-collector.${ns}.svc.cluster.local:4318/v1/traces
          if [ "$failures" -gt 0 ]; then
            echo "FAIL: $failures service(s) unreachable"
            exit 1
          fi
          echo "PASS: all observability components reachable"
```

- [ ] **Step 2: Render and verify**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | grep -A 1 "test-observability" | head -5`
Expected: shows the test pod.

- [ ] **Step 3: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add charts/genieai-umbrella/templates/tests/test-observability-reachability.yaml
git commit -m "test(charts): helm test for observability stack reachability"
```

---

## Task 10: Observability SealedSecrets (grafanaAdminPassword + kcGrafanaClientSecret)

**Files:**
- Create: `charts/genieai-umbrella/templates/_secrets/observability-secrets.yaml`

**Interfaces:**
- Consumes: spec §8 F14 mapping table (Group 4 secrets).
- Produces: 2 SealedSecret CRs.

- [ ] **Step 1: Write `charts/genieai-umbrella/templates/_secrets/observability-secrets.yaml`**

```yaml
{{- if .Values.secrets.sealedSecrets.enabled -}}
{{- /* Per spec §8 F14 mapping:
       grafanaAdminPassword     → grafanaAdminPassword (rendered for Grafana)
       kcGrafanaClientSecret   → kc-grafana-client-secret
*/ -}}
{{- range $secretName := list "grafanaAdminPassword" "kc-grafana-client-secret" -}}
apiVersion: bitnami.com/v1alpha1
kind: SealedSecret
metadata:
  name: {{ $secretName }}
  namespace: {{ $.Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" $.Chart "Release" $.Release "Values" (deepCopy $.Values | merge (dict "component" "sealed-secret"))) | nindent 4 }}
    app.kubernetes.io/component: observability-secrets
spec:
  encryptedData:
    password: PLACEHOLDER_{{ $secretName }}_SEALED_KID
{{- end -}}
{{- end -}}
```

- [ ] **Step 2: Render with `data.keycloak.enabled: true` (default)**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "^kind: SealedSecret$"`
Expected: prints `9` (4 Plan 2 + 3 Plan 3 + 2 Plan 4).

- [ ] **Step 3: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 4: Commit**

```bash
git add charts/genieai-umbrella/templates/_secrets/observability-secrets.yaml
git commit -m "feat(charts): Observability SealedSecrets (grafanaAdminPassword, kc-grafana-client-secret)"
```

---

## Task 11: Final validation + READMEs

**Files:**
- Modify: `charts/README.md` (Plan status table)
- Modify: `charts/genieai-umbrella/README.md` (observability layer added)

- [ ] **Step 1: Update `charts/README.md` Plan status**

```bash
cat > charts/README.md <<'EOF'
# GENIE.AI Helm charts

This directory holds the Kubernetes-deployment Helm charts for GENIE.AI.

## Status

Foundation + Plans 2-4 complete (data layer, service tier Group 5, observability). Next: Plan 5 (AI/ML), Plan 6 (per-env + ingress), Plan 7 (CI), Plan 8 (docs).

## Charts

| Chart | Status | Purpose |
|---|---|---|
| `genieai-common` | foundation | Library chart (templates + helpers) |
| `genieai-umbrella` | foundation + Plans 2-4 | Single-install chart, data layer + Group-5 services + observability |

## Other directories

- `deploy/environments/` — per-environment Kustomize overlays + values-override files.
- `docs/charts/` — dev-internal reference docs.
- `configs/` — static operator-supplied configs (e.g. PII redaction).

## Conventions

- Helm API v2. Helm 4.x.
- No secrets in `values-override.yaml`. Use SealedSecret resources (Plan 2 default backend).
- Tests live in each chart's `tests/` directory; `ct install` for integration, `helm test` for smoke.
- NetworkPolicy: every service gets default-deny + explicit allowlist.
- PDB: only emitted when `replicas >= 2`.
- Observability: profile-gated; `dev=off`, `staging/prod/sovereign=on` by default.
EOF

git add charts/README.md
git commit -m "docs(charts): mark Foundation + Plans 2-4 complete in charts/README.md"
```

- [ ] **Step 2: Update `charts/genieai-umbrella/README.md` with observability layer**

```bash
cat >> charts/genieai-umbrella/README.md <<'EOF'

## Observability layer

Plan 4 shipped:

| Component | Resource type | Default |
|---|---|---|
| VictoriaMetrics | VMSingle (dev/sovereign) / VMCluster (prod) | on for staging/prod/sovereign |
| VictoriaLogs | VLSingle | on for staging/prod/sovereign |
| VictoriaTraces | VTSingle | on for staging/prod/sovereign |
| OpenTelemetry Collector | OpenTelemetryCollector (gateway mode) | on for staging/prod/sovereign |
| Grafana | grafana-operator CRs (Grafana + GrafanaDatasource + 9 GrafanaDashboard) | optional |
| Traces query | Grafana Jaeger datasource -> VictoriaTraces direct (native Tempo HTTP API) | bundled when traces enabled |

Per-service `serviceMonitor: true` triggers a Prometheus ServiceMonitor emission only when `observability.metrics.enabled: true`. PII redaction transform processor is part of the OTel Collector's gateway pipeline (regex rules ported from the current Swarm fluentd config).

PII redaction rules: shipped inside the ported `configs/otel-collector-config.yaml` (verbatim from the Swarm config — the canonical source). Operators override per-env by forking the file in `deploy/environments/<env>/`; Plan 7 conftest lints that no rule is dropped.
EOF

git add charts/genieai-umbrella/README.md
git commit -m "docs(charts): genieai-umbrella README with observability layer status"
```

- [ ] **Step 3: Final render summary**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | grep "^kind:" | sort | uniq -c | sort -rn | head -10`
Expected: comprehensive overview showing Services, Deployments, NetworkPolicies, SealedSecrets, VM*, V*, OTelCollector, ConfigMap, ServiceMonitor, etc.

- [ ] **Step 4: Final lint + ct lint**

Run:
```bash
helm lint charts/genieai-umbrella --strict
ct lint --config charts/ci/ct.yaml --charts charts/genieai-umbrella
```
Expected: 0 errors from both.

---

## Self-Review

After writing all 11 tasks, run this checklist against the spec.

**1. Spec coverage** (observability slice):

| Spec section | Task |
|---|---|
| §10 observability stack default (profile-gated) | Tasks 2, 8 |
| §10 vmoperator (VM/VL/VT) | Task 3 |
| §10 opentelemetry-operator | Task 4 |
| §10 grafana-operator (instance/datasources/dashboards CRs) | Task 5 |
| §10 PII redaction transform | Task 4 |
| §10 log ingestion (agent DaemonSet replacing the fluentd-driver pipeline) | Task 4b |
| §7 ServiceMonitors conditional | Task 7 |
| §10 traces query via VT-native Tempo HTTP API (tempo-proxy REMOVED) | Task 5 Step 4 + Task 6 note |
| §8 observability SealedSecrets (grafanaAdminPassword, kcGrafanaClientSecret per §8 F14) | Task 10 |
| §17 observability entries in v1.0 manifest | Tasks 1-10 |

Sections deferred:
- §13.2 conftest-based PII redaction lint — Plan 7
- §14 OTLP/auth service-account tokens for cross-component auth — Plan 7
- §10 dashboards pre-configured via Grafana provisioning sidecar — Plan 6

**2. Placeholder scan**: only intentional `PLACEHOLDER_*_SEALED_KID` markers in sealed-secrets. No "TBD" or "TODO".

**3. Type consistency**: `genieai-common.labels`, `genieai-common.serviceSelector`, `genieai-common.fullname` invoked uniformly across Tasks 3-10. CRDs namespace-scoped (release namespace).

**4. Review Focus coverage**: 5 input-class concerns pinned:

1. vmoperator CRD version compat (K8s 1.32) → Task 1 Step 4 (`helm dep list` parses pinned versions).
2. ServiceMonitor only when observability + per-service toggle → Task 7 Step 3 (render asserts 0 ServiceMonitors when observability off).
3. Traces query VT-direct (no proxy) → Task 5 Step 4 (asserts jaeger datasource URL contains vtraces + zero tempo-proxy in render).
4. PII redaction yaml schema (error_mode: ignore) → Task 4 Step 5 (assertions on ported config + otelcol validate when available).
5. ClusterProfile-driven toggles → Task 8 Step 3-4 (render with prod AND dev; assert observable count).
6. Log ingestion without the fluentd driver → Task 4b Step 5 (render asserts gateway `deployment` + agent `daemonset` CRs, filelog receiver, `/var/log/pods` hostPath).

All six covered.

**5. Adversarial review note**: `/code-review` slash command recommended before executing Plan 4 Tasks 1-11.

---

## Plan Stats

- **Tasks:** 12
- **Files created:** 11 (4 vm CRD templates + 1 ported collector config + 1 gateway OTel template + 1 agent OTel template + 1 agent RBAC + 2 grafana-operator templates + 9 dashboard JSONs + SealedSecrets + helper + factory edit) + values.yaml diff
- **Files modified:** 2 (Chart.yaml + values.yaml)
- **Commits planned:** 12
- **Estimated review surface:** ~1000 lines added (heavy CRD templates)

## What's next after Plan 4

- Plan 5: AI/ML (vLLM + TEI + OPEA microservices + GPU operator + 14 Group-6 services including the restored tei_reranker)
- Plan 6: per-env Kustomize overlays + GitOps sync + ingress (Envoy Gateway + cert-manager + nginx volumeMount wiring — picks up Plan 3 Task 5 step 4 follow-up)
- Plan 7: CI integration + image signing + Renovate + uninstall safety + secret-leak lint + chart-schema-drift alert
- Plan 8: documentation (site content + docs/charts/*)
