#!/usr/bin/env node
// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * Reconcile the browser tree with the @playwright/test this repository pins.
 *
 * A Playwright release drives ONE Chromium build, and it names that build in
 * its own `browsers.json`. A browser tree that carries another revision
 * fails EVERY spec at launch, before one assertion runs — so the runner
 * looks broken and the product looks faulty. On 2026-11-10 exactly that
 * happened: one missing binary was filed as twelve product bugs (#1779).
 *
 * The revision is DERIVED here, never written down: the installed
 * Playwright's own `browsers.json` names it, and the installed Playwright's
 * own installer downloads exactly that build. A future lockfile bump
 * therefore needs no second number to change here.
 *
 * Two steps, in this order:
 *
 *   1. the checkout matches the lockfile — `npm ci` when the versions the
 *      RUNNER loads differ from the pinned ones. Both sides of that
 *      comparison walk the same chain (`@playwright/test` → `playwright` →
 *      `playwright-core`): one walk on disk (what the runner would load),
 *      one walk in lockfile space (what the lockfile pins for those very
 *      paths) — so a checkout whose `node_modules` disagrees with the
 *      lockfile cannot make this script read one package and install
 *      another, and a nested install is compared against its own pin;
 *   2. the browser tree carries the revision the installed Playwright names
 *      — installed by that Playwright's own installer, and then VERIFIED
 *      against the build the runner actually launches: a headless run
 *      launches the HEADLESS SHELL, a build of its own, so a tree that
 *      carries only the full chrome still fails every spec at launch.
 *
 * Usage: node tests/e2e/run/install-browsers.js
 * Idempotent: on an already reconciled machine the second run changes
 * nothing (the installer skips the builds it already has).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.resolve(__dirname, '..', '..', '..');

// The chain the RUNNER loads: @playwright/test -> playwright ->
// playwright-core. Every version and every revision is read through it —
// a checkout whose node_modules disagrees with the lockfile must not be
// able to make this script read one package and install another.
const RUNNER_CHAIN = ['@playwright/test', 'playwright', 'playwright-core'];

// The package the lockfile pins the runner on — the chain's first member.
const PINNED_PACKAGE = RUNNER_CHAIN[0];

// The two builds a Chromium run needs: the browser itself, and the headless
// shell a headless launch uses. They are SEPARATE downloads — the tree that
// carried only the full chrome is the tree whose headless shell was missing.
const CHROMIUM = 'chromium';
const HEADLESS_SHELL = 'chromium-headless-shell';

// Playwright's own marker for a finished install. Checked so a half-
// downloaded build cannot pass as a complete one.
const INSTALL_MARKER = 'INSTALLATION_COMPLETE';

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * The runner's own resolution of one package of the chain: the first
 * `package.json` found walking the `node_modules` hierarchy the way Node
 * does. Each package is resolved from the directory of the package that
 * requires it, so a NESTED copy — the tree the runner would really load —
 * is found instead of a hoisted sibling. The lookup is a plain path
 * construction and a stat, deliberately: `require.resolve` caches its
 * answers, and a cache filled before `npm ci` replaced the tree would hand
 * back paths that no longer exist.
 *
 * The chain starts at the repository ROOT: `tests/e2e` is its own npm
 * project (its dependencies are the linter's), and the root's
 * package-lock.json is the lockfile that pins the Playwright runtime —
 * `tests/e2e/package.json` says so itself: "The Playwright runtime itself
 * resolves from the repository root's node_modules". Both walks therefore
 * live in the root's universe, and the disk walk is BOUNDED by the
 * checkout: Node would also find a package in an ancestor directory, but
 * that copy is not the one the lockfile pins and not the one the run's
 * checkout should be reconciled against — so the walk stops at the root
 * and a package that is not there is a package the checkout does not have.
 * @param {string} name the package to resolve
 * @param {string} repoRoot the checkout root
 * @returns {string} the path of the package's package.json
 */
function resolvePackage(name, repoRoot = REPO_ROOT) {
  let dir = repoRoot;
  for (const candidate of RUNNER_CHAIN) {
    const file = resolveInNodeModules(candidate, dir, repoRoot);
    if (!file) {
      throw new Error(`the checkout carries no ${candidate} — node_modules is missing or does not carry the runner's chain`);
    }
    if (candidate === name) return file;
    dir = path.dirname(file);
  }
  throw new Error(`the runner's chain carries no ${name}`);
}

/**
 * One package's `package.json`, found the way Node looks for it: the
 * `node_modules` hierarchy of the given directory and of each of its
 * parents, nearest first — but never above the checkout, whose lockfile is
 * the one that pins the runtime.
 * @param {string} name the package
 * @param {string} fromDir the directory the walk starts from
 * @param {string} repoRoot the checkout root, the walk's boundary
 * @returns {string|null} the package.json path, or null when it is not there
 */
function resolveInNodeModules(name, fromDir, repoRoot) {
  let dir = fromDir;
  for (;;) {
    // Node never looks INSIDE a node_modules directory for another one.
    if (path.basename(dir) !== 'node_modules') {
      const candidate = path.join(dir, 'node_modules', name, 'package.json');
      if (fs.existsSync(candidate)) return candidate;
    }
    if (dir === repoRoot) return null;
    const parent = path.dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * The lockfile's entry for one package, found by the SAME walk the disk
 * resolution performs — one walk in lockfile space, so the pinned side and
 * the loaded side of the comparison are resolutions of the same shape. A
 * nested install is pinned by its own nested entry, not by a hoisted
 * sibling's.
 * @param {Object} lock the parsed package-lock.json
 * @param {string} name the package to look up
 * @param {string} fromRel the directory the walk starts from, relative to the checkout root
 * @returns {{key: string, entry: Object}|null} the entry and its lockfile key
 */
function lockfileEntry(lock, name, fromRel) {
  let dir = fromRel;
  for (;;) {
    // The same shape as the disk walk: a node_modules level is not probed
    // for another one.
    if (path.posix.basename(dir) !== 'node_modules') {
      const key = (dir ? `${dir}/` : '') + `node_modules/${name}`;
      if (lock.packages && lock.packages[key]) return { key, entry: lock.packages[key] };
    }
    if (!dir) return null;
    dir = path.posix.dirname(dir) === '.' ? '' : path.posix.dirname(dir);
  }
}

/**
 * The versions the lockfile pins for the runner's chain, and the lockfile
 * keys they were pinned under — the key is what a reader needs to see when
 * a nested package is compared against its own entry.
 * @param {string} repoRoot the checkout root
 * @returns {{versions: Object<string, string>, keys: Object<string, string>}} the pins and their keys
 */
function pinnedVersions(repoRoot = REPO_ROOT) {
  const lock = readJson(path.join(repoRoot, 'package-lock.json'));
  const versions = {};
  const keys = {};
  let fromRel = '';
  for (const name of RUNNER_CHAIN) {
    const found = lockfileEntry(lock, name, fromRel);
    if (!found || !found.entry.version) {
      throw new Error(`package-lock.json pins no ${name} (the walk from ${fromRel || 'the checkout root'} found no entry) — this is not the lockfile of this checkout`);
    }
    versions[name] = found.entry.version;
    keys[name] = found.key;
    fromRel = found.key;
  }
  return { versions, keys };
}

/**
 * The versions the runner actually loads, and WHERE each was loaded from.
 * @param {string} repoRoot the checkout root
 * @returns {{versions: Object<string, string>, paths: Object<string, string>}} the loaded versions and their paths
 */
function locatedVersions(repoRoot = REPO_ROOT) {
  const versions = {};
  const paths = {};
  for (const name of RUNNER_CHAIN) {
    const file = resolvePackage(name, repoRoot);
    paths[name] = file;
    versions[name] = readJson(file).version;
  }
  return { versions, paths };
}

/**
 * The versions the runner actually loads.
 * @param {string} repoRoot the checkout root
 * @returns {Object<string, string>} the loaded versions, by package name
 */
function runnerVersions(repoRoot = REPO_ROOT) {
  return locatedVersions(repoRoot).versions;
}

/**
 * The browser revisions the INSTALLED Playwright names. The numbers are read
 * from the resolved playwright-core's own browsers.json — never written
 * here: a hardcoded revision is the drift this script exists to remove.
 * (browsers.json may carry a per-platform `revisionOverrides`; the base
 * revision is what is reported, and the installer is what decides what
 * actually lands on disk — the report is about the pin, not about a
 * platform's special build.)
 * @param {string} repoRoot the checkout root
 * @returns {{chromium: string, chromiumHeadlessShell: string}} the revisions
 */
function requiredBrowserRevisions(repoRoot = REPO_ROOT) {
  const spec = readJson(path.join(path.dirname(resolvePackage('playwright-core', repoRoot)), 'browsers.json'));
  const revisionOf = (name) => {
    const browser = (spec.browsers || []).find((b) => b.name === name);
    if (!browser || !browser.revision) {
      throw new Error(`the installed Playwright names no '${name}' browser — its browsers.json is not the one of this checkout`);
    }
    return browser.revision;
  };
  return {
    chromium: revisionOf(CHROMIUM),
    chromiumHeadlessShell: revisionOf(HEADLESS_SHELL)
  };
}

/**
 * The command that installs the browser build: the CHECKOUT's own Playwright
 * CLI — the one the runner's chain resolves — so the build comes from the
 * Playwright this checkout pins and not from a global one.
 * @param {string} repoRoot the checkout root
 * @returns {{command: string, args: string[]}} the command
 */
function browserInstallCommand(repoRoot = REPO_ROOT) {
  const cli = path.join(path.dirname(resolvePackage('playwright', repoRoot)), 'cli.js');
  return { command: process.execPath, cli, args: [cli, 'install', 'chromium'] };
}

/**
 * The install locations the installer itself names. Playwright's own dry run
 * is the authority on where a build lands — the browser root, the platform
 * directory and the build name are all its business, not this script's.
 * NOTE: the output format is the CLI's human-readable text, not a stable
 * API; a lockfile bump that changes it fails the parse below loudly, and
 * the regex is what has to be re-pinned then.
 * @param {string} cliPath the resolved Playwright CLI
 * @param {Function} run the process runner
 * @param {string} repoRoot the checkout root
 * @returns {Array<{name: string, revision: string, location: string}>} the locations
 */
function installLocations(cliPath, run, repoRoot = REPO_ROOT) {
  const result = run(process.execPath, [cliPath, 'install', '--dry-run', 'chromium'], { cwd: repoRoot });
  if (result.error) {
    throw new Error(`the Playwright installer could not be started: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`the Playwright installer's dry run failed (exit ${result.status})`);
  }
  const locations = [];
  const pattern = /\(playwright ([^\s)]+) v(\d+)\)\s*\n\s*Install location:\s*(\S+)/g;
  for (const match of String(result.stdout || '').matchAll(pattern)) {
    // The revision the installer names is the one the browsers.json names
    // (both come from the same package), so the pin is reported once, from
    // the pin — and the location only answers "where".
    locations.push({ name: match[1], location: match[3] });
  }
  if (!locations.length) {
    throw new Error('the Playwright installer named no install location — its output is not the one this script reads');
  }
  return locations;
}

/**
 * The runner this machine would use: the versions the runner loads and the
 * Chromium revisions they name. A run reports this so a reader can tell
 * WHICH browser a result came from.
 * @param {string} repoRoot the checkout root
 * @returns {{playwrightVersion: string, chromium: string, chromiumHeadlessShell: string}} the runner
 */
function describeRunner(repoRoot = REPO_ROOT) {
  let versions;
  try {
    versions = runnerVersions(repoRoot);
  } catch (e) {
    throw new Error(
      `the checkout has no ${PINNED_PACKAGE} installed — node_modules is missing or incomplete (${e.message.split('\n')[0]})`,
      { cause: e }
    );
  }
  return {
    playwrightVersion: versions[PINNED_PACKAGE],
    ...requiredBrowserRevisions(repoRoot)
  };
}

/**
 * Run a command and return its outcome, whatever it was.
 * @param {string} command the command
 * @param {string[]} args its arguments
 * @param {Object} options the spawn options
 * @returns {{status: number|null, stdout: string, stderr: string, error: Error|undefined}} the outcome
 */
const defaultRun = (command, args, options = {}) => spawnSync(command, args, { ...options, encoding: 'utf8' });

/**
 * Bring the checkout and the browser tree onto the pinned Playwright.
 * @param {string} repoRoot the checkout root
 * @param {{run?: Function, exists?: Function}} io the seams the unit spec drives
 * @returns {{versions: Object<string, string>, chromium: string, chromiumHeadlessShell: string, locations: Array}}
 *   the reconciled runner
 */
function reconcile(repoRoot = REPO_ROOT, io = {}) {
  const run = io.run || defaultRun;
  const exists = io.exists || ((file) => fs.existsSync(file));

  const { versions: pinned, keys: pinnedKeys } = pinnedVersions(repoRoot);
  // The chain may be absent altogether — that is one of the states the
  // reconciliation repairs, not a failure of this step.
  const loaded = (() => {
    try {
      return locatedVersions(repoRoot);
    } catch {
      return null;
    }
  })();
  // The versions the run will USE: refreshed after a repair, so the summary
  // names the runtime that is on disk, not the one that was replaced.
  let versions = loaded ? loaded.versions : null;
  const stale = !versions || RUNNER_CHAIN.some((name) => versions[name] !== pinned[name]);
  if (stale) {
    process.stdout.write(
      `install-browsers: the checkout's runner chain does not match the lockfile ` +
        `(${RUNNER_CHAIN.map((name) => `${name} ${versions ? versions[name] : 'nothing'}`).join(', ')} vs ` +
        `${RUNNER_CHAIN.map((name) => `${name} ${pinned[name]}`).join(', ')}) — running npm ci\n`
    );
    // --include=dev: @playwright/test is a devDependency, and a NODE_ENV=production
    // npm ci would omit it — removing the very package being reconciled.
    const npm = run('npm', ['ci', '--include=dev', '--no-audit', '--no-fund'], { cwd: repoRoot, stdio: 'inherit' });
    if (npm.error) {
      throw new Error(`npm could not be started: ${npm.error.message}`);
    }
    if (npm.status !== 0) {
      throw new Error(
        `npm ci failed (exit ${npm.status}). npm ci removes node_modules before it installs, so the checkout may ` +
          `have no node_modules at all now — check it and restore it with "npm ci" before running the suite`
      );
    }
    const reloaded = locatedVersions(repoRoot);
    versions = reloaded.versions;
    const mismatched = RUNNER_CHAIN.filter((name) => versions[name] !== pinned[name]);
    if (mismatched.length) {
      throw new Error(
        `the checkout still does not match the lockfile after npm ci: ` +
          `${mismatched
            .map(
              (name) =>
                `${name} ${versions[name]} at ${reloaded.paths[name]} vs ${pinned[name]} pinned under ${pinnedKeys[name]}`
            )
            .join(', ')}`
      );
    }
  }

  const { command, cli: cliPath, args } = browserInstallCommand(repoRoot);
  if (!exists(cliPath)) {
    throw new Error(`the checkout's Playwright CLI is not there: ${cliPath}`);
  }
  const revisions = requiredBrowserRevisions(repoRoot);
  const locations = installLocations(cliPath, run, repoRoot);
  const install = run(command, args, { cwd: repoRoot, stdio: 'inherit' });
  if (install.error) {
    throw new Error(`the Playwright installer could not be started: ${install.error.message}`);
  }
  if (install.status !== 0) {
    throw new Error(`the browser install failed (exit ${install.status})`);
  }

  // The build the runner LAUNCHES is verified, not the one it happens to
  // carry: a headless run launches the headless shell, and that is the
  // binary that was missing when one missing build became twelve issues.
  // The installer's own locations are the authority on where a build lands,
  // so their existence and completion marker are what is checked.
  for (const name of [CHROMIUM, HEADLESS_SHELL]) {
    const entry = locations.find((l) => l.name === name);
    if (!entry) {
      throw new Error(`the Playwright installer named no ${name} build — its output is not the one this script reads`);
    }
    if (!exists(entry.location)) {
      throw new Error(`the ${name} build is not installed: ${entry.location}`);
    }
    if (!exists(path.join(entry.location, INSTALL_MARKER))) {
      throw new Error(
        `the ${name} build at ${entry.location} carries no ${INSTALL_MARKER} — the install was interrupted`
      );
    }
  }

  return { versions, ...revisions, locations };
}

if (require.main === module) {
  try {
    const { versions, chromium, chromiumHeadlessShell, locations } = reconcile();
    process.stdout.write(
      `install-browsers: ${PINNED_PACKAGE} ${versions[PINNED_PACKAGE]} — chromium ${chromium}, ` +
        `chromium-headless-shell ${chromiumHeadlessShell}\n`
    );
    for (const entry of locations) {
      process.stdout.write(`install-browsers: ${entry.name} at ${entry.location}\n`);
    }
  } catch (e) {
    process.stderr.write(`install-browsers: ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  RUNNER_CHAIN,
  browserInstallCommand,
  describeRunner,
  installLocations,
  pinnedVersions,
  reconcile,
  requiredBrowserRevisions,
  resolvePackage,
  runnerVersions
};
