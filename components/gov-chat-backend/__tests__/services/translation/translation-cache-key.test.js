const {
  translationCacheKey,
  TRANSLATION_LOGIC_VERSION
} = require('../../../services/translation/translation-cache-key');

describe('translationCacheKey', () => {
  const V = TRANSLATION_LOGIC_VERSION;

  test('includes doc hash, source lang, target lang, model id, and logic version', () => {
    expect(translationCacheKey('abc123', 'en', 'es', 'google/gemma-3-4b-it')).toBe(
      `translation:abc123:en:es:google/gemma-3-4b-it:${V}`
    );
  });

  test('different model => different key (model change invalidates cache)', () => {
    const k1 = translationCacheKey('abc123', 'en', 'es', 'google/gemma-3-4b-it');
    const k2 = translationCacheKey('abc123', 'en', 'es', 'facebook/nllb-200-distilled-600M');
    expect(k1).not.toBe(k2);
  });

  test('different content hash => different key (content change invalidates)', () => {
    expect(translationCacheKey('hash1', 'en', 'es', 'm')).not.toBe(translationCacheKey('hash2', 'en', 'es', 'm'));
  });

  test('different target lang => different key', () => {
    expect(translationCacheKey('h', 'en', 'es', 'm')).not.toBe(translationCacheKey('h', 'en', 'fr', 'm'));
  });

  test('different source lang => different key', () => {
    // A translation cached for one source language was produced from that
    // source: the same content read as another language is another result.
    expect(translationCacheKey('h', 'en', 'es', 'm')).not.toBe(translationCacheKey('h', 'fr', 'es', 'm'));
  });

  test('falls back to "unknown" when model id missing (still stable)', () => {
    expect(translationCacheKey('h', 'en', 'es', undefined)).toBe(`translation:h:en:es:unknown:${V}`);
    expect(translationCacheKey('h', 'en', 'es', null)).toBe(`translation:h:en:es:unknown:${V}`);
    expect(translationCacheKey('h', 'en', 'es', '')).toBe(`translation:h:en:es:unknown:${V}`);
  });

  test('TRANSLATION_LOGIC_VERSION is defined (bump on logic change)', () => {
    expect(typeof TRANSLATION_LOGIC_VERSION).toBe('string');
    expect(TRANSLATION_LOGIC_VERSION.length).toBeGreaterThan(0);
  });
});
