// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const {
  groupFailuresByFile,
  isConnectionSignature,
  partitionVenueNoise,
  venueAvailabilityReport,
  locatorHandles,
  handlesIn,
  checkoutHead,
  isBehindCheckout,
  declaringFile,
  waitedHandles,
  venueContext
} = require('./file-failure-issues');

/**
 * Unit spec for the failure path's REPORT.
 *
 * The suite is launched on demand — a human, or an agent asked to run it —
 * so whoever launched it sees the red. The path's job is to make that red
 * READABLE: the outcome, and the context that tells a stale VENUE from a
 * defect of the product (#1895, #1896).
 */
test.describe('a failure carrying an edge-transport signature is venue noise (#1783)', () => {
  // The observed signatures of the 2026-11-10 outage: the edge refused
  // while the k3s node rebooted and the LoadBalancer address moved.
  // The fixture venue is an EXAMPLE address on purpose: the venue-origin
  // gate forbids a local-origin literal anywhere in the tree but the
  // edge's definition, and these fixtures carry a venue as DATA — the
  // report is venue-agnostic, so the fixtures are too.
  const VENUE = 'https://e2e-venue.example:4443';
  const OUTAGE_ERROR =
    'Error: page.goto: net::ERR_CONNECTION_REFUSED at https://e2e-venue.example:4443/\n' +
    '    at loginViaUI (tests/e2e/helpers/chatbot.js:50:9)';

  test('the refused, reset, closed and unresolved-edge signatures match', () => {
    for (const signature of [
      'net::ERR_CONNECTION_REFUSED at https://venue/',
      'page.goto: net::ERR_CONNECTION_RESET',
      'net::ERR_CONNECTION_CLOSED at https://venue/',
      'net::ERR_NAME_NOT_RESOLVED at https://e2e-venue.example:4443/'
    ]) {
      expect(isConnectionSignature({ error: signature }), signature).toBe(true);
    }
  });

  test('a product failure does not match — slow-venue signatures stay product findings', () => {
    for (const error of [
      'expect(received).toBe(expected) // Object.is equality',
      'Test timeout of 60000ms exceeded while running "beforeEach" hook',
      'page.goto: net::ERR_TIMED_OUT at https://venue/',
      'page.expect(locator).toHaveText failed'
    ]) {
      expect(isConnectionSignature({ error }), error).toBe(false);
    }
  });

  test('a missing or empty error carries no signature', () => {
    expect(isConnectionSignature({ error: '' })).toBe(false);
    expect(isConnectionSignature({})).toBe(false);
    expect(isConnectionSignature(null)).toBe(false);
  });

  test('the partition keeps product failures fileable and moves the signature ones to the report', () => {
    // The PRODUCTION partition is what is under test here — not a
    // re-implementation of it. A mixed file: one outage symptom, one
    // real assertion failure — the real one stays fileable, the outage
    // one is noise; an all-signature file drops out of the filing
    // entirely; a clean file passes through untouched.
    const grouped = groupFailuresByFile([
      {
        file: 'tests/e2e/welcome-banner.spec.js',
        title: 'shows the banner',
        test: { results: [{ error: { message: OUTAGE_ERROR, stack: '' } }] }
      },
      {
        file: 'tests/e2e/welcome-banner.spec.js',
        title: 'hides the banner',
        test: { results: [{ error: { message: 'expect(received).toBe(expected)', stack: '' } }] }
      },
      {
        file: 'tests/e2e/resizable-sidebars.spec.js',
        title: 'dies with the edge',
        test: { results: [{ error: { message: 'page.goto: net::ERR_CONNECTION_RESET', stack: '' } }] }
      },
      {
        file: 'tests/e2e/theme-runtime-config.spec.js',
        title: 'never touches the wire',
        test: { results: [{ error: { message: 'expect(received).toBe(expected)', stack: '' } }] }
      }
    ]);

    const { fileable, noise } = partitionVenueNoise(grouped);
    // welcome-banner: mixed — 1 real failure fileable, 1 signature noise.
    expect(fileable.get('tests/e2e/welcome-banner.spec.js').length).toBe(1);
    expect(isConnectionSignature(fileable.get('tests/e2e/welcome-banner.spec.js')[0])).toBe(false);
    expect(noise.get('tests/e2e/welcome-banner.spec.js').length).toBe(1);
    // resizable-sidebars: all-signature — fileable NOWHERE, noise only.
    expect(fileable.has('tests/e2e/resizable-sidebars.spec.js')).toBe(false);
    expect(noise.get('tests/e2e/resizable-sidebars.spec.js').length).toBe(1);
    // theme-runtime-config: no signature — passes through untouched.
    expect(fileable.get('tests/e2e/theme-runtime-config.spec.js').length).toBe(1);
    expect(noise.has('tests/e2e/theme-runtime-config.spec.js')).toBe(false);
  });

  test('the venue-availability report names the venue, the files and the verdict', () => {
    const noise = new Map([
      ['tests/e2e/welcome-banner.spec.js', [{ error: OUTAGE_ERROR }, { error: 'net::ERR_CONNECTION_RESET' }]],
      ['tests/e2e/resizable-sidebars.spec.js', [{ error: 'net::ERR_NAME_NOT_RESOLVED' }]]
    ]);
    const report = venueAvailabilityReport(noise, VENUE);
    expect(report).toContain('venue-availability report: 3 failure(s) across 2 spec file(s)');
    expect(report).toContain('- tests/e2e/welcome-banner.spec.js: 2 (e.g. net::ERR_CONNECTION_REFUSED)');
    expect(report).toContain('- tests/e2e/resizable-sidebars.spec.js: 1 (e.g. net::ERR_NAME_NOT_RESOLVED)');
    expect(report).toContain(`The venue answered the re-probe at ${VENUE}`);
    expect(report).toContain('NOT product findings');
  });
});

test.describe('the report names the CONTEXT of the red', () => {
  // The stale-venue trap: a venue serving an old build fails specs for
  // product-reasons that read like test defects. The report says which
  // build the venue serves, which build this checkout is at, and whether
  // the venue is behind — the three facts that decide what the red means.
  const FAILURE = [
    'Error: expect(locator).toBeVisible() failed',
    '',
    'Locator: locator(\'[data-testid="chat-history-item"]\')',
    'Expected: visible',
    'Error: element(s) not found'
  ].join('\n');

  test('the locator line names the handles the failure waited for', () => {
    expect(locatorHandles(FAILURE)).toEqual(['chat-history-item']);
    // Playwright's own spelling names the same handle in another form.
    expect(locatorHandles("Locator: locator.getByTestId('upload-files-dialog-confirm')")).toEqual([
      'upload-files-dialog-confirm'
    ]);
    // A failure with no locator line names no handle.
    expect(locatorHandles('Error: something else entirely')).toEqual([]);
  });

  test('a handle is matched as a QUOTED value', () => {
    // `upload-files-dialog` must not be read out of a text that carries
    // only `upload-files-dialog-confirm`.
    expect(handlesIn('<div data-testid="upload-files-dialog-confirm">')).toEqual(['upload-files-dialog-confirm']);
    expect(handlesIn('<div data-test-id="upload-files-dialog-confirm">')).toEqual(['upload-files-dialog-confirm']);
  });

  test('the report names the venue build, this checkout, and the relation', () => {
    const byFile = new Map([['tests/e2e/a.spec.js', [{ error: FAILURE }]]]);
    const report = venueContext(byFile, {
      venueBuild: 'abc1234def',
      head: 'fedcba987',
      behind: true,
      declaringFile: () => 'components/gov-chat-frontend/src/components/ChatFolders.vue'
    });
    expect(report).toContain('venue build: `abc1234def`');
    expect(report).toContain('this checkout: `fedcba987`');
    expect(report).toContain('BEHIND this checkout');
    expect(report).toContain('tests/e2e/a.spec.js');
    expect(report).toContain('chat-history-item');
    expect(report).toContain('components/gov-chat-frontend/src/components/ChatFolders.vue');
  });

  test('a venue that is NOT behind the checkout is told so', () => {
    // The other answer, and the one that means the red is the product's.
    const byFile = new Map([['tests/e2e/a.spec.js', [{ error: FAILURE }]]]);
    const report = venueContext(byFile, {
      venueBuild: 'abc1234def',
      head: 'fedcba987',
      behind: false,
      declaringFile: () => null
    });
    expect(report).toContain('NOT behind this checkout');
    expect(report).not.toContain('BEHIND this checkout');
  });

  test('a handle no source declares is named as such', () => {
    // A spec defect, not a stale venue: the checkout declares nothing.
    const byFile = new Map([['tests/e2e/a.spec.js', [{ error: FAILURE }]]]);
    const report = venueContext(byFile, {
      venueBuild: 'abc1234def',
      head: 'fedcba987',
      behind: true,
      declaringFile: () => null
    });
    expect(report).toContain('declared by NO source in this checkout');
  });

  test('a run with no build marker says so, unknown — not a fabricated sha', () => {
    const byFile = new Map([['tests/e2e/a.spec.js', [{ error: FAILURE }]]]);
    const report = venueContext(byFile, { venueBuild: '', head: 'fedcba987', behind: null, declaringFile: () => null });
    expect(report).toContain('venue build: unknown');
    expect(report).not.toMatch(/venue build: `[0-9a-f]{7,}`/);
    expect(report).toContain('not comparable');
  });

  test("the checkout's HEAD is read from the repository", () => {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    expect(checkoutHead()).toBe(head);
  });

  test('a build behind the checkout is behind it, and an unknown one is unknown', () => {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    // "Behind" means "an ancestor of the checkout": the checkout's own
    // build is its own ancestor, so a venue serving it is not behind.
    expect(isBehindCheckout(head)).toBe(true);
    // A sha no repository holds cannot be compared at all.
    expect(isBehindCheckout('deadbeefdeadbeefdeadbeefdeadbeefdeadbeef')).toBe(null);
  });

  test('the declaring file is the one that declares the handle', () => {
    const source = declaringFile('chat-history-item');
    expect(source).toBe('components/gov-chat-frontend/src/components/ChatFolders.vue');
    // A handle no source declares has no declaring file.
    expect(declaringFile('test-only-handle-no-source-declares')).toBe(null);
  });

  test("the frontend's OWN test tree declares no handle — its mocks are not the app", () => {
    // The frontend's Jest tree declares handles its mocks render
    // (`answer-source-card-0`). No build renders a mock, so naming the
    // test file as the declaring file would send the reader to a file
    // that is not the app.
    expect(declaringFile('answer-source-card-0')).toBe(null);
  });

  test("the handles a file waited for are the union of its failures' locators", () => {
    const failures = [
      { error: FAILURE },
      { error: 'Locator: locator(\'[data-testid="upload-files-dialog-confirm"]\')' }
    ];
    expect(waitedHandles(failures)).toEqual(['chat-history-item', 'upload-files-dialog-confirm']);
  });
});
