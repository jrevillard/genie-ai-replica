/**
 * ESLint rule: forbid `require()` paths that Jest resolves but the
 * container cannot.
 *
 * The Dockerfiles do `COPY shared/lib ./shared-lib` — the `/lib/`
 * segment is dropped on purpose, so the only directory that exists at
 * runtime is `shared-lib`. Jest hides this: its `moduleNameMapper`
 * entry rewrites `shared-lib/...` to `<rootDir>/../shared/lib/...`, so
 * a source-tree require of `shared/lib/...` also resolves under test and
 * the mismatch only surfaces as `MODULE_NOT_FOUND` in a live container.
 *
 * That is exactly how a `require('../shared/lib/tracing-background')`
 * shipped on a branch whose unit tests were green. The unit tests proved
 * the source tree; nothing proved the image.
 *
 * So the rule is NOT "no deep imports" — depth is irrelevant, since
 * `shared-lib/deep/thing.js` resolves fine at runtime. It is "no
 * `shared/lib`", the one spelling that exists on disk during test and
 * vanishes in the image.
 *
 * Test files are exempt: under Jest the source tree IS the truth, so
 * `require('../../shared/lib/logger')` in a spec is correct and
 * deliberate. Each component's eslint.config.js turns the rule off for
 * its `__tests__` directory.
 */

'use strict';

module.exports = {
  meta: {
    type: 'problem',
    docs: {
      description:
        'disallow require() of shared/lib/… — it resolves under Jest but not in the container image'
    },
    schema: [],
    messages: {
      noRuntimeUnresolvable: "{{p}} resolves in Jest but not in the image. " +
        'The Dockerfile copies shared/lib to shared-lib, dropping the /lib/ segment — ' +
        "use require('.../shared-lib/...') instead (the Jest moduleNameMapper maps it back)."
    }
  },

  create(context) {
    return {
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'require') return;
        const arg = node.arguments[0];
        if (!arg || arg.type !== 'Literal' || typeof arg.value !== 'string') return;
        // Matches `shared/lib` and `shared/lib/x`; deliberately does not
        // match `shared-lib` (different string, different directory).
        if (!/(^|\/)shared\/lib(\/|$)/.test(arg.value)) return;
        context.report({ node: arg, messageId: 'noRuntimeUnresolvable', data: { p: arg.value } });
      }
    };
  }
};
