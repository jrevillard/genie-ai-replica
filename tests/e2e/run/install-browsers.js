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
 *   1. the checkout matches the lockfile — `npm ci` when the installed
 *      @playwright/test is not the pinned one. Without this step the tree
 *      would be reconciled against a STALE checkout: node_modules can
 *      disagree with package-lock.json while node_modules/.package-lock.json
 *      claims otherwise, and then the revision is derived from the wrong
 *      source and "the pinned Playwright" is a fiction;
 *   2. the browser tree carries the revision the installed Playwright
 *      names — `playwright install chromium`.
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

const readJson = (file) => JSON.parse(fs.readFileSync(file, 'utf8'));

/**
 * The @playwright/test version the lockfile pins.
 * @param {string} repoRoot the checkout root
 * @returns {string} the pinned version
 */
function pinnedPlaywrightVersion(repoRoot = REPO_ROOT) {
  const lock = readJson(path.join(repoRoot, 'package-lock.json'));
  const entry = lock.packages && lock.packages[`node_modules/${PINNED_PACKAGE}`];
  if (!entry || !entry.version) {
    throw new Error(`package-lock.json pins no ${PINNED_PACKAGE} — this is not the lockfile of this checkout`);
  }
  return entry.version;
}

/**
 * The @playwright/test version on disk, or null when the checkout has no
 * node_modules at all.
 * @param {string} repoRoot the checkout root
 * @returns {string|null} the installed version
 */
function installedPlaywrightVersion(repoRoot = REPO_ROOT) {
  const file = path.join(repoRoot, 'node_modules', '@playwright', 'test', 'package.json');
  if (!fs.existsSync(file)) return null;
  return readJson(file).version;
}

/**
 * The browser revisions the INSTALLED Playwright names. The numbers are read
 * from its own browsers.json — never written here: a hardcoded revision is
 * the drift this script exists to remove.
 * @param {string} repoRoot the checkout root
 * @returns {{chromium: string, chromiumHeadlessShell: string}} the revisions
 */
function requiredBrowserRevisions(repoRoot = REPO_ROOT) {
  const spec = readJson(path.join(repoRoot, 'node_modules', 'playwright-core', 'browsers.json'));
  const revisionOf = (name) => {
    const browser = (spec.browsers || []).find((b) => b.name === name);
    if (!browser || !browser.revision) {
      throw new Error(`the installed Playwright names no '${name}' browser — its browsers.json is not the one of this checkout`);
    }
    return browser.revision;
  };
  return {
    chromium: revisionOf('chromium'),
    chromiumHeadlessShell: revisionOf('chromium-headless-shell')
  };
}

/**
 * The command that installs the browser build: the CHECKOUT's own Playwright
 * CLI, so the build comes from the Playwright this checkout pins and not
 * from a global one.
 * @param {string} repoRoot the checkout root
 * @returns {{command: string, args: string[]}} the command
 */
function browserInstallCommand(repoRoot = REPO_ROOT) {
  return {
    command: process.execPath,
    args: [path.join(repoRoot, 'node_modules', 'playwright', 'cli.js'), 'install', 'chromium']
  };
}

/**
 * The runner this machine would use: the Playwright version on disk and the
 * Chromium revisions it names. A run reports this so a reader can tell
 * WHICH browser a result came from.
 * @param {string} repoRoot the checkout root
 * @returns {{playwrightVersion: string, chromium: string, chromiumHeadlessShell: string}} the runner
 */
function describeRunner(repoRoot = REPO_ROOT) {
  const version = installedPlaywrightVersion(repoRoot);
  if (!version) {
    throw new Error(`the checkout has no ${PINNED_PACKAGE} installed — node_modules is missing or incomplete`);
  }
  return { playwrightVersion: version, ...requiredBrowserRevisions(repoRoot) };
}

/**
 * The Chromium executable the installed Playwright expects, resolved by the
 * installed Playwright itself.
 * @param {string} repoRoot the checkout root
 * @returns {string} the executable path
 */
function chromiumExecutable(repoRoot = REPO_ROOT) {
  const { chromium } = require(path.join(repoRoot, 'node_modules', 'playwright-core'));
  return chromium.executablePath();
}

/**
 * Bring the checkout and the browser tree onto the pinned Playwright.
 * @param {string} repoRoot the checkout root
 * @returns {{playwrightVersion: string, chromium: string, chromiumHeadlessShell: string, executable: string}}
 *   the reconciled runner
 */
function reconcile(repoRoot = REPO_ROOT) {
  const pinned = pinnedPlaywrightVersion(repoRoot);
  let installed = installedPlaywrightVersion(repoRoot);
  if (installed !== pinned) {
    process.stdout.write(
      `install-browsers: the checkout has ${PINNED_PACKAGE} ${installed || 'nothing'}, ` +
        `the lockfile pins ${pinned} — running npm ci\n`
    );
    const npm = spawnSync('npm', ['ci', '--no-audit', '--no-fund'], { cwd: repoRoot, stdio: 'inherit' });
    if (npm.status !== 0) {
      throw new Error(`npm ci failed (exit ${npm.status}) — the checkout was left as it was`);
    }
    installed = installedPlaywrightVersion(repoRoot);
    if (installed !== pinned) {
      throw new Error(
        `the checkout still has ${PINNED_PACKAGE} ${installed || 'nothing'} after npm ci, the lockfile pins ${pinned}`
      );
    }
  }

  const { command, args } = browserInstallCommand(repoRoot);
  const install = spawnSync(command, args, { cwd: repoRoot, stdio: 'inherit' });
  if (install.status !== 0) {
    throw new Error(`the browser install failed (exit ${install.status})`);
  }

  const runner = describeRunner(repoRoot);
  const executable = chromiumExecutable(repoRoot);
  if (!fs.existsSync(executable)) {
    throw new Error(`the install reported success but the browser is not there: ${executable}`);
  }
  return { ...runner, executable };
}

if (require.main === module) {
  try {
    const { playwrightVersion, chromium, chromiumHeadlessShell, executable } = reconcile();
    const tree = process.env.PLAYWRIGHT_BROWSERS_PATH || 'the Playwright default cache';
    process.stdout.write(
      `install-browsers: ${PINNED_PACKAGE} ${playwrightVersion} — chromium ${chromium}, ` +
        `chromium-headless-shell ${chromiumHeadlessShell}\n`
    );
    process.stdout.write(`install-browsers: browser tree at ${tree}\n`);
    process.stdout.write(`install-browsers: chromium executable ${executable}\n`);
  } catch (e) {
    process.stderr.write(`install-browsers: ${e.message}\n`);
    process.exit(1);
  }
}

module.exports = {
  REPO_ROOT,
  browserInstallCommand,
  chromiumExecutable,
  describeRunner,
  installedPlaywrightVersion,
  pinnedPlaywrightVersion,
  reconcile,
  requiredBrowserRevisions
};
