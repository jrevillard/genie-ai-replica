---
title: Dashboards
description: The pre-built Grafana dashboards auto-provisioned for GENIE.AI, across application and infrastructure folders.
weight: 3
---

Grafana dashboards are **auto-provisioned** from `configs/grafana/provisioning/`,
so a deployment gets a working set of dashboards the moment the stack starts — no
manual import. They are grouped into two folders.

## Application folder

Operational views of the GENIE.AI services themselves.

| Dashboard | What it shows |
|---|---|
| **Service health** | Per-service up/down, replica count, error rate, request rate. The landing view for "is anything broken?". |
| **Application metrics** | Business and HTTP metrics: request rates, latency distributions, error rates, custom counters. |
| **Service logs** | Centralised log search across all services (VictoriaLogs). Pivot from a metric spike to the matching logs. |
| **Trace explorer** | Distributed-trace search (VictoriaTraces via the Jaeger datasource): filter by service, operation, duration, attribute. |
| **RAG pipeline trace waterfall** | A waterfall tuned to the RAG stages (embed → retrieve → rerank → generate → translate), so per-stage latency is immediately visible. |

## Observability folder

Health of the observability stack itself — so the monitoring does not fail
silently.

| Dashboard | What it shows |
|---|---|
| **Observability stack health** | Collector up/down, ingestion rates, export errors across all three stores. |
| **VictoriaMetrics single-node** | VM ingestion rate, series count, cache hit rate, free disk. |
| **VictoriaLogs single-node** | VL ingestion rate, rows indexed, free disk. |
| **VictoriaTraces single-node** | VT trace ingestion rate, bytes ingested, free disk. |

> **Pivoting.** The dashboards are designed to flow into each other: a service
> error on *Application metrics* → the offending requests on *Trace explorer* →
> the span's logs on *Service logs*. The collector's self-telemetry powers the
> *Observability stack health* view so you can trust what the other dashboards
> show.

## Customising

Dashboards are JSON files under
`configs/grafana/provisioning/dashboards/`. Edit the JSON and redeploy — Grafana
picks up changes on restart (provisioning is read at startup). To add a net-new
dashboard, drop a JSON file in the folder; the `dashboards.yml` provider picks it
up automatically.
