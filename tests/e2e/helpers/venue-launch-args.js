// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * Where the venue edge is, for a runner that cannot resolve its name.
 *
 * The shared k8s stack advertises its edge under a name the cluster DNS does
 * not serve (`genieai-forge.local`). A runner without that name in its
 * resolver needs it mapped to an address, and the mapping has to reach BOTH
 * resolvers: Node (`dns.lookup`) for the API helpers, and Chromium
 * (`--host-resolver-rules`) for the browser. With only the Node half, the
 * API helpers answer and the browser cannot open the app — the suite then
 * fails on the login redirect instead of on the thing it tests.
 *
 * The mapping is opt-in: `E2E_VENUE_IP` turns it on, and `E2E_VENUE_HOST`
 * names the host to map (it defaults to the `BASE_URL` host). Unset, this
 * module is inert and the suite behaves exactly as before.
 */
const net = require('net');

const VENUE_IP_ENV = 'E2E_VENUE_IP';
const VENUE_HOST_ENV = 'E2E_VENUE_HOST';

// The venue's edge, from the ONE definition (helpers/base-url.js): a
// second copy of the default here could drift from it, and a drifted
// host would map the browser to a different venue than the API half of
// the mapping resolves.
const { BASE_URL } = require('./base-url');

/**
 * The venue mapping in force, or null when the runner resolves the venue
 * name itself.
 *
 * The ADDRESS is validated here, and the venue's URL is read here too —
 * so a bad value in either is named AT THE POINT IT IS READ. A value
 * that is not an address would otherwise reach Chromium as
 * `--host-resolver-rules=MAP <host> <not an address>` and be rejected
 * there, with the cause buried in the browser's own error: the runner
 * would read a browser failure for what is a configuration mistake.
 *
 * @returns {{host: string, ip: string}|null} the mapping
 * @throws {Error} when the configured address or venue is not usable
 */
function venueMapping() {
  const ip = process.env[VENUE_IP_ENV];
  if (!ip) return null;
  if (!net.isIP(ip)) {
    throw new Error(
      `${VENUE_IP_ENV} is not an address: ${JSON.stringify(ip)} — it must be an IPv4 or IPv6 address.`
    );
  }
  const host =
    process.env[VENUE_HOST_ENV] ||
    new URL(BASE_URL).hostname;
  return { host, ip };
}

/**
 * The venue mapping in force, or the reason it cannot be read — WITHOUT
 * throwing.
 *
 * `venueMapping` throws when the configured value is not an address: the
 * bad value is named where it is read. The readers that must NOT die use
 * this one instead — the DNS preload, which runs inside EVERY process of
 * a run (the pre-flight among them: a preload that died would take the
 * pre-flight down with it, and the operator would read a stack trace
 * instead of the named cause), and the run script's own shell line.
 *
 * @returns {{mapping: {host: string, ip: string}|null, error: string|null}}
 */
function safeVenueMapping() {
  try {
    return { mapping: venueMapping(), error: null };
  } catch (e) {
    return { mapping: null, error: e.message.split('\n')[0] };
  }
}

/**
 * The Chromium arguments that carry the venue mapping into the browser.
 * @returns {string[]} the arguments (empty when no mapping is in force)
 */
function venueLaunchArgs() {
  const mapping = venueMapping();
  return mapping ? [`--host-resolver-rules=MAP ${mapping.host} ${mapping.ip}`] : [];
}

module.exports = { venueMapping, safeVenueMapping, venueLaunchArgs, VENUE_IP_ENV, VENUE_HOST_ENV };
