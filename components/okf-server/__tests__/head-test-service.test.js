// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 1-8 — head-test-service unit tests. The service is the Routing
// Lab backend: query embedding with production prefix fidelity, the
// head leg (formula scoring incl. the forbidden penalty), the Story 1.3
// chunk-probe replay (top-40 / >=3 chunks / floor / degraded), and
// rebuildHead. TEI/vLLM/Arango are mocked; the math is asserted on
// deterministic vectors.

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
// readFrontmatterFromRepoDoc for rebuild).
jest.mock('../services/frontmatter-service', () => {
  const actual = jest.requireActual('../services/frontmatter-service');
  return {
    ...actual,
    teiEmbed: jest.fn(),
    buildVectorizedHead: jest.fn(),
    readFrontmatterFromRepoDoc: jest.fn()
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

function makeHead({ vector, topic, forbidden } = {}) {
  return {
    vector: vector || unit(DIM, 0),
    per_field: {
      topic: topic || unit(DIM, 0),
      entity: null,
      keyword: null,
      summary: null,
      scope: null,
      forbidden: forbidden || null
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
  });

  it('400s without a query', async () => {
    await expect(svc.routingTest('me', {}, {})).rejects.toMatchObject({
      status: 400,
      code: 'VALIDATION_ERROR'
    });
  });

  it('rejects an unknown formula shape', async () => {
    await expect(svc.routingTest('me', { query: 'x', formula: 'bogus' }, {})).rejects.toMatchObject({
      status: 400
    });
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
