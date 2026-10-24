// ragas-rescore-env-judge.js — re-score a STORED run's rows with the ENV
// judge (the sidecar's own default) for one metric, over ALL rows.
//
// Why: the run's judge (MiniMax-M3.1-Flash) scores context_entities_recall
// as 0 on rows whose answer is correct and whose expected passage is
// present VERBATIM in the contexts, and MiniMax-M3 returns ALL_NAN for the
// same rows — the metric's entity extraction does not survive that model
// family. The env judge (granite) scores the same rows sensibly. This runs
// the whole run through the env judge so the metric can be compared over
// every row, not on the 21 MiniMax-M3 happened to score.
//
// Usage (inside the okf-server container):
//   node /tmp/ragas-rescore-env-judge.js <run_key> [metric]
const http = require('http');
const dbService = require('/app/shared-lib/db-connection-service');

const runKey = process.argv[2];
const metric = process.argv[3] || 'context_entities_recall';
const SIDECAR = process.env.OKF_RAGAS_URL || 'http://ragas-service:8090';

function reqJson(method, url, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = http.request(
      {
        host: u.hostname,
        port: u.port || 80,
        path: u.pathname + u.search,
        method,
        headers: {
          'Content-Type': 'application/json',
          'x-ragas-secret': process.env.RAGAS_INTERNAL_SECRET || process.env.OKF_INTERNAL_SECRET || ''
        }
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, body: JSON.parse(d) });
          } catch {
            resolve({ status: res.statusCode, body: { raw: d.slice(0, 300) } });
          }
        });
      }
    );
    r.on('error', reject);
    r.end(body ? JSON.stringify(body) : undefined);
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const db = await dbService.getConnection();
  const col = db.collection('okf_head_test_runs');
  const runDoc = await col.document(runKey);
  const rows = runDoc.payload.results || [];
  const suite = await col.document(runDoc.suite_key);
  const byId = new Map((suite.payload.entries || []).map((e) => [e.id, e]));

  const samples = rows
    .filter((r) => !r.error && r.answer)
    .map((r) => {
      const e = byId.get(r.id) || {};
      return {
        user_input: r.query,
        retrieved_contexts: r.contexts || [],
        response: r.answer,
        reference: e.reference_answer || '',
        reference_contexts: e.reference_passages || []
      };
    });
  console.log(`re-scoring ${samples.length} rows | metric=${metric} | judge=env (sidecar default)`);

  // judge: null → the sidecar's own env judge (RAGAS_JUDGE_*).
  const submitted = await reqJson('POST', `${SIDECAR}/evaluate`, {
    samples,
    metrics: [metric],
    judge: null
  });
  if (submitted.status !== 202) {
    console.error('submit failed', submitted.status, JSON.stringify(submitted.body).slice(0, 300));
    process.exit(1);
  }
  const jobId = submitted.body.job_id;
  console.log('job', jobId);
  let job = null;
  for (let i = 0; i < 720; i += 1) {
    await sleep(5000);
    job = (await reqJson('GET', `${SIDECAR}/jobs/${jobId}`)).body || {};
    if (i % 12 === 0) console.log(`  ... ${job.status} ${JSON.stringify(job.progress || {})}`);
    if (['done', 'failed', 'cancelled', 'error'].includes(job.status)) break;
  }
  if (!job || job.status !== 'done') {
    console.error('job did not complete:', job && job.status, JSON.stringify(job).slice(0, 300));
    process.exit(1);
  }
  const pq = (job.result && job.result.per_query) || [];
  const scored = pq.filter((q) => typeof q[metric] === 'number' && !Number.isNaN(q[metric]));
  const mean = scored.length ? scored.reduce((a, b) => a + b[metric], 0) / scored.length : null;
  console.log(`\nscored ${scored.length}/${pq.length}  mean=${mean === null ? '-' : mean.toFixed(4)}`);
  const old = rows.map((r) => (r.metrics || {})[metric]);
  const oldNum = old.filter((v) => typeof v === 'number' && !Number.isNaN(v));
  const oldMean = oldNum.length ? oldNum.reduce((a, b) => a + b, 0) / oldNum.length : null;
  console.log(`original judge scored ${oldNum.length}/${old.length}  mean=${oldMean.toFixed(4)}`);
  // The rows where the two judges disagree most.
  const byInput = new Map(pq.map((q) => [q.user_input, q]));
  const diffs = rows
    .map((r) => {
      const q = byInput.get(r.query);
      const nv = q ? q[metric] : null;
      const ov = (r.metrics || {})[metric];
      if (typeof ov !== 'number' || typeof nv !== 'number') return null;
      return { id: r.id, ov, nv, d: nv - ov };
    })
    .filter(Boolean);
  const moved = diffs.filter((x) => Math.abs(x.d) > 0.1);
  console.log(`\nrows whose score moved >0.1: ${moved.length}/${diffs.length}`);
  moved
    .sort((a, b) => Math.abs(b.d) - Math.abs(a.d))
    .slice(0, 15)
    .forEach((x) => console.log(`  ${x.id}: ${x.ov.toFixed(2)} -> ${x.nv.toFixed(2)} (${x.d >= 0 ? '+' : ''}${x.d.toFixed(2)})`));
  console.log('\njob result stored at /tmp/env-judge-' + runKey + '.json');
  require('fs').writeFileSync('/tmp/env-judge-' + runKey + '.json', JSON.stringify(pq));
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.message);
  process.exit(1);
});
