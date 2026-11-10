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
// The write happens in an init script, and an init script has no way to
// fail a test by itself: an exception there is only a page error, and
// the suite does not fail on page errors. A storage that refuses the
// write would therefore leave the app on navigator.language, and the
// spec would assert locale behaviour it never pinned — a mismatch
// nothing attributes. So the pin is PROVEN, not assumed: a probe page
// loads the edge with the init script in place and the stored value is
// read back from the context's storage. A pin that did not land fails
// the spec here, before its first assertion can misattribute the cause.

const { BASE_URL } = require('./chatbot');

/**
 * Force the app's locale to English for this browser context.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} [locale] the locale code to pin (default 'en')
 */
async function pinLocale(context, locale = 'en') {
  await context.addInitScript((loc) => {
    window.localStorage.setItem('userLocale', loc);
  }, locale);

  const probe = await context.newPage();
  try {
    await probe.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
    const stored = await readPinnedLocale(context);
    if (stored !== locale) {
      throw new Error(
        `the locale pin did not land — localStorage.userLocale is ` +
          `${stored === undefined ? 'absent' : `'${stored}'`} on ${BASE_URL}. A storage that ` +
          `refuses the write leaves the app on navigator.language, and the spec would assert ` +
          `locale behaviour it never pinned.`
      );
    }
  } finally {
    await probe.close();
  }
}

/**
 * Read the locale the init script stored, from the context's storage
 * snapshot — the value the app itself reads, not the init script's own
 * account of it.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @returns {Promise<string|undefined>} the stored locale, or undefined
 */
async function readPinnedLocale(context) {
  const state = await context.storageState();
  const origin = new URL(BASE_URL).origin;
  const entry = state.origins.find((o) => o.origin === origin);
  const stored = entry?.localStorage.find((e) => e.name === 'userLocale');
  return stored?.value;
}

module.exports = { pinLocale };
