// OKF Story 7.7 smoke — produce an OKF repository from selected documents.
// EXTENDED (David, 2026-09-14): all six supported formats, a ~20x larger
// slaughterhouse-themed corpus, and a SEEDED KNOWLEDGE HIERARCHY proven
// end to end.
//   0 Seed the KH: serviceCategories L1 'Slaughterhouse Services' + 10 L2
//     services (the label taxonomy llm-curation-service bounds labels to).
//   1 Build + upload SEVEN files across ALL formats: md, pdf x2, xlsx,
//     docx, html, txt (docx built in-container; PDFs are real Edge prints).
//   2 Ingest the .md FREE-FORM first (the double-serving scenario).
//   3 Import all seven into ONE repo, domain = the seeded L1, heuristics.
//   4 Prove whole-corpus conversion: files_imported, concepts, provenance,
//     xlsx dictionaries + row-group capping (250-row sheet -> 2 groups).
//   5 Prove the KH: heuristics labeling binds KH L2 labels — every label in
//     okf_concepts_meta is IN the seeded set (bounded, LLM can never invent),
//     several distinct labels used, themed sections carry their label.
//   6 Review -> publish v1 (Presidio PII gate -> steward acknowledge).
//   7 ingest -> 409 SOURCES_NOT_RETRACTED (md still serving) -> retract ->
//     ingest -> drain -> v1 serving.
// Run INSIDE the okf-server container:
//   docker cp run-smoke-import-documents.js <c>:/app/  &&  docker cp fixtures <c>:/app/fixtures
//   docker exec -e OKF_SMOKE_TOKEN_ADMIN=<tok> -e OKF_SMOKE_REFRESH_ADMIN=<rtok> \
//     -e KEYCLOAK_INTERNAL_URL=http://keycloak:8080 <c> node /app/run-smoke-import-documents.js

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const AdmZip = require('adm-zip');
const dbService = require('./shared-lib/db-connection-service');

const BASE = process.env.OKF_SMOKE_BASE_URL || 'http://localhost:3002/api/okf';
const DOC_REPO = process.env.OKF_SMOKE_DOC_REPO_URL || 'http://document-repository:3001';
const KC_BASE = process.env.KEYCLOAK_INTERNAL_URL || process.env.KEYCLOAK_URL || 'http://keycloak:8080';
const KC_REALM = process.env.KEYCLOAK_REALM || 'genie';
let TOKEN = process.env.OKF_SMOKE_TOKEN_ADMIN;
const REFRESH = process.env.OKF_SMOKE_REFRESH_ADMIN || null;
const STAMP = 'doc-import-smoke-' + Date.now();
const REPO_NAME = 'story-7-7 ' + STAMP;
const DOMAIN = 'Slaughterhouse Services';
let REPO_ID = null;

// ── the seeded Knowledge Hierarchy (Subject Area L1 + bounded L2 labels) ────
const KH = {
  categoryKey: 'kh-smoke-abattoir',
  category: DOMAIN,
  labels: [
    'Abattoir Licensing',
    'Meat Inspection',
    'Slaughter Fees',
    'Animal Welfare',
    'Hygiene Compliance',
    'Livestock Transport',
    'Waste Handling',
    'Export Certification',
    'Penalty Enforcement',
    'Premises Approval'
  ]
};

let failures = 0;
function pass(m) {
  console.log('PASS  ' + m);
}
function fail(m) {
  failures += 1;
  console.error('FAIL  ' + m);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── auth (refresh-token renewal — access tokens live ~5 min) ────────────────
async function refreshToken() {
  if (!REFRESH) return false;
  try {
    const res = await fetch(`${KC_BASE}/realms/${KC_REALM}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'refresh_token', client_id: 'genie-app', refresh_token: REFRESH })
    });
    const j = await res.json();
    if (j && j.access_token) {
      TOKEN = j.access_token;
      return true;
    }
  } catch {
    /* fallthrough */
  }
  return false;
}

async function call(method, url, body, headers, retried) {
  const res = await fetch(BASE + url, {
    method,
    headers: Object.assign({ Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' }, headers),
    body: body ? JSON.stringify(body) : undefined
  });
  let j = null;
  try {
    j = await res.json();
  } catch {
    /* non-json */
  }
  if (res.status === 401 && !retried && (await refreshToken())) return call(method, url, body, headers, true);
  return { status: res.status, body: j };
}

async function uploadDocRepo(fileName, contentType, buffer) {
  const form = new FormData();
  form.append('file', new Blob([buffer], { type: contentType }), fileName);
  const res = await fetch(DOC_REPO + '/api/files/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN },
    body: form
  });
  const j = await res.json().catch(() => ({}));
  const id = (j.data && (j.data.file_id || j.data.id)) || j.file_id || j.id;
  return { status: res.status, file_id: id, body: j };
}

async function docRepoFile(fileId, retried) {
  const res = await fetch(DOC_REPO + '/api/files/' + encodeURIComponent(fileId), {
    headers: { Authorization: 'Bearer ' + TOKEN }
  });
  const j = await res.json().catch(() => ({}));
  if (res.status === 401 && !retried && (await refreshToken())) return docRepoFile(fileId, true);
  const d = j || {};
  return d.file || (d.data && d.data.file) || d.data || d || {};
}

async function retractDocRepo(fileId, retried, waitCount) {
  const res = await fetch(DOC_REPO + '/api/files/' + encodeURIComponent(fileId) + '/retract', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: '{}'
  });
  if (res.status === 401 && !retried && (await refreshToken())) return retractDocRepo(fileId, true);
  if (res.status === 429 && (waitCount || 0) < 10) {
    // retract also queues through dataprep — wait out slot contention
    console.log('WARN  retract busy (429) — waiting 20s (' + ((waitCount || 0) + 1) + '/10)');
    await sleep(20000);
    return retractDocRepo(fileId, retried, (waitCount || 0) + 1);
  }
  return res.status;
}

async function poll(label, timeoutMs, everyMs, fn) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    let out;
    try {
      out = await fn();
    } catch (e) {
      out = { done: false };
    }
    if (out.done) return out;
    await sleep(everyMs);
  }
  fail(label + ' — timed out after ' + Math.round(timeoutMs / 1000) + 's');
  return { done: false, timedOut: true };
}

// ── KH seeding (idempotent: fixed _keys, removed then re-saved) ─────────────
// The KH is consumed through TWO surfaces and the seed must satisfy BOTH:
//   - llm-curation-service.resolveAreaContext reads serviceCategories.nameEN
//     + services.categoryId/nameEN directly.
//   - the backend /api/service-categories/categories tree (dataprep's
//     labeling taxonomy) joins TRANSLATIONS (serviceCategoryTranslations /
//     serviceTranslations, languageCode EN) and categoryServices EDGES — a
//     category without its EN translation row surfaces as name:null in the
//     tree and poisoned dataprep's all_labels with None (live 2026-09-14).
async function seedHierarchy(db) {
  await db.query('FOR t IN serviceTranslations FILTER STARTS_WITH(t.serviceId, @p) REMOVE t IN serviceTranslations', { p: KH.categoryKey + '-l2-' });
  await db.query('FOR t IN serviceCategoryTranslations FILTER t.serviceCategoryId == @k REMOVE t IN serviceCategoryTranslations', { k: KH.categoryKey });
  await db.query('FOR e IN categoryServices FILTER e._from == @id REMOVE e IN categoryServices', { id: 'serviceCategories/' + KH.categoryKey });
  await db.query('FOR s IN services FILTER s.categoryId == @k REMOVE s IN services', { k: KH.categoryKey });
  await db.query('FOR c IN serviceCategories FILTER c._key == @k REMOVE c IN serviceCategories', { k: KH.categoryKey });

  await db.collection('serviceCategories').save({ _key: KH.categoryKey, nameEN: KH.category, order: 9999 });
  await db.collection('serviceCategoryTranslations').save({
    serviceCategoryId: KH.categoryKey,
    languageCode: 'EN',
    translation: KH.category
  });
  for (const [i, name] of KH.labels.entries()) {
    const svcKey = KH.categoryKey + '-l2-' + i;
    await db.collection('services').save({
      _key: svcKey,
      categoryId: KH.categoryKey,
      nameEN: name,
      order: i + 1
    });
    await db.collection('serviceTranslations').save({
      serviceId: svcKey,
      languageCode: 'EN',
      translation: name
    });
    await db.collection('categoryServices').save({
      _from: 'serviceCategories/' + KH.categoryKey,
      _to: 'services/' + svcKey,
      order: i + 1
    });
  }
}

// ── the corpus (~20x the original volume, every section keyword-themed) ─────
const SECTION_WORDS = {
  'Abattoir Licensing':
    'Abattoir licensing requires an annual renewal. The licensing desk processes each licence application within ten working days, and an abattoir licence may be suspended where hygiene findings show repeated breaches of the licensing conditions.',
  'Meat Inspection':
    'Meat inspection precedes each slaughter day. Veterinary inspection of meat covers ante-mortem and post-mortem examination, and the inspection record is entered in the central register before inspectors leave the premises.',
  'Slaughter Fees':
    'Slaughter fees are payable on invoice within thirty days. The fee schedule lists per-head slaughter fees for cattle, sheep and goats, and overdue fees become penalties enforceable under the regulations.',
  'Animal Welfare':
    'Animal welfare at the slaughterhouse is protected by law: handling of livestock must avoid unnecessary pain, and welfare officers may inspect stunning equipment at any time without prior notice.',
  'Hygiene Compliance':
    'Hygiene compliance covers the washdown of kill floors, chilled storage temperatures, and the personal hygiene of staff. Compliance findings are recorded by inspectors during each hygiene audit.',
  'Livestock Transport':
    'Livestock transport vehicles must be cleaned between journeys. Transport pens provide water, and transport duration limits protect animal welfare during long journeys to the abattoir.',
  'Waste Handling':
    'Waste handling at the slaughterhouse separates specified risk material. Rendering plants collect the waste, and handling records trace every waste consignment leaving the site.',
  'Export Certification':
    'Export certification of meat is issued after inspection. Each export consignment receives a health certificate, and certification numbers are logged for traceability of exported meat.',
  'Penalty Enforcement':
    'Penalty enforcement escalates for overdue accounts: penalties rise from five percent to twenty five percent, and enforcement officers may suspend the licence until the penalty is paid in full.',
  'Premises Approval':
    'Premises approval requires a plan of the abattoir layout, drainage, and lairage. No premises may operate without approval, and approved premises are re-inspected every year.'
};
const THEME = Object.keys(SECTION_WORDS); // 10 labels

function para(label, extra) {
  return SECTION_WORDS[label] + (extra ? ' ' + extra : '');
}

// Cross-file references (David, 2026-09-14): every section NATURALLY points
// at related sections in the OTHER documents, so the whole-corpus link pass
// produces a CONNECTED graph instead of fragmented islands. Targets are the
// deterministic concept paths: <filebase>-sec<N> for multi-section files,
// <filebase> for single-concept files (the memo PDF), and the rates sheet's
// data-dictionary concept.
const P_POLICY = 'policy-' + STAMP;
const P_REG = 'regulations-' + STAMP;
const P_OPS = 'operations-' + STAMP;
const P_GUID = 'guidance-' + STAMP;
const P_NOTICES = 'notices-' + STAMP;
const P_MEMO = 'memo-' + STAMP;
const P_RATES = 'rates-' + STAMP + '-rates-dictionary';
function link(label, pathNoExt) {
  return '[' + label + '](' + pathNoExt + '.md)';
}

function buildPolicyMd() {
  const out = ['# Abattoir policy pack (' + STAMP + ')', '', para(THEME[0], ' Applies nationwide.'), ''];
  // sec1 = title+intro; sec2..sec12 = the 11 themed sections; sec13/14 = recaps.
  for (let i = 0; i < 11; i++) {
    const label = THEME[i % THEME.length];
    const k = i % 8; // regulations/operations/guidance themed section (0-based → sec k+2)
    out.push('## ' + label + ' (policy ' + (i + 1) + ')', '');
    out.push(para(label) + ' Policy reference: ' + STAMP + '-' + (i + 1) + '.', '');
    out.push(
      'Related: ' +
        link(label + ' regulations', P_REG + '-sec' + (k + 2)) +
        ', ' +
        link(label + ' operating procedure', P_OPS + '-sec' + (k + 2)) +
        '.',
      ''
    );
  }
  out.push('## Enforcement recap', '', para('Penalty Enforcement'), '');
  out.push(
    'See also ' + link('the public enforcement notices', P_NOTICES + '-sec2') +
    ' and ' + link('the welfare guidance', P_GUID + '-sec4') + '.',
    ''
  );
  out.push('## Fees recap', '', para('Slaughter Fees'), '');
  out.push(
    'The payable amounts are listed in ' + link('the rate tables', P_RATES) +
    ' and the payable-on-invoice memo: ' + link('slaughter fee memo', P_MEMO) + '.',
    ''
  );
  return out.join('\n');
}

function buildNoticesTxt() {
  const picks = ['Meat Inspection', 'Slaughter Fees', 'Animal Welfare', 'Livestock Transport', 'Waste Handling', 'Export Certification'];
  const out = ['# Public notices (' + STAMP + ')', ''];
  picks.forEach((label, n) => {
    const k = n % 8;
    out.push('## ' + label + ' notice', '', para(label), '');
    out.push(
      'Related: ' +
        link(label + ' operations', P_OPS + '-sec' + (k + 2)) + ', ' +
        link(label + ' guidance', P_GUID + '-sec' + (k + 2)) + '.',
      ''
    );
  });
  return out.join('\n');
}

function buildGuidanceHtml() {
  const picks = ['Abattoir Licensing', 'Hygiene Compliance', 'Animal Welfare', 'Premises Approval', 'Meat Inspection', 'Waste Handling', 'Export Certification', 'Livestock Transport'];
  const body = picks
    .map((l, j) => {
      return (
        '<h2>' + l + ' guidance</h2>\n<p>' + para(l) + '</p>\n' +
        '<p>Related: <a href="' + P_POLICY + '-sec' + (j + 2) + '.md">' + l + ' policy</a>, ' +
        '<a href="' + P_OPS + '-sec' + (j + 2) + '.md">' + l + ' operating procedure</a>.</p>'
      );
    })
    .join('\n');
  return (
    '<html><head><meta charset="utf-8"><title>Abattoir guidance</title></head>\n<body>\n<h1>Operator guidance (' +
    STAMP + ')</h1>\n' + body + '\n</body></html>'
  );
}

function buildOperationsDocx() {
  const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const paras = [
    '# Abattoir operations manual (' + STAMP + ')',
    para(THEME[0])
  ];
  for (let i = 0; i < 8; i++) {
    const label = THEME[i % THEME.length];
    paras.push('## ' + label + ' — operations ' + (i + 1));
    paras.push(
      para(label) +
        ' Related: [' + label + ' regulations](' + P_REG + '-sec' + (i + 2) + '.md), [' +
        label + ' guidance](' + P_GUID + '-sec' + (i + 2) + '.md).'
    );
  }
  const xml =
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
    paras.map((p) => '<w:p><w:r><w:t xml:space="preserve">' + esc(p) + '</w:t></w:r></w:p>').join('') +
    '</w:body></w:document>';
  const zip = new AdmZip();
  zip.addFile(
    '[Content_Types].xml',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
    )
  );
  zip.addFile(
    '_rels/.rels',
    Buffer.from(
      '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
    )
  );
  zip.addFile('word/document.xml', Buffer.from(xml));
  return zip.toBuffer();
}

function buildDataXlsx() {
  const wb = xlsx.utils.book_new();
  const rows = (n, mk) => [mk.header].concat(Array.from({ length: n }, (_, i) => mk.row(i)));
  xlsx.utils.book_append_sheet(
    wb,
    xlsx.utils.aoa_to_sheet(rows(40, { header: ['Region', 'Slaughter fees USD', 'Notes'], row: (i) => ['Region ' + (i + 1), (12 + (i % 5)).toFixed(2), 'slaughter fees per head, payable on invoice'] })),
    'Rates'
  );
  xlsx.utils.book_append_sheet(
    wb,
    xlsx.utils.aoa_to_sheet(rows(30, { header: ['Days late', 'Penalty %', 'Enforcement note'], row: (i) => [i + 1, 5 + Math.floor(i / 10) * 5, 'penalty enforcement schedule for overdue fees'] })),
    'Penalties'
  );
  xlsx.utils.book_append_sheet(
    wb,
    xlsx.utils.aoa_to_sheet(rows(60, { header: ['Day', 'Premises', 'Inspection', 'Result'], row: (i) => ['Day ' + (i + 1), 'Premises ' + ((i % 12) + 1), 'meat inspection completed', i % 7 === 0 ? 'hygiene finding' : 'passed'] })),
    'Inspections'
  );
  xlsx.utils.book_append_sheet(
    wb,
    xlsx.utils.aoa_to_sheet(rows(250, { header: ['Licence no', 'Premises', 'Licensing status', 'Welfare audit'], row: (i) => ['LIC-' + (1000 + i), 'Abattoir premises ' + (i + 1), 'abattoir licensing current', i % 5 === 0 ? 'animal welfare review' : 'ok'] })),
    'LicensedPremises'
  );
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

function readPdfFixture(name) {
  return fs.readFileSync(path.join(__dirname, 'fixtures', name));
}

// ── main ─────────────────────────────────────────────────────────────────────
(async () => {
  if (!TOKEN) {
    console.error('OKF_SMOKE_TOKEN_ADMIN is required');
    process.exit(1);
  }
  const db = await dbService.getConnection('default');

  // 0. Seed the KH (L1 + 10 L2 labels)
  await seedHierarchy(db);
  const catNames = await (await db.query('FOR c IN serviceCategories FILTER c._key == @k RETURN c.nameEN', { k: KH.categoryKey })).all();
  const l2Names = await (await db.query('FOR s IN services FILTER s.categoryId == @k SORT s.nameEN RETURN s.nameEN', { k: KH.categoryKey })).all();
  catNames.length === 1 && l2Names.length === KH.labels.length
    ? pass('KH seeded: L1 "' + catNames[0] + '" + ' + l2Names.length + ' L2 labels')
    : fail('KH seeding failed: cats=' + JSON.stringify(catNames) + ' l2=' + l2Names.length);

  // 0b. SELF-CLEAN previous smoke runs (David, 2026-09-14: never fork the
  // knowledge base with repeated repos from the same corpus). Previous
  // story-7-7 repos are retracted (if needed) and deleted via the API, so
  // exactly ONE live import repo exists per run and the same content never
  // serves twice through two RAG channels.
  const prior = await db
    .query(
      "FOR r IN okf_repositories FILTER r.deleted_at == null AND STARTS_WITH(r.name, 'story-7-7 ') RETURN {repo_id: r.repo_id, name: r.name, state: r.lifecycle_state, serving: r.ingested_version}",
      {}
    )
    .then((c) => c.all());
  for (const r of prior) {
    if (Number(r.serving) >= 1 || r.state === 'publish' || r.state === 'approve' || r.state === 'review') {
      const ret = await call('POST', '/repos/' + r.repo_id + '/lifecycle', { action: 'retract' });
      console.log('INFO  cleanup: retract ' + r.repo_id + ' → ' + ret.status);
    }
    const del = await fetch(BASE + '/repos/' + r.repo_id, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer ' + TOKEN }
    });
    console.log('INFO  cleanup: delete ' + r.repo_id + ' (' + r.name + ') → ' + del.status);
  }
  prior.length > 0
    ? console.log('INFO  cleaned ' + prior.length + ' previous smoke repo(s)')
    : console.log('INFO  no previous smoke repos to clean');

  // 1. Build + upload SEVEN files, all supported formats
  const files = [
    { name: 'policy-' + STAMP + '.md', type: 'text/markdown', buf: Buffer.from(buildPolicyMd(), 'utf8') },
    { name: 'regulations-' + STAMP + '.pdf', type: 'application/pdf', buf: readPdfFixture('abattoir-regulations-en.pdf') },
    { name: 'memo-' + STAMP + '.pdf', type: 'application/pdf', buf: readPdfFixture('memo-en.pdf') },
    { name: 'rates-' + STAMP + '.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buf: buildDataXlsx() },
    { name: 'operations-' + STAMP + '.docx', type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', buf: buildOperationsDocx() },
    { name: 'guidance-' + STAMP + '.html', type: 'text/html', buf: Buffer.from(buildGuidanceHtml(), 'utf8') },
    { name: 'notices-' + STAMP + '.txt', type: 'text/plain', buf: Buffer.from(buildNoticesTxt(), 'utf8') }
  ];
  const fileIds = [];
  for (const f of files) {
    const up = await uploadDocRepo(f.name, f.type, f.buf);
    if ((up.status === 200 || up.status === 201) && up.file_id) {
      fileIds.push(up.file_id);
      pass('upload ' + f.name + ' → ' + up.file_id);
    } else {
      fail('upload ' + f.name + ' → HTTP ' + up.status + ' ' + JSON.stringify(up.body).slice(0, 160));
    }
  }
  if (fileIds.length !== files.length) {
    console.log('RESULT: uploads incomplete');
    process.exit(1);
  }

  // 2. Free-form ingest the .md (double-serving scenario). The remote vLLM
  // labeling is shared infra with known flakiness (a malformed LLM label
  // response can 500 the whole ingest — dataprep:1412 None.lower()), so a
  // terminal failure is RETRIED (retract-then-reingest is the documented
  // recovery), bounded at 3 attempts.
  let served = false;
  let slotWaits = 0;
  for (let attempt = 1; attempt <= 3 && !served; attempt++) {
    const kick = await fetch(DOC_REPO + '/api/files/' + fileIds[0] + '/ingest', {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
      body: '{}'
    });
    if (kick.status === 429) {
      // dataprep's flock slot pool is single-slot — wait out contention
      // (e.g. a prior drain still labeling through the flaky vLLM).
      slotWaits++;
      if (slotWaits > 10) {
        fail('ingest slots busy for 5+ minutes — dataprep saturated');
        break;
      }
      console.log('WARN  ingest slots busy (429) — waiting 30s (' + slotWaits + '/10)');
      await sleep(30000);
      attempt--;
      continue;
    }
    if (kick.status !== 200 && kick.status !== 202) {
      fail('ingest kick attempt ' + attempt + ' → ' + kick.status);
      break;
    }
    if (attempt > 1) console.log('INFO  free-form ingest re-kick attempt ' + attempt);
    const ingPoll = await poll('md Ingested (free-form, attempt ' + attempt + ')', 10 * 60000, 10000, async () => {
      const f = await docRepoFile(fileIds[0]);
      const s = String((f && f.dataprep && f.dataprep.status) || '').toLowerCase().trim();
      if (s === 'ingested' || s === 'ingested with warnings') return { done: true, served: true };
      if (s === 'ingestion error' || s === 'retracted') return { done: true, errored: true, s };
      return { done: false };
    });
    if (ingPoll.served) {
      served = true;
      pass('md now SERVES the free-form corpus' + (attempt > 1 ? ' (after re-kick)' : ''));
    } else {
      console.log(
        'WARN  free-form ingest attempt ' + attempt + ' ended in "' + (ingPoll.s || 'timeout') + '" — known transient vLLM labeling flake; re-kicking'
      );
      await sleep(5000);
    }
  }
  if (!served) {
    fail('md never reached Ingested — gate scenario cannot run');
    console.log('RESULT: aborted — free-form ingest precondition failed (see WARN lines above)');
    process.exit(1);
  }

  // 3. Import all seven into ONE repo — domain = the seeded KH L1
  const imp = await call('POST', '/repos/convert-from-documents', {
    file_ids: fileIds,
    name: REPO_NAME,
    domain: DOMAIN,
    classification: 'heuristics'
  });
  REPO_ID = imp.body && imp.body.repo_id;
  imp.status === 202 && REPO_ID
    ? pass('convert-from-documents → 202 repo_id=' + REPO_ID + ' domain="' + DOMAIN + '"')
    : fail('convert-from-documents → HTTP ' + imp.status + ' ' + JSON.stringify(imp.body).slice(0, 200));

  // 4. Conversion + whole-corpus proofs
  const conv = await poll('conversion done', 10 * 60000, 10000, async () => {
    const r = await call('GET', '/repos/' + REPO_ID);
    const c = r.body && r.body.conversion;
    if (!c) return { done: false };
    if (c.status === 'done' || c.status === 'failed') return { done: true, conversion: c, repo: r.body };
    return { done: false };
  });
  const conversion = conv.conversion || {};
  conversion.status === 'done'
    ? pass('conversion done: ' + JSON.stringify(conversion.summary || {}).slice(0, 220))
    : fail('conversion status=' + conversion.status + ' error=' + (conversion.error || 'n/a'));
  const summary = conversion.summary || {};
  summary.files_imported === 7
    ? pass('summary.files_imported === 7 (ALL formats)')
    : fail('summary.files_imported=' + summary.files_imported + ' (want 7)');
  const repoAfterConv = conv.repo || {};
  (repoAfterConv.source_documents || []).length === 7
    ? pass('source_documents stamped with all 7 file_ids')
    : fail('source_documents=' + (repoAfterConv.source_documents || []).length);

  const metas = await db
    .query('FOR m IN okf_concepts_meta FILTER m.repo_id == @rid RETURN m', { rid: REPO_ID })
    .then((c) => c.all());
  const content = metas.filter((m) => !m.is_index);
  const withFileSrc = metas.filter(
    (m) =>
      m.frontmatter &&
      Array.isArray(m.frontmatter.sources) &&
      m.frontmatter.sources.some((s) => s && fileIds.includes(s.file_id))
  );
  withFileSrc.length >= 7
    ? pass('provenance: ' + withFileSrc.length + ' concepts carry file_id sources (≥7)')
    : fail('provenance: only ' + withFileSrc.length);
  content.length >= 40
    ? pass('corpus volume: ' + content.length + ' content concepts (≥40 — ~20x the original 3-concept corpus)')
    : fail('concepts=' + content.length + ' (want ≥40)');
  const dicts = content.filter((m) => /dictionary/.test(String(m.concept_id)));
  dicts.length === 4
    ? pass('xlsx: 4 sheet data-dictionaries (' + dicts.map((d) => d.concept_id.split('-dictionary')[0].split('-').pop()).join(', ') + ')')
    : fail('data-dictionaries=' + dicts.length + ' (want 4)');
  const premisesGroups = content.filter((m) => /licensedpremises-rows/.test(String(m.concept_id)));
  premisesGroups.length === 2
    ? pass('xlsx row-group cap: 250-row sheet → 2 groups (200 + 50)')
    : fail('LicensedPremises groups=' + premisesGroups.length + ' (want 2)');

  // 4b. CONNECTED GRAPH proof — the corpus cross-references itself, so the
  // whole-corpus link pass must bind real links (David: "appropriately
  // related data … links between the concepts when imported", not islands).
  Number(summary.links) >= 30
    ? pass('cross-file links resolved at import: ' + summary.links + ' (≥30)')
    : fail('summary.links=' + summary.links + ' (want ≥30 — the corpus must cross-reference itself)');
  const metaLinks = content.flatMap((m) => (m.frontmatter && Array.isArray(m.frontmatter.links) ? m.frontmatter.links : []));
  const linkTargets = new Set(metaLinks.map((l) => l.to_concept_id));
  metaLinks.length >= 40 && linkTargets.size >= 12
    ? pass('graph projection: ' + metaLinks.length + ' links across ' + linkTargets.size + ' distinct concepts (connected, not islands)')
    : fail('meta links=' + metaLinks.length + ' targets=' + linkTargets.size + ' (want ≥40 / ≥12)');

  // 5. THE KH PROOF — heuristics labels, bounded to the seeded L2 set
  const labelsOf = (m) => (Array.isArray(m.labels) && m.labels.length ? m.labels : (m.frontmatter && m.frontmatter.labels) || []);
  const allLabels = content.flatMap(labelsOf);
  const foreign = allLabels.filter((l) => !KH.labels.includes(l));
  foreign.length === 0
    ? pass('KH bounded: all ' + allLabels.length + ' assigned labels are seeded L2 entries (zero invented)')
    : fail('labels OUTSIDE the seeded KH: ' + JSON.stringify([...new Set(foreign)]));
  const distinct = [...new Set(allLabels)];
  distinct.length >= 6
    ? pass('KH coverage: ' + distinct.length + ' distinct L2 labels assigned (≥6) — ' + distinct.slice(0, 5).join(', ') + '…')
    : fail('only ' + distinct.length + ' distinct labels');
  // concept_ids are <filebase>-sec<N> (section index) — match by TITLE.
  const titleOf = (m) => String((m.frontmatter && m.frontmatter.title) || '');
  const spot = content.filter((m) => /abattoir licensing/i.test(titleOf(m)));
  spot.length >= 1 && labelsOf(spot[0]).includes('Abattoir Licensing')
    ? pass('spot-check: "' + titleOf(spot[0]) + '" carries KH label "Abattoir Licensing"')
    : fail('spot-check failed: ' + JSON.stringify(spot.map((m) => ({ id: m.concept_id, labels: labelsOf(m) }))).slice(0, 200));
  const spot2 = content.filter((m) => /meat inspection/i.test(titleOf(m)));
  spot2.length >= 1 && labelsOf(spot2[0]).includes('Meat Inspection')
    ? pass('spot-check: "' + titleOf(spot2[0]) + '" carries KH label "Meat Inspection"')
    : fail('spot-check 2 failed: ' + JSON.stringify(spot2.map((m) => ({ id: m.concept_id, labels: labelsOf(m) }))).slice(0, 200));
  const repoCur = await call('GET', '/repos/' + REPO_ID);
  const cur = (repoCur.body && repoCur.body.curation) || {};
  Number(cur.labeled) > 0
    ? pass('curation stats: labeled=' + cur.labeled + '/' + cur.total + ' method=' + cur.method + ' (area matched)')
    : fail('curation stats show 0 labeled: ' + JSON.stringify(cur).slice(0, 160));

  // 6. Review → publish v1 (Presidio gate → steward acknowledge)
  for (const action of ['submit', 'approve']) {
    const r = await call('POST', '/repos/' + REPO_ID + '/lifecycle', { action });
    r.status === 200 || r.status === 201
      ? pass('lifecycle ' + action + ' → ' + r.status)
      : fail('lifecycle ' + action + ' → ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 120));
  }
  let pub = await call('POST', '/repos/' + REPO_ID + '/lifecycle', { action: 'publish' });
  if (pub.status === 409 && pub.body && pub.body.error === 'PII_GATE_BLOCKED') {
    pass('publish gated by the Presidio PII review (as designed) — acknowledging as steward');
    const ack = await call('POST', '/repos/' + REPO_ID + '/pii-acknowledge', { acknowledge: true });
    ack.status === 200 ? pass('pii-acknowledge → 200') : fail('pii-acknowledge → ' + ack.status);
    pub = await call('POST', '/repos/' + REPO_ID + '/lifecycle', { action: 'publish' });
  }
  pub.status === 200 || pub.status === 201
    ? pass('lifecycle publish → ' + pub.status)
    : fail('lifecycle publish → ' + pub.status + ' ' + JSON.stringify(pub.body).slice(0, 160));
  const mintPoll = await poll('publish v1 mint', 3 * 60000, 5000, async () => {
    const r = await call('GET', '/repos/' + REPO_ID);
    const b = r.body || {};
    if (b.lifecycle_state === 'publish' && (Number(b.version) >= 1 || b.okf_tag)) return { done: true };
    return { done: false };
  });
  const afterPub = await call('GET', '/repos/' + REPO_ID);
  const v1 = afterPub.body && (afterPub.body.okf_tag || afterPub.body.version);
  if (mintPoll.timedOut) fail('mint poll timed out');
  v1 ? pass('v1 minted: tag=' + v1) : fail('no version/okf_tag after publish');

  // 7. THE GATE — ingest refused while the md still serves; retract; drain
  const gated = await call('POST', '/repos/' + REPO_ID + '/lifecycle', { action: 'ingest' });
  gated.status === 409 && gated.body && gated.body.error === 'SOURCES_NOT_RETRACTED'
    ? pass('ingest gated → 409 SOURCES_NOT_RETRACTED (md still serving)')
    : fail('ingest NOT gated: HTTP ' + gated.status + ' ' + JSON.stringify(gated.body).slice(0, 200));
  const rst = await retractDocRepo(fileIds[0]);
  rst === 200 || rst === 202 || rst === 409
    ? pass('retract md → ' + rst)
    : fail('retract md → ' + rst);
  const retrPoll = await poll('serving source retracted', 4 * 60000, 5000, async () => {
    const f = await docRepoFile(fileIds[0]);
    return String((f && f.dataprep && f.dataprep.status) || '').toLowerCase().trim() === 'retracted'
      ? { done: true }
      : { done: false };
  });
  if (retrPoll.done) pass('md dataprep.status=Retracted');
  const ing = await call('POST', '/repos/' + REPO_ID + '/lifecycle', { action: 'ingest' });
  ing.status === 200 || ing.status === 201
    ? pass('ingest after retract → ' + ing.status + ' (drain armed, ' + content.length + ' concepts)')
    : fail('ingest after retract → ' + ing.status + ' ' + JSON.stringify(ing.body).slice(0, 200));
  const drain = await poll('drain complete', 25 * 60000, 15000, async () => {
    const r = await call('GET', '/repos/' + REPO_ID);
    const b = r.body || {};
    if (b.rag_drain_active === true) return { done: false };
    if (Number(b.ingested_version) === 1) return { done: true, repo: b };
    const st = b.rag_ingestion && String(b.rag_ingestion.status);
    if (st === 'failed' || st === 'error') return { done: true, repo: b, failed: true };
    return { done: false };
  });
  const drepo = drain.repo || {};
  if (drain.timedOut) fail('drain poll timed out');
  Number(drepo.ingested_version) === 1
    ? pass('v1 SERVES after drain (ingested_version=1)')
    : fail('v1 not serving: ' + JSON.stringify(drepo.rag_ingestion || {}).slice(0, 200));
  const rag = drepo.rag_ingestion || {};
  const failedC = (rag.failed_concepts || []).length;
  failedC === 0
    ? pass('0 failed concepts in the drain (' + rag.concepts_done + '/' + rag.concepts_total + ' done)')
    : fail(failedC + ' failed concepts: ' + JSON.stringify(rag.failed_concepts || []).slice(0, 200));

  // 8. SERVING GRAPH proof — the born-right graph carries the cross-file
  // links as real edges (the end-to-end answer to "fragmented islands").
  let edgeCount = -1;
  const graphFragment = REPO_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const cols = await db.collections();
  const linksCol = cols.map((c) => c.name).find((n) => n.endsWith('_LINKS_TO') && n.includes(graphFragment));
  if (linksCol) {
    // The shared driver's query() wrapper mangles non-plain AQL — use the
    // collection API for the count (live-verified 2026-09-14).
    edgeCount = (await db.collection(linksCol).count()).count;
  }
  edgeCount >= 30
    ? pass('serving graph CONNECTED: ' + edgeCount + ' link edges in ' + linksCol)
    : fail('serving graph edges=' + edgeCount + ' (want ≥30) in ' + (linksCol || 'no LINKS_TO collection'));

  console.log('\nRESULT: ' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURES') + ' — repo ' + REPO_ID + ' (' + REPO_NAME + ')');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('SMOKE CRASH:', e && e.stack);
  process.exit(1);
});
