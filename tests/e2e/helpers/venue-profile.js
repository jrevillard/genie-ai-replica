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
 * The OKF knob is read from the deployment's OWN runtime config
 * (`/runtime/config.js` → `window.APP_CONFIG.okfEnabled`), not from an env
 * var of the runner: the flag that decides whether the OKF surfaces render
 * is the one the frontend itself reads — and the rule this probe applies is
 * the FRONTEND's rule, arm for arm
 * (`components/gov-chat-frontend/src/utils/okfFlag.js`):
 *
 *   - no runtime config at all → ENABLED (the dev-build arm: the app
 *     renders the surfaces);
 *   - a config that carries `okfEnabled: '1'` → ENABLED (strict equality —
 *     a numeric 1 is a different writer and must not enable the Studio);
 *   - ANY other value, and a config with no `okfEnabled` key at all →
 *     DISABLED (fail closed: a typo must never silently enable the Studio).
 *
 * A probe that cannot READ the venue fails LOUDLY — an unreadable venue is
 * not an absent surface, and a skip built on a failed probe is exactly the
 * silent fallback the suite forbids. A probe result is cached per process;
 * a FAILED probe is not cached, so the next file reads the failure in its
 * own name instead of inheriting a cached error.
 *
 * The transport is the shared one (`helpers/auth.js`), read through the
 * module object so a unit spec can swap it — the pattern the sibling
 * helper specs use.
 */
const auth = require('./auth');
const { BASE_URL } = require('./chatbot');

const RUNTIME_CONFIG_PATH = '/runtime/config.js';

let okfCache = null;
const realmCache = new Map();
const identityProviderCache = new Map();

/**
 * Is the OKF pillar deployed on this venue, and what did the venue say?
 * @returns {Promise<{enabled: boolean, value: string}>} the verdict and the
 *   value the runtime config carries ('1', '0', an unrecognized value, or
 *   the empty string when the config carries no key at all)
 */
async function okfProfile() {
  if (okfCache !== null) return okfCache;
  const res = await auth.request('GET', RUNTIME_CONFIG_PATH, { raw: true });
  if (res.status === 404) {
    // No runtime config at all: the frontend's dev-build arm — the
    // surfaces render, so the specs run.
    okfCache = { enabled: true, value: '' };
    return okfCache;
  }
  if (res.status !== 200) {
    throw new Error(
      `the venue runtime config answered HTTP ${res.status} — the venue profile is UNKNOWN, ` +
        `which is not the same as "the OKF pillar is parked"`
    );
  }
  // The frontend compares the STRING it read: `cfg.okfEnabled === '1'`.
  // A config written by another writer — a bare `1`, a `true` — is not that
  // string, and the frontend reads it as parked. The probe therefore has to
  // tell a quoted string from a bare token, or it would enable the Studio
  // where the product keeps it dark.
  // The ASSIGNMENT, not the first mention of the key: a config whose
  // comment names the knob before the real assignment would be misread.
  const match = /(?:^|[{,\n])\s*okfEnabled\s*:\s*("([^"]*)"|'([^']*)'|([^"'\s,}]+))/m.exec(
    res.data || ''
  );
  let enabled = false;
  let value = '';
  if (match) {
    const quoted = match[2] !== undefined ? match[2] : match[3] !== undefined ? match[3] : null;
    if (quoted === null) {
      // A bare token: a different writer than the entrypoint's '1'.
      value = `${match[4]} (unquoted — the frontend reads it as parked)`;
    } else {
      value = quoted;
      enabled = quoted === '1';
    }
  }
  okfCache = { enabled, value };
  return okfCache;
}

/**
 * Is the OKF pillar deployed on this venue?
 * @returns {Promise<boolean>} true when the frontend would render the OKF
 *   surfaces
 */
async function okfEnabled() {
  return (await okfProfile()).enabled;
}

/**
 * The skip reason for a spec that drives an OKF surface on a venue whose
 * OKF pillar is parked. It names the profile the venue exposes, so the run
 * output says WHY the spec did not run.
 * @returns {Promise<string>} the reason
 */
async function okfParkedReason() {
  const { value } = await okfProfile();
  const what = value ? `okfEnabled=${value}` : 'the runtime config carries no okfEnabled knob';
  return (
    `venue profile: the OKF pillar is parked (${what} in ${BASE_URL}${RUNTIME_CONFIG_PATH}) — ` +
    'this spec drives an OKF surface, which a core-profile deployment does not render, ' +
    'and that surface is therefore NOT exercised by this run'
  );
}

/**
 * The venue's master-realm admin token — the one the runner supplies
 * (`ADMIN_TOKEN`) or the one minted from the admin password.
 * @returns {Promise<string>} the token
 */
async function adminToken() {
  return auth.getAdminToken();
}

/**
 * Does this realm exist on the venue?
 * @param {string} realm - the realm name
 * @returns {Promise<boolean>} true when the realm exists
 */
async function realmExists(realm) {
  if (realmCache.has(realm)) return realmCache.get(realm);
  const res = await auth.request('GET', `/auth/admin/realms/${encodeURIComponent(realm)}`, {
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
    'multi-realm surface, which a single-realm deployment does not answer, and that surface ' +
    'is therefore NOT exercised by this run'
  );
}

/**
 * Does this realm have an identity provider configured?
 * @param {string} realm - the realm to read
 * @returns {Promise<boolean>} true when at least one identity provider exists
 */
async function hasIdentityProvider(realm) {
  if (identityProviderCache.has(realm)) return identityProviderCache.get(realm);
  const res = await auth.request(
    'GET',
    `/auth/admin/realms/${encodeURIComponent(realm)}/identity-provider/instances`,
    { headers: { Authorization: `Bearer ${await adminToken()}` } }
  );
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
    'the external-IdP login surface, which a deployment without a broker does not render, and ' +
    'that surface is therefore NOT exercised by this run'
  );
}

module.exports = {
  okfEnabled,
  okfProfile,
  okfParkedReason,
  realmExists,
  missingRealmReason,
  hasIdentityProvider,
  missingIdentityProviderReason,
};
