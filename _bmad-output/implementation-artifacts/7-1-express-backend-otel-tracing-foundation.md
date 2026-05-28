# Story 7.1: Express Backend OTel Tracing Foundation

Status: ready-for-dev

## Story

As a developer,
I want the Express backend instrumented with OpenTelemetry tracing,
so that every HTTP request, database query, and external API call produces distributed trace spans observable via an OTLP-compatible backend.

## Acceptance Criteria

1. **AC1: OTel SDK dependencies installed** — Add `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`, `@opentelemetry/core` to `components/gov-chat-backend/package.json` as production dependencies
2. **AC2: Tracing module created** — Create `components/gov-chat-backend/tracing.js` that initializes the OTel NodeSDK with Express HTTP auto-instrumentation, OTLP HTTP exporter, and resource attributes (`service.name = "genie-backend"`, `service.version`, `deployment.environment`)
3. **AC3: HTTP spans produced** — All Express route handlers automatically produce HTTP server spans (method, url, status_code) with no manual span creation for standard request/response flows
4. **AC4: ArangoDB query spans** — Database queries produce spans with `db.system = "arangodb"`, `db.name`, `db.collection`, `db.operation` attributes via a tracing wrapper in the backend (NOT by modifying shared `db-connection-service.js`)
5. **AC5: Outbound HTTP spans** — Outbound HTTP calls (to OPEA ChatQnA, Keycloak, weather APIs, translation services) automatically produce client-side HTTP spans with `traceparent` propagation
6. **AC6: Configurable OTLP endpoint** — SDK exports traces via OTLP/HTTP to `OTEL_EXPORTER_OTLP_ENDPOINT` env var (default: `http://otel-collector:4318` — the SDK automatically appends `/v1/traces`)
7. **AC7: Bootstrap-safe** — Application starts and runs normally if the OTel Collector is unavailable; traces are buffered and retried with no unhandled errors
8. **AC8: PII sanitization** — Sensitive data (passwords, tokens, query content, user emails) is sanitized from span attributes AND from JSON-stringified attribute values before export via a custom SpanProcessor
9. **AC9: Initialization order** — `tracing.js` is imported as the very first line in `index.js` (before Express and all other modules) to ensure auto-instrumentation hooks activate before module loading
10. **AC10: Graceful shutdown** — SDK shuts down cleanly on SIGTERM/SIGINT, awaiting `sdk.shutdown()` completion before calling `process.exit()` to flush pending traces
11. **AC11: All existing tests pass** — No regression in the existing 999 backend tests; `tracing.js` is a no-op when `NODE_ENV=test` so tests are never affected by OTel initialization
12. **AC12: Lint passes** — New code passes ESLint with the project's flat config

## Tasks / Subtasks

- [ ] Task 1: Install OTel SDK dependencies (AC: #1)
  - [ ] Add production dependencies to `components/gov-chat-backend/package.json`: `@opentelemetry/api`, `@opentelemetry/sdk-node`, `@opentelemetry/auto-instrumentations-node`, `@opentelemetry/exporter-trace-otlp-http`, `@opentelemetry/resources`, `@opentelemetry/semantic-conventions`, `@opentelemetry/core`
  - [ ] Run `npm install` and verify no conflicts with Express 4.18, axios 1.10, winston 3.17
- [ ] Task 2: Create `tracing.js` module (AC: #2, #6, #7, #8, #9, #10, #11)
  - [ ] Add early return guard: when `NODE_ENV === 'test'`, export no-op sdk and tracer without initializing OTel
  - [ ] Implement `NodeSDK` initialization with resource attributes
  - [ ] Configure `OTLPTraceExporter` with env var endpoint (pass raw endpoint URL, SDK appends `/v1/traces`)
  - [ ] Configure `getNodeAutoInstrumentations()` for HTTP + Express
  - [ ] Implement `PIIRedactionProcessor` as a custom SpanProcessor — scan both attribute keys AND stringified attribute values for email/token patterns
  - [ ] Add graceful shutdown handlers (SIGTERM, SIGINT) that `await sdk.shutdown()` before `process.exit(0)`
  - [ ] Export `sdk` and `getTracer()` for manual span creation
- [ ] Task 3: Wire tracing into `index.js` (AC: #9)
  - [ ] Add `require('./tracing');` as the FIRST line in `index.js` (before any other require)
  - [ ] Verify `createApp()` works correctly with tracing active
  - [ ] Note: tests that import `createApp` directly (not via `index.js`) will NOT load tracing — this is expected and correct; do NOT add tracing inside `createApp()`
- [ ] Task 4: Add ArangoDB tracing wrapper (AC: #4)
  - [ ] Create a thin tracing helper in `components/gov-chat-backend/` (e.g., `tracing-db.js`) that wraps ArangoDB calls with manual spans
  - [ ] Add `db.system`, `db.name`, `db.collection`, `db.operation` attributes to spans
  - [ ] Use `getTracer()` from `tracing.js` (NOT a new `@opentelemetry/api` import)
  - [ ] Do NOT modify `components/shared/lib/db-connection-service.js` — it is shared across components
  - [ ] Apply the wrapper in service files where ArangoDB queries are called
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

Tests that import `createApp` directly (not from `index.js`) will NOT load `tracing.js` — this is expected and correct. The `NODE_ENV=test` guard in `tracing.js` ensures that even if tests do load it via `index.js`, OTel is a no-op.

### Critical: Test Environment Guard

`tracing.js` MUST check `NODE_ENV === 'test'` before initializing the SDK. When the guard triggers, export a no-op sdk and tracer:

```javascript
if (process.env.NODE_ENV === 'test') {
  module.exports = { sdk: null, getTracer: () => ({ startSpan: () => ({ end: () => {}, setAttribute: () => {} }) }) };
  return;
}
```

This ensures the 999 existing tests are never affected by OTel initialization, regardless of how they import modules.

### Critical: CommonJS Only

The backend uses CommonJS exclusively. All OTel imports must use `require()`, never `import`. The `@opentelemetry/*` packages fully support CommonJS — no transpilation needed.

### Architecture: tracing.js Design

```
tracing.js
├── Test Guard: NODE_ENV === 'test' → export no-ops, return early
├── PII Redaction (custom SpanProcessor wrapping BatchSpanProcessor)
│   └── Sanitizes: keys (password, token, secret, auth, credential, api_key)
│   └── Sanitizes: values (email patterns in strings, JSON-embedded tokens)
├── NodeSDK
│   ├── Resource: service.name="genie-backend", service.version, deployment.environment
│   ├── TraceExporter: OTLPTraceExporter → OTEL_EXPORTER_OTLP_ENDPOINT (SDK appends /v1/traces)
│   ├── Instrumentations: getNodeAutoInstrumentations()
│   │   ├── @opentelemetry/instrumentation-http (auto client+server spans)
│   │   └── @opentelemetry/instrumentation-express (auto route spans)
│   └── TextMapPropagator: W3CTraceContextPropagator (traceparent header)
└── Graceful shutdown: SIGTERM/SIGINT → await sdk.shutdown() → process.exit(0)
```

### Architecture: ArangoDB Tracing Wrapper

`components/shared/lib/db-connection-service.js` (63 KB) is a singleton shared across backend AND document-repository. **Do NOT modify it.**

Instead, create a thin wrapper in the backend:

```
components/gov-chat-backend/tracing-db.js   # NEW — wraps ArangoDB calls with spans
```

The wrapper uses `getTracer()` from `tracing.js` to create manual spans around database operations. Apply it at the service-call level in individual service files where `db.query()` is invoked.

The arangojs driver does NOT have an OTel instrumentation package, so manual spans are required.

### Architecture: OTLP Endpoint URL Handling

The `OTLPTraceExporter` automatically appends `/v1/traces` to the configured URL. Configure the exporter with the base URL only:

```javascript
new OTLPTraceExporter({
  url: process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://otel-collector:4318',
  // SDK sends to http://otel-collector:4318/v1/traces automatically
})
```

Do NOT manually append `/v1/traces` to the endpoint URL — this causes doubled paths (`/v1/traces/v1/traces`).

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

The custom `PIIRedactionProcessor` wraps the `BatchSpanProcessor` and sanitizes before export. Two layers of redaction:

**Layer 1 — Key matching** (case-insensitive substring):
- `password`, `token`, `secret`, `authorization`, `credential`, `api_key`
- Match → set value to `[REDACTED]`

**Layer 2 — Value scanning** (for string values):
- Email pattern: `/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/` → `[REDACTED]`
- Bearer token pattern: `/Bearer\s+\S+/i` → `[REDACTED]`
- JSON-stringified bodies may contain PII — scan string attributes for these patterns

Do NOT redact:
- `service.name`, `service.version`, `deployment.environment`
- HTTP method, URL path (without query params), status code
- `db.system`, `db.name`, `db.operation`, `db.collection`
- Trace/span IDs

### Graceful Shutdown

The SIGTERM/SIGINT handlers MUST await `sdk.shutdown()` before calling `process.exit()`:

```javascript
const gracefulShutdown = async (signal) => {
  await sdk.shutdown();
  process.exit(0);
};
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);
```

Do NOT call `process.exit()` synchronously — pending traces will be lost.

### Bootstrap Safety

The OTel SDK handles collector unavailability gracefully by default:
- Built-in retry with exponential backoff (max 5 attempts)
- Application continues normally if collector is down
- Traces are buffered in memory and flushed when collector becomes available
- No unhandled promise rejections on collector failure

No special error handling needed beyond what the SDK provides. Do NOT wrap the SDK init in try/catch or add conditional initialization (beyond the `NODE_ENV=test` guard).

### Out of Scope: Redis Instrumentation

Redis (`ioredis@5.8.2`) calls are NOT instrumented in this story. `@opentelemetry/instrumentation-ioredis` exists but is deferred to keep scope minimal. Redis cache operations will not appear in traces until a future story adds it.

### Environment Variable

Add to root `env` template (Section: Observability):
```
# OpenTelemetry — distributed tracing endpoint (optional, defaults to collector service)
OTEL_EXPORTER_OTLP_ENDPOINT=http://otel-collector:4318
```

This env var follows the OTel standard naming convention. The SDK appends `/v1/traces` automatically.

### Existing Backend Structure (Key Files)

| File | Purpose | OTel Relevance |
|------|---------|---------------|
| `index.js` | createApp() + server start | **MUST add `require('./tracing')` as line 1** |
| `config.js` | API, Keycloak, security config | Read env vars for resource attributes |
| `routes/*.js` | 13 route files | Auto-instrumented by Express instrumentation |
| `services/query-service.js` | OPEA ChatQnA HTTP calls | Auto-instrumented by HTTP client instrumentation |
| `services/chat-history-service.js` | ArangoDB CRUD | Apply `tracing-db.js` wrapper here |
| `services/keycloak-auth-service.js` | Keycloak HTTP calls | Auto-instrumented by HTTP client instrumentation |
| `services/translation-service.js` | Translation HTTP calls | Auto-instrumented by HTTP client instrumentation |
| `services/weather-service.js` | External weather APIs | Auto-instrumented by HTTP client instrumentation |
| `middleware/keycloak-auth-middleware.js` | JWT verification | Spans auto-created per request |
| `middleware/errors.js` | Custom error classes | Error attributes auto-captured |
| `components/shared/lib/db-connection-service.js` | ArangoDB connection singleton | **Do NOT modify** — shared across components |
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

1. **Unit test `tracing.js`**: Mock `@opentelemetry/sdk-node`, verify SDK starts with correct config, verify `NODE_ENV=test` guard returns no-ops
2. **Integration test**: Start app with `NODE_ENV != test`, make HTTP request, verify spans are created (capture with `InMemorySpanExporter`)
3. **Regression**: Run full existing test suite (`NODE_ENV=test`) — all 999 tests pass because tracing is a no-op in test mode
4. **Do NOT** test with a real OTel Collector — that's a deployment concern (Story 7.5)

### Anti-Patterns to Avoid

- **Do NOT** add OTel imports inside `createApp()` — the tracing module must be loaded before Express
- **Do NOT** use ESM `import` syntax — backend is CommonJS only
- **Do NOT** create global auth middleware for OTel — OTel is infrastructure, not application logic
- **Do NOT** modify `components/shared/lib/` shared library for tracing — keep instrumentation in the backend component only
- **Do NOT** instrument `db-connection-service.js` directly — use `tracing-db.js` wrapper instead
- **Do NOT** add `@opentelemetry/instrumentation-winston` yet — log-trace correlation is Story 7.4
- **Do NOT** add `@opentelemetry/instrumentation-ioredis` — Redis instrumentation is out of scope
- **Do NOT** add custom spans for every service method — start with auto-instrumentation only, add manual DB spans minimally
- **Do NOT** add OTel SDK to `devDependencies` — it must be in `dependencies` for production use
- **Do NOT** add tracing to the test setup files (`__tests__/mocks/`) — tests should NOT require OTel
- **Do NOT** manually append `/v1/traces` to the OTLP endpoint URL — the SDK does this automatically
- **Do NOT** call `process.exit()` synchronously in shutdown handlers — always `await sdk.shutdown()` first

### Project Structure Notes

New files:
```
components/gov-chat-backend/
├── tracing.js                          # NEW — OTel SDK initialization + test guard + PII redaction
├── tracing-db.js                       # NEW — ArangoDB manual span wrapper
├── package.json                        # UPDATE — add @opentelemetry/* deps
├── index.js                            # UPDATE — add require('./tracing') as line 1
```

Both `tracing.js` and `tracing-db.js` go at the backend root (same level as `index.js`), NOT in a subdirectory. This follows the convention of infrastructure modules like `config.js`.

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
