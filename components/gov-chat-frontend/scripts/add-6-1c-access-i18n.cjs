// Story 6-1c — add the okf.editor.access block to every locale.
// Run: node scripts/add-6-1c-access-i18n.cjs
//
// SURGICAL (same rule as add-18g-m-suggest-coverage-i18n.cjs): no parse/
// serialize round-trip — insert ONE block before the EDITOR's autocorrect
// anchor (identified structurally: the `autocorrect: {` whose next line is
// `blankBefore:` — keys are untranslated so the anchor is stable in every
// locale file), preserving each file's indentation exactly.
const fs = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..', 'src', 'i18n', 'locales');

// Values per locale. English is the source of truth; the other locales follow
// the repo's translation precedent (concise, key set identical).
const T = {
  en: {
    label: 'Repository access',
    title: 'Access',
    restricted: 'Restricted',
    openForAll: 'Open for all users',
    hintRestricted:
      'Only granted users (and stewards) can query this repository. Grant access below — it takes effect at the user’s next login.',
    hintOpen:
      'Every signed-in user can query this repository. Restrict it to fence it off and grant access per user.',
    unrestrict: 'Open for all users',
    restrict: 'Restrict repository',
    unconfiguredTip:
      'Grant/revoke needs Keycloak credentials on the server (KC_OKF_ACCESS_CLIENT_SECRET). Restriction enforcement works regardless.',
    user: 'User',
    level: 'Level',
    revoke: 'Revoke',
    noHolders: 'No users granted yet.',
    usernamePlaceholder: 'Username',
    levelRead: 'Read',
    levelAdmin: 'Admin',
    grant: 'Grant',
    error: 'Operation failed.',
    grantedNotice: 'Access granted — effective at next login.',
    revokedNotice: 'Access revoked.',
    nowRestricted: 'Repository restricted.',
    nowOpen: 'Repository open for all users.'
  },
  fr: {
    label: 'Accès au dépôt',
    title: 'Accès',
    restricted: 'Restreint',
    openForAll: 'Ouvert à tous',
    hintRestricted:
      'Seuls les utilisateurs autorisés (et les gardiens) peuvent interroger ce dépôt. Accordez l’accès ci-dessous — effet à la prochaine connexion.',
    hintOpen:
      'Tout utilisateur connecté peut interroger ce dépôt. Restreignez-le pour le cloisonner et accordez l’accès par utilisateur.',
    unrestrict: 'Ouvrir à tous',
    restrict: 'Restreindre le dépôt',
    unconfiguredTip:
      'Accorder/révoquer nécessite des identifiants Keycloak sur le serveur (KC_OKF_ACCESS_CLIENT_SECRET). Le contrôle de restriction fonctionne sans.',
    user: 'Utilisateur',
    level: 'Niveau',
    revoke: 'Révoquer',
    noHolders: 'Aucun utilisateur autorisé.',
    usernamePlaceholder: "Nom d'utilisateur",
    levelRead: 'Lecture',
    levelAdmin: 'Admin',
    grant: 'Accorder',
    error: "L'opération a échoué.",
    grantedNotice: 'Accès accordé — effectif à la prochaine connexion.',
    revokedNotice: 'Accès révoqué.',
    nowRestricted: 'Dépôt restreint.',
    nowOpen: 'Dépôt ouvert à tous.'
  },
  es: {
    label: 'Acceso al repositorio',
    title: 'Acceso',
    restricted: 'Restringido',
    openForAll: 'Abierto a todos',
    hintRestricted:
      'Solo los usuarios autorizados (y los stewards) pueden consultar este repositorio. Concede acceso abajo — surte efecto en el próximo inicio de sesión.',
    hintOpen:
      'Cualquier usuario autenticado puede consultar este repositorio. Restríngelo para limitarlo y concede acceso por usuario.',
    unrestrict: 'Abrir a todos',
    restrict: 'Restringir repositorio',
    unconfiguredTip:
      'Conceder/revocar requiere credenciales de Keycloak en el servidor (KC_OKF_ACCESS_CLIENT_SECRET). La restricción funciona igualmente.',
    user: 'Usuario',
    level: 'Nivel',
    revoke: 'Revocar',
    noHolders: 'Ningún usuario con acceso.',
    usernamePlaceholder: 'Nombre de usuario',
    levelRead: 'Lectura',
    levelAdmin: 'Admin',
    grant: 'Conceder',
    error: 'La operación falló.',
    grantedNotice: 'Acceso concedido — efectivo en el próximo inicio de sesión.',
    revokedNotice: 'Acceso revocado.',
    nowRestricted: 'Repositorio restringido.',
    nowOpen: 'Repositorio abierto a todos.'
  },
  de: {
    label: 'Repository-Zugriff',
    title: 'Zugriff',
    restricted: 'Eingeschränkt',
    openForAll: 'Für alle offen',
    hintRestricted:
      'Nur berechtigte Benutzer (und Stewards) können dieses Repository abfragen. Zugang unten gewähren — wirksam bei der nächsten Anmeldung.',
    hintOpen:
      'Jeder angemeldete Benutzer kann dieses Repository abfragen. Schränke es ein und gewähre Zugriff pro Benutzer.',
    unrestrict: 'Für alle öffnen',
    restrict: 'Repository einschränken',
    unconfiguredTip:
      'Gewähren/Widerrufen erfordert Keycloak-Zugangsdaten auf dem Server (KC_OKF_ACCESS_CLIENT_SECRET). Die Einschränkung funktioniert trotzdem.',
    user: 'Benutzer',
    level: 'Stufe',
    revoke: 'Widerrufen',
    noHolders: 'Noch keine Benutzer mit Zugang.',
    usernamePlaceholder: 'Benutzername',
    levelRead: 'Lesen',
    levelAdmin: 'Admin',
    grant: 'Gewähren',
    error: 'Vorgang fehlgeschlagen.',
    grantedNotice: 'Zugang gewährt — wirksam bei der nächsten Anmeldung.',
    revokedNotice: 'Zugang widerrufen.',
    nowRestricted: 'Repository eingeschränkt.',
    nowOpen: 'Repository für alle offen.'
  },
  pt: {
    label: 'Acesso ao repositório',
    title: 'Acesso',
    restricted: 'Restrito',
    openForAll: 'Aberto a todos',
    hintRestricted:
      'Apenas usuários autorizados (e stewards) podem consultar este repositório. Conceda acesso abaixo — vale a partir do próximo login.',
    hintOpen:
      'Qualquer usuário autenticado pode consultar este repositório. Restrinja-o e conceda acesso por usuário.',
    unrestrict: 'Abrir a todos',
    restrict: 'Restringir repositório',
    unconfiguredTip:
      'Conceder/revogar exige credenciais Keycloak no servidor (KC_OKF_ACCESS_CLIENT_SECRET). A restrição funciona de qualquer forma.',
    user: 'Usuário',
    level: 'Nível',
    revoke: 'Revogar',
    noHolders: 'Nenhum usuário com acesso.',
    usernamePlaceholder: 'Nome de usuário',
    levelRead: 'Leitura',
    levelAdmin: 'Admin',
    grant: 'Conceder',
    error: 'A operação falhou.',
    grantedNotice: 'Acesso concedido — vale no próximo login.',
    revokedNotice: 'Acesso revogado.',
    nowRestricted: 'Repositório restrito.',
    nowOpen: 'Repositório aberto a todos.'
  },
  ru: {
    label: 'Доступ к репозиторию',
    title: 'Доступ',
    restricted: 'Ограничен',
    openForAll: 'Открыт всем',
    hintRestricted:
      'Запрашивать этот репозиторий могут только пользователи с доступом (и стюарды). Выдайте доступ ниже — вступит в силу при следующем входе.',
    hintOpen:
      'Любой вошедший пользователь может запрашивать этот репозиторий. Ограничьте его и выдавайте доступ по пользователям.',
    unrestrict: 'Открыть всем',
    restrict: 'Ограничить репозиторий',
    unconfiguredTip:
      'Для выдачи/отзыва нужны учётные данные Keycloak на сервере (KC_OKF_ACCESS_CLIENT_SECRET). Само ограничение работает и без них.',
    user: 'Пользователь',
    level: 'Уровень',
    revoke: 'Отозвать',
    noHolders: 'Доступ пока никому не выдан.',
    usernamePlaceholder: 'Имя пользователя',
    levelRead: 'Чтение',
    levelAdmin: 'Админ',
    grant: 'Выдать',
    error: 'Операция не выполнена.',
    grantedNotice: 'Доступ выдан — вступит в силу при следующем входе.',
    revokedNotice: 'Доступ отозван.',
    nowRestricted: 'Репозиторий ограничен.',
    nowOpen: 'Репозиторий открыт всем.'
  },
  ar: {
    label: 'الوصول إلى المستودع',
    title: 'الوصول',
    restricted: 'مقيّد',
    openForAll: 'مفتوح للجميع',
    hintRestricted:
      'يستطيع الاستعلام عن هذا المستودع المستخدمون المصرّح لهم (والأمناء) فقط. امنح الوصول أدناه — يسري عند تسجيل الدخول التالي.',
    hintOpen: 'يمكن لأي مستخدم مسجّل الاستعلام عن هذا المستودع. قيّده وامح الوصول لكل مستخدم.',
    unrestrict: 'فتح للجميع',
    restrict: 'تقييد المستودع',
    unconfiguredTip:
      'المنح/الإلغاء يتطلب بيانات اعتماد Keycloak على الخادم (KC_OKF_ACCESS_CLIENT_SECRET). فرض التقييد يعمل بغض النظر عن ذلك.',
    user: 'المستخدم',
    level: 'المستوى',
    revoke: 'إلغاء',
    noHolders: 'لم يُمنح الوصول لأحد بعد.',
    usernamePlaceholder: 'اسم المستخدم',
    levelRead: 'قراءة',
    levelAdmin: 'إدارة',
    grant: 'منح',
    error: 'فشلت العملية.',
    grantedNotice: 'تم منح الوصول — يسري عند تسجيل الدخول التالي.',
    revokedNotice: 'تم إلغاء الوصول.',
    nowRestricted: 'تم تقييد المستودع.',
    nowOpen: 'المستودع مفتوح للجميع.'
  },
  zh: {
    label: '仓库访问',
    title: '访问',
    restricted: '已限制',
    openForAll: '对所有用户开放',
    hintRestricted: '只有被授权的用户（和管理员）可以查询此仓库。在下方授予访问权限 — 用户下次登录时生效。',
    hintOpen: '任何已登录用户都可以查询此仓库。限制它并按用户授予访问权限。',
    unrestrict: '对所有人开放',
    restrict: '限制仓库',
    unconfiguredTip: '授予/撤销需要服务器上的 Keycloak 凭据（KC_OKF_ACCESS_CLIENT_SECRET）。限制本身的执行不受影响。',
    user: '用户',
    level: '级别',
    revoke: '撤销',
    noHolders: '尚未授予任何用户。',
    usernamePlaceholder: '用户名',
    levelRead: '读取',
    levelAdmin: '管理',
    grant: '授予',
    error: '操作失败。',
    grantedNotice: '已授予访问权限 — 下次登录时生效。',
    revokedNotice: '已撤销访问权限。',
    nowRestricted: '仓库已限制。',
    nowOpen: '仓库已对所有用户开放。'
  },
  th: {
    label: 'การเข้าถึงคลังเนื้อหา',
    title: 'การเข้าถึง',
    restricted: 'จำกัด',
    openForAll: 'เปิดสำหรับทุกคน',
    hintRestricted: 'เฉพาะผู้ใช้ที่ได้รับสิทธิ์ (และผู้ดูแล) เท่านั้นที่ค้นหาคลังนี้ได้ ให้สิทธิ์ด้านล่าง — มีผลเมื่อเข้าสู่ระบบครั้งถัดไป',
    hintOpen: 'ผู้ใช้ที่ลงชื่อเข้าใช้ทุกคนค้นหาคลังนี้ได้ จำกัดมันและให้สิทธิ์รายบุคคล',
    unrestrict: 'เปิดสำหรับทุกคน',
    restrict: 'จำกัดคลังเนื้อหา',
    unconfiguredTip: 'การให้/เพิกถอนต้องใช้ข้อมูลรับรอง Keycloak บนเซิร์ฟเวอร์ (KC_OKF_ACCESS_CLIENT_SECRET) การบังคับจำกัดทำงานได้ตลอด',
    user: 'ผู้ใช้',
    level: 'ระดับ',
    revoke: 'เพิกถอน',
    noHolders: 'ยังไม่มีผู้ใช้ที่ได้รับสิทธิ์',
    usernamePlaceholder: 'ชื่อผู้ใช้',
    levelRead: 'อ่าน',
    levelAdmin: 'ผู้ดูแล',
    grant: 'ให้สิทธิ์',
    error: 'การดำเนินการล้มเหลว',
    grantedNotice: 'ให้สิทธิ์แล้ว — มีผลเมื่อเข้าสู่ระบบครั้งถัดไป',
    revokedNotice: 'เพิกถอนสิทธิ์แล้ว',
    nowRestricted: 'จำกัดคลังเนื้อหาแล้ว',
    nowOpen: 'เปิดคลังเนื้อหาสำหรับทุกคนแล้ว'
  },
  id: {
    label: 'Akses repositori',
    title: 'Akses',
    restricted: 'Dibatasi',
    openForAll: 'Terbuka untuk semua',
    hintRestricted:
      'Hanya pengguna yang diberi akses (dan steward) yang dapat mengakses repositori ini. Berikan akses di bawah — berlaku saat login berikutnya.',
    hintOpen: 'Setiap pengguna yang masuk dapat mengakses repositori ini. Batasi dan berikan akses per pengguna.',
    unrestrict: 'Buka untuk semua',
    restrict: 'Batasi repositori',
    unconfiguredTip:
      'Memberi/mencabut akses butuh kredensial Keycloak di server (KC_OKF_ACCESS_CLIENT_SECRET). Pembatasan tetap bekerja.',
    user: 'Pengguna',
    level: 'Tingkat',
    revoke: 'Cabut',
    noHolders: 'Belum ada pengguna yang diberi akses.',
    usernamePlaceholder: 'Nama pengguna',
    levelRead: 'Baca',
    levelAdmin: 'Admin',
    grant: 'Berikan',
    error: 'Operasi gagal.',
    grantedNotice: 'Akses diberikan — berlaku saat login berikutnya.',
    revokedNotice: 'Akses dicabut.',
    nowRestricted: 'Repositori dibatasi.',
    nowOpen: 'Repositori terbuka untuk semua.'
  },
  bn: {
    label: 'রিপোজিটরি অ্যাক্সেস',
    title: 'অ্যাক্সেস',
    restricted: 'সীমিত',
    openForAll: 'সবার জন্য উন্মুক্ত',
    hintRestricted:
      'শুধুমাত্র অনুমোদিত ব্যবহারকারীরা (এবং স্টুয়ার্ডরা) এই রিপোজিটরি জিজ্ঞাসা করতে পারেন। নিচে অ্যাক্সেস দিন — পরের লগইনে কার্যকর।',
    hintOpen: 'সাইন-ইন করা প্রতিটি ব্যবহারকারী এই রিপোজিটরি জিজ্ঞাসা করতে পারেন। সীমিত করুন এবং ব্যবহারকারী অনুযায়ী অ্যাক্সেস দিন।',
    unrestrict: 'সবার জন্য খুলুন',
    restrict: 'রিপোজিটরি সীমিত করুন',
    unconfiguredTip:
      'প্রদান/প্রত্যাহরে সার্ভারে Keycloak শংসাপত্র প্রয়োজন (KC_OKF_ACCESS_CLIENT_SECRET)। সীমাবদ্ধতা এমনিতেই কাজ করে।',
    user: 'ব্যবহারকারী',
    level: 'স্তর',
    revoke: 'প্রত্যাহার',
    noHolders: 'এখনো কাউকে অ্যাক্সেস দেওয়া হয়নি।',
    usernamePlaceholder: 'ব্যবহারকারীর নাম',
    levelRead: 'পড়া',
    levelAdmin: 'অ্যাডমিন',
    grant: 'প্রদান',
    error: 'অপারেশন ব্যর্থ।',
    grantedNotice: 'অ্যাক্সেস দেওয়া হয়েছে — পরের লগইনে কার্যকর।',
    revokedNotice: 'অ্যাক্সেস প্রত্যাহার করা হয়েছে।',
    nowRestricted: 'রিপোজিটরি সীমিত।',
    nowOpen: 'রিপোজিটরি সবার জন্য উন্মুক্ত।'
  },
  st: {
    label: 'Phihlelo ea polokelo',
    title: 'Phihlelo',
    restricted: 'E fokotsoeng',
    openForAll: 'E bulehileng ho bohle',
    hintRestricted:
      'Basebelisi ba fuoeng phihlelo (le batsebedisi) feela ba ka botsa polokelo ena. Fana ka phihlelo ka tlase — e sebetsa ha ba kena hape.',
    hintOpen: 'Mosebelisi ohle oa sene a ka botsa polokelo ena. E fokotse mme o fane ka phihlelo ka mosebelisi.',
    unrestrict: 'Bulehla bohle',
    restrict: 'Fokotsa polokelo',
    unconfiguredTip:
      'Ho fana/tlosa ho hloka Keycloak ho seva (KC_OKF_ACCESS_CLIENT_SECRET). Phihlelo e sebetsa ntle le eona.',
    user: 'Mosebelisi',
    level: 'Boemo',
    revoke: 'Tlosa',
    noHolders: 'Ha ho mosebelisi ea fuoeng phihlelo.',
    usernamePlaceholder: 'Lebitso la mosebelisi',
    levelRead: 'Bala',
    levelAdmin: 'Taolo',
    grant: 'Fana',
    error: 'Tshebetso e hafetsoe.',
    grantedNotice: 'Phihlelo e fanoeng — e sebetsa ha a kena hape.',
    revokedNotice: 'Phihlelo e tlosoe.',
    nowRestricted: 'Polokelo e fokotsoe.',
    nowOpen: 'Polokelo e bulehile ho bohle.'
  },
  sw: {
    label: 'Ufikiaji wa hifadhi',
    title: 'Ufikiaji',
    restricted: 'Imepunguzwa',
    openForAll: 'Wazi kwa wote',
    hintRestricted:
      'Watumiaji waliopewa ufikiaji (na wasimamizi) pekee wanaweza kuuliza hifadhi hii. Toa ufikiaji hapa chini — itaanza kufanya kazi kuingia mara ijayo.',
    hintOpen: 'Kila mtumiaji aliyeingia anaweza kuuliza hifadhi hii. Punguza na toa ufikiaji kwa kila mtumiaji.',
    unrestrict: 'Fungua kwa wote',
    restrict: 'Punguza hifadhi',
    unconfiguredTip:
      'Kutoa/kubatilisha inahitaji vitambulisho vya Keycloak kwenye seva (KC_OKF_ACCESS_CLIENT_SECRET). Utekaji wa ukandamizaji unaendelea bila.',
    user: 'Mtumiaji',
    level: 'Kiwango',
    revoke: 'Batilisha',
    noHolders: 'Hakuna mtumiaji aliyepelekwa bado.',
    usernamePlaceholder: 'Jina la mtumiaji',
    levelRead: 'Soma',
    levelAdmin: 'Msimamizi',
    grant: 'Toa',
    error: 'Operesheni imeshindikana.',
    grantedNotice: 'Ufikiaji umetolewa — utaanza kuingia mara ijayo.',
    revokedNotice: 'Ufikiaji umebatilishwa.',
    nowRestricted: 'Hifadhi imepunguzwa.',
    nowOpen: 'Hifadhi iko wazi kwa wote.'
  },
  man: {
    label: 'Aseeg yesli depot',
    title: 'Aseeg',
    restricted: 'E limita',
    openForAll: 'E aberto pa tur',
    hintRestricted:
      'S useris ku tin aseeg (i steward) por buska depot sta. Duna aseeg aba — e kobra ku user login li pa pruksimu.',
    hintOpen: 'Kada user ku ta login por buska depot sta. Limita li i duna aseeg pa kada user.',
    unrestrict: 'Abri pa tur',
    restrict: 'Limita depot',
    unconfiguredTip:
      'Duna/tira aseeg presiza Keycloak kredensial na server (KC_OKF_ACCESS_CLIENT_SECRET). Limitason ta traba nhotodu.',
    user: 'User',
    level: 'Nivel',
    revoke: 'Tira',
    noHolders: 'Nda run user ku tin aseeg.',
    usernamePlaceholder: 'Nomi di user',
    levelRead: 'Le',
    levelAdmin: 'Admin',
    grant: 'Duna',
    error: 'Operason pa perde.',
    grantedNotice: 'Aseeg duna — e kobra ku login pa pruksimu.',
    revokedNotice: 'Aseeg tira.',
    nowRestricted: 'Depot limita.',
    nowOpen: 'Depot aberto pa tur.'
  }
};

function quote(v) {
  return `'${v.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`;
}

function blockFor(code, indent) {
  const t = T[code];
  const lines = [`${indent}access: {`];
  for (const [k, v] of Object.entries(t)) {
    lines.push(`${indent}  ${k}: ${quote(v)},`);
  }
  lines.push(`${indent}},`);
  return lines.join('\n');
}

let updated = 0;
const skipped = [];
for (const code of Object.keys(T)) {
  const file = path.join(DIR, `${code}.js`);
  if (!fs.existsSync(file)) {
    skipped.push(`${code}: file missing`);
    continue;
  }
  const src = fs.readFileSync(file, 'utf8');
  if (/^\s*access: \{/m.test(src) && src.includes('okf.editor.access') === false && src.includes("'Access granted") === false) {
    // guard: an `access:` key may already exist elsewhere; only skip when OUR
    // keys are present.
  }
  if (src.includes("nowOpen:")) {
    skipped.push(`${code}: already has the access block`);
    continue;
  }
  const lines = src.split('\n');
  let at = -1;
  let indent = '      ';
  for (let i = 0; i < lines.length; i++) {
    if (/^(\s*)autocorrect: \{$/.test(lines[i]) && lines[i + 1] && lines[i + 1].includes('blankBefore:')) {
      at = i;
      indent = lines[i].match(/^(\s*)/)[1];
      break;
    }
  }
  if (at === -1) {
    skipped.push(`${code}: editor autocorrect anchor not found`);
    continue;
  }
  lines.splice(at, 0, blockFor(code, indent));
  fs.writeFileSync(file, lines.join('\n'));
  updated++;
}
console.log(`updated ${updated} locales; skipped: ${skipped.length ? skipped.join('; ') : 'none'}`);
