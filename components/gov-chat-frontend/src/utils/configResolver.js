/**
 * Resolve a config value that may be a locale map or plain string.
 *
 * Config values for prompts and welcome messages use locale maps:
 *   { en: "Hello", es: "Hola" }
 *
 * This function picks the value for the current locale, falling back
 * to English, then the first available value.
 *
 * @param {string|Object|undefined} value - Locale map or plain string
 * @param {string} locale - Current locale code (e.g. 'en', 'es')
 * @returns {string} Resolved text, or empty string
 */
export function resolveConfigText(value, locale) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value[locale] || value['en'] || Object.values(value)[0] || '';
  }
  return value || '';
}
