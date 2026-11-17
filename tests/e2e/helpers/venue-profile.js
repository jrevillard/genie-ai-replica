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
// delete. They are required INSIDE the canary, not here: the documents
// helper imports the frontend's ES-module status vocabulary and names the
// Node floor that bridge needs AT LOAD TIME. A module-scope import here
// would put that floor on EVERY consumer of the venue profile — the OKF,
// auth and theme specs that never touch the documents domain would fail
// to LOAD on an older runner instead of skipping.

const RUNTIME_CONFIG_PATH = '/runtime/config.js';

// The canary's identity, unique per PROCESS. The repository mints a FRESH
// file id per upload (it stores a content hash and never looks one up), so
// two canaries are two files — but the FILE LIST carries both, and a
// caller that picks "the row with this name" would then read the older
// one, whose cleanup had already retracted it. A unique name keeps every
// canary's row unambiguous. The id is an identity, never an asserted value
// (the same rule as the suite's unique seed names).
const CANARY_RUN_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

// The ingest canary's budget: the chain is ONE tiny chunk, so the budget
// covers queue + LLM labeling + embedding on a loaded shared venue, not a
// real document's ingest. Beyond it the chain is absent or wedged.
//
// 180 s, not less: the budget separates "the venue has no ingest chain"
// (a skip) from "the venue's chain is slow" (a red), and a budget that
// tight turns a loaded shared venue into a silent coverage loss — the
// group's whole subject would be skipped with a reason that reads like an
// absent feature.
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

// The venue sessions the probes opened, cached per locale: each carries the
// realm token and the locale the app ADOPTED in that session.
//
// The token is BOUNDED, and the bound is the point: a realm access token
// lives 300 s (KEYCLOAK_ACCESS_TOKEN_LIFESPAN), and Playwright runs the
// whole suite in ONE worker process — so a token cached for the run would
// be handed to a probe minutes later, already expired, and the probe
// would read the 401 as an unreadable venue instead of an absent surface.
// A session older than this bound is re-opened.
//
// The bound assumes the SHIPPED 300 s lifespan. A deployment running a
// shorter one has to lower it — the hole is narrowed, not closed.
const SESSION_MAX_AGE_MS = 120000;
const sessionCache = new Map();

// The canary's text — the ONE place it lives. The probe copies these bytes
// under the canary's own name (the name is unique per process, the bytes
// are shared), so the fixture the unit spec reads and the file the venue
// ingests cannot drift apart.
const CANARY_FIXTURE_PATH = path.join(__dirname, '..', 'fixtures', 'ingest-probe-canary.md');

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
 * The rule is the frontend's, arm for arm: the whitelist is applied to the
 * build's locale FILES, and 'en' is ALWAYS retained so vue-i18n's
 * fallbackLocale can resolve — a whitelist that does not name 'en' still
 * leaves 'en' active, and a probe that said otherwise would skip the
 * default locale on a venue that serves it perfectly well.
 *
 * The FILES are the other half of the rule, and the venue does not publish
 * them: `localeAdopted` is the probe that sees them, by booting the app.
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
  const code = locale.toLowerCase();
  // 'en' is always retained — the frontend's own rule, arm for arm.
  if (code === 'en') return true;
  return whitelist.includes(code);
}

/**
 * Open (or reuse) one venue session and report what it saw.
 *
 * The session boots the app on `locale` and reads back the locale the app
 * ADOPTED (`<html lang>`), next to the realm token it carries. Both come
 * from one login: the token is what the probes call the venue with, and
 * the adopted locale is what proves the deployment can serve it.
 *
 * The session's OWN age is what the cache is bounded by (the session says
 * when it was opened), not the age of the cache entry.
 *
 * @param {string} locale - the locale the session boots with
 * @returns {Promise<{token: string, adopted: string, at: number}>} the session
 */
async function venueSession(locale) {
  const hit = sessionCache.get(locale);
  if (hit !== undefined && Date.now() - hit.at < SESSION_MAX_AGE_MS) return hit;
  const seen = await auth.openVenueSession({ user: TEST_ADMIN_USER, locale });
  const session = {
    token: seen.token,
    adopted: String(seen.adopted || ''),
    at: typeof seen.at === 'number' ? seen.at : Date.now()
  };
  sessionCache.set(locale, session);
  return session;
}

/**
 * Does the APP adopt this locale — the deployment's whitelist is only half
 * of the frontend's rule, and the other half (the build's locale files) is
 * not published by the venue: a deployment whose whitelist names a locale
 * its build does not carry falls back to 'en' at boot, and a spec pinning
 * that locale would measure the fallback's page.
 *
 * The probe boots the app on the locale and reads the adopted language off
 * `<html lang>` — the app's own answer, the same signal the specs assert.
 *
 * @param {string} locale - the locale code to check (e.g. 'fr')
 * @returns {Promise<boolean>} true when the app booted on that locale
 */
async function localeAdopted(locale) {
  const session = await venueSession(locale);
  return session.adopted.toLowerCase() === locale.toLowerCase();
}

/**
 * The admin session token the probes call the venue with.
 *
 * The session is cached per locale and BOUNDED (see SESSION_MAX_AGE_MS): a
 * realm access token lives 300 s, and the suite runs in one worker process
 * for the whole run — an unbounded cache would hand an expired token to a
 * probe minutes later, and the probe would read the 401 as an unreadable
 * venue instead of an absent surface.
 *
 * @returns {Promise<string>} the realm-scoped bearer token
 */
async function adminSessionToken() {
  return (await venueSession('en')).token;
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
 * translator the answer translation serves? The chat path resolves the SAME
 * translator this probe exercises (the backend's `translationService`
 * prepares it for the requested language pair and refuses the ones its map
 * does not carry), so a refusal here is the refusal the chat path would
 * answer, and a translation here is a translation the chat path can make.
 *
 * The verdict is cached per process; a FAILED probe (transport error, an
 * unreadable venue) is not cached — it throws, because an unreadable venue
 * is not an absent surface.
 *
 * @param {string} locale - the target language to probe (e.g. 'fr')
 * @returns {Promise<boolean>} true when the venue translated the probe text
 */
async function translatesTo(locale) {
  if (translationCache.has(locale)) return translationCache.get(locale).verdict;
  const token = await adminSessionToken();
  // The smallest request the endpoint accepts: one fixed text, a fixed
  // source and the requested target. The TEXT is a fixture of this probe —
  // the verdict is about the endpoint's answer, never about the text.
  const SOURCE = 'Hello';
  const res = await auth.request('POST', '/api/translate', {
    headers: { Authorization: `Bearer ${token}` },
    body: { texts: [SOURCE], source_lang: 'en', target_lang: locale }
  });
  if (res.status === 200) {
    // A 200 alone is not a translation: the body carries the answer, and an
    // answer that is the source text unchanged is a chain that echoed the
    // input. The verdict is about the TRANSLATION, so the body is read —
    // and the CAUSE travels with it, because the skip reason has to name
    // what the venue DID, not a guess at why.
    const translated = Array.isArray(res.data && res.data.translated_texts) ? res.data.translated_texts[0] : undefined;
    if (typeof translated !== 'string' || translated.trim() === '') {
      translationCache.set(locale, {
        verdict: false,
        cause: 'the probe was answered 200 with no translated text'
      });
      return false;
    }
    if (translated.trim() === SOURCE) {
      translationCache.set(locale, {
        verdict: false,
        cause: 'the probe was answered 200 with the source text unchanged'
      });
      return false;
    }
    translationCache.set(locale, { verdict: true, cause: 'the probe was answered with a translation' });
    return true;
  }
  if (res.status === 400 && res.data && res.data.error === 'UNSUPPORTED_LANGUAGE') {
    // The deployment's language map refuses this target: the typed refusal
    // IS the venue saying the language is absent.
    translationCache.set(locale, {
      verdict: false,
      cause: 'the probe was refused with UNSUPPORTED_LANGUAGE'
    });
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
  // The cause the probe OBSERVED, not the one this function would have
  // guessed: a venue whose translator answers 200 with the English text is
  // not a venue whose language map refused the language, and the operator
  // reads the difference.
  const observed = translationCache.get(locale);
  const cause = observed ? observed.cause : 'the probe has not run (it runs at the skip decision)';
  return (
    `venue profile: the translation chain cannot answer en→${locale} (${cause}) — the translation ` +
    'this spec asserts has no backend on this venue, and that surface is therefore NOT exercised ' +
    'by this run'
  );
}

/**
 * Can this venue carry a document through the ingest chain — upload,
 * ClamAV scan, dataprep, and the status callback that lands 'Ingested'?
 *
 * The probe is BEHAVIORAL, because no HTTP surface declares the chain's
 * presence: it uploads its own tiny canary through the repository's upload
 * route, triggers the ingest, holds until the shared status vocabulary
 * reads an ingested status (bounded), then retracts/deletes the canary.
 *
 * The verdict (and the last status it observed on a miss) is cached per
 * PROCESS, and the suite runs in ONE worker process — so a run pays ONE
 * canary ingest, not one per spec file. The session token is cached with
 * it: the mint is the probe's slowest leg.
 *
 * A venue that CANNOT read (the upload or the ingest call itself fails at
 * the transport or with a non-accepted status) is an UNREADABLE venue: the
 * probe throws — an unreadable venue is not an absent chain. A venue that
 * READS but never lands an ingested status (the status expires the budget
 * in pending/ingesting, or lands 'ingestion error') is a venue whose chain
 * is absent or unhealthy: the verdict is false, with that status in the
 * reason.
 *
 * @returns {Promise<boolean>} true when the canary reached an ingested status
 */
async function ingestChainReady() {
  if (ingestChainCache !== null) return ingestChainCache.ready;
  // The documents-domain helpers are required HERE, not at module scope:
  // they import the frontend's ES-module status vocabulary, which names the
  // Node floor it needs at load time — and only the canary drives that
  // domain. A module-scope import would put that floor on every consumer
  // of the venue profile, including the specs that never touch it.
  const {
    uploadFileViaApi,
    triggerIngestViaApi,
    waitForFileIngestedViaApi,
    sweepDeleteOneFile
  } = require('./documents');
  const token = await adminSessionToken();
  let fileId = null;
  let verdict = null;
  let probeError = null;
  // The canary's NAME is unique per process: the repository mints a fresh
  // file id per upload (it stores a content hash and never looks one up),
  // so two canaries are two files — but the FILE LIST carries both, and a
  // caller that picks "the row with this name" would then read the older
  // one, whose cleanup had already retracted it. The unique name keeps
  // every canary's row unambiguous.
  //
  // Its extension is MARKDOWN, and it matters: the dataprep routes the
  // docling-supported extensions to docling, and docling does not accept
  // plain text — a .txt canary fails with 'File format not allowed' at
  // chunking, so the probe would read a broken ingest as an absent chain
  // and skip every spec that needs one. The .md canary is ingested for
  // real.
  const canaryName = `ingest-probe-canary-${CANARY_RUN_ID}.md`;
  // The canary's path is a plain template, not a path.join: the
  // config-validator's variable-anchor policy (#1393) accepts a join only
  // when it is anchored on a same-file __dirname initializer, and the
  // runner's temp directory is neither.
  const canaryPath = `${os.tmpdir()}/${canaryName}`;
  try {
    // The canary's TEXT lives in the fixture, and the fixture is the ONE
    // place it lives: the probe writes those bytes under the canary's own
    // name, so the unit spec's sample file and the live probe can never
    // drift apart.
    fs.writeFileSync(canaryPath, fs.readFileSync(CANARY_FIXTURE_PATH, 'utf8'));
    const record = await uploadFileViaApi(auth.request, token, canaryPath);
    fileId = record.file_id;
    await triggerIngestViaApi(auth.request, token, fileId);
    try {
      const ingested = await waitForFileIngestedViaApi(auth.request, token, fileId, {
        timeoutMs: INGEST_PROBE_BUDGET_MS,
        // The probe asks "does this venue's chain work?" — a degraded but
        // INDEXED ingest ('ingested with warnings') is a working chain, and
        // refusing it would turn a healthy-enough venue into a skip.
        accept: ['ingested', 'ingested with warnings']
      });
      // The status the canary ACTUALLY landed on, not a hardcoded 'ingested':
      // the probe accepts two statuses, and the reason it reports must name
      // the one the venue answered with.
      verdict = {
        ready: true,
        lastStatus: (ingested.dataprep && ingested.dataprep.status) || 'ingested'
      };
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
  // name is swept too. A cleanup that FAILS is thrown, not folded into the
  // verdict: a canary left in the venue's corpus can be retrieved by the
  // next run's question, and a run that cannot clean up after itself must
  // not certify that the chain is ready.
  // The verdict is cached BEFORE the cleanup: the cleanup must not make the
  // next spec file run the whole canary again (a second real ingest, and a
  // second canary document the venue would have to carry).
  ingestChainCache = verdict;

  // The cleanup runs on a session of its OWN: the canary's own token is as
  // old as the wait that just ended (up to the probe's budget), and a realm
  // token lives 300 s — a cleanup on an expired token would fail on the
  // venue's 401 and read as a venue that cannot delete a document.
  const cleanupToken = await adminSessionToken();
  const cleanupHeaders = { Authorization: `Bearer ${cleanupToken}` };
  const cleanupFailures = [];
  let ids = fileId !== null ? [fileId] : [];
  if (fileId === null) {
    try {
      const searchRes = await auth.request('GET', `/api/files?limit=50&search=${encodeURIComponent(canaryName)}`, {
        headers: cleanupHeaders
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
      const res = await auth.request('GET', `/api/files/${id}`, { headers: cleanupHeaders });
      if (res.status === 200 && res.data && res.data.data) {
        // The record rides the response's `data` envelope; the sweep delete
        // keys on the record's own file_id.
        const failure = await sweepDeleteOneFile(auth.request, res.data.data, cleanupToken);
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
    // A canary that could not be removed stays in the venue's document list
    // — and the venue's corpus is what the chat answers from, so a leftover
    // is not a harmless leftover: it can be retrieved by the next run's
    // question. The probe therefore FAILS on it, on both paths: the
    // cleanup is this run's own artifact, and a run that cannot clean up
    // after itself has no business deciding that the chain is ready.
    throw new Error(
      `the ingest canary's cleanup failed — the venue keeps a canary document: ${cleanupFailures.join('; ')}`
    );
  }
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
 * Can a spec pin 'fr' AND have the venue translate into it — the three venue
 * facts the French streaming specs need? The locale must be in the
 * deployment's active set (a pin the frontend would silently fall back
 * from measures the wrong page), the APP must adopt it (the whitelist is
 * only half of the frontend's rule — the build's locale files are the other
 * half, and a build without them falls back to 'en' at boot), and the
 * translation chain must answer en→fr with a TRANSLATED text. Every half
 * is a cached probe; the reason names the half that failed.
 * @returns {Promise<boolean>} true when every venue fact holds
 */
async function frenchStreamingReady() {
  if (!(await localeActive('fr'))) return false;
  if (!(await localeAdopted('fr'))) return false;
  return translatesTo('fr');
}

/**
 * The skip reason for the French streaming surface, naming the half of the
 * premise the venue does not carry.
 * @returns {Promise<string>} the reason
 */
async function frenchStreamingMissingReason() {
  if (!(await localeActive('fr'))) return missingLocaleReason('fr');
  if (!(await localeAdopted('fr'))) {
    const adopted = sessionCache.get('fr');
    return (
      "venue profile: the app does not adopt the locale 'fr' (it booted on " +
      `'${adopted ? adopted.adopted : 'unknown'}') — the frontend fell back to English at boot, so ` +
      "every measurement of a French session would read the fallback (the deployment's whitelist " +
      'names the locale, so the most likely cause is a build that carries no locale file for it), ' +
      'and this surface is therefore NOT exercised by this run'
    );
  }
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
  localeAdopted,
  missingLocaleReason,
  translatesTo,
  missingTranslationReason,
  frenchStreamingReady,
  frenchStreamingMissingReason,
  ingestChainReady,
  ingestChainMissingReason,
  INGEST_PROBE_BUDGET_MS,
  realmExists,
  missingRealmReason,
  hasIdentityProvider,
  missingIdentityProviderReason,
  skipUnlessVenue
};
