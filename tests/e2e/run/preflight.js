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
const { describeRunner } = require('./install-browsers');

function remedy(what) {
  const lines = [
    `  ${what}`,
    '',
    '  the runner needs:',
    '    - a Chromium matching the installed @playwright/test — one command',
    '      reconciles the checkout and the browser tree:',
    '      `node tests/e2e/run/install-browsers.js`; the build must be',
    '      reachable through PLAYWRIGHT_BROWSERS_PATH when the browsers',
    '      live outside the default cache;',
    '    - that Chromium\'s shared libraries on LD_LIBRARY_PATH (a bare',
    '      container image has no libatk/libgbm);',
    '    - the Inter fonts on XDG_DATA_HOME for the pixel-measurement specs;',
    '    - a resolvable venue name — or E2E_VENUE_IP for one the runner',
    '      cannot resolve.',
  ];
  return lines.join('\n');
}

// The Playwright a run drives is part of what the run reports: a reader
// must be able to tell WHICH browser a result came from — the version on
// disk and the Chromium revision it names. Loading it is a separate step so
// a checkout without node_modules is a NAMED cause, not a stack trace: the
// two are different findings.
function loadRunner() {
  const { chromium } = require('@playwright/test');
  const { BASE_URL } = require('../helpers/chatbot');
  const { venueLaunchArgs, venueMapping } = require('../helpers/venue-launch-args');
  return { chromium, BASE_URL, venueLaunchArgs, venueMapping, runner: describeRunner() };
}

(async () => {
  let loaded;
  try {
    loaded = loadRunner();
  } catch (e) {
    process.stderr.write(`pre-flight: the runner cannot load Playwright.\n${remedy(e.message.split('\n')[0])}\n`);
    process.exit(1);
  }
  const { chromium, BASE_URL, venueLaunchArgs, venueMapping, runner } = loaded;

  const mapping = venueMapping();
  process.stdout.write(
    `pre-flight: venue ${BASE_URL}` + (mapping ? ` (mapped ${mapping.host} -> ${mapping.ip})` : '') + '\n'
  );
  process.stdout.write(
    `pre-flight: runner @playwright/test ${runner.playwrightVersion} — ` +
      `chromium ${runner.chromium}, chromium-headless-shell ${runner.chromiumHeadlessShell}\n`
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
    // ANY 4xx at the venue ROOT is a misconfigured BASE_URL, not a surface
    // the app serves: letting the run proceed would fail every spec on
    // navigation and the failure path would file one issue per spec file
    // for a RUNNER-CONFIG cause — the flood this pre-flight exists to stop.
    if (!status || status >= 400) {
      failure = `the venue answered HTTP ${status} at ${BASE_URL} — the address is not the app's edge.`;
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
