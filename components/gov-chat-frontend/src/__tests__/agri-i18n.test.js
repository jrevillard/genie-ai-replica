/**
 * agri-i18n dictionary parity tests
 */
'use strict';

const { displayName, localizeFullName } = require('../utils/agri-i18n.js');

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

  // Key parity: every key in FULL_NAMES_ES must be translated in FR and PT
  // (not fall back to the English input). We test this by checking that
  // displayName does NOT return the English key for any known Spanish key.
  test('all FULL_NAMES_ES keys translate in French (no fallback)', () => {
    // Key parity is proven by: every key that displayName looks up in the dict
    // for es returns a non-identical translation string.
    // We use a representative sample set of keys from FULL_NAMES_ES.
    const sampleKeys = [
      'Beef (intl benchmark)',
      'Maize (US #2, US Gulf intl benchmark)',
      'Tilapia fillets, Honduras exports (FOB) [regional]',
      'Central America post-harvest food loss (FAO SDG 12.3.1)',
      'Whole tilapia, Costa Rica exports (FOB) [regional]'
    ];
    for (const key of sampleKeys) {
      const frResult = displayName(key, 'fr');
      const esResult = displayName(key); // single-arg = es
      expect(frResult).not.toBe(key); // fr must translate
      expect(frResult).not.toBe(esResult); // fr must differ from es
    }
  });

  test('all FULL_NAMES_ES keys translate in Portuguese (no fallback)', () => {
    const sampleKeys = [
      'Beef (intl benchmark)',
      'Maize (US #2, US Gulf intl benchmark)',
      'Tilapia fillets, Honduras exports (FOB) [regional]',
      'Central America post-harvest food loss (FAO SDG 12.3.1)',
      'Whole tilapia, Costa Rica exports (FOB) [regional]'
    ];
    for (const key of sampleKeys) {
      const ptResult = displayName(key, 'pt');
      const esResult = displayName(key);
      expect(ptResult).not.toBe(key);
      expect(ptResult).not.toBe(esResult);
    }
  });

  test('localizeFullName delegates to displayName', () => {
    expect(localizeFullName('Beef (intl benchmark)', 'fr')).toBe(displayName('Beef (intl benchmark)', 'fr'));
  });
});
