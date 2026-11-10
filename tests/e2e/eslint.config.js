// ESLint 10 flat config for the Playwright E2E suite. The point of this
// gate is `no-undef`: an undeclared binding inside a page.evaluate
// argument (the defect class behind issue #1632, where a destructured
// name was read one loop over from where it was bound) throws minutes
// into a venue run — here it dies at lint time, in seconds.
//
// Specs and helpers import `test`/`expect` explicitly from
// @playwright/test, so no test globals are declared. The two runtime
// sets are: Node (CommonJS `require`, `process`, `__dirname` — the
// suite and helpers) and browser (`document`, `window`,
// `getComputedStyle` — the code that runs inside page.evaluate).
//
// Known boundary: the Node and browser globals are merged into one
// pool, so a Node-only global used inside a page.evaluate callback (or
// a browser global in Node-side helper code) is NOT flagged — the
// evaluate bodies are inline in the same file, and per-scope globals
// would need a dedicated rule that knows the evaluate boundary. The
// gate's target is the #1632 class: a binding declared NOWHERE, which
// no-undef still catches from the merged pool.
//
// Stylistic rules stay out: the suite has no Prettier gate, so
// formatting rules would only fight the existing files.
const js = require('@eslint/js');
const globals = require('globals');
const sharedRules = require('../../components/shared/eslint-rules-base');

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'script',
      globals: {
        ...globals.node,
        ...globals.browser
      }
    },
    rules: {
      ...sharedRules
    }
  },
  {
    ignores: ['fixtures/']
  }
];
