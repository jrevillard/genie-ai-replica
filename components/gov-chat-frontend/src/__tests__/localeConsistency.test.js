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

  // PLACEHOLDER GUARD (David, 2026-09-30, "Step of 10"; re-inked 2026-10-09;
  // widened round 16, #80122). translateMixin does RAW message lookup (no
  // vue-i18n compilation), so a replace()-consumed okf.* key must carry the
  // PLAIN {x} form — the caller's .replace('{x}', …) needs to find it. The
  // old {'{'}x{'}'} escape renders literally under raw lookup (live: the
  // dashboard Ingested card showed "Ingested v{'{'}n{'}'}"), so every okf.*
  // escape was un-escaped in the same change. Keys consumed through a
  // COMPILED $i18n.t path (AdminDashboard + the dialogs it hosts) are the
  // exception: there the escape form is load-bearing and a plain {x} would
  // be swallowed as an empty named slot — which is exactly what had happened
  // to every pre-existing admin.documents/uploadDialog placeholder leaf
  // before the round-16 migration.
  const RAW = /\{[a-zA-Z][a-zA-Z0-9_]*\}/;

  // DERIVED, NOT CURATED (review !622 round 9, #78680): the consumed-key sets
  // are scanned from the consumer source, so a new translate().replace()
  // call site is guarded the moment it ships — the hand inventory this
  // replaces was itself the failure mode (an unlisted key slipped the
  // escaped-vs-plain check and rendered literally in the UI).
  //
  // Classification is by CONSUMER FILE: files whose translate() routes
  // through vue-i18n's compiler (there the escaped {'{'}x{'}'} form is
  // load-bearing — a plain {x} is swallowed as an empty named slot), while
  // the mixin translate does RAW lookup (there the plain {x} form is
  // required). A future compiled-path consumer file is one entry in
  // COMPILED_FILES — one line, not an inventory.
  const COMPILED_FILES = [
    'AdminDashboard.vue',
    'AddFromLinkDialog.vue',
    'UploadFilesDialog.vue',
    'FileDetailsDialog.vue',
    'LogSearchDialog.vue',
    'OperationResultsModal.vue'
  ];
  // Dynamic-key call sites the static scan cannot resolve (the key arrives in
  // a variable): okfRepoGate.warnKey and the hierarchy titleKey/messageKey
  // ternaries in AdminDashboard — all compiled-path consumers, so their
  // leaves must stay escaped. One line per call site.
  const DYNAMIC_COMPILED_KEYS = [
    'okf.docs.gate.servingWarn',
    'admin.hierarchy.confirmDeleteCategory',
    'admin.hierarchy.confirmDeleteService',
    'admin.hierarchy.formTitleEditCategory',
    'admin.hierarchy.formTitleEditService'
  ];
  // The fallback may be single- OR backtick-quoted (template literals carry
  // the same {x} tokens and go through the same compiler), and the whole call
  // may wrap across lines — \s* covers both.
  const TRANSLATE_REPLACE_RE = new RegExp(
    "(?:this\\.|[^\\w.])translate\\(\\s*'([a-zA-Z][\\w.]*)'\\s*(?:,\\s*(?:'(?:[^'\\\\]|\\\\.)*'|`(?:[^`\\\\]|\\\\.)*`)\\s*)?\\)\\s*\\.replace\\(",
    'g'
  );
  function deriveReplaceConsumed() {
    const plain = new Map(); // key -> Set of placeholder tokens consumed via .replace
    const escaped = new Set();
    const roots = ['components', 'services', 'store'].map((r) => path.join(__dirname, '..', r));
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== '__tests__') walk(full);
          continue;
        }
        if (!entry.name.endsWith('.vue') && !entry.name.endsWith('.js')) continue;
        // strip comments first — a translate() inside a comment must not count
        const src = fs
          .readFileSync(full, 'utf8')
          .replace(new RegExp('/\\*[\\s\\S]*?\\*/', 'g'), ' ')
          .replace(new RegExp('(^|[^:])//[^\\n]*', 'g'), '$1 ');
        const compiled = COMPILED_FILES.includes(entry.name);
        let m;
        TRANSLATE_REPLACE_RE.lastIndex = 0;
        while ((m = TRANSLATE_REPLACE_RE.exec(src)) !== null) {
          if (compiled) {
            escaped.add(m[1]);
            continue;
          }
          // Walk the .replace CHAIN — each link is 'token', args) followed by
          // an unbroken `.replace(`. Walking links (not a character window)
          // is what keeps a `+ this.translate(...)` sibling statement's
          // replaces from bleeding into this key's token set.
          if (!plain.has(m[1])) plain.set(m[1], new Set());
          let i = m.index + m[0].length; // right after the first `.replace(`
          for (;;) {
            const tm = /^\s*'([^']+)'/.exec(src.slice(i));
            if (!tm) break;
            plain.get(m[1]).add(tm[1]);
            // skip to the matching close-paren of this replace( — quote-aware
            let depth = 1;
            let j = i + tm[0].length;
            while (j < src.length && depth > 0) {
              const ch = src[j];
              if (ch === "'" || ch === '"' || ch === '`') {
                const q = ch;
                j++;
                while (j < src.length && src[j] !== q) {
                  if (src[j] === '\\') j++;
                  j++;
                }
              } else if (ch === '(') depth++;
              else if (ch === ')') depth--;
              j++;
            }
            const cont = /^\s*\.\s*replace\s*\(/.exec(src.slice(j));
            if (!cont) break; // chain ends — a `+` sibling must not be read
            i = j + cont[0].length;
          }
        }
      }
    };
    roots.forEach(walk);
    return { plain, escaped };
  }
  const derivedScan = deriveReplaceConsumed();
  const derivedReplace = {
    plain: derivedScan.plain,
    escaped: Array.from(new Set([...derivedScan.escaped, ...DYNAMIC_COMPILED_KEYS])).sort()
  };

  test('the consumer scan actually finds call sites (a silently empty scan guards nothing)', () => {
    // round-9 ground truth: ~45 curated entries existed; the scan must see
    // at least that many. Round 16 (#80122) widened the compiled set from
    // AdminDashboard's 5 admin keys to the dialogs it hosts too.
    expect(derivedReplace.plain.size).toBeGreaterThan(40);
    expect(derivedReplace.escaped.length).toBeGreaterThanOrEqual(20);
  });

  test('replace()-consumed keys carry every consumed placeholder verbatim in every locale (mixin raw lookup)', () => {
    const get = (o, d) => d.split('.').reduce((a, k) => (a && a[k] != null ? a[k] : undefined), o);
    const offenders = [];
    const en = getLocaleData('en');
    for (const [key, tokens] of derivedReplace.plain) {
      // A key absent from en falls back to the caller's default string, which
      // carries the same placeholders — nothing to assert. (Cross-locale
      // presence is the deep-identity test's job.)
      if (get(en, key) == null) continue;
      for (const locale of localeFiles) {
        const v = get(getLocaleData(locale), key);
        if (typeof v !== 'string') {
          offenders.push(`${locale}:${key} missing`);
          continue;
        }
        for (const token of tokens) {
          // Literal containment covers BOTH failure modes in one check: the
          // escaped {'{'}n{'}'} form does not contain the literal '{n}', and a
          // translated-away '[p]' does not contain '[p]'.
          if (!v.includes(token)) offenders.push(`${locale}:${key} missing ${token}: ${v}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  test('compiled-path replace()-consumed keys keep the escaped form AND every token, in every locale', () => {
    const get = (o, d) => d.split('.').reduce((a, k) => (a && a[k] != null ? a[k] : undefined), o);
    const unescape = (v) => String(v).split("{'{'}").join('{').split("{'}'}").join('}');
    const offenders = [];
    const en = getLocaleData('en');
    for (const locale of localeFiles) {
      const data = getLocaleData(locale);
      for (const key of derivedReplace.escaped) {
        const enLeaf = get(en, key);
        if (enLeaf == null) continue; // caller-default fallback — nothing to assert
        const v = get(data, key);
        if (typeof v !== 'string') {
          offenders.push(`${locale}:${key} missing`);
          continue;
        }
        if (RAW.test(v)) {
          offenders.push(`${locale}:${key} raw placeholder (must stay escaped): ${v}`);
          continue;
        }
        // token parity: the en leaf's placeholders must all survive the
        // translation — a token the caller .replace()es that a locale
        // dropped renders the raw token to the user, silently, in that
        // language only.
        const tokens = unescape(enLeaf).match(/\{[a-zA-Z][a-zA-Z0-9_]*\}/g) || [];
        for (const t of tokens) {
          if (!unescape(v).includes(t)) offenders.push(`${locale}:${key} lost token ${t}: ${v}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  // UNTRANSLATED-LEAF GUARD (David, 2026-10-31 — "comprehensively remediated"):
  // the OKF Studio surface shipped 321 leaves that were byte-identical to
  // English in all 13 locales (ragTip, the Testing-Lab strings, the glossary,
  // the PII dialogs…). A real sentence translation is never byte-identical
  // across languages — even the loanword-heavy man/st locales restructure —
  // so identity to en on a leaf this long means "nobody translated it".
  // Short leaves (< 25 chars) are exempt: technical terms and one-word
  // labels legitimately coincide.
  const UNTRANSLATED_SECTIONS = ['okf', 'uploadDialog'];
  const UNTRANSLATED_MIN_LEN = 25;

  test('OKF-surface leaves are actually translated (no raw English copies)', () => {
    const get = (o, d) => d.split('.').reduce((a, k) => (a && a[k] != null ? a[k] : undefined), o);
    const en = getLocaleData('en');
    const enKeys = [];
    (function flat(node, prefix) {
      for (const k of Object.keys(node || {})) {
        const p = prefix ? `${prefix}.${k}` : k;
        if (typeof node[k] === 'string') enKeys.push(p);
        else if (node[k] && typeof node[k] === 'object') flat(node[k], p);
      }
    })(en, '');
    const offenders = [];
    // FLOOR (round 18, #80475): a vacuous scan stays green — if the section
    // list drifts (rename, a flat()/get() regression), offenders=[] passes
    // while the contract dies. The checked-key count must stay in the
    // hundreds (post-remediation baseline: 671 in-scope leaves >= 25 chars;
    // 321 were offenders before the fix). Emptying UNTRANSLATED_SECTIONS
    // fails HERE, not vacuously-green.
    let checkedCount = 0;
    for (const key of enKeys) {
      if (!UNTRANSLATED_SECTIONS.some((s) => key === s || key.startsWith(s + '.'))) continue;
      checkedCount++;
      const enVal = get(en, key);
      if (typeof enVal !== 'string' || enVal.length < UNTRANSLATED_MIN_LEN) continue;
      for (const locale of localeFiles) {
        if (locale === 'en') continue;
        const v = get(getLocaleData(locale), key);
        if (v === enVal) offenders.push(`${locale}:${key} is the raw English string: ${v.slice(0, 50)}`);
      }
    }
    expect(checkedCount).toBeGreaterThan(300);
    expect(offenders).toEqual([]);
  });
});
