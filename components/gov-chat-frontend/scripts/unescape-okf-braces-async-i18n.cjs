// One-shot (2026-10-09), two jobs:
// 1. translateMixin switched to RAW message lookup (no vue-i18n compilation),
//    so every remaining okf.* string carrying the {'{'}…{'}'} literal-brace
//    escape renders the escape sequence itself (live: the dashboard Ingested
//    card showed "Ingested v{'{'}n{'}'}" — the caller's .replace('{n}') can
//    never match the escaped form). Un-escape ALL okf.* leaves. admin.documents.*
//    keeps its escapes deliberately — its consumer is AdminDashboard.translate,
//    which still routes through vue-i18n's compiler ($i18n.t) and NEEDS the
//    escaped form to avoid the named-slot-eating bug.
// 2. Suite generation is now async (202 + poll, 1-8f2): update
//    okf.headTest.suites.generateTip / .generating and add
//    okf.headTest.error.generateTimeout in every locale.
const fs = require('fs');
const path = require('path');
const DIR = 'D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales';

const T = {
  en: {
    tip: 'The LLM writes the queries in batches of 30 per class — a large ask (100+) takes a few minutes. The suite lands here and in Saved suites when done.',
    generating: 'Generating in batches — large asks take a few minutes…',
    timeout: 'The suite is taking unusually long — it may still land in Saved suites; check there in a minute.'
  },
  fr: {
    tip: 'Le LLM écrit les requêtes par lots de 30 par classe — une grande demande (100+) prend quelques minutes. La suite apparaît ici et dans les suites enregistrées une fois terminée.',
    generating: 'Génération par lots — les grandes demandes prennent quelques minutes…',
    timeout:
      'La suite tarde anormalement — elle apparaîtra peut-être dans les suites enregistrées ; vérifiez dans une minute.'
  },
  es: {
    tip: 'El LLM escribe las consultas en lotes de 30 por clase — una petición grande (100+) tarda unos minutos. La suite aparece aquí y en suites guardadas al terminar.',
    generating: 'Generando por lotes — las peticiones grandes tardan unos minutos…',
    timeout: 'La suite está tardando demasiado — puede que aparezca en suites guardadas; revise en un minuto.'
  },
  de: {
    tip: 'Das LLM schreibt die Abfragen in 30er-Stapeln pro Klasse — eine große Anfrage (100+) dauert einige Minuten. Die Suite erscheint hier und in den gespeicherten Suiten.',
    generating: 'Stapelweise Generierung — große Anfragen dauern einige Minuten…',
    timeout:
      'Die Suite dauert ungewöhnlich lange — sie könnte in den gespeicherten Suiten landen; in einer Minute dort nachsehen.'
  },
  pt: {
    tip: 'O LLM escreve as consultas em lotes de 30 por classe — um pedido grande (100+) leva alguns minutos. A suíte aparece aqui e em suítes salvas ao terminar.',
    generating: 'Gerando em lotes — pedidos grandes levam alguns minutos…',
    timeout: 'A suíte está demorando muito — pode aparecer em suítes salvas; verifique em um minuto.'
  },
  ru: {
    tip: 'LLM пишет запросы пакетами по 30 на класс — большой запрос (100+) занимает несколько минут. Набор появится здесь и в сохранённых наборах по завершении.',
    generating: 'Генерация пакетами — большие запросы занимают несколько минут…',
    timeout: 'Набор создаётся необычно долго — возможно, он появится в сохранённых наборах; проверьте через минуту.'
  },
  ar: {
    tip: 'يكتب النموذج الاستعلامات على دفعات من 30 لكل فئة — الطلب الكبير (100+) يستغرق دقائق. تظهر المجموعة هنا وفي المجموعات المحفوظة عند الانتهاء.',
    generating: 'جارٍ التوليد على دفعات — الطلبات الكبيرة تستغرق دقائق…',
    timeout: 'المجموعة تتأخر بشكل غير معتاد — قد تظهر في المجموعات المحفوظة؛ تحقق بعد دقيقة.'
  },
  zh: {
    tip: 'LLM 按每类 30 条分批生成 — 大批量（100+）需要几分钟。完成后测试集会出现在此处和已保存列表中。',
    generating: '正在分批生成 — 大批量需要几分钟…',
    timeout: '测试集耗时异常 — 可能稍后会出现在已保存列表中；请一分钟后查看。'
  },
  sw: {
    tip: 'LLM huandika maswali kwa vipande vya 30 kwa kila aina — ombi kubwa (100+) huchukua dakika chache. Kipima hutokea hapa na kwenye vilivyohifadhiwa ikikamilika.',
    generating: 'Inatengeneza kwa vipande — maombi makubwa huchukua dakika…',
    timeout:
      'Kipima kimechukua muda mrefu zaidi ya kawaida — kinaweza kutokea kwenye vilivyohifadhiwa; angalia baada ya dakika moja.'
  },
  st: {
    tip: 'LLM ngola lipotso ka libaka tsa 30 ka sehlopha — kopo e kholo (100+) nka nka metsotso e mmalwa. Sete se tla hlaha mona le ho tse bolokiloeng ha se feta.',
    generating: 'E etsa ka libaka — likopo tse kholo li nka metsotso…',
    timeout: 'Sete se nka nako e fetileng haholo — se ka hlaha ho tse bolokiloeng; sheba hape ka motsotso.'
  },
  id: {
    tip: 'LLM menulis kueri dalam batch 30 per kelas — permintaan besar (100+) butuh beberapa menit. Suite muncul di sini dan di suite tersimpan saat selesai.',
    generating: 'Menghasilkan per batch — permintaan besar butuh beberapa menit…',
    timeout: 'Suite terlalu lama — mungkin muncul di suite tersimpan; periksa lagi dalam satu menit.'
  },
  bn: {
    tip: 'LLM প্রতি শ্রেণিতে ৩০ করে ব্যাচে কোয়েরি লেখে — বড় অনুরোধ (১০০+) কয়েক মিনিট নেয়। শেষ হলে suite এখানে ও সংরক্ষিত তালিকায় দেখা যাবে।',
    generating: 'ব্যাচে তৈরি হচ্ছে — বড় অনুরোধ কয়েক মিনিট নেয়…',
    timeout: 'suite অস্বাভাবিক দেরি হচ্ছে — সংরক্ষিত তালিকায় দেখা দিতে পারে; এক মিনিট পরে দেখুন।'
  },
  th: {
    tip: 'LLM เขียนคำถามเป็นชุดละ 30 ต่อประเภท — จำนวนมาก (100+) ใช้เวลาหลายนาที เสร็จแล้วชุดทดสอบจะปรากฏที่นี่และในรายการที่บันทึกไว้',
    generating: 'กำลังสร้างเป็นชุด — จำนวนมากใช้เวลาหลายนาที…',
    timeout: 'ชุดทดสอบใช้เวลานานผิดปกติ — อาจปรากฏในรายการที่บันทึกไว้ ตรวจสอบอีกครั้งในหนึ่งนาที'
  }
};

function loadLocale(file) {
  const src = fs.readFileSync(path.join(DIR, file), 'utf8');
  return new Function(src.replace(/export default/, 'return'))();
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

function unescapeLeaves(node, path, touched) {
  if (typeof node === 'string') {
    if (node.includes("{'{'}") || node.includes("{'}'}")) {
      return node.split("{'{'}").join('{').split("{'}'}").join('}');
    }
    return node;
  }
  if (node && typeof node === 'object') {
    const out = Array.isArray(node) ? [] : {};
    for (const k of Object.keys(node)) {
      out[k] = unescapeLeaves(node[k], path.concat(k), touched);
    }
    return out;
  }
  return node;
}
function countEscaped(node, path, found) {
  if (typeof node === 'string') {
    if (node.includes("{'{'}") || node.includes("{'}'}")) found.push(path.join('.'));
    return;
  }
  if (node && typeof node === 'object') {
    for (const k of Object.keys(node)) countEscaped(node[k], path.concat(k), found);
  }
}

for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.js') && f !== 'index.js')) {
  const loc = loadLocale(file);
  const locale = file.replace('.js', '');
  const t = T[locale];
  const before = [];
  countEscaped(loc, [], before);
  const nonOkf = before.filter((p) => !p.startsWith('okf.'));
  if (loc && loc.okf) {
    loc.okf = unescapeLeaves(loc.okf, ['okf'], []);
  }
  let actions = [];
  if (t && loc && loc.okf && loc.okf.headTest) {
    const ht = loc.okf.headTest;
    if (ht.suites) {
      if (typeof ht.suites.generateTip === 'string') {
        ht.suites.generateTip = t.tip;
        actions.push('tip');
      }
      if (typeof ht.suites.generating === 'string') {
        ht.suites.generating = t.generating;
        actions.push('generating');
      }
    }
    if (ht.error && typeof ht.error.suiteRename === 'string' && ht.error.generateTimeout === undefined) {
      // insert generateTimeout right after suiteRename to keep key order stable
      const next = {};
      for (const k of Object.keys(ht.error)) {
        next[k] = ht.error[k];
        if (k === 'suiteRename') next.generateTimeout = t ? t.timeout : T.en.timeout;
      }
      ht.error = next;
      actions.push('timeout');
    }
  }
  fs.writeFileSync(path.join(DIR, file), 'export default ' + serialize(loc, 0) + ';\n', 'utf8');
  const after = [];
  countEscaped(loc, [], after);
  console.log(
    file +
      ': escaped ' +
      before.length +
      '->' +
      after.length +
      (nonOkf.length ? ' (kept non-okf: ' + nonOkf.join(', ') + ')' : '') +
      (actions.length ? ' [' + actions.join(',') + ']' : '')
  );
}
console.log('DONE');
