// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// #2061 phase 2 — E-2, the carrier-scoped head test.
//
// The Testing Lab races every repository head in the deployment. An
// Evaluation Context narrows that race to the repositories the evaluated
// PRINCIPAL traverses — a subset, never a superset. These tests pin:
//   1. the universe query is BOUND to the carrier's repository ids;
//   2. without a carrier the query is unchanged (the Lab still races the
//      whole deployment — the honest default, and what the docs say);
//   3. the verdict says WHICH carrier it was measured over;
//   4. the suite run records the carrier with its identity and its set.

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
  teiEmbed: jest.fn(async () => [[0.1, 0.2, 0.3]])
}));
jest.mock('../services/repository-service', () => ({ getById: jest.fn() }));

const { __mockDb } = require('../shared-lib/db-connection-service');
const repositoryService = require('../services/repository-service');
const headTestService = require('../services/head-test-service');

const CARRIER = {
  context: { id: 'ec-1', name: 'analysts', version: 3, hash: 'abc123' },
  repo_ids: ['r-in', 'r-other'],
  graph_names: ['OKF_in_v1', 'OKF_other_v1']
};

function siblingRow(overrides = {}) {
  return Object.assign(
    {
      _key: 'r-in',
      name: 'Inside',
      lifecycle_state: 'publish',
      ingested_at: '2026-11-01T00:00:00Z',
      ingested_graph_name: 'OKF_in_v1',
      version: 1
    },
    overrides
  );
}

beforeEach(() => {
  jest.clearAllMocks();
  __mockDb._reset();
  repositoryService.getById.mockResolvedValue({
    _key: 'r-me',
    name: 'Under Test',
    version: 1,
    lifecycle_state: 'publish',
    ingested_at: '2026-11-01T00:00:00Z',
    ingested_graph_name: 'OKF_me_v1',
    head: { vector: [0.1, 0.2, 0.3], version: 2, computed_at: '2026-11-01T00:00:00Z' }
  });
});

describe('#2061 E-2: the universe query is bound to the carrier', () => {
  test('a carrier narrows the sibling scan to its repository ids', async () => {
    const db = await require('../shared-lib/db-connection-service').getConnection();
    __mockDb.query.mockResolvedValueOnce({ all: async () => [siblingRow()] });
    await headTestService.loadSiblings(db, 'r-me', { repoIds: CARRIER.repo_ids });
    const [aql, bindVars] = __mockDb.query.mock.calls[0];
    expect(aql).toContain('FILTER r._key IN @ids');
    expect(bindVars.ids).toEqual(['r-in', 'r-other']);
    expect(bindVars.me).toBe('r-me');
  });

  test('WITHOUT a carrier the scan is unchanged (the Lab still races the deployment)', async () => {
    const db = await require('../shared-lib/db-connection-service').getConnection();
    __mockDb.query.mockResolvedValueOnce({ all: async () => [siblingRow()] });
    const siblings = await headTestService.loadSiblings(db, 'r-me');
    const [aql, bindVars] = __mockDb.query.mock.calls[0];
    expect(aql).not.toContain('@ids');
    expect(bindVars.ids).toBeUndefined();
    expect(siblings).toHaveLength(1);
  });
});

describe('#2061 E-2: the routing verdict says which carrier it was measured over', () => {
  async function runWithCarrier(carrier) {
    // The sibling scan, then the batch head lookup.
    __mockDb.query.mockResolvedValueOnce({ all: async () => [siblingRow()] });
    __mockDb.query.mockResolvedValueOnce({ all: async () => [{ _key: 'r-in', head: { vector: [0.2, 0.2, 0.2] } }] });
    return headTestService.routingTest('r-me', { query: 'a question', include_probes: false }, { carrier });
  }

  test('a scoped run reports the carrier identity and its size', async () => {
    const result = await runWithCarrier(CARRIER);
    expect(result.carrier).toEqual({
      context_id: 'ec-1',
      context_version: 3,
      context_hash: 'abc123',
      repo_count: 2,
      graph_count: 2
    });
    // The universe query carried the carrier's ids.
    expect(__mockDb.query.mock.calls[0][1].ids).toEqual(['r-in', 'r-other']);
  });

  test('an unscoped run reports NO carrier (the deployment-wide universe)', async () => {
    const result = await runWithCarrier(null);
    expect(result.carrier).toBeNull();
  });
});
