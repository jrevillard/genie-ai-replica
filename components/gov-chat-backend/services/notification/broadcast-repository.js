const crypto = require('crypto');
const { randomUUID } = require('crypto');
const { aql } = require('arangojs');
const { logger } = require('../../shared-lib');

const COLLECTION = 'notificationBroadcasts';
const RETENTION_DAYS = 90;

const INDEXES = [
  { type: 'persistent', fields: ['status', 'createdAt'], name: 'idx_nb_status_createdAt' },
  { type: 'persistent', fields: ['broadcastId'], unique: true, name: 'idx_nb_broadcastId' },
  { type: 'persistent', fields: ['source', 'createdAt'], name: 'idx_nb_source_createdAt' },
  { type: 'ttl', fields: ['expiresAt'], expireAfter: 0, name: 'idx_nb_ttl' },
];

const ARANGO_UNIQUE_CONSTRAINT_VIOLATED = 1210;

/**
 * System-of-record for broadcast jobs. The document is written twice per
 * broadcast — once at create, once at finalize — with the running counters
 * held in Redis in between, so no write-lock contention arises.
 *
 * _key = sha256(idempotencyKey): the primary index IS the dedup constraint.
 */
class BroadcastRepository {
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
      logger.info('BroadcastRepository.collection_created', { name: COLLECTION });
    }
    for (const index of INDEXES) {
      try {
        await this.collection.ensureIndex({ ...index, inBackground: true });
      } catch (error) {
        logger.error('BroadcastRepository.ensure_index_failed', {
          index: index.name,
          error: error.message,
        });
      }
    }
  }

  keyFor(idempotencyKey) {
    return crypto.createHash('sha256').update(String(idempotencyKey)).digest('hex');
  }

  /**
   * Creates the broadcast document, or detects a duplicate idempotency key.
   * Returns { doc, duplicate }.
   */
  async create({ idempotencyKey, payload, audience, source, requestedBy }) {
    const effectiveKey = idempotencyKey || randomUUID();
    const key = this.keyFor(effectiveKey);
    const now = new Date();
    const doc = {
      _key: key,
      broadcastId: randomUUID(),
      idempotencyKey: effectiveKey,
      status: 'queued',
      source: source || 'manual',
      requestedBy: requestedBy || { kind: 'service', id: 'unknown' },
      payload,
      audience,
      counts: { matched: 0, chunksTotal: 0, chunksDone: 0, sent: 0, failed: 0, pruned: 0 },
      errorSummary: {},
      lastError: null,
      createdAt: now.toISOString(),
      startedAt: null,
      finishedAt: null,
      updatedAt: now.toISOString(),
      expiresAt: Math.floor(now.getTime() / 1000) + RETENTION_DAYS * 86400,
    };

    try {
      await this.collection.save(doc);
      return { doc, duplicate: false };
    } catch (error) {
      if (error.errorNum === ARANGO_UNIQUE_CONSTRAINT_VIOLATED || error.code === 409) {
        const existing = await this.collection.document(key);
        return { doc: existing, duplicate: true };
      }
      throw error;
    }
  }

  async markResolving(key) {
    await this._patch(key, { status: 'resolving', startedAt: new Date().toISOString() });
  }

  async markSending(key, matched, chunksTotal) {
    const now = new Date().toISOString();
    await this.db.query(aql`
      FOR b IN notificationBroadcasts
        FILTER b._key == ${key}
        UPDATE b WITH {
          status: 'sending',
          counts: MERGE(b.counts, { matched: ${matched}, chunksTotal: ${chunksTotal} }),
          updatedAt: ${now}
        } IN notificationBroadcasts
    `);
  }

  async markFailed(key, lastError) {
    await this._patch(key, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      lastError: {
        code: lastError?.code || 'unknown',
        message: String(lastError?.message || lastError || '').slice(0, 500),
        at: new Date().toISOString(),
      },
    });
  }

  /**
   * Flushes the aggregated Redis counters into the document exactly once.
   * Idempotent under concurrent callers: the FILTER on non-terminal status
   * means the second finalizer matches zero documents.
   */
  async finalize(key, counters, errorSummary) {
    const sent = counters.sent || 0;
    const failed = counters.failed || 0;
    const status = sent === 0 && failed > 0 ? 'failed' : failed > 0 ? 'partial' : 'completed';
    const now = new Date().toISOString();
    const cursor = await this.db.query(aql`
      FOR b IN notificationBroadcasts
        FILTER b._key == ${key} AND b.status IN ['resolving', 'sending', 'queued']
        UPDATE b WITH {
          status: ${status},
          counts: MERGE(b.counts, ${counters}),
          errorSummary: ${errorSummary},
          finishedAt: ${now},
          updatedAt: ${now}
        } IN notificationBroadcasts
        RETURN NEW
    `);
    const updated = await cursor.next();
    if (updated) {
      logger.info('BroadcastRepository.finalized', {
        broadcastId: updated.broadcastId,
        status,
        counts: updated.counts,
      });
    }
    return updated || null;
  }

  async getByBroadcastId(broadcastId) {
    const cursor = await this.db.query(aql`
      FOR b IN notificationBroadcasts
        FILTER b.broadcastId == ${broadcastId}
        LIMIT 1
        RETURN b
    `);
    return (await cursor.next()) || null;
  }

  async getByKey(key) {
    return this.collection.document(key).catch(() => null);
  }

  async list({ status = null, limit = 25 } = {}) {
    const capped = Math.min(Math.max(parseInt(limit, 10) || 25, 1), 100);
    const cursor = status
      ? await this.db.query(aql`
          FOR b IN notificationBroadcasts
            FILTER b.status == ${status}
            SORT b.createdAt DESC
            LIMIT ${capped}
            RETURN UNSET(b, '_id', '_rev')
        `)
      : await this.db.query(aql`
          FOR b IN notificationBroadcasts
            SORT b.createdAt DESC
            LIMIT ${capped}
            RETURN UNSET(b, '_id', '_rev')
        `);
    return cursor.all();
  }

  async _patch(key, patch) {
    await this.collection.update(key, { ...patch, updatedAt: new Date().toISOString() });
  }
}

module.exports = { BroadcastRepository, COLLECTION, INDEXES, RETENTION_DAYS };
