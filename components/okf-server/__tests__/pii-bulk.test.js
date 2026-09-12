// Copyright (C) 2026 International Telecommunication Union (ITU)
// SPDX-License-Identifier: Apache-2.0
// REPO BULK PII ACTION (David, 2026-09-12): Redact / Remove / Accept applied
// to EVERY flagged concept in one steward decision. Scan-free — the stored
// unresolved summary is the ledger — and the repo scan marker is stamped
// complete so publish neither blocks nor re-scans afterwards.

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
jest.mock('../services/audit-service', () => ({
  writeAudit: jest.fn(async () => ({}))
}));

const mockDb = require('../shared-lib/db-connection-service').__mockDb;
const piiService = require('../services/pii-service');
const auditService = require('../services/audit-service');
const ACTOR = { sub: 'steward-1', name: 'Steward One' };

async function seedRepo() {
  await mockDb.collection('okf_repositories').save({ _key: 'repoA', name: 'Repo A' });
}

async function seedFlagged(concept_id, summary) {
  await mockDb.collection('okf_concepts_meta').save({
    _key: concept_id, // the mock keys docs by _key — seed per-concept rows
    repo_id: 'repoA',
    concept_id,
    frontmatter: { title: concept_id },
    body: `Contact data for ${concept_id}`,
    pii_state: 'hit',
    pii_hits_summary: summary || { PERSON: 2 },
    pii_resolutions: []
  });
}

async function seedClean(concept_id) {
  await mockDb.collection('okf_concepts_meta').save({
    _key: concept_id,
    repo_id: 'repoA',
    concept_id,
    frontmatter: { title: concept_id },
    body: 'clean content',
    pii_state: 'clean',
    pii_hits_summary: {},
    pii_resolutions: []
  });
}

function flaggedDocs() {
  return Object.values(mockDb._stores.okf_concepts_meta).filter((d) => d.pii_state === 'hit');
}

beforeEach(() => {
  mockDb._reset();
  jest.clearAllMocks();
});

describe('pii repo bulk action', () => {
  test('accept zeroes every flagged concept, records the ledger, stamps the marker — scan-free', async () => {
    await seedRepo();
    await seedFlagged('c1');
    await seedFlagged('c2', { EMAIL_ADDRESS: 1 });
    await seedClean('clean1');
    mockDb.query.mockResolvedValueOnce({ all: async () => flaggedDocs() });

    const out = await piiService.repoBulkAction('repoA', { action: 'accept' }, ACTOR);

    expect(out).toMatchObject({ ok: true, action: 'accept', concepts_affected: 2 });
    for (const id of ['c1', 'c2']) {
      const doc = mockDb._stores.okf_concepts_meta[id];
      expect(doc.pii_state).toBe('clean');
      expect(doc.pii_hits_summary).toEqual({});
      expect(doc.pii_resolutions[doc.pii_resolutions.length - 1]).toMatchObject({
        action: 'accept_repo',
        hits_summary: expect.any(Object)
      });
    }
    // The untouched clean concept keeps its state; no body change for accepts.
    expect(mockDb._stores.okf_concepts_meta.clean1.pii_state).toBe('clean');
    expect(mockDb._stores.okf_concepts_meta.c1.body).toBe('Contact data for c1');
    // The review doubles as the completed scan for the publish gate.
    expect(mockDb._stores.okf_repositories.repoA.pii_scan_status).toBe('complete');
    expect(auditService.writeAudit).toHaveBeenCalledWith(expect.objectContaining({ action: 'repo.pii_bulk_accept' }));
  });

  test('redact replaces every flagged body with the notice; remove empties them', async () => {
    await seedRepo();
    await seedFlagged('c1');
    await seedFlagged('c2');
    mockDb.query.mockResolvedValueOnce({ all: async () => flaggedDocs() });
    await piiService.repoBulkAction('repoA', { action: 'redact' }, ACTOR);
    expect(mockDb._stores.okf_concepts_meta.c1.body).toMatch(/^# REDACTED/);
    expect(mockDb._stores.okf_concepts_meta.c1.pii_resolutions[0]).toMatchObject({ action: 'redact_file' });
    expect(mockDb._stores.okf_repositories.repoA.pii_scan_status).toBe('complete');

    await seedRepo();
    await seedFlagged('c3');
    mockDb.query.mockResolvedValueOnce({ all: async () => flaggedDocs() });
    await piiService.repoBulkAction('repoA', { action: 'remove' }, ACTOR);
    expect(mockDb._stores.okf_concepts_meta.c3.body.trim()).toBe('');
    expect(mockDb._stores.okf_concepts_meta.c3.pii_state).toBe('clean');
  });

  test('zero flagged concepts → ok, marker untouched (nothing reviewed)', async () => {
    await seedRepo();
    await seedClean('only-clean');
    const out = await piiService.repoBulkAction('repoA', { action: 'accept' }, ACTOR);
    expect(out).toMatchObject({ ok: true, concepts_affected: 0 });
    expect(mockDb._stores.okf_repositories.repoA.pii_scan_status).toBeUndefined();
  });

  test('invalid action → 400 VALIDATION_ERROR; unknown repo → 404 REPO_NOT_FOUND', async () => {
    await expect(piiService.repoBulkAction('repoA', { action: 'nuke' }, ACTOR)).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400
    });
    await expect(piiService.repoBulkAction('missing-repo', { action: 'accept' }, ACTOR)).rejects.toMatchObject({
      code: 'REPO_NOT_FOUND',
      status: 404
    });
  });
});
