// Legacy golden capture/replay — rebase parity check (rebase plan §4a).
// Run INSIDE main-okf-server-1: docker cp this file in, then
//   node /tmp/golden.cjs
// Captures (no writes, no LLM): GRAPH schema snapshot + embedding→retriever
// single-graph response for a fixed query. Deterministic: same vectors over
// the same data ⇒ identical scores, so pre/post-rebase must match exactly.
const http = require('http');
const url = process.env.ARANGO_URL || 'http://arangodb:8529';
const db = process.env.ARANGO_DB || 'genie-ai';
const auth = 'Basic ' + Buffer.from((process.env.ARANGO_USER || 'root') + ':' + process.env.ARANGO_PASSWORD).toString('base64');
const QUERY = 'digital government services payment';

async function q(aql, bind = {}) {
  const r = await fetch(url + '/_db/' + db + '/_api/cursor', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: aql, bindVars: bind, batchSize: 100 })
  });
  const j = await r.json();
  if (j.error) throw new Error('AQL: ' + JSON.stringify(j));
  return j.result;
}

(async () => {
  const out = { captured_at: new Date().toISOString(), query: QUERY };

  // 1. GRAPH schema snapshot
  out.counts = {};
  for (const c of ['GRAPH_SOURCE', 'GRAPH_ENTITY', 'GRAPH_LINKS_TO', 'GRAPH_HAS_SOURCE']) {
    try {
      out.counts[c] = (await q('FOR d IN @@c COLLECT WITH COUNT INTO n RETURN n', { '@c': c }))[0];
    } catch (e) {
      out.counts[c] = 'MISSING';
    }
  }
  out.chunk_key_sets = (await q('FOR d IN GRAPH_SOURCE LIMIT 5 RETURN ATTRIBUTES(d)')).map((a) =>
    Array.isArray(a) ? a.slice().sort() : a
  );
  out.sample_chunk_labels = await q(
    'FOR d IN GRAPH_SOURCE FILTER IS_ARRAY(d.chunk_labels) && LENGTH(d.chunk_labels)>0 LIMIT 1 RETURN d.chunk_labels'
  )[0] || null;
  out.null_embedding_chunks = (await q('FOR d IN GRAPH_SOURCE FILTER d.embedding == null COLLECT WITH COUNT INTO n RETURN n'))[0];

  // 2. Embedding for the fixed query (node:http — undici blocks port 6000 as a "bad port")
  const ej = await new Promise((resolve, reject) => {
    const req = http.request(
      { host: 'embedding', port: 6000, path: '/v1/embeddings', method: 'POST', headers: { 'Content-Type': 'application/json' } },
      (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => {
          try { resolve(JSON.parse(b)); } catch (e) { reject(new Error('embedding bad json: ' + b.slice(0, 200))); }
        });
      }
    );
    req.on('error', reject);
    req.end(JSON.stringify({ input: QUERY }));
  });
  const vec = (ej && (ej.embedding || (ej.data && ej.data[0] && ej.data[0].embedding))) || null;
  if (!vec) throw new Error('embedding failed: ' + JSON.stringify(ej).slice(0, 300));
  out.embedding_dims = vec.length;

  // 3. Legacy single-graph retrieval (the path that must not change)
  const rr = await fetch('http://retriever-arango-service:7000/v1/retrieval', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: QUERY, embedding: vec, graph_name: 'GRAPH', search_start: 'chunk' })
  });
  const rj = await rr.json();
  const docs = (rj && (rj.retrieved_docs || rj.docs)) || [];
  out.retrieval = {
    status: rr.status,
    raw_head: JSON.stringify(rj).slice(0, 300),
    n_results: docs.length,
    top10: docs.slice(0, 10).map((d, i) => ({
      rank: i,
      score: typeof d.score === 'number' ? Number(d.score.toFixed(6)) : d.score ?? null,
      text_head: String(d.text || '').slice(0, 80)
    }))
  };
  console.log(JSON.stringify(out, null, 2));
})().catch((e) => {
  console.error('CAPTURE FAILED:', e.message);
  process.exit(1);
});
