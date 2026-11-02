// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Coverage for backing-file-service.markIngested — the settle flip that
// grants 'Pending' bundles the Ingested badge once the drain completes
// (the other half of defect A). Only Pending bundles are touched, and both
// the enumeration and the per-bundle flip are non-fatal.

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
jest.mock('../services/service-token', () => {
  const get = jest.fn().mockResolvedValue({ data: { data: [] } });
  const post = jest.fn().mockResolvedValue({ data: { file_id: 'file-new-1' } });
  const patch = jest.fn().mockResolvedValue({});
  const _delete = jest.fn().mockResolvedValue({});
  return { __esModule: true, authedAxios: { get, post, patch, delete: _delete }, getServiceToken: jest.fn() };
});

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const { authedAxios } = require('../services/service-token');
const service = require('../services/backing-file-service');

const REPO = 'settle-0000-0000-0000-000000000001';
let files = [];

/** Route db.query by statement shape (the mock does not join collections into AQL). */
function programQueries() {
  mockDb.query.mockImplementation(async (q, bind) => {
    const text = typeof q === 'string' ? q : q && q.query ? String(q.query) : '';
    const all = (rows) => async () => rows;
    if (text.includes('f.repo_id == @repo_id')) {
      return { all: all(files.filter((f) => f.repo_id === bind.repo_id)) };
    }
    if (text.includes('f.okf_repo_id == @repo_id')) {
      return { all: all(files.filter((f) => f.okk_repo_id === bind.repo_id && f.okf_repo_id === bind.repo_id)) };
    }
    return { all: all([]) };
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockDb._reset();
  files = [];
  programQueries();
});

const bundle = (file_id, status, extra = {}) => ({
  file_id,
  file_name: `${file_id}.zip`,
  repo_id: REPO,
  is_bundle: true,
  dataprep: status ? { status } : null,
  ...extra
});

describe('backing-file-service.markIngested (the settle flip)', () => {
  test('flips ONLY Pending bundles; settled bundles and sources are skipped', async () => {
    files = [
      bundle('b-pending', 'Pending'),
      bundle('b-ingested', 'Ingested'),
      bundle('b-retracted', 'Retracted'),
      { file_id: 'src-1', file_name: 'doc.md', okf_repo_id: REPO, dataprep: { status: 'Pending' } } // source
    ];
    const out = await service.markIngested(REPO);
    expect(out.marked).toEqual(['b-pending']);
    expect(out.skipped).toBe(2); // Ingested + Retracted bundles keep their real state
    expect(out.failed).toEqual([]);
    expect(authedAxios.patch).toHaveBeenCalledTimes(1);
    expect(authedAxios.patch).toHaveBeenCalledWith(
      expect.stringContaining('/api/files/b-pending/status'),
      { dataprep: { status: 'Ingested' } },
      expect.objectContaining({ timeout: 10000 })
    );
  });

  test('a failed flip lands in failed[] and never throws', async () => {
    files = [bundle('b-broken', 'Pending')];
    authedAxios.patch.mockRejectedValueOnce(new Error('doc-repo down'));
    const out = await service.markIngested(REPO);
    expect(out).toMatchObject({ marked: [], failed: [{ file_id: 'b-broken', error: 'doc-repo down' }] });
  });

  test('an enumeration failure is non-fatal and reports nothing marked', async () => {
    mockDb.query.mockRejectedValueOnce(new Error('arango down'));
    const out = await service.markIngested(REPO);
    expect(out).toEqual({ repo_id: REPO, marked: [], skipped: 0, failed: [] });
    expect(authedAxios.patch).not.toHaveBeenCalled();
  });

  test('a repo with no backing files is a clean no-op', async () => {
    const out = await service.markIngested(REPO);
    expect(out).toMatchObject({ marked: [], skipped: 0, failed: [] });
  });
});
