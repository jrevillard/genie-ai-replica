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

/**
 * Force the app's locale to English for this browser context.
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} [locale] the locale code to pin (default 'en')
 */
async function pinLocale(context, locale = 'en') {
  await context.addInitScript((loc) => {
    try {
      window.localStorage.setItem('userLocale', loc);
    } catch (e) {
      // A browser context with storage disabled — the app falls back to
      // navigator.language, which the context's locale option also pins.
    }
  }, locale);
}

module.exports = { pinLocale };
