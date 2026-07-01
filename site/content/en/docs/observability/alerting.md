---
title: Alerting
description: Built-in Grafana alert rules, notification policies, and contact points that guard the GENIE.AI stack.
weight: 4
---

Alerting is auto-provisioned alongside the dashboards, so a fresh deployment
already watches the failures that matter most: **the stack going silent, storage
filling up, the log pipeline breaking, and trace export failing**.

Three files under `configs/grafana/provisioning/alerting/` define the setup:

| File | Purpose |
|---|---|
| `alert-rules.yml` | The alert definitions (condition + for-duration). |
| `notification-policies.yml` | Which alerts route to which contact points, and grouping/escalation. |
| `contact-points.yml` | Where notifications are sent. The shipped default is a single webhook contact point; Slack/SMTP/PagerDuty are added per environment. |

## Built-in alert rules

The rules target the failure modes that would otherwise make the observability
stack *itself* lie to you.

| Alert | Catches |
|---|---|
| **Collector down / unhealthy** | The collector stopped scraping or exporting — the single most critical condition, since everything else depends on it. |
| **Storage filling up** | A Victoria store's free disk drops below threshold (`vm_free_disk_space_bytes`), before retention eviction or write failures. |
| **Log pipeline broken** | The fluent_forward receiver stops accepting log records (`otelcol_receiver_accepted`) — container logs are no longer reaching VictoriaLogs. |
| **Trace export failure** | VictoriaTraces reports HTTP errors on the trace insert endpoint (`/insert/opentelemetry/.../traces`). |
| **Trace ingestion anomaly** | Trace bytes ingested (`vt_bytes_ingested` for opentelemetry_traces) drops or spikes unexpectedly. |

Rules use short `for` windows (a few minutes) so alerts fire on real sustained
conditions, not transient blips.

## SLO-based alerting

Beyond stack-health, deployments can add SLO-based rules on the application
metrics exported by the backend (error rate, latency thresholds). These are
deployment-specific — add them to `alert-rules.yml` with the same provisioning
pattern.

## Notification routing

`notification-policies.yml` groups alerts (e.g. all *VictoriaMetrics* rules
together) and routes them to the contact points defined in
`contact-points.yml`. Configure the actual endpoints (Slack webhook, SMTP,
PagerDuty) per environment — do not commit real secrets to the provisioned files.

> **First thing to check on a fresh deploy.** After enabling observability,
> confirm the *Collector down* alert is **not** firing and that a test
> notification reaches your contact point. An alerting stack that cannot alert is
> worse than none.
