// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// keycloak-auth-service.js — Shared OIDC token verifier (jose/JWKS) for all Node services.
// Issuer surface: the OIDC discovery issuer plus KEYCLOAK_PUBLIC_URL and
// KEYCLOAK_BROWSER_ISSUER aliases (split internal/public OIDC URLs), with
// KEYCLOAK_JWKS_URL as the JWKS fetch-host override, KEYCLOAK_DISCOVERY_URL
// as the discovery fetch-host override and KEYCLOAK_EXPECTED_ISSUER as a
// strict single-issuer pin.
'use strict';

const { jwtVerify, createRemoteJWKSet } = require('jose');
const axios = require('axios');
const { logger } = require('./logger');

const KEYCLOAK_URL = process.env.KEYCLOAK_URL;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM;
// KEYCLOAK_DISCOVERY_URL overrides WHERE the OIDC discovery document is
// fetched from. Same shape as KEYCLOAK_URL (a base URL — the realm path is
// appended to it). It exists for split-URL deployments, where the public
// KEYCLOAK_URL is not reachable from the container network while the
// internal Keycloak is (#1712). Unset = KEYCLOAK_URL, i.e. the historical
// behaviour. It moves WHERE the discovery document comes from, never WHO is
// accepted: the accepted issuers still come from that document (plus the
// KEYCLOAK_PUBLIC_URL / KEYCLOAK_BROWSER_ISSUER aliases).
const KEYCLOAK_DISCOVERY_URL = process.env.KEYCLOAK_DISCOVERY_URL;
const DISCOVERY_BASE_URL = (KEYCLOAK_DISCOVERY_URL || KEYCLOAK_URL || '').replace(/\/+$/, '');
const INIT_RETRY_COOLDOWN = 30000; // 30 seconds between retry attempts
const JWKS_CACHE_TTL = 300000; // 5 minutes JWKS cache TTL (NFR10) — jose's `cacheMaxAge`
// Floor on the key-set refresh jose performs when a token names a key id the
// realm does not publish — jose's `cooldownDuration`, 1 s.
//
// A refresh re-fetches the key set from the auth service, and reaching one
// takes nothing more than a token naming an unknown key id — an
// unauthenticated caller could therefore make the service hammer that
// endpoint. The cooldown bounds the fetch rate at one per second per issuer:
// inside the window jose answers from the cached set instead of re-fetching.
//
// What it costs is deliberate and unchanged by the move to jose's own cache:
// inside the window a rotation is picked up by the NEXT refresh, not by the
// one the rotated token triggers — the token is rejected (401) until the
// next refresh runs. The realm's rotation recovery is never faster than the
// refresh that observes it.
//
// The window is measured from the last FETCH of the key set (any fetch, the
// TTL refresh included), where the previous wrapper measured it from the last
// FORCED refresh. The rate bound is identical; only the anchor moved, and
// the anchor is the token library's, not ours.
const JWKS_REFRESH_COOLDOWN_MS = 1000;

/**
 * Does the fetched key set hold a key that can verify an RS256 signature?
 *
 * jose's local key set filters the published keys by the token's algorithm
 * (kty, alg, use, key_ops) and raises JWKSNoMatchingKey when NOTHING
 * matches — which covers two different faults: a token naming a key id the
 * realm does not publish (the token's fault) and a realm publishing no
 * usable key at all (the auth service's fault). This mirrors jose's filter
 * for RS256, the only algorithm this verifier accepts.
 *
 * @param {Object|undefined} jwks - The published key set (jose's `jwks()`)
 * @returns {boolean} True when the set holds a usable key, or when the set
 *   is unknown (no information → never claim an outage on a guess)
 *
 * This filter is deliberately LOOSER than jose's own candidate filter: it
 * ignores jose's `ext` check, its key_ops uniqueness/type strictness and the
 * `kid` match (a key set holding a usable key is usable whatever the token
 * names). The divergence is one-way — this filter can only under-report an
 * outage (a bad token where jose would say "no usable key"), never invent
 * one — so a healthy key set is never misread as a broken realm. Tightening
 * it toward jose would flip that direction: any token that reaches this
 * check with a key set jose itself would refuse (an `ext: false` key, a
 * non-unique key_ops list) would be answered 503 instead of 401.
 */
function keySetHasUsableKey(jwks) {
  if (!jwks || !Array.isArray(jwks.keys)) return true;
  return jwks.keys.some(
    (jwk) =>
      jwk &&
      jwk.kty === 'RSA' &&
      (!jwk.alg || jwk.alg === 'RS256') &&
      (!jwk.use || jwk.use === 'sig') &&
      (!Array.isArray(jwk.key_ops) || jwk.key_ops.includes('verify'))
  );
}

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
 * Create a JWKS cache.
 *
 * The cache is jose's own remote key set — ONE per issuer, never recreated.
 * jose owns both halves of the policy: `cacheMaxAge` (the TTL: the set is
 * re-fetched once it is that old) and `cooldownDuration` (the floor on the
 * reload jose performs when a token names a key id the realm does not
 * publish). A second cache mechanism over the same dependency — with its own
 * TTL, its own floor and its own set recreation — could only disagree with
 * it, and the recreation (a fresh remote set starts cold, with no cooldown
 * state) is what made the floor necessary in the first place (#1778).
 *
 * @param {string} jwksUri - The JWKS endpoint URL
 * @param {number} ttlMs - Cache TTL in milliseconds (default: 300000 = 5 minutes)
 * @returns {Function} A callable JWKS function
 *
 * The returned function has signature (protectedHeader, token) -> Promise<Key>
 * compatible with jose's jwtVerify(token, jwksFunction, options).
 *
 * @example
 * const jwksCache = createJwksCache('http://keycloak/realms/genie/protocol/openid-connect/certs');
 * const { payload } = await jwtVerify(token, jwksCache, { issuer: 'http://keycloak/realms/genie' });
 */
function createJwksCache(jwksUri, ttlMs = JWKS_CACHE_TTL) {
  const inner = createRemoteJWKSet(new URL(jwksUri), {
    cacheMaxAge: ttlMs,
    cooldownDuration: JWKS_REFRESH_COOLDOWN_MS
  });

  /**
   * JWKS function compatible with jose's jwtVerify
   * @param {Object} protectedHeader - JWT protected header
   * @param {Object} token - The JWS (its `header` holds the unprotected header)
   * @returns {Promise<Key>} Cryptographic key
   */
  async function jwksFn(protectedHeader, token) {
    // Whether the cached set is inside its cooldown window BEFORE the call:
    // jose suppresses the reload-on-unknown-kid while it is, and only this
    // snapshot says whether a refresh was floored (the cooldown window is
    // closed again by the time the error comes back).
    const coolingDown = inner.coolingDown === true;
    try {
      return await inner(protectedHeader, token);
    } catch (err) {
      // This wrapper is the ONLY network call of the verification path: a
      // failure here is the AUTH SERVICE's, never the token's. Two errors
      // from this leg are the TOKEN's: an unknown kid (JWKSNoMatchingKey —
      // the key set may simply be stale; the realm may have rotated) and an
      // ambiguous key match (JWKSMultipleMatchingKeys). Everything else
      // (a refused connection, a non-200 response, an unparsable body, a
      // timeout, a malformed key set) is an outage: it must NOT be reported
      // as a bad token, or the consumers answer 401 and send every user to
      // the login page during an infrastructure outage (#1723).
      if (err && err.name === 'JWKSNoMatchingKey') {
        // jose raises the same error for two different faults: a token
        // naming a key id the realm does not publish (the token's fault) and
        // a realm publishing no usable key at all (the auth service's
        // fault). The published key set tells them apart: no usable key
        // means the realm's own state is broken, which is an outage, not a
        // rejected token.
        const published = typeof inner.jwks === 'function' ? inner.jwks() : undefined;
        if (!keySetHasUsableKey(published)) {
          throw new TokenVerificationError(
            'AUTH_SERVICE_UNAVAILABLE',
            'Authentication service is temporarily unavailable (the realm published no usable signing key)'
          );
        }
        if (coolingDown) {
          // jose answered from the cached set instead of re-fetching it: the
          // realm may ALREADY publish the key this token names, and the next
          // refresh observes it. The flag travels with the error so the
          // caller can say so in the log.
          err.refreshFloored = true;
        }
        throw err;
      }
      if (err && err.name === 'JWKSMultipleMatchingKeys') {
        // jose raises this when a key resolves to MORE THAN ONE candidate:
        // a token that names no key id against a multi-key set, or a token
        // whose kid appears twice in the published set (a misconfigured
        // rotation). Either way the ambiguity is resolvable only by the
        // caller — the token cannot be verified unambiguously, so it stays
        // a token-side rejection. (The realm in scope — Keycloak — always
        // publishes a key id, and never duplicates one.)
        throw err;
      }
      throw new TokenVerificationError(
        'AUTH_SERVICE_UNAVAILABLE',
        `Authentication service is temporarily unavailable (JWKS fetch failed: ${err && err.message})`
      );
    }
  }

  return jwksFn;
}

/**
 * Issuer → JWKS cache map for multi-IdP support.
 * Each value is a createJwksCache() result (a callable JWKS resolver).
 * Populated lazily by ensureInitialized() from OIDC discovery documents.
 */
const issuerMap = new Map();

/**
 * Init state for lazy singleton with retry cooldown
 */
let initPromise = null;
let initFailedAt = 0;
let initFailureReason = null;
let initialized = false;

/**
 * Fetch OIDC discovery document and populate issuer map.
 *
 * @param {string} [idpUrl] - Base URL of the IdP (default: KEYCLOAK_URL/realms/KEYCLOAK_REALM).
 * @throws {Error} If discovery fetch fails
 */
async function init(idpUrl) {
  if (!idpUrl && !DISCOVERY_BASE_URL) {
    throw new Error('KEYCLOAK_URL (or KEYCLOAK_DISCOVERY_URL) environment variable is required for OIDC discovery');
  }
  const baseUrl = idpUrl || `${DISCOVERY_BASE_URL}/realms/${KEYCLOAK_REALM}`;
  // The realm ACTUALLY being initialized, derived from the idpUrl's
  // /realms/<name> suffix; falls back to the module-level KEYCLOAK_REALM when
  // idpUrl is absent (the primary init call is init() with no args).
  // initAllRealms() re-invokes init() per additional realm, so keying the
  // per-realm issuer aliases below on KEYCLOAK_REALM instead let the PARTNER
  // realm's init overwrite the PRIMARY realm's public-issuer alias with the
  // partner JWKS — every primary-realm browser token carrying the public
  // issuer then verified against the wrong realm's keys.
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
  // Bare positive integer AND within setTimeout's range: Node clamps delays
  // above 2^31-1 ms to 1 ms — an "effectively never" value would abort every
  // discovery instantly, the same failure class as a prefix-parsed '10s'.
  const MAX_TIMEOUT_MS = 2147483647;
  const discoveryTimeoutMs =
    Number.isFinite(parsedTimeout) &&
    parsedTimeout > 0 &&
    parsedTimeout <= MAX_TIMEOUT_MS &&
    String(parsedTimeout) === rawTimeout
      ? parsedTimeout
      : 5000;
  if (discoveryTimeoutMs === 5000 && rawTimeout !== '5000' && process.env.KEYCLOAK_DISCOVERY_TIMEOUT_MS) {
    logger.warn(
      `KEYCLOAK_DISCOVERY_TIMEOUT_MS='${process.env.KEYCLOAK_DISCOVERY_TIMEOUT_MS}' is not a bare positive integer within the timer range — using the 5000ms default`
    );
  }
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
    // Network, HTTP-status and body-parse errors keep their message but
    // gain the failing leg's context — a bare 'fetch failed' from an
    // additional realm is indistinguishable from any other realm's.
    throw new Error(`OIDC discovery from ${discoveryUrl} failed: ${err.message}`, { cause: err });
  } finally {
    clearTimeout(discoveryTimer);
  }

  if (!doc.issuer || !doc.jwks_uri) {
    throw new Error('OIDC discovery document missing required fields: issuer, jwks_uri');
  }

  const jwksOverride = process.env.KEYCLOAK_JWKS_URL;
  const pinnedIssuer = process.env.KEYCLOAK_EXPECTED_ISSUER;
  const sizeBefore = issuerMap.size;
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

  // An init that registers no entry must not flip the lazy-init singleton:
  // under the strict issuer pin a partner-realm init registers nothing, and
  // marking initialized there would leave the map empty with no retry path
  // for the life of the process.
  if (issuerMap.size > sizeBefore) {
    initialized = true;
    initFailedAt = 0;
    initFailureReason = null;
  } else if (pinnedIssuer && realm !== KEYCLOAK_REALM) {
    // A partner-realm init under the pin registers nothing whether or not
    // the primary has already registered the pin — the identical silent
    // no-registration either way, so both are loud. On the no-args primary
    // init this means KEYCLOAK_REALM is unset or unusable (the realm then
    // derives from the URL and cannot equal the undefined KEYCLOAK_REALM the
    // pin gate compares against). Throwing arms the retry cooldown; failing
    // silently here would re-run full discovery on every single token.
    throw new Error(
      `KEYCLOAK_EXPECTED_ISSUER (${pinnedIssuer}) matches no registered issuer — ` +
        `check KEYCLOAK_REALM against the discovery URL's realm`
    );
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
  // realm's issuer would map to that one realm's keys, so every
  // partner-realm token would fail signature verification (misleadingly)
  // for the life of the deployment. The additional realms are SKIPPED,
  // exactly as under the strict issuer pin below: a partner token then
  // fails with the clear 'Unknown issuer' instead of a misleading
  // signature failure, and the accepted-issuer set says exactly which
  // realms this deployment serves (#1701).
  if (process.env.KEYCLOAK_JWKS_URL) {
    logger.warn(
      "[KeycloakAuth] KEYCLOAK_JWKS_URL pins ONE realm's certs URL — skipping additional realms " +
        `(${additionalRealms.join(', ')}): their tokens would verify against the wrong keys; ` +
        'leave the override unset on multi-realm deployments'
    );
    return;
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
    const realmUrl = `${DISCOVERY_BASE_URL}/realms/${realmName}`;
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

  // Within cooldown after a failure — skip retry. The first failure's
  // detail (why init failed) rides along: this message is what callers'
  // DIAG logs print, and without it a 503 during the cooldown window
  // names no cause at all.
  if (initFailedAt && Date.now() - initFailedAt < INIT_RETRY_COOLDOWN) {
    throw new TokenVerificationError(
      'AUTH_SERVICE_UNAVAILABLE',
      `Authentication service is temporarily unavailable (${initFailureReason || 'init failed previously'})`
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
      initFailureReason = err.message;
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
      // The original message rides along: this message is what the callers'
      // DIAG logs print, and init failures carry operator-actionable detail
      // (discovery unreachable, the KEYCLOAK_EXPECTED_ISSUER pin-mismatch
      // remedy). Clients only ever see the fixed 503/401 bodies, never this.
      throw new TokenVerificationError(
        'AUTH_SERVICE_UNAVAILABLE',
        `Authentication service is temporarily unavailable (${err.message})`
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
      // Opt-in audience binding (RFC 8707): when the caller supplies
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

    // The key-set refresh is jose's own: a token naming a key id the realm
    // does not publish makes jose re-read the key set (once per cooldown
    // window per issuer) and resolve the token against the fresh set. The
    // verifier does not retry on its own — a second attempt would double
    // the realm's fetch rate for no gain.

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

      // Generic Error (signature failure or unknown kid) → check exp
      // jose checks signature BEFORE claims, so we must manually check exp from unverified payload.
      // Expiry outranks an algorithm mismatch: a stale junk token reports
      // TOKEN_EXPIRED (the semantically leading defect, and the client
      // action — re-authenticate — is the same either way).
      const now = Math.floor(Date.now() / 1000);
      if (unverifiedExp && unverifiedExp < now) {
        // Token is expired → immediate TOKEN_EXPIRED
        throw new TokenVerificationError('TOKEN_EXPIRED', 'Token has expired');
      }

      // Algorithm rejection (JOSEAlgNotAllowed — the RS256 pin refusing an
      // alg-confusion token) is deterministic: jose rejects the header before
      // any key resolution, so no key rotation can make the same token
      // verify. It must NOT reach the key-set refresh: jose rejects the
      // header before it resolves a key, so a refresh cannot make the same
      // token verify — and every junk-alg token that triggered one would
      // make every LEGITIMATE token pay a JWKS re-fetch.
      if (err.name === 'JOSEAlgNotAllowed') {
        throw new TokenVerificationError('TOKEN_INVALID', 'Token algorithm not allowed');
      }

      // The rejection names the underlying jose error: without it every
      // distinct cause (tampered signature, unknown key id, ambiguous key
      // set, wrong algorithm) reaches the operator's log as the same
      // 'Token verification failed'.
      if (err.refreshFloored) {
        // The refresh floor held the key-set refresh back. The realm may
        // ALREADY publish the key this token names — a rotation that landed
        // inside the window is observed by the next refresh, not by this
        // one. Saying so keeps a burst of 401s around a key rotation
        // distinguishable from a burst of junk tokens.
        logger.warn(
          `[KeycloakAuth] Token verification failed (${err.name}): key-set refresh floored — rotation recovery deferred to the next refresh`
        );
      } else {
        logger.warn(`[KeycloakAuth] Token verification failed (${err.name || 'Error'}): ${err.message}`);
      }

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

      // axios rejects non-2xx by default, so a resolved response is always
      // 2xx — a body is the active-user answer.
      if (response.data) {
        return { active: true, disabled: false };
      }

      // Unexpected response
      logger.warn(`[KeycloakAuth] Unexpected Keycloak UserInfo response: ${response.status}`);
      return null;
    } catch (error) {
      // 403 does NOT confirm a disable: Keycloak answers a disabled user 401
      // with the WWW-Authenticate challenge handled below, while a 403 means
      // the token was ACCEPTED but lacks the scopes/roles the UserInfo
      // endpoint requires (an active user) — and anything else on the path
      // (proxy, WAF, rate limiter) can answer 403 too. The middleware acts
      // destructively on a confirmed disable (soft-deletes the account), so
      // an uncorroborated 403 stays ambiguous, like an uncorroborated 401.
      if (error.response && error.response.status === 403) {
        logger.warn('[KeycloakAuth] Keycloak UserInfo returned 403 — ambiguous, treating as null');
        return null;
      }
      // 401 is ambiguous: an expired token and a disabled user both answer
      // 401. Act only when the challenge names the disable: WWW-Authenticate
      // carrying BOTH error="invalid_token" and error_description="User
      // disabled" is the confirmed-disable answer; anything else (expired
      // token, bad signature) stays ambiguous.
      if (error.response && error.response.status === 401) {
        const wwwAuthenticate = error.response.headers && error.response.headers['www-authenticate'];
        // Require BOTH the challenge code and the description: the
        // middleware acts destructively on a confirmed disable
        // (soft-deletes the account), so one fragment alone is not proof.
        const disabled =
          typeof wwwAuthenticate === 'string' &&
          /error="invalid_token"/i.test(wwwAuthenticate) &&
          /error_description="user disabled"/i.test(wwwAuthenticate);
        if (disabled) {
          return { active: false, disabled: true };
        }
        // Still ambiguous. When a WWW-Authenticate was present but named no
        // reason we act on, log it — the generic "may be expired" alone
        // would hide that the header simply did not match. Control
        // characters (C0, C1, Unicode line separators) stripped and the
        // value bounded: a challenge is server-controlled log input.
        const headerNote =
          typeof wwwAuthenticate === 'string'
            ? ` (WWW-Authenticate: ${wwwAuthenticate
                // Stripping control characters IS this regex's purpose.
                // eslint-disable-next-line no-control-regex
                .replace(/[\u0000-\u001F\u007F-\u009F\u2028\u2029]/g, '')
                .slice(0, 200)})`
            : '';
        logger.warn(`[KeycloakAuth] Keycloak UserInfo returned 401 — ambiguous, treating as null${headerNote}`);
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
   * @returns {Function} A callable JWKS function
   */
  createJwksCache,

  /**
   * Reset internal state. Only for testing.
   */
  _resetForTesting() {
    issuerMap.clear();
    initPromise = null;
    initFailedAt = 0;
    initFailureReason = null;
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
