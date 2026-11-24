// OKF MOBILE CITIZEN-CONTRACT smoke (#1939, 2026-11-17):
//   "The three citizen reads a mobile browser consumes hold, live."
//
// The mobile app's concept-tree browser (#1939) generates its Dart models
// from the citizen surface (concept-tree, concept card, resolve-repo) and
// consumes it scopeless under the default-open posture. This harness proves
// the contract a phone will hit, LIVE, against a serving repository:
//
//   1. TREE PAGING. limit=2 over a 3-concept repo: first page 2 rows with
//      true total, second page 1 row, an out-of-range offset an empty page
//      with total still true (the mobile's Show-more boundary).
//
//   2. THE CITIZEN CARD. The card carries the CAP-2 projection (body, links,
//      CAP-4 sources) and NO steward field (max_doc_chars never crosses to
//      a scopeless caller — the fence that keeps steward data out of a
//      citizen-only Dart model).
//
//   3. RESOLVE-REPO. A concept resolves to its serving repo (the CAP-1
//      identity pair), and a concept nothing holds answers 404
//      CONCEPT_NOT_FOUND — foreign and fenced indistinguishable
//      (anti-enumeration survives the client too).
//
// Run INSIDE the okf-server container (same procedure as the other
// run-smoke*.js scripts). Provisioning follows the dev-harness precedent:
// the harness creates/publishes its own repo with the ADMIN token, stamps
// ingested_at (the split smoke's deterministic serving-fence precedent) and
// purges afterwards; the CITIZEN asserts run with the SCOPELESS token so the
// answer is exactly what a phone receives under the default-open posture.
//   docker cp data/okf/smoke-test/run-smoke-mobile-contract.js <container>:/app/
//   docker exec -e OKF_SMOKE_TOKEN_ADMIN=<...> -e OKF_SMOKE_TOKEN_SCOPELESS=<...> \
//     <container> node /app/run-smoke-mobile-contract.js

const dbService = require('./shared-lib/db-connection-service');
const piiService = require('./services/pii-service');

const BASE = process.env.OKF_SMOKE_BASE_URL || 'http://localhost:3002';
const ADMIN = process.env.OKF_SMOKE_TOKEN_ADMIN;
const CITIZEN = process.env.OKF_SMOKE_TOKEN_SCOPELESS;
const REPO_NAME = 'smoke-mobile-contract';
const DOMAIN = 'smoke';

let REPO_ID = null;
let failures = 0;
function pass(m) {
  console.log('PASS  ' + m);
}
function fail(m) {
  failures += 1;
  console.error('FAIL  ' + m);
}

async function call(method, url, body, token) {
  const res = await fetch(BASE + url, {
    method,
    headers: {
      Authorization: 'Bearer ' + (token || ADMIN),
      'Content-Type': 'application/json'
    },
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

function done() {
  console.log('');
  console.log(
    failures === 0
      ? 'SMOKE OK — the citizen contract the mobile browser consumes holds.'
      : 'SMOKE FAILED — ' + failures + ' failure(s).'
  );
  process.exit(failures === 0 ? 0 : 1);
}

async function main() {
  if (!ADMIN || !CITIZEN) {
    console.error('OKF_SMOKE_TOKEN_ADMIN and OKF_SMOKE_TOKEN_SCOPELESS required');
    process.exit(1);
  }
  console.log('OKF mobile citizen-contract smoke');
  console.log('');

  // ── 0. Cleanup a prior run (name AND domain — the #1596 rule) ─────────────
  try {
    const stale = await call('GET', '/api/okf/repos?lifecycle=all');
    for (const it of (stale.body && (stale.body.items || stale.body.repos)) || []) {
      if (it.name !== REPO_NAME || it.domain !== DOMAIN) continue;
      let d = await call('DELETE', `/api/okf/repos/${it.repo_id}`);
      if (d.status === 409) {
        await call('POST', `/api/okf/repos/${it.repo_id}/lifecycle`, { action: 'retract' });
        d = await call('DELETE', `/api/okf/repos/${it.repo_id}`);
      }
      console.log('cleanup: ' + it.repo_id + ' → ' + d.status);
    }
  } catch {
    /* best-effort — create will 409 loudly if it failed */
  }

  // ── 1. Provision a serving repo with three linked concepts ────────────────
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

  const imp = await call('POST', `/api/okf/repos/${REPO_ID}/import`, {
    concepts: [
      {
        path: 'alpha.md',
        frontmatter: {
          type: 'topic',
          title: 'A-alpha',
          sources: [{ kind: 'crawl', resource: 'https://example.gov/alpha' }],
          links: [{ target: './beta.md', label: 'Beta' }]
        },
        body: '# A-alpha\n\nAlpha body with a related concept.'
      },
      { path: 'beta.md', frontmatter: { type: 'topic', title: 'B-beta', sources: [] }, body: '# B-beta\n\nBeta body.' },
      {
        path: 'index.md',
        frontmatter: {
          type: 'index',
          title: 'C-index',
          sources: [],
          links: [
            { target: './alpha.md', label: 'Alpha' },
            { target: './beta.md', label: 'Beta' }
          ]
        },
        body: '# ' + REPO_NAME + '\n\n## Contents\n\n'
      }
    ]
  });
  imp.status === 200 || imp.status === 201 || imp.status === 202
    ? pass('import 3 concepts via /import → ' + imp.status)
    : fail('import → ' + imp.status + ' ' + JSON.stringify(imp.body));

  // The concept ids the import minted (path slugs are the ids in practice,
  // but the meta rows are the authority).
  const metas = await aql(
    'FOR m IN okf_concepts_meta FILTER m.repo_id == @r SORT m.title RETURN KEEP(m, ["concept_id", "title", "is_index"])',
    { r: REPO_ID }
  );
  const byTitle = Object.fromEntries((metas || []).map((m) => [m.title, m.concept_id]));
  const ALPHA_ID = byTitle['A-alpha'];
  (metas || []).length === 3 && ALPHA_ID
    ? pass('setup: 3 meta rows landed (alpha=' + ALPHA_ID + ')')
    : fail('setup: meta rows did not land: ' + JSON.stringify(metas));

  await piiService.markRepoPiiScanned(REPO_ID);
  let r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'submit' });
  r.status === 200 && r.body.lifecycle_state === 'review'
    ? pass('submit → review')
    : fail('submit → ' + r.status + ' ' + JSON.stringify(r.body));
  r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'approve' });
  r.status === 200 && r.body.lifecycle_state === 'approve'
    ? pass('approve → approve')
    : fail('approve → ' + r.status + ' ' + JSON.stringify(r.body));
  r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'publish' });
  r.status === 200 && r.body.lifecycle_state === 'publish'
    ? pass('publish → publish')
    : fail('publish → ' + r.status + ' ' + JSON.stringify(r.body));

  // The deterministic serving stamp (the split smoke's precedent): a publish
  // sets ingested_at only when the async RAG drain settles — the fence the
  // citizen reads is `publish + ingested_at`, so the harness stamps it
  // directly instead of racing the drain.
  await aql('FOR x IN okf_repositories FILTER x.repo_id == @r UPDATE x WITH { ingested_at: DATE_NOW() } IN okf_repositories', { r: REPO_ID });
  const serving = await aql('FOR x IN okf_repositories FILTER x.repo_id == @r RETURN { state: x.lifecycle_state, ingested: x.ingested_at != null }', { r: REPO_ID });
  serving[0] && serving[0].state === 'publish' && serving[0].ingested
    ? pass('setup: the repo is retrieval-serving (publish + ingested_at stamped)')
    : fail('setup: the serving stamp did not land: ' + JSON.stringify(serving));

  // ── 2. TREE PAGING, as the citizen ────────────────────────────────────────
  const page1 = await call('GET', `/api/okf/repos/${REPO_ID}/concept-tree?limit=2&offset=0`, null, CITIZEN);
  page1.status === 200 && page1.body && page1.body.total === 3 && Array.isArray(page1.body.concepts) && page1.body.concepts.length === 2
    ? pass('tree page 1 (limit 2): 2 rows, total 3')
    : fail('tree page 1 → ' + page1.status + ' ' + JSON.stringify(page1.body).slice(0, 250));
  page1.body && page1.body.concepts && page1.body.concepts[0] && page1.body.concepts[0].title === 'A-alpha'
    ? pass('  the rows carry the projected shape (title first: A-alpha)')
    : fail('  the row shape is wrong: ' + JSON.stringify((page1.body || {}).concepts || []).slice(0, 250));

  const page2 = await call('GET', `/api/okf/repos/${REPO_ID}/concept-tree?limit=2&offset=2`, null, CITIZEN);
  page2.status === 200 && page2.body && page2.body.total === 3 && page2.body.concepts.length === 1
    ? pass('tree page 2 (offset 2): 1 row, total 3')
    : fail('tree page 2 → ' + page2.status + ' ' + JSON.stringify(page2.body).slice(0, 250));

  const overflow = await call('GET', `/api/okf/repos/${REPO_ID}/concept-tree?limit=2&offset=999`, null, CITIZEN);
  overflow.status === 200 && overflow.body && overflow.body.total === 3 && overflow.body.concepts.length === 0
    ? pass('tree at an out-of-range offset: empty page, total still 3 (the Show-more boundary)')
    : fail('tree out-of-range → ' + overflow.status + ' ' + JSON.stringify(overflow.body).slice(0, 250));

  // ── 3. THE CITIZEN CARD, as the citizen ───────────────────────────────────
  const card = await call('GET', `/api/okf/repos/${REPO_ID}/concepts/${encodeURIComponent(ALPHA_ID)}`, null, CITIZEN);
  const b = card.body || {};
  card.status === 200 && typeof b.body === 'string' && b.title === 'A-alpha'
    ? pass('the citizen card answers (title, body)')
    : fail('card → ' + card.status + ' ' + JSON.stringify(b).slice(0, 250));
  !('max_doc_chars' in b) && !('meta' in b)
    ? pass('  the citizen card carries NO steward field (max_doc_chars absent)')
    : fail('  the card leaked a steward field: ' + JSON.stringify(Object.keys(b)));
  Array.isArray(b.links) && b.links.length >= 1
    ? pass('  the card carries author links (related concepts: ' + JSON.stringify(b.links) + ')')
    : fail('  the card lost its links: ' + JSON.stringify(b.links));
  Array.isArray(b.sources) && b.sources.length >= 1 && b.sources[0].resource === 'https://example.gov/alpha'
    ? pass('  the card carries the CAP-4 origin source (resource ' + b.sources[0].resource + ')')
    : fail('  the card lost its sources: ' + JSON.stringify(b.sources));

  // ── 4. RESOLVE-REPO, as the citizen ───────────────────────────────────────
  const resolved = await call('GET', `/api/okf/concepts/resolve-repo?concept_id=${encodeURIComponent(ALPHA_ID)}`, null, CITIZEN);
  resolved.status === 200 && resolved.body && resolved.body.repo_id === REPO_ID
    ? pass('resolve-repo → the serving repo (' + resolved.body.repo_id + ', bundle_version ' + JSON.stringify(resolved.body.bundle_version) + ')')
    : fail('resolve-repo → ' + resolved.status + ' ' + JSON.stringify(resolved.body));

  const missing = await call('GET', '/api/okf/concepts/resolve-repo?concept_id=no-such-concept-anywhere', null, CITIZEN);
  missing.status === 404 && missing.body && missing.body.error === 'CONCEPT_NOT_FOUND'
    ? pass('resolve-repo of a concept nothing holds → 404 CONCEPT_NOT_FOUND')
    : fail('resolve-repo missing → ' + missing.status + ' ' + JSON.stringify(missing.body));

  const fenced = await call('GET', '/api/okf/repos/00000000-0000-0000-0000-000000000000/concept-tree', null, CITIZEN);
  fenced.status === 404
    ? pass('a foreign repo answers the same 404 (anti-enumeration holds)')
    : fail('foreign repo → ' + fenced.status + ' (expected 404)');

  // ── 5. Cleanup ────────────────────────────────────────────────────────────
  let del = await call('DELETE', `/api/okf/repos/${REPO_ID}`);
  if (del.status === 409) {
    await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'retract' });
    del = await call('DELETE', `/api/okf/repos/${REPO_ID}`);
  }
  del.status === 200 || del.status === 202 || del.status === 204
    ? pass('cleanup: repo removed (' + del.status + ')')
    : fail('cleanup: repo delete → ' + del.status + ' ' + JSON.stringify(del.body).slice(0, 200));

  return done();
}

main().catch((e) => {
  console.error('SMOKE ERROR', e && e.stack ? e.stack : e);
  process.exit(1);
});
