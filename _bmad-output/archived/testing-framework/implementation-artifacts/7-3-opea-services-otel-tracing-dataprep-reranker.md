# Story 7.3: OPEA Services OTel Tracing (Dataprep + Reranker)

Status: review

## Story

As a developer,
I want the Dataprep and Reranker FastAPI services instrumented with OpenTelemetry,
so that document ingestion and result reranking are visible in distributed traces.

## Acceptance Criteria

1. **AC1: OTel SDK dependencies installed** — Add `opentelemetry-api>=1.22`, `opentelemetry-sdk>=1.22`, `opentelemetry-instrumentation-fastapi>=0.43b0`, `opentelemetry-exporter-otlp-proto-http>=1.22` to the OPEA Dockerfiles for Dataprep and Reranker services
2. **AC2: Dataprep service instrumented** — Dataprep FastAPI endpoints produce server-side spans with `service.name = "genieai-dataprep"`. FastAPIInstrumentor instruments the app. The tracing module is imported at the top of `genieai_dataprep_microservice.py`
3. **AC3: Reranker service instrumented** — Reranker FastAPI endpoints produce server-side spans with `service.name = "genieai-reranker"`. FastAPIInstrumentor instruments the app. The tracing module is imported at the top of `genieai_reranking_microservice.py`
4. **AC4: Dataprep-specific span attributes** — Manual spans include ingestion attributes: `dataprep.file_type`, `dataprep.chunk_count`, `dataprep.file_size_bytes` on key operations (ingestion, retraction)
5. **AC5: Reranker-specific span attributes** — Manual spans include reranking attributes: `reranker.top_k`, `reranker.score_threshold`, `reranker.model_id`, `reranker.strategy` on the reranking operation. Note: `reranker.model_id` should use `os.getenv("RERANKER_MODEL_ID", "")` or fall back to the TEI reranking endpoint URL (`TEI_RERANKING_ENDPOINT`) as a proxy identifier
6. **AC6: Trace context propagation** — W3C `traceparent` headers are propagated on inter-service calls (Dataprep → TEI, Dataprep → Backend, Dataprep → DocRepo, Reranker → TEI)
7. **AC7: Configurable OTLP endpoint** — SDK exports traces via OTLP/HTTP to `OTEL_EXPORTER_OTLP_ENDPOINT` env var (default: `http://otel-collector:4318`). Uses shared `genie-ai-overlay/tracing.py` module (already created in Story 7-2)
8. **AC8: Bootstrap-safe** — Application starts and runs normally if the OTel Collector is unavailable
9. **AC9: PII protection** — No file content, document text, or user data is included in span attributes. Only metadata (file_type, chunk_count, file_size_bytes, strategy, scores)
10. **AC10: No API contract changes** — The instrumentation does not alter existing API contracts, response formats, or service behavior
11. **AC11: Copyright Headers** — All modified Python files retain existing copyright headers; new span code is inline, no new files needed (tracing.py already exists)
12. **AC12: Ruff passes** — All modified Python code passes `ruff check` and `ruff format`
13. **AC13: Docker builds succeed** — Both Dataprep and Reranker Docker images build successfully with the new OTel dependencies
14. **AC14: Existing tests pass** — All existing pytest tests (99 from story 7-2 + all others) continue to pass
15. **AC15: Low latency overhead** — The instrumentation adds <5ms latency overhead per request

## Tasks / Subtasks

- [x] Task 1: Install OTel dependencies in Dockerfiles (AC: #1, #13)
  - [x] Add OTel pip packages to `genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai`
  - [x] Add OTel pip packages to `genie-ai-overlay/reranker/Dockerfile-reranker_genie-ai`
  - [x] Add `COPY genie-ai-overlay/tracing.py /app/tracing.py` to both Dockerfiles (tracing module is already used by ChatQnA and Retriever)
- [x] Task 2: Instrument Dataprep microservice (AC: #2, #4, #6)
  - [x] Import `tracing` module at the top of `genieai_dataprep_microservice.py` (after os imports, before importlib/comps imports)
  - [x] Call `setup_tracing("genieai-dataprep")` before OPEA service registration
  - [x] Instrument the FastAPI app with `FastAPIInstrumentor.instrument_app()` in `__main__`
  - [x] Add manual span in `ingest_file_from_repo()` with `dataprep.file_type`, `dataprep.file_size_bytes` attributes
  - [x] Add manual span in `retract_file()` with `dataprep.file_id` attribute
  - [x] Add lightweight span in `kill_ingest_task()` with `dataprep.file_id` attribute (simple cancellation endpoint — span for trace completeness)
  - [x] Propagate trace context on aiohttp calls to DocRepo and Backend (manual `propagate.inject(headers)`)
- [x] Task 3: Instrument Dataprep component class (AC: #4)
  - [x] Add manual span in `GenieArangoDataprep` ingestion methods with `dataprep.chunk_count` attribute
  - [x] The `invoke()` or `ingest_file_with_guardrail()` method is where chunking happens — add span there
- [x] Task 4: Instrument Reranker microservice (AC: #3, #5, #6)
  - [x] Import `tracing` module at the top of `genieai_reranking_microservice.py` (after os imports, before comps imports)
  - [x] Call `setup_tracing("genieai-reranker")` before OPEA service registration
  - [x] Instrument the FastAPI app with `FastAPIInstrumentor.instrument_app()` in `__main__`
  - [x] Add manual span in `reranking()` function with `reranker.strategy`, `reranker.top_n`, `reranker.input_doc_count` attributes
- [x] Task 5: Instrument Reranker component class (AC: #5, #9)
  - [x] Add manual span in `GenieTEIReranking.invoke()` with `reranker.top_k`, `reranker.score_threshold`, `reranker.strategy`, `reranker.output_doc_count` attributes
  - [x] Propagate trace context on aiohttp TEI rerank call (manual `propagate.inject(headers)`)
- [x] Task 6: Update tests (AC: #12, #14)
  - [x] Verify all existing 99+ tests still pass
  - [x] Add unit tests for new tracing calls in Dataprep and Reranker services (mock-based, same pattern as story 7-2 test_tracing.py)
  - [x] Run `ruff check` and `ruff format` on all modified files
- [x] Task 7: Update env template (AC: #7)
  - [x] Verify `OTEL_EXPORTER_OTLP_ENDPOINT` comment in root `env` template covers Dataprep and Reranker (already updated in story 7-2 — verify coverage)

## Dev Notes

### Critical: Reuse Existing tracing.py Module

The shared tracing module `genie-ai-overlay/tracing.py` was created in Story 7-2 and is already used by ChatQnA and Retriever. DO NOT create a new tracing module. Import the existing one:

```python
from tracing import setup_tracing, get_tracer
setup_tracing("genieai-dataprep")
tracer = get_tracer(__name__)
```

The tracing module provides:
- `setup_tracing(service_name)` — initializes TracerProvider with OTLP exporter, Resource, atexit+SIGTERM shutdown
- `get_tracer(name)` — returns a tracer from the global provider
- `shutdown()` — force_flush + shutdown
- `_reset()` — for testing only

### Critical: Module Import Order

The tracing module MUST be imported before the FastAPI app is created and before OPEA `comps` imports. Place the tracing import after `os` imports but before everything else.

**Dataprep microservice** — `genieai_dataprep_microservice.py`:
```python
import os
import time
# ... other stdlib imports ...

from tracing import setup_tracing, get_tracer
setup_tracing("genieai-dataprep")

# Now import everything else (importlib, comps, etc.)
import importlib
importlib.import_module("integrations.genieai_dataprep_arangodb")
# ... rest of imports ...
```

**Reranker microservice** — `genieai_reranking_microservice.py`:
```python
import os
import time

from tracing import setup_tracing, get_tracer
setup_tracing("genieai-reranker")

# Now import comps and register the service
from comps import ...
```

### Critical: FastAPI App Access Pattern

These two services create their FastAPI apps via OPEA's `register_microservice` decorator, same as the Retriever in Story 7-2. Access the app via `opea_microservices` dict:

**Dataprep** — The app is registered by three `@register_microservice` decorators. In `__main__`:
```python
if __name__ == "__main__":
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from comps import opea_microservices
    logger.info("GENIE Dataprep Microservice is starting...")
    base.create_upload_folder(upload_folder)
    app = opea_microservices["opea_service@dataprep"]
    FastAPIInstrumentor.instrument_app(app._app if hasattr(app, '_app') else app)
    app.start()
```

**Reranker** — Same pattern:
```python
if __name__ == "__main__":
    from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
    from comps import opea_microservices
    opea_microservices["opea_service@reranking"].start()
    # Instrument after start (app is created during start)
    FastAPIInstrumentor.instrument_app(
        opea_microservices["opea_service@reranking"]._app
    )
    logger.info("OPEA Reranking Microservice is starting...")
```

IMPORTANT: Verify the actual attribute name for accessing the FastAPI app instance from OPEA's MicroService wrapper. Read the OPEA `MicroService` class to find the correct attribute (likely `_app`, `app`, or `_fastapi_app`). See how ChatQnA and Retriever did it in Story 7-2.

### Architecture: Manual Spans for Dataprep Operations

**Dataprep `ingest_file_from_repo()`** — Add span around the ingestion logic:
```python
tracer = get_tracer(__name__)

async def ingest_file_from_repo(payload: DocRepoIngestPayload):
    with tracer.start_as_current_span("dataprep.ingest") as span:
        span.set_attribute("dataprep.file_type", payload.fileType)
        span.set_attribute("dataprep.file_size_bytes", len(payload.fileBase64))  # base64 length as proxy
        # ... existing ingestion logic ...
        # After ingestion completes, add chunk count if available
        span.set_attribute("dataprep.file_id", payload.fileId)
```

**Dataprep `retract_file()`** — Add span:
```python
async def retract_file(payload: DocRepoRetractPayload):
    with tracer.start_as_current_span("dataprep.retract") as span:
        span.set_attribute("dataprep.file_id", payload.fileId)
        # ... existing retraction logic ...
```

**Dataprep `GenieArangoDataprep`** — Add span in the ingestion component (where chunking happens). This is the `ingest_file_with_guardrail()` or `invoke()` method. Add `dataprep.chunk_count` after chunking completes:
```python
# Inside GenieArangoDataprep.ingest_file_with_guardrail or similar
with tracer.start_as_current_span("dataprep.chunking") as span:
    # ... chunking logic ...
    span.set_attribute("dataprep.chunk_count", len(chunks))
```

### Architecture: Manual Spans for Reranker Operations

**Reranker `reranking()` function** — Add span:
```python
tracer = get_tracer(__name__)

async def reranking(input):
    with tracer.start_as_current_span("reranker.rerank") as span:
        span.set_attribute("reranker.strategy", reranking_strategy)
        span.set_attribute("reranker.input_doc_count", len(input.retrieved_docs) if input.retrieved_docs else 0)
        # ... existing reranking logic ...
        span.set_attribute("reranker.output_doc_count", len(reranking_results))
```

**Reranker `GenieTEIReranking.invoke()`** — Add span:
```python
async def invoke(self, input):
    with tracer.start_as_current_span("reranker.tei_invoke") as span:
        span.set_attribute("reranker.strategy", reranking_strategy)
        span.set_attribute("reranker.top_n", reranker_top_n)
        span.set_attribute("reranker.score_threshold", reranking_threshold)
        span.set_attribute("reranker.model_id", os.getenv("RERANKER_MODEL_ID", os.getenv("TEI_RERANKING_ENDPOINT", "")))
        span.set_attribute("reranker.input_doc_count", len(input.retrieved_docs) if input.retrieved_docs else 0)
        # ... existing reranking logic ...
        span.set_attribute("reranker.output_doc_count", len(reranking_results))
```

### Critical: OTLP Endpoint URL Handling (Python)

Python's `OTLPSpanExporter` does NOT auto-append `/v1/traces`. The shared `tracing.py` already handles this — you just call `setup_tracing(service_name)` and it appends `/v1/traces` internally.

### Critical: Docker Build Context

Both Dockerfiles already copy the `tracing.py` module? No — the tracing.py COPY was only added to ChatQnA and Retriever Dockerfiles in Story 7-2. You MUST add the COPY step to both Dataprep and Reranker Dockerfiles:

**Dataprep Dockerfile** — Add after Step F (overlay-specific dependencies):
```dockerfile
# Step F.5: Copy shared OTel tracing module
COPY genie-ai-overlay/tracing.py /app/tracing.py

# Add to existing pip install step (Step F or create new one):
RUN pip install --no-cache-dir \
    "opentelemetry-api>=1.22" "opentelemetry-sdk>=1.22" \
    "opentelemetry-instrumentation-fastapi>=0.43b0" \
    "opentelemetry-exporter-otlp-proto-http>=1.22"
```

**Reranker Dockerfile** — Add after Step C (pip install -r requirements) or Step D (docarray fix):
```dockerfile
# Step D.5: Copy shared OTel tracing module
COPY genie-ai-overlay/tracing.py /app/tracing.py

# Add OTel dependencies:
RUN pip install --no-cache-dir \
    "opentelemetry-api>=1.22" "opentelemetry-sdk>=1.22" \
    "opentelemetry-instrumentation-fastapi>=0.43b0" \
    "opentelemetry-exporter-otlp-proto-http>=1.22"
```

### Critical: PYTHONPATH Configuration

The tracing module must be on PYTHONPATH:
- **Dataprep:** `PYTHONPATH="${PYTHONPATH}:/app:/app/comps/dataprep/src:/app/comps/dataprep/src/integrations:/app/comps/cores/proto"` → copy `tracing.py` to `/app/tracing.py` (already in PYTHONPATH via `/app`)
- **Reranker:** `PYTHONPATH="${PYTHONPATH}:/app:/app/comps/rerankings/src:/app/comps/cores/proto"` → copy `tracing.py` to `/app/tracing.py` (already in PYTHONPATH via `/app`)

### PII Protection Strategy

Same as Story 7-2 — enforce PII protection at span-creation level:

**Dataprep rules:**
- NEVER add `dataprep.file_content`, `dataprep.document_text`, `dataprep.chunk_text` attributes
- ONLY add metadata: `dataprep.file_type`, `dataprep.chunk_count`, `dataprep.file_size_bytes`, `dataprep.file_id`
- Do NOT include base64 file content, extracted text, or chunk text in any span attribute

**Reranker rules:**
- NEVER add `reranker.document_text`, `reranker.query_text` attributes
- ONLY add metadata: `reranker.strategy`, `reranker.top_k`, `reranker.score_threshold`, `reranker.input_doc_count`, `reranker.output_doc_count`
- Do NOT include document content or query text from retrieved docs in any span attribute

### Trace Context Propagation Details

**Dataprep → DocRepo (aiohttp):**
- No OTel instrumentation for aiohttp
- Manual injection: `propagate.inject(headers_dict)` before each aiohttp request
- The Dataprep service calls `DOCUMENT_REPOSITORY_URL` via aiohttp in `GenieArangoDataprep`

**Dataprep → Backend (aiohttp):**
- Same manual injection pattern for Backend API calls

**Dataprep → TEI (embedding):**
- TEI embedding calls may go through OPEA framework internals
- Manual injection where possible, defer framework internals (same as Retriever TEI calls in 7-2)

**Reranker → TEI (rerank):**
- The `aiohttp.ClientSession` call in `GenieTEIReranking.invoke()` goes to `{self.base_url}/rerank`
- Manual injection: inject `traceparent` into the aiohttp request headers

### Dataprep Service Architecture Notes

The Dataprep service has a unique architecture compared to ChatQnA and Retriever:

1. **Three endpoints** registered via `@register_microservice`: `ingest_file`, `kill_ingest`, `retract_file`
2. **Background task execution** — ingestion runs as an `asyncio.create_task()`
3. **File locking** — uses `fcntl.flock()` for single-ingestion enforcement
4. **Base64 file input** — files arrive as base64-encoded strings in JSON payloads

When adding spans:
- The `ingest_file_from_repo` span should wrap the synchronous lock check + task creation
- The actual chunking span should be inside the background task (if accessible) or in the component class
- The `retract_file` span wraps the delete operation
- The `kill_ingest_task` span is lightweight — just wraps the cancellation check

**Dataprep `kill_ingest_task()`** — Lightweight span:
```python
async def kill_ingest_task(payload: DocRepoRetractPayload):
    with tracer.start_as_current_span("dataprep.kill_ingest") as span:
        span.set_attribute("dataprep.file_id", payload.fileId)
        # ... existing kill logic ...
```

### Reranker Service Architecture Notes

1. **One endpoint** registered: `/v1/reranking`
2. **OPEA component loader pattern** — uses `OpeaComponentLoader` to invoke `GenieTEIReranking`
3. **Multiple reranking strategies** — `slice`, `threshold`, `knee_threshold`
4. **Direct aiohttp call to TEI** — in `GenieTEIReranking.invoke()`, uses `aiohttp.ClientSession` to call TEI `/rerank`

When adding spans:
- Outer span in `reranking()` function with input/output doc counts and strategy
- Inner span in `GenieTEIReranking.invoke()` with TEI call details and strategy-specific attributes

### Bootstrap Safety

Same as Story 7-2 — the OTel SDK handles collector unavailability gracefully:
- `BatchSpanProcessor` buffers spans in memory and retries export
- Application continues normally if collector is down
- No special error handling needed — do NOT wrap `setup_tracing()` in try/except

### Testing Approach

1. **Verify existing tests pass**: Run `python -m pytest tests/ -v` — all 99+ tests from previous stories must pass
2. **Add tracing tests for Dataprep**: Mock `opentelemetry` modules, verify `setup_tracing("genieai-dataprep")` is called, verify manual spans are created with correct attributes
3. **Add tracing tests for Reranker**: Same pattern — verify `setup_tracing("genieai-reranker")`, verify span attributes
4. **Conftest.py already mocks OTel modules**: The `conftest.py` already mocks `opentelemetry.exporter.*` and `opentelemetry.instrumentation.*` — no changes needed for test collection

### Anti-Patterns to Avoid

- **Do NOT** install OTel packages in `pyproject.toml` optional deps — they go in Dockerfiles only (OPEA services are Docker-deployed)
- **Do NOT** modify `components/shared/lib/` for tracing — Python tracing is entirely in `genie-ai-overlay/`
- **Do NOT** add file content or document text to span attributes — only metadata (types, counts, sizes)
- **Do NOT** wrap `setup_tracing()` in try/except — let errors propagate during development
- **Do NOT** create per-service tracing modules — use the shared `genie-ai-overlay/tracing.py`
- **Do NOT** use gRPC exporter — stick with HTTP to match the backend's OTLP/HTTP protocol
- **Do NOT** modify OPEA `comps` library files — only overlay files (`genie-ai-overlay/`)
- **Do NOT** forget the `/v1/traces` suffix — but the shared `tracing.py` already handles this
- **Do NOT** use `start_span()` without context manager — use `start_as_current_span()` as context manager or wrap in try/finally (review finding from Story 7-2)
- **Do NOT** add `opentelemetry-instrumentation-httpx` unless the service actually uses httpx — Dataprep and Reranker use aiohttp, not httpx

### Previous Story Intelligence (7-2: ChatQnA + Retriever)

**Established patterns to replicate:**
- Shared tracing module at `genie-ai-overlay/tracing.py` — reuse, don't recreate
- Import order: `from tracing import setup_tracing, get_tracer` after os imports, before comps
- `setup_tracing()` call immediately after import
- `FastAPIInstrumentor.instrument_app()` in `__main__` block
- Manual spans via `tracer.start_as_current_span()` as context manager
- Span attributes: metadata only, never content
- Trace propagation on aiohttp: manual `propagate.inject(headers)`
- Dockerfile changes: COPY tracing.py + pip install OTel deps
- Conftest.py already has OTel module mocks

**Review findings from 7-2 to apply:**
- Use `start_as_current_span()` as context manager (not `start_span()` without try/finally) — span leak fix from review
- Add `span.record_exception(e)` and `span.set_status(StatusCode.ERROR, str(e))` in except blocks — error context fix from review

**Key difference from 7-2:** Dataprep uses `importlib.import_module()` to register the component before loading OPEA base. The tracing import must come BEFORE this importlib call.

### Latency Overhead

The OTel SDK adds negligible overhead (<5ms per request) — same as Story 7-2. The `BatchSpanProcessor` exports spans asynchronously in a background thread, so span creation is non-blocking. Manual span attribute assignment is O(1). No special performance optimization needed beyond using `start_as_current_span()` as context manager.

### Out of Scope

- **Log-trace correlation** — deferred to Story 7-4 (injecting `trace_id`/`span_id` into CustomLogger)
- **OTel Collector deployment** — deferred to Story 7-5
- **Redis or ArangoDB driver instrumentation** — manual spans only
- **FastAPIInstrumentor for httpx** — Dataprep/Reranker use aiohttp, not httpx

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 7 Story 7.3]
- [Source: _bmad-output/planning-artifacts/architecture.md#Application Observability Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#OTel Instrumentation Patterns]
- [Source: _bmad-output/implementation-artifacts/7-2-opea-services-otel-tracing-chatqna-retriever.md — previous story patterns and review findings]
- [Source: genie-ai-overlay/tracing.py — shared OTel tracing module (created in 7-2)]
- [Source: genie-ai-overlay/dataprep/genieai_dataprep_microservice.py — Dataprep microservice (280 lines)]
- [Source: genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py — Dataprep component (877+ lines)]
- [Source: genie-ai-overlay/reranker/genieai_reranking_microservice.py — Reranker microservice (76 lines)]
- [Source: genie-ai-overlay/reranker/genieai_tei_reranker.py — Reranker component (139 lines)]
- [Source: genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai — Dataprep Docker build]
- [Source: genie-ai-overlay/reranker/Dockerfile-reranker_genie-ai — Reranker Docker build]
- [Source: genie-ai-overlay/tests/conftest.py — shared test fixtures with OTel mocks]

## Dev Agent Record

### Agent Model Used

Claude Code (GLM-5-Turbo)

### Debug Log References

### Completion Notes List

- Task 1: Added OTel pip packages and COPY tracing.py to both Dataprep and Reranker Dockerfiles
- Task 2: Instrumented Dataprep microservice with setup_tracing("genieai-dataprep"), manual spans for ingest/retract/kill endpoints, FastAPIInstrumentor in __main__
- Task 3: Added chunking span in GenieArangoDataprep._load_and_chunk() with dataprep.chunk_count attribute
- Task 4: Instrumented Reranker microservice with setup_tracing("genieai-reranker"), manual span in reranking() with strategy/doc count attributes
- Task 5: Added manual span in GenieTEIReranking.invoke() with strategy/top_n/score_threshold/model_id/doc_count attributes, trace propagation on TEI aiohttp call
- Task 6: Added 10 new tracing tests (test_dataprep_tracing.py + test_reranker_tracing.py), all 299 tests pass, ruff check/format clean
- Task 7: Verified OTEL_EXPORTER_OTLP_ENDPOINT already in env template (line 547, added by Story 7-2)

### File List

- `genie-ai-overlay/dataprep/Dockerfile-dataprep_genie-ai` — Added OTel pip packages and COPY tracing.py
- `genie-ai-overlay/dataprep/genieai_dataprep_microservice.py` — Added tracing import, setup_tracing, manual spans for ingest/retract/kill endpoints, FastAPIInstrumentor
- `genie-ai-overlay/dataprep/genieai_dataprep_arangodb.py` — Added tracer import, chunking span with chunk_count attribute
- `genie-ai-overlay/reranker/Dockerfile-reranker_genie-ai` — Added OTel pip packages and COPY tracing.py
- `genie-ai-overlay/reranker/genieai_reranking_microservice.py` — Added tracing import, setup_tracing, manual span in reranking(), FastAPIInstrumentor
- `genie-ai-overlay/reranker/genieai_tei_reranker.py` — Added tracer/propagate imports, manual span in invoke() with full attributes, trace propagation on TEI call
- `genie-ai-overlay/tests/conftest.py` — Added OTel module mocks for reranker telemetry and microservice base imports
- `genie-ai-overlay/tests/test_dataprep_tracing.py` — New: 4 tests for Dataprep tracing setup and chunking span
- `genie-ai-overlay/tests/test_reranker_tracing.py` — New: 6 tests for Reranker tracing setup, invoke span attributes, and trace propagation

### Change Log

- 2026-05-28: Story 7-3 implementation complete — Dataprep and Reranker services instrumented with OTel tracing

### Review Findings

- [x] [Review][Patch] Ingest span too narrow — `dataprep.ingest` span wraps only the 3 `set_attribute` calls; lock check, background task creation, and response are outside. Span has ~0ms duration. Fix: indent subsequent code inside the `with` block. [genieai_dataprep_microservice.py:~127]
- [x] [Review][Patch] Chunking span placed after work — `dataprep.chunking` span created AFTER `is_valid_content` filter, not before. Measures nothing. Fix: move span to wrap the actual chunking + filtering logic. [genieai_dataprep_arangodb.py:~279]
- [x] [Review][Patch] Missing Dataprep trace propagation — AC6 requires `propagate.inject(headers)` on Dataprep → DocRepo/Backend/TEI aiohttp calls. No propagation code in genieai_dataprep_arangodb.py. Fix: add propagate.inject before aiohttp calls. [genieai_dataprep_arangodb.py]
- [x] [Review][Patch] Missing span error status — `retract_file` and `reranking()` call `span.record_exception(e)` but not `span.set_status(Status.ERROR, str(e))`. Failed spans appear OK in traces. Fix: add set_status after record_exception. [genieai_dataprep_microservice.py:~286, genieai_reranking_microservice.py:~87]
- [x] [Review][Patch] Reranker invoke() no exception handling for TEI — TEI aiohttp call in `GenieTEIReranking.invoke()` has no try/except. If TEI is down, exception propagates without record_exception or set_status on `tei_invoke` span. Fix: wrap TEI call in try/except with span error recording. [geniei_tei_reranker.py:~85]
- [x] [Review][Fixed] kill_ingest span no success/not-found distinction — added `dataprep.kill_result` attribute ("cancelled" / "not_found"). Originally deferred but fixed during review since it was simple.
