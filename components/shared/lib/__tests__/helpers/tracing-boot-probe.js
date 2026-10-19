'use strict';

// Child-process boot probe for a Node.js component's `tracing.js`.
//
// WHY A SUBPROCESS: `tracing.js` no-ops on `NODE_ENV === 'test'`, which is what
// every Jest worker runs under — so no in-process test can ever reach the SDK
// branch where the propagator is installed. Booting the real branch needs a
// fresh node with `ENABLE_OBSERVABILITY=1` and `NODE_ENV` unset, and a
// subprocess is also the only safe way to do it inside a worker: `sdk.start()`
// registers `AsyncLocalStorageContextManager` and SIGTERM/SIGINT handlers as
// process globals, and `_registerShutdown` calls `process.exit(0)`.
//
// WHAT IT REPORTS: whether the module loads at all, and — the part a
// source-text assertion cannot reach — which headers the propagator the SDK
// actually installed emits for a context carrying `genie.query_id`. A
// trace-context-only propagator loads fine and silently drops `baggage`.
//
// Three things Jest normally provides are reproduced here, because plain node
// has none of them:
//
//   - the `./shared-lib/X` require alias, which exists only via Jest's
//     moduleNameMapper (the Docker COPY renames `shared/lib` -> `shared-lib`,
//     and Jest maps it back);
//   - `node_modules` resolution for `components/shared/lib`, which is not under
//     the component's `node_modules` — NODE_PATH covers it;
//   - the *component's own copy* of `@opentelemetry/api`. The global propagator
//     and context registries live in that module instance, so the probe
//     resolves `@opentelemetry/api` from the tracing file's directory rather
//     than from its own. Reading a different copy would always report the
//     unconfigured default and never see what the SDK installed.
//
// Stdout carries the SDK's own startup logging, so the result is emitted after
// a sentinel and the parent reads that line.

const Module = require('module');
const path = require('path');

const originalResolve = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (/shared-lib(\/|$)/.test(request)) {
    const sub = request.replace(/^(\.{1,2}\/)*shared-lib\/?/, '');
    return originalResolve.call(this, path.join(process.env.SHARED_LIB, sub), ...rest);
  }
  return originalResolve.call(this, request, ...rest);
};

const SENTINEL = '__TRACING_BOOT_RESULT__';

const TRACE_ID = '0123456789abcdef0123456789abcdef';
const SPAN_ID = '0123456789abcdef';

// The exporter must not be reached: no span is meant to leave this process, and
// a resolvable collector would only add latency to the boot we are timing.
process.env.OTEL_EXPORTER_OTLP_ENDPOINT = process.env.OTEL_EXPORTER_OTLP_ENDPOINT || 'http://127.0.0.1:1';

function emit(payload, exitCode) {
  // Exiting from the write callback: the SDK's exporters and the periodic
  // metric reader keep timers alive, so the child would otherwise hang until
  // Jest's own timeout kills it.
  process.stdout.write(`${SENTINEL}${JSON.stringify(payload)}\n`, () => {
    process.exit(exitCode);
  });
}

// `tracing.js` calls `sdk.start()` without awaiting it, so registration lands
// a tick later. Calling `start()` a second time is not the way to wait for it:
// the SDK is not memoized about it and rebinds the MetricReader ("MetricReader
// can not be bound to a MeterProvider again"). Poll instead.
async function waitForPropagator(propagation, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (propagation.fields().length === 0) {
    if (Date.now() > deadline) return [];
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  return propagation.fields();
}

async function main() {
  const result = {};
  try {
    const { sdk, getTracer } = require(process.env.TRACING_PATH);

    result.booted = true;
    result.sdkPresent = Boolean(sdk);
    // The live SDK branch, not the no-op stub: only the stub returns an object
    // whose spans have no `setAttribute`. `null` when the component does not
    // export a tracer at all — document-repository ships `{ sdk }` only.
    result.hasTracerExport = typeof getTracer === 'function';
    result.tracerIsLive = result.hasTracerExport
      ? typeof getTracer('genie.probe').startSpan('boot').setAttribute === 'function'
      : null;

    const api = require(
      require.resolve('@opentelemetry/api', {
        paths: [path.dirname(process.env.TRACING_PATH)]
      })
    );
    const { context, propagation, trace } = api;

    result.propagatorFields = (await waitForPropagator(propagation, 5000)).sort();

    const spanContext = trace.setSpanContext(context.active(), {
      traceId: TRACE_ID,
      spanId: SPAN_ID,
      traceFlags: 1
    });
    const withBaggage = propagation.setBaggage(
      spanContext,
      propagation.createBaggage({ 'genie.query_id': { value: 'q-probe' } })
    );

    const carrier = {};
    // Pass the setter explicitly: @opentelemetry/core v2 gives `inject` no
    // default, and CompositePropagator swallows the resulting TypeError as a
    // diagnostic warning — an empty carrier would then read as "no baggage"
    // rather than as the bug it is.
    propagation.inject(withBaggage, carrier, {
      set: (target, key, value) => {
        target[key] = value;
      }
    });

    result.carrierKeys = Object.keys(carrier).sort();
    result.baggage = carrier.baggage;

    emit(result, 0);
  } catch (err) {
    emit({ booted: false, error: String((err && err.message) || err) }, 1);
  }
}

main().catch((err) => emit({ booted: false, error: String((err && err.message) || err) }, 1));
