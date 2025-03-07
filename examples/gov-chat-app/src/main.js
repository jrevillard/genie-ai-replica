/*****************************************************************************************************
 * main.js
 * 
 * Full file, including:
 * - Importing your App.vue, router, i18n.js, and store
 * - Setting up locale based on user preference or browser
 * - Logging all messages for each locale (only in development mode)
 * - Logging the active locale before and after mount
 *****************************************************************************************************/

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import i18n from './i18n.js'
import store from './store' // Import the Vuex store

// Determine the initial locale - prioritize:
// 1. Previously saved user preference
// 2. Browser language
// 3. Default to 'en'
const getSavedLocale = () => {
  try {
    return localStorage.getItem('userLocale')
  } catch (e) {
    console.warn('Unable to access localStorage:', e)
    return null
  }
}

const getBrowserLocale = () => {
  // Get browser language (e.g. 'en-US' -> 'en')
  const browserLang = navigator.language || navigator.userLanguage
  const shortLang = browserLang.split('-')[0]
  
  // Check if we support this language
  const supportedLocales = ['en', 'fr', 'sw']
  return supportedLocales.includes(shortLang) ? shortLang : null
}

// Set the initial locale based on our prioritization logic
const savedLocale = getSavedLocale()
const browserLocale = getBrowserLocale()
const initialLocale = savedLocale || browserLocale || 'en'

i18n.global.locale = initialLocale

// Log information only in development mode
if (process.env.NODE_ENV === 'development') {
  console.log("Available messages:", {
    'en': i18n.global.getLocaleMessage('en'),
    'fr': i18n.global.getLocaleMessage('fr'),
    'sw': i18n.global.getLocaleMessage('sw')
  })
  console.log("Active locale:", i18n.global.locale)
}

// Create the Vue app
const app = createApp(App)

// Use router, i18n, and store
app.use(router)
app.use(i18n)
app.use(store) // Register the Vuex store

// Create a global method for changing locale
app.config.globalProperties.$setLocale = function(locale) {
  i18n.global.locale = locale
  try {
    localStorage.setItem('userLocale', locale)
  } catch (e) {
    console.warn('Unable to save locale preference:', e)
  }
}

// Mount the app
app.mount('#app')

// Log active locale after mount (development only)
if (process.env.NODE_ENV === 'development') {
  console.log("Active locale (after mount):", i18n.global.locale)
}
