'use strict';

// Re-export the real parsePositiveInt (pure function, no deps) so that
// the virtual-mock for `shared-lib/validation-utils` can share this file.
const { parsePositiveInt } = require('../../../shared/lib/validation-utils');
// Re-exported for real, not stubbed: the stream handler calls
// `tracingBaggage.withBaggage` around the chatqna request, and a stub would
// silently skip the baggage instead of failing.
const spanAttrs = require('../../../shared/lib/span-attrs');
const tracingBaggage = require('../../../shared/lib/tracing-baggage');

module.exports = {
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn()
  },
  dbService: { getConnection: jest.fn() },
  securityHeaders: (req, res, next) => next(),
  SecurityMiddleware: { applySecurityMiddleware: jest.fn() },
  reconfigureLogger: jest.fn(),
  parsePositiveInt,
  spanAttrs,
  tracingBaggage
};
