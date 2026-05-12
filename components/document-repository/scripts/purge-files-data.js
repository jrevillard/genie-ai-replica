#!/usr/bin/env node
/**
 * Removes all rows from document-repository Arango collections (file metadata, crawl, ingestion logs).
 * Does NOT delete knowledge-graph chunks — run dataprep retract per file from admin, or clean Arango graph separately.
 *
 * Usage (from repo root or this component):
 *   DOC_REPO_PURGE_FILES_DATA=I_UNDERSTAND node scripts/purge-files-data.js
 *
 * Loads .env from document-repository root when present.
 */
const path = require('path');
const fs = require('fs');

const rootDir = path.join(__dirname, '..');
const envPath = path.join(rootDir, '.env');
if (fs.existsSync(envPath)) {
  require('dotenv').config({ path: envPath });
} else {
  require('dotenv').config();
}

const { dbService, logger } = require(path.join(__dirname, '..', '..', 'shared', 'lib'));

const COLLECTIONS = ['ingestion_log', 'crawl_log', 'crawl_metrics', 'crawl_job', 'files'];

async function purge() {
  if (process.env.DOC_REPO_PURGE_FILES_DATA !== 'I_UNDERSTAND') {
    // eslint-disable-next-line no-console
    console.error('Refusing to run: set DOC_REPO_PURGE_FILES_DATA=I_UNDERSTAND');
    process.exit(1);
  }
  const db = await dbService.getConnection('files');
  for (const name of COLLECTIONS) {
    try {
      const coll = db.collection(name);
      if (await coll.exists()) {
        await db.query('FOR d IN @@coll REMOVE d IN @@coll', { '@@coll': name });
        logger.info(`[PURGE] Cleared collection ${name}`);
      }
    } catch (e) {
      logger.error(`[PURGE] Failed on ${name}: ${e.message}`);
      throw e;
    }
  }
  logger.info('[PURGE] File-related document-repository collections are empty.');
}

purge()
  .then(() => process.exit(0))
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  });
