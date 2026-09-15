// components/shared/lib/tracing-background.js
'use strict';

const { AsyncLocalStorage } = require('async_hooks');
const { trace } = require('@opentelemetry/api');

const SCOPE_NAME = 'genie-backend';
const SCOPE_VERSION = process.env.npm_package_version || '1.0.0';

/**
 * Why this module uses `AsyncLocalStorage` instead of `context.with`:
 *
 * The OTel JS Context API (`@opentelemetry/api`) propagates context via a
 * registered ContextManager. When no SDK TracerProvider is initialized
 * (the document-repository case — its tracing.js is logs-only, no span
 * exporter), the global ContextManager is the `NoopContextManager` which
 * silently drops every `context.with(ctx, fn)` call — `context.active()`
 * inside `fn` still returns the original context. End result: no span is
 * visible to the Winston `traceFormat` formatter, every background log
 * is emitted without a trace_id.
 *
 * Bypassing the OTel ContextManager with Node's built-in AsyncLocalStorage
 * is the standard escape hatch documented in the OTel JS contrib repo.
 * It works regardless of whether a full SDK TracerProvider is registered
 * (the backend has one, doc-repo does not — both paths now work).
 *
 * @module shared/lib/tracing-background
 */

const _als = new AsyncLocalStorage();

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
 * Run `fn` inside an AsyncLocalStorage scope where `context.active()`
 * (when read via our `_getActiveSpan()`) returns the supplied span.
 * Bypasses the OTel ContextManager so it works regardless of SDK init.
 *
 * @template T
 * @param {import('@opentelemetry/api').Span} span
 * @param {() => T} fn
 * @returns {T}
 */
function _runWithSpan(span, fn) {
  return _als.run(span, fn);
}

/**
 * Read the currently-active span from our AsyncLocalStorage. The
 * `logger.js` `traceFormat` formatter reads `trace.getSpan(context.active())`
 * — that path STILL uses the OTel ContextManager (which is noop in
 * doc-repo). To make the formatter see the wrapped span, we monkey-patch
 * `trace.getSpan` at module load: install a wrapper that checks our
 * AsyncLocalStorage first, falls back to the original OTel behavior.
 *
 * (This monkey-patch is per-process, not global across requires, because
 * OTel's `trace.getSpan` is a getter on a frozen object — we replace the
 * whole `trace` getter to a Proxy. See `_installGetSpanPatch()`.)
 */
let _installedPatch = false;
let _patchAttempts = 0;
function _installGetSpanPatch() {
  if (_installedPatch) return;
  // Mark the install as "attempted" so we don't re-enter on every
  // require() — but reset on failure so a later call can retry (e.g.
  // after the OTel API namespace is unfrozen by hot-reload).
  _patchAttempts += 1;
  const attemptId = _patchAttempts;

  const otelTrace = require('@opentelemetry/api').trace;
  const originalGetSpan = otelTrace.getSpan;
  // Replace the property with a function that consults our ALS first.
  try {
    Object.defineProperty(otelTrace, 'getSpan', {
      configurable: true,
      enumerable: true,
      get() {
        return (ctx) => {
          const als = _als.getStore();
          if (als) return als;
          return originalGetSpan(ctx);
        };
      }
    });
    // Patch succeeded — mark as installed so subsequent require()s are
    // a no-op. The patch is idempotent (subsequent calls find
    // `_installedPatch === true` and short-circuit).
    _installedPatch = true;
  } catch (err) {
    // If the property is non-configurable (some bundlers freeze the OTel
    // API namespace), the patch silently no-ops and trace_id stamping
    // regresses to zeros. Fail LOUD — log a warning to stderr so the
    // next `docker logs` surfaces it. The patch is NOT marked installed
    // so a later `_installGetSpanPatch()` call (e.g. if the namespace is
    // ever unfrozen by hot-reload) can retry. The retry contract
    // documented in the docstring above IS honoured: we only mark
    // `_installedPatch = true` on success.
    // eslint-disable-next-line no-console
    console.warn(
      `[tracing-background] attempt #${attemptId} failed to patch ` +
      'trace.getSpan — trace_id stamping will fall back to whatever ' +
      'the OTel API returns (likely zeros):',
      err && err.message ? err.message : err
    );
  }
}
_installGetSpanPatch();

/**
 * Wrap an async function in a fresh OTel root span. The span becomes
 * the active context for `fn`'s lifetime (via AsyncLocalStorage) and
 * all awaited work; emitted logs carry the live `trace_id` / `span_id`.
 *
 * Errors thrown inside `fn` are recorded on the span (status ERROR +
 * recordException) and re-thrown. The span is ended exactly once via
 * `finally`.
 *
 * @param {string} name  Span name (dotted, lowercase).
 * @param {() => Promise<unknown>} fn  Async unit of work.
 * @param {Record<string, string|number|boolean>} [attrs] Optional span attributes.
 * @returns {Promise<unknown>} `fn`'s resolved value.
 */
async function withBackgroundSpan(name, fn, attrs) {
  const tracer = _tracer();
  const span = tracer.startSpan(name, attrs ? { attributes: attrs } : undefined);
  return _runWithSpan(span, async () => {
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
  const span = tracer.startSpan(name, attrs ? { attributes: attrs } : undefined);
  let result;
  try {
    result = _runWithSpan(span, () => fn());
  } catch (err) {
    span.recordException(err);
    span.setStatus({
      code: 2, // SpanStatusCode.ERROR
      message: err && err.message ? err.message : String(err)
    });
    span.end();
    throw err;
  }
  // If `fn` returned a Promise (async), defer `span.end()` until the
  // Promise settles — otherwise the span ends immediately, the active
  // ALS store clears, and any log emitted during the awaited work has
  // zero trace_id. Re-throw rejections so callers see the error (same
  // contract as the sync path's `throw err`).
  if (result && typeof result.then === 'function') {
    return result.then(
      (value) => {
        span.end();
        return value;
      },
      (err) => {
        span.recordException(err);
        span.setStatus({
          code: 2, // SpanStatusCode.ERROR
          message: err && err.message ? err.message : String(err)
        });
        span.end();
        throw err;
      }
    );
  }
  // Synchronous return — end now.
  span.end();
  return result;
}

module.exports = {
  withBackgroundSpan,
  runInBackgroundSpan
};
