const axios = require('axios');
const { aql } = require('arangojs');
const { logger, dbService } = require('../shared-lib');

class NotificationService {
  constructor() {
    this.dbService = dbService;
    this.db = null;
    this.deviceTokens = null;
    this.broadcasts = null;
    this.initialized = false;
    this.fcmServerKey = process.env.FCM_SERVER_KEY || '';
  }

  async init() {
    if (this.initialized) return;

    this.db = await this.dbService.getConnection('default');
    await this._ensureCollection('notificationDeviceTokens');
    await this._ensureCollection('notificationBroadcasts');
    this.deviceTokens = this.db.collection('notificationDeviceTokens');
    this.broadcasts = this.db.collection('notificationBroadcasts');

    await this.deviceTokens.ensureIndex({ type: 'persistent', fields: ['fcmToken'], unique: true, sparse: true });
    await this.deviceTokens.ensureIndex({ type: 'persistent', fields: ['userId'] });
    await this.deviceTokens.ensureIndex({ type: 'persistent', fields: ['active'] });

    this.initialized = true;
    logger.info('[NOTIFICATIONS] NotificationService initialized');
  }

  async registerDevice({ userId, fcmToken, platform = 'android', preferences = {} }) {
    await this.init();
    if (!userId) throw new Error('userId is required');
    if (!fcmToken) throw new Error('fcmToken is required');

    const now = new Date().toISOString();
    const normalizedPreferences = this._normalizePreferences(preferences);

    const cursor = await this.db.query(aql`
      UPSERT { fcmToken: ${fcmToken} }
      INSERT {
        userId: ${userId},
        fcmToken: ${fcmToken},
        platform: ${platform},
        preferences: ${normalizedPreferences},
        active: true,
        createdAt: ${now},
        updatedAt: ${now}
      }
      UPDATE {
        userId: ${userId},
        platform: ${platform},
        preferences: ${normalizedPreferences},
        active: true,
        updatedAt: ${now}
      }
      IN notificationDeviceTokens
      RETURN NEW
    `);

    const rows = await cursor.all();
    return rows[0];
  }

  async deactivateToken(fcmToken) {
    await this.init();
    if (!fcmToken) return null;
    const now = new Date().toISOString();
    const cursor = await this.db.query(aql`
      FOR token IN notificationDeviceTokens
        FILTER token.fcmToken == ${fcmToken}
        UPDATE token WITH { active: false, updatedAt: ${now} } IN notificationDeviceTokens
        RETURN NEW
    `);
    const rows = await cursor.all();
    return rows[0] || null;
  }

  async broadcast(alert) {
    await this.init();

    const normalizedAlert = this._normalizeAlert(alert);
    const devices = await this._findMatchingDevices(normalizedAlert);
    const tokens = [...new Set(devices.map((device) => device.fcmToken).filter(Boolean))];

    const now = new Date().toISOString();
    const logDoc = {
      ...normalizedAlert,
      targetCount: tokens.length,
      matchedUserIds: [...new Set(devices.map((device) => device.userId).filter(Boolean))],
      createdAt: now,
      status: this.fcmServerKey ? 'pending' : 'skipped_no_fcm_key',
    };
    const saved = await this.broadcasts.save(logDoc, { returnNew: true });

    if (!this.fcmServerKey) {
      logger.warn('[NOTIFICATIONS] FCM_SERVER_KEY not set; broadcast stored but not sent', {
        broadcastKey: saved.new._key,
        targetCount: tokens.length,
      });
      return { broadcastId: saved.new._key, targetCount: tokens.length, sent: 0, skipped: true };
    }

    let sent = 0;
    const failedTokens = [];
    for (const chunk of this._chunk(tokens, 500)) {
      if (chunk.length === 0) continue;
      const result = await this._sendFcmChunk(chunk, normalizedAlert);
      sent += result.success;
      failedTokens.push(...result.failedTokens);
    }

    await this.broadcasts.update(saved.new._key, {
      status: 'sent',
      sent,
      failed: failedTokens.length,
      failedTokens: failedTokens.slice(0, 50),
      updatedAt: new Date().toISOString(),
    });

    logger.info('[NOTIFICATIONS] Broadcast complete', {
      broadcastId: saved.new._key,
      targetCount: tokens.length,
      sent,
      failed: failedTokens.length,
      type: normalizedAlert.type,
    });

    return { broadcastId: saved.new._key, targetCount: tokens.length, sent, failed: failedTokens.length };
  }

  async _findMatchingDevices(alert) {
    const cursor = await this.db.query(aql`
      FOR token IN notificationDeviceTokens
        FILTER token.active == true
        RETURN token
    `);
    const devices = await cursor.all();
    return devices.filter((device) => this._matchesPreferences(device.preferences || {}, alert));
  }

  _matchesPreferences(preferences, alert) {
    return this._matchesList(preferences.districts, alert.districts) &&
      this._matchesList(preferences.crops, alert.crops) &&
      this._matchesList(preferences.alertTypes, alert.alertTypes);
  }

  _matchesList(preferenceValues = [], targetValues = []) {
    const prefs = this._normalizeList(preferenceValues);
    const targets = this._normalizeList(targetValues);
    if (targets.length === 0 || prefs.length === 0) return true;
    return prefs.some((pref) => targets.includes(pref));
  }

  _normalizePreferences(preferences = {}) {
    return {
      districts: this._normalizeList(preferences.districts),
      crops: this._normalizeList(preferences.crops),
      alertTypes: this._normalizeList(preferences.alertTypes),
    };
  }

  _normalizeAlert(alert = {}) {
    const location = alert.location || alert.district || '';
    const districts = this._normalizeList(alert.districts || (location ? [location] : []));
    const crops = this._normalizeList(alert.crops || (alert.crop ? [alert.crop] : []));
    const alertTypes = this._normalizeList(alert.alertTypes || (alert.type ? [alert.type] : []));
    const type = alert.type || 'weather_warning';
    const title = alert.title || this._defaultTitle(alert, location);
    const body = alert.body || alert.message || alert.reasoning || 'New agriculture/weather alert';

    return {
      type,
      title,
      body,
      location,
      districts,
      crops,
      alertTypes,
      tier: alert.tier,
      tierLabel: alert.tierLabel || alert.tier_label,
      data: {
        ...(alert.data || {}),
        type,
        location,
        crop: crops[0] || alert.crop || '',
        tier: alert.tier != null ? String(alert.tier) : '',
        tier_label: alert.tierLabel || alert.tier_label || '',
      },
    };
  }

  _defaultTitle(alert, location) {
    const tierLabel = alert.tierLabel || alert.tier_label || 'Alert';
    return location ? `${tierLabel} — ${location}` : tierLabel;
  }

  _normalizeList(value) {
    if (value == null) return [];
    const values = Array.isArray(value) ? value : [value];
    return values
      .map((item) => item == null ? '' : String(item).trim().toLowerCase())
      .filter(Boolean);
  }

  async _sendFcmChunk(tokens, alert) {
    const payload = {
      registration_ids: tokens,
      priority: 'high',
      notification: {
        title: alert.title,
        body: alert.body,
      },
      data: Object.fromEntries(Object.entries(alert.data || {}).map(([key, value]) => [key, String(value ?? '')])),
    };

    const response = await axios.post('https://fcm.googleapis.com/fcm/send', payload, {
      headers: {
        Authorization: `key=${this.fcmServerKey}`,
        'Content-Type': 'application/json',
      },
      timeout: 10000,
    });

    const results = response.data?.results || [];
    const failedTokens = [];
    results.forEach((result, index) => {
      if (result.error) failedTokens.push(tokens[index]);
    });

    return {
      success: response.data?.success || 0,
      failedTokens,
    };
  }

  _chunk(items, size) {
    const chunks = [];
    for (let i = 0; i < items.length; i += size) {
      chunks.push(items.slice(i, i + size));
    }
    return chunks;
  }

  async _ensureCollection(name) {
    const collection = this.db.collection(name);
    const exists = await collection.exists();
    if (!exists) {
      await collection.create();
      logger.info(`[NOTIFICATIONS] Created collection ${name}`);
    }
  }
}

module.exports = new NotificationService();
