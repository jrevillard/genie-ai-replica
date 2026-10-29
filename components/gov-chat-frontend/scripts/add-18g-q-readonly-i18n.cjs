// 1-8g-q one-shot: reword okf.shell.readonly in every locale — the editor
// pill now says content-only (the head/tags stay editable on a serving
// repo). Exactly one `readonly: '...'` per file (verified before running);
// each file is re-parsed as a module body after the rewrite.
const fs = require('fs');
const path = require('path');
const DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');

const VALUES = {
  en: 'CONTENT READ ONLY — head/tags stay editable',
  es: 'CONTENIDO SOLO LECTURA — head/etiquetas editables',
  fr: 'CONTENU EN LECTURE SEULE — head/étiquettes modifiables',
  de: 'INHALT SCHREIBGESCHÜTZT — Head/Tags bearbeitbar',
  pt: 'CONTEÚDO SOMENTE LEITURA — head/etiquetas editáveis',
  ru: 'СОДЕРЖИМОЕ ТОЛЬКО ДЛЯ ЧТЕНИЯ — head/теги редактируются',
  ar: 'المحتوى للقراءة فقط — يمكن تحرير الرأس والوسوم',
  zh: '内容只读 — 头部/标签可编辑',
  id: 'KONTEN HANYA BACA — head/tag tetap dapat diedit',
  sw: 'MAUDHIRI YA KUSOMA TU — kichwa/lebo zinaweza kuhaririwa',
  th: 'เนื้อหาอ่านอย่างเดียว — แก้ไข head/แท็กได้',
  bn: 'সামগ্রী শুধুমাত্র পঠনযোগ্য — head/ট্যাগ সম্পাদনাযোগ্য',
  man: 'CONTENT READ ONLY — head/tags stay editable',
  st: 'CONTENT READ ONLY — head/tags stay editable'
};

for (const [loc, val] of Object.entries(VALUES)) {
  const p = path.join(DIR, `${loc}.js`);
  const src = fs.readFileSync(p, 'utf8');
  const re = /readonly: '[^']*'/;
  const m = src.match(re);
  if (!m) {
    console.error(`${loc}.js: NO readonly: '...' match — aborting`);
    process.exit(1);
  }
  const occurrences = src.match(new RegExp(re.source, 'g')).length;
  if (occurrences !== 1) {
    console.error(`${loc}.js: ${occurrences} matches — aborting (expected 1)`);
    process.exit(1);
  }
  const escaped = val.replace(/'/g, "\\'");
  const out = src.replace(re, `readonly: '${escaped}'`);
  fs.writeFileSync(p, out, 'utf8');
  // prove it still parses
  // eslint-disable-next-line no-new-func
  new Function(fs.readFileSync(p, 'utf8').replace(/export default/, 'return'))();
  console.log(`${loc}.js → ${val}`);
}
console.log('DONE — all locales re-parsed OK');
