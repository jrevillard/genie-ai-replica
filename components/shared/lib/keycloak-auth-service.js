// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// keycloak-auth-service.js — Shared OIDC token verifier (jose/JWKS) for all Node services.
// Issuer surface: the OIDC discovery issuer plus KEYCLOAK_PUBLIC_URL and
// KEYCLOAK_BROWSER_ISSUER aliases (split internal/public OIDC URLs), with
// KEYCLOAK_JWKS_URL as the JWKS fetch-host override, KEYCLOAK_DISCOVERY_URL
// as the discovery fetch-host override and KEYCLOAK_EXPECTED_ISSUER as a
// strict single-issuer pin.
'use strict';

const { jwtVerify, createRemoteJWKSet, decodeProtectedHeader } = require('jose');
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

// How long a rejected token's cause keeps its WARN slot (#1769).
//
// The token is caller-controlled and unauthenticated: a rejected token used
// to cost one WARN line, so a scanner posting garbage bearer tokens
// produced one log line per request — the same amplification class #1703
// was filed for on the JWKS-fetch side, moved from HTTP calls to log bytes.
// The cost lands on the log pipeline (the OTel collector -> VictoriaLogs
// leg) and on the operator: the auth log ends up dominated by client
// behaviour, and the interesting lines (a realm outage, a key rotation) are
// buried in it.
//
// The policy: the FIRST rejection of each distinct cause in a window is a
// WARN; the repeats are DEBUG (off at the default log level, so they cost
// nothing). The bucket is per ISSUER as well as per cause — a broken realm
// must not mute another realm's warnings.
const REJECTION_LOG_WINDOW_MS = 60000;

/**
 * The per-issuer, per-cause log buckets of the rejection policy.
 * Keyed by `${issuer} ${cause}` → { windowStart, suppressed }.
 */
const rejectionLogBuckets = new Map();

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
 * check with a key set jose itself would refuse (a key whose `ext` is not
 * a boolean, a key_ops list that repeats an operation) would be answered
 * 503 instead of 401.
 */
function keySetHasUsableKey(jwks) {
  if (!jwks || !Array.isArray(jwks.keys)) return true;
  return jwks.keys.some(isUsableSigningKey);
}

/**
 * Could this published key verify an RS256 signature?
 *
 * The same RS256-only filter `keySetHasUsableKey` applies — deliberately
 * LOOSER than jose's own candidate filter (see that docstring): it ignores
 * jose's `ext` check and its key_ops uniqueness/type strictness, so it
 * never refuses a published key jose would accept.
 *
 * @param {Object|undefined} jwk - A published key
 * @returns {boolean} True when the key could verify an RS256 signature
 */
function isUsableSigningKey(jwk) {
  return Boolean(
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
 * Would a DEBUG line be written at all?
 *
 * The logger is the shared winston one, but a consumer's test double may
 * not implement the level check — and a rejected token must never fail on
 * the way to its log line.
 *
 * @returns {boolean} True when a DEBUG line may be written — the level check
 *   answers when the logger has one; when it has none, the logger is asked
 *   to log and its transport decides whether the line is written.
 */
function debugEnabled() {
  if (typeof logger.isDebugEnabled === 'function') return logger.isDebugEnabled();
  // A logger that cannot answer is asked to log: the transport decides
  // whether the line is written (production is winston, which filters on
  // level; only a consumer's test double lands here). Skipping the call
  // instead would silently swallow the line for every such consumer.
  return typeof logger.debug === 'function';
}

/**
 * Log a rejected token without letting the caller turn the log into a flood.
 *
 * The first rejection of each distinct cause in a window is a WARN; the
 * repeats are DEBUG, and the next WARN says how many were suppressed. The
 * cause has its own bucket — the "key-set refresh floored" line keeps a WARN
 * slot of its own, because a rotation losing one refresh is a service-side
 * event, not client noise, and must stay visible at WARN.
 *
 * @param {string} issuer - The issuer the token named (the bucket is per issuer)
 * @param {string} cause - The distinct cause of the rejection (the bucket is per cause)
 * @param {Function} buildLine - Builds the log line. It is a thunk because
 *   the line is only built when it is actually written: at the default log
 *   level the repeats are dropped by the logger, and building their text
 *   anyway would leave the per-request cost this policy removes.
 */
function logRejection(issuer, cause, buildLine) {
  const key = `${issuer} ${cause}`;
  const now = Date.now();
  const bucket = rejectionLogBuckets.get(key);
  if (!bucket || now - bucket.windowStart >= REJECTION_LOG_WINDOW_MS) {
    const suppressed = bucket ? bucket.suppressed : 0;
    rejectionLogBuckets.set(key, { windowStart: now, suppressed: 0 });
    const tail =
      suppressed > 0
        ? ` — ${suppressed} further rejection(s) with this cause were suppressed since the last warning`
        : '';
    logger.warn(`${buildLine()}${tail}`);
  } else {
    bucket.suppressed += 1;
    if (debugEnabled()) {
      logger.debug(buildLine());
    }
  }
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

// How many published candidate keys the kid-less token trial tries (#1767).
// The candidate count is the REALM's (Keycloak keeps retired keys published),
// so the trial is bounded rather than exhaustive: a realm publishing more
// candidates than this is a realm to clean up, not a token to guess at. The
// truncation is logged with that reason, and the token is still rejected as
// invalid — the log names the realm's key set, the client still gets its 401.
const MAX_CANDIDATE_KEYS = 3;

/**
 * Does the token name NO key id?
 *
 * RFC 7515 §4.1.4 makes the key id optional, and the candidate trial
 * resolves ONLY a token that names none. The answer is read from the
 * token's own protected header — the header the token carries, not the one
 * the key resolver reports — so it does not depend on how that resolver
 * classified the request. A header that cannot be read counts as naming a
 * key id: the answer fails closed, and no trial runs.
 *
 * The header is decoded by jose's own decoder — the same one that read it
 * to decide the token's fate, so the two cannot disagree on what the
 * header says.
 *
 * @param {string} token - The raw JWT
 * @returns {boolean} True when the token names no key id at all
 */
function tokenNamesNoKeyId(token) {
  try {
    const header = decodeProtectedHeader(token);
    return !Object.prototype.hasOwnProperty.call(header, 'kid');
  } catch {
    return false;
  }
}

/**
 * Try the published candidate keys of an ambiguous token (#1767).
 *
 * RFC 7515 §4.1.4 makes the key id OPTIONAL: a token that names none
 * against a multi-key set is not a bad token, it is a token jose cannot
 * resolve by key id alone. jose hands the candidates over with the error;
 * this tries them, at most MAX_CANDIDATE_KEYS of them, and the first one
 * whose signature verifies wins.
 *
 * Only a SIGNATURE failure moves on to the next candidate: a claim failure
 * (expired, wrong issuer, wrong audience) is the token's own defect, and no
 * other key can repair it.
 *
 * @param {Error} err - The JWKSMultipleMatchingKeys error (it carries the candidates)
 * @param {string} token - The raw JWT
 * @param {Object} jwtOptions - The same verification options the first attempt used
 * @returns {Promise<Object>} `{ ok, payload, error, truncated }` — `error`
 *   is the failure that decides the rejection (the last signature failure, or
 *   the token's own defect), `truncated` says the realm published more
 *   candidates than the trial may try.
 */
async function tryCandidateKeys(err, token, jwtOptions) {
  const failure = { ok: false, payload: null, error: null, truncated: false };
  if (!err || typeof err[Symbol.asyncIterator] !== 'function') return failure;

  let lastError = null;
  let tried = 0;
  for await (const candidate of err) {
    if (tried >= MAX_CANDIDATE_KEYS) {
      // More candidates than the trial may try: the token is NOT resolved by
      // guessing — the realm's key set is too wide to pick from.
      return { ...failure, error: lastError, truncated: true };
    }
    tried += 1;
    try {
      const { payload } = await jwtVerify(token, candidate, jwtOptions);
      return { ok: true, payload, error: null, truncated: false };
    } catch (candidateError) {
      if (candidateError.name !== 'JWSSignatureVerificationFailed') {
        // The token's own defect (expiry, claims, algorithm) — no other
        // candidate can repair it.
        return { ...failure, error: candidateError };
      }
      lastError = candidateError;
    }
  }
  return { ...failure, error: lastError };
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
 * @returns {Function} A callable JWKS function
 *
 * The returned function has signature (protectedHeader, token) -> Promise<Key>
 * compatible with jose's jwtVerify(token, jwksFunction, options).
 *
 * @example
 * const jwksCache = createJwksCache('http://keycloak/realms/genie/protocol/openid-connect/certs');
 * const { payload } = await jwtVerify(token, jwksCache, { issuer: 'http://keycloak/realms/genie' });
 */
function createJwksCache(jwksUri) {
  const inner = createRemoteJWKSet(new URL(jwksUri), {
    cacheMaxAge: JWKS_CACHE_TTL,
    cooldownDuration: JWKS_REFRESH_COOLDOWN_MS
  });

  /**
   * JWKS function compatible with jose's jwtVerify
   * @param {Object} protectedHeader - JWT protected header
   * @param {Object} token - The JWS (its `header` holds the unprotected header)
   * @returns {Promise<Key>} Cryptographic key
   */
  async function jwksFn(protectedHeader, token) {
    // A key id that is not a string is a MALFORMED token, and the verifier
    // refuses it BEFORE jose sees it. RFC 7515 §4.1.4 types the key id as a
    // string, so a realm never issues such a token — and jose's own builds
    // disagree on what one means: the older ones match EVERY published key
    // when the key id is not a string (so a realm publishing a single
    // signing key resolves the token without the verifier ever seeing an
    // error), the newer one matches NONE. Deciding here makes the answer
    // the same on every service: a token the realm never issued does not
    // authenticate.
    if (protectedHeader && Object.prototype.hasOwnProperty.call(protectedHeader, 'kid')) {
      if (typeof protectedHeader.kid !== 'string') {
        const malformed = new Error('the token names a key id that is not a string');
        // The name is the verifier's own, not jose's vocabulary: a future
        // jose could claim `JWTInvalidKeyId` for something else.
        malformed.name = 'MalformedKeyId';
        throw malformed;
      }
    }
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
        // jose answered from the cached set instead of re-fetching it: the
        // realm may ALREADY publish the key this token names, and the next
        // refresh observes it. The flag travels with the error so the
        // caller can say so in the log. It is set on EVERY call — a stale
        // flag from an earlier rejection would misreport this one.
        err.refreshFloored = coolingDown;
        throw err;
      }
      if (err && err.name === 'JWKSMultipleMatchingKeys') {
        // jose raises this when a key resolves to MORE THAN ONE candidate.
        // Two different faults land here, and the token's own key id tells
        // them apart: a token that names a key id (the realm published that
        // id more than once — an outage, #1776) and a token that names none
        // (the published candidates can resolve it — #1767).
        const kid = protectedHeader && protectedHeader.kid;
        if (kid !== undefined) {
          // jose matches the candidates by that EXACT key id, so more than
          // one candidate means the realm published that key id more than
          // once — the realm's own broken state, the same class as a realm
          // publishing no usable key at all, and the same answer: an
          // outage, so the operator is told instead of every user being
          // signed out by a 401 they cannot act on (#1776). jose matched the
          // candidates by that EXACT key id, so the ambiguity IS the
          // proof: the published key set is not read, and nothing the
          // realm publishes can make this verdict a 401 instead.
          throw new TokenVerificationError(
            'AUTH_SERVICE_UNAVAILABLE',
            'Authentication service is temporarily unavailable (the realm published more than one signing key under one key id)'
          );
        }
        // The token names NO key id: RFC 7515 §4.1.4 makes the key id
        // OPTIONAL, so the ambiguity is the token's, and the published
        // candidates can resolve it. The error carries them; the caller
        // tries them (#1767). ONLY a kid-less ambiguity reaches the caller
        // — the named-kid case above is answered here, and a key id that is
        // not a string is refused before jose sees it, so the trial can
        // never resolve a token naming a duplicated key id.
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
  // ONE key set per issuer, never recreated (#1778): an issuer that is
  // already registered KEEPS its key set — a re-init must not throw away
  // the cached keys, and the refresh floor that goes with them. (A changed
  // certificates URL is a deployment change: the process restarts.)
  const registeredJwks = issuerMap.get(pinnedIssuer || doc.issuer);
  const effectiveJwks =
    registeredJwks || (jwksOverride ? createJwksCache(jwksOverride) : createJwksCache(doc.jwks_uri));

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

    // Opt-in audience binding (RFC 8707): when the caller supplies
    // an `audience`, jose additionally validates the token's `aud` claim.
    // Omitted → no audience check (the historical resource-server behavior —
    // see the azp note below; pinned by keycloak-auth-service.audience.test.js).
    // The options are built once and shared with the candidate trial, so
    // both attempts verify the token under the SAME contract.
    const jwtOptions = {
      issuer: unverifiedIss,
      algorithms: ['RS256'],
      requiredClaims: ['iss', 'exp']
    };
    if (opts && opts.audience) {
      jwtOptions.audience = opts.audience;
    }

    // The key-set refresh is jose's own: a token naming a key id the realm
    // does not publish makes jose re-read the key set (once per cooldown
    // window per issuer) and resolve the token against the fresh set. The
    // verifier does not retry on its own — a second attempt would double
    // the realm's fetch rate for no gain.

    // The verified result is the claims payload plus the iss_sub composite
    // key consumers key users/cache entries on.
    const toResult = (payload) => ({ ...payload, iss_sub: `${payload.iss}#${payload.sub}` });

    try {
      // One verification, one set of options: the key-set refresh is jose's
      // own (it re-reads the key set inside this call), so there is no
      // second attempt to make.
      const { payload: verifiedPayload } = await jwtVerify(token, jwks, jwtOptions);

      // Note: we do NOT validate azp (authorized party). Any client within
      // the trusted realm that obtains a valid token should be accepted by
      // this resource server — this is standard OIDC Resource Server behavior.
      // The token's signature, issuer, and expiration are already verified above.
      const result = toResult(verifiedPayload);

      if (debugEnabled()) {
        logger.debug(`[KeycloakAuth] Token verified for ${result.iss_sub}`);
      }
      return result;
    } catch (err) {
      // TokenVerificationError is re-thrown as-is
      if (err instanceof TokenVerificationError) {
        throw err;
      }

      // The token named NO key id against a multi-key set: RFC 7515 §4.1.4
      // makes the key id OPTIONAL, so the ambiguity is the token's, and the
      // published candidates can resolve it. The trial is bounded (a hard
      // cap), and only a signature failure moves on to the next candidate —
      // a claim failure is the token's own defect whatever key it names.
      let failure = err;
      // The trial costs one signature verification per candidate, so it
      // never runs for a token that cannot be valid anyway. Two cases, both
      // decided from the unverified payload (jose checks the signature
      // BEFORE the claims, so the manual check is what keeps a junk token
      // from costing a verification):
      //   - an expired token — jose's own test is `exp <= now` (no clock
      //     tolerance here), so the same comparison is used here;
      //   - a token whose expiry jose will refuse anyway — jose requires
      //     the `exp` claim (`requiredClaims`) and refuses one that is not
      //     a number, so such a token is invalid whatever key signs it.
      const exp = typeof unverifiedExp === 'number' ? unverifiedExp : null;
      const expired = exp !== null && exp <= Math.floor(Date.now() / 1000);
      // The trial applies ONLY to a token that names NO key id, and the
      // CALLER decides that — from the token's own header, not from how the
      // key resolver classified the request. The resolver answers the
      // named-kid case itself (the realm's outage, #1776) and refuses a key
      // id that is not a string BEFORE it can classify one, so its
      // kid-less branch is reached only for a header with no `kid` property
      // — the same answer the caller computes from the token.
      if (err.name === 'JWKSMultipleMatchingKeys' && tokenNamesNoKeyId(token)) {
        if (exp === null) {
          // The token's own defect, and the one jose would report: an
          // expiry that is not a number. Decided here so the trial spends
          // no signature verification on a token that cannot be accepted
          // whatever key signs it. It is a claim failure, like every other
          // claim failure, and is reported as one.
          throw new TokenVerificationError('TOKEN_INVALID', 'Token verification failed');
        }
        if (!expired) {
          const trial = await tryCandidateKeys(err, token, jwtOptions);
          if (trial.ok) {
            const result = toResult(trial.payload);
            if (debugEnabled()) {
              logger.debug(`[KeycloakAuth] Token verified against a published candidate key for ${result.iss_sub}`);
            }
            return result;
          }
          if (trial.truncated) {
            // The realm published more candidates than the trial may try:
            // the token is not resolved by guessing, and the operator is told
            // why. This line IS the explanation — the generic rejection line
            // below would only repeat it.
            logRejection(
              unverifiedIss,
              `${err.name}:trial-truncated`,
              () =>
                `[KeycloakAuth] Token verification failed (JWKSMultipleMatchingKeys): the realm published more candidate keys than the trial cap (${MAX_CANDIDATE_KEYS} tried) — the token could not be resolved`
            );
            throw new TokenVerificationError('TOKEN_INVALID', 'Token verification failed');
          }
          failure = trial.error || err;
        }
      }

      // JWTExpired → immediate TOKEN_EXPIRED (no refresh attempt)
      if (failure.name === 'JWTExpired') {
        throw new TokenVerificationError('TOKEN_EXPIRED', 'Token has expired');
      }

      // JWTClaimValidationFailed → TOKEN_INVALID (claim issues are NOT key rotation problems)
      if (failure.name === 'JWTClaimValidationFailed') {
        if (failure.claim === 'iss') {
          throw new TokenVerificationError('TOKEN_INVALID', 'Token issuer validation failed');
        }
        if (failure.claim === 'aud') {
          throw new TokenVerificationError('TOKEN_INVALID', 'Token audience validation failed');
        }
        throw new TokenVerificationError('TOKEN_INVALID', 'Token verification failed');
      }

      // Generic Error (signature failure or unknown kid) → check exp
      // jose checks signature BEFORE claims, so we must manually check exp from unverified payload.
      // Expiry outranks an algorithm mismatch: a stale junk token reports
      // TOKEN_EXPIRED (the semantically leading defect, and the client
      // action — re-authenticate — is the same either way).
      if (expired) {
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
      if (failure.name === 'JOSEAlgNotAllowed') {
        throw new TokenVerificationError('TOKEN_INVALID', 'Token algorithm not allowed');
      }

      // The rejection names the underlying jose error: without it every
      // distinct cause (tampered signature, unknown key id, ambiguous key
      // set, wrong algorithm) reaches the operator's log as the same
      // 'Token verification failed'. The line is rate-limited per issuer and
      // per cause: a rejected token is caller-controlled, so one WARN per
      // rejection is a flood the caller can produce (#1769).
      if (failure.refreshFloored) {
        // The refresh floor held the key-set refresh back. The realm may
        // ALREADY publish the key this token names — a rotation that landed
        // inside the window is observed by the next refresh, not by this
        // one. Saying so keeps a burst of 401s around a key rotation
        // distinguishable from a burst of junk tokens. It keeps a WARN slot
        // of its own: the rotation losing a refresh is a service-side
        // event, not client noise.
        logRejection(
          unverifiedIss,
          `${failure.name}:refresh-floored`,
          () =>
            `[KeycloakAuth] Token verification failed (${failure.name}): key-set refresh floored — rotation recovery deferred to the next refresh`
        );
      } else {
        logRejection(
          unverifiedIss,
          failure.name || 'Error',
          () => `[KeycloakAuth] Token verification failed (${failure.name || 'Error'}): ${failure.message}`
        );
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
        // Rate-limited like the rejection line: this diagnostic answers once
        // per REJECTED token (the caller asks Keycloak whether the user
        // behind a rejected token was disabled), so a flood of garbage
        // tokens would otherwise produce one line per request (#1769).
        logRejection(
          issuer,
          'UserInfo 403 (ambiguous)',
          () => '[KeycloakAuth] Keycloak UserInfo returned 403 — ambiguous, treating as null'
        );
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
        // Rate-limited like the rejection line: this diagnostic answers once
        // per REJECTED token, so a flood of garbage tokens would otherwise
        // produce one line per request (#1769). The challenge is sanitized
        // INSIDE the thunk, so the work is only done when the line is
        // actually written.
        logRejection(issuer, 'UserInfo 401 (ambiguous)', () => {
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
          return `[KeycloakAuth] Keycloak UserInfo returned 401 — ambiguous, treating as null${headerNote}`;
        });
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
   * Reset internal state. Only for testing.
   */
  _resetForTesting() {
    issuerMap.clear();
    initPromise = null;
    initFailedAt = 0;
    initFailureReason = null;
    initialized = false;
    rejectionLogBuckets.clear();
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
