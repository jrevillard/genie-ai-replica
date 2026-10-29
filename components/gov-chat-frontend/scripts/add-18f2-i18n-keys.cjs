// One-shot (Story 1-8f part 2): suite-name i18n keys to every locale.
const fs = require('fs');
const path = require('path');
const DIR = 'D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales';

const T = {
  en: {
    namePlaceholder: 'Suite name (optional) — e.g. NCD regression set',
    colName: 'Name',
    suiteRename: 'Could not rename the suite'
  },
  fr: {
    namePlaceholder: 'Nom de la suite (facultatif) — ex. ensemble de régression NCD',
    colName: 'Nom',
    suiteRename: 'Impossible de renommer la suite'
  },
  es: {
    namePlaceholder: 'Nombre de la suite (opcional): p. ej. conjunto de regresión ECD',
    colName: 'Nombre',
    suiteRename: 'No se pudo renombrar la suite'
  },
  de: {
    namePlaceholder: 'Suiten-Name (optional) — z. B. NCD-Regressionssatz',
    colName: 'Name',
    suiteRename: 'Suite konnte nicht umbenannt werden'
  },
  pt: {
    namePlaceholder: 'Nome da suíte (opcional) — ex. conjunto de regressão DCNT',
    colName: 'Nome',
    suiteRename: 'Não foi possível renomear a suíte'
  },
  ru: {
    namePlaceholder: 'Имя набора (необязательно) — напр. регрессионный набор НИЗ',
    colName: 'Имя',
    suiteRename: 'Не удалось переименовать набор'
  },
  ar: {
    namePlaceholder: 'اسم المجموعة (اختياري) — مثال: مجموعة انحدار الأمراض غير السارية',
    colName: 'الاسم',
    suiteRename: 'تعذر إعادة تسمية المجموعة'
  },
  zh: { namePlaceholder: '测试集名称（可选）— 例如：NCD 回归集', colName: '名称', suiteRename: '无法重命名测试集' },
  sw: {
    namePlaceholder: 'Jina la kipima (si lazima) — mf. seti ya urejesho wa NCD',
    colName: 'Jina',
    suiteRename: 'Imeshindikana kubadilisha jina la kipima'
  },
  st: {
    namePlaceholder: 'Lebitso la sete (ha ho hlokahale) — mohl. sete ea NCD',
    colName: 'Lebitso',
    suiteRename: 'Ho hlolehile ho reha sete ka lebitso le lecha'
  },
  id: {
    namePlaceholder: 'Nama suite (opsional) — mis. set regresi NCD',
    colName: 'Nama',
    suiteRename: 'Gagal mengganti nama suite'
  },
  bn: {
    namePlaceholder: 'Suite-এর নাম (ঐচ্ছিক) — যেমন NCD রিগ্রেশন সেট',
    colName: 'নাম',
    suiteRename: 'suite-এর নাম পরিবর্তন করা যায়নি'
  },
  th: {
    namePlaceholder: 'ชื่อชุดทดสอบ (ไม่บังคับ) — เช่น ชุดทดสอบย้อนหลัง NCD',
    colName: 'ชื่อ',
    suiteRename: 'เปลี่ยนชื่อชุดทดสอบไม่สำเร็จ'
  },
  // man.js is English-fallback — filled by fill-missing-locale-keys.
  man: null
};

function loadLocale(file) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8');
  return new Function(src.replace(/export default/, 'return'))();
}
function setPath(obj, p, val) {
  const parts = p.split('.');
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== 'object' || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = val;
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
  const t = T[file.replace('.js', '')];
  if (!t) {
    console.log(file + ': skipped');
    continue;
  }
  const loc = loadLocale(file);
  setPath(loc, 'okf.headTest.suites.namePlaceholder', t.namePlaceholder);
  setPath(loc, 'okf.headTest.suites.col.name', t.colName);
  setPath(loc, 'okf.headTest.error.suiteRename', t.suiteRename);
  fs.writeFileSync(path.join(DIR, file), 'export default ' + serialize(loc, 0) + ';\n', 'utf8');
  console.log(file + ': ok');
}
console.log('DONE');
