// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 1-8 — head-test-service unit tests. The service is the Routing
// Lab backend: query embedding with production prefix fidelity, the
// head leg (formula scoring incl. the forbidden penalty + the 1-8b
// per-tag veto), the Story 1.3 chunk-probe replay (top-40 / >=3 chunks
// / floor / degraded), and rebuildHead. TEI/vLLM/Arango are mocked; the
// math is asserted on deterministic vectors.

// The service reads EMBEDDING_MODEL_ID at module load to pick the
// query-instruction prefix — pin it to the production model so the
// fidelity assertion is deterministic.
process.env.EMBEDDING_MODEL_ID = 'BAAI/bge-large-en-v1.5';

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/metrics', () => ({
  getMeter: () => ({ createCounter: () => ({ add: jest.fn() }) })
}));
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
// The sibling primitives come from frontmatter-service; stub the ones
// the lab calls (teiEmbed for the query embed, buildVectorizedHead +
// readFrontmatterFromRepoDoc for rebuild, vllmChatCompletions for the
// Story 1-8c explain suggestions).
jest.mock('../services/frontmatter-service', () => {
  const actual = jest.requireActual('../services/frontmatter-service');
  return {
    ...actual,
    teiEmbed: jest.fn(),
    buildVectorizedHead: jest.fn(),
    readFrontmatterFromRepoDoc: jest.fn(),
    vllmChatCompletions: jest.fn()
  };
});
jest.mock('../services/repository-service', () => ({
  getById: jest.fn()
}));

const svc = require('../services/head-test-service');
const frontmatterService = require('../services/frontmatter-service');
const repositoryService = require('../services/repository-service');
const { __mockDb } = require('../shared-lib/db-connection-service');

// ---------- deterministic vector helpers ----------

function unit(d, i) {
  // 4-dim unit vector with 1 at position i (orthogonal basis)
  const v = new Array(d).fill(0);
  v[i] = 1;
  return v;
}
const DIM = 4;

function makeHead({ vector, topic, forbidden, forbiddenVectors } = {}) {
  return {
    vector: vector || unit(DIM, 0),
    per_field: {
      topic: topic || unit(DIM, 0),
      entity: null,
      keyword: null,
      summary: null,
      scope: null,
      forbidden: forbidden || null,
      // Story 1-8b — per-tag embeddings for the hard veto ([{tag,
      // vector}]); heads rebuilt before 1-8b omit the key.
      forbidden_vectors: forbiddenVectors || null
    },
    dim: DIM,
    model: 'test-model',
    version: 1,
    computed_at: '2026-10-08T00:00:00.000Z',
    computed_by: 'test'
  };
}

beforeEach(() => {
  jest.clearAllMocks();
});

// ---------- pure math: cosine + formulas ----------

describe('scoreHead formulas (Story 1-8 formula experimentation)', () => {
  const query = unit(DIM, 0); // aligned with topic/head axis

  it('default formula uses the STORED head vector (production parity)', () => {
    const head = makeHead({ vector: unit(DIM, 1) }); // stored vector ≠ per-field
    const r = svc._internals.scoreHead(head, query, 'default');
    expect(r.score).toBeCloseTo(0, 5); // orthogonal stored vector
    expect(r.formula_used).toContain('default');
  });

  it('uniform formula recomputes from per-field vectors (ignores stored vector)', () => {
    const head = makeHead({ topic: unit(DIM, 0) }); // per-field aligned
    head.vector = unit(DIM, 1); // stored vector deliberately orthogonal
    const r = svc._internals.scoreHead(head, query, 'uniform');
    expect(r.score).toBeCloseTo(1, 5);
  });

  it('custom weights weight the positive fields', () => {
    const head = makeHead({ topic: unit(DIM, 0) });
    head.per_field.entity = unit(DIM, 1);
    const r = svc._internals.scoreHead(head, query, { topic: 1, entity: 3 });
    // (1*1 + 3*0) / 4
    expect(r.score).toBeCloseTo(0.25, 5);
  });

  it('forbidden weight is a SUBTRACTIVE penalty (never a bonus)', () => {
    const head = makeHead({ topic: unit(DIM, 0), forbidden: unit(DIM, 1) });
    const aligned = svc._internals.scoreHead(head, query, {
      topic: 1,
      forbidden: 0.5
    });
    expect(aligned.score).toBeCloseTo(1 - 0.5 * 0, 5); // forbidden orthogonal → no penalty
    const anti = svc._internals.scoreHead(head, unit(DIM, 1), {
      topic: 1,
      forbidden: 0.5
    });
    expect(anti.score).toBeCloseTo(0 - 0.5 * 1, 5); // query hits forbidden axis
  });

  it('surfaces per-tag forbidden cosines (the 1-8b veto input)', () => {
    const head = makeHead({ topic: unit(DIM, 0) });
    head.per_field.forbidden_vectors = [
      { tag: 'exercise', vector: unit(DIM, 0) }, // aligned with the query → 1.0
      { tag: 'genetics', vector: unit(DIM, 1) }, // orthogonal → 0.0
      { tag: 'broken', vector: 'not-a-vector' }, // malformed → skipped
      null // malformed → skipped
    ];
    const r = svc._internals.scoreHead(head, unit(DIM, 0), 'default');
    expect(r.tag_cosines).toEqual([
      { tag: 'exercise', cosine: 1 },
      { tag: 'genetics', cosine: 0 }
    ]);
  });

  it('returns an empty tag list when the head predates per-tag vectors', () => {
    const head = makeHead({ topic: unit(DIM, 0) }); // forbidden_vectors null
    const r = svc._internals.scoreHead(head, unit(DIM, 0), 'default');
    expect(r.tag_cosines).toEqual([]);
  });

  it('missing head → null score (never a crash)', () => {
    expect(svc._internals.scoreHead(null, query, 'default').score).toBeNull();
    expect(svc._internals.scoreHead({}, query, 'default').score).toBeNull();
  });
});

describe('queryInstructionFor (production embedding fidelity)', () => {
  it('applies the BGE prefix for bge-large (chatqna parity)', () => {
    const p = svc._internals.queryInstructionFor('BAAI/bge-large-en-v1.5');
    expect(p).toBe('Represent this sentence for searching relevant passages: ');
  });
  it('unknown models get NO prefix', () => {
    expect(svc._internals.queryInstructionFor('some-other-model')).toBe('');
  });
});

describe('qualifyProbes (Story 1.3 replay semantics)', () => {
  const mk = (repo, scores) => ({ repo_id: repo, top_scores: scores });

  it('qualifies a graph with >= ROUTE_MIN_CHUNKS chunks in the global top-40', () => {
    const out = svc._internals.qualifyProbes([mk('a', [0.9, 0.8, 0.7, 0.1]), mk('b', [0.5, 0.4])]);
    expect(out.qualified).toEqual(['a']);
    // ROUTE_TOP_K (40) > all 6 rows → every chunk competes globally.
    expect(out.per_repo.a.chunks_in_top).toBe(4);
    expect(out.per_repo.b.chunks_in_top).toBe(2);
    expect(out.degraded).toBe(false);
  });

  it('floor selects the single best graph when nothing qualifies (never zero)', () => {
    const out = svc._internals.qualifyProbes([mk('a', [0.9, 0.05]), mk('b', [0.5])]);
    expect(out.qualified).toEqual([]);
    expect(out.floor).toBe('a');
    expect(out.selected).toEqual(['a']);
  });

  it('any probe error marks the aggregate degraded (production semantics)', () => {
    const out = svc._internals.qualifyProbes([
      mk('a', [0.9, 0.8, 0.7]),
      { repo_id: 'b', top_scores: null, error: 'probe timeout' }
    ]);
    expect(out.degraded).toBe(true);
    expect(out.qualified).toEqual(['a']);
  });
});

// ---------- routingTest (integration over mocks) ----------

describe('routingTest', () => {
  it('runs the head leg incl. GRAPH-LESS siblings and reports the verdict', async () => {
    frontmatterService.teiEmbed.mockResolvedValue([unit(DIM, 0)]);
    repositoryService.getById.mockResolvedValue({
      _key: 'me',
      name: 'Under Test',
      lifecycle_state: 'publish',
      ingested_graph_name: null, // pre-ingest: head-only
      head: makeHead({ vector: unit(DIM, 0) }),
      frontmatter: { updated_at: '2026-10-07T00:00:00.000Z' }
    });
    // Siblings: one with a head (graph-less too) — head competition only.
    __mockDb.query.mockImplementation(async (aql) => {
      if (aql.includes('FILTER r.head != null')) {
        return {
          all: async () => [
            {
              _key: 'sib1',
              name: 'Sibling',
              lifecycle_state: 'publish',
              ingested_at: null,
              ingested_graph_name: null,
              version: 1
            }
          ]
        };
      }
      if (aql.includes('r._key IN @ids')) {
        return { all: async () => [{ _key: 'sib1', head: makeHead({ vector: unit(DIM, 1) }) }] };
      }
      return { all: async () => [] };
    });

    const res = await svc.routingTest('me', { query: 'cancer screening guidance', include_probes: true }, {});
    expect(res.embedded_with).toContain('query-instruction');
    expect(res.under_test.has_graph).toBe(false);
    expect(res.under_test.head_score).toBeCloseTo(1, 5);
    expect(res.siblings).toHaveLength(1);
    expect(res.siblings[0].has_graph).toBe(false);
    expect(res.siblings[0].probe).toBeNull();
    // The head leg is the pre-ingest signal: under test wins.
    expect(res.verdict.head_routing_winner).toBe('me');
    expect(res.verdict.under_test_wins_head).toBe(true);
    expect(res.verdict.current_routing_winner).toBe('no-graph-under-test');
    expect(res.verdict.provenance).toContain('head-only');
    expect(res.fidelity.knobs.ROUTE_MIN_CHUNKS).toBeGreaterThanOrEqual(1);
    expect(res.fidelity.algorithm).toBe('story-1.3-replay+v2');
    expect(res.fidelity.knobs.ROUTE_HEAD_MARGIN).toBeGreaterThan(0);
    expect(res.fidelity.knobs.ROUTE_HEAD_FLOOR).toBeGreaterThan(0);
    expect(res.fidelity.knobs.ROUTE_FORBIDDEN_TAG_MAX).toBeGreaterThan(0);
  });

  it('400s without a query', async () => {
    await expect(svc.routingTest('me', {}, {})).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR'
    });
  });

  // ─── Story 1-8a/1-8b: the forbidden/noise GATE (David 1-8a: "under no
  // circumstances should 'fun in Indonesia' be routed to the NCD repo";
  // 1-8b: "forbidden is forbidden — a hard contract, it should
  // immediately score zero"). A head CLAIMS a query only with ALL of:
  // floor (score ≥ ROUTE_HEAD_FLOOR), no tag veto (no forbidden tag
  // cosine ≥ ROUTE_FORBIDDEN_TAG_MAX), and margin (score clears the
  // averaged forbidden centroid by > ROUTE_HEAD_MARGIN). head_claim
  // names the deciding condition: floor | veto | margin | claim. ───

  function soloRepoSetup(head) {
    frontmatterService.teiEmbed.mockResolvedValue([unit(DIM, 0)]);
    repositoryService.getById.mockResolvedValue({
      _key: 'me',
      name: 'Under Test',
      lifecycle_state: 'publish',
      ingested_graph_name: null,
      head,
      frontmatter: { updated_at: '2026-10-07T00:00:00.000Z' }
    });
    __mockDb.query.mockImplementation(async (aql) => {
      if (aql.includes('FILTER r.head != null')) return { all: async () => [] };
      return { all: async () => [] };
    });
  }

  it('suppresses a query that never clears the claim FLOOR (off-domain)', async () => {
    // score 0.5 clears the forbidden centroid by +0.5 (margin would
    // pass) and matches no forbidden tag — but 0.5 < ROUTE_HEAD_FLOOR
    // 0.55 suppresses: the calibration gap (unrelated queries score
    // 0.32-0.48 on a real head; legit claims start at 0.614).
    soloRepoSetup(makeHead({ vector: [0.5, 0.5, 0.5, 0.5], forbidden: unit(DIM, 2) }));
    const res = await svc.routingTest('me', { query: 'capital of France' }, {});
    expect(res.under_test.head_score).toBeCloseTo(0.5, 5);
    expect(res.under_test.floor_pass).toBe(false);
    expect(res.under_test.head_margin).toBeCloseTo(0.5, 5);
    expect(res.under_test.tag_veto).toBeNull();
    expect(res.under_test.head_claimed).toBe(false);
    expect(res.under_test.head_claim).toBe('floor');
    expect(res.verdict.head_routing_winner).toBeNull();
    expect(res.verdict.head_suppressed).toBe(true);
    expect(res.verdict.provenance).toBe('head-suppressed (off-domain)');
  });

  it('vetoes a mixed-subject query on a single forbidden tag even with floor+margin clear', async () => {
    // score 0.9 (floor pass), forbidden centroid orthogonal (margin
    // +0.9 > 0.01) — but the 'exercise' tag vector is aligned with the
    // query (cosine 1.0 ≥ ROUTE_FORBIDDEN_TAG_MAX): the hard veto wins.
    soloRepoSetup(
      makeHead({
        vector: [0.9, Math.sqrt(1 - 0.9 * 0.9), 0, 0], // unit; cos(q, head) = 0.9
        forbidden: unit(DIM, 1),
        forbiddenVectors: [{ tag: 'exercise', vector: unit(DIM, 0) }]
      })
    );
    const res = await svc.routingTest('me', { query: 'exercise and asthma' }, {});
    expect(res.under_test.floor_pass).toBe(true);
    expect(res.under_test.head_margin).toBeCloseTo(0.9, 5);
    expect(res.under_test.max_tag_cosine).toBeCloseTo(1, 5);
    expect(res.under_test.tag_veto).toBe('exercise');
    expect(res.under_test.head_claimed).toBe(false);
    expect(res.under_test.head_claim).toBe('veto');
    expect(res.verdict.head_routing_winner).toBeNull();
    expect(res.verdict.head_suppressed).toBe(true);
    expect(res.verdict.provenance).toBe('head-suppressed (forbidden: exercise)');
  });

  it('suppresses a forbidden-dominant top scorer on the MARGIN rule', async () => {
    // score 1.0, forbidden 1.0 → margin 0 ≤ ROUTE_HEAD_MARGIN; floor
    // passes and no per-tag vectors exist (veto skips) → margin decides.
    soloRepoSetup(makeHead({ vector: unit(DIM, 0), forbidden: unit(DIM, 0) }));
    const res = await svc.routingTest('me', { query: 'mental health guidance' }, {});
    expect(res.under_test.head_score).toBeCloseTo(1, 5);
    expect(res.under_test.forbidden_cosine).toBeCloseTo(1, 5);
    expect(res.under_test.head_margin).toBeCloseTo(0, 5);
    expect(res.under_test.floor_pass).toBe(true);
    expect(res.under_test.max_tag_cosine).toBeNull();
    expect(res.under_test.tag_veto).toBeNull();
    expect(res.under_test.head_claimed).toBe(false);
    expect(res.under_test.head_claim).toBe('margin');
    expect(res.verdict.head_routing_winner).toBeNull();
    expect(res.verdict.under_test_wins_head).toBe(false);
    expect(res.verdict.head_suppressed).toBe(true);
    expect(res.verdict.provenance).toBe('head-suppressed (forbidden/noise)');
  });

  it('claims a query that clears floor, veto and margin (the genetics ruling)', async () => {
    // score 1.0 (floor pass), forbidden centroid orthogonal (margin
    // +1.0 > 0.01), no forbidden tags at all → affirmative claim.
    soloRepoSetup(makeHead({ vector: unit(DIM, 0), forbidden: unit(DIM, 1) }));
    const res = await svc.routingTest('me', { query: 'genetic risk factors for cancer' }, {});
    expect(res.under_test.floor_pass).toBe(true);
    expect(res.under_test.tag_veto).toBeNull();
    expect(res.under_test.head_claimed).toBe(true);
    expect(res.under_test.head_claim).toBe('claim');
    expect(res.verdict.under_test_wins_head).toBe(true);
    expect(res.verdict.head_suppressed).toBe(false);
    expect(res.verdict.provenance).toBe('head-only (no graph under test)');
  });

  it('a head WITHOUT forbidden data degrades open: veto+margin skip, floor still applies', async () => {
    // Pre-1-8b head: no forbidden centroid, no per-tag vectors. The gate
    // never silently suppresses on missing data — score 1.0 passes the
    // floor, the veto and the margin skip → claims.
    soloRepoSetup(makeHead({ vector: unit(DIM, 0), forbidden: null }));
    const res = await svc.routingTest('me', { query: 'anything at all' }, {});
    expect(res.under_test.forbidden_cosine).toBeNull();
    expect(res.under_test.head_margin).toBeNull();
    expect(res.under_test.max_tag_cosine).toBeNull();
    expect(res.under_test.tag_veto).toBeNull();
    expect(res.under_test.floor_pass).toBe(true);
    expect(res.under_test.head_claimed).toBe(true);
    expect(res.under_test.head_claim).toBe('claim');
    expect(res.verdict.under_test_wins_head).toBe(true);
  });

  it('rejects an unknown formula shape', async () => {
    await expect(svc.routingTest('me', { query: 'x', formula: 'bogus' }, {})).rejects.toMatchObject({
      status: 400
    });
  });
});

// ---------- Story 1-8c: explainRouting (the teaching half of the loop) ----------

describe('explainRouting (Story 1-8c — advice for a wrongly-claiming head)', () => {
  // The 'genetics ruling' shape from the routingTest suite above: floor
  // pass, orthogonal forbidden centroid, no per-tag vectors → CLAIM.
  function claimingRepoSetup() {
    frontmatterService.teiEmbed.mockResolvedValue([unit(DIM, 0)]);
    repositoryService.getById.mockResolvedValue({
      _key: 'me',
      name: 'NCD Information',
      lifecycle_state: 'publish',
      ingested_graph_name: null,
      head: makeHead({ vector: unit(DIM, 0), forbidden: unit(DIM, 1) }),
      frontmatter: { updated_at: '2026-10-07T00:00:00.000Z' }
    });
    __mockDb.query.mockImplementation(async () => ({ all: async () => [] }));
    frontmatterService.readFrontmatterFromRepoDoc.mockResolvedValue({
      topic: ['noncommunicable-diseases'],
      entity: ['breast-cancer'],
      forbidden: ['mental-health'],
      summary: 'NCD guidance.'
    });
  }

  it('a CLAIMING query gets LLM-suggested forbidden tags — kebab-normalized, already-forbidden deduped', async () => {
    claimingRepoSetup();
    frontmatterService.vllmChatCompletions.mockResolvedValue({
      data: {
        choices: [
          {
            message: {
              content: 'Here you go: {"tags": ["Communicable Disease", "Mental Health", "Vaccination Programs"]}'
            }
          }
        ]
      }
    });
    const res = await svc.explainRouting('me', { query: 'hiv prevalence surveillance data' }, {});
    expect(res.under_test.head_claimed).toBe(true);
    // 'Communicable Disease' → kebab-case; 'Mental Health' normalizes to
    // 'mental-health' which is already forbidden → dropped; the prose
    // around the JSON object is stripped by the strict parser.
    expect(res.suggestion).toEqual({
      tags: ['communicable-disease', 'vaccination-programs'],
      source: 'llm',
      reason: "suggested forbidden tags for this query's subject"
    });
    // ONE batch call whose prompt carries the repo scope, the
    // already-forbidden list and the query itself.
    expect(frontmatterService.vllmChatCompletions).toHaveBeenCalledTimes(1);
    const prompt = frontmatterService.vllmChatCompletions.mock.calls[0][0][0].content;
    expect(prompt).toContain('hiv prevalence surveillance data');
    expect(prompt).toContain('mental-health');
    expect(prompt).toContain('breast-cancer');
    // The explain path is head-leg only — no chunk probes are fired.
    expect(__mockDb.query.mock.calls.every(([aql]) => !aql.includes('APPROX_NEAR_COSINE'))).toBe(true);
  });

  it('caps the LLM suggestions at 3 tags', async () => {
    claimingRepoSetup();
    frontmatterService.vllmChatCompletions.mockResolvedValue({
      data: { choices: [{ message: { content: '{"tags": ["tag-one", "tag-two", "tag-three", "tag-four"]}' } }] }
    });
    const res = await svc.explainRouting('me', { query: 'still a claiming query' }, {});
    expect(res.suggestion.tags).toEqual(['tag-one', 'tag-two', 'tag-three']);
  });

  it('an LLM failure degrades honestly (source none, reason, no throw)', async () => {
    claimingRepoSetup();
    frontmatterService.vllmChatCompletions.mockRejectedValue(new Error('vllm down'));
    const res = await svc.explainRouting('me', { query: 'hiv prevalence data' }, {});
    expect(res.suggestion.tags).toEqual([]);
    expect(res.suggestion.source).toBe('none');
    expect(res.suggestion.reason).toContain('unreachable');
  });

  it('unparseable LLM output → source none with the manual-review reason', async () => {
    claimingRepoSetup();
    frontmatterService.vllmChatCompletions.mockResolvedValue({
      data: { choices: [{ message: { content: 'no json object in here at all' } }] }
    });
    const res = await svc.explainRouting('me', { query: 'hiv prevalence data' }, {});
    expect(res.suggestion.tags).toEqual([]);
    expect(res.suggestion.source).toBe('none');
    expect(res.suggestion.reason).toContain('manually');
  });

  it('a NON-claiming query explains the gate WITHOUT calling the LLM or re-reading frontmatter', async () => {
    // Floor-suppressed shape (score 0.5 < ROUTE_HEAD_FLOOR 0.55): the
    // verdict already teaches the fix (a floor failure is correct
    // suppression), so the suggestion stays empty at zero LLM cost.
    frontmatterService.teiEmbed.mockResolvedValue([unit(DIM, 0)]);
    repositoryService.getById.mockResolvedValue({
      _key: 'me',
      name: 'NCD Information',
      lifecycle_state: 'publish',
      ingested_graph_name: null,
      head: makeHead({ vector: [0.5, 0.5, 0.5, 0.5], forbidden: unit(DIM, 2) }),
      frontmatter: { updated_at: '2026-10-07T00:00:00.000Z' }
    });
    __mockDb.query.mockImplementation(async () => ({ all: async () => [] }));
    const res = await svc.explainRouting('me', { query: 'capital of France' }, {});
    expect(res.under_test.head_claimed).toBe(false);
    expect(res.under_test.head_claim).toBe('floor');
    expect(res.suggestion).toEqual({ tags: [], source: 'none', reason: '' });
    expect(frontmatterService.vllmChatCompletions).not.toHaveBeenCalled();
    expect(frontmatterService.readFrontmatterFromRepoDoc).not.toHaveBeenCalled();
  });

  it('400s on an empty/whitespace query before touching the repo', async () => {
    await expect(svc.explainRouting('me', {}, {})).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR'
    });
    await expect(svc.explainRouting('me', { query: '   ' }, {})).rejects.toMatchObject({ status: 400 });
    expect(repositoryService.getById).not.toHaveBeenCalled();
  });
});

// ---------- gate v2 knobs: env-tunable at module load ----------

describe('gate v2 knobs are env-tunable', () => {
  // ROUTE_HEAD_FLOOR / ROUTE_FORBIDDEN_TAG_MAX are parsed at module
  // load (production tunes them via .env). A fresh require under
  // overridden env proves the contract; the top-level `svc` keeps its
  // original knobs, so these tests load their own instance.
  function freshLoad(envOverrides) {
    jest.resetModules();
    for (const [k, v] of Object.entries(envOverrides)) process.env[k] = v;
    const fm = require('../services/frontmatter-service');
    const repository = require('../services/repository-service');
    const db = require('../shared-lib/db-connection-service').__mockDb;
    return { svc: require('../services/head-test-service'), fm, repository, db };
  }

  function soloFreshSetup(head, fm, repository, db) {
    fm.teiEmbed.mockResolvedValue([unit(DIM, 0)]);
    repository.getById.mockResolvedValue({
      _key: 'me',
      name: 'Under Test',
      lifecycle_state: 'publish',
      ingested_graph_name: null,
      head,
      frontmatter: { updated_at: '2026-10-07T00:00:00.000Z' }
    });
    db.query.mockImplementation(async () => ({ all: async () => [] }));
  }

  afterEach(() => {
    delete process.env.RETRIEVER_ROUTE_HEAD_FLOOR;
    delete process.env.RETRIEVER_ROUTE_FORBIDDEN_TAG_MAX;
    jest.resetModules();
  });

  it('ROUTE_HEAD_FLOOR lowers the claim floor (a 0.5-scored head claims under floor=0.3)', async () => {
    // The default 0.55 floor suppresses this head (see the floor test
    // above); the deployer's lower bar must let it claim.
    const { svc: fresh, fm, repository, db } = freshLoad({ RETRIEVER_ROUTE_HEAD_FLOOR: '0.3' });
    soloFreshSetup(makeHead({ vector: [0.5, 0.5, 0.5, 0.5], forbidden: unit(DIM, 2) }), fm, repository, db);
    const res = await fresh.routingTest('me', { query: 'half-related query' }, {});
    expect(res.fidelity.knobs.ROUTE_HEAD_FLOOR).toBe(0.3);
    expect(res.under_test.floor_pass).toBe(true);
    expect(res.under_test.head_claimed).toBe(true);
    expect(res.under_test.head_claim).toBe('claim');
  });

  it('ROUTE_FORBIDDEN_TAG_MAX relaxes the veto (a 0.6 tag cosine claims under max=0.9)', async () => {
    // The default 0.55 veto threshold rejects a 0.6 tag cosine; the
    // deployer's higher bar must not.
    const { svc: fresh, fm, repository, db } = freshLoad({ RETRIEVER_ROUTE_FORBIDDEN_TAG_MAX: '0.9' });
    soloFreshSetup(
      makeHead({
        vector: unit(DIM, 0),
        forbidden: unit(DIM, 1),
        forbiddenVectors: [{ tag: 'exercise', vector: [0.6, 0.8, 0, 0] }] // unit; cos(q, tag) = 0.6
      }),
      fm,
      repository,
      db
    );
    const res = await fresh.routingTest('me', { query: 'on-topic query' }, {});
    expect(res.fidelity.knobs.ROUTE_FORBIDDEN_TAG_MAX).toBe(0.9);
    expect(res.under_test.max_tag_cosine).toBeCloseTo(0.6, 5);
    expect(res.under_test.tag_veto).toBeNull();
    expect(res.under_test.head_claimed).toBe(true);
    expect(res.under_test.head_claim).toBe('claim');
  });
});

describe('rebuildHead', () => {
  it('rebuilds from the STORED frontmatter via buildVectorizedHead', async () => {
    repositoryService.getById.mockResolvedValue({ _key: 'me' });
    frontmatterService.readFrontmatterFromRepoDoc.mockResolvedValue({ topic: ['a'], forbidden: ['b'] });
    frontmatterService.buildVectorizedHead.mockResolvedValue({ dim: 4, vector: unit(DIM, 0) });
    const head = await svc.rebuildHead('me', { actor: { user_id: 'u1' } });
    expect(frontmatterService.buildVectorizedHead).toHaveBeenCalledWith(
      'me',
      { topic: ['a'], forbidden: ['b'] },
      expect.objectContaining({ actor: { user_id: 'u1' } })
    );
    expect(head.dim).toBe(4);
  });

  it('409s when the repo has no stored frontmatter', async () => {
    repositoryService.getById.mockResolvedValue({ _key: 'me' });
    frontmatterService.readFrontmatterFromRepoDoc.mockResolvedValue(null);
    await expect(svc.rebuildHead('me', {})).rejects.toMatchObject({ status: 409 });
  });
});
