// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #1890 — the TEST-ONLY back door: write the RAGAS e2e venue-seed's suite +
// done-run docs into okf_head_test_runs INSIDE the okf-server container.
//
// The three RAGAS e2e specs need a finished run to re-score and a suite to
// load — data that only exists after a judge leg has run. No API writes a
// done run without paying the GPU, so the seed writes the docs directly,
// in-container (the SAME trust boundary and procedure as every run-smoke*
// harness: docker cp + docker exec by the operator/runner on a venue they
// already control). This script never runs in CI — tests/e2e/okf is
// excluded from CI, and the script lives outside every component's test
// roots.
//
// The doc SHAPE lives in ragas-venue-seed-docs.js (docker cp'd alongside;
// the okf-server unit pin test proves it passes rescoreRun's real
// validation). This file only moves data.
//
// Usage (inside the container, app root = cwd):
//   node seed-ragas-venue-docs.js seed   <repo_id>   # pii-mark + write both docs
//   node seed-ragas-venue-docs.js unstamp <repo_id>  # clear ingested_at (purge last resort)
//
// The host-side caller is tests/e2e/helpers/ragas-venue-seed.js, which
// discovers the container (docker ps), copies both files in, and execs.

'use strict';

const cmd = process.argv[2];
const repoId = process.argv[3];

const dbService = require('./shared-lib/db-connection-service');
const piiService = require('./services/pii-service');
const seed = require('./ragas-venue-seed-docs');

const COLLECTION = 'okf_head_test_runs';

/**
 * The collection is created LAZILY by the app (head-suite/ragas-suite
 * ensureCollection — never at boot, never in db/collections.js), so a fresh
 * venue that has never served a Testing Lab call has no
 * okf_head_test_runs yet. Every AQL touch in this writer goes through
 * here; the seed's saves too. (The app's own ensureCollection adds the
 * service indexes; the seed docs are few and fixed-key, so the plain
 * collection is enough for the fixture's lifetime.)
 */
async function ensureSeedCollection(db) {
  const col = db.collection(COLLECTION);
  if (!(await col.exists())) {
    await db.createCollection(COLLECTION);
    console.log('ensure: created missing collection ' + COLLECTION);
  }
  return col;
}

async function main() {
  if (!['seed', 'unstamp', 'verify-clean', 'purge-docs'].includes(cmd)) {
    console.error('usage: node seed-ragas-venue-docs.js <seed|unstamp|verify-clean|purge-docs> [repo_id]');
    process.exit(1);
  }
  if (cmd === 'purge-docs') {
    // Orphan sweep: a purge that missed the suite cascade (a crashed run, a
    // pre-fix seed) leaves suite/run docs whose repo is long gone. They are
    // reachable by suite_key alone — remove every doc in the seed's suite
    // scope, repo or no repo.
    const db = await dbService.getConnection('default');
    await ensureSeedCollection(db);
    const cursor = await db.query(
      'FOR d IN okf_head_test_runs FILTER d.suite_key == @sk OR d._key LIKE @prefix REMOVE d IN okf_head_test_runs RETURN d._key',
      { sk: seed.SUITE_KEY, prefix: 'e2e-seed-%' }
    );
    const removed = await cursor.all();
    console.log('purge-docs: removed ' + removed.length + ' orphan doc(s): ' + JSON.stringify(removed));
    process.exit(0);
  }
  if (cmd === 'verify-clean') {
    // The purge's self-check (#1890's whole point): NOTHING of the seed may
    // outlive the spec — repo delete does NOT cascade okf_head_test_runs
    // docs, so a purge that skipped the suite cascade leaves rows behind.
    // Exits 1 when anything survived, naming it. A missing collection is a
    // CLEAN venue (nothing was ever written) — verify-clean must not
    // create it, just answer clean.
    const db = await dbService.getConnection('default');
    const repos = await (
      await db.query('FOR x IN okf_repositories FILTER x.name == @n AND x.domain == @d RETURN x.repo_id', {
        n: seed.REPO_NAME,
        d: seed.DOMAIN
      })
    ).all();
    const col = db.collection(COLLECTION);
    const docs = (await col.exists())
      ? await (
          await db.query('FOR d IN okf_head_test_runs FILTER d.suite_key == @sk OR d._key LIKE @prefix RETURN d._key', {
            sk: seed.SUITE_KEY,
            prefix: 'e2e-seed-%'
          })
        ).all()
      : [];
    if (repos.length || docs.length) {
      console.error('verify-clean: LEFTOVERS — repos: ' + JSON.stringify(repos) + ' docs: ' + JSON.stringify(docs));
      process.exit(1);
    }
    console.log('verify-clean: no seed repos, no seed docs — clean');
    process.exit(0);
  }
  if (!repoId) {
    console.error('usage: node seed-ragas-venue-docs.js <seed|unstamp> <repo_id>');
    process.exit(1);
  }
  const db = await dbService.getConnection('default');

  if (cmd === 'unstamp') {
    // The purge ladder's last resort (the run-smoke-split purgeRepo
    // precedent): a repo whose publish stamped ingested_at refuses plain
    // delete; retract covers the honest case — this clears the stamp when
    // even retract-delete wedges (fabricated/never-drained states).
    await db.query(
      'FOR x IN okf_repositories FILTER x.repo_id == @r UPDATE x WITH { ingested_at: null } IN okf_repositories',
      { r: repoId }
    );
    console.log('unstamp: ingested_at cleared on ' + repoId);
    process.exit(0);
  }

  // ── seed ────────────────────────────────────────────────────────────────
  // The lifecycle submit refuses a repo whose PII scan never ran; the smoke
  // harness stamps it through the service (deterministic — the scan leg
  // would race the submit otherwise). Same call, same reason.
  await piiService.markRepoPiiScanned(repoId);
  console.log('seed: pii marked scanned on ' + repoId);

  const col = await ensureSeedCollection(db);
  // Deterministic re-seed: any prior seed docs for these keys are removed
  // first — an ArangoDB save on an existing _key is a conflict, not an upsert.
  for (const key of [seed.SUITE_KEY, seed.RUN_KEY]) {
    try {
      await col.remove(key);
    } catch (e) {
      if (!/not found/i.test(String(e && e.message))) throw e;
    }
  }
  const suite = seed.suiteDoc(repoId);
  const run = seed.runDoc(repoId);
  await col.save(suite);
  await col.save(run);

  // Read both back — the seed asserts its own write landed (the harness
  // never reports ready on a silent miss).
  const suiteBack = await col.document(seed.SUITE_KEY);
  const runBack = await col.document(seed.RUN_KEY);
  if (suiteBack.kind !== 'ragas_suite' || runBack.kind !== 'ragas_run' || runBack.status !== 'done') {
    throw new Error('seed verification failed: docs did not land with the expected kind/status');
  }
  console.log(
    'seed: suite ' +
      seed.SUITE_KEY +
      ' (1 entry) + run ' +
      seed.RUN_KEY +
      ' (done, 1 answered row) written for ' +
      repoId
  );
  process.exit(0);
}

main().catch((e) => {
  console.error('SEED ERROR', e && e.stack ? e.stack : e);
  process.exit(1);
});
