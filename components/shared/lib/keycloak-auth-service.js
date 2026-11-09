// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// keycloak-auth-service.js — Shared OIDC token verifier (jose/JWKS) for all Node services.
// Issuer surface: the OIDC discovery issuer plus KEYCLOAK_PUBLIC_URL and
// KEYCLOAK_BROWSER_ISSUER aliases (split internal/public OIDC URLs), with
// KEYCLOAK_JWKS_URL as the JWKS fetch-host override and KEYCLOAK_EXPECTED_ISSUER
// as a strict single-issuer pin.
'use strict';

const { jwtVerify, createRemoteJWKSet } = require('jose');
const axios = require('axios');
const { logger } = require('./logger');

const KEYCLOAK_URL = process.env.KEYCLOAK_URL;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM;
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
 * @returns {Function} A callable JWKS function with attached .forceRefresh() method
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
  if (!idpUrl && !KEYCLOAK_URL) {
    throw new Error('KEYCLOAK_URL environment variable is required for OIDC discovery');
  }
  const baseUrl = idpUrl || `${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}`;
  // The realm ACTUALLY being initialized, derived from the idpUrl's
  // /realms/<name> suffix; falls back to the module-level KEYCLOAK_REALM when
  // idpUrl is absent (the primary init call is init() with no args).
  // initAllRealms() re-invokes init() per additional realm, so keying the
  // per-realm issuer aliases below on KEYCLOAK_REALM instead let the PARTNER
  // realm's init overwrite the PRIMARY realm's public-issuer alias with the
  // partner JWKS — every primary-realm browser token carrying the public
  // issuer then verified against the wrong realm's keys (review 2026-10-29).
  const realmMatch = /\/realms\/([^/?#]+)/.exec(baseUrl);
  const realm = realmMatch ? realmMatch[1] : KEYCLOAK_REALM;
  const discoveryUrl = `${baseUrl}/.well-known/openid-configuration`;

  logger.info(`[KeycloakAuth] Fetching OIDC discovery from ${discoveryUrl}`);

  const controller = new AbortController();
  // The value must be a bare positive integer — anything else falls back to
  // the default. Two ways to get it wrong, both fatal: a NaN setTimeout
  // fires immediately, and parseInt prefix-parses ('10s' reads as 10 ms —
  // an instant-abort loop), so the parsed value must round-trip to the raw
  // string to be trusted.
  const rawTimeout = (process.env.KEYCLOAK_DISCOVERY_TIMEOUT_MS || '5000').trim();
  const parsedTimeout = parseInt(rawTimeout, 10);
  const discoveryTimeoutMs =
    Number.isFinite(parsedTimeout) && parsedTimeout > 0 && String(parsedTimeout) === rawTimeout ? parsedTimeout : 5000;
  const discoveryTimer = setTimeout(() => controller.abort(), discoveryTimeoutMs);
  // The abort timer covers the WHOLE discovery exchange — fetch AND body
  // read: a host that accepts the connection and then stalls the response
  // body would otherwise hang init past the configured budget.
  let doc;
  try {
    const res = await fetch(discoveryUrl, { signal: controller.signal });
    if (!res.ok) {
      throw new Error(`OIDC discovery failed: ${res.status} ${res.statusText}`);
    }
    doc = await res.json();
  } catch (err) {
    if (err.name === 'AbortError') {
      throw new Error(`OIDC discovery timed out after ${discoveryTimeoutMs}ms`, { cause: err });
    }
    throw err; // network, HTTP-status and body-parse errors keep their message
  } finally {
    clearTimeout(discoveryTimer);
  }

  if (!doc.issuer || !doc.jwks_uri) {
    throw new Error('OIDC discovery document missing required fields: issuer, jwks_uri');
  }

  const jwksOverride = process.env.KEYCLOAK_JWKS_URL;
  const pinnedIssuer = process.env.KEYCLOAK_EXPECTED_ISSUER;
  // ONE JWKS source per init: the fetch-host override replaces the discovery
  // URI when set (Keycloak publishes jwks_uri from the request hostname —
  // KC_HOSTNAME — which inside service containers is often unreachable;
  // operators point KEYCLOAK_JWKS_URL at a container-reachable host). It
  // changes WHERE the keys come from, never WHO is accepted.
  const effectiveJwks = jwksOverride ? createJwksCache(jwksOverride) : createJwksCache(doc.jwks_uri);

  if (pinnedIssuer) {
    // Strict issuer pin: the pinned issuer is the ONLY accepted issuer —
    // the discovery issuer and the PUBLIC_URL/BROWSER_ISSUER alias
    // registrations below are skipped so an alias can never widen acceptance
    // past the pin. Primary-realm gated like the browser alias below: the
    // pin names ONE issuer of the PRIMARY realm, and an additional realm's
    // init re-running this branch would overwrite the pinned entry with ITS
    // realm's JWKS (the clobber class the alias gates prevent). A
    // partner-realm token carries a different iss than the pin and is
    // rejected either way — that is what "accept ONLY this issuer" means.
    if (realm === KEYCLOAK_REALM) {
      issuerMap.set(pinnedIssuer, effectiveJwks);
      logger.info(
        `[KeycloakAuth] KEYCLOAK_EXPECTED_ISSUER pin: accepting ONLY ${pinnedIssuer}` +
          (jwksOverride ? ` (JWKS override ${jwksOverride})` : ` (JWKS ${doc.jwks_uri})`)
      );
    }
  } else {
    issuerMap.set(doc.issuer, effectiveJwks);

    // Alias a public-facing issuer for split internal/public OIDC URLs (e.g.
    // local build behind Docker Desktop): the browser token iss
    // (https://localhost) can differ from the discovery issuer fetched
    // internally (http://kong:8000). Keyed by the realm ACTUALLY being
    // initialized (see the derivation above): a partner realm's alias
    // carries the partner realm's name, never the primary's — keying on
    // KEYCLOAK_REALM instead would let the partner's init overwrite the
    // primary alias with the partner JWKS (the multi-realm clobber class
    // the realm derivation prevents). No-op if unset.
    const publicUrl = process.env.KEYCLOAK_PUBLIC_URL;
    if (publicUrl) {
      const publicIssuer = `${publicUrl.replace(/\/$/, '')}/realms/${realm}`;
      if (publicIssuer !== doc.issuer) {
        issuerMap.set(publicIssuer, effectiveJwks);
        logger.info(`[KeycloakAuth] Aliased public issuer ${publicIssuer} -> same JWKS`);
      }
    }

    // KEYCLOAK_BROWSER_ISSUER (value = the literal full issuer, e.g.
    // https://localhost/auth/realms/genie): the browser tokens minted
    // through the nginx /auth path carry a path-prefix alias issuer that
    // neither the discovery issuer nor the public URL produces. By
    // definition the PRIMARY realm's browser-facing issuer — one env var,
    // one issuer: gating on the realm being initialized keeps
    // KEYCLOAK_ADDITIONAL_REALMS inits from overwriting the shared alias
    // with their own JWKS (same clobber class as above). No-op when unset.
    const browserIssuer = process.env.KEYCLOAK_BROWSER_ISSUER;
    if (browserIssuer && realm === KEYCLOAK_REALM && browserIssuer !== doc.issuer) {
      issuerMap.set(browserIssuer, effectiveJwks);
      logger.info(`[KeycloakAuth] Aliased browser issuer ${browserIssuer} -> same JWKS`);
    }

    if (jwksOverride) {
      logger.info(
        `[KeycloakAuth] Using KEYCLOAK_JWKS_URL=${jwksOverride} ` +
          `(overrides discovery ${doc.jwks_uri}; ` +
          `registered issuers: ${Array.from(issuerMap.keys()).join(', ')})`
      );
    }
  }

  // Only a PRIMARY init (or any init that registered an entry) may flip the
  // lazy-init singleton: a partner-realm init under the pin registers
  // nothing, and marking initialized there would leave the map empty with
  // no retry path for the life of the process.
  if (!(pinnedIssuer && realm !== KEYCLOAK_REALM)) {
    initialized = true;
    initFailedAt = 0;
  }

  const acceptedIssuers = Array.from(issuerMap.keys());
  logger.info(
    `[KeycloakAuth] Initialized: discovery issuer=${doc.issuer}, accepted issuers=[${acceptedIssuers.join(', ')}], jwks=${doc.jwks_uri}`
  );

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

  // KEYCLOAK_JWKS_URL pins ONE certs URL — with additional realms, every
  // realm's issuer would map to that one realm's keys. Visible at boot
  // instead of only in the env NOTES.
  if (process.env.KEYCLOAK_JWKS_URL) {
    logger.warn(
      "[KeycloakAuth] KEYCLOAK_JWKS_URL pins ONE realm's certs URL — additional realms " +
        `(${additionalRealms.join(', ')}) would resolve to the wrong keys; leave the override unset on multi-realm deployments`
    );
  }

  // Under the strict issuer pin, additional realms can never register: the
  // pin is the ONLY accepted issuer and it belongs to the primary realm.
  // Skipping their discovery legs avoids fetching documents whose entries
  // would be discarded, and keeps the "Additional realm initialized" log
  // from claiming success for realms the pin will always reject.
  if (process.env.KEYCLOAK_EXPECTED_ISSUER) {
    logger.warn(
      '[KeycloakAuth] KEYCLOAK_EXPECTED_ISSUER pin set — skipping additional realms ' +
        `(${additionalRealms.join(', ')}): tokens from any other issuer are rejected by the pin`
    );
    return;
  }

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
  if (initFailedAt && Date.now() - initFailedAt < INIT_RETRY_COOLDOWN) {
    throw new TokenVerificationError('AUTH_SERVICE_UNAVAILABLE', 'Authentication service is temporarily unavailable');
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
  async verifyToken(token, opts = {}) {
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
      throw new TokenVerificationError('AUTH_SERVICE_UNAVAILABLE', 'Authentication service is temporarily unavailable');
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
      // Opt-in audience binding (RFC 8707, Story 6.1): when the caller supplies
      // an `audience`, jose additionally validates the token's `aud` claim.
      // Omitted → no audience check (the historical resource-server behavior —
      // see the azp note below; pinned by keycloak-auth-service.audience.test.js).
      const jwtOptions = {
        issuer: unverifiedIss,
        algorithms: ['RS256'],
        requiredClaims: ['iss', 'exp']
      };
      if (opts && opts.audience) {
        jwtOptions.audience = opts.audience;
      }
      const { payload: verifiedPayload } = await jwtVerify(token, jwks, jwtOptions);

      // Note: we do NOT validate azp (authorized party). Any client within
      // the trusted realm that obtains a valid token should be accepted by
      // this resource server — this is standard OIDC Resource Server behavior.
      // The token's signature, issuer, and expiration are already verified above.

      return verifiedPayload;
    };

    // Two-attempt force-refresh pattern (from Architecture Decision D3)
    // 1. Verify token with cached JWKS → fail
    // 2. Check if token exp is still valid (not expired)
    // 4. If no (token expired) → 401 TOKEN_EXPIRED immediately (no refresh)

    // The verified result is the claims payload plus the iss_sub composite
    // key consumers key users/cache entries on.
    const toResult = (payload) => ({ ...payload, iss_sub: `${payload.iss}#${payload.sub}` });

    try {
      const result = toResult(await verifyWithJwt());

      logger.debug(`[KeycloakAuth] Token verified for ${result.iss_sub}`);
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
      // jose checks signature BEFORE claims, so we must manually check exp from unverified payload.
      // Expiry outranks an algorithm mismatch: a stale junk token reports
      // TOKEN_EXPIRED (the semantically leading defect, and the client
      // action — re-authenticate — is the same either way).
      const now = Math.floor(Date.now() / 1000);
      if (unverifiedExp && unverifiedExp < now) {
        // Token is expired → immediate TOKEN_EXPIRED (no refresh)
        throw new TokenVerificationError('TOKEN_EXPIRED', 'Token has expired');
      }

      // Algorithm rejection (JOSEAlgNotAllowed — the RS256 pin refusing an
      // alg-confusion token) is deterministic: jose rejects the header before
      // any key resolution, so no key rotation can make the same token
      // verify. It must NOT go through the force-refresh path below: forcing
      // the refresh only zeroes the JWKS cache TTL, so sustained junk-alg
      // traffic keeps the cache permanently invalidated, every LEGITIMATE
      // token then pays a JWKS re-fetch, and each junk-alg token gets a
      // second, equally-futile attempt.
      if (err.name === 'JOSEAlgNotAllowed') {
        throw new TokenVerificationError('TOKEN_INVALID', 'Token algorithm not allowed');
      }

      // Signature failure with valid exp → force-refresh JWKS and retry once
      try {
        jwks.forceRefresh();
        const result = toResult(await verifyWithJwt());

        logger.debug(`[KeycloakAuth] Token verified after JWKS force-refresh for ${result.iss_sub}`);
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
   * Check user status in Keycloak via UserInfo endpoint.
   * Called when token validation fails with 401 to determine if the user was
   * disabled/deleted.
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
      // 403 explicitly indicates user is disabled/deleted
      if (error.response && error.response.status === 403) {
        return { active: false, disabled: true };
      }
      // 401 is ambiguous: expired token OR disabled user — don't take destructive
      // action unless the response names the reason. Live-realm probe (issue #1476,
      // Keycloak 26.8.0, 2026-11-04): a DISABLED user's userinfo answers 401 —
      // WWW-Authenticate: Bearer error="invalid_token", error_description="User
      // disabled" — not 403. A matching WWW-Authenticate is the confirmed-disable
      // answer (same contract as the 403 branch above); anything else (expired
      // token, bad signature) stays ambiguous.
      if (error.response && error.response.status === 401) {
        const wwwAuthenticate = error.response.headers && error.response.headers['www-authenticate'];
        if (typeof wwwAuthenticate === 'string') {
          // Require BOTH the challenge code and the description: a challenge
          // that merely carries the phrase is not proof, and the middleware
          // acts destructively on a confirmed disable (soft-deletes the
          // account). Live-realm probe (Keycloak 26.8.0, 2026-11-04) answers
          // both together; a mismatch falls back to the ambiguous null.
          const disabled =
            /error="invalid_token"/i.test(wwwAuthenticate) &&
            /error_description="user disabled"/i.test(wwwAuthenticate);
          if (disabled) {
            return { active: false, disabled: true };
          }
          // Still ambiguous. When a WWW-Authenticate was present but named no
          // reason we act on, log it — the generic "may be expired" alone
          // would hide that the header simply did not match. Control
          // characters stripped and the value bounded: a challenge is
          // server-controlled log input.
          const printable = [...wwwAuthenticate]
            .filter((char) => {
              const code = char.codePointAt(0);
              return code >= 0x20 && code !== 0x7f;
            })
            .join('');
          const headerNote = ` (WWW-Authenticate: ${printable.slice(0, 200)})`;
          logger.warn(`[KeycloakAuth] Keycloak UserInfo returned 401 — ambiguous, treating as null${headerNote}`);
          return null;
        }
        logger.warn('[KeycloakAuth] Keycloak UserInfo returned 401 — ambiguous, treating as null');
        return null;
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
