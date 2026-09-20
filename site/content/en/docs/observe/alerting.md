---
title: Alerting
description: Built-in Grafana alert rules, notification policies, and contact points that guard the GENIE.AI stack.
weight: 4
aliases:
  - /docs/observability/alerting/
mode: reference
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

Alerting is auto-provisioned alongside the dashboards, so a fresh deployment
already watches the failures that matter most: **the stack going silent, storage
filling up, the log pipeline breaking, and trace export failing**.

## How Grafana alerting is organised

Three layers, one job each:

- **Alert rules** (`alert-rules.yml`) — *what* triggers an alert: a query, a
  threshold, and a `for:` window (the alert must hold true for that long
  before firing — short blips don't wake anyone up).
- **Notification policies** (`notification-policies.yml`) — *how* alerts are
  grouped, escalated, and routed between contact points. The shipped default
  groups by `alertname` + `component` and routes everything to a single
  contact point.
- **Contact points** (`contact-points.yml`) — *where* notifications are sent
  (a webhook URL, Slack, SMTP, PagerDuty). The shipped default is a single
  webhook pointing at `http://localhost:9999/alerts` — replace per environment.

## Built-in alert rules

The rules target the failure modes that would otherwise make the observability
stack *itself* lie to you. All rules query the VictoriaMetrics datasource and
live in the `Observability` folder.

| Alert (UID) | What it watches | Metric / threshold | `for` window |
|---|---|---|---|
| **OTel Collector Down** (`otel_collector_down`) | VictoriaMetrics received zero rows from the collector's `prometheusremotewrite` export in the last 2 minutes. | `rate(vm_rows_inserted_total{type="promremotewrite"}[2m]) < 0.5` | 2m |
| **VictoriaMetrics Storage Usage High** (`vm_storage_high`) | VM free disk has dropped below 1 GiB — retention eviction or write failures are imminent. | `vm_free_disk_space_bytes < 1073741824` | 5m |
| **VictoriaLogs Ingestion Drop** (`vlogs_ingestion_drop`) | The fluent_forward receiver on the collector has stopped accepting log records — container logs are no longer reaching VictoriaLogs. | `rate(otelcol_receiver_accepted_log_records_total{receiver="fluent_forward"}[5m]) < 1` | 5m |
| **VictoriaTraces Export Failures** (`vtraces_export_failures`) | VictoriaTraces reports HTTP errors on the trace insert endpoint — traces may be lost. | `rate(vt_http_errors_total{path="/insert/opentelemetry/v1/traces"}[5m]) > 0` | 5m |
| **VictoriaTraces Ingestion Rate Drop** (`vtraces_ingestion_drop`) | No spans reaching the collector's OTLP receiver — trace sources may be down. | `rate(vt_bytes_ingested_total{type="opentelemetry_traces_otlphttp_protobuf"}[5m]) < 0.5` | 5m |

> **Coverage note.** Only VictoriaMetrics has a free-disk alert today; VL and
> VT do not yet have a storage-filling-up rule. Add one in
> `alert-rules.yml` if your disk is tight.

### What an alert rule looks like

The rules follow this shape (simplified from `otel_collector_down`):

```yaml
- uid: otel_collector_down
  title: OTel Collector Down
  folder: Observability
  condition: C
  data:
    - refId: A
      datasourceUid: victoriametrics
      model:
        expr: rate(vm_rows_inserted_total{type="promremotewrite"}[2m])
        refId: A
    - refId: B
      datasourceUid: __expr__
      model:
        expression: A
        reducer: avg
        refId: B
    - refId: C
      datasourceUid: __expr__
      model:
        expression: B
        conditions:
          - evaluator: { params: [0.5], type: lt }
        refId: C
  noDataState: Alerting
  execErrState: Alerting
  for: 2m
  annotations:
    description: "OTel Collector is not ingesting data. VictoriaMetrics received zero rows for over 2 minutes. Check Collector health and pipeline connectivity."
    summary: "OTel Collector pipeline is broken"
  labels:
    severity: critical
    component: otel-collector
```

UIDs are stable — do not rename a `uid:` after creation, or Grafana creates
a duplicate rule.

## SLO-based alerting

Beyond stack-health, deployments add SLO rules on the application metrics
exported by the backend. The backend exports these instruments
(`components/gov-chat-backend/middleware/metrics-middleware.js`):

- `http_requests_total{service_name, http_method, http_status_code, http_route}` —
  Counter, tagged with status code. **Error rate** =
  `sum(rate(http_requests_total{http_status_code=~"5.."}[5m]))` /
  `sum(rate(http_requests_total[5m]))`.
- `http_request_duration_seconds` — Histogram, **p95 latency** =
  `histogram_quantile(0.95, sum(rate(http_request_duration_seconds_bucket[5m])) by (le, http_route))`.
- `log_record_dropped_total{reason}` — Counter from `tracing.js`. A non-zero
  rate means logs are being lost before export (reasons: `queue_full`,
  `otlp_unreachable`, `observability_disabled`).

### Worked examples

```promql
# Error rate above 1% for 5 minutes
sum(rate(http_requests_total{http_status_code=~"5.."}[5m]))
/
sum(rate(http_requests_total[5m]))
> 0.01
```

```promql
# p95 chat endpoint latency above 5 seconds for 10 minutes
histogram_quantile(0.95,
  sum by (le) (rate(http_request_duration_seconds_bucket{http_route="/api/chat"}[10m]))
) > 5
```

> **Tune before you page.** Start with generous thresholds; tighten after a
> week of data. Alerting that pages on every blip gets ignored — and that is
> worse than no alerting at all.

## Notification routing

`notification-policies.yml` groups alerts (by `alertname` + `component`) and
routes them to the contact points defined in `contact-points.yml`. Configure
the actual endpoints (Slack webhook, SMTP, PagerDuty) per environment.

> **Secret handling.** Grafana provisioning does **not** substitute env vars
> inside YAML. Real endpoints go in via the Grafana UI (**Alerting → Contact
> points → New contact point**) or via the `GRAFANA_ALERT_WEBHOOK_URL` /
> `GRAFANA_ALERT_EMAIL` env vars. Never commit a real webhook URL into the
> provisioned YAML — it will be visible in the repo.

After updating a contact point in the UI, restart the `grafana` service if
you want it picked up by the provisioning re-read (the contact-point YAML
file is the source of truth on startup only).

## First thing to check on a fresh deploy

1. **Verify the alert chain is live.** In Grafana → **Alerting → Contact
   points**, open the `default-webhook` contact point → click **Test**. A POST
   lands at `http://localhost:9999/alerts` (the shipped default — replace with
   your real endpoint before relying on it).
2. **Verify the collector is healthy.** Open the **Observability stack health**
   dashboard and confirm `otelcol_*` metrics are non-zero (the `for: 2m`
   window means the collector-down rule will fire ~2 minutes after the
   collector stops ingesting).
3. **Verify the contact point is reachable.** If the test webhook returns
   network errors, the contact point secret is wrong or the receiving service
   is down — fix that *before* relying on the alerting stack to wake someone
   up. An alerting stack that cannot alert is worse than none.