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

  // PLACEHOLDER GUARD (David, 2026-09-30, "Step of 10"; re-inked 2026-10-09).
  // translateMixin now does RAW message lookup (no vue-i18n compilation), so
  // a replace()-consumed okf.* key must carry the PLAIN {x} form — the
  // caller's .replace('{x}', …) needs to find it. The old {'{'}x{'}'} escape
  // renders literally under raw lookup (live: the dashboard Ingested card
  // showed "Ingested v{'{'}n{'}'}"), so every okf.* escape was un-escaped in
  // the same change. admin.documents.* keys are the exception: their consumer
  // is AdminDashboard.translate, which still routes through vue-i18n's
  // compiler — there the escape form is load-bearing and a plain {x} would
  // be swallowed as an empty named slot.
  const RAW = /\{[a-zA-Z][a-zA-Z0-9_]*\}/;
  const replaceConsumedPlain = [
    'okf.dashboard.stage.stepOf',
    'okf.studio.stage.stepOf',
    'okf.studio.dashboard.stage.stepOf',
    'okf.dashboard.stage.queueBehind',
    'okf.pii.nFlagged',
    'okf.src.total',
    'okf.src.count',
    'okf.src.confirm',
    'okf.src.uploaded',
    'okf.steps.input.benchCount',
    'okf.steps.input.moreN',
    // #1039 batch (2026-10-03): Step-7 keys consumed via .replace()
    'okf.validation.headline.blockers',
    'okf.validation.headline.warnings',
    'okf.validation.summary',
    'okf.validation.mergedPages',
    'okf.validation.preview.truncated',
    'okf.validation.action.wireCreate',
    'okf.validation.action.wireExisting',
    'okf.validation.wireDone',
    'okf.validation.wireCreated',
    // #1040 follow-up: the workbench bulk-PII success lines (consumed via
    // translate().replace('{n}') — the done_accept multiline wrap slipped a
    // raw {n} past a scripted escape once; the guard now pins all three).
    'okf.editor.piiBulk.done_accept',
    'okf.editor.piiBulk.done_redact',
    'okf.editor.piiBulk.done_remove'
  ];
  // #1042 batch delete: consumed via AdminDashboard.translate (compiled $t).
  const replaceConsumedEscaped = [
    'admin.documents.confirmDeleteSelected',
    'admin.documents.deleteQueuedSuccess',
    'admin.documents.deletePartialFailure',
    'admin.documents.deleteAllFailed',
    'admin.documents.deleteRefuseReason'
  ];

  test('replace()-consumed okf.* keys carry PLAIN placeholders in every locale (mixin raw lookup)', () => {
    const get = (o, d) => d.split('.').reduce((a, k) => (a && a[k] != null ? a[k] : undefined), o);
    const offenders = [];
    for (const locale of localeFiles) {
      const data = getLocaleData(locale);
      for (const key of replaceConsumedPlain) {
        const v = get(data, key);
        if (typeof v !== 'string') {
          offenders.push(`${locale}:${key} missing`);
        } else if (!RAW.test(v)) {
          offenders.push(`${locale}:${key} no plain placeholder: ${v}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('admin.documents replace()-consumed keys keep the escaped form (AdminDashboard compiled path)', () => {
    const get = (o, d) => d.split('.').reduce((a, k) => (a && a[k] != null ? a[k] : undefined), o);
    const offenders = [];
    for (const locale of localeFiles) {
      const data = getLocaleData(locale);
      for (const key of replaceConsumedEscaped) {
        const v = get(data, key);
        if (typeof v !== 'string') {
          offenders.push(`${locale}:${key} missing`);
        } else if (RAW.test(v)) {
          offenders.push(`${locale}:${key} raw placeholder (must stay escaped): ${v}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
