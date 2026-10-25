// ragas-ladder-crosstab.js — READ-ONLY: cross-tabulate the ATTRIBUTION stage
// against the LADDER's verdict for the same rows.
//
// Why: the attribution stages a row "judge" when context_recall passed and
// context_entities_recall failed, and says "the reference content WAS
// retrieved" on the strength of context_recall. But context_recall measures
// whether the reference ANSWER's sentences are attributable to the contexts
// — not whether the expected PASSAGE was delivered. The ladder knows where
// the passage went; this shows whether the attribution is listening to it.
//
// Usage (inside the okf-server container):
//   node /tmp/ragas-ladder-crosstab.js <run_key>
const dbService = require('/app/shared-lib/db-connection-service');

const runKey = process.argv[2];
if (!runKey) {
  console.error('usage: node ragas-ladder-crosstab.js <run_key>');
  process.exit(2);
}

(async () => {
  const db = await dbService.getConnection();
  const cur = await db.query(
    'FOR d IN okf_head_test_runs FILTER d.kind == "ragas_explain" && d.payload.run_key == @rk ' +
      'SORT d.created_at DESC LIMIT 1 RETURN d',
    { rk: runKey }
  );
  const doc = (await cur.all())[0];
  if (!doc) {
    console.error(`no explain doc for ${runKey}`);
    process.exit(1);
  }
  const attrs = doc.payload.attributions || [];
  console.log(`explain ${doc._key} — ${attrs.length} attributed rows\n`);

  // stage x ladder_stage
  const cross = {};
  attrs.forEach((a) => {
    const ls = (a.evidence && a.evidence.ladder_stage) || 'no-ladder';
    const key = `${a.stage} <- ${ls}`;
    cross[key] = (cross[key] || 0) + 1;
  });
  console.log('=== attribution stage <- ladder verdict ===');
  Object.entries(cross)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, n]) => console.log(`  ${String(n).padStart(3)}  ${k}`));

  // The rows the context_entities_recall rule claims are judge noise.
  const entRows = attrs.filter(
    (a) => (a.fails || []).includes('context_entities_recall') && !(a.fails || []).includes('context_recall')
  );
  console.log(`\n=== rows the rule calls "judge noise" (entity recall failed, recall passed): ${entRows.length} ===`);
  const entCross = {};
  entRows.forEach((a) => {
    const ls = (a.evidence && a.evidence.ladder_stage) || 'no-ladder';
    entCross[ls] = (entCross[ls] || 0) + 1;
  });
  Object.entries(entCross)
    .sort((a, b) => b[1] - a[1])
    .forEach(([k, n]) => console.log(`  ${String(n).padStart(3)}  ladder=${k}`));

  // Of those, how many actually had the passage DELIVERED (in_contexts>0)?
  const delivered = entRows.filter((a) => a.evidence && a.evidence.in_contexts > 0).length;
  const inCorpus = entRows.filter((a) => a.evidence && a.evidence.in_corpus > 0).length;
  console.log(`\n  of the ${entRows.length}: passage reached the contexts in ${delivered}, present in the corpus in ${inCorpus}`);
  const notDelivered = entRows.filter((a) => a.evidence && a.evidence.in_contexts === 0);
  console.log(`  NOT delivered (in_contexts=0): ${notDelivered.length}`);
  console.log(`  their ladder verdicts: ${JSON.stringify(notDelivered.reduce((acc, a) => {
    const ls = (a.evidence && a.evidence.ladder_stage) || 'no-ladder';
    acc[ls] = (acc[ls] || 0) + 1;
    return acc;
  }, {}))}`);
  console.log(`  ids: ${notDelivered.map((a) => a.id).join(', ')}`);
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.message);
  process.exit(1);
});
