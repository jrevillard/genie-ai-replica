// tracing-pii-spans.js — PII redaction SpanProcessor for the OTel traces SDK.
// PARALLEL COPY of components/gov-chat-backend/tracing.js PIIRedactionProcessor
// (search for `class PIIRedactionProcessor` there).
//
// require() into gov-chat-backend is forbidden — this file must be kept in
// lockstep with the backend copy. Drift risk is the price of avoiding the
// cross-component require. When backend's PIIRedactionProcessor changes,
// mirror the diff here.
//
// Mirrors the composition pattern used by tracing-pii-logs.js (PII
// redaction for LogRecordProcessor): wrap an inner BatchSpanProcessor and
// redact attributes on onEnd before delegating. The Node side already
// recurses into string values via `redactAttributes` (see tracing-pii.js:15)
// so nested PII inside `body.user.email` / `request.headers.authorization` is
// caught — no extra fix needed here.

const { BatchSpanProcessor } = require('@opentelemetry/sdk-trace');
const { redactAttributes } = require('./tracing-pii');

class PIIRedactionSpanProcessor {
  constructor(exporter) {
    this._delegate = new BatchSpanProcessor(exporter);
    // Paths that should not generate traces (health checks, readiness probes).
    this._ignoredPaths = ['/health', '/ready', '/alive', '/favicon.ico'];
  }

  onStart(span, parentContext) {
    // Mirror backend's onStart approach: drop health-check paths and
    // redact PII while the span is still mutable. The OTel SDK marks
    // `span.attributes` read-only after `end()` is called, so any
    // redaction attempted in onEnd is silently dropped
    // (`Span.js:77-78`).
    const attrs = span.attributes || {};
    const target = attrs['http.target'] || attrs['http.route'] || '';
    if (target && this._ignoredPaths.some((p) => target.includes(p))) {
      // Mark the span as dropped — we can't actually delete a started
      // span, but we set a marker so onEnd short-circuits.
      span.setAttribute('genie.pii.dropped', true);
      return this._delegate.onStart(span, parentContext);
    }
    try {
      const redacted = redactAttributes(attrs);
      for (const [key, value] of Object.entries(redacted)) {
        // Only set the attribute if the value changed — avoids
        // triggering span updates when no PII was redacted.
        if (attrs[key] !== value) {
          span.setAttribute(key, value);
        }
      }
    } catch {
      // Redaction failure must not block span export
    }
    this._delegate.onStart(span, parentContext);
  }

  onEnd(span) {
    // Honor the drop flag set in onStart — health-check paths never
    // reach the exporter.
    if (span.attributes && span.attributes['genie.pii.dropped'] === true) {
      return;
    }
    this._delegate.onEnd(span);
  }

  async shutdown() {
    return this._delegate.shutdown();
  }

  async forceFlush() {
    return this._delegate.forceFlush();
  }
}

module.exports = { PIIRedactionSpanProcessor };
