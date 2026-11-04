// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// CAP-1/2/3 chat-source smoke (W1-W3, chat-source resolution initiative):
// proves the whole citation chain LIVE against a running local build —
//   1. a published+ingested OKF repo answers a chat query whose sources carry
//      source:'okf-concept' + repo_id + bundle_version + graph_name (CAP-1
//      identity end-to-end, W2 mint);
//   2. the concept content route serves the body to a scopeless user through
//      Kong (CAP-2);
//   3. a RESTRICTED repo's concept is FENCED from the scopeless user (404,
//      anti-enumeration) while the wildcard admin still reads it (the W2
//      fence — callerMayTraverseRepo on the read family).
// Run from the repo root against the local build (host-side):
//   OKF_SMOKE_ENV_FILE=<env-with-KEYCLOAK_URL=https://localhost/auth> \
//     node data/okf/smoke-test/run-smoke-chat-sources.mjs
// The smoke re-mints fresh tokens via mint-tokens.mjs at start (its own ROPC
// window), sweeps orphan drafts from earlier runs, then drives the chain.
// Cleanup: OKF_SMOKE_CLEANUP=full deletes the two smoke repos afterwards
// (default 'none' — artifacts stay for UI inspection, like run-smoke-happy).

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TOKENS_FILE = process.env.OKF_SMOKE_TOKENS_FILE || 'data/okf/smoke-test/okf-smoke-tokens.json';
const BASE = process.env.OKF_SMOKE_BASE || 'https://localhost';
const CLEANUP = process.env.OKF_SMOKE_CLEANUP || 'none';
const CHAT_TIMEOUT_MS = parseInt(process.env.OKF_SMOKE_CHAT_TIMEOUT_MS || '240000', 10);
const DRAIN_TIMEOUT_MS = parseInt(process.env.OKF_SMOKE_DRAIN_TIMEOUT_MS || '900000', 10);
const STAMP = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
const NAME_A = `w1-smoke-srcs-a-${STAMP}`;
const NAME_R = `w1-smoke-srcs-r-${STAMP}`;

let passed = 0;
let failed = 0;
let ADMIN;
let SCOPELESS;
function pass(msg) {
  passed += 1;
  console.log(`  PASS: ${msg}`);
}
function fail(msg) {
  failed += 1;
  console.log(`  FAIL: ${msg}`);
}

async function call(method, path, token, body) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: body ? JSON.stringify(body) : undefined
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

// PII-CLEAN by construction: no dates, times, ids, names-of-persons — the
// Presidio scan gates publish (pii_state must be clean).
const CONCEPT = (id, title) =>
  `---\nconcept_id: ${id}\ntitle: ${title}\ntype: concept\ntopic: []\n---\n\n# ${title}\n\nThe Alpha smoke service lets citizens request an alpha appointment. Alpha offices confirm every booking by letter.\n`;

async function makeRepo(repoId, withConcepts) {
  const created = await call('POST', '/api/okf/repos', ADMIN, {
    name: repoId,
    domain: 'Alpha Smoke',
    acl: { restricted: false, required_scopes: [`okf:t:alpha-smoke-${STAMP}:admin`] },
    lifecycle_state: 'draft'
  });
  if (created.status !== 201) throw new Error(`repo create ${repoId}: ${created.status} ${created.text.slice(0, 200)}`);
  // The server mints the identity (slug) — every later call uses the RETURNED
  // repo_id, never the requested name.
  const id = (created.json && created.json.repo_id) || repoId;
  const imported = await call('POST', `/api/okf/repos/${id}/import`, ADMIN, {
    concepts: withConcepts
  });
  if (imported.status !== 202) throw new Error(`import ${id}: ${imported.status} ${imported.text.slice(0, 200)}`);
  // The state machine ladder (lifecycle-service.js TRANSITIONS):
  //   submit: draft->review · approve: review->approve · publish:
  //   approve->publish (mints v1) · ingest: publish->publish+serving —
  //   INGEST is the action that enqueues the dataprep drain. Caught live
  //   2026-11-04: without it nothing ever hits the GPU and the repos sit
  //   published-but-not-serving forever.
  for (const action of ['submit', 'approve', 'publish', 'ingest']) {
    const res = await call('POST', `/api/okf/repos/${id}/lifecycle`, ADMIN, { action });
    if (res.status !== 200) throw new Error(`${action} ${id}: ${res.status} ${res.text.slice(0, 200)}`);
  }
  return { id };
}

async function waitIndexed(repoId, timeoutMs = DRAIN_TIMEOUT_MS) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const list = await call('GET', `/api/okf/repos/${repoId}/concepts`, ADMIN);
    const body = list.json && (list.json.concepts || list.json);
    const rows = Array.isArray(body) ? body : (body && body.concepts) || [];
    if (rows.length && rows.every((c) => c.index_status === 'indexed')) return rows;
    if (rows.length && rows.some((c) => c.index_status === 'failed'))
      throw new Error(`${repoId}: a concept dead-lettered: ${JSON.stringify(rows.map((c) => [c.concept_id, c.index_status, c.last_error]))}`);
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error(`${repoId}: drain did not settle in ${timeoutMs}ms`);
}

// The server keys concepts by its own mint rule — the import's outer
// concept_id is advisory (live: alpha_booking arrived as concept-1). Read
// the ACTUAL ids back and match by TITLE.
async function conceptIdByTitle(repoId, title) {
  const list = await call('GET', `/api/okf/repos/${repoId}/concepts`, ADMIN);
  const body = list.json && (list.json.concepts || list.json);
  const rows = Array.isArray(body) ? body : (body && body.concepts) || [];
  const hit = rows.find((c) => c.title === title);
  if (!hit) throw new Error(`${repoId}: no concept titled '${title}' (have: ${rows.map((c) => c.title).join(', ')})`);
  return hit.concept_id;
}

// The real citizen path: POST /api/chat/stream (SSE) and collect the
// metadata frame — its source_documents array is what the frontend cards
// render. Resolves on the metadata frame, an error frame, or stream close.
async function askChat(token, question) {
  const res = await fetch(`${BASE}/api/queries/stream`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      sessionId: `w1-smoke-${STAMP}`,
      text: question,
      userQuestion: question,
      context: { language: 'EN' },
      contextOption: 'single-message',
      timestamp: new Date().toISOString()
    })
  });
  if (!res.ok) return { status: res.status, sources: [], error: (await res.text()).slice(0, 300) };
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  const deadline = Date.now() + CHAT_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx;
    while ((idx = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 2);
      if (!frame.startsWith('data: ')) continue;
      let evt;
      try {
        evt = JSON.parse(frame.slice(6));
      } catch {
        continue;
      }
      if (evt.type === 'metadata') {
        return { status: res.status, sources: evt.source_documents || [], payload: evt };
      }
      if (evt.type === 'error') {
        return { status: res.status, sources: [], error: `${evt.code || 'STREAM_ERROR'}: ${evt.message}` };
      }
    }
  }
  return { status: res.status, sources: [], error: `stream timed out after ${CHAT_TIMEOUT_MS}ms` };
}

async function deleteRepo(repoId) {
  await call('DELETE', `/api/okf/repos/${repoId}`, ADMIN);
}

async function main() {
  // Fresh tokens EVERY run: the realm's access-token TTL is minutes and a
  // blind expired-token poll looks exactly like a stuck drain (caught live
  // 2026-11-04). mint-tokens.mjs owns the ROPC window + revert.
  console.log('[0] mint fresh smoke tokens');
  execFileSync('node', ['data/okf/smoke-test/mint-tokens.mjs', TOKENS_FILE], {
    stdio: process.env.OKF_SMOKE_VERBOSE ? 'inherit' : ['ignore', 'ignore', 'inherit']
  });
  const tokens = JSON.parse(fs.readFileSync(TOKENS_FILE, 'utf8'));
  ADMIN = tokens.admin || tokens.OKF_SMOKE_TOKEN_ADMIN;
  SCOPELESS = tokens.scopeless || tokens.OKF_SMOKE_TOKEN_SCOPELESS;
  if (!ADMIN || !SCOPELESS) throw new Error('tokens file lacks admin/scopeless entries');

  console.log(`== W1-W3 chat-source smoke against ${BASE} (repos ${NAME_A} / ${NAME_R}) ==`);

  // --- 1. Seed: open repo (2 concepts) + restricted repo (1 concept) ---
  console.log('[1] seed repos + approve + publish + drain');
  const alpha = [
    { concept_id: 'alpha_booking', body: CONCEPT('alpha_booking', 'Alpha Booking'), title: 'Alpha Booking' },
    { concept_id: 'alpha_hours', body: CONCEPT('alpha_hours', 'Alpha Office Hours'), title: 'Alpha Office Hours' }
  ];
  const restricted = [{ concept_id: 'secret_alpha', body: CONCEPT('secret_alpha', 'Secret Alpha'), title: 'Secret Alpha' }];
  const repoA = await makeRepo(NAME_A, alpha);
  const repoR = await makeRepo(NAME_R, restricted);
  console.log(`  minted: A=${repoA.id} R=${repoR.id}`);
  const stamped = await call('PATCH', `/api/okf/repos/${repoR.id}`, ADMIN, {
    acl: { restricted: true, required_scopes: [`okf:t:alpha-smoke-${STAMP}:admin`] }
  });
  if (stamped.status !== 200) throw new Error(`restrict ${repoR.id}: ${stamped.status} ${stamped.text.slice(0, 200)}`);
  const rowsA = await waitIndexed(repoA.id);
  const rowsR = await waitIndexed(repoR.id);
  pass(`both repos drained to indexed (A=${rowsA.length}, R=${rowsR.length})`);

  // --- 2. CAP-2: concept content through Kong ---
  console.log('[2] CAP-2 concept content route');
  const openId = await conceptIdByTitle(repoA.id, 'Alpha Booking');
  const secretId = await conceptIdByTitle(repoR.id, 'Secret Alpha');
  const open = await call('GET', `/api/okf/repos/${repoA.id}/concepts/${openId}`, SCOPELESS);
  if (open.status === 200 && open.json && String(open.json.body || '').includes('Alpha')) {
    pass(`scopeless user reads the open concept's body (${String(open.json.body).length} chars)`);
  } else {
    fail(`open concept read: status=${open.status} body=${open.text.slice(0, 120)}`);
  }
  const fenced = await call('GET', `/api/okf/repos/${repoR.id}/concepts/${secretId}`, SCOPELESS);
  if (fenced.status === 404) {
    pass('RESTRICTED concept FENCED from the scopeless user (404, anti-enumeration)');
  } else {
    fail(`restricted concept read as scopeless: expected 404, got ${fenced.status}`);
  }
  const adminRead = await call('GET', `/api/okf/repos/${repoR.id}/concepts/${secretId}`, ADMIN);
  if (adminRead.status === 200) pass('wildcard admin still reads the restricted concept');
  else fail(`admin restricted read: ${adminRead.status}`);
  const fencedList = await call('GET', `/api/okf/repos/${repoR.id}/concepts`, SCOPELESS);
  if (fencedList.status === 404) pass('concept INDEX fenced too (listConcepts gate)');
  else fail(`restricted concept list as scopeless: expected 404, got ${fencedList.status}`);

  // --- 3. CAP-1: the chat answer's sources carry the full identity ---
  console.log('[3] CAP-1 chat citation identity');
  const chat = await askChat(SCOPELESS, 'How do citizens request an alpha appointment?');
  const okfSources = chat.sources.filter((s) => s.source === 'okf-concept');
  if (chat.error && !okfSources.length) {
    fail(`chat call failed: ${chat.error}`);
  } else if (!okfSources.length) {
    fail(`no okf-concept sources in the answer (got ${chat.sources.length} sources; grounded pipeline may need the graph set to include ${repoA.id})`);
  } else {
    const withIdentity = okfSources.filter((s) => s.repo_id && s.bundle_version != null && s.graph_name);
    if (withIdentity.length === okfSources.length) {
      pass(`all ${okfSources.length} okf citations carry repo_id + bundle_version + graph_name (CAP-1 end-to-end)`);
    } else {
      fail(`identity missing on ${okfSources.length - withIdentity.length}/${okfSources.length} citations: ${JSON.stringify(okfSources).slice(0, 300)}`);
    }
  }

  // --- 4. Cleanup ---
  if (CLEANUP === 'full') {
    console.log('[4] cleanup');
    await deleteRepo(repoA.id);
    await deleteRepo(repoR.id);
    console.log('  deleted both smoke repos');
  } else {
    console.log(`[4] cleanup skipped (OKF_SMOKE_CLEANUP=${CLEANUP}) — repos left for UI inspection`);
  }

  console.log(`== SMOKE ${failed === 0 ? 'PASS' : 'FAIL'}: ${passed} passed, ${failed} failed ==`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error('SMOKE ERROR:', e.message);
  process.exit(1);
});
