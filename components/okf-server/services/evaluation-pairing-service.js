// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #2061 phase 3 (E-7) — the PAIRING between a suite and a run.
//
// A suite is minted for a context; a run measures over a carrier. Between
// the two there is exactly one honest question: are these two measurements
// about the same thing?
//
// The answer is a set of tiers, and each tier is a DIFFERENT promise:
//
//   ok          — the suite's context and the run's context are the same,
//                 the pool held, and the carrier did not grow. Comparable.
//   unbound     — the suite was minted before contexts existed. It runs,
//                 but its result is DIAGNOSTIC: it says what it measured,
//                 and it does not pretend to be comparable to a bound run.
//   experiment  — a cross-context run, lifted by a recorded superadmin
//                 decision. It runs, it is recorded, and it is NOT
//                 comparable.
//   blocked     — the pairing cannot be measured at all: the under-test or
//                 the pool is not in the run's carrier, so the run would
//                 score a corpus the suite was never minted against.
//
// Inside 'ok' there are two more tiers, which never block on their own:
//
//   skip-with-reason — a ROW's dependency (the rival it cites, the source
//                 repository it was minted from) is not in the run's
//                 carrier. The row cannot be scored, so it is skipped,
//                 counted in the coverage, and carries the reason. It is
//                 never silently dropped: a suite that quietly loses its
//                 hardest negatives is a suite that reports a better pass
//                 rate than it earned.
//   flag-only   — the carrier GREW: the run's carrier holds repositories
//                 the suite never saw, so the suite scored a smaller world
//                 than the one measured.
//
// The comparison KEYS are the two hashes, never the context version: the
// serving set refreshes on the 30s TTL, and a re-built head moves the
// measurement without moving the graph.

'use strict';

const { logger } = require('../shared-lib/logger');

/**
 * The repositories a row's verdict depends on.
 *
 * A confusable row names its RIVAL by name; the name is resolved against
 * the suite's snapshot to an id. A benchmark question names its SOURCE
 * repository by id. A row with no dependency (a positive, a near-miss, an
 * abstention probe — which asserts an abstention, not an owner) depends on
 * nothing.
 *
 * @param {object} row
 * @param {object} snapshot - the suite's bound context snapshot
 * @returns {string[]} the repository ids the row depends on
 */
function rowDependencies(row, snapshot) {
  if (!row) return [];
  const out = [];
  const sourceId = row.source_repo_id;
  if (sourceId) {
    out.push(sourceId);
    return out;
  }
  // An abstention probe asserts that the under-test does NOT claim the
  // query — its owner is nobody, so it depends on nothing.
  if (row.intended_carrier === 'out') return out;
  const expected = typeof row.expected_repo === 'string' ? row.expected_repo.trim() : '';
  if (!expected) return out;
  const repos = (snapshot && snapshot.repos) || [];
  const hit = repos.find((r) => r.name === expected || r.repo_id === expected);
  // A rival the snapshot never knew is still a dependency — and one the
  // carrier cannot hold, so the row is skipped with a reason.
  out.push(hit ? hit.repo_id : expected);
  return out;
}

/**
 * The pairing statement.
 *
 * @param {object} args
 * @param {object|null} args.suiteContext - the suite's bound context snapshot
 * @param {string} args.suiteRepoId - the repository under test
 * @param {object|null} args.runContext - the context the run measures over
 * @param {{repo_ids: string[]}} args.runCarrier - the run's carrier
 * @param {{repo_set_hash?: string, head_version_hash?: string}} args.runKeys
 * @param {Array} [args.rows] - the suite's rows (for the skip tier)
 * @param {object|null} [args.experiment] - the recorded superadmin decision
 * @returns {{status: string, comparable: boolean, reasons: string[], missing_pool: string[], carrier_grew: string[], skipped_rows: Array}}
 */
function pair({
  suiteContext = null,
  suiteRepoId = null,
  runContext = null,
  runCarrier = null,
  runKeys = null,
  rows = [],
  experiment = null
} = {}) {
  const reasons = [];
  const carrierIds = Array.isArray(runCarrier && runCarrier.repo_ids) ? runCarrier.repo_ids : [];
  const carrierSet = new Set(carrierIds);

  // An UNBOUND suite: minted before contexts existed. It runs, and its
  // result is diagnostic — never comparable to a bound run.
  if (!suiteContext) {
    return {
      status: 'unbound',
      comparable: false,
      reasons: ['unbound_suite'],
      missing_pool: [],
      carrier_grew: [],
      skipped_rows: []
    };
  }

  // CROSS-CONTEXT: the suite was minted for one context and the run
  // measures over another (or over no context at all — the deployment is
  // not the context). Blocked by default; a recorded superadmin decision
  // turns it into an experiment, which is still not comparable.
  const sameContext = !!runContext && runContext.id === suiteContext.id;
  if (!sameContext) {
    reasons.push('cross_context');
    if (!experiment) {
      return {
        status: 'blocked',
        comparable: false,
        reasons,
        missing_pool: [],
        carrier_grew: [],
        skipped_rows: []
      };
    }
    return {
      status: 'experiment',
      comparable: false,
      reasons,
      missing_pool: [],
      carrier_grew: [],
      skipped_rows: []
    };
  }

  // The POOL: what the suite was minted over. A pool repository missing
  // from the run's carrier means the suite is being measured over a
  // different corpus — that cannot be scored, so it blocks.
  const poolIds = (suiteContext.repos || []).map((r) => r.repo_id);
  const missingPool = poolIds.filter((id) => !carrierSet.has(id));
  if (suiteRepoId && !carrierSet.has(suiteRepoId)) {
    reasons.push('under_test_not_in_carrier');
  }
  if (missingPool.length) {
    reasons.push('pool_not_in_carrier');
    return {
      status: 'blocked',
      comparable: false,
      reasons,
      missing_pool: missingPool,
      carrier_grew: [],
      skipped_rows: []
    };
  }

  // The carrier GREW: the run measures repositories the suite never saw.
  // The suite scored a smaller world — flagged, never blocked.
  const poolSet = new Set(poolIds);
  const carrierGrew = carrierIds.filter((id) => !poolSet.has(id));
  if (carrierGrew.length) reasons.push('carrier_grew');

  // The KEYS: the same set of repositories is not the same measurement
  // when the head vectors moved. A drift is not a block — the run is real
  // — but it is not comparable either.
  const keys = runKeys || {};
  let comparable = true;
  if (suiteContext.repo_set_hash && keys.repo_set_hash && suiteContext.repo_set_hash !== keys.repo_set_hash) {
    reasons.push('repo_set_drift');
    comparable = false;
  }
  if (suiteContext.head_version_hash && keys.head_version_hash && suiteContext.head_version_hash !== keys.head_version_hash) {
    reasons.push('head_version_drift');
    comparable = false;
  }

  // The SKIP tier: a row whose dependency left the carrier cannot be
  // scored. It is skipped, counted, and carries the reason.
  const skippedRows = [];
  (rows || []).forEach((row, index) => {
    const deps = rowDependencies(row, suiteContext);
    const lost = deps.filter((id) => !carrierSet.has(id));
    if (lost.length) {
      skippedRows.push({
        id: row.id === undefined || row.id === null ? null : row.id,
        index,
        reason: 'dependency_not_in_carrier',
        dependencies: lost
      });
    }
  });

  if (reasons.length) {
    logger.info('eval_pairing.paired', {
      suite_context: suiteContext.id,
      status: 'ok',
      reasons,
      carrier_grew: carrierGrew,
      skipped_rows: skippedRows.length
    });
  }

  return {
    status: 'ok',
    comparable,
    reasons,
    missing_pool: missingPool,
    carrier_grew: carrierGrew,
    skipped_rows: skippedRows
  };
}

module.exports = { pair, rowDependencies };
