// Configuration loader and theme application.
//
// Splits the config object from the loadConfig function out of main.js so
// unit tests can import loadConfig without dragging in Vue, Vuex,
// ApexCharts, and the top-level await mount sequence in main.js. main.js
// imports loadConfig from this module — no runtime behavior change.

const defaults = {
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

let config = { ...defaults };

async function loadConfig() {
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

  // Set favicon from config if available
  if (config.app?.icon?.type === 'file' && config.app.icon.value) {
    const favicon32 = document.querySelector('link[sizes="32x32"]');
    const favicon16 = document.querySelector('link[sizes="16x16"]');
    const appleTouch = document.querySelector('link[sizes="180x180"]');
    const iconPath = config.app.icon.value;
    if (favicon32) favicon32.href = iconPath;
    if (favicon16) favicon16.href = iconPath;
    if (appleTouch) appleTouch.href = iconPath;
  }

  return config;
}

export { loadConfig as default };
export { config };