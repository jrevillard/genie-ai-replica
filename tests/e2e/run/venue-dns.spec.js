// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');
const path = require('path');

/**
 * Unit spec for the DNS half of the venue mapping.
 *
 * The mapping reaches TWO resolvers: Chromium (`--host-resolver-rules`,
 * pinned by helpers/venue-launch-args.spec.js) and Node's resolver (this
 * preload). The Chromium half is covered there; this is the other half —
 * and it is the half the API helpers go through.
 *
 * The preload patches FOUR entry points, because the callers do not all
 * use the same one: `dns.lookup` (the callback form),
 * `dns.promises.lookup` (what Playwright's APIRequestContext uses — it
 * resolves with `all: true`, which the callback form's patch would miss),
 * and the direct record queries `dns.resolve4`/`resolve6`.
 *
 * The preload is exercised in a CHILD PROCESS, with the preload loaded
 * through NODE_OPTIONS — the way the run script loads it. That is the
 * only honest way to test it: it patches the resolver of the process it
 * is loaded into.
 */
const PRELOAD = path.join(__dirname, 'venue-dns.js');
const VENUE_HOST = 'venue.example';
const VENUE_IP = '10.42.0.189';

/** What the child's resolver answers for the venue host and for another one. */
function answers(env = {}) {
  const script = `
const dns = require('dns');
const out = {};
const host = process.env.PROBE_HOST;
dns.lookup(host, (e, a) => { out.lookup = e ? 'ERR:' + e.code : a; });
dns.promises.lookup(host).then((r) => { out.promise = r.address; }).catch((e) => { out.promise = 'ERR:' + e.code; });
dns.resolve4(host, (e, a) => { out.resolve4 = e ? 'ERR:' + e.code : a; });
dns.resolve6(host, (e, a) => { out.resolve6 = e ? 'ERR:' + e.code : a; });
setTimeout(() => console.log(JSON.stringify(out)), 300);
`;
  const childEnv = { ...process.env, NODE_OPTIONS: `--require ${PRELOAD}` };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }
  childEnv.PROBE_HOST = env.PROBE_HOST || VENUE_HOST;
  const out = execFileSync(process.execPath, ['-e', script], { env: childEnv, encoding: 'utf8' });
  return JSON.parse(out.trim());
}

test.describe('the preload maps the venue name in Node\'s resolver', () => {
  test('all four entry points answer the mapped address', () => {
    const out = answers({ E2E_VENUE_IP: VENUE_IP, E2E_VENUE_HOST: VENUE_HOST });
    expect(out.lookup).toBe(VENUE_IP);
    // The promise form is what the API helpers use.
    expect(out.promise).toBe(VENUE_IP);
    // The direct record query.
    expect(out.resolve4).toEqual([VENUE_IP]);
    // The venue has no AAAA record: the IPv6 answer is empty, so the
    // caller stays on the IPv4 path instead of waiting for a resolution
    // that cannot succeed.
    expect(out.resolve6).toEqual([]);
  });

  test('a name that is not the venue is left to the resolver', () => {
    // The preload maps ONE name: every other lookup is the resolver's.
    const out = answers({ E2E_VENUE_IP: VENUE_IP, E2E_VENUE_HOST: VENUE_HOST, PROBE_HOST: 'localhost' });
    expect(out.lookup).not.toBe(VENUE_IP);
    expect(out.promise).not.toBe(VENUE_IP);
  });

  test('an unusable mapping does not kill the process that loads the preload', () => {
    // The preload runs inside EVERY process of a run, the pre-flight
    // among them: a preload that died on a bad value would take the
    // pre-flight down with it, and the operator would read a stack trace
    // instead of the named cause. A value that is not an address means
    // the preload simply does not map.
    const out = answers({ E2E_VENUE_IP: 'not an address', E2E_VENUE_HOST: VENUE_HOST });
    expect(out.lookup).not.toBe(VENUE_IP);
    // The process is alive and answered.
    expect(out.lookup).toBeDefined();
  });
});
