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

/**
 * Run a script in a child process that loads the preload the way the run
 * does — through NODE_OPTIONS --require.
 *
 * The child is waited on, never timed: execFileSync returns when the
 * child exits, and THROWS when it does not exit 0. So "the process
 * survived the preload" is exactly "this call did not throw".
 */
function inChild(script, env = {}) {
  const childEnv = { ...process.env, NODE_OPTIONS: `--require ${PRELOAD}` };
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete childEnv[k];
    else childEnv[k] = v;
  }
  return execFileSync(process.execPath, ['-e', script], { env: childEnv, encoding: 'utf8' }).trim();
}

/**
 * The child's script: it prints when EVERY entry point has settled, and
 * not a moment before.
 *
 * A fixed timer here would be a race against the host's resolver — the
 * timer can win while the answer is still on its way, and a case that
 * goes red on the resolver's mood is a flake, not a gate (the suite's
 * rule: wait for conditions, not durations).
 */
const FOUR_ENTRIES = `
const dns = require('dns');
const out = {};
let pending = 4;
const settle = () => { if (--pending === 0) console.log(JSON.stringify(out)); };
dns.lookup(process.env.PROBE_HOST, (e, a) => { out.lookup = e ? 'ERR:' + e.code : a; settle(); });
dns.promises.lookup(process.env.PROBE_HOST).then(
  (r) => { out.promise = r.address; settle(); },
  (e) => { out.promise = 'ERR:' + e.code; settle(); }
);
dns.resolve4(process.env.PROBE_HOST, (e, a) => { out.resolve4 = e ? 'ERR:' + e.code : a; settle(); });
dns.resolve6(process.env.PROBE_HOST, (e, a) => { out.resolve6 = e ? 'ERR:' + e.code : a; settle(); });
`;

/**
 * The same, for the two entry points that a NON-venue name must reach.
 *
 * `resolve4`/`resolve6` are NOT used here: they query the domain server
 * directly and never read the hosts file, so a name like 'localhost'
 * would make them wait on the resolver's timeout — the very race this
 * spec must not have. The two that answer from the hosts file are the
 * two the preload patches first, and the two the API helpers use.
 */
const TWO_ENTRIES = `
const dns = require('dns');
const out = {};
let pending = 2;
const settle = () => { if (--pending === 0) console.log(JSON.stringify(out)); };
dns.lookup(process.env.PROBE_HOST, (e, a) => { out.lookup = e ? 'ERR:' + e.code : a; settle(); });
dns.promises.lookup(process.env.PROBE_HOST).then(
  (r) => { out.promise = r.address; settle(); },
  (e) => { out.promise = 'ERR:' + e.code; settle(); }
);
`;

test.describe("the preload maps the venue name in Node's resolver", () => {
  test('all four entry points answer the mapped address', () => {
    const out = JSON.parse(
      inChild(FOUR_ENTRIES, { E2E_VENUE_IP: VENUE_IP, E2E_VENUE_HOST: VENUE_HOST, PROBE_HOST: VENUE_HOST })
    );
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
    const out = JSON.parse(
      inChild(TWO_ENTRIES, { E2E_VENUE_IP: VENUE_IP, E2E_VENUE_HOST: VENUE_HOST, PROBE_HOST: 'localhost' })
    );
    expect(out.lookup).not.toBe(VENUE_IP);
    expect(out.promise).not.toBe(VENUE_IP);
  });

  test('an unusable mapping does not kill the process that loads the preload', () => {
    // The preload runs inside EVERY process of a run, the pre-flight
    // among them: a preload that died on a bad value would take the
    // pre-flight down with it, and the operator would read a stack trace
    // instead of the named cause. A value that is not an address means
    // the preload simply does not map.
    //
    // The claim is about the PROCESS, so it is measured on the process:
    // the child prints its marker and exits 0 — and execFileSync throws
    // when the child dies at load. No DNS is involved, so the case has
    // no timing to lose.
    const out = inChild("console.log('alive')", {
      E2E_VENUE_IP: 'not an address',
      E2E_VENUE_HOST: VENUE_HOST
    });
    expect(out).toBe('alive');
  });
});
