/**
 * Shared ESLint rules for GENIE.AI components.
 * Each component's eslint.config.js should spread these into its rules object.
 */
module.exports = {
  'no-var': 'error',
  'prefer-const': 'error',
  'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
  // The shared/lib path guard used to live here as
  // `no-restricted-imports` with a `patterns.group` glob. That rule
  // cannot work in this codebase: `no-restricted-imports` inspects ESM
  // `import` declarations only, and this repo is CommonJS throughout.
  // Verified on ESLint 10 — the same glob that flags
  // `import x from '../shared/lib/logger.js'` stays silent on
  // `require('../shared/lib/logger')`, and the same holds for `paths:`
  // and for a literal-substring pattern. It sat here asserting a
  // protection it did not provide.
  //
  // The working rule is `local/no-runtime-unresolvable-shared-path`,
  // registered via `../shared/eslint-plugins` and enabled by each
  // component's eslint.config.js (off under `__tests__`, where the
  // source tree is the resolution truth).
};
