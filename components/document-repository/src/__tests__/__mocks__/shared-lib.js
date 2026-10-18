// Global mock for shared-lib (only exists at Docker build time).
//
// jest.config.js maps EVERY `shared-lib(/...)?` require to this one file, so it
// has to cover every helper `src/` deep-imports — not just the barrel's
// `logger` / `dbService`. A helper missing here fails as `undefined is not a
// function`, which reads like a bug in the caller rather than an incomplete
// mock.
const tracingBackground = require('../../../../shared/lib/tracing-background');
const tracingBaggage = require('../../../../shared/lib/tracing-baggage');

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
  // Re-exported for real, not stubbed, for the same reason the backend mock
  // does it: `createGeniePropagator` decides whether an inbound `genie.query_id`
  // survives this hop, and a stub returning undefined would make the SDK fall
  // back to trace-context-only — silently reproducing the exact bug the real
  // factory exists to prevent.
  tracingBackground,
  tracingBaggage
};
