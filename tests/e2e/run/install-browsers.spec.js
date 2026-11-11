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
 *
 * The fixtures carry revisions and versions that appear nowhere in the
 * repository, and a NESTED install whose hoisted siblings carry DIFFERENT
 * ones: a reader that resolves a fixed path instead of the runner's chain
 * reads the sibling and fails here.
 */
const { test, expect } = require('@playwright/test');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
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
// The real installer names ffmpeg alongside the two chromium builds.
const FIXTURE_FFMPEG = '4713';
const FIXTURE_VERSION = '9.9.9-fixture';
// The hoisted sibling's own numbers: what a reader that resolves a fixed
// path would find instead of the nested copy the runner loads.
const HOISTED_VERSION = '1.0.0-hoisted';
const HOISTED_CHROMIUM = '1001';
const HOISTED_SHELL = '1002';

const roots = [];

/**
 * A throwaway checkout root carrying the given files.
 * @param {Object<string, Object|string>} files the files, by relative path
 * @returns {string} the root
 */
const makeRoot = (files) => {
  // The checkout lives INSIDE its own temporary directory, so the
  // directory above it is this test's alone: a test that plants a package
  // in an ancestor directory must not write to a shared one (/tmp), where
  // it would collide with another run and delete another run's state.
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'genieai-install-browsers-'));
  roots.push(base);
  const root = path.join(base, 'checkout');
  fs.mkdirSync(root, { recursive: true });
  for (const [rel, content] of Object.entries(files)) {
    const file = path.join(root, rel);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content, null, 2));
  }
  return root;
};

const browsersJson = (chromium, shell) => ({
  browsers: [
    { name: 'chromium', revision: chromium },
    { name: 'chromium-headless-shell', revision: shell }
  ]
});

/**
 * The files of a runner chain: the three packages the runner loads, at the
 * versions given, plus the browsers.json the revisions come from.
 * @param {string} version the version of @playwright/test and playwright
 * @param {string} coreVersion the version of playwright-core
 * @returns {Object<string, Object|string>} the files, by relative path
 */
const chainFiles = (version, coreVersion) => ({
  'node_modules/@playwright/test/package.json': { name: '@playwright/test', version },
  'node_modules/playwright/package.json': { name: 'playwright', version },
  'node_modules/playwright/cli.js': '// the CLI of the fixture',
  'node_modules/playwright-core/package.json': { name: 'playwright-core', version: coreVersion },
  'node_modules/playwright-core/browsers.json': browsersJson(FIXTURE_CHROMIUM, FIXTURE_SHELL)
});

const lockfile = (version) => ({
  packages: {
    '': { name: 'genie-ai' },
    'node_modules/@playwright/test': { version },
    'node_modules/playwright': { version },
    'node_modules/playwright-core': { version }
  }
});

/**
 * A checkout whose runner chain is installed at the pinned versions.
 * @param {Object} [options] the versions that differ from the pinned one
 * @returns {string} the root
 */
const makeCheckout = (options = {}) => {
  const version = FIXTURE_VERSION;
  const coreVersion = options.coreVersion || version;
  return makeRoot({
    'package-lock.json': lockfile(version),
    ...chainFiles(version, coreVersion)
  });
};

/**
 * A checkout whose runner chain is NESTED under @playwright/test, with
 * hoisted siblings that carry other versions — the shape a version
 * conflict produces, and the shape a fixed-path reader gets wrong.
 * @returns {string} the root
 */
const makeNestedCheckout = () =>
  makeRoot({
    'package-lock.json': {
      packages: {
        '': { name: 'genie-ai' },
        'node_modules/@playwright/test': { version: FIXTURE_VERSION },
        'node_modules/playwright': { version: HOISTED_VERSION },
        'node_modules/playwright-core': { version: HOISTED_VERSION },
        'node_modules/@playwright/test/node_modules/playwright': { version: FIXTURE_VERSION },
        'node_modules/@playwright/test/node_modules/playwright/node_modules/playwright-core': {
          version: FIXTURE_VERSION
        }
      }
    },
    'node_modules/@playwright/test/package.json': { name: '@playwright/test', version: FIXTURE_VERSION },
    'node_modules/playwright/package.json': { name: 'playwright', version: HOISTED_VERSION },
    'node_modules/playwright/cli.js': '// the CLI of the HOISTED sibling',
    'node_modules/playwright-core/package.json': { name: 'playwright-core', version: HOISTED_VERSION },
    'node_modules/playwright-core/browsers.json': browsersJson(HOISTED_CHROMIUM, HOISTED_SHELL),
    'node_modules/@playwright/test/node_modules/playwright/package.json': {
      name: 'playwright',
      version: FIXTURE_VERSION
    },
    'node_modules/@playwright/test/node_modules/playwright/cli.js': '// the CLI of the NESTED copy',
    'node_modules/@playwright/test/node_modules/playwright/node_modules/playwright-core/package.json': {
      name: 'playwright-core',
      version: FIXTURE_VERSION
    },
    'node_modules/@playwright/test/node_modules/playwright/node_modules/playwright-core/browsers.json':
      browsersJson(FIXTURE_CHROMIUM, FIXTURE_SHELL)
  });

test.afterAll(() => {
  for (const root of roots) fs.rmSync(root, { recursive: true, force: true });
});

test('the pinned versions come from the lockfile, for every package of the chain', () => {
  const root = makeCheckout();
  expect(pinnedVersions(root).versions).toEqual({
    '@playwright/test': FIXTURE_VERSION,
    playwright: FIXTURE_VERSION,
    'playwright-core': FIXTURE_VERSION
  });
  expect(pinnedVersions(root).keys['playwright-core']).toBe('node_modules/playwright-core');
});

test('a lockfile that pins no playwright fails loudly', () => {
  const root = makeRoot({ 'package-lock.json': { packages: { '': { name: 'genie-ai' } } } });
  expect(() => pinnedVersions(root)).toThrow(/pins no @playwright\/test/);
});

test("the runner's chain is resolved the way the runner resolves it", () => {
  const root = makeNestedCheckout();
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

test('a NESTED chain is loaded, not the hoisted sibling', () => {
  // The mutation this pins: a reader that resolved a fixed path would read
  // the hoisted sibling's versions, and the reconciler would compare one
  // package against another.
  const root = makeNestedCheckout();
  expect(runnerVersions(root)).toEqual({
    '@playwright/test': FIXTURE_VERSION,
    playwright: FIXTURE_VERSION,
    'playwright-core': FIXTURE_VERSION
  });
});

test('a NESTED chain is pinned by its own lockfile entry', () => {
  // The pin side must walk the same chain as the loaded side, or the
  // comparison is between two differently-resolved things.
  const root = makeNestedCheckout();
  const pinned = pinnedVersions(root);
  expect(pinned.versions).toEqual({
    '@playwright/test': FIXTURE_VERSION,
    playwright: FIXTURE_VERSION,
    'playwright-core': FIXTURE_VERSION
  });
  expect(pinned.keys['playwright-core']).toBe(
    'node_modules/@playwright/test/node_modules/playwright/node_modules/playwright-core'
  );
});

test('the revisions come from the resolved playwright-core browsers.json', () => {
  const root = makeCheckout();
  expect(requiredBrowserRevisions(root)).toEqual({
    chromium: FIXTURE_CHROMIUM,
    chromiumHeadlessShell: FIXTURE_SHELL
  });
});

test('a NESTED chain names its own revisions, not the hoisted sibling\'s', () => {
  const root = makeNestedCheckout();
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

test('a NESTED chain is installed by its own CLI', () => {
  const root = makeNestedCheckout();
  const { args } = browserInstallCommand(root);
  expect(args).toEqual([
    path.join(root, 'node_modules/@playwright/test/node_modules/playwright/cli.js'),
    'install',
    'chromium'
  ]);
});

test('the runner describes the versions loaded and the revisions they name', () => {
  const root = makeCheckout();
  expect(describeRunner(root)).toEqual({
    playwrightVersion: FIXTURE_VERSION,
    chromium: FIXTURE_CHROMIUM,
    chromiumHeadlessShell: FIXTURE_SHELL
  });
});

test('a checkout without @playwright/test cannot describe a runner, and says so', () => {
  const root = makeRoot({ 'package-lock.json': { packages: {} } });
  expect(() => describeRunner(root)).toThrow(/no @playwright\/test installed/);
});

// --- the reconciler itself (the part with the side effects) --------------------

/**
 * The browser builds the fixture's dry run names, really created on disk:
 * the reconciler checks the tree with the filesystem, so the test gives it
 * a real tree (and, where a case needs one absent, a real absence).
 * @param {string} root the fixture root
 * @param {Object} [options] which builds to create
 * @returns {Object<string, string>} the locations, by browser name
 */
const buildTree = (root, options = {}) => {
  const locations = {
    chromium: path.join(root, 'browsers', `chromium-${FIXTURE_CHROMIUM}`),
    ffmpeg: path.join(root, 'browsers', `ffmpeg-${FIXTURE_FFMPEG}`),
    'chromium-headless-shell': path.join(root, 'browsers', `chromium_headless_shell-${FIXTURE_SHELL}`)
  };
  const wanted = { chromium: true, ffmpeg: true, 'chromium-headless-shell': true, ...options.include };
  for (const name of Object.keys(wanted)) {
    const location = locations[name];
    if (wanted[name] === 'absent') continue;
    fs.mkdirSync(location, { recursive: true });
    if (wanted[name] === 'no-marker') continue;
    fs.writeFileSync(path.join(location, 'INSTALLATION_COMPLETE'), '');
  }
  return locations;
};

/**
 * The process runner the reconciler drives, answering the dry run with the
 * install locations and recording what it was asked to run.
 * @param {string} root the fixture root
 * @param {Object} [options] the fixture's answers
 * @returns {{run: Function, calls: Array}} the runner and the calls it saw
 */
const fakeRun = (root, options = {}) => {
  const calls = [];
  const tree = options.tree || buildTree(root);
  const locations = [
    { name: 'chromium', revision: FIXTURE_CHROMIUM, location: tree.chromium },
    { name: 'ffmpeg', revision: FIXTURE_FFMPEG, location: tree.ffmpeg },
    {
      name: 'chromium-headless-shell',
      revision: FIXTURE_SHELL,
      location: tree['chromium-headless-shell']
    }
  ];
  const run = (command, args) => {
    calls.push({ command, args });
    if (args.includes('--dry-run')) {
      if (options.dryRunResult) return options.dryRunResult;
      const stdout = locations
        .map((l) => `Chrome (playwright ${l.name} v${l.revision})\n  Install location:    ${l.location}`)
        .join('\n');
      return { status: 0, stdout, stderr: '' };
    }
    if (args[0] && args[0].endsWith('cli.js')) {
      return options.installResult || { status: 0, stdout: '', stderr: '' };
    }
    // npm ci restores the tree from the lockfile; the fixture's onCi stands
    // in for that restore.
    if (options.onCi) options.onCi();
    return options.npmResult || { status: 0, stdout: '', stderr: '' };
  };
  return { run, calls };
};

test('a matching checkout is not reinstalled, and a complete tree is not reinstalled either', () => {
  // The install is a no-op when every build the installer names is already
  // there — spawning it again would cost a process and change nothing.
  const root = makeCheckout();
  const { run, calls } = fakeRun(root);
  const result = reconcile(root, { run });
  expect(calls.some((c) => c.args[0] === 'ci')).toBe(false);
  expect(calls.filter((c) => c.args.includes('chromium') && !c.args.includes('--dry-run'))).toEqual([]);
  expect(result.versions['@playwright/test']).toBe(FIXTURE_VERSION);
  expect(result.chromium).toBe(FIXTURE_CHROMIUM);
});

test('a missing build is installed by the CHECKOUT Playwright, not a global one', () => {
  const root = makeCheckout();
  const { run, calls } = fakeRun(root, {
    tree: buildTree(root, { include: { chromium: 'no-marker' } })
  });
  expect(() => reconcile(root, { run })).toThrow(/carries no INSTALLATION_COMPLETE/);
  const install = calls.find((c) => c.args.includes('chromium') && !c.args.includes('--dry-run'));
  expect(install).toBeDefined();
  expect(install.args[0]).toBe(path.join(root, 'node_modules/playwright/cli.js'));
});

test('a checkout that does not match the lockfile is reinstalled with the dev dependencies', () => {
  const root = makeCheckout({ coreVersion: '1.0.0-older-core' });
  const { run, calls } = fakeRun(root, {
    onCi: () =>
      fs.writeFileSync(
        path.join(root, 'node_modules/playwright-core/package.json'),
        JSON.stringify({ name: 'playwright-core', version: FIXTURE_VERSION })
      )
  });
  reconcile(root, { run });
  const ci = calls.find((c) => c.args[0] === 'ci');
  expect(ci).toBeDefined();
  // --include=dev: @playwright/test is a devDependency, and a
  // NODE_ENV=production npm ci would omit the package being reconciled.
  expect(ci.args).toContain('--include=dev');
});

test('a checkout that STILL does not match after npm ci fails loudly, and names the path', () => {
  // The guard that makes npm ci trustworthy: a tree npm ci did not bring
  // back to the lockfile must not pass as reconciled — and the report names
  // WHERE the version was loaded from, or the operator cannot tell which
  // tree to fix.
  const root = makeCheckout({ coreVersion: '1.0.0-older-core' });
  const { run } = fakeRun(root);
  expect(() => reconcile(root, { run })).toThrow(
    /still does not match the lockfile.*playwright-core 1\.0\.0-older-core at .*playwright-core\/package\.json.*vs 9\.9\.9-fixture pinned under node_modules\/playwright-core/
  );
});

test('the chain is resolved on the disk, not from a stale resolution cache', () => {
  // The mutation this pins: a reader that resolved through require.resolve
  // would hand back the path it cached BEFORE the tree was replaced — a
  // path that no longer exists — and the reconciler would die with a raw
  // ENOENT in exactly the drift case it exists to fix.
  const root = makeCheckout();
  expect(resolvePackage('playwright', root)).toBe(path.join(root, 'node_modules/playwright/package.json'));
  fs.rmSync(path.join(root, 'node_modules/playwright'), { recursive: true, force: true });
  const nested = path.join(root, 'node_modules/@playwright/test/node_modules/playwright');
  fs.mkdirSync(nested, { recursive: true });
  fs.writeFileSync(path.join(nested, 'package.json'), JSON.stringify({ name: 'playwright', version: '2.0.0-restored' }));
  expect(resolvePackage('playwright', root)).toBe(path.join(nested, 'package.json'));
});

test('the walk does not escape ABOVE the checkout', () => {
  // The mutation this pins: without the checkout boundary the walk climbs
  // into an ancestor directory and resolves a copy the lockfile does not
  // pin — the reconciler would report success on a checkout it never
  // touched.
  const root = makeCheckout();
  const ancestor = path.dirname(root);
  const decoy = path.join(ancestor, 'node_modules/@playwright/test');
  fs.mkdirSync(decoy, { recursive: true });
  fs.writeFileSync(path.join(decoy, 'package.json'), JSON.stringify({ name: '@playwright/test', version: '9.9.9-ancestor' }));
  try {
    fs.rmSync(path.join(root, 'node_modules/@playwright/test'), { recursive: true, force: true });
    expect(() => resolvePackage('@playwright/test', root)).toThrow(/carries no @playwright\/test/);
  } finally {
    fs.rmSync(decoy, { recursive: true, force: true });
  }
});

test('the walk does not probe a node_modules level for another one', () => {
  // The mutation this pins: Node never looks inside a node_modules
  // directory for another one, and neither does this walk. A copy planted
  // at <root>/node_modules/node_modules is not a package the checkout
  // carries — resolving it would reconcile against a tree that does not
  // exist.
  const root = makeCheckout();
  fs.rmSync(path.join(root, 'node_modules/playwright-core'), { recursive: true, force: true });
  const planted = path.join(root, 'node_modules/node_modules/playwright-core');
  fs.mkdirSync(path.join(planted), { recursive: true });
  fs.writeFileSync(
    path.join(planted, 'package.json'),
    JSON.stringify({ name: 'playwright-core', version: '9.9.9-planted' })
  );
  expect(() => resolvePackage('playwright-core', root)).toThrow(/carries no playwright-core/);
});

test('the runner reported is the @playwright/test of the chain, not another link of it', () => {
  // The mutation this pins: the three links of the chain can carry
  // DIFFERENT versions, so a reader that reported the wrong one would
  // report a runner the suite never loads.
  const root = makeRoot({
    'package-lock.json': lockfile(FIXTURE_VERSION),
    'node_modules/@playwright/test/package.json': { name: '@playwright/test', version: FIXTURE_VERSION },
    'node_modules/playwright/package.json': { name: 'playwright', version: '1.2.3-other' },
    'node_modules/playwright/cli.js': '// the CLI of the fixture',
    'node_modules/playwright-core/package.json': { name: 'playwright-core', version: '4.5.6-other' },
    'node_modules/playwright-core/browsers.json': browsersJson(FIXTURE_CHROMIUM, FIXTURE_SHELL)
  });
  expect(describeRunner(root).playwrightVersion).toBe(FIXTURE_VERSION);
});

test('the lockfile walk does not read a pin from a node_modules level either', () => {
  // The mutation this pins: the walk must not read a pin planted at
  // node_modules/node_modules — the level Node never searches — where it
  // would be NEARER than the hoisted pin and win the comparison.
  const root = makeRoot({
    'package-lock.json': {
      packages: {
        '': { name: 'genie-ai' },
        'node_modules/@playwright/test': { version: FIXTURE_VERSION },
        'node_modules/playwright': { version: FIXTURE_VERSION },
        'node_modules/playwright-core': { version: FIXTURE_VERSION },
        'node_modules/node_modules/playwright': { version: '9.9.9-planted' }
      }
    },
    ...chainFiles(FIXTURE_VERSION, FIXTURE_VERSION)
  });
  expect(pinnedVersions(root).versions.playwright).toBe(FIXTURE_VERSION);
});

test('the chain is the ROOT project\'s — the suite project does not own the runtime', () => {
  // The mutation this pins: the chain starts at the repository root, where
  // the lockfile that pins it lives. A copy under tests/e2e/node_modules
  // (the suite project's own tree) is not the runtime the root's lockfile
  // pins, and reading it would compare one project's packages with
  // another's pins.
  const root = makeCheckout();
  const stray = path.join(root, 'tests/e2e/node_modules/@playwright/test');
  fs.mkdirSync(stray, { recursive: true });
  fs.writeFileSync(path.join(stray, 'package.json'), JSON.stringify({ name: '@playwright/test', version: '9.9.9-stray' }));
  expect(resolvePackage('@playwright/test', root)).toBe(
    path.join(root, 'node_modules/@playwright/test/package.json')
  );
  expect(runnerVersions(root)['@playwright/test']).toBe(FIXTURE_VERSION);
});

test('a repaired checkout reports the runtime npm ci installed, not the one it replaced', () => {
  // The mutation this pins: a summary that still names the PRE-repair
  // version reports the runtime the run did NOT use — and on a checkout
  // with no node_modules at all (the pod-recreation case) it reports
  // nothing and crashes.
  const root = makeCheckout({ coreVersion: '1.0.0-older-core' });
  const { run } = fakeRun(root, {
    onCi: () =>
      fs.writeFileSync(
        path.join(root, 'node_modules/playwright-core/package.json'),
        JSON.stringify({ name: 'playwright-core', version: FIXTURE_VERSION })
      )
  });
  const result = reconcile(root, { run });
  expect(result.versions['playwright-core']).toBe(FIXTURE_VERSION);
});

test('a checkout with no node_modules at all is repaired and reported', () => {
  // The pod-recreation case: the checkout has nothing installed, npm ci
  // installs it, and the summary names what is now on disk.
  const root = makeRoot({ 'package-lock.json': lockfile(FIXTURE_VERSION) });
  const install = () => {
    for (const [rel, content] of Object.entries(chainFiles(FIXTURE_VERSION, FIXTURE_VERSION))) {
      const file = path.join(root, rel);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, typeof content === 'string' ? content : JSON.stringify(content));
    }
  };
  const { run } = fakeRun(root, { onCi: install });
  const result = reconcile(root, { run });
  expect(result.versions['@playwright/test']).toBe(FIXTURE_VERSION);
  expect(result.chromium).toBe(FIXTURE_CHROMIUM);
});

test('the HEADLESS SHELL is verified — the build the runner launches', () => {
  // The mutation this pins: a check that only looked at the full chrome
  // would pass a tree whose headless shell is missing, and every spec would
  // still die at launch.
  const root = makeCheckout();
  const { run, calls } = fakeRun(root, {
    tree: buildTree(root, { include: { 'chromium-headless-shell': 'absent' } })
  });
  expect(() => reconcile(root, { run })).toThrow(/chromium-headless-shell build is not installed/);
  // The missing build must have TRIGGERED the install: without this the
  // reconciler could skip the repair and still report the same error, and
  // #1779's own defect — one missing binary, unrepaired — would survive a
  // green suite.
  expect(calls.find((c) => c.args.includes('chromium') && !c.args.includes('--dry-run'))).toBeDefined();
});

test('a build without the completion marker is not a complete build', () => {
  const root = makeCheckout();
  const { run } = fakeRun(root, {
    tree: buildTree(root, { include: { chromium: 'no-marker' } })
  });
  expect(() => reconcile(root, { run })).toThrow(/carries no INSTALLATION_COMPLETE/);
});

test('a checkout without a Playwright CLI fails loudly', () => {
  const root = makeCheckout();
  fs.rmSync(path.join(root, 'node_modules/playwright/cli.js'));
  const { run } = fakeRun(root);
  expect(() => reconcile(root, { run })).toThrow(/Playwright CLI is not there/);
});

test('an install that fails is not reported as a reconciled tree', () => {
  const root = makeCheckout();
  const { run } = fakeRun(root, {
    // A missing build, so the install is actually spawned.
    tree: buildTree(root, { include: { chromium: 'no-marker' } }),
    installResult: { status: 1, stdout: '', stderr: 'boom' }
  });
  expect(() => reconcile(root, { run })).toThrow(/browser install failed/);
});

test('a dry run that fails is not reported as a reconciled tree', () => {
  const root = makeCheckout();
  const { run } = fakeRun(root, { dryRunResult: { status: 1, stdout: '', stderr: 'boom' } });
  expect(() => reconcile(root, { run })).toThrow(/dry run failed/);
});

test('a failed npm ci says that node_modules may be gone — npm ci removes it first', () => {
  const root = makeCheckout({ coreVersion: '1.0.0-older-core' });
  const { run } = fakeRun(root, { npmResult: { status: 1, stdout: '', stderr: 'boom' } });
  expect(() => reconcile(root, { run })).toThrow(/may have no node_modules/);
});

test('an npm that cannot be started is named, not reported as an exit code', () => {
  const root = makeCheckout({ coreVersion: '1.0.0-older-core' });
  const error = new Error('spawn npm ENOENT');
  const { run } = fakeRun(root, { npmResult: { status: null, stdout: '', stderr: '', error } });
  expect(() => reconcile(root, { run })).toThrow(/npm could not be started/);
});

test('the installer locations are read from the installer itself', () => {
  const root = makeCheckout();
  const { run } = fakeRun(root);
  const cli = path.join(root, 'node_modules/playwright/cli.js');
  const locations = installLocations(cli, run, root);
  expect(locations.map((l) => l.name)).toEqual(['chromium', 'ffmpeg', 'chromium-headless-shell']);
  expect(locations.map((l) => l.location)).toEqual([
    path.join(root, 'browsers', `chromium-${FIXTURE_CHROMIUM}`),
    path.join(root, 'browsers', `ffmpeg-${FIXTURE_FFMPEG}`),
    path.join(root, 'browsers', `chromium_headless_shell-${FIXTURE_SHELL}`)
  ]);
});

test('a browser path with a space in it is read whole', () => {
  // The mutation this pins: a location captured up to the first blank is
  // truncated, and the verification then looks for a build at a path that
  // does not exist — a reconciled machine reported as broken.
  const location = '/opt/my browsers/chromium-4711';
  const run = () => ({
    status: 0,
    // The padding the installer prints around the path is not part of it.
    stdout: `Chrome (playwright chromium v4711)\n  Install location:    ${location}   \n`,
    stderr: ''
  });
  expect(installLocations('/checkout/node_modules/playwright/cli.js', run, '/checkout')[0].location).toBe(
    location
  );
});

test('an installer that names no location fails loudly', () => {
  const run = () => ({ status: 0, stdout: 'something else entirely', stderr: '' });
  expect(() => installLocations('/checkout/node_modules/playwright/cli.js', run, '/checkout')).toThrow(
    /named no install location/
  );
});

