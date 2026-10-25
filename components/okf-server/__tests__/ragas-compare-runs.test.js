// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 8-6 — the operator compare tool's RULES, pinned.
//
// `scripts/okf-testing-lab/ragas-compare-runs.js` is what an operator reads
// a benchmark comparison with, and its output is a DECISION input: which
// judge scored what, which rows were regenerated, what the control group
// says. So the rules that make it honest are pinned here rather than left
// to a human reading console output:
//   - the IN-SCOPE population only — an out-of-scope control is deliberately
//     unanswerable, so its score is not a result and must not sit in a mean;
//   - the rows-scored count rides beside every mean;
//   - a metric a row did not score is SKIPPED, never counted as a zero;
//   - the regenerated rows are exactly the ones whose reference answer changed;
//   - the control group is the rows that did NOT change.
//
// The script requires the shared db service by its CONTAINER path, so the
// module is mocked virtually — the comparison itself never touches a
// database.

jest.mock('/app/shared-lib/db-connection-service', () => ({ getConnection: jest.fn() }), { virtual: true });

const { metricValue, mean, compareRuns } = require('../../../scripts/okf-testing-lab/ragas-compare-runs');

/** A stored run document, shaped like the ones okf-server writes. */
function runDoc(results, entries) {
  return {
    _key: 'rr-test',
    status: 'done',
    payload: {
      results,
      entries,
      fidelity: { judge: { source: 'env', model: 'ibm-granite/granite-4.1-8b' } }
    }
  };
}

describe('the operator compare tool', () => {
  describe('metricValue', () => {
    it('reads the bare key the sidecar stores', () => {
      expect(metricValue({ context_recall: 0.5 }, 'context_recall')).toBe(0.5);
    });

    it('reads a PARAMETERIZED spelling by prefix (factual_correctness(mode=f1))', () => {
      expect(metricValue({ 'factual_correctness(mode=f1)': 0.75 }, 'factual_correctness')).toBe(0.75);
    });

    it('is null for a metric the row did not score — NOT zero', () => {
      expect(metricValue({ faithfulness: 1 }, 'context_recall')).toBeNull();
    });

    it('is null for a non-numeric value and for a non-object', () => {
      expect(metricValue({ context_recall: 'n/a' }, 'context_recall')).toBeNull();
      expect(metricValue(null, 'context_recall')).toBeNull();
    });
  });

  describe('mean', () => {
    it('is null over no values, and the arithmetic mean over some', () => {
      expect(mean([])).toBeNull();
      expect(mean([0.2, 0.4])).toBeCloseTo(0.3);
    });
  });

  describe('compareRuns', () => {
    // Two runs over the SAME three rows. The baseline scored only two of
    // them (the third's judge call never returned); the candidate scored
    // all three. Row new-3 is a control: deliberately out of scope.
    const entries = [
      { id: 'new-1', reference_answer: 'A' },
      { id: 'new-2', reference_answer: 'B' },
      { id: 'new-3', reference_answer: 'C', oos: true }
    ];
    const baseline = runDoc(
      [
        { id: 'new-1', metrics: { context_recall: 0.4, faithfulness: 1 } },
        { id: 'new-2', metrics: { context_recall: 0.6 } },
        { id: 'new-3', metrics: { context_recall: 1 } }
      ],
      entries
    );
    const candidate = runDoc(
      [
        { id: 'new-1', metrics: { context_recall: 0.8, faithfulness: 1 } },
        { id: 'new-2', metrics: { context_recall: 0.6, faithfulness: 1 } },
        { id: 'new-3', metrics: { context_recall: 1 } }
      ],
      entries
    );

    it('excludes the out-of-scope control from the means', () => {
      const cmp = compareRuns(baseline, candidate);
      const rec = cmp.metrics.find((m) => m.name === 'context_recall');
      expect(cmp.oos).toEqual({ baseline: 1, candidate: 1 });
      // The control scored 1.0 — if it were inside the mean, the candidate
      // mean would be 0.8 instead of 0.7.
      expect(rec.candidateMean).toBeCloseTo(0.7);
      expect(rec.candidateScored).toBe(2);
    });

    it('reports the rows-scored count beside every mean', () => {
      const cmp = compareRuns(baseline, candidate);
      const rec = cmp.metrics.find((m) => m.name === 'context_recall');
      // The baseline's faithfulness was scored on ONE row only — a mean over
      // 1 of 3 rows is not a whole-run number, so the count must say so.
      const faith = cmp.metrics.find((m) => m.name === 'faithfulness');
      expect(faith.baselineMean).toBe(1);
      expect(faith.baselineScored).toBe(1);
      expect(faith.candidateScored).toBe(2);
      expect(rec.baselineScored).toBe(2);
      expect(rec.candidateScored).toBe(2);
    });

    it('skips a metric a row did not score instead of counting it as zero', () => {
      const cmp = compareRuns(baseline, candidate);
      const faith = cmp.metrics.find((m) => m.name === 'faithfulness');
      // Both scored rows are 1.0; the row that did not score it is not a 0.
      expect(faith.baselineMean).toBe(1);
      expect(faith.candidateMean).toBe(1);
      expect(faith.delta).toBeCloseTo(0);
    });

    it('reports the delta between the two means', () => {
      const cmp = compareRuns(baseline, candidate);
      const rec = cmp.metrics.find((m) => m.name === 'context_recall');
      expect(rec.baselineMean).toBeCloseTo(0.5);
      expect(rec.candidateMean).toBeCloseTo(0.7);
      expect(rec.delta).toBeCloseTo(0.2);
    });

    it('finds the regenerated rows by the CHANGED reference answer, and leaves the rest as the control', () => {
      const baseEntries = [
        { id: 'new-1', reference_answer: 'A' },
        { id: 'new-2', reference_answer: 'B' },
        { id: 'new-3', reference_answer: 'C', oos: true }
      ];
      const candEntries = [
        { id: 'new-1', reference_answer: 'A REGENERATED' },
        { id: 'new-2', reference_answer: 'B' },
        { id: 'new-3', reference_answer: 'C', oos: true }
      ];
      const cmp = compareRuns(
        runDoc(baseline.payload.results, baseEntries),
        runDoc(candidate.payload.results, candEntries),
        'context_recall'
      );
      expect(cmp.regenerated.map((r) => r.id)).toEqual(['new-1']);
      expect(cmp.regenerated[0].baseline).toBe(0.4);
      expect(cmp.regenerated[0].candidate).toBe(0.8);
      expect(cmp.regenerated[0].delta).toBeCloseTo(0.4);
      expect(cmp.tally).toEqual({ improved: 1, unchanged: 0, regressed: 0 });
      // The control group is the row that did NOT change.
      expect(cmp.control.count).toBe(1);
      expect(cmp.control.baselineMean).toBeCloseTo(0.6);
      expect(cmp.control.candidateMean).toBeCloseTo(0.6);
    });

    it('counts the regenerated rows as improved, unchanged or regressed', () => {
      const baseEntries = [
        { id: 'new-1', reference_answer: 'A' },
        { id: 'new-2', reference_answer: 'B' }
      ];
      const candEntries = [
        { id: 'new-1', reference_answer: 'A2' },
        { id: 'new-2', reference_answer: 'B2' }
      ];
      const cmp = compareRuns(
        runDoc(
          [
            { id: 'new-1', metrics: { context_recall: 0.2 } },
            { id: 'new-2', metrics: { context_recall: 0.5 } }
          ],
          baseEntries
        ),
        runDoc(
          [
            { id: 'new-1', metrics: { context_recall: 0.6 } },
            { id: 'new-2', metrics: { context_recall: 0.5 } }
          ],
          candEntries
        ),
        'context_recall'
      );
      expect(cmp.tally).toEqual({ improved: 1, unchanged: 1, regressed: 0 });
    });
  });
});
