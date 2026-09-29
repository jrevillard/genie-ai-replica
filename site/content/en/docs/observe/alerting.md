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
| **OTel Collector — stamp_service_name_from_container processor failing** (`otel-stamp-service-name-fail`) | The collector is no longer stamping the `service.name` field on container logs, or has not processed any in 15 minutes. Every log line will then have empty `service.name` in VictoriaLogs — admin/logs filtering and the cross-service dedup key stop working. | `rate(otelcol_processor_dropped_log_records_total{processor="transform/stamp_service_name_from_container"}[5m]) > 0` OR `increase(otelcol_processor_accepted_log_records_total{processor="transform/stamp_service_name_from_container"}[15m]) == 0` | 10m |
| **OTel Collector — pii_redact transform failing** (`otel-pii-redact-fail`) | The PII redaction stage in the collector is dropping records or has not processed any in 15 minutes. Sensitive fields may leak into VictoriaLogs unredacted. | `rate(otelcol_processor_dropped_log_records_total{processor="transform/pii_redact"}[5m]) > 0` OR `increase(otelcol_processor_accepted_log_records_total{processor="transform/pii_redact"}[15m]) == 0` | 10m |

> **Coverage note.** Only VictoriaMetrics has a free-disk alert today; VL and
> VT do not yet have a storage-filling-up rule. Add one in
> `alert-rules.yml` if your disk is tight.

## Triage playbook

When an alert fires, follow the matching recipe below before paging out. Every
recipe ends with a cross-link to the full debugging doc for that subsystem.

### When `otel_collector_down` fires
1. Check the collector's own debug endpoint:
   `curl -s http://<stack>_otel-collector:8888/metrics | grep otelcol_exporter_sent`
2. Inspect container logs (Swarm: `docker service logs genieai_otel-collector --since 5m` | Compose: `docker compose logs otel-collector --since 5m`)
3. Verify the OTel Collector → VictoriaMetrics pipeline (`otel exporter` block
   in `configs/otel/otel-collector-config.yaml`)
4. Escalate: see [Observability stack health](./dashboards/#observability-folder--stack-health-dashboards)

### When `vm_storage_high` fires
1. Open the **VictoriaMetrics single-node** dashboard → `Disk usage` panel.
2. Confirm retention is the configured value
   (`VICTORIAMETRICS_RETENTION`, default `30d`).
3. If a recent ingest spike filled the disk, lower retention temporarily to
   reclaim space: edit `.env` and set `VICTORIAMETRICS_RETENTION=14d` (or
   whatever fits your retention policy), then restart the `victoriametrics`
   service: `docker compose up -d victoriametrics` (Swarm:
   `docker service update genieai_victoriametrics --env-add VICTORIAMETRICS_RETENTION=14d`).
4. Escalate: provision more disk before retention eviction starts dropping data.

### When `vlogs_ingestion_drop` fires
1. Check the collector's fluent_forward receiver:
   `curl -s http://<stack>_otel-collector:8888/metrics | grep otelcol_receiver_accepted_log_records_total`
2. Verify Docker fluentd logging driver is configured on every service:
   `docker inspect <container> | jq '.[0].HostConfig.LogConfig.Config["fluentd-address"]'`
3. Restart the collector (Swarm: `docker service update --force genieai_otel-collector` |
   Compose: `docker compose restart otel-collector`) to re-establish the
   fluent_forward TCP connection.
4. Escalate: see [Admin Logs → Failure modes and debugging](../operate/admin-logs/#failure-modes-and-debugging)

### When `vtraces_export_failures` fires
1. Query VictoriaTraces HTTP error metric:
   `curl -s http://<stack>_victoriatraces:10428/metrics | grep vt_http_errors_total`
2. Confirm the collector → VictoriaTraces OTLP HTTP endpoint
   (`/insert/opentelemetry/v1/traces`) is reachable from inside the collector
   container: `docker exec $(docker ps -q -f name=otel-collector) curl -sf http://victoriatraces:10428/health`
3. Check VictoriaTraces disk pressure (the **VictoriaTraces single-node**
   dashboard `Disk usage` panel).
4. Escalate: see [Tracing → Reading a trace](./tracing/#reading-a-trace)

### When `vtraces_ingestion_drop` fires
1. Check the collector's OTLP receiver:
   `curl -s http://<stack>_otel-collector:8888/metrics | grep otelcol_receiver_accepted_spans`
2. Confirm application services emit spans: open the **Application metrics**
   dashboard → `traces exported` rate per service.
3. Verify `OTEL_EXPORTER_OTLP_ENDPOINT` resolves to the collector from every
   instrumented container.
4. Escalate: see [Tracing → Reading a trace](./tracing/#reading-a-trace)

### When `otel-stamp-service-name-fail` fires
1. Check the OTel Collector's own debug endpoint:
   `curl -s http://<stack>_otel-collector:8888/metrics | grep stamp_service_name_from_container`
2. Verify the Compose fluentd labels are forwarded:
   `docker inspect <container> | jq '.[0].HostConfig.LogConfig.Config["fluentd-address"]'`
3. Confirm `transform/stamp_service_name_from_container` is enabled in
   `configs/otel/otel-collector-config.yaml:605`
4. Escalate: see [Admin Logs → Failure modes and debugging](../operate/admin-logs/#failure-modes-and-debugging)
   and [Tracing → Reading a trace](./tracing/#reading-a-trace)

### When `otel-pii-redact-fail` fires
1. Check the collector debug endpoint:
   `curl -s http://<stack>_otel-collector:8888/metrics | grep pii_redact`
2. Verify the PII key list: `cat configs/otel/pii-key-list.md`
3. Run the smoke test: `./tests/otel-collector/run-pii-smoke.sh`
4. Escalate: see the PII redactor section in `.claude/rules/OBSERVABILITY.md`

### What an alert rule looks like

The rules follow this shape (simplified from `otel_collector_down`):

> **`noDataState` varies by rule.** The two custom service-name / PII alerts
> (`otel-stamp-service-name-fail`, `otel-pii-redact-fail`) use `noDataState: OK`
> — no data is fine because the metric is informational (it reports whether a
> transform *processed* records, not whether any *should* exist). The other five
> rules use `noDataState: Alerting` — no data means the upstream collector or
> storage backend is silent, which is suspicious and warrants a page. Choose per
> rule based on intent, not by copying the first example.

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

## Verify it worked

A freshly provisioned stack should pass all of these checks:

```bash
# 1. All 7 built-in rules are loaded (UI count + provisioning file)
docker exec $(docker ps -q -f name=grafana) \
  curl -sf http://admin:${GRAFANA_ADMIN_PASSWORD}@localhost:3000/api/v1/provisioning/alert/rules \
  | jq '[.[] | select(.folder=="Observability")] | length'
# Expected: 7

# 2. The collector-down alert is in `ok` state (collector is ingesting)
docker exec $(docker ps -q -f name=grafana) \
  curl -sf http://admin:${GRAFANA_ADMIN_PASSWORD}@localhost:3000/api/v1/eval \
  -d 'expression=rate(vm_rows_inserted_total{type="promremotewrite"}[2m])'

# 3. The contact point test webhook returned 2xx
#    (Grafana UI → Alerting → Contact points → default-webhook → Test)

# 4. The service-name transform is processing records
docker exec $(docker ps -q -f name=otel-collector) \
  curl -sf http://localhost:8888/metrics | grep stamp_service_name_from_container \
  | grep -v "^#"
# Expected: a non-zero `otelcol_processor_accepted_log_records_total` line.
```