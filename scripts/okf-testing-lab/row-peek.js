// row-peek.js — read-only: first N rows of a run (contexts count, abstained,
// answer head, confidence) from Arango.
const http = require('http');
const fs = require('fs');

const env = {};
for (const line of fs.readFileSync('C:/Dev/builds/main/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const auth = Buffer.from(`${env.ARANGO_USER || 'root'}:${env.ARANGO_PASSWORD || ''}`).toString('base64');
const RUN_KEY = process.argv[2];
const N = parseInt(process.argv[3] || '3', 10);

const body = JSON.stringify({
  query:
    'FOR d IN okf_head_test_runs FILTER d._key == @rk LIMIT 1 ' +
    'FOR r IN SLICE(d.payload.results, 0, @n) ' +
    'RETURN {id:r.id, query:SUBSTRING(r.query,0,80), contexts:LENGTH(r.contexts), ctx_head:LENGTH(r.contexts)>0?SUBSTRING(r.contexts[0],0,80):null, abstained:r.abstained, answer:SUBSTRING(r.answer,0,160), confidence:r.confidence, abstention_reason:r.abstention_reason}',
  bindVars: { rk: RUN_KEY, n: N }
});

const req = http.request(
  {
    host: 'localhost',
    port: env.ARANGO_PORT || '8529',
    path: `/_db/${env.ARANGO_DB || 'genie-ai'}/_api/cursor`,
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/json' }
  },
  (res) => {
    let d = '';
    res.on('data', (c) => (d += c));
    res.on('end', () => {
      try {
        JSON.parse(d).result.forEach((r) => console.log(JSON.stringify(r, null, 1)));
      } catch {
        console.log('error:', d.slice(0, 300));
      }
    });
  }
);
req.on('error', (e) => console.error('FATAL', e.message));
req.end(body);
