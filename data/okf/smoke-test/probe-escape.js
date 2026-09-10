// Probe: count real occurrences of the double-escaped literal in locale files.
const fs = require('fs');
const path = require('path');
const dir = 'D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales';
const CORRUPT = "{'{'{'}'}"; // the broken nested-escape literal
const GOOD = "{'{'}"; // the correct literal-brace escape
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.js'))) {
  const s = fs.readFileSync(path.join(dir, f), 'utf8');
  const count = s.split(CORRUPT).length - 1;
  const goodCount = s.split(GOOD).length - 1;
  const lines = [];
  s.split('\n').forEach((l, i) => {
    if (l.includes(CORRUPT) && lines.length < 3) lines.push(i + 1);
  });
  console.log(f, 'corrupt=' + count, 'goodEscapes=' + goodCount, 'sampleLines=' + JSON.stringify(lines));
}
