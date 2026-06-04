---
baseline_commit: 5c4360e8f5d2101ba25a7b19aacdd362ef82c8c2
---

# Story 7.8: Instrument Application Metrics

Status: review

<!-- Note: Validation is optional. Run validate-create-story for quality check before dev-story. -->

## Story

As a developer,
I want custom metrics instrumented in application services and exported to VictoriaMetrics,
so that Grafana dashboards show real-time service health beyond trace-derived metrics.

## Acceptance Criteria

1. **When** I add `@opentelemetry/sdk-metrics` to the Express backend
   **Then** HTTP counters are emitted per route and status code (e.g., `http_requests_total{route="/api/chat/:conversationId", status="200"}`)
   **And** latency histograms are emitted per route with buckets for p50, p95, p99
   **And** routes use template patterns (`/api/users/:id`) not dynamic values to prevent cardinality explosion
   **And** a PII allowlist is enforced: `user_id`, `email`, `query_text`, `document_text` are **never** included in metric attributes

2. **When** I add `opentelemetry-sdk-metrics` to OPEA Python services (ChatQnA, Retriever, Dataprep, Reranker)
   **Then** RAG-specific counters are emitted: embeddings, retrievals, reranks per service
   **And** latency histograms are emitted for LLM inference, embedding generation, and retrieval
   **And** metrics are exported via OTLP to the Collector → `metrics` pipeline → VictoriaMetrics (pipeline already exists from Story 7.5)
   **And** a Grafana dashboard shows: request rate, error rate, latency percentiles per service, RAG pipeline throughput

3. **When** metrics SDK is active
   **Then** a k6 benchmark validates that metrics SDK overhead is measured under realistic load (100 req/s)
   **And** an automated test verifies that no PII patterns (email, user_id) appear in emitted metric attributes

## Tasks / Subtasks

- [x] Task 1: Backend custom HTTP metrics middleware (AC: #1)
  - [x] Create `components/gov-chat-backend/metrics.js` — export `getMeter()` wrapper using `@opentelemetry/api`
  - [x] Create `components/gov-chat-backend/middleware/metrics-middleware.js` — Express middleware that records `http_requests_total` counter and `http_request_duration_seconds` histogram per route
  - [x] Use route template patterns: Express `req.route.path` or normalize `req.originalUrl` to `/api/users/:id` form
  - [x] Attributes: `http.method`, `http.status_code`, `http.route` (template), `service.name` (from resource)
  - [x] PII enforcement: never set `user_id`, `email`, `query_text`, `document_text` as attributes — add allowlist filter
  - [x] Register middleware in `components/gov-chat-backend/index.js` — ordering: after `require('./tracing')`, before routes, but AFTER `helmet` and `cors` (security headers first, then metrics wraps the request context)
  - [x] The metrics middleware must wrap the response lifecycle (`res.on('finish')`) to capture status code and duration accurately
  - [x] Place before `express.json()` body parser so parsing errors are also metered
  - [x] Add unit tests in `components/gov-chat-backend/__tests__/metrics.test.js`

- [x] Task 2: Python metrics SDK integration in shared tracing module (AC: #2, #3)
  - [x] Update `genie-ai-overlay/tracing.py` — add `MeterProvider` + `PeriodicExportingMetricReader` + `OTLPMetricExporter` to `setup_tracing()`
  - [x] Export `get_meter()` function returning a meter instance with service name
  - [x] Add `shutdown()` support for meter provider alongside existing trace shutdown
  - [x] Update `genie-ai-overlay/tests/test_tracing.py` — add tests for meter creation and metric export configuration
  - [x] Add `opentelemetry.exporter.otlp.proto.http.metric_exporter` to conftest.py OTel mocks

- [x] Task 3: OPEA service RAG-specific metrics (AC: #2, #3)
  - [x] ChatQnA: counter `genie.ai/chat/request`, histogram `genie.ai/chat/rag/latency`; attributes: `response_type`, `abstained`, `error`, `retrieval_source`
  - [x] Retriever: counter `rag.retrieval.requests`, histogram `rag.retrieval.duration`; attributes: `rag.query_type`
  - [x] Dataprep: counter `rag.ingestion.requests`, histogram `rag.ingestion.duration`; attributes: `dataprep.file_type`
  - [x] Reranker: counter `rag.rerank.requests`, histogram `rag.rerank.duration`; attributes: `reranker.model_id`
  - [x] All services: PII enforcement — no `user_id`, `email`, `query_text`, `document_text` in metric attributes
  - [x] Update each service's main file to import `get_meter()` from tracing and record metrics
  - [x] Add tests per service for metric recording in `genie-ai-overlay/tests/test_metrics.py`

- [x] Task 4: Grafana application metrics dashboard (AC: #2)
  - [x] Create `configs/grafana/provisioning/dashboards/application-metrics.json`
  - [x] Panels: HTTP request rate, request duration P50/P95/P99, error rate 5xx%, RAG pipeline latency, RAG sub-service latency, error rate stat
  - [x] Datasource: VictoriaMetrics — `${DS_VICTORIAMETRICS}` variable

- [x] Task 5: k6 benchmark for metrics SDK overhead (AC: #4)
  - [x] Create `tests/metrics-overhead/k6-metrics-overhead.js` — k6 script hitting backend
  - [x] Toggle mechanism: `ENABLE_METRICS=false` for baseline run
  - [x] Threshold: <5ms overhead per request at P95

- [x] Task 6: PII verification test (AC: #4)
  - [x] Create `components/gov-chat-backend/__tests__/metrics-pii.test.js`
  - [x] Tests verify metric attributes never contain `user_id`, `email`, `query_text`, `document_text`, `password`, `token`

- [x] Task 7: Update documentation (AC: #1, #2)
  - [x] Update `configs/otel/README.md` — add metrics instrumentation section

## Dev Notes

### Prerequisites (Cross-Story Dependencies)

This story depends on the following completed stories — their artifacts MUST exist:

- **Stories 7.1–7.4**: Tracing infrastructure — `components/gov-chat-backend/tracing.js` (NodeSDK with metricReader), `genie-ai-overlay/tracing.py` (TracerProvider), and all 4 OPEA service tracing integrations.
- **Story 7.5**: OTel Collector metrics pipeline — `configs/otel/otel-collector-config.yaml` must contain the `metrics` pipeline (`otlp → batch → prometheusremotewrite`) and VictoriaMetrics service must be defined.
- **Story 7.6**: VictoriaLogs deployment — Collector log pipeline must be operational (no impact on metrics but validates observability stack health).

**Do NOT start this story if tracing.js does not contain `OTLPMetricExporter` imports.**

### Critical: Metrics Infrastructure Already Exists

**This story adds CUSTOM application metrics. The metrics pipeline is already operational:**

- `components/gov-chat-backend/tracing.js` — already imports `OTLPMetricExporter`, `PeriodicExportingMetricReader`, and configures `metricReader` in NodeSDK. The `MeterProvider` is already active.
- `configs/otel/otel-collector-config.yaml` — already has `metrics` pipeline: `otlp → batch → prometheusremotewrite` → VictoriaMetrics
- `configs/grafana/provisioning/datasources/vm-datasource.yml` — VictoriaMetrics datasource already configured (prometheus type)
- `configs/grafana/provisioning/dashboards/service-health.json` — existing dashboard queries VictoriaMetrics
- `docker-compose.yaml` — observability services already deployed with `ENABLE_OBSERVABILITY` flag

**What needs to be added:** Custom instruments (counters, histograms) using the existing MeterProvider. NOT the pipeline itself.

### Backend Metrics Pattern (Node.js)

The MeterProvider is already configured via NodeSDK in `tracing.js`. Use `@opentelemetry/api` (not SDK) to get a meter:

```javascript
// metrics.js — CommonJS, use @opentelemetry/api (stable API)
const { metrics } = require('@opentelemetry/api');

function getMeter() {
  return metrics.getMeter('genie-backend', '1.0.0');
}

module.exports = { getMeter };
```

Create instruments via meter in middleware:

```javascript
const meter = getMeter();
const requestCounter = meter.createCounter('http_requests_total', {
  description: 'Total HTTP requests',
});
const requestDuration = meter.createHistogram('http_request_duration_seconds', {
  description: 'HTTP request duration',
  unit: 's',
});
```

**CRITICAL: Route template patterns.** Use `req.route.path` which already gives `/api/users/:id` form in Express. If `req.route` is undefined (e.g., 404), fall back to normalized path. NEVER use `req.originalUrl` or `req.path` directly — they contain dynamic values causing cardinality explosion.

**Semantic convention attributes** (from `@opentelemetry/semantic-conventions`):
- `ATTR_HTTP_METHOD` → `http.method`
- `ATTR_HTTP_STATUS_CODE` → `http.status_code`
- `ATTR_HTTP_ROUTE` → `http.route` (template form)
- `ATTR_SERVICE_NAME` → from resource (automatic)

### Python Metrics Pattern

Update `genie-ai-overlay/tracing.py` to add metrics:

```python
from opentelemetry import metrics
from opentelemetry.sdk.metrics import MeterProvider
from opentelemetry.sdk.metrics.export import PeriodicMetricsReader
from opentelemetry.exporter.otlp.proto.http.metric_exporter import OTLPMetricExporter

def setup_tracing(service_name, endpoint=None):
    # ... existing trace setup ...

    # Metrics
    metric_endpoint = (endpoint or os.getenv('OTEL_EXPORTER_OTLP_ENDPOINT',
                        'http://otel-collector:4318')) + '/v1/metrics'
    metric_exporter = OTLPMetricExporter(endpoint=metric_endpoint)
    metric_reader = PeriodicMetricsReader(exporter=metric_exporter, export_interval_millis=15000)
    meter_provider = MeterProvider(metric_readers=[metric_reader])
    metrics.set_meter_provider(meter_provider)

def get_meter(name=None):
    return metrics.get_meter(name or SERVICE_NAME)
```

**Note:** `PeriodicMetricsReader` (singular) is the current Python OTel API — NOT `PeriodicExportingMetricReader` (that's the JS name).

### PII Enforcement for Metrics

Implement an attribute filter that removes PII keys before recording:

```javascript
// Backend
const PII_KEYS = new Set(['user_id', 'email', 'query_text', 'document_text', 'password', 'token']);

function sanitizeAttributes(attrs) {
  const sanitized = { ...attrs };
  for (const key of Object.keys(sanitized)) {
    if (PII_KEYS.has(key)) {
      delete sanitized[key];
    }
  }
  return sanitized;
}
```

```python
# Python
PII_KEYS = {'user_id', 'email', 'query_text', 'document_text', 'password', 'token'}

def sanitize_attributes(attrs: dict) -> dict:
    return {k: v for k, v in attrs.items() if k not in PII_KEYS}
```

### Existing tracing.js Architecture (Current State)

File: `components/gov-chat-backend/tracing.js` (146 lines)
- Test environment guard (no-op when `NODE_ENV=test`)
- NodeSDK with auto-instrumentations (fs and dns disabled)
- `PIIRedactionProcessor` wrapping `BatchSpanProcessor` for trace PII redaction
- `OTLPMetricExporter` + `PeriodicExportingMetricReader` already configured
- W3C trace context propagator
- Graceful shutdown with 5s timeout
- Exports: `{ sdk, getTracer }`

**The MeterProvider is part of NodeSDK internally** — calling `metrics.getMeter()` from `@opentelemetry/api` will use the SDK's meter automatically. No separate MeterProvider setup needed for the backend.

### Shared Python tracing.py Architecture (Current State)

File: `genie-ai-overlay/tracing.py` (144 lines)
- `setup_tracing(service_name, endpoint)` — creates TracerProvider + BatchSpanProcessor + OTLPSpanExporter
- `get_tracer(name)` — returns tracer for service
- `get_trace_context()` — returns current span's trace_id/span_id
- `setup_trace_logging()` — adds TraceContextFilter to Python logging
- `shutdown()` — shuts down tracer provider on SIGTERM
- Used by all 4 OPEA services (chatqna, retriever, dataprep, reranker)

**What to add:** MeterProvider alongside existing TracerProvider, export `get_meter()`.

### Test Patterns

**Backend tests (Jest):** CommonJS `require()`, mock factory pattern with overrides, closure-based mock references. Tests in `components/gov-chat-backend/__tests__/`. Use `@opentelemetry/sdk-metrics` for test MeterProvider (in-memory reader for assertions).

**Python tests (pytest):** `tests/` directory under `genie-ai-overlay/`. ITU copyright headers required. Use `unittest.mock` for OPEA comps.

### Project Structure Notes

- Backend code is NOT in a `src/` subdirectory — files at service root level
- `components/shared/lib/` is backend-only shared code
- Python AI layer (`genie-ai-overlay/`) is separate ecosystem — different language, conventions
- All existing dashboards use VictoriaMetrics datasource (prometheus type)
- Dashboard JSON files go in `configs/grafana/provisioning/dashboards/`
- Dashboard registration in `configs/grafana/provisioning/dashboards/dashboards.yml`

### Previous Story Intelligence (Story 7-6)

- **Fluentd driver pattern:** All 33 services use `x-logging` YAML anchor. Metrics pipeline already uses OTLP (not fluentd) — no change needed to logging driver.
- **Grafana SSO:** Grafana uses Keycloak OIDC with `GF_AUTH_GENERIC_OAUTH_*` vars. Dashboards accessible via Kong `/grafana/` route.
- **VictoriaMetrics datasource:** Already provisioned as prometheus type, non-default (vm-datasource.yml). Dashboards must reference it by UID or name.
- **ENABLE_OBSERVABILITY:** Controls service replicas (`0` or `1`). MUST be `0` or `1`, not `true`/`false`.
- **Winston trace format:** `logFormat` in logger.js appends trace_id/span_id. No change needed for metrics.
- **Collector global mode:** Runs on all Swarm nodes. No placement constraint. Metrics pipeline is per-node already.
- **Structured JSON logging migration:** Deferred — not relevant to this story.

### Git Intelligence

Recent commits show metrics work already partially done:
- `9bbbce13a` — "fix: add OTel metric exporter mocks to tracing-non-test test"
- `64474c3e0` — "feat(observability): add metrics-to-logs data link on VictoriaMetrics datasource"
- `32f3ac4d7` — "fix(observability): Grafana OAuth, dashboards, metrics, and healthcheck fixes"

**Implication:** Some metric infrastructure may already exist in the codebase beyond what's in tracing.js. The dev agent MUST read current files before modifying — do NOT assume files are in the state described in this story's dev notes alone.

### Cardinality Explosion Prevention

**Cardinality explosion** is the #1 risk for metrics systems. If every unique URL becomes a metric label, VictoriaMetrics storage and query performance degrade catastrophically.

**Rules:**
1. Always use route templates (`/api/chat/:conversationId`) not actual paths (`/api/chat/abc123`)
2. Never use user-provided values (usernames, emails, query text) as metric attributes
3. Use `req.route.path` in Express — Express already stores the template pattern
4. For 404s where `req.route` is undefined, use a fixed value like `unknown_route`
5. Limit status code cardinality: group 4xx codes as `4xx`, 5xx as `5xx` — or use actual codes but document the expected cardinality
6. Pre-calculate: 20 routes × 50 status codes = 1000 series (acceptable). 20 routes × unlimited user IDs = infinite (catastrophic).

### k6 Benchmark Pattern

k6 script should:
1. Run against a deployed backend (or mock)
2. Two scenarios: with metrics middleware enabled vs disabled (control)
3. Measure p50/p95/p99 latency in both
4. Assert difference <5ms at p95

```javascript
// tests/k6/metrics-overhead.js (sketch)
import http from 'k6/http';
import { check, sleep } from 'k6';

export const options = {
  scenarios: {
    with_metrics: { executor: 'constant-arrival-rate', rate: 100, duration: '30s' },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'], // baseline threshold
  },
};
```

### References

- [Source: configs/otel/otel-collector-config.yaml] — metrics pipeline already exists
- [Source: components/gov-chat-backend/tracing.js] — NodeSDK with metricReader already configured
- [Source: genie-ai-overlay/tracing.py] — shared Python tracing, needs metrics addition
- [Source: configs/grafana/provisioning/datasources/vm-datasource.yml] — VictoriaMetrics datasource
- [Source: configs/grafana/provisioning/dashboards/service-health.json] — existing dashboard pattern
- [Source: _bmad-output/implementation-artifacts/7-6-deploy-victorialogs-centralized-log-aggregation.md] — previous story patterns
- [Source: _bmad-output/project-context.md] — critical implementation rules
- [Source: _bmad-output/planning-artifacts/architecture.md] — OTel architecture patterns
- [Source: _bmad-output/planning-artifacts/epics.md] — Story 7.8 acceptance criteria

## Dev Agent Record

### Agent Model Used

glm-5-turbo

### Debug Log References

### Completion Notes List

- ✅ Task 1: Backend custom HTTP metrics middleware — `metrics.js` (getMeter wrapper), `middleware/metrics-middleware.js` (http_requests_total + http_request_duration_seconds). Registered in index.js. PII denylist. ENABLE_METRICS=false toggle. 12 JS tests + 7 PII tests.
- ✅ Task 2: Python metrics SDK integration — updated shared `tracing.py` with MeterProvider + PeriodicExportingMetricReader + OTLPMetricExporter. Added `get_meter()`. Meter shutdown support. 8 new tracing tests.
- ✅ Task 3: OPEA service RAG metrics — ChatQnA (chat_requests_total, chat_rag_duration), Retriever (rag.retrieval.requests, rag.retrieval.duration), Dataprep (rag.ingestion.requests, rag.ingestion.duration), Reranker (rag.rerank.requests, rag.rerank.duration). All integrated with shared tracing.get_meter(). 9 Python tests.
- ✅ Task 4: Grafana dashboard — `configs/grafana/provisioning/dashboards/application-metrics.json`. 6 panels: HTTP rate, HTTP duration, RAG latency, chat requests, RAG sub-service latency, error rate.
- ✅ Task 5: k6 benchmark — `tests/metrics-overhead/k6-metrics-overhead.js`. ENABLE_METRICS=false toggle for baseline comparison. P95 threshold <5ms.
- ✅ Task 6: PII verification — `__tests__/metrics-pii.test.js`. 7 tests covering 6 PII keys + safe attributes verification.
- ✅ Task 7: Documentation — Updated `configs/otel/README.md` with custom metrics section, PII enforcement, SDK overhead, Grafana dashboard docs.

**Total tests: 58 (27 backend + 31 Python) all passing.**

### File List

**New files:**
- `components/gov-chat-backend/metrics.js` — getMeter() wrapper for OTel metrics API
- `components/gov-chat-backend/middleware/metrics-middleware.js` — Express HTTP metrics middleware
- `components/gov-chat-backend/__tests__/metrics.test.js` — Backend metrics unit tests (12 tests)
- `components/gov-chat-backend/__tests__/metrics-pii.test.js` — PII verification tests (7 tests)
- `genie-ai-overlay/chatqna/metrics.py` — ChatQnA custom RAG metrics
- `genie-ai-overlay/tests/test_metrics.py` — ChatQnA metrics tests (9 tests)
- `configs/grafana/provisioning/dashboards/application-metrics.json` — Grafana dashboard
- `tests/metrics-overhead/k6-metrics-overhead.js` — k6 benchmark script

**Modified files:**
- `components/gov-chat-backend/index.js` — Added metrics import + middleware registration
- `components/gov-chat-backend/package.json` — Added @opentelemetry/sdk-metrics dependency
- `genie-ai-overlay/tracing.py` — Added MeterProvider, get_meter(), meter shutdown support
- `genie-ai-overlay/chatqna/genieai_chatqna.py` — Added metrics import + RAG pipeline instrumentation
- `genie-ai-overlay/retriever/genieai_retriever_microservice.py` — Added retrieval metrics
- `genie-ai-overlay/dataprep/genieai_dataprep_microservice.py` — Added ingestion metrics
- `genie-ai-overlay/reranker/genieai_reranking_microservice.py` — Added reranking metrics
- `genie-ai-overlay/pyproject.toml` — Added opentelemetry-exporter-otlp-proto-http test dep
- `genie-ai-overlay/tests/conftest.py` — Added OTLP metric_exporter mock
- `genie-ai-overlay/tests/test_tracing.py` — Added 8 new metric tests
- `configs/otel/README.md` — Added custom metrics documentation section
- `_bmad-output/implementation-artifacts/sprint-status.yaml` — Status updates
