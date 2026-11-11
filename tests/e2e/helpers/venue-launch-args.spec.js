// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const { venueMapping, safeVenueMapping, venueLaunchArgs } = require('./venue-launch-args');

/**
 * Unit spec for the venue's name mapping.
 *
 * The mapping is what lets a runner OUTSIDE the cluster reach the
 * shared stack: the stack advertises its edge under a name the cluster
 * DNS does not serve, so the runner needs the address behind it. The
 * mapping reaches two resolvers — Node (the API helpers) and Chromium
 * (`--host-resolver-rules`) — and a value that is not an address must
 * be named WHERE IT IS READ, not rejected by Chromium several minutes
 * later as a browser that will not start.
 */
test.describe('the venue mapping names a bad value where it is read', () => {
  const withEnv = (env, fn) => {
    const saved = {};
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      return fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  test('no mapping at all — the runner resolves the name itself', () => {
    withEnv({ E2E_VENUE_IP: undefined, E2E_VENUE_HOST: undefined }, () => {
      expect(venueMapping()).toBe(null);
      // No mapping, no launch arguments: the suite behaves as before.
      expect(venueLaunchArgs()).toEqual([]);
    });
  });

  test('an address is carried through', () => {
    withEnv({ E2E_VENUE_IP: '10.42.0.189', E2E_VENUE_HOST: 'venue.example' }, () => {
      expect(venueMapping()).toEqual({ host: 'venue.example', ip: '10.42.0.189' });
      // The BROWSER half of the same mapping.
      expect(venueLaunchArgs()).toEqual(['--host-resolver-rules=MAP venue.example 10.42.0.189']);
    });
  });

  test('an IPv6 address is an address', () => {
    withEnv({ E2E_VENUE_IP: '::1', E2E_VENUE_HOST: 'venue.example' }, () => {
      expect(venueMapping()).toEqual({ host: 'venue.example', ip: '::1' });
    });
  });

  test('a value that is not an address is NAMED', () => {
    withEnv({ E2E_VENUE_IP: 'not an address', E2E_VENUE_HOST: 'venue.example' }, () => {
      // Without this, the value reaches Chromium as
      // `--host-resolver-rules=MAP venue.example not an address` and the
      // browser fails to start — a failure that reads like a runner
      // problem, not a configuration mistake.
      expect(() => venueMapping()).toThrow(/E2E_VENUE_IP is not an address/);
      // The cause names the value and what it must be.
      expect(() => venueMapping()).toThrow(/not an address/);
      expect(() => venueMapping()).toThrow(/IPv4 or IPv6/);
    });
  });
});

test.describe('the SAFE reader turns that cause into a value', () => {
  const withEnv = (env, fn) => {
    const saved = {};
    for (const [k, v] of Object.entries(env)) {
      saved[k] = process.env[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    try {
      return fn();
    } finally {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  };

  test('a bad address is a REASON, not a throw', () => {
    // The readers that must not die use this one: the DNS preload runs
    // inside every process of a run — the pre-flight among them — and a
    // preload that died on the bad value would take the pre-flight down
    // with it, so the operator would read a stack trace instead of the
    // named cause.
    withEnv({ E2E_VENUE_IP: 'not an address', E2E_VENUE_HOST: 'venue.example' }, () => {
      const read = safeVenueMapping();
      expect(read.mapping).toBe(null);
      expect(read.error).toContain('E2E_VENUE_IP is not an address');
      // The reason is the CAUSE, not a stack trace.
      expect(read.error).not.toContain('at venueMapping');
    });
  });

  test('a good address is carried through, and no reason with it', () => {
    withEnv({ E2E_VENUE_IP: '10.42.0.189', E2E_VENUE_HOST: 'venue.example' }, () => {
      const read = safeVenueMapping();
      expect(read.mapping).toEqual({ host: 'venue.example', ip: '10.42.0.189' });
      expect(read.error).toBe(null);
    });
  });

  test('no mapping at all is not a reason', () => {
    withEnv({ E2E_VENUE_IP: undefined, E2E_VENUE_HOST: undefined }, () => {
      const read = safeVenueMapping();
      expect(read.mapping).toBe(null);
      expect(read.error).toBe(null);
    });
  });
});
