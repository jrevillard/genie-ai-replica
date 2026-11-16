const path = require('path');
const fs = require('fs');

const { stripJsComments } = require('../validators/js-files');

const ROOT = path.resolve(__dirname, '../../..');
const HELPER = path.join(ROOT, 'tests/e2e/helpers/welcome.js');

// The names the specs take from the welcome helper.
//
// The e2e suite has no CI door (operator decision 2026-11-10): a spec
// that destructures a name the helper no longer exports dies with a
// TypeError at RUN time, on the venue, and nothing offline notices.
// This pin is the CI-doored half of that risk — `config:validate` runs
// it on every MR.
//
// What it pins is the helper's EXPORTED SURFACE, and the list below
// is the union of the names the specs destructure (the three chatbot
// specs, the three theme specs, the dashboard capture script and the
// helper's own unit spec). It does NOT derive that union from the
// specs: reading a JavaScript import list as text means reading
// strings, template literals and computed specifiers as code, and a
// reader that guesses there invents names — a worse failure than the
// one this gate exists to catch. So the pin is a deliberate list: a
// change to the helper's surface fails here and forces the author to
// look at the specs that take from it.
const EXPORTED_NAMES = [
  'DEFAULT_SESSION',
  'DEFAULT_VIEWPORT',
  'LAYER_STATE_BIND',
  'WCAG_BIND',
  'capturePixels',
  'contrastRatio',
  'lum',
  'readVisualLayerState',
  'waitForBannerSettled',
  'waitForComposerReady',
  'withComposerSession',
  'withWelcomeSession'
];

// The helper's exported names, read from its own export block.
//
// The block is read as TEXT: the helper is a Playwright module, and
// the validator has no business loading it. The reader is STRICT —
// it reads the two forms the helper uses and refuses everything else,
// so a shape it cannot read fails loudly instead of yielding a
// phantom name.
const namesExportedBy = (source) => {
  const block = source.match(/module\.exports\s*=\s*\{([\s\S]*?)\n\};/);
  if (!block) {
    throw new Error('the welcome helper has no readable `module.exports = { ... }` block');
  }
  const names = new Set();
  for (const raw of block[1].split(',')) {
    const entry = raw.trim();
    if (entry === '') continue;
    const shorthand = entry.match(/^([A-Za-z_$][A-Za-z0-9_$]*)$/);
    const valued = entry.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*[A-Za-z_$][A-Za-z0-9_$]*$/);
    if (shorthand) {
      names.add(shorthand[1]);
    } else if (valued) {
      names.add(valued[1]);
    } else {
      throw new Error(`the welcome helper exports an entry this reader cannot read: "${entry}"`);
    }
  }
  return names;
};

describe('the e2e helper surface', () => {
  test('the welcome helper exports exactly the names the specs take from it', () => {
    // The helper's path is part of this pin's contract: a renamed
    // helper must fail here, by name, not by an opaque read error.
    expect(fs.existsSync(HELPER)).toBe(true);

    const exported = namesExportedBy(stripJsComments(fs.readFileSync(HELPER, 'utf8')));
    expect([...exported].sort()).toEqual([...EXPORTED_NAMES].sort());
  });

  test('the export-side reader fails loud when the export block is gone', () => {
    expect(() => namesExportedBy('module.exports = 1;')).toThrow(/no readable/);
  });

  test('the export-side reader fails loud on an entry it cannot read', () => {
    expect(() => namesExportedBy("module.exports = {\n  lum: 'a, b'\n};")).toThrow(/cannot read/);
  });

  test('the export-side reader reads a trailing comma as no entry', () => {
    const names = namesExportedBy('module.exports = {\n  plain,\n};');
    expect([...names]).toEqual(['plain']);
  });

  test('the export-side reader reads a name bound to an identifier', () => {
    const names = namesExportedBy('module.exports = {\n  plain: helper\n};');
    expect([...names]).toEqual(['plain']);
  });

  test("the export-side reader reads the helper's own exports", () => {
    const source = stripJsComments(fs.readFileSync(HELPER, 'utf8'));
    expect(namesExportedBy(source).size).toBeGreaterThan(0);
  });
});
