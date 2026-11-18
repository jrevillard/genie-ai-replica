// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Pin the UI locale for a spec that asserts on rendered copy.
//
// The app resolves its locale from localStorage.userLocale first, then
// navigator.language, then 'en' (utils/localeDetection.js). A spec that
// asserts English sentences therefore passes or fails depending on the
// BROWSER's language — the two RAGAS guide specs did exactly that, and
// would have started failing the moment a runner's locale changed.
//
// This pins it before any page script runs.
//
// The write happens in an init script, and an init script cannot fail a
// test by itself: Chromium SWALLOWS an exception thrown there — it
// surfaces no page error to the runner at all. A storage that refuses
// the write would therefore leave the app on navigator.language, and the
// spec would assert locale behaviour it never pinned — a mismatch
// nothing attributes. So the pin is PROVEN, not assumed: a probe page
// loads the edge with the init script in place, and the stored value is
// read back from the app's own storage. A pin that did not land fails
// the spec here, before its first assertion can misattribute the cause.

const { expect } = require('@playwright/test');
const { BASE_URL } = require('./chatbot');

// A small static file on the edge's origin. The probe only needs a
// DOCUMENT on the app's origin — the init script runs on it and writes
// the pin there — so the cheapest document on that origin is the right
// one: booting the SPA for a single localStorage key would spend the
// app's whole bundle (and an identity-provider redirect) to read a value
// the app reads at document start.
const PROBE_PATH = '/config/genie-ai-config.json';

/**
 * Force the app's locale to English for this browser context.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} [locale] the locale code to pin (default 'en')
 */
async function pinLocale(context, locale = 'en') {
  await context.addInitScript((loc) => {
    // An OPAQUE origin has no storage to pin: the initial about:blank
    // document of every page (and any sandboxed frame) is one, and
    // touching its localStorage throws a SecurityError that says
    // nothing about the app's own origin. A real origin's refusal is a
    // different thing — it is the failure the proof below reports.
    if (window.location.origin === 'null') return;
    window.localStorage.setItem('userLocale', loc);
  }, locale);

  const probe = await context.newPage();
  try {
    try {
      // 'domcontentloaded', not 'commit': the init script runs when the
      // document is created, so the read below must not race it.
      await probe.goto(`${BASE_URL}${PROBE_PATH}`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    } catch (e) {
      // The edge did not answer the probe. Say so — a raw navigation
      // timeout would send the reader to the edge instead of to the pin.
      throw new Error(
        `the locale pin could not be proven — the edge did not answer ${BASE_URL}${PROBE_PATH}: ${e.message}`,
        { cause: e }
      );
    }
    // The read must cover the APP's origin: the init script writes
    // `userLocale` on EVERY origin the context visits, so a probe served
    // from another one (a redirect to a CDN) would read that origin's
    // storage and prove nothing about the app's.
    const appOrigin = new URL(BASE_URL).origin;
    const probeOrigin = new URL(probe.url()).origin;
    if (probeOrigin !== appOrigin) {
      throw new Error(
        `the locale pin could not be proven — the probe landed on ${probeOrigin}, not the app's ` +
          `origin ${appOrigin}, and the init script writes on every origin the context visits`
      );
    }

    // Read the value back from the app's own storage — the one the app
    // reads at document start. A storage that refuses the read is a
    // failed proof, not a raw driver error: the message names it.
    let stored;
    try {
      stored = await probe.evaluate(() => window.localStorage.getItem('userLocale'));
    } catch (e) {
      throw new Error(
        `the locale pin could not be proven — the storage of ${appOrigin} could not be read: ${e.message}`,
        { cause: e }
      );
    }
    if (stored !== locale) {
      throw new Error(
        `the locale pin did not land — localStorage.userLocale is ` +
          `${stored == null ? 'absent' : `'${stored}'`} on ${BASE_URL}. A storage that ` +
          `refuses the write leaves the app on navigator.language, and the spec would assert ` +
          `locale behaviour it never pinned.`
      );
    }
  } finally {
    await probe.close();
  }
}

// The ready beforeEach for a fixture-page spec that asserts English copy:
// ONE spelling of "pin before the first navigation" — the spec-specific
// WHY lives in the comment beside each hook. Specs that make their own
// context call pinLocale directly (the RAGAS spelling).
const pinEnglish = async ({ page }) => {
  await pinLocale(page.context(), 'en');
};

/**
 * The locale the APP adopted — the language it booted with, read off
 * `<html lang>` (the attribute main.js writes with the resolved locale).
 *
 * ONE home for the read: the pin lives here, so the read of what the pin
 * produced lives here too, and every reader (the specs' assertion, the
 * venue profile's adoption probe) sees the same signal.
 *
 * @param {import('@playwright/test').Page} page - the page to read from
 * @returns {Promise<string>} the adopted locale code ('' when the page
 *   carries no attribute)
 */
async function readAdoptedLocale(page) {
  return page.evaluate(() => document.documentElement.lang || '');
}

// The locale sweeps' premise, asserted once per session: the app ADOPTED the
// seeded locale. main.js's detectInitialLocale silently falls back to 'en'
// when the saved locale is not in the deployment's active set (the
// VUE_APP_AVAILABLE_LOCALES whitelist), and every measurement of a session
// that fell back reads the fallback locale's page and passes vacuously
// (the vacuous pass #1874 closed for welcome-banner; #1891 extends the pin
// to every locale-sweeping spec). main.js writes the adopted locale to
// <html lang> at boot, so that attribute is the pin — one home beside
// pinLocale (pin the seed, prove the seed, prove the adoption — one
// concern), before anything is measured.
async function assertAdoptedLocale(page, where, locale) {
  const adopted = await readAdoptedLocale(page);
  expect(
    adopted,
    `${where}: <html lang> reads '${adopted}', not the seeded '${locale}' — ` +
      `every measurement in this session is the fallback's and passes vacuously`
  ).toBe(locale);
}

module.exports = { pinLocale, pinEnglish, assertAdoptedLocale, readAdoptedLocale };
