// ragas-compare-runs.js — READ-ONLY: compare two stored RAGAS runs.
//
// Usage (inside the okf-server container):
//   node /tmp/ragas-compare-runs.js <baselineRunKey> <candidateRunKey> [metric]
//
// Prints:
//   - per-metric means for BOTH runs and the delta;
//   - the rows whose reference answer changed between the runs (the
//     regenerated ones), with that metric before and after;
//   - how many rows improved, how many regressed, how many were untouched.
//
// WHY A NEW TOOL: the existing lab scripts read ArangoDB over the raw HTTP
// cursor API. Every database access in this project goes through the
// shared `db-connection-service` — this tool does.
//
// THE METRIC KEY: RAGAS 0.4.3 names a parameterized metric's result column
// with its parameters (`factual_correctness(mode=f1)`) while the metric's own
// name stays the bare key, so a metric is matched by PREFIX — the same rule
// the product's own extraction applies. A metric that is absent from a row
// is skipped, not counted as zero, and the coverage (rows scored) is
// reported beside every mean: a mean over 21 of 100 rows is not a
// whole-run number.

'use strict';

const dbService = require('/app/shared-lib/db-connection-service');

/** The value of `metric` in a row's metrics, by prefix. */
function metricValue(metrics, metric) {
  if (!metrics || typeof metrics !== 'object') return null;
  if (typeof metrics[metric] === 'number') return metrics[metric];
  for (const key of Object.keys(metrics)) {
    if (key === metric || key.startsWith(`${metric}(`)) {
      const v = metrics[key];
      if (typeof v === 'number') return v;
    }
  }
  return null;
}

function mean(values) {
  if (!values.length) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

function fmt(v) {
  return typeof v === 'number' ? v.toFixed(3) : String(v);
}

if (require.main === module) {
  const baselineKey = process.argv[2];
  const candidateKey = process.argv[3];
  const focusMetric = process.argv[4] || 'context_entities_recall';
  if (!baselineKey || !candidateKey) {
    console.error('usage: node ragas-compare-runs.js <baselineRunKey> <candidateRunKey> [metric]');
    process.exit(2);
  }

  (async () => {
    const db = await dbService.getConnection();
    const c = db.collection('okf_head_test_runs');
    const baseline = await c.document(baselineKey);
    const candidate = await c.document(candidateKey);
    if (!baseline) throw new Error(`baseline run ${baselineKey} not found`);
    if (!candidate) throw new Error(`candidate run ${candidateKey} not found`);

    const baseRows = baseline.payload.results || [];
    const candRows = candidate.payload.results || [];
    const baseById = new Map(baseRows.map((r) => [r.id, r]));
    const candById = new Map(candRows.map((r) => [r.id, r]));

    const baseJudge = (baseline.payload.fidelity && baseline.payload.fidelity.judge) || null;
    const candJudge = (candidate.payload.fidelity && candidate.payload.fidelity.judge) || null;
    console.log(`baseline  ${baselineKey}  status=${baseline.status}`);
    console.log(`          judge=${JSON.stringify(baseJudge)}`);
    console.log(`candidate ${candidateKey}  status=${candidate.status}`);
    console.log(`          judge=${JSON.stringify(candJudge)}\n`);

    // 1. per-metric means
    const metricNames = new Set();
    for (const r of baseRows) Object.keys(r.metrics || {}).forEach((k) => metricNames.add(k));
    for (const r of candRows) Object.keys(r.metrics || {}).forEach((k) => metricNames.add(k));

    console.log('=== per-metric means (mean over the rows the judge SCORED) ===');
    console.log('metric                                baseline   candidate     delta   scored');
    for (const name of [...metricNames].sort()) {
      const baseVals = baseRows.map((r) => metricValue(r.metrics, name)).filter((v) => v !== null);
      const candVals = candRows.map((r) => metricValue(r.metrics, name)).filter((v) => v !== null);
      const bm = mean(baseVals);
      const cm = mean(candVals);
      const delta = bm !== null && cm !== null ? cm - bm : null;
      console.log(
        `${name.padEnd(38)} ${fmt(bm).padStart(9)} ${fmt(cm).padStart(10)} ` +
          `${delta === null ? '     -' : (delta >= 0 ? '+' : '') + delta.toFixed(3).padStart(6)} ` +
          `${String(baseVals.length) + '/' + String(candVals.length)}`
      );
    }

    // 2. the rows whose reference changed (the regenerated ones)
    const baseEntries = new Map((baseline.payload.entries || []).map((e) => [e.id, e]));
    const candEntries = new Map((candidate.payload.entries || []).map((e) => [e.id, e]));
    const regenerated = [];
    for (const [id, candEntry] of candEntries) {
      const baseEntry = baseEntries.get(id);
      if (!baseEntry) continue;
      if (baseEntry.reference_answer !== candEntry.reference_answer) regenerated.push(id);
    }

    console.log(`\n=== the ${regenerated.length} regenerated rows — ${focusMetric} ===`);
    console.log('row            baseline  candidate     delta');
    let improved = 0;
    let regressed = 0;
    let unchanged = 0;
    for (const id of regenerated) {
      const b = metricValue((baseById.get(id) || {}).metrics, focusMetric);
      const k = metricValue((candById.get(id) || {}).metrics, focusMetric);
      const delta = b !== null && k !== null ? k - b : null;
      if (delta !== null) {
        if (delta > 0) improved += 1;
        else if (delta < 0) regressed += 1;
        else unchanged += 1;
      }
      console.log(
        `${id.padEnd(14)} ${fmt(b).padStart(8)} ${fmt(k).padStart(10)} ` +
          `${delta === null ? '     -' : (delta >= 0 ? '+' : '') + delta.toFixed(3).padStart(6)}`
      );
    }
    console.log(`\nimproved ${improved}  unchanged ${unchanged}  regressed ${regressed}`);

    // 3. the rows that did NOT change — the control group. If the mean moved
    // for them too, the movement is the RUN, not the regeneration.
    const controlBase = [];
    const controlCand = [];
    for (const [id, row] of candById) {
      if (regenerated.includes(id)) continue;
      const b = metricValue((baseById.get(id) || {}).metrics, focusMetric);
      const k = metricValue(row.metrics, focusMetric);
      if (b !== null && k !== null) {
        controlBase.push(b);
        controlCand.push(k);
      }
    }
    console.log(`\n=== control group: the ${controlBase.length} rows that did NOT change ===`);
    console.log(`baseline mean ${fmt(mean(controlBase))}  candidate mean ${fmt(mean(controlCand))}`);
    console.log(
      '(if this moved too, the movement is the RUN — a different judge, a different\n' +
        ' day — and not the regeneration)'
    );

    process.exit(0);
  })().catch((e) => {
    console.error(e.stack || e.message);
    process.exit(1);
  });
}

module.exports = { metricValue, mean };
