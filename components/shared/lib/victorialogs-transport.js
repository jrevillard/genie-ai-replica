// components/shared/lib/victorialogs-transport.js
// Winston TransportStream → OTel LoggerProvider (VictoriaLogs via Collector).
// Per ARCHITECTURE-SPINE.md AD-1, AD-2, AD-4, AD-9, AD-18. Lazy: this transport
// only consumes via `logs.getLogger`; the LoggerProvider is set by tracing.js.
'use strict';

const TransportStream = require('winston-transport');
const { logs, SeverityNumber } = require('@opentelemetry/api-logs');
// AD-18: shared/lib cannot require backend metrics.js — define the meter
// directly against the OTel global MeterProvider. The meter scope
// (SERVICE_NAME + SERVICE_VERSION) matches `components/gov-chat-backend/metrics.js`
// so all call-sites converge on the same counter instrument.
const { metrics: otelMetrics } = require('@opentelemetry/api');

const ZERO_TRACE_ID = '00000000000000000000000000000000';
const ZERO_SPAN_ID = '0000000000000000';

// Local mirror of metrics.js's LOG_DROPPED_REASON (AD-18 forbids a shared
// helper that crosses `shared/lib → backend`). Canonical source of truth:
// components/gov-chat-backend/metrics.js. Keep in sync via review — a
// review-time check rejects any `.add()` call that passes a raw string.
const LOG_DROPPED_REASON = Object.freeze({
  QUEUE_FULL: 'queue_full',
  OTLP_UNREACHABLE: 'otlp_unreachable',
  OBSERVABILITY_DISABLED: 'observability_disabled'
});

// queue_full call-site: create the dropped counter at module
// load so the first swallowed emit is observed. Module-load counter
// creation is guarded so the OTel SDK being absent (or `getMeter` throwing
// at require-time) never breaks module loading — every consumer of this
// module depends on the require succeeding. A throw leaves `_droppedCounter`
// as the no-op stub below: subsequent `.add()` calls become absorbed and the
// transport keeps swallowing dropped emits as designed (CAP-1).
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

const SEVERITY_MAP = {
  error: SeverityNumber.ERROR,
  warn: SeverityNumber.WARN,
  info: SeverityNumber.INFO,
  http: SeverityNumber.INFO,
  verbose: SeverityNumber.DEBUG,
  debug: SeverityNumber.DEBUG,
  silly: SeverityNumber.TRACE
};

const EXCLUDED_ATTRS = new Set(['level', 'message', 'timestamp', 'splat', 'trace_id', 'span_id', 'service']);

class VictoriaLogsTransport extends TransportStream {
  constructor(opts = {}) {
    super(opts);
    this.name = opts.name || 'victorialogs';
    // `service` is reported as an attribute (AD-2); downstream maps to stream
    // field. Decoupled from `this.name` so callers can override service identity
    // without renaming the transport instance.
    this._service = opts.service || process.env.SERVICE_NAME || 'genie-backend';
    this._loggerName = opts.loggerName || 'winston';
    this._enabled = opts.enabled !== false;
  }

  log(info, callback) {
    try {
      if (!this._enabled) {
        return;
      }

      const rawLevel = typeof info.level === 'string' ? info.level : 'info';
      const severityNumber = SEVERITY_MAP[rawLevel] || SeverityNumber.INFO;
      const severityText = rawLevel.toUpperCase();

      const body = typeof info.message === 'string' ? info.message : String(info.message);

      const attributes = { service: info.service || this._service };

      if (info.trace_id && info.trace_id !== ZERO_TRACE_ID) {
        attributes.trace_id = info.trace_id;
      }
      if (info.span_id && info.span_id !== ZERO_SPAN_ID) {
        attributes.span_id = info.span_id;
      }

      for (const key of Object.getOwnPropertyNames(info)) {
        if (EXCLUDED_ATTRS.has(key)) continue;
        const value = info[key];
        if (value === undefined) continue;
        attributes[key] = value;
      }

      const timestampNs = toNanoseconds(info.timestamp);

      const logger = logs.getLogger(this._loggerName);
      logger.emit({
        timestamp: timestampNs,
        observedTimestamp: Date.now() * 1e6,
        severityNumber,
        severityText,
        body,
        attributes
      });
    } catch {
      // CAP-1: killing VL must not block any Node service. Drop counter lives
      // in story 2-12 (metrics); increment the bounded `queue_full` reason so
      // the swallowed failure is observable in Prometheus. The metric call is
      // wrapped in its own try/catch because a counter failure MUST NOT
      // escape the transport (we are inside a swallow by design).
      try {
        _droppedCounter.add(1, { reason: LOG_DROPPED_REASON.QUEUE_FULL });
      } catch {
        // counter failure must never break the log pipeline
      }
    } finally {
      setImmediate(() => this.emit('logged', info));
      callback();
    }
  }
}

function toNanoseconds(value) {
  if (value === undefined || value === null) {
    return Date.now() * 1e6;
  }
  let ms;
  if (typeof value === 'number') {
    ms = value;
  } else {
    const parsed = Date.parse(String(value));
    ms = Number.isFinite(parsed) ? parsed : NaN;
  }
  return Number.isFinite(ms) ? ms * 1e6 : Date.now() * 1e6;
}

module.exports = {
  VictoriaLogsTransport,
  // Exposed for parity assertions in tests; canonical source of truth lives
  // in components/gov-chat-backend/metrics.js (AD-18 forbids a shared
  // helper crossing shared/lib → backend).
  LOG_DROPPED_REASON
};
