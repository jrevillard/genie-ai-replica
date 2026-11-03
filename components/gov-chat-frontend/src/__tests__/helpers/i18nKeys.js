'use strict';

/**
 * Shared i18n key-extraction primitives for the three contract suites
 * (localeConsistency, okf-surface-i18n-contract, okf-laberrors-contract —
 * review 84591: three private copies of the same extraction stack had to
 * agree by discipline; now they agree by import).
 */

/** All leaf paths of a locale tree, dot-joined. */
function flattenKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) keys.push(...flattenKeys(v, p));
    else keys.push(p);
  }
  return keys;
}

/** Dotted-path lookup that treats null/undefined misses the same. */
function deepGet(o, dotted) {
  return dotted.split('.').reduce((a, k) => (a == null ? undefined : a[k]), o);
}

module.exports = { flattenKeys, deepGet };
