# Observability Stack

The observability stack has **two layers** with different defaults:

**Always-on (no opt-out):**
- **VictoriaLogs** container — `replicas: 1` hardcoded in `docker-compose.yaml`, no profile gate. Admin endpoints depend on it.
- **OTel Collector** — `mode: global`, no profile gate, one instance per Swarm node (gateway, genieai, gpu). Bound to `127.0.0.1:24224` for fluentd log ingestion (no external access).

All services use the **fluentd logging driver** to forward container stdout/stderr to the Collector's `fluent_forward` receiver. Docker dual logging (20.10+) keeps `docker logs` functional. Container logs reach VictoriaLogs unconditionally — there is no env var that turns VL off.

**Opt-in via `ENABLE_OBSERVABILITY=1` in `.env` (default `0`, MUST be `0` or `1`):**
- **In-app OTel SDK init** (`tracing.js`, `tracing.py`) — TracerProvider + MeterProvider + auto-instrumentation. No-op when not `"1"` (avoids DNS errors when the Collector is intentionally not deployed in compose mode).
- **Profile-gated services** in Swarm mode (`replicas: ${ENABLE_OBSERVABILITY:-0}`): Grafana, VictoriaMetrics, VictoriaTraces, tempo-proxy. In compose mode these require `--profile observability` (Swarm ignores profiles).
- **Ansible**: `enable_observability: "1"` in `group_vars/all.yml` gates the same set.

**Why always-on for VL/Collector:** the admin logs UI queries VictoriaLogs directly, and the fluentd driver is configured on every container regardless of profile. Removing them would break log shipping to VL entirely; the only configurable opt-out is the in-app SDK.

## Tracing Architecture

Application services emit OTel-compatible telemetry (traces and metrics) via the OTLP protocol:

- **Backend (Node.js)**: `tracing.js` initializes OTel SDK with Express instrumentation, `tracing-db.js` instruments ArangoDB queries, `tracing-pii.js` filters sensitive attributes, `metrics.js` exposes Prometheus metrics
- **OPEA (Python)**: `genie-ai-overlay/tracing.py` initializes OTel SDK with FastAPI instrumentation, per-service span emission for RAG pipeline stages
- **Kong**: OTel plugin forwards request traces (configured via restore script)
- **W3C traceparent**: Cross-service trace propagation via standard `traceparent` header

Trace flow: `Frontend → Kong → Backend → ChatQnA → Retriever → Reranker → LLM` — each hop emits spans linked by trace context.

### Adding Tracing to New Code

- **Backend**: no `withSpan` helper exists — `tracing.js` exports only `sdk` and `getTracer`.
  For background work (timers, post-request async, callbacks) whose logs must inherit the
  active span, use the shared helpers `withBackgroundSpan(name, fn)` /
  `runInBackgroundSpan(name, fn)` from `shared/lib/tracing-background.js` — never create
  spans by hand via the global tracer
- **Python**: Use `tracing.with_span(name, ...)` context manager on any block of code (NOT a decorator — no `@trace_span` exists). For periodic tasks / post-request background work where emitted logs must inherit the active span, use `tracing.background_span(name, ...)` instead. See `genie-ai-overlay/CLAUDE.md` §"Public tracing API" for the full surface.
- **PII filtering**: `tracing-pii.js` (backend) automatically filters sensitive attributes — never log raw tokens, passwords, or user PII in span attributes

## Grafana Dashboards

9 pre-built dashboards (auto-provisioned from `configs/grafana/provisioning/dashboards/` via `foldersFromFilesStructure: true`):

**Application dashboards (5 — General folder):**
- Service health overview
- Application metrics (request rates, latencies, error rates)
- Service logs (centralized via VictoriaLogs)
- Trace explorer (distributed traces via VictoriaTraces)
- RAG pipeline trace waterfall (end-to-end request flow)

**Infrastructure dashboards (4 — Observability folder):**
- VictoriaMetrics single-node
- VictoriaLogs single-node
- VictoriaTraces single-node
- Observability stack health (collector + storage ingestion)

## Alerting

Alert rules defined in `configs/grafana/provisioning/alerting/`:

- Collector down / unhealthy
- Storage filling up
- Log pipeline broken
- Trace export failure
- SLO-based alerting (error rate, latency thresholds)

## Configuration Variables

(`.env` Section 12C):
- `ENABLE_OBSERVABILITY` — Enable in-app OTel SDK init (default: `0`, MUST be `0` or `1`). Gates TracerProvider/MeterProvider init + profile-gated services replicas. Does NOT gate VL or the Collector (always on).
- `GRAFANA_ADMIN_USER` — Grafana admin username (default: admin)
- `GRAFANA_ADMIN_PASSWORD` — Grafana admin password (required when enabled)
- `VICTORIALOGS_RETENTION` — Log retention period (default: 30d)
- `VICTORIATRACES_RETENTION` — Trace retention period (default: 30d)
- `OTEL_TRACES_SAMPLER_RATE` — Trace sampling rate (default: 100.0 = 100%)
- `KC_GRAFANA_CLIENT_ID` — Keycloak OIDC client ID for Grafana SSO (default: grafana)
- `KC_GRAFANA_CLIENT_SECRET` — Keycloak OIDC client secret (required when enabled)
- `VICTORIAMETRICS_RETENTION` — Metric retention period (default: 30d)
- `OTEL_EXPORTER_OTLP_ENDPOINT` — OTLP Collector endpoint (default: `http://otel-collector:4318`)

**Removed (D2 dead env vars):** `LOG_TO_VICTORIALOGS`, `LOG_TO_FILE`, `SECURITY_SCAN_BACKEND` — dropped in commit 5a3925be4. VL has no env opt-out (always-on container). The in-app SDK only has `ENABLE_OBSERVABILITY`.

Note: `ADMIN_LOGS_SOURCE` and `VL_FAIL_OPEN` are also gone from the runtime contract — `ADMIN_LOGS_SOURCE=file` no longer routes to a file reader (the file-source path was dropped in T8), and `VL_FAIL_OPEN=true` no longer emits a `{degraded: true, logs: []}` graceful-degradation envelope (VL outages surface as HTTP 503 + body `{error: 'vl_unreachable', message}` via `VlUnavailableError`).

**VlUnavailableError classifier** (`LogsService._vlOrThrow`, static): connection-class errors (`VictoriaLogsHealthError`, `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT`, `ECONNABORTED`, 5xx upstream response) are re-thrown as a typed `VlUnavailableError` carrying `statusCode: 503` + `body: {error: 'vl_unreachable', message}`. Validation / programmer errors propagate unchanged so the route layer keeps its existing 400 / 500 semantics. The global error middleware in `components/gov-chat-backend/index.js` reads `err.statusCode` + `err.body` and renders them verbatim. **Carve-out** — `AdminDashboardService.getSystemHealth()` deliberately does NOT call `_vlOrThrow` for the VL `hits` query: the error-rate metric is one derived tile of a larger health payload and the dashboard stays well-formed (errorRate=0, warn logged) on a VL outage rather than 503-ing the whole `/api/admin/system-health` response. All other VL read paths in `LogsService` + `AdminDashboardService.debugYesterdayLogs` funnel through `_vlOrThrow`.

**Identity (hard-coded, no env override — per ops decision 2026-09-18):**
- `service.namespace` = `genie-core` (backend, doc-repo) / `genieai` (OPEA overlay services)
- `service.name` = per-service (e.g. `genieai-chatqna`, `backend`, `document-repository`)
- `service.version` = `1.0.0`

**Other:**
- `LOG_LEVEL` — log verbosity for Node/Python services (default varies by service; see service-specific config)

Grafana is accessible via Kong route `/grafana/` with Keycloak OIDC SSO (no direct host port).

**Config files**: `configs/otel/` (Collector config), `configs/grafana/provisioning/` (datasources + dashboards + alerting), `configs/otel/README.md` (integration guide)
