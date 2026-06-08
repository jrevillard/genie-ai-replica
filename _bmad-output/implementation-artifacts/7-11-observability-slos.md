# Story 7.11: Observability SLOs

Status: ready-for-dev

## Story

As a developer,
I want alerting and SLOs configured for the observability stack itself,
so that I know the monitoring system is healthy and not silently losing data.

## Acceptance Criteria

1. **AC1** — When I configure alerting rules in Grafana, an alert fires when the OTel Collector is down (ingestion rate = 0 for > 2 minutes)
2. **AC2** — An alert fires when VictoriaMetrics storage usage exceeds 90% of capacity
3. **AC3** — An alert fires when VictoriaLogs ingestion rate drops below expected threshold
4. **AC4** — An alert fires when VictoriaTraces ingestion rate drops below expected threshold
5. **AC5** — Alerts are routed via Grafana notification channels (configurable, e.g., webhook, email)
6. **AC6** — A Grafana dashboard shows observability stack health: ingestion rates, storage usage, query latency
7. **AC7** — Retention policies are documented per data type (logs, traces, metrics) with configurable variables in `.env`

## Tasks / Subtasks

- [ ] Task 1: Create Grafana alert rule provisioning files (AC: 1, 2, 3, 4)
  - [ ] 1.1 Create `configs/grafana/provisioning/alerting/alert-rules.yml` with 4 alert rule groups
  - [ ] 1.2 Alert: OTel Collector Down — ingestion rate = 0 for > 2 min (query VictoriaMetrics for `scrape_samples_scraped` or OTel Collector health metric)
  - [ ] 1.3 Alert: VictoriaMetrics Storage > 90% — query `vm_free_disk_space_bytes` or use VictoriaMetrics `/api/v1/status/tsdb` via Prometheus datasource
  - [ ] 1.4 Alert: VictoriaLogs ingestion rate drop — compare current rate to baseline using `rate()` with offset comparison
  - [ ] 1.5 Alert: VictoriaTraces ingestion rate drop — same pattern as logs alert but for trace pipeline
  - [ ] 1.6 Set appropriate severity labels (critical for collector down, warning for storage/ingestion drops)
  - [ ] 1.7 Configure `noDataState` and `execErrState` appropriately per alert

- [ ] Task 2: Create Grafana notification provisioning (AC: 5)
  - [ ] 2.1 Create `configs/grafana/provisioning/alerting/contactpoints.yml` with webhook contact point template
  - [ ] 2.2 Create `configs/grafana/provisioning/alerting/notification-policies.yml` with default routing policy
  - [ ] 2.3 Add env vars to `env` template: `GRAFANA_ALERT_WEBHOOK_URL` (optional), `GRAFANA_ALERT_EMAIL` (optional)
  - [ ] 2.4 Configure default notification policy to route all alerts to the configured contact point

- [ ] Task 3: Create Observability Stack Health dashboard (AC: 6)
  - [ ] 3.1 Create `configs/grafana/provisioning/dashboards/observability-stack-health.json`
  - [ ] 3.2 Panel: OTel Collector Status (up/down indicator + ingestion rate)
  - [ ] 3.3 Panel: VictoriaMetrics ingestion rate + storage usage %
  - [ ] 3.4 Panel: VictoriaLogs ingestion rate + storage size
  - [ ] 3.5 Panel: VictoriaTraces ingestion rate + storage size
  - [ ] 3.6 Panel: Grafana health (self-monitoring)
  - [ ] 3.7 Panel: Tempo Proxy health
  - [ ] 3.8 Include alert state annotations on relevant panels

- [ ] Task 4: Document retention policies (AC: 7)
  - [ ] 4.1 Update `configs/otel/README.md` with retention policy documentation per data type
  - [ ] 4.2 Verify env template Section 12C already has `VICTORIAMETRICS_RETENTION`, `VICTORIALOGS_RETENTION`, `VICTORIATRACES_RETENTION` variables
  - [ ] 4.3 Add documentation for alert threshold configuration

- [ ] Task 5: Wire provisioning into Grafana container (AC: 1-7)
  - [ ] 5.1 Update `docker-compose.yaml` Grafana volume mount to include alerting provisioning directory
  - [ ] 5.2 Add Grafana environment variables for alerting configuration (`GF_ALERTING_ENABLED`, etc.)
  - [ ] 5.3 Add `ENABLE_OBSERVABILITY` guard — alerts only active when stack is enabled

- [ ] Task 6: Unit tests for provisioning files (AC: 1-7)
  - [ ] 6.1 Test alert rule YAML is valid and all 4 rules present with correct PromQL queries
  - [ ] 6.2 Test contact point and notification policy YAML structure
  - [ ] 6.3 Test dashboard JSON structure (panels, datasources)
  - [ ] 6.4 Test env template contains new alerting variables

- [ ] Task 7: Update Ansible for alerting variables (AC: 5, 7)
  - [ ] 7.1 Add alerting env vars to `deploy/ansible/group_vars/all.yml`
  - [ ] 7.2 Add alerting env vars to `deploy/ansible/templates/env.j2`
  - [ ] 7.3 Add alerting secrets to vault example if needed

## Dev Notes

### Architecture Context

This story adds the "who watches the watchers" layer — meta-monitoring for the observability stack itself. All 6 observability services are already deployed and functional (Stories 7.5–7.7):

| Service | Image | Role | Healthcheck |
|---------|-------|------|-------------|
| otel-collector | `otel/opentelemetry-collector-contrib:0.152.0` | Receives OTLP + fluentd logs | Extension `:13133` |
| victoriametrics | `victoriametrics/victoria-metrics:v1.138.0` | Metrics storage | `:8428/health` |
| victorialogs | `victoriametrics/victoria-logs:v1.50.0` | Log storage | `:9428/health` |
| victoriatraces | `victoriametrics/victoria-traces:v0.9.2` | Trace storage | `:10428/-/healthy` |
| tempo-proxy | `genieai/tempo-proxy:latest` | Jaeger API bridge | `:10429/health` |
| grafana | `grafana/grafana:12.4` | Dashboards + alerting | `:3000/api/health` |

### Alerting Approach: Grafana-Native (NOT vmalert)

**Use Grafana's built-in alerting engine** — NOT VictoriaMetrics vmalert. Reasons:
1. Grafana is already deployed with Keycloak SSO, no new service needed
2. Grafana has direct access to all 3 datasources (VM, VLogs, VTraces)
3. File-based provisioning in Grafana 12.x supports alert rules, contact points, and notification policies
4. The AC explicitly says "alerting rules in Grafana" and "Grafana notification channels"
5. Adding vmalert + Alertmanager would require 2 additional services, new routes, new credentials

### Grafana Alerting Provisioning Structure

Grafana 12.x provisions alert rules via YAML files. The provisioning directory structure:

```
configs/grafana/provisioning/
├── alerting/
│   ├── alert-rules.yml          # Alert rule definitions
│   ├── contactpoints.yml        # Contact points (webhook, email)
│   └── notification-policies.yml # Routing policies
├── dashboards/
│   ├── dashboards.yml           # Dashboard provider
│   ├── observability-stack-health.json  # NEW - stack health dashboard
│   └── ... (existing dashboards)
└── datasources/
    └── ... (existing datasources)
```

### Key Metric Names for Alerts

VictoriaMetrics exposes self-monitoring metrics. Use these for alerting:

**OTel Collector health:**
- `otelcol_processor_accepted_spans` — spans accepted by processor (use `rate()` to check if > 0)
- Or use OTel Collector's own health endpoint metrics exposed via Prometheus exporter
- Fallback: check if VictoriaMetrics receives any data via `up{job="victoriametrics"}`

**VictoriaMetrics storage:**
- `vm_free_disk_space_bytes` — free disk space on VM storage
- `vm_data_size_bytes` — actual data size
- Compute: `1 - (vm_free_disk_space_bytes / vm_free_disk_space_bytes offset 7d)` for trend-based alerting
- Simpler: VictoriaMetrics exposes `vm_storage_size_bytes` and total disk can be inferred

**Ingestion rate monitoring:**
- VictoriaMetrics: `rate(scrape_samples_scraped[5m])` for scrape-level monitoring
- VictoriaLogs: Use the logs datasource to query log ingestion volume over time
- VictoriaTraces: Query trace count via Jaeger API or use metrics exported by VictoriaTraces

### Grafana Alert Rule YAML Schema (Grafana 12.x)

```yaml
apiVersion: 1
groups:
  - orgId: 1
    name: observability_stack_health
    folder: Observability
    interval: 60s
    rules:
      - uid: otel_collector_down
        title: OTel Collector Down
        condition: A
        data:
          - refId: A
            datasourceUid: victoria-metrics  # Match datasource UID from vm-datasource.yml
            model:
              expr: >
                rate(otelcol_processor_accepted_spans{processor="batch"}[2m]) == 0
                or vector(0)
              intervalMs: 60000
              maxDataPoints: 43200
              refId: A
            relativeTimeRange:
              from: 600
              to: 0
        noDataState: Alerting   # Alert when no data (collector fully down)
        execErrState: Alerting  # Alert on query error
        for: 2m
        labels:
          severity: critical
          component: observability
        annotations:
          summary: "OTel Collector is not processing spans"
          description: "Ingestion rate has been zero for more than 2 minutes. The collector may be down or misconfigured."
```

**IMPORTANT:** The `datasourceUid` in alert rules MUST match the actual provisioned datasource UID. Check `configs/grafana/provisioning/datasources/vm-datasource.yml` — if no `uid` is set, Grafana auto-generates one. **You may need to add an explicit `uid` to the VM datasource** to reference it in alert rules.

### Contact Points Schema

```yaml
apiVersion: 1
contactPoints:
  - orgId: 1
    name: default-webhook
    receivers:
      - uid: default-webhook-receiver
        type: webhook
        disableResolveMessage: false
        settings:
          url: ${GRAFANA_ALERT_WEBHOOK_URL}
          httpMethod: POST
        # For email:
        # type: email
        # settings:
        #   addresses: ${GRAFANA_ALERT_EMAIL}
```

**NOTE:** Grafana provisioning does NOT support env var substitution in YAML files natively. The contact point URL must either:
- Be a sensible default (e.g., empty/disable) that users configure via Grafana UI after deployment
- Or use Grafana's `GF_ALERTING...` environment variables for runtime configuration

**Recommended approach:** Provision the contact point as a template with placeholder values. Document that users should configure via Grafana UI or env vars. This keeps the provisioning file working without requiring secrets in committed files.

### Notification Policy Schema

```yaml
apiVersion: 1
policies:
  - orgId: 1
    receiver: default-webhook
    group_by: ['alertname', 'component']
    group_wait: 30s
    group_interval: 5m
    repeat_interval: 4h
```

### Dashboard Design: Observability Stack Health

The dashboard should provide a single pane of glass for the meta-monitoring layer:

| Panel | Metric Source | Query |
|-------|--------------|-------|
| OTel Collector Status | VictoriaMetrics | `otelcol_processor_accepted_spans` rate + `up` |
| VM Ingestion Rate | VictoriaMetrics (self-monitoring) | `rate(vm_rows_ingested_total[5m])` |
| VM Storage Usage | VictoriaMetrics | `vm_data_size_bytes` |
| VLogs Ingestion Rate | VictoriaLogs | Log count query over time |
| VTraces Ingestion Rate | VictoriaMetrics (traces exporter metrics) | `rate(otelcol_exporter_sent_spans[5m])` |
| Grafana Health | VictoriaMetrics | `up{job="grafana"}` |
| Tempo Proxy Health | VictoriaMetrics | `up{job="tempo-proxy"}` |

### Retention Policy Documentation

The env template (`env` file Section 12C) already contains:
- `VICTORIAMETRICS_RETENTION=30d` (default)
- `VICTORIALOGS_RETENTION=30d` (default)
- `VICTORIATRACES_RETENTION=30d` (default)

These are configurable per deployment via `.env`. Document in `configs/otel/README.md`:
- **Metrics**: 30d default, short retention due to high cardinality
- **Logs**: 30d default, can extend for compliance requirements
- **Traces**: 30d default, sampling rate controls volume
- Recommend monitoring storage usage and adjusting retention vs disk capacity

### Docker Compose Changes

The Grafana service already mounts `./configs/grafana/provisioning:/etc/grafana/provisioning:ro`. Adding `alerting/` subdirectory files will automatically be picked up by Grafana on startup. **No volume mount change needed.**

Add to Grafana environment:
```yaml
- GF_ALERTING_ENABLED=${ENABLE_OBSERVABILITY:-0}
```

Wait — `GF_ALERTING_ENABLED` doesn't exist as a toggle. Grafana alerting is always enabled when Grafana is running. The alert rules will only fire when the datasources are available (i.e., when `ENABLE_OBSERVABILITY=1`). **No special guard needed** — alerts simply won't fire when the observability stack is disabled because the datasources are unreachable.

### Ansible Integration

Alerting env vars to add:
- `deploy/ansible/group_vars/all.yml`: `grafana_alert_webhook_url: ""` (default empty)
- `deploy/ansible/templates/env.j2`: `GRAFANA_ALERT_WEBHOOK_URL={{ grafana_alert_webhook_url }}`

### Testing Strategy

**Unit tests only** (no running Grafana needed):
- Validate YAML structure of provisioning files
- Validate all 4 alert rules exist with correct UIDs and queries
- Validate contact point and notification policy schemas
- Validate dashboard JSON has required panels
- Validate env template has alerting variables

Use Node.js/Jest for consistency with existing test patterns (see Story 7-9's `kong-otel-config.test.js` pattern).

### File Locations

| File | Action | Purpose |
|------|--------|---------|
| `configs/grafana/provisioning/alerting/alert-rules.yml` | NEW | 4 alert rule definitions |
| `configs/grafana/provisioning/alerting/contactpoints.yml` | NEW | Webhook/email contact points |
| `configs/grafana/provisioning/alerting/notification-policies.yml` | NEW | Default routing policy |
| `configs/grafana/provisioning/dashboards/observability-stack-health.json` | NEW | Stack health dashboard |
| `configs/grafana/provisioning/datasources/vm-datasource.yml` | UPDATE | Add explicit `uid` for alert rule references |
| `configs/otel/README.md` | UPDATE | Retention policy documentation + alert docs |
| `env` | UPDATE | Add alerting env vars (Section 12C) |
| `docker-compose.yaml` | UPDATE | Grafana alerting env vars (if needed) |
| `deploy/ansible/group_vars/all.yml` | UPDATE | Alerting variables |
| `deploy/ansible/templates/env.j2` | UPDATE | Alerting env vars |
| `configs/grafana/provisioning/__tests__/alerting-provisioning.test.js` | NEW | Unit tests for provisioning files |

### Critical Implementation Notes

1. **Datasource UID alignment** — Alert rules reference datasources by UID. If `vm-datasource.yml` doesn't have an explicit `uid`, Grafana auto-generates one that changes between restarts. **MUST add `uid: victoriametrics` to the VM datasource** for stable alert rule references. Check other datasources too — `vtraces-datasource.yml` already has `uid: victoriatraces`.

2. **No secrets in committed files** — Contact point URLs/emails should NOT contain real credentials. Use placeholder values and document UI-based configuration.

3. **Alert rule UIDs must be unique and stable** — Use descriptive UIDs like `otel_collector_down`, `vm_storage_high`, `vlogs_ingestion_drop`, `vtraces_ingestion_drop`.

4. **PromQL metric names** — Verify exact metric names by checking VictoriaMetrics documentation for self-monitoring metrics. VictoriaMetrics exposes metrics at `:8428/metrics` (Prometheus format). Key metrics: `vm_rows_ingested_total`, `vm_data_size_bytes`, `vm_free_disk_space_bytes`.

5. **OTel Collector metrics** — The Collector exposes its own metrics via the `prometheus` exporter or via OTLP. Check if Collector self-telemetry is configured in `otel-collector-config.yaml`. If not, the Collector's `batch` processor metrics (`otelcol_processor_accepted_spans`) may not be exported to VictoriaMetrics. **Alternative approach**: Use a health-check based alert — ping Collector's `:13133/health/status` endpoint via a synthetic check, or use the absence of ANY metric data in VictoriaMetrics as the "collector down" signal.

6. **VictoriaLogs/Traces ingestion rate** — These services may not export Prometheus metrics by default. VictoriaLogs exposes some stats at `:9428/metrics`. VictoriaTraces at `:10428/metrics`. If they don't expose ingestion metrics, use proxy queries through VictoriaMetrics (which tracks exporter send rates).

7. **Grafana alerting folder** — Grafana 12.x looks in `/etc/grafana/provisioning/alerting/` for alert provisioning files. Since the provisioning directory is already mounted read-only, simply creating files in `configs/grafana/provisioning/alerting/` is sufficient.

### Previous Story Learnings (Story 7-9)

- **Safe defaults pattern** — Default to disabled, enable when flag is set. For alerting: alert rules are provisioned but only fire when datasources are healthy (natural guard).
- **JSON test pattern** — Validate provisioning file structure with Jest, no running services needed.
- **Env var validation** — Follow existing `ENABLE_OBSERVABILITY` pattern (`0` or `1`, not `true`/`false`).
- **Comment preservation** — When updating sprint-status.yaml or env template, preserve all existing comments.

### References

- [Source: configs/otel/otel-collector-config.yaml] — Current Collector config with pipelines and exporters
- [Source: configs/otel/README.md] — OTel documentation, deployment patterns, instrumented services table
- [Source: configs/grafana/provisioning/datasources/vm-datasource.yml] — VM datasource (needs uid added)
- [Source: configs/grafana/provisioning/datasources/vtraces-datasource.yml] — Already has `uid: victoriatraces`
- [Source: configs/grafana/provisioning/dashboards/] — 5 existing dashboards for pattern reference
- [Source: docker-compose.yaml] — Observability profile services, Grafana config, env vars
- [Source: env Section 12C] — Existing observability env vars
- [Source: _bmad-output/planning-artifacts/epics.md] — Story 7.11 acceptance criteria
- [Source: Story 7-9 file] — Kong OTel tracing implementation patterns, testing approach

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
