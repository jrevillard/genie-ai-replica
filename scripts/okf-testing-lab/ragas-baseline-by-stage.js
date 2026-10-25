// ragas-baseline-by-stage.js — READ-ONLY: the STORED (original-judge) scores
// of a run, sliced by the stage the failure attribution assigned to each row.
//
// Why this exists: the M3 re-score settles whether the 55 rows staged "judge"
// are real quality gaps or one harsh judge. That question is only answerable
// on the SAME row subset — so the baseline has to be computed per stage, not
// as one mean over 100 rows.
//
// Usage (inside the okf-server container):
//   node /tmp/ragas-baseline-by-stage.js <run_key> [metric,metric,...]
const dbService = require('/app/shared-lib/db-connection-service');

const runKey = process.argv[2];
const metrics = (process.argv[3] || 'context_entities_recall,factual_correctness,answer_relevancy').split(',');
if (!runKey) {
  console.error('usage: node ragas-baseline-by-stage.js <run_key> [metrics]');
  process.exit(2);
}

function mean(values) {
  const v = values.filter((x) => typeof x === 'number' && !Number.isNaN(x));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

(async () => {
  const db = await dbService.getConnection();

  const runCursor = await db.query('FOR d IN okf_head_test_runs FILTER d._key == @rk RETURN d', { rk: runKey });
  const run = (await runCursor.all())[0];
  if (!run) {
    console.error(`run ${runKey} not found`);
    process.exit(1);
  }
  const rows = (run.payload && run.payload.results) || [];

  // The attribution for this run: the explain doc names the stage per row.
  const exCursor = await db.query(
    'FOR d IN okf_head_test_runs FILTER d.kind == "ragas_explain" && d.payload.run_key == @rk ' +
      'SORT d.created_at DESC LIMIT 1 RETURN d',
    { rk: runKey }
  );
  const explain = (await exCursor.all())[0] || null;
  const attrs = (explain && explain.payload && explain.payload.attributions) || [];
  const stageById = new Map(attrs.map((a) => [a.id, a.stage]));
  const failsById = new Map(attrs.map((a) => [a.id, a.fails || []]));

  console.log(`run ${runKey}: ${rows.length} rows`);
  console.log(
    `judge: ${(run.payload.fidelity || {}).judge ? JSON.stringify(run.payload.fidelity.judge.pick || {}) : '(none)'} ` +
      `model=${(run.payload.fidelity || {}).judge ? run.payload.fidelity.judge.model : '?'}`
  );
  console.log(`explain doc: ${explain ? explain._key : '(none)'} — ${attrs.length} attributions`);
  if (attrs.length && attrs.length !== rows.length) {
    console.log(`  (attributions cover ${attrs.length} of ${rows.length} rows)`);
  }

  // Per-stage means.
  const byStage = new Map();
  for (const r of rows) {
    const stage = stageById.get(r.id) || 'unattributed';
    if (!byStage.has(stage)) byStage.set(stage, []);
    byStage.get(stage).push(r);
  }
  console.log('\n=== stored (original judge) mean per metric, BY STAGE ===');
  console.log('stage'.padEnd(16), 'rows'.padStart(5), metrics.map((m) => m.padEnd(24)).join(''));
  const order = ['judge', 'llm', 'reranker', 'vector-recall', 'retrieved', 'unattributed'];
  for (const stage of [
    ...order.filter((s) => byStage.has(s)),
    ...[...byStage.keys()].filter((s) => !order.includes(s))
  ]) {
    const rs = byStage.get(stage);
    const cells = metrics.map((m) => {
      const v = mean(rs.map((r) => (r.metrics || {})[m]));
      return (v === null ? '-' : v.toFixed(4)).padEnd(24);
    });
    console.log(stage.padEnd(16), String(rs.length).padStart(5), cells.join(''));
  }

  // The overall mean, for reference.
  const overall = metrics.map((m) => {
    const v = mean(rows.map((r) => (r.metrics || {})[m]));
    return (v === null ? '-' : v.toFixed(4)).padEnd(24);
  });
  console.log('ALL'.padEnd(16), String(rows.length).padStart(5), overall.join(''));

  // The row ids per stage — the comparison script needs the SAME subset.
  const idsByStage = {};
  for (const [stage, rs] of byStage) idsByStage[stage] = rs.map((r) => r.id);
  require('fs').writeFileSync('/tmp/stage-ids.json', JSON.stringify(idsByStage, null, 1));
  console.log('\nstage row ids written to /tmp/stage-ids.json');
  console.log('failing metric counts by stage:');
  for (const [stage, rs] of byStage) {
    const counts = {};
    rs.forEach((r) => (failsById.get(r.id) || []).forEach((f) => (counts[f] = (counts[f] || 0) + 1)));
    const top = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `${k}=${v}`)
      .join(' ');
    console.log(`  ${stage.padEnd(16)} ${top}`);
  }
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.message);
  process.exit(1);
});
