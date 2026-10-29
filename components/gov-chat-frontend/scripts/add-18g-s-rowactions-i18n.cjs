// One-shot (2026-10-11): Story 1-8g-s — the advisor's corpus-grounded
// row-flip recommendations (rowActionsTitle / flipToPositive) + the
// ungrounded-fails honesty note, in every locale. man.js keeps English.
const fs = require('fs');
const path = require('path');
const DIR = 'D:/ITU-Gitlab/components/gov-chat-frontend/src/i18n/locales';

const T = {
  en: {
    rowActionsTitle: 'Corpus-grounded flips — the corpus answers these "negatives": flip them to positives',
    flipToPositive: 'Flip to positive',
    ungroundedNote:
      '{n} failing negative(s) have no corpus grounding and no safe tag lever — the competing repository must win them.'
  },
  es: {
    rowActionsTitle: 'Cambios respaldados por el corpus — el corpus responde a estos "negativos": conviértelos en positivos',
    flipToPositive: 'Convertir en positivo',
    ungroundedNote:
      '{n} negativo(s) fallido(s) sin respaldo en el corpus y sin palanca de etiquetas segura: el repositorio competidor debe ganarlos.'
  },
  fr: {
    rowActionsTitle: 'Retournements fondés sur le corpus — le corpus répond à ces « négatifs » : retournez-les en positifs',
    flipToPositive: 'Rendre positif',
    ungroundedNote:
      "{n} négatif(s) en échec sans ancrage dans le corpus ni levier de tag sûr — le dépôt concurrent doit les remporter."
  },
  de: {
    rowActionsTitle: 'Korpus-begründete Umbuchungen — der Korpus beantwortet diese „Negativen“: in Positive umwandeln',
    flipToPositive: 'Zu Positiv umwandeln',
    ungroundedNote:
      '{n} fehlgeschlagene Negative ohne Korpus-Abdeckung und ohne sichere Tag-Hebel — das konkurrierende Repository muss sie gewinnen.'
  },
  pt: {
    rowActionsTitle: 'Inversões fundamentadas no corpus — o corpus responde a estes "negativos": torne-os positivos',
    flipToPositive: 'Tornar positivo',
    ungroundedNote:
      '{n} negativo(s) reprovado(s) sem lastro no corpus e sem alavanca de tag segura — o repositório concorrente deve vencê-los.'
  },
  ru: {
    rowActionsTitle: 'Перевороты по корпусу — корпус отвечает на эти «негативы»: превратите их в позитивы',
    flipToPositive: 'Сделать позитивом',
    ungroundedNote:
      '{n} провалившихся негативов без покрытия корпусом и без безопасного тега-рычага — их должен выиграть конкурирующий репозиторий.'
  },
  ar: {
    rowActionsTitle: 'قلبات مؤسسة على المحتوى — المحتوى يجيب عن هذه «السالبات»: حوّلها إلى إيجابيات',
    flipToPositive: 'تحويل إلى إيجابي',
    ungroundedNote:
      '{n} من السالبات الراسببة بلا تغطية في المحتوى وبلا وسم آمن — على المستودع المنافس أن يفوز بها.'
  },
  zh: {
    rowActionsTitle: '基于语料的翻转 — 语料能回答这些“负向”查询：将它们翻转为正向',
    flipToPositive: '翻转为正向',
    ungroundedNote: '{n} 个失败的负向查询既无语料支撑也无安全的标签杠杆 — 应由竞争仓库胜出。'
  },
  sw: {
    rowActionsTitle: 'Kubadilisha kwa msingi wa makusanyo — makusanyo yajibu haya "hasi": yabadilishe kuwa chanya',
    flipToPositive: 'Geuza kuwa chanya',
    ungroundedNote:
      '{n} hasi zilizoshindwa zisio na misingi katika makusanyo wala lebe salama — hazina ya mashindano lazima iyashinde.'
  },
  st: {
    rowActionsTitle: 'Liphetoa ka motheo wa corpus — corpus e araba tse "tse sieo": li fetole hore e be tse teng',
    flipToPositive: 'Etsa e teng',
    ungroundedNote:
      '{n} tse sieo tse hlolehetseng tse se nang motheo corpus le sebaka sa tag se bolokehileng — moqhahamotsedi o tlameha o di hlola.'
  },
  id: {
    rowActionsTitle: 'Pembalikan berbasis korpus — korpus menjawab "negatif" ini: ubah menjadi positif',
    flipToPositive: 'Ubah ke positif',
    ungroundedNote:
      '{n} negatif gagal tanpa dukungan korpus dan tanpa tag pengungkit yang aman — repositori pesaing haruslah yang menang.'
  },
  bn: {
    rowActionsTitle: 'কর্পাস-ভিত্তিক উল্টানো — কর্পাস এই "নেগেটিভ" গুলোর উত্তর দেয়: সেগুলো পজিটিভে বদলান',
    flipToPositive: 'পজিটিভে বদলান',
    ungroundedNote:
      '{n}টি ব্যর্থ নেগেটিভের কর্পাস-ভিত্তি নেই এবং নিরাপদ ট্যাগ-হাতিয়ারও নেই — প্রতিদ্বন্দ্বী রিপোজিটরিকেই সেগুলো জিততে হবে।'
  },
  th: {
    rowActionsTitle: 'การพลิกตามคลังข้อมูล — คลังข้อมูลตอบ "เคสลบ" เหล่านี้: พลิกเป็นเคสบวก',
    flipToPositive: 'พลิกเป็นเคสบวก',
    ungroundedNote:
      'เคสลบที่ล้มเหลว {n} รายการไม่มีเชิงอ้างอิงในคลังข้อมูลและไม่มีแท็กที่ปลอดภัย — คู่แข่งต้องเป็นผู้ชนะ'
  },
  man: {
    rowActionsTitle: 'Corpus-grounded flips — the corpus answers these "negatives": flip them to positives',
    flipToPositive: 'Flip to positive',
    ungroundedNote:
      '{n} failing negative(s) have no corpus grounding and no safe tag lever — the competing repository must win them.'
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
  setPath(a, 'rowActionsTitle', t.rowActionsTitle);
  setPath(a, 'flipToPositive', t.flipToPositive);
  setPath(a, 'ungroundedNote', t.ungroundedNote);
  fs.writeFileSync(path.join(DIR, file), 'export default ' + ser(loc, 0) + ';\n', 'utf8');
  console.log(file + ': ok');
}
console.log('DONE');
