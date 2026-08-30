const nodeCrypto = require('crypto');
const { aql } = require('arangojs');
const { logger } = require('../../shared-lib');

const COLLECTION = 'notificationDeviceTokens';

// Reflected in scripts/new-schema-scripts/arango-schema.json; created here at
// boot so a running deployment self-heals without a manual script run.
const INDEXES = [
  { type: 'persistent', fields: ['active', 'preferences.districts[*]'], name: 'idx_ndt_active_district' },
  { type: 'persistent', fields: ['active', 'preferences.crops[*]'], name: 'idx_ndt_active_crop' },
  { type: 'persistent', fields: ['active', 'preferences.alertTypes[*]'], name: 'idx_ndt_active_alertType' },
  // Non-unique: _key = sha256(userId:fcmToken), so one device registered by
  // two users legitimately produces two docs.
  { type: 'persistent', fields: ['fcmToken'], name: 'idx_ndt_fcmToken' },
  { type: 'persistent', fields: ['userId'], name: 'idx_ndt_userId' },
  { type: 'persistent', fields: ['active', 'lastSeenAt'], name: 'idx_ndt_active_lastSeen' },
];

class TokenRepository {
  constructor() {
    this.db = null;
    this.collection = null;
  }

  async init(db) {
    this.db = db;
    this.collection = db.collection(COLLECTION);
    const exists = await this.collection.exists().catch(() => false);
    if (!exists) {
      await db.createCollection(COLLECTION);
      logger.info('TokenRepository.collection_created', { name: COLLECTION });
    }
    await this.ensureIndexes();
  }

  async ensureIndexes() {
    for (const index of INDEXES) {
      try {
        await this.collection.ensureIndex({ ...index, inBackground: true });
      } catch (error) {
        logger.error('TokenRepository.ensure_index_failed', {
          index: index.name,
          error: error.message,
        });
      }
    }
  }

  tokenKey(userId, fcmToken) {
    return nodeCrypto.createHash('sha256').update(`${userId}:${fcmToken}`).digest('hex');
  }

  /** Single-round-trip upsert (replaces the racy documentExists → update/save pair). */
  async upsertToken(doc) {
    const now = new Date().toISOString();
    const key = this.tokenKey(doc.userId, doc.fcmToken);
    const cursor = await this.db.query(aql`
      UPSERT { _key: ${key} }
      INSERT MERGE(${doc}, { _key: ${key}, active: true, createdAt: ${now}, updatedAt: ${now}, lastSeenAt: ${now} })
      UPDATE MERGE(${doc}, { active: true, updatedAt: ${now}, lastSeenAt: ${now}, deactivatedAt: null, deactivationReason: null })
      IN notificationDeviceTokens
      RETURN { key: NEW._key, created: OLD == null }
    `);
    return cursor.next();
  }

  /**
   * Streams matching tokens without materialising the full audience.
   * The AQL is built dynamically: a `LENGTH(@x) == 0 OR ...` fallback would
   * defeat the optimizer and force a full scan past the array indexes, so
   * only the clauses that apply are emitted.
   */
  async *streamMatchingTokens(audience, { batchSize = 1000 } = {}) {
    const filters = [
      'token.active == true',
      'token.fcmToken != null AND token.fcmToken != ""',
    ];
    const bindVars = {};
    if (audience.districts?.length) {
      filters.push('token.preferences.districts ANY IN @districts');
      bindVars.districts = audience.districts;
    }
    if (audience.crops?.length) {
      filters.push('token.preferences.crops ANY IN @crops');
      bindVars.crops = audience.crops;
    }
    if (audience.alertTypes?.length) {
      filters.push('token.preferences.alertTypes ANY IN @alertTypes');
      bindVars.alertTypes = audience.alertTypes;
    }

    const query = `
      FOR token IN notificationDeviceTokens
        FILTER ${filters.join('\n        FILTER ')}
        RETURN DISTINCT token.fcmToken
    `;

    const cursor = await this.db.query(query, bindVars, { batchSize, stream: true });
    try {
      for await (const batch of cursor.batches) {
        yield batch;
      }
    } finally {
      await cursor.kill().catch(() => {});
    }
  }

  /** Soft-deactivate: recoverable, auditable. Hard delete happens in reapStale. */
  async deactivateTokens(tokens, reason, broadcastId = null) {
    if (!tokens.length) return 0;
    const now = new Date().toISOString();
    const cursor = await this.db.query(aql`
      FOR t IN notificationDeviceTokens
        FILTER t.fcmToken IN ${tokens} AND t.active == true
        UPDATE t WITH {
          active: false,
          deactivatedAt: ${now},
          deactivationReason: ${reason},
          deactivatedByBroadcast: ${broadcastId}
        } IN notificationDeviceTokens
        COLLECT WITH COUNT INTO n
        RETURN n
    `);
    const count = (await cursor.next()) || 0;
    if (count > 0) {
      logger.info('TokenRepository.tokens_deactivated', { count, reason, broadcastId });
    }
    return count;
  }

  async deactivateByUser(userId, fcmToken = null) {
    const now = new Date().toISOString();
    const cursor = fcmToken
      ? await this.db.query(aql`
          FOR t IN notificationDeviceTokens
            FILTER t.userId == ${userId} AND t.fcmToken == ${fcmToken} AND t.active == true
            UPDATE t WITH { active: false, deactivatedAt: ${now}, deactivationReason: "unregistered" }
            IN notificationDeviceTokens
            COLLECT WITH COUNT INTO n RETURN n
        `)
      : await this.db.query(aql`
          FOR t IN notificationDeviceTokens
            FILTER t.userId == ${userId} AND t.active == true
            UPDATE t WITH { active: false, deactivatedAt: ${now}, deactivationReason: "unregistered" }
            IN notificationDeviceTokens
            COLLECT WITH COUNT INTO n RETURN n
        `);
    return (await cursor.next()) || 0;
  }

  async countActive() {
    const cursor = await this.db.query(aql`
      FOR t IN notificationDeviceTokens
        FILTER t.active == true
        COLLECT WITH COUNT INTO n
        RETURN n
    `);
    return (await cursor.next()) || 0;
  }

  /**
   * Daily maintenance:
   *  - hard-delete tokens soft-deactivated more than `deletedAfterDays` ago
   *  - soft-deactivate tokens unseen for `staleAfterDays` (FCM treats ~270
   *    days of app inactivity as stale)
   */
  async reapStale({ deletedAfterDays = 90, staleAfterDays = 270 } = {}) {
    const now = Date.now();
    const deleteBefore = new Date(now - deletedAfterDays * 86400000).toISOString();
    const staleBefore = new Date(now - staleAfterDays * 86400000).toISOString();
    const nowIso = new Date(now).toISOString();

    const deletedCursor = await this.db.query(aql`
      FOR t IN notificationDeviceTokens
        FILTER t.active == false AND t.deactivatedAt != null AND t.deactivatedAt < ${deleteBefore}
        REMOVE t IN notificationDeviceTokens
        COLLECT WITH COUNT INTO n RETURN n
    `);
    const staleCursor = await this.db.query(aql`
      FOR t IN notificationDeviceTokens
        FILTER t.active == true AND t.lastSeenAt != null AND t.lastSeenAt < ${staleBefore}
        UPDATE t WITH { active: false, deactivatedAt: ${nowIso}, deactivationReason: "stale_270d" }
        IN notificationDeviceTokens
        COLLECT WITH COUNT INTO n RETURN n
    `);

    const result = {
      deleted: (await deletedCursor.next()) || 0,
      deactivatedStale: (await staleCursor.next()) || 0,
    };
    logger.info('TokenRepository.reap_stale', result);
    return result;
  }
}

module.exports = { TokenRepository, COLLECTION, INDEXES };
