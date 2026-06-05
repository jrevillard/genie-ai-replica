---
baseline_commit: fe8ff6a5faf56d3c76b4d5b7f9df33aff1b70d7f
---
# Story 7.9: Kong OTel Tracing

Status: review

## Story

As a developer,
I want the Kong API gateway instrumented with OpenTelemetry tracing,
so that distributed traces cover the full request path from gateway through backend to OPEA services.

## Acceptance Criteria

1. **AC1 — OTel Plugin Activation**: Kong `opentelemetry` plugin is configured and emits spans for each proxied request with `service.name = "kong-gateway"`
2. **AC2 — Span Attributes**: Spans include gateway-specific attributes: `kong.route`, `kong.consumer`, `http.method`, `http.status_code`
3. **AC3 — Trace Propagation**: Kong propagates the W3C `traceparent` header to upstream services (backend); traces flow: Kong → Backend → OPEA services sharing a single `trace_id`
4. **AC4 — OTLP Export**: Kong exports traces via OTLP HTTP to the OTel Collector at `http://otel-collector:4318/v1/traces` (same endpoint as other services)
5. **AC5 — Plugin Compatibility**: Existing Kong plugins (prometheus, rate-limiting, cors, file-log, request-transformer) continue to function without modification
6. **AC6 — Latency Overhead**: Instrumentation adds < 2ms latency overhead per request at the gateway level
7. **AC7 — Conditional Activation**: OTel tracing is active only when `ENABLE_OBSERVABILITY=1` (matches existing stack gating)
8. **AC8 — Trace Waterfall Visibility**: Authentication and rate limiting spans are visible in the trace waterfall in VictoriaTraces/Grafana

## Tasks / Subtasks

- [x] Task 1 — Add Kong `opentelemetry` plugin to declarative config (AC: #1, #2, #3, #4)
  - [x] 1.1 Verify Kong `kong:latest` opentelemetry plugin schema (run `docker run --rm kong:latest kong plugins list 2>/dev/null | grep opentelemetry` or check Admin API). Confirm `resource_attributes`, `header_type`, `sampling_rate` field names.
  - [x] 1.2 Add `opentelemetry` plugin entry to `plugins` array in `api-gateway-solution/new-config/kong_config.json`. Must be a **global plugin** (no `service` field) so it traces ALL services. Config: `endpoint: "http://otel-collector:4318/v1/traces"`, `resource_attributes: { "service.name": "kong-gateway" }`, `header_type: "w3c"`, `sampling_rate: 1.0`. Endpoint is hardcoded Docker DNS — JSON does NOT support env var substitution.
  - [x] 1.3 Verify `restore-kong-config.sh` global plugin loop (jq `select(.service? | not)`) will pick up the new plugin. No script changes needed for basic plugin creation — the loop already handles any global plugin in the JSON.

- [x] Task 2 — Gate Kong OTel on `ENABLE_OBSERVABILITY` and update docker-compose (AC: #7)
  - [x] 2.1 Add `ENABLE_OBSERVABILITY=${ENABLE_OBSERVABILITY:-0}` to `kong-config` init container environment (docker-compose.yaml line ~155-166). This container currently does NOT receive this env var.
  - [x] 2.2 Update `api-gateway-solution/new-config/restore-kong-config.sh`: add conditional block after config restore that disables the `opentelemetry` plugin via `PATCH /plugins/{id}` when `ENABLE_OBSERVABILITY != "1"`.
  - [x] 2.3 Add `ENABLE_OBSERVABILITY=${ENABLE_OBSERVABILITY:-0}` to Kong service environment (docker-compose.yaml line ~187) so Kong itself can reference it if needed.
  - [x] 2.4 Verify Ansible deployment compatibility: check `deploy/ansible/` templates for kong-config env var passthrough. May need to add `ENABLE_OBSERVABILITY` to Ansible group_vars if not already present.

- [x] Task 3 — Update OTel Collector README and docs (AC: #1, #4)
  - [x] 3.1 Add Kong to the "Instrumented Services" table in `configs/otel/README.md`
  - [x] 3.2 Document Kong OTel plugin configuration, conditional activation via `ENABLE_OBSERVABILITY`, and the Docker DNS endpoint

- [x] Task 4 — Write tests for Kong OTel configuration (AC: #1, #2, #3, #4, #5, #6, #7)
  - [x] 4.1 Unit test: validate `kong_config.json` contains `opentelemetry` plugin as global (no `service` field) with correct config keys (`endpoint`, `resource_attributes.service.name`, `header_type`, `sampling_rate`)
  - [x] 4.2 Unit test: validate existing plugins (prometheus, rate-limiting, cors, file-log, request-transformer, response-transformer, request-termination) are preserved unchanged — 7 total, 1 global + 6 service-scoped
  - [x] 4.3 Unit test: validate `restore-kong-config.sh` contains conditional `ENABLE_OBSERVABILITY` logic
  - [x] 4.4 Test location: `api-gateway-solution/new-config/__tests__/` — use Jest with CommonJS (consistent with project conventions)

- [x] Task 5 — Add Kong trace panel to Grafana dashboard (AC: #8)
  - [x] 5.1 Update `configs/grafana/provisioning/dashboards/trace-explorer.json` to add a Kong gateway span filter/panel (this is the most appropriate existing dashboard for trace visibility)
  - [x] 5.2 Panel should show `service.name = "kong-gateway"` spans with attributes: `kong.route`, `kong.consumer`, `http.method`, `http.status_code`

## Dev Notes

### Critical Context

**Kong Version**: `kong:latest` (currently 3.x — supports `opentelemetry` plugin natively since 3.0). The Kong `opentelemetry` plugin is bundled — no additional installation needed.

**Configuration Method**: Kong config is applied declaratively via `api-gateway-solution/new-config/kong_config.json`, restored by `restore-kong-config.sh` running in the `kong-config` one-shot init container. The script iterates over global plugins in the JSON config and creates them via Kong Admin API (`POST /plugins`). Plugin entries WITHOUT a `service` field are treated as global plugins (see line 269 of `restore-kong-config.sh`: `select(.service? | not)`).

**Existing Plugins** (in `kong_config.json` `plugins` array — 7 total):

**Global** (no `service` field — jq selector `select(.service? | not)` matches these):
1. `prometheus` (enabled, bandwidth/latency/ai metrics) — MUST NOT BE DISTURBED

**Service-scoped** (have `service: {"name": "express-api"}` — NOT matched by global plugin loop):
2. `request-transformer` (enabled, adds `X-Kong-Proxy: true`)
3. `rate-limiting` (enabled, 1000/min 10000/hour)
4. `cors` (disabled)
5. `file-log` (enabled, writes to `/var/log/kong/api.log`)
6. `response-transformer` (disabled)
7. `request-termination` (disabled)

⚠️ **Critical distinction**: Only `prometheus` is truly global. The other 6 are scoped to `express-api` service. The `restore-kong-config.sh` global plugin loop uses `select(.service? | not)` which will ONLY match plugins without a `service` field.

The `opentelemetry` plugin must be added as a **global plugin** (no `service` field) so it traces ALL proxied requests across all services (express-api, document-repository, keycloak, grafana). This means it will be processed by the global plugin loop alongside `prometheus`.

### Kong OpenTelemetry Plugin Configuration

```json
{
  "name": "opentelemetry",
  "enabled": true,
  "config": {
    "endpoint": "http://otel-collector:4318/v1/traces",
    "resource_attributes": {
      "service.name": "kong-gateway"
    },
    "header_type": "w3c",
    "sampling_rate": 1.0
  }
}
```

⚠️ **Before implementation**: Run `docker run --rm kong:latest kong config dump 2>/dev/null | grep -A5 opentelemetry` or check Kong Admin API plugin schema at `GET /plugins/schema/opentelemetry` to verify the exact field names supported by the current `kong:latest`. Field names like `resource_attributes` may differ across Kong versions.

**Key plugin config options**:
- `endpoint` — OTLP HTTP endpoint. **Static in JSON** — `kong_config.json` does NOT support env var substitution. Use the Docker network DNS name `http://otel-collector:4318/v1/traces` which is always resolvable within the Docker network. Do NOT try `${KONG_OTEL_ENDPOINT}` in JSON.
- `resource_attributes` — Custom resource attributes attached to all spans. **Verify against actual Kong `kong:latest` plugin schema before implementation** — field names may differ between Kong versions.
- `header_type` — W3C trace context propagation format (default: `w3c`)
- `sampling_rate` — Plugin-level sampling rate (0.0-1.0). This is separate from Kong gateway-level `KONG_TRACING_SAMPLING_RATE` which controls the internal tracer. The plugin-level `sampling_rate` is what you want — it controls which spans are exported to the collector.

**Note on endpoint flexibility**: The endpoint is hardcoded in JSON as `http://otel-collector:4318/v1/traces`. This is correct for Docker network communication. The `KONG_OTEL_ENDPOINT` env var is NOT used in the JSON — it would only be relevant if the script performed sed substitution before posting to Kong Admin API. For now, hardcode the Docker DNS name.

### Conditional Activation Pattern

The observability stack is gated on `ENABLE_OBSERVABILITY`. Kong must follow this pattern:
- Default: OTel plugin is **disabled** (matches `ENABLE_OBSERVABILITY=0`)
- When `ENABLE_OBSERVABILITY=1`: OTel plugin is **enabled**

**Implementation approach**: In `restore-kong-config.sh`, after the config restore loop completes, add a conditional block that disables the OTel plugin when observability is off.

⚠️ **Prerequisite**: The `kong-config` init container (docker-compose.yaml line 152) currently does NOT receive `ENABLE_OBSERVABILITY`. Must add it to the container's `environment` section:
```yaml
  kong-config:
    environment:
      - KONG_ADMIN_URL=http://kong:8001
      - KONG_PUBLIC_URL=http://kong:8000
      - TARGET_HOST=backend
      - TARGET_PORT=3000
      - ENABLE_OBSERVABILITY=${ENABLE_OBSERVABILITY:-0}  # ADD THIS
```

Then in `restore-kong-config.sh`:
```sh
if [ "${ENABLE_OBSERVABILITY}" != "1" ]; then
    # Disable opentelemetry plugin
    OTEL_PLUGIN_ID=$(curl -s "$KONG_ADMIN_URL/plugins" | jq -r '.data[] | select(.name == "opentelemetry") | .id')
    if [ -n "$OTEL_PLUGIN_ID" ]; then
        curl -s -X PATCH "$KONG_ADMIN_URL/plugins/$OTEL_PLUGIN_ID" \
            -H "Content-Type: application/json" \
            -d '{"enabled": false}'
    fi
fi
```

This avoids needing template rendering in the JSON config. The plugin is created enabled by default, then disabled if observability is off.

### Trace Propagation Architecture

```
Client Request
  → Nginx (TLS termination, security headers)
    → Kong (opentelemetry plugin creates root span, injects traceparent header)
      → Backend (Express — OTel SDK reads traceparent, creates child spans)
        → ChatQnA/Retriever/etc. (FastAPI — OTel SDK reads traceparent, creates child spans)
```

The backend already reads `traceparent` from incoming requests (Story 7.1/7.4). Kong needs to **inject** the `traceparent` header on outbound requests to upstreams. This is handled automatically by Kong's `opentelemetry` plugin with `header_type: "w3c"`.

**Critical**: Kong must create the root span BEFORE the request hits the backend. Kong's `opentelemetry` plugin handles this — it creates a span in the "rewrite" phase and propagates in the "access" phase.

### File Modification Guide

| File | Action | Notes |
|------|--------|-------|
| `api-gateway-solution/new-config/kong_config.json` | UPDATE | Add `opentelemetry` global plugin entry to `plugins` array (no `service` field) |
| `api-gateway-solution/new-config/restore-kong-config.sh` | UPDATE | Add conditional OTel plugin disable logic after config restore when `ENABLE_OBSERVABILITY != "1"` |
| `docker-compose.yaml` | UPDATE | Add `ENABLE_OBSERVABILITY` env var to both `kong` service (~line 187) AND `kong-config` init container (~line 155) |
| `configs/otel/README.md` | UPDATE | Add Kong to instrumented services table, document plugin config |
| `configs/grafana/provisioning/dashboards/trace-explorer.json` | UPDATE | Add Kong gateway span panel with `service.name = "kong-gateway"` filter |
| `api-gateway-solution/new-config/__tests__/` | NEW | Jest test files for Kong OTel config validation (JSON structure + shell script logic) |

### Testing Approach

**Unit tests** (no Kong runtime required):
- Validate JSON structure of `kong_config.json` — opentelemetry plugin exists with correct config
- Validate shell script conditional logic for `ENABLE_OBSERVABILITY`
- Validate existing plugins are preserved

**Test location**: Create `api-gateway-solution/new-config/__tests__/` for test files. Use Node.js/Jest (already in the project) to validate JSON config.

**No integration test**: Kong plugin behavior requires a running Kong instance. Live testing is deferred to Story 7-10 (E2E MELT Correlation Test).

### Performance Considerations

- Kong `opentelemetry` plugin adds < 2ms per request (per AC6). This is achievable with 100% sampling in low-traffic scenarios (government sector, not high-volume)
- OTLP HTTP export is asynchronous (Kong batches spans internally)
- If latency becomes an issue, reduce `sampling_rate` to 0.1 (10%) in production
- The `prometheus` plugin already adds minimal overhead — OTel plugin follows similar patterns

### Previous Story Learnings (7-8)

From Story 7-8 implementation:
- **OTel Collector endpoint** is `http://otel-collector:4318/v1/traces` for all services
- **Metrics flow**: Services → OTel Collector → VictoriaMetrics → Grafana
- **Traces flow**: Services → OTel Collector → VictoriaTraces → Grafana (via Jaeger datasource)
- **ENABLE_OBSERVABILITY** controls the entire stack. Pattern: check env var in scripts, use profile in docker-compose
- **Grafana dashboards** go in `configs/grafana/provisioning/dashboards/`
- **PII enforcement**: No PII in attributes (already handled — Kong only sees HTTP metadata, no user content)
- **Review feedback from 7-8**: PII denylist was duplicated — ensure no duplication across services. Kong config is JSON (not code), so this is less of a concern.

### Project Structure Notes

- Kong config: `api-gateway-solution/new-config/kong_config.json` — declarative config applied by init container
- Kong scripts: `api-gateway-solution/new-config/restore-kong-config.sh` — applies config via Kong Admin API
- OTel Collector: `configs/otel/otel-collector-config.yaml` — receives from all services on port 4318
- Grafana dashboards: `configs/grafana/provisioning/dashboards/` — JSON dashboard files
- Docker Compose: Root `docker-compose.yaml` — Kong service at line ~178, OTel Collector service in observability profile section
- Tests: `api-gateway-solution/new-config/__tests__/` — new test directory for Kong config validation

### References

- [Source: api-gateway-solution/new-config/kong_config.json] — Current Kong declarative config with 4 services, 30+ routes, 7 plugins
- [Source: api-gateway-solution/new-config/restore-kong-config.sh] — Config restore script with Admin API loop
- [Source: configs/otel/otel-collector-config.yaml] — OTel Collector config (receivers, processors, exporters)
- [Source: configs/otel/README.md] — Instrumented services table, deployment docs
- [Source: docker-compose.yaml:178-231] — Kong service definition with environment vars
- [Source: docker-compose.yaml:1361+] — OTel Collector service definition (observability profile)
- [Source: _bmad-output/implementation-artifacts/7-8-instrument-application-metrics.md] — Previous story learnings

## Dev Agent Record

### Agent Model Used

glm-5.1 (glm-5-turbo)

### Debug Log References

### Completion Notes List

- ✅ Added Kong `opentelemetry` global plugin to `kong_config.json` (endpoint, resource_attributes, header_type, sampling_rate)
- ✅ Verified global plugin loop in `restore-kong-config.sh` handles opentelemetry (jq `select(.service? | not)`)
- ✅ Added `ENABLE_OBSERVABILITY` env var to `kong-config` init container and `kong` service in docker-compose.yaml
- ✅ Added conditional OTel disable block in `restore-kong-config.sh` when `ENABLE_OBSERVABILITY != "1"`
- ✅ Verified Ansible compatibility — `ENABLE_OBSERVABILITY` already flows through `group_vars/all.yml` → `env.j2` → `.env`
- ✅ Added Kong to OTel README instrumented services table with full documentation
- ✅ Added Kong Gateway Traces section (row + traces panel) to Grafana trace-explorer dashboard
- ✅ 19 unit tests covering AC1 (plugin config), AC5 (plugin compatibility), AC7 (conditional activation)

## Change Log

- 2026-06-05: Implemented Kong OTel tracing — opentelemetry plugin, conditional activation, docs, dashboard panel, 19 tests

- `api-gateway-solution/new-config/kong_config.json` (modified — added opentelemetry global plugin)
- `api-gateway-solution/new-config/restore-kong-config.sh` (modified — added ENABLE_OBSERVABILITY conditional block)
- `docker-compose.yaml` (modified — added ENABLE_OBSERVABILITY to kong-config and kong services)
- `configs/otel/README.md` (modified — added Kong to instrumented services table + documentation)
- `configs/grafana/provisioning/dashboards/trace-explorer.json` (modified — added Kong Gateway Traces panel)
- `api-gateway-solution/new-config/__tests__/kong-otel-config.test.js` (new — 19 unit tests)
- `api-gateway-solution/new-config/package.json` (new — jest test harness)
