# Story 7.6: Deploy VictoriaLogs for Centralized Log Aggregation

Status: ready-for-dev

## Story

As a developer,
I want service logs aggregated in VictoriaLogs and accessible via Grafana behind Kong with Keycloak SSO,
so that I can query, filter, and correlate logs across all services without exposing observability endpoints directly.

## Acceptance Criteria

1. **AC1: VictoriaLogs service** — Add `victorialogs` service to `docker-compose.yaml` using `victoriametrics/victoria-logs:v1.4.0`. Stores logs with configurable retention (default 30 days via `VICTORIALOGS_RETENTION`). Data persisted in a named volume (`vlogs-data`). Follows same dual-mode pattern as other observability services: `profiles: [observability]` for compose up, `replicas: ${ENABLE_OBSERVABILITY:-0}` for Swarm.
2. **AC2: Log ingestion via OTel Collector** — The OTel Collector `filelog` receiver reads Docker container stdout/stderr logs from the Docker log directory. The Collector's `logs` pipeline forwards to VictoriaLogs via `otlphttp` exporter (endpoint `http://victorialogs:9428/insert/opentelemetry/v1/logs`). This avoids per-service log driver changes — existing Docker default (json-file) is preserved.
3. **AC3: Existing log format preserved** — The existing winston log format (`YYYY-MM-DD HH:mm:ss [LEVEL]: message`) is **NOT changed**. `LogSearchDialog.vue` depends on this format. `trace_id` and `span_id` fields added by story 7-4's `traceFormat` are included in JSON output and are indexed in VictoriaLogs.
4. **AC4: trace_id indexed for query performance** — VictoriaLogs query API returns results with `trace_id` filter in < 1 second. Verify via API query: `curl http://victorialogs:9428/select/logsql/query -d 'filter:_stream_="victorialogs"'`.
5. **AC5: Grafana VictoriaLogs datasource provisioned** — A `victoriametrics-logs-datasource` plugin datasource is provisioned in `configs/grafana/provisioning/datasources/vlogs-datasource.yml`. Grafana requires this plugin pre-installed — use `grafana/grafana:12.4` with plugin install via `GF_INSTALL_PLUGINS` env var.
6. **AC6: Grafana removes direct host port exposure** — Remove the `ports:` mapping from the `grafana` service in `docker-compose.yaml`. Grafana is accessible only via Kong route (see AC7). For development debugging, the port can be re-added via environment override but is NOT exposed by default.
7. **AC7: Grafana accessible via Kong route** — Add a `grafana` service and `/grafana` route to `api-gateway-solution/new-config/kong_config.json`. Kong proxies `/grafana/*` → `http://grafana:3000/` with strip path. The `manage-kong-config.sh` script must handle the new service/route. Add a corresponding nginx location block for `/grafana/` in `default.conf.template` that proxies to Kong.
8. **AC8: Grafana authenticates via Keycloak OIDC** — Create a new Keycloak client `grafana` in `configs/keycloak/genie-realm.yaml` with: `publicClient: false`, `standardFlowEnabled: true`, redirect URI `$(env:KC_PUBLIC_ORIGIN)/grafana/*`, web origin `$(env:KC_PUBLIC_ORIGIN)`. Configure Grafana via env vars: `GF_AUTH_GENERIC_OAUTH_ENABLED=true`, `GF_AUTH_GENERIC_OAUTH_CLIENT_ID=$(env:KC_GRAFANA_CLIENT_ID)`, auth/token/userinfo URLs pointing to Keycloak. Add `KC_GRAFANA_CLIENT_ID` and `KC_GRAFANA_CLIENT_SECRET` to the env template.
9. **AC9: Pre-configured Service Logs dashboard** — A Grafana dashboard JSON shows service logs with filters by service name, log level, and `trace_id`. Auto-provisioned via file-based dashboard provisioning. Uses VictoriaLogs LogsQL queries.
10. **AC10: Log-trace correlation via trace_id** — Grafana can correlate logs to traces using `trace_id` as the join key. The dashboard includes a link-out to VictoriaTraces (story 7.7) when available, and a `trace_id` variable for filtering.
11. **AC11: Playwright test for LogSearchDialog** — A Playwright test verifies `LogSearchDialog.vue` still parses logs correctly after VictoriaLogs deployment. This validates that log format preservation (AC3) holds. Test can be a simple smoke test verifying the component renders and the log parsing regex matches the expected format.
12. **AC12: All observability services on internal network** — VictoriaLogs is on `genieai_network` (existing). No external egress from observability services. Placement constraint: `node.labels.genieai == true`.
13. **AC13: Env template updated** — Add `VICTORIALOGS_RETENTION`, `KC_GRAFANA_CLIENT_ID`, `KC_GRAFANA_CLIENT_SECRET` to root `env` template (Section 12C). Add `GF_AUTH_*` variables as commented-out overrides.
14. **AC14: Ansible support** — Add `victorialogs_retention` variable to `deploy/ansible/group_vars/all.yml`. Add `grafana_client_id` and `grafana_client_secret` to vault. Update `deploy/ansible/templates/env.j2` with new Section 12C variables.
15. **AC15: Docker Compose up works** — `docker compose --profile observability up -d` starts VictoriaLogs alongside existing observability services. `docker compose up -d` (no profile) does NOT start it.
16. **AC16: Docker Swarm works** — `ENABLE_OBSERVABILITY=1` in `.env` + `docker stack deploy` starts VictoriaLogs with proper placement.
17. **AC17: Existing services unaffected** — All existing services (backend, frontend, OPEA, gateway, collector, VM, grafana) start and run normally.
18. **AC18: Existing tests pass** — All existing CI tests continue to pass. No regressions.

## Tasks / Subtasks

- [ ] Task 1: Create VictoriaLogs service in docker-compose.yaml (AC: #1, #12)
  - [ ] Add `vlogs-data` named volume to `volumes:` section
  - [ ] Add `victorialogs` service with: image, retention command, data volume, healthcheck, genieai_network, profiles, deploy block
  - [ ] Follow dual-mode pattern from story 7-5 (profiles:[observability], replicas:${ENABLE_OBSERVABILITY:-0})
  - [ ] Placement constraint: `node.labels.genieai == true`

- [ ] Task 2: Update OTel Collector config for log ingestion (AC: #2)
  - [ ] Add `filelog` receiver to `configs/otel/otel-collector-config.yaml` that reads Docker container logs
  - [ ] Add `logs` pipeline: `filelog` → `batch` → `otlphttp` exporter to VictoriaLogs
  - [ ] Mount Docker log directory `/var/lib/docker/containers` (read-only) into the Collector service
  - [ ] Test that the Collector can parse Docker JSON log lines and forward to VictoriaLogs

- [ ] Task 3: Install VictoriaLogs Grafana plugin and provision datasource (AC: #5)
  - [ ] Add `GF_INSTALL_PLUGINS=victoriametrics-logs-datasource` to Grafana service environment
  - [ ] Create `configs/grafana/provisioning/datasources/vlogs-datasource.yml` with VictoriaLogs datasource
  - [ ] Configure datasource as read-only (no admin write via Grafana)

- [ ] Task 4: Remove Grafana direct host port exposure (AC: #6)
  - [ ] Remove `ports:` section from `grafana` service in docker-compose.yaml
  - [ ] Update documentation to reflect Grafana is now accessed via Kong route only

- [ ] Task 5: Add Grafana service and route to Kong config (AC: #7)
  - [ ] Add `grafana` service definition to `api-gateway-solution/new-config/kong_config.json` (upstream: `grafana:3000`)
  - [ ] Add `/grafana` route with strip_path enabled
  - [ ] Add nginx location block for `/grafana/` in `api-gateway-solution/nginx/conf/default.conf.template`
  - [ ] Update `api-gateway-solution/new-config/manage-kong-config.sh` to handle the new Grafana service
  - [ ] Configure Grafana `GF_SERVER_ROOT_URL` to match the Kong route path

- [ ] Task 6: Configure Keycloak OIDC client for Grafana (AC: #8)
  - [ ] Add `grafana` client to `configs/keycloak/genie-realm.yaml` with standard flow enabled
  - [ ] Add `KC_GRAFANA_CLIENT_ID` and `KC_GRAFANA_CLIENT_SECRET` env vars to Keycloak service in docker-compose.yaml
  - [ ] Add Grafana OAuth env vars to Grafana service: `GF_AUTH_GENERIC_OAUTH_*` pointing to Keycloak
  - [ ] Configure `GF_SERVER_ROOT_URL` with the public Grafana URL
  - [ ] Disable default Grafana admin password auth when OAuth is configured

- [ ] Task 7: Create Service Logs dashboard (AC: #9)
  - [ ] Create `configs/grafana/provisioning/dashboards/service-logs.json` with logs dashboard
  - [ ] Include filters: service name, log level, trace_id, time range
  - [ ] Use LogsQL queries against VictoriaLogs datasource
  - [ ] Add to dashboard provider in `dashboards.yml`

- [ ] Task 8: Add log-trace correlation support (AC: #10)
  - [ ] Add `trace_id` template variable to the Service Logs dashboard
  - [ ] Configure data source links for trace_id → VictoriaTraces (prepared for story 7.7)
  - [ ] Add a derived field in VictoriaLogs datasource config for trace_id linking

- [ ] Task 9: Update env template and Ansible (AC: #13, #14)
  - [ ] Add `VICTORIALOGS_RETENTION`, `KC_GRAFANA_CLIENT_ID`, `KC_GRAFANA_CLIENT_SECRET` to `env` Section 12C
  - [ ] Add commented-out `GF_AUTH_*` override variables
  - [ ] Add `victorialogs_retention` to `deploy/ansible/group_vars/all.yml`
  - [ ] Add `grafana_client_id` and `grafana_client_secret` to vault
  - [ ] Update `deploy/ansible/templates/env.j2` with new variables
  - [ ] Update `deploy/ansible/README.md` with Grafana SSO documentation

- [ ] Task 10: Create Playwright smoke test for log format (AC: #11)
  - [ ] Create a Playwright test that verifies LogSearchDialog.vue renders correctly
  - [ ] Verify the log parsing regex matches the expected format (`YYYY-MM-DD HH:mm:ss [LEVEL]: message`)
  - [ ] This is a smoke test, not a full E2E — no need for running services

- [ ] Task 11: Validate deployment (AC: #15, #16, #17, #18)
  - [ ] Verify `docker compose config --profiles observability` includes victorialogs
  - [ ] Verify `docker compose config` (without profile) excludes victorialogs
  - [ ] Verify all YAML/JSON config files parse correctly
  - [ ] Verify all existing CI tests pass
  - [ ] Verify lint passes on any modified files

- [ ] Task 12: Update documentation (AC: #4, #6, #17)
  - [ ] Update `configs/otel/README.md` with new filelog receiver and logs pipeline documentation
  - [ ] Update `CLAUDE.md` observability section with VictoriaLogs info
  - [ ] Update `.claude/rules/ENVIRONMENT.md` with VictoriaLogs port
  - [ ] Update `docs/docker-compose-setup.md` and `docs/docker-swarm-setup.md`

## Dev Notes

### Critical: VictoriaLogs Technical Details

**VictoriaLogs** is an open-source log database from VictoriaMetrics, optimized for low resource usage (30x less RAM, 15x less disk than Elasticsearch).

| Property | Value |
|----------|-------|
| Docker image | `victoriametrics/victoria-logs:v1.4.0` |
| HTTP API port | `9428` |
| Ingestion endpoints | OTLP: `/insert/opentelemetry/v1/logs`, Loki: `/insert/loki/api/v1/push`, JSON lines: `/insert/jsonline` |
| Query endpoint | `/select/logsql/query` (LogsQL query language) |
| Healthcheck | `GET /health` on port 9428 |
| Storage path | `/var/lib/victoria-logs` |
| Retention flag | `--retentionPeriod=30d` |

### Critical: Log Ingestion Architecture

The ACs specify using Docker stdout logs captured via Docker log driver (json-file) and ingested into VictoriaLogs. The OTel Collector `filelog` receiver reads Docker container log files.

**Recommended approach — OTel Collector filelog receiver:**

```yaml
# In otel-collector-config.yaml
receivers:
  filelog:
    include:
      - /var/lib/docker/containers/*/*-json.log
    include_file_name: false
    include_file_path: true
    operators:
      - type: json_parser
        parse_from: "log"
      - type: move
        from: "attrs.stream"
        to: "log.stream"
      - type: move
        from: "attrs.time"
        to: "log.timestamp"
    start_at: beginning
```

```yaml
exporters:
  otlphttp:
    logs_endpoint: http://victorialogs:9428/insert/opentelemetry/v1/logs
    sending_queue:
      enabled: true
      num_consumers: 10
      queue_size: 1000
    retry_on_failure:
      enabled: true
      initial_interval: 5s
      max_interval: 30s
```

**Docker volume mount required on Collector:**
```yaml
otel-collector:
  volumes:
    - /var/lib/docker/containers:/var/lib/docker/containers:ro
    - ./configs/otel/otel-collector-config.yaml:/etc/otelcol-contrib/config.yaml:ro
```

### Critical: Grafana VictoriaLogs Plugin

Grafana does NOT have a built-in VictoriaLogs datasource. A plugin must be installed:

```yaml
grafana:
  environment:
    - GF_INSTALL_PLUGINS=victoriametrics-logs-datasource
```

The plugin ID is `victoriametrics-logs-datasource`. It's available in the Grafana plugin marketplace (free/open-source). The datasource type in provisioning YAML is `victoriametrics-logs-datasource`.

**Datasource provisioning:**
```yaml
apiVersion: 1

datasources:
  - name: VictoriaLogs
    type: victoriametrics-logs-datasource
    access: proxy
    url: http://victorialogs:9428
    editable: false
    jsonData:
      maxLines: 1000
```

### Critical: Grafana + Keycloak OIDC SSO

Grafana uses the **Generic OAuth** auth module (available in open-source Grafana, no Enterprise required).

**Keycloak client config (add to `configs/keycloak/genie-realm.yaml`):**
```yaml
  - clientId: $(env:KC_GRAFANA_CLIENT_ID)
    enabled: true
    publicClient: false
    standardFlowEnabled: true
    directAccessGrantsEnabled: false
    implicitFlowEnabled: false
    serviceAccountsEnabled: false
    secret: $(env:KC_GRAFANA_CLIENT_SECRET)
    attributes:
      pkce.code.challenge.method: S256
      oauth2.device.authorization.grant.enabled: false
      client.credentials.use.refresh.token: false
      require.pushed.authorization.requests: false
    redirectUris:
      - $(env:KC_PUBLIC_ORIGIN)/grafana/*
    webOrigins:
      - $(env:KC_PUBLIC_ORIGIN)
```

**Grafana env vars for OAuth:**
```yaml
grafana:
  environment:
    # Disable basic auth, use OAuth only
    - GF_AUTH_DISABLE_LOGIN_FORM=true
    - GF_AUTH_GENERIC_OAUTH_ENABLED=true
    - GF_AUTH_GENERIC_OAUTH_NAME=Keycloak
    - GF_AUTH_GENERIC_OAUTH_ALLOW_SIGN_UP=true
    - GF_AUTH_GENERIC_OAUTH_CLIENT_ID=${KC_GRAFANA_CLIENT_ID:-grafana}
    - GF_AUTH_GENERIC_OAUTH_CLIENT_SECRET=${KC_GRAFANA_CLIENT_SECRET}
    - GF_AUTH_GENERIC_OAUTH_SCOPES=openid profile email
    - GF_AUTH_GENERIC_OAUTH_AUTH_URL=${KEYCLOAK_URL:-http://keycloak:8080}/realms/${KEYCLOAK_REALM:-genie}/protocol/openid-connect/auth
    - GF_AUTH_GENERIC_OAUTH_TOKEN_URL=${KEYCLOAK_URL:-http://keycloak:8080}/realms/${KEYCLOAK_REALM:-genie}/protocol/openid-connect/token
    - GF_AUTH_GENERIC_OAUTH_API_URL=${KEYCLOAK_URL:-http://keycloak:8080}/realms/${KEYCLOAK_REALM:-genie}/protocol/openid-connect/userinfo
    # Root URL must match the Kong route
    - GF_SERVER_ROOT_URL=${NGINX_PUBLIC_DOMAIN:-https://localhost}/grafana/
    - GF_SERVER_SERVE_FROM_SUB_PATH=true
```

### Critical: Kong + Nginx Configuration for Grafana

**Kong config (`kong_config.json`):**
```json
{
  "services": [
    {
      "name": "grafana",
      "host": "grafana",
      "port": 3000,
      "protocol": "http"
    }
  ],
  "routes": [
    {
      "name": "grafana",
      "service": {"name": "grafana"},
      "paths": ["/grafana"],
      "strip_path": true,
      "preserve_host": false
    }
  ]
}
```

**Nginx location block (in `default.conf.template`):**
```nginx
location /grafana/ {
    proxy_pass http://${KONG_PROXY_HOST}:8000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

**Grafana must know it's served from a subpath:**
- `GF_SERVER_SERVE_FROM_SUB_PATH=true`
- `GF_SERVER_ROOT_URL=https://<domain>/grafana/`

### Critical: CSP Considerations for Grafana via Kong

The nginx CSP config currently sets `CSP_CONNECT_SRC` via env var. When Grafana is served under `/grafana/`, Grafana's JavaScript may need to make WebSocket connections and API calls. Add the Grafana subpath to the CSP connect sources:

```
CSP_CONNECT_SRC='self' http://localhost:3000 http://localhost:8090 http://127.0.0.1:8090 ws://localhost:3000 ws://localhost:8090
```

This should already be covered by `'self'` since Grafana is served from the same origin after proxying. Verify during testing.

### Critical: Docker Log Format

Docker's json-file log driver produces JSON lines like:
```json
{"log":"2026-05-29 10:15:30 [INFO]: Request received\n","stream":"stdout","time":"2026-05-29T10:15:30.123456789Z"}
```

The OTel Collector `filelog` receiver with `json_parser` operator extracts:
- `log` field: the actual log message (with winston format: `YYYY-MM-DD HH:mm:ss [LEVEL]: message`)
- `stream` field: stdout/stderr
- `time` field: Docker timestamp

When winston's `traceFormat` is active (story 7-4), the JSON output includes additional fields: `trace_id`, `span_id`, `service`. The Collector's json_parser will parse these as attributes, making them available for VictoriaLogs indexing.

### Critical: Dual-Mode Docker Compose Pattern

Follow the EXACT same pattern as story 7-5's observability services:

```yaml
victorialogs:
  profiles: [observability]          # compose up: --profile observability
  restart: unless-stopped            # compose up: restart policy
  image: victoriametrics/victoria-logs:v1.4.0
  command:
    - "--storageDataPath=/var/lib/victoria-logs"
    - "--retentionPeriod=${VICTORIALOGS_RETENTION:-30d}"
    - "--httpListenAddr=:9428"
  volumes:
    - vlogs-data:/var/lib/victoria-logs
  healthcheck:
    test: ["CMD", "wget", "--spider", "-q", "http://127.0.0.1:9428/health"]
    interval: 10s
    timeout: 5s
    retries: 3
    start_period: 10s
  networks:
    - genieai_network
  deploy:
    replicas: ${ENABLE_OBSERVABILITY:-0}
    placement:
      constraints:
        - node.labels.genieai == true
    restart_policy:
      condition: on-failure
      delay: 5s
      max_attempts: 5
```

### Critical: Port Allocation

| Port | Service | Status |
|------|---------|--------|
| 4318 | OTel Collector (OTLP HTTP) | Existing |
| 13133 | OTel Collector (healthcheck) | Existing |
| 8428 | VictoriaMetrics | Existing |
| 3000 | Grafana (container) | Existing, NOW internal-only (AC #6) |
| 9428 | VictoriaLogs | NEW |
| 3002 | ~~Grafana host~~ | REMOVE (AC #6 — Grafana accessed via Kong only) |

### Critical: Keycloak Config Variable Substitution

Keycloak-config-cli uses `$(env:VARIABLE)` syntax — NOT `${env:VARIABLE}`. When adding the Grafana client to `genie-realm.yaml`, use:
- `clientId: $(env:KC_GRAFANA_CLIENT_ID)` — NOT `${env:...}`
- `secret: $(env:KC_GRAFANA_CLIENT_SECRET)` — NOT `${env:...}`
- `redirectUris: - $(env:KC_PUBLIC_ORIGIN)/grafana/*` — NOT `${env:...}`

### Critical: LogSearchDialog.vue Dependency

The frontend `LogSearchDialog.vue` component (`components/gov-chat-frontend/src/components/LogSearchDialog.vue`) parses logs with a specific regex expecting the format `YYYY-MM-DD HH:mm:ss [LEVEL]: message`. This format MUST be preserved. VictoriaLogs ingestion and storage do NOT change the log format — it stores whatever the Collector forwards.

The Playwright test (AC #11) should verify the parsing regex still works. This is a smoke test of the component, not an integration test with VictoriaLogs.

### Critical: Existing Volume Structure

Add `vlogs-data` to the existing volumes section:

```yaml
volumes:
  # ... existing volumes ...
  vm-data:
  grafana-data:
  vlogs-data:        # NEW
```

### Critical: OTel Collector Volume for Docker Logs

The OTel Collector needs read access to Docker's container log directory. In Docker Compose:
```yaml
otel-collector:
  volumes:
    - /var/lib/docker/containers:/var/lib/docker/containers:ro
```

**Swarm consideration:** On Swarm, the Docker log directory is on the host where the Collector runs. This is correct since the Collector has `node.labels.genieai == true` placement, which is typically a single node. For multi-node Swarm, only the node running the Collector can read its own container logs — this is a known limitation and acceptable for MVP.

### Critical: Keycloak URL Resolution

The Keycloak service is available internally at `http://keycloak:8080`. However, Grafana needs the **external-facing** Keycloak URL for OAuth callbacks. Use `KC_PUBLIC_ORIGIN` env var (already defined in the project) as the base for auth/token/userinfo URLs.

Pattern: `${KC_PUBLIC_ORIGIN}/realms/${KEYCLOAK_REALM:-genie}/protocol/openid-connect/...`

The `KC_PUBLIC_ORIGIN` is already used by other Keycloak clients in the config. Check the Keycloak service in docker-compose.yaml for the env vars `KEYCLOAK_URL` or `KC_PUBLIC_ORIGIN`.

### Previous Story Intelligence (7-5: Deploy Observability Stack)

**What was built:**
- OTel Collector config at `configs/otel/otel-collector-config.yaml` — currently has OTLP receiver, batch processor, prometheusremotewrite exporter (metrics), and debug exporter (traces)
- VictoriaMetrics datasource in Grafana (Prometheus-compatible)
- Two dashboards: service-health.json, rag-pipeline-trace-waterfall.json
- Dual-mode deployment pattern established (profiles + replicas)
- Env template Section 12C with ENABLE_OBSERVABILITY vars
- Ansible integration with enable_observability flag

**What changes for 7-6:**
- **Collector config gets new receivers/exporters** (filelog receiver, otlphttp logs exporter) — do NOT remove existing metrics/traces pipelines
- **Collector needs Docker log volume mount** — new volume addition
- **New Grafana plugin required** — GF_INSTALL_PLUGINS env var addition
- **Grafana loses direct port** — security improvement (AC #6)
- **Kong config gets Grafana service/route** — new addition to kong_config.json
- **Keycloak realm gets Grafana client** — new OIDC client in genie-realm.yaml
- **Ansible gets new variables** — victorialogs_retention, grafana OAuth secrets

**Deferred items from 7-5 that 7-6 should NOT implement:**
- Trace storage backend (story 7-7)
- Alerting rules (story 7-11)
- Multi-node volume placement (operational concern)

### Anti-Patterns to Avoid

- **Do NOT** change the winston log format — LogSearchDialog.vue depends on it
- **Do NOT** add VictoriaLogs-specific Docker log drivers to each service — use OTel Collector filelog receiver
- **Do NOT** remove the existing `debug` trace exporter from the Collector — keep it alongside the new otlphttp logs exporter
- **Do NOT** remove existing VictoriaMetrics datasource from Grafana — add VictoriaLogs datasource alongside it
- **Do NOT** use `${env:...}` syntax in Keycloak config — use `$(env:...)`
- **Do NOT** expose VictoriaLogs port to the host — it's internal-only, Grafana queries it on the Docker network
- **Do NOT** use `:latest` image tags — pin specific versions
- **Do NOT** create a separate Docker network — use existing `genieai_network`
- **Do NOT** hardcode OAuth secrets — use env vars from `.env`
- **Do NOT** modify application code (logger.js, tracing.py) — this story is infrastructure only
- **Do NOT** forget Swarm `deploy:` block — dual-mode is required
- **Do NOT** use `curl` in healthchecks — VictoriaLogs image uses Alpine with `wget`
- **Do NOT** install Loki — VictoriaLogs replaces it (different product, same use case)
- **Do NOT** forget `GF_SERVER_SERVE_FROM_SUB_PATH=true` — Grafana won't work correctly behind `/grafana` without it

### Out of Scope

- **VictoriaTraces** — story 7.7
- **Custom metrics instrumentation** — story 7.8
- **Kong OTel tracing** — story 7.9
- **MELT correlation test** — story 7.10
- **Alerting/SLOs** — story 7.11
- **Multi-node log aggregation** — single-node only for MVP
- **Log retention policies per service** — single global retention
- **SSL/TLS for VictoriaLogs** — internal-only, not needed
- **Grafana Enterprise features** — open-source Grafana only

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.6 — Acceptance Criteria]
- [Source: _bmad-output/planning-artifacts/architecture.md#Application Observability Architecture — OTel Collector Architecture table]
- [Source: _bmad-output/implementation-artifacts/7-5-deploy-observability-stack-collector-victoriametrics-grafana.md — previous story patterns, dual-mode deployment, port allocation, volume structure]
- [Source: configs/otel/otel-collector-config.yaml — current Collector config with OTLP receiver, batch processor, exporters]
- [Source: configs/grafana/provisioning/datasources/vm-datasource.yml — current datasource pattern]
- [Source: configs/grafana/provisioning/dashboards/dashboards.yml — dashboard provider pattern]
- [Source: configs/keycloak/genie-realm.yaml — existing Keycloak clients with $(env:...) syntax]
- [Source: api-gateway-solution/new-config/kong_config.json — current Kong services and routes]
- [Source: api-gateway-solution/nginx/conf/default.conf.template — nginx routing, CSP headers]
- [Source: docker-compose.yaml — observability services section, volumes section, placement constraints]
- [Source: env — Section 12C observability variables]
- [Source: deploy/ansible/group_vars/all.yml — enable_observability pattern]
- [Source: deploy/ansible/templates/env.j2 — Section 12C conditional template]
- [Source: components/gov-chat-frontend/src/components/LogSearchDialog.vue — log format dependency]
- [Source: components/shared/lib/logger.js — winston format (YYYY-MM-DD HH:mm:ss [LEVEL]: message), traceFormat with trace_id/span_id]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List

| File | Action |
|------|--------|
| `docker-compose.yaml` | Modified (VictoriaLogs service, volumes, Collector volume mount, Grafana port removal, Grafana env vars) |
| `configs/otel/otel-collector-config.yaml` | Modified (filelog receiver, logs pipeline) |
| `configs/otel/README.md` | Modified (new receiver/pipeline docs) |
| `configs/grafana/provisioning/datasources/vlogs-datasource.yml` | Created |
| `configs/grafana/provisioning/datasources/vm-datasource.yml` | Modified (non-default datasource) |
| `configs/grafana/provisioning/dashboards/dashboards.yml` | Modified (new dashboard) |
| `configs/grafana/provisioning/dashboards/service-logs.json` | Created |
| `configs/keycloak/genie-realm.yaml` | Modified (Grafana OIDC client) |
| `api-gateway-solution/new-config/kong_config.json` | Modified (Grafana service + route) |
| `api-gateway-solution/new-config/manage-kong-config.sh` | Modified (Grafana service handling) |
| `api-gateway-solution/nginx/conf/default.conf.template` | Modified (grafana location block) |
| `env` | Modified (new Section 12C variables) |
| `deploy/ansible/group_vars/all.yml` | Modified (victorialogs_retention) |
| `deploy/ansible/templates/env.j2` | Modified (new variables) |
| `deploy/ansible/README.md` | Modified (Grafana SSO docs) |
| `docs/docker-compose-setup.md` | Modified |
| `docs/docker-swarm-setup.md` | Modified |
| `CLAUDE.md` | Modified |
| `.claude/rules/ENVIRONMENT.md` | Modified |

### Change Log

### Review Findings
