// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #1890 — the RAGAS e2e venue-seed's synthetic test-suite + done-run docs.
//
// The three RAGAS e2e specs (ragas-rescore-tracking / ragas-judge-selector /
// ragas-guide-errors) used to fall back to 'El Salvador' — whatever venue
// data happened to exist — so they failed on venues without it and quietly
// coupled their verdicts to content no test controlled (#1890). They now
// seed their OWN repo (via the OKF API, tests/e2e/helpers/ragas-venue-seed.js)
// and their own RAGAS data: this module's two docs, written into
// okf_head_test_runs through the TEST-ONLY back door (the in-container
// writer, seed-ragas-venue-docs.js — docker cp + docker exec, the same
// procedure as every run-smoke*.js harness).
//
// THIS MODULE IS THE ONE SOURCE OF THE SHAPE. It is read by:
//   - the in-container writer (docker cp'd next to the app, requires it);
//   - the e2e seed helper (repo naming + purge keys);
//   - the okf-server unit pin test (ragas-venue-seed-docs.test.js), which
//     runs rescoreRun's ACTUAL validation against these docs — the pin
//     that keeps the template from drifting out of the service contract.
//
// It deliberately requires NOTHING: a pure-data module so every consumer
// (a jest process, the container, the Playwright runner) can load it.
//
// The docs carry the minimum honest shape of a finished run: ONE answered
// row with metrics {} (a judge never scored this fixture — the means are
// null and the UI shows them unmeasured), a suite with ONE in-scope entry,
// and a fidelity block that NAMES itself as a test fixture. rescoreRun
// accepts it: status 'done', kind 'ragas_run', the suite binding, a
// non-empty results array whose row passes the isAnswered gate, and
// metrics within the known set — the pin test proves it.

'use strict';

const REPO_NAME = 'ragas-venue-seed';
const DOMAIN = 'e2e-seed';
const SUITE_KEY = 'e2e-seed-ragas-suite';
const RUN_KEY = 'e2e-seed-ragas-run-done';
// The _key prefix every seeded doc carries — the orphan sweep and
// verify-clean build their filters from THIS constant, never a re-spelled
// literal, so a key rename cannot decouple the sweep from the verifier.
const SEED_KEY_PREFIX = 'e2e-seed-';
// Deterministic timestamps: listRuns sorts by created_at DESC, and a fixed
// instant keeps the seeded history stable across re-seeds (the purge in the
// afterAll removes every prior seed first).
const CREATED_AT = '2026-11-17T00:00:00.000Z';
// The four default metrics (ragas-suite-service DEFAULT_METRICS) — all
// known to rescoreRun's filter, all left UNMEASURED (no judge has scored
// this fixture).
const METRICS = ['faithfulness', 'context_precision', 'context_recall', 'answer_relevancy'];

const ENTRY = {
  id: 'seed-concept-alpha',
  query: 'What does the venue seed concept alpha say?',
  oos: false,
  reference_answer: 'Alpha is the venue seed fixture concept.',
  reference_passages: ['Alpha is the venue seed fixture concept.']
};

/** The suite doc — the shape loadSuite() and summarizeRun() read. */
function suiteDoc(repoId) {
  return {
    _key: SUITE_KEY,
    repo_id: repoId,
    kind: 'ragas_suite',
    // The suite carries its OWN key the way saveSuite() writes it
    // (ragas-suite-service) — deleteSuite's cascade removes by
    // `d.suite_key == suiteKey`, so a suite doc without the field survives
    // every purge (found live: the first cascade left exactly this
    // orphan).
    suite_key: SUITE_KEY,
    status: 'done',
    name: 'e2e venue seed suite',
    created_at: CREATED_AT,
    created_by: 'e2e-ragas-seed',
    metrics: METRICS,
    payload: {
      entries: [ENTRY],
      metrics_config: METRICS,
      thresholds: {}
    }
  };
}

/** The done-run doc — the shape rescoreRun() validates and the panel lists. */
function runDoc(repoId) {
  return {
    _key: RUN_KEY,
    repo_id: repoId,
    kind: 'ragas_run',
    status: 'done',
    suite_key: SUITE_KEY,
    created_at: CREATED_AT,
    created_by: 'e2e-ragas-seed',
    repo_ids: [repoId],
    metrics: METRICS,
    payload: {
      suite_created_at: CREATED_AT,
      entries: [ENTRY],
      results: [
        {
          id: ENTRY.id,
          query: ENTRY.query,
          // The fixture's answer/contexts ARE the suite entry's reference —
          // one fact, stated once in ENTRY.
          contexts: ENTRY.reference_passages,
          answer: ENTRY.reference_answer,
          abstained: false,
          metrics: {},
          judged: true,
          ragas_nan: false
        }
      ],
      summary: {
        n: 1,
        n_errors: 0,
        n_abstained: 0,
        n_abstained_unjudged: 0,
        n_evaluable: 1,
        n_oos: 0,
        n_failed: 0,
        n_answered: 1,
        metrics: METRICS.reduce((acc, m) => ({ ...acc, [m]: null }), {}),
        coverage: METRICS.reduce((acc, m) => ({ ...acc, [m]: { scored: 0, total: 1 } }), {}),
        thresholds: {},
        failing_count: 0,
        failing: []
      },
      coverage: {
        measured_rows: 0,
        total_rows: 1,
        per_metric: METRICS.reduce((acc, m) => ({ ...acc, [m]: { scored: 0, total: 1 } }), {})
      },
      fidelity: {
        retrieval: null,
        judge: {
          // The fidelity block NAMES the fixture: any operator who opens the
          // seed's history (it lives only for the seconds of an e2e run) is
          // told this run is a test fixture, never a measured benchmark.
          source: 'e2e-seed (test-only fixture)',
          config: null,
          model: null,
          pick: { config_key: null, model: null }
        }
      }
    }
  };
}

module.exports = { REPO_NAME, DOMAIN, SUITE_KEY, RUN_KEY, SEED_KEY_PREFIX, METRICS, ENTRY, suiteDoc, runDoc };
