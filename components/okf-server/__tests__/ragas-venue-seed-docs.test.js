// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #1890 pin: the RAGAS e2e seed's synthetic suite/run docs are
// test-equivalent to real ones — rescoreRun's ACTUAL validation accepts
// them.
//
// The three RAGAS e2e specs (ragas-rescore-tracking / ragas-judge-selector /
// ragas-guide-errors) used to assert against whatever venue repo happened
// to carry RAGAS data ('El Salvador' hardcoded as a fallback) — #1890. They
// now seed their own repo and re-score a SYNTHETIC done-run doc written
// into okf_head_test_runs through the test-only back door (the in-container
// writer, data/okf/smoke-test/seed-ragas-venue-docs.js).
//
// That synthetic doc must satisfy every gate rescoreRun applies before the
// judge leg fires: kind/status/suite binding, non-empty results, known
// metrics, at least one scorable row (answered, not abstained, no error).
// If the template drifts out of that contract, the specs would break
// confusingly at a venue — this pin breaks HERE, at PR time, instead.
//
// The template lives at data/okf/smoke-test/ragas-venue-seed-docs.js: one
// pure-data module this test, the e2e seed helper, and (after docker cp)
// the in-container writer all read.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('axios');
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../services/frontmatter-service', () => ({
  readFrontmatterFromRepoDoc: jest.fn(),
  vllmChatCompletions: jest.fn(),
  teiEmbed: jest.fn()
}));
jest.mock('../services/repository-service', () => ({ getById: jest.fn() }));

// Same shrink the main suite uses — the sidecar poller must complete in
// milliseconds, not 3s hops (see ragas-suite-service.test.js header).
process.env.OKF_RAGAS_JOB_POLL_MS = '5';
process.env.OKF_RAGAS_LONG_TIMEOUT_MS = '1';
process.env.OKF_RAGAS_SUBMIT_RETRY_DELAYS_MS = '1,1,1';

const path = require('path');
const svc = require('../services/ragas-suite-service');
const { __mockDb } = require('../shared-lib/db-connection-service');

const TEMPLATE_PATH = path.resolve(__dirname, '../../../data/okf/smoke-test/ragas-venue-seed-docs.js');

function okJson(payload) {
  return { ok: true, json: async () => payload, arrayBuffer: async () => new ArrayBuffer(8) };
}

beforeEach(() => {
  jest.clearAllMocks();
  __mockDb._reset();
  // The rescore's judge leg is the SIDECAR (the answers are copied
  // verbatim; only /evaluate runs) — no vLLM/answer-leg mock needed.
  global.fetch = jest.fn((url) => {
    const u = String(url);
    if (u.includes('/evaluate')) return Promise.resolve(okJson({ job_id: 'j-eval', status: 'queued' }));
    if (u.includes('/jobs/j-eval'))
      return Promise.resolve(
        okJson({
          job_id: 'j-eval',
          kind: 'evaluate',
          status: 'done',
          // An empty per_query row is the "the judge could not measure this"
          // shape — the seed must survive even the weakest honest judge.
          result: { aggregate: {}, per_query: [{}], model: 'm', n: 1 }
        })
      );
    return Promise.reject(new Error(`unexpected fetch ${u}`));
  });
});

afterEach(() => {
  delete global.fetch;
});

describe('the #1890 e2e seed docs pass rescoreRun’s real contract', () => {
  it('a re-score of the seeded run completes through the actual validation', async () => {
    // RED until the template module exists — this require IS the contract's
    // file-level pin (the writer and the helper require the same file).
    const seed = require(TEMPLATE_PATH);
    const repoId = 'seed-repo-0001';
    __mockDb._stores.okf_head_test_runs = {
      [seed.SUITE_KEY]: seed.suiteDoc(repoId),
      [seed.RUN_KEY]: seed.runDoc(repoId)
    };

    const begun = await svc.rescoreRun(repoId, seed.SUITE_KEY, seed.RUN_KEY, {}, {});
    const newDoc = await begun.done;

    // The re-score ran to completion: every gate passed (status done, the
    // suite binding matched, the row was scorable, the metrics were known).
    expect(newDoc.status).toBe('done');
    expect(newDoc.payload.fidelity.rescore_of).toBe(seed.RUN_KEY);
    // The answers are the seed's, verbatim — only the judge ran again.
    expect(newDoc.payload.results.map((r) => r.answer)).toEqual(
      seed.runDoc(repoId).payload.results.map((r) => r.answer)
    );
    // And the completed re-score is itself a legit member of the history
    // the panel lists (same shape the seed's own doc must carry).
    expect(newDoc.kind).toBe('ragas_run');
    expect(newDoc.suite_key).toBe(seed.SUITE_KEY);
  });

  it('the suite doc carries its own suite_key — the field deleteSuite’s cascade removes by', async () => {
    // Found live: a suite doc WITHOUT the top-level suite_key survives the
    // deleteSuite cascade (the REMOVE filter matches d.suite_key) — the
    // seed's purge then leaves exactly that orphan. saveSuite() writes the
    // field; the template must too.
    const seed = require(TEMPLATE_PATH);
    const suite = seed.suiteDoc('seed-repo-0001');
    expect(suite.suite_key).toBe(seed.SUITE_KEY);
    expect(suite.repo_id).toBe('seed-repo-0001');
    // The run doc binds to the suite the same way.
    const run = seed.runDoc('seed-repo-0001');
    expect(run.suite_key).toBe(seed.SUITE_KEY);
    expect(run.repo_id).toBe('seed-repo-0001');
  });

  it('the seeded run refuses NOTHING that a real done run refuses — the gates hold for the wrong repo', async () => {
    // The negative control: the same doc re-scored against a FOREIGN repo id
    // must 404 — proving the test above passed because the docs are valid,
    // not because the validation was never reached.
    const seed = require(TEMPLATE_PATH);
    __mockDb._stores.okf_head_test_runs = {
      [seed.SUITE_KEY]: seed.suiteDoc('seed-repo-0001'),
      [seed.RUN_KEY]: seed.runDoc('seed-repo-0001')
    };
    await expect(svc.rescoreRun('other-repo', seed.SUITE_KEY, seed.RUN_KEY, {}, {})).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND',
      status: 404
    });
  });
});
