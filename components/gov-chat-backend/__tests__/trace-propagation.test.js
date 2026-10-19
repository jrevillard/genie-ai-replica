const http = require('http');
const axios = require('axios');
const { trace, propagation, ROOT_CONTEXT, TraceFlags } = require('@opentelemetry/api');
const { W3CTraceContextPropagator } = require('@opentelemetry/core');

describe('traceparent propagation on outbound HTTP calls', () => {
  let server;
  let capturedHeaders;

  beforeAll((done) => {
    // Set up W3C propagator globally (same as production tracing.js)
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

  it('the composite propagator is configured in tracing.js', () => {
    const fs = require('fs');
    const path = require('path');
    const tracingPath = path.join(__dirname, '..', 'tracing.js');
    const tracingSource = fs.readFileSync(tracingPath, 'utf8');

    // The shared factory builds trace-context + baggage. A bare
    // W3CTraceContextPropagator here would drop the `baggage` header and
    // `genie.query_id` would never reach chatqna.
    expect(tracingSource).toContain('createGeniePropagator()');
    expect(tracingSource).not.toContain('new W3CTraceContextPropagator()');
    expect(tracingSource).toContain('textMapPropagator');
    expect(tracingSource).toContain('getNodeAutoInstrumentations');
  });

  // The assertion above used to read
  //   expect(tracingSource).toContain('tracingBaggage.createGeniePropagator()')
  // which is the exact spelling that crashed at boot: tracing.js destructured
  // `{ tracingBaggage }` from a module exporting `{ createGeniePropagator,
  // withBaggage }`, so the name was undefined and the call threw. It passed on
  // a broken image because it only read text. A name has to be checked against
  // what the module actually exports.
  describe('the shared-lib import resolves to real exports', () => {
    const fs = require('fs');
    const path = require('path');

    const tracingSource = fs.readFileSync(path.join(__dirname, '..', 'tracing.js'), 'utf8');

    it('every destructured name exists on the module it is destructured from', () => {
      // `const { a, b } = require('../shared-lib/<name>')`
      const pattern = /const\s*\{([^}]*)\}\s*=\s*require\((['"])[^'"]*shared-lib\/([\w-]+)\2\)/g;
      const realExports = {
        'tracing-baggage': require('../../shared/lib/tracing-baggage'),
        'tracing-background': require('../../shared/lib/tracing-background')
      };
      const checked = [];
      for (const match of tracingSource.matchAll(pattern)) {
        const moduleName = match[3];
        const names = match[1]
          .split(',')
          .map((n) => n.trim().split(':')[0].trim())
          .filter(Boolean);
        expect(names.length).toBeGreaterThan(0);
        for (const name of names) {
          expect({ module: moduleName, name, exported: name in realExports[moduleName] }).toEqual({
            module: moduleName,
            name,
            exported: true
          });
        }
        checked.push(moduleName);
      }
      // No assertion that a particular module is destructured: the correct
      // import for tracing-baggage is the WHOLE module, and demanding a
      // destructure here would re-encode the very shape that crashed.
      expect(checked.length).toBeGreaterThan(0);
    });

    it('the propagator factory is callable, as tracing.js calls it at module load', () => {
      // The failure this whole file exists for: `undefined.createX()` while
      // NodeSDK is being configured. Reproduce the exact lookup tracing.js does.
      const factory = require('../../shared/lib/tracing-baggage').createGeniePropagator;
      expect(typeof factory).toBe('function');
      expect(factory()).toBeDefined();
    });

    it('the barrel and the deep path expose different shapes', () => {
      // Why a name alone does not prove an import is right: the barrel exports
      // `tracingBaggage` (the module object), the deep path exports its
      // functions. Reading one while writing the other IS the defect this MR
      // fixes, so both shapes are pinned — changing one to "fix" the other
      // would otherwise look correct.
      //
      // The barrel is read as source, not required: requiring it from here
      // pulls its own dependencies (express-rate-limit via security-middleware,
      // arangojs via db-connection-service), which resolve inside the backend
      // image and not from the shared/lib directory in the source tree.
      const barrelSource = fs.readFileSync(path.join(__dirname, '../../shared/lib/index.js'), 'utf8');
      expect(barrelSource).toMatch(/^\s*tracingBaggage\s*,?\s*$/m);

      const deep = require('../../shared/lib/tracing-baggage');
      expect(typeof deep.createGeniePropagator).toBe('function');
      expect(deep).not.toHaveProperty('tracingBaggage');
    });
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
