// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Single source of truth for OKF slug/identity derivation (issue #1190).
// Each consumer's exact grammar is preserved through the options — no stored
// identity changes in the unification.

const { slugify, nameFromSource } = require('../services/slug');

describe('slugify — OKF slug SSOT', () => {
  test('default grammar: lowercase, runs of non-alphanumerics become one dash, trimmed', () => {
    expect(slugify('Service Directory')).toBe('service-directory');
    expect(slugify('  A  --  B  ')).toBe('a-b');
    expect(slugify('a--b')).toBe('a-b');
  });

  test('empty and non-string input return the empty string', () => {
    expect(slugify('')).toBe('');
    expect(slugify(null)).toBe('');
    expect(slugify(undefined)).toBe('');
  });

  test('no fold by default: diacritics become dashes, non-Latin input returns empty', () => {
    expect(slugify('Café Québec')).toBe('caf-qu-bec');
    expect(slugify('日本語')).toBe('');
  });

  test('fold: NFKD + combining-mark strip ASCII-folds diacritics (ingest grammar)', () => {
    expect(slugify('Café Québec', { fold: true })).toBe('cafe-quebec');
    expect(slugify('Übung Jesús', { fold: true })).toBe('ubung-jesus');
  });

  test('cap truncates after trimming (tableConcepts 60 / slugFor 80 / repo name 200)', () => {
    expect(slugify('x'.repeat(300), { cap: 60 })).toHaveLength(60);
    expect(slugify('abcdefgh', { cap: 3 })).toBe('abc');
  });
});

describe('nameFromSource — repo name from raw filename/URL', () => {
  test('strips scheme + www from URLs', () => {
    expect(nameFromSource('https://www.example.com/Foo', 'fb')).toBe('example-com-foo');
    expect(nameFromSource('http://example.com', 'fb')).toBe('example-com');
  });

  test('strips a document extension from filenames', () => {
    expect(nameFromSource('Kenya Health Crawl.md', 'fb')).toBe('kenya-health-crawl');
    expect(nameFromSource('report.HTML', 'fb')).toBe('report');
  });

  test('caps at 200 chars and falls back when nothing survives', () => {
    expect(nameFromSource('y'.repeat(400), 'fb')).toHaveLength(200);
    expect(nameFromSource('', 'fb')).toBe('fb');
    expect(nameFromSource('日本語.md', 'fb')).toBe('fb');
  });
});
