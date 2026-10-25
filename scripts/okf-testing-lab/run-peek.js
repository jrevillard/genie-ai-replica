// run-peek.js — read-only: newest runs on a suite from Arango (status,
// phase, metrics) — the quietest possible live check while a benchmark runs.
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
const SUITE = process.argv[2] || 'rs1792645296070-246482';

const body = JSON.stringify({
  query:
    'FOR d IN okf_head_test_runs FILTER d.kind=="ragas_run" AND d.suite_key==@sk SORT d.created_at DESC LIMIT 3 ' +
    'RETURN {key:d._key,status:d.status,created:d.created_at,phase:d.progress?d.progress.phase:null,' +
    'done:d.progress?d.progress.done:null,total:d.progress?d.progress.total:null,metrics:d.metrics,' +
    'errors:d.payload&&d.payload.summary?d.payload.summary.n_errors:null}',
  bindVars: { sk: SUITE }
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
      try {
        (JSON.parse(d).result || []).forEach((r) => console.log(JSON.stringify(r)));
      } catch {
        console.log('parse-error:', d.slice(0, 200));
      }
    });
  }
);
req.on('error', (e) => console.error('FATAL', e.message));
req.end(body);
