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
const COLLECTIONS = ['okf_repositories', 'okf_concepts_meta', 'okf_audit', 'okf_sources', 'okf_versions'];

const INDEXES = {
  okf_repositories: [
    { type: 'persistent', fields: ['graph_name'], unique: true },
    { type: 'persistent', fields: ['domain'] },
    // DB-ENFORCED uniqueness on (name, domain) for LIVE repos. Live docs share
    // deleted_at=null → collide; a soft-deleted tombstone has a unique deleted_at
    // timestamp → re-create of the same (name, domain) is allowed.
    { type: 'persistent', fields: ['name', 'domain', 'deleted_at'], unique: true }
  ],
  okf_concepts_meta: [
    { type: 'persistent', fields: ['repo_id'] },
    { type: 'persistent', fields: ['repo_id', 'concept_id'], unique: true }
  ],
  // Story 2.9.7 (ADR-031): the immutable version manifests. INSERT-only; the
  // [repo_id, bundle_version] unique index doubles as the concurrent-mint race
  // guard (a racing mint hits it and retries with the re-read counter).
  okf_versions: [
    { type: 'persistent', fields: ['repo_id'] },
    { type: 'persistent', fields: ['repo_id', 'bundle_version'], unique: true }
  ],
  okf_audit: [
    { type: 'persistent', fields: ['ts'] },
    { type: 'persistent', fields: ['repo_id'] }
  ],
  okf_sources: [{ type: 'persistent', fields: ['repo_id'], unique: true }]
};

// Shared DB connection — cache the RESOLVED proxy (not the promise). On failure
// _db stays null, so the next call retries (a transient boot-time outage does NOT
// permanently wedge the service).
let _db = null;
async function getDb() {
  if (_db) return _db;
  _db = await dbService.getConnection('default');
  return _db;
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
