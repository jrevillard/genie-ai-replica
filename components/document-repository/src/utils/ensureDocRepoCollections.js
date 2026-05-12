/**
 * Ensures ArangoDB document collections used by the document-repository exist.
 * Safe to run on every startup (no-op if collections already exist).
 */
const { logger, dbService } = require('../../shared-lib');

const REQUIRED_DOCUMENT_COLLECTIONS = ['files', 'ingestion_log', 'crawl_job', 'crawl_log', 'crawl_metrics'];

async function ensureDocRepoCollections() {
  const db = await dbService.getConnection('files');
  for (const name of REQUIRED_DOCUMENT_COLLECTIONS) {
    const coll = db.collection(name);
    const exists = await coll.exists();
    if (!exists) {
      await coll.create({ waitForSync: false });
      logger.info(`[DOC-REPO] Created missing Arango collection "${name}"`);
    }
  }
  logger.info('[DOC-REPO] Arango file-store collections verified');
}

module.exports = { ensureDocRepoCollections, REQUIRED_DOCUMENT_COLLECTIONS };
