// src/config/languageConfig.js

// An object for key-value lookups (used by LanguageSelector.vue)
export const localeNames = {
    en: 'English',
    st: 'Sesotho'
  };

  // An array of objects for iterating and creating UI elements (used by AdminDashboard.vue)
  export const availableLanguages = [
    { code: 'en', name: 'English' },
    { code: 'st', name: 'Sesotho' }
  ];