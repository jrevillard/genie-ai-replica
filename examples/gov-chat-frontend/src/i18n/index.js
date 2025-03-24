// src/i18n/index.js

import { createI18n } from 'vue-i18n'

// Import all locale messages
import en from './locales/en'
import fr from './locales/fr'
import sw from './locales/sw'

// Create i18n instance
const i18n = createI18n({
  legacy: true, // Enable legacy API for backwards compatibility
  locale: 'en', // Default locale
  fallbackLocale: 'en',
  messages: {
    en,
    fr,
    sw
  }
})

export default i18n
