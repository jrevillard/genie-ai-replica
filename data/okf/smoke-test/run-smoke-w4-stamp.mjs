// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// W4 story 1 — the okf_repo_id stamp live RE-MEASURE (chat-source resolution
// initiative, EPIC-4). The stamp's two documented root causes shipped on main
// in 3d3f4c484 (2026-10-30); the 41/41 figure was the 2026-10-11 incident and
// the writer is producer-service.stampSources (PATCH per source file during
// conversion, fail-soft per file, loud on total failure). This smoke proves
// the CURRENT ratio live on a documents-origin import:
//   1. upload two PII-clean documents to doc-repo (through Kong /api/files),
//   2. POST /repos/convert-from-documents (the wizard's documents origin),
//   3. wait for conversion done, read back source_documents,
//   4. GET each source file's doc-repo metadata and assert
//      okf_repo_id === the new repo id — the ratio IS the measure
//      (expect ~100%; producer-service's loud tripwire stays as backstop).
// No publish, no drain — the stamp is written at import time; the GPU only
// sees the conversion's label calls.
// Run from the repo root against the local build (host-side):
//   OKF_SMOKE_ENV_FILE=<env> node data/okf/smoke-test/run-smoke-w4-stamp.mjs
// Cleanup default 'full': delete the smoke repo (retract-then-delete when
// 409 INGESTED_DELETE_BLOCKED) and retract the uploaded documents.

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TOKENS_FILE = process.env.OKF_SMOKE_TOKENS_FILE || 'data/okf/smoke-test/okf-smoke-tokens.json';
const BASE = process.env.OKF_SMOKE_BASE || 'https://localhost';
const CLEANUP = process.env.OKF_SMOKE_CLEANUP || 'full';
const CONV_TIMEOUT_MS = parseInt(process.env.OKF_SMOKE_CONV_TIMEOUT_MS || '600000', 10);
const STAMP = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const REPO_NAME = `w4-stamp-smoke-${STAMP}`;
const DOMAIN = 'Alpha Smoke';

let passed = 0;
let failed = 0;
let ADMIN;
let REPO_ID = null;
let FILE_IDS = [];

function pass(msg) {
  passed += 1;
  console.log(`  PASS: ${msg}`);
}
function fail(msg) {
  failed += 1;
  console.log(`  FAIL: ${msg}`);
}

async function call(method, path, token, body, extraHeaders) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(extraHeaders || {})
    },
    body: body !== undefined ? (extraHeaders ? body : JSON.stringify(body)) : undefined
  });
  const text = await res.text();
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* non-JSON body (HTML express 404s etc.) */
  }
  return { status: res.status, json, text };
}

// PII-CLEAN by construction (no dates, times, ids, person names) — the same
// discipline as the chat-sources smoke: the Presidio scan must never have a
// reason to block anything downstream of this test.
const DOC_A = `# Alpha service charter ${STAMP}

The alpha service charter explains how citizens request an alpha appointment.
Alpha offices confirm every booking by letter. Staff follow the alpha handbook
for every request.

## Related guidance

See the alpha operations note for the booking workflow details.
`;

const DOC_B = `# Alpha operations note ${STAMP}

The alpha operations note describes the booking workflow. An officer reviews
the request, records the decision, and sends the confirmation letter.

## Related guidance

See the alpha service charter for the citizen-facing overview.
`;

async function uploadDoc(fileName, text) {
  const form = new FormData();
  form.append('file', new Blob([text], { type: 'text/markdown' }), fileName);
  const res = await fetch(`${BASE}/api/files/upload`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${ADMIN}` },
    body: form
  });
  const text2 = await res.text();
  let json = null;
  try {
    json = JSON.parse(text2);
  } catch {
    /* non-JSON */
  }
  const id = (json && json.data && (json.data.file_id || json.data.id)) || (json && (json.file_id || json.id));
  if (res.status !== 200 && res.status !== 201)
    throw new Error(`upload ${fileName}: ${res.status} ${text2.slice(0, 200)}`);
  if (!id) throw new Error(`upload ${fileName}: no file_id in response ${text2.slice(0, 200)}`);
  return id;
}

async function docRepoFile(fileId) {
  const res = await call('GET', `/api/files/${encodeURIComponent(fileId)}`, ADMIN);
  if (res.status !== 200) throw new Error(`GET /api/files/${fileId}: ${res.status} ${res.text.slice(0, 200)}`);
  return res.json && res.json.data;
}

async function waitConverted(timeoutMs = CONV_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const r = await call('GET', `/api/okf/repos/${REPO_ID}`, ADMIN);
    const c = r.json && r.json.conversion;
    if (c && (c.status === 'done' || c.status === 'failed')) return { conversion: c, repo: r.json };
    await new Promise((res) => setTimeout(res, 5000));
  }
  throw new Error(`conversion did not settle in ${timeoutMs}ms`);
}

async function deleteRepo() {
  const del = await call('DELETE', `/api/okf/repos/${REPO_ID}`, ADMIN);
  // 202 = accepted, deletion runs async (live: the cascade also HARD-deletes
  // the repo's backing files in doc-repo — backing-file-service.js
  // deleteBackingFiles, the intentional hard purge — which is why document
  // cleanup must run BEFORE the repo delete and must tolerate a 404).
  if (del.status === 200 || del.status === 202 || del.status === 204) return 'deleted';
  if (del.status === 409) {
    // INGESTED_DELETE_BLOCKED — retract-then-delete (the sweep discipline)
    const ret = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, ADMIN, { action: 'retract' });
    if (ret.status !== 200) return `retract-failed-${ret.status}`;
    const del2 = await call('DELETE', `/api/okf/repos/${REPO_ID}`, ADMIN);
    return del2.status === 200 || del2.status === 202 || del2.status === 204
      ? 'retract+delete'
      : `delete-failed-${del2.status}`;
  }
  return `delete-failed-${del.status}`;
}

async function retractDoc(fileId) {
  const res = await call('POST', `/api/files/${encodeURIComponent(fileId)}/retract`, ADMIN, {});
  return res.status;
}

try {
  // [0] fresh tokens (access tokens live ~5 min; mint-tokens owns the ROPC window)
  console.log('[0] mint fresh smoke tokens');
  execFileSync('node', ['data/okf/smoke-test/mint-tokens.mjs', TOKENS_FILE], {
    stdio: process.env.OKF_SMOKE_VERBOSE ? 'inherit' : ['ignore', 'ignore', 'inherit']
  });
  const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  ADMIN = tokens.admin || tokens.OKF_SMOKE_TOKEN_ADMIN;
  if (!ADMIN) throw new Error('tokens file lacks the admin entry');

  // [1] upload the source documents (documents origin)
  console.log('[1] upload two source documents');
  FILE_IDS = [
    await uploadDoc(`w4-stamp-charter-${STAMP}.md`, DOC_A),
    await uploadDoc(`w4-stamp-ops-${STAMP}.md`, DOC_B)
  ];
  pass(`2 documents uploaded (${FILE_IDS.join(', ')})`);

  // [2] the wizard's documents-origin import
  console.log('[2] convert-from-documents');
  const imp = await call('POST', '/api/okf/repos/convert-from-documents', ADMIN, {
    file_ids: FILE_IDS,
    name: REPO_NAME,
    domain: DOMAIN,
    classification: 'heuristics'
  });
  REPO_ID = imp.json && imp.json.repo_id;
  if (imp.status !== 202 || !REPO_ID)
    throw new Error(`convert-from-documents: ${imp.status} ${imp.text.slice(0, 200)}`);
  pass(`202 repo_id=${REPO_ID}`);

  // [3] wait for conversion; the repo doc must name all sources
  console.log('[3] wait for conversion');
  const { conversion, repo } = await waitConverted();
  if (conversion.status !== 'done') throw new Error(`conversion ${conversion.status}: ${conversion.error || 'n/a'}`);
  pass('conversion done: ' + JSON.stringify(conversion.summary || {}).slice(0, 160));
  const sources = (repo && repo.source_documents) || [];
  const sourcesOk = FILE_IDS.every((id) => sources.some((s) => (s.file_id || s) === id));
  sourcesOk
    ? pass('repo.source_documents carries both file_ids')
    : fail(`source_documents mismatch: ${JSON.stringify(sources).slice(0, 200)}`);

  // [4] THE MEASURE — read each source file's doc-repo metadata back
  console.log('[4] stamp ratio');
  let stamped = 0;
  for (const id of FILE_IDS) {
    const f = await docRepoFile(id);
    if (f && f.okf_repo_id === REPO_ID) {
      stamped += 1;
      pass(`file ${id} stamped okf_repo_id=${f.okf_repo_id}`);
    } else {
      fail(`file ${id} NOT stamped correctly (okf_repo_id=${f && f.okf_repo_id}, want ${REPO_ID})`);
    }
  }
  console.log(`\nSTAMP RATIO: ${stamped}/${FILE_IDS.length}`);
  if (stamped === FILE_IDS.length) pass('stamp ratio 100% (3d3f4c484 holds live)');
  else fail(`stamp ratio ${stamped}/${FILE_IDS.length} — investigate doc-repo PATCH perms / update schema`);
} catch (err) {
  fail(err && err.message ? err.message : String(err));
} finally {
  if (CLEANUP === 'full') {
    console.log('[cleanup]');
    // Documents FIRST — the repo delete cascade hard-deletes its backing
    // files (backing-file-service.js deleteBackingFiles), so a retract after
    // the delete 404s on files that are already gone.
    for (const id of FILE_IDS) {
      const st = await retractDoc(id);
      st === 200 || st === 409 || st === 404
        ? pass(`document ${id} retracted/already-gone (${st})`)
        : fail(`document ${id} retract: ${st}`);
    }
    if (REPO_ID) {
      const outcome = await deleteRepo();
      outcome.startsWith('delete-failed') || outcome.startsWith('retract-failed')
        ? fail(`repo cleanup: ${outcome}`)
        : pass(`repo removed (${outcome})`);
    }
  } else {
    console.log(`[cleanup] skipped (OKF_SMOKE_CLEANUP=${CLEANUP}) — repo ${REPO_ID}, files ${FILE_IDS.join(', ')}`);
  }
  console.log(`\nRESULT: ${failed === 0 ? 'PASS' : 'FAIL'} (${passed} pass, ${failed} fail)`);
  process.exit(failed === 0 ? 0 : 1);
}
