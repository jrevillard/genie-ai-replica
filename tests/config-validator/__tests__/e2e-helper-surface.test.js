const path = require('path');
const fs = require('fs');

const { jsFiles, stripJsComments } = require('../validators/js-files');

const ROOT = path.resolve(__dirname, '../../..');
const E2E_ROOT = path.join(ROOT, 'tests/e2e');
const HELPER = path.join(ROOT, 'tests/e2e/helpers/welcome.js');

// The welcome helper's surface, checked against its CALLERS.
//
// The e2e suite has no CI door (operator decision 2026-11-10): a spec
// that destructures a name this helper no longer exports dies with a
// TypeError at RUN time, on the venue, and nothing else notices. The
// Playwright unit spec cannot carry this gate — it runs on the local
// run, and the risk it guards is the one the local run cannot see. So
// the gate lives HERE, where `config:validate` runs it on every MR.
//
// The names are DERIVED from the callers, not copied: the tree is
// walked, every file that takes a name from this helper is found, and
// the two sets must be equal. A helper export nobody takes is as much
// a defect as a name a caller takes and the helper does not have — the
// first is a surface nothing pins, the second is the TypeError.
const namesTakenFromHelper = (source) => {
  const names = new Set();

  // const { a, b: c } = require('../helpers/welcome');
  const destructured = /const\s*\{([^}]*)\}\s*=\s*require\(\s*(['"])[^'"]*helpers\/welcome\2\s*\)/g;
  for (const match of source.matchAll(destructured)) {
    for (const entry of match[1].split(',')) {
      // An alias reads `exported: local` — the EXPORTED name is what
      // the helper owes, so the left side is the one that counts.
      const name = entry.split(':')[0].trim();
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) names.add(name);
    }
  }

  // const welcome = require('../helpers/welcome'); welcome.NAME
  const bound = /const\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*require\(\s*(['"])[^'"]*helpers\/welcome\2\s*\)/g;
  for (const match of source.matchAll(bound)) {
    const member = new RegExp(`\\b${match[1]}\\.([A-Za-z_$][A-Za-z0-9_$]*)`, 'g');
    for (const hit of source.matchAll(member)) names.add(hit[1]);
  }

  return names;
};

// The helper's exported names, read from its own export block. The
// block is read as TEXT: the helper is a Playwright module, and the
// validator has no business loading it.
const namesExportedBy = (source) => {
  const block = source.match(/module\.exports\s*=\s*\{([\s\S]*?)\n\};/);
  if (!block) {
    // Loud, never empty: a helper that stopped using this shape must
    // fail this gate, not pass it by exporting nothing.
    throw new Error('the welcome helper has no readable `module.exports = { ... }` block');
  }
  const names = new Set();
  for (const entry of block[1].split(',')) {
    const name = entry.split(':')[0].trim();
    if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) names.add(name);
  }
  return names;
};

describe('the e2e helper surface', () => {
  test('the welcome helper exports exactly the names its callers take', () => {
    const exported = namesExportedBy(stripJsComments(fs.readFileSync(HELPER, 'utf8')));

    const taken = new Set();
    const callers = [];
    for (const file of jsFiles(E2E_ROOT)) {
      const source = stripJsComments(fs.readFileSync(file, 'utf8'));
      const names = namesTakenFromHelper(source);
      if (names.size === 0) continue;
      callers.push(path.relative(ROOT, file));
      for (const name of names) taken.add(name);
    }

    // Jest's expect takes no message argument — the failure names the
    // sets by their own contents.
    expect(callers.length).toBeGreaterThan(0);
    expect([...taken].sort()).toEqual([...exported].sort());
  });

  test('the caller-side extractor reads a destructuring', () => {
    const source = "const { withWelcomeSession, DEFAULT_SESSION } = require('../helpers/welcome');";
    expect([...namesTakenFromHelper(source)].sort()).toEqual(['DEFAULT_SESSION', 'withWelcomeSession']);
  });

  test('the caller-side extractor reads an alias by its EXPORTED name', () => {
    const source = "const { withWelcomeSession: welcome } = require('../helpers/welcome');";
    expect([...namesTakenFromHelper(source)]).toEqual(['withWelcomeSession']);
  });

  test('the caller-side extractor reads a name reached through the module object', () => {
    const source = "const welcome = require('../helpers/welcome');\nconst state = welcome.readVisualLayerState(page);";
    expect([...namesTakenFromHelper(source)]).toEqual(['readVisualLayerState']);
  });

  test('the caller-side extractor ignores a file that takes nothing from this helper', () => {
    const source =
      "const { expect } = require('@playwright/test');\nconst { withWelcomeSession } = require('./other');";
    expect([...namesTakenFromHelper(source)]).toEqual([]);
  });

  test('the export-side reader fails loud when the export block is gone', () => {
    expect(() => namesExportedBy('module.exports = 1;')).toThrow(/no readable/);
  });

  test("the export-side reader reads the helper's own exports", () => {
    const source = stripJsComments(fs.readFileSync(HELPER, 'utf8'));
    expect(namesExportedBy(source).size).toBeGreaterThan(0);
  });
});
