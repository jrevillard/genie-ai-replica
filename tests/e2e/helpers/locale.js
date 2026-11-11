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
    // Read the value back from the app's OWN origin — the probe page is
    // on it, and its localStorage is the storage the app reads at
    // document start.
    const stored = await probe.evaluate(() => window.localStorage.getItem('userLocale'));
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

module.exports = { pinLocale };
