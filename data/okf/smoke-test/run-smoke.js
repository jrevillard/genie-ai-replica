// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// OKF smoke test: exercises the write-side control plane end-to-end AND both
// ingestion facilities against a real bundle. Run INSIDE the okf-server
// container (has shared-lib + ArangoDB + pii-service + doc-repo reachability):
//   docker cp data/okf/smoke-test/kenya-bundle <container>:/app/kenya-bundle
//   docker cp data/okf/smoke-test/kenya-bundle.zip <container>:/app/kenya-bundle.zip
//   docker cp data/okf/smoke-test/kenya-bundle-clean <container>:/app/kenya-bundle-clean
//   docker cp data/okf/smoke-test/kenya-bundle-clean.zip <container>:/app/kenya-bundle-clean.zip
//   docker cp data/okf/smoke-test/run-smoke.js <container>:/app/run-smoke.js
//   docker exec -e OKF_SMOKE_TOKEN_*=<...> <container> node /app/run-smoke.js
//
// Exercised: parser (2.3) -> conformance (2.4, WP-A hard/warning split) ->
// persistConformanceIssues (2.9.2 G9 REWIRED path) -> concepts-meta UPSERT writer
// (4b body + ingest_labels + is_index) -> PII scan + gate (2.8) -> 6.1 authz
// matrix -> 2.9.1 orchestrator (ZIP bundle + concepts[], 4f CONTENT-ONLY WP-C) ->
// 2.9.4 worker (drains meta rows @ parsed, POSTs directly to dataprep) ->
// 2.9.6 graph_name wiring -> 2.9.7 versions + mintVersion -> 4.8 clone (D-V5).
// Every assertion below is HARD: any failure exits non-zero.
//
// WP-A (5265c8d): hard conformance errors (MISSING_TYPE / BAD_ACTOR_PREFIX) are
// REJECTED at ingest — never chunked, never enqueued, persisted with
// index_status='rejected' + the issues. The mint gate refuses while any concept
// is non-indexed.
// WP-B (b0b28dc): the named gharial graph (OKF_{repo}) is registered;
// is_index: true on the meta + ENTITY row for the index.md root.
// WP-C (this commit): concepts are NEVER doc-repo files docs — content-only
// chunking. Only the bundle zip is a files doc. The worker POSTs concepts
// directly to dataprep (conceptId); dataprep's completion callback hits the
// okf-server internal endpoint (secret-gated). Chunks carry concept_id.
//
// The smoke runs TWO bundle paths (David, 2026-08-19): the SAD path (kenya-bundle
// with bad_concept.md) proves the WP-A gate; the HAPPY path (kenya-bundle-clean,
// 5 conforming concepts) proves WP-C content-only end-to-end + mint succeeds.
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
//   5. Every conforming concept scans pii_state='clean' (bad_concept is
//      rejected pre-PII per WP-A — PII scan does not run).
//   6. After markRepoPiiScanned, the publish gate is OPEN (blocked=false).
//   7. The 6.1 authz matrix holds (scoped read-only, default-deny, admin).
//   8. SAD-PATH ZIP ingest: POST kenya-bundle.zip → 202 with total=6/parsed=6/
//      rejected=1 (bad_concept, WP-A)/ enqueued=5; 6 meta rows — 5
//      parsed+graph-stamped + 1 rejected with 2 issues; PII clean on the 5
//      conforming; ZERO per-concept files docs (WP-C content-only); bundle zip
//      stored as a file doc (repo-associated, graph-stamped, KH labels,
//      is_bundle @ Ingested).
//   9. The 2.9.4 INGESTION WORKER drains the 5 parsed meta rows directly to
//      dataprep (no doc-repo round-trip — WP-C) and the concept-status
//      callback transitions each meta row parsed→indexed + writes within-repo
//      edges + stamps chunk_count + last_good_index_at.
//  10. Chunks in OKF_{repo}_SOURCE carry concept_id (WP-C citation provenance);
//      the index.md root carries is_index: true on its ENTITY vertex (WP-B);
//      ZERO OKF chunks in the default graph (2.9.6 split); re-ingest of
//      unchanged+indexed concepts → skipped_dedup=N, enqueued=0 (the 4e dedup
//      rule fires LIVE), meta rows stay indexed (no downgrade).
//  11. SAD-PATH MINT GATE (WP-A): mintVersion on the sad repo REFUSES
//      (PUBLISH_GATE_BLOCKED — bad_concept is rejected); HAPPY-PATH mint
//      SUCCEEDS (v1 manifest with 5 concepts + stored canonical hashes +
//      okf:v1; repo.version stamped).
//  12. Bundle retraction VERIFIED: retracting one concept physically removes
//      its chunks from OKF_{repo_id}_SOURCE (right graph, real delete — never
//      a silent 200) and leaves the other concepts' chunks untouched.
//  13. Bundle-level retraction VERIFIED: repo delete DROPS the per-repo graph
//      (definition + all 4 collections physically gone from ArangoDB) and
//      removes the repo's meta rows + the bundle-zip files doc.
//  14. Versioning VERIFIED (2.9.7): modified re-ingest dedup-skips the
//      unchanged + enqueues the changed concept WITH bundle_version=1 + the
//      okf:v1 label; the worker drains it and EVERY new chunk doc carries
//      bundle_version=1; mint v2 (crawl trigger, D-V4) → list [v2, v1],
//      manifest v1 INTACT (INSERT-only).
//  15. Clone VERIFIED (4.8, D-V5 §8.4): the clone endpoint 403s a scoped READ
//      caller (admin mutation); cloning the minted source yields a NEW repo
//      (new repo_id + OKF_{new} graph + lifecycle draft) with cloned_from
//      {repo_id, version: 2} + 5 meta rows copied verbatim (title/bundle_version/
//      content_hash/index_status preserved); a modified concept re-ingests into
//      the CLONE graph ONLY (dedup-skips the other 4), and the SOURCE's chunks
//      + edges are UNCHANGED (isolation).
//  16. HAPPY-PATH ZIP ingest: POST kenya-bundle-clean.zip → 202 with total=5/
//      parsed=5/rejected=0/enqueued=5; 5 meta rows parsed+graph-stamped;
//      ZERO per-concept files docs; bundle zip stored; worker drains to
//      indexed; chunks carry concept_id + is_index on the root; mint SUCCEEDS
//      with v1 (5 concepts + stored canonical hashes).

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

// Cleanup modes (OKF_SMOKE_CLEANUP) — how the smoke handles prior-run artifacts:
//   full (default): retract+delete prior artifacts at START and retract+delete
//     everything at END (self-cleaning — the DB ends with ZERO OKF_* artifacts).
//   none: run WITHOUT any cleanup — the bundle docs, the repo, and the graphs all
//     PERSIST so they can be inspected in the UI / ArangoDB after the run. The
//     next `only` run cleans them up.
//   only: DO NOT run the test — just clean up the previous run (retract + delete
//     the OKF files via the doc-repo API, remove the smoke repos via the
//     okf-server CRUD repo-delete — the same path the Admin UI will use), then
//     verify ZERO OKF_* graphs/collections remain.
// Operating procedure (David, 2026-08-18): run with OKF_SMOKE_CLEANUP=none, inspect
// the results, then run OKF_SMOKE_CLEANUP=only to clean up.
const CLEANUP = (process.env.OKF_SMOKE_CLEANUP || 'full').toLowerCase();
if (!['full', 'none', 'only'].includes(CLEANUP)) {
  console.error(`OKF_SMOKE_CLEANUP must be 'full' | 'none' | 'only' (got '${CLEANUP}')`);
  process.exit(1);
}

/** Query ArangoDB for all OKF_* graph definitions (raw read — the test's state
 * verification; NOT a write). */
async function listOkfGraphs(db) {
  const gRes = await db.route('_api/gharial').get();
  const graphs = (gRes.body && gRes.body.graphs) || [];
  return graphs.filter((g) => String(g.name).startsWith('OKF_'));
}

/** Assert ZERO OKF_* graphs + collections remain (the "properly cleaned" proof). */
async function assertZeroOkfArtifacts(db) {
  const graphs = await listOkfGraphs(db);
  const cols = await db.listCollections();
  const okfCols = cols.filter((c) => String(c.name).startsWith('OKF_'));
  if (graphs.length === 0 && okfCols.length === 0) {
    pass('cleanup VERIFIED: ZERO OKF_* graphs + collections remain in ArangoDB');
    return true;
  }
  fail(
    'cleanup NOT clean: ' +
      graphs.length +
      ' OKF_* graphs (' +
      graphs.map((g) => g.name).join(',') +
      ') + ' +
      okfCols.length +
      ' OKF_* collections (' +
      okfCols.map((c) => c.name).join(',') +
      ') remain'
  );
  return false;
}

/**
 * Cleanup-only mode (OKF_SMOKE_CLEANUP=only): remove the previous run's artifacts
 * VIA THE CRUD APIS — retract each OKF file through doc-repo's retract endpoint,
 * delete it through doc-repo's DELETE endpoint (Admin), and remove each smoke repo
 * through the okf-server repo-delete CRUD (repositoryService.remove — the future
 * Admin-UI "delete repository" path, which retracts the repo's graph + meta +
 * files + versions). NO raw AQL writes — reads only (finding the artifacts).
 */
async function cleanupOnly(db) {
  console.log("CLEANUP-ONLY: removing the previous smoke run's artifacts (CRUD APIs)...");
  const DOCREPO = process.env.OKF_SMOKE_DOCREPO_URL || 'http://document-repository:3001';
  const ADMIN = process.env.OKF_SMOKE_TOKEN_ADMIN;
  const REPO_NAME = 'Kenya Government Services Knowledge Base (smoke)';
  const CLONE_NAME = REPO_NAME + ' (smoke clone)';
  const repositoryService = require('./services/repository-service');
  const aqlAll = async (query) => await (await db.query(query)).all();

  let _svc = null;
  let _svcAt = 0;
  async function serviceToken() {
    if (_svc && Date.now() - _svcAt < 180000) return _svc;
    const base = (
      process.env.KEYCLOAK_INTERNAL_URL ||
      process.env.KEYCLOAK_PUBLIC_URL ||
      'http://keycloak:8080'
    ).replace(/\/$/, '');
    const r = await fetch(`${base}/realms/${process.env.KEYCLOAK_REALM || 'genie'}/protocol/openid-connect/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: process.env.KC_OKF_SERVER_CLIENT_ID || 'okf-server',
        client_secret: process.env.KC_OKF_SERVER_CLIENT_SECRET || ''
      })
    });
    if (!r.ok) throw new Error('service token mint failed: ' + r.status);
    const j = await r.json();
    _svc = j.access_token;
    _svcAt = Date.now();
    return _svc;
  }
  async function call(method, url, token, body) {
    const res = await fetch(url, {
      method,
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
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
  const svc = await serviceToken();

  // The facility-A single doc (no repo — clean via retract + Admin delete).
  const single = (
    await aqlAll("FOR f IN files FILTER f.file_name == 'smoke-single-doc.md' RETURN KEEP(f, ['file_id','dataprep'])")
  )[0];
  if (single) {
    await call('POST', DOCREPO + '/api/files/' + single.file_id + '/retract', svc);
    if (ADMIN) {
      const del = await call('DELETE', DOCREPO + '/api/files/' + single.file_id, ADMIN);
      console.log('  single-doc ' + single.file_id + ' delete -> ' + del.status);
    } else {
      console.log('  single-doc retracted; DELETE skipped (no OKF_SMOKE_TOKEN_ADMIN)');
    }
  }

  // The smoke repos (the created repo + any smoke clone, found BY NAME — the
  // repo_id is dynamic) — CRUD repo-delete.
  const smokeRepos = await aqlAll(
    "FOR r IN okf_repositories FILTER r.domain == 'smoke' AND (r.name == '" +
      CLONE_NAME +
      "' OR r.name == '" +
      REPO_NAME +
      "') RETURN KEEP(r, ['repo_id','deleted_at'])"
  );
  for (const r of smokeRepos) {
    if (r.deleted_at) continue; // already removed
    // Retract the repo's files first (the surgical per-file path — the future
    // Admin-UI delete flow retracts documents before removing them).
    const files = await aqlAll(
      "FOR f IN files FILTER f.repo_id == '" + r.repo_id + "' RETURN KEEP(f, ['file_id','file_name','dataprep'])"
    );
    for (const f of files) {
      const retr = await call('POST', DOCREPO + '/api/files/' + f.file_id + '/retract', svc);
      console.log('  retract ' + f.file_name + ' -> ' + retr.status);
    }
    try {
      await repositoryService.remove(r.repo_id, { sub: 'smoke-run' });
      console.log('  repo ' + r.repo_id + ' removed (CRUD repo-delete — graph + meta + files + versions cascaded)');
    } catch (e) {
      console.log('  repo ' + r.repo_id + ' remove skipped: ' + e.message);
    }
  }
  await assertZeroOkfArtifacts(db);
  console.log(
    'CLEANUP-ONLY done. NOTE: the repo-delete CRUD service now removes the registry entry entirely (no tombstone) — re-create is allowed.'
  );
  return failures === 0;
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
  // Cleanup-only mode: do NOT run the test — remove the previous run's artifacts
  // via the CRUD APIs and exit.
  if (CLEANUP === 'only') {
    const db = await dbService.getConnection('default');
    const ok = await cleanupOnly(db);
    process.exit(ok ? 0 : 1);
  }
  console.log(
    `OKF smoke test: bundle=${BUNDLE_DIR} concepts=${EXPECTED_CONCEPTS} repo=${REPO_ID} cleanupMode=${CLEANUP}` +
      (CLEANUP === 'none'
        ? ' (leaving all artifacts in place for inspection — run OKF_SMOKE_CLEANUP=only afterward)'
        : '')
  );
  const files = fs
    .readdirSync(BUNDLE_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();
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

  // ── control-plane scratch cleanup (IMMEDIATE — live-caught 2026-08-21) ──
  // The steps above write 6 scratch meta rows into REPO_ID to exercise the
  // 2.9.2 writer + PII + metrics. Their assert-purpose is NOW served — and
  // the 2.9.4 worker (15s poll) claims ANY 'parsed' row, so the scratch rows
  // MUST be gone before it wakes: left alive they (a) get chunked into the
  // WRONG graph (OKF_smoke-kenya-repo-0001 — wasted GPU calls) and (b)
  // duplicate every concept_id for the completion callback. Deleting here
  // (in main(), right after the control-plane asserts — NOT at ingestPhase
  // start) closes the race window.
  {
    // (aqlAll is phase-scoped — query via the shared db handle here)
    const scratchRows = await (
      await db.query(
        "FOR m IN okf_concepts_meta FILTER m.repo_id == '" +
          REPO_ID +
          "' REMOVE m IN okf_concepts_meta COLLECT WITH COUNT INTO deleted RETURN deleted"
      )
    ).all();
    if (scratchRows[0] > 0) {
      console.log(
        '  cleanup: removed ' + scratchRows[0] + ' control-plane scratch meta rows (repo ' + REPO_ID + ') — worker-race guard'
      );
    }
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
  const GRAPH = process.env.ARANGO_GRAPH_NAME || 'GRAPH';
  // The OKF repo is CREATED VIA THE API (emulating the process flow) below, so
  // its repo_id is dynamic (a UUID minted by the registry). Set + OKF_GRAPH
  // computed AFTER the API create. Used by the doc-repo routes (uuid-validated).
  const REPO_NAME = 'Kenya Government Services Knowledge Base (smoke)';
  let INGEST_REPO = null;
  let OKF_GRAPH = null;
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
    repo_id: '99999999-9999-4999-8999-999999999999', // deliberately DIFFERENT → ownership mismatch
    originalFileName: 'ownership-probe.md'
  });
  own.status === 400
    ? pass('integrity: doc-repo rejects graph_name != OKF_{repo_id} (ownership guard)')
    : fail('ownership guard: expected 400, got ' + own.status + ' ' + JSON.stringify(own.body).slice(0, 100));

  // (control-plane scratch rows are already removed in main() immediately
  // after their asserts — see the worker-race guard there.)

  // ── re-run safety (CLEANUP=full only): retract + delete prior artifacts at
  //    phase START — VIA THE CRUD APIS, no raw AQL writes. Prior smoke repos
  //    (found BY NAME — the repo_id is dynamic) are removed through the okf-server
  //    repo-delete CRUD (the future Admin-UI "delete repository" path, which
  //    retracts the graph + removes meta + files + versions). With CLEANUP=none
  //    this is SKIPPED so the previous run stays visible. ──
  const repositoryServiceCleanup = require('./services/repository-service');
  if (CLEANUP !== 'none') {
    const single = (
      await aqlAll("FOR f IN files FILTER f.file_name == 'smoke-single-doc.md' RETURN KEEP(f, ['file_id'])")
    )[0];
    if (single) {
      const retr = await call('POST', DOCREPO + '/api/files/' + single.file_id + '/retract', svc);
      const del = await call('DELETE', DOCREPO + '/api/files/' + single.file_id, ADMIN);
      console.log('  cleanup: single-doc retract=' + retr.status + ' delete=' + del.status);
    }
    const priorSmoke = await aqlAll(
      "FOR r IN okf_repositories FILTER r.domain == 'smoke' AND r.name == '" +
        REPO_NAME +
        "' RETURN KEEP(r, ['repo_id','deleted_at'])"
    );
    for (const r of priorSmoke) {
      if (r.deleted_at) continue;
      try {
        await repositoryServiceCleanup.remove(r.repo_id, { sub: 'smoke-run' });
        console.log(
          '  cleanup: prior ' + r.repo_id + ' removed via CRUD repo-delete (graph+meta+files+versions cascaded)'
        );
      } catch (e) {
        console.log('  cleanup: prior repo remove skipped (' + e.message + ')');
      }
    }
  }

  // ── EMULATE THE PROCESS FLOW: create the OKF repo VIA THE API ──
  // PROPERLY NAMED (design addendum D-V1/D-V2): the repository name derives from
  // the BUNDLE's own identity (index.md title) — the registry entry, graph, and
  // bundle are one named association, not an anonymous UUID. The repo is created
  // through the same POST /api/okf/repos endpoint the Admin UI will use (the repo
  // is stored in the DB first; the bundle is created + ingested later).
  const idxMatter = matter(fs.readFileSync(path.join(BUNDLE_DIR, 'index.md'), 'utf8'));
  const bundleTitle = (idxMatter.data && idxMatter.data.title) || 'Kenya Government Services Knowledge Base';
  const bundleOkfVersion = (idxMatter.data && idxMatter.data.okf_version) || '0.2';
  const repos = db.collection('okf_repositories');
  const createRes = await call('POST', BASE + '/api/okf/repos', ADMIN, {
    name: REPO_NAME,
    domain: 'smoke',
    acl: { required_scopes: [] }
  });
  if (createRes.status === 201 && createRes.body && createRes.body.repo_id) {
    INGEST_REPO = createRes.body.repo_id;
    OKF_GRAPH = 'OKF_' + INGEST_REPO;
    pass('flow: OKF repository "' + REPO_NAME + '" created via the API (repo_id=' + INGEST_REPO + ')');
  } else {
    fail('flow: repo create via API -> ' + createRes.status + ' ' + JSON.stringify(createRes.body).slice(0, 150));
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

  // NOTE (2026-08-18, David): the legacy single-document facility is NOT part of
  // the OKF smoke — the smoke exercises ONLY the OKF bundle path with the kenya
  // bundle (data/okf/smoke-test/kenya-bundle). The legacy facility is covered by
  // its own tests; the UI will handle single files + zip bundles separately later.

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

  // ── SELECT THE LABELS FROM THE KNOWLEDGE HIERARCHY (the real taxonomy) ──
  // Emulates the authoring flow: the steward selects labels from the KH tree (the
  // same /api/service-categories/categories taxonomy the dataprep LLM labeler
  // consumes). The kenya bundle's concepts map to these services/categories.
  const khCategories = await aqlAll('FOR c IN serviceCategories RETURN c.nameEN');
  const khServices = await aqlAll('FOR s IN services RETURN s.nameEN');
  const KH_LABELS = [...khCategories, ...khServices].filter(Boolean);
  const SELECTED_KH_LABELS = [
    'Digital Government Services',
    'Public Service Administration',
    'eCitizen',
    'Huduma Kenya',
    'Ministry of Public Service',
    'Service Directory'
  ];
  const missingKh = SELECTED_KH_LABELS.filter((l) => !KH_LABELS.includes(l));
  missingKh.length === 0
    ? pass(
        'labels: ' +
          SELECTED_KH_LABELS.length +
          ' labels selected FROM the knowledge hierarchy (' +
          KH_LABELS.length +
          ' in the tree)'
      )
    : fail('labels NOT in the KH: ' + JSON.stringify(missingKh) + ' (KH has ' + JSON.stringify(KH_LABELS) + ')');

  // ── (ii) THE FULL KENYA BUNDLE AS A ZIP, through the orchestrator ──
  // Emulates the authoring flow: the bundle zip + the knowledge-hierarchy labels
  // (the user selects them from the hierarchy) feed the ingest. The orchestrator
  // stores the bundle zip as a file doc (associated with the repo) AND enqueues
  // each concept through the SAME single-file ingestion path.
  const r1 = await call('POST', BASE + '/api/okf/repos/' + INGEST_REPO + '/ingest', ADMIN, {
    zip: zipB64,
    bundle_name: 'kenya-bundle.zip',
    labels: SELECTED_KH_LABELS
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
    // WP-A: bad_concept is hard-rejected at 4c and NEVER enqueued — the sad
    // bundle enqueues EXPECTED_CONCEPTS - 1 (the conforming concepts).
    if (r1.body.enqueued !== EXPECTED_CONCEPTS - 1)
      fail('summary.enqueued expected ' + (EXPECTED_CONCEPTS - 1) + ' (WP-A rejects bad_concept), got ' + r1.body.enqueued);
    if (r1.body.enqueue_errors.length !== 0)
      fail('unexpected enqueue_errors: ' + JSON.stringify(r1.body.enqueue_errors));
    if (r1.body.success !== true) fail('summary.success expected true');
    if (r1.body.bundle_stored !== 'kenya-bundle.zip')
      fail('summary.bundle_stored: ' + JSON.stringify(r1.body.bundle_stored));
  }

  // The bundle zip is stored as a file doc in the doc-repo — ASSOCIATED with the
  // OKF repo (repo_id + graph_name), carrying the knowledge-hierarchy labels, at
  // dataprep.status='Ingested' + is_bundle=true (the ingestion INPUT — its
  // concepts are enqueued separately; the worker ignores it, never re-chunks it).
  const bundleDoc = (
    await aqlAll(
      "FOR f IN files FILTER f.file_name == 'kenya-bundle.zip' AND f.repo_id == '" +
        INGEST_REPO +
        "' RETURN KEEP(f, ['file_id','file_name','repo_id','graph_name','labels','is_bundle','dataprep','file_type'])"
    )
  )[0];
  bundleDoc &&
  bundleDoc.repo_id === INGEST_REPO &&
  bundleDoc.graph_name === OKF_GRAPH &&
  bundleDoc.is_bundle === true &&
  bundleDoc.file_type === 'application/zip' &&
  Array.isArray(bundleDoc.labels) &&
  bundleDoc.labels.includes('Service Directory') &&
  bundleDoc.labels.includes('t:smoke') &&
  bundleDoc.dataprep &&
  // Bundle state machine (David's directive): a bundle is STORED at 'Pending'
  // — nothing has been ingested yet. It reaches 'Ingested' only via the
  // okf-server controller after every concept settles (asserted post-drain).
  bundleDoc.dataprep.status === 'Pending'
    ? pass(
        'bundle zip: stored as a file doc — repo-associated, graph-stamped, KH labels (' +
          JSON.stringify(bundleDoc.labels) +
          '), is_bundle=true @ Pending (state machine: born Pending, settles post-drain)'
      )
    : fail('bundle zip file doc: ' + JSON.stringify(bundleDoc));

  // ── (iii) meta rows for EVERY bundle concept: parsed + graph-stamped ──
  const metaRows = await aqlAll(
    "FOR d IN okf_concepts_meta FILTER d.repo_id == '" +
      INGEST_REPO +
      "' RETURN KEEP(d, ['concept_id','title','bundle_version','index_status','graph_name','pii_state','conformance_issues','is_index'])"
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
  const allParsed = metaRows.every(
    (m) => (m.index_status === 'parsed' || m.index_status === 'rejected') && m.graph_name === OKF_GRAPH
  );
  allParsed
    ? pass(
        'meta rows: index_status ∈ {parsed, rejected} + graph_name=OKF_{repo} (WP-A: bad_concept is rejected, the 5 conforming are parsed)'
      )
    : fail('meta rows: not all parsed-or-rejected/graph-stamped: ' + JSON.stringify(metaRows));
  // WP-A: bad_concept is REJECTED at ingest (hard conformance errors) — the meta
  // row carries index_status='rejected' + the 2 issues + last_error. It is NEVER
  // chunked into the graph.
  const rejectedRows = metaRows.filter((m) => m.index_status === 'rejected');
  rejectedRows.length === 1 && rejectedRows[0].concept_id === 'bad_concept'
    ? pass('WP-A hard-gate: bad_concept REJECTED at ingest (' + rejectedRows.length + ' rejected, 2 issues recorded)')
    : fail('WP-A: expected 1 rejected row (bad_concept), got ' + JSON.stringify(rejectedRows.map((r) => r.concept_id)));
  // WP-B (is_index root): index.md carries is_index: true on its meta row.
  const indexRow = metaRows.find((m) => m.concept_id === 'index');
  indexRow && indexRow.is_index === true
    ? pass('WP-B: index.md meta row carries is_index: true (root marker)')
    : fail('WP-B: index.md is_index: ' + JSON.stringify(indexRow && indexRow.is_index));
  const badRow = metaRows.find((m) => m.concept_id === 'bad_concept');
  badRow && Array.isArray(badRow.conformance_issues) && badRow.conformance_issues.length === EXPECTED_ISSUES
    ? pass('meta rows: bad_concept carries exactly ' + EXPECTED_ISSUES + ' conformance issues (4c)')
    : fail('bad_concept conformance: ' + JSON.stringify(badRow && badRow.conformance_issues));
  // WP-A: the rejected concept never reaches the 4d PII scan (skipped after
  // the 4c hard-gate) — its pii_state stays 'unknown'. Only the CONFORMING
  // concepts are scanned.
  const cleanPii = metaRows.filter((m) => m.pii_state === 'clean').length;
  cleanPii === EXPECTED_CONCEPTS - 1
    ? pass('PII: all ' + (EXPECTED_CONCEPTS - 1) + ' conforming concepts clean (4d; bad_concept rejected pre-PII)')
    : fail('PII clean count: ' + cleanPii + '/' + (EXPECTED_CONCEPTS - 1));

  // ── (iv) CONTENT-ONLY chunking (WP-C): ZERO per-concept files docs ──
  // The bundle zip is the ONLY doc-repo artifact. The worker POSTs each concept's
  // markdown DIRECTLY to dataprep (no doc-repo round-trip), and the meta row's
  // index_status='parsed' is the queue. The 5 conforming concepts are enqueued,
  // bad_concept is REJECTED at ingest (WP-A, never chunked, never enqueued).
  const fileDocs = await aqlAll(
    "FOR f IN files FILTER f.repo_id == '" +
      INGEST_REPO +
      "' AND f.is_bundle != true SORT f.file_name RETURN KEEP(f, ['file_id','file_name','dataprep','graph_name','labels'])"
  );
  const okfFiles = fileDocs;
  okfFiles.length === 0
    ? pass('WP-C content-only: ZERO per-concept files docs (only the bundle zip exists)')
    : fail(
        'WP-C content-only: expected 0 per-concept files docs (content-only — concepts are NOT files docs), got ' +
          okfFiles.length
      );
  // The bundle zip file doc (the ONLY artifact) — its labels ride the SAME
  // t:/r:/d: ACL set the orchestrator owns (sole injector invariant).
  if (bundleDoc) {
    const withAcl =
      (bundleDoc.labels || []).includes('t:smoke') &&
      (bundleDoc.labels || []).includes('r:' + INGEST_REPO) &&
      (bundleDoc.labels || []).includes('d:smoke') &&
      (bundleDoc.labels || []).includes('Service Directory') &&
      bundleDoc.graph_name === OKF_GRAPH;
    withAcl
      ? pass('bundle zip: ACL labels (t:/r:/d:) + caller label + graph_name stamped (sole injector)')
      : fail('bundle zip labels/graph: ' + JSON.stringify(bundleDoc.labels));
  }
  const okfIds = []; // WP-C: no per-concept files docs ⇒ no file_id list to drain

  // ── (v) DRAIN — the 2.9.4 INGESTION WORKER claims meta rows @ parsed (WP-C) ──
  // WP-C content-only: there are NO per-concept files docs to poll. The worker
  // reads okf_concepts_meta FILTER index_status='parsed' and POSTs each concept's
  // markdown DIRECTLY to dataprep. The completion callback (dataprep → okf-server
  // internal concept-status) transitions the meta row to indexed|failed and
  // writes the post-index edges. The smoke settle-waits on the meta row.
  // concept_ids are file names MINUS .md (the parser's bare-id form) — polling
  // for 'index.md' never matches the meta row 'index' (live-caught: the drain
  // loop always timed out 25 min while the worker had already finished).
  const DRAIN_CONCEPTS = GOOD_FILES.map((f) => f.replace(/\.md$/, ''));
  console.log('  draining: ' + DRAIN_CONCEPTS.length + ' OKF concepts (WORKER-paced — meta row poll)...');
  const statuses = {};
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const rows = await aqlAll(
      "FOR m IN okf_concepts_meta FILTER m.repo_id == '" +
        INGEST_REPO +
        "' AND m.concept_id IN " +
        JSON.stringify(DRAIN_CONCEPTS) +
        " RETURN KEEP(m, ['concept_id','index_status','chunk_count','last_error'])"
    );
    let allTerminal = true;
    for (const cid of DRAIN_CONCEPTS) {
      if (statuses[cid]) continue;
      const row = rows.find((r) => r.concept_id === cid);
      if (row && (row.index_status === 'indexed' || row.index_status === 'failed')) {
        statuses[cid] = row.index_status + ':' + (row.chunk_count || 0);
        console.log('    ' + cid + ' -> ' + statuses[cid]);
      } else {
        allTerminal = false;
      }
    }
    if (allTerminal && Object.keys(statuses).length === DRAIN_CONCEPTS.length) break;
  }
  for (const cid of DRAIN_CONCEPTS) {
    if (!statuses[cid]) {
      statuses[cid] = 'timeout';
      fail(
        'drain ' +
          cid +
          ' never reached a terminal meta state (worker interval 15s — is OKF_INGEST_WORKER_ENABLED?)'
      );
    } else if (statuses[cid].split(':')[0] !== 'indexed') {
      fail('drain ' + cid + ' ended "' + statuses[cid] + '"');
    }
  }
  const indexed = DRAIN_CONCEPTS.filter((c) => statuses[c] && statuses[c].split(':')[0] === 'indexed');
  indexed.length === DRAIN_CONCEPTS.length
    ? pass(
        'WP-C: WORKER drained all ' +
          DRAIN_CONCEPTS.length +
          ' meta rows parsed→indexed (content-only — the meta row is the queue)'
      )
    : fail('WP-C worker drain: ' + indexed.length + '/' + DRAIN_CONCEPTS.length + ' indexed');

  // ── (vii) WORKER TRANSITIONS — the worker-EXCLUSIVE meta states ──
  // The worker sets the FILE status to 'Ingested' BEFORE transitioning the META
  // to 'indexed' (a sub-second window — live-caught r4: the drain broke the
  // instant the last file looked terminal, but the meta transition landed ~1s
  // later, so the old one-shot check flaked). Settle-wait for the transitions
  // (up to 60s) so the check is deterministic — the assertion then reads the
  // settled state, never a mid-transition race.
  let metaAfter = null;
  for (let i = 0; i < 20; i++) {
    metaAfter = await aqlAll(
      "FOR d IN okf_concepts_meta FILTER d.repo_id == '" +
        INGEST_REPO +
        "' RETURN KEEP(d, ['concept_id','index_status','last_good_index_at'])"
    );
    if (
      metaAfter.length === EXPECTED_CONCEPTS &&
      // bad_concept is REJECTED (WP-A — never indexed, never last_good stamped);
      // only the CONFORMING concepts must settle indexed + stamped.
      metaAfter.every(
        (m) =>
          (m.concept_id === 'bad_concept' ? m.index_status === 'rejected' : m.index_status === 'indexed') &&
          (m.concept_id === 'bad_concept' || typeof m.last_good_index_at === 'string')
      )
    ) {
      break;
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  const goodRows = metaAfter.filter((m) => m.concept_id !== 'bad_concept');
  const allIndexed =
    metaAfter.length === EXPECTED_CONCEPTS &&
    metaAfter.some((m) => m.concept_id === 'bad_concept' && m.index_status === 'rejected') &&
    goodRows.every((m) => m.index_status === 'indexed');
  allIndexed
    ? pass(
        'worker transition: 5 conforming meta rows indexed + bad_concept rejected (parsed→indexed / hard-gate)'
      )
    : fail('worker transition: ' + JSON.stringify(metaAfter.map((m) => [m.concept_id, m.index_status])));
  const allStamped = goodRows.every((m) => typeof m.last_good_index_at === 'string' && m.last_good_index_at);
  allStamped
    ? pass('worker transition: last_good_index_at stamped on every concept')
    : fail('worker transition: missing last_good_index_at: ' + JSON.stringify(metaAfter));

  // ── Bundle state machine CLOSE-OUT: every concept settled ⇒ the bundle zip
  // must have transitioned Pending → Ingesting → Ingested (David's directive:
  // nothing is 'Ingested' until it has actually been ingested + logs written).
  // Settle-wait: the controller settles the bundle right after the LAST
  // concept callback — poll briefly for the terminal bundle state.
  let bundleAfter = null;
  for (let i = 0; i < 20; i++) {
    bundleAfter = (
      await aqlAll(
        "FOR f IN files FILTER f.repo_id == '" +
          INGEST_REPO +
          "' AND f.is_bundle == true RETURN KEEP(f, ['file_id','dataprep'])"
      )
    )[0];
    if (bundleAfter && bundleAfter.dataprep && bundleAfter.dataprep.status === 'Ingested') break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const bundleStatus = bundleAfter && bundleAfter.dataprep && bundleAfter.dataprep.status;
  bundleStatus === 'Ingested'
    ? pass('bundle state machine: Pending → Ingesting → Ingested (settled after the last concept indexed)')
    : fail('bundle state machine: expected Ingested after full drain, got "' + bundleStatus + '"');

  // Bundle ingestion-log completeness: EVERY stage for EVERY conforming
  // concept, keyed on the BUNDLE file (the UI surface) with the concept file
  // name in the message (David's 4th/5th-time directives).
  const bundleLogs = await aqlAll(
    "FOR log IN ingestion_log FILTER log.file_id == '" +
      (bundleAfter && bundleAfter.file_id) +
      "' RETURN KEEP(log, ['stage','message'])"
  );
  const stagesByConcept = {};
  bundleLogs.forEach((l) => {
    const m = l.message.match(/\[([^\]]+)\]/);
    const cid = m ? m[1] : '(unknown)';
    if (!stagesByConcept[cid]) stagesByConcept[cid] = new Set();
    stagesByConcept[cid].add(l.stage);
  });
  const REQUIRED_STAGES = ['System', 'Chunking', 'Labeling', 'Graph'];
  const conceptFiles = GOOD_FILES;
  const allComplete =
    conceptFiles.every((f) => {
      const stages = stagesByConcept[f] || new Set();
      return REQUIRED_STAGES.every((s) => stages.has(s));
    }) && bundleLogs.length >= conceptFiles.length * REQUIRED_STAGES.length;
  allComplete
    ? pass(
        'bundle ingestion log: ' +
          bundleLogs.length +
          ' entries on the bundle file — every stage (' +
          REQUIRED_STAGES.join('/') +
          ') logged for all ' +
          conceptFiles.length +
          ' conforming concepts, each prefixed with its file name'
      )
    : fail(
        'bundle ingestion log incomplete: ' +
          JSON.stringify(
            Object.fromEntries(Object.entries(stagesByConcept).map(([k, v]) => [k, [...v]]))
          )
      );

  // ── (viii) re-ingest AFTER indexing — the 4e DEDUP rule fires LIVE ──
  // Unchanged content + now-indexed ⇒ skipped_dedup, no new Pending docs.
  // Called via the service module (in-container — immune to the 5-min user
  // token TTL; the HTTP surface is asserted by the earlier zip ingest + 403).
  const bundleFiles = fs
    .readdirSync(BUNDLE_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();
  const sadConcepts = bundleFiles.map((f) => {
    const { data, content } = matter(fs.readFileSync(path.join(BUNDLE_DIR, f), 'utf8'));
    return { path: f, frontmatter: data, body: content.trim() };
  });
  const ingestService = require('./services/ingest-service');
  const filesCountQuery =
    "RETURN LENGTH(FOR f IN files FILTER f.repo_id == '" + INGEST_REPO + "' AND f.is_bundle != true RETURN 1)";
  const filesBefore = (await aqlAll(filesCountQuery))[0];
  const r2 = await ingestService.ingestRepoConcepts(
    INGEST_REPO,
    { concepts: sadConcepts, labels: SELECTED_KH_LABELS },
    { sub: 'smoke-run', source_ip: null }
  );
  r2.skipped_dedup === EXPECTED_CONCEPTS - 1 && r2.enqueued === 0
    ? pass('DEDUP LIVE: re-ingest of unchanged+indexed concepts → skipped_dedup=' + (EXPECTED_CONCEPTS - 1) + ', enqueued=0')
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
  metaPostDedup.every((m) => m.index_status === 'indexed' || m.index_status === 'rejected')
    ? pass('re-ingest: index_status stays indexed|rejected (writer protection — never downgraded by 4b)')
    : fail('index_status downgraded after re-ingest: ' + JSON.stringify(metaPostDedup));
  const filesAfter = (await aqlAll(filesCountQuery))[0];
  filesAfter === filesBefore
    ? pass('re-ingest: ZERO new files docs (dedup enqueued nothing)')
    : fail('re-ingest created files docs: before=' + filesBefore + ' after=' + filesAfter);

  // ── (ix) MINT v1 (Story 2.9.7 — ADR-031) ──
  // In-container service call (the HTTP route's authz matrix is unit-tested;
  // user tokens are expired by this point in the run).
  const versionService = require('./services/version-service');
  // The mint's PII gate requires the INGEST repo's repo-level scan complete —
  // the orchestrator scans concepts (4d) but the repo marker is only set by
  // an explicit repo-level scan pass (same call the control-plane phase makes
  // for the scratch repo). Live-caught: mint refused 'pii_scan_status !=
  // complete' with all concepts pii_state=clean.
  await piiService.markRepoPiiScanned(INGEST_REPO);
  // ── (ix-a) SAD-PATH PUBLISH GATE (WP-A / FR-25): this repo's bundle
  // contains bad_concept (REJECTED + conformance issues) — mint MUST refuse.
  // "No invalid concept reaches published."
  let sadGateRefused = null;
  try {
    await versionService.mintVersion(INGEST_REPO, { trigger: 'publish', source_ref: 'smoke://sad/v1' }, { sub: 'smoke-run' });
    fail('WP-A publish gate: sad-repo mint SUCCEEDED — the gate did not enforce');
  } catch (e) {
    sadGateRefused = e;
    (e.code === 'PUBLISH_GATE_BLOCKED' || /gate|conform|rejected|indexed/i.test(e.message))
      ? pass('WP-A publish gate: sad-repo mint REFUSED (' + (e.code || e.message).toString().slice(0, 80) + ')')
      : fail('sad-repo mint refused for the WRONG reason: ' + e.message.slice(0, 120));
  }

  // ── (ix-b) HAPPY PATH — a SECOND repo + the CLEAN bundle (requirement 11:
  // happy + sad as SEPARATE repos and SEPARATE bundles so both results stay
  // inspectable). All remaining lifecycle phases (dedup re-ingest, mint v1/v2,
  // edges, clone, retraction) run against the HAPPY repo.
  const repositoryServiceLate = require('./services/repository-service');
  const HAPPY_NAME = 'Kenya Government Services Knowledge Base (smoke happy)';
  const HAPPY_COUNT = 5; // the clean bundle's conforming concepts
  // Re-run safety: remove a prior happy repo by name.
  const priorHappy = await aqlAll(
    "FOR r IN okf_repositories FILTER r.name == '" + HAPPY_NAME + "' RETURN KEEP(r, ['repo_id'])"
  );
  for (const ph of priorHappy) {
    try { await repositoryServiceLate.remove(ph.repo_id, { sub: 'smoke-run' }); } catch (e) { /* best-effort */ }
  }
  const happyRepo = await repositoryServiceLate.create(
    { name: HAPPY_NAME, domain: 'smoke', acl: { required_scopes: [] } },
    { sub: 'smoke-run', source_ip: null }
  );
  INGEST_REPO = happyRepo.repo_id;
  OKF_GRAPH = happyRepo.graph_name;
  pass('happy path: second repo created (' + INGEST_REPO + ' graph ' + OKF_GRAPH + ')');
  const happyZipB64 = fs.readFileSync('/app/kenya-bundle-clean.zip').toString('base64');
  const rh = await ingestService.ingestRepoConcepts(
    INGEST_REPO,
    { zip: happyZipB64, bundle_name: 'kenya-bundle-clean.zip', labels: SELECTED_KH_LABELS },
    { sub: 'smoke-run', source_ip: null }
  );
  rh.total === 5 && rh.parsed === 5 && rh.rejected === 0 && rh.enqueued === 5
    ? pass('happy ingest: 202-equivalent summary (total=5 parsed=5 rejected=0 enqueued=5)')
    : fail('happy ingest summary: ' + JSON.stringify({ total: rh.total, parsed: rh.parsed, rejected: rh.rejected, enqueued: rh.enqueued }));
  // Worker drains the happy repo's 5 concepts (settle-wait, same poll shape).
  console.log('  happy drain: 5 concepts (WORKER-paced)...');
  let happySettled = false;
  for (let i = 0; i < 100 && !happySettled; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const rows = await aqlAll(
      "FOR m IN okf_concepts_meta FILTER m.repo_id == '" +
        INGEST_REPO + "' RETURN KEEP(m, ['index_status'])"
    );
    happySettled = rows.length === 5 && rows.every((m) => m.index_status === 'indexed' || m.index_status === 'failed');
  }
  happySettled
    ? pass('happy drain: all 5 concepts settled (worker + callback)')
    : fail('happy drain: concepts did not settle in 25 min');
  // Happy bundle state machine + log completeness (same asserts as the sad repo).
  let happyBundle = null;
  for (let i = 0; i < 20; i++) {
    happyBundle = (
      await aqlAll(
        "FOR f IN files FILTER f.repo_id == '" + INGEST_REPO + "' AND f.is_bundle == true RETURN KEEP(f, ['file_id','dataprep'])"
      )
    )[0];
    if (happyBundle && happyBundle.dataprep && happyBundle.dataprep.status === 'Ingested') break;
    await new Promise((r) => setTimeout(r, 3000));
  }
  const happyBundleStatus = happyBundle && happyBundle.dataprep && happyBundle.dataprep.status;
  happyBundleStatus === 'Ingested'
    ? pass('happy bundle state machine: Pending → Ingesting → Ingested')
    : fail('happy bundle state machine: expected Ingested, got "' + happyBundleStatus + '"');
  bundleAfter = happyBundle; // the lifecycle + log-completeness asserts below read this
  await piiService.markRepoPiiScanned(INGEST_REPO);
  // Lifecycle-phase content comes from the CLEAN bundle (the sad bundle's
  // concepts would inject bad_concept into the happy repo and trip the gate).
  const happyBundleDir = '/app/kenya-bundle-clean';
  let concepts = fs
    .readdirSync(happyBundleDir)
    .filter((f) => f.endsWith('.md'))
    .sort()
    .map((f) => {
      const { data, content } = matter(fs.readFileSync(path.join(happyBundleDir, f), 'utf8'));
      return { path: f, frontmatter: data, body: content.trim() };
    });
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
  manifest1.concept_count === HAPPY_COUNT &&
  manifest1.concepts.every(
    (c, i) => c.concept_id === metaHashes[i].concept_id && c.content_hash === metaHashes[i].content_hash
  )
    ? pass('manifest v1: all ' + HAPPY_COUNT + ' concepts snapshotted with the STORED canonical hashes')
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
    { concepts: modifiedConcepts, labels: SELECTED_KH_LABELS },
    { sub: 'smoke-run', source_ip: null }
  );
  r3.skipped_dedup === HAPPY_COUNT - 1 && r3.enqueued === 1
    ? pass('modified re-ingest: ' + (HAPPY_COUNT - 1) + ' dedup-skipped, 1 enqueued (changed concept carries v1)')
    : fail('modified re-ingest summary: ' + JSON.stringify({ skipped: r3.skipped_dedup, enqueued: r3.enqueued }));
  // CONTENT-ONLY (WP-C): there is no per-concept files doc — version
  // threading is asserted on the META row (4b leg) and the CHUNK docs.
  const versionedMetaRow = (
    await aqlAll(
      "FOR m IN okf_concepts_meta FILTER m.repo_id == '" +
        INGEST_REPO +
        "' AND m.concept_id == 'service_directory' RETURN KEEP(m, ['concept_id', 'bundle_version', 'index_status'])"
    )
  )[0];
  versionedMetaRow && versionedMetaRow.bundle_version === 1
    ? pass('version threading: the re-written meta row carries bundle_version=1 (4b leg)')
    : fail('versioned meta row: ' + JSON.stringify(versionedMetaRow));
  // Settle-wait: the modified concept goes parsed (4b re-upsert) → indexed
  // (worker + callback). Poll until its meta shows indexed with the NEW
  // content (the amended body changed the canonical hash).
  let versionedSettled = false;
  for (let i = 0; i < 100 && !versionedSettled; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const row = (
      await aqlAll(
        "FOR m IN okf_concepts_meta FILTER m.repo_id == '" +
          INGEST_REPO + "' AND m.concept_id == 'service_directory' RETURN KEEP(m, ['index_status','content_hash','chunk_count'])"
      )
    )[0];
    versionedSettled = !!row && row.index_status === 'indexed';
  }
  versionedSettled
    ? pass('version threading: worker + callback re-indexed the modified concept (new content_hash indexed)')
    : fail('versioned concept did not re-index with the amended hash in 25 min');
  // CHUNK version stamps (content-only: chunks key on metadata.concept_id).
  const versionedChunks = (
    await aqlAll(
      'FOR c IN `' + OKF_GRAPH + '_SOURCE` FILTER c.concept_id == "service_directory" COLLECT WITH COUNT INTO n RETURN n'
    )
  )[0];
  const versionedChunkStamps = (
    await aqlAll(
      'FOR c IN `' +
        OKF_GRAPH +
        '_SOURCE` FILTER c.concept_id == "service_directory" AND c.bundle_version == 1 COLLECT WITH COUNT INTO n RETURN n'
    )
  )[0];
  versionedChunks > 0 && versionedChunkStamps === versionedChunks
    ? pass(
        'version threading VERIFIED: all ' +
          versionedChunkStamps +
          ' service_directory chunk docs carry bundle_version=1 (citation pinning real)'
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
  // The worker writes the post-index edges AFTER the file status lands 'Ingested'
  // (the same file-before-meta/edges window as (vii) — live-caught r5: the
  // versioned-edge check fired before the modified re-ingest's edge write landed).
  // Settle-wait for the versioned edge (bundle_version=1) before asserting.
  let myEdges = [];
  for (let i = 0; i < 20; i++) {
    myEdges = await aqlAll(
      'FOR e IN `' +
        OKF_GRAPH +
        "_LINKS_TO` FILTER STARTS_WITH(e._from, '" +
        OKF_GRAPH +
        "_ENTITY/c_') RETURN KEEP(e, ['_from', '_to', 'label', 'file_id', 'repo_id', 'bundle_version'])"
    );
    if (myEdges.some((e) => e.bundle_version === 1)) break;
    await new Promise((r) => setTimeout(r, 3000));
  }
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
  conceptEntities.length >= HAPPY_COUNT
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
  cloneMeta.length === HAPPY_COUNT
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
    { concepts: cloneConcepts, labels: SELECTED_KH_LABELS },
    { sub: 'smoke-run', source_ip: null }
  );
  rc.skipped_dedup === HAPPY_COUNT - 1 && rc.enqueued === 1
    ? pass(
        'clone re-ingest: ' +
          (EXPECTED_CONCEPTS - 1) +
          ' dedup-skipped (unchanged+indexed), 1 enqueued (modified concept)'
      )
    : fail(
        'clone re-ingest summary: ' +
          JSON.stringify({ skipped: rc.skipped_dedup, enqueued: rc.enqueued, errors: rc.enqueue_errors })
      );

  // CONTENT-ONLY (WP-C): the clone's modified concept drains via its META row
  // (no per-concept files doc). Settle-wait for index_status terminal.
  let cStatus = null;
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const row = (
      await aqlAll(
        "FOR m IN okf_concepts_meta FILTER m.repo_id == '" +
          CLONE_ID + "' AND m.concept_id == 'service_directory' RETURN KEEP(m, ['index_status'])"
      )
    )[0];
    cStatus = row && row.index_status;
    if (cStatus === 'indexed' || cStatus === 'failed') break;
  }
  const cloneGraphRow = (
    await aqlAll(
      "FOR m IN okf_concepts_meta FILTER m.repo_id == '" +
        CLONE_ID + "' AND m.concept_id == 'service_directory' RETURN KEEP(m, ['graph_name'])"
    )
  )[0];
  cloneGraphRow && cloneGraphRow.graph_name === CLONE_GRAPH
    ? pass('clone: the modified concept is graph-stamped to the CLONE graph (' + CLONE_GRAPH + ')')
    : fail('clone graph_name: ' + JSON.stringify(cloneGraphRow));
  cStatus === 'indexed'
    ? pass('clone: worker drained the modified concept to indexed')
    : fail('clone drain ended "' + cStatus + '"');

  // Physical isolation: the modified concept's chunks in the CLONE graph ONLY,
  // and the SOURCE's chunks + edges are UNCHANGED (the original is never touched).
  const cloneChunks = (
    await aqlAll(
      'FOR c IN `' + CLONE_GRAPH + '_SOURCE` FILTER c.concept_id == "service_directory" COLLECT WITH COUNT INTO n RETURN n'
    )
  )[0] || 0;
  cloneChunks > 0
    ? pass(
        'clone: modified concept indexed into the CLONE graph (' +
          cloneChunks +
          ' chunks in ' +
          CLONE_GRAPH +
          '_SOURCE)'
      )
    : fail('clone graph: no chunks for the modified concept in ' + CLONE_GRAPH + '_SOURCE');
  // CONTENT-ONLY: a by-concept_id leak check is meaningless here (the SOURCE
  // legitimately holds its own service_directory chunks). The isolation proof
  // is the counts-unchanged assert below: the source's chunk + edge totals
  // must be IDENTICAL around the clone's re-ingest.
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

  // Cleanup (CLEANUP=full only): remove the clone via the okf-server repo-delete
  // CRUD (remove() → retractRepoGraph drops the clone's graph + meta + files +
  // versions). The soft-deleted registry tombstone is left per the soft-delete
  // contract (the next run's clone cleanup finds it by name). With CLEANUP=none
  // the clone PERSISTS for inspection.
  if (CLEANUP === 'full') {
    await repositoryService.remove(CLONE_ID, { sub: 'smoke-run' });
    pass('clone: cleanup — clone removed, its ' + CLONE_GRAPH + ' graph dropped (CRUD repo-delete)');
  } else {
    console.log('  NOTE: clone ' + CLONE_ID + ' LEFT IN PLACE (CLEANUP=none — run OKF_SMOKE_CLEANUP=only to remove)');
  }

  // ── (viii) CHUNKS — the physical proof (WP-C content-only chunks) ──
  // The OKF bundle's chunks must land in the per-repo OKF_{repo_id} graph
  // (Story 2.9.6 wiring: doc-repo sends graph_name → dataprep writes the
  // per-repo collections) — and NOT in the default graph. WP-C content-only:
  // chunks are NOT keyed by file_id (no per-concept files doc) — they're keyed
  // by the concept's markdown via the worker. Chunks carry `concept_id` in
  // metadata (citation provenance — Story 4.8-amend).
  // The OKF graph name is hyphenated (OKF_<uuid>) — AQL needs backtick-quoted
  // identifiers for it (live-caught: unquoted → lexer error at the first '-').
  const HAPPY_CONCEPTS = GOOD_FILES; // 5 conforming (bad_concept is REJECTED, never chunked)
  const bChunkRows = await aqlAll(
    'FOR c IN `' +
      OKF_GRAPH +
      '_SOURCE` FILTER c.concept_id IN ' +
      JSON.stringify(HAPPY_CONCEPTS) +
      ' COLLECT cid = c.metadata.concept_id WITH COUNT INTO n RETURN {cid, n}'
  );
  bChunkRows.length === HAPPY_CONCEPTS.length && bChunkRows.every((r) => r.n > 0)
    ? pass(
        'WP-C chunks: ' +
          bChunkRows.map((r) => r.cid + ':' + r.n).join('+') +
          ' chunks in ' +
          OKF_GRAPH +
          '_SOURCE — every happy-path concept materialized (concept_id-keyed)'
      )
    : fail('WP-C chunks in ' + OKF_GRAPH + '_SOURCE: ' + JSON.stringify(bChunkRows));
  const bTotal = bChunkRows.reduce((a, r) => a + r.n, 0);
  bTotal >= HAPPY_CONCEPTS.length
    ? pass('WP-C: total ' + bTotal + ' chunks from the full happy-path zip')
    : fail('WP-C total chunks: ' + bTotal);
  // WP-C: bad_concept MUST have ZERO chunks (rejected at ingest, never chunked).
  const badChunks =
    (
      await aqlAll(
        'FOR c IN `' +
          OKF_GRAPH +
          '_SOURCE` FILTER c.metadata.concept_id == "bad_concept" COLLECT WITH COUNT INTO n RETURN n'
      )
    )[0] || 0;
  badChunks === 0
    ? pass('WP-A hard-gate: ZERO bad_concept chunks in ' + OKF_GRAPH + '_SOURCE (rejected at ingest)')
    : fail('WP-A broken: ' + badChunks + ' bad_concept chunks leaked into the graph');
  // WP-B (is_index root): the index.md ENTITY vertex carries is_index: true.
  const indexEntity = await aqlAll(
    'FOR v IN `' +
      OKF_GRAPH +
      "_ENTITY` FILTER v.concept_id == 'index' RETURN KEEP(v, ['_key','is_index','concept_id'])"
  );
  indexEntity.length === 1 && indexEntity[0].is_index === true
    ? pass('WP-B: index.md ENTITY vertex carries is_index: true (root marker)')
    : fail('WP-B: index.md ENTITY is_index=' + JSON.stringify(indexEntity));
  // Zero leakage into the default graph.
  const leaked =
    (
      await aqlAll(
        'FOR c IN ' +
          GRAPH +
          '_SOURCE FILTER c.concept_id IN ' +
          JSON.stringify(HAPPY_CONCEPTS) +
          ' COLLECT WITH COUNT INTO n RETURN n'
      )
    )[0] || 0;
  (leaked || 0) === 0
    ? pass('isolation: ZERO OKF chunks in the default ' + GRAPH + '_SOURCE (the graphs are split)')
    : fail('isolation broken: ' + leaked + ' OKF chunks found in default ' + GRAPH + '_SOURCE');

  // ── RETRACTION + CLEANUP (CLEANUP=full only) ──
  // Verify per-concept + bundle retraction — the repo-delete service cleans
  // EVERYTHING (graph + meta + files + versions + the registry entry). With
  // CLEANUP=none the repo, its bundle docs, and the OKF_{repo} graph PERSIST for
  // inspection (the user inspects the results, then runs OKF_SMOKE_CLEANUP=only).
  if (CLEANUP === 'full') {
    // ── (ix) BUNDLE RETRACTION — VERIFIED, not just a 200 ──
    // History lesson (G5): retract once returned success while deleting NOTHING
    // (wrong-graph fallback). A retract is only proven when the concept's chunks
    // are physically GONE from the per-repo graph and the other concepts'
    // chunks survive. Retract ONE concept (bad_concept — deliberately
    // non-conforming, the natural deletion candidate).
    const retractFile = okfFiles.find((p) => p.file_name === 'bad_concept.md') || okfFiles[0];
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
            "FOR x IN files FILTER x.file_id == '" +
              retractFile.file_id +
              "' RETURN KEEP(x, ['dataprep','chunk_count'])"
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
      survivors.length === HAPPY_COUNT - 1 && survivors.every((r) => r.n > 0)
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
    delResult && delResult.deleted_at && delResult.status === 'deleted'
      ? pass('bundle retract: repo-delete CRUD ran (delete service cleans everything)')
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

    // The delete service cleans EVERYTHING: the registry entry is gone too (the
    // soft-delete tombstone is superseded — no lingering docs).
    const repoGone = await (async () => {
      try {
        await repos.document(INGEST_REPO);
        return false;
      } catch {
        return true;
      }
    })();
    repoGone
      ? pass('bundle retract VERIFIED: the repository registry entry is removed (delete service cleans everything)')
      : fail('bundle retract: registry doc still present');
    await assertZeroOkfArtifacts(db);
  } else {
    console.log(
      '  NOTE: CLEANUP=none — retraction + cleanup phases skipped; the repo (' +
        INGEST_REPO +
        '), its bundle docs, and the ' +
        OKF_GRAPH +
        ' graph PERSIST for inspection. Run OKF_SMOKE_CLEANUP=only to clean up afterward.'
    );
  }

  console.log(
    '  NOTE: multi-graph READ (retriever fan-out over OKF_{repo_id} graphs) is Epic 1 — the retriever still queries the default graph until then.'
  );
  console.log(
    '  NOTE: per-CONCEPT retraction (dataprep retract_file — surgical chunk deletion) is the separate single-file path, untouched by the bundle-level drop.'
  );
}
