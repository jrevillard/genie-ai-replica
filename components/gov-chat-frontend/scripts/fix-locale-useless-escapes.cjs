// One-shot v2 (2026-10-10): remove no-useless-escape `\'` ONLY inside
// double-quoted strings (the codemod damage), preserving legit \' inside
// single-quoted strings. Quote-state-aware walk, escape-aware; then every
// file is re-parsed as a module body to prove nothing broke.
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');

for (const f of fs.readdirSync(DIR).filter((x) => x.endsWith('.js'))) {
  const p = path.join(DIR, f);
  const src = fs.readFileSync(p, 'utf8');
  let out = '';
  let inS = false; // '...'
  let inD = false; // "..."
  let inT = false; // `...`
  let inLine = false;
  let inBlock = false;
  let removed = 0;
  for (let i = 0; i < src.length; i += 1) {
    const ch = src[i];
    const next = src[i + 1];
    if (inLine) {
      out += ch;
      if (ch === '\n') inLine = false;
      continue;
    }
    if (inBlock) {
      out += ch;
      if (ch === '*' && next === '/') {
        out += next;
        i += 1;
        inBlock = false;
      }
      continue;
    }
    if (!inS && !inD && !inT) {
      if (ch === '/' && next === '/') {
        inLine = true;
        out += ch;
        continue;
      }
      if (ch === '/' && next === '*') {
        inBlock = true;
        out += ch;
        continue;
      }
      if (ch === "'") inS = true;
      else if (ch === '"') inD = true;
      else if (ch === '`') inT = true;
      out += ch;
      continue;
    }
    // inside a string
    if (ch === '\\') {
      // decide whether the escape is USELESS: \' inside a DOUBLE-quoted
      // (or template) string is useless; inside a single-quoted string it
      // is load-bearing.
      if (next === "'" && (inD || inT)) {
        out += "'"; // drop the backslash
        removed += 1;
        i += 1;
        continue;
      }
      out += ch + (next || '');
      i += 1;
      continue;
    }
    if (inS && ch === "'") inS = false;
    else if (inD && ch === '"') inD = false;
    else if (inT && ch === '`') inT = false;
    out += ch;
  }
  fs.writeFileSync(p, out, 'utf8');
  // prove it still parses
  // eslint-disable-next-line no-new-func
  new Function(fs.readFileSync(p, 'utf8').replace(/export default/, 'return'))();
  console.log(f, "removed useless \\' x" + removed);
}
console.log('DONE — all locales re-parsed OK');
