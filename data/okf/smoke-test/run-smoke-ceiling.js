// OKF CONCEPT-DOCUMENT CEILING smoke (2026-11-06):
//   "No oversized concept may persist by any path."
//
// Three properties, each proven LIVE against a running deployment:
//
//   1. THE READ CARRIES THE SERVER'S CEILING. `GET /concepts/:id` answers
//      `max_doc_chars` — the editor's advisory rides it, so the number the
//      curator sees cannot contradict the number the server refuses on.
//
//   2. THE EDITOR SAVE REFUSES AN OVER-CEILING BODY, AND WRITES NOTHING.
//      A 409 CONCEPT_TOO_LARGE naming the size, the ceiling and the remedy;
//      the concept is byte-identical afterwards. The refusal is the R11
//      requirement the archived ceiling test plan recorded and never
//      implemented.
//
//   3. THE PUBLISH GATE REFUSES AN OVER-CEILING CORPUS, BEFORE THE MINT.
//      A corpus row written directly (the legacy-import case the gate is the
//      backstop for) blocks the publish with 409 CONCEPT_TOO_LARGE — and the
//      repo's version is NOT bumped, so the refusal burns no version number.
//
// Run INSIDE the okf-server container (same procedure as the other
// run-smoke*.js scripts):
//   docker cp data/okf/smoke-test/run-smoke-ceiling.js <container>:/app/
//   docker exec -e OKF_SMOKE_TOKEN_ADMIN=<...> <container> node /app/run-smoke-ceiling.js

const dbService = require('./shared-lib/db-connection-service');
const conceptMetaService = require('./services/concept-meta-service');
const piiService = require('./services/pii-service');

const BASE = process.env.OKF_SMOKE_BASE_URL || 'http://localhost:3002';
const TOKEN = process.env.OKF_SMOKE_TOKEN_ADMIN;
const REPO_NAME = 'smoke-ceiling';
const DOMAIN = 'smoke';
const CEILING = Number(process.env.OKF_MAX_CONCEPT_DOC_CHARS || 250000);

let REPO_ID = null; // the server mints the repo_id
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

async function repoDoc() {
  const rows = await aql('FOR r IN okf_repositories FILTER r.repo_id == @r RETURN r', { r: REPO_ID });
  return rows[0] || null;
}

function done() {
  console.log('');
  console.log(
    failures === 0
      ? 'SMOKE OK — the concept-document ceiling holds on every write path.'
      : 'SMOKE FAILED — ' + failures + ' failure(s).'
  );
  process.exit(failures === 0 ? 0 : 1);
}

async function main() {
  if (!TOKEN) {
    console.error('OKF_SMOKE_TOKEN_ADMIN required');
    process.exit(1);
  }
  console.log('OKF ceiling smoke — ceiling in force: ' + CEILING);
  console.log('');

  // ── 0. Cleanup a prior run ────────────────────────────────────────────────
  // A crashed prior run (token expiry mid-run) leaves the repo behind and
  // the next create 409s. Purge it first — and a repo in a non-deletable
  // state must be retracted before it can be deleted.
  try {
    const stale = await call('GET', '/api/okf/repos?lifecycle=all');
    for (const it of (stale.body && (stale.body.items || stale.body.repos)) || []) {
      if (it.name !== REPO_NAME) continue;
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

  // ── 1. A repo with two small concepts ─────────────────────────────────────
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
        path: 'index.md',
        frontmatter: {
          type: 'index',
          title: REPO_NAME,
          sources: [],
          links: [{ target: './alpha.md', label: 'Alpha' }]
        },
        body: '# ' + REPO_NAME + '\n\n## Contents\n\n'
      },
      { path: 'alpha.md', frontmatter: { type: 'topic', title: 'Alpha', sources: [] }, body: '# Alpha\n\nTopic body.' }
    ]
  });
  imp.status === 200 || imp.status === 201 || imp.status === 202
    ? pass('import 2 concepts via /import → ' + imp.status)
    : fail('import → ' + imp.status + ' ' + JSON.stringify(imp.body));

  const ids = await aql(
    'FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.is_index != true RETURN m.concept_id',
    { r: REPO_ID }
  );
  const CID = ids[0];
  if (!CID) {
    fail('setup: no topic concept found after import');
    return done();
  }

  // ── 2. The read carries the SERVER's ceiling ──────────────────────────────
  const got = await call('GET', `/api/okf/repos/${REPO_ID}/concepts/${encodeURIComponent(CID)}`);
  const carried = got.body && got.body.max_doc_chars;
  carried === CEILING
    ? pass('the concept read carries max_doc_chars=' + carried + " (the server's number, not a frontend copy)")
    : fail('max_doc_chars: expected ' + CEILING + ', got ' + JSON.stringify(carried) + ' (status ' + got.status + ')');

  // ── 3. The editor save refuses an over-ceiling body, and writes NOTHING ───
  const originalBody = got.body && got.body.body;
  const overBody = 'x'.repeat(CEILING + 1);
  const refused = await call('PATCH', `/api/okf/repos/${REPO_ID}/concepts/${encodeURIComponent(CID)}`, {
    body: overBody
  });

  if (refused.status === 409 && refused.body && refused.body.error === 'CONCEPT_TOO_LARGE') {
    pass('an over-ceiling body → 409 CONCEPT_TOO_LARGE');
    const msg = String(refused.body.message || '');
    const namesSize = msg.indexOf(String(CEILING + 1)) !== -1;
    const namesCeiling = msg.indexOf(String(CEILING) + '-character ceiling') !== -1;
    const namesRemedy = /split|shorten|raise/i.test(msg);
    namesSize
      ? pass('  the refusal names the size (' + (CEILING + 1) + ' characters)')
      : fail('  the refusal does not name the size: ' + msg.slice(0, 200));
    namesCeiling
      ? pass('  the refusal names the ceiling (' + CEILING + '-character ceiling)')
      : fail('  the refusal does not name the ceiling: ' + msg.slice(0, 200));
    namesRemedy ? pass('  the refusal names a remedy') : fail('  the refusal names no remedy: ' + msg.slice(0, 200));
  } else {
    fail(
      'an over-ceiling body → ' +
        refused.status +
        ' ' +
        JSON.stringify(refused.body).slice(0, 250) +
        ' (expected 409 CONCEPT_TOO_LARGE)'
    );
  }

  // THE load-bearing half: a refusal creates NO state.
  const after = await call('GET', `/api/okf/repos/${REPO_ID}/concepts/${encodeURIComponent(CID)}`);
  const afterBody = after.body && after.body.body;
  afterBody === originalBody
    ? pass('the refused save wrote NOTHING (the body is byte-identical afterwards)')
    : fail(
        'the refused save CHANGED the concept: body length ' +
          String(originalBody).length +
          ' → ' +
          String(afterBody).length
      );

  // …and the guard is not over-blocking: a body UNDER the ceiling still saves.
  const smallBody = '# Alpha\n\nA short edit.\n';
  const saved = await call('PATCH', `/api/okf/repos/${REPO_ID}/concepts/${encodeURIComponent(CID)}`, {
    body: smallBody
  });
  saved.status === 200 || saved.status === 204
    ? pass('a body UNDER the ceiling still saves → ' + saved.status)
    : fail('an under-ceiling save → ' + saved.status + ' ' + JSON.stringify(saved.body).slice(0, 200));

  // ── 4. The publish gate refuses an over-ceiling corpus, BEFORE the mint ───
  await piiService.markRepoPiiScanned(REPO_ID);

  let r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'submit' });
  r.status === 200 && r.body.lifecycle_state === 'review'
    ? pass('submit → review')
    : fail('submit → ' + r.status + ' ' + JSON.stringify(r.body));

  r = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'approve' });
  r.status === 200 && r.body.lifecycle_state === 'approve'
    ? pass('approve → approve')
    : fail('approve → ' + r.status + ' ' + JSON.stringify(r.body));

  // A LEGACY corpus row: written straight into okf_concepts_meta, bypassing
  // the editor guard — exactly how a document imported before the ceiling
  // existed (or re-ingested from a legacy source) reaches the corpus. The
  // publish gate is the backstop for that case.
  const legacyId = 'legacy-oversized';
  const legacyBody = 'y'.repeat(CEILING + 500);
  await conceptMetaService.upsertConceptMeta(REPO_ID, {
    concept_id: legacyId,
    path: 'concepts/' + legacyId + '.md',
    frontmatter: { type: 'topic', title: 'Legacy oversized' },
    body: legacyBody
  });
  const legacyRows = await aql(
    'FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.concept_id == @c RETURN { chars: LENGTH(m.body) }',
    { r: REPO_ID, c: legacyId }
  );
  legacyRows[0] && legacyRows[0].chars === legacyBody.length
    ? pass('setup: a legacy over-ceiling corpus row exists (' + legacyRows[0].chars + ' characters)')
    : fail('setup: the legacy row did not land: ' + JSON.stringify(legacyRows));

  const before = await repoDoc();
  const versionBefore = before ? before.version : null;

  const pub = await call('POST', `/api/okf/repos/${REPO_ID}/lifecycle`, { action: 'publish' });
  if (pub.status === 409 && pub.body && pub.body.error === 'CONCEPT_TOO_LARGE') {
    pass('publishing a repo holding an over-ceiling concept → 409 CONCEPT_TOO_LARGE');
    const msg = String(pub.body.message || '');
    msg.indexOf(legacyId) !== -1
      ? pass('  the refusal names the offending concept (' + legacyId + ')')
      : fail('  the refusal does not name the offender: ' + msg.slice(0, 200));
  } else {
    fail(
      'publish with an over-ceiling corpus → ' +
        pub.status +
        ' ' +
        JSON.stringify(pub.body).slice(0, 250) +
        ' (expected 409 CONCEPT_TOO_LARGE)'
    );
  }

  // THE load-bearing half: the refusal burned NO version.
  const after2 = await repoDoc();
  const versionAfter = after2 ? after2.version : null;
  versionAfter === versionBefore
    ? pass('the refused publish minted NOTHING (version still ' + JSON.stringify(versionAfter) + ')')
    : fail(
        'the refused publish BURNED a version: ' + JSON.stringify(versionBefore) + ' → ' + JSON.stringify(versionAfter)
      );

  const versions = await call('GET', `/api/okf/repos/${REPO_ID}/versions`);
  const vlist = (versions.body && (versions.body.versions || versions.body)) || [];
  (Array.isArray(vlist) ? vlist.length : 0) === 0
    ? pass('the refused publish stored no version')
    : fail('the refused publish stored a version: ' + JSON.stringify(vlist).slice(0, 200));

  // ── 5. The import SPLITS an over-ceiling document, AND REPORTS IT ─────────
  // The wizard reads `split_documents` from this answer and tells the
  // curator which file became how many concepts. If the server did not
  // report the split, a curator who picked a 260 000-character page would
  // watch it become several topics with no explanation at all — the split
  // would be invisible.
  //
  // A SEPARATE repository: the publish property above asserts on the FIRST
  // repo's concept set, and a split import must not be able to explain (or
  // mask) its refusal.
  const splitRepo = await call('POST', '/api/okf/repos', {
    name: REPO_NAME + '-split',
    domain: DOMAIN,
    acl: { required_scopes: ['okf:t:smoke:admin'] },
    lifecycle_state: 'draft'
  });
  if (splitRepo.status !== 201 || !splitRepo.body.repo_id) {
    fail('setup: the split repo could not be created → ' + splitRepo.status);
  } else {
    const splitId = splitRepo.body.repo_id;
    const sections = [];
    for (let i = 0; i < 6; i += 1) {
      sections.push('## Section ' + i + '\n\n' + 'lorem ipsum dolor sit amet '.repeat(1852));
    }
    const bigBody = sections.join('\n\n');
    const bigImp = await call('POST', `/api/okf/repos/${splitId}/import`, {
      concepts: [
        { path: 'big.md', frontmatter: { type: 'topic', title: 'Big', sources: [] }, body: bigBody }
      ]
    });
    const splits = (bigImp.body && bigImp.body.split_documents) || [];
    const entry = splits.find((s) => s && s.from === 'big.md');
    if (entry && entry.into > 1) {
      pass(
        'the import split the over-ceiling document and REPORTED it → ' +
          entry.into +
          ' parts (' +
          entry.chars +
          ' characters)'
      );
    } else {
      fail(
        'the import did not report the split: ' +
          JSON.stringify(splits).slice(0, 200) +
          ' (status ' +
          bigImp.status +
          ')'
      );
    }
    // …and the parts really landed as separate concepts.
    const landed = await aql(
      'FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.path LIKE "big%" RETURN m.concept_id',
      { r: splitId }
    );
    landed.length > 1
      ? pass('  the parts landed as ' + landed.length + ' concepts')
      : fail('  the split did not produce separate concepts: ' + JSON.stringify(landed));

    const delSplit = await call('DELETE', `/api/okf/repos/${splitId}`);
    delSplit.status === 200 || delSplit.status === 202 || delSplit.status === 204
      ? pass('cleanup: the split repo removed (' + delSplit.status + ')')
      : fail('cleanup: the split repo delete → ' + delSplit.status);
  }

  // ── 6. Cleanup ────────────────────────────────────────────────────────────
  // The delete is a SOFT delete: the server answers 202 with a purge date and
  // `status: "deleted"`. 409 is a refusal (the repo is still serving) — which
  // this phase never reaches, so it is a FAIL, not an accepted outcome.
  const del = await call('DELETE', `/api/okf/repos/${REPO_ID}`);
  del.status === 200 || del.status === 202 || del.status === 204
    ? pass('cleanup: repo removed (' + del.status + ')')
    : fail('cleanup: repo delete → ' + del.status + ' ' + JSON.stringify(del.body).slice(0, 200));

  return done();
}

main().catch((e) => {
  console.error('SMOKE ERROR', e && e.stack ? e.stack : e);
  process.exit(1);
});
