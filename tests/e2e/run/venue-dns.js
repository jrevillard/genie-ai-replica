// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * Preload: map the venue name to its address in Node's resolver.
 *
 * The shared k8s stack's edge is advertised as `genieai-forge.local`, a name
 * the cluster DNS does not serve; a runner outside the operator's network
 * cannot resolve it, and neither can Node. Loaded with `node --require`,
 * this maps that ONE name and leaves every other lookup to the resolver.
 *
 * FOUR entry points are patched, because the callers do not all use the
 * same one: `dns.lookup` (the callback form), `dns.promises.lookup` (what
 * Playwright's APIRequestContext uses — it resolves with `all: true`, which
 * the callback form's patch would miss), and `dns.resolve4`/`resolve6` (the
 * direct record queries). A patch that covers only the first leaves the
 * suite half-reachable: the API helpers answer while the browser cannot
 * open the app.
 *
 * The Chromium half of the same mapping lives in
 * tests/e2e/helpers/venue-launch-args.js — a browser has its own resolver.
 *
 * Inert unless E2E_VENUE_IP is set.
 */
const dns = require('dns');
const net = require('net');
const { venueMapping } = require('../helpers/venue-launch-args');

const mapping = venueMapping();

/** The address family the mapped address actually belongs to. */
function familyOf(address) {
  return net.isIP(address) === 6 ? 6 : 4;
}

if (mapping) {
  const { host, ip } = mapping;
  const originalLookup = dns.lookup;
  const originalPromiseLookup = dns.promises.lookup;
  const originalResolve4 = dns.resolve4;
  const originalResolve6 = dns.resolve6;

  dns.lookup = function lookupWithVenueMapping(hostname, options, callback) {
    if (hostname !== host) return originalLookup.apply(this, arguments);
    let opts = options;
    let done = callback;
    if (typeof opts === 'function') {
      done = opts;
      opts = {};
    } else if (typeof opts === 'number') {
      opts = { family: opts };
    } else {
      opts = opts || {};
    }
    const family = familyOf(ip);
    if (opts.all) return done(null, [{ address: ip, family }]);
    return done(null, ip, family);
  };

  dns.promises.lookup = async function promiseLookupWithVenueMapping(hostname, options) {
    if (hostname !== host) return originalPromiseLookup.call(dns.promises, hostname, options);
    const opts = options || {};
    const family = familyOf(ip);
    if (opts.all) return [{ address: ip, family }];
    return { address: ip, family };
  };

  dns.resolve4 = function resolve4WithVenueMapping(hostname, options, callback) {
    if (hostname !== host) return originalResolve4.apply(this, arguments);
    const opts = typeof options === 'function' ? {} : options || {};
    const done = typeof options === 'function' ? options : callback;
    // `resolve4(name, {ttl: true})` answers with [{address, ttl}] — a bare
    // string is the wrong shape for that caller.
    const answer = opts.ttl ? [{ address: ip, ttl: 0 }] : [ip];
    process.nextTick(done, null, answer);
  };

  dns.resolve6 = function resolve6WithVenueMapping(hostname, options, callback) {
    if (hostname !== host) return originalResolve6.apply(this, arguments);
    const done = typeof options === 'function' ? options : callback;
    // No AAAA for the venue: an empty answer keeps the caller on the IPv4
    // path instead of waiting for a resolution that cannot succeed.
    process.nextTick(done, null, []);
  };
}
