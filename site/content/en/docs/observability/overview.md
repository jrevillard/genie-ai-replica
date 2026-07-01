---
title: Stack Overview
description: How the observability stack is wired — telemetry emission, collection, the Victoria storage trio, and Grafana.
weight: 1
---

The observability stack has four layers: **instrumentation** (in the apps),
**collection** (the OpenTelemetry Collector), **storage** (the Victoria trio),
and **presentation** (Grafana).

## Layer 1 — Instrumentation

Each application service initialises the OpenTelemetry SDK and emits telemetry
through the standard OTLP protocol.

| Service | Language | What it emits |
|---|---|---|
| Backend (BFF) | Node.js | Express request spans, ArangoDB query spans, custom business spans, Prometheus metrics. |
| OPEA services | Python | FastAPI spans, per-RAG-stage spans (retrieval, reranking, labelling…), service logs. |
| Kong gateway | Lua | OTel plugin forwards request traces. |

Instrumentation helpers enforce a single way to create spans (so attributes and
PII filtering stay consistent):

- **Node.js** — `tracing.withSpan(name, fn)`. Never create spans via the global
  tracer directly.
- **Python** — FastAPI auto-instrumentation (enabled globally in `setup_tracing()`, no per-endpoint decorator), and `with_span(name, ...)` for inner RAG-stage spans.

See [Tracing]({{< relref "tracing" >}}) for the span taxonomy.

## Layer 2 — Collection

The **OpenTelemetry Collector** is the hub. It runs in Docker Swarm
`mode: global` — one instance on every node — so it collects from every service
no matter where the scheduler places it.

`configs/otel/otel-collector-config.yaml` defines its pipeline:

| Receiver | Port | Ingests |
|---|---|---|
| `otlp` (HTTP) | 4318 | Traces and metrics from instrumented app services. |
| `fluentforward` | 24224 | Container stdout/stderr logs (Docker `fluentd` logging driver). |
| `prometheus/victoriametrics_internal` | 8428 | VictoriaMetrics self-telemetry. |
| `prometheus/victorialogs_internal` | 9428 | VictoriaLogs self-telemetry. |
| `prometheus/victoriatraces_internal` | 10428 | VictoriaTraces self-telemetry. |
| `prometheus/collector_self` | 8888 | The collector's own otelcol_* metrics. |

| Exporter | Destination |
|---|---|
| VictoriaMetrics (remote write) | Metrics. |
| VictoriaLogs (OTLP HTTP) | Logs. |
| VictoriaTraces (OTLP HTTP) | Traces. |

The traces pipeline includes a **probabilistic sampler** and a **batch** processor
before export. Docker dual-logging (20.10+) keeps `docker logs` working alongside
the fluentd driver.

> **Self-telemetry.** The collector also scrapes each Victoria store's own
> metrics, so the health of the observability stack itself is observable — see
> the *Observability stack health* dashboard.

## Layer 3 — Storage (the Victoria trio)

Three single-node binaries, each tuned for one signal:

| Store | Signal | Default retention |
|---|---|---|
| **VictoriaMetrics** | Metrics | `VICTORIAMETRICS_RETENTION` (30d) |
| **VictoriaLogs** | Logs | `VICTORIALOGS_RETENTION` (30d) |
| **VictoriaTraces** | Traces | `VICTORIATRACES_RETENTION` (30d) |

Single-node mode keeps operations simple (no distributed cluster) while scaling
well for a single-deployment workload.

## Layer 4 — Presentation (Grafana)

Grafana is the query and visualisation layer. It is **not exposed on a host
port** — it is reached through the Kong gateway at `/grafana/`, authenticated
with Keycloak OIDC SSO.

- **Datasources** (auto-provisioned): VictoriaMetrics, VictoriaLogs,
  VictoriaTraces (as a Jaeger-compatible datasource).
- **Dashboards**: 9 pre-built dashboards across two folders. See
  [Dashboards]({{< relref "dashboards" >}}).
- **Alerting**: rules + notification policies + contact points, auto-provisioned.
  See [Alerting]({{< relref "alerting" >}}).

## Data flow for one user query

1. The client request hits Kong (span: `request`).
2. Kong propagates a `traceparent` header to the backend.
3. The backend creates spans for auth, the BFF handler, and the ArangoDB queries
   it issues directly.
4. The backend forwards `traceparent` to ChatQnA, which propagates it to each RAG
   stage (embedding, retriever, reranker, LLM, translation) — each emits a span
   under the same trace.
5. Every span is OTLP-exported to the collector, which batches and forwards it to
   VictoriaTraces.
6. The full trace is queryable in Grafana's *Trace explorer* and the *RAG pipeline
  trace waterfall* dashboard.

The same collector instance is also receiving that service's logs (fluentd) and
metrics (OTLP), so for any span you can pivot to the matching logs and metrics in
the same window.
