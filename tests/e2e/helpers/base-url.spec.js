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
 * The module refuses an address that is not an http(s) URL with a host
 * (#1805) — a scheme-less value like `localhost:3000` parses with an
 * EMPTY host, the venue mapping would map an empty host, and the browser
 * would navigate to an address that means nothing. The refusal happens
 * where the address is READ, so the case is exercised the same way the
 * address is: in a child process, whose stderr carries the named cause.
 */
function addressErrorIn(configured) {
  const env = { ...process.env, BASE_URL: configured };
  const script = "console.log(require('./base-url.js').BASE_URL)";
  try {
    execFileSync(process.execPath, ['-e', script], { cwd: __dirname, env, encoding: 'utf8' });
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
});

test.describe('the venue address must be an http(s) URL with a host', () => {
  test('a scheme-less address is refused, naming the value', () => {
    // `localhost:3000` parses with protocol `localhost:` and an EMPTY
    // host — exactly the value the venue mapping would map into nothing.
    const error = addressErrorIn('localhost:3000');
    expect(error).not.toBe(null);
    expect(error).toContain('localhost:3000');
    expect(error).toContain('http(s) URL with a host');
  });

  test('an unparseable address is refused', () => {
    expect(addressErrorIn('not a venue address')).not.toBe(null);
  });

  test('a non-http scheme is refused', () => {
    // A host with the wrong scheme is not a venue edge either.
    expect(addressErrorIn('ftp://example.com')).not.toBe(null);
  });

  test('a plain host name is refused', () => {
    // No scheme at all: `new URL` throws.
    expect(addressErrorIn('example.com')).not.toBe(null);
  });

  test('an http URL with a host still passes', () => {
    expect(addressIn('http://example.com:8080/')).toBe('http://example.com:8080');
    expect(addressIn('https://example.com:4443//')).toBe('https://example.com:4443');
  });
});
