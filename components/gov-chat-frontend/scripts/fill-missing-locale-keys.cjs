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
// Proper single-quoted JS string literal: escape ONLY backslash and quote,
// plus control chars. Never emits \" (which ESLint flags as no-useless-escape).
function jsStr(s) {
  let out = '';
  for (const ch of String(s)) {
    if (ch === '\\') out += '\\\\';
    else if (ch === "'") out += "\\'";
    else if (ch === '\n') out += '\\n';
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
    else out += ch;
  }
  return "'" + out + "'";
}
function serialize(obj, indent) {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);
  if (Array.isArray(obj)) {
    if (obj.length === 0) return '[]';
    const items = obj.map((v) => (v && typeof v === 'object' ? padIn + serialize(v, indent + 1) : padIn + jsStr(v)));
    return '[\n' + items.join(',\n') + '\n' + pad + ']';
  }
  const keys = Object.keys(obj);
  if (keys.length === 0) return '{}';
  const lines = keys.map((k) => {
    const v = obj[k];
    const key = /^[A-Za-z0-9_$]+$/.test(k) ? k : jsStr(k);
    if (v && typeof v === 'object') return padIn + key + ': ' + serialize(v, indent + 1);
    return padIn + key + ': ' + jsStr(v);
  });
  return '{\n' + lines.join(',\n') + '\n' + pad + '}';
}

const en = loadLocale('en.js');
const enKeys = new Set(deepKeys(en));
const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.js') && f !== 'en.js' && f !== 'index.js');

for (const file of files) {
  const loc = loadLocale(file);
  const have = new Set(deepKeys(loc));
  const missing = [...enKeys].filter((k) => !have.has(k));
  if (missing.length === 0) {
    console.log(file + ': complete');
    continue;
  }
  for (const k of missing)
    setPath(
      loc,
      k,
      k.split('.').reduce((o, part) => o && o[part], en)
    );
  fs.writeFileSync(path.join(DIR, file), 'export default ' + serialize(loc, 0) + ';\n', 'utf8');
  console.log(file + ': +' + missing.length + ' keys');
}
console.log('DONE');
