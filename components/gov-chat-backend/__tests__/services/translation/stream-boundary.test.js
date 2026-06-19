const { extractCommittableUnit, lastBoundaryEnd } = require('../../../services/translation/stream-boundary');

describe('stream-boundary', () => {
  describe('lastBoundaryEnd', () => {
    test('returns null when no boundary', () => {
      expect(lastBoundaryEnd('the pest alert indicates')).toBeNull();
      expect(lastBoundaryEnd('')).toBeNull();
    });

    test('detects paragraph boundary (\\n\\n) — separator carries the blank line', () => {
      // 'First paragraph.' (16 chars, indices 0-15); '\n\n' at 16-17.
      // content excludes the separator; separator is the '\n\n' verbatim.
      expect(lastBoundaryEnd('First paragraph.\n\nSecond')).toEqual({ contentEnd: 16, separator: '\n\n' });
    });

    test('detects sentence terminator followed by space', () => {
      // 'Hello.' period at index 5; the space is the separator.
      expect(lastBoundaryEnd('Hello. World')).toEqual({ contentEnd: 6, separator: ' ' });
    });

    test('detects sentence terminator at end of string (empty separator)', () => {
      expect(lastBoundaryEnd('Hello.')).toEqual({ contentEnd: 6, separator: '' });
      expect(lastBoundaryEnd('Done!')).toEqual({ contentEnd: 5, separator: '' });
      expect(lastBoundaryEnd('Really?')).toEqual({ contentEnd: 7, separator: '' });
    });

    test('handles closing quote/paren after terminator', () => {
      // '.' + '"' (group 1, stays in content); ' ' is the separator.
      expect(lastBoundaryEnd('He said "hi." Then')).toEqual({ contentEnd: 13, separator: ' ' });
    });

    test('picks the LAST boundary when several present', () => {
      // Final '.' at index 7, end of string -> empty separator.
      expect(lastBoundaryEnd('A. B. C.')).toEqual({ contentEnd: 8, separator: '' });
    });

    test('does NOT treat a list marker / decimal as a sentence boundary', () => {
      // '1.' period preceded by digit -> ignored; no other terminator -> null.
      expect(lastBoundaryEnd('1. First item here')).toBeNull();
      // '3.14' period between digits -> ignored.
      expect(lastBoundaryEnd('value 3.14 and')).toBeNull();
      // A real terminator after list content still splits. '1.' marker ignored;
      // 'done.' period (index 12) -> contentEnd 13, space separator.
      expect(lastBoundaryEnd('1. Item done. Next')).toEqual({ contentEnd: 13, separator: ' ' });
    });
  });

  describe('extractCommittableUnit', () => {
    test('returns null when buffer has no boundary and is small', () => {
      expect(extractCommittableUnit('partial sentence without')).toBeNull();
    });

    test('returns null for empty buffer', () => {
      expect(extractCommittableUnit('')).toBeNull();
      expect(extractCommittableUnit(null)).toBeNull();
    });

    test('commits up to paragraph boundary — separator is the \\n\\n, remainder after it', () => {
      const r = extractCommittableUnit('Para one.\n\npartial next');
      expect(r.content).toBe('Para one.');
      expect(r.separator).toBe('\n\n');
      expect(r.remainder).toBe('partial next');
    });

    test('commits up to last sentence boundary — separator is the space, remainder after it', () => {
      const r = extractCommittableUnit('Sentence one. Sentence two. partial');
      expect(r.content).toBe('Sentence one. Sentence two.');
      expect(r.separator).toBe(' ');
      expect(r.remainder).toBe('partial');
    });

    test('keeps the exact trailing whitespace as separator (newline, not space)', () => {
      // Period then a newline (single-line-break list item style).
      const r = extractCommittableUnit('Line one.\nLine two partial');
      expect(r.content).toBe('Line one.');
      expect(r.separator).toBe('\n');
      expect(r.remainder).toBe('Line two partial');
    });

    test('does not split a markdown list at its numeric markers', () => {
      // '1.' and '2.' markers are not boundaries; the list commits whole.
      const buf = '1. First item. 2. Second item.';
      const r = extractCommittableUnit(buf);
      expect(r).not.toBeNull();
      expect(r.content).toBe('1. First item. 2. Second item.');
      expect(r.separator).toBe('');
      expect(r.remainder).toBe('');
    });

    test('forces a commit at last whitespace when buffer exceeds maxBuffer', () => {
      const long = 'a'.repeat(500); // no boundary, 500 chars
      const buf = long + ' ' + 'b'.repeat(1000); // 1501 chars, space at index 500
      const r = extractCommittableUnit(buf, { maxBuffer: 1500 });
      expect(r).not.toBeNull();
      expect(r.content).toBe(long); // up to the space
      expect(r.separator).toBe(' ');
      expect(r.remainder).toBe('b'.repeat(1000));
    });

    test('commits everything if over maxBuffer with no whitespace', () => {
      const buf = 'a'.repeat(1600);
      const r = extractCommittableUnit(buf, { maxBuffer: 1500 });
      expect(r.content).toBe(buf);
      expect(r.separator).toBe('');
      expect(r.remainder).toBe('');
    });

    test('does not force-commit below maxBuffer', () => {
      const buf = 'a'.repeat(1000); // < maxBuffer, no boundary
      expect(extractCommittableUnit(buf, { maxBuffer: 1500 })).toBeNull();
    });
  });
});
