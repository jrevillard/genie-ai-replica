const { createLogger, format, transports } = require('winston');

const { trace, context } = require('@opentelemetry/api');

// Winston format that injects trace_id, span_id, and service from the active OTel span.
//
// Service-name resolution (priority order):
//   1. `process.env.OTEL_SERVICE_NAME` — production source of truth. Set by
//      docker-compose.yaml per-service (backend → `backend`, doc-repo →
//      `document-repository`). Wins because the OTel Resource + fluentd
//      driver both read it; Winston writes it into the LogRecord envelope
//      so VictoriaLogs and the OTel collector agree on identity.
//   2. `process.env.npm_package_name` — defensive only. The npm CLI sets
//      this when running `npm run <script>`; production Docker entrypoints
//      invoke `node` directly (`CMD ["node", "index.js"]`) so it is
//      typically undefined at runtime. Useful for local dev / npm-spawned
//      tooling where OTEL_SERVICE_NAME is not forwarded.
//   3. `'genie-shared'` — fallback for any consumer outside a known
//      component (CLI scripts, ad-hoc tools).
//
// Why this priority: the OTel Resource (from tracing.js) stamps
// `service.name` on traces + metrics; the fluentd driver stamps
// `service.name` on logs from the Compose label. Both paths converge on
// `OTEL_SERVICE_NAME` in production. Reading the same env here keeps the
// three channels (trace, metric, log) aligned on one identifier without
// duplicating a Compose override.
//
// trace_id / span_id semantics: when no active OTel span exists (background
// work, worker threads, db-connection-service called outside a request span
// context), the keys are OMITTED rather than zeroed. All-zero trace_ids
// were a regression — VL's `_stream:{trace_id=...}` filter treats zeros as
// a real bucket and groups every orphan log under one false stream.
const traceFormat = format((info) => {
  const span = trace.getSpan(context.active());
  if (span) {
    const { traceId, spanId } = span.spanContext();
    info.trace_id = traceId;
    info.span_id = spanId;
  }
  info.service = process.env.OTEL_SERVICE_NAME || process.env.npm_package_name || 'genie-shared';
  return info;
});

// Single source of truth for the transport list — used by both the initial
// `loggerConfig` and `reconfigureLogger` so a reconfigure cannot produce a
// different transport shape than the one the logger booted with.
//
// Console is the ONLY transport. Log shipping to VictoriaLogs goes through
// the Docker fluentd driver → OTel Collector → VL, not through winston, so
// a second in-process transport would duplicate every line.
const buildTransports = () => [
  new transports.Console({
    handleExceptions: true, // Log unhandled exceptions
    json: false,
    colorize: true, // Colorize output for readability
    stderrLevels: ['error'] // Write error logs to stderr
  })
];

// Default configuration for the logger
const loggerConfig = {
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    traceFormat(), // injects info.trace_id / info.span_id / info.service; json() picks them up as keys
    format.json()
  ),
  transports: buildTransports()
};

// Create the initial logger instance
const logger = createLogger(loggerConfig);

// Function to reconfigure the logger
const reconfigureLogger = (newConfig) => {
  // Update the configuration with new values (if provided)
  loggerConfig.level = newConfig.level || loggerConfig.level;
  loggerConfig.transports = buildTransports();

  // Clear existing transports
  logger.clear();

  // Apply the new configuration
  logger.configure({
    level: loggerConfig.level,
    format: loggerConfig.format,
    transports: loggerConfig.transports
  });

  logger.info('Logger configuration updated');
};

// Export the logger and the functions
module.exports = {
  logger,
  traceFormat: traceFormat(),
  reconfigureLogger
};
