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
  const { runInBackgroundSpan } = require('../shared-lib/tracing-background');
  // TracerProvider for trace export. doc-repo needs real IDs on the
  // spans created via `tracer.startSpan(name)` so the Winston formatter
  // stamps trace_id/span_id on log records; the spans themselves ship
  // to the OTel Collector via OTLP and end up in VictoriaTraces (full
  // distributed-trace visibility, matching backend). Uses
  // `@opentelemetry/exporter-trace-otlp-http` (added to package.json)
  // pointed at the same OTLP endpoint as the log exporter.
  const traceEndpoint = `${endpointBase}/v1/traces`;
  const { OTLPSpanExporter } = require('@opentelemetry/exporter-trace-otlp-http');
  const { TracerProvider, BatchSpanProcessor } = require('@opentelemetry/sdk-trace');
  const _docRepoTracerProvider = new TracerProvider();
  _docRepoTracerProvider.addSpanProcessor(new BatchSpanProcessor(new OTLPSpanExporter({ url: traceEndpoint })));
  trace.setGlobalTracerProvider(_docRepoTracerProvider);

  // Resource attributes (pinned literal). service.version reads the
  // doc-repo package.json (npm does NOT propagate npm_package_version
  // into Docker runtime; the previous "1.0.0" fallback was misleading —
  // every deployment looked at v1.0.0 regardless of the actual image
  // tag). Operators can still override via the `SERVICE_VERSION` env var.
  const fs = require('fs');
  const path = require('path');
  function _readPackageVersion() {
    try {
      const pkg = JSON.parse(
        fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8')
      );
      return pkg.version || '0.0.0';
    } catch {
      return '0.0.0';
    }
  }
  const serviceName = 'genie-document-repository';
  const serviceVersion = process.env.SERVICE_VERSION || _readPackageVersion();
  const deploymentEnvironment = process.env.NODE_ENV || 'development';

  // Create exporter — base URL from env var, append signal-specific path
  // (aligned with OPEA tracing.py + backend tracing.js).
  const endpointBase = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

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
  let loggerProvider = null;
  if (booleanEnv('LOG_TO_VICTORIALOGS', true)) {
    const logExporter = new OTLPLogExporter({
      url: `${endpointBase}/v1/logs`
    });
    loggerProvider = new LoggerProvider({
      resource: resourceFromAttributes({
        [ATTR_SERVICE_NAME]: serviceName,
        [ATTR_SERVICE_VERSION]: serviceVersion,
        ...(ATTR_DEPLOYMENT_ENVIRONMENT !== undefined
          ? { [ATTR_DEPLOYMENT_ENVIRONMENT]: deploymentEnvironment }
          : { 'deployment.environment': deploymentEnvironment })
      }),
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
  const gracefulShutdown = async (signame) => {
    let flushed = false;
    const timeout = setTimeout(() => {
      if (!flushed) process.exit(0);
    }, SHUTDOWN_TIMEOUT_MS);
    try {
      await loggerProvider?.shutdown();
      flushed = true;
    } catch {
      // Shutdown errors are non-fatal — best-effort flush
    }
    clearTimeout(timeout);
    process.exit(0);
  };

  // Use `withBackgroundSpan` (async) so the returned Promise is awaited
  // and any rejection inside gracefulShutdown is recorded on the span
  // instead of becoming an unhandled rejection. `runInBackgroundSpan`
  // (sync) drops the Promise on the floor and leaks the span.
  process.on('SIGTERM', () => withBackgroundSpan(
    'otel.shutdown',
    () => gracefulShutdown('SIGTERM'),
    { 'genie.signal': 'SIGTERM' }
  ));
  process.on('SIGINT', () => withBackgroundSpan(
    'otel.shutdown',
    () => gracefulShutdown('SIGINT'),
    { 'genie.signal': 'SIGINT' }
  ));

  module.exports = { sdk: null, loggerProvider };
}
