// One-shot (Story 1-8e): add the tagset-history + apply-flow i18n keys to
// every locale. Same load/serialize pattern as add-advisor-i18n-keys.cjs
// (prettier normalizes after). man.js gets English fallback via
// fill-missing-locale-keys.cjs afterwards.
const fs = require('fs');
const path = require('path');
const DIR = 'D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales';

const T = {
  en: {
    tags: 'Tags',
    tip: 'Forbidden tags for this run',
    noSuite: 'Generate a suite first, then rebuild + re-run.',
    applyNoSuite: 'Tags saved and the head rebuilt — generate a suite, then Run all to see the effect.',
    applying: 'Applying: saving tags, rebuilding the head, re-running the suite…'
  },
  fr: {
    tags: 'Tags',
    tip: 'Tags interdits pour cette exécution',
    noSuite: "Générez d'abord une suite, puis reconstruisez et relancez.",
    applyNoSuite: 'Tags enregistrés et tête reconstruite — générez une suite, puis lancez tout pour voir l’effet.',
    applying: 'Application : enregistrement des tags, reconstruction de la tête, relance de la suite…'
  },
  es: {
    tags: 'Etiquetas',
    tip: 'Etiquetas prohibidas de esta ejecución',
    noSuite: 'Genera primero una suite y luego reconstruye y relanza.',
    applyNoSuite: 'Etiquetas guardadas y head reconstruido: genera una suite y ejecuta todo para ver el efecto.',
    applying: 'Aplicando: guardando etiquetas, reconstruyendo el head, relanzando la suite…'
  },
  de: {
    tags: 'Tags',
    tip: 'Sperr-Tags dieses Laufs',
    noSuite: 'Erstellen Sie zuerst eine Suite, dann Head neu bauen & neu ausführen.',
    applyNoSuite:
      'Tags gespeichert und Head neu gebaut — erstellen Sie eine Suite und führen Sie alles aus, um den Effekt zu sehen.',
    applying: 'Anwenden: Tags speichern, Head neu bauen, Suite neu ausführen…'
  },
  pt: {
    tags: 'Tags',
    tip: 'Tags proibidas desta execução',
    noSuite: 'Gere primeiro uma suíte e depois reconstrua e execute novamente.',
    applyNoSuite: 'Tags salvas e head reconstruído — gere uma suíte e execute tudo para ver o efeito.',
    applying: 'Aplicando: salvando tags, reconstruindo o head, executando novamente a suíte…'
  },
  ru: {
    tags: 'Теги',
    tip: 'Запрещённые теги этого запуска',
    noSuite: 'Сначала создайте набор тестов, затем пересоберите и перезапустите.',
    applyNoSuite: 'Теги сохранены, head пересобран — создайте набор тестов и запустите его, чтобы увидеть эффект.',
    applying: 'Применение: сохранение тегов, пересборка head, повторный запуск набора…'
  },
  ar: {
    tags: 'الوسوم',
    tip: 'الوسوم المحظورة لهذا التشغيل',
    noSuite: 'أنشئ مجموعة اختبارات أولاً، ثم أعد بناء head وأعد التشغيل.',
    applyNoSuite: 'تم حفظ الوسوم وإعادة بناء head — أنشئ مجموعة اختبارات ثم شغّل الكل لرؤية التأثير.',
    applying: 'جارٍ التطبيق: حفظ الوسوم، إعادة بناء head، إعادة تشغيل المجموعة…'
  },
  zh: {
    tags: '标签',
    tip: '本次运行的禁止标签',
    noSuite: '请先生成测试集，然后重建并重新运行。',
    applyNoSuite: '标签已保存、head 已重建——请生成测试集并运行全部以查看效果。',
    applying: '正在应用：保存标签、重建 head、重新运行测试集…'
  },
  sw: {
    tags: 'Tag',
    tip: 'Tag zilizozuiwa za ukimbiaji huu',
    noSuite: 'Tengeneza kipima kwanza, kisha jenga upya na endesha upya.',
    applyNoSuite: 'Tag zimehifadhiwa na head imejengwa upya — tengeneza kipima kisha endesha zote ili kuona matokeo.',
    applying: 'Inatekeleza: kuhifadhi tag, kujenga upya head, kuendesha upya kipima…'
  },
  st: {
    tags: 'Matag',
    tip: 'Litag tse thibetsoeng tsa tsamaello ena',
    noSuite: 'Qala ka ho etsa sete ea liteko, ebe haha hlooho hape u phethahatse hape.',
    applyNoSuite:
      'Matag a bolokiloe mme hlooho e ahiloe hape — etsa sete ea liteko ebe phethahatsa tsohle ho bona sehlaho.',
    applying: 'E sebelisa: ho boloka matag, ho haha hlooho hape, ho phethahatsa sete hape…'
  },
  id: {
    tags: 'Tag',
    tip: 'Tag terlarang untuk eksekusi ini',
    noSuite: 'Buat suite terlebih dahulu, lalu bangun ulang dan jalankan ulang.',
    applyNoSuite: 'Tag tersimpan dan head dibangun ulang — buat suite lalu jalankan semua untuk melihat efeknya.',
    applying: 'Menerapkan: menyimpan tag, membangun ulang head, menjalankan ulang suite…'
  },
  bn: {
    tags: 'ট্যাগ',
    tip: 'এই রানের নিষিদ্ধ ট্যাগ',
    noSuite: 'প্রথমে একটি suite তৈরি করুন, তারপর পুনর্নির্মাণ ও পুনরায় চালান।',
    applyNoSuite: 'ট্যাগ সংরক্ষিত ও head পুনর্নির্মিত — প্রভাব দেখতে একটি suite তৈরি করে সব চালান।',
    applying: 'প্রয়োগ চলছে: ট্যাগ সংরক্ষণ, head পুনর্নির্মাণ, suite পুনরায় চালানো…'
  },
  th: {
    tags: 'แท็ก',
    tip: 'แท็กต้องห้ามของการรันนี้',
    noSuite: 'สร้างชุดทดสอบก่อน จากนั้นจึงสร้างใหม่และรันซ้ำ',
    applyNoSuite: 'บันทึกแท็กและสร้าง head ใหม่แล้ว — สร้างชุดทดสอบแล้วรันทั้งหมดเพื่อดูผล',
    applying: 'กำลังใช้งาน: บันทึกแท็ก สร้าง head ใหม่ รันชุดทดสอบซ้ำ…'
  },
  // man.js is English-fallback throughout — filled by fill-missing-locale-keys.cjs.
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
  const code = file.replace('.js', '');
  const t = T[code];
  if (!t) {
    console.log(file + ': NO TRANSLATIONS — skipped');
    continue;
  }
  const loc = loadLocale(file);
  const before =
    JSON.stringify(Object.keys(loc.okf.headTest.suites.col).length) +
    '/' +
    Object.keys(loc.okf.headTest.advisor).length;
  setPath(loc, 'okf.headTest.suites.col.tags', t.tags);
  setPath(loc, 'okf.headTest.suites.tagsetTip', t.tip);
  setPath(loc, 'okf.headTest.error.noSuite', t.noSuite);
  setPath(loc, 'okf.headTest.error.applyNoSuite', t.applyNoSuite);
  setPath(loc, 'okf.headTest.advisor.applying', t.applying);
  fs.writeFileSync(path.join(DIR, file), 'export default ' + serialize(loc, 0) + ';\n', 'utf8');
  console.log(file + ': ok (was suites.col=' + before + ')');
}
console.log('DONE');
