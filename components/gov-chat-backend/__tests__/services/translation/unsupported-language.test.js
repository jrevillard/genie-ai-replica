'use strict';

const {
  UnsupportedLanguageError,
  isUnsupportedLanguage
} = require('../../../services/translation/unsupported-language');

describe('the refusal of a language', () => {
  it('names the refused side, never the value the caller sent', () => {
    const error = new UnsupportedLanguageError('target');

    expect(error.message).toBe('Unsupported target language');
    expect(error.message).not.toContain('Ignore all previous instructions');
  });

  it('is a bad request, not a server error', () => {
    // The status code travels with the error, so a route cannot answer the
    // refusal with another status.
    expect(new UnsupportedLanguageError('source').statusCode).toBe(400);
  });

  it('is recognized as a refusal, by the class and by the code', () => {
    // The error crosses a module boundary: a service throws it, a route reads
    // it. A code that survived the crossing still says what happened.
    expect(isUnsupportedLanguage(new UnsupportedLanguageError('target'))).toBe(true);
    expect(isUnsupportedLanguage({ code: 'UNSUPPORTED_LANGUAGE' })).toBe(true);
    expect(isUnsupportedLanguage(new Error('something else'))).toBe(false);
    expect(isUnsupportedLanguage(undefined)).toBe(false);
  });
});
