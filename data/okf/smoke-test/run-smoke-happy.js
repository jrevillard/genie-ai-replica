// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// OKF HAPPY-PATH smoke: ingests kenya-bundle-clean (5 conforming concepts, NO
// bad_concept) into a DEDICATED repo via the real HTTP API, drains it, mints
// v1, re-ingests one modified concept (version threading), mints v2, and — by
// default (OKF_SMOKE_CLEANUP=none) — PERSISTS the artifacts so the doc-repo UI
// shows the bundle zip + its full ingestion lifecycle log.
// Run INSIDE the okf-server container (same procedure as run-smoke.js):
//   docker cp data/okf/smoke-test/kenya-bundle-clean <container>:/app/kenya-bundle-clean
//   docker cp data/okf/smoke-test/kenya-bundle-clean.zip <container>:/app/kenya-bundle-clean.zip
//   docker cp data/okf/smoke-test/run-smoke-happy.js <container>:/app/run-smoke-happy.js
//   docker exec -e OKF_SMOKE_TOKEN_ADMIN=<...> <container> node /app/run-smoke-happy.js
//
// Cleanup modes (OKF_SMOKE_CLEANUP): 'none' (leave artifacts for UI inspection),
// 'only' (remove a prior run's artifacts and exit), 'full' (run everything, then
// clean — the default). Success criteria (smoke-test-integrity rule):
//   1. All 5 concepts parse + ZERO conformance issues (clean bundle).
//   2. HTTP zip ingest -> 202 (total=5, enqueued=5, rejected=0).
//   3. All 5 concepts drain to indexed (chunks carry concept_id — WP-C).
//   4. Only ONE files doc exists for the repo (the bundle zip — content-only).
//   5. markRepoPiiScanned -> mint v1 SUCCEEDS: okf:v1, repo.version=1 stamped,
//      manifest snapshots all 5 concepts with the STORED canonical hashes.
//   6. Modified re-ingest: 4 dedup-skipped + 1 enqueued carrying bundle_version=1;
//      ALL its new chunk docs carry bundle_version=1 (ADR-031 threading).
//   7. Mint v2 (crawl trigger, D-V4) -> list [v2, v1]; manifest v1 INTACT.
//   8. CLEANUP=full/only: graph collections physically dropped, zero leftovers.

const fs = require('fs');
const path = require('path');
const matter = require('gray-matter');
const parserService = require('./services/parser-service');
const conformanceService = require('./services/conformance-service');
const piiService = require('./services/pii-service');
const ingestService = require('./services/ingest-service');
const versionService = require('./services/version-service');
const repositoryService = require('./services/repository-service');
const dbService = require('./shared-lib/db-connection-service');

const BUNDLE_DIR = process.env.OKF_SMOKE_BUNDLE_DIR || '/app/kenya-bundle-clean';
const BUNDLE_ZIP = process.env.OKF_SMOKE_BUNDLE_ZIP || '/app/kenya-bundle-clean.zip';
const DOMAIN = 'smoke-happy';
const EXPECTED_CONCEPTS = 5;
const EXPECTED_ISSUES = 0;
const GOOD_FILES = [
  'index.md',
  'ecitizen_digital_payments.md',
  'huduma_kenya.md',
  'ministry_of_public_service.md',
  'service_directory.md'
];
const SELECTED_LABELS = [
  'Digital Government Services',
  'Public Service Administration',
  'eCitizen',
  'Huduma Kenya',
  'Ministry of Public Service',
  'Service Directory'
];
const CLEANUP = (process.env.OKF_SMOKE_CLEANUP || 'full').toLowerCase();
if (!['full', 'none', 'only'].includes(CLEANUP)) {
  console.error(`OKF_SMOKE_CLEANUP must be 'full' | 'none' | 'only' (got '${CLEANUP}')`);
  process.exit(1);
}

let failures = 0;
function fail(msg) {
  failures += 1;
  console.error('FAIL  ' + msg);
}
function pass(msg) {
  console.log('PASS  ' + msg);
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

async function aqlAll(query, bind) {
  const d = await dbService.getConnection('default');
  return (await d.query(query, bind)).all();
}

/** Remove every smoke-happy repo + its physical graph, then assert zero leftovers. */
async function cleanupHappyRepos(db) {
  const repos = await aqlAll(`FOR r IN okf_repositories FILTER r.domain == '${DOMAIN}' RETURN KEEP(r, ['repo_id'])`);
  for (const r of repos) {
    try {
      await repositoryService.remove(r.repo_id, { sub: 'smoke-run' });
      console.log('  repo ' + r.repo_id + ' removed (graph + meta + files + versions cascaded)');
    } catch (e) {
      console.log('  repo ' + r.repo_id + ' remove skipped: ' + e.message);
    }
  }
  // Belt-and-braces purge of any orphaned rows a crashed prior run left
  // (meta rows and versions key on repo_id, not domain).
  for (const r of repos) {
    await aqlAll('FOR m IN okf_concepts_meta FILTER m.repo_id == @r REMOVE m IN okf_concepts_meta', { r: r.repo_id });
    await aqlAll('FOR v IN okf_versions FILTER v.repo_id == @r REMOVE v IN okf_versions', { r: r.repo_id });
    await aqlAll('FOR f IN files FILTER f.repo_id == @r REMOVE f IN files', { r: r.repo_id });
  }
  // Physically-dropped proof per repo graph (a removed repo's collections are gone).
  const leftovers = [];
  for (const r of repos) {
    for (const suffix of ['_SOURCE', '_ENTITY', '_HAS_SOURCE', '_LINKS_TO']) {
      try {
        await db.collection('OKF_' + r.repo_id + suffix).get();
        leftovers.push('OKF_' + r.repo_id + suffix);
      } catch {
        /* dropped — expected */
      }
    }
  }
  leftovers.length === 0
    ? pass('cleanup: all OKF_{happy}_* collections physically dropped')
    : fail('cleanup leftovers: ' + leftovers);
}

async function main() {
  const db = await dbService.getConnection('default');
  const ADMIN = process.env.OKF_SMOKE_TOKEN_ADMIN;
  const BASE = process.env.OKF_SMOKE_BASE_URL || 'http://localhost:3002';

  if (CLEANUP === 'only') {
    console.log("CLEANUP-ONLY: removing the previous happy-run's artifacts...");
    await cleanupHappyRepos(db);
    process.exit(failures > 0 ? 1 : 0);
  }

  console.log(`OKF happy smoke: bundle=${BUNDLE_DIR} concepts=${EXPECTED_CONCEPTS} cleanupMode=${CLEANUP}`);
  if (!ADMIN) {
    fail('missing OKF_SMOKE_TOKEN_ADMIN env');
    process.exit(1);
  }

  // === Create the OKF repo via the real HTTP API ===
  // (CLEANUP=full: hard-clean any prior run first so the run is deterministic.)
  if (CLEANUP === 'full') await cleanupHappyRepos(db);
  const createRes = await call('POST', `${BASE}/api/okf/repos`, ADMIN, {
    name: 'Kenya Government Services Knowledge Base (smoke happy)',
    domain: DOMAIN,
    acl: { required_scopes: [] }
  });
  if (createRes.status !== 201 || !createRes.body || !createRes.body.repo_id) {
    fail('repo create -> ' + createRes.status + ' ' + JSON.stringify(createRes.body).substring(0, 200));
    process.exit(1);
  }
  const happyRepo = createRes.body.repo_id;
  const happyGraph = 'OKF_' + happyRepo;
  pass('OKF repository (HAPPY) created via API: repo_id=' + happyRepo);

  // === Parse the bundle files (control-plane) ===
  const files = fs
    .readdirSync(BUNDLE_DIR)
    .filter((f) => f.endsWith('.md'))
    .sort();
  if (files.length !== EXPECTED_CONCEPTS) {
    fail('expected ' + EXPECTED_CONCEPTS + ' concept files, found ' + files.length);
    process.exit(1);
  }
  for (const file of files) {
    const raw = fs.readFileSync(path.join(BUNDLE_DIR, file), 'utf8');
    const parsed = await parserService.parseConcept(raw, { repo_id: happyRepo, path: file });
    const { issues } = conformanceService.validateConcept(parsed);
    if (issues.length !== EXPECTED_ISSUES) {
      fail(file + ': expected 0 issues, got ' + issues.length);
    } else {
      pass(file + ': parsed + 0 conformance issues');
    }
  }

  // === Ingest the bundle via the real HTTP API ===
  const zipB64 = fs.readFileSync(BUNDLE_ZIP).toString('base64');
  const r1 = await call('POST', `${BASE}/api/okf/repos/${happyRepo}/ingest`, ADMIN, {
    zip: zipB64,
    bundle_name: 'kenya-bundle-clean.zip',
    labels: SELECTED_LABELS
  });
  if (r1.status !== 202) {
    fail('zip ingest -> ' + r1.status + ' ' + JSON.stringify(r1.body).substring(0, 200));
    process.exit(1);
  }
  const summary = r1.body || {};
  summary.total === EXPECTED_CONCEPTS && summary.enqueued === EXPECTED_CONCEPTS && (summary.rejected || 0) === 0
    ? pass('zip ingest -> 202 (total=' + summary.total + ', enqueued=' + summary.enqueued + ', rejected=0)')
    : fail('zip ingest summary: ' + JSON.stringify(summary));

  // === Drain: wait for the 5 happy concepts to transition to indexed ===
  const conceptIds = GOOD_FILES.map((f) => f.replace(/\.md$/, ''));
  const statuses = {};
  for (let i = 0; i < 200; i++) {
    // ~50 min cap
    await new Promise((r) => setTimeout(r, 15000));
    const rows = await aqlAll(
      'FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.concept_id IN @cids ' +
        "RETURN KEEP(m, ['concept_id','index_status','chunk_count'])",
      { r: happyRepo, cids: conceptIds }
    );
    let allIndexed = true;
    for (const cid of conceptIds) {
      if (statuses[cid]) continue;
      const row = rows.find((x) => x.concept_id === cid);
      if (row && row.index_status === 'indexed') {
        statuses[cid] = row.index_status + ':' + (row.chunk_count || 0);
        console.log('  ' + cid + ' -> ' + statuses[cid]);
      } else if (row && row.index_status === 'failed') {
        statuses[cid] = 'failed';
        allIndexed = false;
      } else {
        allIndexed = false;
      }
    }
    if (allIndexed && Object.keys(statuses).length === conceptIds.length) break;
  }
  const indexed = conceptIds.filter((c) => statuses[c] && statuses[c].split(':')[0] === 'indexed');
  indexed.length === conceptIds.length
    ? pass('HAPPY PATH: all ' + conceptIds.length + ' concepts INDEXED')
    : fail('HAPPY PATH: ' + indexed.length + '/' + conceptIds.length + ' indexed (' + JSON.stringify(statuses) + ')');

  // === Content-only (WP-C): the bundle zip is the ONLY files doc ===
  const repoFiles = await aqlAll(
    "FOR f IN files FILTER f.repo_id == @r RETURN KEEP(f, ['file_id','file_name','is_bundle'])",
    { r: happyRepo }
  );
  repoFiles.length === 1 && repoFiles[0].is_bundle === true && repoFiles[0].file_name === 'kenya-bundle-clean.zip'
    ? pass('content-only: exactly ONE files doc (the bundle zip) — no per-concept files docs')
    : fail('content-only: expected 1 bundle-zip files doc, got ' + JSON.stringify(repoFiles));

  // === 4.8b MINT v1 (publish trigger — the happy-path mint run-smoke.js proves on its own repo) ===
  await piiService.markRepoPiiScanned(happyRepo);
  const mint1 = await versionService.mintVersion(
    happyRepo,
    { trigger: 'publish', source_ref: 'smoke://kenya-bundle-clean/v1' },
    { sub: 'smoke-run' }
  );
  mint1.bundle_version === 1 && mint1.okf_tag === 'okf:v1'
    ? pass('mint v1: ' + mint1.okf_tag + ' (' + mint1.concept_count + ' concepts, trigger=publish)')
    : fail('mint v1: ' + JSON.stringify(mint1));
  const repoDoc = await db.collection('okf_repositories').document(happyRepo);
  repoDoc.version === 1 && repoDoc.okf_tag === 'okf:v1'
    ? pass('mint v1: repo doc version=1 + okf_tag=okf:v1 stamped')
    : fail('repo doc after mint: ' + JSON.stringify({ version: repoDoc.version, okf_tag: repoDoc.okf_tag }));
  const manifest1 = await versionService.getVersion(happyRepo, 1);
  const metaHashes = await aqlAll(
    "FOR m IN okf_concepts_meta FILTER m.repo_id == @r SORT m.concept_id RETURN KEEP(m, ['concept_id','content_hash'])",
    { r: happyRepo }
  );
  manifest1.concept_count === EXPECTED_CONCEPTS &&
  Array.isArray(manifest1.concepts) &&
  manifest1.concepts.every(
    (c, i) => c.concept_id === metaHashes[i].concept_id && c.content_hash === metaHashes[i].content_hash
  )
    ? pass('manifest v1: all ' + EXPECTED_CONCEPTS + ' concepts snapshotted with the STORED canonical hashes')
    : fail(
        'manifest v1 mismatch: ' +
          JSON.stringify(manifest1.concepts && manifest1.concepts.slice(0, 2)) +
          ' vs ' +
          JSON.stringify(metaHashes.slice(0, 2))
      );
  manifest1.okf_tag === 'okf:v1' && manifest1.trigger === 'publish' && typeof manifest1.minted_at === 'string'
    ? pass('manifest v1: okf:v1 + trigger + minted_at recorded')
    : fail('manifest v1 metadata: ' + JSON.stringify(manifest1));

  // === Version threading (ADR-031): modified re-ingest -> v1-stamped chunks -> mint v2 ===
  const concepts = files.map((f) => {
    const { data, content } = matter(fs.readFileSync(path.join(BUNDLE_DIR, f), 'utf8'));
    return { path: f, frontmatter: data, body: content.trim() };
  });
  const modified = concepts.map((c) =>
    c.path === 'service_directory.md'
      ? {
          ...c,
          body:
            c.body +
            '\n\n## Amended (happy version-threading probe)\n\nAdded post-v1 to prove the minted version rides new chunks.\n'
        }
      : c
  );
  const r3 = await ingestService.ingestRepoConcepts(
    happyRepo,
    { concepts: modified, labels: SELECTED_LABELS },
    { sub: 'smoke-run', source_ip: null }
  );
  r3.skipped_dedup === EXPECTED_CONCEPTS - 1 && r3.enqueued === 1
    ? pass('modified re-ingest: ' + (EXPECTED_CONCEPTS - 1) + ' dedup-skipped, 1 enqueued (changed concept carries v1)')
    : fail('modified re-ingest summary: ' + JSON.stringify({ skipped: r3.skipped_dedup, enqueued: r3.enqueued }));
  // Settle-wait: the modified concept goes parsed -> indexed (worker + callback).
  let versionedSettled = false;
  for (let i = 0; i < 100 && !versionedSettled; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const row = (
      await aqlAll(
        "FOR m IN okf_concepts_meta FILTER m.repo_id == @r AND m.concept_id == 'service_directory' " +
          "RETURN KEEP(m, ['index_status','bundle_version'])",
        { r: happyRepo }
      )
    )[0];
    versionedSettled = !!row && row.index_status === 'indexed';
  }
  versionedSettled
    ? pass('version threading: worker + callback re-indexed the modified concept')
    : fail('versioned concept did not re-index in 25 min');
  const versionedChunks = (
    await aqlAll(
      'FOR c IN `' +
        happyGraph +
        '_SOURCE` FILTER c.concept_id == "service_directory" COLLECT WITH COUNT INTO n RETURN n'
    )
  )[0];
  const versionedStamps = (
    await aqlAll(
      'FOR c IN `' +
        happyGraph +
        '_SOURCE` FILTER c.concept_id == "service_directory" AND c.bundle_version == 1 COLLECT WITH COUNT INTO n RETURN n'
    )
  )[0];
  versionedChunks > 0 && versionedStamps === versionedChunks
    ? pass(
        'version threading VERIFIED: all ' + versionedStamps + ' service_directory chunk docs carry bundle_version=1'
      )
    : fail('chunk version stamps: ' + versionedStamps + '/' + versionedChunks + ' carry bundle_version=1');

  // === MINT v2 + list/immutability (D-V4) ===
  const mint2 = await versionService.mintVersion(
    happyRepo,
    { trigger: 'crawl', source_ref: 'https://example.gov.ke' },
    { sub: 'smoke-run' }
  );
  mint2.bundle_version === 2 && mint2.okf_tag === 'okf:v2'
    ? pass('mint v2 (crawl trigger): okf:v2 of the SAME repository (D-V4)')
    : fail('mint v2: ' + JSON.stringify(mint2));
  const versionList = await versionService.listVersions(happyRepo);
  versionList.length === 2 && versionList[0].bundle_version === 2 && versionList[1].bundle_version === 1
    ? pass('version list: [v2, v1] newest-first')
    : fail('version list: ' + JSON.stringify(versionList.map((v) => v.bundle_version)));
  const manifest1Still = await versionService.getVersion(happyRepo, 1);
  manifest1Still && manifest1Still.bundle_version === 1
    ? pass('immutability: manifest v1 INTACT after minting v2 (INSERT-only ledger)')
    : fail('manifest v1 not intact: ' + JSON.stringify(manifest1Still));

  // === Final state report (the UI-inspection payload) ===
  const m = await aqlAll(
    "FOR m IN okf_concepts_meta FILTER m.repo_id == @r RETURN KEEP(m, ['concept_id','index_status','chunk_count'])",
    { r: happyRepo }
  );
  const bundleFile = (
    await aqlAll(
      "FOR f IN files FILTER f.repo_id == @r AND f.is_bundle == true RETURN KEEP(f, ['file_id','file_name','dataprep'])",
      {
        r: happyRepo
      }
    )
  )[0];
  const bundleLogs = bundleFile
    ? await aqlAll(
        'FOR log IN ingestion_log FILTER log.file_id == @fid SORT log.timestamp ASC RETURN KEEP(log, ["level","stage","message"])',
        { fid: bundleFile.file_id }
      )
    : [];
  console.log('\n=== HAPPY-PATH BUNDLE STATE ===');
  console.log('  repo_id:', happyRepo);
  console.log('  bundle file_id:', bundleFile && bundleFile.file_id);
  console.log('  bundle file_name:', bundleFile && bundleFile.file_name);
  console.log('  bundle dataprep.status:', bundleFile && bundleFile.dataprep && bundleFile.dataprep.status);
  console.log('  bundle ingestion_log entries:', bundleLogs.length);
  for (const l of bundleLogs) {
    console.log(
      '   ',
      (l.level || '?') + ' | ' + String(l.stage || '-').padEnd(15) + ' | ' + String(l.message || '').substring(0, 130)
    );
  }
  console.log('  meta states:');
  m.forEach((r) => console.log('   ', r.concept_id, r.index_status, 'chunks=' + (r.chunk_count || 0)));
  console.log('=== END ===');

  if (CLEANUP === 'full') {
    await cleanupHappyRepos(db);
  } else {
    console.log(
      '  NOTE: CLEANUP=none — the happy repo (' +
        happyRepo +
        '), its bundle doc, and the ' +
        happyGraph +
        ' graph PERSIST for UI inspection. Run OKF_SMOKE_CLEANUP=only to clean up afterward.'
    );
  }

  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.message);
  process.exit(1);
});
