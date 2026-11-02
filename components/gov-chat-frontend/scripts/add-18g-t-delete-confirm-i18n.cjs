// One-shot (2026-10-11): Story 1-8g-t — the suite-delete confirmation
// dialog (David: "the deletion must be confirmed with a dialog"), ×14.
const fs = require('fs');
const path = require('path');
const DIR = 'D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales';

const T = {
  en: {
    deleteConfirmTitle: 'Delete this suite?',
    deleteConfirmBody: 'This permanently removes the suite and its run history. This cannot be undone.',
    deleteConfirm: 'Delete suite',
    deleteCancel: 'Cancel',
    unnamedFallback: 'unnamed suite'
  },
  es: {
    deleteConfirmTitle: '¿Eliminar esta suite?',
    deleteConfirmBody: 'Esto elimina permanentemente la suite y su historial de ejecuciones. No se puede deshacer.',
    deleteConfirm: 'Eliminar suite',
    deleteCancel: 'Cancelar',
    unnamedFallback: 'suite sin nombre'
  },
  fr: {
    deleteConfirmTitle: 'Supprimer cette suite ?',
    deleteConfirmBody: 'Cela supprime définitivement la suite et son historique d’exécution. Irréversible.',
    deleteConfirm: 'Supprimer la suite',
    deleteCancel: 'Annuler',
    unnamedFallback: 'suite sans nom'
  },
  de: {
    deleteConfirmTitle: 'Diese Suite löschen?',
    deleteConfirmBody: 'Dies entfernt die Suite und ihren Laufverlauf endgültig. Nicht widerrufbar.',
    deleteConfirm: 'Suite löschen',
    deleteCancel: 'Abbrechen',
    unnamedFallback: 'unbenannte Suite'
  },
  pt: {
    deleteConfirmTitle: 'Eliminar esta suíte?',
    deleteConfirmBody: 'Isto remove permanentemente a suíte e o seu histórico de execuções. Não pode ser desfeito.',
    deleteConfirm: 'Eliminar suíte',
    deleteCancel: 'Cancelar',
    unnamedFallback: 'suíte sem nome'
  },
  ru: {
    deleteConfirmTitle: 'Удалить этот сюит?',
    deleteConfirmBody: 'Это навсегда удалит сюит и историю его прогонов. Отменить нельзя.',
    deleteConfirm: 'Удалить сюит',
    deleteCancel: 'Отмена',
    unnamedFallback: 'сюит без имени'
  },
  ar: {
    deleteConfirmTitle: 'حذف هذه المجموعة؟',
    deleteConfirmBody: 'يؤدي هذا إلى حذف المجموعة وسجل تشغيلها نهائيًا. لا يمكن التراجع.',
    deleteConfirm: 'حذف المجموعة',
    deleteCancel: 'إلغاء',
    unnamedFallback: 'مجموعة بدون اسم'
  },
  zh: {
    deleteConfirmTitle: '删除这个测试集？',
    deleteConfirmBody: '这将永久删除该测试集及其运行历史，无法撤销。',
    deleteConfirm: '删除测试集',
    deleteCancel: '取消',
    unnamedFallback: '未命名测试集'
  },
  sw: {
    deleteConfirmTitle: 'Ufute vipima hiki?',
    deleteConfirmBody: 'Hiki kinaondoa kabisa vipima na historia yake ya upimaji. Hakiwezi kurejeshwa.',
    deleteConfirm: 'Futa vipima',
    deleteCancel: 'Ghairi',
    unnamedFallback: 'vipima isiyo na jina'
  },
  st: {
    deleteConfirmTitle: 'Tlosa li-suite tse?',
    deleteConfirmBody: 'Sena se tlosa li-suite le nalanete ea tsona sa ho sa felise. Ha ho khutleiso.',
    deleteConfirm: 'Tlosa li-suite',
    deleteCancel: 'Khutlisa',
    unnamedFallback: 'li-suite tse se nang bitso'
  },
  id: {
    deleteConfirmTitle: 'Hapus suite ini?',
    deleteConfirmBody: 'Ini menghapus suite beserta riwayat eksekusinya secara permanen. Tidak dapat dibatalkan.',
    deleteConfirm: 'Hapus suite',
    deleteCancel: 'Batal',
    unnamedFallback: 'suite tanpa nama'
  },
  bn: {
    deleteConfirmTitle: 'এই স্যুট মুছে ফেলবেন?',
    deleteConfirmBody: 'এটি স্যুট ও তার রান-ইতিহাস স্থায়ীভাবে মুছে ফেলবে। ফিরিয়ে আনা যাবে না।',
    deleteConfirm: 'স্যুট মুছুন',
    deleteCancel: 'বাতিল',
    unnamedFallback: 'নামহীন স্যুট'
  },
  th: {
    deleteConfirmTitle: 'ลบชุดทดสอบนี้?',
    deleteConfirmBody: 'การนี้จะลบชุดทดสอบและประวัติการรันอย่างถาวร ไม่สามารถย้อนกลับได้',
    deleteConfirm: 'ลบชุดทดสอบ',
    deleteCancel: 'ยกเลิก',
    unnamedFallback: 'ชุดทดสอบไม่มีชื่อ'
  },
  man: {
    deleteConfirmTitle: 'Delete this suite?',
    deleteConfirmBody: 'This permanently removes the suite and its run history. This cannot be undone.',
    deleteConfirm: 'Delete suite',
    deleteCancel: 'Cancel',
    unnamedFallback: 'unnamed suite'
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
  const s = loc.okf && loc.okf.headTest && loc.okf.headTest.suites;
  if (!s) {
    console.log(file + ': no suites — skipped');
    continue;
  }
  setPath(s, 'deleteConfirmTitle', t.deleteConfirmTitle);
  setPath(s, 'deleteConfirmBody', t.deleteConfirmBody);
  setPath(s, 'deleteConfirm', t.deleteConfirm);
  setPath(s, 'deleteCancel', t.deleteCancel);
  setPath(s, 'unnamedFallback', t.unnamedFallback);
  fs.writeFileSync(path.join(DIR, file), 'export default ' + ser(loc, 0) + ';\n', 'utf8');
  console.log(file + ': ok');
}
console.log('DONE');
