// shared-lib/index.js
const loggerModule = require('./logger'); // Import the module object
const securityHeaders = require('./security-headers');
const SecurityMiddleware = require('./security-middleware');
const dbService = require('./db-connection-service');
const { isExpectedAbsence } = require('./arango-absence'); // canonical ArangoDB absence predicate
const validationUtils = require('./validation-utils'); // parsePositiveInt helper
const erasureTombstone = require('./erasure-tombstone'); // GDPR erasure tombstone digest (erasure + provisioning contract)
const meltModule = require('./melt'); // MELT hexagonal seam (port + adapters + client); unconditional so a missing submodule fails loudly with MODULE_NOT_FOUND
const spanAttrs = require('./span-attrs'); // OTel span-attribute vocabulary, mirroring the OPEA overlay
const tracingBaggage = require('./tracing-baggage'); // Propagator factory + baggage scope helper
const keycloakAuthService = require('./keycloak-auth-service'); // Shared OIDC token verifier (jose/JWKS)

module.exports = {
  logger: loggerModule.logger, // Export the Winston logger instance
  reconfigureLogger: loggerModule.reconfigureLogger,
  parsePositiveInt: validationUtils.parsePositiveInt,
  erasureTombstoneKey: erasureTombstone.erasureTombstoneKey,
  dbService,
  isExpectedAbsence,
  securityHeaders,
  SecurityMiddleware,
  melt: meltModule,
  spanAttrs,
  tracingBaggage,
  keycloakAuthService
};
