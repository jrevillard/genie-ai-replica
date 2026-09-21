/* One-off audit: extract every $t() key from the Insights/Market-Price
   components and check membership in en.js / es.js. */
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

const keyRe = /\$t\(\s*'([^']+)'/g;
const used = new Map(); // key -> [file:line]
for (const rel of COMPONENTS) {
  const full = path.join(SRC, rel);
  if (!fs.existsSync(full)) continue;
  const lines = fs.readFileSync(full, 'utf8').split('\n');
  lines.forEach((line, i) => {
    let m;
    keyRe.lastIndex = 0;
    while ((m = keyRe.exec(line)) !== null) {
      const key = m[1];
      if (!used.has(key)) used.set(key, []);
      used.get(key).push(`${rel}:${i + 1}`);
    }
  });
}

function loadLocale(name) {
  const file = path.join(SRC, 'i18n', 'locales', `${name}.js`);
  let src = fs.readFileSync(file, 'utf8');
  // strip ESM wrapper
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

const en = flatten(loadLocale('en'));
const es = flatten(loadLocale('es'));

const missingEn = [];
const missingEs = [];
for (const key of [...used.keys()].sort()) {
  if (!(key in en)) missingEn.push(key);
  if (!(key in es)) missingEs.push(key);
}

console.log(`total distinct keys used: ${used.size}`);
console.log(`\n=== missing from en.js (${missingEn.length}) ===`);
missingEn.forEach((k) => console.log(`  ${k}  <- ${used.get(k)[0]}`));
console.log(`\n=== missing from es.js (${missingEs.length}) ===`);
missingEs.forEach((k) => console.log(`  ${k}  <- ${used.get(k)[0]}`));
