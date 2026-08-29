require('dotenv').config();
const { logger, dbService } = require('../shared-lib');
const { TokenRepository } = require('./notification/token-repository');
const { BroadcastRepository } = require('./notification/broadcast-repository');
const { FcmSender } = require('./notification/fcm-sender');
const { notificationQueue } = require('./notification/queue');

const VALID_PLATFORMS = new Set(['android', 'ios', 'web']);
const TOKEN_PATTERN = /^[A-Za-z0-9_:.\-]+$/;
const MAX_PREFERENCE_ENTRIES = 64;

/**
 * Facade over the notification subsystem.
 *
 * Broadcasts are asynchronous: enqueueBroadcast() persists a broadcast
 * document, drops a job on BullMQ, and returns immediately. The actual
 * FCM fan-out happens in workers/notification-worker.js, with running
 * counters in Redis and the durable record in ArangoDB.
 */
class NotificationService {
  constructor() {
    this.db = null;
    this.tokenRepository = new TokenRepository();
    this.broadcastRepository = new BroadcastRepository();
    this.fcmSender = new FcmSender();
    this.queue = notificationQueue;
    this.queueEnabled = false;
    this.initialized = false;
    logger.info('NotificationService constructor called');
  }

  get firebaseEnabled() {
    return this.fcmSender.enabled;
  }

  async init() {
    if (this.initialized) {
      logger.debug('NotificationService already initialized, skipping');
      return;
    }

    this.db = await dbService.getConnection('default');
    await this.tokenRepository.init(this.db);
    await this.broadcastRepository.init(this.db);
    this.fcmSender.init();

    try {
      this.queue.init();
      this.queueEnabled = true;
    } catch (error) {
      logger.error('NotificationService: queue unavailable — broadcasts will be rejected', {
        error: error.message,
      });
    }

    this.initialized = true;
    logger.info('NotificationService initialized', {
      firebaseEnabled: this.firebaseEnabled,
      queueEnabled: this.queueEnabled,
    });
  }

  async registerDeviceToken(payload) {
    this._assertInitialized();

    const userId = this._normalizeUserId(payload.userId);
    const fcmToken = String(payload.fcmToken || '').trim();
    if (!userId || !fcmToken) {
      throw new Error('userId and fcmToken are required');
    }
    if (fcmToken.length > 4096 || !TOKEN_PATTERN.test(fcmToken)) {
      throw new Error('fcmToken is malformed');
    }
    const platform = String(payload.platform || 'android').toLowerCase();
    if (!VALID_PLATFORMS.has(platform)) {
      throw new Error(`platform must be one of: ${[...VALID_PLATFORMS].join(', ')}`);
    }

    const doc = {
      userId,
      fcmToken,
      platform,
      preferences: this._normalizePreferences(payload.preferences),
      deviceInfo: payload.deviceInfo || {},
    };

    const result = await this.tokenRepository.upsertToken(doc);
    logger.info('NotificationService.device_token_registered', {
      userId,
      platform,
      tokenKey: result.key,
      created: result.created,
    });
    return { success: true, tokenKey: result.key };
  }

  async unregisterDeviceToken({ userId, fcmToken = null, all = false }) {
    this._assertInitialized();
    const normalizedUserId = this._normalizeUserId(userId);
    if (!normalizedUserId) {
      throw new Error('userId is required');
    }
    if (!all && !fcmToken) {
      throw new Error('fcmToken is required unless all=true');
    }
    const deactivated = await this.tokenRepository.deactivateByUser(
      normalizedUserId,
      all ? null : String(fcmToken).trim(),
    );
    return { success: true, deactivated };
  }

  /**
   * Validates, persists, and enqueues a broadcast. Returns fast — the caller
   * polls GET /broadcasts/:broadcastId for progress.
   */
  async enqueueBroadcast(payload, { idempotencyKey = null, requestedBy = null, source = null } = {}) {
    this._assertInitialized();

    const title = String(payload.title || 'MEWA Alert').trim();
    const body = String(payload.body || '').trim();
    if (!body) {
      throw new Error('body is required');
    }
    if (!this.queueEnabled) {
      const err = new Error('Notification queue is unavailable');
      err.statusCode = 503;
      throw err;
    }
    if (!this.firebaseEnabled) {
      const err = new Error('Firebase Admin credentials are not configured');
      err.statusCode = 503;
      throw err;
    }

    const audience = {
      districts: this._stringArray(payload.districts || (payload.location ? [payload.location] : [])),
      crops: this._stringArray(payload.crops),
      alertTypes: this._stringArray(payload.alertTypes || (payload.type ? [payload.type] : [])),
    };

    const { doc, duplicate } = await this.broadcastRepository.create({
      idempotencyKey: idempotencyKey || payload.idempotencyKey || null,
      payload: { ...payload, title, body },
      audience,
      source,
      requestedBy,
    });

    if (duplicate) {
      logger.info('NotificationService.broadcast_duplicate', {
        broadcastId: doc.broadcastId,
        idempotencyKey: doc.idempotencyKey,
        status: doc.status,
      });
      return { duplicate: true, broadcastId: doc.broadcastId, status: doc.status };
    }

    await this.queue.broadcastQueue.add(
      'broadcast',
      { key: doc._key, broadcastId: doc.broadcastId, payload: doc.payload, audience },
      {
        jobId: `bc-${doc._key}`,
        attempts: 3,
        backoff: { type: 'custom' },
        removeOnComplete: { age: 3600, count: 100 },
        removeOnFail: { age: 86400 },
      },
    );

    logger.info('NotificationService.broadcast_enqueued', {
      broadcastId: doc.broadcastId,
      audience,
      source,
    });
    return { duplicate: false, broadcastId: doc.broadcastId, status: 'queued' };
  }

  /** Status document, overlaid with live Redis counters while still sending. */
  async getBroadcastStatus(broadcastId) {
    this._assertInitialized();
    const doc = await this.broadcastRepository.getByBroadcastId(broadcastId);
    if (!doc) return null;

    const view = {
      broadcastId: doc.broadcastId,
      status: doc.status,
      source: doc.source,
      audience: doc.audience,
      counts: { ...doc.counts },
      errorSummary: doc.errorSummary || {},
      lastError: doc.lastError,
      createdAt: doc.createdAt,
      startedAt: doc.startedAt,
      finishedAt: doc.finishedAt,
    };

    if (['resolving', 'sending'].includes(doc.status) && this.queueEnabled) {
      try {
        const live = await this.queue.connection.hgetall(this.queue.countersKey(doc.broadcastId));
        for (const field of ['sent', 'failed', 'pruned', 'chunksDone']) {
          if (live[field] !== undefined) view.counts[field] = parseInt(live[field], 10) || 0;
        }
      } catch (_) { /* live overlay is best-effort */ }
    }
    return view;
  }

  async listBroadcasts({ status = null, limit = 25 } = {}) {
    this._assertInitialized();
    return this.broadcastRepository.list({ status, limit });
  }

  async getHealth() {
    this._assertInitialized();
    const health = {
      firebaseEnabled: this.firebaseEnabled,
      transport: this.fcmSender.transport,
      queueConnected: false,
      waiting: null,
      active: null,
      failed: null,
      activeTokenCount: null,
    };
    try {
      health.activeTokenCount = await this.tokenRepository.countActive();
    } catch (_) { /* leave null */ }
    if (this.queueEnabled) {
      try {
        health.queueConnected = await this.queue.isConnected();
        const counts = await this.queue.chunkQueue.getJobCounts('waiting', 'active', 'failed');
        health.waiting = counts.waiting;
        health.active = counts.active;
        health.failed = counts.failed;
      } catch (_) { /* leave nulls */ }
    }
    return health;
  }

  _assertInitialized() {
    if (!this.initialized) {
      throw new Error('NotificationService is not initialized');
    }
  }

  _normalizeUserId(value) {
    return String(value || '').trim().replace(/^users\//, '');
  }

  _normalizePreferences(preferences = {}) {
    return {
      districts: this._stringArray(preferences.districts),
      crops: this._stringArray(preferences.crops),
      alertTypes: this._stringArray(preferences.alertTypes),
    };
  }

  _stringArray(value) {
    if (!Array.isArray(value)) {
      return [];
    }
    return value
      .slice(0, MAX_PREFERENCE_ENTRIES)
      .map(item => String(item || '').trim())
      .filter(Boolean);
  }
}

const instance = new NotificationService();
module.exports = instance;
