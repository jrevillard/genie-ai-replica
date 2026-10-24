// ragas-abstention-backfill.js — ONE-OFF repair of the false-abstention bug
// (David 2026-10-24): the benchmark's old text matcher flagged rows whose
// answer merely SAID the knowledge base does not cover part of the question.
// The chat UI answered those same questions in full with a 99% confidence
// badge, so the rows were never abstentions.
//
// Recomputes each run row's `abstained` flag with the authoritative rule
// (chatqna's own metadata + empty answer + chatqna's sentinel) and rewrites
// the run doc's summary (n_abstained). The judge's scores are NOT touched —
// they are the judge's own verdicts.
//
// Uses the SHARED db driver (components/shared/lib/db-connection-service),
// never an ad-hoc driver.
const path = require('path');
const fs = require('fs');
const REPO = path.join(__dirname, '..', '..');

// The shared driver reads process.env (ARANGO_URL / ARANGO_DB / user /
// password) — the local build's .env is the source for those. The local
// build points at the host's ArangoDB (not the docker DNS name) and uses
// the `genie-ai` database.
for (const line of fs.readFileSync('C:/Dev/builds/main/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) process.env[m[1]] = m[2].replace(/^"|"$/g, '');
}
process.env.ARANGO_URL = process.env.ARANGO_URL || `http://localhost:${process.env.ARANGO_PORT || '8529'}`;
process.env.ARANGO_DB = process.env.ARANGO_DB || 'genie-ai';
process.env.ARANGO_USER = process.env.ARANGO_USER || 'root';

const dbService = require(path.join(REPO, 'components', 'shared', 'lib', 'db-connection-service'));

const COLLECTION = 'okf_head_test_runs';
const SENTINEL = '[no relevant documents found]';

// The authoritative rule — mirrors servedIsAbstention() in
// components/okf-server/services/ragas-suite-service.js.
//
// The old code stamped the reason, which makes the repair precise:
//   'answer contract'          → the flag came from the TEXT heuristic → recompute
//   'reranker_input_too_long'  → chatqna's own abstention → keep
function authoritativeAbstained(row) {
  if (row.abstention_reason === 'reranker_input_too_long') return true; // chatqna's own abstention
  const text = String(row.answer || '').trim();
  if (!text) return true;
  if (text.toLowerCase().startsWith(SENTINEL)) return true;
  // Nothing retrieved → nothing to answer from. Only decidable when the
  // stored row recorded the served evidence; older rows without it fall
  // through to "not abstained" (the text heuristic was wrong for them).
  if (row.is_grounded === false && Number(row.related_documents || 0) === 0 && row.contexts) {
    return row.contexts.length === 0;
  }
  return false;
}

(async () => {
  const db = await dbService.getConnection();
  const col = db.collection(COLLECTION);
  const cursor = await db.query(
    `FOR d IN ${COLLECTION} FILTER d.kind == "ragas_run" SORT d.created_at DESC RETURN d`
  );
  const runs = await cursor.all();
  console.log(`ragas_run docs found: ${runs.length}`);

  let totalChanged = 0;
  let runsChanged = 0;
  for (const run of runs) {
    const results = (run.payload && run.payload.results) || [];
    if (!results.length) continue;
    const changes = [];
    for (const r of results) {
      const next = authoritativeAbstained(r);
      if (next !== !!r.abstained) {
        changes.push(
          `${r.id}: abstained ${!!r.abstained} → ${next} (reason was "${r.abstention_reason || 'none'}")`
        );
        r.abstained = next;
        r.abstention_reason = next ? r.abstention_reason || 'answer contract' : '';
      }
    }
    if (!changes.length) {
      console.log(`\n${run._key}: no changes (${results.length} rows)`);
      continue;
    }
    totalChanged += changes.length;
    runsChanged += 1;
    const payload = { ...run.payload, results };
    payload.summary = { ...(run.payload.summary || {}) };
    payload.summary.n_abstained = results.filter((r) => r.abstained).length;
    // update() merges the patch into the stored doc.
    await col.update(run._key, { payload });
    // Read back — a silent no-op here is how the first attempt failed.
    const check = await col.document(run._key);
    const persisted = (check.payload.results || []).filter((r) => r.abstained).length;
    console.log(`\n${run._key}: ${changes.length} row(s) reclassified → n_abstained ${payload.summary.n_abstained} (persisted: ${persisted})`);
    changes.forEach((c) => console.log('   ' + c));
  }
  console.log(`\nTOTAL: ${totalChanged} row(s) reclassified across ${runsChanged} run(s)`);
})().catch((e) => {
  console.error('ERR', e && e.message, e && e.stack);
  process.exit(1);
});
