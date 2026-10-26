// trigger-explain.js — run INSIDE the okf-server container: regenerates the
// failure attribution + advisor advice for one run, against the DEPLOYED
// code (the fixed abstention detector, attribution rule and advisor prompt).
// Usage: node /tmp/trigger-explain.js <repo_id> <suite_key> <run_key>
const repoId = process.argv[2];
const suiteKey = process.argv[3];
const runKey = process.argv[4];
if (!repoId || !suiteKey || !runKey) {
  console.error('usage: node trigger-explain.js <repo_id> <suite_key> <run_key>');
  process.exit(2);
}
const svc = require('/app/services/ragas-suite-service');
(async () => {
  const begun = await svc.beginExplainFailures(repoId, suiteKey, { run_key: runKey }, { actor: { user_id: 'repair' } });
  console.log('explain_key:', begun.explain_key);
  const doc = await begun.done;
  const attrs = doc.payload.attributions || [];
  const byStage = attrs.reduce((a, x) => {
    a[x.stage] = (a[x.stage] || 0) + 1;
    return a;
  }, {});
  console.log('rows attributed:', attrs.length);
  console.log('stages:', JSON.stringify(byStage));
  console.log('\n--- ADVICE ---');
  console.log(JSON.stringify(doc.payload.advice, null, 1));
  console.log('\n--- sample attributions ---');
  attrs.slice(0, 6).forEach((a) => console.log(`${a.id} [${a.stage}] ${(a.fails || []).join(',')} :: ${a.recommendation}`));
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.message);
  process.exit(1);
});
