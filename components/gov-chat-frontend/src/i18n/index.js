import { createI18n } from 'vue-i18n';
import { applyLocaleWhitelist } from './whitelist';

// Dynamically import all locale files from the locales folder using Webpack's require.context
const localeContext = require.context('./locales', false, /\.js$/);
const messages = {};

// Iterate over all .js files in the locales folder
localeContext.keys().forEach((key) => {
  // Extract locale code from filename (e.g., './en.js' -> 'en')
  const locale = key.match(/\.\/([a-z]{2,3})\.js$/i)?.[1];
  if (locale && localeContext(key).default) {
    messages[locale] = localeContext(key).default;
  } else {
    console.warn(`Invalid locale file or export: ${key}`);
  }
});

// Optional per-deployment locale whitelist. When VUE_APP_AVAILABLE_LOCALES is
// injected at runtime (docker-entrypoint.sh → window.APP_CONFIG.availableLocales),
// only the listed locale codes stay active; unset/empty = all locales. This lets
// a deployment expose a locale subset without deleting locale files. 'en' is
// always retained so fallbackLocale ('en') can resolve.
const rawAvailableLocales =
  (typeof window !== 'undefined' && window.APP_CONFIG && window.APP_CONFIG.availableLocales) || '';
applyLocaleWhitelist(messages, rawAvailableLocales);

// Create i18n instance
const i18n = createI18n({
  legacy: true, // Enable legacy API for backwards compatibility
  locale: 'en', // Default locale
  fallbackLocale: 'en',
  messages
});

/**
 * $t(key, 'Fallback text') compatibility wrapper.
 *
 * vue-i18n has NO default-message argument: a string second argument is
 * interpreted as a LOCALE NAME. Every call of the shape
 * `$t('charts.market.latest', 'Latest')` therefore translated the key in
 * an unregistered locale "Latest", fell back to `fallbackLocale: 'en'`,
 * and rendered ENGLISH no matter which UI language was selected.
 *
 * This wrapper gives the codebase-wide (key, defaultMsg) idiom its
 * intended semantics: a string second argument that is NOT a registered
 * locale code is the default message, returned only when the key itself
 * misses. Legit calls — $t(key), $t(key, valuesObj), $t(key, n) plural,
 * $t(key, registeredLocale[, values]) — pass through untouched, and
 * interpolation still works via the original third argument.
 */
const globalT = i18n.global.t;
const registeredLocales = new Set(Object.keys(messages));
i18n.global.t = function wrappedT(key, arg1, arg2) {
  if (typeof arg1 === 'string' && !registeredLocales.has(arg1)) {
    const res = globalT.call(i18n.global, key, i18n.global.locale, arg2);
    if (res !== key) return res;
    // Key missing everywhere: interpolate the named params into the
    // default message ourselves (vue-i18n returns the raw template).
    if (arg2 && typeof arg2 === 'object') {
      return arg1.replace(/\{(\w+)\}/g, (m, p) => (p in arg2 ? String(arg2[p]) : m));
    }
    return arg1;
  }
  return globalT.call(i18n.global, key, arg1, arg2);
};

// Locales loaded from ./locales/, after applying the optional per-deployment
// whitelist above. Reflects the active set for this deployment.
export const availableLocales = Object.keys(messages);

export default i18n;
