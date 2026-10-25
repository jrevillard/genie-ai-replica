// run-explain-advice.js — READ-ONLY: the advisor's advice for a run, as the
// operator sees it in the panel.
//
// Usage (inside the okf-server container):
//   node /tmp/run-explain-advice.js <run_key>
const dbService = require('/app/shared-lib/db-connection-service');

const runKey = process.argv[2];
if (!runKey) {
  console.error('usage: node run-explain-advice.js <run_key>');
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
  console.log(`explain ${doc._key}  created ${doc.created_at}`);
  console.log('\n=== ADVICE ===');
  console.log(JSON.stringify(doc.payload.advice, null, 1));
  console.log('\n=== run_facts ===');
  console.log(JSON.stringify(doc.payload.run_facts, null, 1));
  const attrs = doc.payload.attributions || [];
  const byStage = {};
  attrs.forEach((a) => {
    byStage[a.stage] = byStage[a.stage] || { n: 0, fails: {} };
    byStage[a.stage].n += 1;
    (a.fails || []).forEach((f) => {
      byStage[a.stage].fails[f] = (byStage[a.stage].fails[f] || 0) + 1;
    });
  });
  console.log('\n=== stage summary ===');
  Object.entries(byStage).forEach(([s, v]) => {
    const top = Object.entries(v.fails)
      .sort((a, b) => b[1] - a[1])
      .map(([k, n]) => `${k}=${n}`)
      .join(' ');
    console.log(`  ${s.padEnd(16)} n=${String(v.n).padEnd(4)} ${top}`);
  });
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.message);
  process.exit(1);
});
