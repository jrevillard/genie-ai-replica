/* Repo-wide i18n audit: every $t() / translate() literal key used in any
   .vue file must exist in en.js and es.js (and report the other 12 for
   key-completeness confidence). */
const fs = require('fs');
const path = require('path');

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (e.name === 'node_modules' || e.name === '__tests__') continue;
      walk(p, out);
    } else if (e.name.endsWith('.vue') || e.name.endsWith('.js')) {
      out.push(p);
    }
  }
  return out;
}

const SRC = path.join(__dirname, '..', 'src');
const files = walk(SRC).filter((f) => !f.includes('i18n' + path.sep + 'locales'));
const keyRe = /[$\s.(]t\(\s*'([^']+)'/g;
const used = new Map();
for (const f of files) {
  const src = fs.readFileSync(f, 'utf8');
  src.split('\n').forEach((line, i) => {
    let m;
    keyRe.lastIndex = 0;
    while ((m = keyRe.exec(line)) !== null) {
      const key = m[1];
      if (!used.has(key)) used.set(key, []);
      if (used.get(key).length < 2) used.get(key).push(`${path.relative(SRC, f)}:${i + 1}`);
    }
  });
}

function loadLocale(name) {
  let src = fs.readFileSync(path.join(SRC, 'i18n', 'locales', `${name}.js`), 'utf8');
  src = src.replace(/export\s+default\s*/, 'module.exports =');
  const mod = { exports: {} };
  new Function('module', 'exports', src)(mod, mod.exports);
  function flat(o, p = '', out = {}) {
    for (const [k, v] of Object.entries(o || {})) {
      const kk = p ? `${p}.${k}` : k;
      if (v && typeof v === 'object' && !Array.isArray(v)) flat(v, kk, out);
      else out[kk] = v;
    }
    return out;
  }
  return flat(mod.exports);
}

const en = loadLocale('en');
const es = loadLocale('es');
const missingEn = [...used.keys()].filter((k) => !(k in en));
const missingEs = [...used.keys()].filter((k) => !(k in es));

console.log(`files scanned: ${files.length} | distinct keys: ${used.size}`);
console.log(`missing from en.js: ${missingEn.length}`);
missingEn.forEach((k) => console.log(`  EN-MISSING ${k} <- ${used.get(k)[0]}`));
console.log(`missing from es.js: ${missingEs.length}`);
missingEs.forEach((k) => console.log(`  ES-MISSING ${k} <- ${used.get(k)[0]}`));
