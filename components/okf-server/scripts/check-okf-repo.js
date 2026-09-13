#!/usr/bin/env node
/*
 * check-okf-repo.js — OKF repository health + graph/RAG-fitness check
 * (David, 2026-09-13: "turn the graph comparison into a test that we can run
 * on other OKF repositories and ensure we are getting good results from the
 * solution for each step of the process").
 *
 * READ-ONLY. Verifies one OKF repository END TO END, per pipeline step:
 *   1. Lifecycle        — publish/ingest state, drain armed, honest rag_ingestion
 *                         record (the 31h wedge symptoms), failed-concept list.
 *   2. Author layer     — okf_concepts_meta.links[] (what the editor graph
 *                         draws): self-loops (born-right forbids them), dangling
 *                         targets, and the EXACT frontend projection math
 *                         (hub hidden, index edges dropped, from->to dedupe).
 *   3. Serving graph    — the ArangoDB OKF_<slug>_vN collections: spine hub
 *                         out-degree vs concept count, entity/chunk/edge counts.
 *   4. Chunk/RAG layer  — embedding coverage, orphan chunks (failed concepts
 *                         must contribute NOTHING), chunks-per-concept and
 *                         chunk-length distributions, vector-index presence.
 *
 * Usage (from components/okf-server):
 *   ARANGO_URL=http://localhost:8529 ARANGO_DB=genie-ai \
 *     NODE_PATH=./node_modules \
 *     node --env-file=<deploy>/.env scripts/check-okf-repo.js <repo_id|name> [--json]
 *
 *   NODE_PATH is needed for DEV CHECKOUT runs only: components/shared is
 *   source-only there (no node_modules), so arangojs/winston resolve from
 *   okf-server's deps. Inside the image the driver lives at shared-lib/ and
 *   resolves normally — no NODE_PATH required.
 *
 * DB access goes through the SHARED driver (components/shared/lib, copied to
 * shared-lib/ in the image; jest maps it — a dev checkout resolves the
 * fallback below). Exit code: 0 = no FAIL, 1 = at least one FAIL.
 */

// Shared-driver resolution: in-container ('../shared-lib'), else the dev
// checkout's canonical copy ('../../shared/lib'). Same module, two homes.
function loadDbService() {
  try {
    return require('../shared-lib/db-connection-service');
  } catch {
    return require('../../shared/lib/db-connection-service');
  }
}

const dbService = loadDbService();

const results = [];
function record(step, status, check, detail) {
  results.push({ step, status, check, detail });
  if (process.argv.includes('--json')) return;
  const mark = { PASS: '[PASS]', WARN: '[WARN]', FAIL: '[FAIL]', INFO: '[INFO]' }[status];
  console.log(`${mark} ${step} — ${check}${detail ? ': ' + detail : ''}`);
}

async function one(db, aql, bindVars) {
  const r = await db.query(aql, bindVars || {});
  return (await r.all())[0];
}

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('usage: node scripts/check-okf-repo.js <repo_id|name> [--json]');
    process.exit(2);
  }
  const db = await dbService.getConnection();

  // ── Step 1: repo + lifecycle ────────────────────────────────────────────
  // Match by repo_id, exact/case-insensitive name, or the SLUGIFIED name
  // (repos carry human names — "Kenya Government Services"; the graph slug
  // "kenya-government-services" is derived from them, so accept either).
  const repos = await db
    .query('FOR r IN okf_repositories FILTER r.deleted_at == null RETURN r')
    .then((cur) => cur.all());
  const slugify = (s) =>
    String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  const want = slugify(target);
  const repo = repos.find(
    (r) =>
      r.repo_id === target || String(r.name || '').toLowerCase() === target.toLowerCase() || slugify(r.name) === want
  );
  if (!repo) {
    record(
      '1-lifecycle',
      'FAIL',
      'repo found',
      `no repo matching "${target}" — known: ${repos.map((r) => r.name).join(', ')}`
    );
    return finish();
  }
  const rid = repo.repo_id;
  const ing = repo.rag_ingestion || {};
  record('1-lifecycle', 'INFO', 'repo', `${repo.name} (${rid}) v${repo.version} state=${repo.lifecycle_state}`);
  if (repo.lifecycle_state === 'publish' && !repo.ingested_at) {
    record('1-lifecycle', 'FAIL', 'publish without ingested_at', 'the settle never ran (the 31h wedge symptom)');
  } else {
    record(
      '1-lifecycle',
      'PASS',
      'serving flags',
      `ingested_at=${repo.ingested_at || 'n/a'} graph=${repo.ingested_graph_name || 'n/a'}`
    );
  }
  const statusRows = await db
    .query(
      `FOR m IN okf_concepts_meta FILTER m.repo_id == @rid
         COLLECT st = m.index_status WITH COUNT INTO c
         RETURN {st, c}`,
      { rid }
    )
    .then((cur) => cur.all());
  const counts = {
    parsed: (statusRows.find((x) => x.st === 'parsed') || { c: 0 }).c,
    indexed: (statusRows.find((x) => x.st === 'indexed') || { c: 0 }).c,
    failed: (statusRows.find((x) => x.st === 'failed') || { c: 0 }).c
  };
  record(
    '1-lifecycle',
    'INFO',
    'queue state',
    `parsed=${counts.parsed} indexed=${counts.indexed} failed=${counts.failed}`
  );
  if (repo.rag_drain_active === true && counts.parsed === 0) {
    record(
      '1-lifecycle',
      'FAIL',
      'drain armed with an EMPTY queue',
      'wedged — the reconcile must settle it (eb45ab1e4)'
    );
  } else {
    record('1-lifecycle', 'PASS', 'drain state', `rag_drain_active=${repo.rag_drain_active === true}`);
  }
  const expectedStatus = counts.parsed > 0 ? 'draining' : counts.failed > 0 ? 'failed' : 'completed';
  if ((ing.status || null) !== expectedStatus && repo.ingested_at) {
    record(
      '1-lifecycle',
      'WARN',
      'rag_ingestion.status not honest',
      `record=${ing.status} but live counts imply "${expectedStatus}"`
    );
  } else {
    record('1-lifecycle', 'PASS', 'rag_ingestion.status honest', `status=${ing.status || 'n/a'}`);
  }
  const nFailedListed = (ing.failed_concepts || []).length;
  if (repo.ingested_at && counts.failed !== nFailedListed) {
    record(
      '1-lifecycle',
      'WARN',
      'failed_concepts list length',
      `listed=${nFailedListed} vs live failed=${counts.failed}`
    );
  } else {
    record('1-lifecycle', 'PASS', 'failed_concepts list', `listed=${nFailedListed}`);
  }

  // ── Step 2: author layer (editor projection) ────────────────────────────
  const meta = await one(
    db,
    `LET total = LENGTH(FOR m IN okf_concepts_meta FILTER m.repo_id == @rid RETURN 1)
     LET occ = (FOR m IN okf_concepts_meta FILTER m.repo_id == @rid FOR l IN (m.links || []) RETURN l)
     LET selfLoops = LENGTH(FOR l IN occ FILTER l.to_concept_id == l.from_concept_id RETURN 1)
     LET dangling = LENGTH(FOR l IN occ
        FILTER l.to_concept_id != null
        LET k = LENGTH(FOR t IN okf_concepts_meta FILTER t.repo_id == @rid AND t.concept_id == l.to_concept_id LIMIT 1 RETURN 1)
        FILTER k == 0 RETURN l)
     RETURN {total, occ: LENGTH(occ), selfLoops, dangling}`,
    { rid }
  );
  record('2-author', 'INFO', 'projection source', `concepts=${meta.total} link occurrences=${meta.occ}`);
  record(
    '2-author',
    meta.selfLoops > 0 ? 'FAIL' : 'PASS',
    'self-loops',
    `${meta.selfLoops} (born-right: dropped at creation)`
  );
  record(
    '2-author',
    meta.dangling > 0 ? 'WARN' : 'PASS',
    'dangling targets',
    `${meta.dangling} (editor drops them silently)`
  );
  // EXACT frontend rules (RepoGraphView.vue edges()): from non-index concepts,
  // to non-index concepts, target must exist in-repo, from->to deduped.
  const proj = await one(
    db,
    `LET pairs = UNIQUE(FOR m IN okf_concepts_meta
        FILTER m.repo_id == @rid AND m.is_index != true
        FOR l IN (m.links || [])
        FILTER l.to_concept_id != null AND l.to_concept_id != 'index'
        LET toDoc = (FOR t IN okf_concepts_meta FILTER t.repo_id == @rid AND t.concept_id == l.to_concept_id LIMIT 1 RETURN t)[0]
        FILTER toDoc != null AND toDoc.is_index != true
        RETURN CONCAT_SEPARATOR('~', m.concept_id, l.to_concept_id))
     RETURN {editorEdges: LENGTH(pairs)}`,
    { rid }
  );
  record(
    '2-author',
    'INFO',
    'editor graph as the UI draws it',
    `${meta.total - 1} concepts (header shows ${meta.total - 2} = visible - 1) · ${proj.editorEdges} links`
  );

  // ── Step 3: serving graph (ArangoDB) ────────────────────────────────────
  const graphName = repo.ingested_graph_name;
  if (repo.ingested_at && !graphName) {
    record('3-serving', 'FAIL', 'ingested without ingested_graph_name', 'serving graph unknown');
    return finish();
  }
  if (!graphName) {
    record('3-serving', 'INFO', 'not ingested yet', 'serving graph does not exist (expected pre-publish drain)');
    return finish();
  }
  const cols = (await db.collections())
    .filter((c) => c.name && c.name.indexOf(graphName + '_') === 0)
    .map((c) => ({ name: c.name, type: c.type }));
  const need = ['_ENTITY', '_SOURCE', '_LINKS_TO', '_HAS_SOURCE'];
  const missing = need.filter((s) => !cols.some((c) => c.name === graphName + s));
  if (missing.length) {
    record('3-serving', 'FAIL', 'serving collections missing', missing.join(', '));
    return finish();
  }
  record('3-serving', 'PASS', 'collections present', need.map((s) => graphName + s).join(', '));
  const cnt = async (col) =>
    (await one(db, 'LET n = (FOR d IN @@c COLLECT WITH COUNT INTO x RETURN x) RETURN n[0]', { '@c': col })) || 0;
  const nEntity = await cnt(graphName + '_ENTITY');
  const nSource = await cnt(graphName + '_SOURCE');
  const nLinks = await cnt(graphName + '_LINKS_TO');
  const nHas = await cnt(graphName + '_HAS_SOURCE');
  record(
    '3-serving',
    nEntity > 0 && nSource > 0 ? 'PASS' : 'FAIL',
    'graph materialized',
    `ENTITY=${nEntity} SOURCE=${nSource} LINKS_TO=${nLinks} HAS_SOURCE=${nHas}`
  );
  const spine = await one(
    db,
    `LET idx = (FOR m IN okf_concepts_meta FILTER m.repo_id == @rid AND m.is_index == true LIMIT 1 RETURN m)[0]
     LET hub = idx ? (FOR v IN @@e FILTER v.concept_id == idx.concept_id LIMIT 1 RETURN v)[0] : null
     LET deg = hub ? LENGTH(FOR e IN @@l FILTER e._from == hub._id RETURN 1) : 0
     RETURN {hubKey: hub ? hub._key : null, degree: deg}`,
    { rid, '@e': graphName + '_ENTITY', '@l': graphName + '_LINKS_TO' }
  );
  if (!spine.hubKey) {
    record('3-serving', 'WARN', 'spine hub', 'no LINKS_TO edges from the index concept entity');
  } else {
    const expectDeg = meta.total - 1;
    record(
      '3-serving',
      Math.abs(spine.degree - expectDeg) <= Math.max(2, expectDeg * 0.01) ? 'PASS' : 'WARN',
      'spine hub out-degree',
      `hub=${spine.hubKey} degree=${spine.degree} (concepts-1=${expectDeg})`
    );
  }
  const density = await one(
    db,
    `RETURN {from: LENGTH(FOR e IN @@l COLLECT f = e._from RETURN f), to: LENGTH(FOR e IN @@l COLLECT t = e._to RETURN t)}`,
    { '@l': graphName + '_LINKS_TO' }
  );
  record(
    '3-serving',
    'INFO',
    'cross-link density',
    `${density.from} distinct sources → ${density.to} distinct targets (star ≈ from=1)`
  );

  // ── Step 4: chunk/RAG layer ─────────────────────────────────────────────
  const emb = await one(
    db,
    `LET withEmb = LENGTH(FOR d IN @@s FILTER d.embedding != null RETURN 1)
     LET dims = (FOR d IN @@s FILTER d.embedding != null LIMIT 1 RETURN LENGTH(d.embedding))
     RETURN {withEmb, dims: dims[0]}`,
    { '@s': graphName + '_SOURCE' }
  );
  const coverage = nSource > 0 ? Math.round((emb.withEmb / nSource) * 100) : 0;
  record(
    '4-rag',
    coverage === 100 ? 'PASS' : 'FAIL',
    'embedding coverage',
    `${emb.withEmb}/${nSource} (${coverage}%) dims=${emb.dims || 'n/a'}`
  );
  const orphans = await one(
    db,
    `LET failedIds = (FOR m IN okf_concepts_meta FILTER m.repo_id == @rid AND m.index_status == 'failed' RETURN m.concept_id)
     RETURN {n: LENGTH(FOR d IN @@s FILTER d.concept_id != null AND POSITION(failedIds, d.concept_id) RETURN 1),
             withChunks: LENGTH(FOR d IN @@s FILTER d.concept_id != null COLLECT cid = d.concept_id RETURN cid)}`,
    { rid, '@s': graphName + '_SOURCE' }
  );
  record('4-rag', orphans.n === 0 ? 'PASS' : 'FAIL', 'orphan chunks', `${orphans.n} from failed concepts must be 0`);
  if (orphans.withChunks !== counts.indexed) {
    record(
      '4-rag',
      'WARN',
      'chunk concept coverage',
      `${orphans.withChunks} concepts have chunks vs ${counts.indexed} indexed`
    );
  } else {
    record('4-rag', 'PASS', 'chunk concept coverage', `${orphans.withChunks} == indexed`);
  }
  const dist = await one(
    db,
    `LET per = (FOR d IN @@s FILTER d.concept_id != null COLLECT cid = d.concept_id AGGREGATE n = COUNT() SORT n ASC RETURN n)
     LET lens = (FOR d IN @@s SORT LENGTH(d.text) RETURN LENGTH(d.text))
     RETURN {min: per[0], med: per[LENGTH(per)/2], max: per[LENGTH(per)-1],
             tMed: lens[LENGTH(lens)/2], tAvg: ROUND(SUM(lens) / LENGTH(lens)), tMax: lens[LENGTH(lens)-1]}`,
    { '@s': graphName + '_SOURCE' }
  );
  const crowd = dist.med > 0 && dist.max > dist.med * 50;
  record(
    '4-rag',
    crowd ? 'WARN' : 'INFO',
    'chunks-per-concept',
    `min=${dist.min} median=${dist.med} max=${dist.max}${crowd ? ' — outlier page may crowd top-k' : ''}`
  );
  const thin = dist.tMed < 200 || dist.tMax > 4000;
  record(
    '4-rag',
    thin ? 'WARN' : 'PASS',
    'chunk text sizes',
    `avg=${dist.tAvg} median=${dist.tMed} max=${dist.tMax} chars${thin ? ' — padded/truncated chunking?' : ''}`
  );
  const idxs = await db.collection(graphName + '_SOURCE').indexes();
  const hasVector = idxs.some((i) => i.type === 'inverted' || i.type === 'vector');
  record(
    '4-rag',
    'INFO',
    'vector index',
    hasVector
      ? 'present on SOURCE'
      : 'absent — exact brute-force cosine (by config, fine at this scale; the scale lever is RETRIEVER_ARANGO_USE_APPROX_SEARCH + an index)'
  );

  return finish();

  function finish() {
    const n = (s) => results.filter((r) => r.status === s).length;
    const verdict = n('FAIL') > 0 ? 'FAIL' : n('WARN') > 0 ? 'WARN' : 'PASS';
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify({ repo: target, repo_id: rid, verdict, results }, null, 2));
    } else {
      console.log(`\nVERDICT: ${verdict} — PASS=${n('PASS')} WARN=${n('WARN')} FAIL=${n('FAIL')} INFO=${n('INFO')}`);
    }
    process.exit(n('FAIL') > 0 ? 1 : 0);
  }
}

main().catch((e) => {
  console.error('check failed:', e.message);
  process.exit(2);
});
