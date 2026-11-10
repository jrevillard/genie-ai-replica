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
// WP-B (b0b28dc): the named gharial graph (OKF_<slug>_v<N> — the product's
// single naming authority, graph-lifecycle-service) is registered;
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
//      parsed+graph-stamped (the PRODUCT's own graph name, resolved through
//      workingGraphName — composing OKF_+repo_id was a second source of
//      truth, #1568) + 1 rejected with 2 issues; PII clean on the 5
//      conforming; ZERO per-concept files docs (WP-C content-only); bundle
//      zip stored as a file doc (repo-associated, graph-stamped, KH labels,
//      is_bundle @ Pending — the sad repo is publish-gate-REFUSED by design,
//      so Pending is its TERMINAL state; it can never drain and is never
//      asked to).
//   9. The LIFECYCLE walk arms the drain (the #1568 re-anchor): the happy
//      repo goes markRepoPiiScanned → submit → approve → publish (this mints
//      v1) → ingest — and ONLY the ingest transition writes rag_drain_active,
//      the worker's sole claim precondition. An unpublished repo NEVER
//      drains (R1 contract) — the old harness polled a drain that could not
//      legally start and named the wrong remedy. The 2.9.4 worker then
//      drains the happy repo's 5 parsed meta rows directly to dataprep (no
//      doc-repo round-trip — WP-C) and the concept-status callback
//      transitions each meta row parsed→indexed + writes within-repo edges
//      + stamps chunk_count + last_good_index_at.
//  10. Chunks in OKF_<slug>_vN_SOURCE carry concept_id (WP-C citation
//      provenance); the index.md root carries is_index: true on its ENTITY
//      vertex (WP-B); ZERO OKF chunks in the default graph (2.9.6 split);
//      re-ingest of unchanged+indexed concepts → skipped_dedup=N, enqueued=0
//      (the 4e dedup rule fires LIVE, on the happy repo post-drain), meta
//      rows stay indexed (no downgrade).
//  11. SAD-PATH MINT GATE (WP-A): mintVersion on the sad repo REFUSES
//      (PUBLISH_GATE_BLOCKED — bad_concept is rejected); HAPPY-PATH publish
//      SUCCEEDS (the lifecycle publish mints v1: manifest with 5 concepts +
//      stored canonical hashes + okf:v1; repo.version stamped).
//  12. Per-CONCEPT retraction is NOT asserted (removed post-WP-C, 2026-08-24
//      — concepts are not files docs, nothing per-concept exists to retract;
//      the natural candidate bad_concept has 0 chunks). Bundle-level
//      retraction (13) is the physical proof.
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
//      (new repo_id + the product's own graph name + lifecycle draft) with
//      cloned_from {repo_id, version: 2} + 5 meta rows copied verbatim
//      (title/bundle_version/content_hash/index_status preserved); the clone
//      walks the SAME lifecycle (a clone is born draft — its re-ingested
//      concept can only drain after publish→ingest), re-indexes into the
//      CLONE graph ONLY (dedup-skips the other 4), and the SOURCE's chunks
//      + edges are UNCHANGED (isolation).
//  16. HAPPY-PATH ZIP ingest: POST kenya-bundle-clean.zip → 202 with total=5/
//      parsed=5/rejected=0/enqueued=5; 5 meta rows parsed+graph-stamped;
//      ZERO per-concept files docs; bundle zip stored; worker drains to
//      indexed; chunks carry concept_id + is_index on the root; mint SUCCEEDS
//      with v1 (5 concepts + stored canonical hashes).
//  17. ARTIFACTS VIEW SOURCE (W6 / EPIC-6 / CAP-5): the bundle zip is listed
//      by `GET /api/files?is_bundle=true` and does NOT appear in the
//      `is_bundle=false` document list — the two views never mix — and it
//      carries its repo_id for the provenance pill.

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
// The orphan-manifest set captured BEFORE the run creates anything (the
// pre-clean section). The final assert compares against THIS — a shared
// ArangoDB can carry pre-existing dangling manifests from OTHER deletions
// (live-caught run 11), and they are not this run's leftovers.
let PREEXISTING_ORPHAN_MANIFESTS = null;

async function assertZeroOkfArtifacts(db) {
  const graphs = await listOkfGraphs(db);
  const cols = await db.listCollections();
  const okfCols = cols.filter((c) => String(c.name).startsWith('OKF_'));
  // Orphan-manifest check (live-caught 2026-08-25), DELTA-SCOPED (#1568): every
  // okf_bundle_manifest doc must reference a LIVE repo — a deleted repo's
  // lingering manifest crowds discoverRepos' k-clamped candidate slice. This
  // ArangoDB hosts REAL repositories whose deletions are not this run's
  // business, so only orphans that APPEARED during this run are failures.
  const orphanManifests = (
    await (
      await db.query('FOR d IN okf_bundle_manifest FILTER !DOCUMENT(okf_repositories, d._key) RETURN d._key')
    ).all()
  ).filter((k) => !(PREEXISTING_ORPHAN_MANIFESTS && PREEXISTING_ORPHAN_MANIFESTS.has(k)));
  if (orphanManifests.length > 0) {
    fail(
      'cleanup NOT clean: ' +
        orphanManifests.length +
        ' NEW ORPHAN okf_bundle_manifest docs (repo gone): ' +
        orphanManifests.join(',')
    );
  }
  // SMOKE-SCOPED (#1568, live-caught run 11): a shared ArangoDB carries REAL
  // repositories' serving graphs (Solar System, Bali, Quran, El Salvador...).
  // The assert covers what THIS RUN owns — every graph or collection under the
  // smoke repos' slug prefix must be gone after CLEANUP=full. Non-smoke OKF_*
  // artifacts are live state, counted and reported, never failed on.
  const SMOKE_GRAPH_PREFIX = 'OKF_kenya-government-services-knowledge-base-smoke';
  const smokeGraphs = graphs.filter((g) => String(g.name).startsWith(SMOKE_GRAPH_PREFIX));
  const smokeCols = okfCols.filter((c) => String(c.name).startsWith(SMOKE_GRAPH_PREFIX));
  if (smokeGraphs.length === 0 && smokeCols.length === 0) {
    pass(
      'cleanup VERIFIED: ZERO smoke-owned OKF_* graphs + collections remain (' +
        graphs.length +
        ' non-smoke OKF_* graphs belong to live repositories — untouched)'
    );
    return true;
  }
  fail(
    'cleanup NOT clean: ' +
      smokeGraphs.length +
      ' smoke OKF_* graphs (' +
      smokeGraphs.map((g) => g.name).join(',') +
      ') + ' +
      smokeCols.length +
      ' smoke OKF_* collections (' +
      smokeCols.map((c) => c.name).join(',') +
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
        '  cleanup: removed ' +
          scratchRows[0] +
          ' control-plane scratch meta rows (repo ' +
          REPO_ID +
          ') — worker-race guard'
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
    // The pre-run orphan snapshot (the final assert is DELTA-scoped — see
    // assertZeroOkfArtifacts): dangling manifests that exist BEFORE this run
    // are not this run's leftovers.
    PREEXISTING_ORPHAN_MANIFESTS = new Set(
      await aqlAll('FOR d IN okf_bundle_manifest FILTER !DOCUMENT(okf_repositories, d._key) RETURN d._key')
    );
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
  // The graph-name authority (#1568): the harness resolves the name through
  // the PRODUCT's single source of truth — the same workingGraphName() call
  // ingest-service makes when it stamps the meta rows (:712) — never by
  // composing 'OKF_' + repo_id (the legacy anchor shape the registry keeps
  // only as an immutable technical holdover; the live graphs are
  // OKF_<slug>_v<N>).
  const { workingGraphName } = require('./services/graph-lifecycle-service');
  if (createRes.status === 201 && createRes.body && createRes.body.repo_id) {
    INGEST_REPO = createRes.body.repo_id;
    OKF_GRAPH = workingGraphName(
      (await aqlAll("FOR r IN okf_repositories FILTER r.repo_id == '" + INGEST_REPO + "' RETURN r"))[0]
    );
    pass(
      'flow: OKF repository "' +
        REPO_NAME +
        '" created via the API (repo_id=' +
        INGEST_REPO +
        ', graph ' +
        OKF_GRAPH +
        ' resolved via workingGraphName)'
    );
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

  // ── (i) scoped READ caller → 403 (import is an admin mutation) ──
  // Contract (David 2026-09-04): "import" is the creation word — POST /import;
  // the old POST /ingest is retired (410) and RAG ingestion is the lifecycle
  // 'ingest' action. Same admin-scope gate either way.
  const zipB64 = fs.readFileSync(BUNDLE_ZIP).toString('base64');
  const s1 = await call('POST', BASE + '/api/okf/repos/' + INGEST_REPO + '/import', SCOPED, { zip: zipB64 });
  s1.status === 403 && s1.body && s1.body.error === 'FORBIDDEN_SCOPE'
    ? pass('import: scoped READ caller -> 403 FORBIDDEN_SCOPE (zip body)')
    : fail('import scoped-read -> ' + s1.status + ' ' + JSON.stringify(s1.body).slice(0, 100));

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
  const r1 = await call('POST', BASE + '/api/okf/repos/' + INGEST_REPO + '/import', ADMIN, {
    zip: zipB64,
    bundle_name: 'kenya-bundle.zip',
    labels: SELECTED_KH_LABELS
  });
  if (r1.status !== 202) {
    fail('zip import 202 expected, got ' + r1.status + ': ' + JSON.stringify(r1.body).slice(0, 220));
  } else {
    pass(
      'zip import admin -> 202 (total=' +
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
      fail(
        'summary.enqueued expected ' + (EXPECTED_CONCEPTS - 1) + ' (WP-A rejects bad_concept), got ' + r1.body.enqueued
      );
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
          '), is_bundle=true @ Pending. The sad repo is publish-gate-REFUSED by ' +
          'design (bad_concept), so Pending is its TERMINAL state — it never drains and is never asked to ' +
          '(the happy repo below proves the full Pending → Ingesting → Ingested walk)'
      )
    : fail('bundle zip file doc: ' + JSON.stringify(bundleDoc));

  // ── W6 / EPIC-6 / CAP-5: the ARTIFACTS VIEW's data source ──────────────
  // The admin dashboard's OKF artifacts view lists doc-repo's bundles through
  // `GET /api/files?is_bundle=true` and labels every row with its
  // provenance (the repository it came from + the version it was minted for).
  // The filter must SEPARATE the artifacts from the documents — that
  // separation is the whole point of the view: the bundle zips used to sit
  // in the document list unlabeled, carrying a Delete affordance the server
  // refuses (WS2 → 403 BUNDLE_PROTECTED for every caller but okf-service).
  //
  // The SERVICE token is used (re-mintable, never a 5-min TTL race) and the
  // list is narrowed to the smoke repo (WP-C: the bundle zip is that repo's
  // ONLY file doc — the concepts are content-only, never files docs).
  const svcW6 = await serviceToken();
  const listFor = async (isBundle) => {
    const res = await call(
      'GET',
      DOCREPO + '/api/files?limit=50&repo_id=' + encodeURIComponent(INGEST_REPO) + '&is_bundle=' + isBundle,
      svcW6
    );
    return res.status === 200 ? res.body.data || [] : null;
  };
  const bundledRows = await listFor('true');
  const plainRows = await listFor('false');
  if (!bundledRows) {
    fail('artifacts view source: the is_bundle=true list read failed');
  } else if (!plainRows) {
    fail('artifacts view source: the is_bundle=false list read failed');
  } else {
    const bundleFileId = bundleDoc && bundleDoc.file_id;
    const mine = bundledRows.filter((f) => f.file_id === bundleFileId);
    mine.length === 1
      ? pass('artifacts view source: the bundle is listed by is_bundle=true (' + bundleFileId + ')')
      : fail(
          'artifacts view source: the bundle is NOT in the is_bundle=true list: ' +
            JSON.stringify(bundledRows.map((f) => f.file_id))
        );
    plainRows.some((f) => f.file_id === bundleFileId)
      ? fail('artifacts view source: the bundle LEAKED into the is_bundle=false document list')
      : pass('artifacts view source: the bundle does NOT appear in the document list (the two views never mix)');
    // The provenance the view renders: the repository the artifact came
    // from. (The VERSION is stamped by the mint phase — a bundle that
    // carries none reads "unknown version", which the view renders as such
    // rather than guessing a number.)
    mine[0] && mine[0].repo_id === INGEST_REPO
      ? pass('artifacts view source: the bundle carries its repository (repo_id) for the provenance pill')
      : fail('artifacts view source: the bundle carries no repo_id: ' + JSON.stringify(mine[0]));
  }

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

  // ── WHY THERE IS NO DRAIN ON THE SAD REPO (#1568 re-anchor) ──
  // The worker claims rows ONLY for repos with rag_drain_active == true, and
  // that flag is written by exactly ONE place: the lifecycle 'ingest'
  // transition (lifecycle-service armRagDrain) — which requires the repo to
  // be PUBLISHED first. The sad repo can never publish (bad_concept is
  // rejected; the gate below proves the refusal), so it can never legally
  // drain. The old harness polled a drain that could not start and told the
  // reader to check OKF_INGEST_WORKER_ENABLED — the wrong remedy for a
  // precondition the flow itself never met. ALL drain-dependent coverage
  // (worker drain, transitions, bundle settle, manifest, author edges,
  // ingestion log, dedup-live) runs against the HAPPY repo, which walks the
  // real lifecycle below.

  // ── (ix) SAD-PATH PUBLISH GATE (WP-A / FR-25) — this is the ONLY mint the
  // sad repo ever attempts; the happy repo's v1 mint happens inside the
  // lifecycle publish transition below (#1568 re-anchor).
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
    await versionService.mintVersion(
      INGEST_REPO,
      { trigger: 'publish', source_ref: 'smoke://sad/v1' },
      { sub: 'smoke-run' }
    );
    fail('WP-A publish gate: sad-repo mint SUCCEEDED — the gate did not enforce');
  } catch (e) {
    sadGateRefused = e;
    e.code === 'PUBLISH_GATE_BLOCKED' || /gate|conform|rejected|indexed/i.test(e.message)
      ? pass('WP-A publish gate: sad-repo mint REFUSED (' + (e.code || e.message).toString().slice(0, 80) + ')')
      : fail('sad-repo mint refused for the WRONG reason: ' + e.message.slice(0, 120));
  }

  // ── (ix-b) HAPPY PATH — a SECOND repo + the CLEAN bundle (requirement 11:
  // happy + sad as SEPARATE repos and SEPARATE bundles so both results stay
  // inspectable). All drain-dependent phases (the lifecycle walk, the worker
  // drain, bundle settle, manifest, author edges, ingestion log, dedup,
  // mint v2 threading, edges, clone, retraction) run against the HAPPY repo —
  // it is the only one that can legally reach a drain, because it is the only
  // one that can publish (#1568).
  const repositoryServiceLate = require('./services/repository-service');
  const ingestService = require('./services/ingest-service');
  const HAPPY_NAME = 'Kenya Government Services Knowledge Base (smoke happy)';
  const HAPPY_COUNT = 5; // the clean bundle's conforming concepts
  // Re-run safety: remove a prior happy repo by name. A prior run can leave
  // the repo in 'approve' (a publish that failed mid-run — live-caught run 2
  // of the #1568 fix): remove() refuses a non-draft repo, so walk it to
  // retracted first, then delete; the AQL purge is the final hammer so the
  // create below can never 409 (the same pattern the clone pre-clean uses).
  const priorHappy = await aqlAll(
    "FOR r IN okf_repositories FILTER r.name == '" + HAPPY_NAME + "' RETURN KEEP(r, ['repo_id'])"
  );
  for (const ph of priorHappy) {
    try {
      await repositoryServiceLate.remove(ph.repo_id, { sub: 'smoke-run' });
    } catch (e) {
      try {
        await call('POST', BASE + '/api/okf/repos/' + ph.repo_id + '/lifecycle', ADMIN, { action: 'retract' });
        await repositoryServiceLate.remove(ph.repo_id, { sub: 'smoke-run' });
      } catch (e2) {
        console.log('  cleanup: prior happy ' + ph.repo_id + ' service remove failed (' + e2.message + ') — AQL purge');
      }
    }
    await aqlAll("FOR m IN okf_concepts_meta FILTER m.repo_id == '" + ph.repo_id + "' REMOVE m IN okf_concepts_meta");
    await aqlAll("FOR v IN okf_versions FILTER v.repo_id == '" + ph.repo_id + "' REMOVE v IN okf_versions");
    // The settle-path writes the manifest keyed on the repo id — purge it too,
    // or every prior-run repo leaves an orphan manifest behind (live-caught
    // run 11: the final zero-artifacts assert died on exactly these).
    await aqlAll("FOR d IN okf_bundle_manifest FILTER d._key == '" + ph.repo_id + "' REMOVE d IN okf_bundle_manifest");
    await aqlAll("FOR r IN okf_repositories FILTER r.repo_id == '" + ph.repo_id + "' REMOVE r IN okf_repositories");
  }
  const happyRepo = await repositoryServiceLate.create(
    { name: HAPPY_NAME, domain: 'smoke', acl: { required_scopes: [] } },
    { sub: 'smoke-run', source_ip: null }
  );
  // The SAD repo's id — captured BEFORE the reassignment so CLEANUP=full can
  // remove it at the end (the (x) retraction phase below now targets the HAPPY
  // repo; without this the sad repo's graph survived full-mode runs —
  // live-caught 2026-08-25, runs 5+6).
  const SAD_REPO = INGEST_REPO;
  INGEST_REPO = happyRepo.repo_id;
  // NOT the registry's graph_name field — the registry keeps OKF_{repo_id} as
  // an immutable technical ANCHOR only (the #1568 issue's own warning); the
  // live graph is whatever the product's authority computes for the doc
  // (live-caught: the registry anchor made the author-edge AQL miss the real
  // OKF_<slug>_vN_LINKS_TO).
  OKF_GRAPH = workingGraphName(await repos.document(INGEST_REPO));
  pass('happy path: second repo created (' + INGEST_REPO + ' graph ' + OKF_GRAPH + ' — via workingGraphName)');
  const happyZipB64 = fs.readFileSync('/app/kenya-bundle-clean.zip').toString('base64');
  const rh = await ingestService.ingestRepoConcepts(
    INGEST_REPO,
    { zip: happyZipB64, bundle_name: 'kenya-bundle-clean.zip', labels: SELECTED_KH_LABELS },
    { sub: 'smoke-run', source_ip: null }
  );
  rh.total === 5 && rh.parsed === 5 && rh.rejected === 0 && rh.enqueued === 5
    ? pass('happy ingest: 202-equivalent summary (total=5 parsed=5 rejected=0 enqueued=5)')
    : fail(
        'happy ingest summary: ' +
          JSON.stringify({ total: rh.total, parsed: rh.parsed, rejected: rh.rejected, enqueued: rh.enqueued })
      );

  // The publish gate refuses FLAGGED PII entities (review required), and the
  // clean bundle's concepts each carry one LOCATION hit — place names are
  // exactly what a government-services KB contains. The steward's flow is
  // scan → review → ACCEPT, so the harness walks the product's OWN bulk
  // accept (the same 'accept' action the editor's Accept-All drives; #1650
  // pinned an accepted PII state as a change publish certifies). Settle-wait
  // on the job registry — the bulk job is fire-and-forget by design.
  const piiBulkJob = piiService.startRepoBulkPiiJob(INGEST_REPO, { action: 'accept' }, { sub: 'smoke-run' });
  let piiBulk = null;
  for (let i = 0; i < 60; i++) {
    piiBulk = piiService.getRepoBulkPiiJob(piiBulkJob.job_id);
    if (piiBulk && (piiBulk.status === 'done' || piiBulk.status === 'failed')) break;
    await new Promise((r2) => setTimeout(r2, 1000));
  }
  piiBulk && piiBulk.status === 'done'
    ? pass('happy pii: bulk ACCEPT settled the flagged entities (' + JSON.stringify(piiBulk.result).slice(0, 140) + ')')
    : fail('happy pii bulk accept did not settle: ' + JSON.stringify(piiBulk));
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
  const HAPPY_BUNDLE_CONCEPTS = concepts.map((c) => c.path.replace(/\.md$/, ''));

  // ── THE LIFECYCLE WALK (#1568): an import NEVER drains — the drain arms
  // only through the lifecycle 'ingest' transition, which requires PUBLISHED.
  // The walk is markRepoPiiScanned → submit → approve → publish → ingest,
  // the exact flow the lifecycle harness pins (ALL PASS, 2026-11-09). The
  // publish mints v1 — the explicit mintVersion call the old harness made
  // here is gone (it would now mint a SECOND version).
  await piiService.markRepoPiiScanned(INGEST_REPO);
  pass('happy: repo PII scan marked complete (publish prerequisite)');
  let r;
  r = await call('POST', BASE + '/api/okf/repos/' + INGEST_REPO + '/lifecycle', ADMIN, { action: 'submit' });
  r.status === 200 && r.body && r.body.lifecycle_state === 'review'
    ? pass('happy lifecycle: submit → review')
    : fail('happy lifecycle submit → ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  r = await call('POST', BASE + '/api/okf/repos/' + INGEST_REPO + '/lifecycle', ADMIN, { action: 'approve' });
  r.status === 200 && r.body && r.body.lifecycle_state === 'approve'
    ? pass('happy lifecycle: approve → approve')
    : fail('happy lifecycle approve → ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 200));
  r = await call('POST', BASE + '/api/okf/repos/' + INGEST_REPO + '/lifecycle', ADMIN, { action: 'publish' });
  if (r.status !== 200 || !r.body || r.body.bundle_version !== 1) {
    fail('happy lifecycle publish → ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 300));
    return;
  }
  pass('happy lifecycle: publish → v1 minted (bundle ' + (r.body.bundle && r.body.bundle.file_name) + ')');
  r = await call('POST', BASE + '/api/okf/repos/' + INGEST_REPO + '/lifecycle', ADMIN, { action: 'ingest' });
  r.status === 200 || r.status === 202
    ? pass('happy lifecycle: ingest → ' + r.status + ' (rag_drain_active armed — the ONLY writer is this transition)')
    : fail('happy lifecycle ingest → ' + r.status + ' ' + JSON.stringify(r.body).slice(0, 300));

  // Publish-mint asserts — BEFORE the drain, while the meta rows still hold
  // the pristine import-time hashes (the (x) modified re-ingest below changes
  // service_directory's; the manifest is INSERT-only and must be compared now).
  const repoAfterMint = await repos.document(INGEST_REPO);
  repoAfterMint.version === 1 && repoAfterMint.okf_tag === 'okf:v1'
    ? pass('publish mint: repo doc version=1 + okf_tag=okf:v1 stamped')
    : fail(
        'repo doc after publish: ' + JSON.stringify({ version: repoAfterMint.version, okf_tag: repoAfterMint.okf_tag })
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
    ? pass('manifest v1: okf:v1 + trigger + minted_at recorded (the publish transition minted it)')
    : fail('manifest v1 metadata: ' + JSON.stringify(manifest1));

  // ── THE DRAIN (on the happy repo, via the armed worker) ──
  // WP-C content-only: the worker reads okf_concepts_meta FILTER
  // index_status='parsed' + rag_drain_active repo, POSTs each concept's
  // markdown DIRECTLY to dataprep, and the completion callback transitions the
  // meta row to indexed|failed. concept_ids are file names MINUS .md (polling
  // for 'index.md' never matches the meta row 'index' — live-caught).
  console.log('  happy drain: ' + HAPPY_BUNDLE_CONCEPTS.length + ' concepts (WORKER-paced — meta row poll)...');
  const drainStatuses = {};
  let happySettled = false;
  for (let i = 0; i < 100 && !happySettled; i++) {
    await new Promise((r2) => setTimeout(r2, 15000));
    const rows = await aqlAll(
      "FOR m IN okf_concepts_meta FILTER m.repo_id == '" +
        INGEST_REPO +
        "' AND m.concept_id IN " +
        JSON.stringify(HAPPY_BUNDLE_CONCEPTS) +
        " RETURN KEEP(m, ['concept_id','index_status','chunk_count','last_error'])"
    );
    for (const cid of HAPPY_BUNDLE_CONCEPTS) {
      if (drainStatuses[cid]) continue;
      const row = rows.find((x) => x.concept_id === cid);
      if (row && (row.index_status === 'indexed' || row.index_status === 'failed')) {
        drainStatuses[cid] = row.index_status + ':' + (row.chunk_count || 0);
        console.log('    ' + cid + ' -> ' + drainStatuses[cid]);
      }
    }
    happySettled = HAPPY_BUNDLE_CONCEPTS.every((c) => drainStatuses[c]);
  }
  for (const cid of HAPPY_BUNDLE_CONCEPTS) {
    if (!drainStatuses[cid]) {
      drainStatuses[cid] = 'timeout';
      fail(
        'drain ' +
          cid +
          ' never reached a terminal meta state. The REAL precondition: the repo must be PUBLISHED and the ' +
          "lifecycle 'ingest' transition must have armed rag_drain_active (the worker's sole claim filter) — " +
          'OKF_INGEST_WORKER_ENABLED is NOT the cause to chase (#1568)'
      );
    } else if (drainStatuses[cid].split(':')[0] !== 'indexed') {
      fail('drain ' + cid + ' ended "' + drainStatuses[cid] + '"');
    }
  }
  const drainIndexed = HAPPY_BUNDLE_CONCEPTS.filter(
    (c) => drainStatuses[c] && drainStatuses[c].split(':')[0] === 'indexed'
  );
  drainIndexed.length === HAPPY_BUNDLE_CONCEPTS.length
    ? pass(
        'WP-C: WORKER drained all ' +
          drainIndexed.length +
          ' meta rows parsed→indexed (content-only — the meta row is the queue)'
      )
    : fail('WP-C worker drain: ' + drainIndexed.length + '/' + HAPPY_BUNDLE_CONCEPTS.length + ' indexed');

  // Worker-EXCLUSIVE meta states: the worker sets the FILE status to
  // 'Ingested' BEFORE transitioning the META to 'indexed' (a sub-second
  // window — live-caught r4). Settle-wait, then assert the settled state:
  // every happy concept indexed + last_good_index_at stamped (the happy
  // bundle has no bad_concept — the rejected-row branch lives on the sad
  // repo's meta asserts above).
  let metaAfter = null;
  for (let i = 0; i < 20; i++) {
    metaAfter = await aqlAll(
      "FOR d IN okf_concepts_meta FILTER d.repo_id == '" +
        INGEST_REPO +
        "' RETURN KEEP(d, ['concept_id','index_status','last_good_index_at'])"
    );
    if (
      metaAfter.length === HAPPY_COUNT &&
      metaAfter.every((m) => m.index_status === 'indexed' && typeof m.last_good_index_at === 'string')
    ) {
      break;
    }
    await new Promise((r2) => setTimeout(r2, 3000));
  }
  const allIndexed = metaAfter.length === HAPPY_COUNT && metaAfter.every((m) => m.index_status === 'indexed');
  allIndexed
    ? pass('worker transition: all ' + HAPPY_COUNT + ' meta rows indexed (parsed→indexed)')
    : fail('worker transition: ' + JSON.stringify(metaAfter.map((m) => [m.concept_id, m.index_status])));
  const allStamped = metaAfter.every((m) => typeof m.last_good_index_at === 'string' && m.last_good_index_at);
  allStamped
    ? pass('worker transition: last_good_index_at stamped on every concept')
    : fail('worker transition: missing last_good_index_at: ' + JSON.stringify(metaAfter));

  // Bundle state machine close-out: every concept settled ⇒ the bundle zip
  // must have transitioned Pending → Ingesting → Ingested (David's directive:
  // nothing is 'Ingested' until it has actually been ingested + logs written).
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
    await new Promise((r2) => setTimeout(r2, 3000));
  }
  const bundleStatus = bundleAfter && bundleAfter.dataprep && bundleAfter.dataprep.status;
  bundleStatus === 'Ingested'
    ? pass('bundle state machine: Pending → Ingesting → Ingested (settled after the last concept indexed)')
    : fail('bundle state machine: expected Ingested after full drain, got "' + bundleStatus + '"');

  // ── Story B+C: the settled bundle's STRUCTURAL artifacts ──
  // (1) The manifest doc: concepts + author links + root, written by the
  //     settle path (deterministic body; LLM summary lazy on first read).
  // (2) Author-stated cross-concept links mirrored into _LINKS_TO with
  //     source='author' (the parser's markdown edges live alongside).
  // Settle-wait: the settle path writes these AFTER the bundle status PATCH —
  // poll briefly for the manifest to appear.
  let happyManifest = null;
  for (let i = 0; i < 20; i++) {
    happyManifest = (await aqlAll("FOR d IN okf_bundle_manifest FILTER d._key == '" + INGEST_REPO + "' RETURN d"))[0];
    if (happyManifest) break;
    await new Promise((r2) => setTimeout(r2, 3000));
  }
  const mfConcepts = happyManifest ? happyManifest.concepts || [] : [];
  const mfLinks = happyManifest ? happyManifest.links || [] : [];
  const conformingPresent = HAPPY_BUNDLE_CONCEPTS.every((id) => mfConcepts.some((c) => c.id === id));
  happyManifest &&
  mfConcepts.length >= HAPPY_COUNT &&
  conformingPresent &&
  happyManifest.root_id === 'index' &&
  mfLinks.length > 0 &&
  mfLinks.every((l) => l.source === 'author')
    ? pass(
        'manifest (B+C): written at settle — ' +
          mfConcepts.length +
          ' concepts, ' +
          mfLinks.length +
          ' author links, root=index (summary lazy)'
      )
    : fail(
        'manifest (B+C): ' +
          JSON.stringify(
            happyManifest && {
              concepts: mfConcepts.length,
              links: mfLinks.length,
              root_id: happyManifest.root_id
            }
          )
      );
  const authorEdges = await aqlAll(
    'FOR e IN `' +
      OKF_GRAPH +
      "_LINKS_TO` FILTER e.source == 'author' RETURN KEEP(e, ['from_concept_id','to_concept_id','source'])"
  );
  authorEdges.length === (happyManifest ? mfLinks.length : -1)
    ? pass(
        'author links (B): ' +
          authorEdges.length +
          " source='author' edges mirrored into _LINKS_TO (graph IS the bundle's structure)"
      )
    : fail(
        'author links (B): graph has ' +
          authorEdges.length +
          ' author edges, manifest declares ' +
          (happyManifest ? mfLinks.length : '?')
      );
  // INTEGRITY (live-caught in the v11 audit): every author edge's _to MUST
  // resolve to a real ENTITY vertex — the collections are not graph-bound, so
  // nothing else enforces it. A dangling edge silently breaks tier-3 walks.
  const danglingAuthor = await aqlAll(
    'FOR e IN `' +
      OKF_GRAPH +
      "_LINKS_TO` FILTER e.source == 'author' " +
      'FILTER LENGTH(FOR v IN `' +
      OKF_GRAPH +
      '_ENTITY` FILTER v._id == e._to LIMIT 1 RETURN 1) == 0 ' +
      'COLLECT WITH COUNT INTO n RETURN n'
  );
  (danglingAuthor[0] || 0) === 0
    ? pass('author-link integrity (B): ZERO dangling _to — every edge resolves to a real concept vertex')
    : fail('author-link integrity (B): ' + danglingAuthor[0] + ' dangling author edges (vertex scheme mismatch?)');

  // Bundle ingestion-log completeness: EVERY stage for EVERY conforming
  // concept, keyed on the BUNDLE file (the UI surface) with the concept file
  // name in the message (David's 4th/5th-time directives).
  // Settle-wait (review P1c, live-caught v13b): the LAST concept's final
  // System stage can mirror just after the bundle status lands Ingested —
  // poll until all conforming concepts carry all required stages (max 60s).
  //
  // KNOWN RED (David's call, 2026-11-09): on the CURRENT build this assert is
  // the sentinel for a REAL dataprep defect — the worker-kick path drops the
  // primaries of 4/5 concepts and ALL bundle mirrors (wizard-shaped repos
  // write both channels perfectly; the import/worker path loses them; the
  // August runs on the pre-rebuild image were green). Filed as #1709
  // (dataprep) + #1710 (doc-repo clock skew that muddied the diagnosis).
  // The assert stays STRICT and this run legitimately carries ONE expected
  // failure until #1709 lands.
  const REQUIRED_STAGES = ['System', 'Chunking', 'Labeling', 'Graph'];
  let bundleLogs = [];
  for (let i = 0; i < 20; i++) {
    bundleLogs = await aqlAll(
      "FOR log IN ingestion_log FILTER log.file_id == '" +
        (bundleAfter && bundleAfter.file_id) +
        "' RETURN KEEP(log, ['stage','message'])"
    );
    const seen = {};
    bundleLogs.forEach((l) => {
      const m = l.message.match(/\[([^\]]+)\]/);
      const cid = m ? m[1].replace(/\.md$/, '') : '(unknown)';
      (seen[cid] = seen[cid] || new Set()).add(l.stage);
    });
    const complete = HAPPY_BUNDLE_CONCEPTS.every((id) => {
      const st = seen[id] || new Set();
      return REQUIRED_STAGES.every((s) => st.has(s));
    });
    if (complete) break;
    await new Promise((r2) => setTimeout(r2, 3000));
  }
  const stagesByConcept = {};
  bundleLogs.forEach((l) => {
    const m = l.message.match(/\[([^\]]+)\]/);
    const cid = m ? m[1].replace(/\.md$/, '') : '(unknown)';
    if (!stagesByConcept[cid]) stagesByConcept[cid] = new Set();
    stagesByConcept[cid].add(l.stage);
  });
  const allComplete =
    HAPPY_BUNDLE_CONCEPTS.every((f) => {
      const stages = stagesByConcept[f] || new Set();
      return REQUIRED_STAGES.every((s) => stages.has(s));
    }) && bundleLogs.length >= HAPPY_BUNDLE_CONCEPTS.length * REQUIRED_STAGES.length;
  if (!allComplete) {
    // DIAGNOSTIC (run 13→15: the assert failed with {} — zero rows matched the
    // bundle's file_id — with the manifest and author edges settled green).
    // Dump what ingestion_log actually holds around this run. The rows carry NO
    // repo_id (the earlier diag filtered l.repo_id and printed {} — that field
    // does not exist on ingestion_log docs), so this dumps the newest rows'
    // file_id keying — the drain's primaries land keyed by concept_id, the
    // mirrors keyed by the bundle's file_id — plus the queried bundle id.
    const logKeying = await aqlAll(
      "FOR l IN ingestion_log SORT l.timestamp DESC LIMIT 400 COLLECT fid = l.file_id WITH COUNT INTO n SORT n DESC RETURN {file_id: fid, rows: n}"
    );
    console.log('  [diag] queried bundle file_id: ' + (bundleAfter && bundleAfter.file_id));
    console.log('  [diag] newest ingestion_log file_id keying (any owner): ' + JSON.stringify(logKeying.slice(0, 12)));
  }
  allComplete
    ? pass(
        'bundle ingestion log: ' +
          bundleLogs.length +
          ' entries on the bundle file — every stage (' +
          REQUIRED_STAGES.join('/') +
          ') logged for all ' +
          HAPPY_BUNDLE_CONCEPTS.length +
          ' conforming concepts, each prefixed with its file name'
      )
    : fail(
        'bundle ingestion log incomplete (KNOWN RED — dataprep drops the kick-path ' +
          'log writes on this build; filed #1709, see also #1710): ' +
          JSON.stringify(Object.fromEntries(Object.entries(stagesByConcept).map(([k, v]) => [k, [...v]])))
      );

  // ── re-ingest AFTER indexing — the 4e DEDUP rule fires LIVE (moved here
  // from the sad repo: dedup skips UNCHANGED + INDEXED concepts, and only the
  // happy repo ever reaches indexed — #1568). Unchanged content + now-indexed
  // ⇒ skipped_dedup, no new Pending docs. Called via the service module
  // (in-container — immune to the 5-min user token TTL; the HTTP surface is
  // asserted by the earlier zip ingest + 403).
  const filesCountQuery =
    "RETURN LENGTH(FOR f IN files FILTER f.repo_id == '" + INGEST_REPO + "' AND f.is_bundle != true RETURN 1)";
  const filesBefore = (await aqlAll(filesCountQuery))[0];
  const r2 = await ingestService.ingestRepoConcepts(
    INGEST_REPO,
    { concepts, labels: SELECTED_KH_LABELS },
    { sub: 'smoke-run', source_ip: null }
  );
  r2.skipped_dedup === HAPPY_COUNT && r2.enqueued === 0
    ? pass('DEDUP LIVE: re-ingest of unchanged+indexed concepts → skipped_dedup=' + HAPPY_COUNT + ', enqueued=0')
    : fail(
        'dedup summary: ' +
          JSON.stringify({ skipped_dedup: r2.skipped_dedup, enqueued: r2.enqueued, errors: r2.enqueue_errors })
      );
  r2.created === 0 && r2.updated === HAPPY_COUNT
    ? pass('re-ingest: meta rows updated in place (created=0, updated=' + HAPPY_COUNT + ' — no duplicates)')
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

  // ── (x) MODIFIED re-ingest → version threading onto meta rows + CHUNKS ──
  // Change ONE concept (service_directory): the other 5 dedup-skip (unchanged +
  // indexed), the changed one enqueues carrying bundle_version=1 + the okf:v1
  // tag — the worker drains it and dataprep stamps bundle_version onto its
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
  // RE-ARM for the modified concept's re-drain (#1568, live-caught runs 4+5):
  // drain COMPLETION clears rag_drain_active ("the drain served its purpose" —
  // lifecycle-service :1044), and the HTTP ingest transition CANNOT re-arm a
  // serving repo — its idempotent guard short-circuits first
  // (ingested_at && ingested_version === version → { already: true }, :1121).
  // The product's own re-drain path is the RE-INGEST arm: armRagDrain called
  // DIRECTLY with reason 're-ingest' (the exported single implementation the
  // lifecycle's re-ingest function itself uses — "a requeue without an arm
  // leaves the rows invisible FOREVER", :495).
  const lifecycleService = require('./services/lifecycle-service');
  const rearmRepo = await repos.document(INGEST_REPO);
  await lifecycleService.armRagDrain(db, INGEST_REPO, rearmRepo, { sub: 'smoke-run' }, { reason: 're-ingest' });
  pass(
    're-arm: armRagDrain(reason re-ingest) re-armed the drain for the modified concept (the serving repo short-circuits the HTTP ingest guard)'
  );
  // Settle-wait: the modified concept goes parsed (4b re-upsert) → indexed
  // (worker + callback). Poll until its meta shows indexed with the NEW
  // content (the amended body changed the canonical hash).
  // THE CEILING IS THE CLAIM WINDOW (#1568, live-caught runs 6-8): a parsed
  // row carries worker_claimed_at from the FIRST drain (the completion paths
  // keep the stamp), and the claim filter refuses a row until
  // OKF_INGEST_WORKER_JOB_TIMEOUT_MS (default 30 MIN — David's 2026-09-15
  // ruling: dataprep's per-doc retry path legitimately takes 9-13 min) has
  // elapsed since the stamp. The product's own requeue path
  // (requeueFailedForReingest) covers index_status='failed' rows only — a
  // parsed row re-drains by waiting the window out. The poll therefore runs
  // 40 min: the window plus drain time.
  let versionedSettled = false;
  for (let i = 0; i < 160 && !versionedSettled; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const row = (
      await aqlAll(
        "FOR m IN okf_concepts_meta FILTER m.repo_id == '" +
          INGEST_REPO +
          "' AND m.concept_id == 'service_directory' RETURN KEEP(m, ['index_status','content_hash','chunk_count'])"
      )
    )[0];
    versionedSettled = !!row && row.index_status === 'indexed';
  }
  versionedSettled
    ? pass('version threading: worker + callback re-indexed the modified concept (new content_hash indexed)')
    : fail(
        'versioned concept did not re-index in 40 min — precondition check: after a completed drain ' +
          'rag_drain_active is CLEARED and the HTTP ingest idempotent-guard short-circuits a serving repo ' +
          "(:1121 already:true) — the re-drain needs armRagDrain(reason re-ingest), the product's own " +
          're-ingest path (#1568)'
      );
  // THE SETTLE RACE (live-caught run 10): the worker indexes the row BEFORE the
  // settle clears rag_drain_active — a poll that breaks on 'indexed' can hand a
  // still-armed repo to mint v2, which refuses writes while a drain is in
  // flight ("has a RAG ingestion in progress"). The drain is over when the ARM
  // is gone, not when the last row indexes — wait for the flag itself.
  let rearmSettled = false;
  for (let i = 0; i < 60 && !rearmSettled; i++) {
    const armedRepo = await repos.document(INGEST_REPO);
    rearmSettled = !!armedRepo && armedRepo.rag_drain_active !== true;
    if (!rearmSettled) await new Promise((r4) => setTimeout(r4, 2000));
  }
  rearmSettled
    ? pass('re-drain settled: rag_drain_active cleared (writes unfrozen for mint v2)')
    : fail('re-drain did not settle — rag_drain_active still armed 120s after the last row indexed');
  // CHUNK version stamps (content-only: chunks key on metadata.concept_id).
  const versionedChunks = (
    await aqlAll(
      'FOR c IN `' +
        OKF_GRAPH +
        '_SOURCE` FILTER c.concept_id == "service_directory" COLLECT WITH COUNT INTO n RETURN n'
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
        // KEEP includes source/from/to — author edges branch on them (review
        // P2, live-caught v13b: the projection stripped the very fields the
        // per-source well-formedness assert branches on, failing every author
        // edge as if it were a malformed parser edge).
        "_ENTITY/c_') RETURN KEEP(e, ['_from', '_to', 'label', 'repo_id', 'bundle_version', 'source', 'from_concept_id', 'to_concept_id', 'weight'])"
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
  // Well-formedness differs by edge source: parser edges (source undefined or
  // 'parser') carry label; author edges (source='author', B) carry
  // from/to_concept_id + weight instead. Both must have within-repo c_
  // endpoints + repo_id. (WP-C: parser edges no longer carry a files-doc
  // file_id — concepts are NOT files docs; the callback passes concept_id in
  // that slot, so it is deliberately not asserted here.)
  const edgesWellFormed = myEdges.every(
    (e) =>
      String(e._from).startsWith(OKF_GRAPH + '_ENTITY/c_') &&
      String(e._to).startsWith(OKF_GRAPH + '_ENTITY/c_') &&
      e.repo_id === INGEST_REPO &&
      (e.source === 'author'
        ? typeof e.from_concept_id === 'string' && typeof e.to_concept_id === 'string'
        : typeof e.label === 'string')
  );
  edgesWellFormed
    ? pass(
        'edges: ALL concept edges well-formed — within-repo c_ endpoints + repo_id; parser edges carry label, author edges carry from/to+weight (per source)'
      )
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
    // WP-C: only the bundle zip is a files doc and remove() → retractRepoGraph
    // DROPS the graph collections + cleans the files/meta/versions rows — no
    // per-concept doc-repo retract exists (or is needed) for a clone.
    // Since the clone now WALKS THE LIFECYCLE (#1568), a prior-run clone sits
    // in published/retracted, not draft — remove() refuses it, so retract
    // first (retract drops the graph), then delete. The AQL purge below is
    // the final hammer; without the retract its graph would survive as an
    // orphan and the zero-artifacts assert would die at cleanup.
    try {
      await repositoryService.remove(pc.repo_id, { sub: 'smoke-run' });
    } catch (e) {
      try {
        // LATE-PHASE (token long expired) — the service module, not HTTP.
        await lifecycleService.transition(pc.repo_id, 'retract', { sub: 'smoke-run' });
        await repositoryService.remove(pc.repo_id, { sub: 'smoke-run' });
      } catch (e2) {
        console.log('  cleanup: prior clone ' + pc.repo_id + ' service remove failed (' + e2.message + ') — AQL purge');
      }
    }
    await aqlAll("FOR m IN okf_concepts_meta FILTER m.repo_id == '" + pc.repo_id + "' REMOVE m IN okf_concepts_meta");
    await aqlAll("FOR v IN okf_versions FILTER v.repo_id == '" + pc.repo_id + "' REMOVE v IN okf_versions");
    // The manifest too (see the prior-happy purge — live-caught run 11).
    await aqlAll("FOR d IN okf_bundle_manifest FILTER d._key == '" + pc.repo_id + "' REMOVE d IN okf_bundle_manifest");
    // FILTER-based (not by-key): remove() already deletes the registry entry —
    // a by-key REMOVE on the missing doc throws 'document not found'.
    await aqlAll("FOR r IN okf_repositories FILTER r.repo_id == '" + pc.repo_id + "' REMOVE r IN okf_repositories");
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
  // The clone's graph name comes from the product's authority too — the
  // registry's graph_name field is the legacy OKF_{repo_id} anchor, not the
  // live graph (same trap the happy repo's stamp just proved live, #1568).
  const CLONE_GRAPH = workingGraphName(
    (await aqlAll("FOR r IN okf_repositories FILTER r.repo_id == '" + CLONE_ID + "' RETURN r"))[0]
  );
  clone.repo_id !== INGEST_REPO &&
  typeof CLONE_GRAPH === 'string' &&
  CLONE_GRAPH.startsWith('OKF_') &&
  clone.lifecycle_state === 'draft'
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
        'clone re-ingest: ' + (HAPPY_COUNT - 1) + ' dedup-skipped (unchanged+indexed), 1 enqueued (modified concept)'
      )
    : fail(
        'clone re-ingest summary: ' +
          JSON.stringify({ skipped: rc.skipped_dedup, enqueued: rc.enqueued, errors: rc.enqueue_errors })
      );
  // DIAGNOSTIC (run 13's live evidence: the clone's ingest arm counted FIVE
  // parsed rows — someone re-parses the copied 'indexed' rows between the
  // copy and the drain; the resulting clone graph is COMPLETE, which is the
  // born-right serving contract, but the WRITER is unnamed). These dumps pin
  // the row state at each stage so the next run names it.
  console.log('  [diag] clone rows after re-ingest:');
  const diagRows1 = await aqlAll(
    "FOR m IN okf_concepts_meta FILTER m.repo_id == '" +
      CLONE_ID +
      "' SORT m.concept_id RETURN KEEP(m, ['concept_id','index_status','graph_name'])"
  );
  diagRows1.forEach((m) => console.log('    ' + m.concept_id + ': ' + m.index_status + ' @ ' + m.graph_name));

  // CONTENT-ONLY (WP-C): the clone's modified concept drains via its META row
  // (no per-concept files doc) — but ONLY after the clone walks the lifecycle
  // (#1568): a clone is born draft, and a draft repo's rows are invisible to
  // the worker (rag_drain_active is written solely by the lifecycle 'ingest'
  // transition). The walk mints the clone's own v1; the isolation proof below
  // stays intact.
  await piiService.markRepoPiiScanned(CLONE_ID);
  // The clone's walk fires ~40 min into the run — far past the 5-min user-token
  // TTL (the header's documented pitfall, live-caught run 9: four 401s). The
  // HTTP authz matrix is unit-tested; the in-container pattern is the service
  // module — the SAME call shape ingestRepoConcepts/mintVersion/remove use.
  // A refusal throws LifecycleError; caught and failed honestly.
  const cloneStep = async (action) => {
    try {
      return { ok: true, body: await lifecycleService.transition(CLONE_ID, action, { sub: 'smoke-run' }) };
    } catch (e) {
      return { ok: false, error: e.code || e.message };
    }
  };
  let rc2 = await cloneStep('submit');
  rc2.ok && rc2.body.lifecycle_state === 'review'
    ? pass('clone lifecycle: submit → review')
    : fail('clone lifecycle submit → ' + JSON.stringify(rc2.error || rc2.body).slice(0, 200));
  rc2 = await cloneStep('approve');
  rc2.ok && rc2.body.lifecycle_state === 'approve'
    ? pass('clone lifecycle: approve → approve')
    : fail('clone lifecycle approve → ' + JSON.stringify(rc2.error || rc2.body).slice(0, 200));
  rc2 = await cloneStep('publish');
  rc2.ok && rc2.body.bundle_version === 1
    ? pass("clone lifecycle: publish → the clone's own v1 minted")
    : fail('clone lifecycle publish → ' + JSON.stringify(rc2.error || rc2.body).slice(0, 300));
  console.log('  [diag] clone rows after publish (who re-parsed?):');
  const diagRows2 = await aqlAll(
    "FOR m IN okf_concepts_meta FILTER m.repo_id == '" +
      CLONE_ID +
      "' SORT m.concept_id RETURN KEEP(m, ['concept_id','index_status'])"
  );
  diagRows2.forEach((m) => console.log('    ' + m.concept_id + ': ' + m.index_status));
  rc2 = await cloneStep('ingest');
  rc2.ok
    ? pass('clone lifecycle: ingest (drain armed)')
    : fail('clone lifecycle ingest → ' + JSON.stringify(rc2.error || rc2.body).slice(0, 300));
  // Settle-wait for index_status terminal.
  let cStatus = null;
  for (let i = 0; i < 100; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const row = (
      await aqlAll(
        "FOR m IN okf_concepts_meta FILTER m.repo_id == '" +
          CLONE_ID +
          "' AND m.concept_id == 'service_directory' RETURN KEEP(m, ['index_status'])"
      )
    )[0];
    cStatus = row && row.index_status;
    if (cStatus === 'indexed' || cStatus === 'failed') break;
  }
  const cloneGraphRow = (
    await aqlAll(
      "FOR m IN okf_concepts_meta FILTER m.repo_id == '" +
        CLONE_ID +
        "' AND m.concept_id == 'service_directory' RETURN KEEP(m, ['graph_name'])"
    )
  )[0];
  cloneGraphRow && cloneGraphRow.graph_name === CLONE_GRAPH
    ? pass('clone: the modified concept is graph-stamped to the CLONE graph (' + CLONE_GRAPH + ')')
    : fail('clone graph_name: ' + JSON.stringify(cloneGraphRow));
  cStatus === 'indexed'
    ? pass('clone: worker drained the modified concept to indexed')
    : fail(
        'clone drain ended "' +
          cStatus +
          '" — precondition check: the clone must be PUBLISHED with the lifecycle ingest transition armed ' +
          '(rag_drain_active) before its rows are claimable (#1568)'
      );

  // Physical isolation: the modified concept's chunks in the CLONE graph ONLY,
  // and the SOURCE's chunks + edges are UNCHANGED (the original is never touched).
  const cloneChunks =
    (
      await aqlAll(
        'FOR c IN `' +
          CLONE_GRAPH +
          '_SOURCE` FILTER c.concept_id == "service_directory" COLLECT WITH COUNT INTO n RETURN n'
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
  // THE BORN-RIGHT SERVING CONTRACT (live-caught run 13: the clone's ingest arm
  // counted FIVE parsed rows and its graph materialized ALL concepts' chunks):
  // a clone is not a metadata-only stub — the publish/drain rebuilds the WHOLE
  // corpus into the clone's own graph, because the clone must SERVE (the
  // graph-retract contract: "re-ingest rebuilds the graph born-right from the
  // meta rows"). The old assert (only the modified concept materializes)
  // described the pre-W9 serving model. What must hold now: EVERY cloned
  // concept has chunks in the clone graph, the modified concept included, and
  // the SOURCE's physical state is unchanged (asserted above).
  const perConceptChunks = await aqlAll(
    'FOR c IN `' + CLONE_GRAPH + '_SOURCE` COLLECT cid = c.concept_id WITH COUNT INTO n RETURN {cid, n}'
  );
  const conceptsWithChunks = perConceptChunks.filter((r) => r.n > 0).map((r) => r.cid);
  const missingConcepts = HAPPY_BUNDLE_CONCEPTS.filter((c) => !conceptsWithChunks.includes(c));
  missingConcepts.length === 0 && cloneGraphTotal >= HAPPY_COUNT
    ? pass(
        'clone: BORN-RIGHT serving — the clone graph materialized the FULL corpus (' +
          cloneGraphTotal +
          ' chunks across ' +
          conceptsWithChunks.length +
          ' concepts in ' +
          CLONE_GRAPH +
          '_SOURCE; a clone serves, it does not stub)'
      )
    : fail(
        'clone graph incomplete: ' +
          cloneGraphTotal +
          ' chunks, missing concepts: ' +
          JSON.stringify(missingConcepts) +
          ' (per-concept: ' +
          JSON.stringify(perConceptChunks) +
          ')'
      );

  // Cleanup (CLEANUP=full only): remove the clone via the okf-server repo-delete
  // CRUD (remove() → retractRepoGraph drops the clone's graph + meta + files +
  // versions). The soft-deleted registry tombstone is left per the soft-delete
  // contract (the next run's clone cleanup finds it by name). With CLEANUP=none
  // the clone PERSISTS for inspection.
  if (CLEANUP === 'full') {
    // The clone WALKED the lifecycle (#1568) — it is published/ingested, and
    // remove() refuses that. Retract first (drops the graph), then delete.
    // LATE-PHASE (token long expired) — the service module, not HTTP.
    let cret;
    try {
      cret = await lifecycleService.transition(CLONE_ID, 'retract', { sub: 'smoke-run' });
    } catch (e) {
      cret = { lifecycle_state: null, error: e.code || e.message };
    }
    if (!(cret && cret.lifecycle_state === 'retracted')) {
      console.log('  cleanup: clone retract -> ' + JSON.stringify(cret.error || cret).slice(0, 120));
    }
    await repositoryService.remove(CLONE_ID, { sub: 'smoke-run' });
    pass('clone: cleanup — clone retracted + removed, its ' + CLONE_GRAPH + ' graph dropped (CRUD repo-delete)');
  } else {
    console.log('  NOTE: clone ' + CLONE_ID + ' LEFT IN PLACE (CLEANUP=none — run OKF_SMOKE_CLEANUP=only to remove)');
  }

  // ── Story E: multi-domain discovery (tier 1 of the retrieval fan-out) ──
  // The manifests written at settle are the discovery index: score every
  // settled bundle against the query (label overlap + name/domain tokens)
  // and return the top-K candidate repos. Proven via the service module
  // (in-container; the HTTP surface is tools-admin-gated and unit-tested).
  const discSvc = require('./services/concept-meta-service');
  const disc = await discSvc.discoverRepos(
    { tokens: ['kenya', 'government', 'services'], labels: SELECTED_KH_LABELS },
    { k: 10 }
  );
  // Multiple repos share the SAME labels (sad + happy + clone all carry
  // d:smoke + the KH set) — ties at an equal score are CORRECT behavior;
  // the assert requires the happy repo to be PRESENT with a positive score,
  // not order-#1 on a tie.
  const happyHit = disc.find((d) => d.repo_id === INGEST_REPO);
  happyHit && happyHit.score > 0
    ? pass(
        'discovery (E): happy repo in candidates (score=' +
          happyHit.score +
          ', ' +
          disc.length +
          ' candidate(s); ties among same-label repos are expected)'
      )
    : fail('discovery (E): ' + JSON.stringify(disc.map((d) => [d.repo_id, d.score])));

  // ── (viii) CHUNKS — the physical proof (WP-C content-only chunks) ──
  // The OKF bundle's chunks must land in the per-repo OKF_{repo_id} graph
  // (Story 2.9.6 wiring: doc-repo sends graph_name → dataprep writes the
  // per-repo collections) — and NOT in the default graph. WP-C content-only:
  // chunks are NOT keyed by file_id (no per-concept files doc) — they're keyed
  // by the concept's markdown via the worker. Chunks carry `concept_id` in
  // metadata (citation provenance — Story 4.8-amend).
  // The OKF graph name is hyphenated (OKF_<slug>_v<N>) — AQL needs
  // backtick-quoted identifiers for it (live-caught: unquoted → lexer error
  // at the first '-').
  const HAPPY_CONCEPTS = GOOD_FILES.map((f) => f.replace(/\.md$/, '')); // concept ids are file names MINUS .md
  const bChunkRows = await aqlAll(
    'FOR c IN `' +
      OKF_GRAPH +
      '_SOURCE` FILTER c.concept_id IN ' +
      JSON.stringify(HAPPY_CONCEPTS) +
      ' COLLECT cid = c.concept_id WITH COUNT INTO n RETURN {cid, n}'
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
        'FOR c IN `' + OKF_GRAPH + '_SOURCE` FILTER c.concept_id == "bad_concept" COLLECT WITH COUNT INTO n RETURN n'
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
    // ── (ix) PER-CONCEPT RETRACTION — REMOVED (WP-C, 2026-08-24) ──
    // Pre-WP-C this retracted ONE concept via doc-repo POST /api/files/{id}/retract.
    // Post-WP-C (content-only chunking) concepts are NOT files docs (only the
    // bundle zip is), so the old block selected from an empty list and threw.
    // No per-concept retract API exists in okf-server (only retractRepoGraph),
    // and the natural candidate (bad_concept) is REJECTED at ingest with 0
    // chunks — there is nothing per-concept to retract. Per-concept deletion
    // lands with Story 4.3 (lifecycle states). Bundle-level retraction below
    // remains the verified physical proof.

    // ── (x) BUNDLE-LEVEL RETRACTION — repo delete DROPS the graph ──
    // A per-repo graph serves exactly ONE bundle: the simplest correct
    // retraction is dropping the graph definition + the 4 collections
    // (retractRepoGraph, wired into repository delete). Verified via the real
    // remove() flow (the service function — the HTTP DELETE route's authz is
    // unit-tested; the user token has expired by this point in the run).
    // (repositoryService already required by the clone phase above.)
    // The happy repo is SERVING now — the drain completing is the whole point
    // of the #1568 re-anchor — and delete on a serving repo is
    // INGESTED_DELETE_BLOCKED (R5). The state machine's exit is retract
    // (W7: mark-only for the bundle zips, the graph drops), then the delete
    // cascade removes the rest. The lifecycle harness proves this exact pair.
    // LATE-PHASE (token long expired) — the service module, not HTTP. A
    // refusal throws LifecycleError; caught and failed honestly.
    let retr;
    try {
      retr = await lifecycleService.transition(INGEST_REPO, 'retract', { sub: 'smoke-run' });
    } catch (e) {
      retr = { lifecycle_state: null, error: e.code || e.message };
    }
    retr && retr.lifecycle_state === 'retracted'
      ? pass(
          'bundle retract: lifecycle retract from serving → retracted (W7 retention: the version bundle zips stay, marked Retracted)'
        )
      : fail('bundle retract: lifecycle retract → ' + JSON.stringify(retr.error || retr).slice(0, 200));
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
    // The SAD repo (WP-A gate proof) is ALSO removed — the phases above
    // targeted the happy repo, so without this its graph survives full mode.
    try {
      await repositoryService.remove(SAD_REPO, { sub: 'smoke-run' });
      pass('bundle retract: sad repo (' + SAD_REPO + ') removed — graph + rows cascaded');
    } catch (e) {
      fail('sad repo remove failed: ' + e.message);
    }
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
    '  NOTE: multi-graph READ is LIVE — the retriever fans out over the authorized OKF_<repo>_v<N> graphs (see the Testing Lab routing tests for the boundary).'
  );
  console.log(
    '  NOTE: per-CONCEPT retraction (dataprep retract_file — surgical chunk deletion) is the separate single-file path, untouched by the bundle-level drop.'
  );
}
