# OTel Collector Configuration

## Overview

OpenTelemetry Collector configuration for the GENIE.AI observability stack.

The Collector receives telemetry from instrumented application services and exports metrics to VictoriaMetrics, traces to VictoriaTraces, and logs to VictoriaLogs. Container logs are received via Docker's fluentd logging driver.

## Architecture

```
Application Services (OTel SDK)
  → OTLP HTTP (:4318) → Collector → probabilistic_sampler → batch → VictoriaTraces (:10428)
                                           → batch → prometheusremotewrite → VictoriaMetrics (:8428)

Docker Container Logs (fluentd logging driver)
  → fluent_forward (:24224) → Collector → otlp/http → VictoriaLogs (:9428)
```

### Trace Storage

Traces are exported to VictoriaTraces via OTLP HTTP. VictoriaTraces stores distributed traces and provides Jaeger Query Service JSON APIs at `/select/jaeger/api/*` for Grafana integration.

**Grafana datasource**: A `jaeger`-type datasource is provisioned pointing at `http://tempo-proxy:10429`. The tempo-proxy translates Grafana's standard Jaeger API paths (`/api/*`) to VictoriaTraces' prefixed paths (`/select/jaeger/api/*`) and passes responses through as-is. The Jaeger datasource uses HTTP/JSON only (no gRPC), ensuring compatibility with the HTTP/1.1 proxy.

**Sending queue**: The VictoriaTraces exporter uses a file-based sending queue persisted to the `otel-queue` volume (`/var/lib/otelcol/file_storage/victoriatraces`). A one-shot `otel-collector-init` container sets correct volume ownership for the nonroot Collector process (UID 10001). In compose mode, ordering is ensured via `depends_on`; in Swarm mode, the Collector's restart policy handles the startup race.

**Sampling**: A `probabilistic_sampler` processor controls trace sampling rate. Default 100% (all traces stored) for MVP, configurable via `OTEL_TRACES_SAMPLER_RATE` env var (0.0-100.0).

### Log Collection Approach

Container logs are collected using Docker's **fluentd logging driver**. All services in `docker-compose.yaml` are configured with:

```yaml
logging:
  driver: fluentd
  options:
    fluentd-address: "localhost:24224"
    fluentd-async: "true"
    tag: "genie.{{.Name}}"
```

Docker sends container stdout/stderr to the Collector's `fluent_forward` receiver. Docker dual logging (20.10+) keeps `docker logs` functional alongside the fluentd driver.

**Security**: The Collector binds port 24224 to `127.0.0.1` only (no external access). In Docker Swarm, the Collector runs in `mode: global` with no placement constraint, so every application node has a local Collector instance.

**Multi-node Swarm**: With `mode: global` and no placement constraint, the Collector runs on **every** Swarm node (gateway, genieai, gpu). This ensures all service logs are collected regardless of which node type they run on.

## Configuration Files

| File | Purpose |
|------|---------|
| `otel-collector-config.yaml` | Main Collector configuration |

## Components

### Receivers
- **OTLP HTTP** (`:4318`) — Receives traces and metrics from application services via OTLP/HTTP protocol
- **fluent_forward** (`:24224`) — Receives container logs from Docker's fluentd logging driver. Tags include service name via `genie.{{.Name}}` template.

### Processors
- **Batch** — Buffers telemetry before export (5s timeout, 1024 batch size)
- **probabilistic_sampler** — Controls trace sampling rate via `OTEL_TRACES_SAMPLER_RATE` env var (default: 100.0 = 100%)

### Exporters
- **prometheusremotewrite** — Exports Prometheus-compatible metrics to VictoriaMetrics at `http://victoriametrics:8428/api/v1/write`
- **otlp_http/victoriatraces** — Exports traces to VictoriaTraces at `http://victoriatraces:10428/insert/opentelemetry/v1/traces` with file-based sending queue and retry (protobuf encoding)
- **otlp/http** — Exports logs to VictoriaLogs at `http://victorialogs:9428/insert/opentelemetry/v1/logs`

### Extensions
- **health_check** (`:13133`) — Health check endpoint for Docker healthcheck

## Pipelines

| Pipeline | Flow |
|----------|------|
| metrics | otlp → batch → prometheusremotewrite |
| traces | otlp → probabilistic_sampler → batch → victoriatraces |
| logs | fluent_forward → batch → otlp/http |

## Sampling Configuration

The `probabilistic_sampler` processor controls what percentage of traces are stored. Configured via environment variable on the Collector service:

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_TRACES_SAMPLER_RATE` | `100.0` | Sampling percentage (0.0 = 0%, 100.0 = 100%) |

**Examples:**
- `OTEL_TRACES_SAMPLER_RATE=100.0` — Store all traces (default, recommended for development)
- `OTEL_TRACES_SAMPLER_RATE=10.0` — Store 10% of traces (recommended for high-volume production)

## Sending Queue

The VictoriaTraces exporter uses a file-based sending queue for resilience:

| Setting | Value | Description |
|---------|-------|-------------|
| `storage` | `file_storage/victoriatraces` | File-backed queue (persists across Collector restarts) |
| `num_consumers` | 10 | Concurrent senders |
| `queue_size` | 5000 | Max queued batches |
| `retry.initial_interval` | 5s | Initial retry delay |
| `retry.max_interval` | 30s | Max retry delay |
| `retry.max_elapsed_time` | 300s | Total retry budget |
| `timeout` | 15s | Request timeout |

The queue uses the `file_storage/victoriatraces` extension which writes to the `otel-queue` Docker volume mounted at `/var/lib/otelcol`. A one-shot init container (`otel-collector-init`) creates the directory structure with correct ownership (UID 10001) before the Collector starts.

**Compose mode:** The Collector waits for the init container via `depends_on: condition: service_completed_successfully`.
**Swarm mode:** Ansible removes `depends_on` — the Collector's `restart_policy: on-failure` handles the race condition. The init container runs in `mode: global` with `restart_policy: condition: none` (one-shot on every node).

**Note:** VictoriaTraces v0.9.2 only supports **protobuf** encoding for OTLP ingestion. JSON payloads are silently accepted (HTTP 200) but discarded. The OTel Collector uses protobuf by default.

## Customization

To add a new exporter:

1. Add the exporter configuration under `exporters:`
2. Add the exporter to the appropriate pipeline under `service.pipelines`

To change sampling:

1. Set `OTEL_TRACES_SAMPLER_RATE` env var on the otel-collector service in docker-compose.yaml
2. Values: 0.0 (no traces) to 100.0 (all traces)

## Instrumented Services

All instrumented services use the centralized `OTEL_EXPORTER_OTLP_ENDPOINT` variable to locate the Collector. The SDK is no-op when the Collector is unavailable (services start normally without the observability stack).

| Service | OTel SDK | Export Path |
|---------|----------|-------------|
| Kong API Gateway | `opentelemetry` plugin (bundled) | `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` (patched by restore script) |
| Backend (Node.js) | `@opentelemetry/sdk-node` | `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` |
| ChatQnA (Python) | `opentelemetry-instrumentation-fastapi` | `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` |
| Retriever (Python) | `opentelemetry-instrumentation-fastapi` | `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` |
| Dataprep (Python) | `opentelemetry-instrumentation-fastapi` | `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` |
| Reranker (Python) | `opentelemetry-instrumentation-fastapi` | `${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` |

### Kong API Gateway (opentelemetry plugin)

Kong uses its bundled `opentelemetry` plugin (available since Kong 3.0) — no additional installation required.

**Configuration**: Defined in `api-gateway-solution/new-config/kong_config.json` as a global plugin (no `service` field), applied by the `kong-config` init container via `restore-kong-config.sh`.

```json
{
  "name": "opentelemetry",
  "enabled": false,
  "config": {
    "traces_endpoint": "http://otel-collector:4318/v1/traces",
    "resource_attributes": { "service.name": "kong-gateway" },
    "header_type": "w3c",
    "sampling_rate": 1.0
  }
}
```

**Conditional activation**: The plugin defaults to `enabled: false` in the declarative config (safe default). The `restore-kong-config.sh` script patches the plugin when `ENABLE_OBSERVABILITY=1`:
- `enabled=true` — activates the OTel plugin
- `config.traces_endpoint=${OTEL_EXPORTER_OTLP_ENDPOINT}/v1/traces` — aligns the Collector URL with other services (same `OTEL_EXPORTER_OTLP_ENDPOINT` variable)

**Trace propagation**: Kong injects the W3C `traceparent` header on outbound requests to upstreams. The backend and OPEA services read this header to create child spans, forming a single distributed trace.

**Kong tracing internals**: Kong's internal tracer is always active (`KONG_TRACING_INSTRUMENTATIONS=request` by default in docker-compose). This has negligible overhead when the OTel plugin is disabled — spans are created and garbage-collected within the request lifecycle. When `ENABLE_OBSERVABILITY=1`, the restore script enables the plugin, which exports these spans to the OTel Collector. Both `KONG_TRACING_INSTRUMENTATIONS` and `KONG_TRACING_SAMPLING_RATE` (default `1.0` = 100%) are overrideable via `.env` but should not need changing.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | OTLP Collector base URL — used by backend (Node.js), OPEA services (Python), and Kong (via restore script). All services append `/v1/traces` or `/v1/metrics` to this base. |
| `OTEL_TRACES_SAMPLER_RATE` | `100.0` | Trace sampling percentage (0.0-100.0) at Collector level |

The Collector resolves service names internally (e.g., `victoriametrics` → Docker service DNS).

## Deployment

The Collector is deployed as a Docker service:

```bash
# Docker Compose (with observability profile)
docker compose --profile observability up -d otel-collector

# Docker Swarm (with ENABLE_OBSERVABILITY=1)
ENABLE_OBSERVABILITY=1 docker stack deploy -c docker-compose.yaml genieai
```

In Swarm mode, the Collector runs in `mode: global` with no placement constraint, ensuring one Collector instance per node.

See `docker-compose.yaml` for the full service definition.

## Custom Application Metrics

In addition to the auto-instrumented metrics above, services expose **custom business metrics** via the OpenTelemetry Metrics API.

### Backend (Node.js)

The `metrics.js` module provides a `getMeter()` wrapper that returns a meter from the global `MeterProvider` (configured in `tracing.js`). The `metrics-middleware.js` Express middleware records:

- **`http_requests_total`** (counter): Total HTTP requests, attributes: `http.method`, `http.status_code`, `http.route`
- **`http_request_duration_seconds`** (histogram): Request duration, same attributes

```js
const { getMeter } = require('./metrics');
const metricsMiddleware = require('./middleware/metrics-middleware');
app.use(metricsMiddlewareFactory());
```

The middleware is registered in `index.js` after security middleware (helmet/cors) and before `body-parser` so parsing errors are also metered.

### Python OPEA Services (ChatQnA, Retriever, Dataprep, Reranker)

Each OPEA service imports `get_meter()` from the shared `tracing.py` module and creates service-specific instruments:

| Service | Counter | Histogram |
|---------|---------|-----------|
| ChatQnA | `genie.ai/chat/request` | `genie.ai/chat/rag/latency` |
| Retriever | `rag.retrieval.requests` | `rag.retrieval.duration` |
| Dataprep | `rag.ingestion.requests` | `rag.ingestion.duration` |
| Reranker | `rag.rerank.requests` | `rag.rerank.duration` |

```python
from tracing import get_meter
meter = get_meter()
requests = meter.create_counter("genie.ai/chat/request", description="Total chat requests")
duration = meter.create_histogram("genie.ai/chat/rag/latency", unit="s", description="Chat RAG latency")
```

### PII Enforcement

All metric attributes are filtered through a PII denylist. The following keys are **never** included in metric attributes:

`user_id`, `email`, `query_text`, `document_text`, `session_id`, `conversation_id`, `password`, `token`

### Metrics SDK Overhead

The metrics middleware adds <5ms overhead per request at P95. To disable metrics for benchmarking:

```bash
ENABLE_METRICS=false node index.js  # Disable metrics middleware
```

### Grafana Dashboard

The `application-metrics.json` dashboard provides pre-built panels for:
- HTTP request rate by route
- HTTP duration percentiles (P50/P95/P99)
- Chat RAG pipeline latency
- RAG sub-service latency (Retriever/Dataprep/Reranker)
- Error rate (5xx %, chat error rate)

## Future Considerations

### External GPU Endpoints

The OPEA services (ChatQnA, Retriever, Reranker, Dataprep) will eventually call **external GPU endpoints** (managed API, cloud GPU) instead of local vLLM/TEI instances. The services remain in the Swarm — only the inference backend changes.

**No observability infrastructure change is needed:**

- Services stay in the Swarm → fluentd driver and Collector still capture their logs
- OTel SDK already instruments outbound HTTP calls (`http.client.duration` metric)
- External endpoint latency, error rate, and throughput are traced at the **caller level** automatically
- If finer-grained external vs internal latency attribution is needed, add custom span attributes in the OPEA services (application-level, not infra)

### External Services (doclint_server, etc.)

Externalized services called by GENIE.AI follow the same pattern:

- Outbound calls FROM Swarm services are traced by OTel SDK's HTTP client instrumentation
- The external service's own internal logs/metrics are **not our responsibility** (outside our perimeter)
- What we can observe: request latency, error rate, throughput — from the caller's perspective

### Key Principle

> **We trace what crosses our perimeter at the caller level.** External service internals are their own observability concern.

## MELT Correlation Tests

End-to-end tests validating that the observability pipeline correctly correlates telemetry across all three Victoria* backends: **M**etrics, **E**vents/Logs, and **T**races.

### Prerequisites

- GENIE.AI stack running with `ENABLE_OBSERVABILITY=1`
- All services healthy: VictoriaTraces (:10428), VictoriaMetrics (:8428), VictoriaLogs (:9428), OTel Collector (:13133)
- Tests must run from inside the Docker network (all Victoria* ports are container-only)
- For Grafana tests: `GRAFANA_ADMIN_PASSWORD` set
- For Playwright tests: `TRACE_ID` set and Playwright installed
- For k6 overhead tests: k6 CLI installed
- For chaos tests: Docker socket access (Swarm manager or `docker compose`)

### Running Locally

From inside a container on the Docker network:

```bash
# All tests (correlation + Grafana + chaos + Playwright + k6)
npm run test:melt

# Only correlation test (fast, no external deps beyond Victoria*)
npm run test:melt:correlation

# Skip chaos (destructive — stops/restarts backends)
npm run test:melt -- --skip-chaos

# Skip Playwright (needs browser + Keycloak SSO)
npm run test:melt -- --skip-chaos --skip-playwright

# Individual tests
npm run test:melt:grafana        # Grafana datasource proxy verification
npm run test:melt:chaos          # Chaos resilience (stop/restart backends)
npm run test:melt:playwright     # Playwright E2E log search (needs TRACE_ID)
```

### Running in CI

GitLab CI runs MELT tests as **Scheduled tier** jobs (not on every push):

| Job | Stage | Condition | Description |
|-----|-------|-----------|-------------|
| `scheduled:melt-correlation` | scheduled | `ENABLE_OBSERVABILITY=1` | Correlation + Grafana (no chaos) |
| `scheduled:melt-chaos` | scheduled | `ENABLE_OBSERVABILITY=1` | Chaos resilience (stop/restart backends) |

Both jobs run after `scheduled:integration` (requires Docker stack + observability profile up).

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `KONG_URL` | `http://kong:8000` | Kong internal URL |
| `VICTORIATRACES_URL` | `http://victoriatraces:10428` | VictoriaTraces URL |
| `VICTORIAMETRICS_URL` | `http://victoriametrics:8428` | VictoriaMetrics URL |
| `VICTORIALOGS_URL` | `http://victorialogs:9428` | VictoriaLogs URL |
| `GRAFANA_URL` | `http://grafana:3000` | Grafana URL |
| `GRAFANA_ADMIN_USER` | `admin` | Grafana admin username |
| `GRAFANA_ADMIN_PASSWORD` | — | Grafana admin password (required for Task 2) |
| `PROPAGATION_DELAY` | `15` | Seconds to wait before querying backends |
| `RESTART_TIMEOUT` | `60` | Max seconds to wait for backend restart (chaos tests) |
| `OUTAGE_REQUESTS` | `3` | Number of requests during chaos outage |
| `TRACE_ID` | — | Known trace ID for Playwright test |
| `JUNIT_OUTPUT` | `reports/melt-*-report.xml` | JUnit XML output path |

### Expected Output

```
═══════════════════════════════════════════════════════════
  MELT Correlation Test Suite
  2026-06-05T14:30:00.000Z
═══════════════════════════════════════════════════════════

  ✅ AC8 — Prerequisites: all backends reachable (0.5s)
  ✅ AC1 — Known error generation with trace context (0.3s)
  ✅ AC2 — Trace ID in VictoriaTraces with span hierarchy (25.1s)
  ✅ AC2 — Error metric in VictoriaMetrics (0.8s)
  ✅ AC2 — Logs with trace_id in VictoriaLogs (0.6s)
  ✅ AC2 — Cross-backend correlation: same trace_id in all 3 backends (1.2s)

Results: 6/6 passed, 0 failed
JUnit report: reports/melt-correlation-report.xml
```

JUnit XML artifacts are collected by GitLab CI and displayed in merge request pipelines.

### Troubleshooting

**Service unreachable:** Ensure `ENABLE_OBSERVABILITY=1` and the observability profile is running (`docker compose --profile observability ps`). All Victoria* ports are container-only — tests must run from inside Docker.

**Trace not found in VictoriaTraces:** Propagation delay varies (5-15s). Increase `PROPAGATION_DELAY` to 20-30s for slow environments. Check OTel Collector health (`curl http://otel-collector:13133`).

**Grafana tests fail with 401:** Set `GRAFANA_ADMIN_PASSWORD` matching your `.env` value. Grafana requires basic auth for API access.

**Chaos tests leave backends stopped:** If the test is interrupted (Ctrl+C, timeout), backends may remain stopped. Run `docker compose start victoriatraces victorialogs` to restore.

**k6 overhead test skipped:** Install k6 CLI (`https://k6.io/docs/getting-started/installation/`). The test is optional — it only runs when `k6` is in PATH.
