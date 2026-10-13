/**
 * Flat-config plugin bundle for GENIE.AI components.
 *
 * Spread into a component's `plugins: { local: … }` so the local rules
 * in `./eslint-rules/` are addressable as `local/<rule-name>`.
 */
'use strict';

const noRuntimeUnresolvableSharedPath = require('./eslint-rules/no-runtime-unresolvable-shared-path');

module.exports = {
  rules: {
    'no-runtime-unresolvable-shared-path': noRuntimeUnresolvableSharedPath
  }
};
