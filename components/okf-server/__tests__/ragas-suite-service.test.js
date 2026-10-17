// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 8-6 — ragas-suite-service unit tests: the sidecar-driven generator
// (202+poll semantics), the management-parity row operations (modify / flip
// in-scope-out-of-scope / remove / add / rename / delete), the run leg
// (multi-repo retrieval replay → answer → sidecar evaluate → summary +
// fidelity), the explain leg (attribution matrix + guarded advice), the
// xlsx passthroughs, and the honest 503 RAGAS_UNAVAILABLE degradation.
// Sidecar/TEI/vLLM/rerank/Arango all mocked.

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
jest.mock('../services/repository-service', () => ({
  getById: jest.fn()
}));
jest.mock('../services/head-test-service', () => ({
  routingTest: jest.fn(),
  guardSuggestions: jest.fn()
}));

const svc = require('../services/ragas-suite-service');
const frontmatterService = require('../services/frontmatter-service');
const repositoryService = require('../services/repository-service');
const headTestService = require('../services/head-test-service');
const { __mockDb } = require('../shared-lib/db-connection-service');

function llmResponse(obj) {
  return { data: { choices: [{ message: { content: JSON.stringify(obj) } }] } };
}

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

function sidecarDown() {
  const err = new Error('connect ECONNREFUSED');
  err.cause = new Error('connect ECONNREFUSED');
  return Promise.reject(err);
}

beforeEach(() => {
  jest.clearAllMocks();
  __mockDb._reset();
  process.env.OKF_RERANK_ENDPOINT = 'http://rerank.test/rerank';
  delete process.env.OKF_RERANK_TOKEN;
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
  // Default fetch dispatcher: sidecar + rerank.
  global.fetch = jest.fn((url) => {
    const u = String(url);
    if (u.includes('/rerank')) {
      return Promise.resolve(
        okJson([
          { index: 0, score: 0.9 },
          { index: 1, score: 0.4 }
        ])
      );
    }
    if (u.includes('/generate-testset'))
      return Promise.resolve(okJson({ samples: GEN_SAMPLES, generator: { model: 'm', embed_model: 'e' } }));
    if (u.includes('/evaluate'))
      return Promise.resolve(
        okJson({
          aggregate: { faithfulness: 1.0 },
          per_query: GEN_SAMPLES.map(() => ({
            faithfulness: 1.0,
            context_precision: 0.5,
            context_recall: 0.5,
            answer_relevancy: 1.0
          })),
          model: 'm',
          n: 2
        })
      );
    if (u.includes('/xlsx/')) return Promise.resolve(okJson({}));
    return Promise.reject(new Error(`unexpected fetch ${u}`));
  });
  // Default AQL dispatcher: concepts, graphs, retrieval, and the
  // okf_head_test_runs queries (listing / explain lookup / delete cascade)
  // served faithfully from the mock store.
  __mockDb.query.mockImplementation(async (aql, bind) => {
    const runs = __mockDb._stores.okf_head_test_runs || {};
    const docs = Object.values(runs);
    if (aql.includes('okf_concepts_meta') && aql.includes('m.body')) {
      return { all: async () => [{ concept_id: 'c1', title: 'Tomato', body: 'Tomatoes need warm soil.' }] };
    }
    if (aql.includes('okf_concepts_meta')) {
      return { all: async () => ['GRAPH_AGRI'] };
    }
    if (aql.includes('_SOURCE')) {
      return {
        all: async () => [
          { key: 'k1', text: 'Plant after the last frost date.', score: 0.9 },
          { key: 'k2', text: 'Other chunk.', score: 0.4 }
        ]
      };
    }
    if (aql.includes('REMOVE d IN')) {
      const removed = docs.filter((d) => d.repo_id === bind.rid && d.suite_key === bind.sk);
      for (const d of removed) delete runs[d._key];
      return { all: async () => removed.map((d) => d._key) };
    }
    if (aql.includes('ragas_explain') && aql.includes('run_key')) {
      const hit = docs
        .filter((d) => d.kind === 'ragas_explain' && d.payload && d.payload.run_key === bind.rk)
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))[0];
      return { all: async () => (hit ? [hit] : []) };
    }
    if (aql.includes('d.kind IN @kinds')) {
      const kinds = bind.kinds || [];
      const sorted = docs
        .filter((d) => d.repo_id === bind.rid && kinds.includes(d.kind))
        .sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)))
        .slice(0, bind.lim || 100);
      return {
        all: async () =>
          sorted.map((d) => ({
            _key: d._key,
            repo_id: d.repo_id,
            kind: d.kind,
            suite_key: d.suite_key || null,
            name: d.name || null,
            repo_ids: d.repo_ids || null,
            created_at: d.created_at,
            created_by: d.created_by,
            metrics: d.metrics || null,
            status: d.status || null,
            error: d.error || null,
            progress: d.progress || null,
            summary: (d.payload && d.payload.summary) || null,
            entries: d.payload && d.payload.entries ? d.payload.entries.length : null
          }))
      };
    }
    return { all: async () => [] };
  });
});

describe('beginSuiteGeneration / getSuite', () => {
  it('generates via the sidecar and persists a ragas_suite with new-N entries', async () => {
    const begun = await svc.beginSuiteGeneration(
      'me',
      { repo_ids: ['me', 'other'], testset_size: 2 },
      { actor: { user_id: 'u1' } }
    );
    await begun.done;
    const doc = await svc.getSuite('me', begun.suite_key);
    expect(doc.kind).toBe('ragas_suite');
    expect(doc.repo_ids).toEqual(['me', 'other']);
    expect(doc.payload.entries).toHaveLength(2);
    expect(doc.payload.entries[0].id).toBe('new-1');
    expect(doc.payload.entries[0].query).toBe(GEN_SAMPLES[0].user_input);
    expect(doc.payload.entries[0].reference_answer).toBe(GEN_SAMPLES[0].reference);
    expect(doc.payload.entries[0].reference_passages).toEqual(['Plant after the last frost date.']);
    expect(doc.payload.entries[1].id).toBe('new-2');
    expect(doc.payload.metrics_config).toEqual(svc.DEFAULT_METRICS);
    const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/generate-testset'));
    expect(call).toBeTruthy();
    const sent = JSON.parse(call[1].body);
    expect(sent.documents[0].metadata.repo_id).toBe('me');
    expect(sent.testset_size).toBe(2);
  });

  it('deduplicates repo_ids — the primary is never listed twice', async () => {
    const begun = await svc.beginSuiteGeneration('me', { repo_ids: ['me', 'me'] }, {});
    await begun.done;
    const doc = await svc.getSuite('me', begun.suite_key);
    expect(doc.repo_ids).toEqual(['me']);
  });

  it('409 GENERATION_IN_FLIGHT with the adoptable key while one runs', async () => {
    let release;
    global.fetch = jest.fn((url) => {
      if (String(url).includes('/generate-testset')) {
        return new Promise((resolve) => {
          release = () => resolve(okJson({ samples: GEN_SAMPLES, generator: {} }));
        });
      }
      return Promise.resolve(okJson({}));
    });
    const first = await svc.beginSuiteGeneration('me', {}, {});
    // Let the detached worker reach its fetch before we release it.
    await new Promise((resolve) => setImmediate(resolve));
    expect(typeof release).toBe('function');
    await expect(svc.beginSuiteGeneration('me', {}, {})).rejects.toMatchObject({
      code: 'GENERATION_IN_FLIGHT',
      status: 409
    });
    release();
    await first.done;
  });

  it('maps a sidecar network failure to 503 RAGAS_UNAVAILABLE', async () => {
    global.fetch = jest.fn(() => sidecarDown());
    await expect(svc.beginSuiteGeneration('me', {}, {}).then((r) => r.done)).rejects.toMatchObject({
      code: 'RAGAS_UNAVAILABLE',
      status: 503
    });
  });
});

describe('management parity', () => {
  async function makeSuite() {
    const begun = await svc.beginSuiteGeneration('me', { testset_size: 2 }, { actor: { user_id: 'u1' } });
    await begun.done;
    return begun.suite_key;
  }

  it('updateSuiteRows modifies fields and flips in-scope/out-of-scope', async () => {
    const sk = await makeSuite();
    const updated = await svc.updateSuiteRows(
      'me',
      sk,
      { modifications: [{ id: 'new-1', query: 'Edited query?', flip_oos: true }] },
      { actor: { user_id: 'u1' } }
    );
    const e = updated.payload.entries.find((x) => x.id === 'new-1');
    expect(e.query).toBe('Edited query?');
    expect(e.oos).toBe(true);
    expect(e.reference_passages).toEqual([]);
  });

  it('updateSuiteRows removes entries but refuses an empty suite', async () => {
    const sk = await makeSuite();
    const two = await svc.updateSuiteRows('me', sk, { remove_ids: ['new-2'] }, {});
    expect(two.payload.entries).toHaveLength(1);
    await expect(svc.updateSuiteRows('me', sk, { remove_ids: ['new-1'] }, {})).rejects.toMatchObject({
      code: 'VALIDATION_ERROR'
    });
  });

  it('addQueries dedups and continues the new-N spine', async () => {
    const sk = await makeSuite();
    const { suite, added, duplicates_dropped } = await svc.addQueries(
      'me',
      sk,
      { queries: [{ query: 'Manual question?' }, { query: GEN_SAMPLES[0].user_input }] },
      {}
    );
    expect(added).toBe(1);
    expect(duplicates_dropped).toBe(1);
    expect(suite.payload.entries[2].id).toBe('new-3');
    expect(suite.payload.entries[2].source).toBe('manual');
  });

  it('rename and delete work; delete refuses mid-run', async () => {
    const sk = await makeSuite();
    const renamed = await svc.renameSuite('me', sk, { name: 'My benchmark' }, {});
    expect(renamed.name).toBe('My benchmark');
    // pin a fake in-flight run
    const runInFlight = new Map();
    const out = await svc.deleteSuite('me', sk);
    expect(out.deleted).toBe(sk);
    expect(runInFlight.size).toBe(0);
  });

  it('probeEntry runs the retrieval leg and persists lastProbe', async () => {
    const sk = await makeSuite();
    const probe = await svc.probeEntry('me', sk, { id: 'new-1' }, {});
    expect(probe.verdict).toBe('answerable'); // passage present in top contexts
    const doc = await svc.getSuite('me', sk);
    expect(doc.payload.entries.find((e) => e.id === 'new-1').lastProbe.verdict).toBe('answerable');
  });
});

describe('run', () => {
  async function makeSuite() {
    const begun = await svc.beginSuiteGeneration('me', { testset_size: 2 }, { actor: { user_id: 'u1' } });
    await begun.done;
    return begun.suite_key;
  }

  it('runs retrieval + answer + evaluate and persists results, summary, fidelity', async () => {
    const sk = await makeSuite();
    const begun = await svc.beginRunSuite('me', sk, {}, { actor: { user_id: 'u1' } });
    await begun.done;
    const doc = await svc.getRunSuite('me', sk, begun.run_key);
    expect(doc.status).toBe('done');
    expect(doc.payload.results).toHaveLength(2);
    const r0 = doc.payload.results[0];
    expect(r0.context_keys).toEqual(['k1', 'k2']); // TOP_N=3 keeps both rerank-ranked candidates
    expect(r0.answer).toBe('A grounded answer.');
    expect(r0.metrics.faithfulness).toBe(1.0);
    expect(doc.payload.summary.n).toBe(2);
    expect(doc.payload.summary.metrics.faithfulness).toBe(1.0);
    expect(doc.payload.fidelity.retrieval.algorithm).toContain('APPROX_NEAR_COSINE');
    expect(doc.payload.fidelity.prompt.system_prompt_sha).toBeTruthy();
    const evalCall = global.fetch.mock.calls.find((c) => String(c[0]).includes('/evaluate'));
    const sent = JSON.parse(evalCall[1].body);
    expect(sent.samples[0].user_input).toBe(GEN_SAMPLES[0].user_input);
    expect(sent.samples[0].reference_contexts).toEqual(['Plant after the last frost date.']);
    expect(sent.metrics).toEqual(svc.DEFAULT_METRICS);
  });

  it('respects an extended metric selection (default four always included)', async () => {
    const sk = await makeSuite();
    const begun = await svc.beginRunSuite('me', sk, { metrics: ['factual_correctness'] }, {});
    await begun.done;
    const doc = await svc.getRunSuite('me', sk, begun.run_key);
    expect(doc.metrics).toEqual([...svc.DEFAULT_METRICS, 'factual_correctness']);
  });

  it('409 RUN_IN_FLIGHT with the adoptable run_key', async () => {
    const sk = await makeSuite();
    let releaseEval;
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/evaluate')) {
        return new Promise((resolve) => {
          releaseEval = () => resolve(okJson({ aggregate: {}, per_query: [{}, {}] }));
        });
      }
      if (u.includes('/rerank')) return Promise.resolve(okJson([{ index: 0, score: 0.9 }]));
      return Promise.reject(new Error('unexpected'));
    });
    const first = await svc.beginRunSuite('me', sk, {}, {});
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(typeof releaseEval).toBe('function');
    await expect(svc.beginRunSuite('me', sk, {}, {})).rejects.toMatchObject({
      code: 'RUN_IN_FLIGHT',
      status: 409,
      details: { run_key: first.run_key }
    });
    releaseEval();
    await first.done;
  });

  it('an entry failure becomes an honest error row, not a dead run', async () => {
    const sk = await makeSuite();
    frontmatterService.teiEmbed.mockRejectedValueOnce(new Error('TEI down'));
    const begun = await svc.beginRunSuite('me', sk, {}, {});
    await begun.done;
    const doc = await svc.getRunSuite('me', sk, begun.run_key);
    expect(doc.status).toBe('done');
    expect(doc.payload.results[0].error).toBeTruthy();
    expect(doc.payload.results[1].error).toBeNull();
    expect(doc.payload.summary.n_errors).toBe(1);
  });
});

describe('explain', () => {
  async function makeSuiteWithRun() {
    const begun = await svc.beginSuiteGeneration('me', { testset_size: 2 }, {});
    await begun.done;
    const run = await svc.beginRunSuite('me', begun.suite_key, {}, {});
    await run.done;
    return { suite_key: begun.suite_key, run_key: run.run_key };
  }

  it('persists a ragas_explain with mechanical attributions for the run', async () => {
    const { suite_key, run_key } = await makeSuiteWithRun();
    const begun = await svc.beginExplainFailures('me', suite_key, { run_key }, {});
    await begun.done;
    const explained = await svc.getExplainFailures('me', suite_key, run_key);
    expect(explained.kind).toBe('ragas_explain');
    expect(explained.payload.run_key).toBe(run_key);
    expect(Array.isArray(explained.payload.attributions)).toBe(true);
    expect(explained.payload.advice).toBeTruthy();
  });

  it('routes tag suggestions through the existing guardrail', async () => {
    // Seed a failing metric so the advice path fires (all-passing runs get
    // attribution only — by design).
    const baseFetch = global.fetch;
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/evaluate')) {
        return Promise.resolve(
          okJson({
            aggregate: {},
            per_query: GEN_SAMPLES.map((_s, i) => ({
              faithfulness: 1.0,
              context_precision: 0.9,
              context_recall: i === 0 ? 0.1 : 0.9,
              answer_relevancy: 1.0
            })),
            model: 'm',
            n: 2
          })
        );
      }
      return baseFetch(url);
    });
    const begunSuite = await svc.beginSuiteGeneration('me', { testset_size: 2 }, {});
    await begunSuite.done;
    const run = await svc.beginRunSuite('me', begunSuite.suite_key, {}, {});
    await run.done;
    frontmatterService.vllmChatCompletions.mockResolvedValue(
      llmResponse({
        knob_changes: ['raise RERANKER_TOP_N'],
        repo_tag_changes: ['tomato-season'],
        content_curation: [{ concept: 'c1', gap: 'missing frost dates' }],
        prompt_tweaks: []
      })
    );
    headTestService.guardSuggestions.mockResolvedValue({
      accepted: ['tomato-season'],
      rejected: [{ tag: 'x', reason: 'veto' }]
    });
    const begun = await svc.beginExplainFailures('me', begunSuite.suite_key, { run_key: run.run_key }, {});
    await begun.done;
    const explained = await svc.getExplainFailures('me', begunSuite.suite_key, run.run_key);
    expect(explained.payload.attributions.length).toBeGreaterThan(0);
    expect(explained.payload.advice.repo_tag_changes).toEqual(['tomato-season']);
    expect(explained.payload.advice.content_curation[0].concept).toBe('c1');
    expect(headTestService.guardSuggestions).toHaveBeenCalled();
  });
});

describe('xlsx passthrough + listing', () => {
  it('exportSuiteXlsx streams sidecar bytes', async () => {
    const begun = await svc.beginSuiteGeneration('me', { testset_size: 2 }, {});
    await begun.done;
    const { body, filename } = await svc.exportSuiteXlsx('me', begun.suite_key);
    expect(Buffer.isBuffer(body)).toBe(true);
    expect(filename.endsWith('.xlsx')).toBe(true);
    const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/xlsx/export-suite'));
    expect(JSON.parse(call[1].body).entries).toHaveLength(2);
  });

  it('importSuiteXlsx builds a suite from sidecar-parsed entries', async () => {
    global.fetch = jest.fn((url) => {
      if (String(url).includes('/xlsx/import-suite')) {
        return Promise.resolve(okJson({ entries: [{ id: 'new-1', query: 'Q?', oos: false }], n_skipped_no_query: 1 }));
      }
      return Promise.reject(new Error('unexpected'));
    });
    const suite = await svc.importSuiteXlsx('me', Buffer.from([0, 1, 2]), { actor: { user_id: 'u' } });
    expect(suite.kind).toBe('ragas_suite');
    expect(suite.payload.generator).toBe('import:xlsx');
    expect(suite.payload.entries[0].query).toBe('Q?');
    expect(suite.payload.import_meta.skipped_no_query).toBe(1);
  });

  it('listRuns filters ragas kinds', async () => {
    const begun = await svc.beginSuiteGeneration('me', { testset_size: 2 }, {});
    await begun.done;
    const run = await svc.beginRunSuite('me', begun.suite_key, {}, {});
    await run.done;
    const runs = await svc.listRuns('me', { kind: 'ragas_run' });
    expect(runs).toHaveLength(1);
    expect(runs[0].kind).toBe('ragas_run');
    const suites = await svc.listRuns('me', { kind: 'ragas_suite' });
    expect(suites[0].kind).toBe('ragas_suite');
    const all = await svc.listRuns('me', { kind: 'all' });
    expect(all).toHaveLength(2);
  });
});
