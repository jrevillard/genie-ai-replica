// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Coverage for writeRepoAuthorLinks (FR-7 author-stated links → _LINKS_TO
// edges with source='author'): the within-repo boundary, the legacy
// `concepts/` prefix normalization, pair dedup and the best-effort skip.

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

const REPO = 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee';
const GRAPH = `OKF_${REPO}`;

/** The service queries by position: 1st = meta+links read, 2nd = concept-id set. */
function programQueries(metaRows, repoConceptIds) {
  mockDb.query.mockImplementationOnce(async () => ({ all: async () => metaRows }));
  mockDb.query.mockImplementationOnce(async () => ({ all: async () => repoConceptIds }));
  mockDb.query.mockImplementation(async () => ({ all: async () => [] }));
}

const metaRow = (overrides = {}) => ({
  repo_id: REPO,
  concept_id: 'service_directory',
  bundle_version: 3,
  links: [],
  ...overrides
});

beforeEach(() => {
  jest.clearAllMocks();
  mockDb._reset();
});

describe('edgeService.writeRepoAuthorLinks (FR-7)', () => {
  test('writes author edges with deterministic keys; BOTH endpoints ensured as vertices', async () => {
    programQueries(
      [
        metaRow({
          links: [
            { to_concept_id: 'huduma_kenya', label: 'Huduma', weight: 2.5 },
            { to_concept_id: 'service_directory' } // self-loop → skipped
          ]
        })
      ],
      ['service_directory', 'huduma_kenya']
    );
    const result = await edgeService.writeRepoAuthorLinks(REPO);
    expect(result).toMatchObject({ repo_id: REPO, written: 1, skipped: 1 });
    const edges = Object.values(mockDb._stores[`${GRAPH}_LINKS_TO`] || {});
    expect(edges).toHaveLength(1);
    expect(edges[0]).toMatchObject({
      from_concept_id: 'service_directory',
      to_concept_id: 'huduma_kenya',
      repo_id: REPO,
      source: 'author',
      weight: 2.5,
      bundle_version: 3
    });
    expect(edges[0]._key).toMatch(/^e_[a-f0-9]+$/);
    // BOTH endpoints exist as ENTITY vertices (the v11 dangling-edge audit)
    const entities = Object.values(mockDb._stores[`${GRAPH}_ENTITY`] || {});
    expect(entities.filter((e) => e.concept_id === 'service_directory')).toHaveLength(1);
    expect(entities.filter((e) => e.concept_id === 'huduma_kenya')).toHaveLength(1);
  });

  test('cross-repo targets are skipped (G22), never materialized as dangling edges', async () => {
    programQueries(
      [metaRow({ links: [{ to_concept_id: 'other_repo_concept' }, { to_concept_id: null }, 'garbage'] })],
      ['service_directory'] // target NOT in the repo set
    );
    const result = await edgeService.writeRepoAuthorLinks(REPO);
    expect(result).toMatchObject({ written: 0, skipped: 1 });
    expect(mockDb._stores[`${GRAPH}_LINKS_TO`] || {}).toEqual({});
  });

  test('the legacy `concepts/` prefix is normalized on BOTH ends (review P1 2026-08-17)', async () => {
    programQueries(
      [metaRow({ concept_id: 'concepts/service_directory', links: [{ to_concept_id: 'concepts/index' }] })],
      ['service_directory', 'index']
    );
    const result = await edgeService.writeRepoAuthorLinks(REPO);
    expect(result).toMatchObject({ written: 1, skipped: 0 });
    const edges = Object.values(mockDb._stores[`${GRAPH}_LINKS_TO`] || {});
    expect(edges[0]).toMatchObject({ from_concept_id: 'service_directory', to_concept_id: 'index' });
  });

  test('the same pair is written ONCE even when several meta rows state it', async () => {
    programQueries(
      [
        metaRow({ concept_id: 'a', links: [{ to_concept_id: 'b' }] }),
        metaRow({ concept_id: 'a', links: [{ to_concept_id: 'b' }] }) // duplicate
      ],
      ['a', 'b']
    );
    const result = await edgeService.writeRepoAuthorLinks(REPO);
    expect(result).toMatchObject({ written: 1, skipped: 0 });
    expect(Object.keys(mockDb._stores[`${GRAPH}_LINKS_TO`] || {})).toHaveLength(1);
  });

  test('a failed edge write is counted as skipped, never thrown', async () => {
    programQueries([metaRow({ concept_id: 'a', links: [{ to_concept_id: 'b' }] })], ['a', 'b']);
    mockDb.collection(`${GRAPH}_LINKS_TO`).save.mockRejectedValueOnce(new Error('arango down'));
    const result = await edgeService.writeRepoAuthorLinks(REPO);
    expect(result).toMatchObject({ written: 0, skipped: 1 });
  });

  test('a repo without meta rows is a clean no-op', async () => {
    programQueries([], []);
    const result = await edgeService.writeRepoAuthorLinks(REPO);
    expect(result).toMatchObject({ written: 0, skipped: 0 });
  });
});
