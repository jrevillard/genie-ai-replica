const js = require('@eslint/js');
const pluginVue = require('eslint-plugin-vue');
const prettierConfig = require('eslint-config-prettier');
const globals = require('globals');
const sharedRules = require('../shared/eslint-rules-base');

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
    rules: {
      ...sharedRules,
    },
  },
  {
    files: ['**/__tests__/**/*.js', '**/*.test.js'],
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
