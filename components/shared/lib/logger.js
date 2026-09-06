const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const fs = require('fs');
const path = require('path');

const { trace, context, metrics: otelMetrics } = require('@opentelemetry/api');
const { booleanEnv } = require('./boolean-env');
const { VictoriaLogsTransport } = require('./victorialogs-transport');

// observability_disabled call-site: module-load counter.
// AD-18 forbids shared/lib → backend require; the meter scope matches
// `components/gov-chat-backend/metrics.js` so all call-sites converge on the
// same instrument. The local REASONS mirror is the canonical enum, kept in
// sync via review — any `.add()` call that passes a raw string is rejected.
const LOG_DROPPED_REASON = Object.freeze({
  QUEUE_FULL: 'queue_full',
  OTLP_UNREACHABLE: 'otlp_unreachable',
  OBSERVABILITY_DISABLED: 'observability_disabled'
});

// Module-load counter creation is guarded so the OTel SDK being absent (or
// `getMeter` throwing at require-time) never breaks module loading — every
// consumer of this module depends on the require succeeding. A throw leaves
// `_droppedCounter` as the no-op stub below: subsequent `.add()` calls
// become absorbed and the rest of the logger pipeline keeps working.
const _droppedCounter = (() => {
  try {
    return otelMetrics
      .getMeter('genie-backend', process.env.npm_package_version || '1.0.0')
      .createCounter('log_record_dropped_total', {
        description: 'Otel log records dropped before export'
      });
  } catch {
    return { add: () => {} };
  }
})();

// Once-per-process latch — observability status is an environment knob, not a
// per-log decision. Reading it at module load matches the existing test-mode
// guard pattern in tracing.js:10. Used to attribute every log emitted while
// observability is OFF as `observability_disabled` (no OTel correlation is
// possible → log is effectively dropped from the OTel-victorialogs pipeline).
const OBSERVABILITY_DISABLED = process.env.ENABLE_OBSERVABILITY !== '1';

// Winston format that injects trace_id, span_id, and service from the active OTel span
const traceFormat = format((info) => {
  const span = trace.getSpan(context.active());
  if (span) {
    const { traceId, spanId } = span.spanContext();
    info.trace_id = traceId;
    info.span_id = spanId;
  } else {
    info.trace_id = '00000000000000000000000000000000';
    info.span_id = '0000000000000000';
    if (OBSERVABILITY_DISABLED) {
      // Log emitted without OTel correlation — count it as a drop from the
      // OTel-victorialogs pipeline. The metric call is wrapped because a
      // counter failure MUST NOT corrupt log records (the formatter is on the
      // critical path of every log emit).
      try {
        _droppedCounter.add(1, { reason: LOG_DROPPED_REASON.OBSERVABILITY_DISABLED });
      } catch {
        // never break the log pipeline over a metric failure
      }
    }
  }
  info.service = process.env.SERVICE_NAME || 'genie-backend';
  return info;
});

// Gate the VictoriaLogs transport on both flags so VL only fans out when the
// observability stack is on AND the deployment opts in. Re-evaluated on every
// reconfigure so env-var toggles take effect without restart.
const victoriaLogsEnabled = () => booleanEnv('LOG_TO_VICTORIALOGS') && booleanEnv('ENABLE_OBSERVABILITY');

// Single source of truth for the transport list — used by both the initial
// `loggerConfig` and `reconfigureLogger`, so toggling env vars between
// successive reconfigures (or between restart and first reconfig) is honoured.
const buildTransports = (config = {}) => {
  const list = [
    new transports.Console({
      handleExceptions: true, // Log unhandled exceptions
      json: false,
      colorize: true, // Colorize output for readability
      stderrLevels: ['error'] // Write error logs to stderr
    }),
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: config.errorMaxSize || '10m',
      maxFiles: config.errorMaxFiles || '30d',
      zippedArchive: config.zippedArchive !== undefined ? config.zippedArchive : true
    }),
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: config.combinedMaxSize || '10m',
      maxFiles: config.combinedMaxFiles || '30d',
      zippedArchive: config.zippedArchive !== undefined ? config.zippedArchive : true
    }),
    new transports.File({
      filename: 'logs/combined.log',
      maxsize: config.combinedLogMaxSize || 5242880, // 5MB
      maxFiles: config.combinedLogMaxFiles || 1,
      tailable: true, // Recreate log file when max size is reached
      handleExceptions: true
    })
  ];
  if (victoriaLogsEnabled()) {
    list.push(new VictoriaLogsTransport({ service: process.env.SERVICE_NAME || 'genie-backend' }));
  }
  return list;
};

// Default configuration for the logger
const loggerConfig = {
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    traceFormat(), // injects info.trace_id / info.span_id / info.service; json() picks them up as keys
    format.json()
  ),
  transports: buildTransports({})
};

// Create the initial logger instance
const logger = createLogger(loggerConfig);

// Function to reconfigure the logger
const reconfigureLogger = (newConfig) => {
  // Update the configuration with new values (if provided)
  loggerConfig.level = newConfig.level || loggerConfig.level;
  // Re-build the transport list via the same helper so the VL gate runs again
  // — toggling the env vars between restarts (or between successive
  // reconfigures) is honoured.
  loggerConfig.transports = buildTransports(newConfig);

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

// Function to trigger an immediate log rollover
const triggerLogRollover = () => {
  try {
    const currentErrorTransport = logger.transports.find(
      (transport) => transport instanceof DailyRotateFile && transport.level === 'error'
    );
    const currentCombinedTransport = logger.transports.find(
      (transport) => transport instanceof DailyRotateFile && !transport.level
    );

    if (currentErrorTransport && typeof currentErrorTransport.rotate === 'function') {
      currentErrorTransport.rotate();
      logger.info('Error log rolled over manually');
    } else {
      logger.warn('Error log transport not found or does not support rotation');
    }

    if (currentCombinedTransport && typeof currentCombinedTransport.rotate === 'function') {
      currentCombinedTransport.rotate();
      logger.info('Combined log rolled over manually');
    } else {
      logger.warn('Combined log transport not found or does not support rotation');
    }

    logger.info('Log rollover operation completed');
  } catch (error) {
    logger.error(`Error during log rollover: ${error.message}`);
    throw error;
  }
};

// Function to clean up the large combined.log file
const cleanupCombinedLog = () => {
  try {
    const combinedLogPath = path.join(process.cwd(), 'logs/combined.log');

    if (fs.existsSync(combinedLogPath)) {
      fs.unlinkSync(combinedLogPath);
      logger.info('Large combined.log file has been removed');
    } else {
      logger.info('combined.log file not found, no cleanup needed');
    }
  } catch (error) {
    logger.error(`Error cleaning up combined.log: ${error.message}`);
    throw error;
  }
};

// Function to flush logs immediately
const flushLogs = () => {
  logger.transports.forEach((transport) => {
    if (transport.flush && typeof transport.flush === 'function') {
      transport.flush();
    }
  });
  logger.info('Logs flushed immediately');
};

// Export the logger and the functions
module.exports = {
  logger,
  traceFormat: traceFormat(),
  reconfigureLogger,
  triggerLogRollover,
  cleanupCombinedLog,
  flushLogs,
  victoriaLogsEnabled,
  // Exposed for parity assertions in tests; canonical source of truth lives
  // in components/gov-chat-backend/metrics.js (AD-18 forbids a shared
  // helper crossing shared/lib → backend).
  LOG_DROPPED_REASON
};
