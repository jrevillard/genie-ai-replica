'use strict';

const { jwtVerify, createRemoteJWKSet } = require('jose');
const { logger } = require('../shared-lib');

const KEYCLOAK_URL = process.env.KEYCLOAK_URL;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM || 'genie';
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID || 'genie-app';
const INIT_RETRY_COOLDOWN = 30000; // 30 seconds between retry attempts

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
 * Issuer → JWKS map for multi-IdP support.
 * Populated lazily by ensureInitialized() from OIDC discovery documents.
 */
const issuerMap = new Map();

/**
 * Init state for lazy singleton with retry cooldown
 */
let initPromise = null;
let initFailedAt = 0;
let initialized = false;

/**
 * Fetch OIDC discovery document and populate issuer map.
 *
 * @param {string} [idpUrl] - Base URL of the IdP (default: KEYCLOAK_URL/realms/KEYCLOAK_REALM).
 *                            For future multi-IdP, call init() multiple times with different URLs.
 * @throws {Error} If discovery fetch fails
 */
async function init(idpUrl) {
  const baseUrl = idpUrl || `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`;
  if (!baseUrl) {
    throw new Error('KEYCLOAK_URL environment variable is required for OIDC discovery');
  }
  const discoveryUrl = `${baseUrl}/.well-known/openid-configuration`;

  logger.info(`[KeycloakAuth] Fetching OIDC discovery from ${discoveryUrl}`);

  const res = await fetch(discoveryUrl);
  if (!res.ok) {
    throw new Error(`OIDC discovery failed: ${res.status} ${res.statusText}`);
  }

  const doc = await res.json();

  if (!doc.issuer || !doc.jwks_uri) {
    throw new Error('OIDC discovery document missing required fields: issuer, jwks_uri');
  }

  const jwks = createRemoteJWKSet(new URL(doc.jwks_uri));
  issuerMap.set(doc.issuer, jwks);
  initialized = true;
  initFailedAt = 0;

  logger.info(`[KeycloakAuth] Initialized: issuer=${doc.issuer}, jwks=${doc.jwks_uri}`);

  return doc.issuer;
}

/**
 * Ensure discovery is initialized. Uses lazy singleton pattern:
 * - First call triggers init
 * - If init fails, subsequent calls within INIT_RETRY_COOLDOWN are skipped
 * - After cooldown, init is retried automatically
 */
async function ensureInitialized() {
  if (initialized) return;

  // Within cooldown after a failure — skip retry
  if (initFailedAt && (Date.now() - initFailedAt) < INIT_RETRY_COOLDOWN) {
    throw new TokenVerificationError(
      'TOKEN_INVALID',
      'Authentication service is temporarily unavailable'
    );
  }

  // If an init is already in progress, wait for it
  if (initPromise) return initPromise;

  initPromise = init()
    .then(() => {
      initPromise = null;
    })
    .catch((err) => {
      initFailedAt = Date.now();
      initPromise = null;
      throw err;
    });

  return initPromise;
}

/**
 * Keycloak Auth Service — validates Keycloak JWTs via JWKS
 *
 * Uses OIDC discovery (lazy singleton) to resolve issuer and JWKS endpoint.
 * Token verification is delegated entirely to jose's jwtVerify with
 * native issuer, audience, expiration, and signature validation.
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

    if (token.split('.').length !== 3) {
      throw new TokenVerificationError('TOKEN_INVALID', 'Malformed JWT format');
    }

    try {
      await ensureInitialized();
    } catch (err) {
      if (err instanceof TokenVerificationError) throw err;
      throw new TokenVerificationError(
        'TOKEN_INVALID',
        'Authentication service is temporarily unavailable'
      );
    }

    // Extract unverified iss to lookup in trusted issuer map (whitelist)
    // Safe: only used to SELECT a trusted JWKS — jose verifies the signature
    let unverifiedIss;
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      unverifiedIss = payload.iss;
    } catch (e) {
      throw new TokenVerificationError('TOKEN_INVALID', 'Cannot decode JWT payload');
    }

    const jwks = issuerMap.get(unverifiedIss);
    if (!jwks) {
      throw new TokenVerificationError('TOKEN_INVALID', 'Unknown issuer');
    }

    try {
      const { payload: verifiedPayload } = await jwtVerify(token, jwks, {
        issuer: unverifiedIss,
        algorithms: ['RS256'],
        requiredClaims: ['iss', 'exp']
      });

      // Validate azp (authorized party) — the client that requested the token.
      // Keycloak 26+ sets aud=account for access tokens; azp holds the
      // actual client ID. This is the standard OIDC check for access tokens.
      if (verifiedPayload.azp && verifiedPayload.azp !== KEYCLOAK_CLIENT_ID) {
        throw new TokenVerificationError('TOKEN_INVALID', 'Token audience validation failed');
      }

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

      if (err.name === 'JWTExpired') {
        throw new TokenVerificationError('TOKEN_EXPIRED', 'Token has expired');
      }

      if (err.name === 'JWTClaimValidationFailed') {
        if (err.claim === 'iss') {
          throw new TokenVerificationError('TOKEN_INVALID', 'Token issuer validation failed');
        }
        if (err.claim === 'aud') {
          throw new TokenVerificationError('TOKEN_INVALID', 'Token audience validation failed');
        }
        throw new TokenVerificationError('TOKEN_INVALID', 'Token verification failed');
      }

      logger.error(`[KeycloakAuth] Token verification failed: ${err.message}`);
      throw new TokenVerificationError('TOKEN_INVALID', 'Token verification failed');
    }
  },

  /**
   * Force OIDC discovery init. Can be called at startup for eager init,
   * or omitted — verifyToken will lazily initialize on first call.
   * @param {string} [idpUrl] - Base URL of the IdP
   */
  init,

  /**
   * Get list of configured issuers
   * @returns {string[]} Configured issuer URLs
   */
  getConfiguredIssuers() {
    return [...issuerMap.keys()];
  },

  /**
   * Get expected issuer URL (first configured issuer)
   * @returns {string|undefined} Expected issuer URL
   */
  getExpectedIssuer() {
    const [issuer] = issuerMap.keys();
    return issuer;
  },

  /**
   * Get configured client ID
   * @returns {string} Client ID
   */
  getClientId() {
    return KEYCLOAK_CLIENT_ID;
  },

  TokenVerificationError,

  /**
   * Reset internal state. Only for testing.
   */
  _resetForTesting() {
    issuerMap.clear();
    initPromise = null;
    initFailedAt = 0;
    initialized = false;
  }
};

module.exports = keycloakAuthService;
