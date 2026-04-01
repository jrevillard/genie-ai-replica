// Jest setup — silence vue-i18n and other global warnings in tests
global.console = {
  ...console,
  warn: jest.fn(),
  debug: jest.fn()
};

// Mock window.APP_CONFIG for tests that don't override it
global.window = global.window || {};
window.APP_CONFIG = window.APP_CONFIG || {};
