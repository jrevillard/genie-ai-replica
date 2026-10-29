// One-shot (2026-10-10): the concept editor's frontmatter bar gains a
// repo-tags scope hint (the live "saved in the wizard, empty in the editor"
// confusion — repo tags live on the repo, the per-concept form shows the
// concept's own YAML only). man.js keeps its English fallback.
const fs = require('fs');
const path = require('path');
const DIR = 'D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales';

const T = {
  en: 'Repository-level tags ({summary}) live on the repo, not this concept — manage them in the Tags panel in the right rail.',
  fr: 'Les tags de niveau dépôt ({summary}) appartiennent au dépôt, pas à ce concept — gérez-les dans le panneau Tags du rail droit.',
  es: 'Las etiquetas a nivel de repositorio ({summary}) viven en el repositorio, no en este concepto — gestiónelas en el panel de etiquetas del raíl derecho.',
  de: 'Tags auf Repository-Ebene ({summary}) gehören zum Repository, nicht zu diesem Konzept — verwalten Sie sie im Tags-Panel in der rechten Leiste.',
  pt: 'Etiquetas ao nível do repositório ({summary}) pertencem ao repositório, não a este conceito — gerencie-as no painel de etiquetas na barra direita.',
  ru: 'Теги уровня репозитория ({summary}) живут в репозитории, а не в этом концепте — управляйте ими в панели тегов правой панели.',
  ar: 'الوسوم على مستوى المستودع ({summary}) تخص المستودع وليس هذا المفهوم — أدرها من لوحة الوسوم في الشريط الأيمن.',
  zh: '仓库级标签（{summary}）属于仓库而非此概念——请在右侧栏的标签面板中管理。',
  sw: 'Lebe za kiwango cha hazina ({summary}) ni za hazina, si la dhana hii — dhibiti kutoka kipanele cha lebe kwenye reli ya kulia.',
  st: 'Malaete a bofmating oa repo ({summary}) ke a repo, eseng sa tengollo — laola tsona panelleng ya malaete Mooreng o o jang.',
  id: 'Tag tingkat repositori ({summary}) milik repositori, bukan konsep ini — kelola di panel Tag di rail kanan.',
  bn: 'রিপোজিটরি-স্তরের ট্যাগ ({summary}) রিপোজিটরির, এই কনসেপ্টের নয় — ডানদিকের রেলের ট্যাগ প্যানেলে পরিচালনা করুন।',
  th: 'แท็กระดับรีปอซิทอรี ({summary}) เป็นของรีปอ — ไม่ใช่ของคอนเซปต์นี้ จัดการที่แผงแท็กในแถบด้านขวา'
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
    else if (ch === '\r') out += '\\r';
    else if (ch === '\t') out += '\\t';
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
  const t = T[locale] || T.en;
  const ht = loc.okf && loc.okf.fm;
  if (!ht) {
    console.log(file + ': no okf.fm — skipped');
    continue;
  }
  setPath(ht, 'repoTagsHint', t);
  fs.writeFileSync(path.join(DIR, file), 'export default ' + ser(loc, 0) + ';\n', 'utf8');
  console.log(file + ': ok');
}
console.log('DONE');
