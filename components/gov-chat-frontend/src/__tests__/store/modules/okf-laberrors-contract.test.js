const { deepGet } = require('../../helpers/i18nKeys');
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
//   4. the walk cannot be silently evaded (#1350 note 84209, round 29): a key moved
//      into a COMPUTED form (okf.labErrors.${code}) stops matching the
//      static extraction — any source authoring the template-literal form
//      fails the suite, pointing here; and the producer set is pinned to
//      its EXACT size (the old >=20 floor could not trip on one dropped
//      key).
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
 * wherever a future producer authors them. The walked accumulator also
 * records any source authoring the COMPUTED form (`okf.labErrors.${...}`):
 * the static regex below is blind to template literals, so one refactor
 * step could move a key out of this contract's sight entirely (#84209) —
 * the suite fails on such a file instead of passing blind. */
function collectUsedLabErrorKeys(dir, walked) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '__tests__' || entry.name === 'i18n') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectUsedLabErrorKeys(full, walked);
    } else if (/\.(js|vue)$/.test(entry.name)) {
      const src = fs.readFileSync(full, 'utf8');
      walked.keys.push(...(src.match(/okf\.labErrors\.[A-Za-z0-9_]+/g) || []));
      // Dynamic-form detector: template literals AND string concat both
      // produce computed keys the static regex cannot see (review 84587 —
      // `translate('okf.labErrors.' + code)` evaded the ${} detector).
      if (/okf\.labErrors\.\$\{/.test(src) || /okf\.labErrors\.[\s\S]{0,12}['"]\s*\+/.test(src)) {
        walked.dynamic.push(path.relative(SRC_ROOT, full));
      }
    }
  }
  return walked.keys;
}

/** A REAL translate over the shipped catalogue — not a stub. A lookup that
 * misses returns the fallback (translateLabError passes the KEY as the
 * fallback), which the per-key assertions below reject. */
function enTranslate(key, fallback) {
  const v = deepGet(en, key);
  return v == null ? fallback : v;
}

const walked = { keys: [], dynamic: [] };
collectUsedLabErrorKeys(SRC_ROOT, walked);
const usedKeys = [...new Set(walked.keys)].sort();

describe('okf.labErrors.* message contract (G1 — the store keys have a mutation owner)', () => {
  test('no producer authors a COMPUTED okf.labErrors key — the static walk cannot own a template literal (#84209)', () => {
    // A key moved into a computed form (`okf.labErrors.${code}`) evades the
    // extraction above entirely: it stops being a static literal, so the
    // catalogue assertions lose their input while the producer keeps
    // emitting — the exact false-green this file exists to prevent. When
    // this goes red, author the key STATICALLY (the LAB_ERROR_KEYS registry
    // in store/modules/okf.js is the one owner) or extend this contract —
    // never ship a dynamic key past it.
    expect(walked.dynamic).toEqual([]);
  });

  test('the extraction is not vacuous — the producer set is pinned to its EXACT size (#84209)', () => {
    // The old >=20 floor still passed when the set dropped 21→20 — one
    // deleted key short of a raw key on screen. EXACT count: bump this
    // number DELIBERATELY when a new labErrors key is authored (or delete
    // one here in the same change as its last emission site); the per-key
    // assertions below print the whole set when it drifts.
    expect(usedKeys.length).toBe(21);
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
