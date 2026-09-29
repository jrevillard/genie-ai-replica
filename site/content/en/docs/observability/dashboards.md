---
title: Dashboards
description: The pre-built Grafana dashboards auto-provisioned for GENIE.AI, across application and observability folders.
weight: 3
---

Grafana dashboards are **auto-provisioned**, so a deployment gets a working
set of dashboards the moment the stack starts — no manual import. They are
grouped into two folders and there are 9 of them in total.

## Application folder

Operational views of the GENIE.AI services themselves.

| Dashboard | What it shows |
|---|---|
| **Service health** | Per-service up/down, replica count, error rate, request rate. The landing view for "is anything broken?". |
| **Application metrics** | Business and HTTP metrics: request rates, latency distributions, error rates, custom counters. |
| **Service logs** | Centralised log search across all services (VictoriaLogs). Filter by service, level, time range, or by `trace_id` to pivot from a trace into its log lines. |
| **Trace explorer** | Distributed-trace search (VictoriaTraces via the Jaeger datasource): filter by service, operation, duration, attribute. |
| **RAG pipeline trace waterfall** | A waterfall charting per-service latency across the RAG pipeline (backend, chatqna, retriever, reranker, dataprep), so the slow stage is immediately visible. |

## Observability folder

Health of the observability stack itself — so the monitoring does not fail
silently.

| Dashboard | What it shows |
|---|---|
| **Observability stack health** | Collector up/down, ingestion rates, export errors across all three stores. |
| **VictoriaMetrics single-node** | VM ingestion rate, series count, cache hit rate, free disk. |
| **VictoriaLogs single-node** | VL ingestion rate, rows indexed, free disk. |
| **VictoriaTraces single-node** | VT trace ingestion rate, bytes ingested, free disk. |

## Trace explorer ↔ Service logs

Two dashboards are the operator's main debugging pair. They share the same
`trace_id` field, so you can pivot between them in either direction:

- **Trace explorer → Service logs.** Open a span, copy its `trace_id`, and
  filter the *Service logs* dashboard on it. You get every log line produced
  by every service involved in that request, in order.
- **Service logs → Trace explorer.** Find a suspicious log row, copy the
  `trace_id`, and search for it in *Trace explorer*. You get the full
  distributed trace that produced the log.

This is the "I see an error, now what?" workflow — see
[Trace ↔ log correlation]({{< relref "tracing" >}}#trace-log-correlation) in
the Tracing page for the step-by-step recipe.

> **Pivoting across all dashboards.** The dashboards are designed to flow into
> each other: a service error on *Application metrics* → the offending
> requests on *Trace explorer* → the span's logs on *Service logs*. The
> collector's self-telemetry powers the *Observability stack health* view so
> you can trust what the other dashboards show.

## Customising

Dashboards are JSON files under `configs/grafana/provisioning/dashboards/`.
Edit the JSON and redeploy — Grafana picks up changes on restart (provisioning
is read at startup). To add a net-new dashboard, drop a JSON file in the
folder; the `dashboards.yml` provider picks it up automatically.
