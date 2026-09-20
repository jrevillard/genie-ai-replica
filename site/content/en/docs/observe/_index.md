---
title: Observability
description: OpenTelemetry-native metrics, logs, and traces for the GENIE.AI stack — collection, storage, dashboards, and alerting.
weight: 30
slug: observability
aliases:
  - /docs/observability/
---

GENIE.AI is observable by default for production deployments: every application
service emits OpenTelemetry telemetry (metrics, logs, traces), which a central
collector funnels into a purpose-built storage trio and a Grafana front end. The
result is a single pane where operators can see service health, search logs,
trace a request end-to-end across the RAG pipeline, and get alerted before things
break.

The stack is **optional and disabled by default**. Enable it per deployment with
`ENABLE_OBSERVABILITY=1`.

## Architecture at a glance

```
App services (Node.js, Python/OPEA, Kong)
  │  OTLP traces/metrics ──┐
  │  fluentd logs ─────────┤
  ▼                        ▼
 OpenTelemetry Collector (mode: global — one per node)
   ├── VictoriaMetrics  (metrics)   ─┐
   ├── VictoriaLogs     (logs)       ├─ Grafana (Kong /grafana/, Keycloak SSO)
   └── VictoriaTraces   (traces)    ─┘
```

Three signals, three stores, one query layer. Each store is a single-node
Victoria* binary — operationally simple, no separate cluster to run.

## Cross-signal pivots

Traces, logs, and metrics share identifiers, so you can move between them in
either direction:

- **trace_id** on every log line touched by a request — see
  [Trace ↔ log correlation]({{< relref "tracing" >}}#trace-log-correlation).
- **service.name** on every log line (used as the dedup key for the
  cross-service admin/logs view).

## Pages in this section

- [Overview]({{< relref "overview" >}}) — the full stack, data flow, and how it
  is wired together.
- [Tracing]({{< relref "tracing" >}}) — W3C `traceparent` propagation, the RAG
  pipeline span taxonomy, and how a `trace_id` links traces and logs.
- [Dashboards]({{< relref "dashboards" >}}) — the pre-built Grafana dashboards
  (9 in total) and how to pivot between them.
- [Alerting]({{< relref "alerting" >}}) — built-in alert rules and what they
  catch.
- [Configuration]({{< relref "configuration" >}}) — environment variables,
  retention, sampling, and enabling/disabling the stack.

## Design principles

- **OpenTelemetry-native.** No vendor lock-in: the SDK, the wire format, and the
  collector are all OTel. Swapping a storage backend is a collector config
  change, not an instrumentation change.
- **Three signals, cleanly separated.** Metrics, logs, and traces each have their
  own store optimised for that signal, rather than one overloaded system.
- **PII-safe by construction.** Sensitive attributes (tokens, passwords, user
  PII) are filtered out of span attributes before export. See
  [Tracing]({{< relref "tracing" >}}).
- **One collector per node.** The collector runs in Docker Swarm `mode: global`
  so logs from every node (gateway, genieai, gpu) are collected regardless of
  where a service lands.
