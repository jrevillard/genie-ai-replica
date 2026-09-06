const { createLogger, format, transports } = require('winston');
const DailyRotateFile = require('winston-daily-rotate-file');
const fs = require('fs');
const path = require('path');

const { trace, context, metrics: otelMetrics } = require('@opentelemetry/api');

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

// Default log format
const logFormat = format.printf(({ level, message, timestamp, trace_id, span_id }) => {
  const base = `${timestamp} [${level.toUpperCase()}]: ${message}`;
  if (trace_id && trace_id !== '00000000000000000000000000000000') {
    return `${base} trace_id="${trace_id}" span_id="${span_id}"`;
  }
  return base;
});

// Default configuration for the logger
const loggerConfig = {
  level: process.env.LOG_LEVEL || 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.errors({ stack: true }),
    traceFormat(),
    logFormat
  ),
  transports: [
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
      maxSize: '10m',
      maxFiles: '30d',
      zippedArchive: true
    }),
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: '10m',
      maxFiles: '30d',
      zippedArchive: true
    }),
    new transports.File({
      filename: 'logs/combined.log',
      maxsize: 5242880, // 5MB
      maxFiles: 1,
      tailable: true, // Recreate log file when max size is reached
      handleExceptions: true
    })
  ]
};

// Create the initial logger instance
const logger = createLogger(loggerConfig);

// Function to reconfigure the logger
const reconfigureLogger = (newConfig) => {
  // Update the configuration with new values (if provided)
  loggerConfig.level = newConfig.level || loggerConfig.level;
  loggerConfig.transports = [
    new transports.Console({
      handleExceptions: true,
      json: false,
      colorize: true,
      stderrLevels: ['error']
    }),
    new DailyRotateFile({
      filename: 'logs/error-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      level: 'error',
      maxSize: newConfig.errorMaxSize || '10m',
      maxFiles: newConfig.errorMaxFiles || '30d',
      zippedArchive: newConfig.zippedArchive !== undefined ? newConfig.zippedArchive : true
    }),
    new DailyRotateFile({
      filename: 'logs/combined-%DATE%.log',
      datePattern: 'YYYY-MM-DD',
      maxSize: newConfig.combinedMaxSize || '10m',
      maxFiles: newConfig.combinedMaxFiles || '30d',
      zippedArchive: newConfig.zippedArchive !== undefined ? newConfig.zippedArchive : true
    }),
    new transports.File({
      filename: 'logs/combined.log',
      maxsize: newConfig.combinedLogMaxSize || 5242880, // 5MB
      maxFiles: newConfig.combinedLogMaxFiles || 1,
      tailable: true,
      handleExceptions: true
    })
  ];

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
  // Exposed for parity assertions in tests; canonical source of truth lives
  // in components/gov-chat-backend/metrics.js (AD-18 forbids a shared
  // helper crossing shared/lib → backend).
  LOG_DROPPED_REASON
};
