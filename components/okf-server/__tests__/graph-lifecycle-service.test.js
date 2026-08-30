// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Graph lifecycle (David, 2026-08-30): the serving graph is PHYSICALLY named
// `OKF_<name-slug>_v<N>` while ingested — promote at ingest, demote at
// retract. Pins the rename/idempotency/conflict contract.

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
jest.mock('../services/audit-service', () => ({ writeAudit: jest.fn().mockResolvedValue(null) }));
// The real slugFor is exercised (imported from bundle-export-service).
jest.mock('../services/bundle-export-service', () => jest.requireActual('../services/bundle-export-service'));

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const {
  promoteGraph,
  demoteGraph,
  versionedGraphName,
  GraphLifecycleError
} = require('../services/graph-lifecycle-service');

const RID = '11111111-2222-4333-8444-555555555555';
const WORKING = 'OKF_' + RID;
const SUFFIXES = ['_SOURCE', '_ENTITY', '_HAS_SOURCE', '_LINKS_TO'];

function repoDoc(overrides) {
  return Object.assign(
    {
      repo_id: RID,
      name: 'Kenya Government Services',
      version: 2,
      graph_name: WORKING,
      ingested_graph_name: null
    },
    overrides || {}
  );
}

/** Seed a non-empty store (the mock treats non-empty as "exists"). */
function seedGraph(graph) {
  for (const s of SUFFIXES) {
    mockDb.collection(graph + s).save({ _key: 'x1' });
  }
}

describe('graph-lifecycle-service (versioned serving graph)', () => {
  beforeEach(() => mockDb._reset());

  test('versionedGraphName: slug + version, OKF_ prefix', () => {
    expect(versionedGraphName(repoDoc())).toBe('OKF_kenya-government-services_v2');
  });

  test('promoteGraph renames the 4 collections + creates the versioned graph definition', async () => {
    seedGraph(WORKING);
    const out = await promoteGraph(repoDoc());
    expect(out).toBe('OKF_kenya-government-services_v2');
    for (const s of SUFFIXES) {
      expect(mockDb._stores['OKF_kenya-government-services_v2' + s]).toBeDefined();
      expect(mockDb._stores[WORKING + s]).toBeUndefined();
    }
  });

  test('promoteGraph skips absent sources but still creates the versioned definition', async () => {
    // No seeding: sources never materialized with data — the mock treats
    // empty/absent as not-exists. Rename is skipped, definition still created.
    const out = await promoteGraph(repoDoc());
    expect(out).toBe('OKF_kenya-government-services_v2');
    expect(mockDb.createGraph).toHaveBeenCalled();
  });

  test('GRAPH_NAME_CONFLICT: a foreign graph owns the target name → 409, stores untouched', async () => {
    seedGraph(WORKING);
    // A DIFFERENT repo that happens to carry the same name+version → same
    // serving name — the collision the guard exists for.
    seedGraph('OKF_kenya-government-services_v2');
    const doc = repoDoc({ ingested_graph_name: null });
    const err = await promoteGraph(doc).catch((e) => e);
    expect(err).toBeInstanceOf(GraphLifecycleError);
    expect(err.code).toBe('GRAPH_NAME_CONFLICT');
    expect(mockDb._stores['OKF_kenya-government-services_v2_SOURCE'].x1).toBeDefined(); // foreign data untouched
  });

  test('own leftover target is drop-safe (crashed prior promote heals on retry)', async () => {
    const TARGET = 'OKF_kenya-government-services_v2';
    seedGraph(WORKING);
    seedGraph(TARGET);
    const out = await promoteGraph(repoDoc({ ingested_graph_name: TARGET }));
    expect(out).toBe(TARGET);
    // The leftover was cleared and the working data moved in.
    expect(mockDb._stores[TARGET + '_SOURCE'] && mockDb._stores[TARGET + '_SOURCE'].x1).toBeDefined();
    expect(mockDb._stores[WORKING + '_SOURCE']).toBeUndefined();
  });

  test('demoteGraph renames the versioned graph back to the working name', async () => {
    const TARGET = 'OKF_kenya-government-services_v2';
    seedGraph(TARGET);
    const out = await demoteGraph(repoDoc({ ingested_graph_name: TARGET }));
    expect(out).toBe(WORKING);
    for (const s of SUFFIXES) {
      expect(mockDb._stores[WORKING + s]).toBeDefined();
      expect(mockDb._stores[TARGET + s]).toBeUndefined();
    }
  });
});
