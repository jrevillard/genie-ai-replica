// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 6-1c — the GRANT/REVOKE facility, built for enterprise scale.
//
// TWO grant mechanisms, both consumed by the same enforcement (the token's
// okf-scopes list — middleware/auth.js merges all sources):
//   1. PER-USER attribute grants: `okf:{tenant}:{repo}:{level}` entries in
//      the user's okf_scopes attribute (the realm's existing user-attribute
//      protocol mapper ships them in the JWT). Auditable per user, visible
//      in the Keycloak admin console.
//   2. GROUP grants via ROLES NAMED AS SCOPE STRINGS: the facility creates
//      a realm role per (repo, level) — name == the scope string — and
//      assigns it to a GROUP; every member inherits it in
//      realm_access.roles at token mint (verified live on KC 26). One
//      operation scales to any member count; Keycloak manages bulk
//      membership natively.
//
// Holder enumeration is SERVER-SIDE: Keycloak attribute search
// (GET /users?q=okf_scopes:<scope>) and role-member endpoints
// (/roles/{name}/users, /roles/{name}/groups — colons in role names are
// legal path characters, sent RAW). The first cut listed the whole realm
// client-side with a 300-user cap — a prototype decision that does not
// survive enterprise scale and was replaced wholesale.
//
// Auth mode: the genie-proxy-client service account. okf-server gets its
// OWN credentials (KC_OKF_ACCESS_CLIENT_ID/SECRET): empty secret = the
// facility is UNCONFIGURED and the access routes answer 503 — enforcement
// (access-control-service) never needs Keycloak and keeps working.

const { logger } = require('../shared-lib/logger');

const KEYCLOAK_URL = process.env.KEYCLOAK_URL;
const KEYCLOAK_REALM = process.env.KEYCLOAK_REALM;
const CLIENT_ID = process.env.KC_OKF_ACCESS_CLIENT_ID || 'genie-proxy-client';
const CLIENT_SECRET = process.env.KC_OKF_ACCESS_CLIENT_SECRET || '';

const FETCH_TIMEOUT_MS = 10_000;
const USERS_PAGE = 100; // per-page ceiling for paginated user queries

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

async function jsonOrThrow(r, what) {
  if (!r.ok) {
    const text = await r.text();
    logger.error(`OKF access: ${what} failed`, { status: r.status, body: text.slice(0, 300) });
    throw Object.assign(new Error(`${what} failed: ${r.status}`), { statusCode: r.status === 404 ? 404 : 502 });
  }
  return r.status === 204 ? null : r.json();
}

/** Exact-username lookup → the Keycloak user representation (or null). */
async function findUserByUsername(username) {
  const users = await jsonOrThrow(
    await adminApi('GET', `/users?username=${encodeURIComponent(username)}&exact=true&max=2`),
    'user lookup'
  );
  return users.length === 1 ? users[0] : null;
}

/**
 * Users holding a specific scope entry, via SERVER-SIDE attribute search
 * (KC 19+ `?q=attr:value`; colon-laden values verified live on KC 26).
 * Paginated — no cap, no client-side realm listing.
 */
async function usersWithAttribute(scope) {
  const out = [];
  let first = 0;
  for (;;) {
    const page = await jsonOrThrow(
      await adminApi('GET', `/users?q=${encodeURIComponent(`okf_scopes:${scope}`)}&first=${first}&max=${USERS_PAGE}`),
      'attribute search'
    );
    out.push(...page);
    if (page.length < USERS_PAGE) return out;
    first += USERS_PAGE;
  }
}

/** Ensure a realm role NAMED as the scope string exists; return its full representation. */
async function ensureRole(scope) {
  try {
    return await jsonOrThrow(await adminApi('GET', `/roles/${scope}`), 'role fetch');
  } catch (err) {
    if (err.statusCode !== 404) throw err;
  }
  await jsonOrThrow(await adminApi('POST', '/roles', { name: scope }), 'role create');
  return jsonOrThrow(await adminApi('GET', `/roles/${scope}`), 'role fetch');
}

/** Find a top-level group by exact name (search is substring; match client-side). */
async function findGroupByName(name) {
  const groups = await jsonOrThrow(await adminApi('GET', `/groups?search=${encodeURIComponent(name)}&max=100`), 'group search');
  return groups.find((g) => g.name === name) || null;
}

/** Create the group if missing; return its representation. */
async function ensureGroup(name) {
  const existing = await findGroupByName(name);
  if (existing) return existing;
  await jsonOrThrow(await adminApi('POST', '/groups', { name }), 'group create');
  const created = await findGroupByName(name);
  if (!created) throw Object.assign(new Error('group create succeeded but group not found'), { statusCode: 502 });
  return created;
}

/**
 * Assign / remove a role on a group. The role-mappings endpoint needs the
 * FULL representation (id + name) — a name-only body 404s (verified live).
 */
async function setGroupRole(group, role, assign) {
  const verb = assign ? 'POST' : 'DELETE';
  await jsonOrThrow(
    await adminApi(verb, `/groups/${group.id}/role-mappings/realm`, [{ id: role.id, name: role.name }]),
    'group role mapping'
  );
}

/** Direct user members + groups holding the role (raw-colon paths — verified live). */
async function roleMembers(scope) {
  const users = await jsonOrThrow(await adminApi('GET', `/roles/${scope}/users?max=${USERS_PAGE}`), 'role users');
  let groups;
  try {
    groups = await jsonOrThrow(await adminApi('GET', `/roles/${scope}/groups?max=${USERS_PAGE}`), 'role groups');
  } catch (err) {
    if (err.statusCode !== 404) throw err;
    groups = [];
  }
  return { users, groups };
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
  usersWithAttribute,
  ensureRole,
  ensureGroup,
  findGroupByName,
  setGroupRole,
  roleMembers,
  userScopes,
  setUserScopes,
  _clearTokenCache() {
    cachedToken = null;
  }
};
