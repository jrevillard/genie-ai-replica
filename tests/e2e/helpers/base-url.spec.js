// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const path = require('path');

/**
 * Unit spec for the venue address.
 *
 * ONE spelling of the venue: the specs and the run script read the same
 * exported address, so a trailing slash cannot make one of them look at a
 * different venue than the other — the bug that made the run's credential
 * auto-read miss the shared stack's secret.
 *
 * The contract under test is the PUBLIC one — the address the module
 * exports — because that is what every consumer reads. The module is
 * loaded FRESH for each case: the address is read from the environment
 * once, at load, so a case that wants another address needs another load.
 */
const MODULE = path.join(__dirname, 'base-url.js');

/** The address the module exports for a given environment. */
function addressIn(env) {
  const saved = process.env.BASE_URL;
  if (env === undefined) delete process.env.BASE_URL;
  else process.env.BASE_URL = env;
  try {
    delete require.cache[require.resolve(MODULE)];
    return require(MODULE).BASE_URL;
  } finally {
    if (saved === undefined) delete process.env.BASE_URL;
    else process.env.BASE_URL = saved;
    delete require.cache[require.resolve(MODULE)];
  }
}

test.describe('the venue address has one spelling', () => {
  test('the trailing slashes are stripped', () => {
    expect(addressIn('https://x:4443')).toBe('https://x:4443');
    expect(addressIn('https://x:4443/')).toBe('https://x:4443');
    expect(addressIn('https://x:4443//')).toBe('https://x:4443');
  });

  test('no configured address means the Compose stack', () => {
    // The default is the module's own: the run script sets its own
    // default before loading it, and a spec that runs without the run
    // script gets the Compose edge.
    expect(addressIn(undefined)).toBe('https://localhost');
  });
});
