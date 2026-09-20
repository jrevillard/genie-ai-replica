---
title: Operations
description: Day-to-day operations for a running GENIE.AI deployment — backup, restore, updates, scaling, troubleshooting, and operator-facing diagnostic surfaces.
weight: 20
slug: operations
aliases:
  - /docs/operations/
---

[Deployment]({{< relref "/docs/deploy" >}}) gets GENIE.AI running; this
section keeps it running. It is for **operators and administrators**
responsible for a live deployment: backing up data, applying updates,
scaling, and diagnosing problems.

For real-time health, dashboards, and alerting, see
[Observability]({{< relref "/docs/observe" >}}) — this section assumes
you already have the observability stack on and are watching it.

## Pages in this section

- [Backup & restore]({{< relref "backup-restore" >}}) — ArangoDB dump/restore
  and Kong configuration restore, including the network-name and password
  gotchas in the shipped scripts.
- [Updates]({{< relref "updates" >}}) — updating models, service images, and
  the stack; what forces re-ingestion; the rollback procedure.
- [Scaling]({{< relref "scaling" >}}) — horizontal replicas and vertical
  GPU memory; what scales well and what does not.
- [Troubleshooting]({{< relref "troubleshooting" >}}) — common problems,
  trace-first / logs-second methodology, and pointers to deeper notes.
- [Admin Logs]({{< relref "admin-logs" >}}) — the operator-facing Logs tab,
  the `/api/admin/logs/*` endpoints, the MELT seam, and the VL fallback
  configuration.
- [Ingestion Log]({{< relref "ingestion-log" >}}) — per-chunk ingestion
  progress feed, canonical messages, ArangoDB AQL access, and trace
  correlation.
- [Health Checks]({{< relref "health-checks" >}}) — `/api/health` and
  `/api/admin/system-health` endpoints, Docker Swarm healthcheck wiring,
  Kubernetes probe recipes, and failure-mode troubleshooting.
- [Security Hardening]({{< relref "security-hardening" >}}) — Helmet
  defaults, CORS, CSP, and rate-limiting configuration; per-service
  transport security knobs.
