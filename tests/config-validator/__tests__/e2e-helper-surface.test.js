const path = require('path');
const fs = require('fs');

const { jsFiles, stripJsComments } = require('../validators/js-files');

const ROOT = path.resolve(__dirname, '../../..');
const E2E_ROOT = path.join(ROOT, 'tests/e2e');
const HELPER = path.join(ROOT, 'tests/e2e/helpers/welcome.js');

// A binding of the helper: `const { a, b } = require('...')` or
// `const welcome = require('...')`.
const BINDING = /\b(?:const|let|var)\s+(\{[^}]*\}|[A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*require\(\s*(['"])([^'"]+)\2\s*\)/g;

// Another binding of the same identifier in the same file.
const DECLARATION = /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=/g;

// The names a caller takes from the helper.
//
// The require is RESOLVED against the requiring file, so a caller that
// writes './welcome' (the unit spec, in the same directory) and one
// that writes '../helpers/welcome.js' are both found — a substring
// match on the path would miss the first and read the second.
//
// KNOWN LIMITS, stated rather than hidden: a caller that destructures
// through an ALIAS of the module object (`const w = require(...);
// const { a } = w`) is not seen, and a file that binds the helper
// under a name it also uses for something else cannot be read
// reliably — the second case throws instead of guessing.
const namesTakenIn = (file, source) => {
  const names = new Set();
  const dir = path.dirname(file);
  for (const match of source.matchAll(BINDING)) {
    const specifier = match[3];
    if (!specifier.startsWith('.')) continue;
    const resolved = path.resolve(dir, specifier);
    if (resolved !== HELPER && `${resolved}.js` !== HELPER) continue;

    const binding = match[1];
    if (binding.startsWith('{')) {
      for (const entry of binding.slice(1, -1).split(',')) {
        // An alias reads `exported: local` — the EXPORTED name is what
        // the helper owes, so the left side is the one that counts.
        const name = entry.split(':')[0].trim();
        if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) names.add(name);
      }
    } else {
      // The module object: every member read is a name taken. Two
      // bindings of one identifier make the scan unreadable, so the
      // gate refuses to guess.
      let bindings = 0;
      for (const declared of source.matchAll(DECLARATION)) {
        if (declared[1] === binding) bindings += 1;
      }
      if (bindings > 1) {
        throw new Error(
          `${path.relative(ROOT, file)} binds "${binding}" more than once — the member scan cannot tell which binding is the helper`
        );
      }
      const member = new RegExp(`\\b${binding}\\.([A-Za-z_$][A-Za-z0-9_$]*)`, 'g');
      for (const hit of source.matchAll(member)) names.add(hit[1]);
    }
  }
  return names;
};

// The helper's exported names, read from its own export block. The
// block is read as TEXT: the helper is a Playwright module, and the
// validator has no business loading it.
//
// Only the two shapes the helper uses are read — a shorthand name, or
// a name bound to a plain identifier. Anything else is refused
// loudly: a nested object value carries a comma, and a comma-split
// would turn its keys into phantom exports.
const namesExportedBy = (source) => {
  const block = source.match(/module\.exports\s*=\s*\{([\s\S]*?)\n\};/);
  if (!block) {
    // Loud, never empty: a helper that stopped using this shape must
    // fail this gate, not pass it by exporting nothing.
    throw new Error('the welcome helper has no readable `module.exports = { ... }` block');
  }
  const names = new Set();
  for (const entry of block[1].split(',')) {
    const trimmed = entry.trim();
    const shorthand = trimmed.match(/^([A-Za-z_$][A-Za-z0-9_$]*)$/);
    const valued = trimmed.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*[A-Za-z_$][A-Za-z0-9_$]*$/);
    if (shorthand) {
      names.add(shorthand[1]);
    } else if (valued) {
      names.add(valued[1]);
    } else {
      throw new Error(`the welcome helper exports an entry this reader cannot read: ${trimmed}`);
    }
  }
  return names;
};

describe('the e2e helper surface', () => {
  test('the welcome helper exports exactly the names its callers take', () => {
    // The helper's path is part of this gate's contract: a renamed
    // helper must fail here, by name, not by an opaque read error.
    expect(fs.existsSync(HELPER)).toBe(true);

    const exported = namesExportedBy(stripJsComments(fs.readFileSync(HELPER, 'utf8')));

    const taken = new Set();
    const callers = [];
    for (const file of jsFiles(E2E_ROOT)) {
      const source = stripJsComments(fs.readFileSync(file, 'utf8'));
      const names = namesTakenIn(file, source);
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
    const file = path.join(ROOT, 'tests/e2e/chatbot/chat-composer.spec.js');
    const source = "const { withWelcomeSession, DEFAULT_SESSION } = require('../helpers/welcome');";
    expect([...namesTakenIn(file, source)].sort()).toEqual(['DEFAULT_SESSION', 'withWelcomeSession']);
  });

  test('the caller-side extractor reads a `let` destructuring', () => {
    const file = path.join(ROOT, 'tests/e2e/chatbot/chat-composer.spec.js');
    const source = "let { withWelcomeSession } = require('../helpers/welcome');";
    expect([...namesTakenIn(file, source)]).toEqual(['withWelcomeSession']);
  });

  test('the caller-side extractor reads an alias by its EXPORTED name', () => {
    const file = path.join(ROOT, 'tests/e2e/chatbot/chat-composer.spec.js');
    const source = "const { withWelcomeSession: welcome } = require('../helpers/welcome');";
    expect([...namesTakenIn(file, source)]).toEqual(['withWelcomeSession']);
  });

  test('the caller-side extractor reads a name reached through the module object', () => {
    const file = path.join(ROOT, 'tests/e2e/chatbot/chat-composer.spec.js');
    const source = "const welcome = require('../helpers/welcome');\nconst state = welcome.readVisualLayerState(page);";
    expect([...namesTakenIn(file, source)]).toEqual(['readVisualLayerState']);
  });

  test('the caller-side extractor finds a caller that writes the helper by its own directory', () => {
    const file = path.join(ROOT, 'tests/e2e/helpers/welcome.spec.js');
    const source =
      "const welcome = require('./welcome');\nconst session = welcome.withWelcomeSession(browser, {}, body);";
    expect([...namesTakenIn(file, source)]).toEqual(['withWelcomeSession']);
  });

  test('the caller-side extractor reads a specifier that names the file', () => {
    const file = path.join(ROOT, 'tests/e2e/chatbot/chat-composer.spec.js');
    const source = "const { withWelcomeSession } = require('../helpers/welcome.js');";
    expect([...namesTakenIn(file, source)]).toEqual(['withWelcomeSession']);
  });

  test('the caller-side extractor refuses to guess when an identifier is bound twice', () => {
    const file = path.join(ROOT, 'tests/e2e/chatbot/chat-composer.spec.js');
    const source =
      "var welcome = require('../helpers/welcome');\nvar welcome = page.locator('.welcome');\nconst other = welcome.lum();";
    expect(() => namesTakenIn(file, source)).toThrow(/binds "welcome" more than once/);
  });

  test('the caller-side extractor ignores a file that takes nothing from this helper', () => {
    const file = path.join(ROOT, 'tests/e2e/chatbot/chat-composer.spec.js');
    const source =
      "const { expect } = require('@playwright/test');\nconst { withWelcomeSession } = require('./other');";
    expect([...namesTakenIn(file, source)]).toEqual([]);
  });

  test('the export-side reader fails loud when the export block is gone', () => {
    expect(() => namesExportedBy('module.exports = 1;')).toThrow(/no readable/);
  });

  test('the export-side reader fails loud on an entry it cannot read', () => {
    expect(() => namesExportedBy('module.exports = {\n  nested: { a: 1, b: 2 }\n};')).toThrow(/cannot read/);
  });

  test("the export-side reader reads the helper's own exports", () => {
    const source = stripJsComments(fs.readFileSync(HELPER, 'utf8'));
    expect(namesExportedBy(source).size).toBeGreaterThan(0);
  });
});
