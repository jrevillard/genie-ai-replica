// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 8-6 — the recorded candidate pool must be the pool the run searched.
//
// The retrieval leg fetches OKF_RAGAS_CANDIDATE_K dense candidates per graph
// and reranks that union down to the reranker's top-N. The evidence ladder
// later asks, per failing row: "was the passage in the DENSE pool, or only
// in the corpus?" — and it answers that by looking the carrier's key up in
// the run's recorded candidate_keys.
//
// The recorded pool used to be a hardcoded top-24 slice of a pool whose size
// is OKF_RAGAS_CANDIDATE_K. At the default (24) the two coincided, so the
// live evidence was right. Raise the knob — which is exactly what the
// advisor recommends when a row is lost at the vector-recall stage — and the
// run searches K chunks while RECORDING 24, so the ladder asks the wrong
// question: a carrier at rank 28 of a 192-pool is reported as never having
// been retrieved, and the advice looks as if it did not work.
//
// These tests set OKF_RAGAS_CANDIDATE_K before the module load (the constant
// is read at import time) and drive a corpus larger than the old hardcoded
// slice, so the truncation is observable.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
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
jest.mock('../services/head-test-service', () => ({
  routingTest: jest.fn(),
  guardSuggestions: jest.fn()
}));

process.env.OKF_RAGAS_JOB_POLL_MS = '5';
process.env.OKF_RAGAS_LONG_TIMEOUT_MS = '1';
process.env.OKF_RAGAS_SUBMIT_RETRY_DELAYS_MS = '1,1,1';
// A non-default pool size — the whole point of this file. The old code
// truncated the recorded pool to 24 whatever this says.
process.env.OKF_RAGAS_CANDIDATE_K = '64';

const svc = require('../services/ragas-suite-service');
const frontmatterService = require('../services/frontmatter-service');
const repositoryService = require('../services/repository-service');
const { __mockDb } = require('../shared-lib/db-connection-service');

const POOL_SIZE = 30; // > 24 — the old hardcoded slice

const GEN_SAMPLES = [
  {
    user_input: 'What seasons apply to tomato planting?',
    reference: 'Tomatoes are planted after the last frost.',
    reference_contexts: ['Plant after the last frost date.'],
    persona_name: 'agronomist',
    query_style: 'web-search',
    query_length: 'short',
    synthesizer_name: 'single_hop_specific'
  },
  {
    user_input: 'Compare tomato and legal aid eligibility',
    reference: 'Both topics are covered by their own repositories.',
    reference_contexts: ['Tomatoes are a crop.', 'Legal aid has income criteria.'],
    persona_name: 'policy analyst',
    query_style: 'chat',
    query_length: 'medium',
    synthesizer_name: 'multi_hop_specific'
  }
];

function okJson(payload) {
  return { ok: true, json: async () => payload, arrayBuffer: async () => new ArrayBuffer(8) };
}
function llmResponse(obj) {
  return { data: { choices: [{ message: { content: JSON.stringify(obj) } }] } };
}

beforeEach(() => {
  jest.clearAllMocks();
  __mockDb._reset();
  process.env.OKF_RERANK_ENDPOINT = 'http://rerank.test/rerank';
  delete process.env.OKF_RERANK_TOKEN;
  // A dense pool bigger than the old hardcoded 24.
  __mockDb.__corpusRows = Array.from({ length: POOL_SIZE }, (_, i) => ({
    key: `c${i + 1}`,
    text: `Chunk ${i + 1} about plants and frost dates.`,
    score: 1 - i / 100
  }));
  // The mock's default query answers [] — install the dispatcher the
  // service needs (graph names + the corpus shapes).
  __mockDb.query.mockImplementation(async (aql, bind) => {
    const corpus = __mockDb.__corpusRows || [];
    if (aql.includes('okf_concepts_meta')) return { all: async () => ['GRAPH_AGRI'] };
    if (aql.includes('_SOURCE')) {
      if (aql.includes('COLLECT WITH COUNT')) return { all: async () => [corpus.length] };
      if (aql.includes('LET hits =')) {
        const probes = (bind && bind.probes) || [];
        const hits = corpus
          .map((c) => {
            const lc = String(c.text || '').toLowerCase();
            const h = probes.filter((p) => lc.includes(p.needle)).map((p) => p.pid);
            return h.length ? { key: c.key, text: c.text, hits: h } : null;
          })
          .filter(Boolean);
        return { all: async () => hits };
      }
      if (aql.includes('c._key IN @keys')) {
        const keys = (bind && bind.keys) || [];
        return { all: async () => corpus.filter((c) => keys.includes(c.key)) };
      }
      return { all: async () => corpus };
    }
    return { all: async () => [] };
  });
  repositoryService.getById.mockImplementation(async (rid) => ({
    _key: rid,
    repo_id: rid,
    name: rid === 'me' ? 'Agri' : 'Legal',
    version: 3,
    head: { version: 42 }
  }));
  frontmatterService.teiEmbed.mockResolvedValue([[0.1, 0.2, 0.3]]);
  frontmatterService.vllmChatCompletions.mockResolvedValue(
    llmResponse({ answer: 'A grounded answer.', abstained: false })
  );
  global.fetch = jest.fn((url) => {
    const u = String(url);
    if (u.includes('/rerank')) {
      return Promise.resolve(okJson(Array.from({ length: POOL_SIZE }, (_, i) => ({ index: i, score: 1 - i / 100 }))));
    }
    if (u.includes('/generate-testset'))
      return Promise.resolve(okJson({ job_id: 'j-gen', status: 'queued', poll: '/jobs/j-gen' }));
    if (u.includes('/evaluate')) return Promise.resolve(okJson({ job_id: 'j-eval', status: 'queued' }));
    if (u.includes('/jobs/j-gen'))
      return Promise.resolve(
        okJson({
          job_id: 'j-gen',
          kind: 'generate-testset',
          status: 'done',
          result: { samples: GEN_SAMPLES, generator: { model: 'm', embed_model: 'e' } }
        })
      );
    if (u.includes('/jobs/j-eval'))
      return Promise.resolve(
        okJson({
          job_id: 'j-eval',
          kind: 'evaluate',
          status: 'done',
          result: {
            aggregate: { faithfulness: 1.0 },
            per_query: GEN_SAMPLES.map(() => ({
              faithfulness: 1.0,
              context_precision: 0.5,
              context_recall: 0.5,
              answer_relevancy: 1.0
            })),
            evaluation_log: []
          }
        })
      );
    if (u.includes('/xlsx/')) return Promise.resolve(okJson({}));
    return Promise.reject(new Error(`unexpected fetch ${u}`));
  });
});

describe('recorded candidate pool', () => {
  async function runOnce() {
    const begun = await svc.beginSuiteGeneration('me', { testset_size: 2 }, { actor: { user_id: 'u1' } });
    await begun.done;
    const sk = begun.suite_key;
    const run = await svc.beginRunSuite('me', sk, {}, { actor: { user_id: 'u1' } });
    await run.done;
    return svc.getRunSuite('me', sk, run.run_key);
  }

  it('records the WHOLE dense pool, not a hardcoded 24', async () => {
    const doc = await runOnce();
    const r0 = doc.payload.results[0];
    expect(r0.candidate_keys).toHaveLength(POOL_SIZE);
    expect(r0.candidate_keys).not.toHaveLength(24);
    // The first key is the top dense hit and the last is the deepest one
    // the pool reached — the recorded set is the pool, end to end.
    expect(r0.candidate_keys[0]).toBe('c1');
    expect(r0.candidate_keys[POOL_SIZE - 1]).toBe(`c${POOL_SIZE}`);
  });

  it('the fidelity block agrees with the recorded pool', async () => {
    const doc = await runOnce();
    // The run tells the reader which pool size it used; the evidence must
    // be collected against that same pool.
    expect(doc.payload.fidelity.retrieval.candidate_k).toBe(64);
    expect(doc.payload.results[0].candidate_keys.length).toBeLessThanOrEqual(
      doc.payload.fidelity.retrieval.candidate_k
    );
  });

  it('the ladder finds a carrier that sits past position 24', async () => {
    const doc = await runOnce();
    const r0 = doc.payload.results[0];
    // c30 is in the pool — a ladder asking "was it in the dense pool?"
    // against the recorded set must say yes for it.
    expect(r0.candidate_keys).toContain('c30');
  });
});
