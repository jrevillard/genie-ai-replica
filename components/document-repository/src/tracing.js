// tracing.js — OpenTelemetry SDK initialization (LOGS-ONLY path) for document-repository.
// PARALLEL of components/gov-chat-backend/tracing.js with these differences per AD-18:
//
// - Resource `service.name` = 'genie-document-repository' (pinned per AD-2).
// - Logs-only: NO OTLPTraceExporter, NO OTLPMetricExporter,
//   NO PeriodicExportingMetricReader. Only OTLPLogExporter.
// - No NodeSDK / no auto-instrumentations / no span processor — doc-repo ships
//   no traces, no metrics.
// - LoggerProvider processor order: PIIRedactingLogRecordProcessor (which
//   wraps an inner BatchLogRecordProcessor). The PII processor wraps the
//   batch processor internally, so `processors: [new PIIRedactingLogRecordProcessor({ exporter, ...sharedBatchConfig })]`
//   preserves the "PII first, batching second" AD-4 invariant in a single
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
  // AD-2: stream field pinning — `service.name` is a hardcoded literal
  // ('genie-backend' / 'genie-document-repository'). No env-var indirection.
  // ATTR_DEPLOYMENT_ENVIRONMENT is undefined in some semantic-conventions
  // versions (it was moved between stable and experimental); the spread below
  // falls back to the raw key when undefined.
  const semconv = require('@opentelemetry/semantic-conventions');
  const ATTR_SERVICE_NAME = semconv.ATTR_SERVICE_NAME;
  const ATTR_SERVICE_VERSION = semconv.ATTR_SERVICE_VERSION;
  const ATTR_DEPLOYMENT_ENVIRONMENT = semconv.ATTR_DEPLOYMENT_ENVIRONMENT;
  const { logs } = require('@opentelemetry/api-logs');
  const { resourceFromAttributes } = require('@opentelemetry/resources');
  const { OTLPLogExporter } = require('@opentelemetry/exporter-logs-otlp-http');
  const { LoggerProvider } = require('@opentelemetry/sdk-logs');
  const { PIIRedactingLogRecordProcessor } = require('./tracing-pii-logs');
  // AD-14: single boolean-env.js helper, accepts 1/true/TRUE/yes — NOT strict `=== '1'`.
  const { booleanEnv } = require('../shared/lib/boolean-env');
  // AD-18: shared batch tuning — both backend and document-repository require this file
  // to avoid per-component drift in BatchLogRecordProcessor queue / batch / delay config.
  const sharedBatchConfig = require('../shared/lib/otel-batch-config');

  // Resource attributes (pinned literal per AD-2).
  const serviceName = 'genie-document-repository';
  const serviceVersion = process.env.npm_package_version || '1.0.0';
  const deploymentEnvironment = process.env.NODE_ENV || 'development';

  // Create exporter — base URL from env var, append signal-specific path
  // (aligned with OPEA tracing.py + backend tracing.js).
  const endpointBase = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

  // LoggerProvider for OTel logs — gated on LOG_TO_VICTORIALOGS (CAP-1) AND
  // ENABLE_OBSERVABILITY (AD-7). Already inside the ENABLE_OBSERVABILITY gate
  // above (the whole else branch is skipped when observability is disabled),
  // so the inner gate reduces to `LOG_TO_VICTORIALOGS`.
  //
  // PIIRedactingLogRecordProcessor (tracing-pii-logs.js) wraps an inner
  // BatchLogRecordProcessor constructed with the sdk-logs 0.221.x single-options
  // signature { exporter, ...sharedBatchConfig } (NOT positional `(exporter, config)`).
  // sharedBatchConfig (otel-batch-config.js) pins maxExportBatchSize /
  // scheduledDelayMillis / maxQueueSize for both backend + document-repository
  // (AD-18). PII first, batching second (AD-4) is preserved by the wrapper
  // composition — onEmit redacts before delegating to the inner batch.
  let loggerProvider = null;
  if (booleanEnv('LOG_TO_VICTORIALOGS')) {
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
  const SHUTDOWN_TIMEOUT_MS = 5000;
  const gracefulShutdown = async () => {
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

  process.on('SIGTERM', gracefulShutdown);
  process.on('SIGINT', gracefulShutdown);

  module.exports = { sdk: null, loggerProvider };
}
