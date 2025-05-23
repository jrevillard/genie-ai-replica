const logger = require('./logger');
const securityHeaders = require('./security-headers');
const SecurityMiddleware = require('./security-middleware');

console.log('Exporting from shared-lib:', { logger: typeof logger, securityHeaders: typeof securityHeaders, SecurityMiddleware: typeof SecurityMiddleware });
module.exports = {
  logger,
  securityHeaders,
  SecurityMiddleware
};
