# Story 7.10: E2E MELT Correlation Test

Status: ready-for-dev

## Story

As a DevOps engineer,
I want end-to-end MELT (Metrics, Events/Errors, Logs, Traces) correlation validation across the full observability stack,
so that I can verify the MELT observability promise holds under real conditions.

## Acceptance Criteria

1. **AC1 — k6 Load Generation**: A k6 script generates realistic HTTP load (≥20 requests) against the backend health endpoint with trace context headers, producing unique trace IDs for each request.

2. **AC2 — Trace Completeness**: After the k6 test completes, traces are queryable in VictoriaTraces via its Jaeger-compatible JSON API (`/api/traces/{traceID}`), containing the full span hierarchy: Kong → Backend → (optional OPEA child spans).

3. **AC3 — Metrics Reflection**: VictoriaMetrics exposes Prometheus-compatible metrics reflecting the k6-generated load — specifically `http_server_duration_milliseconds_count` with expected service labels, queryable via `/api/v1/query`.

4. **AC4 — Log Correlation**: Container logs are queryable in VictoriaLogs via LogQL, containing `trace_id` attributes matching the k6-generated trace IDs, confirming fluentd → Collector → VictoriaLogs pipeline.

5. **AC5 — Cross-Correlation**: A single trace ID extracted from k6 output successfully retrieves data from all three backends (VictoriaTraces, VictoriaMetrics, VictoriaLogs), proving the correlation loop is closed.

6. **AC6 — Structured Report**: The test outputs a JUnit XML report compatible with Sprint 23 MELT Provider API ingestion, containing per-AC pass/fail results with trace IDs as evidence fields.

## Tasks / Subtasks

- [ ] Task 1: Create k6 MELT correlation test script (AC: #1, #2, #3, #4, #5)
  - [ ] 1.1 Create `tests/melt-correlation/k6-melt-correlation.js` — k6 script that:
    - Sends ≥20 HTTP requests to `BASE_URL/api/health` (or configurable endpoint)
    - Captures `x-b3-traceid` or `traceparent` response headers to extract trace IDs
    - Exports trace IDs via `JSON.stringify()` to a shared results file for post-test validation
    - Records request timing metrics via k6 Trends
    - Accepts env vars: `BASE_URL`, `TOKEN`, `VUS`, `DURATION`, `RESULTS_FILE`
  - [ ] 1.2 Add graceful handling for environments without observability (skip with warning if services unreachable)

- [ ] Task 2: Create post-test MELT validation script (AC: #2, #3, #4, #5, #6)
  - [ ] 2.1 Create `tests/melt-correlation/validate-melt.js` — Node.js script that:
    - Reads trace IDs from k6 results file
    - Queries VictoriaTraces `/api/traces/{traceID}` for each trace (internal port 10428)
    - Validates span hierarchy exists (root span + child spans)
    - Queries VictoriaMetrics `/api/v1/query` for `http_server_duration_milliseconds_count` with time range covering k6 run
    - Queries VictoriaLogs `/select/logsql/query` for logs with matching `trace_id` attribute
    - Performs cross-correlation: same trace ID found in traces + metrics labels + logs
    - Outputs JUnit XML report (`reports/melt-correlation-report.xml`) with per-AC pass/fail and evidence (trace IDs, metric values, log counts)
  - [ ] 2.2 Add configurable timeouts and retry logic for eventual consistency (Victoria* may lag 5-15s behind ingestion)

- [ ] Task 3: Create orchestration runner (AC: #1–#6)
  - [ ] 3.1 Create `tests/melt-correlation/run-melt-test.sh` — shell script that:
    - Validates prerequisite services are reachable (VictoriaTraces:10428, VictoriaMetrics:8428, VictoriaLogs:9428, OTel Collector:4318)
    - Runs k6 script with proper env vars
    - Waits for propagation delay (configurable, default 15s)
    - Runs post-test validation script
    - Exits with code 0 (all pass), 1 (any failure), or 2 (services unreachable)
    - Produces combined JUnit XML report
  - [ ] 3.2 Add npm script: `"test:melt": "bash tests/melt-correlation/run-melt-test.sh"` in root `package.json`

- [ ] Task 4: GitLab CI integration (AC: #6)
  - [ ] 4.1 Add `melt-correlation` job to `.gitlab-ci.yml` under a new `observability` stage
  - [ ] 4.2 Job runs only when `ENABLE_OBSERVABILITY=1` (conditional via `rules:`)
  - [ ] 4.3 Job requires Docker Compose observability stack running (triggered after integration tests in scheduled pipeline)
  - [ ] 4.4 Artifact: JUnit XML report (`reports/melt-correlation-report.xml`)

- [ ] Task 5: Documentation (AC: #1–#6)
  - [ ] 5.1 Update `configs/otel/README.md` with MELT correlation test section (how to run, prerequisites, expected output)
  - [ ] 5.2 Add inline comments in scripts explaining Victoria* API endpoints and query formats

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

### Victoria* API Endpoints for Test Validation

**VictoriaTraces** (internal port 10428) — Jaeger-compatible JSON API:
```
GET /api/traces/{traceID}        — Get trace by ID (JSON)
GET /api/services                  — List observed services
GET /api/operations?service=X     — List operations for a service
```
- **Trace ID format**: 32-character hex (lowercase, no dashes). Kong uses W3C `traceparent` header format (16-byte trace ID = 32 hex chars).
- **Encoding note**: VictoriaTraces v0.9.2 only supports protobuf for OTLP ingestion. JSON queries via Jaeger API work normally.
- **Tempo proxy** (`tempo-proxy` service, port 10429): Bridges VictoriaTraces to Grafana Tempo API. Grafana datasources use this proxy (`http://tempo-proxy:10429`). Test validation should query VictoriaTraces directly at `:10428` (native Jaeger API) — simpler and avoids proxy dependency.

**VictoriaMetrics** (internal port 8428) — Prometheus-compatible:
```
GET /api/v1/query?query=<PromQL>          — Instant query
GET /api/v1/query_range?query=<PromQL>      — Range query
```
- Key metric: `http_server_duration_milliseconds_count` (from OTel SDK auto-instrumentation)
- Custom metrics: `genie.ai/chat/request`, `rag.retrieval.requests`, `rag.ingestion.requests`, `rag.rerank.requests`

**VictoriaLogs** (internal port 9428) — LogQL query:
```
POST /select/logsql/query      — LogQL query (JSON body)
```
- Query example: `trace_id:abc123def456...` or `_stream:{container_name}`
- Logs arrive via fluentd driver with tag `genie.{{.Name}}`

### Key Technical Decisions

1. **k6 for load generation** (not Playwright): k6 is the established tool for HTTP load testing in this project (`tests/metrics-overhead/k6-metrics-overhead.js`). Playwright is for browser E2E — this test targets backend API-level MELT correlation, not UI.

2. **Post-test validation as separate Node.js script** (not k6 checks): k6 checks run during load. MELT validation needs to query Victoria* APIs after propagation delay — not a k6 concern. Node.js keeps it in the JS ecosystem with the rest of the test infrastructure. Uses native `fetch` (Node 18+) — no extra deps.

3. **Internal service communication**: Tests MUST run from inside the Docker network (via `docker exec` or a test container) to reach Victoria* internal ports. External hosts cannot access ports 10428, 8428, 9428 — these are container-only.

4. **Eventual consistency tolerance**: Victoria* backends may lag 5-15 seconds behind ingestion. The validation script MUST include configurable wait/retry logic. Default: 15s delay after k6 completes, then up to 3 retries with 10s intervals.

5. **Graceful degradation**: Tests run against `ENABLE_OBSERVABILITY=1` deployments only. If services are unreachable, tests skip with exit code 2 (not failure). CI job uses `rules:` conditional to skip when observability is disabled.

### Source Tree — Files to Create/Modify

**NEW files:**
| File | Purpose |
|------|---------|
| `tests/melt-correlation/k6-melt-correlation.js` | k6 load script with trace ID capture |
| `tests/melt-correlation/validate-melt.js` | Node.js MELT validation + JUnit XML reporter |
| `tests/melt-correlation/run-melt-test.sh` | Orchestration runner script |

**MODIFY files:**
| File | Change |
|------|--------|
| `package.json` | Add `"test:melt"` script |
| `.gitlab-ci.yml` | Add `melt-correlation` job in `observability` stage |
| `configs/otel/README.md` | Add MELT correlation test documentation section |

### Existing Patterns to Follow

- **k6 pattern**: Follow `tests/metrics-overhead/k6-metrics-overhead.js` — env var config, `http.get()`, Trend/Rate metrics, `check()`.
- **Shell runner pattern**: Follow `tests/rag-benchmarks/run_benchmarks.sh` — argument parsing, prerequisite checks, exit codes.
- **JUnit XML**: Use existing `jest-junit` output format for compatibility. Node.js can use `xmlbuilder2` or simple string template (keep deps minimal).
- **CI conditional**: Follow existing `.gitlab-ci.yml` patterns for `rules:` with variable conditions.
- **Backend observability tests**: `components/gov-chat-backend/__tests__/metrics.test.js`, `trace-propagation.test.js`, `logger-otel-trace.test.js` — patterns for asserting OTel behavior.
- **Log assertions helpers**: `tests/log-assertions/log-assertions.js` — existing structured log assertion utilities.

### Previous Story Intelligence (7-9: Kong OTel Tracing)

Story 7-9 added Kong `opentelemetry` plugin to `kong_config.json`, conditional activation via `ENABLE_OBSERVABILITY`, and a `trace-explorer.json` Grafana dashboard. Key learnings:

- Kong injects W3C `traceparent` header on outbound requests — backend reads this automatically
- Kong `opentelemetry` plugin defaults `enabled: false` in declarative config; `restore-kong-config.sh` enables it when `ENABLE_OBSERVABILITY=1`
- VictoriaTraces uses Tempo datasource type in Grafana — Jaeger JSON API works at `:10428`
- Kong spans have `service.name = "kong-gateway"` (resource attribute in config)
- OTel Collector `probabilistic_sampler` defaults to 100% sampling

### PII Enforcement

All test queries MUST respect PII rules (from `configs/otel/README.md`):
- No `user_id`, `email`, `query_text`, `document_text`, `session_id`, `conversation_id` in assertions
- Trace IDs are not PII (random hex strings)
- Log queries should filter by `trace_id` attribute, never by log message content containing user data

### Testing Standards

- JUnit XML output for CI compatibility (FR6)
- Configurable via environment variables (no hardcoded URLs)
- Skip with clear message when prerequisites not met (GPU-conditional pattern from architecture)
- ESLint compliance for `.js` files (ESLint 10 flat config)
- Shell scripts follow existing patterns (argument parsing, exit codes)

### Project Structure Notes

- New `tests/melt-correlation/` directory at root level — consistent with `tests/metrics-overhead/`, `tests/rag-benchmarks/`, `tests/rag-quality/` pattern
- Root `tests/` directory is shared test infrastructure (architecture §Cross-Component Test Boundaries)
- `reports/` directory for JUnit XML output (consistent with existing test runners)

### References

- [Source: configs/otel/README.md#Architecture] — Collector pipeline diagram
- [Source: configs/otel/otel-collector-config.yaml] — Full Collector config with receivers, processors, exporters
- [Source: configs/grafana/provisioning/dashboards/trace-explorer.json] — Grafana dashboard using VictoriaTraces Tempo datasource, VictoriaMetrics Prometheus datasource
- [Source: configs/grafana/provisioning/datasources/vtraces-datasource.yml] — VictoriaTraces datasource via tempo-proxy (:10429)
- [Source: configs/grafana/provisioning/datasources/vlogs-datasource.yml] — VictoriaLogs datasource with derived TraceID/SpanID fields
- [Source: configs/grafana/provisioning/datasources/vm-datasource.yml] — VictoriaMetrics Prometheus datasource (:8428)
- [Source: docker-compose.yaml:1419-1588] — VictoriaMetrics, VictoriaLogs, VictoriaTraces, tempo-proxy, Grafana service definitions
- [Source: tests/metrics-overhead/k6-metrics-overhead.js] — Existing k6 test pattern with env vars, check, Trend/Rate
- [Source: tests/rag-benchmarks/run_benchmarks.sh] — Existing shell runner pattern
- [Source: _bmad-output/implementation-artifacts/7-9-kong-otel-tracing.md] — Kong OTel tracing implementation details
- [Source: _bmad-output/planning-artifacts/architecture.md#Test Framework Decisions] — Test runner choices, JUnit XML strategy

## Dev Agent Record

### Agent Model Used

glm-5-turbo

### Debug Log References

### Completion Notes List

### File List
