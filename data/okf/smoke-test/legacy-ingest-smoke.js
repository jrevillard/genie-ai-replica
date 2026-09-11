// Legacy ingest smoke — write-path parity after the rebase (rebase plan §4a/§6 Phase 3).
// Upload a small .md via doc-repo → ingest → assert canonical chunks in GRAPH
// → retract → assert cascade → GRAPH back at golden counts.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const fs = require('fs');
const https = require('https');
const http = require('http');
const TOKEN = fs.readFileSync('C:/Users/DAVIDF~1/AppData/Local/Temp/okf-admin-token.txt', 'utf8').trim();
const H = { Authorization: 'Bearer ' + TOKEN };
const STAMP = 'rebase-legacy-smoke-' + Date.now();

function req(opts, body) {
  return new Promise((resolve, reject) => {
    const r = https.request(opts, (res) => {
      let b = '';
      res.on('data', (c) => (b += c));
      res.on('end', () => resolve({ status: res.statusCode, body: b }));
    });
    r.on('error', reject);
    if (body) r.write(body);
    r.end();
  });
}
async function aql(aqlText, bindVars = {}) {
  const env = fs.readFileSync('C:/Dev/builds/main/.env', 'utf8');
  const pwd = (env.match(/^ARANGO_PASSWORD=(.*)$/m) || [])[1] || 'test';
  const auth = 'Basic ' + Buffer.from('root:' + pwd.trim()).toString('base64');
  const payload = JSON.stringify({ query: aqlText, bindVars });
  const r = await new Promise((resolve, reject) => {
    const rq = http.request(
      { host: 'localhost', port: 8529, path: '/_db/genie-ai/_api/cursor', method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve({ status: res.statusCode, body: b }));
      }
    );
    rq.on('error', reject);
    rq.write(payload);
    rq.end();
  });
  const j = JSON.parse(r.body);
  if (j.error) throw new Error('AQL ' + JSON.stringify(j).slice(0, 200));
  return j.result;
}

(async () => {
  let pass = 0, fail = 0;
  const P = (m) => { pass++; console.log('PASS  ' + m); };
  const F = (m) => { fail++; console.error('FAIL  ' + m); };

  const before = (await aql('FOR d IN GRAPH_SOURCE COLLECT WITH COUNT INTO n RETURN n'))[0];

  // 1. Upload
  const content = `# Legacy rebase smoke (${STAMP})\n\nThis paragraph exists to prove the legacy file ingestion path is byte-identical after the OKF rebase onto main. It mentions digital government services and payment portals so labeling has something to work with.\n\n## Second section\n\nA second chunk of text for the chunker to split on, keeping deterministic shape.\n`;
  const boundary = '----okfsmoke' + Date.now();
  const mp =
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="legacy-smoke-${STAMP}.md"\r\nContent-Type: text/markdown\r\n\r\n${content}\r\n--${boundary}--\r\n`;
  const up = await req(
    { host: 'localhost', port: 443, path: '/api/files/upload', method: 'POST', headers: { ...H, 'Content-Type': 'multipart/form-data; boundary=' + boundary } },
    mp
  );
  const upBody = JSON.parse(up.body || '{}');
  const fileId = upBody.data && (upBody.data.file_id || upBody.data.id) || upBody.file_id || upBody.id;
  if (up.status === 200 || up.status === 201) P('upload → HTTP ' + up.status + ' file_id=' + fileId);
  else F('upload → HTTP ' + up.status + ' ' + up.body.slice(0, 200));
  if (!fileId) { console.log(`RESULT: ${pass}/${pass + fail}`); process.exit(1); }

  // 2. Kick ingest
  const kick = await req({ host: 'localhost', port: 443, path: `/api/files/${fileId}/ingest`, method: 'POST', headers: { ...H, 'Content-Type': 'application/json' } }, '{}');
  if (kick.status === 200 || kick.status === 202) P('ingest kick → HTTP ' + kick.status);
  else F('ingest kick → HTTP ' + kick.status + ' ' + kick.body.slice(0, 200));

  // 3. Poll to Ingested (LLM labeling + contextual: allow 4 min)
  let status = 'Pending', waited = 0;
  while (status !== 'Ingested' && status !== 'Ingestion Error' && status !== 'Retracted' && waited < 240000) {
    await new Promise((r) => setTimeout(r, 10000));
    waited += 10000;
    const st = await aql('FOR d IN files FILTER d.file_id==@f RETURN d.dataprep.status', { f: fileId });
    status = st[0] || '(no doc)';
    console.log('  status: ' + status + ' (' + waited / 1000 + 's)');
  }
  if (status === 'Ingested') P('ingest reached Ingested in ' + waited / 1000 + 's (contextual ON, LLM live)');
  else F('ingest ended at ' + status);

  // 4. Chunk parity in GRAPH
  const chunks = await aql('FOR d IN GRAPH_SOURCE FILTER d.file_id==@f RETURN ATTRIBUTES(d)', { f: fileId });
  if (chunks.length > 0) P('chunks indexed in GRAPH: ' + chunks.length);
  else F('zero chunks in GRAPH for ' + fileId);
  const expected = ['_id', '_key', '_rev', 'chunk_index', 'chunk_labels', 'chunk_text', 'embedding', 'file_id', 'file_path', 'text', 'type'];
  const schemaOk = chunks.every((k) => JSON.stringify(k.slice().sort()) === JSON.stringify(expected));
  if (schemaOk) P('chunk schema canonical (11 keys, matches golden)');
  else F('chunk schema drift: ' + JSON.stringify(chunks[0]));
  const noRepoId = await aql('FOR d IN GRAPH_SOURCE FILTER d.file_id==@f AND d.repo_id != null COLLECT WITH COUNT INTO n RETURN n', { f: fileId });
  if ((noRepoId[0] || 0) === 0) P('legacy file carries NO repo_id on chunks (born-right gating holds)');
  else F('legacy chunks carry repo_id — OKF leakage into legacy path!');

  // 5. Retract cascade
  const ret = await req({ host: 'localhost', port: 443, path: `/api/files/${fileId}/retract`, method: 'POST', headers: { ...H, 'Content-Type': 'application/json' } }, '{}');
  if (ret.status === 200) P('retract → HTTP 200');
  else F('retract → HTTP ' + ret.status + ' ' + ret.body.slice(0, 120));
  let remaining = -1;
  waited = 0;
  do {
    await new Promise((r) => setTimeout(r, 8000));
    waited += 8000;
    remaining = (await aql('FOR d IN GRAPH_SOURCE FILTER d.file_id==@f COLLECT WITH COUNT INTO n RETURN n', { f: fileId }))[0];
  } while (remaining > 0 && waited < 120000);
  if (remaining === 0) P('retract cascade: chunks removed (' + waited / 1000 + 's)');
  else F('retract cascade left ' + remaining + ' chunks');

  const after = (await aql('FOR d IN GRAPH_SOURCE COLLECT WITH COUNT INTO n RETURN n'))[0];
  if (after === before) P(`GRAPH back at baseline (${before} chunks)`);
  else F(`GRAPH count ${before} → ${after} (residue)`);

  console.log(`RESULT: ${pass}/${pass + fail}`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('SMOKE ERROR:', e.message); process.exit(1); });
