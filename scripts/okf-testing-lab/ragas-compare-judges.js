// ragas-compare-judges.js — READ-ONLY: compare a FINISHED sidecar re-score job
// against the stored scores of the run it re-scored.
//
// Why this exists rather than reusing ragas-rescore-judge.js's tail: that
// script index-aligns `per_query` against the UNFILTERED rows array while the
// samples it submitted were FILTERED (`!r.error && r.answer`). If any row was
// dropped, every comparison after that point compares the wrong rows. This
// script rebuilds the same filtered sample list, checks the lengths match, and
// re-aligns by user_input when the sidecar exposes it.
//
// Usage (inside the okf-server container):
//   node /tmp/ragas-compare-judges.js <run_key> <job_id> [metric,metric,...]
const http = require('http');

const runKey = process.argv[2];
const jobId = process.argv[3];
const metrics = (process.argv[4] || 'context_entities_recall,factual_correctness,answer_relevancy').split(',');
if (!runKey || !jobId) {
  console.error('usage: node ragas-compare-judges.js <run_key> <job_id> [metrics]');
  process.exit(2);
}
const SIDECAR = process.env.OKF_RAGAS_URL || 'http://ragas-service:8090';

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

(async () => {
  const dbService = require('/app/shared-lib/db-connection-service');
  const db = await dbService.getConnection();
  const col = db.collection('okf_head_test_runs');

  const run = await col.document(runKey);
  const rows = (run.payload && run.payload.results) || [];
  const dropped = rows.filter((r) => r.error || !r.answer);
  const kept = rows.filter((r) => !r.error && r.answer);

  // The failure attribution for this run — the stage per row. The comparison
  // is only meaningful on the SAME row subset: the question is whether the
  // rows staged "judge" are real gaps or one harsh judge.
  const exCursor = await db.query(
    'FOR d IN okf_head_test_runs FILTER d.kind == "ragas_explain" && d.payload.run_key == @rk ' +
      'SORT d.created_at DESC LIMIT 1 RETURN d',
    { rk: runKey }
  );
  const explain = (await exCursor.all())[0] || null;
  const attrs = (explain && explain.payload && explain.payload.attributions) || [];
  const stageById = new Map(attrs.map((a) => [a.id, a.stage]));
  const failsById = new Map(attrs.map((a) => [a.id, a.fails || []]));

  const job = (await reqJson('GET', `${SIDECAR}/jobs/${jobId}`)).body || {};
  console.log(`stored rows=${rows.length}  scorable(kept)=${kept.length}  dropped=${dropped.length}`);
  if (dropped.length) {
    console.log('  dropped rows:', dropped.map((r) => `${r.id}(${r.error ? 'error' : 'no answer'})`).join(', '));
  }
  console.log(`job ${jobId}: status=${job.status}`);
  if (job.status !== 'done') {
    console.log(`  (not finished — progress ${JSON.stringify(job.progress || {})})`);
    process.exit(1);
  }
  const pq = (job.result && job.result.per_query) || [];
  console.log(`sidecar per_query rows=${pq.length}`);
  if (pq.length !== kept.length) {
    console.error(
      `LENGTH MISMATCH: per_query=${pq.length} vs scorable kept=${kept.length} — the comparison would be misaligned.`
    );
    process.exit(1);
  }
  const hasInput = pq.length > 0 && typeof pq[0].user_input === 'string';
  console.log(`per_query exposes user_input: ${hasInput}`);

  // Align by user_input when available; fall back to index (RAGAS preserves
  // submission order) only after the length check above passed.
  let pairs;
  if (hasInput) {
    const byInput = new Map(pq.map((q) => [q.user_input, q]));
    pairs = kept.map((r) => [r, byInput.get(r.query)]).filter(([, q]) => q);
    console.log(`matched by user_input: ${pairs.length}/${kept.length}`);
  } else {
    pairs = kept.map((r, i) => [r, pq[i]]);
  }

  const meansOld = {};
  const meansNew = {};
  let moved = 0;
  const detail = [];
  pairs.forEach(([r, q]) => {
    for (const m of metrics) {
      const ov = r.metrics && r.metrics[m];
      const nv = q[m];
      if (typeof ov === 'number' && typeof nv === 'number') {
        (meansOld[m] = meansOld[m] || []).push(ov);
        (meansNew[m] = meansNew[m] || []).push(nv);
      }
    }
    const before = metrics.map((m) => (r.metrics && r.metrics[m] != null ? r.metrics[m] : null));
    const after = metrics.map((m) => (q[m] != null ? q[m] : null));
    if (before.some((v, k) => v != null && after[k] != null && Math.abs(after[k] - v) > 0.1)) moved += 1;
    detail.push({ id: r.id, before, after });
  });

  console.log('\n=== mean per metric: ORIGINAL judge vs NEW judge ===');
  for (const m of metrics) {
    const om = meansOld[m] ? meansOld[m].reduce((a, b) => a + b, 0) / meansOld[m].length : null;
    const nm = meansNew[m] ? meansNew[m].reduce((a, b) => a + b, 0) / meansNew[m].length : null;
    const d = om != null && nm != null ? nm - om : null;
    console.log(
      m.padEnd(26),
      om == null ? '-' : om.toFixed(4),
      nm == null ? '-' : nm.toFixed(4),
      d == null ? '-' : (d >= 0 ? '+' : '') + d.toFixed(4),
      om != null ? `(n=${meansOld[m].length})` : ''
    );
  }
  console.log(`\nrows whose score moved >0.1 on any metric: ${moved}/${pairs.length}`);

  // The question the re-score exists to answer: are the rows staged "judge"
  // real quality gaps, or one harsh judge? Only answerable per stage.
  if (attrs.length) {
    const byStage = new Map();
    for (const [r, q] of pairs) {
      const stage = stageById.get(r.id) || 'unattributed';
      if (!byStage.has(stage)) byStage.set(stage, []);
      byStage.get(stage).push([r, q]);
    }
    const meanOf = (list, m, side) => {
      const v = list
        .map(([r, q]) => (side === 'old' ? (r.metrics || {})[m] : q[m]))
        .filter((x) => typeof x === 'number' && !Number.isNaN(x));
      return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
    };
    console.log('\n=== per stage: ORIGINAL judge -> NEW judge ===');
    const head = ['stage', 'rows'];
    metrics.forEach((m) => head.push(`${m.slice(0, 12)} old`, `${m.slice(0, 12)} new`, 'delta'));
    console.log(head.map((h) => h.padEnd(24)).join(''));
    const order = ['judge', 'llm', 'reranker', 'vector-recall', 'retrieved', 'unattributed'];
    const stages = [...order.filter((s) => byStage.has(s)), ...[...byStage.keys()].filter((s) => !order.includes(s))];
    for (const stage of stages) {
      const list = byStage.get(stage);
      const cells = [stage.padEnd(24), String(list.length).padEnd(24)];
      for (const m of metrics) {
        const om = meanOf(list, m, 'old');
        const nm = meanOf(list, m, 'new');
        const d = om != null && nm != null ? nm - om : null;
        cells.push((om == null ? '-' : om.toFixed(4)).padEnd(24));
        cells.push((nm == null ? '-' : nm.toFixed(4)).padEnd(24));
        cells.push((d == null ? '-' : (d >= 0 ? '+' : '') + d.toFixed(4)).padEnd(24));
      }
      console.log(cells.join(''));
    }
    console.log('\nfailing metric counts by stage (the ORIGINAL attribution):');
    for (const stage of stages) {
      const counts = {};
      byStage
        .get(stage)
        .forEach(([r]) => (failsById.get(r.id) || []).forEach((f) => (counts[f] = (counts[f] || 0) + 1)));
      const top = Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `${k}=${v}`)
        .join(' ');
      console.log(`  ${stage.padEnd(16)} ${top}`);
    }
  }

  const fmt = (v) => (v == null ? 'null' : v.toFixed(2));
  const biggest = detail
    .map((d) => {
      const deltas = d.after.map((v, k) => (v != null && d.before[k] != null ? v - d.before[k] : null));
      const max = Math.max(...deltas.filter((x) => x != null).map(Math.abs), 0);
      return { id: d.id, deltas, max };
    })
    .filter((d) => d.max > 0.15)
    .sort((a, b) => b.max - a.max)
    .slice(0, 15);
  console.log('\n=== biggest movers ===');
  biggest.forEach((d) =>
    console.log(
      `${d.id}: ${metrics.map((m, k) => `${m.slice(0, 6)} ${fmt(d.before[k])}→${fmt(d.after[k])}`).join('  ')}`
    )
  );
  process.exit(0);
})().catch((e) => {
  console.error('ERR', e && e.message);
  process.exit(1);
});
