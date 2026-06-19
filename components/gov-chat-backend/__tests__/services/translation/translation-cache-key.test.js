const {
  translationCacheKey,
  TRANSLATION_LOGIC_VERSION
} = require('../../../services/translation/translation-cache-key');

describe('translationCacheKey', () => {
  const V = TRANSLATION_LOGIC_VERSION;

  test('includes doc hash, target lang, model id, and logic version', () => {
    expect(translationCacheKey('abc123', 'es', 'google/gemma-3-4b-it')).toBe(
      `translation:abc123:es:google/gemma-3-4b-it:${V}`
    );
  });

  test('different model => different key (model change invalidates cache)', () => {
    const k1 = translationCacheKey('abc123', 'es', 'google/gemma-3-4b-it');
    const k2 = translationCacheKey('abc123', 'es', 'facebook/nllb-200-distilled-600M');
    expect(k1).not.toBe(k2);
  });

  test('different content hash => different key (content change invalidates)', () => {
    expect(translationCacheKey('hash1', 'es', 'm')).not.toBe(translationCacheKey('hash2', 'es', 'm'));
  });

  test('different target lang => different key', () => {
    expect(translationCacheKey('h', 'es', 'm')).not.toBe(translationCacheKey('h', 'fr', 'm'));
  });

  test('falls back to "unknown" when model id missing (still stable)', () => {
    expect(translationCacheKey('h', 'es', undefined)).toBe(`translation:h:es:unknown:${V}`);
    expect(translationCacheKey('h', 'es', null)).toBe(`translation:h:es:unknown:${V}`);
    expect(translationCacheKey('h', 'es', '')).toBe(`translation:h:es:unknown:${V}`);
  });

  test('TRANSLATION_LOGIC_VERSION is defined (bump on logic change)', () => {
    expect(typeof TRANSLATION_LOGIC_VERSION).toBe('string');
    expect(TRANSLATION_LOGIC_VERSION.length).toBeGreaterThan(0);
  });
});
