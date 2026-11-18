'use strict';

/**
 * The front-matter parser must never execute code.
 *
 * CVE-2026-78847 (gray-matter, every published version, no upstream fix):
 * the parser is chosen from the TEXT right after the opening delimiter, so
 * a document that starts with "---js" selects the JavaScript engine, which
 * eval()s the front matter. The documents that reach the Studio come from
 * crawls, imports, uploads and pasted content — an attacker-controlled
 * document would run code in the steward's browser, with the admin session.
 *
 * stringify needs the barrier too: gray-matter PARSES a string content
 * before writing it, so the payload can travel in the BODY.
 */

const fs = require('fs');
const path = require('path');

const { safeMatter, safeStringify, declaredLanguage } = require('@/services/safeMatter');

const SRC_DIR = path.join(__dirname, '..', '..');

describe('safeMatter', () => {
  it('parses ordinary YAML front matter', () => {
    const parsed = safeMatter('---\ntitle: A concept\ntype: topic\n---\nThe body.\n');
    expect(parsed.data).toEqual({ title: 'A concept', type: 'topic' });
    expect(parsed.content.trim()).toBe('The body.');
  });

  it('parses a document with no front matter at all', () => {
    expect(safeMatter('Just a body, no delimiters.\n').data).toEqual({});
  });

  it('refuses a document that declares the JavaScript engine', () => {
    const attack = '---js\n{ this: global.__grayMatterPwned = true }\n---\nbody\n';
    expect(() => safeMatter(attack)).toThrow(/not allowed/);
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

  it('sees the language through a BOM and through a non-breaking space', () => {
    // gray-matter strips the BOM and trims the language line with the full
    // Unicode trim — the detection must mirror both, or the whitelist would
    // miss a declaration gray-matter does see.
    expect(() => safeMatter('﻿---js\n{}\n---\n')).toThrow(/not allowed/);
    expect(() => safeMatter('--- js\n{}\n---\n')).toThrow(/not allowed/);
  });

  it("does not populate gray-matter's parse cache (a cached parse would be replayed)", () => {
    const matter = require('gray-matter');
    const before = Object.keys(matter.cache || {}).length;
    safeMatter('---\ntitle: cached\n---\nbody\n');
    expect(Object.keys(matter.cache || {}).length).toBe(before);
  });
});

describe('safeStringify', () => {
  it('writes a document with its front matter', () => {
    const out = safeStringify('The body.\n', { title: 'A concept' });
    expect(out).toContain('title: A concept');
    expect(out).toContain('The body.');
  });

  it('never evaluates a string content (gray-matter parses it first)', () => {
    // The payload travels in the BODY: stringify parses the string content
    // before writing it, so the whitelist of safeMatter does not apply.
    const attack = '---js\n{ this: global.__grayMatterPwned = true }\n---\nbody\n';
    expect(() => safeStringify(attack, { a: 1 })).toThrow();
    expect(global.__grayMatterPwned).toBeUndefined();
  });
});

describe('declaredLanguage', () => {
  it.each([
    ['---\ntitle: x\n---\n', ''],
    ['---js\n{}\n---\n', 'js'],
    ['--- javascript \n{}\n---\n', 'javascript'],
    ['﻿---js\n{}\n---\n', 'js'],
    ['no front matter', ''],
    ['', '']
  ])('reads %j as %j', (content, expected) => {
    expect(declaredLanguage(content)).toBe(expected);
  });
});

describe('the contract: gray-matter is reached through safeMatter only', () => {
  it('no module or component imports gray-matter directly', () => {
    // Parsing is the dangerous direction; serializing is not. Routing BOTH
    // through one module makes the rule crisp: a future service that
    // reaches for gray-matter directly would reopen CVE-2026-78847, and
    // this test fails the day it does.
    const offenders = [];
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(full);
          continue;
        }
        if (!/\.(js|vue)$/.test(entry.name)) continue;
        if (full.endsWith(path.join('services', 'safeMatter.js'))) continue;
        const source = fs.readFileSync(full, 'utf8');
        if (
          /from\s+['"]gray-matter['"]|require\(\s*['"]gray-matter['"]\s*\)|import\(\s*['"]gray-matter['"]/.test(source)
        ) {
          offenders.push(path.relative(SRC_DIR, full));
        }
      }
    };
    walk(SRC_DIR);
    expect(offenders).toEqual([]);
  });
});
