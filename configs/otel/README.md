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

Traces are exported to VictoriaTraces via OTLP HTTP. VictoriaTraces stores distributed traces and provides Jaeger Query Service JSON APIs for Grafana integration.

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
- **probabilistic_sampler** — Controls trace sampling rate via `OTEL_TRACES_SAMPLER_RATE` env var (default: 1.0 = 100%)

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
| `OTEL_TRACES_SAMPLER_RATE` | `1.0` | Sampling rate (0.0 = 0%, 1.0 = 100%) |

**Examples:**
- `OTEL_TRACES_SAMPLER_RATE=1.0` — Store all traces (default, recommended for development)
- `OTEL_TRACES_SAMPLER_RATE=0.1` — Store 10% of traces (recommended for high-volume production)

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

**Note:** VictoriaTraces v0.9.1 only supports **protobuf** encoding for OTLP ingestion. JSON payloads are silently accepted (HTTP 200) but discarded. The OTel Collector uses protobuf by default.

**Note:** VictoriaTraces v0.9.1 only supports **protobuf** encoding for OTLP ingestion. JSON payloads are silently accepted (HTTP 200) but discarded. The OTel Collector uses protobuf by default.

## Customization

To add a new exporter:

1. Add the exporter configuration under `exporters:`
2. Add the exporter to the appropriate pipeline under `service.pipelines`

To change sampling:

1. Set `OTEL_TRACES_SAMPLER_RATE` env var on the otel-collector service in docker-compose.yaml
2. Values: 0.0 (no traces) to 1.0 (all traces)

## Instrumented Services

| Service | OTel SDK | Default Endpoint |
|---------|----------|-----------------|
| Backend (Node.js) | `@opentelemetry/sdk-node` | `http://otel-collector:4318` |
| ChatQnA (Python) | `opentelemetry-instrumentation-fastapi` | `http://otel-collector:4318` |
| Retriever (Python) | `opentelemetry-instrumentation-fastapi` | `http://otel-collector:4318` |
| Dataprep (Python) | `opentelemetry-instrumentation-fastapi` | `http://otel-collector:4318` |
| Reranker (Python) | `opentelemetry-instrumentation-fastapi` | `http://otel-collector:4318` |

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OTEL_TRACES_SAMPLER_RATE` | `1.0` | Trace sampling percentage (0.0-1.0) |

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
