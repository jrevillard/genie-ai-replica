// One-shot (2026-10-10, live 409): the corpus probe needs an INGESTED
// corpus — the Lab gates the ▶ button + states the reason. This is the
// suites.corpusNeedsIngest key in every locale. man.js = English fallback.
const fs = require('fs');
const path = require('path');
const DIR = 'D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales';

const T = {
  en: 'Ingest the repository first — the corpus test searches the ingested corpus',
  fr: "Ingérez d'abord le dépôt — le test du corpus interroge le corpus ingéré",
  es: 'Ingera primero el repositorio — la prueba del corpus busca en el corpus ingerido',
  de: 'Inigieren Sie zuerst das Repository — der Korpus-Test durchsucht den inginierten Korpus',
  pt: 'Primeiro ingira o repositório — o teste do corpus busca no corpus ingerido',
  ru: 'Сначала загрузите репозиторий — тест корпуса ищет по загруженному корпусу',
  ar: 'قم أولاً باستيعاب المستودع — اختبار المتن يبحث في المتن المستوعب',
  zh: '请先摄取仓库——语料测试搜索的是已摄取的语料',
  sw: 'Ingiza hazina kwanza — jaribio la korpusi hutafuta korpusi iliyoingizwa',
  st: 'Kennya ntswe pele — lekala la korpusi le batla korpusing e kennyang',
  id: 'Ingest repositori dulu — uji korpus mencari di korpus yang sudah di-ingest',
  bn: 'প্রথমে রিপোজিটরি ইনজেস্ট করুন — কর্পাস পরীক্ষা ইনজেস্ট করা কর্পাসে খোঁজে',
  th: 'โปรด ingest รีปอซิทอรีก่อน — การทดสอบคลังข้อมูลค้นจากคลังที่ ingest แล้ว'
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
  const t = T[locale] || T.en;
  const s = loc.okf && loc.okf.headTest && loc.okf.headTest.suites;
  if (!s) {
    console.log(file + ': no suites — skipped');
    continue;
  }
  setPath(s, 'corpusNeedsIngest', t);
  fs.writeFileSync(path.join(DIR, file), 'export default ' + ser(loc, 0) + ';\n', 'utf8');
  console.log(file + ': ok');
}
console.log('DONE');
