/**
 * Shared ESLint rules for GENIE.AI components.
 * Each component's eslint.config.js should spread these into its rules object.
 */
module.exports = {
  'no-var': 'error',
  'prefer-const': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  // Ban deep imports of shared/lib/* internals. Consumers MUST go through the
  // shared-lib barrel (Docker COPY 'shared/lib' virtual mount; Jest moduleNameMapper).
  // Failing this rule = latent prod crash (routes destructure symbols from 'shared-lib'
  // but the barrel didn't expose them — see Story 7-3 inlining). Story 7-4 lint guard.
  // Negation patterns ('!**/...') ARE supported in `patterns.group` (NOT in `paths.group`).
  'no-restricted-imports': ['error', {
    patterns: [{
      group: ['**/shared/lib/**', '!**/shared/lib/index.js', '!**/__tests__/**', '!**/__mocks__/**'],
      message: "Import the shared lib via the shared-lib barrel (e.g. require('../shared-lib')), not via deep paths like require('../shared/lib/logger'). Tests may deep-import freely (Jest moduleNameMapper + virtual mocks). See Story 7-4."
    }]
  }],
};