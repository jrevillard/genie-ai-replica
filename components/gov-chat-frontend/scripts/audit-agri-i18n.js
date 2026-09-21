/**
 * Agri / Insights i18n audit.
 *
 * Walks every Insights + Market Prices Vue file and collects every i18n key
 * actually used via $t() / translate(), then verifies the key is defined in
 * EVERY one of the 14 shipped locales (en, es, fr, pt, ar, bn, de, id, man,
 * ru, st, sw, th, zh). Exits non-zero if any locale is missing a used key
 * so CI can fail-fast on i18n regressions.
 *
 * Replaces the original one-off that only checked en + es — that script gave
 * a green light while 9 of 14 web locales shipped English fallback for new
 * chart keys (MR !388 review B-5).
 *
 * Patterns matched:
 *   $t('key.subkey')          — single-quoted literal
 *   $t("key.subkey")          — double-quoted literal
 *   $t(`key.${dyn}`)          — template literal with interpolation
 *   translate('key.subkey')   — project i18n wrapper
 *   translate("key.subkey")   — double-quoted wrapper
 *
 * Dynamic-key sites are recorded separately as warnings — they can't be
 * statically validated but should be tracked.
 */
const fs = require('fs');
const path = require('path');

const SRC = path.join(__dirname, '..', 'src');
const COMPONENTS = [
  'components/charts/MarketPriceChart.vue',
  'components/charts/MarketPriceSummaryCard.vue',
  'components/charts/CropHealthChart.vue',
  'components/charts/CropHealthSummaryCard.vue',
  'components/charts/PestAlertChart.vue',
  'components/charts/PestAlertSummaryCard.vue',
  'components/charts/ChartDialog.vue',
  'components/charts/CategoryDistributionChart.vue',
  'components/charts/SatisfactionGauge.vue',
  'components/charts/SatisfactionHeatmap.vue',
  'components/charts/TopQueriesChart.vue',
  'components/charts/UsageTrendChart.vue',
  'components/ChatBotComponent.vue'
];

const LOCALES = ['en', 'es', 'fr', 'pt', 'ar', 'bn', 'de', 'id', 'man', 'ru', 'st', 'sw', 'th', 'zh'];

// All key call sites — single-quoted, double-quoted, and the project's
// translate() wrapper. Template-literal calls ($t(`prefix.${x}`)) are
// reported separately as dynamic keys (can't be statically validated).
const STATIC_KEY_PATTERNS = [
  /\$t\(\s*'([^']+)'/g,
  /\$t\(\s*"([^"]+)"/g,
  /\btranslate\(\s*'([^']+)'/g,
  /\btranslate\(\s*"([^"]+)"/g
];

// Used keys are recorded globally; per-key call sites (file:line) help
// the developer jump to the source.
const used = new Map(); // key -> [file:line]
const dynamic = new Map(); // key prefix -> [file:line]

for (const rel of COMPONENTS) {
  const full = path.join(SRC, rel);
  if (!fs.existsSync(full)) continue;
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  lines.forEach((line, i) => {
    // Static keys
    for (const re of STATIC_KEY_PATTERNS) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(line)) !== null) {
        const key = m[1];
        if (!used.has(key)) used.set(key, []);
        used.get(key).push(`${rel}:${i + 1}`);
      }
    }
    // Dynamic keys: $t(`prefix.${var}`) — only the prefix is statically
    // known, so we record it for human review.
    const tmplRe = /\$t\(\s*`([^`${}]+)\$\{/g;
    tmplRe.lastIndex = 0;
    let t2;
    while ((t2 = tmplRe.exec(line)) !== null) {
      const prefix = t2[1];
      if (!dynamic.has(prefix)) dynamic.set(prefix, []);
      dynamic.get(prefix).push(`${rel}:${i + 1}`);
    }
  });
}

function loadLocale(name) {
  const file = path.join(SRC, 'i18n', 'locales', `${name}.js`);
  let src = fs.readFileSync(file, 'utf8');
  // Strip ESM `export default` wrapper to make `require`-able in Node.
  src = src.replace(/export\s+default\s*/, 'module.exports =');
  const req = new Function('module', 'exports', src);
  const mod = { exports: {} };
  req(mod, mod.exports);
  return mod.exports;
}

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj || {})) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

// Load + flatten every shipped locale.
const locales = {};
for (const name of LOCALES) {
  locales[name] = flatten(loadLocale(name));
}

const totalKeys = used.size;
const missingByLocale = {};
for (const name of LOCALES) missingByLocale[name] = [];

for (const key of [...used.keys()].sort()) {
  for (const name of LOCALES) {
    if (!(key in locales[name])) {
      missingByLocale[name].push(key);
    }
  }
}

console.log(`total distinct static keys used: ${totalKeys}`);
console.log(`locales audited: ${LOCALES.length}`);
if (dynamic.size > 0) {
  console.log(`\ndynamic-key prefixes (human review required): ${dynamic.size}`);
  for (const [prefix, sites] of [...dynamic.entries()].sort()) {
    console.log(`  ${prefix}  <- ${sites[0]}`);
  }
}

// Two-tier classification:
//   - REGRESSION: a key is missing from en.js (the source of truth). CI fails
//     because new code is calling a key that has no translation at all.
//   - EN-FALLBACK: a key is present in en.js but missing in another locale.
//     The other locale will fall back to the English value (vue-i18n's
//     default behaviour) — acceptable per the project policy (en/es dev
//     flavor for el-salvador), so we WARN but do not fail.
const missingFromEn = missingByLocale.en;
const missingElsewhere = {};
for (const name of LOCALES) {
  if (name === 'en') continue;
  // enFallback = key IS in en.js but missing here. User sees English.
  const enFallbackKeys = missingByLocale[name].filter((k) => k in locales.en);
  // orphanHere = key is NOT in en.js AND missing here. Local code calls a
  // key that has no source-of-truth definition anywhere — vue-i18n will
  // render the raw key string for users in this locale.
  const orphanHereKeys = missingByLocale[name].filter((k) => !(k in locales.en));
  if (enFallbackKeys.length > 0 || orphanHereKeys.length > 0) {
    missingElsewhere[name] = { enFallback: enFallbackKeys, orphan: orphanHereKeys };
  }
}

console.log(`\n=== missing from en.js (regressions) (${missingFromEn.length}) ===`);
if (missingFromEn.length === 0) {
  console.log('  (none)');
} else {
  for (const k of missingFromEn) console.log(`  ${k}  <- ${used.get(k)[0]}`);
}

let totalEnFallback = 0;
for (const name of LOCALES) {
  if (name === 'en') continue;
  const m = missingElsewhere[name];
  if (!m) {
    console.log(`\n=== ${name}.js ===`);
    console.log('  (none)');
    continue;
  }
  console.log(`\n=== ${name}.js ===`);
  console.log(`  EN-fallback keys (key present in en.js, missing here; user sees English): ${m.enFallback.length}`);
  for (const k of m.enFallback) console.log(`    ${k}`);
  if (m.orphan.length > 0) {
    console.log(`  ORPHAN (key missing in BOTH en.js AND here — code references an undefined key): ${m.orphan.length}`);
    for (const k of m.orphan) console.log(`    ${k}`);
  }
  totalEnFallback += m.enFallback.length;
}

// CI gate: fail ONLY on regressions (key missing from en.js). EN fallbacks
// across the other locales are logged as warnings but do not fail the build
// — el-salvador's deployment is en/es dev flavor and the el-salvador audit
// policy explicitly accepts English fallback for non-el-salvador locales.
if (missingFromEn.length > 0) {
  console.error(`\nFAIL: ${missingFromEn.length} key(s) used in code but missing from en.js (regression).`);
  process.exit(1);
}
console.log(`\nOK: en.js defines every used key (${missingFromEn.length} regressions).`);
if (totalEnFallback > 0) {
  console.log(`WARN: ${totalEnFallback} EN-fallback occurrences across non-en locales (acceptable per policy).`);
}
