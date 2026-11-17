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
    "    - that Chromium's shared libraries on LD_LIBRARY_PATH (a bare",
    '      container image has no libatk/libgbm);',
    '    - the Inter fonts on XDG_DATA_HOME for the pixel-measurement specs;',
    '    - a resolvable venue name — or E2E_VENUE_IP for one the runner',
    '      cannot resolve; E2E_VENUE_IP must be an IPv4 or IPv6 address;',
    '    - a venue address that is a URL (BASE_URL).'
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
      // The venue build marker (#1851): the run must say WHICH BUILD the
      // venue serves, so a stale venue cannot file misleading
      // spec-defect issues. A BROKEN marker (the contract served and
      // violated) is a deployment defect: the run stops, like the
      // unreachable venue above. A MISSING marker (an older frontend)
      // or a freshness mismatch is named loudly and the run continues.
      const marker = await probeVenueBuild(context, BASE_URL);
      process.stdout.write(`pre-flight: ${marker.line}\n`);
      if (marker.malformed) {
        failure = `pre-flight: ${marker.line}\n`;
      }
      // The failure path (#1851: file-failure-issues.js) embeds the served
      // build in every issue it files — the caller hands over a FILE to
      // write the sha into (an env var cannot cross back out of this
      // process). Only an `ok` marker writes a sha; every other outcome
      // writes the empty string, which the failure path reports as
      // unknown. A write that fails must not dim the pre-flight's own
      // findings — it is reported and the run proceeds.
      if (process.env.E2E_VENUE_BUILD_FILE) {
        try {
          require('fs').writeFileSync(process.env.E2E_VENUE_BUILD_FILE, marker.gitSha || '');
        } catch (e) {
          process.stdout.write(`pre-flight: the venue build could not be handed to the run (${e.message}).\n`);
        }
      }
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
  // The exit code is OURS, not node's default: the run script forwards
  // NODE_OPTIONS, and an inherited `--unhandled-rejections=warn` would
  // turn an escaping rejection into exit 0 — the run would continue past
  // a broken pre-flight.
  //
  // The FRAMES are the honest output: every await in main() is guarded
  // (the launch, the navigation, the close), so a rejection that escapes
  // is an internal bug, not a finding — and it is NOT rewritten into a
  // named cause, which would be the suite's forbidden "degrade a
  // failure into a fallback path".
  main().catch((e) => {
    process.stderr.write(String((e && e.stack) || e) + '\n');
    process.exitCode = 1;
  });
}

/**
 * The venue build marker probe (#1851): read `/build-info.json` through
 * the same browser context the reachability check used (the venue's TLS
 * and DNS mapping already settled), parse it against the contract, and
 * return the line the pre-flight prints. `malformed` is the only
 * outcome that stops the run (see parseBuildMarker).
 *
 * @param {import('@playwright/test').BrowserContext} context
 * @param {string} baseUrl - the venue's edge address
 * @returns {Promise<{line: string, malformed: boolean}>}
 */
async function probeVenueBuild(context, baseUrl) {
  let status;
  let contentType;
  let bodyText;
  try {
    const markerRes = await context.request.get(`${baseUrl}/build-info.json`);
    status = markerRes.status();
    contentType = markerRes.headers()['content-type'] || '';
    bodyText = await markerRes.text();
  } catch (e) {
    // A probe that cannot even complete is a freshness fact, not a
    // reachability fact (the venue itself was just reached): name it and
    // go on — the run's value does not hinge on the marker.
    return {
      line: `venue build: unreadable (the marker probe failed: ${e.message}) — of unknown freshness`,
      malformed: false
    };
  }
  const parsed = parseBuildMarker(status, contentType, bodyText);
  if (parsed.kind === 'missing') {
    return {
      line:
        'venue build: the venue predates the build-marker contract (no readable /build-info.json — ' +
        'the SPA fallback answered) — freshness undetectable here; every red below reads against an unknown build',
      malformed: false
    };
  }
  if (parsed.kind === 'malformed') {
    return {
      line: `venue build: the marker contract is BROKEN — ${parsed.reason} (HTTP ${status} at /build-info.json)`,
      malformed: true
    };
  }
  let headSha;
  try {
    headSha = require('child_process')
      .execSync('git rev-parse HEAD', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
      .trim();
  } catch {
    headSha = null;
  }
  const difference = checkoutDifference(parsed.gitSha, headSha);
  return {
    line: `venue build: ${describeBuildFreshness(parsed.gitSha, headSha, difference)}`,
    malformed: false,
    gitSha: parsed.gitSha
  };
}

/**
 * The paths that change the SERVED product, read from the build
 * contexts and the bind mounts rather than from taste:
 *
 * - `components/**` — the frontend image's build context IS `components/`,
 *   so the whole tree ships in it; the backend, the document repository,
 *   the OKF server and the sidecars are built from it too;
 * - `genie-ai-overlay/**` — the OPEA images copy their service directory,
 *   `core/` and `build-patches/` out of it;
 * - `configs/**` — the Keycloak theme is baked into an image (its own
 *   build context), the collector config and the Grafana dashboards are
 *   mounted from it;
 * - `tools/tempo-proxy/**` — its own build context;
 * - `api-gateway-solution/**` — the gateway configuration, and the
 *   certbot entrypoint that is mounted from it;
 * - `secrets/**` — the mounted certificates;
 * - `env`, `env.*`, `docker-compose*.yaml` — the runtime environment.
 *
 * `charts/**` and `deploy/**` change HOW the product is deployed — its
 * environment, its probes, its resources. They cannot change the served
 * CODE, but they CAN move the runtime environment, so they carry their
 * own verdict.
 *
 * Everything else is neither: the docs, the docs site, the tests, the
 * agent tooling, and the parts of the product this venue does not serve
 * (the mobile app, the translation service, the seed data). A
 * difference there cannot explain a red.
 *
 * A path this table does not know is treated as SERVED: the default must
 * not understate a difference (a new top-level directory holding product
 * code would otherwise be reported as harmless).
 */
const SERVED_PRODUCT_ENTRIES = new Set([
  'components',
  'genie-ai-overlay',
  'configs',
  'tools',
  'api-gateway-solution',
  'secrets',
  'env',
  'env.rtx6000',
  'env.t4',
  'docker-compose.yaml',
  'docker-compose.gpu.yaml'
]);

const DEPLOYMENT_ENTRIES = new Set(['charts', 'deploy', '.gitlab-ci.yml']);

const NEITHER_ENTRIES = new Set([
  'docs',
  'site',
  'tests',
  'scripts',
  'mobile',
  'document-translation',
  'data',
  'design-system.html',
  'typings',
  'go.mod',
  'openapitools.json',
  '.claude',
  '.agents',
  '_bmad',
  '_bmad-output',
  '.gitlab',
  '.husky',
  '.serena',
  '.github',
  'package.json',
  'package-lock.json',
  'playwright.config.js',
  'skills-lock.json',
  '.gitignore',
  '.gitattributes',
  '.editorconfig',
  '.prettierignore',
  '.prettierrc',
  '.semgrepignore',
  '.trivyignore',
  '.dockerignore',
  '.claudeignore',
  '.hugo_build.lock'
]);

/**
 * Split the paths that differ between two commits into the three classes
 * that mean different things for a red.
 *
 * @param {string[]} paths - the paths that differ, as git names them
 * @returns {{product: string[], deployment: string[], neither: string[]}}
 */
function classifyCheckoutDifference(paths) {
  const product = [];
  const deployment = [];
  const neither = [];
  for (const path of paths || []) {
    const top = path.split('/')[0];
    if (SERVED_PRODUCT_ENTRIES.has(top)) {
      product.push(path);
    } else if (DEPLOYMENT_ENTRIES.has(top)) {
      deployment.push(path);
    } else if (NEITHER_ENTRIES.has(top) || path.endsWith('.md')) {
      neither.push(path);
    } else {
      // Unknown: assume it is served (see the table's contract).
      product.push(path);
    }
  }
  return { product, deployment, neither };
}

/**
 * The paths that differ between the build the venue serves and the
 * checkout, classified. `null` when the difference cannot be computed —
 * the served sha is not in this checkout (a build from another branch or
 * a shallow clone), which is a fact the verdict has to name rather than
 * hide.
 *
 * @param {string} venueSha - the sha the venue's marker names
 * @param {string|null} headSha - the checkout's HEAD
 * @returns {{product: string[], deployment: string[], neither: string[]}|null}
 */
function checkoutDifference(venueSha, headSha) {
  if (!headSha || !venueSha || venueSha === 'unknown') {
    return null;
  }
  let out;
  try {
    out = require('child_process')
      .execFileSync('git', ['diff', '--name-only', `${venueSha}..${headSha}`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore']
      })
      .trim();
  } catch {
    return null;
  }
  return classifyCheckoutDifference(out ? out.split('\n').filter(Boolean) : []);
}

/**
 * The venue build marker's contract (#1851): the frontend image bakes
 * `/build-info.json` — `{"git_sha": "<sha>"}` — at build time, and the
 * pre-flight reads it so the run EXPOSES which build the venue serves.
 * A stale venue fails specs for product-reasons that read like test
 * defects (the W14/W15 trap); a run that names the served build cannot
 * file that misleading issue.
 *
 * THREE findings, not one — the same discipline as the venue status
 * above:
 *  - `ok` — the marker parsed; the freshness verdict follows;
 *  - `missing` — no readable marker at the path: the venue's frontend
 *    predates the marker contract (the SPA fallback answers the probe).
 *    Loudly named, not a stop: an older frontend is a legitimate state
 *    until its next rebuild, and the marker arrives with it;
 *  - `malformed` — the path IS served but carries no readable
 *    `git_sha`: the venue HAS the contract and broke it. That is a
 *    deployment defect the run stops for.
 *
 * @param {number} status - the HTTP status the probe answered
 * @param {string} contentType - the response's content type
 * @param {string} bodyText - the response body as text
 * @returns {{kind: 'ok', gitSha: string} | {kind: 'missing'} | {kind: 'malformed', reason: string}}
 */
function parseBuildMarker(status, contentType, bodyText) {
  if (status < 200 || status >= 300 || !/json/i.test(String(contentType || ''))) {
    return { kind: 'missing' };
  }
  let parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch (e) {
    // A JSON content type with an unparseable body is the contract
    // breaking down in transit, not the contract's absence.
    return { kind: 'malformed', reason: `the marker body is not valid JSON: ${e.message}` };
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.git_sha !== 'string' || parsed.git_sha === '') {
    return { kind: 'malformed', reason: 'the marker carries no git_sha string' };
  }
  // The sha travels INTO a markdown issue body in backticks (#1851
  // scoped review): a venue-controlled value carrying backticks, spaces
  // or control characters could break the fence or inject text into the
  // tracker. The contract writes a full hex sha — or "unknown" from a
  // build that skipped the ARG — so anything outside that shape is a
  // broken marker, not a freshness fact.
  if (!/^(unknown|[0-9a-f]{4,64})$/.test(parsed.git_sha)) {
    return { kind: 'malformed', reason: 'the git_sha is not a sha-shaped value' };
  }
  return { kind: 'ok', gitSha: parsed.git_sha };
}

/**
 * The freshness verdict, as one line the operator reads next to the
 * venue's address: the marker's sha against the checkout's HEAD, and —
 * when the two differ — WHAT differs between them.
 *
 * The sha comparison alone answers "is this the same build?" but not
 * "can that difference explain a red?", and the difference matters: a
 * checkout whose only delta from the served build is the Helm chart
 * serves the SAME product, and telling the operator that "every red
 * below is suspect" sends them hunting a defect the delta cannot cause.
 * So the verdict names the class of the difference:
 *
 * - the served PRODUCT differs -> STALE, every red below is suspect;
 * - only the DEPLOYMENT definition differs -> the served code is the
 *   checkout's, and a red is suspect only if that change moved the
 *   runtime environment;
 * - nothing that is served differs -> the served product IS the
 *   checkout's, and no red below is a staleness artefact.
 *
 * The run does NOT stop for a mismatch (a venue may legitimately serve a
 * different build than the checkout — a release branch, a deploy in
 * flight); the verdict names what is being exercised.
 *
 * @param {string} gitSha - the marker's git sha
 * @param {string|null} headSha - the checkout's HEAD, or null when it
 *   could not be read
 * @param {{product: string[], deployment: string[], neither: string[]}|null} difference -
 *   the classified paths that differ, or null when it could not be computed
 * @returns {string} the freshness line
 */
function describeBuildFreshness(gitSha, headSha, difference) {
  if (!headSha) {
    return `of unknown freshness (serves ${gitSha}; the checkout's HEAD could not be read)`;
  }
  if (gitSha === headSha) {
    return `fresh — the venue serves the checkout's build (${gitSha})`;
  }
  if (!difference) {
    return (
      `STALE — the venue serves ${gitSha}, the checkout is ${headSha}: every red below is suspect ` +
      'until the venue serves this build (the stale-venue remedy: docs/e2e-tests/local-run.md)'
    );
  }
  const remedy = ' (the stale-venue remedy: docs/e2e-tests/local-run.md)';
  if (difference.product.length > 0) {
    return (
      `STALE — the venue serves ${gitSha}, the checkout is ${headSha}: the served product differs ` +
      `(${difference.product.length} path(s), e.g. ${difference.product.slice(0, 3).join(', ')}) — ` +
      `every red below is suspect${remedy}`
    );
  }
  if (difference.deployment.length > 0) {
    return (
      `the served code is the checkout's — the venue serves ${gitSha}, the checkout is ${headSha}, and ` +
      `the difference is in the DEPLOYMENT definition (${difference.deployment.length} path(s), e.g. ` +
      `${difference.deployment.slice(0, 3).join(', ')}): a red below is suspect only if that change ` +
      `moved the runtime environment${remedy}`
    );
  }
  return (
    `the served product is the checkout's — the venue serves ${gitSha}, the checkout is ${headSha}, and ` +
    `the difference touches nothing that is served (${difference.neither.length} path(s)): no red below ` +
    'is a staleness artefact'
  );
}

module.exports = {
  classifyVenueStatus,
  namedFailure,
  parseBuildMarker,
  describeBuildFreshness,
  classifyCheckoutDifference,
  checkoutDifference
};
