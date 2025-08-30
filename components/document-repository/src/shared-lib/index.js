// NOTE: this file is copied from shared/lib folder but with some changes
// - only logger and dbService are imported

// TODO: [NORMAL] Move local implementation to this shared-lib folder

// shared-lib/index.js
const loggerModule = require('./logger'); // Import the module object
// const securityHeaders = require('./security-headers');
// const SecurityMiddleware = require('./security-middleware');
const dbService = require('./db-connection-service');
// const rateLimiter = require('./rate-limiter');

module.exports = {
  logger: loggerModule.logger, // Export the Winston logger instance
  dbService
  // securityHeaders,
  // SecurityMiddleware,
  // rateLimiter
};
