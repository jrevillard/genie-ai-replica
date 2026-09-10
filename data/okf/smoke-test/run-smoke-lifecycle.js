// OKF LIFECYCLE smoke v2 (corrected state-machine contract, David 2026-09-04):
//   1 Import  — repo created, concepts added via /import; NOTHING drains.
//   2 Edit    — (editor-side; not exercised here).
//   3 Review  — submit → approve (any admin).
//   4 Publish — version mint (v1 + zip). Gates on CONTENT, never on indexing.
//   5 Ingest  — arms the RAG drain (ASYNC): chunking/vectorization/graph, and
//               only at drain completion does the version serve (RAG-visible).
//   6 Retract — → edit → publish vNext → ingest again.
// STATE-MACHINE RULES ASSERTED (violations are FAILs):
//   R1 import does NOT drain — no indexed rows, no serving, before the ingest
//      transition (the pre-correction harness wrongly waited for a drain here).
//   R2 concepts are added via POST /:repo_id/import — /ingest is the lifecycle
//      action and must NOT accept a concepts body.
//   R3 publish v1 is content-gated mint: bundle zip named <repo>-v1.zip.
//   R4 lifecycle ingest returns promptly (async arm), drain completes in the
//      background, and serving (ingested_version) appears only at completion.
//   R5 delete blocked while serving; submit refused from retracted (closed machine).
//   R6 re-publish creates v2 (zip superseded), and v2 serves only after ITS
//      ingest completes (step-6 loop).
//   R10 a racing double-DELETE never 500s (947248c33); sequential re-DELETE
//       404s REPO_NOT_FOUND (correct REST).
// Run INSIDE the okf-server container (same procedure as run-smoke-happy.js):
//   docker exec -e OKF_SMOKE_TOKEN_ADMIN=<...> <container> node /app/run-smoke-lifecycle.js

const AdmZip = require('adm-zip');
const dbService = require('./shared-lib/db-connection-service');
const piiService = require('./services/pii-service');

const BASE = process.env.OKF_SMOKE_BASE_URL || 'http://localhost:3002';
const TOKEN = process.env.OKF_SMOKE_TOKEN_ADMIN;
const REPO_NAME = 'smoke-lifecycle';
const DOMAIN = 'smoke';
let REPO_ID = null; // the server mints the repo_id

let failures = 0;
function pass(m) { console.log('PASS  ' + m); }
function fail(m) { failures += 1; console.error('FAIL  ' + m); }

async function call(method, url, body, raw = false) {
  const res = await fetch(BASE + url, {
    method,
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  if (raw) return { status: res.status, headers: res.headers, buffer: Buffer.from(await res.arrayBuffer()) };
  let j = null;
  try { j = await res.json(); } catch { /* non-json */ }
  return { status: res.status, body: j };
}

async function aql(q, bind) {
  const db = await dbService.getConnection('default');
  return (await db.query(q, bind)).all();
}

async function repoDoc() {
  const rows = await aql('FOR r IN okf_repositories FILTER r.repo_id == @r RETURN r', { r: REPO_ID });
  return rows[0] || null;
}

// R4 helper: poll until every meta row for the repo is 'indexed' (drain done),
// then wait for the serving flag (promotion at completion). Fails on 'failed'.
async function waitDrainedAndServing(deadlineMs, expectVersion) {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    const rows = await aql('FOR m IN okf_concepts_meta FILTER m.repo_id == @r RETURN m.index_status', { r: REPO_ID });
    if (rows.some((s) => s === 'failed')) return 'meta-failed';
    const r = await repoDoc();
    const allIndexed = rows.length > 0 && rows.every((s) => s === 'indexed');
    const serving = r && Number(r.ingested_version) === expectVersion && r.ingested_at;
    if (allIndexed && serving) return 'ok';
    await new Promise((res) => setTimeout(res, 3000));
  }
  return 'timeout';
}

async function main() {
  if (!TOKEN) { console.error('OKF_SMOKE_TOKEN_ADMIN required'); process.exit(1); }

  // 0. Cleanup prior runs (direct cascade remove).
  const prior = await aql('FOR r IN okf_repositories FILTER r.name == @n RETURN r.repo_id', { n: REPO_NAME });
  if (prior.length) {
    const repoService = require('./services/repository-service');
    for (const pid of prior) {
      await repoService.remove(pid, { sub: 'smoke-run' }).catch((e) => console.log('  pre-clean: ' + pid + ' ' + e.message));
    }
    for (const pid of prior) {
      await aql('FOR m IN okf_concepts_meta FILTER m.repo_id == @r REMOVE m IN okf_concepts_meta', { r: pid });
      await aql('FOR v IN okf_versions FILTER v.repo_id == @r REMOVE v IN okf_versions', { r: pid });
      await aql('FOR f IN files FILTER f.repo_id == @r REMOVE f IN files', { r: pid });
    }
  }

  // 0. SELF-CLEANUP: a prior crashed run (token expiry mid-run) leaves
  // 'smoke-lifecycle' behind and the next create 409s. Purge it first.
  try {
    const stale = await call('GET', '/api/okf/repos?lifecycle=all');
    for (const it of (stale.body && stale.body.items) || []) {
      if (it.name !== REPO_NAME) continue;
      let d = await call('DELETE', `/api/okf/repos/${it.repo_id}`);
      if (d.status === 409) {
        await call('POST', `/api/okf/repos/${it.repo_id}/lifecycle`, { action: 'retract' });
        d = await call('DELETE', `/api/okf/repos/${it.repo_id}`);
      }
      console.log('cleanup: ' + it.repo_id + ' → ' + d.status);
    }
  } catch { /* best-effort — create will 409 loudly if it failed */ }

  // 1. CREATE → draft.
  const created = await call('POST', '/api/okf/repos', {
    name: REPO_NAME, domain: DOMAIN, acl: { required_scopes: ['okf:t:smoke:admin'] }, lifecycle_state: 'draft'
  });
  if (created.status !== 201 || !created.body.repo_id) { fail('create: ' + created.status + ' ' + JSON.stringify(created.body)); return done(); }
  REPO_ID = created.body.repo_id;
  pass('create → 201 draft (repo_id ' + REPO_ID + ')');

  // 2. IMPORT the concepts (R2: the creation route is /import; /ingest is the
  // RAG lifecycle action and must not take a concepts body).
  const imp = await call('POST', `/api/okf/repos/${REPO_ID}/import`, {
    concepts: [
      { path: 'index.md', frontmatter: { type: 'index', title: REPO_NAME, sources: [], links: [{ target: './alpha.md', label: 'Alpha' }] }, body: '# ' + REPO_NAME + '\n\n## Contents\n\n' },
      { path: 'alpha.md', frontmatter: { type: 'topic', title: 'Alpha', sources: [] }, body: '# Alpha\n\nTopic body.' }
    ]
  });
  if (imp.status === 404 || imp.status === 405) {
    fail('R2 VIOLATION: POST /import missing (' + imp.status + ') — creation vocabulary not implemented');
    return done();
  }
  (imp.status === 200 || imp.status === 201 || imp.status === 202)
    ? pass('import 2 concepts via /import → ' + imp.status)
    : fail('import → ' + imp.status + ' ' + JSON.stringify(imp.body));

  // R1: import must NOT drain. Give the system a window to wrongly-drain, then
  // assert nothing indexed and the repo is not serving.
  await new Promise((r) => setTimeout(r, 6000));
  const preRows = await aql('FOR m IN okf_concepts_meta FILTER m.repo_id == @r RETURN m.index_status', { r: REPO_ID });
  const preRepo = await repoDoc();
  (!preRows.some((s) => s === 'indexed') && !(preRepo && preRepo.ingested_at))
    ? pass('R1: import did NOT drain (statuses before ingest: ' + JSON.stringify(preRows) + ')')
    : fail('R1 VIOLATION: concepts drained BEFORE the ingest transition (' + JSON.stringify(preRows) + ', repo=' + JSON.stringify(preRepo && { ingested_at: preRepo.ingested_at, ingested_version: preRepo.ingested_version }) + ')');

  // R8 LABEL FLOW (David 2026-09-05): a services-level (KH L2) label edited
  // BEFORE publish must reach dataprep's labeling. Patch via the fm mode
  // (no markdown round-trip), then require the meta row's ingest_labels —
  // the exact value the drain posts as fileLabels — to carry it.
  const LBL = 'Service Directory';
  const ids = await aql('FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.is_index != true RETURN m.concept_id', { r: REPO_ID });
  const CID = ids[0];
  if (!CID) {
    fail('R8 setup: no topic concept found after import');
  } else {
    const lp = await call('PATCH', `/api/okf/repos/${REPO_ID}/concepts/${encodeURIComponent(CID)}`, { frontmatter: { labels: [LBL] } });
    (lp.status === 200 || lp.status === 204)
      ? pass('R8: label edit via fm patch → ' + lp.status)
      : fail('R8: label edit → ' + lp.status + ' ' + JSON.stringify(lp.body).slice(0, 160));
    const metaLabels = await aql('FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.concept_id == @c RETURN m.ingest_labels', { r: REPO_ID, c: CID });
    metaLabels[0] && metaLabels[0].includes(LBL)
      ? pass('R8: ingest_labels carries the edited label ' + JSON.stringify(metaLabels[0]))
      : fail('R8 BROKEN: ingest_labels=' + JSON.stringify(metaLabels[0]) + ' — editor label edits never reach dataprep');
  }

  await piiService.markRepoPiiScanned(REPO_ID);
  pass('repo PII scan marked complete (mint prerequisite)');

  // 3. submit → review; publish from review must be REFUSED.
  let r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'submit' });
  (r.status === 200 && r.body.lifecycle_state === 'review') ? pass('submit → review') : fail('submit → ' + r.status + ' ' + JSON.stringify(r.body));

  r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'publish' });
  r.status === 409 && r.body.error === 'INVALID_TRANSITION' ? pass('publish from review refused (INVALID_TRANSITION)') : fail('publish-from-review → ' + r.status + ' ' + JSON.stringify(r.body));

  // 4. approve.
  r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'approve' });
  (r.status === 200 && r.body.lifecycle_state === 'approve') ? pass('approve → approve') : fail('approve → ' + r.status + ' ' + JSON.stringify(r.body));

  // R2b: lifecycle ingest BEFORE publish must be refused.
  r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'ingest' });
  r.status === 409 ? pass('ingest pre-publish refused (' + r.body.error + ')') : fail('ingest-pre-publish → ' + r.status);

  // 5. PUBLISH → v1 (content-gated mint, R3).
  r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'publish' });
  if (r.status !== 200 || r.body.bundle_version !== 1) {
    fail('publish v1 → ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 300));
    return done();
  }
  pass('publish → v1 (content-gated mint), bundle ' + (r.body.bundle && r.body.bundle.file_name));
  if (r.body.bundle && r.body.bundle.file_name === 'smoke-lifecycle-v1.zip') pass('R3: bundle zip named <repo>-v1.zip'); else fail('R3: bundle file name: ' + JSON.stringify(r.body.bundle));

  const bundles = await aql('FOR f IN files FILTER f.repo_id == @r AND f.is_bundle == true RETURN KEEP(f, ["file_id","file_name","bundle_version"])', { r: REPO_ID });
  bundles.length === 1 && bundles[0].bundle_version === 1
    ? pass('doc-repo: exactly 1 bundle zip, bundle_version=1 (' + bundles[0].file_name + ')')
    : fail('bundle docs: ' + JSON.stringify(bundles));

  // 6. INGEST — arms the async RAG drain (R4). Accept 200 or 202; the serving
  // promotion must appear only when the drain COMPLETES.
  r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'ingest' });
  if (r.status !== 200 && r.status !== 202) {
    fail('ingest (arm) → ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 300));
    return done();
  }
  pass('ingest → ' + r.status + ' (drain armed' + (r.body && r.body.rag_ingestion ? '; progress record present' : '') + ')');

  const drain = await waitDrainedAndServing(180000, 1);
  drain === 'ok'
    ? pass('R4: drain completed async — all concepts indexed, serving promoted to v1')
    : fail('R4: drain/serving did not complete (' + drain + ')');

  // R8b: the edited label must be ON THE CHUNKS — dataprep folded the
  // fileLabels (from ingest_labels) into the chunk labeling.
  const repoServing = await repoDoc();
  const graph = (repoServing && repoServing.ingested_graph_name) || '';
  if (!graph) {
    fail('R8b: no ingested_graph_name — cannot check chunk labels');
  } else {
    const chunkRows = await aql(
      'FOR c IN `' + graph + '_SOURCE` FILTER c.concept_id == @c RETURN c.chunk_labels',
      { c: CID }
    );
    const flat = chunkRows.flat().filter(Boolean);
    flat.includes(LBL)
      ? pass('R8b: chunk_labels carry the edited label (' + chunkRows.length + ' chunks in ' + graph + ')')
      : fail('R8b BROKEN: chunk labels ' + JSON.stringify([...new Set(flat)].slice(0, 8)) + ' — label did not reach dataprep');
  }

  // R9 AUTHOR LINKS ON THE SERVING GRAPH (David's curation spec: repos are
  // born with their author graph): the index concept's frontmatter link to
  // alpha must survive import → meta.links → the serving graph's _LINKS_TO.
  // Endpoints are safeKey('c', concept_id) = 'c_' + sha256(id)[:24] (the
  // ENTITY keys are hashes — a LIKE probe can never match them).
  const keyFor = (id) => require('crypto').createHash('sha256').update(String(id)).digest('hex').slice(0, 24);
  const edgeRows = await aql(
    'LET n = LENGTH(FOR l IN `' + graph + '_LINKS_TO` FILTER l._from == @f AND l._to == @t RETURN 1) RETURN n',
    { f: graph + '_ENTITY/c_' + keyFor('index'), t: graph + '_ENTITY/c_' + keyFor(CID) }
  );
  edgeRows[0] >= 1
    ? pass('R9: author link index→alpha landed on the serving graph (' + graph + '_LINKS_TO)')
    : fail('R9 BROKEN: no index→alpha edge in ' + graph + '_LINKS_TO — author links did not reach the graph');

  const del = await call('DELETE', `/api/okf/repos/${REPO_ID}`);
  del.status === 409 && del.body.error === 'INGESTED_DELETE_BLOCKED'
    ? pass('delete while serving → 409 INGESTED_DELETE_BLOCKED')
    : fail('delete-while-serving → ' + del.status + ' ' + JSON.stringify(del.body));

  // 7. STEP-6 LOOP: retract (serving is READ ONLY) → publish v2 → ingest v2.
  r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'retract' });
  (r.status === 200 && r.body.lifecycle_state === 'retracted')
    ? pass('retract → retracted (step-6 loop; edit window opens)')
    : fail('retract → ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'publish' });
  (r.status === 200 && r.body.bundle_version === 2)
    ? pass('publish → v2 (new version of published repo)')
    : fail('publish v2: ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 300));
  const bundles2 = await aql('FOR f IN files FILTER f.repo_id == @r AND f.is_bundle == true RETURN f.bundle_version', { r: REPO_ID });
  bundles2.length === 1 && bundles2[0] === 2
    ? pass('v1 zip superseded — exactly 1 bundle, version 2')
    : fail('post-supersede bundles: ' + JSON.stringify(bundles2));
  // R6: v2 must NOT be serving until ITS ingest completes. Whether publish
  // clears the v1 serving flag is an implementation choice — what the contract
  // fixes is that ingested_version cannot claim v2 before v2's drain ran.
  const mid = await repoDoc();
  (!mid || Number(mid.ingested_version) !== 2)
    ? pass('R6: v2 not serving before its ingest (serving state: ' + JSON.stringify(mid && { ingested_version: mid.ingested_version }) + ')')
    : fail('R6 VIOLATION: v2 claims serving without its own drain');

  // 8. Versions ledger: v2 then v1.
  const vers = await call('GET', `/api/okf/repos/${REPO_ID}/versions`);
  vers.body && vers.body.versions && vers.body.versions.length === 2 && vers.body.versions[0].bundle_version === 2
    ? pass('versions ledger: [v2, v1] newest first')
    : fail('versions: ' + JSON.stringify(vers.body).slice(0, 200));

  // 9. EXPORT: zip bytes, repo+version file name, valid zip layout.
  const exp = await call('GET', `/api/okf/repos/${REPO_ID}/export`, null, true);
  if (exp.status !== 200) fail('export → ' + exp.status);
  else {
    const cd = exp.headers.get('content-disposition') || '';
    let zipOk = false, entries = [];
    try {
      const zip = new AdmZip(exp.buffer);
      entries = zip.getEntries().map((e) => e.entryName).sort();
      zipOk = entries.includes('index.md') && entries.includes('concepts/alpha.md');
    } catch (e) { zipOk = false; }
    zipOk && cd.includes('smoke-lifecycle-v2.zip')
      ? pass('export → valid zip (index.md + concepts/alpha.md) as <repo>-v2.zip')
      : fail('export: cd=' + cd + ' entries=' + JSON.stringify(entries));
  }

  // 10. INGEST v2 → drain → serving v2 (R6 completion of the step-6 loop).
  r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'ingest' });
  if (r.status !== 200 && r.status !== 202) {
    fail('ingest v2 (arm) → ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 300));
    return done();
  }
  const drain2 = await waitDrainedAndServing(180000, 2);
  drain2 === 'ok' ? pass('R6: v2 drained + serving') : fail('R6: v2 drain/serving (' + drain2 + ')');

  // 11. RETRACT → the retracted state (visible, own lane).
  const preRetractDoc = (await repoDoc()) || {};
  const servedGraph = preRetractDoc.ingested_graph_name || '';
  r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'retract' });
  (r.status === 200 && r.body.lifecycle_state === 'retracted')
    ? pass('retract → retracted (own state)')
    : fail('retract: ' + r.status + ' ' + JSON.stringify(r.body));
  // D-C (#981): retract DROPS the serving graph — definition + member
  // collections GONE — while the concept meta rows SURVIVE (retract ≠ delete).
  if (!servedGraph) {
    fail('D-C: no ingested_graph_name before retract — cannot assert the drop');
  } else {
    const graphLeft = await aql('FOR g IN _graphs FILTER g._key == @g RETURN g._key', { g: servedGraph });
    const metaRows = (
      await aql('RETURN LENGTH(FOR c IN okf_concepts_meta FILTER c.repo_id == @r RETURN 1)', { r: REPO_ID })
    )[0];
    graphLeft.length === 0
      ? pass('D-C: retract dropped the serving graph (' + servedGraph + ')')
      : fail('D-C BROKEN: serving graph still present after retract: ' + JSON.stringify(graphLeft));
    metaRows > 0
      ? pass('D-C: meta rows survive the retract (' + metaRows + ' rows)')
      : fail('D-C BROKEN: retract destroyed the meta rows (' + metaRows + ')');
  }

  // 12. Re-ingest from retracted → serving again; retract; machine closes; delete.
  r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'ingest' });
  if (r.status !== 200 && r.status !== 202) {
    fail('re-ingest (arm) → ' + r.status + ' ' + JSON.stringify(r.body));
    return done();
  }
  const drain3 = await waitDrainedAndServing(180000, 2);
  drain3 === 'ok' ? pass('re-ingest from retracted → serving again') : fail('re-ingest drain (' + drain3 + ')');
  // D-C completion: the drain REBUILT the dropped graph born-right.
  const rebuilt = await aql('FOR g IN _graphs FILTER g._key == @g RETURN g._key', { g: servedGraph });
  rebuilt.length === 1
    ? pass('D-C: re-ingest rebuilt the serving graph (' + servedGraph + ')')
    : fail('D-C BROKEN: serving graph not rebuilt after re-ingest (found: ' + JSON.stringify(rebuilt) + ')');
  // ZERO-WRITE GATE (#981, David's v8 shell 2026-09-08): existence alone let
  // an EMPTY promote-shell serve. The graph must hold DATA — all four member
  // collections populated, each count > 0.
  if (servedGraph) {
    const counts = (
      await aql(
        'RETURN [LENGTH(FOR d IN `' + servedGraph + '_ENTITY` RETURN 1),' +
          'LENGTH(FOR d IN `' + servedGraph + '_SOURCE` RETURN 1),' +
          'LENGTH(FOR d IN `' + servedGraph + '_HAS_SOURCE` RETURN 1),' +
          'LENGTH(FOR d IN `' + servedGraph + '_LINKS_TO` RETURN 1)]'
      )
    )[0];
    const ok = Array.isArray(counts) && counts.every((n) => n > 0);
    ok
      ? pass('ZERO-WRITE GATE: graph holds data — ENTITY=' + counts[0] + ' SOURCE=' + counts[1] + ' HAS_SOURCE=' + counts[2] + ' LINKS_TO=' + counts[3])
      : fail('ZERO-WRITE GATE BROKEN: ' + servedGraph + ' counts=' + JSON.stringify(counts) + ' (empty shell serving)');
  }
  await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'retract' });
  r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'submit' });
  // 'retracted' IS the edit state for out-of-service content (lifecycle-service
  // TRANSITIONS: submit from ['draft','register','validate','retracted']) —
  // re-entry via submit is the DESIGNED loop, not a violation.
  r.status === 200
    ? pass('submit from retracted → review (designed re-entry loop)')
    : fail('submit-from-retracted: ' + r.status);

  const del2 = await call('DELETE', `/api/okf/repos/${REPO_ID}`);
  del2.status === 202
    ? pass('delete (retracted, not serving) → 202 cascade')
    : fail('final delete: ' + del2.status + ' ' + JSON.stringify(del2.body));

  const leftovers = await aql('FOR r IN okf_repositories FILTER r.repo_id == @r RETURN r', { r: REPO_ID });
  leftovers.length === 0
    ? pass('no leftovers — repo fully removed')
    : fail('leftovers: ' + leftovers.length);

  // R7: the delete cascade must drop the repo's ArangoDB graphs. A repo that is
  // gone can never leave an OKF_<slug>_vN graph behind (David, 2026-09-04 — the
  // e2e orphan-graph leak). Graph definitions live in the _graphs collection.
  const slug = REPO_NAME.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const graphKeys = await aql('FOR g IN _graphs RETURN g._key');
  const orphans = graphKeys.filter((n) => n.startsWith('OKF_' + slug + '_v'));
  orphans.length === 0
    ? pass('R7: no orphan graphs after delete (repo fully unwound)')
    : fail('R7 VIOLATION: orphan graphs survived delete: ' + JSON.stringify(orphans));

  // R10 DELETE IDEMPOTENCY (947248c33): a racing double-DELETE must never 500
  // (David's 2026-09-05 deletes 500'd — the UI double-fired and the loser's
  // registry remove hit not-found mid-cascade). Per-request 2xx OR 404 is
  // acceptable (a request may lose the race cleanly); the invariants are NO 500
  // anywhere and the repo fully gone. A draft never built a graph — this also
  // re-proves the never-built-graph delete path end-to-end.
  const r10 = await call('POST', '/api/okf/repos', {
    name: 'smoke-delete-race', domain: DOMAIN, acl: { required_scopes: ['okf:t:smoke:admin'] }, lifecycle_state: 'draft'
  });
  if (r10.status !== 201 || !r10.body.repo_id) {
    fail('R10 setup: create → ' + r10.status + ' ' + JSON.stringify(r10.body));
  } else {
    const rid = r10.body.repo_id;
    const fires = await Promise.all([
      call('DELETE', `/api/okf/repos/${rid}`),
      call('DELETE', `/api/okf/repos/${rid}`)
    ]);
    const bad = fires.filter((f) => f.status >= 500);
    const gone = await call('GET', `/api/okf/repos/${rid}`);
    (!bad.length && gone.status === 404)
      ? pass('R10: concurrent double-DELETE → no 500 (' + fires.map((f) => f.status).join('/') + '), repo fully gone')
      : fail('R10: statuses=' + fires.map((f) => f.status).join('/') + ' finalGET=' + gone.status);
    const third = await call('DELETE', `/api/okf/repos/${rid}`);
    third.status === 404
      ? pass('R10: sequential re-DELETE → 404 REPO_NOT_FOUND (correct REST)')
      : fail('R10: re-DELETE → ' + third.status + ' (expected 404)');
  }

  done();
}

function done() {
  console.log(failures === 0 ? '\nSMOKE LIFECYCLE v2: ALL PASS' : '\nSMOKE LIFECYCLE v2: ' + failures + ' FAILURE(S)');
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { fail('fatal: ' + e.message); done(); });