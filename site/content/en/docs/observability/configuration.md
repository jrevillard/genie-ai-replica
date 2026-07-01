---
title: Configuration
description: Environment variables, retention, sampling, and how to enable or disable the GENIE.AI observability stack.
weight: 5
---

The observability stack is **disabled by default**. Enabling it is a single
environment variable, but a handful of related variables control access,
retention, and sampling.

## Enabling

| Variable | Default | Notes |
|---|---|---|
| `ENABLE_OBSERVABILITY` | `0` | **Must be `0` or `1`** (not `true`/`false`). Swarm mode reads this to place the stack. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | OTLP base URL all instrumented services export to. Override only for an external collector. |

How it is enabled per deployment mode:

- **Docker Compose** — `docker compose --profile observability up -d`
- **Docker Swarm** — `ENABLE_OBSERVABILITY=1` in `.env`
- **Ansible** — `enable_observability: "1"` in `group_vars/all.yml`

## Sampling

| Variable | Default | Notes |
|---|---|---|
| `OTEL_TRACES_SAMPLER_RATE` | 100.0 | Trace sampling percentage. Lower for high-volume prod; raise when diagnosing. Metrics and logs are not sampled. |
| `KONG_TRACING_SAMPLING_RATE` | 1.0 | Kong trace sampling rate (0–1), aligned with `OTEL_TRACES_SAMPLER_RATE`. |
| `KONG_TRACING_INSTRUMENTATIONS` | `request` | Kong tracing instrumentations. Negligible overhead when the OTel plugin is disabled. |

## Retention

Each Victoria store keeps data for a configurable window; lower it to save disk,
raise it for longer historical analysis.

| Variable | Default |
|---|---|
| `VICTORIAMETRICS_RETENTION` | 30d |
| `VICTORIALOGS_RETENTION` | 30d |
| `VICTORIATRACES_RETENTION` | 30d |

## Grafana access

Grafana is served behind the Kong gateway at `/grafana/` (no direct host port)
with Keycloak OIDC SSO.

| Variable | Default | Notes |
|---|---|---|
| `GRAFANA_PORT` | 3002 | Host port (avoids a backend port conflict). |
| `GRAFANA_ADMIN_USER` | admin | Local admin username. |
| `GRAFANA_ADMIN_PASSWORD` | _(required when enabled)_ | Local admin password. |
| `KC_GRAFANA_CLIENT_ID` | grafana | Keycloak OIDC client id for Grafana SSO. |
| `KC_GRAFANA_CLIENT_SECRET` | _(required when enabled)_ | Keycloak OIDC client secret. |

> **SSO is the intended access path.** The local admin is a break-glass account;
> day-to-day access goes through Keycloak, so access is governed by the same
> identity provider as the rest of the platform.

## Collector placement

The collector runs in Docker Swarm `mode: global` with **no node placement
constraint**, so one collector runs on **every** node (gateway, genieai, gpu).
This guarantees all container logs are collected regardless of where a service
lands. The collector's fluent_forward receiver (port 24224) is bound to localhost
only.

## Disabling

Set `ENABLE_OBSERVABILITY=0` (Swarm) or omit the `observability` profile
(Compose). Application services continue to run; they simply attempt to export to
a collector that is not there, which OTel handles gracefully (telemetry is
dropped, not buffered indefinitely).

## Config file locations

| Artifact | Path |
|---|---|
| Collector config | `configs/otel/otel-collector-config.yaml` |
| Grafana datasources | `configs/grafana/provisioning/datasources/` |
| Grafana dashboards | `configs/grafana/provisioning/dashboards/` |
| Grafana alerting | `configs/grafana/provisioning/alerting/` |
| OTel integration guide | `configs/otel/README.md` |
