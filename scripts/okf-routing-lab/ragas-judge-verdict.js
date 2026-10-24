// ragas-judge-verdict.js — READ-ONLY: the verdict on the judge-stage rows.
//
// Answers: with a judge that CAN measure context_entities_recall, do the
// rows the attribution staged "judge" still fail? That is the question the
// attribution's own rule poses ("treat as judge noise unless a stronger
// judge model reproduces it") — and it can only be answered by a judge that
// produces a value.
//
// Usage (inside the okf-server container):
//   node /tmp/ragas-judge-verdict.js <run_key> <per_query.json> [metric]
const fs = require('fs');
const dbService = require('/app/shared-lib/db-connection-service');

const runKey = process.argv[2];
const pqFile = process.argv[3] || '/tmp/env-entity.json';
const metric = process.argv[4] || 'context_entities_recall';

(async () => {
  const db = await dbService.getConnection();
  const col = db.collection('okf_head_test_runs');
  const runDoc = await col.document(runKey);
  const rows = runDoc.payload.results || [];
  const suite = await col.document(runDoc.suite_key);
  const byId = new Map((suite.payload.entries || []).map((e) => [e.id, e]));
  // The suite's own threshold wins over the service default — the verdict
  // must use the same cut-off the attribution used.
  const THRESHOLD =
    ((suite.payload || {}).thresholds || {})[metric] ||
    { context_entities_recall: 0.5, factual_correctness: 0.6, answer_relevancy: 0.6 }[metric] ||
    0.5;

  const exCur = await db.query(
    'FOR d IN okf_head_test_runs FILTER d.kind == "ragas_explain" && d.payload.run_key == @rk ' +
      'SORT d.created_at DESC LIMIT 1 RETURN d',
    { rk: runKey }
  );
  const explain = (await exCur.all())[0];
  const attrs = (explain && explain.payload.attributions) || [];
  const stageById = new Map(attrs.map((a) => [a.id, a.stage]));

  const pq = JSON.parse(fs.readFileSync(pqFile, 'utf8'));
  const byInput = new Map(pq.map((q) => [q.user_input, q]));
  const isNum = (v) => typeof v === 'number' && !Number.isNaN(v);

  const orig = rows.map((r) => {
    const q = byInput.get(r.query);
    return {
      id: r.id,
      stage: stageById.get(r.id) || 'unattributed',
      oldV: (r.metrics || {})[metric],
      newV: q ? q[metric] : undefined,
      newScored: q ? isNum(q[metric]) : false
    };
  });

  console.log(`metric=${metric}  rows=${orig.length}\n`);
  const oldScored = orig.filter((r) => isNum(r.oldV));
  const newScored = orig.filter((r) => r.newScored);
  const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
  const fmt = (v) => (v === null ? '-' : v.toFixed(4));
  console.log(
    `ORIGINAL judge scored ${oldScored.length}/${orig.length}  mean ${fmt(mean(oldScored.map((r) => r.oldV)))}`
  );
  console.log(
    `NEW judge      scored ${newScored.length}/${orig.length}  mean ${fmt(mean(newScored.map((r) => r.newV)))}`
  );

  // Per stage: does the row still fail under the new judge?
  const stages = {};
  orig.forEach((r) => {
    stages[r.stage] = stages[r.stage] || { n: 0, newScored: 0, oldFail: 0, newFail: 0, bothFail: 0, bothPass: 0 };
    const s = stages[r.stage];
    s.n += 1;
    if (r.newScored) s.newScored += 1;
    const oldFailed = isNum(r.oldV) && r.oldV < THRESHOLD;
    const newFailed = r.newScored && r.newV < THRESHOLD;
    if (oldFailed) s.oldFail += 1;
    if (newFailed) s.newFail += 1;
    if (oldFailed && newFailed) s.bothFail += 1;
    if (oldFailed && !newFailed && r.newScored) s.bothPass += 1;
  });
  console.log('\n=== per stage (threshold ' + THRESHOLD + ') ===');
  console.log(
    'stage'.padEnd(16),
    'rows'.padStart(5),
    'newScored'.padStart(10),
    'oldFail'.padStart(8),
    'newFail'.padStart(8),
    'stillFail'.padStart(10),
    'nowPass'.padStart(8)
  );
  Object.entries(stages).forEach(([stage, s]) => {
    console.log(
      stage.padEnd(16),
      String(s.n).padStart(5),
      String(s.newScored).padStart(10),
      String(s.oldFail).padStart(8),
      String(s.newFail).padStart(8),
      String(s.bothFail).padStart(10),
      String(s.bothPass).padStart(8)
    );
  });

  // The rows the attribution called judge noise, and what the new judge says.
  const judged = orig.filter((r) => r.stage === 'judge');
  const jScored = judged.filter((r) => r.newScored);
  const jOldFail = jScored.filter((r) => isNum(r.oldV) && r.oldV < THRESHOLD);
  const jStillFail = jOldFail.filter((r) => r.newV < THRESHOLD);
  const jNowPass = jOldFail.filter((r) => r.newV >= THRESHOLD);
  console.log(`\n=== the ${judged.length} judge-stage rows ===`);
  console.log(`  the new judge scored ${jScored.length}`);
  console.log(`  of the ${jOldFail.length} that failed under the OLD judge:`);
  console.log(`    STILL failing: ${jStillFail.length}  -> a real gap, not judge harshness`);
  console.log(`    now passing:   ${jNowPass.length}  -> the old judge was harsh`);
  if (jNowPass.length) console.log(`    now passing: ${jNowPass.map((r) => r.id).join(', ')}`);
  const unmeasured = judged.filter((r) => !r.newScored);
  if (unmeasured.length) {
    console.log(
      `  NOT MEASURED by the new judge: ${unmeasured.length} (${unmeasured
        .map((r) => r.id)
        .slice(0, 12)
        .join(', ')})`
    );
  }
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.message);
  process.exit(1);
});
