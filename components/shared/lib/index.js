// shared-lib/index.js
const loggerModule = require('./logger'); // Import the module object
const securityHeaders = require('./security-headers');
const SecurityMiddleware = require('./security-middleware');
const dbService = require('./db-connection-service');
const validationUtils = require('./validation-utils'); // parsePositiveInt helper

module.exports = {
  logger: loggerModule.logger, // Export the Winston logger instance
  reconfigureLogger: loggerModule.reconfigureLogger,
  triggerLogRollover: loggerModule.triggerLogRollover,
  cleanupCombinedLog: loggerModule.cleanupCombinedLog,
  parsePositiveInt: validationUtils.parsePositiveInt,
  dbService,
  securityHeaders,
  SecurityMiddleware
};
