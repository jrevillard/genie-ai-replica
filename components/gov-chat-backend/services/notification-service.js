require('dotenv').config();
const axios = require('axios');
const crypto = require('crypto');
const { aql } = require('arangojs');
const { logger, dbService } = require('../shared-lib');

class NotificationService {
  constructor() {
    this.db = null;
    this.deviceTokens = null;
    this.admin = null;
    this.initialized = false;
    this.firebaseEnabled = false;
    logger.info('NotificationService constructor called');
  }

  async init() {
    if (this.initialized) {
      logger.debug('NotificationService already initialized, skipping');
      return;
    }

    this.db = await dbService.getConnection('default');
    this.deviceTokens = await this._ensureCollection('notificationDeviceTokens');
    this._initFirebaseAdmin();
    this.initialized = true;

    logger.info('NotificationService initialized', {
      firebaseEnabled: this.firebaseEnabled,
      collection: 'notificationDeviceTokens',
    });
  }

  async registerDeviceToken(payload) {
    this._assertInitialized();

    const userId = this._normalizeUserId(payload.userId);
    const fcmToken = String(payload.fcmToken || '').trim();
    if (!userId || !fcmToken) {
      throw new Error('userId and fcmToken are required');
    }

    const now = new Date().toISOString();
    const key = this._tokenKey(userId, fcmToken);
    const doc = {
      _key: key,
      userId,
      fcmToken,
      platform: payload.platform || 'android',
      preferences: this._normalizePreferences(payload.preferences),
      deviceInfo: payload.deviceInfo || {},
      active: true,
      updatedAt: now,
      lastSeenAt: now,
    };

    const exists = await this.deviceTokens.documentExists(key).catch(() => false);
    if (exists) {
      await this.deviceTokens.update(key, doc, { mergeObjects: true });
    } else {
      await this.deviceTokens.save({ ...doc, createdAt: now });
    }

    logger.info('NotificationService.device_token_registered', {
      userId,
      platform: doc.platform,
      tokenKey: key,
    });

    return { success: true, tokenKey: key };
  }

  async broadcast(payload) {
    this._assertInitialized();

    const title = String(payload.title || 'MEWA Alert').trim();
    const body = String(payload.body || '').trim();
    if (!body) {
      throw new Error('body is required');
    }

    const tokens = await this._findMatchingTokens(payload);
    if (tokens.length === 0) {
      logger.warn('NotificationService.broadcast_no_tokens', {
        type: payload.type,
        districts: payload.districts || [],
        crops: payload.crops || [],
        alertTypes: payload.alertTypes || [],
      });
      return { success: true, sent: 0, failed: 0, tokenCount: 0 };
    }

    if (this.firebaseEnabled) {
      return this._sendWithFirebaseAdmin(tokens, payload, title, body);
    }

    if (process.env.FCM_SERVER_KEY) {
      return this._sendWithLegacyFcm(tokens, payload, title, body);
    }

    logger.warn('NotificationService.broadcast_skipped_no_firebase_config');
    return {
      success: false,
      sent: 0,
      failed: tokens.length,
      tokenCount: tokens.length,
      message: 'Firebase Admin credentials or FCM_SERVER_KEY are required',
    };
  }

  async _findMatchingTokens(payload) {
    const districts = this._stringArray(payload.districts || (payload.location ? [payload.location] : []));
    const crops = this._stringArray(payload.crops);
    const alertTypes = this._stringArray(payload.alertTypes || (payload.type ? [payload.type] : []));

    const cursor = await this.db.query(aql`
      FOR token IN notificationDeviceTokens
        FILTER token.active == true
        FILTER token.fcmToken != null && token.fcmToken != ""
        FILTER LENGTH(${districts}) == 0
          OR LENGTH(INTERSECTION(token.preferences.districts || [], ${districts})) > 0
        FILTER LENGTH(${crops}) == 0
          OR LENGTH(INTERSECTION(token.preferences.crops || [], ${crops})) > 0
        FILTER LENGTH(${alertTypes}) == 0
          OR LENGTH(INTERSECTION(token.preferences.alertTypes || [], ${alertTypes})) > 0
        RETURN DISTINCT token.fcmToken
    `);

    return cursor.all();
  }

  async _sendWithFirebaseAdmin(tokens, payload, title, body) {
    const chunks = this._chunks(tokens, 500);
    let sent = 0;
    let failed = 0;

    for (const chunk of chunks) {
      const response = await this.admin.messaging().sendEachForMulticast({
        tokens: chunk,
        notification: { title, body },
        data: this._buildMessageData(payload),
        android: {
          priority: 'high',
          notification: {
            channelId: 'weather_alerts',
            priority: 'high',
          },
        },
      });
      sent += response.successCount;
      failed += response.failureCount;
    }

    logger.info('NotificationService.firebase_broadcast_sent', {
      sent,
      failed,
      tokenCount: tokens.length,
    });

    return { success: failed === 0, sent, failed, tokenCount: tokens.length };
  }

  async _sendWithLegacyFcm(tokens, payload, title, body) {
    let sent = 0;
    let failed = 0;
    const data = this._buildMessageData(payload);

    for (const token of tokens) {
      try {
        await axios.post(
          'https://fcm.googleapis.com/fcm/send',
          {
            to: token,
            notification: { title, body },
            data,
          },
          {
            headers: {
              Authorization: `key=${process.env.FCM_SERVER_KEY}`,
              'Content-Type': 'application/json',
            },
            timeout: 10000,
          },
        );
        sent += 1;
      } catch (error) {
        failed += 1;
        logger.error('NotificationService.legacy_fcm_send_failed', {
          error: error.message,
          status: error.response?.status,
        });
      }
    }

    return { success: failed === 0, sent, failed, tokenCount: tokens.length };
  }

  _initFirebaseAdmin() {
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
          logger.warn('NotificationService Firebase Admin credentials not configured');
          return;
        }
      }
      this.admin = admin;
      this.firebaseEnabled = true;
    } catch (error) {
      logger.warn('NotificationService Firebase Admin unavailable', {
        error: error.message,
      });
    }
  }

  async _ensureCollection(name) {
    const collection = this.db.collection(name);
    const exists = await collection.exists().catch(() => false);
    if (!exists) {
      await this.db.createCollection(name);
      logger.info('NotificationService.collection_created', { name });
    }
    return this.db.collection(name);
  }

  _assertInitialized() {
    if (!this.initialized) {
      throw new Error('NotificationService is not initialized');
    }
  }

  _normalizeUserId(value) {
    return String(value || '').trim().replace(/^users\//, '');
  }

  _tokenKey(userId, fcmToken) {
    return crypto.createHash('sha256').update(`${userId}:${fcmToken}`).digest('hex');
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
    return value.map(item => String(item || '').trim()).filter(Boolean);
  }

  _buildMessageData(payload) {
    return {
      type: String(payload.type || 'weather_warning'),
      location: String(payload.location || ''),
      tier: String(payload.tier ?? ''),
      tierLabel: String(payload.tierLabel || payload.tier_label || ''),
      crop: Array.isArray(payload.crops) ? String(payload.crops[0] || '') : String(payload.crop || ''),
      alertTypes: JSON.stringify(payload.alertTypes || []),
      districts: JSON.stringify(payload.districts || []),
      crops: JSON.stringify(payload.crops || []),
      ...(payload.data || {}),
    };
  }

  _chunks(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }
}

const instance = new NotificationService();
module.exports = instance;
