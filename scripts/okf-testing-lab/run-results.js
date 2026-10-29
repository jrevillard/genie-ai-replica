// run-results.js — read-only: the full summary of one finished run (metrics
// means, failing rows, fidelity) straight from Arango.
const http = require('http');
const fs = require('fs');

const env = {};
for (const line of fs.readFileSync('C:/Dev/builds/main/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const PORT = env.ARANGO_PORT || '8529';
const DB = env.ARANGO_DB || 'genie-ai';
const auth = Buffer.from(`${env.ARANGO_USER || 'root'}:${env.ARANGO_PASSWORD || ''}`).toString('base64');
const RUN_KEY = process.argv[2];

const body = JSON.stringify({
  query:
    'FOR d IN okf_head_test_runs FILTER d._key == @rk RETURN {key:d._key,status:d.status,created:d.created_at,' +
    'metrics:d.metrics,summary:d.payload.summary,fidelity:d.payload.fidelity,' +
    'failing:(d.payload.summary.failing || []).length,' +
    'n:d.payload.summary.n,n_errors:d.payload.summary.n_errors,n_abstained:d.payload.summary.n_abstained}',
  bindVars: { rk: RUN_KEY }
});

const req = http.request(
  {
    host: 'localhost',
    port: PORT,
    path: `/_db/${DB}/_api/cursor`,
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }
  },
  (res) => {
    let d = '';
    res.on('data', (c) => (d += c));
    res.on('end', () => {
      const r = JSON.parse(d).result[0];
      if (!r) {
        console.log('run not found');
        return;
      }
      console.log(`run ${r.key}  status=${r.status}  created=${r.created}`);
      console.log(`metrics (${(r.metrics || []).length}): ${(r.metrics || []).join(', ')}`);
      const s = r.summary || {};
      console.log(`n=${r.n} errors=${r.n_errors} abstained=${r.n_abstained} failing=${r.failing}`);
      console.log('\n=== metric means ===');
      for (const [k, v] of Object.entries(s.metrics || {})) console.log(`  ${k}: ${v}`);
      console.log('\n=== fidelity ===');
      console.log(`  retrieval: ${JSON.stringify(r.fidelity && r.fidelity.retrieval)}`);
      console.log(`  judge: ${JSON.stringify(r.fidelity && r.fidelity.judge)}`);
    });
  }
);
req.on('error', (e) => console.error('FATAL', e.message));
req.end(body);
