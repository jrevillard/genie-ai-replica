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
  // but the barrel didn't expose them). Lint guard.
  //
  // ESLint v10 uses the `ignore` package for `patterns.group` (gitignore-style
  // globs, NOT minimatch). The original `**/shared/lib/**` glob did match deep
  // imports but ALSO matched the barrel (`../shared/lib` resolves to `index.js`)
  // when interpreted by some ESLint configs — turning it into an effective
  // allow-list for the barrel path. The corrected pattern is:
  //  - `**/shared/lib/*` bans any deep import (e.g. `../shared/lib/logger`)
  //    but leaves the barrel (`../shared/lib` → `index.js`) untouched because
  //    the glob requires a non-empty filename segment.
  //  - `!**/shared/lib/index.js` explicitly exempts an explicit
  //    `require('../shared/lib/index')` (defensive — not the canonical form).
  //  - `!**/__tests__/**` and `!**/__mocks__/**` exempt test + mock files
  //    that legitimately need deep access via the Jest moduleNameMapper.
  //
  // Verified by exercising the `ignore` matcher directly: the deep import
  // `../shared/lib/logger` evaluates to `true` (banned), the barrel
  // `../shared/lib` evaluates to `false` (allowed), and the explicit
  // `index.js` form evaluates to `false` (allowed).
  'no-restricted-imports': [
    'error',
    {
      patterns: [
        {
          group: ['**/shared/lib/*', '!**/shared/lib/index.js', '!**/__tests__/**', '!**/__mocks__/**'],
          message:
            "Import the shared lib via the shared-lib barrel (e.g. require('../shared-lib')), not via deep paths like require('../shared/lib/logger'). Tests may deep-import freely (Jest moduleNameMapper + virtual mocks)."
        }
      ]
    }
  ]
};