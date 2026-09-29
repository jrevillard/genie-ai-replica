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

The result, end-to-end: **a single trace_id flows through every service a user
request touches** (see [Tracing]({{< relref "tracing" >}})), and the same
trace_id appears in the matching log lines.

## Layer 2 — Collection

The **OpenTelemetry Collector** is the hub. It runs in Docker Swarm
`mode: global` — one instance on every node — so it collects from every service
no matter where the scheduler places it.

What the collector receives:

| Source | Signal |
|---|---|
| Instrumented services (OTLP) | Traces and metrics. |
| Container stdout/stderr (Docker fluentd driver) | Logs. |
| Each Victoria store's own self-telemetry | Storage health. |
| The collector's own metrics | Pipeline health. |

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

1. The client request hits Kong.
2. Kong generates the trace context and passes it downstream — every service the
   request touches joins the same trace.
3. The backend creates spans for auth, the BFF handler, and the ArangoDB queries
   it issues directly.
4. The backend forwards the trace context to ChatQnA, which propagates it to
   each RAG stage (embedding, retriever, reranker, LLM, translation) — each
   emits a span under the same trace.
5. The collector batches and forwards traces to VictoriaTraces, metrics to
   VictoriaMetrics, and logs to VictoriaLogs.
6. The full trace is queryable in Grafana's *Trace explorer* and the *RAG pipeline
   trace waterfall* dashboard.

Because logs carry the same `trace_id`, you can pivot from any trace span
straight to the matching log lines in the *Service logs* dashboard — see
[Trace ↔ log correlation]({{< relref "tracing" >}}#trace-log-correlation) in
the Tracing page.
