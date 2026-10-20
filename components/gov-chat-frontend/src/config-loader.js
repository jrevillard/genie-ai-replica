// Configuration loader and theme application.
//
// Splits the config object from the loadConfig function out of main.js so
// unit tests can import loadConfig without dragging in Vue, Vuex,
// ApexCharts, and the top-level await mount sequence in main.js. main.js
// imports loadConfig from this module — no runtime behavior change.

import Ajv from 'ajv';

// The asset keys the decorative layer knows how to use. An explicit list
// rather than Object.entries(), so a typo in a config becomes an ignored
// key instead of an inert --visual-<typo> property nobody can trace.
const VISUAL_ASSET_KEYS = ['hero', 'waves', 'mesh', 'corner'];

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

/**
 * The fetched document is both the instance and its own schema: it carries
 * `properties` at the top level alongside its own data, and `$schema` is
 * only the draft identifier. Validating therefore means running the
 * document's schema over the document itself.
 *
 * A document with no `$schema` cannot be checked and is accepted as-is —
 * a schema-less config is a legacy config, not a broken one.
 */
const validateConfig = (data) => {
  if (!data || typeof data !== 'object' || !data.properties) return true;

  let validate;
  try {
    validate = new Ajv({ allErrors: true, strict: false }).compile(data);
  } catch (error) {
    throw new Error(`genie-ai-config.json carries an unusable $schema: ${error.message}`, {
      cause: error
    });
  }

  if (validate(data)) return true;

  const details = (validate.errors || [])
    .map((issue) => `  ${issue.instancePath || '<root>'} ${issue.message}`)
    .join('\n');
  throw new Error(`genie-ai-config.json failed schema validation:\n${details}`);
};

async function loadConfig() {
  let data = null;
  try {
    const response = await fetch('/config/genie-ai-config.json');
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    data = await response.json();
  } catch (error) {
    // A transport failure is not a configuration failure. The bundled
    // defaults are a correct fallback, so the app still boots.
    console.error('Error loading config:', error);
  }

  if (data) {
    // Outside the try/catch on purpose: an invalid config is an operator
    // error, not a transient fetch failure, and must not be swallowed.
    // main.js awaits loadConfig() before createApp(), so throwing leaves
    // the app unmounted and the error visible in the console.
    validateConfig(data);
    config = { ...config, ...data };
  }

  const root = document.documentElement;
  const theme = config.theme || {};
  root.style.setProperty('--brand', theme.brandColor || defaults.theme.brandColor);

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

  if (theme.visual) {
    root.dataset.visual = theme.visual.enabled === false ? 'off' : 'on';
    for (const key of VISUAL_ASSET_KEYS) {
      const value = theme.visual.assets?.[key];
      if (value) root.style.setProperty(`--visual-${key}`, `url("${value}")`);
    }
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
