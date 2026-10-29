// One-shot (2026-10-09): translateMixin switched to RAW message lookup (no
// vue-i18n compilation), so the {'{'}tag{'}'} literal-brace escapes in the
// teach.veto strings would render literally. Restore plain {tag} — the
// call sites .replace('{tag}') themselves.
const fs = require('fs');
const path = require('path');
const DIR = 'D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales';

function loadLocale(file) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8');
  return new Function(src.replace(/export default/, 'return'))();
}
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

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.js') && f !== 'index.js')) {
  const loc = loadLocale(file);
  const veto = loc && loc.okf && loc.okf.headTest && loc.okf.headTest.teach && loc.okf.headTest.teach.veto;
  if (typeof veto !== 'string' || !veto.includes("{'{'}")) {
    console.log(file + ': no escaped braces — skipped');
    continue;
  }
  loc.okf.headTest.teach.veto = veto.split("{'{'}tag{'}'}").join('{tag}');
  fs.writeFileSync(path.join(DIR, file), 'export default ' + serialize(loc, 0) + ';\n', 'utf8');
  console.log(file + ': veto unescaped');
}
console.log('DONE');
