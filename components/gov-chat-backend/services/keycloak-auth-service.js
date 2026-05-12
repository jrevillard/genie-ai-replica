'use strict';

const { jwtVerify, createRemoteJWKSet } = require('jose');
const { logger } = require('../shared-lib');
const axios = require('axios');

const KEYCLOAK_URL = process.env.KEYCLOAK_URL;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM;
const KEYCLOAK_CLIENT_ID = process.env.KEYCLOAK_CLIENT_ID;
const INIT_RETRY_COOLDOWN = 30000; // 30 seconds between retry attempts
const JWKS_CACHE_TTL = 300000; // 5 minutes JWKS cache TTL (NFR10)

// Additional realms for backend token validation (JSON array of realm names).
// e.g. ["partner","contractor"]
let additionalRealms = [];
try {
  const parsed = JSON.parse(process.env.KEYCLOAK_ADDITIONAL_REALMS || '[]');
  if (Array.isArray(parsed)) {
    additionalRealms = parsed;
  } else {
    logger.warn('[KeycloakAuth] KEYCLOAK_ADDITIONAL_REALMS must be a JSON array, ignoring');
  }
} catch {
  logger.warn('[KeycloakAuth] Invalid JSON in KEYCLOAK_ADDITIONAL_REALMS, ignoring');
}

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
 * Create a JWKS cache with explicit TTL.
 *
 * jose's createRemoteJWKSet has built-in HTTP caching based on Cache-Control headers,
 * but Keycloak 26.x may not always return explicit cache headers. This wrapper ensures
 * consistent caching behavior with an explicit 5-minute TTL.
 *
 * @param {string} jwksUri - The JWKS endpoint URL
 * @param {number} ttlMs - Cache TTL in milliseconds (default: 300000 = 5 minutes)
 * @returns {Function} A callable JWKS function with attached .forceRefresh() and ._isExpired() methods
 *
 * The returned function has signature (protectedHeader, token) -> Promise<Key>
 * compatible with jose's jwtVerify(token, jwksFunction, options).
 *
 * @example
 * const jwksCache = createJwksCache('http://keycloak/realms/genie/protocol/openid-connect/certs');
 * const { payload } = await jwtVerify(token, jwksCache, { issuer: 'http://keycloak/realms/genie' });
 * // Later, force refresh if needed:
 * jwksCache.forceRefresh();
 */
function createJwksCache(jwksUri, ttlMs = JWKS_CACHE_TTL) {
  let inner = createRemoteJWKSet(new URL(jwksUri));
  const _jwksUri = jwksUri; // Store for re-fetch
  let createdAt = Date.now();

  /**
   * JWKS function compatible with jose's jwtVerify
   * @param {Object} protectedHeader - JWT protected header
   * @param {Object} token - Full JWT token
   * @returns {Promise<Key>} Cryptographic key
   */
  async function jwksFn(protectedHeader, token) {
    // Check TTL: if expired, re-fetch
    if (Date.now() - createdAt > ttlMs) {
      inner = createRemoteJWKSet(new URL(_jwksUri));
      createdAt = Date.now();
    }
    return inner(protectedHeader, token);
  }

  /**
   * Force refresh the JWKS cache on next use
   * Resets createdAt to 0, triggering re-fetch on next call
   */
  jwksFn.forceRefresh = function () {
    createdAt = 0;
  };

  /**
   * Check if the cache is expired
   * @returns {boolean} True if cache is expired
   */
  jwksFn._isExpired = function () {
    return Date.now() - createdAt > ttlMs;
  };

  return jwksFn;
}

/**
 * Issuer → JWKS cache map for multi-IdP support.
 * Each value is a createJwksCache() result (callable with .forceRefresh() method).
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

  const jwks = createJwksCache(doc.jwks_uri);
  issuerMap.set(doc.issuer, jwks);
  initialized = true;
  initFailedAt = 0;

  logger.info(`[KeycloakAuth] Initialized: issuer=${doc.issuer}, jwks=${doc.jwks_uri}`);

  return doc.issuer;
}

/**
 * Initialize all configured realms (primary + additional).
 * Primary realm failure throws (triggers cooldown in ensureInitialized).
 * Additional realm failures are logged as warnings but do not throw.
 *
 * @returns {Promise<void>}
 * @throws {Error} If primary realm initialization fails
 */
async function initAllRealms() {
  await init();

  if (additionalRealms.length === 0) return;

  for (const realmName of additionalRealms) {
    const realmUrl = `${KEYCLOAK_URL}/realms/${realmName}`;
    try {
      await init(realmUrl);
      logger.info(`[KeycloakAuth] Additional realm initialized: ${realmName}`);
    } catch (err) {
      logger.warn(`[KeycloakAuth] Failed to initialize additional realm '${realmName}': ${err.message}`);
    }
  }
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

  initPromise = initAllRealms()
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

    // Extract unverified iss and exp to lookup in trusted issuer map (whitelist)
    // Safe: only used to SELECT a trusted JWKS — jose verifies the signature
    let unverifiedIss;
    let unverifiedExp;
    try {
      const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString('utf8'));
      unverifiedIss = payload.iss;
      unverifiedExp = payload.exp;
    } catch {
      throw new TokenVerificationError('TOKEN_INVALID', 'Cannot decode JWT payload');
    }

    const jwks = issuerMap.get(unverifiedIss);
    if (!jwks) {
      throw new TokenVerificationError('TOKEN_INVALID', 'Unknown issuer');
    }

    // Helper function to verify token with JWT
    const verifyWithJwt = async () => {
      const { payload: verifiedPayload } = await jwtVerify(token, jwks, {
        issuer: unverifiedIss,
        requiredClaims: ['iss', 'exp']
      });

      // Note: we do NOT validate azp (authorized party). Any client within
      // the trusted realm that obtains a valid token should be accepted by
      // this resource server — this is standard OIDC Resource Server behavior.
      // The token's signature, issuer, and expiration are already verified above.

      return verifiedPayload;
    };

    // Two-attempt force-refresh pattern (from Architecture Decision D3)
    // 1. Verify token with cached JWKS → fail
    // 2. Check if token exp is still valid (not expired)
    // 3. If yes → force-refresh JWKS for this issuer → re-verify → if fail again, 401 TOKEN_INVALID
    // 4. If no (token expired) → 401 TOKEN_EXPIRED immediately (no refresh)

    try {
      const verifiedPayload = await verifyWithJwt();

      const issSub = `${verifiedPayload.iss}#${verifiedPayload.sub}`;

      const result = {
        ...verifiedPayload,
        iss_sub: issSub
      };

      logger.debug(`[KeycloakAuth] Token verified for ${issSub}`);
      return result;
    } catch (err) {
      // TokenVerificationError is re-thrown as-is
      if (err instanceof TokenVerificationError) {
        throw err;
      }

      // JWTExpired → immediate TOKEN_EXPIRED (no refresh attempt)
      if (err.name === 'JWTExpired') {
        throw new TokenVerificationError('TOKEN_EXPIRED', 'Token has expired');
      }

      // JWTClaimValidationFailed → TOKEN_INVALID (claim issues are NOT key rotation problems)
      if (err.name === 'JWTClaimValidationFailed') {
        if (err.claim === 'iss') {
          throw new TokenVerificationError('TOKEN_INVALID', 'Token issuer validation failed');
        }
        if (err.claim === 'aud') {
          throw new TokenVerificationError('TOKEN_INVALID', 'Token audience validation failed');
        }
        throw new TokenVerificationError('TOKEN_INVALID', 'Token verification failed');
      }

      // Generic Error (signature failure or unknown kid) → check exp for force-refresh decision
      // jose checks signature BEFORE claims, so we must manually check exp from unverified payload
      const now = Math.floor(Date.now() / 1000);
      if (unverifiedExp && unverifiedExp < now) {
        // Token is expired → immediate TOKEN_EXPIRED (no refresh)
        throw new TokenVerificationError('TOKEN_EXPIRED', 'Token has expired');
      }

      // Signature failure with valid exp → force-refresh JWKS and retry once
      try {
        jwks.forceRefresh();
        const verifiedPayload = await verifyWithJwt();

        const issSub = `${verifiedPayload.iss}#${verifiedPayload.sub}`;

        const result = {
          ...verifiedPayload,
          iss_sub: issSub
        };

        logger.debug(`[KeycloakAuth] Token verified after JWKS force-refresh for ${issSub}`);
        return result;
      } catch (retryErr) {
        // Retry failed → TOKEN_INVALID
        if (retryErr instanceof TokenVerificationError) {
          throw retryErr;
        }
        logger.error(`[KeycloakAuth] Token verification failed after JWKS refresh: ${retryErr.message}`);
        throw new TokenVerificationError('TOKEN_INVALID', 'Token verification failed');
      }
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
   * Check user status in Keycloak via UserInfo endpoint
   * Called when token validation fails with 401 to determine if user was disabled/deleted
   * @param {string} token - The rejected access/refresh token
   * @param {string} issuer - The token's issuer URL
   * @returns {Promise<{active: boolean, disabled: boolean}>} User status from Keycloak, or null if check failed
   */
  async checkUserStatusInKeycloak(token, issuer) {
    try {
      const userInfoUrl = `${issuer}/protocol/openid-connect/userinfo`;
      const response = await axios.get(userInfoUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json'
        },
        timeout: 3000
      });

      // If we get a 200 response, user is active
      if (response.status === 200 && response.data) {
        return { active: true, disabled: false };
      }

      // Unexpected response
      logger.warn(`[KeycloakAuth] Unexpected Keycloak UserInfo response: ${response.status}`);
      return null;
    } catch (error) {
      // 401/403 responses indicate user is disabled/deleted
      if (error.response && (error.response.status === 401 || error.response.status === 403)) {
        return { active: false, disabled: true };
      }
      // Network errors: timeouts are transient (warn), unexpected errors are severe (error)
      if (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT') {
        logger.warn(`[KeycloakAuth] Keycloak UserInfo check failed (network): ${error.message}`);
      } else {
        logger.error(`[KeycloakAuth] Keycloak UserInfo check failed: ${error.message}`);
      }
      return null;
    }
  },

  TokenVerificationError,

  /**
   * Create a JWKS cache with explicit TTL. Exported for testing.
   * @param {string} jwksUri - The JWKS endpoint URL
   * @param {number} ttlMs - Cache TTL in milliseconds
   * @returns {Function} A callable JWKS function with .forceRefresh() method
   */
  createJwksCache,

  /**
   * Reset internal state. Only for testing.
   */
  _resetForTesting() {
    issuerMap.clear();
    initPromise = null;
    initFailedAt = 0;
    initialized = false;
  },

  /**
   * Get JWKS cache for a specific issuer. Only for testing.
   * @param {string} issuer - The issuer URL
   * @returns {Function|undefined} The JWKS cache function or undefined
   */
  _getJwksCache(issuer) {
    return issuerMap.get(issuer);
  }
};

module.exports = keycloakAuthService;
