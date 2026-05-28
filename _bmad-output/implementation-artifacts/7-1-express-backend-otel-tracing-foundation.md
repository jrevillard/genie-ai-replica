# Story 7.1: Express Backend OTel Tracing Foundation

Status: ready-for-dev

## Story

As a developer,
I want the Express backend instrumented with OpenTelemetry tracing,
so that every HTTP request, database query, and external API call produces distributed trace spans observable via an OTLP-compatible backend.

## Acceptance Criteria

1. **AC1: OTel SDK dependencies installed** — Add `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions` to `components/gov-chat-backend/package.json`
2. **AC2: Tracing module created** — Create `components/gov-chat-backend/tracing.js` that initializes the OTel NodeSDK with Express HTTP auto-instrumentation, OTLP HTTP exporter, and resource attributes (`service.name = "genie-backend"`, `service.version`, `deployment.environment`)
3. **AC3: HTTP spans produced** — All Express route handlers automatically produce HTTP server spans (method, url, status_code) with no manual span creation for standard request/response flows
4. **AC4: ArangoDB query spans** — Database queries produce spans with `db.system = "arangodb"`, `db.name`, `db.collection`, `db.operation` attributes (manual instrumentation via tracer)
5. **AC5: Outbound HTTP spans** — Outbound HTTP calls (to OPEA ChatQnA, Keycloak, weather APIs, translation services) automatically produce client-side HTTP spans with `traceparent` propagation
6. **AC6: Configurable OTLP endpoint** — SDK exports traces via OTLP/HTTP to `OTEL_EXPORTER_OTLP_ENDPOINT` env var (default: `http://otel-collector:4318/v1/traces`)
7. **AC7: Bootstrap-safe** — Application starts and runs normally if the OTel Collector is unavailable; traces are buffered and retried with no unhandled errors
8. **AC8: PII sanitization** — Sensitive data (passwords, tokens, query content, user emails) is sanitized from span attributes before export via a custom SpanProcessor
9. **AC9: Initialization order** — `tracing.js` is imported as the very first line in `index.js` (before Express and all other modules) to ensure auto-instrumentation hooks activate before module loading
10. **AC10: Graceful shutdown** — SDK shuts down cleanly on SIGTERM/SIGINT, flushing pending traces
11. **AC11: All existing tests pass** — No regression in the existing 999 backend tests
12. **AC12: Lint passes** — New code passes ESLint with the project's flat config

## Tasks / Subtasks

- [ ] Task 1: Install OTel SDK dependencies (AC: #1)
  - [ ] Add production dependencies to `components/gov-chat-backend/package.json`
  - [ ] Run `npm install` and verify no conflicts with Express 4.18, axios 1.10, winston 3.17
- [ ] Task 2: Create `tracing.js` module (AC: #2, #6, #7, #8, #9, #10)
  - [ ] Implement `NodeSDK` initialization with resource attributes
  - [ ] Configure `OTLPTraceExporter` with env var endpoint
  - [ ] Configure `getNodeAutoInstrumentations()` for HTTP + Express
  - [ ] Implement `PIIRedactionProcessor` as a custom SpanProcessor
  - [ ] Add graceful shutdown handlers (SIGTERM, SIGINT)
  - [ ] Export `sdk` and `getTracer()` for manual span creation
- [ ] Task 3: Wire tracing into `index.js` (AC: #9)
  - [ ] Add `require('./tracing');` as the FIRST line in `index.js` (before any other require)
  - [ ] Verify `createApp()` works correctly with tracing active
- [ ] Task 4: Add manual ArangoDB spans (AC: #4)
  - [ ] Instrument `db-connection-service.js` query method with manual spans
  - [ ] Add `db.system`, `db.name`, `db.collection`, `db.operation` attributes
  - [ ] Use the project's `@opentelemetry/api` tracer (not a new import)
- [ ] Task 5: Verify auto-instrumentation (AC: #3, #5)
  - [ ] Verify Express HTTP server spans appear for all route handlers
  - [ ] Verify outbound HTTP client spans appear for axios calls (OPEA, Keycloak, etc.)
  - [ ] Verify `traceparent` header is propagated on outbound requests
- [ ] Task 6: Add OTel env var to config template (AC: #6)
  - [ ] Add `OTEL_EXPORTER_OTLP_ENDPOINT` to root `env` template with comment
- [ ] Task 7: Run full test suite and lint (AC: #11, #12)
  - [ ] `cd components/gov-chat-backend && npm test` — all 999 tests pass
  - [ ] `npm run lint` — no errors
  - [ ] `npm run format:check` — no formatting issues

## Dev Notes

### Critical: Module Loading Order

The OTel auto-instrumentation works by monkey-patching Node.js `require()`. If Express or `http` is loaded before `tracing.js`, those modules will NOT be instrumented. The import MUST be the first executable line in `index.js`:

```javascript
// index.js — line 1 (before ALL other requires)
require('./tracing');

const express = require('express');
// ... rest of imports
```

**Do NOT** add `require('./tracing')` inside `createApp()` or after other imports.

### Critical: CommonJS Only

The backend uses CommonJS exclusively. All OTel imports must use `require()`, never `import`. The `@opentelemetry/*` packages fully support CommonJS — no transpilation needed.

### Architecture: tracing.js Design

```
tracing.js
├── PII Redaction (custom SpanProcessor wrapping BatchSpanProcessor)
│   └── Sanitizes: password, token, secret, authorization, email, query content
├── NodeSDK
│   ├── Resource: service.name="genie-backend", service.version, deployment.environment
│   ├── TraceExporter: OTLPTraceExporter → OTEL_EXPORTER_OTLP_ENDPOINT
│   ├── Instrumentations: getNodeAutoInstrumentations()
│   │   ├── @opentelemetry/instrumentation-http (auto client+server spans)
│   │   └── @opentelemetry/instrumentation-express (auto route spans)
│   └── TextMapPropagator: W3CTraceContextPropagator (traceparent header)
└── Graceful shutdown: SIGTERM/SIGINT → sdk.shutdown()
```

### Architecture: ArangoDB Manual Instrumentation

`components/shared/lib/db-connection-service.js` (63 KB) is a singleton that manages ArangoDB connections. The `db.query()` method is the primary entry point for all database operations.

**Instrument the query execution path** with manual spans:
- Use `tracer.startSpan('arango.query')` with attributes `db.system="arangodb"`, `db.name`, `db.operation`
- The arangojs driver does NOT have an OTel instrumentation package, so manual spans are required
- Instrument at the service level (where queries are called) rather than in db-connection-service.js itself, to avoid touching shared infrastructure that other components depend on
- Alternative: create a thin wrapper in `components/gov-chat-backend/services/` that adds tracing to ArangoDB calls

### OTel SDK Package Versions (May 2026)

```
@opentelemetry/api                          1.9.1
@opentelemetry/sdk-node                     0.218.0
@opentelemetry/auto-instrumentations-node   0.76.0
@opentelemetry/exporter-trace-otlp-http     0.218.0
@opentelemetry/resources                    2.7.1
@opentelemetry/semantic-conventions         1.41.1
@opentelemetry/core                         1.26.0
```

**Do NOT install `@opentelemetry/sdk-trace-base` or `@opentelemetry/sdk-trace-node` separately** — they are transitive dependencies of `@opentelemetry/sdk-node`.

### PII Redaction Strategy

The custom `PIIRedactionProcessor` wraps the `BatchSpanProcessor` and sanitizes attributes before export. Keys to redact (case-insensitive substring match):
- `password`, `token`, `secret`, `authorization`, `credential`, `api_key`
- User query content (the actual text sent to the RAG pipeline) — redact `http.request.body` and `http.response.body` values
- Email addresses in span attributes

Do NOT redact:
- `service.name`, `service.version`, `deployment.environment`
- HTTP method, URL path (without query params), status code
- `db.system`, `db.name`, `db.operation`, `db.collection`
- Trace/span IDs

### Bootstrap Safety

The OTel SDK handles collector unavailability gracefully by default:
- Built-in retry with exponential backoff (max 5 attempts)
- Application continues normally if collector is down
- Traces are buffered in memory and flushed when collector becomes available
- No unhandled promise rejections on collector failure

**No special error handling needed** beyond what the SDK provides. Do NOT wrap the SDK init in try/catch or add conditional initialization — the SDK should always initialize, even if the collector endpoint is unreachable.

### Environment Variable

Add to root `env` template (Section: Observability):
```
# OpenTelemetry — distributed tracing endpoint (optional, defaults to collector service)
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

This env var follows the OTel standard naming convention. The SDK reads it automatically — no code-level parsing needed beyond passing it to the exporter.

### Existing Backend Structure (Key Files)

| File | Purpose | OTel Relevance |
|------|---------|---------------|
| `index.js` | createApp() + server start | **MUST add `require('./tracing')` as line 1** |
| `config.js` | API, Keycloak, security config | Read env vars for resource attributes |
| `routes/*.js` | 13 route files | Auto-instrumented by Express instrumentation |
| `services/query-service.js` | OPEA ChatQnA HTTP calls | Auto-instrumented by HTTP client instrumentation |
| `services/chat-history-service.js` | ArangoDB CRUD | Manual DB spans needed |
| `services/keycloak-auth-service.js` | Keycloak HTTP calls | Auto-instrumented by HTTP client instrumentation |
| `services/translation-service.js` | Translation HTTP calls | Auto-instrumented by HTTP client instrumentation |
| `services/weather-service.js` | External weather APIs | Auto-instrumented by HTTP client instrumentation |
| `middleware/keycloak-auth-middleware.js` | JWT verification | Spans auto-created per request |
| `middleware/errors.js` | Custom error classes | Error attributes auto-captured |
| `components/shared/lib/db-connection-service.js` | ArangoDB connection singleton | Manual spans for DB operations |
| `components/shared/lib/logger.js` | Winston logger | Future: log-trace correlation (Story 7.4) |

### External HTTP Calls (Auto-Instrumented)

The backend makes outbound HTTP calls via `axios` to these services. All will automatically produce client-side spans with `traceparent` propagation:

1. **OPEA ChatQnA**: `http://${opeaHost}:${opeaPort}/v1/chatqna` — streaming SSE
2. **Keycloak JWKS**: `${keycloakUrl}/realms/${realm}/protocol/openid-connect/certs`
3. **Keycloak UserInfo**: `${keycloakUrl}/realms/${realm}/protocol/openid-connect/userinfo`
4. **ipapi.co**: `https://ipapi.co/json/` — server geolocation
5. **Nominatim**: `https://nominatim.openstreetmap.org/reverse` — reverse geocoding
6. **Translation GPU**: Internal GPU translation service
7. **Google Cloud Translate**: `@google-cloud/translate` SDK (uses `google-auth-library` HTTP transport)

### Testing Approach

1. **Unit test `tracing.js`**: Mock `@opentelemetry/sdk-node`, verify SDK starts with correct config
2. **Integration test**: Start app with tracing, make HTTP request, verify spans are created (capture with `InMemorySpanExporter`)
3. **Regression**: Run full existing test suite — all 999 tests must pass unchanged
4. **Do NOT** test with a real OTel Collector — that's a deployment concern (Story 7.5)

### Anti-Patterns to Avoid

- **Do NOT** add OTel imports inside `createApp()` — the tracing module must be loaded before Express
- **Do NOT** use ESM `import` syntax — backend is CommonJS only
- **Do NOT** create global auth middleware for OTel — OTel is infrastructure, not application logic
- **Do NOT** modify `components/shared/lib/` shared library for tracing — keep instrumentation in the backend component only
- **Do NOT** instrument the `db-connection-service.js` directly — it's shared across components; create a tracing wrapper in the backend instead
- **Do NOT** add `@opentelemetry/instrumentation-winston` yet — log-trace correlation is Story 7.4
- **Do NOT** add custom spans for every service method — start with auto-instrumentation only, add manual DB spans minimally
- **Do NOT** add OTel SDK to `devDependencies` — it must be in `dependencies` for production use
- **Do NOT** add tracing to the test setup files (`__tests__/mocks/`) — tests should NOT require OTel

### Project Structure Notes

New files:
```
components/gov-chat-backend/
├── tracing.js                          # NEW — OTel SDK initialization
├── package.json                        # UPDATE — add @opentelemetry/* deps
├── index.js                            # UPDATE — add require('./tracing') as line 1
```

The `tracing.js` file goes at the backend root (same level as `index.js`), NOT in a subdirectory. This follows the convention of infrastructure modules like `config.js`.

### References

- [Source: _bmad-output/planning-artifacts/architecture.md#Application Observability Architecture]
- [Source: _bmad-output/planning-artifacts/epics.md#Epic 7 Story 7.1]
- [Source: _bmad-output/planning-artifacts/prd.md#Application Observability Foundation (FR40-FR42)]
- [Source: components/gov-chat-backend/index.js — createApp() structure]
- [Source: components/gov-chat-backend/package.json — existing deps]
- [Source: components/shared/lib/db-connection-service.js — DB singleton pattern]
- [Source: _bmad-output/project-context.md#Critical Implementation Rules]

## Dev Agent Record

### Agent Model Used

### Debug Log References

### Completion Notes List

### File List
