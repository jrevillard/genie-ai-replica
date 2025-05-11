/*****************************************************************************************************
 * main.js
 * 
 * Full file, including:
 * - Importing your App.vue, router, i18n.js, and store
 * - Setting up locale based on user preference or browser
 * - Logging all messages for each locale (only in development mode)
 * - Logging the active locale before and after mount
 * - Theme system integration - FIXED to ensure Light theme is default
 *****************************************************************************************************/

import { createApp } from 'vue'
import App from './App.vue'
import router from './router'
import i18n from './i18n'
import store from './store' // Import the Vuex store
import FileDialogSafe from './fileDialogSafe' // Import our custom directive
import '@fortawesome/fontawesome-free/css/all.min.css';

import VueApexCharts from 'vue3-apexcharts'
import './text-fix.css'

// Import theme CSS files
import './theme-variables.css'
import './theme-components.css'

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

const savedLanguage = localStorage.getItem('userLocale');
if (savedLanguage && i18n) {
  i18n.locale = savedLanguage;
  document.documentElement.setAttribute('lang', savedLanguage);
}

// Global language change handler
window.addEventListener('languageChanged', (event) => {
  if (event.detail && event.detail.language) {
    // Force reload the page when language changes from settings
    // This ensures all components get the new translations
    window.location.reload();
  }
});

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

// Set the locale directly as a string (not as a ref)
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

// Initialize theme system BEFORE creating the app
const initializeTheme = () => {
  // ALWAYS default to light theme unless explicitly saved as something else
  let theme = 'light';
  
  try {
    // Check localStorage for saved theme preference
    const savedTheme = localStorage.getItem('theme');
    
    // Only use saved theme if it exists and is valid
    if (savedTheme && ['light', 'dark', 'system'].includes(savedTheme)) {
      theme = savedTheme;
    }
    
    // Apply theme to both HTML and BODY elements to ensure it cascades properly
    document.documentElement.setAttribute('data-theme', theme);
    document.body.setAttribute('data-theme', theme);
    
    console.log('Theme initialized to:', theme);
    
    // Initialize font size if saved
    const fontSize = localStorage.getItem('fontSize');
    if (fontSize) {
      document.documentElement.style.fontSize = `${parseInt(fontSize) / 50}rem`;
    }
  } catch (e) {
    console.warn('Error initializing theme, defaulting to light theme:', e);
    document.documentElement.setAttribute('data-theme', 'light');
    document.body.setAttribute('data-theme', 'light');
  }
};

// Run theme initialization immediately
initializeTheme();

// Create the Vue app
const app = createApp(App)

// Use router, i18n, and store
app.use(router)
app.use(i18n)
app.use(store) // Register the Vuex store
app.use(FileDialogSafe) // Register our custom directive
app.use(VueApexCharts)

// Create a global method for changing locale
app.config.globalProperties.$setLocale = function(locale) {
  i18n.global.locale = locale
  try {
    localStorage.setItem('userLocale', locale)
  } catch (e) {
    console.warn('Unable to save locale preference:', e)
  }
  
  // Update HTML lang attribute for accessibility
  document.documentElement.setAttribute('lang', locale)
}

// Mount the app
app.mount('#app')

// Log active locale after mount (development only)
if (process.env.NODE_ENV === 'development') {
  console.log("Active locale (after mount):", i18n.global.locale)
}

// Function to set the actual viewport height as a CSS variable
function setViewportHeight() {
  // Get the actual viewport height
  const vh = window.innerHeight * 0.01;
  // Set the value as a CSS variable
  document.documentElement.style.setProperty('--window-height', `${window.innerHeight}px`);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  // Set initial height
  setViewportHeight();
  
  // Update on resize
  window.addEventListener('resize', setViewportHeight);
  
  // For iOS devices, use VisualViewport API if available
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      // Update the CSS variable with the visual viewport height
      document.documentElement.style.setProperty('--window-height', `${window.visualViewport.height}px`);
      
      // Check if keyboard is likely open (viewport significantly smaller)
      const heightDifference = window.innerHeight - window.visualViewport.height;
      const isKeyboardOpen = heightDifference > 150;
      
      // Add/remove class from body
      if (isKeyboardOpen) {
        document.body.classList.add('keyboard-open');
      } else {
        document.body.classList.remove('keyboard-open');
      }
    });
  }
});

// Helper function to detect iOS devices
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

// Add iOS-specific class if needed
if (isIOS()) {
  document.documentElement.classList.add('ios-device');
}

// Add this code to your main.js file or create a separate file and import it

// Function to handle Android keyboard behavior
const handleAndroidKeyboard = () => {
  // Detect Android devices
  const isAndroid = /Android/i.test(navigator.userAgent);
  
  if (!isAndroid) return;
  
  // Add Android flag to document
  document.documentElement.classList.add('android-device');
  
  // Store initial window height
  const initialWindowHeight = window.innerHeight;
  
  // Listen for resize events to detect keyboard
  window.addEventListener('resize', () => {
    const currentHeight = window.innerHeight;
    const heightDifference = initialWindowHeight - currentHeight;
    
    // If height difference is significant, keyboard is likely open
    if (heightDifference > 150) {
      document.documentElement.classList.add('keyboard-open');
      
      // Set CSS variable for keyboard height
      document.documentElement.style.setProperty('--keyboard-height', `${heightDifference}px`);
      document.documentElement.style.setProperty('--visible-height', `${currentHeight}px`);
    } else {
      document.documentElement.classList.remove('keyboard-open');
      document.documentElement.style.removeProperty('--keyboard-height');
      document.documentElement.style.removeProperty('--visible-height');
    }
  });
  
  // Add listener for input focus/blur
  document.addEventListener('focusin', (event) => {
    // Only handle input and textarea elements
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
      document.documentElement.classList.add('input-focused');
    }
  });
  
  document.addEventListener('focusout', (event) => {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
      // Use timeout to ensure keyboard is fully closed
      setTimeout(() => {
        document.documentElement.classList.remove('input-focused');
      }, 300);
    }
  });
};

// Initialize when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  handleAndroidKeyboard();
});