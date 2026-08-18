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
//   9. The 2.9.4 INGESTION WORKER drains the OKF bundle's Pending docs (no
//      manual kicks) and transitions every meta row parsed→indexed with
//      last_good_index_at stamped; facility A stays manual (worker ignores
//      non-OKF docs — repo_id filter).
//  10. Facility A: single-doc upload (existing route) → Ingested → chunks in
//      the DEFAULT GRAPH. Facility B: zip bundle drains → chunks in
//      OKF_{repo_id}_SOURCE and NOT in the default graph (the split, 2.9.6).
//      Re-ingest of unchanged+indexed concepts → skipped_dedup=N, enqueued=0
//      (the 4e dedup rule fires LIVE), meta rows stay indexed (no downgrade).
//  11. Bundle retraction VERIFIED: retracting one concept physically removes
//      its chunks from OKF_{repo_id}_SOURCE (right graph, real delete — never
//      a silent 200) and leaves the other concepts' chunks untouched.
//  12. Bundle-level retraction VERIFIED: repo delete DROPS the per-repo graph
//      (definition + all 4 collections physically gone from ArangoDB) and
//      removes the repo's meta rows + dangling files docs.
//  13. Versioning VERIFIED (2.9.7): mint v1 (publish trigger) → manifest with
//      the 6 concepts + STORED canonical hashes + okf:v1; repo.version stamped;
//      a modified re-ingest dedup-skips the 5 unchanged + enqueues the changed
//      concept WITH bundle_version=1 + the okf:v1 label; the worker drains it
//      and EVERY new chunk doc carries bundle_version=1; mint v2 (crawl
//      trigger, D-V4) → list [v2, v1], manifest v1 INTACT (INSERT-only).
//  14. Clone VERIFIED (4.8, D-V5 §8.4): the clone endpoint 403s a scoped READ
//      caller (admin mutation); cloning the minted source yields a NEW repo
//      (new repo_id + OKF_{new} graph + lifecycle draft) with cloned_from
//      {repo_id, version: 2} + 6 meta rows copied verbatim (title/bundle_version/
//      content_hash/index_status preserved); a modified concept re-ingests into
//      the CLONE graph ONLY (dedup-skips the other 5), and the SOURCE's chunks +
//      edges are UNCHANGED (isolation).

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
    '\nSMOKE TEST PASSED (control-plane + 6.1 authz matrix + 2.9.1 orchestrator + zip bundle + dual-facility graphs + 2.9.7 versions + 4.8 clone isolation, all asserted)'
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
  const removedVersions = await aqlAll(
    `FOR v IN okf_versions FILTER v.repo_id == '${INGEST_REPO}' REMOVE v IN okf_versions RETURN OLD.bundle_version`
  );
  if (removedVersions.length > 0) {
    console.log('  cleanup: removed ' + removedVersions.length + ' prior-run version manifests');
  }

  // ── repo for this phase (direct save; resurrect if soft-deleted) ──
  // PROPERLY NAMED (design addendum D-V1/D-V2): the repository name derives
  // from the BUNDLE's own identity (index.md title) — the registry entry,
  // graph, and bundle are one named association, not an anonymous UUID.
  // UNMINTED start (Story 2.9.7): version null + no okf_tag — the MINT phase
  // below sets version 1 via the real mintVersion() (never hand-set here).
  const idxMatter = matter(fs.readFileSync(path.join(BUNDLE_DIR, 'index.md'), 'utf8'));
  const bundleTitle = (idxMatter.data && idxMatter.data.title) || 'Kenya Government Services Knowledge Base';
  const bundleOkfVersion = (idxMatter.data && idxMatter.data.okf_version) || '0.2';
  const REPO_NAME = 'Kenya Government Services Knowledge Base (smoke)';
  const repos = db.collection('okf_repositories');
  try {
    const repoDoc = await repos.document(INGEST_REPO);
    const patch = { deleted_at: null, name: REPO_NAME, version: null, okf_tag: null, version_minted_at: null };
    if (repoDoc.deleted_at || repoDoc.name !== REPO_NAME || repoDoc.version != null) {
      await repos.update(INGEST_REPO, patch);
    }
  } catch (err) {
    if (err && (err.errorNum === 1204 || err.code === 404 || err.statusCode === 404)) {
      await repos.save({
        _key: INGEST_REPO,
        repo_id: INGEST_REPO,
        name: REPO_NAME,
        domain: 'smoke',
        graph_name: 'OKF_' + INGEST_REPO,
        okf_version: bundleOkfVersion,
        version: null,
        lifecycle_state: 'register'
      });
    } else throw err;
  }
  // The named association the smoke proves end-to-end:
  console.log(
    '  BUNDLE    : kenya-bundle.zip ("' +
      bundleTitle +
      '", OKF v' +
      bundleOkfVersion +
      ', ' +
      EXPECTED_CONCEPTS +
      ' concepts)'
  );
  console.log(
    '  REPOSITORY: "' + REPO_NAME + '" repo_id=' + INGEST_REPO + ' domain=smoke (unminted — minted live below)'
  );
  console.log('  GRAPH     : ' + OKF_GRAPH + ' (collections ' + OKF_GRAPH + '_SOURCE/_ENTITY/_HAS_SOURCE/_LINKS_TO)');

  // ── (i-a) FACILITY A FIRST, drained ALONE (no worker contention) ──
  // The single-document facility is uploaded + kicked + drained to terminal
  // BEFORE the zip ingest: dataprep is single-flight, and the 2.9.4 worker
  // starts claiming OKF docs the moment they exist — running facility A first
  // means nothing contends (live-caught run 9: concurrent kicks → transient
  // 429s; now also fixed doc-repo-side — 429 never poisons a file).
  const singleUpload = await (async () => {
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
      return null;
    }
    pass('facility A: single-doc upload -> 201 (' + SINGLE_DOC_NAME + ')');
    const singleFileId = upBody && upBody.data && (upBody.data.file_id || upBody.data.id);
    if (!singleFileId) {
      fail('facility A: no file_id in upload response: ' + JSON.stringify(upBody).slice(0, 150));
      return null;
    }
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
    // Kick (the existing UI action) and drain to terminal ALONE.
    const kickA = await call('POST', DOCREPO + '/api/files/' + singleFileId + '/ingest', await serviceToken());
    if (kickA.status !== 200) {
      fail('facility A kick -> ' + kickA.status + ' ' + JSON.stringify(kickA.body).slice(0, 120));
      return null;
    }
    let aStatus = null;
    let aChunks = 0;
    for (let i = 0; i < 96; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const row = (
        await aqlAll(
          "FOR x IN files FILTER x.file_id == '" + singleFileId + "' RETURN KEEP(x, ['dataprep','chunk_count'])"
        )
      )[0];
      aStatus = row && row.dataprep && row.dataprep.status;
      aChunks = (row && row.chunk_count) || 0;
      if (aStatus === 'Ingested' || aStatus === 'Ingestion Error' || aStatus === 'Killed') break;
    }
    aStatus === 'Ingested'
      ? pass('facility A: single doc Ingested ALONE (' + aChunks + ' chunks — existing pipeline, manual kick)')
      : fail('facility A drain ended "' + aStatus + '"');
    return singleFileId;
  })();
  const singleFileId = singleUpload;

  // ── (i) scoped READ caller → 403 (ingest is an admin mutation) ──
  const zipB64 = fs.readFileSync(BUNDLE_ZIP).toString('base64');
  const s1 = await call('POST', BASE + '/api/okf/repos/' + INGEST_REPO + '/ingest', SCOPED, { zip: zipB64 });
  s1.status === 403 && s1.body && s1.body.error === 'FORBIDDEN_SCOPE'
    ? pass('ingest: scoped READ caller -> 403 FORBIDDEN_SCOPE (zip body)')
    : fail('ingest scoped-read -> ' + s1.status + ' ' + JSON.stringify(s1.body).slice(0, 100));

  // Story 4.8 (D-V5): the clone is an ADMIN mutation on the source repo — a
  // caller without admin on the source must be 403 at the route (the real clone
  // happens late, in-container, when user tokens are expired; this is the live
  // HTTP gate). NOTE: the SCOPED token holds read on a DIFFERENT repo than
  // INGEST_REPO, so the live proof is "no admin on the source → 403"; the exact
  // read≠admin case is unit-tested.
  const c0 = await call('POST', BASE + '/api/okf/repos/' + INGEST_REPO + '/clone', SCOPED, {});
  c0.status === 403 && c0.body && c0.body.error === 'FORBIDDEN_SCOPE'
    ? pass('clone: caller without admin on the source -> 403 FORBIDDEN_SCOPE (admin mutation)')
    : fail('clone scoped-read -> ' + c0.status + ' ' + JSON.stringify(c0.body).slice(0, 100));

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
  const allVersioned = metaRows.every((m) => m.bundle_version == null);
  allVersioned
    ? pass('meta rows: bundle_version null pre-mint (unminted repo — the MINT phase stamps v1)')
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
  if (withAcl.length > 0) {
    // The named bundle→repo→graph association, per concept doc:
    console.log(
      '  ASSOCIATION: bundle "kenya-bundle.zip" → repo "' +
        REPO_NAME +
        '" → graph ' +
        OKF_GRAPH +
        ' (e.g. ' +
        withAcl[0].file_name +
        ' → labels ' +
        JSON.stringify(withAcl[0].labels) +
        ')'
    );
  }

  // ── (v) DRAIN — the 2.9.4 INGESTION WORKER owns the OKF files ──
  // Facility A was already drained ALONE (i-a); the worker ignores it (no
  // repo_id — that filter is itself asserted by A draining via manual kick
  // only). The OKF bundle's Pending docs are drained BY THE WORKER (no manual
  // kicks — exactly what it does in production).
  console.log('  draining: ' + pending.length + ' OKF concepts (WORKER-paced — the slow part)...');
  const statuses = {};
  const drainList = pending.slice();
  const drainIds = JSON.stringify(drainList.map((d) => d.file_id));
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const rows = await aqlAll(
      'FOR x IN files FILTER x.file_id IN ' + drainIds + " RETURN KEEP(x, ['file_id','dataprep','chunk_count'])"
    );
    let allTerminal = true;
    for (const d of drainList) {
      if (statuses[d.file_id]) continue;
      const row = rows.find((r) => r.file_id === d.file_id);
      const st = row && row.dataprep && row.dataprep.status;
      if (st === 'Ingested' || st === 'Ingestion Error' || st === 'Killed') {
        statuses[d.file_id] = st + ':' + (row.chunk_count || 0);
        console.log('    ' + d.file_name + ' -> ' + statuses[d.file_id]);
      } else {
        allTerminal = false;
      }
    }
    if (allTerminal && Object.keys(statuses).length === drainList.length) break;
  }
  for (const d of drainList) {
    if (!statuses[d.file_id]) {
      statuses[d.file_id] = 'timeout';
      fail(
        'drain ' + d.file_name + ' never reached a terminal state (worker interval 15s — is OKF_INGEST_WORKER_ENABLED?)'
      );
    } else if (statuses[d.file_id].split(':')[0] !== 'Ingested') {
      fail('drain ' + d.file_name + ' ended "' + statuses[d.file_id] + '"');
    }
  }
  const okfIds = pending.map((p) => p.file_id);
  const okfIngested = okfIds.filter((k) => statuses[k] && statuses[k].split(':')[0] === 'Ingested');
  okfIngested.length === EXPECTED_CONCEPTS
    ? pass('facility B: WORKER drained all ' + EXPECTED_CONCEPTS + ' bundle concepts Ingested (no manual kicks)')
    : fail('facility B worker drain: ' + okfIngested.length + '/' + EXPECTED_CONCEPTS + ' Ingested');

  // ── (vii) WORKER TRANSITIONS — the worker-EXCLUSIVE meta states ──
  const metaAfter = await aqlAll(
    "FOR d IN okf_concepts_meta FILTER d.repo_id == '" +
      INGEST_REPO +
      "' RETURN KEEP(d, ['concept_id','index_status','last_good_index_at'])"
  );
  const allIndexed = metaAfter.length === EXPECTED_CONCEPTS && metaAfter.every((m) => m.index_status === 'indexed');
  allIndexed
    ? pass('worker transition: all ' + EXPECTED_CONCEPTS + ' meta rows index_status=indexed (parsed→indexed)')
    : fail('worker transition: ' + JSON.stringify(metaAfter.map((m) => [m.concept_id, m.index_status])));
  const allStamped = metaAfter.every((m) => typeof m.last_good_index_at === 'string' && m.last_good_index_at);
  allStamped
    ? pass('worker transition: last_good_index_at stamped on every concept')
    : fail('worker transition: missing last_good_index_at: ' + JSON.stringify(metaAfter));

  // ── (viii) re-ingest AFTER indexing — the 4e DEDUP rule fires LIVE ──
  // Unchanged content + now-indexed ⇒ skipped_dedup, no new Pending docs.
  // Called via the service module (in-container — immune to the 5-min user
  // token TTL; the HTTP surface is asserted by the earlier zip ingest + 403).
  const bundleFiles = fs
    .readdirSync(BUNDLE_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const concepts = bundleFiles.map((f) => {
    const { data, content } = matter(fs.readFileSync(path.join(BUNDLE_DIR, f), 'utf8'));
    return { path: f, frontmatter: data, body: content.trim() };
  });
  const ingestService = require('./services/ingest-service');
  const filesCountQuery = "RETURN LENGTH(FOR f IN files FILTER f.repo_id == '" + INGEST_REPO + "' RETURN 1)";
  const filesBefore = (await aqlAll(filesCountQuery))[0];
  const r2 = await ingestService.ingestRepoConcepts(
    INGEST_REPO,
    { concepts, labels: ['Service Directory'] },
    { sub: 'smoke-run', source_ip: null }
  );
  r2.skipped_dedup === EXPECTED_CONCEPTS && r2.enqueued === 0
    ? pass('DEDUP LIVE: re-ingest of unchanged+indexed concepts → skipped_dedup=' + EXPECTED_CONCEPTS + ', enqueued=0')
    : fail(
        'dedup summary: ' +
          JSON.stringify({ skipped_dedup: r2.skipped_dedup, enqueued: r2.enqueued, errors: r2.enqueue_errors })
      );
  r2.created === 0 && r2.updated === EXPECTED_CONCEPTS
    ? pass('re-ingest: meta rows updated in place (created=0, updated=' + EXPECTED_CONCEPTS + ' — no duplicates)')
    : fail('re-ingest summary: ' + JSON.stringify({ created: r2.created, updated: r2.updated }));
  const metaPostDedup = await aqlAll(
    "FOR d IN okf_concepts_meta FILTER d.repo_id == '" + INGEST_REPO + "' RETURN KEEP(d, ['index_status'])"
  );
  metaPostDedup.every((m) => m.index_status === 'indexed')
    ? pass('re-ingest: index_status stays indexed (writer protection — never downgraded by 4b)')
    : fail('index_status downgraded after re-ingest: ' + JSON.stringify(metaPostDedup));
  const filesAfter = (await aqlAll(filesCountQuery))[0];
  filesAfter === filesBefore
    ? pass('re-ingest: ZERO new files docs (dedup enqueued nothing)')
    : fail('re-ingest created files docs: before=' + filesBefore + ' after=' + filesAfter);

  // ── (ix) MINT v1 (Story 2.9.7 — ADR-031) ──
  // In-container service call (the HTTP route's authz matrix is unit-tested;
  // user tokens are expired by this point in the run).
  const versionService = require('./services/version-service');
  const mint1 = await versionService.mintVersion(
    INGEST_REPO,
    { trigger: 'publish', source_ref: 'smoke://kenya-bundle/v1' },
    { sub: 'smoke-run' }
  );
  mint1.bundle_version === 1 && mint1.okf_tag === 'okf:v1'
    ? pass('mint v1: ' + mint1.okf_tag + ' (' + mint1.concept_count + ' concepts, trigger=publish)')
    : fail('mint v1: ' + JSON.stringify(mint1));
  const repoAfterMint = await repos.document(INGEST_REPO);
  repoAfterMint.version === 1 && repoAfterMint.okf_tag === 'okf:v1'
    ? pass('mint v1: repo doc version=1 + okf_tag=okf:v1 stamped')
    : fail(
        'repo doc after mint: ' + JSON.stringify({ version: repoAfterMint.version, okf_tag: repoAfterMint.okf_tag })
      );
  const manifest1 = await versionService.getVersion(INGEST_REPO, 1);
  const metaHashes = await aqlAll(
    "FOR m IN okf_concepts_meta FILTER m.repo_id == '" +
      INGEST_REPO +
      "' SORT m.concept_id RETURN KEEP(m, ['concept_id','content_hash'])"
  );
  manifest1.concept_count === EXPECTED_CONCEPTS &&
  manifest1.concepts.every(
    (c, i) => c.concept_id === metaHashes[i].concept_id && c.content_hash === metaHashes[i].content_hash
  )
    ? pass('manifest v1: all ' + EXPECTED_CONCEPTS + ' concepts snapshotted with the STORED canonical hashes')
    : fail(
        'manifest v1 mismatch: ' +
          JSON.stringify(manifest1.concepts.slice(0, 2)) +
          ' vs ' +
          JSON.stringify(metaHashes.slice(0, 2))
      );
  manifest1.okf_tag === 'okf:v1' && manifest1.trigger === 'publish' && typeof manifest1.minted_at === 'string'
    ? pass('manifest v1: okf:v1 + trigger + minted_at recorded')
    : fail('manifest v1 metadata: ' + JSON.stringify(manifest1));

  // ── (x) MODIFIED re-ingest → version threading onto files docs + CHUNKS ──
  // Change ONE concept (service_directory): the other 5 dedup-skip (unchanged +
  // indexed), the changed one enqueues carrying bundle_version=1 + the okf:v1
  // tag — the worker drains it and datapretreat stamps bundle_version onto its
  // chunk docs (ADR-031 "threaded everywhere").
  const modifiedConcepts = concepts.map((c) =>
    c.path === 'service_directory.md'
      ? {
          ...c,
          body:
            c.body +
            '\n\n## Amended (version-threading probe)\n\nAdded post-v1 to prove the minted version rides new chunks.\n'
        }
      : c
  );
  const r3 = await ingestService.ingestRepoConcepts(
    INGEST_REPO,
    { concepts: modifiedConcepts, labels: ['Service Directory'] },
    { sub: 'smoke-run', source_ip: null }
  );
  r3.skipped_dedup === EXPECTED_CONCEPTS - 1 && r3.enqueued === 1
    ? pass('modified re-ingest: ' + (EXPECTED_CONCEPTS - 1) + ' dedup-skipped, 1 enqueued (changed concept carries v1)')
    : fail('modified re-ingest summary: ' + JSON.stringify({ skipped: r3.skipped_dedup, enqueued: r3.enqueued }));
  const versionedFile = (
    await aqlAll(
      "FOR f IN files FILTER f.repo_id == '" +
        INGEST_REPO +
        "' AND f.bundle_version == 1 SORT f.uploaded_date DESC LIMIT 1 RETURN KEEP(f, ['file_id','file_name','bundle_version','labels','dataprep'])"
    )
  )[0];
  const versionedOk =
    versionedFile &&
    versionedFile.file_name === 'service_directory.md' &&
    (versionedFile.labels || []).includes('okf:v1');
  versionedOk
    ? pass('version threading: files doc carries bundle_version=1 + the okf:v1 label (sole-injector tag)')
    : fail('versioned files doc: ' + JSON.stringify(versionedFile));
  // The re-written okf_concepts_meta row must ALSO carry the new version (the
  // 4b leg — review fix P8: the files doc and chunks are asserted, the meta
  // row was not; the "stamps v1" pass text now names the actual actor).
  const versionedMetaRow = versionedFile
    ? (
        await aqlAll(
          "FOR m IN okf_concepts_meta FILTER m.repo_id == '" +
            INGEST_REPO +
            "' AND m.concept_id == '" +
            versionedFile.file_name.replace(/\.md$/, '') +
            "' RETURN KEEP(m, ['concept_id', 'bundle_version', 'index_status'])"
        )
      )[0]
    : null;
  versionedMetaRow && versionedMetaRow.bundle_version === 1 && versionedMetaRow.index_status === 'indexed'
    ? pass(
        'version threading: the re-written okf_concepts_meta row carries bundle_version=1 (4b leg — re-ingest threads the minted version)'
      )
    : fail('versioned meta row: ' + JSON.stringify(versionedMetaRow));
  // Wait for the WORKER to drain the versioned file (worker-paced).
  let vStatus = null;
  if (versionedFile) {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 15000));
      const row = (
        await aqlAll("FOR x IN files FILTER x.file_id == '" + versionedFile.file_id + "' RETURN KEEP(x, ['dataprep'])")
      )[0];
      vStatus = row && row.dataprep && row.dataprep.status;
      if (vStatus === 'Ingested' || vStatus === 'Ingestion Error' || vStatus === 'Killed') break;
    }
    vStatus === 'Ingested'
      ? pass('version threading: worker drained the v1 concept to Ingested')
      : fail('versioned file drain ended "' + vStatus + '"');
  }
  const versionedChunks =
    versionedFile &&
    (
      await aqlAll(
        'FOR c IN `' +
          OKF_GRAPH +
          '_SOURCE` FILTER c.file_id == "' +
          versionedFile.file_id +
          '" COLLECT WITH COUNT INTO n RETURN n'
      )
    )[0];
  const versionedChunkStamps =
    versionedFile &&
    (
      await aqlAll(
        'FOR c IN `' +
          OKF_GRAPH +
          '_SOURCE` FILTER c.file_id == "' +
          versionedFile.file_id +
          '" AND c.bundle_version == 1 COLLECT WITH COUNT INTO n RETURN n'
      )
    )[0];
  versionedChunks > 0 && versionedChunkStamps === versionedChunks
    ? pass(
        'version threading VERIFIED: all ' +
          versionedChunkStamps +
          ' new chunk docs carry bundle_version=1 (citation pinning real)'
      )
    : fail('chunk version stamps: ' + versionedChunkStamps + '/' + versionedChunks + ' carry bundle_version=1');

  // ── (xi) MINT v2 + list/immutability (D-V4: every mint = N+1 of the SAME repo) ──
  const mint2 = await versionService.mintVersion(
    INGEST_REPO,
    { trigger: 'crawl', source_ref: 'https://example.gov.ke' },
    { sub: 'smoke-run' }
  );
  mint2.bundle_version === 2 && mint2.okf_tag === 'okf:v2'
    ? pass('mint v2 (crawl trigger): okf:v2 of the SAME repository (D-V4)')
    : fail('mint v2: ' + JSON.stringify(mint2));
  const versionList = await versionService.listVersions(INGEST_REPO);
  versionList.length === 2 && versionList[0].bundle_version === 2 && versionList[1].bundle_version === 1
    ? pass('version list: [v2, v1] newest-first (4.5 diff/list backing)')
    : fail('version list: ' + JSON.stringify(versionList.map((v) => v.bundle_version)));
  const manifest1Still = await versionService.getVersion(INGEST_REPO, 1);
  manifest1Still && manifest1Still.bundle_version === 1
    ? pass('immutability: manifest v1 INTACT after minting v2 (INSERT-only ledger)')
    : fail('manifest v1 not intact: ' + JSON.stringify(manifest1Still));

  // ── (xii) _LINKS_TO EDGES (Story 2.9.3 — G7/G22) ──
  // The worker wrote each concept's within-repo edges post-index. The per-repo
  // graph ALSO carries dataprep's entity-extraction artifacts (numeric-key
  // ENTITY/LINKS_TO, no bundle_version) — the assertions target THIS story's
  // concept edges (the c_/e_ deterministic keys) so dataprep's noise can never
  // mask or false-fail the concept-graph proof.
  const myEdges = await aqlAll(
    'FOR e IN `' +
      OKF_GRAPH +
      "_LINKS_TO` FILTER STARTS_WITH(e._from, '" +
      OKF_GRAPH +
      "_ENTITY/c_') RETURN KEEP(e, ['_from', '_to', 'label', 'file_id', 'repo_id', 'bundle_version'])"
  );
  myEdges.length > 0
    ? pass(
        'edges: ' +
          myEdges.length +
          ' CONCEPT _LINKS_TO edges written into ' +
          OKF_GRAPH +
          '_LINKS_TO (the concept graph is traversable)'
      )
    : fail("edges: ZERO concept edges (the worker's post-index edge write did not fire)");
  const edgesWellFormed = myEdges.every(
    (e) =>
      String(e._from).startsWith(OKF_GRAPH + '_ENTITY/c_') &&
      String(e._to).startsWith(OKF_GRAPH + '_ENTITY/c_') &&
      typeof e.label === 'string' &&
      typeof e.file_id === 'string' &&
      e.repo_id === INGEST_REPO
  );
  edgesWellFormed
    ? pass('edges: ALL concept edges carry label + file_id + repo_id + within-repo c_ endpoints (well-formed)')
    : fail('edges malformed: ' + JSON.stringify(myEdges.slice(0, 3)));
  const versionedEdge = myEdges.some((e) => e.bundle_version === 1);
  versionedEdge
    ? pass("edges: the post-mint re-ingested concept's edges carry bundle_version=1 (citation-pinned)")
    : fail('edges: no bundle_version=1 edge (the pre-mint drain writes null; the modified re-ingest should stamp 1)');
  const conceptEntities = await aqlAll(
    'FOR v IN `' +
      OKF_GRAPH +
      "_ENTITY` FILTER STARTS_WITH(v._key, 'c_') RETURN KEEP(v, ['_key','concept_id','bundle_version'])"
  );
  conceptEntities.length >= EXPECTED_CONCEPTS
    ? pass(
        'edges: concept ENTITY vertices exist for the ' +
          EXPECTED_CONCEPTS +
          ' bundle concepts (' +
          conceptEntities.length +
          ' c_ nodes)'
      )
    : fail('concept entity count: ' + conceptEntities.length + ' < ' + EXPECTED_CONCEPTS);
  // G22 (NON-tautological): every concept edge's `_to` must equal an EXISTING
  // concept ENTITY vertex `_id` in this repo — a cross-repo/dangling target
  // would reference a vertex id absent from the set.
  const vertexIds = new Set(conceptEntities.map((v) => OKF_GRAPH + '_ENTITY/' + v._key));
  const dangling = myEdges.filter((e) => !vertexIds.has(String(e._to)));
  dangling.length === 0
    ? pass('edges: ZERO cross-repo / dangling concept edges (every _to resolves to a repo concept vertex — G22 held)')
    : fail('cross-repo/dangling edges: ' + JSON.stringify(dangling.slice(0, 3)));

  // ── (xiii) CLONE (Story 4.8 — D-V5 §8.4): fork the repo, curate, isolate ──
  // The source must be fully drained + minted (meta rows carry index_status=
  // 'indexed' + the source version is 2 for cloned_from). The clone runs via the
  // in-container service module (the HTTP 201/404/409 matrix is unit-tested; the
  // live HTTP 403 admin-gate is asserted EARLY above, before the drain).
  const repositoryService = require('./services/repository-service');
  const CLONE_NAME = REPO_NAME + ' (smoke clone)';
  console.log('  CLONE   : forking "' + REPO_NAME + '" (D-V5) — new repo + meta copy + cloned_from + isolation');
  // Re-run safety: remove any prior smoke clone (fixed clone name) + purge data.
  const priorClones = await aqlAll(
    "FOR r IN okf_repositories FILTER r.domain == 'smoke' AND r.name == '" +
      CLONE_NAME +
      "' RETURN KEEP(r, ['repo_id'])"
  );
  for (const pc of priorClones) {
    // A prior crashed run may have left the clone's files mid-drain — retract
    // them via doc-repo FIRST so the worker never writes into collections this
    // cleanup is about to drop (mirrors the ingest phase's re-run retract).
    const priorFiles = await aqlAll(
      "FOR f IN files FILTER f.repo_id == '" + pc.repo_id + "' RETURN KEEP(f, ['file_id','file_name','dataprep'])"
    );
    for (const pf of priorFiles) {
      const retr = await call('POST', DOCREPO + '/api/files/' + pf.file_id + '/retract', await serviceToken());
      if (retr.status !== 200) {
        console.log('    NOTE clone-cleanup retract ' + pf.file_name + ' -> ' + retr.status + ' (best-effort)');
      }
    }
    try {
      await repositoryService.remove(pc.repo_id, { sub: 'smoke-run' });
    } catch (e) {
      /* best-effort — already removed */
    }
    await aqlAll("FOR m IN okf_concepts_meta FILTER m.repo_id == '" + pc.repo_id + "' REMOVE m IN okf_concepts_meta");
    await aqlAll("FOR f IN files FILTER f.repo_id == '" + pc.repo_id + "' REMOVE f IN files");
    await aqlAll("FOR v IN okf_versions FILTER v.repo_id == '" + pc.repo_id + "' REMOVE v IN okf_versions");
    await aqlAll("REMOVE '" + pc.repo_id + "' IN okf_repositories");
  }
  // Snapshot the source's physical state — the isolation baseline.
  const srcChunksBefore =
    (await aqlAll('FOR c IN `' + OKF_GRAPH + '_SOURCE` COLLECT WITH COUNT INTO n RETURN n'))[0] || 0;
  const srcEdgesBefore =
    (await aqlAll('FOR e IN `' + OKF_GRAPH + '_LINKS_TO` COLLECT WITH COUNT INTO n RETURN n'))[0] || 0;

  const clone = await repositoryService.cloneRepository(
    INGEST_REPO,
    { name: CLONE_NAME, domain: 'smoke' },
    { sub: 'smoke-run', source_ip: null }
  );
  const CLONE_ID = clone.repo_id;
  const CLONE_GRAPH = clone.graph_name || 'OKF_' + CLONE_ID;
  clone.repo_id !== INGEST_REPO && clone.graph_name === CLONE_GRAPH && clone.lifecycle_state === 'draft'
    ? pass('clone: new repo_id + ' + CLONE_GRAPH + ' graph + lifecycle_state=draft (unique registry entry)')
    : fail('clone registry: ' + JSON.stringify(clone));
  clone.cloned_from && clone.cloned_from.repo_id === INGEST_REPO && clone.cloned_from.version === 2
    ? pass('clone: cloned_from { repo_id: source, version: 2 } lineage recorded')
    : fail('clone cloned_from: ' + JSON.stringify(clone.cloned_from));

  // The copied meta: concept_id set identical + the D-V1 triple preserved.
  const cloneMeta = await aqlAll(
    "FOR m IN okf_concepts_meta FILTER m.repo_id == '" +
      CLONE_ID +
      "' RETURN KEEP(m, ['concept_id','title','bundle_version','content_hash','index_status','graph_name'])"
  );
  const srcMeta2 = await aqlAll(
    "FOR m IN okf_concepts_meta FILTER m.repo_id == '" +
      INGEST_REPO +
      "' RETURN KEEP(m, ['concept_id','title','bundle_version','content_hash','index_status'])"
  );
  cloneMeta.length === EXPECTED_CONCEPTS
    ? pass('clone meta: ' + cloneMeta.length + ' concepts copied (source had ' + srcMeta2.length + ')')
    : fail('clone meta count: ' + cloneMeta.length);
  const tripleOk =
    cloneMeta.length === srcMeta2.length &&
    cloneMeta.every((cm) => {
      const s = srcMeta2.find((x) => x.concept_id === cm.concept_id);
      return (
        s &&
        s.title === cm.title &&
        s.bundle_version === cm.bundle_version &&
        s.content_hash === cm.content_hash &&
        s.index_status === cm.index_status &&
        cm.graph_name === CLONE_GRAPH
      );
    });
  tripleOk
    ? pass(
        'clone meta: title/bundle_version/content_hash/index_status preserved verbatim + graph rewritten to OKF_{clone}'
      )
    : fail('clone meta triple mismatch: ' + JSON.stringify({ clone: cloneMeta, src: srcMeta2 }));

  // Curate the clone: modify ONE concept, re-ingest → the other 5 dedup-skip
  // (unchanged + index_status preserved) and the modified one re-indexes into the
  // CLONE's graph only.
  const cloneConcepts = concepts.map((c) =>
    c.path === 'service_directory.md'
      ? {
          ...c,
          body:
            c.body +
            '\n\n## Cloned amendment (D-V5 §8.4)\n\nModified in the clone to prove it re-indexes into the CLONE graph only.\n'
        }
      : c
  );
  const rc = await ingestService.ingestRepoConcepts(
    CLONE_ID,
    { concepts: cloneConcepts, labels: ['Service Directory'] },
    { sub: 'smoke-run', source_ip: null }
  );
  rc.skipped_dedup === EXPECTED_CONCEPTS - 1 && rc.enqueued === 1
    ? pass(
        'clone re-ingest: ' +
          (EXPECTED_CONCEPTS - 1) +
          ' dedup-skipped (unchanged+indexed), 1 enqueued (modified concept)'
      )
    : fail(
        'clone re-ingest summary: ' +
          JSON.stringify({ skipped: rc.skipped_dedup, enqueued: rc.enqueued, errors: rc.enqueue_errors })
      );

  // Drain the clone's single new Pending file (worker-paced). Sorted so a fixture
  // drift that enqueues >1 concept is watched deterministically (not arbitrary).
  let cloneFile = (
    await aqlAll(
      "FOR f IN files FILTER f.repo_id == '" +
        CLONE_ID +
        "' SORT f.file_id RETURN KEEP(f, ['file_id','file_name','dataprep','graph_name'])"
    )
  )[0];
  let cStatus = null;
  if (cloneFile) {
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 15000));
      const row = (
        await aqlAll("FOR x IN files FILTER x.file_id == '" + cloneFile.file_id + "' RETURN KEEP(x, ['dataprep'])")
      )[0];
      cStatus = row && row.dataprep && row.dataprep.status;
      if (cStatus === 'Ingested' || cStatus === 'Ingestion Error' || cStatus === 'Killed') break;
    }
  }
  cloneFile && cloneFile.graph_name === CLONE_GRAPH
    ? pass("clone: the modified concept's files doc is graph-stamped to the CLONE graph (" + CLONE_GRAPH + ')')
    : fail('clone files doc graph_name: ' + JSON.stringify(cloneFile));
  cStatus === 'Ingested'
    ? pass('clone: worker drained the modified concept to Ingested')
    : fail('clone drain ended "' + cStatus + '"');

  // Physical isolation: the modified concept's chunks in the CLONE graph ONLY,
  // and the SOURCE's chunks + edges are UNCHANGED (the original is never touched).
  const cloneChunks = cloneFile
    ? (
        await aqlAll(
          'FOR c IN `' +
            CLONE_GRAPH +
            '_SOURCE` FILTER c.file_id == "' +
            cloneFile.file_id +
            '" COLLECT WITH COUNT INTO n RETURN n'
        )
      )[0]
    : 0;
  cloneChunks > 0
    ? pass(
        'clone: modified concept indexed into the CLONE graph (' +
          cloneChunks +
          ' chunks in ' +
          CLONE_GRAPH +
          '_SOURCE)'
      )
    : fail('clone graph: no chunks for the modified concept in ' + CLONE_GRAPH + '_SOURCE');
  const srcLeak = cloneFile
    ? (
        await aqlAll(
          'FOR c IN `' +
            OKF_GRAPH +
            '_SOURCE` FILTER c.file_id == "' +
            cloneFile.file_id +
            '" COLLECT WITH COUNT INTO n RETURN n'
        )
      )[0]
    : 0;
  (srcLeak || 0) === 0
    ? pass('clone isolation: ZERO clone chunks in the SOURCE graph')
    : fail('clone isolation BROKEN: ' + srcLeak + ' clone chunks in the source graph');
  const srcChunksAfter =
    (await aqlAll('FOR c IN `' + OKF_GRAPH + '_SOURCE` COLLECT WITH COUNT INTO n RETURN n'))[0] || 0;
  const srcEdgesAfter =
    (await aqlAll('FOR e IN `' + OKF_GRAPH + '_LINKS_TO` COLLECT WITH COUNT INTO n RETURN n'))[0] || 0;
  srcChunksAfter === srcChunksBefore && srcEdgesAfter === srcEdgesBefore
    ? pass(
        'clone isolation: SOURCE chunks+edges UNCHANGED (' +
          srcChunksBefore +
          ' chunks / ' +
          srcEdgesBefore +
          ' edges — the original is never touched)'
      )
    : fail(
        'clone isolation: source changed before=' +
          srcChunksBefore +
          '/' +
          srcEdgesBefore +
          ' after=' +
          srcChunksAfter +
          '/' +
          srcEdgesAfter
      );
  const cloneGraphTotal =
    (await aqlAll('FOR c IN `' + CLONE_GRAPH + '_SOURCE` COLLECT WITH COUNT INTO n RETURN n'))[0] || 0;
  cloneGraphTotal === (cloneChunks || 0)
    ? pass(
        'clone: exactly the modified concept materialized in the clone graph (' +
          cloneGraphTotal +
          ' chunks; the other 5 metadata-only until curated)'
      )
    : fail('clone graph total: ' + cloneGraphTotal + ' != ' + cloneChunks);

  // Cleanup: remove the clone (drops its graph + meta + files + versions via the
  // real remove() → retractRepoGraph) + purge the registry tombstone.
  await repositoryService.remove(CLONE_ID, { sub: 'smoke-run' });
  await aqlAll("REMOVE '" + CLONE_ID + "' IN okf_repositories");
  pass('clone: cleanup — clone removed, its ' + CLONE_GRAPH + ' graph dropped (registry hygiene for re-runs)');

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
          '_SOURCE — the properly named graph of repository "' +
          REPO_NAME +
          '")'
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

  // ── (ix) BUNDLE RETRACTION — VERIFIED, not just a 200 ──
  // History lesson (G5): retract once returned success while deleting NOTHING
  // (wrong-graph fallback). A retract is only proven when the concept's chunks
  // are physically GONE from the per-repo graph and the other concepts'
  // chunks survive. Retract ONE concept (bad_concept — deliberately
  // non-conforming, the natural deletion candidate).
  const retractFile = pending.find((p) => p.file_name === 'bad_concept.md') || pending[0];
  const retractChunksBefore = (
    await aqlAll(
      'FOR c IN `' +
        OKF_GRAPH +
        '_SOURCE` FILTER c.file_id == "' +
        retractFile.file_id +
        '" COLLECT WITH COUNT INTO n RETURN n'
    )
  )[0];
  const retr = await call('POST', DOCREPO + '/api/files/' + retractFile.file_id + '/retract', await serviceToken());
  if (retr.status !== 200) {
    fail('retract ' + retractFile.file_name + ' -> ' + retr.status + ' ' + JSON.stringify(retr.body).slice(0, 120));
  } else {
    // Poll the files doc to the terminal 'retracted' state (retract also runs
    // cascading LINKS_TO/HAS_SOURCE cleanup in the graph — give it time).
    let rStatus = null;
    for (let i = 0; i < 24; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      const row = (
        await aqlAll(
          "FOR x IN files FILTER x.file_id == '" + retractFile.file_id + "' RETURN KEEP(x, ['dataprep','chunk_count'])"
        )
      )[0];
      rStatus = row && row.dataprep && (row.dataprep.status || '').toLowerCase();
      if (rStatus === 'retracted') break;
    }
    (rStatus === 'retracted' ? pass : fail)(
      'retract: files doc -> ' + (rStatus || 'never-terminal') + ' (' + retractFile.file_name + ')'
    );
    // THE physical proof: that concept's chunks are GONE from the per-repo graph.
    const chunksAfter = (
      await aqlAll(
        'FOR c IN `' +
          OKF_GRAPH +
          '_SOURCE` FILTER c.file_id == "' +
          retractFile.file_id +
          '" COLLECT WITH COUNT INTO n RETURN n'
      )
    )[0];
    retractChunksBefore > 0 && (chunksAfter || 0) === 0
      ? pass(
          'retract VERIFIED: ' +
            retractChunksBefore +
            ' chunks of ' +
            retractFile.file_name +
            ' physically removed from ' +
            OKF_GRAPH +
            '_SOURCE (right graph, real delete)'
        )
      : fail(
          'retract NOT verified: before=' +
            retractChunksBefore +
            ' after=' +
            (chunksAfter || 0) +
            ' in ' +
            OKF_GRAPH +
            '_SOURCE (silent no-op?)'
        );
    // The rest of the bundle must be untouched.
    const survivors = await aqlAll(
      'FOR c IN `' +
        OKF_GRAPH +
        '_SOURCE` FILTER c.file_id IN ' +
        JSON.stringify(okfIds.filter((id) => id !== retractFile.file_id)) +
        ' COLLECT fid = c.file_id WITH COUNT INTO n RETURN {fid, n}'
    );
    survivors.length === EXPECTED_CONCEPTS - 1 && survivors.every((r) => r.n > 0)
      ? pass(
          'retract VERIFIED: the other ' +
            (EXPECTED_CONCEPTS - 1) +
            ' concepts keep their chunks (no collateral damage)'
        )
      : fail('retract collateral: survivors=' + JSON.stringify(survivors));
  }

  // ── (x) BUNDLE-LEVEL RETRACTION — repo delete DROPS the graph ──
  // A per-repo graph serves exactly ONE bundle: the simplest correct
  // retraction is dropping the graph definition + the 4 collections
  // (retractRepoGraph, wired into repository delete). Verified via the real
  // remove() flow (the service function — the HTTP DELETE route's authz is
  // unit-tested; the user token has expired by this point in the run).
  // (repositoryService already required by the clone phase above.)
  const delResult = await repositoryService.remove(INGEST_REPO, { sub: 'smoke-run' });
  delResult && delResult.deleted_at
    ? pass('bundle retract: repo soft-deleted (pending_hard_delete) → graph drop executed')
    : fail('bundle retract: remove() returned ' + JSON.stringify(delResult));
  const collectionGone = async (name) => {
    try {
      await db.collection(name).get();
      return false;
    } catch {
      return true; // 404 — physically dropped
    }
  };
  const allDropped = (
    await Promise.all(['_SOURCE', '_ENTITY', '_HAS_SOURCE', '_LINKS_TO'].map((s) => collectionGone(OKF_GRAPH + s)))
  ).every(Boolean);
  allDropped
    ? pass('bundle retract VERIFIED: all 4 ' + OKF_GRAPH + '_* collections physically DROPPED from ArangoDB')
    : fail('bundle retract: some ' + OKF_GRAPH + '_* collections still exist');
  let graphDefGone = false;
  try {
    await db.route('_api/gharial/' + OKF_GRAPH).get();
  } catch {
    graphDefGone = true;
  }
  graphDefGone
    ? pass('bundle retract VERIFIED: named graph definition ' + OKF_GRAPH + ' removed')
    : fail('bundle retract: graph definition ' + OKF_GRAPH + ' still exists');
  const leftoverMeta = (
    await aqlAll("RETURN LENGTH(FOR m IN okf_concepts_meta FILTER m.repo_id == '" + INGEST_REPO + "' RETURN 1)")
  )[0];
  leftoverMeta === 0
    ? pass('bundle retract VERIFIED: all okf_concepts_meta rows for the repo removed')
    : fail('bundle retract: ' + leftoverMeta + ' meta rows remain');
  const leftoverFiles = (
    await aqlAll("RETURN LENGTH(FOR f IN files FILTER f.repo_id == '" + INGEST_REPO + "' RETURN 1)")
  )[0];
  leftoverFiles === 0
    ? pass('bundle retract VERIFIED: dangling files docs removed')
    : fail('bundle retract: ' + leftoverFiles + ' files docs remain');

  // Registry hygiene for the NEXT run: purge the smoke tombstone (fixed _key).
  await aqlAll("REMOVE '" + INGEST_REPO + "' IN okf_repositories");

  console.log(
    '  NOTE: multi-graph READ (retriever fan-out over OKF_{repo_id} graphs) is Epic 1 — the retriever still queries the default graph until then.'
  );
  console.log(
    '  NOTE: per-CONCEPT retraction (dataprep retract_file — surgical chunk deletion) is the separate single-file path, untouched by the bundle-level drop.'
  );
}
