'use strict';

const { normalizeRequestedLanguage } = require('../../../services/translation/language-request');

describe('normalizeRequestedLanguage', () => {
  it('lower-cases the language', () => {
    // The language maps are keyed in lower case ("fr"), so "FR" is the same
    // language written differently — not a different language.
    expect(normalizeRequestedLanguage('FR')).toBe('fr');
  });

  it('trims the language', () => {
    expect(normalizeRequestedLanguage('  fr  ')).toBe('fr');
  });

  it('returns an empty string for a value that is not a string', () => {
    expect(normalizeRequestedLanguage(42)).toBe('');
    expect(normalizeRequestedLanguage({ code: 'fr' })).toBe('');
    expect(normalizeRequestedLanguage(['fr'])).toBe('');
    expect(normalizeRequestedLanguage(null)).toBe('');
    expect(normalizeRequestedLanguage(undefined)).toBe('');
  });

  it('returns an empty string for a blank language', () => {
    expect(normalizeRequestedLanguage('   ')).toBe('');
    expect(normalizeRequestedLanguage('')).toBe('');
  });
});
