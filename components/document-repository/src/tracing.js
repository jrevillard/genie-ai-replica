// tracing.js — OpenTelemetry SDK initialization (TRACES-ONLY path) for document-repository.
// PARALLEL of components/gov-chat-backend/tracing.js with these differences:
//
// - Resource `service.name` = 'document-repository' (pinned, matches Compose block).
// - Traces-only: no SDK logs/metrics modules. Single emit path for logs is
//   winston -> stdout -> fluentd driver -> OTel collector -> VL (mirrors
//   backend after admin-logs SDK revert).
// - No NodeSDK / no auto-instrumentations. PII redaction happens at the
//   collector edge (admin-logs/T1-pii-redactor transform).
//
// Test environment guard OR observability disabled — no-op (must be before any
// OTel requires). ENABLE_OBSERVABILITY is the single gate: when disabled the
// Collector is not deployed, so SDK init would produce DNS errors.
// OTEL_EXPORTER_OTLP_ENDPOINT always has a compose default and cannot be used
// as the gate. Mirrors backend `tracing.js:5-37`.

if (process.env.NODE_ENV === 'test' || process.env.ENABLE_OBSERVABILITY !== '1') {
  module.exports = {
    sdk: null
  };
} else {
  // stream field pinning — `service.name` is a hardcoded literal
  // ('genie-backend' / 'genie-document-repository'). No env-var indirection.
  // ATTR_DEPLOYMENT_ENVIRONMENT is undefined in some semantic-conventions
  // versions (it was moved between stable and experimental); the spread below
  // falls back to the raw key when undefined.
  const semconv = require('@opentelemetry/semantic-conventions');
  const ATTR_SERVICE_NAME = semconv.ATTR_SERVICE_NAME;
  const ATTR_SERVICE_NAMESPACE = semconv.ATTR_SERVICE_NAMESPACE;
  const ATTR_SERVICE_VERSION = semconv.ATTR_SERVICE_VERSION;
  const ATTR_DEPLOYMENT_ENVIRONMENT = semconv.ATTR_DEPLOYMENT_ENVIRONMENT;
  const { trace } = require('@opentelemetry/api');
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  // Background-task tracing helpers — used by the SIGTERM/SIGINT handlers
  // below so the emitted shutdown logs inherit a real trace_id instead of
  // being orphaned. Deep import matches the existing shared-lib/X pattern
  // (Docker drops `/lib/` from the path; Jest moduleNameMapper in
  // jest.config.js routes both `../shared-lib/X` and the source-tree
  // `../shared/lib/X` to the real file).
  const { setScopeName, withBackgroundSpan } = require('../shared-lib/tracing-background');
  // OTLP base URL — read once, then reused for both the trace and the log
  // exporter endpoints. Pulled up to the top of the else block so neither
  // exporter construction reads it in a TDZ window (the previous ordering
  // had `traceEndpoint` reference `endpointBase` 30 lines before its
  // declaration, throwing ReferenceError at module load).
  const endpointBase = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  // Resource attributes — stamped on every span this TracerProvider emits
  // (so spans carry service.name in VictoriaTraces). Logs no longer flow
  // through the OTel SDK (single emit path is winston -> stdout -> fluentd
  // -> collector -> VL); the collector stamps the Compose-derived
  // service.name on log records, so the SDK log path is no longer needed
  // to keep the two channels aligned.
  const fs = require('fs');
  const path = require('path');
  function _readPackageVersion() {
    // Read THIS component's package.json (not the shared
    // `components/package.json`) — otherwise both backend + doc-repo
    // would report the same version, defeating the per-component claim.
    // `__dirname` for tracing.js at `components/document-repository/src/tracing.js`
    // resolves to `components/document-repository/src/`, so the parent
    // path lands on `components/document-repository/package.json`.
    try {
      const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf8'));
      return pkg.version || '0.0.0';
    } catch {
      return '0.0.0';
    }
  }
  // Canonical container identifier — must match the Compose block name
  // in docker-compose.yaml so the OTel Resource's service.name aligns
  // with the Compose label the fluentd driver forwards (collector
  // transform stamps service.name from the Compose label for logs;
  // OTel SDK stamps it from this value for traces + metrics — both
  // paths produce the same identifier when this matches the Compose
  // block name). No env override — operators who want a different name
  // for a canary should override at the Compose layer, not here.
  const serviceName = 'document-repository';
  // Stamp otel.scope.name=document-repository on every span this SDK
  // emits. The shared helper defaults to 'backend' (the backend
  // service name); without this call every doc-repo span would land
  // in VictoriaTraces under the wrong scope and the
  // otel.scope.name:document-repository filter returns zero rows.
  // Set BEFORE the TracerProvider is constructed so the first
  // trace.getTracer() call uses the right scope.
  setScopeName(serviceName);
  const serviceNamespace = process.env.OTEL_SERVICE_NAMESPACE || 'genie-core';
  const serviceVersion = process.env.SERVICE_VERSION || _readPackageVersion();
  const deploymentEnvironment = process.env.NODE_ENV || 'development';

  const resource = resourceFromAttributes({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_SERVICE_NAMESPACE]: serviceNamespace,
    [ATTR_SERVICE_VERSION]: serviceVersion,
    // ATTR_DEPLOYMENT_ENVIRONMENT is undefined in some semantic-conventions
    // versions — use raw key as fallback.
    ...(ATTR_DEPLOYMENT_ENVIRONMENT !== undefined
      ? { [ATTR_DEPLOYMENT_ENVIRONMENT]: deploymentEnvironment }
      : { 'deployment.environment': deploymentEnvironment })
  });

  // TracerProvider for trace export. doc-repo needs real IDs on the
  // spans created via `tracer.startSpan(name)` so the Winston formatter
  // stamps trace_id/span_id on log records; the spans themselves ship
  // to the OTel Collector via OTLP and end up in VictoriaTraces (full
  // distributed-trace visibility, matching backend). The TracerProvider
  // must be constructed WITH a Resource — otherwise every exported span
  // has no `service.name` attribute, breaking the VL stream filter.
  const traceEndpoint = `${endpointBase}/v1/traces`;
  const { OTLPTraceExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  const { TracerProvider } = require('@opentelemetry/sdk-trace');
  const { PIIRedactionSpanProcessor } = require('./tracing-pii-spans');
  // Span-side PII redactor wraps the BatchSpanProcessor so every span
  // emitted by doc-repo (HTTP auto-instrumentation + background spans
  // from runInBackgroundSpan / withBackgroundSpan) has its attributes
  // scrubbed before export. Without this, doc-repo spans carry URL
  // paths, header values, and request bodies verbatim to VictoriaTraces
  // — asymmetric with backend which DOES redact.
  const _docRepoTracerProvider = new TracerProvider({
    resource,
    // OTel JS SDK 2.x: spanProcessors is a constructor option, not a
    // post-construction setter (the 1.x `addSpanProcessor` method was
    // removed; the SDK now wraps the array in a MultiSpanProcessor
    // internally). Without this, _activeSpanProcessor stays uninitialized
    // and exported spans are silently dropped.
    spanProcessors: [new PIIRedactionSpanProcessor(new OTLPTraceExporter({ url: traceEndpoint }))]
  });
  trace.setGlobalTracerProvider(_docRepoTracerProvider);
  // Register an AsyncLocalStorage-based ContextManager so
  // `tracer.startActiveSpan(...)` and `context.with(...)` propagate
  // trace context across awaits. Without this, the OTel JS API uses
  // the noop ContextManager and span contexts never propagate
  // (causing every emitted log to lose its `trace_id`). doc-repo does
  // NOT use NodeSDK (which auto-installs the context manager), so we
  // must register explicitly. Backend is unaffected (NodeSDK installs
  // this for it at startup).
  const { context } = require('@opentelemetry/api');
  const { AsyncLocalStorageContextManager } = require('@opentelemetry/context-async-hooks');
  context.setGlobalContextManager(new AsyncLocalStorageContextManager());

  // Graceful shutdown — flush the TracerProvider on SIGTERM/SIGINT.
  // Doc-repo has no NodeSDK (logs-only), so no sdk.shutdown() to call.
  // The signal name is captured as a span attribute (low-cardinality
  // span name, high-cardinality detail per OTel semconv guidance).
  const SHUTDOWN_TIMEOUT_MS = 15000;
  const gracefulShutdown = async (_signame) => {
    let flushed = false;
    const timeout = setTimeout(() => {
      if (!flushed) process.exit(0);
    }, SHUTDOWN_TIMEOUT_MS);
    // Flush + shut down the trace provider FIRST so span batches don't
    // get cut off when the 15 s budget hits.
    try {
      await _docRepoTracerProvider?.shutdown();
      flushed = true;
    } catch {
      // Shutdown errors are non-fatal — best-effort flush
    }
    clearTimeout(timeout);
    process.exit(0);
  };

  // `process.on()` ignores the listener's return value, so the Promise
  // returned by `withBackgroundSpan` would be dropped on the floor —
  // the span's `finally` block never fires, the span leaks, and any
  // rejection inside `gracefulShutdown` becomes an unhandled rejection.
  // Chain `.then().catch()` so the span's `finally { span.end() }`
  // fires BEFORE `process.exit(0)` — calling exit inside the span body
  // terminates the process before the awaiting microtask drains.
  function _registerShutdown(signame) {
    const exitPromise = withBackgroundSpan('otel.shutdown', () => gracefulShutdown(signame), {
      'genie.signal': signame
    });
    exitPromise.then(
      () => process.exit(0),
      (err) => {
        console.error(`[otel.shutdown] ${signame} handler failed:`, err);
        process.exit(1);
      }
    );
  }
  process.on('SIGTERM', () => _registerShutdown('SIGTERM'));
  process.on('SIGINT', () => _registerShutdown('SIGINT'));

  module.exports = { sdk: null };
}
