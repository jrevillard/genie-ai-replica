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
//
// THE COMPARISON IS A PURE FUNCTION of the two run documents (`compareRuns`),
// so the rules that make it honest — the in-scope population, the coverage
// beside every mean, the absent-metric-is-not-a-zero rule, the regenerated
// rows, the control group — are pinned by a unit test instead of by a human
// reading console output.

'use strict';

const dbService = require('/app/shared-lib/db-connection-service');

/**
 * The value of `metric` in a row's metrics.
 *
 * The PRODUCT looks the metric up EXACTLY (`r.metrics[m]`), and the
 * sidecar stores the bare key — so the prefix branch below is a fallback
 * for a document that still carries a parameterized spelling, not the
 * product's own rule. The comment this replaces claimed the prefix WAS
 * the product's rule, which is not what the code does.
 */
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

/** The out-of-scope entry ids of a run document. */
function oosIds(doc) {
  const entries = (doc && doc.payload && doc.payload.entries) || [];
  return new Set(entries.filter((e) => e.oos).map((e) => e.id));
}

/**
 * Compare two run documents. PURE — no I/O, no clock, no randomness.
 *
 * Returns:
 *   {
 *     oos:            {baseline, candidate}          — controls excluded
 *     metrics:        [{name, baselineMean, candidateMean, delta,
 *                       baselineScored, candidateScored}]
 *     regenerated:    [{id, baseline, candidate, delta}]
 *     tally:          {improved, unchanged, regressed}
 *     control:        {count, baselineMean, candidateMean}
 *   }
 */
function compareRuns(baseline, candidate, focusMetric = 'context_entities_recall') {
  const baseRows = (baseline.payload && baseline.payload.results) || [];
  const candRows = (candidate.payload && candidate.payload.results) || [];
  const baseById = new Map(baseRows.map((r) => [r.id, r]));
  const candById = new Map(candRows.map((r) => [r.id, r]));

  // The IN-SCOPE rows only — the same population the panel's means use
  // (2026-10-25). An out-of-scope row is a control: it is deliberately
  // unanswerable, so its score is not a result and must not sit inside a
  // mean. Before this the tool averaged every row and reported a number
  // the panel did not show.
  const baseOos = oosIds(baseline);
  const candOos = oosIds(candidate);
  const baseInScope = baseRows.filter((r) => !baseOos.has(r.id));
  const candInScope = candRows.filter((r) => !candOos.has(r.id));

  // 1. per-metric means — a row that did not score the metric is SKIPPED,
  //    not counted as zero, and the count of scored rows rides along.
  const metricNames = new Set();
  for (const r of baseInScope) Object.keys(r.metrics || {}).forEach((k) => metricNames.add(k));
  for (const r of candInScope) Object.keys(r.metrics || {}).forEach((k) => metricNames.add(k));

  const metrics = [...metricNames].sort().map((name) => {
    const baseVals = baseInScope.map((r) => metricValue(r.metrics, name)).filter((v) => v !== null);
    const candVals = candInScope.map((r) => metricValue(r.metrics, name)).filter((v) => v !== null);
    const bm = mean(baseVals);
    const cm = mean(candVals);
    return {
      name,
      baselineMean: bm,
      candidateMean: cm,
      delta: bm !== null && cm !== null ? cm - bm : null,
      baselineScored: baseVals.length,
      candidateScored: candVals.length
    };
  });

  // 2. the rows whose CONTENT changed between the runs — the regenerated
  //    ones. TWO dimensions, and they mean different things:
  //      answer   — the served answer differs (a FRESH run regenerates the
  //                 answers; the references are the suite's, untouched);
  //      reference— the suite's reference answer differs (a REGENERATED
  //                 entry; the answers were re-judged, not re-served).
  //    A re-score changes neither; a fresh run changes the answer; an
  //    entry regeneration changes the reference. Detecting only the
  //    reference made a fresh run report "0 regenerated rows" and put
  //    answer-churned rows into the control group — the control group then
  //    measured the answers changing, and said nothing about the judge.
  const baseEntries = new Map(((baseline.payload && baseline.payload.entries) || []).map((e) => [e.id, e]));
  const candEntries = new Map(((candidate.payload && candidate.payload.entries) || []).map((e) => [e.id, e]));
  const changedIds = new Set();
  let answerChangedCount = 0;
  let referenceChangedCount = 0;
  for (const [id, row] of candById) {
    const baseRow = baseById.get(id);
    const baseEntry = baseEntries.get(id);
    const candEntry = candEntries.get(id);
    const answerChanged = baseRow ? baseRow.answer !== row.answer : false;
    const referenceChanged = baseEntry && candEntry ? baseEntry.reference_answer !== candEntry.reference_answer : false;
    if (answerChanged) answerChangedCount += 1;
    if (referenceChanged) referenceChangedCount += 1;
    if (answerChanged || referenceChanged) changedIds.add(id);
  }

  const regeneratedRows = [...changedIds].sort().map((id) => {
    const baseRow = baseById.get(id) || {};
    const candRow = candById.get(id) || {};
    const b = metricValue(baseRow.metrics, focusMetric);
    const k = metricValue(candRow.metrics, focusMetric);
    return {
      id,
      answerChanged: baseRow.answer !== candRow.answer,
      referenceChanged: !!(
        baseEntries.get(id) &&
        candEntries.get(id) &&
        baseEntries.get(id).reference_answer !== candEntries.get(id).reference_answer
      ),
      baseline: b,
      candidate: k,
      delta: b !== null && k !== null ? k - b : null
    };
  });

  const tally = { improved: 0, unchanged: 0, regressed: 0 };
  for (const r of regeneratedRows) {
    if (r.delta === null) continue;
    if (r.delta > 0) tally.improved += 1;
    else if (r.delta < 0) tally.regressed += 1;
    else tally.unchanged += 1;
  }

  // 3. the rows that did NOT change — the control group. If the mean moved
  //    for them too, the movement is the RUN, not the regeneration.
  //    The SAME population as the means above: a row that is out of scope
  //    in EITHER run is a control, not a result, and a control group over a
  //    different population than the means cannot be compared with them.
  const controlBase = [];
  const controlCand = [];
  for (const [id, row] of candById) {
    if (changedIds.has(id)) continue;
    if (baseOos.has(id) || candOos.has(id)) continue;
    const b = metricValue((baseById.get(id) || {}).metrics, focusMetric);
    const k = metricValue(row.metrics, focusMetric);
    if (b !== null && k !== null) {
      controlBase.push(b);
      controlCand.push(k);
    }
  }

  return {
    oos: { baseline: baseOos.size, candidate: candOos.size },
    metrics,
    changed: { answers: answerChangedCount, references: referenceChangedCount },
    regenerated: regeneratedRows,
    tally,
    control: {
      count: controlBase.length,
      baselineMean: mean(controlBase),
      candidateMean: mean(controlCand)
    }
  };
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
    // The driver's document() THROWS on a 404, so the `if (!doc)` guards
    // never fired and a mistyped run key produced a raw ArangoDB stack
    // instead of the one line that says which key was wrong.
    const loadRun = async (key, label) => {
      try {
        return await c.document(key);
      } catch (e) {
        if (e && (e.code === 404 || e.statusCode === 404)) {
          throw new Error(`${label} run ${key} not found`);
        }
        throw e;
      }
    };
    const baseline = await loadRun(baselineKey, 'baseline');
    const candidate = await loadRun(candidateKey, 'candidate');
    if (!baseline) throw new Error(`baseline run ${baselineKey} not found`);
    if (!candidate) throw new Error(`candidate run ${candidateKey} not found`);

    const baseJudge = (baseline.payload && baseline.payload.fidelity && baseline.payload.fidelity.judge) || null;
    const candJudge = (candidate.payload && candidate.payload.fidelity && candidate.payload.fidelity.judge) || null;
    console.log(`baseline  ${baselineKey}  status=${baseline.status}`);
    console.log(`          judge=${JSON.stringify(baseJudge)}`);
    console.log(`candidate ${candidateKey}  status=${candidate.status}`);
    console.log(`          judge=${JSON.stringify(candJudge)}\n`);

    const cmp = compareRuns(baseline, candidate, focusMetric);

    if (cmp.oos.baseline || cmp.oos.candidate) {
      console.log(
        `out-of-scope controls excluded from the means: baseline ${cmp.oos.baseline}, candidate ${cmp.oos.candidate}\n`
      );
    }

    console.log('=== per-metric means (mean over the rows the judge SCORED) ===');
    console.log('metric                                baseline   candidate     delta   scored');
    for (const m of cmp.metrics) {
      console.log(
        `${m.name.padEnd(38)} ${fmt(m.baselineMean).padStart(9)} ${fmt(m.candidateMean).padStart(10)} ` +
          `${m.delta === null ? '     -' : (m.delta >= 0 ? '+' : '') + m.delta.toFixed(3).padStart(6)} ` +
          `${String(m.baselineScored) + '/' + String(m.candidateScored)}`
      );
    }

    console.log(
      `\n=== content changed between the runs: ${cmp.changed.answers} answer(s), ` +
        `${cmp.changed.references} reference(s) ===`
    );
    console.log('(a fresh run regenerates the ANSWERS; a re-score changes neither)');
    console.log(`\n=== the ${cmp.regenerated.length} changed rows — ${focusMetric} ===`);
    console.log('row            answer ref   baseline  candidate     delta');
    for (const r of cmp.regenerated) {
      console.log(
        `${r.id.padEnd(14)} ${r.answerChanged ? 'yes' : ' no'}    ${r.referenceChanged ? 'yes' : ' no'}   ` +
          `${fmt(r.baseline).padStart(8)} ${fmt(r.candidate).padStart(10)} ` +
          `${r.delta === null ? '     -' : (r.delta >= 0 ? '+' : '') + r.delta.toFixed(3).padStart(6)}`
      );
    }
    console.log(`\nimproved ${cmp.tally.improved}  unchanged ${cmp.tally.unchanged}  regressed ${cmp.tally.regressed}`);

    console.log(`\n=== control group: the ${cmp.control.count} rows that did NOT change ===`);
    console.log(`baseline mean ${fmt(cmp.control.baselineMean)}  candidate mean ${fmt(cmp.control.candidateMean)}`);
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

module.exports = { metricValue, mean, compareRuns };
