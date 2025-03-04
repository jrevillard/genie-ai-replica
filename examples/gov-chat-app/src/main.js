/*****************************************************************************************************
 * main.js
 * 
 * Full file, including:
 * - Importing your App.vue, router, and i18n.js
 * - Forcing the locale to "sw" (or change it to "en"/"fr" if you want)
 * - Logging all messages for each locale
 * - Logging the active locale before and after mount
 * 
 * Nothing else is changed except these debug statements.
 *****************************************************************************************************/

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import i18n from './i18n.js'

// 1) Force the locale to "sw" for debugging. 
//    Change it to "en" or "fr" if you prefer.
i18n.global.locale = 'sw'

// 2) Log the entire messages for "en", "fr", and "sw".
console.log("All messages in 'en':", i18n.global.getLocaleMessage('en'))
console.log("All messages in 'fr':", i18n.global.getLocaleMessage('fr'))
console.log("All messages in 'sw':", i18n.global.getLocaleMessage('sw'))

// 3) Check which locale is active now
console.log("Active locale (forced):", i18n.global.locale)

// 4) Create the Vue app
const app = createApp(App)

// 5) Use router + i18n (if you have a router)
app.use(router)
app.use(i18n)

// 6) Mount the app
app.mount('#app')

// 7) (Optional) Log the active locale after mount
console.log("Active locale (after mount):", i18n.global.locale)

