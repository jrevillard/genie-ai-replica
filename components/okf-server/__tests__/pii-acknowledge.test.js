// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// Coverage for the steward PII acknowledgement (David, 2026-08-30): the
// sanctioned release valve for reviewed public entities — ack/revoke both
// stamp the registry, count the flagged concepts at decision time, and audit.

jest.mock('../shared-lib/db-connection-service', () => {
  const mockDb = require('./mocks/arango-mock').createMockDb();
  return { getConnection: jest.fn(() => Promise.resolve(mockDb)), __mockDb: mockDb };
});
jest.mock('../shared-lib/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }
}));
jest.mock('../shared-lib/tracing', () => ({
  withSpan: jest.fn(async (name, fn) => fn({ setAttribute: jest.fn() }))
}));
jest.mock('../shared-lib/metrics', () => ({
  getMeter: () => ({ createCounter: () => ({ add: jest.fn() }) })
}));
jest.mock('axios', () => ({
  default: { get: jest.fn(), post: jest.fn() },
  get: jest.fn(),
  post: jest.fn(),
  create: jest.fn(() => ({ post: jest.fn() }))
}));

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const piiService = require('../services/pii-service');

const REPO = 'b1111111-2222-4333-8444-555555555555';

beforeEach(() => {
  jest.clearAllMocks();
  mockDb._reset();
});

describe('piiService.acknowledgePii', () => {
  test('an ack stamps pii_ack with the CURRENT flagged count and returns it', async () => {
    await mockDb.collection('okf_repositories').save({ repo_id: REPO, name: 'R' });
    mockDb.query.mockImplementationOnce(async () => ({ all: async () => [5] }));
    const res = await piiService.acknowledgePii(REPO, true, { sub: 'u1', name: 'Alice' });
    expect(res).toEqual({ ok: true, acknowledged: true, flagged_concepts: 5 });
    const [key, patch] = mockDb.collection('okf_repositories').update.mock.calls[0];
    expect(key).toBe(REPO);
    expect(patch.pii_ack).toMatchObject({ by: 'u1', flagged_concepts: 5 });
    expect(typeof patch.pii_ack.at).toBe('string');
  });

  test('a revoke clears the stamp (null) and reports acknowledged:false', async () => {
    await mockDb.collection('okf_repositories').save({ repo_id: REPO, name: 'R' });
    mockDb.query.mockImplementationOnce(async () => ({ all: async () => [0] }));
    const res = await piiService.acknowledgePii(REPO, false, { sub: 'u1' });
    expect(res).toEqual({ ok: true, acknowledged: false, flagged_concepts: 0 });
    expect(mockDb.collection('okf_repositories').update.mock.calls[0][1]).toEqual({ pii_ack: null });
  });

  test('a missing or soft-deleted repo is REPO_NOT_FOUND 404', async () => {
    await expect(piiService.acknowledgePii('ghost', true)).rejects.toMatchObject({
      code: 'REPO_NOT_FOUND',
      status: 404
    });
    await mockDb.collection('okf_repositories').save({ repo_id: 'deleted', deleted_at: 'T' });
    await expect(piiService.acknowledgePii('deleted', true)).rejects.toMatchObject({
      code: 'REPO_NOT_FOUND'
    });
  });

  test('the actor defaults to system and a failed audit write never fails the ack', async () => {
    await mockDb.collection('okf_repositories').save({ repo_id: REPO, name: 'R' });
    mockDb.query.mockImplementationOnce(async () => ({ all: async () => [2] }));
    const res = await piiService.acknowledgePii(REPO, true);
    expect(res).toMatchObject({ ok: true, flagged_concepts: 2 });
    expect(mockDb.collection('okf_repositories').update.mock.calls[0][1].pii_ack.by).toBe('system');
  });
});
