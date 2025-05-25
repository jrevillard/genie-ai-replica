// shared-lib/index.js
const loggerModule = require('./logger'); // Import the module object
const securityHeaders = require('./security-headers');
const SecurityMiddleware = require('./security-middleware');

module.exports = {
  logger: loggerModule.logger, // Export the Winston logger instance
  securityHeaders,
  SecurityMiddleware
};
