// src/config/languageConfig.js

// An object for key-value lookups (used by LanguageSelector.vue)
export const localeNames = {
  ar: 'Arabic',
  bn: 'Bengali',
  en: 'English',
  de: 'German',
  es: 'Spanish',
  fr: 'Français',
  id: 'Indonesian',
  man: 'Mandinka',
  pt: 'Portuguese',
  ru: 'Russian',
  st: 'Sesotho',
  sw: 'Kiswahili',
  th: 'Thai',
  zh: 'Chinese'
};

// An array of objects for iterating and creating UI elements (used by AdminDashboard.vue)
export const availableLanguages = [
  { code: 'ar', name: 'Arabic' },
  { code: 'bn', name: 'Bengali' },
  { code: 'de', name: 'German' },
  { code: 'es', name: 'Spanish' },
  { code: 'fr', name: 'Français' },
  { code: 'id', name: 'Indonesian' },
  { code: 'man', name: 'Mandinka' },
  { code: 'pt', name: 'Portuguese' },
  { code: 'ru', name: 'Russian' },
  { code: 'st', name: 'Sesotho' },
  { code: 'sw', name: 'Kiswahili' },
  { code: 'th', name: 'Thai' },
  { code: 'zh', name: 'Chinese' }
];

/**
 * Per-deployment locale whitelist injected at runtime by docker-entrypoint.sh
 * (window.APP_CONFIG.availableLocales). Empty/unset = all locales active.
 * @returns {string[]} lowercase locale codes, or [] when no whitelist is set.
 */
function getLocaleWhitelist() {
  const raw = (typeof window !== 'undefined' && window.APP_CONFIG && window.APP_CONFIG.availableLocales) || '';
  return raw
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * The active set of selectable languages for THIS deployment, honoring the
 * runtime locale whitelist. Used by AdminDashboard.vue translation controls.
 * Unset whitelist = full `availableLanguages` set.
 * @returns {{ code: string, name: string }[]}
 */
export function getAvailableLanguages() {
  const whitelist = getLocaleWhitelist();
  if (!whitelist.length) return availableLanguages;
  return availableLanguages.filter((lang) => whitelist.includes(lang.code.toLowerCase()));
}
