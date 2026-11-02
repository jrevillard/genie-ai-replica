// One-shot (2026-10-11): Story 1-8g-u — the tag-less generation guidance
// (okf.headTest.error.noFrontmatter), ×14.
const fs = require('fs');
const path = require('path');
const DIR = 'D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales';

const T = {
  en: 'This repository has no head tags yet — create tags in the Frontmatter panel (or use Suggest tags), then generate a suite.',
  es: 'Este repositorio aún no tiene etiquetas de cabecera: cree etiquetas en el panel Frontmatter (o use Sugerir etiquetas) y luego genere una suite.',
  fr: 'Ce dépôt n’a pas encore de tags de tête — créez des tags dans le panneau Frontmatter (ou utilisez Suggérer des tags), puis générez une suite.',
  de: 'Dieses Repository hat noch keine Head-Tags — erstellen Sie Tags im Frontmatter-Panel (oder über Tag-Vorschläge) und generieren Sie dann eine Suite.',
  pt: 'Este repositório ainda não tem tags de cabeça — crie tags no painel Frontmatter (ou use Sugerir tags) e depois gere uma suíte.',
  ru: 'В этом репозитории ещё нет тегов головы — создайте теги в панели Frontmatter (или через «Предложить теги») и затем сгенерируйте сюит.',
  ar: 'لا توجد وسوم رأس لهذا المستودع بعد — أنشئ الوسوم من لوحة الواجهة الأمامية (أو استخدم اقتراح الوسوم) ثم أنشئ مجموعة.',
  zh: '该仓库还没有头部标签 — 请在 Frontmatter 面板中创建标签（或使用“建议标签”），然后再生成测试集。',
  sw: 'Hazina ya hii bado ina lebe za kichwa — tengeneza lebe kwenye Frontmatter (au tumia Pendekeza lebe), kisha tengeneza vipima.',
  st: 'Sena sena li-tag tsa hloho — etsa li-tag ka Frontmatter (kapa sebelisa Suggest tags), ebe u etsa li-suite.',
  id: 'Repositori ini belum punya tag kepala — buat tag di panel Frontmatter (atau gunakan Sarankan tag), lalu buat suite.',
  bn: 'এই রিপোজিটরিতে এখনও হেড ট্যাগ নেই — Frontmatter প্যানেলে ট্যাগ তৈরি করুন (বা ট্যাগ প্রস্তাব ব্যবহার করুন), তারপর স্যুট তৈরি করুন।',
  th: 'ที่เก็บนี้ยังไม่มีแท็กหัว — สร้างแท็กในแผง Frontmatter (หรือใช้suggestแท็ก) แล้วจึงสร้างชุดทดสอบ',
  man: 'This repository has no head tags yet — create tags in the Frontmatter panel (or use Suggest tags), then generate a suite.'
};

function load(file) {
  return new Function(fs.readFileSync(path.join(DIR, file), 'utf8').replace(/export default/, 'return'))();
}
function jsStr(s) {
  let out = '';
  for (const ch of String(s)) {
    if (ch === '\\') out += '\\\\';
    else if (ch === "'") out += "\\'";
    else if (ch === '\n') out += '\\n';
    else out += ch;
  }
  return "'" + out + "'";
}
function ser(obj, indent) {
  const pad = '  '.repeat(indent);
  const padIn = '  '.repeat(indent + 1);
  const keys = Object.keys(obj);
  if (keys.length === 0) return '{}';
  const lines = keys.map((k) => {
    const v = obj[k];
    const key = /^[A-Za-z0-9_$]+$/.test(k) ? k : jsStr(k);
    if (v && typeof v === 'object') return padIn + key + ': ' + ser(v, indent + 1);
    return padIn + key + ': ' + jsStr(v);
  });
  return '{\n' + lines.join(',\n') + '\n' + pad + '}';
}
function setPath(obj, p, val) {
  const parts = p.split('.');
  let c = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof c[parts[i]] !== 'object' || c[parts[i]] === null) c[parts[i]] = {};
    c = c[parts[i]];
  }
  c[parts[parts.length - 1]] = val;
}

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.js') && f !== 'index.js')) {
  const loc = load(file);
  const locale = file.replace('.js', '');
  const e = loc.okf && loc.okf.headTest && loc.okf.headTest.error;
  if (!e) {
    console.log(file + ': no error section — skipped');
    continue;
  }
  setPath(e, 'noFrontmatter', T[locale] || T.en);
  fs.writeFileSync(path.join(DIR, file), 'export default ' + ser(loc, 0) + ';\n', 'utf8');
  console.log(file + ': ok');
}
console.log('DONE');
