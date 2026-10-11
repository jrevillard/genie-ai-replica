// 1-8g-m — add okf.frontmatter.suggestCoverage to every locale.
// Run: node scripts/add-18g-m-suggest-coverage-i18n.cjs
//
// SURGICAL by design: a full parse/serialize round-trip rewrites the entire
// locale file (quote style, the `export default` wrapper, 37k lines of diff).
// Instead we insert ONE line right after the existing `suggestEmpty:` anchor,
// preserving each file's own indentation and formatting exactly.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');
const ANCHOR = /^(?<indent>[ \t]*)suggestEmpty:/;

// {sampled} / {total} / {labels} are interpolated by the panel.
const T = {
  en: 'Derived from {sampled} of {total} concepts across {labels} knowledge-hierarchy labels.',
  fr: 'Dérivé de {sampled} concepts sur {total}, répartis sur {labels} étiquettes de la hiérarchie de connaissances.',
  es: 'Derivado de {sampled} de {total} conceptos, repartidos en {labels} etiquetas de la jerarquía del conocimiento.',
  de: 'Abgeleitet aus {sampled} von {total} Konzepten, über {labels} Labels der Wissenshierarchie.',
  pt: 'Derivado de {sampled} de {total} conceitos, em {labels} rótulos da hierarquia do conhecimento.',
  ru: 'Получено из {sampled} из {total} концепций, по {labels} меткам иерархии знаний.',
  ar: 'مشتق من {sampled} من أصل {total} مفهومًا، عبر {labels} تسميات من هرمية المعرفة.',
  zh: '基于 {total} 个概念中的 {sampled} 个生成，覆盖 {labels} 个知识层级标签。',
  th: 'ได้มาจาก {sampled} จาก {total} แนวคิด ครอบคลุม {labels} ป้ายกำกับของลำดับชั้นความรู้',
  id: 'Diturunkan dari {sampled} dari {total} konsep, pada {labels} label hierarki pengetahuan.',
  st: 'E qobetiloe ho {sampled} ho {total} mohlopong, maphapalong {labels} le labelo tsa hierarchyla tsebohetsoeng.',
  sw: 'Imetokana na {sampled} kati ya {total} dhana, katika {labels} lebo za mpangilio wa maarifa.',
  bn: '{total}টির মধ্যে {sampled}টি ধারণা থেকে প্রাপ্ত, {labels}টি জ্ঞান-শ্রেণি লেবেলে।',
  man: 'E qaqeeqeeq na {sampled} na {total} idee, ni {labels} wooqee hidin hibrid.'
};

function quote(v) {
  // Single quotes unless the text contains one (same rule prettier uses).
  return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

let updated = 0;
const skipped = [];
for (const [code, text] of Object.entries(T)) {
  const file = path.join(DIR, `${code}.js`);
  if (!fs.existsSync(file)) {
    skipped.push(`${code} (no file)`);
    continue;
  }
  const src = fs.readFileSync(file, 'utf8');
  if (/^\s*suggestCoverage:/m.test(src)) {
    skipped.push(`${code} (already present)`);
    continue;
  }
  const lines = src.split('\n');
  const at = lines.findIndex((l) => ANCHOR.test(l));
  if (at === -1) {
    skipped.push(`${code} (no suggestEmpty anchor)`);
    continue;
  }
  const indent = lines[at].match(ANCHOR).groups.indent;
  lines.splice(at + 1, 0, `${indent}suggestCoverage: ${quote(text)},`);
  fs.writeFileSync(file, lines.join('\n'), 'utf8');
  updated += 1;
  console.log(`updated ${code}`);
}
if (skipped.length) console.log(`\nskipped: ${skipped.join(', ')}`);
console.log(`\n${updated} locale(s) updated.`);