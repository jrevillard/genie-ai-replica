// ragas-gate-audit.js — score a suite's ORIGINAL references against the
// corpus, with the SAME metric the regeneration gate uses.
//
// The gate is what decides whether a rewritten reference is written, so it
// has to be trustworthy on its own. This runs it in READ-ONLY mode over
// every entry of a suite and reports the score each ORIGINAL reference
// earns — i.e. which references the corpus cannot ground, which are the
// rows the entity-recall metric fails on even though the passage was
// delivered perfectly.
//
// WHY THE METRIC AND NOT A PROXY
// ---
// The first version of the gate checked "does every number and proper noun
// in the answer appear in the passage?" — a heuristic that refused 86 of
// 100 rows, flagging ordinary connectives the entity extractor never
// treats as entities ("according", "covers"). The gate is now the metric
// itself (`context_entities_recall`), and this audit uses it too, so the
// numbers here are the numbers the gate sees.
//
// READ-ONLY: it scores references and prints a table. It never calls the
// judge to rewrite anything and never writes to the suite.
//
// Usage (inside the okf-server container):
//   node /tmp/ragas-gate-audit.js <suite_key> [--below 0.5]
//
// `--below N` (default 0.5) is the score under which a reference is
// reported as UNGROUNDED — the references whose entities the corpus does
// not produce. Those rows are not repairable by rewording: their entries
// need regenerating against the current corpus.
//
// NOTE: this competes with a running benchmark for the judge endpoint.
// Do not run it while a benchmark is in flight.

'use strict';

const dbService = require('/app/shared-lib/db-connection-service');
const { scoreEntityRecall, fmt } = require('/tmp/ragas-regenerate-reference.js');

const args = process.argv.slice(2);
const suiteKey = args.find((a) => !a.startsWith('--'));
const belowIdx = args.indexOf('--below');
const below = belowIdx === -1 ? 0.5 : Number(args[belowIdx + 1]) || 0.5;

if (!suiteKey) {
  console.error('usage: node ragas-gate-audit.js <suite_key> [--below 0.5]');
  process.exit(2);
}

(async () => {
  const db = await dbService.getConnection();
  const doc = await db.collection('okf_head_test_runs').document(suiteKey);
  const entries = doc?.payload?.entries || [];
  console.log(`suite ${suiteKey}: ${entries.length} entries`);
  console.log(`ungrounded threshold: < ${fmt(below)}\n`);

  const scored = [];
  const unscored = [];

  for (const entry of entries) {
    const passages = Array.isArray(entry.reference_passages) ? entry.reference_passages : [];
    if (!passages.length) {
      unscored.push({ id: entry.id, why: 'no reference passages' });
      continue;
    }
    let score;
    try {
      score = await scoreEntityRecall(entry.reference_answer, passages);
    } catch (e) {
      unscored.push({ id: entry.id, why: e.message });
      continue;
    }
    if (score === null) {
      unscored.push({ id: entry.id, why: 'the metric returned no score' });
      continue;
    }
    scored.push({ id: entry.id, score });
    console.log(`  ${entry.id}: ${fmt(score)}`);
  }

  const ungrounded = scored.filter((s) => s.score < below);
  const mean = scored.length ? scored.reduce((a, s) => a + s.score, 0) / scored.length : 0;

  console.log(`\n=== ${scored.length} scored, ${unscored.length} unscored ===`);
  console.log(`mean entity recall of the original references: ${fmt(mean)}`);
  console.log(`\nUNGROUNDED (below ${fmt(below)}): ${ungrounded.length}`);
  for (const u of ungrounded) console.log(`  ${u.id}: ${fmt(u.score)}`);

  if (unscored.length) {
    console.log(`\nNOT SCORED: ${unscored.length}`);
    for (const u of unscored) console.log(`  ${u.id}: ${u.why}`);
  }

  console.log(
    '\nA reference that scores low here names entities the corpus does not\n' +
      'contain: rewording it cannot fix that. Those entries need to be\n' +
      'regenerated against the current corpus.'
  );

  process.exit(0);
})().catch((e) => {
  console.error(e.stack || e.message);
  process.exit(1);
});
