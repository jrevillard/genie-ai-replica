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
  guardSuggestions: jest.fn(),
  // 1-8g-b: the advisor's simulation embeds through the GATE's prefixed
  // contract now — the mock returns one vector per query by default.
  embedQueryBatch: jest.fn(async (queries) => ({
    vectors: queries.map(() => [0.1, 0.2, 0.3]),
    prefixed: true,
    model: 'test-model'
  }))
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

  it('respects n_negative_random (default 4; 99 requested delivers 99 — the 1-8f uncapped pool)', async () => {
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
      // 1-8f asked for an uncapped pool; 1-8g-h SUPERSEDES the cycling:
      // the finite topic pool cycles to the same TEXTS, and duplicate rows
      // are suite noise (live: 16/66 rows duplicated) — the delivered rows
      // are UNIQUE texts, never padded copies.
      const off12 = s12.payload.negative.filter((q) => q.cls === 'off-domain');
      expect(off12.length).toBe(new Set(off12.map((q) => q.query.trim().toLowerCase())).size);
      expect(off12.length).toBeLessThan(99);
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

  it('uses LLM-authored meta rows first, then fills to the requested count (1-8f)', async () => {
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
    // 1-8f: meta fills to the requested count (default 3) — 2 LLM rows +
    // 1 deterministic fallback; LLM rows always come first.
    expect(meta).toHaveLength(3);
    expect(meta.slice(0, 2).every((q) => q.source === 'llm')).toBe(true);
    expect(meta[2].source).toBe('fallback');
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
    expect(opts).toMatchObject({ maxTokens: 800, temperature: 0.2 }); // 800 since 2026-10-20 — 300 starved thinking models on rung one
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

  function seedAdvisor({ history = [], probes = {} } = {}) {
    __mockDb.query.mockImplementation(async (aql) => {
      if (aql.includes('r.kind == "run"')) {
        return {
          all: async () => [
            {
              _key: 'r1',
              repo_id: 'me',
              kind: 'run',
              created_at: new Date().toISOString(),
              payload: {
                results: QUERIES.map((q) => ({
                  ...q,
                  head_claimed: q.kind === 'positive',
                  ...(probes[q.query] ? { probe: probes[q.query] } : {})
                }))
              }
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
    // 1-8g-b: the advisor embeds its QUERY vectors through the gate's
    // prefixed contract (embedQueryBatch) — the sim lives in the same
    // vector space as the live runs.
    headTestService.embedQueryBatch.mockImplementation(async (queries) => ({
      vectors: queries.map((t) => {
        if (t.startsWith('neg ')) return NEG_DIRS[Number(t.slice(4)) - 1];
        if (t.startsWith('pos ')) return HEAD_VEC;
        return basis(6);
      }),
      prefixed: true,
      model: 'test-model'
    }));
    frontmatterService.vllmChatCompletions.mockResolvedValue(
      llmResponse({ add: ['tag-low', 'tag-one', 'tag-two', 'tag-three', 'tag-five'] })
    );
  }

  // 1-8g-s — the corpus lever: a failing negative whose probe ANSWERED is
  // a positive in disguise; the advisor must surface a row flip with the
  // evidence instead of going silent (David: 3 answerable near-miss fails
  // and zero recommendations).
  it('surfaces row flips for failing negatives the corpus answers, counts the ungrounded rest', async () => {
    seedAdvisor({
      probes: {
        'neg 1': { verdict: 'answerable', top_score: 0.91 },
        'neg 2': { verdict: 'weak', top_score: 0.31 },
        'neg 3': { verdict: 'unanswerable', top_score: 0.002 }
      }
    });
    const out = await svc.recommendTagSet('me', {});
    expect(out.row_actions).toHaveLength(2); // answerable + weak only
    expect(out.row_actions.map((r) => r.query)).toEqual(['neg 1', 'neg 2']);
    expect(out.row_actions[0]).toMatchObject({
      action: 'flip',
      to_kind: 'positive',
      verdict: 'answerable',
      top_score: 0.91
    });
    expect(out.row_actions[0].reason).toMatch(/corpus answers this query/);
    // the 6 unprobed + 1 unanswerable negatives count as ungrounded
    expect(out.ungrounded_negative_fails).toBe(7);
  });

  it('recommends no row flips when no failing negative has a corpus verdict (legacy runs)', async () => {
    seedAdvisor();
    const out = await svc.recommendTagSet('me', {});
    expect(out.row_actions).toEqual([]);
    expect(out.ungrounded_negative_fails).toBeGreaterThan(0);
  });

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

  // 2026-10-20 — the async advisor (202 + poll): the synchronous POST died
  // at the gateway ("The upstream server is timing out") while a thinking
  // model kept climbing the adaptive ladder server-side. The job shape must
  // answer running/done/failed from a poll and never hang on 'running'.
  it('runs the advisor as a job: 202 shape, running envelope, done payload', async () => {
    seedAdvisor();
    const begun = await svc.beginRecommendTagSet('me', {}, {});
    expect(begun.job_key).toMatch(/^a\d+-/);
    // While in flight the poll answers the live envelope from the Map —
    // the first poll cannot read a placeholder that has not landed.
    const running = await svc.getRecommendJob('me', begun.job_key);
    expect(running).toMatchObject({ status: 'running', kind: 'recommend' });
    const result = await begun.done;
    expect(result.changes).toBeDefined(); // the advice itself
    const doc = await svc.getRecommendJob('me', begun.job_key);
    expect(doc.status).toBe('done');
    expect(doc.payload.changes).toBeDefined();
  });

  it('a second advisor for the same repo while one runs is RECOMMEND_IN_FLIGHT (adopt, do not dead-end)', async () => {
    seedAdvisor();
    let release;
    const gate = new Promise((resolve) => {
      release = resolve;
    });
    frontmatterService.vllmChatCompletions.mockImplementation(() => gate.then(() => llmResponse({ add: [] })));
    const first = await svc.beginRecommendTagSet('me', {}, {});
    await expect(svc.beginRecommendTagSet('me', {}, {})).rejects.toMatchObject({
      code: 'RECOMMEND_IN_FLIGHT',
      status: 409
    });
    release();
    await first.done;
    // The lock is released — a new advisor may start.
    const second = await svc.beginRecommendTagSet('me', {}, {});
    await second.done;
  });

  it('a failing advisor run lands a failed job doc with the real error (the poll never hangs)', async () => {
    seedAdvisor();
    headTestService.embedQueryBatch.mockRejectedValue(new Error('embed host down'));
    const begun = await svc.beginRecommendTagSet('me', {}, {});
    await expect(begun.done).rejects.toThrow('embed host down');
    const doc = await svc.getRecommendJob('me', begun.job_key);
    expect(doc.status).toBe('failed');
    expect(doc.error).toMatchObject({ code: 'RECOMMEND_FAILED', message: 'embed host down' });
  });

  it('pre-flight stays synchronous: no head and no runs are instant 409/404, not 202s that fail later', async () => {
    seedAdvisor();
    repositoryService.getById.mockResolvedValue({ _key: 'me', head: null });
    await expect(svc.beginRecommendTagSet('me', {}, {})).rejects.toMatchObject({ code: 'NO_HEAD', status: 409 });
    seedAdvisor();
    __mockDb.query.mockImplementation(async () => ({ all: async () => [] }));
    await expect(svc.beginRecommendTagSet('me', {}, {})).rejects.toMatchObject({ code: 'RUN_NOT_FOUND', status: 404 });
  });
});

// ─── Story 1-8f: suites are savable, modifiable and rerunnable ─────────────

describe('1-8g b/c/d/h — advisor parity, blocked removals, add-LLM class filter, dedup', () => {
  // Orthogonal 7-dim universe built to EXERCISE the 2026-10-10 live
  // geometry: a curator-original forbidden tag T vetoes a positive AND
  // suppresses a negative, so removing T gains a positive but re-admits
  // the negative — and a narrower replacement T2 suppresses the negative
  // while sparing the positive (the narrow pair).
  //   cos(pos,head)=0.581 · cos(pos,T)=0.575 veto · cos(pos,T2)=0.234 spare
  //   cos(neg,head)=0.651 · cos(neg,T)=0.736 veto · cos(neg,T2)=0.735 veto
  const DIM = 7;
  const unit = (v) => {
    const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
    return v.map((x) => x / n);
  };
  const basis = (i) => unit(Array.from({ length: DIM }, (_, k) => (k === i ? 1 : 0)));
  const HEAD_VEC = basis(0);
  const POS_VEC = unit([1, 1.4, 0, 0, 0, 0, 0]);
  const NEG_VEC = unit([1, 0.6, 1, 0, 0, 0, 0]);
  const T_VEC = unit([0, 1, 1, 0, 0, 0, 0]);
  const T2_VEC = unit([0, 0.3, 1, 0, 0, 0, 0]);

  function seedBlocked() {
    const QUERIES = [
      { query: 'pos one', kind: 'positive', cls: null },
      { query: 'neg one', kind: 'negative', cls: 'off-domain' }
    ];
    __mockDb.query.mockImplementation(async (aql) => {
      if (aql.includes('r.kind == "run"')) {
        return {
          all: async () => [
            {
              _key: 'r1',
              repo_id: 'me',
              kind: 'run',
              created_at: new Date().toISOString(),
              suite_key: 's-suite-1',
              tagset: { forbidden: ['tag-t'], hash8: 'deadbeef' },
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
      frontmatter_history: [],
      head: { version: 9, vector: HEAD_VEC, per_field: { topic: [HEAD_VEC], forbidden_vectors: [] } }
    });
    const VEC_OF = { 'pos one': POS_VEC, 'neg one': NEG_VEC, 'tag-t': T_VEC, 'tag-t2': T2_VEC };
    const embed = (texts) => texts.map((t) => VEC_OF[t] || basis(6));
    frontmatterService.teiEmbed.mockImplementation(embed);
    headTestService.embedQueryBatch.mockImplementation(async (queries) => ({
      vectors: embed(queries),
      prefixed: true,
      model: 'test-model'
    }));
    return QUERIES;
  }

  it('b: the scorecard scope names the suites/runs/tagset and the prefixed embedding contract', async () => {
    seedBlocked();
    frontmatterService.vllmChatCompletions.mockResolvedValue(llmResponse({ add: [] }));
    const out = await svc.recommendTagSet('me', {});
    expect(out.scope.suites).toEqual(['s-suite-1']);
    expect(out.scope.runs[0]).toMatchObject({ suite_key: 's-suite-1', tagset: { hash8: 'deadbeef' } });
    expect(out.scope.embedding_prefixed).toBe(true);
    // parity: the sim's query vectors went through embedQueryBatch, NOT
    // bare teiEmbed (the live bug that made "Now" fictional)
    expect(headTestService.embedQueryBatch).toHaveBeenCalled();
  });

  it('c: a curator-original tag that vetoes positives surfaces as a blocked removal', async () => {
    seedBlocked();
    frontmatterService.vllmChatCompletions.mockResolvedValue(llmResponse({ add: [] }));
    repositoryService.getById.mockResolvedValue({
      _key: 'me',
      version: 1,
      frontmatter: { forbidden: ['tag-t'] },
      frontmatter_history: [],
      head: { version: 9, vector: HEAD_VEC, per_field: { topic: [HEAD_VEC], forbidden_vectors: [] } }
    });
    // readFrontmatterFromRepoDoc drives the advisor's view of `current`.
    frontmatterService.readFrontmatterFromRepoDoc.mockResolvedValue({
      topic: ['x'],
      entity: [],
      scope: '',
      forbidden: ['tag-t'],
      summary: '',
      keyword: []
    });
    const out = await svc.recommendTagSet('me', {});
    expect(out.changes.remove).toEqual([]); // never auto-applied
    expect(out.blocked_removals).toHaveLength(1);
    expect(out.blocked_removals[0]).toMatchObject({
      tag: 'tag-t',
      predicted_positive_gain: 1,
      predicted_negative_loss: 1,
      reason: 'curator_original'
    });
  });

  it('c: a narrow pair recovers the positive without re-admitting the negative', async () => {
    seedBlocked();
    frontmatterService.vllmChatCompletions.mockResolvedValue(llmResponse({ add: ['tag-t2'] }));
    repositoryService.getById.mockResolvedValue({
      _key: 'me',
      version: 1,
      frontmatter: { forbidden: ['tag-t'] },
      frontmatter_history: [],
      head: { version: 9, vector: HEAD_VEC, per_field: { topic: [HEAD_VEC], forbidden_vectors: [] } }
    });
    frontmatterService.readFrontmatterFromRepoDoc.mockResolvedValue({
      topic: ['x'],
      entity: [],
      scope: '',
      forbidden: ['tag-t'],
      summary: '',
      keyword: []
    });
    const out = await svc.recommendTagSet('me', {});
    const pair = out.narrow_options.find((p) => p.remove === 'tag-t');
    expect(pair).toMatchObject({
      add: 'tag-t2',
      predicted_positive_gain: 1,
      predicted_negative_loss: 0
    });
  });

  it('d: the add-LLM prompt carries only veto-leg classes — confusable and meta never seed tags', async () => {
    seedBlocked();
    frontmatterService.vllmChatCompletions.mockResolvedValue(llmResponse({ add: [] }));
    // A run carrying one row per class — each row embedded ABOVE the floor
    // with no tag veto, so every row is a CLAIMED negative (failing). The
    // prompt must list ONLY the veto-leg classes (off-domain, near-miss);
    // confusable (the sibling-select leg) and meta (Lab-noise) never seed
    // forbidden-tag proposals.
    const FAILING_VEC = unit([1, 0.5, 0, 0, 0, 0, 0]); // cos(head) 0.894, no tag overlap
    const QUERIES_D = [
      { query: 'an off-domain question', kind: 'negative', cls: 'off-domain' },
      { query: 'a confusable question', kind: 'negative', cls: 'confusable' },
      { query: 'a meta question', kind: 'negative', cls: 'meta' },
      { query: 'a near-miss question', kind: 'negative', cls: 'near-miss' }
    ];
    __mockDb.query.mockImplementation(async (aql) => {
      if (aql.includes('r.kind == "run"')) {
        return {
          all: async () => [
            {
              _key: 'r1',
              repo_id: 'me',
              kind: 'run',
              created_at: new Date().toISOString(),
              payload: { results: QUERIES_D.map((q) => ({ ...q, head_claimed: true })) }
            }
          ]
        };
      }
      return { all: async () => [] };
    });
    const embedD = (texts) => texts.map((t) => (QUERIES_D.some((q) => q.query === t) ? FAILING_VEC : basis(6)));
    frontmatterService.teiEmbed.mockImplementation(embedD);
    headTestService.embedQueryBatch.mockImplementation(async (queries) => ({
      vectors: embedD(queries),
      prefixed: true,
      model: 'test-model'
    }));
    await svc.recommendTagSet('me', {});
    const call = frontmatterService.vllmChatCompletions.mock.calls.find((c) =>
      String(c[0][0].content).includes('FAILING QUERIES')
    );
    const prompt = String(call[0][0].content);
    expect(prompt).toContain('an off-domain question');
    expect(prompt).toContain('a near-miss question');
    expect(prompt).not.toContain('a confusable question');
    expect(prompt).not.toContain('a meta question');
  });

  it('h: manual additions dedup against the suite — same kind dropped, cross-kind dropped', async () => {
    const suite = await seedSuite({ positive: 1, negativeForbidden: 1 });
    const existing = suite.payload.positive[0].query;
    const res = await svc.addQueries('me', suite._key, {
      queries: [
        { query: existing, kind: 'positive' }, // dup of an existing positive
        { query: 'Brand new question', kind: 'positive' }, // lands
        { query: suite.payload.negative[0].query, kind: 'negative' }, // dup of an existing negative
        { query: 'Brand new question', kind: 'negative' } // cross-kind contradiction — dropped
      ]
    });
    expect(res.added).toBe(1);
    expect(res.duplicates_dropped).toBe(3);
    expect(res.payload.positive).toHaveLength(2);
    expect(res.payload.negative).toHaveLength(1);
  });

  it('h: the generator never emits the same text twice or across kinds', async () => {
    __mockDb.query.mockResolvedValue({ all: async () => [] }); // solo universe
    frontmatterService.vllmChatCompletions.mockResolvedValue(
      llmResponse({
        positive: [
          { query: 'What is the licensing fee?', reason: 'topic hit' },
          { query: 'What is the licensing fee?', reason: 'duplicate from the model' }
        ],
        negative: [
          { query: 'What is the licensing fee?', reason: 'the model also emitted it as a negative' },
          { query: 'Totally unrelated weather', reason: 'off-domain' }
        ],
        keywords: []
      })
    );
    const s = await svc.generateSuite('me', { n_positive: 2, n_negative: 2 }, {});
    const posTexts = s.payload.positive.map((q) => q.query);
    expect(posTexts).toEqual(['What is the licensing fee?']); // the dup positive dropped
    const negTexts = s.payload.negative.map((q) => q.query);
    expect(negTexts).not.toContain('What is the licensing fee?'); // cross-kind dropped
    expect(new Set(negTexts).size).toBe(negTexts.length); // no in-kind dups
  });
});

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

  it('updateSuiteRows can DELETE a blank or queryless row — legacy junk is not write-locked', async () => {
    // Live 2026-10-20: removing a blank query 400'd. validRow (blank =
    // invalid) gated removes[] too, so a blank row in a legacy suite
    // could never pass the validation guarding its own deletion. Blank
    // junk may be stored as '' OR whitespace — and the actual live row
    // (suite s1791908298011, positive[204]) had NO query key at all, so
    // the UI's delete click sent only {kind}. All three shapes must be
    // deletable, and a no-query remove must spare every real query.
    const suite = await seedRows();
    suite.payload.positive.push({ query: '', kind: 'positive', cls: null, source: 'llm' });
    suite.payload.positive.push({ kind: 'positive', cls: null, lastProbe: { verdict: 'unknown' } }); // queryless — the live shape
    suite.payload.negative.push({ query: '   ', kind: 'negative', cls: null, source: 'llm' });
    __mockDb.collection('okf_head_test_runs').replace(suite._key, suite);
    const out = await svc.updateSuiteRows('me', suite._key, {
      removes: [
        { query: '', kind: 'positive' },
        { kind: 'positive' }, // what the UI sends for a row with no query
        { query: '   ', kind: 'negative' }
      ]
    });
    expect(out.payload.positive.every((r) => r.query && r.query.trim())).toBe(true);
    expect(out.payload.negative.every((r) => r.query && r.query.trim())).toBe(true);
    expect(out.payload.positive).toHaveLength(2); // the real queries survived
    expect(out.payload.negative).toHaveLength(2);
  });

  it('updateSuiteRows removes rows cleanly and RESOLVES the ambiguous shared-text flip (1-8g-p)', async () => {
    const suite = await seedRows();
    // Removing the insurance near-miss is fine.
    const out = await svc.updateSuiteRows('me', suite._key, {
      removes: [{ query: 'insurance plans cover screening', kind: 'negative' }]
    });
    expect(out.payload.negative).toHaveLength(1);
    // 1-8g-p: the previously-refused ambiguous flip — 'shared text' is BOTH
    // a genuine positive AND a mislabeled positive inside negatives — now
    // RESOLVES: the flip moves every copy of text+kind (both arrays) and
    // lands ONE clean negative. The mislabel is fixed as a side effect; no
    // 409 deadlock.
    const s2 = await seedRows();
    s2.payload.positive.push({ query: 'shared text', kind: 'positive', cls: null, source: 'llm' });
    s2.payload.negative.push({ query: 'shared text', kind: 'positive', cls: null, source: 'llm' });
    __mockDb.collection('okf_head_test_runs').replace(s2._key, s2);
    const out2 = await svc.updateSuiteRows('me', s2._key, {
      updates: [{ match: { query: 'shared text', kind: 'positive' }, set: { kind: 'negative' } }]
    });
    expect(out2.payload.positive.map((r) => r.query)).toEqual([
      'breast cancer screening guidance',
      'asthma management protocol'
    ]);
    expect(out2.payload.negative.filter((r) => r.query === 'shared text')).toHaveLength(1);
    expect(out2.payload.negative.find((r) => r.query === 'shared text')).toMatchObject({
      kind: 'negative',
      cls: null
    });
  });

  it('updateSuiteRows 400s an empty body', async () => {
    const suite = await seedRows();
    await expect(svc.updateSuiteRows('me', suite._key, {})).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400
    });
  });

  // 1-8g-p — pre-1-8g-h suites carry duplicate rows (live: one text ×3 in
  // the negatives, 16/66 rows duplicated) and the strict guards write-locked
  // them: every single-row edit left a duplicate → 409 forever. Deleting one
  // copy must heal the whole family; a flip must move ALL copies.
  it('updateSuiteRows: deleting ONE copy of a triplicated negative heals the whole duplicate family', async () => {
    const suite = await seedSuite({ positive: 1, negativeForbidden: 1 });
    const T = 'Map the distribution of slaughterhouses across the country.';
    suite.payload.positive = [{ query: 'p1 clean positive', kind: 'positive', cls: null, source: 'llm' }];
    suite.payload.negative = [1, 2, 3].map((i) => ({
      query: T,
      kind: 'negative',
      cls: 'off-domain',
      source: 'llm',
      _copy: i
    }));
    __mockDb.collection('okf_head_test_runs').replace(suite._key, suite);
    const out = await svc.updateSuiteRows('me', suite._key, {
      removes: [{ query: T, kind: 'negative' }]
    });
    // the click removed one copy; normalization drops the interchangeable
    // extras — the text is GONE, not half-gone (the old behavior 409'd here)
    expect(out.payload.negative).toHaveLength(0);
    expect(out.payload.positive).toHaveLength(1);
  });

  it('updateSuiteRows: flipping a duplicated row moves ALL copies — the text wins wholesale', async () => {
    const suite = await seedSuite({ positive: 1, negativeForbidden: 1 });
    const T = 'map the distribution of slaughterhouses across the country.';
    suite.payload.positive = [{ query: 'p1 clean positive', kind: 'positive', cls: null, source: 'llm' }];
    suite.payload.negative = [1, 2].map((i) => ({
      query: T,
      kind: 'negative',
      cls: 'off-domain',
      source: 'llm',
      _copy: i
    }));
    __mockDb.collection('okf_head_test_runs').replace(suite._key, suite);
    const out = await svc.updateSuiteRows(
      'me',
      suite._key,
      { updates: [{ match: { query: T, kind: 'negative' }, set: { kind: 'positive' } }] },
      { actor: { user_id: 'u1' } }
    );
    // moving one copy would leave the twin → contradiction 409 → the suite
    // stayed locked. The flip takes the whole family: negatives empty, the
    // text lands in positives exactly once.
    expect(out.payload.negative).toHaveLength(0);
    expect(out.payload.positive.map((r) => r.query.toLowerCase())).toEqual(['p1 clean positive', T]);
  });

  it('updateSuiteRows: flip into a kind that already holds the text 409s with the way out', async () => {
    const suite = await seedSuite({ positive: 1, negativeForbidden: 1 });
    const T = 'shared text between kinds';
    suite.payload.positive = [{ query: T, kind: 'positive', cls: null, source: 'llm' }];
    suite.payload.negative = [{ query: T, kind: 'negative', cls: 'confusable', source: 'llm' }];
    __mockDb.collection('okf_head_test_runs').replace(suite._key, suite);
    await expect(
      svc.updateSuiteRows('me', suite._key, {
        updates: [{ match: { query: T, kind: 'negative' }, set: { kind: 'positive' } }]
      })
    ).rejects.toMatchObject({
      code: 'SUITE_CONTRADICTION',
      status: 409,
      message: /already exists in the positive list — delete that copy first/
    });
  });

  it('updateSuiteRows: a pre-existing cross-kind contradiction still blocks unrelated edits (escapable, not silent)', async () => {
    const suite = await seedSuite({ positive: 1, negativeForbidden: 1 });
    const T = 'contradicted text';
    suite.payload.positive = [
      { query: T, kind: 'positive', cls: null, source: 'llm' },
      { query: 'another positive', kind: 'positive', cls: null, source: 'llm' }
    ];
    suite.payload.negative = [{ query: T, kind: 'negative', cls: 'confusable', source: 'llm' }];
    __mockDb.collection('okf_head_test_runs').replace(suite._key, suite);
    // an edit that does not touch the contradiction cannot sneak it through
    await expect(
      svc.updateSuiteRows('me', suite._key, { removes: [{ query: 'another positive', kind: 'positive' }] })
    ).rejects.toMatchObject({ code: 'SUITE_CONTRADICTION', status: 409, message: /delete one of the two rows/ });
    // …but deleting one CONTRADICTED copy resolves it — always a way out
    const out = await svc.updateSuiteRows('me', suite._key, {
      removes: [{ query: T, kind: 'negative' }]
    });
    expect(out.payload.positive.map((r) => r.query)).toContain(T);
    expect(out.payload.negative).toHaveLength(0);
  });

  // 1-8g-r — the old hand-picked caps (positive ≤ 60) sat BELOW what the
  // generator legally produces (CLASS_MAX positive 1000): David's
  // legitimate 100-positive NCD suite 409'd on EVERY row edit.
  it('updateSuiteRows: a 100-positive suite (a legal 1-8f generation) is editable', async () => {
    const suite = await seedSuite({ positive: 1, negativeForbidden: 1 });
    suite.payload.positive = Array.from({ length: 100 }, (_, i) => ({
      query: `positive query number ${i}`,
      kind: 'positive',
      cls: null,
      source: 'llm'
    }));
    suite.payload.negative = [{ query: 'one negative', kind: 'negative', cls: 'off-domain', source: 'llm' }];
    __mockDb.collection('okf_head_test_runs').replace(suite._key, suite);
    const out = await svc.updateSuiteRows('me', suite._key, {
      removes: [{ query: 'positive query number 7', kind: 'positive' }]
    });
    expect(out.payload.positive).toHaveLength(99);
  });

  it('updateSuiteRows: an over-cap suite can always be edited DOWNWARD (delta guard)', async () => {
    const suite = await seedSuite({ positive: 1, negativeForbidden: 1 });
    suite.payload.positive = Array.from({ length: 1001 }, (_, i) => ({
      query: `bulk positive ${i}`,
      kind: 'positive',
      cls: null,
      source: 'llm'
    }));
    suite.payload.negative = [];
    __mockDb.collection('okf_head_test_runs').replace(suite._key, suite);
    const out = await svc.updateSuiteRows('me', suite._key, {
      removes: [{ query: 'bulk positive 500', kind: 'positive' }]
    });
    expect(out.payload.positive).toHaveLength(1000);
  });

  it('updateSuiteRows: growth PAST the cap still 409s (SUITE_CAP)', async () => {
    const suite = await seedSuite({ positive: 1, negativeForbidden: 1 });
    suite.payload.positive = Array.from({ length: 1000 }, (_, i) => ({
      query: `at-cap positive ${i}`,
      kind: 'positive',
      cls: null,
      source: 'llm'
    }));
    suite.payload.negative = [{ query: 'the only negative', kind: 'negative', cls: 'off-domain', source: 'llm' }];
    __mockDb.collection('okf_head_test_runs').replace(suite._key, suite);
    await expect(
      svc.updateSuiteRows('me', suite._key, {
        updates: [{ match: { query: 'the only negative', kind: 'negative' }, set: { kind: 'positive' } }]
      })
    ).rejects.toMatchObject({ code: 'SUITE_CAP', status: 409 });
  });
});

// ─── Story 1-8f part 2: any number of tests + suite names ──────────────────

describe('generateSuite batching + names (1-8f2)', () => {
  it('batches a large ask across LLM calls, dedupes, and delivers the count', async () => {
    const randSpy = jest.spyOn(Math, 'random').mockReturnValue(0);
    try {
      let call = 0;
      frontmatterService.vllmChatCompletions.mockImplementation(async () => {
        call += 1;
        const base = (call - 1) * 30;
        return llmResponse({
          positive: Array.from({ length: 30 }, (_, i) => ({
            query: `positive probe ${base + i + 1} for the repository`,
            reason: 'batched'
          })),
          // one dup + one fresh negative per call
          negative: [
            { query: 'shared negative probe', expected_repo: 'Sibling Repo', reason: 'x' },
            { query: `negative probe ${call}`, expected_repo: 'Sibling Repo', reason: 'x' }
          ],
          near_miss: [],
          off_domain: [],
          meta: [],
          keywords: ['who']
        });
      });
      __mockDb.query.mockImplementation(async (aql) => {
        if (aql.includes('r.head != null')) {
          return { all: async () => [{ repo_id: 'sib1', name: 'Sibling Repo', text: 'sibling text' }] };
        }
        return { all: async () => [] };
      });
      const suite = await svc.generateSuite('me', { n_positive: 60, n_negative: 6 }, {});
      // 60 positives delivered across 2 batched calls (30 + 30).
      expect(call).toBeGreaterThanOrEqual(2);
      const texts = suite.payload.positive.map((r) => r.query);
      expect(suite.payload.positive).toHaveLength(60);
      expect(new Set(texts.map((t) => t.toLowerCase())).size).toBe(60);
      // negatives deduped across calls: 1 shared + 1 unique per call —
      // the shared dup is dropped, uniques kept (5 calls: 2 for positives,
      // 3 topping up the negative backlog to the requested 6).
      const neg = suite.payload.negative.filter((q) => q.cls === 'confusable');
      expect(neg).toHaveLength(6);
    } finally {
      randSpy.mockRestore();
    }
  });

  it('persists the suite name (trimmed) and 400s an empty rename', async () => {
    __mockDb.query.mockImplementation(async () => ({ all: async () => [] }));
    frontmatterService.vllmChatCompletions.mockImplementation(async () => {
      // no progress on the first call → immediate fallback suite
      return llmResponse({ positive: [], negative: [], near_miss: [], off_domain: [], meta: [] });
    });
    const suite = await svc.generateSuite('me', { name: '  NCD regression set  ' }, {});
    expect(suite.name).toBe('NCD regression set');
    await expect(svc.renameSuite('me', suite._key, { name: '   ' })).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400
    });
    const renamed = await svc.renameSuite('me', suite._key, { name: 'Regressão NCD' }, { actor: { user_id: 'u1' } });
    expect(renamed.name).toBe('Regressão NCD');
  });
});

describe('beginSuiteGeneration (1-8f2 — async 202 + poll)', () => {
  it('mints the key up-front, lands the doc under it, and refuses a concurrent generate', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    __mockDb.query.mockImplementation(async () => ({ all: async () => [] }));
    frontmatterService.vllmChatCompletions.mockImplementation(async () => {
      await gate; // hold the first generation IN FLIGHT
      return llmResponse({ positive: [], negative: [], near_miss: [], off_domain: [], meta: [] });
    });
    const started = await svc.beginSuiteGeneration('me', { n_positive: 2 }, {});
    expect(started.suite_key).toMatch(/^s\d+-[0-9a-f]{6}$/);
    // sync contract: the in-flight check throws before any async work
    await expect(svc.beginSuiteGeneration('me', {})).rejects.toMatchObject({
      code: 'GENERATION_IN_FLIGHT',
      status: 409
    });
    release();
    const suite = await started.done;
    expect(suite._key).toBe(started.suite_key);
    // the in-flight slot cleared — a fresh generation is accepted
    const again = await svc.beginSuiteGeneration('me', {}, {});
    const done2 = await again.done;
    expect(done2._key).toBe(again.suite_key);
  });

  // 1-8g-u (live 2026-10-11, Indonesia History): a tag-less repo used to
  // mint a key, die on NO_FRONTMATTER in the worker's first millisecond,
  // and leave the poll 404-ing "suite not found" until timeout. Now the
  // precondition fails BEFORE minting, with the guidance code.
  it('rejects a tag-less repo BEFORE minting (NO_FRONTMATTER, no in-flight slot)', async () => {
    frontmatterService.readFrontmatterFromRepoDoc.mockResolvedValue(null);
    await expect(svc.beginSuiteGeneration('me', { n_positive: 2 }, {})).rejects.toMatchObject({
      code: 'NO_FRONTMATTER',
      status: 409,
      message: /create head tags first/
    });
    expect(svc.suiteGenerationInFlight('me', 'anything')).toBe(false);
  });

  it('records an async generation failure — the poll gets {status:"failed"} instead of 404', async () => {
    // generateSuite CATCHES LLM failures (fallback classes still make a
    // usable suite) — the failure must come from an uncaught leg: the
    // default-name count query throws → done rejects.
    __mockDb.query.mockRejectedValue(new Error('db exploded'));
    const started = await svc.beginSuiteGeneration('me', { n_positive: 2 }, {});
    await expect(started.done).rejects.toBeTruthy();
    // the poll's terminal, honest envelope — never a SUITE_NOT_FOUND loop
    __mockDb.query.mockImplementation(async () => ({ all: async () => [] }));
    const env = await svc.getSuite('me', started.suite_key, {});
    expect(env).toMatchObject({
      suite_key: started.suite_key,
      status: 'failed',
      error: { code: 'GENERATION_FAILED', message: 'db exploded' }
    });
    // the next attempt clears the stale failure
    const again = await svc.beginSuiteGeneration('me', {}, {});
    expect(svc.suiteGenerationFailed('me', started.suite_key)).toBe(null);
    await again.done;
  });
});

describe('getSuite vs an in-flight generation (1-8f2 — the honest envelope)', () => {
  it('answers {suite_key, status:"generating"} for a minted in-flight key; 404 only for unknown keys', async () => {
    let release;
    const gate = new Promise((r) => {
      release = r;
    });
    __mockDb.query.mockImplementation(async () => ({ all: async () => [] }));
    frontmatterService.vllmChatCompletions.mockImplementation(async () => {
      await gate;
      return llmResponse({ positive: [], negative: [], near_miss: [], off_domain: [], meta: [] });
    });
    const started = await svc.beginSuiteGeneration('me', { n_positive: 2 }, {});
    try {
      // in-flight: the poll's keep-waiting envelope, NOT a 404
      const env = await svc.getSuite('me', started.suite_key, {});
      expect(env).toEqual({ suite_key: started.suite_key, status: 'generating' });
      expect(svc.suiteGenerationInFlight('me', started.suite_key)).toBe(true);
    } finally {
      release();
      await started.done;
    }
    // landed: the doc is returned, and the in-flight flag cleared
    const suite = await svc.getSuite('me', started.suite_key, {});
    expect(suite._key).toBe(started.suite_key);
    expect(svc.suiteGenerationInFlight('me', started.suite_key)).toBe(false);
    // a key that was never minted still 404s
    await expect(svc.getSuite('me', 's9999999-dead00', {})).rejects.toMatchObject({
      code: 'SUITE_NOT_FOUND',
      status: 404
    });
  });
});

describe('1-8g — runSuite probes the corpus (Run All fills the Corpus column)', () => {
  it('stamps a light probe on every result row + persists lastProbe on the suite rows', async () => {
    const suite = await seedSuite({ positive: 1, negativeForbidden: 1 });
    repositoryService.getById.mockResolvedValue({
      _key: 'me',
      name: 'NCD Information',
      ingested_graph_name: 'OKF_me_v1'
    });
    headTestService.routingTest.mockImplementation(async (repoId, body) => {
      const isPositive = suite.payload.positive.some((q) => q.query === body.query);
      return fakeResult(isPositive, isPositive ? 0.7 : 0.05, 0, isPositive ? 'claimed' : 'suppressed');
    });
    frontmatterService.teiEmbed.mockResolvedValue([[0.1, 0.2, 0.3]]);
    __mockDb.query.mockImplementation(async (aql) => {
      if (aql.includes('APPROX_NEAR_COSINE')) {
        return { all: async () => [{ text: 'WHO guidance colorectal screening every 10 years', score: 0.82 }] };
      }
      return { all: async () => [] };
    });
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [{ index: 0, score: 0.91 }]
    });
    try {
      process.env.OKF_RERANK_ENDPOINT = 'https://tei.example/rerank';
      const run = await svc.runSuite('me', suite._key, {});
      for (const r of run.payload.results) {
        expect(r.probe).toMatchObject({ docs: 1, top_score: 0.91, verdict: 'answerable' });
      }
      // persisted on the suite rows — a later Load keeps the chips
      const after = await svc.getSuite('me', suite._key, {});
      expect(after.payload.positive[0].lastProbe).toMatchObject({ verdict: 'answerable', top_score: 0.91 });
      expect(after.payload.negative[0].lastProbe).toMatchObject({ verdict: 'answerable' });
    } finally {
      global.fetch = realFetch;
      delete process.env.OKF_RERANK_ENDPOINT;
    }
  });

  it('skips the probe leg cleanly when the repo has no ingested corpus (head-only run)', async () => {
    const suite = await seedSuite({ positive: 1 });
    headTestService.routingTest.mockResolvedValue(fakeResult(true, 0.7, 0));
    const run = await svc.runSuite('me', suite._key, {});
    expect(run.payload.results[0].probe).toBeUndefined();
  });
});

describe('1-8g — default suite naming, delete, and the corpus probe', () => {
  it('names an unnamed suite "<Repo> suite N" (N = this repo\'s suite count + 1)', async () => {
    __mockDb.query.mockImplementation(async (aql) => {
      if (aql.includes("d.kind == 'suite'") && aql.includes('COLLECT WITH COUNT')) {
        return { all: async () => [2] };
      }
      return { all: async () => [] };
    });
    frontmatterService.vllmChatCompletions.mockResolvedValue(
      llmResponse({ positive: [{ query: 'q1' }], negative: [], keywords: [] })
    );
    const suite = await svc.generateSuite('me', { n_positive: 1 }, {});
    expect(suite.name).toBe('NCD Information suite 3');
    // an explicit name always wins
    const named = await svc.generateSuite('me', { n_positive: 1, name: 'My batch' }, {});
    expect(named.name).toBe('My batch');
  });

  it('deleteSuite removes the suite + its runs; unknown keys 404; in-flight 409s', async () => {
    const suite = await seedSuite({ positive: 1, negativeForbidden: 1 });
    __mockDb.query.mockResolvedValue({ all: async () => [{ _key: 'r1' }, { _key: 'r2' }] });
    const removeSpy = jest.spyOn(__mockDb.collection('okf_head_test_runs'), 'remove');
    const res = await svc.deleteSuite('me', suite._key, {});
    expect(res).toMatchObject({ deleted: true, suite_key: suite._key, runs_removed: 2 });
    expect(removeSpy).toHaveBeenCalledWith(suite._key);
    removeSpy.mockRestore();
    await expect(svc.deleteSuite('me', 's9999999-nope00', {})).rejects.toMatchObject({
      code: 'SUITE_NOT_FOUND',
      status: 404
    });
  });

  it('probeSuiteQuery: embed → top-K → rerank → verdict bands, persisted on matching rows', async () => {
    const suite = await seedSuite({ positive: 1, negativeForbidden: 1 });
    const query = suite.payload.positive[0].query;
    repositoryService.getById.mockResolvedValue({
      _key: 'me',
      name: 'NCD Information',
      ingested_graph_name: 'OKF_me_v1'
    });
    frontmatterService.teiEmbed.mockResolvedValue([[0.1, 0.2, 0.3]]);
    __mockDb.query.mockImplementation(async (aql) => {
      if (aql.includes('APPROX_NEAR_COSINE')) {
        return {
          all: async () => [
            { text: 'WHO guidance colorectal screening every 10 years', score: 0.82 },
            { text: 'unrelated weather text', score: 0.1 }
          ]
        };
      }
      return { all: async () => [] };
    });
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => [
        { index: 1, score: 0.00002 },
        { index: 0, score: 0.83 }
      ]
    });
    try {
      process.env.OKF_RERANK_ENDPOINT = 'https://tei.example/rerank';
      const res = await svc.probeSuiteQuery('me', suite._key, { query }, {});
      expect(res).toMatchObject({
        suite_key: suite._key,
        docs: 2,
        top_score: 0.83,
        verdict: 'answerable'
      });
      // top_chunks are RERANK-ordered now (the rerank-best 0.83 leads,
      // not the vector-best 0.82) — the summary panel's order of truth
      expect(res.top_chunks[0].score).toBeCloseTo(0.83, 3);
      expect(res.top_chunks[0].preview).toMatch(/colorectal/i);
      // the head leg rides the response (verdict from routingTest — the
      // panel shows BOTH legs side by side)
      expect(res.head).toBeDefined();
      // persisted on the matching positive row
      const after = await svc.getSuite('me', suite._key, {});
      expect(after.payload.positive[0].lastProbe).toMatchObject({ verdict: 'answerable', top_score: 0.83 });
      // bands: weak + unanswerable
      expect(svc.probeVerdict(0.3)).toBe('weak');
      expect(svc.probeVerdict(0.01)).toBe('unanswerable');
      expect(svc.probeVerdict(null)).toBe('unknown');
    } finally {
      global.fetch = realFetch;
      delete process.env.OKF_RERANK_ENDPOINT;
    }
  });

  it('probeSuiteQuery: empty query 400s; no corpus 409s; unconfigured rerank → unknown', async () => {
    const suite = await seedSuite({ positive: 1 });
    await expect(svc.probeSuiteQuery('me', suite._key, { query: '   ' }, {})).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400
    });
    const repo = repositoryService.getById;
    repo.mockResolvedValueOnce({ id: 'me', name: 'NCD Information', ingested_graph_name: null });
    await expect(svc.probeSuiteQuery('me', suite._key, { query: 'x' }, {})).rejects.toMatchObject({
      code: 'REPO_NOT_INGESTED',
      status: 409
    });
    repo.mockResolvedValueOnce({ id: 'me', name: 'NCD Information', ingested_graph_name: 'OKF_me_v1' });
    frontmatterService.teiEmbed.mockResolvedValue([[0.1, 0.2, 0.3]]);
    __mockDb.query.mockResolvedValueOnce({
      all: async () => [{ text: 'chunk text', score: 0.5 }]
    });
    delete process.env.OKF_RERANK_ENDPOINT;
    const res = await svc.probeSuiteQuery('me', suite._key, { query: 'x' }, {});
    expect(res.verdict).toBe('unknown');
    expect(res.note).toMatch(/OKF_RERANK_ENDPOINT/);
  });

  // 1-8g-o (live 2026-10-10): the remote TEI rerank 429'd 19/116 Run-All
  // probes (bursty 4-way pool) → 'unknown' rows; individual probes never
  // trip it. The shared rerankTexts must retry transient statuses so the
  // batch leg self-heals instead of showing unknown.
  it('runSuite probe: retries a burst rerank 429 and still fills the Corpus column', async () => {
    const suite = await seedSuite({ positive: 1 });
    repositoryService.getById.mockResolvedValue({
      _key: 'me',
      name: 'NCD Information',
      ingested_graph_name: 'OKF_me_v1'
    });
    headTestService.routingTest.mockResolvedValue(fakeResult(true, 0.7, 0));
    frontmatterService.teiEmbed.mockResolvedValue([[0.1, 0.2, 0.3]]);
    __mockDb.query.mockImplementation(async (aql) => {
      if (aql.includes('APPROX_NEAR_COSINE')) {
        return { all: async () => [{ text: 'WHO guidance colorectal screening every 10 years', score: 0.82 }] };
      }
      return { all: async () => [] };
    });
    const realFetch = global.fetch;
    // first call 429s (no Retry-After header), second succeeds — the
    // verdict must be a real band, not 'unknown'
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, headers: { get: () => null } })
      .mockResolvedValue({ ok: true, status: 200, json: async () => [{ index: 0, score: 0.91 }] });
    try {
      process.env.OKF_RERANK_ENDPOINT = 'https://tei.example/rerank';
      const run = await svc.runSuite('me', suite._key, {});
      expect(run.payload.results[0].probe).toMatchObject({ docs: 1, top_score: 0.91, verdict: 'answerable' });
      // 3 calls: seeded positive 429s once then succeeds, the seeded
      // forbidden-negative (a different query text) succeeds first try
      expect(global.fetch).toHaveBeenCalledTimes(3);
    } finally {
      global.fetch = realFetch;
      delete process.env.OKF_RERANK_ENDPOINT;
    }
  });

  it('probeSuiteQuery: rerank 429s exhausted → honest unknown note naming the attempts', async () => {
    const suite = await seedSuite({ positive: 1 });
    repositoryService.getById.mockResolvedValue({
      _key: 'me',
      name: 'NCD Information',
      ingested_graph_name: 'OKF_me_v1'
    });
    frontmatterService.teiEmbed.mockResolvedValue([[0.1, 0.2, 0.3]]);
    __mockDb.query.mockImplementation(async (aql) => {
      if (aql.includes('APPROX_NEAR_COSINE')) {
        return { all: async () => [{ text: 'chunk text', score: 0.5 }] };
      }
      return { all: async () => [] };
    });
    const realFetch = global.fetch;
    global.fetch = jest.fn().mockResolvedValue({ ok: false, status: 429, headers: { get: () => null } });
    try {
      process.env.OKF_RERANK_ENDPOINT = 'https://tei.example/rerank';
      const res = await svc.probeSuiteQuery('me', suite._key, { query: 'q' }, {});
      expect(res.verdict).toBe('unknown');
      expect(res.note).toMatch(/HTTP 429 after 3 attempts/);
      expect(global.fetch).toHaveBeenCalledTimes(3); // bounded — not an infinite loop
    } finally {
      global.fetch = realFetch;
      delete process.env.OKF_RERANK_ENDPOINT;
    }
  });
});

// ─── 1-8g-v/w: the ASYNC run lifecycle ─────────────────────────────────────
// Live 2026-10-11 (Indonesia Suite 1 ×2): every async run did ~60s of work
// and then DIED at the final persist — save() INSERTed a _key the placeholder
// already occupied, the catch converted both completed runs to status:'failed',
// and the curator saw nothing. These tests pin the whole lifecycle: replace
// semantics, the honest failDoc, the 409 envelope, orphan reaping, and the
// delete guard.
describe('beginRunSuite — async run lifecycle (1-8g-v/w)', () => {
  const { logger } = require('../shared-lib/logger');

  function runHandle() {
    return __mockDb.collection('okf_head_test_runs');
  }

  it('1-8g-w REGRESSION: the final persist REPLACES the placeholder (save() would unique-constraint the run to death)', async () => {
    const suite = await seedSuite({ positive: 2, negativeForbidden: 1 });
    headTestService.routingTest.mockResolvedValue(fakeResult(true, 0.3, 1));
    const handle = runHandle();
    const savesAfterSeed = handle.save.mock.calls.length;
    const replacesAfterSeed = handle.replace.mock.calls.length;
    const { run_key, done } = await svc.beginRunSuite('me', suite._key, { actor: { user_id: 'u1' } });
    await done;
    // exactly ONE insert happened after the seed — the placeholder
    expect(handle.save.mock.calls.length).toBe(savesAfterSeed + 1);
    const placeholderCall = handle.save.mock.calls[savesAfterSeed][0];
    expect(placeholderCall).toMatchObject({ _key: run_key, status: 'running', kind: 'run' });
    // the final doc landed via REPLACE on the same key, with results
    const finalReplace = handle.replace.mock.calls
      .slice(replacesAfterSeed)
      .find((c) => c[0] === run_key && c[1].kind === 'run');
    expect(finalReplace).toBeTruthy();
    expect(finalReplace[1].payload.results).toHaveLength(3);
    expect(finalReplace[1].payload.summary).toBeTruthy();
    // created_at is the MINT time (== the placeholder's), not completion time
    expect(finalReplace[1].created_at).toBe(placeholderCall.created_at);
    // stored doc is terminal-complete: no status field (legacy completed shape)
    const stored = __mockDb._stores.okf_head_test_runs[run_key];
    expect(stored.status).toBeUndefined();
    // the mint is visible in the logs (1-8g-w run-start observability)
    expect(logger.info).toHaveBeenCalledWith(
      'head-suite.run_started',
      expect.objectContaining({ run_key, positives: 2, negatives: 1 })
    );
  });

  it('RUN_IN_FLIGHT 409 carries details.run_key — the client can adopt the in-flight run', async () => {
    const suite = await seedSuite({ positive: 1 });
    headTestService.routingTest.mockResolvedValue(fakeResult(true, 0.5, 0));
    const { run_key, done } = await svc.beginRunSuite('me', suite._key, {});
    await expect(svc.beginRunSuite('me', suite._key, {})).rejects.toMatchObject({
      code: 'RUN_IN_FLIGHT',
      status: 409,
      details: { run_key }
    });
    await done;
  });

  it('a failing worker writes status:"failed" with a STRING code and the MINT created_at, and clears the lock', async () => {
    const suite = await seedSuite({ positive: 1 });
    repositoryService.getById.mockRejectedValue(new Error('db exploded mid-run'));
    const handle = runHandle();
    const savesAfterSeed = handle.save.mock.calls.length;
    const { run_key, done } = await svc.beginRunSuite('me', suite._key, {});
    await expect(done).rejects.toThrow('db exploded mid-run');
    const failDoc = __mockDb._stores.okf_head_test_runs[run_key];
    expect(failDoc.status).toBe('failed');
    expect(failDoc.error).toMatchObject({ code: 'RUN_FAILED', message: 'db exploded mid-run' });
    // the failure must not reorder history: created_at stays the mint time
    expect(failDoc.created_at).toBe(handle.save.mock.calls[savesAfterSeed][0].created_at);
    // lock cleared → a fresh begin is admitted
    repositoryService.getById.mockResolvedValue({
      _key: 'me',
      name: 'NCD Information',
      version: 3,
      head: { version: 42 }
    });
    headTestService.routingTest.mockResolvedValue(fakeResult(true, 0.5, 0));
    const second = await svc.beginRunSuite('me', suite._key, {});
    await second.done;
  });

  it('a numeric driver code never leaks into the failDoc; a persist failure surfaces RUN_PERSIST_FAILED', async () => {
    const suite = await seedSuite({ positive: 1 });
    headTestService.routingTest.mockResolvedValue(fakeResult(true, 0.5, 0));
    const handle = runHandle();
    const realReplace = handle.replace.getMockImplementation();
    const { run_key, done } = await svc.beginRunSuite('me', suite._key, {});
    // fail ONLY the run-doc replace (the final persist), once, the way the
    // Arango driver does on a write conflict: numeric code
    handle.replace.mockImplementationOnce(async (key, doc) => {
      if (key === run_key && doc.kind === 'run') {
        const e = new Error('unique constraint violated');
        e.code = 409;
        throw e;
      }
      return realReplace(key, doc);
    });
    await expect(done).rejects.toMatchObject({ code: 'RUN_PERSIST_FAILED' });
    // the failDoc write (second replace) went through the real impl
    const stored = __mockDb._stores.okf_head_test_runs[run_key];
    expect(stored.status).toBe('failed');
    expect(stored.error.code).toBe('RUN_PERSIST_FAILED');
    expect(stored.error.message).toContain('final save failed');
  });

  it('an orphaned running doc (no live lock) is reaped lazily on read — the poll terminates', async () => {
    const suite = await seedSuite({ positive: 1 });
    const handle = runHandle();
    await handle.save({
      _key: 'rOrphan',
      repo_id: 'me',
      kind: 'run',
      status: 'running',
      suite_key: suite._key,
      created_at: '2026-10-11T00:00:00.000Z',
      payload: {}
    });
    const out = await svc.getRunSuite('me', suite._key, 'rOrphan');
    expect(out.status).toBe('failed');
    expect(out.error.code).toBe('RUN_INTERRUPTED');
    const stored = __mockDb._stores.okf_head_test_runs.rOrphan;
    expect(stored.status).toBe('failed');
    expect(stored.error.message).toContain('interrupted');
  });

  it('the boot sweep marks every running doc failed (sweepInterruptedRuns)', async () => {
    await seedSuite({ positive: 1 });
    __mockDb.query.mockResolvedValueOnce({ all: async () => [{ _key: 'rGhost1' }, { _key: 'rGhost2' }] });
    const n = await svc.sweepInterruptedRuns();
    expect(n).toBe(2);
    const sweepCall = __mockDb.query.mock.calls.find((c) => c[0] && c[0].includes('RUN_INTERRUPTED'));
    expect(sweepCall).toBeTruthy();
    const [aql] = sweepCall;
    expect(aql).toContain("d.kind == 'run'");
    expect(aql).toContain("d.status == 'running'");
    expect(aql).toContain('UPDATE d WITH');
    expect(aql).toContain('RUN_INTERRUPTED');
    expect(logger.warn).toHaveBeenCalledWith(
      'head-suite.run.sweep_interrupted',
      expect.objectContaining({ reaped: 2, run_keys: ['rGhost1', 'rGhost2'] })
    );
  });

  it('deleteSuite refuses while a run is executing, and succeeds once it lands', async () => {
    const suite = await seedSuite({ positive: 1 });
    headTestService.routingTest.mockResolvedValue(fakeResult(true, 0.5, 0));
    const { done } = await svc.beginRunSuite('me', suite._key, {});
    await expect(svc.deleteSuite('me', suite._key, {})).rejects.toMatchObject({
      code: 'RUN_IN_FLIGHT',
      status: 409
    });
    await done;
    const out = await svc.deleteSuite('me', suite._key, {});
    expect(out.deleted).toBe(true);
  });

  it('a placeholder-save failure cleans the lock (no RUN_IN_FLIGHT leak until restart)', async () => {
    const suite = await seedSuite({ positive: 1 });
    const handle = runHandle();
    handle.save.mockImplementationOnce(async () => {
      throw new Error('arango down');
    });
    await expect(svc.beginRunSuite('me', suite._key, {})).rejects.toThrow('arango down');
    // the suite is NOT locked — a fresh begin saves the placeholder and runs
    headTestService.routingTest.mockResolvedValue(fakeResult(true, 0.5, 0));
    const { done } = await svc.beginRunSuite('me', suite._key, {});
    await done;
  });
});
// ─── 1-8g-x: the run progress bar ──────────────────────────────────────────
// David (live 2026-10-11): "the UI should show a progress bar for the run" —
// and, after 1-8g-w, a run that finishes but shows nothing is worse than one
// that visibly progresses. The worker reports {phase, done, total}; the async
// caller throttles those into the run doc; the poll's live envelope carries
// the last value so the dialog can render a REAL percentage.
describe('1-8g-x — run progress reporting', () => {
  const { logger } = require('../shared-lib/logger');

  // The seeder may add derived rows (forbidden-derived etc.) beyond the
  // requested counts, so every expectation below derives the real row count
  // from the suite instead of hard-coding it.
  const rowCount = (suite) => suite.payload.positive.length + suite.payload.negative.length;

  it('runSuite reports the routing leg monotonically and lands exactly on total', async () => {
    const suite = await seedSuite({ positive: 3, negativeForbidden: 2 });
    const total = rowCount(suite);
    headTestService.routingTest.mockResolvedValue(fakeResult(true, 0.3, 1));
    const seen = [];
    await svc.runSuite('me', suite._key, { reportProgress: async (p) => seen.push(p) });
    const routing = seen.filter((p) => p.phase === 'routing');
    expect(routing.length).toBeGreaterThan(1); // not just the opening report
    expect(routing[0]).toMatchObject({ phase: 'routing', done: 0, total });
    // every report carries the suite's full row count
    expect(routing.every((p) => p.total === total)).toBe(true);
    // monotonic, and the worker finishes its rows
    const dones = routing.map((p) => p.done);
    expect(dones).toEqual([...dones].sort((a, b) => a - b));
    expect(Math.max(...dones)).toBe(total);
  });

  it('a failing progress sink never fails the run (best-effort telemetry)', async () => {
    const suite = await seedSuite({ positive: 1 });
    const total = rowCount(suite);
    headTestService.routingTest.mockResolvedValue(fakeResult(true, 0.5, 0));
    // the sink rejects — the run must still complete with its docs
    const run = await svc.runSuite('me', suite._key, {
      reportProgress: async () => {
        throw new Error('progress sink down');
      }
    });
    expect(run.payload.results).toHaveLength(total);
    expect(logger.warn).toHaveBeenCalledWith(
      'head-suite.run.progress_report_failed',
      expect.objectContaining({ suite_key: suite._key, error: 'progress sink down' })
    );
  });

  it('no reportProgress option = zero progress calls (the sync path is unchanged)', async () => {
    const suite = await seedSuite({ positive: 2 });
    const total = rowCount(suite);
    headTestService.routingTest.mockResolvedValue(fakeResult(true, 0.5, 0));
    const run = await svc.runSuite('me', suite._key, {});
    expect(run.payload.results).toHaveLength(total);
  });

  it('beginRunSuite persists throttled progress onto the run doc', async () => {
    const suite = await seedSuite({ positive: 3, negativeForbidden: 1 });
    headTestService.routingTest.mockImplementation(async () => {
      // let the throttle window elapse between rows so >1 write lands
      await new Promise((r) => setTimeout(r, 5));
      return fakeResult(true, 0.3, 1);
    });
    const handle = __mockDb.collection('okf_head_test_runs');
    const updatesBefore = handle.update.mock.calls.length;
    const { run_key, done } = await svc.beginRunSuite('me', suite._key, {});
    await done;
    const updates = handle.update.mock.calls.slice(updatesBefore);
    expect(updates.length).toBeGreaterThan(0);
    for (const [key, patch] of updates) {
      expect(key).toBe(run_key);
      expect(patch.progress).toMatchObject({ phase: expect.any(String), done: expect.any(Number) });
      expect(patch.updated_at).toEqual(expect.any(String));
    }
  });

  it('the live poll envelope carries the persisted progress (the bar has something to draw)', async () => {
    const suite = await seedSuite({ positive: 2 });
    headTestService.routingTest.mockImplementation(async () => {
      await new Promise((r) => setTimeout(r, 5));
      return fakeResult(true, 0.5, 0);
    });
    // seed a progress value the way the throttled writer would
    const { run_key, done } = await svc.beginRunSuite('me', suite._key, {});
    await __mockDb
      .collection('okf_head_test_runs')
      .update(run_key, { progress: { phase: 'routing', done: 1, total: 2 } });
    const live = await svc.getRunSuite('me', suite._key, run_key);
    expect(live.status).toBe('running');
    expect(live.progress).toMatchObject({ phase: 'routing', done: 1, total: 2 });
    await done;
  });

  it('listRuns projects the progress field so a history row can show it', async () => {
    const suite = await seedSuite({ positive: 1 });
    headTestService.routingTest.mockResolvedValue(fakeResult(true, 0.5, 0));
    __mockDb.query.mockResolvedValue({
      all: async () => [{ _key: 'r1', repo_id: 'me', kind: 'run', suite_key: suite._key, status: 'running' }]
    });
    const rows = await svc.listRuns('me', { kind: 'run', limit: 10 });
    expect(rows).toHaveLength(1);
  });
});

// #1181 — the suite provenance label names the model the deployment
// endpoint serves (discovery, !631 policy) instead of the never-injected
// VLLM_LLM_MODEL_ID placeholder 'vllm'.
jest.mock('axios');
describe('suite generator label — model-id discovery (#1181)', () => {
  const axios = require('axios');
  const OLD_ENV = { ...process.env };

  beforeEach(() => {
    // The failed-probe negative window (60 s) is shared process-wide: a
    // probe failure in an earlier test would answer this one from the
    // negative stub instead of the network.
    require('../services/vllm-model-cache').clearModelCache();
  });

  afterEach(() => {
    process.env = { ...OLD_ENV };
    require('../services/vllm-model-cache').clearModelCache();
  });

  it('no pin: payload.generator names the discovered model, not a placeholder', async () => {
    delete process.env.VLLM_MODEL_ID;
    delete process.env.VLLM_LLM_MODEL_ID;
    process.env.VLLM_ENDPOINT = 'http://vllm:8000';
    axios.get.mockResolvedValue({ data: { data: [{ id: 'served/suite-8b' }] } });
    __mockDb.query.mockResolvedValue({ all: async () => [] });
    frontmatterService.vllmChatCompletions.mockResolvedValue(
      llmResponse({
        positive: [{ query: 'What is the licensing fee?', reason: 'topic hit' }],
        negative: [],
        keywords: []
      })
    );
    const s = await svc.generateSuite('me', {}, {});
    expect(s.payload.generator).toBe('llm:served/suite-8b');
  });
});

it('F3: with VLLM_ENDPOINT unset the label still names the model the default host serves', async () => {
  delete process.env.VLLM_MODEL_ID;
  delete process.env.VLLM_LLM_MODEL_ID;
  delete process.env.VLLM_ENDPOINT; // compose okf default — base falls back to the service name
  require('axios').get.mockResolvedValue({ data: { data: [{ id: 'served/suite-8b' }] } });
  __mockDb.query.mockResolvedValue({ all: async () => [] });
  frontmatterService.vllmChatCompletions.mockResolvedValue(
    llmResponse({
      positive: [{ query: 'What is the licensing fee?', reason: 'topic hit' }],
      negative: [],
      keywords: []
    })
  );
  const s = await svc.generateSuite('me', {}, {});
  expect(require('axios').get).toHaveBeenCalledWith('http://vllm:8000/v1/models', expect.anything());
  expect(s.payload.generator).toBe('llm:served/suite-8b');
});

it('r3: the generator label reads the stamped resp.model of the generation calls — no probe at all', async () => {
  delete process.env.VLLM_MODEL_ID;
  delete process.env.VLLM_LLM_MODEL_ID;
  require('axios').get.mockReset(); // must NEVER be called in this path
  __mockDb.query.mockResolvedValue({ all: async () => [] });
  frontmatterService.vllmChatCompletions.mockResolvedValue({
    ...llmResponse({
      positive: [{ query: 'What is the licensing fee?', reason: 'topic hit' }],
      negative: [],
      keywords: []
    }),
    model: 'frontier/tagger-stamped'
  });
  const s = await svc.generateSuite('me', {}, {});
  expect(require('axios').get).not.toHaveBeenCalled();
  expect(s.payload.generator).toBe('llm:frontier/tagger-stamped');
});
