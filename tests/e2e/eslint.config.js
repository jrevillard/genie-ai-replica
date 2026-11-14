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
    // Node + browser runtime: the suite and helpers — the evaluate bodies
    // are inline in the same file, so both pools apply (see the boundary
    // note above). The glob carries .mjs/.cjs too (#1821): an ESM or CJS
    // file landing in the tree must take the merged pool, not probe browser
    // globals against no-undef alone. Boundary: this entry pins
    // sourceType 'script', so a file with real ESM syntax (import/export)
    // parse-errors loudly instead of taking the pool — the tree is CJS
    // today; a genuine .mjs needs its own entry added with it, and the
    // parse error is the deliberate signal, never a silent hole.
    files: ['**/*.js', '**/*.mjs', '**/*.cjs'],
    // The suite's own Playwright config at the repository ROOT runs in Node
    // only: a browser global there is a ReferenceError at config load, so
    // it takes the Node-only entry below instead of this one (#1716).
    // Measured on ESLint 10.14: with an explicit --config the entries
    // anchor to the invocation's cwd. Both silencing modes are
    // warning-based and die only through the gate's --max-warnings 0:
    // a file outside the base path is reported as a warning (exit 0
    // bare, exit 1 with the flag), and so is a file matched but
    // ignore-excluded. Exit 2 is the structural mode: a target that
    // matches nothing at all (the pinned command's relative path from a
    // different cwd). A silencing refactor (a hoisted global ignore, a
    // base-path drift, or dropping the flag) therefore fails CI instead
    // of passing green while nothing is linted. Moving this config FILE
    // changes nothing about what the entries match — they anchor to the
    // invocation's cwd; what breaks instead is the --config path in
    // lint:playwright-config and the read path of the pin that reads
    // this file, and until those are re-spelled the gate exits 2 and
    // the suite fails.
    ignores: ['playwright.config.js'],
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
    // Node-only runtime: the suite's Playwright config (see above).
    files: ['playwright.config.js'],
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
    ignores: ['fixtures/']
  }
];
