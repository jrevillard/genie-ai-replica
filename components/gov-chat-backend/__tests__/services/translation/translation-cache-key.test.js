const {
  translationCacheKey,
  TRANSLATION_LOGIC_VERSION
} = require('../../../services/translation/translation-cache-key');

describe('translationCacheKey', () => {
  // The version is written out rather than interpolated from the module: a
  // bump of the constant has to be acknowledged here, in the file that says
  // what the cache key means. The cache has no TTL, so a version that moved
  // silently would strand every entry a released deployment wrote.
  const V = '3';

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

  test('TRANSLATION_LOGIC_VERSION is the version the key is built with', () => {
    expect(TRANSLATION_LOGIC_VERSION).toBe(V);
  });

  test('the version is the newest one ever used, and no version is used twice', () => {
    // The cache has no TTL: the entries a release wrote stay in Redis
    // forever. A version number therefore keeps one meaning for the life of
    // the deployment, and a released one is never taken again. The list of
    // versions ever used only grows, and the version in the code is the
    // newest of them — so a bump that forgets to extend the list, or a
    // version taken twice, fails here instead of stranding the entries a
    // released deployment wrote.
    const versions = ['1', '2', '3'];
    expect(new Set(versions).size).toBe(versions.length);
    expect(TRANSLATION_LOGIC_VERSION).toBe(versions[versions.length - 1]);
  });
});
