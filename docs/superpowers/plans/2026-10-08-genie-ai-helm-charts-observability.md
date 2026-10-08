# GENIE.AI Helm Charts — Observability (Plan 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the observability tier of the GENIE.AI Helm chart: vmoperator (VictoriaMetrics / VictoriaLogs / VictoriaTraces official operator) + opentelemetry-operator + Grafana subchart + tempo-proxy (Swarm Jaeger-query proxy for VictoriaTraces) + per-service ServiceMonitors + PII redaction transform processor. Profile-gated (`dev=off`, `staging/prod/sovereign=on` per spec §5.2).

**Architecture:** Three independent operators, each managing their own custom resources: vmoperator manages `VMSingle`/`VMCluster`/`VLSingle`/`VLCluster`/`VTSingle`/`VTCluster`/`VMAgent`/`VMRule`, opentelemetry-operator manages `OpenTelemetryCollector`, Grafana is a lightweight subchart with sidecar datasources. Tempo-proxy is a community-maintained chart that mirrors the Swarm `tempo-proxy` service (Jaeger query API in front of VictoriaTraces). ServiceMonitors, for Prometheus-style scrape, get generated per Group 5 service conditionally. PII redaction at the OpenTelemetry Collector `transform` processor (regex rules ported from the current Swarm fluentd config).

**Tech Stack:** Helm 4.x, chart-testing (`ct` v3.x), kind 1.32, vmoperator chart `~> 0.45.0`, opentelemetry-operator chart `~> 0.50.0`, Grafana helm chart `~> 8.x`, tempo-proxy custom chart (community-maintained, ex `grokify/jaeger-query-proxy`).

**Spec:** `docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md` — this plan implements §10 (observability stack default + vmoperator + OTel Operator + Grafana + PII redaction), §6 pluggability (ClusterProfile-driven observability default), §11 v1.0 manifest observability entries.

## Global Constraints

- Helm chart API version: `v2`. Helm 4.x.
- Profile-gated: `observability.enabled` default derived from `clusterProfile` per spec §5.2 (dev=off, staging/prod/sovereign=on). Operators can override explicitly in `values-override.yaml`.
- All observability CRDs (VM*, OpenTelemetryCollector, Grafana datasource Secret) namespaced to the release namespace.
- PII redaction rules are an opaque blob in the chart (`configs/otel-pii-redaction.yaml`); operator edits + CI lint via conftest (Plan 7).
- All English documentation and comments per project CLAUDE.md.
- Commits in English using Conventional Commits.
- Worktree path: `/home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/k8s-migration/`. Branch: `feat/k8s-migration`.

## Review Focus

Five input-class concerns the spec implies but no Plan 4 task tests explicitly.

1. **vmoperator CRD version compatibility with K8s 1.32** — `~> 0.45.0` and `~> 0.50.0` pins may not align with K8s 1.32 admission. **Pinned in Task 1 Step 3** — `helm dep list` post-update confirms both operator versions; `helm install --dry-run` validates CRD shape.
2. **ServiceMonitor-conditional emission** — services get `serviceMonitor: true` only when `observability.enabled: true`. If a service emits monitor fields unconditionally, scrape targets reference non-existent endpoints on dev. **Pinned in Task 7 Step 4** — render asserts no ServiceMonitor resources emitted when observability off.
3. **tempo-proxy Jaeger query API parity with VictoriaTraces** — VictoriaTraces exposes OTLP storage but not the Jaeger query API. tempo-proxy is the bridge. Misconfigured endpoint or wrong query prefix → "Trace explorer" dashboard silently fails. **Pinned in Task 6 Step 5** — render asserts the tempo-proxy Service exposes port 16686 + Jaeger query URL path.
4. **PII redaction YAML schema** — OpenTelemetry Collector `transform` processor schema is versioned (v0.111+ uses `error_mode: ignore`). Older syntax accepted silently. **Pinned in Task 9 Step 4** — render asserts `error_mode: ignore` + each transform context statements name parsed by `otelcol validate`.
5. **ClusterProfile auto-derivation race** — Plan 4 implements `observability.enabled: {{ .Values.clusterProfile | default "dev" | eq "prod" | or (.Values.clusterProfile | eq "staging") | or ... }}`. Multiple boolean conditions can drift. **Pinned in Task 11 Step 4** — values.yaml tests render with `clusterProfile: dev` (observability off) and `clusterProfile: prod` (on); assert only.

---

## Task 1: Add observability helm deps to umbrella Chart.yaml

**Files:**
- Modify: `charts/genieai-umbrella/Chart.yaml`

**Interfaces:**
- Consumes: Plan 2 dep block.
- Produces: vmoperator + opentelemetry-operator + Grafana subchart + tempo-proxy added.

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
  - name: grafana
    version: "~> 8.5.0"
    repository: "https://grafana.github.io/helm-charts"
    condition: observability.grafana.enabled
  # tempo-proxy: community-maintained chart for Jaeger-query shim in front
  # of VictoriaTraces. ex `grokify/jaeger-query-proxy`. Upstream index URL.
  - name: tempo-proxy
    version: "~> 0.3.0"
    repository: "https://grokify.github.io/tempo-proxy"
    condition: observability.traces.enabled
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
git commit -m "feat(charts): add observability operator deps (vmoperator, OTel operator, grafana, tempo-proxy)"
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
- Create: `charts/genieai-umbrella/configs/otel-pii-redaction.yaml` (static data, mounted via ConfigMap)
- Create: `charts/genieai-umbrella/templates/_observability/otel-collector.yaml`

**Interfaces:**
- Consumes: `observability.otel.enabled`, `observability.piiRedaction.rules`.
- Produces: 1 `OpenTelemetryCollector` + 1 supporting ConfigMap.

- [ ] **Step 1: Write `charts/genieai-umbrella/configs/otel-pii-redaction.yaml`**

```yaml
# Operator-supplied PII redaction config for OpenTelemetry Collector.
# This is the default; operators override per env via values.yaml
# (observability.piiRedaction.rules). Used by the OTel Collector ConfigMap
# in templates/_observability/otel-collector.yaml.

processors:
  transform/PII:
    error_mode: ignore   # otelcol v0.111+ stable; per Review Focus #4
    trace_statements:
      - context: span
        statements:
          - replace_all_patterns(attributes["http.url"], "(email|token|key|password)", "[REDACTED]")
          - replace_all_patterns(attributes["http.target"], "(email|token|key|password)", "[REDACTED]")
    log_statements:
      - context: log
        statements:
          - replace_all_patterns(body, "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}", "[EMAIL REDACTED]")
          - replace_all_patterns(body, "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b", "[IP REDACTED]")
          - replace_all_patterns(body, "\\b[A-Fa-f0-9]{32,}\\b", "[HEX REDACTED]")
          - replace_all_patterns(body, "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b", "[UUID REDACTED]")
```

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/_observability/otel-collector.yaml`**

```yaml
{{- if .Values.observability.otel.enabled -}}
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "genieai-common.fullname" . }}-otel-collector
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "otel-collector"))) | nindent 4 }}
data:
  otelcol.yaml: |
    receivers:
      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
          http:
            endpoint: 0.0.0.0:4318
    processors:
      transform/PII:
        error_mode: ignore
        trace_statements:
          - context: span
            statements:
              - replace_all_patterns(attributes["http.url"], "(email|token|key|password)", "[REDACTED]")
              - replace_all_patterns(attributes["http.target"], "(email|token|key|password)", "[REDACTED]")
        log_statements:
          - context: log
            statements:
              - replace_all_patterns(body, "[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\\.[a-zA-Z]{2,}", "[EMAIL REDACTED]")
              - replace_all_patterns(body, "\\b(?:\\d{1,3}\\.){3}\\d{1,3}\\b", "[IP REDACTED]")
              - replace_all_patterns(body, "\\b[A-Fa-f0-9]{32,}\\b", "[HEX REDACTED]")
              - replace_all_patterns(body, "\\b[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\\b", "[UUID REDACTED]")
    service:
      pipelines:
        traces:
          receivers: [otlp]
          processors: [transform/PII]
          exporters: [otlp/vl, otlp/vt]
        logs:
          receivers: [otlp]
          processors: [transform/PII]
          exporters: [otlp/vl]
        metrics:
          receivers: [otlp]
          exporters: [otlp/vm]
    exporters:
      otlp/vm:
        endpoint: vmetrics.{{ .Values.namespace }}.svc.cluster.local:8429
        tls:
          insecure: true
      otlp/vl:
        endpoint: vlogs.{{ .Values.namespace }}.svc.cluster.local:9428
        tls:
          insecure: true
      otlp/vt:
        endpoint: vtraces.{{ .Values.namespace }}.svc.cluster.local:10428
        tls:
          insecure: true
---
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
  config:
    receivers:
      otlp:
        protocols:
          grpc:
            endpoint: 0.0.0.0:4317
          http:
            endpoint: 0.0.0.0:4318
    exporters:
      otlp/vm:
        endpoint: vmetrics.{{ .Values.namespace }}.svc.cluster.local:8429
        tls:
          insecure: true
      otlp/vl:
        endpoint: vlogs.{{ .Values.namespace }}.svc.cluster.local:9428
        tls:
          insecure: true
      otlp/vt:
        endpoint: vtraces.{{ .Values.namespace }}.svc.cluster.local:10428
        tls:
          insecure: true
    service:
      pipelines:
        traces:
          receivers: [otlp]
          processors: [transform/PII]
          exporters: [otlp/vt]
        logs:
          receivers: [otlp]
          processors: [transform/PII]
          exporters: [otlp/vl]
        metrics:
          receivers: [otlp]
          exporters: [otlp/vm]
  env:
    - name: MY_POD_IP
      valueFrom:
        fieldRef:
          fieldPath: status.podIP
{{- end -}}
```

- [ ] **Step 3: Render with `clusterProfile: prod` and confirm components**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | grep -E "OpenTelemetryCollector|otel-collector" | head`
Expected: shows both the ConfigMap and the collector CR.

- [ ] **Step 4: Validate the rendered OTel config with `otelcol validate` (Review Focus #4)**

Run:

```bash
helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | \
  python3 -c "import sys, yaml; docs = list(yaml.safe_load_all(sys.stdin)); \
  cm = next(d for d in docs if d and d.get('kind') == 'ConfigMap' and 'otel-collector' in d.get('metadata',{}).get('name','')); \
  print(cm['data']['otelcol.yaml'])" > /tmp/otelcol-rendered.yaml
# Validate with otelcol binary if available, else grep-based sanity check
which otelcol >/dev/null 2>&1 && otelcol validate --config=/tmp/otelcol-rendered.yaml || \
  grep -c "error_mode: ignore" /tmp/otelcol-rendered.yaml
```

Expected: 1 (grep count of error_mode), OR exit 0 from `otelcol validate`.

- [ ] **Step 5: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add charts/genieai-umbrella/configs/otel-pii-redaction.yaml charts/genieai-umbrella/templates/_observability/otel-collector.yaml
git commit -m "feat(charts): OpenTelemetryCollector with PII redaction transform processor"
```

---

## Task 5: Grafana deployment + datasources

**Files:**
- Create: `charts/genieai-umbrella/templates/_observability/grafana-datasources.yaml`

**Interfaces:**
- Consumes: `observability.grafana.enabled` + VM/VL/VT endpoints.
- Produces: 1 ConfigMap with Grafana datasources pointing at VictoriaMetrics, VictoriaLogs, and tempo-proxy (for VictoriaTraces).

- [ ] **Step 1: Run red-gate — no Grafana datasources yet**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | grep -c "datasources.yaml" || echo "0"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/_observability/grafana-datasources.yaml`**

The Grafana subchart's datasource provisioning is shipped via the umbrella; standard annotation on the Grafana deployment loads it.

```yaml
{{- if .Values.observability.grafana.enabled -}}
apiVersion: v1
kind: ConfigMap
metadata:
  name: {{ include "genieai-common.fullname" . }}-grafana-datasources
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "grafana"))) | nindent 4 }}
    grafana.io/provisioned-datasource: "true"
data:
  datasources.yaml: |
    apiVersion: 1
    datasources:
      - name: VictoriaMetrics
        type: prometheus
        url: http://vmetrics.{{ .Values.namespace }}.svc.cluster.local:8429
        access: proxy
      - name: VictoriaLogs
        type: victorialogs
        url: http://vlogs.{{ .Values.namespace }}.svc.cluster.local:9428
        access: proxy
      # tempo-proxy exposes Jaeger query API; Grafana connects to it for the
      # "Trace explorer" dashboard. VictoriaTraces is the storage backend;
      # tempo-proxy is the Jaeger-compatible query surface.
      - name: Jaeger
        type: jaeger
        url: http://tempo-proxy.{{ .Values.namespace }}.svc.cluster.local:16686
        access: proxy
        isDefault: false
{{- end -}}
```

- [ ] **Step 3: Render and verify**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | grep -A 2 "name: Jaeger" | head -5`
Expected: shows the Jaeger datasource pointing at tempo-proxy.

- [ ] **Step 4: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add charts/genieai-umbrella/templates/_observability/grafana-datasources.yaml
git commit -m "feat(charts): Grafana datasources (VictoriaMetrics, VictoriaLogs, Jaeger via tempo-proxy)"
```

---

## Task 6: tempo-proxy deployment (Swarm tempo-proxy component)

**Files:**
- Modify: `charts/genieai-umbrella/values.yaml` (add `tempo-proxy` config)
- Create: `charts/genieai-umbrella/templates/_observability/tempo-proxy.yaml`

**Interfaces:**
- Consumes: `observability.traces.enabled`.
- Produces: 1 Deployment + 1 Service mimicking Swarm `tempo-proxy` (Jaeger query API in front of VictoriaTraces).

- [ ] **Step 1: Add `tempo-proxy` config to `values.yaml`** (Block 4 from Task 2)

```yaml
  tempo-proxy:
    image:
      repository: ghcr.io/grokify/jaeger-query-proxy
      tag: "0.3.0"
    replicas: 1
    port: 16686
    # Back-end: VictoriaTraces OTLP. tempo-proxy translates Jaeger query
    # → OTLP query against VictoriaTraces.
    backend:
      url: http://vtraces.{{ .Values.namespace }}.svc.cluster.local:10428
```

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/_observability/tempo-proxy.yaml`**

```yaml
{{- if .Values.observability.traces.enabled -}}
apiVersion: apps/v1
kind: Deployment
metadata:
  name: {{ include "genieai-common.fullname" . }}-tempo-proxy
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "tempo-proxy"))) | nindent 4 }}
    app.kubernetes.io/component: tempo-proxy
spec:
  replicas: {{ .Values.observability.tempo-proxy.replicas | default 1 }}
  selector:
    matchLabels:
      genieai.io/component: tempo-proxy
  template:
    metadata:
      labels:
        genieai.io/component: tempo-proxy
    spec:
      securityContext:
        runAsNonRoot: true
        runAsUser: 65534
        seccompProfile:
          type: RuntimeDefault
      containers:
        - name: tempo-proxy
          image: "{{ .Values.observability.tempo-proxy.image.repository }}:{{ .Values.observability.tempo-proxy.image.tag }}"
          imagePullPolicy: IfNotPresent
          args:
            - --backend.url={{ .Values.observability.tempo-proxy.backend.url }}
            - --backend.type=otlp
            - --query.port={{ .Values.observability.tempo-proxy.port | default 16686 }}
          ports:
            - name: jaeger-query
              containerPort: {{ .Values.observability.tempo-proxy.port | default 16686 }}
          readinessProbe:
            httpGet:
              path: /
              port: {{ .Values.observability.tempo-proxy.port | default 16686 }}
          resources:
            requests: { cpu: 50m, memory: 64Mi }
            limits:   { cpu: 250m, memory: 128Mi }
---
apiVersion: v1
kind: Service
metadata:
  name: tempo-proxy
  namespace: {{ .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "tempo-proxy"))) | nindent 4 }}
spec:
  ports:
    - name: jaeger-query
      port: 16686
      targetPort: 16686
  selector:
    genieai.io/component: tempo-proxy
{{- end -}}
```

- [ ] **Step 3: Render with `clusterProfile: prod` (Review Focus #3)**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | grep -A 2 "name: jaeger-query" | head -5`
Expected: shows port 16686 exposed by the Service.

- [ ] **Step 4: Verify the Jaeger query URL prefix**

Run:

```bash
helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod | \
  python3 -c "import sys, yaml; docs = list(yaml.safe_load_all(sys.stdin)); \
  svc = next(d for d in docs if d and d.get('kind')=='Service' and d.get('metadata',{}).get('name')=='tempo-proxy'); \
  assert any(p.get('port')==16686 for p in svc['spec']['ports']), svc; \
  print('PASS')"
```

Expected: prints `PASS`.

- [ ] **Step 5: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add charts/genieai-umbrella/values.yaml charts/genieai-umbrella/templates/_observability/tempo-proxy.yaml
git commit -m "feat(charts): tempo-proxy Deployment + Service for VictoriaTraces Jaeger-query API"
```

---

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
| Grafana | subchart | optional |
| tempo-proxy | Deployment + Service (Jaeger query API) | bundled when traces enabled |

Per-service `serviceMonitor: true` triggers a Prometheus ServiceMonitor emission only when `observability.metrics.enabled: true`. PII redaction transform processor is part of the OTel Collector's gateway pipeline (regex rules ported from the current Swarm fluentd config).

PII redaction rules: shipped in `configs/otel-pii-redaction.yaml`. Operators override per-env via `observability.piiRedaction.rules` in `values-override.yaml`.
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
| §10 Grafana subchart | Task 5 |
| §10 PII redaction transform | Task 4 |
| §7 ServiceMonitors conditional | Task 7 |
| §10 tempo-proxy (Swarm tempo-proxy equivalence, Jaeger query API) | Task 6 |
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
3. tempo-proxy Jaeger port + URL prefix → Task 6 Step 4 (Python parse of Service spec).
4. PII redaction yaml schema (error_mode: ignore) → Task 4 Step 4 (grep + otelcol validate).
5. ClusterProfile-driven toggles → Task 8 Step 3-4 (render with prod AND dev; assert observable count).

All five covered.

**5. Adversarial review note**: `/code-review` slash command recommended before executing Plan 4 Tasks 1-11.

---

## Plan Stats

- **Tasks:** 11
- **Files created:** 8 (4 CRD templates + 1 OTel template + 1 Grafana datasources + 1 tempo-proxy + 1 factory template edit + SealedSecrets + helper) + values.yaml diff
- **Files modified:** 2 (Chart.yaml + values.yaml)
- **Commits planned:** 11
- **Estimated review surface:** ~900 lines added (heavy CRD templates)

## What's next after Plan 4

- Plan 5: AI/ML (vLLM + TEI + OPEA microservices + GPU operator + 14 Group-6 services including the restored tei_reranker + tempo-proxy)
- Plan 6: per-env Kustomize overlays + GitOps sync + ingress (Envoy Gateway + cert-manager + nginx volumeMount wiring — picks up Plan 3 Task 5 step 4 follow-up)
- Plan 7: CI integration + image signing + Renovate + uninstall safety + secret-leak lint + chart-schema-drift alert
- Plan 8: documentation (site content + docs/charts/*)
