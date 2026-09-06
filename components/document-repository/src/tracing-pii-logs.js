// tracing-pii-logs.js — PII redaction LogRecordProcessor for the OTel logs SDK.
// PARALLEL COPY of components/gov-chat-backend/tracing-pii-logs.js.
//
// AD-18 forbids require()-ing into gov-chat-backend. This file must be kept in
// lockstep with the backend copy — drift risk is the price of avoiding the
// cross-component require. When backend's tracing-pii-logs.js changes, mirror
// the diff here.
//
// Mirrors the composition pattern used by tracing.js (PIIRedactionProcessor for spans):
// wrap an inner BatchLogRecordProcessor and redact attributes before delegating.
//
// Per sdk-logs 0.221.x: BatchLogRecordProcessor takes a SINGLE options object
// { exporter, ...config }, NOT positional `(exporter, config)`. Verified against
// `node_modules/@opentelemetry/sdk-logs/build/src/export/BatchLogRecordProcessorBase.js:101-102`:
// `constructor(options) { this._exporter = options.exporter; ... }`.
// The 2-6 merge used positional args (caller passed `logExporter, sharedBatchConfig`
// positionally) which produced `_exporter = undefined` and silently dropped
// every buffered log via the SDK's internal try/catch. See review findings on
// commit 251f99d57.

const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { redactAttributes, redactLogRecordBody } = require('./tracing-pii');

class PIIRedactingLogRecordProcessor {
  constructor(options = {}) {
    // Forward the single options object to BatchLogRecordProcessor; it reads
    // `options.exporter` for the exporter + spreads the rest as config.
    this._delegate = new BatchLogRecordProcessor(options);
  }

  onEmit(logRecord, context) {
    try {
      // SECURITY: redact the body (free-form log message) BEFORE attribute
      // redaction. Without this, `logger.info('User ' + email + ' logged in')`
      // writes the email verbatim into VictoriaLogs. Per AD-4 / C-5: every
      // emitted record must pass through redactLogRecordBody.
      if (logRecord.body !== undefined && logRecord.body !== null) {
        logRecord.body = redactLogRecordBody(logRecord.body);
      }
      const attrs = logRecord.attributes;
      if (attrs) {
        const redacted = redactAttributes(attrs);
        for (const [key, value] of Object.entries(redacted)) {
          logRecord.setAttribute(key, value);
        }
      }
    } catch {
      // Redaction failure must not block log export
    }
    this._delegate.onEmit(logRecord, context);
  }

  shutdown() {
    return this._delegate.shutdown();
  }

  forceFlush() {
    return this._delegate.forceFlush();
  }
}

module.exports = { PIIRedactingLogRecordProcessor };
