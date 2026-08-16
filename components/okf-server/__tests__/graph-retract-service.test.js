// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 2.9.6 (pulled forward 2026-08-16): repo-level bundle retraction —
// a per-repo graph serves ONE bundle, so retraction drops the graph
// definition + the 4 collections. The per-FILE retraction (dataprep
// retract_file — surgical chunk deletion) is a SEPARATE path and stays
// untouched.

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
jest.mock('../services/audit-service', () => ({
  writeAudit: jest.fn().mockResolvedValue(null)
}));

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const { retractRepoGraph } = require('../services/graph-retract-service');

const REPO = '99999999-9999-4999-8999-999999999999';
const GRAPH = `OKF_${REPO}`;
const SUFFIXES = ['_SOURCE', '_ENTITY', '_HAS_SOURCE', '_LINKS_TO'];

function seedRepo(graph_name) {
  return mockDb
    .collection('okf_repositories')
    .save({ _key: REPO, repo_id: REPO, name: 'R', domain: 'smoke', graph_name });
}
function seedGraphCollections() {
  for (const s of SUFFIXES) mockDb.collection(GRAPH + s).save({ _key: 'x' });
}

describe('graph-retract-service.retractRepoGraph (bundle-level drop)', () => {
  beforeEach(() => mockDb._reset());

  test('drops the graph definition + the 4 OKF_{repo_id} collections', async () => {
    seedRepo(GRAPH);
    seedGraphCollections();
    const result = await retractRepoGraph(REPO);
    expect(result.retracted).toBe(true);
    expect(result.graph_name).toBe(GRAPH);
    expect(result.dropped).toEqual(expect.arrayContaining(SUFFIXES.map((s) => GRAPH + s)));
    expect(result.dropped).toContain(`${GRAPH} (graph definition + member collections)`);
    for (const s of SUFFIXES) {
      expect(mockDb._stores[GRAPH + s]).toBeUndefined(); // physically gone
    }
  });

  test('FOOTGUN GUARD: a non-OKF graph_name (the default GRAPH) is NEVER dropped', async () => {
    seedRepo('GRAPH'); // a malformed registry entry naming the free-form graph
    seedGraphCollections();
    mockDb.collection('GRAPH_SOURCE').save({ _key: 'chunk' });
    const result = await retractRepoGraph(REPO);
    expect(result).toMatchObject({ retracted: false, reason: 'no-okf-graph' });
    expect(mockDb._stores.GRAPH_SOURCE).toBeDefined(); // untouched
    expect(mockDb._stores[GRAPH + '_SOURCE']).toBeDefined(); // nothing dropped at all
  });

  test('no repo / no graph_name → clean no-op, never throws', async () => {
    const missing = await retractRepoGraph('00000000-0000-4000-8000-000000000000');
    expect(missing).toMatchObject({ retracted: false, reason: 'no-okf-graph' });
    await seedRepo(null);
    const noGraph = await retractRepoGraph(REPO);
    expect(noGraph).toMatchObject({ retracted: false, reason: 'no-okf-graph' });
  });

  test('never-created collections are tolerated (idempotent re-retract)', async () => {
    // Real ArangoDB throws 404 on dropping an absent collection — the service
    // swallows it. The mock auto-creates stores on handle access, so absence
    // isn't expressible here; this pins the contract that matters: a repo with
    // no ingested graph still retracts successfully (never throws).
    seedRepo(GRAPH);
    const result = await retractRepoGraph(REPO);
    expect(result.retracted).toBe(true);
    expect(result.dropped).toContain(`${GRAPH} (graph definition)`);
  });

  test('removes the repo meta rows and dangling files docs', async () => {
    seedRepo(GRAPH);
    seedGraphCollections();
    // query() returns removed docs — program it for the two REMOVE queries
    mockDb.query
      .mockResolvedValueOnce({ all: async () => [{ concept_id: 'a' }, { concept_id: 'b' }] }) // meta REMOVE
      .mockResolvedValueOnce({ all: async () => [{ file_id: 'f1' }] }); // files REMOVE
    const result = await retractRepoGraph(REPO);
    expect(result.meta_removed).toBe(2);
    expect(result.files_removed).toBe(1);
    // writes the audit row (actor defaults to system when called from remove())
    const { writeAudit } = require('../services/audit-service');
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'repo.graph_retract', repo_id: REPO }));
  });
});
