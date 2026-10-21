// PII-redacting SpanProcessor shared by every Node.js component that exports
// OTLP spans (gov-chat-backend, document-repository).
//
// The delegate is INJECTED rather than built here. Constructing
// `BatchSpanProcessor` would mean requiring `@opentelemetry/sdk-trace-base`,
// which is not a dependency of this package — it would arrive only as a
// transitive of `@opentelemetry/sdk-node`, in whichever component happens to
// have that installed. The caller owns the exporter, so the caller builds the
// processor it wraps:
//   new PIIRedactionProcessor(new BatchSpanProcessor(exporter))

const { redactAttributes } = require('./tracing-pii');

// Paths that should not generate traces (health checks, readiness probes)
const IGNORED_PATHS = ['/health', '/ready', '/alive', '/favicon.ico'];

class PIIRedactionProcessor {
  constructor(delegate) {
    this._delegate = delegate;
    this._ignoredPaths = IGNORED_PATHS;
    // Tracks spans dropped in onStart so onEnd can skip the delegate.
    // The OTel SDK calls onEnd on every registered SpanProcessor when
    // a span ends — regardless of whether onStart returned early — so
    // forwarding unconditionally to BatchSpanProcessor would queue
    // dropped spans for export (BatchSpanProcessor.onEnd checks the
    // sampled flag, not whether onStart was called). WeakSet so
    // dropped spans are GC'd along with their parent object.
    this._droppedSpans = new WeakSet();
  }

  onStart(span, parentContext) {
    // Drop health-check spans BEFORE the span is recorded — once a
    // span ends, the OTel SDK marks attributes read-only and
    // `span.setAttribute()` becomes a no-op (`Span.js:77-78`). We must
    // mutate attributes (PII redaction) and decide to drop at
    // onStart while the span is still mutable.
    const attrs = span.attributes || {};
    const target = attrs['http.target'] || attrs['http.route'] || '';
    if (target && this._ignoredPaths.some((p) => target.includes(p))) {
      // Drop fully: do NOT register with the delegate's BatchSpanProcessor.
      // If we called onStart on the delegate, OTel would track the span
      // in its active set and rely on a matching onEnd to release it —
      // but we want to skip export entirely. Mark the span in
      // _droppedSpans so onEnd can skip the delegate too (the SDK
      // calls onEnd on every processor regardless of onStart return).
      span.setAttribute('genie.pii.dropped', true);
      this._droppedSpans.add(span);
      return;
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
    // Skip delegate.onEnd for spans we dropped in onStart — otherwise
    // the OTel SDK's unconditional onEnd dispatch would queue them on
    // the BatchSpanProcessor export queue despite never having been
    // registered with its active set. K8s probes hit /health every 5s,
    // so without this guard the SDK's internal maps grow unbounded.
    if (this._droppedSpans.has(span)) {
      this._droppedSpans.delete(span);
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

module.exports = { PIIRedactionProcessor, IGNORED_PATHS };
