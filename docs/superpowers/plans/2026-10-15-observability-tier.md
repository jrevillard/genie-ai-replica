# Observability Tier Implementation Plan (refreshed)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the observability tier on Kubernetes: VictoriaLogs + VictoriaMetrics + VictoriaTraces (vmoperator CRs), OTel Collector (gateway + filelog DaemonSet agent), Grafana (operator CRs, datasources, dashboards), PII redaction ported verbatim, per-service VMServiceScrapes — repairing the admin logs UI (currently 503) and the RAG trace pipeline.

**Architecture:** Operators (vmoperator, opentelemetry-operator, grafana-operator) are **cluster-bootstrap prerequisites** — the chart does NOT install them (same posture as kube-arangodb / CloudNativePG / cert-manager; spec §4 amendment 2026-10-09). The chart renders only namespaced CRs + collector config + scrape objects, gated by `observability.enabled` (default false). Enablement is per-environment in the deploy repo overlay (Flux `valuesFrom` ConfigMap), not `values-<env>.yaml` files.

**Supersedes:** `2026-10-08-genie-ai-helm-charts-observability.md` (never executed; written against a chart that has since gained the OPEA tier, the service factory, and the deploy-repo overlay model). Divergence scan input: `/tmp/plan4-refresh-report.md` (2026-10-15). The old plan's Task 4 (PII redaction OTTL port verbatim from `configs/otel/otel-collector-config.yaml`) and Task 4b (filelog DaemonSet) remain the reference detail — port, never rewrite.

**Tech Stack:** Helm 3 (existing chart), vmoperator CRDs (VMSingle/VLSingle/VTSingle/VMServiceScrape), opentelemetry-operator (OpenTelemetryCollector CR), grafana-operator (Grafana/GrafanaDatasource/GrafanaDashboard CRs).

## Key decisions (locked, from the divergence scan)

0. **VictoriaLogs is NOT optional.** Per-component flags, no master
   switch: `observability.logs.enabled` defaults TRUE (VictoriaLogs +
   collector + filelog agent — the admin logs UI depends on VL, matching
   the always-on posture); `metrics`, `traces`, `grafana` default false.
   A default install therefore ships the log pipeline; metrics/traces/
   dashboards are opt-in. vmoperator CRDs are required by the baseline.
1. **No operator Helm dependencies.** Chart renders CRs; a `charts/README.md` prerequisites section + cluster bootstrap docs list the three operators. (Old plan Task 1 is deleted, replaced by docs.)
2. **Values layering = deploy repo.** Every "per-env values-override.yaml" reference becomes "the overlay ConfigMap in genie-ai-deploy".
3. **Coverage includes the OPEA tier** (absent in the old plan): OTel env on `embedding` and `translation` orchestrators (chatqna/retriever/dataprep/reranker already wired), ENABLE_OBSERVABILITY auto-derived from `observability.enabled` rather than a per-service default "0".
4. **Scrape emission via the service factory** — `templates/_lib/_service-factory.tpl` exists and is the injection point the OPEA templates already use (the divergence-scan claim that it doesn't exist is wrong, verified 2026-10-15). A `serviceMonitor: true`-style values flag per service appends a VMServiceScrape block rendered by a shared helper.
5. **Collector image:** `otel/opentelemetry-collector-contrib:0.152.0` (compose parity — the ghcr.io path in the old plan is stale).
6. **Dashboards:** disk has 5 JSON dashboards (`configs/grafana/provisioning/dashboards/`), not the 9 the old plan claims; the 3 Grafana alert-rule files under `provisioning/alerting/` also become CRs. Reconcile the actual file list at execution, task 6.
7. **Admin-logs smoke is a hard gate:** post-install assertion that `/api/admin/logs` returns 200 (not the typed 503) — the user-visible regression this tier repairs.

## K8s-native transforms (compose mechanism → native mechanism)

The compose observability stack is the BEHAVIORAL reference; the
MECHANISMS are native replacements, never ports:

| Compose/Swarm mechanism | Native replacement |
|---|---|
| Docker fluentd logging driver → collector `fluent_forward` :24224 | collector DaemonSet `filelog` receiver on `/var/log/pods` (containerd's only log surface) |
| `stamp_log_metadata_from_msg` (fluentd-injected metadata re-parse) | `k8sattributes` processor (pod/namespace/labels from the node API) |
| Grafana provisioning ConfigMaps mounted into the pod | `Grafana`/`GrafanaDatasource`/`GrafanaDashboard` CRs (grafana-operator reconciles) |
| Static scrape configs | `VMServiceScrape` CRs (native service discovery) |
| Hand-run VM/VL/VT containers | `VMSingle`/`VLSingle`/`VTSingle` CRs (vmoperator reconciles storage+retention) |
| tempo-proxy container | none — VictoriaTraces serves the Tempo HTTP API natively |

The ONE verbatim port is the PII redaction OTTL (`pii_redact`) — it is
collector-configuration logic, not a compose mechanism.

## Global Constraints

- CRs namespaced to `{{ .Values.namespace }}`; no cluster-scoped objects.
- PII redaction OTTL (`pii_redact` + `stamp_log_metadata_from_msg`) ported VERBATIM from `configs/otel/otel-collector-config.yaml` into the collector ConfigMap the chart renders. The two-unescape trap (`\\s`, `\\.` in YAML single-quoted OTTL regexes) applies — the `tests/otel-collector/run-pii-smoke.sh` docker harness validates the ported copy before it ships (adapt path if the script assumes compose file locations; do not weaken its assertions).
- Operator chart/CRD versions re-verified at execution time (`helm search repo`), not trusted from either plan text.
- `helm lint --strict` + render gate after every task: `observability.enabled=false` (default) renders ZERO new resources — byte-identical to pre-task render.
- Comments factual English, no history narrative, no story refs.
- Worktree: `.claude/worktrees/k8s-migration/`, branch `feat/k8s-migration` (or its successor if the branch merged first).

## Tasks

### Task 1 — values surface + render gate skeleton
`observability:` block extension in values.yaml: `enabled: false`, `metrics/logs/traces/grafana` component flags, storage/retention knobs (compose §12C parity: 30d defaults), collector image ref, grafana admin/SSO secret NAMES (references — secrets ship in the deploy repo). Render gate: defaults → zero observability resources.
Consumes: existing `observability.collectorCRName/collectorPort` knobs (already in values + `_lib/_observability.tpl` — keep, they meet their CRs here).

### Task 2 — VLSingle + VMSingle + VTSingle CRs
vmoperator CRs gated on `observability.logs.enabled` / `metrics.enabled` / `traces.enabled`. Retention + storage from values. VictoriaLogs is the admin-logs dependency → its flag is the master `observability.enabled` default path (logs on when tier on).

### Task 3 — OTel Collector gateway (OpenTelemetryCollector CR)
Deployment-mode collector: OTLP receiver 4318, exporters to VMSingle (metrics), VTSingle (traces), VLSingle (logs via the agent below). PII redaction processors ported verbatim (old plan Task 4 detail). Service name matches `_lib/_observability.tpl`'s `<collectorCRName>-collector` derivation.

### Task 4 — filelog agent (DaemonSet-mode OpenTelemetryCollector CR)
Node agent: filelog receiver on container logs (containerd paths), `genieai.io/component` label extraction for k8s metadata, gateway as pipeline target. Replaces the Swarm fluentd-driver path (does not exist on containerd). Structural assertions from old plan Task 4b Step 5.

### Task 5 — Grafana instance + datasources (grafana-operator CRs)
Grafana CR, datasources: VM (metrics), VL (logs), VT (Jaeger/Tempo-API — VT direct, no proxy). Admin secret + Keycloak OIDC SSO client from deploy-repo SealedSecrets (names referenced, values never rendered).

### Task 6 — Dashboards + alert rules as CRs
GrafanaDashboard CR per JSON in `configs/grafana/provisioning/dashboards/` (actual file list at execution — 5 today), GrafanaAlertRule per `provisioning/alerting/` YAML (3 files). foldersFromFilesStructure equivalent via CR labels.

### Task 7 — VMServiceScrapes (factory-driven)
Shared helper renders a VMServiceScrape per service with `scrape: true` (values flag per service). Coverage: backend, documentRepository, frontend/nginx, redis, the six OPEA orchestrators; models optional (default off — GPU pods' self-metrics rarely scraped).

### Task 8 — OPEA coverage completion
OTel env (OTEL_EXPORTER_OTLP_ENDPOINT via existing helper + ENABLE_OBSERVABILITY derived from `observability.enabled`) on embedding + translation; NetworkPolicies for collector→VM/VL/VT egress + agent DaemonSet → collector ingress.

### Task 9 — helm test + admin-logs smoke
`helm test` additions: VL health, VM health, Grafana reachable. Post-install manual gate on the laptop overlay: `/api/admin/logs` 200 with rows; one RAG chat trace queryable in VT (jaeger API) end-to-end.

## Verification

- Render gates per task (default-off = byte-identical).
- Laptop live: reconcile overlay with `observability.enabled: true` → pods Ready, admin logs UI 200, trace waterfall dashboard shows a fresh chatqna trace, PII smoke green on the ported collector config.
- `observability.enabled: true` with component flags off individually → only that component's CRs absent.
