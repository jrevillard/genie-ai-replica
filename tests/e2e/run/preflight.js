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
// The mapping reader: ONE owner — the module that reads the mapping. It is
// TOTAL (a value that cannot be read comes back as a reason, not a throw), so
// the pre-flight names the cause instead of dying on it.
const { safeVenueMapping } = require('../helpers/venue-launch-args');

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
    '      cannot resolve; E2E_VENUE_IP must be an IPv4 or IPv6 address;',
    '    - a venue address that is a URL (BASE_URL).',
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
  const { venueLaunchArgs } = require('../helpers/venue-launch-args');
  return { chromium, BASE_URL, venueLaunchArgs, runner: describeRunner() };
}

/**
 * The pre-flight's NAMED cause for a failure it cannot recover from:
 * the headline, then the remedy the operator needs.
 *
 * The remedy is part of the message: a cause without it tells the
 * operator WHAT happened and nothing about what to do about it.
 */
function namedFailure(headline, cause) {
  return `pre-flight: ${headline}.\n${remedy(String(cause).split('\n')[0])}\n`;
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
    process.stderr.write(namedFailure('the runner cannot load Playwright', e.message));
    process.exitCode = 1;
    return;
  }
  const { chromium, BASE_URL, venueLaunchArgs, runner } = loaded;

  // The mapping is read through the TOTAL reader (the mapping module's
  // own): a malformed ADDRESS (a BASE_URL that is not a URL — the
  // mapping reads the host out of it) or a malformed E2E_VENUE_IP (a
  // value that is not an address) must reach the operator as the NAMED
  // remedy, not as an unhandled throw that hides the cause behind a
  // stack trace, and not as a browser failure much later that reads
  // like a runner problem.
  const { mapping, error: mappingError } = safeVenueMapping();
  if (mappingError) {
    process.stderr.write(namedFailure('the venue mapping is not usable', mappingError));
    process.exitCode = 1;
    return;
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
    process.stderr.write(namedFailure('the browser did not launch', e.message));
    process.exitCode = 1;
    return;
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
    //
    // The classifier decides: it returns the finding for a status that is
    // one, and null for a status that is not a failure. The caller does not
    // re-encode the threshold.
    const diagnosis = classifyVenueStatus(status, BASE_URL);
    if (diagnosis) {
      failure = `pre-flight: ${diagnosis}\n`;
    } else {
      process.stdout.write(`pre-flight: the browser reached the venue (HTTP ${status}).\n`);
    }
  } catch (e) {
    // The SAME formatter as the other causes: the headline, then the
    // remedy.
    failure = namedFailure('the browser could not open the venue', e.message);
  }
  // The browser closes BEFORE the exit: an exit that skips a finally block
  // would orphan a live Chromium on the machine. A close that FAILS is
  // reported in its own right — the operator must hear that a Chromium
  // may be left running — and it never REPLACES the cause already found:
  // the first cause stays the headline.
  let cleanupFailure = null;
  try {
    await browser.close();
  } catch (e) {
    cleanupFailure = e;
  }
  if (failure) {
    process.stderr.write(failure);
    process.exitCode = 1;
  }
  if (cleanupFailure) {
    process.stderr.write(namedFailure('the browser could not close', cleanupFailure.message));
    process.exitCode = 1;
  }
}

// The pre-flight RUNS when it is the entry point — and only then: the
// diagnosis below is a pure function, and its spec must be able to read it
// without a browser. The run script and the failure path both invoke this
// file as a process (`node tests/e2e/run/preflight.js`), so the entry point
// is the only way it starts.
if (require.main === module) {
  // No catch here, on purpose: every await in main() is guarded (the
  // launch, the navigation, the close), so nothing escapes it, and a
  // rejection that DID escape would be an internal bug — a stack is the
  // honest output for that, and node exits 1 on it. A catch here would
  // rewrite an internal failure into a named cause and hide the frames
  // that say where it came from.
  main();
}

module.exports = { classifyVenueStatus, namedFailure };
