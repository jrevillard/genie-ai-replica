// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
const { test, expect } = require('@playwright/test');
const { normalizeVenue } = require('./base-url');

/**
 * Unit spec for the venue address.
 *
 * ONE spelling of the venue: the specs and the run script normalize
 * through the same function, so a trailing slash cannot make one of them
 * look at a different venue than the other — the bug that made the run's
 * credential auto-read miss the shared stack's secret.
 */
test.describe('the venue address has one spelling', () => {
  test('the trailing slashes are stripped', () => {
    expect(normalizeVenue('https://x:4443')).toBe('https://x:4443');
    expect(normalizeVenue('https://x:4443/')).toBe('https://x:4443');
    expect(normalizeVenue('https://x:4443//')).toBe('https://x:4443');
  });

  test('an address without a scheme is left alone', () => {
    expect(normalizeVenue('x:4443')).toBe('x:4443');
  });

  test('an empty address stays empty — the caller owns the default', () => {
    expect(normalizeVenue('')).toBe('');
    expect(normalizeVenue(undefined)).toBe('');
  });
});
