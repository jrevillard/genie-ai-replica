import fs from 'fs';
import path from 'path';
import { parse } from '@babel/parser';

const localesDir = path.join(__dirname, '..', 'i18n', 'locales');

function getLocaleFiles() {
  return fs
    .readdirSync(localesDir)
    .filter((f) => f.endsWith('.js'))
    .map((f) => f.replace('.js', ''))
    .sort();
}

function getLocaleData(locale) {
  return require(`../i18n/locales/${locale}.js`).default;
}

// Collect every leaf key path (dotted) from a locale object.
function flattenKeys(obj, prefix = '') {
  const keys = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) keys.push(...flattenKeys(v, p));
    else keys.push(p);
  }
  return keys;
}

// Detect duplicate keys within object literals. JS silently keeps the last
// value for a duplicate key, so this needs an AST scan (the parsed object would
// hide duplicates).
function findDuplicateKeys(source) {
  const ast = parse(source, { sourceType: 'module' });
  const dups = [];
  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node.type) return; // not an AST node (e.g. source location info)
    if (node.type === 'ObjectExpression') {
      const seen = new Set();
      for (const prop of node.properties) {
        if (prop.type === 'ObjectProperty' && !prop.computed && prop.key) {
          const name = prop.key.name ?? prop.key.value;
          if (seen.has(name)) dups.push(name);
          else seen.add(name);
        }
      }
    }
    for (const v of Object.values(node)) walk(v);
  }
  walk(ast);
  return [...new Set(dups)].sort();
}

describe('Locale consistency', () => {
  const localeFiles = getLocaleFiles();

  test('English locale file exists', () => {
    expect(localeFiles).toContain('en');
  });

  test('each locale file exports a valid object with content', () => {
    for (const locale of localeFiles) {
      const data = getLocaleData(locale);
      expect(data).toBeDefined();
      expect(typeof data).toBe('object');
      expect(Object.keys(data).length).toBeGreaterThan(0);
    }
  });

  test('all locale files share the same top-level keys', () => {
    const referenceKeys = Object.keys(getLocaleData('en')).sort();
    for (const locale of localeFiles) {
      expect(Object.keys(getLocaleData(locale)).sort()).toEqual(referenceKeys);
    }
  });

  test('all locale files share the identical deep key set', () => {
    // Strict guard: every locale must expose exactly the same leaf keys as `en`
    // (source of truth), at any nesting depth. Adding a key to one locale
    // without the others, or removing one, fails CI here.
    const reference = flattenKeys(getLocaleData('en')).sort();
    const refSet = new Set(reference);
    const drift = [];
    for (const locale of localeFiles) {
      if (locale === 'en') continue;
      const keys = flattenKeys(getLocaleData(locale)).sort();
      const missing = reference.filter((k) => !keys.includes(k));
      const extra = keys.filter((k) => !refSet.has(k));
      if (missing.length || extra.length) {
        const fmt = (arr) => `${arr.length} (${arr.slice(0, 8).join(', ')}${arr.length > 8 ? ', …' : ''})`;
        drift.push(`${locale}: missing ${fmt(missing)}, extra ${fmt(extra)}`);
      }
    }
    expect(drift).toEqual([]);
  });

  test('no locale file has duplicate keys', () => {
    const dupMap = {};
    for (const f of fs.readdirSync(localesDir).filter((x) => x.endsWith('.js'))) {
      const dups = findDuplicateKeys(fs.readFileSync(path.join(localesDir, f), 'utf8'));
      if (dups.length) dupMap[f] = dups;
    }
    expect(dupMap).toEqual({});
  });
});
