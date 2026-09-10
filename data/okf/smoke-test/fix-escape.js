// Fix the double-escaped literal-brace corruption across all 14 locales.
// Corrupt: {'{'{'}'}  (escape-for-{ written as escape({)+escape(})  → correct: {'{'}
const fs = require('fs');
const path = require('path');
const dir = 'D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales';
const CORRUPT = "{'{'{'}'}";
const GOOD = "{'{'}"; // identical char sequence to {'{'}... — the corrected first token is {'{'} which IS {'{'}... use exact: {'{'}? NO — the corrected token is {'{'}  ≡ {'{'}; replacement string:
const FIXED = "{'{'}";
let total = 0;
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
  const p = path.join(dir, f);
  const s = fs.readFileSync(p, 'utf8');
  const n = s.split(CORRUPT).length - 1;
  if (n === 0) continue;
  fs.writeFileSync(p, s.split(CORRUPT).join(FIXED));
  total += n;
  console.log(f + ': fixed ' + n);
}
console.log('TOTAL fixed: ' + total);
