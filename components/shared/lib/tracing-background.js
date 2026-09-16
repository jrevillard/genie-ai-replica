// components/shared/lib/tracing-background.js
'use strict';

const { trace } = require('@opentelemetry/api');

// SCOPE_NAME default is `'backend'` — matches the OTel SDK Resource
// `service.name` (set by tracing.js) and the Compose block name in
// docker-compose.yaml, so VictoriaTraces `otel.scope.name` queries
// return the same services as `service.name` queries. Single source of
// truth — operators override at the Compose layer (block name + env
// forwarding), not via an env chain that has to be kept in sync across
// tracing.js + tracing-background.js + docker-compose.
//
// Parameterizable via setScopeName() so document-repository (which
// reuses this module via '../shared-lib/tracing-background') can stamp
// `otel.scope.name=document-repository` instead of being misattributed
// to `backend`. Set in each component's tracing.js right after SDK init.
let scopeName = 'backend';
function setScopeName(n) {
  scopeName = n;
}
function getScopeName() {
  return scopeName;
}
// SCOPE_VERSION reads SERVICE_VERSION first (already used by the
// Resource), then reads `package.json` (the actual deployed image
// version) — `npm_package_version` is undefined in Docker runtime.
let SCOPE_VERSION = process.env.SERVICE_VERSION || '1.0.0';
try {
  const _pkg = require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'package.json'), 'utf8');
  SCOPE_VERSION = JSON.parse(_pkg).version || SCOPE_VERSION;
} catch {
  // keep fallback
}

/**
 * Uses OTel `tracer.startActiveSpan` + AsyncLocalStorageContextManager
 * for background propagation. `startActiveSpan` creates a span AND
 * binds it to the active context for the duration of the callback.
 * The AsyncLocalStorageContextManager (registered in both backend and
 * document-repository tracing.js) uses `als.enterWith` internally,
 * which PERSISTS the binding across awaits — so logs emitted during
 * awaited work inside the callback carry the live trace_id / span_id.
 *
 * Why we DON'T use `context.with(trace.setSpan(...))` directly: OTel's
 * `context.with` delegates to `als.run`, which exits when fn returns
 * synchronously. Fire-and-forget call sites (the db healthcheck
 * `setInterval` wrapper) lose the binding before their async work
 * even starts — every healthcheck log then carries zeroed trace_id.
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
 * Scope name is read from `getScopeName()` so the calling component
 * (backend vs document-repository) determines `otel.scope.name` rather
 * than the shared helper hardcoding `'backend'` for everyone.
 *
 * @returns {import('@opentelemetry/api').Tracer}
 */
function _tracer() {
  return trace.getTracer(getScopeName(), SCOPE_VERSION);
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
  // We rely on `startActiveSpan`'s callback wrapper for the ALS
  // binding, then re-implement error/lifecycle handling inside the
  // callback so span.end() runs EXACTLY ONCE in `finally` (the
  // callback-wrapper alone can leak on sync-throw edge cases and
  // makes async rejection handling order-dependent).
  return tracer.startActiveSpan(namespacedName, spanOptions, async (span) => {
    try {
      return await fn();
    } catch (err) {
      span.recordException(err);
      span.setStatus({
        code: 2, // SpanStatusCode.ERROR
        message: err && err.message ? err.message : String(err)
      });
      throw err;
    } finally {
      span.end();
    }
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
  // `tracer.startActiveSpan` creates + binds the span via the
  // registered ContextManager (AsyncLocalStorage → als.enterWith →
  // persists across awaits). We override the callback wrapper's
  // auto-end behavior with explicit try/catch/finally so span.end()
  // runs exactly once (the original implementation only called
  // span.end() in `.catch`, leaking one OTel span object per
  // successful invocation across the 15+ service singletons + 4
  // SIGTERM handlers + db intervals in production).
  return tracer.startActiveSpan(namespacedName, attrs ? { attributes: attrs } : undefined, (span) => {
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        // Defer span.end() to the promise's settlement — ending
        // synchronously would terminate the span before awaited
        // work runs, orphaning every log emitted during it (zero
        // trace_id) and dropping rejected promises without a
        // recorded exception.
        return result
          .catch((err) => {
            span.recordException(err);
            span.setStatus({
              code: 2, // SpanStatusCode.ERROR
              message: err && err.message ? err.message : String(err)
            });
            throw err;
          })
          .finally(() => span.end());
      }
      span.end();
      return result;
    } catch (err) {
      span.recordException(err);
      span.setStatus({
        code: 2, // SpanStatusCode.ERROR
        message: err && err.message ? err.message : String(err)
      });
      span.end();
      throw err;
    }
  });
}

module.exports = {
  withBackgroundSpan,
  runInBackgroundSpan,
  // Scope-name setter/getter — callers (each component's tracing.js)
  // invoke setScopeName('<component>') once during startup so the
  // shared tracer stamps `otel.scope.name=<component>` instead of
  // defaulting to `'backend'`. getScopeName is exported for test
  // assertions and downstream consumers that need to read it back.
  setScopeName,
  getScopeName
};
