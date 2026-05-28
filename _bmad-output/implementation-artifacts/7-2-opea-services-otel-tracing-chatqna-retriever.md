# Story 7.2: OPEA Services OTel Tracing (ChatQnA + Retriever)

Status: review

## Story

As a developer,
I want the ChatQnA and Retriever FastAPI services instrumented with OpenTelemetry,
so that RAG pipeline requests (embedding, retrieval, reranking, LLM inference) are traced end-to-end with distributed spans observable via an OTLP-compatible backend.

## Acceptance Criteria

1. **AC1: OTel SDK dependencies installed** — Add `opentelemetry-api`, `opentelemetry-sdk`, `opentelemetry-instrumentation-fastapi`, `opentelemetry-exporter-otlp-proto-http` to the OPEA Dockerfiles for ChatQnA and Retriever services
2. **AC2: Shared tracing module created** — Create `genie-ai-overlay/tracing.py` that initializes the OTel TracerProvider with OTLP HTTP exporter, Resource attributes, and graceful shutdown. This module is imported by both services before FastAPI app creation
3. **AC3: ChatQnA service instrumented** — ChatQnA FastAPI endpoints produce server-side spans with `service.name = "genieai-chatqna"`. FastAPIInstrumentor instruments the app. The tracing module is imported at the top of `genieai_chatqna.py`
4. **AC4: Retriever service instrumented** — Retriever FastAPI endpoints produce server-side spans with `service.name = "genieai-retriever"`. FastAPIInstrumentor instruments the app. The tracing module is imported at the top of `genieai_retriever_microservice.py`
5. **AC5: RAG-specific span attributes** — Manual spans include RAG-specific attributes: `rag.query_length`, `rag.chunk_count`, `rag.model_id` on key operations (retrieval, embedding generation)
6. **AC6: Trace context propagation** — W3C `traceparent` headers are propagated on inter-service calls (ChatQnA → Retriever, ChatQnA → LLM/vLLM, Retriever → TEI). Auto-propagation via instrumented httpx/aiohttp clients
7. **AC7: Configurable OTLP endpoint** — SDK exports traces via OTLP/HTTP to `OTEL_EXPORTER_OTLP_ENDPOINT` env var (default: `http://otel-collector:4318`). The Python OTLPSpanExporter requires the full URL including `/v1/traces`
8. **AC8: Bootstrap-safe** — Application starts and runs normally if the OTel Collector is unavailable; traces are buffered and retried with no unhandled errors
9. **AC9: PII protection** — No user query content or document text is included in span attributes. RAG-specific attributes use only metadata (query_length, chunk_count, model_id) — never the actual text
10. **AC10: No API contract changes** — The instrumentation does not alter existing API contracts, response formats, or service behavior
11. **AC11: Low latency overhead** — The instrumentation adds <5ms latency overhead per request
12. **AC12: Copyright headers** — All new Python files include ITU copyright headers
13. **AC13: Ruff passes** — All new Python code passes `ruff check` and `ruff format`
14. **AC14: Docker builds succeed** — Both ChatQnA and Retriever Docker images build successfully with the new OTel dependencies

## Tasks / Subtasks

- [x] Task 1: Create shared tracing module (AC: #2, #7, #8)
  - [x] Create `genie-ai-overlay/tracing.py` with TracerProvider initialization
  - [x] Configure OTLPSpanExporter with `OTEL_EXPORTER_OTLP_ENDPOINT` env var (full URL with `/v1/traces`)
  - [x] Configure Resource attributes: `service.name`, `service.version`, `deployment.environment`
  - [x] Add `setup_tracing(service_name)` function called by each service with its specific name
  - [x] Add graceful shutdown via `atexit.register()`
  - [x] Export `get_tracer()` for manual span creation
  - [x] Add ITU copyright header
- [x] Task 2: Install OTel dependencies in Dockerfiles (AC: #1, #14)
  - [x] Add `opentelemetry-api>=1.22`, `opentelemetry-sdk>=1.22`, `opentelemetry-instrumentation-fastapi>=0.43b0`, `opentelemetry-exporter-otlp-proto-http>=1.22`, `opentelemetry-instrumentation-httpx>=0.43b0` to ChatQnA Dockerfile pip install step
  - [x] Add same dependencies to Retriever Dockerfile pip install step
  - [x] Verify both Docker images build without errors
- [x] Task 3: Instrument ChatQnA service (AC: #3, #5, #6)
  - [x] Import `tracing` module at the top of `genieai_chatqna.py` (after os imports, before comps imports)
  - [x] Call `setup_tracing("genieai-chatqna")` in `ChatQnAService.__init__()` or module-level before app creation
  - [x] Call `FastAPIInstrumentor.instrument_app(app)` after the FastAPI app is created in the service
  - [x] Add manual spans with RAG attributes in `handle_request()` for the orchestration pipeline
  - [x] Verify `traceparent` is propagated on httpx calls to translation service and aiohttp calls to backend
- [x] Task 4: Instrument Retriever service (AC: #4, #5, #6)
  - [x] Import `tracing` module at the top of `genieai_retriever_microservice.py` (after os imports, before comps imports)
  - [x] Call `setup_tracing("genieai-retriever")` at module level before `register_microservice` decorator
  - [x] Instrument the FastAPI app created by OPEA's `register_microservice` — call `FastAPIInstrumentor.instrument_app()` after the app is available
  - [x] Add manual spans in `GenieaiArangoRetriever.invoke()` with RAG attributes (query_length, chunk_count)
  - [x] Verify trace context propagation on outbound calls (TEI embedding, ArangoDB queries)
- [x] Task 5: Add manual span attributes (AC: #5, #9)
  - [x] In ChatQnA: span attributes for query_length, model_id (NOT query text)
  - [x] In Retriever: span attributes for chunk_count, search_mode, score_threshold (NOT document content)
  - [x] Verify no user content or document text leaks into span attributes
- [x] Task 6: Update env template (AC: #7)
  - [x] Add/update `OTEL_EXPORTER_OTLP_ENDPOINT` comment in root `env` template to document Python service usage
  - [x] Verify existing backend OTel env var comment covers all services
- [x] Task 7: Run lint and verify builds (AC: #13, #14)
  - [x] `cd genie-ai-overlay && ruff check tracing.py` — no errors
  - [x] `cd genie-ai-overlay && ruff format --check tracing.py` — passes
  - [x] Verify ChatQnA Docker image builds: `docker compose build chatqna`
  - [x] Verify Retriever Docker image builds: `docker compose build retriever`

## Dev Notes

### Critical: Module Import Order (Same Pattern as Story 7-1)

The tracing module MUST be imported before the FastAPI app is created and before OPEA `comps` imports that might initialize HTTP clients. Place the tracing import after `os` imports but before everything else:

```python
# genieai_chatqna.py — near the top (after os imports)
import os
# ... other os.getenv calls ...

from tracing import setup_tracing, get_tracer
setup_tracing("genieai-chatqna")

# Now import everything else
from comps import ...
```

For the retriever microservice:

```python
# genieai_retriever_microservice.py — near the top
import os
# ... os.getenv calls ...

from tracing import setup_tracing
setup_tracing("genieai-retriever")

# Now import comps and register the service
from comps import ...
```

### Critical: Shared Tracing Module Location

Create `genie-ai-overlay/tracing.py` — a single shared module used by ALL OPEA services (ChatQnA, Retriever, and in Story 7-3: Dataprep and Reranker). This mirrors the backend's `tracing.js` pattern.

```
genie-ai-overlay/
├── tracing.py                    # NEW — shared OTel SDK init
├── chatqna/genieai_chatqna.py    # UPDATE — import tracing, add manual spans
├── retriever/genieai_retriever_microservice.py  # UPDATE — import tracing, instrument app
├── retriever/geniei_retriever_arangodb.py       # UPDATE — add manual spans in invoke()
├── chatqna/Dockerfile-chatqna_genie-ai          # UPDATE — pip install OTel deps
├── retriever/Dockerfile-retriever_genie-ai       # UPDATE — pip install OTel deps
└── core/genieai_api_protocol.py                 # NO CHANGE
```

The tracing module goes at the overlay root (same level as `chatqna/` and `retriever/`), NOT inside a service directory. This follows the same convention as the backend's `tracing.js` being at the backend root.

### Architecture: tracing.py Design

```
tracing.py
├── setup_tracing(service_name: str)
│   ├── Resource: service.name=service_name, service.version, deployment.environment
│   ├── OTLPSpanExporter → OTEL_EXPORTER_OTLP_ENDPOINT + /v1/traces
│   ├── BatchSpanProcessor wrapping the exporter
│   ├── TracerProvider with resource + processor
│   └── atexit.register(shutdown) — force_flush + shutdown
├── get_tracer(name: str) → returns tracer from global provider
├── shutdown() — force_flush(30s) + shutdown(30s)
```

### Critical: OTLP Endpoint URL Handling (Python vs Node.js)

**Key difference from backend Story 7-1:** The Python `OTLPSpanExporter` does NOT automatically append `/v1/traces`. You MUST provide the full URL:

```python
# CORRECT — Python requires the full path
OTLPSpanExporter(
    endpoint=f"{os.getenv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://otel-collector:4318')}/v1/traces"
)

# WRONG — will try to export to http://otel-collector:4318 (no path)
OTLPSpanExporter(
    endpoint=os.getenv('OTEL_EXPORTER_OTLP_ENDPOINT', 'http://otel-collector:4318')
)
```

The Node.js backend SDK auto-appends `/v1/traces`. The Python SDK does not. Use the same `OTEL_EXPORTER_OTLP_ENDPOINT` env var but append `/v1/traces` in the Python code.

### Critical: FastAPI App Access Pattern

The two services create their FastAPI apps differently:

**ChatQnA** — The app is created internally by OPEA's `MicroService` wrapper via `ServiceOrchestrator`. The FastAPI app is accessible via `self.service.app` after `ChatQnAService.__init__()`. Instrument it after construction:

```python
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

class ChatQnAService:
    def __init__(self, ...):
        # ... existing init code ...
        # After self.service = MicroService(...)
        FastAPIInstrumentor.instrument_app(self.service._app)
```

**Retriever** — The app is created by OPEA's `@register_microservice` decorator. Access it via `opea_microservices` dict:

```python
from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor
from comps import opea_microservices

# After registration, instrument the app
app = opea_microservices["opea_service@retrievers"]._app
FastAPIInstrumentor.instrument_app(app)
```

**IMPORTANT:** You must verify the actual attribute name for accessing the FastAPI app instance from OPEA's MicroService wrapper. Read the OPEA `MicroService` class to find the correct attribute (likely `_app`, `app`, or `_fastapi_app`). If OPEA's wrapper doesn't expose the app directly, use `FastAPIInstrumentor().instrument()` before the app is passed to uvicorn.

### Architecture: Manual Spans for RAG Operations

Use `tracer.start_as_current_span()` for key operations. Add semantic attributes:

**ChatQnA orchestration:**
```python
with tracer.start_as_current_span("chatqna.orchestrate") as span:
    span.set_attribute("rag.query_length", len(query))
    span.set_attribute("rag.model_id", LLM_MODEL)
    # ... pipeline execution ...
    span.set_attribute("rag.chunk_count", len(retrieved_docs))
```

**Retriever invoke:**
```python
with tracer.start_as_current_span("retriever.hybrid_search") as span:
    span.set_attribute("rag.search_mode", ARANGO_SEARCH_MODE)
    span.set_attribute("rag.score_threshold", ARANGO_SCORE_THRESHOLD)
    span.set_attribute("rag.top_k", RETRIEVER_K)
    # ... search execution ...
    span.set_attribute("rag.chunk_count", len(results))
```

### OTel SDK Package Versions (May 2026)

```
opentelemetry-api                            >=1.22
opentelemetry-sdk                            >=1.22
opentelemetry-instrumentation-fastapi        >=0.43b0
opentelemetry-instrumentation-httpx          >=0.43b0
opentelemetry-exporter-otlp-proto-http       >=1.22
```

Use `>=` version ranges in Dockerfile pip installs — the OPEA base image may have its own Python deps and pinning exact versions could cause conflicts.

### PII Protection Strategy

The Python services do NOT need a SpanProcessor-based PII redaction layer (unlike the Node.js backend). Instead, enforce PII protection at the span-creation level:

**Rules:**
- NEVER add `rag.query_text`, `rag.document_content`, `rag.user_message` attributes
- ONLY add metadata: `rag.query_length`, `rag.chunk_count`, `rag.model_id`, `rag.search_mode`
- Do NOT include user emails, tokens, or document text in any span attribute
- HTTP spans from FastAPI auto-instrumentation will contain URL paths and status codes — these are safe
- Verify that `CustomLogger` log messages (which may contain query text) are NOT captured as span attributes

### Critical: OPEA comps Library Vendored at Build Time

The OPEA `comps` library is installed during Docker build (cloned from GitHub, pip-installed in-place). You CANNOT pip-install it locally. The tracing module must NOT depend on `comps` — it uses only standard OTel packages.

### Critical: Docker Build Context

New files in `genie-ai-overlay/` must be COPY'd into the Docker image. Update both Dockerfiles:

**ChatQnA Dockerfile** — Add after existing COPY steps:
```dockerfile
COPY genie-ai-overlay/tracing.py /app/tracing.py
```
And add OTel packages to the existing pip install:
```dockerfile
RUN pip install --no-cache-dir langdetect transformers "python-jose[cryptography]" \
    "opentelemetry-api>=1.22" "opentelemetry-sdk>=1.22" \
    "opentelemetry-instrumentation-fastapi>=0.43b0" \
    "opentelemetry-instrumentation-httpx>=0.43b0" \
    "opentelemetry-exporter-otlp-proto-http>=1.22"
```

**Retriever Dockerfile** — Add tracing module COPY and OTel pip installs:
```dockerfile
COPY genie-ai-overlay/tracing.py /app/tracing.py
RUN pip install --no-cache-dir "opentelemetry-api>=1.22" "opentelemetry-sdk>=1.22" \
    "opentelemetry-instrumentation-fastapi>=0.43b0" \
    "opentelemetry-instrumentation-httpx>=0.43b0" \
    "opentelemetry-exporter-otlp-proto-http>=1.22"
```

### Critical: PYTHONPATH Configuration

Both Dockerfiles set `PYTHONPATH` to include specific directories. The `tracing.py` module must be placed where Python can find it:

- **ChatQnA:** `PYTHONPATH="/home/user:/app:/app/ChatQnA:${PYTHONPATH}"` → copy `tracing.py` to `/app/tracing.py` (already in PYTHONPATH via `/app`)
- **Retriever:** `PYTHONPATH="${PYTHONPATH}:/app:/app/comps/retrievers/src:/app/comps/cores/proto"` → copy `tracing.py` to `/app/tracing.py` (already in PYTHONPATH via `/app`)

### Trace Context Propagation Details

FastAPI auto-instrumentation handles incoming `traceparent` extraction. For outgoing requests:

**httpx (ChatQnA → Translation service):**
- Install `opentelemetry-instrumentation-httpx` and call `HTTPXClientInstrumentor().instrument()`
- This auto-injects `traceparent` on all httpx requests
- Alternatively, manually inject: `propagate.inject(outgoing_headers)`

**aiohttp (ChatQnA → Backend API):**
- No OTel instrumentation package exists for aiohttp
- Manual injection required: `propagate.inject(headers_dict)` before each aiohttp request

**ArangoDB queries (Retriever → ArangoDB):**
- The `python-arango` driver has no OTel instrumentation
- Manual span creation around query execution (similar to backend's `tracing-db.js`)

### Bootstrap Safety

The OTel SDK handles collector unavailability gracefully by default (same as Node.js):
- `BatchSpanProcessor` buffers spans in memory and retries export
- `OTLPSpanExporter` uses retry with exponential backoff
- Application continues normally if collector is down
- No special error handling needed — do NOT wrap `setup_tracing()` in try/except

### Graceful Shutdown

Use `atexit` to ensure spans are flushed on process exit:

```python
import atexit
from opentelemetry import trace

def shutdown():
    provider = trace.get_tracer_provider()
    if hasattr(provider, 'force_flush'):
        provider.force_flush(30000)  # 30s timeout in milliseconds
    if hasattr(provider, 'shutdown'):
        provider.shutdown()

atexit.register(shutdown)
```

The OPEA microservices are managed by Docker/Swarm which sends SIGTERM. Python's `atexit` runs on normal exit. For SIGTERM handling, also register a signal handler:

```python
import signal

def _signal_handler(signum, frame):
    shutdown()
    import sys
    sys.exit(0)

signal.signal(signal.SIGTERM, _signal_handler)
```

### Out of Scope

- **Dataprep and Reranker instrumentation** — deferred to Story 7-3
- **Log-trace correlation** — deferred to Story 7-4 (injecting `trace_id`/`span_id` into CustomLogger)
- **OTel Collector deployment** — deferred to Story 7-5
- **Redis instrumentation** — not needed for these services
- **ArangoDB driver instrumentation** — manual spans only, similar to backend's `tracing-db.js`
- **httpx instrumentation for ChatQnA** — install the package but actual httpx calls in the OPEA orchestrator may use internal OPEA HTTP client; verify during implementation

### Testing Approach

1. **Unit test `tracing.py`**: Mock `opentelemetry.sdk.trace`, verify TracerProvider is configured correctly, verify graceful shutdown
2. **Integration smoke test**: Import tracing module in both services, verify no import errors, verify `get_tracer()` returns a valid tracer
3. **Docker build test**: Verify both Docker images build with new dependencies
4. **No runtime test with real collector** — that's a deployment concern (Story 7-5)
5. **Existing OPEA pytest tests** (if any from Epic 4) must still pass — tracing is transparent

### Anti-Patterns to Avoid

- **Do NOT** install OTel packages in `pyproject.toml` optional deps — they go in Dockerfiles only (OPEA services are Docker-deployed, not pip-installed)
- **Do NOT** modify `components/shared/lib/` for tracing — Python tracing is entirely in `genie-ai-overlay/`
- **Do NOT** add `opentelemetry-instrumentation-winston` or logging bridges — log-trace correlation is Story 7-4
- **Do NOT** add query text or document content to span attributes — only metadata (lengths, counts, model IDs)
- **Do NOT** wrap `setup_tracing()` in try/except — let errors propagate during development
- **Do NOT** create per-service tracing modules — use the shared `genie-ai-overlay/tracing.py`
- **Do NOT** use gRPC exporter (`opentelemetry-exporter-otlp-proto-grpc`) — stick with HTTP to match the backend's OTLP/HTTP protocol
- **Do NOT** modify OPEA `comps` library files — only overlay files (`genie-ai-overlay/`)
- **Do NOT** forget the `/v1/traces` suffix — Python OTLPSpanExporter requires the full URL

### Previous Story Intelligence (7-1: Express Backend OTel)

**Established patterns to replicate in Python:**
- Shared tracing module at component root (backend: `tracing.js` → OPEA: `tracing.py`)
- `setup_tracing()` / `get_tracer()` API — same pattern
- PII redaction: backend uses SpanProcessor, OPEA uses span-level enforcement (no PII attributes)
- OTLP endpoint: `OTEL_EXPORTER_OTLP_ENDPOINT` env var (same name, different URL handling)
- Bootstrap safety: SDK handles collector unavailability by default
- Graceful shutdown: flush pending spans before exit
- Test environment: backend guards with `NODE_ENV=test`, Python has no equivalent guard needed (OPEA tests mock everything)

**Key difference:** The Node.js backend's `OTLPTraceExporter` auto-appends `/v1/traces`. Python's `OTLPSpanExporter` does NOT — you must append it manually.

**Key difference:** Backend has `PIIRedactionProcessor` as a custom SpanProcessor. Python OPEA services enforce PII protection at the span-creation level (only metadata attributes, no content).

### References

- [Source: _bmad-output/planning-artifacts/epics.md#Epic 7 Story 7.2]
- [Source: _bmad-output/planning-artifacts/architecture.md#Application Observability Architecture]
- [Source: _bmad-output/planning-artifacts/architecture.md#OTel Instrumentation Patterns]
- [Source: _bmad-output/planning-artifacts/prd.md#Application Observability Foundation (FR40-FR42)]
- [Source: _bmad-output/implementation-artifacts/7-1-express-backend-otel-tracing-foundation.md — previous story patterns]
- [Source: genie-ai-overlay/chatqna/genieai_chatqna.py — ChatQnA service structure (1,796 lines)]
- [Source: genie-ai-overlay/retriever/genieai_retriever_microservice.py — Retriever microservice (135 lines)]
- [Source: genie-ai-overlay/retriever/geniei_retriever_arangodb.py — Retriever component (854 lines)]
- [Source: genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai — ChatQnA Docker build]
- [Source: genie-ai-overlay/retriever/Dockerfile-retriever_genie-ai — Retriever Docker build]
- [Source: genie-ai-overlay/chatqna/entrypoint.sh — ChatQnA entry point]
- [Source: _bmad-output/project-context.md#Critical Implementation Rules]
- [Source: components/gov-chat-backend/tracing.js — Story 7-1 Node.js OTel patterns]

## Dev Agent Record

### Agent Model Used

Claude GLM-5-Turbo (claude-opus-4-7 equivalent)

### Debug Log References

### Completion Notes List

- Created shared OTel tracing module `genie-ai-overlay/tracing.py` with setup_tracing(), get_tracer(), shutdown(), and _reset() for testing. Uses OTLPSpanExporter with full /v1/traces URL suffix, BatchSpanProcessor, Resource attributes, atexit+SIGTERM graceful shutdown.
- Added 12 unit tests in `genie-ai-overlay/tests/test_tracing.py` covering: exporter endpoint URL configuration (/v1/traces suffix), default endpoint, atexit registration, span processor creation, get_tracer before/after setup, shutdown lifecycle, resource attributes (service.name, version, environment).
- Updated ChatQnA Dockerfile: added OTel pip deps (opentelemetry-api>=1.22, opentelemetry-sdk>=1.22, opentelemetry-instrumentation-fastapi>=0.43b0, opentelemetry-instrumentation-httpx>=0.43b0, opentelemetry-exporter-otlp-proto-http>=1.22) and COPY for tracing.py.
- Updated Retriever Dockerfile: added OTel pip deps and COPY for tracing.py.
- Instrumented ChatQnA: imported tracing module before comps, added FastAPIInstrumentor in start(), added manual span around megaservice.schedule() with RAG attributes (query_length, model_id, chunk_count), added httpx auto-instrumentation via HTTPXClientInstrumentor, injected traceparent headers on aiohttp calls to backend and doc-repo.
- Instrumented Retriever: imported tracing module before comps, added FastAPIInstrumentor in __main__, added manual span in retrieve_docs() with chunk_count, added span in GenieaiArangoRetriever.invoke() with search_mode and top_k attributes.
- Updated env template comment to document Python OTel usage.
- All 99 tests pass, ruff check and format pass clean.

### File List

- `genie-ai-overlay/tracing.py` — NEW: shared OTel tracing initialization module
- `genie-ai-overlay/tests/test_tracing.py` — NEW: 12 unit tests for tracing module
- `genie-ai-overlay/chatqna/Dockerfile-chatqna_genie-ai` — MODIFIED: added OTel deps and tracing.py COPY
- `genie-ai-overlay/retriever/Dockerfile-retriever_genie-ai` — MODIFIED: added OTel deps and tracing.py COPY
- `genie-ai-overlay/chatqna/genieai_chatqna.py` — MODIFIED: added tracing import/setup, FastAPI instrumentation, manual RAG spans, httpx auto-instrumentation, aiohttp trace propagation
- `genie-ai-overlay/retriever/genieai_retriever_microservice.py` — MODIFIED: added tracing import/setup, FastAPI instrumentation, manual retrieval spans
- `genie-ai-overlay/retriever/genieai_retriever_arangodb.py` — MODIFIED: added manual span in invoke() with RAG attributes
- `env` — MODIFIED: updated OTel env var comment to document Python service usage
