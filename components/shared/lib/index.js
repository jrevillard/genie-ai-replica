// shared-lib/index.js
const loggerModule = require('./logger'); // Import the module object
const securityHeaders = require('./security-headers');
const SecurityMiddleware = require('./security-middleware');
const dbService = require('./db-connection-service');
const validationUtils = require('./validation-utils'); // parsePositiveInt helper
const meltModule = require('./melt'); // MELT hexagonal seam (port + adapters + client); unconditional so a missing submodule fails loudly with MODULE_NOT_FOUND
// Background-task tracing helpers — wrap fire-and-forget emitters (db
// healthchecks, log rollovers, cache events, Worker thread callbacks) in a
// fresh OTel root span so emitted logs inherit a real trace_id. See
// shared/lib/tracing-background.js for the API contract.
const tracingBackground = require('./tracing-background');

module.exports = {
  logger: loggerModule.logger, // Export the Winston logger instance
  reconfigureLogger: loggerModule.reconfigureLogger,
  cleanupCombinedLog: loggerModule.cleanupCombinedLog,
  parsePositiveInt: validationUtils.parsePositiveInt,
  dbService,
  securityHeaders,
  SecurityMiddleware,
  melt: meltModule,
  // Re-export the helpers individually so consumers can destructure them
  // directly from the barrel alongside the logger/dbService exports.
  withBackgroundSpan: tracingBackground.withBackgroundSpan,
  runInBackgroundSpan: tracingBackground.runInBackgroundSpan
};
