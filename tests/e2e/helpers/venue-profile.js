// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * The venue profile — what the deployment in front of the suite exposes.
 *
 * A spec that drives a SURFACE the deployment does not have must SKIP WITH A
 * REASON (#1742): not fail looking for a surface that never renders, and not
 * pass quietly. The profile answers "does this venue have it?"; the skip
 * reason answers "why not?".
 *
 * Two rules, both from the suite's own conventions (tests/e2e/CLAUDE.md):
 *
 *  - A probe that cannot READ the venue fails LOUDLY. An unreadable venue is
 *    not an absent surface — a skip built on a failed probe is exactly the
 *    silent fallback the suite forbids.
 *  - A probe result is cached per process, so a file's specs ask once. A
 *    FAILED probe is not cached: the next file must read the failure in its
 *    own name, not inherit a cached error.
 *
 * The OKF knob is read from the deployment's OWN runtime config
 * (`/runtime/config.js` → `window.APP_CONFIG.okfEnabled`), not from an env
 * var of the runner: the flag that decides whether the OKF surfaces render
 * is the one the frontend itself reads.
 */
const https = require('https');
const { BASE_URL } = require('./chatbot');
const { request, getAdminToken } = require('./auth');

const RUNTIME_CONFIG_PATH = '/runtime/config.js';

/** Raw GET against the venue edge. The venue serves a self-signed certificate. */
function getVenueText(path) {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BASE_URL);
    const req = https.request(
      {
        hostname: url.hostname,
        port: url.port || 443,
        path: url.pathname + url.search,
        method: 'GET',
        rejectUnauthorized: false,
        timeout: 30000,
        agent: false,
      },
      (res) => {
        let body = '';
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      }
    );
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error(`Request timed out after 30000ms: GET ${path}`)));
    req.end();
  });
}

let okfCache = null;
const realmCache = new Map();
const identityProviderCache = new Map();

/**
 * Is the OKF pillar deployed on this venue?
 * @returns {Promise<boolean>} true when the frontend is configured to render
 *   the OKF surfaces, false when the pillar is parked.
 */
async function okfEnabled() {
  if (okfCache !== null) return okfCache;
  const res = await getVenueText(RUNTIME_CONFIG_PATH);
  if (res.status !== 200) {
    throw new Error(
      `the venue runtime config answered HTTP ${res.status} — the venue profile is UNKNOWN, ` +
        `which is not the same as "the OKF pillar is parked"`
    );
  }
  // The frontend reads the flag strictly (=== '1' in
  // components/gov-chat-frontend/src/utils/okfFlag.js): anything else is off.
  const match = /okfEnabled:\s*["']?([^"'\s,}]+)/.exec(res.body);
  if (!match) {
    throw new Error(
      'the venue runtime config carries no okfEnabled knob — the venue profile is UNKNOWN, ' +
        'which is not the same as "the OKF pillar is parked"'
    );
  }
  okfCache = match[1] === '1';
  return okfCache;
}

/**
 * The skip reason for a spec that drives an OKF surface on a venue whose
 * OKF pillar is parked. It names the profile the venue exposes, so the run
 * output says WHY the spec did not run.
 * @returns {string} the reason
 */
function okfParkedReason() {
  return (
    `venue profile: the OKF pillar is parked (okfEnabled=0 in ${BASE_URL}${RUNTIME_CONFIG_PATH}) — ` +
    'this spec drives an OKF surface, which a core-profile deployment does not render'
  );
}

/**
 * The venue's master-realm admin token. Minted per call: an admin token is
 * short-lived, and a cached one would expire in the middle of a long run —
 * turning a profile read into a 401 nobody can explain.
 * @returns {Promise<string>} the token
 */
async function adminToken() {
  return getAdminToken();
}

/**
 * Does this realm exist on the venue?
 * @param {string} realm - the realm name
 * @returns {Promise<boolean>} true when the realm exists
 */
async function realmExists(realm) {
  if (realmCache.has(realm)) return realmCache.get(realm);
  const res = await request('GET', `/auth/admin/realms/${encodeURIComponent(realm)}`, {
    headers: { Authorization: `Bearer ${await adminToken()}` },
  });
  if (res.status === 404) {
    realmCache.set(realm, false);
    return false;
  }
  if (res.status !== 200) {
    throw new Error(
      `the venue answered HTTP ${res.status} for realm "${realm}" — the venue profile is UNKNOWN`
    );
  }
  realmCache.set(realm, true);
  return true;
}

/**
 * The skip reason for a spec that needs a realm the venue does not expose.
 * @param {string} realm - the realm the spec needs
 * @returns {string} the reason
 */
function missingRealmReason(realm) {
  return (
    `venue profile: the venue exposes no realm "${realm}" (Phase 0 step 0.6 — ` +
    `KEYCLOAK_ADDITIONAL_REALMS=${realm} — was not provisioned here) — this spec drives a ` +
    'multi-realm surface, which a single-realm deployment does not answer'
  );
}

/**
 * Does this realm have an identity provider configured?
 * @param {string} realm - the realm to read
 * @returns {Promise<boolean>} true when at least one identity provider exists
 */
async function hasIdentityProvider(realm) {
  if (identityProviderCache.has(realm)) return identityProviderCache.get(realm);
  const res = await request('GET', `/auth/admin/realms/${encodeURIComponent(realm)}/identity-provider/instances`, {
    headers: { Authorization: `Bearer ${await adminToken()}` },
  });
  if (res.status !== 200) {
    throw new Error(
      `the venue answered HTTP ${res.status} for the identity providers of realm "${realm}" — ` +
        'the venue profile is UNKNOWN'
    );
  }
  const configured = Array.isArray(res.data) && res.data.length > 0;
  identityProviderCache.set(realm, configured);
  return configured;
}

/**
 * The skip reason for a spec that needs a brokered identity provider the
 * venue does not expose.
 * @param {string} realm - the realm that should carry the provider
 * @returns {string} the reason
 */
function missingIdentityProviderReason(realm) {
  return (
    `venue profile: the realm "${realm}" carries no identity provider (Phase D steps 1-5 of ` +
    'docs/e2e-tests/epic1-keycloak-foundation.md were not run on this venue) — this spec drives ' +
    'the external-IdP login surface, which a deployment without a broker does not render'
  );
}

module.exports = {
  okfEnabled,
  okfParkedReason,
  realmExists,
  missingRealmReason,
  hasIdentityProvider,
  missingIdentityProviderReason,
};
