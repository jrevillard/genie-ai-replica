const js = require('@eslint/js');
const prettierConfig = require('eslint-config-prettier');
const globals = require('globals');
const sharedRules = require('../eslint-rules-base');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.node
      }
    },
    rules: {
      ...sharedRules
    }
  },
  {
    files: ['**/tests/**/*.js', '**/*.test.js'],
    languageOptions: {
      globals: {
        ...globals.jest
      }
    }
  },
  {
    ignores: ['node_modules/']
  },
  prettierConfig
];
