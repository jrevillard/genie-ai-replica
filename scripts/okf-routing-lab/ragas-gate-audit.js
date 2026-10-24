// ragas-gate-audit.js — exercise the regeneration gate against a suite's
// ORIGINAL references.
//
// The gate is the thing that decides whether a rewritten reference is
// written, so it has to be trustworthy on its own. This runs it over every
// entry of a suite and reports which references it would REFUSE — those are
// the ones whose wording does not match the corpus, i.e. the rows the
// entity-recall metric fails on even though the passage was delivered.
//
// Usage (inside the okf-server container):
//   node /tmp/ragas-gate-audit.js <suite_key> [known_ids...]

'use strict';

const dbService = require('/app/shared-lib/db-connection-service');
const { verifyGrounded } = require('/tmp/ragas-regenerate-reference.js');

const suiteKey = process.argv[2];
const known = process.argv.slice(3);

(async () => {
  const db = await dbService.getConnection();
  const doc = await db.collection('okf_head_test_runs').document(suiteKey);
  const entries = doc?.payload?.entries || [];
  console.log(`suite ${suiteKey}: ${entries.length} entries`);

  const caught = [];
  for (const e of entries) {
    const problems = verifyGrounded(e.reference_answer, e.reference_passages || []);
    if (problems.length) caught.push({ id: e.id, n: problems.length, first: problems[0] });
  }

  console.log(`\nGATE REFUSES ${caught.length} of ${entries.length} original references`);
  for (const c of caught) console.log(`  ${c.id}: ${c.n} problem(s) — ${c.first}`);

  if (known.length) {
    const ids = new Set(caught.map((c) => c.id));
    const missed = known.filter((id) => !ids.has(id));
    const extra = caught.filter((c) => !known.includes(c.id)).map((c) => c.id);
    console.log(`\nagainst the ${known.length} known rows:`);
    console.log(`  MISSED by the gate: ${missed.join(' ') || '(none)'}`);
    console.log(`  caught but not in the known list: ${extra.join(' ') || '(none)'}`);
  }

  process.exit(0);
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
