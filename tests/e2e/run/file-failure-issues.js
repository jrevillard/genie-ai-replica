#!/usr/bin/env node
// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * The failure path: what a red local run means, and what its reader needs to
 * decide it (#1736, #1895, #1896).
 *
 * This script reads the run's JSON report and:
 *
 *  1. prints the run's outcome — the counts, the SKIPPED specs with their
 *     reasons, and the failures. A green run must never mean "nothing ran":
 *     the skipped specs are listed, each with the venue profile that skipped
 *     it, so a run that skipped half the suite says so out loud;
 *  2. prints the CONTEXT of the red: the build the venue serves, this
 *     checkout's HEAD, whether the venue's build is behind it, and — per
 *     failing spec file — the handles the spec waited for and the file in
 *     this checkout that declares them.
 *
 * The suite is launched ON DEMAND — a human, or an agent asked to run it —
 * so whoever launched it SEES the red. The script's job is therefore to make
 * that red readable, not to file it: the issue is written by hand, by
 * whoever reads the report.
 *
 * The context is what tells a stale VENUE from a defect of the product: a
 * venue whose build is behind this checkout cannot serve the handles the
 * checkout declares — refreshing the venue is the remedy, and no code
 * change is the answer.
 *
 * Usage:
 *   node tests/e2e/run/file-failure-issues.js
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
// The report the run read: the runner moves the fresh report to a
// per-run name before handing it over, so a later `playwright test --list`
// (or any other invocation) in the same checkout cannot replace the
// evidence this path reports from.
const DEFAULT_REPORT_PATH = path.join(REPO_ROOT, 'reports', 'playwright-report.json');

// The venue's edge: ONE definition, credential-free — the same address the
// run pointed at.
const { BASE_URL } = require('../helpers/base-url');

// The app's source: where a handle this checkout declares lives.
const FRONTEND_SRC_REL = 'components/gov-chat-frontend/src';
// The shape of a spec file's NAME, one place: the report's suite titles
// carry it, and the walk looks for it.
const SPEC_FILE_RE = /\.(?:spec|test)\.[cm]?[jt]sx?$/;

// How much of a failure's log is shown. Enough to act on (the assertion, the
// observed value, the first stack frames), not the whole browser trace.
const MAX_ERROR_LINES = 40;

// A single failure's text is bounded in BOTH dimensions: the line count
// above, and the character count here — one enormous line would otherwise
// flood the report on its own.
const MAX_ERROR_CHARS = 8000;

// The transport signatures of a navigation that never reached the app:
// the edge refused the connection (the node or the LoadBalancer was
// gone), the connection was reset, closed mid-flight, or the venue NAME
// stopped resolving (the node's address moved with its reboot — the
// 2026-11-10 outage's signature was ERR_CONNECTION_REFUSED at the edge,
// recorded in #1783). Deliberately NOT here: net::ERR_TIMED_OUT and
// other slow-venue signatures, which a loaded-but-up venue produces for
// real product latency. A failure carrying one of these signatures is a
// venue-availability event, not a product finding.
const CONNECTION_FAILURE_RE =
  /\bnet::ERR_(?:CONNECTION_REFUSED|CONNECTION_RESET|CONNECTION_CLOSED|NAME_NOT_RESOLVED)\b/;

/**
 * Does this failure's error carry an edge-transport signature?
 * @param {{error: string}} failure - A grouped failure (see groupFailuresByFile)
 * @returns {boolean}
 */
function isConnectionSignature(failure) {
  return CONNECTION_FAILURE_RE.test(String(failure?.error));
}

/**
 * Split the grouped failures into what is a PRODUCT finding and what is
 * VENUE NOISE (#1783). A file whose failures are ALL connection signatures
 * drops out of the per-spec report entirely; a file whose other failures
 * survive the filter stays for exactly those. Pure — the same grouped
 * input always produces the same split, and the caller owns the
 * printing.
 * @param {Map<string, Array<{error: string}>>} byFile - The grouped
 *   failures (see groupFailuresByFile)
 * @returns {{fileable: Map<string, Array<{error: string}>>, noise: Map<string, Array<{error: string}>>}}
 */
function partitionVenueNoise(byFile) {
  const fileable = new Map();
  const noise = new Map();
  for (const [file, failures] of byFile) {
    const connection = failures.filter(isConnectionSignature);
    if (connection.length === 0) {
      fileable.set(file, failures);
      continue;
    }
    noise.set(file, connection);
    const rest = failures.filter((failure) => !isConnectionSignature(failure));
    if (rest.length > 0) {
      fileable.set(file, rest);
    }
  }
  return { fileable, noise };
}

/**
 * The ONE venue-availability report for a healed mid-run outage (#1783):
 * the venue, the
 * signature-bearing failure inventory, and the verdict. Pure string —
 * the caller prints it, the unit spec asserts it.
 * @param {Map<string, Array<{error: string}>>} venueNoise - Per spec
 *   file, the failures that carry a connection signature
 * @param {string} venue - The venue address the failed run pointed at
 * @returns {string} The report text (no trailing newline)
 */
function venueAvailabilityReport(venueNoise, venue) {
  const total = [...venueNoise.values()].reduce((sum, failures) => sum + failures.length, 0);
  const lines = [
    '',
    `venue-availability report: ${total} failure(s) across ${venueNoise.size} spec file(s) carry an ` +
      'edge-transport signature — the browser never reached the app:'
  ];
  for (const [file, failures] of venueNoise) {
    const signature = (String(failures[0].error).match(CONNECTION_FAILURE_RE) || ['(no signature extracted)'])[0];
    lines.push(`  - ${file}: ${failures.length} (e.g. ${signature})`);
  }
  lines.push(
    `The venue answered the re-probe at ${venue} — these look like a venue outage that healed ` +
      'mid-run, NOT product findings: nothing is reported per spec for them. The run is still RED; ' +
      'check the venue events (kubectl get events -A) and re-run the suite once the venue has been stable.'
  );
  return lines.join('\n');
}

function fail(message) {
  process.stderr.write(`file-failure-issues: ${message}\n`);
  process.exit(1);
}

function readReport(reportPath) {
  if (!fs.existsSync(reportPath)) {
    fail(
      `no JSON report at ${reportPath} — the run must write one (playwright.config.js ` +
        'declares the json reporter) before its outcome can be read'
    );
  }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(reportPath, 'utf-8'));
  } catch (e) {
    fail(`the JSON report at ${reportPath} is not readable as JSON: ${e.message}`);
  }
  if (!report || !Array.isArray(report.suites)) {
    fail(`the JSON report at ${reportPath} carries no suites — it is not a Playwright report`);
  }
  // The run stamp comes from stats.startTime — the moment the red run
  // STARTED, not the moment this path read the report. A report without it
  // would otherwise get a fabricated wall-clock stamp, and the report
  // would misattribute the run it names (Playwright's json reporter
  // always writes stats; one that did not is not a report this path reads).
  if (!report.stats || typeof report.stats.startTime !== 'string') {
    fail(
      `the JSON report at ${reportPath} carries no stats.startTime — it is not a report the ` +
        'failure path can stamp the run it names with'
    );
  }
  return report;
}

/**
 * Every test in the report, with the file it belongs to and the FULL title
 * path (the describe blocks plus the test title). The report carries the
 * test title alone; two tests with the same title in different describes
 * would otherwise be indistinguishable in the run output.
 */
function collectTests(suites, inheritedFile, describePath = [], out = []) {
  for (const suite of suites || []) {
    const file = suite.file || inheritedFile;
    // The file-level suite carries the spec file's own path as its title;
    // that is not a describe block, and repeating it would read as one.
    const isFileSuite = suite.title && SPEC_FILE_RE.test(suite.title);
    const titlePath = suite.title && !isFileSuite ? [...describePath, suite.title] : describePath;
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        out.push({ file: repoPath(file), title: [...titlePath, spec.title].join(' › '), test });
      }
    }
    collectTests(suite.suites, file, titlePath, out);
  }
  return out;
}

/**
 * The spec file's path, relative to the repository root. The report carries
 * it relative to the test directory — the report and the docs name spec
 * files by their repository path.
 */
function repoPath(file) {
  if (!file) return '(unknown file)';
  const clean = file.replace(/^\.\//, '');
  return clean.startsWith('tests/e2e/') ? clean : `tests/e2e/${clean}`;
}

function skipReason(test) {
  const annotation = (test.annotations || []).find((a) => a.type === 'skip' && a.description);
  return annotation ? annotation.description : 'no reason recorded';
}

function errorText(result) {
  if (!result) return 'no error recorded';
  const error = result.error || (result.errors || [])[0];
  if (!error) return 'no error recorded';
  const text = [error.message || '', error.stack || ''].filter(Boolean).join('\n');
  const lines = text.split('\n').slice(0, MAX_ERROR_LINES).join('\n');
  return lines.length > MAX_ERROR_CHARS ? `${lines.slice(0, MAX_ERROR_CHARS)}\n(truncated)` : lines;
}

/**
 * The handle values a text declares, in both attribute spellings.
 *
 * The value is matched as a QUOTED literal, so `upload-files-dialog` does
 * not match a text that carries only `upload-files-dialog-confirm`.
 */
const HANDLE_RE = /data-test(?:id|-id)[ \t]*=[ \t]*["']([^"']+)["']/g;

function handlesIn(text) {
  const handles = [];
  for (const match of String(text || '').matchAll(HANDLE_RE)) handles.push(match[1]);
  return handles;
}

/**
 * The handles a failure's LOCATOR names.
 *
 * Playwright prints the locator it was waiting on in the `Locator:` line
 * of an expect() failure — that is the element the failure is about. The
 * code frame below it is the SPEC's own source and names other handles;
 * only the locator line counts, or a failure would carry every handle its
 * file mentions.
 *
 * The attribute spelling (`[data-testid="x"]`) and Playwright's own
 * `getByTestId('x')` name the SAME handle in two spellings; both are read.
 *
 * @param {string} errorText - the failure's error text
 * @returns {string[]} the handle values the locator names
 */
function locatorHandles(errorText) {
  const line = String(errorText || '')
    .split('\n')
    .find((candidate) => candidate.trim().startsWith('Locator:'));
  if (!line) return [];
  const byAttribute = handlesIn(line);
  const byTestId = Array.from(line.matchAll(/getByTestId\(\s*['"]([^'"]+)['"]\s*\)/g)).map((match) => match[1]);
  return [...new Set([...byAttribute, ...byTestId])];
}

/**
 * This checkout's HEAD, or null when the checkout cannot answer.
 */
function checkoutHead(run = execFileSync) {
  try {
    return run('git', ['rev-parse', 'HEAD'], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'ignore']
    }).trim();
  } catch {
    return null;
  }
}

/**
 * Is the venue's build BEHIND this checkout's HEAD?
 *
 * true = the venue's build is an ancestor of the checkout (the venue cannot
 * serve what the checkout declares); false = it is not (the venue is not
 * behind, so a missing handle is the product's); null = the checkout cannot
 * answer (a shallow clone, an unknown sha).
 *
 * @param {string} venueBuild - the build the venue serves
 * @returns {true|false|null} the relation
 */
function isBehindCheckout(venueBuild, run = execFileSync) {
  try {
    run('git', ['merge-base', '--is-ancestor', venueBuild, 'HEAD'], {
      cwd: REPO_ROOT,
      stdio: 'ignore'
    });
    return true;
  } catch (error) {
    // git merge-base --is-ancestor exits 1 for "not an ancestor" and 128 for
    // "cannot read it".
    return error.status === 1 ? false : null;
  }
}

/**
 * The file in THIS checkout that declares a handle, or null when no source
 * declares it (a spec defect) or the checkout cannot answer.
 *
 * @param {string} handle - the handle value
 * @returns {string|null} the declaring file
 */
function declaringFile(handle, run = execFileSync) {
  try {
    // The app's SOURCE files, and the test tree excluded: a handle the
    // frontend's own Jest tree declares is not a declaration — no build
    // renders a mock.
    const out = run(
      'git',
      [
        'grep',
        '-l',
        '-F',
        '-e',
        handle,
        'HEAD',
        '--',
        `:(glob)${FRONTEND_SRC_REL}/**/*.vue`,
        `:(glob)${FRONTEND_SRC_REL}/**/*.js`,
        ':(exclude,glob)**/__tests__/**',
        ':(exclude,glob)**/__mocks__/**'
      ],
      {
        cwd: REPO_ROOT,
        encoding: 'utf-8',
        stdio: ['ignore', 'pipe', 'ignore']
      }
    );
    return out.split('\n')[0].replace(/^HEAD:/, '') || null;
  } catch {
    return null;
  }
}

/**
 * The CONTEXT of the red: the facts a reader needs to tell a stale VENUE
 * from a defect of the product.
 *
 * Two of them decide it. The build the VENUE serves: a venue behind this
 * checkout cannot serve the handles the checkout declares, and the remedy is
 * a venue refresh, not a code change. And the handles each failing spec
 * WAITED FOR, with the file in this checkout that declares them: a handle no
 * source declares is a spec defect.
 *
 * @param {Map<string, Array<{error: string}>>} byFile - the failures grouped by spec file
 * @param {{venueBuild?: string, head?: string, behind?: boolean|null, declaringFile?: Function}} [readers] - the readers (injectable for the unit spec)
 * @returns {string} the report block
 */
function venueContext(byFile, readers = {}) {
  const venueBuild = readers.venueBuild !== undefined ? readers.venueBuild : process.env.E2E_VENUE_BUILD_GIT_SHA || '';
  const head = readers.head !== undefined ? readers.head : checkoutHead();
  const declare = readers.declaringFile || declaringFile;
  const lines = ['the red, in facts:'];
  lines.push(`  - venue build: ${venueBuild ? `\`${venueBuild}\`` : 'unknown — the run carried no build marker'}`);
  lines.push(`  - this checkout: ${head ? `\`${head}\`` : 'unknown — the checkout cannot answer'}`);
  const behind =
    readers.behind !== undefined ? readers.behind : venueBuild && head ? isBehindCheckout(venueBuild) : null;
  lines.push(
    '  - the venue is ' +
      (behind === true
        ? 'BEHIND this checkout — it cannot serve the handles the checkout declares: refresh the venue, no code change'
        : behind === false
          ? "NOT behind this checkout — a missing handle is the PRODUCT's, not the venue's"
          : 'not comparable — the two builds could not be compared')
  );
  for (const [file, failures] of byFile) {
    lines.push(`  - ${file} (${failures.length} failure(s))`);
    for (const handle of waitedHandles(failures)) {
      const source = declare(handle);
      lines.push(
        `      waited for \`${handle}\` — ${
          source ? `declared by this checkout in ${source}` : 'declared by NO source in this checkout'
        }`
      );
    }
  }
  return lines.join('\n');
}

/**
 * The handles the failures of one spec file waited for — the locator lines
 * of their errors, deduplicated.
 *
 * @param {Array<{error: string}>} failures - the failures of one spec file
 * @returns {Array<string>} the handles
 */
function waitedHandles(failures) {
  const handles = new Set();
  for (const failure of failures) {
    for (const handle of locatorHandles(failure.error)) handles.add(handle);
  }
  return [...handles];
}

/**
 * The failures grouped by the spec FILE they belong to.
 *
 * One entry per spec FILE: the file is the unit an owner fixes, and a
 * file-level title keeps the grouping stable across runs. Two failures in
 * the same file are ONE entry with two lines.
 */
function groupFailuresByFile(failed) {
  const byFile = new Map();
  for (const entry of failed) {
    const list = byFile.get(entry.file) || [];
    const result = (entry.test.results || [])[entry.test.results.length - 1];
    list.push({ title: entry.title, error: errorText(result) });
    byFile.set(entry.file, list);
  }
  return byFile;
}

function main() {
  const reportFlag = process.argv.indexOf('--report');
  const reportValue = reportFlag === -1 ? null : process.argv[reportFlag + 1];
  if (reportFlag !== -1 && (!reportValue || reportValue.startsWith('-'))) {
    fail('--report needs the path of the report to read');
  }
  const venueFlag = process.argv.indexOf('--venue');
  const venueValue = venueFlag === -1 ? null : process.argv[venueFlag + 1];
  if (venueFlag !== -1 && (!venueValue || venueValue.startsWith('-'))) {
    fail('--venue needs the address the failed run pointed at');
  }
  const reportPath = reportValue ? path.resolve(reportValue) : DEFAULT_REPORT_PATH;
  const report = readReport(reportPath);
  // The venue is the address the FAILED RUN pointed at, not whatever this
  // shell happens to carry: the runner passes --venue explicitly, and a
  // hand re-run in a fresh shell (no BASE_URL exported) would otherwise
  // report a venue the run never touched.
  const venue = venueValue || BASE_URL;
  // Validated by readReport: the stamp is the run's own start, never this
  // report's wall clock.
  const runStamp = report.stats.startTime;

  const tests = collectTests(report.suites);
  // A run that executed NOTHING is not a green run — it is a run that did
  // not happen. The suite's own rule: a green must never mean "nothing ran".
  if (tests.length === 0) {
    fail('the run executed no test — a green that means "nothing ran" is not a result');
  }

  // The report's status vocabulary is expected | unexpected | flaky | skipped:
  // a test that passed is 'expected', and ONLY 'unexpected' is a failure.
  // Reading anything that is not 'passed' as a failure would report every
  // green spec as red.
  const skipped = tests.filter((entry) => entry.test.status === 'skipped');
  const failed = tests.filter((entry) => entry.test.status === 'unexpected');

  const stats = report.stats;
  process.stdout.write(`\ne2e run: ${venue} (${runStamp})\n`);
  process.stdout.write(
    `tests: ${tests.length}  passed: ${stats.expected || 0}  failed: ${failed.length}  ` +
      `skipped: ${skipped.length}\n`
  );

  if (skipped.length > 0) {
    process.stdout.write('\nskipped (each with the venue profile that skipped it):\n');
    for (const entry of skipped) {
      process.stdout.write(`  - ${entry.file} › ${entry.title}\n      ${skipReason(entry.test)}\n`);
    }
  }

  if (failed.length === 0) {
    process.stdout.write('\nno failure to report.\n');
    return;
  }

  // The venue must be re-probed BEFORE the failures are classified: the
  // venue-availability report below asserts "the venue answered the
  // re-probe", and an assertion about an observation that has not
  // happened yet is a lie whichever way the venue answers. The probe
  // answers "is the venue drivable NOW" — the same check the run started
  // with. The documented venue-death case (the node reboots mid-run)
  // fails every spec that navigates afterwards with ERR_CONNECTION_REFUSED,
  // and reporting one failure per spec file for that single cause is
  // exactly the noise this path exists to absorb.
  try {
    execFileSync('node', [path.join(__dirname, 'preflight.js')], {
      stdio: 'inherit',
      env: { ...process.env, BASE_URL: venue }
    });
  } catch {
    process.stderr.write(
      'file-failure-issues: the venue is not drivable — the failures are a venue event, ' +
        'not per-spec findings. Nothing to report per spec; re-run the suite once the venue answers.\n'
    );
    process.exit(1);
  }

  // The healed-outage case (#1783): a venue that went away MID-RUN and
  // came back passes the re-probe above, and without the signature filter
  // the run would report one failure per spec file for a single venue
  // event (the 2026-11-10 node reboot produced exactly that). Failures
  // whose error carries an edge-transport signature are grouped into ONE
  // venue-availability report instead; a file whose OTHER failures survive
  // the filter is still reported for those.
  const { fileable: byFile, noise: venueNoise } = partitionVenueNoise(groupFailuresByFile(failed));
  if (venueNoise.size > 0) {
    process.stdout.write(venueAvailabilityReport(venueNoise, venue) + '\n');
  }
  if (byFile.size === 0) {
    process.stdout.write(
      '\nnothing to report per spec — every failure carries the venue-outage signature; the report above is the record.\n'
    );
    return;
  }

  // The CONTEXT: what a reader (a human, or an agent) needs to tell a
  // stale VENUE from a defect of the product. The suite is launched on
  // demand, so whoever launched it sees this red — the report's job is to
  // make the red readable, not to decide it.
  process.stdout.write(`\nfailing spec files: ${byFile.size}\n`);
  process.stdout.write(venueContext(byFile) + '\n');
  process.stdout.write(
    '\nfile the issue by hand: the failures, the venue build and this checkout are the facts a reader needs.\n'
  );
}

if (require.main === module) {
  main();
}

// Exposed for the unit spec: the venue-outage partition and the context
// the report prints are behaviour, and behaviour is tested, not trusted.
module.exports = {
  groupFailuresByFile,
  isConnectionSignature,
  partitionVenueNoise,
  venueAvailabilityReport,
  locatorHandles,
  handlesIn,
  checkoutHead,
  isBehindCheckout,
  declaringFile,
  waitedHandles,
  venueContext
};
