---
title: Operations
description: Day-to-day operations for a running GENIE.AI deployment — backup and restore, updates, scaling, and troubleshooting.
weight: 11
slug: operations
---

[Deployment]({{< relref "/docs/deployment" >}}) gets GENIE.AI running; this section
keeps it running. It is for **operators and administrators** responsible for a
live deployment: backing up data, applying updates, scaling, and diagnosing
problems.

For real-time health, dashboards, and alerting, see
[Observability]({{< relref "/docs/observability" >}}) — this section assumes you
already have the observability stack on and are watching it.

## Pages in this section

- [Backup & restore]({{< relref "backup-restore" >}}) — ArangoDB dump/restore and
  Kong configuration restore.
- [Updates]({{< relref "updates" >}}) — updating models, service images, and the
  stack, including what requires re-ingestion.
- [Scaling]({{< relref "scaling" >}}) — scaling services and adjusting GPU
  resources.
- [Troubleshooting]({{< relref "troubleshooting" >}}) — common problems and where
  to look, with pointers to the deeper troubleshooting notes in the deployment
  guides.
