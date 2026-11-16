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
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');
// The report the run read: the runner moves the fresh report to a
// per-run name before handing it over, so a later `playwright test --list`
// (or any other invocation) in the same checkout cannot replace the
// evidence this path files from.
const DEFAULT_REPORT_PATH = path.join(REPO_ROOT, 'reports', 'playwright-report.json');

const { VENUE_IP_ENV, VENUE_HOST_ENV } = require('../helpers/venue-launch-args');
// The venue's SERVED bundle — the read that tells a stale venue from a
// product defect (#1895, #1896).
const { handlesIn, bundleServesHandle, checkoutDeclaredHandles, fetchVenueBundleText } = require('./venue-bundle');
// The app's source tree, repo-relative: the path the build proof reads.
const FRONTEND_SRC_REL = 'components/gov-chat-frontend/src';
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
      'edge-transport signature — the browser never reached the app:'
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

/**
 * The handles a failure's LOCATOR names.
 *
 * Playwright prints the locator it was waiting on in the `Locator:` line
 * of an expect() failure — that is the element the failure is about. The
 * code frame below it is the SPEC's own source and names other handles;
 * only the locator line counts, or a failure would carry every handle
 * its file mentions.
 *
 * @param {string} errorText - the failure's error text
 * @returns {string[]} the handle values the locator names
 */
function locatorHandles(errorText) {
  const line = String(errorText || '')
    .split('\n')
    .find((candidate) => candidate.trim().startsWith('Locator:'));
  if (!line) return [];
  // The attribute spelling (`[data-testid="x"]`) and Playwright's own
  // `getByTestId('x')` name the SAME handle in two spellings. The second
  // carries no attribute, so the attribute scan alone would miss it — and
  // the classification would go silently inert for that spelling.
  const byAttribute = handlesIn(line);
  const byTestId = Array.from(line.matchAll(/getByTestId\(\s*['"]([^'"]+)['"]\s*\)/g)).map((match) => match[1]);
  return [...new Set([...byAttribute, ...byTestId])];
}

/**
 * Does this failure say the element was NOT FOUND?
 *
 * "element(s) not found" is the signature of a MISSING element.
 * "element is not visible" and "element is not enabled" are the
 * signatures of an element that IS there and misbehaves — a product
 * finding, never a stale venue.
 *
 * @param {string} errorText - the failure's error text
 * @returns {boolean} whether the element was not found
 */
function isNotFoundFailure(errorText) {
  return /element\(s\) not found/.test(String(errorText || ''));
}

/**
 * Does the app's COMMITTED source declare the handle?
 *
 * This is the strict half of the proof: the checkout's own declaration
 * must be a real binding in the app's source, and the frontend's Jest
 * tree does not count — a handle committed only in a test is carried by
 * no build, so no build can serve it, and a verdict built on it would
 * drop a failure the operator must see.
 *
 * @param {string} handle - the handle value
 * @returns {true|false|null} true = the committed app declares it, false =
 *   it does not, null = the checkout could not answer
 */
function handleCommittedAtHead(handle) {
  const escaped = String(handle).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  try {
    execFileSync(
      'git',
      [
        'grep',
        '-q',
        '-E',
        `data-test(id|-id)\\s*=\\s*["']${escaped}["']`,
        'HEAD',
        '--',
        FRONTEND_SRC_REL,
        // The same rule the working-tree walk holds to on the EXCLUSION:
        // every directory NAMED __tests__ or __mocks__, at any depth, is
        // excluded — the two readers must not diverge on what a
        // declaration is. (On a DYNAMIC binding — `:data-testid="x"` —
        // this reader is the loose one: the value is not known, so the
        // string counts. The direction is safe: a handle counted as
        // declared here can only make the verdict refuse, never make it
        // fire.)
        ':(exclude,glob)**/__tests__/**',
        ':(exclude,glob)**/__mocks__/**'
      ],
      { cwd: REPO_ROOT, stdio: 'ignore' }
    );
    return true;
  } catch (error) {
    // git grep exits 1 for "no match" and 128 for "cannot read it".
    return error.status === 1 ? false : null;
  }
}

/**
 * Does the app's source tree exist AT THIS BUILD?
 *
 * `git grep` over a path a build does not have answers "nothing is
 * declared" — which is a DIFFERENT fact from "the handle is not
 * declared", and one that would license the verdict. The pathspec's
 * existence is checked first.
 *
 * @param {string} sha - the build to read
 * @returns {boolean} whether the app's source tree is there
 */
function sourceTreeExistsAt(sha) {
  try {
    const out = execFileSync('git', ['ls-tree', '-r', '--name-only', sha, '--', FRONTEND_SRC_REL], {
      cwd: REPO_ROOT,
      encoding: 'utf-8',
      maxBuffer: 32 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'ignore']
    });
    return out.trim().length > 0;
  } catch {
    return false;
  }
}

/**
 * Does the app's source AT THIS BUILD declare the handle?
 *
 * The question the verdict rests on: the venue's bundle does not carry
 * the handle and the checkout declares it — but did the app DECLARE it
 * at the venue's build, or did the declaration arrive LATER? The answer
 * is read from that build (`git grep` at that commit), not inferred
 * from the checkout's shape.
 *
 * The search is the raw handle string inside the app's source tree: a
 * handle that appears there at the build counts as declared. The search
 * is deliberately loose (it would also match a mention in a comment),
 * because the loose answer is the CONSERVATIVE one: a handle that was
 * already there is the app's own build dropping it — a product defect,
 * filed as one.
 *
 * @param {string} sha - the build to read
 * @param {string} handle - the handle value
 * @returns {true|false|null} true = the build declares it, false = it does
 *   not, null = the build could not be read
 */
function handleDeclaredAtBuild(sha, handle) {
  try {
    execFileSync('git', ['grep', '-q', '-F', handle, sha, '--', FRONTEND_SRC_REL], {
      cwd: REPO_ROOT,
      stdio: 'ignore'
    });
    return true;
  } catch (error) {
    // git grep exits 1 for "not found" and 128 for "cannot read it".
    return error.status === 1 ? false : null;
  }
}

/**
 * Is this build an ancestor of the checkout's HEAD?
 *
 * A build that is not behind the checkout cannot be "stale" in the sense
 * the verdict uses: it is either AHEAD of the checkout or on another
 * line, and neither is a venue that fell behind.
 *
 * The three answers are kept apart: a build the checkout CANNOT READ (a
 * shallow clone, an unknown sha) is not the same fact as a build it can
 * read and knows is not behind — the first is a checkout that cannot
 * answer, the second is an answer.
 *
 * @param {string} sha - the build to test
 * @param {Function} [run] - the git call (injectable for the unit spec)
 * @returns {'ancestor'|'not-ancestor'|'unknown'} the relation
 */
function ancestryOfHead(sha, run = execFileSync) {
  try {
    run('git', ['merge-base', '--is-ancestor', sha, 'HEAD'], {
      cwd: REPO_ROOT,
      stdio: 'ignore'
    });
    return 'ancestor';
  } catch (error) {
    // Exit 1: the build is known and is not an ancestor. Exit 128 (or a
    // missing git): the checkout cannot answer at all.
    return error.status === 1 ? 'not-ancestor' : 'unknown';
  }
}

/**
 * The build the RUN was made against.
 *
 * The runner writes the sha its pre-flight read BESIDE the run's own
 * report, so the build travels with the report — whether the runner
 * files it or a human does, in a shell that inherits nothing.
 *
 * The sidecar is the ONLY source: an ambient marker in the environment
 * names SOME run, not necessarily this one, and binding this report's
 * failures to another run's build is the one confusion the binding
 * exists to prevent. A report with no sidecar carries no build, and its
 * failures are filed as they are.
 *
 * @param {string} reportPath - the report the failure path reads
 * @returns {string|null} the sha, or null when the run carried none
 */
function runBuildSha(reportPath) {
  try {
    const sidecar = JSON.parse(fs.readFileSync(sidecarPath(reportPath), 'utf-8'));
    const sha = sidecar && sidecar.git_sha;
    return typeof sha === 'string' && sha && sha !== 'unknown' ? sha : null;
  } catch {
    return null;
  }
}

/**
 * The sidecar that carries a run's build, next to the run's own report.
 *
 * @param {string} reportPath - the report the failure path reads
 * @returns {string} the sidecar path
 */
function sidecarPath(reportPath) {
  return `${reportPath.replace(/\.json$/, '')}.build.json`;
}

/**
 * The build the VENUE SERVES NOW, from the pre-flight's scratch file.
 *
 * @param {string} file - the scratch file the pre-flight wrote
 * @returns {string|null} the sha, or null when the venue serves none
 */
function readVenueBuildSha(file) {
  try {
    const sha = fs.readFileSync(file, 'utf-8').trim();
    return sha && sha !== 'unknown' ? sha : null;
  } catch {
    return null;
  }
}

/**
 * The pre-flight, spawned the way the failure path needs it: the venue
 * address, and the scratch file the marker is handed over through (an
 * env var cannot cross back out of a child process).
 *
 * @param {object} env - the environment additions
 */
function spawnPreflight(env) {
  execFileSync('node', [path.join(__dirname, 'preflight.js')], {
    stdio: 'inherit',
    env: { ...process.env, ...env }
  });
}

/**
 * The venue's CURRENT build marker: the pre-flight reads /build-info.json
 * and hands the sha over through a scratch file.
 *
 * The scratch path is a FILE inside a directory of its own. The
 * pre-flight writes the marker with writeFileSync, and a scratch path
 * that is itself a directory is a path the marker cannot be written to —
 * the defect that left the whole verdict inert while the run printed a
 * plausible note about it.
 *
 * @param {string} venue - the venue address
 * @param {(env: object) => void} [spawn] - the pre-flight spawn (injectable for the unit spec)
 * @returns {{sha: string|null, failed: boolean}} the venue's build, and whether the pre-flight failed
 */
function probeVenueBuildSha(venue, spawn = spawnPreflight) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'file-failure-issues-build-'));
  const file = path.join(dir, 'build');
  let sha;
  let failed = false;
  try {
    spawn({ BASE_URL: venue, E2E_VENUE_BUILD_FILE: file });
  } catch {
    failed = true;
  } finally {
    sha = readVenueBuildSha(file);
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return { sha, failed };
}

/**
 * Is this missing handle the VENUE's fault — its build cannot serve it?
 *
 * The proof has three links and all three must hold:
 *
 *  1. the venue's served bundle does not carry the handle (observed);
 *  2. the checkout declares it (observed);
 *  3. the app's source AT THE VENUE'S BUILD does not declare it either
 *     (read from that build) — so the declaration is newer than the
 *     venue's build and the venue cannot serve it.
 *
 * Link 3 is what tells a stale venue from a product defect: a build that
 * DID declare the handle and did not ship it is the app's own build
 * dropping it — a product defect, filed as one.
 *
 * @param {{handle: string, source: string}} candidate - the missing handle
 * @param {{boundSha: string|null, declaredAtBuild?: Function}} context - the venue's bound build and the build reader
 * @returns {'stale'|'declared'|'unreadable'|'not-stale'} the verdict: the
 *   venue's build cannot serve it, the build DID declare it (the app's own
 *   build dropped it), the build could not be read (the verdict is
 *   refused), or there is no bound build to read
 */
function venueStaleProof(candidate, context) {
  if (!context.boundSha) return 'not-stale';
  const read = context.declaredAtBuild || handleDeclaredAtBuild;
  const declared = read(context.boundSha, candidate.handle);
  if (declared === false) return 'stale';
  if (declared === true) return 'declared';
  // The build could not be read: the verdict is refused, and the refusal
  // is reported — a silent refusal is indistinguishable from a proof
  // that said no.
  return 'unreadable';
}

/**
 * The handles this failure waits for that the VENUE DOES NOT SERVE while
 * the CHECKOUT DECLARES them — the stale-venue signature.
 *
 * A handle the venue does not serve AND the checkout does not declare is
 * a SPEC defect (the app never had it): it is not a stale venue, and it
 * is filed as the product finding it is.
 *
 * @param {{error: string}} failure - the failure
 * @param {{servedText: string, declared: Map<string, string>}} context - the venue's served bundle and the checkout's declarations
 * @returns {Array<{handle: string, source: string}>} the missing handles, with the file that declares each
 */
function staleVenueHandles(failure, context) {
  if (!isNotFoundFailure(failure?.error)) return [];
  const missing = [];
  for (const handle of locatorHandles(failure.error)) {
    if (bundleServesHandle(context.servedText, handle)) continue;
    const source = context.declared.get(handle);
    // Neither the venue nor the checkout has it: no build can serve it
    // — a SPEC defect. It stays a candidate, so that a compound locator
    // carrying it beside a stale handle is filed rather than classified:
    // the spec defect must not disappear behind the stale one.
    missing.push({ handle, source: source || null, specDefect: !source });
  }
  return missing;
}

/**
 * Split the grouped failures into what is FILEABLE and what the STALE
 * VENUE explains (#1895, #1896).
 *
 * The shape is the venue-outage partition's: a failure the venue's older
 * build explains drops out of the filing, and a file whose OTHER
 * failures survive the split stays fileable for exactly those.
 *
 * @param {Map<string, Array<{error: string}>>} byFile - the grouped failures
 * @param {{servedText: string, declared: Map<string, string>, boundSha?: string|null}} context - the venue's served bundle, the checkout's declarations and the bound build
 * @returns {{fileable: Map<string, Array<{error: string}>>, stale: Map<string, {failures: Array<{error: string}>, missing: Map<string, string>}>, refused: Array<{handle: string, source: string}>}} the fileable failures, the venue-explained ones, and the candidates whose proof could not read the build
 */
function partitionStaleVenue(byFile, context) {
  const fileable = new Map();
  const stale = new Map();
  const refused = [];
  for (const [file, failures] of byFile) {
    const explained = [];
    const rest = [];
    const missing = new Map();
    for (const failure of failures) {
      // The candidates are the handles the venue does not serve; the
      // PROOF decides. A candidate the venue's own build DID declare is
      // the app's build dropping it — a product defect, filed as one.
      const candidates = staleVenueHandles(failure, context);
      if (candidates.length === 0) {
        rest.push(failure);
        continue;
      }
      // The declaration must be in the COMMITTED app. The working tree
      // is what the run exercises, but no build of it exists: a handle
      // that lives only in an uncommitted edit (or only in a test) is
      // not the venue's fault — no commit carries it, so no build can
      // serve it — and classifying it as a stale venue would drop the
      // failure out of the filing with a remedy (a venue refresh) that
      // cannot help.
      const committed = context.committedAtHead || handleCommittedAtHead;
      const verdicts = [];
      for (const candidate of candidates) {
        if (candidate.specDefect) {
          // No build can serve it: the spec waits for a handle nobody
          // declares. It is a spec defect, filed as one — and the
          // failure must not be classified as the venue's.
          refused.push({
            handle: candidate.handle,
            reason: 'no build can serve it — no source declares it'
          });
          verdicts.push({ candidate, verdict: 'not-stale' });
          continue;
        }
        const declaration = committed(candidate.handle);
        if (declaration !== true) {
          // Not committed, or the checkout cannot answer: the failure is
          // filed, and the reason is named — a silent refusal is
          // indistinguishable from a verdict.
          refused.push({
            handle: candidate.handle,
            reason: declaration === null ? 'the checkout could not read the committed source' : 'no commit declares it'
          });
          verdicts.push({ candidate, verdict: 'not-stale' });
          continue;
        }
        verdicts.push({ candidate, verdict: venueStaleProof(candidate, context) });
      }
      for (const { candidate, verdict } of verdicts) {
        if (verdict === 'unreadable' && !refused.some((entry) => entry.handle === candidate.handle)) {
          refused.push({ handle: candidate.handle, reason: "the venue's build could not be read" });
        }
      }
      // EVERY candidate must be proven stale. A locator that names a
      // handle the venue cannot serve AND a handle the app's own build
      // dropped carries two causes, and the product defect must not be
      // silenced by the stale one.
      if (!verdicts.every((entry) => entry.verdict === 'stale')) {
        rest.push(failure);
        continue;
      }
      explained.push(failure);
      for (const { candidate } of verdicts) {
        if (!missing.has(candidate.handle)) missing.set(candidate.handle, candidate.source);
      }
    }
    if (rest.length > 0) fileable.set(file, rest);
    if (explained.length > 0) stale.set(file, { failures: explained, missing });
  }
  return { fileable, stale, refused };
}

/**
 * The ONE venue-staleness report that replaces one product issue per
 * spec file for a venue serving an older frontend build (#1895, #1896):
 * the venue, the missing handles, the file that declares each, and the
 * remedy. Pure string — the caller prints it, the unit spec asserts it.
 *
 * @param {Map<string, {failures: Array<{error: string}>, missing: Map<string, string>}>} stale - per spec file, the venue-explained failures
 * @param {string} venue - the venue address the failed run pointed at
 * @returns {string} the report text (no trailing newline)
 */
function venueStalenessReport(stale, venue, context = {}) {
  const total = [...stale.values()].reduce((sum, entry) => sum + entry.failures.length, 0);
  const build = context.boundSha ? ` (the venue's build \`${context.boundSha}\` does not declare it either)` : '';
  const lines = [
    '',
    `venue-staleness report: ${total} failure(s) across ${stale.size} spec file(s) wait for a handle ` +
      'the VENUE DOES NOT SERVE while the checkout DECLARES it — the venue serves a build that ' +
      `predates the declaration${build}:`
  ];
  for (const [file, entry] of stale) {
    lines.push(`  - ${file}: ${entry.failures.length} failure(s)`);
    for (const [handle, source] of entry.missing) {
      lines.push(
        `      handle \`${handle}\` — declared by the checkout in ${source}, absent from the venue's served bundle`
      );
    }
  }
  lines.push(
    `The venue answered the re-probe at ${venue} — the failure belongs to the VENUE's build, not to ` +
      'the product: nothing is filed for these failures. The run is still RED.'
  );
  lines.push(
    "Refresh the venue's frontend build (the stale-venue remedy: docs/e2e-tests/local-run.md) and " +
      're-run the suite.'
  );
  return lines.join('\n');
}

/**
 * The read that tells a stale venue from a product defect — the venue's
 * SERVED bundle, and the checkout's declarations.
 *
 * The read is made only when a failure is a not-found (nothing else can
 * be a stale venue), and it is ADDITIVE: when the bundle cannot be read,
 * the caller files the failures exactly as it did before, with the reason
 * printed. Nothing is ever suppressed by a read that could not be made.
 *
 * @param {string} venue - the venue address the failed run pointed at
 * @param {Map<string, Array<{error: string}>>} byFile - the grouped failures
 * @returns {Promise<{ok: boolean, servedText?: string, declared?: Map<string, string>, note?: string}>} the context, or the reason there is none
 */
async function buildStaleVenueContext(venue, byFile, options = {}) {
  const failures = [...byFile.values()].flat();
  if (!failures.some((failure) => isNotFoundFailure(failure.error))) {
    return { ok: false, note: null };
  }
  // The transport is injectable (the same seam venue-bundle.js owns): the
  // unit spec pins the context's arms without a venue.
  let servedText;
  try {
    servedText = await fetchVenueBundleText(venue, options.request ? { request: options.request } : {});
  } catch (error) {
    return {
      ok: false,
      note: `the venue's served bundle could not be read (${error.message}) — the failures are filed ` + 'as they are.'
    };
  }
  // The checkout's declarations are read under their OWN guard: the walk
  // is additive, and a source tree that cannot be walked must degrade to
  // filing the failures as they are — never take the whole filing down.
  // The reader is injectable so the unit spec can pin that degradation.
  let declared;
  try {
    const readDeclared = options.declaredHandles || checkoutDeclaredHandles;
    declared = readDeclared();
  } catch (error) {
    return {
      ok: false,
      note:
        `the checkout's declarations could not be walked (${error.message}) — the failures are filed ` + 'as they are.'
    };
  }
  // The walk must have read the APP: a bundle carrying NONE of the
  // checkout's handles is not this app, and a verdict built on it would
  // be a guess dressed as a finding.
  const served = [...declared.keys()].some((handle) => bundleServesHandle(servedText, handle));
  if (!served) {
    return {
      ok: false,
      note:
        "the venue's served bundle carries none of the checkout's handles — the venue's build could " +
        'not be read, so the failures are filed as they are.'
    };
  }
  return {
    ok: true,
    servedText,
    declared,
    // The build reader is injectable (the same shape as the transport
    // above): the unit spec pins the proof's arms without borrowing a
    // commit from the repository's history.
    declaredAtBuild: options.declaredAtBuild || handleDeclaredAtBuild,
    // The COMMITTED declaration is read strictly (a real binding in the
    // app's source, not in its test tree): the same injectable shape as
    // the build reader beside it.
    committedAtHead: options.committedAtHead || handleCommittedAtHead,
    ...bindVenueBuild(options)
  };
}

/**
 * Bind the venue's served bundle to the build the RUN exercised.
 *
 * A verdict about a stale venue is a verdict about a BUILD. The bundle
 * read here is the venue's bundle NOW; the failure was produced against
 * the venue THEN. The two are the same only when the venue has not
 * moved since the run — and the verdict is only made when the build is
 * also PROVABLY behind the checkout, so that "the venue is behind" is a
 * read fact and not an inference.
 *
 * @param {{runSha?: string, venueSha?: string}} options - the run's build and the venue's current build
 * @returns {{boundSha: string|null, note: string|null}} the bound build, or the reason there is none
 */
function bindVenueBuild(options = {}) {
  const runSha = options.runSha || null;
  const venueSha = options.venueSha || null;
  const ancestry = options.ancestry || ancestryOfHead;
  if (!runSha) {
    return {
      boundSha: null,
      note:
        "the run carried no build marker — the venue's bundle cannot be bound to the build that " +
        'produced these failures, so they are filed as they are.'
    };
  }
  if (!venueSha) {
    return {
      boundSha: null,
      note:
        "the venue serves no readable build marker — the venue's bundle cannot be bound to the " +
        'build that produced these failures, so they are filed as they are.'
    };
  }
  if (runSha !== venueSha) {
    return {
      boundSha: null,
      note:
        `the venue has MOVED since the run (the run exercised \`${runSha}\`, the venue now serves ` +
        `\`${venueSha}\`) — the bundle read now is not the build that produced these failures, so ` +
        'they are filed as they are.'
    };
  }
  const relation = ancestry(venueSha);
  if (relation === 'not-ancestor') {
    return {
      boundSha: null,
      note:
        `the venue's build \`${venueSha}\` is not an ancestor of this checkout's HEAD — it is not ` +
        "behind the checkout, so a missing handle is not the venue's: the failures are filed as " +
        'they are.'
    };
  }
  if (relation === 'unknown') {
    return {
      boundSha: null,
      note:
        `the venue's build \`${venueSha}\` cannot be read by this checkout (a shallow clone?) — the ` +
        'verdict is refused, so the failures are filed as they are.'
    };
  }
  // The app's source must EXIST at that build: a grep over a path the
  // build does not have answers "nothing is declared", which is a
  // different fact — and one that would license the verdict.
  const sourceTreeExists = options.sourceTreeExists || sourceTreeExistsAt;
  if (!sourceTreeExists(venueSha)) {
    return {
      boundSha: null,
      note:
        `the venue's build \`${venueSha}\` carries no app source tree — the proof cannot read it, ` +
        'so the failures are filed as they are.'
    };
  }
  return { boundSha: venueSha, note: null };
}

/**
 * The stale-venue classification, as the failure path runs it: the
 * context, the partition, and the lines the run prints.
 *
 * This is the seam the unit spec drives. The proof and the partition
 * are each pinned, but the WIRING between them and the run is what
 * decides whether the feature works at all — without a spec on this
 * level, the whole block could be deleted and every failure would be
 * filed as a product defect while the suite stayed green.
 *
 * @param {string} venue - the venue address the failed run pointed at
 * @param {Map<string, Array<{error: string}>>} byFile - the grouped failures
 * @param {object} [options] - the readers and the transport (injectable)
 * @returns {Promise<{fileable: Map<string, Array<{error: string}>>, stale: Map<string, object>, refused: Array<object>, note: string|null, reports: string[]}>} the classification and the lines to print
 */
async function classifyVenueFailures(venue, byFile, options = {}) {
  const context = await buildStaleVenueContext(venue, byFile, options);
  const { fileable, stale, refused } = context.ok
    ? partitionStaleVenue(byFile, context)
    : { fileable: byFile, stale: new Map(), refused: [] };
  const reports = [];
  if (context.note) {
    reports.push(`\n${context.note}`);
  }
  if (refused.length > 0) {
    // The verdict was refused for these handles: the failures are filed
    // as they are, and the reason is named — a silent refusal is
    // indistinguishable from a verdict.
    reports.push(
      `\nthe verdict was refused for ${refused.length} handle(s) (` +
        `${refused.map((entry) => `\`${entry.handle}\`: ${entry.reason}`).join('; ')}) — the ` +
        'failures are filed as they are.'
    );
  }
  if (stale.size > 0) {
    reports.push(venueStalenessReport(stale, venue, context));
  }
  return { fileable, stale, refused, note: context.note, reports };
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
  // The run stamp filed with every issue comes from stats.startTime — the
  // moment the red run STARTED, not the moment this filing ran. A report
  // without it would otherwise get a fabricated wall-clock stamp, and the
  // issue would misattribute the run it names (Playwright's json reporter
  // always writes stats; one that did not is not a report this path reads).
  if (!report.stats || typeof report.stats.startTime !== 'string') {
    fail(
      `the JSON report at ${reportPath} carries no stats.startTime — it is not a report the ` +
        'failure path can stamp a filed issue with'
    );
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
    timeout: TRACKER_TIMEOUT_MS
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
  let capped = true;
  for (let page = 1; page <= 20; page += 1) {
    let batch;
    try {
      batch = JSON.parse(glab([`projects/${GITLAB_PROJECT_ID}/issues?state=opened&per_page=100&page=${page}`]));
    } catch (e) {
      fail(`the tracker could not be read: ${e.message}`);
    }
    if (!Array.isArray(batch)) fail('the tracker answered with something that is not an issue list');
    issues.push(...batch);
    if (batch.length < 100) {
      capped = false;
      break;
    }
  }
  if (capped) {
    // The cap ended the read, not a short batch: issues past page 20 are
    // invisible to the dedupe, and a failure on one of them gets a SECOND
    // issue — the flood this path exists to prevent. Warn and include what
    // was read; the run stays loud about the degraded dedupe.
    console.warn(
      'file-failure-issues: the open-issue list hit the 20-page cap (2000 issues) — issues past it ' +
        'are invisible to the dedupe and a failure on an already-tracked file can be filed a second ' +
        'time. Close or mark stale issues, or raise the cap.'
    );
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
 * The e2e tree's OWN spec names (#1802): the files it has NOW, plus the
 * ones it HAS HAD.
 *
 * A bare file name in a title names this tree's spec when it is one of
 * these. The rule reads the tree's own names instead of the COMPLEMENT of
 * a repo-wide walk, which is what it used to read ("does ANY file outside
 * the tree carry this name?"): the complement's verdict depended on what
 * sits NEXT to the repo — a file outside the tree that happens to share a
 * spec name turned a bare-named dedication into a non-dedication, and the
 * failure path then filed a second issue for a file that already has one
 * — and the walk's cost grew with the checkout's shape (~0.08 s in a
 * branch worktree, ~0.8 s in a checkout carrying sibling worktrees, each
 * a full repo copy the walk had to traverse).
 *
 * "Had" comes from the tree's git history: a renamed or deleted spec's
 * bare name must stay recognised — a title naming several spec files is a
 * GROUP, not a dedication, and a file that was renamed away must still
 * count as one of them. A root with no git behind it (the unit spec's
 * synthetic checkouts) has no past names — that is the definition of
 * "had" there, not a swallowed failure.
 *
 * The set is built ONCE per root (the tree walk is bounded by the tree;
 * the git call is ~50 ms on this tree's history) and only when a bare
 * name is actually met, which is at most once per title.
 */
const e2eSpecNamesByRoot = new Map();

function e2eOwnSpecNames(root = REPO_ROOT) {
  if (e2eSpecNamesByRoot.has(root)) return e2eSpecNamesByRoot.get(root);
  const names = new Set();
  // NOW: the tree's own directory — bounded by the tree, never by the
  // checkout around it.
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
      if (entry.isDirectory()) walk(full);
      else if (SPEC_FILE_RE.test(entry.name)) names.add(entry.name);
    }
  };
  walk(path.join(root, TESTS_E2E_ROOT));
  // HAD: the tree's git history, one call.
  try {
    const out = execFileSync(
      'git',
      ['-C', root, 'log', '--format=', '--name-only', '--', TESTS_E2E_ROOT],
      // stderr is captured, not inherited: the catch below reads it to tell
      // the two failure arms apart, and an inherited stderr would print raw
      // `fatal:` lines into the run output a human scans for red — on every
      // synthetic-root case of the unit spec.
      { encoding: 'utf-8', maxBuffer: 32 * 1024 * 1024, timeout: 30000, stdio: ['ignore', 'pipe', 'pipe'] }
    );
    // A shallow checkout truncates "had": a renamed spec whose rename
    // commit is missing from the truncated history stops being
    // recognised, and the dedupe quietly degrades toward filing a second
    // issue for a file that already has one (#1802). Name the
    // degradation once — the checkout can fix it with a full fetch.
    let shallow = '';
    try {
      shallow = execFileSync('git', ['-C', root, 'rev-parse', '--is-shallow-repository'], {
        encoding: 'utf-8',
        timeout: 10000,
        stdio: ['ignore', 'pipe', 'ignore']
      });
    } catch {
      shallow = '';
    }
    if (shallow.trim() === 'true') {
      console.warn(
        'file-failure-issues: this checkout is a SHALLOW clone — its git history is truncated, so a spec renamed or deleted before the truncation is no longer recognised by the dedupe and a multi-file title naming it can be misjudged as a dedication. A full fetch (GIT_DEPTH: 0) restores the rule.'
      );
    }
    for (const line of out.split('\n')) {
      const name = line.trim().split('/').pop();
      if (name && SPEC_FILE_RE.test(name)) names.add(name);
    }
  } catch (e) {
    // Two arms, told apart by what git itself said:
    // - a root with NO git behind it (the unit spec's synthetic checkouts)
    //   has no past names — that is the definition of "had" there, not a
    //   swallowed failure, and it stays silent;
    // - a root whose git call FAILED (an absent binary, a timeout, a
    //   permissions error) silently empties its "had" set, so it is named:
    //   a spec renamed in the unread history can then be misjudged as
    //   another file's dedication, filing a second issue for a file that
    //   already has one. The read above still contributes what it read.
    const stderr = String(e.stderr || '').trim();
    if (!/not a git repository/i.test(stderr)) {
      console.warn(
        `file-failure-issues: the git history of ${root} could not be read — a spec renamed or deleted ` +
          `in the unread history is no longer recognised by the dedupe (${firstErrorReason(e)})`
      );
    }
  }
  e2eSpecNamesByRoot.set(root, names);
  return names;
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
    // A bare spec file name is this tree's path when it is one of the
    // tree's OWN names (#1802) — a file it has now, or one it has had:
    // a file that was RENAMED must not drop out of the comparison (that
    // would turn a multi-file title into a dedication).
    return SPEC_FILE_RE.test(token) && e2eOwnSpecNames(root).has(token);
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

/**
 * The venue build line, from the sha the run's pre-flight handed over
 * (#1851): an issue that does not name the served build is one an
 * operator cannot diagnose in one read — a stale venue fails specs for
 * product-reasons that read like test defects.
 *
 * @param {string|undefined} venueBuildGitSha - the E2E_VENUE_BUILD_GIT_SHA
 *   the run script exported (empty/absent = the run carried no marker)
 * @returns {string} the body line
 */
function venueBuildLine(venueBuildGitSha, venueNowSha) {
  const lines = [
    venueBuildGitSha
      ? `- venue build: \`${venueBuildGitSha}\``
      : '- venue build: unknown — the run carried no build marker (a venue predating the #1851 contract, or the probe could not read it)'
  ];
  if (venueNowSha && venueBuildGitSha && venueNowSha !== venueBuildGitSha) {
    // The venue moved between the run and the filing: the failure was
    // produced against the build above, and the venue now answers with
    // another one. The reader needs both to know the verdict could not
    // be made.
    lines.push(`- the venue has moved since the run: it now serves \`${venueNowSha}\``);
  }
  return lines.join('\n');
}

function issueBody(file, failures, venue, runStamp, venueBuildGitSha, venueNowSha) {
  return [
    'Filed by the local e2e run (`tests/e2e/run/run-local-e2e.sh`).',
    '',
    `- venue: \`${venue}\``,
    ...(process.env[VENUE_IP_ENV]
      ? [
          `- the runner resolved the venue name to ` +
            `\`${process.env[VENUE_HOST_ENV] || '(the BASE_URL host)'}\` = \`${process.env[VENUE_IP_ENV]}\``
        ]
      : []),
    venueBuildLine(venueBuildGitSha, venueNowSha),
    `- run: ${runStamp}`,
    specFileMarker(file),
    `- failing tests: ${failures.length}`,
    '',
    '## Failures',
    '',
    ...failures
      .slice(0, MAX_FAILURES_PER_ISSUE)
      .flatMap((failure) => [`### ${failure.title}`, '', '```', failure.error, '```', '']),
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
    'under `reports/` on the machine that ran it.'
  ].join('\n');
}

/**
 * The comment posted on an issue that already tracks the failure.
 */
function commentBody(files, venue, runStamp, venueBuildGitSha, venueNowSha) {
  // One argv element carries the whole comment, so the cap is the COMMENT's
  // budget, not each file's — an umbrella issue tracking many files must not
  // push the body past the kernel's per-argument cap either.
  let budget = MAX_FAILURES_PER_ISSUE;
  return [
    `The local e2e run is still red on ${files.length} spec file(s) this issue covers ` +
      `(${runStamp}, venue \`${venue}\`).`,
    venueBuildLine(venueBuildGitSha, venueNowSha),
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
          : [])
      ];
    })
  ].join('\n');
}

/**
 * Why a child-process call failed, in one line. The tool's own message is
 * the first non-empty line of its stderr (glab's refusal, git's failure);
 * the command that failed is in the error's message and is not useful to a
 * reader. Shared by the tracker calls and the git-history read.
 */
function firstErrorReason(error) {
  const stderr = (error.stderr || '').trim();
  const firstStderrLine = stderr.split('\n').find((line) => line.trim().length > 0);
  if (firstStderrLine) return firstStderrLine.trim();
  return error.message.split('\n').slice(0, 2).join(' | ');
}

function createIssue(file, failures, venue, runStamp, venueNowSha, runSha) {
  const title = `test(e2e): ${file} is red on the local run`;
  const created = JSON.parse(
    glab([
      '-X',
      'POST',
      `projects/${GITLAB_PROJECT_ID}/issues`,
      '-f',
      `title=${title}`,
      '-f',
      `description=${issueBody(file, failures, venue, runStamp, runSha, venueNowSha)}`,
      '-f',
      `labels=${LABELS.join(',')}`
    ])
  );
  process.stdout.write(`  #${created.iid} (created) ${title}\n`);
  return created.iid;
}

function commentOnIssue(issue, files, venue, runStamp, venueNowSha, runSha) {
  glab([
    '-X',
    'POST',
    `projects/${GITLAB_PROJECT_ID}/issues/${issue.iid}/notes`,
    '-f',
    `body=${commentBody(files, venue, runStamp, runSha, venueNowSha)}`
  ]);
  process.stdout.write(`  #${issue.iid} (commented) ${issue.title}\n`);
}

/**
 * File the failing files against the tracker — the loop whose loudness the
 * run depends on.
 *
 * The contract: one tracker error never takes the filing down. A file whose
 * create fails is reported and the remaining files are still attempted; an
 * issue whose comment fails puts every file it covers into the errors; the
 * errors come back so the caller can refuse the exit code. A swallow here
 * would leave a red run that the tracker never hears about — the silence
 * this path exists to end.
 *
 * `clients` injects the tracker calls (the same dependency-injection shape
 * as the backend's createApp pattern: production passes nothing and gets
 * the real glab clients; the unit spec passes fakes to pin the contract).
 */
function fileTrackedFailures(byFile, openIssues, venue, runStamp, clients = {}, venueNowSha = null, runSha = null) {
  const create = clients.createIssue || createIssue;
  const comment = clients.commentOnIssue || commentOnIssue;
  // The failing files are grouped by the issue that already tracks them, so
  // one umbrella issue receives ONE comment for the whole run — not one per
  // file. A file nobody tracks yet gets its own issue.
  const byIssue = new Map();
  const errors = [];
  for (const [file, failures] of byFile) {
    const tracked = findTrackedIssue(file, openIssues);
    try {
      if (!tracked) {
        create(file, failures, venue, runStamp, venueNowSha, runSha);
        continue;
      }
      const entry = byIssue.get(tracked.iid) || { issue: tracked, files: [] };
      entry.files.push({ file, failures });
      byIssue.set(tracked.iid, entry);
    } catch (e) {
      // One tracker error must not swallow the remaining failures.
      errors.push(`${file}: ${firstErrorReason(e)}`);
      process.stdout.write(`  ! ${file} could not be filed: ${firstErrorReason(e)}\n`);
    }
  }
  for (const { issue, files } of byIssue.values()) {
    try {
      comment(issue, files, venue, runStamp, venueNowSha, runSha);
    } catch (e) {
      for (const entry of files) {
        errors.push(`${entry.file}: ${firstErrorReason(e)}`);
      }
      process.stdout.write(`  ! #${issue.iid} could not be commented: ${firstErrorReason(e)}\n`);
    }
  }
  return errors;
}

async function main() {
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
  // Validated by readReport: the stamp is the run's own start, never this
  // filing's wall clock.
  const runStamp = report.stats.startTime;

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
  // The venue's CURRENT build marker (#1851): the pre-flight reads
  // /build-info.json and hands the sha over through a scratch file. The
  // failure path needs it to BIND the venue's served bundle to the build
  // the run exercised — a venue that moved since the run answers with a
  // bundle that is not the one the failure was produced against.
  const { sha: venueSha, failed: preflightFailed } = probeVenueBuildSha(venue);
  if (preflightFailed) {
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
  const { fileable: noiseFree, noise: venueNoise } = partitionVenueNoise(groupFailuresByFile(failed));
  if (venueNoise.size > 0) {
    process.stdout.write(venueAvailabilityReport(venueNoise, venue) + '\n');
  }
  // The stale-venue read (#1895, #1896): a spec that waits for a handle
  // the app declares, against a venue whose build predates the
  // declaration, fails exactly like a product defect — and used to be
  // FILED as one. The venue's served bundle is the only thing that tells
  // the two apart.
  const runSha = runBuildSha(reportPath);
  const classification = await classifyVenueFailures(venue, noiseFree, { runSha, venueSha });
  const byFile = classification.fileable;
  const staleVenue = classification.stale;
  for (const line of classification.reports) {
    process.stdout.write(`${line}\n`);
  }
  if (byFile.size === 0) {
    if (venueNoise.size > 0) {
      process.stdout.write(
        '\nnothing was filed — every failure carries the venue-outage signature; the report above is the record.\n'
      );
    } else if (staleVenue.size > 0) {
      process.stdout.write(
        "\nnothing was filed — every failure is explained by the venue's stale build; the report above is the record.\n"
      );
    } else {
      process.stdout.write('\nnothing was filed.\n');
    }
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
  const openIssues = fetchOpenIssues();
  const errors = fileTrackedFailures(byFile, openIssues, venue, runStamp, {}, venueSha, runSha);

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
  main().catch((error) => {
    process.stderr.write(`file-failure-issues: ${error && error.message ? error.message : String(error)}\n`);
    process.exit(1);
  });
}

// Exposed for the unit spec: the dedupe rule, the refusal wording, the
// venue-outage partition and the filing loop's loudness contract are
// behaviour, and behaviour is tested, not trusted.
module.exports = {
  findTrackedIssue,
  specPathsIn,
  titleIsDedicatedTo,
  firstErrorReason,
  groupFailuresByFile,
  issueBody,
  isConnectionSignature,
  partitionVenueNoise,
  venueAvailabilityReport,
  fileTrackedFailures,
  locatorHandles,
  isNotFoundFailure,
  staleVenueHandles,
  partitionStaleVenue,
  venueStalenessReport,
  venueStaleProof,
  handleDeclaredAtBuild,
  handleCommittedAtHead,
  sourceTreeExistsAt,
  ancestryOfHead,
  bindVenueBuild,
  classifyVenueFailures,
  probeVenueBuildSha,
  buildStaleVenueContext,
  runBuildSha,
  sidecarPath
};
