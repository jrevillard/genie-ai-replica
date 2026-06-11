const js = require('@eslint/js');
const prettierConfig = require('eslint-config-prettier');
const globals = require('globals');
const sharedRules = require('../shared/eslint-rules-base');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.node,
        AbortController: 'readonly'
      }
    },
    rules: {
      ...sharedRules
    }
  },
  {
    files: ['**/__tests__/**/*.js', '**/*.test.js'],
    languageOptions: {
      globals: {
        ...globals.jest
      }
    }
  },
  {
    ignores: ['node_modules/', 'uploads/', 'logs/', '*.log', 'coverage/', 'dist/', '.env', '.env.*']
  },
  prettierConfig
];
