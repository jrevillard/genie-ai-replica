// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// W9 (concept tree browse) — the paginated tree index service contract:
// shape ({total, offset, limit, concepts:[{concept_id,title,links}]}), the
// page bound (default 200, clamp 1..500 — listConceptsMeta's contract), the
// empty repo, the AUTHOR-ONLY links join, and the no-drained-graph degrade.
// The unit ArangoDB mock does not execute AQL (house pattern, see the
// listConceptsMeta regression block): the page queries are emulated against
// the seeded stores, which pins the AQL CONTRACT — the binds (offset/limit),
// the author-marker filter, the from_concept_id join field and the edge
// writer's graph naming — rather than a parser.
// The controller-side fence/publication composition lives in
// repository-controller-surface.test.js (the CAP-2 precedent harness); the
// route-level DEFAULT-OPEN pin lives in repos-routes.test.js.

jest.mock('axios');
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/metrics', () => ({
  getMeter: () => ({ createCounter: () => ({ add: jest.fn() }) })
}));

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const conceptMeta = require('../services/concept-meta-service');

// Seed N meta rows (title sorted REVERSE vs id, so the SORT contract is
// observable through the emulator).
function seedConcepts(repoId, n) {
  for (let i = 0; i < n; i++) {
    mockDb.collection('okf_concepts_meta').save({
      _key: `${repoId}|c${i}`,
      repo_id: repoId,
      concept_id: `c${i}`,
      title: `T${String(n - i).padStart(3, '0')}`,
      is_index: i === 0,
      index_status: i === 0 ? 'indexed' : 'parsed'
    });
  }
}

/** Emulate the tree page queries against the seeded stores: the count, the
 * BATCHED joined page (author edges only, one IN-join per page — David,
 * 2026-11-08 large-repo fix) and the no-graph page (links: []). */
function programTreeQuery() {
  mockDb.query.mockImplementation(async (q, b) => {
    const text = typeof q === 'string' ? q : '';
    if (text.includes('COLLECT WITH COUNT')) {
      const rows = Object.values(mockDb._stores.okf_concepts_meta || {}).filter((d) => d.repo_id === b.rid);
      return { all: async () => [rows.length] };
    }
    const m = /IN `([^`]+)_LINKS_TO`/.exec(text);
    const meta = Object.values(mockDb._stores.okf_concepts_meta || {})
      .filter((d) => d.repo_id === b.rid)
      .sort((x, y) => `${x.title}`.localeCompare(`${y.title}`) || `${x.concept_id}`.localeCompare(`${y.concept_id}`))
      .slice(b.offset, b.offset + b.limit);
    if (m) {
      if (!String(text).includes("e.source == 'author'")) {
        throw new Error('the tree index must join AUTHOR edges only');
      }
      if (!String(text).includes('e.from_concept_id IN ids')) {
        throw new Error(
          'the tree index must join via ONE batched scan (from_concept_id IN <page ids>) — never a correlated per-row subquery (the >300s Bali failure)'
        );
      }
      const edges = Object.values(mockDb._stores[`${m[1]}_LINKS_TO`] || {});
      return {
        all: async () =>
          meta.map((row) => ({
            concept_id: row.concept_id,
            title: row.title,
            is_index: row.is_index,
            index_status: row.index_status,
            links: edges
              .filter((e) => e.from_concept_id === row.concept_id && e.source === 'author')
              .map((e) => e.to_concept_id)
          }))
      };
    }
    return {
      all: async () =>
        meta.map((row) => ({
          concept_id: row.concept_id,
          title: row.title,
          is_index: row.is_index,
          index_status: row.index_status,
          links: []
        }))
    };
  });
}

describe('concept-meta-service.listConceptTree (W9 tree index)', () => {
  beforeEach(() => {
    mockDb._reset();
    programTreeQuery();
  });
  afterEach(() => {
    mockDb.query.mockReset();
    mockDb.query.mockImplementation(async () => ({ all: async () => [] }));
  });

  test('shape: {total, offset, limit, concepts:[{concept_id,title,is_index,index_status,links}]} — nothing else', async () => {
    seedConcepts('r1', 3);
    const page = await conceptMeta.listConceptTree('r1', { limit: 2, offset: 1 });
    expect(page).toEqual({
      total: 3,
      offset: 1,
      limit: 2,
      concepts: [
        { concept_id: 'c1', title: 'T002', is_index: false, index_status: 'parsed', links: [] },
        { concept_id: 'c0', title: 'T003', is_index: true, index_status: 'indexed', links: [] }
      ]
    });
  });

  test('default page 200 when no limit is passed (never the legacy full-array branch)', async () => {
    seedConcepts('r1', 1);
    await conceptMeta.listConceptTree('r1');
    const pageCall = mockDb.query.mock.calls.find(([, b]) => b && b.limit !== undefined);
    expect(pageCall[1].limit).toBe(200);
    expect(pageCall[1].offset).toBe(0);
  });

  test('clamp: limit 1..500 — 0 → 1, 9999 → 500, garbage → 1', async () => {
    seedConcepts('r1', 1);
    await conceptMeta.listConceptTree('r1', { limit: '0' });
    await conceptMeta.listConceptTree('r1', { limit: '9999' });
    await conceptMeta.listConceptTree('r1', { limit: 'abc' });
    const limits = mockDb.query.mock.calls.filter(([, b]) => b && b.limit !== undefined).map(([, b]) => b.limit);
    expect(limits).toEqual([1, 500, 1]);
  });

  test('empty repo: total 0, empty page (no error)', async () => {
    const page = await conceptMeta.listConceptTree('empty-repo', { limit: 200, offset: 0 });
    expect(page).toEqual({ total: 0, offset: 0, limit: 200, concepts: [] });
  });

  test('missing repo_id is refused at the boundary', async () => {
    const page = await conceptMeta.listConceptTree('');
    expect(page.concepts).toEqual([]);
    expect(page.total).toBe(0);
  });

  test('links join: only the AUTHOR edges of each concept, keyed by from_concept_id', async () => {
    seedConcepts('r1', 2);
    // The graph collections are named off the repo registry; with NO repo
    // doc the edge writer's derivation falls back to OKF_<repo_id> — seed
    // that collection so exists() is true and the joined query runs.
    const edgeCol = mockDb.collection('OKF_r1_LINKS_TO');
    await edgeCol.save({ _key: 'e1', from_concept_id: 'c0', to_concept_id: 'c1', source: 'author' });
    await edgeCol.save({ _key: 'e2', from_concept_id: 'c1', to_concept_id: 'c0', source: 'author' });
    // A PARSER edge (no author source) — the emulator refuses any join that
    // does not filter on the author marker, and this row never surfaces.
    await edgeCol.save({ _key: 'e4', from_concept_id: 'c0', to_concept_id: 'c1', source: null });
    const page = await conceptMeta.listConceptTree('r1', { limit: 200, offset: 0 });
    const byId = Object.fromEntries(page.concepts.map((c) => [c.concept_id, c]));
    expect(byId.c0.links).toEqual(['c1']);
    expect(byId.c1.links).toEqual(['c0']);
    // The graph name came from the EDGE WRITER's derivation (no repo doc →
    // the legacy anchor) — never an invented name.
    const pageCall = mockDb.query.mock.calls.find(([q]) => String(q).includes('_LINKS_TO'));
    expect(String(pageCall[0])).toContain('`OKF_r1_LINKS_TO`');
  });

  test('large-repo read path ensures the scale indexes (meta repo_id + edges from_concept_id)', async () => {
    // A UNIQUE repo so the module-level ensure cache has not seen its edge
    // collection yet (the cache deliberately persists across tests).
    seedConcepts('idx-r1', 1);
    const edgeCol = mockDb.collection('OKF_idx-r1_LINKS_TO');
    await edgeCol.save({ _key: 'e1', from_concept_id: 'c0', to_concept_id: 'c0', source: 'author' });
    await conceptMeta.listConceptTree('idx-r1', { limit: 200, offset: 0 });
    expect(edgeCol.ensureIndex).toHaveBeenCalledWith({ type: 'persistent', fields: ['from_concept_id'] });
    // The META index (okf_concepts_meta:repo_id) goes through the same
    // helper, but its ensure fired in this file's FIRST listConceptTree call
    // and the module-level cache holds the verdict — asserting it here would
    // pin Jest's file-local module state, not the code. The fresh edge
    // collection above proves the ensure path.
  });

  test('the index ensure is cached — a second read on the same repo never re-ensures', async () => {
    seedConcepts('idx-r2', 1);
    const edgeCol = mockDb.collection('OKF_idx-r2_LINKS_TO');
    await edgeCol.save({ _key: 'e1', from_concept_id: 'c0', to_concept_id: 'c0', source: 'author' });
    await conceptMeta.listConceptTree('idx-r2', { limit: 200, offset: 0 });
    const callsAfterFirst = edgeCol.ensureIndex.mock.calls.length;
    await conceptMeta.listConceptTree('idx-r2', { limit: 200, offset: 0 });
    expect(edgeCol.ensureIndex.mock.calls.length).toBe(callsAfterFirst);
  });

  test('no drained graph: links degrade to [] (steward on a draft), the page still serves', async () => {
    seedConcepts('draft1', 2); // no OKF_draft1_LINKS_TO docs → exists() false
    const page = await conceptMeta.listConceptTree('draft1', { limit: 200, offset: 0 });
    expect(page.total).toBe(2);
    expect(page.concepts.every((c) => Array.isArray(c.links) && c.links.length === 0)).toBe(true);
    // The joined query never ran.
    expect(mockDb.query.mock.calls.some(([q]) => String(q).includes('_LINKS_TO'))).toBe(false);
  });

  test('out-of-range offset: empty page, total still true', async () => {
    seedConcepts('r1', 2);
    const page = await conceptMeta.listConceptTree('r1', { limit: 200, offset: 5000 });
    expect(page.total).toBe(2);
    expect(page.concepts).toEqual([]);
  });

  test('scale bound: 6352 concepts fully assemble in 32 pages of 200, never one payload', async () => {
    // Programmed cursor at the quran-core-en scale (6352): pins the walk
    // arithmetic the client relies on — ≤ 32 pages of 200, no payload over
    // the bound, every concept exactly once.
    const TOTAL = 6352;
    mockDb.query.mockImplementation(async (q, b) => {
      const text = typeof q === 'string' ? q : '';
      if (text.includes('COLLECT WITH COUNT')) return { all: async () => [TOTAL] };
      const rows = [];
      for (let i = b.offset; i < Math.min(b.offset + b.limit, TOTAL); i++) {
        rows.push({ concept_id: `c${i}`, title: `T${i}`, links: [] });
      }
      return { all: async () => rows };
    });
    const seen = [];
    let offset = 0;
    let pages = 0;
    let maxPayload = 0;
    for (;;) {
      const page = await conceptMeta.listConceptTree('big', { limit: 200, offset });
      pages += 1;
      maxPayload = Math.max(maxPayload, page.concepts.length);
      expect(page.concepts.length).toBeLessThanOrEqual(200); // the bound, per page
      seen.push(...page.concepts.map((c) => c.concept_id));
      if (page.concepts.length < 200 || seen.length >= page.total) break;
      offset = seen.length;
      expect(pages).toBeLessThanOrEqual(32); // 6352 / 200 → 32 pages
    }
    expect(pages).toBe(32);
    expect(maxPayload).toBeLessThanOrEqual(200);
    expect(seen.length).toBe(TOTAL);
    expect(new Set(seen).size).toBe(TOTAL); // no duplicate concept shipped
  });
});
