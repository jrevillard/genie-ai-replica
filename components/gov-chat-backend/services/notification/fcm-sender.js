require('dotenv').config();
const { logger } = require('../../shared-lib');
const { classify, isMassInvalidArgument, INVALID_ARGUMENT } = require('./error-classifier');

const CHANNEL_ID = 'weather_alerts';
// FCM's data payload limit is 4096 bytes (keys + values). Leave headroom.
const DATA_BYTE_BUDGET = 3800;
// Keys the mobile client depends on — never dropped by the size guard.
const CORE_DATA_KEYS = new Set(['type', 'location', 'tier', 'tierLabel', 'crop']);

/**
 * Owns the Firebase Admin SDK and per-chunk sending.
 *
 * FCM_TRANSPORT=mock swaps the real SDK for a latency/error simulator so
 * fan-out, pruning and retry paths can be load-tested without burning quota
 * on 10k synthetic tokens (which would all come back UNREGISTERED for real).
 */
class FcmSender {
  constructor() {
    this.admin = null;
    this.messaging = null;
    this.enabled = false;
    this.transport = process.env.FCM_TRANSPORT || 'real';
  }

  init() {
    if (this.transport === 'mock') {
      this.enabled = true;
      logger.warn('FcmSender running with MOCK transport — no real pushes will be sent');
      return;
    }
    try {
      const admin = require('firebase-admin');
      if (admin.apps.length === 0) {
        const serviceAccountJson = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
        if (serviceAccountJson) {
          admin.initializeApp({
            credential: admin.credential.cert(JSON.parse(serviceAccountJson)),
          });
        } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
          admin.initializeApp({
            credential: admin.credential.applicationDefault(),
          });
        } else {
          logger.error('FcmSender: Firebase Admin credentials not configured — push notifications are DISABLED');
          return;
        }
      }
      this.admin = admin;
      this.messaging = admin.messaging();
      this.enabled = true;
      logger.info('FcmSender initialized with Firebase Admin');
    } catch (error) {
      logger.error('FcmSender: Firebase Admin unavailable — push notifications are DISABLED', {
        error: error.message,
      });
    }
  }

  /**
   * Builds everything except the recipient, so a future topic/condition
   * send path can reuse it unchanged.
   */
  buildMessage(payload) {
    const title = String(payload.title || 'MEWA Alert').trim();
    const body = String(payload.body || '').trim();
    const ttlSeconds = parseInt(process.env.NOTIFICATION_TTL_SECONDS, 10) || 21600; // 6h
    const collapseKey = `${payload.type || 'alert'}:${payload.location || 'all'}`.slice(0, 64);

    return {
      notification: { title, body },
      data: this._buildData(payload),
      android: {
        priority: 'high',
        ttl: ttlSeconds * 1000,
        collapseKey,
        notification: {
          channelId: CHANNEL_ID,
          priority: 'high',
        },
      },
    };
  }

  /**
   * FCM v1 requires every data value to be a string; one non-string value
   * fails the entire chunk with invalid-argument. Coerce everything, drop
   * null/undefined, and shed the largest non-core values if the payload
   * would blow the 4KB limit.
   */
  _buildData(payload) {
    const data = {};
    const put = (key, value) => {
      if (value === null || value === undefined) return;
      data[String(key)] = String(value);
    };

    put('type', payload.type || 'weather_warning');
    put('location', payload.location || '');
    put('tier', payload.tier ?? '');
    put('tierLabel', payload.tierLabel || payload.tier_label || '');
    put('crop', Array.isArray(payload.crops) ? payload.crops[0] || '' : payload.crop || '');
    put('alertTypes', JSON.stringify(payload.alertTypes || []));
    put('districts', JSON.stringify(payload.districts || []));
    put('crops', JSON.stringify(payload.crops || []));
    for (const [key, value] of Object.entries(payload.data || {})) {
      put(key, value);
    }

    // Size guard: shed the largest droppable values until under budget.
    let size = this._byteSize(data);
    while (size > DATA_BYTE_BUDGET) {
      const droppable = Object.keys(data)
        .filter((k) => !CORE_DATA_KEYS.has(k))
        .sort((a, b) => data[b].length - data[a].length);
      if (droppable.length === 0) break;
      const victim = droppable[0];
      logger.warn('FcmSender: data payload over 4KB budget — dropping key', {
        key: victim,
        valueBytes: Buffer.byteLength(data[victim], 'utf8'),
      });
      delete data[victim];
      size = this._byteSize(data);
    }

    return data;
  }

  _byteSize(data) {
    let total = 0;
    for (const [k, v] of Object.entries(data)) {
      total += Buffer.byteLength(k, 'utf8') + Buffer.byteLength(v, 'utf8');
    }
    return total;
  }

  /**
   * Sends one chunk (≤500 tokens) and classifies every failure.
   *
   * responses[i] corresponds to tokens[i] — that index mapping is what the
   * pruning and retry paths depend on.
   *
   * Returns { sent, failed, pruneTokens, retryTokens, errorCounts, abort, payloadInvalid }.
   * `failed` counts permanent failures only; retryTokens are not yet counted.
   */
  async sendChunk(tokens, message) {
    const response = this.transport === 'mock'
      ? await this._mockSend(tokens)
      : await this.messaging.sendEachForMulticast({ ...message, tokens });

    const result = {
      sent: 0,
      failed: 0,
      sentTokens: [],
      pruneTokens: [],
      retryTokens: [],
      errorCounts: {},
      abort: false,
      payloadInvalid: false,
    };

    let invalidArgumentCount = 0;
    const invalidArgumentTokens = [];

    response.responses.forEach((res, i) => {
      const token = tokens[i];
      if (res.success) {
        result.sent += 1;
        result.sentTokens.push(token);
        return;
      }
      const code = res.error?.code || 'unknown';
      result.errorCounts[code] = (result.errorCounts[code] || 0) + 1;
      switch (classify(res.error)) {
        case 'abort':
          result.abort = true;
          result.failed += 1;
          break;
        case 'prune':
          result.failed += 1;
          result.pruneTokens.push(token);
          break;
        case 'retry':
          result.retryTokens.push(token);
          break;
        case 'invalid-argument':
          invalidArgumentCount += 1;
          invalidArgumentTokens.push(token);
          break;
        default: // 'fail'
          result.failed += 1;
      }
    });

    const totalFailures = response.failureCount;
    if (isMassInvalidArgument(invalidArgumentCount, totalFailures)) {
      // Payload bug — every one of these tokens is probably fine.
      result.payloadInvalid = true;
      result.failed += invalidArgumentCount;
      logger.error('FcmSender: mass invalid-argument — payload bug suspected, pruning NOTHING', {
        invalidArgumentCount,
        totalFailures,
        chunkSize: tokens.length,
      });
    } else if (invalidArgumentCount > 0) {
      // Minority case: genuinely malformed tokens.
      result.failed += invalidArgumentCount;
      result.pruneTokens.push(...invalidArgumentTokens);
    }

    return result;
  }

  /**
   * Mock transport. Deterministic markers beat random rates for assertions:
   *   token contains '-BAD-'   → registration-token-not-registered
   *   token contains '-FLAKY-' → server-unavailable on ~50% of attempts
   *   token contains '-IARG-'  → invalid-argument
   * MOCK_FCM_FORCE_UNAVAILABLE=true → everything fails 503 (backpressure test).
   */
  async _mockSend(tokens) {
    const latency = 40 + Math.random() * 160;
    await new Promise((resolve) => setTimeout(resolve, latency));

    const forceUnavailable = process.env.MOCK_FCM_FORCE_UNAVAILABLE === 'true';
    const responses = tokens.map((token) => {
      if (forceUnavailable) {
        return { success: false, error: { code: 'messaging/server-unavailable' } };
      }
      if (token.includes('-BAD-')) {
        return { success: false, error: { code: 'messaging/registration-token-not-registered' } };
      }
      if (token.includes('-FLAKY-') && Math.random() < 0.5) {
        return { success: false, error: { code: 'messaging/server-unavailable' } };
      }
      if (token.includes('-IARG-')) {
        return { success: false, error: { code: INVALID_ARGUMENT } };
      }
      return { success: true };
    });

    return {
      responses,
      successCount: responses.filter((r) => r.success).length,
      failureCount: responses.filter((r) => !r.success).length,
    };
  }
}

module.exports = { FcmSender, CHANNEL_ID };
