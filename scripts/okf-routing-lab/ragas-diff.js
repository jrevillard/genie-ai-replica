// ragas-diff.js — read-only: compare two RAGAS runs row-by-row.
// Usage: node scripts/okf-routing-lab/ragas-diff.js <baselineRunKey> <candidateRunKey>
// Prints: per-metric means (both runs, delta), the set of rows whose ANSWER
// changed, per-row metric deltas on the answer-side metrics, and the status
// of the known proof rows (new-26 / new-98 / new-9 / new-3).
const http = require('http');
const fs = require('fs');

const env = {};
for (const line of fs.readFileSync('C:/Dev/builds/main/.env', 'utf8').split(/\r?\n/)) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m) env[m[1]] = m[2].replace(/^"|"$/g, '');
}
const auth = Buffer.from(`${env.ARANGO_USER || 'root'}:${env.ARANGO_PASSWORD || ''}`).toString('base64');

function q(aql, bind) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        host: 'localhost',
        port: env.ARANGO_PORT || '8529',
        path: `/_db/${env.ARANGO_DB || 'genie-ai'}/_api/cursor`,
        method: 'POST',
        headers: { Authorization: 'Basic ' + auth, 'Content-Type': 'application/json' }
      },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => resolve(JSON.parse(d)));
      }
    );
    req.on('error', reject);
    req.end(JSON.stringify({ query: aql, bindVars: bind || {} }));
  });
}

const METRICS = [
  'faithfulness',
  'context_precision',
  'context_recall',
  'answer_relevancy',
  'context_utilization',
  'context_entities_recall',
  'factual_correctness',
  'answer_correctness',
  'answer_similarity',
  'noise_sensitivity'
];
const ANSWER_SIDE = ['faithfulness', 'factual_correctness', 'answer_correctness', 'answer_relevancy'];
const PROOF = ['new-3', 'new-9', 'new-26', 'new-98'];

const mean = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);

(async () => {
  const [aKey, bKey] = process.argv.slice(2);
  if (!aKey || !bKey) {
    console.error('usage: node ragas-diff.js <baselineRunKey> <candidateRunKey>');
    process.exit(1);
  }
  const docs = await q(
    'FOR d IN okf_head_test_runs FILTER d._key == @a OR d._key == @b RETURN {key:d._key, status:d.status, fidelity:d.payload.fidelity, results:d.payload.results}',
    { a: aKey, b: bKey }
  );
  const byKey = {};
  (docs.result || []).forEach((d) => (byKey[d.key] = d));
  const A = byKey[aKey];
  const B = byKey[bKey];
  if (!A || !B) {
    console.log('runs available:', Object.keys(byKey).join(', ') || 'none');
    console.log('(a run persists its scores only at completion — an unfinished run has no rows)');
    process.exit(0);
  }
  const aRows = new Map((A.results || []).map((r) => [r.id, r]));
  const bRows = new Map((B.results || []).map((r) => [r.id, r]));

  console.log(`BASELINE  ${aKey}  status=${A.status}`);
  console.log(`CANDIDATE ${bKey}  status=${B.status}`);
  console.log(`judge  baseline: ${JSON.stringify(A.fidelity && A.fidelity.judge)}`);
  console.log(`judge  candidate: ${JSON.stringify(B.fidelity && B.fidelity.judge)}`);
  console.log(`rows   baseline=${aRows.size} candidate=${bRows.size}`);

  console.log('\n=== per-metric means ===');
  console.log('metric'.padEnd(26), 'baseline'.padStart(9), 'candidate'.padStart(10), 'delta'.padStart(9), 'n_cand');
  for (const m of METRICS) {
    const av = mean([...aRows.values()].map((r) => r.metrics && r.metrics[m]).filter((v) => v != null && !Number.isNaN(v)));
    const bv = mean([...bRows.values()].map((r) => r.metrics && r.metrics[m]).filter((v) => v != null && !Number.isNaN(v)));
    const d = av != null && bv != null ? bv - av : null;
    const nb = [...bRows.values()].filter((r) => r.metrics && r.metrics[m] != null && !Number.isNaN(r.metrics[m])).length;
    console.log(
      m.padEnd(26),
      (av == null ? '-' : av.toFixed(4)).padStart(9),
      (bv == null ? '-' : bv.toFixed(4)).padStart(10),
      (d == null ? '-' : (d >= 0 ? '+' : '') + d.toFixed(4)).padStart(9),
      String(nb).padStart(6)
    );
  }

  const changed = [];
  for (const [id, bRow] of bRows) {
    const aRow = aRows.get(id);
    if (!aRow) continue;
    const ansA = String(aRow.answer || '').trim();
    const ansB = String(bRow.answer || '').trim();
    const abstA = !!aRow.abstained;
    const abstB = !!bRow.abstained;
    if (ansA !== ansB || abstA !== abstB) changed.push({ id, aRow, bRow, abstA, abstB });
  }
  console.log(`\n=== answers changed: ${changed.length}/${bRows.size} rows ===`);
  const gained = changed.filter((c) => {
    const av = mean(ANSWER_SIDE.map((m) => c.aRow.metrics && c.aRow.metrics[m]).filter((v) => v != null));
    const bv = mean(ANSWER_SIDE.map((m) => c.bRow.metrics && c.bRow.metrics[m]).filter((v) => v != null));
    return av != null && bv != null && bv > av + 0.02;
  });
  const lost = changed.filter((c) => {
    const av = mean(ANSWER_SIDE.map((m) => c.aRow.metrics && c.aRow.metrics[m]).filter((v) => v != null));
    const bv = mean(ANSWER_SIDE.map((m) => c.bRow.metrics && c.bRow.metrics[m]).filter((v) => v != null));
    return av != null && bv != null && bv < av - 0.02;
  });
  console.log(`answer-side improved: ${gained.length}   regressed: ${lost.length}`);

  console.log('\n=== per-row answer-side deltas (changed rows, sorted) ===');
  const rowsOut = changed
    .map((c) => {
      const av = mean(ANSWER_SIDE.map((m) => c.aRow.metrics && c.aRow.metrics[m]).filter((v) => v != null));
      const bv = mean(ANSWER_SIDE.map((m) => c.bRow.metrics && c.bRow.metrics[m]).filter((v) => v != null));
      return { id: c.id, delta: av != null && bv != null ? bv - av : null, c };
    })
    .sort((x, y) => (y.delta == null ? -99 : y.delta) - (x.delta == null ? -99 : x.delta));
  rowsOut.forEach(({ id, delta, c }) => {
    const tag = delta == null ? 'n/a' : (delta >= 0 ? '+' : '') + delta.toFixed(3);
    const mA = ANSWER_SIDE.map((m) => `${m.slice(0, 4)}=${c.aRow.metrics && c.aRow.metrics[m] != null ? c.aRow.metrics[m].toFixed(2) : 'null'}`).join(' ');
    const mB = ANSWER_SIDE.map((m) => `${m.slice(0, 4)}=${c.bRow.metrics && c.bRow.metrics[m] != null ? c.bRow.metrics[m].toFixed(2) : 'null'}`).join(' ');
    console.log(`${id} ${tag.padStart(7)}  abst ${c.abstA ? 'Y' : 'n'}→${c.abstB ? 'Y' : 'n'}  base[${mA}]  cand[${mB}]`);
  });

  console.log('\n=== proof rows ===');
  PROOF.forEach((id) => {
    const a = aRows.get(id);
    const b = bRows.get(id);
    if (!a || !b) {
      console.log(`${id}: missing (${!a ? 'no baseline' : 'no candidate'})`);
      return;
    }
    const mA = ANSWER_SIDE.map((m) => `${m.slice(0, 4)}=${a.metrics && a.metrics[m] != null ? a.metrics[m].toFixed(2) : 'null'}`).join(' ');
    const mB = ANSWER_SIDE.map((m) => `${m.slice(0, 4)}=${b.metrics && b.metrics[m] != null ? b.metrics[m].toFixed(2) : 'null'}`).join(' ');
    console.log(`\n${id}  abst ${a.abstained ? 'Y' : 'n'}→${b.abstained ? 'Y' : 'n'}`);
    console.log(`   base[${mA}]  cand[${mB}]`);
    console.log(`   Q: ${String(b.query || '').slice(0, 110)}`);
    console.log(`   base A: ${String(a.answer || '').replace(/\s+/g, ' ').slice(0, 200)}`);
    console.log(`   cand A: ${String(b.answer || '').replace(/\s+/g, ' ').slice(0, 200)}`);
  });
})().catch((e) => {
  console.error('ERR', e.message);
  process.exit(1);
});
