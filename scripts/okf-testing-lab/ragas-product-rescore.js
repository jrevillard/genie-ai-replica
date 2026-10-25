// ragas-product-rescore.js — run the PRODUCT re-score path in-container: the
// same code the UI button calls, so the result lands as a real run doc in the
// panel (with its judge named and its coverage recorded).
//
// Usage (inside the okf-server container):
//   node /tmp/ragas-product-rescore.js <repo_id> <suite_key> <run_key> [judge_config_key] [metrics]
const dbService = require('/app/shared-lib/db-connection-service');

const repoId = process.argv[2];
const suiteKey = process.argv[3];
const runKey = process.argv[4];
const judgeConfigKey = process.argv[5] || '__env__';
const metrics = (process.argv[6] || 'context_entities_recall,factual_correctness,answer_relevancy')
  .split(',')
  .map((x) => x.trim())
  .filter(Boolean);
if (!repoId || !suiteKey || !runKey) {
  console.error('usage: node ragas-product-rescore.js <repo_id> <suite_key> <run_key> [judge_config_key] [metrics]');
  process.exit(2);
}

(async () => {
  const svc = require('/app/services/ragas-suite-service');
  const db = await dbService.getConnection();
  // Which judge will this actually use? The env pick resolves to the
  // sidecar's own default — print what that is so the run doc can be
  // checked against it.
  const cfg = await db.collection('okf_model_configs').document(judgeConfigKey).catch(() => null);
  console.log(
    `judge pick: ${judgeConfigKey} -> ${
      cfg ? `${cfg.name} / ${cfg.default_model}` : 'the ENV judge (sidecar default)'
    }`
  );
  console.log(`metrics: ${metrics.join(', ')}`);
  console.log(`source run: ${runKey}`);

  const begun = await svc.rescoreRun(
    repoId,
    suiteKey,
    runKey,
    { judge_config_key: judgeConfigKey, metrics },
    { actor: { user_id: 'verdict-lab' } }
  );
  console.log(`new run: ${begun.run_key} (status ${begun.status})`);
  const doc = await begun.done;
  console.log(`\nrun ${doc._key} status=${doc.status}`);
  console.log(`fidelity.judge: ${JSON.stringify(doc.payload.fidelity.judge)}`);
  console.log(`summary.coverage: ${JSON.stringify(doc.payload.summary.coverage)}`);
  console.log(`summary.metrics: ${JSON.stringify(doc.payload.summary.metrics)}`);
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.message);
  process.exit(1);
});
