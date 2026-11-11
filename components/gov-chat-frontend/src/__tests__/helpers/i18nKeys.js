'use strict';

const fs = require('fs');
const path = require('path');

/**
 * Shared i18n key-extraction primitives for the contract suites
 * (localeConsistency, okf-surface-i18n-contract, admin-surface-i18n-contract,
 * okf-laberrors-contract — review 84591: three private copies of the same
 * extraction stack had to agree by discipline; now they agree by import).
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

/**
 * Files under a surface spec: a file path is returned as-is; a directory is
 * walked recursively for .vue/.js files (missing paths are skipped, so a
 * surface that has not shipped yet is not an error).
 */
function filesUnder(src, p, acc = []) {
  const full = path.join(src, p);
  if (!fs.existsSync(full)) return acc;
  if (fs.statSync(full).isFile()) {
    acc.push(full);
    return acc;
  }
  for (const e of fs.readdirSync(full, { withFileTypes: true })) {
    const f = path.join(full, e.name);
    if (e.isDirectory()) filesUnder(src, path.relative(src, f), acc);
    else if (/\.(vue|js)$/.test(e.name)) acc.push(f);
  }
  return acc;
}

/**
 * Every catalogue key referenced through a LITERAL translate()/$t() call in
 * the given files, as a Map key -> `file:line` of its first reference.
 * Comments are stripped before scanning (a commented-out call site is not a
 * live reference — the same rule localeConsistency applies), so all suites
 * that share this helper count the same call sites. The pattern decides the
 * namespace: pass /(translate|\$t)\(\s*['"`](okf[A-Za-z0-9_.]*)['"`]/ to
 * anchor on okf.*, or the prefix-free form for whole-surface contracts.
 */
function extractLiteralKeys(files, pattern, base) {
  // matchAll requires a global regex; accept plain patterns from callers.
  const re = pattern.global ? pattern : new RegExp(pattern.source, pattern.flags + 'g');
  const literal = new Map();
  for (const f of files) {
    const src = fs
      .readFileSync(f, 'utf8')
      .replace(/\/\*[\s\S]*?\*\//g, ' ')
      .replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
    src.split(/\r?\n/).forEach((line, i) => {
      for (const m of line.matchAll(re)) {
        if (!literal.has(m[1])) literal.set(m[1], `${path.relative(base, f)}:${i + 1}`);
      }
    });
  }
  return literal;
}

module.exports = { flattenKeys, deepGet, filesUnder, extractLiteralKeys };
