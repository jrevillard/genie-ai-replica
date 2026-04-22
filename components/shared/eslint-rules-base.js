/**
 * Shared ESLint rules for GENIE.AI components.
 * Each component's eslint.config.js should spread these into its rules object.
 */
module.exports = {
  'no-var': 'error',
  'prefer-const': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
};
