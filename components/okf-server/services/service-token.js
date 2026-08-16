// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Service-account token client (Story 2.9.1, AC 4). Mints a client_credentials
// bearer for the okf-server Keycloak client (provisioned by Story 6.1 with
// KC_OKF_SERVER_CLIENT_SECRET) so okf-server → document-repository HTTP calls
// authenticate (doc-repo requires a valid token on every route). Mirrors the
// proven dataprep pattern (genie-ai-overlay/dataprep/keycloak_service_account.py):
// cached with expiry + 30s buffer, single-flight refresh, clear errors.
// Token endpoint base precedence: KEYCLOAK_INTERNAL_URL (split-URL/local —
// container-reachable) → KEYCLOAK_PUBLIC_URL → KEYCLOAK_URL (cloud default).

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

function tokenEndpoint() {
  const base =
    process.env.KEYCLOAK_INTERNAL_URL ||
    process.env.KEYCLOAK_PUBLIC_URL ||
    process.env.KEYCLOAK_URL ||
    'http://keycloak:8080';
  return `${base.replace(/\/$/, '')}/realms/${KC_REALM()}/protocol/openid-connect/token`;
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
  const https = tokenEndpoint().startsWith('https');
  let resp;
  try {
    resp = await axios.post(tokenEndpoint(), body, {
      timeout: 10000,
      ...(https && (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0' || process.env.KEYCLOAK_SSL_SKIP_VERIFY === '1')
        ? { httpsAgent: new (require('https').Agent)({ rejectUnauthorized: false }) }
        : {})
    });
  } catch (err) {
    throw new Error(`Service-account token request failed: ${err.message}`, { cause: err });
  }
  const data = resp.data || {};
  if (!data.access_token) {
    throw new Error('Service-account token response missing access_token');
  }
  _cachedToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in || 300) * 1000;
  logger.info('okf-server service-account token minted', { client_id: CLIENT_ID(), expires_in: data.expires_in });
  return _cachedToken;
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
 * Bearer when configured; never throws on mint failure beyond axios's own
 * error (the caller decides retry policy). */
const authedAxios = {
  async get(url, opts = {}) {
    const token = await getServiceToken();
    return axios.get(url, {
      ...opts,
      headers: { ...(opts.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
  },
  async post(url, body, opts = {}) {
    const token = await getServiceToken();
    return axios.post(url, body, {
      ...opts,
      headers: { ...(opts.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }
    });
  }
};

/** Test hook: drop the cache. */
function _resetForTesting() {
  _cachedToken = null;
  _tokenExpiry = 0;
  _mintPromise = null;
  _warnedUnconfigured = false;
}

module.exports = { getServiceToken, authedAxios, tokenEndpoint, _resetForTesting };
