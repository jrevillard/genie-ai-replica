// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #2061 phase 3 (E-7) — the RAGAS RUN is PAIRED with the suite.
//
// A benchmark suite minted for a context may only be served over that
// context's carrier. A question whose SOURCE repository left the carrier
// cannot be scored over this corpus: it is skipped, with a reason, and
// counted — and it is NOT an error, because the pipeline never failed. It
// was not attempted.

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
jest.mock('../services/repository-service', () => ({
  getById: jest.fn()
}));
jest.mock('../services/head-test-service', () => ({
  routingTest: jest.fn(),
  guardSuggestions: jest.fn()
}));

process.env.OKF_RAGAS_JOB_POLL_MS = '5';
process.env.OKF_RAGAS_LONG_TIMEOUT_MS = '1';
process.env.OKF_RAGAS_SUBMIT_RETRY_DELAYS_MS = '1,1,1';

const svc = require('../services/ragas-suite-service');
const frontmatterService = require('../services/frontmatter-service');
const repositoryService = require('../services/repository-service');
const { __mockDb } = require('../shared-lib/db-connection-service');

function okJson(payload) {
  return { ok: true, json: async () => payload, arrayBuffer: async () => new ArrayBuffer(8) };
}
function llmResponse(obj) {
  return { data: { choices: [{ message: { content: JSON.stringify(obj) } }] } };
}

const CORPUS = {
  GRAPH_AGRI: [{ key: 'a1', text: 'Plant after the last frost date. Tomatoes are a crop.' }]
};

const SAMPLES = [
  {
    user_input: 'When should tomatoes be planted?',
    reference: 'After the last frost.',
    reference_contexts: ['Plant after the last frost date. Tomatoes are a crop.'],
    persona_name: 'agronomist',
    query_style: 'web-search',
    query_length: 'short',
    synthesizer_name: 'single_hop_specific'
  },
  {
    user_input: 'Who qualifies for legal aid?',
    reference: 'People below the income threshold.',
    reference_contexts: ['Legal aid has income criteria. Social protection content.'],
    persona_name: 'policy analyst',
    query_style: 'chat',
    query_length: 'medium',
    synthesizer_name: 'single_hop_specific'
  }
];

const METRICS = ['faithfulness', 'context_precision', 'context_recall', 'answer_relevancy'];

const SUITE_CONTEXT = {
  id: 'ctx-1',
  name: 'group-a',
  version: 1,
  hash: 'ctxhash',
  repos: [{ repo_id: 'r-agri', name: 'Agri', graph_name: 'GRAPH_AGRI' }],
  repo_set_hash: 'repo-set-hash',
  head_version_hash: 'head-version-hash'
};

const CARRIER = {
  context: { id: 'ctx-1', name: 'group-a', version: 1, hash: 'ctxhash' },
  repo_ids: ['r-agri'],
  graph_names: ['GRAPH_AGRI'],
  repos: [{ repo_id: 'r-agri', name: 'Agri', graph_name: 'GRAPH_AGRI' }],
  measured_hash: 'repo-set-hash'
};

const KEYS = { repo_set_hash: 'repo-set-hash', head_version_hash: 'head-version-hash' };

let answerCalls = 0;

describe('#2061 phase 3 (E-7): the RAGAS run is paired with the suite', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    __mockDb._reset();
    answerCalls = 0;
    process.env.OKF_RERANK_ENDPOINT = 'http://rerank.test/rerank';
    repositoryService.getById.mockImplementation(async (rid) => ({
      _key: rid,
      repo_id: rid,
      name: rid === 'r-agri' ? 'Agri' : 'Legal',
      version: 3,
      head: { version: 42 }
    }));
    frontmatterService.teiEmbed.mockResolvedValue([[0.1, 0.2, 0.3]]);
    frontmatterService.vllmChatCompletions.mockImplementation(async () => {
      answerCalls += 1;
      return llmResponse({ answer: 'A grounded answer.', abstained: false });
    });
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/rerank')) return Promise.resolve(okJson([{ index: 0, score: 0.9 }]));
      if (u.includes('/generate-testset')) {
        return Promise.resolve(okJson({ job_id: 'j-gen', status: 'queued', poll: '/jobs/j-gen' }));
      }
      if (u.includes('/jobs/j-gen')) {
        return Promise.resolve(
          okJson({
            job_id: 'j-gen',
            kind: 'generate-testset',
            status: 'done',
            result: { samples: SAMPLES, generator: { model: 'm', embed_model: 'e' } }
          })
        );
      }
      if (u.includes('/evaluate')) {
        return Promise.resolve(okJson({ job_id: 'j-eval', status: 'queued' }));
      }
      if (u.includes('/jobs/j-eval')) {
        return Promise.resolve(
          okJson({
            job_id: 'j-eval',
            kind: 'evaluate',
            status: 'done',
            result: {
              aggregate: { faithfulness: 1.0 },
              per_query: SAMPLES.map(() => ({
                faithfulness: 1.0,
                context_precision: 0.5,
                context_recall: 0.5,
                answer_relevancy: 1.0
              })),
              model: 'm',
              n: SAMPLES.length
            }
          })
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    __mockDb.query.mockImplementation(async (aql) => {
      if (aql.includes('okf_concepts_meta')) return { all: async () => ['GRAPH_AGRI'] };
      if (aql.includes('_SOURCE')) {
        const corpus = CORPUS.GRAPH_AGRI;
        if (aql.includes('COLLECT WITH COUNT')) return { all: async () => [corpus.length] };
        if (/RETURN c\._key\s*$/.test(aql.trim())) return { all: async () => corpus.map((c) => c.key) };
        return { all: async () => corpus.map((c) => ({ key: c.key, text: c.text })) };
      }
      return { all: async () => [] };
    });
  });

  // Mint a suite bound to the context, then move ONE question's source
  // repository out of the carrier — the drift the skip tier is for.
  async function seedSuiteWithADriftedQuestion() {
    const begun = await svc.beginSuiteGeneration('r-agri', { testset_size: 2 }, { actor: { user_id: 'u1' } });
    const suite = await begun.done;
    const entries = suite.payload.entries.map((e, i) => (i === 1 ? { ...e, source_repo_id: 'r-gone' } : e));
    await __mockDb.collection('okf_head_test_runs').replace(begun.suite_key, {
      ...suite,
      payload: { ...suite.payload, entries, context: SUITE_CONTEXT }
    });
    return begun.suite_key;
  }

  async function runTheSuite(suiteKey) {
    const run = await svc.beginRunSuite(
      'r-agri',
      suiteKey,
      { mode: 'whatif', metrics: METRICS },
      { actor: { user_id: 'u1' }, carrier: CARRIER, keys: KEYS }
    );
    await run.done;
    return svc.getRunSuite('r-agri', suiteKey, run.run_key);
  }

  it('a question whose SOURCE repository left the carrier is SKIPPED, not attempted', async () => {
    const suiteKey = await seedSuiteWithADriftedQuestion();
    const doc = await runTheSuite(suiteKey);

    // The skip is recorded, with its reason and its dependency.
    expect(doc.payload.pairing.skipped_rows).toHaveLength(1);
    expect(doc.payload.pairing.skipped_rows[0].reason).toBe('dependency_not_in_carrier');
    expect(doc.payload.pairing.skipped_rows[0].dependencies).toEqual(['r-gone']);
    // The row is still THERE — with a reason, not silently dropped.
    const skipped = doc.payload.results[1];
    expect(skipped.error.code).toBe('SKIPPED_DEPENDENCY_NOT_IN_CARRIER');
    expect(skipped.answer).toBe('');
    // It was NOT attempted: two questions, one answer.
    expect(answerCalls).toBe(1);
  });

  it('a skipped question is NOT counted as an ERROR — the pipeline never failed', async () => {
    // The buckets partition the in-scope rows exactly. A question that was
    // not attempted is neither a failure nor a decline: counting it as an
    // error says the benchmark broke, which is a different claim from "this
    // question could not be scored over this corpus".
    const suiteKey = await seedSuiteWithADriftedQuestion();
    const doc = await runTheSuite(suiteKey);
    const summary = doc.payload.summary;
    expect(summary.n_errors).toBe(0);
    expect(summary.n_skipped).toBe(1);
    // The buckets still partition the population exactly.
    expect(summary.n_errors + summary.n_skipped + summary.n_abstained + summary.n_failed + summary.n_answered).toBe(
      summary.n_evaluable
    );
  });

  it('the progress denominator covers EVERY question — the bar cannot pass 100%', async () => {
    const suiteKey = await seedSuiteWithADriftedQuestion();
    // The direct leg, so the progress reports are observed as they happen.
    await __mockDb.collection('okf_head_test_runs').save({
      _key: 'run-progress',
      repo_id: 'r-agri',
      kind: 'ragas_run',
      status: 'running',
      suite_key: suiteKey,
      run_key: 'run-progress',
      created_at: '2026-11-23T00:00:00.000Z'
    });
    const reports = [];
    await svc.runSuite('r-agri', suiteKey, {
      runKey: 'run-progress',
      mode: 'whatif',
      metrics: METRICS,
      actor: { user_id: 'u1' },
      carrier: CARRIER,
      keys: KEYS,
      reportProgress: async (p) => {
        reports.push(p);
      }
    });
    const retrieval = reports.filter((r) => r.phase === 'retrieval');
    expect(retrieval.length).toBeGreaterThan(0);
    for (const r of retrieval) {
      // Both questions are in the run's scope, so both are in the denominator
      // — a skipped question is not attempted, but it IS part of the coverage.
      expect(r.total).toBe(2);
      expect(r.done).toBeLessThanOrEqual(r.total);
    }
  });

  it('a run in which EVERY question was skipped says NOTHING MEASURED — not "every answer failed"', async () => {
    // A suite whose only question was minted from a repository that left
    // the carrier: nothing was attempted, nothing failed, and the envelope
    // must say so — "every answer failed" would point the operator at a
    // pipeline that worked perfectly.
    const begun = await svc.beginSuiteGeneration('r-agri', { testset_size: 2 }, { actor: { user_id: 'u1' } });
    const suite = await begun.done;
    const entries = suite.payload.entries.map((e) => ({ ...e, source_repo_id: 'r-gone' }));
    await __mockDb.collection('okf_head_test_runs').replace(begun.suite_key, {
      ...suite,
      payload: { ...suite.payload, entries, context: SUITE_CONTEXT }
    });
    const run = await svc.beginRunSuite(
      'r-agri',
      begun.suite_key,
      { mode: 'whatif', metrics: METRICS },
      { actor: { user_id: 'u1' }, carrier: CARRIER, keys: KEYS }
    );
    await run.done;
    const doc = await svc.getRunSuite('r-agri', begun.suite_key, run.run_key);
    expect(doc.error.code).toBe('NOTHING_MEASURED');
    // A row that was not attempted is not a failed row.
    expect(doc.error.failed_rows).toBe(0);
  });

  it('a suite minted for ANOTHER context is REFUSED (a cross-context run is not comparable)', async () => {
    const begun = await svc.beginSuiteGeneration('r-agri', { testset_size: 2 }, { actor: { user_id: 'u1' } });
    const suite = await begun.done;
    await __mockDb.collection('okf_head_test_runs').replace(begun.suite_key, {
      ...suite,
      payload: {
        ...suite.payload,
        context: { ...SUITE_CONTEXT, id: 'ctx-2', name: 'group-b' }
      }
    });
    await expect(
      svc.runSuite('r-agri', begun.suite_key, {
        mode: 'whatif',
        metrics: METRICS,
        actor: { user_id: 'u1' },
        carrier: CARRIER,
        keys: KEYS
      })
    ).rejects.toMatchObject({ code: 'CROSS_CONTEXT_BLOCKED', status: 409 });
  });
});
