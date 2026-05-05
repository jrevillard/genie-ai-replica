// shared-lib/index.js
const loggerModule = require('./logger'); // Import the module object
const securityHeaders = require('./security-headers');
const SecurityMiddleware = require('./security-middleware');
const dbService = require ('./db-connection-service');

/**
 * Idempotent: create the named ArangoDB collection if it does not already exist.
 * Used by services that need a collection on init without throwing on re-runs.
 */
async function ensureCollection(db, name) {
  const existing = await db.listCollections();
  if (!existing.some((c) => c.name === name)) {
    await db.createCollection(name);
  }
  return db.collection(name);
}

module.exports = {
  logger: loggerModule.logger, // Export the Winston logger instance
  dbService,
  ensureCollection,
  securityHeaders,
  SecurityMiddleware,
};
