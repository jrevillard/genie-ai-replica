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
 *     with the same title gets a COMMENT instead of a second issue, so a
 *     suite that stays red does not flood the tracker.
 *
 * Usage:
 *   node tests/e2e/run/file-failure-issues.js [--file-issues]
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
const REPORT_PATH = path.join(REPO_ROOT, 'reports', 'playwright-report.xml');
const JSON_REPORT_PATH = path.join(REPO_ROOT, 'reports', 'playwright-report.json');

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

function readReport() {
  if (!fs.existsSync(JSON_REPORT_PATH)) {
    fail(
      `no JSON report at ${JSON_REPORT_PATH} — the run must write one (playwright.config.js ` +
        'declares the json reporter) before its outcome can be read'
    );
  }
  let report;
  try {
    report = JSON.parse(fs.readFileSync(JSON_REPORT_PATH, 'utf-8'));
  } catch (e) {
    fail(`the JSON report at ${JSON_REPORT_PATH} is not readable as JSON: ${e.message}`);
  }
  if (!report || !Array.isArray(report.suites)) {
    fail(`the JSON report at ${JSON_REPORT_PATH} carries no suites — it is not a Playwright report`);
  }
  return report;
}

/** Every test in the report, with the file it belongs to. */
function collectTests(suites, inheritedFile, out = []) {
  for (const suite of suites || []) {
    const file = suite.file || inheritedFile;
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        out.push({ file: repoPath(file), title: spec.title, test });
      }
    }
    collectTests(suite.suites, file, out);
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
 * The open issue with this exact title, or null. The tracker search is
 * fuzzy; the title match is exact, so a similar issue from another wave is
 * not mistaken for this one.
 */
function findOpenIssue(title) {
  let issues;
  try {
    issues = JSON.parse(
      glab([`projects/${GITLAB_PROJECT_ID}/issues?state=opened&search=${encodeURIComponent(title)}&per_page=50`])
    );
  } catch (e) {
    fail(`the tracker could not be read: ${e.message}`);
  }
  if (!Array.isArray(issues)) return null;
  return issues.find((issue) => issue.title === title) || null;
}

function fileIssue(file, failures, venue, runStamp) {
  const title = `test(e2e): ${file} is red on the local run`;
  const body = [
    'Filed by the local e2e run (`tests/e2e/run/run-local-e2e.sh`).',
    '',
    `- venue: \`${venue}\``,
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
    `BASE_URL=${venue} tests/e2e/run/run-local-e2e.sh`,
    '```',
    '',
    `The full log of the run is in the JSON report (\`reports/playwright-report.json\`) and the`,
    `JUnit report (\`${path.relative(REPO_ROOT, REPORT_PATH)}\`).`,
  ].join('\n');

  const existing = findOpenIssue(title);
  if (existing) {
    const comment = [
      `The local e2e run is still red on this spec file (${runStamp}, venue \`${venue}\`).`,
      '',
      ...failures.flatMap((failure) => [`**${failure.title}**`, '```', failure.error, '```', '']),
    ].join('\n');
    try {
      glab(['-X', 'POST', `projects/${GITLAB_PROJECT_ID}/issues/${existing.iid}/notes`, '-f', `body=${comment}`]);
    } catch (e) {
      fail(`the comment on issue #${existing.iid} could not be posted: ${e.message}`);
    }
    process.stdout.write(`  #${existing.iid} (existing) ${title}\n`);
    return { iid: existing.iid, created: false };
  }

  try {
    const created = JSON.parse(
      glab([
        '-X',
        'POST',
        `projects/${GITLAB_PROJECT_ID}/issues`,
        '-f',
        `title=${title}`,
        '-f',
        `description=${body}`,
        '-f',
        `labels=${LABELS.join(',')}`,
      ])
    );
    process.stdout.write(`  #${created.iid} (created) ${title}\n`);
    return { iid: created.iid, created: true };
  } catch (e) {
    fail(`the issue for ${file} could not be filed: ${e.message}`);
  }
}

function main() {
  const fileIssues = process.argv.includes('--file-issues');
  const report = readReport();
  const venue = process.env.BASE_URL || 'https://localhost';
  const runStamp = report.stats && report.stats.startTime ? report.stats.startTime : new Date().toISOString();

  const tests = collectTests(report.suites);
  const skipped = tests.filter((entry) => entry.test.status === 'skipped');
  const failed = tests.filter((entry) => entry.test.status !== 'passed' && entry.test.status !== 'skipped');

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
  for (const [file, failures] of byFile) {
    fileIssue(file, failures, venue, runStamp);
  }
}

main();
