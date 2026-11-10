// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * Unit spec for the browser-tree reconciler (issue #1779).
 *
 * The reconciler is the guard against the failure it exists to prevent: a
 * browser tree that carries another Chromium revision than the pinned
 * Playwright names, which fails every spec at launch. The pins below are
 * about WHERE the numbers come from — the lockfile for the versions, the
 * runner's OWN resolved chain for the revisions — and about WHAT the
 * reconciler verifies: the build the runner launches (the headless shell),
 * not the build it happens to carry.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  RUNNER_CHAIN,
  browserInstallCommand,
  describeRunner,
  installLocations,
  pinnedVersions,
  reconcile,
  requiredBrowserRevisions,
  resolvePackage,
  runnerVersions
} = require('./install-browsers');

// Revisions and versions that appear nowhere in the repository: a fixture
// carrying them proves the implementation READ them instead of returning a
// constant.
const FIXTURE_CHROMIUM = '4711';
const FIXTURE_SHELL = '4712';
const FIXTURE_VERSION = '9.9.9-fixture';

const roots = [];

/**
 * A throwaway checkout root carrying the given files.
 * @param {Object<string, Object|string>} files the files, by relative path
 * @returns {string} the root
 */
const makeRoot = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'genieai-install-browsers-'));
  roots.push(root);
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return root;
};

/**
 * A checkout whose runner chain is installed at the pinned versions.
 * @param {Object} [options] the versions to install
 * @returns {string} the root
 */
const makeCheckout = (options = {}) => {
  const version = options.version || FIXTURE_VERSION;
  const coreVersion = options.coreVersion || version;
  const files = {
    'package-lock.json': {
      packages: {
        '': { name: 'genie-ai' },
        'node_modules/@playwright/test': { version },
        'node_modules/playwright': { version },
        'node_modules/playwright-core': { version }
      }
    },
    'node_modules/@playwright/test/package.json': { name: '@playwright/test', version },
    'node_modules/playwright/package.json': { name: 'playwright', version },
    'node_modules/playwright/cli.js': '// the CLI of the fixture',
    'node_modules/playwright-core/package.json': { name: 'playwright-core', version: coreVersion },
    'node_modules/playwright-core/browsers.json': {
      browsers: [
        { name: 'chromium', revision: FIXTURE_CHROMIUM },
        { name: 'chromium-headless-shell', revision: FIXTURE_SHELL }
      ]
    }
  };
  return makeRoot(files);
};

test.afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

test('the pinned versions come from the lockfile, for every package of the chain', () => {
  const root = makeCheckout();
  expect(pinnedVersions(root)).toEqual({
    '@playwright/test': FIXTURE_VERSION,
    playwright: FIXTURE_VERSION,
    'playwright-core': FIXTURE_VERSION
  });
});

test('a lockfile that pins no playwright fails loudly', () => {
  const root = makeRoot({ 'package-lock.json': { packages: { '': { name: 'genie-ai' } } } });
  expect(() => pinnedVersions(root)).toThrow(/pins no @playwright\/test/);
});

test("the runner's chain is resolved the way the runner resolves it", () => {
  // A NESTED copy is the tree the runner would really load; a fixed path
  // would find the hoisted sibling and read the wrong package.
  const root = makeRoot({
    'package-lock.json': {
      packages: {
        'node_modules/@playwright/test': { version: FIXTURE_VERSION },
        'node_modules/playwright': { version: FIXTURE_VERSION },
        'node_modules/playwright-core': { version: FIXTURE_VERSION }
      }
    },
    'node_modules/@playwright/test/package.json': { version: FIXTURE_VERSION },
    'node_modules/playwright/package.json': { version: '1.0.0-hoisted' },
    'node_modules/playwright-core/package.json': { version: '1.0.0-hoisted' },
    'node_modules/@playwright/test/node_modules/playwright/package.json': { version: FIXTURE_VERSION },
    'node_modules/@playwright/test/node_modules/playwright/node_modules/playwright-core/package.json': {
      version: FIXTURE_VERSION
    }
  });
  expect(resolvePackage('playwright', root)).toBe(
    path.join(root, 'node_modules/@playwright/test/node_modules/playwright/package.json')
  );
  expect(resolvePackage('playwright-core', root)).toBe(
    path.join(
      root,
      'node_modules/@playwright/test/node_modules/playwright/node_modules/playwright-core/package.json'
    )
  );
});

test('the loaded versions are read from the chain, one package at a time', () => {
  const root = makeCheckout({ coreVersion: '1.0.0-older-core' });
  expect(runnerVersions(root)).toEqual({
    '@playwright/test': FIXTURE_VERSION,
    playwright: FIXTURE_VERSION,
    'playwright-core': '1.0.0-older-core'
  });
});

test('the revisions come from the resolved playwright-core browsers.json', () => {
  const root = makeCheckout();
  expect(requiredBrowserRevisions(root)).toEqual({
    chromium: FIXTURE_CHROMIUM,
    chromiumHeadlessShell: FIXTURE_SHELL
  });
});

test('a browser the installed Playwright does not name fails loudly', () => {
  const root = makeRoot({
    'node_modules/@playwright/test/package.json': { version: FIXTURE_VERSION },
    'node_modules/playwright/package.json': { version: FIXTURE_VERSION },
    'node_modules/playwright-core/package.json': { version: FIXTURE_VERSION },
    'node_modules/playwright-core/browsers.json': {
      browsers: [{ name: 'chromium', revision: FIXTURE_CHROMIUM }]
    }
  });
  expect(() => requiredBrowserRevisions(root)).toThrow(/chromium-headless-shell/);
});

test('the browser build is installed by the CHECKOUT Playwright, not a global one', () => {
  const root = makeCheckout();
  const { command, args } = browserInstallCommand(root);
  expect(command).toBe(process.execPath);
  expect(args).toEqual([path.join(root, 'node_modules/playwright/cli.js'), 'install', 'chromium']);
});

test('the runner describes the versions loaded and the revisions they name', () => {
  const root = makeCheckout();
  expect(describeRunner(root)).toEqual({
    playwrightVersion: FIXTURE_VERSION,
    chromium: FIXTURE_CHROMIUM,
    chromiumHeadlessShell: FIXTURE_SHELL
  });
});

test('a checkout without @playwright/test cannot describe a runner', () => {
  const root = makeRoot({ 'package-lock.json': { packages: {} } });
  expect(() => describeRunner(root)).toThrow();
});

// --- the reconciler itself (the part with the side effects) --------------------

/**
 * The process runner the reconciler drives, answering the dry run with the
 * install locations and recording what it was asked to run.
 * @param {Object} options the fixture's answers
 * @returns {{run: Function, calls: Array}} the runner and the calls it saw
 */
const fakeRun = (options = {}) => {
  const calls = [];
  const locations = options.locations || [
    { name: 'chromium', revision: FIXTURE_CHROMIUM, location: '/browsers/chromium-4711' },
    { name: 'chromium-headless-shell', revision: FIXTURE_SHELL, location: '/browsers/chromium_headless_shell-4712' }
  ];
  const run = (command, args) => {
    calls.push({ command, args });
    if (args.includes('--dry-run')) {
      const stdout = locations
        .map((l) => `Chrome (playwright ${l.name} v${l.revision})\n  Install location:    ${l.location}`)
        .join('\n');
      return { status: 0, stdout, stderr: '' };
    }
    if (args[0] && args[0].endsWith('cli.js')) {
      return { status: 0, stdout: '', stderr: '' };
    }
    // npm ci restores the tree from the lockfile; the fixture's onCi stands
    // in for that restore.
    if (options.onCi) options.onCi();
    return options.npmResult || { status: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
};

/**
 * The existence check the reconciler drives: the CLI, the browser
 * directories and their completion markers.
 * @param {string[]} missing the paths that do NOT exist
 * @returns {Function} the check
 */
const fakeExists = (missing = []) => {
  const absent = new Set(missing);
  return (file) => !absent.has(file);
};

test('a matching checkout is not reinstalled, and the install uses its own CLI', () => {
  const root = makeCheckout();
  const { run, calls } = fakeRun();
  const result = reconcile(root, { run, exists: fakeExists() });
  expect(calls.some((c) => c.args[0] === 'ci')).toBe(false);
  expect(calls.some((c) => c.args.includes('install') && c.args.includes('chromium'))).toBe(true);
  expect(result.versions['@playwright/test']).toBe(FIXTURE_VERSION);
  expect(result.chromium).toBe(FIXTURE_CHROMIUM);
});

test('a checkout that does not match the lockfile is reinstalled with the dev dependencies', () => {
  const root = makeCheckout({ coreVersion: '1.0.0-older-core' });
  const { run, calls } = fakeRun({
    onCi: () =>
      fs.writeFileSync(
        path.join(root, 'node_modules/playwright-core/package.json'),
        JSON.stringify({ name: 'playwright-core', version: FIXTURE_VERSION })
      )
  });
  reconcile(root, { run, exists: fakeExists() });
  const ci = calls.find((c) => c.args[0] === 'ci');
  expect(ci).toBeDefined();
  // --include=dev: @playwright/test is a devDependency, and a
  // NODE_ENV=production npm ci would omit the package being reconciled.
  expect(ci.args).toContain('--include=dev');
});

test('the HEADLESS SHELL is verified — the build the runner launches', () => {
  // The mutation this pins: a check that only looked at the full chrome
  // would pass a tree whose headless shell is missing, and every spec would
  // still die at launch.
  const root = makeCheckout();
  const { run } = fakeRun();
  expect(() =>
    reconcile(root, { run, exists: fakeExists(['/browsers/chromium_headless_shell-4712']) })
  ).toThrow(/chromium-headless-shell build is not installed/);
});

test('a build without the completion marker is not a complete build', () => {
  const root = makeCheckout();
  const { run } = fakeRun();
  expect(() =>
    reconcile(root, { run, exists: fakeExists(['/browsers/chromium-4711/INSTALLATION_COMPLETE']) })
  ).toThrow(/carries no INSTALLATION_COMPLETE/);
});

test('a failed npm ci says that node_modules is gone — npm ci removes it first', () => {
  const root = makeCheckout({ coreVersion: '1.0.0-older-core' });
  const { run } = fakeRun({ npmResult: { status: 1, stdout: '', stderr: 'boom' } });
  expect(() => reconcile(root, { run, exists: fakeExists() })).toThrow(/REMOVES node_modules/);
});

test('an npm that cannot be started is named, not reported as an exit code', () => {
  const root = makeCheckout({ coreVersion: '1.0.0-older-core' });
  const error = new Error('spawn npm ENOENT');
  const { run } = fakeRun({ npmResult: { status: null, stdout: '', stderr: '', error } });
  expect(() => reconcile(root, { run, exists: fakeExists() })).toThrow(/npm could not be started/);
});

test('the installer locations are read from the installer itself', () => {
  const { run } = fakeRun();
  const locations = installLocations('/checkout/node_modules/playwright/cli.js', run, '/checkout');
  expect(locations.map((l) => l.name)).toEqual(['chromium', 'chromium-headless-shell']);
});

test('an installer that names no location fails loudly', () => {
  const run = () => ({ status: 0, stdout: 'something else entirely', stderr: '' });
  expect(() => installLocations('/checkout/node_modules/playwright/cli.js', run, '/checkout')).toThrow(
    /named no install location/
  );
});

test('the chain the reconciler checks is the one the runner loads', () => {
  expect(RUNNER_CHAIN).toEqual(['@playwright/test', 'playwright', 'playwright-core']);
});
