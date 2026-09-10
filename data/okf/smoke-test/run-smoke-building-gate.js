// OKF BUILDING-GATE smoke (David, 2026-09-02/03): proves the server-side
// building gates of the lifecycle against the REAL services (Story #978):
//   create + ingest → parsed rows block submit (INDEXING_IN_PROGRESS, the
//   natural signal) → GET carries indexing_pending (the
//   dashboard mirror) → rows settled to terminal → an active `conversion`
//   record blocks submit (BUILD_IN_PROGRESS) → terminal conversion (done)
//   releases submit (200 review) → cleanup (delete + no leftovers).
// Run INSIDE the okf-server container (same procedure as run-smoke-lifecycle.js):
//   docker cp run-smoke-building-gate.js <container>:/tmp/
//   docker exec -e OKF_SMOKE_TOKEN_ADMIN=<...> <container> sh -c "node /tmp/run-smoke-building-gate.js"

const dbService = require('./shared-lib/db-connection-service');

const BASE = process.env.OKF_SMOKE_BASE_URL || 'http://localhost:3002';
const TOKEN = process.env.OKF_SMOKE_TOKEN_ADMIN;
const REPO_NAME = 'smoke-building-gate';
let REPO_ID = null;

let failures = 0;
function pass(m) { console.log('PASS  ' + m); }
function fail(m) { failures += 1; console.error('FAIL  ' + m); }

async function call(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  let j = null;
  try { j = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body: j };
}

async function aql(q, bind) {
  const db = await dbService.getConnection('default');
  return (await db.query(q, bind)).all();
}

/** Count meta rows still parsed (queued/in-flight) for the probe repo. */
async function parsedCount() {
  const rows = await aql(
    'FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.index_status == "parsed" COLLECT WITH COUNT INTO c RETURN c',
    { r: REPO_ID }
  );
  return rows[0] || 0;
}

/**
 * Settle the probe repo's rows to the worker's terminal status. The gate
 * counts ONLY `parsed` rows, so the release test needs them terminal —
 * this writes the same transition the ingest worker makes (parsed →
 * indexed). Deliberately NOT a live dataprep drain: the worker queue is
 * GLOBAL single-flight (a crawler backlog starves probe drains for many
 * minutes — 2026-09-03: 137 parsed rows from 6 other repos), so a queue-
 * dependent deadline made this smoke non-deterministic. The REAL drain is
 * proven by run-smoke-lifecycle.js.
 */
async function settleIndexed() {
  await aql(
    'FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.index_status == "parsed" UPDATE m WITH { index_status: "indexed", last_good_index_at: DATE_ISO8601(DATE_NOW()) } IN okf_concepts_meta',
    { r: REPO_ID }
  );
  return (await parsedCount()) === 0;
}

async function main() {
  if (!TOKEN) { console.error('OKF_SMOKE_TOKEN_ADMIN required'); process.exit(1); }

  // 0. Cleanup prior runs.
  const prior = await aql('FOR r IN okf_repositories FILTER r.name == @n RETURN r.repo_id', { n: REPO_NAME });
  for (const pid of prior) {
    const repoService = require('./services/repository-service');
    await repoService.remove(pid, { sub: 'smoke-run' }).catch(() => {});
    await aql('FOR m IN okf_concepts_meta FILTER m.repo_id == @r REMOVE m IN okf_concepts_meta', { r: pid });
    await aql('FOR v IN okf_versions FILTER v.repo_id == @r REMOVE v IN okf_versions', { r: pid });
    await aql('FOR f IN files FILTER f.repo_id == @r REMOVE f IN files', { r: pid });
  }
  if (prior.length) console.log('  pre-cleaned ' + prior.length + ' prior probe repo(s)');

  // 1. CREATE draft + ingest 2 concepts (rows land as `parsed` immediately).
  const created = await call('POST', '/api/okf/repos', {
    name: REPO_NAME, domain: 'smoke', acl: { required_scopes: ['okf:t:smoke:admin'] }, lifecycle_state: 'draft'
  });
  if (created.status !== 201 || !created.body.repo_id) { fail('create: ' + created.status + ' ' + JSON.stringify(created.body)); return done(); }
  REPO_ID = created.body.repo_id;
  pass('create → 201 draft (' + REPO_ID + ')');

  const ing = await call('POST', `/api/okf/repos/${REPO_ID}/ingest`, {
    concepts: [
      { path: 'index.md', frontmatter: { type: 'index', title: REPO_NAME, sources: [] }, body: '# ' + REPO_NAME + '\n\n## Contents\n\n' },
      { path: 'alpha.md', frontmatter: { type: 'topic', title: 'Alpha', sources: [] }, body: '# Alpha\n\nTopic body.' }
    ]
  });
  ing.status === 202 ? pass('ingest 2 concepts → 202') : fail('ingest → ' + ing.status + ' ' + JSON.stringify(ing.body));

  // 2. THE NATURAL GATE: freshly ingested concepts are parsed (queued) —
  //    submit must refuse with INDEXING_IN_PROGRESS.
  let r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'submit' });
  r.status === 409 && r.body.error === 'INDEXING_IN_PROGRESS' && /still indexing/.test(r.body.message || '')
    ? pass('submit while concepts parse → 409 INDEXING_IN_PROGRESS')
    : fail('submit-while-parsing → ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));

  // 3. THE DASHBOARD MIRROR: GET carries indexing_pending > 0.
  const got = await call('GET', `/api/okf/repos/${REPO_ID}`);
  got.status === 200 && (got.body.indexing_pending || 0) >= 1
    ? pass('GET carries indexing_pending=' + got.body.indexing_pending)
    : fail('GET indexing_pending → ' + got.status + ' ' + JSON.stringify(got.body).slice(0, 200));

  // 4. Settle rows to terminal so phase 5 isolates the CONVERSION gate alone.
  (await settleIndexed())
    ? pass('rows settled to indexed (parsed count = 0)')
    : fail('rows still parsed after settle — cannot isolate the conversion signal');

  // 5. THE CONVERSION GATE: an active `conversion` record blocks submit even
  //    with zero parsed rows (synthetic — the crawl-conversion job writes
  //    this exact shape while a source file is being processed).
  await aql(
    'UPDATE @k WITH { conversion: { status: "splitting", stage: "splitting", pages_done: 12, batches_done: 2 } } IN okf_repositories',
    { k: REPO_ID }
  );
  r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'submit' });
  r.status === 409 && r.body.error === 'BUILD_IN_PROGRESS' && /still being processed \(stage: splitting/.test(r.body.message || '')
    ? pass('submit with active conversion → 409 BUILD_IN_PROGRESS (stage: splitting)')
    : fail('submit-while-converting → ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));

  // 6. RELEASE: a terminal conversion (done) does NOT block (the peer contract).
  await aql('UPDATE @k WITH { conversion: { status: "done", pages_done: 12, batches_done: 2 } } IN okf_repositories', { k: REPO_ID });
  r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'submit' });
  r.status === 200 && r.body.lifecycle_state === 'review'
    ? pass('terminal conversion (done) releases the gate → submit → review')
    : fail('submit-after-done → ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));

  // 7. Cleanup: back to draft, delete, no leftovers.
  await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'submit' }).catch(() => {});
  const del = await call('DELETE', `/api/okf/repos/${REPO_ID}`);
  del.status === 202 ? pass('delete probe repo → 202') : fail('delete → ' + del.status + ' ' + JSON.stringify(del.body));
  const leftovers = await aql('FOR r IN okf_repositories FILTER r.repo_id == @r RETURN 1', { r: REPO_ID });
  const metaLeft = await aql('FOR m IN okf_concepts_meta FILTER m.repo_id == @r RETURN 1', { r: REPO_ID });
  leftovers.length === 0 && metaLeft.length === 0
    ? pass('no leftovers (repo + meta rows removed)')
    : fail('leftovers: repo=' + leftovers.length + ' meta=' + metaLeft.length);

  done();
}

function done() {
  console.log(failures === 0 ? '\nSMOKE BUILDING-GATE: ALL PASS' : '\nSMOKE BUILDING-GATE: ' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { fail('fatal: ' + e.message); done(); });