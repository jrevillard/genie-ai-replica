// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// OKF smoke test: exercises the write-side control plane end-to-end AND both
// ingestion facilities against a real bundle. Run INSIDE the okf-server
// container (has shared-lib + ArangoDB + pii-service + doc-repo reachability):
//   docker cp data/okf/smoke-test/kenya-bundle <container>:/app/kenya-bundle
//   docker cp data/okf/smoke-test/kenya-bundle.zip <container>:/app/kenya-bundle.zip
//   docker cp data/okf/smoke-test/run-smoke.js <container>:/app/run-smoke.js
//   docker exec -e OKF_SMOKE_TOKEN_*=<...> <container> node /app/run-smoke.js
//
// Exercised: parser (2.3) -> conformance (2.4) -> persistConformanceIssues
// (2.9.2 G9 REWIRED path) -> concepts-meta UPSERT writer -> PII scan + gate
// (2.8) -> 6.1 authz matrix -> 2.9.1 orchestrator (ZIP bundle + concepts[])
// -> dual-facility graphs: (A) the EXISTING single-document facility (upload →
// per-file ingest → default GRAPH) and (B) the OKF repository facility (zip →
// orchestrator → per-repo OKF_{repo_id} graph, Story 2.9.6 wiring).
// Every assertion below is HARD: any failure exits non-zero.
//
// TOKEN LIFETIME (live-proven pitfall): user tokens are 5-min TTL and the
// sequential drain takes ~10 min — all user-token calls run EARLY; the drain
// and cleanup use the okf-server SERVICE token (client_credentials —
// re-mintable without the ROPC window).
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
//   7. The 6.1 authz matrix holds (scoped read-only, default-deny, admin).
//   8. ZIP ingest: POST kenya-bundle.zip → 202 with total=6/parsed=6/enqueued=6;
//      6 meta rows parsed+graph-stamped; bad_concept carries 2 issues; PII clean;
//      6 per-concept files docs at Pending with t:/r:/d: ACL labels + graph_name.
//   9. concepts[] re-ingest is idempotent (meta rows NOT duplicated).
//  10. Facility A: single-doc upload (existing route) → Ingested → chunks in
//      the DEFAULT GRAPH. Facility B: zip bundle drains → chunks in
//      OKF_{repo_id}_SOURCE and NOT in the default graph (the split, 2.9.6).

const fs = require('fs');
const path = require('path');
const parserService = require('./services/parser-service');
const conformanceService = require('./services/conformance-service');
const conceptMetaService = require('./services/concept-meta-service');
const piiService = require('./services/pii-service');
const dbService = require('./shared-lib/db-connection-service');

const BUNDLE_DIR = process.env.OKF_SMOKE_BUNDLE_DIR || '/app/kenya-bundle';
const BUNDLE_ZIP = process.env.OKF_SMOKE_BUNDLE_ZIP || '/app/kenya-bundle.zip';
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
  // ORDER: the user-token phases run FIRST (tokens are 5-min TTL; the ~10-min
  // sequential drain at the end uses the re-mintable okf-server service token).
  await authzPhase(db);

  // 8 (Stories 2.9.1 + 2.9.5-zip + 2.9.6-graph, pulled forward 2026-08-16):
  // dual-facility ingest — (A) the EXISTING single-document facility (upload →
  // per-file ingest → default GRAPH) and (B) the OKF repository facility
  // (zipped kenya bundle → orchestrator → per-repo OKF_{repo_id} graph).
  await ingestPhase(db);

  if (failures > 0) {
    console.error(`\nSMOKE TEST FAILED — ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log(
    '\nSMOKE TEST PASSED (control-plane + 6.1 authz matrix + 2.9.1 orchestrator + zip bundle + dual-facility graphs, all asserted)'
  );
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

// ─── 2.9.1+: dual-facility ingest (existing single-doc + OKF zip bundle) ──────
//
// Per the every-story smoke rule this phase covers BOTH ingestion facilities:
//   A. the EXISTING single-document facility: doc-repo multipart upload (the
//      admin UI path) → per-file ingest kick → chunks in the DEFAULT graph.
//   B. the OKF repository facility: the FULL kenya bundle as a ZIP through the
//      orchestrator endpoint (one process, 202) → per-concept Pending files
//      docs → sequential drain (dataprep is single-flight) → chunks in the
//      per-repo OKF_{repo_id} graph (Story 2.9.6 graph_name wiring) and NOT in
//      the default graph.
// The 2.9.4 worker does not exist yet, so the drain is manual (the smoke stands
// in for it) using the okf-server SERVICE token — re-mintable client_credentials
// that outlive the 5-min user tokens (live-proven TTL pitfall).

const SINGLE_DOC_NAME = 'smoke-single-doc.md';
const SINGLE_DOC_BODY = `# Public Service Announcement (Smoke Fixture)

This single document exercises the EXISTING document ingestion facility:
a plain English markdown file uploaded through document-repository's standard
upload route and ingested into the default knowledge graph. It carries no OKF
frontmatter and belongs to no repository — it must land in the shared GRAPH
collections, distinct from OKF repository bundles which land in their own
per-repository graphs.

## Notes

- Facility A: single document, default graph.
- The OKF facility (zip bundles) is exercised separately by the same smoke run.
`;

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
  const OKF_GRAPH = 'OKF_' + INGEST_REPO;
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
  console.log('Ingest phase (2.9.1 orchestrator + zip bundle + dual-facility graphs):');

  // ── okf-server SERVICE token (client_credentials, re-mintable — no ROPC) ──
  let _svc = null;
  let _svcAt = 0;
  async function serviceToken() {
    // Re-mint at >3 min (realm TTL is 5 min — live-proven: a token cached longer
    // 401s mid-drain). NEVER hoist the result into a long-lived const.
    if (_svc && Date.now() - _svcAt < 180000) return _svc;
    const base = (
      process.env.KEYCLOAK_INTERNAL_URL ||
      process.env.KEYCLOAK_PUBLIC_URL ||
      'http://keycloak:8080'
    ).replace(/\/$/, '');
    const realm = process.env.KEYCLOAK_REALM || 'genie';
    const r = await fetch(`${base}/realms/${realm}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.KC_OKF_SERVER_CLIENT_ID || 'okf-server',
        client_secret: process.env.KC_OKF_SERVER_CLIENT_SECRET || ''
      })
    });
    if (!r.ok) throw new Error('service token mint failed: ' + r.status + ' ' + (await r.text()).slice(0, 120));
    const j = await r.json();
    _svc = j.access_token;
    _svcAt = Date.now();
    return _svc;
  }

  // The service token + its okf-service ROLE are load-bearing for the drain
  // (doc-repo ingest/retract allow okf-service) — assert them UP FRONT.
  const svc = await serviceToken();
  const svcList = await call('GET', DOCREPO + '/api/files', svc);
  svcList.status === 200
    ? pass('service token (okf-server client) authenticates against doc-repo')
    : fail('service token rejected by doc-repo: ' + svcList.status + ' ' + JSON.stringify(svcList.body).slice(0, 100));

  // Input-integrity negative check (design addendum D-V2): doc-repo REJECTS a
  // bundle whose graph_name does not belong to its repo (ownership mismatch —
  // live proof of the uniqueness guard).
  const own = await call('POST', DOCREPO + '/api/files/ingest-bundle', svc, {
    bundle: Buffer.from('# x').toString('base64'),
    graph_name: 'OKF_00000000-0000-4000-8000-000000000000',
    repo_id: INGEST_REPO,
    originalFileName: 'ownership-probe.md'
  });
  own.status === 400
    ? pass('integrity: doc-repo rejects graph_name != OKF_{repo_id} (ownership guard)')
    : fail('ownership guard: expected 400, got ' + own.status + ' ' + JSON.stringify(own.body).slice(0, 100));

  // ── re-run safety: retract + delete prior artifacts at phase START ──
  const priorFiles = await aqlAll(
    `FOR f IN files FILTER f.repo_id == '${INGEST_REPO}' || f.file_name == '${SINGLE_DOC_NAME}' RETURN KEEP(f, ['file_id','file_name','repo_id','dataprep'])`
  );
  if (priorFiles.length > 0) {
    console.log('  cleanup: ' + priorFiles.length + ' prior-run files docs (retract via service token + delete)');
    for (const f of priorFiles) {
      const retr = await call('POST', DOCREPO + '/api/files/' + f.file_id + '/retract', svc);
      if (retr.status === 403) {
        fail('retract as okf-service -> 403 (role wiring broken): ' + JSON.stringify(retr.body).slice(0, 100));
      } else if (retr.status !== 200) {
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
      await aqlAll("FOR x IN files FILTER x.file_id == '" + f.file_id + "' REMOVE x IN files");
    }
  }
  const removedMeta = await aqlAll(
    `FOR d IN okf_concepts_meta FILTER d.repo_id == '${INGEST_REPO}' REMOVE d IN okf_concepts_meta RETURN OLD.concept_id`
  );
  if (removedMeta.length > 0) {
    console.log('  cleanup: removed ' + removedMeta.length + ' prior-run meta rows');
  }

  // ── repo for this phase (direct save; resurrect if soft-deleted) ──
  // version: 1 pins the bundle_version thread (repo.version → meta rows) —
  // the version-tag integrity contract (title + version on every concept).
  const repos = db.collection('okf_repositories');
  try {
    const repoDoc = await repos.document(INGEST_REPO);
    const patch = { deleted_at: null, name: 'Smoke Ingest 291', version: 1 };
    if (repoDoc.deleted_at || repoDoc.version !== 1) {
      await repos.update(INGEST_REPO, patch);
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
        version: 1,
        lifecycle_state: 'register'
      });
    } else throw err;
  }

  // ── (i) scoped READ caller → 403 (ingest is an admin mutation) ──
  const zipB64 = fs.readFileSync(BUNDLE_ZIP).toString('base64');
  const s1 = await call('POST', BASE + '/api/okf/repos/' + INGEST_REPO + '/ingest', SCOPED, { zip: zipB64 });
  s1.status === 403 && s1.body && s1.body.error === 'FORBIDDEN_SCOPE'
    ? pass('ingest: scoped READ caller -> 403 FORBIDDEN_SCOPE (zip body)')
    : fail('ingest scoped-read -> ' + s1.status + ' ' + JSON.stringify(s1.body).slice(0, 100));

  // ── (ii) THE FULL KENYA BUNDLE AS A ZIP, through the orchestrator ──
  const r1 = await call('POST', BASE + '/api/okf/repos/' + INGEST_REPO + '/ingest', ADMIN, {
    zip: zipB64,
    labels: ['Service Directory']
  });
  if (r1.status !== 202) {
    fail('zip ingest 202 expected, got ' + r1.status + ': ' + JSON.stringify(r1.body).slice(0, 220));
  } else {
    pass(
      'zip ingest admin -> 202 (total=' +
        r1.body.total +
        ', parsed=' +
        r1.body.parsed +
        ', enqueued=' +
        r1.body.enqueued +
        ', pii.clean=' +
        r1.body.pii.clean +
        ')'
    );
    if (r1.body.total !== EXPECTED_CONCEPTS)
      fail('summary.total expected ' + EXPECTED_CONCEPTS + ', got ' + r1.body.total);
    if (r1.body.parsed !== EXPECTED_CONCEPTS)
      fail('summary.parsed expected ' + EXPECTED_CONCEPTS + ', got ' + r1.body.parsed);
    if (r1.body.enqueued !== EXPECTED_CONCEPTS)
      fail('summary.enqueued expected ' + EXPECTED_CONCEPTS + ', got ' + r1.body.enqueued);
    if (r1.body.enqueue_errors.length !== 0)
      fail('unexpected enqueue_errors: ' + JSON.stringify(r1.body.enqueue_errors));
    if (r1.body.success !== true) fail('summary.success expected true');
  }

  // ── (iii) meta rows for EVERY bundle concept: parsed + graph-stamped ──
  const metaRows = await aqlAll(
    "FOR d IN okf_concepts_meta FILTER d.repo_id == '" +
      INGEST_REPO +
      "' RETURN KEEP(d, ['concept_id','title','bundle_version','index_status','graph_name','pii_state','conformance_issues'])"
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
  // Title + version tag on EVERY concept — the ingestion-identity contract:
  // frontmatter title preserved and the repo's version threaded as
  // bundle_version (the version key the 2.9.7 manifests pin).
  const allTitled = metaRows.every((m) => typeof m.title === 'string' && m.title.length > 0);
  allTitled
    ? pass('meta rows: title present on every concept (frontmatter identity preserved)')
    : fail('meta rows missing title: ' + JSON.stringify(metaRows.map((m) => [m.concept_id, m.title])));
  const allVersioned = metaRows.every((m) => m.bundle_version === 1);
  allVersioned
    ? pass('meta rows: bundle_version=1 on every concept (repo.version threaded)')
    : fail('meta rows bundle_version: ' + JSON.stringify(metaRows.map((m) => [m.concept_id, m.bundle_version])));
  const allParsed = metaRows.every((m) => m.index_status === 'parsed' && m.graph_name === OKF_GRAPH);
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

  // ── (iv) per-concept files docs: Pending + graph + ACL labels (defer_kick) ──
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
      f.graph_name === OKF_GRAPH
  );
  withAcl.length === EXPECTED_CONCEPTS
    ? pass('files docs: ACL labels (t:/r:/d:) + caller label + graph_name stamped (sole injector)')
    : fail('files docs labels/graph: ' + JSON.stringify(pending.map((f) => [f.graph_name, f.labels])));

  // ── (v) FACILITY A: the EXISTING single-document upload (admin UI path) ──
  const fd = new FormData();
  fd.append('file', new Blob([SINGLE_DOC_BODY], { type: 'text/markdown' }), SINGLE_DOC_NAME);
  const upRes = await fetch(DOCREPO + '/api/files/upload', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + ADMIN },
    body: fd
  });
  let upBody = null;
  try {
    upBody = await upRes.json();
  } catch {
    /* non-json */
  }
  if (upRes.status !== 201) {
    fail('facility-A upload -> ' + upRes.status + ' ' + JSON.stringify(upBody).slice(0, 150));
  } else {
    pass('facility A: single-doc upload -> 201 (' + SINGLE_DOC_NAME + ')');
  }
  const singleFileId = upBody && upBody.data && (upBody.data.file_id || upBody.data.id);
  if (!singleFileId) {
    fail('facility A: no file_id in upload response: ' + JSON.stringify(upBody).slice(0, 150));
  } else {
    const singleDoc = (
      await aqlAll(
        "FOR f IN files FILTER f.file_id == '" +
          singleFileId +
          "' RETURN KEEP(f, ['file_name','graph_name','repo_id','dataprep'])"
      )
    )[0];
    singleDoc &&
    singleDoc.graph_name == null &&
    singleDoc.repo_id == null &&
    singleDoc.dataprep &&
    singleDoc.dataprep.status === 'Pending'
      ? pass('facility A: files doc Pending, NO graph_name/repo_id (default-graph facility — distinct from facility B)')
      : fail('facility A files doc: ' + JSON.stringify(singleDoc));
  }

  // ── (vi) concepts[] re-ingest: idempotency + the explicit-input surface ──
  const bundleFiles = fs
    .readdirSync(BUNDLE_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const concepts = bundleFiles.map((f) => {
    const { data, content } = matter(fs.readFileSync(path.join(BUNDLE_DIR, f), 'utf8'));
    return { path: f, frontmatter: data, body: content.trim() };
  });
  const countQuery = "RETURN LENGTH(FOR d IN okf_concepts_meta FILTER d.repo_id == '" + INGEST_REPO + "' RETURN 1)";
  const beforeCount = (await aqlAll(countQuery))[0];
  const r2 = await call('POST', BASE + '/api/okf/repos/' + INGEST_REPO + '/ingest', ADMIN, { concepts });
  if (r2.status !== 202) {
    fail('re-ingest 202 expected, got ' + r2.status);
  } else {
    const afterCount = (await aqlAll(countQuery))[0];
    afterCount === beforeCount && beforeCount === EXPECTED_CONCEPTS
      ? pass('re-ingest (concepts[]): meta rows NOT duplicated (writer idempotency)')
      : fail('re-ingest meta rows: before=' + beforeCount + ' after=' + afterCount);
    r2.body.created === 0 && r2.body.updated === EXPECTED_CONCEPTS
      ? pass('re-ingest (concepts[]): summary updated=' + EXPECTED_CONCEPTS + ' (dedup rule intact pre-2.9.4)')
      : fail('re-ingest summary: ' + JSON.stringify(r2.body).slice(0, 140));
  }

  // ── (vii) DRAIN — sequential (dataprep single-flight), SERVICE token ──
  // Facility A first (its per-file kick is the existing UI action), then the
  // OKF bundle's per-concept Pending docs (what the 2.9.4 worker will own).
  console.log(
    '  draining sequentially (facility A single doc + ' + pending.length + ' OKF concepts — the slow part)...'
  );
  const drainList = [{ file_id: singleFileId, file_name: SINGLE_DOC_NAME }].concat(pending).filter((x) => x.file_id);
  const statuses = {};
  for (const f of drainList) {
    const kick = await call('POST', DOCREPO + '/api/files/' + f.file_id + '/ingest', await serviceToken());
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
  const singleIngested = singleFileId && statuses[singleFileId] && statuses[singleFileId].split(':')[0] === 'Ingested';
  singleIngested ? pass('facility A: single doc Ingested (existing pipeline)') : fail('facility A drain failed');
  const okfIds = pending.map((p) => p.file_id);
  const okfIngested = okfIds.filter((k) => statuses[k] && statuses[k].split(':')[0] === 'Ingested');
  okfIngested.length === EXPECTED_CONCEPTS
    ? pass('facility B drain: all ' + EXPECTED_CONCEPTS + ' bundle concepts Ingested (sequential, no 429 race)')
    : fail('facility B drain: ' + okfIngested.length + '/' + EXPECTED_CONCEPTS + ' Ingested');

  // ── (viii) CHUNKS — the physical proof, per facility/graph ──
  // Facility A: default GRAPH. Facility B: the per-repo OKF_{repo_id} graph
  // (Story 2.9.6 wiring: doc-repo sends graph_name → dataprep writes the
  // per-repo collections) — and NOT in the default graph.
  const aChunks = (
    await aqlAll(
      'FOR c IN ' + GRAPH + "_SOURCE FILTER c.file_id == '" + singleFileId + "' COLLECT WITH COUNT INTO n RETURN n"
    )
  )[0];
  aChunks > 0
    ? pass('facility A graph: ' + aChunks + ' chunks in the DEFAULT ' + GRAPH + '_SOURCE')
    : fail('facility A: no chunks for ' + singleFileId + ' in ' + GRAPH + '_SOURCE');

  // The OKF graph name is hyphenated (OKF_<uuid>) — AQL needs backtick-quoted
  // identifiers for it (live-caught: unquoted → lexer error at the first '-').
  const bChunkRows = await aqlAll(
    'FOR c IN `' +
      OKF_GRAPH +
      '_SOURCE` FILTER c.file_id IN ' +
      JSON.stringify(okfIds) +
      ' COLLECT fid = c.file_id WITH COUNT INTO n RETURN {fid, n}'
  );
  bChunkRows.length === okfIds.length && bChunkRows.every((r) => r.n > 0)
    ? pass(
        'facility B graph: chunks present for EVERY bundle concept (' +
          bChunkRows.map((r) => r.n).join('+') +
          ' chunks in ' +
          OKF_GRAPH +
          '_SOURCE — per-repo graph created)'
      )
    : fail('facility B chunks in ' + OKF_GRAPH + '_SOURCE: ' + JSON.stringify(bChunkRows));
  const bTotal = bChunkRows.reduce((a, r) => a + r.n, 0);
  bTotal >= EXPECTED_CONCEPTS
    ? pass('facility B graph: total ' + bTotal + ' chunks from the full zip bundle')
    : fail('facility B total chunks: ' + bTotal);
  const leaked = (
    await aqlAll(
      'FOR c IN ' +
        GRAPH +
        '_SOURCE FILTER c.file_id IN ' +
        JSON.stringify(okfIds) +
        ' COLLECT WITH COUNT INTO n RETURN n'
    )
  )[0];
  (leaked || 0) === 0
    ? pass('isolation: ZERO OKF bundle chunks in the default ' + GRAPH + '_SOURCE (the graphs are split)')
    : fail('isolation broken: ' + leaked + ' OKF chunks found in default ' + GRAPH + '_SOURCE');

  console.log(
    '  NOTE: multi-graph READ (retriever fan-out over OKF_{repo_id} graphs) is Epic 1 — the retriever still queries the default graph until then.'
  );
}
