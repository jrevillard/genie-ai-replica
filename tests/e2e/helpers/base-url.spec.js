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
    encoding: 'utf8',
  }).trim();
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
