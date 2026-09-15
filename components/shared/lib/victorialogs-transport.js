// components/shared/lib/victorialogs-transport.js
// Winston TransportStream → OTel LoggerProvider (VictoriaLogs via Collector).
// Lazy transport: consumes via `logs.getLogger`; the LoggerProvider is set by tracing.js.
// Module-load guard ensures the OTel SDK being absent never breaks the require; failed
// emits are swallowed as designed.
'use strict';

const TransportStream = require('winston-transport');
const { logs, SeverityNumber } = require('@opentelemetry/api-logs');
// shared/lib cannot require backend metrics.js — define the meter
// directly against the OTel global MeterProvider. The meter scope
// (SERVICE_NAME + SERVICE_VERSION) matches `components/gov-chat-backend/metrics.js`
// so all call-sites converge on the same counter instrument.
const { metrics: otelMetrics } = require('@opentelemetry/api');

const ZERO_TRACE_ID = '00000000000000000000000000000000';
const ZERO_SPAN_ID = '0000000000000000';

// Local mirror of metrics.js's LOG_DROPPED_REASON (no shared helper crosses
// `shared/lib → backend`). Canonical source of truth:
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
// transport keeps swallowing dropped emits as designed.
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
    // `service` is reported as an attribute; downstream maps to stream
    // field. Decoupled from `this.name` so callers can override service identity
    // without renaming the transport instance.
    // Single source of truth for `service.name` resolution — the OTel spec
    // mandates `OTEL_SERVICE_NAME` as the canonical env var. We accept it
    // FIRST (overriding the constructor's `opts.service` arg) so that
    // operators can flip the value per environment without code changes.
    // Matches `logger.js:84` so the JSON `service` field and the
    // `LogRecord.attributes.service` field never diverge.
    this._service =
      process.env.OTEL_SERVICE_NAME ||
      opts.service ||
      process.env.SERVICE_NAME ||
      'genie-backend';
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

      const timestampMs = toMilliseconds(info.timestamp);

      const logger = logs.getLogger(this._loggerName);
      logger.emit({
        // OTel SDK TimeInput is UNIX EPOCH MILLISECONDS (NOT nanoseconds) —
        // passing nanoseconds overflows the SDK's hrTime conversion (1.789e18
        // ms is misinterpreted and produces a pre-1970 timestamp that VL then
        // drops as out-of-retention). See toMilliseconds() for the contract.
        timestamp: timestampMs,
        observedTimestamp: Date.now(),
        severityNumber,
        severityText,
        body,
        attributes
      });
    } catch {
      // Killing VL must not block any Node service. Drop counter lives
      // Mirror the canonical enum from `components/gov-chat-backend/metrics.js`;
      // increment the bounded `queue_full` reason so
      // the swallowed failure is observable in Prometheus. The metric call is
      // wrapped in its own try/catch because a counter failure MUST NOT
      // escape the transport (we are inside a swallow by design).
      try {
        _droppedCounter.add(1, { reason: LOG_DROPPED_REASON.QUEUE_FULL });
      } catch {
        // counter failure must never break the log pipeline
      }
    } finally {
      // Winston transport contract: `callback()` must run AFTER
      // `emit('logged', info)` so downstream listeners observe the event
      // before the transport considers the record "fully written".
      setImmediate(() => {
        this.emit('logged', info);
        callback();
      });
    }
  }
}

// Returns UNIX EPOCH MILLISECONDS (NOT nanoseconds). The OTel JS SDK's
// `TimeInput` is epoch ms — passing nanoseconds overflows the SDK's
// `millisToHrTime` conversion (1.789e18 ms is mis-read and produces a
// pre-1970 timestamp that VL then drops as out-of-retention).
//
// Accepts:
//   - undefined / null  → Date.now() (current epoch ms)
//   - number            → treated as epoch ms already (Date.now() shape)
//   - string            → Date.parse (ISO 8601, or YYYY-MM-DD HH:mm:ss from
//                         Winston's format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }))
function toMilliseconds(value) {
  if (value === undefined || value === null) {
    return Date.now();
  }
  let ms;
  if (typeof value === 'number') {
    ms = value;
  } else {
    const parsed = Date.parse(String(value));
    ms = Number.isFinite(parsed) ? parsed : NaN;
  }
  return Number.isFinite(ms) ? ms : Date.now();
}

module.exports = {
  VictoriaLogsTransport,
  // Exposed for parity assertions in tests; canonical source of truth lives
  // in components/gov-chat-backend/metrics.js (no shared
  // helper crossing shared/lib → backend).
  LOG_DROPPED_REASON
};
