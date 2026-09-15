// Tests for components/shared/lib/tracing-background.js — helpers that wrap
// background emitters (db healthchecks, log rollovers, cache events,
// Worker thread callbacks) in fresh OTel root spans so emitted logs carry
// a real trace_id instead of being orphaned.
//
// Implementation note (see header in tracing-background.js): the helpers
// bind the span to BOTH the OTel context (via `context.with(trace.setSpan(...))`)
// and Node's AsyncLocalStorage. The OTel binding covers the production
// path (AsyncLocalStorageContextManager propagates via `context.active()`);
// the ALS binding is a fallback for the noop ContextManager (tests).
// The mock `context.with` below also stores the span in ALS so
// `trace.getSpan(context.active())` returns it.

// Node's AsyncLocalStorage powers the helper's context propagation fallback.
// The fakeTracer below simulates the SDK contract.
const fakeTracer = {
  spans: [],
  startSpan(name, opts) {
    const span = {
      name,
      attrs: opts,
      recordException: jest.fn(),
      setStatus: jest.fn(),
      end: jest.fn(),
      // Use real-looking IDs so the formatter-stamping assertion
      // below can verify the trace_id flows end-to-end.
      spanContext: () => ({
        traceId: 'a'.repeat(32),
        spanId: 'b'.repeat(16),
        traceFlags: 1
      })
    };
    this.spans.push(span);
    return span;
  },
  // `startActiveSpan(name, options, fn)` — OTel SDK signature.
  // (The helper also accepts `startActiveSpan(name, fn)` — no options.)
  // Mirrors the real AsyncLocalStorageContextManager semantics: bind
  // the span via ALS (persists across awaits), run fn, end the span
  // exactly once when fn settles.
  startActiveSpan(name, optsOrFn, maybeFn) {
    const opts = typeof optsOrFn === 'function' ? undefined : optsOrFn;
    const fn = typeof optsOrFn === 'function' ? optsOrFn : maybeFn;
    const span = this.startSpan(name, opts);
    // Bind via ALS so the span is visible to trace.getSpan across
    // awaits inside fn (the production ContextManager does the same).
    return mockAls.run({ span }, () => {
      try {
        const result = fn(span);
        if (result && typeof result.then === 'function') {
          return result.then(
            (v) => {
              span.end();
              return v;
            },
            (err) => {
              span.recordException(err);
              span.setStatus({ code: 2, message: err.message });
              span.end();
              throw err;
            }
          );
        }
        span.end();
        return result;
      } catch (err) {
        span.recordException(err);
        span.setStatus({ code: 2, message: err.message });
        span.end();
        throw err;
      }
    });
  }
};

const { AsyncLocalStorage } = require('async_hooks');
const mockAls = new AsyncLocalStorage();
jest.mock('@opentelemetry/api', () => {
  // The mock mirrors AsyncLocalStorageContextManager's contract:
  // - setSpan returns a new context with the span attached (doesn't persist)
  // - context.with runs fn() while the new context is active (ALS)
  // - trace.getSpan reads the span attached to the active context
  // - context.active returns the active context (the ALS store)
  return {
    trace: {
      getTracer: jest.fn(() => fakeTracer),
      getSpan: jest.fn(() => mockAls.getStore()?.span),
      setSpan: jest.fn((_ctx, span) => ({ span })),
      __mockTracer: fakeTracer
    },
    context: {
      active: jest.fn(() => mockAls.getStore() || {}),
      with: jest.fn((ctx, fn) => mockAls.run(ctx, fn))
    }
  };
});

const { trace } = require('@opentelemetry/api');
const { withBackgroundSpan, runInBackgroundSpan } = require('../../shared/lib/tracing-background');

describe('tracing-background helpers', () => {
  beforeEach(() => {
    fakeTracer.spans.length = 0;
    jest.clearAllMocks();
  });

  describe('withBackgroundSpan (async)', () => {
    it('returns the wrapped fn resolved value', async () => {
      const result = await withBackgroundSpan('db.healthcheck', async () => 42);
      expect(result).toBe(42);
    });

    it('creates a span with the given name', async () => {
      await withBackgroundSpan('cache.redis.connect', async () => null);
      expect(fakeTracer.spans).toHaveLength(1);
      expect(fakeTracer.spans[0].name).toBe('cache.redis.connect');
    });

    it('resolves tracer from scope "genie-backend"', async () => {
      await withBackgroundSpan('db.init', async () => null);
      expect(trace.getTracer).toHaveBeenCalledWith('genie-backend', expect.any(String));
    });

    it('passes attributes when provided', async () => {
      await withBackgroundSpan('crawl.poll', async () => null, { interval_ms: 5000, source: 'crawlWorker' });
      expect(fakeTracer.spans[0].attrs).toEqual({
        attributes: { interval_ms: 5000, source: 'crawlWorker' }
      });
    });

    it('passes no attributes when none provided', async () => {
      await withBackgroundSpan('db.cleanup_tick', async () => null);
      // The helper passes a SpanOptions object as the second arg to
      // `tracer.startSpan`. When no attrs are supplied, the object is
      // `{}` (no `.attributes` key) — verify neither has the key.
      expect(fakeTracer.spans[0].attrs).not.toHaveProperty('attributes');
    });

    it('records thrown errors on the span and re-throws', async () => {
      const boom = new Error('arangodb down');
      await expect(
        withBackgroundSpan('db.healthcheck', async () => {
          throw boom;
        })
      ).rejects.toBe(boom);
      const span = fakeTracer.spans[0];
      expect(span.recordException).toHaveBeenCalledWith(boom);
      expect(span.setStatus).toHaveBeenCalledWith({
        code: 2,
        message: 'arangodb down'
      });
      expect(span.end).toHaveBeenCalledTimes(1);
    });

    it('calls span.end() exactly once on success', async () => {
      await withBackgroundSpan('db.healthcheck', async () => 'ok');
      expect(fakeTracer.spans[0].end).toHaveBeenCalledTimes(1);
    });
  });

  describe('runInBackgroundSpan (sync)', () => {
    it('returns the wrapped fn value', () => {
      const out = runInBackgroundSpan('log.rollover', () => 'rolled');
      expect(out).toBe('rolled');
    });

    it('creates a span with the given name', () => {
      runInBackgroundSpan('app.shutdown', () => null);
      expect(fakeTracer.spans[0].name).toBe('app.shutdown');
    });

    it('records thrown errors and re-throws', () => {
      const boom = new Error('disk full');
      expect(() =>
        runInBackgroundSpan('log.rollover', () => {
          throw boom;
        })
      ).toThrow(boom);
      const span = fakeTracer.spans[0];
      expect(span.recordException).toHaveBeenCalledWith(boom);
      expect(span.end).toHaveBeenCalledTimes(1);
    });

    // Regression test for the original span-leak bug: the implementation
    // only called `span.end()` inside the catch block, so every
    // successful invocation leaked one OTel span object (15+ service
    // singletons + 4 SIGTERM handlers + db intervals in production).
    it('calls span.end() exactly once on the success path (no leak)', () => {
      runInBackgroundSpan('service.init.X', () => 'ok');
      expect(fakeTracer.spans[0].end).toHaveBeenCalledTimes(1);
    });

    it('end is called exactly once when fn throws (no double-end)', () => {
      try {
        runInBackgroundSpan('app.shutdown', () => {
          throw new Error('boom');
        });
      } catch {
        // expected
      }
      expect(fakeTracer.spans[0].end).toHaveBeenCalledTimes(1);
    });

    // Second regression — the original C1 fix called span.end() in
    // `finally` synchronously after `fn()` returned. If `fn` returned a
    // Promise (async), the span ended BEFORE the awaited work settled —
    // any log emitted during the promise had zero trace_id, and rejected
    // promises never recorded on the span. Fix: defer span.end() to the
    // promise settlement.
    it('does not end the span until a returned Promise resolves', async () => {
      let resolveLater;
      const slow = new Promise((resolve) => {
        resolveLater = resolve;
      });
      const returned = runInBackgroundSpan('db.healthcheck', () => slow);
      // Synchronously after return: span must NOT yet be ended.
      expect(fakeTracer.spans[0].end).not.toHaveBeenCalled();
      // Resolve the promise and await its handler.
      resolveLater('done');
      const result = await returned;
      expect(result).toBe('done');
      expect(fakeTracer.spans[0].end).toHaveBeenCalledTimes(1);
    });

    it('records rejection on the span when an async fn rejects', async () => {
      const boom = new Error('arangodb async failure');
      const returned = runInBackgroundSpan('db.healthcheck', () => Promise.reject(boom));
      // Re-throw must propagate to the caller (sync error contract).
      await expect(returned).rejects.toBe(boom);
      expect(fakeTracer.spans[0].recordException).toHaveBeenCalledWith(boom);
      expect(fakeTracer.spans[0].setStatus).toHaveBeenCalledWith({
        code: 2,
        message: 'arangodb async failure'
      });
      expect(fakeTracer.spans[0].end).toHaveBeenCalledTimes(1);
    });
  });

  describe('AsyncLocalStorage context propagation', () => {
    it('stores the span so a caller-installed getSpan wrapper can read it', () => {
      // Verify the module-level monkey-patch on trace.getSpan installed a
      // wrapper that consults the ALS first.
      runInBackgroundSpan('app.boot', () => {
        const span = trace.getSpan({});
        expect(span).not.toBeNull();
        expect(span.name).toBe('app.boot');
        expect(span.spanContext().traceId).toBe('a'.repeat(32));
      });
    });

    it('propagates the active span across awaits', async () => {
      let capturedInsideAwait = null;
      await withBackgroundSpan('db.healthcheck', async () => {
        capturedInsideAwait = trace.getSpan({});
        await new Promise((resolve) => setImmediate(resolve));
        // After the microtask boundary, the span should still be in ALS.
        const afterAwait = trace.getSpan({});
        expect(afterAwait).not.toBeNull();
        expect(afterAwait.name).toBe('db.healthcheck');
      });
      expect(capturedInsideAwait.name).toBe('db.healthcheck');
    });

    it('clears the span after the wrapper exits (no leak)', async () => {
      await withBackgroundSpan('db.healthcheck', async () => {
        expect(trace.getSpan({})).not.toBeNull();
      });
      // After the wrapper exits, ALS.getStore() returns undefined —
      // trace.getSpan (our patch) returns undefined, not null.
      expect(trace.getSpan({})).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------
  // End-to-end: a real Winston logger emitting inside the helper DOES
  // inherit the live span context. The traceFormat formatter reads
  // `trace.getSpan(context.active())` — our monkey-patch on `trace.getSpan`
  // returns the ALS-stored span, so the formatter stamps the
  // 32-hex-char trace_id on the log record.
  // ---------------------------------------------------------------------
  describe('integration with shared/lib/logger.js formatter', () => {
    it('stamps a real trace_id on logs emitted inside withBackgroundSpan', async () => {
      const { createLogger, format, transports: winstonTransports } = require('winston');

      const { traceFormat } = require('../../shared/lib/logger');
      const { PassThrough } = require('stream');

      const entries = [];
      const passThrough = new PassThrough();
      passThrough.on('data', (chunk) => entries.push(JSON.parse(chunk.toString().trim())));
      const testLogger = createLogger({
        level: 'debug',
        format: format.combine(format.timestamp(), traceFormat, format.json()),
        transports: [new winstonTransports.Stream({ stream: passThrough })],
        exitOnError: false
      });

      await withBackgroundSpan('db.healthcheck', async () => {
        testLogger.info('connection healthy');
      });

      expect(entries).toHaveLength(1);
      // trace_id stamped from the ALS-stored span's spanContext().
      expect(entries[0].trace_id).toBe('a'.repeat(32));
      expect(entries[0].span_id).toBe('b'.repeat(16));
      expect(entries[0].message).toBe('connection healthy');
    });
  });
});
