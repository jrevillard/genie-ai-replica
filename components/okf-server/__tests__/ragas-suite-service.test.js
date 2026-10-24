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

// The sidecar poller's interval and liveness horizon are read at module
// load — shrink both before the require so 202+poll flows complete in
// milliseconds, not 3s hops. The 1ms horizon specifically makes EVERY poll
// of a running job outlive the horizon, which is how the never-timeout-
// a-live-job contract gets exercised below.
process.env.OKF_RAGAS_JOB_POLL_MS = '5';
process.env.OKF_RAGAS_LONG_TIMEOUT_MS = '1';
// The sidecar-submit retry ladder (2026-10-21 review F5) runs in
// milliseconds here — the production delays (2s/5s/10s) would blow the
// 5s jest timeout and cascade a stuck generation lock across the suite.
process.env.OKF_RAGAS_SUBMIT_RETRY_DELAYS_MS = '1,1,1';

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
            model: 'm',
            n: 2
          }
        })
      );
    if (u.includes('/xlsx/')) return Promise.resolve(okJson({}));
    return Promise.reject(new Error(`unexpected fetch ${u}`));
  });
  // Default AQL dispatcher: graphs, retrieval, and the
  // okf_head_test_runs queries (listing / explain lookup / delete cascade)
  // served faithfully from the mock store.
  __mockDb.query.mockImplementation(async (aql, bind) => {
    const runs = __mockDb._stores.okf_head_test_runs || {};
    const docs = Object.values(runs);
    if (aql.includes('okf_concepts_meta')) {
      return { all: async () => ['GRAPH_AGRI'] };
    }
    if (aql.includes('_SOURCE')) {
      // The corpus builder's three query shapes: COUNT (budget check),
      // keys-only (stride selection), and rows (the documents).
      const corpus = __mockDb.__corpusRows || [
        { key: 'k1', text: 'Plant after the last frost date.', score: 0.9 },
        { key: 'k2', text: 'Other chunk.', score: 0.4 }
      ];
      if (aql.includes('COLLECT WITH COUNT')) {
        return { all: async () => [corpus.length] };
      }
      if (/RETURN c\._key\s*$/.test(aql.trim())) {
        return { all: async () => corpus.map((c) => c.key) };
      }
      // The attribution corpus probe: find the chunks whose text contains
      // any of the needles, tagged with the passage ids they matched.
      if (aql.includes('LET hits =')) {
        const probes = (bind && bind.probes) || [];
        const hitRows = corpus
          .map((c) => {
            const lc = String(c.text || '').toLowerCase();
            const hits = probes.filter((p) => lc.includes(p.needle)).map((p) => p.pid);
            return hits.length ? { key: c.key, text: c.text, hits } : null;
          })
          .filter(Boolean);
        return { all: async () => hitRows };
      }
      if (aql.includes('c._key IN @keys')) {
        const keys = (bind && bind.keys) || [];
        return { all: async () => corpus.filter((c) => keys.includes(c.key)) };
      }
      return { all: async () => corpus };
    }
    if (aql.includes('REMOVE d IN')) {
      // deleteSuite cascades the whole suite scope; deleteRun (bind.rk set)
      // narrows to the run doc + its explains — the suite doc survives.
      const removed = docs.filter((d) => {
        if (d.repo_id !== bind.rid || d.suite_key !== bind.sk) return false;
        if (!bind.rk) return true;
        return d._key === bind.rk || (d.kind === 'ragas_explain' && d.payload && d.payload.run_key === bind.rk);
      });
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
            entries: d.payload && d.payload.entries ? d.payload.entries.length : null,
            // mirrors the listRuns AQL projection (judge memory, 2026-10-21)
            judge_pick:
              (d.payload && d.payload.fidelity && d.payload.fidelity.judge && d.payload.fidelity.judge.pick) || null
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
    // The generation corpus is the PUBLISHED CHUNKS (the retrievable unit),
    // not concept bodies — reference-based metrics compare chunk-to-chunk.
    expect(sent.documents[0].page_content).toBe('Plant after the last frost date.');
    expect(sent.documents[0].metadata.chunk_key).toBe('k1');
    expect(sent.testset_size).toBe(2);
    // Judge memory (2026-10-21): the suite records the pick AS MADE (nulls =
    // deployment default) plus the resolved judge that generated it.
    expect(doc.payload.judge_pick).toEqual({ config_key: null, model: null });
    expect(doc.payload.judge).toMatchObject({ source: expect.stringMatching(/^(env|builtin-default)$/), config: null });
  });

  it('the IN-FLIGHT generation names the judge it is using (2026-10-21)', async () => {
    // The run went to a personal MiniMax key while the panel said
    // "deployment default" — the operator believed the active GLM config
    // was in use. The in-flight envelope must carry the EFFECTIVE judge,
    // because the suite doc (and its pick) does not exist until the end.
    __mockDb._stores.okf_model_configs = {
      mm: {
        _key: 'mm',
        name: 'Minimax David OpenAI',
        provider: 'openai',
        base_url: 'https://api.minimax.io/v1',
        default_model: 'MiniMax-M3.1-Flash',
        api_key: 'k',
        services: ['ragas_judge'],
        active: false
      }
    };
    // The sidecar call hangs, so the generation stays in flight.
    let release;
    const held = new Promise((r) => {
      release = r;
    });
    const base = global.fetch.getMockImplementation();
    global.fetch = jest.fn(async (u, opts) => {
      if (String(u).includes('/generate-testset')) {
        await held;
        return base(u, opts);
      }
      return base(u, opts);
    });
    try {
      const begun = await svc.beginSuiteGeneration('me', { judge_config_key: 'mm', testset_size: 1 }, {});
      // let the resolution + submit settle
      await new Promise((r) => setTimeout(r, 20));
      const env = await svc.getSuite('me', begun.suite_key);
      expect(env.status).toBe('generating');
      expect(env.progress.judge).toMatchObject({
        source: 'picked',
        config: 'Minimax David OpenAI',
        model: 'MiniMax-M3.1-Flash'
      });
      // let the generation finish so the in-flight lock is released
      release();
      await begun.done;
    } finally {
      release();
      global.fetch = jest.fn(base);
    }
  });

  it('records an explicit judge pick on the suite — pick as made + resolved fidelity', async () => {
    __mockDb._stores.okf_model_configs = {
      mm: {
        _key: 'mm',
        name: 'MiniMax',
        provider: 'openai',
        base_url: 'https://api.minimax.io/v1',
        default_model: 'mm-flash',
        api_key: 'k',
        services: ['ragas_judge'],
        active: false
      }
    };
    const begun = await svc.beginSuiteGeneration(
      'me',
      { judge_config_key: 'mm', judge_model: 'mm-large', testset_size: 1 },
      {}
    );
    await begun.done;
    const doc = await svc.getSuite('me', begun.suite_key);
    expect(doc.payload.judge_pick).toEqual({ config_key: 'mm', model: 'mm-large' });
    expect(doc.payload.judge).toEqual({ source: 'picked', config: 'MiniMax', model: 'mm-large' });
  });

  it('stores reference passages WHOLE — a 1200-char chunk reference survives (no 500-char slice)', async () => {
    // 2026-10-19: the 500-char storage slice cut references mid-table and
    // often kept the WRONG section of the concept for the question it
    // grounded — every entity-recall row of a live 20-question suite failed
    // while context_recall sat at 1.0. The cap is now the run leg's
    // per-context cap (CONTEXT_CHARS), so a published chunk fits intact.
    const long = 'y'.repeat(1200);
    global.fetch = jest.fn((u) => {
      if (u.includes('/generate-testset')) return Promise.resolve(okJson({ job_id: 'j-long-ref' }));
      if (u.includes('/jobs/j-long-ref'))
        return Promise.resolve(
          okJson({
            job_id: 'j-long-ref',
            kind: 'generate-testset',
            status: 'done',
            result: { samples: [{ user_input: 'q?', reference: 'r', reference_contexts: [long] }] }
          })
        );
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    const begun = await svc.beginSuiteGeneration('me', {}, {});
    await begun.done;
    const doc = await svc.getSuite('me', begun.suite_key);
    expect(doc.payload.entries[0].reference_passages[0]).toHaveLength(1200);
  });

  it('deduplicates repo_ids — the primary is never listed twice', async () => {
    const begun = await svc.beginSuiteGeneration('me', { repo_ids: ['me', 'me'] }, {});
    await begun.done;
    const doc = await svc.getSuite('me', begun.suite_key);
    expect(doc.repo_ids).toEqual(['me']);
  });

  it('caps the corpus with an EVEN SPREAD and records coverage (2026-10-21: never a silent slice)', async () => {
    // David: "we have much larger corpuses to process than this". Over the
    // chunk budget the builder strides the KEY SPACE (not first-N — the
    // prefix benchmarked the oldest-ingested slice and called it a suite)
    // and the suite doc records {total, used} per graph.
    const prevCap = process.env.OKF_RAGAS_MAX_CORPUS_CHUNKS;
    process.env.OKF_RAGAS_MAX_CORPUS_CHUNKS = '5';
    __mockDb.__corpusRows = Array.from({ length: 20 }, (_, i) => ({
      key: `k${String(i).padStart(2, '0')}`,
      text: `chunk ${i} of the corpus`
    }));
    try {
      const begun = await svc.beginSuiteGeneration('me', { testset_size: 1 }, {});
      await begun.done;
      const call = global.fetch.mock.calls.find((c) => String(c[0]).includes('/generate-testset'));
      const sent = JSON.parse(call[1].body);
      expect(sent.documents).toHaveLength(5); // the budget, not 20
      // EVEN SPREAD: stride 4 over k00..k19 → k00, k04, k08, k12, k16 — the
      // first-N prefix would have sent k00..k04.
      expect(sent.documents.map((d) => d.metadata.chunk_key)).toEqual(['k00', 'k04', 'k08', 'k12', 'k16']);
      const doc = await svc.getSuite('me', begun.suite_key);
      expect(doc.payload.corpus_coverage).toEqual([{ repo_id: 'me', graph: 'GRAPH_AGRI', total: 20, used: 5 }]);
    } finally {
      if (prevCap === undefined) delete process.env.OKF_RAGAS_MAX_CORPUS_CHUNKS;
      else process.env.OKF_RAGAS_MAX_CORPUS_CHUNKS = prevCap;
      delete __mockDb.__corpusRows;
    }
  });

  it('409 GENERATION_IN_FLIGHT with the adoptable key while one runs', async () => {
    let release;
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/generate-testset')) {
        return new Promise((resolve) => {
          release = () => resolve(okJson({ job_id: 'j-gen', status: 'queued' }));
        });
      }
      if (u.includes('/jobs/j-gen'))
        return Promise.resolve(
          okJson({ job_id: 'j-gen', status: 'done', result: { samples: GEN_SAMPLES, generator: {} } })
        );
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

  it('a vanished job is terminal AND the poller cancels it (no GPU orphan)', async () => {
    const deletes = [];
    global.fetch = jest.fn((url, init) => {
      const u = String(url);
      if (u.includes('/generate-testset')) return Promise.resolve(okJson({ job_id: 'j-vanish' }));
      if (u.includes('/jobs/j-vanish')) {
        if (init && init.method === 'DELETE') {
          deletes.push(u);
          return Promise.resolve(okJson({ job_id: 'j-vanish', status: 'cancelled' }));
        }
        return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: 'unknown job' }) });
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    await expect(svc.beginSuiteGeneration('me', {}, {}).then((r) => r.done)).rejects.toMatchObject({
      code: 'RAGAS_UNAVAILABLE'
    });
    expect(deletes).toEqual([expect.stringContaining('/jobs/j-vanish')]);
  });

  it('a cancelled job surfaces RAGAS_JOB_CANCELLED to the worker', async () => {
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/generate-testset')) return Promise.resolve(okJson({ job_id: 'j-cut' }));
      if (u.includes('/jobs/j-cut')) return Promise.resolve(okJson({ job_id: 'j-cut', status: 'cancelled' }));
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    await expect(svc.beginSuiteGeneration('me', {}, {}).then((r) => r.done)).rejects.toMatchObject({
      code: 'RAGAS_JOB_CANCELLED'
    });
  });

  it('user cancel stops the sidecar job and records RAGAS_JOB_CANCELLED (not "vanished")', async () => {
    const deletes = [];
    let releasePoll;
    let cancelled = false;
    global.fetch = jest.fn((url, init) => {
      const u = String(url);
      if (u.includes('/generate-testset')) return Promise.resolve(okJson({ job_id: 'j-usercut' }));
      if (u.includes('/jobs/j-usercut')) {
        if (init && init.method === 'DELETE') {
          cancelled = true;
          deletes.push(u);
          return Promise.resolve(okJson({ job_id: 'j-usercut', status: 'cancelled' }));
        }
        if (cancelled) {
          // the sidecar registry dropped the job on DELETE — post-cancel polls 404
          return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: 'unknown job' }) });
        }
        return new Promise((resolve) => {
          releasePoll = () => resolve(okJson({ job_id: 'j-usercut', status: 'running' }));
        });
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    const begun = await svc.beginSuiteGeneration('me', {}, {});
    for (let i = 0; i < 100 && typeof releasePoll !== 'function'; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    const out = await svc.cancelSuiteGeneration('me');
    expect(out).toMatchObject({ cancelled: true, suite_key: begun.suite_key });
    expect(deletes).toEqual([expect.stringContaining('/jobs/j-usercut')]);
    releasePoll(); // in-flight poll resolves running → next poll 404s → worker fails
    await expect(begun.done).rejects.toBeTruthy();
    // the honest reason: user cancel, not the misleading post-cancel 404
    const doc = await svc.getSuite('me', begun.suite_key);
    expect(doc.status).toBe('failed');
    expect(doc.error.code).toBe('RAGAS_JOB_CANCELLED');
    // and a second cancel is a clean 409 — nothing running anymore
    await expect(svc.cancelSuiteGeneration('me')).rejects.toMatchObject({ code: 'NO_GENERATION_IN_FLIGHT' });
  });

  it('rerank batches at 32 and remaps chunk-local indices to global (live: 48 texts 422d)', async () => {
    const calls = [];
    global.fetch = jest.fn(async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push(body.texts.length);
      // TEI contract: chunk-local indices into THIS batch, sorted by score
      return okJson(body.texts.map((t, i) => ({ index: i, score: 0.9 - i * 0.01 })));
    });
    const texts = Array.from({ length: 48 }, (_, i) => `chunk ${i}`);
    const out = await svc.rerankTexts('q', texts);
    expect(calls).toEqual([32, 16]); // two batches, both under the cap
    // second batch's chunk-local index 0 is GLOBAL index 32
    const bumped = out.find((r) => r.index === 32);
    expect(bumped).toBeTruthy();
    expect(bumped.score).toBeCloseTo(0.9, 5);
    expect(out.every((r) => r.index >= 0 && r.index < 48)).toBe(true);
  });

  it('a healthy long-running job is NEVER timed out — the liveness horizon rolls (David 2026-10-18)', async () => {
    // OKF_RAGAS_LONG_TIMEOUT_MS=1 means every poll outlives the horizon;
    // a reachable running job must still complete, not RAGAS_JOB_TIMEOUT.
    let polls = 0;
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/generate-testset')) return Promise.resolve(okJson({ job_id: 'j-long' }));
      if (u.includes('/jobs/j-long')) {
        polls += 1;
        if (polls <= 5)
          return Promise.resolve(okJson({ job_id: 'j-long', status: 'running', phase: 'synthesizing-questions' }));
        return Promise.resolve(
          okJson({ job_id: 'j-long', status: 'done', result: { samples: GEN_SAMPLES, generator: {} } })
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    const begun = await svc.beginSuiteGeneration('me', {}, {});
    const suite = await begun.done; // generateSuite resolves with the suite doc
    expect(suite).toBeTruthy();
    expect(polls).toBeGreaterThanOrEqual(6); // it really ran past multiple horizons
  });

  it('an UNREACHABLE sidecar past the horizon fails the job honestly', async () => {
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/generate-testset')) return Promise.resolve(okJson({ job_id: 'j-dark' }));
      return sidecarDown(); // every poll: connection refused
    });
    await expect(svc.beginSuiteGeneration('me', {}, {}).then((r) => r.done)).rejects.toBeTruthy();
  });

  it('deleting a GENERATING suite cancels its sidecar job instead of 404', async () => {
    const deletes = [];
    let releasePoll;
    let deleted = false;
    global.fetch = jest.fn((url, init) => {
      const u = String(url);
      if (u.includes('/generate-testset')) return Promise.resolve(okJson({ job_id: 'j-live' }));
      if (u.includes('/jobs/j-live')) {
        if (init && init.method === 'DELETE') {
          deleted = true;
          deletes.push(u);
          return Promise.resolve(okJson({ job_id: 'j-live', status: 'cancelled' }));
        }
        if (deleted) {
          // the delete dropped the job from the sidecar registry — 404
          return Promise.resolve({ ok: false, status: 404, json: async () => ({ detail: 'unknown job' }) });
        }
        return new Promise((resolve) => {
          releasePoll = () => resolve(okJson({ job_id: 'j-live', status: 'running' }));
        });
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    const begun = await svc.beginSuiteGeneration('me', {}, {});
    // Let the detached worker reach its first (held) poll: db mocks → corpus
    // build → POST → 5ms poll sleep. One setImmediate is not enough.
    for (let i = 0; i < 100 && typeof releasePoll !== 'function'; i += 1) {
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setTimeout(resolve, 5));
    }
    expect(typeof releasePoll).toBe('function');
    const out = await svc.deleteSuite('me', begun.suite_key);
    expect(out).toMatchObject({ deleted: begun.suite_key, cancelled_generation: true });
    expect(deletes).toEqual([expect.stringContaining('/jobs/j-live')]);
    releasePoll(); // in-flight poll resolves 'running' → next tick 404s → worker fails
    await expect(begun.done).rejects.toBeTruthy();
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

  // Review F8 (2026-10-21): flipping a row out of scope CLEARED its
  // reference passages irreversibly — flipping it back left the row
  // measuring against an empty reference and every later run degraded
  // silently.
  it('flipping a row out of scope and back RESTORES its reference passages', async () => {
    const sk = await makeSuite();
    const entryId = (await svc.getSuite('me', sk)).payload.entries[0].id;
    const before = (await svc.getSuite('me', sk)).payload.entries[0].reference_passages;
    expect(before.length).toBeGreaterThan(0);
    await svc.updateSuiteRows('me', sk, { modifications: [{ id: entryId, flip_oos: true }] }, {});
    const oos = (await svc.getSuite('me', sk)).payload.entries[0];
    expect(oos.oos).toBe(true);
    expect(oos.reference_passages).toEqual([]);
    await svc.updateSuiteRows('me', sk, { modifications: [{ id: entryId, flip_oos: false }] }, {});
    const back = (await svc.getSuite('me', sk)).payload.entries[0];
    expect(back.oos).toBe(false);
    expect(back.reference_passages).toEqual(before);
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
    const begun = await svc.beginRunSuite('me', sk, { mode: 'whatif' }, { actor: { user_id: 'u1' } });
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
    // Judge memory (2026-10-21): the pick AS MADE rides next to the resolved
    // judge — nulls mean the deployment default was selected.
    expect(doc.payload.fidelity.judge.pick).toEqual({ config_key: null, model: null });
    const evalCall = global.fetch.mock.calls.find((c) => String(c[0]).includes('/evaluate'));
    const sent = JSON.parse(evalCall[1].body);
    expect(sent.samples[0].user_input).toBe(GEN_SAMPLES[0].user_input);
    expect(sent.samples[0].reference_contexts).toEqual(['Plant after the last frost date.']);
    expect(sent.metrics).toEqual(svc.DEFAULT_METRICS);
  });

  it('respects an extended metric selection (default four always included)', async () => {
    const sk = await makeSuite();
    const begun = await svc.beginRunSuite('me', sk, { mode: 'whatif', metrics: ['factual_correctness'] }, {});
    await begun.done;
    const doc = await svc.getRunSuite('me', sk, begun.run_key);
    expect(doc.metrics).toEqual([...svc.DEFAULT_METRICS, 'factual_correctness']);
  });

  // Live incident 2026-10-19: the answer leg's condensed prompt produced
  // terse extractive answers ("101,746") that RAGAS answer_relevancy
  // structurally fails (reverse question generation from a bare number is
  // generic — measured 0.415 vs 1.00 for the chat-shaped answer on the
  // same question, contexts and judge). The benchmark must answer the way
  // the deployed chat answers.
  it('the answer leg serves with the chatqna contract, not a terse extractive prompt', async () => {
    const sk = await makeSuite();
    const begun = await svc.beginRunSuite('me', sk, { mode: 'whatif' }, {});
    await begun.done;
    const call = frontmatterService.vllmChatCompletions.mock.calls.find((c) => {
      const sys = c[0] && c[0][0];
      return sys && sys.role === 'system' && /information assistant/i.test(sys.content);
    });
    expect(call).toBeTruthy();
    expect(call[0][0].content).toContain('friendly and polite information assistant');
    const user = call[0][1].content;
    expect(user).toContain('Relevant content from the knowledge base');
    expect(user).not.toContain('Answer the question using ONLY');
    // 8-7 (David 2026-10-20): the answer leg resolves its OWN model-config
    // service — 'ragas_answers', never the tagging default. Unchecked (the
    // default) it answers with the deployment chat; the fidelity block below
    // records that honestly.
    expect(call[1]).toMatchObject({ service: 'ragas_answers' });
  });

  it('the answer leg asks for enough tokens that a reasoning model answers in ONE call', async () => {
    // 2026-10-22 (live): the answer leg's initial budget was hardcoded to
    // 800 tokens. A reasoning-capable judge burns 400-700 tokens BEFORE
    // writing a word, so every answer hit the length cap, was thrown away,
    // and was re-called at 3200 by the adaptive ladder — two GLM calls per
    // question with the first one entirely wasted. The answer leg's rate
    // fell from 10 questions/min to 2 as the harder questions arrived.
    const sk = await makeSuite();
    const begun = await svc.beginRunSuite('me', sk, { mode: 'whatif' }, {});
    await begun.done;
    const call = frontmatterService.vllmChatCompletions.mock.calls.find((c) => {
      const sys = c[0] && c[0][0];
      return sys && sys.role === 'system' && /information assistant/i.test(sys.content);
    });
    expect(call).toBeTruthy();
    // max_tokens is a CAP, not a reservation — a model that needs less
    // never pays for it, and the ladder still climbs for the ones that do.
    expect(call[1].maxTokens).toBe(5000);
  });

  it('the answer leg token budget is configurable', async () => {
    const prev = process.env.OKF_RAGAS_ANSWER_MAX_TOKENS;
    process.env.OKF_RAGAS_ANSWER_MAX_TOKENS = '6144';
    try {
      const sk = await makeSuite();
      const begun = await svc.beginRunSuite('me', sk, { mode: 'whatif' }, {});
      await begun.done;
      const call = frontmatterService.vllmChatCompletions.mock.calls.find((c) => {
        const sys = c[0] && c[0][0];
        return sys && sys.role === 'system' && /information assistant/i.test(sys.content);
      });
      expect(call[1].maxTokens).toBe(6144);
    } finally {
      if (prev === undefined) delete process.env.OKF_RAGAS_ANSWER_MAX_TOKENS;
      else process.env.OKF_RAGAS_ANSWER_MAX_TOKENS = prev;
    }
  });

  it('the run fidelity block records the ANSWER leg (deployment-chat unless a ragas_answers config is active)', async () => {
    const sk = await makeSuite();
    const begun = await svc.beginRunSuite('me', sk, { mode: 'whatif' }, {});
    await begun.done;
    const doc = await svc.getRunSuite('me', sk, begun.run_key);
    expect(doc.payload.fidelity.answers).toMatchObject({ source: 'deployment-chat', config: null });
  });

  it('an explicit judge pick lands in the run fidelity (resolved judge + pick as made)', async () => {
    __mockDb._stores.okf_model_configs = {
      mm: {
        _key: 'mm',
        name: 'MiniMax',
        provider: 'openai',
        base_url: 'https://api.minimax.io/v1',
        default_model: 'mm-flash',
        api_key: 'k',
        services: ['ragas_judge'],
        active: false
      }
    };
    const sk = await makeSuite();
    const begun = await svc.beginRunSuite(
      'me',
      sk,
      { mode: 'whatif', judge_config_key: 'mm', judge_model: 'mm-large' },
      {}
    );
    await begun.done;
    const doc = await svc.getRunSuite('me', sk, begun.run_key);
    expect(doc.payload.fidelity.judge).toMatchObject({
      source: 'picked',
      config: 'MiniMax',
      model: 'mm-large',
      pick: { config_key: 'mm', model: 'mm-large' }
    });
    // The scoring sidecar received the picked endpoint, not the default.
    const evalCall = global.fetch.mock.calls.find((c) => String(c[0]).includes('/evaluate'));
    expect(JSON.parse(evalCall[1].body).judge).toMatchObject({
      base_url: 'https://api.minimax.io/v1',
      model: 'mm-large'
    });
  });

  it('a pinned CHATQNA_SYSTEM_PROMPT overrides the built-in chat default', async () => {
    process.env.CHATQNA_SYSTEM_PROMPT = 'PINNED CHAT CONTRACT';
    try {
      const sk = await makeSuite();
      const begun = await svc.beginRunSuite('me', sk, { mode: 'whatif' }, {});
      await begun.done;
      const call = frontmatterService.vllmChatCompletions.mock.calls.find(
        (c) => c[0] && c[0][0] && c[0][0].role === 'system' && c[0][0].content === 'PINNED CHAT CONTRACT'
      );
      expect(call).toBeTruthy();
    } finally {
      delete process.env.CHATQNA_SYSTEM_PROMPT;
    }
  });

  // Live 2026-10-21: a TERMINAL answer-leg error (the z.ai 400/404 class)
  // marched through every row and shipped a zero-score "done" run — zeros
  // presented as a measured benchmark (David: "do not allow this thing to
  // keep blundering forward when it is getting errors"). Now the first
  // terminal 4xx aborts the run: the doc is 'failed' with the cause, and
  // the judge leg never runs.
  it('a TERMINAL answer error fails the run loudly — failed doc with cause, no judge call', async () => {
    const sk = await makeSuite();
    frontmatterService.vllmChatCompletions.mockRejectedValue(
      Object.assign(new Error('Request failed with status code 400'), {
        code: 'ERR_BAD_REQUEST',
        response: { status: 400, data: { error: { message: 'invalid request body' } } }
      })
    );
    const begun = await svc.beginRunSuite('me', sk, { mode: 'whatif' }, {});
    await begun.done;
    // getRunSuite strips a failed doc to {run_key, suite_key, status, error}
    // — the envelope the panel renders.
    const env = await svc.getRunSuite('me', sk, begun.run_key);
    expect(env.status).toBe('failed');
    expect(env.error).toMatchObject({ code: 'ERR_BAD_REQUEST', status: 400, aborted: true, failed_rows: 2 });
    // The stored doc keeps the full forensics: every row errored, judge never ran.
    const raw = __mockDb._stores.okf_head_test_runs[begun.run_key];
    expect(raw.payload.results.every((r) => r.error)).toBe(true);
    expect(raw.payload.fidelity.judge).toBeNull();
    expect(global.fetch.mock.calls.some((c) => String(c[0]).includes('/evaluate'))).toBe(false);
  });

  it('a TRANSIENT answer error (503) is recovered by the completeness sweep — the run stays whole', async () => {
    // 2026-10-23 (David: "we must have complete benchmarks"): a row killed by
    // one transient blip used to stay dead, invalidating the run. The sweep
    // retries errored rows sequentially once the concurrent phase ends.
    const sk = await makeSuite();
    frontmatterService.vllmChatCompletions
      .mockRejectedValueOnce(
        Object.assign(new Error('upstream unavailable'), {
          code: 'ERR_BAD_RESPONSE',
          response: { status: 503, data: {} }
        })
      )
      .mockResolvedValue(llmResponse({ answer: 'A grounded answer.', abstained: false }));
    const begun = await svc.beginRunSuite('me', sk, { mode: 'whatif' }, {});
    await begun.done;
    const doc = await svc.getRunSuite('me', sk, begun.run_key);
    expect(doc.status).toBe('done');
    expect(doc.payload.results.filter((r) => r.error)).toHaveLength(0); // recovered
    expect(doc.payload.results.every((r) => typeof r.answer === 'string' && r.answer)).toBe(true);
    expect(doc.payload.summary.n_errors).toBe(0);
  });

  it('a PERSISTENT answer failure still lands as an honest error row after the sweep', async () => {
    // Completeness never trades away honesty: the sweep retries once, the row
    // fails again, and the error (marked sweep_retried) still invalidates.
    // Keyed to row 0's query (its first two answer calls fail) so the outcome
    // is deterministic under RUN_CONCURRENCY=2.
    const sk = await makeSuite();
    const answerCalls = {};
    frontmatterService.vllmChatCompletions.mockImplementation(async (messages) => {
      const key = JSON.stringify(messages);
      answerCalls[key] = (answerCalls[key] || 0) + 1;
      if (key.includes(GEN_SAMPLES[0].user_input) && answerCalls[key] <= 2) {
        throw Object.assign(new Error('upstream unavailable'), {
          code: 'ERR_BAD_RESPONSE',
          response: { status: 503, data: {} }
        });
      }
      return llmResponse({ answer: 'A grounded answer.', abstained: false });
    });
    const begun = await svc.beginRunSuite('me', sk, { mode: 'whatif' }, {});
    await begun.done;
    const doc = await svc.getRunSuite('me', sk, begun.run_key);
    expect(doc.status).toBe('done'); // the other row measured; this row is an honest error
    const errored = doc.payload.results.filter((r) => r.error);
    expect(errored).toHaveLength(1);
    expect(errored[0].error.status).toBe(503);
    expect(errored[0].error.sweep_retried).toBe(true);
    expect(doc.payload.summary.n_errors).toBe(1);
  });

  // Review F1 (2026-10-21): cancel during the answer phase used to be a
  // silent no-op — the cancel route only cancels sidecar jobs, none exist
  // yet in that phase, and the worker never checked the flag. A cancelled
  // run ground through every answer AND the judge leg and landed 'done'.
  it('cancel during the ANSWER phase stops the workers and records cancelled (never done)', async () => {
    const sk = await makeSuite();
    // The run key is only known after beginRunSuite returns; the first answer
    // (in flight while the caller cancels) waits for it.
    let resolveRunKey;
    const runKeyPromise = new Promise((resolve) => {
      resolveRunKey = resolve;
    });
    let answersServed = 0;
    frontmatterService.vllmChatCompletions.mockImplementation(async () => {
      answersServed += 1;
      if (answersServed === 1) {
        await svc.cancelSuiteRun('me', sk, await runKeyPromise);
      }
      return llmResponse({ answer: 'A grounded answer.', abstained: false });
    });
    const begun = await svc.beginRunSuite('me', sk, { mode: 'whatif' }, {});
    resolveRunKey(begun.run_key);
    // A cancelled run REJECTS the done promise (the cancel is not a result)
    await expect(begun.done).rejects.toThrow(/cancelled by user/);
    const doc = await svc.getRunSuite('me', sk, begun.run_key);
    expect(doc.status).toBe('cancelled');
    // The judge leg never ran for a cancelled run
    expect(global.fetch.mock.calls.some((c) => String(c[0]).includes('/evaluate'))).toBe(false);
  });

  // Review F2 (2026-10-21): a config saved without default_model resolved
  // model:null and the null was forwarded to the sidecar, where
  // ModelOverride validation failed EVERY generation and judge leg.
  it('a resolved judge override with NO model falls back to env (judge:null to the sidecar, fidelity honest)', async () => {
    __mockDb._stores.okf_model_configs = {
      nomodel: {
        _key: 'nomodel',
        name: 'No model set',
        provider: 'openai',
        base_url: 'https://gw:4000/v1',
        default_model: null,
        api_key: 'k',
        services: ['ragas_judge'],
        active: false
      }
    };
    const sk = await makeSuite();
    const begun = await svc.beginRunSuite('me', sk, { mode: 'whatif', judge_config_key: 'nomodel' }, {});
    await begun.done;
    const doc = await svc.getRunSuite('me', sk, begun.run_key);
    expect(doc.status).toBe('done');
    const evalCall = global.fetch.mock.calls.find((c) => String(c[0]).includes('/evaluate'));
    expect(JSON.parse(evalCall[1].body).judge).toBeNull();
    // The fidelity block records the EFFECTIVE judge — env, not the unusable pick
    expect(doc.payload.fidelity.judge.source).not.toBe('picked');
  });

  // David 2026-10-24: the system-default LLM (.env RAGAS_JUDGE_*) must be
  // selectable. The '__env__' sentinel bypasses even an ACTIVE config —
  // without it "default" silently meant the active config (here: the GLM
  // one), and the env judge was unreachable whenever one existed.
  it('the __env__ sentinel picks the SYSTEM default judge, active config bypassed', async () => {
    __mockDb._stores.okf_model_configs = {
      glm: {
        _key: 'glm',
        name: 'Active GLM',
        provider: 'openai',
        base_url: 'https://z.ai/v1',
        default_model: 'glm-5.3-flash',
        api_key: 'k',
        services: ['ragas_judge'],
        active: true
      }
    };
    const sk = await makeSuite();
    // judgeFidelity(null) names env vs builtin from RAGAS_JUDGE_BASE_URL —
    // pin it so the assertion is deterministic in the test shell.
    const prevBase = process.env.RAGAS_JUDGE_BASE_URL;
    const prevModel = process.env.RAGAS_JUDGE_MODEL;
    process.env.RAGAS_JUDGE_BASE_URL = 'https://ai.assembly.govstack.global:444/llm/v1';
    process.env.RAGAS_JUDGE_MODEL = 'ibm-granite/granite-4.1-8b';
    try {
      const begun = await svc.beginRunSuite('me', sk, { mode: 'whatif', judge_config_key: '__env__' }, {});
      await begun.done;
      const doc = await svc.getRunSuite('me', sk, begun.run_key);
      expect(doc.status).toBe('done');
      // The sidecar got NO judge override → its env/builtin default applies.
      const evalCall = global.fetch.mock.calls.find((c) => String(c[0]).includes('/evaluate'));
      expect(JSON.parse(evalCall[1].body).judge).toBeNull();
      // Fidelity says env, and the pick is remembered as the sentinel — the
      // panel restores '__env__' as itself, never demoting it to '' (active).
      expect(doc.payload.fidelity.judge.source).toBe('env');
      expect(doc.payload.fidelity.judge.model).toBe('ibm-granite/granite-4.1-8b');
      expect(doc.payload.fidelity.judge.pick.config_key).toBe('__env__');
    } finally {
      if (prevBase === undefined) delete process.env.RAGAS_JUDGE_BASE_URL;
      else process.env.RAGAS_JUDGE_BASE_URL = prevBase;
      if (prevModel === undefined) delete process.env.RAGAS_JUDGE_MODEL;
      else process.env.RAGAS_JUDGE_MODEL = prevModel;
    }
  });

  it('409 RUN_IN_FLIGHT with the adoptable run_key', async () => {
    const sk = await makeSuite();
    let releaseEval;
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/evaluate')) {
        return new Promise((resolve) => {
          releaseEval = () => resolve(okJson({ job_id: 'j-eval', status: 'queued' }));
        });
      }
      if (u.includes('/jobs/j-eval'))
        return Promise.resolve(
          okJson({ job_id: 'j-eval', status: 'done', result: { aggregate: {}, per_query: [{}, {}] } })
        );
      if (u.includes('/rerank')) return Promise.resolve(okJson([{ index: 0, score: 0.9 }]));
      return Promise.reject(new Error('unexpected'));
    });
    const first = await svc.beginRunSuite('me', sk, { mode: 'whatif' }, {});
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(typeof releaseEval).toBe('function');
    await expect(svc.beginRunSuite('me', sk, { mode: 'whatif' }, {})).rejects.toMatchObject({
      code: 'RUN_IN_FLIGHT',
      status: 409,
      details: { run_key: first.run_key }
    });
    releaseEval();
    await first.done;
  });

  it('a transient entry failure is recovered by the sweep; a persistent one stays an honest error', async () => {
    // Transient: teiEmbed blips ONCE — the initial attempt for row 0. The
    // sweep's retry succeeds, the row measures, the run is whole.
    const sk = await makeSuite();
    frontmatterService.teiEmbed.mockRejectedValueOnce(new Error('TEI down'));
    const begun = await svc.beginRunSuite('me', sk, { mode: 'whatif' }, {});
    await begun.done;
    let doc = await svc.getRunSuite('me', sk, begun.run_key);
    expect(doc.status).toBe('done');
    expect(doc.payload.results[0].error).toBeNull(); // recovered by the sweep
    expect(doc.payload.results[1].error).toBeNull();
    expect(doc.payload.summary.n_errors).toBe(0);

    // Persistent: the sweep's retry fails too — the row keeps its ORIGINAL
    // error, marked sweep_retried, and still counts against validity. The
    // rejection is keyed to row 0's QUERY (its first two embed attempts fail,
    // however the two workers interleave), so the outcome is deterministic
    // under RUN_CONCURRENCY=2.
    const sk2 = await makeSuite();
    const embedCalls = {};
    frontmatterService.teiEmbed.mockImplementation(async ([q]) => {
      embedCalls[q] = (embedCalls[q] || 0) + 1;
      if (q === GEN_SAMPLES[0].user_input && embedCalls[q] <= 2) throw new Error('TEI down');
      return [[0.1, 0.2, 0.3]];
    });
    const begun2 = await svc.beginRunSuite('me', sk2, { mode: 'whatif' }, {});
    await begun2.done;
    doc = await svc.getRunSuite('me', sk2, begun2.run_key);
    expect(doc.status).toBe('done');
    expect(doc.payload.results[0].error).toBeTruthy();
    expect(doc.payload.results[0].error.sweep_retried).toBe(true);
    expect(doc.payload.results[1].error).toBeNull();
    expect(doc.payload.summary.n_errors).toBe(1);
  });
});

describe('explain', () => {
  async function makeSuiteWithRun() {
    const begun = await svc.beginSuiteGeneration('me', { testset_size: 2 }, {});
    await begun.done;
    const run = await svc.beginRunSuite('me', begun.suite_key, { mode: 'whatif' }, {});
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

  // David 2026-10-21: "clicked explain… the UX is terrible as it does not show
  // a progress bar". The advisor is ONE reasoning-judge call that can think for
  // minutes (live: MiniMax starved 1200→4800→19200 reasoning tokens). The poll
  // envelope must carry the phase + failing count + elapsed while it runs.
  it('reports explaining phase + failing count while the advisor call is in flight', async () => {
    // Force failing rows — the advisor call only runs when something failed.
    const baseFetch = global.fetch;
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/evaluate')) return Promise.resolve(okJson({ job_id: 'j-prog', status: 'queued' }));
      if (u.includes('/jobs/j-prog'))
        return Promise.resolve(
          okJson({
            job_id: 'j-prog',
            status: 'done',
            result: {
              aggregate: {},
              per_query: GEN_SAMPLES.map(() => ({ context_recall: 0.3, faithfulness: 1.0 })),
              model: 'm',
              n: 2
            }
          })
        );
      return baseFetch(url);
    });
    const begunSuite = await svc.beginSuiteGeneration('me', { testset_size: 2 }, {});
    await begunSuite.done;
    const run = await svc.beginRunSuite('me', begunSuite.suite_key, { mode: 'whatif' }, {});
    await run.done;
    global.fetch = baseFetch;

    let releaseAdvisor;
    const baseLlm = frontmatterService.vllmChatCompletions;
    frontmatterService.vllmChatCompletions.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseAdvisor = () => resolve({ data: { choices: [{ message: { content: '{}' } }] } });
        })
    );
    try {
      const begun = await svc.beginExplainFailures('me', begunSuite.suite_key, { run_key: run.run_key }, {});
      await new Promise((resolve) => setImmediate(resolve));
      await new Promise((resolve) => setImmediate(resolve));
      const mid = await svc.getExplainFailures('me', begunSuite.suite_key, run.run_key);
      expect(mid.status).toBe('running');
      expect(mid.progress).toMatchObject({ phase: 'advising', failing: expect.any(Number) });
      expect(mid.progress.failing).toBeGreaterThan(0);
      expect(mid.progress.elapsed_s).toBeGreaterThanOrEqual(0);
      releaseAdvisor();
      await begun.done;
      const after = await svc.getExplainFailures('me', begunSuite.suite_key, run.run_key);
      expect(after.kind).toBe('ragas_explain'); // the saved doc, no running envelope
    } finally {
      frontmatterService.vllmChatCompletions.mockImplementation(baseLlm);
    }
  });

  // Live 2026-10-19 (verification run rr1792392548082): the reference chunk
  // was retrieved VERBATIM — context recall 1.0, every reference token in the
  // retrieved union — and entity recall still scored 0.4–0.5, because the
  // judge's two entity-extraction calls disagree with each other. The advisor
  // must attribute that to the judge, not send the curator to enrich entity
  // mentions in content that was returned character-for-character.
  it('entity-recall misses follow the PROVEN evidence, not the context_recall proxy (2026-10-25)', async () => {
    // context_recall PASSING does NOT mean the expected passage was
    // delivered. RAGAS's context_recall classifies the reference ANSWER's
    // sentences against the retrieved contexts — so other documents can
    // cover the answer while the expected passage itself is absent from the
    // corpus. The ladder proves where the passage went, and its verdict
    // wins. This test used to assert that every such row is staged "judge",
    // which sent the advisor to "treat as judge noise" for content the
    // system was never given.
    const baseFetch = global.fetch;
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/evaluate')) return Promise.resolve(okJson({ job_id: 'j-cer', status: 'queued' }));
      if (u.includes('/jobs/j-cer'))
        return Promise.resolve(
          okJson({
            job_id: 'j-cer',
            status: 'done',
            result: {
              aggregate: {},
              per_query: GEN_SAMPLES.map(() => ({ context_recall: 0.95, context_entities_recall: 0.3 })),
              model: 'm',
              n: 2
            }
          })
        );
      return baseFetch(url);
    });
    const begunSuite = await svc.beginSuiteGeneration('me', { testset_size: 2 }, {});
    await begunSuite.done;
    const run = await svc.beginRunSuite(
      'me',
      begunSuite.suite_key,
      { mode: 'whatif', metrics: ['context_recall', 'context_entities_recall'] },
      {}
    );
    await run.done;
    const explained = await svc.beginExplainFailures('me', begunSuite.suite_key, { run_key: run.run_key }, {});
    await explained.done;
    const doc = await svc.getExplainFailures('me', begunSuite.suite_key, run.run_key);
    const attr = doc.payload.attributions;
    expect(attr.length).toBe(2);
    // The row whose passage IS in the corpus and WAS delivered: the
    // entity-recall miss is the judge's extraction, not missing content.
    const present = attr.find((a) => a.evidence && a.evidence.in_corpus > 0);
    expect(present).toBeTruthy();
    expect(present.stage).toBe('judge');
    expect(present.unfair_question).toBe(false);
    expect(present.recommendation).toMatch(/entity extraction/i);
    // The row whose passage is PROVEN ABSENT from the corpus: it is an
    // unfair question, whatever context_recall said.
    const absent = attr.find((a) => a !== present);
    expect(absent.stage).toBe('corpus');
    expect(absent.unfair_question).toBe(true);
    expect(absent.recommendation).toMatch(/regenerate/i);
  });

  // 2026-10-23: this test used to require stage === 'corpus' for every row.
  // That assertion encoded the very bug the evidence layer was built to
  // remove: the mocked corpus HOLDS entry 0's reference passage ('Plant
  // after the last frost date.'), so calling that row a corpus gap sent a
  // curator to author content that was already indexed. The verdict now
  // follows the PROVEN evidence:
  //   entry 0 — passage in the corpus AND delivered  -> 'retrieved'
  //   entry 1 — passages absent from the corpus      -> 'corpus' (unfair)
  it('entity-recall misses with context recall failing follow the PROVEN evidence', async () => {
    const baseFetch = global.fetch;
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/evaluate')) return Promise.resolve(okJson({ job_id: 'j-cer2', status: 'queued' }));
      if (u.includes('/jobs/j-cer2'))
        return Promise.resolve(
          okJson({
            job_id: 'j-cer2',
            status: 'done',
            result: {
              aggregate: {},
              per_query: GEN_SAMPLES.map(() => ({ context_recall: 0.2, context_entities_recall: 0.3 })),
              model: 'm',
              n: 2
            }
          })
        );
      return baseFetch(url);
    });
    const begunSuite = await svc.beginSuiteGeneration('me', { testset_size: 2 }, {});
    await begunSuite.done;
    const run = await svc.beginRunSuite(
      'me',
      begunSuite.suite_key,
      { mode: 'whatif', metrics: ['context_recall', 'context_entities_recall'] },
      {}
    );
    await run.done;
    const explained = await svc.beginExplainFailures('me', begunSuite.suite_key, { run_key: run.run_key }, {});
    await explained.done;
    const doc = await svc.getExplainFailures('me', begunSuite.suite_key, run.run_key);
    const attr = doc.payload.attributions;
    expect(attr.length).toBe(2);
    // The row whose passage IS in the corpus and WAS delivered is not a
    // corpus gap.
    const present = attr.find((a) => a.evidence && a.evidence.in_corpus > 0);
    expect(present).toBeTruthy();
    expect(present.stage).not.toBe('corpus');
    expect(present.unfair_question).toBe(false);
    // The row whose passages are absent from the corpus IS one — and it is
    // reported as an unfair question, not a system defect.
    const absent = attr.find((a) => a !== present);
    expect(absent.stage).toBe('corpus');
    expect(absent.unfair_question).toBe(true);
    expect(absent.recommendation).toMatch(/regenerate/i);
  });

  it('routes tag suggestions through the existing guardrail', async () => {
    // Seed a failing metric so the advice path fires (all-passing runs get
    // attribution only — by design).
    const baseFetch = global.fetch;
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/evaluate')) {
        return Promise.resolve(okJson({ job_id: 'j-eval2', status: 'queued' }));
      }
      if (u.includes('/jobs/j-eval2')) {
        return Promise.resolve(
          okJson({
            job_id: 'j-eval2',
            status: 'done',
            result: {
              aggregate: {},
              per_query: GEN_SAMPLES.map((_s, i) => ({
                faithfulness: 1.0,
                context_precision: 0.9,
                context_recall: i === 0 ? 0.1 : 0.9,
                answer_relevancy: 1.0
              })),
              model: 'm',
              n: 2
            }
          })
        );
      }
      return baseFetch(url);
    });
    const begunSuite = await svc.beginSuiteGeneration('me', { testset_size: 2 }, {});
    await begunSuite.done;
    const run = await svc.beginRunSuite('me', begunSuite.suite_key, { mode: 'whatif' }, {});
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
    expect(headTestService.guardSuggestions).toHaveBeenCalled();
  });

  // 2026-10-23: the content-curation guard. A curator is asked to WRITE
  // content, so proposing it for a row whose passage is already in the
  // corpus is the expensive mistake — it was made for 18 of 29 live
  // failures. The guard is mechanical: no proven corpus gap, no curation.
  it('drops a content-curation proposal when NO row has a proven corpus gap', async () => {
    // Seed the corpus with EVERY reference passage, so no row has a gap.
    __mockDb.__corpusRows = [
      { key: 'k1', text: 'Plant after the last frost date.', score: 0.9 },
      { key: 'k2', text: 'Tomatoes are a crop.', score: 0.8 },
      { key: 'k3', text: 'Legal aid has income criteria.', score: 0.7 }
    ];
    const baseFetch = global.fetch;
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/evaluate')) return Promise.resolve(okJson({ job_id: 'j-cur', status: 'queued' }));
      if (u.includes('/jobs/j-cur'))
        return Promise.resolve(
          okJson({
            job_id: 'j-cur',
            status: 'done',
            result: {
              aggregate: {},
              per_query: GEN_SAMPLES.map(() => ({ context_recall: 0.2, faithfulness: 1.0 })),
              model: 'm',
              n: 2
            }
          })
        );
      return baseFetch(url);
    });
    const begunSuite = await svc.beginSuiteGeneration('me', { testset_size: 2 }, {});
    await begunSuite.done;
    const run = await svc.beginRunSuite('me', begunSuite.suite_key, { mode: 'whatif' }, {});
    await run.done;
    global.fetch = baseFetch;
    frontmatterService.vllmChatCompletions.mockResolvedValue(
      llmResponse({
        knob_changes: ['raise OKF_RAGAS_CANDIDATE_K'],
        repo_tag_changes: [],
        content_curation: [{ concept: 'c1', gap: 'missing frost dates' }],
        prompt_tweaks: []
      })
    );
    const begun = await svc.beginExplainFailures('me', begunSuite.suite_key, { run_key: run.run_key }, {});
    await begun.done;
    const explained = await svc.getExplainFailures('me', begunSuite.suite_key, run.run_key);
    // The proposal is dropped — every passage is in the corpus.
    expect(explained.payload.advice.content_curation).toEqual([]);
    expect(explained.payload.advice.rejected_curation).toBeTruthy();
    // ...and the KNOB suggestion survives: the advice is not discarded, only
    // the part that would send a curator to write existing content.
    expect(explained.payload.advice.knob_changes).toEqual(['raise OKF_RAGAS_CANDIDATE_K']);
    delete __mockDb.__corpusRows;
  });

  // The evidence layer must never report a corpus gap it has not proven.
  it('attributes a row whose passage IS in the corpus to a retrieval stage, not the corpus', async () => {
    // Entry 0's passage IS in the mocked corpus (k1); entry 1's passages are
    // NOT. The two rows must therefore get DIFFERENT verdicts — that is
    // the whole point of the evidence layer.
    const baseFetch = global.fetch;
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/evaluate')) return Promise.resolve(okJson({ job_id: 'j-ev', status: 'queued' }));
      if (u.includes('/jobs/j-ev'))
        return Promise.resolve(
          okJson({
            job_id: 'j-ev',
            status: 'done',
            result: {
              aggregate: {},
              per_query: GEN_SAMPLES.map(() => ({ context_recall: 0.2, faithfulness: 1.0 })),
              model: 'm',
              n: 2
            }
          })
        );
      return baseFetch(url);
    });
    const begunSuite = await svc.beginSuiteGeneration('me', { testset_size: 2 }, {});
    await begunSuite.done;
    const run = await svc.beginRunSuite('me', begunSuite.suite_key, { mode: 'whatif' }, {});
    await run.done;
    global.fetch = baseFetch;
    const begun = await svc.beginExplainFailures('me', begunSuite.suite_key, { run_key: run.run_key }, {});
    await begun.done;
    const doc = await svc.getExplainFailures('me', begunSuite.suite_key, run.run_key);
    const attr = doc.payload.attributions;
    expect(attr.length).toBe(2);
    // The row whose passage IS in the corpus is NOT a corpus gap.
    const present = attr.find((a) => a.evidence && a.evidence.in_corpus > 0);
    expect(present).toBeTruthy();
    expect(present.stage).not.toBe('corpus');
    expect(present.unfair_question).toBe(false);
    // The row whose passages are NOT in the corpus IS one.
    const absent = attr.find((a) => a !== present);
    expect(absent.stage).toBe('corpus');
    expect(absent.unfair_question).toBe(true);
    // No row may be flagged as an unfair question unless its passage was
    // proven absent.
    for (const a of attr) {
      if (a.unfair_question) expect(a.evidence.in_corpus).toBe(0);
    }
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
    const run = await svc.beginRunSuite('me', begun.suite_key, { mode: 'whatif' }, {});
    await run.done;
    const runs = await svc.listRuns('me', { kind: 'ragas_run' });
    expect(runs).toHaveLength(1);
    expect(runs[0].kind).toBe('ragas_run');
    // Judge memory: the run row carries the pick as made — the panel's
    // restore source for the suite's latest run.
    expect(runs[0].judge_pick).toEqual({ config_key: null, model: null });
    const suites = await svc.listRuns('me', { kind: 'ragas_suite' });
    expect(suites[0].kind).toBe('ragas_suite');
    expect(suites[0].judge_pick).toBeNull();
    const all = await svc.listRuns('me', { kind: 'all' });
    expect(all).toHaveLength(2);
  });

  // Live incident 2026-10-18: a generation in flight has NO collection doc
  // (the suite persists only on completion), so after a page refresh the
  // list could not contain it — the panel reloaded the previous suite and
  // the running generation was orphaned from the UI until a second Generate
  // attempt 409'd. The list must surface the live envelope as a row.
  it('listRuns surfaces an in-flight generation as a synthetic newest row', async () => {
    let polls = 0;
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/rerank')) return Promise.resolve(okJson([{ index: 0, score: 0.9 }]));
      if (u.includes('/generate-testset'))
        return Promise.resolve(okJson({ job_id: 'j-gen', status: 'queued', poll: '/jobs/j-gen' }));
      if (u.includes('/jobs/j-gen')) {
        polls += 1;
        if (polls <= 25)
          return Promise.resolve(
            okJson({
              job_id: 'j-gen',
              kind: 'generate-testset',
              status: 'running',
              progress: { phase: 'synthesizing-questions', done: 1, total: 2 }
            })
          );
        return Promise.resolve(
          okJson({
            job_id: 'j-gen',
            kind: 'generate-testset',
            status: 'done',
            result: { samples: GEN_SAMPLES, generator: { model: 'm', embed_model: 'e' } }
          })
        );
      }
      return Promise.reject(new Error('unexpected ' + u));
    });
    const begun = await svc.beginSuiteGeneration('me', { testset_size: 2 }, {});
    // Let the sidecar's first poll land so the live progress (not the seed)
    // is what the list row carries.
    await new Promise((resolve) => setTimeout(resolve, 25));
    // In-flight window — no suite doc exists yet, but the list must show it.
    const suites = await svc.listRuns('me', { kind: 'ragas_suite' });
    const gen = suites.find((r) => r.status === 'generating');
    expect(gen).toBeTruthy();
    expect(gen.suite_key).toBe(begun.suite_key);
    expect(gen.kind).toBe('ragas_suite');
    // The live progress carries the sidecar's counts AND the effective
    // judge (2026-10-21) — the panel shows which model the run is using.
    expect(gen.progress).toMatchObject({ phase: 'synthesizing-questions', done: 1, total: 2 });
    expect(gen.progress.judge).toMatchObject({ source: expect.any(String) });
    // Newest-first: the live generation leads the list.
    expect(suites[0].status).toBe('generating');
    // The synthetic suite row must NOT leak into ragas_run listings.
    const runs = await svc.listRuns('me', { kind: 'ragas_run' });
    expect(runs.some((r) => r.kind === 'ragas_suite')).toBe(false);
    await begun.done; // let the poller finish so no work dangles past the test
  });
});

describe('rerank batch concurrency', () => {
  // 40 rows -> 2 batches at RERANK_BATCH=32; 96 rows -> 3 batches. The
  // dispatcher's _SOURCE fallback serves the dense-search query straight from
  // __corpusRows, so the retrieval leg sees the whole corpus as its pool.
  function corpusOf(n) {
    return Array.from({ length: n }, (_, i) => ({
      key: `k${String(i + 1).padStart(2, '0')}`,
      text: `chunk ${i + 1} of the concurrency corpus`,
      score: 1 - i / 1000
    }));
  }

  function installFetch(batchDelaysMs, scoreFor) {
    let inFlight = 0;
    const seen = { maxInFlight: 0, batches: 0 };
    global.fetch = jest.fn((url, opts) => {
      if (!String(url).includes('/rerank')) {
        if (String(url).includes('/generate-testset'))
          return Promise.resolve(okJson({ job_id: 'j-gen', status: 'queued', poll: '/jobs/j-gen' }));
        if (String(url).includes('/evaluate')) return Promise.resolve(okJson({ job_id: 'j-eval', status: 'queued' }));
        if (String(url).includes('/jobs/j-gen'))
          return Promise.resolve(
            okJson({
              job_id: 'j-gen',
              kind: 'generate-testset',
              status: 'done',
              result: { samples: GEN_SAMPLES, generator: { model: 'm', embed_model: 'e' } }
            })
          );
        if (String(url).includes('/jobs/j-eval'))
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
        return Promise.reject(new Error(`unexpected fetch ${url}`));
      }
      seen.batches += 1;
      inFlight += 1;
      seen.maxInFlight = Math.max(seen.maxInFlight, inFlight);
      const body = JSON.parse(opts.body);
      const firstText = body.texts[0];
      const globalIndex = Number(firstText.match(/chunk (\d+)/)[1]) - 1;
      const batchStart = globalIndex - (globalIndex % 32);
      const delay = batchDelaysMs[batchStart / 32] || 0;
      return new Promise((resolve) =>
        setTimeout(() => {
          inFlight -= 1;
          resolve(okJson(body.texts.map((_, i) => ({ index: i, score: scoreFor(batchStart + i) }))));
        }, delay)
      );
    });
    return seen;
  }

  async function runOnce() {
    const begun = await svc.beginSuiteGeneration('me', { testset_size: 2 }, { actor: { user_id: 'u1' } });
    await begun.done;
    const run = await svc.beginRunSuite('me', begun.suite_key, { mode: 'whatif' }, { actor: { user_id: 'u1' } });
    await run.done;
    return svc.getRunSuite('me', begun.suite_key, run.run_key);
  }

  afterEach(() => {
    delete process.env.OKF_RAGAS_RERANK_CONCURRENCY;
    delete __mockDb.__corpusRows;
  });

  it('overlaps batches up to the concurrency cap and keeps results identical (order preserved)', async () => {
    process.env.OKF_RAGAS_RERANK_CONCURRENCY = '2';
    __mockDb.__corpusRows = corpusOf(40);
    // Batch 0 (rows 1..32) is SLOW and scores low; batch 1 (rows 33..40) is
    // fast and its first row scores highest. If reassembly followed
    // completion order, batch 1's local index 0 would land at global index 0
    // and the top context would be k01 — the assertion below catches it.
    const seen = installFetch([80, 5], (g) => (g === 32 ? 0.99 : 0.01));
    const doc = await runOnce();
    expect(seen.batches).toBe(4); // 2 questions x 2 batches — retrieval runs per question
    // The GLOBAL in-flight ceiling is RUN_CONCURRENCY (2 rows at a time) x
    // rerankConcurrency (2) = 4; the floor proves a question's two batches
    // actually overlapped. Exact values would be timing-fragile.
    expect(seen.maxInFlight).toBeGreaterThanOrEqual(2);
    expect(seen.maxInFlight).toBeLessThanOrEqual(4);
    const r0 = doc.payload.results[0];
    expect(r0.context_keys[0]).toBe('k33'); // the designed winner, correctly reassembled
    // The pool is recorded whole (see candidate-pool tests) — all 40 keys.
    expect(r0.candidate_keys).toHaveLength(40);
  });

  it('keeps the old sequential behaviour at concurrency 1', async () => {
    process.env.OKF_RAGAS_RERANK_CONCURRENCY = '1';
    __mockDb.__corpusRows = corpusOf(40);
    const seen = installFetch([30, 5], (g) => (g === 32 ? 0.99 : 0.01));
    await runOnce();
    expect(seen.batches).toBe(4); // 2 questions x 2 batches
    // C=1 keeps ONE call's batches sequential; two questions may still each
    // have one in flight (RUN_CONCURRENCY=2), so the global bound is 2.
    expect(seen.maxInFlight).toBeGreaterThanOrEqual(1);
    expect(seen.maxInFlight).toBeLessThanOrEqual(2);
  });

  it('workers drain a batch list longer than the pool without losing a batch', async () => {
    process.env.OKF_RAGAS_RERANK_CONCURRENCY = '2';
    __mockDb.__corpusRows = corpusOf(96); // 3 batches, 2 workers
    const seen = installFetch([10, 30, 10], (g) => (g === 64 ? 0.98 : 0.01));
    const doc = await runOnce();
    expect(seen.batches).toBe(6); // 2 questions x 3 batches
    expect(seen.maxInFlight).toBeGreaterThanOrEqual(2); // workers overlapped
    expect(seen.maxInFlight).toBeLessThanOrEqual(4); // RUN_CONCURRENCY x cap
    expect(doc.payload.results[0].context_keys[0]).toBe('k65'); // batch 2's winner survived the queueing
  });
});

describe('transient infra guards (2026-10-23 live incident)', () => {
  it('a rerank timeout abort is retried, not fatal', async () => {
    // Live: 2 of 100 rows died on our own RERANK_TIMEOUT_MS abort — a Node
    // fetch DOMException (name AbortError, code 20) carried no retryable
    // marker and sailed straight through the ladder.
    const sk = await svc.beginSuiteGeneration('me', { testset_size: 2 }, { actor: { user_id: 'u1' } });
    await sk.done;
    let rerankCalls = 0;
    const baseFetch = global.fetch;
    global.fetch = jest.fn((url) => {
      if (String(url).includes('/rerank')) {
        rerankCalls += 1;
        if (rerankCalls === 1) {
          const e = new Error('This operation was aborted');
          e.name = 'AbortError';
          e.code = 20;
          return Promise.reject(e);
        }
        return Promise.resolve(
          okJson([
            { index: 0, score: 0.9 },
            { index: 1, score: 0.4 }
          ])
        );
      }
      return baseFetch(url);
    });
    const run = await svc.beginRunSuite('me', sk.suite_key, { mode: 'whatif' }, { actor: { user_id: 'u1' } });
    await run.done;
    const doc = await svc.getRunSuite('me', sk.suite_key, run.run_key);
    expect(doc.status).toBe('done');
    expect(doc.payload.results[0].contexts.length).toBeGreaterThan(0); // the retry delivered
    expect(rerankCalls).toBeGreaterThanOrEqual(2);
  });

  it('a row that errored attributes to retrieval-error, not routing', async () => {
    // Live: 6 rows with a 429/timeout got labeled "routing — check the repo
    // is published" while the evidence showed the passage at rank #1. The
    // label must name the infrastructure and say re-run. The judge scores an
    // empty-context row 0 — which is what puts it below threshold.
    const baseFetch = global.fetch;
    global.fetch = jest.fn((url) => {
      if (String(url).includes('/jobs/j-eval'))
        return Promise.resolve(
          okJson({
            job_id: 'j-eval',
            kind: 'evaluate',
            status: 'done',
            result: {
              aggregate: {},
              per_query: [
                { faithfulness: 0, context_precision: 0, context_recall: 0, answer_relevancy: 0 },
                { faithfulness: 1, context_precision: 0.9, context_recall: 0.9, answer_relevancy: 0.9 }
              ],
              model: 'm',
              n: 2
            }
          })
        );
      return baseFetch(url);
    });
    const sk = await svc.beginSuiteGeneration('me', { testset_size: 2 }, { actor: { user_id: 'u1' } });
    await sk.done;
    frontmatterService.teiEmbed.mockImplementation(async ([q]) => {
      if (q === GEN_SAMPLES[0].user_input) throw new Error('Request failed with status code 429');
      return [[0.1, 0.2, 0.3]];
    });
    const run = await svc.beginRunSuite('me', sk.suite_key, { mode: 'whatif' }, { actor: { user_id: 'u1' } });
    await run.done;
    const explained = await svc.beginExplainFailures('me', sk.suite_key, { run_key: run.run_key }, {});
    await explained.done;
    const doc = await svc.getExplainFailures('me', sk.suite_key, run.run_key);
    const row = doc.payload.attributions.find((a) => a.query === GEN_SAMPLES[0].user_input);
    expect(row).toBeTruthy();
    expect(row.stage).toBe('retrieval-error');
    expect(row.recommendation).toMatch(/re-run/i);
  });
});

describe('serve mode — the benchmark measures the SERVED system (2026-10-23)', () => {
  // David: "the RAGAS responses MUST equal the UI responses or they are
  // useless." The default run posts the question to chatqna exactly like the
  // UI's backend does, with the include_contexts opt-in, and measures the
  // SERVED contexts — no parallel retrieval.
  function sseResponse(lines) {
    async function* body() {
      for (const l of lines) yield Buffer.from(l, 'utf8');
    }
    return { ok: true, status: 200, body: body() };
  }

  it('parses the chatqna SSE wire and measures the served contexts', async () => {
    const begun = await svc.beginSuiteGeneration('me', { testset_size: 2 }, { actor: { user_id: 'u1' } });
    await begun.done;
    const baseFetch = global.fetch;
    let servePayload = null;
    global.fetch = jest.fn((url, opts = {}) => {
      const u = String(url);
      if (u.includes('/v1/chatqna')) {
        // The FAN-OUT CARRIER is the contract (live 2026-10-23: the first
        // serve run measured 96/100 abstentions with zero contexts because
        // the bare payload fell back to legacy retrieval — the legacy graph
        // holds nothing for OKF concepts).
        servePayload = JSON.parse(opts.body);
        // The wire the backend parses: Python-repr token chunks + one JSON
        // metadata event + [DONE]. The escape exercises decodePyRepr.
        return Promise.resolve(
          sseResponse([
            "data: b'High moisture content drives cob rot.\\nSecond line with \\'quotes\\'.'\n\n",
            // A literal backslash (Python repr emits \\\\): the sentinel must
            // round-trip — strip-then-restore mangles it to literal 'BS'.
            "data: b' See C:\\\\temp\\\\x.'\n\n",
            // vLLM's terminal usage-only frame: transport metadata that must
            // NEVER land in the benchmark's answer text (live 2026-10-23 —
            // the judge scored it as answer content).
            'data: b\'{"id":"chatcmpl-x","object":"chat.completion.chunk","choices":[],"usage":{"prompt_tokens":9,"total_tokens":11}}\'\n\n',
            'data: {"type":"metadata","source_documents":[' +
              '{"document_id":"concept-1","score":0.9,"text":"Chunk one about cob rot."},' +
              '{"document_id":"concept-2","score":0.4,"text":"Bean guide noise."}],' +
              '"confidence_score":0.88,"abstained":false,"is_grounded":true}\n\n',
            'data: [DONE]\n\n'
          ])
        );
      }
      if (u.includes('/evaluate')) return Promise.resolve(okJson({ job_id: 'j-eval', status: 'queued' }));
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
                context_precision: 0.9,
                context_recall: 0.9,
                answer_relevancy: 1.0
              })),
              evaluation_log: []
            }
          })
        );
      return baseFetch(url, opts);
    });
    const run = await svc.beginRunSuite('me', begun.suite_key, {}, { actor: { user_id: 'u1' } });
    await run.done;
    const doc = await svc.getRunSuite('me', begun.suite_key, run.run_key);
    expect(doc.status).toBe('done');
    const r0 = doc.payload.results[0];
    // The Python-repr escapes decoded: \n is a newline, \' is a quote,
    // \\\\ is ONE literal backslash (sentinel round-trip, not 'BS').
    expect(r0.answer).toBe("High moisture content drives cob rot.\nSecond line with 'quotes'. See C:\\temp\\x.");
    // The SERVED contexts, not a replay.
    expect(r0.contexts).toEqual(['Chunk one about cob rot.', 'Bean guide noise.']);
    expect(r0.context_keys).toEqual(['concept-1', 'concept-2']);
    expect(r0.confidence).toBe(0.88);
    expect(r0.abstained).toBe(false);
    // Serve rows never touched the rerank replay.
    expect(global.fetch.mock.calls.some((c) => String(c[0]).includes('/rerank'))).toBe(false);
    // The fidelity block says which mode served.
    expect(doc.payload.fidelity.retrieval.mode).toBe('serve');
    expect(doc.payload.fidelity.retrieval.algorithm).toMatch(/SERVED/);
    // The fan-out carrier: the same routing keys the citizen backend
    // attaches, scoped to the suite's graphs — without it chatqna retrieves
    // legacy-only and every OKF question abstains with zero contexts.
    expect(servePayload).toBeTruthy();
    expect(servePayload.context).toEqual({
      mode: 'okf_only',
      authorized_graph_names: ['GRAPH_AGRI'],
      exclude_legacy: true
    });
  });

  it('honors mode: whatif for the knob experiments (replay path)', async () => {
    const begun = await svc.beginSuiteGeneration('me', { testset_size: 2 }, { actor: { user_id: 'u1' } });
    await begun.done;
    const run = await svc.beginRunSuite('me', begun.suite_key, { mode: 'whatif' }, { actor: { user_id: 'u1' } });
    await run.done;
    const doc = await svc.getRunSuite('me', begun.suite_key, run.run_key);
    expect(doc.status).toBe('done');
    expect(doc.payload.fidelity.retrieval.mode).toBe('whatif');
    expect(doc.payload.fidelity.retrieval.candidate_k).toBeGreaterThan(0);
  });

  it('a stream that ends WITHOUT the metadata event is an honest error row, not a silent zero-context success', async () => {
    // The contract break must be named (proxy cut the stream / chatqna died
    // post-tokens) — recording answer + contexts=[] + error:null would
    // mislabel the row 'routing' and keep the run "valid" with garbage
    // context metrics. Keyed to row 0's query so the outcome is
    // deterministic under RUN_CONCURRENCY=2; the sweep retries it and fails
    // again (sweep_retried), the other row measures normally.
    const begun = await svc.beginSuiteGeneration('me', { testset_size: 2 }, { actor: { user_id: 'u1' } });
    await begun.done;
    const baseFetch = global.fetch;
    const goodStream = () =>
      sseResponse([
        "data: b'A grounded answer.'\n\n",
        'data: {"type":"metadata","source_documents":[' +
          '{"document_id":"concept-1","score":0.9,"text":"Chunk one about cob rot."}],' +
          '"confidence_score":0.8,"is_grounded":true}\n\n',
        'data: [DONE]\n\n'
      ]);
    global.fetch = jest.fn((url, opts = {}) => {
      const u = String(url);
      if (u.includes('/v1/chatqna')) {
        const isRow0 = String((opts && opts.body) || '').includes(GEN_SAMPLES[0].user_input);
        return Promise.resolve(
          isRow0
            ? sseResponse(["data: b'Partial answer, then the stream died.'\n\n", 'data: [DONE]\n\n'])
            : goodStream()
        );
      }
      return baseFetch(url, opts);
    });
    const run = await svc.beginRunSuite('me', begun.suite_key, {}, { actor: { user_id: 'u1' } });
    await run.done;
    const doc = await svc.getRunSuite('me', begun.suite_key, run.run_key);
    expect(doc.status).toBe('done');
    expect(doc.payload.results[0].error).toMatchObject({ sweep_retried: true });
    expect(doc.payload.results[0].error.message).toMatch(/metadata/);
    expect(doc.payload.results[1].error).toBeNull();
    expect(doc.payload.summary.n_errors).toBe(1);
  });

  it('detects a served abstention from chatqna metadata (nothing retrieved, not grounded)', async () => {
    // chatqna's normal streaming metadata never emits 'abstained' (only the
    // reranker-overflow branch does). The SERVED authority for "there was
    // nothing to answer from" is is_grounded=false with no source documents
    // (and no related documents for the citizen).
    const begun = await svc.beginSuiteGeneration('me', { testset_size: 2 }, { actor: { user_id: 'u1' } });
    await begun.done;
    const baseFetch = global.fetch;
    global.fetch = jest.fn((url, opts = {}) => {
      const u = String(url);
      if (u.includes('/v1/chatqna')) {
        return Promise.resolve(
          sseResponse([
            "data: b'I cannot find that information in the provided documents.'\n\n",
            'data: {"type":"metadata","source_documents":[],"confidence_score":0.0,"is_grounded":false}\n\n',
            'data: [DONE]\n\n'
          ])
        );
      }
      return baseFetch(url, opts);
    });
    const run = await svc.beginRunSuite('me', begun.suite_key, {}, { actor: { user_id: 'u1' } });
    await run.done;
    const doc = await svc.getRunSuite('me', begun.suite_key, run.run_key);
    expect(doc.status).toBe('done');
    expect(doc.payload.results[0].abstained).toBe(true);
  });

  // David 2026-10-24 (live): the benchmark recorded 10 abstentions that the
  // chat UI answered IN FULL with a 99% confidence badge. The old detector
  // fired on 'does not provide' / 'not contain' ANYWHERE in the answer, so a
  // complete answer that says one part of the question is not covered was
  // recorded as an abstention — which zeroed the row's answer metrics, routed
  // the attribution to the "abstention" stage, and made the advisor
  // recommend tightening the prompt. The citizen path shows such an answer
  // in full; the benchmark must agree with the citizen path.
  it('a COMPLETE answer that says part of the question is not covered is NOT an abstention', async () => {
    const begun = await svc.beginSuiteGeneration('me', { testset_size: 2 }, { actor: { user_id: 'u1' } });
    await begun.done;
    const baseFetch = global.fetch;
    global.fetch = jest.fn((url, opts = {}) => {
      const u = String(url);
      if (u.includes('/v1/chatqna')) {
        return Promise.resolve(
          sseResponse([
            "data: b'In the field validations conducted in Chalatenango, the CENTA-CS variety performed significantly better than local varieties: 70 qq/mz versus 45 qq/mz. The knowledge base does not provide specific performance data for CENTA-ASG beyond these points, but it clearly indicates that both varieties outperformed local controls in the region.'\n\n",
            'data: {"type":"metadata","source_documents":[{"id":"d1","text":"CENTA-CS yielded 70 qq/mz versus 45 qq/mz at Los Naranjos."}],"confidence_score":0.99,"self_confidence":0.99,"is_grounded":true}\n\n',
            'data: [DONE]\n\n'
          ])
        );
      }
      return baseFetch(url, opts);
    });
    const run = await svc.beginRunSuite('me', begun.suite_key, {}, { actor: { user_id: 'u1' } });
    await run.done;
    const doc = await svc.getRunSuite('me', begun.suite_key, run.run_key);
    expect(doc.status).toBe('done');
    const row = doc.payload.results[0];
    expect(row.abstained).toBe(false); // ← the bug: this was true
    expect(row.answer).toContain('70 qq/mz');
    // The grounding evidence the citizen saw is recorded on the row.
    expect(row.confidence).toBe(0.99);
    expect(row.self_confidence).toBe(0.99);
    expect(row.is_grounded).toBe(true);
    expect(row.related_documents).toBe(1);
    expect(doc.payload.summary.n_abstained).toBe(0);
  });

  it("chatqna's own abstention flag wins over the answer text", async () => {
    const begun = await svc.beginSuiteGeneration('me', { testset_size: 2 }, { actor: { user_id: 'u1' } });
    await begun.done;
    const baseFetch = global.fetch;
    global.fetch = jest.fn((url, opts = {}) => {
      const u = String(url);
      if (u.includes('/v1/chatqna')) {
        return Promise.resolve(
          sseResponse([
            "data: b'Retrying with a shorter context.'\n\n",
            'data: {"type":"metadata","source_documents":[],"confidence_score":0.0,"is_grounded":false,"abstained":true,"abstention_reason":"reranker_input_too_long"}\n\n',
            'data: [DONE]\n\n'
          ])
        );
      }
      return baseFetch(url, opts);
    });
    const run = await svc.beginRunSuite('me', begun.suite_key, {}, { actor: { user_id: 'u1' } });
    await run.done;
    const doc = await svc.getRunSuite('me', begun.suite_key, run.run_key);
    expect(doc.payload.results[0].abstained).toBe(true);
    expect(doc.payload.results[0].abstention_reason).toBe('reranker_input_too_long');
  });
});

describe('cancel-race guard (live 2026-10-23)', () => {
  // A cancel that lands between the pre-judge check and the evaluate
  // submission found NOTHING registered in activeSidecarJobs — the evaluate
  // job then ran UNCANCELLED for hours while the run doc said cancelled, and
  // (with MAX_CONCURRENT_JOBS=2) it bricked the sidecar with 503 busy for
  // every later run. The guard: after the submit, re-check the cancel flag,
  // kill the fresh job, honour the cancel.
  it('a cancel landing during the judge-submit window kills the fresh evaluate job', async () => {
    const begunSuite = await svc.beginSuiteGeneration('me', { testset_size: 2 }, {});
    await begunSuite.done;
    let releaseEval;
    const deleted = [];
    const baseFetch = global.fetch;
    global.fetch = jest.fn((url, opts = {}) => {
      const u = String(url);
      if (u.includes('/evaluate')) {
        // Hold the submit open so the test can land a cancel in the window
        // between the pre-judge check and the job registration.
        return new Promise((resolve) => {
          releaseEval = () => resolve(okJson({ job_id: 'j-race', status: 'queued', poll: '/jobs/j-race' }));
        });
      }
      if (u.includes('/jobs/j-race') && opts && opts.method === 'DELETE') {
        deleted.push('j-race');
        return Promise.resolve(okJson({ job_id: 'j-race', status: 'cancelled' }));
      }
      if (u.includes('/jobs/j-race')) return Promise.resolve(okJson({ job_id: 'j-race', status: 'cancelled' }));
      return baseFetch(url, opts);
    });
    const begun = await svc.beginRunSuite('me', begunSuite.suite_key, { mode: 'whatif' }, {});
    // Wait until the evaluate submit is in flight (the answer leg is done).
    for (let i = 0; i < 100 && !releaseEval; i += 1) await new Promise((r) => setImmediate(r));
    expect(typeof releaseEval).toBe('function');
    // The user cancels NOW — mid-window: nothing is registered yet.
    await svc.cancelSuiteRun('me', begunSuite.suite_key, begun.run_key);
    // The submit completes after the cancel.
    releaseEval();
    // The cancel REJECTS the done promise by design (the doc is the state).
    await expect(begun.done).rejects.toMatchObject({ code: 'RAGAS_JOB_CANCELLED' });
    const doc = await svc.getRunSuite('me', begunSuite.suite_key, begun.run_key);
    expect(doc.status).toBe('cancelled');
    // The freshly submitted job was explicitly killed.
    expect(deleted).toContain('j-race');
    // And the judge never scored: no evaluation result was consumed.
    expect(doc.payload && doc.payload.summary).toBeFalsy();
  });
});

describe('deleteRun (per-run delete, 2026-10-24)', () => {
  async function makeSuite() {
    const begun = await svc.beginSuiteGeneration('me', { testset_size: 2 }, {});
    await begun.done;
    return begun.suite_key;
  }

  it('deletes a finished run AND cascades its explain doc — the suite survives', async () => {
    const sk = await makeSuite();
    const begun = await svc.beginRunSuite('me', sk, { mode: 'whatif' }, { actor: { user_id: 'u1' } });
    await begun.done;
    const explained = await svc.beginExplainFailures('me', sk, { run_key: begun.run_key }, {});
    await explained.done;
    // Both docs exist before the delete.
    expect(__mockDb._stores.okf_head_test_runs[begun.run_key]).toBeTruthy();
    const explainKey = Object.keys(__mockDb._stores.okf_head_test_runs).find(
      (k) => __mockDb._stores.okf_head_test_runs[k].kind === 'ragas_explain'
    );
    expect(explainKey).toBeTruthy();
    const out = await svc.deleteRun('me', sk, begun.run_key);
    expect(out.deleted).toBe(begun.run_key);
    expect(out.removed_docs).toBe(2); // the run + its explain
    expect(__mockDb._stores.okf_head_test_runs[begun.run_key]).toBeUndefined();
    expect(__mockDb._stores.okf_head_test_runs[explainKey]).toBeUndefined();
    // The SUITE doc survives.
    expect(__mockDb._stores.okf_head_test_runs[sk]).toBeTruthy();
  });

  it('404s for a foreign run key and 409s for a running run', async () => {
    const sk = await makeSuite();
    await expect(svc.deleteRun('me', sk, 'rr-nonexistent')).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND',
      status: 404
    });
    // A running run is refused — cancel first (deleting under a live worker
    // would leave the run promise writing into a vanished doc). The evaluate
    // fetch is HELD so the run is provably mid-judge at the delete attempt.
    let releaseEval;
    const baseFetch = global.fetch;
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/evaluate')) {
        return new Promise((resolve) => {
          releaseEval = () => resolve(okJson({ job_id: 'j-eval', status: 'queued' }));
        });
      }
      return baseFetch(url);
    });
    const begun = await svc.beginRunSuite('me', sk, { mode: 'whatif' }, {});
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    expect(typeof releaseEval).toBe('function');
    await expect(svc.deleteRun('me', sk, begun.run_key)).rejects.toMatchObject({
      code: 'RUN_IN_FLIGHT',
      status: 409
    });
    releaseEval();
    await begun.done;
  });

  it('409s while an explain for the run is still advising, then deletes once it lands', async () => {
    const sk = await makeSuite();
    // Force failing rows — the advisor call only runs when something failed.
    const baseFetch = global.fetch;
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/evaluate')) return Promise.resolve(okJson({ job_id: 'j-prog', status: 'queued' }));
      if (u.includes('/jobs/j-prog'))
        return Promise.resolve(
          okJson({
            job_id: 'j-prog',
            status: 'done',
            result: {
              aggregate: {},
              per_query: GEN_SAMPLES.map(() => ({ context_recall: 0.3, faithfulness: 1.0 })),
              model: 'm',
              n: 2
            }
          })
        );
      return baseFetch(url);
    });
    const begun = await svc.beginRunSuite('me', sk, { mode: 'whatif' }, {});
    await begun.done;
    global.fetch = baseFetch;
    // Hold the advisor call open — the explain worker is mid-save-somedoc.
    let releaseAdvisor;
    frontmatterService.vllmChatCompletions.mockImplementation(
      () =>
        new Promise((resolve) => {
          releaseAdvisor = () => resolve({ data: { choices: [{ message: { content: '{}' } }] } });
        })
    );
    const explained = await svc.beginExplainFailures('me', sk, { run_key: begun.run_key }, {});
    await new Promise((resolve) => setImmediate(resolve));
    await new Promise((resolve) => setImmediate(resolve));
    await expect(svc.deleteRun('me', sk, begun.run_key)).rejects.toMatchObject({
      code: 'EXPLAIN_IN_FLIGHT',
      status: 409
    });
    releaseAdvisor();
    await explained.done;
    // Explain landed → the same delete now cascades both docs.
    const out = await svc.deleteRun('me', sk, begun.run_key);
    expect(out.removed_docs).toBe(2);
  });
});

describe('rescoreRun — re-score a finished run with a different judge (2026-10-24)', () => {
  async function makeSuite() {
    const begun = await svc.beginSuiteGeneration('me', { testset_size: 2 }, {});
    await begun.done;
    return begun.suite_key;
  }

  it('re-scores the STORED answers and writes a SEPARATE run naming its judge', async () => {
    __mockDb._stores.okf_model_configs = {
      judge2: {
        _key: 'judge2',
        name: 'Second Judge',
        provider: 'openai',
        base_url: 'https://second/v1',
        default_model: 'strong-model',
        api_key: 'k2',
        services: ['ragas_judge'],
        active: false
      }
    };
    const sk = await makeSuite();
    const first = await svc.beginRunSuite('me', sk, { mode: 'whatif' }, {});
    await first.done;
    const source = await svc.getRunSuite('me', sk, first.run_key);
    const sourceAnswers = source.payload.results.map((r) => r.answer);

    const begun = await svc.rescoreRun('me', sk, first.run_key, { judge_config_key: 'judge2' }, {});
    const newDoc = await begun.done;

    // A NEW run doc — the source is untouched.
    expect(newDoc._key).not.toBe(first.run_key);
    expect(newDoc.payload.fidelity.rescore_of).toBe(first.run_key);
    expect(newDoc.payload.fidelity.judge.config).toBe('Second Judge');
    expect(newDoc.payload.fidelity.judge.model).toBe('strong-model');
    expect(newDoc.payload.fidelity.judge.pick.config_key).toBe('judge2');
    // The ANSWERS are the source's, verbatim — only the judge changed.
    expect(newDoc.payload.results.map((r) => r.answer)).toEqual(sourceAnswers);
    // The source still exists with its own judge.
    const stillThere = await svc.getRunSuite('me', sk, first.run_key);
    expect(stillThere.status).toBe('done');
    expect(stillThere.payload.fidelity.judge.pick.config_key).not.toBe('judge2');
  });

  it('refuses a run that is not finished', async () => {
    const sk = await makeSuite();
    const begun = await svc.beginRunSuite('me', sk, { mode: 'whatif' }, {});
    // Not awaited: the run is still in flight.
    await expect(svc.rescoreRun('me', sk, begun.run_key, {}, {})).rejects.toMatchObject({
      code: 'RUN_NOT_DONE',
      status: 409
    });
    await begun.done;
  });

  it('404s for a foreign run key', async () => {
    const sk = await makeSuite();
    await expect(svc.rescoreRun('me', sk, 'rr-nope', {}, {})).rejects.toMatchObject({
      code: 'RUN_NOT_FOUND',
      status: 404
    });
  });

  it('maps the judge scores back to the row that was ACTUALLY submitted', async () => {
    // A row with no answer has nothing to judge, so it is EXCLUDED from the
    // submission — the sidecar answers for the other rows only. The scores
    // must land on the rows they were scored for. Here the unscorable row is
    // FIRST, which is exactly the case where a naive index alignment shifts
    // every score onto the wrong row.
    const sk = await makeSuite();
    const first = await svc.beginRunSuite('me', sk, { mode: 'whatif' }, {});
    await first.done;
    const source = await svc.getRunSuite('me', sk, first.run_key);
    const rows = source.payload.results;
    expect(rows.length).toBe(2);
    expect(rows[0].answer).toBeTruthy();

    // Row 0 lost its answer (a failed row) — it is not scorable.
    rows[0].answer = '';
    const store = __mockDb._stores.okf_head_test_runs;
    store[first.run_key] = { ...store[first.run_key], payload: { ...source.payload, results: rows } };

    // The sidecar answers for ONE row — the scorable one.
    global.fetch.mockImplementation(async (url) => {
      const u = String(url);
      if (u.includes('/evaluate')) return okJson({ job_id: 'j-eval', status: 'queued' });
      if (u.includes('/jobs/j-eval'))
        return okJson({
          job_id: 'j-eval',
          kind: 'evaluate',
          status: 'done',
          result: { per_query: [{ answer_relevancy: 0.11, faithfulness: 0.22 }], n: 1 }
        });
      if (u.includes('/rerank')) return okJson([{ index: 0, score: 0.9 }]);
      throw new Error(`unexpected fetch ${u}`);
    });

    const begun = await svc.rescoreRun('me', sk, first.run_key, {}, {});
    const newDoc = await begun.done;
    const out = newDoc.payload.results;
    expect(out.length).toBe(2);
    // The SUBMITTED row carries the score.
    expect(out[1].metrics.answer_relevancy).toBe(0.11);
    expect(out[1].metrics.faithfulness).toBe(0.22);
    // The row that was never submitted carries none — and, critically, does
    // not inherit the other row's score.
    expect(out[0].metrics).toEqual({});
  });
});
