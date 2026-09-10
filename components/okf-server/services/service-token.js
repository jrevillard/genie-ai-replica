// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Service-account token client (Story 2.9.1, AC 4). Mints a client_credentials
// bearer for the okf-server Keycloak client (provisioned by Story 6.1 with
// KC_OKF_SERVER_CLIENT_SECRET) so okf-server → document-repository HTTP calls
// authenticate (doc-repo requires a valid token on every route). Mirrors the
// proven dataprep pattern (genie-ai-overlay/dataprep/keycloak_service_account.py):
// cached with expiry + 30s buffer, single-flight refresh, clear errors.
// Token endpoint base precedence: KEYCLOAK_INTERNAL_URL (split-URL/local —
// container-reachable) → KEYCLOAK_URL → KEYCLOAK_PUBLIC_URL (browser-facing
// alias — LAST, never first: a service-account mint is server-to-server and
// the public alias is routinely unreachable from inside the container).
// MINTING FAILOVERS across every candidate (live-caught 2026-09-01: with only
// the public https://localhost/auth reachable-from-a-browser, the mint died
// with "socket disconnected before secure TLS" and the ingest worker could
// not drain at all — the winner is cached so refreshes skip dead endpoints).

const axios = require('axios');
const { logger } = require('../shared-lib/logger');

const BUFFER_SECONDS = 30;

// Lazy env reads (test-friendly: env may be set after module load).
const KC_REALM = () => process.env.KEYCLOAK_REALM || 'genie';
const CLIENT_ID = () => process.env.KC_OKF_SERVER_CLIENT_ID || 'okf-server';
const CLIENT_SECRET = () => process.env.KC_OKF_SERVER_CLIENT_SECRET || '';

let _cachedToken = null;
let _tokenExpiry = 0;
let _mintPromise = null;
let _warnedUnconfigured = false;
let _tokenEndpoint = null; // the endpoint that last minted successfully (failover memory)

function tokenEndpointCandidates() {
  const bases = [
    process.env.KEYCLOAK_INTERNAL_URL,
    process.env.KEYCLOAK_URL,
    process.env.KEYCLOAK_PUBLIC_URL,
    'http://keycloak:8080'
  ];
  const unique = [...new Set(bases.filter(Boolean).map((b) => b.replace(/\/$/, '')))];
  return unique.map((base) => `${base}/realms/${KC_REALM()}/protocol/openid-connect/token`);
}

function tokenEndpoint() {
  // Documented precedence (first candidate); mintToken failovers across all.
  return tokenEndpointCandidates()[0];
}

/** True when the client credentials env is absent — calls proceed WITHOUT a
 * token (doc-repo will 401); a loud one-time warning names the env vars. */
function isUnconfigured() {
  if (!CLIENT_SECRET()) {
    if (!_warnedUnconfigured) {
      _warnedUnconfigured = true;
      logger.warn(
        'KC_OKF_SERVER_CLIENT_SECRET is not set — okf-server → document-repository calls will be UNAUTHENTICATED and rejected (401). Set KC_OKF_SERVER_CLIENT_ID/SECRET (the okf-server Keycloak client from Story 6.1).'
      );
    }
    return true;
  }
  return false;
}

async function mintToken() {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: CLIENT_ID(),
    client_secret: CLIENT_SECRET()
  });
  // Try the last-known-good endpoint FIRST (if any), then the candidates in
  // precedence order. Every failure is COLLECTED into the thrown message —
  // the Winston console formatter strips metadata fields, so the diagnosis
  // must be self-describing (live-caught: a bare "token request failed" hid
  // WHICH endpoint was unreachable for a day).
  const candidates = [...new Set([_tokenEndpoint, ...tokenEndpointCandidates()].filter(Boolean))];
  const failures = [];
  for (const endpoint of candidates) {
    const https = endpoint.startsWith('https');
    try {
      const resp = await axios.post(endpoint, body, {
        timeout: 5000,
        ...(https && (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || process.env.KEYCLOAK_SSL_SKIP_VERIFY === '1')
          ? { httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }) }
          : {})
      });
      const data = resp.data || {};
      if (!data.access_token) {
        throw new Error('response missing access_token');
      }
      _cachedToken = data.access_token;
      _tokenExpiry = Date.now() + (data.expires_in || 300) * 1000;
      _tokenEndpoint = endpoint;
      logger.info('okf-server service-account token minted', {
        client_id: CLIENT_ID(),
        expires_in: data.expires_in,
        endpoint
      });
      return _cachedToken;
    } catch (err) {
      failures.push(`${endpoint} (${err.message})`);
    }
  }
  throw new Error(`Service-account token request failed for ${failures.length} endpoint(s): ${failures.join('; ')}`);
}

/**
 * Get a valid service-account token (cached; single-flight refresh).
 * @returns {Promise<string|null>} null when unconfigured (caller proceeds unauthenticated).
 */
async function getServiceToken() {
  if (isUnconfigured()) return null;
  if (_cachedToken && Date.now() < _tokenExpiry - BUFFER_SECONDS * 1000) return _cachedToken;
  if (!_mintPromise) {
    _mintPromise = mintToken().finally(() => {
      _mintPromise = null;
    });
  }
  return _mintPromise;
}

/** Authenticated axios surface for okf-server → doc-repo HTTP. Injects the
 * Bearer when configured. A 401 from doc-repo (stale cached token — e.g.
 * Keycloak restarted) resets the cache, re-mints, and retries ONCE; a second
 * 401 propagates (the caller decides retry policy). */
function withAuth(token, opts) {
  return { ...opts, headers: { ...(opts.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) } };
}
function isUnauthorized(err) {
  return Boolean(err && err.response && err.response.status === 401);
}
const authedAxios = {
  async get(url, opts = {}) {
    const token = await getServiceToken();
    try {
      return await axios.get(url, withAuth(token, opts));
    } catch (err) {
      if (!isUnauthorized(err)) throw err;
      _clearTokenCache();
      return axios.get(url, withAuth(await getServiceToken(), opts));
    }
  },
  async post(url, body, opts = {}) {
    const token = await getServiceToken();
    try {
      return await axios.post(url, body, withAuth(token, opts));
    } catch (err) {
      if (!isUnauthorized(err)) throw err;
      _clearTokenCache();
      return axios.post(url, body, withAuth(await getServiceToken(), opts));
    }
  },
  async patch(url, body, opts = {}) {
    // Story 4.8-amend (bundle state machine): the internal controller PATCHes
    // the bundle zip's doc-repo status (Pending → Ingesting → Ingested|Error).
    // Same 401-retry shape as get/post.
    const token = await getServiceToken();
    try {
      return await axios.patch(url, body, withAuth(token, opts));
    } catch (err) {
      if (!isUnauthorized(err)) throw err;
      _clearTokenCache();
      return axios.patch(url, body, withAuth(await getServiceToken(), opts));
    }
  },
  async delete(url, opts = {}) {
    // Story #978 lifecycle: publish SUPERSEDES the previous bundle zip — the
    // stale artifact is deleted from doc-repo (one live bundle per repo).
    // Same 401-retry shape as get/post.
    const token = await getServiceToken();
    try {
      return await axios.delete(url, withAuth(token, opts));
    } catch (err) {
      if (!isUnauthorized(err)) throw err;
      _clearTokenCache();
      return axios.delete(url, withAuth(await getServiceToken(), opts));
    }
  }
};

/** Drop the cached token (401-retry path: the cached token was rejected). */
function _clearTokenCache() {
  _cachedToken = null;
  _tokenExpiry = 0;
}

/** Test hook: drop the cache. */
function _resetForTesting() {
  _clearTokenCache();
  _mintPromise = null;
  _warnedUnconfigured = false;
  _tokenEndpoint = null;
}

module.exports = { getServiceToken, authedAxios, tokenEndpoint, _resetForTesting };
