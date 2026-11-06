// Jest setup — silence vue-i18n and other global warnings in tests
global.console = {
  ...console,
  warn: jest.fn(),
  debug: jest.fn(),
  error: jest.fn()
};

// Mock window.APP_CONFIG for tests that don't override it
global.window = global.window || {};
window.APP_CONFIG = window.APP_CONFIG || {};

// jsdom does not implement window.matchMedia — and ThemeManager.js calls it
// at MODULE LOAD (detectInitialTheme runs on import). Without the stub, any
// suite that imports a component touching the theme fails to run at all with
// "window.matchMedia is not a function" — a test-infra failure that looks
// like a product failure. The stub answers the dark-mode query the app asks.
if (typeof window.matchMedia !== 'function') {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false
  });
}
