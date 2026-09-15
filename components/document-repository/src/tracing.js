// tracing.js — OpenTelemetry SDK initialization (LOGS-ONLY path) for document-repository.
// PARALLEL of components/gov-chat-backend/tracing.js with these differences:
//
// - Resource `service.name` = 'genie-document-repository' (pinned).
// - Logs-only: NO OTLPTraceExporter, NO OTLPMetricExporter,
//   NO PeriodicExportingMetricReader. Only OTLPLogExporter.
// - No NodeSDK / no auto-instrumentations / no span processor — doc-repo ships
//   no traces, no metrics.
// - LoggerProvider processor order: PIIRedactingLogRecordProcessor (which
//   wraps an inner BatchLogRecordProcessor). The PII processor wraps the
//   batch processor internally, so `processors: [new PIIRedactingLogRecordProcessor({ exporter, ...sharedBatchConfig })]`
//   preserves the "PII first, batching second" invariant in a single
//   registration.
//
// Test environment guard OR observability disabled — no-op (must be before any
// OTel requires). ENABLE_OBSERVABILITY is the single gate: when disabled the
// Collector is not deployed, so SDK init would produce DNS errors.
// OTEL_EXPORTER_OTLP_ENDPOINT always has a compose default and cannot be used
// as the gate. Mirrors backend `tracing.js:5-37`.

if (process.env.NODE_ENV === 'test' || process.env.ENABLE_OBSERVABILITY !== '1') {
  module.exports = {
    sdk: null,
    // Logs-only: no withSpan/getTracer (no traces). loggerProvider is the only
    // SDK surface doc-repo exposes; the no-op branch returns `null` so test
    // files can destructure uniformly without conditional checks.
    loggerProvider: null
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
  const { logs } = require('@opentelemetry/api-logs');
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
  const { LoggerProvider } = require('@opentelemetry/sdk-logs');
  const { PIIRedactingLogRecordProcessor } = require('./tracing-pii-logs');
  // single boolean-env.js helper, accepts 1/true/TRUE/yes — NOT strict `=== '1'`.
  // Note: tracing.js lives at components/document-repository/src/tracing.js —
  // in the Docker runtime image this maps to /app/src/tracing.js, so the
  // shared-lib barrel sits ONE level up (`/app/shared-lib`). The source tree
  // path (`../shared/lib/boolean-env`) and the runtime path
  // (`../shared-lib/boolean-env`) both resolve to the same file via the
  // Jest moduleNameMapper (see package.json).
  const { booleanEnv } = require('../shared-lib/boolean-env');
  // shared batch tuning — both backend and document-repository require this file
  // to avoid per-component drift in BatchLogRecordProcessor queue / batch / delay config.
  const sharedBatchConfig = require('../shared-lib/otel-batch-config');
  // Background-task tracing helpers — used by the SIGTERM/SIGINT handlers
  // below so the emitted shutdown logs inherit a real trace_id instead of
  // being orphaned. Deep import matches the existing shared-lib/X pattern
  // (Docker drops `/lib/` from the path; Jest moduleNameMapper in
  // jest.config.js routes both `../shared-lib/X` and the source-tree
  // `../shared/lib/X` to the real file).
  const { withBackgroundSpan } = require('../shared-lib/tracing-background');
  // OTLP base URL — read once, then reused for both the trace and the log
  // exporter endpoints. Pulled up to the top of the else block so neither
  // exporter construction reads it in a TDZ window (the previous ordering
  // had `traceEndpoint` reference `endpointBase` 30 lines before its
  // declaration, throwing ReferenceError at module load).
  const endpointBase = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  // Resource attributes — the SAME resource is used for the TracerProvider
  // (so spans carry service.name in VictoriaTraces) AND for the
  // LoggerProvider (so logs carry the same name). Building two separate
  // resources with the same content would drift over time; share via a
  // single Resource instance.
  //
  // service.name falls back to the OTel-spec env var before the
  // compose-pinned literal — the pinned literal was a regression that
  // prevented operators from overriding per environment.
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
  const serviceName = process.env.OTEL_SERVICE_NAME || 'genie-document-repository';
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

  // LoggerProvider for OTel logs — gated on LOG_TO_VICTORIALOGS AND
  // ENABLE_OBSERVABILITY. Already inside the ENABLE_OBSERVABILITY gate
  // above (the whole else branch is skipped when observability is disabled),
  // so the inner gate reduces to `LOG_TO_VICTORIALOGS`.
  //
  // PIIRedactingLogRecordProcessor (tracing-pii-logs.js) wraps an inner
  // BatchLogRecordProcessor constructed with the sdk-logs 0.221.x single-options
  // signature { exporter, ...sharedBatchConfig } (NOT positional `(exporter, config)`).
  // sharedBatchConfig (otel-batch-config.js) pins maxExportBatchSize /
  // scheduledDelayMillis / maxQueueSize for both backend + document-repository.
  // PII first, batching second is preserved by the wrapper
  // composition — onEmit redacts before delegating to the inner batch.
  //
  // Same `resource` instance as the TracerProvider above — shared so spans
  // and logs both stamp `service.name=genie-document-repository` and
  // Grafana filter `service.name:genie-document-repository` matches both.
  let loggerProvider = null;
  if (booleanEnv('LOG_TO_VICTORIALOGS', true)) {
    const logExporter = new OTLPLogExporter({
      url: `${endpointBase}/v1/logs`
    });
    loggerProvider = new LoggerProvider({
      resource,
      // sdk-logs 0.221.x reads `config.processors` (NOT `logRecordProcessors`).
      processors: [
        new PIIRedactingLogRecordProcessor({
          exporter: logExporter,
          ...sharedBatchConfig
        })
      ]
    });
    logs.setGlobalLoggerProvider(loggerProvider);
  }

  // Graceful shutdown — flush the LoggerProvider on SIGTERM/SIGINT.
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
    // get cut off when the 15 s budget hits. Then the logger provider.
    try {
      await _docRepoTracerProvider?.shutdown();
      flushed = true;
    } catch {
      // Shutdown errors are non-fatal — best-effort flush
    }
    try {
      await loggerProvider?.shutdown();
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

  module.exports = { sdk: null, loggerProvider };
}
