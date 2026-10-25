// Test stub for src/i18n — the real module loads locales through
// webpack's require.context, which Jest cannot execute. Consumers that
// reach for the i18n instance from non-component code (the conversation
// store's t() helper) only need te/t; te returning false routes every
// lookup to the caller's fallback string, which is what the store tests
// assert against.
const i18n = {
  global: {
    te: () => false,
    t: (key) => key,
    locale: 'en'
  }
};

export default i18n;
