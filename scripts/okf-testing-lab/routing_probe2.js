// Demo: query-time routing outcome for "Bali" questions, using deterministic
// synthetic embeddings that roughly match the live vector dimension (1024).
// We can't run live TEI right now, so we approximate: a bali-shaped query
// yields high cosine on bali's index chunk (which has the literal "Bali" word)
// and low cosine on the generic wikipedia chunks (which don't).

const https = require('http');
const fs = require('fs');
const env = fs.readFileSync('.env', 'utf8');
const pw = (env.match(/^ARANGO_PASSWORD=(.*)$/m) || [])[1].replace(/[\r\n]+/g, '').replace(/^"|"$/g, '');
const auth = 'Basic ' + Buffer.from('root:' + pw).toString('base64');

function arango(q) {
  return new Promise((res, rej) => {
    const d = JSON.stringify(q);
    const r = https.request({method:'POST',host:'localhost',port:8529,path:'/_db/genie-ai/_api/cursor',
      headers:{'Content-Type':'application/json','Authorization':auth,'Content-Length':d.length}},
      resp => { let s=''; resp.on('data',c=>s+=c); resp.on('end',()=>res(JSON.parse(s))); });
    r.on('error',rej); r.write(d); r.end();
  });
}

(async () => {
  // 1. Dump what the bali repo's index chunk text actually contains
  //    (the smoking gun: does the bali repo have any content about Bali-as-place?)
  const baliChunks = await arango({
    query: `FOR c IN \`OKF_bali-wikipedia-llm_v17_SOURCE\`
            RETURN {concept: c.file_id, len: LENGTH(c.text), preview: LEFT(c.text, 280)}`
  });
  const baliConcepts = {};
  for (const c of baliChunks.result || []) {
    if (!baliConcepts[c.concept]) baliConcepts[c.concept] = { count: 0, maxLen: 0, sample: '' };
    baliConcepts[c.concept].count++;
    if (c.len > baliConcepts[c.concept].maxLen) { baliConcepts[c.concept].maxLen = c.len; baliConcepts[c.concept].sample = c.preview; }
  }
  console.log('baliChunks keys:', Object.keys(baliChunks), 'err?', baliChunks.errorMessage, 'first row?', (baliChunks.result||[])[0]);
  for (const [concept, info] of Object.entries(baliConcepts)) {
    console.log('  ' + concept + '  count=' + info.count + '  maxLen=' + info.maxLen);
    console.log('     ' + info.sample.replace(/\n/g, ' ').slice(0, 200));
  }
  // 2. Search the bali index chunk for the word "Bali" outside of disambiguation context
  const baliMentions = await arango({
    query: `FOR c IN \`OKF_bali-wikipedia-llm_v17_SOURCE\`
            LET t = LOWER(c.text)
            LET bali_count = LENGTH(t) - LENGTH(REGEX_REPLACE(t, 'bali', '', 1))
            SORT bali_count DESC
            LIMIT 5
            RETURN {concept: c.file_id, bali_count, preview: LEFT(c.text, 200)}`
  });
  console.log('\n=== bali chunks ranked by frequency of the word "bali"');
  for (const r of baliMentions.result || []) {
    console.log('  ' + r.concept + '  bali_count=' + r.bali_count);
    console.log('     ' + r.preview.replace(/\n/g, ' ').slice(0, 250));
  }
})();
