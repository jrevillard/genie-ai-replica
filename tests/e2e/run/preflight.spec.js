// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { classifyVenueStatus, namedFailure } = require('./preflight');

/**
 * Unit spec for the pre-flight's diagnosis.
 *
 * The message the pre-flight prints is the operator's FIRST clue: it must
 * say which finding they are looking at — no answer at all, a 5xx (the
 * deployment is down), or a 4xx (the edge refused). The classification is
 * a pure function, so it is pinned here without a browser and without a
 * venue.
 *
 * Requiring the module must not START the pre-flight — the file runs its
 * body only when it is the entry point (a spec that required it would
 * otherwise launch a Chromium).
 */
const VENUE = 'https://venue.example:4443';

test.describe('the pre-flight names the finding the venue status carries', () => {
  test('no answer at all is its own finding', () => {
    const message = classifyVenueStatus(0, VENUE);
    expect(message).toContain('no response arrived');
    // It must not claim the venue answered: it did not.
    expect(message).not.toContain('answered HTTP 0');
  });

  test('a 5xx is the deployment being down', () => {
    const message = classifyVenueStatus(503, VENUE);
    expect(message).toContain('the deployment is down');
    expect(message).toContain('HTTP 503');
  });

  test('a 4xx is the edge refusing — and both of its causes are named', () => {
    const message = classifyVenueStatus(404, VENUE);
    expect(message).toContain("the address is not the app's edge");
    expect(message).toContain('refuses an anonymous request');
    expect(message).toContain('HTTP 404');
  });

  test('a status that is not a failure has no diagnosis', () => {
    // The pre-flight only asks about a failed navigation. A "cause" for a
    // 200 would be a lie waiting for a caller that asks.
    expect(classifyVenueStatus(200, VENUE)).toBe(null);
    expect(classifyVenueStatus(302, VENUE)).toBe(null);
  });

  test('the venue address is in the message', () => {
    expect(classifyVenueStatus(404, VENUE)).toContain(VENUE);
    expect(classifyVenueStatus(0, VENUE)).toContain(VENUE);
  });
});

test.describe('every cause the pre-flight names carries the remedy', () => {
  test('a runner that cannot load names the cause and what the runner needs', () => {
    const message = namedFailure('the runner cannot load Playwright', "Cannot find module '@playwright/test'");
    // The cause: what failed, and why.
    expect(message).toContain('pre-flight: the runner cannot load Playwright.');
    expect(message).toContain("Cannot find module '@playwright/test'");
    // The remedy: what to do about it.
    expect(message).toContain('the runner needs:');
    // And no stack frame: a cause, not a trace.
    expect(message).not.toContain('\n    at ');
  });

  test('a browser that will not launch names the cause and what the runner needs', () => {
    const message = namedFailure('the browser did not launch', 'browserType.launch: Executable does not exist');
    expect(message).toContain('pre-flight: the browser did not launch.');
    expect(message).toContain('Executable does not exist');
    expect(message).toContain('the runner needs:');
    expect(message).not.toContain('\n    at ');
  });
});

test.describe('the pre-flight NAMES a cause it cannot use', () => {
  test('a mapping that cannot be read is named, and the run stops with 1', () => {
    // The pre-flight's OWN boundary: the process the run script invokes.
    // A stubbed reader would only prove that the wrapper passes a string
    // through — the cause the operator reads is produced by the mapping
    // module and printed by the pre-flight, and only the process shows
    // both.
    //
    // The DNS preload is loaded here too, because it runs inside every
    // process of the run: a preload that died on the bad value would
    // take the pre-flight down with it, and the operator would read a
    // stack trace instead of the named cause.
    const script = path.join(__dirname, 'preflight.js');
    const preload = path.join(__dirname, 'venue-dns.js');
    let stderr = '';
    let code = 0;
    try {
      execFileSync(process.execPath, [script], {
        env: {
          ...process.env,
          E2E_VENUE_IP: 'not an address',
          E2E_VENUE_HOST: 'venue.example',
          NODE_OPTIONS: `--require ${preload}`,
        },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (e) {
      stderr = String(e.stderr || '');
      code = e.status;
    }
    // The cause is NAMED, with the value that is wrong.
    expect(stderr).toContain('E2E_VENUE_IP is not an address');
    // And it is the pre-flight's OWN framing, not a stack trace that
    // quotes the same words: a preload that died with this message would
    // satisfy the line above and hide the cause behind a wall of frames.
    expect(stderr).toContain('pre-flight: the venue mapping is not usable.');
    expect(stderr).not.toContain('\n    at ');
    // And the run stops: the exit code says so.
    expect(code).toBe(1);
  });
});

/**
 * The pre-flight with a STUBBED runner: the navigation AND the close
 * both fail.
 *
 * The operator must hear BOTH. The first cause is the finding; the
 * cleanup failure says a Chromium may be left running — and the suite's
 * cleanup rule asks for exactly that ("the default is a failing cleanup
 * that reports exactly what it could not remove"). A cleanup failure
 * swallowed behind the first cause is a silent leftover.
 *
 * The stub replaces the runner in a THROWAWAY tree: the pre-flight and
 * the modules it loads are COPIED there at run time (the repo's own
 * bytes, not a hand-written copy that could drift), and a fake
 * `@playwright/test` stands in for the real one. The runner DESCRIPTOR
 * is stubbed too, so the tree needs no browser tree and no real
 * package chain. Nothing in the repo is touched.
 */
function withStubbedRunner(fn, venueAnswers = 'no') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'preflight-stub-'));
  try {
    for (const file of ['run/preflight.js', 'helpers/base-url.js', 'helpers/venue-launch-args.js']) {
      fs.mkdirSync(path.join(root, path.dirname(file)), { recursive: true });
      fs.copyFileSync(path.join(__dirname, '..', file), path.join(root, file));
    }
    // The runner descriptor, stubbed: the pre-flight reports the runner
    // it found, and the tree has no browser tree to inspect.
    fs.writeFileSync(
      path.join(root, 'run', 'install-browsers.js'),
      "module.exports = { describeRunner: () => ({ playwrightVersion: 'stub', chromium: 'stub', " +
        "chromiumHeadlessShell: 'stub' }) };\n"
    );
    // The runner itself, stubbed: the close ALWAYS fails, and the
    // navigation fails unless the case says the venue answered.
    const pkg = path.join(root, 'node_modules', '@playwright', 'test');
    fs.mkdirSync(pkg, { recursive: true });
    fs.writeFileSync(
      path.join(pkg, 'package.json'),
      JSON.stringify({ name: '@playwright/test', version: '0.0.0', main: 'index.js' })
    );
    fs.writeFileSync(
      path.join(pkg, 'index.js'),
      [
        'const chromium = {',
        '  launch: async () => ({',
        '    newContext: async () => ({',
        '      newPage: async () => ({',
        '        goto: async () => {',
        "          if (process.env.STUB_VENUE_ANSWERS === 'yes') return { status: () => 200 };",
        "          throw new Error('the stub could not open the venue');",
        '        }',
        '      })',
        '    }),',
        "    close: async () => { throw new Error('the stub could not close'); }",
        '  })',
        '};',
        'module.exports = { chromium };',
        ''
      ].join('\n')
    );
    let stderr = '';
    let code = 0;
    try {
      execFileSync(process.execPath, [path.join(root, 'run', 'preflight.js')], {
        // The mapping is the case's business, not the developer's shell:
        // an ambient E2E_VENUE_IP (or an invalid one) would hijack it.
        env: { ...process.env, BASE_URL: VENUE, E2E_VENUE_IP: '', E2E_VENUE_HOST: '', STUB_VENUE_ANSWERS: venueAnswers },
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (e) {
      stderr = String(e.stderr || '');
      code = e.status;
    }
    return fn({ stderr, code });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test.describe('the pre-flight reports a FAILED CLEANUP', () => {
  test('a close that fails is reported beside the first cause', () => {
    withStubbedRunner(({ stderr, code }) => {
      // The first cause stays the headline.
      expect(stderr).toContain('pre-flight: the browser could not open the venue.');
      expect(stderr).toContain('the stub could not open the venue');
      // AND the cleanup failure is reported: a Chromium may be left
      // running, and the operator has to hear it.
      expect(stderr).toContain('pre-flight: the browser could not close.');
      expect(stderr).toContain('the stub could not close');
      // The ORDER is the disposition: the finding comes first, the
      // cleanup after it. A report that put the cleanup first would
      // bury the finding.
      expect(stderr.indexOf('pre-flight: the browser could not close.')).toBeGreaterThan(
        stderr.indexOf('pre-flight: the browser could not open the venue.')
      );
      // Both are causes, not traces.
      expect(stderr).not.toContain('\n    at ');
      // And the run stops.
      expect(code).toBe(1);
    });
  });

  test('a close that fails ALONE still stops the run', () => {
    // The venue answered, the browser could not close: nothing else
    // failed, so the exit code belongs to the CLEANUP. A cleanup that
    // left the run at 0 would let the suite start against a browser
    // nobody closed.
    withStubbedRunner(
      ({ stderr, code }) => {
        expect(stderr).toContain('pre-flight: the browser could not close.');
        expect(stderr).toContain('the stub could not close');
        // There was no other cause: the venue answered.
        expect(stderr).not.toContain('pre-flight: the browser could not open the venue.');
        expect(code).toBe(1);
      },
      'yes'
    );
  });
});
