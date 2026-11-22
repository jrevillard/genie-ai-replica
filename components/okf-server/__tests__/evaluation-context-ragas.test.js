// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #2061 phase 2 — E-4, the RAGAS scoped serve + the source attribution.
//
// A benchmark that cannot say WHICH repository answered cannot say whether
// the routing worked for the group it measured. Two rules are pinned here:
//
//   1. the CARRIER decides the served set — the Evaluation Context's
//      resolved graphs, not the suite's own repositories (and never a
//      widening: the carrier is already a subset of what serves);
//   2. the per-source provenance chatqna already emits is carried through
//      and turned into two numbers — WHICH repository answered, and how
//      often an answer was grounded OUTSIDE the carrier.
//
// "Not measured" is null throughout. A zero would read as "nothing was
// wrong", which is a different claim.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

const { serveGraphNames, sourceRepoHistogram, wrongSourceRate } = require('../services/ragas-suite-service');

const CARRIER = {
  context: { id: 'ec-1', name: 'analysts', version: 2, hash: 'h1' },
  repo_ids: ['r-a'],
  graph_names: ['OKF_a_v1']
};

describe('#2061 E-4: the carrier decides the served set', () => {
  test('a carrier with graphs REPLACES the suite repositories', () => {
    expect(serveGraphNames(CARRIER, ['OKF_suite_v1', 'OKF_other_v1'])).toEqual(['OKF_a_v1']);
  });

  test('without a carrier the suite repositories serve', () => {
    expect(serveGraphNames(null, ['OKF_suite_v1'])).toEqual(['OKF_suite_v1']);
  });

  test('an EMPTY carrier serves NOTHING (the suite repositories are not a fallback)', () => {
    // A carrier that resolves to no serving repository means the principal
    // traverses none. Serving the suite's repositories instead would serve a
    // corpus the carrier does not name — while the run record still said the
    // carrier was used. The run is REFUSED by the caller, not served.
    expect(serveGraphNames({ graph_names: [] }, ['OKF_suite_v1'])).toEqual([]);
  });
});

describe('#2061 E-4: which repository answered', () => {
  test('the histogram is keyed by the repository id', () => {
    const h = sourceRepoHistogram([
      { repo_id: 'r-a', graph_name: 'OKF_a_v1' },
      { repo_id: 'r-a', graph_name: 'OKF_a_v1' },
      { repo_id: 'r-b', graph_name: 'OKF_b_v1' }
    ]);
    expect(h).toEqual({ 'r-a': 2, 'r-b': 1 });
  });

  test('a source with no repository id falls back to its graph name', () => {
    expect(sourceRepoHistogram([{ repo_id: null, graph_name: 'OKF_a_v1' }])).toEqual({ OKF_a_v1: 1 });
  });

  test('an unattributed source is COUNTED, never invisible', () => {
    expect(sourceRepoHistogram([{ repo_id: null, graph_name: null }])).toEqual({ '(unattributed)': 1 });
  });
});

describe('#2061 E-4: the wrong-source rate', () => {
  const attribution = [
    { repo_id: 'r-a', graph_name: 'OKF_a_v1' },
    { repo_id: 'r-b', graph_name: 'OKF_b_v1' },
    { repo_id: 'r-a', graph_name: 'OKF_a_v1' }
  ];

  test('without a carrier the rate is NULL (nothing to be wrong against)', () => {
    expect(wrongSourceRate(attribution, null)).toBeNull();
    expect(wrongSourceRate(attribution, [])).toBeNull();
  });

  test('a source outside the carrier counts against the rate', () => {
    // One of the three sources came from a graph the carrier does not name.
    expect(wrongSourceRate(attribution, ['OKF_a_v1'])).toBeCloseTo(1 / 3, 5);
  });

  test('every source inside the carrier is 0 — and 0 is a MEASUREMENT', () => {
    expect(wrongSourceRate(attribution, ['OKF_a_v1', 'OKF_b_v1'])).toBe(0);
  });

  test('no attributable source is NULL, never 0', () => {
    // A row whose sources carried no graph name cannot be judged; a zero
    // would read as "nothing was wrong".
    expect(wrongSourceRate([{ repo_id: null, graph_name: null }], ['OKF_a_v1'])).toBeNull();
  });
});
