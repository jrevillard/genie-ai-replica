'use strict';

// Re-export the real parsePositiveInt (pure function, no deps) so that
// the virtual-mock for `shared-lib/validation-utils` can share this file.
const { parsePositiveInt } = require('../../../shared/lib/validation-utils');

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
  triggerLogRollover: jest.fn(),
  parsePositiveInt
};
