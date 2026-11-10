// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * Unit spec for the browser-tree reconciler (issue #1779).
 *
 * The reconciler is the guard against the failure it exists to prevent: a
 * browser tree that carries another Chromium revision than the pinned
 * Playwright names, which fails every spec at launch. The pins below are
 * about WHERE the numbers come from — the lockfile for the version, the
 * installed Playwright's own browsers.json for the revisions — because a
 * number written into the code is the drift itself.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  browserInstallCommand,
  describeRunner,
  installedPlaywrightVersion,
  pinnedPlaywrightVersion,
  requiredBrowserRevisions
} = require('./install-browsers');

// Revisions that appear nowhere in the repository: a fixture carrying them
// proves the implementation READ them instead of returning a constant.
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

const lockfile = (version) => ({
  packages: {
    '': { name: 'genie-ai' },
    'node_modules/@playwright/test': { version }
  }
});

const browsersJson = (chromium, shell) => ({
  browsers: [
    { name: 'chromium', revision: chromium },
    { name: 'chromium-headless-shell', revision: shell },
    { name: 'ffmpeg', revision: '1011' }
  ]
});

test.afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

test('the pinned version comes from the lockfile', () => {
  const root = makeRoot({ 'package-lock.json': lockfile(FIXTURE_VERSION) });
  expect(pinnedPlaywrightVersion(root)).toBe(FIXTURE_VERSION);
});

test('a lockfile that pins no @playwright/test fails loudly', () => {
  const root = makeRoot({ 'package-lock.json': { packages: { '': { name: 'genie-ai' } } } });
  expect(() => pinnedPlaywrightVersion(root)).toThrow(/pins no @playwright\/test/);
});

test('the installed version is null when the checkout has no node_modules', () => {
  const root = makeRoot({ 'package-lock.json': lockfile(FIXTURE_VERSION) });
  expect(installedPlaywrightVersion(root)).toBeNull();
});

test('the installed version is read from the checkout, not from a global install', () => {
  const root = makeRoot({
    'package-lock.json': lockfile(FIXTURE_VERSION),
    'node_modules/@playwright/test/package.json': { version: FIXTURE_VERSION }
  });
  expect(installedPlaywrightVersion(root)).toBe(FIXTURE_VERSION);
});

test('the revisions come from the installed Playwright browsers.json', () => {
  const root = makeRoot({
    'node_modules/playwright-core/browsers.json': browsersJson(FIXTURE_CHROMIUM, FIXTURE_SHELL)
  });
  expect(requiredBrowserRevisions(root)).toEqual({
    chromium: FIXTURE_CHROMIUM,
    chromiumHeadlessShell: FIXTURE_SHELL
  });
});

test('a browser the installed Playwright does not name fails loudly', () => {
  const root = makeRoot({
    'node_modules/playwright-core/browsers.json': {
      browsers: [{ name: 'chromium', revision: FIXTURE_CHROMIUM }]
    }
  });
  expect(() => requiredBrowserRevisions(root)).toThrow(/chromium-headless-shell/);
});

test('the runner describes the Playwright on disk and the revisions it names', () => {
  const root = makeRoot({
    'node_modules/@playwright/test/package.json': { version: FIXTURE_VERSION },
    'node_modules/playwright-core/browsers.json': browsersJson(FIXTURE_CHROMIUM, FIXTURE_SHELL)
  });
  expect(describeRunner(root)).toEqual({
    playwrightVersion: FIXTURE_VERSION,
    chromium: FIXTURE_CHROMIUM,
    chromiumHeadlessShell: FIXTURE_SHELL
  });
});

test('a checkout without @playwright/test cannot describe a runner', () => {
  const root = makeRoot({ 'package-lock.json': lockfile(FIXTURE_VERSION) });
  expect(() => describeRunner(root)).toThrow(/no @playwright\/test installed/);
});

test('the browser build is installed by the CHECKOUT Playwright, not a global one', () => {
  const root = makeRoot({});
  const { command, args } = browserInstallCommand(root);
  expect(command).toBe(process.execPath);
  expect(args).toEqual([path.join(root, 'node_modules', 'playwright', 'cli.js'), 'install', 'chromium']);
});
