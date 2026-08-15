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
  const files = fs.readdirSync(BUNDLE_DIR).filter((f) => f.endsWith('.md')).sort();
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
    console.log(`  pii ${path.basename(parsed.path)}: state=${pii.pii_state}${pii.pii_hits_summary && Object.keys(pii.pii_hits_summary).length ? ' hits=' + JSON.stringify(pii.pii_hits_summary) : ''}`);
    if (pii.pii_state !== 'clean') {
      fail(`PII scan of ${parsed.path}: expected clean, got '${pii.pii_state}' (${JSON.stringify(pii.pii_hits_summary)})`);
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

  if (failures > 0) {
    console.error(`\nSMOKE TEST FAILED — ${failures} assertion(s) failed`);
    process.exit(1);
  }
  console.log('\nSMOKE TEST PASSED (control-plane: parser+conformance+persist+meta-writer+PII-gate, all asserted)');
  console.log('Note: the dataprep graph leg (bundle -> OKF_{repo_id} graph) is gated by 2.9.6 (OPEA 1.5 bump).');
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.message);
  process.exit(1);
});
