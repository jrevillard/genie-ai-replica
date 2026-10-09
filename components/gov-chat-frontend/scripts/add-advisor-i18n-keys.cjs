// One-shot (Story 1-8d): add the headTest advisor + suites.removeTag +
// error.advisor keys to every locale, with per-language translations.
// Same load/serialize pattern as fill-missing-locale-keys.cjs (prettier
// normalizes after). man.js stays English-fallback, matching its file.
const fs = require('fs');
const path = require('path');
const DIR = 'D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales';

// suites.removeTag, error.advisor, and the advisor block per locale.
const T = {
  en: {
    removeTag: 'Remove from forbidden tags',
    run: 'Advisor: recommend tag changes',
    busy: 'Simulating tag changes across recent runs…',
    title: 'Tag-set recommendation (simulated across recent runs)',
    apply: 'Apply changes & rebuild & re-run suite',
    scorecard: 'positives {p}/{pt} claimed · negatives {n}/{nt} suppressed',
    now: 'Now',
    predicted: 'predicted',
    scope: ' (across {q} queries from the last {r} runs)',
    err: 'Advisor failed'
  },
  fr: {
    removeTag: 'Retirer des tags interdits',
    run: 'Conseiller : recommander des changements de tags',
    busy: 'Simulation des changements de tags sur les exécutions récentes…',
    title: 'Recommandation de jeu de tags (simulée sur les exécutions récentes)',
    apply: 'Appliquer les changements, reconstruire et relancer la suite',
    scorecard: 'positifs {p}/{pt} acceptés · négatifs {n}/{nt} supprimés',
    now: 'Actuellement',
    predicted: 'prédit',
    scope: ' (sur {q} requêtes des {r} dernières exécutions)',
    err: 'Échec du conseiller'
  },
  es: {
    removeTag: 'Quitar de las etiquetas prohibidas',
    run: 'Asesor: recomendar cambios de etiquetas',
    busy: 'Simulando cambios de etiquetas en las ejecuciones recientes…',
    title: 'Recomendación de etiquetas (simulada en las ejecuciones recientes)',
    apply: 'Aplicar cambios, reconstruir y relanzar la suite',
    scorecard: 'positivos {p}/{pt} aceptados · negativos {n}/{nt} suprimidos',
    now: 'Ahora',
    predicted: 'previsto',
    scope: ' (sobre {q} consultas de las últimas {r} ejecuciones)',
    err: 'Fallo del asesor'
  },
  de: {
    removeTag: 'Aus den Sperr-Tags entfernen',
    run: 'Berater: Tag-Änderungen empfehlen',
    busy: 'Tag-Änderungen über die letzten Läufe simulieren…',
    title: 'Tag-Set-Empfehlung (simuliert über die letzten Läufe)',
    apply: 'Änderungen anwenden, Head neu bauen & Suite neu ausführen',
    scorecard: 'Positive {p}/{pt} akzeptiert · Negative {n}/{nt} unterdrückt',
    now: 'Jetzt',
    predicted: 'prognostiziert',
    scope: ' (über {q} Abfragen aus den letzten {r} Läufen)',
    err: 'Berater fehlgeschlagen'
  },
  pt: {
    removeTag: 'Remover das tags proibidas',
    run: 'Consultor: recomendar alterações de tags',
    busy: 'Simulando alterações de tags nas execuções recentes…',
    title: 'Recomendação de conjunto de tags (simulada nas execuções recentes)',
    apply: 'Aplicar alterações, reconstruir e executar novamente a suíte',
    scorecard: 'positivos {p}/{pt} aceitos · negativos {n}/{nt} suprimidos',
    now: 'Agora',
    predicted: 'previsto',
    scope: ' (em {q} consultas das últimas {r} execuções)',
    err: 'Falha do consultor'
  },
  ru: {
    removeTag: 'Убрать из запрещённых тегов',
    run: 'Советник: рекомендовать изменения тегов',
    busy: 'Моделируем изменения тегов по недавним запускам…',
    title: 'Рекомендация набора тегов (смоделирована по недавним запускам)',
    apply: 'Применить изменения, пересобрать head и повторно запустить набор',
    scorecard: 'позитивных {p}/{pt} принято · негативных {n}/{nt} подавлено',
    now: 'Сейчас',
    predicted: 'прогноз',
    scope: ' (по {q} запросам из последних {r} запусков)',
    err: 'Ошибка советника'
  },
  ar: {
    removeTag: 'إزالة من الوسوم المحظورة',
    run: 'المستشار: اقتراح تغييرات على الوسوم',
    busy: 'محاكاة تغييرات الوسوم عبر التشغيلات الأخيرة…',
    title: 'توصية مجموعة الوسوم (محاكاة عبر التشغيلات الأخيرة)',
    apply: 'تطبيق التغييرات وإعادة بناء head وإعادة تشغيل المجموعة',
    scorecard: 'الموجبات {p}/{pt} مقبولة · السالبات {n}/{nt} محظورة',
    now: 'الآن',
    predicted: 'المتوقع',
    scope: ' (عبر {q} استعلامات من آخر {r} تشغيلات)',
    err: 'فشل المستشار'
  },
  zh: {
    removeTag: '从禁止标签中移除',
    run: '顾问：推荐标签调整',
    busy: '正在根据近期运行模拟标签调整…',
    title: '标签集建议（基于近期运行模拟）',
    apply: '应用更改、重建 head 并重新运行测试集',
    scorecard: '正例 {p}/{pt} 通过 · 负例 {n}/{nt} 拦截',
    now: '当前',
    predicted: '预测',
    scope: '（最近 {r} 次运行共 {q} 条查询）',
    err: '顾问失败'
  },
  sw: {
    removeTag: 'Ondoa kwenye tag zilizozuiwa',
    run: 'Mshauri: pendekeza mabadiliko ya tag',
    busy: 'Inaigiza mabadiliko ya tag kwenye ukimbiaji wa hivi karibuni…',
    title: 'Pendekezo la seti ya tag (limeigizwa kwenye ukimbiaji wa hivi karibuni)',
    apply: 'Tekeleza mabadiliko, jenga upya head na endesha upya kipima',
    scorecard: 'chanya {p}/{pt} zimepitishwa · hasi {n}/{nt} zimezuiwa',
    now: 'Sasa',
    predicted: 'makadirio',
    scope: ' (maswali {q} kutoka ukimbiaji {r} wa hivi karibuni)',
    err: 'Mshauri umeshindikana'
  },
  st: {
    removeTag: 'Tlosa ho litag tse thibetsoeng',
    run: 'Moeletsi: kgothaletsa diphetoho tsa litag',
    busy: 'E papalesa diphetoho tsa litag ho tsamaello tsa kajeno…',
    title: 'Khothaletso ea sete ea litag (e papalelitsoe ho tsamaello tsa kajeno)',
    apply: 'Kenya liphetoho tšebetsong, haha hlooho hape & phethahatsa hape',
    scorecard: 'tse nepahetseng {p}/{pt} tse amohetsoeng · tse fosahetseng {n}/{nt} tse thibilitseng',
    now: 'Hona joale',
    predicted: 'e boleloa pele',
    scope: ' (lipotso {q} ho tswa ho tsamaello {r} tsa kajeno)',
    err: 'Moeletsi o hlolehile'
  },
  id: {
    removeTag: 'Hapus dari tag terlarang',
    run: 'Penasihat: rekomendasikan perubahan tag',
    busy: 'Menyimulasikan perubahan tag pada eksekusi terbaru…',
    title: 'Rekomendasi set tag (disimulasikan pada eksekusi terbaru)',
    apply: 'Terapkan perubahan, bangun ulang head & jalankan ulang suite',
    scorecard: 'positif {p}/{pt} diterima · negatif {n}/{nt} ditekan',
    now: 'Saat ini',
    predicted: 'perkiraan',
    scope: ' (atas {q} kueri dari {r} eksekusi terakhir)',
    err: 'Penasihat gagal'
  },
  bn: {
    removeTag: 'নিষিদ্ধ ট্যাগ থেকে সরান',
    run: 'উপদেষ্টা: ট্যাগ পরিবর্তনের সুপারিশ করুন',
    busy: 'সাম্প্রতিক রানগুলিতে ট্যাগ পরিবর্তন অনুকরণ করা হচ্ছে…',
    title: 'ট্যাগ-সেট সুপারিশ (সাম্প্রতিক রানগুলিতে অনুকরিত)',
    apply: 'পরিবর্তন প্রয়োগ করুন, head পুনর্নির্মাণ ও suite পুনরায় চালান',
    scorecard: 'পজিটিভ {p}/{pt} গৃহীত · নেগেটিভ {n}/{nt} প্রতিহত',
    now: 'বর্তমান',
    predicted: 'পূর্বানুমান',
    scope: ' (সর্বশেষ {r} রানের {q}টি কোয়েরি জুড়ে)',
    err: 'উপদেষ্টা ব্যর্থ হয়েছে'
  },
  th: {
    removeTag: 'นำออกจากแท็กต้องห้าม',
    run: 'ที่ปรึกษา: แนะนำการปรับแท็ก',
    busy: 'กำลังจำลองการปรับแท็กจากการรันล่าสุด…',
    title: 'คำแนะนำชุดแท็ก (จำลองจากการรันล่าสุด)',
    apply: 'ใช้การเปลี่ยนแปลง สร้าง head ใหม่ และรันชุดทดสอบซ้ำ',
    scorecard: 'บวก {p}/{pt} ผ่าน · ลบ {n}/{nt} ถูกปิดกั้น',
    now: 'ปัจจุบัน',
    predicted: 'คาดการณ์',
    scope: ' (จาก {q} คำถามในการรันล่าสุด {r} ครั้ง)',
    err: 'ที่ปรึกษาล้มเหลว'
  },
  // man.js is English-fallback throughout — keep it that way (same as en).
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
function deepKeys(obj, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(obj)) {
    const p = prefix ? prefix + '.' + k : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...deepKeys(v, p));
    else out.push(p);
  }
  return out;
}
// Same string/serialize emitters as fill-missing-locale-keys.cjs.
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
  const before = deepKeys(loc).length;
  setPath(loc, 'okf.headTest.suites.removeTag', t.removeTag);
  setPath(loc, 'okf.headTest.advisor.run', t.run);
  setPath(loc, 'okf.headTest.advisor.busy', t.busy);
  setPath(loc, 'okf.headTest.advisor.title', t.title);
  setPath(loc, 'okf.headTest.advisor.apply', t.apply);
  setPath(loc, 'okf.headTest.advisor.scorecard', t.scorecard);
  setPath(loc, 'okf.headTest.advisor.now', t.now);
  setPath(loc, 'okf.headTest.advisor.predicted', t.predicted);
  setPath(loc, 'okf.headTest.advisor.scope', t.scope);
  setPath(loc, 'okf.headTest.error.advisor', t.err);
  fs.writeFileSync(path.join(DIR, file), 'export default ' + serialize(loc, 0) + ';\n', 'utf8');
  console.log(file + ': +' + (deepKeys(loadLocale(file)).length - before) + ' keys');
}
console.log('DONE');
