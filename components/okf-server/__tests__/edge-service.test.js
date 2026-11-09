// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 2.9.3 T1 — the _LINKS_TO edge writer (G7/G22): post-index, within-repo
// validated, ENTITY nodes ensured, replace-on-reingest, cross-repo dropped.

jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), error: jest.fn(), warn: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/metrics', () => ({
  getMeter: () => ({ createCounter: () => ({ add: jest.fn() }) })
}));
jest.mock('../services/audit-service', () => ({
  writeAudit: jest.fn().mockResolvedValue(null)
}));
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const edgeService = require('../services/edge-service');
const { logger } = require('../shared-lib/logger');

const REPO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const GRAPH = `OKF_${REPO}`;

/**
 * The service queries by AQL SHAPE, not by call order:
 *  - the concept's own meta read (RETURN KEEP(...)),
 *  - one PER-TARGET probe on the (repo_id, concept_id) index — the within-repo
 *    boundary check (#1179: a whole-set read made an N-concept drain pay
 *    N x N row reads),
 *  - the outgoing-edge cleanup read (RETURN e._key).
 */
function programQueries(metaRows, repoConceptIds, options = {}) {
  const inRepo = new Set(repoConceptIds);
  const cleanupKeys = options.cleanupKeys || [];
  mockDb.query.mockImplementation(async (aql, bindVars = {}) => {
    if (aql.includes('RETURN KEEP(m,')) return { all: async () => metaRows };
    if (aql.includes('RETURN m.concept_id')) {
      // The per-target probe: a hit iff the repo holds that concept under
      // either stored form (bare or `concepts/`-prefixed).
      const hit = inRepo.has(bindVars.cid) || inRepo.has(bindVars.prefixed);
      return { all: async () => (hit ? [{ concept_id: bindVars.cid }] : []) };
    }
    if (aql.includes('RETURN e._key')) return { all: async () => cleanupKeys };
    return { all: async () => [] };
  });
}

function metaRow(overrides = {}) {
  return {
    repo_id: REPO,
    concept_id: 'service_directory',
    title: 'Service Directory',
    labels: [],
    links: [],
    ...overrides
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb._reset();
});

describe('edgeService.writeRepoConceptEdges (Story 2.9.3)', () => {
  test('writes within-repo edges: source ENTITY ensured, edges carry label/file_id/repo_id/bundle_version', async () => {
    programQueries(
      [
        metaRow({
          links: [
            { to_concept_id: 'index', label: 'Index' },
            { to_concept_id: 'huduma_kenya', label: 'Huduma' }
          ]
        })
      ],
      ['service_directory', 'index', 'huduma_kenya']
    );
    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {
      file_id: 'file-1',
      bundle_version: 3
    });
    expect(result).toMatchObject({ repo_id: REPO, concept_id: 'service_directory', written: 2, dropped: [] });
    // Edges written into OKF_{repo}_LINKS_TO
    const edges = Object.values(mockDb._stores[`${GRAPH}_LINKS_TO`] || {});
    expect(edges).toHaveLength(2);
    for (const e of edges) {
      expect(e._from).toMatch(new RegExp(`${GRAPH}_ENTITY/c_[a-f0-9]+`));
      expect(e._to).toMatch(new RegExp(`${GRAPH}_ENTITY/c_[a-f0-9]+`));
      expect(e.repo_id).toBe(REPO);
      expect(e.file_id).toBe('file-1');
      expect(e.bundle_version).toBe(3);
      expect(typeof e.label).toBe('string');
    }
    // Source ENTITY vertex ensured
    const entities = Object.values(mockDb._stores[`${GRAPH}_ENTITY`] || {});
    expect(entities.length).toBeGreaterThan(0);
  });

  test('the bundle ROOT (is_index) is stamped on its ENTITY vertex (Story 4.8-amend)', async () => {
    programQueries(
      [metaRow({ concept_id: 'index', is_index: true, links: [{ to_concept_id: 'huduma_kenya', label: 'Huduma' }] })],
      ['index', 'huduma_kenya']
    );
    await edgeService.writeRepoConceptEdges(REPO, 'index', { file_id: 'file-idx', bundle_version: 1 });
    const entities = Object.values(mockDb._stores[`${GRAPH}_ENTITY`] || {});
    const indexEntity = entities.find((e) => e.concept_id === 'index');
    expect(indexEntity).toBeTruthy();
    expect(indexEntity.is_index).toBe(true);
  });

  test('cross-repo / missing targets are DROPPED + logged (G22) — never materialized', async () => {
    programQueries(
      [
        metaRow({
          links: [
            { to_concept_id: 'other_repo_concept', label: 'Bad' },
            { to_concept_id: 'index', label: 'Ok' }
          ]
        })
      ],
      ['service_directory', 'index'] // 'other_repo_concept' NOT in the set
    );
    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    expect(result.written).toBe(1);
    expect(result.dropped).toEqual(['other_repo_concept']);
    expect(logger.info).toHaveBeenCalledWith(
      'Edge write: cross-repo/missing target dropped (G22)',
      expect.objectContaining({ from: 'service_directory', to: 'other_repo_concept' })
    );
    const edges = Object.values(mockDb._stores[`${GRAPH}_LINKS_TO`] || {});
    expect(edges).toHaveLength(1);
    expect(edges[0]._to).not.toMatch(/other_repo_concept/);
  });

  test("replace-on-reingest: the concept's OLD outgoing edges are removed before the new ones", async () => {
    // Pre-seed one existing edge from this concept (a link that was removed in v2).
    await mockDb.collection(`${GRAPH}_LINKS_TO`).save({
      _key: 'e_stale',
      _from: `${GRAPH}_ENTITY/c_source`,
      _to: `${GRAPH}_ENTITY/c_oldtarget`,
      label: 'Removed',
      repo_id: REPO
    });
    programQueries(
      [metaRow({ links: [{ to_concept_id: 'index', label: 'Current' }] })],
      ['service_directory', 'index'],
      { cleanupKeys: ['e_stale'] }
    );
    await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    const edges = Object.values(mockDb._stores[`${GRAPH}_LINKS_TO`] || {});
    expect(edges).toHaveLength(1); // stale one gone
    expect(edges[0].label).toBe('Current');
  });

  test('no-links concept: no edges, but the ENTITY vertex is still ensured', async () => {
    programQueries([metaRow({ links: [] })], ['service_directory']);
    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    expect(result.written).toBe(0);
    expect(Object.values(mockDb._stores[`${GRAPH}_LINKS_TO`] || {})).toHaveLength(0);
    expect(Object.values(mockDb._stores[`${GRAPH}_ENTITY`] || {})).toHaveLength(1);
  });

  test('missing meta row → clean no-op (no crash into the ingest path)', async () => {
    programQueries([], ['service_directory']);
    const result = await edgeService.writeRepoConceptEdges(REPO, 'ghost', {});
    expect(result).toMatchObject({ written: 0, dropped: [] });
  });

  test('repo concept-set read failure → drops all links (fail-closed, G22)', async () => {
    mockDb.query.mockImplementation(async (aql) => {
      if (aql.includes('RETURN KEEP(m,')) {
        return { all: async () => [metaRow({ links: [{ to_concept_id: 'x', label: 'X' }] })] };
      }
      if (aql.includes('RETURN m.concept_id')) throw new Error('arango down');
      return { all: async () => [] };
    });
    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    expect(result).toMatchObject({ written: 0, dropped: ['x'] });
  });
});

describe('edgeService — review fixes (2026-08-17)', () => {
  const { writeAudit } = require('../services/audit-service');

  test('P1: canonicalizes concepts/-prefixed link targets against a prefixed stored set (no silent edge loss)', async () => {
    // Stored concept ids are `concepts/`-prefixed (subdirectory bundle); link
    // targets are bare (parser strips ./ from the href). Both must normalize.
    programQueries(
      [metaRow({ links: [{ to_concept_id: 'index', label: 'Index' }] })],
      ['concepts/service_directory', 'concepts/index']
    );
    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    expect(result.written).toBe(1);
    expect(result.dropped).toEqual([]);
    // target ENTITY node written with the NORMALIZED concept_id
    const entities = Object.values(mockDb._stores[`${GRAPH}_ENTITY`] || {});
    expect(entities.some((v) => v.concept_id === 'index')).toBe(true);
  });

  test('P2: N→0 replace — removing the last link deletes the stale edge', async () => {
    await mockDb.collection(`${GRAPH}_LINKS_TO`).save({
      _key: 'e_stale',
      _from: `${GRAPH}_ENTITY/c_source`,
      _to: `${GRAPH}_ENTITY/c_target`,
      label: 'Old',
      repo_id: REPO
    });
    programQueries([metaRow({ links: [] })], ['service_directory'], { cleanupKeys: ['e_stale'] });
    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    expect(result.written).toBe(0);
    expect(Object.values(mockDb._stores[`${GRAPH}_LINKS_TO`] || {})).toHaveLength(0); // stale edge gone
  });

  test('P3+P4: ensures TARGET entity vertices + writes the audit row', async () => {
    programQueries([metaRow({ links: [{ to_concept_id: 'index', label: 'I' }] })], ['service_directory', 'index']);
    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', { file_id: 'f1' });
    expect(result.written).toBe(1);
    const entities = Object.values(mockDb._stores[`${GRAPH}_ENTITY`] || {});
    expect(entities.some((v) => v.concept_id === 'service_directory')).toBe(true); // source
    expect(entities.some((v) => v.concept_id === 'index')).toBe(true); // target (P3)
    expect(writeAudit).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'repo.edges_written', actor: 'okf-worker', repo_id: REPO })
    );
  });

  test('P5: duplicate link targets collapse to ONE edge and an accurate written count', async () => {
    programQueries(
      [
        metaRow({
          links: [
            { to_concept_id: 'index', label: 'First' },
            { to_concept_id: 'index', label: 'Second' }
          ]
        })
      ],
      ['service_directory', 'index']
    );
    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    expect(result.written).toBe(1);
    expect(Object.values(mockDb._stores[`${GRAPH}_LINKS_TO`] || {})).toHaveLength(1);
  });

  test('P6: idempotent ENTITY upsert — a second write keeps ONE source vertex (same _key)', async () => {
    programQueries([metaRow({ links: [] })], ['service_directory']);
    await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    const keys = Object.keys(mockDb._stores[`${GRAPH}_ENTITY`] || {});
    expect(keys).toHaveLength(1);
    const before = keys[0];
    // second write (same concept) — still one vertex, same key
    programQueries([metaRow({ links: [] })], ['service_directory']);
    mockDb.query.mockImplementationOnce(async () => ({ all: async () => [] }));
    await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    const keys2 = Object.keys(mockDb._stores[`${GRAPH}_ENTITY`] || {});
    expect(keys2).toEqual([before]);
  });
});

describe('edgeService.writeRepoConceptEdges — within-repo boundary read (#1179)', () => {
  test('the repo concept set is PROBED per link target, never fetched whole (no N x N row reads)', async () => {
    const links = Array.from({ length: 12 }, (_, i) => ({ to_concept_id: `concept_${i}`, label: `L${i}` }));
    programQueries(
      [metaRow({ links })],
      links.map((l) => l.to_concept_id)
    );

    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});

    expect(result.written).toBe(12);
    // The whole-set read — one query returning EVERY concept id of the repo —
    // is what made an N-concept drain pay N x N row reads. It must be gone.
    const wholeSetReads = mockDb.query.mock.calls.filter(
      ([aql]) => typeof aql === 'string' && aql.includes('RETURN m.concept_id') && !aql.includes('@cid')
    );
    expect(wholeSetReads).toHaveLength(0);
    // One point probe per DISTINCT link target, each index-served by
    // (repo_id, concept_id) — the count scales with the links, not the repo.
    const probes = mockDb.query.mock.calls.filter(
      ([aql]) => typeof aql === 'string' && aql.includes('RETURN m.concept_id') && aql.includes('@cid')
    );
    expect(probes).toHaveLength(12);
    for (const [, bindVars] of probes) {
      expect(bindVars.repo_id).toBe(REPO);
      expect(bindVars.cid).toMatch(/^concept_\d+$/);
    }
  });

  test('a link target OUTSIDE the repo is still dropped — the probe never widens the boundary', async () => {
    programQueries(
      [
        metaRow({
          links: [
            { to_concept_id: 'in_repo', label: 'In' },
            { to_concept_id: 'other_repo', label: 'Out' }
          ]
        })
      ],
      ['service_directory', 'in_repo']
    );
    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    expect(result.written).toBe(1);
    expect(result.dropped).toEqual(['other_repo']);
    const edges = Object.values(mockDb._stores[`${GRAPH}_LINKS_TO`] || {});
    expect(edges).toHaveLength(1);
  });

  test('a duplicate link target is probed ONCE (no repeated probes of the same id)', async () => {
    programQueries(
      [
        metaRow({
          links: [
            { to_concept_id: 'index', label: 'First' },
            { to_concept_id: 'index', label: 'Second' }
          ]
        })
      ],
      ['service_directory', 'index']
    );
    await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    const probes = mockDb.query.mock.calls.filter(
      ([aql]) => typeof aql === 'string' && aql.includes('RETURN m.concept_id') && aql.includes('@cid')
    );
    expect(probes).toHaveLength(1);
  });
});
