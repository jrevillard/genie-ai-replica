// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Ensures the four OKF control-plane collections exist in the same ArangoDB
// database as the graphs (ADR-okf-018), with app-layer indexes — via the SHARED
// db-connection-service. Called once on boot (fire-and-forget — must NOT crash
// boot if Arango is momentarily down; the shared service handles reconnection).

const dbService = require('../shared-lib/db-connection-service');
const { logger } = require('../shared-lib/logger');
const { withSpan } = require('../shared-lib/tracing');

// repo_id IS the document _key (natural uniqueness) — no separate repo_id index.
const COLLECTIONS = ['okf_repositories', 'okf_concepts_meta', 'okf_audit', 'okf_sources'];

const INDEXES = {
  okf_repositories: [
    { type: 'persistent', fields: ['graph_name'], unique: true },
    { type: 'persistent', fields: ['domain'] }
  ],
  okf_concepts_meta: [
    { type: 'persistent', fields: ['repo_id'] },
    { type: 'persistent', fields: ['repo_id', 'concept_id'], unique: true }
  ],
  okf_audit: [
    { type: 'persistent', fields: ['ts'] },
    { type: 'persistent', fields: ['repo_id'] }
  ],
  okf_sources: [{ type: 'persistent', fields: ['repo_id'], unique: true }]
};

let _dbPromise = null;
function getDb() {
  if (!_dbPromise) _dbPromise = dbService.getConnection('default');
  return _dbPromise;
}

/**
 * Ensure a single collection + its indexes exist. Idempotent.
 * @param {object} db
 * @param {string} name
 */
async function ensureCollection(db, name) {
  const col = db.collection(name);
  if (!(await col.exists())) {
    await col.create();
    logger.info('OKF collection created', { collection: name });
  }
  for (const idx of INDEXES[name] || []) {
    await col.ensureIndex(idx);
  }
}

/**
 * Ensure all four OKF control-plane collections + indexes exist. Traced + logged.
 * Fire-and-forget on boot; safe to await from tests.
 * @returns {Promise<string[]>} the ensured collection names
 */
async function ensureCollections() {
  return withSpan('okf.db.ensureCollections', async (span) => {
    span.setAttribute('okf.collection_count', COLLECTIONS.length);
    const db = await getDb();
    for (const name of COLLECTIONS) {
      await ensureCollection(db, name);
    }
    logger.info('OKF control-plane collections ensured', { collections: COLLECTIONS });
    return COLLECTIONS;
  });
}

module.exports = { ensureCollections, ensureCollection, COLLECTIONS, INDEXES };
