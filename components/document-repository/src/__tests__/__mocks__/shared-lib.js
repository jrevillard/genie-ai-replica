// Global mock for shared-lib (only exists at Docker build time).
//
// jest.config.js maps EVERY `shared-lib(/.*)?` require to this one file, so the
// two things it must get right are:
//
//   1. The shape. `src/tracing.js` deep-imports and DESTRUCTURES —
//      `const { setScopeName, withBackgroundSpan } = require('../shared-lib/
//      tracing-background')`. Every key the module map swallows therefore has to
//      exist here at the TOP LEVEL, not nested under a namespace the caller
//      never looks in; otherwise it resolves to `undefined` and the caller
//      throws `undefined is not a function`.
//
//   2. The dependencies. These are deliberately jest.fn() stubs and NOT
//      re-exports of the real modules. The real `tracing-background.js` /
//      `tracing-baggage.js` require `@opentelemetry/api` and
//      `@opentelemetry/core`, which resolve out of `components/shared/lib/
//      node_modules` — a directory the `test:doc-repo` CI job never creates (it
//      runs only `npm ci` inside document-repository, unlike `test:backend`,
//      which installs shared/lib first). Re-exporting the real modules turned
//      every suite that loads this file into a MODULE_NOT_FOUND.
//
// Nothing is lost by stubbing: `src/tracing.js` returns a no-op stub whenever
// NODE_ENV === 'test', which Jest always sets, so the SDK object it configures
// never exists under test. Which propagator that file installs is asserted
// directly against its source in tracing-doc-repo-logs.test.js — a behavioural
// test is not possible here, and pretending otherwise is what would let the
// wiring regress.
module.exports = {
  logger: {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn()
  },
  dbService: {
    getConnection: jest.fn()
  },
  setScopeName: jest.fn(),
  // Each of these INVOKES its callback rather than returning undefined. A bare
  // `jest.fn()` turns a wrong assumption into a silent no-op: the shutdown
  // handler would appear to run and do nothing, and `textMapPropagator` would
  // hand the SDK `undefined` and fail deep inside it rather than at the mock
  // boundary. Returning a real value keeps the stub honest about the contract.
  withBackgroundSpan: jest.fn((_name, fn) => (typeof fn === 'function' ? fn() : undefined)),
  withBaggage: jest.fn((_key, _value, fn) => (typeof fn === 'function' ? fn() : undefined)),
  createGeniePropagator: jest.fn(() => ({}))
};
