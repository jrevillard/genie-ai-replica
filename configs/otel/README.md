# OTel Collector Configuration

## Overview

OpenTelemetry Collector configuration for the GENIE.AI observability stack.

The Collector receives telemetry from instrumented application services and exports metrics to VictoriaMetrics for visualization in Grafana.

## Architecture

```
Application Services (OTel SDK)
  → OTLP HTTP (:4318) → Collector → prometheusremotewrite → VictoriaMetrics (:8428)
                                                    → logging → stdout
```

## Configuration Files

| File | Purpose |
|------|---------|
| `otel-collector-config.yaml` | Main Collector configuration |

## Components

### Receivers
- **OTLP HTTP** (`:4318`) — Receives traces and metrics from application services via OTLP/HTTP protocol

### Processors
- **Batch** — Buffers telemetry before export (5s timeout, 1024 batch size)

### Exporters
- **prometheusremotewrite** — Exports Prometheus-compatible metrics to VictoriaMetrics at `http://victoriametrics:8428/api/v1/write`
- **logging** — Logs traces to collector stdout for debugging

### Extensions
- **health_check** (`:13133`) — Health check endpoint for Docker healthcheck

## Pipelines

| Pipeline | Flow |
|----------|------|
| metrics | otlp → batch → prometheusremotewrite |
| traces | otlp → batch → logging |

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

See `docker-compose.yaml` for the full service definition.
