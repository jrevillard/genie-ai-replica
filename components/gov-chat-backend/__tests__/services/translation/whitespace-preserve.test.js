const { withOriginalWhitespace } = require('../../../services/translation/whitespace-preserve');

describe('withOriginalWhitespace', () => {
  test('preserves a leading space (text after inline markup, e.g. bold heading)', () => {
    // The model output is trimmed; the leading space that separated
    // "**Hive Selection:**" from "Choose hives" must be restored.
    expect(withOriginalWhitespace(' Choose hives', 'Elige colmenas')).toBe(' Elige colmenas');
  });

  test('preserves a trailing space', () => {
    expect(withOriginalWhitespace('Hello. ', 'Hola.')).toBe('Hola. ');
  });

  test('preserves both leading and trailing whitespace', () => {
    expect(withOriginalWhitespace(' wrap me ', 'envuélveme')).toBe(' envuélveme ');
  });

  test('preserves multi-char edge whitespace (newlines/tabs)', () => {
    expect(withOriginalWhitespace('\n\n  text', 'texto')).toBe('\n\n  texto');
  });

  test('adds nothing when the original has no edge whitespace', () => {
    expect(withOriginalWhitespace('plain', 'llano')).toBe('llano');
  });

  test('preserves a whitespace-only node (no double-counting)', () => {
    // A node that is purely spacing (e.g. between two inline elements) is kept
    // exactly. The model trims such input to "" so the node value is just the
    // original whitespace — lead/trail must not overlap and double it.
    expect(withOriginalWhitespace('  ', '')).toBe('  ');
    expect(withOriginalWhitespace(' ', '')).toBe(' ');
  });

  test('is null-safe on either argument', () => {
    expect(withOriginalWhitespace(null, 'x')).toBe('x');
    // null translated -> only the original's edge whitespace survives.
    expect(withOriginalWhitespace(' y', null)).toBe(' ');
    expect(withOriginalWhitespace(undefined, undefined)).toBe('');
  });
});
