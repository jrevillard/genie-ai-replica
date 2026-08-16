// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// OKF partial smoke test: exercises the write-side control plane end-to-end
// against a real bundle WITHOUT the gated dataprep graph leg (2.9.6). Run
// INSIDE the okf-server container (has shared-lib + ArangoDB + pii-service
// reachability):
//   docker cp data/okf/smoke-test/kenya-bundle <container>:/app/kenya-bundle
//   docker cp data/okf/smoke-test/run-smoke.js <container>:/app/run-smoke.js
//   docker exec <container> node /app/run-smoke.js
//
// Exercised: parser (2.3) -> conformance (2.4) -> persistConformanceIssues
// (2.9.2 G9 REWIRED path) -> concepts-meta UPSERT writer -> PII scan + gate
// (2.8). Every assertion below is HARD: any failure exits non-zero.
//
// Success criteria (all must hold — smoke-test-integrity rule):
//   1. All 6 concepts parse WITH frontmatter (title + type present on the
//      5 conforming files — guards the escaped-fixture regression).
//   2. The 5 conforming files produce ZERO conformance issues.
//   3. bad_concept.md produces EXACTLY the two expected issues.
//   4. persistConformanceIssues (the G9 path) persists issues for every file;
//      metrics then read concept_count=6, conformance_issue_count=2 from live
//      Arango — non-tautological proof the writer wrote and metrics compute.
//   5. Every concept scans pii_state='clean' (fixtures are authored PII-free).
//   6. After markRepoPiiScanned, the publish gate is OPEN (blocked=false).

const fs = require('fs');
const path = require('path');
const parserService = require('./services/parser-service');
const conformanceService = require('./services/conformance-service');
const conceptMetaService = require('./services/concept-meta-service');
const piiService = require('./services/pii-service');
const dbService = require('./shared-lib/db-connection-service');

const BUNDLE_DIR = process.env.OKF_SMOKE_BUNDLE_DIR || '/app/kenya-bundle';
const REPO_ID = process.env.OKF_SMOKE_REPO_ID || 'smoke-kenya-repo-0001';
const EXPECTED_CONCEPTS = 6; // 5 conforming + bad_concept.md
const EXPECTED_ISSUES = 2; // MISSING_TYPE + BAD_ACTOR_PREFIX on bad_concept.md
const GOOD_FILES = [
  'index.md',
  'ecitizen_digital_payments.md',
  'huduma_kenya.md',
  'ministry_of_public_service.md',
  'service_directory.md'
];

let failures = 0;
function fail(msg) {
  failures += 1;
  console.error(`FAIL  ${msg}`);
}
function pass(msg) {
  console.log(`PASS  ${msg}`);
}

async function ensureRepoDoc(db) {
  const repos = db.collection('okf_repositories');
  try {
    await repos.document(REPO_ID);
  } catch (err) {
    if (!(err && (err.errorNum === 1204 || err.code === 404 || err.statusCode === 404))) throw err;
    await repos.save({
      _key: REPO_ID,
      repo_id: REPO_ID,
      name: 'Smoke Test Repo (run-smoke)',
      domain: 'smoke',
      graph_name: `OKF_${REPO_ID}`,
      okf_version: '0.2',
      lifecycle_state: 'register'
    });
  }
}

async function main() {
  const files = fs
    .readdirSync(BUNDLE_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();
  console.log(`OKF smoke test: bundle=${BUNDLE_DIR} concepts=${files.length} repo=${REPO_ID}`);
  if (files.length !== EXPECTED_CONCEPTS) {
    fail(`expected ${EXPECTED_CONCEPTS} concept files, found ${files.length}`);
    process.exit(1);
  }

  // 1-3: parse + conformance per file; frontmatter MUST parse.
  const perFile = [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(BUNDLE_DIR, file), 'utf8');
    const parsed = await parserService.parseConcept(raw, { repo_id: REPO_ID, path: file });
    const { issues } = conformanceService.validateConcept(parsed);
    const isGood = GOOD_FILES.includes(file);
    perFile.push({ file, parsed, issues, isGood });

    if (isGood) {
      if (!parsed.frontmatter || !parsed.frontmatter.title || !parsed.frontmatter.type) {
        fail(`${file}: frontmatter did NOT parse (title/type missing) — escaped-fixture regression`);
      }
      if (issues.length !== 0) {
        fail(`${file}: expected 0 conformance issues, got ${issues.length} (${issues.map((i) => i.code).join(',')})`);
      }
    }
  }
  const bad = perFile.find((p) => !p.isGood);
  if (!bad) {
    fail('bad_concept.md missing from bundle');
  } else {
    const codes = bad.issues.map((i) => i.code).sort();
    const expected = ['BAD_ACTOR_PREFIX', 'MISSING_TYPE'];
    if (JSON.stringify(codes) !== JSON.stringify(expected)) {
      fail(`bad_concept.md: expected issues ${expected.join('+')}, got [${codes.join(',')}]`);
    }
  }

  // 4: the G9 REWIRED path — persistConformanceIssues for EVERY file, then a
  // full writer upsert for each concept (the 4b -> 4c write-path order).
  for (const { parsed, issues } of perFile) {
    await conceptMetaService.upsertConceptMeta(REPO_ID, parsed); // 4b: full upsert
    await conformanceService.persistConformanceIssues(REPO_ID, parsed.concept_id, issues); // 4c: persist
  }
  const metrics = await conformanceService.getRepoMetrics(REPO_ID);
  console.log('Repo metrics:', JSON.stringify(metrics));
  if (metrics.concept_count !== EXPECTED_CONCEPTS) {
    fail(`metrics.concept_count: expected ${EXPECTED_CONCEPTS}, got ${metrics.concept_count}`);
  }
  if (metrics.conformance_issue_count !== EXPECTED_ISSUES) {
    fail(`metrics.conformance_issue_count: expected ${EXPECTED_ISSUES}, got ${metrics.conformance_issue_count}`);
  }

  // 5: PII scan every concept — fixtures are authored PII-free; 'clean' REQUIRED.
  for (const { parsed } of perFile) {
    const pii = await piiService.scanConcept(REPO_ID, parsed.concept_id, parsed.frontmatter, parsed.body);
    console.log(
      `  pii ${path.basename(parsed.path)}: state=${pii.pii_state}${pii.pii_hits_summary && Object.keys(pii.pii_hits_summary).length ? ' hits=' + JSON.stringify(pii.pii_hits_summary) : ''}`
    );
    if (pii.pii_state !== 'clean') {
      fail(
        `PII scan of ${parsed.path}: expected clean, got '${pii.pii_state}' (${JSON.stringify(pii.pii_hits_summary)})`
      );
    }
  }

  // 6: complete the repo scan + the publish gate MUST be OPEN.
  const db = await dbService.getConnection('default');
  await ensureRepoDoc(db);
  await piiService.markRepoPiiScanned(REPO_ID);
  const gate = await piiService.assertPiiClean(REPO_ID);
  console.log('PII publish gate:', JSON.stringify(gate));
  if (gate.blocked) {
    fail(`publish gate must be OPEN after a clean full scan; reasons: ${gate.reasons.join('; ')}`);
  }

  // 7 (Story 6.1): HTTP authz matrix against THIS server (localhost:3002).
  // Three tokens arrive via env (minted host-side; ROPC enable→mint→revert):
  //   OKF_SMOKE_TOKEN_SCOPED   — user with okf_scopes=[okf:smoke:{REPO_ID}:read]
  //   OKF_SMOKE_TOKEN_SCOPELESS — plain user, no okf scopes
  //   OKF_SMOKE_TOKEN_ADMIN    — genie-admin (wildcard attribute + tools-admin)
  // The phase is SKIPPED (with a notice) when no tokens are provided so the
  // control-plane phases stay runnable standalone.
  // 8 (Story 2.9.1): HTTP ingest via the orchestrator (needs tokens; skips standalone).
  await ingestPhase(db);

  await authzPhase(db);

  if (failures > 0) {
    console.error(`\nSMOKE TEST FAILED — ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nSMOKE TEST PASSED (control-plane: parser+conformance+persist+meta-writer+PII-gate, all asserted)');
  console.log('Note: the dataprep graph leg (bundle -> OKF_{repo_id} graph) is gated by 2.9.6 (OPEA 1.5 bump).');
  process.exit(0); // the db-connection cleanup timer keeps the loop alive otherwise
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.message);
  process.exit(1);
});

// ─── Story 6.1: HTTP authorization matrix ─────────────────────────────────────

async function authzPhase(db) {
  const SCOPED = process.env.OKF_SMOKE_TOKEN_SCOPED;
  const SCOPELESS = process.env.OKF_SMOKE_TOKEN_SCOPELESS;
  const ADMIN = process.env.OKF_SMOKE_TOKEN_ADMIN;
  if (!SCOPED || !SCOPELESS || !ADMIN) {
    console.log('NOTICE: authz phase skipped (no OKF_SMOKE_TOKEN_* env — run via the host mint script)');
    return;
  }
  const BASE = process.env.OKF_SMOKE_BASE_URL || 'http://localhost:3002';
  const OTHER_REPO = `${REPO_ID}-other`;
  const h = (t) => ({ Authorization: `Bearer ${t}`, 'Content-Type': 'application/json' });
  async function call(method, path, token, body) {
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers: h(token),
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

  // A second repo must EXIST (live — not soft-deleted) so "foreign but present"
  // is distinguishable from "missing" — both must 404 identically for the scoped
  // caller. Resurrected if a prior run soft-deleted it; removed at phase end.
  const repos = db.collection('okf_repositories');
  let otherLive = false;
  try {
    const existing = await repos.document(OTHER_REPO);
    if (existing.deleted_at) {
      await repos.update(OTHER_REPO, { deleted_at: null, name: 'Smoke Other Repo' });
    }
    otherLive = true;
  } catch (err) {
    if (err && (err.errorNum === 1204 || err.code === 404 || err.statusCode === 404)) {
      await repos.save({
        _key: OTHER_REPO,
        repo_id: OTHER_REPO,
        name: 'Smoke Other Repo',
        domain: 'smoke',
        graph_name: `OKF_${OTHER_REPO}`,
        okf_version: '0.2',
        lifecycle_state: 'register'
      });
      otherLive = true;
    } else throw err;
  }

  console.log('Authz matrix (Story 6.1):');
  // (a) scoped caller — read on REPO_ID only.
  const a1 = await call('GET', `/api/okf/repos/${REPO_ID}`, SCOPED);
  a1.status === 200
    ? pass(`scoped GET own repo → 200`)
    : fail(`scoped GET own repo → ${a1.status} ${JSON.stringify(a1.body).slice(0, 120)}`);
  const a2 = await call('GET', `/api/okf/repos/${OTHER_REPO}`, SCOPED);
  a2.status === 404
    ? pass('scoped GET foreign (existing) repo → 404 (anti-enumeration)')
    : fail(`scoped GET foreign repo → ${a2.status}`);
  const a3 = await call('GET', '/api/okf/repos', SCOPED);
  const ids = ((a3.body && a3.body.items) || []).map((i) => i.repo_id);
  a3.status === 200 && ids.includes(REPO_ID) && !ids.includes(OTHER_REPO)
    ? pass(`scoped LIST → own repo only (${ids.length} item(s))`)
    : fail(`scoped LIST → status=${a3.status} ids=${JSON.stringify(ids)}`);
  const a4 = await call('PATCH', `/api/okf/repos/${REPO_ID}`, SCOPED, { name: 'Should Not Apply' });
  a4.status === 403 && a4.body && a4.body.error === 'FORBIDDEN_SCOPE'
    ? pass('scoped PATCH own repo → 403 FORBIDDEN_SCOPE (read ≠ admin)')
    : fail(`scoped PATCH → ${a4.status} ${JSON.stringify(a4.body).slice(0, 120)}`);

  // (b) scopeless caller — default-deny at the router gate.
  const b1 = await call('GET', '/api/okf/repos', SCOPELESS);
  b1.status === 403 && b1.body && b1.body.error === 'FORBIDDEN_SCOPE'
    ? pass('scopeless LIST → 403 FORBIDDEN_SCOPE (default-deny)')
    : fail(`scopeless LIST → ${b1.status} ${JSON.stringify(b1.body).slice(0, 120)}`);

  // (e/f) admin — wildcard attribute (+ tools-admin): full visibility + mutation.
  const e1 = await call('GET', '/api/okf/repos', ADMIN);
  const adminIds = ((e1.body && e1.body.items) || []).map((i) => i.repo_id);
  e1.status === 200 && adminIds.includes(REPO_ID) && adminIds.includes(OTHER_REPO)
    ? pass('admin LIST → sees both repos (wildcard)')
    : fail(`admin LIST → ${e1.status} ids=${JSON.stringify(adminIds)}`);
  const e2 = await call('PATCH', `/api/okf/repos/${OTHER_REPO}`, ADMIN, { name: 'Smoke Other Repo (renamed)' });
  e2.status === 200
    ? pass('admin PATCH foreign repo → 200 (wildcard admin)')
    : fail(`admin PATCH → ${e2.status} ${JSON.stringify(e2.body).slice(0, 120)}`);

  // Cleanup: soft-delete the helper repo so the catalog is not polluted.
  if (otherLive) {
    await repos.update(OTHER_REPO, { deleted_at: new Date().toISOString() });
  }
}

// ─── Story 2.9.1: FULL-BUNDLE ingest phase (bundle → orchestrator → graph) ───
//
// Per the every-story smoke rule this phase grows with the ingest feature:
// it ingests the ENTIRE kenya bundle (all .md fixtures) through the real
// orchestrator endpoint, then — because the 2.9.4 worker does not exist yet —
// drains each enqueued concept SEQUENTIALLY via doc-repo's per-file ingest
// route (sequential by necessity: dataprep's single-flight 429 lock), and
// asserts chunks land in the graph per file.
//
// GRAPH BOUNDARY (honest): dataprep drops graph_name (G5) until Story 2.9.6
// (OPEA-bump gated) — chunks physically land in the DEFAULT GRAPH today. This
// phase asserts exactly that, and asserts every files doc carries
// graph_name=OKF_{repo} so 2.9.6 activates the split with zero changes here.

async function ingestPhase(db) {
  const ADMIN = process.env.OKF_SMOKE_TOKEN_ADMIN;
  const SCOPED = process.env.OKF_SMOKE_TOKEN_SCOPED;
  if (!ADMIN || !SCOPED) {
    console.log('NOTICE: ingest phase skipped (needs ADMIN+SCOPED tokens — run via mint-tokens.mjs)');
    return;
  }
  const matter = require('gray-matter');
  const BASE = process.env.OKF_SMOKE_BASE_URL || 'http://localhost:3002';
  const DOCREPO = process.env.OKF_SMOKE_DOCREPO_URL || 'http://document-repository:3001';
  // Must be a UUID — doc-repo's ingest-bundle validates repo_id:uuid().
  const INGEST_REPO = '99999999-9999-4999-8999-999999999999';
  const GRAPH = process.env.ARANGO_GRAPH_NAME || 'GRAPH';
  const h = (t) => ({ Authorization: 'Bearer ' + t, 'Content-Type': 'application/json' });
  async function call(method, url, token, body) {
    const res = await fetch(url, { method, headers: h(token), body: body ? JSON.stringify(body) : undefined });
    let j = null;
    try {
      j = await res.json();
    } catch {
      /* non-json */
    }
    return { status: res.status, body: j };
  }
  const aqlAll = async (query) => await (await db.query(query)).all();
  console.log('Ingest phase (Story 2.9.1 — FULL bundle):');

  // Repo for this phase (direct save — the controller gate needs it to exist;
  // unique (name,domain,deleted_at) → distinct name; resurrect if soft-deleted).
  const repos = db.collection('okf_repositories');
  let repoDoc = null;
  try {
    repoDoc = await repos.document(INGEST_REPO);
    if (repoDoc.deleted_at) {
      await repos.update(INGEST_REPO, { deleted_at: null, name: 'Smoke Ingest 291' });
      repoDoc = await repos.document(INGEST_REPO);
    }
  } catch (err) {
    if (err && (err.errorNum === 1204 || err.code === 404 || err.statusCode === 404)) {
      await repos.save({
        _key: INGEST_REPO,
        repo_id: INGEST_REPO,
        name: 'Smoke Ingest 291',
        domain: 'smoke',
        graph_name: 'OKF_' + INGEST_REPO,
        okf_version: '0.2',
        lifecycle_state: 'register'
      });
    } else throw err;
  }

  // RE-RUN SAFETY (review fix 10 — live-proven accumulation): a prior run's
  // files docs + meta rows MUST be removed at phase START or the pending-count
  // and meta-count assertions false-fail. Retract is best-effort (removes
  // chunks; a Pending/erroring retract is tolerated with a NOTE); the DELETE
  // is the load-bearing cleanup and is asserted.
  const priorFiles = await aqlAll(
    "FOR f IN files FILTER f.repo_id == '" + INGEST_REPO + "' RETURN KEEP(f, ['file_id','file_name','dataprep'])"
  );
  if (priorFiles.length > 0) {
    console.log('  cleanup: ' + priorFiles.length + ' prior-run files docs (retract best-effort + delete)');
    for (const f of priorFiles) {
      const retr = await call('POST', DOCREPO + '/api/files/' + f.file_id + '/retract', ADMIN);
      if (retr.status !== 200) {
        console.log(
          '    NOTE retract ' +
            f.file_name +
            ' -> ' +
            retr.status +
            ' (best-effort; was ' +
            (f.dataprep && f.dataprep.status) +
            ')'
        );
      }
      const del = await call('DELETE', DOCREPO + '/api/files/' + f.file_id, ADMIN);
      if (del.status !== 200 && del.status !== 404) {
        fail('cleanup DELETE ' + f.file_name + ' -> ' + del.status + ' ' + JSON.stringify(del.body).slice(0, 100));
      }
    }
  }
  const removedMeta = await aqlAll(
    "FOR d IN okf_concepts_meta FILTER d.repo_id == '" +
      INGEST_REPO +
      "' REMOVE d IN okf_concepts_meta RETURN OLD.concept_id"
  );
  if (removedMeta.length > 0) {
    console.log('  cleanup: removed ' + removedMeta.length + ' prior-run meta rows');
  }

  // (i) scoped READ caller → 403 (ingest is an admin mutation)
  const s1 = await call('POST', BASE + '/api/okf/repos/' + INGEST_REPO + '/ingest', SCOPED, {
    concepts: [{ frontmatter: { title: 'Nope' }, body: '# nope' }]
  });
  s1.status === 403 && s1.body && s1.body.error === 'FORBIDDEN_SCOPE'
    ? pass('ingest: scoped READ caller -> 403 FORBIDDEN_SCOPE')
    : fail('ingest scoped-read -> ' + s1.status + ' ' + JSON.stringify(s1.body).slice(0, 100));

  // (ii) FULL bundle through the orchestrator: every .md fixture, real
  // frontmatter (gray-matter — same lib the parser uses), path = file name so
  // concept ids match the control-plane phase.
  const bundleFiles = fs
    .readdirSync(BUNDLE_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const concepts = bundleFiles.map((f) => {
    const { data, content } = matter(fs.readFileSync(path.join(BUNDLE_DIR, f), 'utf8'));
    return { path: f, frontmatter: data, body: content.trim() };
  });
  const r1 = await call('POST', BASE + '/api/okf/repos/' + INGEST_REPO + '/ingest', ADMIN, {
    concepts,
    labels: ['Service Directory']
  });
  if (r1.status !== 202) {
    fail('ingest 202 expected, got ' + r1.status + ': ' + JSON.stringify(r1.body).slice(0, 220));
  } else {
    pass(
      'ingest admin -> 202 (total=' +
        r1.body.total +
        ', enqueued=' +
        r1.body.enqueued +
        ', pii.clean=' +
        r1.body.pii.clean +
        ')'
    );
    if (r1.body.total !== EXPECTED_CONCEPTS)
      fail('summary.total expected ' + EXPECTED_CONCEPTS + ', got ' + r1.body.total);
    if (r1.body.enqueued !== EXPECTED_CONCEPTS)
      fail('summary.enqueued expected ' + EXPECTED_CONCEPTS + ', got ' + r1.body.enqueued);
    if (r1.body.enqueue_errors.length !== 0)
      fail('unexpected enqueue_errors: ' + JSON.stringify(r1.body.enqueue_errors));
  }

  // (iii) meta rows for EVERY bundle concept: parsed + graph-stamped
  const metaRows = await aqlAll(
    "FOR d IN okf_concepts_meta FILTER d.repo_id == '" +
      INGEST_REPO +
      "' RETURN KEEP(d, ['concept_id','index_status','graph_name','pii_state','conformance_issues'])"
  );
  metaRows.length === EXPECTED_CONCEPTS
    ? pass('meta rows: ' + metaRows.length + '/' + EXPECTED_CONCEPTS + ' bundle concepts (4b)')
    : fail(
        'meta rows: expected ' +
          EXPECTED_CONCEPTS +
          ', got ' +
          metaRows.length +
          ' (' +
          JSON.stringify(metaRows.map((m) => m.concept_id)) +
          ')'
      );
  const allParsed = metaRows.every((m) => m.index_status === 'parsed' && m.graph_name === 'OKF_' + INGEST_REPO);
  allParsed
    ? pass('meta rows: all index_status=parsed + graph_name=OKF_{repo}')
    : fail('meta rows: not all parsed/graph-stamped: ' + JSON.stringify(metaRows));
  const badRow = metaRows.find((m) => m.concept_id === 'bad_concept');
  badRow && Array.isArray(badRow.conformance_issues) && badRow.conformance_issues.length === EXPECTED_ISSUES
    ? pass('meta rows: bad_concept carries exactly ' + EXPECTED_ISSUES + ' conformance issues (4c)')
    : fail('bad_concept conformance: ' + JSON.stringify(badRow && badRow.conformance_issues));
  const cleanPii = metaRows.filter((m) => m.pii_state === 'clean').length;
  cleanPii === EXPECTED_CONCEPTS
    ? pass('PII: all ' + EXPECTED_CONCEPTS + ' concepts clean (4d)')
    : fail('PII clean count: ' + cleanPii + '/' + EXPECTED_CONCEPTS);

  // (iv) per-concept files docs: Pending + graph + ACL labels (defer_kick)
  const fileDocs = await aqlAll(
    "FOR f IN files FILTER f.repo_id == '" +
      INGEST_REPO +
      "' SORT f.file_name RETURN KEEP(f, ['file_id','file_name','dataprep','graph_name','labels'])"
  );
  const pending = fileDocs.filter((f) => f.dataprep && f.dataprep.status === 'Pending');
  pending.length === EXPECTED_CONCEPTS
    ? pass('files docs: ' + pending.length + ' per-concept docs at Pending (4f + defer_kick)')
    : fail(
        'files docs at Pending: expected ' +
          EXPECTED_CONCEPTS +
          ', got ' +
          pending.length +
          ' (' +
          JSON.stringify(fileDocs.map((d) => d.dataprep && d.dataprep.status)) +
          ')'
      );
  const withAcl = pending.filter(
    (f) =>
      (f.labels || []).includes('t:smoke') &&
      (f.labels || []).includes('r:' + INGEST_REPO) &&
      (f.labels || []).includes('d:smoke') &&
      (f.labels || []).includes('Service Directory') &&
      f.graph_name === 'OKF_' + INGEST_REPO
  );
  withAcl.length === EXPECTED_CONCEPTS
    ? pass('files docs: ACL labels (t:/r:/d:) + caller label + graph_name stamped (sole injector)')
    : fail('files docs labels/graph: ' + JSON.stringify(pending.map((f) => [f.graph_name, f.labels])));

  // (v) DRAIN — the graph leg. The 2.9.4 worker does not exist yet, so the
  // smoke drains sequentially via doc-repo's per-file ingest route (admin
  // token; sequential because dataprep is single-flight 429). Each kick is
  // polled to a terminal status before the next.
  console.log('  draining ' + pending.length + ' concepts sequentially into the graph (this is the slow part)...');
  const statuses = {};
  for (const f of pending) {
    const kick = await call('POST', DOCREPO + '/api/files/' + f.file_id + '/ingest', ADMIN);
    if (kick.status !== 200) {
      fail('drain kick ' + f.file_name + ' -> ' + kick.status + ' ' + JSON.stringify(kick.body).slice(0, 120));
      statuses[f.file_id] = 'kick-failed';
      continue;
    }
    // Poll to terminal (Ingested | Ingestion Error | Killed), 8 min cap each.
    let st = null;
    for (let i = 0; i < 96; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const row = (
        await aqlAll(
          "FOR x IN files FILTER x.file_id == '" + f.file_id + "' RETURN KEEP(x, ['dataprep','chunk_count'])"
        )
      )[0];
      st = row && row.dataprep && row.dataprep.status;
      if (st === 'Ingested' || st === 'Ingestion Error' || st === 'Killed') {
        statuses[f.file_id] = st + ':' + (row.chunk_count || 0);
        break;
      }
    }
    if (!statuses[f.file_id]) statuses[f.file_id] = 'timeout:' + st;
    console.log('    ' + f.file_name + ' -> ' + statuses[f.file_id]);
    if (statuses[f.file_id].split(':')[0] !== 'Ingested') {
      fail('drain ' + f.file_name + ' ended "' + statuses[f.file_id] + '"');
    }
  }
  const ingestedIds = Object.keys(statuses).filter((k) => statuses[k].split(':')[0] === 'Ingested');
  ingestedIds.length === EXPECTED_CONCEPTS
    ? pass('drain: all ' + EXPECTED_CONCEPTS + ' bundle concepts Ingested (sequential, no 429 race)')
    : fail('drain: ' + ingestedIds.length + '/' + EXPECTED_CONCEPTS + ' Ingested');

  // (vi) CHUNKS IN THE GRAPH — the physical proof. Default GRAPH until 2.9.6.
  const chunkRows = await aqlAll(
    'FOR c IN ' +
      GRAPH +
      '_SOURCE FILTER c.file_id IN ' +
      JSON.stringify(ingestedIds) +
      ' COLLECT fid = c.file_id WITH COUNT INTO n RETURN {fid, n}'
  );
  chunkRows.length === ingestedIds.length && chunkRows.every((r) => r.n > 0)
    ? pass(
        'graph: chunks present for every ingested concept (' +
          chunkRows.map((r) => r.n).join('+') +
          ' chunks in ' +
          GRAPH +
          '_SOURCE)'
      )
    : fail('graph chunks: ' + JSON.stringify(chunkRows));
  const totalChunks = chunkRows.reduce((a, r) => a + r.n, 0);
  totalChunks >= EXPECTED_CONCEPTS
    ? pass('graph: total ' + totalChunks + ' chunks from the full bundle')
    : fail('graph total chunks: ' + totalChunks);
  console.log(
    '  NOTE: chunks land in the DEFAULT ' +
      GRAPH +
      ' graph — per-repo OKF_{repo_id} collections arrive with Story 2.9.6 (dataprep graph_name wiring, OPEA-bump gated).'
  );

  // (vii) re-ingest idempotency (meta not duplicated)
  const countQuery = "RETURN LENGTH(FOR d IN okf_concepts_meta FILTER d.repo_id == '" + INGEST_REPO + "' RETURN 1)";
  const beforeCount = (await aqlAll(countQuery))[0];
  const r2 = await call('POST', BASE + '/api/okf/repos/' + INGEST_REPO + '/ingest', ADMIN, { concepts });
  if (r2.status !== 202) {
    fail('re-ingest 202 expected, got ' + r2.status);
  } else {
    const afterCount = (await aqlAll(countQuery))[0];
    afterCount === beforeCount && beforeCount === EXPECTED_CONCEPTS
      ? pass('re-ingest: meta rows NOT duplicated (writer idempotency)')
      : fail('re-ingest meta rows: before=' + beforeCount + ' after=' + afterCount);
    r2.body.created === 0 && r2.body.updated === EXPECTED_CONCEPTS
      ? pass('re-ingest: summary updated=' + EXPECTED_CONCEPTS + ' (dedup rule intact pre-2.9.4)')
      : fail('re-ingest summary: ' + JSON.stringify(r2.body).slice(0, 140));
  }
}
