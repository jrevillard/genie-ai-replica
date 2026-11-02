// One-shot (2026-10-10): Story 1-8g i18n — the Lab click-test (corpus
// probe), the Corpus column, and suite delete, in every locale.
// man.js keeps its English-fallback convention.
const fs = require('fs');
const path = require('path');
const DIR = 'D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales';

const T = {
  en: {
    corpus: 'Corpus',
    probeTip: 'Test this query against the live corpus',
    delSuiteTip: 'Delete this suite and its run history',
    answerable: 'answerable',
    weak: 'weak match',
    unanswerable: 'not in corpus',
    unknown: 'unknown',
    errProbe: 'Corpus test failed',
    errDelete: 'Could not delete the suite'
  },
  fr: {
    corpus: 'Corpus',
    probeTip: 'Tester cette requête sur le corpus réel',
    delSuiteTip: 'Supprimer cette suite et son historique',
    answerable: 'répondable',
    weak: 'correspondance faible',
    unanswerable: 'absent du corpus',
    unknown: 'inconnu',
    errProbe: 'Échec du test du corpus',
    errDelete: 'Impossible de supprimer la suite'
  },
  es: {
    corpus: 'Corpus',
    probeTip: 'Probar esta consulta contra el corpus real',
    delSuiteTip: 'Eliminar esta suite y su historial',
    answerable: 'respondible',
    weak: 'coincidencia débil',
    unanswerable: 'no está en el corpus',
    unknown: 'desconocido',
    errProbe: 'Falló la prueba del corpus',
    errDelete: 'No se pudo eliminar la suite'
  },
  de: {
    corpus: 'Korpus',
    probeTip: 'Diese Abfrage gegen den Live-Korpus testen',
    delSuiteTip: 'Diese Suite und ihren Verlauf löschen',
    answerable: 'beantwortbar',
    weak: 'schwache Übereinstimmung',
    unanswerable: 'nicht im Korpus',
    unknown: 'unbekannt',
    errProbe: 'Korpus-Test fehlgeschlagen',
    errDelete: 'Suite konnte nicht gelöscht werden'
  },
  pt: {
    corpus: 'Corpus',
    probeTip: 'Testar esta consulta no corpus real',
    delSuiteTip: 'Excluir esta suíte e seu histórico',
    answerable: 'respondível',
    weak: 'correspondência fraca',
    unanswerable: 'não está no corpus',
    unknown: 'desconhecido',
    errProbe: 'Falha no teste do corpus',
    errDelete: 'Não foi possível excluir a suíte'
  },
  ru: {
    corpus: 'Корпус',
    probeTip: 'Проверить этот запрос на живом корпусе',
    delSuiteTip: 'Удалить этот набор и его историю',
    answerable: 'ответ найдётся',
    weak: 'слабое совпадение',
    unanswerable: 'нет в корпусе',
    unknown: 'неизвестно',
    errProbe: 'Ошибка проверки корпуса',
    errDelete: 'Не удалось удалить набор'
  },
  ar: {
    corpus: 'المتن',
    probeTip: 'اختبر هذا الاستعلام ضد المتن الحي',
    delSuiteTip: 'احذف هذه المجموعة وسجلها',
    answerable: 'قابلة للإجابة',
    weak: 'مطابقة ضعيفة',
    unanswerable: 'غير موجود في المتن',
    unknown: 'غير معروف',
    errProbe: 'فشل اختبار المتن',
    errDelete: 'تعذر حذف المجموعة'
  },
  zh: {
    corpus: '语料',
    probeTip: '用真实语料测试此查询',
    delSuiteTip: '删除此测试集及其历史',
    answerable: '可回答',
    weak: '弱匹配',
    unanswerable: '语料中无此内容',
    unknown: '未知',
    errProbe: '语料测试失败',
    errDelete: '无法删除测试集'
  },
  sw: {
    corpus: 'Korpusi',
    probeTip: 'Jaribu swali hili kwa korpusi hai',
    delSuiteTip: 'Futa kipima hiki na historia yake',
    answerable: 'ina jibu',
    weak: 'mfanano dhaifu',
    unanswerable: 'haipo kwenye korpusi',
    unknown: 'haijulikani',
    errProbe: 'Jaribio la korpusi limefaili',
    errDelete: 'Imeshindwa kufuta kipima'
  },
  st: {
    corpus: 'Korpusi',
    probeTip: 'Lekola potso ena ka korpusi ea ntseng e le teng',
    delSuiteTip: 'Tlosa sete sena le nalane ea sona',
    answerable: 'e ka araba',
    weak: 'tsʼebetso e sa matla',
    unanswerable: 'ha e korpusing',
    unknown: 'ea sa tsejoeng',
    errProbe: 'Lekala la korpusi le hlotsoe',
    errDelete: 'Ha e khone ho tlosa sete'
  },
  id: {
    corpus: 'Korpus',
    probeTip: 'Uji kueri ini terhadap korpus langsung',
    delSuiteTip: 'Hapus suite ini dan riwayatnya',
    answerable: 'bisa dijawab',
    weak: 'kecocokan lemah',
    unanswerable: 'tidak ada di korpus',
    unknown: 'tidak diketahui',
    errProbe: 'Uji korpus gagal',
    errDelete: 'Tidak dapat menghapus suite'
  },
  bn: {
    corpus: 'কর্পাস',
    probeTip: 'প্রকৃত কর্পাসের বিরুদ্ধে এই কোয়েরি পরীক্ষা করুন',
    delSuiteTip: 'এই suite ও তার ইতিহাস মুছুন',
    answerable: 'উত্তর আছে',
    weak: 'দুর্বল মিল',
    unanswerable: 'কর্পাসে নেই',
    unknown: 'অজানা',
    errProbe: 'কর্পাস পরীক্ষা ব্যর্থ',
    errDelete: 'suite মুছতে ব্যর্থ'
  },
  th: {
    corpus: 'คลังข้อมูล',
    probeTip: 'ทดสอบคำถามนี้กับคลังข้อมูลจริง',
    delSuiteTip: 'ลบชุดทดสอบนี้และประวัติของมัน',
    answerable: 'ตอบได้',
    weak: 'ตรงกันบางส่วน',
    unanswerable: 'ไม่มีในคลังข้อมูล',
    unknown: 'ไม่ทราบ',
    errProbe: 'การทดสอบคลังข้อมูลล้มเหลว',
    errDelete: 'ลบชุดทดสอบไม่สำเร็จ'
  }
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
  const ht = loc.okf && loc.okf.headTest;
  if (!ht) {
    console.log(file + ': no headTest — skipped');
    continue;
  }
  setPath(ht, 'suites.col.corpus', t.corpus);
  setPath(ht, 'suites.probeTip', t.probeTip);
  setPath(ht, 'suites.deleteSuiteTip', t.delSuiteTip);
  setPath(ht, 'probe.answerable', t.answerable);
  setPath(ht, 'probe.weak', t.weak);
  setPath(ht, 'probe.unanswerable', t.unanswerable);
  setPath(ht, 'probe.unknown', t.unknown);
  setPath(ht, 'error.probe', t.errProbe);
  setPath(ht, 'error.suiteDelete', t.errDelete);
  fs.writeFileSync(path.join(DIR, file), 'export default ' + ser(loc, 0) + ';\n', 'utf8');
  console.log(file + ': ok');
}
console.log('DONE');
