// ragas-judge-coverage.js — READ-ONLY: how much did each judge actually
// SCORE, and on which rows?
//
// Why: the comparison's means are computed over the rows where BOTH judges
// produced a number. If the new judge only produced one for a fifth of the
// rows, that subset may not be representative, and the mean says more about
// the subset than about the system.
//
// Usage (inside the okf-server container):
//   node /tmp/ragas-judge-coverage.js <run_key> <job_id> [metrics]
const dbService = require('/app/shared-lib/db-connection-service');

const runKey = process.argv[2];
const jobId = process.argv[3];
const metrics = (process.argv[4] || 'context_entities_recall,factual_correctness,answer_relevancy').split(',');
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
const http = require('http');

(async () => {
  const db = await dbService.getConnection();
  const run = (await db.collection('okf_head_test_runs').document(runKey)).payload;
  const rows = run.results || [];
  const job = (await reqJson('GET', `${SIDECAR}/jobs/${jobId}`)).body || {};
  const pq = (job.result && job.result.per_query) || [];

  const exCur = await db.query(
    'FOR d IN okf_head_test_runs FILTER d.kind == "ragas_explain" && d.payload.run_key == @rk ' +
      'SORT d.created_at DESC LIMIT 1 RETURN d',
    { rk: runKey }
  );
  const explain = (await exCur.all())[0];
  const stageById = new Map(((explain && explain.payload.attributions) || []).map((a) => [a.id, a.stage]));

  // Align by user_input (the sidecar exposes it).
  const byInput = new Map(pq.map((q) => [q.user_input, q]));
  const pairs = rows.map((r) => [r, byInput.get(r.query)]).filter(([, q]) => q);
  console.log(`rows=${rows.length} matched=${pairs.length} per_query=${pq.length}\n`);

  const isNum = (v) => typeof v === 'number' && !Number.isNaN(v);

  for (const m of metrics) {
    const oldNum = pairs.filter(([r]) => isNum((r.metrics || {})[m]));
    const newNum = pairs.filter(([, q]) => isNum(q[m]));
    const both = pairs.filter(([r, q]) => isNum((r.metrics || {})[m]) && isNum(q[m]));
    const oldZero = oldNum.filter(([r]) => (r.metrics || {})[m] === 0).length;
    const newZero = newNum.filter(([, q]) => q[m] === 0).length;
    const mean = (arr) => (arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : null);
    const ov = mean(oldNum.map(([r]) => (r.metrics || {})[m]));
    const nv = mean(newNum.map(([, q]) => q[m]));
    const bv = mean(both.map(([r, q]) => (r.metrics || {})[m]));
    const bn = mean(both.map(([, q]) => q[m]));
    console.log(`--- ${m}`);
    console.log(
      `  OLD scored ${oldNum.length}/${pairs.length} (zeros ${oldZero})  mean over ALL scored = ${ov == null ? '-' : ov.toFixed(4)}`
    );
    console.log(
      `  NEW scored ${newNum.length}/${pairs.length} (zeros ${newZero})  mean over ALL scored = ${nv == null ? '-' : nv.toFixed(4)}`
    );
    console.log(
      `  PAIRED ${both.length} rows: old ${bv == null ? '-' : bv.toFixed(4)} -> new ${bn == null ? '-' : bn.toFixed(4)}` +
        ` (delta ${bv != null && bn != null ? (bn - bv >= 0 ? '+' : '') + (bn - bv).toFixed(4) : '-'})`
    );
    // Where did the new judge produce a value, by stage?
    const byStage = {};
    newNum.forEach(([r]) => {
      const s = stageById.get(r.id) || 'unattributed';
      byStage[s] = byStage[s] || { scored: 0, total: 0, newSum: 0, oldSum: 0 };
      byStage[s].scored += 1;
      byStage[s].newSum += byInput.get(r.query)[m];
    });
    pairs.forEach(([r]) => {
      const s = stageById.get(r.id) || 'unattributed';
      byStage[s] = byStage[s] || { scored: 0, total: 0, newSum: 0, oldSum: 0 };
      byStage[s].total += 1;
    });
    console.log('  new-judge coverage by stage:');
    Object.entries(byStage).forEach(([s, v]) => {
      console.log(
        `    ${s.padEnd(14)} scored ${String(v.scored).padStart(3)}/${String(v.total).padStart(3)}` +
          (v.scored ? `  new mean ${(v.newSum / v.scored).toFixed(4)}` : '')
      );
    });
  }
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.message);
  process.exit(1);
});
