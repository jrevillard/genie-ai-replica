'use strict';

const { normalizeRequestedLanguage } = require('../../../services/translation/language-request');

/**
 * The canonical form of a caller-supplied language.
 *
 * The language travels in the request body, so it is caller-controlled. Two
 * callers read the same field — the query service, which forwards it to OPEA,
 * and the query routes, which refuse a language the deployment cannot answer
 * in — and both go through this helper. When they normalize it differently,
 * the same request is refused by one path and served by another.
 */
describe('the canonical form of a requested language', () => {
  it('lower-cases the language the maps are keyed in', () => {
    expect(normalizeRequestedLanguage('FR')).toBe('fr');
    expect(normalizeRequestedLanguage('zh-Hans')).toBe('zh-hans');
  });

  it('trims the language the caller padded with spaces', () => {
    // The trim comes before the cut: a language cut before it is trimmed is a
    // language that disappears, and the request is then answered in English
    // without ever being refused.
    expect(normalizeRequestedLanguage('   fr   ')).toBe('fr');
  });

  it('keeps the language when the padding pushes it past the cut', () => {
    // 40 spaces of padding: the code is beyond the 32-character bound, so a
    // value cut before it is trimmed loses the language entirely.
    expect(normalizeRequestedLanguage(`${' '.repeat(40)}fr`)).toBe('fr');
  });

  it('cuts a value that is not a language to a bounded length', () => {
    // The request body may be large: the normalization itself has to cost a
    // bounded amount.
    expect(normalizeRequestedLanguage('x'.repeat(5000))).toHaveLength(32);
  });

  it('reads a value that is not a string as no language at all', () => {
    expect(normalizeRequestedLanguage(42)).toBe('');
    expect(normalizeRequestedLanguage(null)).toBe('');
    expect(normalizeRequestedLanguage(undefined)).toBe('');
    expect(normalizeRequestedLanguage({ fr: 'French' })).toBe('');
    expect(normalizeRequestedLanguage(['fr'])).toBe('');
  });

  it('reads a blank language as no language at all', () => {
    expect(normalizeRequestedLanguage('')).toBe('');
    expect(normalizeRequestedLanguage('   ')).toBe('');
  });
});
