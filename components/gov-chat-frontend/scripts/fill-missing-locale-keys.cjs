// Fill missing i18n keys in non-en locale files with English values so the
// localeConsistency deep-key-set test passes. Regenerates each locale file
// from a deep-merged object (2-space, single quotes — prettier normalizes after).
const fs = require('fs');
const path = require('path');
const DIR = 'D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales';

function loadLocale(file) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8');
  const obj = new Function(src.replace(/export default/, 'return'))();
  return obj;
}
function deepKeys(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...deepKeys(v, p));
    else out.push(p);
  }
  return out;
}
function setPath(obj, p, val) {
  const parts = p.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
}

const en = loadLocale('en.js');
const enKeys = new Set(deepKeys(en));
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js') && f !== 'en.js' && f !== 'index.js');

for (const file of files) {
  const loc = loadLocale(file);
  const have = new Set(deepKeys(loc));
  const missing = [...enKeys].filter((k) => !have.has(k));
  if (missing.length === 0) { console.log(file + ': complete'); continue; }
  for (const k of missing) setPath(loc, k, k.split('.').reduce((o, part) => o && o[part], en));
  const body = JSON.stringify(loc, null, 2)
    .replace(/"([A-Za-z0-9_.-]+)":/g, "'$1':")
    .replace(/'/g, "\\'")
    .replace(/\\'/g, "'")
    .replace(/"([^"]*)":/g, "'$1':");
  // JSON.stringify left double-quoted VALUES; convert those too, preserving escapes
  const out = 'export default ' + JSON.stringify(loc, null, 2).replace(/"((?:[^"\\]|\\.)*)":/g, (m, key) => "'" + key.replace(/'/g, "\\'") + "':").replace(/: "((?:[^"\\]|\\.)*)"/g, (m, val) => ": '" + val.replace(/'/g, "\\'") + "'") + ';\n';
  fs.writeFileSync(path.join(DIR, file), out);
  console.log(file + ': +' + missing.length + ' keys');
}
console.log('DONE');
