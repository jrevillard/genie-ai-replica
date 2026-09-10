// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Story #978 rename (David, 2026-09-02) — repository-service.update's RENAME
// path: the born-right graph MOVE is triggered with (updated doc, oldName),
// the registry rename is audited as its own repo.rename row, and a graph-move
// failure propagates (no silent split).

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
  renameForRepoNameChange: jest.fn().mockResolvedValue('OKF_new-name_v1'),
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
const { writeAudit } = require('../services/audit-service');
const { renameForRepoNameChange } = require('../services/graph-lifecycle-service');

const RID = '99988888-7777-4666-8555-444444444444';

function seedRepo(extra = {}) {
  return mockDb.collection('okf_repositories').save({
    _key: RID,
    repo_id: RID,
    name: 'Old Name',
    domain: 'social',
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

describe('repository-service.update — the rename path (born-right graph carry)', () => {
  test('a name change moves the graph and audits repo.rename', async () => {
    seedRepo();
    const out = await repoService.update(RID, { name: 'New Name' }, { sub: 'steward-1' });
    expect(out.name).toBe('New Name');
    // the graph move: called with the UPDATED doc + the OLD name
    expect(renameForRepoNameChange).toHaveBeenCalledTimes(1);
    const [repoArg, oldNameArg] = renameForRepoNameChange.mock.calls[0];
    expect(repoArg).toMatchObject({ repo_id: RID, name: 'New Name' });
    expect(oldNameArg).toBe('Old Name');
    // its own audit row
    const rows = writeAudit.mock.calls.map((c) => c[0]);
    expect(rows.some((r) => r.action === 'repo.rename' && /"Old Name" to "New Name"/.test(r.description))).toBe(
      true
    );
  });

  test('a NON-name update does not touch the graph', async () => {
    seedRepo();
    await repoService.update(RID, { 'acl': { required_scopes: ['x'] } });
    expect(renameForRepoNameChange).not.toHaveBeenCalled();
  });

  test('a graph-move failure propagates (no silent split)', async () => {
    seedRepo();
    renameForRepoNameChange.mockRejectedValueOnce(
      Object.assign(new Error('conflict'), { code: 'GRAPH_NAME_CONFLICT', status: 409 })
    );
    await expect(repoService.update(RID, { name: 'Clashing Slug' })).rejects.toMatchObject({
      code: 'GRAPH_NAME_CONFLICT'
    });
    // the repo.rename audit row is NOT written for a failed move
    const rows = writeAudit.mock.calls.map((c) => c[0]);
    expect(rows.some((r) => r.action === 'repo.rename')).toBe(false);
  });
});
