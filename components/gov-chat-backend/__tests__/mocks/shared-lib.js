"use strict";

module.exports = {
  logger: {
    info: jest.fn(),
    error: jest.fn(),
    warn: jest.fn(),
    debug: jest.fn(),
  },
  dbService: { getConnection: jest.fn() },
  securityHeaders: (req, res, next) => next(),
  SecurityMiddleware: { applySecurityMiddleware: jest.fn() },
  reconfigureLogger: jest.fn(),
  triggerLogRollover: jest.fn(),
};
