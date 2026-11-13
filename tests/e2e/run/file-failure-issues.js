#!/usr/bin/env node
// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * The failure path: a red local run must produce a FILED issue, not a silent
 * red (#1736). A local run whose failures are only seen by the person who
 * ran it is the same silence as a red monthly pipeline nobody reads.
 *
 * This script reads the run's JSON report and:
 *
 *  1. prints the run's outcome — the counts, the SKIPPED specs with their
 *     reasons, and the failures. A green run must never mean "nothing ran":
 *     the skipped specs are listed, each with the venue profile that skipped
 *     it, so a run that skipped half the suite says so out loud;
 *  2. with --file-issues, files ONE issue per failing spec FILE, with the
 *     failures and their logs, labelled `status::backlog` — the label is set
 *     ONCE, at creation, and never moved afterwards (see
 *     .claude/rules/ISSUE-LABELS.md). A file that already has an open issue
 *     tracking it gets a COMMENT instead of a second issue, so a suite that
 *     stays red does not flood the tracker.
 *
 * The filing loop NEVER dies of its own bookkeeping: one tracker error must
 * not leave the remaining failures unreported (that is the silence this path
 * exists to end). The errors are collected and the script exits non-zero at
 * the end, naming what could not be filed.
 *
 * Usage:
 *   node tests/e2e/run/file-failure-issues.js [--file-issues]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
// The report the run read: the runner moves the fresh report to a
// per-run name before handing it over, so a later `playwright test --list`
// (or any other invocation) in the same checkout cannot replace the
// evidence this path files from.
const DEFAULT_REPORT_PATH = path.join(REPO_ROOT, 'reports', 'playwright-report.json');

const { VENUE_IP_ENV, VENUE_HOST_ENV } = require('../helpers/venue-launch-args');
// The e2e tree's root: a path whose prefix is INSIDE it is a different
// file that happens to carry another one's path as its tail.
const TESTS_E2E_ROOT = 'tests/e2e';
// The shape of a spec file's NAME, one place: the report's suite titles
// carry it, the walk looks for it, and the bare-name rule recognises it.
const SPEC_FILE_RE = /\.(?:spec|test)\.[cm]?[jt]sx?$/;
// The venue's edge: ONE definition, credential-free — the same address the
// run used, so the issue's reproduce command reproduces the run.
const { BASE_URL } = require('../helpers/base-url');
const GITLAB_HOST = process.env.GITLAB_HOST || 'opensource.unicc.org';
const GITLAB_PROJECT_ID = process.env.GITLAB_PROJECT_ID || '90';

// The label set a filed failure carries. `status::backlog` is set AT CREATION
// and never moved again; the other two say what kind of finding it is.
const LABELS = ['status::backlog', 'type::bug', 'area::testing'];

// How much of a failure's log travels into the issue. Enough to act on
// (the assertion, the observed value, the first stack frames), not the whole
// browser trace.
const MAX_ERROR_LINES = 40;

// How many failures travel into ONE issue body. A spec file with dozens of
// failures would push the description past the kernel's per-argument cap
// (~128 KiB), the spawn would die with E2BIG, and the file would be
// permanently un-fileable — the cap keeps the filing possible; the count
// line above the fold still says how many failed.
const MAX_FAILURES_PER_ISSUE = 10;

// One tracker call, in milliseconds. A wedged connection must not hang the
// run forever with both serial-slot locks held — every other bound in the
// runner is finite and so is this one.
const TRACKER_TIMEOUT_MS = 60000;

// A single failure's text is bounded in BOTH dimensions: the line count
// above, and the character count here — one enormous line would otherwise
// push the issue body past the kernel's per-argument cap on its own.
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
 * Split the grouped failures into what is FILEABLE and what is VENUE
 * NOISE (#1783). A file whose failures are ALL connection signatures
 * drops out of the filing entirely; a file whose other failures survive
 * the filter stays fileable for exactly those. Pure — the same grouped
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
 * The ONE venue-availability report that replaces one product issue per
 * spec file for a healed mid-run outage (#1783): the venue, the
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
      'edge-transport signature — the browser never reached the app:',
  ];
  for (const [file, failures] of venueNoise) {
    const signature = (String(failures[0].error).match(CONNECTION_FAILURE_RE) || ['(no signature extracted)'])[0];
    lines.push(`  - ${file}: ${failures.length} (e.g. ${signature})`);
  }
  lines.push(
    `The venue answered the re-probe at ${venue} — these look like a venue outage that healed ` +
      'mid-run, NOT product findings: nothing is filed for them. The run is still RED; ' +
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
  return report;
}

/**
 * Every test in the report, with the file it belongs to and the FULL title
 * path (the describe blocks plus the test title). The report carries the
 * test title alone; two tests with the same title in different describes
 * would otherwise be indistinguishable in the run output and in a filed
 * issue.
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
 * it relative to the test directory — the tracker, the docs and the issues
 * all name spec files by their repository path.
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

function glab(args) {
  return execFileSync('glab', ['api', '--hostname', GITLAB_HOST, ...args], {
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
    timeout: TRACKER_TIMEOUT_MS,
  });
}

/**
 * The project's open issues, fetched ONCE.
 *
 * The tracker rate-limits its search endpoint hard, and a run with thirty
 * failing spec files would hit that limit — the failure path must not die
 * of its own bookkeeping (it would leave the failures unfiled, which is the
 * silence this path exists to end). The issue LIST is a plain paginated
 * read, and the matching happens locally: an issue that already tracks a
 * spec file carries the file's repository path in its title, or the
 * script's own "- spec file: `path`" marker in its description.
 *
 * A failed READ is fatal (unlike a failed write): without the open-issue
 * list every failing file would get a NEW issue, and a flood is exactly
 * what this path exists to prevent.
 */
function fetchOpenIssues() {
  const issues = [];
  for (let page = 1; page <= 20; page += 1) {
    let batch;
    try {
      batch = JSON.parse(
        glab([`projects/${GITLAB_PROJECT_ID}/issues?state=opened&per_page=100&page=${page}`])
      );
    } catch (e) {
      fail(`the tracker could not be read: ${e.message}`);
    }
    if (!Array.isArray(batch)) fail('the tracker answered with something that is not an issue list');
    issues.push(...batch);
    if (batch.length < 100) break;
  }
  return issues;
}

/**
 * The spec paths a text names — the tokens that end in a spec file
 * extension.
 */
function specPathsIn(text) {
  const tokens = String(text || '').match(/[A-Za-z0-9_./-]*\.(?:spec|test)\.[cm]?[jt]sx?/g) || [];
  return tokens.map((token) => token.replace(/^\.\//, ''));
}

/**
 * Does this token name THIS file?
 *
 * The token is compared as a path: it is the file's repository path, or
 * a path that ENDS with it (an absolute path, or the file's URL in a
 * tracker link) — but not a path whose prefix is inside the e2e tree:
 * `tests/e2e/helpers/tests/e2e/a.spec.js` is a DIFFERENT file that
 * happens to carry this one's path as its tail.
 */
function namesThisFile(token, file) {
  if (token === file) return true;
  // The path relative to the e2e tree: 'helpers/a.spec.js'.
  const relative = file.startsWith(`${TESTS_E2E_ROOT}/`) ? file.slice(TESTS_E2E_ROOT.length + 1) : null;
  if (relative && token === relative) return true;
  if (!token.endsWith(`/${file}`)) return false;
  const prefix = token.slice(0, token.length - file.length - 1);
  return !(prefix === TESTS_E2E_ROOT || prefix.includes(`${TESTS_E2E_ROOT}/`));
}

/**
 * The spec-file names that live OUTSIDE the e2e tree.
 *
 * A bare file name in a title is ambiguous: it may name a file of the
 * e2e tree, or a file of another tree (a frontend unit test, a
 * config-validator case). The second reading must not be mistaken for
 * the first: a title that names an e2e spec AND a frontend test by its
 * bare name would stop being DEDICATED to the e2e file — and the
 * failure path would file a second issue for a file that already has
 * one.
 *
 * The set is built ONCE (the walk costs ~0.1 s in a branch worktree and
 * ~0.8 s in a checkout that carries sibling worktrees' copies) and only
 * when a bare name is actually met, which is at most once per title.
 */
const otherTreeNamesByRoot = new Map();

function namesOutsideE2eTree(token, root = REPO_ROOT) {
  if (!otherTreeNamesByRoot.has(root)) {
    const otherTreeNames = new Set();
    const walk = (dir) => {
      let entries;
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          // The e2e tree is this tree's own business; only the OTHER
          // trees' names can make a bare name ambiguous. EVERY copy of
          // it is this tree's business — a checkout that carries sibling
          // worktrees holds a full copy of tests/e2e under each of
          // them, and their spec names would make this tree's OWN bare
          // names look like another tree's files.
          const rel = path.relative(root, full).split(path.sep);
          if (rel.length >= 2 && rel[rel.length - 2].toLowerCase() === 'tests' && rel[rel.length - 1].toLowerCase() === 'e2e') continue;
          walk(full);
        } else if (SPEC_FILE_RE.test(entry.name)) {
          otherTreeNames.add(entry.name);
        }
      }
    };
    walk(root);
    otherTreeNamesByRoot.set(root, otherTreeNames);
  }
  return otherTreeNamesByRoot.get(root).has(token);
}

/**
 * Does this path token name a file of the e2e tree?
 *
 * The tokens come from a title, so they may be written three ways: the
 * repository path, an absolute path or a tracker URL (all of which carry
 * the tree's root), or relative to the tree's root ('helpers/a.spec.js').
 * A path of ANOTHER tree (a frontend unit test) is not this tree's
 * business — the failure path does not file it.
 *
 * The relative spelling is recognised by its FIRST segment: it is a
 * directory of the e2e tree.
 */
function isE2ePath(token, root = REPO_ROOT) {
  if (token.includes(`${TESTS_E2E_ROOT}/`)) return true;
  const first = token.split('/')[0];
  if (first === token) {
    // A bare spec file name is this tree's path — whether it still
    // exists or not: a file that was RENAMED must not drop out of the
    // comparison (that would turn a multi-file title into a dedication).
    //
    // UNLESS the name is a file of ANOTHER tree: that name is not this
    // tree's, and counting it would make a title that names an e2e file
    // AND a frontend test look like a group instead of a dedication.
    return SPEC_FILE_RE.test(token) && !namesOutsideE2eTree(token, root);
  }
  return fs.existsSync(path.join(root, TESTS_E2E_ROOT, first));
}

/**
 * Is this issue DEDICATED to the file — does its title name that file and
 * no other?
 *
 * A title that names SEVERAL spec files tracks a GROUP: the wave issue
 * that touched a dozen of them. Such an issue must not absorb their
 * failures — a failure on one of them still gets an issue of its own, or
 * the file shows red with nothing pointing at it.
 */
function titleIsDedicatedTo(title, file, root = REPO_ROOT) {
  // Only the paths of the tree this path covers count: a title that
  // also names a FRONTEND test (a different tree, a different failure
  // path) is still dedicated to this e2e file.
  const paths = specPathsIn(title).filter((token) => isE2ePath(token, root));
  if (paths.length === 0) return false;
  // EVERY path the title names must name THIS file — under the
  // repository path, an absolute path or a tracker URL. A title that
  // names another file as well is an umbrella, whatever it says about
  // this one.
  return paths.every((path) => namesThisFile(path, file));
}

/**
 * The marker this script writes in an issue body to bind that issue to
 * one spec file. ONE spelling, used both to write it and to read it back:
 * a drift between the two would silently degrade the dedupe to
 * title-only.
 */
function specFileMarker(file) {
  return `- spec file: \`${file}\``;
}

/**
 * The open issue that already tracks this spec file, or null.
 *
 * An issue that already tracks the failure must NOT be duplicated: the run
 * comments on it instead, and a spec file nobody tracks yet gets its own
 * issue.
 *
 * A match must be DEDICATED to the file, and there are exactly two places
 * where such a dedication can be found:
 *
 * - the TITLE names that file and no other — the dedicated issue this
 *   script files, and the dedicated issue a human filed;
 * - the DESCRIPTION carries the marker this script writes
 *   ("- spec file: `path`") — the same dedicated issue.
 *
 * A path that appears in either place WITHOUT being dedicated is NOT a
 * match: an umbrella issue that LISTS several spec paths (a wave that
 * touched a dozen of them) would otherwise absorb every one of their
 * failures, and the failure would never get an issue of its own — the
 * tracker would show the file as red with nothing pointing at it.
 */
function findTrackedIssue(file, openIssues) {
  const marker = specFileMarker(file);
  // The dedicated TITLE wins: an issue matched only by the marker is
  // the same file's issue too, but the one whose title says so is the
  // one a reader lands on.
  const dedicated = openIssues.filter((issue) => titleIsDedicatedTo(issue.title, file));
  if (dedicated.length) return dedicated[0];
  return openIssues.find((issue) => (issue.description || '').includes(marker)) || null;
}

/**
 * The command that reproduces the run, as the run itself was launched: the
 * address the runner resolved the venue NAME to included, or the command is
 * a DNS failure waiting to happen.
 */
function reproduceCommand(venue) {
  const parts = [`BASE_URL=${venue}`];
  if (process.env[VENUE_IP_ENV]) {
    // Only when the runner knows the host: a placeholder here would paste
    // an array into the command.
    if (process.env[VENUE_HOST_ENV]) parts.push(`E2E_VENUE_HOST=${process.env[VENUE_HOST_ENV]}`);
    parts.push(`E2E_VENUE_IP=${process.env[VENUE_IP_ENV]}`);
  }
  return `${parts.join(' ')} tests/e2e/run/run-local-e2e.sh`;
}

/**
 * The issue body of a spec file nobody tracks yet.
 */
/**
 * The failures grouped by the spec FILE they belong to.
 *
 * One issue per spec FILE: the file is the unit an owner fixes, and a
 * file-level title keeps the dedupe stable across runs. Two failures in
 * the same file are ONE issue with two entries.
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

function issueBody(file, failures, venue, runStamp) {
  return [
    'Filed by the local e2e run (`tests/e2e/run/run-local-e2e.sh`).',
    '',
    `- venue: \`${venue}\``,
    ...(process.env[VENUE_IP_ENV]
      ? [
          `- the runner resolved the venue name to ` +
            `\`${process.env[VENUE_HOST_ENV] || '(the BASE_URL host)'}\` = \`${process.env[VENUE_IP_ENV]}\``,
        ]
      : []),
    `- run: ${runStamp}`,
    specFileMarker(file),
    `- failing tests: ${failures.length}`,
    '',
    '## Failures',
    '',
    ...failures.slice(0, MAX_FAILURES_PER_ISSUE).flatMap((failure) => [
      `### ${failure.title}`,
      '',
      '```',
      failure.error,
      '```',
      '',
    ]),
    ...(failures.length > MAX_FAILURES_PER_ISSUE
      ? [`(${failures.length - MAX_FAILURES_PER_ISSUE} more failures omitted.)`, '']
      : []),
    '## Reproduce',
    '',
    '```bash',
    reproduceCommand(venue),
    '```',
    '',
    'The failure output is in this issue; the run also writes a JSON and a JUnit report',
    'under `reports/` on the machine that ran it.',
  ].join('\n');
}

/**
 * The comment posted on an issue that already tracks the failure.
 */
function commentBody(files, venue, runStamp) {
  // One argv element carries the whole comment, so the cap is the COMMENT's
  // budget, not each file's — an umbrella issue tracking many files must not
  // push the body past the kernel's per-argument cap either.
  let budget = MAX_FAILURES_PER_ISSUE;
  return [
    `The local e2e run is still red on ${files.length} spec file(s) this issue covers ` +
      `(${runStamp}, venue \`${venue}\`).`,
    '',
    ...files.flatMap((entry) => {
      const taken = entry.failures.slice(0, Math.max(0, budget));
      budget -= taken.length;
      return [
        `### ${entry.file}`,
        '',
        ...taken.flatMap((failure) => [`**${failure.title}**`, '```', failure.error, '```', '']),
        ...(entry.failures.length > taken.length
          ? [`(${entry.failures.length - taken.length} more failures omitted.)`, '']
          : []),
      ];
    }),
  ].join('\n');
}

/**
 * Why the tracker refused. The tracker's own message is the first line of
 * the glab process's stderr; the command that failed is in the error's
 * message and is not useful to a reader.
 */
function trackerReason(error) {
  const stderr = (error.stderr || '').trim();
  const firstStderrLine = stderr.split('\n').find((line) => line.trim().length > 0);
  if (firstStderrLine) return firstStderrLine.trim();
  return error.message.split('\n').slice(0, 2).join(' | ');
}

function createIssue(file, failures, venue, runStamp) {
  const title = `test(e2e): ${file} is red on the local run`;
  const created = JSON.parse(
    glab([
      '-X',
      'POST',
      `projects/${GITLAB_PROJECT_ID}/issues`,
      '-f',
      `title=${title}`,
      '-f',
      `description=${issueBody(file, failures, venue, runStamp)}`,
      '-f',
      `labels=${LABELS.join(',')}`,
    ])
  );
  process.stdout.write(`  #${created.iid} (created) ${title}\n`);
  return created.iid;
}

function commentOnIssue(issue, files, venue, runStamp) {
  glab([
    '-X',
    'POST',
    `projects/${GITLAB_PROJECT_ID}/issues/${issue.iid}/notes`,
    '-f',
    `body=${commentBody(files, venue, runStamp)}`,
  ]);
  process.stdout.write(`  #${issue.iid} (commented) ${issue.title}\n`);
}

function main() {
  const fileIssues = process.argv.includes('--file-issues');
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
  // file issues naming https://localhost with a reproduce command that
  // reproduces nothing.
  const venue = venueValue || BASE_URL;
  const runStamp = report.stats && report.stats.startTime ? report.stats.startTime : new Date().toISOString();

  const tests = collectTests(report.suites);
  // A run that executed NOTHING is not a green run — it is a run that did
  // not happen. The suite's own rule: a green must never mean "nothing ran".
  if (tests.length === 0) {
    fail('the run executed no test — a green that means "nothing ran" is not a result');
  }

  // The report's status vocabulary is expected | unexpected | flaky | skipped:
  // a test that passed is 'expected', and ONLY 'unexpected' is a failure.
  // Reading anything that is not 'passed' as a failure files an issue for
  // every green spec — the whole point of the path is that the issues it
  // files mean something.
  const skipped = tests.filter((entry) => entry.test.status === 'skipped');
  const failed = tests.filter((entry) => entry.test.status === 'unexpected');

  const stats = report.stats || {};
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
    process.stdout.write('\nno failure to file.\n');
    return;
  }

  // The venue must be re-probed BEFORE the failures are classified: the
  // venue-availability report below asserts "the venue answered the
  // re-probe", and an assertion about an observation that has not
  // happened yet is a lie whichever way the venue answers. The probe
  // answers "is the venue drivable NOW" — the same check the run started
  // with — and it runs in BOTH modes: the dry run's whole value is
  // showing what the failure path WOULD do, so its report needs the same
  // honest observation. The documented venue-death case (the node
  // reboots mid-run) fails every spec that navigates afterwards with
  // ERR_CONNECTION_REFUSED, and filing one issue per spec file for that
  // single cause is exactly the tracker noise the failure path exists to
  // prevent.
  try {
    execFileSync('node', [path.join(__dirname, 'preflight.js')], {
      stdio: 'inherit',
      env: { ...process.env, BASE_URL: venue },
    });
  } catch {
    process.stderr.write(
      'file-failure-issues: the venue is not drivable — the failures are a venue event, ' +
        'not per-spec findings. NOTHING is filed; re-run the suite once the venue answers.\n'
    );
    process.exit(1);
  }

  // The healed-outage case (#1783): a venue that went away MID-RUN and
  // came back passes the re-probe above, and without the signature filter
  // the run would file one product issue per spec file for a single venue
  // event (the 2026-11-10 node reboot filed exactly that). Failures whose
  // error carries an edge-transport signature are grouped into ONE
  // venue-availability report instead; a file whose OTHER failures
  // survive the filter still gets filed for those.
  const { fileable: byFile, noise: venueNoise } = partitionVenueNoise(groupFailuresByFile(failed));
  if (venueNoise.size > 0) {
    process.stdout.write(venueAvailabilityReport(venueNoise, venue) + '\n');
  }
  if (byFile.size === 0) {
    process.stdout.write(
      '\nnothing was filed — every failure carries the venue-outage signature; the report above is the record.\n'
    );
    return;
  }

  process.stdout.write(`\nfailing spec files: ${byFile.size}\n`);
  if (!fileIssues) {
    for (const [file, failures] of byFile) {
      process.stdout.write(`  - ${file} (${failures.length})\n`);
    }
    process.stdout.write('\nre-run with --file-issues to file them as status::backlog issues.\n');
    return;
  }

  process.stdout.write('\nfiled:\n');
  // The failing files are grouped by the issue that already tracks them, so
  // one umbrella issue receives ONE comment for the whole run — not one per
  // file. A file nobody tracks yet gets its own issue.
  const openIssues = fetchOpenIssues();
  const byIssue = new Map();
  const errors = [];
  for (const [file, failures] of byFile) {
    const tracked = findTrackedIssue(file, openIssues);
    try {
      if (!tracked) {
        createIssue(file, failures, venue, runStamp);
        continue;
      }
      const entry = byIssue.get(tracked.iid) || { issue: tracked, files: [] };
      entry.files.push({ file, failures });
      byIssue.set(tracked.iid, entry);
    } catch (e) {
      // One tracker error must not swallow the remaining failures.
      errors.push(`${file}: ${trackerReason(e)}`);
      process.stdout.write(`  ! ${file} could not be filed: ${trackerReason(e)}\n`);
    }
  }
  for (const { issue, files } of byIssue.values()) {
    try {
      commentOnIssue(issue, files, venue, runStamp);
    } catch (e) {
      for (const entry of files) {
        errors.push(`${entry.file}: ${trackerReason(e)}`);
      }
      process.stdout.write(`  ! #${issue.iid} could not be commented: ${trackerReason(e)}\n`);
    }
  }

  if (errors.length > 0) {
    process.stderr.write(
      `\nfile-failure-issues: ${errors.length} failing file(s) could NOT be filed — ` +
        'the run is red and the tracker does not know it yet:\n' +
        errors.map((line) => `  - ${line}`).join('\n') +
        '\n'
    );
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

// Exposed for the unit spec: the dedupe rule, the refusal wording and
// the venue-outage partition are behaviour, and behaviour is tested,
// not trusted.
module.exports = {
  findTrackedIssue,
  specPathsIn,
  titleIsDedicatedTo,
  trackerReason,
  groupFailuresByFile,
  issueBody,
  isConnectionSignature,
  partitionVenueNoise,
  venueAvailabilityReport,
};
