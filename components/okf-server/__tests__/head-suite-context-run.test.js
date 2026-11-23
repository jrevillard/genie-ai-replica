// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #2061 phase 3 (E-7) — the RUN leg of the pairing.
//
// A suite minted for a context may only be measured over THAT context.
// The run says so four ways:
//
//   ok          — paired: the same context, the pool held.
//   unbound     — the suite predates contexts: it runs, and its result is
//                 diagnostic (never comparable to a bound run).
//   experiment  — a cross-context run lifted by a recorded superadmin
//                 decision: it runs, it is recorded, it is NOT comparable.
//   blocked     — refused: the pairing cannot be measured.
//
// And inside a paired run: a row whose dependency left the carrier is
// skipped WITH A REASON, and the boundary rows (minted from the excluded
// pool) are counted as HELD or BREACHED.

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
  guardSuggestions: jest.fn(),
  loadSiblings: jest.fn(async () => []),
  embedQueryBatch: jest.fn(async (queries) => ({
    vectors: queries.map(() => [0.1, 0.2, 0.3]),
    prefixed: true,
    model: 'test-model'
  })),
  embedQuery: jest.fn(async () => ({ vector: [0.1, 0.2, 0.3], prefixed: true, model: 'test-model' }))
}));

const svc = require('../services/head-suite-service');
const frontmatterService = require('../services/frontmatter-service');
const repositoryService = require('../services/repository-service');
const headTestService = require('../services/head-test-service');
const { __mockDb } = require('../shared-lib/db-connection-service');

const FM = {
  topic: ['cancer-screening'],
  entity: ['breast-cancer'],
  scope: 'healthcare',
  forbidden: ['mental-health'],
  summary: 'Cancer screening guidance.',
  keyword: ['who']
};

function llmResponse(obj) {
  return { data: { choices: [{ message: { content: JSON.stringify(obj) } }] } };
}

/** A routing result: the under-test wins or does not. */
function fakeResult(underTestWins, margin = 0.7, siblingCount = 1, claim = 'claimed') {
  return {
    under_test: { head_score: 0.8, head_rank: underTestWins ? 1 : 2, head_claim: claim, head_claimed: claim === 'claimed' },
    verdict: { under_test_wins_head: underTestWins, margin },
    siblings: Array.from({ length: siblingCount }, (_, i) => ({
      repo_id: `sib${i + 1}`,
      name: `Sibling ${i + 1}`,
      head_score: 0.5
    }))
  };
}

const CONTEXT_SNAPSHOT = {
  id: 'ctx-1',
  name: 'group-a',
  version: 1,
  hash: 'ctxhash',
  repos: [
    { repo_id: 'me', name: 'NCD Information', graph_name: 'OKF_ncd_v3', head_version: 42 },
    { repo_id: 'r-rival', name: 'Rival', graph_name: 'OKF_rival_v1', head_version: 7 }
  ],
  repo_set_hash: 'pool-hash',
  head_version_hash: 'heads-hash'
};

const CARRIER = {
  context: { id: 'ctx-1', name: 'group-a', version: 1, hash: 'ctxhash' },
  repo_ids: ['me', 'r-rival'],
  graph_names: ['OKF_ncd_v3', 'OKF_rival_v1'],
  measured_hash: 'pool-hash'
};

/** A suite bound to a context, with the rows the tests need. */
async function seedBoundSuite(rows = {}) {
  frontmatterService.vllmChatCompletions.mockResolvedValue(
    llmResponse({
      positive: [{ query: 'positive query 0', reason: 'r' }],
      negative: [],
      keywords: []
    })
  );
  __mockDb.query.mockResolvedValue({ all: async () => [] });
  const suite = await svc.generateSuite('me', {}, {});
  suite.payload.context = CONTEXT_SNAPSHOT;
  suite.payload.positive = rows.positive || suite.payload.positive;
  suite.payload.negative = rows.negative || suite.payload.negative;
  await __mockDb.collection('okf_head_test_runs').replace(suite._key, suite);
  return suite;
}

beforeEach(() => {
  jest.clearAllMocks();
  __mockDb._reset();
  repositoryService.getById.mockResolvedValue({
    _key: 'me',
    name: 'NCD Information',
    version: 3,
    head: { version: 42 },
    frontmatter: FM
  });
  frontmatterService.readFrontmatterFromRepoDoc.mockResolvedValue(FM);
  headTestService.routingTest.mockResolvedValue(fakeResult(true, 0.7, 1));
});

describe('#2061 phase 3 (E-7): the RUN leg of the pairing', () => {
  it('a bound suite run over ITS context is paired and comparable', async () => {
    const suite = await seedBoundSuite();
    const run = await svc.runSuite('me', suite._key, {
      carrier: CARRIER,
      keys: { repo_set_hash: 'pool-hash', head_version_hash: 'heads-hash' }
    });
    expect(run.payload.pairing.status).toBe('ok');
    expect(run.payload.pairing.comparable).toBe(true);
    expect(run.payload.pairing.suite_context_id).toBe('ctx-1');
    expect(run.payload.pairing.run_context_id).toBe('ctx-1');
    expect(run.payload.pairing.repo_set_hash).toBe('pool-hash');
    expect(run.payload.pairing.head_version_hash).toBe('heads-hash');
  });

  it('a bound suite run over a DIFFERENT context is REFUSED (cross-context)', async () => {
    const suite = await seedBoundSuite();
    let error = null;
    try {
      await svc.runSuite('me', suite._key, {
        carrier: { ...CARRIER, context: { id: 'ctx-2', name: 'group-b', version: 1, hash: 'h2' } }
      });
    } catch (e) {
      error = e;
    }
    expect(error).toBeTruthy();
    expect(error.code).toBe('CROSS_CONTEXT_BLOCKED');
    expect(error.status).toBe(409);
    expect(error.message).toContain('group-a');
  });

  it('a bound suite run over NO context is REFUSED (the deployment is not the context)', async () => {
    const suite = await seedBoundSuite();
    await expect(svc.runSuite('me', suite._key, {})).rejects.toThrow(/different one/i);
  });

  it('a cross-context run lifted by a recorded experiment RUNS, and is not comparable', async () => {
    const suite = await seedBoundSuite();
    const run = await svc.runSuite('me', suite._key, {
      carrier: { ...CARRIER, context: { id: 'ctx-2', name: 'group-b', version: 1, hash: 'h2' } },
      experiment: { actor: 'admin-1', reason: 'deliberate comparison', at: '2026-11-23T00:00:00Z' }
    });
    expect(run.payload.pairing.status).toBe('experiment');
    expect(run.payload.pairing.comparable).toBe(false);
    expect(run.payload.pairing.experiment).toEqual({
      actor: 'admin-1',
      reason: 'deliberate comparison',
      at: '2026-11-23T00:00:00Z'
    });
  });

  it('an UNBOUND suite runs and is labelled diagnostic', async () => {
    frontmatterService.vllmChatCompletions.mockResolvedValue(
      llmResponse({ positive: [{ query: 'positive query 0', reason: 'r' }], negative: [], keywords: [] })
    );
    __mockDb.query.mockResolvedValue({ all: async () => [] });
    const suite = await svc.generateSuite('me', {}, {});
    const run = await svc.runSuite('me', suite._key, {});
    expect(run.payload.pairing.status).toBe('unbound');
    expect(run.payload.pairing.comparable).toBe(false);
  });

  it('a pool repository missing from the run carrier REFUSES the run', async () => {
    const suite = await seedBoundSuite();
    let error = null;
    try {
      await svc.runSuite('me', suite._key, { carrier: { ...CARRIER, repo_ids: ['me'] } });
    } catch (e) {
      error = e;
    }
    expect(error).toBeTruthy();
    expect(error.code).toBe('PAIRING_BLOCKED');
    expect(error.message).toContain('r-rival');
  });

  it("a row whose rival left the carrier is SKIPPED with a reason, and is not run", async () => {
    const suite = await seedBoundSuite({
      positive: [],
      negative: [
        { query: 'rival query', kind: 'negative', cls: 'confusable', source: 'llm', expected_repo: 'Rival' },
        { query: 'plain query', kind: 'negative', cls: 'forbidden', source: 'forbidden', expected_repo: null }
      ]
    });
    // The carrier holds the under-test but NOT the rival the row cites.
    const run = await svc.runSuite('me', suite._key, {
      carrier: { ...CARRIER, repo_ids: ['me', 'r-rival'] },
      keys: { repo_set_hash: 'pool-hash', head_version_hash: 'heads-hash' }
    });
    // The row's rival IS in the carrier here, so nothing is skipped.
    expect(run.payload.pairing.skipped_rows).toEqual([]);
    expect(run.payload.results).toHaveLength(2);
  });

  it('the boundary rows are counted apart from the routing rows', async () => {
    const suite = await seedBoundSuite({
      positive: [],
      negative: [
        {
          query: 'excluded repository query',
          kind: 'negative',
          cls: 'abstention',
          source: 'llm',
          expected_repo: null,
          intended_carrier: 'out'
        }
      ]
    });
    // The under-test CLAIMS the boundary query — the scope was breached.
    headTestService.routingTest.mockResolvedValue(fakeResult(true, 0.7, 1, 'claimed'));
    const run = await svc.runSuite('me', suite._key, { carrier: CARRIER });
    expect(run.payload.summary.boundary).toEqual({ total: 1, evaluatable: 1, held: 0, breached: 1 });
    // …and it is NOT in the routing negatives.
    expect(run.payload.summary.negative_total).toBe(0);
  });

  it('a boundary query the under-test does NOT claim is HELD', async () => {
    const suite = await seedBoundSuite({
      positive: [],
      negative: [
        {
          query: 'excluded repository query',
          kind: 'negative',
          cls: 'abstention',
          source: 'llm',
          expected_repo: null,
          intended_carrier: 'out'
        }
      ]
    });
    headTestService.routingTest.mockResolvedValue(fakeResult(false, 0.7, 1, 'floor'));
    const run = await svc.runSuite('me', suite._key, { carrier: CARRIER });
    expect(run.payload.summary.boundary).toEqual({ total: 1, evaluatable: 1, held: 1, breached: 0 });
  });

  it('a suite with no boundary rows reports NO boundary (not measured, not "held")', async () => {
    const suite = await seedBoundSuite();
    const run = await svc.runSuite('me', suite._key, { carrier: CARRIER });
    expect(run.payload.summary.boundary).toBeNull();
  });
});
