---
baseline_commit: 9b5f39e5eb7348a8620d4c942af495b414caead7
---

# Story 7.10: E2E MELT Correlation Test

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want an end-to-end test that validates logs, traces, and metrics are correlated across the full stack,
so that I can verify the MELT observability promise holds under real conditions.

## Acceptance Criteria

1. **AC1 — Known Error Generation**: A test request triggers a known error (e.g., invalid embedding request) that produces a log entry, a distributed trace, and an incremented error metric — confirming the full MELT pipeline fires for a single request.

2. **AC2 — Cross-Backend Correlation**: The same `trace_id` extracted from the error request appears in VictoriaLogs (container log), VictoriaTraces (distributed trace), and VictoriaMetrics (metric label/annotation), proving trace context propagation across all three backends.

3. **AC3 — Grafana Dashboard Verification**: The correlated data (log → trace → metric for the same request) is visible in Grafana dashboards — specifically `service-logs.json`, `trace-explorer.json`, and `service-health.json`. The test validates dashboard datasource queries return results for the known trace ID.

4. **AC4 — Chaos: VictoriaLogs Resilience**: A chaos test stops VictoriaLogs, verifies the OTel Collector buffers logs (file-based `sending_queue`), restarts VictoriaLogs, and confirms no data loss — all buffered logs appear after reconnection.

5. **AC5 — Chaos: VictoriaTraces Resilience**: A chaos test stops VictoriaTraces, verifies the OTel Collector buffers traces (`file_storage/victoriatraces` extension), restarts VictoriaTraces, and confirms no data loss — all buffered traces appear after reconnection.

6. **AC6 — LogSearchDialog Playwright Test**: A Playwright test navigates to the admin dashboard, opens LogSearchDialog, searches for logs from the error request, and verifies the dialog correctly parses and displays log entries with trace ID correlation from the full stack.

7. **AC7 — Collector Overhead Under Load**: A k6 load test sustains ≥100 req/s against the backend, measuring OTel Collector overhead. P99 additional latency from OTel instrumentation stays <10ms (below NFR threshold of <5ms per-hop, Kong+Backend = 2 hops).

8. **AC8 — Structured Report**: All tests output JUnit XML reports compatible with Sprint 23 MELT Provider API ingestion, containing per-AC pass/fail results with trace IDs as evidence fields.

## Tasks / Subtasks

- [x] Task 1: Create MELT correlation test infrastructure (AC: #1, #2, #8)
  - [x] 1.1 Create `tests/melt-correlation/melt-utils.js` — shared Node.js utilities:
    - `queryTrace(traceId)` — GET `http://victoriatraces:10428/select/jaeger/api/traces/{traceId}`, parse JSON, return span tree
    - `queryMetrics(traceId, timeRange)` — GET `http://victoriametrics:8428/prometheus/api/v1/query?query=...`, return metric values
    - `queryLogs(traceId, timeRange)` — POST `http://victorialogs:9428/select/logsql/query` with JSON body `{"query": "trace_id:\"{traceId}\""}`, return log entries
    - `waitForPropagation(traceId, maxRetries=3, interval=10s)` — retry loop for eventual consistency
    - `generateJUnitReport(results, outputFile)` — produce JUnit XML at `reports/melt-correlation-report.xml`
    - All endpoints configurable via env vars (`VICTORIATRACES_URL`, `VICTORIAMETRICS_URL`, `VICTORIALOGS_URL`)
  - [x] 1.2 Create `tests/melt-correlation/correlation.test.js` — Node.js test (Jest-compatible or standalone):
    - Sends request that triggers known error (404 on non-existent endpoint or invalid embedding request)
    - Extracts `traceparent` header from response to get trace ID
    - Validates trace ID exists in VictoriaTraces with span hierarchy (Kong → Backend)
    - Validates metric `http_server_duration_milliseconds_count` increased during test window
    - Validates logs in VictoriaLogs contain matching `trace_id` attribute
    - Cross-correlates: same trace ID found in all 3 backends
    - Outputs JUnit XML via `melt-utils.js`

- [x] Task 2: Create Grafana dashboard verification (AC: #3)
  - [x] 2.1 Add `tests/melt-correlation/grafana-verify.js` — queries Grafana API:
    - GET `{GRAFANA_URL}/api/datasources/proxy/1/prometheus/api/v1/query?query=...` via VictoriaMetrics datasource proxy
    - GET `{GRAFANA_URL}/api/datasources/proxy/2/select/jaeger/api/traces/{traceId}` via VictoriaTraces datasource proxy (tempo-proxy)
    - POST `{GRAFANA_URL}/api/datasources/proxy/3/select/logsql/query` via VictoriaLogs datasource proxy
    - Validates all 3 datasources return results for the known trace ID
    - Reference dashboards: `service-logs.json` (datasource: victoriametrics-logs), `trace-explorer.json` (datasource: tempo/victoriatraces), `service-health.json` (datasource: prometheus/victoriametrics)
  - [x] 2.2 Grafana API requires authentication — use admin credentials from `.env` (`GRAFANA_ADMIN_USER`, `GRAFANA_ADMIN_PASSWORD`) or API token

- [x] Task 3: Create chaos resilience tests (AC: #4, #5)
  - [x] 3.1 Create `tests/melt-correlation/chaos-resilience.test.js` — Node.js test:
    - For each backend (VictoriaLogs, VictoriaTraces):
      1. Generate baseline request, record trace ID, verify it appears in backend
      2. Stop backend: `docker compose stop victorialogs` (or `victoriatraces`)
      3. Generate N requests during outage — trace IDs stored
      4. Verify OTel Collector health check still passes (`http://otel-collector:13133`)
      5. Verify Collector `file_storage` directory has queued data (`/var/lib/otelcol/file_storage/victoriatraces/`)
      6. Restart backend: `docker compose start victorialogs` (or `victoriatraces`)
      7. Wait for backend to become healthy (healthcheck or HTTP probe)
      8. Re-query all trace IDs from step 3 — ALL must appear (zero data loss)
      9. Output JUnit XML with per-backend pass/fail
  - [x] 3.2 Chaos tests MUST run inside Docker network (container-only services). Use `docker exec` from a test container or run script on a Swarm manager node.
  - [x] 3.3 Add configurable timeout for restart (default 60s) and retry for data verification (3 retries, 10s intervals)

- [x] Task 4: Create Playwright LogSearchDialog test (AC: #6)
  - [x] 4.1 Create `tests/e2e/observability/log-search-dialog.spec.js` — Playwright test:
    - Uses existing `tests/e2e/helpers/chatbot.js` auth helpers (`loginViaUI()`)
    - Triggers a known error request via chatbot (`sendMessage(page, "trigger_error_test")`)
    - Navigates to admin dashboard
    - Opens LogSearchDialog (use existing component test patterns from `__tests__/components/LogSearchDialog.test.js` for element selectors)
    - Searches for logs by trace ID or time range covering the error
    - Verifies dialog displays log entries with correct `trace_id`, service name, and log level
    - Validates log entries are parseable (JSON structured format, not garbled)
  - [x] 4.2 Follow existing Playwright patterns: `playwright.config.js` (tests/e2e/, Chromium, ignoreHTTPSErrors), JUnit reporter output at `reports/playwright-report.xml`

- [x] Task 5: Create k6 Collector overhead test (AC: #7)
  - [x] 5.1 Create `tests/melt-correlation/k6-collector-overhead.js` — k6 script:
    - Follow pattern from `tests/metrics-overhead/k6-metrics-overhead.js`
    - Sustains ≥100 VUs for configurable duration (default 30s)
    - Targets backend health endpoint: `{BASE_URL}/api/health`
    - Measures P50/P95/P99 latency with and without OTel (env var `ENABLE_OBSERVABILITY`)
    - Outputs k6 summary JSON (`results/k6-overhead-summary.json`)
    - Threshold: P99 <10ms OTel overhead
    - Env vars: `BASE_URL`, `TOKEN`, `VUS` (default 100), `DURATION` (default "30s")

- [x] Task 6: Create orchestration runner (AC: #1–#8)
  - [x] 6.1 Create `tests/melt-correlation/run-melt-test.sh` — shell script:
    - Validates prerequisite services reachable (VictoriaTraces:10428, VictoriaMetrics:8428, VictoriaLogs:9428, OTel Collector:13133, Grafana:3000)
    - Runs correlation test (Task 1)
    - Runs Grafana verification (Task 2)
    - Runs chaos resilience tests (Task 3) — optional via `--skip-chaos` flag
    - Runs Playwright LogSearchDialog test (Task 4) — optional via `--skip-playwright` flag
    - Runs k6 overhead test (Task 5) — requires k6 CLI
    - Waits for propagation delay between stages (configurable, default 15s)
    - Exits: 0 (all pass), 1 (any test failure), 2 (prerequisites unreachable)
    - Produces combined JUnit XML at `reports/melt-correlation-report.xml`
  - [x] 6.2 Add npm scripts in root `package.json`:
    - `"test:melt": "bash tests/melt-correlation/run-melt-test.sh"`
    - `"test:melt:correlation": "node tests/melt-correlation/correlation.test.js"`
    - `"test:melt:chaos": "node tests/melt-correlation/chaos-resilience.test.js"`

- [x] Task 7: GitLab CI integration (AC: #8)
  - [x] 7.1 Add `melt-correlation` job to `.gitlab-ci.yml` under `scheduled` stage (architecture §Test Execution Tiers — MELT tests are Scheduled tier, not Mandatory)
  - [x] 7.2 Job runs only when `ENABLE_OBSERVABILITY=1` via `rules:` conditional
  - [x] 7.3 Job requires observability stack: `docker compose --profile observability up -d` before test execution
  - [x] 7.4 Artifact: JUnit XML reports (`reports/melt-correlation-report.xml`, `reports/playwright-report.xml`)
  - [x] 7.5 Chaos tests run as separate job with `--skip-chaos` exclusion for fast CI feedback

- [x] Task 8: Documentation (AC: #1–#8)
  - [x] 8.1 Update `configs/otel/README.md` — add "MELT Correlation Tests" section:
    - How to run (local vs CI)
    - Prerequisites (`ENABLE_OBSERVABILITY=1`, k6 CLI, observability stack)
    - Expected output (JUnit XML, console summary)
    - Troubleshooting (service unreachable, propagation delays, chaos cleanup)
  - [x] 8.2 Add inline comments in scripts explaining Victoria* API endpoints, query formats, and retry logic

## Dev Notes

### Architecture Context

The observability stack deployed in stories 7.1–7.9 provides:

```
Application Services (OTel SDK)
  → OTLP HTTP (:4318) → OTel Collector → probabilistic_sampler → batch → VictoriaTraces (:10428)
                                           → batch → prometheusremotewrite → VictoriaMetrics (:8428)

Docker Container Logs (fluentd logging driver)
  → fluent_forward (:24224) → OTel Collector → batch → otlp/http → VictoriaLogs (:9428)
```

**Instrumented services** (from `configs/otel/README.md`):
| Service | OTel SDK | Endpoint |
|---------|----------|----------|
| Kong API Gateway | `opentelemetry` plugin | `http://otel-collector:4318/v1/traces` |
| Backend (Node.js) | `@opentelemetry/sdk-node` | `http://otel-collector:4318` |
| ChatQnA (Python) | `opentelemetry-instrumentation-fastapi` | `http://otel-collector:4318` |
| Retriever (Python) | `opentelemetry-instrumentation-fastapi` | `http://otel-collector:4318` |
| Dataprep (Python) | `opentelemetry-instrumentation-fastapi` | `http://otel-collector:4318` |
| Reranker (Python) | `opentelemetry-instrumentation-fastapi` | `http://otel-collector:4318` |

### OTel Collector Buffer Strategy (Critical for Chaos Tests)

The Collector uses **file-based sending queues** for resilience during backend outages:

- **Traces**: `file_storage/victoriatraces` extension — persistent queue at `/var/lib/otelcol/file_storage/victoriatraces/`
  - Configured in `otel-collector-config.yaml` under `exporters.otlp_http/victoriatraces.sending_queue`
  - `enabled: true`, `num_consumers: 10`, `queue_size: 1000`
  - Retry: `initial_interval: 5s`, `max_interval: 30s`, `max_elapsed_time: 300s`
- **Logs**: `exporters.otlp_http.sending_queue` — similar queue for VictoriaLogs export
- **Metrics**: `exporters.prometheusremotewrite` — Prometheus remote write has its own retry/buffer

**Init container** (`otel-collector-init`): Creates directory structure with correct ownership (UID 10001) at `/var/lib/otelcol/file_storage/victoriatraces/` before Collector starts.

**Chaos test validation**: After stopping VictoriaTraces/VictoriaLogs, verify Collector health check still passes (`:13133`) AND queue directory has pending files. After restart, verify all queued data appears.

### Victoria* API Endpoints for Test Validation

⚠️ **Version note**: Current docker-compose pins `victoriametrics/victoria-metrics:v1.138.0`. Latest stable is v1.144.0 (May 2026). LTS line is v1.136.x. API paths are stable across versions — no impact on test code. Upgrade is a separate backlog item (not in scope for this story).

**VictoriaTraces** (internal port 10428) — Jaeger-compatible JSON API:
```
GET /select/jaeger/api/traces/{traceID}                      — Get trace by ID (JSON array of spans)
GET /select/jaeger/api/services                              — List observed services (JSON array)
GET /select/jaeger/api/services/{service_name}/operations     — List span names for a service
GET /select/jaeger/api/traces?service={name}&limit=20        — Search recent traces for a service
GET /select/jaeger/api/dependencies                          — Service dependency graph
```
⚠️ **IMPORTANT**: All endpoints require `/select/jaeger/` prefix — NOT bare `/api/`.
- **Trace ID format**: 32-character lowercase hex, no dashes. Kong W3C `traceparent` format = 16-byte trace ID = 32 hex chars. **Must lowercase** before querying.
- **Response format**: `{"data": [{"traceID": "...", "spans": [...], "processes": {...}}]}` — `spans` array contains the full hierarchy.
- **Tempo proxy** (`tempo-proxy`, port 10429): Bridges VictoriaTraces → Grafana Tempo API. Grafana datasources use this. **Test validation should query VictoriaTraces directly at `:10428`** — simpler, avoids proxy dependency.

**VictoriaMetrics** (internal port 8428) — **Prometheus-compatible** API (NOT Prometheus — image is `victoriametrics/victoria-metrics:v1.138.0`):
```
GET /prometheus/api/v1/query?query={PromQL}             — Instant query
GET /prometheus/api/v1/query_range?query={PromQL}&start=...&end=...&step=...  — Range query
GET /prometheus/api/v1/series?match[]={metric_name}      — List matching series
```
⚠️ **IMPORTANT**: All endpoints require `/prometheus/` prefix — NOT bare `/api/v1/`.
- OTel auto-instrumented metric (current semantic conventions): `http.server.request.duration` (histogram, seconds)
  - VictoriaMetrics auto-converts to: `http_server_request_duration_count`, `http_server_request_duration_bucket`, `http_server_request_duration_sum`
  - Query example: `http_server_request_duration_count{service_name="gov-chat-backend"}`
- Custom metrics: `genie.ai/chat/request`, `rag.retrieval.requests`, `rag.ingestion.requests`, `rag.rerank.requests`
- Error metric: `http_server_request_duration_count{http_response_status_code=~"5.."}`

**VictoriaLogs** (internal port 9428) — LogQL query:
```
POST /select/logsql/query
Content-Type: application/json

{
  "query": "trace_id:\"abc123def4567890fedcba0987654321\"",
  "start": "2026-06-05T10:00:00Z",
  "end": "2026-06-05T10:05:00Z",
  "limit": 100
}
```
⚠️ **IMPORTANT**: LogQL trace_id filter requires **quoted value**: `trace_id:"{32hexchars}"` — NOT bare `trace_id:value`.
- Filter by container: `_stream:{container_name}`
- Alternative: combine filters: `trace_id:"abc123..." AND level:error`
- Logs arrive via fluentd driver with tag `genie.{{.Name}}` — structured JSON with `trace_id`, `span_id`, `service.name` fields injected by OTel Collector batch processor

**Grafana** (internal port 3000) — Dashboard/datasource proxy API:
```
# Query via datasource proxy (authenticated with admin token)
GET {GRAFANA_URL}/api/datasources/proxy/{uid}/api/v1/query?query=...
POST {GRAFANA_URL}/api/datasources/proxy/{uid}/loki/api/v1/query
GET {GRAFANA_URL}/api/datasources/proxy/{uid}/api/traces/{traceID}
```
- Authenticate via `Authorization: Bearer {GRAFANA_API_TOKEN}` or Basic auth with `GRAFANA_ADMIN_USER:GRAFANA_ADMIN_PASSWORD`
- Datasource UIDs: VictoriaMetrics = `${DS_VICTORIAMETRICS}`, VictoriaTraces = `${DS_VICTORIATRACES}` (via tempo-proxy), VictoriaLogs = VictoriaLogs datasource (victoriametrics-logs-datasource plugin)
- **Dashboards to validate**:
  - `service-health.json` — RED metrics (Rate, Errors, Duration) per service
  - `service-logs.json` — Log level filtering, trace ID search
  - `trace-explorer.json` — Trace waterfall, service map, latency breakdown
  - `application-metrics.json` — HTTP traffic, latency percentiles, chat RAG latency
  - `rag-pipeline-trace-waterfall.json` — RAG stage latency breakdown

### Key Technical Decisions

1. **Node.js for correlation/validation tests** (not k6 checks): k6 checks run during load generation. MELT validation queries Victoria* APIs after propagation delay — not a k6 concern. Node.js uses native `fetch` (Node 18+) — no extra deps. Keeps all MELT validation in JS ecosystem.

2. **k6 for overhead measurement only** (AC#7): k6 is the established load tool (`tests/metrics-overhead/k6-metrics-overhead.js`). Used here specifically for sustained load overhead measurement, not for MELT correlation validation.

3. **Playwright for LogSearchDialog** (AC#6): Component-level unit tests exist (`__tests__/components/LogSearchDialog.test.js`) but don't test with real backend data. Playwright E2E validates the full flow: trigger error → backend generates logs → dialog queries and displays them. Uses existing `tests/e2e/helpers/chatbot.js` auth helpers.

4. **Chaos tests as separate optional suite** (AC#4–#5): Chaos tests require `docker compose stop/start` — destructive, slow, needs cleanup. Default runner skips chaos (`--skip-chaos` flag). CI runs as separate job with longer timeout.

5. **Internal service communication**: All Victoria* queries MUST run from inside the Docker network (via `docker exec` or test container). Ports 10428, 8428, 9428 are container-only. Only nginx (80, 443) and ArangoDB (8529) are host-exposed.

6. **Eventual consistency tolerance**: Victoria* backends may lag 5-15s behind ingestion. Validation scripts include configurable wait/retry: default 15s delay, then up to 3 retries with 10s intervals.

7. **Graceful degradation**: Tests run against `ENABLE_OBSERVABILITY=1` deployments only. If services unreachable, exit code 2 (not failure). CI `rules:` conditional skips job when observability disabled.

### Source Tree — Files to Create/Modify

**NEW files:**
| File | Purpose |
|------|---------|
| `tests/melt-correlation/melt-utils.js` | Shared Victoria* query helpers + JUnit XML generator |
| `tests/melt-correlation/correlation.test.js` | Core MELT correlation test (AC#1, #2) |
| `tests/melt-correlation/grafana-verify.js` | Grafana dashboard datasource verification (AC#3) |
| `tests/melt-correlation/chaos-resilience.test.js` | Chaos resilience tests (AC#4, #5) |
| `tests/melt-correlation/k6-collector-overhead.js` | k6 overhead benchmark (AC#7) |
| `tests/melt-correlation/run-melt-test.sh` | Orchestration runner script |
| `tests/e2e/observability/log-search-dialog.spec.js` | Playwright LogSearchDialog E2E (AC#6) |

**MODIFY files:**
| File | Change |
|------|--------|
| `package.json` | Add `test:melt`, `test:melt:correlation`, `test:melt:chaos` scripts |
| `.gitlab-ci.yml` | Add `melt-correlation` job(s) in `scheduled` stage |
| `configs/otel/README.md` | Add "MELT Correlation Tests" documentation section |

### Existing Patterns to Follow

- **k6 pattern**: `tests/metrics-overhead/k6-metrics-overhead.js` — env var config, `http.get()`, Trend/Rate metrics, `check()`, threshold assertions
- **Shell runner pattern**: `tests/rag-benchmarks/run_benchmarks.sh` — argument parsing, prerequisite checks, exit codes
- **JUnit XML format**: Follow `jest-junit` output format. k6 outputs JSON — needs conversion wrapper or Node.js JUnit template (keep deps minimal, prefer string template over `xmlbuilder2`)
- **Playwright pattern**: `tests/e2e/helpers/chatbot.js` — `loginViaUI()`, `navigateToChatbot()`, `sendMessage()`. Config: `playwright.config.js` (tests/e2e/, Chromium, ignoreHTTPSErrors, JUnit reporter)
- **LogSearchDialog tests**: `components/gov-chat-frontend/__tests__/components/LogSearchDialog.test.js` — existing unit test patterns, element selectors for the dialog
- **CI conditional**: Follow `.gitlab-ci.yml` patterns for `rules:` with variable conditions and `changes` paths
- **Backend observability tests**: `components/gov-chat-backend/__tests__/trace-propagation.test.js`, `logger-otel-trace.test.js` — patterns for asserting OTel trace context propagation and log correlation
- **Log assertions helpers**: `tests/log-assertions/log-assertions.js` — existing structured log assertion utilities for JS

### CI Tier Classification

Per architecture §Test Execution Tiers, MELT tests are **Scheduled tier**:

| Tier | Tests | Trigger | Time Budget |
|------|-------|---------|-------------|
| Mandatory | Lint, Unit, Config | Every MR + main push | <10 min |
| **Scheduled** | **Integration, E2E, MELT correlation** | **Nightly** | **<30 min** |
| On-demand | RAG quality, Performance | Manual trigger | <60 min |

Chaos tests run as separate CI job with longer timeout (not in the main scheduled pipeline).

### Previous Story Intelligence (7-9: Kong OTel Tracing)

Story 7-9 added Kong `opentelemetry` plugin to `kong_config.json`, conditional activation via `ENABLE_OBSERVABILITY`, and `trace-explorer.json` Grafana dashboard. Key learnings:

- Kong injects W3C `traceparent` header on outbound requests — backend reads this automatically
- Kong `opentelemetry` plugin defaults `enabled: false` in declarative config; `restore-kong-config.sh` enables it when `ENABLE_OBSERVABILITY=1`
- VictoriaTraces uses Tempo datasource type in Grafana — Jaeger JSON API works at `:10428`
- Kong spans have `service.name = "kong-gateway"` (resource attribute in config)
- OTel Collector `probabilistic_sampler` defaults to 100% sampling (`OTEL_TRACES_SAMPLER_RATE=100.0`)
- Tempo proxy (`tempo-proxy`, port 10429) bridges VictoriaTraces → Grafana Tempo API

### PII Enforcement

All test queries MUST respect PII rules (from `configs/otel/README.md`):
- No `user_id`, `email`, `query_text`, `document_text`, `session_id`, `conversation_id` in assertions
- Trace IDs are not PII (random hex strings)
- Log queries filter by `trace_id` attribute only — never by log message content
- Known error generation (AC#1) must NOT use real user queries — use synthetic invalid requests

### Testing Standards

- JUnit XML output for CI compatibility (FR6, architecture §JUnit XML Reporting)
- k6 results need conversion to JUnit XML — k6 natively outputs JSON, use Node.js wrapper
- Configurable via environment variables (no hardcoded URLs)
- Skip with clear message when prerequisites not met
- ESLint compliance for `.js` files (ESLint 10 flat config, PostToolUse hook auto-runs)
- Shell scripts follow existing patterns (argument parsing, exit codes)
- Playwright tests follow existing config (`playwright.config.js` — single worker, no retries, JUnit reporter)

### Project Structure Notes

- `tests/melt-correlation/` at root level — consistent with `tests/metrics-overhead/`, `tests/rag-benchmarks/`, `tests/rag-quality/`, `tests/log-assertions/`
- `tests/e2e/observability/` — new subdirectory under existing `tests/e2e/` (alongside `chatbot/`, `documents/`, `epic1/`, etc.)
- `reports/` directory for JUnit XML output (consistent with existing test runners)
- Root `tests/` is shared test infrastructure (architecture §Cross-Component Test Boundaries)

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.10] — Original epic ACs (8 acceptance criteria)
- [Source: _bmad-output/planning-artifacts/epics.md#Story 7.6] — OTel Collector file-based buffer strategy
- [Source: configs/otel/README.md#Architecture] — Collector pipeline diagram
- [Source: configs/otel/otel-collector-config.yaml] — Full Collector config (receivers, processors, exporters, sending_queue)
- [Source: configs/grafana/provisioning/dashboards/] — 5 dashboard JSON files (service-health, service-logs, trace-explorer, application-metrics, rag-pipeline-trace-waterfall)
- [Source: configs/grafana/provisioning/datasources/vtraces-datasource.yml] — VictoriaTraces via tempo-proxy (:10429)
- [Source: configs/grafana/provisioning/datasources/vlogs-datasource.yml] — VictoriaLogs with derived TraceID/SpanID fields
- [Source: configs/grafana/provisioning/datasources/vm-datasource.yml] — VictoriaMetrics Prometheus datasource (:8428)
- [Source: docker-compose.yaml:1419-1588] — VictoriaMetrics, VictoriaLogs, VictoriaTraces, tempo-proxy, Grafana service definitions
- [Source: docker-compose.yaml:1365-1371] — OTel init container (file_storage directory setup)
- [Source: tests/metrics-overhead/k6-metrics-overhead.js] — Existing k6 test pattern
- [Source: tests/e2e/helpers/chatbot.js] — Playwright auth/navigation helpers
- [Source: tests/rag-benchmarks/run_benchmarks.sh] — Shell runner pattern
- [Source: components/gov-chat-frontend/src/components/LogSearchDialog.vue] — LogSearchDialog component
- [Source: components/gov-chat-frontend/__tests__/components/LogSearchDialog.test.js] — Existing LogSearchDialog unit tests
- [Source: components/gov-chat-backend/__tests__/trace-propagation.test.js] — OTel trace propagation test patterns
- [Source: tests/log-assertions/log-assertions.js] — Structured log assertion utilities
- [Source: _bmad-output/planning-artifacts/architecture.md#Test Execution Tiers] — CI tier classification
- [Source: _bmad-output/planning-artifacts/architecture.md#JUnit XML Reporting] — Universal CI artifact format
- [Source: _bmad-output/implementation-artifacts/7-9-kong-otel-tracing.md] — Kong OTel tracing implementation

## Dev Agent Record

### Agent Model Used

glm-5-turbo

### Debug Log References

### Completion Notes List

- Created MELT correlation test infrastructure with shared utilities (melt-utils.js) covering VictoriaTraces, VictoriaMetrics, VictoriaLogs APIs
- Implemented 6 test files: correlation, Grafana verification, chaos resilience, Playwright log search, k6 overhead, orchestration runner
- Added root-level ESLint config (eslint.config.js) for tests/ directory — integrated with existing lint-staged + npm scripts
- Added 2 GitLab CI jobs (scheduled:melt-correlation, scheduled:melt-chaos) with JUnit artifact collection
- Updated configs/otel/README.md with comprehensive MELT test documentation
- All CommonJS files pass ESLint + Prettier; k6 file uses ES modules (expected exclusion)

### Change Log

| Date | Change |
|------|--------|
| 2026-06-05 | Initial implementation — 8 tasks completed, 10 files created/modified |

### File List

**New files:**
- `tests/melt-correlation/melt-utils.js` — Shared MELT utilities (Victoria* queries, JUnit XML, assertions)
- `tests/melt-correlation/correlation.test.js` — Core MELT correlation test (AC#1, AC#2, AC#8)
- `tests/melt-correlation/grafana-verify.js` — Grafana datasource proxy verification (AC#3)
- `tests/melt-correlation/chaos-resilience.test.js` — Chaos resilience test (AC#4, AC#5)
- `tests/melt-correlation/k6-collector-overhead.js` — k6 OTel overhead benchmark (AC#7)
- `tests/melt-correlation/run-melt-test.sh` — Orchestration runner script
- `tests/e2e/observability/log-search-dialog.spec.js` — Playwright Grafana log search test (AC#6)
- `eslint.config.js` — Root-level ESLint config for tests/ directory

**Modified files:**
- `package.json` — Added lint:tests/format:tests scripts, test:melt* scripts, lint-staged for tests/
- `.gitlab-ci.yml` — Added scheduled:melt-correlation and scheduled:melt-chaos CI jobs
- `configs/otel/README.md` — Added MELT Correlation Tests documentation section
