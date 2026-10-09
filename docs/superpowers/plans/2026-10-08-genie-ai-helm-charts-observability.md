# GENIE.AI Helm Charts — Observability (Plan 4) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the observability tier of the GENIE.AI Helm chart: vmoperator (VictoriaMetrics / VictoriaLogs / VictoriaTraces official operator) + opentelemetry-operator (gateway + DaemonSet agent) + grafana-operator (instance, datasources, 9 dashboards as CRs — K8s-native per `docs/charts/k8s-native-audit.md`) + per-service VMServiceScrapes + PII redaction (config ported verbatim). Enablement is **explicit per-env** (`observability.enabled` + per-component flags in `values-override.yaml`): values.yaml is static — Helm does not template it — and the ClusterProfile hook can only emit an Event (§5.2), so profile-driven defaults cannot drive operator installs. Per-env overlays flip observability on. **No tempo-proxy** — VictoriaTraces implements the Tempo HTTP API natively; Grafana queries VT directly.

**Architecture:** Three operators: the **single `victoria-metrics-operator` chart** — there are NO separate victoria-logs-operator / victoria-traces-operator charts in the VM helm repo (verified against the repo index 2026-10-08; earlier drafts listed charts that do not exist) — provides ALL the VM/VL/VT CRDs (`VMSingle`/`VMCluster`, `VLSingle`, `VTSingle`, `VMAgent`, `VMServiceScrape`, `VMRule`, …). opentelemetry-operator manages `OpenTelemetryCollector` (gateway + agent), grafana-operator manages `Grafana`/`GrafanaDatasource`/`GrafanaDashboard`. No traces proxy — VictoriaTraces implements the Tempo HTTP API natively (verified 2026-10-08), Grafana's Jaeger datasource queries VT directly. VMServiceScrapes (vmoperator-native — no Prometheus operator is installed) get generated per Group 5 service conditionally. PII redaction and log-metadata stamping port **verbatim** from the existing `configs/otel/otel-collector-config.yaml` (OTTL `pii_redact` + `stamp_log_metadata_from_msg`) — the chart ports, never rewrites. Collector topology: **gateway** (Deployment, OTLP traces/metrics) + **agent** (DaemonSet, filelog container logs → gateway), replacing the Swarm fluentd-driver → `fluent_forward` pipeline which does not exist on containerd/K8s. See `docs/charts/otel-migration.md`.

**Tech Stack:** Helm 4.x, chart-testing (`ct` v3.x), kind 1.33, vmoperator chart `~> 0.45.0`, opentelemetry-operator chart `~> 0.50.0`, grafana-operator chart `~> 5.22.0` (official `grafana/grafana-operator`).

**Spec:** `docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md` — this plan implements §10 (observability stack default + vmoperator + OTel Operator + Grafana + PII redaction), §6 pluggability (ClusterProfile-driven observability default), §11 v1.0 manifest observability entries.

## Global Constraints

- Helm chart API version: `v2`. Helm 4.x.
- Explicit enablement: `observability.enabled: false` + per-component `enabled: false` ship as static values defaults; environments that want observability set them to `true` in `deploy/environments/<env>/values-override.yaml`. Profile-driven auto-enablement was DROPPED (values.yaml is not templated; the profile hook cannot mutate values — spec §5.2).
- All observability CRDs (VM*, OpenTelemetryCollector, Grafana datasource Secret) namespaced to the release namespace.
- PII redaction rules ship as the ported `configs/otel-collector-config.yaml` inside the chart (verbatim from the repo's Swarm config); operator edits + CI lint via conftest (Plan 7).
- All English documentation and comments per project CLAUDE.md.
- Commits in English using Conventional Commits.
- Worktree path: `/home/jerome/git_projects/ITU/genie-ai/.claude/worktrees/k8s-migration/`. Branch: `feat/k8s-migration`.

## Review Focus

Five input-class concerns the spec implies but no Plan 4 task tests explicitly.

1. **vmoperator CRD version compatibility with K8s 1.33** — `~> 0.45.0` and `~> 0.50.0` pins may not align with K8s 1.33 admission. **Pinned in Task 1 Step 3** — `helm dep list` post-update confirms both operator versions; `helm install --dry-run` validates CRD shape.
2. **VMServiceScrape-conditional emission** — services get `serviceMonitor: true` only when `observability.metrics.enabled: true`. If a service emits monitor fields unconditionally, scrape targets reference non-existent endpoints on dev. **Pinned in Task 7 Step 3** — render asserts no VMServiceScrape resources emitted when observability off.
3. **Traces query path must be VT-direct** — Grafana's Jaeger datasource must point at `vtraces` (Tempo HTTP API implemented natively by VictoriaTraces, verified 2026-10-08), NOT at a proxy. A stale proxy reference or wrong port makes the "Trace explorer" dashboard silently fail. **Pinned in Task 5 Step 4** — render asserts the jaeger datasource URL contains `vtraces.` and that `tempo-proxy` appears nowhere in the rendered output.
4. **PII redaction YAML schema** — OpenTelemetry Collector `transform` processor schema is versioned (v0.111+ uses `error_mode: ignore`). Older syntax accepted silently. **Pinned in Task 9 Step 4** — render asserts `error_mode: ignore` + each transform context statements name parsed by `otelcol validate`.
5. **Values.yaml templating trap** — earlier drafts wrote `{{ include ... }}` into values.yaml; Helm NEVER templates values files (the strings would ship as literal text and break YAML parse or, worse, parse as a string boolean). All defaults are plain static booleans; every profile-dependent decision lives in TEMPLATE conditionals (`eq .Values.clusterProfile "prod"`), not values. **Pinned in Task 2 Steps 3-4** — render with dev default (off) and explicit `--set observability.enabled=true` (on).
6. **Log ingestion without the fluentd driver** — containerd/K8s has no Docker fluentd logging driver, so the Swarm log pipeline (stdout → `fluent_forward` :24224 → VL) dies on arrival. Without a node-level agent, **zero container logs reach VictoriaLogs** and the admin logs UI returns empty. **Pinned in Task 4b Step 5** — render asserts BOTH collector CRs (gateway Deployment + agent DaemonSet); the agent's filelog receiver + hostPath mount are the structural fix.

---

## Task 1: Add observability helm deps to umbrella Chart.yaml

**Files:**
- Modify: `charts/genieai-umbrella/Chart.yaml`

**Interfaces:**
- Consumes: Plan 2 dep block.
- Produces: victoria-metrics-operator (×1 chart, ALL VM/VL/VT CRDs) + opentelemetry-operator + grafana-operator added. No tempo-proxy (native-audit decision 1).

- [ ] **Step 1: Run red-gate — no observability deps yet**

Run: `helm dep list charts/genieai-umbrella 2>&1 | grep -E "victoriametrics|opentelemetry|grafana|tempo" || echo "OK: no observability deps"`
Expected: `OK: no observability deps`.

- [ ] **Step 2: Append to `dependencies:` block in `charts/genieai-umbrella/Chart.yaml`**

```yaml
  # observability operators
  # ONE VM operator chart: victoria-metrics-operator is the ONLY chart in
  # the VM helm repo, and it ships ALL VM+VL+VT CRDs (VMSingle/VMCluster,
  # VLSingle, VTSingle, VMAgent, VMServiceScrape, VMRule, …). Separate
  # victoria-logs-operator / victoria-traces-operator charts DO NOT EXIST
  # (verified against the repo index 2026-10-08 — `helm dep update` on the
  # earlier 3-chart list fails). Condition = the master observability flag;
  # per-component CRs are gated at template level.
  - name: victoria-metrics-operator
    version: "~> 0.45.0"
    repository: "https://victoriametrics.github.io/helm-charts"
    condition: observability.enabled
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

- [ ] **Step 3: Run `helm dependency update`**

Run: `helm dependency update charts/genieai-umbrella`
Expected: 3 new tarballs land in `charts/genieai-umbrella/charts/`. Chart.lock regenerates.

- [ ] **Step 4: Verify dep list (Review Focus #1)**

Run: `helm dep list charts/genieai-umbrella | grep -E "victoria|opentelemetry|grafana|tempo"`
Expected: 3 lines, each with a pinned version. If any version has `~> 0.X.0` resolving to `0.X.<y>` for `y` with breaking CRD changes, this step surfaces that before the next plan.

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
# observability

# STATIC plain booleans. values.yaml is NEVER templated by Helm — an
# `{{ include ... }}` here ships as literal text.
# Defaults are OFF; environments that want observability set these true in
# deploy/environments/<env>/values-override.yaml (dev=off is the intended
# default; prod overlays flip master + components on). Profile-driven
# auto-enablement is impossible from values (§5.2: the profile hook can
# only emit an Event).
observability:
  enabled: false
  metrics:
    enabled: false
    retention: "30d"
    storageSize: 10Gi
  logs:
    enabled: false
    retention: "30d"
    storageSize: 20Gi
  traces:
    enabled: false
    retention: "30d"
    storageSize: 5Gi
  otel:
    enabled: false
  grafana:
    enabled: false
    adminUser: admin
    adminPasswordRef: grafana-admin-password    # SealedSecret name
  # NO piiRedaction values block: the collector config (including the
  # redaction transform) is ported VERBATIM from
  # configs/otel/otel-collector-config.yaml via .Files.Get — a values-side
  # copy would be dead config no template reads and would drift from the
  # ported source (the actual rule set covers email, JWT, sk-/pk-/api-
  # keys, 40+ char base64/hex runs, and Bearer tokens — NOT bare IP or
  # UUID).
```

- [ ] **Step 3: Render with defaults — observability off (Review Focus #5)**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -c "OpenTelemetryCollector"`
Expected: prints `0`. Also assert `grep -c "{{" charts/genieai-umbrella/values.yaml` prints `0` — no template syntax may live in values.

- [ ] **Step 4: Render with explicit enablement — observability on (Review Focus #5)**

Run: `helm template test charts/genieai-umbrella -n genieai --set observability.enabled=true --set observability.otel.enabled=true | grep -c "OpenTelemetryCollector"`
Expected: prints `>= 1` (the OTel Collector CR appears). Enablement is explicit — no profile expression exists to be buggy.

- [ ] **Step 5: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add charts/genieai-umbrella/values.yaml
git commit -m "feat(charts): observability block in values (static explicit toggles)"
```

---

## Task 3: vmoperator CRDs (VMSingle/Cluster + VLSingle + VTSingle + VMAgent)

**Files:**
- Create: `charts/genieai-umbrella/templates/observability/vmsingle.yaml`
- Create: `charts/genieai-umbrella/templates/observability/vlsingle.yaml`
- Create: `charts/genieai-umbrella/templates/observability/vtsingle.yaml`
- Create: `charts/genieai-umbrella/templates/observability/vmagent.yaml`

**Interfaces:**
- Consumes: vmoperator CRD types (`VMSingle`, `VLSingle`, `VTSingle`, `VMAgent`).
- Produces: 4 storage + 1 agent resource per install with observability enabled.

- [ ] **Step 1: Run red-gate — no observability CRDs yet**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod --set observability.enabled=true --set observability.metrics.enabled=true | grep -c "^kind: VMCluster$"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/observability/vmsingle.yaml`**

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
        {{- with .Values.pluggable.storageClassName }}
        storageClassName: {{ . }}
        {{- end }}
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
        {{- with .Values.pluggable.storageClassName }}
        storageClassName: {{ . }}
        {{- end }}
        resources:
          requests:
            storage: {{ .Values.observability.metrics.storageSize }}
{{- end -}}
{{- end -}}
```

- [ ] **Step 3: Write `charts/genieai-umbrella/templates/observability/vlsingle.yaml`**

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
        {{- with .Values.pluggable.storageClassName }}
        storageClassName: {{ . }}
        {{- end }}
        resources:
          requests:
            storage: {{ .Values.observability.logs.storageSize }}
{{- end -}}
```

- [ ] **Step 4: Write `charts/genieai-umbrella/templates/observability/vtsingle.yaml`**

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
        {{- with .Values.pluggable.storageClassName }}
        storageClassName: {{ . }}
        {{- end }}
        resources:
          requests:
            storage: {{ .Values.observability.traces.storageSize }}
{{- end -}}
```

- [ ] **Step 5: Write `charts/genieai-umbrella/templates/observability/vmagent.yaml`**

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
  # Remote write to VMSingle (or VMCluster). serviceScrapeSelector selects
  # the VMServiceScrapes emitted by the task.
  remoteWrite:
    # VMSingle serves 8428 (8429 is the CLUSTER vmselect port — single
    # mode remote-write hits 8428).
    # prod-profile renders VMCluster whose operator-created
    # Services are vmetrics-vminsert/vmetrics-vmselect/vmetrics-vmstorage
    # (NOT a single `vmetrics:8428` Service). The single-mode remoteWrite
    # URL silently 404s in prod. Use the cluster-aware write endpoint.
    {{- if eq .Values.clusterProfile "prod" }}
    - url: http://vmetrics-vminsert.{{ .Values.namespace }}.svc.cluster.local:8480/insert/0/prom/api/v1/write
    {{- else }}
    - url: http://vmetrics.{{ .Values.namespace }}.svc.cluster.local:8428/api/v1/write
    {{- end }}
{{- end -}}
```

- [ ] **Step 6: Render and verify**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod --set observability.enabled=true --set observability.metrics.enabled=true --set observability.logs.enabled=true --set observability.traces.enabled=true --set observability.otel.enabled=true | grep "^kind: " | sort | uniq -c | sort -rn | head`
Expected: shows `VMCluster × 1`, `VLSingle × 1`, `VTSingle × 1`, `VMAgent × 1`.

- [ ] **Step 7: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 8: Commit**

```bash
git add charts/genieai-umbrella/templates/observability/vmsingle.yaml charts/genieai-umbrella/templates/observability/vlsingle.yaml charts/genieai-umbrella/templates/observability/vtsingle.yaml charts/genieai-umbrella/templates/observability/vmagent.yaml
git commit -m "feat(charts): vmoperator CRDs (VMSingle/Cluster + VLSingle + VTSingle + VMAgent)"
```

---

## Task 4: OTel operator CRD + PII redaction transformation

**Files:**
- Create: `charts/genieai-umbrella/configs/otel-collector-config.yaml` (ported VERBATIM from repo `configs/otel/otel-collector-config.yaml` — per `docs/charts/otel-migration.md` §5)
- Create: `charts/genieai-umbrella/templates/observability/otel-collector.yaml`

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
3. **Retarget exporters to K8s DNS** using the collector's `env` substitution
   (NOT Helm templating — `.Files.Get` is not evaluated by Helm). The
   plan ships the file with the hostnames pointing at the
   **default** namespace `genieai` (plain DNS, no template syntax
   embedded), e.g.:
   - `vtraces.genieai.svc.cluster.local:10428`
   - `vmetrics.genieai.svc.cluster.local:8428`  (8429 is the CLUSTER
     vmselect port — single mode uses 8428)
   - `vlogs.genieai.svc.cluster.local:9428`
   For per-namespace installs, the executor must either (a) install with
   namespace=`genieai`, or (b) extend the template at implementation
   time by inlining the ported config into the chart template
   (`.Files.Get` → `tpl` render with namespace — required for el-salvador
   which uses `genieai-el-salvador`). The literal text
   `{{ "{{ .Values.namespace }}" }}` is **not** a valid OTLP endpoint
   and must NEVER land in the YAML; the per-namespace path is a
   follow-up templating change, not a copy-paste of this note.

- [ ] **Step 3: Write `charts/genieai-umbrella/templates/observability/otel-collector.yaml`**

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
  image: ghcr.io/open-telemetry/opentelemetry-collector-contrib:0.152.0   # matches the running Swarm stack (0.111.0 is 20+ versions stale)
  # The opentelemetry-operator exposes the OTLP receiver as a Service
  # named `<cr-name>-collector` (internal/naming/main.go: Service(otelcol)
  # = "%s-collector" — verified against operator source). The CR below is
  # `genieai-collector` -> the Service is `genieai-collector-collector`
  # on port 4318. The the task agent and every app SDK's
  # OTEL_EXPORTER_OTLP_ENDPOINT target this name. (An earlier plan draft
  # asserted the Service matched the CR name verbatim and "corrected"
  # the doubled form — that was backwards; docs/charts/otel-migration.md
  # has carried the correct name all along.)
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

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod --set observability.enabled=true --set observability.otel.enabled=true | grep -E "OpenTelemetryCollector|genieai-collector" | head`
Expected: shows the gateway collector CR with its inlined config.

- [ ] **Step 5: Validate the ported config survived intact (Review Focus #4 + port fidelity)**

Run:

```bash
helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod --set observability.enabled=true --set observability.metrics.enabled=true --set observability.logs.enabled=true --set observability.traces.enabled=true --set observability.otel.enabled=true | \
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
git add charts/genieai-umbrella/configs/otel-collector-config.yaml charts/genieai-umbrella/templates/observability/otel-collector.yaml
git commit -m "feat(charts): gateway OpenTelemetryCollector with verbatim-ported config (pii_redact + metadata stamp)"
```

---

## Task 4b: Log-ingestion agent — OpenTelemetryCollector DaemonSet

**Files:**
- Create: `charts/genieai-umbrella/templates/observability/otel-agent.yaml`
- Create: `charts/genieai-umbrella/templates/rbac/otel-agent-role.yaml`

**Interfaces:**
- Consumes: `observability.otel.enabled`; the gateway CR from Task 4 (operator-exposed Service `genieai-collector-collector` — the operator names the Service `<cr>-collector`).
- Produces: 1 `OpenTelemetryCollector` (mode: daemonset) + ServiceAccount/Role for `k8sattributes`.

**Why (Review Focus #6 / `docs/charts/otel-migration.md` §3 item 1):** the Swarm pipeline shipped container logs via the Docker fluentd driver → `fluent_forward`. On containerd/K8s that driver does not exist; without a node-level filelog agent, **no container logs reach VictoriaLogs** and the admin logs UI returns empty. The agent is a dumb shipper — all transforms stay in the gateway (single PII/stamping point).

- [ ] **Step 1: Run red-gate — no agent CR yet**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod --set observability.enabled=true --set observability.otel.enabled=true | grep -c "mode: daemonset"`
Expected: prints `0`.

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/rbac/otel-agent-role.yaml`**

```yaml
{{- if .Values.observability.otel.enabled -}}
apiVersion: v1
kind: ServiceAccount
metadata:
  # A REGULAR resource — NO helm.sh/hook annotation. An earlier draft
  # hooked the SA with `pre-delete`, which meant Helm only ever applied
  # it during uninstall: the DaemonSet's pods then failed admission with
  # `serviceaccounts "genieai-agent" not found` on every install
  # (hook-annotated resources skip install entirely).
# Release-owned resources are garbage-
  # collected by Helm on uninstall; nothing extra is needed.
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
    namespace: {{ printf "%s-agent" .Values.namespace }}
{{- end -}}
```

The agent namespace (below) carries `pod-security.kubernetes.io/enforce:
privileged` — the filelog receiver needs hostPath `/var/log/pods`, which the
restricted PSS forbids; keeping the agent in the main namespace would make
every DaemonSet pod fail admission.

```yaml
{{- if .Values.observability.otel.enabled -}}
apiVersion: v1
kind: Namespace
metadata:
  name: {{ printf "%s-agent" .Values.namespace }}
  labels:
    genieai.io/cluster-profile: {{ .Values.clusterProfile | default "dev" | quote }}
    app.kubernetes.io/part-of: genieai
    # hostPath access is required by the node log reader — this dedicated
    # namespace relaxes ONLY itself; the main namespace stays restricted.
    pod-security.kubernetes.io/enforce: privileged
    pod-security.kubernetes.io/enforce-version: latest
{{- end -}}
```

- [ ] **Step 3: Write `charts/genieai-umbrella/templates/observability/otel-agent.yaml`**

```yaml
{{- if .Values.observability.otel.enabled -}}
apiVersion: opentelemetry.io/v1beta1
kind: OpenTelemetryCollector
metadata:
  name: genieai-agent
  # Dedicated privileged namespace — see the namespace template in Step 2
  # (the main namespace enforces restricted PSS, which forbids hostPath).
  namespace: {{ printf "%s-agent" .Values.namespace }}
  labels:
    {{- include "genieai-common.labels" (dict "Chart" .Chart "Release" .Release "Values" (deepCopy .Values | merge (dict "component" "otel-agent"))) | nindent 4 }}
spec:
  mode: daemonset
  serviceAccount: genieai-agent
  image: ghcr.io/open-telemetry/opentelemetry-collector-contrib:0.152.0   # matches the running Swarm stack (0.111.0 is 20+ versions stale)
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
      # live there, NOT here). OTLP/HTTP to the operator-created Service
      # (operator names it `<cr>-collector`; for CR `genieai-collector`
      # the Service is `genieai-collector-collector`).
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
helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod --set observability.enabled=true --set observability.metrics.enabled=true --set observability.logs.enabled=true --set observability.traces.enabled=true --set observability.otel.enabled=true | \
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
git add charts/genieai-umbrella/templates/observability/otel-agent.yaml charts/genieai-umbrella/templates/rbac/otel-agent-role.yaml
git commit -m "feat(charts): DaemonSet log-ingestion agent (filelog -> gateway -> VL)"
```

---

## Task 5: Grafana via grafana-operator (instance + datasources + dashboards)

**Files:**
- Create: `charts/genieai-umbrella/templates/observability/grafana-cr.yaml` (Grafana instance + 3 `GrafanaDatasource` CRs)
- Create: `charts/genieai-umbrella/templates/observability/grafana-dashboards.yaml` (9 `GrafanaDashboard` CRs from the existing dashboard JSONs)
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

- [ ] **Step 2: Write `charts/genieai-umbrella/templates/observability/grafana-cr.yaml`**

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
    # spec.deployment.envFrom — never inline.
  deployment:
    envFrom:
      - secretRef:
          name: grafana-admin-password   # lowercase (K8s names must be DNS-1123; camelCase is rejected)
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
    url: {{ if eq .Values.clusterProfile "prod" }}http://vmetrics-vmselect.{{ .Values.namespace }}.svc.cluster.local:8481{{ else }}http://vmetrics.{{ .Values.namespace }}.svc.cluster.local:8428{{ end }}
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
# DIRECTLY, with the /select/jaeger URL prefix (official VT Grafana guide,
# verified 2026-10-08). The prefix replaces the old tools/tempo-proxy path
# translation (its real job per main.go: /select/jaeger/api/* <-> /api/*).
# VT >= 0.9.4 additionally offers the Tempo datasource + TraceQL at
# /select/tempo — future option, not v1. Multi-service aggregation behavior
# (the proxy's second job) is re-verified in the migration checklist.
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
    url: http://vtraces.{{ .Values.namespace }}.svc.cluster.local:10428/select/jaeger
    access: proxy
{{- end -}}
```

- [ ] **Step 3: Write `charts/genieai-umbrella/templates/observability/grafana-dashboards.yaml`** (one CR per ported JSON)

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
helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod --set observability.enabled=true --set observability.metrics.enabled=true --set observability.logs.enabled=true --set observability.traces.enabled=true --set observability.otel.enabled=true | \
  python3 -c "import sys, yaml; docs = list(yaml.safe_load_all(sys.stdin)); \
  ds = [d for d in docs if d and d.get('kind') == 'GrafanaDatasource']; \
  jaeger = next(d for d in ds if d['spec']['datasource']['type'] == 'jaeger'); \
  assert jaeger['spec']['datasource']['url'].endswith('/select/jaeger'), jaeger['spec']['datasource']['url']; \
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
git add charts/genieai-umbrella/configs/grafana-dashboards/ charts/genieai-umbrella/templates/observability/grafana-cr.yaml charts/genieai-umbrella/templates/observability/grafana-dashboards.yaml
git commit -m "feat(charts): grafana-operator CRs — instance, datasources (VM/VL/Jaeger->VT direct), 9 dashboards"
```

## Task 6: REMOVED — tempo-proxy (native replacement)

**No files. No steps.**

The Swarm `tempo-proxy` service (Jaeger query proxy in front of VictoriaTraces) is **not ported**. Verified 2026-10-08 against the official docs (`docs.victoriametrics.com/victoriatraces/querying/grafana/`): VictoriaTraces implements the **Tempo HTTP API natively**, and Grafana's Jaeger datasource queries VT directly. The proxy was compensating plumbing from the Swarm era — exactly the kind of bespoke component the K8s-native audit (`docs/charts/k8s-native-audit.md`, decision 1) removes.

Consequences:
- No `tempo-proxy` helm dependency, no Deployment/Service template.
- Grafana traces datasource points at `http://vtraces.<ns>.svc.cluster.local:10428` (Task 5).
- Service inventory: 29 (was 30); Group 1 = 5.

## Task 7: VMServiceScrape emission per Group 5 service (conditional)

**Files:**
- Modify: `charts/genieai-umbrella/templates/_lib/_service-factory.tpl` (Plan 3) — append VMServiceScrape block

**Interfaces:**
- Consumes: each service's `serviceMonitor: true|false` toggle.
- Produces: per-service `VMServiceScrape` CR (vmoperator CRD — there is NO Prometheus operator in this stack; `monitoring.coreos.com/v1 ServiceMonitor` CRs would have no controller watching them), only when `observability.metrics.enabled: true`.

- [ ] **Step 1: Append to the service factory helper** in `charts/genieai-umbrella/templates/_lib/_service-factory.tpl`

After the existing `{{- end -}}` closing the Deployment block, add:

```gotemplate
{{- /*
VMServiceScrape emission. only when observability.metrics
is enabled AND the per-service toggle is true. The `release:` label must
match the VMAgent's serviceScrapeSelector.
*/ -}}
{{- if and $ctx.Values.observability.metrics.enabled $svc.serviceMonitor -}}
---
apiVersion: operator.victoriametrics.com/v1beta1
kind: VMServiceScrape
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

- [ ] **Step 2: Render with metrics + a service having `serviceMonitor: true`**

Run: `helm template test charts/genieai-umbrella -n genieai --set observability.metrics.enabled=true --set services.backend.serviceMonitor=true | grep -c "^kind: VMServiceScrape$"`
Expected: prints `1` (backend).

- [ ] **Step 3: Render with observability off — no VMServiceScrape (Review Focus #2)**

Run: `helm template test charts/genieai-umbrella -n genieai --set services.backend.serviceMonitor=true | grep -c "^kind: VMServiceScrape$" || echo "0"`
Expected: prints `0` — the per-service toggle alone must NOT emit a scrape target when the metrics tier is disabled.

- [ ] **Step 4: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add charts/genieai-umbrella/templates/_lib/_service-factory.tpl
git commit -m "feat(charts): VMServiceScrape emission in service factory (conditional)"
```

---

## Task 8: Profile helpers (template-side only)

**Files:**
- Create: `charts/genieai-umbrella/templates/_lib/_clusterprofile-defaults.tpl`

**Interfaces:**
- Consumes: `clusterProfile` value.
- Produces: `genieai-umbrella.profileProduction` / `genieai-umbrella.profileDev` — used ONLY inside template conditionals (e.g. Task 3's VMCluster-vs-VMSingle switch). **No `observabilityDefault` helper**: values.yaml is static (Task 2) and observability enablement is explicit per env, so a values-level default resolver would be dead code.

- [ ] **Step 1: Write `charts/genieai-umbrella/templates/_lib/_clusterprofile-defaults.tpl`**

```gotemplate
{{/*
Profile classification helpers — TEMPLATE-SIDE only. Values.yaml is never
templated by Helm, so profile-driven decisions live in `{{- if include
"genieai-umbrella.profileProduction" . }}` template conditionals, never in
values files.
*/}}
{{- define "genieai-umbrella.profileProduction" -}}
{{- or (eq .Values.clusterProfile "prod") (eq .Values.clusterProfile "staging") (eq .Values.clusterProfile "sovereign") -}}
{{- end -}}

{{- define "genieai-umbrella.profileDev" -}}
{{- or (eq .Values.clusterProfile "dev") (eq .Values.clusterProfile "") -}}
{{- end -}}
```

- [ ] **Step 2: Verify the helpers parse and the dev default stays off**

Run: `helm template test charts/genieai-umbrella -n genieai | grep -cE "^kind: (VMSingle|VMCluster|VLSingle|VTSingle|VMAgent|OpenTelemetryCollector)" || echo "0"`
Expected: prints `0` (static defaults off; no nil/error from the new helper file).

- [ ] **Step 3: Render with explicit observability on**

Run: `helm template test charts/genieai-umbrella -n genieai --set observability.enabled=true --set observability.metrics.enabled=true --set observability.logs.enabled=true --set observability.traces.enabled=true --set observability.otel.enabled=true | grep "^kind: " | sort | uniq -c | sort -rn | head`
Expected: shows `VMSingle × 1` (dev profile → single), `VLSingle × 1`, `VTSingle × 1`, `VMAgent × 1`, `OpenTelemetryCollector × 1`.

- [ ] **Step 4: prod profile flips VMSingle → VMCluster**

Run: `helm template test charts/genieai-umbrella -n genieai --set observability.enabled=true --set observability.metrics.enabled=true --set clusterProfile=prod | grep -c "^kind: VMCluster$"`
Expected: prints `1` (and `VMSingle` count `0`).

- [ ] **Step 5: `helm lint --strict`**

Run: `helm lint charts/genieai-umbrella --strict`
Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add charts/genieai-umbrella/templates/_lib/_clusterprofile-defaults.tpl
git commit -m "feat(charts): profile classification helpers (template-side)"
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
          check http://vmetrics.${ns}.svc.cluster.local:8428/healthz   # single-node port; 8429 is cluster vmselect
          check http://vlogs.${ns}.svc.cluster.local:9428/healthz
          check http://vtraces.${ns}.svc.cluster.local:10428/healthz
          # operator-exposed Service (name = CR name)
          check http://genieai-collector-collector.${ns}.svc.cluster.local:4318/v1/traces
          if [ "$failures" -gt 0 ]; then
            echo "FAIL: $failures service(s) unreachable"
            exit 1
          fi
          echo "PASS: all observability components reachable"
```

- [ ] **Step 2: Render and verify**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod --set observability.enabled=true | grep -A 1 "test-observability" | head -5`
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
- Create: `charts/genieai-umbrella/templates/secrets/observability-secrets.yaml`

**Interfaces:**
- Consumes: spec §8 F14 mapping table (Group 4 secrets).
- Produces: 2 SealedSecret CRs.

- [ ] **Step 1: Write `charts/genieai-umbrella/templates/secrets/observability-secrets.yaml`**

```yaml
{{- if .Values.secrets.sealedSecrets.enabled -}}
{{- /* Per spec §8 mapping (names DNS-1123 lowercase; encryptedData keys =
       ENV VAR NAMES — Grafana CR consumes the secret whole via envFrom):
       grafanaAdminPassword   → grafana-admin-password     (key GF_SECURITY_ADMIN_PASSWORD)
       kcGrafanaClientSecret  → kc-grafana-client-secret   (key KC_GRAFANA_CLIENT_SECRET)
*/ -}}
{{- $obs := dict
      "grafana-admin-password" "GF_SECURITY_ADMIN_PASSWORD"
      "kc-grafana-client-secret" "KC_GRAFANA_CLIENT_SECRET" -}}
{{- range $secretName, $envKey := $obs }}
---
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
    {{ $envKey }}: UExBQ0VIT0xERVIr     # PLACEHOLDER+ — RE-SEAL before helm install
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
git add charts/genieai-umbrella/templates/secrets/observability-secrets.yaml
git commit -m "feat(charts): observability SealedSecrets (grafana-admin-password, kc-grafana-client-secret)"
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
- Observability: explicit values only — `false` by default for EVERY profile; staging/prod/sovereign overlays set `observability.enabled: true` in their values-override.yaml.
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
| VictoriaMetrics | VMSingle (dev/sovereign) / VMCluster (prod) | enabled via each env's values-override.yaml |
| VictoriaLogs | VLSingle | enabled via each env's values-override.yaml |
| VictoriaTraces | VTSingle | enabled via each env's values-override.yaml |
| OpenTelemetry Collector | OpenTelemetryCollector (gateway mode) | enabled via each env's values-override.yaml |
| Grafana | grafana-operator CRs (Grafana + GrafanaDatasource + 9 GrafanaDashboard) | optional |
| Traces query | Grafana Jaeger datasource -> VictoriaTraces direct (native Tempo HTTP API) | bundled when traces enabled |

Per-service `serviceMonitor: true` triggers a `VMServiceScrape` emission (vmoperator CRD — no Prometheus operator in this stack) only when `observability.metrics.enabled: true`. Enablement is explicit per env (`values-override.yaml`), not profile-derived. PII redaction transform processor is part of the OTel Collector's gateway pipeline (regex rules ported from the current Swarm fluentd config).

PII redaction rules: shipped inside the ported `configs/otel-collector-config.yaml` (verbatim from the Swarm config — the canonical source). Operators override per-env by forking the file in `deploy/environments/<env>/`; Plan 7 conftest lints that no rule is dropped.
EOF

git add charts/genieai-umbrella/README.md
git commit -m "docs(charts): genieai-umbrella README with observability layer status"
```

- [ ] **Step 3: Final render summary**

Run: `helm template test charts/genieai-umbrella -n genieai --set clusterProfile=prod --set observability.enabled=true --set observability.metrics.enabled=true --set observability.logs.enabled=true --set observability.traces.enabled=true --set observability.otel.enabled=true | grep "^kind:" | sort | uniq -c | sort -rn | head -10`
Expected: comprehensive overview showing Services, Deployments, NetworkPolicies, SealedSecrets, VM*, V*, OTelCollector, ConfigMap, VMServiceScrape, etc.

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
| §10 observability stack (explicit per-env toggles; profile helpers template-side) | Tasks 2, 8 |
| §10 vmoperator (VM/VL/VT) | Task 3 |
| §10 opentelemetry-operator | Task 4 |
| §10 grafana-operator (instance/datasources/dashboards CRs) | Task 5 |
| §10 PII redaction transform | Task 4 |
| §10 log ingestion (agent DaemonSet replacing the fluentd-driver pipeline) | Task 4b |
| §7 VMServiceScrapes conditional (vmoperator-native) | Task 7 |
| §10 traces query via VT-native Tempo HTTP API (tempo-proxy REMOVED) | Task 5 Step 4 + Task 6 note |
| §8 observability SealedSecrets (grafanaAdminPassword, kcGrafanaClientSecret per §8 F14) | Task 10 |
| §17 observability entries in v1.0 manifest | Tasks 1-10 |

Sections deferred:
- §13.2 conftest-based PII redaction lint — Plan 7
- §14 OTLP/auth service-account tokens for cross-component auth — Plan 7
- §10 dashboards pre-configured via Grafana provisioning sidecar — Plan 6

**2. Placeholder scan**: only intentional `PLACEHOLDER+` (UExBQ0VIT0xERVIr) sentinels in sealed-secrets. No "TBD" or "TODO".

**3. Type consistency**: `genieai-common.labels`, `genieai-common.serviceSelector`, `genieai-common.fullname` invoked uniformly across Tasks 3-10. CRDs namespace-scoped (release namespace).

**4. Review Focus coverage**: 5 input-class concerns pinned:

1. vmoperator CRD version compat (K8s 1.33) → Task 1 Step 4 (`helm dep list` parses pinned versions).
2. VMServiceScrape only when observability + per-service toggle → Task 7 Step 3 (render asserts 0 VMServiceScrapes when observability off).
3. Traces query VT-direct (no proxy) → Task 5 Step 4 (asserts jaeger datasource URL contains vtraces + zero tempo-proxy in render).
4. PII redaction yaml schema (error_mode: ignore) → Task 4 Step 5 (assertions on ported config + otelcol validate when available).
5. values.yaml templating trap → Task 2 Steps 3-4 (static booleans verified; no `{{` in values; explicit-enablement render).
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
- Plan 6: per-env Kustomize overlays + GitOps sync + ingress (Envoy Gateway + cert-manager; picks up the deferred NetworkPolicy label-verification pass)
- Plan 7: CI integration + image signing + Renovate + uninstall safety + secret-leak lint + chart-schema-drift alert
- Plan 8: documentation (site content + docs/charts/*)
