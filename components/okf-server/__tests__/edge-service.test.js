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
jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const edgeService = require('../services/edge-service');
const { logger } = require('../shared-lib/logger');

const REPO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const GRAPH = `OKF_${REPO}`;

/** The service queries by position: 1st = meta read, 2nd = repo concept-set. */
function programQueries(metaRows, repoConceptIds) {
  mockDb.query.mockImplementationOnce(async () => ({ all: async () => metaRows }));
  mockDb.query.mockImplementationOnce(async () => ({ all: async () => repoConceptIds }));
  mockDb.query.mockImplementation(async () => ({ all: async () => [] })); // cleanup REMOVE etc.
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
    // query order: meta read, repo set, cleanup (returns the STALE key to remove).
    mockDb.query.mockImplementationOnce(async () => ({
      all: async () => [metaRow({ links: [{ to_concept_id: 'index', label: 'Current' }] })]
    }));
    mockDb.query.mockImplementationOnce(async () => ({ all: async () => ['service_directory', 'index'] }));
    mockDb.query.mockImplementationOnce(async () => ({ all: async () => ['e_stale'] }));
    mockDb.query.mockImplementation(async () => ({ all: async () => [] }));
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
    mockDb.query.mockImplementationOnce(async () => ({
      all: async () => [metaRow({ links: [{ to_concept_id: 'x', label: 'X' }] })]
    }));
    mockDb.query.mockRejectedValueOnce(new Error('arango down'));
    const result = await edgeService.writeRepoConceptEdges(REPO, 'service_directory', {});
    expect(result).toMatchObject({ written: 0, dropped: ['x'] });
  });
});
