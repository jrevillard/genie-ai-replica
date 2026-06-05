# Story 7.9: Kong OTel Tracing

Status: ready-for-dev

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

- [ ] Task 1 — Add Kong `opentelemetry` plugin to declarative config (AC: #1, #2, #3, #4)
  - [ ] 1.1 Add `opentelemetry` plugin entry to `plugins` array in `api-gateway-solution/new-config/kong_config.json` with config: `endpoint`, `resource_attributes`, `header_type: w3c`, `sampling_rate`
  - [ ] 1.2 Set `resource_attributes.service.name = "kong-gateway"` in plugin config
  - [ ] 1.3 Configure `header_type: "w3c"` for W3C traceparent propagation
  - [ ] 1.4 Configure endpoint to use `KONG_OTEL_ENDPOINT` env var with fallback `http://otel-collector:4318/v1/traces`
  - [ ] 1.5 Verify `restore-kong-config.sh` handles the new plugin correctly (it uses global plugin loop — no script changes needed if plugin is global)

- [ ] Task 2 — Gate Kong OTel plugin on `ENABLE_OBSERVABILITY` (AC: #7)
  - [ ] 2.1 Update `docker-compose.yaml` Kong service environment to pass `ENABLE_OBSERVABILITY`
  - [ ] 2.2 Update `api-gateway-solution/new-config/restore-kong-config.sh` to conditionally enable/disable the opentelemetry plugin based on `ENABLE_OBSERVABILITY` env var
  - [ ] 2.3 When `ENABLE_OBSERVABILITY != 1`, disable the opentelemetry plugin via Kong Admin API PATCH after config restore

- [ ] Task 3 — Update Kong docker-compose.yaml environment (AC: #1, #4, #7)
  - [ ] 3.1 Add `KONG_TRACING_SAMPLING_RATE` env var to Kong service (default: `1.0` for dev, configurable)
  - [ ] 3.2 Pass `ENABLE_OBSERVABILITY` env var to Kong service
  - [ ] 3.3 Pass `KONG_OTEL_ENDPOINT` env var to Kong service (default: `http://otel-collector:4318/v1/traces`)

- [ ] Task 4 — Update OTel Collector README and docs (AC: #1, #4)
  - [ ] 4.1 Add Kong to the "Instrumented Services" table in `configs/otel/README.md`
  - [ ] 4.2 Document Kong OTel plugin configuration, env vars, and conditional activation

- [ ] Task 5 — Write tests for Kong OTel configuration (AC: #1, #2, #3, #4, #5, #6, #7)
  - [ ] 5.1 Unit test: validate `kong_config.json` contains `opentelemetry` plugin with correct config keys
  - [ ] 5.2 Unit test: validate `restore-kong-config.sh` conditional logic for `ENABLE_OBSERVABILITY`
  - [ ] 5.3 Unit test: validate Kong plugin config has `header_type: "w3c"`, `resource_attributes.service.name = "kong-gateway"`
  - [ ] 5.4 Unit test: validate existing plugins (prometheus, rate-limiting, cors, file-log, request-transformer) are preserved unchanged

- [ ] Task 6 — Add Grafana dashboard panel for Kong traces (AC: #8)
  - [ ] 6.1 Add Kong gateway span panel to existing observability Grafana dashboard or create Kong-specific panel in `configs/grafana/provisioning/dashboards/`

## Dev Notes

### Critical Context

**Kong Version**: `kong:latest` (currently 3.x — supports `opentelemetry` plugin natively since 3.0). The Kong `opentelemetry` plugin is bundled — no additional installation needed.

**Configuration Method**: Kong config is applied declaratively via `api-gateway-solution/new-config/kong_config.json`, restored by `restore-kong-config.sh` running in the `kong-config` one-shot init container. The script iterates over global plugins in the JSON config and creates them via Kong Admin API (`POST /plugins`). Plugin entries WITHOUT a `service` field are treated as global plugins (see line 269 of `restore-kong-config.sh`: `select(.service? | not)`).

**Existing Global Plugins** (in `kong_config.json` `plugins` array):
1. `prometheus` (enabled, bandwidth/latency/ai metrics) — MUST NOT BE DISTURBED
2. `request-transformer` (enabled, adds `X-Kong-Proxy: true` to express-api service)
3. `rate-limiting` (enabled, 1000/min 10000/hour on express-api service)
4. `cors` (disabled, on express-api service)
5. `file-log` (enabled, writes to `/var/log/kong/api.log` on express-api service)
6. `response-transformer` (disabled)
7. `request-termination` (disabled)

The `opentelemetry` plugin should be added as a **global plugin** (no `service` field) so it traces ALL proxied requests across all services (express-api, document-repository, keycloak, grafana).

### Kong OpenTelemetry Plugin Configuration

```json
{
  "name": "opentelemetry",
  "enabled": true,
  "config": {
    "endpoint": "http://otel-collector:4318/v1/traces",
    "resource_attributes": {
      "service.name": "kong-gateway",
      "service.version": "3.x"
    },
    "header_type": "w3c",
    "sampling_rate": 1.0
  }
}
```

**Key plugin config options**:
- `endpoint` — OTLP HTTP endpoint. Use env var `KONG_OTEL_ENDPOINT` for flexibility
- `resource_attributes` — Custom resource attributes attached to all spans
- `header_type` — W3C trace context propagation format (default: `w3c`)
- `sampling_rate` — Per-plugin sampling rate override. Kong also has `KONG_TRACING_SAMPLING_RATE` at gateway level

**Note**: The `endpoint` field in the JSON config is static. Since `restore-kong-config.sh` reads the JSON file and POSTs it to Kong Admin API, the endpoint must be correct at deploy time. Use a shell variable substitution pattern or a sed-based approach in the script if dynamic endpoint resolution is needed. Alternatively, set the endpoint to the Docker network DNS name `otel-collector` which is always resolvable within the Docker network.

### Conditional Activation Pattern

The observability stack is gated on `ENABLE_OBSERVABILITY`. Kong must follow this pattern:
- Default: OTel plugin is **disabled** (matches `ENABLE_OBSERVABILITY=0`)
- When `ENABLE_OBSERVABILITY=1`: OTel plugin is **enabled**

Implementation approach: In `restore-kong-config.sh`, after the config restore loop completes, add a conditional block:
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

This avoids needing template rendering in the JSON config.

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
| `api-gateway-solution/new-config/kong_config.json` | UPDATE | Add `opentelemetry` global plugin entry to `plugins` array |
| `api-gateway-solution/new-config/restore-kong-config.sh` | UPDATE | Add conditional OTel plugin disable logic after config restore |
| `docker-compose.yaml` | UPDATE | Add `KONG_TRACING_SAMPLING_RATE`, `ENABLE_OBSERVABILITY`, `KONG_OTEL_ENDPOINT` env vars to Kong service |
| `configs/otel/README.md` | UPDATE | Add Kong to instrumented services table, document plugin config |
| `configs/grafana/provisioning/dashboards/` | UPDATE | Add Kong trace panel to existing dashboard |
| `api-gateway-solution/new-config/__tests__/` | NEW | Test files for Kong OTel config validation |

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

{{agent_model_name_version}}

### Debug Log References

### Completion Notes List

### File List
