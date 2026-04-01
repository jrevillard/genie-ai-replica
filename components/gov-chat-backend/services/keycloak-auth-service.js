'use strict';

const { jwtVerify, createRemoteJWKS } = require('jose');
const { logger } = require('../shared-lib');

const KEYCLOAK_URL = process.env.KEYCLOAK_URL || 'http://keycloak:8080';
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'genie';
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'genie-app';

/**
 * Error class for structured auth errors
 */
class TokenVerificationError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'TokenVerificationError';
    this.code = code;
    this.details = details;
  }
}

/**
 * Keycloak Auth Service — validates Keycloak JWTs via JWKS
 *
 * Structured to allow easy addition of JWKS caching in Story 2.2.
 * Currently uses direct createRemoteJWKS() without caching.
 */
const keycloakAuthService = {
  /**
   * Verify a Keycloak JWT token
   * @param {string} token - Raw JWT string
   * @returns {Promise<Object>} Decoded JWT payload with iss_sub composite key
   * @throws {TokenVerificationError} On verification failure
   */
  async verifyToken(token) {
    if (!token || typeof token !== 'string') {
      throw new TokenVerificationError('TOKEN_INVALID', 'Token is empty or not a string');
    }

    // Split token to validate structure
    const parts = token.split('.');
    if (parts.length !== 3) {
      throw new TokenVerificationError('TOKEN_INVALID', 'Malformed JWT format');
    }

    // Extract payload to get iss for JWKS endpoint (unverified — verified below by jwtVerify)
    let payload;
    try {
      payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
    } catch (e) {
      throw new TokenVerificationError('TOKEN_INVALID', 'Cannot decode JWT payload');
    }

    if (!payload.iss) {
      throw new TokenVerificationError('TOKEN_INVALID', 'Token missing required iss claim');
    }

    if (!payload.exp) {
      throw new TokenVerificationError('TOKEN_INVALID', 'Token missing required exp claim');
    }

    // Check expiration first (before network call to JWKS)
    const now = Math.floor(Date.now() / 1000);
    if (payload.exp < now) {
      throw new TokenVerificationError('TOKEN_EXPIRED', 'Token has expired');
    }

    // Validate iss against expected Keycloak origin to prevent SSRF
    const expectedOrigin = KEYCLOAK_URL.replace(/\/+$/, '');
    if (!payload.iss || !payload.iss.startsWith(expectedOrigin)) {
      throw new TokenVerificationError(
        'TOKEN_INVALID',
        `Token issuer not from trusted Keycloak: ${payload.iss || 'missing'}`
      );
    }

    // Determine JWKS endpoint from token's iss claim
    const jwksUri = `${payload.iss}/protocol/openid-connect/certs`;

    logger.debug(`[KeycloakAuth] Verifying token, JWKS endpoint: ${jwksUri}`);

    try {
      const { payload: verifiedPayload } = await jwtVerify(token, createRemoteJWKS({ url: jwksUri }), {
        algorithms: ['RS256'],
        requiredClaims: ['iss', 'aud', 'exp', 'sub']
      });

      // Validate audience (handle both string and array aud)
      const audienceList = Array.isArray(verifiedPayload.aud)
        ? verifiedPayload.aud
        : [verifiedPayload.aud];
      if (!audienceList.includes(KEYCLOAK_CLIENT_ID)) {
        throw new TokenVerificationError(
          'TOKEN_INVALID',
          `Token audience mismatch: expected ${KEYCLOAK_CLIENT_ID}, got ${JSON.stringify(verifiedPayload.aud)}`
        );
      }

      // Build iss_sub composite key
      const issSub = `${verifiedPayload.iss}#${verifiedPayload.sub}`;

      const result = {
        ...verifiedPayload,
        iss_sub: issSub
      };

      logger.debug(`[KeycloakAuth] Token verified for ${issSub}`);
      return result;
    } catch (err) {
      if (err instanceof TokenVerificationError) {
        throw err;
      }

      logger.error(`[KeycloakAuth] Token verification failed: ${err.message}`);
      throw new TokenVerificationError('TOKEN_INVALID', 'Token verification failed');
    }
  },

  /**
   * Get expected issuer URL
   * @returns {string} Expected issuer URL
   */
  getExpectedIssuer() {
    return `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`;
  },

  /**
   * Get configured client ID
   * @returns {string} Client ID
   */
  getClientId() {
    return KEYCLOAK_CLIENT_ID;
  },

  TokenVerificationError
};

module.exports = keycloakAuthService;
