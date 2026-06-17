/**
 * Filter a vue-i18n `messages` map to the locales listed in `rawWhitelist`.
 *
 * The whitelist is a comma-separated locale-code string sourced at runtime from
 * `window.APP_CONFIG.availableLocales` (written by docker-entrypoint.sh from the
 * `VUE_APP_AVAILABLE_LOCALES` env var). This lets a deployment expose a locale
 * subset WITHOUT deleting locale files — converting a content fork into a config
 * fork.
 *
 * Rules:
 *  - empty/blank `rawWhitelist` → no filtering (all locales kept)
 *  - codes are trimmed and matched case-insensitively
 *  - `en` is always retained so vue-i18n `fallbackLocale: 'en'` can resolve
 *
 * @param {Object<string, Object>} messages locale code → message tree (mutated)
 * @param {string} rawWhitelist e.g. "en,es" (may be empty/undefined)
 * @returns {Object<string, Object>} the (in-place) filtered messages map
 */
export function applyLocaleWhitelist(messages, rawWhitelist) {
  const whitelist = (rawWhitelist || '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
  if (!whitelist.length) return messages;
  for (const locale of Object.keys(messages)) {
    if (locale.toLowerCase() !== 'en' && !whitelist.includes(locale.toLowerCase())) {
      delete messages[locale];
    }
  }
  return messages;
}
