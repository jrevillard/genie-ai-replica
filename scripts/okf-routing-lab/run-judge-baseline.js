// run-judge-baseline.js — READ-ONLY: the recent RAGAS runs with their judge and
// per-metric means, straight from Arango. Used to line a re-score up against
// the run it re-scored.
//
// Usage: node scripts/okf-routing-lab/run-judge-baseline.js [limit]
// Reads the local build's ArangoDB on localhost:8529, db genie-ai.
const http = require('http');

const DB = process.env.ARANGO_DB || 'genie-ai';
const LIMIT = Number(process.argv[2] || 8);
const METRICS = [
  'context_entities_recall',
  'factual_correctness',
  'answer_relevancy',
  'faithfulness',
  'answer_correctness',
  'context_precision',
  'context_recall'
];

const auth = Buffer.from(`root:${process.env.ARANGO_PASSWORD || ''}`).toString('base64');

function q(aql) {
  return new Promise((resolve, reject) => {
    // ArangoDB rejects chunked request bodies (501) — send Content-Length.
    const body = JSON.stringify({ query: aql });
    const req = http.request(
      {
        host: 'localhost',
        port: 8529,
        path: `/_db/${DB}/_api/cursor`,
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(body)
        }
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            const j = JSON.parse(d);
            if (j.error) return reject(new Error(`${j.errorMessage} (${j.code})`));
            resolve(j.result || []);
          } catch (e) {
            reject(e);
          }
        });
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function mean(rows, m) {
  const v = rows
    .map((r) => (r.metrics || r.metric_scores || {})[m])
    .filter((x) => typeof x === 'number' && !Number.isNaN(x));
  if (!v.length) return null;
  return v.reduce((a, b) => a + b, 0) / v.length;
}

(async () => {
  const docs = await q(`FOR d IN okf_head_test_runs SORT d.created_at DESC LIMIT ${LIMIT} RETURN d`);
  if (!docs.length) {
    console.log('no run docs');
    return;
  }
  console.log(`runs in ${DB}.okf_head_test_runs (newest ${LIMIT}):\n`);
  for (const d of docs) {
    const p = d.payload || {};
    const pick = (p.fidelity && p.fidelity.judge && p.fidelity.judge.pick) || {};
    const rows = p.entries || [];
    console.log(`key        ${d._key}   kind=${d.kind} suite=${d.suite_key}`);
    console.log(`  status   ${d.status}${p.phase ? ' / ' + p.phase : ''}`);
    console.log(`  created  ${d.created_at}`);
    console.log(`  judge    ${pick.config_key || '(none)'} :: ${pick.model || '(none)'} :: ${pick.provider || ''}`);
    if (d.rescore_of || p.rescore_of) console.log(`  rescore_of ${d.rescore_of || p.rescore_of}`);
    console.log(`  rows     ${rows.length}`);
    const res = p.results || {};
    const means = METRICS.map((m) => {
      const v = res[m];
      const num = typeof v === 'number' ? v : v && typeof v.mean === 'number' ? v.mean : null;
      return num === null ? null : `${m}=${num.toFixed(4)}`;
    }).filter(Boolean);
    console.log(`  means    ${means.join('  ') || '(none)'}`);
    console.log('');
  }
  if (process.env.RAW === '1') {
    const run = docs.find((d) => d.status) || docs[0];
    const p = run.payload || {};
    console.log('--- payload keys ---');
    console.log(Object.keys(p).join(', '));
    console.log('--- payload.results ---');
    console.log(JSON.stringify(p.results).slice(0, 1500));
    console.log('--- payload.summary ---');
    console.log(JSON.stringify(p.summary).slice(0, 800));
    console.log('--- payload.fidelity ---');
    console.log(JSON.stringify(p.fidelity).slice(0, 800));
  }
})().catch((e) => {
  console.error('ERR', e && e.message);
  process.exit(1);
});
