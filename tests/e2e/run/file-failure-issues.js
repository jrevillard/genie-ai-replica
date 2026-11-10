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

const TESTS_E2E_ROOT = 'tests/e2e';
const GITLAB_HOST = process.env.GITLAB_HOST || 'opensource.unicc.org';
const GITLAB_PROJECT_ID = process.env.GITLAB_PROJECT_ID || '90';

// The label set a filed failure carries. `status::backlog` is set AT CREATION
// and never moved again; the other two say what kind of finding it is.
const LABELS = ['status::backlog', 'type::bug', 'area::testing'];

// How much of a failure's log travels into the issue. Enough to act on
// (the assertion, the observed value, the first stack frames), not the whole
// browser trace.
const MAX_ERROR_LINES = 40;

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
    const isFileSuite = suite.title && /\.(?:spec|test)\.[cm]?[jt]sx?$/.test(suite.title);
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
  return text.split('\n').slice(0, MAX_ERROR_LINES).join('\n');
}

function glab(args) {
  return execFileSync('glab', ['api', '--hostname', GITLAB_HOST, ...args], {
    encoding: 'utf-8',
    maxBuffer: 32 * 1024 * 1024,
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
 * spec file mentions the file's repository path in its title or in its
 * description.
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
 * Does this text mention the spec file's path?
 *
 * The path is matched as a PATH TOKEN — a maximal run of path characters —
 * so it is found whether the issue names the file by its repository path or
 * by an absolute path or a URL that ends with it. A token that ends with
 * the file's path but whose PREFIX is itself inside the e2e tree is a
 * DIFFERENT file that happens to carry this one's path as its tail
 * (`tests/e2e/helpers/tests/e2e/theme-runtime-config.spec.js` is not the
 * file `tests/e2e/theme-runtime-config.spec.js`): such a token is refused,
 * or one file's issue swallows another's failure.
 */
function mentionsPath(text, file) {
  const tokens = text.match(/[A-Za-z0-9_./-]+/g) || [];
  return tokens.some((token) => {
    if (token === file) return true;
    if (!token.endsWith(`/${file}`)) return false;
    const prefix = token.slice(0, token.length - file.length - 1);
    return !prefix.includes(`${TESTS_E2E_ROOT}/`);
  });
}

/**
 * The open issue that already tracks this spec file, or null.
 *
 * An issue that already tracks the failure must NOT be duplicated: the run
 * comments on it instead, and a spec file nobody tracks yet gets its own
 * issue. The file's own dedicated issue (the one this script files, whose
 * title carries the path) wins over an umbrella that merely mentions the
 * file.
 */
function findTrackedIssue(file, openIssues) {
  const matches = openIssues.filter((issue) =>
    mentionsPath(`${issue.title}\n${issue.description || ''}`, file)
  );
  if (matches.length === 0) return null;
  const dedicated = matches.find((issue) => mentionsPath(issue.title, file));
  return dedicated || matches[0];
}

/**
 * The command that reproduces the run, as the run itself was launched: the
 * address the runner resolved the venue NAME to included, or the command is
 * a DNS failure waiting to happen.
 */
function reproduceCommand(venue) {
  const parts = [`BASE_URL=${venue}`];
  if (process.env.E2E_VENUE_IP) {
    // Only when the runner knows the host: a placeholder here would paste
    // an array into the command.
    if (process.env.E2E_VENUE_HOST) parts.push(`E2E_VENUE_HOST=${process.env.E2E_VENUE_HOST}`);
    parts.push(`E2E_VENUE_IP=${process.env.E2E_VENUE_IP}`);
  }
  return `${parts.join(' ')} tests/e2e/run/run-local-e2e.sh`;
}

/**
 * The issue body of a spec file nobody tracks yet.
 */
function issueBody(file, failures, venue, runStamp) {
  return [
    'Filed by the local e2e run (`tests/e2e/run/run-local-e2e.sh`).',
    '',
    `- venue: \`${venue}\``,
    ...(process.env.E2E_VENUE_IP
      ? [
          `- the runner resolved the venue name to ` +
            `\`${process.env.E2E_VENUE_HOST || '(the BASE_URL host)'}\` = \`${process.env.E2E_VENUE_IP}\``,
        ]
      : []),
    `- run: ${runStamp}`,
    `- spec file: \`${file}\``,
    `- failing tests: ${failures.length}`,
    '',
    '## Failures',
    '',
    ...failures.flatMap((failure) => [
      `### ${failure.title}`,
      '',
      '```',
      failure.error,
      '```',
      '',
    ]),
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
  return [
    `The local e2e run is still red on ${files.length} spec file(s) this issue covers ` +
      `(${runStamp}, venue \`${venue}\`).`,
    '',
    ...files.flatMap((entry) => [
      `### ${entry.file}`,
      '',
      ...entry.failures.flatMap((failure) => [`**${failure.title}**`, '```', failure.error, '```', '']),
    ]),
  ].join('\n');
}

/**
 * Why the tracker refused. The glab error's first line is the command that
 * failed; the tracker's own message is on the next one.
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
  if (reportFlag !== -1 && !process.argv[reportFlag + 1]) {
    fail('--report needs the path of the report to read');
  }
  const reportPath =
    reportFlag === -1 ? DEFAULT_REPORT_PATH : path.resolve(process.argv[reportFlag + 1]);
  const report = readReport(reportPath);
  const venue = process.env.BASE_URL || 'https://localhost';
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

  // One issue per spec FILE: the file is the unit an owner fixes, and a
  // file-level title keeps the dedupe stable across runs.
  const byFile = new Map();
  for (const entry of failed) {
    const list = byFile.get(entry.file) || [];
    const result = (entry.test.results || [])[entry.test.results.length - 1];
    list.push({ title: entry.title, error: errorText(result) });
    byFile.set(entry.file, list);
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

main();
