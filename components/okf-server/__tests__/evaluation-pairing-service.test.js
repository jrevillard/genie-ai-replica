// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #2061 phase 3 (E-7) — the PAIRING between a suite and a run.
//
// A suite is minted for a context; a run measures over a carrier. Between
// the two, three things can happen, and each has its own tier:
//
//   BLOCK            the pairing cannot be measured — the under-test or the
//                    pool is not in the run's carrier;
//   SKIP-WITH-REASON a ROW's dependency (its rival, its source repository)
//                    left the carrier — that row is skipped, counted, and
//                    never silently dropped;
//   FLAG             the carrier GREW — the run's carrier holds repositories
//                    the suite never saw, so the suite scored a smaller
//                    world than the one measured.
//
// And two statuses that are not drift at all: an UNBOUND suite (minted
// before this phase) is diagnostic, and a cross-context run is an EXPERIMENT
// (blocked by default; lifted only by a recorded superadmin decision).

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));

const pairing = require('../services/evaluation-pairing-service');

const SNAPSHOT = {
  id: 'ctx-1',
  name: 'group-a',
  version: 1,
  repos: [
    { repo_id: 'r-under', name: 'Under Test', graph_name: 'OKF_under_v1', head_version: 3 },
    { repo_id: 'r-rival', name: 'Rival', graph_name: 'OKF_rival_v1', head_version: 1 }
  ],
  repo_set_hash: 'hash-pool',
  head_version_hash: 'hash-heads'
};

describe('#2061 phase 3 (E-7): the pairing between a suite and a run', () => {
  test('a suite and a run over the SAME context are paired', () => {
    const out = pairing.pair({
      suiteContext: SNAPSHOT,
      suiteRepoId: 'r-under',
      runContext: { id: 'ctx-1', version: 1 },
      runCarrier: { repo_ids: ['r-under', 'r-rival'] },
      runKeys: { repo_set_hash: 'hash-pool', head_version_hash: 'hash-heads' }
    });
    expect(out.status).toBe('ok');
    expect(out.comparable).toBe(true);
    expect(out.reasons).toEqual([]);
    expect(out.carrier_grew).toEqual([]);
    expect(out.missing_pool).toEqual([]);
  });

  test('an UNBOUND suite is diagnostic — it runs, but its result is not comparable', () => {
    const out = pairing.pair({
      suiteContext: null,
      suiteRepoId: 'r-under',
      runContext: { id: 'ctx-1', version: 1 },
      runCarrier: { repo_ids: ['r-under'] },
      runKeys: { repo_set_hash: 'x', head_version_hash: 'y' }
    });
    expect(out.status).toBe('unbound');
    expect(out.comparable).toBe(false);
  });

  test('a CROSS-CONTEXT run is blocked by default', () => {
    const out = pairing.pair({
      suiteContext: SNAPSHOT,
      suiteRepoId: 'r-under',
      runContext: { id: 'ctx-2', version: 1 },
      runCarrier: { repo_ids: ['r-under', 'r-rival'] },
      runKeys: { repo_set_hash: 'x', head_version_hash: 'y' }
    });
    expect(out.status).toBe('blocked');
    expect(out.comparable).toBe(false);
    expect(out.reasons).toContain('cross_context');
  });

  test('a cross-context run is an EXPERIMENT when a superadmin lifts it', () => {
    const out = pairing.pair({
      suiteContext: SNAPSHOT,
      suiteRepoId: 'r-under',
      runContext: { id: 'ctx-2', version: 1 },
      runCarrier: { repo_ids: ['r-under', 'r-rival'] },
      runKeys: { repo_set_hash: 'x', head_version_hash: 'y' },
      experiment: { actor: 'admin-1', reason: 'deliberate comparison' }
    });
    expect(out.status).toBe('experiment');
    expect(out.comparable).toBe(false);
    expect(out.reasons).toContain('cross_context');
  });

  test('the under-test missing from the run carrier BLOCKS the run', () => {
    const out = pairing.pair({
      suiteContext: SNAPSHOT,
      suiteRepoId: 'r-under',
      runContext: { id: 'ctx-1', version: 1 },
      runCarrier: { repo_ids: ['r-rival'] },
      runKeys: { repo_set_hash: 'x', head_version_hash: 'y' }
    });
    expect(out.status).toBe('blocked');
    expect(out.reasons).toContain('under_test_not_in_carrier');
    expect(out.missing_pool).toContain('r-under');
  });

  test('a pool repository missing from the run carrier BLOCKS the run', () => {
    const out = pairing.pair({
      suiteContext: SNAPSHOT,
      suiteRepoId: 'r-under',
      runContext: { id: 'ctx-1', version: 1 },
      runCarrier: { repo_ids: ['r-under'] },
      runKeys: { repo_set_hash: 'x', head_version_hash: 'y' }
    });
    expect(out.status).toBe('blocked');
    expect(out.missing_pool).toEqual(['r-rival']);
  });

  test('a carrier that GREW is flagged, not blocked', () => {
    const out = pairing.pair({
      suiteContext: SNAPSHOT,
      suiteRepoId: 'r-under',
      runContext: { id: 'ctx-1', version: 1 },
      runCarrier: { repo_ids: ['r-under', 'r-rival', 'r-new'] },
      runKeys: { repo_set_hash: 'x', head_version_hash: 'y' }
    });
    // The run PROCEEDS — the pool held. But the suite scored a smaller world
    // than the one measured, so it is flagged and NOT comparable.
    expect(out.status).toBe('ok');
    expect(out.carrier_grew).toEqual(['r-new']);
    expect(out.reasons).toContain('carrier_grew');
    expect(out.comparable).toBe(false);
  });

  test("a row's dependency that left the carrier is SKIPPED with a reason, and counted", () => {
    const rows = [
      { id: 'row-1', cls: 'confusable', expected_repo: 'Rival' },
      { id: 'row-2', cls: 'abstention', intended_carrier: 'out', expected_repo: null },
      { id: 'row-3', cls: 'confusable', expected_repo: 'Gone' }
    ];
    const out = pairing.pair({
      suiteContext: SNAPSHOT,
      suiteRepoId: 'r-under',
      runContext: { id: 'ctx-1', version: 1 },
      runCarrier: { repo_ids: ['r-under'] },
      runKeys: { repo_set_hash: 'x', head_version_hash: 'y' },
      rows
    });
    // The pool check fires first — the rival left, so the pool changed.
    expect(out.status).toBe('blocked');
    expect(out.missing_pool).toEqual(['r-rival']);
  });

  test('a row dependency that left the carrier is skipped when the pool held', () => {
    const out = pairing.pair({
      suiteContext: SNAPSHOT,
      suiteRepoId: 'r-under',
      runContext: { id: 'ctx-1', version: 1 },
      runCarrier: { repo_ids: ['r-under', 'r-rival'] },
      runKeys: { repo_set_hash: 'x', head_version_hash: 'y' },
      rows: [{ id: 'row-3', cls: 'confusable', expected_repo: 'Not In The Snapshot' }]
    });
    expect(out.status).toBe('ok');
    // The rival it cites is not in the evaluated set at all — the row
    // cannot be scored, and it is skipped WITH A REASON, never silently.
    expect(out.skipped_rows).toEqual([
      { id: 'row-3', index: 0, reason: 'dependency_not_in_carrier', dependencies: ['Not In The Snapshot'] }
    ]);
  });

  test('the keys are compared: a different head version is not a comparable run', () => {
    const out = pairing.pair({
      suiteContext: SNAPSHOT,
      suiteRepoId: 'r-under',
      runContext: { id: 'ctx-1', version: 1 },
      runCarrier: { repo_ids: ['r-under', 'r-rival'] },
      runKeys: { repo_set_hash: 'hash-pool', head_version_hash: 'hash-OTHER' }
    });
    expect(out.status).toBe('ok');
    expect(out.comparable).toBe(false);
    expect(out.reasons).toContain('head_version_drift');
  });

  test('a row dependency is resolved by NAME against the snapshot', () => {
    const deps = pairing.rowDependencies(
      { cls: 'confusable', expected_repo: 'Rival' },
      SNAPSHOT
    );
    expect(deps).toEqual(['r-rival']);
    // A row with no dependency (a positive, a near-miss, an abstention
    // probe) depends on nothing.
    expect(pairing.rowDependencies({ cls: 'positive' }, SNAPSHOT)).toEqual([]);
    expect(pairing.rowDependencies({ cls: 'abstention', intended_carrier: 'out' }, SNAPSHOT)).toEqual([]);
    // A source repository (the RAGAS stamp) is a dependency by id.
    expect(pairing.rowDependencies({ source_repo_id: 'r-rival' }, SNAPSHOT)).toEqual(['r-rival']);
  });
});
