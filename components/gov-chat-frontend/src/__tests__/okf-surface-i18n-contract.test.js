const { flattenKeys, deepGet } = require('./helpers/i18nKeys');
// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// The OKF surfaces' i18n contract (round 28, David's "100% i18n" bar): every
// okf.* catalogue key referenced through translate()/$t() in the Models tab,
// the OKF Studio and the Testing Lab MUST exist in the shipped en catalogue.
// Before this test, 32 keys were referenced but never catalogued — their
// English fallbacks rendered in every locale with the whole suite green.
//
// Literals ending in '.' or '_' are DYNAMIC PREFIXES (translate('okf.x.' +
// status)) — they are validated as prefixes, not as leaves. localeConsistency
// keeps the other 13 locales key-identical to en, so owning en owns all.

const fs = require('fs');
const path = require('path');

// __dirname is src/__tests__ — surfaces are stated from the component root.
const SRC = path.join(__dirname, '..', '..');
const en = require('../i18n/locales/en.js').default;

const SURFACES = [
  'src/components/okf/editor/ModelConfigPanel.vue',
  'src/components/okf/StudioDashboard.vue',
  'src/components/okf/StudioTab.vue',
  'src/components/okf/StudioWizard.vue',
  'src/components/okf/Narrative.vue',
  'src/components/okf/FrontmatterPanel.vue',
  'src/components/okf/LabelEditor.vue',
  'src/components/okf/RetrievalCard.vue',
  'src/components/okf/piiReview.js',
  'src/components/okf/editor/',
  'src/components/okf/steps/',
  'src/components/okf/wizard/'
];

function filesUnder(p, acc = []) {
  const full = path.join(SRC, p);
  if (!fs.existsSync(full)) return acc;
  if (fs.statSync(full).isFile()) {
    acc.push(full);
    return acc;
  }
  for (const e of fs.readdirSync(full, { withFileTypes: true })) {
    const f = path.join(full, e.name);
    if (e.isDirectory()) filesUnder(path.relative(SRC, f), acc);
    else if (/\.(vue|js)$/.test(e.name)) acc.push(f);
  }
  return acc;
}

const files = [...new Set(SURFACES.flatMap((s) => filesUnder(s)))];
const literal = new Map();
for (const f of files) {
  const t = fs.readFileSync(f, 'utf8');
  t.split(/\r?\n/).forEach((line, i) => {
    for (const m of line.matchAll(/(?:translate|\$t)\(\s*['"`](okf[A-Za-z0-9_.]*)['"`]/g)) {
      if (!literal.has(m[1])) literal.set(m[1], `${path.relative(SRC, f)}:${i + 1}`);
    }
  });
}
const used = [...literal.keys()].sort();
const leaves = used.filter((k) => !/[._]$/.test(k));
const prefixes = used.filter((k) => /[._]$/.test(k));

// Every leaf path in the shipped en catalogue (for prefix resolution).
const allLeaves = flattenKeys(en, '');

describe('OKF surfaces i18n contract (Models tab, Studio, Testing Lab)', () => {
  test('the extraction is not vacuous — the surfaces reference the catalogue', () => {
    expect(files.length).toBeGreaterThanOrEqual(30);
    expect(used.length).toBeGreaterThanOrEqual(800);
  });

  test.each(leaves)('%s exists in the shipped en catalogue as a non-empty string', (key) => {
    const v = deepGet(en, key);
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
  });

  test.each(prefixes)('%s is a dynamic prefix — at least one catalogue leaf lives under it', (key) => {
    // The prefix itself is never looked up; children are. Works for both
    // suffix forms: 'okf.x.' (dot-prefixed children) and 'okf.x.done_'
    // ('done_<action>' children beside siblings under the same parent).
    expect(allLeaves.some((l) => l.startsWith(key))).toBe(true);
  });
});
