// ragas-entity-probe.js — READ-ONLY probe: score a few rows'
// context_entities_recall with DIFFERENT judges, to find out whether the
// metric's entity extraction is failing on the row or the model is simply
// harsh.
//
// Why: two judge-stage rows scored entity_recall = 0 with the expected
// passage present VERBATIM in the contexts, a faithful answer and
// factual_correctness 1.0. Per RAGAS the score is |GN ∩ CN| / |GN| with
// GN = entities extracted from the REFERENCE ANSWER and CN = entities
// extracted from the JOINED CONTEXTS - so 0 means the two extractions
// shared nothing. That is a broken reading, not a quality gap.
//
// Usage (inside the okf-server container):
//   node /tmp/ragas-entity-probe.js <run_key> [row_id,row_id,...]
const http = require('http');
const dbService = require('/app/shared-lib/db-connection-service');

const runKey = process.argv[2];
const rowIds = (process.argv[3] || 'new-8,new-11').split(',');
const SIDECAR = process.env.OKF_RAGAS_URL || 'http://ragas-service:8090';
const METRIC = 'context_entities_recall';

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
  const db = await dbService.getConnection();
  const col = db.collection('okf_head_test_runs');
  const runDoc = await col.document(runKey);
  const rows = runDoc.payload.results || [];
  const suite = await col.document(runDoc.suite_key);
  const byId = new Map((suite.payload.entries || []).map((e) => [e.id, e]));

  const samples = rows
    .filter((r) => rowIds.includes(r.id) && !r.error && r.answer)
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
  console.log(`probing ${samples.length} row(s) with ${METRIC}\n`);

  // The judges to compare: the run's own (MiniMax-M3.1-Flash) and the env
  // judge the sidecar uses by default.
  const cfg = (await col.database) ? null : await db.collection('okf_model_configs').document('mc1792423414860-1bbfd8');
  const judges = [
    {
      name: 'Minimax-M3.1-Flash (the run judge)',
      judge: cfg
        ? {
            provider: cfg.provider,
            base_url: cfg.base_url,
            model: 'MiniMax-M3.1-Flash',
            api_key: cfg.api_key
          }
        : null
    },
    {
      name: 'MiniMax-M3',
      judge: cfg
        ? {
            provider: cfg.provider,
            base_url: cfg.base_url,
            model: 'MiniMax-M3',
            api_key: cfg.api_key
          }
        : null
    },
    { name: 'env judge (sidecar default)', judge: null }
  ];

  for (const j of judges) {
    if (j.judge === null && j.name.startsWith('Minimax')) continue;
    const submitted = await reqJson('POST', `${SIDECAR}/evaluate`, {
      samples,
      metrics: [METRIC],
      judge: j.judge
    });
    if (submitted.status !== 202) {
      console.log(`${j.name}: submit failed ${submitted.status} ${JSON.stringify(submitted.body).slice(0, 200)}`);
      continue;
    }
    const jobId = submitted.body.job_id;
    let job = null;
    for (let i = 0; i < 240; i += 1) {
      await sleep(3000);
      job = (await reqJson('GET', `${SIDECAR}/jobs/${jobId}`)).body || {};
      if (['done', 'failed', 'cancelled', 'error'].includes(job.status)) break;
    }
    const pq = (job.result && job.result.per_query) || [];
    console.log(`${j.name}: status=${job.status}`);
    if (job.error) console.log(`  error: ${String(job.error).slice(0, 300)}`);
    pq.forEach((q, i) => {
      const v = q[METRIC];
      console.log(
        `  ${samples[i].user_input.slice(0, 55)} -> ${METRIC}=${v === undefined ? 'MISSING' : JSON.stringify(v)}` +
          `  (nan=${q.ragas_nan || 'none'})`
      );
    });
    if (!pq.length) console.log('  (no per_query rows)');
    console.log('');
  }
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.message);
  process.exit(1);
});
