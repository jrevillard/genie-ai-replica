require('dotenv').config();
const Redis = require('ioredis');
const { Queue } = require('bullmq');
const { logger } = require('../../shared-lib');

/**
 * Dedicated Redis connection + BullMQ queues for notification fan-out.
 *
 * Deliberately NOT shared with translation-service's client:
 * BullMQ requires maxRetriesPerRequest: null, while the translation cache
 * client sets 3 and enableOfflineQueue: false. Keys live on a separate
 * logical db (default 1) so they can never collide with cache keys.
 *
 * The redis-cache container runs --maxmemory-policy noeviction with no
 * maxmemory limit, so every key written outside BullMQ's own bookkeeping
 * (sent-sets, counter hashes) MUST carry an explicit TTL.
 */

const BROADCAST_QUEUE = 'notif-broadcast';
const CHUNK_QUEUE = 'notif-chunk';
const MAINTENANCE_QUEUE = 'notif-maintenance';

// 24h — the durable record is the ArangoDB broadcast document.
const TRANSIENT_KEY_TTL_SECONDS = 86400;

function redisOptions() {
  return {
    host: process.env.NOTIFICATION_REDIS_HOST || process.env.TRANSLATION_CACHE_HOST || 'localhost',
    port: parseInt(process.env.NOTIFICATION_REDIS_PORT || process.env.TRANSLATION_CACHE_PORT, 10) || 6379,
    password: process.env.NOTIFICATION_REDIS_PASSWORD || process.env.TRANSLATION_CACHE_PASSWORD || undefined,
    db: parseInt(process.env.NOTIFICATION_REDIS_DB, 10) || 1,
    maxRetriesPerRequest: null, // required by BullMQ
    enableOfflineQueue: true,
    retryStrategy(times) {
      return Math.min(times * 500, 5000);
    },
  };
}

class NotificationQueue {
  constructor() {
    this.connection = null;
    this.broadcastQueue = null;
    this.chunkQueue = null;
    this.maintenanceQueue = null;
    this.initialized = false;
  }

  init() {
    if (this.initialized) return;

    this.connection = new Redis(redisOptions());
    this.connection.on('error', (err) => {
      logger.error('NotificationQueue redis error', { error: err.message });
    });
    this.connection.on('connect', () => {
      logger.info('NotificationQueue connected to Redis');
    });

    const opts = { connection: redisOptions() };
    this.broadcastQueue = new Queue(BROADCAST_QUEUE, opts);
    this.chunkQueue = new Queue(CHUNK_QUEUE, opts);
    this.maintenanceQueue = new Queue(MAINTENANCE_QUEUE, opts);
    this.initialized = true;
  }

  /** Redis key holding running counters for one broadcast. */
  countersKey(broadcastId) {
    return `notif:broadcast:${broadcastId}`;
  }

  /** Redis key holding the per-error-code tallies for one broadcast. */
  errorsKey(broadcastId) {
    return `notif:err:${broadcastId}`;
  }

  /** Redis set of tokens already delivered for one chunk (crash-replay dedup). */
  sentSetKey(broadcastId, chunkIndex) {
    return `notif:sent:${broadcastId}:${chunkIndex}`;
  }

  async touchTransient(...keys) {
    const pipeline = this.connection.pipeline();
    for (const key of keys) pipeline.expire(key, TRANSIENT_KEY_TTL_SECONDS);
    await pipeline.exec();
  }

  async isConnected() {
    try {
      return (await this.connection.ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async closeAll() {
    const targets = [this.broadcastQueue, this.chunkQueue, this.maintenanceQueue];
    for (const q of targets) {
      if (q) await q.close().catch(() => {});
    }
    if (this.connection) await this.connection.quit().catch(() => {});
    this.initialized = false;
  }
}

module.exports = {
  notificationQueue: new NotificationQueue(),
  redisOptions,
  BROADCAST_QUEUE,
  CHUNK_QUEUE,
  MAINTENANCE_QUEUE,
  TRANSIENT_KEY_TTL_SECONDS,
};
