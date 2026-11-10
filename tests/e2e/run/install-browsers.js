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
 *      RUNNER loads differ from the pinned ones. Without this step the tree
 *      would be reconciled against a STALE checkout: node_modules can
 *      disagree with package-lock.json while node_modules/.package-lock.json
 *      claims otherwise, and then the revision is derived from the wrong
 *      source and "the pinned Playwright" is a fiction;
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
const PINNED_PACKAGE = '@playwright/test';

// The chain the RUNNER loads: @playwright/test -> playwright ->
// playwright-core. Every version and every revision is read through it,
// resolved the way the runner resolves it: a checkout whose node_modules
// disagrees with the lockfile must not be able to make this script read one
// package and install another.
const RUNNER_CHAIN = ['@playwright/test', 'playwright', 'playwright-core'];

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
 * The versions the lockfile pins for the runner's chain.
 * @param {string} repoRoot the checkout root
 * @returns {Object<string, string>} the pinned versions, by package name
 */
function pinnedVersions(repoRoot = REPO_ROOT) {
  const lock = readJson(path.join(repoRoot, 'package-lock.json'));
  const pinned = {};
  for (const name of RUNNER_CHAIN) {
    const entry = lock.packages && lock.packages[`node_modules/${name}`];
    if (!entry || !entry.version) {
      throw new Error(`package-lock.json pins no ${name} — this is not the lockfile of this checkout`);
    }
    pinned[name] = entry.version;
  }
  return pinned;
}

/**
 * The runner's OWN resolution of one package of the chain. Each package is
 * resolved from the directory of the package that requires it, so a NESTED
 * copy — the tree the runner would really load — is found instead of a
 * hoisted sibling.
 * @param {string} name the package to resolve
 * @param {string} repoRoot the checkout root
 * @returns {string} the path of the package's package.json
 */
function resolvePackage(name, repoRoot = REPO_ROOT) {
  let from = repoRoot;
  for (const candidate of RUNNER_CHAIN) {
    const file = require.resolve(`${candidate}/package.json`, { paths: [from] });
    if (candidate === name) return file;
    from = path.dirname(file);
  }
  throw new Error(`the runner's chain carries no ${name}`);
}

/**
 * The versions the runner actually loads.
 * @param {string} repoRoot the checkout root
 * @returns {Object<string, string>} the loaded versions, by package name
 */
function runnerVersions(repoRoot = REPO_ROOT) {
  const versions = {};
  for (const name of RUNNER_CHAIN) {
    versions[name] = readJson(resolvePackage(name, repoRoot)).version;
  }
  return versions;
}

/**
 * The browser revisions the INSTALLED Playwright names. The numbers are read
 * from the resolved playwright-core's own browsers.json — never written
 * here: a hardcoded revision is the drift this script exists to remove.
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
  return { command: process.execPath, args: [cli, 'install', 'chromium'] };
}

/**
 * The install locations the installer itself names. Playwright's own dry run
 * is the authority on where a build lands — the browser root, the platform
 * directory and the build name are all its business, not this script's.
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
    locations.push({ name: match[1], revision: match[2], location: match[3] });
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
  const versions = runnerVersions(repoRoot);
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

  const pinned = pinnedVersions(repoRoot);
  let versions = null;
  try {
    versions = runnerVersions(repoRoot);
  } catch {
    versions = null;
  }
  const stale = () => !versions || RUNNER_CHAIN.some((name) => versions[name] !== pinned[name]);
  if (stale()) {
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
        `npm ci failed (exit ${npm.status}). npm ci REMOVES node_modules before it installs, ` +
          `so the checkout now has no node_modules at all: restore it with "npm ci" before running the suite`
      );
    }
    versions = runnerVersions(repoRoot);
    const mismatched = RUNNER_CHAIN.filter((name) => versions[name] !== pinned[name]);
    if (mismatched.length) {
      throw new Error(
        `the checkout still does not match the lockfile after npm ci: ` +
          `${mismatched.map((name) => `${name} ${versions[name]} vs ${pinned[name]}`).join(', ')}`
      );
    }
  }

  const { command, args } = browserInstallCommand(repoRoot);
  const cliPath = args[0];
  if (!exists(cliPath)) {
    throw new Error(`the checkout's Playwright CLI is not there: ${cliPath}`);
  }
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

  return { versions, ...requiredBrowserRevisions(repoRoot), locations };
}

if (require.main === module) {
  try {
    const { versions, chromium, chromiumHeadlessShell, locations } = reconcile();
    process.stdout.write(
      `install-browsers: ${PINNED_PACKAGE} ${versions[PINNED_PACKAGE]} — chromium ${chromium}, ` +
        `chromium-headless-shell ${chromiumHeadlessShell}\n`
    );
    for (const entry of locations) {
      process.stdout.write(`install-browsers: ${entry.name} ${entry.revision} at ${entry.location}\n`);
    }
  } catch (e) {
    process.stderr.write(`install-browsers: ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  REPO_ROOT,
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
