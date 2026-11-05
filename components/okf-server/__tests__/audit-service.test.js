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
const { writeAudit, listRepoLogs, listAuditLogsByAction } = require('../services/audit-service');

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

  test('listRepoLogs binds repo_id + limit and projects the UI field set', async () => {
    // The mock's query is a stub — an ordered fixture only proves pass-through,
    // so ordering itself is NOT asserted here; the real contract is the AQL:
    // repo_id binding + limit + SORT ts DESC + the projected field set the
    // Logs viewer renders (internals projected away).
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

  // Story 10.7 (#995) — the by-action read. The retrieval config's audit rows
  // live under the '_system' pseudo-repo, where unrelated system actions
  // share the same repo_id — so the filter is by ACTION, never by repo.
  test('listAuditLogsByAction filters by ACTION (not repo_id) and projects the UI field set', async () => {
    mockDb.query.mockResolvedValueOnce({
      all: async () => [
        {
          ts: '2026-11-05T09:00:00Z',
          actor: 'steward-1',
          actor_name: 'Steward',
          action: 'system.retrieval_config.update',
          description: 'Retrieval config updated: mode: "legacy" → "hybrid"'
        }
      ]
    });
    const rows = await listAuditLogsByAction('system.retrieval_config.update', { limit: 25 });
    expect(rows).toHaveLength(1);
    expect(rows[0]).not.toHaveProperty('_key'); // internals projected away
    const [aqlText, bind] = mockDb.query.mock.calls[0];
    expect(aqlText).toContain('okf_audit_logs');
    expect(aqlText).toContain('FILTER l.action == @act');
    expect(aqlText).not.toContain('l.repo_id == @rid');
    expect(aqlText).toContain('SORT l.ts DESC');
    expect(bind).toMatchObject({ act: 'system.retrieval_config.update', limit: 25 });
  });

  test('listAuditLogsByAction clamps the limit (200 max; 0/absent → the 50 default)', async () => {
    mockDb.query.mockResolvedValue({ all: async () => [] });
    await listAuditLogsByAction('a', { limit: 99999 });
    expect(mockDb.query.mock.calls[0][1].limit).toBe(200);
    await listAuditLogsByAction('a', { limit: 0 });
    expect(mockDb.query.mock.calls[1][1].limit).toBe(50);
    await listAuditLogsByAction('a', {});
    expect(mockDb.query.mock.calls[2][1].limit).toBe(50);
  });
});
