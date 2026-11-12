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
 * The config is EVALUATED, not parsed: the frontend evaluates it, and a
 * reader that emulates evaluation with a regex drifts in the skip
 * direction — invisible.
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
const vm = require('vm');
const auth = require('./auth');
// The venue's edge from the credential-free module: import the module that
// defines what you use — the chat helper this used to import is a module
// this probe has no use for.
const { BASE_URL } = require('./base-url');

const RUNTIME_CONFIG_PATH = '/runtime/config.js';

let okfCache = null;
const realmCache = new Map();
const identityProviderCache = new Map();

/**
 * Is the OKF pillar deployed on this venue, and what did the venue say?
 * @returns {Promise<{enabled: boolean, value: string}>} the verdict and the
 *   value the runtime config carries, rendered exactly as the reason prints
 *   it (JSON: `"0"`, `1`, `""` — the empty string when the config carries no
 *   key at all)
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
  // The frontend EVALUATES this file; a text probe that emulates evaluation
  // with a regex would misread every shape the entrypoint legitimately
  // writes (a comment naming the knob, a key it does not expect), and the
  // misread lands in the skip direction — invisible drift. So evaluate it,
  // in a sandbox where `window` is the only global, and apply the
  // frontend's own strict rule to what comes out.
  let config;
  try {
    config = vm.runInNewContext(`${res.data};\nwindow.APP_CONFIG`, { window: {} }, { timeout: 2000 });
  } catch (e) {
    throw new Error(
      `the venue runtime config could not be evaluated (${e.message.split('\n')[0]}) — ` +
        'the venue profile is UNKNOWN, which is not the same as "the OKF pillar is parked"',
      { cause: e }
    );
  }
  if (!config || typeof config !== 'object') {
    throw new Error(
      'the venue runtime config leaves no window.APP_CONFIG — the venue profile is UNKNOWN'
    );
  }
  // Strict equality, exactly like okfFlag.js: only the string '1' enables
  // the Studio; a numeric 1 is a different writer and must not enable it.
  okfCache = {
    enabled: config.okfEnabled === '1',
    value: config.okfEnabled === undefined ? '' : JSON.stringify(config.okfEnabled),
  };
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
  const what = value
    ? `okfEnabled=${value}`
    : 'the runtime config carries no okfEnabled knob';
  return (
    `venue profile: the OKF pillar is parked (${what} in ${BASE_URL}${RUNTIME_CONFIG_PATH}) — ` +
    'this spec drives an OKF surface, which a core-profile deployment does not render, ' +
    'and that surface is therefore NOT exercised by this run'
  );
}

/**
 * Does this realm exist on the venue?
 * @param {string} realm - the realm name
 * @returns {Promise<boolean>} true when the realm exists
 */
async function realmExists(realm) {
  if (realmCache.has(realm)) return realmCache.get(realm);
  const res = await auth.request('GET', `/auth/admin/realms/${encodeURIComponent(realm)}`, {
    headers: { Authorization: `Bearer ${await auth.getAdminToken()}` },
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
    { headers: { Authorization: `Bearer ${await auth.getAdminToken()}` } }
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
  okfParkedReason,
  realmExists,
  missingRealmReason,
  hasIdentityProvider,
  missingIdentityProviderReason,
};
