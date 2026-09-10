// List every corrupted value line in en.js (design the exact replacement).
const fs = require('fs');
const s = fs.readFileSync('D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales/en.js', 'utf8');
s.split('\n').forEach((l, i) => {
  if (l.includes("{'{'{'}'}")) console.log(i + 1 + ': ' + l.trim().slice(0, 140));
});
