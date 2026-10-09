// One-shot (Story 1-8f): add the saved-suites + row-edit i18n keys to every
// locale. Same load/serialize pattern as add-advisor-i18n-keys.cjs (prettier
// normalizes after). man.js gets English fallback via fill-missing-locale-keys.
const fs = require('fs');
const path = require('path');
const DIR = 'D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales';

const T = {
  en: {
    actions: 'Edit',
    savedTitle: 'Saved suites',
    load: 'Load',
    flipTip: 'Flip should-select / should-NOT-select',
    deleteTip: 'Remove this row from the suite',
    suiteLoad: 'Could not load the suite',
    suiteUpdate: 'Could not update the suite'
  },
  fr: {
    actions: 'Modifier',
    savedTitle: 'Suites enregistrées',
    load: 'Charger',
    flipTip: 'Basculer doit-sélectionner / ne-doit-pas-sélectionner',
    deleteTip: 'Retirer cette ligne de la suite',
    suiteLoad: 'Impossible de charger la suite',
    suiteUpdate: 'Impossible de mettre à jour la suite'
  },
  es: {
    actions: 'Editar',
    savedTitle: 'Suites guardadas',
    load: 'Cargar',
    flipTip: 'Cambiar debe-seleccionar / no-debe-seleccionar',
    deleteTip: 'Quitar esta fila de la suite',
    suiteLoad: 'No se pudo cargar la suite',
    suiteUpdate: 'No se pudo actualizar la suite'
  },
  de: {
    actions: 'Bearbeiten',
    savedTitle: 'Gespeicherte Suiten',
    load: 'Laden',
    flipTip: 'Wechseln zwischen soll-selektieren / nicht-selektieren',
    deleteTip: 'Diese Zeile aus der Suite entfernen',
    suiteLoad: 'Suite konnte nicht geladen werden',
    suiteUpdate: 'Suite konnte nicht aktualisiert werden'
  },
  pt: {
    actions: 'Editar',
    savedTitle: 'Suítes salvas',
    load: 'Carregar',
    flipTip: 'Alternar deve-selecionar / não-deve-selecionar',
    deleteTip: 'Remover esta linha da suíte',
    suiteLoad: 'Não foi possível carregar a suíte',
    suiteUpdate: 'Não foi possível atualizar a suíte'
  },
  ru: {
    tags: 'Правка',
    actions: 'Правка',
    savedTitle: 'Сохранённые наборы',
    load: 'Загрузить',
    flipTip: 'Переключить должна-выбираться / не-должна-выбираться',
    deleteTip: 'Убрать эту строку из набора',
    suiteLoad: 'Не удалось загрузить набор',
    suiteUpdate: 'Не удалось обновить набор'
  },
  ar: {
    actions: 'تعديل',
    savedTitle: 'المجموعات المحفوظة',
    load: 'تحميل',
    flipTip: 'التبديل بين يجب-اختياره / يجب-عدم-اختياره',
    deleteTip: 'إزالة هذا الصف من المجموعة',
    suiteLoad: 'تعذر تحميل المجموعة',
    suiteUpdate: 'تعذر تحديث المجموعة'
  },
  zh: {
    actions: '编辑',
    savedTitle: '已保存的测试集',
    load: '加载',
    flipTip: '切换 应选择 / 不应选择',
    deleteTip: '从测试集中移除此行',
    suiteLoad: '无法加载测试集',
    suiteUpdate: '无法更新测试集'
  },
  sw: {
    actions: 'Hariri',
    savedTitle: 'Vipima vilivyohifadhiwa',
    load: 'Pakia',
    flipTip: 'Badilisha iwe-chaguliwe / isiwe-chaguliwe',
    deleteTip: 'Ondoa mstari huu kwenye kipima',
    suiteLoad: 'Imeshindikana kupakia kipima',
    suiteUpdate: 'Imeshindikana kusasisha kipima'
  },
  st: {
    actions: 'Lokisa',
    savedTitle: 'Liteko tse bolokiloeng',
    load: 'Jarisa',
    flipTip: 'Fetola lokisa ho khetha / se khethe',
    deleteTip: 'Tlosa mola ona seteng',
    suiteLoad: 'Ho hlolehile ho jarisa sete',
    suiteUpdate: 'Ho hlolehile ho ntlafatsa sete'
  },
  id: {
    actions: 'Edit',
    savedTitle: 'Suite tersimpan',
    load: 'Muat',
    flipTip: 'Balikkan harus-dipilih / tidak-harus-dipilih',
    deleteTip: 'Hapus baris ini dari suite',
    suiteLoad: 'Gagal memuat suite',
    suiteUpdate: 'Gagal memperbarui suite'
  },
  bn: {
    actions: 'সম্পাদনা',
    savedTitle: 'সংরক্ষিত suite',
    load: 'লোড করুন',
    flipTip: 'নির্বাচন-করবে / নির্বাচন-করবে-না উল্টে দিন',
    deleteTip: 'suite থেকে এই সারিটি সরান',
    suiteLoad: 'suite লোড করা যায়নি',
    suiteUpdate: 'suite আপডেট করা যায়নি'
  },
  th: {
    actions: 'แก้ไข',
    savedTitle: 'ชุดทดสอบที่บันทึกไว้',
    load: 'โหลด',
    flipTip: 'สลับ ควรเลือก / ไม่ควรเลือก',
    deleteTip: 'นำแถวนี้ออกจากชุดทดสอบ',
    suiteLoad: 'โหลดชุดทดสอบไม่สำเร็จ',
    suiteUpdate: 'อัปเดตชุดทดสอบไม่สำเร็จ'
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
    console.log(file + ': NO TRANSLATIONS — skipped');
    continue;
  }
  const loc = loadLocale(file);
  setPath(loc, 'okf.headTest.suites.col.actions', t.actions);
  setPath(loc, 'okf.headTest.suites.savedTitle', t.savedTitle);
  setPath(loc, 'okf.headTest.suites.load', t.load);
  setPath(loc, 'okf.headTest.suites.flipTip', t.flipTip);
  setPath(loc, 'okf.headTest.suites.deleteTip', t.deleteTip);
  setPath(loc, 'okf.headTest.error.suiteLoad', t.suiteLoad);
  setPath(loc, 'okf.headTest.error.suiteUpdate', t.suiteUpdate);
  fs.writeFileSync(path.join(DIR, file), 'export default ' + serialize(loc, 0) + ';\n', 'utf8');
  console.log(file + ': ok');
}
console.log('DONE');
