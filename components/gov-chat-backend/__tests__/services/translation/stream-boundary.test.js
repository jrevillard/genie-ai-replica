const { extractCommittableUnit, lastBoundaryEnd } = require('../../../services/translation/stream-boundary');

describe('stream-boundary', () => {
  describe('lastBoundaryEnd', () => {
    test('returns -1 when no boundary', () => {
      expect(lastBoundaryEnd('the pest alert indicates')).toBe(-1);
      expect(lastBoundaryEnd('')).toBe(-1);
    });

    test('detects paragraph boundary (\\n\\n)', () => {
      // 'First paragraph.' (16) + '\n\n' (at 16-17) -> cut after the blank line = 18
      expect(lastBoundaryEnd('First paragraph.\n\nSecond')).toBe(18);
    });

    test('detects sentence terminator followed by space', () => {
      expect(lastBoundaryEnd('Hello. World')).toBe(7); // after ". "
    });

    test('detects sentence terminator at end of string', () => {
      expect(lastBoundaryEnd('Hello.')).toBe(6);
      expect(lastBoundaryEnd('Done!')).toBe(5);
      expect(lastBoundaryEnd('Really?')).toBe(7);
    });

    test('handles closing quote/paren after terminator', () => {
      // '.' + '"' + ' ' consumed -> cut = 14 (after '." ')
      expect(lastBoundaryEnd('He said "hi." Then')).toBe(14);
    });

    test('picks the LAST boundary when several present', () => {
      expect(lastBoundaryEnd('A. B. C.')).toBe(8); // after the final "."
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

    test('commits up to paragraph boundary, keeps remainder', () => {
      const r = extractCommittableUnit('Para one.\n\npartial next');
      expect(r.unit).toBe('Para one.\n\n');
      expect(r.remainder).toBe('partial next');
    });

    test('commits up to last sentence boundary, keeps remainder', () => {
      const r = extractCommittableUnit('Sentence one. Sentence two. partial');
      expect(r.unit).toBe('Sentence one. Sentence two. ');
      expect(r.remainder).toBe('partial');
    });

    test('forces a commit at last whitespace when buffer exceeds maxBuffer', () => {
      const long = 'a'.repeat(500); // no boundary, 500 chars
      const buf = long + ' ' + 'b'.repeat(1000); // 1501 chars, space at 500
      const r = extractCommittableUnit(buf, { maxBuffer: 1500 });
      expect(r).not.toBeNull();
      expect(r.unit).toBe(long); // up to the space
      expect(r.remainder.startsWith(' ')).toBe(true);
    });

    test('commits everything if over maxBuffer with no whitespace', () => {
      const buf = 'a'.repeat(1600);
      const r = extractCommittableUnit(buf, { maxBuffer: 1500 });
      expect(r.unit).toBe(buf);
      expect(r.remainder).toBe('');
    });

    test('does not force-commit below maxBuffer', () => {
      const buf = 'a'.repeat(1000); // < maxBuffer, no boundary
      expect(extractCommittableUnit(buf, { maxBuffer: 1500 })).toBeNull();
    });
  });
});
