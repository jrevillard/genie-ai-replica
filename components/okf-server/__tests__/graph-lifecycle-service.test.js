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
  renameForRepoNameChange,
  versionedGraphName,
  workingGraphName,
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

  test('workingGraphName: the graph is BORN named for the version being built', () => {
    // Fresh repo (never minted): the first concept ingest creates v1 — never
    // OKF_{repo_id} (David, 2026-08-31: created with the correct convention).
    expect(workingGraphName({ name: 'Kenya Government Services', version: 0 })).toBe(
      'OKF_kenya-government-services_v1'
    );
    // Editing states build the NEXT version (the one the next publish mints).
    for (const state of ['draft', 'register', 'review', 'approve', 'retracted']) {
      expect(workingGraphName({ name: 'Kenya Gov', version: 2, lifecycle_state: state })).toBe('OKF_kenya-gov_v3');
    }
    // Published (pending ingest) and serving content IS the current version.
    expect(workingGraphName({ name: 'Kenya Gov', version: 2, lifecycle_state: 'publish' })).toBe('OKF_kenya-gov_v2');
    expect(workingGraphName({ name: 'Kenya Gov', version: 2, lifecycle_state: 'publish', ingested_at: 'x' })).toBe(
      'OKF_kenya-gov_v2'
    );
  });

  test('promoteGraph renames the open DRAFT graph (v{n+1}) to the serving name (v{n})', async () => {
    // Retracted repo re-ingesting without edits: content is v2, the draft
    // graph was renamed to v3 when the retract opened it.
    const DRAFT = 'OKF_kenya-government-services_v3';
    seedGraph(DRAFT);
    const out = await promoteGraph(repoDoc({ lifecycle_state: 'retracted' }));
    expect(out).toBe('OKF_kenya-government-services_v2');
    for (const s of SUFFIXES) {
      expect(mockDb._stores['OKF_kenya-government-services_v2' + s]).toBeDefined();
      expect(mockDb._stores[DRAFT + s]).toBeUndefined();
    }
  });

  test('promoteGraph NO-OPs when the working graph is already the serving name (born right)', async () => {
    const SERVING = 'OKF_kenya-government-services_v2';
    seedGraph(SERVING); // the published/ingest-pending graph, born right
    const doc = repoDoc({ lifecycle_state: 'publish' });
    const out = await promoteGraph(doc);
    expect(out).toBe(SERVING);
    expect(mockDb._stores[SERVING + '_SOURCE'].x1).toBeDefined(); // untouched
  });

  test('promoteGraph follows the DRAIN authority after a version skew (live-caught 2026-09-01)', async () => {
    // A failed publish consumed version 1 (the mint persisted before the
    // bundle export failed) — the retry minted v2, so the serving target is
    // v2 while the concepts DRAINED into v1. The registry cannot derive v1;
    // the meta rows name it. Promote must move THAT graph.
    const DRAINED = 'OKF_drain-probe_v1';
    seedGraph(DRAINED);
    // The first db.query in promoteGraph is the drain-authority read.
    mockDb.query.mockResolvedValueOnce({ all: async () => [DRAINED] });
    const doc = repoDoc({
      name: 'Drain Probe',
      version: 2,
      lifecycle_state: 'publish',
      ingested_graph_name: null
    });
    const out = await promoteGraph(doc);
    expect(out).toBe('OKF_drain-probe_v2');
    expect(mockDb._stores['OKF_drain-probe_v2_SOURCE'].x1).toBeDefined(); // the DATA moved
    expect(mockDb._stores[DRAINED + '_SOURCE']).toBeUndefined();
  });

  test('promoteGraph skips absent sources but still creates the versioned definition', async () => {
    // No seeding: sources never materialized with data — the mock treats
    // empty/absent as not-exists. Rename is skipped, definition still created.
    const out = await promoteGraph(repoDoc({ lifecycle_state: 'retracted' }));
    expect(out).toBe('OKF_kenya-government-services_v2');
    expect(mockDb.createGraph).toHaveBeenCalled();
  });

  test('GRAPH_NAME_CONFLICT: a foreign graph owns the target name → 409, stores untouched', async () => {
    const DRAFT = 'OKF_kenya-government-services_v3';
    seedGraph(DRAFT);
    // A DIFFERENT repo that happens to carry the same name+version → same
    // serving name — the collision the guard exists for.
    seedGraph('OKF_kenya-government-services_v2');
    const doc = repoDoc({ lifecycle_state: 'retracted', ingested_graph_name: null });
    const err = await promoteGraph(doc).catch((e) => e);
    expect(err).toBeInstanceOf(GraphLifecycleError);
    expect(err.code).toBe('GRAPH_NAME_CONFLICT');
    expect(mockDb._stores['OKF_kenya-government-services_v2_SOURCE'].x1).toBeDefined(); // foreign data untouched
    expect(mockDb._stores[DRAFT + '_SOURCE']).toBeDefined(); // own data unmoved
  });

  test('promoteGraph issues the canonical endpoint rewrite for both edge collections', async () => {
    const DRAFT = 'OKF_kenya-government-services_v3';
    seedGraph(DRAFT);
    await promoteGraph(repoDoc({ lifecycle_state: 'retracted' }));
    const rewrites = mockDb.query.mock.calls.filter((c) => String(c[0]).includes('PARSE_IDENTIFIER'));
    expect(rewrites.length).toBe(2); // _HAS_SOURCE + _LINKS_TO
    expect(rewrites[0][0]).toContain('CONCAT(@toFrom');
    // The endpoints are written canonically from the fixed edge shapes —
    // HAS_SOURCE: ENTITY->SOURCE, LINKS_TO: ENTITY->ENTITY.
    expect(rewrites[0][1]).toMatchObject({
      from: DRAFT,
      legacy: WORKING,
      toFrom: 'OKF_kenya-government-services_v2_ENTITY',
      toTo: 'OKF_kenya-government-services_v2_SOURCE'
    });
    expect(rewrites[1][1]).toMatchObject({
      toFrom: 'OKF_kenya-government-services_v2_ENTITY',
      toTo: 'OKF_kenya-government-services_v2_ENTITY'
    });
  });

  test('demoteGraph renames the serving graph to the OPEN DRAFT (v{n+1})', async () => {
    const TARGET = 'OKF_kenya-government-services_v2';
    const DRAFT = 'OKF_kenya-government-services_v3';
    seedGraph(TARGET);
    const out = await demoteGraph(repoDoc({ ingested_graph_name: TARGET }));
    expect(out).toBe(DRAFT);
    for (const s of SUFFIXES) {
      expect(mockDb._stores[DRAFT + s]).toBeDefined();
      expect(mockDb._stores[TARGET + s]).toBeUndefined();
    }
  });

  test('demoteGraph heals a partial prior demote (leftover draft targets are drop-safe)', async () => {
    const TARGET = 'OKF_kenya-government-services_v2';
    const DRAFT = 'OKF_kenya-government-services_v3';
    seedGraph(TARGET);
    seedGraph(DRAFT); // leftover from a crashed demote — the draft name is repo-private
    const out = await demoteGraph(repoDoc({ ingested_graph_name: TARGET }));
    expect(out).toBe(DRAFT);
    // The leftover draft collection was replaced by the serving data.
    expect(mockDb._stores[DRAFT + '_SOURCE'].x1).toBeDefined();
    expect(mockDb._stores[TARGET + '_SOURCE']).toBeUndefined();
  });

  test('renameForRepoNameChange moves the graph to the NEW slug (David, 2026-09-02)', async () => {
    const OLD = 'OKF_kenya-government-services_v3';
    const NEW = 'OKF_ke-services_v3';
    seedGraph(OLD);
    // The first db.query in the rename is the drain-authority read — the meta
    // rows still name the OLD slug (the registry is already updated).
    mockDb.query.mockResolvedValueOnce({ all: async () => [OLD] });
    const repo = repoDoc({ name: 'KE Services', version: 2, lifecycle_state: 'approve' });
    const out = await renameForRepoNameChange(repo, 'Kenya Government Services');
    expect(out).toBe(NEW);
    for (const s of SUFFIXES) {
      expect(mockDb._stores[NEW + s]).toBeDefined(); // the DATA moved
      expect(mockDb._stores[OLD + s]).toBeUndefined();
    }
  });

  test('renameForRepoNameChange NO-OPs when the slug is unchanged (case-only edit)', async () => {
    const G = 'OKF_kenya-government-services_v3';
    seedGraph(G);
    const repo = repoDoc({ name: 'Kenya Government SERVICES', version: 2, lifecycle_state: 'approve' });
    const out = await renameForRepoNameChange(repo, 'Kenya Government Services');
    expect(out).toBe(G);
    expect(mockDb._stores[G + '_SOURCE'].x1).toBeDefined(); // untouched
  });

  test('renameForRepoNameChange refuses a target slug owned by another repo (fail closed)', async () => {
    const OLD = 'OKF_kenya-government-services_v3';
    // "KE-Services" normalizes to the same slug as "KE Services" — a distinct
    // repo already lives at that graph name.
    seedGraph('OKF_ke-services_v3');
    const repo = repoDoc({ name: 'KE Services', version: 2, lifecycle_state: 'approve' });
    const err = await renameForRepoNameChange(repo, 'Kenya Government Services').catch((e) => e);
    expect(err).toBeInstanceOf(GraphLifecycleError);
    expect(err.code).toBe('GRAPH_NAME_CONFLICT');
    expect(mockDb._stores[OLD + '_SOURCE']).toBeUndefined; // own data unmoved
  });
});
