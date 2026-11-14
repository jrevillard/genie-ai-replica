// OKF PER-CONCEPT SPLIT smoke (#1577 story 1, 2026-11-14):
//   "A steward can split an oversized concept into lossless parts over the API."
//
// Properties proven LIVE against a running deployment:
//
//   1. THE SPLIT WORKS AND IS LOSSLESS. POST /concepts/:id/split on an
//      oversized seeded concept → 200; the parts' bodies fetched back through
//      the API and joined with the document's own line ending reproduce the
//      original byte-for-byte; each part fits the ceiling.
//
//   2. IDENTITY FOLLOWS THE CONVENTION. Part 1 keeps the concept_id, path and
//      title (inbound links keep resolving); parts 2..N take -part-N ids,
//      -part-N.md paths and " — part N" titles; sources[] carried UNCHANGED
//      to every part (provenance is not partitioned).
//
//   3. EVERY PART ROW IS BORN-RIGHT for the drain: index_status 'parsed',
//      graph_name == the repository's CURRENT working graph, the bundle
//      version carried; each part's pii_state is stamped by the per-part scan.
//
//   4. REFUSALS ARE HONEST AND WRITE NOTHING. A within-ceiling concept →
//      400 CONCEPT_WITHIN_CEILING; an unsplittable body (one line over the
//      ceiling) → 409 CONCEPT_TOO_LARGE naming size/ceiling/remedy — in both
//      cases the corpus is unchanged. A SERVING repository refuses the split
//      with 409 REPO_READ_ONLY.
//
// Run INSIDE the okf-server container (same procedure as run-smoke-ceiling.js):
//   docker cp data/okf/smoke-test/run-smoke-split.js <container>:/app/
//   docker exec -e OKF_SMOKE_TOKEN_ADMIN=<...> <container> node /app/run-smoke-split.js

const dbService = require('./shared-lib/db-connection-service');
const conceptMetaService = require('./services/concept-meta-service');
const { workingGraphName } = require('./services/graph-lifecycle-service');

const BASE = process.env.OKF_SMOKE_BASE_URL || 'http://localhost:3002';
const TOKEN = process.env.OKF_SMOKE_TOKEN_ADMIN;
const REPO_NAME = 'smoke-split';
const DOMAIN = 'smoke';
const CEILING = Number(process.env.OKF_MAX_CONCEPT_DOC_CHARS || 250000);

let REPO_ID = null;
let SERVE_ID = null;
let failures = 0;
function pass(m) {
  console.log('PASS  ' + m);
}
function fail(m) {
  failures += 1;
  console.error('FAIL  ' + m);
}

async function call(method, url, body) {
  const res = await fetch(BASE + url, {
    method,
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined
  });
  let j = null;
  try {
    j = await res.json();
  } catch {
    /* non-json */
  }
  return { status: res.status, body: j };
}

async function aql(q, bind) {
  const db = await dbService.getConnection('default');
  return (await db.query(q, bind)).all();
}

async function rows(repoId) {
  return aql('FOR m IN okf_concepts_meta FILTER m.repo_id == @r SORT m.path RETURN m', { r: repoId });
}

function done() {
  console.log('');
  console.log(
    failures === 0
      ? 'SMOKE OK — the per-concept split holds: lossless, born-right, honest refusals.'
      : 'SMOKE FAILED — ' + failures + ' failure(s).'
  );
  process.exit(failures === 0 ? 0 : 1);
}

// Purge one of THIS harness's repos: delete → retract → delete → (if the
// blocker is the FABRICATED ingested_at stamp, which a draft-state repo
// cannot retract away) unstamp → delete. The unstamp branch only fires on
// repos whose ingested_at was fabricated by phase 5 — a real serving repo
// leaves through retract, never through the unstamp.
async function purgeRepo(repoId) {
  let d = await call('DELETE', `/api/okf/repos/${repoId}`);
  if (d.status === 409) {
    await call('POST', `/api/okf/repos/${repoId}/lifecycle`, { action: 'retract' });
    d = await call('DELETE', `/api/okf/repos/${repoId}`);
  }
  if (d.status === 409) {
    const db = await dbService.getConnection('default');
    await db.query('FOR r IN okf_repositories FILTER r.repo_id == @r UPDATE r WITH { ingested_at: null } IN okf_repositories', {
      r: repoId
    });
    d = await call('DELETE', `/api/okf/repos/${repoId}`);
  }
  return d;
}

async function main() {
  if (!TOKEN) {
    console.error('OKF_SMOKE_TOKEN_ADMIN required');
    process.exit(1);
  }
  console.log('OKF split smoke — ceiling in force: ' + CEILING);
  console.log('');

  // ── 0. Cleanup prior runs (name AND domain, per #1596) ───────────────────
  // BOTH names this harness creates: the main repo and the serving-fence
  // repo (REPO_NAME + '-serving') — a leftover serving repo 409s the create.
  try {
    const stale = await call('GET', '/api/okf/repos?lifecycle=all');
    for (const it of (stale.body && (stale.body.items || stale.body.repos)) || []) {
      const wanted = it.name === REPO_NAME || it.name === REPO_NAME + '-serving';
      if (!wanted || it.domain !== DOMAIN) continue;
      const d = await purgeRepo(it.repo_id);
      console.log('cleanup: ' + it.repo_id + ' → ' + d.status);
    }
  } catch {
    /* best-effort */
  }

  // ── 1. Repo 1: index + a small topic, then a LEGACY over-ceiling row ──────
  // Seeded straight into okf_concepts_meta (the legacy-import case): /import
  // would split it, and the editor refuses the over-ceiling save — the direct
  // row is exactly the state a curator faces on old corpora.
  const created = await call('POST', '/api/okf/repos', {
    name: REPO_NAME,
    domain: DOMAIN,
    acl: { required_scopes: ['okf:t:smoke:admin'] },
    lifecycle_state: 'draft'
  });
  if (created.status !== 201 || !created.body.repo_id) {
    fail('create → ' + created.status + ' ' + JSON.stringify(created.body));
    return done();
  }
  REPO_ID = created.body.repo_id;
  pass('create → 201 draft (repo_id ' + REPO_ID + ')');

  const alphaBody = '# Alpha\n\nA small topic body, well within the ceiling.\n';
  const imp = await call('POST', `/api/okf/repos/${REPO_ID}/import`, {
    concepts: [
      {
        path: 'index.md',
        frontmatter: { type: 'index', title: REPO_NAME, sources: [] },
        body: '# ' + REPO_NAME + '\n\n## Contents\n\n'
      },
      { path: 'alpha.md', frontmatter: { type: 'topic', title: 'Alpha', sources: [] }, body: alphaBody }
    ]
  });
  imp.status === 200 || imp.status === 201 || imp.status === 202
    ? pass('import index + alpha → ' + imp.status)
    : fail('import → ' + imp.status + ' ' + JSON.stringify(imp.body));

  const seedSources = [{ kind: 'document', resource: 'https://smoke.example/big-doc', file_id: 'smoke-f-1' }];
  const sections = [];
  for (let i = 0; i < 6; i += 1) sections.push('## Section ' + i + '\n\n' + 'lorem ipsum dolor sit amet '.repeat(1852));
  const bigBody = sections.join('\n\n');
  const seeded = await conceptMetaService.upsertConceptMeta(REPO_ID, {
    concept_id: 'legacy-big',
    path: 'docs/legacy-big.md',
    frontmatter: { type: 'topic', title: 'Legacy big', tags: ['smoke'] },
    body: bigBody,
    sources: seedSources,
    links: [{ to_concept_id: 'alpha', label: 'Alpha' }],
    trust_tier: 'curated'
  });
  seeded ? pass('seeded the over-ceiling legacy row (' + bigBody.length + ' characters)') : fail('seed failed');
  const beforeRows = await rows(REPO_ID);
  const countBefore = beforeRows.length;

  // ── 2. THE SPLIT: 200, lossless, ceiling-bounded ─────────────────────────
  const repoDoc = (await aql('FOR r IN okf_repositories FILTER r.repo_id == @r RETURN r', { r: REPO_ID }))[0];
  const expectedGraph = workingGraphName(repoDoc);

  const split = await call('POST', `/api/okf/repos/${REPO_ID}/concepts/legacy-big/split`, {});
  if (split.status !== 200 || !split.body || !split.body.ok) {
    fail('split → ' + split.status + ' ' + JSON.stringify(split.body).slice(0, 250) + ' (expected 200 ok)');
    return done();
  }
  const parts = split.body.parts || [];
  parts.length > 1
    ? pass('split → 200 ok: ' + parts.length + ' parts (created ' + split.body.created + ', updated ' + split.body.updated + ')')
    : fail('split produced ' + parts.length + ' parts — expected more than one');
  split.body.created === parts.length - 1 && split.body.updated === 1
    ? pass('  the summary counts part 1 as updated and the rest as created')
    : fail('  summary counts: created ' + split.body.created + ', updated ' + split.body.updated);
  split.body.ceiling === CEILING
    ? pass('  the answer carries the ceiling (' + CEILING + ')')
    : fail('  ceiling echo: ' + JSON.stringify(split.body.ceiling));

  // Rejoin THROUGH THE API: part 1 keeps 'legacy-big', parts 2..N -part-N.
  let rejoined = '';
  let maxChars = 0;
  for (let i = 0; i < parts.length; i += 1) {
    const pid = i === 0 ? 'legacy-big' : 'legacy-big-part-' + (i + 1);
    const got = await call('GET', `/api/okf/repos/${REPO_ID}/concepts/${encodeURIComponent(pid)}`);
    if (got.status !== 200 || typeof got.body.body !== 'string') {
      fail('  part ' + pid + ' GET → ' + got.status + ' ' + JSON.stringify(got.body).slice(0, 120));
      rejoined += '\n';
      continue;
    }
    rejoined += (i > 0 ? '\n' : '') + got.body.body;
    maxChars = Math.max(maxChars, got.body.body.length);
  }
  rejoined === bigBody
    ? pass('  THE parts rejoin the original body byte-for-byte (' + bigBody.length + ' characters)')
    : fail('  the rejoin DIFFERS: original ' + bigBody.length + ' chars, rejoined ' + rejoined.length + ' chars');
  maxChars <= CEILING
    ? pass('  every part fits the ceiling (largest ' + maxChars + ')')
    : fail('  a part EXCEEDS the ceiling: ' + maxChars);

  // ── 3. Born-right rows + identity + PII, straight from the corpus ────────
  const afterRows = await rows(REPO_ID);
  const partRows = afterRows.filter((m) => m.concept_id === 'legacy-big' || /^legacy-big-part-\d+$/.test(m.concept_id));
  partRows.length === parts.length
    ? pass('  the corpus holds exactly ' + partRows.length + ' part rows')
    : fail('  expected ' + parts.length + ' part rows, found ' + partRows.length + ': ' + JSON.stringify(partRows.map((m) => m.concept_id)));

  const notParsed = partRows.filter((m) => m.index_status !== 'parsed');
  notParsed.length === 0
    ? pass('  every part row is born index_status=parsed (drains immediately)')
    : fail('  part rows NOT parsed: ' + JSON.stringify(notParsed.map((m) => [m.concept_id, m.index_status])));
  const wrongGraph = partRows.filter((m) => m.graph_name !== expectedGraph);
  wrongGraph.length === 0
    ? pass('  every part row carries the CURRENT graph name (' + expectedGraph + ')')
    : fail('  stale graph stamps: ' + JSON.stringify(wrongGraph.map((m) => [m.concept_id, m.graph_name])));

  const p1 = partRows.find((m) => m.concept_id === 'legacy-big');
  const p2 = partRows.find((m) => m.concept_id === 'legacy-big-part-2');
  p1 && p1.path === 'docs/legacy-big.md' && p1.frontmatter && p1.frontmatter.title === 'Legacy big'
    ? pass('  part 1 keeps the original path and title (inbound links keep resolving)')
    : fail('  part 1 identity drifted: ' + JSON.stringify(p1 && { path: p1.path, title: p1.frontmatter && p1.frontmatter.title }));
  p2 && p2.path === 'docs/legacy-big-part-2.md' && p2.frontmatter && p2.frontmatter.title === 'Legacy big — part 2'
    ? pass('  part 2 carries the -part-2 path and the " — part 2" title')
    : fail('  part 2 identity: ' + JSON.stringify(p2 && { path: p2.path, title: p2.frontmatter && p2.frontmatter.title }));

  const sourcesDrift = partRows.filter((m) => JSON.stringify(m.sources || []) !== JSON.stringify(seedSources));
  sourcesDrift.length === 0
    ? pass('  every part carries sources[] UNCHANGED (provenance is not partitioned)')
    : fail('  sources drifted on: ' + JSON.stringify(sourcesDrift.map((m) => m.concept_id)));

  const unscanned = partRows.filter((m) => !m.pii_state);
  unscanned.length === 0
    ? pass('  every part row carries a pii_state (the per-part scan ran)')
    : fail('  parts missing pii_state: ' + JSON.stringify(unscanned.map((m) => m.concept_id)));

  afterRows.length === countBefore + parts.length - 1
    ? pass('  the corpus grew by exactly parts-1 rows (the split replaced one concept)')
    : fail('  corpus size ' + countBefore + ' → ' + afterRows.length + ' (expected +' + (parts.length - 1) + ')');

  // ── 4. Honest refusals on repo 1 ──────────────────────────────────────────
  const within = await call('POST', `/api/okf/repos/${REPO_ID}/concepts/alpha/split`, {});
  within.status === 400 && within.body && within.body.error === 'CONCEPT_WITHIN_CEILING'
    ? pass('a within-ceiling concept → 400 CONCEPT_WITHIN_CEILING')
    : fail('within-ceiling split → ' + within.status + ' ' + JSON.stringify(within.body).slice(0, 200));
  const alphaAfter = await call('GET', `/api/okf/repos/${REPO_ID}/concepts/alpha`);
  alphaAfter.body && alphaAfter.body.body === alphaBody
    ? pass('  the refused within-ceiling split wrote NOTHING (alpha byte-identical)')
    : fail('  alpha changed: ' + JSON.stringify(alphaAfter.body && alphaAfter.body.body).slice(0, 120));

  const unsplittableBody = 'x'.repeat(CEILING + 500); // ONE line, no boundary
  await conceptMetaService.upsertConceptMeta(REPO_ID, {
    concept_id: 'legacy-oneline',
    path: 'docs/legacy-oneline.md',
    frontmatter: { type: 'topic', title: 'Legacy one-line' },
    body: unsplittableBody,
    sources: []
  });
  const countUnsplit = (await rows(REPO_ID)).length;
  const refused = await call('POST', `/api/okf/repos/${REPO_ID}/concepts/legacy-oneline/split`, {});
  if (refused.status === 409 && refused.body && refused.body.error === 'CONCEPT_TOO_LARGE') {
    pass('an unsplittable body → 409 CONCEPT_TOO_LARGE');
    const msg = String(refused.body.message || '');
    msg.indexOf(String(unsplittableBody.length)) !== -1
      ? pass('  the refusal names the size (' + unsplittableBody.length + ' characters)')
      : fail('  the refusal does not name the size: ' + msg.slice(0, 200));
    msg.indexOf(String(CEILING) + '-character ceiling') !== -1
      ? pass('  the refusal names the ceiling')
      : fail('  the refusal does not name the ceiling: ' + msg.slice(0, 200));
    /split|shorten|raise/i.test(msg)
      ? pass('  the refusal names a remedy')
      : fail('  the refusal names no remedy: ' + msg.slice(0, 200));
  } else {
    fail('unsplittable split → ' + refused.status + ' ' + JSON.stringify(refused.body).slice(0, 250));
  }
  const countAfter = (await rows(REPO_ID)).length;
  countAfter === countUnsplit
    ? pass('  the refused split wrote NOTHING (' + countAfter + ' rows before and after)')
    : fail('  the refused split CHANGED the corpus: ' + countUnsplit + ' → ' + countAfter);

  // ── 5. Repo 2: a SERVING repository refuses the split ─────────────────────
  // The fence (assertWritable) keys on the registry doc's ingested_at. A live
  // publish sets it only when the async RAG drain settles — minutes, model
  // services, non-deterministic. The smoke STAMPS the state directly (same
  // trick as the legacy corpus row: fabricate the exact state the fence
  // reads, deterministically) and asserts the fence holds against it.
  const serve = await call('POST', '/api/okf/repos', {
    name: REPO_NAME + '-serving',
    domain: DOMAIN,
    acl: { required_scopes: ['okf:t:smoke:admin'] },
    lifecycle_state: 'draft'
  });
  if (serve.status !== 201 || !serve.body.repo_id) {
    fail('setup: serving repo create → ' + serve.status);
  } else {
    SERVE_ID = serve.body.repo_id;
    const sImp = await call('POST', `/api/okf/repos/${SERVE_ID}/import`, {
      concepts: [
        {
          path: 'index.md',
          frontmatter: { type: 'index', title: 'serving', sources: [] },
          body: '# serving\n\n## Contents\n\n'
        },
        { path: 'beta.md', frontmatter: { type: 'topic', title: 'Beta', sources: [] }, body: '# Beta\n\nBody.\n' }
      ]
    });
    sImp.status === 200 || sImp.status === 201 || sImp.status === 202
      ? pass('serving-repo setup: corpus imported')
      : fail('serving-repo import → ' + sImp.status + ' ' + JSON.stringify(sImp.body));
    const db = await dbService.getConnection('default');
    await db.query(
      'FOR r IN okf_repositories FILTER r.repo_id == @r UPDATE r WITH { ingested_at: @now } IN okf_repositories',
      { r: SERVE_ID, now: new Date().toISOString() }
    );
    pass('serving-repo setup: ingested_at stamped (the state the write fence reads)');

    const ro = await call('POST', `/api/okf/repos/${SERVE_ID}/concepts/beta/split`, {});
    ro.status === 409 && ro.body && ro.body.error === 'REPO_READ_ONLY'
      ? pass('a SERVING repository refuses the split → 409 REPO_READ_ONLY')
      : fail('serving split → ' + ro.status + ' ' + JSON.stringify(ro.body).slice(0, 250));
    const betaAfter = await call('GET', `/api/okf/repos/${SERVE_ID}/concepts/beta`);
    betaAfter.body && betaAfter.body.body === '# Beta\n\nBody.\n'
      ? pass('  the refused split wrote NOTHING (beta byte-identical)')
      : fail('  beta changed: ' + JSON.stringify(betaAfter.body && betaAfter.body.body).slice(0, 120));
  }

  // ── 6. Cleanup ────────────────────────────────────────────────────────────
  for (const [label, id] of [
    ['main repo', REPO_ID],
    ['serving repo', SERVE_ID]
  ]) {
    if (!id) continue;
    const d = await purgeRepo(id);
    d.status === 200 || d.status === 202 || d.status === 204
      ? pass('cleanup: ' + label + ' removed (' + d.status + ')')
      : fail('cleanup: ' + label + ' delete → ' + d.status + ' ' + JSON.stringify(d.body).slice(0, 200));
  }

  return done();
}

main().catch((e) => {
  console.error('SMOKE ERROR', e && e.stack ? e.stack : e);
  process.exit(1);
});
