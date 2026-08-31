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
    // Born-right: candidates include the legacy anchor AND the computed name.
    expect(result.graph_name).toEqual(expect.arrayContaining([GRAPH]));
    expect(result.dropped).toEqual(expect.arrayContaining(SUFFIXES.map((s) => GRAPH + s)));
    expect(result.dropped).toContain(`${GRAPH} (graph definition + member collections, cascade)`);
    for (const s of SUFFIXES) {
      expect(mockDb._stores[GRAPH + s]).toBeUndefined(); // physically gone
    }
  });

  test('drops a born-right ingested graph too (ingested_graph_name candidate)', async () => {
    seedRepo(GRAPH);
    seedGraphCollections();
    const SERVING = 'OKF_demo-repo_v2';
    await mockDb.collection('okf_repositories').update(REPO, { ingested_graph_name: SERVING });
    for (const s of SUFFIXES) mockDb.collection(SERVING + s).save({ _key: 'x' });
    const result = await retractRepoGraph(REPO);
    expect(result.retracted).toBe(true);
    expect(result.graph_name).toEqual(expect.arrayContaining([GRAPH, SERVING]));
    for (const s of SUFFIXES) {
      expect(mockDb._stores[SERVING + s]).toBeUndefined();
      expect(mockDb._stores[GRAPH + s]).toBeUndefined();
    }
  });

  test('FOOTGUN GUARD: the free-form default GRAPH is NEVER dropped', async () => {
    seedRepo('GRAPH'); // a malformed registry entry naming the free-form graph
    seedGraphCollections();
    mockDb.collection('GRAPH_SOURCE').save({ _key: 'chunk' });
    const result = await retractRepoGraph(REPO);
    // 'GRAPH' is not OKF_-prefixed → never a candidate; the computed born-right
    // name is (nothing seeded → no-op drops). The default graph survives.
    expect(result.retracted).toBe(true);
    expect(result.dropped).not.toContain('GRAPH (graph definition + member collections, cascade)');
    expect(mockDb._stores.GRAPH_SOURCE).toBeDefined(); // untouched
  });

  test('no repo → clean no-op, never throws', async () => {
    const missing = await retractRepoGraph('00000000-0000-4000-8000-000000000000');
    expect(missing).toMatchObject({ retracted: false, reason: 'no-okf-graph' });
  });

  test('a live repo with no stored graph_name still drops its computed born-right name', async () => {
    await seedRepo(null);
    seedGraphCollections();
    const result = await retractRepoGraph(REPO);
    expect(result.retracted).toBe(true); // computed OKF_<slug>_v<N> is a valid candidate
  });

  test('never-created collections are tolerated (idempotent re-retract)', async () => {
    // Real ArangoDB throws 404 on dropping an absent collection — the service
    // swallows it. The mock auto-creates stores on handle access, so absence
    // isn't expressible here; this pins the contract that matters: a repo with
    // no ingested graph still retracts successfully (never throws).
    seedRepo(GRAPH);
    const result = await retractRepoGraph(REPO);
    expect(result.retracted).toBe(true);
    expect(result.dropped).toContain(`${GRAPH} (graph definition + member collections, cascade)`);
  });

  test('removes the repo meta rows, dangling files docs, version manifests, and bundle manifest (2.9.7 + B+C+E)', async () => {
    seedRepo(GRAPH);
    seedGraphCollections();
    // query() returns removed docs — program it for the four REMOVE queries
    mockDb.query
      .mockResolvedValueOnce({ all: async () => [{ concept_id: 'a' }, { concept_id: 'b' }] }) // meta REMOVE
      .mockResolvedValueOnce({ all: async () => [{ file_id: 'f1' }] }) // files REMOVE
      .mockResolvedValueOnce({ all: async () => [{ bundle_version: 1 }] }) // versions REMOVE
      .mockResolvedValueOnce({ all: async () => [{ _key: REPO }] }); // bundle-manifest REMOVE
    const result = await retractRepoGraph(REPO);
    expect(result.meta_removed).toBe(2);
    expect(result.files_removed).toBe(1);
    expect(result.versions_removed).toBe(1);
    expect(result.manifest_removed).toBe(1);
    // writes the audit row (actor defaults to system when called from remove())
    const { writeAudit } = require('../services/audit-service');
    expect(writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'repo.graph_retract', repo_id: REPO }));
  });
});
