'use strict';
const fs = require('fs');
const path = require('path');

const TRACING_SOURCE = fs.readFileSync(path.resolve(__dirname, '../tracing.js'), 'utf8');

test('document-repository tracing does not push OTLP /v1/logs (LoggerProvider gone)', () => {
  expect(TRACING_SOURCE).not.toMatch(/OTLPLogExporter/);
  expect(TRACING_SOURCE).not.toMatch(/new LoggerProvider\(/);
  expect(TRACING_SOURCE).not.toMatch(/logs\.setGlobalLoggerProvider/);
  expect(TRACING_SOURCE).not.toMatch(/PIIRedactingLogRecordProcessor/);
});

// The propagator is asserted by reading the source rather than by importing the
// SDK: src/tracing.js returns a no-op stub whenever NODE_ENV === 'test', which
// Jest sets — so the NodeSDK object it configures never exists to inspect here.
// What this test owns is the WIRING (this service installs the shared factory),
// and that the factory itself carries baggage is proven in
// components/shared/lib/__tests__/tracing-baggage.test.js. Both halves are
// needed: a green factory test says nothing about which propagator this file
// installs, and this test says nothing about what the factory does.
describe('trace context propagation', () => {
  test('installs the shared composite propagator, not trace-context alone', () => {
    expect(TRACING_SOURCE).toContain('createGeniePropagator()');
    // A bare W3CTraceContextPropagator drops the `baggage` header, so an
    // inbound genie.query_id would not survive the hop through this service
    // and its spans would be orphaned from the caller's trace.
    expect(TRACING_SOURCE).not.toMatch(/new W3CTraceContextPropagator\(\)/);
  });

  test('takes the factory from shared-lib, not a local copy', () => {
    // A local re-implementation would drift from the backend's without any
    // failing test — the two would each keep passing their own assertion.
    expect(TRACING_SOURCE).toMatch(/require\('\.\.\/shared-lib\/tracing-baggage'\)/);
  });

  test('the propagator is actually handed to the SDK', () => {
    expect(TRACING_SOURCE).toMatch(/textMapPropagator:\s*createGeniePropagator\(\)/);
  });
});
