// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
/**
 * The venue's edge — the origin every spec navigates to.
 *
 * ONE definition, so a venue is named once and every spec resolves it the
 * same way. The Compose stack serves the edge on localhost:443; a
 * Kubernetes venue serves it on its own host and port (`BASE_URL` names
 * it). A spec that hardcodes the origin states a fact about the Compose
 * venue alone: it cannot run anywhere else, and it fails with a
 * connection error before its first assertion — the failure mode #1737
 * was filed for.
 *
 * The trailing slashes are stripped here, once per process: `page.url()`
 * never produces a trailing double slash, so every `${BASE_URL}/...`
 * interpolation stays well-formed even when the environment configures
 * BASE_URL with a trailing '/'. The run script reads the address this
 * module exports, so there is one spelling of the venue IN THE JS TREE —
 * and one place that spells it. The run SCRIPT names its own default
 * venue (`DEFAULT_VENUE` in `run/run-local-e2e.sh`): it is the shell
 * that starts the run, so it must say which venue it starts against, and
 * that name is outside the JS tree the venue-origin gate reads.
 *
 * This module carries no credential — a spec that needs venue
 * credentials takes them from `helpers/e2e-fixtures.js` (or from the
 * same `helpers/chatbot.js` require as `loginViaUI`), and the two import
 * paths must never be mixed in one file (tests/e2e/CLAUDE.md § Fixtures).
 * That is why the edge lives in its own module: every spec may require it,
 * whichever credential path it takes.
 *
 * The address must be an http(s) ORIGIN — scheme, host and port, and
 * nothing else. A value that is not — a scheme-less address
 * (`localhost:3000`), or one carrying a path, query, hash or
 * credentials — is refused AT THE POINT IT IS READ, naming the value
 * and the rule; the refusal message carries the full why, so every
 * process that requires this module fails at load with the named
 * cause — the pre-flight included, and a direct `npx playwright test`
 * too, which never runs the pre-flight at all.
 *
 * What the module publishes is the PARSED origin — one canonical
 * spelling — so WHATWG-tolerated spellings (`https:host:4443` without
 * the slashes, an upper-cased host) cannot publish a second name for
 * the same venue. An IPv6 literal passes this module, but the
 * venue-origin gate does not watch that spelling yet (#1840).
 */
/**
 * The venue origin, canonical: a value that is not an http(s) origin
 * with a host is refused.
 *
 * @param {string} raw - the address as configured
 * @returns {string} the canonical origin (scheme, host, port)
 * @throws {Error} when the address is not an http(s) origin with a
 *   host — the message names the value and carries the rule
 */
function normalizeVenue(raw) {
  const value = String(raw || '').replace(/\/+$/, '');
  let parsed = null;
  try {
    parsed = new URL(value);
  } catch {
    // not a URL at all — the refusal below names the value
  }
  const isOrigin =
    parsed &&
    (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
    parsed.hostname &&
    (parsed.pathname === '' || parsed.pathname === '/') &&
    !parsed.search &&
    !parsed.hash &&
    !parsed.username &&
    !parsed.password;
  if (!isOrigin) {
    throw new Error(
      `the venue address is not an http(s) origin with a host: ${JSON.stringify(String(raw))} — ` +
        'a scheme-less value like "localhost:3000" parses with an EMPTY host, the venue mapping would ' +
        'map an empty host, and the browser would navigate to an address that means nothing (#1805). ' +
        'BASE_URL must be the venue ORIGIN — scheme, host and port only; no path, query, hash or ' +
        'credentials (e.g. "https://genieai-forge.local:4443").'
    );
  }
  return parsed.origin;
}

const BASE_URL = normalizeVenue(process.env.BASE_URL || 'https://localhost');

module.exports = { BASE_URL };
