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
  // The venue's edge from the credential-free module (the chat helper
  // re-exports the fixtures' credentials; the pre-flight needs neither).
  const { BASE_URL } = require('../helpers/base-url');
  const { venueLaunchArgs, venueMapping } = require('../helpers/venue-launch-args');
  return { chromium, BASE_URL, venueLaunchArgs, venueMapping, runner: describeRunner() };
}

/**
 * The venue's mapping, or the reason it cannot be used.
 *
 * A malformed venue address (a BASE_URL that is not a URL) makes the
 * mapping read THROW — and an unhandled throw is a stack trace, which
 * hides the cause behind a wall of frames. This is the pre-flight's whole
 * purpose: the cause must be NAMED before the run touches the venue.
 *
 * The read is a pure function of the mapping reader, so it is pinned
 * without a browser and without a venue.
 *
 * @param {Function} venueMapping - the mapping reader
 * @returns {{mapping: object|null, error: string|null}} the mapping, or
 *   the reason it is unusable
 */
function readVenueMapping(venueMapping) {
  try {
    return { mapping: venueMapping(), error: null };
  } catch (e) {
    return { mapping: null, error: remedy(e.message.split('\n')[0]) };
  }
}

/**
 * What the venue's answer at the root MEANS.
 *
 * THREE findings, not one: no answer at all, a 5xx (the deployment is
 * down), and a 4xx (the edge refused — wrong address, or a realm that
 * refuses an anonymous request: a broken realm answers 4xx at the edge
 * too). The message is the operator's first clue, so each finding says
 * itself.
 *
 * @param {number} status - the status the root answered with (0 = none)
 * @param {string} venue - the address the run pointed at
 * @returns {string|null} the diagnosis, or null when the status is not a
 *   failure
 */
function classifyVenueStatus(status, venue) {
  if (status === 0) return `no response arrived at ${venue} — the venue did not answer at all.`;
  if (status >= 500) return `the venue answered HTTP ${status} at ${venue} — the deployment is down.`;
  // A status that is NOT a failure has no diagnosis: the caller only
  // asks about a failed navigation, and a "cause" for a 200 would be a
  // lie waiting for a caller that asks.
  if (status < 400) return null;
  return (
    `the venue answered HTTP ${status} at ${venue} — the address is not the app's edge, or the ` +
    'venue refuses an anonymous request to it (a broken realm answers 4xx at the edge too).'
  );
}

async function main() {
  let loaded;
  try {
    loaded = loadRunner();
  } catch (e) {
    process.stderr.write(`pre-flight: the runner cannot load Playwright.\n${remedy(e.message.split('\n')[0])}\n`);
    process.exit(1);
  }
  const { chromium, BASE_URL, venueLaunchArgs, venueMapping, runner } = loaded;

  // The mapping is read inside a try: a malformed E2E_VENUE_IP (a value
  // that is not a host, a mapping that does not parse) must reach the
  // operator as the NAMED remedy, not as an unhandled throw that hides
  // the cause behind a stack trace.
  const { mapping, error: mappingError } = readVenueMapping(venueMapping);
  if (mappingError) {
    process.stderr.write(`pre-flight: the venue mapping is not usable.\n${mappingError}\n`);
    process.exit(1);
  }
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
    // NO answer, a 4xx or a 5xx at the venue ROOT stops the run: it is not
    // a surface the app serves to an anonymous browser, and each of the
    // three is a DIFFERENT finding (see classifyVenueStatus). Letting the
    // run proceed would fail every spec on navigation and the failure path
    // would file one issue per spec file for a RUNNER-CONFIG cause — the
    // flood this pre-flight exists to stop.
    if (!status || status >= 400) {
      failure = classifyVenueStatus(status, BASE_URL);
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
}

// The pre-flight RUNS when it is the entry point — and only then: the
// diagnosis below is a pure function, and its spec must be able to read it
// without a browser. The run script and the failure path both invoke this
// file as a process (`node tests/e2e/run/preflight.js`), so the entry point
// is the only way it starts.
if (require.main === module) {
  main();
}

module.exports = { classifyVenueStatus, readVenueMapping };
