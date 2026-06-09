# Story 7.4: End-to-End Trace Propagation and Log Correlation

Status: done

## Story

As a developer,
I want trace context propagated across all services and correlated with structured logs,
so that I can trace a user request from frontend → backend → OPEA services and find related log entries.

## Acceptance Criteria

1. **AC1: Backend trace context propagation** — When the Express backend receives a request with a `traceparent` header, it preserves and propagates the trace context to all downstream OPEA service calls (ChatQnA, Retriever, Dataprep, Reranker) via `traceparent` headers on outbound HTTP requests
2. **AC2: Winston log-trace correlation** — All winston structured log entries in the backend include `trace_id` and `span_id` fields extracted from the active OTel span context
3. **AC3: Python service log-trace correlation** — All OPEA FastAPI services (ChatQnA, Retriever, Dataprep, Reranker) include `trace_id` and `span_id` in their CustomLogger/structured log output
4. **AC4: Consistent log schema** — Log entries across all services are JSON-structured with consistent fields: `timestamp`, `level`, `service`, `trace_id`, `span_id`, `message`
5. **AC5: Full-chain trace ID** — A request flowing through Backend → ChatQnA → Retriever → Reranker → LLM shares a single `trace_id` visible in all service logs and spans
6. **AC6: Backend outbound traceparent** — The backend sends `traceparent` header on all outbound HTTP calls to OPEA services
7. **AC7: Log assertion helpers** — Shared assertion helpers are created in `tests/log-assertions/` for validating structured JSON log output from services under test (FR42)
8. **AC8: Grafana log-trace correlation** — Log entries include `trace_id` in a format that enables Grafana to correlate traces to logs using `trace_id` as the join key
9. **AC9: Existing tests pass** — All existing tests (299+ from stories 7-1 through 7-3) continue to pass
10. **AC10: Ruff and ESLint pass** — All modified code passes respective linters

## Tasks / Subtasks

- [x] Task 1: Backend winston log-trace correlation (AC: #2, #4, #8)
  - [x] Add a custom winston `Format` that injects `trace_id` and `span_id` from the active OTel span context into every log entry
  - [x] Modify `components/shared/lib/logger.js` to include the OTel trace format in the log pipeline (after existing formats, before transport)
  - [x] Ensure the format gracefully returns `{ trace_id: '00000000000000000000000000000000', span_id: '0000000000000000' }` (zeroed) when no active span exists
  - [x] Verify log output is valid JSON when `NODE_ENV=production` (structured) and human-readable when development
- [x] Task 2: Backend outbound traceparent propagation (AC: #1, #5, #6)
  - [x] Verify auto-instrumentation (`@opentelemetry/auto-instrumentations-node`) already propagates traceparent on axios outbound calls
  - [x] If not propagating, add an axios request interceptor that injects `traceparent` from the active OTel context via `propagation.inject()`
  - [x] Test that backend → ChatQnA calls carry `traceparent` header
  - [x] Test that backend → Retriever calls carry `traceparent` header
  - [x] Test that backend → Dataprep calls carry `traceparent` header
- [x] Task 3: Python service log-trace correlation (AC: #3, #4, #5)
  - [x] Add a `log_with_trace()` helper function to `genie-ai-overlay/tracing.py` that extracts `trace_id`/`span_id` from the active span and returns a dict for logging extra fields
  - [x] Alternatively, create a Python logging `Filter` that automatically injects trace context into all log records
  - [x] Update ChatQnA service to use trace-aware logging on key operations (chat request, retrieval, LLM call)
  - [x] Update Retriever service to use trace-aware logging on key operations (hybrid search, ArangoDB query)
  - [x] Update Dataprep service to use trace-aware logging on key operations (ingestion, chunking)
  - [x] Update Reranker service to use trace-aware logging on key operations (reranking, TEI call)
  - [x] Ensure all log output includes `trace_id` and `span_id` fields
- [x] Task 4: Log assertion helpers (AC: #7)
  - [x] Create `tests/log-assertions/log-assertions.js` — JS helpers for asserting structured log output (winston format)
  - [x] Create `tests/log-assertions/log_assertions.py` — Python helpers for asserting structured log output (CustomLogger format)
  - [x] JS helpers: `expectLogContains(loggerMock, { trace_id, span_id, level, message })`
  - [x] Python helpers: `assert_log_contains(caplog, { trace_id, span_id, level, message })`
  - [x] Both helpers validate the consistent log schema: `timestamp`, `level`, `service`, `trace_id`, `span_id`, `message`
- [x] Task 5: Tests for log-trace correlation (AC: #9, #10)
  - [x] Add backend test: verify winston log entries contain trace_id/span_id when a span is active
  - [x] Add Python test: verify log_with_trace helper returns correct trace context
  - [x] Verify all 299+ existing tests still pass
  - [x] Run `ruff check` and `ruff format` on modified Python files
  - [x] Run ESLint on modified JS files
- [x] Task 6: Update env template documentation (AC: #4)
  - [x] Verify `OTEL_EXPORTER_OTLP_ENDPOINT` documentation in root `env` template mentions log-trace correlation

## Dev Notes

### Architecture Overview

This story completes the OTel instrumentation work started in stories 7-1 through 7-3. Stories 7-1 to 7-3 established **tracing** (spans, exporters, manual attributes). This story adds **log-trace correlation** (injecting trace context into structured logs) and verifies **end-to-end trace propagation** across the full stack.

**Current tracing state (after stories 7-1 to 7-3):**
- Backend: `tracing.js` initializes NodeSDK with auto-instrumentations + W3C propagator + PII redaction
- Python services: `tracing.py` shared module, `setup_tracing()` + `get_tracer()`, manual spans, `FastAPIInstrumentor`
- Trace propagation: Manual `propagate.inject()` on Python aiohttp calls; auto-instrumentation on Node.js axios and Python httpx
- **Missing:** trace_id/span_id in structured logs, log assertion helpers

### Critical: Winston OTel Log Correlation Pattern

The backend uses `components/shared/lib/logger.js` with Winston. To inject trace context:

```javascript
const { trace, context } = require('@opentelemetry/api');

const traceFormat = winston.format((info) => {
  const span = trace.getSpan(context.active());
  if (span) {
    const { traceId, spanId } = span.spanContext();
    info.trace_id = traceId;
    info.span_id = spanId;
  } else {
    info.trace_id = '00000000000000000000000000000000';
    info.span_id = '0000000000000000';
  }
  return info;
});
```

Add this format to the existing Winston format pipeline in `logger.js`. The key constraint: `@opentelemetry/api` must be importable. Since `tracing.js` is already imported in the backend (story 7-1), the OTel API is available.

**IMPORTANT:** The trace format must be added BEFORE the log transport — it adds fields to the log info object that are then serialized by the existing JSON/printf formats. Place it after the timestamp format but before the printf/custom format.

### Critical: Python Log-Trace Correlation Pattern

The Python services use OPEA's `CustomLogger`. The approach depends on how CustomLogger works:

**Option A (preferred):** Add a `log_with_trace()` helper to `genie-ai-overlay/tracing.py`:
```python
def log_with_trace(level, message, **kwargs):
    """Log with automatic trace_id/span_id injection."""
    span = trace.get_current_span()
    extra = {}
    if span and span.is_recording():
        ctx = span.get_span_context()
        extra['trace_id'] = format(ctx.trace_id, '032x')
        extra['span_id'] = format(ctx.span_id, '016x')
    extra.update(kwargs)
    # Use CustomLogger or standard logging
```

**Option B:** Create a Python logging `Filter` that injects trace context into all log records automatically. This is cleaner but may not work with OPEA's CustomLogger if it bypasses standard logging.

**Decision point:** Read the OPEA `CustomLogger` source to determine which approach works. The `CustomLogger` is in the vendored `comps` library — check how it handles extra fields.

### Critical: Verify Auto-Instrumentation Trace Propagation

Story 7-1 configured the backend with `@opentelemetry/auto-instrumentations-node`, which includes:
- `@opentelemetry/instrumentation-http` — propagates traceparent on native `http` calls
- `@opentelemetry/instrumentation-express` — creates spans for Express routes

**Key question:** Does the backend use `axios` or `http` for OPEA service calls? Check `components/gov-chat-backend/services/` for the HTTP client used. If it's `axios`, verify `@opentelemetry/instrumentation-axios` is included in auto-instrumentations. If it's native `http`, propagation should work out of the box.

The auto-instrumentation with `W3CTraceContextPropagator` (configured in `tracing.js`) should handle propagation automatically. **You likely do NOT need to add manual propagation code for the backend** — verify this first before adding code.

### Critical: Existing tracing.py Module

The shared `genie-ai-overlay/tracing.py` module (created in Story 7-2) provides:
- `setup_tracing(service_name)` — TracerProvider + OTLP exporter + Resource
- `get_tracer(name)` — returns tracer from global provider
- `shutdown()` — force_flush + shutdown
- `_reset()` — for testing only

**Add the log-trace helper to this existing module.** Do NOT create a separate module.

### Critical: Log Schema Consistency

The AC requires a consistent log schema across all services:

| Field | Source | Format |
|-------|--------|--------|
| `timestamp` | ISO 8601 | `2026-05-28T14:30:00.123Z` |
| `level` | Log level | `info`, `warn`, `error`, `debug` |
| `service` | Service name | `genie-backend`, `genieai-chatqna`, etc. |
| `trace_id` | OTel trace ID | 32-char hex string |
| `span_id` | OTel span ID | 16-char hex string |
| `message` | Log message | String |

**Note:** Winston already produces timestamps and levels. The new fields are `trace_id`, `span_id`, and `service`. Python CustomLogger may produce a different schema — the key requirement is that `trace_id` and `span_id` are present and in the same format.

### Critical: Grafana Log-Trace Correlation

Grafana correlates logs to traces by matching the `trace_id` field in log entries to the trace ID in the telemetry backend (VictoriaMetrics/Jaeger). The OTel trace ID format is a 32-character lowercase hex string (e.g., `4bf92f3577b34da6a3ce929d0e0e4736`).

**Winston output format must include `trace_id` as a top-level JSON field.** Grafana's Loki datasource can then be configured with a derived field to link log entries to traces.

### Critical: Module Import Order

The same import order rules from stories 7-1 to 7-3 apply:
- **Backend:** `tracing.js` must be imported before any Express middleware or route handlers (already done in story 7-1)
- **Python:** `from tracing import ...` must come after `os` imports but before `comps` imports (already done in stories 7-2 and 7-3)

### Critical: Testing in NODE_ENV=test

The backend's `tracing.js` returns a no-op tracer when `NODE_ENV === 'test'`. This means:
- `trace.getSpan(context.active())` returns `undefined` in tests
- The trace format in `logger.js` should return zeroed trace IDs when no span is active
- Tests for log-trace correlation must either: (a) mock the OTel API to return a fake span, or (b) test the zeroed trace ID behavior

### Critical: PII Protection (Inherited from Previous Stories)

Same PII rules apply:
- **NEVER** include user query content, document text, file content, or credentials in log entries beyond what is already logged
- **NEVER** include PII in trace attributes
- The trace ID and span ID are safe to log — they are random identifiers with no PII content

### File-by-File Changes

**Backend (Node.js):**
- `components/shared/lib/logger.js` — UPDATE: Add OTel trace format to Winston pipeline
- No changes to `tracing.js` or `tracing-pii.js` (already complete from stories 7-1)

**Python (OPEA services):**
- `genie-ai-overlay/tracing.py` — UPDATE: Add `log_with_trace()` helper or logging Filter
- `genie-ai-overlay/chatqna/genieai_chatqna.py` — UPDATE: Use trace-aware logging on key operations
- `genie-ai-overlay/retriever/genieai_retriever_arangodb.py` — UPDATE: Use trace-aware logging on key operations
- `genie-ai-overlay/retriever/genieai_retriever_microservice.py` — UPDATE: Use trace-aware logging on key operations
- `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` — UPDATE: Use trace-aware logging on key operations
- `genie-ai-overlay/dataprep/genieai_dataprep_microservice.py` — UPDATE: Use trace-aware logging on key operations
- `genie-ai-overlay/reranker/genieai_tei_reranker.py` — UPDATE: Use trace-aware logging on key operations
- `genie-ai-overlay/reranker/genieai_reranking_microservice.py` — UPDATE: Use trace-aware logging on key operations

**Test Infrastructure (NEW):**
- `tests/log-assertions/log-assertions.js` — NEW: JS structured log assertion helpers
- `tests/log-assertions/log-assertions.py` — NEW: Python structured log assertion helpers

**Tests:**
- `genie-ai-overlay/tests/test_tracing.py` — UPDATE: Add tests for log_with_trace helper
- Backend tests — UPDATE: Add tests for winston trace format

### Previous Story Intelligence (7-3: Dataprep + Reranker)

**Established patterns to replicate:**
- Shared `tracing.py` module — add new functions here, don't create new modules
- Import order: tracing imports after `os`, before `comps`
- Manual spans via `tracer.start_as_current_span()` as context manager
- Trace propagation on aiohttp: manual `propagate.inject(headers)` (already in place for Python services)
- Conftest.py already mocks all OTel modules

**Review findings from 7-3 to apply:**
- Use `start_as_current_span()` as context manager (never raw `start_span()`)
- Always add `span.record_exception(e)` AND `span.set_status(StatusCode.ERROR, str(e))` in except blocks
- Keep spans narrow enough to capture meaningful duration (review found spans too narrow in 7-3)

**Key difference from 7-3:** This story does NOT add new spans — it adds **log correlation** to existing spans and **verifies** that trace context propagates end-to-end.

### Anti-Patterns to Avoid

- **Do NOT** create a new tracing module — extend `genie-ai-overlay/tracing.py` and `components/gov-chat-backend/tracing.js`
- **Do NOT** add trace IDs to logs by manually formatting strings — use Winston format and Python logging Filter/helper
- **Do NOT** modify OPEA `comps` library files — only overlay files
- **Do NOT** wrap log-trace correlation in try/except — let errors propagate during development
- **Do NOT** add file content, query text, or user data to log entries — only trace_id, span_id, and existing log fields
- **Do NOT** modify existing span creation code — only add logging correlation
- **Do NOT** use gRPC exporter — HTTP only (matches existing setup)
- **Do NOT** add log-trace correlation in `genie-ai-overlay/tracing.py` that depends on `comps` — the tracing module must be importable standalone
- **Do NOT** install additional npm packages for winston-otel integration — use `@opentelemetry/api` directly (already installed in story 7-1)

### Out of Scope

- **OTel Collector deployment** — deferred to Story 7-5
- **New spans** — all spans were created in stories 7-1 through 7-3; this story only adds log correlation
- **FastAPI request logging middleware** — auto-instrumentation handles span creation; only log enrichment needed
- **Frontend trace context** — frontend does not initiate traces (backend creates trace on inbound request)
- **CustomLogger replacement** — use OPEA's CustomLogger as-is; only add trace context injection
- **Grafana dashboard configuration** — deferred to Story 7-5

### Latency Overhead

Log-trace correlation adds negligible overhead:
- Winston format function: O(1) — just reads span context from thread-local
- Python log helper: O(1) — reads span context and formats hex strings
- No additional network calls or I/O
- Total overhead per log entry: <0.1ms

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 7 Story 7.4]
- [Source: _bmad-output/planning-artifacts/architecture.md#Application Observability Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#OTel Instrumentation Patterns]
- [Source: _bmad-output/planning-artifacts/architecture.md#Log-trace correlation (winston)]
- [Source: _bmad-output/planning-artifacts/architecture.md#Log-trace correlation (Python CustomLogger)]
- [Source: _bmad-output/planning-artifacts/architecture.md#Structured log assertion helpers]
- [Source: _bmad-output/implementation-artifacts/7-1-express-backend-otel-tracing-foundation.md — story 7-1 patterns]
- [Source: _bmad-output/implementation-artifacts/7-3-opea-services-otel-tracing-dataprep-reranker.md — previous story patterns and review findings]
- [Source: components/gov-chat-backend/tracing.js — Node.js OTel SDK setup (story 7-1)]
- [Source: components/gov-chat-backend/tracing-pii.js — PII redaction utilities (story 7-1)]
- [Source: components/shared/lib/logger.js — Winston logger (to be modified)]
- [Source: genie-ai-overlay/tracing.py — shared Python OTel module (to be extended)]
- [Source: genie-ai-overlay/tests/conftest.py — shared test fixtures with OTel mocks]
- [Source: _bmad-output/project-context.md — CommonJS-only backend, Options API frontend, ITU headers for Python]

## Dev Agent Record

### Agent Model Used

Claude (GLM-5-Turbo)

### Debug Log References

### Completion Notes List

- Task 1: Added `traceFormat` Winston format to `components/shared/lib/logger.js`. Injects `trace_id` and `span_id` from active OTel span into every log entry. Zeroed IDs when no span active. 11 tests.
- Task 2: Verified auto-instrumentation (`@opentelemetry/auto-instrumentations-node` + `W3CTraceContextPropagator`) handles traceparent propagation on all outbound axios/fetch calls. No interceptor needed. 7 tests.
- Task 3: Added `get_trace_context()`, `TraceContextFilter`, and `setup_trace_logging()` to `genie-ai-overlay/tracing.py`. Updated all 7 Python service files to call `setup_trace_logging()`. 12 tests.
- Task 4: Created `tests/log-assertions/log-assertions.js` (3 exports, 24 tests) and `tests/log-assertions/log_assertions.py` (3 functions, 25 tests).
- Task 5: All 1083 backend JS tests + 330 Python tests pass. ESLint and Ruff pass.
- Task 6: Updated `env` template with log-trace correlation documentation.

### File List

**Modified:**
- `components/shared/lib/logger.js` — Added OTel trace format to Winston pipeline
- `components/gov-chat-backend/package.json` — Added moduleNameMapper for shared lib test imports
- `genie-ai-overlay/tracing.py` — Added get_trace_context(), TraceContextFilter, setup_trace_logging()
- `genie-ai-overlay/chatqna/genieai_chatqna.py` — Added setup_trace_logging() call
- `genie-ai-overlay/retriever/genieai_retriever_arangodb.py` — Added setup_trace_logging() call
- `genie-ai-overlay/retriever/genieai_retriever_microservice.py` — Added setup_trace_logging() call
- `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` — Added setup_trace_logging() call
- `genie-ai-overlay/dataprep/genieai_dataprep_microservice.py` — Added setup_trace_logging() call
- `genie-ai-overlay/reranker/genieai_tei_reranker.py` — Added setup_trace_logging() call
- `genie-ai-overlay/reranker/genieai_reranking_microservice.py` — Added setup_trace_logging() call
- `env` — Added log-trace correlation documentation to OTEL section

**New:**
- `components/gov-chat-backend/__tests__/logger-otel-trace.test.js` — 11 tests for Winston OTel trace format
- `components/gov-chat-backend/__tests__/trace-propagation.test.js` — 7 tests for traceparent propagation
- `genie-ai-overlay/tests/test_trace_logging.py` — 12 tests for Python log-trace helpers
- `tests/log-assertions/log-assertions.js` — JS structured log assertion helpers
- `tests/log-assertions/log_assertions.py` — Python structured log assertion helpers
- `tests/log-assertions/__init__.py` — Package init
- `tests/log-assertions/test_log_assertions_js.test.js` — 24 tests for JS log assertions
- `tests/log-assertions/test_log_assertions_py.py` — 25 tests for Python log assertions

### Change Log

- 2026-05-29: Story 7-4 implementation complete — log-trace correlation and trace propagation verified
- 2026-05-29: Code review fixes — added `service` field to log schema (AC4), fixed import order in retriever + reranker, added PII protection tests

### Review Findings

- [x] [Review][Patch] Add `service` field to log schema (AC4) — `LOG_SCHEMA_FIELDS` in assertion helpers and `traceFormat`/`TraceContextFilter` were missing the `service` field required by AC4
- [x] [Review][Patch] Fix import order in retriever and reranker — `from tracing import` was after `from comps import` in `genieai_retriever_arangodb.py` and `genieai_tei_reranker.py`
- [x] [Review][Patch] Add PII protection tests — verify log entries don't contain user query content or credentials
- [ ] [Review][Defer] Full-chain trace ID integration test (AC5) — deferred, requires running services
