---
baseline_commit: c01cfcc135f8259e5c384fa24f6bcef7f3051c96
---

# Story 7.7: Deploy VictoriaTraces for Distributed Trace Storage

Status: ready-for-dev

## Story

As a developer,
I want distributed traces stored in VictoriaTraces instead of the current stdout debug dump,
so that I can query, visualize, and analyze full distributed traces across the entire stack.

## Acceptance Criteria

1. **AC1: VictoriaTraces service** — Add `victoriatraces` service to `docker-compose.yaml` using `victoriametrics/victoria-traces:v0.9.1`. Stores traces with configurable retention (default 30 days via `VICTORIATRACES_RETENTION`). Data persisted in a named volume (`vtraces-data`). Docker healthcheck on `GET /-/healthy` (port 10428). Follows same dual-mode pattern as other observability services: `profiles: [observability]` for compose up, `replicas: ${ENABLE_OBSERVABILITY:-0}` for Swarm. Default HTTP port: `10428`. Placement: `node.labels.genieai == true`. Internal only — NO host port exposure.
2. **AC2: OTel Collector traces pipeline updated** — The OTel Collector `traces` pipeline exporter is changed from `debug` to `otlphttp` pointing to VictoriaTraces (`http://victoriatraces:10428/insert/opentelemetry/v1/traces`). The `debug` exporter is **removed** (no longer needed).
3. **AC3: Collector buffer/resilience** — The VictoriaTraces `otlphttp` exporter includes a file-based `sending_queue` for resilience when VictoriaTraces is temporarily unavailable: `storage: file`, `num_consumers: 10`, `queue_size: 5000`, with `retry_on_failure` enabled. An `otel-queue` named volume is mounted on the Collector for persistent queue storage.
4. **AC4: Trace sampling configurable** — A `probabilistic_sampler` processor is added to the traces pipeline. Sampling rate configurable via `OTEL_TRACES_SAMPLER_RATE` env var on the Collector service (default `1.0` = 100%). Documented in `configs/otel/README.md`.
5. **AC5: Grafana Jaeger datasource provisioned** — A `jaeger` datasource is provisioned in `configs/grafana/provisioning/datasources/vtraces-datasource.yml` pointing to `http://victoriatraces:10428/select/jaeger` with `uid: victoriatraces`. VictoriaTraces provides Jaeger Query Service JSON APIs — no custom plugin needed.
6. **AC6: Trace Explorer dashboard** — A pre-configured "Trace Explorer" dashboard shows trace waterfall with service map, span details, and latency breakdown. Auto-provisioned via file-based dashboard provisioning. Uses Jaeger datasource queries.
7. **AC7: Existing dashboards updated** — The `service-health.json` and `rag-pipeline-trace-waterfall.json` dashboards query VictoriaMetrics for trace-derived metrics (latency histograms, request rates) — these remain **unchanged** since VictoriaMetrics stores metrics, not traces. A "View Traces" link panel is added to `service-health.json` using Grafana dashboard links (`type: dashboard`, `datasourceUid: victoriatraces`).
8. **AC8: Env template updated** — Add `VICTORIATRACES_RETENTION`, `OTEL_TRACES_SAMPLER_RATE` to root `env` template (Section 12C).
9. **AC9: Ansible support** — Add `victoriatraces_retention` variable to `deploy/ansible/group_vars/all.yml`. Update `deploy/ansible/templates/env.j2` with new Section 12C variables.
10. **AC10: Docker Compose up works** — `docker compose --profile observability up -d` starts VictoriaTraces alongside existing observability services. `docker compose up -d` (no profile) does NOT start it.
11. **AC11: Docker Swarm works** — `ENABLE_OBSERVABILITY=1` in `.env` + `docker stack deploy` starts VictoriaTraces with proper placement.
12. **AC12: Existing services unaffected** — All existing services (backend, frontend, OPEA, gateway, collector, VM, VL, grafana) start and run normally.
13. **AC13: Existing tests pass** — All existing CI tests continue to pass. No regressions.
14. **AC14: OTel Collector config documented** — `configs/otel/README.md` updated with new traces pipeline (sampler + VictoriaTraces exporter), file-based sending_queue, and sampling configuration.

## Tasks / Subtasks

- [ ] Task 1: Create VictoriaTraces service in docker-compose.yaml (AC: #1)
  - [ ] Add `vtraces-data` named volume to `volumes:` section
  - [ ] Add `victoriatraces` service with: image `victoriametrics/victoria-traces:v0.9.1`, retention command, data volume, healthcheck (`/-/healthy`), `genieai_network`, profiles, deploy block
  - [ ] Follow dual-mode pattern: `profiles:[observability]`, `replicas:${ENABLE_OBSERVABILITY:-0}`, placement `node.labels.genieai == true`
  - [ ] Add `logging: *fluent-logging` for consistent log aggregation
  - [ ] Port `10428` is internal only — NO host port exposure

- [ ] Task 2: Update OTel Collector config for trace storage (AC: #2, #3, #4)
  - [ ] Add `victoriatraces` otlphttp exporter with traces_endpoint pointing to `http://victoriatraces:10428/insert/opentelemetry/v1/traces`
  - [ ] Configure file-based `sending_queue`: `storage: file`, `num_consumers: 10`, `queue_size: 5000`
  - [ ] Configure `retry_on_failure`: enabled, 5s initial, 30s max, 300s max elapsed
  - [ ] Add `probabilistic_sampler` processor with `sampling_percentage: ${OTEL_TRACES_SAMPLER_RATE:-1.0}`
  - [ ] Update `traces` pipeline: `otlp` → `probabilistic_sampler` → `batch` → `victoriatraces`
  - [ ] Remove the `debug` exporter (no longer needed)
  - [ ] Update Collector service env in docker-compose.yaml: add `OTEL_TRACES_SAMPLER_RATE` env var
  - [ ] Add `otel-queue` named volume for file-based sending_queue persistence
  - [ ] Add volume mount: `otel-queue:/var/lib/otelcol` to otel-collector service
  - [ ] Keep existing `otlp_http` exporter (used for logs) unchanged

- [ ] Task 3: Provision Grafana Jaeger datasource for VictoriaTraces (AC: #5)
  - [ ] Create `configs/grafana/provisioning/datasources/vtraces-datasource.yml` with Jaeger datasource type
  - [ ] URL: `http://victoriatraces:10428/select/jaeger`, `uid: victoriatraces`
  - [ ] Set as non-default, editable: false

- [ ] Task 4: Create Trace Explorer dashboard (AC: #6)
  - [ ] Create `configs/grafana/provisioning/dashboards/trace-explorer.json` with trace waterfall dashboard
  - [ ] Include: service map, trace search, span details, latency breakdown
  - [ ] Use Jaeger datasource queries (Trace Search, Trace Timeline panels)
  - [ ] Add to dashboard provider in `dashboards.yml`

- [ ] Task 5: Update existing dashboards (AC: #7)
  - [ ] Add a "View Traces" link panel to `service-health.json` using: `type: dashboard`, `datasourceUid: victoriatraces`, `url: "/d/genieai-trace-explorer/trace-explorer"`
  - [ ] Verify `rag-pipeline-trace-waterfall.json` still works (queries VictoriaMetrics, not traces — unchanged)

- [ ] Task 6: Update env template and Ansible (AC: #8, #9)
  - [ ] Add `VICTORIATRACES_RETENTION`, `OTEL_TRACES_SAMPLER_RATE` to `env` Section 12C
  - [ ] Add `victoriatraces_retention: "30d"` to `deploy/ansible/group_vars/all.yml` (follow pattern of `victoriametrics_retention` and `victorialogs_retention`)
  - [ ] Update `deploy/ansible/templates/env.j2` with new variables

- [ ] Task 7: Update OTel Collector documentation (AC: #14)
  - [ ] Update `configs/otel/README.md` with new traces pipeline architecture
  - [ ] Document sampling configuration (OTEL_TRACES_SAMPLER_RATE)
  - [ ] Document file-based sending_queue for resilience
  - [ ] Update pipeline diagram in README

- [ ] Task 8: Validate deployment (AC: #10, #11, #12, #13)
  - [ ] Verify `docker compose config --profiles observability` includes victoriatraces
  - [ ] Verify `docker compose config` (without profile) excludes victoriatraces
  - [ ] Verify all YAML/JSON config files parse correctly
  - [ ] Verify all existing CI tests pass
  - [ ] Verify lint passes on any modified files

- [ ] Task 9: Update documentation (AC: #1)
  - [ ] Update `CLAUDE.md` observability section with VictoriaTraces info
  - [ ] Update `.claude/rules/ENVIRONMENT.md` with VictoriaTraces port (10428)

## Dev Notes

### Critical: VictoriaTraces Technical Details

| Property | Value |
|----------|-------|
| Docker image | `victoriametrics/victoria-traces:v0.9.1` |
| HTTP API port | `10428` |
| OTLP ingestion endpoint | `/insert/opentelemetry/v1/traces` (HTTP) |
| Jaeger query endpoint | `/select/jaeger` (for Grafana Jaeger datasource) |
| Healthcheck | `GET /-/healthy` on port 10428 |
| Storage path | `/var/lib/victoria-traces` |
| Retention flag | `--retentionPeriod=30d` (default 7d, we use 30d) |
| Trace Explorer UI | `http://victoriatraces:10428/select/vmui` |
| Metrics endpoint | `/metrics` (Prometheus-format internal metrics) |
| Performance | 3.7x less RAM, 2.6x less CPU than Grafana Tempo |

### Critical: Current OTel Collector State (from Story 7-6)

The Collector currently has THREE pipelines:

| Pipeline | Receivers | Exporters |
|----------|-----------|-----------|
| metrics | otlp | prometheusremotewrite → VictoriaMetrics |
| traces | otlp | **debug** (stdout dump — NO persistent storage) |
| logs | fluent_forward | otlp_http → VictoriaLogs |

**This story changes ONLY the `traces` pipeline**: `debug` → `probabilistic_sampler` → `batch` → `victoriatraces` (otlphttp). The `metrics` and `logs` pipelines remain UNCHANGED.

**Exporter naming conflict**: There's an existing `otlp_http` exporter used for logs (to VictoriaLogs). The new trace exporter should be named differently (e.g., `victoriatraces`) to avoid confusion.

### Critical: File-Based Sending Queue for Resilience

The Collector's file-based sending_queue stores traces on disk when VictoriaTraces is temporarily unavailable. This prevents data loss during restarts or brief outages.

```yaml
exporters:
  victoriatraces:
    traces_endpoint: http://victoriatraces:10428/insert/opentelemetry/v1/traces
    sending_queue:
      enabled: true
      num_consumers: 10
      queue_size: 5000
      storage: file
    retry_on_failure:
      enabled: true
      initial_interval: 5s
      max_interval: 30s
      max_elapsed_time: 300s
    timeout: 15s
```

**Note:** The Collector service needs a writable volume for the file-based queue. Add a volume mount for `/var/lib/otelcol` (the Collector's working directory) to persist the queue across restarts.

### Critical: Grafana Jaeger Datasource (NOT a custom plugin)

VictoriaTraces provides **Jaeger Query Service JSON APIs**, making it compatible with Grafana's **built-in Jaeger datasource** (no custom plugin needed). The datasource type in provisioning YAML is `jaeger`.

**Datasource provisioning:**
```yaml
apiVersion: 1

datasources:
  - name: VictoriaTraces
    type: jaeger
    access: proxy
    url: http://victoriatraces:10428/select/jaeger
    uid: victoriatraces
    editable: false
    jsonData:
      traceQuery:
        maxTraces: 1000
        maxDuration: 60m
        minDuration: 0ms
        spanStartTimeAdjustment: true
```

### Critical: Probabilistic Sampler Configuration

The `probabilistic_sampler` processor is added to the Collector's traces pipeline to control sampling rate. Default 100% (all traces stored) for MVP, configurable for production.

```yaml
processors:
  probabilistic_sampler:
    sampling_percentage: ${OTEL_TRACES_SAMPLER_RATE:-1.0}
```

**Environment variable on Collector service:**
```yaml
otel-collector:
  environment:
    - OTEL_TRACES_SAMPLER_RATE=${OTEL_TRACES_SAMPLER_RATE:-1.0}
```

**Note:** OTel Collector supports env var interpolation in config via `${ENV_VAR}` syntax, but only if the Collector binary supports it. The `otel/opentelemetry-collector-contrib` image supports this via the `confmap` provider. Verify this works — if not, hardcode the default `1.0` and document the env var for manual override.

### Critical: Docker Compose Service Definition Pattern

Follow the EXACT same pattern as VictoriaLogs (story 7-6):

```yaml
victoriatraces:
  logging: *fluent-logging
  profiles: [observability]
  restart: unless-stopped
  image: victoriametrics/victoria-traces:v0.9.1
  command:
    - "--storageDataPath=/var/lib/victoria-traces"
    - "--retentionPeriod=${VICTORIATRACES_RETENTION:-30d}"
    - "--httpListenAddr=:10428"
  volumes:
    - vtraces-data:/var/lib/victoria-traces
  healthcheck:
    test: ["CMD", "wget", "--spider", "-q", "http://127.0.0.1:10428/-/healthy"]
    interval: 10s
    timeout: 5s
    retries: 3
    start_period: 10s
  networks:
    - genieai_network
  deploy:
    replicas: ${ENABLE_OBSERVABILITY:-0}
    placement:
      constraints:
        - node.labels.genieai == true
    restart_policy:
      condition: on-failure
      delay: 5s
      max_attempts: 5
```

### Critical: Port Allocation (Updated)

| Port | Service | Status |
|------|---------|--------|
| 4318 | OTel Collector (OTLP HTTP) | Existing |
| 13133 | OTel Collector (healthcheck) | Existing |
| 24224 | OTel Collector (fluent_forward) | Existing (bound 127.0.0.1 only) |
| 8428 | VictoriaMetrics | Existing |
| 9428 | VictoriaLogs | Existing |
| **10428** | **VictoriaTraces** | **NEW** |
| 3000 | Grafana (container) | Existing, internal-only |

### Critical: Volume Structure (Updated)

Add `vtraces-data` to the existing volumes section:

```yaml
volumes:
  # ... existing volumes ...
  vm-data:
  grafana-data:
  vlogs-data:
  vtraces-data:        # NEW
```

### Critical: OTel Collector File-Based Queue Volume

For the file-based `sending_queue`, the Collector needs a writable directory. Add a volume mount:

```yaml
otel-collector:
  volumes:
    - ./configs/otel/otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml:ro
    - otel-queue:/var/lib/otelcol  # NEW: persistent file-based queue
```

Add `otel-queue` to volumes section:

```yaml
volumes:
  otel-queue:    # NEW: OTel Collector persistent sending queue
```

### Critical: VictoriaLogs Datasource Already References VictoriaTraces

Story 7-6 created `vlogs-datasource.yml` with `derivedFields` referencing `victoriatraces` datasource UID for log-to-trace correlation:

```yaml
derivedFields:
  - datasourceUid: victoriatraces
    matcherRegex: "/trace_id=\"([^\"]+)\"/"
    name: TraceID
    url: "$${__value.raw}"
```

**The datasource UID `victoriatraces` MUST match** the uid specified in the new `vtraces-datasource.yml`. Set `uid: victoriatraces` in the new datasource provisioning.

### Critical: OTel Collector Config Naming

Current exporter names:
- `prometheusremotewrite` — metrics to VictoriaMetrics
- `debug` — traces to stdout (will be REMOVED)
- `otlp_http` — logs to VictoriaLogs (rename to avoid confusion with new trace exporter)

**Proposed final state:**
- `prometheusremotewrite` — metrics to VictoriaMetrics (unchanged)
- `victoriatraces` — traces to VictoriaTraces (NEW, replaces `debug`)
- `otlp_http` — logs to VictoriaLogs (unchanged)

### Previous Story Intelligence (7-6: VictoriaLogs)

**What was built:**
- VictoriaLogs service (v1.50.0) with dual-mode deployment
- OTel Collector configured with fluent_forward receiver (logs) and otlphttp exporter (to VictoriaLogs)
- All services use fluentd logging driver via YAML anchor `x-logging: &fluent-logging`
- Collector runs in `mode: global` without placement constraint
- Grafana SSO via Keycloak OIDC (generic OAuth)
- Grafana accessible only via Kong route `/grafana/`
- Service Logs dashboard with trace_id filter (prepared for VictoriaTraces)
- vlogs-datasource.yml with derivedFields referencing `victoriatraces` datasource UID

**What changes for 7-7:**
- **Collector traces pipeline** gets VictoriaTraces exporter (replacing debug) + sampler
- **Collector may need writable volume** for file-based sending_queue
- **New VictoriaTraces service** added to docker-compose.yaml
- **New Jaeger datasource** in Grafana provisioning
- **New Trace Explorer dashboard** in Grafana provisioning
- **Env template** gets VICTORIATRACES_RETENTION + OTEL_TRACES_SAMPLER_RATE
- **Documentation** updates for OTel Collector README, CLAUDE.md, ENVIRONMENT.md

**What does NOT change:**
- metrics pipeline (unchanged)
- logs pipeline (unchanged)
- fluent_forward receiver (unchanged)
- VictoriaLogs service (unchanged)
- VictoriaMetrics service (unchanged)
- Grafana SSO/Kong config (unchanged)
- service-health and rag-pipeline dashboards (unchanged — they query VictoriaMetrics)

### Previous Story Intelligence (7-5: Observability Stack)

**What was built:**
- OTel Collector config at `configs/otel/otel-collector-config.yaml`
- VictoriaMetrics datasource in Grafana
- Two dashboards: service-health.json, rag-pipeline-trace-waterfall.json
- Dual-mode deployment pattern established (profiles + replicas)
- Env template Section 12C with ENABLE_OBSERVABILITY vars

**Key pattern:** All observability services follow dual-mode: `profiles: [observability]` + `deploy.replicas: ${ENABLE_OBSERVABILITY:-0}`.

### Anti-Patterns to Avoid

- **Do NOT** remove the `debug` exporter without replacing it — traces will be lost during the switch. Add `victoriatraces` exporter first, then remove `debug`.
- **Do NOT** change the `metrics` or `logs` pipelines — they work correctly and are independent of traces.
- **Do NOT** rename `otlp_http` logs exporter — it's working and referenced in the logs pipeline. Only add a new `victoriatraces` exporter for traces.
- **Do NOT** expose VictoriaTraces port to the host — it's internal-only, Grafana queries it on the Docker network.
- **Do NOT** use `:latest` image tags — pin `v0.9.1`.
- **Do NOT** create a separate Docker network — use existing `genieai_network`.
- **Do NOT** hardcode sampling rate — use env var with default.
- **Do NOT** modify application code (tracing.js, tracing.py) — this story is infrastructure only.
- **Do NOT** forget Swarm `deploy:` block — dual-mode is required.
- **Do NOT** use `curl` in healthchecks — VictoriaTraces uses Alpine with `wget`.
- **Do NOT** install Tempo or Jaeger — VictoriaTraces replaces them (different product, same use case).
- **Do NOT** forget `uid: victoriatraces` in Grafana datasource provisioning — vlogs-datasource.yml already references this UID for log-to-trace correlation.
- **Do NOT** confuse `otlp_http` (logs exporter) with the new trace exporter — use distinct name `victoriatraces`.
- **Do NOT** use `${env:...}` syntax in Keycloak config — use `$(env:...)` (not relevant to this story but good to remember).
- **Do NOT** modify existing dashboard queries — service-health and rag-pipeline-trace-waterfall query VictoriaMetrics (metrics), not VictoriaTraces (traces).

### Out of Scope

- **Custom metrics instrumentation** — story 7.8
- **Kong OTel tracing** — story 7.9
- **MELT correlation test** — story 7.10
- **Alerting/SLOs** — story 7.11
- **gRPC ingestion** — HTTP OTLP only for MVP
- **TLS for VictoriaTraces** — internal-only, not needed
- **Grafana Enterprise features** — open-source Grafana only
- **Multi-node volume placement** — single-node only for MVP

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.7 — Acceptance Criteria]
- [Source: _bmad-output/planning-artifacts/architecture.md#Application Observability Architecture — OTel Collector Architecture table]
- [Source: _bmad-output/implementation-artifacts/7-6-deploy-victorialogs-centralized-log-aggregation.md — previous story patterns, dual-mode deployment, Grafana SSO, vlogs datasource derivedFields]
- [Source: _bmad-output/implementation-artifacts/7-5-deploy-observability-stack-collector-victoriametrics-grafana.md — original observability stack, dual-mode pattern]
- [Source: configs/otel/otel-collector-config.yaml — current Collector config with 3 pipelines (metrics, traces→debug, logs)]
- [Source: configs/otel/README.md — current Collector documentation]
- [Source: configs/grafana/provisioning/datasources/vlogs-datasource.yml — derivedFields referencing victoriatraces UID]
- [Source: configs/grafana/provisioning/datasources/vm-datasource.yml — VictoriaMetrics datasource pattern]
- [Source: configs/grafana/provisioning/dashboards/dashboards.yml — dashboard provider pattern]
- [Source: configs/grafana/provisioning/dashboards/service-health.json — existing metric dashboard (unchanged)]
- [Source: configs/grafana/provisioning/dashboards/rag-pipeline-trace-waterfall.json — existing metric dashboard (unchanged)]
- [Source: docker-compose.yaml — observability services section, volumes section, x-logging anchor]
- [Source: env — Section 12C observability variables]
- [Source: deploy/ansible/group_vars/all.yml — enable_observability pattern]
- [Source: deploy/ansible/templates/env.j2 — Section 12C conditional template]
- [Source: VictoriaMetrics docs — https://docs.victoriametrics.com/victoriatraces/ — product documentation]
- [Source: VictoriaTraces OTLP ingestion — https://docs.victoriametrics.com/victoriatraces/data-ingestion/opentelemetry/]
- [Source: VictoriaTraces Grafana integration — https://docs.victoriametrics.com/victoriatraces/querying/grafana/]

## Dev Agent Record

### Agent Model Used

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List

| File | Action |
|------|--------|
| `docker-compose.yaml` | Modified (VictoriaTraces service, OTel Collector env var, otel-queue volume, vtraces-data volume) |
| `configs/otel/otel-collector-config.yaml` | Modified (victoriatraces exporter, probabilistic_sampler, traces pipeline update, debug exporter removed) |
| `configs/otel/README.md` | Modified (traces pipeline docs, sampling docs, sending_queue docs) |
| `configs/grafana/provisioning/datasources/vtraces-datasource.yml` | Created |
| `configs/grafana/provisioning/dashboards/dashboards.yml` | Modified (new dashboard) |
| `configs/grafana/provisioning/dashboards/trace-explorer.json` | Created |
| `configs/grafana/provisioning/dashboards/service-health.json` | Modified (add "View Traces" link) |
| `env` | Modified (VICTORIATRACES_RETENTION, OTEL_TRACES_SAMPLER_RATE) |
| `deploy/ansible/group_vars/all.yml` | Modified (victoriatraces_retention) |
| `deploy/ansible/templates/env.j2` | Modified (new variables) |
| `CLAUDE.md` | Modified |
| `.claude/rules/ENVIRONMENT.md` | Modified |

### Change Log
