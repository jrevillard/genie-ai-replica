// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const { execFileSync } = require('child_process');

/**
 * Unit spec for the venue address.
 *
 * ONE spelling of the venue: the specs and the run script read the same
 * published address, so a trailing slash cannot make one of them look at
 * a different venue than the other — the bug that made the run's
 * credential auto-read miss the shared stack's secret.
 *
 * The contract under test is the PUBLIC one — the address the module
 * publishes — and it is exercised where the address is actually read: in
 * a CHILD PROCESS, with its own environment. The module reads the
 * environment ONCE, at load, so a case that wants another address needs
 * another process; and the venue-origin gate (tests/config-validator)
 * requires that the edge be read from the environment in ONE place — the
 * defining module — so this spec does not read it either.
 */
/**
 * The address the module publishes for a given environment.
 *
 * The child runs in the module's own directory, so the specifier it uses
 * is a LITERAL one — the repo forbids a require with a computed
 * specifier (the config-validator gate says so), and this file is one of
 * the specs that gate reads.
 */
function addressIn(configured) {
  const env = { ...process.env };
  if (configured === undefined) delete env.BASE_URL;
  else env.BASE_URL = configured;
  const script = "console.log(require('./base-url.js').BASE_URL)";
  return execFileSync(process.execPath, ['-e', script], {
    cwd: __dirname,
    env,
    encoding: 'utf8'
  }).trim();
}

/**
 * The module's load failure for a configured address, or null when the
 * module loads.
 *
 * The module refuses a non-origin address at load (#1805 — the why
 * lives in the refusal message and the module header); the case runs
 * the same way the address is read — in a child process, whose stderr
 * carries the named cause. The refusal tests assert a fragment of THAT
 * cause, so a module that fails to load at all cannot pass for a
 * named refusal.
 */
function addressErrorIn(configured) {
  try {
    addressIn(configured);
  } catch (e) {
    return e.stderr ? e.stderr.toString() : e.message;
  }
  return null;
}

test.describe('the venue address has one spelling', () => {
  test('the trailing slashes are stripped', () => {
    expect(addressIn('https://x:4443')).toBe('https://x:4443');
    expect(addressIn('https://x:4443/')).toBe('https://x:4443');
    expect(addressIn('https://x:4443//')).toBe('https://x:4443');
  });

  test('no configured address means a URL of its own', () => {
    // The default is the module's own (the Compose edge): the run script
    // sets its own default before the module reads it. The case pins the
    // PROPERTY — an address without a trailing slash — and not the
    // literal: a literal for the Compose edge would be a hardcoded local
    // origin in this file, which is what the venue-origin gate forbids.
    const address = addressIn(undefined);
    expect(address.startsWith('https://')).toBe(true);
    expect(address.endsWith('/')).toBe(false);
  });

  test('the published value is the CANONICAL origin', () => {
    // WHATWG-tolerated spellings must not publish a second name for the
    // same venue: the module returns the parsed origin, not the raw
    // string — one host casing, one slash count.
    expect(addressIn('https://EXAMPLE.com:4443//')).toBe('https://example.com:4443');
    expect(addressIn('https://example.com/')).toBe('https://example.com');
  });
});

test.describe('the venue address must be an http(s) origin with a host', () => {
  const REFUSAL = 'http(s) origin with a host';

  test('a scheme-less address is refused, naming the value', () => {
    // `localhost:3000` parses with protocol `localhost:` and an EMPTY
    // host — the case the refusal exists for.
    const error = addressErrorIn('localhost:3000');
    expect(error).not.toBe(null);
    expect(error).toContain('localhost:3000');
    expect(error).toContain(REFUSAL);
  });

  test('an unparseable address is refused', () => {
    expect(addressErrorIn('not a venue address')).toContain(REFUSAL);
  });

  test('a non-http scheme is refused', () => {
    expect(addressErrorIn('ftp://example.com')).toContain(REFUSAL);
  });

  test('a plain host name is refused', () => {
    // No scheme at all: `new URL` throws.
    expect(addressErrorIn('example.com')).toContain(REFUSAL);
  });

  test('a path, a query, a hash and credentials are refused', () => {
    // BASE_URL is the venue ORIGIN — the interpolation base every
    // `${BASE_URL}/...` is built on; the refusal message owns the why.
    expect(addressErrorIn('https://example.com:4443/k8s-path/')).toContain(REFUSAL);
    expect(addressErrorIn('https://example.com:4443?x=1')).toContain(REFUSAL);
    expect(addressErrorIn('https://example.com:4443#fragment')).toContain(REFUSAL);
    expect(addressErrorIn('https://user@example.com:4443/')).toContain(REFUSAL);
  });

  test('an http origin still passes', () => {
    expect(addressIn('http://example.com:8080/')).toBe('http://example.com:8080');
  });
});
