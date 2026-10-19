const http = require('http');
const axios = require('axios');
const { trace, propagation, ROOT_CONTEXT, TraceFlags } = require('@opentelemetry/api');
const { W3CTraceContextPropagator } = require('@opentelemetry/core');

describe('traceparent propagation on outbound HTTP calls', () => {
  let server;
  let capturedHeaders;

  beforeAll((done) => {
    // A trace-context-only propagator, so these tests stay focused on the
    // header FORMAT. What production installs is covered separately below, by
    // a boot probe that reads it off the running SDK.
    propagation.setGlobalPropagator(new W3CTraceContextPropagator());

    server = http.createServer((req, res) => {
      capturedHeaders = req.headers;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ ok: true }));
    });
    server.listen(0, () => done());
  });

  afterAll((done) => {
    server.close(() => done());
  });

  beforeEach(() => {
    capturedHeaders = null;
  });

  function createContextWithSpan(traceId, spanId) {
    const spanContext = {
      traceId,
      spanId,
      traceFlags: TraceFlags.SAMPLED,
      isRemote: false
    };
    const span = trace.wrapSpanContext(spanContext);
    return trace.setSpan(ROOT_CONTEXT, span);
  }

  it('axios requests include traceparent when OTel context is active', async () => {
    const port = server.address().port;
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const spanId = '00f067aa0ba902b7';

    const ctx = createContextWithSpan(traceId, spanId);

    const headers = {};
    propagation.inject(ctx, headers);

    expect(headers.traceparent).toBeDefined();
    expect(headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);

    // Make an actual axios request with the injected headers
    await axios.get(`http://127.0.0.1:${port}/test`, { headers });

    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders.traceparent).toBeDefined();
    expect(capturedHeaders.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/);
  });

  it('propagation.inject produces W3C traceparent format', () => {
    const traceId = 'abcdef1234567890abcdef1234567890';
    const spanId = '1234567890abcdef';
    const ctx = createContextWithSpan(traceId, spanId);

    const headers = {};
    propagation.inject(ctx, headers);

    const parts = headers.traceparent.split('-');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('00'); // version
    expect(parts[1]).toMatch(/^[0-9a-f]{32}$/); // trace-id
    expect(parts[2]).toMatch(/^[0-9a-f]{16}$/); // span-id
    expect(parts[3]).toMatch(/^[0-9a-f]{2}$/); // flags
    expect(parts[1]).toBe(traceId);
    expect(parts[2]).toBe(spanId);
  });

  it('propagation works without active span (no traceparent injected)', () => {
    const headers = {};
    propagation.inject(ROOT_CONTEXT, headers);

    expect(headers.traceparent).toBeUndefined();
  });

  it('trace-id is consistent across header injection calls', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const spanId = '00f067aa0ba902b7';
    const ctx = createContextWithSpan(traceId, spanId);

    const headers1 = {};
    const headers2 = {};
    propagation.inject(ctx, headers1);
    propagation.inject(ctx, headers2);

    // Same context → same traceparent
    expect(headers1.traceparent).toBe(headers2.traceparent);
    expect(headers1.traceparent).toContain(traceId);
  });

  it('traceparent format enables Grafana to correlate traces to logs', () => {
    const traceId = '4bf92f3577b34da6a3ce929d0e0e4736';
    const spanId = '00f067aa0ba902b7';
    const ctx = createContextWithSpan(traceId, spanId);

    const headers = {};
    propagation.inject(ctx, headers);

    // Extract trace-id from traceparent header (second segment)
    const traceIdFromHeader = headers.traceparent.split('-')[1];

    // This same trace ID appears in log entries via the winston traceFormat
    expect(traceIdFromHeader).toBe(traceId);
    expect(traceIdFromHeader).toMatch(/^[0-9a-f]{32}$/);
  });
});

// The tests above fix the header FORMAT. This one fixes the WIRING: whether the
// propagator the backend actually installs carries `baggage` to chatqna.
//
// It has to run out-of-process. `tracing.js` no-ops on `NODE_ENV === 'test'`,
// which is what a Jest worker runs under, so no assertion made inside this
// process can reach the branch that crashed — a source-text grep reached only
// the call site, never the value that reached it.
describe('tracing.js boots and installs a baggage-carrying propagator', () => {
  const path = require('path');
  const { runTracingBootProbe } = require('../../shared/lib/__tests__/helpers/run-tracing-boot-probe');

  it('loads with observability enabled and sends genie.query_id as baggage', () => {
    const result = runTracingBootProbe({
      componentDir: path.join(__dirname, '..'),
      tracingFile: 'tracing.js'
    });

    expect(result.error).toBeUndefined();
    expect(result.booted).toBe(true);
    expect(result.sdkPresent).toBe(true);
    // The live SDK branch: the no-op stub's spans have no `setAttribute`.
    // Names what the SDK actually registered. Without this the only symptom of
    // a start() that never registered anything would be an empty carrier after
    // the probe's 5 s wait, which reads as a propagation failure rather than
    // as the SDK not coming up.
    expect(result.propagatorFields).toEqual(expect.arrayContaining(['traceparent', 'baggage']));
    expect(result.tracerIsLive).toBe(true);

    // A trace-context-only propagator loads fine and drops `baggage` in
    // silence — chatqna then has nothing to correlate on. `carrierKeys` is
    // what the installed propagator emitted, not what the source said it would.
    expect(result.carrierKeys).toEqual(expect.arrayContaining(['traceparent', 'baggage']));
    expect(result.baggage).toBe('genie.query_id=q-probe');
  });
});
