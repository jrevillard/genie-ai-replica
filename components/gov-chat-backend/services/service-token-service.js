'use strict';

const crypto = require('crypto');

/**
 * Service token validation and user context building.
 * Used by OPEA callback endpoint GET /api/users/:userId/context
 */
const serviceTokenService = {
  /**
   * Validate X-Service-Token against SERVICE_AUTH_TOKEN
   * Uses timing-safe comparison to prevent timing side-channel attacks
   * @param {string} requestToken - Token from X-Service-Token header
   * @returns {{ status: number, body: object } | null} Error response or null if valid
   */
  validateServiceToken(requestToken) {
    const serviceToken = process.env.SERVICE_AUTH_TOKEN;

    if (!serviceToken) {
      return { status: 503, body: { error: 'Service temporarily unavailable' } };
    }

    if (!requestToken) {
      return { status: 401, body: { error: 'Invalid or missing service token' } };
    }

    // Length check prevents RangeError from timingSafeEqual
    if (Buffer.byteLength(requestToken) !== Buffer.byteLength(serviceToken)) {
      return { status: 401, body: { error: 'Invalid or missing service token' } };
    }

    if (!crypto.timingSafeEqual(Buffer.from(requestToken), Buffer.from(serviceToken))) {
      return { status: 401, body: { error: 'Invalid or missing service token' } };
    }

    return null; // valid
  },

  /**
   * Build sanitized user context for AI enrichment
   * Returns only safe fields — no passwords, tokens, or internal identifiers
   * @param {Object} user - Full ArangoDB user document
   * @returns {Object} Sanitized context with name, role, emailVerified
   */
  buildUserContext(user) {
    return {
      name: user.name || 'User',
      role: user.roles || [],
      emailVerified: user.emailVerified || false
    };
  }
};

module.exports = serviceTokenService;
