// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
//
// concept-splitter — the property that matters is LOSSLESSNESS. A splitter that
// quietly drops a paragraph is worse than the truncation it exists to prevent,
// so the round-trip is asserted directly on every case, and the fixtures are
// shaped like the real corpus (which is 57% oversized, heavy-tailed, and has a
// single 315k-character section in one Wikipedia page).

const { splitConceptBody, DEFAULT_CEILING } = require('../services/concept-splitter');

/** Re-join parts the way the caller does and assert nothing was lost or altered. */
function assertLossless(body, result, ceiling) {
  expect(result.unsplittable).toBe(false);
  expect(result.parts.length).toBeGreaterThan(0);
  const eol = body.includes('\r\n') ? '\r\n' : '\n';
  expect(result.parts.join(eol)).toBe(body);
  for (const part of result.parts) expect(part.length).toBeLessThanOrEqual(ceiling);
  // No part may be empty — an empty fragment is a dropped-content bug.
  for (const part of result.parts) expect(part.length).toBeGreaterThan(0);
}

/** Real documents are line-wrapped; a 300-char run on ONE line is genuinely unsplittable. */
const wrap = (char, total, width = 60) =>
  Array.from({ length: Math.ceil(total / width) }, () => char.repeat(width)).join('\n');

describe('concept-splitter', () => {
  describe('boundary cases', () => {
    test('empty body yields one empty part, not unsplittable', () => {
      const r = splitConceptBody('', 100);
      expect(r).toEqual({ parts: [''], unsplittable: false, reason: null, ceiling: 100 });
    });

    test('body under the ceiling is returned untouched as a single part', () => {
      const body = '# Title\n\nshort body';
      const r = splitConceptBody(body, 1000);
      expect(r.parts).toEqual([body]);
      expect(r.unsplittable).toBe(false);
    });

    test('body exactly at the ceiling is not split', () => {
      const body = 'x'.repeat(100);
      const r = splitConceptBody(body, 100);
      expect(r.parts).toEqual([body]);
    });

    test('non-string input is reported, not thrown', () => {
      for (const bad of [null, undefined, 42, {}]) {
        const r = splitConceptBody(bad, 100);
        expect(r.unsplittable).toBe(true);
        expect(r.parts).toEqual([]);
      }
    });

    test('ceiling of 0 or negative is clamped to 1 rather than looping forever', () => {
      // At a ceiling of 1 a 3-char line genuinely cannot be split, so
      // "unsplittable" is the correct answer — what must not happen is a hang
      // or a malformed result.
      const r = splitConceptBody('abc\ndef', 0);
      expect(r.ceiling).toBe(1);
      expect(r.unsplittable).toBe(true);
      expect(r.parts).toEqual([]);
      expect(typeof r.reason).toBe('string');
    });
  });

  describe('losslessness across shapes', () => {
    const cases = {
      'markdown with H2 sections': `# A\n${wrap('a', 400)}\n\n## B\n${wrap('b', 400)}`,
      'no headings at all': `para one\n\npara two\n\n${wrap('p', 600)}`,
      'deep heading levels': `### h3 one\n${wrap('x', 300)}\n#### h4 two\n${wrap('y', 300)}`,
      'frontmatter-like block': `---\ntitle: x\n---\n\n# Body\n${wrap('z', 500)}`,
      'consecutive headings with no body': '# A\n# B\n# C\n# D\n' + wrap('t', 400),
      'long line among short ones': `short\n${wrap('v', 900)}\nshort`,
      'trailing newlines': `# A\n${wrap('b', 400)}\n\n\n`,
      'leading blank lines': `\n\n\n# A\n${wrap('b', 400)}`,
      'table rows': `| a | b |\n|---|---|\n${'| 1 | 2 |'.padEnd(60, ' ').trim()}\n`.repeat(60)
    };

    for (const [name, body] of Object.entries(cases)) {
      test(name, () => {
        assertLossless(body, splitConceptBody(body, 300), 300);
      });
    }

    test('CRLF documents round-trip with CRLF preserved', () => {
      const body = '# A\r\n' + 'a'.repeat(300) + '\r\n\r\n## B\r\n' + 'b'.repeat(300);
      const r = splitConceptBody(body, 300);
      assertLossless(body, r, 300);
      expect(r.parts.join('\r\n')).toBe(body);
      expect(r.parts.every((p) => p.includes('\r\n') || !p.includes('\n'))).toBe(true);
    });
  });

  describe('splitting behaviour', () => {
    test('splits on heading boundaries when sections fit', () => {
      // Sections comfortably under the ceiling, so each stays whole and the
      // split lands exactly on the headings — which is the semantic value here.
      const body = `# One\n${wrap('a', 150)}\n\n# Two\n${wrap('b', 150)}\n\n# Three\n${wrap('c', 150)}`;
      const r = splitConceptBody(body, 300);
      assertLossless(body, r, 300);
      expect(r.parts.length).toBe(3);
      expect(r.parts.every((p) => p.startsWith('#'))).toBe(true);
    });

    test('a single oversized section is decomposed further, not truncated', () => {
      const body = `# Big\n${wrap('p', 3000)}`;
      const r = splitConceptBody(body, 300);
      assertLossless(body, r, 300);
      expect(r.parts.length).toBeGreaterThan(1);
    });

    test('no fragment ever exceeds the ceiling', () => {
      const body = Array.from({ length: 200 }, (_, i) => `## Section ${i}\n${'c'.repeat(400)}`).join('\n\n');
      for (const ceiling of [200, 500, 1000, 4000]) {
        const r = splitConceptBody(body, ceiling);
        if (r.unsplittable) continue;
        for (const part of r.parts) expect(part.length).toBeLessThanOrEqual(ceiling);
      }
    });

    test('is deterministic — same input yields identical output', () => {
      const body = '# A\n' + 'a'.repeat(500) + '\n\n# B\n' + 'b'.repeat(500) + '\n\n# C\n' + 'c'.repeat(500);
      const a = splitConceptBody(body, 400);
      const b = splitConceptBody(body, 400);
      expect(a.parts).toEqual(b.parts);
    });

    test('re-splitting an already-split part is a no-op', () => {
      const body = `# A\n${wrap('a', 400)}\n\n# B\n${wrap('b', 400)}`;
      const once = splitConceptBody(body, 250);
      expect(once.parts.length).toBeGreaterThan(1);
      for (const part of once.parts) {
        expect(splitConceptBody(part, 250).parts).toEqual([part]);
      }
    });
  });

  describe('unsplittable', () => {
    test('one line longer than the ceiling with no boundaries is unsplittable, not hard-wrapped', () => {
      const body = 'q'.repeat(500);
      const r = splitConceptBody(body, 100);
      expect(r.unsplittable).toBe(true);
      expect(r.parts).toEqual([]);
      expect(r.reason).toMatch(/shorten the source/);
    });

    test('unsplittable does not produce a partial split', () => {
      // A tiny leading section is splittable, but the giant line is not; the
      // caller must not receive a half-done split.
      const body = '# Small\n' + 's'.repeat(50) + '\n\n' + 'q'.repeat(500);
      const r = splitConceptBody(body, 100);
      expect(r.unsplittable).toBe(true);
      expect(r.parts).toEqual([]);
    });
  });

  describe('default ceiling', () => {
    test('is derived-window sized, not the historical 6000', () => {
      // 6000 was the T4-sized literal applied to every deployment. The default
      // now reflects a 65536-token window (~250k chars).
      expect(DEFAULT_CEILING).toBeGreaterThan(200000);
      const body = wrap('z', DEFAULT_CEILING + 500);
      const r = splitConceptBody(body);
      expect(r.unsplittable).toBe(false);
      expect(r.parts.length).toBeGreaterThan(1);
      assertLossless(body, r, DEFAULT_CEILING);
    });
  });
});
