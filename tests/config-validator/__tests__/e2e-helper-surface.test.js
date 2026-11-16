const path = require('path');
const fs = require('fs');

const { jsFiles, stripJsComments } = require('../validators/js-files');

const ROOT = path.resolve(__dirname, '../../..');
const E2E_ROOT = path.join(ROOT, 'tests/e2e');
const HELPER = path.join(ROOT, 'tests/e2e/helpers/welcome.js');

// Every require of the helper, wherever it sits in the statement.
const REQUIRE = /\brequire\(\s*(['"])([^'"]+)\1\s*\)/g;

// A destructuring binding of the helper:
//   const { a, b: c, d = 0 } = require('...');
const DESTRUCTURED = /\b(?:const|let|var)\s*\{([^}]*)\}\s*=\s*require\(\s*(['"])([^'"]+)\2\s*\)/g;

// The exported name an entry asks for: the first identifier of the
// entry. `a`, `a: local` and `a = 0` all ask for `a`; `a: { b }` asks
// for `a` as well.
const EXPORTED_NAME = /^([A-Za-z_$][A-Za-z0-9_$]*)/;

// The names a caller takes from the helper, and the shapes this gate
// cannot read.
//
// The require is RESOLVED against the requiring file, so the shape of
// the specifier stops mattering: './welcome', '../helpers/welcome' and
// '../helpers/welcome.js' are the same file.
//
// A file that binds the helper as a MODULE OBJECT is refused, not
// guessed: every member read of `welcome.` in such a file is
// ambiguous with another object's property (`other.welcome.bar`), and
// the gate that exists to catch a missing export must not invent
// names. Destructuring is the form the e2e specs already use.
//
// Every require of the helper must be accounted for: the file's
// require count and the number of bindings this gate recognized must
// agree, or the gate refuses the file. A require it cannot read is a
// blind spot, and a blind spot in this direction is the failure the
// gate exists to prevent.
const namesTakenIn = (file, source) => {
  const names = new Set();
  const dir = path.dirname(file);
  const problems = [];

  const isHelper = (specifier) => {
    if (!specifier.startsWith('.')) return false;
    const resolved = path.resolve(dir, specifier);
    return resolved === HELPER || `${resolved}.js` === HELPER;
  };

  let requires = 0;
  for (const match of source.matchAll(REQUIRE)) {
    if (!isHelper(match[2])) continue;
    requires += 1;
  }

  let bindings = 0;
  for (const match of source.matchAll(DESTRUCTURED)) {
    if (!isHelper(match[3])) continue;
    bindings += 1;
    for (const entry of match[1].split(',')) {
      const trimmed = entry.trim();
      if (trimmed === '') continue;
      const name = trimmed.match(EXPORTED_NAME);
      if (!name) {
        problems.push(`an entry this gate cannot read: "${trimmed}"`);
        continue;
      }
      names.add(name[1]);
    }
  }

  // The module-object form: refused, never guessed.
  const moduleObject = /\b(?:const|let|var)\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*require\(\s*(['"])([^'"]+)\2\s*\)/g;
  for (const match of source.matchAll(moduleObject)) {
    if (!isHelper(match[3])) continue;
    problems.push(
      `the helper is bound as the module object "${match[1]}" — destructure its names instead, so every member read is unambiguous`
    );
  }

  if (requires !== bindings) {
    problems.push(`${requires} require(s) of the helper, ${bindings} binding(s) this gate could read`);
  }

  return { names, problems };
};

// The helper's exported names, read from its own export block. The
// block is read as TEXT: the helper is a Playwright module, and the
// validator has no business loading it.
//
// The block is split on its TOP-LEVEL commas only — a value carrying
// its own comma (a nested object) is one entry, not two.
const namesExportedBy = (source) => {
  const block = source.match(/module\.exports\s*=\s*\{([\s\S]*?)\n\};/);
  if (!block) {
    // Loud, never empty: a helper that stopped using this shape must
    // fail this gate, not pass it by exporting nothing.
    throw new Error('the welcome helper has no readable `module.exports = { ... }` block');
  }
  const names = new Set();
  let depth = 0;
  let entry = '';
  const entries = [];
  for (const character of block[1]) {
    if (character === '{' || character === '[' || character === '(') depth += 1;
    if (character === '}' || character === ']' || character === ')') depth -= 1;
    if (character === ',' && depth === 0) {
      entries.push(entry);
      entry = '';
      continue;
    }
    entry += character;
  }
  entries.push(entry);

  for (const raw of entries) {
    const trimmed = raw.trim();
    if (trimmed === '') continue;
    const name = trimmed.match(EXPORTED_NAME);
    if (!name) {
      throw new Error(`the welcome helper exports an entry this reader cannot read: "${trimmed}"`);
    }
    names.add(name[1]);
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
    const unread = [];
    for (const file of jsFiles(E2E_ROOT)) {
      const source = stripJsComments(fs.readFileSync(file, 'utf8'));
      const { names, problems } = namesTakenIn(file, source);
      for (const problem of problems) unread.push(`${path.relative(ROOT, file)}: ${problem}`);
      if (names.size === 0) continue;
      callers.push(path.relative(ROOT, file));
      for (const name of names) taken.add(name);
    }

    // Jest's expect takes no message argument — the failure names the
    // sets by their own contents.
    expect(unread).toEqual([]);
    expect(callers.length).toBeGreaterThan(0);
    expect([...taken].sort()).toEqual([...exported].sort());
  });

  test('the caller-side extractor reads a destructuring', () => {
    const file = path.join(ROOT, 'tests/e2e/chatbot/chat-composer.spec.js');
    const source = "const { withWelcomeSession, DEFAULT_SESSION } = require('../helpers/welcome');";
    expect([...namesTakenIn(file, source).names].sort()).toEqual(['DEFAULT_SESSION', 'withWelcomeSession']);
  });

  test('the caller-side extractor reads a `let` destructuring', () => {
    const file = path.join(ROOT, 'tests/e2e/chatbot/chat-composer.spec.js');
    const source = "let { withWelcomeSession } = require('../helpers/welcome');";
    expect([...namesTakenIn(file, source).names]).toEqual(['withWelcomeSession']);
  });

  test('the caller-side extractor reads an alias by its EXPORTED name', () => {
    const file = path.join(ROOT, 'tests/e2e/chatbot/chat-composer.spec.js');
    const source = "const { withWelcomeSession: welcome } = require('../helpers/welcome');";
    expect([...namesTakenIn(file, source).names]).toEqual(['withWelcomeSession']);
  });

  test('the caller-side extractor reads a default value by its EXPORTED name', () => {
    const file = path.join(ROOT, 'tests/e2e/chatbot/chat-composer.spec.js');
    const source = "const { contrastRatio = null } = require('../helpers/welcome');";
    expect([...namesTakenIn(file, source).names]).toEqual(['contrastRatio']);
  });

  test('the caller-side extractor refuses a nested destructure it cannot read', () => {
    const file = path.join(ROOT, 'tests/e2e/chatbot/chat-composer.spec.js');
    const source = "const { withWelcomeSession: { one } } = require('../helpers/welcome');";
    // A shape the reader cannot reach is refused, never guessed: a
    // blind spot here is the failure the gate exists to prevent.
    expect(namesTakenIn(file, source).problems.join(' ')).toMatch(/require\(s\) of the helper/);
  });

  test('the caller-side extractor finds a caller that writes the helper by its own directory', () => {
    const file = path.join(ROOT, 'tests/e2e/helpers/welcome.spec.js');
    const source = "const { withWelcomeSession } = require('./welcome');";
    expect([...namesTakenIn(file, source).names]).toEqual(['withWelcomeSession']);
  });

  test('the caller-side extractor reads a specifier that names the file', () => {
    const file = path.join(ROOT, 'tests/e2e/chatbot/chat-composer.spec.js');
    const source = "const { withWelcomeSession } = require('../helpers/welcome.js');";
    expect([...namesTakenIn(file, source).names]).toEqual(['withWelcomeSession']);
  });

  test('the caller-side extractor refuses the module-object form', () => {
    const file = path.join(ROOT, 'tests/e2e/chatbot/chat-composer.spec.js');
    const source = "const welcome = require('../helpers/welcome');\nconst other = welcome.readVisualLayerState(page);";
    expect(namesTakenIn(file, source).problems.join(' ')).toMatch(/module object/);
  });

  test('the caller-side extractor refuses a require it cannot read', () => {
    const file = path.join(ROOT, 'tests/e2e/chatbot/chat-composer.spec.js');
    const source = "const b = 2, welcome = require('../helpers/welcome');";
    expect(namesTakenIn(file, source).problems.join(' ')).toMatch(/require\(s\) of the helper/);
  });

  test('the caller-side extractor ignores a file that takes nothing from this helper', () => {
    const file = path.join(ROOT, 'tests/e2e/chatbot/chat-composer.spec.js');
    const source =
      "const { expect } = require('@playwright/test');\nconst { withWelcomeSession } = require('./other');";
    expect([...namesTakenIn(file, source).names]).toEqual([]);
  });

  test('the export-side reader fails loud when the export block is gone', () => {
    expect(() => namesExportedBy('module.exports = 1;')).toThrow(/no readable/);
  });

  test('the export-side reader reads a value that carries its own comma', () => {
    const names = namesExportedBy('module.exports = {\n  nested: { a: 1, b: 2 },\n  plain\n};');
    expect([...names].sort()).toEqual(['nested', 'plain']);
  });

  test('the export-side reader reads a trailing comma as no entry', () => {
    const names = namesExportedBy('module.exports = {\n  plain,\n};');
    expect([...names]).toEqual(['plain']);
  });

  test("the export-side reader reads the helper's own exports", () => {
    const source = stripJsComments(fs.readFileSync(HELPER, 'utf8'));
    expect(namesExportedBy(source).size).toBeGreaterThan(0);
  });
});
