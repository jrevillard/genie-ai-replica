// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// G1 (round-28 review — the labErrors message contract has no mutation
// owner): the store authors poll-envelope `message` fields as
// okf.labErrors.* KEYS (the store has no translate context), and
// translateLabError resolves them by the `okf.labErrors.` PREFIX while
// passing server messages through verbatim. Renaming or typo-ing a key on
// EITHER side — the store's author, or the catalogue leaf — left the whole
// suite green: the user saw a raw `okf.labErrors.suiteGenFailed` string
// (or a fallback) with every test passing. This file owns the contract:
//
//   1. every okf.labErrors.* literal authored anywhere in src (the
//      extraction walks the tree, so a future key authored in a component
//      is owned too) must EXIST in the shipped en catalogue as a non-empty
//      string;
//   2. translateLabError must resolve each key to the CATALOGUE sentence
//      (a renamed prefix, or a lookup that falls back to the raw key, is
//      red);
//   3. non-labErrors messages (server reasons) pass through verbatim —
//      the resolver must never swallow actionable server detail.
//
// localeConsistency keeps the OTHER 13 locales key-identical to en, so
// owning en's side owns all locales.

const fs = require('node:fs');
const path = require('node:path');

const SRC_ROOT = path.join(__dirname, '..', '..', '..');
const en = require(SRC_ROOT + '/i18n/locales/en.js').default;
const { translateLabError } = require(SRC_ROOT + '/services/okfRepoOps');

/** Every okf.labErrors.* literal authored under src/, excluding the tests
 * and the catalogue itself. Recursive walk — the contract follows the keys
 * wherever a future producer authors them. */
function collectUsedLabErrorKeys(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'i18n') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectUsedLabErrorKeys(full, acc);
    } else if (/\.(js|vue)$/.test(entry.name)) {
      const src = fs.readFileSync(full, 'utf8');
      acc.push(...(src.match(/okf\.labErrors\.[A-Za-z0-9_]+/g) || []));
    }
  }
  return acc;
}

function deepGet(obj, dotted) {
  return dotted.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);
}

/** A REAL translate over the shipped catalogue — not a stub. A lookup that
 * misses returns the fallback (translateLabError passes the KEY as the
 * fallback), which the per-key assertions below reject. */
function enTranslate(key, fallback) {
  const v = deepGet(en, key);
  return v == null ? fallback : v;
}

const usedKeys = [...new Set(collectUsedLabErrorKeys(SRC_ROOT))].sort();

describe('okf.labErrors.* message contract (G1 — the store keys have a mutation owner)', () => {
  test('the extraction is not vacuous — the store really authors labErrors keys', () => {
    // The poll envelopes' abort/timeout/failed fallbacks are the known
    // producers; if this drops below the authored set, the extraction (or
    // the feature) is gone and this file must be revisited, not trusted.
    expect(usedKeys.length).toBeGreaterThanOrEqual(20);
  });

  test.each(usedKeys)('%s exists in the shipped en catalogue as a non-empty string', (key) => {
    const leaf = deepGet(en, key);
    expect(typeof leaf).toBe('string');
    expect(leaf.length).toBeGreaterThan(0);
  });

  test.each(usedKeys)('translateLabError resolves %s to the catalogue sentence, never the raw key', (key) => {
    const translated = translateLabError(key, enTranslate);
    expect(translated).toBe(deepGet(en, key));
    expect(translated).not.toContain('okf.labErrors.');
  });

  test('a non-labErrors message (server reason) passes through verbatim', () => {
    const serverReason = 'vLLM upstream overloaded (503)';
    expect(translateLabError(serverReason, () => 'TRANSLATOR MUST NOT BE CALLED')).toBe(serverReason);
  });
});
