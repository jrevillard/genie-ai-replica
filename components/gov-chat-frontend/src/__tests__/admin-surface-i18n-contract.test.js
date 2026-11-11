// The admin surfaces' i18n contract — the same bar as
// okf-surface-i18n-contract.test.js, held by the same mechanism: every
// catalogue key referenced through a LITERAL translate()/$t() call in the
// admin dashboard and its file dialog MUST exist in the shipped en
// catalogue. Before this test, a key renamed in the component but not in
// the 14 locale files rendered the English fallback in every locale with
// the whole suite green (review round, P1). localeConsistency keeps the
// other 13 locales key-identical to en, so owning en owns all.
//
// Literals ending in '.' or '_' are DYNAMIC PREFIXES — validated as
// prefixes, not leaves. Keys that arrive in a variable (the hierarchy
// title/message ternaries) are invisible to this scan by construction;
// localeConsistency's DYNAMIC_COMPILED_KEYS list carries those.

const fs = require('fs');
const path = require('path');

const { flattenKeys, deepGet } = require('./helpers/i18nKeys');

const SRC = path.join(__dirname, '..', '..');
const en = require('../i18n/locales/en.js').default;

const SURFACES = ['src/components/AdminDashboard.vue', 'src/components/FileDetailsDialog.vue'];

const files = SURFACES.map((s) => path.join(SRC, s)).filter((f) => fs.existsSync(f));

const literal = new Map();
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  t.split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(/(?:translate|\$t)\(\s*['"`]([A-Za-z][A-Za-z0-9_.]*)['"`]/g)) {
      if (!literal.has(m[1])) literal.set(m[1], `${path.relative(SRC, f)}:${i + 1}`);
    }
  });
}
const used = [...literal.keys()].sort();
const leaves = used.filter((k) => !/[._]$/.test(k));
const prefixes = used.filter((k) => /[._]$/.test(k));

const allLeaves = flattenKeys(en, '');

describe('Admin surfaces i18n contract (dashboard + FileDetailsDialog)', () => {
  test('the extraction is not vacuous — both surfaces are scanned and reference the catalogue', () => {
    expect(files).toHaveLength(2);
    expect(used.length).toBeGreaterThanOrEqual(150);
  });

  test.each(leaves)('%s exists in the shipped en catalogue as a non-empty string', (key) => {
    const v = deepGet(en, key);
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
  });

  (prefixes.length ? test.each : test.skip.each)(prefixes)(
    '%s is a dynamic prefix — at least one catalogue leaf lives under it',
    (key) => {
      expect(allLeaves.some((l) => l.startsWith(key))).toBe(true);
    }
  );
});
