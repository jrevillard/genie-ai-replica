# OTel Collector Configuration

## Overview

OpenTelemetry Collector configuration for the GENIE.AI observability stack.

The Collector receives telemetry from instrumented application services and exports metrics to VictoriaMetrics for visualization in Grafana. Container logs are received via Docker's fluentd logging driver and forwarded to VictoriaLogs.

## Architecture

```
Application Services (OTel SDK)
  → OTLP HTTP (:4318) → Collector → prometheusremotewrite → VictoriaMetrics (:8428)
                                                    → debug → stdout

Docker Container Logs (fluentd logging driver)
  → fluent_forward (:24224) → Collector → otlp/http → VictoriaLogs (:9428)
```

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

**Security**: The Collector binds port 24224 to `127.0.0.1` only (no external access). In Docker Swarm, the Collector runs in `mode: global` with placement constraint `node.labels.genieai == true`, so every application node has a local Collector instance.

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

### Exporters
- **prometheusremotewrite** — Exports Prometheus-compatible metrics to VictoriaMetrics at `http://victoriametrics:8428/api/v1/write`
- **otlp/http** — Exports logs to VictoriaLogs at `http://victorialogs:9428/insert/opentelemetry/v1/logs`
- **debug** — Logs traces to collector stdout for debugging

### Extensions
- **health_check** (`:13133`) — Health check endpoint for Docker healthcheck

## Pipelines

| Pipeline | Flow |
|----------|------|
| metrics | otlp → batch → prometheusremotewrite |
| traces | otlp → batch → debug |
| logs | fluent_forward → batch → otlp/http |

## Customization

To add a new exporter (e.g., Jaeger for trace storage):

1. Add the exporter configuration under `exporters:`
2. Add the exporter to the appropriate pipeline under `service.pipelines`

To add sampling:

1. Add a `probabilistic_sampler` or `tail_sampling` processor
2. Insert it in the processor chain before `batch`

## Instrumented Services

| Service | OTel SDK | Default Endpoint |
|---------|----------|-----------------|
| Backend (Node.js) | `@opentelemetry/sdk-node` | `http://otel-collector:4318` |
| ChatQnA (Python) | `opentelemetry-instrumentation-fastapi` | `http://otel-collector:4318` |
| Retriever (Python) | `opentelemetry-instrumentation-fastapi` | `http://otel-collector:4318` |
| Dataprep (Python) | `opentelemetry-instrumentation-fastapi` | `http://otel-collector:4318` |
| Reranker (Python) | `opentelemetry-instrumentation-fastapi` | `http://otel-collector:4318` |

## Environment Variables

No environment variables required. Configuration is file-based.

The Collector resolves service names internally (e.g., `victoriametrics` → Docker service DNS).

## Deployment

The Collector is deployed as a Docker service:

```bash
# Docker Compose (with observability profile)
docker compose --profile observability up -d otel-collector

# Docker Swarm (with ENABLE_OBSERVABILITY=1)
ENABLE_OBSERVABILITY=1 docker stack deploy -c docker-compose.yaml genieai
```

In Swarm mode, the Collector runs in `mode: global` with placement constraint `node.labels.genieai == true`, ensuring one Collector instance per application node.

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
