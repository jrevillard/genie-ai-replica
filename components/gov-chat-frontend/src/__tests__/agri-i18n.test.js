/**
 * agri-i18n dictionary parity tests
 */
'use strict';

const { displayName, localizeFullName, FULL_NAMES_BY_LOCALE } = require('../utils/agri-i18n.js');

describe('agri-i18n key parity via displayName', () => {
  // Sample key to verify locale routing works
  const SAMPLE_KEY = 'Beef (intl benchmark)';

  test('displayName single-arg returns Spanish (backward compatibility)', () => {
    expect(displayName(SAMPLE_KEY)).toBe('Carne de res (referencia internacional)');
  });

  test('displayName returns French when locale is fr', () => {
    expect(displayName(SAMPLE_KEY, 'fr')).toBe('Bœuf (référence internationale)');
  });

  test('displayName returns Portuguese when locale is pt', () => {
    expect(displayName(SAMPLE_KEY, 'pt')).toBe('Carne bovina (referência internacional)');
  });

  test('displayName falls back to input for unknown locale', () => {
    expect(displayName(SAMPLE_KEY, 'de')).toBe(SAMPLE_KEY);
  });

  test('displayName falls back to input for unknown key', () => {
    expect(displayName('Unknown series name', 'fr')).toBe('Unknown series name');
  });

  // Key parity: every key in FULL_NAMES_ES must be translated in FR and PT.
  test('all FULL_NAMES_ES keys have FR and PT entries', () => {
    expect(Object.keys(FULL_NAMES_BY_LOCALE.es).every((k) => k in FULL_NAMES_BY_LOCALE.fr)).toBe(true);
    expect(Object.keys(FULL_NAMES_BY_LOCALE.es).every((k) => k in FULL_NAMES_BY_LOCALE.pt)).toBe(true);
  });

  // Detect English fallback (e.g. a value that still contains English crop names).
  test('FR and PT dict values contain no English fallback', () => {
    const enWords = ['Beans (', 'Maize (', 'Rice,', 'Sorghum,', 'wheat', 'tomatoes'];
    const hasEnglishFallback = (dict) =>
      Object.values(dict).some((v) => enWords.some((w) => v.toLowerCase().includes(w.toLowerCase())));
    expect(hasEnglishFallback(FULL_NAMES_BY_LOCALE.fr)).toBe(false);
    expect(hasEnglishFallback(FULL_NAMES_BY_LOCALE.pt)).toBe(false);
  });

  test('localizeFullName delegates to displayName', () => {
    expect(localizeFullName('Beef (intl benchmark)', 'fr')).toBe(displayName('Beef (intl benchmark)', 'fr'));
  });
});
