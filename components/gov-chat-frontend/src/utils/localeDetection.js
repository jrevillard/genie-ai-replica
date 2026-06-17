/**
 * Determine the initial locale for the application.
 *
 * Priority:
 * 1. Saved user preference (localStorage)
 * 2. Browser language (if supported)
 * 3. Fallback to 'en'
 *
 * @param {string|null} savedLocale - Previously saved locale from localStorage
 * @param {string} browserLanguage - navigator.language value (e.g. 'en-US', 'fr', 'es-ES')
 * @param {string[]} availableLocales - Locales that have message files (e.g. ['en', 'es'])
 * @returns {string} The resolved locale code
 */
export function detectInitialLocale(savedLocale, browserLanguage, availableLocales) {
  if (savedLocale && availableLocales.includes(savedLocale)) {
    return savedLocale;
  }

  const shortLang = (browserLanguage || '').split('-')[0];
  if (availableLocales.includes(shortLang)) {
    return shortLang;
  }

  return 'en';
}
