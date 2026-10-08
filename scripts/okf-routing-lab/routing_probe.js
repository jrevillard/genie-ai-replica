// Probe what the current retriever routing would select for several bali queries
const https = require('http');
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const pw = (env.match(/^ARANGO_PASSWORD=(.*)$/m) || [])[1].replace(/[\r\n]+/g, '').replace(/^"|"$/g, '');
const auth = 'Basic ' + Buffer.from('root:' + pw).toString('base64');
const KEY = (env.match(/^VLLM_API_KEY=(.*)$/m) || [])[1].replace(/[\r\n]+/g, '').replace(/^"|"$/g, '');

const GRAPHS = ['GRAPH','OKF_alphabet-company-information-llm_v6','OKF_kenya-government-services-v17','OKF_www-gov-uk-full-crawl_v3','OKF_bali-wikipedia-llm_v17','OKF_indonesia-history-llm_v1','OKF_ncd-information-v1','OKF_w5-cycle-1790524694865_v2','OKF_story-7-7-doc-import-smoke-1789404732138_v6'];

function arango(q) {
  return new Promise((res, rej) => {
    const d = JSON.stringify(q);
    const r = https.request({method:'POST',host:'localhost',port:8529,path:'/_db/genie-ai/_api/cursor',
      headers:{'Content-Type':'application/json','Authorization':auth,'Content-Length':d.length}},
      resp => { let s=''; resp.on('data',c=>s+=c); resp.on('end',()=>res(JSON.parse(s))); });
    r.on('error',rej); r.write(d); r.end();
  });
}

function embed(text) {
  return new Promise((res, rej) => {
    const data = JSON.stringify({inputs: text, truncate: true});
    const opt = {method:'POST',hostname:'ai.assembly.govstack.global',port:444,path:'/embed',
      headers:{'Content-Type':'application/json','Authorization':'Bearer '+KEY,'Content-Length':data.length},
      rejectUnauthorized: false};
    const r = https.request(opt, resp => { let s=''; resp.on('data',c=>s+=c); resp.on('end',()=>res(JSON.parse(s))); });
    r.on('error',rej); r.write(data); r.end();
  });
}

async function probe(coll, emb) {
  const j = await arango({
    query: `FOR doc IN \`${coll}_SOURCE\` LET s = APPROX_NEAR_COSINE(doc.embedding, @emb) SORT s DESC LIMIT 40 RETURN s`,
    bindVars: {emb}
  });
  return j.result || [];
}

(async () => {
  const queries = [
    ['Bali-as-place',  'What is the best time of year to visit Bali for a beach holiday?'],
    ['Bali-disambig',  'List the disambiguation entries for Bali'],
    ['Bali-history',   'Tell me about the history of the Bali kingdom in Indonesia'],
    ['Alphabet-corp',  'Tell me about the corporate structure of the Alphabet companies.'],
  ];
  for (const [tag, q] of queries) {
    console.log('\n== ' + tag + ' :: ' + q);
    const t0 = Date.now();
    const e = (await embed(q))[0] || (await embed(q));
    const rows = await Promise.all(GRAPHS.filter(g=>g!=='GRAPH').map(async g => {
      const r = await probe(g, e);
      return {g, n: r.length, top: r[0] || 0};
    }));
    const all = [];
    for (const {g, n, top} of rows) for (let i=0;i<n;i++){}
    // merged top-40
    const merged = [];
    for (const {g, n, top} of rows) {
      // we don't have per-rank scores here, only top score; show distribution
      merged.push({g, top});
    }
    merged.sort((a,b)=>b.top-a.top);
    for (const m of merged) {
      const ok = m.g.includes('bali') ? 'BALI' : m.g.includes('alphabet') ? 'alphabet' : m.g.replace('OKF_','').slice(0,12);
      console.log('  ' + m.top.toFixed(4) + '  ' + ok);
    }
    console.log('  embed + 8 probes took ' + (Date.now() - t0) + 'ms');
  }
})();
