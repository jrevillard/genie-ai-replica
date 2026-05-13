/*****************************************************************************************************
 * main.js
 *
 * Full file, including:
 * - Importing your App.vue, router, i18n.js, and store
 * - Setting up locale based on user preference or browser
 * - Logging all messages for each locale (only in development mode)
 * - Logging the active locale before and after mount
 * - Theme system integration - Synchronized with ThemeManager.js
 * - Loading genie-ai-config.json from /config folder for GENIE.AI framework customization
 *****************************************************************************************************/

import { createApp } from 'vue';
import App from './App.vue';
import router from './router';
import i18n from './i18n';
import store from './store'; // Import the Vuex store
import FileDialogSafe from './fileDialogSafe'; // Import our custom directive

import VueApexCharts from 'vue3-apexcharts';
import ApexCharts from 'apexcharts';
// Import theme CSS files
import './theme-variables.css';
import './theme-components.css';
import './charts-apex-overrides.css';

// Fetch configuration for GENIE.AI framework with fallback defaults
let config = {
  app: {
    title: 'GENIE.AI',
    icon: { type: 'file', value: '/config/logo-genie-ai.jpeg' }
  },
  theme: {
    brandColor: '#4071cb'
  },
  features: {
    chat: {
      welcomeMessage: 'Welcome to GENIE.AI',
      botName: 'GENIE.AI'
    }
  },
  custom: {}
};
export async function loadConfig() {
  try {
    const response = await fetch('/config/genie-ai-config.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const data = await response.json();
    config = { ...config, ...data };
  } catch (error) {
    console.error('Error loading config:', error);
  }

  const root = document.documentElement;
  const theme = config.theme || {};
  root.style.setProperty('--brand', theme.brandColor || '#4071cb');

  if (theme.bg) {
    root.style.setProperty('--config-bg', theme.bg);
  }
  if (theme.fg) {
    root.style.setProperty('--config-fg', theme.fg);
  }
  if (theme.navbar?.background) {
    root.style.setProperty('--navbar-bg', theme.navbar.background);
  }
  if (theme.navbar?.text) {
    root.style.setProperty('--navbar-fg', theme.navbar.text);
  }
  if (theme.colors) {
    ['success', 'warning', 'danger', 'info'].forEach((key) => {
      if (theme.colors[key]) root.style.setProperty(`--${key}`, theme.colors[key]);
    });
  }
  if (theme.typography?.fontFamily) {
    root.style.setProperty('--font-body', theme.typography.fontFamily);
    root.style.setProperty('--font-display', theme.typography.fontFamily);
  }
  if (theme.typography?.fontScale) {
    root.style.setProperty('--font-scale', String(theme.typography.fontScale));
  }

  return config;
}

// Initialize configuration before app creation to ensure it's available globally
await loadConfig();

// Determine the initial locale - prioritize:
// 1. Previously saved user preference
// 2. Browser language
// 3. Default to 'en'
const getSavedLocale = () => {
  try {
    return localStorage.getItem('userLocale');
  } catch {
    return null;
  }
};

const savedLanguage = localStorage.getItem('userLocale');
if (savedLanguage && i18n) {
  i18n.locale = savedLanguage;
  document.documentElement.setAttribute('lang', savedLanguage);
}

const getBrowserLocale = () => {
  // Get browser language (e.g. 'en-US' -> 'en')
  const browserLang = navigator.language || navigator.userLanguage;
  const shortLang = browserLang.split('-')[0];

  // Check if we support this language
  const supportedLocales = ['en', 'fr', 'sw'];
  return supportedLocales.includes(shortLang) ? shortLang : null;
};

// Set the initial locale based on our prioritization logic
const savedLocale = getSavedLocale();
const browserLocale = getBrowserLocale();
const initialLocale = savedLocale || browserLocale || 'en';

// Set the locale directly as a string (not as a ref)
i18n.global.locale = initialLocale;

// ThemeManager singleton handles initial theme detection and DOM application
// (initialized at import time via its constructor)
// Just ensure saved font size is applied
try {
  const fontSize = localStorage.getItem('fontSize');
  if (fontSize) {
    document.documentElement.style.fontSize = `${parseInt(fontSize) / 50}rem`;
  }
} catch {
  // Silently fail - font size is optional
}

// Create the Vue app
const app = createApp(App);

// Make config available globally for GENIE.AI framework customization (e.g., title, icon, navbar colors)
app.config.globalProperties.$config = config;

// Use router, i18n, and store
app.use(router);
app.use(i18n);
app.use(store); // Register the Vuex store
app.use(FileDialogSafe); // Register our custom directive
app.use(VueApexCharts);

// Global ApexCharts defaults — use DS tokens, disable built-in noData placeholder
window.ApexCharts = window.ApexCharts || {};
ApexCharts.defaults = {
  theme: { mode: 'light', palette: 'palette1' },
  chart: {
    foreColor: 'var(--fg)',
    background: 'transparent',
    fontFamily: 'var(--font-body)',
    toolbar: { show: false },
    animations: { enabled: false },
    noData: {
      text: '',
      align: 'center',
      verticalAlign: 'middle',
      style: { fontSize: '14px' }
    }
  },
  tooltip: { theme: 'dark' },
  grid: { borderColor: 'var(--border)', strokeDashArray: 0 },
  xaxis: {
    axisBorder: { color: 'var(--border)' },
    axisTicks: { color: 'var(--border)' },
    labels: { style: { colors: 'var(--fg)' } }
  },
  yaxis: {
    axisBorder: { color: 'var(--border)' },
    labels: { style: { colors: 'var(--fg)' } }
  },
  legend: { labels: { colors: 'var(--fg)' } }
};

// Create a global method for changing locale
app.config.globalProperties.$setLocale = function (locale) {
  i18n.global.locale = locale;
  try {
    localStorage.setItem('userLocale', locale);
  } catch {
    // Silently fail - locale preference is optional
  }

  // Update HTML lang attribute for accessibility
  document.documentElement.setAttribute('lang', locale);
};

// Mount the app
app.mount('#app');

// Function to set the actual viewport height as a CSS variable
function setViewportHeight() {
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

      // Add/remove class
      if (document.body) {
        if (isKeyboardOpen) {
          document.body.classList.add('keyboard-open');
        } else {
          document.body.classList.remove('keyboard-open');
        }
      }
    });
  }
});

// Helper function to detect iOS devices
function isIOS() {
  return (
    /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
  );
}

// Add iOS-specific class if needed
if (isIOS() && document.documentElement) {
  document.documentElement.classList.add('ios-device');
}

// Function to handle Android keyboard behavior
const handleAndroidKeyboard = () => {
  // Detect Android devices
  const isAndroid = /Android/i.test(navigator.userAgent);

  if (!isAndroid) return;

  // Add Android flag to document
  if (document.documentElement) {
    document.documentElement.classList.add('android-device');
  }

  // Store initial window height
  const initialWindowHeight = window.innerHeight;

  // Listen for resize events to detect keyboard
  window.addEventListener('resize', () => {
    const currentHeight = window.innerHeight;
    const heightDifference = initialWindowHeight - currentHeight;

    // If height difference is significant, keyboard is likely open
    if (heightDifference > 150 && document.documentElement) {
      document.documentElement.classList.add('keyboard-open');

      // Set CSS variable for keyboard height
      document.documentElement.style.setProperty('--keyboard-height', `${heightDifference}px`);
      document.documentElement.style.setProperty('--visible-height', `${currentHeight}px`);
    } else if (document.documentElement) {
      document.documentElement.classList.remove('keyboard-open');
      document.documentElement.style.removeProperty('--keyboard-height');
      document.documentElement.style.removeProperty('--visible-height');
    }
  });

  document.addEventListener('focusin', (event) => {
    // Only handle input and textarea elements
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
      if (document.documentElement) {
        document.documentElement.classList.add('input-focused');
      }
    }
  });

  document.addEventListener('focusout', (event) => {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
      // Use timeout to ensure keyboard is fully closed
      setTimeout(() => {
        if (document.documentElement) {
          document.documentElement.classList.remove('input-focused');
        }
      }, 300);
    }
  });
};

// Initialize when the DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  handleAndroidKeyboard();
});
