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

// Locales loaded from ./locales/, after applying the optional per-deployment
// whitelist above. Reflects the active set for this deployment.
export const availableLocales = Object.keys(messages);

export default i18n;
