import { applyLocaleWhitelist } from '../i18n/whitelist';

// Tests the per-deployment locale whitelist (VUE_APP_AVAILABLE_LOCALES →
// window.APP_CONFIG.availableLocales, injected at runtime by docker-entrypoint.sh).
// The filter lives in src/i18n/whitelist.js (pure) and is applied in src/i18n/index.js.
describe('applyLocaleWhitelist', () => {
  const allLocales = () => ({
    en: { greeting: 'Hi' },
    es: { greeting: 'Hola' },
    fr: { greeting: 'Bonjour' },
    de: { greeting: 'Hallo' },
    ar: { greeting: 'مرحبا' }
  });

  test('keeps all locales when the whitelist is empty/blank', () => {
    for (const raw of ['', '   ', ' , , ', undefined, null]) {
      const messages = allLocales();
      applyLocaleWhitelist(messages, raw);
      expect(Object.keys(messages).sort()).toEqual(['ar', 'de', 'en', 'es', 'fr']);
    }
  });

  test('restricts to the whitelisted locales', () => {
    const messages = allLocales();
    applyLocaleWhitelist(messages, 'en,es');
    expect(Object.keys(messages).sort()).toEqual(['en', 'es']);
  });

  test('always retains en even when omitted (fallbackLocale)', () => {
    const messages = allLocales();
    applyLocaleWhitelist(messages, 'es');
    expect(Object.keys(messages).sort()).toEqual(['en', 'es']);
  });

  test('is case-insensitive and trims whitespace', () => {
    const messages = allLocales();
    applyLocaleWhitelist(messages, ' EN , ES ');
    expect(Object.keys(messages).sort()).toEqual(['en', 'es']);
  });

  test('drops locales not in the whitelist', () => {
    const messages = allLocales();
    applyLocaleWhitelist(messages, 'en,es');
    expect(messages).not.toHaveProperty('fr');
    expect(messages).not.toHaveProperty('de');
    expect(messages).not.toHaveProperty('ar');
  });
});
