#!/usr/bin/env node
// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * The runner's pre-flight: can this machine drive a browser against the
 * venue AT ALL?
 *
 * A broken runner and a broken product look the same in a test report —
 * every test dies on the same message — but they are not the same finding.
 * The run script checks the runner FIRST, so a missing browser binary, an
 * unresolvable venue name or an unreachable stack stops the run BEFORE it
 * touches the venue and BEFORE the failure path can file an issue per
 * spec file (one missing binary would otherwise file thirty issues for
 * one cause).
 *
 * Usage: node tests/e2e/run/preflight.js
 * Exits 0 when the runner can drive the venue, 1 with the named cause
 * otherwise.
 */
const { chromium } = require('@playwright/test');
// The venue's edge from the credential-free module (the chat helper
// re-exports the fixtures' credentials; the pre-flight needs neither).
const { BASE_URL } = require('../helpers/base-url');
const { venueLaunchArgs, venueMapping } = require('../helpers/venue-launch-args');

function remedy(what) {
  const lines = [
    `  ${what}`,
    '',
    '  the runner needs:',
    '    - a Chromium matching the installed @playwright/test',
    '      (`npx playwright install chromium`), reachable through',
    '      PLAYWRIGHT_BROWSERS_PATH when the browsers live outside the default cache;',
    '    - that Chromium\'s shared libraries on LD_LIBRARY_PATH (a bare',
    '      container image has no libatk/libgbm);',
    '    - the Inter fonts on XDG_DATA_HOME for the pixel-measurement specs;',
    '    - a resolvable venue name — or E2E_VENUE_IP for one the runner',
    '      cannot resolve.',
  ];
  return lines.join('\n');
}

(async () => {
  const mapping = venueMapping();
  process.stdout.write(
    `pre-flight: venue ${BASE_URL}` + (mapping ? ` (mapped ${mapping.host} -> ${mapping.ip})` : '') + '\n'
  );

  let browser;
  try {
    browser = await chromium.launch({ args: venueLaunchArgs() });
  } catch (e) {
    process.stderr.write(`pre-flight: the browser did not launch.\n${remedy(e.message.split('\n')[0])}\n`);
    process.exit(1);
  }

  let failure = null;
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    const page = await context.newPage();
    const response = await page.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const status = response ? response.status() : 0;
    // ANY 4xx or 5xx at the venue ROOT stops the run: it is not a surface
    // the app serves to an anonymous browser. The two statuses are
    // DIFFERENT findings — a 4xx is the edge refusing (wrong address, or
    // a realm that refuses an anonymous request: a broken realm answers
    // 4xx at the edge too), a 5xx is the deployment down. Letting the run
    // proceed would fail every spec on navigation and the failure path
    // would file one issue per spec file for a RUNNER-CONFIG cause — the
    // flood this pre-flight exists to stop.
    if (!status || status >= 400) {
      // Three findings, not one: NO response at all, a 5xx (the deployment
      // is down), and a 4xx (the edge refused — wrong address, or a realm
      // that refuses an anonymous request: a broken realm answers 4xx at
      // the edge too).
      if (status === 0) {
        failure = `no response arrived at ${BASE_URL} — the venue did not answer at all.`;
      } else {
        const cause =
          status >= 500
            ? 'the deployment is down'
            : "the address is not the app's edge, or the venue refuses an anonymous request to " +
              'it (a broken realm answers 4xx at the edge too)';
        failure = `the venue answered HTTP ${status} at ${BASE_URL} — ${cause}.`;
      }
    } else {
      process.stdout.write(`pre-flight: the browser reached the venue (HTTP ${status}).\n`);
    }
  } catch (e) {
    failure = `the browser could not open the venue.\n${remedy(e.message.split('\n')[0])}`;
  }
  // The browser closes BEFORE the exit: process.exit skips a finally block,
  // and every failed pre-flight would orphan a live Chromium on the machine.
  await browser.close();
  if (failure) {
    process.stderr.write(`pre-flight: ${failure}\n`);
    process.exit(1);
  }
})();
