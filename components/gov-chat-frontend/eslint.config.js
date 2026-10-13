const js = require('@eslint/js');
const pluginVue = require('eslint-plugin-vue');
const prettierConfig = require('eslint-config-prettier');
const globals = require('globals');
const sharedRules = require('../shared/eslint-rules-base');
const sharedPlugins = require('../shared/eslint-plugins');

module.exports = [
  js.configs.recommended,
  ...pluginVue.configs['flat/recommended'],
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: { local: sharedPlugins },
    rules: {
      ...sharedRules,
      'local/no-runtime-unresolvable-shared-path': 'error',
    },
  },
  {
    files: ['**/__tests__/**/*.js', '**/*.test.js'],
    // Under Jest the source tree is what resolves, so `shared/lib/...`
    // is correct in a spec. The guard only applies to shipped code.
    rules: { 'local/no-runtime-unresolvable-shared-path': 'off' },
    languageOptions: {
      globals: {
        ...globals.jest,
      },
    },
  },
  {
    ignores: ['node_modules/', 'dist/', '*.config.js', 'vue.config.js'],
  },
  prettierConfig,
];
