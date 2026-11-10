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
    expect(slugify({})).toBe(''); // junk types never become identities
    expect(slugify('abc', null)).toBe('abc'); // null options tolerated
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
    expect(nameFromSource({}, 'fb')).toBe('fb'); // never String() coercion
  });
});

describe('consumer bindings — the per-consumer profiles are pinned (#1190)', () => {
  const { slugFor } = require('../services/slug');
  const tableConcepts = require('../services/converters/tableConcepts');

  test('tableConcepts binds the tabular grammar to cap 60', () => {
    expect(tableConcepts.slugify('x'.repeat(100))).toHaveLength(60);
  });

  test('slugFor binds the repo profile to cap 80 with the repo fallback', () => {
    expect(slugFor('y'.repeat(100))).toHaveLength(80);
    expect(slugFor('')).toBe('repo');
  });
});

describe('sameSlug — degenerate equality owned once (#1190)', () => {
  const { sameSlug } = require('../services/slug');

  test("'' never equals '' — a degenerate input matches nothing", () => {
    expect(sameSlug('', '')).toBe(false);
    expect(sameSlug('日本語', '汉字')).toBe(false);
  });

  test('real equal slugs match, case-insensitively; real-vs-degenerate never', () => {
    expect(sameSlug('Kenya Health', 'kenya-health')).toBe(true);
    expect(sameSlug('Kenya Health', '')).toBe(false);
    expect(sameSlug('', 'kenya-health')).toBe(false);
  });
});
