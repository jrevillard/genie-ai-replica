'use strict';

// document-repository installs the same composite propagator as the backend, so
// `baggage` survives on its outbound calls too (dataprep ingest, crawler
// fetches). A trace-context-only propagator loads without complaint and drops
// the header in silence, so the only way to know which one is installed is to
// boot the real file and read what it emits.
//
// Out-of-process because `src/tracing.js` no-ops on `NODE_ENV === 'test'`,
// which is what a Jest worker runs under.

const path = require('path');
const { runTracingBootProbe } = require('../../../shared/lib/__tests__/helpers/run-tracing-boot-probe');

describe('document-repository tracing.js', () => {
  it('boots with observability enabled and sends genie.query_id as baggage', () => {
    const result = runTracingBootProbe({
      componentDir: path.join(__dirname, '..', '..'),
      tracingFile: 'src/tracing.js'
    });

    expect(result.error).toBeUndefined();
    expect(result.booted).toBe(true);
    expect(result.sdkPresent).toBe(true);
    // Names what the SDK actually registered. Without this the only symptom of
    // a start() that never registered anything would be an empty carrier after
    // the probe's 5 s wait, which reads as a propagation failure rather than
    // as the SDK not coming up.
    expect(result.propagatorFields).toEqual(expect.arrayContaining(['traceparent', 'baggage']));
    expect(result.carrierKeys).toEqual(expect.arrayContaining(['traceparent', 'baggage']));
    expect(result.baggage).toBe('genie.query_id=q-probe');
  });
});
