# Observability Stack

The observability stack (OTel Collector + VictoriaMetrics + VictoriaLogs + VictoriaTraces + Grafana) is **disabled by default**. Enable via:

- **Docker Compose**: `docker compose --profile observability up -d`
- **Docker Swarm**: `ENABLE_OBSERVABILITY=1` in `.env` (MUST be `0` or `1`, not `true`/`false`)
- **Ansible**: `enable_observability: "1"` in `group_vars/all.yml`

All services use the **fluentd logging driver** to forward container logs to the OTel Collector's `fluent_forward` receiver (port 24224, localhost only). Docker dual logging (20.10+) keeps `docker logs` functional. The Collector runs in `mode: global` without placement constraint, ensuring one Collector on every Swarm node (gateway, genieai, gpu) — all service logs are collected regardless of node type.

## Tracing Architecture

Application services emit OTel-compatible telemetry (traces and metrics) via the OTLP protocol:

- **Backend (Node.js)**: `tracing.js` initializes OTel SDK with Express instrumentation, `tracing-db.js` instruments ArangoDB queries, `tracing-pii.js` filters sensitive attributes, `metrics.js` exposes Prometheus metrics
- **OPEA (Python)**: `genie-ai-overlay/tracing.py` initializes OTel SDK with FastAPI instrumentation, per-service span emission for RAG pipeline stages
- **Kong**: OTel plugin forwards request traces (configured via restore script)
- **W3C traceparent**: Cross-service trace propagation via standard `traceparent` header

Trace flow: `Frontend → Kong → Backend → ChatQnA → Retriever → Reranker → LLM` — each hop emits spans linked by trace context.

### Adding Tracing to New Code

- **Backend**: Use `tracing.withSpan(name, fn)` — never create spans manually via global tracer
- **Python**: Use `@tracing.trace_span(name)` decorator on FastAPI endpoints
- **PII filtering**: `tracing-pii.js` (backend) automatically filters sensitive attributes — never log raw tokens, passwords, or user PII in span attributes

## Grafana Dashboards

10 pre-built dashboards (auto-provisioned from `configs/grafana/provisioning/dashboards/`):

**Application dashboards (6 — General folder):**
- Service health overview
- Application metrics (request rates, latencies, error rates)
- Service logs (centralized via VictoriaLogs)
- Trace explorer (distributed traces via VictoriaTraces)
- RAG pipeline trace waterfall (end-to-end request flow)
- Observability stack health (collector, storage, ingestion)

**Infrastructure dashboards (4 — Observability folder):**
- VictoriaMetrics single-node
- VictoriaLogs single-node
- VictoriaTraces single-node
- Observability stack health (infrastructure view)

## Alerting

Alert rules defined in `configs/grafana/provisioning/alerting/`:

- Collector down / unhealthy
- Storage filling up
- Log pipeline broken
- Trace export failure
- SLO-based alerting (error rate, latency thresholds)

## Configuration Variables

(`.env` Section 12C):
- `ENABLE_OBSERVABILITY` — Enable/disable the stack (default: `0`, MUST be `0` or `1`)
- `GRAFANA_ADMIN_USER` — Grafana admin username (default: admin)
- `GRAFANA_ADMIN_PASSWORD` — Grafana admin password (required when enabled)
- `VICTORIALOGS_RETENTION` — Log retention period (default: 30d)
- `VICTORIATRACES_RETENTION` — Trace retention period (default: 30d)
- `OTEL_TRACES_SAMPLER_RATE` — Trace sampling rate (default: 100.0 = 100%)
- `KC_GRAFANA_CLIENT_ID` — Keycloak OIDC client ID for Grafana SSO (default: grafana)
- `KC_GRAFANA_CLIENT_SECRET` — Keycloak OIDC client secret (required when enabled)
- `VICTORIAMETRICS_RETENTION` — Metric retention period (default: 30d)
- `OTEL_EXPORTER_OTLP_ENDPOINT` — OTLP Collector endpoint (default: `http://otel-collector:4318`)

Grafana is accessible via Kong route `/grafana/` with Keycloak OIDC SSO (no direct host port).

**Config files**: `configs/otel/` (Collector config), `configs/grafana/provisioning/` (datasources + dashboards + alerting), `configs/otel/README.md` (integration guide)
