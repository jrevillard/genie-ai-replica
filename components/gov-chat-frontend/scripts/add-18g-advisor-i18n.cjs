// One-shot (2026-10-10): Story 1-8g b/c — the advisor's blocked-removal
// chips, narrow pairs, and the scope-detail line, in every locale.
// man.js keeps its English fallback.
const fs = require('fs');
const path = require('path');
const DIR = 'D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales';

const T = {
  en: {
    blockedTitle: 'Blocked removals — click to include in Apply',
    blockedGain: 'recovers {n} positive(s)',
    narrowTitle: 'Narrower replacements — recover positives without re-admitting negatives',
    narrowChip: 'Remove the broad tag, add the narrow one',
    reasonCurator: 'you declared this tag originally — confirm before removing',
    reasonRotated: 'the edit history has rotated past the baseline — confirm before removing',
    scopeDetail: 'suites: {s} · tag sets: {t}'
  },
  fr: {
    blockedTitle: 'Suppressions bloquées — cliquez pour les inclure à Appliquer',
    blockedGain: 'récupère {n} positive(s)',
    narrowTitle: 'Remplacements plus étroits — récupère les positives sans ré-admettre les négatives',
    narrowChip: 'Retirer le tag large, ajouter le tag étroit',
    reasonCurator: 'vous avez déclaré ce tag à l’origine — confirmez avant de le retirer',
    reasonRotated: 'l’historique a dépassé la ligne de base — confirmez avant de le retirer',
    scopeDetail: 'suites : {s} · jeux de tags : {t}'
  },
  es: {
    blockedTitle: 'Eliminaciones bloqueadas — haga clic para incluirlas en Aplicar',
    blockedGain: 'recupera {n} positiva(s)',
    narrowTitle: 'Reemplazos más estrechos — recupera positivas sin readmitir negativas',
    narrowChip: 'Quitar la etiqueta amplia, añadir la estrecha',
    reasonCurator: 'usted declaró esta etiqueta originalmente — confirme antes de quitarla',
    reasonRotated: 'el historial pasó la línea base — confirme antes de quitarla',
    scopeDetail: 'suites: {s} · conjuntos de etiquetas: {t}'
  },
  de: {
    blockedTitle: 'Blockierte Entfernungen — klicken, um sie in Übernehmen aufzunehmen',
    blockedGain: 'holt {n} Positive zurück',
    narrowTitle: 'Engere Ersatz-Tags — holt Positive zurück, ohne Negative wieder zuzulassen',
    narrowChip: 'Breites Tag entfernen, enges Tag hinzufügen',
    reasonCurator: 'Sie haben dieses Tag ursprünglich deklariert — vor dem Entfernen bestätigen',
    reasonRotated: 'Der Verlauf ist über die Basislinie hinaus rotiert — vor dem Entfernen bestätigen',
    scopeDetail: 'Suiten: {s} · Tag-Sets: {t}'
  },
  pt: {
    blockedTitle: 'Remoções bloqueadas — clique para incluir em Aplicar',
    blockedGain: 'recupera {n} positiva(s)',
    narrowTitle: 'Substituições mais estreitas — recupera positivas sem readmitir negativas',
    narrowChip: 'Remover a etiqueta ampla, adicionar a estreita',
    reasonCurator: 'você declarou esta etiqueta originalmente — confirme antes de remover',
    reasonRotated: 'o histórico passou da linha de base — confirme antes de remover',
    scopeDetail: 'suítes: {s} · conjuntos de etiquetas: {t}'
  },
  ru: {
    blockedTitle: 'Заблокированные удаления — нажмите, чтобы включить в «Применить»',
    blockedGain: 'вернёт {n} позитив(ов)',
    narrowTitle: 'Более узкие замены — возвращают позитивы, не впуская негативы обратно',
    narrowChip: 'Убрать широкий тег, добавить узкий',
    reasonCurator: 'этот тег объявили вы изначально — подтвердите перед удалением',
    reasonRotated: 'история вышла за базовую линию — подтвердите перед удалением',
    scopeDetail: 'сюиты: {s} · наборы тегов: {t}'
  },
  ar: {
    blockedTitle: 'إزالات محظورة — انقر لتضمينها في التطبيق',
    blockedGain: 'يستعيد {n} استعلامًا إيجابيًا',
    narrowTitle: 'بدائل أضيق — يستعيد الإيجابيات دون إعادة قبول السلبيات',
    narrowChip: 'أزل الوسم الواسع وأضف الضيق',
    reasonCurator: 'أنت من أعلن هذا الوسم أصلًا — أكّد قبل الإزالة',
    reasonRotated: 'تجاوز السجل خط الأساس — أكّد قبل الإزالة',
    scopeDetail: 'المجموعات: {s} · أطقم الوسوم: {t}'
  },
  zh: {
    blockedTitle: '受阻的移除——点击以加入"应用"',
    blockedGain: '可挽回 {n} 个正向用例',
    narrowTitle: '更窄的替代标签——挽回正向用例而不重新放进负向用例',
    narrowChip: '移除宽泛标签，添加窄标签',
    reasonCurator: '此标签由您最初声明——移除前请确认',
    reasonRotated: '编辑历史已滚过基线——移除前请确认',
    scopeDetail: '测试集：{s} · 标签集：{t}'
  },
  sw: {
    blockedTitle: 'Uondolewa uliozuiwa — bofya ili ujasishwe katika Kutumia',
    blockedGain: 'inarejesha {n} chanya',
    narrowTitle: 'Vibadala vikuu — huinarejesha chanya bila kurudisha hasi',
    narrowChip: 'Ondoa lebe pana, ongeza lebe nyuso',
    reasonCurator: 'wewe ndiye uliytangaza lebe hii mwanzoni — thibitisha kabla ya kuondoa',
    reasonRotated: 'historia imevuka mstari wa msingi — thibitisha kabla ya kuondoa',
    scopeDetail: 'vipima: {s} · seti za lebe: {t}'
  },
  st: {
    blockedTitle: 'Tlosong tse koalloeng — tobetsa ho li kenyelle ho Apply',
    blockedGain: 'e busetsa {n} e teng',
    narrowTitle: 'Mekhopolo e tletseng — e busetsa tse teng ntle ho ho ngola tse sieo hape',
    narrowChip: 'Tlosa lebitla se pharaletseng, kenya se lutsehisi',
    reasonCurator: 'ke wena ya tlileng ka lebitla lena — netefatsa pele ua le tlosa',
    reasonRotated: 'nalane e fetile motheo — netefatsa pele ua le tlosa',
    scopeDetail: 'li-suite: {s} · mehloso ea melaetana: {t}'
  },
  id: {
    blockedTitle: 'Penghapusan terblokir — klik untuk menyertakan dalam Terapkan',
    blockedGain: 'memulihkan {n} positif',
    narrowTitle: 'Pengganti yang lebih sempit — memulihkan positif tanpa memasukkan kembali negatif',
    narrowChip: 'Hapus tag luas, tambahkan tag sempit',
    reasonCurator: 'Anda yang mendeklarasikan tag ini semula — konfirmasi sebelum menghapus',
    reasonRotated: 'riwayat sudah melewati baseline — konfirmasi sebelum menghapus',
    scopeDetail: 'suite: {s} · set tag: {t}'
  },
  bn: {
    blockedTitle: 'ব্লক করা অপসারণ — Apply-তে অন্তর্ভুক্ত করতে ক্লিক করুন',
    blockedGain: '{n}টি পজিটিভ ফেরত আনে',
    narrowTitle: 'আরও সংকীর্ণ বিকল্প — নেগেটিভ ফিরিয়ে না এনে পজিটিভ ফেরত আনে',
    narrowChip: 'প্রশস্ত ট্যাগ সরিয়ে সংকীর্ণ ট্যাগ যোগ করুন',
    reasonCurator: 'এই ট্যাগটি আপনিই প্রথম ঘোষণা করেছিলেন — সরানোর আগে নিশ্চিত করুন',
    reasonRotated: 'সম্পাদনার ইতিহাস বেসলাইন পেরিয়ে গেছে — সরানোর আগে নিশ্চিত করুন',
    scopeDetail: 'স্যুট: {s} · ট্যাগ সেট: {t}'
  },
  th: {
    blockedTitle: 'การลบที่ถูกบล็อก — คลิกเพื่อรวมในการนำไปใช้',
    blockedGain: 'กู้คืน {n} เคสบวก',
    narrowTitle: 'แท็กที่แคบลง — กู้คืนเคสบวกโดยไม่รับเคสลบกลับมา',
    narrowChip: 'ลบแท็กกว้าง เพิ่มแท็กแคบ',
    reasonCurator: 'คุณเป็นผู้ประกาศแท็กนี้แต่แรก — ยืนยันก่อนลบ',
    reasonRotated: 'ประวัติการแก้ไขเลยเส้นฐานแล้ว — ยืนยันก่อนลบ',
    scopeDetail: 'ชุดทดสอบ: {s} · ชุดแท็ก: {t}'
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
  const a = loc.okf && loc.okf.headTest && loc.okf.headTest.advisor;
  if (!a) {
    console.log(file + ': no advisor — skipped');
    continue;
  }
  setPath(a, 'blockedTitle', t.blockedTitle);
  setPath(a, 'blockedGain', t.blockedGain);
  setPath(a, 'narrowTitle', t.narrowTitle);
  setPath(a, 'narrowChip', t.narrowChip);
  setPath(a, 'reasonCurator', t.reasonCurator);
  setPath(a, 'reasonRotated', t.reasonRotated);
  setPath(a, 'scopeDetail', t.scopeDetail);
  fs.writeFileSync(path.join(DIR, file), 'export default ' + ser(loc, 0) + ';\n', 'utf8');
  console.log(file + ': ok');
}
console.log('DONE');
