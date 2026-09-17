/**
 * Serving cache for /api/agri/* responses (remediation-plan.md §5).
 *
 * Serving order per endpoint key: Redis (hot) → Arango `agri_cache`
 * (durable last-known-good) → in-memory bundled seed. Writes go to both
 * Redis (TTL) and Arango (survives restarts). Redis is OPTIONAL — when it
 * is unavailable the layer degrades to Arango + seed and never throws.
 */
const { logger } = require('../../shared-lib');

class ServingCache {
  /**
   * @param {Object} deps
   * @param {Object|null} deps.redis - ioredis client or null
   * @param {Object} deps.db - arangojs database (dbService.getConnection())
   * @param {Object<string,*>} deps.seeds - endpoint key -> seed envelope
   */
  constructor({ redis, db, seeds }) {
    this.redis = redis;
    this.db = db;
    this.seeds = seeds || {};
  }

  /**
   * @param {string} key - endpoint key (e.g. 'market-prices:maize')
   * @returns {Promise<{envelope:Object|null, origin:'redis'|'arango'|'seed'|null}>}
   */
  async get(key) {
    if (this.redis) {
      try {
        const raw = await this.redis.get(`agri:${key}`);
        if (raw) {
          return { envelope: JSON.parse(raw), origin: 'redis' };
        }
      } catch (error) {
        logger.warn(`agri cache: redis get failed for ${key}: ${error.message}`);
      }
    }

    if (this.db) {
      try {
        const coll = this.db.collection('agri_cache');
        const doc = await coll.document(key).catch(() => null);
        if (doc && doc.envelope) {
          return { envelope: doc.envelope, origin: 'arango' };
        }
      } catch (error) {
        logger.warn(`agri cache: arango get failed for ${key}: ${error.message}`);
      }
    }

    if (this.seeds[key]) {
      return { envelope: this.seeds[key], origin: 'seed' };
    }

    return { envelope: null, origin: null };
  }

  /**
   * Persist an envelope to both tiers.
   * @param {string} key
   * @param {Object} envelope
   * @param {number} ttlMs - Redis TTL (Arango copy is durable)
   */
  async set(key, envelope, ttlMs) {
    const payload = JSON.stringify(envelope);

    if (this.redis) {
      try {
        await this.redis.set(`agri:${key}`, payload, 'PX', ttlMs);
      } catch (error) {
        logger.warn(`agri cache: redis set failed for ${key}: ${error.message}`);
      }
    }

    if (this.db) {
      try {
        await this.db
          .collection('agri_cache')
          .save({ _key: key, envelope, updatedAt: new Date().toISOString() }, { overwriteMode: 'replace' });
      } catch (error) {
        logger.warn(`agri cache: arango set failed for ${key}: ${error.message}`);
      }
    }
  }
}

module.exports = { ServingCache };
