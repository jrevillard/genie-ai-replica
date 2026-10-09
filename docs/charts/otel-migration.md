# OTel Migration — Docker Swarm → Kubernetes

**Date:** 2026-10-08 · **Scope:** observability pipeline port for the Helm chart migration
**Related:** spec §10 (`docs/superpowers/specs/2026-10-08-genie-ai-helm-charts-design.md`), Plan 4 (`docs/superpowers/plans/2026-10-08-genie-ai-helm-charts-observability.md`)

---

## 1. Current Swarm pipeline (baseline)

```
App SDKs (Node tracing.js / Python tracing.py, W3C traceparent)
  ├─ OTLP/HTTP ──────────────► OTel Collector (gateway, mode: global)
  │                              ├─ pii_redact (OTTL transform)
  │                              ├─ stamp_log_metadata_from_msg
  │                              ├─► VictoriaTraces (traces)
  │                              ├─► VictoriaMetrics (metrics)
  │                              └─► VictoriaLogs (logs)
  └─ stdout/stderr ─► fluentd logging driver ─► collector fluent_forward :24224 ──► VL
Kong OTel plugin ─► request traces (frontend→backend spans)
```

Source of truth for the collector: `configs/otel/otel-collector-config.yaml`. Test harness: `tests/otel-collector/run-pii-smoke.sh`.

## 2. What survives untouched (app-level — months of work, zero rewrites)

| Asset | Why it ports as-is |
|---|---|
| `tracing.js` + `tracing-db.js` + `tracing-pii.js` (backend) | SDK init is in-process; container-agnostic |
| `metrics.js` Prometheus exporters | Same exposition, scraped via ServiceMonitor |
| `genie-ai-overlay/tracing.py` (`with_span`, `background_span`) | Same |
| Span taxonomy (`dataprep.ingest`, `dataprep.chunking`, `dataprep.llm.label_batch`, …) | Emitted by app code; Grafana queries unchanged |
| W3C `traceparent` propagation across the RAG chain | HTTP header; K8s Services transparent |
| `withBackgroundSpan` / `runInBackgroundSpan` (`shared/lib/tracing-background.js`) | Same |
| Service identity (`service.namespace`, `service.name`, `service.version`) | Hard-coded env, unchanged |
| Sampling (`OTEL_TRACES_SAMPLER_RATE`) | Env var, unchanged |
| Admin logs UI (backend `LogsService` → VL, `VlUnavailableError` classifier) | VL API identical; only DNS changes |
| Winston JSON log shape + `.message` parsing | VL storage identical |

**Only app-side change:** endpoint env var.

```bash
# before (Swarm):
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
# after (K8s):
OTEL_EXPORTER_OTLP_ENDPOINT=http://genieai-collector-collector.genieai.svc.cluster.local:4318
```

## 3. What migrates (infra plumbing)

| # | Item | Problem | Effort | Plan |
|---|---|---|---|---|
| 1 | **Log ingestion** | fluentd logging driver does not exist on containerd/K8s. Need node-level filelog collection. | **M** | Plan 4 Task 4b (agent DaemonSet) |
| 2 | **Collector config** | Port `configs/otel/otel-collector-config.yaml` verbatim (never rewrite); drop `fluent_forward` receiver, keep `pii_redact` + `stamp_log_metadata_from_msg`; retarget exporters to K8s DNS. | **S** | Plan 4 Task 4 |
| 3 | **Gateway request tracing** | Kong OTel plugin disappears (Kong REMOVED — decision 7). Envoy Gateway tracing via policy (Envoy-native OTel exporter) + `traceparent` propagation. | **S** | Plan 6 |
| 4 | **Grafana dashboards** | 9 dashboards from `configs/grafana/provisioning/` → `GrafanaDashboard` CRs via grafana-operator (v5) — NOT the ConfigMap+sidecar pattern; datasource names unchanged so queries work. | **S** | Plan 4 |
| 5 | **Alert rules** | Grafana-provisioned rules → `VMRule` CRs (+ `VMAlertmanager`) via vmoperator. | **S** | Plan 4 |
| 6 | **PII smoke test** | `run-pii-smoke.sh` targets docker compose → helm test / kind CI equivalent. Same assertions (marker-based row read-back). | **S** | Plan 7 |
| 7 | **k8s enrichment** (bonus) | `k8sattributes` processor adds pod/namespace to spans/logs — free with the operator. | XS | Plan 4 Task 4b |

Total: ~4–6 person-days. Instrumentation heritage intact.

## 4. Target collector topology (K8s)

```
App SDKs ── OTLP/HTTP ──► gateway collector (Deployment, OTel Operator CR)
                            │  config = ported configs/otel/otel-collector-config.yaml
                            │  (pii_redact + stamp_log_metadata_from_msg kept verbatim)
                            ├─► VictoriaTraces (VTSingle)
                            ├─► VictoriaMetrics (VMSingle/Cluster)
                            └─► VictoriaLogs (VLSingle)

containerd stdout ──► agent collector (DaemonSet, filelog receiver)
                        │  /var/log/pods/*/*/*.log  (hostPath, read-only)
                        │  k8sattributes enrichment
                        └─► OTLP ──► gateway (single transform point) ──► VL
```

**Design rule:** transforms live in ONE place (the gateway). The agent is a dumb shipper — no PII logic duplicated.

## 5. Porting the collector config — rules

1. **Copy, don't rewrite.** `cp configs/otel/otel-collector-config.yaml charts/genieai-umbrella/configs/otel-collector-config.yaml`, then edit.
2. **Remove:** the `fluent_forward` receiver block and its entry in the logs pipeline `receivers:` list (replaced by agent → OTLP).
3. **Keep verbatim:** `pii_redact` OTTL statements, `stamp_log_metadata_from_msg`, healthcheck, memory_limiter, batch.
4. **Mind the double-unescape trap:** the regexes are double-escaped (`\\s`, `\\.`) because YAML single-quoted scalars are literal AND OTTL string literals unescape once more. Single-escaping "looks correct" and kills the whole log pipeline (collector exits 1 on OTTL parse error). The port must not touch these strings.
5. **Retarget exporters:** OTLP/HTTP endpoints to `vtraces.genieai.svc.cluster.local:10428`, `vmetrics...:8428`, `vlogs...:9428` (rendered via Helm values, not hard-coded).
6. **OTel version floor:** collector contrib `0.111+` (transform `error_mode` stable).

## 6. Kong → Envoy Gateway tracing

Kong's OTel plugin produced per-request spans for the frontend→backend hop. Replacement on Envoy Gateway (spec §9 default):

- `traceparent` propagation: Envoy native — no action.
- Span emission: Envoy tracing config (OTel exporter) exposed via Envoy Gateway policy (`BackendTrafficPolicy` / tracing extension). Sampling via the same `OTEL_TRACES_SAMPLER_RATE` semantics at the gateway level.
- Landing spot: Plan 6 (ingress plan) — not Plan 4.

## 7. Verification checklist (per env, post-migration)

```bash
# 1. Traces flow end-to-end (RAG chain linked by traceparent)
#    Grafana Trace explorer (Jaeger datasource → vtraces direct) → one trace spans
#    frontend-req → backend → chatqna → retriever → reranker
# 2. Logs land in VL with metadata stamped + PII redacted
kubectl logs -n genieai deploy/genieai-collector-collector | head
# VL query by service.name; assert no raw emails/IPs in bodies
# 3. Admin logs UI (/api/admin/logs) returns rows
# 4. Dashboards: 9 provisioned, datasources VM/VL/Jaeger resolve
# 5. PII smoke (K8s port, Plan 7): marker row read back redacted
# 6. Metrics: VMSingle target list includes backend/documentRepository
```

## 8. Decision pending (not this doc's scope)

**Confirmed 2026-10-08 by user**: Kong REMOVED (not demoted), K8s min 1.33, Envoy Gateway v1.9 locked. Applied to spec + Plans 2/3 (decision 7 in `docs/charts/k8s-native-audit.md`).
