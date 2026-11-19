// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// The front-matter parser must never execute code.
//
// CVE-2026-78847 (gray-matter, every published version, no upstream fix):
// the parser is chosen from the TEXT right after the opening delimiter, so
// a document that starts with "---js" selects the JavaScript engine, which
// eval()s the front matter. The documents parsed here come from crawls,
// imports and uploads — an attacker-controlled document would run code in
// this container.

const fs = require('fs');
const path = require('path');

const matter = require('gray-matter');
const { safeMatter, stringify, declaredLanguage } = require('../services/safe-frontmatter');

const COMPONENT_DIR = path.join(__dirname, '..');
// Every import form gray-matter can be reached through: require, static
// import, dynamic import — single or double quotes.
const DIRECT_IMPORT =
  /(require\(\s*['"]gray-matter['"]\s*\))|(from\s+['"]gray-matter['"])|(import\(\s*['"]gray-matter['"])/;

describe('safeMatter', () => {
  it('parses ordinary YAML front matter', () => {
    const parsed = safeMatter('---\ntitle: A concept\ntype: topic\n---\nThe body.\n');
    expect(parsed.data).toEqual({ title: 'A concept', type: 'topic' });
    expect(parsed.content.trim()).toBe('The body.');
  });

  it('parses a document with no front matter at all', () => {
    const parsed = safeMatter('Just a body, no delimiters.\n');
    expect(parsed.data).toEqual({});
  });

  it('refuses a document that declares the JavaScript engine', () => {
    const attack = '---js\n{ this: global.__grayMatterPwned = true }\n---\nbody\n';
    expect(() => safeMatter(attack)).toThrow(/not allowed/);
    // The payload must not have run.
    expect(global.__grayMatterPwned).toBeUndefined();
  });

  it('refuses every spelling of the JavaScript engine', () => {
    for (const language of ['js', 'javascript', 'JS', 'JavaScript']) {
      expect(() => safeMatter(`---${language}\n{}\n---\n`)).toThrow(/not allowed/);
    }
  });

  it('refuses the CoffeeScript engine too (it compiles code as well)', () => {
    expect(() => safeMatter('---coffee\nx = 1\n---\n')).toThrow(/not allowed/);
  });

  it('keeps the second barrier: the code-executing engines are unregistered', () => {
    // Even without the language check, gray-matter's own dispatch must
    // throw instead of evaluating — that is the backstop for a path that
    // reaches the library directly.
    const attack = '---js\n{ this: global.__grayMatterPwned = true }\n---\nbody\n';
    expect(() => matter(attack, { engines: { javascript: false, coffee: false } })).toThrow();
    expect(global.__grayMatterPwned).toBeUndefined();
  });

  it('sees the language through a BOM and through a non-breaking space', () => {
    // gray-matter strips the BOM and trims the language line with the full
    // Unicode trim — the detection must mirror both, or the whitelist would
    // miss a declaration gray-matter does see.
    expect(() => safeMatter('\uFEFF---js\n{}\n---\n')).toThrow(/not allowed/);
    expect(() => safeMatter('--- js\n{}\n---\n')).toThrow(/not allowed/);
  });

  it("does not populate gray-matter's parse cache (a cached parse would be replayed)", () => {
    const before = Object.keys(matter.cache || {}).length;
    safeMatter('---\ntitle: cached\n---\nbody\n');
    expect(Object.keys(matter.cache || {}).length).toBe(before);
  });
});

describe('stringify', () => {
  it('writes a document with its front matter', () => {
    const out = stringify('The body.\n', { title: 'A concept' });
    expect(out).toContain('title: A concept');
    expect(out).toContain('The body.');
  });

  it('never evaluates a string content (gray-matter parses it first)', () => {
    // gray-matter PARSES a string content before writing it (index.js:161),
    // so the payload can travel in the BODY: the whitelist of safeMatter
    // does not apply to this path.
    const attack = '---js\n{ this: global.__grayMatterPwned = true }\n---\nbody\n';
    expect(() => stringify(attack, { a: 1 })).toThrow();
    expect(global.__grayMatterPwned).toBeUndefined();
  });
});

describe('declaredLanguage', () => {
  it.each([
    ['---\ntitle: x\n---\n', ''],
    ['---js\n{}\n---\n', 'js'],
    ['\uFEFF---js\n{}\n---\n', 'js'],
    ['--- javascript \n{}\n---\n', 'javascript'],
    ['no front matter', ''],
    ['', '']
  ])('reads %j as %j', (content, expected) => {
    expect(declaredLanguage(content)).toBe(expected);
  });
});

describe('the contract: gray-matter is reached through safe-frontmatter only', () => {
  it('no module of the component requires gray-matter directly', () => {
    // Parsing is the dangerous direction; serializing is not. Routing
    // BOTH through one module makes the rule crisp and checkable: a
    // future service that reaches for gray-matter directly would reopen
    // CVE-2026-78847, and this test fails the day it does.
    //
    // The whole component is walked — a require in controllers/, routes/,
    // scripts/, validators/, middleware/, db/ or index.js would reopen it
    // just as much as one in services/ — and every import FORM is caught
    // (require, static import, dynamic import, single or double quotes).
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!entry.name.endsWith('.js')) continue;
        if (full.endsWith(path.join('services', 'safe-frontmatter.js'))) continue;
        if (DIRECT_IMPORT.test(fs.readFileSync(full, 'utf8'))) {
          offenders.push(path.relative(COMPONENT_DIR, full));
        }
      }
    };
    walk(COMPONENT_DIR);
    expect(offenders).toEqual([]);
  });
});
