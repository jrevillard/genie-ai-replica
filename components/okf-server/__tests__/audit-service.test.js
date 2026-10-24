// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// David, 2026-08-31: "every state transition and every modification must be
// tracked and auditable" — the okf_audit_logs writer + the repo-logs reader.

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

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const { writeAudit, listRepoLogs } = require('../services/audit-service');

describe('audit-service (okf_audit_logs)', () => {
  beforeEach(() => mockDb._reset());

  test('writeAudit stores user (sub + display name), timestamp, action, description and details', async () => {
    const out = await writeAudit({
      actor: 'steward-1',
      actor_name: 'Steward One',
      action: 'repo.publish',
      repo_id: 'r-1',
      version: 2,
      description: 'Published version 2 — bundle "demo-v2.zip" stored in the document repository',
      details: { bundle_version: 2, bundle_file_name: 'demo-v2.zip' },
      source_ip: '10.0.0.9'
    });
    expect(out).toMatchObject({ action: 'repo.publish', repo_id: 'r-1' });
    const rows = Object.values(mockDb._stores.okf_audit_logs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actor: 'steward-1',
      actor_name: 'Steward One',
      action: 'repo.publish',
      repo_id: 'r-1',
      version: 2,
      description: expect.stringContaining('Published version 2'),
      details: { bundle_version: 2 },
      source_ip: '10.0.0.9'
    });
    expect(rows[0].ts).toBeTruthy(); // the date+time of the action
  });

  test('listRepoLogs returns the repo rows newest-first (KEEP projects UI fields)', async () => {
    // The mock's query is a stub — program it to return an ordered page the way
    // the real SORT ts DESC would. The contract pinned here: repo_id binding +
    // the projected field set the Logs viewer renders.
    mockDb.query.mockResolvedValueOnce({
      all: async () => [
        {
          ts: '2026-08-31T10:00:00Z',
          actor: 'a',
          actor_name: 'Ann',
          action: 'repo.ingest',
          description: 'Ingested version 1'
        },
        {
          ts: '2026-08-31T09:00:00Z',
          actor: 'a',
          actor_name: 'Ann',
          action: 'repo.publish',
          description: 'Published version 1'
        }
      ]
    });
    const rows = await listRepoLogs('r-1', { limit: 50 });
    expect(rows).toHaveLength(2);
    expect(rows[0].ts).toBe('2026-08-31T10:00:00Z'); // newest first
    expect(rows[0]).toHaveProperty('description');
    expect(rows[0]).not.toHaveProperty('_key'); // internals projected away
    const [aqlText, bind] = mockDb.query.mock.calls[0];
    expect(aqlText).toContain('okf_audit_logs');
    expect(aqlText).toContain('SORT l.ts DESC');
    expect(bind).toMatchObject({ rid: 'r-1', limit: 50 });
  });

  test('listRepoLogs clamps the limit (500 max; 0/absent → the 200 default)', async () => {
    mockDb.query.mockResolvedValue({ all: async () => [] });
    await listRepoLogs('r-1', { limit: 99999 });
    expect(mockDb.query.mock.calls[0][1].limit).toBe(500);
    await listRepoLogs('r-1', { limit: 0 });
    expect(mockDb.query.mock.calls[1][1].limit).toBe(200);
    await listRepoLogs('r-1', {});
    expect(mockDb.query.mock.calls[2][1].limit).toBe(200);
  });
});
