// The admin surfaces' i18n contract — the same bar as
// okf-surface-i18n-contract.test.js, held by the same mechanism (shared:
// helpers/i18nKeys.js): every catalogue key referenced through a LITERAL
// translate()/$t() call in the admin dashboard and its file dialog MUST
// exist in the shipped en catalogue. Before this test existed, a key renamed
// in the component but not in the 14 locale files rendered the English
// fallback in every locale with the whole suite green (review round, P1 —
// the first run of this suite exposed 22 such keys and this wave catalogued
// them). localeConsistency keeps the other 13 locales key-identical to en,
// so owning en owns all.
//
// The extraction is prefix-free on purpose: these surfaces may reference
// admin.*, details.*, common.* and okf.* alike — the whole-surface contract
// is the point. Keys that arrive in a variable (the hierarchy title/message
// ternaries) are invisible to a literal scan by construction;
// localeConsistency's DYNAMIC_COMPILED_KEYS list carries those.

const path = require('path');

const { deepGet, filesUnder, extractLiteralKeys } = require('./helpers/i18nKeys');

const SRC = path.join(__dirname, '..', '..');
const en = require('../i18n/locales/en.js').default;

const SURFACES = ['src/components/AdminDashboard.vue', 'src/components/FileDetailsDialog.vue'];

const files = filesUnder(SRC, SURFACES[0])
  .concat(filesUnder(SRC, SURFACES[1]))
  .filter((f, i, a) => a.indexOf(f) === i);

const literal = extractLiteralKeys(files, /(?:translate|\$t)\(\s*['"`]([A-Za-z][A-Za-z0-9_.]*)['"`]/, SRC);
const used = [...literal.keys()].sort();

describe('Admin surfaces i18n contract (dashboard + FileDetailsDialog)', () => {
  test('the extraction is not vacuous — both surfaces are scanned and reference the catalogue', () => {
    expect(files).toHaveLength(2);
    // PINNED EXACT, not a floor: okf-laberrors-contract.test.js replaced its
    // >=N floor with a pinned count after its documented failure (#84209 —
    // "the old >=20 floor still passed when the set dropped 21→20"). A key
    // dropped from a surface must be a conscious bump of this number, not a
    // silently shrinking guard.
    expect(used.length).toBe(284);
  });

  test.each(used)('%s exists in the shipped en catalogue as a non-empty string', (key) => {
    const v = deepGet(en, key);
    if (typeof v !== 'string' || v.length === 0) {
      throw new Error(`"${key}" (referenced at ${literal.get(key)}) is not a non-empty catalogue string`);
    }
  });
});
