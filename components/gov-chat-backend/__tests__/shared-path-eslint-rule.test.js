'use strict';

require('./setup-env');

const { RuleTester } = require('eslint');
const rule = require('../../shared/eslint-rules/no-runtime-unresolvable-shared-path');

// The rule this replaces (`no-restricted-imports` with a `patterns.group`
// glob) asserted a protection it never provided: `no-restricted-imports`
// reads ESM `import` declarations, and this repo is CommonJS throughout,
// so a `require('../shared/lib/…')` sailed past lint. This suite pins the
// behaviour of the replacement so it cannot quietly regress into a no-op
// the same way.
const ruleTester = new RuleTester({
  languageOptions: { ecmaVersion: 'latest', sourceType: 'script' }
});

ruleTester.run('no-runtime-unresolvable-shared-path', rule, {
  valid: [
    // The Docker-correct spelling, at any depth — the barrel…
    "const { logger } = require('../shared-lib');",
    // …and a deep path (deep is fine; only the /lib/ segment is not).
    "const { parsePositiveInt } = require('../shared-lib/validation-utils');",
    "const { VictoriaLogsClient } = require('../../shared-lib/melt');",
    // A different `shared/` directory must not be caught.
    "const { isValidDateStr } = require('./shared/url');",
    "const base = require('../shared/eslint-rules-base');",
    // Non-literal and non-require calls are out of scope.
    'const mod = require(path);',
    // An ESM import of a shared/lib path is not this rule's business —
    // it guards CJS require, which is the only spelling this repo ships.
    {
      code: "import x from '../shared/lib/logger.js';",
      languageOptions: { sourceType: 'module' }
    },
    // Computed member access is not a require call.
    "obj.require('../shared/lib/logger');"
  ],
  invalid: [
    {
      code: "const { logger } = require('../shared/lib/logger');",
      errors: [{ messageId: 'noRuntimeUnresolvable' }]
    },
    {
      // The barrel spelled with /lib/ — same runtime failure, shallower call site.
      code: "const { dbService } = require('../shared/lib');",
      errors: [{ messageId: 'noRuntimeUnresolvable' }]
    },
    {
      code: "const { VictoriaLogsAdapter } = require('../../shared/lib/melt/victorialogs-client');",
      errors: [{ messageId: 'noRuntimeUnresolvable' }]
    },
    {
      // The exact shape that shipped on this branch and crashed at runtime
      // with MODULE_NOT_FOUND while every unit test stayed green.
      code: "const { withBackgroundSpan } = require('../shared/lib/tracing-background');",
      errors: [{ messageId: 'noRuntimeUnresolvable' }]
    }
  ]
});

describe('the rule is wired into each component eslint config', () => {
  const fs = require('fs');
  const path = require('path');
  const components = ['gov-chat-backend', 'document-repository', 'gov-chat-frontend'];

  // The config files are read as TEXT, not `require`d. Loading the
  // frontend's config pulls in eslint-plugin-vue, which is not in the
  // backend's dependency closure — the require works on a developer
  // machine with a hoisted node_modules and fails in CI, where each
  // component installs its own. Asserting on the source keeps the check
  // independent of that.
  const readConfig = (component) =>
    fs.readFileSync(path.resolve(__dirname, '../../', component, 'eslint.config.js'), 'utf8');

  it.each(components)('%s enables the rule as an error', (component) => {
    const src = readConfig(component);
    expect(src).toContain("'local/no-runtime-unresolvable-shared-path': 'error'");
    expect(src).toContain("require('../shared/eslint-plugins')");
  });

  it.each(components)('%s exempts its test files', (component) => {
    const src = readConfig(component);
    expect(src).toContain("'local/no-runtime-unresolvable-shared-path': 'off'");
  });

  it('no component disables the rule globally', () => {
    for (const component of components) {
      const occurrences = readConfig(component).split("'local/no-runtime-unresolvable-shared-path'").length - 1;
      expect(occurrences).toBe(2); // one 'error', one 'off'
    }
  });
});
