// tracing-pii-logs.js — PII redaction LogRecordProcessor for the OTel logs SDK.
// Mirrors the composition pattern used by tracing.js (PIIRedactionProcessor for spans):
// wrap an inner BatchLogRecordProcessor and redact attributes before delegating.
//
// Per the sdk-logs 0.221.x constructor signature, BatchLogRecordProcessor takes
// (exporter, config) positionally — NOT a single options object.

const { BatchLogRecordProcessor } = require('@opentelemetry/sdk-logs');
const { redactAttributes } = require('./tracing-pii');

class PIIRedactingLogRecordProcessor {
  constructor(exporter, options = {}) {
    this._delegate = new BatchLogRecordProcessor(exporter, options);
  }

  onEmit(logRecord, context) {
    try {
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
