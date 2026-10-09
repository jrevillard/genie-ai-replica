// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 1-8 MR-B — head-suite-service unit tests: the LLM suite
// generator (guided-JSON contract + the four negative classes of
// Story 1-8b: forbidden / confusable / off-domain / meta, with the
// deterministic random-pool fallback), the curator free-text additions,
// the run aggregation (pass rates with honest-empty semantics for
// negatives, suppression reasons, margins, steals), and the runs
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
  it('merges all four negative classes, labels every row with cls, and persists a suite doc', async () => {
    // Deterministic pool sampling: Math.random()=0 always pops pool[0]
    // → topics [geography, sports, cooking, music] (default n=4).
    const randSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
    try {
      frontmatterService.vllmChatCompletions.mockResolvedValue(
        llmResponse({
          positive: [
            { query: 'breast cancer screening age recommendations', reason: 'topic hit' },
            { query: '', reason: 'dropped — empty' }
          ],
          negative: [{ query: 'hospital bed capacity statistics', expected_repo: 'Kenya Services', reason: 'sibling' }],
          off_domain: [{ topic: 'cooking', query: 'How do I make sourdough bread at home?' }],
          // meta OMITTED by the LLM → the class falls back, never empty
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
      const neg = suite.payload.negative;
      // 1 confusable + 3 forbidden + 4 off-domain + 3 meta fallback
      expect(neg).toHaveLength(11);
      expect(neg.filter((q) => q.cls === 'confusable')).toHaveLength(1);
      const forbidden = neg.filter((q) => q.cls === 'forbidden');
      expect(forbidden).toHaveLength(3);
      expect(forbidden[0].query).toContain('mental-health');
      expect(forbidden[0].source).toBe('forbidden');
      // off-domain: the LLM row for the covered topic, deterministic
      // templates for the topics it skipped; every row keeps its topic
      const off = neg.filter((q) => q.cls === 'off-domain');
      expect(off).toHaveLength(4);
      expect(suite.payload.off_domain_topics).toEqual(['geography', 'sports', 'cooking', 'music']);
      expect(off.find((q) => q.topic === 'cooking')).toMatchObject({
        query: 'How do I make sourdough bread at home?',
        source: 'llm',
        expected_repo: null
      });
      expect(off.find((q) => q.topic === 'geography').query).toBe('Give me a general overview of geography');
      expect(off.find((q) => q.topic === 'sports').query).toBe('Latest news about sports');
      expect(off.find((q) => q.topic === 'music').source).toBe('fallback');
      // meta omitted by the LLM → 3 deterministic fallbacks
      const meta = neg.filter((q) => q.cls === 'meta');
      expect(meta).toHaveLength(3);
      expect(meta.every((q) => q.source === 'fallback')).toBe(true);
      expect(neg.every((q) => q.kind === 'negative')).toBe(true);
      // keywords: strings only
      expect(suite.payload.keywords).toEqual(['screening', 'hearts']);
      // the prompt carries the sibling context + strict format contract
      const prompt = frontmatterService.vllmChatCompletions.mock.calls[0][0][0].content;
      expect(prompt).toContain('NCD Information');
      expect(prompt).toContain('Kenya Services');
      expect(prompt).toContain('"positive"');
      expect(prompt).toContain('"off_domain"');
      expect(prompt).toContain('geography, sports, cooking, music');
      // persisted in the runs collection
      expect(Object.keys(__mockDb._stores.okf_head_test_runs)).toHaveLength(1);
    } finally {
      randSpy.mockRestore();
    }
  });

  it('still builds a full fallback suite when the LLM call fails (honest degradation, classes never empty)', async () => {
    frontmatterService.vllmChatCompletions.mockRejectedValue(new Error('vllm down'));
    __mockDb.query.mockResolvedValue({ all: async () => [] });
    const suite = await svc.generateSuite('me', {}, {});
    expect(suite.payload.positive).toHaveLength(0);
    const neg = suite.payload.negative;
    // 3 forbidden + 4 off-domain templates + 3 meta templates
    expect(neg.filter((q) => q.cls === 'forbidden')).toHaveLength(3);
    expect(neg.filter((q) => q.cls === 'off-domain')).toHaveLength(4);
    expect(neg.filter((q) => q.cls === 'meta')).toHaveLength(3);
    expect(neg.filter((q) => q.cls === 'off-domain').every((q) => q.source === 'fallback')).toBe(true);
    expect(neg.filter((q) => q.cls === 'meta').every((q) => q.source === 'fallback')).toBe(true);
    // solo universe → the confusable class cannot exist
    expect(neg.some((q) => q.cls === 'confusable')).toBe(false);
  });

  it('respects n_negative_random (default 4, capped at 12) and seeds the prompt with the sampled topics', async () => {
    const randSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
    try {
      __mockDb.query.mockResolvedValue({ all: async () => [] });
      frontmatterService.vllmChatCompletions.mockResolvedValue(
        llmResponse({ positive: [], negative: [], keywords: [] })
      );

      const s2 = await svc.generateSuite('me', { n_negative_random: 2 }, {});
      const s12 = await svc.generateSuite('me', { n_negative_random: 99 }, {});
      const sDefault = await svc.generateSuite('me', {}, {});
      expect(s2.payload.negative.filter((q) => q.cls === 'off-domain')).toHaveLength(2);
      expect(s12.payload.negative.filter((q) => q.cls === 'off-domain')).toHaveLength(12);
      expect(sDefault.payload.negative.filter((q) => q.cls === 'off-domain')).toHaveLength(4); // default
      // the prompt lists the sampled topics + asks for the adversarial
      // off-domain class; the call passes adversarial temperature
      const prompt = frontmatterService.vllmChatCompletions.mock.calls[2][0][0].content;
      expect(prompt).toContain('geography, sports, cooking, music');
      expect(prompt).toContain('completely UNRELATED');
      expect(frontmatterService.vllmChatCompletions.mock.calls[2][1]).toMatchObject({ temperature: 0.7 });
    } finally {
      randSpy.mockRestore();
    }
  });

  it('produces NO confusable rows without siblings (the class exists only when competitors exist)', async () => {
    __mockDb.query.mockResolvedValue({ all: async () => [] }); // solo universe
    frontmatterService.vllmChatCompletions.mockResolvedValue(
      llmResponse({
        positive: [],
        negative: [{ query: 'orphan confusable query', expected_repo: '', reason: 'none' }],
        keywords: []
      })
    );
    const suite = await svc.generateSuite('me', {}, {});
    expect(suite.payload.negative.some((q) => q.cls === 'confusable')).toBe(false);
    const prompt = frontmatterService.vllmChatCompletions.mock.calls[0][0][0].content;
    expect(prompt).toContain('NO competing repositories');
  });

  it('uses LLM-authored meta rows when provided (fallback only when the class is omitted)', async () => {
    __mockDb.query.mockResolvedValue({ all: async () => [] });
    frontmatterService.vllmChatCompletions.mockResolvedValue(
      llmResponse({
        positive: [],
        negative: [],
        meta: [
          { query: 'How does the routing lab work?', reason: 'system probe' },
          { query: 'Who maintains the forbidden tags?', reason: 'system probe' }
        ],
        keywords: []
      })
    );
    const suite = await svc.generateSuite('me', {}, {});
    const meta = suite.payload.negative.filter((q) => q.cls === 'meta');
    expect(meta).toHaveLength(2);
    expect(meta.every((q) => q.source === 'llm')).toBe(true);
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

  // ─── Story 1-8b: the four negative classes in the run + suppression reasons ───
  it('1-8b: new classes count as negatives; run rows carry cls/head_claim/tag_veto + suppress_reason', async () => {
    const suite = await seedSuite({ positive: 1, negativeForbidden: 1, negativeRandom: 2, negativeMeta: 1 });
    // Rename the random rows so the mock can key on them (topics are random).
    let i = 0;
    suite.payload.negative.forEach((q) => {
      if (q.cls === 'off-domain') q.query = `off probe ${i++}`;
      if (q.cls === 'meta') q.query = 'meta probe';
    });
    __mockDb.collection('okf_head_test_runs').replace(suite._key, suite);

    headTestService.routingTest.mockImplementation(async (repoId, body) => {
      if (body.query === 'positive query 0') return fakeResult(true, 0.2, 1, 'claimed');
      if (body.query === 'off probe 1') return fakeResult(false, -0.1, 0, 'suppressed', 'veto');
      return fakeResult(false, -0.1, 0, 'suppressed', 'floor'); // forbidden + meta + off probe 0
    });

    const run = await svc.runSuite('me', suite._key, {});
    const s = run.payload.summary;
    expect(s.negative_total).toBe(4); // 1 forbidden + 2 off-domain + 1 meta
    expect(s.negative_evaluatable).toBe(4);
    expect(s.negative_passed).toBe(4); // every row suppressed
    expect(s.pass_rate).toBe(1);

    const rows = run.payload.results;
    const off0 = rows.find((r) => r.query === 'off probe 0');
    expect(off0).toMatchObject({
      cls: 'off-domain',
      head_claim: 'floor',
      tag_veto: null,
      head_claimed: false,
      suppress_reason: 'off-domain'
    });
    const off1 = rows.find((r) => r.query === 'off probe 1');
    expect(off1).toMatchObject({
      cls: 'off-domain',
      head_claim: 'veto',
      tag_veto: 'genetics',
      suppress_reason: 'forbidden:genetics'
    });
    const metaRow = rows.find((r) => r.cls === 'meta');
    expect(metaRow.suppress_reason).toBe('off-domain'); // floor-suppressed
    const pos = rows.find((r) => r.kind === 'positive');
    expect(pos.suppress_reason).toBeNull(); // positives are never "suppressed"
  });

  it('1-8b: summarizeRun treats EVERY non-positive row as a negative across all classes', () => {
    const s = svc._internals.summarizeRun([
      { query: 'p-win', kind: 'positive', under_test_wins_head: true, sibling_count: 2, margin: 0.1 },
      {
        query: 'p-lose',
        kind: 'positive',
        under_test_wins_head: false,
        sibling_count: 2,
        margin: 0.1,
        winner_name: 'Sib'
      },
      {
        query: 'f',
        kind: 'negative',
        cls: 'forbidden',
        head_claimed: false,
        head_claim: 'veto',
        tag_veto: 'genetics',
        sibling_count: 0
      },
      { query: 'o', kind: 'negative', cls: 'off-domain', head_claimed: false, head_claim: 'floor', sibling_count: 0 },
      { query: 'm', kind: 'negative', cls: 'meta', head_claimed: false, head_claim: 'floor', sibling_count: 0 },
      { query: 'c', kind: 'negative', cls: 'confusable', head_claimed: true, head_claim: 'claim', sibling_count: 2 }
    ]);
    expect(s.n_queries).toBe(6);
    expect(s.positive_total).toBe(2);
    expect(s.negative_total).toBe(4);
    expect(s.negative_evaluatable).toBe(4); // gate-era rows evaluate solo
    expect(s.negative_passed).toBe(3); // only the CLAIMED confusable fails
    expect(s.negative_pass_rate).toBeCloseTo(3 / 4, 5);
    expect(s.pass_rate).toBeCloseTo(4 / 6, 5);
    expect(s.steals).toEqual([{ by_repo: 'Sib', count: 1 }]);
  });

  it('captures per-query errors without failing the whole run (cls passthrough on error rows)', async () => {
    const suite = await seedSuite({ positive: 1, negativeForbidden: 1 });
    headTestService.routingTest.mockRejectedValue(new Error('TEI 503'));
    const run = await svc.runSuite('me', suite._key, {});
    expect(run.payload.summary.n_errors).toBe(2);
    expect(run.payload.results.every((r) => r.error === 'TEI 503')).toBe(true);
    expect(run.payload.results.find((r) => r.cls === 'forbidden')).toBeTruthy();
    expect(run.payload.results.find((r) => r.kind === 'positive').cls).toBeNull();
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

function fakeResult(underTestWins, margin, siblingCount, gate = null, headClaim = null) {
  const winner = underTestWins ? 'me' : 'sib1';
  // gate: null = legacy response (pre-1-8a); 'claimed' | 'suppressed' = gate era.
  // headClaim: which condition suppressed ('floor' | 'veto' | 'margin'); 'floor' default.
  const claimed = gate === 'claimed' ? true : gate === 'suppressed' ? false : null;
  const claim = gate === 'claimed' ? 'claim' : gate === 'suppressed' ? headClaim || 'floor' : null;
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
      head_claim: claim,
      tag_veto: claim === 'veto' ? 'genetics' : null,
      max_tag_cosine: claim === 'veto' ? 0.62 : null,
      floor_pass: claim ? claim !== 'floor' : false,
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
      provenance:
        claimed === false
          ? claim === 'floor'
            ? 'head-suppressed (off-domain)'
            : claim === 'veto'
              ? 'head-suppressed (forbidden: genetics)'
              : 'head-suppressed (forbidden/noise)'
          : 'head-only (no graph under test)'
    }
  };
}

async function seedSuite({ positive = 1, negativeForbidden = 1, negativeRandom = 0, negativeMeta = 0 } = {}) {
  frontmatterService.vllmChatCompletions.mockResolvedValue(
    llmResponse({
      positive: Array.from({ length: positive }, (_, i) => ({ query: `positive query ${i}`, reason: 'r' })),
      negative: [],
      keywords: []
    })
  );
  __mockDb.query.mockResolvedValue({ all: async () => [] });
  const suite = await svc.generateSuite('me', {}, {});
  // Trim each negative class to the requested count.
  const neg = suite.payload.negative;
  suite.payload.negative = [
    ...neg.filter((q) => q.cls === 'forbidden').slice(0, negativeForbidden),
    ...neg.filter((q) => q.cls === 'off-domain').slice(0, negativeRandom),
    ...neg.filter((q) => q.cls === 'meta').slice(0, negativeMeta)
  ];
  __mockDb.collection('okf_head_test_runs').replace(suite._key, suite);
  return suite;
}
