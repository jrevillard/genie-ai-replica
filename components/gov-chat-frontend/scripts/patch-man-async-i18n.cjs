// One-shot (2026-10-09): man.js missed the async-gen i18n keys (no T.man in
// unescape-okf-braces-async-i18n.cjs). man.js convention = English fallback.
const fs = require('fs');
const DIR = 'D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales';
function load(file) {
  return new Function(fs.readFileSync(DIR + '/' + file, 'utf8').replace(/export default/, 'return'))();
}
function jsStr(s) {
  let o = '';
  for (const c of String(s)) {
    if (c === '\\') o += '\\\\';
    else if (c === "'") o += "\\'";
    else if (c === '\n') o += '\\n';
    else if (c === '\r') o += '\\r';
    else if (c === '\t') o += '\\t';
    else o += c;
  }
  return "'" + o + "'";
}
function ser(o, ind) {
  const pad = '  '.repeat(ind);
  const pin = '  '.repeat(ind + 1);
  const ks = Object.keys(o);
  if (!ks.length) return '{}';
  return (
    '{\n' +
    ks
      .map((k) => {
        const v = o[k];
        const key = /^[A-Za-z0-9_$]+$/.test(k) ? k : jsStr(k);
        return v && typeof v === 'object' ? pin + key + ': ' + ser(v, ind + 1) : pin + key + ': ' + jsStr(v);
      })
      .join(',\n') +
    '\n' +
    pad +
    '}'
  );
}
const loc = load('man.js');
const en = load('en.js');
loc.okf.headTest.suites.generateTip = en.okf.headTest.suites.generateTip;
loc.okf.headTest.suites.generating = en.okf.headTest.suites.generating;
const next = {};
for (const k of Object.keys(loc.okf.headTest.error)) {
  next[k] = loc.okf.headTest.error[k];
  if (k === 'suiteRename') next.generateTimeout = en.okf.headTest.error.generateTimeout;
}
loc.okf.headTest.error = next;
fs.writeFileSync(DIR + '/man.js', 'export default ' + ser(loc, 0) + ';\n', 'utf8');
const check = load('man.js');
console.log(
  'man.js timeout:',
  typeof check.okf.headTest.error.generateTimeout,
  '| generating:',
  check.okf.headTest.suites.generating.slice(0, 40)
);
