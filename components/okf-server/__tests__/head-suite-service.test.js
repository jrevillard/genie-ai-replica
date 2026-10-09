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
  routingTest: jest.fn(),
  guardSuggestions: jest.fn()
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
      // 1 confusable + 3 forbidden + 4 near-miss + 4 off-domain + 3 meta fallback
      expect(neg).toHaveLength(15);
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

// ---------- Story 1-8c: the near-miss class ("similar but wrong") ----------

describe('near-miss negative class (Story 1-8c)', () => {
  const TWO_ENTITY_FM = { entity: ['breast-cancer', 'diabetes'] };

  it('nearMissQueries uses LLM rows first, then fills from entity-templated fallbacks', () => {
    const rows = svc._internals.nearMissQueries(
      [
        { query: 'best hospitals for breast cancer surgery', reason: 'wrong intent: providers' },
        { query: 'treatment costs for breast cancer', reason: 'wrong intent: costs' }
      ],
      { entity: ['breast-cancer'] },
      4
    );
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      query: 'best hospitals for breast cancer surgery',
      kind: 'negative',
      cls: 'near-miss',
      source: 'llm',
      expected_repo: null,
      reason: 'wrong intent: providers'
    });
    // The fallback fills the remainder from the repo's OWN vocabulary.
    expect(rows.slice(2).map((q) => q.source)).toEqual(['fallback', 'fallback']);
    expect(rows.slice(2).every((q) => q.query.includes('breast-cancer'))).toBe(true);
    expect(new Set(rows.map((q) => q.query.toLowerCase())).size).toBe(4); // no duplicate queries
  });

  it('nearMissQueries falls back entirely to entity templates when the LLM omits the class', () => {
    const rows = svc._internals.nearMissQueries([], TWO_ENTITY_FM, 4);
    expect(rows).toHaveLength(4);
    expect(rows.every((q) => q.cls === 'near-miss' && q.source === 'fallback')).toBe(true);
    expect(rows.every((q) => q.kind === 'negative' && q.expected_repo === null)).toBe(true);
    expect(rows.every((q) => /breast-cancer|diabetes/.test(q.query))).toBe(true);
  });

  it('nearMissQueries stays duplicate-free while capping at 10 rows', () => {
    // 5 wrong-intent templates x 2 entities = 10 distinct rows — the cap
    // is reachable without a collision.
    const rows = svc._internals.nearMissQueries([], TWO_ENTITY_FM, 10);
    expect(rows).toHaveLength(10);
    expect(new Set(rows.map((q) => q.query.toLowerCase())).size).toBe(10);
  });

  it('n_near_miss defaults to 4 and caps at 10 (clampCount)', () => {
    expect(svc._internals.clampCount(undefined, 4, 10)).toBe(4);
    expect(svc._internals.clampCount(1, 4, 10)).toBe(1);
    expect(svc._internals.clampCount(99, 4, 10)).toBe(10);
    expect(svc._internals.clampCount('bad', 4, 10)).toBe(4);
  });

  it('generateSuite: LLM near_miss rows flow into the suite and the prompt asks for NEAR-MISS', async () => {
    __mockDb.query.mockResolvedValue({ all: async () => [] });
    frontmatterService.vllmChatCompletions.mockResolvedValue(
      llmResponse({
        positive: [],
        negative: [],
        keywords: [],
        near_miss: [{ query: 'clinical trials recruiting breast cancer patients', reason: 'wrong intent' }]
      })
    );
    const suite = await svc.generateSuite('me', {}, {});
    const nm = suite.payload.negative.filter((q) => q.cls === 'near-miss');
    expect(nm).toHaveLength(4); // default n_near_miss; LLM row first, fallback fills
    expect(nm[0]).toMatchObject({ query: 'clinical trials recruiting breast cancer patients', source: 'llm' });
    const prompt = frontmatterService.vllmChatCompletions.mock.calls[0][0][0].content;
    expect(prompt).toContain('NEAR-MISS');
    expect(prompt).toContain('"near_miss"');
  });

  it('generateSuite: n_meta slices the meta class (n_meta=1 → one row; default 3)', async () => {
    __mockDb.query.mockResolvedValue({ all: async () => [] });
    frontmatterService.vllmChatCompletions.mockResolvedValue(
      llmResponse({
        positive: [],
        negative: [],
        keywords: [],
        meta: [{ query: 'meta one' }, { query: 'meta two' }, { query: 'meta three' }]
      })
    );
    const one = await svc.generateSuite('me', { n_meta: 1 }, {});
    expect(one.payload.negative.filter((q) => q.cls === 'meta')).toHaveLength(1);
    const all = await svc.generateSuite('me', {}, {});
    expect(all.payload.negative.filter((q) => q.cls === 'meta')).toHaveLength(3);
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

// ---------- Story 1-8c: explainSuiteFailures (batch advice, ONE LLM call) ----------

describe('explainSuiteFailures (Story 1-8c — batch advice for the latest run)', () => {
  // The run lookup is the only db.query the explainer makes; the suite
  // itself never needs to exist for this path.
  function mockRunLookup(runDoc) {
    __mockDb.query.mockImplementation(async (aql) => {
      if (aql.includes('r.kind == "run"')) return { all: async () => (runDoc ? [runDoc] : []) };
      return { all: async () => [] };
    });
  }

  function seedRun(results, key = 'r1') {
    return {
      _key: key,
      repo_id: 'me',
      kind: 'run',
      suite_key: 's1',
      created_at: '2026-10-09T00:00:00.000Z',
      payload: { results, summary: { pass_rate: 0.5 } }
    };
  }

  it('ONE vllm call advises on ALL failing negatives: failing_queries carry cls+head_claim, tags normalized/deduped/capped at 5, guardrail-screened (Story 1-8d)', async () => {
    mockRunLookup(
      seedRun([
        {
          query: 'hiv prevalence surveillance data',
          kind: 'negative',
          cls: 'near-miss',
          head_claimed: true,
          head_claim: 'claim'
        },
        {
          query: 'exercise guidelines for seniors',
          kind: 'negative',
          cls: 'forbidden',
          head_claimed: true,
          head_claim: 'claim'
        },
        { query: 'capital of France', kind: 'negative', cls: 'off-domain', head_claimed: false, head_claim: 'floor' },
        { query: 'breast cancer screening age', kind: 'positive', head_claimed: true, head_claim: 'claim' }
      ])
    );
    frontmatterService.vllmChatCompletions.mockResolvedValue(
      llmResponse({
        tags: [
          'Communicable Disease',
          'Mental Health',
          'HIV AIDS',
          'Physical Fitness',
          'Nutrition Science',
          'Hospital Beds'
        ],
        notes: 'covers the failing subjects'
      })
    );
    const GUARD = {
      accepted: ['communicable-disease', 'hiv-aids', 'physical-fitness', 'hospital-beds'],
      rejected: [
        { tag: 'nutrition-science', reason: "too close to the repository's own subject (similarity 0.61 >= 0.55)" }
      ]
    };
    headTestService.guardSuggestions.mockResolvedValue(GUARD);
    const out = await svc.explainSuiteFailures('me', 's1', {});
    expect(out.suite_key).toBe('s1');
    expect(out.run_key).toBe('r1');
    expect(out.run_created_at).toBe('2026-10-09T00:00:00.000Z');
    expect(out.failing_count).toBe(2);
    expect(out.failing_queries).toEqual([
      { query: 'hiv prevalence surveillance data', cls: 'near-miss', head_claim: 'claim' },
      { query: 'exercise guidelines for seniors', cls: 'forbidden', head_claim: 'claim' }
    ]);
    // 'Mental Health' normalizes to 'mental-health' — already forbidden →
    // dropped; the remaining six clean tags are capped at 5 BEFORE the
    // guardrail, whose verdict splits the survivors into chips + rejected.
    expect(out.suggested_tags).toEqual(GUARD.accepted);
    expect(out.rejected).toEqual(GUARD.rejected);
    expect(out.source).toBe('llm');
    expect(out.note).toBe('covers the failing subjects');
    // the guardrail sees the FULL normalized proposal set AND this run's
    // positive queries (the veto-impact simulation input)
    expect(headTestService.guardSuggestions).toHaveBeenCalledTimes(1);
    expect(headTestService.guardSuggestions).toHaveBeenCalledWith('me', expect.any(Array), {
      positiveQueries: ['breast cancer screening age']
    });
    expect(headTestService.guardSuggestions.mock.calls[0][1]).toEqual([
      'communicable-disease',
      'hiv-aids',
      'physical-fitness',
      'nutrition-science',
      'hospital-beds'
    ]);
    // ONE call for the WHOLE batch; the prompt carries only the failing
    // queries — passing negatives and (claimed) positives stay out.
    expect(frontmatterService.vllmChatCompletions).toHaveBeenCalledTimes(1);
    const [messages, opts] = frontmatterService.vllmChatCompletions.mock.calls[0];
    expect(messages[0].content).toContain('hiv prevalence surveillance data');
    expect(messages[0].content).toContain('exercise guidelines for seniors');
    expect(messages[0].content).not.toContain('capital of France');
    expect(messages[0].content).not.toContain('breast cancer screening age');
    expect(messages[0].content).toContain('mental-health');
    expect(opts).toMatchObject({ maxTokens: 300, temperature: 0.2 });
    // Story 1-8d — the advice is persisted as an auditable explain doc.
    const explain = Object.values(__mockDb._stores.okf_head_test_runs).find((d) => d.kind === 'explain');
    expect(explain).toMatchObject({ repo_id: 'me', suite_key: 's1', run_key: 'r1' });
    expect(explain.payload.suggested_tags).toEqual(GUARD.accepted);
    expect(explain.payload.rejected).toEqual(GUARD.rejected);
  });

  it('a fully screened-out proposal set lands as source guardrail — a poisoned chip never forms', async () => {
    // The 2026-10-09 regression shape at the suite level: every LLM
    // proposal dies in the guardrail, so suggested_tags stays empty and
    // the rejections are carried + persisted for the audit trail.
    mockRunLookup(
      seedRun([
        {
          query: 'lung cancer staging details',
          kind: 'negative',
          cls: 'near-miss',
          head_claimed: true,
          head_claim: 'claim'
        }
      ])
    );
    frontmatterService.vllmChatCompletions.mockResolvedValue(llmResponse({ tags: ['Lung Cancer'], notes: '' }));
    headTestService.guardSuggestions.mockResolvedValue({
      accepted: [],
      rejected: [{ tag: 'lung-cancer', reason: "too close to the repository's own subject (similarity 1.00 >= 0.55)" }]
    });
    const out = await svc.explainSuiteFailures('me', 's1', {});
    expect(out.suggested_tags).toEqual([]);
    expect(out.rejected).toEqual([
      { tag: 'lung-cancer', reason: "too close to the repository's own subject (similarity 1.00 >= 0.55)" }
    ]);
    expect(out.source).toBe('guardrail');
    const explain = Object.values(__mockDb._stores.okf_head_test_runs).find((d) => d.kind === 'explain');
    expect(explain.payload.rejected).toHaveLength(1);
  });

  it('positives-only failure: removal_suggestions aggregate tag_veto attribution — no LLM, no additions', async () => {
    // The over-suppression signature: negatives look perfect, positives
    // die. The advice flips to tag REMOVAL, sorted by kill count, and no
    // suggestion model is involved.
    mockRunLookup(
      seedRun([
        { query: 'p1', kind: 'positive', head_claimed: false, tag_veto: 'lung-cancer' },
        { query: 'p2', kind: 'positive', head_claimed: false, tag_veto: 'lung-cancer' },
        { query: 'p3', kind: 'positive', head_claimed: false, tag_veto: 'non-smoking' },
        { query: 'p4', kind: 'positive', head_claimed: false, tag_veto: null }, // margin-killed
        { query: 'p5', kind: 'positive', head_claimed: true } // passing positive — not a kill
      ])
    );
    const out = await svc.explainSuiteFailures('me', 's1', {});
    expect(out.failing_count).toBe(0);
    expect(out.removal_suggestions).toEqual([
      { tag: 'lung-cancer', killed: 2 },
      { tag: 'non-smoking', killed: 1 }
    ]);
    expect(out.positive_failures).toEqual({
      count: 4,
      veto_counts: { 'lung-cancer': 2, 'non-smoking': 1 },
      margin_killed: 1
    });
    expect(out.note).toBe(
      'no wrongly-claimed negatives — the failures are suppressed positives (see removal_suggestions)'
    );
    expect(out.suggested_tags).toEqual([]);
    expect(out.source).toBe('none');
    // the positive-improvement advice names the vetoing tags
    expect(out.improvements).toContain('remove or narrow lung-cancer, non-smoking');
    expect(frontmatterService.vllmChatCompletions).not.toHaveBeenCalled();
    expect(headTestService.guardSuggestions).not.toHaveBeenCalled();
    // still persisted — the cycle stays auditable in every direction
    const explain = Object.values(__mockDb._stores.okf_head_test_runs).find((d) => d.kind === 'explain');
    expect(explain.payload.removal_suggestions).toHaveLength(2);
    expect(explain.payload.positive_failures.count).toBe(4);
  });

  it('404s RUN_NOT_FOUND when the suite has never been run', async () => {
    mockRunLookup(null);
    await expect(svc.explainSuiteFailures('me', 's1', {})).rejects.toMatchObject({
      status: 404,
      code: 'RUN_NOT_FOUND'
    });
  });

  it('zero failures → an honest note, NO LLM call, and nothing persisted', async () => {
    mockRunLookup(
      seedRun([
        { query: 'capital of France', kind: 'negative', cls: 'off-domain', head_claimed: false, head_claim: 'floor' },
        { query: 'breast cancer screening age', kind: 'positive', head_claimed: true }
      ])
    );
    const out = await svc.explainSuiteFailures('me', 's1', {});
    expect(out.failing_count).toBe(0);
    expect(out.suggested_tags).toEqual([]);
    expect(out.source).toBe('none');
    expect(out.note).toBe('no failures in the latest run — nothing to explain');
    expect(frontmatterService.vllmChatCompletions).not.toHaveBeenCalled();
    expect(headTestService.guardSuggestions).not.toHaveBeenCalled();
    // the early return skips the explain-doc persistence — nothing to audit
    expect(Object.values(__mockDb._stores.okf_head_test_runs || {})).toHaveLength(0);
  });

  it('an LLM failure degrades honestly (source none, note, no throw) and still persists the advice', async () => {
    mockRunLookup(
      seedRun([
        { query: 'exercise guidelines', kind: 'negative', cls: 'forbidden', head_claimed: true, head_claim: 'claim' }
      ])
    );
    frontmatterService.vllmChatCompletions.mockRejectedValue(new Error('vllm down'));
    const out = await svc.explainSuiteFailures('me', 's1', {});
    expect(out.suggested_tags).toEqual([]);
    expect(out.source).toBe('none');
    expect(out.note).toContain('unreachable');
    // regression guard: the persist block reads the actor from the (fixed)
    // opts param — an explain doc must land even when the model is down
    const explain = Object.values(__mockDb._stores.okf_head_test_runs).find((d) => d.kind === 'explain');
    expect(explain).toMatchObject({ repo_id: 'me', suite_key: 's1', run_key: 'r1' });
    expect(explain.payload.note).toContain('unreachable');
  });

  it('unparseable LLM output → source none with empty tags', async () => {
    mockRunLookup(
      seedRun([
        { query: 'exercise guidelines', kind: 'negative', cls: 'forbidden', head_claimed: true, head_claim: 'claim' }
      ])
    );
    frontmatterService.vllmChatCompletions.mockResolvedValue(llmResponse({ no_tags_here: true }));
    const out = await svc.explainSuiteFailures('me', 's1', {});
    expect(out.suggested_tags).toEqual([]);
    expect(out.source).toBe('none');
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

// ─── Story 1-8e: the tuning identity + the anti-treadmill damping ──────────

describe('runSuite tagset stamp (1-8e)', () => {
  it('records the forbidden tag set + hash on every run doc (the tuning identity)', async () => {
    const suite = await seedSuite({ positive: 1, negativeForbidden: 1 });
    headTestService.routingTest.mockResolvedValue(fakeResult(true, 0.7, 0, 'claimed'));
    // The run reads the repo doc — give it a frontmatter to stamp from.
    repositoryService.getById.mockResolvedValue({
      _key: 'me',
      name: 'NCD Information',
      version: 3,
      head: { version: 42 },
      frontmatter: FM
    });
    const run = await svc.runSuite('me', suite._key, {});
    expect(run.tagset).toBeTruthy();
    expect(run.tagset.forbidden).toEqual(FM.forbidden);
    expect(run.tagset.hash).toMatch(/^[0-9a-f]{8}$/);
  });

  it('stamps hash "empty" when the repo has no forbidden tags', async () => {
    const suite = await seedSuite({ positive: 1, negativeForbidden: 1 });
    headTestService.routingTest.mockResolvedValue(fakeResult(true, 0.7, 0, 'claimed'));
    repositoryService.getById.mockResolvedValue({
      _key: 'me',
      version: 3,
      head: { version: 42 },
      frontmatter: { ...FM, forbidden: [] }
    });
    const run = await svc.runSuite('me', suite._key, {});
    expect(run.tagset.forbidden).toEqual([]);
    expect(run.tagset.hash).toBe('empty');
  });
});

describe('recommendTagSet damping (1-8e — the anti-treadmill guard)', () => {
  // Orthogonal 7-dim universe: head vector = e1; negatives sit at
  // normalize(e1 + e_i) (cos 0.707 — above the floor, so they CLAIM in the
  // baseline); tag k = e_{k+2} vetoes exactly the negatives aligned with it
  // (cos 0.707 >= 0.55). Nine negatives total: tag-one..tag-three each
  // suppress two, tag-five suppresses two, tag-low suppresses ONE.
  const DIM = 7;
  const unit = (v) => {
    const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
    return v.map((x) => x / n);
  };
  const basis = (i) => unit(Array.from({ length: DIM }, (_, k) => (k === i ? 1 : 0)));
  const HEAD_VEC = basis(0);
  const NEG_DIRS = [1, 1, 2, 2, 3, 3, 4, 4, 5].map((i) =>
    unit([1, ...Array.from({ length: DIM - 1 }, (_, k) => (k === i - 1 ? 1 : 0))])
  ); // cos(head)=0.707 -> claims; cos(tag)=0.707 -> veto
  const TAG_VECS = {
    'tag-one': basis(1),
    'tag-two': basis(2),
    'tag-three': basis(3),
    'tag-five': basis(4),
    'tag-low': basis(5)
  };
  const QUERIES = [
    { query: 'pos one', kind: 'positive', cls: null },
    { query: 'pos two', kind: 'positive', cls: null },
    ...NEG_DIRS.map((_, i) => ({ query: `neg ${i + 1}`, kind: 'negative', cls: 'near-miss' }))
  ];

  function seedAdvisor({ history = [] } = {}) {
    __mockDb.query.mockImplementation(async (aql) => {
      if (aql.includes('r.kind == "run"')) {
        return {
          all: async () => [
            {
              _key: 'r1',
              repo_id: 'me',
              kind: 'run',
              created_at: new Date().toISOString(),
              payload: { results: QUERIES.map((q) => ({ ...q, head_claimed: q.kind === 'positive' })) }
            }
          ]
        };
      }
      return { all: async () => [] };
    });
    repositoryService.getById.mockResolvedValue({
      _key: 'me',
      version: 1,
      frontmatter_history: history,
      head: { version: 9, vector: HEAD_VEC, per_field: { topic: [HEAD_VEC], forbidden_vectors: [] } }
    });
    frontmatterService.teiEmbed.mockImplementation(async (texts) =>
      texts.map((t) => {
        if (TAG_VECS[t]) return TAG_VECS[t];
        if (t.startsWith('neg ')) return NEG_DIRS[Number(t.slice(4)) - 1];
        if (t.startsWith('pos ')) return HEAD_VEC;
        return basis(6); // current tags: orthogonal junk — no gate effect
      })
    );
    frontmatterService.vllmChatCompletions.mockResolvedValue(
      llmResponse({ add: ['tag-low', 'tag-one', 'tag-two', 'tag-three', 'tag-five'] })
    );
  }

  it('damps a one-negative gain, caps adds per run, and reports both in the payload', async () => {
    seedAdvisor();
    const out = await svc.recommendTagSet('me', {});
    // tag-low: suppresses ONE negative → below the 2-gain noise-fit guard.
    const lowEval = out.add_eval.find((e) => e.tag === 'tag-low');
    expect(lowEval.rejected).toMatch(/below the 2-gain noise-fit guard/);
    expect(out.damped_adds).toBe(1);
    // tag-one..three each suppress two → accepted up to the cap of 3.
    expect(out.changes.add).toEqual(['tag-one', 'tag-two', 'tag-three']);
    // tag-five would also suppress two — but the per-run add cap hit first.
    const capEval = out.add_eval.find((e) => e.tag === 'tag-five');
    expect(capEval.rejected).toMatch(/add cap reached/);
    expect(out.damping).toEqual({ min_negative_gain: 2, max_adds: 3 });
    // Predicted scorecard: 6 of 9 negatives suppressed, both positives kept.
    expect(out.recommended_scorecard.negative_suppressed).toBe(6);
    expect(out.recommended_scorecard.positive_claimed).toBe(2);
    expect(out.current_scorecard.negative_suppressed).toBe(0);
  });

  it('baseline: with no LLM candidates nothing is added and the scorecards agree', async () => {
    seedAdvisor();
    frontmatterService.vllmChatCompletions.mockResolvedValue(llmResponse({ add: [] }));
    const out = await svc.recommendTagSet('me', {});
    expect(out.changes.add).toEqual([]);
    expect(out.changes.remove).toEqual([]);
    expect(out.current_scorecard.negative_suppressed).toBe(out.recommended_scorecard.negative_suppressed);
  });
});

// ─── Story 1-8f: suites are savable, modifiable and rerunnable ─────────────

describe('getSuite + updateSuiteRows (1-8f)', () => {
  const ROWS = {
    positive: [
      { query: 'breast cancer screening guidance', kind: 'positive', cls: null, source: 'llm' },
      { query: 'asthma management protocol', kind: 'positive', cls: null, source: 'llm' }
    ],
    negative: [
      { query: 'insurance plans cover screening', kind: 'negative', cls: 'near-miss', source: 'llm' },
      { query: 'HIV causes and symptoms', kind: 'positive', cls: null, source: 'manual' }
    ]
  };

  async function seedRows() {
    const suite = await seedSuite({ positive: 1, negativeForbidden: 1 });
    suite.payload.positive = ROWS.positive.map((r) => ({ ...r }));
    suite.payload.negative = ROWS.negative.map((r) => ({ ...r }));
    __mockDb.collection('okf_head_test_runs').replace(suite._key, suite);
    return suite;
  }

  it('getSuite returns the full saved suite (rows included)', async () => {
    const suite = await seedRows();
    const got = await svc.getSuite('me', suite._key, {});
    expect(got._key).toBe(suite._key);
    expect(got.payload.positive).toHaveLength(2);
    expect(got.payload.negative).toHaveLength(2);
  });

  it('getSuite 404s an unknown key', async () => {
    await expect(svc.getSuite('me', 'nope', {})).rejects.toMatchObject({ code: 'SUITE_NOT_FOUND', status: 404 });
  });

  it('updateSuiteRows flips a row kind (the mislabel fix) — moves arrays, clears cls', async () => {
    const suite = await seedRows();
    const out = await svc.updateSuiteRows(
      'me',
      suite._key,
      { updates: [{ match: { query: 'HIV causes and symptoms', kind: 'positive' }, set: { kind: 'negative' } }] },
      { actor: { user_id: 'u1' } }
    );
    // The mislabeled row lived in the NEGATIVE array with kind:'positive' —
    // the flip searches BOTH arrays; the positive array never held it.
    expect(out.payload.positive).toHaveLength(2);
    expect(out.payload.negative).toHaveLength(2);
    const flipped = out.payload.negative.find((r) => r.query === 'HIV causes and symptoms');
    expect(flipped).toMatchObject({ kind: 'negative', cls: null, source: 'manual' });
  });

  it('updateSuiteRows removes rows and rejects a resulting contradiction (same text both kinds)', async () => {
    const suite = await seedRows();
    // Removing the insurance near-miss is fine.
    const out = await svc.updateSuiteRows('me', suite._key, {
      removes: [{ query: 'insurance plans cover screening', kind: 'negative' }]
    });
    expect(out.payload.negative).toHaveLength(1);
    // A flip that would put the SAME text in both kinds is a contradiction:
    // 'shared text' exists as a positive AND as a mislabeled positive in the
    // negative array — flipping it lands the text in both arrays.
    const s2 = await seedRows();
    s2.payload.positive.push({ query: 'shared text', kind: 'positive', cls: null, source: 'llm' });
    s2.payload.negative.push({ query: 'shared text', kind: 'positive', cls: null, source: 'llm' });
    __mockDb.collection('okf_head_test_runs').replace(s2._key, s2);
    await expect(
      svc.updateSuiteRows('me', s2._key, {
        updates: [{ match: { query: 'shared text', kind: 'positive' }, set: { kind: 'negative' } }]
      })
    // Either 409 guard is a correct refusal here (contradiction OR the
    // text duplicating within one kind — the match is ambiguous input).
    ).rejects.toMatchObject({ status: 409 });
  });

  it('updateSuiteRows 400s an empty body', async () => {
    const suite = await seedRows();
    await expect(svc.updateSuiteRows('me', suite._key, {})).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400
    });
  });
});
