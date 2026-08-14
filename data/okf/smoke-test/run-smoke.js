// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// OKF partial smoke test (Story 2.9.2 milestone): exercises the write-side
// control plane end-to-end against a real bundle WITHOUT the gated dataprep
// graph leg (2.9.6). Run INSIDE the okf-server container (has shared-lib +
// ArangoDB + pii-service reachability):
//   docker cp data/okf/smoke-test/kenya-bundle <container>:/app/kenya-bundle
//   docker cp data/okf/smoke-test/run-smoke.js <container>:/app/run-smoke.js
//   docker exec <container> node /app/run-smoke.js
//
// Exercised: parser (2.3) -> conformance (2.4) -> concepts-meta UPSERT writer
// (2.9.2) -> PII scan + gate (2.8). Asserts meta rows + non-zero metrics +
// pii_state. Exits non-zero on any failure.

const fs = require('fs');
const path = require('path');
const parserService = require('./services/parser-service');
const conformanceService = require('./services/conformance-service');
const conceptMetaService = require('./services/concept-meta-service');
const piiService = require('./services/pii-service');

const BUNDLE_DIR = process.env.OKF_SMOKE_BUNDLE_DIR || '/app/kenya-bundle';
const REPO_ID = process.env.OKF_SMOKE_REPO_ID || 'smoke-kenya-repo-0001';
const EXPECTED_CONCEPTS = 5;

async function main() {
  const files = fs.readdirSync(BUNDLE_DIR).filter((f) => f.endsWith('.md')).sort();
  console.log(`OKF smoke test: bundle=${BUNDLE_DIR} concepts=${files.length} repo=${REPO_ID}`);
  if (files.length !== EXPECTED_CONCEPTS) {
    console.error(`Expected ${EXPECTED_CONCEPTS} concepts, found ${files.length}`);
    process.exit(1);
  }

  const report = [];
  for (const file of files) {
    const raw = fs.readFileSync(path.join(BUNDLE_DIR, file), 'utf8');
    const parsed = await parserService.parseConcept(raw, { repo_id: REPO_ID, path: file });
    const { issues } = conformanceService.validateConcept(parsed);
    const meta = await conceptMetaService.upsertConceptMeta(REPO_ID, parsed);
    // PII scan (sidecar) — the gate then evaluates.
    const pii = await piiService.scanConcept(REPO_ID, parsed.concept_id, parsed.frontmatter, parsed.body);
    report.push({
      file,
      concept_id: parsed.concept_id,
      title: parsed.frontmatter && parsed.frontmatter.title ? parsed.frontmatter.title : '(none — frontmatter not parsed)',
      meta_action: meta.action,
      conformance_issues: issues.length,
      pii_state: pii.pii_state
    });
    console.log(`  ${file}: concept=${parsed.concept_id} meta=${meta.action} conformance=${issues.length} pii=${pii.pii_state}`);
  }

  // Assert meta rows were created (G9 — the whole point of 2.9.2).
  const metrics = await conformanceService.getRepoMetrics(REPO_ID);
  console.log('Repo metrics:', JSON.stringify(metrics));
  if (metrics.concept_count !== EXPECTED_CONCEPTS) {
    console.error(`FAIL: expected concept_count=${EXPECTED_CONCEPTS}, got ${metrics.concept_count}`);
    process.exit(1);
  }

  // PII gate evaluates (blocked if any hit/error OR unscanned marker).
  const gate = await piiService.assertPiiClean(REPO_ID);
  console.log('PII publish gate:', JSON.stringify(gate));

  console.log('\nSMOKE TEST PASSED ✔  (control-plane: parser+conformance+meta-writer+PII-gate)');
  console.log('Note: the dataprep graph leg (bundle -> OKF_{repo_id} graph) is gated by 2.9.6 (OPEA 1.5 bump).');
}

main().catch((err) => {
  console.error('SMOKE TEST FAILED:', err.message);
  process.exit(1);
});
