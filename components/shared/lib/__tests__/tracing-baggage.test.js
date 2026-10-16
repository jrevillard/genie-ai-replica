const { CompositePropagator, W3CBaggagePropagator, W3CTraceContextPropagator } = require('@opentelemetry/core');
const { context, defaultTextMapSetter, propagation } = require('@opentelemetry/api');

// DO NOT "simplify" the `defaultTextMapSetter` argument away from the inject
// calls below.
//
// In @opentelemetry/core v2, `inject(context, carrier, setter)` has NO default
// setter — only the global `propagation.inject` supplies one. And the failure is
// silent: CompositePropagator catches the resulting TypeError and emits a diag
// warning, so a missing setter leaves the carrier empty and the run reads as
// "no baggage was ever set" rather than as an error. Dropping the argument
// therefore produces a silently degraded trace with a green suite.
//
// Production is unaffected: the SDK installs this propagator as the global, and
// the instrumentation path goes through the global, which does default the
// setter. The explicit argument is only needed when calling the instance by hand,
// which is what this test does.

describe('query correlation propagator', () => {
  const baggage = require('../tracing-baggage');
  const spanAttrs = require('../span-attrs');

  // `withBaggage` relies on context propagation inside the callback. The SDK
  // registers AsyncLocalStorageContextManager at startup (tracing.js), but
  // NODE_ENV === 'test' short-circuits tracing.js, so without a context
  // manager `context.with` degrades to a plain call and `context.active()`
  // still returns the root context. Register it here to match production,
  // and unregister afterwards so the global does not leak to other suites
  // running in the same worker process.
  beforeAll(() => {
    const { AsyncLocalStorageContextManager } = require('@opentelemetry/context-async-hooks');
    context.setGlobalContextManager(new AsyncLocalStorageContextManager().enable());
  });

  afterAll(() => {
    context.disable();
  });

  test('QUERY_ID_KEY matches the Python vocabulary', () => {
    expect(spanAttrs.QUERY_ID_KEY).toBe('genie.query_id');
  });

  test('MAX_STRING_LEN matches the Python vocabulary', () => {
    expect(spanAttrs.MAX_STRING_LEN).toBe(96);
  });

  test('the propagator carries baggage, which trace-context alone would drop', () => {
    const traceOnly = new W3CTraceContextPropagator();
    const carrier = {};
    const ctx = propagation.setBaggage(
      context.active(),
      propagation.createBaggage({ 'genie.query_id': { value: 'abc' } })
    );
    traceOnly.inject(ctx, carrier, defaultTextMapSetter);
    expect(carrier.baggage).toBeUndefined();

    baggage.createGeniePropagator().inject(ctx, carrier, defaultTextMapSetter);
    expect(carrier.baggage).toBe('genie.query_id=abc');
  });

  test('the propagator still carries trace context', () => {
    const p = baggage.createGeniePropagator();
    expect(p).toBeInstanceOf(CompositePropagator);
    expect(p._propagators.length).toBe(2);
    expect(p._propagators[0]).toBeInstanceOf(W3CTraceContextPropagator);
    expect(p._propagators[1]).toBeInstanceOf(W3CBaggagePropagator);
  });

  test('withBaggage injects into an explicit carrier', () => {
    const carrier = {};
    baggage.withBaggage(spanAttrs.QUERY_ID_KEY, 'query-key-1', () =>
      baggage.createGeniePropagator().inject(context.active(), carrier, defaultTextMapSetter)
    );
    expect(carrier.baggage).toBe('genie.query_id=query-key-1');
  });

  test('withBaggage restores the previous context afterwards', () => {
    const before = context.active();
    baggage.withBaggage(spanAttrs.QUERY_ID_KEY, 'k', () => {});
    expect(context.active()).toBe(before);
  });

  test('withBaggage passes the callback return value through', () => {
    expect(baggage.withBaggage('k', 'v', () => 42)).toBe(42);
  });
});
