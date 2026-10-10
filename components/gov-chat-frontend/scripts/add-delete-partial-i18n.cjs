// One-shot (2026-10-10): the batch-delete refusal becomes visible + partial
// (work item i) — deletePartialNotice + confirmDeleteSkipped in every
// locale, PLUS the deleteRefuseReason key backfilled (it existed in en only).
// admin.documents.* keeps the {'{'}-escape convention (AdminDashboard
// compiles via $t; the caller .replace()s the rendered placeholders).
const fs = require('fs');
const path = require('path');
const DIR = 'D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales';

// The {'{'} / {'}'} sequences are LITERAL text in the locale files.
const esc = (s) => s.replace(/\{/g, "{'{'}").replace(/\}/g, "{'}'}");

const T = {
  en: {
    partial: esc('{blocked} selected file(s) cannot be deleted ({reason}) — only the other {n} will be deleted.'),
    skipped: esc('{count} ingested/ingesting file(s) will be SKIPPED — retract them first to delete them.'),
    refuse: esc('{count} file(s) are still ingested — retract them first.')
  },
  fr: {
    partial: esc(
      '{blocked} fichier(s) sélectionné(s) ne peuvent pas être supprimés ({reason}) — seuls les {n} autres seront supprimés.'
    ),
    skipped: esc('{count} fichier(s) ingéré(s)/en cours seront IGNORÉS — rétractez-les d’abord pour les supprimer.'),
    refuse: esc('{count} fichier(s) sont encore ingérés — rétractez-les d’abord.')
  },
  es: {
    partial: esc(
      '{blocked} archivo(s) seleccionado(s) no se pueden eliminar ({reason}) — solo se eliminarán los otros {n}.'
    ),
    skipped: esc('{count} archivo(s) ingerido(s)/en curso se OMITIRÁN — retráquelos primero para eliminarlos.'),
    refuse: esc('{count} archivo(s) siguen ingeridos — retráquelos primero.')
  },
  de: {
    partial: esc(
      '{blocked} ausgewählte Datei(en) können nicht gelöscht werden ({reason}) — nur die anderen {n} werden gelöscht.'
    ),
    skipped: esc(
      '{count} inginierte/in Arbeit befindliche Datei(en) werden ÜBERSPRUNGEN — erst zurückziehen, dann löschen.'
    ),
    refuse: esc('{count} Datei(en) sind noch inginiert — zuerst zurückziehen.')
  },
  pt: {
    partial: esc(
      '{blocked} arquivo(s) selecionado(s) não podem ser excluídos ({reason}) — apenas os outros {n} serão excluídos.'
    ),
    skipped: esc('{count} arquivo(s) ingerido(s)/em andamento serão PULADOS — retrate-os primeiro para excluí-los.'),
    refuse: esc('{count} arquivo(s) ainda ingeridos — retrate-os primeiro.')
  },
  ru: {
    partial: esc('{blocked} выбранный(х) файл(ов) нельзя удалить ({reason}) — будут удалены только остальные {n}.'),
    skipped: esc('{count} загруженный(х) файл(ов) будут ПРОПУЩЕНЫ — сначала отозвите их, чтобы удалить.'),
    refuse: esc('{count} файл(ов) ещё загружены — сначала отзовите их.')
  },
  ar: {
    partial: esc('{blocked} من الملفات المحددة لا يمكن حذفها ({reason}) — سيُحذف الملفات الأخرى فقط بعدد {n}.'),
    skipped: esc('{count} من الملفات المستوعبة/قيد الاستيعاب ستُتخطى — اسحبها أولًا لحذفها.'),
    refuse: esc('{count} من الملفات ما زالت مستوعبة — اسحبها أولًا.')
  },
  zh: {
    partial: esc('{blocked} 个所选文件无法删除（{reason}）——只会删除其余的 {n} 个。'),
    skipped: esc('{count} 个已摄取/摄取中的文件将被跳过——请先撤回它们才能删除。'),
    refuse: esc('{count} 个文件仍处于已摄取状态——请先撤回。')
  },
  sw: {
    partial: esc('{blocked} faili zilizochaguliwa haziwezi kufutwa ({reason}) — zingine {n} tu zitafutwa.'),
    skipped: esc('{count} faili zilizoingizwa/zinaingizwa ZITARUKWA — rejesha kwanza kuzifuta.'),
    refuse: esc('{count} faili bado zimeingizwa — rejesha kwanza.')
  },
  st: {
    partial: esc('{blocked} lifaele tse khethiloeng ha li ka tlosoa ({reason}) — feela tse ling {n} li tla tlosoa.'),
    skipped: esc('{count} lifaele tse kennyeng/tsa kennyang li TLA TLOHESOA — di khutlisa pele ho li tlosa.'),
    refuse: esc('{count} lifaele di sa tsoa kennyoa — di khutlisa pele.')
  },
  id: {
    partial: esc('{blocked} file terpilih tidak dapat dihapus ({reason}) — hanya {n} lainnya yang akan dihapus.'),
    skipped: esc('{count} file yang di-ingest/sedang di-ingest akan DILEWATI — retract dulu untuk menghapusnya.'),
    refuse: esc('{count} file masih ter-ingest — retract dulu.')
  },
  bn: {
    partial: esc('{blocked}টি নির্বাচিত ফাইল মুছা যাবে না ({reason}) — বাকি {n}টি মুছা হবে।'),
    skipped: esc('{count}টি ইনজেস্ট করা/হচ্ছে ফাইল বাদ যাবে — মুছতে প্রথমে সেগুলি রিট্র্যাক্ট করুন।'),
    refuse: esc('{count}টি ফাইল এখনও ইনজেস্ট করা আছে — প্রথমে রিট্র্যাক্ট করুন।')
  },
  th: {
    partial: esc('ไฟล์ที่เลือก {blocked} ไฟล์ลบไม่ได้ ({reason}) — จะลบเฉพาะที่เหลืออีก {n} ไฟล์'),
    skipped: esc('ไฟล์ที่ ingest แล้ว/กำลัง ingest {count} ไฟล์จะถูกข้าม — ถอนคืนก่อนจึงจะลบได้'),
    refuse: esc('มี {count} ไฟล์ที่ยัง ingest อยู่ — ถอนคืนก่อน')
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
    else if (ch === '"') out += '\\"';
    else if (ch === '\n') out += '\\n';
    else out += ch;
  }
  return '"' + out + '"';
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
  const docs = loc.admin && loc.admin.documents;
  if (!docs) {
    console.log(file + ': no admin.documents — skipped');
    continue;
  }
  setPath(docs, 'deletePartialNotice', t.partial);
  setPath(docs, 'confirmDeleteSkipped', t.skipped);
  if (!docs.deleteRefuseReason) setPath(docs, 'deleteRefuseReason', t.refuse);
  fs.writeFileSync(path.join(DIR, file), 'export default ' + ser(loc, 0) + ';\n', 'utf8');
  console.log(file + ': ok');
}
console.log('DONE');
