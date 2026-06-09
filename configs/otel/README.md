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

## Retention Policies

Data retention is configurable per telemetry type via environment variables in `.env` (Section 12C):

| Variable | Default | Data Type | Notes |
|----------|---------|-----------|-------|
| `VICTORIAMETRICS_RETENTION` | `30d` | Metrics | Short retention due to high cardinality |
| `VICTORIALOGS_RETENTION` | `30d` | Logs | Can extend for compliance requirements |
| `VICTORIATRACES_RETENTION` | `30d` | Traces | Sampling rate (`OTEL_TRACES_SAMPLER_RATE`) controls volume |

**Recommendations:**
- Monitor storage usage via the Observability Stack Health dashboard
- Adjust retention vs disk capacity based on deployment needs
- For high-volume production, consider reducing trace retention or lowering sampling rate

## Alerting

Grafana-native alerting provides meta-monitoring for the observability stack itself ("who watches the watchers").

### Alert Rules

Four alert rules are provisioned in `configs/grafana/provisioning/alerting/alert-rules.yml`:

| Alert | Severity | Condition | Purpose |
|-------|----------|-----------|---------|
| OTel Collector Down | Critical | `rate(vm_rows_ingested_total[2m]) == 0` for 2m | Collector pipeline broken (proxy: VM receives zero rows) |
| VictoriaMetrics Storage High | Warning | `vm_free_disk_space_bytes < 1GB` for 5m | Storage filling up |
| VictoriaLogs Ingestion Drop | Warning | `rate(vm_rows_ingested_total{type="vlstorage"}[5m]) < 1` for 5m | Log pipeline broken |
| VictoriaTraces Export Failures | Warning | `rate(otelcol_exporter_send_failed_spans{...}[5m]) > 0` for 5m | Trace export errors |

### Alert Thresholds

Default thresholds are conservative (designed for early warning). Tune per deployment:

- **Collector Down**: Alerting on `noDataState` — fires if the metric disappears (Collector completely down)
- **Storage High**: 1GB free disk threshold — adjust based on total disk size
- **Ingestion drops**: Baseline-relative — adjust threshold based on expected throughput

### Contact Points

Alert notifications are routed via `configs/grafana/provisioning/alerting/contact-points.yml`:

- **Default**: Webhook endpoint (placeholder URL — configure via Grafana UI)
- Configure real endpoints via Grafana UI → Alerting → Contact points
- Or use Grafana env vars (`GF_ALERTING_...`) for runtime configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GRAFANA_ALERT_WEBHOOK_URL` | (empty) | Webhook URL for alert notifications (configure via Grafana UI) |
| `GRAFANA_ALERT_EMAIL` | (empty) | Email address for alert notifications (configure via Grafana UI) |

**Note:** These variables are optional documentation placeholders. Grafana provisioning YAML does not support env var substitution — configure actual values via the Grafana UI after deployment.

## Smoke Test

After deploying with `ENABLE_OBSERVABILITY=1`, verify the stack is healthy:

```bash
# Collector health (inside Docker network)
docker exec $(docker ps --format "{{.Names}}" | grep otel-collector | head -1) \
  curl -sf http://localhost:13133/health/status

# Grafana accessible (via Kong route, requires auth)
curl -sk -o /dev/null -w "HTTP %{http_code}" https://localhost/grafana/
```

## Integration Guide

Rules and patterns for adding OTel instrumentation to new services.

### Import Order (Critical)

OTel SDK monkey-patches modules at load time. The tracing module **must** be the very first import.

**Node.js (backend):**
```javascript
// index.js — FIRST line must be:
require('./tracing');
// Only then:
const express = require('express');
const cors = require('cors');
// ...
```

**Python (OPEA services):**
```python
# genieai_*.py — FIRST line must be:
from tracing import get_tracer, get_meter
# Only then:
from comps import ...
from fastapi import ...
```

Violating import order results in **no traces from that service** — the SDK cannot instrument modules loaded before it.

### Span Creation Pattern

Always wrap the actual work, not just metadata. Every span must handle errors:

**Node.js:**
```javascript
const span = tracer.startSpan('operation.name');
try {
  // Actual work here — not just attribute reads
  const result = await doRealWork();
  span.setAttribute('result.count', result.length);
  return result;
} catch (err) {
  span.recordException(err);
  span.setStatus({ code: SpanStatusCode.ERROR, message: err.message });
  throw err;
} finally {
  span.end();
}
```

**Python:**
```python
tracer = get_tracer(__name__)
with tracer.start_as_current_span("operation.name") as span:
    try:
        # Actual work here
        result = do_real_work()
        span.set_attribute("result.count", len(result))
        return result
    except Exception as e:
        span.record_exception(e)
        span.set_status(Status(StatusCode.ERROR, str(e)))
        raise
```

**Common mistakes (from Epic 7 retro):**
- ❌ `span.recordException(err)` without `span.setStatus(ERROR)` → span appears successful
- ❌ Span wrapping only attribute reads → ~0ms duration, useless telemetry
- ❌ Missing try/finally → span never ends on exception (memory leak in Python)

### Test Environment Guards

Tracing must be disabled in test environments to avoid affecting existing test suites:

**Node.js** (`tracing.js`): `if (process.env.NODE_ENV === 'test') { /* return no-ops */ }`
**Python** (`tracing.py`): No explicit test guard — relies on `OTEL_EXPORTER_OTLP_ENDPOINT` being unset in test environments (returns no-op tracer via `setup_tracing()` early return)

Both provide the same API shape (tracer, meter, shutdown) as no-op stubs.

### PII Redaction

Sensitive attributes are filtered by `PIIRedactionProcessor` (Node.js) and a denylist check (Python). Denylist keys: `password`, `token`, `secret`, `authorization`, `cookie`, `api_key`, `credit_card`, `ssn`.

When adding new span attributes, verify they don't contain PII. The denylist is in:
- Node.js: `components/gov-chat-backend/tracing-pii.js`
- Python: `genie-ai-overlay/tracing.py` (`PII_DENYLIST`)

### Metric Naming

Follow OTel semantic conventions. Use **route templates** to prevent cardinality explosion:

- ✅ `http.server.duration` with attribute `http.route: "/api/chat/:id"`
- ❌ `http.server.duration` with attribute `http.url: "/api/chat/abc123"` (cardinality explosion)

### Safe-Default Pattern

All observability features are **disabled by default**. Enable only when `ENABLE_OBSERVABILITY=1`:

- Node.js: SDK init guarded by env var check
- Python: SDK init guarded by env var check
- Kong: Plugin created disabled, conditionally enabled by `restore-kong-config.sh`
- Docker: Services use `profiles: [observability]`

This ensures zero runtime impact when observability is not enabled.

## Runtime Verification Protocol

Minimum verification requirements for infrastructure and observability stories.

### Infrastructure Stories (Collector, Databases, Proxies)

Every infrastructure story MUST include at least one **smoke test against a running service**:

| Check | Method |
|-------|--------|
| Collector health | `curl http://localhost:13133/health/status` |
| Metric ingestion | Query VictoriaMetrics: `curl http://localhost:8428/api/v1/query?query=up` |
| Log ingestion | Query VictoriaLogs: `curl http://localhost:9428/select/logsql/query -d 'query=*'` |
| Trace storage | Query VictoriaTraces: `curl http://localhost:10429/api/traces?service=backend` |
| Grafana datasource | Verify provisioning via Grafana API |

### Application Stories (Tracing, Metrics)

Application stories MUST verify:

| Check | Method |
|-------|--------|
| Span export | Unit test with `InMemorySpanExporter` verifying span attributes |
| Error handling | Test that exceptions produce spans with `status=ERROR` |
| Test isolation | Existing test suite passes with no regressions |
| PII check | Verify denylisted attributes are not exported |

### Deferred Verification

When runtime verification cannot be done in CI (requires GPU, running services), document:
1. What was verified (unit tests only)
2. What needs runtime verification (specific metrics, dashboards, alerts)
3. How to verify (exact curl commands or Grafana queries)

This prevents the "deferred forever" pattern seen in Epic 7.
