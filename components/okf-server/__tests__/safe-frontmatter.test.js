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
const { safeMatter, declaredLanguage } = require('../services/safe-frontmatter');

const SERVICES_DIR = path.join(__dirname, '..', 'services');

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

  it("does not populate gray-matter's parse cache (a cached parse would be replayed)", () => {
    const before = Object.keys(matter.cache || {}).length;
    safeMatter('---\ntitle: cached\n---\nbody\n');
    expect(Object.keys(matter.cache || {}).length).toBe(before);
  });
});

describe('declaredLanguage', () => {
  it.each([
    ['---\ntitle: x\n---\n', ''],
    ['---js\n{}\n---\n', 'js'],
    ['--- javascript \n{}\n---\n', 'javascript'],
    ['no front matter', ''],
    ['', '']
  ])('reads %j as %j', (content, expected) => {
    expect(declaredLanguage(content)).toBe(expected);
  });
});

describe('the contract: gray-matter is reached through safe-frontmatter only', () => {
  it('no service or worker requires gray-matter directly', () => {
    // Parsing is the dangerous direction; serializing is not. Routing
    // BOTH through one module makes the rule crisp and checkable: a
    // future service that reaches for gray-matter directly would reopen
    // CVE-2026-78847, and this test fails the day it does.
    const offenders = [];
    for (const dir of [SERVICES_DIR, path.join(SERVICES_DIR, '..', 'workers')]) {
      if (!fs.existsSync(dir)) continue;
      for (const file of fs.readdirSync(dir).filter((f) => f.endsWith('.js'))) {
        if (file === 'safe-frontmatter.js') continue;
        if (fs.readFileSync(path.join(dir, file), 'utf8').includes("require('gray-matter')")) {
          offenders.push(path.basename(dir) === 'workers' ? `workers/${file}` : file);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
