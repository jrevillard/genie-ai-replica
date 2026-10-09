// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story 1-8d — repository-service frontmatter HISTORY: every frontmatter
// save snapshots {saved_at, actor, shape} into a bounded
// doc.frontmatter_history (last 10), frontmatterHistory maps the entries
// for the Lab's Revert-tags panel, and revertFrontmatter restores an
// entry's exact shape BY GOING BACK THROUGH update() — so the revert
// itself is snapshotted (revert-of-revert works).

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
jest.mock('../services/graph-lifecycle-service', () => ({
  renameForRepoNameChange: jest.fn().mockResolvedValue('OK_new-name_v1'),
  promoteGraph: jest.fn(),
  demoteGraph: jest.fn(),
  versionedGraphName: jest.fn(),
  workingGraphName: jest.fn(),
  GraphLifecycleError: class extends Error {
    constructor(code, message, status) {
      super(message);
      this.code = code;
      this.status = status;
    }
  }
}));

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const repoService = require('../services/repository-service');

const RID = '55554444-3333-4222-8111-000000000000';

const POISONED_FM = {
  topic: ['noncommunicable-diseases'],
  entity: ['lung-cancer'],
  forbidden: ['lung-cancer', 'non-smoking']
};
const CLEAN_FM = { topic: ['noncommunicable-diseases'], entity: ['breast-cancer'], forbidden: ['mental-health'] };

function historyEntry(savedAt, shape, actor = 'steward-1') {
  return { saved_at: savedAt, actor, shape };
}

function seedRepo(extra = {}) {
  return mockDb.collection('okf_repositories').save({
    _key: RID,
    repo_id: RID,
    name: 'NCD Information',
    domain: 'health',
    graph_name: `OKF_${RID}`,
    lifecycle_state: 'draft',
    version: null,
    deleted_at: null,
    ...extra
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb._reset();
});

describe('repository-service.update — the frontmatter_history snapshot (Story 1-8d)', () => {
  test('a frontmatter save prepends {saved_at, actor, shape} (newest first)', async () => {
    seedRepo({
      frontmatter: POISONED_FM,
      frontmatter_history: [historyEntry('2026-10-01T10:00:00.000Z', CLEAN_FM)]
    });
    await repoService.update(RID, { frontmatter: CLEAN_FM }, { sub: 'steward-2' });
    const history = mockDb._stores.okf_repositories[RID].frontmatter_history;
    expect(history).toHaveLength(2);
    expect(history[0]).toMatchObject({ actor: 'steward-2', shape: CLEAN_FM });
    expect(typeof history[0].saved_at).toBe('string');
    expect(history[0].saved_at).not.toBe('');
    // the older save is preserved below the new snapshot
    expect(history[1]).toEqual(historyEntry('2026-10-01T10:00:00.000Z', CLEAN_FM));
    // and the live frontmatter is the new shape
    expect(mockDb._stores.okf_repositories[RID].frontmatter).toEqual(CLEAN_FM);
  });

  test('a save WITHOUT a frontmatter key adds no history entry', async () => {
    seedRepo({
      frontmatter: POISONED_FM,
      frontmatter_history: [historyEntry('2026-10-01T10:00:00.000Z', POISONED_FM)]
    });
    await repoService.update(RID, { name: 'NCD Info Renamed' }, { sub: 'steward-1' });
    const doc = mockDb._stores.okf_repositories[RID];
    expect(doc.name).toBe('NCD Info Renamed');
    expect(doc.frontmatter_history).toHaveLength(1); // untouched
  });

  test('history is bounded at 10 — the 11th save drops the oldest snapshot', async () => {
    // Ten prior saves, newest first: 10:09 ... 10:00.
    const seeded = Array.from({ length: 10 }, (_, i) =>
      historyEntry(`2026-10-01T10:${String(9 - i).padStart(2, '0')}:00.000Z`, { forbidden: [`tag-${9 - i}`] })
    );
    seedRepo({ frontmatter: POISONED_FM, frontmatter_history: seeded });
    await repoService.update(RID, { frontmatter: CLEAN_FM }, { sub: 'steward-1' });
    const history = mockDb._stores.okf_repositories[RID].frontmatter_history;
    expect(history).toHaveLength(10); // capped, not 11
    expect(history[0]).toMatchObject({ shape: CLEAN_FM }); // the new save leads
    expect(history[1].saved_at).toBe('2026-10-01T10:09:00.000Z'); // previous newest kept
    expect(history[9].saved_at).toBe('2026-10-01T10:01:00.000Z'); // 10:00 (oldest) dropped
  });

  test('a repo with no prior history starts a fresh list; actor defaults to system', async () => {
    seedRepo({ frontmatter: null });
    await repoService.update(RID, { frontmatter: CLEAN_FM }, {});
    const history = mockDb._stores.okf_repositories[RID].frontmatter_history;
    expect(history).toHaveLength(1);
    expect(history[0]).toMatchObject({ actor: 'system', shape: CLEAN_FM });
  });
});

describe('repository-service.frontmatterHistory — the Lab revert-panel read (Story 1-8d)', () => {
  test('maps entries newest-first with saved_at, actor, forbidden_count and the full shape', async () => {
    seedRepo({
      frontmatter: POISONED_FM,
      frontmatter_history: [
        historyEntry('2026-10-02T09:00:00.000Z', CLEAN_FM, 'steward-1'),
        { saved_at: '2026-10-01T09:00:00.000Z', shape: { forbidden: ['a', 'b', 'c'] } } // no actor → system
      ]
    });
    const out = await repoService.frontmatterHistory(RID, {});
    expect(out.repo_id).toBe(RID);
    expect(out.entries).toHaveLength(2);
    expect(out.entries[0]).toEqual({
      saved_at: '2026-10-02T09:00:00.000Z',
      actor: 'steward-1',
      forbidden_count: 1,
      shape: CLEAN_FM
    });
    expect(out.entries[1]).toMatchObject({
      saved_at: '2026-10-01T09:00:00.000Z',
      actor: 'system',
      forbidden_count: 3
    });
  });

  test('a repo with no history returns an empty list (not an error)', async () => {
    seedRepo();
    const out = await repoService.frontmatterHistory(RID, {});
    expect(out.entries).toEqual([]);
  });

  test('404s for a missing repo', async () => {
    await expect(repoService.frontmatterHistory('nope', {})).rejects.toMatchObject({
      code: 'REPO_NOT_FOUND',
      status: 404
    });
  });
});

describe('repository-service.revertFrontmatter — one-click revert in the Lab (Story 1-8d)', () => {
  test('restores the entry shape AND snapshots the revert itself (revert-of-revert works)', async () => {
    seedRepo({
      frontmatter: POISONED_FM,
      frontmatter_history: [
        historyEntry('2026-10-02T09:00:00.000Z', CLEAN_FM, 'steward-1'),
        historyEntry('2026-10-01T09:00:00.000Z', { forbidden: ['older'] })
      ]
    });
    const out = await repoService.revertFrontmatter(RID, '2026-10-02T09:00:00.000Z', { sub: 'steward-2' });
    expect(out).toEqual({
      repo_id: RID,
      reverted_to: '2026-10-02T09:00:00.000Z',
      frontmatter: CLEAN_FM
    });
    const doc = mockDb._stores.okf_repositories[RID];
    // the live frontmatter is the restored shape
    expect(doc.frontmatter).toEqual(CLEAN_FM);
    // the revert went back through update(): it is ITSELF snapshotted
    expect(doc.frontmatter_history).toHaveLength(3);
    expect(doc.frontmatter_history[0]).toMatchObject({ actor: 'steward-2', shape: CLEAN_FM });
    // and the revert snapshot is a first-class entry — reverting to it
    // restores the poisoned shape again (the round trip)
    const roundTrip = await repoService.revertFrontmatter(RID, doc.frontmatter_history[0].saved_at, {
      sub: 'steward-1'
    });
    expect(roundTrip.frontmatter).toEqual(CLEAN_FM);
    expect(mockDb._stores.okf_repositories[RID].frontmatter).toEqual(CLEAN_FM);
  });

  test('404s with HISTORY_ENTRY_NOT_FOUND for an unknown saved_at (doc unchanged)', async () => {
    seedRepo({ frontmatter: POISONED_FM, frontmatter_history: [historyEntry('2026-10-02T09:00:00.000Z', CLEAN_FM)] });
    await expect(
      repoService.revertFrontmatter(RID, '2026-10-03T09:00:00.000Z', { sub: 'steward-1' })
    ).rejects.toMatchObject({
      code: 'HISTORY_ENTRY_NOT_FOUND',
      status: 404
    });
    const doc = mockDb._stores.okf_repositories[RID];
    expect(doc.frontmatter).toEqual(POISONED_FM);
    expect(doc.frontmatter_history).toHaveLength(1);
  });
});
