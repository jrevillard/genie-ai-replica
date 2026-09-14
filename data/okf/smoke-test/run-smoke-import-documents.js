// OKF Story 7.7 smoke — produce an OKF repository from selected documents.
// Drives the full David-directed flow end to end:
//   1 Build + upload 3 doc-repo files (.md, .pdf, .xlsx — the multi-format ask).
//   2 POST /repos/convert-from-documents → ONE draft repo, processed as a whole.
//   3 Poll conversion done → assert files_imported, concepts, source_documents.
//   4 Provenance: okf_concepts_meta frontmatter sources carry file_id (the
//     data the popup-card deep links (?tab=documents&file=) read).
//   5 Review → publish v1 (content-gated mint, same as crawl repos).
//   6 ingest → 409 SOURCES_NOT_RETRACTED (the sources still serve free-form).
//   7 Retract the 3 sources (dataprep Retracted).
//   8 ingest again → drain arms async, v1 serves at completion.
// NON-BREAKING: crawl/free-form paths are structurally untouched — the gate
// reads source_documents[] EXCLUSIVELY (crawl repos have none; the repo's own
// bundle zip is is_bundle and never trips it — covered by unit tests).
// Run INSIDE the okf-server container (same procedure as run-smoke-lifecycle.js):
//   docker cp run-smoke-import-documents.js <container>:/app/
//   docker exec -e OKF_SMOKE_TOKEN_ADMIN=<...> <container> node /app/run-smoke-import-documents.js

const fs = require('fs');
const path = require('path');
const xlsx = require('xlsx');
const dbService = require('./shared-lib/db-connection-service');

const BASE = process.env.OKF_SMOKE_BASE_URL || 'http://localhost:3002/api/okf';
const DOC_REPO = process.env.OKF_SMOKE_DOC_REPO_URL || 'http://document-repository:3001';
const KC_BASE =
  process.env.KEYCLOAK_INTERNAL_URL || process.env.KEYCLOAK_URL || 'http://keycloak:8080';
const KC_REALM = process.env.KEYCLOAK_REALM || 'genie';
let TOKEN = process.env.OKF_SMOKE_TOKEN_ADMIN;
const REFRESH = process.env.OKF_SMOKE_REFRESH_ADMIN || null;
const STAMP = 'doc-import-smoke-' + Date.now();
const REPO_NAME = 'story-7-7 ' + STAMP;
let REPO_ID = null;

let failures = 0;
function pass(m) {
  console.log('PASS  ' + m);
}
function fail(m) {
  failures += 1;
  console.error('FAIL  ' + m);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Access tokens live ~5 min; a full E2E run outlives them. Renew via the
// refresh grant (works with directAccessGrants disabled) and retry once.
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
  if (res.status === 401 && !retried && (await refreshToken())) {
    return call(method, url, body, headers, true);
  }
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
  // doc-repo envelopes vary ({file}, {data: {file}}, {data}) — unwrap all.
  const d = j || {};
  return d.file || (d.data && d.data.file) || d.data || d || {};
}

async function retractDocRepo(fileId, retried) {
  const res = await fetch(DOC_REPO + '/api/files/' + encodeURIComponent(fileId) + '/retract', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: '{}'
  });
  if (res.status === 401 && !retried && (await refreshToken())) return retractDocRepo(fileId, true);
  return res.status;
}

async function poll(label, timeoutMs, everyMs, fn) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    let out;
    try {
      out = await fn();
    } catch (e) {
      out = { done: false, detail: 'poll error: ' + e.message };
    }
    if (out.done) return out;
    await sleep(everyMs);
  }
  fail(label + ' — timed out after ' + Math.round(timeoutMs / 1000) + 's');
  return { done: false, timedOut: true };
}

// --- fixtures ---------------------------------------------------------------

function buildPolicyMd() {
  return [
    '# Abattoir policy pack (' + STAMP + ')',
    '',
    '## Licensing',
    'An abattoir license is required for any commercial slaughter operation. Renewal happens annually through the single-window portal.',
    '',
    '## Inspection',
    'Veterinary inspection must precede each slaughter day. Inspectors record hygiene findings in the central register.',
    '',
    'See [the fee schedule](memo-' + STAMP + '.pdf) and [the rate tables](data-' + STAMP + '.xlsx).'
  ].join('\n');
}

function readMemoPdf() {
  // A REAL pdf (headless-Edge print of a short English memo) — hand-built
  // minimal PDFs are beyond pdf-parse 1.1.4's parser ("bad XRef entry"),
  // which is what doc-repo's upload language gate extracts with.
  const p = path.join(__dirname, 'fixtures', 'memo-en.pdf');
  return fs.readFileSync(p);
}

function buildDataXlsx() {
  const wb = xlsx.utils.book_new();
  const rates = xlsx.utils.aoa_to_sheet([
    ['Species', 'Fee USD', 'Notes'],
    ['Cattle', '12.00', 'per head'],
    ['Sheep', '3.50', 'per head'],
    ['Goat', '3.00', 'per head']
  ]);
  xlsx.utils.book_append_sheet(wb, rates, 'Rates');
  const penalties = xlsx.utils.aoa_to_sheet([
    ['Days late', 'Penalty %'],
    ['1-30', '5'],
    ['31-90', '10'],
    ['90+', '25']
  ]);
  xlsx.utils.book_append_sheet(wb, penalties, 'Penalties');
  return xlsx.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

// --- main --------------------------------------------------------------------

(async () => {
  if (!TOKEN) {
    console.error('OKF_SMOKE_TOKEN_ADMIN is required');
    process.exit(1);
  }
  const db = await dbService.getConnection('default');

  // 1. Build + upload the three formats
  const files = [
    { name: 'policy-' + STAMP + '.md', type: 'text/markdown', buf: Buffer.from(buildPolicyMd(), 'utf8') },
    { name: 'memo-' + STAMP + '.pdf', type: 'application/pdf', buf: readMemoPdf() },
    { name: 'data-' + STAMP + '.xlsx', type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buf: buildDataXlsx() }
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
  if (fileIds.length !== 3) {
    console.log('RESULT: ' + (2 - failures) + '/' + 2);
    process.exit(1);
  }

  // 1b. Ingest the .md FREE-FORM first (the David rule needs a source that
  // actually serves the corpus — Pending sources never trip the gate).
  const kick = await fetch(DOC_REPO + '/api/files/' + fileIds[0] + '/ingest', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: '{}'
  });
  kick.status === 200 || kick.status === 202
    ? pass('free-form ingest kick on ' + fileIds[0] + ' → ' + kick.status)
    : fail('ingest kick → ' + kick.status + ' ' + (await kick.text()).slice(0, 160));
  const ingPoll = await poll('md source Ingested (free-form)', 8 * 60000, 10000, async () => {
    const f = await docRepoFile(fileIds[0]);
    const s = String((f && f.dataprep && f.dataprep.status) || '').toLowerCase().trim();
    if (s === 'ingested' || s === 'ingested with warnings') return { done: true };
    if (s === 'ingestion error') return { done: true, errored: true };
    return { done: false };
  });
  if (ingPoll.errored) fail('md source went to Ingestion Error — gate scenario broken (LLM up?)');
  else if (ingPoll.done) pass('md source now SERVES the free-form corpus');

  // 2. Import — ONE repo from THREE files
  const imp = await call('POST', '/repos/convert-from-documents', {
    file_ids: fileIds,
    name: REPO_NAME,
    domain: 'general',
    classification: 'heuristics'
  });
  REPO_ID = imp.body && imp.body.repo_id;
  if (imp.status === 202 && REPO_ID) pass('convert-from-documents → 202 repo_id=' + REPO_ID);
  else fail('convert-from-documents → HTTP ' + imp.status + ' ' + JSON.stringify(imp.body).slice(0, 200));

  // 3. Poll conversion done
  const conv = await poll('conversion done', 8 * 60000, 10000, async () => {
    const r = await call('GET', '/repos/' + REPO_ID);
    const c = r.body && r.body.conversion;
    if (!c) return { done: false };
    if (c.status === 'done' || c.status === 'failed') return { done: true, conversion: c, repo: r.body };
    return { done: false };
  });
  const conversion = conv.conversion || {};
  if (conversion.status === 'done') {
    pass('conversion done: ' + JSON.stringify(conversion.summary || {}).slice(0, 220));
  } else {
    fail('conversion status=' + conversion.status + ' error=' + (conversion.error || 'n/a'));
  }
  const summary = conversion.summary || {};
  summary.files_imported === 3
    ? pass('summary.files_imported === 3')
    : fail('summary.files_imported=' + summary.files_imported + ' (want 3)');
  const repoAfterConv = conv.repo || {};
  const srcDocs = repoAfterConv.source_documents || [];
  srcDocs.length === 3
    ? pass('source_documents stamped with all 3 file_ids')
    : fail('source_documents=' + srcDocs.length + ' (want 3)');

  // 4. Provenance: frontmatter sources carry file_id (deep-link data)
  const metas = await db
    .query('FOR m IN okf_concepts_meta FILTER m.repo_id == @rid RETURN m', { rid: REPO_ID })
    .then((c) => c.all());
  const withFileSrc = metas.filter(
    (m) =>
      m.frontmatter &&
      Array.isArray(m.frontmatter.sources) &&
      m.frontmatter.sources.some((s) => s && fileIds.includes(s.file_id))
  );
  withFileSrc.length >= 3
    ? pass('provenance: ' + withFileSrc.length + ' concepts carry file_id sources (≥3)')
    : fail('provenance: only ' + withFileSrc.length + ' concepts carry file_id sources');
  const dictCount = metas.filter(
    (m) =>
      !m.is_index &&
      ((m.frontmatter && m.frontmatter.type === 'data-dictionary') ||
        /dictionary/i.test(String(m.concept_id || m.slug || '')))
  ).length;
  dictCount >= 1
    ? pass('xlsx data-dictionary concept present (' + dictCount + ')')
    : fail('no data-dictionary concept from the xlsx');
  const conceptsTotal = metas.filter((m) => !m.is_index).length;
  conceptsTotal >= 4
    ? pass('concepts added as drafts: ' + conceptsTotal + ' (≥4: policy sections + dict + row-groups)')
    : fail('concepts=' + conceptsTotal + ' (want ≥4)');

  // 5. Review → publish v1
  for (const action of ['submit', 'approve']) {
    const r = await call('POST', '/repos/' + REPO_ID + '/lifecycle', { action });
    (r.status === 200 || r.status === 201)
      ? pass('lifecycle ' + action + ' → ' + r.status)
      : fail('lifecycle ' + action + ' → ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 160));
  }
  let pub = await call('POST', '/repos/' + REPO_ID + '/lifecycle', { action: 'publish' });
  if (pub.status === 409 && pub.body && pub.body.error === 'PII_GATE_BLOCKED') {
    // The standard steward flow: review the flagged entities, then acknowledge.
    pass('publish gated by the Presidio PII review (as designed) — acknowledging as steward');
    const ack = await call('POST', '/repos/' + REPO_ID + '/pii-acknowledge', { acknowledge: true });
    ack.status === 200
      ? pass('pii-acknowledge → 200')
      : fail('pii-acknowledge → ' + ack.status + ' ' + JSON.stringify(ack.body).slice(0, 160));
    pub = await call('POST', '/repos/' + REPO_ID + '/lifecycle', { action: 'publish' });
  }
  (pub.status === 200 || pub.status === 201)
    ? pass('lifecycle publish → ' + pub.status)
    : fail('lifecycle publish → ' + pub.status + ' ' + JSON.stringify(pub.body).slice(0, 160));
  const mintPoll = await poll('publish v1 mint', 3 * 60000, 5000, async () => {
    const r = await call('GET', '/repos/' + REPO_ID);
    const b = r.body || {};
    // The registry writes version/okf_tag (bundle_version is not a doc field).
    if (b.lifecycle_state === 'publish' && (Number(b.version) >= 1 || b.bundle_version || b.okf_tag)) {
      return { done: true };
    }
    return { done: false };
  });
  const afterPub = await call('GET', '/repos/' + REPO_ID);
  const v1 = afterPub.body && (afterPub.body.okf_tag || afterPub.body.bundle_version || afterPub.body.version);
  if (mintPoll.timedOut) fail('publish v1 mint poll timed out — see server logs');
  v1 ? pass('v1 minted: tag=' + v1) : fail('no version/okf_tag after publish');

  // 6. ingest MUST be gated — sources still serve the free-form corpus
  const gated = await call('POST', '/repos/' + REPO_ID + '/lifecycle', { action: 'ingest' });
  gated.status === 409 && gated.body && gated.body.error === 'SOURCES_NOT_RETRACTED'
    ? pass('ingest gated → 409 SOURCES_NOT_RETRACTED (md source still serving)')
    : fail('ingest NOT gated: HTTP ' + gated.status + ' ' + JSON.stringify(gated.body).slice(0, 200));

  // 7. Retract the serving source (the others are Pending — pass states)
  for (const fid of [fileIds[0]]) {
    const st = await retractDocRepo(fid);
    st === 200 || st === 202 || st === 409 /* already retracting */
      ? pass('retract ' + fid + ' → ' + st)
      : fail('retract ' + fid + ' → ' + st);
  }
  const retrPoll = await poll('serving source retracted', 4 * 60000, 5000, async () => {
    const f = await docRepoFile(fileIds[0]);
    const s = String((f && f.dataprep && f.dataprep.status) || '').toLowerCase().trim();
    return s === 'retracted' ? { done: true } : { done: false };
  });
  if (retrPoll.done) pass('serving source dataprep.status=Retracted — gate can now pass');
  else fail('source did not reach Retracted within the window');

  // 8. ingest again — drain arms async; v1 serves at completion
  const ing = await call('POST', '/repos/' + REPO_ID + '/lifecycle', { action: 'ingest' });
  (ing.status === 200 || ing.status === 201)
    ? pass('ingest after retract → ' + ing.status + ' (drain armed)')
    : fail('ingest after retract → ' + ing.status + ' ' + JSON.stringify(ing.body).slice(0, 200));
  const drain = await poll('drain complete', 15 * 60000, 10000, async () => {
    const r = await call('GET', '/repos/' + REPO_ID);
    const b = r.body || {};
    const active = b.rag_drain_active === true;
    const serving = Number(b.ingested_version) === 1;
    if (!active && serving) return { done: true, repo: b };
    if (b.rag_ingestion && ['failed', 'error'].includes(String(b.rag_ingestion.status))) {
      return { done: true, repo: b, failed: true };
    }
    return { done: false };
  });
  const drepo = drain.repo || {};
  if (drain.timedOut) fail('drain poll timed out — see server logs');
  Number(drepo.ingested_version) === 1
    ? pass('v1 SERVES after drain (ingested_version=1)')
    : fail('v1 not serving: ingested_version=' + drepo.ingested_version + ' drain=' + JSON.stringify(drepo.rag_ingestion || {}).slice(0, 200));
  const rag = drepo.rag_ingestion || {};
  const failedConcepts = (rag.failed_concepts || []).length;
  failedConcepts === 0
    ? pass('0 failed concepts in the drain')
    : fail(failedConcepts + ' failed concepts: ' + JSON.stringify(rag.failed_concepts || []).slice(0, 200));
  console.log('rag_ingestion tail: ' + JSON.stringify(rag.summary || rag).slice(0, 300));

  console.log('\nRESULT: ' + (failures === 0 ? 'ALL PASS' : failures + ' FAILURES') + ' — repo ' + REPO_ID + ' (' + REPO_NAME + ')');
  process.exit(failures === 0 ? 0 : 1);
})().catch((e) => {
  console.error('SMOKE CRASH:', e && e.stack);
  process.exit(1);
});
