// ragas-rescore-judge.js — re-score a STORED run with a DIFFERENT judge.
//
// Why (David 2026-10-24): 55 of 86 attributed rows are staged "judge" — the
// answer was grounded and the judge scored it harshly. Settling that needs a
// second, materially stronger judge. Re-running the benchmark would RE-ANSWER
// every question, and vLLM is only near-greedy: we measured 100/100 answers
// changing between two runs of the SAME prompt. That churn would confound the
// judge comparison. This script re-scores the STORED rows — identical
// answers, contexts, references and reference passages — changing ONLY the
// judge. The comparison is then clean.
//
// Usage (inside the okf-server container, so the sidecar DNS + the model
// configs in ArangoDB are reachable):
//   node /tmp/ragas-rescore-judge.js <run_key> <judge_config_key> <judge_model> [metric,metric,...]
const http = require('http');

const runKey = process.argv[2];
const judgeConfigKey = process.argv[3];
const judgeModel = process.argv[4];
const metrics = (process.argv[5] || 'context_entities_recall,factual_correctness,answer_relevancy').split(',');
if (!runKey || !judgeConfigKey || !judgeModel) {
  console.error('usage: node ragas-rescore-judge.js <run_key> <judge_config_key> <judge_model> [metrics]');
  process.exit(2);
}
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
          // The sidecar's fail-closed service-to-service gate (app.py:49).
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
            resolve({ status: res.statusCode, body: { raw: d.slice(0, 400) } });
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
  const dbService = require('/app/shared-lib/db-connection-service');
  const db = await dbService.getConnection();
  const col = db.collection('okf_head_test_runs');

  const run = await col.document(runKey);
  const cfg = await db.collection('okf_model_configs').document(judgeConfigKey);
  if (!cfg || !cfg.api_key) throw new Error(`judge config ${judgeConfigKey} not found (or has no key)`);

  const suite = await col.document(run.suite_key);
  const byId = new Map(((suite.payload && suite.payload.entries) || []).map((e) => [e.id, e]));
  const rows = (run.payload && run.payload.results) || [];
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
  console.log(`run ${runKey}: ${samples.length} samples, judge ${cfg.name} / ${judgeModel}, metrics ${metrics.join(',')}`);
  console.log(`judge base_url ${cfg.base_url}`);

  const submitted = await reqJson('POST', `${SIDECAR}/evaluate`, {
    samples,
    metrics,
    judge: { provider: cfg.provider, base_url: cfg.base_url, model: judgeModel, api_key: cfg.api_key }
  });
  if (submitted.status !== 202) {
    console.error('submit failed', submitted.status, JSON.stringify(submitted.body).slice(0, 300));
    process.exit(1);
  }
  const jobId = submitted.body.job_id;
  console.log('job', jobId, '— polling');

  let job = null;
  for (let i = 0; i < 720; i++) {
    await sleep(5000);
    const s = await reqJson('GET', `${SIDECAR}/jobs/${jobId}`);
    job = s.body || {};
    if (i % 12 === 0) console.log(`  ... ${job.status || s.status}`);
    if (['done', 'failed', 'cancelled', 'error'].includes(job.status)) break;
  }
  if (!job || job.status !== 'done') {
    console.error('job did not complete:', job && job.status, JSON.stringify(job).slice(0, 300));
    process.exit(1);
  }
  const pq = (job.result && job.result.per_query) || [];
  console.log(`\nscored rows: ${pq.length}`);

  // Compare against the STORED scores (the original judge).
  const M = metrics;
  const rowsById = new Map(rows.map((r) => [r.id, r]));
  const meansOld = {};
  const meansNew = {};
  let moved = 0;
  const detail = [];
  pq.forEach((q, i) => {
    const r = rows[i];
    if (!r) return;
    for (const m of M) {
      const ov = r.metrics && r.metrics[m];
      const nv = q[m];
      if (typeof ov === 'number' && typeof nv === 'number') {
        (meansOld[m] = meansOld[m] || []).push(ov);
        (meansNew[m] = meansNew[m] || []).push(nv);
      }
    }
    const before = M.map((m) => (r.metrics && r.metrics[m] != null ? r.metrics[m] : null));
    const after = M.map((m) => (q[m] != null ? q[m] : null));
    if (before.some((v, k) => v != null && after[k] != null && Math.abs(after[k] - v) > 0.1)) moved += 1;
    detail.push({ id: r.id, before, after });
  });
  console.log('\n=== mean per metric: ORIGINAL judge vs NEW judge ===');
  for (const m of M) {
    const om = meansOld[m] ? meansOld[m].reduce((a, b) => a + b, 0) / meansOld[m].length : null;
    const nm = meansNew[m] ? meansNew[m].reduce((a, b) => a + b, 0) / meansNew[m].length : null;
    console.log(
      m.padEnd(26),
      om == null ? '-' : om.toFixed(4),
      nm == null ? '-' : nm.toFixed(4),
      om != null && nm != null ? ((nm - om >= 0 ? '+' : '') + (nm - om).toFixed(4)) : '-'
    );
  }
  console.log(`\nrows whose score moved >0.1 on any metric: ${moved}/${pq.length}`);
  const biggest = detail
    .map((d) => {
      const deltas = d.after.map((v, k) => (v != null && d.before[k] != null ? v - d.before[k] : null));
      const max = Math.max(...deltas.filter((x) => x != null).map(Math.abs));
      return { id: d.id, deltas, max };
    })
    .filter((d) => d.max > 0.15)
    .sort((a, b) => b.max - a.max)
    .slice(0, 12);
  console.log('\n=== biggest movers ===');
  biggest.forEach((d) =>
    console.log(`${d.id}: ${M.map((m, k) => `${m.slice(0, 6)} ${fmt(d.before[k])}→${fmt(d.after[k])}`).join('  ')}`)
  );
  function fmt(v) {
    return v == null ? 'null' : v.toFixed(2);
  }
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.message);
  process.exit(1);
});
