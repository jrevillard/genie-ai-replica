'use strict';

/**
 * Collection helper utilities for ArangoDB.
 * Ensures collections exist before they are accessed, preventing
 * "collection or view not found" errors on fresh databases.
 */

const COLLECTION_CACHE = new Map();

/**
 * Ensure a document collection exists in the database.
 * Results are cached per database name + collection name to avoid
 * repeated listCollections calls on every request.
 *
 * @param {Object} db - ArangoJS database instance
 * @param {string} name - Collection name
 * @param {Object} [options] - Options passed to createCollection (e.g. { type: 3 } for edge collections)
 * @returns {Promise<Object>} ArangoJS collection reference
 */
async function ensureCollection(db, name, options = {}) {
  const dbName = db._name || 'default';
  const cacheKey = `${dbName}:${name}`;

  if (COLLECTION_CACHE.has(cacheKey)) {
    return db.collection(name);
  }

  const existing = (await db.listCollections()).map((c) => c.name);
  if (!existing.includes(name)) {
    await db.createCollection(name, options);
  }

  COLLECTION_CACHE.set(cacheKey, true);
  return db.collection(name);
}

/**
 * Clear the collection cache. Useful in tests.
 */
function clearCollectionCache() {
  COLLECTION_CACHE.clear();
}

module.exports = { ensureCollection, clearCollectionCache };
