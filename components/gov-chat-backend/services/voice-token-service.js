const jwt = require('jsonwebtoken');
const { logger } = require('../shared-lib');

const SUPPORTED_LANGUAGES = ['fr', 'en', 'es', 'sw'];
const VOICE_TOKEN_TTL_SECONDS = Number(process.env.VOICE_TOKEN_TTL_SECONDS) || 300;

class VoiceTokenService {
  constructor() {
    this.wsUrl = process.env.VOICE_BRIDGE_WS_URL || '';
    this.jwtSecret = process.env.JWT_SECRET || '';
    this.initialized = Boolean(this.wsUrl) && Boolean(this.jwtSecret);
    if (!this.wsUrl) {
      logger.warn('VoiceTokenService not initialized: VOICE_BRIDGE_WS_URL is empty');
    }
    if (!this.jwtSecret) {
      logger.warn('VoiceTokenService not initialized: JWT_SECRET is empty');
    }
  }

  async mintToken({ userId, fullName, language, twinId }) {
    if (!this.initialized) {
      throw new Error('Voice service unavailable: VOICE_BRIDGE_WS_URL or JWT_SECRET not configured');
    }
    const lang = SUPPORTED_LANGUAGES.includes(language) ? language : 'en';
    const claims = { userId: String(userId), purpose: 'voice' };
    if (twinId && typeof twinId === 'string') {
      claims.twinId = twinId;
    }
    const voiceToken = jwt.sign(
      claims,
      this.jwtSecret,
      { algorithm: 'HS256', expiresIn: VOICE_TOKEN_TTL_SECONDS }
    );
    logger.info(`Voice token minted user=${userId} lang=${lang} twin=${twinId || '-'} ttl=${VOICE_TOKEN_TTL_SECONDS}s`);
    return {
      wsUrl: this.wsUrl,
      voiceToken,
      expiresIn: VOICE_TOKEN_TTL_SECONDS,
      language: lang,
      twinId: twinId || null,
      identity: `user-${userId}`,
      fullName: fullName || `user-${userId}`
    };
  }
}

const instance = new VoiceTokenService();
module.exports = instance;
