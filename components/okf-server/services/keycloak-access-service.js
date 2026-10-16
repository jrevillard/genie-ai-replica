// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 6-1c — the GRANT/REVOKE facility: writes `okf_scopes` user
// attributes through the Keycloak Admin API so granted scopes ride the
// caller's JWT on next login (the realm's existing user-attribute protocol
// mapper on the genie-app client — configs/keycloak/genie-realm.yaml — mints
// the claim; no realm change needed).
//
// Auth mode: the genie-proxy-client service account (the same delegated
// user-management client the BFF uses, KEYCLOAK_PROXY_*). okf-server gets its
// OWN credentials (KC_OKF_ACCESS_CLIENT_ID/SECRET): empty secret = the
// facility is UNCONFIGURED and the access routes answer 503 — enforcement
// (access-control-service) never needs Keycloak and keeps working.

const { logger } = require('../shared-lib/logger');

const KEYCLOAK_URL = process.env.KEYCLOAK_URL;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM;
const CLIENT_ID = process.env.KC_OKF_ACCESS_CLIENT_ID || 'genie-proxy-client';
const CLIENT_SECRET = process.env.KC_OKF_ACCESS_CLIENT_SECRET || '';

const FETCH_TIMEOUT_MS = 10_000;
const LIST_MAX = 300; // realm users pulled to compute holders (bounded)

let cachedToken = null;

function isConfigured() {
  return Boolean(KEYCLOAK_URL && KEYCLOAK_REALM && CLIENT_ID && CLIENT_SECRET);
}

async function getServiceAccountToken(forceRefresh = false) {
  if (cachedToken && !forceRefresh) return cachedToken;
  const response = await fetch(`${KEYCLOAK_URL}/realms/${KEYCLOAK_REALM}/protocol/openid-connect/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: CLIENT_ID,
      client_secret: CLIENT_SECRET
    }),
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  });
  if (!response.ok) {
    const text = await response.text();
    logger.error('OKF access: service account token failed', { status: response.status, body: text.slice(0, 300) });
    throw Object.assign(new Error(`service account token failed: ${response.status}`), { statusCode: 502 });
  }
  const data = await response.json();
  cachedToken = data.access_token;
  return cachedToken;
}

async function adminApi(method, path, body = null, retried = false) {
  const token = await getServiceAccountToken();
  const options = {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(FETCH_TIMEOUT_MS)
  };
  if (body !== null) options.body = JSON.stringify(body);
  const response = await fetch(`${KEYCLOAK_URL}/admin/realms/${KEYCLOAK_REALM}${path}`, options);
  // Token expiry between calls — one refresh retry.
  if (response.status === 401 && !retried) {
    cachedToken = null;
    return adminApi(method, path, body, true);
  }
  return response;
}

/** Exact-username lookup → the Keycloak user representation (or null). */
async function findUserByUsername(username) {
  const r = await adminApi('GET', `/users?username=${encodeURIComponent(username)}&exact=true&max=2`);
  if (!r.ok) {
    throw Object.assign(new Error(`user lookup failed: ${r.status}`), { statusCode: 502 });
  }
  const users = await r.json();
  return users.length === 1 ? users[0] : null;
}

/** All enabled realm users carrying their attributes (bounded by LIST_MAX). */
async function listUsersWithScopes() {
  const r = await adminApi('GET', `/users?max=${LIST_MAX}&briefRepresentation=false`);
  if (!r.ok) {
    throw Object.assign(new Error(`user list failed: ${r.status}`), { statusCode: 502 });
  }
  return r.json();
}

/** Read a user's okf_scopes attribute (always an array). */
function userScopes(user) {
  const raw = user && user.attributes && user.attributes.okf_scopes;
  return Array.isArray(raw) ? raw.filter((s) => typeof s === 'string') : [];
}

/** Write the user's okf_scopes attribute (merge-preserving other attributes). */
async function setUserScopes(user, scopes) {
  const attributes = { ...(user.attributes || {}), okf_scopes: [...new Set(scopes)] };
  const r = await adminApi('PUT', `/users/${user.id}`, { ...user, attributes });
  if (!r.ok && r.status !== 204) {
    const text = await r.text();
    logger.error('OKF access: user attribute write failed', { status: r.status, body: text.slice(0, 300) });
    throw Object.assign(new Error(`user attribute write failed: ${r.status}`), { statusCode: 502 });
  }
}

module.exports = {
  isConfigured,
  findUserByUsername,
  listUsersWithScopes,
  userScopes,
  setUserScopes,
  _clearTokenCache() {
    cachedToken = null;
  }
};
