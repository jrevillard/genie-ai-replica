// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const { classifyVenueStatus, readVenueMapping } = require('./preflight');

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

test.describe('a venue mapping that cannot be read is a NAMED cause', () => {
  test('a readable mapping is returned as it is', () => {
    const mapping = { host: 'venue.example', ip: '10.0.0.1' };
    const read = readVenueMapping(() => mapping);
    expect(read.mapping).toBe(mapping);
    expect(read.error).toBe(null);
  });

  test('no mapping at all is not an error — the runner resolves the name itself', () => {
    // The mapping is OPT-IN: unset, the venue's name resolves on its own,
    // and there is nothing to report.
    const read = readVenueMapping(() => null);
    expect(read.mapping).toBe(null);
    expect(read.error).toBe(null);
  });

  test('a malformed ADDRESS is NAMED, not thrown', () => {
    // A BASE_URL that is not a URL makes the mapping read throw (the
    // mapping reads the host out of it). An unhandled throw is a stack
    // trace, which hides the cause behind a wall of frames — and naming
    // the cause is the pre-flight's whole purpose.
    const read = readVenueMapping(() => {
      throw new Error('Invalid URL');
    });
    expect(read.mapping).toBe(null);
    expect(read.error).toContain('Invalid URL');
    // The remedy the runner needs is in the message too.
    expect(read.error).toContain('E2E_VENUE_IP');
  });

  test('a malformed IP is NOT a failure HERE — it is carried as it is', () => {
    // The mapping reader validates nothing: a value that is not an
    // address is carried through, and the run fails LATER — at the
    // browser's launch, with the remedy already printed. The pre-flight
    // must not claim otherwise.
    const mapping = { host: 'venue.example', ip: 'not an address' };
    const read = readVenueMapping(() => mapping);
    expect(read.mapping).toBe(mapping);
    expect(read.error).toBe(null);
  });
});
