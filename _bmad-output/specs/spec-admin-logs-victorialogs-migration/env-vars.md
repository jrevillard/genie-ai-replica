# Environment Variables

Catalog of every env var introduced or touched by the migration. Add to `tests/config-validator/validators/{parse-env.js,validate-features.js}` coverage so CI `config:validate` enforces presence.

## New vars (added across phases)

| Variable | Default | Phase | Purpose |
|---|---|---|---|
| `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT` | `http://otel-collector:4318/v1/logs` | P0 | OTel logs egress; D6 routes via Collector. Direct VL is allowed only as env override. |
| `VICTORIALOGS_URL` | `http://victorialogs:9428` | P0 | VL base URL for `VictoriaLogsClient`. |
| `VICTORIALOGS_TENANT_ID` | `0:0` | P1b | Tenant header for VL `/select/logsql/*` — passed as `AccountID: 0`, `ProjectID: 0` headers (VL 1.50+ canonical). `0:0` = default tenant. |
| `VL_QUERY_TIMEOUT_MS` | `30000` | P1b | axios timeout for `VictoriaLogsClient.query` / `.hits`. Raised for 7-day security scans. |
| `LOG_TO_VICTORIALOGS` | `1` | P1a | Enables the `VictoriaLogsTransport` in `components/shared/lib/logger.js`. Required alongside `ENABLE_OBSERVABILITY=1`. **Boolean coercion: any of `1`, `true`, `TRUE`, `yes` activates the transport.** |
| `LOG_TO_FILE` | `0` | P4 | Enables Winston `DailyRotateFile` + tailable `File` transports. Escape hatch for first 30 days post-cutover. |
| `ADMIN_LOGS_SOURCE` | `victorialogs` (after first release) | P2 | D2 fallback switch — permanent escape hatch. `file` activates the legacy LogsService file code path with no restart. **LogsService reads this env per-call, not at module load**, so the switch takes effect without restart. |
| `MELT_PROVIDER` | `victorialogs` | P1b | MELT backend selector (single implementation today). Whitelisted in `tests/config-validator/`. |
| `VL_FAIL_OPEN` | `false` | P2 | When `true`, VL 5xx / ECONNREFUSED / ENOTFOUND / timeout returns `{logs:[], degraded:true}` instead of surfacing 500 to admin. **Pre-P2 deploys: no-op + warn log (rolled back via revert MR; no consumers yet).** |
| `SECURITY_SCAN_BACKEND` | `victorialogs` | P3 | Falls back to `worker_threads` file scan if set to `file`. Permanent escape hatch. |

## npm dependency split (Q-1 resolved)

Per AD-18 + the component-boundary rule from `project-context.md`, OTel deps are split:

| Package | `components/shared/lib/package.json` | `components/gov-chat-backend/package.json` | `components/document-repository/package.json` |
|---|---|---|---|
| `@opentelemetry/api` | peer-dep (already) | `0.221.0` | `0.221.0` |
| `@opentelemetry/api-logs` | `0.221.0` (peer optional) | `0.221.0` | `0.221.0` |
| `@opentelemetry/sdk-logs` | — | `0.221.0` | `0.221.0` |
| `@opentelemetry/exporter-logs-otlp-http` | — | `0.221.0` | `0.221.0` |

`victorialogs-transport.js` (in shared/lib) requires only `@opentelemetry/api-logs` (the thin wrapper). Heavy SDK + exporter live per-component for local init control (resource attributes, processor chain, batch config per AD-18).

## Pre-existing vars (touched but semantics changed)

| Variable | Default | Phase | Purpose / change |
|---|---|---|---|
| `VICTORIALOGS_RETENTION` | `30d` | P0 | Already in `env:674` (commented) + `docker-compose.yaml:1755` + `deploy/ansible/templates/env.j2:229`. Aligned with existing Winston 30d rotation. No change. |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | `http://otel-collector:4318` | P0 | Already in `env:681` (commented) + `docker-compose.yaml:571`. Logs use `/v1/logs` suffix (new `OTEL_EXPORTER_OTLP_LOGS_ENDPOINT`); traces + metrics keep base URL. |
| `ENABLE_OBSERVABILITY` | `0` (cloud) / `1` (default) | P0 | Now gates the dashboard stack (Metrics / Traces / Grafana). VL + Collector are core (always on); `LOG_TO_VICTORIALOGS=1` is still gated on `ENABLE_OBSERVABILITY=1`. When gated-off, a new Prometheus counter `log_record_dropped_total{reason="observability_disabled"}` increments per emit so operators can distinguish outage from policy. |

## `env` file layout

Add commented templates under existing Section 12C (around `:666-682`) — see the **New vars** table above for the full list. Each `env.j2` rendering uses `{{ var | default('…') }}` with the table defaults.

## Ansible render (P0)

`deploy/ansible/templates/env.j2` after `:239` (unconditional — outside the `{% if enable_observability == "1" %}` guard):

```jinja
VICTORIALOGS_URL={{ victorialogs_url | default('http://victorialogs:9428') }}
VICTORIALOGS_TENANT_ID={{ victorialogs_tenant_id | default('0:0') }}
VL_QUERY_TIMEOUT_MS={{ vl_query_timeout_ms | default('30000') }}
OTEL_EXPORTER_OTLP_LOGS_ENDPOINT={{ otel_exporter_otlp_logs_endpoint | default('http://otel-collector:4318/v1/logs') }}
LOG_TO_VICTORIALOGS={{ log_to_victorialogs | default('1') }}
```

**Cloud caveat**: with `enable_observability=0` (cloud deployment), `LOG_TO_VICTORIALOGS` renders as `1` but the AND-gate in `logger.js` suppresses emission. The Prometheus counter `log_record_dropped_total{reason="observability_disabled"}` exposes this state.

`deploy/ansible/group_vars/all.yml` and `cloud_deploy/vars.yml` — no change to `enable_observability: "0"`. The var still gates the dashboard stack; VL is compose-only.