// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
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
