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
//   blocked     — the pairing cannot be measured AT ALL, and there are
//                 exactly two reasons for that (the party panel, 2026-11-23):
//                   · the repository UNDER TEST is not in the run's carrier
//                     — the subject of the measurement is absent;
//                   · more than half the suite's POOL is gone from the
//                     carrier — the run is a DIFFERENT experiment, not the
//                     same one with holes (the floor: MIN_POOL_COVERAGE).
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
//
//                 Running such a row would be the worst of both worlds: a
//                 confusable whose rival is ABSENT passes by the rival's
//                 absence, and a benchmark question whose own repository is
//                 absent fails because its passages are not in the served
//                 set. Neither number is about the system.
//
//   flag-only   — the carrier GREW (it holds repositories the suite never
//                 saw) OR SHRANK (the suite's pool no longer holds): the run
//                 measured a different world than the one the suite was
//                 minted for. Grow and shrink are the SAME failure of
//                 comparability, seen from opposite directions — neither
//                 blocks, and both force `comparable: false`.
//
// The comparison KEYS are the two hashes, never the context version: the
// serving set refreshes on the 30s TTL, and a re-built head moves the
// measurement without moving the graph.

'use strict';

const { logger } = require('../shared-lib/logger');

/**
 * The POOL-EVAPORATION FLOOR (David, 2026-11-23): below this share of the
 * suite's pool still present in the run's carrier, the run is not the same
 * experiment with holes — it is a DIFFERENT corpus, and a number over it
 * would answer a different question than the operator asked. There the run
 * is refused, and the refusal names what it lost.
 *
 * Above it, a shrunken carrier is a comparability FLAG, not a block: the
 * rows that depend on a missing repository are skipped and counted, and the
 * record says the corpus was smaller.
 */
const MIN_POOL_COVERAGE = 0.5;

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
  // SMALLER world than it was minted for.
  const poolIds = (suiteContext.repos || []).map((r) => r.repo_id);
  const missingPool = poolIds.filter((id) => !carrierSet.has(id));

  // The SKIP tier — computed BEFORE the pool decision, so it fires for the
  // case it exists for: a ROW's dependency (the rival it cites, the
  // repository it was minted from) left the carrier. That row cannot be
  // scored over this corpus: running it would either pass the under-test by
  // the rival's ABSENCE or fail the question because its own passages are
  // not in the served set. Either way the number would be an artefact of
  // the carrier, not of the system. So the row is not run: it is skipped,
  // counted in the coverage, and carries the reason.
  //
  // The index is the row's position in the array the CALLER passed — the
  // caller must index the SAME array it passes here, or the skip lands on
  // the wrong row.
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

  // The SUBJECT: the repository under test. Without it there is no
  // measurement at all — every row is a question about a repository that is
  // not there. This is the ONE blocking condition inside a same-context
  // pairing.
  if (suiteRepoId && !carrierSet.has(suiteRepoId)) {
    reasons.push('under_test_not_in_carrier');
    return {
      status: 'blocked',
      comparable: false,
      reasons,
      missing_pool: missingPool,
      carrier_grew: [],
      skipped_rows: skippedRows
    };
  }

  // The POOL SHRANK: a shrunken carrier is the SAME failure of
  // comparability as a grown one, seen from the other side. The run scores
  // the rows it can and skips the rows it cannot; the record says the
  // corpus was smaller and the run is not comparable. A shrunken carrier
  // must NOT be silently absorbed — but refusing the whole measurement
  // would destroy the rows that ARE measurable, which is the one thing the
  // coverage note exists to prevent.
  if (missingPool.length) reasons.push('pool_not_in_carrier');

  // THE FLOOR (David, 2026-11-23): past half the suite's pool is gone, the
  // run is not the same experiment with holes — it is a DIFFERENT corpus,
  // and a number over it would answer a different question than the one
  // the operator asked. There the run is refused, and the refusal names the
  // coverage it lost.
  const poolCoverage = poolIds.length ? (poolIds.length - missingPool.length) / poolIds.length : 1;
  if (missingPool.length && poolCoverage < MIN_POOL_COVERAGE) {
    reasons.push('pool_evaporated');
    return {
      status: 'blocked',
      comparable: false,
      reasons,
      missing_pool: missingPool,
      carrier_grew: [],
      skipped_rows: skippedRows,
      pool_coverage: poolCoverage
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
  // A carrier that GREW is not a comparable measurement, whatever the
  // hashes say: the suite scored a SMALLER world than the one measured, and
  // the extra repositories were never evaluated. The hash comparison usually
  // catches the same drift, but the tier must stand on its own — a run with
  // no keys must not be stamped comparable over a different world.
  //
  // The same holds for a carrier that SHRANK, and for a run that skipped
  // rows: a measurement over a different corpus, or over fewer rows, is not
  // comparable with one over the whole — a suite that quietly loses its
  // hardest negatives is a suite that reports a better pass rate than it
  // earned.
  let comparable = carrierGrew.length === 0 && missingPool.length === 0 && skippedRows.length === 0;
  if (suiteContext.repo_set_hash && keys.repo_set_hash && suiteContext.repo_set_hash !== keys.repo_set_hash) {
    reasons.push('repo_set_drift');
    comparable = false;
  }
  if (
    suiteContext.head_version_hash &&
    keys.head_version_hash &&
    suiteContext.head_version_hash !== keys.head_version_hash
  ) {
    reasons.push('head_version_drift');
    comparable = false;
  }

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
    skipped_rows: skippedRows,
    // The share of the suite's pool the run still measured over. The
    // operator reads it beside the coverage: "88 of 100 rows, over 92% of
    // the original corpus" is a measurement; "88 of 100 rows" alone is a
    // number with a hole in it.
    pool_coverage: poolCoverage
  };
}

module.exports = { pair, rowDependencies };
