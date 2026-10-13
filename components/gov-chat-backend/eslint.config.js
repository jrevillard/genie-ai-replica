const js = require('@eslint/js');
const prettierConfig = require('eslint-config-prettier');
const globals = require('globals');
const sharedRules = require('../shared/eslint-rules-base');
const sharedPlugins = require('../shared/eslint-plugins');

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
    plugins: { local: sharedPlugins },
    rules: {
      ...sharedRules,
      'local/no-runtime-unresolvable-shared-path': 'error'
    }
  },
  {
    files: ['**/__tests__/**/*.js', '**/*.test.js'],
    // Under Jest the source tree is what resolves, so `shared/lib/...`
    // is correct in a spec. The guard only applies to shipped code.
    rules: { 'local/no-runtime-unresolvable-shared-path': 'off' },
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
