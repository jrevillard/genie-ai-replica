// One-shot (2026-10-10): Story 1-8g — i18n keys for the click-test summary
// panel (title, legs, reason context, files, top-chunks table), every locale.
// man.js keeps its English-fallback convention; domain terms ("Head") stay
// untranslated per the existing tab.head convention.
const fs = require('fs');
const path = require('path');
const DIR = 'D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales';

const T = {
  en: {
    title: 'Corpus test — summary',
    close: 'Close the summary',
    chunksScanned: 'corpus chunks scanned',
    headLeg: 'Head verdict',
    headNotClaimed: 'does not claim',
    corpusLeg: 'Corpus coverage',
    files: 'Reference files',
    colScore: 'Rerank score',
    colFile: 'File',
    colContent: 'Chunk content'
  },
  fr: {
    title: 'Test du corpus — résumé',
    close: 'Fermer le résumé',
    chunksScanned: 'segments du corpus analysés',
    headLeg: 'Verdict Head',
    headNotClaimed: 'sans attribution',
    corpusLeg: 'Couverture du corpus',
    files: 'Fichiers de référence',
    colScore: 'Score de rerank',
    colFile: 'Fichier',
    colContent: 'Contenu du segment'
  },
  es: {
    title: 'Prueba del corpus — resumen',
    close: 'Cerrar el resumen',
    chunksScanned: 'fragmentos del corpus analizados',
    headLeg: 'Veredicto Head',
    headNotClaimed: 'sin atribución',
    corpusLeg: 'Cobertura del corpus',
    files: 'Archivos de referencia',
    colScore: 'Puntuación de rerank',
    colFile: 'Archivo',
    colContent: 'Contenido del fragmento'
  },
  de: {
    title: 'Korpus-Test — Zusammenfassung',
    close: 'Zusammenfassung schließen',
    chunksScanned: 'Korpus-Chunks durchsucht',
    headLeg: 'Head-Urteil',
    headNotClaimed: 'keine Zuordnung',
    corpusLeg: 'Korpus-Abdeckung',
    files: 'Referenzdateien',
    colScore: 'Rerank-Score',
    colFile: 'Datei',
    colContent: 'Chunk-Inhalt'
  },
  pt: {
    title: 'Teste do corpus — resumo',
    close: 'Fechar o resumo',
    chunksScanned: 'fragmentos do corpus analisados',
    headLeg: 'Veredito Head',
    headNotClaimed: 'sem atribuição',
    corpusLeg: 'Cobertura do corpus',
    files: 'Arquivos de referência',
    colScore: 'Pontuação de rerank',
    colFile: 'Arquivo',
    colContent: 'Conteúdo do fragmento'
  },
  ru: {
    title: 'Проверка корпуса — сводка',
    close: 'Закрыть сводку',
    chunksScanned: 'фрагментов корпуса проверено',
    headLeg: 'Вердикт Head',
    headNotClaimed: 'без привязки',
    corpusLeg: 'Покрытие корпуса',
    files: 'Файлы-источники',
    colScore: 'Оценка rerank',
    colFile: 'Файл',
    colContent: 'Содержимое фрагмента'
  },
  ar: {
    title: 'اختبار المتن — ملخص',
    close: 'إغلاق الملخص',
    chunksScanned: 'مقاطع المتن المفحوصة',
    headLeg: 'حكم Head',
    headNotClaimed: 'بدون إسناد',
    corpusLeg: 'تغطية المتن',
    files: 'ملفات مرجعية',
    colScore: 'نتيجة إعادة الترتيب',
    colFile: 'ملف',
    colContent: 'محتوى المقطع'
  },
  zh: {
    title: '语料测试 — 摘要',
    close: '关闭摘要',
    chunksScanned: '个语料块已扫描',
    headLeg: 'Head 判定',
    headNotClaimed: '未归属',
    corpusLeg: '语料覆盖',
    files: '参考文件',
    colScore: '重排序得分',
    colFile: '文件',
    colContent: '块内容'
  },
  sw: {
    title: 'Jaribio la korpusi — muhtasari',
    close: 'Funga muhtasari',
    chunksScanned: 'vipande vya korpusi vimekaguliwa',
    headLeg: 'Uamuzi wa Head',
    headNotClaimed: 'haitambuliwi',
    corpusLeg: 'Ufunivu wa korpusi',
    files: 'Marejeleo ya faili',
    colScore: 'Alama ya rerank',
    colFile: 'Faili',
    colContent: 'Maudhui ya kipande'
  },
  st: {
    title: 'Lekala la korpusi — kakaretso',
    close: 'Kwala kakaretso',
    chunksScanned: 'liphisego tsa korpusi li hlahlobiloe',
    headLeg: 'Uamuzi oa Head',
    headNotClaimed: 'ha ho boikakabelo',
    corpusLeg: 'Tšireletseho ea korpusi',
    files: 'Lifaele tsa motheo',
    colScore: 'Sekala sa rerank',
    colFile: 'Faele',
    colContent: 'Tsa kahare tsa phisege'
  },
  id: {
    title: 'Uji korpus — ringkasan',
    close: 'Tutup ringkasan',
    chunksScanned: 'potongan korpus dipindai',
    headLeg: 'Putusan Head',
    headNotClaimed: 'tanpa klaim',
    corpusLeg: 'Cakupan korpus',
    files: 'File referensi',
    colScore: 'Skor rerank',
    colFile: 'File',
    colContent: 'Isi potongan'
  },
  bn: {
    title: 'কর্পাস পরীক্ষা — সারসংক্ষেপ',
    close: 'সারসংক্ষেপ বন্ধ করুন',
    chunksScanned: 'টি কর্পাস চাঙ্ক স্ক্যান হয়েছে',
    headLeg: 'Head রায়',
    headNotClaimed: 'দাবি নেই',
    corpusLeg: 'কর্পাস কভারেজ',
    files: 'রেফারেন্স ফাইল',
    colScore: 'Rerank স্কোর',
    colFile: 'ফাইল',
    colContent: 'চাঙ্কের বিষয়বস্তু'
  },
  th: {
    title: 'การทดสอบคลังข้อมูล — สรุป',
    close: 'ปิดสรุป',
    chunksScanned: 'ชังก์ที่สแกนจากคลังข้อมูล',
    headLeg: 'คำตัดสิน Head',
    headNotClaimed: 'ไม่ระบุกราฟ',
    corpusLeg: 'การครอบคลุมคลังข้อมูล',
    files: 'ไฟล์อ้างอิง',
    colScore: 'คะแนน rerank',
    colFile: 'ไฟล์',
    colContent: 'เนื้อหาชังก์'
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
  setPath(ht, 'probe.title', t.title);
  setPath(ht, 'probe.close', t.close);
  setPath(ht, 'probe.chunksScanned', t.chunksScanned);
  setPath(ht, 'probe.headLeg', t.headLeg);
  setPath(ht, 'probe.headNotClaimed', t.headNotClaimed);
  setPath(ht, 'probe.corpusLeg', t.corpusLeg);
  setPath(ht, 'probe.files', t.files);
  setPath(ht, 'probe.colScore', t.colScore);
  setPath(ht, 'probe.colFile', t.colFile);
  setPath(ht, 'probe.colContent', t.colContent);
  fs.writeFileSync(path.join(DIR, file), 'export default ' + ser(loc, 0) + ';\n', 'utf8');
  console.log(file + ': ok');
}
console.log('DONE');
