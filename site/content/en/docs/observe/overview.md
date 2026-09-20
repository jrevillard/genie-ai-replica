---
title: Stack Overview
description: How the observability stack is wired — telemetry emission, collection, the Victoria storage trio, and Grafana.
weight: 1
aliases:
  - /docs/observability/overview/
mode: explanation
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

The observability stack has four layers: **instrumentation** (in the apps),
**collection** (the OpenTelemetry Collector), **storage** (the Victoria trio),
and **presentation** (Grafana).

**Prerequisites:** enable the stack first — see
[Configuration]({{< relref "configuration" >}}) for the environment variables
and the `ENABLE_OBSERVABILITY=1` toggle. Everything below assumes observability
is already running.

> **Glossary.** OTLP = OpenTelemetry wire protocol (HTTP/protobuf). BFF =
> Backend-for-Frontend, the Node.js API layer. Prometheus metrics = the standard
> scrape-and-store metric format Grafana and VictoriaMetrics both speak.
> fluentd = a Docker log-forwarding driver that ships container stdout/stderr to
> a TCP collector.

## Layer 1 — Instrumentation

Every application service initialises the OpenTelemetry SDK and emits telemetry
through OTLP. Instrumentation helpers enforce one way to create spans (so PII
filtering and attribute conventions stay consistent across the codebase):

- **Node.js (backend, document-repository)** — `tracing.withSpan(name, fn)`.
  Never create spans via the global tracer directly.
- **Python (OPEA services)** — FastAPI auto-instrumentation is enabled globally
  in `setup_tracing()` (no per-endpoint decorator), and
  `with with_span(name, attributes={…}) as span:` is used for inner RAG-stage spans.

| Service | Language | What it emits |
|---|---|---|
| Backend (BFF) | Node.js | Express request spans, ArangoDB query spans, custom business spans, `http_requests_total` + `http_request_duration_seconds` metrics, OTel log records. |
| Document-repository | Node.js | Express spans + ingestion spans for upload/retract. |
| OPEA services (`chatqna`, `retriever`, `reranker`, `dataprep`, `embedding`) | Python | FastAPI auto-spans + manual spans `chatqna.orchestrate`, `chatqna.reranker_selection`, `retriever.hybrid_search`, `reranker.rerank`, `reranker.tei_invoke`, `dataprep.{ingest,retract,chunking}`, `dataprep.llm.label_chunk`, `dataprep.llm.label_batch`. |
| Kong gateway | Lua (OpenResty) | OTel plugin emits a `request` span per proxied call (HTTP method, route, status). The collector renames `kong` to `METHOD /path` — see [Tracing]({{< relref "tracing" >}}). |

See [Tracing]({{< relref "tracing" >}}) for the full span taxonomy.

## Layer 2 — Collection

The **OpenTelemetry Collector** is the hub. It runs in Docker Swarm
`mode: global` — one instance on every node — so it collects from every service
no matter where the scheduler places it. **You do not need to do anything for
collector placement** — the stack already runs one collector per Swarm node.

`configs/otel/otel-collector-config.yaml` defines the pipeline:

### Application traffic (what the apps feed in)

| Receiver | Port | Ingests |
|---|---|---|
| `otlp` (HTTP) | 4318 | Traces, metrics, and OTLP-formatted logs from instrumented app services. |
| `fluent_forward` | 24224 | Container stdout/stderr (Docker `fluentd` logging driver). |

### Self-telemetry (so the monitoring does not fail silently)

| Receiver | Port | Scrapes |
|---|---|---|
| `prometheus/victoriametrics_internal` | 8428 | VictoriaMetrics self-metrics (`vm_*`). |
| `prometheus/victorialogs_internal` | 9428 | VictoriaLogs self-metrics (`vl_*`). |
| `prometheus/victoriatraces_internal` | 10428 | VictoriaTraces self-metrics (`vt_*`). |
| `prometheus/collector_self` | 8888 | The collector's own `otelcol_*` metrics. |

### Exporters

| Exporter | Destination |
|---|---|
| VictoriaMetrics (remote write) | Metrics pipeline. |
| VictoriaLogs (OTLP HTTP) | Logs pipeline. |
| VictoriaTraces (OTLP HTTP) | Traces pipeline. |

### Pipelines (in order)

- **Metrics** — `otlp` + `prometheus/collector_self` + `prometheus/{vm,vl,vt}_internal` → `batch` → `prometheusremotewrite`.
- **Traces** — `otlp` → `probabilistic_sampler` → `transform/kong_span_names` → `batch` → `otlp_http/victoriatraces`.
- **Logs** — `otlp` + `fluent_forward` → `batch` → `otlp_http`.

> **Kong span rename.** Kong's OTel plugin hardcodes the span name as `kong`.
> The collector's `transform/kong_span_names` processor renames it to
> `METHOD /path` (e.g. `POST /api/chat`) using the `http.method` and
> `http.route` attributes. Searching by the original name `kong` will return
> nothing.

Docker dual-logging (20.10+) keeps `docker logs` working alongside the fluentd
driver.

## Layer 3 — Storage (the Victoria trio)

Three single-node binaries, each tuned for one signal:

| Store | Signal | Default retention |
|---|---|---|
| **VictoriaMetrics** | Metrics | `VICTORIAMETRICS_RETENTION` (30d) |
| **VictoriaLogs** | Logs | `VICTORIALOGS_RETENTION` (30d) |
| **VictoriaTraces** | Traces | `VICTORIATRACES_RETENTION` (30d) |

Single-node mode keeps operations simple (no distributed cluster) while scaling
well for a single-deployment workload. VictoriaLogs is always-on (admin
endpoints depend on it); VictoriaMetrics, VictoriaTraces, tempo-proxy, and
Grafana are gated by `ENABLE_OBSERVABILITY=1`.

## Layer 4 — Presentation (Grafana)

Grafana is the query and visualisation layer. It is **not exposed on a host
port** — it is reached through the Kong gateway at `/grafana/`, authenticated
with Keycloak OIDC SSO.

- **Datasources** (auto-provisioned): VictoriaMetrics, VictoriaLogs,
  VictoriaTraces (as a Jaeger-compatible datasource). The Logs datasource uses
  the `victoriametrics-logs-datasource` plugin (pre-installed at startup).
- **Dashboards**: 9 pre-built dashboards across the **General** folder (5 root
  service dashboards) and the **Observability** folder (4 stack-health
  dashboards). See [Dashboards]({{< relref "dashboards" >}}).
- **Alerting**: rules + notification policies + contact points, auto-provisioned.
  See [Alerting]({{< relref "alerting" >}}).

## Data flow for one user query

```
1. Client → Kong (root span, injects traceparent)
2. Kong → Backend BFF (auth + handler spans, ArangoDB spans)
3. Backend → ChatQnA (chatqna.orchestrate span)
4. ChatQnA → Embedding / Retriever (retriever.hybrid_search) /
             Reranker (reranker.rerank + reranker.tei_invoke) /
             LLM (FastAPI auto-span) / Translation (FastAPI auto-span)
5. Every span is OTLP-exported to the Collector
6. Collector → VictoriaTraces (OTLP HTTP), VictoriaMetrics (remote write),
              VictoriaLogs (OTLP HTTP)
7. Grafana queries the Victoria stores via the provisioned datasources
```

The same collector instance is also receiving that service's logs (fluentd) and
metrics (OTLP), so for any span you can pivot to the matching logs and metrics
in the same window.

### Verify it works

After enabling observability, send one chat query through the UI. Then in
Grafana:

1. Browse to `https://<your-domain>/grafana/` (Keycloak SSO logs you in).
2. Open **Explore** → choose the **Jaeger** datasource → set service to
   `backend` and lookback to `1h`. At least one trace should appear within a
   minute of the chat query.
3. If **empty**: open the **Observability stack health** dashboard — the
   *Collector down* alert (if firing) or the `otelcol_receiver_accepted_*`
   rate charts tell you which pipeline broke. See
   [Alerting]({{< relref "alerting" >}}).