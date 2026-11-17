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
const fs = require('fs');
const os = require('os');
const path = require('path');
const auth = require('./auth');
// The venue's edge from the credential-free module: import the module that
// defines what you use — the chat helper this used to import is a module
// this probe has no use for.
const { BASE_URL } = require('./base-url');
// The venue fixtures carry the admin credential the ingest canary logs in
// with (the source module, not the chat helper that re-exports it).
const { TEST_ADMIN_USER } = require('./e2e-fixtures');
// The documents-domain helpers the ingest canary drives over the venue's
// own HTTP contract: upload, ingest, the ingest wait and the per-file
// delete. The transport stays injectable in every one of them, so the unit
// spec scripts the whole canary conversation.
const { uploadFileViaApi, triggerIngestViaApi, waitForFileIngestedViaApi, sweepDeleteOneFile } = require('./documents');

const RUNTIME_CONFIG_PATH = '/runtime/config.js';

// The canary's identity, unique per PROCESS: the repository resolves an
// upload by its content, so two canaries with the same bytes and the same
// name are the SAME file — the second probe would wait on the first
// probe's file, which the first probe's cleanup already retracted. The id
// is an identity, never an asserted value (the same rule as the suite's
// unique seed names).
const CANARY_RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// The ingest canary's budget: the chain is ONE tiny chunk, so the budget
// covers queue + LLM labeling + embedding on a loaded shared venue, not a
// real document's ingest. Beyond it the chain is absent or wedged.
const INGEST_PROBE_BUDGET_MS = 180000;

// The evaluated `window.APP_CONFIG`, cached per process. `undefined` = not
// read yet; `null` = the venue carries no runtime config at all (the 404
// arm — the frontend's dev-build).
let runtimeConfigCache = undefined;
let okfCache = null;
const realmCache = new Map();
const identityProviderCache = new Map();
const translationCache = new Map();
let ingestChainCache = null;

/**
 * Read and evaluate the venue's runtime config (`/runtime/config.js`) — the
 * file the frontend evaluates at boot, shared by every probe that reads a
 * knob from it (the OKF pillar, the locale whitelist).
 *
 * The read is cached per process; a FAILED read is not cached, so the next
 * probe reads the failure in its own name. A probe that cannot read the
 * venue fails LOUDLY — an unreadable venue is not an absent surface.
 *
 * @returns {Promise<object|null>} the evaluated `window.APP_CONFIG`, or
 *   null when the venue serves no runtime config (404 — the dev-build arm)
 */
async function readRuntimeConfig() {
  if (runtimeConfigCache !== undefined) return runtimeConfigCache;
  const res = await auth.request('GET', RUNTIME_CONFIG_PATH, { raw: true });
  if (res.status === 404) {
    runtimeConfigCache = null;
    return null;
  }
  if (res.status !== 200) {
    throw new Error(
      `the venue runtime config answered HTTP ${res.status} — the venue profile is UNKNOWN, ` +
        `which is not the same as a parked deployment surface`
    );
  }
  // The frontend EVALUATES this file; a text probe that emulates evaluation
  // with a regex would misread every shape the entrypoint legitimately
  // writes (a comment naming the knob, a key it does not expect), and the
  // misread lands in the skip direction — invisible drift. So evaluate it,
  // in a sandbox where `window` is the only global, and hand the result to
  // the probe that asked — each applying the frontend's own rule.
  let config;
  try {
    config = vm.runInNewContext(`${res.data};\nwindow.APP_CONFIG`, { window: {} }, { timeout: 2000 });
  } catch (e) {
    throw new Error(
      `the venue runtime config could not be evaluated (${e.message.split('\n')[0]}) — ` +
        'the venue profile is UNKNOWN, which is not the same as a parked deployment surface',
      { cause: e }
    );
  }
  if (!config || typeof config !== 'object') {
    throw new Error('the venue runtime config leaves no window.APP_CONFIG — the venue profile is UNKNOWN');
  }
  runtimeConfigCache = config;
  return config;
}

/**
 * Is the OKF pillar deployed on this venue, and what did the venue say?
 * @returns {Promise<{enabled: boolean, value: string}>} the verdict and the
 *   value the runtime config carries, rendered exactly as the reason prints
 *   it (JSON: `"0"`, `1`, `""` — the empty string when the config carries no
 *   key at all)
 */
async function okfProfile() {
  if (okfCache !== null) return okfCache;
  const config = await readRuntimeConfig();
  if (config === null) {
    // No runtime config at all: the frontend's dev-build arm — the
    // surfaces render, so the specs run.
    okfCache = { enabled: true, value: '' };
    return okfCache;
  }
  // Strict equality, exactly like okfFlag.js: only the string '1' enables
  // the Studio; a numeric 1 is a different writer and must not enable it.
  okfCache = {
    enabled: config.okfEnabled === '1',
    value: config.okfEnabled === undefined ? '' : JSON.stringify(config.okfEnabled)
  };
  return okfCache;
}

/**
 * Is this locale in the deployment's active set — the whitelist the
 * frontend applies at boot (`i18n/whitelist.js`, fed from
 * `window.APP_CONFIG.availableLocales`)? A locale the whitelist excludes
 * falls back to 'en' at detection time: a spec pinning it would measure the
 * fallback's page and pass vacuously (the #1874/#1891 lesson), so the
 * exclusion is a venue fact this probe reads BEFORE the spec runs.
 *
 * @param {string} locale - the locale code to check (e.g. 'fr')
 * @returns {Promise<boolean>} true when the frontend would adopt the locale
 */
async function localeActive(locale) {
  const config = await readRuntimeConfig();
  if (config === null) return true; // the dev-build arm: no whitelist, every locale file active
  const raw = config.availableLocales;
  if (raw === undefined || raw === null || String(raw).trim() === '') return true;
  const whitelist = String(raw)
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (whitelist.length === 0) return true;
  return whitelist.includes(locale.toLowerCase());
}

/**
 * The skip reason for a spec that pins a locale the deployment's whitelist
 * excludes. It renders the whitelist exactly as the config carries it, so
 * the run output says WHY the locale cannot be adopted.
 * @param {string} locale - the locale the spec pins
 * @returns {Promise<string>} the reason
 */
async function missingLocaleReason(locale) {
  const config = await readRuntimeConfig();
  const what =
    config === null
      ? 'the venue serves no runtime config'
      : `availableLocales=${config.availableLocales === undefined ? '' : JSON.stringify(config.availableLocales)}`;
  return (
    `venue profile: the deployment's locale whitelist excludes '${locale}' (${what} in ` +
    `${BASE_URL}${RUNTIME_CONFIG_PATH}) — the frontend would fall back to 'en' at detection time, ` +
    'so this spec cannot pin the locale it asserts, and that surface is therefore NOT exercised ' +
    'by this run'
  );
}

/**
 * Does the venue's translation chain answer a fixed en→fr probe — the same
 * POST /api/translate call the answer translation serves? The session token
 * is minted through the browser login (the realm refuses direct grants, so
 * a master-admin token is the wrong issuer here) and cached per process.
 *
 * The verdict is cached per process; a FAILED probe (transport error, an
 * unreadable venue) is not cached — it throws, because an unreadable venue
 * is not an absent surface.
 *
 * @param {string} locale - the target language to probe (e.g. 'fr')
 * @returns {Promise<boolean>} true when the venue translated the probe text
 */
async function translatesTo(locale) {
  if (translationCache.has(locale)) return translationCache.get(locale);
  const token = await auth.getSessionTokenViaUI({ user: TEST_ADMIN_USER });
  // The smallest request the endpoint accepts: one fixed text, a fixed
  // source and the requested target. The TEXT is a fixture of this probe —
  // the verdict is about the endpoint's answer, never about the text.
  const res = await auth.request('POST', '/api/translate', {
    headers: { Authorization: `Bearer ${token}` },
    body: { texts: ['Hello'], source_lang: 'en', target_lang: locale }
  });
  if (res.status === 200) {
    translationCache.set(locale, true);
    return true;
  }
  if (res.status === 400 && res.data && res.data.error === 'UNSUPPORTED_LANGUAGE') {
    // The deployment's language map refuses this target: the typed refusal
    // IS the venue saying the language is absent.
    translationCache.set(locale, false);
    return false;
  }
  // Anything else (5xx, a proxy page, an empty body) is the venue failing
  // to answer a question it understood — that is an UNREADABLE venue, not
  // an absent surface: fail loudly, cache nothing.
  throw new Error(
    `the venue's translation endpoint answered HTTP ${res.status} for the en→${locale} probe — ` +
      'the venue profile is UNKNOWN, which is not the same as a missing translation chain'
  );
}

/**
 * The skip reason for a spec that drives the French streaming surface on a
 * venue whose translation chain cannot answer it.
 * @param {string} locale - the locale the spec pins
 * @returns {Promise<string>} the reason
 */
async function missingTranslationReason(locale) {
  return (
    `venue profile: the translation chain cannot answer en→${locale} (the POST /api/translate probe ` +
    'was refused with UNSUPPORTED_LANGUAGE) — the streamed translation this spec asserts has no ' +
    'backend on this venue, and that surface is therefore NOT exercised by this run'
  );
}

/**
 * Can this venue carry a document through the ingest chain — upload,
 * ClamAV scan, dataprep, and the status callback that lands 'Ingested'?
 *
 * The probe is BEHAVIORAL, because no HTTP surface declares the chain's
 * presence: it uploads its own tiny canary through the repository's upload
 * route, triggers the ingest, holds until the shared status vocabulary
 * reads 'ingested' (bounded), then retracts/deletes the canary. The verdict
 * (and the last status it observed on a miss) is cached per process — the
 * canary costs one real ingest, once per run, not once per spec.
 *
 * A venue that CANNOT read (the upload or the ingest call itself fails at
 * the transport or with a non-accepted status) is an UNREADABLE venue: the
 * probe throws — an unreadable venue is not an absent chain. A venue that
 * READS but never lands 'ingested' (the status expires the budget in
 * pending/ingesting, or lands 'ingestion error') is a venue whose chain is
 * absent or unhealthy: the verdict is false, with that status in the
 * reason.
 *
 * @returns {Promise<boolean>} true when the canary reached 'ingested'
 */
async function ingestChainReady() {
  if (ingestChainCache !== null) return ingestChainCache.ready;
  const token = await auth.getSessionTokenViaUI({ user: TEST_ADMIN_USER });
  const headers = { Authorization: `Bearer ${token}` };
  let fileId = null;
  let verdict = null;
  let probeError = null;
  // The canary's IDENTITY is unique per invocation: the same bytes under
  // the same name resolve to the SAME repository file (the content hash),
  // so a second canary would wait on the first canary's file — which the
  // first canary's cleanup already retracted, and the second would read
  // 'retracted' instead of its own ingest. A unique name AND unique bytes
  // give every probe its own file, and its own cleanup.
  const canaryName = `ingest-probe-canary-${CANARY_RUN_ID}.txt`;
  const canaryPath = path.join(os.tmpdir(), canaryName);
  try {
    fs.writeFileSync(canaryPath, `Ingest probe canary ${CANARY_RUN_ID} — one chunk of plain text.\n`);
    const record = await uploadFileViaApi(auth.request, token, canaryPath);
    fileId = record.file_id;
    await triggerIngestViaApi(auth.request, token, fileId);
    try {
      await waitForFileIngestedViaApi(auth.request, token, fileId, {
        timeoutMs: INGEST_PROBE_BUDGET_MS
      });
      verdict = { ready: true, lastStatus: 'ingested' };
    } catch (e) {
      // The wait names the miss (the expired budget's last status, or the
      // terminal 'ingestion error'); the verdict is false with that detail.
      verdict = { ready: false, lastStatus: e.message };
    }
  } catch (e) {
    // Kept for the cleanup below: an unreadable venue rethrows AFTER the
    // canary is gone, so a probe failure never leaves the canary behind.
    probeError = e;
  } finally {
    try {
      fs.unlinkSync(canaryPath);
    } catch {
      // The temp file is the runner's own scratch; a leftover in the
      // runner's tmp is not venue state and must not fail the probe.
    }
  }

  // The canary leaves no matter what the venue answered — a leftover canary
  // would pollute the venue's document list. When the id came back, one
  // sweep delete settles it; when the upload failed before its answer, the
  // file may still have been committed server-side, so the canary's unique
  // name is swept too. Cleanup failures are VISIBLE — they ride the reason
  // on a verdict, and they ride the thrown message on a probe failure —
  // but they never mask the probe's own answer.
  const cleanupFailures = [];
  let ids = fileId !== null ? [fileId] : [];
  if (fileId === null) {
    try {
      const searchRes = await auth.request('GET', `/api/files?limit=50&search=${encodeURIComponent(canaryName)}`, {
        headers
      });
      if (searchRes.status === 200 && Array.isArray(searchRes.data && searchRes.data.data)) {
        ids = searchRes.data.data.filter((f) => f.file_name === canaryName).map((f) => f.file_id);
      }
    } catch (e) {
      cleanupFailures.push(`the canary search failed: ${e.message}`);
    }
  }
  for (const id of ids) {
    try {
      const res = await auth.request('GET', `/api/files/${id}`, { headers });
      if (res.status === 200 && res.data && res.data.data) {
        // The record rides the response's `data` envelope; the sweep delete
        // keys on the record's own file_id.
        const failure = await sweepDeleteOneFile(auth.request, res.data.data, token);
        if (failure) cleanupFailures.push(failure);
      }
    } catch (e) {
      cleanupFailures.push(`the canary delete of ${id} failed: ${e.message}`);
    }
  }

  if (probeError !== null) {
    const note = cleanupFailures.length > 0 ? ` (canary cleanup also failed: ${cleanupFailures.join('; ')})` : '';
    throw new Error(`the ingest-chain probe could not read the venue: ${probeError.message}${note}`, {
      cause: probeError
    });
  }
  if (cleanupFailures.length > 0) {
    verdict = {
      ready: verdict.ready,
      lastStatus: `${verdict.lastStatus}; canary cleanup failed: ${cleanupFailures.join('; ')}`
    };
  }
  ingestChainCache = verdict;
  return verdict.ready;
}

/**
 * The skip reason for a spec that drives the ingest chain on a venue that
 * could not land the canary. It carries what the venue ACTUALLY did (the
 * canary's last observed status), not a guess.
 * @returns {Promise<string>} the reason
 */
async function ingestChainMissingReason() {
  const detail = ingestChainCache
    ? ingestChainCache.lastStatus
    : 'the probe has not run (it runs at the skip decision)';
  return (
    `venue profile: the ingest chain did not reach 'ingested' for the canary upload ` +
    `(${detail}) — the dataprep chain this spec drives is absent or unhealthy on this ` +
    'venue, and that surface is therefore NOT exercised by this run'
  );
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
 * Does this realm exist on the venue?
 * @param {string} realm - the realm name
 * @returns {Promise<boolean>} true when the realm exists
 */
async function realmExists(realm) {
  if (realmCache.has(realm)) return realmCache.get(realm);
  const res = await auth.request('GET', `/auth/admin/realms/${encodeURIComponent(realm)}`, {
    headers: { Authorization: `Bearer ${await auth.getAdminToken()}` }
  });
  if (res.status === 404) {
    realmCache.set(realm, false);
    return false;
  }
  if (res.status !== 200) {
    throw new Error(`the venue answered HTTP ${res.status} for realm "${realm}" — the venue profile is UNKNOWN`);
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
  const res = await auth.request('GET', `/auth/admin/realms/${encodeURIComponent(realm)}/identity-provider/instances`, {
    headers: { Authorization: `Bearer ${await auth.getAdminToken()}` }
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
    'docs/e2e-tests/suite-map.md § The acceptance phases were not run on this venue) — this spec drives ' +
    'the external-IdP login surface, which a deployment without a broker does not render, and ' +
    'that surface is therefore NOT exercised by this run'
  );
}

/**
 * Can a spec pin 'fr' AND have the venue translate into it — the two venue
 * facts the French streaming specs need? The locale must be in the
 * deployment's active set (a pin the frontend would silently fall back
 * from measures the wrong page), and the translation chain must answer
 * en→fr. Both halves are cached probes; the reason names the half that
 * failed.
 * @returns {Promise<boolean>} true when both venue facts hold
 */
async function frenchStreamingReady() {
  if (!(await localeActive('fr'))) return false;
  return translatesTo('fr');
}

/**
 * The skip reason for the French streaming surface, naming the half of the
 * premise the venue does not carry.
 * @returns {Promise<string>} the reason
 */
async function frenchStreamingMissingReason() {
  if (!(await localeActive('fr'))) return missingLocaleReason('fr');
  return missingTranslationReason('fr');
}

/**
 * The venue-skip hook, stated ONCE (#1773): the skip DECISION and its
 * reason, wired into one `test.skip(...)` call. A spec whose surface the
 * venue does not expose registers this as its beforeEach hook instead of
 * hand-writing the two-liner — a change to the skip protocol (a new probe
 * folded into the reason, a different hook form) then edits THIS block,
 * not 5-8 identical copies. The skip stays a per-test annotation: the
 * failure path reads `test.annotations` skip descriptions to print them.
 *
 * The `testApi` argument is the spec's own `test` object — passed
 * explicitly so the unit spec can observe the wiring with a fake.
 *
 * Registered as a spec's FIRST beforeAll, this hook is also the mint
 * guard: `test.skip()` inside a hook skips the whole group, and
 * Playwright does not run the hooks that follow a skipped hook (pinned
 * in venue-profile.spec.js) — so the guarded setup after it never runs
 * on a parked venue, and a skipped spec leaves no user behind.
 *
 * @param {object} testApi - the Playwright `test` object the spec uses
 * @param {Function} probe - the venue probe (`okfEnabled`, `realmExists`,
 *   `hasIdentityProvider`, or a closure over one); falsy = the venue
 *   lacks the surface
 * @param {Function} reason - the skip reason, called at hook time (sync
 *   or async); it lands on the tests as the skip annotation the failure
 *   path prints
 * @returns {Function} the hook (beforeEach or first beforeAll)
 */
function skipUnlessVenue(testApi, probe, reason) {
  return async () => {
    testApi.skip(!(await probe()), await reason());
  };
}

module.exports = {
  okfEnabled,
  okfParkedReason,
  localeActive,
  missingLocaleReason,
  translatesTo,
  missingTranslationReason,
  frenchStreamingReady,
  frenchStreamingMissingReason,
  ingestChainReady,
  ingestChainMissingReason,
  realmExists,
  missingRealmReason,
  hasIdentityProvider,
  missingIdentityProviderReason,
  skipUnlessVenue
};
