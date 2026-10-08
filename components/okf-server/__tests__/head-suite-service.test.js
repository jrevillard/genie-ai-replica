// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 1-8 MR-B — head-suite-service unit tests: the LLM suite
// generator (guided-JSON contract + forbidden-derived negatives), the
// curator free-text additions, the run aggregation (pass rates with
// honest-empty semantics for negatives, margins, steals), and the runs
// listing. vLLM/TEI/Arango mocked.

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
  routingTest: jest.fn()
}));

const svc = require('../services/head-suite-service');
const frontmatterService = require('../services/frontmatter-service');
const repositoryService = require('../services/repository-service');
const headTestService = require('../services/head-test-service');
const { __mockDb } = require('../shared-lib/db-connection-service');

const FM = {
  topic: ['cancer-screening', 'cardiovascular-disease'],
  entity: ['breast-cancer'],
  scope: 'healthcare',
  forbidden: ['mental-health', 'nutrition', 'exercise'],
  summary: 'Cancer screening and CVD guidance.',
  keyword: ['who']
};

function llmResponse(obj) {
  return { data: { choices: [{ message: { content: JSON.stringify(obj) } }] } };
}

beforeEach(() => {
  jest.clearAllMocks();
  __mockDb._reset();
  repositoryService.getById.mockResolvedValue({
    _key: 'me',
    name: 'NCD Information',
    version: 3,
    head: { version: 42 }
  });
  frontmatterService.readFrontmatterFromRepoDoc.mockResolvedValue(FM);
});

describe('generateSuite', () => {
  it('merges LLM positives/negatives with forbidden-derived negatives and persists a suite doc', async () => {
    frontmatterService.vllmChatCompletions.mockResolvedValue(
      llmResponse({
        positive: [
          { query: 'breast cancer screening age recommendations', reason: 'topic hit' },
          { query: '', reason: 'dropped — empty' }
        ],
        negative: [{ query: 'hospital bed capacity statistics', expected_repo: 'Kenya Services', reason: 'sibling' }],
        keywords: ['screening', 'hearts', 42]
      })
    );
    // Sibling context query (repos with heads).
    __mockDb.query.mockImplementation(async (aql) => {
      if (aql.includes('r.head != null')) {
        return { all: async () => [{ repo_id: 'sib1', name: 'Kenya Services', text: 'Kenya gov services' }] };
      }
      return { all: async () => [] };
    });

    const suite = await svc.generateSuite('me', { n_positive: 5, n_negative: 4 }, { actor: { user_id: 'u1' } });
    expect(suite.kind).toBe('suite');
    expect(suite.repo_id).toBe('me');
    expect(suite.created_by).toBe('u1');
    expect(suite.head_version).toBe(42);
    expect(suite.payload.positive).toHaveLength(1); // empty query dropped
    expect(suite.payload.positive[0]).toMatchObject({ kind: 'positive', source: 'llm' });
    // 1 LLM negative + forbidden-derived (3 forbidden tags → 3 queries)
    expect(suite.payload.negative).toHaveLength(4);
    const forbidden = suite.payload.negative.filter((n) => n.source === 'forbidden');
    expect(forbidden).toHaveLength(3);
    expect(forbidden[0].query).toContain('mental-health');
    // keywords: strings only
    expect(suite.payload.keywords).toEqual(['screening', 'hearts']);
    // the prompt carries the sibling context + strict format contract
    const prompt = frontmatterService.vllmChatCompletions.mock.calls[0][0][0].content;
    expect(prompt).toContain('NCD Information');
    expect(prompt).toContain('Kenya Services');
    expect(prompt).toContain('"positive"');
    // persisted in the runs collection
    expect(Object.keys(__mockDb._stores.okf_head_test_runs)).toHaveLength(1);
  });

  it('still builds a forbidden-only suite when the LLM call fails (honest degradation)', async () => {
    frontmatterService.vllmChatCompletions.mockRejectedValue(new Error('vllm down'));
    __mockDb.query.mockResolvedValue({ all: async () => [] });
    const suite = await svc.generateSuite('me', {}, {});
    expect(suite.payload.positive).toHaveLength(0);
    expect(suite.payload.negative).toHaveLength(3); // forbidden-derived only
  });

  it('409s without stored frontmatter', async () => {
    frontmatterService.readFrontmatterFromRepoDoc.mockResolvedValue(null);
    await expect(svc.generateSuite('me', {}, {})).rejects.toMatchObject({ status: 409, code: 'NO_FRONTMATTER' });
  });
});

describe('addQueries (curator free-text)', () => {
  it('appends manual positives/negatives to the suite and rejects bad input', async () => {
    const suite = await seedSuite();
    const updated = await svc.addQueries(
      'me',
      suite._key,
      {
        queries: [
          { query: 'mma fight schedule', kind: 'negative', reason: 'curator probe' },
          { query: '', kind: 'positive' }
        ]
      },
      {}
    );
    const manualNeg = updated.payload.negative.find((q) => q.query === 'mma fight schedule');
    expect(manualNeg).toMatchObject({ source: 'manual', kind: 'negative' });
    await expect(svc.addQueries('me', suite._key, { queries: [] }, {})).rejects.toMatchObject({ status: 400 });
    await expect(
      svc.addQueries('me', 'nope', { queries: [{ query: 'x', kind: 'positive' }] }, {})
    ).rejects.toMatchObject({
      status: 404
    });
  });
});

describe('runSuite + summarizeRun', () => {
  it('runs every query through routingTest and aggregates honest metrics', async () => {
    const suite = await seedSuite({ positive: 3, negativeForbidden: 3 });
    // Universe: two siblings with heads (negatives evaluatable).
    // Deterministic per-query behavior: positives 0..1 win, positive 2
    // LOSES to the sibling (a steal).
    let posCalls = 0;
    headTestService.routingTest.mockImplementation(async (repoId, body) => {
      const isPositive = suite.payload.positive.some((q) => q.query === body.query);
      if (!isPositive) return fakeResult(false, 0.4, 2); // negatives: sibling wins → pass
      const wins = posCalls < 2;
      posCalls += 1;
      return fakeResult(wins, wins ? 0.31 : 0.28, 2);
    });

    const run = await svc.runSuite('me', suite._key, { actor: { user_id: 'u1' } });
    expect(run.kind).toBe('run');
    expect(run.suite_key).toBe(suite._key);
    expect(run.payload.results).toHaveLength(6);
    const s = run.payload.summary;
    expect(s.n_queries).toBe(6);
    expect(s.positive_total).toBe(3);
    expect(s.positive_passed).toBe(2);
    expect(s.positive_pass_rate).toBeCloseTo(2 / 3, 5);
    expect(s.negative_total).toBe(3);
    expect(s.negative_evaluatable).toBe(3); // sibling_count 2 > 0
    expect(s.negative_pass_rate).toBe(1); // sibling always won
    expect(s.pass_rate).toBeCloseTo(5 / 6, 5);
    expect(s.avg_margin).toBeGreaterThan(0);
    expect(s.steals).toEqual([{ by_repo: 'Sibling Repo', count: 1 }]);
    // persisted run doc
    expect(Object.keys(__mockDb._stores.okf_head_test_runs)).toHaveLength(2); // suite + run
  });

  it('reports negative metrics as null in a one-repo universe (never fake 100%)', async () => {
    // Story 1-8a — the gate makes negatives meaningful in any universe. A
    // legacy response (no head_claimed) in a one-repo universe still
    // cannot fail-select (the rank-gated floor is the honest output);
    // the gate-era path is exercised in the two tests below.
    const suite = await seedSuite({ positive: 1, negativeForbidden: 1 });
    headTestService.routingTest.mockResolvedValue(fakeResult(true, 0.7, 0)); // legacy: no head_claimed field
    const run = await svc.runSuite('me', suite._key, {});
    const s = run.payload.summary;
    expect(s.sibling_count).toBe(0);
    expect(s.positive_pass_rate).toBe(1);
    expect(s.negative_evaluatable).toBe(0);
    expect(s.negative_pass_rate).toBeNull();
    expect(s.avg_margin).toBeNull(); // solo-race margin is an artifact
  });

  // ─── Story 1-8a: the gate makes negatives meaningful in ANY universe ───
  it('gate-era: a negative PASSES in a one-repo universe when the head is suppressed', async () => {
    // David's ruling: "fun in Indonesia" → head_claimed=false → negative
    // passes (works solo). Same head-claimed, sibling_count=0.
    const suite = await seedSuite({ positive: 1, negativeForbidden: 1 });
    const posCall = { n: 0 };
    headTestService.routingTest.mockImplementation(async () => {
      posCall.n += 1;
      return posCall.n === 1 ? fakeResult(true, 0.7, 0, 'claimed') : fakeResult(false, 0.05, 0, 'suppressed');
    });
    const run = await svc.runSuite('me', suite._key, {});
    const s = run.payload.summary;
    expect(s.sibling_count).toBe(0);
    expect(s.positive_pass_rate).toBe(1);
    // The negative now reports a pass rate (gate works solo, not the legacy
    // "evaluatable = 0 with no siblings" floor).
    expect(s.negative_evaluatable).toBe(1);
    expect(s.negative_pass_rate).toBe(1);
    expect(s.pass_rate).toBe(1);
  });

  it('gate-era: a negative FAILS when the head claims it (borderline IN — genetics ruling)', async () => {
    const suite = await seedSuite({ positive: 0, negativeForbidden: 1 });
    headTestService.routingTest.mockResolvedValue(fakeResult(true, 0.05, 0, 'claimed'));
    const run = await svc.runSuite('me', suite._key, {});
    const s = run.payload.summary;
    expect(s.negative_evaluatable).toBe(1);
    expect(s.negative_passed).toBe(0);
    expect(s.negative_pass_rate).toBe(0);
  });

  it('captures per-query errors without failing the whole run', async () => {
    const suite = await seedSuite({ positive: 2, negativeForbidden: 0 });
    headTestService.routingTest.mockRejectedValue(new Error('TEI 503'));
    const run = await svc.runSuite('me', suite._key, {});
    expect(run.payload.summary.n_errors).toBe(2);
    expect(run.payload.results.every((r) => r.error === 'TEI 503')).toBe(true);
  });

  it('404s for an unknown suite', async () => {
    await expect(svc.runSuite('me', 'missing', {})).rejects.toMatchObject({ status: 404, code: 'SUITE_NOT_FOUND' });
  });
});

describe('listRuns', () => {
  it('returns run summaries newest first (query passthrough)', async () => {
    __mockDb.query.mockResolvedValue({
      all: async () => [
        { _key: 'r2', summary: { pass_rate: 0.9 }, positives: 3 },
        { _key: 'r1', summary: null, positives: null }
      ]
    });
    const runs = await svc.listRuns('me', { limit: 5, kind: 'run' });
    expect(runs).toHaveLength(2);
    const aql = __mockDb.query.mock.calls[0][0];
    expect(aql).toContain('okf_head_test_runs');
    expect(aql).toContain('FILTER d.kind == @kind');
    // the @kind bind var is present when the filter clause is
    expect(__mockDb.query.mock.calls[0][1]).toMatchObject({ rid: 'me', kind: 'run', lim: 5 });
  });

  it('kind=all OMITS the filter clause AND the unused bind var (Arango rejects undeclared bind params)', async () => {
    __mockDb.query.mockResolvedValue({ all: async () => [] });
    await svc.listRuns('me', { kind: 'all' });
    const [aql, bindVars] = __mockDb.query.mock.calls[0];
    expect(aql).not.toContain('@kind');
    expect(bindVars).not.toHaveProperty('kind');
  });
});

// ---------- helpers ----------

function fakeResult(underTestWins, margin, siblingCount, gate = null) {
  const winner = underTestWins ? 'me' : 'sib1';
  // gate: null = legacy response (pre-1-8a); 'claimed' | 'suppressed' = gate era.
  const claimed = gate === 'claimed' ? true : gate === 'suppressed' ? false : null;
  return {
    query: '',
    embedded_with: 'test',
    under_test: {
      repo_id: 'me',
      name: 'NCD Information',
      head_score: 0.5,
      head_rank: underTestWins ? 1 : 2,
      forbidden_cosine: gate ? 0.45 : null,
      head_margin: gate ? (claimed ? 0.05 : -0.02) : null,
      head_claimed: claimed
    },
    siblings: Array.from({ length: siblingCount }, (_, i) => ({
      repo_id: i === 0 ? 'sib1' : 'sib2',
      name: i === 0 ? 'Sibling Repo' : 'Sibling Two',
      head_score: 0.4
    })),
    verdict: {
      head_routing_winner: claimed === false ? null : winner,
      under_test_wins_head: underTestWins && claimed !== false,
      head_suppressed: claimed === false,
      margin,
      provenance: claimed === false ? 'head-suppressed (forbidden/noise)' : 'head-only (no graph under test)'
    }
  };
}

async function seedSuite({ positive = 1, negativeForbidden = 1 } = {}) {
  frontmatterService.vllmChatCompletions.mockResolvedValue(
    llmResponse({
      positive: Array.from({ length: positive }, (_, i) => ({ query: `positive query ${i}`, reason: 'r' })),
      negative: [],
      keywords: []
    })
  );
  __mockDb.query.mockResolvedValue({ all: async () => [] });
  const suite = await svc.generateSuite('me', {}, {});
  // Trim the forbidden-derived negatives to the requested count.
  suite.payload.negative = suite.payload.negative.slice(0, negativeForbidden);
  __mockDb.collection('okf_head_test_runs').replace(suite._key, suite);
  return suite;
}
