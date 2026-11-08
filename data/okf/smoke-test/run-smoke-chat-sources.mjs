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
//      fence — callerMayTraverseRepo on the read family);
//   4. a RETRACTED repo's concept read 404s for the scopeless user (the W2
//      publication gate, live — added with the tree sync per the devlog).
// Run from the repo root against the local build (host-side):
//   OKF_SMOKE_ENV_FILE=<env-with-KEYCLOAK_URL=https://localhost/auth> \
//     node data/okf/smoke-test/run-smoke-chat-sources.mjs
// The smoke re-mints fresh tokens via mint-tokens.mjs at start (its own ROPC
// window), sweeps orphan drafts from earlier runs, then drives the chain.
// Cleanup: OKF_SMOKE_CLEANUP=full deletes the two smoke repos afterwards
// (default 'full' — a left-behind repo keeps SERVING and its identical
// content gets cited by the next run's chat answer, breaking the identity
// assertion; opt back into 'none' explicitly for UI inspection).

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';

const TOKENS_FILE = process.env.OKF_SMOKE_TOKENS_FILE || 'data/okf/smoke-test/okf-smoke-tokens.json';
const BASE = process.env.OKF_SMOKE_BASE || 'https://localhost';
const CLEANUP = process.env.OKF_SMOKE_CLEANUP || 'full';
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
      throw new Error(
        `${repoId}: a concept dead-lettered: ${JSON.stringify(rows.map((c) => [c.concept_id, c.index_status, c.last_error]))}`
      );
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
// The timeout is an AbortController, not just the loop deadline: a STALLED
// stream (connected, never another frame) blocks inside reader.read()
// forever — the while-check never runs again (review fix 2026-11-07).
async function askChat(token, question) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), CHAT_TIMEOUT_MS);
  try {
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
      }),
      signal: ac.signal
    });
    if (!res.ok) return { status: res.status, sources: [], error: (await res.text()).slice(0, 300) };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    while (true) {
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
    return { status: res.status, sources: [], error: `stream closed before the metadata frame` };
  } catch (err) {
    if (ac.signal.aborted) return { status: 0, sources: [], error: `stream timed out after ${CHAT_TIMEOUT_MS}ms` };
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function deleteRepo(repoId) {
  // A repo with an INGESTED version refuses delete (INGESTED_DELETE_BLOCKED,
  // live 2026-11-04 — the sweep's silent failures left zombie serving graphs
  // polluting later runs' citations). Retract first, then delete — and the
  // DELETE result is ASSERTED: an unchecked failure silently leaves a serving
  // zombie that pollutes the next run's citations (review fix 2026-11-07).
  const ret = await call('POST', `/api/okf/repos/${repoId}/lifecycle`, ADMIN, { action: 'retract' });
  if (ret.status !== 200) {
    // Not retractable (a draft from a crashed earlier run, or already
    // retracted) — harmless for the delete; say so instead of swallowing.
    console.log(`  retract ${repoId} → ${ret.status} (not retractable; the DELETE decides)`);
  }
  const del = await call('DELETE', `/api/okf/repos/${repoId}`, ADMIN);
  if (![200, 202, 204].includes(del.status)) {
    fail(
      `cleanup: delete ${repoId} refused (${del.status} ${del.text.slice(0, 120)}) — zombie serving repo pollutes the next run`
    );
  }
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

  // Sweep this smoke family's leftovers FIRST: a published repo from an
  // earlier run keeps SERVING and its citations pollute the chat answer's
  // sources (live 2026-11-04: attempt N cited attempt N-1's repo).
  const listed = await call('GET', '/api/okf/repos', ADMIN);
  const stale = ((listed.json && listed.json.items) || []).filter((r) =>
    String(r.name || '').startsWith('w1-smoke-srcs-')
  );
  for (const r of stale) {
    await deleteRepo(r.repo_id);
    console.log(`  swept stale smoke repo ${r.name} (${r.repo_id})`);
  }

  // --- 1. Seed: open repo (2 concepts) + restricted repo (1 concept) ---
  console.log('[1] seed repos + approve + publish + drain');
  const alpha = [
    { concept_id: 'alpha_booking', body: CONCEPT('alpha_booking', 'Alpha Booking'), title: 'Alpha Booking' },
    { concept_id: 'alpha_hours', body: CONCEPT('alpha_hours', 'Alpha Office Hours'), title: 'Alpha Office Hours' }
  ];
  const restricted = [
    { concept_id: 'secret_alpha', body: CONCEPT('secret_alpha', 'Secret Alpha'), title: 'Secret Alpha' }
  ];
  // SEQUENTIAL drains, deliberately: the server minted BOTH repos' concepts
  // as the same id (concept-1) and dataprep's uploaded_files namespace is
  // FLAT — concurrent same-id ingests clobber each other's files (live
  // 2026-11-04: R dead-lettered ENOENT while A's 18s ingest was mid-flight;
  // a real ingest-namespacing bug to file separately). The smoke proves
  // CAP-1/2/3, not ingest concurrency.
  const repoA = await makeRepo(NAME_A, alpha);
  const rowsA = await waitIndexed(repoA.id);
  const repoR = await makeRepo(NAME_R, restricted);
  const stamped = await call('PATCH', `/api/okf/repos/${repoR.id}`, ADMIN, {
    acl: { restricted: true, required_scopes: [`okf:t:alpha-smoke-${STAMP}:admin`] }
  });
  if (stamped.status !== 200) throw new Error(`restrict ${repoR.id}: ${stamped.status} ${stamped.text.slice(0, 200)}`);
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
  // The concept INDEX is an editor surface behind the STRICT scope gate — a
  // scopeless caller is 403 there (the serving-read fence is the
  // single-concept GET, asserted above). W9's citizen tree index will be a
  // serving read with its own fence.
  if (fencedList.status === 403) pass('concept INDEX behind the strict editor gate (403 to a scopeless caller)');
  else fail(`restricted concept list as scopeless: expected 403 (strict gate), got ${fencedList.status}`);

  // --- 2.5 W9 concept tree browse: the paginated serving-read index + one
  // per-hop CAP-2 fetch. The index must page (never one full-corpus
  // payload), serve a scopeless caller in open mode (the servingReads
  // registration), and fence a RESTRICTED repo with the same 404 envelope
  // as the concept GET.
  console.log('[2.5] W9 concept-tree index (paginated serving read)');
  const TREE_LIMIT = 1; // force pagination: repo A holds 2 concepts
  let assembled = [];
  let treeTotal = null;
  let maxPage = 0;
  for (let offset = 0; offset < 1000; offset += TREE_LIMIT) {
    const p = await call(
      'GET',
      `/api/okf/repos/${repoA.id}/concept-tree?limit=${TREE_LIMIT}&offset=${offset}`,
      SCOPELESS
    );
    if (p.status !== 200) {
      fail(`concept-tree page offset=${offset}: expected 200, got ${p.status} ${p.text.slice(0, 120)}`);
      break;
    }
    const page = p.json;
    if (treeTotal === null) treeTotal = page.total;
    const rows = Array.isArray(page.concepts) ? page.concepts : [];
    maxPage = Math.max(maxPage, rows.length);
    if (rows.length > TREE_LIMIT) fail(`concept-tree page offset=${offset} exceeded the requested bound`);
    const shapeOk = rows.every(
      (c) => c && typeof c.concept_id === 'string' && typeof c.title === 'string' && Array.isArray(c.links)
    );
    if (!shapeOk) fail(`concept-tree page offset=${offset} rows lack the {concept_id,title,links} contract`);
    assembled = assembled.concat(rows);
    if (rows.length < TREE_LIMIT || assembled.length >= treeTotal) break;
  }
  if (treeTotal === 2 && assembled.length === 2 && maxPage <= TREE_LIMIT) {
    pass(`concept-tree index assembles in ${Math.ceil(2 / TREE_LIMIT)} pages of ≤${TREE_LIMIT} (total=${treeTotal}, never one payload)`);
  } else {
    fail(`concept-tree walk: total=${treeTotal}, assembled=${assembled.length}, maxPage=${maxPage}`);
  }
  const fencedTree = await call('GET', `/api/okf/repos/${repoR.id}/concept-tree`, SCOPELESS);
  if (fencedTree.status === 404) {
    pass('RESTRICTED repo concept-tree FENCED from the scopeless user (404, same envelope as the concept GET)');
  } else {
    fail(`restricted repo concept-tree as scopeless: expected 404, got ${fencedTree.status}`);
  }
  // One per-hop fetch: the second concept of the walk, through the CAP-2
  // route (the browser's detail pane loads each hop exactly like this).
  const hopId = assembled.length > 1 ? assembled[1].concept_id : null;
  if (hopId) {
    const hop = await call('GET', `/api/okf/repos/${repoA.id}/concepts/${hopId}`, SCOPELESS);
    if (hop.status === 200 && hop.json && typeof hop.json.body === 'string') {
      pass(`per-hop content fetch serves the walk (${hopId}, ${String(hop.json.body).length} chars)`);
    } else {
      fail(`per-hop fetch ${hopId}: status=${hop.status}`);
    }
  } else {
    fail('no second concept to hop to — the walk assembled fewer than 2 rows');
  }

  // --- 3. CAP-1: the chat answer's sources carry the full identity ---
  console.log('[3] CAP-1 chat citation identity');
  // WAIT for the graph set to include this run's repo: the authz-resolver
  // caches the serving set — a chat fired seconds after ingest cites a
  // STALE set (live 2026-11-04: attempt 13's answer cited only swept-away
  // repos). The serving-reads /authz/graphs endpoint is the same view the
  // carrier builds from.
  const ownGraph = `OKF_${repoA.id}_v1`;
  const graphDeadline = Date.now() + 300000;
  let graphSetVisible = false;
  while (Date.now() < graphDeadline) {
    const g = await call('GET', '/api/okf/authz/graphs', SCOPELESS);
    const graphs = JSON.stringify(g.json || {});
    if (g.status === 200 && graphs.includes(repoA.id)) {
      graphSetVisible = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 10000));
  }
  if (!graphSetVisible) throw new Error(`graph set never showed ${ownGraph} within 300s (authz-resolver cache)`);
  pass(`graph set includes this run's repo (${ownGraph})`);
  const chat = await askChat(SCOPELESS, 'How do citizens request an alpha appointment?');
  // CAP-1's contract is about the CITATIONS: every okf-concept source must
  // carry repo_id + bundle_version + graph_name as first-class data. WHICH
  // repo the router cites is the query-affinity router's business — this
  // build serves ~16 repos and the run's repo is one candidate (the
  // graph-set check above already proved it is serving and visible).
  const okfSources = chat.sources.filter((s) => s.source === 'okf-concept');
  if (chat.error && !okfSources.length) {
    fail(`chat call failed: ${chat.error}`);
  } else if (!okfSources.length) {
    fail(`no okf-concept sources in the answer (got ${chat.sources.length} sources)`);
  } else {
    const withIdentity = okfSources.filter((s) => s.repo_id && s.bundle_version != null && s.graph_name);
    const graphs = [...new Set(okfSources.map((s) => s.graph_name))];
    if (withIdentity.length === okfSources.length) {
      pass(
        `all ${okfSources.length} citations carry repo_id + bundle_version + graph_name (CAP-1 end-to-end; graphs: ${graphs.join(', ')})`
      );
    } else {
      fail(
        `identity missing on ${okfSources.length - withIdentity.length}/${okfSources.length} citations: ${JSON.stringify(okfSources).slice(0, 300)}`
      );
    }
  }

  // --- 3.5 W2 publication gate, live: retract the open repo and the
  // concept route must refuse. The serving read serves only the retrieval-
  // serving state (publish + ingested); the unit gate cannot prove it
  // end-to-end and the devlog called for exactly this assertion once the
  // tree synced (review fix 2026-11-07).
  console.log('[3.5] retracted repo → concept route refuses');
  const retractA = await call('POST', `/api/okf/repos/${repoA.id}/lifecycle`, ADMIN, { action: 'retract' });
  if (retractA.status !== 200)
    throw new Error(`retract ${repoA.id}: ${retractA.status} ${retractA.text.slice(0, 200)}`);
  const retractedRead = await call('GET', `/api/okf/repos/${repoA.id}/concepts/${openId}`, SCOPELESS);
  if (retractedRead.status === 404) {
    pass('retracted repo concept read → 404 (the publication gate holds live)');
  } else {
    fail(`retracted repo concept read as scopeless: expected 404, got ${retractedRead.status}`);
  }
  // W9: the tree index is under the SAME publication gate — a retracted
  // repo's index must refuse exactly like its concept reads.
  const retractedTree = await call('GET', `/api/okf/repos/${repoA.id}/concept-tree`, SCOPELESS);
  if (retractedTree.status === 404) {
    pass('retracted repo concept-tree → 404 (the publication gate covers the index too)');
  } else {
    fail(`retracted repo concept-tree as scopeless: expected 404, got ${retractedTree.status}`);
  }

  // --- 4. Cleanup ---
  if (CLEANUP === 'full') {
    console.log('[4] cleanup');
    await deleteRepo(repoA.id); // already retracted above — delete asserts the rest
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
