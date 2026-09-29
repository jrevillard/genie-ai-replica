---
title: Alerting
description: Built-in Grafana alert rules, notification policies, and contact points that guard the GENIE.AI stack.
weight: 4
---

Alerting is auto-provisioned alongside the dashboards, so a fresh deployment
already watches the failures that matter most: **the stack going silent, storage
filling up, the log pipeline breaking, and trace export failing**.

## Built-in alert rules

The rules target the failure modes that would otherwise make the observability
stack *itself* lie to you.

| Alert | Catches |
|---|---|
| **OTel Collector pipeline down** | The collector stopped ingesting data into VictoriaMetrics for over 2 minutes — the single most critical condition, since everything else depends on it. |
| **VictoriaMetrics storage high** | The metrics store's free disk drops below 1 GB, before retention eviction or write failures. |
| **VictoriaLogs ingestion drop** | Container logs are no longer reaching the fluentd receiver at the expected rate — the log pipeline is broken. |
| **VictoriaTraces export failures** | The collector is failing to send traces to VictoriaTraces (HTTP errors on the insert endpoint). |
| **VictoriaTraces ingestion drop** | No spans are reaching the collector's OTLP receiver for 5 minutes — trace sources are down or misconfigured. |
| **Log metadata stamping broken** | The collector is no longer stamping the `service.name` field on container logs, or has not processed any in 15 minutes. Every log line will then have empty `service.name` in VictoriaLogs — admin/logs filtering and the cross-service dedup key stop working. |
| **PII redaction broken** | The PII redaction stage in the collector is dropping records or has not processed any in 15 minutes. Sensitive fields may leak into VictoriaLogs unredacted. |

Rules use short `for` windows (a few minutes) so alerts fire on real sustained
conditions, not transient blips.

## SLO-based alerting

Beyond stack-health, deployments can add SLO-based rules on the application
metrics exported by the backend (error rate, latency thresholds). These are
deployment-specific — add them to `alert-rules.yml` alongside the built-in
rules, in the same format.

## Notification routing

Notifications are sent to the contact points defined in `contact-points.yml`
(Slack, SMTP, PagerDuty, …). `notification-policies.yml` groups alerts (e.g.
all *VictoriaMetrics* rules together) and decides which contact point each
group reaches. Configure the actual endpoints per environment — do not commit
real secrets to the provisioned files.

> **First thing to check on a fresh deploy.** After enabling observability,
> confirm the *OTel Collector pipeline down* alert is **not** firing and that
> a test notification reaches your contact point. An alerting stack that
> cannot alert is worse than none.
