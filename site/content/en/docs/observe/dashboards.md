---
title: Dashboards
description: The pre-built Grafana dashboards auto-provisioned for GENIE.AI, across the General and Observability folders.
weight: 3
aliases:
  - /docs/observability/dashboards/
mode: reference
persona: deployer
owner: "docs-stewards"
last_reviewed: 2026-09-18
---

Grafana dashboards are **auto-provisioned** from
`configs/grafana/provisioning/dashboards/`, so a deployment gets a working set
the moment the stack starts — no manual import. The Grafana file provider has
`foldersFromFilesStructure: true`, so dashboards placed in a subdirectory land
in a folder named after that subdirectory.

The 9 dashboards are grouped into **two folders**:

- **General folder** — 5 service dashboards at the root of `dashboards/`. (The
  file provider creates no `application/` subdirectory, so these land in the
  default `General` folder.)
- **Observability folder** — 4 stack-health dashboards in `dashboards/observability/`.

## First time opening Grafana

> **You do this once after deploy.**

1. Browse to `https://<your-domain>/grafana/` (the Kong route at `/grafana/`).
2. Keycloak SSO redirects you to the realm login — sign in with your normal
   realm user (e.g. an `admin` realm role is required to see admin-only
   dashboards).
3. The default landing dashboard is **Service health** (set by
   `GF_DASHBOARDS_DEFAULT_HOME_DASHBOARD_PATH`).

> The local `GRAFANA_ADMIN_USER` / `GRAFANA_ADMIN_PASSWORD` form is a
> break-glass login (login form disabled by `GF_AUTH_DISABLE_LOGIN_FORM=true`).
> To enable it for emergency access, set `GF_AUTH_DISABLE_LOGIN_FORM=false` in
> `docker-compose.yaml` and restart Grafana.

## General folder — service dashboards

Operational views of the GENIE.AI services themselves.

| Dashboard | What it shows |
|---|---|
| **Service health** | Per-service up/down, replica count, error rate, request rate. The landing view for "is anything broken?". |
| **Application metrics** | Business and HTTP metrics: `http_requests_total`, `http_request_duration_seconds`, error rates, custom counters. |
| **Service logs** | Centralised log search across all services (VictoriaLogs). Pivot from a metric spike to the matching logs. |
| **Trace explorer** | Distributed-trace search (VictoriaTraces via the Jaeger datasource): filter by service, operation, duration, attribute. |
| **RAG pipeline trace waterfall** | A waterfall charting per-service latency across the RAG pipeline (backend, chatqna, retriever, reranker, dataprep), so the slow stage is immediately visible. |

[Screenshot placeholder — Service health overview]

## Observability folder — stack-health dashboards

Health of the observability stack itself — so the monitoring does not fail
silently.

| Dashboard | What it shows |
|---|---|
| **Observability stack health** | Collector up/down, ingestion rates, export errors across all three stores. Powered by the collector's self-telemetry (`otelcol_*`) and each Victoria store's self-metrics. |
| **VictoriaMetrics single-node** | VM ingestion rate, series count, cache hit rate, free disk. |
| **VictoriaLogs single-node** | VL ingestion rate, rows indexed, free disk. |
| **VictoriaTraces single-node** | VT trace ingestion rate, bytes ingested, free disk. |

[Screenshot placeholder — Observability stack health]

## Pivoting between dashboards

The dashboards share a common tag set (`service.name`, `service.namespace`,
component) so pivots work out of the box:

- A metric spike on **Application metrics** → the matching trace on
  **Trace explorer** (or **RAG pipeline trace waterfall** for chat queries).
- A trace span on **Trace explorer** → its logs on **Service logs** (by
  trace_id) or its metrics on **Application metrics** (by service name +
  time window).
- A panel showing "no data" on **Application metrics** → the
  **Observability stack health** dashboard to confirm the collector is still
  ingesting.

### How to actually pivot

Click any data point in a panel → **Inspect** or **Drilldown** → pick the
linked datasource (Jaeger, VictoriaLogs, or VictoriaMetrics). The tag set is
preserved so the linked query opens with the same service/namespace/time
window pre-filled.

## Empty panels — the most common new-deploy symptom

> **Empty panels usually mean the metric has not been emitted yet.** Send a few
> chat queries through the UI, then reload. If panels stay empty after an
> hour, check the **Observability stack health** dashboard for ingestion
> errors and the **Alerting** page for firing rules.

The backend metrics `http_requests_total` and `http_request_duration_seconds`
start at zero on a fresh deploy and only accumulate once Express middleware
has recorded requests.

## Customising

Dashboards are JSON files under `configs/grafana/provisioning/dashboards/`.
The Grafana file provider scans the directory every **30 seconds**
(`updateIntervalSeconds: 30` in `dashboards.yml`) — edits to the bind-mounted
JSON appear in Grafana without a restart. To add a net-new dashboard, drop a
JSON file in the folder (or a subdirectory for a custom folder); the
`dashboards.yml` provider picks it up on the next scan.

If your edit does not appear after a minute, the JSON is invalid — check
Grafana's container logs (`docker service logs genieai_grafana --tail 50`)
for parse errors.

### Adding a new dashboard

1. Export or author a JSON file matching the Grafana schema.
2. Save it under `configs/grafana/provisioning/dashboards/` (or a
   subdirectory to control the folder name).
3. Within 30 seconds it appears in Grafana → Dashboards → Manage.

## Next steps

Once dashboards look healthy, wire up alerting — see
[Alerting]({{< relref "alerting" >}}) for the built-in rules and how to add a
contact point.