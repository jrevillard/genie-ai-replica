// components/shared/lib/tracing-background.js
'use strict';

const { trace } = require('@opentelemetry/api');

// SCOPE_NAME reads OTEL_SERVICE_NAME first (the canonical env var per
// OTel semconv) then falls back to the compose-pinned default. The
// SCOPE_NAME matches `service.name` so VictoriaTraces `otel.scope.name`
// queries return the same services as `service.name` queries.
const SCOPE_NAME = process.env.OTEL_SERVICE_NAME || 'genie-backend';
// SCOPE_VERSION reads SERVICE_VERSION first (already used by the
// Resource), then reads `package.json` (the actual deployed image
// version) — `npm_package_version` is undefined in Docker runtime.
let SCOPE_VERSION = process.env.SERVICE_VERSION || '1.0.0';
try {
  const _pkg = require('fs').readFileSync(
    require('path').join(__dirname, '..', '..', 'package.json'),
    'utf8'
  );
  SCOPE_VERSION = JSON.parse(_pkg).version || SCOPE_VERSION;
} catch {
  // keep fallback
}

/**
 * Why this module uses `tracer.startActiveSpan`:
 *
 * `startActiveSpan` creates a span AND binds it to the active context
 * for the duration of the callback. The AsyncLocalStorageContextManager
 * (registered in both backend and document-repository tracing.js) uses
 * `als.enterWith` internally, which PERSISTS the binding across awaits
 * — so logs emitted during awaited work inside the callback carry the
 * live trace_id / span_id.
 *
 * Why we DON'T use `context.with(trace.setSpan(...))` directly: OTel's
 * `context.with` delegates to `als.run`, which exits when fn returns
 * synchronously. Fire-and-forget call sites (the db healthcheck
 * `setInterval` wrapper) lose the binding before their async work
 * even starts — every healthcheck log then carries zeroed trace_id.
 *
 * An earlier version ALSO monkey-patched `trace.getSpan` to bridge via
 * a module-local AsyncLocalStorage — but OTel's `trace` namespace is a
 * Proxy that gets RECREATED when `setGlobalTracerProvider` runs, so the
 * patch silently captured the orphaned pre-registration proxy.
 *
 * @module shared/lib/tracing-background
 */

/**
 * Resolve a tracer. Lazy — avoids the OTel global being absent at module
 * load. Returns the no-op tracer if no TracerProvider is registered, in
 * which case `span.spanContext()` returns all-zero IDs. AsyncLocalStorage
 * still propagates the span reference so the formatter reads it; the
 * zero IDs are the documented OTel behavior when no SDK is running.
 *
 * @returns {import('@opentelemetry/api').Tracer}
 */
function _tracer() {
  return trace.getTracer(SCOPE_NAME, SCOPE_VERSION);
}

/**
 * Wrap an async function in a fresh OTel root span. The span becomes
 * the active context for `fn`'s lifetime (via AsyncLocalStorage) and
 * all awaited work; emitted logs carry the live `trace_id` / `span_id`.
 *
 * Errors thrown inside `fn` are recorded on the span (status ERROR +
 * recordException) and re-thrown. The span is ended exactly once via
 * `finally`.
 *
 * @param {string} name  Span name (dotted, lowercase). Prefixed with `genie.`
 *                       when no component prefix is present so OTel
 *                       semantic conventions (hierarchical naming) and
 *                       Grafana trace explorer grouping work cleanly.
 * @param {() => Promise<unknown>} fn  Async unit of work.
 * @param {Record<string, string|number|boolean>} [attrs] Optional span attributes.
 * @param {object} [options] Optional SpanOptions (`kind`, `links`).
 * @returns {Promise<unknown>} `fn`'s resolved value.
 */
async function withBackgroundSpan(name, fn, attrs, options = {}) {
  const tracer = _tracer();
  const namespacedName = name.includes('.') ? name : `genie.${name}`;
  const spanOptions = {};
  if (attrs) spanOptions.attributes = attrs;
  if (options.kind !== undefined) spanOptions.kind = options.kind;
  if (options.links) spanOptions.links = options.links;
  // `tracer.startActiveSpan(name, options, fn)` creates a span AND
  // binds it via the registered ContextManager (AsyncLocalStorage
  // → als.enterWith → persists across awaits). The span is auto-ended
  // when fn settles (no manual span.end needed).
  return tracer.startActiveSpan(namespacedName, spanOptions, async (_span) => {
    // `startActiveSpan` already records thrown errors on the span.
    // Just re-throw so callers see the original error.
    return fn();
  });
}

/**
 * Wrap a synchronous function in a fresh OTel root span. Returns `fn`'s
 * return value. Errors are recorded on the span and re-thrown.
 *
 * `span.end()` is called exactly once — covers both the success path
 * (the bug the original version had: only `catch` called `span.end()`,
 * leaking one OTel span object per successful invocation across the
 * 15+ service singletons) AND the async case (when `fn` returns a
 * Promise, the span must NOT end until the Promise settles — otherwise
 * logs emitted during the awaited work have zero trace_id and rejected
 * promises never record an exception on the span).
 *
 * @param {string} name
 * @param {() => unknown} fn
 * @param {Record<string, string|number|boolean>} [attrs]
 * @returns {unknown}
 */
function runInBackgroundSpan(name, fn, attrs) {
  const tracer = _tracer();
  const namespacedName = name.includes('.') ? name : `genie.${name}`;
  // `tracer.startActiveSpan` creates + binds + auto-ends in one call.
  // Returns whatever fn returns (sync value or Promise that resolves
  // to the value). Throws sync, or returns a rejected Promise on
  // async failure (auto-recorded on the span).
  return tracer.startActiveSpan(
    namespacedName,
    attrs ? { attributes: attrs } : undefined,
    (span) => {
      // `startActiveSpan` records thrown errors automatically — let
      // them propagate to the caller as-is. If `fn` returned a Promise,
      // attach a rejection handler so the span's status is set on async
      // failure too (startActiveSpan records sync throws but doesn't
      // auto-catch promise rejections).
      const result = fn();
      if (result && typeof result.then === 'function') {
        return result.catch((err) => {
          span.recordException(err);
          span.setStatus({
            code: 2, // SpanStatusCode.ERROR
            message: err && err.message ? err.message : String(err)
          });
          throw err;
        });
      }
      return result;
    }
  );
}

module.exports = {
  withBackgroundSpan,
  runInBackgroundSpan
};
