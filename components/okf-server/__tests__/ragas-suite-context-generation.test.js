// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #2061 phase 3 (E-7) — the RAGAS suite is minted FOR a context.
//
// Two things change when a benchmark suite is minted for a context:
//
//   1. the POOL is the carrier's repositories — the caller's `repo_ids` are
//      REPLACED by the carrier, not merged with it (a caller may not widen
//      the corpus beyond what the context names);
//   2. every QUESTION carries the repository it was minted from — the chunk
//      metadata travels with the question, so a report can be split per
//      source repository and a question can be traced to its corpus.
//
// A suite minted without a context is unchanged.

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
const repositoryService = require('../services/repository-service');
const { __mockDb } = require('../shared-lib/db-connection-service');

function okJson(payload) {
  return { ok: true, json: async () => payload, arrayBuffer: async () => new ArrayBuffer(8) };
}

// The corpus each graph serves — distinct texts, so a question's source
// repository is recoverable from the passage it cites.
const CORPUS = {
  GRAPH_AGRI: [{ key: 'a1', text: 'Plant after the last frost date. Tomatoes are a crop.' }],
  GRAPH_LEGAL: [{ key: 'b1', text: 'Legal aid has income criteria. Social protection content.' }]
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

describe('#2061 phase 3 (E-7): the RAGAS suite is minted FOR a context', () => {
  const BINDING = {
    context: { id: 'ctx-1', name: 'group-a', version: 1, hash: 'ctxhash' },
    carrier: {
      context: { id: 'ctx-1', name: 'group-a', version: 1, hash: 'ctxhash' },
      repo_ids: ['r-agri'],
      graph_names: ['GRAPH_AGRI'],
      repos: [{ repo_id: 'r-agri', name: 'Agri', domain: 'agri', graph_name: 'GRAPH_AGRI' }],
      measured_hash: 'measured-hash'
    },
    repos: [{ repo_id: 'r-agri', name: 'Agri', domain: 'agri', graph_name: 'GRAPH_AGRI', head_version: 42 }],
    out_set: [],
    repo_set_hash: 'repo-set-hash',
    head_version_hash: 'head-version-hash'
  };

  beforeEach(() => {
    jest.clearAllMocks();
    __mockDb._reset();
    repositoryService.getById.mockImplementation(async (rid) => ({
      _key: rid,
      repo_id: rid,
      name: rid,
      version: 3,
      head: { version: 42 }
    }));
    global.fetch = jest.fn((url) => {
      const u = String(url);
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
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    __mockDb.query.mockImplementation(async (aql, bind) => {
      if (aql.includes('okf_concepts_meta')) {
        const rid = bind && bind.rid;
        return { all: async () => [rid === 'r-legal' ? 'GRAPH_LEGAL' : 'GRAPH_AGRI'] };
      }
      if (aql.includes('_SOURCE')) {
        const graph = aql.includes('GRAPH_LEGAL') ? 'GRAPH_LEGAL' : 'GRAPH_AGRI';
        const corpus = CORPUS[graph];
        if (aql.includes('COLLECT WITH COUNT')) return { all: async () => [corpus.length] };
        if (/RETURN c\._key\s*$/.test(aql.trim())) return { all: async () => corpus.map((c) => c.key) };
        return { all: async () => corpus.map((c) => ({ key: c.key, text: c.text })) };
      }
      return { all: async () => [] };
    });
  });

  it('the POOL is the carrier — the caller cannot widen it', async () => {
    const { done } = await svc.beginSuiteGeneration(
      'r-agri',
      { repo_ids: ['r-legal'] }, // the caller asks for a wider pool
      { actor: { user_id: 'u1' }, binding: BINDING }
    );
    await done;
    const submit = global.fetch.mock.calls.find((c) => String(c[0]).includes('/generate-testset'));
    const body = JSON.parse(submit[1].body);
    const repos = [...new Set(body.documents.map((d) => d.metadata.repo_id))];
    expect(repos).toEqual(['r-agri']);
  });

  it('every question carries the repository it was minted from', async () => {
    // A pool of BOTH repositories: the questions are told apart by the
    // corpus they were minted from — the stamp comes from the chunk metadata.
    const { done } = await svc.beginSuiteGeneration('r-agri', { repo_ids: ['r-legal'] }, { actor: { user_id: 'u1' } });
    const suite = await done;
    const byQuery = Object.fromEntries(suite.payload.entries.map((e) => [e.query, e]));
    expect(byQuery['When should tomatoes be planted?'].source_repo_id).toBe('r-agri');
    expect(byQuery['When should tomatoes be planted?'].source_chunk_key).toBe('a1');
    expect(byQuery['Who qualifies for legal aid?'].source_repo_id).toBe('r-legal');
    expect(byQuery['Who qualifies for legal aid?'].source_chunk_key).toBe('b1');
  });

  it('a question whose passage is not in the pool is NOT minted (never a guess, never a false failure)', async () => {
    // The carrier's pool holds the agri corpus only. The sidecar still
    // answered with a legal question citing a passage that is not in the
    // corpus — its ground truth is not in the evaluated corpus, so it can
    // never be scored over the carrier: the judge would score a
    // context_recall of ~0 and file a FAILURE that is an artefact of the
    // corpus, not of the system. Such a question is not generated into a
    // context-bound suite at all.
    const { done } = await svc.beginSuiteGeneration('r-agri', {}, { actor: { user_id: 'u1' }, binding: BINDING });
    const suite = await done;
    const byQuery = Object.fromEntries(suite.payload.entries.map((e) => [e.query, e]));
    expect(byQuery['When should tomatoes be planted?'].source_repo_id).toBe('r-agri');
    // The unattributable question is ABSENT — not minted with a null stamp
    // and not silently kept.
    expect(byQuery['Who qualifies for legal aid?']).toBeUndefined();
    expect(suite.payload.entries).toHaveLength(1);
  });

  it('the suite doc stores the context SNAPSHOT and both comparison keys', async () => {
    const { done } = await svc.beginSuiteGeneration('r-agri', {}, { actor: { user_id: 'u1' }, binding: BINDING });
    const suite = await done;
    expect(suite.payload.context).toEqual(
      expect.objectContaining({
        id: 'ctx-1',
        name: 'group-a',
        version: 1,
        repo_set_hash: 'repo-set-hash',
        head_version_hash: 'head-version-hash'
      })
    );
    expect(suite.payload.context.repos.map((r) => r.repo_id)).toEqual(['r-agri']);
  });

  it('a suite minted WITHOUT a context carries no binding — and still stamps its questions', async () => {
    const { done } = await svc.beginSuiteGeneration('r-agri', {}, { actor: { user_id: 'u1' } });
    const suite = await done;
    // No binding: the suite says nothing about a context.
    expect(suite.payload.context).toBeUndefined();
    // The stamp is a property of the QUESTION, not of the binding — it says
    // which corpus the question was minted from, and that is true either way.
    expect(suite.payload.entries[0].source_repo_id).toBe('r-agri');
  });

  // Live 2026-11-25 (David's 20-question benchmark kept 10): Ragas's
  // multi-hop synthesizers prefix EVERY reference context with a literal
  // hop marker — "<1-hop>\n\n" + the chunk's page_content (vendored
  // ragas/testset/synthesizers/multi_hop/base.py, make_contexts). The
  // attribution match keys on the leading characters, so "<1-hop> …"
  // matched no chunk and EVERY multi-hop question (50% of the default
  // mix) was falsely discarded as unattributable although its content is
  // verbatim corpus text. David's rulings: strip the marker; re-ask the
  // shortfall like the head-suite generator (capped, honestly tallied);
  // notify the admin on the suite record.
  it('a MULTI-HOP question (hop-marker-prefixed passages) stamps to its chunk — passages stored clean', async () => {
    const multiHop = [
      {
        user_input: 'How do frost timing and legal aid interact for seasonal workers?',
        reference: 'Plant after the frost; aid depends on income.',
        reference_contexts: [
          '<1-hop>\n\nPlant after the last frost date. Tomatoes are a crop.',
          '<2-hop>\n\nPlant after the last frost date. Tomatoes are a crop.'
        ],
        persona_name: 'agronomist',
        query_style: 'companion',
        query_length: 'medium',
        synthesizer_name: 'multi_hop_specific'
      }
    ];
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/generate-testset')) {
        return Promise.resolve(okJson({ job_id: 'j-gen', status: 'queued', poll: '/jobs/j-gen' }));
      }
      if (u.includes('/jobs/j-gen')) {
        return Promise.resolve(
          okJson({
            job_id: 'j-gen',
            kind: 'generate-testset',
            status: 'done',
            result: { samples: multiHop, generator: { model: 'm', embed_model: 'e' } }
          })
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    const { done } = await svc.beginSuiteGeneration('r-agri', {}, { actor: { user_id: 'u1' }, binding: BINDING });
    const suite = await done;
    expect(suite.payload.entries).toHaveLength(1);
    expect(suite.payload.entries[0].source_repo_id).toBe('r-agri');
    expect(suite.payload.entries[0].source_chunk_key).toBe('a1');
    // The stored passages are the chunk text — Ragas's hop marker is
    // plumbing, never corpus content.
    expect(suite.payload.entries[0].reference_passages[0]).not.toContain('<1-hop>');
    expect(suite.payload.entries[0].reference_passages[0]).toContain('Plant after the last frost');
  });

  it('the shortfall is RE-ASKED (capped) and the suite records the honest tally', async () => {
    // Requested 4. Pass 1 answers 2 attributable + 1 unattributable (a
    // passage that is in NO corpus). Pass 2 is asked for the shortfall (2)
    // and answers 2 attributable — the request is fulfilled.
    const good = (n) => ({
      user_input: `Question number ${n}?`,
      reference: `Answer ${n}.`,
      reference_contexts: ['Plant after the last frost date. Tomatoes are a crop.'],
      persona_name: 'agronomist',
      query_style: 'web-search',
      query_length: 'short',
      synthesizer_name: 'single_hop_specific'
    });
    const ungroundable = {
      user_input: 'What is outside every corpus?',
      reference: 'Nothing measurable.',
      reference_contexts: ['This passage exists in no corpus document at all.'],
      persona_name: 'auditor',
      query_style: 'chat',
      query_length: 'short',
      synthesizer_name: 'single_hop_specific'
    };
    const passes = [{ samples: [good(1), good(2), ungroundable] }, { samples: [good(3), good(4)] }];
    let submitCount = 0;
    let currentJob = 'j-1';
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/generate-testset')) {
        submitCount += 1;
        currentJob = `j-${submitCount}`;
        return Promise.resolve(okJson({ job_id: currentJob, status: 'queued', poll: `/jobs/${currentJob}` }));
      }
      if (u.includes('/jobs/j-')) {
        const pass = passes[submitCount - 1];
        return Promise.resolve(
          okJson({
            job_id: currentJob,
            kind: 'generate-testset',
            status: 'done',
            result: { samples: pass.samples, generator: { model: 'm', embed_model: 'e' } }
          })
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    const { done } = await svc.beginSuiteGeneration(
      'r-agri',
      { testset_size: 4 },
      { actor: { user_id: 'u1' }, binding: BINDING }
    );
    const suite = await done;
    // The request was FULFILLED: 4 entries.
    expect(suite.payload.entries).toHaveLength(4);
    // The re-ask asked for exactly the shortfall.
    expect(submitCount).toBe(2);
    const submits = global.fetch.mock.calls.filter((c) => String(c[0]).includes('/generate-testset'));
    const secondBody = JSON.parse(submits[1][1].body);
    expect(secondBody.testset_size).toBe(2);
    // The honest tally rides the suite record (David: the admin must be
    // notified of any drop — on the record, not in a log).
    expect(suite.payload.dimensions.grounding).toEqual({
      requested: 4,
      kept: 4,
      discarded_unattributed: 1,
      discarded_duplicate: 0,
      rounds: 2
    });
  });

  it('the re-ask is CAPPED — a corpus that cannot ground more stops and says so', async () => {
    // Requested 3. Every pass answers 1 attributable + 1 ungroundable.
    // After the first pass + the 3 re-ask rounds (4 submits), the loop
    // stops: kept 2? no — each pass adds exactly 1 kept, so 4 passes keep 4
    // — request 3 fulfilled on pass 3. Make the request 5 so the cap binds:
    // 4 passes keep 4 of 5, and the tally names the stop.
    const good = (n) => ({
      user_input: `Capped question ${n}?`,
      reference: `Answer ${n}.`,
      reference_contexts: ['Plant after the last frost date. Tomatoes are a crop.'],
      persona_name: 'agronomist',
      query_style: 'web-search',
      query_length: 'short',
      synthesizer_name: 'single_hop_specific'
    });
    const ungroundableFor = (n) => ({
      user_input: `Still outside every corpus, round ${n}?`,
      reference: 'Still nothing.',
      reference_contexts: ['A passage no corpus document contains.'],
      persona_name: 'auditor',
      query_style: 'chat',
      query_length: 'short',
      synthesizer_name: 'single_hop_specific'
    });
    let submitCount = 0;
    let currentJob = 'j-1';
    global.fetch = jest.fn((url) => {
      const u = String(url);
      if (u.includes('/generate-testset')) {
        submitCount += 1;
        currentJob = `j-${submitCount}`;
        return Promise.resolve(okJson({ job_id: currentJob, status: 'queued', poll: `/jobs/${currentJob}` }));
      }
      if (u.includes('/jobs/j-')) {
        return Promise.resolve(
          okJson({
            job_id: currentJob,
            kind: 'generate-testset',
            status: 'done',
            result: {
              samples: [good(submitCount), ungroundableFor(submitCount)],
              generator: { model: 'm', embed_model: 'e' }
            }
          })
        );
      }
      return Promise.reject(new Error(`unexpected fetch ${u}`));
    });
    const { done } = await svc.beginSuiteGeneration(
      'r-agri',
      { testset_size: 5 },
      { actor: { user_id: 'u1' }, binding: BINDING }
    );
    const suite = await done;
    // The cap: ONE first pass + THREE re-asks, never more.
    expect(submitCount).toBe(4);
    expect(suite.payload.entries).toHaveLength(4);
    expect(suite.payload.dimensions.grounding).toEqual({
      requested: 5,
      kept: 4,
      discarded_unattributed: 4,
      discarded_duplicate: 0,
      rounds: 4
    });
  });
});
